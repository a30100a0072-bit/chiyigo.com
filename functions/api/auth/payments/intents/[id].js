/**
 * GET /api/auth/payments/intents/:id
 * Header: Authorization: Bearer <access_token>
 *
 * Phase F-2 — 單筆 intent 詳情。雙欄 (id, user_id) 過濾防越權。
 *
 * 回傳：
 *   200 → intent row
 *   401 → access_token 無效
 *   404 → 不存在 / 越權
 */

import { res } from '../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../utils/cors.js'
import { requirePaymentAccess, getPaymentIntent, PAYMENT_STATUS } from '../../../../utils/payments.js'
import { safeUserAudit } from '../../../../utils/user-audit.js'

// 使用者可自刪的 status：未真正動到金流的 row。succeeded / processing / refunded
// 涉及帳務或 PSP 對帳，禁止 user 端刪（admin 才能強制清）。
const USER_DELETABLE = new Set([
  PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELED,
])

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestGet({ request, env, params }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requirePaymentAccess(request, env, { skipKyc: true })
  if (error) return error

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404, cors)

  const row = await getPaymentIntent(env, { id })
  if (!row || row.user_id !== Number(user.sub)) {
    return res({ error: 'not_found' }, 404, cors)
  }
  return res(row, 200, cors)
}

export async function onRequestDelete({ request, env, params }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requirePaymentAccess(request, env, { skipKyc: true })
  if (error) return error

  const id = Number(params?.id)
  if (!Number.isFinite(id) || id < 1) return res({ error: 'not_found' }, 404, cors)
  const userId = Number(user.sub)

  const row = await getPaymentIntent(env, { id })
  if (!row || row.user_id !== userId) return res({ error: 'not_found' }, 404, cors)

  if (!USER_DELETABLE.has(row.status)) {
    return res({ error: 'status_locked', code: 'STATUS_LOCKED', status: row.status }, 403, cors)
  }

  // 硬刪：amount/vendor/status 都已記在 audit，row 本身可清
  await env.chiyigo_db
    .prepare('DELETE FROM payment_intents WHERE id = ? AND user_id = ?')
    .bind(id, userId).run()

  await safeUserAudit(env, {
    event_type: 'payment.intent.deleted', severity: 'info',
    user_id: userId, request,
    data: {
      intent_id: id,
      vendor: row.vendor,
      vendor_intent_id: row.vendor_intent_id,
      status_was: row.status,
      amount_subunit: row.amount_subunit,
      actor: 'user',
    },
  })

  return res({ ok: true, id }, 200, cors)
}
