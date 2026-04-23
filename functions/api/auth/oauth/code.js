/**
 * POST /api/auth/oauth/code
 * Header: Authorization: Bearer <access_token>
 * Body:   { pkce_key }
 *
 * 登入成功後由 login.html 呼叫。
 * 以 access_token 驗證用戶身份，查出對應的 pkce_session，
 * 生成一次性授權碼（auth code），回傳帶 code 的 redirect_url。
 * login.html 收到後直接跳轉，瀏覽器觸發 App 的 Custom URI Scheme / Loopback。
 *
 * 回傳：
 *  200 → { redirect_url }  — 如 chiyigo://auth/callback?code=...&state=...
 *  400 → pkce_key 缺失 / session 無效或過期
 *  401 → access_token 無效
 */

import { requireAuth }               from '../../../utils/auth.js'
import { generateSecureToken, hashToken } from '../../../utils/crypto.js'

const CODE_TTL_MS = 5 * 60 * 1000 // auth code 5 分鐘有效

export async function onRequestPost({ request, env }) {
  // 驗證登入狀態
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { pkce_key } = body ?? {}
  if (!pkce_key) return res({ error: 'pkce_key is required' }, 400)

  const db = env.chiyigo_db

  // 原子取出並刪除 pkce_session（防止重複使用）
  const session = await db
    .prepare(`
      DELETE FROM pkce_sessions
      WHERE session_key = ? AND expires_at > datetime('now')
      RETURNING state, code_challenge, redirect_uri
    `)
    .bind(pkce_key)
    .first()

  if (!session) return res({ error: 'Invalid or expired PKCE session' }, 400)

  // 生成一次性授權碼
  const code       = generateSecureToken()
  const codeHash   = await hashToken(code)
  const expiresAt  = new Date(Date.now() + CODE_TTL_MS)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db
    .prepare(`
      INSERT INTO auth_codes (code_hash, user_id, code_challenge, redirect_uri, state, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .bind(codeHash, Number(user.sub), session.code_challenge, session.redirect_uri, session.state, expiresAt)
    .run()

  // 組裝 redirect_url（支援 custom scheme、https、loopback）
  const sep         = session.redirect_uri.includes('?') ? '&' : '?'
  const redirectUrl = `${session.redirect_uri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(session.state)}`

  return res({ redirect_url: redirectUrl })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
