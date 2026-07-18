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
import { resolveActiveTenantClaims } from '../../../../utils/tenant-context'
import { generateSecureToken, hashToken } from '../../../../utils/crypto'
import { getProvider } from '../../../../utils/oauth-providers'
import { resolveAud } from '../../../../utils/cors'
import { refreshCookie, readOAuthDeviceCookie, CLEAR_OAUTH_DEVICE_COOKIE } from '../../../../utils/cookies'
import { safeUserAudit, hashIdentifierForAudit } from '../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../utils/rate-limit'
import { consumeFactorAddGrantStmt } from '../../../../utils/elevation'
import { safeAlertAnomalies } from '../../../../utils/device-alerts'
import { computeRiskScore, shouldDenyByRisk, isRiskMedium } from '../../../../utils/risk-score'
import { sendRiskBlockedAlertEmail } from '../../../../utils/email'
import { buildTokenScope } from '../../../../utils/scopes'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7
const TEMP_BIND_TTL      = '10m'

// ── Provider fetch 韌性（timeout + 有界 retry；PR-2du）──────────────
// baseline §程式碼要求：外部呼叫必設 timeout + retry policy。token exchange 因
// authorization_code 單次核銷、逾時結果未知不可安全重送 → retry=0；userinfo GET
// 冪等純讀 → 有界 max-1 retry。OAUTH_FETCH_TIMEOUT_MS 同時覆寫兩者（test/ops
// escape hatch，沿 email.ts RESEND_TIMEOUT_MS 先例），下限 10ms、上限 15s。
const TOKEN_FETCH_TIMEOUT_MS_DEFAULT   = 8_000
const PROFILE_FETCH_TIMEOUT_MS_DEFAULT = 5_000
const PROFILE_MAX_ATTEMPTS             = 2      // 1 次初試 + 最多 1 次 retry
const PROFILE_RETRY_BACKOFF_MS         = 250
const FETCH_TIMEOUT_MAX_MS             = 15_000 // 上限 clamp：防 override 打破「禁無限等」

function parseFetchTimeoutMs(env: Env, fallbackMs: number): number {
  const raw = env.OAUTH_FETCH_TIMEOUT_MS
  if (raw == null || raw === '') return fallbackMs
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 10) return fallbackMs
  return Math.min(Math.floor(n), FETCH_TIMEOUT_MAX_MS)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ── 入口（GET + POST 共用）────────────────────────────────────────

export const onRequestGet  = (ctx: { request: Request; env: Env; params: { provider?: string }; [key: string]: unknown }) => handle(ctx)
export const onRequestPost = (ctx: { request: Request; env: Env; params: { provider?: string }; [key: string]: unknown }) => handle(ctx)

const ALLOWED_PROVIDERS = new Set(['discord', 'google', 'line', 'facebook', 'apple'])

async function handle(context: { request: Request; env: Env; params: { provider?: string }; [key: string]: unknown }) {
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

  // File-narrow guard（PR-2du）：POST form_post 下 code/state 為 FormDataEntryValue
  // (File | string)；poisoned multipart 可讓其為 File → 若流下去，state=File 會使
  // D1 .bind() 拋 D1_TYPE_ERROR（裸露、無 catch → 500），code=File 會白打一次
  // provider 外呼並燒掉 state row。narrow 成 string 使兩者在 state 核銷前 fail-closed。
  // 此 narrow 亦是 exchangeCode({ code: string }) 的型別前置（見 plan §4.6）。
  if (typeof code !== 'string' || !code || typeof state !== 'string' || !state)
    return htmlError('缺少必要參數，請重新登入。')

  const db = env.chiyigo_db

  // ── 2. 原子核銷 oauth_states ─────────────────────────────────
  const stateRow = await db
    .prepare(`
      DELETE FROM oauth_states
      WHERE state_token = ? AND expires_at > datetime('now')
      RETURNING code_verifier, nonce, redirect_uri, platform, client_callback, aud,
                purpose, elevation_user_id, session_id, action, factor_add_grant_hash
    `)
    .bind(state)
    .first()

  if (!stateRow) {
    await safeUserAudit(env, { event_type: 'oauth.callback.fail', severity: 'warn', request, data: { provider, reason_code: 'invalid_state' } })
    return htmlError('登入階段已過期或無效，請重新登入。')
  }

  const {
    code_verifier, nonce: expectedNonce, redirect_uri, platform, client_callback, aud: storedAud,
    purpose: statePurpose, elevation_user_id: elevationUserId, session_id: elevationSessionId, action: elevationAction,
    factor_add_grant_hash: bindingGrantHash,
  } = stateRow
  const baseUrl = env.IAM_BASE_URL ?? 'https://chiyigo.com'

  // SEC-FACTOR-ADD-A：elevation callback 在 provider token-exchange 前 per-user 節流
  // （Codex Code Gate r1 watch item；flow 已被 elevation_oauth_start + one-time state + exchange
  // 三層 bound，本層為 defense-in-depth，限 reauth callback 的 provider fetch 量）。
  if (statePurpose === 'elevation') {
    const elevUid = Number(elevationUserId)
    if (Number.isFinite(elevUid)) {
      const { blocked } = await checkRateLimit(db, { kind: 'elevation_oauth_callback', userId: elevUid, windowSeconds: 300, max: 10 })
      if (blocked) return Response.redirect(`${baseUrl}/dashboard.html?elev_error=rate_limited`, 302)
      await recordRateLimit(db, { kind: 'elevation_oauth_callback', userId: elevUid })
    }
  }

  // provider fetch timeout（PR-2du）：token/userinfo 各自 default、OAUTH_FETCH_TIMEOUT_MS 同時覆寫兩者
  const tokenTimeoutMs   = parseFetchTimeoutMs(env, TOKEN_FETCH_TIMEOUT_MS_DEFAULT)
  const profileTimeoutMs = parseFetchTimeoutMs(env, PROFILE_FETCH_TIMEOUT_MS_DEFAULT)

  // ── 3. 換取 access_token ─────────────────────────────────────
  let providerTokens
  try {
    providerTokens = await exchangeCode({
      cfg, code, code_verifier, redirect_uri, timeoutMs: tokenTimeoutMs,
    })
  } catch (err) {
    await safeUserAudit(env, { event_type: 'oauth.callback.fail', severity: 'warn', request, data: { provider, reason_code: 'token_exchange_failed' } })
    return htmlError(`無法向 ${provider} 換取 Token：${err.message}`)
  }

  // ── 4. 取得並正規化 profile（含 OIDC nonce 驗證）─────────────
  let profile
  try {
    const rawProfile = await fetchProfile(provider, cfg, providerTokens, expectedNonce, profileTimeoutMs)
    profile = cfg.normalizeProfile(rawProfile)
  } catch (err) {
    await safeUserAudit(env, { event_type: 'oauth.callback.fail', severity: 'warn', request, data: { provider, reason_code: 'profile_fetch_failed' } })
    return htmlError(`無法取得 ${provider} 用戶資料：${err.message}`)
  }

  const { provider_id, email, name, avatar, email_verified } = profile

  // ── 5a. Elevation 模式（SEC-FACTOR-ADD-A，purpose=elevation）──
  // **不** bind、**不** login。驗 reauth 回來的 (provider, provider_id) match 當前 user 既綁 identity →
  // 建 one-time exchange code（2min、session 綁、action 透傳）→ fragment redirect（grant_token 不入 URL，
  // 由 /elevation/exchange 經 POST body 鑄出）。不 match → provider_mismatch（critical，泛化錯誤）。
  if (statePurpose === 'elevation') {
    const elevUserId = Number(elevationUserId)
    if (!elevUserId || !Number.isFinite(elevUserId) || !elevationSessionId || !elevationAction) {
      return Response.redirect(`${baseUrl}/dashboard.html?elev_error=invalid_state`, 302)
    }
    const existing = await db
      .prepare('SELECT requires_reverification AS rr FROM user_identities WHERE user_id = ? AND provider = ? AND provider_id = ? LIMIT 1')
      .bind(elevUserId, provider, provider_id).first()
    if (!existing) {
      await safeUserAudit(env, {
        event_type: 'auth.elevation.provider_mismatch', severity: 'critical',
        user_id: elevUserId, request, data: { provider, action: elevationAction },
      })
      return Response.redirect(`${baseUrl}/dashboard.html?elev_error=provider_mismatch`, 302)
    }
    // OD-3 D1（permanent-persistence seam，hard blocker）：matched identity flagged → 不得當 factor-add elevation
    // proof。擋在鑄 exchange code / factor-add grant 之前 —— 植入的 identity 本就由攻擊者掌握，用它自證去鑄新
    // （未被 flag、可獨立登入、永久存活的）因子會繞回 #78 gate；reverify（owner-vouch）或刪除後才放行。
    if (existing.rr) {
      const rvSig = await hashIdentifierForAudit(env, 'oauth-provider-id', String(provider_id))
      await safeUserAudit(env, {
        event_type: 'auth.credential.reverification_required', severity: 'warn',
        user_id: elevUserId, request,
        data: { method: `oauth_reauth_elevation:${provider}`, action: elevationAction, provider_id_hmac16: rvSig.hex.slice(0, 16), salted: rvSig.salted },
      })
      return Response.redirect(`${baseUrl}/dashboard.html?elev_error=reverification_required`, 302)
    }
    // match → 建 one-time exchange code（provider_id 只存 keyed-HMAC，不存明文）
    const exchangeCode      = generateSecureToken()
    const exchangeCodeHash  = await hashToken(exchangeCode)
    const providerIdSig     = await hashIdentifierForAudit(env, 'oauth-provider-id', String(provider_id))
    const exchangeExpiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
    await db
      .prepare(`INSERT INTO elevation_exchanges
                  (exchange_code_hash, user_id, session_id, provider, provider_id_hash, action, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(exchangeCodeHash, elevUserId, elevationSessionId, provider, providerIdSig.hex.slice(0, 32), elevationAction, exchangeExpiresAt)
      .run()
    // fragment（#）交付一次性 exchange code：降 server/referrer 暴露；grant_token 永不入 URL（OD-3 contract）
    return Response.redirect(`${baseUrl}/dashboard.html#elev_exchange=${encodeURIComponent(exchangeCode)}`, 302)
  }

  // ── 5. 綁定模式（is_binding）─────────────────────────────────
  if (client_callback?.startsWith('binding:')) {
    const bindingUserId = Number(client_callback.slice('binding:'.length))
    if (!bindingUserId || !Number.isFinite(bindingUserId))
      return Response.redirect(`${baseUrl}/dashboard.html?bind_error=invalid_state`, 302)

    // SEC-FACTOR-ADD PR-A3：綁新 OAuth identity = factor-add，必須帶 factor_add_binding grant
    // （init validate-not-consume 已存 factor_add_grant_hash；此處 consume + INSERT 同 batch）。
    if (statePurpose !== 'factor_add_binding' || !bindingGrantHash || !elevationSessionId)
      return Response.redirect(`${baseUrl}/dashboard.html?bind_error=elevation_required`, 302)

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

    // 執行綁定：grant consume（CAS）+ user_identities INSERT 同一 atomic db.batch（both-or-neither）。
    // S1 consume 失敗（changes≠1）→ S2 gated INSERT 不插 → 不綁、replay_detected。
    const batch = await db.batch([
      consumeFactorAddGrantStmt(env, { grantTokenHash: String(bindingGrantHash), userId: bindingUserId, sid: String(elevationSessionId), action: 'bind_identity' }),
      db.prepare(`
        INSERT INTO user_identities (user_id, provider, provider_id, display_name, avatar_url)
        SELECT ?, ?, ?, ?, ? WHERE changes() = 1
      `).bind(bindingUserId, provider, provider_id, name ?? null, avatar ?? null),
    ])
    if (batch[0].meta.changes !== 1) {
      await safeUserAudit(env, { event_type: 'auth.elevation.replay_detected', severity: 'critical', user_id: bindingUserId, request, data: { stage: 'oauth_binding_consume', provider } })
      return Response.redirect(`${baseUrl}/dashboard.html?bind_error=elevation_consumed`, 302)
    }

    // SEC-FACTOR-ADD-A PR-A4：綁定成功 audit（給未來 disposition 的 add-time context）。
    // payload 無明文 provider_id（keyed-HMAC）；safe-audit 失敗不中斷綁定主流程（OD-5）。
    const bindSig = await hashIdentifierForAudit(env, 'oauth-provider-id', String(provider_id))
    await safeUserAudit(env, {
      event_type: 'oauth.identity.bind.success', severity: 'info', user_id: bindingUserId, request,
      data: { provider, provider_id_hmac16: bindSig.hex.slice(0, 16), salted: bindSig.salted },
    })

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
      SELECT ui.user_id, ui.requires_reverification FROM user_identities ui
      JOIN users u ON u.id = ui.user_id
      WHERE ui.provider = ? AND ui.provider_id = ? AND u.deleted_at IS NULL
    `)
    .bind(provider, provider_id)
    .first()

  let userId

  if (existingIdentity) {
    // OD-3：flagged identity 使用前強制 re-verify。擋在 display_name/avatar UPDATE 與簽 token 之前
    // → deny path 不寫 profile、不簽 token；redirect 回登入頁帶 reverification_required（redirect surface 契約）。
    if (existingIdentity.requires_reverification) {
      const rvSig = await hashIdentifierForAudit(env, 'oauth-provider-id', String(provider_id))
      await safeUserAudit(env, {
        event_type: 'auth.credential.reverification_required', severity: 'warn',
        user_id: existingIdentity.user_id, request,
        data: { method: `oauth_login:${provider}`, provider_id_hmac16: rvSig.hex.slice(0, 16), salted: rvSig.salted },
      })
      return Response.redirect(`${baseUrl}/login.html?reverification_required=1&provider=${provider}`, 302)
    }
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
  // PR-0（sid claim）：sid ⟺ 後端有對應 refresh_tokens.session_id row。
  // 僅 web path（下方）建 refresh row；pc/mobile 為 direct-return 的 access-only token
  // （無 refresh row）→ **不帶 sid**，使其 factor-add elevation fail-closed（Codex Code Gate r1）。
  const isWebReturn = platform !== 'pc' && platform !== 'mobile'
  const sessionId = isWebReturn ? crypto.randomUUID() : null
  const tenantClaims = await resolveActiveTenantClaims(env.chiyigo_db, Number(userId))
  const accessToken = await signJwt({
    ...tenantClaims,
    sub:            String(userId),
    email:          userRow.email,
    email_verified: userRow.email_verified === 1,
    role:           userRow.role,
    status:         userRow.status,
    ver:            userRow.token_version ?? 0,
    scope:          buildTokenScope(userRow.role),
    provider,
    ...(sessionId ? { sid: sessionId } : {}),
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
  // PR5 5d-1b: + a fresh per-login session_id (the session.revoked family id, preserved across rotation).
  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time, issued_aud, session_id)
    VALUES (?, ?, ?, ?, datetime('now'), ?, ?)
  `).bind(userId, refreshTokenHash, webDeviceUuid, refreshExpiresAt, audience, sessionId).run()

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

async function exchangeCode({ cfg, code, code_verifier, redirect_uri, timeoutMs }: {
  cfg: ReturnType<typeof getProvider>
  code: string
  code_verifier: string | null
  redirect_uri: string
  timeoutMs: number
}) {
  const body = new URLSearchParams({
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type:    'authorization_code',
    code,
    redirect_uri,
  })
  // PKCE providers 帶 code_verifier
  if (code_verifier) body.set('code_verifier', code_verifier)

  // authorization_code 單次核銷、逾時結果未知 → retry=0（單發）。timer 覆蓋 fetch +
  // 兩個 body reader（res.text() error path / res.json() success path）；bare abort()
  // 不洩漏 timeout config 到 err.message。故 return await（非 return res.json()）。
  const ctrl = new AbortController()
  const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(cfg.tokenUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal:  ctrl.signal,
    })
    if (!res.ok) {
      const msg = await res.text()
      throw new Error(`${res.status} ${msg}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Profile 取得（provider 差異處理）────────────────────────────

async function fetchProfile(provider: string, cfg: ReturnType<typeof getProvider>, tokens: { id_token?: string; access_token?: string }, expectedNonce: string | null, timeoutMs: number) {
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
  // 注意：LINE id_token 簽章 / claim 驗證失敗均視為硬性失敗（不再降級為「忽略 email」），
  // 否則攻擊者可注入未驗簽 id_token 取得本不應持有的 email。
  // nonce 比對已移入 verifyLineIdToken（單一權威，PR-2dv OD-2）— 此處不得再驗。
  let lineEmail = null
  if (provider === 'line' && tokens.id_token) {
    const payload = await verifyLineIdToken(tokens.id_token, cfg.clientId, cfg.clientSecret, expectedNonce)
    lineEmail = payload.email ?? null
  }

  // userinfo GET 冪等純讀 → 有界 retry（見 fetchUserInfoWithRetry；verify* 在此之前、
  // 逐字不動、NOT in retry loop）
  const raw = await fetchUserInfoWithRetry(cfg.userInfoUrl, tokens.access_token, timeoutMs)

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

// userinfo GET 的 timeout + 有界 retry（PR-2du）。冪等純讀（同 Bearer 重讀同資源），
// max 1 retry。分類**不 introspect error 形狀**（test mock / workerd 形狀不可靠）：
//   - didTimeout：由本地 timer callback 設，涵蓋 fetch 與 res.json() 兩階段 → timeout 皆 retry
//   - res === undefined：fetch 在回 Response 前 reject（network 等）→ retry
//   - res 已設 ∧ ¬didTimeout（malformed body 的 json reject）→ terminal，不 retry
// 4xx/429 與最終 5xx 對 resolved res 判斷、落 catch 之外。timer 涵蓋 body-read（return await）。
async function fetchUserInfoWithRetry(url: string, accessToken: string | undefined, timeoutMs: number) {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController()
    let didTimeout = false
    const timeoutId = setTimeout(() => { didTimeout = true; ctrl.abort() }, timeoutMs)
    let res
    let failure: unknown
    let failed = false
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: ctrl.signal })
      if (res.ok) return await res.json()
    } catch (err) {
      failed = true
      failure = err
    } finally {
      clearTimeout(timeoutId)
    }
    if (failed) {
      if ((didTimeout || res === undefined) && attempt < PROFILE_MAX_ATTEMPTS) {
        await sleep(PROFILE_RETRY_BACKOFF_MS)
        continue
      }
      throw failure instanceof Error ? failure : new Error('userInfo fetch failed')
    }
    if (res.status >= 500 && attempt < PROFILE_MAX_ATTEMPTS) {
      await sleep(PROFILE_RETRY_BACKOFF_MS)
      continue
    }
    throw new Error(`userInfo ${res.status}`)
  }
}

// Google id_token 驗章（ES256/RS256，透過 JWKS）
// 模組級快取 JWKS：同一 isolate 內 Google 公鑰 fetch 僅一次（jose 內部會 respect HTTP cache headers）
let _googleJwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getGoogleJwks() {
  if (!_googleJwks) {
    _googleJwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
  }
  return _googleJwks
}

async function verifyGoogleIdToken(idToken: string, expectedAud: string | null, expectedNonce: string | null) {
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
let _appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null
function getAppleJwks() {
  if (!_appleJwks) {
    _appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))
  }
  return _appleJwks
}

async function verifyAppleIdToken(idToken: string, expectedAud: string | null, expectedNonce: string | null) {
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

// LINE id_token 的 iss（LINE 官方文件確切值）。pin 為 literal：值錯會使全 LINE 登入失敗，
// 且不得誤用 authorize-URL host（access.line.me 無尾斜線）。
const LINE_ISSUER = 'https://access.line.me'

// LINE id_token 驗簽（HS256，以 channel secret 為 key）+ claim 驗證。
// 本函式是 LINE claim 的單一權威（PR-2dv OD-2）：alg → signature → iss → aud → exp → nonce，
// 全部 fail-closed。caller 不得再自行驗任何 claim（雙軌會讓其中一軌被靜默改弱）。
async function verifyLineIdToken(
  idToken: string,
  expectedAud: string | null,
  channelSecret: string | null,
  expectedNonce: string | null,
) {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('Invalid id_token format')
  const [headerB64, payloadB64, sigB64] = parts

  // alg 先於驗章：LINE Web login 恆 HS256。先拒非 HS256 header 可讓「謊報 alg」在未來
  // 有人改寫此函式成 header-driven 選演算法時就已被獨立 gate 擋下（alg-confusion DiD）。
  const header = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')))
  if (header.alg !== 'HS256') throw new Error('id_token unexpected alg')

  // 兩種 misconfig 的成因不同，都必須在 importKey 前擋下：
  //   null（未設 LINE_CLIENT_SECRET）→ encode(null) 會編出字面字串 "null" 的 4 bytes、importKey
  //     照收 → 知情攻擊者可用 key "null" 自簽並通過驗章（實測 base：建帳號 + 簽發 access_token）。
  //     此分支是本 guard 的 load-bearing 理由。
  //   ''（設為空字串）→ importKey 拒 0-length key 而拋例外，本身已 fail-closed，惟該例外訊息
  //     會把 crypto 內部細節回顯到錯誤頁。
  // 複用 generic signature invalid：不對外區分 misconfig 與真正的簽章失敗。
  if (typeof channelSecret !== 'string' || channelSecret.length === 0) throw new Error('id_token signature invalid')
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

  // iss：擋其他 IdP 簽出的 token 冒充 LINE。
  if (payload.iss !== LINE_ISSUER) throw new Error('id_token issuer mismatch')

  // aud：擋跨 channel 重放（別的 LINE channel 簽給自己的 token 拿來登入本站）。
  // string-only exact — LINE 官方文件定義 aud Type = String（Channel ID）。OIDC generic
  // 契約才允許 array；HS256（MAC）的 multi-audience 行為 OIDC 未定義，array-includes
  // 無法證明其他 audience 受信任 → 只收 LINE 明文承諾的 String 契約，array 一律拒。
  // expectedAud 空值分支 = UNREACHABLE_BY_CURRENT_CALL_GRAPH_DID：唯一 callsite 之前
  // 的 `if (!cfg.clientId) return htmlError(...)`（本檔 handle()）已收斂為非空字串。
  // 保留此分支是防禦未來移除該 guard 或新增第 2 個 caller；新增 caller 必須重判可達性。
  if (typeof expectedAud !== 'string' || expectedAud.length === 0) throw new Error('id_token audience mismatch')
  if (typeof payload.aud !== 'string' || payload.aud !== expectedAud) throw new Error('id_token audience mismatch')

  // exp：強制存在（缺 exp 的 token 等於永不過期）。!Number.isFinite 擋 `1e999` → Infinity，
  // 該值 typeof 為 number 但 now >= Infinity 恆 false，會使 token 永久有效。leeway 0，
  // now === exp 亦視為過期。
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || now >= payload.exp) throw new Error('id_token expired')

  // nonce：擋 id_token replay。stored nonce 為 NULL/空 → fail-closed（舊策略放行 legacy
  // session，等同對「state 沒帶 nonce」的請求關閉 replay 校驗）。兩種失敗共用同一訊息，
  // client 無法區分 state 損壞 vs claim 不符。
  if (typeof expectedNonce !== 'string' || expectedNonce.length === 0) throw new Error('id_token nonce mismatch')
  if (typeof payload.nonce !== 'string' || payload.nonce.length === 0 || payload.nonce !== expectedNonce) throw new Error('id_token nonce mismatch')

  return payload
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]))
}

function htmlError(message: string, status = 400) {
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
