/**
 * POST /api/requisition/revoke
 * Header: Authorization: Bearer <access_token>
 * Body: { requisition_id }
 *
 * 撤銷需求單（僅限 status='pending' 且屬於自己的單）。
 * 防護：
 *  - IDOR：查詢時加 user_id 條件
 *  - 狀態機：非 pending 狀態回傳 403
 * 副作用：呼叫 Telegram editMessageText 覆蓋原訊息
 */

import { requireAuth, res } from '../../utils/auth.js'

async function editTelegramMessage(env, messageId, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !messageId) return
  try {
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          chat_id:    env.TELEGRAM_CHAT_ID,
          message_id: messageId,
          text,
          parse_mode: 'HTML',
        }),
      }
    )
  } catch { /* TG 失敗不影響 DB 狀態 */ }
}

export async function onRequestPost({ request, env }) {
  // ── 1. JWT 驗證 ───────────────────────────────────────────────
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { requisition_id } = body ?? {}
  if (!requisition_id) return res({ error: 'requisition_id is required' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // ── 2. 查單（IDOR 防禦：加 user_id 條件）────────────────────
  const row = await db
    .prepare(`
      SELECT id, status, tg_message_id
      FROM   requisition
      WHERE  id = ? AND user_id = ? AND deleted_at IS NULL
    `)
    .bind(Number(requisition_id), userId)
    .first()

  if (!row) return res({ error: '找不到該需求單' }, 404)

  // ── 3. 狀態機鎖定：僅 pending 可撤銷 ─────────────────────────
  if (row.status !== 'pending')
    return res({ error: '此單已在處理中，無法撤銷' }, 403)

  // ── 4. 軟刪除 + 狀態更新 ─────────────────────────────────────
  await db
    .prepare(`
      UPDATE requisition
      SET    status = 'revoked', deleted_at = CURRENT_TIMESTAMP
      WHERE  id = ? AND user_id = ?
    `)
    .bind(row.id, userId)
    .run()

  // ── 5. Telegram 精準擊殺（editMessageText）───────────────────
  const warningText =
    `❌ <b>警告：客戶已撤銷此需求單！</b>\n(原單號: #${row.id})`
  await editTelegramMessage(env, row.tg_message_id, warningText)

  return res({ ok: true, id: row.id })
}
