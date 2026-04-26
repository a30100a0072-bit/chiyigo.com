/**
 * GET /api/auth/me
 * Header: Authorization: Bearer <access_token>
 *
 * 回傳當前登入用戶的身份資訊（即時查詢 DB，非僅讀 JWT）。
 *
 * 設計要點：
 *  - JWT 通過 requireAuth 後，再以 user_id 查詢 DB 取得最新狀態。
 *  - 即使 JWT 簽發時 status='active'，若 DB 已改為 'banned'，
 *    此端點立即回傳 403，實現管理員即時封禁的可觀察點。
 *  - game_identities：一併回傳已綁定的第三方平台（Steam / Discord / Epic 等）。
 *
 * 回傳：
 *  200 → { user_id, email, email_verified, role, status, identities: [...] }
 *  403 → { error: 'Account is banned' }         (JWT 或 DB 層封禁)
 *  401 → 未攜帶或 token 無效
 */

import { requireAuth, res } from '../../utils/auth.js'

export async function onRequestGet({ request, env }) {
  // ── 1. JWT 驗證（含 banned 檢查）────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // ── 2. 即時查詢 DB 取得最新用戶狀態 ─────────────────────────
  const userRow = await db
    .prepare(`
      SELECT u.id, u.email, u.email_verified, u.role, u.status, u.created_at,
             COALESCE(la.totp_enabled, 0) AS totp_enabled,
             CASE WHEN la.password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password
      FROM users u
      LEFT JOIN local_accounts la ON la.user_id = u.id
      WHERE u.id = ? AND u.deleted_at IS NULL
    `)
    .bind(userId)
    .first()

  if (!userRow)
    return res({ error: 'User not found' }, 404)

  // DB 層即時封禁檢查（覆蓋 JWT 簽發時的 status 快照）
  if (userRow.status === 'banned')
    return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)

  // ── 3. 查詢已綁定的第三方平台身分 ───────────────────────────
  const { results: identities } = await db
    .prepare(`
      SELECT provider, display_name, avatar_url, created_at
      FROM user_identities
      WHERE user_id = ?
      ORDER BY created_at ASC
    `)
    .bind(userId)
    .all()

  return res({
    user_id:        userRow.id,
    email:          userRow.email,
    email_verified: userRow.email_verified === 1,
    totp_enabled:   userRow.totp_enabled === 1,
    has_password:   userRow.has_password === 1,
    role:           userRow.role,
    status:         userRow.status,
    created_at:     userRow.created_at,
    identities:     (identities ?? []).map(i => ({
      provider:     i.provider,
      display_name: i.display_name,
      avatar_url:   i.avatar_url,
      linked_at:    i.created_at,
    })),
  })
}
