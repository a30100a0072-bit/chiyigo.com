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
 *  200 → { access_token, refresh_token, token_type, expires_in, user_id, role, status, scope?, id_token? }
 *  400 → 參數缺失 / code 無效過期 / redirect_uri 不符 / PKCE 驗證失敗
 *  403 → 帳號被封禁
 *
 * OIDC：
 *  - 若 authorize 階段帶 scope=openid，則加發 id_token（含 sub/email/email_verified/aud/exp/iat/nonce）
 *  - id_token 與 access_token 共用 signing key，但語義不同：
 *      access_token 用於 resource server（chiyigo IAM API / mbti worker / talo worker）
 *      id_token     僅供 client 驗證使用者身份（不應送 resource server）
 *  - scope 不含 openid：行為與舊 PKCE 完全相同（向後相容）
 */

import { hashToken, pkceVerify, generateSecureToken } from '../../../utils/crypto.js'
import { signJwt } from '../../../utils/jwt.js'
import { getCorsHeaders, resolveAud } from '../../../utils/cors.js'

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
      RETURNING user_id, code_challenge, redirect_uri, state, scope, nonce
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
    .prepare(`SELECT id, email, email_verified, role, status, token_version FROM users WHERE id = ? AND deleted_at IS NULL`)
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

  // 簽發 Access Token（ES256，15 分鐘） — aud 依 redirect_uri origin 決定
  const aud = resolveAud(redirect_uri)
  const accessToken = await signJwt({
    sub:            String(user.id),
    email:          user.email,
    email_verified: user.email_verified === 1,
    role:           user.role,
    status:         user.status,
    ver:            user.token_version ?? 0,
  }, '15m', env, { audience: aud })

  // OIDC：scope 含 openid → 加發 id_token
  const scopes = (authCode.scope ?? '').split(/\s+/).filter(Boolean)
  const isOidc = scopes.includes('openid')

  const responseBody = {
    access_token:  accessToken,
    refresh_token: refreshToken,
    token_type:    'Bearer',
    expires_in:    900,
    user_id:       user.id,
    role:          user.role,
    status:        user.status,
  }
  if (authCode.scope) responseBody.scope = authCode.scope

  if (isOidc) {
    // id_token claims：
    //   iss/iat/exp 由 signJwt 注入；aud 與 access_token 同（resolveAud(redirect_uri)）
    //   sub/email/email_verified 來自 user
    //   nonce 來自 client 在 authorize 階段傳入，client 驗證 nonce 防 replay
    //   auth_time = iat（簡化；未來若做 prompt=login 才需獨立追蹤）
    const idTokenPayload = {
      sub:            String(user.id),
      auth_time:      Math.floor(Date.now() / 1000),
    }
    if (scopes.includes('email')) {
      idTokenPayload.email          = user.email
      idTokenPayload.email_verified = user.email_verified === 1
    }
    if (authCode.nonce) idTokenPayload.nonce = authCode.nonce

    responseBody.id_token = await signJwt(idTokenPayload, '15m', env, { audience: aud })
  }

  return res(responseBody, 200, cors)
}

function res(data, status = 200, corsHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}
