/**
 * EVT-001b — GET /api/admin/event-dlq list endpoint.
 * Gate: requireRole(admin) + admin:events:replay (no step-up). Redacted DTO (stream_key_hash only, NO raw
 * stream_key / data_json). Deterministic ORDER BY id DESC pagination via before=<id>.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { buildTokenScope } from '../../functions/utils/scopes'
import { onRequestGet as listHandler } from '../../functions/api/admin/event-dlq/index'

const db = env.chiyigo_db
beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })

async function accessToken(userId: number, role = 'admin', email = 'admin@x.io'): Promise<string> {
  return signJwt({ sub: String(userId), email, role, status: 'active', ver: 0, scope: buildTokenScope(role) }, '15m', env, { audience: 'chiyigo' })
}
function get(token: string | null, query = ''): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const req = new Request(`http://x/api/admin/event-dlq${query}`, { method: 'GET', headers })
  return (listHandler as (ctx: unknown) => Promise<Response>)({ request: req, env })
}

const SK = 'tenant:1:member:42'
async function seedDlq(eventId: string, opts: { reason?: string; replayed?: boolean; lastError?: string | null } = {}): Promise<number> {
  const { reason = 'max_attempts', replayed = false, lastError = 'boom' } = opts
  const r = await db.prepare(
    `INSERT INTO event_dlq (event_id, event_type, stream_key, stream_seq, tenant_id, actor_sub, occurred_at, data_json, dlq_reason, attempts, last_error, replayed_at)
     VALUES (?, 'member.suspended', ?, 1, 1, 'a', '2026-06-02T00:00:00Z', '{"sub":"42"}', ?, 6, ?, ?)`,
  ).bind(eventId, SK, reason, lastError, replayed ? '2026-06-10 00:00:00' : null).run()
  return Number(r.meta.last_row_id)
}

describe('[EVT-001b] GET /api/admin/event-dlq', () => {
  let adminId: number
  beforeEach(async () => { adminId = (await seedUser({ email: 'admin@x.io', role: 'admin' })).id })

  it('admin + scope -> 200, lists unreplayed rows, fully redacted (stream_key_hash only)', async () => {
    await seedDlq('ev-1')
    const resp = await get(await accessToken(adminId))
    expect(resp.status).toBe(200)
    const body = await resp.json() as { rows: Record<string, unknown>[]; next_before: number | null }
    expect(body.rows.length).toBe(1)
    const row = body.rows[0]
    // redaction (INV-EVT-9): no raw stream_key / data_json property; only the hash.
    expect('stream_key' in row).toBe(false)
    expect('data_json' in row).toBe(false)
    expect(typeof row.stream_key_hash).toBe('string')
    expect((row.stream_key_hash as string).length).toBeGreaterThan(0)
    // the raw value must not leak anywhere in the serialized response.
    expect(JSON.stringify(body)).not.toContain(SK)
    // useful fields ARE present.
    expect(row.dlq_reason).toBe('max_attempts')
    expect(row.event_id).toBe('ev-1')
  })

  it('default lists only unreplayed; replayed=1 includes replayed rows', async () => {
    await seedDlq('ev-live')
    await seedDlq('ev-done', { replayed: true })
    const def = await (await get(await accessToken(adminId))).json() as { rows: { event_id: string }[] }
    expect(def.rows.map(r => r.event_id)).toEqual(['ev-live'])
    const all = await (await get(await accessToken(adminId), '?replayed=1')).json() as { rows: { event_id: string }[] }
    expect(all.rows.map(r => r.event_id).sort()).toEqual(['ev-done', 'ev-live'])
  })

  it('deterministic pagination: ORDER BY id DESC + before=<id> cursor', async () => {
    const id1 = await seedDlq('ev-a')
    const id2 = await seedDlq('ev-b')
    const id3 = await seedDlq('ev-c')
    const page1 = await (await get(await accessToken(adminId), '?limit=2')).json() as { rows: { id: number; event_id: string }[]; next_before: number | null }
    expect(page1.rows.map(r => r.id)).toEqual([id3, id2])   // DESC
    expect(page1.next_before).toBe(id2)
    const page2 = await (await get(await accessToken(adminId), `?limit=2&before=${page1.next_before}`)).json() as { rows: { id: number }[]; next_before: number | null }
    expect(page2.rows.map(r => r.id)).toEqual([id1])
    expect(page2.next_before).toBeNull()                    // last page (fewer than limit)
  })

  it('malformed limit (abc / empty / 0) -> 200, falls back/clamps (no NaN bind, no 500)', async () => {
    await seedDlq('ev-1'); await seedDlq('ev-2'); await seedDlq('ev-3')
    // ?limit=abc and ?limit= must NOT 500: default to 50 -> all 3 rows.
    const abc = await get(await accessToken(adminId), '?limit=abc')
    expect(abc.status).toBe(200)
    expect((await abc.json() as { rows: unknown[] }).rows.length).toBe(3)
    const empty = await get(await accessToken(adminId), '?limit=')
    expect(empty.status).toBe(200)
    expect((await empty.json() as { rows: unknown[] }).rows.length).toBe(3)
    // ?limit=0 clamps to 1.
    const zero = await get(await accessToken(adminId), '?limit=0')
    expect(zero.status).toBe(200)
    expect((await zero.json() as { rows: unknown[] }).rows.length).toBe(1)
  })

  it('non-admin (player) -> 403 (role gate)', async () => {
    const { id } = await seedUser({ email: 'p@x.io', role: 'player' })
    expect((await get(await accessToken(id, 'player', 'p@x.io'))).status).toBe(403)
  })

  // Auth contract is role + scope. finance/support are below admin and lack admin:events:replay, so the deny path is
  // exercised (they 403 at requireRole, before the scope check; the scope gate is defense-in-depth, unreachable-deny
  // for a true admin token because effectiveScopesFromJwt re-derives admin's scopes from the role).
  it('insufficient role/scope (finance) -> 403', async () => {
    const { id } = await seedUser({ email: 'fin@x.io', role: 'finance' })
    expect((await get(await accessToken(id, 'finance', 'fin@x.io'))).status).toBe(403)
  })

  it('no token -> 401', async () => {
    expect((await get(null)).status).toBe(401)
  })
})
