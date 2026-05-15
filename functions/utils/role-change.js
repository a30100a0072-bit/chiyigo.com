/**
 * changeUserRole（IAM P1-17 Phase 2，2026-05-09）
 *
 * latent helper — 目前 prod 沒有任何 admin endpoint 呼叫這個 helper；單一
 * super_admin 結構維持不變。將來真要建第二個 admin/operator 帳號時，新 endpoint
 * 直接呼叫即可，不必重抄一次「驗 role + UPDATE + bumpTokenVersion + audit」邏輯。
 *
 * 關鍵保證：
 *   1. application-layer VALID_ROLES 驗證（不依賴 D1 CHECK constraint）
 *   2. role 變更 → 必 bumpTokenVersion → 撤該 user 全部 refresh family
 *      → 強制重新登入；舊 access_token 帶舊 scope 在 token_version mismatch 後失效
 *   3. critical user_audit + admin_audit_log（hash-chain）雙寫；hash-chain 失敗拒動
 *   4. self-demotion 防呆：actor 若把自己從 admin-like 降到非 admin-like，仍允許
 *      但寫 critical audit（避免誤操作鎖死 console）
 */

import { isValidRole } from './roles'
import { bumpTokenVersion } from './auth.js'
import { safeUserAudit } from './user-audit'
import { appendAuditLog } from './audit-log.js'

const ADMIN_LIKE_ROLES = new Set(['admin', 'developer', 'super_admin'])

/**
 * 把 user 的 role 切到 newRole；觸發 token revocation + audit。
 *
 * @param {object} env
 * @param {object} opts
 * @param {number} opts.userId            被改 role 的 user id
 * @param {string} opts.newRole           目標 role；必為 VALID_ROLES 之一
 * @param {number} opts.actorId           發動操作的 admin user id
 * @param {string} [opts.actorEmail]      發動者 email（hash-chain 用）
 * @param {Request} [opts.request]        for ip / audit
 * @param {string} [opts.reason]          audit 用人類可讀理由
 * @returns {Promise<{ ok: boolean, code?: string, oldRole?: string }>}
 */
export async function changeUserRole(env, { userId, newRole, actorId, actorEmail, request, reason }) {
  if (!isValidRole(newRole)) {
    return { ok: false, code: 'INVALID_ROLE' }
  }
  if (!Number.isInteger(userId) || userId < 1) {
    return { ok: false, code: 'INVALID_USER_ID' }
  }
  if (!Number.isInteger(actorId) || actorId < 1) {
    return { ok: false, code: 'INVALID_ACTOR_ID' }
  }

  const db = env.chiyigo_db
  const target = await db
    .prepare('SELECT id, email, role FROM users WHERE id = ? AND deleted_at IS NULL')
    .bind(userId)
    .first()
  if (!target) return { ok: false, code: 'USER_NOT_FOUND' }

  const oldRole = target.role
  if (oldRole === newRole) {
    return { ok: true, code: 'NOOP', oldRole }
  }

  // hash-chain 先寫；失敗 → 不動 row（無證據的權限變更不接受）
  try {
    await appendAuditLog(db, {
      admin_id:     actorId,
      admin_email:  actorEmail ?? null,
      action:       `role_change:${oldRole}->${newRole}`,
      target_id:    userId,
      target_email: target.email,
      ip_address:   request?.headers?.get?.('CF-Connecting-IP') ?? null,
    })
  } catch {
    return { ok: false, code: 'AUDIT_CHAIN_FAILED' }
  }

  await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(newRole, userId).run()
  await bumpTokenVersion(db, userId)

  const isSelfDemotion = actorId === userId &&
    ADMIN_LIKE_ROLES.has(oldRole) && !ADMIN_LIKE_ROLES.has(newRole)

  await safeUserAudit(env, {
    event_type: 'admin.user.role_changed',
    severity:   isSelfDemotion ? 'critical' : 'warn',
    user_id:    userId,
    request,
    data: {
      admin_id:      actorId,
      old_role:      oldRole,
      new_role:      newRole,
      reason:        reason ?? null,
      self_demotion: isSelfDemotion || undefined,
    },
  })

  return { ok: true, oldRole }
}
