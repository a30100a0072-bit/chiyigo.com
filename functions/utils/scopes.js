/**
 * Scope catalog + role mapping（IAM Phase C-2）
 *
 * 目的：把「能做什麼」從 role 黑箱（player/admin）細化到具名 scope
 * （admin:revoke / write:fitness / play:poker），讓 resource server 能宣告
 * 自己需要的 scope，不必每加一支 endpoint 都在 IAM 端改 role 邏輯。
 *
 * 設計：
 *   - 每張 access_token 簽發時帶 `scope` claim（空白分隔字串，OIDC 慣例）
 *   - scope 來源：role 內建 scope ∪ OIDC authorize 階段帶的 scope
 *   - resource server 用 `requireScope(request, env, 'admin:audit')` 守門
 *   - 防衛：舊 token 沒 scope claim → 從 role 推導 fallback（不擋既有 session）
 *
 * 命名規則（對齊 IAM_PLATFORM_ROADMAP §0.5）：
 *   - 識別類：openid / profile / email
 *   - 資源讀寫：read:<domain> / write:<domain>
 *   - 遊戲動作：play:<game>
 *   - 高權限（必走 step-up，Phase C-3）：elevated:<area>
 *   - 管理：admin:<area>
 *
 * Phase C-2 範圍：catalog + helper + token 加 scope + admin/audit 套用做 PoC。
 * Phase C-3 之後：fitness / games / wallet 等 resource server 端點宣告 scope。
 */

// ── Scope 常數（值即字串本身，import 比 hardcode 安全）──

export const SCOPES = Object.freeze({
  // OIDC identity
  OPENID:        'openid',
  PROFILE:       'profile',
  EMAIL:         'email',

  // 資源讀寫（per-domain；resource server 自己定義並宣告）
  READ_PROFILE:  'read:profile',
  WRITE_PROFILE: 'write:profile',

  // 平台 admin
  ADMIN_USERS:   'admin:users',
  ADMIN_REVOKE:  'admin:revoke',
  ADMIN_AUDIT:   'admin:audit',
  ADMIN_CLIENTS: 'admin:clients',  // oauth_clients CRUD（Phase C-1 Wave 3 用）

  // 高權限（Phase C-3）— **絕對不出現在 ROLE_BASE_SCOPES**，只能透過 step-up flow 取得
  ELEVATED_ACCOUNT:   'elevated:account',     // 改密碼 / 改 email / 刪帳號
  ELEVATED_PAYMENT:   'elevated:payment',     // 任何金流操作
  ELEVATED_WITHDRAW:  'elevated:withdraw',
  ELEVATED_WALLET_OP: 'elevated:wallet_op',
})

/** 已知 elevated 集合：step-up endpoint 接受的 scope 白名單 */
export const KNOWN_ELEVATED_SCOPES = new Set([
  SCOPES.ELEVATED_ACCOUNT,
  SCOPES.ELEVATED_PAYMENT,
  SCOPES.ELEVATED_WITHDRAW,
  SCOPES.ELEVATED_WALLET_OP,
])

/** 該 scope 是否為「高權限」類型（必走 step-up flow）*/
export function isElevatedScope(s) {
  return typeof s === 'string' && KNOWN_ELEVATED_SCOPES.has(s)
}

// ── role → 內建 scope ────────────────────────────────────────

/**
 * role 直接對應的 scope。發 token 時這些一定加上去；OIDC 額外要的 scope 額外加。
 *
 * 規則：
 *   - 每個人都有 read:profile / write:profile（管自己的帳號）
 *   - admin / developer 取得 admin:* 全套
 *   - moderator 暫時無增量（Phase C-2 後再依需求補）
 */
const ROLE_BASE_SCOPES = {
  player:    [SCOPES.READ_PROFILE, SCOPES.WRITE_PROFILE],
  moderator: [SCOPES.READ_PROFILE, SCOPES.WRITE_PROFILE],
  admin: [
    SCOPES.READ_PROFILE, SCOPES.WRITE_PROFILE,
    SCOPES.ADMIN_USERS, SCOPES.ADMIN_REVOKE, SCOPES.ADMIN_AUDIT, SCOPES.ADMIN_CLIENTS,
  ],
  developer: [
    SCOPES.READ_PROFILE, SCOPES.WRITE_PROFILE,
    SCOPES.ADMIN_USERS, SCOPES.ADMIN_REVOKE, SCOPES.ADMIN_AUDIT, SCOPES.ADMIN_CLIENTS,
  ],
}

/** 取 role 內建 scope；未知 role → 空陣列 */
export function scopesForRole(role) {
  return ROLE_BASE_SCOPES[role] ?? []
}

// ── token scope 計算（簽發端用）──────────────────────────

/**
 * 給 access_token 用的 scope claim 值。
 *
 * @param {string} role          user.role
 * @param {string} [oidcScope]   authorize 階段傳的 scope param（空白分隔），可空
 * @returns {string} 空白分隔的 scope 字串（OIDC 慣例）
 */
export function buildTokenScope(role, oidcScope = '') {
  const oidcParts = (typeof oidcScope === 'string' ? oidcScope : '')
    .split(/\s+/).filter(Boolean)
  const merged = new Set([...oidcParts, ...scopesForRole(role)])
  return [...merged].join(' ')
}

// ── token scope 檢查（resource server 用）────────────────

/**
 * 從 JWT payload 取「實際生效」scope set。
 *
 * 防衛：scope claim 缺值（舊 token / 非 IAM 簽的 token）→ fallback 用 role 推導。
 * 確保 Phase C-2 部署時既有 admin session 不會立刻失效。
 */
export function effectiveScopesFromJwt(payload) {
  if (!payload || typeof payload !== 'object') return new Set()
  const tokenScopes = (typeof payload.scope === 'string' ? payload.scope : '')
    .split(/\s+/).filter(Boolean)
  const roleScopes  = scopesForRole(payload.role)
  return new Set([...tokenScopes, ...roleScopes])
}

export function hasScope(payload, scope) {
  return effectiveScopesFromJwt(payload).has(scope)
}

export function hasAllScopes(payload, scopes) {
  const eff = effectiveScopesFromJwt(payload)
  return scopes.every(s => eff.has(s))
}

/**
 * **嚴格** scope 檢查：只看 token 內的 scope claim，**不**走 role fallback。
 *
 * 用途：elevated:* 等級的權限（金融操作等）絕不能因為「role=admin」就自動具備；
 * 必須是 step-up flow 簽出來的 step_up_token 才有那 scope。一般 access_token
 * 即使 role=admin 也不該有 elevated:*。
 */
export function hasExactScopeInToken(payload, scope) {
  if (!payload || typeof payload !== 'object') return false
  const tokenScopes = (typeof payload.scope === 'string' ? payload.scope : '')
    .split(/\s+/).filter(Boolean)
  return tokenScopes.includes(scope)
}
