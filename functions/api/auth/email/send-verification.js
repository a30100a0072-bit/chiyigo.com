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
const IP_HOURLY_LIMIT  = 10  // per IP, across all token types
const FETCH_TIMEOUT_MS = 8000  // debug: 強制 fetch 8s timeout 防 524

export async function onRequestPost(ctx) {
  try {
    return await handle(ctx)
  } catch (err) {
    return res({ error: 'Internal error', detail: String(err?.message ?? err) }, 500)
  }
}

async function handle({ request, env }) {
  const log = (m) => console.log(`[send-verify] ${m}`)
  log('step:0 enter')

  const { user, error } = await requireAuth(request, env)
  if (error) { log('step:1 fail (auth)'); return error }
  log(`step:1 auth ok sub=${user.sub}`)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null
  log(`step:1b db=${!!db} ip=${ip}`)

  if (ip) {
    log('step:1c ip-rl SELECT begin')
    const ipCount = await db
      .prepare(`
        SELECT COUNT(*) AS cnt FROM email_verifications
        WHERE ip_address = ? AND created_at > datetime('now', '-1 hour')
      `)
      .bind(ip)
      .first()
    log(`step:1c done cnt=${ipCount?.cnt}`)
    if ((ipCount?.cnt ?? 0) >= IP_HOURLY_LIMIT)
      return res({ error: 'Too many requests. Please try again later.' }, 429)
  }

  log('step:2 user SELECT begin')
  const userRow = await db
    .prepare('SELECT email, email_verified FROM users WHERE id = ?')
    .bind(user.sub)
    .first()
  log(`step:2 done found=${!!userRow}`)

  if (!userRow) return res({ error: 'User not found' }, 404)
  if (userRow.email_verified === 1)
    return res({ error: 'Email already verified' }, 400)

  log('step:3 cooldown SELECT begin')
  const recent = await db
    .prepare(`
      SELECT id FROM email_verifications
      WHERE user_id = ?
        AND created_at > datetime('now', '-${COOLDOWN_SECONDS} seconds')
      LIMIT 1
    `)
    .bind(user.sub)
    .first()
  log(`step:3 done recent=${!!recent}`)

  if (recent)
    return res({ error: 'Please wait before requesting another email', retry_after: COOLDOWN_SECONDS }, 429)

  log('step:4 token gen + INSERT begin')
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
  log('step:4 INSERT done')

  log(`step:5 fetch resend begin key_present=${!!env.RESEND_API_KEY} from=${env.MAIL_FROM_ADDRESS ?? '(default)'}`)
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      await sendVerificationEmail(env.RESEND_API_KEY, userRow.email, token, env, ctrl.signal)
    } finally {
      clearTimeout(timer)
    }
    log('step:5 fetch resend ok')
  } catch (err) {
    log(`step:5 fetch resend fail: ${err?.message ?? err}`)
    await db
      .prepare('DELETE FROM email_verifications WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
    return res({ error: 'Failed to send email', detail: String(err?.message ?? err) }, 500)
  }

  log('step:6 return 200')
  return res({ message: 'Verification email sent' })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
