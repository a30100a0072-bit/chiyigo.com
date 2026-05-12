/**
 * POST /api/auth/refresh
 * Body: { refresh_token, device_uuid? }
 *
 * 以有效的 refresh_token 換取新的 access_token，並輪換 refresh_token。
 *
 * 輪換策略（Refresh Token Rotation）：
 *  - 舊 token 立即標記為 revoked（revoked_at），不可再次使用
 *  - 同時簽發新 refresh_token（TTL 重置），返回給客戶端
 *  - 若舊 token 已被 revoked → 可能為重放攻擊，回傳 401
 *
 * device_uuid 驗證（Phase D1）：
 *  - 優先讀 `X-Device-Id` header；回退到 body.device_uuid（保留舊 client 相容）
 *  - DB 中該 token 綁定了 device_uuid → 請求中的值必須完全相符
 *  - 不符 = 高度可疑（token 被搬到別台機器）→ 撤銷該 device 在該 user 下的整個
 *    refresh_tokens 家族 + 寫 critical audit（會觸發 Discord webhook）
 *  - Web 端（device_uuid=null）的 token 不做裝置驗證
 *
 * 回傳：
 *  200 → { access_token, refresh_token }
 *  401 → token 無效 / 已過期 / 已撤銷 / device_uuid 不符
 *  403 → 帳號已封禁
 */

import { generateSecureToken, hashToken } from '../../utils/crypto.js'
import { signJwt } from '../../utils/jwt.js'
import { getCorsHeaders, resolveAud } from '../../utils/cors.js'
import { res } from '../../utils/auth.js'
import { refreshCookie } from '../../utils/cookies.js'
import { safeUserAudit } from '../../utils/user-audit.js'
import { buildTokenScope } from '../../utils/scopes.js'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit.js'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  // Cookie 優先（Web），其次 JSON body（App）
  const cookieToken = parseCookieHeader(request.headers.get('Cookie'), 'chiyigo_refresh')

  let body
  try { body = await request.json() }
  catch { body = {} }

  const { aud } = body ?? {}
  // Phase D1：header 優先，body 保留向後相容（舊 App build 還在送 body.device_uuid）
  const headerDeviceId  = request.headers.get('X-Device-Id') ?? request.headers.get('x-device-id')
  const device_uuid     = (headerDeviceId && headerDeviceId.trim()) || body?.device_uuid || null
  const refresh_token   = cookieToken ?? body?.refresh_token
  const isWeb           = !!cookieToken
  // Codex r2-5 / r9-5：body.aud 不再直接決定簽發 audience；下方讀 tokenRow.issued_aud。
  // Codex r9-5.1：只有 client 真的有送 raw aud 才解析 — resolveAud(undefined) 會折成 'chiyigo'，
  // 對 sport-app/mbti/talo 用戶（issued_aud 非 chiyigo）會誤報 mismatch。
  const rawAudProvided  = typeof aud === 'string' && aud.trim() !== ''
  const requestedAud    = rawAudProvided ? resolveAud(aud) : null

  if (!refresh_token || typeof refresh_token !== 'string')
    return res({ error: 'refresh_token is required', code: 'REFRESH_TOKEN_REQUIRED' }, 400, cors)

  const db = env.chiyigo_db

  // ── 1. 查找 token（含過期與撤銷過濾）────────────────────────
  const tokenHash = await hashToken(refresh_token)
  const tokenRow  = await db
    .prepare(`
      SELECT id, user_id, device_uuid, revoked_at, auth_time, scope, issued_aud
      FROM refresh_tokens
      WHERE token_hash = ? AND expires_at > datetime('now')
    `)
    .bind(tokenHash)
    .first()

  if (!tokenRow) {
    await safeUserAudit(env, { event_type: 'auth.refresh.fail', severity: 'warn', request, data: { reason_code: 'invalid_or_expired' } })
    return res({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' }, 401, cors)
  }

  if (tokenRow.revoked_at) {
    // 已撤銷 token 重放 = 高度可疑（refresh rotation 設計下偷 token 必中此分支）
    await safeUserAudit(env, { event_type: 'auth.refresh.fail', severity: 'warn', user_id: tokenRow.user_id, request, data: { reason_code: 'reuse_detected' } })
    return res({ error: 'Refresh token has been revoked', code: 'REFRESH_TOKEN_REVOKED' }, 401, cors)
  }

  // ── 1.5 Rate limit（Phase E3）─ 30/user/min；spec 寫 per-token，per-user 涵蓋更廣（持多 token 不能繞）
  const ip = request.headers.get('CF-Connecting-IP') ?? null
  const { blocked: rlBlocked } = await checkRateLimit(db, {
    kind: 'refresh', userId: tokenRow.user_id, windowSeconds: 60, max: 30,
  })
  if (rlBlocked) {
    await safeUserAudit(env, {
      event_type: 'auth.refresh.rate_limited', severity: 'warn',
      user_id: tokenRow.user_id, request,
    })
    return res({ error: 'Too many refresh attempts. Please slow down.', code: 'RATE_LIMITED' }, 429, cors)
  }
  // 記錄本次 call（無論成功/失敗皆記入計數）
  await recordRateLimit(db, { kind: 'refresh', userId: tokenRow.user_id, ip })

  // ── 2. device_uuid 驗證（Phase D1 強綁）─────────────────────
  if (tokenRow.device_uuid !== null && tokenRow.device_uuid !== '') {
    if (tokenRow.device_uuid !== (device_uuid ?? '')) {
      // Token 被搬到不同裝置：撤銷整個 (user, device) 家族，避免攻擊者用同 chain 其他 token 續命
      await db
        .prepare(`
          UPDATE refresh_tokens
             SET revoked_at = datetime('now')
           WHERE user_id = ? AND device_uuid = ? AND revoked_at IS NULL
        `)
        .bind(tokenRow.user_id, tokenRow.device_uuid)
        .run()
      await safeUserAudit(env, {
        event_type: 'auth.refresh.device_mismatch',
        severity:   'critical',
        user_id:    tokenRow.user_id,
        request,
        data: {
          reason_code:    'device_mismatch',
          bound_device:   tokenRow.device_uuid.slice(0, 8),
          claimed_device: (device_uuid ?? '').slice(0, 8),
        },
      })
      return res({ error: 'Device mismatch', code: 'DEVICE_MISMATCH' }, 401, cors)
    }
  }

  // ── 3. 取得用戶最新狀態 ──────────────────────────────────────
  const user = await db
    .prepare(`
      SELECT id, email, email_verified, role, status, token_version
      FROM users
      WHERE id = ? AND deleted_at IS NULL
    `)
    .bind(tokenRow.user_id)
    .first()

  if (!user) return res({ error: 'User not found', code: 'USER_NOT_FOUND' }, 401, cors)
  if (user.status === 'banned') return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403, cors)

  // ── 4. Refresh Token Rotation（原子輪換）─────────────────────
  const newPlainToken    = generateSecureToken()
  const newTokenHash     = await hashToken(newPlainToken)
  const newExpiresAt     = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  // Rotation 保留原本的 auth_time（silent refresh 不算重新互動式認證，
  // OIDC max_age 才有意義）。舊 row 沒 auth_time 時用 NOW 當保守 fallback。
  const preservedAuthTime = tokenRow.auth_time ?? new Date().toISOString().replace('T', ' ').slice(0, 19)
  // Codex #2（2026-05-10）：原 SELECT→batch UPDATE/INSERT 有 race 窗 — 兩個並發 refresh 都
  // 通過 SELECT 的 revoked_at IS NULL 檢查 → 雙方各拿到一條新 refresh chain。改用 atomic
  // UPDATE...WHERE revoked_at IS NULL RETURNING：D1/SQLite 對 token_hash UNIQUE 列做 row-level
  // 序列化，只會有一方 RETURNING 出 row；輸的一方視同 reuse_detected。
  const revokedRow = await db
    .prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now')
                WHERE id = ? AND revoked_at IS NULL
                RETURNING id`)
    .bind(tokenRow.id)
    .first()
  if (!revokedRow) {
    await safeUserAudit(env, {
      event_type: 'auth.refresh.fail', severity: 'warn',
      user_id: tokenRow.user_id, request,
      data: { reason_code: 'reuse_race_lost' },
    })
    return res({ error: 'Refresh token has been revoked', code: 'REFRESH_TOKEN_REVOKED' }, 401, cors)
  }
  // Codex r9-5：簽 audience 改用 tokenRow.issued_aud（綁定發行時 aud）。
  // 舊 row 沒 issued_aud（NULL）→ 退回 requestedAud 保 backward compat。F-1 已批次 revoke
  // NULL 舊 row（2026-05-10），仍保留 fallback 鏈以防未來邊界情境。
  // F-2：mismatch 條件收緊 — 只有 client 明確送了 raw aud 且 ≠ issued_aud 時才 audit；
  // 升 critical（攻擊者主動嘗試切換 audience 的訊號，非 client 缺送的噪音）。
  const effectiveAud = tokenRow.issued_aud || requestedAud || 'chiyigo'
  if (tokenRow.issued_aud && rawAudProvided && requestedAud !== tokenRow.issued_aud) {
    await safeUserAudit(env, {
      event_type: 'auth.refresh.aud_mismatch', severity: 'critical',
      user_id: tokenRow.user_id, request,
      data: {
        issued_aud:    tokenRow.issued_aud,
        requested_aud: requestedAud,
        reason_code:   'body_aud_overridden_by_issued',
      },
    })
  }
  // P1-5：把 OIDC scope 透傳到 rotation 後的新 row，避免遺失
  // Codex r9-5：issued_aud 也透傳，rotation 後新 row 仍綁定原 aud
  await db
    .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time, scope, issued_aud)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(user.id, newTokenHash, tokenRow.device_uuid, newExpiresAt, preservedAuthTime, tokenRow.scope ?? null, effectiveAud)
    .run()

  // ── 5. 簽發新 Access Token ───────────────────────────────────
  const accessToken = await signJwt({
    sub:            String(user.id),
    email:          user.email,
    email_verified: user.email_verified === 1,
    role:           user.role,
    status:         user.status,
    ver:            user.token_version ?? 0,
    // P1-5：buildTokenScope 帶第二參，保留原本 OIDC scope（openid/email/...）
    scope:          buildTokenScope(user.role, tokenRow.scope ?? ''),
  }, ACCESS_TOKEN_TTL, env, { audience: effectiveAud })

  // Web → 新 Cookie；App → JSON body
  if (isWeb) {
    return new Response(JSON.stringify({ access_token: accessToken }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': refreshCookie(newPlainToken, REFRESH_TOKEN_DAYS * 86400),
        ...cors,
      },
    })
  }

  return res({
    access_token:  accessToken,
    refresh_token: newPlainToken,
  }, 200, cors)
}

function parseCookieHeader(header, name) {
  if (!header) return null
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? match[1] : null
}


