/**
 * POST /api/auth/identity/bind
 * Header: Authorization: Bearer <access_token>
 * Body: { provider, provider_id, display_name?, avatar_url? }
 *
 * 將第三方身分綁定至當前登入帳號。
 * 此端點供 OAuth callback（is_binding 模式）使用，也可直接呼叫。
 *
 * 防護：
 *  - JWT 驗證（requireAuth）
 *  - 若 provider_id 已被其他帳號占用 → 409
 *  - 若已綁定相同 provider → 409
 */

import { requireAuth, res } from '../../../utils/auth.js'
import { safeUserAudit } from '../../../utils/user-audit.js'

const ALLOWED_PROVIDERS = new Set(['google', 'discord', 'line', 'facebook'])

export async function onRequestPost({ request, env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { provider, provider_id, display_name, avatar_url } = body ?? {}

  if (!provider || !provider_id)
    return res({ error: 'provider and provider_id are required' }, 400)

  if (!ALLOWED_PROVIDERS.has(provider))
    return res({ error: `Unsupported provider: ${provider}` }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // 確認帳號仍有效（未被刪除 / 封禁）
  const userRow = await db
    .prepare('SELECT status FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId)
    .first()

  if (!userRow)              return res({ error: 'User not found' }, 404)
  if (userRow.status === 'banned') return res({ error: 'Account is banned' }, 403)

  // 檢查 provider_id 是否已被任何帳號（含自己）占用
  const existing = await db
    .prepare(`
      SELECT user_id FROM user_identities
      WHERE provider = ? AND provider_id = ?
    `)
    .bind(provider, provider_id)
    .first()

  if (existing) {
    if (existing.user_id === userId)
      return res({ error: 'This account is already linked.' }, 409)
    return res({ error: 'This identity is already linked to another account.' }, 409)
  }

  // 執行綁定
  await db
    .prepare(`
      INSERT INTO user_identities (user_id, provider, provider_id, display_name, avatar_url)
      VALUES (?, ?, ?, ?, ?)
    `)
    .bind(userId, provider, provider_id, display_name ?? null, avatar_url ?? null)
    .run()

  await safeUserAudit(env, { event_type: 'oauth.identity.bind', user_id: userId, request, data: { provider } })
  return res({ ok: true, provider, provider_id })
}
