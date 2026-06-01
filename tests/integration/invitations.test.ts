/**
 * PR4 invitation lifecycle domain tests (plan §13).
 *
 * create (hashed token, lowercased email, owner-role rejected, already_member, supersede) + accept (atomic
 * one-time consume + plain INSERT join; negatives expired/revoked/email_mismatch/email_unverified/already_member/
 * not_found; accepted-replay gated on live membership: active->replay, suspended->MEMBERSHIP_NOT_ACTIVE,
 * offboarded->already_resolved; concurrent double-accept) + revoke (incl. cross-tenant guard) + list.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedTenant, seedMembership, seedInvitation } from './_helpers'
import { hashToken } from '../../functions/utils/crypto'
import {
  createInvitation, acceptInvitation, revokeInvitation, listPendingInvitations,
} from '../../functions/utils/invitations'
import { suspendMember, offboardMember } from '../../functions/utils/members'

const db = env.chiyigo_db
beforeEach(async () => { await resetDb() })

let _u = 0
async function user(email?: string, emailVerified = 1): Promise<{ id: number; email: string }> {
  const e = email ?? `inv${_u++}@x.io`
  const u = await seedUser({ email: e, emailVerified })
  return { id: u.id, email: e }
}
async function orgTenant(status = 'active'): Promise<number> {
  const t = await seedTenant({ type: 'organization', name: 'Acme', status })
  return t.id
}
async function inviteRow(tokenHash: string) {
  return db.prepare(`SELECT email, platform_role, status FROM invitations WHERE token_hash = ?`).bind(tokenHash).first<{ email: string; platform_role: string; status: string }>()
}
async function pendingCount(tenantId: number, email: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM invitations WHERE tenant_id = ? AND email = ? AND status = 'pending'`).bind(tenantId, email).first<{ c: number }>()
  return Number(r?.c ?? 0)
}
async function membership(tenantId: number, userId: number) {
  return db.prepare(`SELECT status, platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?`).bind(tenantId, userId).first<{ status: string; platform_role: string }>()
}

describe('createInvitation', () => {
  it('creates a pending invite with a hashed token + lowercased email', async () => {
    const owner = await user()
    const tid = await orgTenant()
    const r = await createInvitation(db, { tenantId: tid, email: 'BOB@X.io', platformRole: 'member', invitedByUserId: owner.id })
    expect(r.outcome).toBe('created')
    if (r.outcome !== 'created') return
    expect(r.invitationId).toBeGreaterThan(0)
    expect(r.rawToken).toMatch(/^[0-9a-f]{64}$/) // 32-byte hex
    const row = await inviteRow(await hashToken(r.rawToken))
    expect(row).toEqual({ email: 'bob@x.io', platform_role: 'member', status: 'pending' }) // stored hashed + lowercased
  })

  it('rejects platform_role=tenant_owner (cannot invite to owner)', async () => {
    const owner = await user()
    const tid = await orgTenant()
    expect((await createInvitation(db, { tenantId: tid, email: 'a@x.io', platformRole: 'tenant_owner', invitedByUserId: owner.id })).outcome).toBe('invalid')
  })

  it('rejects an already-active/suspended member email (already_member)', async () => {
    const owner = await user()
    const tid = await orgTenant()
    const bob = await user('bob@x.io')
    await seedMembership({ tenantId: tid, userId: bob.id, role: 'member', status: 'active' })
    expect((await createInvitation(db, { tenantId: tid, email: 'bob@x.io', platformRole: 'member', invitedByUserId: owner.id })).outcome).toBe('already_member')
  })

  it('re-invite supersedes the old pending (exactly one live invite)', async () => {
    const owner = await user()
    const tid = await orgTenant()
    const first = await createInvitation(db, { tenantId: tid, email: 'c@x.io', platformRole: 'member', invitedByUserId: owner.id })
    const second = await createInvitation(db, { tenantId: tid, email: 'c@x.io', platformRole: 'tenant_admin', invitedByUserId: owner.id })
    expect(first.outcome).toBe('created')
    expect(second.outcome).toBe('created')
    expect(await pendingCount(tid, 'c@x.io')).toBe(1)
    if (first.outcome === 'created') expect((await inviteRow(await hashToken(first.rawToken)))?.status).toBe('revoked')
  })

  it('rejects a non-active / non-org tenant (tenant_ineligible)', async () => {
    const owner = await user()
    const suspended = await orgTenant('suspended')
    expect((await createInvitation(db, { tenantId: suspended, email: 'a@x.io', platformRole: 'member', invitedByUserId: owner.id })).outcome).toBe('tenant_ineligible')
  })
})

describe('acceptInvitation', () => {
  async function setup(opts: { inviteeEmail?: string; inviteeVerified?: number } = {}) {
    const owner = await user()
    const tid = await orgTenant()
    const invitee = await user(opts.inviteeEmail ?? 'bob@x.io', opts.inviteeVerified ?? 1)
    return { owner, tid, invitee }
  }

  it('happy: consumes the invite + creates an active membership, exactly once', async () => {
    const { owner, tid, invitee } = await setup()
    const inv = await createInvitation(db, { tenantId: tid, email: 'bob@x.io', platformRole: 'member', invitedByUserId: owner.id })
    if (inv.outcome !== 'created') throw new Error('seed failed')
    const acc = await acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: invitee.id })
    expect(acc).toEqual({ outcome: 'joined', tenantId: tid, platformRole: 'member', sub: String(invitee.id) })
    expect(await membership(tid, invitee.id)).toEqual({ status: 'active', platform_role: 'member' })
    expect((await inviteRow(await hashToken(inv.rawToken)))?.status).toBe('accepted')
  })

  it('email mismatch (different account email) -> email_mismatch', async () => {
    const { owner, tid } = await setup()
    const eve = await user('eve@x.io')
    const inv = await createInvitation(db, { tenantId: tid, email: 'bob@x.io', platformRole: 'member', invitedByUserId: owner.id })
    if (inv.outcome !== 'created') throw new Error('seed')
    expect((await acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: eve.id })).outcome).toBe('email_mismatch')
    expect(await membership(tid, eve.id)).toBeNull()
  })

  it('matching email but UNVERIFIED -> email_mismatch', async () => {
    const { owner, tid, invitee } = await setup({ inviteeVerified: 0 })
    const inv = await createInvitation(db, { tenantId: tid, email: 'bob@x.io', platformRole: 'member', invitedByUserId: owner.id })
    if (inv.outcome !== 'created') throw new Error('seed')
    expect((await acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: invitee.id })).outcome).toBe('email_mismatch')
  })

  it('expired pending invite -> expired', async () => {
    const { owner, tid, invitee } = await setup()
    await seedInvitation({ tenantId: tid, email: 'bob@x.io', token: 'rawExpired', status: 'pending', expiresAt: '2000-01-01 00:00:00', invitedBy: owner.id })
    expect((await acceptInvitation(db, { rawToken: 'rawExpired', acceptingUserId: invitee.id })).outcome).toBe('expired')
  })

  it('revoked invite -> already_resolved; unknown token -> not_found', async () => {
    const { owner, tid, invitee } = await setup()
    await seedInvitation({ tenantId: tid, email: 'bob@x.io', token: 'rawRevoked', status: 'revoked', invitedBy: owner.id })
    expect((await acceptInvitation(db, { rawToken: 'rawRevoked', acceptingUserId: invitee.id })).outcome).toBe('already_resolved')
    expect((await acceptInvitation(db, { rawToken: 'nope', acceptingUserId: invitee.id })).outcome).toBe('not_found')
  })

  it('already a member (pending invite seeded around it) -> already_member, no double row', async () => {
    const { owner, tid, invitee } = await setup()
    await seedMembership({ tenantId: tid, userId: invitee.id, role: 'member', status: 'active' })
    await seedInvitation({ tenantId: tid, email: 'bob@x.io', token: 'rawAM', status: 'pending', invitedBy: owner.id })
    expect((await acceptInvitation(db, { rawToken: 'rawAM', acceptingUserId: invitee.id })).outcome).toBe('already_member')
  })

  it('accepted-by-self replay: ACTIVE -> replay; SUSPENDED -> membership_not_active; OFFBOARDED -> already_resolved (R3)', async () => {
    const { owner, tid, invitee } = await setup()
    const inv = await createInvitation(db, { tenantId: tid, email: 'bob@x.io', platformRole: 'member', invitedByUserId: owner.id })
    if (inv.outcome !== 'created') throw new Error('seed')
    expect((await acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: invitee.id })).outcome).toBe('joined')

    // re-click while ACTIVE -> replay
    const replay = await acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: invitee.id })
    expect(replay.outcome).toBe('replay')

    // suspend, then re-click -> membership_not_active (NOT ok:true, NOT reactivated)
    await suspendMember(db, { tenantId: tid, targetUserId: invitee.id, actorUserId: owner.id })
    expect((await acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: invitee.id })).outcome).toBe('membership_not_active')
    expect((await membership(tid, invitee.id))?.status).toBe('suspended') // still suspended

    // offboard (row gone), then re-click -> already_resolved (needs a fresh invite)
    await offboardMember(db, { tenantId: tid, targetUserId: invitee.id, actorUserId: owner.id })
    expect((await acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: invitee.id })).outcome).toBe('already_resolved')
    expect(await membership(tid, invitee.id)).toBeNull()
  })

  it('concurrent double-accept of the same token -> exactly one joins, exactly one membership row', async () => {
    const { owner, tid, invitee } = await setup()
    const inv = await createInvitation(db, { tenantId: tid, email: 'bob@x.io', platformRole: 'member', invitedByUserId: owner.id })
    if (inv.outcome !== 'created') throw new Error('seed')
    const [r1, r2] = await Promise.all([
      acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: invitee.id }),
      acceptInvitation(db, { rawToken: inv.rawToken, acceptingUserId: invitee.id }),
    ])
    const joins = [r1, r2].filter((r) => r.outcome === 'joined')
    expect(joins.length).toBe(1)
    expect(r1.outcome === 'joined' || r1.outcome === 'replay' || r1.outcome === 'already_member').toBe(true)
    expect(r2.outcome === 'joined' || r2.outcome === 'replay' || r2.outcome === 'already_member').toBe(true)
    const cnt = await db.prepare(`SELECT COUNT(*) AS c FROM organization_members WHERE tenant_id = ? AND user_id = ?`).bind(tid, invitee.id).first<{ c: number }>()
    expect(Number(cnt?.c)).toBe(1)
  })
})

describe('revokeInvitation + list', () => {
  it('revokes a pending invite; non-pending -> not_pending; wrong tenant / id -> not_found', async () => {
    const owner = await user()
    const tid = await orgTenant()
    const otherTid = await orgTenant()
    const inv = await createInvitation(db, { tenantId: tid, email: 'd@x.io', platformRole: 'member', invitedByUserId: owner.id })
    if (inv.outcome !== 'created') throw new Error('seed')
    // cross-tenant guard: revoking via the wrong tenant id -> not_found
    expect((await revokeInvitation(db, { tenantId: otherTid, invitationId: inv.invitationId, actorUserId: owner.id })).outcome).toBe('not_found')
    expect((await revokeInvitation(db, { tenantId: tid, invitationId: inv.invitationId, actorUserId: owner.id })).outcome).toBe('revoked')
    expect((await revokeInvitation(db, { tenantId: tid, invitationId: inv.invitationId, actorUserId: owner.id })).outcome).toBe('not_pending')
    expect((await revokeInvitation(db, { tenantId: tid, invitationId: 999999, actorUserId: owner.id })).outcome).toBe('not_found')
  })

  it('lists pending invites (DTO, no token_hash)', async () => {
    const owner = await user()
    const tid = await orgTenant()
    await createInvitation(db, { tenantId: tid, email: 'e1@x.io', platformRole: 'member', invitedByUserId: owner.id })
    await createInvitation(db, { tenantId: tid, email: 'e2@x.io', platformRole: 'tenant_admin', invitedByUserId: owner.id })
    const list = await listPendingInvitations(db, tid)
    expect(list.length).toBe(2)
    expect(Object.keys(list[0])).not.toContain('token_hash')
    expect(list.map((i) => i.email).sort()).toEqual(['e1@x.io', 'e2@x.io'])
  })
})
