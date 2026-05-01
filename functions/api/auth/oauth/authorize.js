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
 *
 * 回傳：
 *  302 → /login.html?pkce_key=SESSION_KEY
 *  400 → 參數缺失 / 不合法
 */

import { generateSecureToken } from '../../../utils/crypto.js'

const SESSION_TTL_MS = 10 * 60 * 1000 // 10 分鐘完成登入

// redirect_uri 白名單（明確列舉，不接受 pattern 匹配 chiyigo.com 任意路徑）
const ALLOWED_REDIRECT_URIS = new Set([
  'chiyigo://auth/callback',                    // Unity / Unreal / mobile custom scheme
  'https://chiyigo.com/callback',               // Web SPA
  'https://chiyigo.com/app/callback',           // iOS Universal Link（預留）
  'https://mbti.chiyigo.com/login.html',        // mbti sub-domain
])

function isAllowedRedirectUri(uri) {
  if (ALLOWED_REDIRECT_URIS.has(uri)) return true
  // Loopback（Desktop Launcher，RFC 8252）
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

  if (responseType !== 'code')
    return res({ error: 'Only response_type=code is supported' }, 400)
  if (!redirectUri || !codeChallenge || !state)
    return res({ error: 'redirect_uri, code_challenge, and state are required' }, 400)
  if (codeChallengeMethod !== 'S256')
    return res({ error: 'Only code_challenge_method=S256 is supported' }, 400)
  if (!isAllowedRedirectUri(redirectUri))
    return res({ error: 'redirect_uri not allowed' }, 400)

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

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
