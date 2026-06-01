/**
 * PR4 member lifecycle domain tests (plan §13).
 *
 * createOrgTenant durable idempotency (atomic tenant+owner+op-row; replay/conflict/concurrent)
 *   + suspend/reactivate/offboard/role-change + STATEMENT-LEVEL last-owner protection (incl. concurrent
 *   two-owner mutual removal) + personal-tenant rejection + self-guard + illegal/not_a_member.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedTenant, seedMembership } from './_helpers'
import {
  createOrgTenant, suspendMember, reactivateMember, offboardMember, changeMemberRole,
} from '../../functions/utils/members'

const db = env.chiyigo_db
beforeEach(async () => { await resetDb() })

let _u = 0
async function user(role: string | null = null): Promise<number> {
  const u = await seedUser({ email: `m${_u++}@x.io`, role: role ?? undefined })
  return u.id
}
async function memberRow(tenantId: number, userId: number) {
  return db.prepare(`SELECT status, platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?`)
    .bind(tenantId, userId).first<{ status: string; platform_role: string }>()
}
async function activeOwnerCount(tenantId: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM organization_members WHERE tenant_id = ? AND platform_role = 'tenant_owner' AND status = 'active'`)
    .bind(tenantId).first<{ c: number }>()
  return Number(r?.c ?? 0)
}
async function orgTenantCount(): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM tenants WHERE type = 'organization'`).first<{ c: number }>()
  return Number(r?.c ?? 0)
}

describe('createOrgTenant durable idempotency', () => {
  it('creates the org tenant + the creator as active owner + one op row (atomic)', async () => {
    const creator = await user()
    const r = await createOrgTenant(db, { name: 'Acme', creatorUserId: creator, idempotencyKey: 'k1' })
    expect(r.outcome).toBe('created')
    const tid = r.outcome === 'created' ? r.tenantId : 0
    expect(tid).toBeGreaterThan(0)
    const t = await db.prepare(`SELECT type, status FROM tenants WHERE id = ?`).bind(tid).first<{ type: string; status: string }>()
    expect(t).toEqual({ type: 'organization', status: 'active' })
    expect(await memberRow(tid, creator)).toEqual({ status: 'active', platform_role: 'tenant_owner' })
    const ops = await db.prepare(`SELECT COUNT(*) AS c FROM org_create_operations WHERE creator_user_id = ? AND idempotency_key = 'k1'`).bind(creator).first<{ c: number }>()
    expect(Number(ops?.c)).toBe(1)
  })

  it('same key + same name -> replay SAME tenant_id, no second tenant (timeout-retry safe)', async () => {
    const creator = await user()
    const a = await createOrgTenant(db, { name: 'Acme', creatorUserId: creator, idempotencyKey: 'k' })
    const b = await createOrgTenant(db, { name: 'Acme', creatorUserId: creator, idempotencyKey: 'k' })
    expect(a.outcome).toBe('created')
    expect(b.outcome).toBe('replay')
    expect((a as { tenantId: number }).tenantId).toBe((b as { tenantId: number }).tenantId)
    expect(await orgTenantCount()).toBe(1)
  })

  it('same key + DIFFERENT name -> conflict, no new tenant', async () => {
    const creator = await user()
    await createOrgTenant(db, { name: 'Acme', creatorUserId: creator, idempotencyKey: 'k' })
    const b = await createOrgTenant(db, { name: 'Globex', creatorUserId: creator, idempotencyKey: 'k' })
    expect(b.outcome).toBe('conflict')
    expect(await orgTenantCount()).toBe(1)
  })

  it('concurrent same-key -> exactly one tenant created, the other replays (UNIQUE arbiter)', async () => {
    const creator = await user()
    const [r1, r2] = await Promise.all([
      createOrgTenant(db, { name: 'Acme', creatorUserId: creator, idempotencyKey: 'kc' }),
      createOrgTenant(db, { name: 'Acme', creatorUserId: creator, idempotencyKey: 'kc' }),
    ])
    const outcomes = [r1.outcome, r2.outcome].sort()
    expect(outcomes).toEqual(['created', 'replay'])
    expect((r1 as { tenantId: number }).tenantId).toBe((r2 as { tenantId: number }).tenantId)
    expect(await orgTenantCount()).toBe(1)
  })

  it('different key -> a second legitimate tenant', async () => {
    const creator = await user()
    await createOrgTenant(db, { name: 'Acme', creatorUserId: creator, idempotencyKey: 'k1' })
    const b = await createOrgTenant(db, { name: 'Acme2', creatorUserId: creator, idempotencyKey: 'k2' })
    expect(b.outcome).toBe('created')
    expect(await orgTenantCount()).toBe(2)
  })

  it('rejects invalid input', async () => {
    const creator = await user()
    expect((await createOrgTenant(db, { name: '   ', creatorUserId: creator, idempotencyKey: 'k' })).outcome).toBe('invalid')
    expect((await createOrgTenant(db, { name: 'A', creatorUserId: creator, idempotencyKey: '' })).outcome).toBe('invalid')
  })
})

describe('member transitions + last-owner protection', () => {
  // org with a primary owner + helpers to add members
  async function org() {
    const owner = await user()
    const r = await createOrgTenant(db, { name: 'Acme', creatorUserId: owner, idempotencyKey: `seed-${owner}` })
    const tenantId = (r as { tenantId: number }).tenantId
    return { tenantId, owner }
  }
  async function addMember(tenantId: number, role = 'member', status = 'active') {
    const uid = await user()
    await seedMembership({ tenantId, userId: uid, role, status })
    return uid
  }

  it('suspend -> reactivate happy path (a plain member)', async () => {
    const { tenantId, owner } = await org()
    const m = await addMember(tenantId)
    expect((await suspendMember(db, { tenantId, targetUserId: m, actorUserId: owner })).outcome).toBe('applied')
    expect((await memberRow(tenantId, m))?.status).toBe('suspended')
    expect((await reactivateMember(db, { tenantId, targetUserId: m, actorUserId: owner })).outcome).toBe('applied')
    expect((await memberRow(tenantId, m))?.status).toBe('active')
  })

  it('offboard DELETEs the membership row', async () => {
    const { tenantId, owner } = await org()
    const m = await addMember(tenantId)
    expect((await offboardMember(db, { tenantId, targetUserId: m, actorUserId: owner })).outcome).toBe('applied')
    expect(await memberRow(tenantId, m)).toBeNull()
  })

  it('changeMemberRole promotes a member to tenant_admin', async () => {
    const { tenantId, owner } = await org()
    const m = await addMember(tenantId)
    const r = await changeMemberRole(db, { tenantId, targetUserId: m, actorUserId: owner, toRole: 'tenant_admin' })
    expect(r.outcome).toBe('applied')
    expect((await memberRow(tenantId, m))?.platform_role).toBe('tenant_admin')
  })

  it('changeMemberRole to the SAME role -> no_op (no write, Gate-2)', async () => {
    const { tenantId, owner } = await org()
    const m = await addMember(tenantId, 'billing_admin')
    const before = await db.prepare(`SELECT updated_at FROM organization_members WHERE tenant_id = ? AND user_id = ?`).bind(tenantId, m).first<{ updated_at: string }>()
    const r = await changeMemberRole(db, { tenantId, targetUserId: m, actorUserId: owner, toRole: 'billing_admin' })
    expect(r.outcome).toBe('no_op')
    const after = await db.prepare(`SELECT updated_at, platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?`).bind(tenantId, m).first<{ updated_at: string; platform_role: string }>()
    expect(after?.platform_role).toBe('billing_admin')
    expect(after?.updated_at).toBe(before?.updated_at) // NO DB write
  })

  it('LAST-OWNER protection: cannot suspend/offboard/demote the only active owner', async () => {
    const { tenantId, owner } = await org()
    // owner acts on a second owner-target == cannot target self, so use a distinct actor (another owner-capable admin)
    const actor = await addMember(tenantId, 'tenant_admin')
    expect((await suspendMember(db, { tenantId, targetUserId: owner, actorUserId: actor })).outcome).toBe('last_owner_protected')
    expect((await offboardMember(db, { tenantId, targetUserId: owner, actorUserId: actor })).outcome).toBe('last_owner_protected')
    expect((await changeMemberRole(db, { tenantId, targetUserId: owner, actorUserId: actor, toRole: 'member' })).outcome).toBe('last_owner_protected')
    expect(await activeOwnerCount(tenantId)).toBe(1) // still there
  })

  it('with a SECOND active owner, suspending/demoting the first is allowed', async () => {
    const { tenantId, owner } = await org()
    const owner2 = await addMember(tenantId, 'tenant_owner')
    expect((await suspendMember(db, { tenantId, targetUserId: owner, actorUserId: owner2 })).outcome).toBe('applied')
    expect(await activeOwnerCount(tenantId)).toBe(1) // owner2 remains
  })

  it('CONCURRENT two-owner mutual removal: exactly one applies, the other last_owner_protected, >=1 owner remains', async () => {
    const { tenantId, owner } = await org()
    const owner2 = await addMember(tenantId, 'tenant_owner')
    const [r1, r2] = await Promise.all([
      suspendMember(db, { tenantId, targetUserId: owner2, actorUserId: owner }),
      suspendMember(db, { tenantId, targetUserId: owner, actorUserId: owner2 }),
    ])
    const outcomes = [r1.outcome, r2.outcome].sort()
    expect(outcomes).toEqual(['applied', 'last_owner_protected'])
    expect(await activeOwnerCount(tenantId)).toBe(1)
  })

  it('rejects member ops on a PERSONAL tenant', async () => {
    const owner = await user()
    const pt = await seedTenant({ type: 'personal', name: 'Personal', ownerUserId: owner })
    await seedMembership({ tenantId: pt.id, userId: owner, role: 'tenant_owner', status: 'active' })
    expect((await suspendMember(db, { tenantId: pt.id, targetUserId: owner, actorUserId: owner })).outcome).toBe('personal_tenant_immutable')
  })

  it('self-action guard: actor cannot suspend/offboard/change-role on themselves', async () => {
    const { tenantId, owner } = await org()
    expect((await suspendMember(db, { tenantId, targetUserId: owner, actorUserId: owner })).outcome).toBe('cannot_target_self')
    expect((await offboardMember(db, { tenantId, targetUserId: owner, actorUserId: owner })).outcome).toBe('cannot_target_self')
    expect((await changeMemberRole(db, { tenantId, targetUserId: owner, actorUserId: owner, toRole: 'member' })).outcome).toBe('cannot_target_self')
  })

  it('illegal transition + not_a_member', async () => {
    const { tenantId, owner } = await org()
    const m = await addMember(tenantId)
    // reactivate an ALREADY-active member -> illegal_transition
    expect((await reactivateMember(db, { tenantId, targetUserId: m, actorUserId: owner })).outcome).toBe('illegal_transition')
    // suspend a non-member -> not_a_member
    const stranger = await user()
    expect((await suspendMember(db, { tenantId, targetUserId: stranger, actorUserId: owner })).outcome).toBe('not_a_member')
  })

  it('offboard then re-onboard via a fresh membership inserts cleanly (DELETE left no row)', async () => {
    const { tenantId, owner } = await org()
    const m = await addMember(tenantId)
    await offboardMember(db, { tenantId, targetUserId: m, actorUserId: owner })
    expect(await memberRow(tenantId, m)).toBeNull()
    // a fresh membership insert (what accept would do) succeeds with no UNIQUE conflict
    await seedMembership({ tenantId, userId: m, role: 'member', status: 'active' })
    expect((await memberRow(tenantId, m))?.status).toBe('active')
  })
})
