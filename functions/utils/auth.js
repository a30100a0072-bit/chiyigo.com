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
import { isJtiRevoked } from './revocation.js'
import { safeUserAudit } from './user-audit.js'

/**
 * @param {Request}     request
 * @param {object}      env
 * @param {string|null} requiredScope  若指定，則 JWT payload.scope 必須吻合
 * @param {object}      [opts]
 * @param {string|string[]} [opts.audience]  若指定，jwtVerify 會強制驗 aud claim
 *                                            （chiyigo IAM resource server 端點建議帶 'chiyigo'）
 * @returns {{ user: object, error: null } | { user: null, error: Response }}
 */
export async function requireAuth(request, env, requiredScope = null, opts = {}) {
  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return { user: null, error: res({ error: 'Unauthorized' }, 401) }
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    return { user: null, error: res({ error: 'Unauthorized' }, 401) }
  }

  let payload
  try {
    const verifyOpts = {}
    if (opts.audience !== undefined) verifyOpts.audience = opts.audience
    payload = await verifyJwt(token, env, verifyOpts)
  } catch {
    return { user: null, error: res({ error: 'Unauthorized' }, 401) }
  }

  // 封禁帳號：無論任何 scope，一律阻斷
  if (payload.status === 'banned') {
    return { user: null, error: res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403) }
  }

  // jti 黑名單（精準 revoke）：KV 正向快取 + D1 為 source of truth
  // 舊 token 沒 jti claim → 跳過此檢查（仍受下方 token_version 守門）
  if (payload.jti && await isJtiRevoked(env, payload.jti)) {
    await safeUserAudit(env, {
      event_type: 'auth.token_revoked', severity: 'warn',
      user_id: Number(payload.sub), request,
      data: { reason_code: 'jti_blacklist', jti: payload.jti.slice(0, 12) },
    })
    return { user: null, error: res({ error: 'Token revoked', code: 'TOKEN_REVOKED' }, 401) }
  }

  // scope 檢查：若要求特定 scope 但 JWT 不符，拒絕存取
  if (requiredScope !== null && payload.scope !== requiredScope) {
    return { user: null, error: res({ error: 'Forbidden: wrong token scope' }, 403) }
  }

  // 一般存取時，拒絕受限的 pre_auth_token
  if (requiredScope === null && payload.scope === 'pre_auth') {
    return { user: null, error: res({ error: 'Forbidden: pre_auth token cannot access this resource' }, 403) }
  }

  // token_version 全域 revoke 比對：
  //   - JWT 簽發時嵌入 user.token_version 為 ver claim
  //   - 任何「強制下線」事件（密碼變更 / 2FA 停用 / 封禁）會 +1
  //   - DB 端 ver 高於 JWT → access token 立即失效
  //   - JWT 缺 ver claim（舊 token）→ 視為 0，與初始值相容
  // 為降低 DB 壓力，僅在有 chiyigo_db binding 時執行（測試環境可省略）
  if (env?.chiyigo_db && payload.sub) {
    const userId = Number(payload.sub)
    if (Number.isFinite(userId)) {
      const row = await env.chiyigo_db
        .prepare('SELECT token_version FROM users WHERE id = ?')
        .bind(userId)
        .first()
      const dbVer  = row?.token_version ?? 0
      const jwtVer = Number.isFinite(payload.ver) ? payload.ver : 0
      if (jwtVer < dbVer) {
        return { user: null, error: res({ error: 'Token revoked', code: 'TOKEN_REVOKED' }, 401) }
      }
    }
  }

  return { user: payload, error: null }
}

/**
 * 將 user.token_version +1，使該用戶所有 access token 立即失效。
 * 並同步撤銷其所有未過期 refresh token。
 *
 * 呼叫時機：
 *   - 密碼變更（reset-password）
 *   - 2FA 停用
 *   - 帳號封禁
 *   - 帳號刪除
 *
 * @param {D1Database} db
 * @param {number}     userId
 * @returns {Promise<void>}
 */
export async function bumpTokenVersion(db, userId) {
  await db.batch([
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id = ?').bind(userId),
    db.prepare(`
      UPDATE refresh_tokens SET revoked_at = datetime('now')
      WHERE user_id = ? AND revoked_at IS NULL
    `).bind(userId),
  ])
}

export function res(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}
