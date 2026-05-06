/**
 * POST /api/admin/payments/intents/:id/delete
 *
 * P0-1（金流憑證完整性，2026-05-06）：分流 hard delete vs anonymize。
 *
 *   pending / failed / canceled  → hard DELETE（從未進帳或從未成功，可清）
 *   succeeded / processing / refunded → anonymize（保留 amount/vendor/date/user_id，
 *                                       清 metadata + failure_reason，metadata 寫
 *                                       anonymized_at + anonymized_by）
 *
 * 為什麼不允許 succeeded/refunded hard delete：
 *   - 金流憑證（vendor_intent_id + amount + 時間）是法遵與對帳依據，一旦刪掉
 *     audit_log 只剩事件不剩憑證
 *   - 即使 admin token 外洩，也只能 anonymize 不能消滅憑證
 *
 * 認證：admin:payments scope + elevated:payment step-up
 */

import { res, requireStepUp } from '../../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../../utils/cors.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../../../utils/scopes.js'
import { getPaymentIntent, PAYMENT_STATUS } from '../../../../../utils/payments.js'
import { safeUserAudit } from '../../../../../utils/user-audit.js'

const HARD_DELETABLE = new Set([
  PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELED,
])

// L1.1: refunded 是金流憑證的最終態（錢進來再退出去），與 succeeded 同等不可改動。
// 連 anonymize 都禁止 — 退款軌跡是合規 / dispute 的核心線索。
const LOCKED_STATUSES = new Set([
  PAYMENT_STATUS.REFUNDED,
])

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env, params }) {
  const cors = getCorsHeaders(request, env)

  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_PAYMENT, 'delete_payment')
  if (stepCheck.error) return stepCheck.error

  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_PAYMENTS)) {
    return res({ error: 'admin:payments scope required' }, 403, cors)
  }

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404, cors)

  const intent = await getPaymentIntent(env, { id })
  if (!intent) return res({ error: 'not_found' }, 404, cors)

  // 鎖死狀態：refunded 不可被任何形式刪除/匿名化
  if (LOCKED_STATUSES.has(intent.status)) {
    return res({
      error: '此狀態為金流憑證最終態，不可刪除或匿名化',
      code:  'STATUS_LOCKED',
      status: intent.status,
    }, 409, cors)
  }

  const adminId = Number(stepCheck.user.sub)
  let mode

  if (HARD_DELETABLE.has(intent.status)) {
    await env.chiyigo_db
      .prepare('DELETE FROM payment_intents WHERE id = ?')
      .bind(id).run()
    mode = 'hard_delete'
  } else {
    // Anonymize：保留金流憑證骨幹，清除可能含敏感資訊的 metadata 與 failure_reason
    const anonMeta = JSON.stringify({
      anonymized_at: new Date().toISOString(),
      anonymized_by: adminId,
      original_status: intent.status,
    })
    await env.chiyigo_db
      .prepare(
        `UPDATE payment_intents
            SET metadata = ?,
                failure_reason = NULL,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ?`,
      )
      .bind(anonMeta, id).run()
    mode = 'anonymize'
  }

  await safeUserAudit(env, {
    event_type: mode === 'hard_delete'
      ? 'payment.intent.deleted'
      : 'payment.intent.anonymized',
    severity: 'critical',
    user_id: intent.user_id, request,
    data: {
      intent_id:        id,
      vendor:           intent.vendor,
      vendor_intent_id: intent.vendor_intent_id,
      status_was:       intent.status,
      amount_subunit:   intent.amount_subunit,
      mode,
      actor:            'admin',
      admin_user_id:    adminId,
    },
  })

  return res({ ok: true, id, mode }, 200, cors)
}
