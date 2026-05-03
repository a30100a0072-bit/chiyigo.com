/**
 * POST /api/auth/logout
 * Body: { refresh_token }
 *
 * 撤銷指定 refresh_token，實現伺服器端登出。
 * 不需要 Authorization header — 讓 access_token 過期的用戶也能登出。
 *
 * 設計原則：
 *  - 冪等：token 已撤銷或不存在時同樣回傳 200，不洩漏 token 是否有效
 *  - 不驗 access_token：防止 token 過期後用戶無法登出
 *
 * 回傳：
 *  200 → { message: 'Logged out' }
 *  400 → refresh_token 缺失
 */

import { hashToken } from '../../utils/crypto.js'
import { getCorsHeaders } from '../../utils/cors.js'
import { CLEAR_REFRESH_COOKIE } from '../../utils/cookies.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPost({ request, env }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  // Cookie 優先（Web），其次 JSON body（App）
  const cookieToken = parseCookieHeader(request.headers.get('Cookie'), 'chiyigo_refresh')

  let bodyToken
  try {
    const body = await request.json()
    bodyToken  = body?.refresh_token
  } catch { /* body 為空時忽略 */ }

  const refresh_token = cookieToken ?? bodyToken

  // 無 token：仍清除 Cookie（冪等），不視為錯誤
  const clearCookieHeader = { 'Set-Cookie': CLEAR_REFRESH_COOKIE }
  if (!refresh_token) {
    return new Response(JSON.stringify({ message: 'Logged out' }), {
      headers: { 'Content-Type': 'application/json', ...clearCookieHeader, ...cors },
    })
  }

  const db = env.chiyigo_db
  const tokenHash = await hashToken(refresh_token)

  // 只撤銷尚未撤銷的 token；不存在或已撤銷均靜默成功（冪等）
  await db
    .prepare(`
      UPDATE refresh_tokens
      SET revoked_at = datetime('now')
      WHERE token_hash = ? AND revoked_at IS NULL
    `)
    .bind(tokenHash)
    .run()

  return new Response(JSON.stringify({ message: 'Logged out' }), {
    headers: { 'Content-Type': 'application/json', ...clearCookieHeader },
  })
}

function parseCookieHeader(header, name) {
  if (!header) return null
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return match ? match[1] : null
}
