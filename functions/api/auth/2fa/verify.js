/**
 * POST /api/auth/2fa/verify
 * Header: Authorization: Bearer <pre_auth_token>
 * Body:   { otp_code }
 *
 * 登入時的 2FA 驗證（與 activate 的「設定時驗證」不同）。
 * pre_auth_token 由 /login 在密碼正確但 totp_enabled=true 時簽發。
 *
 * 驗證成功後：
 *  - 若使用者輸入的是 6 位 TOTP → 簽發完整 access_token
 *  - 若使用者輸入的是備用救援碼 → 核銷該碼後簽發 access_token
 *
 * 回傳：
 *  200 → { access_token, user_id, email, email_verified }
 *  401 → { error: 'Invalid OTP or backup code' }
 */

import { TOTP, Secret } from 'otpauth'
import { verifyBackupCode } from '../../../utils/crypto.js'
import { requireAuth, res } from '../../../utils/auth.js'
import { SignJWT } from 'jose'

const ACCESS_TOKEN_TTL = '15m'

export async function onRequestPost({ request, env }) {
  // ── 1. 驗證 pre_auth_token（scope 必須為 'pre_auth'）──────────
  const { user, error } = await requireAuth(request, env, 'pre_auth')
  if (error) return error

  // ── 2. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { otp_code } = body ?? {}
  if (!otp_code || typeof otp_code !== 'string')
    return res({ error: 'otp_code is required' }, 400)

  const sanitized = otp_code.replace(/[\s-]/g, '')

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // ── 3. 取得帳號資料 ──────────────────────────────────────────
  const record = await db
    .prepare(`
      SELECT u.email, u.email_verified, la.totp_secret, la.totp_enabled
      FROM users u
      JOIN local_accounts la ON la.user_id = u.id
      WHERE u.id = ? AND u.deleted_at IS NULL
    `)
    .bind(userId)
    .first()

  if (!record || !record.totp_enabled)
    return res({ error: 'Invalid request' }, 400)

  // ── 4a. 嘗試 TOTP 驗證（6 位數字）───────────────────────────
  if (/^\d{6}$/.test(sanitized)) {
    const totp  = new TOTP({
      algorithm: 'SHA1',
      digits:    6,
      period:    30,
      secret:    Secret.fromBase32(record.totp_secret),
    })
    const delta = totp.validate({ token: sanitized, window: 1 })
    if (delta !== null) {
      return res(await issueToken(userId, record, env))
    }
  }

  // ── 4b. 嘗試備用救援碼（移除 dash 後 20 hex chars）──────────
  if (/^[0-9a-f]{20}$/i.test(sanitized)) {
    // 取出該 user 尚未使用的備用碼，並以 DELETE ... RETURNING 原子核銷
    const codes = await db
      .prepare('SELECT id, code_hash FROM backup_codes WHERE user_id = ? AND used_at IS NULL')
      .bind(userId)
      .all()

    for (const code of codes.results ?? []) {
      const match = await verifyBackupCode(sanitized, code.code_hash)
      if (match) {
        // 原子核銷：確保並發請求只有一次成功
        const revoked = await db
          .prepare(`
            UPDATE backup_codes SET used_at = datetime('now')
            WHERE id = ? AND used_at IS NULL
          `)
          .bind(code.id)
          .run()

        if (revoked.meta?.changes > 0) {
          return res(await issueToken(userId, record, env))
        }
      }
    }
  }

  return res({ error: 'Invalid OTP or backup code' }, 401)
}

async function issueToken(userId, record, env) {
  const secret = new TextEncoder().encode(env.JWT_SECRET)
  const accessToken = await new SignJWT({
    sub:            String(userId),
    email:          record.email,
    email_verified: record.email_verified === 1,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TOKEN_TTL)
    .sign(secret)

  return {
    access_token:   accessToken,
    user_id:        userId,
    email:          record.email,
    email_verified: record.email_verified === 1,
  }
}
