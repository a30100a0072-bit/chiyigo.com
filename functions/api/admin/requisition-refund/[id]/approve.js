/**
 * POST /api/admin/requisition-refund/:id/approve
 *
 * Phase F-2 wave 7 — admin 通過退款申請。
 *
 * 認證：
 *   1. step-up token 帶 elevated:payment + for_action='approve_requisition_refund'
 *      （金流動作；admin 一般 access_token 不能批准，避免 token 外洩 = 全批准）
 *   2. step-up token user 必須是 admin role（透過 effective scopes admin:requisitions /
 *      admin:payments 任一即可，沿用既有 pattern；step-up token 是 admin 換來的）
 *
 * 流程：
 *   1. 找 refund_request；status 必須是 pending
 *   2. 找對應的 payment_intent；status 必須是 succeeded、vendor='ecpay'（目前唯一支援）
 *   3. 從 payment_webhook_events 撈 ECPay TradeNo
 *   4. call ecpayRefund Action='R' 全額
 *   5. 成功 → UPDATE intent.status='refunded' + requisition.status='revoked' + deleted_at
 *           + refund_request.status='approved' + admin_user_id + decided_at + admin_note
 *           + critical audit
 *   6. 失敗 → audit warn + 不改任何 status，回 400
 *
 * Body：optional { admin_note?: string }（最多 500 字）
 */

import { res, requireStepUp } from '../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../utils/cors'
import { SCOPES, effectiveScopesFromJwt } from '../../../../utils/scopes'
import {
  getPaymentIntent, updatePaymentStatus, PAYMENT_STATUS,
  lockIntentForRefund, unlockIntentToSucceeded,
} from '../../../../utils/payments.js'
import { ecpayRefund } from '../../../../utils/payment-vendors/ecpay.js'
import { safeUserAudit } from '../../../../utils/user-audit'
import { DEBUG_REASON_CODES } from '../../../../utils/audit-aggregate-debug.js'
import { syncRequisitionTgMessage } from '../../../../utils/tg-requisition'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env, params }) {
  const cors = getCorsHeaders(request, env)

  const stepCheck = await requireStepUp(
    request, env, SCOPES.ELEVATED_PAYMENT, 'approve_requisition_refund',
  )
  if (stepCheck.error) return stepCheck.error

  // P1-17：fine-grain admin:payments:refund（coarse admin:payments token 仍通過 hierarchy）
  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_PAYMENTS_REFUND)) {
    return res({ error: 'admin:payments:refund scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:payments:refund' }, 403, cors)
  }

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found', code: 'REFUND_REQUEST_NOT_FOUND' }, 404, cors)

  const db = env.chiyigo_db

  const rr = await db
    .prepare(`SELECT * FROM requisition_refund_request WHERE id = ?`)
    .bind(id).first()
  if (!rr) return res({ error: 'not_found', code: 'REFUND_REQUEST_NOT_FOUND' }, 404, cors)
  if (rr.status !== 'pending') {
    return res({
      error: 'only pending refund requests can be approved',
      code:  'INVALID_STATUS',
      actual_status: rr.status,
    }, 409, cors)
  }

  const intent = rr.intent_id ? await getPaymentIntent(env, { id: rr.intent_id }) : null
  if (!intent) return res({ error: 'linked intent not found', code: 'LINKED_INTENT_NOT_FOUND' }, 404, cors)
  if (intent.status !== PAYMENT_STATUS.SUCCEEDED) {
    return res({
      error: 'linked intent is not in succeeded status',
      code:  'INTENT_INVALID_STATUS',
      actual_status: intent.status,
    }, 409, cors)
  }
  if (intent.vendor !== 'ecpay') {
    return res({ error: `refund not implemented for vendor: ${intent.vendor}`, code: 'REFUND_NOT_IMPLEMENTED' }, 400, cors)
  }

  let body = {}
  try { body = await request.json() } catch { /* keep empty */ }
  const adminNote = String(body?.admin_note ?? '').slice(0, 500) || null

  // P0-10：優先讀 intent.metadata.trade_no（webhook succeeded 時寫入）；
  // 沒有時 fallback 到 payment_webhook_events，相容歷史 row。
  let tradeNo = intent.metadata?.trade_no ?? null
  if (!tradeNo) {
    const eventRow = await db
      .prepare(
        `SELECT event_id FROM payment_webhook_events
          WHERE vendor = ? AND intent_id = ? AND status_to = ?
          ORDER BY processed_at DESC LIMIT 1`,
      )
      .bind('ecpay', intent.id, PAYMENT_STATUS.SUCCEEDED)
      .first()
    tradeNo = eventRow?.event_id && !/_\d+$/.test(eventRow.event_id)
      ? eventRow.event_id
      : null
  }
  if (!tradeNo) {
    return res({ error: 'TradeNo not found; cannot call refund API', code: 'TRADE_NO_NOT_FOUND' }, 400, cors)
  }

  // Codex r1 P1-6：rr atomic claim — pending → processing。
  // 原本 SELECT 過 pending 後一路跑到最後 UPDATE，中間 race window 大；尤其
  // approve+reject 同 rr_id 雙擊會互踩（reject 會悄悄把已 approved 蓋回 rejected）。
  // 改成先 atomic CAS 把 rr 鎖到 transient 'processing'：成功才接著走 intent lock /
  // ECPay；任何失敗都把 rr 還原回 pending（網路 throw 例外，留 processing 等對帳）。
  const claim = await db.prepare(`
    UPDATE requisition_refund_request
       SET status = 'processing', admin_user_id = ?, decided_at = datetime('now')
     WHERE id = ? AND status = 'pending'
   RETURNING id
  `).bind(Number(stepCheck.user.sub), id).first()
  if (!claim) {
    return res({
      error: 'refund request already decided or claimed by another admin',
      code:  'REFUND_REQUEST_CLAIM_LOST',
    }, 409, cors)
  }
  // 失敗時把 rr 還原回 pending（admin_user_id / decided_at 同步清空）；caller 仍可重試。
  const releaseRrClaim = async () => {
    await db.prepare(`
      UPDATE requisition_refund_request
         SET status = 'pending', admin_user_id = NULL, decided_at = NULL
       WHERE id = ? AND status = 'processing'
    `).bind(id).run()
  }

  // P0-7 atomic lock：與 admin/payments/intents/:id/refund 共用 helper，
  // 雙路徑（approve / 直接退款）競態下只有一個能拿到鎖，第二個 409。
  const lock = await lockIntentForRefund(env, intent.id)
  if (!lock.ok) {
    await releaseRrClaim()
    return res({
      error: 'intent is being processed or no longer succeeded',
      code:  'INTENT_RACE_CONFLICT',
    }, 409, cors)
  }

  // P1-9：ecpayRefund fetch throw（網路 / DNS / TLS）→ ECPay 端可能已退款也可能沒退，
  // 我方 intent 已被 lockIntentForRefund 標 'processing'。不能 unlock 回 succeeded
  // （否則第二次按又會打一次 ECPay → 可能重複退）；保留 processing 等對帳 cron 處理。
  let refundResult
  try {
    refundResult = await ecpayRefund(env, {
      merchantTradeNo: intent.vendor_intent_id,
      tradeNo,
      totalAmount:     intent.amount_subunit,
      action:          'R',
    })
  } catch (e) {
    await safeUserAudit(env, {
      event_type: 'requisition.refund.network_error', severity: 'critical',
      user_id: rr.user_id, request,
      data: {
        reason_code:       DEBUG_REASON_CODES.VENDOR_CALL_THREW,
        refund_request_id: id,
        requisition_id:    rr.requisition_id,
        intent_id:         intent.id,
        vendor_intent_id:  intent.vendor_intent_id,
        trade_no:          tradeNo,
        admin_user_id:     Number(stepCheck.user.sub),
        error:             String(e?.message ?? e).slice(0, 500),
      },
    })
    return res({
      error: 'ECPay refund call failed (network); intent left in processing for reconciliation',
      code:  'REFUND_PENDING_RECONCILIATION',
    }, 502, cors)
  }

  if (!refundResult.ok) {
    await unlockIntentToSucceeded(env, intent.id)
    await releaseRrClaim()
    await safeUserAudit(env, {
      event_type: 'requisition.refund.fail', severity: 'warn',
      user_id: rr.user_id, request,
      data: {
        reason_code:       DEBUG_REASON_CODES.VENDOR_REJECTED,
        error_code:        refundResult.rtn_code,
        refund_request_id: id,
        requisition_id:    rr.requisition_id,
        intent_id:         intent.id,
        rtn_code:          refundResult.rtn_code,
        rtn_msg:           refundResult.rtn_msg,
        admin_user_id:     Number(stepCheck.user.sub),
      },
    })
    return res({
      error:    'ECPay refund failed',
      code:     'ECPAY_REFUND_FAILED',
      rtn_code: refundResult.rtn_code,
      rtn_msg:  refundResult.rtn_msg,
    }, 400, cors)
  }

  // 成功 → 三表同步更新
  await updatePaymentStatus(env, {
    vendor:           'ecpay',
    vendor_intent_id: intent.vendor_intent_id,
    status:           PAYMENT_STATUS.REFUNDED,
    failure_reason:   adminNote ? `refund (req approval): ${adminNote}` : 'refund (req approval)',
  })

  // requisition_id 可能為 NULL（user 對未綁需求單的 succeeded payment 直接申請退款）
  if (rr.requisition_id) {
    await db.prepare(`
      UPDATE requisition
         SET status = 'revoked', deleted_at = CURRENT_TIMESTAMP
       WHERE id = ?
    `).bind(rr.requisition_id).run()
  }

  // Codex r1 P1-6：final transition 也 CAS 守 — 只能從 'processing'（自己剛 claim 的）
  // 推進到 approved；若被其他流程動過則保留現狀。
  // Codex r6 P1：check changes === 1。ECPay 已成功、intent + requisition 都更新了，
  // 但 final CAS 落空表示 rr 已被別人動過（不該發生）→ critical audit 留證，
  // 讓對帳 cron / admin 透過 reconciliation 報表接手。
  const finalCas = await db.prepare(`
    UPDATE requisition_refund_request
       SET status = 'approved', admin_note = ?
     WHERE id = ? AND status = 'processing' AND admin_user_id = ?
  `).bind(adminNote, id, Number(stepCheck.user.sub)).run()
  const finalChanges = finalCas?.meta?.changes ?? 0

  if (finalChanges !== 1) {
    // Codex r8 P2：final CAS 落空 — ECPay 退款 + intent + requisition 都已成功
    // 改動，但 rr row 仍卡在 'processing'（或被其他流程意外推進）。不可寫
    // requisition.refund.approved 否則 UI / audit 兩邊不一致；改回 reconciliation
    // 專屬 response + critical audit，讓對帳 cron / admin 接手。
    await safeUserAudit(env, {
      event_type: 'requisition.refund.final_cas_lost',
      severity:   'critical',
      user_id:    rr.user_id, request,
      data: {
        reason_code:       DEBUG_REASON_CODES.FINAL_CAS_MISSED,
        refund_request_id: id,
        intent_id:         intent.id,
        vendor_intent_id:  intent.vendor_intent_id,
        amount_subunit:    intent.amount_subunit,
        currency:          intent.currency,
        admin_user_id:     Number(stepCheck.user.sub),
        note:              'ECPay refund succeeded + intent refunded but rr final CAS missed; manual reconciliation required',
      },
    })
    // 仍 TG sync — requisition.status 已是 revoked，UI 不能顯示 pending 退款
    if (rr.requisition_id) await syncRequisitionTgMessage(env, rr.requisition_id)
    return res({
      ok: false,
      code:               'REFUND_RECONCILIATION_REQUIRED',
      refund_request_id:  id,
      requisition_id:     rr.requisition_id,
      intent_status:      PAYMENT_STATUS.REFUNDED,
      requisition_status: rr.requisition_id ? 'revoked' : null,
      note: 'ECPay refund executed; refund_request row needs manual reconciliation',
    }, 202, cors)
  }

  await safeUserAudit(env, {
    event_type: 'requisition.refund.approved', severity: 'critical',
    user_id: rr.user_id, request,
    data: {
      refund_request_id: id,
      requisition_id:    rr.requisition_id,
      intent_id:         intent.id,
      vendor_intent_id:  intent.vendor_intent_id,
      amount_subunit:    intent.amount_subunit,
      currency:          intent.currency,
      admin_note:        adminNote,
      admin_user_id:     Number(stepCheck.user.sub),
    },
  })
  // TG sync（refunded 狀態納入摘要）
  if (rr.requisition_id) await syncRequisitionTgMessage(env, rr.requisition_id)

  return res({
    ok: true,
    refund_request_id: id,
    requisition_id:    rr.requisition_id,
    intent_status:     PAYMENT_STATUS.REFUNDED,
    requisition_status: rr.requisition_id ? 'revoked' : null,
  }, 200, cors)
}
