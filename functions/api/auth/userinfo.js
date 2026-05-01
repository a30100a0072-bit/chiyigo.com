/**
 * GET /api/auth/userinfo
 * Header: Authorization: Bearer <access_token>
 *
 * OIDC 標準 UserInfo Endpoint（OpenID Connect Core 1.0 §5.3）。
 *
 * 回傳當前登入用戶的標準 OIDC claims，供 client / RP 取得用戶身份資訊。
 *
 * 與 /api/auth/me 的差異：
 *  - /api/auth/me：自家 dashboard 用，回更多自家欄位（identities / totp_enabled / has_password）
 *  - /api/auth/userinfo：OIDC 標準路徑，只回 OIDC 規範定義的 claims，供任意 OIDC client 使用
 *
 * 回傳（200）：
 *  {
 *    sub: "123",                       // user id (string per OIDC spec)
 *    email: "user@example.com",
 *    email_verified: true,
 *    name: "user@example.com",         // 暫用 email，未來補 profile.name 改這裡
 *    updated_at: 1700000000            // unix timestamp（OIDC spec）
 *  }
 *
 * 401 → token 無效 / 缺失
 * 403 → 帳號被封禁
 * 404 → 用戶不存在 / 已軟刪
 */

import { requireAuth, res } from '../../utils/auth.js'

export async function onRequestGet({ request, env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  const userRow = await db
    .prepare(`
      SELECT id, email, email_verified, status, created_at
      FROM users
      WHERE id = ? AND deleted_at IS NULL
    `)
    .bind(userId)
    .first()

  if (!userRow)
    return res({ error: 'User not found' }, 404)

  if (userRow.status === 'banned')
    return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)

  // updated_at 用 created_at 暫代（OIDC spec 可選；未來補 users.updated_at 改這）
  const updatedAt = Math.floor(new Date(userRow.created_at + 'Z').getTime() / 1000)

  return res({
    sub:            String(userRow.id),
    email:          userRow.email,
    email_verified: userRow.email_verified === 1,
    name:           userRow.email,
    updated_at:     Number.isFinite(updatedAt) ? updatedAt : undefined,
  })
}

export async function onRequestOptions() {
  // CORS preflight 由 _middleware.js 處理；這裡保險回 204
  return new Response(null, { status: 204 })
}
