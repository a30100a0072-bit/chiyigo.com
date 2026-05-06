/**
 * POST /api/auth/2fa/setup
 * Header: Authorization: Bearer <access_token>
 *
 * 第一階段：產生 TOTP Secret，儲存至 local_accounts.totp_secret，
 * 但 totp_enabled 仍為 0，需等 /activate 驗證首發 OTP 後才正式啟用。
 *
 * 回傳：
 *  { secret, otpauth_uri }
 *  前端用 otpauth_uri 產生 QR Code，使用者掃入 Authenticator App。
 */

import { TOTP, Secret } from 'otpauth'
import { requireAuth, res } from '../../../utils/auth.js'
import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit.js'

const TOTP_ISSUER = 'CHIYIGO'
const RL_WINDOW_SEC = 60
const RL_MAX        = 5
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function generateBase32Secret(byteLength = 20) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  let result = '', buffer = 0, bitsLeft = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bitsLeft += 8
    while (bitsLeft >= 5) {
      bitsLeft -= 5
      result += BASE32_ALPHABET[(buffer >> bitsLeft) & 31]
    }
  }
  if (bitsLeft > 0) result += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 31]
  return result
}

export async function onRequestPost({ request, env }) {
  // ── 1. 驗證 JWT ──────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const db     = env.chiyigo_db
  const ip     = request.headers.get('CF-Connecting-IP') ?? null

  // ── 1.5 Rate limit（防覆寫 totp_secret 的 setup spam）────────
  // 真正的 2FA 啟用閘門在 /activate（要密碼 + OTP），這層只是限制 secret 寫入頻率
  const { blocked } = await checkRateLimit(db, {
    kind: '2fa_setup', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX,
  })
  if (blocked) {
    return res({ error: 'Too many attempts. Please try again later.', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(db, { kind: '2fa_setup', userId, ip })

  // ── 2. 取得 local_account（確認使用本地密碼登入） ────────────
  const account = await db
    .prepare('SELECT totp_enabled FROM local_accounts WHERE user_id = ?')
    .bind(userId)
    .first()

  if (!account) return res({ error: 'Local account not found' }, 404)
  if (account.totp_enabled) return res({ error: '2FA is already enabled' }, 409)

  // ── 3. 取得 email（供 otpauth URI label 使用）────────────────
  const userRow = await db
    .prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first()

  // ── 4. 產生 TOTP Secret（160 bits / 20 bytes）────────────────
  // Secret.generate() 在 CF Workers 有相容性問題，改用 Web Crypto 自行生成
  const secret = Secret.fromBase32(generateBase32Secret(20))

  const totp = new TOTP({
    issuer:    env.TOTP_ISSUER ?? TOTP_ISSUER,
    label:     userRow?.email ?? String(userId),
    algorithm: 'SHA1',
    digits:    6,
    period:    30,
    secret,
  })

  // ── 5. 儲存 secret（base32），保持 totp_enabled=0 ─────────────
  await db
    .prepare('UPDATE local_accounts SET totp_secret = ? WHERE user_id = ?')
    .bind(secret.base32, userId)
    .run()

  return res({
    secret:      secret.base32,
    otpauth_uri: totp.toString(),
  })
}
