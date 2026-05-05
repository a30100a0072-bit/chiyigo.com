/**
 * POST /api/auth/step-up
 * Header: Authorization: Bearer <access_token>  (existing valid session)
 * Body:   {
 *   scope:        'elevated:account' | 'elevated:payment' | ...,
 *   for_action:   string (optional)  例：'delete_account' / 'withdraw'
 *   otp_code?:    6-digit TOTP
 *   backup_code?: 20-hex 備用碼
 * }
 *
 * Phase C-3 — Step-up Authentication Flow
 *
 * 用途：高權限操作（金流 / 改密碼 / 刪帳號）需要 user 重新證明身分，
 *       即使 access_token 還有效。通過後簽 5 分鐘短效 step_up_token。
 *
 * 規則：
 *   - 必須已啟用 2FA（local_accounts.totp_enabled = 1）—— 沒 2FA 等於沒法 step-up
 *   - otp_code 或 backup_code 至少帶一個（互斥；都帶 → 取 otp_code）
 *   - scope 必須是 elevated:* 白名單內值（KNOWN_ELEVATED_SCOPES）
 *   - 通過 → 簽 step_up_token：
 *       sub:        same as access_token
 *       scope:      requested elevated:*
 *       for_action: requested action（若有帶）
 *       amr:        ['pwd','totp']（密碼 + TOTP；備用碼路徑亦標 totp）
 *       acr:        'urn:chiyigo:loa:2'  （Level of Assurance 2）
 *       ttl:        5 min
 *       jti:        自動補（一次性，consumer 用 requireStepUp 時 revoke）
 *
 * 防護：
 *   - 同 user rate limit（kind='step_up'，5min/5 次）— 防 brute force OTP
 *   - 失敗 → 寫 audit warn + 進限流計數
 *   - 成功 → 寫 audit info（含 scope + for_action）
 *
 * 回傳：
 *   200 → { step_up_token, expires_in: 300, scope, for_action }
 *   400 → 參數錯誤（scope 非 elevated:* / OTP 缺 / 等）
 *   401 → access_token 無效
 *   403 → 帳號未啟用 2FA / OTP 錯誤
 *   429 → step-up 限流
 */

import { TOTP, Secret } from 'otpauth'
import { verifyBackupCode } from '../../utils/crypto.js'
import { requireAuth, res } from '../../utils/auth.js'
import { signJwt } from '../../utils/jwt.js'
import { resolveAud } from '../../utils/cors.js'
import { KNOWN_ELEVATED_SCOPES } from '../../utils/scopes.js'
import { checkRateLimit, recordRateLimit, clearRateLimit } from '../../utils/rate-limit.js'
import { safeUserAudit } from '../../utils/user-audit.js'

const STEP_UP_TTL = '5m'
const STEP_UP_TTL_SECONDS = 300

const RL_WINDOW_SEC = 5 * 60
const RL_MAX        = 5

export async function onRequestPost({ request, env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { scope, for_action, otp_code, backup_code, aud } = body ?? {}

  // ── 1. 參數驗證 ──────────────────────────────────────────────
  if (!scope || !KNOWN_ELEVATED_SCOPES.has(scope))
    return res({ error: `scope must be one of: ${[...KNOWN_ELEVATED_SCOPES].join(', ')}` }, 400)

  if (!otp_code && !backup_code)
    return res({ error: 'otp_code or backup_code is required' }, 400)

  if (for_action !== undefined && (typeof for_action !== 'string' || !for_action))
    return res({ error: 'for_action must be a non-empty string when provided' }, 400)

  const userId = Number(user.sub)
  if (!Number.isFinite(userId)) return res({ error: 'Invalid token subject' }, 401)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  // ── 2. Rate limit（防 brute force OTP）──────────────────────
  const { blocked } = await checkRateLimit(db, {
    kind: 'step_up', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX,
  })
  if (blocked) {
    await safeUserAudit(env, { event_type: 'auth.step_up.rate_limited', severity: 'warn', user_id: userId, request })
    return res({ error: 'Too many step-up attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)
  }

  // ── 3. 取帳號 + 2FA 設定 ─────────────────────────────────────
  const record = await db
    .prepare(`
      SELECT u.email, u.email_verified, u.role, u.status, u.token_version,
             la.totp_secret, la.totp_enabled
      FROM users u
      LEFT JOIN local_accounts la ON la.user_id = u.id
      WHERE u.id = ? AND u.deleted_at IS NULL
    `)
    .bind(userId).first()

  if (!record) return res({ error: 'User not found' }, 404)
  if (record.status === 'banned') return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)

  if (!record.totp_enabled) {
    // 沒啟用 2FA 完全擋掉：階段性策略，未來金流用戶 mandatory 2FA（Phase E1）
    await safeUserAudit(env, { event_type: 'auth.step_up.fail', severity: 'warn', user_id: userId, request, data: { reason_code: 'no_2fa' } })
    return res({ error: '2FA must be enabled before step-up', code: 'STEP_UP_REQUIRES_2FA' }, 403)
  }

  // ── 4. 驗 OTP / backup code（otp_code 優先）─────────────────
  let amr = null
  let usedBackupId = null

  if (otp_code) {
    const sanitized = String(otp_code).replace(/\s/g, '')
    if (!/^\d{6}$/.test(sanitized))
      return res({ error: 'otp_code must be 6 digits' }, 400)
    const totp = new TOTP({
      algorithm: 'SHA1', digits: 6, period: 30,
      secret: Secret.fromBase32(record.totp_secret),
    })
    if (totp.validate({ token: sanitized, window: 1 }) !== null) {
      amr = ['pwd', 'totp']
    }
  } else if (backup_code) {
    const normalized = String(backup_code).replace(/[-\s]/g, '').toLowerCase()
    if (/^[0-9a-f]{20}$/.test(normalized)) {
      const codes = await db
        .prepare(`SELECT id, code_hash FROM backup_codes WHERE user_id = ? AND used_at IS NULL`)
        .bind(userId).all()
      for (const code of codes.results ?? []) {
        if (await verifyBackupCode(normalized, code.code_hash)) {
          // 原子核銷
          const consumed = await db
            .prepare(`UPDATE backup_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`)
            .bind(code.id).run()
          if (consumed.meta?.changes > 0) {
            usedBackupId = code.id
            amr = ['pwd', 'totp']  // 備用碼是 TOTP 的後備，amr 仍標 totp（同 2fa/verify pattern）
            break
          }
        }
      }
    }
  }

  if (!amr) {
    await recordRateLimit(db, { kind: 'step_up', userId, ip })
    await safeUserAudit(env, {
      event_type: 'auth.step_up.fail', severity: 'warn', user_id: userId, request,
      data: { reason_code: otp_code ? 'bad_totp' : 'bad_backup_code', scope },
    })
    return res({ error: 'Invalid OTP or backup code' }, 401)
  }

  await clearRateLimit(db, { kind: 'step_up', userId })

  // ── 5. 簽 step_up_token（5min，含 elevated:* + for_action + amr/acr）──
  const audience = resolveAud(aud)
  const claims = {
    sub:    String(userId),
    role:   record.role,
    status: record.status,
    ver:    record.token_version ?? 0,
    scope:  scope,                       // 純 elevated:*；不帶 role base
    amr,
    acr:    'urn:chiyigo:loa:2',
  }
  if (for_action) claims.for_action = for_action

  const stepUpToken = await signJwt(claims, STEP_UP_TTL, env, { audience })

  await safeUserAudit(env, {
    event_type: 'auth.step_up.success', user_id: userId, request,
    data: { scope, for_action: for_action ?? null, used_backup_code: !!usedBackupId },
  })

  return res({
    step_up_token: stepUpToken,
    token_type:    'Bearer',
    expires_in:    STEP_UP_TTL_SECONDS,
    scope,
    for_action:    for_action ?? null,
  })
}
