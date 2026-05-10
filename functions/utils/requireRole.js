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

const ROLE_LEVEL = {
  player: 0, user: 0, finance: 0, support: 0,
  moderator: 1,
  admin: 2, super_admin: 2,
  developer: 3,
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
