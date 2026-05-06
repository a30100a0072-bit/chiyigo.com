/**
 * POST /api/admin/requisitions/:id/delete
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * Phase F-2 wave 8 — admin 強刪 requisition row（hard delete）。
 *
 * 流程：
 *   1. 撈 requisition；不限 status（已 deal / revoked / refund_pending / pending 都可刪）
 *      —— admin 清單管理需求；要保留歷史的應該走「保存」走 deals 表
 *   2. TG editMessageText → 訊息 header 變 🗑 admin 已刪除（在 hard delete 前先 sync 拿原 row）
 *   3. DELETE FROM requisition
 *   4. audit critical（含原 row 完整內容；之後追溯靠 audit）
 *
 * 兩段式：前端兩次點擊；後端不要求 step-up（同 save）。
 *   ⚠️ 若 requisition 還有 payment_intents.status='succeeded' 但沒退款 → 砍了 = 帳務黑洞。
 *      後端拒絕：先要求走 user 的退款流程或 admin/payments/intents 處理。
 *
 * Body：optional { confirm: true, notes?: string }
 */

import { res } from '../../../../utils/auth.js'
import { requireRole } from '../../../../utils/requireRole.js'
import { getCorsHeaders } from '../../../../utils/cors.js'
import { safeUserAudit } from '../../../../utils/user-audit.js'
import { syncRequisitionTgMessage } from '../../../../utils/tg-requisition.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env, params }) {
  const cors = getCorsHeaders(request, env)
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404, cors)

  const db = env.chiyigo_db
  const row = await db
    .prepare(`SELECT * FROM requisition WHERE id = ?`)
    .bind(id).first()
  if (!row) return res({ error: 'not_found' }, 404, cors)

  // 防帳務黑洞：若還有 succeeded 但未退款的 payment_intent → 拒絕
  const reqIdStr  = `"requisition_id":${id}`
  const reqIdStr2 = `"requisition_id":"${id}"`
  const paid = await db
    .prepare(`SELECT id, amount_subunit, currency FROM payment_intents
               WHERE status = 'succeeded'
                 AND (metadata LIKE ? OR metadata LIKE ?)
               LIMIT 1`)
    .bind(`%${reqIdStr}%`, `%${reqIdStr2}%`).first()
  if (paid) {
    return res({
      error: '此需求單仍有未退款的成功付款，請先退款再刪除',
      code:  'HAS_UNREFUNDED_PAYMENT',
      intent_id: paid.id,
      amount_subunit: paid.amount_subunit,
      currency: paid.currency,
    }, 409, cors)
  }

  let body = {}
  try { body = await request.json() } catch { /* keep empty */ }
  const notes = String(body?.notes ?? '').slice(0, 500) || null

  // 先 sync TG 蓋訊息為「Admin 已刪除」（DB row 還在，syncRequisitionTgMessage 用 overrideStatus）
  await syncRequisitionTgMessage(env, id, 'deleted')

  await db.prepare(`DELETE FROM requisition WHERE id = ?`).bind(id).run()

  await safeUserAudit(env, {
    event_type: 'requisition.admin_deleted', severity: 'critical',
    user_id: row.user_id, request,
    data: {
      requisition_id: id,
      original_row:   row,
      admin_user_id:  Number(user.sub),
      notes,
    },
  })

  return res({ ok: true, id }, 200, cors)
}
