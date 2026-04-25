/**
 * POST /api/auth/email/send-verification
 * Header: Authorization: Bearer <access_token>
 *
 * 回傳情境：
 *  200 → { message: 'Verification email sent' }
 *  400 → { error: 'Email already verified' }
 *  429 → { error: 'Please wait before requesting another email', retry_after: 60 }
 *  401/403 → requireAuth 標準錯誤
 */

import { requireAuth } from '../../../utils/auth.js'
import { generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { sendVerificationEmail } from '../../../utils/email.js'

const COOLDOWN_SECONDS = 60
const TOKEN_TTL_HOURS  = 1

export async function onRequestPost({ request, env }) {
  // ── 1. 身份驗證 ──────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const db = env.chiyigo_db

  // ── 2. 查詢使用者（取得 email + email_verified）──────────────
  const userRow = await db
    .prepare('SELECT email, email_verified FROM users WHERE id = ?')
    .bind(user.sub)
    .first()

  if (!userRow) return res({ error: 'User not found' }, 404)

  if (userRow.email_verified === 1)
    return res({ error: 'Email already verified' }, 400)

  // ── 3. 60 秒冷卻檢查（統一跨所有 token_type，防多種信件搭配繞過）──
  const recent = await db
    .prepare(`
      SELECT id FROM email_verifications
      WHERE user_id = ?
        AND created_at > datetime('now', '-${COOLDOWN_SECONDS} seconds')
      LIMIT 1
    `)
    .bind(user.sub)
    .first()

  if (recent)
    return res({ error: 'Please wait before requesting another email', retry_after: COOLDOWN_SECONDS }, 429)

  // ── 4. 生成 Token（原始 hex 發給使用者，DB 存 SHA-256 hash）──
  const token     = generateSecureToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  const ip = request.headers.get('CF-Connecting-IP') ?? null

  await db
    .prepare(`
      INSERT INTO email_verifications (user_id, token_hash, token_type, ip_address, expires_at)
      VALUES (?, ?, 'verify_email', ?, ?)
    `)
    .bind(user.sub, tokenHash, ip, expiresAt)
    .run()

  // ── 5. 發信 ──────────────────────────────────────────────────
  try {
    await sendVerificationEmail(env.RESEND_API_KEY, userRow.email, token)
  } catch (e) {
    // 發信失敗時刪除剛寫入的 token，避免孤兒紀錄占用冷卻視窗
    await db
      .prepare('DELETE FROM email_verifications WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
    return res({ error: 'Failed to send email, please try again later' }, 502)
  }

  return res({ message: 'Verification email sent' })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
