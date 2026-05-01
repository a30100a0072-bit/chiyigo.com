/**
 * POST /api/auth/refresh
 * Body: { refresh_token, device_uuid? }
 *
 * 以有效的 refresh_token 換取新的 access_token，並輪換 refresh_token。
 *
 * 輪換策略（Refresh Token Rotation）：
 *  - 舊 token 立即標記為 revoked（revoked_at），不可再次使用
 *  - 同時簽發新 refresh_token（TTL 重置），返回給客戶端
 *  - 若舊 token 已被 revoked → 可能為重放攻擊，回傳 401
 *
 * device_uuid 驗證：
 *  - 若 DB 中該 token 綁定了 device_uuid，請求中的值必須完全相符
 *  - Web 端（device_uuid=null）的 token 不做裝置驗證
 *
 * 回傳：
 *  200 → { access_token, refresh_token }
 *  401 → token 無效 / 已過期 / 已撤銷 / device_uuid 不符
 *  403 → 帳號已封禁
 */

import { generateSecureToken, hashToken } from '../../utils/crypto.js'
import { signJwt } from '../../utils/jwt.js'
import { getCorsHeadersForCredentials, resolveAud } from '../../utils/cors.js'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeadersForCredentials(request, env) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeadersForCredentials(request, env)
  // Cookie 優先（Web），其次 JSON body（App）
  const cookieToken = parseCookieHeader(request.headers.get('Cookie'), 'chiyigo_refresh')

  let body
  try { body = await request.json() }
  catch { body = {} }

  const { device_uuid, aud } = body ?? {}
  const refresh_token   = cookieToken ?? body?.refresh_token
  const isWeb           = !!cookieToken
  const audience        = resolveAud(aud)

  if (!refresh_token || typeof refresh_token !== 'string')
    return res({ error: 'refresh_token is required' }, 400, cors)

  const db = env.chiyigo_db

  // ── 1. 查找 token（含過期與撤銷過濾）────────────────────────
  const tokenHash = await hashToken(refresh_token)
  const tokenRow  = await db
    .prepare(`
      SELECT id, user_id, device_uuid, revoked_at
      FROM refresh_tokens
      WHERE token_hash = ? AND expires_at > datetime('now')
    `)
    .bind(tokenHash)
    .first()

  if (!tokenRow)
    return res({ error: 'Invalid or expired refresh token' }, 401, cors)

  if (tokenRow.revoked_at)
    return res({ error: 'Refresh token has been revoked' }, 401, cors)

  // ── 2. device_uuid 驗證 ──────────────────────────────────────
  if (tokenRow.device_uuid !== null && tokenRow.device_uuid !== '') {
    if (tokenRow.device_uuid !== (device_uuid ?? ''))
      return res({ error: 'Device mismatch' }, 401, cors)
  }

  // ── 3. 取得用戶最新狀態 ──────────────────────────────────────
  const user = await db
    .prepare(`
      SELECT id, email, email_verified, role, status, token_version
      FROM users
      WHERE id = ? AND deleted_at IS NULL
    `)
    .bind(tokenRow.user_id)
    .first()

  if (!user) return res({ error: 'User not found' }, 401, cors)
  if (user.status === 'banned') return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403, cors)

  // ── 4. Refresh Token Rotation（原子輪換）─────────────────────
  const newPlainToken    = generateSecureToken()
  const newTokenHash     = await hashToken(newPlainToken)
  const newExpiresAt     = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db.batch([
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`)
      .bind(tokenRow.id),
    db.prepare(`
      INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind(user.id, newTokenHash, tokenRow.device_uuid, newExpiresAt),
  ])

  // ── 5. 簽發新 Access Token ───────────────────────────────────
  const accessToken = await signJwt({
    sub:            String(user.id),
    email:          user.email,
    email_verified: user.email_verified === 1,
    role:           user.role,
    status:         user.status,
    ver:            user.token_version ?? 0,
  }, ACCESS_TOKEN_TTL, env, { audience })

  // Web → 新 Cookie；App → JSON body
  if (isWeb) {
    return new Response(JSON.stringify({ access_token: accessToken }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': refreshCookie(newPlainToken, REFRESH_TOKEN_DAYS * 86400),
        ...cors,
      },
    })
  }

  return res({
    access_token:  accessToken,
    refresh_token: newPlainToken,
  }, 200, cors)
}

function parseCookieHeader(header, name) {
  if (!header) return null
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? match[1] : null
}

function refreshCookie(token, maxAge) {
  return `chiyigo_refresh=${token}; Domain=.chiyigo.com; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}`
}

function res(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}
