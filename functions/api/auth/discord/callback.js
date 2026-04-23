/**
 * GET /api/auth/discord/callback?code=CODE&state=STATE
 *
 * Discord OAuth 2.0 授權碼回呼處理器。
 *
 * 流程：
 *  1. 原子提取 oauth_states（DELETE ... RETURNING，防並發重放）
 *  2. 以 code + code_verifier 向 Discord 換取 access_token
 *  3. 以 Discord access_token 取得用戶 Profile
 *  4. Upsert users + user_identities（三種情境：已存在 Discord 身分 / email 相符 / 全新用戶）
 *  5. 簽發 ES256 JWT（含 role / status）
 *  6. 依 platform 重導向：web → IAM 登入頁, pc → loopback, mobile → chiyigo://
 *
 * 環境變數：
 *  DISCORD_CLIENT_ID     — Discord 應用程式 Client ID
 *  DISCORD_CLIENT_SECRET — Discord 應用程式 Client Secret
 *  IAM_BASE_URL          — 本服務公開根網址（預設 https://chiyigo.com）
 */

import { signJwt } from '../../../utils/jwt.js'
import { generateSecureToken, hashToken } from '../../../utils/crypto.js'

const DISCORD_TOKEN_URL   = 'https://discord.com/api/oauth2/token'
const DISCORD_PROFILE_URL = 'https://discord.com/api/users/@me'
const ACCESS_TOKEN_TTL    = '15m'
const REFRESH_TOKEN_DAYS  = 7

// ── Discord API ──────────────────────────────────────────────────

async function exchangeCode({ code, code_verifier, redirect_uri, env }) {
  const body = new URLSearchParams({
    client_id:     env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type:    'authorization_code',
    code,
    redirect_uri,
    code_verifier,
  })
  const res = await fetch(DISCORD_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status}`)
  return res.json()
}

async function fetchDiscordProfile(discord_access_token) {
  const res = await fetch(DISCORD_PROFILE_URL, {
    headers: { Authorization: `Bearer ${discord_access_token}` },
  })
  if (!res.ok) throw new Error(`Discord profile fetch failed: ${res.status}`)
  return res.json()
}

// ── 用戶 Upsert ──────────────────────────────────────────────────

/**
 * 三種情境：
 *  A. user_identities 中已有此 Discord ID → 取得 user_id，更新 display_name / avatar
 *  B. Discord email 與現有 users 相符 → 連結帳號，插入 user_identities
 *  C. 全新用戶 → 建立 users 記錄，插入 user_identities
 */
async function upsertDiscordUser(db, profile) {
  const discordId   = String(profile.id)
  const email       = profile.email
    ? profile.email.toLowerCase()
    : `discord_${discordId}@discord.invalid`
  const displayName = profile.global_name ?? profile.username ?? discordId
  const avatarUrl   = profile.avatar
    ? `https://cdn.discordapp.com/avatars/${discordId}/${profile.avatar}.png`
    : null
  const metadata    = JSON.stringify({
    username:      profile.username,
    discriminator: profile.discriminator,
    verified:      profile.verified ?? false,
  })

  // ── A. 已存在 Discord 身分 ──────────────────────────────────
  const existing = await db
    .prepare(`
      SELECT ui.user_id FROM user_identities ui
      JOIN users u ON u.id = ui.user_id
      WHERE ui.provider = 'discord' AND ui.provider_id = ?
        AND u.deleted_at IS NULL
    `)
    .bind(discordId)
    .first()

  if (existing) {
    await db.prepare(`
      UPDATE user_identities
      SET display_name = ?, avatar_url = ?, metadata = ?, updated_at = datetime('now')
      WHERE provider = 'discord' AND provider_id = ?
    `).bind(displayName, avatarUrl, metadata, discordId).run()

    return existing.user_id
  }

  // ── B. email 相符，連結已有帳號 ──────────────────────────────
  if (!email.endsWith('@discord.invalid')) {
    const byEmail = await db
      .prepare(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL`)
      .bind(email)
      .first()

    if (byEmail) {
      await db.prepare(`
        INSERT INTO user_identities
          (user_id, provider, provider_id, display_name, avatar_url, metadata)
        VALUES (?, 'discord', ?, ?, ?, ?)
      `).bind(byEmail.id, discordId, displayName, avatarUrl, metadata).run()

      // email_verified 同步（Discord email 需 profile.verified = true）
      if (profile.verified) {
        await db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`)
          .bind(byEmail.id).run()
      }
      return byEmail.id
    }
  }

  // ── C. 全新用戶 ──────────────────────────────────────────────
  const emailVerified = profile.verified ? 1 : 0
  await db.batch([
    db.prepare(`
      INSERT INTO users (email, email_verified) VALUES (?, ?)
    `).bind(email, emailVerified),
    db.prepare(`
      INSERT INTO user_identities
        (user_id, provider, provider_id, display_name, avatar_url, metadata)
      SELECT id, 'discord', ?, ?, ?, ? FROM users WHERE email = ?
    `).bind(discordId, displayName, avatarUrl, metadata, email),
  ])

  const newUser = await db
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(email)
    .first()
  return newUser.id
}

// ── 主處理器 ─────────────────────────────────────────────────────

export async function onRequestGet({ request, env }) {
  const url   = new URL(request.url)
  const code  = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  // 用戶在 Discord 頁面取消授權
  if (error) return htmlError(`Discord 授權被拒絕：${url.searchParams.get('error_description') ?? error}`)

  if (!code || !state) return htmlError('缺少必要參數 code 或 state')

  const db = env.chiyigo_db

  // ── 1. 原子提取並刪除 oauth_states（防並發重放）──────────────
  const stateRow = await db
    .prepare(`
      DELETE FROM oauth_states
      WHERE state_token = ? AND expires_at > datetime('now')
      RETURNING code_verifier, redirect_uri, platform, client_callback
    `)
    .bind(state)
    .first()

  if (!stateRow) return htmlError('OAuth state 無效或已過期，請重新登入')

  const { code_verifier, redirect_uri, platform, client_callback } = stateRow

  // ── 2. 向 Discord 換取 access_token ─────────────────────────
  let discordTokens
  try {
    discordTokens = await exchangeCode({ code, code_verifier, redirect_uri, env })
  } catch (err) {
    return htmlError(`無法向 Discord 換取 Token：${err.message}`)
  }

  // ── 3. 取得 Discord 用戶 Profile ────────────────────────────
  let profile
  try {
    profile = await fetchDiscordProfile(discordTokens.access_token)
  } catch (err) {
    return htmlError(`無法取得 Discord 用戶資料：${err.message}`)
  }

  // ── 4. Upsert 用戶 ───────────────────────────────────────────
  let userId
  try {
    userId = await upsertDiscordUser(db, profile)
  } catch (err) {
    return htmlError(`用戶資料寫入失敗：${err.message}`)
  }

  // ── 5. 取得用戶 role / status ────────────────────────────────
  const userRow = await db
    .prepare('SELECT email, email_verified, role, status FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow) return htmlError('用戶建立後無法查詢，請稍後重試')
  if (userRow.status === 'banned') return htmlError('此帳號已被封禁', 403)

  // ── 6. 簽發 ES256 JWT ────────────────────────────────────────
  const accessToken = await signJwt({
    sub:            String(userId),
    email:          userRow.email,
    email_verified: userRow.email_verified === 1,
    role:           userRow.role,
    status:         userRow.status,
    provider:       'discord',
  }, ACCESS_TOKEN_TTL, env)

  // ── 7. 依 platform 重導向 ────────────────────────────────────
  const baseUrl = env.IAM_BASE_URL ?? 'https://chiyigo.com'

  switch (platform) {
    case 'pc': {
      // PC: Loopback — client_callback 格式：http://127.0.0.1:PORT/callback
      const dest = new URL(client_callback)
      dest.searchParams.set('access_token', accessToken)
      dest.searchParams.set('provider', 'discord')
      return Response.redirect(dest.toString(), 302)
    }
    case 'mobile': {
      // Mobile: Custom URI Scheme — chiyigo://auth/callback
      const url = `chiyigo://auth/callback?access_token=${encodeURIComponent(accessToken)}&provider=discord`
      return Response.redirect(url, 302)
    }
    default: {
      // Web: 建立 refresh_token，回傳 200 HTML 帶 Set-Cookie
      // 不用 302 redirect，因為 Cloudflare CDN 可能過濾 redirect response 的 Set-Cookie
      const refreshToken     = generateSecureToken()
      const refreshTokenHash = await hashToken(refreshToken)
      const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
        .toISOString().replace('T', ' ').slice(0, 19)

      await db.prepare(`
        INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at)
        VALUES (?, ?, NULL, ?)
      `).bind(userId, refreshTokenHash, refreshExpiresAt).run()

      // JSON.stringify 確保 JWT 字串安全嵌入 JS（防 XSS）
      const safeToken = JSON.stringify(accessToken)
      const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<script>
try{sessionStorage.setItem('access_token',${safeToken});}catch(e){}
location.replace('/dashboard.html');
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
  }
}

// ── 工具 ─────────────────────────────────────────────────────────

function refreshCookie(token, maxAge) {
  return `chiyigo_refresh=${token}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${maxAge}`
}

function htmlError(message, status = 400) {
  return new Response(
    `<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8">
    <title>登入失敗</title>
    <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0e0e12;color:#e4e4ef}
    .card{background:#16161d;border:1px solid #2a2a35;border-radius:16px;padding:2rem;text-align:center;max-width:400px}
    h2{color:#f87171;margin-bottom:1rem}a{color:#4f6ef7;text-decoration:none}</style></head>
    <body><div class="card">
    <h2>登入失敗</h2><p>${message}</p>
    <p><a href="/login">← 返回登入頁</a></p>
    </div></body></html>`,
    { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  )
}
