/**
 * POST /api/admin/requisitions/:id/save
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * Phase F-2 wave 8 — admin 把 requisition 移到 deals 表（成交資料庫）。
 *
 * 流程：
 *   1. 撈 requisition；status 必須是 'pending'（已 deal/revoked/refund_pending 不能再保存）
 *   2. 撈所有綁定 payment_intent，加總 succeeded / refunded 金額
 *   3. INSERT into deals（快照當下客戶資料 + 付款摘要）
 *   4. UPDATE requisition.status='deal'
 *   5. TG editMessageText → 訊息 header 變 ✅ 已成交
 *   6. audit info
 *
 * 兩段式：前端要連點兩次（data-armed=1 才送 request）；後端不要求 step-up
 *   因為這純內部分類動作，不動錢；admin 自己防呆 OK。
 *
 * Body：optional { notes?: string }（最多 500 字）
 *
 * 回傳：
 *   200 → { ok: true, deal_id, requisition_id }
 *   404 → 找不到 requisition
 *   409 → status 不是 pending
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
    .prepare(`SELECT id, user_id, name, company, contact, service_type, budget, timeline, message, status
                FROM requisition WHERE id = ? AND deleted_at IS NULL`)
    .bind(id).first()
  if (!row) return res({ error: 'not_found' }, 404, cors)
  if (row.status !== 'pending') {
    return res({
      error: '只能保存 pending 狀態的需求單',
      code:  'INVALID_STATUS',
      actual_status: row.status,
    }, 409, cors)
  }

  let body = {}
  try { body = await request.json() } catch { /* keep empty */ }
  const notes = String(body?.notes ?? '').slice(0, 500) || null

  // 撈付款摘要：requisition_id FK（P0-3，2026-05-06 不再依賴 metadata LIKE）
  const intentsRes = await db
    .prepare(`SELECT id, status, amount_subunit, currency
                FROM payment_intents
               WHERE requisition_id = ?
               ORDER BY id ASC`)
    .bind(id).all()
  const intents = intentsRes?.results ?? []

  let totalSucceeded = 0, totalRefunded = 0, currency = 'TWD'
  for (const it of intents) {
    if (it.status === 'succeeded') totalSucceeded += Number(it.amount_subunit) || 0
    if (it.status === 'refunded')  totalRefunded  += Number(it.amount_subunit) || 0
    if (it.currency) currency = it.currency
  }
  const intentIds = intents.map(it => it.id)

  // INSERT into deals
  const inserted = await db
    .prepare(`INSERT INTO deals
               (source_requisition_id, user_id, customer_name, customer_contact,
                customer_company, service_type, budget, timeline, message,
                total_amount_subunit, refunded_amount_subunit, currency,
                payment_intent_ids, notes, saved_by_admin_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id`)
    .bind(
      row.id, row.user_id, row.name, row.contact,
      row.company || null, row.service_type, row.budget || null, row.timeline || null, row.message,
      totalSucceeded, totalRefunded, currency,
      intentIds.length ? JSON.stringify(intentIds) : null,
      notes, Number(user.sub),
    ).first()

  await db
    .prepare(`UPDATE requisition SET status = 'deal' WHERE id = ?`)
    .bind(id).run()

  await safeUserAudit(env, {
    event_type: 'requisition.saved_as_deal', severity: 'info',
    user_id: row.user_id, request,
    data: {
      requisition_id:  id,
      deal_id:         inserted?.id,
      total_succeeded: totalSucceeded,
      total_refunded:  totalRefunded,
      currency,
      payment_intent_ids: intentIds,
      admin_user_id:   Number(user.sub),
      notes,
    },
  })
  await syncRequisitionTgMessage(env, id)

  return res({
    ok: true,
    deal_id:        inserted?.id,
    requisition_id: id,
    requisition_status: 'deal',
  }, 200, cors)
}
