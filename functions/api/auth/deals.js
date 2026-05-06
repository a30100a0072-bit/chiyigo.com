/**
 * GET /api/auth/deals
 * Header: Authorization: Bearer <access_token>
 *
 * P1-6（金流邏輯強化計畫，2026-05-06）— user 自己看自己的成交紀錄。
 *
 * Query string（皆 optional）：
 *   limit  預設 50，上限 200
 *
 * 回傳：
 *   200 → { rows: [...] }
 *
 * 不含敏感欄位：notes（admin 內部備註）、saved_by_admin_id 不回。
 */

import { res, requireAuth } from '../../utils/auth.js'
import { getCorsHeaders } from '../../utils/cors.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const url    = new URL(request.url)
  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))

  const { results } = await env.chiyigo_db
    .prepare(
      `SELECT id, source_requisition_id, customer_name, customer_company,
              service_type, budget, timeline,
              total_amount_subunit, refunded_amount_subunit, currency,
              payment_intent_ids, saved_at
         FROM deals
        WHERE user_id = ?
        ORDER BY saved_at DESC
        LIMIT ?`,
    )
    .bind(userId, limit).all()

  return res({ rows: results ?? [] }, 200, cors)
}
