/**
 * POST /api/auth/oauth/bind-email
 *
 * 供無信箱 OAuth 用戶（如 Discord 未公開 email）補填信箱。
 *
 * Body: { token: <temp_bind_token>, email: string }
 *
 * 流程：
 *  1. 驗證 temp_bind_token（scope='temp_bind'）
 *  2. 檢查 user_identities 是否已綁定（防重放）
 *  3. 信箱碰撞處理（同 callback.js 邏輯）
 *  4. 建立 user + identity（或靜默綁定）
 *  5. 簽發 Access Token + Refresh Token（HttpOnly Cookie）
 */

import { verifyJwt, signJwt } from '../../../utils/jwt.js'
import { generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { getProvider } from '../../../utils/oauth-providers.js'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7

export async function onRequestPost(context) {
  const { request, env } = context

  let body
  try {
    body = await request.json()
  } catch {
    return res({ error: '無效的請求格式' }, 400)
  }

  const { token, email } = body ?? {}

  if (!token || !email) return res({ error: '缺少必要欄位' }, 400)

  const emailLower = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower))
    return res({ error: '信箱格式無效' }, 400)

  // ── 1. 驗證 temp_bind_token ────────────────────────────────────
  let payload
  try {
    payload = await verifyJwt(token, env)
  } catch {
    return res({ error: '連結無效或已過期，請重新登入' }, 401)
  }

  if (payload.scope !== 'temp_bind')
    return res({ error: '連結類型錯誤' }, 401)

  const { sub: provider_id, provider, name, avatar } = payload
  if (!provider_id || !provider)
    return res({ error: 'Token 資料不完整' }, 401)

  const cfg = getProvider(provider, env)
  const db  = env.chiyigo_db

  // ── 2. 防重放：identity 是否已在 DB 內 ────────────────────────
  const existingIdentity = await db
    .prepare(`
      SELECT ui.user_id FROM user_identities ui
      JOIN users u ON u.id = ui.user_id
      WHERE ui.provider = ? AND ui.provider_id = ? AND u.deleted_at IS NULL
    `)
    .bind(provider, provider_id)
    .first()

  let userId

  if (existingIdentity) {
    // 已有綁定（可能是前次補填成功但 response 遺失），直接沿用
    userId = existingIdentity.user_id
  } else {
    // ── 3. 信箱碰撞 ───────────────────────────────────────────────
    const existingUser = await db
      .prepare(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL`)
      .bind(emailLower)
      .first()

    if (existingUser) {
      if (!cfg?.trustEmail) {
        return res({
          error: `此信箱已透過密碼登入註冊。請改用「密碼登入」，登入後可在帳號設定中綁定 ${provider} 帳號。`,
        }, 409)
      }
      // trustEmail=true → 靜默綁定
      userId = existingUser.id
      await db.prepare(`
        INSERT OR IGNORE INTO user_identities
          (user_id, provider, provider_id, display_name, avatar_url)
        VALUES (?, ?, ?, ?, ?)
      `).bind(userId, provider, provider_id, name ?? null, avatar ?? null).run()

    } else {
      // ── 4. 全新用戶 → 建立 user + identity ──────────────────────
      await db.batch([
        db.prepare(`INSERT INTO users (email, email_verified) VALUES (?, 0)`)
          .bind(emailLower),
        db.prepare(`
          INSERT INTO user_identities
            (user_id, provider, provider_id, display_name, avatar_url)
          SELECT id, ?, ?, ?, ? FROM users WHERE email = ?
        `).bind(provider, provider_id, name ?? null, avatar ?? null, emailLower),
      ])

      const newUser = await db
        .prepare(`SELECT id FROM users WHERE email = ?`)
        .bind(emailLower)
        .first()
      userId = newUser.id
    }
  }

  // ── 5. 查詢 role / status ──────────────────────────────────────
  const userRow = await db
    .prepare('SELECT email, email_verified, role, status FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow) return res({ error: '帳號建立後無法查詢，請稍後重試' }, 500)
  if (userRow.status === 'banned') return res({ error: '此帳號已被停用' }, 403)

  // ── 6. 簽發 Access Token ───────────────────────────────────────
  const accessToken = await signJwt({
    sub:            String(userId),
    email:          userRow.email,
    email_verified: userRow.email_verified === 1,
    role:           userRow.role,
    status:         userRow.status,
    provider,
  }, ACCESS_TOKEN_TTL, env)

  // ── 7. 建立 Refresh Token ──────────────────────────────────────
  const refreshToken     = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at)
    VALUES (?, ?, NULL, ?)
  `).bind(userId, refreshTokenHash, refreshExpiresAt).run()

  return new Response(JSON.stringify({ access_token: accessToken }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie':   refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400),
    },
  })
}

function refreshCookie(token, maxAge) {
  return `chiyigo_refresh=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}`
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
