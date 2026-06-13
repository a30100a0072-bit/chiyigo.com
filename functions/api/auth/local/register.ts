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

import { generateSalt, hashPassword, generateSecureToken, hashToken } from '../../../utils/crypto'
import { signJwt } from '../../../utils/jwt'
import { resolveActiveTenantClaims } from '../../../utils/tenant-context'
import { sendVerificationEmail } from '../../../utils/email'
import { validatePassword } from '../../../utils/password'
import { resolveAud } from '../../../utils/cors'
import { buildTokenScope } from '../../../utils/scopes'
import { verifyTurnstile } from '../../../utils/turnstile'
import { res } from '../../../utils/auth'
import { refreshCookie, isWebClient } from '../../../utils/cookies'
import { safeUserAudit, hashIdentifierForAudit } from '../../../utils/user-audit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ACCESS_TOKEN_TTL   = '15m'
const VERIFY_TOKEN_HOURS = 24
const REFRESH_TOKEN_DAYS = 7

export async function onRequestPost({ request, env, waitUntil }) {
  // ── 1. 解析 Body ────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const { email, password, guest_id, device_uuid, platform, aud } = body ?? {}
  const audience = resolveAud(aud)

  if (!email || !password)
    return res({ error: 'email and password are required', code: 'EMAIL_PASSWORD_REQUIRED' }, 400)
  if (!EMAIL_RE.test(email))
    return res({ error: 'Invalid email format', code: 'INVALID_EMAIL_FORMAT' }, 400)
  const pwCheck = validatePassword(password)
  if (!pwCheck.ok) return res({ error: pwCheck.error, code: 'WEAK_PASSWORD' }, 400)

  // Turnstile（key 未設時 skip，不破壞既有流程）
  const ts = await verifyTurnstile(request, body, env)
  if (!ts.ok) return res({ error: 'captcha_failed', code: 'CAPTCHA_FAILED', reason: ts.reason }, 403)

  const db = env.chiyigo_db

  // ── 2. 檢查 email 是否已註冊 ────────────────────────────────
  const existing = await db
    .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
    .bind(email.toLowerCase())
    .first()
  if (existing) return res({ error: 'Email already registered', code: 'EMAIL_ALREADY_REGISTERED' }, 409)

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
  // Codex r5 #3 / r6-2（2026-05-10）：guest_id 存在但格式不對 = 舊 client / 第三方 bot / 未授權
  // r5 原版存 prefix 前 4 字（明文），r6 改成分類 enum 防止 PII / email / 手機被當 guest_id 後
  // 前 4 字落 audit；同時用 10% 採樣降低被掃 API 製造噪音。safeUserAudit 無 per-event
  // rate-limit（user-audit.js:46-75），採樣是現階段最低成本的方案。
  if (guest_id && !isValidGuestId) {
    try {
      const raw = String(guest_id)
      // Codex r7-2 / r8-2：用 hashIdentifierForAudit (派生 domain key) 取代直接 HMAC root salt。
      // domain='guest-id-audit' → 與其他識別符 domain 獨立，rotation/blast radius 切乾淨。
      const sig = await hashIdentifierForAudit(env, 'guest-id-audit', raw)
      // Codex r7-3：deterministic sampling — 同一 bad value 重試不累積 audit。
      // sig.bytes[0] < 26 ≈ 10.16%
      if (sig.bytes[0] < 26) {
        // prefix_class：分類 enum，不存任何明文（防 email/手機/姓名被當 guest_id 落 audit）
        let prefixClass = 'other'
        if (/^web-/i.test(raw))            prefixClass = 'web_malformed' // 'web-' 開頭但 uuid 格式錯
        else if (/^guest-/i.test(raw))     prefixClass = 'guest_legacy'  // 舊 client 32-hex 格式
        else if (/^[0-9a-f]+$/i.test(raw)) prefixClass = 'hex_only'      // 純 hex
        await safeUserAudit(env, {
          event_type: 'register.guest_id_invalid_format', severity: 'warn',
          user_id: null, request,
          data: {
            length:           raw.length,
            prefix_class:     prefixClass,
            guest_id_hmac16:  sig.hex.slice(0, 16),  // domain-keyed HMAC；同 raw → 同前 16 字
            sampled:          true,                   // 真實量是 ×10（deterministic sampling）
            salted:           sig.salted,             // false → AUDIT_IP_SALT 未設，需修配置
          },
        })
      }
    } catch { /* audit 失敗不阻流 */ }
  }
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
      const allTakenIds = takenRows.map(r => r.id)
      // Codex r5 #4（2026-05-10）：requisition_ids cap，避免訪客跨多日累積大量 row 後 audit 過大
      const TAKEN_IDS_CAP = 100
      const takenIds  = allTakenIds.slice(0, TAKEN_IDS_CAP)
      const truncated = allTakenIds.length > TAKEN_IDS_CAP
      const newUserId = takenRows[0]?.user_id ?? null
      if (takenIds.length) {
        // Codex audit r3 #3（2026-05-10）：takeover 後 owner_guest_id 變 NULL，
        // 失去訪客→user 軌跡。寫一筆 audit 記下 hash(guest_id) + 受影響 requisition_ids，
        // 不存明文 device id（保護瀏覽器身份）。
        // Codex r8-1：對齊 invalid 路徑，改用 hashIdentifierForAudit (keyed HMAC)；
        // 同 domain ('guest-id-audit') 確保 takeover.guest_id_hash 與 invalid_format.hmac16
        // 對於同一 raw guest_id 會匹配（cross-event correlation），且都防字典反推。
        const sig = await hashIdentifierForAudit(env, 'guest-id-audit', guest_id)
        await safeUserAudit(env, {
          event_type: 'requisition.takeover', severity: 'info',
          user_id: newUserId, request,
          // Codex r6-3（2026-05-10）：移除 email — user-audit.js 設計原則明寫「email 不入」
          // user_id 已可追溯帳號；email 在 admin audit API 也會被 redaction，留 raw 是雙標
          data: {
            requisition_ids:  takenIds,
            guest_id_hmac32:  sig.hex.slice(0, 32),  // 同 invalid_format.guest_id_hmac16 同 domain，前 16 字相同 → 可 correlation
            salted:           sig.salted,
            count:            allTakenIds.length,    // 真實命中數（未 cap）
            truncated,                               // true 表示 requisition_ids 被截
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

  // Codex r9-5：issued_aud 鎖定發行時的 audience（防 refresh body.aud 切換）
  // PR5 5d-1b: + a fresh per-login session_id (the session.revoked family id, preserved across rotation).
  // PR-0（sid claim）：同一 session_id 寫進 refresh row 與下方 access token sid claim。
  const sessionId = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time, issued_aud, session_id)
              VALUES (?, ?, ?, ?, datetime('now'), ?, ?)`)
    .bind(user.id, refreshTokenHash, device_uuid ?? null, refreshExpiresAt, audience, sessionId)
    .run()

  // ── 9. 簽發 Access Token（ES256）────────────────────────────
  // Codex #8：對齊 login.js 補 ver / scope claim，避免後續 bumpTokenVersion / scope 守門失效
  const tenantClaims = await resolveActiveTenantClaims(env.chiyigo_db, Number(user.id))
  const accessToken = await signJwt({
    ...tenantClaims,
    sub:            String(user.id),
    email:          emailLower,
    email_verified: false,
    role:           user.role,
    status:         user.status,
    ver:            user.token_version ?? 0,
    scope:          buildTokenScope(user.role),
    sid:            sessionId,
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

  // Web 瀏覽器（Origin 屬於 chiyigo + platform 非明確 non-web）→ HttpOnly cookie，
  // 不把 refresh_token 暴露到 JSON body。規格 B：見 functions/utils/cookies.ts isWebClient
  const isWeb = isWebClient(request, { platform })
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

