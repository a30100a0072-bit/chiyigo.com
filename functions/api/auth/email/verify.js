/**
 * GET /api/auth/email/verify?token=<hex>
 *
 * 回傳情境：
 *  200 → { message: 'Email verified successfully' }
 *  400 → { error: 'Token is invalid or has expired' }   (不存在 / 已用 / 過期)
 */

import { hashToken } from '../../../utils/crypto.js'

export async function onRequestGet({ request, env }) {
  const url   = new URL(request.url)
  const token = url.searchParams.get('token') ?? ''

  if (!token) return res({ error: 'Token is required' }, 400)

  const db        = env.chiyigo_db
  const tokenHash = await hashToken(token)

  // ── 原子核銷：UPDATE … RETURNING 防重放 ─────────────────────
  // 條件：token_hash 吻合 + token_type 正確 + 尚未使用 + 未過期
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

  if (!row) {
    return Response.redirect(new URL('/login.html?verify_error=1', request.url).href, 302)
  }

  // ── 更新 email_verified ──────────────────────────────────────
  await db
    .prepare('UPDATE users SET email_verified = 1 WHERE id = ?')
    .bind(row.user_id)
    .run()

  return Response.redirect(new URL('/login.html?verified=1', request.url).href, 302)
}
