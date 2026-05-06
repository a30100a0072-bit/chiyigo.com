/**
 * POST /api/payments/intents/:id/refund-request
 * Header: Authorization: Bearer <access_token>
 * Body: { reason }  // reason 為必填
 *
 * Phase F-2 wave 8 — user 對任意自己的 succeeded payment_intent 申請退款。
 * 不要求綁定需求單；若 intent.metadata.requisition_id 有值會帶入 refund_request
 * 並把 requisition.status 改 refund_pending（沿用 wave 7 行為）。
 *
 * 防護：
 *   - IDOR：intent.user_id 必須等於 request user
 *   - 狀態：intent 必須是 succeeded
 *   - 防重複：同 intent 已有 pending refund_request → 409
 */

import { requireAuth, res } from '../../../../utils/auth.js'
import { safeUserAudit } from '../../../../utils/user-audit.js'
import { syncRequisitionTgMessage } from '../../../../utils/tg-requisition.js'

export async function onRequestPost({ request, env, params }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const intentId = Number(params?.id)
  if (!Number.isFinite(intentId) || intentId < 1) return res({ error: 'not_found' }, 404)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }
  const reason = String(body?.reason ?? '').trim()
  if (!reason) return res({ error: '退款原因必填', code: 'REASON_REQUIRED' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  const intent = await db
    .prepare(`SELECT id, user_id, status, metadata, amount_subunit, currency, vendor
                FROM payment_intents WHERE id = ?`)
    .bind(intentId).first()
  if (!intent || Number(intent.user_id) !== userId) return res({ error: 'not_found' }, 404)
  if (intent.status !== 'succeeded') {
    return res({ error: '只有已成功的充值可申請退款', code: 'INVALID_STATUS', actual_status: intent.status }, 409)
  }

  let metaParsed = null
  try { metaParsed = intent.metadata ? JSON.parse(intent.metadata) : null } catch { /* ignore */ }
  let reqId = metaParsed?.requisition_id != null ? Number(metaParsed.requisition_id) : null
  if (!Number.isFinite(reqId) || reqId < 1) reqId = null

  // 若 intent 綁了 req，確認該 req 還存在且屬於本 user
  if (reqId) {
    const reqRow = await db
      .prepare(`SELECT id, user_id, status FROM requisition WHERE id = ? AND deleted_at IS NULL`)
      .bind(reqId).first()
    if (!reqRow || Number(reqRow.user_id) !== userId) reqId = null  // 失聯就當未綁
  }

  // 防重複申請（依 intent_id 鎖；同一筆 succeeded 只能申請一次）
  const existing = await db
    .prepare(`SELECT id FROM requisition_refund_request
               WHERE intent_id = ? AND status = 'pending' LIMIT 1`)
    .bind(intentId).first()
  if (existing) {
    return res({
      error: '此筆充值已申請退款，請等候 admin 審核',
      code:  'REFUND_ALREADY_PENDING',
      refund_request_id: existing.id,
    }, 409)
  }

  const reasonClipped = reason.slice(0, 500)
  // P2-4: 同步 backfill amount_subunit（目前一律全額退；為部分退款留路）
  const amountSubunit = intent?.amount_subunit ?? null
  const inserted = await db
    .prepare(`INSERT INTO requisition_refund_request
               (requisition_id, user_id, intent_id, reason, amount_subunit)
               VALUES (?, ?, ?, ?, ?)
               RETURNING id`)
    .bind(reqId, userId, intentId, reasonClipped, amountSubunit)
    .first()

  if (reqId) {
    await db
      .prepare(`UPDATE requisition SET status = 'refund_pending'
                 WHERE id = ? AND user_id = ?`)
      .bind(reqId, userId).run()
    // TG 訊息更新（refund_pending header）
    await syncRequisitionTgMessage(env, reqId)
  }

  await safeUserAudit(env, {
    event_type: 'payment.refund.requested', severity: 'warn',
    user_id: userId, request,
    data: {
      refund_request_id: inserted?.id,
      requisition_id:    reqId,
      intent_id:         intentId,
      amount_subunit:    intent.amount_subunit,
      currency:          intent.currency,
      reason:            reasonClipped,
    },
  })

  return res({
    ok: true,
    code: 'REFUND_REQUESTED',
    refund_request_id: inserted?.id,
    requisition_id:    reqId,
  })
}
