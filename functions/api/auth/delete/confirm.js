// POST /api/auth/delete/confirm
// Step 2 of 2: consume the emailed token and permanently delete the account.
// No JWT required — the token itself proves authorization.

import { hashToken } from '../../../utils/crypto.js'
import { res } from '../../../utils/auth.js'

export async function onRequestPost({ request, env }) {
  // ── 1. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { token } = body ?? {}
  if (!token) return res({ error: 'token is required' }, 400)

  const db        = env.chiyigo_db
  const tokenHash = await hashToken(token)

  // ── 2. 查找有效的刪除 Token ───────────────────────────────────
  const record = await db
    .prepare(`
      SELECT user_id FROM email_verifications
      WHERE token_hash = ?
        AND token_type = 'delete_account'
        AND expires_at > datetime('now')
      LIMIT 1
    `)
    .bind(tokenHash)
    .first()

  if (!record) return res({ error: 'Invalid or expired deletion token' }, 400)

  const userId = record.user_id

  // ── 3. 確認帳號仍為有效狀態 ──────────────────────────────────
  const userRow = await db
    .prepare('SELECT deleted_at FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow || userRow.deleted_at)
    return res({ error: 'Account not found or already deleted' }, 404)

  // ── 4. 先消耗 Token（防重放攻擊）────────────────────────────
  await db.prepare('DELETE FROM email_verifications WHERE token_hash = ?').bind(tokenHash).run()

  // ── 5. 原子 Batch：Hard Delete 個資 + 匿名化 users ──────────
  await db.batch([
    db.prepare('DELETE FROM local_accounts      WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM backup_codes        WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM refresh_tokens      WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM password_resets     WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_identities     WHERE user_id = ?').bind(userId),
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
  } catch { /* column may not exist yet */ }

  return res({ message: 'Account deleted successfully' })
}
