/**
 * GET /api/admin/audit
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * Phase B / B5 — User-level audit log query
 *
 * 查詢 audit_log 表（一般 user 端事件，與 admin_audit_log 分離）。
 *
 * 查詢參數（皆 optional）：
 *  user_id     — 過濾特定 user
 *  event_type  — 完全相符（例：'auth.login.fail'）
 *  severity    — 'info' | 'warn' | 'critical'
 *  from        — ISO datetime（含）
 *  to          — ISO datetime（不含）
 *  page        — 預設 1
 *  limit       — 預設 50，上限 200
 *
 * 回傳：
 *  200 → { rows, total, page, limit }
 *  401 / 403 → 未授權 / 角色不足
 *
 * Step-up 鎖：未來 Phase C 上線後再要求 step_up_token；目前只 requireRole admin。
 */

import { res, requireAnyScope } from '../../utils/auth'
import { SCOPES } from '../../utils/scopes'
import { canRoleSeeAuditEvent } from '../../utils/roles'
import { safeUserAudit } from '../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'

const VALID_SEVERITY = new Set(['info', 'warn', 'critical'])

// P2-6：event_data 內 PII 欄位白名單裁切（避免 admin 透過 audit GET 撈整批用戶 IP / email / OTP 等）
// 規則：只回收以下安全欄位；其他統一替換為 [redacted:N keys]，需要時走 admin/audit/:id 讀單筆才回原值（後續 RFP）。
const SAFE_EVENT_DATA_KEYS = new Set([
  'reason_code', 'trace_id', 'event_id', 'severity_hint',
  'admin_id', 'admin_user_id', 'target_email_domain',
  'scope', 'for_action', 'mode', 'method', 'status_code',
  'amount_subunit', 'currency', 'vendor', 'intent_id', 'requisition_id',
  'refund_request_id', 'rtn_code', 'rtn_msg',
  'count', 'result_count', 'filters', 'endpoint',
  'kind', 'severity', 'reason',
])

function redactEventData(raw) {
  if (raw == null) return null
  let parsed
  try { parsed = JSON.parse(String(raw)) }
  catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const out = {}
  let redactedCount = 0
  for (const [k, v] of Object.entries(parsed)) {
    if (SAFE_EVENT_DATA_KEYS.has(k)) out[k] = v
    else redactedCount++
  }
  if (redactedCount) out._redacted_keys = redactedCount
  return out
}

export async function onRequestGet({ request, env }) {
  // P1-17 Phase 3: GET 同時接受 read 或 write（write token 也能 GET）
  const { user, error } = await requireAnyScope(request, env, SCOPES.ADMIN_AUDIT_READ, SCOPES.ADMIN_AUDIT_WRITE)
  if (error) return error

  // P2-6：套上 admin_read rate limit（與 deals / payments/intents 對齊 60/min）
  const adminId = Number(user.sub)
  const rl = await checkRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId, windowSeconds: 60, max: 60 })
  if (rl.blocked) {
    await safeUserAudit(env, { event_type: 'admin.read.rate_limited', severity: 'warn', user_id: adminId, request, data: { endpoint: 'audit' } })
    return res({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId })

  const url   = new URL(request.url)
  const page  = Math.max(1, parseInt(url.searchParams.get('page')  ?? '1',  10))
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const offset = (page - 1) * limit

  const conds   = []
  const binds   = []

  const userId = url.searchParams.get('user_id')
  if (userId) {
    const n = Number(userId)
    if (!Number.isFinite(n)) return res({ error: 'user_id must be a number', code: 'USER_ID_INVALID' }, 400)
    conds.push('user_id = ?'); binds.push(n)
  }

  const eventType = url.searchParams.get('event_type')
  if (eventType) {
    conds.push('event_type = ?'); binds.push(eventType)
  }

  const severity = url.searchParams.get('severity')
  if (severity) {
    if (!VALID_SEVERITY.has(severity))
      return res({ error: 'severity must be info | warn | critical', code: 'INVALID_SEVERITY' }, 400)
    conds.push('severity = ?'); binds.push(severity)
  }

  // P2-6：from/to ISO 8601 驗證（與 admin/payments 對齊）
  const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
  const from = url.searchParams.get('from')
  if (from) {
    if (!ISO_RE.test(from)) return res({ error: 'from must be ISO 8601 date/datetime', code: 'FROM_DATE_INVALID' }, 400)
    conds.push("created_at >= ?"); binds.push(from)
  }
  const to = url.searchParams.get('to')
  if (to)   {
    if (!ISO_RE.test(to)) return res({ error: 'to must be ISO 8601 date/datetime', code: 'TO_DATE_INVALID' }, 400)
    conds.push("created_at <  ?"); binds.push(to)
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const db    = env.chiyigo_db

  const [countRow, rowsResult] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM audit_log ${where}`).bind(...binds).first(),
    db.prepare(`
      SELECT id, event_type, severity, user_id, client_id, ip_hash, event_data, created_at
      FROM audit_log
      ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `).bind(...binds, limit, offset).all(),
  ])

  // P2-6：每列 event_data 走白名單裁切，避免 PII 直回
  const rawRows = rowsResult?.results ?? []
  // P1-17 Phase 2 latent：support role 額外按 event_type 前綴白/黑名單裁切，
  // 避免客服看到 risk engine internals / role 變更等敏感事件。super_admin /
  // admin / developer / finance 走 canRoleSeeAuditEvent 全 true（no-op）。
  const filteredRows = rawRows.filter(r => canRoleSeeAuditEvent(r.event_type, user.role))
  const rows = filteredRows.map(r => ({ ...r, event_data: redactEventData(r.event_data) }))

  // P2-6：寫 admin.audit.read audit（含 result_count + filters）
  await safeUserAudit(env, {
    event_type: 'admin.audit.read', severity: 'info',
    user_id: adminId, request,
    data: {
      result_count: rows.length,
      filters: { user_id: userId, event_type: eventType, severity, from, to, page, limit },
    },
  })

  return res({
    rows,
    total: countRow?.total ?? 0,
    page,
    limit,
  })
}
