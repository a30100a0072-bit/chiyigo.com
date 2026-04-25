/**
 * POST /api/auth/oauth/token
 * Body: { code, code_verifier, redirect_uri }
 *
 * 遊戲 / App 端完成登入後，用授權碼換取 access_token + refresh_token。
 *
 * 安全設計：
 *  1. DELETE ... RETURNING：原子消費 auth code，防止重放攻擊
 *  2. redirect_uri 必須與 authorize 階段完全一致
 *  3. PKCE 驗證：BASE64URL(SHA-256(code_verifier)) == 儲存的 code_challenge
 *
 * 回傳：
 *  200 → { access_token, refresh_token, token_type, expires_in, user_id, role, status }
 *  400 → 參數缺失 / code 無效過期 / redirect_uri 不符 / PKCE 驗證失敗
 *  403 → 帳號被封禁
 */

import { hashToken, pkceVerify, generateSecureToken } from '../../../utils/crypto.js'
import { signJwt } from '../../../utils/jwt.js'
import { getCorsHeaders } from '../../../utils/cors.js'

const REFRESH_TOKEN_DAYS = 30 // 遊戲 / App 端長效 session

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400, cors) }

  const { code, code_verifier, redirect_uri } = body ?? {}

  if (!code || !code_verifier || !redirect_uri)
    return res({ error: 'code, code_verifier, and redirect_uri are required' }, 400, cors)

  const db       = env.chiyigo_db
  const codeHash = await hashToken(code)

  // 原子消費 auth code（一次性，防重放）
  const authCode = await db
    .prepare(`
      DELETE FROM auth_codes
      WHERE code_hash = ? AND expires_at > datetime('now')
      RETURNING user_id, code_challenge, redirect_uri, state
    `)
    .bind(codeHash)
    .first()

  if (!authCode) return res({ error: 'Invalid or expired authorization code' }, 400, cors)

  // redirect_uri 必須完全吻合（RFC 6749 §4.1.3）
  if (authCode.redirect_uri !== redirect_uri)
    return res({ error: 'redirect_uri mismatch' }, 400, cors)

  // PKCE 驗證
  const pkceOk = await pkceVerify(code_verifier, authCode.code_challenge)
  if (!pkceOk) return res({ error: 'PKCE verification failed' }, 400, cors)

  // 取用戶資料
  const user = await db
    .prepare(`SELECT id, email, email_verified, role, status FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(authCode.user_id)
    .first()

  if (!user) return res({ error: 'User not found' }, 404, cors)
  if (user.status === 'banned') return res({ error: 'Account banned', code: 'ACCOUNT_BANNED' }, 403, cors)

  // 簽發 Refresh Token（遊戲端 30 天）
  const refreshToken     = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db
    .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`)
    .bind(user.id, refreshTokenHash, refreshExpiresAt)
    .run()

  // 簽發 Access Token（ES256，15 分鐘）
  const accessToken = await signJwt({
    sub:            String(user.id),
    email:          user.email,
    email_verified: user.email_verified === 1,
    role:           user.role,
    status:         user.status,
  }, '15m', env)

  return res({
    access_token:  accessToken,
    refresh_token: refreshToken,
    token_type:    'Bearer',
    expires_in:    900,
    user_id:       user.id,
    role:          user.role,
    status:        user.status,
  }, 200, cors)
}

function res(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
