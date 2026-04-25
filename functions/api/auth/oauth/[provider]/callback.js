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

import { signJwt } from '../../../../utils/jwt.js'
import { generateSecureToken, hashToken } from '../../../../utils/crypto.js'
import { getProvider } from '../../../../utils/oauth-providers.js'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7
const TEMP_BIND_TTL      = '10m'

// ── 入口（GET + POST 共用）────────────────────────────────────────

export const onRequestGet  = (ctx) => handle(ctx)
export const onRequestPost = (ctx) => handle(ctx)

async function handle(context) {
  const { request, env, params } = context
  const provider = params.provider?.toLowerCase()
  const cfg      = getProvider(provider, env)

  if (!cfg) return htmlError(`不支援的登入方式：${provider}`)
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
      RETURNING code_verifier, redirect_uri, platform, client_callback
    `)
    .bind(state)
    .first()

  if (!stateRow) return htmlError('登入階段已過期或無效，請重新登入。')

  const { code_verifier, redirect_uri, platform, client_callback } = stateRow

  // ── 3. 換取 access_token ─────────────────────────────────────
  let providerTokens
  try {
    providerTokens = await exchangeCode({
      cfg, code, code_verifier, redirect_uri,
    })
  } catch (err) {
    return htmlError(`無法向 ${provider} 換取 Token：${err.message}`)
  }

  // ── 4. 取得並正規化 profile ──────────────────────────────────
  let profile
  try {
    const rawProfile = await fetchProfile(provider, cfg, providerTokens)
    profile = cfg.normalizeProfile(rawProfile)
  } catch (err) {
    return htmlError(`無法取得 ${provider} 用戶資料：${err.message}`)
  }

  const { provider_id, email, name, avatar, email_verified } = profile

  // ── 5. 安防邏輯 ──────────────────────────────────────────────

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
      // 信箱碰撞
      if (!cfg.trustEmail) {
        // trustEmail=false（FB / LINE）→ 阻擋，要求密碼登入後手動綁定
        return htmlError(
          `此信箱已透過密碼登入註冊。<br>請改用「密碼登入」，登入後可在帳號設定中綁定 ${provider} 帳號。`,
          403
        )
      }
      // trustEmail=true（Discord / Google）→ 靜默綁定
      userId = existingUser.id
      await db.prepare(`
        INSERT OR IGNORE INTO user_identities
          (user_id, provider, provider_id, display_name, avatar_url)
        VALUES (?, ?, ?, ?, ?)
      `).bind(userId, provider, provider_id, name ?? null, avatar ?? null).run()

      if (email_verified) {
        await db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`)
          .bind(userId).run()
      }

    } else {
      // 5d. 全新用戶 → 建立 user + identity
      const emailVerifiedInt = email_verified ? 1 : 0
      await db.batch([
        db.prepare(`INSERT INTO users (email, email_verified) VALUES (?, ?)`)
          .bind(emailLower, emailVerifiedInt),
        db.prepare(`
          INSERT INTO user_identities
            (user_id, provider, provider_id, display_name, avatar_url)
          SELECT id, ?, ?, ?, ? FROM users WHERE email = ?
        `).bind(provider, provider_id, name ?? null, avatar ?? null, emailLower),
      ])

      const newUser = await db
        .prepare(`SELECT id FROM users WHERE email = ?`)
        .bind(emailLower)
        .first()
      userId = newUser.id
    }
  }

  // ── 6. 查詢 role / status ────────────────────────────────────
  const userRow = await db
    .prepare('SELECT email, email_verified, role, status FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow) return htmlError('帳號建立後無法查詢，請稍後重試。')
  if (userRow.status === 'banned') return htmlError('此帳號已被停用。', 403)

  // ── 7. 簽發 Access Token ─────────────────────────────────────
  const accessToken = await signJwt({
    sub:            String(userId),
    email:          userRow.email,
    email_verified: userRow.email_verified === 1,
    role:           userRow.role,
    status:         userRow.status,
    provider,
  }, ACCESS_TOKEN_TTL, env)

  // ── 8. 依 platform 回傳 ──────────────────────────────────────
  const baseUrl = env.IAM_BASE_URL ?? 'https://chiyigo.com'

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

  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at)
    VALUES (?, ?, NULL, ?)
  `).bind(userId, refreshTokenHash, refreshExpiresAt).run()

  // PKCE 模式（從 mbti.chiyigo.com 發起）：回到登入頁讓 auth-ui.js 完成授權碼交換
  let postLoginUrl = '/dashboard.html'
  if (client_callback?.startsWith('pkce_return:')) {
    const pk = client_callback.slice('pkce_return:'.length)
    if (/^[0-9a-f]{64}$/.test(pk)) {
      postLoginUrl = `/login.html?pkce_key=${encodeURIComponent(pk)}`
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

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type':  'text/html;charset=UTF-8',
      'Cache-Control': 'no-store',
      'Set-Cookie':    refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400),
    },
  })
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

async function fetchProfile(provider, cfg, tokens) {
  // Apple：user info 在 id_token 內，無 userInfoUrl
  if (provider === 'apple') {
    return decodeJwtPayload(tokens.id_token)
  }

  // LINE：email 在 id_token 內（scope 包含 email 時），驗 HMAC-SHA256 簽名
  let lineEmail = null
  if (provider === 'line' && tokens.id_token) {
    try {
      const payload = await verifyLineIdToken(tokens.id_token, cfg.clientSecret)
      lineEmail = payload.email ?? null
    } catch { /* 驗簽失敗或 token 過期，忽略 id_token email */ }
  }

  const res = await fetch(cfg.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!res.ok) throw new Error(`userInfo ${res.status}`)
  const raw = await res.json()

  // 將 LINE email 注入 raw profile（LINE profile API 不含 email）
  if (provider === 'line' && lineEmail) raw.email = lineEmail

  return raw
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

function decodeJwtPayload(token) {
  const part = token.split('.')[1]
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(json)
}

function refreshCookie(token, maxAge) {
  return `chiyigo_refresh=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}`
}

function htmlError(message, status = 400) {
  return new Response(
    `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
    <title>登入失敗</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0e0e12;color:#e4e4ef}
    .card{background:#16161d;border:1px solid #2a2a35;border-radius:16px;padding:2rem;text-align:center;max-width:420px}
    h2{color:#f87171;margin-bottom:1rem}a{color:#4f6ef7;text-decoration:none}</style></head>
    <body><div class="card">
    <h2>登入失敗</h2><p>${message}</p>
    <p style="margin-top:1.5rem"><a href="/login.html">← 返回登入頁</a></p>
    </div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  )
}
