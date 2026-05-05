/**
 * POST /api/auth/local/login
 * Body: { email, password }
 *
 * 回傳情境：
 *  200 → { access_token }              密碼正確且未啟用 2FA
 *  403 → { code: 'TOTP_REQUIRED',
 *           pre_auth_token }           密碼正確但需要進行 TOTP 驗證
 *  401 → { error: 'Invalid credentials' }
 *
 * pre_auth_token 為短效（5 分鐘）受限 JWT，scope='pre_auth'，
 * 僅供 /api/auth/2fa/verify 端點使用。
 */

import { verifyPassword, generateSecureToken, hashToken } from '../../../utils/crypto.js'
import { signJwt } from '../../../utils/jwt.js'
import { resolveAud } from '../../../utils/cors.js'
import { verifyTurnstile } from '../../../utils/turnstile.js'
import { res } from '../../../utils/auth.js'
import { refreshCookie } from '../../../utils/cookies.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import { buildTokenScope } from '../../../utils/scopes.js'
import { safeAlertAnomalies } from '../../../utils/device-alerts.js'
import { checkRateLimit } from '../../../utils/rate-limit.js'
import {
  isIpBlacklisted,
  getUserCooldownSeconds,
  detectAndBlacklistCrossUserScan,
} from '../../../utils/brute-force.js'
import { computeRiskScore, hashUa, shouldDenyByRisk, isRiskMedium } from '../../../utils/risk-score.js'
import { sendRiskBlockedAlertEmail } from '../../../utils/email.js'

const ACCESS_TOKEN_TTL    = '15m'
const PRE_AUTH_TOKEN_TTL  = '5m'
const REFRESH_TOKEN_DAYS  = 7

export async function onRequestPost({ request, env }) {
  // ── 1. 解析 Body ────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { email, password, device_uuid, platform, aud } = body ?? {}
  const audience = resolveAud(aud)

  if (!email || !password)
    return res({ error: 'email and password are required' }, 400)

  // Turnstile（key 未設時 verifyTurnstile 會 skip，不破壞既有流程）
  const ts = await verifyTurnstile(request, body, env)
  if (!ts.ok) return res({ error: 'captcha_failed', code: 'CAPTCHA_FAILED', reason: ts.reason }, 403)

  const db        = env.chiyigo_db
  const ip        = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const emailNorm = email.toLowerCase()

  // ── 1.5 IP 黑名單（Phase E-4）— 24hr 內被偵測 cross-user scan 的 IP 直接擋
  const blacklisted = await isIpBlacklisted(db, ip)
  if (blacklisted) {
    await safeUserAudit(env, {
      event_type: 'auth.login.ip_blacklisted', severity: 'critical', request,
      data: { reason: blacklisted.reason, expires_at: blacklisted.expires_at },
    })
    return res({
      error: 'Your IP is temporarily blocked due to suspicious activity.',
      code: 'IP_BLOCKED',
    }, 429)
  }

  // ── 2. Rate Limit（Phase E3）──
  // spec：5/IP/min；額外保留 10/email/15min 防 credential stuffing（針對具體 email 撞密碼）
  const [ipShort, emailLong] = await Promise.all([
    checkRateLimit(db, { kind: 'login', ip,             windowSeconds: 60,   max: 5 }),
    checkRateLimit(db, { kind: 'login', email: emailNorm, windowSeconds: 900, max: 10 }),
  ])
  if (ipShort.blocked || emailLong.blocked) {
    await safeUserAudit(env, {
      event_type: 'auth.login.rate_limited', severity: 'warn', request,
      data: { reason: ipShort.blocked ? 'ip' : 'email' },
    })
    return res({ error: 'Too many login attempts, please try again later.', code: 'RATE_LIMITED' }, 429)
  }

  // ── 2.5 漸進 cooldown（Phase E-4）— 連續失敗 ≥3 次後逐級加長等待時間
  const cooldownSec = await getUserCooldownSeconds(db, emailNorm)
  if (cooldownSec > 0) {
    await safeUserAudit(env, {
      event_type: 'auth.login.cooldown', severity: 'warn', request,
      data: { seconds: cooldownSec },
    })
    return res({
      error: `Please wait ${cooldownSec} seconds before retrying.`,
      code: 'COOLDOWN',
      retry_after: cooldownSec,
    }, 429)
  }

  // ── 3. 查詢 user + local_account（一次 JOIN）─────────────────
  const record = await db
    .prepare(`
      SELECT
        u.id            AS user_id,
        u.email         AS email,
        u.email_verified,
        u.role,
        u.status,
        u.token_version,
        u.deleted_at,
        la.password_hash,
        la.password_salt,
        la.totp_enabled
      FROM users u
      JOIN local_accounts la ON la.user_id = u.id
      WHERE u.email = ?
    `)
    .bind(email.toLowerCase())
    .first()

  // ── 4. 帳號不存在或已刪除 ────────────────────────────────────
  // 無論是「不存在」或「密碼錯誤」皆回傳相同訊息，防帳號枚舉
  if (!record || record.deleted_at) {
    await Promise.all([
      fakeHashDelay(),
      db.prepare(`INSERT INTO login_attempts (ip, email) VALUES (?, ?)`)
        .bind(ip, emailNorm).run(),
    ])
    await safeUserAudit(env, { event_type: 'auth.login.fail', severity: 'warn', request, data: { reason_code: 'unknown_user' } })

    // Phase E-4：未知 user 也要計入 cross-user scan（攻擊者可能撞不存在 email）
    if (ip && ip !== 'unknown') {
      const blacklisted = await detectAndBlacklistCrossUserScan(db, ip)
      if (blacklisted) {
        await safeUserAudit(env, {
          event_type: 'auth.login.ip_blacklist_added', severity: 'critical', request,
          data: { reason: 'cross_user_scan', ttl_hours: 24 },
        })
      }
    }
    return res({ error: 'Invalid credentials' }, 401)
  }

  // ── 5. 驗證密碼 ──────────────────────────────────────────────
  const valid = await verifyPassword(password, record.password_salt, record.password_hash)
  if (!valid) {
    await db.prepare(`INSERT INTO login_attempts (ip, email) VALUES (?, ?)`)
      .bind(ip, emailNorm).run()
    await safeUserAudit(env, { event_type: 'auth.login.fail', severity: 'warn', user_id: record.user_id, request, data: { reason_code: 'bad_password' } })

    // Phase E-4：偵測 cross-user scan（同 IP 在 1hr 內撞 ≥10 個 distinct email）
    // → 寫入 24hr 黑名單；下次該 IP 任何 login 進不來
    if (ip && ip !== 'unknown') {
      const blacklisted = await detectAndBlacklistCrossUserScan(db, ip)
      if (blacklisted) {
        await safeUserAudit(env, {
          event_type: 'auth.login.ip_blacklist_added', severity: 'critical',
          user_id: record.user_id, request,
          data: { reason: 'cross_user_scan', ttl_hours: 24 },
        })
      }
    }
    return res({ error: 'Invalid credentials' }, 401)
  }

  // ── 5.5 封禁帳號：密碼正確但帳號已被封禁，禁止取得新 token ──
  if (record.status === 'banned') {
    await safeUserAudit(env, { event_type: 'auth.login.banned_attempt', severity: 'warn', user_id: record.user_id, request })
    return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)
  }

  // ── 5.7 Phase E-2 risk score ─────────────────────────────────
  // 密碼正確 + 未 ban 後算分。clear login_attempts 必須**之後**做，否則 recent_fails 永遠 0
  const risk = await computeRiskScore(env, request, { userId: record.user_id, email: emailNorm })
  if (shouldDenyByRisk(risk.score)) {
    await safeUserAudit(env, {
      event_type: 'auth.risk.blocked', severity: 'critical',
      user_id: record.user_id, request,
      data: { score: risk.score, factors: risk.factors, country: risk.country },
    })
    if (env.RESEND_API_KEY) {
      try {
        await sendRiskBlockedAlertEmail(env.RESEND_API_KEY, record.email, {
          score: risk.score, factors: risk.factors, country: risk.country,
          when: new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC',
        }, env)
      } catch { /* swallow */ }
    }
    return res({
      error: 'High risk login blocked. Check your email for details.',
      code: 'RISK_BLOCKED',
    }, 403)
  }
  if (isRiskMedium(risk.score)) {
    await safeUserAudit(env, {
      event_type: 'auth.risk.medium', severity: 'warn',
      user_id: record.user_id, request,
      data: { score: risk.score, factors: risk.factors, country: risk.country },
    })
  }

  // 密碼驗證通過：清除此 email 的失敗記錄（fire-and-forget）
  db.prepare(`DELETE FROM login_attempts WHERE kind = 'login' AND email = ?`).bind(emailNorm).run()

  // ── 6a. 需要 2FA → 回傳受限 pre_auth_token（ES256）───────────
  if (record.totp_enabled) {
    const preAuthToken = await signJwt({
      sub:    String(record.user_id),
      scope:  'pre_auth',
      role:   record.role,
      status: record.status,
      ver:    record.token_version ?? 0,
    }, PRE_AUTH_TOKEN_TTL, env)

    return res({
      code:           'TOTP_REQUIRED',
      pre_auth_token: preAuthToken,
    }, 403)
  }

  // ── 6b. 無 2FA → 簽發完整 Access Token + Refresh Token ──────
  const accessToken = await signJwt({
    sub:            String(record.user_id),
    email:          record.email,
    email_verified: record.email_verified === 1,
    role:           record.role,
    status:         record.status,
    ver:            record.token_version ?? 0,
    scope:          buildTokenScope(record.role),
  }, ACCESS_TOKEN_TTL, env, { audience })

  const refreshToken    = generateSecureToken()
  const refreshTokenHash = await hashToken(refreshToken)
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await db.prepare(`
    INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).bind(record.user_id, refreshTokenHash, device_uuid ?? null, refreshExpiresAt).run()

  const payload = {
    access_token:   accessToken,
    user_id:        record.user_id,
    email:          record.email,
    email_verified: record.email_verified === 1,
    role:           record.role,
    status:         record.status,
  }

  await safeUserAudit(env, {
    event_type: 'auth.login.success',
    user_id: record.user_id, request,
    data: {
      method: 'password',
      country: risk.country,
      ua_hash: risk.ua_hash,
      risk_score: risk.score,
      risk_factors: risk.factors,
    },
  })
  await safeAlertAnomalies(env, request, {
    userId:     record.user_id,
    email:      record.email,
    deviceUuid: device_uuid ?? null,
  })

  // Web 瀏覽器（無 device_uuid 且非明確 App 平台）→ Cookie
  const isWeb = !device_uuid && (!platform || platform === 'web')
  if (isWeb) {
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': refreshCookie(refreshToken, REFRESH_TOKEN_DAYS * 86400),
      },
    })
  }

  // App / Unity / Unreal → JSON body
  return res({ ...payload, refresh_token: refreshToken })
}

/**
 * 當帳號不存在時執行假雜湊，避免因回應時間差異洩漏帳號是否存在。
 * 耗時約等同一次真實 PBKDF2 運算。
 */
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


