/**
 * POST /api/auth/webauthn/register-options
 * Header: Authorization: Bearer <access_token>
 * Body:   {} (optional override：authenticatorAttachment / residentKey)
 *
 * Phase D-2 — Passkey 註冊 ceremony 第一步。
 * 產 publicKeyCredentialCreationOptions（SimpleWebAuthn 的 JSON 變體）並寫
 * challenge 到 D1（5 分鐘 TTL）。前端拿這份丟 navigator.credentials.create()。
 *
 * 排除既有綁定的 credential，避免同 user 重複註冊同支 passkey。
 *
 * 回傳：200 → SimpleWebAuthn `PublicKeyCredentialCreationOptionsJSON` 結構
 *      401 → access_token 無效
 */

import { generateRegistrationOptions } from '@simplewebauthn/server'
import { requireAuth, res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { getRpConfig, saveChallenge, listUserCredentials } from '../../../utils/webauthn.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const { rpID, rpName } = getRpConfig(env)

  const existing = await listUserCredentials(env, userId)

  // userID 必須 BufferSource — lib v13 接受 Uint8Array；用 user.sub 字串編碼
  // （穩定 + user 改 email 不影響 credential 綁定）
  const userIDBytes = new TextEncoder().encode(String(userId))

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID:        userIDBytes,
    userName:      user.email ?? String(userId),
    userDisplayName: user.email ?? String(userId),
    timeout:       60_000,
    attestationType: 'none',                  // 不要 attestation，UX 較順 + 隱私
    excludeCredentials: existing,
    authenticatorSelection: {
      residentKey:        'preferred',         // 鼓勵 discoverable cred（usernameless 登入用）
      userVerification:   'preferred',
      // authenticatorAttachment 不指定 → 平台 + 跨平台 (USB key) 都接
    },
    supportedAlgorithmIDs: [-7, -257],         // ES256 + RS256（覆蓋 99% authenticator）
  })

  await saveChallenge(env, {
    challenge: options.challenge,
    user_id:   userId,
    ceremony:  'register',
  })

  await safeUserAudit(env, {
    event_type: 'webauthn.register.options',
    severity:   'info',
    user_id:    userId,
    request,
  })

  return res(options, 200, cors)
}
