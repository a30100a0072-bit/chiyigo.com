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
import { generateSecureToken, hashToken } from '../../../utils/crypto'
import { getProvider } from '../../../utils/oauth-providers'
import { resolveAud } from '../../../utils/cors.js'
import { res } from '../../../utils/auth.js'
import { refreshCookie } from '../../../utils/cookies.js'
import { safeUserAudit } from '../../../utils/user-audit'
import { buildTokenScope } from '../../../utils/scopes.js'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7

export async function onRequestPost(context) {
  const { request, env } = context

  let body
  try {
    body = await request.json()
  } catch {
    return res({ error: '無效的請求格式', code: 'INVALID_REQUEST_FORMAT' }, 400)
  }

  const { token, email, aud } = body ?? {}
  const audience = resolveAud(aud)

  if (!token || !email) return res({ error: '缺少必要欄位', code: 'MISSING_REQUIRED_FIELD' }, 400)

  const emailLower = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower))
    return res({ error: '信箱格式無效', code: 'INVALID_EMAIL_FORMAT' }, 400)

  // ── 1. 驗證 temp_bind_token ────────────────────────────────────
  let payload
  try {
    payload = await verifyJwt(token, env)
  } catch {
    return res({ error: '連結無效或已過期，請重新登入', code: 'LINK_INVALID_OR_EXPIRED' }, 401)
  }

  if (payload.scope !== 'temp_bind')
    return res({ error: '連結類型錯誤', code: 'LINK_TYPE_INVALID' }, 401)

  const { sub: provider_id, provider, name, avatar } = payload
  if (!provider_id || !provider)
    return res({ error: 'Token 資料不完整', code: 'TOKEN_DATA_INCOMPLETE' }, 401)

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
      // P0-2：bind-email 階段的 email 是「使用者手動輸入」，未經第三方驗章；
      // 即使 provider trustEmail=true 也不能據此靜默接管既有帳號。
      // 一律拒絕，導引至「密碼登入後手動綁定」流程。
      await safeUserAudit(env, {
        event_type: 'oauth.bind_email.collision_blocked',
        severity: 'warn',
        user_id: existingUser.id,
        request,
        data: { provider, reason: 'unverified_typed_email' },
      })
      return res({
        error: `此信箱已被既有帳號使用。請改用既有方式登入，登入後可在帳號設定中綁定 ${provider} 帳號。`,
        code: 'EMAIL_USED_BIND_AFTER_LOGIN',
        provider,
      }, 409)

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
    .prepare('SELECT email, email_verified, role, status, token_version FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow) return res({ error: '帳號建立後無法查詢，請稍後重試', code: 'ACCOUNT_LOOKUP_FAILED_AFTER_CREATE' }, 500)
  if (userRow.status === 'banned') return res({ error: '此帳號已被停用', code: 'ACCOUNT_DISABLED' }, 403)

  // ── 6. 簽發 Access Token ───────────────────────────────────────
  const accessToken = await signJwt({
    sub:            String(userId),
    email:          userRow.email,
    email_verified: userRow.email_verified === 1,
    role:           userRow.role,
    status:         userRow.status,
    ver:            userRow.token_version ?? 0,
    scope:          buildTokenScope(userRow.role),
    provider,
  }, ACCESS_TOKEN_TTL, env, { audience })

  // ── 7. 建立 Refresh Token ──────────────────────────────────────
  const refreshToken     = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19)

  // Codex r9-5：issued_aud 鎖定發行時的 audience
  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time, issued_aud)
    VALUES (?, ?, NULL, ?, datetime('now'), ?)
  `).bind(userId, refreshTokenHash, refreshExpiresAt, audience).run()

  await safeUserAudit(env, { event_type: 'oauth.bind_email.success', user_id: userId, request, data: { provider } })

  return new Response(JSON.stringify({ access_token: accessToken }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie':   refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400),
    },
  })
}


