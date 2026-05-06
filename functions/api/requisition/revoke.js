/**
 * POST /api/requisition/revoke
 * Header: Authorization: Bearer <access_token>
 * Body: { requisition_id, reason? }
 *
 * 撤銷需求單。狀態必須是 'pending'，且屬於自己的單。
 *
 * 兩條路（Phase F-2 wave 7）：
 *   (A) 沒有 succeeded payment_intent → 直接 revoke（同舊行為）
 *   (B) 有 succeeded payment_intent   → 不直接撤；建一筆 requisition_refund_request
 *       + requisition.status='refund_pending'，等 admin 審核退款
 *
 * 防護：
 *   - IDOR：查詢時加 user_id 條件
 *   - 狀態機：非 pending 狀態回傳 403
 *   - 已付款：強制走退款申請流程，避免「進帳但業務單 revoked」帳務黑洞
 *   - 已付款分支需要 reason（min 1 char），便於 admin 審核
 */

import { requireAuth, res } from '../../utils/auth.js'
import { safeUserAudit } from '../../utils/user-audit.js'
import { syncRequisitionTgMessage } from '../../utils/tg-requisition.js'

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
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { requisition_id, reason } = body ?? {}
  if (!requisition_id) return res({ error: 'requisition_id is required' }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  const row = await db
    .prepare(`
      SELECT id, status, tg_message_id
      FROM   requisition
      WHERE  id = ? AND user_id = ? AND deleted_at IS NULL
    `)
    .bind(Number(requisition_id), userId)
    .first()

  if (!row) return res({ error: '找不到該需求單' }, 404)
  if (row.status !== 'pending')
    return res({ error: '此單已在處理中，無法撤銷', status: row.status }, 403)

  // 找這張單關聯的 succeeded payment_intent（最新一筆）
  // P0-3: 用 requisition_id FK（2026-05-06）
  const paidIntent = await db
    .prepare(`
      SELECT id, vendor, amount_subunit, currency
      FROM   payment_intents
      WHERE  user_id = ? AND status = 'succeeded' AND requisition_id = ?
      ORDER  BY id DESC
      LIMIT  1
    `)
    .bind(userId, row.id)
    .first()

  // ── 分支 B：已付款 → 走 refund_request ─────────────────────
  if (paidIntent) {
    const trimmed = String(reason ?? '').trim()
    if (!trimmed) {
      return res({
        error: '已付款需求單需填寫退款原因',
        code:  'REASON_REQUIRED',
        intent_id: paidIntent.id,
        amount_subunit: paidIntent.amount_subunit,
        currency: paidIntent.currency,
      }, 400)
    }
    const reasonClipped = trimmed.slice(0, 500)

    // 防重複申請：同 requisition 已有 pending refund_request 直接 409
    const existing = await db
      .prepare(`SELECT id FROM requisition_refund_request
                 WHERE requisition_id = ? AND status = 'pending' LIMIT 1`)
      .bind(row.id).first()
    if (existing) {
      return res({
        error: '此單已申請退款，請等候 admin 審核',
        code:  'REFUND_ALREADY_PENDING',
        refund_request_id: existing.id,
      }, 409)
    }

    // P2-4: backfill amount_subunit（為部分退款留路；目前 = 全額）
    const inserted = await db
      .prepare(`INSERT INTO requisition_refund_request
                 (requisition_id, user_id, intent_id, reason, amount_subunit)
                 VALUES (?, ?, ?, ?, ?)
                 RETURNING id`)
      .bind(row.id, userId, paidIntent.id, reasonClipped, paidIntent.amount_subunit ?? null)
      .first()

    await db
      .prepare(`UPDATE requisition SET status = 'refund_pending'
                 WHERE id = ? AND user_id = ?`)
      .bind(row.id, userId).run()

    await safeUserAudit(env, {
      event_type: 'requisition.refund.requested', severity: 'warn',
      user_id: userId, request,
      data: {
        requisition_id:    row.id,
        refund_request_id: inserted?.id,
        intent_id:         paidIntent.id,
        amount_subunit:    paidIntent.amount_subunit,
        currency:          paidIntent.currency,
        reason:            reasonClipped,
      },
    })
    // TG 訊息同步到 refund_pending 狀態
    await syncRequisitionTgMessage(env, row.id)

    return res({
      ok: true,
      code: 'REFUND_REQUESTED',
      refund_request_id: inserted?.id,
      requisition_status: 'refund_pending',
    })
  }

  // ── 分支 A：沒付款 → 直接 revoke（舊行為）────────────────
  await db
    .prepare(`
      UPDATE requisition
      SET    status = 'revoked', deleted_at = CURRENT_TIMESTAMP
      WHERE  id = ? AND user_id = ?
    `)
    .bind(row.id, userId)
    .run()

  const warningText =
    `❌ <b>警告：客戶已撤銷此需求單！</b>\n(原單號: #${row.id})`
  await editTelegramMessage(env, row.tg_message_id, warningText)

  return res({ ok: true, id: row.id })
}
