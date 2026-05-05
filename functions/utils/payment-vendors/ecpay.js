/**
 * ECPay（綠界）AIO 全方位金流 adapter — Phase F-2 wave 2。
 *
 * 文件： https://www.ecpay.com.tw/Service/API_Dwnld
 *
 * 流程：
 *   1. POST /api/auth/payments/checkout/ecpay
 *      → 我方產 MerchantTradeNo（unique，存進 payment_intents.vendor_intent_id）
 *      → 算 CheckMacValue
 *      → 回 { checkout_url, fields }；前端拼 form 自動 submit 跳綠界 Cashier
 *   2. user 在綠界網站完成付款
 *   3. ECPay 兩條通知：
 *      a) ReturnURL（server-to-server，POST x-www-form-urlencoded）→ /api/webhooks/payments/ecpay
 *         必須回 plain text "1|OK"，否則 ECPay 重送最多 3 次
 *      b) ClientBackURL（browser redirect）→ 我方付款結果頁（前端要做）
 *
 * 沙箱公開測試 creds（任何人可用）：
 *   MerchantID=2000132 / HashKey=5294y0726k67Nck0 / HashIV=v77hoKGq4kWxNNIS
 *   Stage URL: https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5
 *
 * 為什麼 event_id 用 TradeNo（綠界端的）：
 *   - TradeNo 每筆交易 unique，retry 時會重送同 TradeNo → 我方 (vendor, event_id) UNIQUE 自然 dedup
 *   - MerchantTradeNo 是我方 generated；存到 vendor_intent_id 做 lookup key
 */

// 不從 ../payments.js 引 PAYMENT_STATUS（會跟 payments.js 引 ADAPTERS map 形成 circular import
// → adapter 註冊時 payments.js 還沒 ready 為 undefined → resolvePaymentAdapter 找不到）
const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending', PROCESSING: 'processing', SUCCEEDED: 'succeeded',
  FAILED: 'failed', CANCELED: 'canceled', REFUNDED: 'refunded',
})

const ECPAY_STAGE_URL = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
const ECPAY_PROD_URL  = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'

// 沙箱公開 creds（env 沒設時 fallback）
const SANDBOX_CREDS = {
  merchantId: '2000132',
  hashKey:    '5294y0726k67Nck0',
  hashIV:     'v77hoKGq4kWxNNIS',
}

function getCreds(env) {
  return {
    merchantId: env?.ECPAY_MERCHANT_ID ?? SANDBOX_CREDS.merchantId,
    hashKey:    env?.ECPAY_HASH_KEY    ?? SANDBOX_CREDS.hashKey,
    hashIV:     env?.ECPAY_HASH_IV     ?? SANDBOX_CREDS.hashIV,
    isProd:     env?.ECPAY_MODE === 'prod',
  }
}

export function getEcpayCheckoutUrl(env) {
  const { isProd } = getCreds(env)
  return isProd ? ECPAY_PROD_URL : ECPAY_STAGE_URL
}

// ── Encoding ──────────────────────────────────────────────────────
//
// ECPay CheckMacValue 用 .NET HttpUtility.UrlEncode 規則 + lowercase。
// 與 JS encodeURIComponent 差異：
//   - 空白 → '+'（不是 '%20'）
//   - '~' 要編成 '%7e'（encodeURIComponent 不編 ~）
//   - '*' 不編（encodeURIComponent 不編 *，一致）
//   - 其餘 unreserved 標點 -_.()'! 不編（一致）

function ecpayUrlEncode(s) {
  return encodeURIComponent(String(s ?? ''))
    .replace(/~/g, '%7e')
    .replace(/%20/g, '+')
    .toLowerCase()
}

/**
 * 計算 CheckMacValue（SHA256 大寫 hex）。
 *
 * 演算法：
 *   1. 移除 CheckMacValue（如有）
 *   2. 依 key ASCII 升序排序
 *   3. 串成 HashKey=xxx&k1=v1&k2=v2&...&HashIV=xxx
 *   4. URL encode（.NET 規則 + 小寫）
 *   5. SHA256 → 大寫 hex
 */
export async function ecpayCheckMacValue(params, hashKey, hashIV) {
  const filtered = {}
  for (const [k, v] of Object.entries(params)) {
    if (k === 'CheckMacValue') continue
    if (v === undefined || v === null) continue
    filtered[k] = v
  }
  const sortedKeys = Object.keys(filtered).sort((a, b) => a.localeCompare(b))
  const pairs = sortedKeys.map(k => `${k}=${filtered[k]}`)
  const raw = `HashKey=${hashKey}&${pairs.join('&')}&HashIV=${hashIV}`
  const encoded = ecpayUrlEncode(raw)
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// ── Adapter ───────────────────────────────────────────────────────

export const ecpayPaymentAdapter = {
  /**
   * 解 ECPay ReturnURL POST notification（form-urlencoded）。
   * 失敗回 ok:false；caller 應回非 "1|OK" 讓 ECPay 重送。
   */
  async parseWebhook(request, env) {
    const { hashKey, hashIV } = getCreds(env)
    const rawBody = await request.text()
    const params = Object.fromEntries(new URLSearchParams(rawBody))

    if (!params.CheckMacValue || !params.MerchantTradeNo) {
      return { ok: false, error: 'missing_required_fields' }
    }

    const expected = await ecpayCheckMacValue(params, hashKey, hashIV)
    if (expected !== String(params.CheckMacValue).toUpperCase()) {
      return { ok: false, error: 'signature_invalid' }
    }

    const rtnCode = String(params.RtnCode ?? '')
    let status
    if (rtnCode === '1') {
      status = PAYMENT_STATUS.SUCCEEDED
    } else if (rtnCode === '10100073' || rtnCode === '2') {
      // 10100073 = ATM/CVS 第一階段已取號等待付款（PaymentInfoURL 通知）
      // 2 = 部分系統回 processing
      status = PAYMENT_STATUS.PROCESSING
    } else {
      status = PAYMENT_STATUS.FAILED
    }

    // event_id：TradeNo（ECPay 唯一交易編號）；retry 同 TradeNo → UNIQUE dedup
    // 沒 TradeNo（極少數 ATM 取號通知）→ 退回 MerchantTradeNo + RtnCode 組合
    const eventId = params.TradeNo
      ? String(params.TradeNo)
      : `${params.MerchantTradeNo}_${rtnCode}`

    return {
      ok:               true,
      event_id:         eventId,
      vendor_intent_id: String(params.MerchantTradeNo),
      user_id:          null,  // ECPay 沒帶 user_id；靠 vendor_intent_id 找回 row
      status,
      amount_subunit:   params.TradeAmt != null ? Number(params.TradeAmt) : null,
      amount_raw:       null,
      currency:         'TWD',
      failure_reason:   rtnCode === '1' ? null : (params.RtnMsg ? String(params.RtnMsg) : `RtnCode=${rtnCode}`),
      raw_body:         rawBody,
    }
  },

  /**
   * 成功 / 重送都要回 plain text "1|OK"，否則 ECPay 重送最多 3 次。
   * 失敗（簽章錯）我們希望 ECPay 重送也沒用，但回非 1|OK 讓他們在自己 log 看到。
   */
  successResponse() {
    return new Response('1|OK', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  },

  failureResponse(reason = 'failed') {
    return new Response(`0|${reason}`, {
      status: 200,  // ECPay 看 body 不看 HTTP code
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  },
}

// ── Checkout form 建構 ────────────────────────────────────────────

/**
 * 建立 AIO 結帳 form 欄位。caller（/checkout endpoint）回 JSON 給前端，
 * 前端動態建 <form action={checkout_url}> + input hidden 然後 submit 跳綠界。
 *
 * @param {object} env
 * @param {object} payload
 * @param {string} payload.merchantTradeNo  我方 unique id（存進 payment_intents.vendor_intent_id）
 * @param {number} payload.totalAmount      整數 TWD（綠界不收小數）
 * @param {string} payload.tradeDesc        交易描述（≤ 200 char）
 * @param {string} payload.itemName         商品名稱（≤ 400 char，多項用 # 分隔）
 * @param {string} payload.returnUrl        ECPay server-to-server 通知（必須 https）
 * @param {string} [payload.clientBackUrl]  user 付款後跳回的瀏覽器 URL
 * @param {string} [payload.choosePayment='ALL']  ALL|Credit|ATM|CVS|BARCODE|ApplePay
 *
 * @returns {Promise<{ checkout_url: string, fields: object }>}
 */
export async function buildEcpayCheckoutFields(env, payload) {
  const { merchantId, hashKey, hashIV, isProd } = getCreds(env)
  const checkoutUrl = isProd ? ECPAY_PROD_URL : ECPAY_STAGE_URL

  const tradeDate = formatTradeDate(new Date())
  const fields = {
    MerchantID:        merchantId,
    MerchantTradeNo:   payload.merchantTradeNo,
    MerchantTradeDate: tradeDate,
    PaymentType:       'aio',
    TotalAmount:       String(Math.round(Number(payload.totalAmount))),
    TradeDesc:         truncate(payload.tradeDesc || 'chiyigo payment', 200),
    ItemName:          truncate(payload.itemName || payload.tradeDesc || 'chiyigo item', 400),
    ReturnURL:         payload.returnUrl,
    ChoosePayment:     payload.choosePayment ?? 'ALL',
    EncryptType:       '1',  // 1 = SHA256（綠界目前唯一支援）
  }
  if (payload.clientBackUrl) fields.ClientBackURL = payload.clientBackUrl
  if (payload.orderResultUrl) fields.OrderResultURL = payload.orderResultUrl

  fields.CheckMacValue = await ecpayCheckMacValue(fields, hashKey, hashIV)
  return { checkout_url: checkoutUrl, fields }
}

function formatTradeDate(d) {
  // ECPay 規定格式："yyyy/MM/dd HH:mm:ss"（本地時間，會跟 server tz 走）
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function truncate(s, max) {
  s = String(s ?? '')
  return s.length > max ? s.slice(0, max) : s
}

/**
 * 產生 unique MerchantTradeNo（≤ 20 char，英數）。
 * 規則：'cy' + 13 位 base36 timestamp + 5 位隨機 = 20 char
 */
export function generateMerchantTradeNo() {
  const ts = Date.now().toString(36).padStart(9, '0').slice(0, 9)
  const rand = Math.floor(Math.random() * 36 ** 9).toString(36).padStart(9, '0')
  return ('cy' + ts + rand).slice(0, 20)
}
