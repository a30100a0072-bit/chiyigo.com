/**
 * POST /api/auth/local/reset-password
 * Body: { token, new_password, totp_code? }
 *
 * 流程：
 *  1. 查 token（過期/已用 → 400）
 *  2. 若 totp_enabled=1 且未提供 totp_code → 403 { requires_2fa: true }
 *  3. 若 totp_enabled=1 且代碼驗證失敗 → 401
 *  4. 原子核銷 token（防並發重放）
 *  5. 更新密碼（新 salt + PBKDF2）
 *  6. DELETE 所有 refresh_tokens（登出所有裝置）
 */

import { TOTP, Secret } from 'otpauth'
import {
  hashToken,
  generateSalt,
  hashPassword,
  verifyBackupCode,
} from '../../../utils/crypto.js'
import { validatePassword } from '../../../utils/password.js'
import { bumpTokenVersion } from '../../../utils/auth.js'

export async function onRequestPost({ request, env }) {
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { token, new_password, totp_code } = body ?? {}

  if (!token || !new_password)
    return res({ error: 'token and new_password are required' }, 400)

  const pwCheck = validatePassword(new_password)
  if (!pwCheck.ok) return res({ error: pwCheck.error }, 400)

  const db        = env.chiyigo_db
  const tokenHash = await hashToken(token)

  // ── 1. 查 token（SELECT 確認有效，尚不核銷）─────────────────────
  const tokenRow = await db
    .prepare(`
      SELECT ev.user_id
      FROM   email_verifications ev
      WHERE  ev.token_hash  = ?
        AND  ev.token_type  = 'reset_password'
        AND  ev.used_at     IS NULL
        AND  ev.expires_at  > datetime('now')
    `)
    .bind(tokenHash)
    .first()

  if (!tokenRow) return res({ error: 'Token is invalid or has expired' }, 400)

  const userId = tokenRow.user_id

  // ── 2. 取得帳號資料（含 2FA 狀態）──────────────────────────────
  // LEFT JOIN：OAuth-only 用戶無 local_accounts，視為 totp_enabled=0
  const record = await db
    .prepare(`
      SELECT u.deleted_at, la.totp_secret, la.totp_enabled
      FROM   users u
      LEFT JOIN local_accounts la ON la.user_id = u.id
      WHERE  u.id = ?
    `)
    .bind(userId)
    .first()

  if (!record || record.deleted_at) return res({ error: 'Account not found' }, 400)

  // ── 3. 2FA 閉環 ──────────────────────────────────────────────
  if (record.totp_enabled === 1) {
    if (!totp_code)
      return res({ requires_2fa: true, error: '2FA verification required' }, 403)

    const sanitized = totp_code.replace(/[\s-]/g, '')
    let passed = false

    // 3a. TOTP（6 位數字）
    if (/^\d{6}$/.test(sanitized)) {
      const totp  = new TOTP({
        algorithm: 'SHA1',
        digits:    6,
        period:    30,
        secret:    Secret.fromBase32(record.totp_secret),
      })
      passed = totp.validate({ token: sanitized, window: 1 }) !== null
    }

    // 3b. 備用救援碼（20 hex chars）
    if (!passed && /^[0-9a-f]{20}$/i.test(sanitized)) {
      const codes = await db
        .prepare('SELECT id, code_hash FROM backup_codes WHERE user_id = ? AND used_at IS NULL')
        .bind(userId)
        .all()

      for (const code of codes.results ?? []) {
        if (await verifyBackupCode(sanitized, code.code_hash)) {
          const revoked = await db
            .prepare(`
              UPDATE backup_codes SET used_at = datetime('now')
              WHERE id = ? AND used_at IS NULL
            `)
            .bind(code.id)
            .run()
          if (revoked.meta?.changes > 0) { passed = true; break }
        }
      }
    }

    if (!passed) return res({ error: 'Invalid 2FA code' }, 401)
  }

  // ── 4. 原子核銷 token（防並發重放）───────────────────────────
  const consumed = await db
    .prepare(`
      UPDATE email_verifications
      SET    used_at = datetime('now')
      WHERE  token_hash = ?
        AND  token_type = 'reset_password'
        AND  used_at    IS NULL
        AND  expires_at > datetime('now')
      RETURNING user_id
    `)
    .bind(tokenHash)
    .first()

  if (!consumed) return res({ error: 'Token is invalid or has expired' }, 400)

  // ── 5. UPSERT 密碼（新 salt + PBKDF2；OAuth-only 用戶首次建立密碼）──
  const newSalt = generateSalt()
  const newHash = await hashPassword(new_password, newSalt)

  await db
    .prepare(`
      INSERT INTO local_accounts (user_id, password_hash, password_salt, totp_enabled)
      VALUES (?, ?, ?, 0)
      ON CONFLICT(user_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt
    `)
    .bind(userId, newHash, newSalt)
    .run()

  // ── 6. 撤銷所有 refresh_tokens + bump token_version（access token 全域失效）─
  await db
    .prepare('DELETE FROM refresh_tokens WHERE user_id = ?')
    .bind(userId)
    .run()
  await bumpTokenVersion(db, userId)

  return res({ message: 'Password reset successfully. Please log in again.' })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
