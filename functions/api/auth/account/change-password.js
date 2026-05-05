/**
 * POST /api/auth/account/change-password
 * Header: Authorization: Bearer <step_up_token>
 *         scope=elevated:account, for_action='change_password'
 * Body:   { new_password }
 *
 * Phase C-3 改造：In-session 改密碼（不必走 forgot-password email link）。
 *
 * 流程：
 *   1. Client 已登入（access_token 有效）
 *   2. Client → POST /api/auth/step-up { scope: 'elevated:account',
 *      for_action: 'change_password', otp_code }
 *      → 拿到 5min 短效 step_up_token
 *   3. Client → POST /api/auth/account/change-password
 *      Authorization: Bearer <step_up_token>
 *      { new_password }
 *      → 200，舊 token 全失效（bumpTokenVersion），需重新登入
 *
 * 為什麼不直接 access_token + 舊密碼：
 *   - 舊密碼可能被 keylogger / shoulder surf 拿到，攻擊者跟正主同時持有
 *   - step-up flow 強制當下 OTP，OTP 是 30s window 短效，攻擊面顯著縮小
 *   - 對齊金融級規格（Phase 0 §0-4：account 變更 → elevated:* scope）
 *
 * 後置：
 *   - bumpTokenVersion 撤所有 token → 強制重新登入（一般 access + step_up_token 都廢）
 *   - audit log `account.password.change` severity=warn
 *   - 不寄通知信（暫不做；未來 Phase E1 risk-based 才接）
 *
 * 與 reset-password.js 區別：
 *   reset-password = 忘記密碼（email link 替代驗證）
 *   change-password = 知道密碼想換（step-up 替代驗證）
 */

import { generateSalt, hashPassword } from '../../../utils/crypto.js'
import { validatePassword } from '../../../utils/password.js'
import { requireStepUp, bumpTokenVersion, res } from '../../../utils/auth.js'
import { SCOPES } from '../../../utils/scopes.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

export async function onRequestPost({ request, env }) {
  // step-up 守門：驗 step_up_token + scope=elevated:account + for_action=change_password
  // requireStepUp 內部已 revokeJti（一次性）+ 嚴格 scope（不走 role fallback）
  const { user, error } = await requireStepUp(
    request, env, SCOPES.ELEVATED_ACCOUNT, 'change_password',
  )
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { new_password } = body ?? {}
  if (!new_password) return res({ error: 'new_password is required' }, 400)

  const pwCheck = validatePassword(new_password)
  if (!pwCheck.ok) return res({ error: pwCheck.error }, 400)

  const userId = Number(user.sub)
  if (!Number.isFinite(userId)) return res({ error: 'Invalid token subject' }, 401)

  const db = env.chiyigo_db

  // 確認帳號仍有效
  const userRow = await db
    .prepare(`SELECT status FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(userId).first()
  if (!userRow) return res({ error: 'User not found' }, 404)
  if (userRow.status === 'banned') return res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403)

  // 換密碼（UPSERT 支援 OAuth-only 帳號首次設定密碼）
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

  // 撤所有 refresh + bump token_version：所有 access token 立即失效
  // 包含 step_up_token 本身（jti 已 revoked + token_version 也對不上）
  await bumpTokenVersion(db, userId)

  await safeUserAudit(env, {
    event_type: 'account.password.change', severity: 'warn',
    user_id: userId, request, data: { via: 'step_up' },
  })

  return res({ message: 'Password changed successfully. Please log in again.' })
}
