/**
 * GET /api/auth/oauth/authorize
 *
 * PKCE / OIDC 授權流程入口（IAM 作為 Authorization Server / OpenID Provider）。
 * 遊戲 / App / 子站 在系統瀏覽器開啟此 URL；IAM 驗參數後存 PKCE session，
 * 重導向至 login.html?pkce_key=... 讓用戶完成登入。
 *
 * 必填參數：
 *  response_type         = "code"
 *  redirect_uri          — 白名單驗證（https://chiyigo.com/、chiyigo://、loopback）
 *  code_challenge        — BASE64URL(SHA-256(code_verifier))
 *  code_challenge_method = "S256"
 *  state                 — 客戶端自行生成的隨機值（防 CSRF，原樣回傳）
 *
 * 選填參數（OIDC 擴充）：
 *  scope                 — 空白分隔 scope list；含 'openid' 才走完整 OIDC
 *                          支援值：openid / profile / email
 *  nonce                 — client 生成的隨機值，會被嵌入 id_token，client 驗 nonce 防 replay
 *                          當 scope 含 openid 時建議帶
 *  prompt                — OIDC: none / login（consent 暫未實作）
 *                          none  → 沒 session 時不顯示 UI，回 redirect_uri?error=login_required
 *                          login → 強制顯示 login UI，跳過 silent SSO
 *                          省略  → 有 session 走 silent，沒 session 走 login UI
 *  max_age               — OIDC: 上次互動式認證距今秒數上限。
 *                          超出 → silent 不命中，fall through 到 /login.html
 *                          （搭 prompt=none 則回 login_required）。0 等同強制重認。
 *
 * Silent SSO：當瀏覽器帶有 active 的 chiyigo_refresh cookie，
 * 直接 issue auth_code 並 302 到 redirect_uri，跳過 /login.html。
 * 不消耗 refresh_token，不延長 session 壽命。
 *
 * 回傳：
 *  302 → redirect_uri?code=...&state=...        (silent SSO 命中)
 *  302 → redirect_uri?error=login_required      (prompt=none 但無 session)
 *  302 → /login.html?pkce_key=SESSION_KEY       (走完整 login flow)
 *  400 → 參數缺失 / 不合法
 */

import { generateSecureToken } from '../../../utils/crypto.js'
import { res } from '../../../utils/auth.js'
import { getAllowedRedirectUris } from '../../../utils/oauth-clients.js'
import {
  readRefreshCookie,
  findActiveUserByRefreshCookie,
  issueAuthCodeAndBuildRedirect,
  buildLoginRequiredRedirect,
  isWithinMaxAge,
} from '../../../utils/oauth-session.js'

const SESSION_TTL_MS = 10 * 60 * 1000 // 10 分鐘完成登入

// redirect_uri 白名單來自 oauth-clients registry（D1 + KV cache + in-code fallback）
// 加 RP 走 D1（admin CRUD 或 SQL）；middleware 每請求 refresh cache（throttle 60s）。
function isAllowedRedirectUri(uri) {
  if (getAllowedRedirectUris().includes(uri)) return true
  // Loopback（Desktop Launcher，RFC 8252）— 動態 port，不在 registry
  if (/^http:\/\/127\.0\.0\.1:\d{1,5}\/callback$/.test(uri)) return true
  return false
}

// OIDC 支援的 scope 值（其他傳入會被忽略而非報錯，避免破壞既有 client）
const KNOWN_SCOPES = new Set(['openid', 'profile', 'email'])

function normalizeScope(raw) {
  if (!raw) return null
  const tokens = raw.split(/\s+/).filter(Boolean).filter(s => KNOWN_SCOPES.has(s))
  return tokens.length ? tokens.join(' ') : null
}

export async function onRequestGet({ request, env }) {
  const url    = new URL(request.url)
  const params = url.searchParams

  const responseType          = params.get('response_type')
  const redirectUri           = params.get('redirect_uri')
  const codeChallenge         = params.get('code_challenge')
  const codeChallengeMethod   = params.get('code_challenge_method')
  const state                 = params.get('state')
  const scope                 = normalizeScope(params.get('scope'))
  const nonce                 = params.get('nonce')  // 透傳，無格式限制
  const prompt                = params.get('prompt') // OIDC: none / login / consent
  const maxAgeRaw             = params.get('max_age')
  // OIDC §3.1.2.1 max_age: non-negative integer 秒數。
  // 解析失敗（NaN / 負值 / 非整數）→ 視為未指定（忽略，向後相容）。
  let maxAge = null
  if (maxAgeRaw !== null) {
    const n = Number(maxAgeRaw)
    if (Number.isInteger(n) && n >= 0) maxAge = n
  }

  if (responseType !== 'code')
    return res({ error: 'Only response_type=code is supported' }, 400)
  if (!redirectUri || !codeChallenge || !state)
    return res({ error: 'redirect_uri, code_challenge, and state are required' }, 400)
  if (codeChallengeMethod !== 'S256')
    return res({ error: 'Only code_challenge_method=S256 is supported' }, 400)
  if (!isAllowedRedirectUri(redirectUri))
    return res({ error: 'redirect_uri not allowed' }, 400)

  // ── Silent SSO（OIDC prompt 處理）──────────────────────────────
  // prompt=login 一律跳過 silent，強制顯示 login UI（即使有 session）。
  // 其他情況試讀 refresh cookie；查到 active user 就直接 issue auth_code 跳轉。
  if (prompt !== 'login') {
    const refreshToken = readRefreshCookie(request.headers.get('Cookie'))
    if (refreshToken) {
      const user = await findActiveUserByRefreshCookie(env, refreshToken)
      // max_age 命中失敗 → 視同無 active session：fall through 走 /login.html
      // （prompt=none 走下方 login_required 分支，符合 OIDC spec）
      if (user && isWithinMaxAge(user.auth_time, maxAge)) {
        const redirectUrl = await issueAuthCodeAndBuildRedirect(env, {
          userId: user.id, redirectUri, codeChallenge, state, scope, nonce,
          authTime: user.auth_time,
        })
        return Response.redirect(redirectUrl, 302)
      }
    }
    // 沒 cookie 或失效（含 max_age 超出）— 若 RP 要求 prompt=none，依 OIDC spec 回 login_required
    if (prompt === 'none') {
      return Response.redirect(buildLoginRequiredRedirect(redirectUri, state), 302)
    }
  }

  // ── 沒 silent 命中 → 走原本的 /login.html flow ─────────────────
  // 生成 session key 並存入 pkce_sessions
  const sessionKey = generateSecureToken()
  const expiresAt  = new Date(Date.now() + SESSION_TTL_MS)
    .toISOString().replace('T', ' ').slice(0, 19)
  const ip         = request.headers.get('CF-Connecting-IP') ?? null

  await env.chiyigo_db
    .prepare(`
      INSERT INTO pkce_sessions
        (session_key, state, code_challenge, redirect_uri, scope, nonce, expires_at, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `)
    .bind(sessionKey, state, codeChallenge, redirectUri, scope, nonce, expiresAt, ip)
    .run()

  // 重導至登入頁，帶上 session key
  const loginUrl = new URL('/login.html', url.origin)
  loginUrl.searchParams.set('pkce_key', sessionKey)

  return Response.redirect(loginUrl.toString(), 302)
}

