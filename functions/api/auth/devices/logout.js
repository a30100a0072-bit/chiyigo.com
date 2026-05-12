/**
 * POST /api/auth/devices/logout
 * Header: Authorization: Bearer <access_token>
 * Body:   { device_uuid: string | null }
 *
 * Phase D-3a — 從 dashboard「登出此裝置」按鈕觸發。
 *
 * 撤該 user 在指定 device 上**所有未撤銷**的 refresh_tokens；不撤已撤或過期的（
 * idempotent，誤點兩下不擲錯）。撤完後該 device 上現有 access_token 仍然
 * valid 直到 15 分鐘 TTL 自然過期 — 這是 stateless JWT 的本質取捨；要立刻
 * kick off 走 admin/revoke 的 user-wide bumpTokenVersion。
 *
 * 為何不需 step-up：
 *   - 自己登自己的裝置，誤操作最多重 login，無法用來打別人
 *   - step-up UX 太重會讓用戶懶得登出舊裝置 → 安全反而更差
 *
 * 回傳：
 *   200 → { revoked: <count> }
 *   400 → device_uuid 不是 string|null
 *   401 → access_token 無效
 *   404 → 該 user 在此 device 沒任何 refresh_tokens（防瞎刪別人 device 的探測）
 */

import { requireAuth, res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { safeUserAudit, hashIdentifierForAudit } from '../../../utils/user-audit.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400, cors) }

  const dev = body?.device_uuid
  if (dev !== null && typeof dev !== 'string') {
    return res({ error: 'device_uuid must be string or null', code: 'INVALID_DEVICE_UUID' }, 400, cors)
  }

  // 先確認該 user 在此 device 真的有 row（無論已撤未撤）— 否則 404，避免 attacker
  // 用其他 user 的 device_uuid 來探測「該 device 是否屬於某 user」（雖然 device_uuid
  // 是 client 自己生 random UUID，理論探測沒意義，但 defense-in-depth 一致 pattern）
  const exists = dev === null
    ? await env.chiyigo_db
        .prepare(`SELECT 1 FROM refresh_tokens
                   WHERE user_id = ? AND device_uuid IS NULL LIMIT 1`)
        .bind(userId).first()
    : await env.chiyigo_db
        .prepare(`SELECT 1 FROM refresh_tokens
                   WHERE user_id = ? AND device_uuid = ? LIMIT 1`)
        .bind(userId, dev).first()
  if (!exists) return res({ error: 'Device not found', code: 'DEVICE_NOT_FOUND' }, 404, cors)

  const upd = dev === null
    ? await env.chiyigo_db
        .prepare(`UPDATE refresh_tokens
                     SET revoked_at = datetime('now')
                   WHERE user_id = ? AND device_uuid IS NULL AND revoked_at IS NULL`)
        .bind(userId).run()
    : await env.chiyigo_db
        .prepare(`UPDATE refresh_tokens
                     SET revoked_at = datetime('now')
                   WHERE user_id = ? AND device_uuid = ? AND revoked_at IS NULL`)
        .bind(userId, dev).run()

  const revoked = upd.meta?.changes ?? 0

  // Codex r9-4：device_uuid_prefix → keyed HMAC（domain='device-uuid'，與 device-alerts 同 domain）
  const sig = dev === null ? null : await hashIdentifierForAudit(env, 'device-uuid', dev)
  await safeUserAudit(env, {
    event_type: 'auth.devices.logout',
    severity:   'info',
    user_id:    userId,
    request,
    data: {
      device_uuid_hmac16: sig === null ? null : sig.hex.slice(0, 16),
      salted:             sig === null ? null : sig.salted,
      revoked_count:      revoked,
    },
  })

  return res({ revoked }, 200, cors)
}
