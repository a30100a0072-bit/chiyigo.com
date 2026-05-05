/**
 * POST /api/auth/webauthn/register-verify
 * Header: Authorization: Bearer <access_token>
 * Body:   {
 *   response: <PublicKeyCredentialJSON from navigator.credentials.create()>,
 *   nickname?: string  (使用者命名："我的 iPhone")
 * }
 *
 * Phase D-2 — Passkey 註冊 ceremony 第二步。
 *
 * 流程：
 *   1. 解 clientDataJSON 拿 challenge → 從 webauthn_challenges 一次性消耗
 *      （ceremony 必須是 'register'，且必須是同一個 user）
 *   2. SimpleWebAuthn verifyRegistrationResponse → 驗 attestation + origin + RP ID
 *   3. INSERT credential（credential_id 撞 UNIQUE = 已綁過 → 409）
 *   4. audit
 *
 * 回傳：
 *   200 → { id, nickname, created_at, transports }
 *   400 → response 結構錯 / challenge 過期或被消耗
 *   401 → access_token 無效
 *   409 → 此 credential 已被任一 user 綁定
 *   500 → SimpleWebAuthn verify 拋例外
 */

import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { requireAuth, res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { getRpConfig, consumeChallenge } from '../../../utils/webauthn.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400, cors) }

  const credResponse = body?.response
  const nickname     = typeof body?.nickname === 'string' ? body.nickname.slice(0, 64) : null
  if (!credResponse?.response?.clientDataJSON) {
    return res({ error: 'response is required' }, 400, cors)
  }

  // 1. 從 clientDataJSON 抽 challenge → 一次性消耗
  const challenge = extractChallenge(credResponse.response.clientDataJSON)
  if (!challenge) return res({ error: 'Invalid clientDataJSON' }, 400, cors)
  const challengeRow = await consumeChallenge(env, { challenge, ceremony: 'register' })
  if (!challengeRow) {
    await safeUserAudit(env, {
      event_type: 'webauthn.register.fail', severity: 'warn',
      user_id: userId, request, data: { reason_code: 'challenge_invalid' },
    })
    return res({ error: 'Challenge invalid or expired' }, 400, cors)
  }
  if (challengeRow.user_id !== userId) {
    await safeUserAudit(env, {
      event_type: 'webauthn.register.fail', severity: 'critical',
      user_id: userId, request, data: { reason_code: 'challenge_user_mismatch' },
    })
    return res({ error: 'Challenge mismatch' }, 400, cors)
  }

  // 2. SimpleWebAuthn 驗 attestation
  const { rpID, expectedOrigin } = getRpConfig(env)
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response:          credResponse,
      expectedChallenge: challenge,
      expectedOrigin,
      expectedRPID:      rpID,
      requireUserVerification: false,   // residentKey=preferred 而非 required，UV 也只是 preferred
    })
  } catch (e) {
    await safeUserAudit(env, {
      event_type: 'webauthn.register.fail', severity: 'warn',
      user_id: userId, request, data: { reason_code: 'verify_threw', message: String(e?.message ?? e).slice(0, 120) },
    })
    return res({ error: 'Verification failed' }, 400, cors)
  }

  if (!verification.verified || !verification.registrationInfo) {
    await safeUserAudit(env, {
      event_type: 'webauthn.register.fail', severity: 'warn',
      user_id: userId, request, data: { reason_code: 'not_verified' },
    })
    return res({ error: 'Verification failed' }, 400, cors)
  }

  // 3. 取出 credential 資料 → INSERT
  // SimpleWebAuthn v13 把欄位塞在 registrationInfo.credential
  const info = verification.registrationInfo
  const credData = info.credential ?? {}
  const credentialID    = credData.id            // base64url string
  const publicKeyBytes  = credData.publicKey     // Uint8Array
  const counter         = credData.counter ?? 0
  const transports      = credData.transports
  const aaguid          = info.aaguid ?? null
  const backupEligible  = info.credentialBackedUp != null ? (info.credentialBackedUp ? 1 : 0) : 0
  const backupState     = info.credentialDeviceType === 'multiDevice' ? 1 : 0

  if (!credentialID || !publicKeyBytes) {
    return res({ error: 'Verification produced incomplete credential' }, 500, cors)
  }

  const publicKeyB64 = bytesToBase64url(publicKeyBytes)

  try {
    const ins = await env.chiyigo_db
      .prepare(
        `INSERT INTO user_webauthn_credentials
           (user_id, credential_id, public_key, counter, transports, aaguid,
            nickname, backup_eligible, backup_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        userId, credentialID, publicKeyB64, counter,
        transports ? JSON.stringify(transports) : null,
        aaguid, nickname, backupEligible, backupState,
      )
      .run()

    await safeUserAudit(env, {
      event_type: 'webauthn.register.success',
      severity:   'info',
      user_id:    userId,
      request,
      data: {
        credential_id_prefix: credentialID.slice(0, 12),
        aaguid,
        backup_eligible: !!backupEligible,
      },
    })

    return res({
      id:         ins.meta.last_row_id,
      nickname,
      transports,
      created_at: new Date().toISOString(),
    }, 200, cors)
  } catch (e) {
    if (String(e?.message ?? e).includes('UNIQUE')) {
      await safeUserAudit(env, {
        event_type: 'webauthn.register.fail', severity: 'warn',
        user_id: userId, request, data: { reason_code: 'duplicate_credential' },
      })
      return res({ error: 'Credential already registered' }, 409, cors)
    }
    throw e
  }
}

/**
 * 從 base64url(clientDataJSON) 抽 challenge field。
 * SimpleWebAuthn 也可以接 expectedChallenge async function 但這裡需要先做查表
 * 來確認 ceremony / user_id，所以自行 decode 一次。
 */
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

function bytesToBase64url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
