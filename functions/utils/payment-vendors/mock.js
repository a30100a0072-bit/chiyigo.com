/**
 * Mock Payment adapter — 給 integration test + 上 prod 前的 webhook 端點 smoke test 用。
 *
 * 真實 PSP（Stripe / TapPay / 綠界）會替換成自己的簽章 + payload schema。
 *
 * 接受的 payload（JSON）：
 *   {
 *     event_id:         string,                // dedupe key
 *     vendor_intent_id: string,                // 對應 payment_intents.vendor_intent_id
 *     user_id?:         number,                // 自願帶（沒帶時靠 vendor_intent_id 找回 row）
 *     status:           string,                // PAYMENT_STATUS 之一
 *     amount_subunit?:  number,
 *     amount_raw?:      string,
 *     currency?:        string,
 *     failure_reason?:  string,
 *   }
 *
 * 驗章：用 env.PAYMENT_MOCK_SECRET 做 HMAC-SHA256（header `X-Payment-Signature: hex`）。
 * 缺 secret → fail（**production 一定要設**，否則任何人可偽造）。
 */

const SIGNATURE_HEADER = 'X-Payment-Signature'

export const mockPaymentAdapter = {
  async parseWebhook(request, env) {
    const secret = env?.PAYMENT_MOCK_SECRET
    if (!secret) return { ok: false, error: 'PAYMENT_MOCK_SECRET not configured' }

    const sigHeader = request.headers.get(SIGNATURE_HEADER) || ''
    const rawBody   = await request.text()

    const expected = await hmacSha256Hex(secret, rawBody)
    if (!constantTimeEq(expected, sigHeader)) {
      return { ok: false, error: 'signature_invalid' }
    }

    let payload
    try { payload = JSON.parse(rawBody) }
    catch { return { ok: false, error: 'bad_json' } }

    if (!payload?.event_id || !payload?.vendor_intent_id || !payload?.status) {
      return { ok: false, error: 'missing_required_fields' }
    }

    return {
      ok:               true,
      event_id:         String(payload.event_id),
      vendor_intent_id: String(payload.vendor_intent_id),
      user_id:          payload.user_id != null ? Number(payload.user_id) : null,
      status:           payload.status,
      amount_subunit:   payload.amount_subunit ?? null,
      amount_raw:       payload.amount_raw ?? null,
      currency:         payload.currency ?? null,
      failure_reason:   payload.failure_reason ?? null,
      raw_body:         rawBody,
    }
  },
}

async function hmacSha256Hex(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('')
}

function constantTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
