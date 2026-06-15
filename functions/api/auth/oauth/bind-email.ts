/**
 * POST /api/auth/oauth/bind-email
 *
 * 供無信箱 OAuth 用戶（如 Discord 未公開 email）補填信箱。
 *
 * Body: { token: <temp_bind_token>, email: string }
 *
 * 流程：
 *  1. 驗證 temp_bind_token（scope='temp_bind'）
 *  2. 檢查 user_identities 是否已綁定（防重放）
 *  3. 信箱碰撞處理（同 callback.js 邏輯）
 *  4. 建立 user + identity（或靜默綁定）
 *  5. 簽發 Access Token + Refresh Token（HttpOnly Cookie）
 */

import { verifyJwt, signJwt } from '../../../utils/jwt'
import { resolveActiveTenantClaims } from '../../../utils/tenant-context'
import { generateSecureToken, hashToken } from '../../../utils/crypto'
import { getProvider } from '../../../utils/oauth-providers'
import { resolveAud } from '../../../utils/cors'
import { res } from '../../../utils/auth'
import { refreshCookie, readOAuthDeviceCookie, CLEAR_OAUTH_DEVICE_COOKIE } from '../../../utils/cookies'
import { safeUserAudit, hashIdentifierForAudit } from '../../../utils/user-audit'
import { buildTokenScope } from '../../../utils/scopes'
import { consumeJtiOnce } from '../../../utils/revocation'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7

export async function onRequestPost(context) {
  const { request, env } = context

  let body
  try {
    body = await request.json()
  } catch {
    return res({ error: '無效的請求格式', code: 'INVALID_REQUEST_FORMAT' }, 400)
  }

  const { token, email, aud } = body ?? {}
  const audience = resolveAud(aud)

  if (!token || !email) return res({ error: '缺少必要欄位', code: 'MISSING_REQUIRED_FIELD' }, 400)

  const emailLower = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower))
    return res({ error: '信箱格式無效', code: 'INVALID_EMAIL_FORMAT' }, 400)

  // ── 1. 驗證 temp_bind_token ────────────────────────────────────
  let payload
  try {
    payload = await verifyJwt(token, env)
  } catch {
    return res({ error: '連結無效或已過期，請重新登入', code: 'LINK_INVALID_OR_EXPIRED' }, 401)
  }

  if (payload.scope !== 'temp_bind')
    return res({ error: '連結類型錯誤', code: 'LINK_TYPE_INVALID' }, 401)

  const { sub: provider_id, provider: providerRaw, name, avatar } = payload
  if (!provider_id || typeof providerRaw !== 'string')
    return res({ error: 'Token 資料不完整', code: 'TOKEN_DATA_INCOMPLETE' }, 401)

  // F6 canonicalize：JWT 內 provider 字串可能來自未來新增的簽發路徑，未做 .toLowerCase()
  // 會以 `Google`/`GOOGLE` 過 case-insensitive allowlist 但污染 user_identities.provider，
  // 破壞 (provider, provider_id) invariant；DB/audit/response/token 一律走小寫 key。
  const provider = providerRaw.toLowerCase()

  // Defense-in-depth：temp_bind token 由 callback 簽出已過 allowlist，這裡再驗
  // 一次避免 callback 未來新增路徑漏校；getProvider null = 不在 PROVIDERS map
  if (!getProvider(provider, env)) {
    // F8 觀測性：unsupported provider 是 signer/config drift 訊號，必須留 audit
    await safeUserAudit(env, {
      event_type: 'oauth.bind_email.fail',
      severity:   'warn',
      request,
      data: { provider, reason_code: 'unsupported_provider' },
    })
    return res({ error: 'Unsupported OAuth provider', code: 'UNSUPPORTED_PROVIDER' }, 400)
  }

  // Replay 防禦（codex r5 H1）：temp_bind 是一次性 token，被截獲在 TTL 內可重複打
  // bind-email 鑄出多份 session。用 consumeJtiOnce atomic claim：第一個 caller 寫入
  // revoked_jti 才放行，後續同 jti 一律 401。signJwt 自動帶 jti（jwt.ts L124）。
  // exp 為 epoch 秒，缺值（不該發生）也 fail-closed。
  const tokenJti = typeof payload.jti === 'string' ? payload.jti : null
  if (!tokenJti) {
    await safeUserAudit(env, {
      event_type: 'oauth.bind_email.fail',
      severity:   'warn',
      request,
      data: { provider, reason_code: 'missing_jti' },
    })
    return res({ error: '連結無效或已過期，請重新登入', code: 'LINK_INVALID_OR_EXPIRED' }, 401)
  }
  // codex r6 optional hardening：consumeJtiOnce 對非 finite expSec 會 fallback 1hr TTL，
  // signer 改寫漏設 exp 時 revoked_jti row 仍會建但 TTL 被 caller 端決定，違反 token 自含
  // TTL 的安全模型。signJwt 一定 setExpirationTime（jwt.ts L130）所以 prod path 不可達。
  if (!Number.isFinite(payload.exp)) {
    await safeUserAudit(env, {
      event_type: 'oauth.bind_email.fail',
      severity:   'warn',
      request,
      data: { provider, reason_code: 'missing_exp' },
    })
    return res({ error: '連結無效或已過期，請重新登入', code: 'LINK_INVALID_OR_EXPIRED' }, 401)
  }

  // OD-3：flagged identity 使用前強制 re-verify。**read-only 預檢、在 consumeJtiOnce 之前** → flagged 不消費
  // temp_bind link（合法用戶 reverify 後可用同一連結重試）、不簽 token。new identity（無 row）為 flag=0、不受影響。
  const rvFlagRow = await env.chiyigo_db
    .prepare(`SELECT ui.user_id AS user_id, ui.requires_reverification AS rr FROM user_identities ui
              JOIN users u ON u.id = ui.user_id
              WHERE ui.provider = ? AND ui.provider_id = ? AND u.deleted_at IS NULL`)
    .bind(provider, provider_id).first()
  if (rvFlagRow?.rr) {
    const rvSig = await hashIdentifierForAudit(env, 'oauth-provider-id', String(provider_id))
    // bind affected user_id so this security signal is account-attributable (parity with the other 3 surfaces; Codex P2).
    await safeUserAudit(env, {
      event_type: 'auth.credential.reverification_required', severity: 'warn',
      user_id: Number(rvFlagRow.user_id), request,
      data: { method: `oauth_login:${provider}`, provider_id_hmac16: rvSig.hex.slice(0, 16), salted: rvSig.salted },
    })
    return res({ error: 'This identity requires re-verification before use', code: 'CREDENTIAL_REVERIFICATION_REQUIRED' }, 403)
  }

  const consume = await consumeJtiOnce(env, tokenJti, payload.exp)
  if (!consume.ok) {
    await safeUserAudit(env, {
      event_type: 'oauth.bind_email.fail',
      severity:   'warn',
      request,
      data: { provider, reason_code: 'link_already_used' },
    })
    return res({ error: '連結已使用，請重新登入', code: 'LINK_ALREADY_USED' }, 401)
  }

  const db  = env.chiyigo_db

  // ── 2. 防重放：identity 是否已在 DB 內 ────────────────────────
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
    // 已有綁定（可能是前次補填成功但 response 遺失），直接沿用
    userId = existingIdentity.user_id
  } else {
    // ── 3. 信箱碰撞 ───────────────────────────────────────────────
    const existingUser = await db
      .prepare(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL`)
      .bind(emailLower)
      .first()

    if (existingUser) {
      // P0-2：bind-email 階段的 email 是「使用者手動輸入」，未經第三方驗章；
      // 即使 provider trustEmail=true 也不能據此靜默接管既有帳號。
      // 一律拒絕，導引至「密碼登入後手動綁定」流程。
      await safeUserAudit(env, {
        event_type: 'oauth.bind_email.collision_blocked',
        severity: 'warn',
        user_id: existingUser.id,
        request,
        data: { provider, reason: 'unverified_typed_email' },
      })
      return res({
        error: `此信箱已被既有帳號使用。請改用既有方式登入，登入後可在帳號設定中綁定 ${provider} 帳號。`,
        code: 'EMAIL_USED_BIND_AFTER_LOGIN',
        provider,
      }, 409)

    } else {
      // ── 4. 全新用戶 → 建立 user + identity ──────────────────────
      await db.batch([
        db.prepare(`INSERT INTO users (email, email_verified) VALUES (?, 0)`)
          .bind(emailLower),
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

  // ── 5. 查詢 role / status ──────────────────────────────────────
  const userRow = await db
    .prepare('SELECT email, email_verified, role, status, token_version FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow) return res({ error: '帳號建立後無法查詢，請稍後重試', code: 'ACCOUNT_LOOKUP_FAILED_AFTER_CREATE' }, 500)
  if (userRow.status === 'banned') return res({ error: '此帳號已被停用', code: 'ACCOUNT_DISABLED' }, 403)

  // ── 6. 簽發 Access Token ───────────────────────────────────────
  // PR-0（sid claim）：per-login session_id 同寫 refresh row 與 access sid claim。
  const sessionId = crypto.randomUUID()
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
    sid:            sessionId,
  }, ACCESS_TOKEN_TTL, env, { audience })

  // ── 7. 建立 Refresh Token ──────────────────────────────────────
  const refreshToken     = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19)

  // Codex r5 M1：保留 callback path 的 browser-level device binding。client JS 在按
  // OAuth 按鈕前寫 chiyigo_oauth_device cookie；callback redirect→bind-email.html 沿用，
  // bind-email 完成後也要把 cookie 值寫進 refresh_tokens.device_uuid 不然「我的裝置」
  // 對「需補填 email」的 OAuth 帳號永遠看不到裝置標籤。沒 cookie → NULL（舊行為）。
  const webDeviceUuid = readOAuthDeviceCookie(request)

  // Codex r9-5：issued_aud 鎖定發行時的 audience
  // PR5 5d-1b: + a fresh per-login session_id (the session.revoked family id, preserved across rotation).
  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time, issued_aud, session_id)
    VALUES (?, ?, ?, ?, datetime('now'), ?, ?)
  `).bind(userId, refreshTokenHash, webDeviceUuid, refreshExpiresAt, audience, sessionId).run()

  await safeUserAudit(env, { event_type: 'oauth.bind_email.success', user_id: userId, request, data: { provider } })

  const headers = new Headers({ 'Content-Type': 'application/json' })
  headers.append('Set-Cookie', refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400))
  // device_uuid 已轉存到 refresh_tokens，cookie 任務完成（同 callback.js 收尾語意）
  headers.append('Set-Cookie', CLEAR_OAUTH_DEVICE_COOKIE)
  return new Response(JSON.stringify({ access_token: accessToken }), { status: 200, headers })
}


