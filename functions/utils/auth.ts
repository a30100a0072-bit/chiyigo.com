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

import { verifyJwt } from './jwt'
import { isJtiRevoked, consumeJtiOnce } from './revocation'
import { safeUserAudit } from './user-audit'
import { hasAllScopes, effectiveScopesFromJwt, hasExactScopeInToken, isElevatedScope } from './scopes'

// requiredScope: 若指定，則 JWT payload.scope 必須吻合（用於 pre_auth_token 等）
// opts.audience: 若指定，jwtVerify 會強制驗 aud claim（chiyigo IAM resource server 端點建議帶 'chiyigo'）；
//   明確傳 null 才省略 aud claim 驗證（userinfo.ts 跨 aud 用），undefined 則套 jwt.ts 預設 'chiyigo'
export async function requireAuth(
  request: Request,
  env: Env,
  requiredScope: string | null = null,
  opts: { audience?: string | string[] | null } = {},
) {
  const authHeader = request.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return { user: null, error: res({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401) }
  }

  const token = authHeader.slice(7).trim()
  if (!token) {
    return { user: null, error: res({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401) }
  }

  let payload
  try {
    const verifyOpts: { audience?: string | string[] | null } = {}
    if (opts.audience !== undefined) verifyOpts.audience = opts.audience
    payload = await verifyJwt(token, env, verifyOpts)
  } catch {
    return { user: null, error: res({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401) }
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
    return { user: null, error: res({ error: 'Forbidden: wrong token scope', code: 'WRONG_TOKEN_SCOPE' }, 403) }
  }

  // 一般存取時，拒絕受限的 pre_auth_token
  if (requiredScope === null && payload.scope === 'pre_auth') {
    return { user: null, error: res({ error: 'Forbidden: pre_auth token cannot access this resource', code: 'PRE_AUTH_TOKEN_FORBIDDEN' }, 403) }
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
 * NOTE: db 暫不標型別等 §1.5c wrangler types 上線（D1Database global）
 */
export async function bumpTokenVersion(db, userId: number): Promise<void> {
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
 */
export async function requireScope(request: Request, env: Env, ...requiredScopes: string[]) {
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
        required: requiredScopes.join(' '),
      }, 403),
    }
  }
  return { user, error: null }
}

/**
 * OR scope 守門（P1-17 Phase 3）：通過 requireAuth + 檢查 JWT 帶有「任一」指定 scope。
 *
 * 用途：read endpoint 同時接受 read 或 write 權限的 token。例：
 *   `requireAnyScope(request, env, ADMIN_USERS_READ, ADMIN_USERS_WRITE)`
 *   → 能 ban user 的人也能 GET 用戶列表（直覺一致），同時 finance/support 等
 *     只拿到 :read fine 的 role 也能讀。
 *
 * 既有 admin/super_admin/developer 透過 hierarchy 拿到所有 fine，全通過；零 regression。
 */
export async function requireAnyScope(request: Request, env: Env, ...acceptedScopes: string[]) {
  const { user, error } = await requireAuth(request, env)
  if (error) return { user: null, error }

  const eff = effectiveScopesFromJwt(user)
  if (!acceptedScopes.some(s => eff.has(s))) {
    return {
      user: null,
      error: res({
        error:    'Forbidden',
        code:     'INSUFFICIENT_SCOPE',
        accepted: acceptedScopes,
        required: acceptedScopes.join(' or '),
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
 * requiredScope: 必須 elevated:* 開頭
 * requiredAction: 若 token 帶 for_action 必須相符；可省略
 */
export async function requireStepUp(
  request: Request,
  env: Env,
  requiredScope: string,
  requiredAction: string | null = null,
) {
  if (!isElevatedScope(requiredScope)) {
    // 程式錯誤而非 user 錯誤：caller 給了非 elevated 的 scope
    return { user: null, error: res({ error: 'requireStepUp must check an elevated:* scope', code: 'INTERNAL_ERROR' }, 500) }
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

  // P2-4：高權限 step-up 嚴格再驗 token_version + role + status，
  // 確保「demoted admin 5min 內仍可退款」這條 race 被堵。
  // requireAuth 已驗 ver，但這裡再查最新 row 比對 role/status，
  // 防 role 直接 SQL 改成 player（沒走 bumpTokenVersion）後 step-up 仍生效。
  if (env?.chiyigo_db && user.sub) {
    const userId = Number(user.sub)
    if (Number.isFinite(userId)) {
      const row = await env.chiyigo_db
        .prepare('SELECT role, status, token_version FROM users WHERE id = ? AND deleted_at IS NULL')
        .bind(userId).first()
      if (!row) {
        return { user: null, error: res({ error: 'User not found', code: 'STEP_UP_USER_GONE' }, 403) }
      }
      if (row.status === 'banned') {
        return { user: null, error: res({ error: 'Account is banned', code: 'ACCOUNT_BANNED' }, 403) }
      }
      const dbVer  = row.token_version ?? 0
      const jwtVer = Number.isFinite(user.ver) ? user.ver : 0
      if (jwtVer < dbVer) {
        return { user: null, error: res({ error: 'Step-up token revoked', code: 'STEP_UP_REVOKED' }, 401) }
      }
      if (row.role !== user.role) {
        return { user: null, error: res({ error: 'Role changed since step-up; re-authenticate', code: 'STEP_UP_ROLE_DRIFT' }, 403) }
      }
    }
  }

  // 一次性 atomic 核銷：把 revoke 當 acquire lock，第一個成功 INSERT 的 caller 才放行。
  // Codex r1 P0-3：原本 requireAuth 查 revoked 是 read，revokeJti 是 write 且不檢查 changes，
  // 並發兩個請求可同時通過 read 後各自 revoke；改為「能插入 = acquire 成功」單一仲裁點。
  // revoke 失敗或 DB error 一律拒絕，禁止 fail-open。
  if (!user.jti) {
    return { user: null, error: res({ error: 'Step-up token missing jti', code: 'STEP_UP_MISSING_JTI' }, 401) }
  }
  if (!env?.chiyigo_db) {
    return { user: null, error: res({ error: 'Step-up consume backend unavailable', code: 'STEP_UP_CONSUME_UNAVAILABLE' }, 503) }
  }
  let claim
  try {
    claim = await consumeJtiOnce(env, user.jti, user.exp)
  } catch {
    return { user: null, error: res({ error: 'Step-up token consume failed', code: 'STEP_UP_CONSUME_FAILED' }, 401) }
  }
  if (!claim.ok) {
    return { user: null, error: res({ error: 'Step-up token already used', code: 'STEP_UP_TOKEN_CONSUMED' }, 401) }
  }

  return { user, error: null }
}

/**
 * Tenant-scoped endpoint 入口守門（PR1 Tenant Foundation）。
 *
 * requireAuth 只擋 pre_auth；但 temp_bind（OAuth 補 email 過渡 token，scope='temp_bind'、
 * sub=provider_id、aud 預設 chiyigo 會過 aud gate）與 step-up（elevated:* scope）token 都會
 * 通過 requireAuth。tenant 解析路徑必須只接受「一般 access token」，否則非登入完成 /
 * 高權限一次性 token 可能滲進 tenant resolution（最糟：temp_bind 的 numeric provider_id
 * 撞真實 users.id）。
 *
 * 在 requireAuth 之上再拒：pre_auth（defense-in-depth）/ temp_bind / 任何 elevated:* /
 * 非正整數 sub（fail-closed）。回傳已驗證的整數 userId 供 tenant resolver 使用，
 * caller 一律傳此 userId 而非 raw user.sub（codex r3）。
 */
export async function requireRegularAccessToken(request: Request, env: Env) {
  const { user, error } = await requireAuth(request, env)
  if (error) return { user: null, userId: null, error }

  const scope = typeof user.scope === 'string' ? user.scope : ''
  // defense-in-depth：requireAuth 已擋 pre_auth，這裡再擋一次
  if (scope === 'pre_auth') {
    return { user: null, userId: null, error: res({ error: 'Forbidden: pre_auth token cannot access this resource', code: 'PRE_AUTH_TOKEN_FORBIDDEN' }, 403) }
  }
  // temp_bind：OAuth 補 email 前的過渡 token（sub=provider_id 非 user id），必顯式擋
  if (scope === 'temp_bind') {
    return { user: null, userId: null, error: res({ error: 'Forbidden: not a regular access token', code: 'NOT_A_REGULAR_TOKEN' }, 403) }
  }
  // step-up token 帶 elevated:* scope；嚴格看 token scope claim（不走 role fallback）
  if (scope.split(/\s+/).filter(Boolean).some(isElevatedScope)) {
    return { user: null, userId: null, error: res({ error: 'Forbidden: not a regular access token', code: 'NOT_A_REGULAR_TOKEN' }, 403) }
  }
  // sub 必為正整數 user id（temp_bind 的 provider_id 可能 numeric 撞 users.id → fail-closed）
  const userId = Number(user.sub)
  if (!Number.isInteger(userId) || userId <= 0) {
    return { user: null, userId: null, error: res({ error: 'Unauthorized', code: 'INVALID_SUBJECT' }, 401) }
  }

  return { user, userId, error: null }
}

export function res(
  data: unknown,
  status: number = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
}
