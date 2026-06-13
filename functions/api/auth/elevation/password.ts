/**
 * POST /api/auth/elevation/password
 * Header: Authorization: Bearer <access_token>
 * Body:   { action: 'add_passkey'|'bind_wallet'|'bind_identity', current_password }
 *
 * SEC-FACTOR-ADD-A（ADD-A PR-A2）— local 有密碼、**無 TOTP** 帳號的 factor-add elevation。
 * 驗 current_password 後鑄 short-lived elevated:factor_add grant。
 *
 * 防降級（硬鎖）：totp_enabled=1 一律拒（要求走 /elevation/totp，不准用密碼降第二因子）。
 * OAuth-only（無 local password）→ 拒（要求走 OAuth-reauth elevation）。
 *
 * 回傳：
 *   200 → { grant_token, expires_in }
 *   400 → action / current_password 缺或非法
 *   401 → access_token 無效 / 密碼錯
 *   403 → sid 缺 / 已啟用 TOTP（防降級）/ 無 local 密碼 / banned
 *   429 → elevation_password 節流
 */

import { requireAuth, res } from '../../../utils/auth'
import { verifyPassword } from '../../../utils/crypto'
import { checkRateLimit, recordRateLimit, clearRateLimit } from '../../../utils/rate-limit'
import { safeUserAudit } from '../../../utils/user-audit'
import { mintFactorAddGrant, isFactorAddAction, sidFromUser } from '../../../utils/elevation'

const RL_WINDOW_SEC = 300
const RL_MAX        = 5

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error
  const userId = Number(user.sub)

  const sid = sidFromUser(user)
  if (!sid) return res({ error: 'Session not eligible for factor-add elevation; re-login required', code: 'ELEVATION_SID_REQUIRED' }, 403)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const { action, current_password } = body ?? {}
  if (!isFactorAddAction(action))
    return res({ error: 'action must be add_passkey | bind_wallet | bind_identity', code: 'INVALID_ACTION' }, 400)
  if (!current_password || typeof current_password !== 'string')
    return res({ error: 'current_password is required', code: 'CURRENT_PASSWORD_REQUIRED' }, 400)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  const { blocked } = await checkRateLimit(db, { kind: 'elevation_password', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked) {
    await safeUserAudit(env, { event_type: 'auth.elevation.failed', severity: 'warn', user_id: userId, request, data: { method: 'current_password', action, reason: 'rate_limited' } })
    return res({ error: 'Too many elevation attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)
  }

  await safeUserAudit(env, { event_type: 'auth.elevation.started', user_id: userId, request, data: { method: 'current_password', action } })

  const record = await db
    .prepare(`SELECT u.status, la.password_hash, la.password_salt, la.totp_enabled
              FROM users u LEFT JOIN local_accounts la ON la.user_id = u.id
              WHERE u.id = ? AND u.deleted_at IS NULL`)
    .bind(userId).first()

  if (!record) return res({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404)
  if (record.status === 'banned') return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)

  // 防降級：有 TOTP 一律走 /elevation/totp，不准用密碼當第二因子
  if (record.totp_enabled === 1) {
    await safeUserAudit(env, { event_type: 'auth.elevation.failed', severity: 'warn', user_id: userId, request, data: { method: 'current_password', action, reason: 'totp_enabled_use_totp' } })
    return res({ error: 'This account has 2FA; use the TOTP elevation method', code: 'ELEVATION_USE_TOTP' }, 403)
  }
  // OAuth-only（無 local 密碼）→ 走 OAuth-reauth elevation
  if (!record.password_hash || !record.password_salt) {
    await safeUserAudit(env, { event_type: 'auth.elevation.failed', severity: 'warn', user_id: userId, request, data: { method: 'current_password', action, reason: 'no_password' } })
    return res({ error: 'No password set; use OAuth re-auth elevation', code: 'ELEVATION_NO_PASSWORD' }, 403)
  }

  const valid = await verifyPassword(current_password, record.password_salt as string, record.password_hash as string)
  if (!valid) {
    await recordRateLimit(db, { kind: 'elevation_password', userId, ip })
    await safeUserAudit(env, { event_type: 'auth.elevation.failed', severity: 'warn', user_id: userId, request, data: { method: 'current_password', action, reason: 'bad_password' } })
    return res({ error: 'Invalid password', code: 'INVALID_PASSWORD' }, 401)
  }

  await clearRateLimit(db, { kind: 'elevation_password', userId })
  const grant = await mintFactorAddGrant(env, { userId, sessionId: sid, action, method: 'current_password' })
  await safeUserAudit(env, { event_type: 'auth.elevation.succeeded', user_id: userId, request, data: { method: 'current_password', action } })
  return res(grant)
}
