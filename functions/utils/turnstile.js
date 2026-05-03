/**
 * Cloudflare Turnstile siteverify
 *
 * 行為：
 *   - 讀 request body 中的 'cf-turnstile-response' 欄位（widget 自動填入）
 *   - POST 到 https://challenges.cloudflare.com/turnstile/v0/siteverify
 *   - 通過 → ok: true；失敗 → ok: false + reason
 *
 * Graceful degradation：
 *   - env.TURNSTILE_SECRET_KEY 未設 → 直接 ok:true skipped:true
 *     讓 code 部署可以早於 dashboard 設 key（不破壞既有流程）
 *
 * 端點要怎麼接：
 *   const ts = await verifyTurnstile(request, body, env)
 *   if (!ts.ok) return res({ error: 'captcha_failed', reason: ts.reason }, 403)
 *
 * 不在 _middleware 統一接的理由：
 *   - 不是所有 endpoint 都需要 captcha（GET / 已驗證的 API）
 *   - 各端點 body 取 token 的位置不同（form vs JSON）
 *   - 失敗訊息要由 endpoint 決定（提示文字不同）
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * @param {Request} request
 * @param {object} body  已 parse 的 JSON body（從中取 cf-turnstile-response）
 * @param {object} env   含 TURNSTILE_SECRET_KEY
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
 */
export async function verifyTurnstile(request, body, env) {
  const secret = env?.TURNSTILE_SECRET_KEY
  if (!secret) return { ok: true, skipped: true }

  const token = body?.['cf-turnstile-response']
  if (!token || typeof token !== 'string') {
    return { ok: false, reason: 'token_missing' }
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? ''
  const form = new URLSearchParams()
  form.set('secret', secret)
  form.set('response', token)
  if (ip) form.set('remoteip', ip)

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body:   form,
    })
    const data = await res.json()
    if (data.success) return { ok: true }
    return { ok: false, reason: (data['error-codes'] || []).join(',') || 'verify_failed' }
  } catch {
    // siteverify 異常時 fail-open 還是 fail-close？
    // → fail-close（拒絕請求），避免 Cloudflare 故障時 captcha 失效被刷
    return { ok: false, reason: 'siteverify_unreachable' }
  }
}
