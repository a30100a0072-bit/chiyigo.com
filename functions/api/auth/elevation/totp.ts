/**
 * POST /api/auth/elevation/totp
 * Header: Authorization: Bearer <access_token>
 * Body:   { action: 'add_passkey'|'bind_wallet'|'bind_identity', otp_code }
 *
 * SEC-FACTOR-ADD-A（ADD-A PR-A2）— 有 TOTP 帳號的 factor-add elevation。
 * 驗第二因子（TOTP / backup code，OD-B 共用 helper）後鑄 short-lived elevated:factor_add grant
 * （elevation_grants，5min，one-time）。grant 只授權 factor-add（與 elevated:account 結構分離）。
 *
 * 回傳：
 *   200 → { grant_token, expires_in }
 *   400 → action / otp_code 缺或非法
 *   401 → access_token 無效 / OTP·backup 錯
 *   403 → sid 缺（fail-closed）/ 未啟用 2FA / banned
 *   429 → elevation_totp 節流
 */

import { requireAuth, res } from '../../../utils/auth'
import { checkRateLimit, recordRateLimit, clearRateLimit } from '../../../utils/rate-limit'
import { safeUserAudit } from '../../../utils/user-audit'
import { verifySecondFactor, mintFactorAddGrant, isFactorAddAction, sidFromUser } from '../../../utils/elevation'

const RL_WINDOW_SEC = 300
const RL_MAX        = 5

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error
  const userId = Number(user.sub)

  // sid fail-closed（PR-0 契約）：無 per-login sid 的 token 不得鑄 factor-add grant
  const sid = sidFromUser(user)
  if (!sid) return res({ error: 'Session not eligible for factor-add elevation; re-login required', code: 'ELEVATION_SID_REQUIRED' }, 403)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const { action, otp_code } = body ?? {}
  if (!isFactorAddAction(action))
    return res({ error: 'action must be add_passkey | bind_wallet | bind_identity', code: 'INVALID_ACTION' }, 400)
  if (!otp_code || typeof otp_code !== 'string')
    return res({ error: 'otp_code is required', code: 'OTP_CODE_REQUIRED' }, 400)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  const { blocked } = await checkRateLimit(db, { kind: 'elevation_totp', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked) {
    await safeUserAudit(env, { event_type: 'auth.elevation.failed', severity: 'warn', user_id: userId, request, data: { method: 'totp', action, reason: 'rate_limited' } })
    return res({ error: 'Too many elevation attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)
  }

  await safeUserAudit(env, { event_type: 'auth.elevation.started', user_id: userId, request, data: { method: 'totp', action } })

  const record = await db
    .prepare(`SELECT u.status, la.totp_secret, la.totp_enabled
              FROM users u JOIN local_accounts la ON la.user_id = u.id
              WHERE u.id = ? AND u.deleted_at IS NULL`)
    .bind(userId).first()

  if (!record || record.totp_enabled !== 1) {
    await recordRateLimit(db, { kind: 'elevation_totp', userId, ip })
    await safeUserAudit(env, { event_type: 'auth.elevation.failed', severity: 'warn', user_id: userId, request, data: { method: 'totp', action, reason: 'no_2fa' } })
    return res({ error: '2FA must be enabled to use this elevation method', code: 'ELEVATION_REQUIRES_2FA' }, 403)
  }
  if (record.status === 'banned')
    return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)

  const v = await verifySecondFactor(env, { userId, secret: record.totp_secret as string, code: otp_code })
  if (!v.ok) {
    await recordRateLimit(db, { kind: 'elevation_totp', userId, ip })
    await safeUserAudit(env, { event_type: 'auth.elevation.failed', severity: 'warn', user_id: userId, request, data: { method: 'totp', action, reason: v.reason } })
    return res({ error: 'Invalid OTP or backup code', code: 'INVALID_OTP_OR_BACKUP_CODE' }, 401)
  }

  await clearRateLimit(db, { kind: 'elevation_totp', userId })
  const grant = await mintFactorAddGrant(env, { userId, sessionId: sid, action, method: 'totp' })
  await safeUserAudit(env, { event_type: 'auth.elevation.succeeded', user_id: userId, request, data: { method: v.method ?? 'totp', action } })
  return res(grant)
}
