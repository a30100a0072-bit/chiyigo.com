/**
 * GET /api/admin/payments/metadata-archive?intent_id=N
 * Header: Authorization: Bearer <step_up_token>
 * Required: elevated:payment + admin:payments scope
 *
 * T12（金流邏輯強化計畫，2026-05-06）— 查 anonymize 前的 metadata snapshot。
 *
 * 為什麼要 step-up：
 *   - archive 內含原始 metadata，可能有 user 個資 / 訂單細節
 *   - 一般 admin token 外洩不該能直接抓出來，必須臨時 OTP
 *
 * Audit：每次查詢 critical（誰看了哪筆 archive）
 *
 * Query：intent_id=N（必填）
 * 回傳：{ rows: [...] }
 */

import { res, requireStepUp } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
}

export async function onRequestGet({ request, env }) {
  const cors = getCorsHeaders(request, env)

  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_PAYMENT, 'view_metadata_archive')
  if (stepCheck.error) return stepCheck.error

  const effective = effectiveScopesFromJwt(stepCheck.user)
  if (!effective.has(SCOPES.ADMIN_PAYMENTS)) {
    return res({ error: 'admin:payments scope required' }, 403, cors)
  }

  const url = new URL(request.url)
  const intentId = Number(url.searchParams.get('intent_id'))
  if (!Number.isFinite(intentId) || intentId < 1) {
    return res({ error: 'intent_id required' }, 400, cors)
  }

  const { results } = await env.chiyigo_db
    .prepare(
      `SELECT id, intent_id, original_status, original_metadata,
              original_failure_reason, archived_at, archived_by, reason
         FROM payment_metadata_archive
        WHERE intent_id = ?
        ORDER BY archived_at DESC`,
    )
    .bind(intentId).all()

  await safeUserAudit(env, {
    event_type: 'payment.metadata_archive.viewed', severity: 'critical',
    user_id: Number(stepCheck.user.sub), request,
    data: {
      intent_id: intentId,
      archive_count: results?.length ?? 0,
    },
  })

  return res({ rows: results ?? [] }, 200, cors)
}
