/**
 * GET /api/admin/payments/aggregate
 *
 * P3-1（金流邏輯強化計畫，2026-05-06）— 充值日報 / 月報。
 *
 * Query：
 *   period   'daily' | 'monthly'  預設 daily
 *   from     ISO date（含）；預設 90 天前 daily / 12 月前 monthly
 *   to       ISO date（不含）；預設 now
 *   status   選擇性（預設 succeeded）
 *
 * 回傳：
 *   { period, buckets: [{ bucket, count, sum_subunit, refunded_count, refunded_sum_subunit }, ...] }
 *
 * 為什麼用 period bucket 不用 group by date(...)：
 *   D1 datetime 都是 UTC，需要 +8 hours 對齊台北時區的「日界」
 *
 * Scope: admin:payments
 */

import { res, requireAnyScope } from '../../../utils/auth'
import { getCorsHeaders } from '../../../utils/cors'
import { SCOPES } from '../../../utils/scopes'
import { PAYMENT_STATUS, isPaymentStatus } from '../../../utils/payments'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env)
  // P1-17 Phase 3: 任一金流 fine scope 即可讀（finance/support 透過 :read 通過）
  const { error } = await requireAnyScope(
    request, env,
    SCOPES.ADMIN_PAYMENTS_READ, SCOPES.ADMIN_PAYMENTS_WRITE,
    SCOPES.ADMIN_PAYMENTS_REFUND, SCOPES.ADMIN_PAYMENTS_APPROVE,
  )
  if (error) return error

  const url    = new URL(request.url)
  const period = url.searchParams.get('period') === 'monthly' ? 'monthly' : 'daily'
  const status = url.searchParams.get('status') ?? PAYMENT_STATUS.SUCCEEDED
  if (!isPaymentStatus(status)) return res({ error: 'invalid status', code: 'INVALID_STATUS' }, 400, cors)

  const from = url.searchParams.get('from') ?? null
  const to   = url.searchParams.get('to')   ?? null

  // bucket 表達式：台北 +8 對齊
  const bucketExpr = period === 'monthly'
    ? `strftime('%Y-%m', created_at, '+8 hours')`
    : `date(created_at, '+8 hours')`

  // Codex r5 P2：aggregate 預設過濾 soft-deleted（對帳基準應反映「真實有效」row）
  const conds: string[] = ['status = ?', 'deleted_at IS NULL']
  const binds: string[] = [status]
  if (from) { conds.push('created_at >= ?'); binds.push(from) }
  if (to)   { conds.push('created_at < ?');  binds.push(to) }
  const where = `WHERE ${conds.join(' AND ')}`

  // 主查詢：bucket 分組
  const main = await env.chiyigo_db
    .prepare(
      `SELECT ${bucketExpr} AS bucket,
              COUNT(*) AS count,
              COALESCE(SUM(amount_subunit), 0) AS sum_subunit
         FROM payment_intents
         ${where}
        GROUP BY bucket
        ORDER BY bucket DESC
        LIMIT 366`,
    )
    .bind(...binds).all()

  // 退款 bucket（refunded 狀態）— 同期間計算「成立後又退掉」的量
  const refundConds = ['status = ?', 'deleted_at IS NULL']
  const refundBinds = ['refunded']
  if (from) { refundConds.push('created_at >= ?'); refundBinds.push(from) }
  if (to)   { refundConds.push('created_at < ?');  refundBinds.push(to) }
  const refunded = await env.chiyigo_db
    .prepare(
      `SELECT ${bucketExpr} AS bucket,
              COUNT(*) AS refunded_count,
              COALESCE(SUM(amount_subunit), 0) AS refunded_sum_subunit
         FROM payment_intents
         WHERE ${refundConds.join(' AND ')}
        GROUP BY bucket`,
    )
    .bind(...refundBinds).all()

  type RefundRow = { bucket: string; refunded_count: number; refunded_sum_subunit: number }
  const refundMap = new Map(
    ((refunded.results ?? []) as RefundRow[]).map(r => [r.bucket, r] as const),
  )
  const buckets = (main.results ?? []).map(r => ({
    bucket:               r.bucket,
    count:                Number(r.count) || 0,
    sum_subunit:          Number(r.sum_subunit) || 0,
    refunded_count:       Number(refundMap.get(r.bucket)?.refunded_count) || 0,
    refunded_sum_subunit: Number(refundMap.get(r.bucket)?.refunded_sum_subunit) || 0,
  }))

  return res({ period, status, buckets }, 200, cors)
}
