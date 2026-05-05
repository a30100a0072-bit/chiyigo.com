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
import { isJtiRevoked, revokeJti } from './revocation.js'
import { safeUserAudit } from './user-audit.js'
import { hasAllScopes, effectiveScopesFromJwt, hasExactScopeInToken, isElevatedScope } from './scopes.js'

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

/**
 * Scope 守門：通過 requireAuth + 檢查 JWT 帶有所有指定 scope。
 *
 * 規則：
 *   - JWT scope claim 是 OIDC 慣例的空白分隔字串
 *   - 缺 scope claim（舊 token / 非 IAM 簽）→ effectiveScopesFromJwt 從 role 推 fallback
 *   - 所有 required scope 都得在；任一缺 → 403 INSUFFICIENT_SCOPE
 *
 * 使用方式：
 *   const { user, error } = await requireScope(request, env, 'admin:audit')
 *   if (error) return error
 *
 * 多 scope（AND）：requireScope(request, env, 'admin:users', 'admin:revoke')
 *
 * @param {Request} request
 * @param {object}  env
 * @param  {...string} requiredScopes
 */
export async function requireScope(request, env, ...requiredScopes) {
  const { user, error } = await requireAuth(request, env)
  if (error) return { user: null, error }

  if (!hasAllScopes(user, requiredScopes)) {
    const eff = effectiveScopesFromJwt(user)
    return {
      user: null,
      error: res({
        error:   'Forbidden',
        code:    'INSUFFICIENT_SCOPE',
        missing: requiredScopes.filter(s => !eff.has(s)),
      }, 403),
    }
  }
  return { user, error: null }
}

/**
 * Step-up token 守門（Phase C-3）：高權限操作（金流 / 改密碼 / 刪帳號）專用。
 *
 * 嚴格規則：
 *   1. token 必須是 elevated:xxx scope（**嚴格** — 不走 role fallback；admin 也不能跳過）
 *   2. 必須是 elevated:* scope（防止有人用一般 scope 假冒 step-up）
 *   3. for_action（若指定）必須完全相符
 *   4. 通過後 **revoke jti**（一次性消耗），同 token 不能用於第二次操作
 *
 * 使用方式（保護一個高權限 endpoint）：
 *   const { user, error } = await requireStepUp(request, env, 'elevated:account', 'delete_account')
 *   if (error) return error
 *
 * @param {Request} request
 * @param {object}  env
 * @param {string}  requiredScope        必須 elevated:* 開頭
 * @param {string} [requiredAction]      若 token 帶 for_action，必須相符；可省略
 */
export async function requireStepUp(request, env, requiredScope, requiredAction = null) {
  if (!isElevatedScope(requiredScope)) {
    // 程式錯誤而非 user 錯誤：caller 給了非 elevated 的 scope
    return { user: null, error: res({ error: 'requireStepUp must check an elevated:* scope' }, 500) }
  }

  const { user, error } = await requireAuth(request, env)
  if (error) return { user: null, error }

  // 嚴格：scope claim 必含請求的 elevated；不接受 role fallback
  if (!hasExactScopeInToken(user, requiredScope)) {
    return {
      user: null,
      error: res({
        error: 'Step-up authentication required',
        code:  'STEP_UP_REQUIRED',
        required_scope: requiredScope,
      }, 403),
    }
  }

  // for_action 比對（防把 elevated:account/change_password 拿去刪帳號）
  if (requiredAction && user.for_action !== requiredAction) {
    return {
      user: null,
      error: res({
        error: 'Step-up token issued for a different action',
        code:  'STEP_UP_ACTION_MISMATCH',
        required_action: requiredAction,
      }, 403),
    }
  }

  // 一次性消耗：成功命中後立刻 revoke jti，同 token 不能再用
  if (user.jti && env?.chiyigo_db) {
    try { await revokeJti(env, user.jti, user.exp) }
    catch { /* revoke 失敗不擋本次請求；下次仍會 401 因為 jti 進黑名單 */ }
  }

  return { user, error: null }
}

export function res(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}
