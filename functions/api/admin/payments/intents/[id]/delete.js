/**
 * POST /api/admin/payments/intents/:id/delete
 *
 * Admin 強制清任意 status 的 intent。succeeded 也可以（user 判斷哪些是真成交要保留 / 哪些是
 * 測試或廢棄）。
 *
 * 認證：admin:payments scope + elevated:payment step-up（同 refund 標準，避免 token 外洩 = 全清）
 *
 * 行為：硬刪 payment_intents row + critical audit。webhook events 不刪（追溯需要）。
 *
 * 為什麼用 POST 不 DELETE：step-up token 走 Authorization header，DELETE 在某些 proxy
 * 會吃掉 body / 不易觀測，POST + 動詞 path 統一專案風格（同 refund.js）。
 */

import { res, requireStepUp } from '../../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../../utils/cors.js'
import { SCOPES, effectiveScopesFromJwt } from '../../../../../utils/scopes.js'
import { getPaymentIntent } from '../../../../../utils/payments.js'
import { safeUserAudit } from '../../../../../utils/user-audit.js'

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

  await env.chiyigo_db
    .prepare('DELETE FROM payment_intents WHERE id = ?')
    .bind(id).run()

  await safeUserAudit(env, {
    event_type: 'payment.intent.deleted', severity: 'critical',
    user_id: intent.user_id, request,
    data: {
      intent_id:        id,
      vendor:           intent.vendor,
      vendor_intent_id: intent.vendor_intent_id,
      status_was:       intent.status,
      amount_subunit:   intent.amount_subunit,
      actor:            'admin',
      admin_user_id:    Number(stepCheck.user.sub),
    },
  })

  return res({ ok: true, id }, 200, cors)
}
