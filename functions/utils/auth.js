/**
 * JWT 驗證工具（ES256）
 * 供 2FA、delete 等需要身份驗證的端點共用。
 *
 * 使用方式：
 *   const { user, error } = await requireAuth(request, env)
 *   if (error) return error
 *   // user.sub, user.email, user.email_verified ...
 *
 *   // 限定 scope（用於 pre_auth_token）：
 *   const { user, error } = await requireAuth(request, env, 'pre_auth')
 */

import { verifyJwt } from './jwt.js'

/**
 * @param {Request}     request
 * @param {object}      env
 * @param {string|null} requiredScope  若指定，則 JWT payload.scope 必須吻合
 * @returns {{ user: object, error: null } | { user: null, error: Response }}
 */
export async function requireAuth(request, env, requiredScope = null) {
  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return { user: null, error: res({ error: 'Unauthorized' }, 401) }
  }

  const token = authHeader.slice(7)

  let payload
  try {
    payload = await verifyJwt(token, env)
  } catch {
    return { user: null, error: res({ error: 'Unauthorized' }, 401) }
  }

  // scope 檢查：若要求特定 scope 但 JWT 不符，拒絕存取
  if (requiredScope !== null && payload.scope !== requiredScope) {
    return { user: null, error: res({ error: 'Forbidden: wrong token scope' }, 403) }
  }

  // 一般存取時，拒絕受限的 pre_auth_token
  if (requiredScope === null && payload.scope === 'pre_auth') {
    return { user: null, error: res({ error: 'Forbidden: pre_auth token cannot access this resource' }, 403) }
  }

  return { user: payload, error: null }
}

export function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
