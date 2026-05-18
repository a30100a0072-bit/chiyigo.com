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

import { generateSecureToken, hashToken } from '../../../utils/crypto'
import { sendPasswordResetEmail } from '../../../utils/email'
import { verifyTurnstile } from '../../../utils/turnstile'
import { res } from '../../../utils/auth'
import { verifyJwt } from '../../../utils/jwt'
import { safeUserAudit } from '../../../utils/user-audit'

const COOLDOWN_SECONDS  = 60
const TOKEN_TTL_HOURS   = 1
const IP_HOURLY_LIMIT   = 5   // per IP, across all token types

export async function onRequestPost({ request, env, waitUntil }) {
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const { email } = body ?? {}
  if (!email) return res({ error: 'email is required', code: 'EMAIL_REQUIRED' }, 400)
  const emailLower = email.toLowerCase().trim()

  // Turnstile：匿名請求（login 頁的 forgot-password）必驗。
  // 已登入 user 對「自己的 email」發起重設（dashboard 的 setpw / change-password 流程）
  // 跳過 turnstile — user 已驗證身份且只能對自己的 email 操作；後續 IP 限流 + 60s 冷卻
  // 仍生效。對「他人 email」發起者一律走匿名路徑驗 captcha 防 enumeration / spam。
  let skipTurnstile = false
  const authHeader = request.headers.get('Authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    try {
      // P2-3：要求 token aud='chiyigo'。否則第三方 RP（sport-app/mbti/talo 等）的
      // access_token 也能繞過 turnstile，雖只能對 own email 操作，但破壞了「IAM 自身
      // 才能 skip」的封閉假設。
      const payload = await verifyJwt(authHeader.slice(7).trim(), env, { audience: 'chiyigo' })
      if (payload.email && String(payload.email).toLowerCase() === emailLower) {
        skipTurnstile = true
      }
    } catch { /* 簽章 / 過期 / aud 不符 → 走匿名路徑 */ }
  }

  if (!skipTurnstile) {
    const ts = await verifyTurnstile(request, body, env)
    if (!ts.ok) return res({ error: 'captcha_failed', code: 'CAPTCHA_FAILED', reason: ts.reason }, 403)
  }

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
      return res({ error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' }, 429)
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

  if (recent) {
    // P1-4：冷卻分支也跑 fakeHashDelay 對齊 unknown_email + happy 路徑時序
    await fakeHashDelay()
    return res({ message: 'If that email is registered, a reset link has been sent.' })
  }

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

  // ── 4. 發信（async via waitUntil 不擋響應；失敗時回滾 token，但仍回 200 防枚舉）
  // P1-4：sendEmail 是網路 I/O（Resend API ~200-500ms），同步 await 會讓 happy 路徑
  // 比 unknown_email / cooldown 慢一個量級，timing oracle。改 waitUntil 在 response 後跑。
  const sendJob = (async () => {
    try {
      await sendPasswordResetEmail(env.RESEND_API_KEY, userRow.email, token, env)
    } catch {
      await db
        .prepare('DELETE FROM email_verifications WHERE token_hash = ?')
        .bind(tokenHash)
        .run()
    }
    await safeUserAudit(env, { event_type: 'account.password.reset_request', user_id: userRow.id, request })
  })()
  if (typeof waitUntil === 'function') waitUntil(sendJob)
  // happy 分支也跑 fakeHashDelay → 確保響應時間下限與 unknown_email/cooldown 同
  await fakeHashDelay()
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

