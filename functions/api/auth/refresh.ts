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

import { generateSecureToken, hashToken } from '../../utils/crypto'
import { signJwt } from '../../utils/jwt'
import { resolveActiveTenantClaims } from '../../utils/tenant-context'
import { getCorsHeaders, resolveAud } from '../../utils/cors'
import { res } from '../../utils/auth'
import { refreshCookie } from '../../utils/cookies'
import { safeUserAudit } from '../../utils/user-audit'
import { buildTokenScope } from '../../utils/scopes'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'

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
  let jsonParseOk = true
  try { body = await request.json() }
  catch { body = {}; jsonParseOk = false }

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

  // chiyigo.com 主站 anonymous silent probe：cold visit / incognito / 多分頁進站，
  // sidebar-auth.ts 會以 body:'{}' 試 refresh。原本 400 會在 Console 噪音化 — 回 204 消噪。
  // 收窄到「主站 origin + 完全空 body」單一場景，避免靜默吞掉 App / OAuth client / malformed 的真正錯誤。
  const origin = request.headers.get('Origin') ?? ''
  const isChiyigoMainOrigin =
    origin === 'https://chiyigo.com'
    || (env.ENVIRONMENT === 'development'
        && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))

  const isWebProbe =
    isChiyigoMainOrigin
    && !cookieToken
    && jsonParseOk
    && body !== null
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).length === 0

  if (isWebProbe) {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Cache-Control': 'no-store' },
    })
  }

  if (!refresh_token || typeof refresh_token !== 'string')
    return res({ error: 'refresh_token is required', code: 'REFRESH_TOKEN_REQUIRED' }, 400, cors)

  const db = env.chiyigo_db

  // ── 1. 查找 token（含過期與撤銷過濾）────────────────────────
  const tokenHash = await hashToken(refresh_token)
  const tokenRow  = await db
    .prepare(`
      SELECT id, user_id, device_uuid, revoked_at, auth_time, scope, issued_aud, session_id
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

  // ── 4. Refresh Token Rotation（單一 atomic db.batch；PR5 5d-2 §1.5）─────────────────
  const newPlainToken    = generateSecureToken()
  const newTokenHash     = await hashToken(newPlainToken)
  const newExpiresAt     = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)
  // Rotation 保留原本的 auth_time（silent refresh 不算重新互動式認證，OIDC max_age 才有意義）；
  // 舊 row 沒 auth_time 時用 NOW 當保守 fallback。
  const preservedAuthTime = tokenRow.auth_time ?? new Date().toISOString().replace('T', ' ').slice(0, 19)
  // Codex r9-5：簽 audience 用 tokenRow.issued_aud（綁定發行時 aud）；舊 row NULL → 退回 requestedAud 保相容。
  const effectiveAud = tokenRow.issued_aud || requestedAud || 'chiyigo'
  // PR5 5d-1b：PRESERVE per-login session_id across rotation（同 auth_time/scope/issued_aud）；legacy/deploy-gap
  // 的 NULL session_id 在此 HEAL 成 fresh uuid，使每個 rotated row 都帶 non-null id。
  const preservedSessionId = tokenRow.session_id ?? crypto.randomUUID()

  // PR5 5d-2 §1.5：rotation 必須是「單一 atomic db.batch」。舊版「UPDATE old (revoke) → 另一句 INSERT new」是兩個
  // 分離寫入，中間存在 0-LIVE-HEAD window：並發的 session.revoked 撤銷（casByFamily）若落在窗內，會找不到 live
  // head → 不 emit，而 rotation 隨後插入的新 head 卻存活（漏撤 + event ⊥ auth DB）。改成一個 batch 後，並發讀者只
  // 會見到「舊 head」(batch 前) 或「新 head」(batch 後)、永不見 0 live head。
  //   S1 = UPDATE old SET revoked_at WHERE id=? AND revoked_at IS NULL —— `revoked_at IS NULL` 仍對並發 refresh 做
  //        row-level 序列化（只有一方 changes()=1，輸的一方 changes()=0 視為 reuse；保留 Codex #2 的防護）。
  //   S2 = INSERT new ... SELECT ... WHERE changes()=1 —— 只在 S1 真的撤了舊 head 時才插新 head（both-or-neither）。
  const rot = await db.batch([
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`)
      .bind(tokenRow.id),
    db.prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time, scope, issued_aud, session_id)
                SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`)
      .bind(user.id, newTokenHash, tokenRow.device_uuid, newExpiresAt, preservedAuthTime, tokenRow.scope ?? null, effectiveAud, preservedSessionId),
  ])
  // reuse 偵測：S1 的 changes()≠1 → 舊 head 早被撤（replay，或並發 refresh / logout 贏了 race）→ gated INSERT 沒插
  // 任何新 head（changes()=1 為偽）→ 401。
  if (rot[0].meta.changes !== 1) {
    await safeUserAudit(env, {
      event_type: 'auth.refresh.fail', severity: 'warn',
      user_id: tokenRow.user_id, request,
      data: { reason_code: 'reuse_race_lost' },
    })
    return res({ error: 'Refresh token has been revoked', code: 'REFRESH_TOKEN_REVOKED' }, 401, cors)
  }
  // Codex c2 code-gate：也必須驗 S2（gated INSERT）的 row-count。S1 changes()=1 ⇒ S2 也應=1（spike 已證 changes()
  // 鏈），但若 SQL / D1 semantic drift / 未來 refactor 讓 S1 撤了舊 head 卻沒插新 head（rot[1]≠1）→ FAIL CLOSED：
  // 絕不為一個 DB 不存在的 session row 簽發/回傳新 token（否則使用者拿到孤兒 refresh token、下次 refresh 必失敗）。
  // 舊 token 已在 S1 撤銷，故回 5xx 讓使用者重新登入 + critical audit 告警。
  if (rot[1].meta.changes !== 1) {
    await safeUserAudit(env, {
      event_type: 'auth.refresh.fail', severity: 'critical',
      user_id: tokenRow.user_id, request,
      data: { reason_code: 'rotation_insert_missing' },
    })
    return res({ error: 'Rotation failed', code: 'ROTATION_FAILED' }, 500, cors)
  }
  // F-2 audience mismatch audit（post-batch、best-effort；只有 client 明確送 raw aud 且 ≠ issued_aud 才記，升
  // critical = 攻擊者主動切換 audience 的訊號，非 client 缺送的噪音）。
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

  // ── 5. 簽發新 Access Token ───────────────────────────────────
  const tenantClaims = await resolveActiveTenantClaims(env.chiyigo_db, Number(user.id))
  const accessToken = await signJwt({
    ...tenantClaims,
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


