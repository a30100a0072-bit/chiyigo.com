/**
 * POST /api/auth/2fa/activate
 * Header: Authorization: Bearer <access_token>
 * Body:   { otp_code, current_password }
 *
 * 第二階段：使用者輸入 Authenticator App 顯示的 6 位數 OTP + 當前登入密碼，
 * 驗證通過後才正式啟用 2FA，同時生成 10 組備用救援碼。
 *
 * 為什麼一定要 current_password：
 *   step-up flow 要求 totp_enabled=1，啟用 2FA 本身無法走 step-up（雞生蛋）；
 *   退而求其次，要求當前密碼，避免「access_token 被盜 → 攻擊者用自己的
 *   authenticator 啟用 2FA 鎖定 user」的接管攻擊。
 *
 * 備用碼僅在此回應中以明文出現一次，DB 只存 SHA-256 hash。
 * 前端需提示使用者立即抄寫。
 *
 * 防護：
 *   - 失敗（密碼/OTP 任一錯）→ rate limit kind='2fa_activate'（5/min/user）
 *   - 通過後 audit log mfa.totp.activate
 *
 * 回傳：
 *  { backup_codes: ['XXXXX-XXXXX-XXXXX-XXXXX', ...] }  (10 組)
 */

import { TOTP, Secret } from 'otpauth'
import { generateBackupCodes, verifyPassword } from '../../../utils/crypto.js'
import { requireAuth, res } from '../../../utils/auth.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import { checkRateLimit, recordRateLimit, clearRateLimit } from '../../../utils/rate-limit.js'

const RL_WINDOW_SEC = 60
const RL_MAX        = 5

export async function onRequestPost({ request, env }) {
  // ── 1. 驗證 JWT ──────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  // ── 2. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { otp_code, current_password } = body ?? {}
  if (!otp_code || typeof otp_code !== 'string')
    return res({ error: 'otp_code is required' }, 400)
  if (!current_password || typeof current_password !== 'string')
    return res({ error: 'current_password is required', code: 'PASSWORD_REQUIRED' }, 400)

  const sanitized = otp_code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(sanitized))
    return res({ error: 'otp_code must be 6 digits' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db
  const ip     = request.headers.get('CF-Connecting-IP') ?? null

  // ── 2.5 Rate Limit（密碼 + OTP 雙因子的 brute force 防線）────
  const { blocked } = await checkRateLimit(db, {
    kind: '2fa_activate', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX,
  })
  if (blocked) {
    return res({ error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)
  }

  // ── 3. 取得 totp_secret + password_hash/salt（必須已 setup）──
  const account = await db
    .prepare('SELECT totp_secret, totp_enabled, password_hash, password_salt FROM local_accounts WHERE user_id = ?')
    .bind(userId)
    .first()

  if (!account)             return res({ error: 'Local account not found' }, 404)
  if (account.totp_enabled) return res({ error: '2FA is already enabled' }, 409)
  if (!account.totp_secret) return res({ error: 'Run /api/auth/2fa/setup first' }, 400)
  if (!account.password_hash || !account.password_salt) {
    // OAuth-only 帳號沒設密碼 → 不能啟用 2FA（也不該到這，前端應提示先設密碼）
    return res({ error: 'Set a login password first', code: 'PASSWORD_NOT_SET' }, 400)
  }

  // ── 4a. 驗 current_password（先驗，OTP 錯也算入限流）─────────
  const passwordOk = await verifyPassword(current_password, account.password_salt, account.password_hash)
  if (!passwordOk) {
    await recordRateLimit(db, { kind: '2fa_activate', userId, ip })
    await safeUserAudit(env, {
      event_type: 'mfa.totp.activate.fail', severity: 'warn',
      user_id: userId, request, data: { reason_code: 'bad_password' },
    })
    return res({ error: 'Invalid current password' }, 401)
  }

  // ── 4b. 驗證 OTP（±1 period window 容許時鐘偏差）────────────
  const totp = new TOTP({
    algorithm: 'SHA1',
    digits:    6,
    period:    30,
    secret:    Secret.fromBase32(account.totp_secret),
  })

  const delta = totp.validate({ token: sanitized, window: 1 })
  if (delta === null) {
    await recordRateLimit(db, { kind: '2fa_activate', userId, ip })
    await safeUserAudit(env, {
      event_type: 'mfa.totp.activate.fail', severity: 'warn',
      user_id: userId, request, data: { reason_code: 'bad_otp' },
    })
    return res({ error: 'Invalid OTP code' }, 401)
  }

  await clearRateLimit(db, { kind: '2fa_activate', userId })

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
