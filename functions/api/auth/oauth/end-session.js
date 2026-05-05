/**
 * GET /api/auth/oauth/end-session
 *
 * OpenID Connect RP-Initiated Logout 1.0 § end_session_endpoint
 *
 * 流程：
 *  1. 解析 id_token_hint（驗簽，**不驗 exp** — spec 允許過期 id_token 作身份提示）
 *  2. 驗 post_logout_redirect_uri 在白名單
 *  3. 撤銷該 user 的所有 refresh_tokens（single sign-out 核心）
 *  4. 回 HTML：嵌入三個子站 frontchannel-logout iframe + meta refresh 跳 post_logout_redirect_uri
 *  5. clear refresh cookie（Domain=.chiyigo.com）
 *
 * Front-Channel Logout（OIDC Front-Channel 1.0）：
 *  - 各 client 在 iframe 載入時清自己 sessionStorage / localStorage
 *  - localStorage.setItem('oidc_logout_at', ts) 觸發同源主頁 storage event → 即時感知
 *
 * 安全：
 *  - id_token_hint 不驗 exp 但**驗簽**：阻止偽造身份撤銷別人 session
 *  - post_logout_redirect_uri 白名單嚴格列舉
 */

import { decodeProtectedHeader, jwtVerify, importJWK } from 'jose'
import { hashToken } from '../../../utils/crypto.js'
import { getPublicJwks } from '../../../utils/jwt.js'
import { CLEAR_REFRESH_COOKIE } from '../../../utils/cookies.js'
import { dispatchBackchannelLogout } from '../../../utils/backchannel.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import {
  ALLOWED_POST_LOGOUT_URIS,
  FRONTCHANNEL_LOGOUT_URIS,
  FRONTCHANNEL_FRAME_ORIGINS,
} from '../../../utils/oauth-clients.js'

const ALLOWED_POST_LOGOUT_REDIRECT = new Set(ALLOWED_POST_LOGOUT_URIS)

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function isAllowedPostLogoutUri(uri) {
  return typeof uri === 'string' && ALLOWED_POST_LOGOUT_REDIRECT.has(uri)
}

// id_token_hint 驗簽（不驗 exp）→ 取出 sub
async function verifyIdTokenHintGetSub(idToken, env) {
  if (!idToken || typeof idToken !== 'string') return null
  let kid = null
  try { kid = decodeProtectedHeader(idToken).kid ?? null } catch { return null }
  const jwks = getPublicJwks(env)
  const jwk  = kid ? jwks.find(k => k.kid === kid) : jwks[0]
  if (!jwk) return null
  const key = await importJWK(jwk, 'ES256')
  try {
    // currentDate=epoch 0 → 把「現在」當 1970-01-01，跳過 exp 驗證
    const { payload } = await jwtVerify(idToken, key, {
      algorithms: ['ES256'],
      issuer: 'https://chiyigo.com',
      currentDate: new Date(0),
    })
    return payload.sub ? String(payload.sub) : null
  } catch { return null }
}

function parseCookieHeader(header, name) {
  if (!header) return null
  const m = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return m ? m[1] : null
}

export async function onRequestGet({ request, env, waitUntil }) {
  const url = new URL(request.url)
  const idTokenHint            = url.searchParams.get('id_token_hint')
  const postLogoutRedirectUri  = url.searchParams.get('post_logout_redirect_uri') || 'https://chiyigo.com/'
  const state                  = url.searchParams.get('state') || ''

  if (!isAllowedPostLogoutUri(postLogoutRedirectUri)) {
    return new Response('post_logout_redirect_uri not allowed', { status: 400 })
  }

  // 1. id_token_hint → 撤該 user 的所有 refresh_tokens
  const sub = await verifyIdTokenHintGetSub(idTokenHint, env)
  if (sub) {
    const userId = parseInt(sub, 10)
    if (Number.isInteger(userId) && userId > 0) {
      await env.chiyigo_db
        .prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`)
        .bind(userId).run()
      await safeUserAudit(env, { event_type: 'oauth.end_session', user_id: userId, request, data: { via: 'id_token_hint' } })
      await safeUserAudit(env, { event_type: 'oauth.backchannel.dispatch', user_id: userId, request })
    }

    // OIDC Back-Channel Logout — 平行 fire-and-forget 通知所有 cross-site RP
    // （sport-app 等）。frontchannel iframe 在 storage partitioning 下對 cross-site
    // 失效，靠這條 server-to-server 路徑兜底。waitUntil 確保 fetch 在 response
    // 已回給瀏覽器後仍能完成，不阻塞 user redirect。
    if (typeof waitUntil === 'function') {
      waitUntil(dispatchBackchannelLogout(env, sub))
    } else {
      // dev fallback：沒 waitUntil 就同步等
      await dispatchBackchannelLogout(env, sub)
    }
  }

  // 2. 也撤 cookie 的 token（id_token_hint 缺失 / sub 不可解時的 fallback）
  // chiyigo 自己 sidebar 的登出按鈕走 end-session 時不帶 id_token_hint，
  // sub 上面解不出來，但 cookie 還在 — 從 cookie 反查 user_id 後也補上
  // backchannel dispatch，否則 sport-app 永遠收不到 logout 通知。
  const cookieToken = parseCookieHeader(request.headers.get('Cookie'), 'chiyigo_refresh')
  if (cookieToken) {
    const tokenHash = await hashToken(cookieToken)
    const row = await env.chiyigo_db
      .prepare(`SELECT user_id FROM refresh_tokens WHERE token_hash = ? LIMIT 1`)
      .bind(tokenHash).first()
    await env.chiyigo_db
      .prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL`)
      .bind(tokenHash).run()

    // 若 path 1（id_token_hint）沒 dispatch 過，這裡補一次。撤該 user 的所有
    // refresh + 通知 cross-site RP。
    if (!sub && row?.user_id) {
      const userId = row.user_id
      await env.chiyigo_db
        .prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`)
        .bind(userId).run()
      await safeUserAudit(env, { event_type: 'oauth.end_session', user_id: userId, request, data: { via: 'cookie_fallback' } })
      await safeUserAudit(env, { event_type: 'oauth.backchannel.dispatch', user_id: userId, request })
      if (typeof waitUntil === 'function') {
        waitUntil(dispatchBackchannelLogout(env, userId))
      } else {
        await dispatchBackchannelLogout(env, userId)
      }
    }
  }

  // 3. 拼最終 redirect（state 透傳）
  const finalRedirect = state
    ? `${postLogoutRedirectUri}${postLogoutRedirectUri.includes('?') ? '&' : '?'}state=${encodeURIComponent(state)}`
    : postLogoutRedirectUri

  // 4. 回 HTML：嵌入 frontchannel iframe + meta refresh
  const iframes = FRONTCHANNEL_LOGOUT_URIS
    .map(u => `<iframe src="${escAttr(u)}" sandbox="allow-scripts allow-same-origin" style="display:none" aria-hidden="true"></iframe>`)
    .join('\n')

  const cspFrameSrc = FRONTCHANNEL_FRAME_ORIGINS.join(' ')

  const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="2;url=${escAttr(finalRedirect)}">
<title>登出中…</title>
<style>html,body{margin:0;padding:0;background:#0b0b14;color:#e7e7ee;font-family:system-ui,-apple-system,sans-serif;height:100%}.box{display:flex;align-items:center;justify-content:center;height:100%;font-size:14px;opacity:.8}</style>
</head>
<body>
<div class="box">登出中，請稍候…</div>
${iframes}
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Set-Cookie':    CLEAR_REFRESH_COOKIE,
      // 寬鬆 CSP 給這頁：frame-src 來自 oauth-clients registry（去重 origin），禁絕其他
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; " +
        `frame-src ${cspFrameSrc}`,
      'Referrer-Policy': 'no-referrer',
    },
  })
}
