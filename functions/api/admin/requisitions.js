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

import { requireRole } from '../../utils/requireRole.js'
import { res } from '../../utils/auth.js'

export async function onRequestGet({ request, env }) {
  const { error } = await requireRole(request, env, 'admin')
  if (error) return error

  const url    = new URL(request.url)
  const page   = Math.max(1, parseInt(url.searchParams.get('page')  ?? '1', 10))
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)))
  const q      = url.searchParams.get('q') ?? ''
  const offset = (page - 1) * limit

  const db = env.chiyigo_db

  const conditions = []
  const bindings   = []

  if (q) {
    conditions.push('(name LIKE ? OR contact LIKE ? OR message LIKE ? OR company LIKE ?)')
    bindings.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`)
  }

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

  return res({
    requisitions: rows.results ?? [],
    total: countRow?.total ?? 0,
    page,
    limit,
  })
}
