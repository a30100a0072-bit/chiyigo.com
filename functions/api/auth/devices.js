/**
 * GET  /api/auth/devices
 * POST /api/auth/devices/logout
 * Header: Authorization: Bearer <access_token>
 *
 * Phase D-3a — 裝置列表 / 單裝置登出。
 *
 * 資料來源：refresh_tokens 表 group by device_uuid。
 *   - device_uuid 為 NULL = Web 瀏覽器 session（所有同 user 的 web cookie chain
 *     一起算一個 virtual device "web"，dashboard 列表時顯示 "瀏覽器" 即可）
 *   - last_seen 用 MAX(auth_time) 近似（rotation 保留原 auth_time，所以這個值
 *     ≈ 該 device 上次互動式登入時間，不是上次 silent refresh）
 *   - active_count = revoked_at IS NULL AND expires_at > now
 *
 * GET 回傳：
 *   200 → { devices: [{ device_uuid, last_seen, first_seen, active_count, total_count }] }
 *
 * POST /logout：
 *   Body: { device_uuid: string | null }
 *     - 字串 → 撤該 (user_id, device_uuid) 所有未撤銷 refresh_tokens
 *     - null → 撤該 user 所有 web (device_uuid IS NULL) refresh_tokens
 *   不需 step-up：登自己的 session 屬常規 UX；誤操作最多重新 login。
 *   audit `auth.devices.logout` info 級。
 *
 * 200 → { revoked: <count> }
 * 400 → device_uuid 型別錯
 * 401 → access_token 無效
 * 404 → 該 user 沒有此 device 任何 refresh_tokens（無論已撤未撤）
 */

import { requireAuth, res } from '../../utils/auth.js'
import { getCorsHeaders } from '../../utils/cors.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const rs = await env.chiyigo_db
    .prepare(
      `SELECT device_uuid,
              MAX(auth_time) AS last_seen,
              MIN(auth_time) AS first_seen,
              COUNT(*) AS total_count,
              SUM(CASE WHEN revoked_at IS NULL AND expires_at > datetime('now')
                       THEN 1 ELSE 0 END) AS active_count
         FROM refresh_tokens
        WHERE user_id = ?
        GROUP BY device_uuid
        ORDER BY MAX(auth_time) DESC NULLS LAST`,
    )
    .bind(userId)
    .all()

  const devices = (rs.results ?? []).map(r => ({
    device_uuid:  r.device_uuid,                    // null = web
    last_seen:    r.last_seen,
    first_seen:   r.first_seen,
    active_count: Number(r.active_count ?? 0),
    total_count:  Number(r.total_count ?? 0),
  }))

  return res({ devices }, 200, cors)
}
