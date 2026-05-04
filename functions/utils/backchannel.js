/**
 * OIDC Back-Channel Logout 1.0
 * https://openid.net/specs/openid-connect-backchannel-1_0.html
 *
 * 用於 cross-site RP（如 sport-app on pages.dev）— frontchannel iframe 在
 * cross-site context 被瀏覽器 storage partitioning 切斷時，靠 server-to-server
 * POST 通知 RP 撤銷 user session。
 *
 * 對 same-site RP（mbti / talo）併行送一份做雙保險（如果它們各自也實作了
 * backchannel-logout endpoint；目前未實作則 fetch 失敗，不影響 frontchannel）。
 *
 * Logout token 規格（spec § 2.4）：
 *   header: { alg: ES256, kid, typ: 'logout+jwt' }
 *   payload:
 *     iss     必填 — IdP issuer
 *     aud     必填 — RP client_id
 *     iat     必填
 *     jti     必填 — RP 用此 dedup 防 replay
 *     sub 或 sid  至少一個 — 我們發 sub
 *     events  必填 — { "http://schemas.openid.net/event/backchannel-logout": {} }
 *     exp     不在 spec 強制；我們加 5min 防 replay 視窗無限大
 *     nonce   spec 明文禁止
 */

import { SignJWT, importJWK } from 'jose'
import { BACKCHANNEL_LOGOUT_ENDPOINTS } from './oauth-clients.js'

const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

// RP backchannel endpoint 來自 oauth-clients registry — 該 RP 的
// `backchannel_logout_uri` 為 null 即不會被 dispatch。mbti/talo 等待對等
// endpoint 實作後在 registry 補 URL 自動生效。
export { BACKCHANNEL_LOGOUT_ENDPOINTS as BACKCHANNEL_LOGOUT_URIS }

function randomJti() {
  const buf = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function signLogoutToken(sub, aud, env) {
  if (!env.JWT_PRIVATE_KEY) throw new Error('JWT_PRIVATE_KEY not configured')
  const jwk = JSON.parse(env.JWT_PRIVATE_KEY)
  const key = await importJWK(jwk, 'ES256')
  const kid = jwk.kid ?? 'key-1'

  return new SignJWT({
    sub: String(sub),
    events: { [LOGOUT_EVENT]: {} },
    jti: randomJti(),
  })
    .setProtectedHeader({ alg: 'ES256', kid, typ: 'logout+jwt' })
    .setIssuer('https://chiyigo.com')
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key)
}

/**
 * 對所有設定的 RP backchannel endpoint 平行送 logout_token。
 * Fire-and-forget — 不阻塞 caller，失敗 silent log。
 *
 * @param {object} env  Cloudflare env（需 JWT_PRIVATE_KEY）
 * @param {string|number} sub  user external id
 * @returns {Promise<void>}
 */
export async function dispatchBackchannelLogout(env, sub) {
  if (!sub) return
  await Promise.allSettled(BACKCHANNEL_LOGOUT_ENDPOINTS.map(async ({ aud, url }) => {
    try {
      const token = await signLogoutToken(sub, aud, env)
      const body = new URLSearchParams({ logout_token: token }).toString()
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })
      if (!res.ok) {
        console.warn('backchannel_logout_failed', { aud, status: res.status })
      }
    } catch (e) {
      console.warn('backchannel_logout_error', { aud, error: e?.message ?? String(e) })
    }
  }))
}
