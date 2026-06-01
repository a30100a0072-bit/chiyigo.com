/**
 * Member lifecycle domain module — PR4 (org create + suspend/reactivate/offboard/role-change).
 *
 * Design: docs/reviews/pr4-invitation-member-lifecycle-plan-2026-06-01.md sections 8 (Gate-1 APPROVED R4).
 *
 * Two Tier-0 correctness properties (both verified by integration tests):
 *  1. createOrgTenant is DURABLY IDEMPOTENT (R2 finding 2): a timeout+retry never creates two org tenants.
 *     The org_create_operations UNIQUE(creator_user_id, idempotency_key) is the concurrency ARBITER; a tenant
 *     is never created without its owner membership (single atomic batch). last_insert_rowid() across batch
 *     statements is verified by the D10 micro-spike (migrations.test.ts) -- S2 captures S1's tenant id.
 *  2. last-owner protection is STATEMENT-LEVEL (R2 finding 1): the "another active owner remains" condition is
 *     a conjunct INSIDE the mutating UPDATE/DELETE WHERE (an EXISTS subquery), so under D1 write serialization
 *     two owners removing each other resolve to exactly-one-applied + one last_owner_protected, with >=1 active
 *     owner guaranteed to remain. NEVER a pre-read COUNT (which has a concurrent-removal race).
 *
 * Errors are NEVER classified by parsing a D1/SQLite message string (version-dependent); on a 0-row CAS we
 * re-read DB state for the precise outcome (same discipline as credit.ts). Personal tenants are out of scope
 * (managed by ensurePersonalTenant) -- member ops on them are rejected. offboard is a row DELETE (no enum change).
 */

import { hashToken } from './crypto'

/** D1 binding type via ambient Env indexed access (same convention as tenant-context.ts / credit.ts). */
type ChiyigoDb = Env['chiyigo_db']

const MAX_NAME_LEN = 200
const MAX_KEY_LEN = 200
const MAX_RETRIES = 4
const PLATFORM_ROLES: ReadonlySet<string> = new Set(['tenant_owner', 'tenant_admin', 'billing_admin', 'member'])

// ── outcomes (endpoint maps to HTTP; never a bare bool -- feedback_updatestatus_structured_outcome) ──

export type OrgCreateOutcome =
  | { outcome: 'created'; tenantId: number }
  | { outcome: 'replay'; tenantId: number }
  | { outcome: 'conflict' }                       // same key, different payload -> 409 IDEMPOTENCY_CONFLICT
  | { outcome: 'invalid'; code: string }          // 400
  | { outcome: 'contention' }                     // 503 (bounded-retry exhausted)

export type MemberOutcome =
  | { outcome: 'applied'; previousRole?: string; platformRole?: string; fromRole?: string; toRole?: string }
  | { outcome: 'not_a_member' }                   // 404
  | { outcome: 'illegal_transition' }             // 409 (wrong current state for this op)
  | { outcome: 'last_owner_protected' }           // 409 (would remove the tenant's only active owner)
  | { outcome: 'personal_tenant_immutable' }      // 422 (member ops are org-only)
  | { outcome: 'cannot_target_self' }             // 409
  | { outcome: 'invalid'; code: string }          // 400

// ── shared helpers ─────────────────────────────────────────────────────────────

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}

/** Stable sorted-key JSON (request_hash; mirror credit.ts canonicalJson). */
function canonicalJson(obj: Record<string, string | number>): string {
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(obj[k])).join(',') + '}'
}

interface TenantRow { type: string; status: string }
async function loadTenant(db: ChiyigoDb, tenantId: number): Promise<TenantRow | null> {
  return db
    .prepare(`SELECT type, status FROM tenants WHERE id = ? AND deleted_at IS NULL`)
    .bind(tenantId)
    .first<TenantRow>()
}

interface MemberRow { status: string; platform_role: string }
async function loadMember(db: ChiyigoDb, tenantId: number, userId: number): Promise<MemberRow | null> {
  return db
    .prepare(`SELECT status, platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?`)
    .bind(tenantId, userId)
    .first<MemberRow>()
}

/**
 * Classify a 0-row CAS for the precise outcome by RE-READING state (never a batch/SQL error string).
 * The last-owner check here is a CLASSIFICATION aid only -- the statement-level WHERE guard is the primary
 * control (this just produces the right error code after the guard already prevented the bad transition).
 */
async function classifyZeroRow(
  db: ChiyigoDb, tenantId: number, targetUserId: number, checkLastOwner: boolean,
): Promise<MemberOutcome> {
  const row = await loadMember(db, tenantId, targetUserId)
  if (!row) return { outcome: 'not_a_member' }
  if (checkLastOwner && row.status === 'active' && row.platform_role === 'tenant_owner') {
    const o = await db
      .prepare(
        `SELECT COUNT(*) AS c FROM organization_members
          WHERE tenant_id = ? AND user_id <> ? AND platform_role = 'tenant_owner' AND status = 'active'`,
      )
      .bind(tenantId, targetUserId)
      .first<{ c: number }>()
    if (Number(o?.c ?? 0) === 0) return { outcome: 'last_owner_protected' }
  }
  return { outcome: 'illegal_transition' }
}

/** Shared org-tenant + non-self + non-personal preflight for the four member transitions. */
async function preflight(
  db: ChiyigoDb, tenantId: number, targetUserId: number, actorUserId: number, guardSelf: boolean,
): Promise<{ ok: true; member: MemberRow } | { ok: false; outcome: MemberOutcome }> {
  if (!isPositiveInt(tenantId) || !isPositiveInt(targetUserId) || !isPositiveInt(actorUserId)) {
    return { ok: false, outcome: { outcome: 'invalid', code: 'ERR_VALIDATION' } }
  }
  const tenant = await loadTenant(db, tenantId)
  if (!tenant) return { ok: false, outcome: { outcome: 'not_a_member' } }
  if (tenant.type === 'personal') return { ok: false, outcome: { outcome: 'personal_tenant_immutable' } }
  if (guardSelf && actorUserId === targetUserId) return { ok: false, outcome: { outcome: 'cannot_target_self' } }
  const member = await loadMember(db, tenantId, targetUserId)
  if (!member) return { ok: false, outcome: { outcome: 'not_a_member' } }
  return { ok: true, member }
}

// ── createOrgTenant (durable idempotency; section 8 / D10) ──────────────────────

export interface CreateOrgTenantInput {
  name: string
  creatorUserId: number
  idempotencyKey: string
}

export async function createOrgTenant(db: ChiyigoDb, input: CreateOrgTenantInput): Promise<OrgCreateOutcome> {
  if (!input || typeof input !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.creatorUserId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.name !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const name = input.name.trim()
  if (name.length === 0 || name.length > MAX_NAME_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.idempotencyKey !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const key = input.idempotencyKey.trim()
  if (key.length === 0 || key.length > MAX_KEY_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }

  const requestHash = await hashToken(canonicalJson({ creator_user_id: input.creatorUserId, name }))

  // idempotency pre-check
  const existing = await db
    .prepare(`SELECT tenant_id, request_hash FROM org_create_operations WHERE creator_user_id = ? AND idempotency_key = ?`)
    .bind(input.creatorUserId, key)
    .first<{ tenant_id: number; request_hash: string }>()
  if (existing) {
    return existing.request_hash === requestHash
      ? { outcome: 'replay', tenantId: existing.tenant_id }
      : { outcome: 'conflict' }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // S1 creates the org tenant. S2 records the op-row capturing the new tenant id via last_insert_rowid()
    // (D10-verified across batch statements) -- its UNIQUE(creator,key) is the concurrency arbiter, so a
    // concurrent same-key insert rolls back the WHOLE batch (incl. S1 -> no orphan tenant). S3 inserts the
    // owner membership reading tenant_id back from the op-row (NOT last_insert_rowid(), which by S3 points at S2).
    const insertTenant = db
      .prepare(`INSERT INTO tenants (type, name, status) VALUES ('organization', ?, 'active')`)
      .bind(name)
    const insertOp = db
      .prepare(
        `INSERT INTO org_create_operations (creator_user_id, idempotency_key, request_hash, tenant_id)
         SELECT ?, ?, ?, last_insert_rowid()`,
      )
      .bind(input.creatorUserId, key, requestHash)
    const insertOwner = db
      .prepare(
        `INSERT INTO organization_members (tenant_id, user_id, platform_role, status)
         SELECT tenant_id, ?, 'tenant_owner', 'active'
           FROM org_create_operations WHERE creator_user_id = ? AND idempotency_key = ?`,
      )
      .bind(input.creatorUserId, input.creatorUserId, key)

    try {
      await db.batch([insertTenant, insertOp, insertOwner])
    } catch {
      // message-independent: a concurrent same-key op won the UNIQUE arbiter -> re-read decides replay/conflict.
      const ex2 = await db
        .prepare(`SELECT tenant_id, request_hash FROM org_create_operations WHERE creator_user_id = ? AND idempotency_key = ?`)
        .bind(input.creatorUserId, key)
        .first<{ tenant_id: number; request_hash: string }>()
      if (ex2) {
        return ex2.request_hash === requestHash
          ? { outcome: 'replay', tenantId: ex2.tenant_id }
          : { outcome: 'conflict' }
      }
      continue // transient -> retry
    }

    const row = await db
      .prepare(`SELECT tenant_id FROM org_create_operations WHERE creator_user_id = ? AND idempotency_key = ?`)
      .bind(input.creatorUserId, key)
      .first<{ tenant_id: number }>()
    return { outcome: 'created', tenantId: row ? row.tenant_id : 0 }
  }
  return { outcome: 'contention' }
}

// ── member transitions (statement-level last-owner guard) ───────────────────────

export interface MemberTargetInput { tenantId: number; targetUserId: number; actorUserId: number }

/** active -> suspended. Suspending an active owner requires another active owner (statement-level). */
export async function suspendMember(db: ChiyigoDb, input: MemberTargetInput): Promise<MemberOutcome> {
  const pre = await preflight(db, input.tenantId, input.targetUserId, input.actorUserId, true)
  if (pre.ok === false) return pre.outcome
  const upd = await db
    .prepare(
      `UPDATE organization_members SET status = 'suspended', updated_at = datetime('now')
        WHERE tenant_id = ? AND user_id = ? AND status = 'active'
          AND ( platform_role <> 'tenant_owner'
             OR EXISTS (SELECT 1 FROM organization_members o2
                         WHERE o2.tenant_id = ? AND o2.user_id <> ?
                           AND o2.platform_role = 'tenant_owner' AND o2.status = 'active') )`,
    )
    .bind(input.tenantId, input.targetUserId, input.tenantId, input.targetUserId)
    .run()
  if (upd.meta.changes === 1) return { outcome: 'applied', previousRole: pre.member.platform_role }
  return classifyZeroRow(db, input.tenantId, input.targetUserId, true)
}

/** suspended -> active. No last-owner guard (reactivating never removes an owner). */
export async function reactivateMember(db: ChiyigoDb, input: MemberTargetInput): Promise<MemberOutcome> {
  const pre = await preflight(db, input.tenantId, input.targetUserId, input.actorUserId, false)
  if (pre.ok === false) return pre.outcome
  const upd = await db
    .prepare(
      `UPDATE organization_members SET status = 'active', updated_at = datetime('now')
        WHERE tenant_id = ? AND user_id = ? AND status = 'suspended'`,
    )
    .bind(input.tenantId, input.targetUserId)
    .run()
  if (upd.meta.changes === 1) return { outcome: 'applied', platformRole: pre.member.platform_role }
  return classifyZeroRow(db, input.tenantId, input.targetUserId, false)
}

/** Row DELETE (from active or suspended). Removing an ACTIVE owner requires another active owner. */
export async function offboardMember(db: ChiyigoDb, input: MemberTargetInput): Promise<MemberOutcome> {
  const pre = await preflight(db, input.tenantId, input.targetUserId, input.actorUserId, true)
  if (pre.ok === false) return pre.outcome
  const del = await db
    .prepare(
      `DELETE FROM organization_members
        WHERE tenant_id = ? AND user_id = ? AND status IN ('active','suspended')
          AND ( NOT (status = 'active' AND platform_role = 'tenant_owner')
             OR EXISTS (SELECT 1 FROM organization_members o2
                         WHERE o2.tenant_id = ? AND o2.user_id <> ?
                           AND o2.platform_role = 'tenant_owner' AND o2.status = 'active') )`,
    )
    .bind(input.tenantId, input.targetUserId, input.tenantId, input.targetUserId)
    .run()
  if (del.meta.changes === 1) return { outcome: 'applied', previousRole: pre.member.platform_role }
  return classifyZeroRow(db, input.tenantId, input.targetUserId, true)
}

export interface ChangeRoleInput extends MemberTargetInput { toRole: string }

/** Change an ACTIVE member's platform_role. Demoting the only active owner is blocked (statement-level). */
export async function changeMemberRole(db: ChiyigoDb, input: ChangeRoleInput): Promise<MemberOutcome> {
  if (typeof input.toRole !== 'string' || !PLATFORM_ROLES.has(input.toRole)) {
    return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  }
  const pre = await preflight(db, input.tenantId, input.targetUserId, input.actorUserId, true)
  if (pre.ok === false) return pre.outcome
  // The last-owner guard fires ONLY when demoting an active owner (current=owner AND toRole<>owner AND no other
  // active owner). Promoting to owner or leaving a non-owner unaffected skips the guard.
  const upd = await db
    .prepare(
      `UPDATE organization_members SET platform_role = ?, updated_at = datetime('now')
        WHERE tenant_id = ? AND user_id = ? AND status = 'active'
          AND ( platform_role <> 'tenant_owner' OR ? = 'tenant_owner'
             OR EXISTS (SELECT 1 FROM organization_members o2
                         WHERE o2.tenant_id = ? AND o2.user_id <> ?
                           AND o2.platform_role = 'tenant_owner' AND o2.status = 'active') )`,
    )
    .bind(input.toRole, input.tenantId, input.targetUserId, input.toRole, input.tenantId, input.targetUserId)
    .run()
  if (upd.meta.changes === 1) return { outcome: 'applied', fromRole: pre.member.platform_role, toRole: input.toRole }
  return classifyZeroRow(db, input.tenantId, input.targetUserId, input.toRole !== 'tenant_owner')
}
