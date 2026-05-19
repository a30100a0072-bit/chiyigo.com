/**
 * ECPay OrderResultURL 中介。
 *
 * ECPay 付款成功後 server POST 帶 form-urlencoded 過來；static
 * /payment-result.html 不收 POST（405）。這隻 Function 收 POST，
 * 把 vendor_intent_id（MerchantTradeNo）當 query 帶到 result 頁，
 * 用 303 GET redirect 讓瀏覽器跳過去（GET 才能載 static HTML）。
 *
 * 不在這裡驗章 / 不寫 D1 — 真實狀態更新走 ReturnURL（webhook handler）。
 * 這隻純 UX redirect。
 */

export async function onRequestPost({ request }) {
  let vendorIntentId = ''
  try {
    const body = await request.text()
    const params = new URLSearchParams(body)
    vendorIntentId = params.get('MerchantTradeNo') ?? ''
  } catch { /* keep empty */ }

  const target = vendorIntentId
    ? `/payment-result.html?vendor_intent_id=${encodeURIComponent(vendorIntentId)}`
    : `/payment-result.html`

  return new Response(null, {
    status: 303,
    headers: { Location: target },
  })
}

// 沙箱有時 user 會重整或從 history 點 → 也支援 GET
export async function onRequestGet({ request }) {
  const url = new URL(request.url)
  const vendorIntentId = url.searchParams.get('MerchantTradeNo') ?? ''
  const target = vendorIntentId
    ? `/payment-result.html?vendor_intent_id=${encodeURIComponent(vendorIntentId)}`
    : `/payment-result.html`
  return new Response(null, { status: 303, headers: { Location: target } })
}
