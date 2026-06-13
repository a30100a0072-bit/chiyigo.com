/**
 * POST /api/auth/elevation/exchange
 * Header: Authorization: Bearer <access_token>
 * Body:   { code }   (OAuth-reauth callback 經 fragment 交付的 one-time exchange code)
 *
 * SEC-FACTOR-ADD-A（ADD-A PR-A2，OD-3）— OAuth-reauth elevation 的最後一步。
 * atomic 消費 elevation_exchanges（user_id + session_id 綁定 + 未過期 + 未消費），鑄
 * elevated:factor_add grant（method=oauth_reauth，沿用 exchange row 的 provider / provider_id_hash /
 * action）。code 明文不入 DB（只比對 hashToken）。grant_token 僅經 body 交付、不入 URL。
 *
 * 回傳：
 *   200 → { grant_token, expires_in }
 *   400 → code 缺
 *   401 → access_token 無效 / code 無效·過期·已消費·不屬本 session（replay_detected）
 *   403 → sid 缺（fail-closed）
 *   429 → elevation_exchange 節流
 */

import { requireAuth, res } from '../../../utils/auth'
import { hashToken } from '../../../utils/crypto'
import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit'
import { safeUserAudit } from '../../../utils/user-audit'
import { mintFactorAddGrant, sidFromUser } from '../../../utils/elevation'

const RL_WINDOW_SEC = 300
const RL_MAX        = 10

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error
  const userId = Number(user.sub)

  const sid = sidFromUser(user)
  if (!sid) return res({ error: 'Session not eligible for factor-add elevation; re-login required', code: 'ELEVATION_SID_REQUIRED' }, 403)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const { code } = body ?? {}
  if (!code || typeof code !== 'string')
    return res({ error: 'code is required', code: 'EXCHANGE_CODE_REQUIRED' }, 400)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  const { blocked } = await checkRateLimit(db, { kind: 'elevation_exchange', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked)
    return res({ error: 'Too many exchange attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)

  const codeHash = await hashToken(code)
  // atomic one-time consume：UPDATE consumed_at CAS + RETURNING；綁 user_id + session_id（sid）。
  // 已消費 / 過期 / 不屬本 session → 0 row → replay_detected。
  const row = await db
    .prepare(`
      UPDATE elevation_exchanges SET consumed_at = datetime('now')
      WHERE exchange_code_hash = ? AND user_id = ? AND session_id = ?
        AND consumed_at IS NULL AND expires_at > datetime('now')
      RETURNING provider, provider_id_hash, action
    `)
    .bind(codeHash, userId, sid).first()

  if (!row) {
    await recordRateLimit(db, { kind: 'elevation_exchange', userId, ip })
    await safeUserAudit(env, { event_type: 'auth.elevation.replay_detected', severity: 'critical', user_id: userId, request, data: { stage: 'exchange' } })
    return res({ error: 'Exchange code invalid, expired, or already used', code: 'EXCHANGE_CODE_INVALID' }, 401)
  }

  const grant = await mintFactorAddGrant(env, {
    userId, sessionId: sid,
    action: row.action as string,
    method: 'oauth_reauth',
    provider: (row.provider as string) ?? null,
    providerIdHash: (row.provider_id_hash as string) ?? null,
  })
  await safeUserAudit(env, { event_type: 'auth.elevation.succeeded', user_id: userId, request, data: { method: 'oauth_reauth', action: row.action } })
  return res(grant)
}
