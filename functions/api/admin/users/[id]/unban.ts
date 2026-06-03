/**
 * POST /api/admin/users/:id/unban
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * 解封指定用戶：將 users.status 設回 'active'。
 * 解封後用戶需重新登入以取得新 JWT（現有 JWT 中 status 仍為 'banned'）。
 *
 * 保護規則：
 *  - 不可解封角色層級 ≥ 自己的用戶
 *
 * 回傳：
 *  200 → { message, user_id, status: 'active' }
 *  400 → 用戶並非 banned 狀態
 *  403 → 角色不足 / 目標角色過高
 *  404 → 用戶不存在
 */

import { res } from '../../../../utils/auth'
import { requireRole, actorOutranksTarget, isKnownRole, safeRoleString } from '../../../../utils/requireRole'
import { appendAuditLog } from '../../../../utils/audit-log'
import { safeUserAudit, auditDomainEventEmitted } from '../../../../utils/user-audit'
import { emitAccountReenabled } from '../../../../utils/domain-event-emit'
import { SCOPES, effectiveScopesFromJwt } from '../../../../utils/scopes'

export async function onRequestPost({ request, env, params }) {
  const { user, error } = await requireRole(request, env, 'admin')
  if (error) return error

  // P1-17：fine-grain admin:users:write 守門
  if (!effectiveScopesFromJwt(user).has(SCOPES.ADMIN_USERS_WRITE)) {
    return res({ error: 'admin:users:write scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:users:write' }, 403)
  }

  const targetId = parseInt(params.id, 10)
  if (isNaN(targetId)) return res({ error: 'Invalid user id', code: 'USER_ID_INVALID' }, 400)

  const db = env.chiyigo_db

  const target = await db
    .prepare(`SELECT id, email, role, status FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(targetId)
    .first()

  if (!target) return res({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404)

  // Codex r4 #4：unknown target role critical audit
  if (!isKnownRole(target.role)) {
    await safeUserAudit(env, {
      event_type: 'admin.unknown_role_target', severity: 'critical',
      user_id: targetId, request,
      data: { action: 'unban', target_role: safeRoleString(target.role), actor_id: Number(user.sub) },
    })
    return res({ error: 'Target user has unknown role; refused for safety', code: 'UNKNOWN_TARGET_ROLE' }, 403)
  }
  if (!actorOutranksTarget(user.role, target.role))
    return res({ error: 'Cannot unban a user with equal or higher role', code: 'CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE' }, 403)

  if (target.status !== 'banned') return res({ error: 'User is not banned', code: 'USER_NOT_BANNED' }, 400)

  // P1-15：先寫 hash-chain，失敗拒動
  try {
    await appendAuditLog(db, {
      admin_id:     Number(user.sub),
      admin_email:  user.email,
      action:       'unban',
      target_id:    targetId,
      target_email: target.email,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  // PR5 5c：account.reenabled 在同一 atomic batch emit，gated on 狀態轉移 CAS（status = 'banned'）→ 只有真正
  // banned→active 的 request emit。eventId/occurredAt 在此注入（helper 無 I/O）。unban 不動 token_version /
  // refresh_token（既有行為：使用者重新登入即可），故 batch 只有 [CAS update, seqUpsert, outboxInsert]。
  const emit = emitAccountReenabled(
    db,
    { targetUserId: targetId, actorUserId: Number(user.sub) },
    { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() },
  )
  const unbanBatch = await db.batch([
    db.prepare(`UPDATE users SET status = 'active' WHERE id = ? AND status = 'banned'`).bind(targetId),
    ...emit.statements,
  ])

  // 0-row CAS = 並發 unban 搶先（或 race）→ 無轉移、無事件；回與 pre-read 同樣的 not-banned 結果。
  if (unbanBatch[0].meta.changes !== 1) {
    return res({ error: 'User is not banned', code: 'USER_NOT_BANNED' }, 400)
  }

  await safeUserAudit(env, {
    event_type: 'admin.user.unbanned', severity: 'critical',
    user_id: targetId, request,
    data: { admin_id: Number(user.sub), target_email: target.email },
  })
  // PR5 5c：post-commit、best-effort 觀測 account.reenabled 已寫入 outbox（redact；失敗不擋 200）。
  await auditDomainEventEmitted(env, emit.identity)

  return res({ message: 'User unbanned', user_id: targetId, status: 'active' })
}

