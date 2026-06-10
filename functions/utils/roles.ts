/**
 * Role catalog（IAM P1-17 Phase 2，2026-05-09）
 *
 * 這檔的目的：把 users.role 合法值從「散落在各 endpoint 的字串字面值」收斂到單一
 * source of truth，並提供 application-layer 驗證（D1/SQLite 故意不下 CHECK constraint
 * — 未來 role rename / deprecate 走 code 更安全，schema migration 不必）。
 *
 * Phase 2 = latent role rollout：
 *   - schema/scope/mapping 全 ready
 *   - prod 仍只有單一 super_admin（既有 admin user）
 *   - 新 role 條目（finance / support / user）尚未在 prod 用，但已可被 changeUserRole 套用
 *
 * 真要拆組織時：
 *   1. 在 admin endpoint 用 changeUserRole({ userId, newRole: 'finance', ... })
 *   2. helper 自動 bumpTokenVersion → 撤該 user 全部 refresh family → 強制重新登入
 *   3. 新 token 簽發時透過 ROLE_BASE_SCOPES 拿到新 scope set
 */

// Single source of truth；新增 role 時順便更新 scopes.ts#ROLE_BASE_SCOPES
export const VALID_ROLES = Object.freeze([
  // legacy / current production
  'player',
  'moderator',
  'admin',
  'developer',
  // P1-17 Phase 2 latent
  'super_admin',
  'finance',
  'support',
  'user',
])

const VALID_ROLES_SET = new Set(VALID_ROLES)

export function isValidRole(role: unknown) {
  return typeof role === 'string' && VALID_ROLES_SET.has(role)
}

/**
 * support role 可看的 audit event 白名單（前綴比對）。
 *
 * 為什麼要過濾：support 是客服角色，不該看 risk engine internals / 撤 token 原因 /
 * device 安全 signal 等敏感事件。只保留 user-facing 的「登入失敗 / 金流結果」這類
 * 客服日常會用到的線索。super_admin / admin / developer 不走這個過濾（看全套）。
 *
 * 規則：list 裡的 prefix 任一命中即放行；其他全擋。
 *
 * 維護：新增 audit event 時若 support 該看，記得加進來；不加 = 預設遮蔽（fail-closed）。
 */
const SUPPORT_SAFE_EVENT_PREFIXES = Object.freeze([
  'auth.login.',          // 登入成功 / 失敗
  'auth.logout.',         // 登出
  'auth.password_reset.', // 密碼重設流程
  'payment.',             // 金流（intent / refund / webhook 結果）
  'admin.read.',          // 客服自己的查詢痕跡
])

// support 明確 **不** 該看的；即使 prefix 命中也擋下（雙保險）
const SUPPORT_DENIED_EVENT_PREFIXES = Object.freeze([
  'auth.login.risk_',     // risk engine 細節
  'auth.login.device_',   // device binding internals
  'admin.audit.',         // audit DELETE / archive 等管理員動作
  'admin.user.role_',     // role 變更（避免支援人員看到組織結構）
])

/**
 * 對 support role 過濾 audit event；其他 role 一律回 true（看全套）。
 *
 * @param {unknown} eventType
 * @param {string} role
 * @returns {boolean} true = 可看；false = 應遮蔽
 */
export function canRoleSeeAuditEvent(eventType: unknown, role: string) {
  if (role === 'support') {
    if (typeof eventType !== 'string') return false
    if (SUPPORT_DENIED_EVENT_PREFIXES.some(p => eventType.startsWith(p))) return false
    return SUPPORT_SAFE_EVENT_PREFIXES.some(p => eventType.startsWith(p))
  }
  // super_admin / admin / developer / finance / 其他 — 走 scope 守門即可，audit 內容不再裁切
  return true
}
