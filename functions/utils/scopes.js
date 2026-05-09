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

  // ── 平台 admin coarse（向後相容；admin/developer ROLE_BASE_SCOPES 仍給這些）
  // hierarchical：coarse 自動含其下所有 fine（見 effectiveScopesFromJwt）
  ADMIN_USERS:   'admin:users',
  ADMIN_REVOKE:  'admin:revoke',
  ADMIN_AUDIT:   'admin:audit',
  ADMIN_CLIENTS:  'admin:clients',  // oauth_clients CRUD（Phase C-1 Wave 3 用）
  ADMIN_PAYMENTS: 'admin:payments', // 金流對帳 + 退款（Phase F-2 wave 4 用）

  // ── 平台 admin fine（P1-17）— 最少特權 token / 將來 finance/support role 用
  // 規則：read 只查、write 改非金流的 row、refund 是金流 destructive 的尖端權限
  ADMIN_USERS_READ:      'admin:users:read',
  ADMIN_USERS_WRITE:     'admin:users:write',     // ban / unban / 改 role
  ADMIN_AUDIT_READ:      'admin:audit:read',
  ADMIN_AUDIT_WRITE:     'admin:audit:write',     // DELETE audit_log（已 + step-up）
  ADMIN_CLIENTS_READ:    'admin:clients:read',
  ADMIN_CLIENTS_WRITE:   'admin:clients:write',   // POST/PATCH/DELETE oauth_clients
  ADMIN_PAYMENTS_READ:   'admin:payments:read',
  ADMIN_PAYMENTS_WRITE:  'admin:payments:write',  // hard delete intent / metadata-archive 寫
  ADMIN_PAYMENTS_REFUND: 'admin:payments:refund', // 退款（最敏感金流動作）

  // 高權限（Phase C-3）— **絕對不出現在 ROLE_BASE_SCOPES**，只能透過 step-up flow 取得
  ELEVATED_ACCOUNT:   'elevated:account',     // 改密碼 / 改 email / 刪帳號
  ELEVATED_PAYMENT:   'elevated:payment',     // 任何金流操作
  ELEVATED_WITHDRAW:  'elevated:withdraw',
  ELEVATED_WALLET_OP: 'elevated:wallet_op',
})

/**
 * coarse → fine 映射表（P1-17 hierarchical scope）。
 *
 * 規則：access_token 帶 coarse scope 時，effective scope set 自動包含所有 fine
 * 子項。endpoint 端用 fine 守門可減少 blast radius（外洩 read-only token 不能
 * 退款），但不影響既有 admin/developer access_token（仍含 coarse → 全套通過）。
 *
 * 拓展時：新加 admin:foo:bar fine scope，記得在這裡 register coarse → fine 對應。
 */
const SCOPE_HIERARCHY = Object.freeze({
  [SCOPES.ADMIN_USERS]: [
    SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE,
  ],
  [SCOPES.ADMIN_AUDIT]: [
    SCOPES.ADMIN_AUDIT_READ, SCOPES.ADMIN_AUDIT_WRITE,
  ],
  [SCOPES.ADMIN_CLIENTS]: [
    SCOPES.ADMIN_CLIENTS_READ, SCOPES.ADMIN_CLIENTS_WRITE,
  ],
  [SCOPES.ADMIN_PAYMENTS]: [
    SCOPES.ADMIN_PAYMENTS_READ, SCOPES.ADMIN_PAYMENTS_WRITE, SCOPES.ADMIN_PAYMENTS_REFUND,
  ],
})

/** 把 set 內所有 coarse scope 的 fine 子項一併加入；不影響原有 fine scope。*/
function expandHierarchy(set) {
  for (const coarse of Object.keys(SCOPE_HIERARCHY)) {
    if (set.has(coarse)) {
      for (const fine of SCOPE_HIERARCHY[coarse]) set.add(fine)
    }
  }
  return set
}

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
    SCOPES.ADMIN_USERS, SCOPES.ADMIN_REVOKE, SCOPES.ADMIN_AUDIT, SCOPES.ADMIN_CLIENTS, SCOPES.ADMIN_PAYMENTS,
  ],
  developer: [
    SCOPES.READ_PROFILE, SCOPES.WRITE_PROFILE,
    SCOPES.ADMIN_USERS, SCOPES.ADMIN_REVOKE, SCOPES.ADMIN_AUDIT, SCOPES.ADMIN_CLIENTS, SCOPES.ADMIN_PAYMENTS,
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
  // P1-17：把 coarse scope 在比對前展開成 coarse + 所有 fine，使既有 admin token
  // （含 admin:payments）自動具備 admin:payments:refund 等 fine-grain 權限。
  return expandHierarchy(new Set([...tokenScopes, ...roleScopes]))
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
