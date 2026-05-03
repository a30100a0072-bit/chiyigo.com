/**
 * 角色驗證中介軟體
 *
 * 角色層級（低 → 高）：player < moderator < admin < developer
 * 呼叫方指定最低所需角色，低於此層級的 JWT 一律回 403。
 *
 * 使用方式：
 *   const { user, error } = await requireRole(request, env, 'admin')
 *   if (error) return error
 */

import { requireAuth, res } from './auth.js'

const ROLE_LEVEL = { player: 0, moderator: 1, admin: 2, developer: 3 }

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
