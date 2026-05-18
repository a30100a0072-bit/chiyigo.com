/**
 * changeUserRole（IAM P1-17 Phase 2，2026-05-09；F2 atomicity 修 2026-05-16）
 *
 * latent helper — 目前 prod 沒有任何 admin endpoint 呼叫這個 helper；單一
 * super_admin 結構維持不變。將來真要建第二個 admin/operator 帳號時，新 endpoint
 * 直接呼叫即可，不必重抄一次「驗 role + UPDATE + bumpTokenVersion + audit」邏輯。
 *
 * 關鍵保證：
 *   1. application-layer VALID_ROLES 驗證（不依賴 D1 CHECK constraint）
 *   2. role 變更原子性（codex F2 2026-05-16 + r1 high/medium + r2 medium）：
 *      - SELECT oldRole 後，將 [admin_audit_log INSERT, UPDATE refresh_tokens revoked_at,
 *        UPDATE users SET role+token_version] 依序綁進同一 db.batch()
 *      - revoke 與 role CAS 都 gate on `role=oldRole AND deleted_at IS NULL` —
 *        D1 batch 序列化執行，兩 statement 共享同一前提，同步成立或同步失敗。
 *        revoke 故意放在 CAS 之前：same-target race（B 用舊 oldRole 快照、A 已
 *        把 role 改成同一 newRole）時，oldRole 已不成立 → revoke 0 changes，
 *        refresh 不誤撤；若 gate on newRole 則此 race 會誤觸發
 *      - caller 讀 batchResults[2].meta.changes（role CAS 在 index 2）；
 *        !== 1 → ROLE_RACE，DB role/token_version/refresh 全不動
 *      - 即使 CAS 失敗，admin_audit_log INSERT 仍隨 batch commit，hash-chain
 *        記錄「admin 嘗試 role_change」的證據，verifyAuditChain.valid 不破
 *      - 比照 functions/api/admin/audit/[id].ts F3 pattern
 *   3. role 變更 → 必 bumpTokenVersion → 撤該 user 全部 refresh family
 *      → 強制重新登入；舊 access_token 帶舊 scope 在 token_version mismatch 後失效
 *   4. critical user_audit + admin_audit_log（hash-chain）雙寫；hash-chain 失敗拒動
 *   5. self-demotion 防呆：actor 若把自己從 admin-like 降到非 admin-like，仍允許
 *      但寫 critical audit（避免誤操作鎖死 console）
 */

import { isValidRole } from './roles'
import { safeUserAudit } from './user-audit'
import { prepareAppendAuditLog } from './audit-log'

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
export async function changeUserRole(env, { userId, newRole, actorId, actorEmail, request, reason }: {
  userId: number;
  newRole: string;
  actorId: number;
  actorEmail?: string | null;
  request?: Request;
  reason?: string | null;
}) {
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

  // F2 atomicity（codex 2026-05-16）：admin_audit_log + role/version UPDATE + revoke
  // 綁進同一 db.batch；CAS WHERE role=oldRole 失敗 → ROLE_RACE，audit row 仍 commit
  // 作為「嘗試 role_change」的 hash-chain 證據（chain 仍 verifiable，比照 F3 admin/audit）。
  let prepared
  try {
    prepared = await prepareAppendAuditLog(db, {
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

  // revoke gate on oldRole（codex PR-A r2 medium 修）：放在 CAS UPDATE 之前。
  // D1 batch 序列化執行：兩條 statement 共享同一前提（users.role 仍為 oldRole
  // 且 deleted_at IS NULL）。same-target race 場景（別人已把 role 改成同一
  // newRole）下，oldRole 已不成立 → revoke 0 changes，refresh 不被誤撤。
  const revokeStmt = db
    .prepare(`
      UPDATE refresh_tokens SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM users
            WHERE id = ? AND role = ? AND deleted_at IS NULL
         )
    `)
    .bind(userId, userId, oldRole)

  // CAS 補 deleted_at IS NULL：防 SELECT 與 batch 之間 user 被軟刪、role 仍同。
  const updateRoleStmt = db
    .prepare(`
      UPDATE users
         SET role = ?, token_version = token_version + 1
       WHERE id = ? AND role = ? AND deleted_at IS NULL
    `)
    .bind(newRole, userId, oldRole)

  let batchResults
  try {
    batchResults = await db.batch([prepared.statement, revokeStmt, updateRoleStmt])
  } catch {
    return { ok: false, code: 'AUDIT_CHAIN_FAILED' }
  }

  const roleChanges = batchResults?.[2]?.meta?.changes ?? 0
  if (roleChanges !== 1) {
    // race: SELECT 與 batch commit 之間 role 被別人改/被軟刪。
    // admin_audit_log 已寫入「嘗試紀錄」，hash-chain valid，DB 其他狀態未改。
    return { ok: false, code: 'ROLE_RACE', oldRole }
  }

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
