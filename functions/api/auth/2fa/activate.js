/**
 * POST /api/auth/2fa/activate
 * Header: Authorization: Bearer <access_token>
 * Body:   { otp_code }
 *
 * 第二階段：使用者輸入 Authenticator App 顯示的 6 位數 OTP，
 * 驗證通過後才正式啟用 2FA，同時生成 10 組備用救援碼。
 *
 * 備用碼僅在此回應中以明文出現一次，DB 只存 SHA-256 hash。
 * 前端需提示使用者立即抄寫。
 *
 * 回傳：
 *  { backup_codes: ['XXXXX-XXXXX-XXXXX-XXXXX', ...] }  (10 組)
 */

import { TOTP, Secret } from 'otpauth'
import { generateBackupCodes } from '../../../utils/crypto.js'
import { requireAuth, res } from '../../../utils/auth.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

export async function onRequestPost({ request, env }) {
  // ── 1. 驗證 JWT ──────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  // ── 2. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { otp_code } = body ?? {}
  if (!otp_code || typeof otp_code !== 'string')
    return res({ error: 'otp_code is required' }, 400)

  const sanitized = otp_code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(sanitized))
    return res({ error: 'otp_code must be 6 digits' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // ── 3. 取得 totp_secret（必須已 setup）───────────────────────
  const account = await db
    .prepare('SELECT totp_secret, totp_enabled FROM local_accounts WHERE user_id = ?')
    .bind(userId)
    .first()

  if (!account)             return res({ error: 'Local account not found' }, 404)
  if (account.totp_enabled) return res({ error: '2FA is already enabled' }, 409)
  if (!account.totp_secret) return res({ error: 'Run /api/auth/2fa/setup first' }, 400)

  // ── 4. 驗證 OTP（±1 period window 容許時鐘偏差）────────────────
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits:    6,
    period:    30,
    secret:    Secret.fromBase32(account.totp_secret),
  })

  const delta = totp.validate({ token: sanitized, window: 1 })
  if (delta === null) return res({ error: 'Invalid OTP code' }, 401)

  // ── 5. 生成備用救援碼 ────────────────────────────────────────
  const { plain, hashed } = await generateBackupCodes()

  // ── 6. 原子 Batch：啟用 2FA + 寫入備用碼 ────────────────────
  // 先清除舊備用碼（重置 2FA 情境），再批次插入新碼
  const insertCodes = hashed.map(h =>
    db.prepare('INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)')
      .bind(userId, h)
  )

  await db.batch([
    db.prepare('UPDATE local_accounts SET totp_enabled = 1 WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM backup_codes WHERE user_id = ?').bind(userId),
    ...insertCodes,
  ])

  await safeUserAudit(env, { event_type: 'mfa.totp.activate', user_id: userId, request })
  return res({ backup_codes: plain })
}
