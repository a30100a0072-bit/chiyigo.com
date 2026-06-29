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

import { requireAuth, res } from '../../utils/auth'
import { getCorsHeaders } from '../../utils/cors'
import { publicReasonCode } from '../../utils/credential-disposition'

export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const rs = await env.chiyigo_db
    .prepare(
      `SELECT id, address, chain_id, nickname, signed_at, last_used_at,
              requires_reverification, disposition_reason
         FROM user_wallets
        WHERE user_id = ?
        ORDER BY signed_at DESC`,
    )
    .bind(userId)
    .all()

  const wallets = (rs.results ?? []).map((r: Record<string, unknown>) => ({
    id:           r.id,
    address:      r.address,
    chain_id:     r.chain_id,
    nickname:     r.nickname,
    signed_at:    r.signed_at,
    last_used_at: r.last_used_at,
    // SEC-FACTOR-ADD-A PR-A4：user-visible disposition flag + 最小化 reason（不洩 raw high:<signal>）
    requires_reverification: !!r.requires_reverification,
    disposition_reason:      publicReasonCode(r.requires_reverification as number, r.disposition_reason as string | null),
  }))

  return res({ wallets }, 200, cors)
}
