/**
 * POST /api/auth/webauthn/login-verify
 * Body: {
 *   response:     <PublicKeyCredentialJSON from navigator.credentials.get()>,
 *   device_uuid?: string,    (App 端綁裝置)
 *   platform?:    'web' | 'app' | ...,
 *   aud?:         RP audience（OIDC client_id 或快取索引值）
 * }
 *
 * Phase D-2 Wave B — Passkey 登入 ceremony 第二步。
 *
 * 流程：
 *   1. decode clientDataJSON 抽 challenge → 一次性消耗 (ceremony=login)
 *   2. 用 response.id（base64url）查 user_webauthn_credentials
 *   3. SimpleWebAuthn verifyAuthenticationResponse（含 origin / RP ID / sign counter）
 *   4. UPDATE counter + last_used_at（防 cloning）
 *   5. 鏡射 local/login.js 的 token flow：簽 access + refresh，refresh row
 *      綁 device_uuid + auth_time=NOW
 *   6. audit `auth.login.success`，data 標 method=webauthn + amr
 *
 * 反帳號枚舉：
 *   challenge 不存在 / credential 找不到 / verify 失敗 → 一律 401 同訊息。
 *
 * Web 偵測：與 login.js 一致 — `!device_uuid && (!platform || platform==='web')`
 *           → 用 chiyigo_refresh cookie；否則 JSON body 回 refresh_token。
 *
 * 回傳：
 *   200 → { access_token, user_id, email, role, status, [refresh_token] }
 *   400 → response 結構錯
 *   401 → 任何驗證失敗（同一 message 不洩漏分支）
 *   403 → 帳號封禁
 */

import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { signJwt } from '../../../utils/jwt.js'
import { getCorsHeaders, resolveAud } from '../../../utils/cors.js'
import { res } from '../../../utils/auth.js'
import { refreshCookie } from '../../../utils/cookies.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import { buildTokenScope } from '../../../utils/scopes.js'
import { getRpConfig, consumeChallenge } from '../../../utils/webauthn.js'
import { safeAlertAnomalies } from '../../../utils/device-alerts.js'
import { computeRiskScore, shouldDenyByRisk, isRiskMedium } from '../../../utils/risk-score.js'
import { sendRiskBlockedAlertEmail } from '../../../utils/email.js'

const ACCESS_TOKEN_TTL   = '15m'
const REFRESH_TOKEN_DAYS = 7

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400, cors) }

  const credResponse = body?.response
  const { device_uuid, platform, aud } = body ?? {}
  const audience = resolveAud(aud)

  if (!credResponse?.id || !credResponse?.response?.clientDataJSON || !credResponse?.response?.authenticatorData) {
    return res({ error: 'response is required' }, 400, cors)
  }

  const credentialId = credResponse.id

  // 1. challenge 一次性消耗
  const challenge = extractChallenge(credResponse.response.clientDataJSON)
  if (!challenge) return res({ error: 'Invalid clientDataJSON' }, 400, cors)
  const challengeRow = await consumeChallenge(env, { challenge, ceremony: 'login' })
  if (!challengeRow) {
    await safeUserAudit(env, {
      event_type: 'auth.login.fail', severity: 'warn',
      request, data: { reason_code: 'webauthn_challenge_invalid' },
    })
    return res({ error: 'Invalid credentials' }, 401, cors)
  }

  // 2. 找 credential（同步取 user 與 status）
  const cred = await env.chiyigo_db
    .prepare(`
      SELECT c.id            AS cred_pk,
             c.user_id       AS user_id,
             c.public_key    AS public_key,
             c.counter       AS counter,
             c.transports    AS transports,
             u.email         AS email,
             u.email_verified AS email_verified,
             u.role          AS role,
             u.status        AS status,
             u.token_version AS token_version,
             u.deleted_at    AS deleted_at
        FROM user_webauthn_credentials c
        JOIN users u ON u.id = c.user_id
       WHERE c.credential_id = ?
    `)
    .bind(credentialId)
    .first()

  if (!cred || cred.deleted_at) {
    await safeUserAudit(env, {
      event_type: 'auth.login.fail', severity: 'warn',
      request, data: { reason_code: 'webauthn_unknown_credential' },
    })
    return res({ error: 'Invalid credentials' }, 401, cors)
  }

  // 若 challenge 帶 user_id（前端有給 email）→ 比對；不符 = 用別人 challenge 拿自己 cred 換 token，記 critical
  if (challengeRow.user_id != null && challengeRow.user_id !== cred.user_id) {
    await safeUserAudit(env, {
      event_type: 'auth.login.fail', severity: 'critical',
      user_id: cred.user_id, request,
      data: { reason_code: 'webauthn_challenge_user_mismatch' },
    })
    return res({ error: 'Invalid credentials' }, 401, cors)
  }

  // 3. SimpleWebAuthn 驗 assertion
  const { rpID, expectedOrigin } = getRpConfig(env)
  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response:          credResponse,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID:      rpID,
      requireUserVerification: false,
      credential: {
        id:         credentialId,
        publicKey:  base64urlToBytes(cred.public_key),
        counter:    cred.counter ?? 0,
        transports: parseTransports(cred.transports),
      },
    })
  } catch (e) {
    await safeUserAudit(env, {
      event_type: 'auth.login.fail', severity: 'warn',
      user_id: cred.user_id, request,
      data: { reason_code: 'webauthn_verify_threw', message: String(e?.message ?? e).slice(0, 120) },
    })
    return res({ error: 'Invalid credentials' }, 401, cors)
  }

  if (!verification.verified || !verification.authenticationInfo) {
    await safeUserAudit(env, {
      event_type: 'auth.login.fail', severity: 'warn',
      user_id: cred.user_id, request, data: { reason_code: 'webauthn_not_verified' },
    })
    return res({ error: 'Invalid credentials' }, 401, cors)
  }

  // 4. 帳號封禁
  if (cred.status === 'banned') {
    await safeUserAudit(env, {
      event_type: 'auth.login.banned_attempt', severity: 'warn',
      user_id: cred.user_id, request,
    })
    return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403, cors)
  }

  // 4.5 Phase E-2 risk score（Passkey 分支）
  const risk = await computeRiskScore(env, request, { userId: cred.user_id, email: cred.email })
  if (shouldDenyByRisk(risk.score)) {
    await safeUserAudit(env, {
      event_type: 'auth.risk.blocked', severity: 'critical',
      user_id: cred.user_id, request,
      data: { score: risk.score, factors: risk.factors, country: risk.country, method: 'webauthn' },
    })
    if (env.RESEND_API_KEY && cred.email) {
      try {
        await sendRiskBlockedAlertEmail(env.RESEND_API_KEY, cred.email, {
          score: risk.score, factors: risk.factors, country: risk.country,
          when: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        }, env)
      } catch { /* swallow */ }
    }
    return res({
      error: 'High risk login blocked. Check your email for details.',
      code: 'RISK_BLOCKED',
    }, 403, cors)
  }
  if (isRiskMedium(risk.score)) {
    await safeUserAudit(env, {
      event_type: 'auth.risk.medium', severity: 'warn',
      user_id: cred.user_id, request,
      data: { score: risk.score, factors: risk.factors, country: risk.country, method: 'webauthn' },
    })
  }

  const newCounter = verification.authenticationInfo.newCounter ?? 0
  const userVerified = verification.authenticationInfo.userVerified === true

  // 5. UPDATE credential counter + last_used
  await env.chiyigo_db
    .prepare(
      `UPDATE user_webauthn_credentials
          SET counter = ?, last_used_at = datetime('now')
        WHERE id = ?`,
    )
    .bind(newCounter, cred.cred_pk)
    .run()

  // 6. 簽 access + refresh（鏡射 local/login.js）
  // amr：passkey 帶 UV 視為「擁有 + 知識」雙因子；無 UV 只算 'webauthn'
  const amr = userVerified ? ['webauthn', 'mfa'] : ['webauthn']

  const accessToken = await signJwt({
    sub:            String(cred.user_id),
    email:          cred.email,
    email_verified: cred.email_verified === 1,
    role:           cred.role,
    status:         cred.status,
    ver:            cred.token_version ?? 0,
    scope:          buildTokenScope(cred.role),
    amr,
  }, ACCESS_TOKEN_TTL, env, { audience })

  const refreshToken     = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await env.chiyigo_db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).bind(cred.user_id, refreshTokenHash, device_uuid ?? null, refreshExpiresAt).run()

  await safeUserAudit(env, {
    event_type: 'auth.login.success',
    user_id:    cred.user_id,
    request,
    data: {
      method: 'webauthn',
      amr,
      credential_id_prefix: credentialId.slice(0, 12),
      user_verified: userVerified,
      country: risk.country,
      ua_hash: risk.ua_hash,
      risk_score: risk.score,
      risk_factors: risk.factors,
    },
  })

  // Phase D-4：異常裝置警示
  await safeAlertAnomalies(env, request, {
    userId:     cred.user_id,
    email:      cred.email,
    deviceUuid: device_uuid ?? null,
  })

  const payload = {
    access_token:   accessToken,
    user_id:        cred.user_id,
    email:          cred.email,
    email_verified: cred.email_verified === 1,
    role:           cred.role,
    status:         cred.status,
  }

  const isWeb = !device_uuid && (!platform || platform === 'web')
  if (isWeb) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400),
        ...cors,
      },
    })
  }
  return res({ ...payload, refresh_token: refreshToken }, 200, cors)
}

function extractChallenge(clientDataB64Url) {
  try {
    const json = new TextDecoder().decode(base64urlToBytes(clientDataB64Url))
    const parsed = JSON.parse(json)
    return typeof parsed?.challenge === 'string' ? parsed.challenge : null
  } catch { return null }
}

function base64urlToBytes(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function parseTransports(raw) {
  if (!raw) return undefined
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : undefined
  } catch { return undefined }
}
