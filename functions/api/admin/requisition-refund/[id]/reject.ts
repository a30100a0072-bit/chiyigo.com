/**
 * POST /api/admin/requisition-refund/:id/reject
 *
 * Phase F-2 wave 7 — admin 拒絕退款申請。
 *
 * 認證：step-up + elevated:payment + for_action='reject_requisition_refund'。
 *   理由：雖然「拒絕」不動錢，但決定不退錢屬於金流相關決策，應留審計痕跡並走 step-up；
 *   也避免有人偷偷批一票拒絕讓 user 找不到管道處理。
 *
 * 行為：
 *   - refund_request.status='rejected' + admin_user_id + admin_note + decided_at
 *   - requisition.status 維持 'refund_pending'（讓 user 看得到狀態，可改聯絡客服）
 *   - payment_intent 不動
 *   - critical audit
 *
 * Body：optional { admin_note?: string }（建議填，方便追溯為何拒絕）
 */

import { res, requireStepUp } from '../../../../utils/auth'
import { getCorsHeaders } from '../../../../utils/cors'
import { SCOPES, effectiveScopesFromJwt } from '../../../../utils/scopes'
import { safeUserAudit } from '../../../../utils/user-audit'

export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
  const cors = getCorsHeaders(request, env)

  const stepCheck = await requireStepUp(
    request, env, SCOPES.ELEVATED_PAYMENT, 'reject_requisition_refund',
  )
  if (stepCheck.error) return stepCheck.error

  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_PAYMENTS)) {
    return res({ error: 'admin:payments scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:payments' }, 403, cors)
  }

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found', code: 'REFUND_REQUEST_NOT_FOUND' }, 404, cors)

  const db = env.chiyigo_db

  let body: { admin_note?: unknown } = {}
  try { body = await request.json() } catch { /* keep empty */ }
  const adminNote = String(body?.admin_note ?? '').slice(0, 500) || null

  // Codex r1 P1-6：atomic CAS。原本 SELECT 後再 UPDATE 中間有 race window
  // （同 rr_id 雙擊 approve+reject 互踩；單純 SELECT 不會擋住第二人的 UPDATE）。
  const rr = await db.prepare(`
    UPDATE requisition_refund_request
       SET status = 'rejected', admin_user_id = ?, admin_note = ?, decided_at = datetime('now')
     WHERE id = ? AND status = 'pending'
   RETURNING id, requisition_id, user_id, intent_id
  `).bind(Number(stepCheck.user.sub), adminNote, id).first()

  if (!rr) {
    // 區分 not_found vs already_decided（404 vs 409）
    const exists = await db
      .prepare(`SELECT status FROM requisition_refund_request WHERE id = ?`)
      .bind(id).first()
    if (!exists) return res({ error: 'not_found', code: 'REFUND_REQUEST_NOT_FOUND' }, 404, cors)
    return res({
      error: 'only pending refund requests can be rejected',
      code:  'INVALID_STATUS',
      actual_status: exists.status,
    }, 409, cors)
  }

  await safeUserAudit(env, {
    event_type: 'requisition.refund.rejected', severity: 'critical',
    user_id: rr.user_id, request,
    data: {
      refund_request_id: id,
      requisition_id:    rr.requisition_id,
      intent_id:         rr.intent_id,
      admin_note:        adminNote,
      admin_user_id:     Number(stepCheck.user.sub),
    },
  })

  return res({
    ok: true,
    refund_request_id: id,
    requisition_id:    rr.requisition_id,
    refund_request_status: 'rejected',
  }, 200, cors)
}
