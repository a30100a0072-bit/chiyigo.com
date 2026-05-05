/**
 * GET /api/auth/wallet
 * Header: Authorization: Bearer <access_token>
 *
 * Phase F-3 — 列當前 user 已綁定的 wallet。
 * dashboard 顯示 / 提款前確認用。
 *
 * 回傳：
 *   200 → { wallets: [{ id, address, chain_id, nickname, signed_at, last_used_at }] }
 *   401 → access_token 無效
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
      `SELECT id, address, chain_id, nickname, signed_at, last_used_at
         FROM user_wallets
        WHERE user_id = ?
        ORDER BY signed_at DESC`,
    )
    .bind(userId)
    .all()

  return res({ wallets: rs.results ?? [] }, 200, cors)
}
