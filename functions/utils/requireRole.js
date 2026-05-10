/**
 * 角色驗證中介軟體
 *
 * 角色層級（低 → 高）：player/user/finance/support < moderator < admin/super_admin < developer
 * 呼叫方指定最低所需角色，低於此層級的 JWT 一律回 403。
 *
 * Codex #6（2026-05-10）：scopes.js 已定義 super_admin/finance/support/user 但本表
 * 原本不認，導致這四個 role 全部被當未知 role(-1) 一律 403。對齊規則：
 *   super_admin = admin 同義詞（同 level=2）
 *   user        = player 同義詞（同 level=0）
 *   finance / support = level 0；管理權限改走 requireScope（fine-grain），
 *                      不靠 hierarchy 升權，避免拿到 admin:* coarse scope。
 *
 * 使用方式：
 *   const { user, error } = await requireRole(request, env, 'admin')
 *   if (error) return error
 */

import { requireAuth, res } from './auth.js'
import { safeUserAudit } from './user-audit.js'

const ROLE_LEVEL = {
  player: 0, user: 0, finance: 0, support: 0,
  moderator: 1,
  admin: 2, super_admin: 2,
  developer: 3,
}

/**
 * Codex r4 #4（2026-05-10）：未知 role 出現在 DB 通常代表
 * （a）migration drift，或（b）資料庫被竄改。
 * endpoint 應在拒絕前寫 critical audit 通知 oncall，給管理介面用。
 */
export const KNOWN_ROLES = new Set(Object.keys(ROLE_LEVEL))
export function isKnownRole(role) { return KNOWN_ROLES.has(role) }

/**
 * Codex r5 #5（2026-05-10）：unknown_role audit 寫到 Discord webhook / 結構化 log，
 * 為防控制字元 / Markdown / unicode 干擾下游解析，把 role 字串清成 [a-z0-9_-] 後截 32 字。
 * 合法 role 全在此白名單內，sanitize 不會丟資訊；非法 role 經此處理才落 audit。
 */
export function safeRoleString(role) {
  return String(role || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32)
}

/**
 * @param {Request} request
 * @param {object}  env
 * @param {string}  minRole  — 'player' | 'moderator' | 'admin' | 'developer'
 * @returns {{ user: object, error: null } | { user: null, error: Response }}
 */
export async function requireRole(request, env, minRole) {
  const { user, error } = await requireAuth(request, env)
  if (error) return { user: null, error }

  // Codex r5 #2（2026-05-10）：actor role 不在 KNOWN_ROLES → 通常是 DB drift 或竄改。
  // 不影響流程（下方 hierarchy 仍會擋），但要寫 critical audit 讓 oncall 看見。
  // 注意：actor.role 是 JWT claim，理論上在 token 簽發時就已是合法 role；不合法代表
  // 簽發端 / DB / 中介有問題 — 對齊 unknown_role_target 用 critical 而非 warn。
  if (!KNOWN_ROLES.has(user.role)) {
    await safeUserAudit(env, {
      event_type: 'admin.unknown_role_actor', severity: 'critical',
      user_id: Number(user.sub), request,
      data: {
        actor_role: safeRoleString(user.role),
        min_role:   minRole,
      },
    })
  }

  const userLevel     = ROLE_LEVEL[user.role]  ?? -1
  const requiredLevel = ROLE_LEVEL[minRole]    ?? Infinity

  if (userLevel < requiredLevel) {
    return {
      user:  null,
      error: res({ error: 'Forbidden', code: 'INSUFFICIENT_ROLE' }, 403),
    }
  }

  return { user, error: null }
}

/**
 * Codex audit r2 #4（2026-05-10）：admin/users/[id]/ban.js、unban.js、admin/revoke.js
 * 過去各自 const ROLE_LEVEL = { player:0, moderator:1, admin:2, developer:3 } —
 * 不認 super_admin/finance/support，且本檔擴充後 endpoint 不會自動跟上。
 * 集中此 helper：actor 嚴格高於 target 才放行（admin 不能 ban admin / super_admin）。
 *
 * @param {string} actorRole   操作者 role（user.role from JWT）
 * @param {string} targetRole  被操作對象 role
 * @returns {boolean}          actor strictly outranks target
 */
export function actorOutranksTarget(actorRole, targetRole) {
  // Codex r3 #4（2026-05-10）：未知 actor 一律拒絕；未知 target 也 fail closed
  // （DB 若無 role CHECK constraint，避免 admin 因 target.role 拼錯就拿到 ban 權）
  if (!(actorRole  in ROLE_LEVEL)) return false
  if (!(targetRole in ROLE_LEVEL)) return false
  return ROLE_LEVEL[actorRole] > ROLE_LEVEL[targetRole]
}
