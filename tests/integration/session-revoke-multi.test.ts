/**
 * PR5 5d-2 c5 — session.revoked MULTI-family wire + the shared revokeSessionFamilies orchestrator.
 *
 * Drives the REAL endpoints (auth/devices/logout + admin/revoke mode=device) and the helper directly, asserting the
 * c5-specific surface:
 *  - per-family emit: one session.revoked per revoked family (distinct streamKeys, each seq 1).
 *  - device-filtered enumeration: device_uuid=string AND device_uuid IS NULL (web); other devices untouched.
 *  - empty candidates -> idempotent (revoked:0, no emit); 404 anti-probe preserved.
 *  - GLOBAL cross-device-duplicate FAIL-CLOSED (Codex R4): a device's enumeration shows 1, but the device-less
 *    global count sees the same ref live on 2 devices -> 500, no mutation, no emit, critical audit.
 *  - chunking (K) + partial-failure REVOKE_INCOMPLETE forward-progress + retry convergence (no double-emit).
 *  - whole-user (mode=user / token_version) NEVER emits session.revoked.
 *  - end-to-end contiguity through the real 5b consumer: session.revoked -> event_deny_state denied=1.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { hashToken, generateSecureToken } from '../../functions/utils/crypto'
import { validateDomainEvent } from '../../functions/utils/domain-events'
import { revokeSessionFamilies } from '../../functions/utils/session-revoke'
import { onRequestPost as devicesLogoutHandler } from '../../functions/api/auth/devices/logout'
import { onRequestPost as adminRevokeHandler } from '../../functions/api/admin/revoke'
import { onRequestPost as consumerHandler } from '../../functions/api/admin/cron/event-outbox'

const db = env.chiyigo_db
beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => {
  await resetDb()
  env.EVENT_OUTBOX_MAX_ATTEMPTS = '2'
  env.EVENT_OUTBOX_RETRY_BACKOFF_S = '0'
  env.EVENT_OUTBOX_LEASE_SECONDS = '120'
})
afterEach(() => { vi.restoreAllMocks() })

// ── helpers ──────────────────────────────────────────────────────────────────
interface OutboxRow {
  event_id: string; event_type: string; stream_key: string; stream_seq: number
  tenant_id: number | null; actor_sub: string | null; occurred_at: string; data_json: string; status: string
}
async function outboxRows(streamKey: string): Promise<OutboxRow[]> {
  const r = await db.prepare(`SELECT * FROM event_outbox WHERE stream_key = ? ORDER BY stream_seq`).bind(streamKey).all<OutboxRow>()
  return r.results ?? []
}
async function sessionOutboxCount(): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM event_outbox WHERE event_type = 'session.revoked'`).first<{ n: number }>()
  return r ? r.n : 0
}
function asEnvelope(row: OutboxRow): unknown {
  return {
    v: 1, eventId: row.event_id, eventType: row.event_type, streamKey: row.stream_key, streamSeq: row.stream_seq,
    occurredAt: row.occurred_at, tenantId: row.tenant_id, actorSub: row.actor_sub, data: JSON.parse(row.data_json),
  }
}
async function liveCount(userId: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL`).bind(userId).first<{ n: number }>()
  return r ? r.n : 0
}
async function proj(streamKey: string) {
  return db.prepare(`SELECT denied, last_applied_seq FROM event_deny_state WHERE stream_key = ?`).bind(streamKey).first<{ denied: number; last_applied_seq: number }>()
}
async function integrityAuditHeads(userId: number): Promise<number | null> {
  const r = await db.prepare(`SELECT event_data FROM audit_log WHERE user_id = ? AND event_type = 'session.integrity_violation'`).bind(userId).first<{ event_data: string }>()
  return r ? Number(JSON.parse(r.event_data).heads) : null
}

let _u = 0
async function player(): Promise<number> {
  const u = await seedUser({ email: `srm${_u++}@x.io`, emailVerified: 1 })
  return u.id
}
async function seedSession(userId: number, sessionId: string | null, deviceUuid: string | null): Promise<{ plain: string; id: number; ref: string }> {
  const plain = generateSecureToken()
  const hash = await hashToken(plain)
  const r = await db.prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, session_id) VALUES (?,?,?,?,?)`)
    .bind(userId, hash, deviceUuid, '2099-01-01 00:00:00', sessionId).run()
  const id = Number(r.meta.last_row_id)
  return { plain, id, ref: sessionId ?? `legacy_${id}` }
}
async function selfToken(userId: number): Promise<string> {
  return signJwt({ sub: String(userId), email: `srm${userId}@x.io`, role: 'player', status: 'active', ver: 0 }, '15m', env, { audience: 'chiyigo' })
}
async function adminToken(userId: number): Promise<string> {
  return signJwt({ sub: String(userId), email: `adm${userId}@x.io`, role: 'admin', status: 'active', ver: 0 }, '15m', env, { audience: 'chiyigo' })
}
async function devicesLogout(token: string, deviceUuid: string | null) {
  const req = new Request('http://x/api/auth/devices/logout', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_uuid: deviceUuid }),
  })
  const resp = await devicesLogoutHandler({ request: req, env })
  let body = null
  try { body = await resp.json() } catch { /* swallow */ }
  return { status: resp.status, body }
}
async function adminRevoke(token: string, payload: Record<string, unknown>) {
  const req = new Request('http://x/api/admin/revoke', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const resp = await adminRevokeHandler({ request: req, env })
  let body = null
  try { body = await resp.json() } catch { /* swallow */ }
  return { status: resp.status, body }
}
async function runConsumer() {
  const req = new Request('http://x/api/admin/cron/event-outbox', {
    method: 'POST', headers: { Authorization: 'Bearer test-cron-secret', 'Content-Type': 'application/json' },
  })
  const resp = await consumerHandler({ request: req, env })
  return { status: resp.status, report: await resp.json() }
}

// ── auth/devices/logout (self, requireAuth) ──────────────────────────────────
describe('[PR5-5d-2 c5] auth/devices/logout — multi-family', () => {
  it('device_uuid=string: 2 distinct sessions on one device → 200 {revoked:2} + exactly 2 session.revoked (distinct streamKeys, seq 1), other device untouched', async () => {
    const uid = await player()
    await seedSession(uid, 'sess-A', 'dev-1')
    await seedSession(uid, 'sess-B', 'dev-1')
    await seedSession(uid, 'sess-OTHER', 'dev-2') // a different device — must NOT be revoked
    const r = await devicesLogout(await selfToken(uid), 'dev-1')
    expect(r.status).toBe(200)
    expect(r.body.revoked).toBe(2)
    const a = await outboxRows(`session:${uid}:device:sess-A`)
    const b = await outboxRows(`session:${uid}:device:sess-B`)
    expect(a.length).toBe(1); expect(a[0].stream_seq).toBe(1); expect(a[0].actor_sub).toBe(String(uid))
    expect(b.length).toBe(1); expect(b[0].stream_seq).toBe(1)
    expect(JSON.parse(a[0].data_json)).toEqual({ sub: String(uid), scope: 'device', ref: 'sess-A' })
    expect(validateDomainEvent(asEnvelope(a[0])).ok).toBe(true)
    expect(await sessionOutboxCount()).toBe(2)
    // the other device's session is NOT emitted and still live
    expect((await outboxRows(`session:${uid}:device:sess-OTHER`)).length).toBe(0)
    expect(await liveCount(uid)).toBe(1)
  })

  it('device_uuid=null (web): 2 distinct web sessions → 200 {revoked:2} + 2 events', async () => {
    const uid = await player()
    await seedSession(uid, 'web-A', null)
    await seedSession(uid, 'web-B', null)
    const r = await devicesLogout(await selfToken(uid), null)
    expect(r.status).toBe(200)
    expect(r.body.revoked).toBe(2)
    expect(await sessionOutboxCount()).toBe(2)
    expect((await outboxRows(`session:${uid}:device:web-A`)).length).toBe(1)
    expect((await outboxRows(`session:${uid}:device:web-B`)).length).toBe(1)
    expect(await liveCount(uid)).toBe(0)
  })

  it('empty candidates (device rows all already revoked) → 200 {revoked:0}, NO emit', async () => {
    const uid = await player()
    const s = await seedSession(uid, 'sess-GONE', 'dev-1')
    await db.prepare(`UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE id=?`).bind(s.id).run()
    const r = await devicesLogout(await selfToken(uid), 'dev-1') // 404 anti-probe passes (row exists), but no LIVE candidate
    expect(r.status).toBe(200)
    expect(r.body.revoked).toBe(0)
    expect(await sessionOutboxCount()).toBe(0)
  })

  it('no rows for device → 404 DEVICE_NOT_FOUND (anti-probe preserved), NO emit', async () => {
    const uid = await player()
    await seedSession(uid, 'sess-X', 'dev-real')
    const r = await devicesLogout(await selfToken(uid), 'dev-absent')
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('DEVICE_NOT_FOUND')
    expect(await sessionOutboxCount()).toBe(0)
  })

  it('GLOBAL cross-device duplicate (Codex R4): same session_id live on TWO devices → revoke device A → 500 SESSION_INTEGRITY_VIOLATION, NO mutation, NO emit, critical audit heads=2', async () => {
    const uid = await player()
    await seedSession(uid, 'sess-DUP', 'dev-A') // device A's enumeration alone shows 1 candidate (sess-DUP)
    await seedSession(uid, 'sess-DUP', 'dev-B') // ...but the SAME ref is also live on device B (global heads=2)
    const r = await devicesLogout(await selfToken(uid), 'dev-A')
    expect(r.status).toBe(500)
    expect(r.body.code).toBe('SESSION_INTEGRITY_VIOLATION')
    expect(await liveCount(uid)).toBe(2)           // fail-closed: nothing revoked
    expect(await sessionOutboxCount()).toBe(0)     // nothing emitted
    expect(await integrityAuditHeads(uid)).toBe(2) // critical audit recorded the observed head count
  })

  it('endpoint partial-failure (forced batch error) → 500 REVOKE_INCOMPLETE with counts, sessions still live, NO emit', async () => {
    const uid = await player()
    await seedSession(uid, 'inc-A', 'dev-1')
    await seedSession(uid, 'inc-B', 'dev-1')
    vi.spyOn(db, 'batch').mockImplementation(() => { throw new Error('forced batch failure') })
    const r = await devicesLogout(await selfToken(uid), 'dev-1')
    expect(r.status).toBe(500)
    expect(r.body.code).toBe('REVOKE_INCOMPLETE')
    expect(r.body.revoked).toBe(0)
    expect(r.body.remaining).toBe(2)
    vi.restoreAllMocks()
    expect(await liveCount(uid)).toBe(2)        // chunk rolled back — both still live
    expect(await sessionOutboxCount()).toBe(0)  // nothing emitted
  })
})

// ── admin/revoke mode=device (admin, requireRole) ────────────────────────────
describe('[PR5-5d-2 c5] admin/revoke mode=device — multi-family', () => {
  it('2 sessions on a device → 200 refresh_revoked=2 + 2 session.revoked with actor_sub = ADMIN sub', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const target = await seedUser({ email: 'tgt@x' })
    await seedSession(target.id, 'sess-1', 'dev-Z')
    await seedSession(target.id, 'sess-2', 'dev-Z')
    const r = await adminRevoke(await adminToken(admin.id), { mode: 'device', user_id: target.id, device_uuid: 'dev-Z' })
    expect(r.status).toBe(200)
    expect(r.body.refresh_revoked).toBe(2)
    expect(await sessionOutboxCount()).toBe(2)
    const one = await outboxRows(`session:${target.id}:device:sess-1`)
    expect(one.length).toBe(1)
    expect(one[0].actor_sub).toBe(String(admin.id))  // actor is the ADMIN, not the target
    expect(validateDomainEvent(asEnvelope(one[0])).ok).toBe(true)
    // admin.token.revoked.device audit recorded the family count
    const ad = await db.prepare(`SELECT event_data FROM audit_log WHERE user_id=? AND event_type='admin.token.revoked.device'`).bind(target.id).first<{ event_data: string }>()
    expect(ad).not.toBeNull()
    expect(JSON.parse(ad!.event_data).refresh_revoked).toBe(2)
  })

  it('mode=user (token_version bump) NEVER emits session.revoked', async () => {
    const admin = await seedUser({ email: 'adm2@x', role: 'admin' })
    const target = await seedUser({ email: 'tgt2@x' })
    await seedSession(target.id, 'sess-u1', 'dev-1')
    await seedSession(target.id, 'sess-u2', null)
    const r = await adminRevoke(await adminToken(admin.id), { mode: 'user', user_id: target.id })
    expect(r.status).toBe(200)
    expect(r.body.refresh_revoked).toBe(2)         // all refresh revoked (whole-user)
    expect(await liveCount(target.id)).toBe(0)
    expect(await sessionOutboxCount()).toBe(0)     // but ZERO session.revoked — token-epoch is not a deny subject
  })
})

// ── revokeSessionFamilies helper (chunking + partial-failure + integrity) ────
describe('[PR5-5d-2 c5] revokeSessionFamilies — chunking / partial-failure / integrity', () => {
  it('chunkSize=1 over 3 live families → outcome ok, revoked 3, exactly 3 session.revoked (one per chunk)', async () => {
    const uid = await player()
    for (const s of ['c-1', 'c-2', 'c-3']) await seedSession(uid, s, 'dev-1')
    const result = await revokeSessionFamilies(db, uid, ['c-1', 'c-2', 'c-3'], String(uid), { chunkSize: 1 })
    expect(result.outcome).toBe('ok')
    expect(result.revoked).toBe(3)
    expect(result.emitted).toBe(3)
    expect(await sessionOutboxCount()).toBe(3)
    expect(await liveCount(uid)).toBe(0)
  })

  it('partial failure (chunkSize=1, 2nd batch throws) → incomplete (revoked 1, remaining 2); committed family emitted, rest live; RETRY converges with NO double-emit', async () => {
    const uid = await player()
    for (const s of ['p-1', 'p-2', 'p-3']) await seedSession(uid, s, 'dev-1')

    const orig = db.batch.bind(db)
    let calls = 0
    vi.spyOn(db, 'batch').mockImplementation((stmts) => {
      calls++
      if (calls === 2) throw new Error('forced chunk failure')
      return orig(stmts)
    })

    const first = await revokeSessionFamilies(db, uid, ['p-1', 'p-2', 'p-3'], String(uid), { chunkSize: 1 })
    expect(first.outcome).toBe('incomplete')
    expect(first.revoked).toBe(1)        // only the 1st chunk committed
    expect(first.remaining).toBe(2)
    expect(await sessionOutboxCount()).toBe(1)
    expect(await liveCount(uid)).toBe(2) // p-2 / p-3 still live (their chunk rolled back / never ran)

    vi.restoreAllMocks()
    // RETRY: re-enumerate the still-live families (the committed one is now revoked → excluded) → converge
    const live = await db.prepare(`SELECT DISTINCT COALESCE(session_id,'legacy_'||id) AS ref FROM refresh_tokens WHERE user_id=? AND revoked_at IS NULL`).bind(uid).all<{ ref: string }>()
    const remainingRefs = (live.results ?? []).map((r) => String(r.ref))
    const second = await revokeSessionFamilies(db, uid, remainingRefs, String(uid), { chunkSize: 1 })
    expect(second.outcome).toBe('ok')
    expect(second.revoked).toBe(2)
    expect(await sessionOutboxCount()).toBe(3) // 1 + 2 = 3 total, NO duplicate
    expect(await liveCount(uid)).toBe(0)
    // each family stream has exactly ONE event at seq 1 (no double-emit)
    for (const s of ['p-1', 'p-2', 'p-3']) {
      const rows = await outboxRows(`session:${uid}:device:${s}`)
      expect(rows.length).toBe(1)
      expect(rows[0].stream_seq).toBe(1)
    }
  })

  it('integrity (helper): a candidate ref with 2 live heads → integrity_violation, integrityHeads 2, NO mutation, NO emit', async () => {
    const uid = await player()
    await seedSession(uid, 'dup', 'dev-A')
    await seedSession(uid, 'dup', 'dev-B')
    const result = await revokeSessionFamilies(db, uid, ['dup'], String(uid))
    expect(result.outcome).toBe('integrity_violation')
    expect(result.integrityRef).toBe('dup')
    expect(result.integrityHeads).toBe(2)
    expect(result.revoked).toBe(0)
    expect(await liveCount(uid)).toBe(2)
    expect(await sessionOutboxCount()).toBe(0)
  })

  it('empty candidateRefs → ok, revoked 0, no query side effects', async () => {
    const uid = await player()
    const result = await revokeSessionFamilies(db, uid, [], String(uid))
    expect(result.outcome).toBe('ok')
    expect(result.revoked).toBe(0)
    expect(await sessionOutboxCount()).toBe(0)
  })

  it('heads==0 candidate (concurrently fully revoked) is a benign skip, not a violation', async () => {
    const uid = await player()
    const s = await seedSession(uid, 'skip-me', 'dev-1')
    await db.prepare(`UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE id=?`).bind(s.id).run() // 0 live heads
    const result = await revokeSessionFamilies(db, uid, ['skip-me'], String(uid))
    expect(result.outcome).toBe('ok')   // NOT integrity_violation
    expect(result.revoked).toBe(0)
    expect(await sessionOutboxCount()).toBe(0)
  })
})

// ── end-to-end through the real 5b consumer ──────────────────────────────────
describe('[PR5-5d-2 c5] contiguity through the 5b consumer', () => {
  it('devices/logout emits 2 session.revoked → consumer delivers → each event_deny_state denied=1, last_applied_seq=1', async () => {
    const uid = await player()
    await seedSession(uid, 'd2c-A', 'dev-1')
    await seedSession(uid, 'd2c-B', 'dev-1')
    const r = await devicesLogout(await selfToken(uid), 'dev-1')
    expect(r.body.revoked).toBe(2)

    const { status } = await runConsumer()
    expect(status).toBe(200)
    const pa = await proj(`session:${uid}:device:d2c-A`)
    const pb = await proj(`session:${uid}:device:d2c-B`)
    expect(pa?.denied).toBe(1); expect(pa?.last_applied_seq).toBe(1)
    expect(pb?.denied).toBe(1); expect(pb?.last_applied_seq).toBe(1)
  })
})
