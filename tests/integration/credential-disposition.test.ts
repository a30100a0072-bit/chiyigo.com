/**
 * SEC-FACTOR-ADD ADD-A PR-A4 — credential disposition integration tests.
 *
 * Covers the plan §12 matrix: risk tiering (high / unknown_context / low), disposition writes, idempotent
 * rerun (no double notify/audit), dry-run (zero side effects), N+1-free batch preload, list DTO exposure,
 * and the admin runner endpoint double-gate (security step-up + admin:users:write, count-only output).
 */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { runDisposition } from '../../functions/utils/credential-disposition'
import { onRequestPost as runHandler } from '../../functions/api/admin/credential-disposition/run'
import { onRequestGet as walletList } from '../../functions/api/auth/wallet'

const WINDOW = '2026-06-01 10:00:00'      // clearly before WINDOW_END (2026-06-13 09:10:00)
const POST_GATE = '2026-06-20 10:00:00'   // after the gate → must NOT be processed
const req = () => new Request('http://x/disposition')

// ── seed helpers (controlled timestamps) ─────────────────────────────────
async function seedPasskey(userId: number, credId: string, createdAt: string) {
  await env.chiyigo_db.prepare(
    `INSERT INTO user_webauthn_credentials (user_id, credential_id, public_key, created_at) VALUES (?, ?, 'pk', ?)`,
  ).bind(userId, credId, createdAt).run()
}
async function seedWallet(userId: number, address: string, signedAt: string) {
  await env.chiyigo_db.prepare(
    `INSERT INTO user_wallets (user_id, address, signed_at) VALUES (?, ?, ?)`,
  ).bind(userId, address, signedAt).run()
}
async function seedIdentity(userId: number, provider: string, providerId: string, createdAt: string) {
  await env.chiyigo_db.prepare(
    `INSERT INTO user_identities (user_id, provider, provider_id, created_at) VALUES (?, ?, ?, ?)`,
  ).bind(userId, provider, providerId, createdAt).run()
}
async function seedAudit(userId: number, eventType: string, createdAt: string) {
  await env.chiyigo_db.prepare(
    `INSERT INTO audit_log (event_type, severity, user_id, created_at) VALUES (?, 'info', ?, ?)`,
  ).bind(eventType, userId, createdAt).run()
}

async function run(opts: Partial<Parameters<typeof runDisposition>[1]> = {}) {
  return runDisposition(env, {
    dryRun: false, types: ['passkey', 'wallet', 'identity'], maxPerRun: 500, actorId: 1, request: req(), ...opts,
  })
}

beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })
afterEach(() => { vi.unstubAllGlobals() })

describe('runDisposition — risk tiering (OD-1=b, 3 tiers)', () => {
  it('high: passkey add-context + 窗內 anomaly(new_device) → tier=high + requires_reverification=1', async () => {
    const u = await seedUser({ email: 'h@x' })
    await seedPasskey(u.id, 'c-high', WINDOW)
    await seedAudit(u.id, 'webauthn.register.success', WINDOW)            // add context (~= anchor)
    await seedAudit(u.id, 'auth.new_device', '2026-06-01 10:05:00')      // anomaly within 60min
    const c = await run({ types: ['passkey'] })
    expect(c.high).toBe(1)
    const row = await env.chiyigo_db.prepare(`SELECT requires_reverification AS r, disposition_reason AS d FROM user_webauthn_credentials WHERE credential_id='c-high'`).first()
    expect(row.r).toBe(1)
    expect(String(row.d)).toContain('high:auth.new_device')
  })

  it('low: passkey add-context + 無 anomaly → tier=low + requires_reverification=0 + disposition_at set', async () => {
    const u = await seedUser({ email: 'l@x' })
    await seedPasskey(u.id, 'c-low', WINDOW)
    await seedAudit(u.id, 'webauthn.register.success', WINDOW)
    const c = await run({ types: ['passkey'] })
    expect(c.low).toBe(1)
    const row = await env.chiyigo_db.prepare(`SELECT requires_reverification AS r, disposition_at AS da FROM user_webauthn_credentials WHERE credential_id='c-low'`).first()
    expect(row.r).toBe(0)
    expect(row.da).not.toBeNull()          // low still stamped (idempotency)
  })

  it('unknown_context: identity (歷史無 add 事件) → tier=unknown_context + requires_reverification=1 (不可歸 low)', async () => {
    const u = await seedUser({ email: 'un@x' })
    await seedIdentity(u.id, 'google', 'g-unknown', WINDOW)
    const c = await run({ types: ['identity'] })
    expect(c.unknown_context).toBe(1)
    expect(c.low).toBe(0)
    const row = await env.chiyigo_db.prepare(`SELECT requires_reverification AS r, disposition_reason AS d FROM user_identities WHERE provider_id='g-unknown'`).first()
    expect(row.r).toBe(1)
    expect(row.d).toBe('unknown_context')
  })

  it('unknown_context: passkey WITHOUT a nearby add-success event → unknown (cannot attribute, not low)', async () => {
    const u = await seedUser({ email: 'un2@x' })
    await seedPasskey(u.id, 'c-noadd', WINDOW)        // no webauthn.register.success seeded
    const c = await run({ types: ['passkey'] })
    expect(c.unknown_context).toBe(1)
    expect(c.low).toBe(0)
  })

  it('high(burst): 同 user 短時 ≥3 factor-add → high', async () => {
    const u = await seedUser({ email: 'b@x' })
    await seedPasskey(u.id, 'c-burst', WINDOW)
    for (const t of ['2026-06-01 10:00:00', '2026-06-01 10:02:00', '2026-06-01 10:05:00'])
      await seedAudit(u.id, 'webauthn.register.success', t)
    const c = await run({ types: ['passkey'] })
    expect(c.high).toBe(1)
    const row = await env.chiyigo_db.prepare(`SELECT disposition_reason AS d FROM user_webauthn_credentials WHERE credential_id='c-burst'`).first()
    expect(String(row.d)).toContain('multi_factor_burst')
  })
})

describe('runDisposition — inventory / window / disposition', () => {
  it('inventory: 三類 credential 都被枚舉', async () => {
    const u = await seedUser({ email: 'inv@x' })
    await seedPasskey(u.id, 'c-1', WINDOW); await seedAudit(u.id, 'webauthn.register.success', WINDOW)
    await seedWallet(u.id, '0xinv', WINDOW); await seedAudit(u.id, 'wallet.bind.success', WINDOW)
    await seedIdentity(u.id, 'google', 'g-inv', WINDOW)
    const c = await run()
    expect(c.scanned).toBe(3)
  })

  it('window: post-gate credential (created_at >= WINDOW_END) 不被處理', async () => {
    const u = await seedUser({ email: 'pg@x' })
    await seedPasskey(u.id, 'c-postgate', POST_GATE)
    const c = await run({ types: ['passkey'] })
    expect(c.scanned).toBe(0)
    const row = await env.chiyigo_db.prepare(`SELECT disposition_at AS da FROM user_webauthn_credentials WHERE credential_id='c-postgate'`).first()
    expect(row.da).toBeNull()
  })

  it('idempotent: rerun skips dispositioned rows (不重複處理)', async () => {
    const u = await seedUser({ email: 'idem@x' })
    await seedPasskey(u.id, 'c-idem', WINDOW); await seedAudit(u.id, 'webauthn.register.success', WINDOW)
    const c1 = await run({ types: ['passkey'] })
    expect(c1.dispositioned).toBe(1)
    const c2 = await run({ types: ['passkey'] })
    expect(c2.scanned).toBe(0)            // already dispositioned → skipped
    expect(c2.dispositioned).toBe(0)
  })
})

describe('runDisposition — dry-run (zero side effects)', () => {
  it('dry-run: classify + count 但不寫 DB / 不 per-row audit / 不寄信', async () => {
    const u = await seedUser({ email: 'dry@x' })
    await seedPasskey(u.id, 'c-dry', WINDOW)
    await seedAudit(u.id, 'webauthn.register.success', WINDOW)
    await seedAudit(u.id, 'auth.new_device', '2026-06-01 10:05:00')
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    Object.assign(env, { RESEND_API_KEY: 'test-key' })

    const c = await run({ types: ['passkey'], dryRun: true })
    expect(c.high).toBe(1)
    expect(c.dispositioned).toBe(0)
    // no DB write
    const row = await env.chiyigo_db.prepare(`SELECT requires_reverification AS r, disposition_at AS da FROM user_webauthn_credentials WHERE credential_id='c-dry'`).first()
    expect(row.r).toBe(0)
    expect(row.da).toBeNull()
    // no per-row audit
    const aud = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE event_type='account.credential.disposition'`).first()
    expect(aud.n).toBe(0)
    // no email
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('runDisposition — audit layering + notify (OD-4)', () => {
  it('high → per-row audit + notify; low → 無 per-row audit, 不寄信', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    Object.assign(env, { RESEND_API_KEY: 'test-key' })

    const hi = await seedUser({ email: 'hi@x' })
    await seedPasskey(hi.id, 'c-h', WINDOW); await seedAudit(hi.id, 'webauthn.register.success', WINDOW)
    await seedAudit(hi.id, 'auth.new_device', '2026-06-01 10:05:00')
    const lo = await seedUser({ email: 'lo@x' })
    await seedPasskey(lo.id, 'c-l', WINDOW); await seedAudit(lo.id, 'webauthn.register.success', WINDOW)

    const c = await run({ types: ['passkey'] })
    expect(c.high).toBe(1); expect(c.low).toBe(1)
    expect(c.notified).toBe(1)                     // high only
    expect(fetchSpy).toHaveBeenCalledTimes(1)      // one Resend send (high)
    // per-row audit: exactly 1 (high), not low
    const perRow = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE event_type='account.credential.disposition'`).first()
    expect(perRow.n).toBe(1)
  })

  it('unknown_context → per-row audit + flag, 但不寄信 (OD-4)', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    Object.assign(env, { RESEND_API_KEY: 'test-key' })
    const u = await seedUser({ email: 'unk@x' })
    await seedIdentity(u.id, 'google', 'g-unk', WINDOW)
    const c = await run({ types: ['identity'] })
    expect(c.unknown_context).toBe(1)
    expect(c.notified).toBe(0)                     // unknown does NOT email
    expect(fetchSpy).not.toHaveBeenCalled()
    const perRow = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE event_type='account.credential.disposition'`).first()
    expect(perRow.n).toBe(1)                       // unknown still per-row audited
  })
})

describe('runDisposition — N+1-free batch preload', () => {
  it('audit_log preload runs ONCE per type-batch regardless of credential count', async () => {
    const u = await seedUser({ email: 'nplus1@x' })
    for (let i = 0; i < 5; i++) { await seedPasskey(u.id, `c-n${i}`, WINDOW); await seedAudit(u.id, 'webauthn.register.success', WINDOW) }
    const spy = vi.spyOn(env.chiyigo_db, 'prepare')
    await run({ types: ['passkey'] })
    const auditPreloads = spy.mock.calls.filter(args => String(args[0]).includes('FROM audit_log') && String(args[0]).includes('json_each')).length
    expect(auditPreloads).toBe(1)                  // NOT 5 → no N+1
    spy.mockRestore()
  })
})

describe('admin runner endpoint — double-gate', () => {
  async function adminStepUpToken(userId: number) {
    return signJwt(
      { sub: String(userId), email: 'a@x', role: 'admin', status: 'active', ver: 0,
        scope: 'elevated:account admin:users:write', for_action: 'credential_disposition', amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
      '5m', env, { audience: 'chiyigo' },
    )
  }
  function post(token: string, body: object) {
    return new Request('http://x/api/admin/credential-disposition/run', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  }

  it('一般 access token(無 step-up) → 403 STEP_UP_REQUIRED', async () => {
    const u = await seedUser({ email: 'na@x', role: 'admin' })
    const plain = await signJwt({ sub: String(u.id), email: 'na@x', role: 'admin', status: 'active', ver: 0, scope: 'admin:users:write' }, '15m', env, { audience: 'chiyigo' })
    const resp = await runHandler({ request: post(plain, { dryRun: true }), env })
    expect(resp.status).toBe(403)
    expect((await resp.json()).code).toBe('STEP_UP_REQUIRED')
  })

  it('step-up 但無 admin:users:write scope → 403 INSUFFICIENT_SCOPE', async () => {
    const u = await seedUser({ email: 'ns@x', role: 'player' })
    const tok = await signJwt(
      { sub: String(u.id), email: 'ns@x', role: 'player', status: 'active', ver: 0,
        scope: 'elevated:account', for_action: 'credential_disposition', amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
      '5m', env, { audience: 'chiyigo' },
    )
    const resp = await runHandler({ request: post(tok, { dryRun: true }), env })
    expect(resp.status).toBe(403)
    expect((await resp.json()).code).toBe('INSUFFICIENT_SCOPE')
  })

  it('admin step-up → 200 count-only; dry-run 不寫 DB', async () => {
    const u = await seedUser({ email: 'ok@x', role: 'admin' })
    await seedPasskey(u.id, 'c-ep', WINDOW); await seedAudit(u.id, 'webauthn.register.success', WINDOW)
    const tok = await adminStepUpToken(u.id)
    const resp = await runHandler({ request: post(tok, { dryRun: true, types: ['passkey'] }), env })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.dryRun).toBe(true)
    expect(body.scanned).toBe(1)
    // count-only: no raw credential detail leaked
    expect(JSON.stringify(body)).not.toContain('c-ep')
    // dry-run → no DB write
    const row = await env.chiyigo_db.prepare(`SELECT disposition_at AS da FROM user_webauthn_credentials WHERE credential_id='c-ep'`).first()
    expect(row.da).toBeNull()
    // run-lifecycle audit emitted
    const runAudit = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE event_type='account.credential.disposition.run'`).first()
    expect(runAudit.n).toBeGreaterThanOrEqual(1)
  })
})

describe('list DTO — disposition flag exposure (high/unknown visible, low not, no raw signal)', () => {
  it('wallet list 回 requires_reverification + 最小化 reason (high→security_review, 不洩 raw signal)', async () => {
    const u = await seedUser({ email: 'dto@x' })
    await seedWallet(u.id, '0xdto', WINDOW); await seedAudit(u.id, 'wallet.bind.success', WINDOW)
    await seedAudit(u.id, 'auth.new_device', '2026-06-01 10:05:00')
    await run({ types: ['wallet'] })           // → high
    const tok = await signJwt({ sub: String(u.id), email: 'dto@x', role: 'player', status: 'active', ver: 0, scope: 'read:profile' }, '15m', env, { audience: 'chiyigo' })
    const resp = await walletList({ request: new Request('http://x/api/auth/wallet', { headers: { Authorization: `Bearer ${tok}` } }), env })
    const body = await resp.json()
    expect(body.wallets[0].requires_reverification).toBe(true)
    expect(body.wallets[0].disposition_reason).toBe('security_review')   // minimized, NOT raw high:<signal>
    expect(JSON.stringify(body)).not.toContain('auth.new_device')
  })
})
