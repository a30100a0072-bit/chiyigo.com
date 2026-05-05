/**
 * GET /api/auth/payments/intents/:id
 * Header: Authorization: Bearer <access_token>
 *
 * Phase F-2 — 單筆 intent 詳情。雙欄 (id, user_id) 過濾防越權。
 *
 * 回傳：
 *   200 → intent row
 *   401 → access_token 無效
 *   404 → 不存在 / 越權
 */

import { res } from '../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../utils/cors.js'
import { requirePaymentAccess, getPaymentIntent } from '../../../../utils/payments.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestGet({ request, env, params }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requirePaymentAccess(request, env, { skipKyc: true })
  if (error) return error

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404, cors)

  const row = await getPaymentIntent(env, { id })
  if (!row || row.user_id !== Number(user.sub)) {
    return res({ error: 'not_found' }, 404, cors)
  }
  return res(row, 200, cors)
}
