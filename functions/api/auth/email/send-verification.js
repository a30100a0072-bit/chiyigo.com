/**
 * POST /api/auth/email/send-verification
 * Header: Authorization: Bearer <access_token>
 *
 * 回傳情境：
 *  200 → { message: 'Verification email sent' }
 *  400 → { error: 'Email already verified' }
 *  429 → { error: 'Please wait before requesting another email', retry_after: 60 }
 *  401/403 → requireAuth 標準錯誤
 *  500 → 內部錯誤（DB / Resend 交握失敗）
 */

import { requireAuth, res } from '../../../utils/auth.js'
import { generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { sendVerificationEmail } from '../../../utils/email.js'
import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit.js'

const COOLDOWN_SECONDS    = 60
const TOKEN_TTL_HOURS     = 1
const IP_HOURLY_LIMIT     = 10   // 既有：每 IP 每小時 10 次（email_verifications 表）
const SHORT_WINDOW_SEC    = 60   // 新：login_attempts kind='email_send' 短視窗
const SHORT_WINDOW_MAX    = 3    //      每 IP 每分鐘 3 次
const FETCH_TIMEOUT_MS    = 8000  // 防 Resend 卡住把 Worker 拖進 524

export async function onRequestPost(ctx) {
  try {
    return await handle(ctx)
  } catch (err) {
    console.error('[send-verification] unhandled', err)
    return res({ error: 'Internal error' }, 500)
  }
}

async function handle({ request, env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  if (ip) {
    // 短視窗（1min ≥ 3）+ 長視窗（1h ≥ 10）雙層
    const { blocked: shortBlocked } = await checkRateLimit(db, {
      kind:           'email_send',
      ip,
      windowSeconds:  SHORT_WINDOW_SEC,
      max:            SHORT_WINDOW_MAX,
    })
    if (shortBlocked)
      return res({ error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' }, 429)

    const ipCount = await db
      .prepare(`
        SELECT COUNT(*) AS cnt FROM email_verifications
        WHERE ip_address = ? AND created_at > datetime('now', '-1 hour')
      `)
      .bind(ip)
      .first()
    if ((ipCount?.cnt ?? 0) >= IP_HOURLY_LIMIT)
      return res({ error: 'Too many requests. Please try again later.' }, 429)

    // 通過 → 寫入短視窗計數（成功 / 失敗都算一次嘗試）
    await recordRateLimit(db, { kind: 'email_send', ip, userId: Number(user.sub) })
  }

  const userRow = await db
    .prepare('SELECT email, email_verified FROM users WHERE id = ?')
    .bind(user.sub)
    .first()

  if (!userRow) return res({ error: 'User not found' }, 404)
  if (userRow.email_verified === 1)
    return res({ error: 'Email already verified' }, 400)

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

  const token     = generateSecureToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db
    .prepare(`
      INSERT INTO email_verifications (user_id, token_hash, token_type, ip_address, expires_at)
      VALUES (?, ?, 'verify_email', ?, ?)
    `)
    .bind(user.sub, tokenHash, ip, expiresAt)
    .run()

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      await sendVerificationEmail(env.RESEND_API_KEY, userRow.email, token, env, ctrl.signal)
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    console.error('[send-verification] resend failed', err?.message ?? err)
    await db
      .prepare('DELETE FROM email_verifications WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
    return res({ error: 'Failed to send email, please try again later' }, 502)
  }

  return res({ message: 'Verification email sent' })
}

