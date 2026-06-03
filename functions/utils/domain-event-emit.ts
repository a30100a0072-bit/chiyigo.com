/**
 * Domain-event EMISSION helper — PR5 5a (plan section 9.1, Gate-1 R4 APPROVED).
 *
 * Each exported builder returns the TWO D1 prepared statements [seqUpsert, outboxInsert] that a caller splices
 * into its db.batch() IMMEDIATELY AFTER the GATING mutation (the last business statement whose changes() means
 * "this request applied it"). The result is one atomic batch:
 *
 *     db.batch([ <gating mutation>, seqUpsert, outboxInsert ])
 *
 * so the business change and its event are both-or-neither, and the event is emitted ONLY when the mutation
 * actually changed a row. The mechanism (validated by the 5a spike on local AND remote D1):
 *   seqUpsert    : INSERT ... SELECT ?,1 WHERE changes()=1 ON CONFLICT DO UPDATE last_seq+1
 *                  -> allocates the per-streamKey seq ONLY if the gating mutation's changes()=1 (else no-op).
 *   outboxInsert : INSERT ... SELECT ..., (SELECT last_seq ...), <data json_object> WHERE changes()=1
 *                  -> reflects the seqUpsert; reads the freshly-allocated seq + any SQL-DERIVED data field
 *                     (read-your-writes inside the batch). No event on a 0-row mutation.
 *
 * Payload provenance (plan F1): some data fields MUST be authoritative, not a stale app pre-read:
 *   - BOUND       : known + immutable pre-batch (sub, toRole, an immutable invite role).
 *   - SQL-DERIVED : read in-batch AFTER the mutation (suspend/reactivate role -- the mutation does not change the
 *                   role, so the post-mutation row carries the true role under any concurrency).
 *   - CAS-PINNED  : role_changed.fromRole is pinned in the caller's CAS (`= ?fromRole`), so the emit (gated on
 *                   that CAS) fires only when the role was fromRole -> the bound value is authoritative.
 *
 * eventId + occurredAt are INJECTED by the caller (side-effects-through-adapter + deterministic tests). The
 * helper does NO I/O and NO time/random generation. streamSeq is filled by seqUpsert in-batch. The frozen
 * contract (domain-events.ts) is the single source of streamKey derivation + shape validation; the 5b consumer
 * re-validates the fully-concrete event at delivery (defense in depth for SQL-derived fields).
 */

import { buildDomainEvent, type DomainEventType } from './domain-events'

/** D1 binding type via ambient Env indexed access (same convention as members.ts / credit.ts). */
type ChiyigoDb = Env['chiyigo_db']
type Stmt = ReturnType<ChiyigoDb['prepare']>

/** Runtime/emitter-assigned metadata the caller supplies (streamSeq is in-batch allocated, NOT here). */
export interface EmitMeta {
  eventId: string
  occurredAt: string
}

/**
 * The EMISSION IDENTITY a domain transition returns to its endpoint on 'applied' (PR5 5b, plan C3). The endpoint
 * audits domain.event.emitted from this POST-COMMIT, best-effort. streamSeq is intentionally absent: it is
 * in-batch allocated and lives on the outbox row (no Tier-0 read-back needed just to audit). The audit redacts
 * streamKey to a hash -- the RAW streamKey is carried here only so the endpoint can hash it (never logged raw).
 */
export interface EmitIdentity {
  eventId: string
  eventType: DomainEventType
  streamKey: string
  tenantId: number | null
}

/** What an emit builder returns: the in-batch [seqUpsert, outboxInsert] statements PLUS the emission identity. */
export interface EmitResult {
  statements: Stmt[]
  identity: EmitIdentity
}

function emitResult(eventType: DomainEventType, streamKey: string, tenantId: number | null, meta: EmitMeta, statements: Stmt[]): EmitResult {
  return { statements, identity: { eventId: meta.eventId, eventType, streamKey, tenantId } }
}

// A valid platformRole used ONLY as a sentinel to shape-validate events whose role is SQL-DERIVED (the real
// value comes from the DB, which constrains platform_role; the consumer re-validates the concrete event).
const ROLE_SENTINEL = 'member'

// ── shared statement builders ──────────────────────────────────────────────────

/** S2: allocate the next per-streamKey seq, gated on the prior (gating) mutation's changes()=1. */
function seqUpsert(db: ChiyigoDb, streamKey: string): Stmt {
  return db
    .prepare(
      `INSERT INTO event_stream_sequences (stream_key, last_seq)
       SELECT ?, 1 WHERE changes() = 1
       ON CONFLICT(stream_key) DO UPDATE SET last_seq = last_seq + 1, updated_at = datetime('now')`,
    )
    .bind(streamKey)
}

interface Envelope {
  eventId: string
  eventType: DomainEventType
  streamKey: string
  tenantId: number | null
  actorSub: string | null
  occurredAt: string
}

/**
 * S3: insert the outbox row, gated on the seqUpsert's changes()=1. `dataJsonSql` is an SQL expression producing
 * the data_json TEXT (a json_object(...) call); `dataBinds` are its bind params, appended after the envelope
 * binds in EXACT positional order with the `?` placeholders inside dataJsonSql.
 */
function outboxInsert(db: ChiyigoDb, env: Envelope, dataJsonSql: string, dataBinds: unknown[]): Stmt {
  return db
    .prepare(
      `INSERT INTO event_outbox
         (event_id, event_type, stream_key, stream_seq, tenant_id, actor_sub, occurred_at, data_json,
          status, attempts, next_attempt_at, created_at)
       SELECT ?, ?, ?, (SELECT last_seq FROM event_stream_sequences WHERE stream_key = ?),
              ?, ?, ?, ${dataJsonSql}, 'pending', 0, datetime('now'), datetime('now')
       WHERE changes() = 1`,
    )
    .bind(env.eventId, env.eventType, env.streamKey, env.streamKey, env.tenantId, env.actorSub, env.occurredAt, ...dataBinds)
}

/**
 * Validate the BOUND fields + derive the canonical streamKey via the FROZEN contract. SQL-derived role fields
 * are passed a valid sentinel here purely for shape validation (their real value is read in-SQL + DB-constrained
 * + re-validated at delivery). Throws on bad bound input (programmer error, same as buildDomainEvent).
 */
function deriveStreamKeyValidated(
  eventType: DomainEventType,
  tenantId: number | null,
  actorSub: string | null,
  dataForValidation: Record<string, unknown>,
  meta: EmitMeta,
): string {
  const ev = buildDomainEvent(
    eventType,
    { tenantId, actorSub, data: dataForValidation },
    { eventId: meta.eventId, streamSeq: 1, occurredAt: meta.occurredAt },
  )
  return ev.streamKey
}

// ── per-event builders (5a wired sites; members.ts + invitations.ts) ────────────

export interface MemberEmitInput {
  tenantId: number
  targetUserId: number
  actorUserId: number
}

/** member.suspended — previousRole is SQL-DERIVED (read AFTER the suspend; the suspend does not change role). */
export function emitMemberSuspended(db: ChiyigoDb, input: MemberEmitInput, meta: EmitMeta): EmitResult {
  const sub = String(input.targetUserId)
  const actorSub = String(input.actorUserId)
  const streamKey = deriveStreamKeyValidated('member.suspended', input.tenantId, actorSub, { sub, previousRole: ROLE_SENTINEL }, meta)
  const dataSql = `json_object('sub', ?, 'previousRole', (SELECT platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?))`
  return emitResult('member.suspended', streamKey, input.tenantId, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'member.suspended', streamKey, tenantId: input.tenantId, actorSub, occurredAt: meta.occurredAt }, dataSql, [sub, input.tenantId, input.targetUserId]),
  ])
}

/** member.reactivated — platformRole is SQL-DERIVED (read AFTER reactivate; reactivate does not change role). */
export function emitMemberReactivated(db: ChiyigoDb, input: MemberEmitInput, meta: EmitMeta): EmitResult {
  const sub = String(input.targetUserId)
  const actorSub = String(input.actorUserId)
  const streamKey = deriveStreamKeyValidated('member.reactivated', input.tenantId, actorSub, { sub, platformRole: ROLE_SENTINEL }, meta)
  const dataSql = `json_object('sub', ?, 'platformRole', (SELECT platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?))`
  return emitResult('member.reactivated', streamKey, input.tenantId, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'member.reactivated', streamKey, tenantId: input.tenantId, actorSub, occurredAt: meta.occurredAt }, dataSql, [sub, input.tenantId, input.targetUserId]),
  ])
}

/** member.offboarded — data {sub} only (no role); offboard DELETEs the row, so nothing is SQL-derived. */
export function emitMemberOffboarded(db: ChiyigoDb, input: MemberEmitInput, meta: EmitMeta): EmitResult {
  const sub = String(input.targetUserId)
  const actorSub = String(input.actorUserId)
  const streamKey = deriveStreamKeyValidated('member.offboarded', input.tenantId, actorSub, { sub }, meta)
  return emitResult('member.offboarded', streamKey, input.tenantId, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'member.offboarded', streamKey, tenantId: input.tenantId, actorSub, occurredAt: meta.occurredAt }, `json_object('sub', ?)`, [sub]),
  ])
}

export interface RoleChangedEmitInput extends MemberEmitInput {
  fromRole: string
  toRole: string
}

/** member.role_changed — fromRole is CAS-PINNED in the caller's mutation (`= ?fromRole`), so it is authoritative. */
export function emitMemberRoleChanged(db: ChiyigoDb, input: RoleChangedEmitInput, meta: EmitMeta): EmitResult {
  const sub = String(input.targetUserId)
  const actorSub = String(input.actorUserId)
  const streamKey = deriveStreamKeyValidated('member.role_changed', input.tenantId, actorSub, { sub, fromRole: input.fromRole, toRole: input.toRole }, meta)
  return emitResult('member.role_changed', streamKey, input.tenantId, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'member.role_changed', streamKey, tenantId: input.tenantId, actorSub, occurredAt: meta.occurredAt }, `json_object('sub', ?, 'fromRole', ?, 'toRole', ?)`, [sub, input.fromRole, input.toRole]),
  ])
}

export interface MemberJoinedEmitInput {
  tenantId: number
  acceptingUserId: number
  platformRole: string
}

/** member.joined — platformRole is BOUND from the IMMUTABLE invite row. actor is the accepting user (self). */
export function emitMemberJoined(db: ChiyigoDb, input: MemberJoinedEmitInput, meta: EmitMeta): EmitResult {
  const sub = String(input.acceptingUserId)
  const streamKey = deriveStreamKeyValidated('member.joined', input.tenantId, sub, { sub, platformRole: input.platformRole }, meta)
  return emitResult('member.joined', streamKey, input.tenantId, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'member.joined', streamKey, tenantId: input.tenantId, actorSub: sub, occurredAt: meta.occurredAt }, `json_object('sub', ?, 'platformRole', ?)`, [sub, input.platformRole]),
  ])
}

export interface MemberInvitedEmitInput {
  tenantId: number
  email: string
  platformRole: string
  tokenHash: string        // to SQL-derive the just-inserted invitationId (read-your-writes)
  invitedByUserId: number
}

/**
 * member.invited — invitationId is SQL-DERIVED: read back from the invitations row JUST inserted in the same
 * batch (by token_hash), because the AUTOINCREMENT id does not exist before the INSERT. streamKey is EMAIL-keyed
 * (tenant:T:member:<email>), distinct from the sub-keyed member.* streams; DENY_EFFECT is 'none'. actor = inviter.
 */
export function emitMemberInvited(db: ChiyigoDb, input: MemberInvitedEmitInput, meta: EmitMeta): EmitResult {
  const actorSub = String(input.invitedByUserId)
  // sentinel invitationId (posint) for shape validation only; the real id is SQL-derived + re-validated at delivery.
  const streamKey = deriveStreamKeyValidated('member.invited', input.tenantId, actorSub, { invitationId: 1, email: input.email, platformRole: input.platformRole }, meta)
  const dataSql = `json_object('invitationId', (SELECT id FROM invitations WHERE token_hash = ?), 'email', ?, 'platformRole', ?)`
  return emitResult('member.invited', streamKey, input.tenantId, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'member.invited', streamKey, tenantId: input.tenantId, actorSub, occurredAt: meta.occurredAt }, dataSql, [input.tokenHash, input.email, input.platformRole]),
  ])
}

// ── account.* builders (5c wired sites; admin ban / unban) ───────────────────────
// account.disabled / account.reenabled key on the STABLE account:<sub> (the user's numeric id) -- correct, because
// account disable/reenable is a sticky per-account toggle (ban=deny seq N -> unban=undeny seq N+1 on ONE stream),
// the inverse of session.revoked (which must be per-login and is therefore DEFERRED to 5d). tenantId is null
// (account-scoped). data is {sub} only -- fully BOUND (sub is the immutable target id; actor is the admin), so no
// json_object subquery / SQL-derived / CAS-pinned field, and the existing single-row changes()=1 seqUpsert applies.

export interface AccountEmitInput {
  targetUserId: number
  actorUserId: number
}

/** account.disabled — admin ban. data {sub}(bound); streamKey account:<sub>; tenant null; actor = the admin. */
export function emitAccountDisabled(db: ChiyigoDb, input: AccountEmitInput, meta: EmitMeta): EmitResult {
  const sub = String(input.targetUserId)
  const actorSub = String(input.actorUserId)
  const streamKey = deriveStreamKeyValidated('account.disabled', null, actorSub, { sub }, meta)
  return emitResult('account.disabled', streamKey, null, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'account.disabled', streamKey, tenantId: null, actorSub, occurredAt: meta.occurredAt }, `json_object('sub', ?)`, [sub]),
  ])
}

/** account.reenabled — admin unban. data {sub}(bound); streamKey account:<sub>; tenant null; actor = the admin. */
export function emitAccountReenabled(db: ChiyigoDb, input: AccountEmitInput, meta: EmitMeta): EmitResult {
  const sub = String(input.targetUserId)
  const actorSub = String(input.actorUserId)
  const streamKey = deriveStreamKeyValidated('account.reenabled', null, actorSub, { sub }, meta)
  return emitResult('account.reenabled', streamKey, null, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'account.reenabled', streamKey, tenantId: null, actorSub, occurredAt: meta.occurredAt }, `json_object('sub', ?)`, [sub]),
  ])
}

// ── session.revoked builder (5d-2 wired sites; auth/logout, devices/logout, admin mode=device) ───────────────────
// session.revoked keys on session:<sub>:device:<ref> where ref is the PER-LOGIN family id (NOT the stable account
// id, NOT device_uuid) -- the inverse of account.* : a re-login is a NEW ref -> a NEW streamKey, never permanently
// denied (the frozen contract's promise, domain-events.ts:16-18). The CALLER supplies ref from its pre-read of the
// IMMUTABLE session_id (COALESCE(session_id,'legacy_'||id)), so streamKey stays BOUND -- no SQL-derived field.
// scope is fixed 'device' (jti scope deferred to a later phase). tenant null (session-scoped). DENY_EFFECT='deny'
// (one-way; a session is never un-revoked). data {sub,scope,ref} is fully BOUND, so the existing single-row
// changes()=1 seqUpsert applies (per family; a multi-family caller splices one [seqUpsert,outboxInsert] per family
// behind a GLOBAL (user_id,ref) COUNT=1 fail-closed preflight -- 5d-2 plan §4). ref is the OPAQUE family id only;
// this NEVER carries a raw refresh token (no token_hash, no plaintext) -- the audit layer hashes the streamKey too.

export interface SessionRevokedEmitInput {
  sub: string              // String(userId) -- the session owner (server-resolved; NEVER client-supplied)
  ref: string              // per-login family id = COALESCE(session_id,'legacy_'||id) (immutable; caller pre-reads)
  actorSub: string | null  // self-logout: the user's sub; admin: the admin sub; system-driven: null
}

/** session.revoked — bounded device-scope. streamKey session:<sub>:device:<ref>; tenant null; one-way 'deny'. */
export function emitSessionRevoked(db: ChiyigoDb, input: SessionRevokedEmitInput, meta: EmitMeta): EmitResult {
  const streamKey = deriveStreamKeyValidated('session.revoked', null, input.actorSub, { sub: input.sub, scope: 'device', ref: input.ref }, meta)
  return emitResult('session.revoked', streamKey, null, meta, [
    seqUpsert(db, streamKey),
    outboxInsert(db, { eventId: meta.eventId, eventType: 'session.revoked', streamKey, tenantId: null, actorSub: input.actorSub, occurredAt: meta.occurredAt }, `json_object('sub', ?, 'scope', 'device', 'ref', ?)`, [input.sub, input.ref]),
  ])
}
