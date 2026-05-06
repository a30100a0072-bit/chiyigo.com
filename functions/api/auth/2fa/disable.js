/**
 * POST /api/auth/2fa/disable
 * Header: Authorization: Bearer <access_token>
 * Body:   { otp_code } 或 { backup_code }
 *
 * 停用 2FA：驗證當前 OTP 或備用碼後，清除 totp_secret、totp_enabled，
 * 並刪除所有備用碼。
 */

import { TOTP, Secret } from 'otpauth'
import { requireAuth, bumpTokenVersion, res } from '../../../utils/auth.js'
import { verifyBackupCode } from '../../../utils/crypto.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import { checkRateLimit, recordRateLimit, clearRateLimit } from '../../../utils/rate-limit.js'

const RL_WINDOW_SEC = 60
const RL_MAX        = 5

export async function onRequestPost({ request, env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { otp_code, backup_code } = body ?? {}
  if (!otp_code && !backup_code)
    return res({ error: 'otp_code or backup_code is required' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db
  const ip     = request.headers.get('CF-Connecting-IP') ?? null

  // ── Rate limit（防 OTP/備用碼 brute force 暴力嘗試解鎖 2FA）──
  const { blocked } = await checkRateLimit(db, {
    kind: '2fa_disable', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX,
  })
  if (blocked) {
    return res({ error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)
  }

  const account = await db
    .prepare('SELECT totp_secret, totp_enabled FROM local_accounts WHERE user_id = ?')
    .bind(userId)
    .first()

  if (!account)              return res({ error: 'Local account not found' }, 404)
  if (!account.totp_enabled) return res({ error: '2FA is not enabled' }, 409)

  // ── 驗證 OTP ──────────────────────────────────────────────────
  if (otp_code) {
    const sanitized = String(otp_code).replace(/\s/g, '')
    if (!/^\d{6}$/.test(sanitized))
      return res({ error: 'otp_code must be 6 digits' }, 400)

    const totp = new TOTP({
      algorithm: 'SHA1', digits: 6, period: 30,
      secret: Secret.fromBase32(account.totp_secret),
    })
    if (totp.validate({ token: sanitized, window: 1 }) === null) {
      await recordRateLimit(db, { kind: '2fa_disable', userId, ip })
      await safeUserAudit(env, { event_type: 'mfa.totp.disable.fail', severity: 'warn', user_id: userId, request, data: { reason_code: 'bad_otp' } })
      return res({ error: 'Invalid OTP code' }, 401)
    }
  }

  // ── 驗證備用碼（常時性比較，防計時攻擊）────────────────────────
  if (backup_code) {
    const normalized = String(backup_code).replace(/[-\s]/g, '').toLowerCase()
    const codes = await db
      .prepare('SELECT code_hash FROM backup_codes WHERE user_id = ? AND used_at IS NULL')
      .bind(userId)
      .all()

    let valid = false
    for (const code of codes.results ?? []) {
      if (await verifyBackupCode(normalized, code.code_hash)) { valid = true; break }
    }
    if (!valid) {
      await recordRateLimit(db, { kind: '2fa_disable', userId, ip })
      await safeUserAudit(env, { event_type: 'mfa.totp.disable.fail', severity: 'warn', user_id: userId, request, data: { reason_code: 'bad_backup_code' } })
      return res({ error: 'Invalid or already used backup code' }, 401)
    }
  }

  await clearRateLimit(db, { kind: '2fa_disable', userId })

  // ── 停用 2FA，清除所有備用碼 ──────────────────────────────────
  await db.batch([
    db.prepare('UPDATE local_accounts SET totp_enabled = 0, totp_secret = NULL WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM backup_codes WHERE user_id = ?').bind(userId),
  ])

  // 強制下線：所有 access token 立即失效，refresh token 全撤銷
  await bumpTokenVersion(db, userId)

  await safeUserAudit(env, { event_type: 'mfa.totp.disable', severity: 'critical', user_id: userId, request })
  return res({ message: '2FA disabled successfully' })
}
