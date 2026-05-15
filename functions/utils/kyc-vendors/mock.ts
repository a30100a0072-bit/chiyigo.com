/**
 * Mock KYC adapter — 給 integration test + 上 prod 前的 webhook 端點 smoke test 用。
 *
 * 真實 vendor（Sumsub / Persona / 永豐）會替換成自己的 HMAC 驗章 + payload schema。
 *
 * 接受的 payload（JSON）：
 *   {
 *     event_id:  string,         // dedupe key
 *     user_id:   number,         // chiyigo user.id（真實 vendor 用 vendor_session_id 對 mapping）
 *     status:    string,         // 'pending' | 'verified' | 'rejected' | 'expired'
 *     level?:    string,         // 'basic' | 'enhanced'
 *     vendor_review_id?: string,
 *     rejection_reason?: string,
 *     verified_at?: string,
 *     expires_at?:  string,
 *   }
 *
 * 驗章：用 env.KYC_MOCK_SECRET 做 HMAC-SHA256（header `X-KYC-Signature: hex`）。
 * 缺 secret → fail（**production 一定要設**，否則任何人可偽造）。
 */

const SIGNATURE_HEADER = 'X-KYC-Signature'

export const mockKycAdapter = {
  async parseWebhook(request, env) {
    const secret = env?.KYC_MOCK_SECRET
    if (!secret) return { ok: false, error: 'KYC_MOCK_SECRET not configured' }

    const sigHeader = request.headers.get(SIGNATURE_HEADER) || ''
    const rawBody   = await request.text()

    const expected = await hmacSha256Hex(secret, rawBody)
    if (!constantTimeEq(expected, sigHeader)) {
      return { ok: false, error: 'signature_invalid' }
    }

    let payload
    try { payload = JSON.parse(rawBody) }
    catch { return { ok: false, error: 'bad_json' } }

    if (!payload?.event_id || !payload?.user_id || !payload?.status) {
      return { ok: false, error: 'missing_required_fields' }
    }

    return {
      ok:               true,
      event_id:         String(payload.event_id),
      user_id:          Number(payload.user_id),
      status:           payload.status,
      level:            payload.level,
      vendor_review_id: payload.vendor_review_id,
      rejection_reason: payload.rejection_reason,
      verified_at:      payload.verified_at,
      expires_at:       payload.expires_at,
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
