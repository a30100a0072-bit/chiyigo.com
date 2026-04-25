// POST /api/auth/delete
// Step 1 of 2: verify password, send deletion-confirmation email.
// Step 2 is POST /api/auth/delete/confirm with the emailed token.

import { verifyPassword, generateSecureToken, hashToken } from '../../utils/crypto.js'
import { requireAuth, res } from '../../utils/auth.js'
import { sendDeleteConfirmationEmail } from '../../utils/email.js'

const COOLDOWN_SECONDS  = 60
const TOKEN_TTL_MINUTES = 15

export async function onRequestPost({ request, env }) {
  // ── 1. JWT 驗證 ───────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  // ── 2. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { password } = body ?? {}
  if (!password) return res({ error: 'password is required' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // ── 3. 驗證密碼 & 帳號狀態 ───────────────────────────────────
  const [account, userRow] = await Promise.all([
    db.prepare('SELECT password_hash, password_salt FROM local_accounts WHERE user_id = ?')
      .bind(userId).first(),
    db.prepare('SELECT email, deleted_at FROM users WHERE id = ?')
      .bind(userId).first(),
  ])

  if (!account || !userRow || userRow.deleted_at)
    return res({ error: 'Account not found' }, 404)

  const valid = await verifyPassword(password, account.password_salt, account.password_hash)
  if (!valid) return res({ error: 'Incorrect password' }, 401)

  // ── 4. 60 秒冷卻（防止重複請求發信）────────────────────────
  const recent = await db
    .prepare(`
      SELECT id FROM email_verifications
      WHERE user_id = ? AND token_type = 'delete_account'
        AND created_at > datetime('now', '-${COOLDOWN_SECONDS} seconds')
      LIMIT 1
    `)
    .bind(userId)
    .first()

  if (recent)
    return res({
      error: 'Please wait before requesting another confirmation email',
      retry_after: COOLDOWN_SECONDS,
    }, 429)

  // ── 5. 生成一次性 Token（DB 存 SHA-256 hash）────────────────
  const token     = generateSecureToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db
    .prepare(`
      INSERT INTO email_verifications (user_id, token_hash, token_type, ip_address, expires_at)
      VALUES (?, ?, 'delete_account', ?, ?)
    `)
    .bind(userId, tokenHash, request.headers.get('CF-Connecting-IP') ?? null, expiresAt)
    .run()

  // ── 6. 發送確認信 ────────────────────────────────────────────
  try {
    await sendDeleteConfirmationEmail(env.RESEND_API_KEY, userRow.email, token)
  } catch {
    await db.prepare('DELETE FROM email_verifications WHERE token_hash = ?').bind(tokenHash).run()
    return res({ error: 'Failed to send confirmation email, please try again later' }, 502)
  }

  return res({
    message: 'Confirmation email sent. You have 15 minutes to complete account deletion.',
  })
}
