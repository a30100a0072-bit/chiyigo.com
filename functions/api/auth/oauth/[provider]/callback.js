/**
 * GET|POST /api/auth/oauth/[provider]/callback
 *
 * 動態 OAuth callback，支援 discord / google / line / facebook。
 * Apple 使用 form_post，故同時 export onRequestGet + onRequestPost。
 *
 * 流程：
 *  1. 提取 code + state（URL params 或 FormData）
 *  2. 原子核銷 oauth_states（DELETE RETURNING，防並發重放）
 *  3. 換取 access_token，取得 provider profile
 *  4. normalizeProfile → { provider_id, email, name, avatar, email_verified }
 *  5. 安防邏輯：
 *     - 無 email         → 302 /bind-email.html?token= (short-lived JWT)
 *     - email 碰撞       → trustEmail=true: 靜默綁定；false: 403 阻擋
 *     - 全新用戶         → 建立 user + identity
 *  6. 簽發 JWT + Refresh Token，依 platform 回傳
 */

import { jwtVerify, createRemoteJWKSet } from 'jose'
import { signJwt } from '../../../../utils/jwt'
import { generateSecureToken, hashToken } from '../../../../utils/crypto'
import { getProvider } from '../../../../utils/oauth-providers'
import { resolveAud } from '../../../../utils/cors'
import { refreshCookie, readOAuthDeviceCookie, CLEAR_OAUTH_DEVICE_COOKIE } from '../../../../utils/cookies'
import { safeUserAudit } from '../../../../utils/user-audit'
import { safeAlertAnomalies } from '../../../../utils/device-alerts'
import { computeRiskScore, shouldDenyByRisk, isRiskMedium } from '../../../../utils/risk-score'
import { sendRiskBlockedAlertEmail } from '../../../../utils/email'
import { buildTokenScope } from '../../../../utils/scopes'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7
const TEMP_BIND_TTL      = '10m'

// ── 入口（GET + POST 共用）────────────────────────────────────────

export const onRequestGet  = (ctx) => handle(ctx)
export const onRequestPost = (ctx) => handle(ctx)

const ALLOWED_PROVIDERS = new Set(['discord', 'google', 'line', 'facebook', 'apple'])

async function handle(context) {
  const { request, env, params } = context
  const provider = params.provider?.toLowerCase()

  // 白名單驗證：避免任意 provider 路徑反射 XSS
  if (!provider || !ALLOWED_PROVIDERS.has(provider)) {
    return htmlError('不支援的登入方式，請確認登入連結是否正確。')
  }

  const cfg = getProvider(provider, env)
  if (!cfg.clientId) return htmlError(`${provider} 尚未設定`)

  // ── 1. 提取 code + state（GET: URL params；POST: FormData）────
  let code, state, oauthError
  const contentType = request.headers.get('Content-Type') ?? ''

  if (request.method === 'POST' && contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData()
    code       = form.get('code')
    state      = form.get('state')
    oauthError = form.get('error')
  } else {
    const url  = new URL(request.url)
    code       = url.searchParams.get('code')
    state      = url.searchParams.get('state')
    oauthError = url.searchParams.get('error')
  }

  if (oauthError)
    return htmlError(`${provider} 授權被拒絕，請重新嘗試。`)

  if (!code || !state)
    return htmlError('缺少必要參數，請重新登入。')

  const db = env.chiyigo_db

  // ── 2. 原子核銷 oauth_states ─────────────────────────────────
  const stateRow = await db
    .prepare(`
      DELETE FROM oauth_states
      WHERE state_token = ? AND expires_at > datetime('now')
      RETURNING code_verifier, nonce, redirect_uri, platform, client_callback, aud
    `)
    .bind(state)
    .first()

  if (!stateRow) {
    await safeUserAudit(env, { event_type: 'oauth.callback.fail', severity: 'warn', request, data: { provider, reason_code: 'invalid_state' } })
    return htmlError('登入階段已過期或無效，請重新登入。')
  }

  const { code_verifier, nonce: expectedNonce, redirect_uri, platform, client_callback, aud: storedAud } = stateRow
  const baseUrl = env.IAM_BASE_URL ?? 'https://chiyigo.com'

  // ── 3. 換取 access_token ─────────────────────────────────────
  let providerTokens
  try {
    providerTokens = await exchangeCode({
      cfg, code, code_verifier, redirect_uri,
    })
  } catch (err) {
    await safeUserAudit(env, { event_type: 'oauth.callback.fail', severity: 'warn', request, data: { provider, reason_code: 'token_exchange_failed' } })
    return htmlError(`無法向 ${provider} 換取 Token：${err.message}`)
  }

  // ── 4. 取得並正規化 profile（含 OIDC nonce 驗證）─────────────
  let profile
  try {
    const rawProfile = await fetchProfile(provider, cfg, providerTokens, expectedNonce)
    profile = cfg.normalizeProfile(rawProfile)
  } catch (err) {
    await safeUserAudit(env, { event_type: 'oauth.callback.fail', severity: 'warn', request, data: { provider, reason_code: 'profile_fetch_failed' } })
    return htmlError(`無法取得 ${provider} 用戶資料：${err.message}`)
  }

  const { provider_id, email, name, avatar, email_verified } = profile

  // ── 5. 綁定模式（is_binding）─────────────────────────────────
  if (client_callback?.startsWith('binding:')) {
    const bindingUserId = Number(client_callback.slice('binding:'.length))
    if (!bindingUserId || !Number.isFinite(bindingUserId))
      return Response.redirect(`${baseUrl}/dashboard.html?bind_error=invalid_state`, 302)

    // 確認帳號仍有效
    const bindUser = await db
      .prepare('SELECT status FROM users WHERE id = ? AND deleted_at IS NULL')
      .bind(bindingUserId)
      .first()

    if (!bindUser || bindUser.status === 'banned')
      return Response.redirect(`${baseUrl}/dashboard.html?bind_error=account_invalid`, 302)

    // 檢查 provider_id 是否已被占用
    const existingBind = await db
      .prepare('SELECT user_id FROM user_identities WHERE provider = ? AND provider_id = ?')
      .bind(provider, provider_id)
      .first()

    if (existingBind) {
      const errCode = existingBind.user_id === bindingUserId ? 'already_linked' : 'identity_taken'
      return Response.redirect(`${baseUrl}/dashboard.html?bind_error=${errCode}`, 302)
    }

    // 執行綁定
    await db
      .prepare(`
        INSERT INTO user_identities (user_id, provider, provider_id, display_name, avatar_url)
        VALUES (?, ?, ?, ?, ?)
      `)
      .bind(bindingUserId, provider, provider_id, name ?? null, avatar ?? null)
      .run()

    return Response.redirect(`${baseUrl}/dashboard.html?bind=success&provider=${provider}`, 302)
  }

  // ── 6. 一般登入安防邏輯 ──────────────────────────────────────

  // 5a. 無信箱 → 發 temp_bind_token，導向補填頁
  if (!email) {
    const tempToken = await signJwt({
      sub:      provider_id,
      provider,
      name:     name ?? '',
      avatar:   avatar ?? '',
      scope:    'temp_bind',
    }, TEMP_BIND_TTL, env)

    const baseUrl = env.IAM_BASE_URL ?? 'https://chiyigo.com'
    return Response.redirect(
      `${baseUrl}/bind-email.html?token=${encodeURIComponent(tempToken)}`,
      302
    )
  }

  const emailLower = email.toLowerCase()

  // 5b. 檢查 user_identities 是否已有此 provider_id（既有綁定）
  const existingIdentity = await db
    .prepare(`
      SELECT ui.user_id FROM user_identities ui
      JOIN users u ON u.id = ui.user_id
      WHERE ui.provider = ? AND ui.provider_id = ? AND u.deleted_at IS NULL
    `)
    .bind(provider, provider_id)
    .first()

  let userId

  if (existingIdentity) {
    // 既有綁定：更新 display_name / avatar
    userId = existingIdentity.user_id
    await db.prepare(`
      UPDATE user_identities
      SET display_name = ?, avatar_url = ?, updated_at = datetime('now')
      WHERE provider = ? AND provider_id = ?
    `).bind(name ?? null, avatar ?? null, provider, provider_id).run()

  } else {
    // 5c. 檢查信箱是否已存在 DB
    const existingUser = await db
      .prepare(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL`)
      .bind(emailLower)
      .first()

    if (existingUser) {
      // 信箱碰撞 — 雙重守門：必須 provider trustEmail=true 且本次回傳 email_verified=true
      // 才允許靜默綁定，否則一律走密碼登入後手動綁定流程，避免 IdP 端假冒 email 接管帳號。
      if (!cfg.trustEmail || !email_verified) {
        return htmlError(
          `此信箱已透過密碼登入註冊。請改用「密碼登入」，登入後可在帳號設定中綁定 ${provider} 帳號。`,
          403
        )
      }
      // trustEmail=true 且 email_verified=true → 靜默綁定
      userId = existingUser.id
      await db.prepare(`
        INSERT OR IGNORE INTO user_identities
          (user_id, provider, provider_id, display_name, avatar_url)
        VALUES (?, ?, ?, ?, ?)
      `).bind(userId, provider, provider_id, name ?? null, avatar ?? null).run()

      await db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`)
        .bind(userId).run()

    } else {
      // 5d. 全新用戶 → 建立 user，再以 last_row_id 寫入 identity
      // （避免 D1 batch 中第二條 SELECT 不可見第一條 INSERT 的潛在問題）
      const emailVerifiedInt = email_verified ? 1 : 0
      const insertUser = await db
        .prepare(`INSERT INTO users (email, email_verified) VALUES (?, ?)`)
        .bind(emailLower, emailVerifiedInt)
        .run()
      userId = insertUser.meta?.last_row_id
      if (!userId) return htmlError('帳號建立失敗，請稍後重試。', 500)

      await db
        .prepare(`
          INSERT INTO user_identities
            (user_id, provider, provider_id, display_name, avatar_url)
          VALUES (?, ?, ?, ?, ?)
        `)
        .bind(userId, provider, provider_id, name ?? null, avatar ?? null)
        .run()
    }
  }

  // ── 7. 查詢 role / status ────────────────────────────────────
  const userRow = await db
    .prepare('SELECT email, email_verified, role, status, token_version FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow) return htmlError('帳號建立後無法查詢，請稍後重試。')
  if (userRow.status === 'banned') return htmlError('此帳號已被停用。', 403)

  // ── 7.5 Phase E-2 risk score（OAuth 分支）──
  const risk = await computeRiskScore(env, request, { userId, email: userRow.email })
  if (shouldDenyByRisk(risk.score)) {
    await safeUserAudit(env, {
      event_type: 'auth.risk.blocked', severity: 'critical',
      user_id: userId, request,
      data: { score: risk.score, factors: risk.factors, country: risk.country, method: `oauth:${provider}` },
    })
    if (env.RESEND_API_KEY && userRow.email) {
      try {
        await sendRiskBlockedAlertEmail(env.RESEND_API_KEY, userRow.email, {
          score: risk.score, factors: risk.factors, country: risk.country,
          when: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        }, env)
      } catch { /* swallow */ }
    }
    return htmlError('登入嘗試被風控擋下，已寄信至你的信箱請查收。', 403)
  }
  if (isRiskMedium(risk.score)) {
    await safeUserAudit(env, {
      event_type: 'auth.risk.medium', severity: 'warn',
      user_id: userId, request,
      data: { score: risk.score, factors: risk.factors, country: risk.country, method: `oauth:${provider}` },
    })
  }

  // ── 8. 簽發 Access Token ─────────────────────────────────────
  // 優先用 init 階段寫入的 aud（跨子網域 talo / mbti 走 web platform 也能正確簽）；
  // 缺值時 fallback：platform=pc 改看 client_callback origin；其餘 chiyigo（向後相容舊 row）
  const audience = storedAud
    ? resolveAud(storedAud)
    : ((platform === 'pc' && client_callback) ? resolveAud(client_callback) : 'chiyigo')
  const accessToken = await signJwt({
    sub:            String(userId),
    email:          userRow.email,
    email_verified: userRow.email_verified === 1,
    role:           userRow.role,
    status:         userRow.status,
    ver:            userRow.token_version ?? 0,
    scope:          buildTokenScope(userRow.role),
    provider,
  }, ACCESS_TOKEN_TTL, env, { audience })

  // ── 9. 依 platform 回傳 ──────────────────────────────────────
  if (platform === 'pc') {
    const dest = new URL(client_callback)
    dest.searchParams.set('access_token', accessToken)
    dest.searchParams.set('provider', provider)
    return Response.redirect(dest.toString(), 302)
  }

  if (platform === 'mobile') {
    return Response.redirect(
      `chiyigo://auth/callback?access_token=${encodeURIComponent(accessToken)}&provider=${provider}`,
      302
    )
  }

  // Web：建立 Refresh Token + HttpOnly Cookie + HTML bridge
  const refreshToken     = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19)

  // Phase 2026-05-07 browser-level device identity：client JS 在按 OAuth 按鈕前
  // 寫 chiyigo_oauth_device cookie；callback 取出後寫進 refresh_tokens 讓「我的裝置」
  // 能拆開顯示桌面 / 手機 / 不同 browser。沒 cookie 退回 NULL 行為（舊 client 相容）。
  const webDeviceUuid = readOAuthDeviceCookie(request)

  // Codex r9-5：issued_aud 鎖定發行時的 audience
  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time, issued_aud)
    VALUES (?, ?, ?, ?, datetime('now'), ?)
  `).bind(userId, refreshTokenHash, webDeviceUuid, refreshExpiresAt, audience).run()

  // Phase D-4：登入 audit + 異常裝置警示。webDeviceUuid 有值 → 視作真實裝置，
  // 觸發新裝置 email；NULL → 只跑 country jump（OAuth 舊行為）
  await safeUserAudit(env, {
    event_type: 'auth.login.success',
    user_id: userId, request,
    data: {
      method: `oauth:${provider}`,
      country: risk.country,
      ua_hash: risk.ua_hash,
      risk_score: risk.score,
      risk_factors: risk.factors,
    },
  })
  await safeAlertAnomalies(env, request, {
    userId, email: userRow.email, deviceUuid: webDeviceUuid,
  })

  // PKCE 模式（從 mbti.chiyigo.com 發起）：回到登入頁讓 auth-ui.js 完成授權碼交換
  let postLoginUrl = '/dashboard.html'
  if (client_callback?.startsWith('pkce_return:')) {
    const pk = client_callback.slice('pkce_return:'.length)
    if (/^[0-9a-f]{64}$/.test(pk)) {
      postLoginUrl = `/login.html?pkce_key=${encodeURIComponent(pk)}`
    }
  } else if (client_callback?.startsWith('next:')) {
    // next 模式：登入前在 init 端寫入的同站路徑，登入後跳回該頁（已於 init 校驗）
    const np = client_callback.slice('next:'.length)
    if (np && np.length <= 200 && np.charAt(0) === '/' && np.charAt(1) !== '/') {
      postLoginUrl = np
    }
  }

  const safeToken   = JSON.stringify(accessToken)
  const safeDestUrl = JSON.stringify(postLoginUrl)
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script>
try{sessionStorage.setItem('access_token',${safeToken});}catch(e){}
(function(){
  var ca=sessionStorage.getItem('_cross_app_redirect');
  if(ca){
    sessionStorage.removeItem('_cross_app_redirect');
    try{
      var p=JSON.parse(atob(${safeToken}.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
      var u=ca+'?mbti_token='+encodeURIComponent(${safeToken});
      if(p.email)u+='&mbti_email='+encodeURIComponent(p.email);
      location.replace(u);return;
    }catch(e){}
  }
  location.replace(${safeDestUrl});
})();
</script></head><body></body></html>`

  const headers = new Headers({
    'Content-Type':  'text/html;charset=UTF-8',
    'Cache-Control': 'no-store',
  })
  headers.append('Set-Cookie', refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400))
  // 清掉 chiyigo_oauth_device（已轉存到 refresh_tokens.device_uuid，cookie 任務完成）
  headers.append('Set-Cookie', CLEAR_OAUTH_DEVICE_COOKIE)
  return new Response(html, { status: 200, headers })
}

// ── Token 換取 ────────────────────────────────────────────────────

async function exchangeCode({ cfg, code, code_verifier, redirect_uri }) {
  const body = new URLSearchParams({
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type:    'authorization_code',
    code,
    redirect_uri,
  })
  // PKCE providers 帶 code_verifier
  if (code_verifier) body.set('code_verifier', code_verifier)

  const res = await fetch(cfg.tokenUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const msg = await res.text()
    throw new Error(`${res.status} ${msg}`)
  }
  return res.json()
}

// ── Profile 取得（provider 差異處理）────────────────────────────

async function fetchProfile(provider, cfg, tokens, expectedNonce) {
  // Apple：user info 在 id_token 內，無 userInfoUrl
  // P1-1：原本只 decodeJwtPayload 沒驗章 → 攻擊者可造任意 sub/email 取代帳號
  // 改 jwtVerify(JWKS) + 驗 iss/aud/nonce
  if (provider === 'apple') {
    if (!tokens.id_token) throw new Error('Apple id_token missing')
    const payload = await verifyAppleIdToken(tokens.id_token, cfg.clientId, expectedNonce)
    return payload
  }

  // Google：原本 trust userinfo HTTP body 的 email_verified；改驗 id_token 簽章
  // 取得權威 sub/email/email_verified（防止 token endpoint 與本地之間被中間人改 body）
  // init.js 永遠帶 openid scope，Google 必定回 id_token；缺失視為硬性失敗
  let googleClaims = null
  if (provider === 'google') {
    if (!tokens.id_token) throw new Error('Google id_token missing')
    googleClaims = await verifyGoogleIdToken(tokens.id_token, cfg.clientId, expectedNonce)
  }

  // LINE：email 在 id_token 內（scope 包含 email 時），驗 HMAC-SHA256 簽名
  // 注意：LINE id_token 簽章驗證失敗 / nonce 不符均視為硬性失敗（不再降級為「忽略 email」），
  // 否則攻擊者可注入未驗簽 id_token 取得本不應持有的 email。
  let lineEmail = null
  if (provider === 'line' && tokens.id_token) {
    const payload = await verifyLineIdToken(tokens.id_token, cfg.clientSecret)
    if (expectedNonce && payload.nonce !== expectedNonce) {
      throw new Error('id_token nonce mismatch')
    }
    lineEmail = payload.email ?? null
  }

  const res = await fetch(cfg.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!res.ok) throw new Error(`userInfo ${res.status}`)
  const raw = await res.json()

  // 將 LINE email 注入 raw profile（LINE profile API 不含 email）
  if (provider === 'line' && lineEmail) raw.email = lineEmail

  // Google：用 id_token 驗章後的 claim 覆寫 userinfo 的 sub/email/email_verified
  // userinfo 仍提供 name/picture（這兩個欄位偽造影響小）
  if (provider === 'google' && googleClaims) {
    raw.sub            = googleClaims.sub
    raw.email          = googleClaims.email ?? raw.email ?? null
    raw.email_verified = googleClaims.email_verified === true
  }

  return raw
}

// Google id_token 驗章（ES256/RS256，透過 JWKS）
// 模組級快取 JWKS：同一 isolate 內 Google 公鑰 fetch 僅一次（jose 內部會 respect HTTP cache headers）
let _googleJwks = null
function getGoogleJwks() {
  if (!_googleJwks) {
    _googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
  }
  return _googleJwks
}

async function verifyGoogleIdToken(idToken, expectedAud, expectedNonce) {
  const { payload } = await jwtVerify(idToken, getGoogleJwks(), {
    issuer:   ['https://accounts.google.com', 'accounts.google.com'],
    audience: expectedAud,
  })
  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce mismatch')
  }
  return payload
}

// Apple id_token 驗章（RS256，透過 JWKS）
let _appleJwks = null
function getAppleJwks() {
  if (!_appleJwks) {
    _appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
  }
  return _appleJwks
}

async function verifyAppleIdToken(idToken, expectedAud, expectedNonce) {
  const { payload } = await jwtVerify(idToken, getAppleJwks(), {
    issuer:   'https://appleid.apple.com',
    audience: expectedAud,
  })
  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error('id_token nonce mismatch')
  }
  return payload
}

// ── 工具 ─────────────────────────────────────────────────────────

// LINE id_token 驗簽（HS256，以 channel secret 為 key）
async function verifyLineIdToken(idToken, channelSecret) {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Invalid id_token format')
  const [headerB64, payloadB64, sigB64] = parts

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  )
  const sigBytes = Uint8Array.from(
    atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
    c => c.charCodeAt(0)
  )
  const valid = await crypto.subtle.verify(
    'HMAC', key, sigBytes,
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  )
  if (!valid) throw new Error('id_token signature invalid')

  const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('id_token expired')
  return payload
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

function htmlError(message, status = 400) {
  return new Response(
    `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
    <title>登入失敗</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0e0e12;color:#e4e4ef}
    .card{background:#16161d;border:1px solid #2a2a35;border-radius:16px;padding:2rem;text-align:center;max-width:420px}
    h2{color:#f87171;margin-bottom:1rem}a{color:#4f6ef7;text-decoration:none}</style></head>
    <body><div class="card">
    <h2>登入失敗</h2><p>${escapeHtml(message)}</p>
    <p style="margin-top:1.5rem"><a href="/login.html">← 返回登入頁</a></p>
    </div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  )
}
