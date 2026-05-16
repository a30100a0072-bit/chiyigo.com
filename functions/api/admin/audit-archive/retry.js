/**
 * POST /api/admin/audit-archive/retry
 *
 * Auth（依 action 分兩級；PR 2.2d 把 baseline scope 由 admin:audit:write 拆細）：
 *   - re_verify                  : role>=admin + scope admin:audit_archive:retry
 *     Header: Authorization: Bearer <admin_access_token>
 *   - mark_resolved              : 上述 base 改成 admin:audit_archive:resolve
 *                                  + step-up（elevated:account + for_action='audit_archive_mark_resolved'）
 *   - force_purge                : 上述 base 改成 admin:audit_archive:purge
 *                                  + step-up（for_action='audit_archive_force_purge'）
 *     Header: Authorization: Bearer <step_up_token>
 *   既有 admin / developer / super_admin role 透過 ROLE_BASE_SCOPES 的
 *   admin:audit_archive coarse 自動含全 3 個 fine（向後相容，prod token 不必重簽）。
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
 *   action='force_purge'    → PR 2.3 真實作：R2 chunk + R2 manifest + D1 chunks row
 *                              全刪。要求 chunk state='blacklisted'（mark_resolved 收尾路徑）
 *                              + env AUDIT_ARCHIVE_PURGE_ENABLED='1'（未設回 503 PURGE_DISABLED）。
 *                              **不刪 audit_log raw row**（屬 PR 4 lifecycle，response 帶
 *                              source_rows_deleted:false 顯示分界）。
 *                              retention lock（PR 0.2c）後 R2 DELETE 會 throw → catch
 *                              落 502 + force_purge_failed；lock 上後再細分 423 路徑。
 *
 * 護欄（user 2026-05-12 拍板）：
 *   - re_verify / mark_resolved UPDATE 必帶完整 target key
 *     (env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256)
 *     + state='failed'；changes !== 1 嚴格判斷 404（chunk 不存在）vs 409（狀態不符）。
 *   - force_purge：(1) env flag 未設一律 503 拒絕；(2) state 必須 'blacklisted'；
 *     (3) R2 chunk → R2 manifest → D1 chunks row 順序；(4) audit_log raw 不刪。
 *
 * 觀測：每次呼叫都 emit `audit.archive.retry_requested`（info）；成功 emit
 *   `audit.archive.retry_succeeded`；validation / 404 / 409 emit `audit.archive.retry_rejected`
 *   （warn）。admin_audit_log 用 target_id=0 + target_email='chunk:<composite>' 紀錄
 *   admin 身份 / IP / action。
 */

import { res, requireStepUp } from '../../../utils/auth'
import { requireRole } from '../../../utils/requireRole'
import { appendAuditLog } from '../../../utils/audit-log.js'
import { safeUserAudit } from '../../../utils/user-audit'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
import { SUPPORTED_COLD_CLASSES, PR20_SUPPORTED_TABLE, purgeChunk } from '../../../utils/audit-archive.js'

const VALID_ACTIONS = new Set(['re_verify', 'mark_resolved', 'force_purge'])

// PR 2.2d：per-action fine scope（codex r1 fine-grain 建議落地）。
// 既有 admin/developer/super_admin role 因 ROLE_BASE_SCOPES 含 admin:audit_archive
// coarse，三個 fine 經 SCOPE_HIERARCHY 全展開 → backward compat。
const SCOPE_FOR_ACTION = {
  re_verify:     SCOPES.ADMIN_AUDIT_ARCHIVE_RETRY,
  mark_resolved: SCOPES.ADMIN_AUDIT_ARCHIVE_RESOLVE,
  force_purge:   SCOPES.ADMIN_AUDIT_ARCHIVE_PURGE,
}

// PR 2.2b codex r1（P1）：mark_resolved / force_purge 屬「不可逆 / 高影響面」action，
// 需 step-up（elevated:account + for_action 對應）。re_verify 只是把 chunk 推回 pipeline
// 重新走流程，影響面有限。
const STEP_UP_FOR_ACTION = {
  mark_resolved: 'audit_archive_mark_resolved',
  force_purge:   'audit_archive_force_purge',
}

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
  // 1) Role gate：role >= admin（per-action fine scope 留 action validate 後再驗）
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  const db = env.chiyigo_db
  if (!db) return res({ error: 'chiyigo_db binding missing', code: 'INTERNAL_ERROR' }, 500)

  let body
  try { body = await request.json() } catch { return res({ error: 'invalid JSON body', code: 'INVALID_JSON' }, 400) }

  const action = body?.action
  const target = body?.target

  const ctxBase = { admin_id: Number(user.sub), action, target }

  if (!VALID_ACTIONS.has(action)) {
    await emitRejected(env, request, ctxBase, 'invalid_action')
    return res({ error: `action must be one of ${[...VALID_ACTIONS].join(', ')}`, code: 'INVALID_ACTION' }, 400)
  }

  // PR 2.2d：action 確定後驗 fine scope（讓 invalid_action 走 400 而非 403）
  const requiredScope = SCOPE_FOR_ACTION[action]
  if (!effectiveScopesFromJwt(user).has(requiredScope)) {
    await emitRejected(env, request, ctxBase, `insufficient_scope:${requiredScope}`)
    return res({ error: `${requiredScope} scope required`, code: 'INSUFFICIENT_SCOPE', required: requiredScope }, 403)
  }

  const tgtErr = validateTarget(target)
  if (tgtErr) {
    await emitRejected(env, request, ctxBase, `invalid_target:${tgtErr}`)
    return res({ error: tgtErr, code: 'INVALID_TARGET' }, 400)
  }

  // 2) PR 2.2b codex r1（P1）：mark_resolved / force_purge 加 step-up。
  //    elevated:account 必須在 token claim 內（不接受 admin role fallback），
  //    for_action 必對齊。re_verify 不走此 gate（低影響面，下輪 cron 自動接手）。
  const stepUpAction = STEP_UP_FOR_ACTION[action]
  if (stepUpAction) {
    const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, stepUpAction)
    if (stepCheck.error) {
      await emitRejected(env, request, ctxBase, `step_up_required:${stepUpAction}`)
      return stepCheck.error
    }
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
    // PR 2.3 force_purge 真實作（feedback_force_purge_semantics）：
    //   - 必走 env flag AUDIT_ARCHIVE_PURGE_ENABLED='1' gate；未設回 503 + warn event
    //   - 只刪 R2 chunk + R2 manifest + D1 chunks row；audit_log raw 不刪（留 PR 4）
    //   - chunk 必須 state='blacklisted'（mark_resolved 收尾路徑）
    //   - R2 retention lock（PR 0.2c）尚未設；lock 後 R2 DELETE 會 throw → 落到 catch
    //     回 423 LOCKED，同段 code 涵蓋 pre/post lock 兩個時代
    await safeUserAudit(env, {
      event_type: 'audit.archive.force_purge_requested',
      severity:   'critical',
      user_id:    ctxBase.admin_id,
      request,
      data: { admin_id: ctxBase.admin_id, target, chunk_id: chunkId },
    })

    if (env.AUDIT_ARCHIVE_PURGE_ENABLED !== '1') {
      await safeUserAudit(env, {
        event_type: 'audit.archive.force_purge_disabled',
        severity:   'warn',
        user_id:    ctxBase.admin_id,
        request,
        data: { admin_id: ctxBase.admin_id, target, chunk_id: chunkId },
      })
      return res({
        error:  'force_purge disabled (AUDIT_ARCHIVE_PURGE_ENABLED not set)',
        code:   'PURGE_DISABLED',
        action,
        chunk_id: chunkId,
        archived: false,
        blocks_cursor: true,
        message: 'force_purge requires env AUDIT_ARCHIVE_PURGE_ENABLED=1. Set the secret on the deployment to enable manual R2/chunks-row purge.',
      }, 503)
    }

    try {
      const result = await purgeChunk({ env, db, target })
      if (!result.chunks_row_deleted) {
        // 通常代表 race（select 後狀態被升）— state 不是 blacklisted 了
        await safeUserAudit(env, {
          event_type: 'audit.archive.force_purge_failed',
          severity:   'critical',
          user_id:    ctxBase.admin_id,
          request,
          data: {
            admin_id: ctxBase.admin_id, target, chunk_id: chunkId,
            reason: 'd1_chunks_row_delete_changes_zero',
            data_key: result.data_key, manifest_key: result.manifest_key,
          },
        })
        return res({
          error: 'chunks row delete affected 0 rows (state changed mid-flight?)',
          code:  'CHUNK_DELETE_NO_CHANGES',
          chunk_id: chunkId,
        }, 409)
      }
      await safeUserAudit(env, {
        event_type: 'audit.archive.force_purge_succeeded',
        severity:   'critical',
        user_id:    ctxBase.admin_id,
        request,
        data: {
          admin_id: ctxBase.admin_id, target, chunk_id: chunkId,
          data_key: result.data_key, manifest_key: result.manifest_key,
          source_rows_deleted: false,
          chunks_row_deleted:  true,
        },
      })
      return res({
        ok: true, action, chunk_id: chunkId,
        chunks_row_deleted:  true,
        source_rows_deleted: false,
        data_key:    result.data_key,
        manifest_key: result.manifest_key,
        message: 'R2 chunk + manifest + D1 chunks row deleted. audit_log raw rows are NOT deleted (lifecycle in PR 4).',
      })
    } catch (e) {
      const code = e?.code
      if (code === 'CHUNK_NOT_FOUND') {
        await emitRejected(env, request, ctxBase, 'chunk_not_found')
        return res({ error: 'chunk not found', code: 'CHUNK_NOT_FOUND', chunk_id: chunkId }, 404)
      }
      if (code === 'CHUNK_STATE_MISMATCH') {
        await emitRejected(env, request, ctxBase, `state_not_blacklisted:${e.actualState}`)
        return res({
          error: `chunk state must be 'blacklisted' to force_purge; got '${e.actualState}' (use mark_resolved first)`,
          code:  'CHUNK_STATE_MISMATCH',
          chunk_id: chunkId,
          actual_state: e.actualState,
        }, 409)
      }
      // R2 SDK / D1 throw — 含未來 retention lock 的 403/409 路徑（lock 上後再加 423 分支）
      const msg = String(e?.message ?? e)
      await safeUserAudit(env, {
        event_type: 'audit.archive.force_purge_failed',
        severity:   'critical',
        user_id:    ctxBase.admin_id,
        request,
        data: {
          admin_id: ctxBase.admin_id, target, chunk_id: chunkId,
          reason: 'r2_or_d1_exception',
          error:  msg,
        },
      })
      return res({
        error: 'force_purge failed during R2 / D1 operation',
        code:  'FORCE_PURGE_FAILED',
        chunk_id: chunkId,
        detail: msg,
      }, 502)
    }
  }

  // re_verify / mark_resolved 共享：strict UPDATE failed→<next>
  //   - re_verify    : state→'uploaded'；保留 retry_count / last_failure（歷史不抹）
  //   - mark_resolved: state→'blacklisted' + 同步寫 blacklisted_at（PR 2.2b codex r1
  //                    P3：schema 有此欄 + index，後續 ops 用 blacklisted_at IS NOT NULL
  //                    篩人工黑名單若不寫會漏）+ last_failure='admin_mark_resolved' /
  //                    last_failure_at（forensic：留下「管理員介入，不是 worker 失敗」標記）
  const nextState = action === 're_verify' ? 'uploaded' : 'blacklisted'
  const stmt = nextState === 'blacklisted'
    ? db.prepare(
        `UPDATE audit_archive_chunks
            SET state = 'blacklisted',
                blacklisted_at = datetime('now'),
                last_failure = 'admin_mark_resolved',
                last_failure_at = datetime('now'),
                updated_at = datetime('now')
          WHERE env = ? AND table_name = ? AND cold_class = ?
            AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
            AND state = 'failed'`
      ).bind(
        target.env, target.table_name, target.cold_class,
        target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
      )
    : db.prepare(
        `UPDATE audit_archive_chunks
            SET state = 'uploaded', updated_at = datetime('now')
          WHERE env = ? AND table_name = ? AND cold_class = ?
            AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
            AND state = 'failed'`
      ).bind(
        target.env, target.table_name, target.cold_class,
        target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
      )

  const upd = await stmt.run()
  const changes = upd?.meta?.changes ?? 0
  if (changes === 1) {
    // PR 2.2b codex r1（P2）：response/audit 明寫此 action **不代表已歸檔**，cron
    // cursor 仍會被卡住（blacklisted / uploaded 都在 NON_TERMINAL_STATES）。
    //   - mark_resolved：chunk 永遠卡 blacklisted，**整條 cold_class cursor 不前進**，
    //     直到 PR 2.3 force_purge 真實作能把它從 chunks 表移除。
    //   - re_verify   ：chunk 進 uploaded，下輪 cron 會嘗試 R2 GET+verify，
    //     pipeline 重新走，**cursor 暫時仍卡此 chunk** 直到驗證通過。
    const archivedFalseInfo = nextState === 'blacklisted'
      ? {
          archived: false,
          blocks_cursor: true,
          message: 'Chunk marked blacklisted. Data is NOT archived to R2. Pipeline cursor for this cold_class remains blocked at this chunk until force_purge (PR 2.3) removes it.',
        }
      : {
          archived: false,
          blocks_cursor: true,
          message: 'Chunk reset to uploaded; next cron will retry R2 GET + sha verification. Cursor remains blocked at this chunk until it advances to a terminal state.',
        }
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
        ...archivedFalseInfo,
      },
    })
    return res({
      ok: true, action, chunk_id: chunkId,
      from_state: 'failed', to_state: nextState,
      ...archivedFalseInfo,
    })
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
