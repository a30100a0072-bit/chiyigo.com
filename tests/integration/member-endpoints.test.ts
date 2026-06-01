/**
 * PR4 member/invitation endpoint integration tests (plan §13).
 *
 * Auth classes (org-create regular-token+idempotency / tenant-scoped requireActiveTenantRole / accept
 * regular-token) + strict body allowlist + outcome->HTTP + audit (org.created ONCE + org.create.replay
 * telemetry on retry) + per-user rate limit. Tenant role is re-derived from DB live (token role irrelevant).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser, seedTenant, seedMembership, seedInvitation } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { buildTokenScope } from '../../functions/utils/scopes'
import { onRequestPost as createTenant } from '../../functions/api/tenants/index'
import { onRequestPost as invite } from '../../functions/api/tenants/[tenantId]/invitations/index'
import { onRequestPost as revoke } from '../../functions/api/tenants/[tenantId]/invitations/[invitationId]/revoke'
import { onRequestGet as listMembers } from '../../functions/api/tenants/[tenantId]/members/index'
import { onRequestPost as memberAction } from '../../functions/api/tenants/[tenantId]/members/[userId]/[action]'
import { onRequestPatch as changeRole } from '../../functions/api/tenants/[tenantId]/members/[userId]/role'
import { onRequestPost as accept } from '../../functions/api/invitations/accept'
import { recordRateLimit } from '../../functions/utils/rate-limit'

const db = env.chiyigo_db
beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })

let _u = 0
async function user(email?: string, emailVerified = 1) {
  const e = email ?? `e${_u++}@x.io`
  const u = await seedUser({ email: e, emailVerified })
  return { id: u.id, email: e }
}
async function token(userId: number) {
  return signJwt({ sub: String(userId), email: 'u@x.io', role: 'player', status: 'active', ver: 0, scope: buildTokenScope('player') }, '15m', env, { audience: 'chiyigo' })
}
function call(handler: (ctx: unknown) => unknown, request: Request, params: Record<string, string> = {}) {
  return handler({ request, env, params, waitUntil: () => {}, next: async () => new Response('next'), data: {} }) as Promise<Response>
}
function req(method: string, tok: string, body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  return new Request('http://localhost/x', init)
}
async function auditCount(eventType: string) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE event_type = ?`).bind(eventType).first()
  return r ? Number(r.c) : 0
}
/** seed an active org with an owner member; returns { tenantId, ownerId }. */
async function orgWithOwner() {
  const owner = await user()
  const t = await seedTenant({ type: 'organization', name: 'Acme', status: 'active' })
  await seedMembership({ tenantId: t.id, userId: owner.id, role: 'tenant_owner', status: 'active' })
  return { tenantId: t.id, ownerId: owner.id }
}

describe('POST /api/tenants (org-create)', () => {
  it('creates -> 201 org.created; same-key retry -> 200 replay, org.created audited ONCE', async () => {
    const o = await user()
    const tok = await token(o.id)
    const r1 = await call(createTenant, req('POST', tok, { name: 'Acme', idempotency_key: 'k' }))
    expect(r1.status).toBe(201)
    const r2 = await call(createTenant, req('POST', tok, { name: 'Acme', idempotency_key: 'k' }))
    expect(r2.status).toBe(200)
    expect((await r2.json() as { replay?: boolean }).replay).toBe(true)
    expect(await auditCount('org.created')).toBe(1)        // R3-F3: never a second org.created
    expect(await auditCount('org.create.replay')).toBe(1)
  })

  it('same key + different payload -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const o = await user()
    const tok = await token(o.id)
    await call(createTenant, req('POST', tok, { name: 'Acme', idempotency_key: 'k' }))
    const r = await call(createTenant, req('POST', tok, { name: 'Globex', idempotency_key: 'k' }))
    expect(r.status).toBe(409)
    expect((await r.json() as { code: string }).code).toBe('IDEMPOTENCY_CONFLICT')
  })

  it('unknown body field -> 400', async () => {
    const o = await user()
    const r = await call(createTenant, req('POST', await token(o.id), { name: 'A', idempotency_key: 'k', evil: 1 }))
    expect(r.status).toBe(400)
  })

  it('per-user rate limit -> 429', async () => {
    const o = await user()
    for (let i = 0; i < 30; i++) await recordRateLimit(db, { kind: 'member_mutate', userId: o.id })
    const r = await call(createTenant, req('POST', await token(o.id), { name: 'A', idempotency_key: 'k' }))
    expect(r.status).toBe(429)
  })
})

describe('POST /api/tenants/:tenantId/invitations (invite)', () => {
  it('owner invites -> 201 + member.invited; pending row created', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    const r = await call(invite, req('POST', await token(ownerId), { email: 'bob@x.io', platform_role: 'member' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(201)
    expect(await auditCount('member.invited')).toBe(1)
    const inv = await db.prepare(`SELECT status FROM invitations WHERE tenant_id = ? AND email = 'bob@x.io'`).bind(tenantId).first()
    expect(inv?.status).toBe('pending')
  })

  it('non-member actor -> 403 + member.denied (gate-failure evidence, Gate-2)', async () => {
    const { tenantId } = await orgWithOwner()
    const stranger = await user()
    const r = await call(invite, req('POST', await token(stranger.id), { email: 'b@x.io', platform_role: 'member' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(403)
    expect(await auditCount('member.denied')).toBe(1)
  })

  it('plain member actor -> 403 + member.denied (owner/admin only)', async () => {
    const { tenantId } = await orgWithOwner()
    const m = await user()
    await seedMembership({ tenantId, userId: m.id, role: 'member', status: 'active' })
    const r = await call(invite, req('POST', await token(m.id), { email: 'b@x.io', platform_role: 'member' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(403)
    expect(await auditCount('member.denied')).toBe(1)
  })

  it('SUSPENDED member attempting a tenant write -> 403 + member.denied (hard-revoke evidence, Gate-2)', async () => {
    const { tenantId } = await orgWithOwner()
    const m = await user()
    await seedMembership({ tenantId, userId: m.id, role: 'tenant_admin', status: 'suspended' })
    const r = await call(invite, req('POST', await token(m.id), { email: 'x@x.io', platform_role: 'member' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(403)
    expect(await auditCount('member.denied')).toBe(1)
    const row = await db.prepare(`SELECT event_data FROM audit_log WHERE event_type = 'member.denied' ORDER BY id DESC LIMIT 1`).first<{ event_data: string }>()
    expect(JSON.parse(row?.event_data ?? '{}').reason_code).toBe('membership_not_active')
  })

  it('unknown body field -> 400', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    const r = await call(invite, req('POST', await token(ownerId), { email: 'b@x.io', platform_role: 'member', x: 1 }), { tenantId: String(tenantId) })
    expect(r.status).toBe(400)
  })
})

describe('POST /api/invitations/accept', () => {
  it('invitee accepts -> 200 joined + member.joined; membership active', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    const bob = await user('bob@x.io', 1)
    await seedInvitation({ tenantId, email: 'bob@x.io', token: 'rawJoin', status: 'pending', invitedBy: ownerId })
    const r = await call(accept, req('POST', await token(bob.id), { token: 'rawJoin' }))
    expect(r.status).toBe(200)
    expect((await r.json() as { tenant_id: number }).tenant_id).toBe(tenantId)
    expect(await auditCount('member.joined')).toBe(1)
    const m = await db.prepare(`SELECT status FROM organization_members WHERE tenant_id = ? AND user_id = ?`).bind(tenantId, bob.id).first()
    expect(m?.status).toBe('active')
  })

  it('unknown token -> 404 + invitation.accept.denied', async () => {
    const bob = await user('bob@x.io', 1)
    const r = await call(accept, req('POST', await token(bob.id), { token: 'nope' }))
    expect(r.status).toBe(404)
    expect(await auditCount('invitation.accept.denied')).toBe(1)
  })
})

describe('member mutations + role', () => {
  it('owner suspends a member -> 200 + member.suspended', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    const m = await user()
    await seedMembership({ tenantId, userId: m.id, role: 'member', status: 'active' })
    const r = await call(memberAction, req('POST', await token(ownerId)), { tenantId: String(tenantId), userId: String(m.id), action: 'suspend' })
    expect(r.status).toBe(200)
    expect(await auditCount('member.suspended')).toBe(1)
  })

  it('plain member cannot suspend (owner-only) -> 403', async () => {
    const { tenantId } = await orgWithOwner()
    const m1 = await user(); const m2 = await user()
    await seedMembership({ tenantId, userId: m1.id, role: 'member', status: 'active' })
    await seedMembership({ tenantId, userId: m2.id, role: 'member', status: 'active' })
    const r = await call(memberAction, req('POST', await token(m1.id)), { tenantId: String(tenantId), userId: String(m2.id), action: 'suspend' })
    expect(r.status).toBe(403)
    expect(await auditCount('member.denied')).toBe(1) // gate-failure evidence (insufficient_role), Gate-2
  })

  it('owner offboards a SECOND owner -> 200 (allowed; >=1 owner remains). NOTE: last_owner_protected is domain-tested', async () => {
    // Under owner-only + self-guard, last_owner_protected is endpoint-UNREACHABLE (removing the sole owner needs
    // either self (cannot_target_self) or a non-owner actor (403 before the domain)); the 409 path is covered in
    // members.test.ts at the domain layer. The endpoint-reachable owner case is the multi-owner offboard:
    const { tenantId, ownerId: ownerA } = await orgWithOwner()
    const ownerB = await user()
    await seedMembership({ tenantId, userId: ownerB.id, role: 'tenant_owner', status: 'active' })
    const r = await call(memberAction, req('POST', await token(ownerA)), { tenantId: String(tenantId), userId: String(ownerB.id), action: 'offboard' })
    expect(r.status).toBe(200)
    const remaining = await db.prepare(`SELECT COUNT(*) AS c FROM organization_members WHERE tenant_id = ? AND platform_role = 'tenant_owner' AND status = 'active'`).bind(tenantId).first()
    expect(Number(remaining?.c)).toBe(1)
  })

  it('self-guard via endpoint: owner offboarding SELF -> 409 CANNOT_TARGET_SELF', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    const r = await call(memberAction, req('POST', await token(ownerId)), { tenantId: String(tenantId), userId: String(ownerId), action: 'offboard' })
    expect(r.status).toBe(409)
    expect((await r.json() as { code: string }).code).toBe('CANNOT_TARGET_SELF')
  })

  it('owner changes a member role -> 200 + member.role_changed', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    const m = await user()
    await seedMembership({ tenantId, userId: m.id, role: 'member', status: 'active' })
    const r = await call(changeRole, req('PATCH', await token(ownerId), { platform_role: 'tenant_admin' }), { tenantId: String(tenantId), userId: String(m.id) })
    expect(r.status).toBe(200)
    expect(await auditCount('member.role_changed')).toBe(1)
  })

  it('same-role PATCH -> 200 no_op, NO member.role_changed audit (Gate-2)', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    const m = await user()
    await seedMembership({ tenantId, userId: m.id, role: 'billing_admin', status: 'active' })
    const r = await call(changeRole, req('PATCH', await token(ownerId), { platform_role: 'billing_admin' }), { tenantId: String(tenantId), userId: String(m.id) })
    expect(r.status).toBe(200)
    expect((await r.json() as { no_op?: boolean }).no_op).toBe(true)
    expect(await auditCount('member.role_changed')).toBe(0) // same-role never pollutes the immutable trail
  })

  it('GET members lists active members + pending invitations', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    await seedInvitation({ tenantId, email: 'p@x.io', token: 'rawP', status: 'pending', invitedBy: ownerId })
    const r = await call(listMembers, req('GET', await token(ownerId)), { tenantId: String(tenantId) })
    expect(r.status).toBe(200)
    const body = await r.json() as { members: unknown[]; pending_invitations: unknown[] }
    expect(body.members.length).toBeGreaterThanOrEqual(1)
    expect(body.pending_invitations.length).toBe(1)
  })

  it('revoke a pending invite -> 200 + invitation.revoked', async () => {
    const { tenantId, ownerId } = await orgWithOwner()
    const seeded = await seedInvitation({ tenantId, email: 'r@x.io', token: 'rawR', status: 'pending', invitedBy: ownerId })
    const r = await call(revoke, req('POST', await token(ownerId)), { tenantId: String(tenantId), invitationId: String(seeded.id) })
    expect(r.status).toBe(200)
    expect(await auditCount('invitation.revoked')).toBe(1)
  })
})
