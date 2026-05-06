/**
 * GET /api/requisition/me
 * Header: Authorization: Bearer <access_token>
 *
 * 回傳當前登入用戶的所有需求單（含已撤銷，不含硬刪除）。
 * 最多回傳最近 50 筆，由新到舊排序。
 */

import { requireAuth, res } from '../../utils/auth.js'

export async function onRequestGet({ request, env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)

  const { results } = await env.chiyigo_db
    .prepare(`
      SELECT id, service_type, budget, timeline, status, created_at, deleted_at
      FROM   requisition
      WHERE  user_id = ? AND deleted_at IS NULL
      ORDER  BY created_at DESC
      LIMIT  50
    `)
    .bind(userId)
    .all()

  return res({ requisitions: results ?? [] })
}
