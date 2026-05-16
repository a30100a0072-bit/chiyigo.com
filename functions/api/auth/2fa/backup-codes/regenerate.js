// POST /api/auth/2fa/backup-codes/regenerate
// Requires JWT + OTP or backup_code verification.
// Replaces all existing backup codes with 10 freshly generated ones.

import { generateBackupCodes, verifyBackupCode } from '../../../../utils/crypto'
import { verifyTotpReplaySafe } from '../../../../utils/totp'
import { requireAuth, res } from '../../../../utils/auth'
import { safeUserAudit } from '../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit, clearRateLimit } from '../../../../utils/rate-limit'

const RL_WINDOW_SEC = 60
const RL_MAX        = 5

export async function onRequestPost({ request, env }) {
  // ── 1. JWT 驗證 ───────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  // ── 2. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const { otp_code, backup_code } = body ?? {}
  if (!otp_code && !backup_code)
    return res({ error: 'otp_code or backup_code is required', code: 'OTP_OR_BACKUP_CODE_REQUIRED' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db
  const ip     = request.headers.get('CF-Connecting-IP') ?? null

  // ── 2.5 Rate limit（防 OTP/backup brute force）──────────────
  const { blocked } = await checkRateLimit(db, {
    kind: '2fa_regen', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX,
  })
  if (blocked) {
    return res({ error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)
  }

  // ── 3. 取得帳號（必須已啟用 2FA）────────────────────────────
  const account = await db
    .prepare('SELECT totp_secret, totp_enabled FROM local_accounts WHERE user_id = ?')
    .bind(userId)
    .first()

  if (!account)              return res({ error: 'Local account not found', code: 'LOCAL_ACCOUNT_NOT_FOUND' }, 404)
  if (!account.totp_enabled) return res({ error: '2FA is not enabled', code: 'TFA_NOT_ENABLED' }, 409)

  // ── 4a. 驗證 OTP（P1-8：verifyTotpReplaySafe）─────────────────
  if (otp_code) {
    const r = await verifyTotpReplaySafe(env, { userId, secret: account.totp_secret, code: otp_code })
    if (!r.ok) {
      if (r.reason === 'bad_format') return res({ error: 'otp_code must be 6 digits', code: 'OTP_CODE_INVALID_FORMAT' }, 400)
      await recordRateLimit(db, { kind: '2fa_regen', userId, ip })
      return res({ error: 'Invalid OTP code', code: 'INVALID_OTP' }, 401)
    }
  }

  // ── 4b. 驗證備用碼 ───────────────────────────────────────────
  if (backup_code) {
    const normalized = String(backup_code).replace(/[-\s]/g, '').toLowerCase()
    const codes = await db
      .prepare('SELECT id, code_hash FROM backup_codes WHERE user_id = ? AND used_at IS NULL')
      .bind(userId)
      .all()

    let matchId = null
    for (const code of codes.results ?? []) {
      if (await verifyBackupCode(normalized, code.code_hash)) { matchId = code.id; break }
    }
    if (matchId === null) {
      await recordRateLimit(db, { kind: '2fa_regen', userId, ip })
      return res({ error: 'Invalid or already used backup code', code: 'INVALID_OR_USED_BACKUP_CODE' }, 401)
    }
    // Mark the used backup code before regenerating
    await db.prepare('UPDATE backup_codes SET used_at = datetime(\'now\') WHERE id = ?').bind(matchId).run()
  }

  await clearRateLimit(db, { kind: '2fa_regen', userId })

  // ── 5. 生成 10 組新備用碼，替換舊有全部 ─────────────────────
  const { plain, hashed } = await generateBackupCodes()

  const insertCodes = hashed.map(h =>
    db.prepare('INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)').bind(userId, h)
  )

  await db.batch([
    db.prepare('DELETE FROM backup_codes WHERE user_id = ?').bind(userId),
    ...insertCodes,
  ])

  await safeUserAudit(env, { event_type: 'mfa.backup_code.regenerate', user_id: userId, request })
  return res({ backup_codes: plain })
}
