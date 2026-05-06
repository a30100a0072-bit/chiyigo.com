/**
 * GET /api/auth/payments/intents
 * Header: Authorization: Bearer <access_token>
 *
 * Phase F-2 — 列當前 user 的 payment intents（dashboard 交易紀錄用）。
 *
 * 一般查詢不要求 KYC（用 skipKyc=true）；提款 / 充值動作才走 requirePaymentAccess 預設。
 *
 * Query string：
 *   ?status=pending         過濾單一狀態
 *   ?kind=deposit           過濾 kind
 *   ?limit=50               1–100，預設 20
 *
 * 回傳：
 *   200 → { items: [...], count }
 *   401 → access_token 無效
 */

import { res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { requirePaymentAccess, PAYMENT_STATUS, PAYMENT_KIND } from '../../../utils/payments.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requirePaymentAccess(request, env, { skipKyc: true })
  if (error) return error

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const kind   = url.searchParams.get('kind')
  let limit    = Number(url.searchParams.get('limit') || 20)
  if (!Number.isFinite(limit) || limit < 1) limit = 20
  if (limit > 100) limit = 100

  const where = ['user_id = ?']
  const binds = [Number(user.sub)]
  if (status && Object.values(PAYMENT_STATUS).includes(status)) {
    where.push('status = ?'); binds.push(status)
  }
  if (kind && Object.values(PAYMENT_KIND).includes(kind)) {
    where.push('kind = ?'); binds.push(kind)
  }

  const rows = await env.chiyigo_db
    .prepare(
      `SELECT pi.id, pi.vendor, pi.vendor_intent_id, pi.kind, pi.status,
              pi.amount_subunit, pi.amount_raw, pi.currency, pi.failure_reason,
              pi.metadata,
              pi.created_at, pi.updated_at,
              rr.id AS refund_request_id,
              rr.status AS refund_request_status,
              rr.created_at AS refund_request_created_at
         FROM payment_intents pi
         LEFT JOIN requisition_refund_request rr
           ON rr.intent_id = pi.id AND rr.status = 'pending'
        WHERE ${where.map(c => 'pi.' + c).join(' AND ')}
        ORDER BY pi.created_at DESC
        LIMIT ?`,
    )
    .bind(...binds, limit)
    .all()

  return res({ items: rows.results ?? [], count: (rows.results ?? []).length }, 200, cors)
}
