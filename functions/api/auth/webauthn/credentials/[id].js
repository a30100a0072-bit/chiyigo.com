/**
 * PATCH  /api/auth/webauthn/credentials/:id   — rename nickname（一般 access_token）
 * DELETE /api/auth/webauthn/credentials/:id   — 移除 passkey（**需 step-up `elevated:account`，
 *                                                for_action='remove_passkey'**）
 *
 * Phase D-2 Wave C — 單把 passkey 管理。
 *
 * Why 兩種 auth 強度：
 *   - rename 純 UX：低風險，一般 token 即可
 *   - delete = 移除 second factor，等同改密碼 / 改 email 強度，必須走 step-up
 *
 * 路徑參數：:id 是 user_webauthn_credentials.id（PK INTEGER）。一律以 (user_id, id) 雙欄
 * 過濾 row，避免越權刪除別人 passkey（雖然 PK 不同 user 也不會撞到，但是雙保險）。
 *
 * 回傳：
 *   PATCH  200 → { id, nickname }
 *          400 → nickname 非 string / 太長
 *          401 → access_token 無效
 *          404 → 該 user 沒有此 credential
 *   DELETE 200 → { id, deleted: true }
 *          401 → access_token 無效
 *          403 → 缺 step-up（STEP_UP_REQUIRED / STEP_UP_ACTION_MISMATCH）
 *          404 → 該 user 沒有此 credential
 */

import { requireAuth, requireStepUp, res } from '../../../../utils/auth.js'
import { getCorsHeaders } from '../../../../utils/cors.js'
import { SCOPES } from '../../../../utils/scopes.js'
import { safeUserAudit } from '../../../../utils/user-audit.js'

const ELEVATED_ACTION_REMOVE = 'remove_passkey'
const NICKNAME_MAX = 64

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
}

export async function onRequestPatch({ request, env, params }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  const userId = Number(user.sub)
  const credPk = Number(params?.id)
  if (!Number.isFinite(credPk)) return res({ error: 'Invalid id' }, 400, cors)

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400, cors) }

  const nickname = body?.nickname
  if (typeof nickname !== 'string' || nickname.length === 0 || nickname.length > NICKNAME_MAX) {
    return res({ error: `nickname must be a non-empty string up to ${NICKNAME_MAX} chars` }, 400, cors)
  }

  const upd = await env.chiyigo_db
    .prepare(
      `UPDATE user_webauthn_credentials
          SET nickname = ?
        WHERE id = ? AND user_id = ?`,
    )
    .bind(nickname, credPk, userId)
    .run()

  if ((upd.meta?.changes ?? 0) === 0) {
    return res({ error: 'Credential not found' }, 404, cors)
  }

  return res({ id: credPk, nickname }, 200, cors)
}

export async function onRequestDelete({ request, env, params }) {
  const cors = getCorsHeaders(request, env, { credentials: true })
  const { user, error } = await requireStepUp(
    request, env, SCOPES.ELEVATED_ACCOUNT, ELEVATED_ACTION_REMOVE,
  )
  if (error) return error

  const userId = Number(user.sub)
  const credPk = Number(params?.id)
  if (!Number.isFinite(credPk)) return res({ error: 'Invalid id' }, 400, cors)

  // 撈 credential_id 給 audit 用（雖然只回 prefix）
  const row = await env.chiyigo_db
    .prepare(
      `SELECT credential_id FROM user_webauthn_credentials
        WHERE id = ? AND user_id = ?`,
    )
    .bind(credPk, userId).first()
  if (!row) return res({ error: 'Credential not found' }, 404, cors)

  await env.chiyigo_db
    .prepare(`DELETE FROM user_webauthn_credentials WHERE id = ? AND user_id = ?`)
    .bind(credPk, userId).run()

  await safeUserAudit(env, {
    event_type: 'webauthn.credential.deleted',
    severity:   'critical',                 // 移除 2FA 視同 mfa.disable 等級
    user_id:    userId,
    request,
    data: { credential_id_prefix: String(row.credential_id).slice(0, 12) },
  })

  return res({ id: credPk, deleted: true }, 200, cors)
}
