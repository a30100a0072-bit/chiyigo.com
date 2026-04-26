/**
 * POST /api/auth/email/verify     Body: { token }
 * GET  /api/auth/email/verify?token=...   → 向後相容：redirect 到前端確認頁，不核銷
 *
 * 為避免郵件代理 / 瀏覽器預載提前消耗 token，token 核銷只走 POST。
 * 既有舊 link（GET）仍可運作：自動跳轉至 /verify-email.html，由前端按鈕 POST。
 */

import { hashToken } from '../../../utils/crypto.js'

export async function onRequestGet({ request }) {
  const url   = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''
  const target = new URL('/verify-email.html', url.origin)
  if (token) target.searchParams.set('token', token)
  return Response.redirect(target.href, 302)
}

export async function onRequestPost({ request, env }) {
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const token = body?.token ?? ''
  if (!token || typeof token !== 'string')
    return res({ error: 'Token is required' }, 400)

  const db        = env.chiyigo_db
  const tokenHash = await hashToken(token)

  // 原子核銷：UPDATE … RETURNING 防重放
  const row = await db
    .prepare(`
      UPDATE email_verifications
      SET    used_at = datetime('now')
      WHERE  token_hash = ?
        AND  token_type = 'verify_email'
        AND  used_at    IS NULL
        AND  expires_at > datetime('now')
      RETURNING user_id
    `)
    .bind(tokenHash)
    .first()

  if (!row) return res({ error: 'Token is invalid or has expired' }, 400)

  await db
    .prepare('UPDATE users SET email_verified = 1 WHERE id = ?')
    .bind(row.user_id)
    .run()

  return res({ message: 'Email verified successfully' })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
