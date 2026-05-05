/**
 * POST /api/auth/webauthn/login-options
 * Body: { email?: string }
 *
 * Phase D-2 Wave B — Passkey 登入 ceremony 第一步。
 *
 * 兩種模式：
 *   1. 帶 email      → 找該 user 的 credentials 塞進 allowCredentials
 *      （讓瀏覽器只跳該 user 的 passkey）
 *   2. 不帶 email    → allowCredentials 留空 = usernameless / discoverable cred
 *      （走 client-side credential 列表 + resident key）
 *
 * 反帳號枚舉：
 *   email 不存在 / 無 credential → 仍回傳一份 options（allowCredentials 空），
 *   不要在 status / 結構上洩漏。challenge 仍存（user_id=NULL），verify 階段會
 *   因找不到 credential 而失敗。
 *
 * 回傳：200 → SimpleWebAuthn `PublicKeyCredentialRequestOptionsJSON` 結構
 */

import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { getRpConfig, saveChallenge, listUserCredentials } from '../../../utils/webauthn.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  let body
  try { body = await request.json() } catch { body = {} }
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : null

  const { rpID } = getRpConfig(env)

  let allowCredentials = []
  let userId = null
  if (email) {
    const userRow = await env.chiyigo_db
      .prepare(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL`)
      .bind(email).first()
    if (userRow) {
      userId = userRow.id
      allowCredentials = await listUserCredentials(env, userRow.id)
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    timeout:          60_000,
    userVerification: 'preferred',
    allowCredentials,  // 空陣列 = usernameless（discoverable cred）
  })

  await saveChallenge(env, {
    challenge: options.challenge,
    user_id:   userId,             // 不認得的 email → null（仍寫入避免 timing leak）
    ceremony:  'login',
  })

  return res(options, 200, cors)
}
