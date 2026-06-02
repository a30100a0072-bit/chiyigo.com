/**
 * PR5 5b — member.invited emission (the SQL-derived read-your-writes path deferred from 5a). createInvitation
 * emits member.invited in the SAME batch as the invite INSERT, with invitationId read back from the just-inserted
 * row (it does not exist before the INSERT). streamKey is email-keyed, 'none' deny-effect.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedTenant } from './_helpers'
import { createInvitation } from '../../functions/utils/invitations'
import { validateDomainEvent } from '../../functions/utils/domain-events'

const db = env.chiyigo_db
beforeEach(async () => { await resetDb() })

interface Row { event_id: string; event_type: string; stream_key: string; stream_seq: number; tenant_id: number | null; actor_sub: string | null; occurred_at: string; data_json: string }
async function rows(streamKey: string): Promise<Row[]> {
  return ((await db.prepare(`SELECT * FROM event_outbox WHERE stream_key=? ORDER BY stream_seq`).bind(streamKey).all<Row>()).results) ?? []
}

describe('[PR5-5b] member.invited emission', () => {
  it('createInvitation emits member.invited with the REAL (post-insert) invitationId + valid contract', async () => {
    const inviter = await seedUser({ email: 'owner@x.io' })
    const t = await seedTenant({ type: 'organization' })
    const r = await createInvitation(db, { tenantId: t.id, email: 'invitee@x.io', platformRole: 'member', invitedByUserId: inviter.id })
    expect(r.outcome).toBe('created')
    const invitationId = r.outcome === 'created' ? r.invitationId : 0
    const sk = `tenant:${t.id}:member:invitee@x.io`
    const out = await rows(sk)
    expect(out.length).toBe(1)
    expect(out[0].event_type).toBe('member.invited')
    expect(out[0].stream_seq).toBe(1)
    expect(out[0].actor_sub).toBe(String(inviter.id))
    const data = JSON.parse(out[0].data_json)
    expect(data).toEqual({ invitationId, email: 'invitee@x.io', platformRole: 'member' }) // invitationId SQL-derived
    const v = validateDomainEvent({ v: 1, eventId: out[0].event_id, eventType: out[0].event_type, streamKey: out[0].stream_key, streamSeq: out[0].stream_seq, occurredAt: out[0].occurred_at, tenantId: out[0].tenant_id, actorSub: out[0].actor_sub, data })
    expect(v.ok).toBe(true)
  })

  it('re-invite (same email supersedes) emits a SECOND member.invited at contiguous seq 2', async () => {
    const inviter = await seedUser({ email: 'owner@x.io' })
    const t = await seedTenant({ type: 'organization' })
    await createInvitation(db, { tenantId: t.id, email: 'invitee@x.io', platformRole: 'member', invitedByUserId: inviter.id })
    await createInvitation(db, { tenantId: t.id, email: 'invitee@x.io', platformRole: 'tenant_admin', invitedByUserId: inviter.id })
    const out = await rows(`tenant:${t.id}:member:invitee@x.io`)
    expect(out.map(r => r.stream_seq)).toEqual([1, 2])
    expect(out.map(r => r.event_type)).toEqual(['member.invited', 'member.invited'])
  })
})
