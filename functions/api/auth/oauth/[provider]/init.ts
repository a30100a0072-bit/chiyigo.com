/**
 * GET /api/auth/oauth/[provider]/init?platform=web|pc|mobile[&port=PORT]
 *
 * 動態 OAuth 授權入口，支援 discord / google / line / facebook / apple。
 *
 * 流程：
 *  1. 從 URL 取得 provider，查設定檔確認支援
 *  2. 生成 state（CSRF 防禦）+ PKCE（支援的 provider）
 *  3. 寫入 oauth_states（TTL 10 分鐘），帶上 provider 欄位
 *  4. 302 重導向至第三方授權頁
 */

import { getProvider, SUPPORTED_PROVIDERS } from '../../../../utils/oauth-providers'
import { requireAuth, res } from '../../../../utils/auth'
import { checkRateLimit, recordRateLimit } from '../../../../utils/rate-limit'
import { resolveAud } from '../../../../utils/cors'
import { safeUserAudit } from '../../../../utils/user-audit'
import { isFactorAddAction, sidFromUser, requireFactorAddGrant } from '../../../../utils/elevation'

const STATE_BYTES       = 16   // 128 bits
const VERIFIER_BYTES    = 32   // 256 bits
const STATE_TTL_MINUTES = 10
const OAUTH_RL_WINDOW   = 60   // 1 分鐘
const OAUTH_RL_MAX      = 10   // 每 IP 每分鐘 10 次 init

// Facebook 不支援 PKCE，其餘均支援
const PKCE_UNSUPPORTED = new Set(['facebook'])

// OIDC providers — 會回傳 id_token，套用 nonce 防 replay
const OIDC_PROVIDERS = new Set(['google', 'line', 'apple'])

// ── PKCE 工具 ─────────────────────────────────────────────────────

function randomHex(n: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(n)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
}

function toBase64Url(buf: ArrayBuffer): string
function toBase64Url(buf: Uint8Array): string
function toBase64Url(buf: ArrayBuffer | ArrayLike<number>) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function generatePkce() {
  const raw       = crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES))
  const verifier  = toBase64Url(raw)
  const hashBuf   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { code_verifier: verifier, code_challenge: toBase64Url(hashBuf) }
}

// ── 平台回呼 URI ──────────────────────────────────────────────────

function buildClientCallback(platform: string, port: string | null) {
  switch (platform) {
    case 'pc':
      if (!port || !/^\d{4,5}$/.test(String(port)))
        throw new Error('platform=pc 需要有效的 port 參數（4-5 位數字）')
      return `http://127.0.0.1:${port}/callback`
    case 'mobile':
      return 'chiyigo://auth/callback'
    default:
      return null
  }
}

// ── 主處理器 ──────────────────────────────────────────────────────

export async function onRequestGet(context: { request: Request; env: Env; params: { provider?: string }; [key: string]: unknown }) {
  const { request, env, params } = context
  const provider = params.provider?.toLowerCase()

  // ── 1. 驗證 provider ────────────────────────────────────────
  if (!SUPPORTED_PROVIDERS.includes(provider))
    return res({ error: `不支援的登入方式：${provider}`, code: 'UNSUPPORTED_PROVIDER' }, 400)

  const cfg = getProvider(provider, env)
  if (!cfg?.clientId)
    return res({ error: `${provider} 尚未設定，請稍後再試`, code: 'PROVIDER_NOT_CONFIGURED' }, 503)

  // ── per-IP rate limit（防 oauth_states 表灌爆）──────────────
  const ip = request.headers.get('CF-Connecting-IP') ?? null
  if (ip) {
    const { blocked } = await checkRateLimit(env.chiyigo_db, {
      kind:           'oauth_init',
      ip,
      windowSeconds:  OAUTH_RL_WINDOW,
      max:            OAUTH_RL_MAX,
    })
    if (blocked) {
      return res({ error: 'Too many OAuth init requests. Please wait a moment.', code: 'RATE_LIMITED' }, 429)
    }
    await recordRateLimit(env.chiyigo_db, { kind: 'oauth_init', ip })
  }

  // Apple 需要特殊處理（form_post + JWT client_secret），目前預留
  if (provider === 'apple')
    return res({ error: 'Apple 登入尚未開放', code: 'APPLE_LOGIN_NOT_AVAILABLE' }, 503)

  const url        = new URL(request.url)
  const platform   = url.searchParams.get('platform') ?? 'web'
  const port       = url.searchParams.get('port')
  const pkceReturn = url.searchParams.get('pkce_key')
  const isBinding  = url.searchParams.get('is_binding') === 'true'
  const nextPath   = url.searchParams.get('next')
  const audInput   = url.searchParams.get('aud')
  // resolveAud 對未識別字串 fallback 'chiyigo'；綁定模式的 token 永遠 chiyigo（內部 binding 不跨域）
  const audience   = isBinding ? 'chiyigo' : resolveAud(audInput)

  if (!['web', 'pc', 'mobile'].includes(platform))
    return res({ error: 'platform 必須為 web、pc 或 mobile', code: 'INVALID_PLATFORM' }, 400)

  // ── 綁定模式（is_binding）：SEC-FACTOR-ADD PR-A3 — 綁新 OAuth identity 是 factor-add，需 grant ──
  // validate-not-consume（action='bind_identity'）；grant_hash 存進 oauth_states，callback 才 consume
  // （與 user_identities INSERT 同 batch；因 binding 的真正寫入點在 callback 的 async roundtrip 後）。
  let bindingUserId = null
  let bindingSid: string | null = null
  let bindingGrantHash: string | null = null
  if (isBinding) {
    const { userId: bUid, sid: bSid, grantTokenHash, error: gErr } = await requireFactorAddGrant(request, env, { action: 'bind_identity' })
    if (gErr) return gErr
    bindingUserId   = bUid
    bindingSid      = bSid
    bindingGrantHash = grantTokenHash
  }

  // ── Elevation 模式（SEC-FACTOR-ADD-A，purpose=elevation）──────
  // OAuth-reauth 鑄 factor-add grant：不 bind；驗當前 user 確有此 provider 既綁 identity；
  // callback 驗 provider_id match 既綁 → 建 one-time exchange code → /elevation/exchange 換 grant。
  const isElevation     = url.searchParams.get('purpose') === 'elevation'
  const elevationAction = url.searchParams.get('action')
  let elevationUserId: number | null = null
  let elevationSid: string | null = null
  if (isElevation) {
    if (!isFactorAddAction(elevationAction))
      return res({ error: 'action must be add_passkey | bind_wallet | bind_identity', code: 'INVALID_ACTION' }, 400)
    const { user, error: authError } = await requireAuth(request, env)
    if (authError) return authError
    elevationUserId = Number(user.sub)
    elevationSid = sidFromUser(user)
    // sid fail-closed（PR-0）：無 per-login sid 不得啟動 factor-add elevation
    if (!elevationSid)
      return res({ error: 'Session not eligible for factor-add elevation; re-login required', code: 'ELEVATION_SID_REQUIRED' }, 403)
    // 必須對「既綁」provider 重新 reauth（泛化錯誤，不洩漏該 provider 是否屬他人）
    // ORDER BY requires_reverification ASC → 取最小 rr：有任一 non-flagged identity 則 rr=0，全 flagged 則 rr=1。
    const existing = await env.chiyigo_db
      .prepare('SELECT requires_reverification AS rr FROM user_identities WHERE user_id = ? AND provider = ? ORDER BY requires_reverification ASC LIMIT 1')
      .bind(elevationUserId, provider).first()
    if (!existing)
      return res({ error: 'OAuth re-auth elevation unavailable for this provider', code: 'ELEVATION_PROVIDER_NOT_BOUND' }, 400)
    // OD-3（supplementary 早擋；load-bearing 在 callback 5a）：該 provider 的所有既綁 identity 都 flagged →
    // 不開啟 elevation reauth（省一次無謂 OAuth roundtrip）。emit reverification_required（無 provider_id，尚未 reauth）。
    if (existing.rr) {
      await safeUserAudit(env, { event_type: 'auth.credential.reverification_required', severity: 'warn', user_id: elevationUserId, request, data: { method: `oauth_reauth_elevation:${provider}`, action: elevationAction } })
      return res({ error: 'This identity requires re-verification before use', code: 'CREDENTIAL_REVERIFICATION_REQUIRED' }, 403)
    }
    if (ip) {
      const { blocked } = await checkRateLimit(env.chiyigo_db, { kind: 'elevation_oauth_start', userId: elevationUserId, windowSeconds: 300, max: 10 })
      if (blocked) return res({ error: 'Too many elevation requests. Please try again later.', code: 'RATE_LIMITED' }, 429)
      await recordRateLimit(env.chiyigo_db, { kind: 'elevation_oauth_start', userId: elevationUserId })
    }
    await safeUserAudit(env, { event_type: 'auth.elevation.started', user_id: elevationUserId, request, data: { method: 'oauth_reauth', action: elevationAction, provider } })
  }

  // ── 2. State（CSRF）+ PKCE + nonce（OIDC）──────────────────
  const state = randomHex(STATE_BYTES)
  const usePkce = !PKCE_UNSUPPORTED.has(provider)
  const { code_verifier, code_challenge } = usePkce
    ? await generatePkce()
    : { code_verifier: '', code_challenge: '' }
  // OIDC nonce：綁定 id_token 與此次授權 session，防止 id_token 被換到別的 session
  const nonce = OIDC_PROVIDERS.has(provider) ? randomHex(STATE_BYTES) : null

  // ── 3. 平台回呼 URI ─────────────────────────────────────────
  let client_callback
  try {
    client_callback = buildClientCallback(platform, port)
  } catch (err) {
    return res({ error: err.message, code: 'PC_PORT_REQUIRED' }, 400)
  }

  // Web + PKCE 模式：將 pkce_key 存入 client_callback，供 callback 回傳登入頁
  if (platform === 'web' && pkceReturn && /^[0-9a-f]{64}$/.test(pkceReturn)) {
    client_callback = `pkce_return:${pkceReturn}`
  }

  // Web + next 模式：將同站絕對路徑存入 client_callback，OAuth 完成後跳回該頁
  // 校驗：必須以 '/' 開頭、第二字非 '/'（防 protocol-relative URL 開放重定向）
  if (
    platform === 'web' &&
    !pkceReturn &&
    !isBinding &&
    nextPath &&
    nextPath.length <= 200 &&
    nextPath.charAt(0) === '/' &&
    nextPath.charAt(1) !== '/'
  ) {
    client_callback = `next:${nextPath}`
  }

  // 綁定模式：覆寫 client_callback，嵌入 binding user id
  if (isBinding && bindingUserId) {
    client_callback = `binding:${bindingUserId}`
  }

  // ── 4. Server-side redirect_uri（永遠指向我們的 callback）──
  const baseUrl      = env.IAM_BASE_URL ?? 'https://chiyigo.com'
  const redirect_uri = `${baseUrl}/api/auth/oauth/${provider}/callback`

  // ── 5. 寫入 oauth_states ────────────────────────────────────
  const expires_at = new Date(Date.now() + STATE_TTL_MINUTES * 60_000)
    .toISOString().replace('T', ' ').slice(0, 19)

  // SEC-FACTOR-ADD-A：oauth_states elevation 欄承載兩流程——
  //   purpose='elevation'（A2：OAuth-reauth 鑄 grant，無 grant_hash）
  //   purpose='factor_add_binding'（A3：is_binding factor-add，存 factor_add_grant_hash 供 callback consume）
  const statePurpose   = isElevation ? 'elevation' : (isBinding ? 'factor_add_binding' : null)
  const stateElevUser  = isElevation ? elevationUserId : (isBinding ? bindingUserId : null)
  const stateSessionId = isElevation ? elevationSid : (isBinding ? bindingSid : null)
  const stateAction    = isElevation ? elevationAction : (isBinding ? 'bind_identity' : null)
  const stateGrantHash = isBinding ? bindingGrantHash : null

  try {
    await env.chiyigo_db
      .prepare(`
        INSERT INTO oauth_states
          (state_token, code_verifier, nonce, redirect_uri, platform, client_callback, expires_at, ip_address, aud, created_at,
           purpose, elevation_user_id, session_id, action, factor_add_grant_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
      `)
      .bind(
        state, code_verifier, nonce, redirect_uri, platform, client_callback ?? '', expires_at, ip, audience,
        statePurpose, stateElevUser, stateSessionId, stateAction, stateGrantHash,
      )
      .run()
  } catch {
    return res({ error: 'OAuth 狀態儲存失敗，請重試', code: 'OAUTH_STATE_SAVE_FAILED' }, 500)
  }

  // ── 6. 建構授權 URL ─────────────────────────────────────────
  const authUrl = new URL(cfg.authUrl)
  authUrl.searchParams.set('client_id',     cfg.clientId)
  authUrl.searchParams.set('redirect_uri',  redirect_uri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope',         cfg.scope)
  authUrl.searchParams.set('state',         state)

  if (usePkce) {
    authUrl.searchParams.set('code_challenge',        code_challenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
  }

  if (nonce) authUrl.searchParams.set('nonce', nonce)

  // provider 特定參數
  if (provider === 'discord') authUrl.searchParams.set('prompt', 'consent')
  if (provider === 'google')  authUrl.searchParams.set('access_type', 'online')

  // 綁定 / elevation 模式：回傳 JSON，讓前端 JS 讀取後自行跳轉（不可用 302，因為需先帶 Authorization header）
  if (isBinding || isElevation) {
    return res({ redirect_url: authUrl.toString() })
  }

  return Response.redirect(authUrl.toString(), 302)
}

