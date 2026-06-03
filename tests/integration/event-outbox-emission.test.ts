/**
 * PR5 5a — transactional event emission (members.ts + invitations.ts wired into event_outbox).
 *
 * Verifies the spike-proven mechanism end-to-end through the real domain functions:
 *  - emit-on-apply: each transition emits exactly ONE outbox row (correct eventType / derived streamKey / seq).
 *  - no-emit-on-noop: a 0-row CAS emits nothing and bumps no seq.
 *  - SQL-derived payload (F1): the role field is read in-batch (committed state), not a stale capture.
 *  - atomicity: a forced outbox failure rolls the WHOLE batch back (the mutation does not apply).
 *  - acceptInvitation: member.joined emitted gated on the JOIN; F2 catch rethrows an unexplained failure.
 *  - every emitted row passes the FROZEN validateDomainEvent.
 *
 * Note on F1 stale-race: a divergence between an app pre-read and the committed role requires interleaving INSIDE
 * the domain fn (not reproducible from a black-box call). The SQL-derived read-your-writes under concurrency was
 * proven by the 5a spike on local + remote D1; here the 'F1 SQL-derived mechanism' test drives the helper with a
 * gating mutation that changes the role, proving the emit reads the POST-mutation committed role.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedTenant, seedMembership, seedInvitation } from './_helpers'
import { suspendMember, reactivateMember, offboardMember, changeMemberRole } from '../../functions/utils/members'
import { acceptInvitation } from '../../functions/utils/invitations'
import { emitMemberSuspended, emitAccountDisabled, emitAccountReenabled } from '../../functions/utils/domain-event-emit'
import { validateDomainEvent } from '../../functions/utils/domain-events'

const db = env.chiyigo_db
beforeEach(async () => { await resetDb() })

let _u = 0
async function user(verifiedEmail?: string): Promise<number> {
  const u = await seedUser({ email: verifiedEmail ?? `eo${_u++}@x.io`, emailVerified: 1 })
  return u.id
}

interface OutboxRow {
  event_id: string; event_type: string; stream_key: string; stream_seq: number
  tenant_id: number | null; actor_sub: string | null; occurred_at: string; data_json: string; status: string
}
async function outboxRows(streamKey: string): Promise<OutboxRow[]> {
  const r = await db.prepare(`SELECT * FROM event_outbox WHERE stream_key = ? ORDER BY stream_seq`).bind(streamKey).all<OutboxRow>()
  return r.results ?? []
}
async function seqOf(streamKey: string): Promise<number | null> {
  const r = await db.prepare(`SELECT last_seq FROM event_stream_sequences WHERE stream_key = ?`).bind(streamKey).first<{ last_seq: number }>()
  return r ? r.last_seq : null
}
function asEnvelope(row: OutboxRow): unknown {
  return {
    v: 1, eventId: row.event_id, eventType: row.event_type, streamKey: row.stream_key, streamSeq: row.stream_seq,
    occurredAt: row.occurred_at, tenantId: row.tenant_id, actorSub: row.actor_sub, data: JSON.parse(row.data_json),
  }
}
/** org tenant with an active owner + one active target member at the given role. */
async function orgWithMember(memberRole = 'billing_admin', memberStatus = 'active') {
  const owner = await user(); const member = await user()
  const t = await seedTenant({ type: 'organization' })
  await seedMembership({ tenantId: t.id, userId: owner, role: 'tenant_owner', status: 'active' })
  await seedMembership({ tenantId: t.id, userId: member, role: memberRole, status: memberStatus })
  return { tenantId: t.id, owner, member, streamKey: `tenant:${t.id}:member:${member}` }
}

describe('[PR5-5a] event emission — members.ts', () => {
  it('suspend emits ONE member.suspended with SQL-derived previousRole + valid contract', async () => {
    const o = await orgWithMember('billing_admin')
    const r = await suspendMember(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner })
    expect(r.outcome).toBe('applied')
    const rows = await outboxRows(o.streamKey)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('member.suspended')
    expect(rows[0].stream_seq).toBe(1)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].tenant_id).toBe(o.tenantId)
    expect(rows[0].actor_sub).toBe(String(o.owner))
    const data = JSON.parse(rows[0].data_json)
    expect(data).toEqual({ sub: String(o.member), previousRole: 'billing_admin' }) // SQL-derived role
    const v = validateDomainEvent(asEnvelope(rows[0]))
    expect(v.ok).toBe(true)
  })

  it('reactivate emits member.reactivated with SQL-derived platformRole', async () => {
    const o = await orgWithMember('tenant_admin', 'suspended')
    const r = await reactivateMember(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner })
    expect(r.outcome).toBe('applied')
    const rows = await outboxRows(o.streamKey)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('member.reactivated')
    expect(JSON.parse(rows[0].data_json)).toEqual({ sub: String(o.member), platformRole: 'tenant_admin' })
    expect(validateDomainEvent(asEnvelope(rows[0])).ok).toBe(true)
  })

  it('offboard emits member.offboarded with {sub} only', async () => {
    const o = await orgWithMember('member')
    const r = await offboardMember(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner })
    expect(r.outcome).toBe('applied')
    const rows = await outboxRows(o.streamKey)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('member.offboarded')
    expect(JSON.parse(rows[0].data_json)).toEqual({ sub: String(o.member) })
    expect(validateDomainEvent(asEnvelope(rows[0])).ok).toBe(true)
  })

  it('role change emits member.role_changed with {sub, fromRole, toRole}', async () => {
    const o = await orgWithMember('member')
    const r = await changeMemberRole(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner, toRole: 'tenant_admin' })
    expect(r.outcome).toBe('applied')
    const rows = await outboxRows(o.streamKey)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('member.role_changed')
    expect(JSON.parse(rows[0].data_json)).toEqual({ sub: String(o.member), fromRole: 'member', toRole: 'tenant_admin' })
    expect(validateDomainEvent(asEnvelope(rows[0])).ok).toBe(true)
  })

  it('double-suspend (0-row CAS) emits NOTHING and bumps no seq', async () => {
    const o = await orgWithMember('member', 'suspended') // already suspended
    const r = await suspendMember(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner })
    expect(r.outcome).not.toBe('applied')
    expect((await outboxRows(o.streamKey)).length).toBe(0)
    expect(await seqOf(o.streamKey)).toBeNull()
  })

  it('same-role change is no_op and emits NOTHING', async () => {
    const o = await orgWithMember('member')
    const r = await changeMemberRole(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner, toRole: 'member' })
    expect(r.outcome).toBe('no_op')
    expect((await outboxRows(o.streamKey)).length).toBe(0)
    expect(await seqOf(o.streamKey)).toBeNull()
  })

  it('suspend then reactivate -> CONTIGUOUS seq 1,2 on the same streamKey', async () => {
    const o = await orgWithMember('member')
    await suspendMember(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner })
    await reactivateMember(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner })
    const rows = await outboxRows(o.streamKey)
    expect(rows.map(r => r.stream_seq)).toEqual([1, 2])
    expect(rows.map(r => r.event_type)).toEqual(['member.suspended', 'member.reactivated'])
  })

  it('F1 SQL-derived mechanism: the emit reads the role AS-COMMITTED-IN-BATCH, not a pre-captured value', async () => {
    const o = await orgWithMember('member')
    // gating mutation changes the role to billing_admin in the SAME batch; the suspend-shaped emit's previousRole
    // subquery must read the POST-mutation role -> 'billing_admin' (proving it is SQL-derived, not the 'member'
    // the row had before this batch / before the helper was called).
    const gating = db.prepare(`UPDATE organization_members SET platform_role='billing_admin' WHERE tenant_id=? AND user_id=? AND status='active'`).bind(o.tenantId, o.member)
    const emit = emitMemberSuspended(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner }, { eventId: 'fixed-e1', occurredAt: '2026-06-02T00:00:00.000Z' })
    await db.batch([gating, ...emit.statements])
    const rows = await outboxRows(o.streamKey)
    expect(rows.length).toBe(1)
    expect(JSON.parse(rows[0].data_json).previousRole).toBe('billing_admin')
  })

  it('atomicity: a forced outbox UNIQUE collision rolls the WHOLE batch back (suspend does NOT apply)', async () => {
    const o = await orgWithMember('member')
    // pre-occupy (streamKey, seq=1) WITHOUT a sequences row, so the fresh seq allocation hits seq=1 -> UNIQUE
    // collision in the outbox insert -> the batch (incl. the suspend UPDATE) rolls back.
    await db.prepare(
      `INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, occurred_at, data_json)
       VALUES ('pre','member.suspended', ?, 1, '2026-06-02T00:00:00Z', '{}')`,
    ).bind(o.streamKey).run()
    await expect(suspendMember(db, { tenantId: o.tenantId, targetUserId: o.member, actorUserId: o.owner })).rejects.toThrow()
    const m = await db.prepare(`SELECT status FROM organization_members WHERE tenant_id=? AND user_id=?`).bind(o.tenantId, o.member).first<{ status: string }>()
    expect(m!.status).toBe('active') // rolled back
  })
})

describe('[PR5-5a] event emission — invitations.ts accept', () => {
  async function seedAcceptable() {
    const owner = await user()
    const t = await seedTenant({ type: 'organization' })
    await seedMembership({ tenantId: t.id, userId: owner, role: 'tenant_owner', status: 'active' })
    const inviteeEmail = `invitee${_u}@x.io`
    const invitee = await user(inviteeEmail)
    await seedInvitation({ tenantId: t.id, email: inviteeEmail, platformRole: 'member', token: 'rawtok-1', invitedBy: owner, status: 'pending' })
    return { tenantId: t.id, invitee, streamKey: `tenant:${t.id}:member:${invitee}` }
  }

  it('accept emits member.joined gated on the JOIN', async () => {
    const a = await seedAcceptable()
    const r = await acceptInvitation(db, { rawToken: 'rawtok-1', acceptingUserId: a.invitee })
    expect(r.outcome).toBe('joined')
    const rows = await outboxRows(a.streamKey)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('member.joined')
    expect(rows[0].stream_seq).toBe(1)
    expect(JSON.parse(rows[0].data_json)).toEqual({ sub: String(a.invitee), platformRole: 'member' })
    expect(validateDomainEvent(asEnvelope(rows[0])).ok).toBe(true)
  })

  it('F2: a forced outbox failure makes accept RETHROW (not a masked already_resolved/already_member)', async () => {
    const a = await seedAcceptable()
    // pre-occupy the joined streamKey at seq=1 so the emit insert UNIQUE-collides -> batch error. The membership
    // does NOT exist and the invite is NOT consumed-by-another, so the F2 catch must rethrow, never mask it.
    await db.prepare(
      `INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, occurred_at, data_json)
       VALUES ('pre2','member.joined', ?, 1, '2026-06-02T00:00:00Z', '{}')`,
    ).bind(a.streamKey).run()
    await expect(acceptInvitation(db, { rawToken: 'rawtok-1', acceptingUserId: a.invitee })).rejects.toThrow()
    // and the invite was NOT consumed (atomic rollback) -> still pending
    const inv = await db.prepare(`SELECT status FROM invitations WHERE tenant_id=? AND email LIKE 'invitee%'`).bind(a.tenantId).first<{ status: string }>()
    expect(inv!.status).toBe('pending')
  })
})

describe('[PR5-5c] account.* emission builders — ban/unban', () => {
  // The emit BUILDERS are the unit-test seam (meta is injectable here). The wiring is INLINE in ban.ts/unban.ts
  // (owner Q1), whose endpoint behavior is locked in admin-users.test.ts. Here we prove the builder mechanism:
  // emit-on-apply / no-emit-on-noop / atomicity, exercised against a single-row gating CAS like the endpoint's.

  it('account.disabled builder emits ONE row (account:<sub>, tenant null, {sub}) gated on the transition CAS', async () => {
    const uid = await user()
    const streamKey = `account:${uid}`
    const gating = db.prepare(`UPDATE users SET status='banned', token_version=token_version+1 WHERE id=? AND status!='banned'`).bind(uid)
    const emit = emitAccountDisabled(db, { targetUserId: uid, actorUserId: 777 }, { eventId: 'acc-d1', occurredAt: '2026-06-03T00:00:00.000Z' })
    await db.batch([gating, ...emit.statements])
    const rows = await outboxRows(streamKey)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('account.disabled')
    expect(rows[0].stream_seq).toBe(1)
    expect(rows[0].tenant_id).toBeNull()
    expect(rows[0].actor_sub).toBe('777')
    expect(JSON.parse(rows[0].data_json)).toEqual({ sub: String(uid) })
    expect(validateDomainEvent(asEnvelope(rows[0])).ok).toBe(true)
  })

  it('account.reenabled builder emits ONE row gated on the banned->active CAS', async () => {
    const uid = await user()
    await db.prepare(`UPDATE users SET status='banned' WHERE id=?`).bind(uid).run()
    const streamKey = `account:${uid}`
    const gating = db.prepare(`UPDATE users SET status='active' WHERE id=? AND status='banned'`).bind(uid)
    const emit = emitAccountReenabled(db, { targetUserId: uid, actorUserId: 777 }, { eventId: 'acc-r1', occurredAt: '2026-06-03T00:00:00.000Z' })
    await db.batch([gating, ...emit.statements])
    const rows = await outboxRows(streamKey)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('account.reenabled')
    expect(rows[0].tenant_id).toBeNull()
    expect(JSON.parse(rows[0].data_json)).toEqual({ sub: String(uid) })
    expect(validateDomainEvent(asEnvelope(rows[0])).ok).toBe(true)
  })

  it('no-emit-on-noop: a 0-row gating CAS bumps no seq and writes no outbox row', async () => {
    const uid = await user()
    await db.prepare(`UPDATE users SET status='banned' WHERE id=?`).bind(uid).run() // already banned -> gating 0-rows
    const streamKey = `account:${uid}`
    const gating = db.prepare(`UPDATE users SET status='banned', token_version=token_version+1 WHERE id=? AND status!='banned'`).bind(uid)
    const emit = emitAccountDisabled(db, { targetUserId: uid, actorUserId: 777 }, { eventId: 'acc-d2', occurredAt: '2026-06-03T00:00:00.000Z' })
    await db.batch([gating, ...emit.statements])
    expect((await outboxRows(streamKey)).length).toBe(0)
    expect(await seqOf(streamKey)).toBeNull()
  })

  it('atomicity: a forced outbox UNIQUE collision rolls the WHOLE batch back (the ban does NOT apply)', async () => {
    const uid = await user()
    const streamKey = `account:${uid}`
    // pre-occupy (streamKey, seq=1) WITHOUT a sequences row, so the fresh seq allocation hits seq=1 -> UNIQUE
    // collision in the outbox insert -> the whole batch (incl. the gating ban UPDATE) rolls back.
    await db.prepare(
      `INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, occurred_at, data_json)
       VALUES ('acc-pre','account.disabled', ?, 1, '2026-06-03T00:00:00Z', '{}')`,
    ).bind(streamKey).run()
    const gating = db.prepare(`UPDATE users SET status='banned' WHERE id=? AND status!='banned'`).bind(uid)
    const emit = emitAccountDisabled(db, { targetUserId: uid, actorUserId: 777 }, { eventId: 'acc-d3', occurredAt: '2026-06-03T00:00:00.000Z' })
    await expect(db.batch([gating, ...emit.statements])).rejects.toThrow()
    const u = await db.prepare(`SELECT status FROM users WHERE id=?`).bind(uid).first<{ status: string }>()
    expect(u!.status).toBe('active') // rolled back
  })
})
