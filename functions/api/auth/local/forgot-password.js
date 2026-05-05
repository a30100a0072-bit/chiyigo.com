/**
 * POST /api/auth/local/forgot-password
 * Body: { email }
 *
 * 安全規範：
 *  - 無論信箱是否存在，一律回 200（防帳號枚舉）
 *  - 帳號不存在時執行 fakeHashDelay 對齊響應時間
 *  - 60 秒冷卻：同帳號在視窗內重複請求仍回 200（不洩漏狀態）
 *  - DB 只存 token 的 SHA-256 hash，原始 token 只出現在 email link
 */

import { generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { sendPasswordResetEmail } from '../../../utils/email.js'
import { verifyTurnstile } from '../../../utils/turnstile.js'
import { res } from '../../../utils/auth.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

const COOLDOWN_SECONDS  = 60
const TOKEN_TTL_HOURS   = 1
const IP_HOURLY_LIMIT   = 5   // per IP, across all token types

export async function onRequestPost({ request, env }) {
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { email } = body ?? {}
  if (!email) return res({ error: 'email is required' }, 400)

  // Turnstile（key 未設時 skip）
  const ts = await verifyTurnstile(request, body, env)
  if (!ts.ok) return res({ error: 'captcha_failed', code: 'CAPTCHA_FAILED', reason: ts.reason }, 403)

  const db = env.chiyigo_db
  const ip = request.headers.get('CF-Connecting-IP') ?? null

  // ── 0. IP 全域限流（防同 IP 大量發信）────────────────────────
  if (ip) {
    const ipCount = await db
      .prepare(`
        SELECT COUNT(*) AS cnt FROM email_verifications
        WHERE ip_address = ? AND created_at > datetime('now', '-1 hour')
      `)
      .bind(ip)
      .first()
    if ((ipCount?.cnt ?? 0) >= IP_HOURLY_LIMIT)
      return res({ error: 'Too many requests. Please try again later.' }, 429)
  }

  // ── 1. 查詢帳號（不透過回應時間洩漏是否存在）───────────────────
  const userRow = await db
    .prepare(`
      SELECT id, email FROM users
      WHERE email = ? AND deleted_at IS NULL
    `)
    .bind(email.toLowerCase().trim())
    .first()

  if (!userRow) {
    await fakeHashDelay()
    // 仍記 audit（user_id=null）— 偵測信箱枚舉樣態
    await safeUserAudit(env, { event_type: 'account.password.reset_request', request, data: { reason_code: 'unknown_email' } })
    return res({ message: 'If that email is registered, a reset link has been sent.' })
  }

  // ── 2. 60 秒冷卻（超過也只回 200，不洩漏冷卻狀態）─────────────
  const recent = await db
    .prepare(`
      SELECT id FROM email_verifications
      WHERE user_id   = ?
        AND token_type = 'reset_password'
        AND created_at > datetime('now', '-${COOLDOWN_SECONDS} seconds')
      LIMIT 1
    `)
    .bind(userRow.id)
    .first()

  if (recent)
    return res({ message: 'If that email is registered, a reset link has been sent.' })

  // ── 3. 生成 Token ────────────────────────────────────────────
  const token     = generateSecureToken()
  const tokenHash = await hashToken(token)
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db
    .prepare(`
      INSERT INTO email_verifications (user_id, token_hash, token_type, ip_address, expires_at)
      VALUES (?, ?, 'reset_password', ?, ?)
    `)
    .bind(userRow.id, tokenHash, ip, expiresAt)
    .run()

  // ── 4. 發信（失敗時回滾 token，但仍回 200 防枚舉）──────────────
  try {
    await sendPasswordResetEmail(env.RESEND_API_KEY, userRow.email, token, env)
  } catch {
    await db
      .prepare('DELETE FROM email_verifications WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
  }

  await safeUserAudit(env, { event_type: 'account.password.reset_request', user_id: userRow.id, request })
  return res({ message: 'If that email is registered, a reset link has been sent.' })
}

// 帳號不存在時執行假 PBKDF2，對齊有帳號時的響應時間
async function fakeHashDelay() {
  const dummy = new Uint8Array(32)
  crypto.getRandomValues(dummy)
  const key = await crypto.subtle.importKey(
    'raw', dummy, { name: 'PBKDF2' }, false, ['deriveBits']
  )
  await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: dummy, iterations: 100_000 },
    key, 256
  )
}

