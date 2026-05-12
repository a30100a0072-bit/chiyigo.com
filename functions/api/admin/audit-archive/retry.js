/**
 * POST /api/admin/audit-archive/retry
 * Header: Authorization: Bearer <access_token>  (role >= admin + scope admin:audit:write)
 *
 * F-3 Phase 2 PR 2.2b — admin retry endpoint stub
 *
 * 用途：admin 對 audit_archive_chunks 內卡住的 chunk 做有限度的人工介入。
 *
 *   action='re_verify'      → state 'failed' → 'uploaded'（保留 retry_count 累進歷史不清；
 *                              下輪 cron 會 hit uploaded blocker 重 verify R2 GET + sha）
 *   action='mark_resolved'  → state 'failed' → 'blacklisted'（terminal failure；以後 cron
 *                              不再嘗試。**不代表資料已歸檔**，只表示「admin 已決定放棄
 *                              這個 chunk 不再 retry」。命名取 mark_resolved 是 ops UX，
 *                              audit data / chunk state 都明寫 failed_to_blacklisted。）
 *   action='force_purge'    → ⚠️ **stub only**。回 501 + emit critical event。
 *                              R2 / D1 真正 DELETE 留 PR 2.3 + retention lock 設計補齊。
 *
 * 護欄（user 2026-05-12 拍板）：
 *   - re_verify / mark_resolved UPDATE 必帶完整 target key
 *     (env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256)
 *     + state='failed'；changes !== 1 嚴格判斷 404（chunk 不存在）vs 409（狀態不符）。
 *   - force_purge 第一版完全不碰 R2 / D1 delete。
 *
 * 觀測：每次呼叫都 emit `audit.archive.retry_requested`（info）；成功 emit
 *   `audit.archive.retry_succeeded`；validation / 404 / 409 emit `audit.archive.retry_rejected`
 *   （warn）。admin_audit_log 用 target_id=0 + target_email='chunk:<composite>' 紀錄
 *   admin 身份 / IP / action。
 */

import { res } from '../../../utils/auth.js'
import { requireRole } from '../../../utils/requireRole.js'
import { appendAuditLog } from '../../../utils/audit-log.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes.js'
import { SUPPORTED_COLD_CLASSES, PR20_SUPPORTED_TABLE } from '../../../utils/audit-archive.js'

const VALID_ACTIONS = new Set(['re_verify', 'mark_resolved', 'force_purge'])

// PR 2.2b：target schema 嚴格驗證。所有欄位必填 + 型別正確 + 在白名單。
function validateTarget(t) {
  if (!t || typeof t !== 'object') return 'target object required'
  if (typeof t.env !== 'string' || !t.env)
    return 'target.env required (string)'
  if (t.table_name !== PR20_SUPPORTED_TABLE)
    return `target.table_name must be '${PR20_SUPPORTED_TABLE}'`
  if (typeof t.cold_class !== 'string' || !SUPPORTED_COLD_CLASSES.includes(t.cold_class))
    return 'target.cold_class must be one of 6 supported classes'
  if (typeof t.archive_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.archive_date))
    return 'target.archive_date required (YYYY-MM-DD)'
  if (!Number.isInteger(t.min_id) || t.min_id < 1)
    return 'target.min_id required (positive integer)'
  if (!Number.isInteger(t.max_id) || t.max_id < t.min_id)
    return 'target.max_id required (integer >= min_id)'
  if (typeof t.chunk_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(t.chunk_sha256))
    return 'target.chunk_sha256 required (64-char hex)'
  return null
}

// 組 chunk 複合識別字串給 admin_audit_log.target_email / forensic 用
function chunkIdString(t) {
  return `chunk:${t.env}/${t.table_name}/${t.cold_class}/${t.archive_date}/${t.min_id}-${t.max_id}-${t.chunk_sha256}`
}

async function emitRejected(env, request, ctx, reason) {
  await safeUserAudit(env, {
    event_type: 'audit.archive.retry_rejected',
    severity:   'warn',
    user_id:    ctx.admin_id,
    request,
    data: {
      admin_id:   ctx.admin_id,
      action:     ctx.action ?? null,
      target:     ctx.target ?? null,
      reason,
    },
  })
}

export async function onRequestPost({ request, env }) {
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  // fine-grain scope：re-use admin:audit:write（DELETE audit_log 也走這個）
  if (!effectiveScopesFromJwt(user).has(SCOPES.ADMIN_AUDIT_WRITE)) {
    return res({ error: 'admin:audit:write scope required' }, 403)
  }

  const db = env.chiyigo_db
  if (!db) return res({ error: 'chiyigo_db binding missing' }, 500)

  let body
  try { body = await request.json() } catch { return res({ error: 'invalid JSON body' }, 400) }

  const action = body?.action
  const target = body?.target

  const ctxBase = { admin_id: Number(user.sub), action, target }

  if (!VALID_ACTIONS.has(action)) {
    await emitRejected(env, request, ctxBase, 'invalid_action')
    return res({ error: `action must be one of ${[...VALID_ACTIONS].join(', ')}` }, 400)
  }
  const tgtErr = validateTarget(target)
  if (tgtErr) {
    await emitRejected(env, request, ctxBase, `invalid_target:${tgtErr}`)
    return res({ error: tgtErr }, 400)
  }

  const chunkId = chunkIdString(target)

  // P1-15 對齊既有 admin endpoint：先寫 hash-chain admin_audit_log，失敗即拒絕
  try {
    await appendAuditLog(db, {
      admin_id:     ctxBase.admin_id,
      admin_email:  user.email,
      action:       `audit_archive.retry.${action}`,
      target_id:    0,                  // 非 user 目標：sentinel
      target_email: chunkId,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  // 請求進入動作分派前先 emit retry_requested（成功 / 失敗都已留痕）
  await safeUserAudit(env, {
    event_type: 'audit.archive.retry_requested',
    severity:   'info',
    user_id:    ctxBase.admin_id,
    request,
    data: { admin_id: ctxBase.admin_id, action, target, chunk_id: chunkId },
  })

  if (action === 'force_purge') {
    // PR 2.2b 護欄：force_purge 第一版完全不碰 R2 / D1 delete。
    // R2 retention lock（PR 0.2c）尚未設，現在 DELETE 可動但 lock 後鎖死，
    // 行為差異要等 PR 2.3 補設計 + lock 之前/之後分支邏輯。
    await safeUserAudit(env, {
      event_type: 'audit.archive.force_purge_requested',
      severity:   'critical',
      user_id:    ctxBase.admin_id,
      request,
      data: { admin_id: ctxBase.admin_id, target, chunk_id: chunkId, status: 'not_implemented' },
    })
    return res({
      error:  'force_purge not implemented in PR 2.2b (stub)',
      code:   'NOT_IMPLEMENTED',
      action,
      chunk_id: chunkId,
    }, 501)
  }

  // re_verify / mark_resolved 共享：strict UPDATE failed→<next>
  const nextState = action === 're_verify' ? 'uploaded' : 'blacklisted'
  // re_verify 對 retry_count 不清零（保留歷史）；mark_resolved 也不動 retry_count。
  // 兩者都 bump updated_at。
  const upd = await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = ?, updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND state = 'failed'`
  ).bind(
    nextState,
    target.env, target.table_name, target.cold_class,
    target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
  ).run()

  const changes = upd?.meta?.changes ?? 0
  if (changes === 1) {
    await safeUserAudit(env, {
      event_type: 'audit.archive.retry_succeeded',
      severity:   'info',
      user_id:    ctxBase.admin_id,
      request,
      data: {
        admin_id: ctxBase.admin_id, action, target, chunk_id: chunkId,
        from_state: 'failed',
        to_state:   nextState,
        transition: `failed_to_${nextState}`,
      },
    })
    return res({ ok: true, action, chunk_id: chunkId, from_state: 'failed', to_state: nextState })
  }

  // changes === 0 → 區分 404（無此 chunk）vs 409（狀態不是 failed）
  const probe = await db.prepare(
    `SELECT state FROM audit_archive_chunks
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(
    target.env, target.table_name, target.cold_class,
    target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
  ).first()

  if (!probe) {
    await emitRejected(env, request, ctxBase, 'chunk_not_found')
    return res({ error: 'chunk not found', code: 'CHUNK_NOT_FOUND', chunk_id: chunkId }, 404)
  }
  await emitRejected(env, request, ctxBase, `state_not_failed:${probe.state}`)
  return res({
    error: `chunk state must be 'failed' to ${action}; got '${probe.state}'`,
    code:  'CHUNK_STATE_MISMATCH',
    chunk_id: chunkId,
    actual_state: probe.state,
  }, 409)
}
