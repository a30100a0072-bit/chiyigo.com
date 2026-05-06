/**
 * GET /api/admin/requisition-refund
 * Header: Authorization: Bearer <access_token>  (scope: admin:requisitions; fallback admin role)
 *
 * Phase F-2 wave 7 — admin 退款申請列表（pending 優先）。
 *
 * Query string：
 *   status   pending|approved|rejected（預設 pending）
 *   page     預設 1
 *   limit    預設 50，上限 200
 *
 * 回傳：
 *   200 → { rows, total, page, limit }
 *
 * 為什麼用 admin role 守門而非新加 admin:requisitions scope：
 *   既有 /api/admin/requisitions 也是 requireRole('admin') pattern，沿用一致。
 *   實際退款動作走 step-up + elevated:payment（approve/reject endpoint），這裡只是讀。
 */

import { res } from '../../utils/auth.js'
import { requireRole } from '../../utils/requireRole.js'
import { getCorsHeaders } from '../../utils/cors.js'

const VALID_STATUS = new Set(['pending', 'approved', 'rejected'])

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env)
  const { error } = await requireRole(request, env, 'admin')
  if (error) return error

  const url    = new URL(request.url)
  const status = url.searchParams.get('status') ?? 'pending'
  if (!VALID_STATUS.has(status)) return res({ error: 'invalid status' }, 400, cors)
  const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const offset = (page - 1) * limit

  const db = env.chiyigo_db

  const [rowsResult, totalRow] = await Promise.all([
    db.prepare(`
      SELECT rrr.id, rrr.requisition_id, rrr.user_id, rrr.intent_id,
             rrr.reason, rrr.status, rrr.admin_user_id, rrr.admin_note,
             rrr.created_at, rrr.decided_at,
             r.name      AS req_name,
             r.contact   AS req_contact,
             r.company   AS req_company,
             r.status    AS req_status,
             pi.vendor          AS intent_vendor,
             pi.vendor_intent_id AS intent_vendor_intent_id,
             pi.amount_subunit  AS intent_amount_subunit,
             pi.currency        AS intent_currency,
             pi.status          AS intent_status
      FROM   requisition_refund_request rrr
      LEFT   JOIN requisition r       ON r.id  = rrr.requisition_id
      LEFT   JOIN payment_intents pi  ON pi.id = rrr.intent_id
      WHERE  rrr.status = ?
      ORDER  BY rrr.created_at DESC
      LIMIT  ? OFFSET ?
    `).bind(status, limit, offset).all(),
    db.prepare(`SELECT COUNT(*) AS c FROM requisition_refund_request WHERE status = ?`)
      .bind(status).first(),
  ])

  return res({
    rows:  rowsResult.results ?? [],
    total: totalRow?.c ?? 0,
    page,
    limit,
  }, 200, cors)
}
