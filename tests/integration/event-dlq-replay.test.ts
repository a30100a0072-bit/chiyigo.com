/**
 * PR5 5b DLQ replay endpoint (functions/api/admin/event-dlq/[id]/replay.ts).
 * Double-gate authz (step-up elevated:events + admin:events:replay) + C2 atomic CAS-gated transition
 * (double-replay / stale-on-done / non-dead all 409) + redaction (stream_key_hash only).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { buildTokenScope } from '../../functions/utils/scopes'
import { onRequestPost as replayHandler } from '../../functions/api/admin/event-dlq/[id]/replay'

const db = env.chiyigo_db
beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })

async function stepUp(userId: number, opts: { scope?: string; action?: string; role?: string; email?: string } = {}): Promise<string> {
  const { scope = 'elevated:events', action = 'event_dlq_replay', role = 'admin', email = 'admin@x.io' } = opts
  return signJwt({ sub: String(userId), email, role, status: 'active', ver: 0, scope, for_action: action, amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' }, '5m', env, { audience: 'chiyigo' })
}
async function accessToken(userId: number, role = 'admin', email = 'admin@x.io'): Promise<string> {
  return signJwt({ sub: String(userId), email, role, status: 'active', ver: 0, scope: buildTokenScope(role) }, '15m', env, { audience: 'chiyigo' })
}
function call(request: Request, id: number): Promise<Response> {
  return (replayHandler as (ctx: unknown) => Promise<Response>)({ request, env, params: { id: String(id) }, waitUntil: () => {}, next: async () => new Response('next'), data: {} })
}
function post(token: string): Request {
  return new Request('http://localhost/api/admin/event-dlq/x/replay', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
}

const SK = 'tenant:1:member:42'
async function seedDead(eventId = 'ev-dead-1', status = 'dead'): Promise<number> {
  await db.prepare(`INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, tenant_id, actor_sub, occurred_at, data_json, status, attempts) VALUES (?, 'member.suspended', ?, 1, 1, 'a', '2026-06-02T00:00:00Z', '{}', ?, 6)`).bind(eventId, SK, status).run()
  const r = await db.prepare(`INSERT INTO event_dlq (event_id, event_type, stream_key, stream_seq, tenant_id, actor_sub, occurred_at, data_json, dlq_reason, attempts) VALUES (?, 'member.suspended', ?, 1, 1, 'a', '2026-06-02T00:00:00Z', '{}', 'max_attempts', 6)`).bind(eventId, SK).run()
  return Number(r.meta.last_row_id)
}
async function outboxStatus(eventId = 'ev-dead-1') { return (await db.prepare(`SELECT status, attempts FROM event_outbox WHERE event_id=?`).bind(eventId).first<{ status: string; attempts: number }>())! }
async function dlqReplayed(dlqId: number) { return (await db.prepare(`SELECT replayed_at, replayed_by FROM event_dlq WHERE id=?`).bind(dlqId).first<{ replayed_at: string | null; replayed_by: number | null }>())! }

describe('[PR5-5b] DLQ replay endpoint', () => {
  let adminId: number, financeId: number, supportId: number
  beforeEach(async () => {
    adminId = (await seedUser({ email: 'admin@x.io', role: 'admin' })).id
    financeId = (await seedUser({ email: 'fin@x.io', role: 'finance' })).id
    supportId = (await seedUser({ email: 'sup@x.io', role: 'support' })).id
  })

  it('happy: replays a dead event -> 200, outbox reset to pending(attempts=0), dlq stamped', async () => {
    const dlqId = await seedDead()
    const r = await call(post(await stepUp(adminId)), dlqId)
    expect(r.status).toBe(200)
    expect(await outboxStatus()).toEqual({ status: 'pending', attempts: 0 })
    const d = await dlqReplayed(dlqId)
    expect(d.replayed_at).not.toBeNull()
    expect(d.replayed_by).toBe(adminId)
  })

  it('C2 double-replay: second replay (fresh step-up) -> 409, no second reset', async () => {
    const dlqId = await seedDead()
    expect((await call(post(await stepUp(adminId)), dlqId)).status).toBe(200)
    // mark the re-enqueued outbox done, so a stale second replay must NOT reset it back to pending
    await db.prepare(`UPDATE event_outbox SET status='done' WHERE event_id='ev-dead-1'`).run()
    const r2 = await call(post(await stepUp(adminId)), dlqId)
    expect(r2.status).toBe(409)
    expect((await outboxStatus()).status).toBe('done') // NOT reset by the stale replay
  })

  it('C2 outbox not dead -> 409 no-op (no reset)', async () => {
    const dlqId = await seedDead('ev-live', 'pending') // outbox is 'pending', not 'dead'
    const r = await call(post(await stepUp(adminId)), dlqId)
    expect(r.status).toBe(409)
    expect((await outboxStatus('ev-live')).status).toBe('pending')
  })

  it('404 when the DLQ row does not exist', async () => {
    expect((await call(post(await stepUp(adminId)), 99999)).status).toBe(404)
  })

  it('authz: regular access token (no step-up) -> not 200', async () => {
    const dlqId = await seedDead()
    expect((await call(post(await accessToken(adminId)), dlqId)).status).not.toBe(200)
  })

  it('authz: step-up but role lacks admin:events:replay (finance / support) -> 403', async () => {
    const dlqId = await seedDead()
    expect((await call(post(await stepUp(financeId, { role: 'finance', email: 'fin@x.io' })), dlqId)).status).toBe(403)
    expect((await call(post(await stepUp(supportId, { role: 'support', email: 'sup@x.io' })), dlqId)).status).toBe(403)
  })

  it('authz: wrong for_action -> not 200', async () => {
    const dlqId = await seedDead()
    expect((await call(post(await stepUp(adminId, { action: 'wallet_topup' })), dlqId)).status).not.toBe(200)
  })

  it('redaction: audit logs stream_key_hash, never the raw stream_key', async () => {
    const dlqId = await seedDead()
    await call(post(await stepUp(adminId)), dlqId)
    const row = await db.prepare(`SELECT event_data FROM audit_log WHERE event_type='domain.event.replay' ORDER BY id DESC LIMIT 1`).first<{ event_data: string }>()
    expect(row).not.toBeNull()
    expect(row!.event_data).toContain('stream_key_hash')
    expect(row!.event_data).not.toContain(SK) // no raw streamKey
  })
})
