// POST /api/auth/2fa/backup-codes/regenerate
// Requires JWT + OTP or backup_code verification.
// Replaces all existing backup codes with 10 freshly generated ones.

import { TOTP, Secret } from 'otpauth'
import { generateBackupCodes, verifyBackupCode } from '../../../../utils/crypto.js'
import { requireAuth, res } from '../../../../utils/auth.js'

export async function onRequestPost({ request, env }) {
  // ── 1. JWT 驗證 ───────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  // ── 2. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { otp_code, backup_code } = body ?? {}
  if (!otp_code && !backup_code)
    return res({ error: 'otp_code or backup_code is required' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // ── 3. 取得帳號（必須已啟用 2FA）────────────────────────────
  const account = await db
    .prepare('SELECT totp_secret, totp_enabled FROM local_accounts WHERE user_id = ?')
    .bind(userId)
    .first()

  if (!account)              return res({ error: 'Local account not found' }, 404)
  if (!account.totp_enabled) return res({ error: '2FA is not enabled' }, 409)

  // ── 4a. 驗證 OTP ─────────────────────────────────────────────
  if (otp_code) {
    const sanitized = String(otp_code).replace(/\s/g, '')
    if (!/^\d{6}$/.test(sanitized))
      return res({ error: 'otp_code must be 6 digits' }, 400)

    const totp = new TOTP({
      algorithm: 'SHA1', digits: 6, period: 30,
      secret: Secret.fromBase32(account.totp_secret),
    })
    if (totp.validate({ token: sanitized, window: 1 }) === null)
      return res({ error: 'Invalid OTP code' }, 401)
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
    if (matchId === null) return res({ error: 'Invalid or already used backup code' }, 401)
    // Mark the used backup code before regenerating
    await db.prepare('UPDATE backup_codes SET used_at = datetime(\'now\') WHERE id = ?').bind(matchId).run()
  }

  // ── 5. 生成 10 組新備用碼，替換舊有全部 ─────────────────────
  const { plain, hashed } = await generateBackupCodes()

  const insertCodes = hashed.map(h =>
    db.prepare('INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)').bind(userId, h)
  )

  await db.batch([
    db.prepare('DELETE FROM backup_codes WHERE user_id = ?').bind(userId),
    ...insertCodes,
  ])

  return res({ backup_codes: plain })
}
