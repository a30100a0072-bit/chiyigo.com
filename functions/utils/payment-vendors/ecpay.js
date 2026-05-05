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

    // ── 取號通知（PaymentInfoURL 場景）vs 付款結果通知（ReturnURL 場景）── //
    //
    // ECPay AIO 同一個 URL 可同時作 ReturnURL + PaymentInfoURL，依 payload 區分：
    //
    //  - 付款成功（信用卡 / 已完成 ATM/CVS 付款）：RtnCode=1
    //  - ATM 取號成功（user 選 ATM、ECPay 配 V 帳號 → 等待繳費）：
    //      RtnCode=2     + BankCode + vAccount + ExpireDate
    //  - CVS 代碼取號成功：
    //      RtnCode=10100073 + PaymentNo + ExpireDate
    //  - Barcode 取號成功：
    //      RtnCode=10100073 + Barcode1/Barcode2/Barcode3 + ExpireDate
    //  - 失敗：其他 RtnCode

    const hasAtmInfo     = !!(params.BankCode && params.vAccount)
    const hasCvsInfo     = !!params.PaymentNo
    const hasBarcodeInfo = !!params.Barcode1
    const isCodeIssued   = rtnCode === '2' || rtnCode === '10100073'
                          || hasAtmInfo || hasCvsInfo || hasBarcodeInfo

    let status
    if (rtnCode === '1') {
      status = PAYMENT_STATUS.SUCCEEDED
    } else if (isCodeIssued) {
      status = PAYMENT_STATUS.PROCESSING
    } else {
      status = PAYMENT_STATUS.FAILED
    }

    // 取號類事件 → 把繳款資訊抽成 payment_info（給 webhook handler 寫進 metadata）
    let paymentInfo = null
    if (status === PAYMENT_STATUS.PROCESSING) {
      paymentInfo = {}
      if (hasAtmInfo) {
        paymentInfo.method      = 'atm'
        paymentInfo.bank_code   = String(params.BankCode)
        paymentInfo.v_account   = String(params.vAccount)
      } else if (hasCvsInfo) {
        paymentInfo.method      = 'cvs'
        paymentInfo.payment_no  = String(params.PaymentNo)
      } else if (hasBarcodeInfo) {
        paymentInfo.method      = 'barcode'
        paymentInfo.barcode_1   = String(params.Barcode1 ?? '')
        paymentInfo.barcode_2   = String(params.Barcode2 ?? '')
        paymentInfo.barcode_3   = String(params.Barcode3 ?? '')
      }
      if (params.ExpireDate) paymentInfo.expire_date = String(params.ExpireDate)
    }

    // event_id：付款成功用 TradeNo；取號通知用 MerchantTradeNo + RtnCode（避免跟付款 TradeNo 撞）
    let eventId
    if (status === PAYMENT_STATUS.SUCCEEDED && params.TradeNo) {
      eventId = String(params.TradeNo)
    } else if (params.TradeNo) {
      eventId = `${params.TradeNo}_${rtnCode}`
    } else {
      eventId = `${params.MerchantTradeNo}_${rtnCode}`
    }

    return {
      ok:               true,
      event_id:         eventId,
      vendor_intent_id: String(params.MerchantTradeNo),
      user_id:          null,  // ECPay 沒帶 user_id；靠 vendor_intent_id 找回 row
      status,
      amount_subunit:   params.TradeAmt != null ? Number(params.TradeAmt) : null,
      amount_raw:       null,
      currency:         'TWD',
      failure_reason:   (status === PAYMENT_STATUS.FAILED)
        ? (params.RtnMsg ? String(params.RtnMsg) : `RtnCode=${rtnCode}`)
        : null,
      payment_info:     paymentInfo,
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

// ── 退款（信用卡）───────────────────────────────────────────────
//
// ECPay AIO 信用卡退款走 `/CreditDetail/DoAction`，**只支援信用卡**。
// ATM/CVS 退款必須 ECPay 後台手動處理（沒 API），不在本 helper 範圍。
//
// Action 類型：
//   - C  ─ 取消授權（user 還沒請款）
//   - R  ─ 退刷（user 已請款 → 全額退）
//   - E  ─ 放棄（已請款但未撥款，部分情境）
//
// 我們提供 status=succeeded 的 intent 統一走 R（退刷）；ECPay 內部會選對 C 還是 E。

const ECPAY_REFUND_STAGE_URL = 'https://payment-stage.ecpay.com.tw/CreditDetail/DoAction'
const ECPAY_REFUND_PROD_URL  = 'https://payment.ecpay.com.tw/CreditDetail/DoAction'

/**
 * 對 ECPay call refund API。
 *
 * @param {object} env
 * @param {object} args
 * @param {string} args.merchantTradeNo  我方 unique（payment_intents.vendor_intent_id）
 * @param {string} args.tradeNo          ECPay 唯一交易編號（從 metadata 或 audit log 撈）
 * @param {number} args.totalAmount      退款金額（整數 TWD），通常 = TradeAmt 全額
 * @param {string} [args.action='R']     C / R / E
 *
 * @returns {Promise<{ ok: boolean, rtn_code?: string, rtn_msg?: string, raw?: string }>}
 */
export async function ecpayRefund(env, { merchantTradeNo, tradeNo, totalAmount, action = 'R' }) {
  const { merchantId, hashKey, hashIV, isProd } = getCreds(env)
  const url = isProd ? ECPAY_REFUND_PROD_URL : ECPAY_REFUND_STAGE_URL

  const fields = {
    MerchantID:       merchantId,
    MerchantTradeNo:  String(merchantTradeNo),
    TradeNo:          String(tradeNo),
    Action:           action,
    TotalAmount:      String(Math.round(Number(totalAmount))),
    PlatformID:       '',  // ECPay 子商店欄位，留空
  }
  fields.CheckMacValue = await ecpayCheckMacValue(fields, hashKey, hashIV)

  const body = new URLSearchParams(fields).toString()
  const r = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await r.text()

  // ECPay 回 form-urlencoded：RtnCode=1&RtnMsg=xxx 或純文字 1|XXX 視 endpoint 而定
  // /CreditDetail/DoAction 回的是 form-urlencoded
  const rtn = Object.fromEntries(new URLSearchParams(text))
  const rtnCode = String(rtn.RtnCode ?? '')
  return {
    ok:        rtnCode === '1',
    rtn_code:  rtnCode,
    rtn_msg:   rtn.RtnMsg ? String(rtn.RtnMsg) : null,
    raw:       text,
  }
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
