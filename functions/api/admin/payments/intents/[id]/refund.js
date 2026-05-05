/**
 * POST /api/admin/payments/intents/:id/refund
 *
 * Phase F-2 wave 4 — admin 退款。
 *
 * 認證：
 *   1. access_token 帶 `admin:payments` scope（admin / developer 預設有）
 *   2. **同時** step-up token 帶 `elevated:payment` + for_action='refund_payment'
 *      （拿一般 access_token 不能退款，避免 admin token 外洩 = 全部退完）
 *
 * 流程：
 *   1. 找 intent；status 必須是 succeeded（其他狀態退款語意不對）
 *   2. 從 payment_webhook_events 撈 ECPay TradeNo（status_to=succeeded 那筆的 event_id）
 *   3. call ecpayRefund Action=R 全額
 *   4. 成功 → UPDATE intent.status=refunded + critical audit
 *   5. 失敗 → audit warn + 不改 status
 *
 * Body：optional `{ reason?: string }`
 *
 * 回傳：
 *   200 → { ok: true, status: 'refunded' }
 *   400 → 退款 API 失敗 / 沒 TradeNo
 *   401/403 → 沒 access_token / 沒 admin:payments / 沒 step-up
 *   404 → intent 不存在
 *   409 → 狀態不允許退款
 */

import { res, requireStepUp } from '../../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../../utils/cors.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../../../utils/scopes.js'
import {
  getPaymentIntent, updatePaymentStatus, PAYMENT_STATUS,
} from '../../../../../utils/payments.js'
import { ecpayRefund } from '../../../../../utils/payment-vendors/ecpay.js'
import { safeUserAudit } from '../../../../../utils/user-audit.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env, params }) {
  const cors = getCorsHeaders(request, env)

  // 雙重守門：admin scope（access_token）+ elevated:payment（step-up token）
  // 注意：requireScope 與 requireStepUp 都是讀 Authorization header，所以
  // caller 要在 request 帶 step-up token，access_token 走 cookie 或另用機制。
  // 簡化方案：兩者都檢查 token，但 step-up token 簽發時是基於有效 access_token 換來的，
  // 內含 sub/role/scope = 同 user，所以 step-up token 自身應該也有 admin:payments scope。
  // 因此只需 requireStepUp（驗 step-up）+ 在 step-up token 內 effective scope 含 admin:payments。
  // 用 requireScope 第一輪過濾不必要 step-up call → 但 requireScope 對 step-up token 也會 pass。

  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_PAYMENT, 'refund_payment')
  if (stepCheck.error) return stepCheck.error

  // 確認 user 有 admin:payments 權限。step-up token scope 純 elevated:*，
  // 但 token 帶 role 可走 effectiveScopesFromJwt fallback：admin/developer 自動有 admin:payments。
  // 一般 player role 即使 step-up 拿到 elevated:payment 也不會有 admin:payments → 403（防越權退別人款）。
  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_PAYMENTS)) {
    return res({ error: 'admin:payments scope required' }, 403, cors)
  }

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404, cors)

  const intent = await getPaymentIntent(env, { id })
  if (!intent) return res({ error: 'not_found' }, 404, cors)

  if (intent.status !== PAYMENT_STATUS.SUCCEEDED) {
    return res({
      error: 'only succeeded intents can be refunded',
      code:  'INVALID_STATUS',
      actual_status: intent.status,
    }, 409, cors)
  }

  if (intent.vendor !== 'ecpay') {
    return res({ error: `refund not implemented for vendor: ${intent.vendor}` }, 400, cors)
  }

  // 從 webhook events 撈付款成功那筆的 event_id（= ECPay TradeNo）
  const eventRow = await env.chiyigo_db
    .prepare(
      `SELECT event_id FROM payment_webhook_events
        WHERE vendor = ? AND intent_id = ? AND status_to = ?
        ORDER BY processed_at DESC LIMIT 1`,
    )
    .bind('ecpay', id, PAYMENT_STATUS.SUCCEEDED)
    .first()

  // event_id for SUCCEEDED is bare TradeNo（沒底線後綴）
  const tradeNo = eventRow?.event_id && !/_\d+$/.test(eventRow.event_id)
    ? eventRow.event_id
    : null
  if (!tradeNo) {
    return res({ error: 'TradeNo not found; cannot call refund API' }, 400, cors)
  }

  let body = {}
  try { body = await request.json() } catch { /* keep empty */ }
  const reason = String(body?.reason ?? '').slice(0, 200) || null

  // call ECPay
  const refundResult = await ecpayRefund(env, {
    merchantTradeNo: intent.vendor_intent_id,
    tradeNo,
    totalAmount:     intent.amount_subunit,
    action:          'R',
  })

  if (!refundResult.ok) {
    await safeUserAudit(env, {
      event_type: 'payment.refund.fail', severity: 'warn',
      user_id: intent.user_id, request,
      data: {
        intent_id:        id,
        vendor_intent_id: intent.vendor_intent_id,
        rtn_code:         refundResult.rtn_code,
        rtn_msg:          refundResult.rtn_msg,
      },
    })
    return res({
      error:    'ECPay refund failed',
      rtn_code: refundResult.rtn_code,
      rtn_msg:  refundResult.rtn_msg,
    }, 400, cors)
  }

  // 成功 → 更新 status
  await updatePaymentStatus(env, {
    vendor:           'ecpay',
    vendor_intent_id: intent.vendor_intent_id,
    status:           PAYMENT_STATUS.REFUNDED,
    failure_reason:   reason ? `refund: ${reason}` : null,
  })

  await safeUserAudit(env, {
    event_type: 'payment.refund.success',
    severity:   'critical',
    user_id:    intent.user_id,
    request,
    data: {
      intent_id:        id,
      vendor_intent_id: intent.vendor_intent_id,
      amount_subunit:   intent.amount_subunit,
      currency:         intent.currency,
      reason,
      admin_user_id:    Number(stepCheck.user.sub),
    },
  })

  return res({ ok: true, status: PAYMENT_STATUS.REFUNDED }, 200, cors)
}
