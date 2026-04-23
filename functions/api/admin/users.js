/**
 * GET /api/admin/users
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * 查詢用戶列表，支援分頁與狀態 / 角色篩選。
 *
 * 查詢參數：
 *  page    — 頁碼（預設 1）
 *  limit   — 每頁筆數（預設 20，上限 100）
 *  status  — 'active' | 'banned' | 'suspended' | '' (全部，預設)
 *  role    — 'player' | 'moderator' | 'admin' | 'developer' | '' (全部，預設)
 *  q       — email 關鍵字模糊搜尋（選填）
 *
 * 回傳：
 *  200 → { users: [...], total, page, limit }
 *  401 / 403 → 未授權或角色不足
 */

import { requireRole, res } from '../../utils/requireRole.js'

export async function onRequestGet({ request, env }) {
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  const url    = new URL(request.url)
  const page   = Math.max(1, parseInt(url.searchParams.get('page')  ?? '1', 10))
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)))
  const status = url.searchParams.get('status') ?? ''
  const role   = url.searchParams.get('role')   ?? ''
  const q      = url.searchParams.get('q')      ?? ''
  const offset = (page - 1) * limit

  const db = env.chiyigo_db

  // ── 動態 WHERE 子句 ──────────────────────────────────────────
  const conditions = ['deleted_at IS NULL']
  const bindings   = []

  if (status) { conditions.push('status = ?');  bindings.push(status) }
  if (role)   { conditions.push('role = ?');    bindings.push(role) }
  if (q)      { conditions.push('email LIKE ?'); bindings.push(`%${q}%`) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM users ${where}`)
      .bind(...bindings)
      .first(),
    db.prepare(`
      SELECT id, email, email_verified, role, status, created_at
      FROM users ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all(),
  ])

  return res({
    users: (rows.results ?? []).map(u => ({
      id:             u.id,
      email:          u.email,
      email_verified: u.email_verified === 1,
      role:           u.role,
      status:         u.status,
      created_at:     u.created_at,
    })),
    total: countRow?.total ?? 0,
    page,
    limit,
  })
}
