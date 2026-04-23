/**
 * POST /api/auth/delete
 * Header: Authorization: Bearer <access_token>
 * Body:   { password }
 *
 * 合規帳號刪除（GDPR / 資料主權）：
 *
 *  Hard Delete（個資完全消除）：
 *    local_accounts, backup_codes, refresh_tokens,
 *    email_verifications, password_resets, user_identities
 *
 *  Soft Delete（業務資料保留稽核軌跡）：
 *    requisition — 設定 deleted_at（欄位不存在時靜默跳過）
 *
 *  匿名化（允許相同 email 重新註冊）：
 *    users.email → 'deleted_<id>@deleted.invalid'
 *    users.deleted_at → 當前時間
 */

import { verifyPassword } from '../../utils/crypto.js'
import { requireAuth, res } from '../../utils/auth.js'

export async function onRequestPost({ request, env }) {
  // ── 1. 驗證 JWT ──────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  // ── 2. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { password } = body ?? {}
  if (!password) return res({ error: 'password is required' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // ── 3. 驗證當前密碼 ──────────────────────────────────────────
  const account = await db
    .prepare('SELECT password_hash, password_salt FROM local_accounts WHERE user_id = ?')
    .bind(userId)
    .first()

  if (!account) return res({ error: 'Account not found' }, 404)

  const valid = await verifyPassword(password, account.password_salt, account.password_hash)
  if (!valid)   return res({ error: 'Incorrect password' }, 401)

  // ── 4. 確認帳號未被刪除 ──────────────────────────────────────
  const userRow = await db
    .prepare('SELECT deleted_at FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow || userRow.deleted_at)
    return res({ error: 'Account not found' }, 404)

  // ── 5. 原子 Batch：Hard Delete 個資 + Soft Delete 業務資料 ──
  await db.batch([
    // Hard Delete：敏感個資完全清除
    db.prepare('DELETE FROM local_accounts      WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM backup_codes        WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM refresh_tokens      WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM password_resets     WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_identities     WHERE user_id = ?').bind(userId),

    // 匿名化 users：清除 email，設 deleted_at，允許同 email 重新註冊
    db.prepare(`
      UPDATE users
      SET email      = 'deleted_' || id || '@deleted.invalid',
          deleted_at = datetime('now')
      WHERE id = ?
    `).bind(userId),
  ])

  // ── 6. Soft Delete 業務資料（欄位不存在時靜默跳過）─────────
  try {
    await db
      .prepare(`UPDATE requisition SET deleted_at = datetime('now') WHERE owner_user_id = ?`)
      .bind(userId)
      .run()
  } catch {
    // requisition.deleted_at 或 owner_user_id 欄位尚未遷移，跳過
  }

  return res({ message: 'Account deleted successfully' })
}
