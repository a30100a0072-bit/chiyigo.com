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
import { revokeSessionFamilies, SESSION_REVOKE_CHUNK_SIZE, SESSION_REVOKE_LARGE_N_THRESHOLD, resolveLargeNThreshold } from '../../functions/utils/session-revoke'
import { _registrySize } from '../../functions/utils/audit-policy'
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
  // PR5 large-N alarm: reset the threshold env each test so a low-threshold case can't LEAK into later cases
  // (Codex Gate-1 Low). Tests that need it set it explicitly; unset => the strict default (50) applies.
  delete env.SESSION_REVOKE_LARGE_N_THRESHOLD
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
async function auditData(eventType: string, userId: number): Promise<Record<string, unknown> | null> {
  const r = await db.prepare(`SELECT event_data FROM audit_log WHERE event_type = ? AND user_id = ? ORDER BY id DESC LIMIT 1`).bind(eventType, userId).first<{ event_data: string }>()
  return r ? JSON.parse(r.event_data) : null
}
async function auditRow(eventType: string, userId: number): Promise<{ severity: string; data: Record<string, unknown> } | null> {
  const r = await db.prepare(`SELECT severity, event_data FROM audit_log WHERE event_type = ? AND user_id = ? ORDER BY id DESC LIMIT 1`).bind(eventType, userId).first<{ severity: string; event_data: string }>()
  return r ? { severity: r.severity, data: JSON.parse(r.event_data) } : null
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
    // distinct partial-failure audit (plan §5): ops can tell this from a full success
    const a = await auditData('auth.devices.logout', uid)
    expect(a?.partial).toBe(true)
    expect(a?.revoked).toBe(0)
    expect(a?.remaining).toBe(2)
    expect(a?.chunk_size).toBe(SESSION_REVOKE_CHUNK_SIZE)
    expect(a?.site).toBe('auth.devices.logout')
  })

  it('large-N alarm: N > threshold on FULL SUCCESS → ok 200 + severity warn + large_n flag (no silent cap)', async () => {
    env.SESSION_REVOKE_LARGE_N_THRESHOLD = '2'
    const uid = await player()
    await seedSession(uid, 'ln-1', 'dev-1')
    await seedSession(uid, 'ln-2', 'dev-1')
    await seedSession(uid, 'ln-3', 'dev-1')          // N = 3 > threshold 2
    const r = await devicesLogout(await selfToken(uid), 'dev-1')
    expect(r.status).toBe(200)
    expect(r.body.revoked).toBe(3)
    const a = await auditRow('auth.devices.logout', uid)
    expect(a?.severity).toBe('warn')                  // info -> warn on large N
    expect(a?.data.large_n).toBe(true)
    expect(a?.data.n).toBe(3)
    expect(a?.data.threshold).toBe(2)
    expect(a?.data.revoked_count).toBe(3)             // existing field preserved
  })

  it('small-N (N <= threshold, strict >) → NO large_n flag, severity stays info', async () => {
    env.SESSION_REVOKE_LARGE_N_THRESHOLD = '2'
    const uid = await player()
    await seedSession(uid, 'sn-1', 'dev-1')
    await seedSession(uid, 'sn-2', 'dev-1')           // N = 2, NOT > 2
    const r = await devicesLogout(await selfToken(uid), 'dev-1')
    expect(r.status).toBe(200)
    const a = await auditRow('auth.devices.logout', uid)
    expect(a?.severity).toBe('info')
    expect(a?.data.large_n).toBeUndefined()
  })

  it('invalid threshold env (-1) → strict default 50 → small revoke NOT flagged (no always-fire)', async () => {
    env.SESSION_REVOKE_LARGE_N_THRESHOLD = '-1'       // naive Number()||default would make this always-fire
    const uid = await player()
    await seedSession(uid, 'iv-1', 'dev-1')
    await seedSession(uid, 'iv-2', 'dev-1')
    const r = await devicesLogout(await selfToken(uid), 'dev-1')
    expect(r.status).toBe(200)
    const a = await auditRow('auth.devices.logout', uid)
    expect(a?.severity).toBe('info')                  // -1 rejected -> default 50 -> N=2 not large
    expect(a?.data.large_n).toBeUndefined()
  })

  it('endpoint N>K partial failure (2nd chunk forced-fails AFTER the 1st commits) → REVOKE_INCOMPLETE {revoked:K, remaining:1} + partial audit; 1st chunk committed (K revoked + K emitted), 1 still live', async () => {
    env.SESSION_REVOKE_LARGE_N_THRESHOLD = '2'        // N=K+1 >> 2 → the partial audit also carries the large_n flag
    const uid = await player()
    const N = SESSION_REVOKE_CHUNK_SIZE + 1 // forces exactly 2 chunks: [K] + [1]
    for (let i = 0; i < N; i++) await seedSession(uid, `nk-${i}`, 'dev-1')
    const orig = db.batch.bind(db)
    let calls = 0
    vi.spyOn(db, 'batch').mockImplementation((stmts) => {
      calls++
      if (calls === 2) throw new Error('forced 2nd-chunk failure')
      return orig(stmts)
    })
    const r = await devicesLogout(await selfToken(uid), 'dev-1')
    expect(r.status).toBe(500)
    expect(r.body.code).toBe('REVOKE_INCOMPLETE')
    expect(r.body.revoked).toBe(SESSION_REVOKE_CHUNK_SIZE) // the 1st chunk committed
    expect(r.body.remaining).toBe(1)
    vi.restoreAllMocks()
    expect(await sessionOutboxCount()).toBe(SESSION_REVOKE_CHUNK_SIZE) // K events emitted (1st chunk)
    expect(await liveCount(uid)).toBe(1)                               // the 2nd-chunk family rolled back / still live
    const a = await auditData('auth.devices.logout', uid)
    expect(a?.partial).toBe(true)
    expect(a?.revoked).toBe(SESSION_REVOKE_CHUNK_SIZE)
    expect(a?.emitted).toBe(SESSION_REVOKE_CHUNK_SIZE)
    expect(a?.remaining).toBe(1)
    expect(a?.chunk_size).toBe(SESSION_REVOKE_CHUNK_SIZE)
    expect(a?.site).toBe('auth.devices.logout')
    // INCOMPLETE-path large-N (Codex Gate-1 Medium#2): the partial audit ALSO carries the large_n flag (N>threshold),
    // orthogonal to the partial-failure signal.
    expect(a?.partial).toBe(true)        // still the distinct partial signal
    expect(a?.large_n).toBe(true)
    expect(a?.n).toBe(N)
    expect(a?.threshold).toBe(2)
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

  it('large-N alarm: admin revoke N > threshold on full success → large_n flag on the critical audit (severity stays critical)', async () => {
    env.SESSION_REVOKE_LARGE_N_THRESHOLD = '1'
    const admin = await seedUser({ email: 'admln@x', role: 'admin' })
    const target = await seedUser({ email: 'tgtln@x' })
    await seedSession(target.id, 'al-1', 'dev-Z')
    await seedSession(target.id, 'al-2', 'dev-Z')     // N = 2 > threshold 1
    const r = await adminRevoke(await adminToken(admin.id), { mode: 'device', user_id: target.id, device_uuid: 'dev-Z' })
    expect(r.status).toBe(200)
    expect(r.body.refresh_revoked).toBe(2)
    const a = await auditRow('admin.token.revoked.device', target.id)
    expect(a?.severity).toBe('critical')              // unchanged (already >= warn)
    expect(a?.data.large_n).toBe(true)
    expect(a?.data.n).toBe(2)
    expect(a?.data.threshold).toBe(1)
  })

  it('partial failure (forced batch error) → 500 REVOKE_INCOMPLETE + distinct partial audit (site=admin.revoke.device), nothing committed', async () => {
    env.SESSION_REVOKE_LARGE_N_THRESHOLD = '1'        // N=2 > 1 → the partial audit also carries large_n (Medium#2)
    const admin = await seedUser({ email: 'admp@x', role: 'admin' })
    const target = await seedUser({ email: 'tgtp@x' })
    await seedSession(target.id, 'ap-1', 'dev-Z')
    await seedSession(target.id, 'ap-2', 'dev-Z')
    vi.spyOn(db, 'batch').mockImplementation(() => { throw new Error('forced batch failure') })
    const r = await adminRevoke(await adminToken(admin.id), { mode: 'device', user_id: target.id, device_uuid: 'dev-Z' })
    expect(r.status).toBe(500)
    expect(r.body.code).toBe('REVOKE_INCOMPLETE')
    expect(r.body.remaining).toBe(2)
    vi.restoreAllMocks()
    expect(await sessionOutboxCount()).toBe(0)
    expect(await liveCount(target.id)).toBe(2)
    const a = await auditData('admin.token.revoked.device', target.id)
    expect(a?.partial).toBe(true)
    expect(a?.revoked).toBe(0)
    expect(a?.remaining).toBe(2)
    expect(a?.chunk_size).toBe(SESSION_REVOKE_CHUNK_SIZE)
    expect(a?.site).toBe('admin.revoke.device')
    // INCOMPLETE-path large-N (Codex Gate-1 Medium#2): partial audit also carries large_n (N=2 > threshold 1).
    expect(a?.partial).toBe(true)
    expect(a?.large_n).toBe(true)
    expect(a?.n).toBe(2)
    expect(a?.threshold).toBe(1)
  })
})

// ── large-N threshold parsing (Codex Gate-1 Medium#1) + registry guard ───────
describe('[PR5-5d-2] resolveLargeNThreshold (strict) + registry guard', () => {
  it('accepts only finite positive integers; everything else → the safe default', () => {
    expect(resolveLargeNThreshold('3')).toBe(3)
    expect(resolveLargeNThreshold('50')).toBe(50)
    // invalid: a naive Number()||default would mis-accept -1/Infinity (always/never fire) — all must default:
    for (const bad of ['-1', '0', 'abc', 'Infinity', '2.5', '', '  ', undefined, null, 5, NaN]) {
      expect(resolveLargeNThreshold(bad)).toBe(SESSION_REVOKE_LARGE_N_THRESHOLD)
    }
  })
  it('audit-policy registry — large-N reuses existing endpoint types, no new type of its own', () => {
    // PR5-5d-2 large-N itself adds NO audit type. The GLOBAL registry size is 208 as of Fork 2 Route B
    // (auth.refresh.grace_orphan, 2026-06-07) — keep this in lockstep with audit-policy.test.ts's _registrySize assertion.
    expect(_registrySize).toBe(208)
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
