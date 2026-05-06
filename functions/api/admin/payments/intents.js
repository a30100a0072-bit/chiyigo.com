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
import { safeUserAudit } from '../../../utils/user-audit.js'
import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit.js'

const VALID_STATUSES = new Set(Object.values(PAYMENT_STATUS))

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env)
  const { user, error } = await requireScope(request, env, SCOPES.ADMIN_PAYMENTS)
  if (error) return error

  // T15 admin rate limit：60 read/min per admin（CSV export 也算）
  const adminId = Number(user.sub)
  const rl = await checkRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId, windowSeconds: 60, max: 60 })
  if (rl.blocked) {
    await safeUserAudit(env, { event_type: 'admin.read.rate_limited', severity: 'warn', user_id: adminId, request, data: { endpoint: 'payments.intents' } })
    return res({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429, cors)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId })

  const url    = new URL(request.url)
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json'
  // CSV 模式：硬上限 50000 row 一次撈，避免 worker 記憶體炸
  const page  = Math.max(1,  parseInt(url.searchParams.get('page')  ?? '1',  10))
  const limit = format === 'csv'
    ? Math.min(50000, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50000', 10)))
    : Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))
  const offset = format === 'csv' ? 0 : (page - 1) * limit

  const conds = []
  const binds = []

  const userId = url.searchParams.get('user_id')
  if (userId) {
    const n = Number(userId)
    if (!Number.isFinite(n)) return res({ error: 'user_id must be a number' }, 400, cors)
    conds.push('pi.user_id = ?'); binds.push(n)
  }

  const status = url.searchParams.get('status')
  if (status) {
    if (!VALID_STATUSES.has(status)) return res({ error: 'invalid status' }, 400, cors)
    conds.push('pi.status = ?'); binds.push(status)
  }

  const vendor = url.searchParams.get('vendor')
  if (vendor) { conds.push('pi.vendor = ?'); binds.push(vendor) }

  const from = url.searchParams.get('from')
  if (from) { conds.push('pi.created_at >= ?'); binds.push(from) }
  const to   = url.searchParams.get('to')
  if (to)   { conds.push('pi.created_at < ?');  binds.push(to) }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  // count / aggregate 不需要 join（refund 資訊只有列表頁要）→ 用無 prefix 版本
  const wherePlain = where.replace(/\bpi\./g, '')

  // 主清單（含 metadata；admin 對帳要看 requisition_id / payment_info）
  const rowsResult = await env.chiyigo_db
    .prepare(
      `SELECT pi.id, pi.user_id, pi.vendor, pi.vendor_intent_id, pi.kind, pi.status,
              pi.amount_subunit, pi.amount_raw, pi.currency, pi.metadata, pi.failure_reason,
              pi.requisition_id, pi.created_at, pi.updated_at,
              rr.id         AS refund_request_id,
              rr.status     AS refund_request_status,
              rr.created_at AS refund_request_created_at,
              rr.reason     AS refund_request_reason
         FROM payment_intents pi
         LEFT JOIN requisition_refund_request rr
           ON rr.intent_id = pi.id AND rr.status = 'pending'
         ${where}
        ORDER BY pi.created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .bind(...binds, limit, offset)
    .all()

  // T14: 讀取 audit（info）— 誰在何時看了哪些 filter / 撈到幾筆
  await safeUserAudit(env, {
    event_type: format === 'csv' ? 'admin.payments.intents.exported' : 'admin.payments.intents.read',
    severity: 'info', user_id: Number(user.sub), request,
    data: {
      filters: { status, vendor, user_id: userId, from, to, format },
      result_count: rowsResult.results?.length ?? 0,
    },
  })

  // CSV 直接回傳，不算 totals／aggregate
  if (format === 'csv') {
    return csvResponse(rowsResult.results ?? [], cors, 'payment-records')
  }

  // 總筆數（同 where；不 join refund_request 加速）
  const totalRow = await env.chiyigo_db
    .prepare(`SELECT COUNT(*) AS c FROM payment_intents ${wherePlain}`)
    .bind(...binds).first()

  // 對帳：count by status + sum 成功金額
  const aggRows = await env.chiyigo_db
    .prepare(
      `SELECT status, COUNT(*) AS cnt, SUM(COALESCE(amount_subunit, 0)) AS amt
         FROM payment_intents ${wherePlain}
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

// T9（2026-05-06）：CSV 直接從 worker 產出，避免前端跑 500 頁分頁迴圈撞 401 / OOM
function csvCell(v) {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
function csvResponse(rows, cors, baseName) {
  const header = ['id','user_id','vendor','vendor_intent_id','kind','status',
                  'amount_subunit','amount_raw','currency','requisition_id',
                  'refund_request_status','created_at','updated_at']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push(header.map(h => csvCell(r[h])).join(','))
  }
  // BOM 讓 Excel 正確顯示中文
  const body = '﻿' + lines.join('\r\n')
  const date = new Date().toISOString().slice(0, 10)
  return new Response(body, {
    status: 200,
    headers: {
      ...cors,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${baseName}-${date}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
