/**
 * GET /api/admin/payments/intents
 * Header: Authorization: Bearer <access_token>  (scope: admin:payments)
 *
 * Phase F-2 wave 4 — admin 對帳列表。
 *
 * Query string（皆 optional）：
 *   user_id   number
 *   status    pending|processing|succeeded|failed|canceled|refunded
 *   vendor    mock|ecpay|...
 *   from      ISO datetime（含）
 *   to        ISO datetime（不含）
 *   page      預設 1
 *   limit     預設 50，上限 200
 *
 * 回傳：
 *   200 → { rows, total, page, limit, totals: { count_by_status, sum_subunit_succeeded } }
 *   401/403 → 未授權
 *   400 → 參數錯
 */

import { res, requireScope } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { SCOPES } from '../../../utils/scopes.js'
import { PAYMENT_STATUS } from '../../../utils/payments.js'

const VALID_STATUSES = new Set(Object.values(PAYMENT_STATUS))

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env)
  const { error } = await requireScope(request, env, SCOPES.ADMIN_PAYMENTS)
  if (error) return error

  const url   = new URL(request.url)
  const page  = Math.max(1,  parseInt(url.searchParams.get('page')  ?? '1',  10))
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const offset = (page - 1) * limit

  const conds = []
  const binds = []

  const userId = url.searchParams.get('user_id')
  if (userId) {
    const n = Number(userId)
    if (!Number.isFinite(n)) return res({ error: 'user_id must be a number' }, 400, cors)
    conds.push('user_id = ?'); binds.push(n)
  }

  const status = url.searchParams.get('status')
  if (status) {
    if (!VALID_STATUSES.has(status)) return res({ error: 'invalid status' }, 400, cors)
    conds.push('status = ?'); binds.push(status)
  }

  const vendor = url.searchParams.get('vendor')
  if (vendor) { conds.push('vendor = ?'); binds.push(vendor) }

  const from = url.searchParams.get('from')
  if (from) { conds.push('created_at >= ?'); binds.push(from) }
  const to   = url.searchParams.get('to')
  if (to)   { conds.push('created_at < ?');  binds.push(to) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  // 主清單（含 metadata；admin 對帳要看 requisition_id / payment_info）
  const rowsResult = await env.chiyigo_db
    .prepare(
      `SELECT id, user_id, vendor, vendor_intent_id, kind, status,
              amount_subunit, amount_raw, currency, metadata, failure_reason,
              requisition_id, created_at, updated_at
         FROM payment_intents ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all()

  // 總筆數（同 where）
  const totalRow = await env.chiyigo_db
    .prepare(`SELECT COUNT(*) AS c FROM payment_intents ${where}`)
    .bind(...binds).first()

  // 對帳：count by status + sum 成功金額
  const aggRows = await env.chiyigo_db
    .prepare(
      `SELECT status, COUNT(*) AS cnt, SUM(COALESCE(amount_subunit, 0)) AS amt
         FROM payment_intents ${where}
        GROUP BY status`,
    )
    .bind(...binds).all()

  const countByStatus = {}
  let sumSucceededSubunit = 0
  for (const r of (aggRows.results ?? [])) {
    countByStatus[r.status] = r.cnt
    if (r.status === PAYMENT_STATUS.SUCCEEDED) sumSucceededSubunit = Number(r.amt) || 0
  }

  return res({
    rows:  rowsResult.results ?? [],
    total: totalRow?.c ?? 0,
    page,
    limit,
    totals: {
      count_by_status:        countByStatus,
      sum_subunit_succeeded:  sumSucceededSubunit,
    },
  }, 200, cors)
}
