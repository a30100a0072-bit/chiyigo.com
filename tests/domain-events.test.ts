/**
 * domain-events contract unit tests (PR4 commit 2) — the frozen SSOT (plan section 6; Gate-1 APPROVED R4).
 *
 * Pure module (no D1) -> unit test under the default vitest config; also counts toward the 80% coverage gate.
 * Covers: every eventType builds+validates; envelope strictness; tenantId nullability; per-type data rules;
 * session bounded-subject (device/jti, required ref, reject scope='user'); streamKey mismatch; the RP
 * convergence rule (two-JTI out-of-order, revoke-then-new-jti, product revoke/restore set-clear); expand rule;
 * canonical serialization stability.
 */
import { describe, it, expect } from 'vitest'
import {
  EVENT_SCHEMA_VERSION,
  DENY_EFFECT,
  buildDomainEvent,
  validateDomainEvent,
  deriveStreamKey,
  canonicalEventJson,
  type DomainEvent,
  type DomainEventType,
  type DomainEventInput,
} from '../functions/utils/domain-events'

// ── helpers ──────────────────────────────────────────────────────────────────
let seqCounter = 0
function build(type: DomainEventType, input: DomainEventInput, opts: { streamSeq?: number; eventId?: string } = {}): DomainEvent {
  return buildDomainEvent(type, input, {
    eventId: opts.eventId ?? `evt-${++seqCounter}`,
    streamSeq: opts.streamSeq ?? 1,
    occurredAt: '2026-06-01T00:00:00.000Z',
  })
}

/** Valid sample input per eventType (the happy-path subject fields). */
const VALID: Record<DomainEventType, DomainEventInput> = {
  'member.invited':         { tenantId: 7, actorSub: '42', data: { invitationId: 5, email: 'a@b.com', platformRole: 'member' } },
  'member.joined':          { tenantId: 7, actorSub: '99', data: { sub: '99', platformRole: 'member' } },
  'member.suspended':       { tenantId: 7, actorSub: '42', data: { sub: '99', previousRole: 'tenant_admin' } },
  'member.reactivated':     { tenantId: 7, actorSub: '42', data: { sub: '99', platformRole: 'member' } },
  'member.offboarded':      { tenantId: 7, actorSub: '42', data: { sub: '99' } },
  'member.role_changed':    { tenantId: 7, actorSub: '42', data: { sub: '99', fromRole: 'member', toRole: 'tenant_admin' } },
  'account.disabled':       { tenantId: null, actorSub: '1', data: { sub: '99' } },
  'account.reenabled':      { tenantId: null, actorSub: '1', data: { sub: '99' } },
  'product_access.revoked': { tenantId: 7, actorSub: '1', data: { productId: 'erp' } },
  'product_access.restored':{ tenantId: 7, actorSub: '1', data: { productId: 'erp' } },
  'session.revoked':        { tenantId: null, actorSub: '99', data: { sub: '99', scope: 'jti', ref: 'jti-abc' } },
}
const ALL_TYPES = Object.keys(VALID) as DomainEventType[]

/** Minimal in-test RP deny-state reducer mirroring the FROZEN convergence rule (plan 6.4). */
function makeRpDenyState() {
  const lastSeq = new Map<string, number>()
  const denied = new Set<string>()
  return {
    apply(ev: DomainEvent) {
      const prev = lastSeq.get(ev.streamKey) ?? 0
      if (ev.streamSeq <= prev) return // stale / duplicate / reordered-late -> no-op
      lastSeq.set(ev.streamKey, ev.streamSeq)
      const eff = DENY_EFFECT[ev.eventType]
      if (eff === 'deny') denied.add(ev.streamKey)
      else if (eff === 'undeny') denied.delete(ev.streamKey)
      // 'soft' / 'none' -> no deny-state change
    },
    isDenied(streamKey: string) { return denied.has(streamKey) },
  }
}

// ── taxonomy + happy path ──────────────────────────────────────────────────────
describe('taxonomy', () => {
  it('freezes exactly the 11-type v1 taxonomy (incl. product_access.restored; NOT tenant.*)', () => {
    expect(ALL_TYPES.sort()).toEqual([
      'account.disabled', 'account.reenabled',
      'member.invited', 'member.joined', 'member.offboarded', 'member.reactivated', 'member.role_changed', 'member.suspended',
      'product_access.restored', 'product_access.revoked',
      'session.revoked',
    ])
    expect(ALL_TYPES.length).toBe(11)
    expect(EVENT_SCHEMA_VERSION).toBe(1)
  })

  it('DENY_EFFECT covers all 11 types with the frozen effects', () => {
    expect(Object.keys(DENY_EFFECT).sort()).toEqual(ALL_TYPES.slice().sort())
    expect(DENY_EFFECT['member.suspended']).toBe('deny')
    expect(DENY_EFFECT['member.reactivated']).toBe('undeny')
    expect(DENY_EFFECT['member.offboarded']).toBe('deny')
    expect(DENY_EFFECT['account.disabled']).toBe('deny')
    expect(DENY_EFFECT['account.reenabled']).toBe('undeny')
    expect(DENY_EFFECT['product_access.revoked']).toBe('deny')
    expect(DENY_EFFECT['product_access.restored']).toBe('undeny')
    expect(DENY_EFFECT['session.revoked']).toBe('deny')
    expect(DENY_EFFECT['member.role_changed']).toBe('soft')
    expect(DENY_EFFECT['member.invited']).toBe('none')
  })

  it.each(ALL_TYPES)('builds + validates %s with a derived streamKey', (type) => {
    const ev = build(type, VALID[type])
    expect(ev.v).toBe(1)
    expect(ev.eventType).toBe(type)
    expect(ev.streamSeq).toBe(1)
    expect(validateDomainEvent(ev)).toEqual({ ok: true, event: ev })
    expect(ev.streamKey).toBe(deriveStreamKey(type, VALID[type].tenantId, VALID[type].data))
  })

  it('derives the documented streamKey scheme per family', () => {
    expect(build('member.joined', VALID['member.joined']).streamKey).toBe('tenant:7:member:99')
    expect(build('member.invited', VALID['member.invited']).streamKey).toBe('tenant:7:member:a@b.com')
    expect(build('account.disabled', VALID['account.disabled']).streamKey).toBe('account:99')
    expect(build('product_access.revoked', VALID['product_access.revoked']).streamKey).toBe('tenant:7:product:erp')
    expect(build('session.revoked', VALID['session.revoked']).streamKey).toBe('session:99:jti:jti-abc')
    expect(build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'device', ref: 'dev-1' } }).streamKey)
      .toBe('session:9:device:dev-1')
  })
})

// ── envelope strictness ────────────────────────────────────────────────────────
describe('envelope validation', () => {
  const good = build('member.suspended', VALID['member.suspended'], { streamSeq: 3 })
  it('rejects non-object / wrong v / unknown top-level key', () => {
    expect(validateDomainEvent(null).ok).toBe(false)
    expect(validateDomainEvent([]).ok).toBe(false)
    expect(validateDomainEvent({ ...good, v: 2 }).ok).toBe(false)
    expect(validateDomainEvent({ ...good, extra: 1 }).ok).toBe(false)
  })
  it('rejects unknown eventType (RP ignores it -> ok:false, not a throw)', () => {
    const r = validateDomainEvent({ ...good, eventType: 'tenant.suspended' })
    expect(r.ok).toBe(false)
  })
  it('rejects bad eventId / occurredAt / actorSub', () => {
    expect(validateDomainEvent({ ...good, eventId: '' }).ok).toBe(false)
    expect(validateDomainEvent({ ...good, occurredAt: '' }).ok).toBe(false)
    expect(validateDomainEvent({ ...good, actorSub: '' }).ok).toBe(false)
    expect(validateDomainEvent({ ...good, actorSub: 5 }).ok).toBe(false)
    expect(validateDomainEvent({ ...good, actorSub: null }).ok).toBe(true) // null allowed
  })
  it('rejects non-positive-int streamSeq', () => {
    for (const bad of [0, -1, 1.5, '1', null]) {
      expect(validateDomainEvent({ ...good, streamSeq: bad }).ok).toBe(false)
    }
  })
  it('enforces tenantId nullability per family', () => {
    // tenant-scoped requires a positive int
    expect(validateDomainEvent({ ...good, tenantId: null }).ok).toBe(false)
    expect(validateDomainEvent({ ...good, tenantId: 0 }).ok).toBe(false)
    // account/session require null
    const acct = build('account.disabled', VALID['account.disabled'])
    expect(validateDomainEvent({ ...acct, tenantId: 7, streamKey: 'account:99' }).ok).toBe(false)
  })
  it('rejects a streamKey that does not match the derived subject (tamper guard)', () => {
    expect(validateDomainEvent({ ...good, streamKey: 'tenant:7:member:OTHER' }).ok).toBe(false)
  })
})

// ── per-type data rules ────────────────────────────────────────────────────────
describe('payload validation', () => {
  it('rejects missing/!typed required keys', () => {
    expect(() => build('member.joined', { tenantId: 7, actorSub: '9', data: { sub: '9' } })).toThrow() // missing platformRole
    expect(() => build('member.joined', { tenantId: 7, actorSub: '9', data: { sub: '9', platformRole: 'nope' } })).toThrow()
    expect(() => build('member.invited', { tenantId: 7, actorSub: '9', data: { invitationId: 0, email: 'a@b', platformRole: 'member' } })).toThrow() // posint
  })
  it('member.invited cannot grant tenant_owner (invitable roles only)', () => {
    expect(() => build('member.invited', { tenantId: 7, actorSub: '9', data: { invitationId: 1, email: 'a@b', platformRole: 'tenant_owner' } })).toThrow()
  })
  it('optional reason: valid string ok, empty/!string rejected, absent ok', () => {
    expect(build('member.suspended', { tenantId: 7, actorSub: '1', data: { sub: '9', previousRole: 'member', reason: 'policy' } }).data.reason).toBe('policy')
    expect(() => build('member.suspended', { tenantId: 7, actorSub: '1', data: { sub: '9', previousRole: 'member', reason: '' } })).toThrow()
    expect(() => build('member.suspended', { tenantId: 7, actorSub: '1', data: { sub: '9', previousRole: 'member', reason: 5 } })).toThrow()
  })
})

// ── session bounded subject (R3 finding 1 + R4 finding) ─────────────────────────
describe('session.revoked bounded subject', () => {
  it('accepts device/jti with required ref', () => {
    expect(build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'device', ref: 'd1' } }).streamKey).toBe('session:9:device:d1')
    expect(build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'jti', ref: 'j1' } }).eventType).toBe('session.revoked')
  })
  it("REJECTS scope='user' (removed from v1)", () => {
    expect(() => build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'user', ref: 'x' } })).toThrow()
  })
  it('REJECTS missing ref', () => {
    expect(() => build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'jti' } })).toThrow()
  })
  it('REJECTS streamKey/scope mismatch at the wire boundary', () => {
    const ev = build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'jti', ref: 'j1' } })
    expect(validateDomainEvent({ ...ev, streamKey: 'session:9:device:j1' }).ok).toBe(false)
  })
})

// ── RP convergence rule (the frozen ordering semantics) ─────────────────────────
describe('RP deny-state convergence', () => {
  it('two-JTI out-of-order: both jti revokes end denied (distinct streamKeys, R3 finding 1)', () => {
    const rp = makeRpDenyState()
    const a = build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'jti', ref: 'A' } }, { streamSeq: 1 })
    const b = build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'jti', ref: 'B' } }, { streamSeq: 2 })
    rp.apply(b) // higher seq arrives first
    rp.apply(a) // lower seq arrives late -> still applied (different streamKey)
    expect(rp.isDenied('session:9:jti:A')).toBe(true)
    expect(rp.isDenied('session:9:jti:B')).toBe(true)
  })

  it('revoke jti:X does NOT deny a fresh-login jti:Y (R4: not a whole-user lockout)', () => {
    const rp = makeRpDenyState()
    rp.apply(build('session.revoked', { tenantId: null, actorSub: '9', data: { sub: '9', scope: 'jti', ref: 'X' } }, { streamSeq: 1 }))
    expect(rp.isDenied('session:9:jti:X')).toBe(true)
    // a re-login mints a NEW jti -> a NEW streamKey -> not in the deny-state
    expect(rp.isDenied('session:9:jti:Y')).toBe(false)
  })

  it('product_access revoke/restore set-clear converges (highest seq wins, any arrival order)', () => {
    const key = 'tenant:7:product:erp'
    // normal order: revoke(1) then restore(2) -> allowed
    const rp1 = makeRpDenyState()
    rp1.apply(build('product_access.revoked', VALID['product_access.revoked'], { streamSeq: 1 }))
    rp1.apply(build('product_access.restored', VALID['product_access.restored'], { streamSeq: 2 }))
    expect(rp1.isDenied(key)).toBe(false)
    // reordered: revoke is the HIGHER seq -> denied regardless of arrival order
    const rp2 = makeRpDenyState()
    rp2.apply(build('product_access.restored', VALID['product_access.restored'], { streamSeq: 1 }))
    rp2.apply(build('product_access.revoked', VALID['product_access.revoked'], { streamSeq: 2 }))
    expect(rp2.isDenied(key)).toBe(true)
    const rp3 = makeRpDenyState()
    rp3.apply(build('product_access.revoked', VALID['product_access.revoked'], { streamSeq: 2 }))
    rp3.apply(build('product_access.restored', VALID['product_access.restored'], { streamSeq: 1 })) // stale -> no-op
    expect(rp3.isDenied(key)).toBe(true)
  })

  it('duplicate / stale (seq <= lastApplied) is a no-op', () => {
    const rp = makeRpDenyState()
    const suspend = build('member.suspended', VALID['member.suspended'], { streamSeq: 5 })
    rp.apply(suspend)
    expect(rp.isDenied('tenant:7:member:99')).toBe(true)
    // a stale reactivate (lower seq) must NOT clear the deny
    rp.apply(build('member.reactivated', VALID['member.reactivated'], { streamSeq: 3 }))
    expect(rp.isDenied('tenant:7:member:99')).toBe(true)
    // a fresh reactivate (higher seq) clears it
    rp.apply(build('member.reactivated', VALID['member.reactivated'], { streamSeq: 6 }))
    expect(rp.isDenied('tenant:7:member:99')).toBe(false)
  })
})

// ── expand rule + canonical serialization ───────────────────────────────────────
describe('expand rule + canonical serialization', () => {
  it('TOLERATES an unknown optional data key (forward-compat)', () => {
    const ev = build('account.disabled', { tenantId: null, actorSub: '1', data: { sub: '9', futureField: 'x' } })
    expect(validateDomainEvent(ev).ok).toBe(true)
  })

  it('canonicalEventJson is stable regardless of data key insertion order', () => {
    const e1 = build('member.role_changed', { tenantId: 7, actorSub: '1', data: { sub: '9', fromRole: 'member', toRole: 'tenant_admin' } }, { streamSeq: 4, eventId: 'fixed' })
    const e2 = build('member.role_changed', { tenantId: 7, actorSub: '1', data: { toRole: 'tenant_admin', sub: '9', fromRole: 'member' } }, { streamSeq: 4, eventId: 'fixed' })
    expect(canonicalEventJson(e1)).toBe(canonicalEventJson(e2))
  })

  it('canonicalEventJson serializes nested arrays / null deterministically', () => {
    const ev = build('account.disabled', { tenantId: null, actorSub: '1', data: { sub: '9', list: [3, 1, 2], note: null } })
    const json = canonicalEventJson(ev)
    expect(json).toContain('"list":[3,1,2]')
    expect(json).toContain('"note":null')
    // re-parse is faithful
    expect(JSON.parse(json).data.sub).toBe('9')
  })
})
