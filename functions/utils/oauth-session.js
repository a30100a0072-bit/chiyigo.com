/**
 * OAuth silent SSO helpers
 *
 * 給 /authorize 在 user 已登入時直接 issue auth_code，跳過 /login.html。
 * 不消耗 refresh_token（不 rotate），silent SSO 不能變相延長 session 壽命。
 */

import { generateSecureToken, hashToken } from './crypto.js'

const CODE_TTL_MS = 5 * 60 * 1000

/**
 * 從 Cookie header 取出 chiyigo_refresh 值
 */
export function readRefreshCookie(cookieHeader) {
  if (!cookieHeader) return null
  const match = cookieHeader.match(/(?:^|;\s*)chiyigo_refresh=([^;]+)/)
  return match ? match[1] : null
}

/**
 * 用 refresh_token 反查 user。**唯讀 + 不 rotate**。
 * 全部驗證通過才回傳 user，否則回 null。
 *
 * 過濾條件：
 *  - refresh_tokens.expires_at 未過期
 *  - refresh_tokens.revoked_at 為 null
 *  - users.deleted_at 為 null
 *  - users.status !== 'banned'
 */
export async function findActiveUserByRefreshCookie(env, refreshToken) {
  if (!refreshToken || typeof refreshToken !== 'string') return null
  const tokenHash = await hashToken(refreshToken)

  const row = await env.chiyigo_db
    .prepare(`
      SELECT u.id, u.email, u.email_verified, u.role, u.status, u.token_version
      FROM refresh_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ?
        AND t.expires_at > datetime('now')
        AND t.revoked_at IS NULL
        AND u.deleted_at IS NULL
        AND u.status != 'banned'
    `)
    .bind(tokenHash)
    .first()

  return row ?? null
}

/**
 * 簽發一次性 auth_code 並寫入 auth_codes，回組好的 redirect URL。
 *
 * 與 /api/auth/oauth/code 的邏輯等價，差別僅在 silent flow 沒有 pkce_session
 * 中介物，code_challenge / state / scope / nonce 直接從 authorize 參數帶入。
 */
export async function issueAuthCodeAndBuildRedirect(env, {
  userId, redirectUri, codeChallenge, state, scope, nonce,
}) {
  const code = generateSecureToken()
  const codeHash = await hashToken(code)
  const expiresAt = new Date(Date.now() + CODE_TTL_MS)
    .toISOString().replace('T', ' ').slice(0, 19)

  await env.chiyigo_db
    .prepare(`
      INSERT INTO auth_codes
        (code_hash, user_id, code_challenge, redirect_uri, state, scope, nonce, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(codeHash, Number(userId), codeChallenge, redirectUri, state, scope ?? null, nonce ?? null, expiresAt)
    .run()

  const sep = redirectUri.includes('?') ? '&' : '?'
  return `${redirectUri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
}

/**
 * OIDC prompt=none 失敗回應 — redirect to redirect_uri with error=login_required
 */
export function buildLoginRequiredRedirect(redirectUri, state) {
  const sep = redirectUri.includes('?') ? '&' : '?'
  return `${redirectUri}${sep}error=login_required&state=${encodeURIComponent(state)}`
}
