/**
 * GET /api/admin/requisitions
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * 查詢接案諮詢表單紀錄，支援分頁與關鍵字搜尋。
 *
 * 查詢參數：
 *  page    — 頁碼（預設 1）
 *  limit   — 每頁筆數（預設 20，上限 100）
 *  q       — name / contact / message 關鍵字模糊搜尋（選填）
 *
 * 回傳：
 *  200 → { requisitions: [...], total, page, limit }
 *  401 / 403 → 未授權或角色不足
 */

import { res, requireAnyScope } from '../../utils/auth'
import { SCOPES } from '../../utils/scopes'
import { safeUserAudit } from '../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'

export async function onRequestGet({ request, env }) {
  // P1-17 Phase 3: requisitions 屬金流脈絡（接案 → 報價 → 收款），收進 admin:payments:* 任一
  const { user, error } = await requireAnyScope(
    request, env,
    SCOPES.ADMIN_PAYMENTS_READ, SCOPES.ADMIN_PAYMENTS_WRITE,
    SCOPES.ADMIN_PAYMENTS_REFUND, SCOPES.ADMIN_PAYMENTS_APPROVE,
  )
  if (error) return error

  // P1-12：套上 admin_read rate limit（與 deals.js 一致 60/min/admin）
  const adminId = Number(user.sub)
  const rl = await checkRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId, windowSeconds: 60, max: 60 })
  if (rl.blocked) {
    await safeUserAudit(env, {
      event_type: 'admin.read.rate_limited', severity: 'warn',
      user_id: adminId, request, data: { endpoint: 'requisitions' },
    })
    return res({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId })

  const url    = new URL(request.url)
  const page   = Math.max(1, parseInt(url.searchParams.get('page')  ?? '1', 10))
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)))
  // P1-12：q 長度上限 100，避免 SQLite LIKE 在大 dataset 上拖慢 + 防注入式爆炸
  const q      = (url.searchParams.get('q') ?? '').slice(0, 100)
  const offset = (page - 1) * limit

  const db = env.chiyigo_db

  const conditions = []
  const bindings   = []

  if (q) {
    conditions.push('(name LIKE ? OR contact LIKE ? OR message LIKE ? OR company LIKE ?)')
    bindings.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }

  // T8 soft delete：預設隱藏已刪 row；?include_deleted=1 可看
  const includeDeleted = url.searchParams.get('include_deleted') === '1'
  if (!includeDeleted) conditions.push('deleted_at IS NULL')

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM requisition ${where}`)
      .bind(...bindings)
      .first(),
    db.prepare(`
      SELECT id, name, company, contact, service_type, budget, timeline, message, status, created_at
      FROM requisition ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all(),
  ])

  // T14 read audit
  await safeUserAudit(env, {
    event_type: 'admin.requisitions.read', severity: 'info',
    user_id: Number(user.sub), request,
    data: { filters: { q, page, limit, includeDeleted }, result_count: rows.results?.length ?? 0 },
  })

  return res({
    requisitions: rows.results ?? [],
    total: countRow?.total ?? 0,
    page,
    limit,
  })
}
