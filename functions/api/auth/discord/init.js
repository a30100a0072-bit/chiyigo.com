/**
 * GET /api/auth/discord/init?platform=web|pc|mobile[&port=PORT]
 *
 * 啟動 Discord OAuth 2.0 + PKCE 流程。
 *
 * platform 參數決定最終客戶端回呼 URI（Discord redirect_uri 永遠指向我們的伺服器）：
 *   web    → client_callback = https://chiyigo.com（Web App 接收 token）
 *   pc     → client_callback = http://127.0.0.1:{port}/callback（遊戲引擎 Loopback）
 *   mobile → client_callback = chiyigo://auth/callback（Custom URI Scheme）
 *
 * 環境變數：
 *   DISCORD_CLIENT_ID   — Discord 應用程式 Client ID
 *   IAM_BASE_URL        — 本服務的公開根網址（預設 https://chiyigo.com）
 *
 * 流程：
 *   1. 生成 state（128-bit 隨機）
 *   2. 生成 PKCE code_verifier（256-bit 隨機）+ code_challenge（SHA-256 base64url）
 *   3. 存入 oauth_states（TTL 10 分鐘）
 *   4. 重導向至 Discord 授權頁
 */

const STATE_BYTES         = 16   // 128 bits
const VERIFIER_BYTES      = 32   // 256 bits
const STATE_TTL_MINUTES   = 10

const DISCORD_AUTH_URL    = 'https://discord.com/oauth2/authorize'
const DISCORD_SCOPES      = 'identify email'

// ── PKCE 工具 ────────────────────────────────────────────────────

function randomHex(byteCount) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteCount))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generatePkce() {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES))
  const code_verifier = toBase64Url(verifierBytes)
  const hashBuffer    = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(code_verifier)
  )
  const code_challenge = toBase64Url(hashBuffer)
  return { code_verifier, code_challenge }
}

// ── 平台回呼 URI 建構 ────────────────────────────────────────────

function buildClientCallback(platform, port) {
  switch (platform) {
    case 'pc':
      if (!port || !/^\d{4,5}$/.test(String(port)))
        throw new Error('platform=pc requires a valid port parameter (4-5 digits)')
      return `http://127.0.0.1:${port}/callback`
    case 'mobile':
      return 'chiyigo://auth/callback'
    case 'web':
    default:
      return null  // Web 直接在 callback.js 處理，無需另行重導
  }
}

// ── 主處理器 ─────────────────────────────────────────────────────

export async function onRequestGet({ request, env }) {
  const url      = new URL(request.url)
  const platform = url.searchParams.get('platform') ?? 'web'
  const port     = url.searchParams.get('port')

  if (!['web', 'pc', 'mobile'].includes(platform))
    return res({ error: 'Invalid platform. Must be web, pc, or mobile.' }, 400)

  // ── 1. PKCE ──────────────────────────────────────────────────
  let code_verifier, code_challenge
  try {
    ;({ code_verifier, code_challenge } = await generatePkce())
  } catch {
    return res({ error: 'Failed to generate PKCE challenge' }, 500)
  }

  // ── 2. State ─────────────────────────────────────────────────
  const state = randomHex(STATE_BYTES)

  // ── 3. 客戶端回呼 URI ────────────────────────────────────────
  let client_callback
  try {
    client_callback = buildClientCallback(platform, port)
  } catch (err) {
    return res({ error: err.message }, 400)
  }

  // ── 4. Discord redirect_uri（永遠指向我們的 callback 端點）──
  const baseUrl       = env.IAM_BASE_URL ?? 'https://chiyigo.com'
  const redirect_uri  = `${baseUrl}/api/auth/discord/callback`

  // ── 5. 存入 oauth_states（TTL 10 分鐘）──────────────────────
  const expires_at = new Date(Date.now() + STATE_TTL_MINUTES * 60_000)
    .toISOString().replace('T', ' ').slice(0, 19)

  try {
    await env.chiyigo_db
      .prepare(`
        INSERT INTO oauth_states
          (state_token, code_verifier, redirect_uri, platform, client_callback, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(state, code_verifier, redirect_uri, platform, client_callback ?? '', expires_at)
      .run()
  } catch {
    return res({ error: 'Failed to store OAuth state' }, 500)
  }

  // ── 6. 建構 Discord 授權 URL 並重導向 ────────────────────────
  const discordUrl = new URL(DISCORD_AUTH_URL)
  discordUrl.searchParams.set('client_id',              env.DISCORD_CLIENT_ID)
  discordUrl.searchParams.set('redirect_uri',           redirect_uri)
  discordUrl.searchParams.set('response_type',          'code')
  discordUrl.searchParams.set('scope',                  DISCORD_SCOPES)
  discordUrl.searchParams.set('state',                  state)
  discordUrl.searchParams.set('code_challenge',         code_challenge)
  discordUrl.searchParams.set('code_challenge_method',  'S256')
  discordUrl.searchParams.set('prompt',                 'none')  // 已授權過則跳過確認頁

  return Response.redirect(discordUrl.toString(), 302)
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
