/**
 * POST /api/auth/local/register
 * Body: { email, password, guest_id? }
 *
 * 流程：
 *  1. 驗證輸入 → 2. 檢查 email 重複 → 3. PBKDF2 雜湊密碼
 *  4. 原子 batch：users + local_accounts + email_verifications
 *  5. 訪客轉正（若帶 guest_id，更新 requisition 業務資料）
 *  6. 簽發 JWT Access Token
 */

import { generateSalt, hashPassword, generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { signJwt } from '../../../utils/jwt.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ACCESS_TOKEN_TTL  = '15m'
const VERIFY_TOKEN_HOURS = 24

export async function onRequestPost({ request, env }) {
  // ── 1. 解析 Body ────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { email, password, guest_id } = body ?? {}

  if (!email || !password)
    return res({ error: 'email and password are required' }, 400)
  if (!EMAIL_RE.test(email))
    return res({ error: 'Invalid email format' }, 400)
  if (typeof password !== 'string' || password.length < 8)
    return res({ error: 'Password must be at least 8 characters' }, 400)

  const db = env.chiyigo_db

  // ── 2. 檢查 email 是否已註冊 ────────────────────────────────
  const existing = await db
    .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
    .bind(email.toLowerCase())
    .first()
  if (existing) return res({ error: 'Email already registered' }, 409)

  // ── 3. 密碼雜湊 ─────────────────────────────────────────────
  const salt = generateSalt()
  const hash = await hashPassword(password, salt)

  // ── 4. 信箱驗證 Token ────────────────────────────────────────
  const verifyToken     = generateSecureToken()
  const verifyTokenHash = await hashToken(verifyToken)
  const verifyExpiry    = new Date(Date.now() + VERIFY_TOKEN_HOURS * 3600_000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19)

  const emailLower = email.toLowerCase()

  // ── 5. 原子 Batch：users + local_accounts + email_verifications
  // local_accounts 與 email_verifications 以子查詢取 user_id，
  // 避免額外 round-trip 且保持原子性。
  await db.batch([
    db.prepare('INSERT INTO users (email) VALUES (?)').bind(emailLower),
    db.prepare(`
      INSERT INTO local_accounts (user_id, password_hash, password_salt)
      SELECT id, ?, ? FROM users WHERE email = ?
    `).bind(hash, salt, emailLower),
    db.prepare(`
      INSERT INTO email_verifications (token_hash, user_id, expires_at)
      SELECT ?, id, ? FROM users WHERE email = ?
    `).bind(verifyTokenHash, verifyExpiry, emailLower),
  ])

  // ── 6. 訪客轉正（Best-effort，欄位不存在時靜默跳過）────────
  if (guest_id) {
    try {
      await db
        .prepare(`
          UPDATE requisition
          SET owner_user_id  = (SELECT id FROM users WHERE email = ?),
              owner_guest_id = NULL
          WHERE owner_guest_id = ?
        `)
        .bind(emailLower, guest_id)
        .run()
    } catch {
      // 欄位不存在（schema 尚未遷移）時不中斷主流程
    }
  }

  // ── 7. 取得新建 user_id ──────────────────────────────────────
  const user = await db
    .prepare('SELECT id FROM users WHERE email = ?')
    .bind(emailLower)
    .first()

  // ── 8. 簽發 Access Token（ES256）────────────────────────────
  const accessToken = await signJwt({
    sub:            String(user.id),
    email:          emailLower,
    email_verified: false,
  }, ACCESS_TOKEN_TTL, env)

  // 生產環境應在此發送驗證信（TODO: Cloudflare Email Worker / SendGrid）
  // verifyToken 僅此處出現，請在發信後丟棄

  return res({
    access_token: accessToken,
    user_id: user.id,
    email: emailLower,
    email_verified: false,
  }, 201)
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
