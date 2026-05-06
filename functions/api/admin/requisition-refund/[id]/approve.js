/**
 * POST /api/admin/requisition-refund/:id/approve
 *
 * Phase F-2 wave 7 — admin 通過退款申請。
 *
 * 認證：
 *   1. step-up token 帶 elevated:payment + for_action='approve_requisition_refund'
 *      （金流動作；admin 一般 access_token 不能批准，避免 token 外洩 = 全批准）
 *   2. step-up token user 必須是 admin role（透過 effective scopes admin:requisitions /
 *      admin:payments 任一即可，沿用既有 pattern；step-up token 是 admin 換來的）
 *
 * 流程：
 *   1. 找 refund_request；status 必須是 pending
 *   2. 找對應的 payment_intent；status 必須是 succeeded、vendor='ecpay'（目前唯一支援）
 *   3. 從 payment_webhook_events 撈 ECPay TradeNo
 *   4. call ecpayRefund Action='R' 全額
 *   5. 成功 → UPDATE intent.status='refunded' + requisition.status='revoked' + deleted_at
 *           + refund_request.status='approved' + admin_user_id + decided_at + admin_note
 *           + critical audit
 *   6. 失敗 → audit warn + 不改任何 status，回 400
 *
 * Body：optional { admin_note?: string }（最多 500 字）
 */

import { res, requireStepUp } from '../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../utils/cors.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../../utils/scopes.js'
import {
  getPaymentIntent, updatePaymentStatus, PAYMENT_STATUS,
} from '../../../../utils/payments.js'
import { ecpayRefund } from '../../../../utils/payment-vendors/ecpay.js'
import { safeUserAudit } from '../../../../utils/user-audit.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env, params }) {
  const cors = getCorsHeaders(request, env)

  const stepCheck = await requireStepUp(
    request, env, SCOPES.ELEVATED_PAYMENT, 'approve_requisition_refund',
  )
  if (stepCheck.error) return stepCheck.error

  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_PAYMENTS)) {
    return res({ error: 'admin:payments scope required' }, 403, cors)
  }

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404, cors)

  const db = env.chiyigo_db

  const rr = await db
    .prepare(`SELECT * FROM requisition_refund_request WHERE id = ?`)
    .bind(id).first()
  if (!rr) return res({ error: 'not_found' }, 404, cors)
  if (rr.status !== 'pending') {
    return res({
      error: 'only pending refund requests can be approved',
      code:  'INVALID_STATUS',
      actual_status: rr.status,
    }, 409, cors)
  }

  const intent = rr.intent_id ? await getPaymentIntent(env, { id: rr.intent_id }) : null
  if (!intent) return res({ error: 'linked intent not found' }, 404, cors)
  if (intent.status !== PAYMENT_STATUS.SUCCEEDED) {
    return res({
      error: 'linked intent is not in succeeded status',
      code:  'INTENT_INVALID_STATUS',
      actual_status: intent.status,
    }, 409, cors)
  }
  if (intent.vendor !== 'ecpay') {
    return res({ error: `refund not implemented for vendor: ${intent.vendor}` }, 400, cors)
  }

  let body = {}
  try { body = await request.json() } catch { /* keep empty */ }
  const adminNote = String(body?.admin_note ?? '').slice(0, 500) || null

  // 撈成功付款那筆的 TradeNo
  const eventRow = await db
    .prepare(
      `SELECT event_id FROM payment_webhook_events
        WHERE vendor = ? AND intent_id = ? AND status_to = ?
        ORDER BY processed_at DESC LIMIT 1`,
    )
    .bind('ecpay', intent.id, PAYMENT_STATUS.SUCCEEDED)
    .first()

  const tradeNo = eventRow?.event_id && !/_\d+$/.test(eventRow.event_id)
    ? eventRow.event_id
    : null
  if (!tradeNo) {
    return res({ error: 'TradeNo not found; cannot call refund API' }, 400, cors)
  }

  const refundResult = await ecpayRefund(env, {
    merchantTradeNo: intent.vendor_intent_id,
    tradeNo,
    totalAmount:     intent.amount_subunit,
    action:          'R',
  })

  if (!refundResult.ok) {
    await safeUserAudit(env, {
      event_type: 'requisition.refund.fail', severity: 'warn',
      user_id: rr.user_id, request,
      data: {
        refund_request_id: id,
        requisition_id:    rr.requisition_id,
        intent_id:         intent.id,
        rtn_code:          refundResult.rtn_code,
        rtn_msg:           refundResult.rtn_msg,
        admin_user_id:     Number(stepCheck.user.sub),
      },
    })
    return res({
      error:    'ECPay refund failed',
      rtn_code: refundResult.rtn_code,
      rtn_msg:  refundResult.rtn_msg,
    }, 400, cors)
  }

  // 成功 → 三表同步更新
  await updatePaymentStatus(env, {
    vendor:           'ecpay',
    vendor_intent_id: intent.vendor_intent_id,
    status:           PAYMENT_STATUS.REFUNDED,
    failure_reason:   adminNote ? `refund (req approval): ${adminNote}` : 'refund (req approval)',
  })

  await db.prepare(`
    UPDATE requisition
       SET status = 'revoked', deleted_at = CURRENT_TIMESTAMP
     WHERE id = ?
  `).bind(rr.requisition_id).run()

  await db.prepare(`
    UPDATE requisition_refund_request
       SET status = 'approved', admin_user_id = ?, admin_note = ?, decided_at = datetime('now')
     WHERE id = ?
  `).bind(Number(stepCheck.user.sub), adminNote, id).run()

  await safeUserAudit(env, {
    event_type: 'requisition.refund.approved', severity: 'critical',
    user_id: rr.user_id, request,
    data: {
      refund_request_id: id,
      requisition_id:    rr.requisition_id,
      intent_id:         intent.id,
      vendor_intent_id:  intent.vendor_intent_id,
      amount_subunit:    intent.amount_subunit,
      currency:          intent.currency,
      admin_note:        adminNote,
      admin_user_id:     Number(stepCheck.user.sub),
    },
  })

  return res({
    ok: true,
    refund_request_id: id,
    requisition_id:    rr.requisition_id,
    intent_status:     PAYMENT_STATUS.REFUNDED,
    requisition_status: 'revoked',
  }, 200, cors)
}
