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
import { verifyBackupCode, generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { requireAuth, res } from '../../../utils/auth.js'
import { signJwt } from '../../../utils/jwt.js'
import { resolveAud } from '../../../utils/cors.js'
import { checkRateLimit, recordRateLimit, clearRateLimit } from '../../../utils/rate-limit.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import { buildTokenScope } from '../../../utils/scopes.js'

const TOTP_RL_WINDOW_SEC = 5 * 60
const TOTP_RL_MAX        = 5

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7

export async function onRequestPost({ request, env }) {
  // ── 1. 驗證 pre_auth_token（scope 必須為 'pre_auth'）──────────
  const { user, error } = await requireAuth(request, env, 'pre_auth')
  if (error) return error

  // ── 2. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { otp_code, device_uuid, aud } = body ?? {}
  if (!otp_code || typeof otp_code !== 'string')
    return res({ error: 'otp_code is required' }, 400)
  const audience = resolveAud(aud)

  const sanitized = otp_code.replace(/[\s-]/g, '')

  const userId = Number(user.sub)
  const db     = env.chiyigo_db
  const ip     = request.headers.get('CF-Connecting-IP') ?? null

  // ── 2.5 Rate Limit（per-user 5 次 / 5 分鐘）──────────────────
  // pre_auth_token 短效 5min，但攻擊者仍可在 5 分鐘內暴力試 6 位數 / 20-hex
  // 失敗 ≥5 次直接 429，必須等 window 過或重新登入觸發新 pre_auth
  const { blocked } = await checkRateLimit(db, {
    kind:           '2fa',
    userId,
    windowSeconds:  TOTP_RL_WINDOW_SEC,
    max:            TOTP_RL_MAX,
  })
  if (blocked) {
    return res({
      error: 'Too many 2FA attempts. Please re-login and try again.',
      code:  'RATE_LIMITED',
    }, 429)
  }

  // ── 3. 取得帳號資料 ──────────────────────────────────────────
  const record = await db
    .prepare(`
      SELECT u.email, u.email_verified, u.role, u.status, u.token_version,
             la.totp_secret, la.totp_enabled
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
      await clearRateLimit(db, { kind: '2fa', userId })
      await safeUserAudit(env, { event_type: 'mfa.totp.verify.success', user_id: userId, request })
      return res(await issueToken(userId, record, db, device_uuid, env, audience))
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
          await clearRateLimit(db, { kind: '2fa', userId })
          await safeUserAudit(env, { event_type: 'mfa.backup_code.use', severity: 'warn', user_id: userId, request })
          return res(await issueToken(userId, record, db, device_uuid, env, audience))
        }
      }
    }
  }

  // 失敗：寫一筆記錄（user 維度），下次 check 會 +1
  await recordRateLimit(db, { kind: '2fa', userId, ip })
  await safeUserAudit(env, { event_type: 'mfa.totp.verify.fail', severity: 'warn', user_id: userId, request })
  return res({ error: 'Invalid OTP or backup code' }, 401)
}

async function issueToken(userId, record, db, deviceUuid, env, audience) {
  const accessToken = await signJwt({
    sub:            String(userId),
    email:          record.email,
    email_verified: record.email_verified === 1,
    role:           record.role,
    status:         record.status,
    ver:            record.token_version ?? 0,
    scope:          buildTokenScope(record.role),
  }, ACCESS_TOKEN_TTL, env, { audience })

  const refreshToken     = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).bind(userId, refreshTokenHash, deviceUuid ?? null, refreshExpiresAt).run()

  return {
    access_token:   accessToken,
    refresh_token:  refreshToken,
    user_id:        userId,
    email:          record.email,
    email_verified: record.email_verified === 1,
    role:           record.role,
    status:         record.status,
  }
}
