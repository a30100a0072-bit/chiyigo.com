/**
 * POST /api/auth/payments/checkout/ecpay
 * Header: Authorization: Bearer <access_token>
 *
 * Phase F-2 wave 2 — ECPay 結帳建單。
 *
 * 流程：
 *   1. require KYC verified（提款才需要 enhanced；這邊是 deposit / 一般付款，verified 即可）
 *   2. 產 MerchantTradeNo（unique，存進 payment_intents.vendor_intent_id）
 *   3. INSERT payment_intents（status=pending）
 *   4. 算 ECPay AIO checkout fields + CheckMacValue
 *   5. 回 { checkout_url, fields, intent_id } 給前端
 *
 * 前端：建 <form action={checkout_url} method="POST">，把 fields 全部塞 hidden input，submit。
 * ECPay 完成後：
 *   - server-to-server → ReturnURL = /api/webhooks/payments/ecpay
 *   - browser redirect → ClientBackURL = /payment-result.html（前端 UI 之後做）
 *
 * Body：
 *   {
 *     amount:        number,                    // 整數 TWD（綠界不收小數）
 *     kind?:         'deposit'|'subscription',  // 預設 deposit；訂閱目前 ECPay 走另一條 API 暫不開
 *     trade_desc?:   string,                    // 顯示給 user 看的描述
 *     item_name?:    string,                    // 商品名稱
 *     metadata?:     object,                    // 自訂（會 stringify 寫進 payment_intents.metadata）
 *     choose_payment?: 'ALL'|'Credit'|'ATM'|'CVS'|'BARCODE'|'ApplePay',
 *     client_back_url?: string,                 // 付款後 user 跳回的 URL（覆寫預設）
 *   }
 *
 * 回傳：
 *   200 → { intent_id, vendor_intent_id, checkout_url, fields }
 *   400 → 參數錯
 *   401 → access_token 無效
 *   403 → KYC_REQUIRED
 */

import { res } from '../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../utils/cors.js'
import {
  requirePaymentAccess, createPaymentIntent,
  PAYMENT_KIND, PAYMENT_STATUS,
} from '../../../../utils/payments.js'
import {
  buildEcpayCheckoutFields, generateMerchantTradeNo,
} from '../../../../utils/payment-vendors/ecpay.js'
import { safeUserAudit } from '../../../../utils/user-audit.js'

const MIN_AMOUNT = 1
const MAX_AMOUNT = 200000  // 單筆綠界限額；金融操作上限再調

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requirePaymentAccess(request, env)
  if (error) return error

  let body = {}
  try { body = await request.json() } catch { /* keep empty */ }

  const amount = Math.round(Number(body?.amount))
  if (!Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
    return res({ error: 'invalid_amount', code: 'INVALID_AMOUNT', min: MIN_AMOUNT, max: MAX_AMOUNT }, 400, cors)
  }

  const kind = body?.kind === PAYMENT_KIND.SUBSCRIPTION
    ? PAYMENT_KIND.SUBSCRIPTION
    : PAYMENT_KIND.DEPOSIT

  const merchantTradeNo = generateMerchantTradeNo()
  const userId = Number(user.sub)

  // 建 intent（pending）
  const intentId = await createPaymentIntent(env, {
    user_id:          userId,
    vendor:           'ecpay',
    vendor_intent_id: merchantTradeNo,
    kind,
    status:           PAYMENT_STATUS.PENDING,
    amount_subunit:   amount,
    currency:         'TWD',
    metadata:         body?.metadata ?? null,
  })

  // 組 ECPay form
  const origin = new URL(request.url).origin
  const returnUrl     = env?.ECPAY_RETURN_URL     || `${origin}/api/webhooks/payments/ecpay`
  const clientBackUrl = body?.client_back_url     || env?.ECPAY_CLIENT_BACK_URL || `${origin}/payment-result.html`

  const debugFlag = new URL(request.url).searchParams.get('debug') === '1'
  // OrderResultURL：付款成功後 ECPay 主動 POST 到此 URL（瀏覽器層級，跟 ReturnURL
  // server-to-server 並列）。沒設的話 ECPay 停在自家成功頁等 user 點「回商店」(ClientBackURL)。
  // 沙箱很多 user 看到自家頁就關掉 → 不會走 ClientBackURL → 我方 payment-result.html
  // 從未被觸發。設這個讓 ECPay 自動跳 → user 不需點任何東西。
  const orderResultUrl = body?.order_result_url || env?.ECPAY_ORDER_RESULT_URL || `${origin}/payment-result.html`
  const { checkout_url, fields, _debug } = await buildEcpayCheckoutFields(env, {
    merchantTradeNo,
    totalAmount:    amount,
    tradeDesc:      body?.trade_desc || 'chiyigo deposit',
    itemName:       body?.item_name  || body?.trade_desc || 'chiyigo deposit',
    returnUrl,
    clientBackUrl,
    orderResultUrl,
    choosePayment:  body?.choose_payment || 'ALL',
  })

  await safeUserAudit(env, {
    event_type: 'payment.checkout.created', severity: 'info',
    user_id: userId, request,
    data: { vendor: 'ecpay', intent_id: intentId, vendor_intent_id: merchantTradeNo, amount, kind },
  })

  return res({
    intent_id:        intentId,
    vendor_intent_id: merchantTradeNo,
    checkout_url,
    fields,
    ...(debugFlag ? { _debug } : {}),
  }, 200, cors)
}
