/**
 * EVT-003 — account hard-delete (POST /api/auth/delete/confirm) emits account.disabled(reason='account_deleted')
 * and offboards the user's org memberships (member.offboarded per tenant) in ONE atomic, CAS-gated batch.
 * Covers: emission, membership offboard, token/pre-read/CAS idempotency, sole-owner fail-closed, consumer
 * end-to-end deny-state, and the preserved requisition soft-delete.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser, seedTenant, seedMembership } from './_helpers'
import { hashToken } from '../../functions/utils/crypto'
import { emitAccountDisabled } from '../../functions/utils/domain-event-emit'
import { onRequestPost as confirmDelete } from '../../functions/api/auth/delete/confirm'
import { onRequestPost as consumerHandler } from '../../functions/api/admin/cron/event-outbox'

const db = env.chiyigo_db
beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })

let _t = 0
async function seedDeleteToken(userId: number): Promise<string> {
  const plain = `del-tok-${_t++}-${userId}`
  await db.prepare(`INSERT INTO email_verifications (user_id, token_hash, token_type, expires_at) VALUES (?, ?, 'delete_account', datetime('now','+1 hour'))`)
    .bind(userId, await hashToken(plain)).run()
  return plain
}
async function confirm(token: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
  const req = new Request('http://x/api/auth/delete/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
  const resp = await confirmDelete({ request: req, env })
  let body: Record<string, unknown> | null = null
  try { body = await resp.json() as Record<string, unknown> } catch { /* swallow */ }
  return { status: resp.status, body }
}
async function outboxRows(eventType: string, streamKey?: string): Promise<{ stream_key: string; data_json: string }[]> {
  const q = streamKey
    ? db.prepare(`SELECT stream_key, data_json FROM event_outbox WHERE event_type=? AND stream_key=?`).bind(eventType, streamKey)
    : db.prepare(`SELECT stream_key, data_json FROM event_outbox WHERE event_type=?`).bind(eventType)
  return ((await q.all<{ stream_key: string; data_json: string }>()).results) ?? []
}
async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const r = await db.prepare(sql).bind(...binds).first<{ c: number }>()
  return r ? Number(r.c) : 0
}
async function runConsumer(): Promise<void> {
  const req = new Request('http://x/api/admin/cron/event-outbox', { method: 'POST', headers: { Authorization: 'Bearer test-cron-secret' } })
  await consumerHandler({ request: req, env })
}

describe('[EVT-003] account hard-delete emission', () => {
  it('delete -> 200, emits account.disabled with reason=account_deleted, user soft-deleted', async () => {
    const u = await seedUser({ email: 'b@x.io' })
    const r = await confirm(await seedDeleteToken(u.id))
    expect(r.status).toBe(200)
    const rows = await outboxRows('account.disabled', `account:${u.id}`)
    expect(rows.length).toBe(1)
    expect(JSON.parse(rows[0].data_json).reason).toBe('account_deleted')
    expect(await count('SELECT COUNT(*) AS c FROM users WHERE id=? AND deleted_at IS NOT NULL', u.id)).toBe(1)
  })

  it('delete offboards org memberships + emits member.offboarded per tenant (active + suspended)', async () => {
    const u = await seedUser({ email: 'c@x.io' })
    const t1 = await seedTenant({ type: 'organization', name: 'T1' })
    const t2 = await seedTenant({ type: 'organization', name: 'T2' })
    await seedMembership({ tenantId: t1.id, userId: u.id, role: 'member', status: 'active' })
    await seedMembership({ tenantId: t2.id, userId: u.id, role: 'member', status: 'suspended' })
    const r = await confirm(await seedDeleteToken(u.id))
    expect(r.status).toBe(200)
    expect(await count('SELECT COUNT(*) AS c FROM organization_members WHERE user_id=?', u.id)).toBe(0)
    const keys = (await outboxRows('member.offboarded')).map(r => r.stream_key).sort()
    expect(keys).toEqual([`tenant:${t1.id}:member:${u.id}`, `tenant:${t2.id}:member:${u.id}`].sort())
    expect((await outboxRows('account.disabled', `account:${u.id}`)).length).toBe(1)
  })

  it('personal tenant membership is NOT offboarded (out of scope) but account.disabled still emitted', async () => {
    const u = await seedUser({ email: 'p@x.io' })
    const personal = await seedTenant({ type: 'personal', name: 'P', ownerUserId: u.id })
    await seedMembership({ tenantId: personal.id, userId: u.id, role: 'tenant_owner', status: 'active' })
    const r = await confirm(await seedDeleteToken(u.id))
    expect(r.status).toBe(200)
    // personal membership remains; no member.offboarded for it
    expect(await count('SELECT COUNT(*) AS c FROM organization_members WHERE user_id=? AND tenant_id=?', u.id, personal.id)).toBe(1)
    expect((await outboxRows('member.offboarded')).length).toBe(0)
    expect((await outboxRows('account.disabled', `account:${u.id}`)).length).toBe(1)
  })

  it('A3a token defence: reusing a consumed token -> 400, no second event', async () => {
    const u = await seedUser({ email: 'd@x.io' })
    const tok = await seedDeleteToken(u.id)
    expect((await confirm(tok)).status).toBe(200)
    const before = (await outboxRows('account.disabled')).length
    const r2 = await confirm(tok)
    expect(r2.status).toBe(400)
    expect(r2.body?.code).toBe('INVALID_DELETION_TOKEN')
    expect((await outboxRows('account.disabled')).length).toBe(before)
  })

  it('A3b pre-read defence: token for an already-deleted user -> 404, no event', async () => {
    const u = await seedUser({ email: 'e@x.io', deletedAt: '2026-01-01 00:00:00' })
    const r = await confirm(await seedDeleteToken(u.id))
    expect(r.status).toBe(404)
    expect((await outboxRows('account.disabled', `account:${u.id}`)).length).toBe(0)
  })

  it('A3b\' CAS body: re-running the account update+emit batch is 0-row + no second event (idempotent)', async () => {
    const u = await seedUser({ email: 'f@x.io' })
    const upd = () => db.prepare(`UPDATE users SET deleted_at=datetime('now'), token_version=token_version+1 WHERE id=? AND deleted_at IS NULL`).bind(u.id)
    const emit1 = emitAccountDisabled(db, { targetUserId: u.id, actorUserId: u.id }, { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() }, { reason: 'account_deleted' })
    const b1 = await db.batch([upd(), ...emit1.statements])
    expect(b1[0].meta.changes).toBe(1)
    expect((await outboxRows('account.disabled', `account:${u.id}`)).length).toBe(1)
    // second run with a FRESH emit (new eventId) -> users CAS 0-row -> seqUpsert/outboxInsert gated off -> no 2nd row
    const emit2 = emitAccountDisabled(db, { targetUserId: u.id, actorUserId: u.id }, { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() }, { reason: 'account_deleted' })
    const b2 = await db.batch([upd(), ...emit2.statements])
    expect(b2[0].meta.changes).toBe(0)
    expect((await outboxRows('account.disabled', `account:${u.id}`)).length).toBe(1)
  })

  it('B1 sole owner of an org tenant -> 409 SOLE_TENANT_OWNER, token NOT consumed, no mutation/event', async () => {
    const u = await seedUser({ email: 'g@x.io' })
    const t = await seedTenant({ type: 'organization', name: 'Solo' })
    await seedMembership({ tenantId: t.id, userId: u.id, role: 'tenant_owner', status: 'active' })
    const r = await confirm(await seedDeleteToken(u.id))
    expect(r.status).toBe(409)
    expect(r.body?.code).toBe('SOLE_TENANT_OWNER')
    // token NOT consumed (retryable after ownership transfer)
    expect(await count(`SELECT COUNT(*) AS c FROM email_verifications WHERE token_type='delete_account' AND user_id=?`, u.id)).toBe(1)
    // nothing mutated
    expect(await count('SELECT COUNT(*) AS c FROM users WHERE id=? AND deleted_at IS NULL', u.id)).toBe(1)
    expect(await count('SELECT COUNT(*) AS c FROM organization_members WHERE user_id=?', u.id)).toBe(1)
    expect((await outboxRows('account.disabled')).length).toBe(0)
    expect((await outboxRows('member.offboarded')).length).toBe(0)
  })

  it('B2 owner WITH another active owner -> delete allowed (offboarded, co-owner intact)', async () => {
    const u = await seedUser({ email: 'h@x.io' })
    const co = await seedUser({ email: 'co@x.io' })
    const t = await seedTenant({ type: 'organization', name: 'Duo' })
    await seedMembership({ tenantId: t.id, userId: u.id, role: 'tenant_owner', status: 'active' })
    await seedMembership({ tenantId: t.id, userId: co.id, role: 'tenant_owner', status: 'active' })
    const r = await confirm(await seedDeleteToken(u.id))
    expect(r.status).toBe(200)
    expect((await outboxRows('member.offboarded', `tenant:${t.id}:member:${u.id}`)).length).toBe(1)
    expect(await count('SELECT COUNT(*) AS c FROM organization_members WHERE tenant_id=? AND user_id=?', t.id, co.id)).toBe(1)
  })

  it('B3 consumer end-to-end: account + member deny-state denied=1 (contiguity through the real 5b consumer)', async () => {
    const u = await seedUser({ email: 'i@x.io' })
    const t = await seedTenant({ type: 'organization', name: 'E2E' })
    await seedMembership({ tenantId: t.id, userId: u.id, role: 'member', status: 'active' })
    expect((await confirm(await seedDeleteToken(u.id))).status).toBe(200)
    await runConsumer()
    const acct = await db.prepare(`SELECT denied FROM event_deny_state WHERE stream_key=?`).bind(`account:${u.id}`).first<{ denied: number }>()
    expect(acct?.denied).toBe(1)
    const mem = await db.prepare(`SELECT denied FROM event_deny_state WHERE stream_key=?`).bind(`tenant:${t.id}:member:${u.id}`).first<{ denied: number }>()
    expect(mem?.denied).toBe(1)
  })

  it('B4 existing requisition soft-delete is preserved', async () => {
    const u = await seedUser({ email: 'j@x.io' })
    await db.prepare(`INSERT INTO requisition (owner_user_id, name, status) VALUES (?, 'r', 'pending')`).bind(u.id).run()
    expect((await confirm(await seedDeleteToken(u.id))).status).toBe(200)
    expect(await count('SELECT COUNT(*) AS c FROM requisition WHERE owner_user_id=? AND deleted_at IS NOT NULL', u.id)).toBe(1)
  })
})
