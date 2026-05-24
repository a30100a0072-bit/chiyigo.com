/**
 * POST /api/admin/audit-aggregate-archive/retry
 *
 * F-3 Phase 2 PR 3.3 — admin retry endpoint for aggregate archive chunks
 * (mirror PR 2.2b/2.3 raw retry.ts；差異見「設計差異」段)
 *
 * Auth（reuse PR 2.2d 既有 admin:audit_archive:* fine scopes — aggregate ops 與 raw
 * ops 同 admin role 操作、blast radius 同級，不再切第二組 scope；step-up for_action
 * 改用 audit_aggregate_archive_* 區分 anti-replay 域）：
 *   - re_verify     : role>=admin + scope admin:audit_archive:retry
 *   - mark_resolved : 上述 + scope admin:audit_archive:resolve
 *                     + step-up（elevated:account + for_action='audit_aggregate_archive_mark_resolved'）
 *   - force_purge   : 上述 + scope admin:audit_archive:purge
 *                     + step-up（for_action='audit_aggregate_archive_force_purge'）
 *
 * Actions：
 *   re_verify
 *     state 'failed' → 'uploaded'（與 raw 同；下輪 cron 接 R2 GET+verify pipeline）
 *
 *   mark_resolved
 *     - state 'failed' → 'blacklisted'（raw mirror；terminal failure 路徑）
 *     - state 'verified' AND dry_run=1 → 'blacklisted'（PR 3.3 special transition：
 *       解 codex r2 H-1 場景。dry-run verified chunk 卡住、live 無法 rerun，admin
 *       人工把 dry-run chunk mark_resolved → blacklisted 後 force_purge，同日切 live
 *       才能進。invariant：aggregate row archived_at IS NULL — 若已 NOT NULL 代表
 *       前段 invariant 已破，critical reject 不自動修，operator 走獨立 repair 流程）
 *     - state 'verified' AND dry_run=0 → 409 LIVE_VERIFIED_NOT_BLACKLISTABLE
 *       （live verified 應走 resume / marked_archived，不該進 blacklisted；user
 *       2026-05-14 拍板：deletion invariant 不可被繞過）
 *     - 其他 state → 409 with actual state
 *
 *   force_purge
 *     env AUDIT_AGGREGATE_PURGE_ENABLED='1' gate（與 raw AUDIT_ARCHIVE_PURGE_ENABLED
 *     分開：aggregate / raw 兩個 force_purge 路徑各自 enable，避免 raw 動作開了
 *     aggregate 也跟著開）。state 必 'blacklisted'。
 *     呼叫 purgeAggregateChunk（**不共用 raw purgeChunk**：prefix derive 不同；
 *     見 audit-aggregate-archive#purgeAggregateChunk header）。
 *
 * 護欄（user + codex 2026-05-14 拍板）：
 *   - target 必含 dry_run flag（boolean）— 所有 SELECT / UPDATE / DELETE 都 AND
 *     dry_run=? expected guard，防 operator 以為刪 dry-run 實際刪到 live。
 *   - whitelist：table_name ∈ {audit_log_aggregate_telemetry, audit_log_aggregate_debug}
 *     + cold_class 必對齊（telemetry↔telemetry / debug↔debug）；不允許 raw audit_log
 *     或 raw 6 class 從此 endpoint 進來（避免新 endpoint 變跨系統刪除面）。
 *   - reason_code + operator_reason 兩欄必填：reason_code 機器可 grep
 *     （如 'dry_run_collision_cleanup'），operator_reason 人寫 10-500 char。
 *   - mark_resolved 用 atomic 單條 UPDATE WHERE ... AND state=? AND dry_run=? +
 *     changes()===1 判斷，不走 SELECT-then-UPDATE TOCTOU。
 *   - dry-run verified → blacklisted 額外加 NOT EXISTS aggregate row archived_at
 *     檢查 — 違反即 fail-fast critical（feedback_stepup_atomic_consume 風格）。
 *
 * 設計差異 vs raw retry.ts：
 *   1. target 多帶 dry_run flag（raw 不要求；aggregate dry_run / live 混存同一表）
 *   2. table_name + cold_class 白名單只認 aggregate 兩組（raw 認 audit_log + 6 class）
 *   3. mark_resolved 多 dry_run=1 verified→blacklisted special transition
 *   4. force_purge env flag 用 AUDIT_AGGREGATE_PURGE_ENABLED（與 raw 分開）
 *   5. force_purge 呼叫 purgeAggregateChunk（用 deriveAggregateKeysFromChunk）
 *   6. emit event_type 前綴 audit.aggregate_archive.{telemetry|debug}.* 而非
 *      audit.archive.*；class 由 target.cold_class 決定，forensic 可一眼判別
 *
 * 觀測：每次呼叫都 emit `audit.aggregate_archive.{class}.retry_requested`（info）；
 *   成功 emit `.retry_succeeded`；validation / 404 / 409 emit `.retry_rejected`（warn）。
 *   force_purge 對應 .force_purge_{requested|succeeded|failed|disabled}。
 *   admin_audit_log 用 target_id=0 + target_email='aggregate_chunk:<composite>' 紀錄。
 */

import { res, requireStepUp } from '../../../utils/auth'
import { requireRole } from '../../../utils/requireRole'
import { appendAuditLog } from '../../../utils/audit-log'
import { safeUserAudit } from '../../../utils/user-audit'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
import {
  AGGREGATE_TABLES,
  purgeAggregateChunk,
} from '../../../utils/audit-aggregate-archive'

const VALID_ACTIONS = new Set(['re_verify', 'mark_resolved', 'force_purge'])

// Reuse raw audit_archive 三 fine scope（同 admin role 操作；不切第二組）
const SCOPE_FOR_ACTION = {
  re_verify:     SCOPES.ADMIN_AUDIT_ARCHIVE_RETRY,
  mark_resolved: SCOPES.ADMIN_AUDIT_ARCHIVE_RESOLVE,
  force_purge:   SCOPES.ADMIN_AUDIT_ARCHIVE_PURGE,
}

// step-up for_action 改 aggregate 專屬 — anti-replay 域與 raw 分開（同 token 不能
// 在 raw force_purge 與 aggregate force_purge 兩邊互用）
const STEP_UP_FOR_ACTION = {
  mark_resolved: 'audit_aggregate_archive_mark_resolved',
  force_purge:   'audit_aggregate_archive_force_purge',
}

// reason_code 白名單（machine grep）。新增動機時補進此 set，避免 free text drift。
const VALID_REASON_CODES = new Set([
  'dry_run_collision_cleanup',     // r2 H-1 場景：dry-run chunk 卡住，清空切 live
  'r2_object_corrupt',             // R2 物件壞掉（sha mismatch / decompress fail）
  'manual_cleanup',                // 其他人工清理（operator 自寫 reason 補細節）
  'rerun_after_schema_change',     // schema migration 後重跑 archive
  'forensic_quarantine',           // forensic 暫存後拉出回 pipeline
])

// 白名單：合法 (table_name, cold_class) 對。AGGREGATE_TABLES 是 table→cold_class map
const VALID_PAIRS = new Set(
  Object.entries(AGGREGATE_TABLES).map(([t, c]) => `${t}|${c}`)
)

function classForColdClass(cold_class) {
  // cold_class 'aggregate_telemetry' → emit prefix segment 'telemetry'；'aggregate_debug' → 'debug'
  return cold_class === 'aggregate_telemetry' ? 'telemetry'
       : cold_class === 'aggregate_debug'     ? 'debug'
       : null
}

function validateTarget(t) {
  if (!t || typeof t !== 'object') return 'target object required'
  if (typeof t.env !== 'string' || !t.env)
    return 'target.env required (string)'
  if (typeof t.table_name !== 'string')
    return 'target.table_name required (string)'
  if (typeof t.cold_class !== 'string')
    return 'target.cold_class required (string)'
  if (!VALID_PAIRS.has(`${t.table_name}|${t.cold_class}`))
    return `target.(table_name, cold_class) must be one of aggregate pairs: ${[...VALID_PAIRS].join(', ')}`
  if (typeof t.archive_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.archive_date))
    return 'target.archive_date required (YYYY-MM-DD)'
  if (!Number.isInteger(t.min_id) || t.min_id < 1)
    return 'target.min_id required (positive integer)'
  if (!Number.isInteger(t.max_id) || t.max_id < t.min_id)
    return 'target.max_id required (integer >= min_id)'
  if (typeof t.chunk_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(t.chunk_sha256))
    return 'target.chunk_sha256 required (64-char hex)'
  if (typeof t.dry_run !== 'boolean')
    return 'target.dry_run required (boolean; aggregate chunks 表 dry_run / live 混存，必明確指定)'
  return null
}

function validateReason(body) {
  const rc = body?.reason_code
  const or = body?.operator_reason
  if (typeof rc !== 'string' || !VALID_REASON_CODES.has(rc))
    return `reason_code required (machine grep); valid: ${[...VALID_REASON_CODES].join(', ')}`
  if (typeof or !== 'string') return 'operator_reason required (string)'
  const len = or.trim().length
  if (len < 10 || len > 500)
    return `operator_reason length must be 10..500 (got ${len})`
  return null
}

function chunkIdString(t) {
  return `aggregate_chunk:${t.env}/${t.table_name}/${t.cold_class}/${t.archive_date}/${t.min_id}-${t.max_id}-${t.chunk_sha256}/dry_run=${t.dry_run ? 1 : 0}`
}

async function emitRejected(env, request, ctx, reason) {
  const cls = classForColdClass(ctx.target?.cold_class)
  // 若 cold_class 不合法（pre-validate 階段），cls 會是 null — emit 不該 fail 整個流程，
  // fallback 一個 generic prefix 仍寫 audit（與 raw retry.ts policy 一致）
  const evt = cls
    ? `audit.aggregate_archive.${cls}.retry_rejected`
    : 'audit.aggregate_archive.telemetry.retry_rejected' // safe default; reason 會說明
  await safeUserAudit(env, {
    event_type: evt,
    severity:   'warn',
    user_id:    ctx.admin_id,
    request,
    data: {
      admin_id:        ctx.admin_id,
      action:          ctx.action ?? null,
      target:          ctx.target ?? null,
      reason,
      reason_code:     ctx.reason_code ?? null,
      operator_reason: ctx.operator_reason ?? null,
    },
  })
}

export async function onRequestPost({ request, env }) {
  // 1) Role gate
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  const db = env.chiyigo_db
  if (!db) return res({ error: 'chiyigo_db binding missing', code: 'INTERNAL_ERROR' }, 500)

  let body
  try { body = await request.json() } catch { return res({ error: 'invalid JSON body', code: 'INVALID_JSON' }, 400) }

  const action          = body?.action
  const target          = body?.target
  const reason_code     = body?.reason_code
  const operator_reason = body?.operator_reason

  const ctxBase = {
    admin_id: Number(user.sub),
    action, target, reason_code, operator_reason,
  }

  if (!VALID_ACTIONS.has(action)) {
    await emitRejected(env, request, ctxBase, 'invalid_action')
    return res({ error: `action must be one of ${[...VALID_ACTIONS].join(', ')}`, code: 'INVALID_ACTION' }, 400)
  }

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

  const rsnErr = validateReason(body)
  if (rsnErr) {
    await emitRejected(env, request, ctxBase, `invalid_reason:${rsnErr}`)
    return res({ error: rsnErr, code: 'INVALID_REASON' }, 400)
  }

  // 2) step-up（mark_resolved / force_purge 走；re_verify 不走）
  const stepUpAction = STEP_UP_FOR_ACTION[action]
  if (stepUpAction) {
    const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, stepUpAction)
    if (stepCheck.error) {
      await emitRejected(env, request, ctxBase, `step_up_required:${stepUpAction}`)
      return stepCheck.error
    }
  }

  const cls           = classForColdClass(target.cold_class)
  const chunkId       = chunkIdString(target)
  const expectedDryRunInt = target.dry_run ? 1 : 0

  // 3) admin_audit_log hash chain — 失敗即拒絕
  try {
    await appendAuditLog(db, {
      admin_id:     ctxBase.admin_id,
      admin_email:  user.email,
      action:       `audit_aggregate_archive.retry.${action}`,
      target_id:    0,
      target_email: chunkId,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  // 4) emit retry_requested（成功 / 失敗都已留痕）
  await safeUserAudit(env, {
    event_type: `audit.aggregate_archive.${cls}.retry_requested`,
    severity:   'info',
    user_id:    ctxBase.admin_id,
    request,
    data: {
      admin_id: ctxBase.admin_id, action, target, chunk_id: chunkId,
      reason_code, operator_reason,
    },
  })

  // ── force_purge ──────────────────────────────────────────────
  if (action === 'force_purge') {
    await safeUserAudit(env, {
      event_type: `audit.aggregate_archive.${cls}.force_purge_requested`,
      severity:   'critical',
      user_id:    ctxBase.admin_id,
      request,
      data: { admin_id: ctxBase.admin_id, target, chunk_id: chunkId, reason_code, operator_reason },
    })

    if (env.AUDIT_AGGREGATE_PURGE_ENABLED !== '1') {
      await safeUserAudit(env, {
        event_type: `audit.aggregate_archive.${cls}.force_purge_disabled`,
        severity:   'warn',
        user_id:    ctxBase.admin_id,
        request,
        data: { admin_id: ctxBase.admin_id, target, chunk_id: chunkId, reason_code, operator_reason },
      })
      return res({
        error:  'force_purge disabled (AUDIT_AGGREGATE_PURGE_ENABLED not set)',
        code:   'PURGE_DISABLED',
        action, chunk_id: chunkId,
        message: 'aggregate force_purge requires env AUDIT_AGGREGATE_PURGE_ENABLED=1. Set the secret on the deployment to enable manual R2/chunks-row purge for aggregate chunks.',
      }, 503)
    }

    try {
      const result = await purgeAggregateChunk({ env, db, target })
      if (!result.chunks_row_deleted) {
        await safeUserAudit(env, {
          event_type: `audit.aggregate_archive.${cls}.force_purge_failed`,
          severity:   'critical',
          user_id:    ctxBase.admin_id,
          request,
          data: {
            admin_id: ctxBase.admin_id, target, chunk_id: chunkId, reason_code, operator_reason,
            reason: 'd1_chunks_row_delete_changes_zero',
            data_key: result.data_key, manifest_key: result.manifest_key,
            // codex r1 P0 follow-up：surface manifest_keys + key_scheme 給 forensic
            //   key_scheme=2 → manifest_keys 含 4 把 .{state}.json；key_scheme=1 → 1 把 .json
            manifest_keys: result.manifest_keys, key_scheme: result.key_scheme,
          },
        })
        return res({
          error: 'chunks row delete affected 0 rows (state changed mid-flight?)',
          code:  'CHUNK_DELETE_NO_CHANGES',
          chunk_id: chunkId,
        }, 409)
      }
      await safeUserAudit(env, {
        event_type: `audit.aggregate_archive.${cls}.force_purge_succeeded`,
        severity:   'critical',
        user_id:    ctxBase.admin_id,
        request,
        data: {
          admin_id: ctxBase.admin_id, target, chunk_id: chunkId, reason_code, operator_reason,
          data_key: result.data_key, manifest_key: result.manifest_key,
          // codex r1 P0 follow-up：surface manifest_keys + key_scheme 給 forensic
          //   key_scheme=2 → manifest_keys 含 4 把 .{state}.json；key_scheme=1 → 1 把 .json
          manifest_keys: result.manifest_keys, key_scheme: result.key_scheme,
          source_rows_deleted: false, chunks_row_deleted: true,
        },
      })
      return res({
        ok: true, action, chunk_id: chunkId,
        chunks_row_deleted:  true,
        source_rows_deleted: false,
        data_key:    result.data_key,
        manifest_key: result.manifest_key,
        // codex r1 P0 follow-up：HTTP response 也回 manifest_keys + key_scheme
        manifest_keys: result.manifest_keys,
        key_scheme:    result.key_scheme,
        message: 'R2 aggregate chunk + manifest + D1 chunks row deleted. aggregate source rows are NOT deleted (lifecycle in PR 4).',
      })
    } catch (e) {
      const code = e?.code
      if (code === 'CHUNK_NOT_FOUND') {
        await emitRejected(env, request, ctxBase, 'chunk_not_found')
        return res({ error: 'chunk not found', code: 'CHUNK_NOT_FOUND', chunk_id: chunkId }, 404)
      }
      if (code === 'DRY_RUN_MISMATCH') {
        await emitRejected(env, request, ctxBase, `dry_run_mismatch:expected=${e.expectedDryRun},actual=${e.actualDryRun}`)
        return res({
          error: `target.dry_run=${e.expectedDryRun} but chunk row dry_run=${e.actualDryRun}; refuse to operate (avoid silent dry-run/live cross-purge)`,
          code:  'DRY_RUN_MISMATCH',
          chunk_id: chunkId,
          expected_dry_run: e.expectedDryRun,
          actual_dry_run:   e.actualDryRun,
        }, 409)
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
      const msg = String(e?.message ?? e)
      await safeUserAudit(env, {
        event_type: `audit.aggregate_archive.${cls}.force_purge_failed`,
        severity:   'critical',
        user_id:    ctxBase.admin_id,
        request,
        data: {
          admin_id: ctxBase.admin_id, target, chunk_id: chunkId, reason_code, operator_reason,
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

  // ── re_verify / mark_resolved ────────────────────────────────
  if (action === 're_verify') {
    const upd = await db.prepare(
      `UPDATE audit_archive_chunks
          SET state = 'uploaded', updated_at = datetime('now')
        WHERE env = ? AND table_name = ? AND cold_class = ?
          AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
          AND dry_run = ? AND state = 'failed'`
    ).bind(
      target.env, target.table_name, target.cold_class,
      target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
      expectedDryRunInt,
    ).run()
    return handleNonForcePurgeResult(env, db, request, ctxBase, action, target, cls, chunkId, upd, 'failed', 'uploaded', expectedDryRunInt)
  }

  // mark_resolved（PR 3.3 r1 codex P2-2 後重排）：
  //   Path A → probe → dry_run / state 驗 → archived_at invariant（只對 dry-run verified）→ Path B
  // 重排原因：原版先跑 archived_at invariant 才 probe，導致 chunk 不存在 / dry_run mismatch /
  // state 不對的場景下，若 id range 剛好夾雜 archived aggregate row，會誤報 INTEGRITY_BREACH
  // critical（應該回 404 / 409）。新版確認 chunk 真實狀態後才做 invariant check。

  // Path A：failed → blacklisted（任意 dry_run；mirror raw mark_resolved 語意）
  const updA = await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'blacklisted',
            blacklisted_at = datetime('now'),
            last_failure = 'admin_mark_resolved',
            last_failure_at = datetime('now'),
            updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND dry_run = ? AND state = 'failed'`
  ).bind(
    target.env, target.table_name, target.cold_class,
    target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
    expectedDryRunInt,
  ).run()
  if ((updA?.meta?.changes ?? 0) === 1) {
    return await emitSucceededAndRespond(env, request, ctxBase, action, target, cls, chunkId, 'failed', 'blacklisted', 'failed_to_blacklisted')
  }

  // Path A 0 changes → probe 區分後續路徑（404 / dry_run mismatch / state mismatch / Path B 候選）
  const probe = await db.prepare(
    `SELECT state, dry_run FROM audit_archive_chunks
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(
    target.env, target.table_name, target.cold_class,
    target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
  ).first()

  if (!probe) {
    await emitRejected(env, request, ctxBase, 'chunk_not_found')
    return res({ error: 'aggregate chunk not found', code: 'CHUNK_NOT_FOUND', chunk_id: chunkId }, 404)
  }
  const actualDryRunInt = probe.dry_run === 1 || probe.dry_run === true ? 1 : 0
  if (actualDryRunInt !== expectedDryRunInt) {
    await emitRejected(env, request, ctxBase, `dry_run_mismatch:expected=${expectedDryRunInt},actual=${actualDryRunInt}`)
    return res({
      error: `target.dry_run=${expectedDryRunInt} but chunk row dry_run=${actualDryRunInt}; refuse to operate`,
      code:  'DRY_RUN_MISMATCH',
      chunk_id: chunkId,
      expected_dry_run: expectedDryRunInt,
      actual_dry_run:   actualDryRunInt,
    }, 409)
  }
  // live verified mark_resolved 拒絕（user 2026-05-14 拍板：live verified 不該進 blacklisted）
  if (probe.state === 'verified' && actualDryRunInt === 0) {
    await emitRejected(env, request, ctxBase, 'live_verified_not_blacklistable')
    return res({
      error: 'live verified chunk cannot be mark_resolved to blacklisted (use cron resume or wait for marked_archived); only dry_run=1 verified is allowed this path',
      code:  'LIVE_VERIFIED_NOT_BLACKLISTABLE',
      chunk_id: chunkId,
      actual_state: probe.state,
      actual_dry_run: actualDryRunInt,
    }, 409)
  }

  // Path B：dry-run verified → blacklisted（PR 3.3 special；解 codex r2 H-1 場景）
  // 額外 invariant：對應的 aggregate row 必須 archived_at IS NULL；違反 → critical reject。
  // PR 3.3 r1 codex P2-2：此 invariant check 必須在 probe 確認 dry_run=1+verified 後才跑，
  // 否則 chunk 不存在 / dry_run mismatch / state 不對的場景下，id range 夾雜 archived
  // aggregate row 會誤報 INTEGRITY_BREACH critical（應該回 404 / 409）。
  if (probe.state === 'verified' && actualDryRunInt === 1) {
    const archivedConflict = await db.prepare(
      `SELECT COUNT(*) AS n FROM ${target.table_name}
        WHERE id BETWEEN ? AND ? AND archived_at IS NOT NULL`
    ).bind(target.min_id, target.max_id).first()
    if ((archivedConflict?.n ?? 0) > 0) {
      await safeUserAudit(env, {
        event_type: `audit.aggregate_archive.${cls}.retry_rejected`,
        severity:   'critical',
        user_id:    ctxBase.admin_id,
        request,
        data: {
          admin_id: ctxBase.admin_id, action, target, chunk_id: chunkId,
          reason_code, operator_reason,
          reason: 'integrity_breach_dry_run_chunk_with_archived_aggregate_rows',
          archived_row_count: archivedConflict.n,
          remediation: 'manual_repair_required (dry-run chunk references aggregate rows already marked archived; codex r2 H-1 invariant broken — investigate before retry)',
        },
      })
      return res({
        error: 'integrity_breach: dry-run chunk references aggregate rows with archived_at NOT NULL (codex r2 H-1 invariant)',
        code:  'INTEGRITY_BREACH',
        chunk_id: chunkId,
        archived_row_count: archivedConflict.n,
        remediation: 'manual repair required; do NOT auto-clear archived_at',
      }, 409)
    }
    const updB = await db.prepare(
      `UPDATE audit_archive_chunks
          SET state = 'blacklisted',
              blacklisted_at = datetime('now'),
              last_failure = 'admin_mark_resolved_dry_run_collision',
              last_failure_at = datetime('now'),
              updated_at = datetime('now')
        WHERE env = ? AND table_name = ? AND cold_class = ?
          AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
          AND dry_run = 1 AND state = 'verified'`
    ).bind(
      target.env, target.table_name, target.cold_class,
      target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
    ).run()
    if ((updB?.meta?.changes ?? 0) === 1) {
      return await emitSucceededAndRespond(env, request, ctxBase, action, target, cls, chunkId, 'verified', 'blacklisted', 'dry_run_verified_to_blacklisted')
    }
    // changes===0 = probe 後 state 競爭被改（極罕見；admin parallel call）→ 409 conflict
    await emitRejected(env, request, ctxBase, 'state_changed_after_probe')
    return res({
      error: 'chunk state changed between probe and UPDATE (concurrent admin call?)',
      code:  'CHUNK_STATE_CHANGED',
      chunk_id: chunkId,
    }, 409)
  }

  await emitRejected(env, request, ctxBase, `state_not_eligible:${probe.state}`)
  return res({
    error: `chunk state '${probe.state}' is not eligible for ${action}; mark_resolved requires state='failed' or (dry_run=1 AND state='verified')`,
    code:  'CHUNK_STATE_MISMATCH',
    chunk_id: chunkId,
    actual_state: probe.state,
    actual_dry_run: actualDryRunInt,
  }, 409)
}

// shared: re_verify happy / fail dispatch（單 transition：failed→uploaded）
async function handleNonForcePurgeResult(env, db, request, ctxBase, action, target, cls, chunkId, upd, fromState, toState, expectedDryRunInt) {
  const changes = upd?.meta?.changes ?? 0
  if (changes === 1) {
    return await emitSucceededAndRespond(env, request, ctxBase, action, target, cls, chunkId, fromState, toState, `${fromState}_to_${toState}`)
  }
  const probe = await db.prepare(
    `SELECT state, dry_run FROM audit_archive_chunks
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(
    target.env, target.table_name, target.cold_class,
    target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
  ).first()
  if (!probe) {
    await emitRejected(env, request, ctxBase, 'chunk_not_found')
    return res({ error: 'aggregate chunk not found', code: 'CHUNK_NOT_FOUND', chunk_id: chunkId }, 404)
  }
  const actualDryRunInt = probe.dry_run === 1 || probe.dry_run === true ? 1 : 0
  if (actualDryRunInt !== expectedDryRunInt) {
    await emitRejected(env, request, ctxBase, `dry_run_mismatch:expected=${expectedDryRunInt},actual=${actualDryRunInt}`)
    return res({
      error: `target.dry_run=${expectedDryRunInt} but chunk row dry_run=${actualDryRunInt}; refuse to operate`,
      code:  'DRY_RUN_MISMATCH',
      chunk_id: chunkId,
      expected_dry_run: expectedDryRunInt,
      actual_dry_run:   actualDryRunInt,
    }, 409)
  }
  await emitRejected(env, request, ctxBase, `state_not_${fromState}:${probe.state}`)
  return res({
    error: `chunk state must be '${fromState}' to ${action}; got '${probe.state}'`,
    code:  'CHUNK_STATE_MISMATCH',
    chunk_id: chunkId,
    actual_state: probe.state,
  }, 409)
}

async function emitSucceededAndRespond(env, request, ctxBase, action, target, cls, chunkId, fromState, toState, transition) {
  const info = {
    archived: false,
    blocks_cursor: true,
    message: toState === 'blacklisted'
      ? `Aggregate chunk marked blacklisted (transition ${transition}). Data is NOT archived to R2 (or for dry-run path, R2 object still present until force_purge). Cron cursor remains blocked until force_purge (PR 3.3) removes it.`
      : `Aggregate chunk reset to '${toState}'; next cron will retry pipeline. Cursor remains blocked at this chunk until terminal state.`,
  }
  await safeUserAudit(env, {
    event_type: `audit.aggregate_archive.${cls}.retry_succeeded`,
    severity:   'info',
    user_id:    ctxBase.admin_id,
    request,
    data: {
      admin_id: ctxBase.admin_id, action, target, chunk_id: chunkId,
      reason_code:     ctxBase.reason_code,
      operator_reason: ctxBase.operator_reason,
      from_state: fromState,
      to_state:   toState,
      transition,
      ...info,
    },
  })
  return res({
    ok: true, action, chunk_id: chunkId,
    from_state: fromState, to_state: toState,
    transition,
    ...info,
  })
}
