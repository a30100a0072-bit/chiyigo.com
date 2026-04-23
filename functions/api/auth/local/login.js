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

import { verifyPassword } from '../../../utils/crypto.js'
import { SignJWT } from 'jose'

const ACCESS_TOKEN_TTL   = '15m'
const PRE_AUTH_TOKEN_TTL = '5m'

export async function onRequestPost({ request, env }) {
  // ── 1. 解析 Body ────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { email, password } = body ?? {}

  if (!email || !password)
    return res({ error: 'email and password are required' }, 400)

  const db = env.chiyigo_db

  // ── 2. 查詢 user + local_account（一次 JOIN）─────────────────
  const record = await db
    .prepare(`
      SELECT
        u.id            AS user_id,
        u.email         AS email,
        u.email_verified,
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

  // ── 3. 帳號不存在或已刪除 ────────────────────────────────────
  // 無論是「不存在」或「密碼錯誤」皆回傳相同訊息，防帳號枚舉
  if (!record || record.deleted_at) {
    await fakeHashDelay()
    return res({ error: 'Invalid credentials' }, 401)
  }

  // ── 4. 驗證密碼 ──────────────────────────────────────────────
  const valid = await verifyPassword(password, record.password_salt, record.password_hash)
  if (!valid) return res({ error: 'Invalid credentials' }, 401)

  const secret = new TextEncoder().encode(env.JWT_SECRET)

  // ── 5a. 需要 2FA → 回傳受限 pre_auth_token ───────────────────
  if (record.totp_enabled) {
    const preAuthToken = await new SignJWT({
      sub:   String(record.user_id),
      scope: 'pre_auth',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(PRE_AUTH_TOKEN_TTL)
      .sign(secret)

    return res({
      code:            'TOTP_REQUIRED',
      pre_auth_token:  preAuthToken,
    }, 403)
  }

  // ── 5b. 無 2FA → 簽發完整 Access Token ──────────────────────
  const accessToken = await new SignJWT({
    sub:            String(record.user_id),
    email:          record.email,
    email_verified: record.email_verified === 1,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secret)

  return res({
    access_token:   accessToken,
    user_id:        record.user_id,
    email:          record.email,
    email_verified: record.email_verified === 1,
  })
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
