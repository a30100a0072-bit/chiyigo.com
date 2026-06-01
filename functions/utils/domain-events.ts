/**
 * Domain-event CONTRACT — the frozen SSOT for the platform's deny-state / revocation events (PR4).
 *
 * Design: docs/reviews/pr4-invitation-member-lifecycle-plan-2026-06-01.md section 6 (Codex Gate 1 APPROVED, R4).
 *
 * WHY this is a pure contract module with NO I/O:
 *   D1 = Option B (Gate-1): PR4 freezes the event taxonomy + envelope + per-type payload validator + ordering rule
 *   so PR5 (event_outbox + lease/retry/DLQ/consumer) and every RP (ERP / senior-app) reuse it VERBATIM. PR4 itself
 *   does NOT emit, persist, or deliver any event — it only builds + validates them (exercised in unit tests).
 *
 * Ordering (R2 finding 4): the authority is (streamKey, streamSeq), NOT occurredAt. streamKey is the EXACT deny
 *   subject; streamSeq is a per-streamKey strictly-monotonic int the EMITTER (PR5) assigns. An RP keeps
 *   lastAppliedSeq per streamKey and applies an event only if streamSeq > lastAppliedSeq (idempotent under
 *   duplicate / out-of-order / replay delivery). occurredAt is human/audit only.
 *
 * session.revoked is BOUNDED (R4): scope is 'device' | 'jti' only (NEVER a whole-user scope) so a re-login is a
 *   NEW streamKey and is never permanently denied. Whole-account ban = account.disabled; whole-user logout-all =
 *   a PR5 token epoch / revokedBefore cutoff (NOT a deny-list subject).
 *
 * EXPAND rule (so PR5/PR6 are never blocked by v1): a NEW eventType or a NEW OPTIONAL data key is additive (no
 *   version bump) and unknown data keys are TOLERATED here; removing/retyping a required key, renaming an
 *   eventType, or changing an enum value is BREAKING (bump EVENT_SCHEMA_VERSION). RPs MUST ignore unknown
 *   eventTypes.
 */

export const EVENT_SCHEMA_VERSION = 1

export type DomainEventType =
  | 'member.invited'
  | 'member.joined'
  | 'member.suspended'
  | 'member.reactivated'
  | 'member.offboarded'
  | 'member.role_changed'
  | 'account.disabled'
  | 'account.reenabled'
  | 'product_access.revoked'
  | 'product_access.restored'
  | 'session.revoked'

/** The frozen v1 envelope (architecture section 11 + R2/R4 ordering fields). */
export interface DomainEvent {
  v: typeof EVENT_SCHEMA_VERSION
  eventId: string                 // unique; the DELIVERY-layer dedup key (at-least-once). PR5/emitter-assigned.
  eventType: DomainEventType
  streamKey: string               // the exact deny subject + ordering domain (derived; see deriveStreamKey)
  streamSeq: number               // positive int, strictly monotonic PER streamKey; the ordering authority. Emitter-assigned.
  occurredAt: string              // ISO-8601 UTC; human/audit + tie-break ONLY, never the ordering authority
  tenantId: number | null         // null ONLY for account-/session-scoped events
  actorSub: string | null         // who performed the action (admin/owner sub); null if system-driven
  data: Record<string, unknown>   // per-eventType; required keys closed-validated, optional keys tolerated
}

/** RP deny-state effect per eventType (frozen; documented for PR5 + RPs). */
export const DENY_EFFECT: Readonly<Record<DomainEventType, 'deny' | 'undeny' | 'soft' | 'none'>> = Object.freeze({
  'member.invited': 'none',           // not yet a member
  'member.joined': 'undeny',
  'member.suspended': 'deny',
  'member.reactivated': 'undeny',
  'member.offboarded': 'deny',
  'member.role_changed': 'soft',      // role change rides the <=15min token TTL, not a deny
  'account.disabled': 'deny',
  'account.reenabled': 'undeny',
  'product_access.revoked': 'deny',
  'product_access.restored': 'undeny',
  'session.revoked': 'deny',          // one-way per bounded subject (device/jti); never un-revoked
})

// ── value sets (frozen enums) ───────────────────────────────────────────────
const PLATFORM_ROLES = new Set<string>(['tenant_owner', 'tenant_admin', 'billing_admin', 'member'])
// invitations cannot grant tenant_owner (ownership transfer is a deliberate role-change, not an email link).
const INVITABLE_ROLES = new Set<string>(['tenant_admin', 'billing_admin', 'member'])
// session.revoked is BOUNDED only (R4): no 'user' scope in v1.
const SESSION_SCOPES = new Set<string>(['device', 'jti'])

type FieldRule = 'string' | 'posint' | 'platformRole' | 'invitableRole' | 'sessionScope'

interface EventSpec {
  tenant: 'tenant' | 'null'                                  // tenantId presence requirement
  required: Readonly<Record<string, FieldRule>>              // data required keys + types
  optional: Readonly<Record<string, FieldRule>>              // data optional keys (validated only if present)
  streamKey: (tenantId: number | null, data: Record<string, unknown>) => string
}

// Per-type spec. streamKey derivers interpolate already-validated required fields (String() to avoid leaking
// non-string into the key). member.invited keys on email (no sub pre-account); other member.* key on sub.
const SPECS: Readonly<Record<DomainEventType, EventSpec>> = Object.freeze({
  'member.invited': {
    tenant: 'tenant',
    required: { invitationId: 'posint', email: 'string', platformRole: 'invitableRole' },
    optional: {},
    streamKey: (t, d) => `tenant:${t}:member:${String(d.email)}`,
  },
  'member.joined': {
    tenant: 'tenant',
    required: { sub: 'string', platformRole: 'platformRole' },
    optional: {},
    streamKey: (t, d) => `tenant:${t}:member:${String(d.sub)}`,
  },
  'member.suspended': {
    tenant: 'tenant',
    required: { sub: 'string', previousRole: 'platformRole' },
    optional: { reason: 'string' },
    streamKey: (t, d) => `tenant:${t}:member:${String(d.sub)}`,
  },
  'member.reactivated': {
    tenant: 'tenant',
    required: { sub: 'string', platformRole: 'platformRole' },
    optional: {},
    streamKey: (t, d) => `tenant:${t}:member:${String(d.sub)}`,
  },
  'member.offboarded': {
    tenant: 'tenant',
    required: { sub: 'string' },
    optional: { reason: 'string' },
    streamKey: (t, d) => `tenant:${t}:member:${String(d.sub)}`,
  },
  'member.role_changed': {
    tenant: 'tenant',
    required: { sub: 'string', fromRole: 'platformRole', toRole: 'platformRole' },
    optional: {},
    streamKey: (t, d) => `tenant:${t}:member:${String(d.sub)}`,
  },
  'account.disabled': {
    tenant: 'null',
    required: { sub: 'string' },
    optional: { reason: 'string' },
    streamKey: (_t, d) => `account:${String(d.sub)}`,
  },
  'account.reenabled': {
    tenant: 'null',
    required: { sub: 'string' },
    optional: {},
    streamKey: (_t, d) => `account:${String(d.sub)}`,
  },
  'product_access.revoked': {
    tenant: 'tenant',
    required: { productId: 'string' },
    optional: { reason: 'string' },
    streamKey: (t, d) => `tenant:${t}:product:${String(d.productId)}`,
  },
  'product_access.restored': {
    tenant: 'tenant',
    required: { productId: 'string' },
    optional: { reason: 'string' },
    streamKey: (t, d) => `tenant:${t}:product:${String(d.productId)}`,
  },
  'session.revoked': {
    tenant: 'null',
    // bounded subject only (R4): scope device|jti, ref REQUIRED (the device-session id or the jti).
    required: { sub: 'string', scope: 'sessionScope', ref: 'string' },
    optional: {},
    streamKey: (_t, d) => `session:${String(d.sub)}:${String(d.scope)}:${String(d.ref)}`,
  },
})

const ENVELOPE_KEYS = new Set<string>([
  'v', 'eventId', 'eventType', 'streamKey', 'streamSeq', 'occurredAt', 'tenantId', 'actorSub', 'data',
])

// ── primitives ──────────────────────────────────────────────────────────────
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}
function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0
}
function checkField(v: unknown, rule: FieldRule): boolean {
  switch (rule) {
    case 'string':        return isNonEmptyString(v)
    case 'posint':        return isPositiveInt(v)
    case 'platformRole':  return typeof v === 'string' && PLATFORM_ROLES.has(v)
    case 'invitableRole': return typeof v === 'string' && INVITABLE_ROLES.has(v)
    case 'sessionScope':  return typeof v === 'string' && SESSION_SCOPES.has(v)
    default:              return false
  }
}

export type ValidateResult =
  | { ok: true; event: DomainEvent }
  | { ok: false; error: string }

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

/**
 * Derive the canonical streamKey for an eventType from its (validated) subject fields.
 * The single source of truth for streamKey shape; validateDomainEvent enforces wire events match it.
 * Throws on an unknown eventType (programmer error).
 */
export function deriveStreamKey(eventType: DomainEventType, tenantId: number | null, data: Record<string, unknown>): string {
  const spec = SPECS[eventType]
  if (!spec) throw new Error(`deriveStreamKey: unknown eventType ${eventType}`)
  return spec.streamKey(tenantId, data)
}

/**
 * Validate an arbitrary value as a v1 DomainEvent (untrusted-input boundary: PR5 consumer + RPs on the wire).
 * Strict on the 9 envelope scalar fields + each eventType's REQUIRED data keys; TOLERATES unknown data keys
 * (expand rule). Rejects unknown top-level keys, wrong tenantId nullability, bad streamSeq, and any streamKey
 * that does not match the derived subject key (closes the R3/R4 session-subject hole at the schema boundary).
 */
export function validateDomainEvent(obj: unknown): ValidateResult {
  if (!isObject(obj)) return fail('event must be an object')
  for (const k of Object.keys(obj)) {
    if (!ENVELOPE_KEYS.has(k)) return fail(`unknown envelope key: ${k}`)
  }
  if (obj.v !== EVENT_SCHEMA_VERSION) return fail(`v must be ${EVENT_SCHEMA_VERSION}`)
  if (typeof obj.eventType !== 'string' || !(obj.eventType in SPECS)) return fail('unknown eventType')
  const eventType = obj.eventType as DomainEventType
  const spec = SPECS[eventType]

  if (!isNonEmptyString(obj.eventId)) return fail('eventId must be a non-empty string')
  if (!isPositiveInt(obj.streamSeq)) return fail('streamSeq must be a positive integer')
  if (!isNonEmptyString(obj.occurredAt)) return fail('occurredAt must be a non-empty string')
  if (!(obj.actorSub === null || isNonEmptyString(obj.actorSub))) return fail('actorSub must be null or a non-empty string')

  const tenantId = obj.tenantId
  if (spec.tenant === 'tenant') {
    if (!isPositiveInt(tenantId)) return fail('tenantId must be a positive integer for this eventType')
  } else if (tenantId !== null) {
    return fail('tenantId must be null for this eventType')
  }

  if (!isObject(obj.data)) return fail('data must be an object')
  const data = obj.data
  for (const key of Object.keys(spec.required)) {
    if (!(key in data)) return fail(`missing required data.${key}`)
    if (!checkField(data[key], spec.required[key])) return fail(`data.${key} invalid (expected ${spec.required[key]})`)
  }
  for (const key of Object.keys(spec.optional)) {
    if (key in data && data[key] !== undefined && !checkField(data[key], spec.optional[key])) {
      return fail(`data.${key} invalid (expected ${spec.optional[key]})`)
    }
  }
  // unknown data keys are intentionally TOLERATED (expand rule) -- no rejection here.

  const expectedKey = spec.streamKey(tenantId as number | null, data)
  if (obj.streamKey !== expectedKey) return fail(`streamKey mismatch (expected ${expectedKey})`)

  // SAFETY: every field validated above; the shape now matches DomainEvent.
  return { ok: true, event: obj as unknown as DomainEvent }
}

/** Envelope subject fields the caller supplies (streamKey is DERIVED, not supplied). */
export interface DomainEventInput {
  tenantId: number | null
  actorSub: string | null
  data: Record<string, unknown>
}
/** Runtime/emitter-assigned metadata (eventId + streamSeq + occurredAt live at the call site, PR5). */
export interface DomainEventMeta {
  eventId: string
  streamSeq: number
  occurredAt: string
}

/**
 * Build a validated DomainEvent. streamKey is DERIVED from (eventType, tenantId, data) — the caller never
 * supplies it (single source of derivation; safer than the plan's sketch that listed it as a param). Throws
 * if the result is not a valid v1 event. PR4 calls this only in unit tests; PR5 calls it at emission time.
 */
export function buildDomainEvent(eventType: DomainEventType, input: DomainEventInput, meta: DomainEventMeta): DomainEvent {
  if (!(eventType in SPECS)) throw new Error(`buildDomainEvent: unknown eventType ${eventType}`)
  const candidate: DomainEvent = {
    v: EVENT_SCHEMA_VERSION,
    eventId: meta.eventId,
    eventType,
    streamKey: deriveStreamKey(eventType, input.tenantId, input.data),
    streamSeq: meta.streamSeq,
    occurredAt: meta.occurredAt,
    tenantId: input.tenantId,
    actorSub: input.actorSub,
    data: input.data,
  }
  const res = validateDomainEvent(candidate)
  // res.ok === false (not !res.ok): under this tsconfig's strict:false, truthiness narrowing does not
  // narrow the falsy branch of a discriminated union (PR1 踩雷 #1 / feedback_ts_*), so === false is required.
  if (res.ok === false) throw new Error(`buildDomainEvent: invalid ${eventType}: ${res.error}`)
  return res.event
}

/** Stable, key-sorted JSON serialization (deterministic regardless of key order) for PR5 outbox payload + hash. */
export function canonicalEventJson(event: DomainEvent): string {
  return stableStringify(event)
}
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const obj = v as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}'
}
