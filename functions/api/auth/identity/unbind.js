/**
 * POST /api/auth/identity/unbind
 * Header: Authorization: Bearer <access_token>
 * Body: { provider }
 *
 * 解除當前帳號與指定第三方身分的綁定。
 *
 * 防自殺規則（Minimum Auth Rule）：
 *  若 local_accounts 數量 + user_identities 數量 <= 1，拒絕解綁，
 *  防止產生無任何登入方式的幽靈帳號。
 */

import { requireAuth, res } from '../../../utils/auth.js'

const ALLOWED_PROVIDERS = new Set(['google', 'discord', 'line', 'facebook'])

export async function onRequestPost({ request, env }) {
  const { user, error } = await requireAuth(request, env)
  if (error) return error

  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON' }, 400) }

  const { provider } = body ?? {}

  if (!provider)
    return res({ error: 'provider is required' }, 400)

  if (!ALLOWED_PROVIDERS.has(provider))
    return res({ error: `Unsupported provider: ${provider}` }, 400)

  const userId = Number(user.sub)
  const db     = env.chiyigo_db

  // 確認帳號仍有效
  const userRow = await db
    .prepare('SELECT status FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId)
    .first()

  if (!userRow)                    return res({ error: 'User not found' }, 404)
  if (userRow.status === 'banned') return res({ error: 'Account is banned' }, 403)

  // 防自殺：計算剩餘登入方式
  const [localRow, identityRow] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS cnt FROM local_accounts WHERE user_id = ?').bind(userId).first(),
    db.prepare('SELECT COUNT(*) AS cnt FROM user_identities  WHERE user_id = ?').bind(userId).first(),
  ])

  const localCount    = localRow?.cnt    ?? 0
  const identityCount = identityRow?.cnt ?? 0

  if (localCount + identityCount <= 1)
    return res({ error: 'Cannot remove the last authentication method.' }, 400)

  // 確認該 provider 確實已綁定此帳號
  const bound = await db
    .prepare('SELECT 1 FROM user_identities WHERE user_id = ? AND provider = ?')
    .bind(userId, provider)
    .first()

  if (!bound)
    return res({ error: `No binding found for provider: ${provider}` }, 404)

  // 執行解綁
  await db
    .prepare('DELETE FROM user_identities WHERE user_id = ? AND provider = ?')
    .bind(userId, provider)
    .run()

  return res({ ok: true, provider })
}
