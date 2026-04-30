/**
 * POST /api/admin/users/:id/ban
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * 封禁指定用戶：
 *  1. 將 users.status 設為 'banned'
 *  2. 原子撤銷該用戶所有有效 refresh_token（防止 token 繼續換發）
 *  3. 寫入 admin_audit_log
 *
 * 保護規則（ROLE_LEVEL 層級）：
 *  - 不可封禁自己
 *  - 不可封禁角色層級 ≥ 自己的用戶（admin 不可封禁 admin 或 developer）
 */

import { requireRole } from '../../../../utils/requireRole.js'
import { appendAuditLog } from '../../../../utils/audit-log.js'

const ROLE_LEVEL = { player: 0, moderator: 1, admin: 2, developer: 3 }

export async function onRequestPost({ request, env, params }) {
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  const targetId = parseInt(params.id, 10)
  if (isNaN(targetId)) return res({ error: 'Invalid user id' }, 400)
  if (targetId === Number(user.sub)) return res({ error: 'Cannot ban yourself' }, 400)

  const db = env.chiyigo_db

  const target = await db
    .prepare(`SELECT id, email, role, status FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(targetId)
    .first()

  if (!target) return res({ error: 'User not found' }, 404)

  if ((ROLE_LEVEL[target.role] ?? -1) >= (ROLE_LEVEL[user.role] ?? -1))
    return res({ error: 'Cannot ban a user with equal or higher role' }, 403)

  if (target.status === 'banned') return res({ error: 'User is already banned' }, 400)

  // ── 原子：更新 status + bump token_version + 撤銷所有 refresh_token ───
  // bump token_version 使所有 access token 立即失效（不必等 15m 過期）
  await db.batch([
    db.prepare(`UPDATE users SET status = 'banned', token_version = token_version + 1 WHERE id = ?`).bind(targetId),
    db.prepare(`
      UPDATE refresh_tokens SET revoked_at = datetime('now')
      WHERE user_id = ? AND revoked_at IS NULL
    `).bind(targetId),
  ])

  // ── 稽核日誌（hash chain 防竄改；table / 欄位不存在時靜默跳過）─
  try {
    await appendAuditLog(db, {
      admin_id:     Number(user.sub),
      admin_email:  user.email,
      action:       'ban',
      target_id:    targetId,
      target_email: target.email,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch { /* migration 0003/0012 not yet applied */ }

  return res({ message: 'User banned', user_id: targetId, status: 'banned' })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
