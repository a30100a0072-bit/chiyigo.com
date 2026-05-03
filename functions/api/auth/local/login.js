/**
 * POST /api/auth/local/login
 * Body: { email, password }
 *
 * 回傳情境：
 *  200 → { access_token }              密碼正確且未啟用 2FA
 *  403 → { code: 'TOTP_REQUIRED',
 *           pre_auth_token }           密碼正確但需要進行 TOTP 驗證
 *  401 → { error: 'Invalid credentials' }
 *
 * pre_auth_token 為短效（5 分鐘）受限 JWT，scope='pre_auth'，
 * 僅供 /api/auth/2fa/verify 端點使用。
 */

import { verifyPassword, generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { signJwt } from '../../../utils/jwt.js'
import { resolveAud } from '../../../utils/cors.js'
import { verifyTurnstile } from '../../../utils/turnstile.js'

const ACCESS_TOKEN_TTL    = '15m'
const PRE_AUTH_TOKEN_TTL  = '5m'
const REFRESH_TOKEN_DAYS  = 7

export async function onRequestPost({ request, env }) {
  // ── 1. 解析 Body ────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { email, password, device_uuid, platform, aud } = body ?? {}
  const audience = resolveAud(aud)

  if (!email || !password)
    return res({ error: 'email and password are required' }, 400)

  // Turnstile（key 未設時 verifyTurnstile 會 skip，不破壞既有流程）
  const ts = await verifyTurnstile(request, body, env)
  if (!ts.ok) return res({ error: 'captcha_failed', code: 'CAPTCHA_FAILED', reason: ts.reason }, 403)

  const db        = env.chiyigo_db
  const ip        = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const emailNorm = email.toLowerCase()

  // ── 2. Rate Limit（15 分鐘視窗：同 IP ≤ 20 次，同 email ≤ 10 次）──
  const [ipRow, emailRow] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS cnt FROM login_attempts
                WHERE kind = 'login' AND ip = ? AND created_at > datetime('now', '-15 minutes')`)
      .bind(ip).first(),
    db.prepare(`SELECT COUNT(*) AS cnt FROM login_attempts
                WHERE kind = 'login' AND email = ? AND created_at > datetime('now', '-15 minutes')`)
      .bind(emailNorm).first(),
  ])
  if ((ipRow?.cnt ?? 0) >= 20 || (emailRow?.cnt ?? 0) >= 10) {
    return res({ error: 'Too many login attempts, please try again later.', code: 'RATE_LIMITED' }, 429)
  }

  // ── 3. 查詢 user + local_account（一次 JOIN）─────────────────
  const record = await db
    .prepare(`
      SELECT
        u.id            AS user_id,
        u.email         AS email,
        u.email_verified,
        u.role,
        u.status,
        u.token_version,
        u.deleted_at,
        la.password_hash,
        la.password_salt,
        la.totp_enabled
      FROM users u
      JOIN local_accounts la ON la.user_id = u.id
      WHERE u.email = ?
    `)
    .bind(email.toLowerCase())
    .first()

  // ── 4. 帳號不存在或已刪除 ────────────────────────────────────
  // 無論是「不存在」或「密碼錯誤」皆回傳相同訊息，防帳號枚舉
  if (!record || record.deleted_at) {
    await Promise.all([
      fakeHashDelay(),
      db.prepare(`INSERT INTO login_attempts (ip, email) VALUES (?, ?)`)
        .bind(ip, emailNorm).run(),
    ])
    return res({ error: 'Invalid credentials' }, 401)
  }

  // ── 5. 驗證密碼 ──────────────────────────────────────────────
  const valid = await verifyPassword(password, record.password_salt, record.password_hash)
  if (!valid) {
    await db.prepare(`INSERT INTO login_attempts (ip, email) VALUES (?, ?)`)
      .bind(ip, emailNorm).run()
    return res({ error: 'Invalid credentials' }, 401)
  }

  // ── 5.5 封禁帳號：密碼正確但帳號已被封禁，禁止取得新 token ──
  if (record.status === 'banned') {
    return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)
  }

  // 密碼驗證通過：清除此 email 的失敗記錄（fire-and-forget）
  db.prepare(`DELETE FROM login_attempts WHERE kind = 'login' AND email = ?`).bind(emailNorm).run()

  // ── 6a. 需要 2FA → 回傳受限 pre_auth_token（ES256）───────────
  if (record.totp_enabled) {
    const preAuthToken = await signJwt({
      sub:    String(record.user_id),
      scope:  'pre_auth',
      role:   record.role,
      status: record.status,
      ver:    record.token_version ?? 0,
    }, PRE_AUTH_TOKEN_TTL, env)

    return res({
      code:           'TOTP_REQUIRED',
      pre_auth_token: preAuthToken,
    }, 403)
  }

  // ── 6b. 無 2FA → 簽發完整 Access Token + Refresh Token ──────
  const accessToken = await signJwt({
    sub:            String(record.user_id),
    email:          record.email,
    email_verified: record.email_verified === 1,
    role:           record.role,
    status:         record.status,
    ver:            record.token_version ?? 0,
  }, ACCESS_TOKEN_TTL, env, { audience })

  const refreshToken    = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(record.user_id, refreshTokenHash, device_uuid ?? null, refreshExpiresAt).run()

  const payload = {
    access_token:   accessToken,
    user_id:        record.user_id,
    email:          record.email,
    email_verified: record.email_verified === 1,
    role:           record.role,
    status:         record.status,
  }

  // Web 瀏覽器（無 device_uuid 且非明確 App 平台）→ Cookie
  const isWeb = !device_uuid && (!platform || platform === 'web')
  if (isWeb) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400),
      },
    })
  }

  // App / Unity / Unreal → JSON body
  return res({ ...payload, refresh_token: refreshToken })
}

/**
 * 當帳號不存在時執行假雜湊，避免因回應時間差異洩漏帳號是否存在。
 * 耗時約等同一次真實 PBKDF2 運算。
 */
async function fakeHashDelay() {
  const dummy = new Uint8Array(32)
  crypto.getRandomValues(dummy)
  const key = await crypto.subtle.importKey(
    'raw', dummy, { name: 'PBKDF2' }, false, ['deriveBits']
  )
  await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: dummy, iterations: 100_000 },
    key, 256
  )
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function refreshCookie(token, maxAge) {
  return `chiyigo_refresh=${token}; Domain=.chiyigo.com; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}`
}
