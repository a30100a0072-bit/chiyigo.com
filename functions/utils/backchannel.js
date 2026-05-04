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

const LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout'

// RP backchannel endpoint map：client_id → URL
// mbti/talo 端尚未實作 endpoint；先列出以便對等實作後自動生效
export const BACKCHANNEL_LOGOUT_URIS = [
  { aud: 'sport-app',     url: 'https://sport-app-worker.a30100a0072.workers.dev/api/auth/backchannel-logout' },
  // { aud: 'mbti',     url: 'https://mbti.chiyigo.com/api/auth/backchannel-logout' },
  // { aud: 'talo',     url: 'https://talo.chiyigo.com/api/auth/backchannel-logout' },
]

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
  await Promise.allSettled(BACKCHANNEL_LOGOUT_URIS.map(async ({ aud, url }) => {
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
