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
import { sendVerificationEmail } from '../../../utils/email.js'
import { validatePassword } from '../../../utils/password.js'
import { resolveAud } from '../../../utils/cors.js'
import { buildTokenScope } from '../../../utils/scopes.js'
import { verifyTurnstile } from '../../../utils/turnstile.js'
import { res } from '../../../utils/auth.js'
import { refreshCookie } from '../../../utils/cookies.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ACCESS_TOKEN_TTL   = '15m'
const VERIFY_TOKEN_HOURS = 24
const REFRESH_TOKEN_DAYS = 7

export async function onRequestPost({ request, env, waitUntil }) {
  // ── 1. 解析 Body ────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { email, password, guest_id, device_uuid, platform, aud } = body ?? {}
  const audience = resolveAud(aud)

  if (!email || !password)
    return res({ error: 'email and password are required' }, 400)
  if (!EMAIL_RE.test(email))
    return res({ error: 'Invalid email format' }, 400)
  const pwCheck = validatePassword(password)
  if (!pwCheck.ok) return res({ error: pwCheck.error }, 400)

  // Turnstile（key 未設時 skip，不破壞既有流程）
  const ts = await verifyTurnstile(request, body, env)
  if (!ts.ok) return res({ error: 'captcha_failed', code: 'CAPTCHA_FAILED', reason: ts.reason }, 403)

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
      INSERT INTO email_verifications (token_hash, user_id, token_type, expires_at)
      SELECT ?, id, 'verify_email', ? FROM users WHERE email = ?
    `).bind(verifyTokenHash, verifyExpiry, emailLower),
  ])

  // ── 6. 訪客轉正（Best-effort，僅轉同 guest_id 下尚未綁定的紀錄）────
  // Codex r4-bonus（2026-05-10）：register 端對 guest_id 也驗 web-<uuid> 格式（防禦深度）。
  // requisition INSERT 端有驗，但 register 仍可能收到舊 client / 直接打 API 的雜值，
  // 不驗就送進 SQL 雖無 injection 但會做無謂查詢。
  const isValidGuestId = guest_id && /^web-[0-9a-f-]{36}$/i.test(guest_id)
  if (isValidGuestId) {
    try {
      // Codex audit r2 #3（2026-05-10）：除了 owner_user_id，也同步寫 user_id。
      // 原因：requisition/me.js、[id].js、revoke.js 全用 WHERE user_id=? 查詢，只設
      // owner_user_id 會讓使用者在會員中心永遠看不到自己訪客時送的單，且無法撤回。
      // 條件加 user_id IS NULL 避免覆蓋他人已綁定的 row。
      // Codex r3 #3：用 RETURNING 取受影響 row，給下方 audit 用（保留 takeover 軌跡）
      // Codex r4 #3：RETURNING 也帶 user_id，audit 直接帶新 user_id 方便日後查
      const taken = await db
        .prepare(`
          UPDATE requisition
          SET owner_user_id  = (SELECT id FROM users WHERE email = ?),
              user_id        = (SELECT id FROM users WHERE email = ?),
              owner_guest_id = NULL
          WHERE owner_guest_id = ? AND owner_user_id IS NULL AND user_id IS NULL
          RETURNING id, user_id
        `)
        .bind(emailLower, emailLower, guest_id)
        .all()
      const takenRows = taken?.results ?? []
      const takenIds  = takenRows.map(r => r.id)
      const newUserId = takenRows[0]?.user_id ?? null
      if (takenIds.length) {
        // Codex audit r3 #3（2026-05-10）：takeover 後 owner_guest_id 變 NULL，
        // 失去訪客→user 軌跡。寫一筆 audit 記下 sha256(guest_id) + 受影響 requisition_ids，
        // 不存明文 device id（保護瀏覽器身份）。
        const enc = new TextEncoder().encode(guest_id)
        const guestHashBuf = await crypto.subtle.digest('SHA-256', enc)
        const guestHash = Array.from(new Uint8Array(guestHashBuf))
          .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
        await safeUserAudit(env, {
          event_type: 'requisition.takeover', severity: 'info',
          user_id: newUserId, request,
          data: {
            requisition_ids: takenIds,
            guest_id_hash:   guestHash,
            email:           emailLower,
            count:           takenIds.length,
          },
        })
      }
    } catch {
      // 欄位不存在（schema 尚未遷移）時不中斷主流程
    }
  }

  // ── 7. 取得新建 user 資料（含 role / status 預設值 / token_version）──
  const user = await db
    .prepare('SELECT id, role, status, token_version FROM users WHERE email = ?')
    .bind(emailLower)
    .first()

  // ── 8. 簽發 Refresh Token ────────────────────────────────────
  const refreshToken     = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db
    .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time)
              VALUES (?, ?, ?, ?, datetime('now'))`)
    .bind(user.id, refreshTokenHash, device_uuid ?? null, refreshExpiresAt)
    .run()

  // ── 9. 簽發 Access Token（ES256）────────────────────────────
  // Codex #8：對齊 login.js 補 ver / scope claim，避免後續 bumpTokenVersion / scope 守門失效
  const accessToken = await signJwt({
    sub:            String(user.id),
    email:          emailLower,
    email_verified: false,
    role:           user.role,
    status:         user.status,
    ver:            user.token_version ?? 0,
    scope:          buildTokenScope(user.role),
  }, ACCESS_TOKEN_TTL, env, { audience })

  await safeUserAudit(env, { event_type: 'account.register', user_id: user.id, request })

  // 發送驗證信（fire-and-forget，不阻塞註冊回應；失敗時使用者仍可到 dashboard 重發）
  if (env.RESEND_API_KEY) {
    const sendTask = sendVerificationEmail(env.RESEND_API_KEY, emailLower, verifyToken, env)
      .catch(() => { /* 靜默失敗，避免吞掉註冊流程 */ })
    if (typeof waitUntil === 'function') waitUntil(sendTask)
  }

  const payload = {
    access_token:   accessToken,
    user_id:        user.id,
    email:          emailLower,
    email_verified: false,
    role:           user.role,
    status:         user.status,
  }

  // Web 瀏覽器（無 device_uuid 且非明確 App 平台）→ HttpOnly cookie，
  // 不把 refresh_token 暴露到 JSON body。對齊 local/login.js 273。
  const isWeb = !device_uuid && (!platform || platform === 'web')
  if (isWeb) {
    return new Response(JSON.stringify(payload), {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie':   refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400),
      },
    })
  }
  return res({ ...payload, refresh_token: refreshToken }, 201)
}

