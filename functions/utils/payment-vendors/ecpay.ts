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

import type { WebhookParseResult } from '../payment-types'

// ecpay 僅消費下列 5 個 creds binding；Pick 綁定 Env SoT，且讓 fail-closed 單元測試可傳 partial env
type EcpayCredsEnv = Pick<Env, 'ENVIRONMENT' | 'ECPAY_MODE' | 'ECPAY_MERCHANT_ID' | 'ECPAY_HASH_KEY' | 'ECPAY_HASH_IV'>

// 不從 ../payments.ts 引 PAYMENT_STATUS（會跟 payments.ts 引 ADAPTERS map 形成 circular import
// → adapter 註冊時 payments.ts 還沒 ready 為 undefined → resolvePaymentAdapter 找不到）
const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending', PROCESSING: 'processing', SUCCEEDED: 'succeeded',
  FAILED: 'failed', CANCELED: 'canceled', REFUNDED: 'refunded',
})

const ECPAY_STAGE_URL = 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5'
const ECPAY_PROD_URL  = 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5'

// 沙箱公開 creds（env 沒設時 fallback）
// ECPay 文件 v5：https://developers.ecpay.com.tw/?p=2856
// 舊 creds 2000132/5294y0726k67Nck0/v77hoKGq4kWxNNIS 已被棄用 → 一律 CheckMacValue Error
const SANDBOX_CREDS = {
  merchantId: '3002607',
  hashKey:    'pwFHCqoQZGmho4w6',
  hashIV:     'EkRm7iFT261dpevs',
}

// PAY-002 (docs/audit/pay-002-hotfix-plan.md)：getCreds 解析失敗時拋此 typed error，
// 帶機讀 `.code` 供 caller 寫 audit（禁 parse message）。
class EcpayConfigError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'EcpayConfigError'
    this.code = code
  }
}

// PAY-002 secure-by-default credential resolution。
//
// 為何用 ENVIRONMENT 而非 ECPAY_MODE 當 production SoT：
//   ECPAY_MODE 在 prod 常未設 → 舊邏輯 `isProd = ECPAY_MODE==='prod'` 為 false →
//   fail-OPEN 到程式內公開 sandbox HashKey/HashIV（L41-42，亦見 ECPay 官方文件），
//   任何人可偽造 webhook 簽章。改用 wrangler.toml [vars] 的 ENVIRONMENT（prod 必設，
//   .dev.vars 本機覆寫 'development'，miniflare test = 'test'）。
//
// 不變量：SANDBOX_CREDS 公開金鑰「有且僅有」非 production + 明確 ECPAY_MODE='sandbox'
//   + 無真實 creds 一條路徑可達；其餘一律真實 creds 或 fail-closed throw。
function getCreds(env: EcpayCredsEnv) {
  const isProduction = env?.ENVIRONMENT === 'production'
  const mode = env?.ECPAY_MODE
  const hasAll3 = !!(env?.ECPAY_MERCHANT_ID && env?.ECPAY_HASH_KEY && env?.ECPAY_HASH_IV)

  if (isProduction) {
    // production：禁 sandbox 模式；必備三把真 creds；永不 fallback 公開金鑰。
    if (mode === 'sandbox') {
      throw new EcpayConfigError('mode_mismatch', 'ECPAY_MODE=sandbox is forbidden in production')
    }
    if (!hasAll3) {
      throw new EcpayConfigError('secret_missing', 'ECPay production credentials missing')
    }
    return { merchantId: env.ECPAY_MERCHANT_ID, hashKey: env.ECPAY_HASH_KEY, hashIV: env.ECPAY_HASH_IV, isProd: true }
  }

  // non-production
  if (hasAll3) {
    // 顯式真 creds（staging 對真帳號測試）；prod URL 由明確 ECPAY_MODE='prod' 決定。
    return { merchantId: env.ECPAY_MERCHANT_ID, hashKey: env.ECPAY_HASH_KEY, hashIV: env.ECPAY_HASH_IV, isProd: mode === 'prod' }
  }
  if (mode === 'sandbox') {
    // ★ 唯一允許公開 sandbox creds 的路徑。
    return { merchantId: SANDBOX_CREDS.merchantId, hashKey: SANDBOX_CREDS.hashKey, hashIV: SANDBOX_CREDS.hashIV, isProd: false }
  }
  // 非 production、無真 creds、又未明確 sandbox → fail-closed（不沉默 fallback 公開金鑰）。
  throw new EcpayConfigError(
    'sandbox_requires_explicit_mode',
    'ECPay sandbox fallback requires explicit ECPAY_MODE=sandbox in non-production',
  )
}

export function getEcpayCheckoutUrl(env: EcpayCredsEnv) {
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

function ecpayUrlEncode(s: string) {
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
export async function ecpayCheckMacValue(params: Record<string, string>, hashKey: string, hashIV: string) {
  const filtered: Record<string, string> = {}
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
  async parseWebhook(request: Request, env: EcpayCredsEnv): Promise<WebhookParseResult> {
    // PAY-002：getCreds fail-closed throw（缺 creds / prod 禁 sandbox / sandbox 未明確）→
    // 回 ok:false 讓 handler 走 critical audit + DLQ + reject（不在此 throw，否則 handler
    // 對 parseWebhook 無外層 catch 會跳過 audit/DLQ 路徑）。.code 機讀供 handler audit。
    let creds
    try {
      creds = getCreds(env)
    } catch (e) {
      return { ok: false, error: 'vendor_misconfigured', code: e?.code ?? 'config' }
    }
    const { hashKey, hashIV } = creds
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
    let paymentInfo: {
      method?: 'atm' | 'cvs' | 'barcode'
      bank_code?: string
      v_account?: string
      payment_no?: string
      barcode_1?: string
      barcode_2?: string
      barcode_3?: string
      expire_date?: string
    } | null = null
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
      // P0-10：把 TradeNo 露出去，webhook handler 在 succeeded 時寫進 intent.metadata.trade_no
      trade_no:         params.TradeNo ? String(params.TradeNo) : null,
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
 * @param {string} [payload.orderResultUrl] 付款成功後 ECPay 主動 POST 的 URL（瀏覽器層；
 *                                          沒設則 ECPay 停在自家成功頁等 user 點 ClientBackURL）
 * @param {string} [payload.choosePayment='ALL']  ALL|Credit|ATM|CVS|BARCODE|ApplePay
 *
 * @returns {Promise<{ checkout_url: string, fields: object }>}
 */
export async function buildEcpayCheckoutFields(env: EcpayCredsEnv, payload: {
  merchantTradeNo: string
  totalAmount: number
  tradeDesc?: string
  itemName?: string
  returnUrl: string
  clientBackUrl?: string
  orderResultUrl?: string
  choosePayment?: string
}) {
  const { merchantId, hashKey, hashIV, isProd } = getCreds(env)
  const checkoutUrl = isProd ? ECPAY_PROD_URL : ECPAY_STAGE_URL

  const tradeDate = formatTradeDate(new Date())
  const fields: Record<string, string> = {
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

  // NOTE: 不要 return raw concat string；含 HashKey/HashIV，外洩等於整把 ECPay 商家密鑰
  const { mac } = await ecpayCheckMacValueDebug(fields, hashKey, hashIV)
  fields.CheckMacValue = mac
  return { checkout_url: checkoutUrl, fields }
}

function formatTradeDate(d: Date) {
  // ECPay 規定格式："yyyy/MM/dd HH:mm:ss" + 必須是 TW 時區（UTC+8）。
  // Workers runtime 是 UTC，必須手動加 8 小時，否則綠界端時間異常。
  const tw = new Date(d.getTime() + 8 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${tw.getUTCFullYear()}/${pad(tw.getUTCMonth() + 1)}/${pad(tw.getUTCDate())} `
    + `${pad(tw.getUTCHours())}:${pad(tw.getUTCMinutes())}:${pad(tw.getUTCSeconds())}`
}

// debug 版本：回傳算 hash 用的 raw concat string，給 /checkout?debug=1 對拍 ECPay 官方驗算工具用
async function ecpayCheckMacValueDebug(params: Record<string, string>, hashKey: string, hashIV: string) {
  const filtered: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (k === 'CheckMacValue') continue
    if (v === undefined || v === null) continue
    filtered[k] = v
  }
  const sortedKeys = Object.keys(filtered).sort((a, b) => a.localeCompare(b))
  const pairs = sortedKeys.map(k => `${k}=${filtered[k]}`)
  const raw = `HashKey=${hashKey}&${pairs.join('&')}&HashIV=${hashIV}`
  const encoded = String(encodeURIComponent(raw))
    .replace(/~/g, '%7e').replace(/%20/g, '+').toLowerCase()
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encoded))
  const mac = Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').toUpperCase()
  return { mac, raw, encoded }
}

function truncate(s: string, max: number) {
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
export async function ecpayRefund(env: EcpayCredsEnv, { merchantTradeNo, tradeNo, totalAmount, action = 'R' }: {
  merchantTradeNo: string
  tradeNo: string
  totalAmount: number
  action?: string
}) {
  const { merchantId, hashKey, hashIV, isProd } = getCreds(env)
  const url = isProd ? ECPAY_REFUND_PROD_URL : ECPAY_REFUND_STAGE_URL

  const fields: Record<string, string> = {
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

  // P1-10：對回應做防偽校驗（防中間人/偽造 ECPay response）
  //   1. 必校：MerchantID / MerchantTradeNo / TradeNo 必須與我方送出值一致
  //   2. 若回應含 CheckMacValue（部分 endpoint 才回）→ 重算驗章；不一致即視為失敗
  //   3. Codex r10 P2-7：success（RtnCode=1）必須帶完整身分欄位，否則攻擊者
  //      只回「RtnCode=1&RtnMsg=OK」就能假冒退款成功。缺任一身分欄位 → VERIFY_FAIL。
  //      ECPay DoAction spec 成功回應一定帶 MerchantID/MerchantTradeNo/TradeNo；
  //      缺就是異常（中間人/偽造），不可放行。
  let verifyError = null
  if (rtnCode === '1' && (!rtn.MerchantID || !rtn.MerchantTradeNo || !rtn.TradeNo)) {
    verifyError = `success_missing_identity_fields: MerchantID=${!!rtn.MerchantID} MerchantTradeNo=${!!rtn.MerchantTradeNo} TradeNo=${!!rtn.TradeNo}`
  } else if (rtn.MerchantID && String(rtn.MerchantID) !== String(merchantId)) {
    verifyError = `merchant_id_mismatch: got ${rtn.MerchantID}`
  } else if (rtn.MerchantTradeNo && String(rtn.MerchantTradeNo) !== String(merchantTradeNo)) {
    verifyError = `merchant_trade_no_mismatch: got ${rtn.MerchantTradeNo}`
  } else if (rtn.TradeNo && String(rtn.TradeNo) !== String(tradeNo)) {
    verifyError = `trade_no_mismatch: got ${rtn.TradeNo}`
  } else if (rtn.CheckMacValue) {
    const expectMac = await ecpayCheckMacValue(rtn, hashKey, hashIV)
    if (String(rtn.CheckMacValue).toUpperCase() !== expectMac) {
      verifyError = 'check_mac_value_mismatch'
    }
  }
  if (verifyError) {
    return {
      ok:       false,
      rtn_code: rtnCode || 'VERIFY_FAIL',
      rtn_msg:  `response verification failed: ${verifyError}`,
      raw:      text,
    }
  }

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
