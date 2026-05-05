/**
 * DELETE /api/auth/wallet/:id
 * Header: Authorization: Bearer <step_up_token>  (scope=elevated:account, for_action=unbind_wallet)
 *
 * Phase F-3 — 解除錢包綁定。
 *
 * 與 passkey delete 同 pattern：解綁 = 等同把 user 跟 wallet 的關係斷開，
 * 未來提款 / 對帳前置會看這個 binding，因此**必須 step-up**。
 *
 * 雙欄 (id, user_id) 過濾防越權刪除別 user 的綁定。
 *
 * 回傳：
 *   200 → { id, deleted: true }
 *   401 → access_token 無效
 *   403 → 缺 step-up（STEP_UP_REQUIRED / STEP_UP_ACTION_MISMATCH）
 *   404 → 該 user 沒此 wallet
 */

import { requireStepUp, res } from '../../../utils/auth.js'
import { getCorsHeaders } from '../../../utils/cors.js'
import { SCOPES } from '../../../utils/scopes.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

const ELEVATED_ACTION_UNBIND = 'unbind_wallet'

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestDelete({ request, env, params }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireStepUp(
    request, env, SCOPES.ELEVATED_ACCOUNT, ELEVATED_ACTION_UNBIND,
  )
  if (error) return error

  const userId = Number(user.sub)
  const walletId = Number(params?.id)
  if (!Number.isFinite(walletId)) return res({ error: 'Invalid id' }, 400, cors)

  const row = await env.chiyigo_db
    .prepare(`SELECT address FROM user_wallets WHERE id = ? AND user_id = ?`)
    .bind(walletId, userId).first()
  if (!row) return res({ error: 'Wallet not found' }, 404, cors)

  await env.chiyigo_db
    .prepare(`DELETE FROM user_wallets WHERE id = ? AND user_id = ?`)
    .bind(walletId, userId).run()

  await safeUserAudit(env, {
    event_type: 'wallet.unbind',
    severity:   'critical',
    user_id:    userId,
    request,
    data: { address_prefix: String(row.address).slice(0, 10) },
  })

  return res({ id: walletId, deleted: true }, 200, cors)
}
