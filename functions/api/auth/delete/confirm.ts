// POST /api/auth/delete/confirm
// Step 2 of 2: consume the emailed token and permanently delete the account.
// No JWT required — the token itself proves authorization.
//
// EVT-003 (P3 audit): account hard-delete is the STRONGEST account disable, yet it emitted no domain event while the
// weaker, reversible ban does. This now emits account.disabled(reason='account_deleted') and offboards the user's
// org-tenant memberships (member.offboarded per tenant) in the SAME atomic batch as the user soft-delete, so the
// deny-state projection / future RP pull sees the deletion. The users UPDATE is CAS-gated (deleted_at IS NULL) so a
// concurrent / repeated confirm cannot double-emit. Personal tenants are out of scope (migration 0047 CHECK keeps
// them immutable+active; members.ts rejects member ops on them) — the account-level account.disabled carries the deny.

import { hashToken } from '../../../utils/crypto'
import { res } from '../../../utils/auth'
import { safeUserAudit, auditDomainEventEmitted } from '../../../utils/user-audit'
import { emitAccountDisabled, emitMemberOffboarded, type EmitIdentity } from '../../../utils/domain-event-emit'

// OD-2 (owner): a self-delete touching more than this many org memberships fails closed (409) rather than running an
// unbounded batch. 3 statements per membership + 9 for the account/tail keep the batch <= the proven ~60-stmt ceiling
// (session-revoke K=20). Real N is ~0-3; an outlier here is an anomaly worth a human look, not a silent mega-batch.
const MAX_OFFBOARD_MEMBERSHIPS = 17

// offboard one membership — the EXACT members.ts offboardMember DELETE (status + statement-level last-owner guard),
// so the deny semantics and the "never remove the last active owner" invariant stay identical across both sites.
const OFFBOARD_SQL =
  `DELETE FROM organization_members
    WHERE tenant_id = ? AND user_id = ? AND status IN ('active','suspended')
      AND ( NOT (status = 'active' AND platform_role = 'tenant_owner')
         OR EXISTS (SELECT 1 FROM organization_members o2
                     WHERE o2.tenant_id = ? AND o2.user_id <> ?
                       AND o2.platform_role = 'tenant_owner' AND o2.status = 'active') )`

function emitMeta() {
  return { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() }
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  // ── 1. 解析 Body ─────────────────────────────────────────────
  let body
  try { body = await request.json() }
  catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }

  const { token } = body ?? {}
  if (!token) return res({ error: 'token is required', code: 'TOKEN_REQUIRED' }, 400)

  const db        = env.chiyigo_db
  const tokenHash = await hashToken(token)

  // ── 2. 查找有效的刪除 Token（read-only；尚未消耗）────────────────
  const record = await db
    .prepare(`
      SELECT user_id FROM email_verifications
      WHERE token_hash = ?
        AND token_type = 'delete_account'
        AND expires_at > datetime('now')
      LIMIT 1
    `)
    .bind(tokenHash)
    .first()

  if (!record) return res({ error: 'Invalid or expired deletion token', code: 'INVALID_DELETION_TOKEN' }, 400)

  const userId = record.user_id

  // ── 3. 確認帳號仍為有效狀態 ──────────────────────────────────
  const userRow = await db
    .prepare('SELECT deleted_at FROM users WHERE id = ?')
    .bind(userId)
    .first()

  if (!userRow || userRow.deleted_at)
    return res({ error: 'Account not found or already deleted', code: 'ACCOUNT_NOT_FOUND' }, 404)

  // ── 4. EVT-003 §2.2 sole-owner 前置檢查（read-only，token 消耗之前）──────────────────────────
  // 刪號者若是任一 ORG tenant 的唯一 active tenant_owner，offboard 會讓 tenant 無主（違反 last-owner 不變量）。
  // 此時 fail-closed 409 且**不消耗 token** —— user 轉移 ownership 後可重試同一封信。(OD-1=A，owner 裁決)
  // 注意：此檢查只覆蓋 deterministic / pre-read 時點；pre-check 與 batch 之間的 race 殘差由 batch 內 statement-level
  // last-owner guard + account.delete.membership_skipped audit 承接（§2.4，可觀測人工補救債，非絕對 fail-closed）。
  const soleOwner = await db
    .prepare(`
      SELECT COUNT(*) AS c FROM organization_members om
      JOIN tenants t ON t.id = om.tenant_id
      WHERE om.user_id = ? AND t.type <> 'personal'
        AND om.status = 'active' AND om.platform_role = 'tenant_owner'
        AND NOT EXISTS (SELECT 1 FROM organization_members o2
                         WHERE o2.tenant_id = om.tenant_id AND o2.user_id <> om.user_id
                           AND o2.platform_role = 'tenant_owner' AND o2.status = 'active')
    `)
    .bind(userId)
    .first()
  if (soleOwner && soleOwner.c > 0) {
    return res({
      error: 'You are the sole owner of one or more organizations; transfer ownership before deleting your account',
      code: 'SOLE_TENANT_OWNER', blocking_tenants: soleOwner.c,
    }, 409)
  }

  // ── 5. EVT-003 §2.3 枚舉要 offboard 的 org membership（read-only，pre-batch；personal 排除）──────
  const memResult = await db
    .prepare(`
      SELECT om.tenant_id FROM organization_members om
      JOIN tenants t ON t.id = om.tenant_id
      WHERE om.user_id = ? AND t.type <> 'personal' AND om.status IN ('active','suspended')
    `)
    .bind(userId)
    .all()
  const memberships = (memResult.results ?? [])
  if (memberships.length > MAX_OFFBOARD_MEMBERSHIPS) {
    await safeUserAudit(env, {
      event_type: 'account.delete.membership_overflow', severity: 'critical', user_id: userId, request,
      data: { membership_count: memberships.length, ceiling: MAX_OFFBOARD_MEMBERSHIPS },
    })
    return res({ error: 'Too many organization memberships to delete in one request; contact support', code: 'ACCOUNT_DELETE_MEMBERSHIP_OVERFLOW' }, 409)
  }

  // ── 6. EVT-003 §2.1 原子消耗 Token（changes()=1；並發雙 confirm 的 loser 在此被擋）────────────────
  const consumed = await db.prepare('DELETE FROM email_verifications WHERE token_hash = ?').bind(tokenHash).run()
  if (consumed.meta.changes !== 1) return res({ error: 'Invalid or expired deletion token', code: 'INVALID_DELETION_TOKEN' }, 400)

  // ── 7. EVT-003 §2.4 單一原子 batch ──────────────────────────────────────────────────────────
  // 順序固定（changes() 鏈不可中插）：每個 membership [offboard DELETE, seqUpsert, outboxInsert]，
  // 接著 users CAS UPDATE（gating）+ account.disabled emit，最後既有 6 條 PII DELETE（移到尾端，不插入任何
  // gating→emit 之間）。
  const stmts = []
  const memberEmits: { identity: EmitIdentity; tenantId: number; casIdx: number }[] = []
  for (const m of memberships) {
    const tenantId = m.tenant_id
    const emit = emitMemberOffboarded(db, { tenantId, targetUserId: userId, actorUserId: userId }, emitMeta())
    memberEmits.push({ identity: emit.identity, tenantId, casIdx: stmts.length })
    stmts.push(db.prepare(OFFBOARD_SQL).bind(tenantId, userId, tenantId, userId), ...emit.statements)
  }

  const acctCasIdx = stmts.length
  const acctEmit = emitAccountDisabled(db, { targetUserId: userId, actorUserId: userId }, emitMeta(), { reason: 'account_deleted' })
  stmts.push(
    db.prepare(`
      UPDATE users
      SET email         = 'deleted_' || id || '@deleted.invalid',
          deleted_at    = datetime('now'),
          token_version = token_version + 1
      WHERE id = ? AND deleted_at IS NULL
    `).bind(userId),
    ...acctEmit.statements,
    db.prepare('DELETE FROM local_accounts      WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM backup_codes        WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM refresh_tokens      WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM email_verifications WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM password_resets     WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM user_identities     WHERE user_id = ?').bind(userId),
  )
  const batchRes = await db.batch(stmts)

  // ── 8. account CAS 0-row = 並發 delete 先一步轉移狀態 → 404，無任何事件（CAS 保證重複 delete 不重複 emit）。
  // loser 在此返回，不跑下方 membership 殘差稽核（避免把「winner 已 offboard」誤記成 skip）。
  if (batchRes[acctCasIdx].meta.changes !== 1) {
    return res({ error: 'Account not found or already deleted', code: 'ACCOUNT_NOT_FOUND' }, 404)
  }

  // ── 9. post-commit 觀測（best-effort，不擋已成功的 200）+ TOCTOU 殘差稽核 ──────────────────────
  // winner 才到這裡。membership offboard 0-row = pre-check 與 batch 之間 race 使 last-owner guard 命中 → 該
  // membership 留存且無事件（可觀測人工補救債），記 critical audit 供跟進；帳號本體已刪除。
  for (const me of memberEmits) {
    if (batchRes[me.casIdx].meta.changes === 1) {
      await auditDomainEventEmitted(env, me.identity)
    } else {
      await safeUserAudit(env, {
        event_type: 'account.delete.membership_skipped', severity: 'critical', user_id: userId, request,
        data: { tenant_id: me.tenantId, reason: 'last_owner_guard_or_concurrent' },
      })
    }
  }
  await auditDomainEventEmitted(env, acctEmit.identity)

  // ── 10. Soft Delete 業務資料（既有 best-effort，原樣保留；欄位不存在時靜默跳過）─────────
  try {
    await db
      .prepare(`UPDATE requisition SET deleted_at = datetime('now') WHERE owner_user_id = ?`)
      .bind(userId)
      .run()
  } catch { /* column may not exist yet */ }

  // audit 在 user 被匿名化後仍帶 user_id；critical → Discord webhook（若設定）
  await safeUserAudit(env, { event_type: 'account.delete', severity: 'critical', user_id: userId, request })
  return res({ message: 'Account deleted successfully' })
}
