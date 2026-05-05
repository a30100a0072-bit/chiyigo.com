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

import { res } from '../../utils/auth.js'
import { requireRole } from '../../utils/requireRole.js'

const VALID_SEVERITY = new Set(['info', 'warn', 'critical'])

export async function onRequestGet({ request, env }) {
  const { error } = await requireRole(request, env, 'admin')
  if (error) return error

  const url   = new URL(request.url)
  const page  = Math.max(1, parseInt(url.searchParams.get('page')  ?? '1',  10))
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const offset = (page - 1) * limit

  const conds   = []
  const binds   = []

  const userId = url.searchParams.get('user_id')
  if (userId) {
    const n = Number(userId)
    if (!Number.isFinite(n)) return res({ error: 'user_id must be a number' }, 400)
    conds.push('user_id = ?'); binds.push(n)
  }

  const eventType = url.searchParams.get('event_type')
  if (eventType) {
    conds.push('event_type = ?'); binds.push(eventType)
  }

  const severity = url.searchParams.get('severity')
  if (severity) {
    if (!VALID_SEVERITY.has(severity))
      return res({ error: 'severity must be info | warn | critical' }, 400)
    conds.push('severity = ?'); binds.push(severity)
  }

  const from = url.searchParams.get('from')
  if (from) { conds.push("created_at >= ?"); binds.push(from) }

  const to = url.searchParams.get('to')
  if (to)   { conds.push("created_at <  ?"); binds.push(to) }

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

  return res({
    rows:  rowsResult?.results ?? [],
    total: countRow?.total ?? 0,
    page,
    limit,
  })
}
