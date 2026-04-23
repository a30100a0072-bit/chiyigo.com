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

export async function onRequestPost({ request, env }) {
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { refresh_token } = body ?? {}
  if (!refresh_token) return res({ error: 'refresh_token is required' }, 400)

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

  return res({ message: 'Logged out' })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
