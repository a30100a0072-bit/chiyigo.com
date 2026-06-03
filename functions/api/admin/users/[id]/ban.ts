/**
 * POST /api/admin/users/:id/ban
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * 封禁指定用戶：
 *  1. 將 users.status 設為 'banned'
 *  2. 原子撤銷該用戶所有有效 refresh_token（防止 token 繼續換發）
 *  3. 寫入 admin_audit_log
 *
 * 保護規則（ROLE_LEVEL 層級）：
 *  - 不可封禁自己
 *  - 不可封禁角色層級 ≥ 自己的用戶（admin 不可封禁 admin 或 developer）
 */

import { res } from '../../../../utils/auth'
import { requireRole, actorOutranksTarget, isKnownRole, safeRoleString } from '../../../../utils/requireRole'
import { appendAuditLog } from '../../../../utils/audit-log'
import { safeUserAudit, auditDomainEventEmitted } from '../../../../utils/user-audit'
import { emitAccountDisabled } from '../../../../utils/domain-event-emit'
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
  if (targetId === Number(user.sub)) return res({ error: 'Cannot ban yourself', code: 'CANNOT_TARGET_SELF' }, 400)

  const db = env.chiyigo_db

  const target = await db
    .prepare(`SELECT id, email, role, status FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(targetId)
    .first()

  if (!target) return res({ error: 'User not found', code: 'USER_NOT_FOUND' }, 404)

  // Codex r4 #4：unknown target role = migration drift 或 DB 被改 → critical audit
  if (!isKnownRole(target.role)) {
    await safeUserAudit(env, {
      event_type: 'admin.unknown_role_target', severity: 'critical',
      user_id: targetId, request,
      data: { action: 'ban', target_role: safeRoleString(target.role), actor_id: Number(user.sub) },
    })
    return res({ error: 'Target user has unknown role; refused for safety', code: 'UNKNOWN_TARGET_ROLE' }, 403)
  }
  if (!actorOutranksTarget(user.role, target.role))
    return res({ error: 'Cannot ban a user with equal or higher role', code: 'CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE' }, 403)

  if (target.status === 'banned') return res({ error: 'User is already banned', code: 'USER_ALREADY_BANNED' }, 400)

  // P1-15：先寫 hash-chain admin_audit_log。失敗即拒絕，不允許「動作成功但無證據」。
  try {
    await appendAuditLog(db, {
      admin_id:     Number(user.sub),
      admin_email:  user.email,
      action:       'ban',
      target_id:    targetId,
      target_email: target.email,
      ip_address:   request.headers.get('CF-Connecting-IP') ?? null,
    })
  } catch {
    return res({ error: 'audit_log_write_failed', code: 'AUDIT_CHAIN_FAILED' }, 500)
  }

  // ── 原子：狀態轉移 + bump token_version + emit account.disabled + 撤銷所有 refresh_token（同一 batch）───
  // bump token_version 使所有 access token 立即失效（不必等 15m 過期）。
  // PR5 5c：account.disabled 在同一 atomic batch emit，gated on 狀態轉移 CAS（status != 'banned'）→ 只有真正
  // active→banned 的 request emit 一筆事件；並發雙 ban 由 CAS 仲裁（loser 0-row、不 emit、不 bump seq、不再 +1）。
  // 順序固定：CAS update → emit statements → refresh revoke（emit 的 changes() chain 必須讀到 users-UPDATE，
  // 中間不可插入其他寫入）。eventId/occurredAt 是唯一副作用，在此注入（helper 無 I/O）。
  const emit = emitAccountDisabled(
    db,
    { targetUserId: targetId, actorUserId: Number(user.sub) },
    { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() },
  )
  const banBatch = await db.batch([
    db.prepare(`UPDATE users SET status = 'banned', token_version = token_version + 1
                 WHERE id = ? AND status != 'banned'`).bind(targetId),
    ...emit.statements,
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now')
                 WHERE user_id = ? AND revoked_at IS NULL`).bind(targetId),
  ])

  // 0-row CAS = 一個並發 ban 在本 request 的 pre-read 與 batch 之間搶先轉移了狀態 → 無轉移、無事件
  // （seqUpsert/outboxInsert 也 0-row）。回與 pre-read 同樣的 already-banned 結果。
  if (banBatch[0].meta.changes !== 1) {
    return res({ error: 'User is already banned', code: 'USER_ALREADY_BANNED' }, 400)
  }

  // P1-15：補 user_audit critical（觸發 Discord 即時通知）
  await safeUserAudit(env, {
    event_type: 'admin.user.banned', severity: 'critical',
    user_id: targetId, request,
    data: { admin_id: Number(user.sub), target_email: target.email },
  })
  // PR5 5c：post-commit、best-effort 觀測 account.disabled 已寫入 outbox（redact streamKey→hash；失敗不擋已成功的 200）。
  await auditDomainEventEmitted(env, emit.identity)

  return res({ message: 'User banned', user_id: targetId, status: 'banned' })
}

