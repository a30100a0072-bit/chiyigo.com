/**
 * Invitation lifecycle domain module — PR4 (create / accept / revoke / list).
 *
 * Design: docs/reviews/pr4-invitation-member-lifecycle-plan-2026-06-01.md section 7 (Gate-1 APPROVED R4).
 *
 * Tier-0 properties (verified by integration tests):
 *  - One-time signed token: the raw 32-byte hex token travels only in the email link + accept body; only its
 *    SHA-256 is stored (token_hash UNIQUE). accept is an ATOMIC one-time consume (CAS) + a PLAIN INSERT join
 *    (NO ON CONFLICT) so a leaked/replayed link can never silently reactivate a suspended/offboarded member.
 *  - accepted-link REPLAY is gated on LIVE membership (R3 finding 3): re-clicking an already-accepted link
 *    returns 200 replay ONLY if the user is still an active member; suspended -> MEMBERSHIP_NOT_ACTIVE;
 *    offboarded (row gone) -> already_resolved (a fresh invite is required). Never a silent re-join.
 *  - Errors are classified by RE-READING DB state, never by parsing a D1/SQLite message (mirror credit.ts).
 *
 * PR4 emits NO domain event (D1 = Option B); the endpoint audits dispositions. expires_at is set + compared
 * via SQLite datetime() (never app-ISO) to avoid the lexical-compare trap (feedback_sqlite_iso_datetime_compare).
 */

import { generateSecureToken, hashToken } from './crypto'
import { emitMemberInvited, emitMemberJoined, type EmitIdentity } from './domain-event-emit'
import { type PlatformRole } from './tenant-context'

type ChiyigoDb = Env['chiyigo_db']

const MAX_EMAIL_LEN = 320
const DEFAULT_TTL_SECONDS = 7 * 24 * 3600   // 7 days
const MAX_TTL_SECONDS = 30 * 24 * 3600      // 30 days
const INVITABLE_ROLES: ReadonlySet<string> = new Set(['tenant_admin', 'billing_admin', 'member'])
// ISO-CROSS-01: granting a manager-level role is owner-only (mirrors the OWNER_ONLY gate on PATCH /role).
const OWNER_ONLY_INVITE_ROLES: ReadonlySet<string> = new Set(['tenant_admin', 'billing_admin'])
// well-formed enough for an invite address; the endpoint may validate more strictly at the boundary.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── outcomes ─────────────────────────────────────────────────────────────────

export type InviteCreateOutcome =
  | { outcome: 'created'; invitationId: number; rawToken: string; email: string; platformRole: string; emitted: EmitIdentity }
  | { outcome: 'already_member' }                 // email already maps to an active/suspended member
  | { outcome: 'tenant_ineligible' }              // not an active organization tenant
  | { outcome: 'inviter_role_insufficient' }      // ISO-CROSS-01: only an owner may invite a manager-level role
  | { outcome: 'invalid'; code: string }

export type InviteAcceptOutcome =
  | { outcome: 'joined'; tenantId: number; platformRole: string; sub: string; emitted: EmitIdentity }
  | { outcome: 'replay'; tenantId: number; platformRole: string }
  | { outcome: 'not_found' }
  | { outcome: 'expired' }
  | { outcome: 'email_mismatch' }                 // accepting user's verified email != invite email (or unverified)
  | { outcome: 'membership_not_active' }          // accepted by self but now suspended (R3)
  | { outcome: 'already_resolved' }               // accepted-by-other / revoked / offboarded-old-link
  | { outcome: 'already_member' }                 // already an active/suspended member (no silent reactivation)
  | { outcome: 'tenant_ineligible' }
  | { outcome: 'invalid'; code: string }

export type InviteRevokeOutcome =
  | { outcome: 'revoked' }
  | { outcome: 'not_pending' }
  | { outcome: 'not_found' }
  | { outcome: 'invalid'; code: string }

export interface PendingInvitationDto {
  id: number
  email: string
  platform_role: string
  expires_at: string
  created_at: string
}

// ── helpers ──────────────────────────────────────────────────────────────────

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}
function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

interface TenantRow { type: string; status: string }
/** Active organization tenant (member ops never touch personal tenants). */
async function loadActiveOrgTenant(db: ChiyigoDb, tenantId: number): Promise<TenantRow | null> {
  const t = await db
    .prepare(`SELECT type, status FROM tenants WHERE id = ? AND deleted_at IS NULL`)
    .bind(tenantId)
    .first<TenantRow>()
  if (!t || t.type !== 'organization' || t.status !== 'active') return null
  return t
}

/** Is `email` already an active/suspended member of the tenant (via users.email -> organization_members)? */
async function emailIsExistingMember(db: ChiyigoDb, tenantId: number, email: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS hit
         FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ? AND u.email = ? AND u.deleted_at IS NULL
          AND m.status IN ('active','suspended')
        LIMIT 1`,
    )
    .bind(tenantId, email)
    .first<{ hit: number }>()
  return !!row
}

// ── createInvitation ───────────────────────────────────────────────────────────

export interface CreateInvitationInput {
  tenantId: number
  email: string
  platformRole: string
  invitedByUserId: number
  /** Live platform_role of the inviter (from the endpoint gate). Manager-level invites are owner-only (ISO-CROSS-01). */
  inviterPlatformRole: PlatformRole
  ttlSeconds?: number
}

export async function createInvitation(db: ChiyigoDb, input: CreateInvitationInput): Promise<InviteCreateOutcome> {
  if (!input || typeof input !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.tenantId) || !isPositiveInt(input.invitedByUserId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.platformRole !== 'string' || !INVITABLE_ROLES.has(input.platformRole)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  // ISO-CROSS-01: inviting someone as a manager-level role (tenant_admin/billing_admin) is owner-only, aligning
  // with the OWNER_ONLY gate on PATCH /role -- otherwise a tenant_admin could mint peer managers via invitation
  // what they cannot do via promotion. deny-by-default: any non-owner inviter is rejected for these roles.
  if (OWNER_ONLY_INVITE_ROLES.has(input.platformRole) && input.inviterPlatformRole !== 'tenant_owner') {
    return { outcome: 'inviter_role_insufficient' }
  }
  if (typeof input.email !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const email = normalizeEmail(input.email)
  if (email.length === 0 || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  let ttl = input.ttlSeconds === undefined ? DEFAULT_TTL_SECONDS : input.ttlSeconds
  if (!isPositiveInt(ttl) || ttl > MAX_TTL_SECONDS) {
    if (input.ttlSeconds !== undefined) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
    ttl = DEFAULT_TTL_SECONDS
  }

  const tenant = await loadActiveOrgTenant(db, input.tenantId)
  if (!tenant) return { outcome: 'tenant_ineligible' }
  if (await emailIsExistingMember(db, input.tenantId, email)) return { outcome: 'already_member' }

  const rawToken = generateSecureToken()
  const tokenHash = await hashToken(rawToken)

  // Atomic: revoke any existing pending invite for (tenant,email) THEN insert the new one. Within one batch the
  // revoke precedes the insert, so the partial-unique uq_invitations_pending is always clear -> no collision.
  // Concurrent createInvitation calls serialize (D1) -> latest invite wins (older links revoked).
  const revoke = db
    .prepare(`UPDATE invitations SET status = 'revoked', updated_at = datetime('now') WHERE tenant_id = ? AND email = ? AND status = 'pending'`)
    .bind(input.tenantId, email)
  const insert = db
    .prepare(
      `INSERT INTO invitations (tenant_id, email, platform_role, token_hash, status, expires_at, invited_by)
       VALUES (?, ?, ?, ?, 'pending', datetime('now', ?), ?)`,
    )
    .bind(input.tenantId, email, input.platformRole, tokenHash, `+${ttl} seconds`, input.invitedByUserId)
  // member.invited emitted in the SAME batch, gated on the INSERT (the invite was created). invitationId is
  // SQL-DERIVED (read-your-writes of the just-inserted invitations row by token_hash); email-keyed streamKey,
  // 'none' deny-effect. The insert always applies, so a successful create always emits exactly one event.
  const emit = emitMemberInvited(
    db,
    { tenantId: input.tenantId, email, platformRole: input.platformRole, tokenHash, invitedByUserId: input.invitedByUserId },
    { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() },
  )
  await db.batch([revoke, insert, ...emit.statements])

  const row = await db.prepare(`SELECT id FROM invitations WHERE token_hash = ?`).bind(tokenHash).first<{ id: number }>()
  return { outcome: 'created', invitationId: row ? row.id : 0, rawToken, email, platformRole: input.platformRole, emitted: emit.identity }
}

// ── acceptInvitation ─────────────────────────────────────────────────────────────

interface InviteRow {
  id: number; tenant_id: number; email: string; platform_role: string
  status: string; accepted_user_id: number | null; is_expired: number
}

export interface AcceptInvitationInput {
  rawToken: string
  acceptingUserId: number
}

export async function acceptInvitation(db: ChiyigoDb, input: AcceptInvitationInput): Promise<InviteAcceptOutcome> {
  if (!input || typeof input !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.acceptingUserId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.rawToken !== 'string' || input.rawToken.length === 0) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const tokenHash = await hashToken(input.rawToken)

  const invite = await db
    .prepare(
      `SELECT id, tenant_id, email, platform_role, status, accepted_user_id,
              (expires_at <= datetime('now')) AS is_expired
         FROM invitations WHERE token_hash = ?`,
    )
    .bind(tokenHash)
    .first<InviteRow>()
  if (!invite) return { outcome: 'not_found' }

  const user = await db
    .prepare(`SELECT email, email_verified FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(input.acceptingUserId)
    .first<{ email: string; email_verified: number }>()
  if (!user) return { outcome: 'invalid', code: 'ACTOR_NOT_FOUND' }

  // Terminal states (no write).
  if (invite.status !== 'pending') {
    if (invite.status === 'accepted' && invite.accepted_user_id === input.acceptingUserId) {
      // accepted-by-self replay -> gated on LIVE membership (R3 finding 3).
      const m = await db
        .prepare(`SELECT status, platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?`)
        .bind(invite.tenant_id, input.acceptingUserId)
        .first<{ status: string; platform_role: string }>()
      if (!m) return { outcome: 'already_resolved' }            // offboarded (row gone) -> needs fresh invite
      if (m.status !== 'active') return { outcome: 'membership_not_active' } // suspended -> NOT ok:true, NOT reactivated
      return { outcome: 'replay', tenantId: invite.tenant_id, platformRole: m.platform_role }
    }
    if (invite.status === 'expired') return { outcome: 'expired' }
    return { outcome: 'already_resolved' }                       // revoked, or accepted-by-someone-else
  }

  // status === 'pending'
  if (invite.is_expired) return { outcome: 'expired' }
  if (normalizeEmail(user.email) !== invite.email || !user.email_verified) return { outcome: 'email_mismatch' }
  if (!(await loadActiveOrgTenant(db, invite.tenant_id))) return { outcome: 'tenant_ineligible' }
  const existing = await db
    .prepare(`SELECT status FROM organization_members WHERE tenant_id = ? AND user_id = ?`)
    .bind(invite.tenant_id, input.acceptingUserId)
    .first<{ status: string }>()
  if (existing && (existing.status === 'active' || existing.status === 'suspended')) return { outcome: 'already_member' }

  // Atomic one-time consume (S1 CAS) + conditional plain INSERT join (S2 gated on S1 applying THIS request via
  // the unique occurredAt marker). NO ON CONFLICT: a pre-existing membership row -> UNIQUE violation -> whole
  // batch rolls back (incl. the consume) -> classified already_member. Offboard DELETEs the row, so re-onboarding
  // is a clean fresh INSERT.
  const occurredAt = new Date().toISOString()
  const consume = db
    .prepare(
      `UPDATE invitations SET status = 'accepted', accepted_user_id = ?, accepted_at = ?, updated_at = ?
        WHERE token_hash = ? AND status = 'pending' AND expires_at > datetime('now')`,
    )
    .bind(input.acceptingUserId, occurredAt, occurredAt, tokenHash)
  const join = db
    .prepare(
      `INSERT INTO organization_members (tenant_id, user_id, platform_role, status)
       SELECT tenant_id, ?, platform_role, 'active'
         FROM invitations WHERE token_hash = ? AND accepted_user_id = ? AND accepted_at = ?`,
    )
    .bind(input.acceptingUserId, tokenHash, input.acceptingUserId, occurredAt)
  // member.joined emitted in the SAME batch, gated on the JOIN insert (ruling 18.6: the join is "this request
  // joined", not the consume). platformRole is BOUND from the IMMUTABLE invite row. Fresh eventId; occurredAt
  // reuses the accept marker (event occurredAt is audit-only).
  const emit = emitMemberJoined(
    db,
    { tenantId: invite.tenant_id, acceptingUserId: input.acceptingUserId, platformRole: invite.platform_role },
    { eventId: crypto.randomUUID(), occurredAt },
  )

  try {
    await db.batch([consume, join, ...emit.statements])
  } catch (e) {
    // F2: a batch error is NOT necessarily the join's UNIQUE -- the outbox emit lives in this batch now, so an
    // emission / seq / outbox failure also rolls the whole batch back here. Return a BUSINESS outcome ONLY when a
    // re-read POSITIVELY proves one; otherwise RETHROW (system failure -> 5xx), never masking it as a business 200.
    const m = await db
      .prepare(`SELECT status FROM organization_members WHERE tenant_id = ? AND user_id = ?`)
      .bind(invite.tenant_id, input.acceptingUserId)
      .first<{ status: string }>()
    if (m) return { outcome: 'already_member' }            // join UNIQUE-violated: membership already exists
    const inv = await db
      .prepare(`SELECT accepted_user_id FROM invitations WHERE token_hash = ?`)
      .bind(tokenHash)
      .first<{ accepted_user_id: number | null }>()
    if (inv && inv.accepted_user_id !== null && inv.accepted_user_id !== input.acceptingUserId) {
      return { outcome: 'already_resolved' }               // consumed by another sub (committed elsewhere)
    }
    throw e                                                // unexplained (emission/outbox/system) -> do NOT mask
  }

  // Did THIS request win the consume?
  const after = await db
    .prepare(`SELECT accepted_user_id, accepted_at, platform_role, tenant_id FROM invitations WHERE token_hash = ?`)
    .bind(tokenHash)
    .first<{ accepted_user_id: number | null; accepted_at: string | null; platform_role: string; tenant_id: number }>()
  if (after && after.accepted_user_id === input.acceptingUserId && after.accepted_at === occurredAt) {
    return { outcome: 'joined', tenantId: after.tenant_id, platformRole: after.platform_role, sub: String(input.acceptingUserId), emitted: emit.identity }
  }
  // A concurrent accept by ANOTHER user won the consume: re-derive a stable deny.
  if (after && after.accepted_user_id !== null && after.accepted_user_id !== input.acceptingUserId) return { outcome: 'already_resolved' }
  // A concurrent accept by the SAME user won (this request saw 'pending' at the pre-check, then lost the consume CAS
  // to a sibling click -> the row is accepted by self but at a DIFFERENT accepted_at). We did NOT 'expire': the user
  // IS resolved. Re-read live membership and classify exactly like the sequential accepted-by-self replay (above),
  // never the misleading 'expired' fallthrough. Read-only: the loser already wrote nothing (consume/join/emit 0-row).
  if (after && after.accepted_user_id === input.acceptingUserId) {
    const m = await db
      .prepare(`SELECT status, platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?`)
      .bind(after.tenant_id, input.acceptingUserId)
      .first<{ status: string; platform_role: string }>()
    if (!m) return { outcome: 'already_resolved' }                       // offboarded between the win and this re-read
    if (m.status !== 'active') return { outcome: 'membership_not_active' } // suspended -> NOT a silent re-join
    return { outcome: 'replay', tenantId: after.tenant_id, platformRole: m.platform_role }
  }
  return { outcome: 'expired' }   // genuinely never consumed (accepted_user_id null / row gone)
}

// ── revokeInvitation ───────────────────────────────────────────────────────────

export interface RevokeInvitationInput { tenantId: number; invitationId: number; actorUserId: number }

export async function revokeInvitation(db: ChiyigoDb, input: RevokeInvitationInput): Promise<InviteRevokeOutcome> {
  if (!isPositiveInt(input.tenantId) || !isPositiveInt(input.invitationId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const upd = await db
    .prepare(`UPDATE invitations SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND status = 'pending'`)
    .bind(input.invitationId, input.tenantId)
    .run()
  if (upd.meta.changes === 1) return { outcome: 'revoked' }
  // tenant_id in the WHERE is the cross-tenant guard; classify the 0-row by re-reading within the tenant.
  const row = await db
    .prepare(`SELECT status FROM invitations WHERE id = ? AND tenant_id = ?`)
    .bind(input.invitationId, input.tenantId)
    .first<{ status: string }>()
  if (!row) return { outcome: 'not_found' }
  return { outcome: 'not_pending' }
}

// ── listPendingInvitations (DTO; no token_hash) ──────────────────────────────────

export async function listPendingInvitations(db: ChiyigoDb, tenantId: number): Promise<PendingInvitationDto[]> {
  if (!isPositiveInt(tenantId)) return []
  const rows = await db
    .prepare(
      `SELECT id, email, platform_role, expires_at, created_at
         FROM invitations WHERE tenant_id = ? AND status = 'pending' ORDER BY created_at DESC, id DESC`,
    )
    .bind(tenantId)
    .all<PendingInvitationDto>()
  return rows.results ?? []
}
