/**
 * POST /api/admin/payments/intents/:id/delete
 *
 * P0-1（金流憑證完整性，2026-05-06）：分流 hard delete vs anonymize。
 *
 *   pending / failed / canceled  → soft DELETE（寫 deleted_at；保留 row 給 webhook
 *                                  orphan 偵測，避免 PSP race 把錢吞掉漏帳）
 *   succeeded / processing / refunded → anonymize（保留 amount/vendor/date/user_id，
 *                                       清 metadata + failure_reason，metadata 寫
 *                                       anonymized_at + anonymized_by）
 *
 * Codex r1 P0-1（2026-05-13）：hard delete → soft delete。原本「未進帳可清」的假設
 * 在 ECPay 等不帶 user_id 的 webhook 下不成立——user/admin 刪了之後 PSP 仍可能
 * 補送 succeeded 通知；hard delete 後 webhook 找不到 row → 悄悄回 1|OK 把錢吞了。
 *
 * 為什麼不允許 succeeded/refunded hard delete：
 *   - 金流憑證（vendor_intent_id + amount + 時間）是法遵與對帳依據，一旦刪掉
 *     audit_log 只剩事件不剩憑證
 *   - 即使 admin token 外洩，也只能 anonymize 不能消滅憑證
 *
 * 認證：admin:payments scope + elevated:payment step-up
 */

import { res, requireStepUp } from '../../../../../utils/auth'
import { getCorsHeaders } from '../../../../../utils/cors'
import { SCOPES, effectiveScopesFromJwt } from '../../../../../utils/scopes'
import { getPaymentIntent, PAYMENT_STATUS } from '../../../../../utils/payments'
import { safeUserAudit } from '../../../../../utils/user-audit'

const SOFT_DELETABLE = new Set([
  PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELED,
])

// L1.1: refunded 是金流憑證的最終態（錢進來再退出去），與 succeeded 同等不可改動。
// 連 anonymize 都禁止 — 退款軌跡是合規 / dispute 的核心線索。
const LOCKED_STATUSES = new Set([
  PAYMENT_STATUS.REFUNDED,
])

export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
  const cors = getCorsHeaders(request, env)

  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_PAYMENT, 'delete_payment')
  if (stepCheck.error) return stepCheck.error

  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_PAYMENTS)) {
    return res({ error: 'admin:payments scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:payments' }, 403, cors)
  }

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found', code: 'INTENT_NOT_FOUND' }, 404, cors)

  const intent = await getPaymentIntent(env, { id })
  if (!intent) return res({ error: 'not_found', code: 'INTENT_NOT_FOUND' }, 404, cors)

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

  if (SOFT_DELETABLE.has(intent.status)) {
    // Codex r1 P0-1：soft delete 保留 row 給 webhook orphan 偵測（見檔頭說明）
    await env.chiyigo_db
      .prepare(`UPDATE payment_intents
                   SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ? AND deleted_at IS NULL`)
      .bind(id).run()
    mode = 'soft_delete'
  } else {
    // Anonymize：保留金流憑證骨幹，清除可能含敏感資訊的 metadata 與 failure_reason
    // T12: 先 archive 原始 metadata + failure_reason 到 cold storage，合規/dispute 用
    // Codex r10 P2-8：getPaymentIntent 已把 intent.metadata JSON.parse 成 object，
    // 直接 bind object 進 TEXT 欄位會被 D1 silently coerce（[object Object] 或行為
    // 視 driver 版本而定）→ archive 變死資料。明確 stringify 確保來源端 TEXT。
    const archivedMetadata = intent.metadata == null
      ? null
      : (typeof intent.metadata === 'string' ? intent.metadata : JSON.stringify(intent.metadata))
    await env.chiyigo_db
      .prepare(
        `INSERT INTO payment_metadata_archive
           (intent_id, original_status, original_metadata, original_failure_reason, archived_by, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, intent.status, archivedMetadata, intent.failure_reason ?? null,
            adminId, 'admin_anonymize')
      .run()

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
    event_type: mode === 'soft_delete'
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
