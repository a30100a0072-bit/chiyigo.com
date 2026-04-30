/**
 * POST /api/admin/users/:id/unban
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * 解封指定用戶：將 users.status 設回 'active'。
 * 解封後用戶需重新登入以取得新 JWT（現有 JWT 中 status 仍為 'banned'）。
 *
 * 保護規則：
 *  - 不可解封角色層級 ≥ 自己的用戶
 *
 * 回傳：
 *  200 → { message, user_id, status: 'active' }
 *  400 → 用戶並非 banned 狀態
 *  403 → 角色不足 / 目標角色過高
 *  404 → 用戶不存在
 */

import { requireRole } from '../../../../utils/requireRole.js'
import { appendAuditLog } from '../../../../utils/audit-log.js'

const ROLE_LEVEL = { player: 0, moderator: 1, admin: 2, developer: 3 }

export async function onRequestPost({ request, env, params }) {
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  const targetId = parseInt(params.id, 10)
  if (isNaN(targetId)) return res({ error: 'Invalid user id' }, 400)

  const db = env.chiyigo_db

  const target = await db
    .prepare(`SELECT id, email, role, status FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(targetId)
    .first()

  if (!target) return res({ error: 'User not found' }, 404)

  if ((ROLE_LEVEL[target.role] ?? -1) >= (ROLE_LEVEL[user.role] ?? -1))
    return res({ error: 'Cannot unban a user with equal or higher role' }, 403)

  if (target.status !== 'banned') return res({ error: 'User is not banned' }, 400)

  await db
    .prepare(`UPDATE users SET status = 'active' WHERE id = ?`)
    .bind(targetId)
    .run()

  // ── 稽核日誌（hash chain；table / 欄位不存在時靜默跳過）─────
  try {
    await appendAuditLog(db, {
      admin_id:     Number(user.sub),
      admin_email:  user.email,
      action:       'unban',
      target_id:    targetId,
      target_email: target.email,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch { /* migration 0003/0012 not yet applied */ }

  return res({ message: 'User unbanned', user_id: targetId, status: 'active' })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
