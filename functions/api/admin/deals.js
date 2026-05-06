/**
 * GET /api/admin/deals
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * P1-5（金流邏輯強化計畫，2026-05-06）— admin 成交紀錄列表頁。
 *
 * Query string（皆 optional）：
 *   user_id   number
 *   from      ISO date（含）
 *   to        ISO date（不含）
 *   q         模糊搜 customer_name / customer_contact
 *   page      預設 1
 *   limit     預設 50，上限 200
 *
 * 回傳：
 *   200 → { rows, total, page, limit, totals: { count, sum_total_subunit, sum_refunded_subunit } }
 */

import { res } from '../../utils/auth.js'
import { requireRole } from '../../utils/requireRole.js'
import { getCorsHeaders } from '../../utils/cors.js'
import { safeUserAudit } from '../../utils/user-audit.js'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env)
  const role = await requireRole(request, env, 'admin')
  if (role.error) return role.error

  // T15 admin rate limit
  const adminId = Number(role.user.sub)
  const rl = await checkRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId, windowSeconds: 60, max: 60 })
  if (rl.blocked) {
    await safeUserAudit(env, { event_type: 'admin.read.rate_limited', severity: 'warn', user_id: adminId, request, data: { endpoint: 'deals' } })
    return res({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429, cors)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId })

  const url    = new URL(request.url)
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json'
  const page   = Math.max(1,  parseInt(url.searchParams.get('page')  ?? '1',  10))
  const limit  = format === 'csv'
    ? Math.min(50000, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50000', 10)))
    : Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const offset = format === 'csv' ? 0 : (page - 1) * limit

  const conds = []
  const binds = []

  const userId = url.searchParams.get('user_id')
  if (userId) {
    const n = Number(userId)
    if (!Number.isFinite(n)) return res({ error: 'user_id must be a number' }, 400, cors)
    conds.push('user_id = ?'); binds.push(n)
  }
  const from = url.searchParams.get('from')
  if (from) { conds.push('saved_at >= ?'); binds.push(from) }
  const to   = url.searchParams.get('to')
  if (to)   { conds.push('saved_at < ?');  binds.push(to) }

  const q = url.searchParams.get('q')
  if (q) {
    conds.push('(customer_name LIKE ? OR customer_contact LIKE ? OR customer_company LIKE ?)')
    const like = `%${q}%`
    binds.push(like, like, like)
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const rowsResult = await env.chiyigo_db
    .prepare(
      `SELECT id, source_requisition_id, user_id, customer_name, customer_contact,
              customer_company, service_type, budget, timeline,
              total_amount_subunit, refunded_amount_subunit, currency,
              payment_intent_ids, notes, saved_by_admin_id, saved_at
         FROM deals ${where}
        ORDER BY saved_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all()

  // T14 read audit
  await safeUserAudit(env, {
    event_type: format === 'csv' ? 'admin.deals.exported' : 'admin.deals.read',
    severity: 'info', user_id: Number(role.user.sub), request,
    data: {
      filters: { user_id: userId, q, from, to, format },
      result_count: rowsResult.results?.length ?? 0,
    },
  })

  if (format === 'csv') {
    return csvResponse(rowsResult.results ?? [], cors)
  }

  const totalRow = await env.chiyigo_db
    .prepare(`SELECT COUNT(*) AS c,
                     COALESCE(SUM(total_amount_subunit), 0)    AS s_total,
                     COALESCE(SUM(refunded_amount_subunit), 0) AS s_refund
                FROM deals ${where}`)
    .bind(...binds).first()

  return res({
    rows:  rowsResult.results ?? [],
    total: totalRow?.c ?? 0,
    page,
    limit,
    totals: {
      count:                totalRow?.c ?? 0,
      sum_total_subunit:    Number(totalRow?.s_total ?? 0),
      sum_refunded_subunit: Number(totalRow?.s_refund ?? 0),
    },
  }, 200, cors)
}

function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function csvResponse(rows, cors) {
  const header = ['id','source_requisition_id','user_id','customer_name','customer_contact',
                  'customer_company','service_type','budget','timeline',
                  'total_amount_subunit','refunded_amount_subunit','currency',
                  'payment_intent_ids','saved_at']
  const lines = [header.join(',')]
  for (const r of rows) lines.push(header.map(h => csvCell(r[h])).join(','))
  const body = '﻿' + lines.join('\r\n')
  const date = new Date().toISOString().slice(0, 10)
  return new Response(body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="deals-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
