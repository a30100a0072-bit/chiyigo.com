/**
 * GET /api/admin/deals/aggregate
 *
 * P3-1（金流邏輯強化計畫，2026-05-06）— 成交日報 / 月報。
 *
 * Query：
 *   period   'daily' | 'monthly'  預設 monthly
 *   from / to ISO date
 *
 * 回傳：
 *   { period, buckets: [{ bucket, count, sum_total_subunit, sum_refunded_subunit, net_subunit }, ...] }
 *
 * 用 saved_at 為 bucket 基準（admin 「保存」當下視為成交時間）。
 */

import { res } from '../../../utils/auth.js'
import { requireRole } from '../../../utils/requireRole.js'
import { getCorsHeaders } from '../../../utils/cors.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env)
  const role = await requireRole(request, env, 'admin')
  if (role.error) return role.error

  const url    = new URL(request.url)
  const period = url.searchParams.get('period') === 'daily' ? 'daily' : 'monthly'
  const from   = url.searchParams.get('from') ?? null
  const to     = url.searchParams.get('to')   ?? null

  const bucketExpr = period === 'monthly'
    ? `strftime('%Y-%m', saved_at, '+8 hours')`
    : `date(saved_at, '+8 hours')`

  const conds = []
  const binds = []
  if (from) { conds.push('saved_at >= ?'); binds.push(from) }
  if (to)   { conds.push('saved_at < ?');  binds.push(to) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const main = await env.chiyigo_db
    .prepare(
      `SELECT ${bucketExpr} AS bucket,
              COUNT(*) AS count,
              COALESCE(SUM(total_amount_subunit), 0)    AS sum_total_subunit,
              COALESCE(SUM(refunded_amount_subunit), 0) AS sum_refunded_subunit
         FROM deals
         ${where}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT 366`,
    )
    .bind(...binds).all()

  const buckets = (main.results ?? []).map(r => {
    const total    = Number(r.sum_total_subunit) || 0
    const refunded = Number(r.sum_refunded_subunit) || 0
    return {
      bucket:                r.bucket,
      count:                 Number(r.count) || 0,
      sum_total_subunit:     total,
      sum_refunded_subunit:  refunded,
      net_subunit:           total - refunded,
    }
  })

  return res({ period, buckets }, 200, cors)
}
