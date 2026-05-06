/**
 * GET /api/admin/payments/webhook-dlq
 *
 * T17（Wave 4 觀測層，2026-05-06）— 列出 payment webhook DLQ rows。
 *
 * Query：
 *   pending  '1' = 只列未 replay 的（預設）；'0' = 全部
 *   vendor   ecpay/mock/...
 *   limit    預設 50，上限 200
 *
 * 回傳：{ rows: [...] }
 *
 * 為什麼只 read 不 replay：replay 涉及重跑 webhook handler，邏輯複雜
 *   且需要重新驗章；先給 admin 看內容判斷該不該手動補資料，replay UI 留待真有需求
 *   再實作（YAGNI）。
 */

import { res } from '../../../utils/auth.js'
import { requireRole } from '../../../utils/requireRole.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env)
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  const url     = new URL(request.url)
  const pending = url.searchParams.get('pending') !== '0'
  const vendor  = url.searchParams.get('vendor')
  const limit   = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)))

  const conds = []
  const binds = []
  if (pending) conds.push('replayed_at IS NULL')
  if (vendor)  { conds.push('vendor = ?'); binds.push(vendor) }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const { results } = await env.chiyigo_db
    .prepare(
      `SELECT id, vendor, event_id, vendor_intent_id,
              raw_body, payload_hash, error_stage, error_message,
              http_status_returned, created_at, replayed_at, replayed_by, replay_result
         FROM payment_webhook_dlq
         ${where}
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(...binds, limit).all()

  // T14 read audit — DLQ 含 raw_body，讀取也要可追溯
  await safeUserAudit(env, {
    event_type: 'admin.payment_webhook_dlq.read', severity: 'info',
    user_id: Number(user.sub), request,
    data: { filters: { pending, vendor }, result_count: results?.length ?? 0 },
  })

  return res({ rows: results ?? [] }, 200, cors)
}
