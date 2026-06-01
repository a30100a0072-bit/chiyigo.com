# PR4 -- Invitation + Member Lifecycle + Hard-Revoke Deny-State Event Contract (Implementation Plan)

- **Created**: 2026-06-01
- **Work tier**: L3 (new bounded context: org membership + invitation lifecycle + the platform's first domain-event CONTRACT) + high-risk-domain surcharge (cross-system JSON contract: the revocation/deny-state event schema that ERP / senior-app RPs will consume; also auth/security-boundary code per `feedback_security_boundary_pr_first_do_no_harm`).
- **Status**: DRAFT for Codex Gate 1 (plan review). No code written. Self-reviewed once (Section 16 log).
- **Owner decision baseline**: architecture decisions (1) personal vs organization tenant, (5) many-to-many `organization_members` (no `users.tenant_id`). PR4 builds the org-side member lifecycle on the PR1 foundation.
- **Upstream design**: `docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md` Sections 6 (revocation model) / 8 (employee lifecycle) / 11 (event payload) / 12 (deny-state) / 13 (invite token security) / 20 step 4 (codex r5 approved). This plan realizes "PR4 = Invitation + Member lifecycle (incl hard-revoke deny-state)" and formally designs RP-facing token-contract gap #4 (deny-state / revocation event contract).
- **HEAD baseline**: `origin/main@716f0d4` (PR3 shipped; latest migration `0049`) -> new migration = **`0050`**.
- **Prerequisites (live in prod)**: PR1 Tenant Foundation (`tenants` / `organization_members` with `status IN ('active','invited','suspended')` / `requireRegularAccessToken` / `resolveIssuanceContextForTenant` fail-closed / org-switch); PR2 Billing; PR3 Credit Wallet.

> Encoding note: this document is intentionally pure ASCII (same rule as the PR2 / PR3 plans). Unicode is written `U+XXXX`; real source uses backslash-u escapes or UTF-8 as appropriate.

> NAMING DISCIPLINE (`feedback_state_machine_naming_no_alias`): one concept = one string across DB status vocab, audit `event_type`, and the domain-event `eventType`. This plan resolves the architecture's own `member.suspended` (Section 6) vs `employee.suspended` (Section 11) split: the platform layer emits **`member.*`**; "employee" is an ERP-product-layer concept and never appears in a chiyigo event name. See Section 6.1.

---

## 1. The locked prerequisite decision (event-contract SSOT) -- read first

The architecture defers the event OUTBOX (table + lease/retry/DLQ/cron consumer + replay) to PR5 (Section 20 step 5), but step 4 includes "hard-revoke deny-state", which is event-driven, and the RP deny-state table "must align to chiyigo's final event format -- not be reinvented" (RP-facing gap #4). PR4 must therefore lock the event CONTRACT now so PR5 / the RPs reuse it verbatim.

**LOCKED (the deliverable, non-negotiable): the canonical domain-event contract -- taxonomy + envelope + per-type payload schema + explicit version -- is fully defined and FROZEN in PR4 as the single source of truth (`functions/utils/domain-events.ts`).** PR5's outbox and every RP deny-state implementation reuse this module's types/validators verbatim; they add delivery/consumption only and **must not** reinvent or fork the schema. This is the formal design of RP-facing gap #4. Concrete artifact = Section 6.

**D1 DECIDED by codex Gate-1 = Option B (contract-only in PR4); Option A is rejected and not pursued.** PR4 ships the frozen contract module (`domain-events.ts`) + unit tests that construct/validate every event type, but creates NO `event_outbox`, performs NO durable emission, and builds NO consumer. Membership transitions are plain CAS state changes + audit (DB state is the SoT). **PR5** alone builds the `event_outbox` / `event_dlq` tables, the transactional emission (wired into PR4's mutation points AND the existing `ban` / logout / entitlement paths), the lease/retry/DLQ/replay machinery, and the delivery/consumer. Rationale codex accepted: honors Section 20's ordering literally; keeps a large auth/membership PR focused + first-do-no-harm; defers the genuinely-tricky same-transaction "transition + outbox insert" atomicity (no interactive transaction on D1; `batch()` cannot conditionally roll back on `changes()=0`) to PR5 where it gets its own spike; the contract SSOT is still 100% frozen + tested in PR4.

Consequence (whole document is Option-B-only): there is NO `event_outbox` table in migration 0050, NO atomic-emission seam, and NO "emitted by PR4" event flow. The taxonomy table's right-hand column means "PR4 OWNS the trigger; PR5 wires the emission". The ONLY new operation table PR4 adds is `org_create_operations` (durable idempotency for org creation, Round-2 finding 2, Section 4.3) -- unrelated to the outbox.

The contract module + taxonomy + ORDERING semantics (Section 6) are frozen NOW so PR5 / every RP reuse them verbatim and are never blocked by a v1 schema gap (Round-2 findings 4 + 5).

---

## 2. Scope

**In scope (PR4)**
1. `migrations/0050_member_lifecycle.sql` (+down): `invitations` (Section 4.1) + `org_create_operations` (durable idempotency for org creation, Round-2 finding 2, Section 4.3) = **2 new tables**. NO `event_outbox` (that is PR5, per D1). No change to `organization_members` columns -- PR1 already shipped `status IN ('active','invited','suspended')` + `platform_role`.
2. `functions/utils/domain-events.ts` -- the FROZEN event contract SSOT: envelope type, `eventType` taxonomy, per-type payload validators, `EVENT_SCHEMA_VERSION = 1`, deny-state-semantics doc, a `buildDomainEvent()` builder + `validateDomainEvent()` validator + stable canonical serializer. No I/O. (Section 6.)
3. `functions/utils/invitations.ts` -- invitation domain: `createInvitation` (signed one-time token, hashed at rest, time-boxed, email+role-bound), `acceptInvitation` (atomic one-time consume + membership activation), `revokeInvitation`, `listPendingInvitations`. (Section 7.)
4. `functions/utils/members.ts` -- member lifecycle state machine: `createOrgTenant` (durably idempotent via `org_create_operations`), `suspendMember`, `reactivateMember`, `offboardMember`, `changeMemberRole`, with the invariants in Section 8 (STATEMENT-LEVEL last-owner protection, personal-tenant rejection, self-action guards). Plus `requireActiveTenantRole` authz helper (live DB re-check; the chiyigo-side hard-revoke enforcement, Section 9).
5. Endpoints (Section 10): org create; invite / list / revoke; accept; suspend / reactivate / offboard / role-change.
6. `functions/utils/email.ts` -- `sendInvitationEmail` (mirror `sendVerificationEmail`; AbortSignal timeout; failure does not roll back the durable invitation row).
7. Audit-policy registration (+12 events, `_registrySize` 186 -> 198, Section 12) + per-user rate-limit kinds (`member_invite`, `member_mutate`).
8. Full test suite: migration round-trip; invitation lifecycle incl. negatives (expired / revoked / email-mismatch / cross-tenant / already-used / unauthorized accept); member state machine incl. invariant negatives (last-owner, personal-tenant, self, cross-tenant authz, role-escalation); domain-event contract unit tests (every type builds + validates + serializes stably; unknown/forbidden fields rejected); chiyigo-side hard-revoke enforcement (suspended member's still-valid token is denied by live re-check).

**Out of scope (explicitly deferred)**
- **Event OUTBOX + delivery** -- the `event_outbox` / `event_dlq` tables, durable emission, lease/retry/DLQ/cron consumer, replay -- ALL PR5 (D1 = Option B). The frozen contract (Section 6), incl. its ordering fields, is the interface PR5 consumes; PR5 assigns `streamSeq` and persists/delivers events.
- **Retro-wiring emission into existing endpoints** (`ban` -> `account.disabled`, logout/admin-revoke -> `session.revoked`, a future entitlement-revoke -> `product_access.revoked`). The contract for these is frozen now; emission is deferred to when the consumer exists (PR5+), reusing the frozen schema (decision item D2). PR4 does not touch auth-critical `ban.ts` / logout (first-do-no-harm).
- **RP-side deny-state table + every-request check** -- lives in the ERP / senior-app repos; deferred to cross-repo integration (owner decision 2026-05-28). PR4 defines only the chiyigo-side contract + chiyigo's own live-recheck enforcement.
- **Per-device / member-scoped token revocation primitive** -- suspension does NOT bump `token_version` (that is per-user and would wrongly kill the member's sessions in OTHER tenants -- Section 9). Immediate cross-tenant-safe propagation to RPs is the deny-state event's job (PR5). Existing `per_device_token_version` backlog is unchanged.
- **Email-only invite of a NOT-yet-registered user pre-creating an `organization_members` row** -- impossible (`organization_members.user_id` is NOT NULL FK); pending lives in `invitations`, membership is created at accept (Section 7.1). The `organization_members.status='invited'` value (shipped in 0047) is RESERVED, unused by PR4's flow (decision item D3).
- **SCIM / federation / bulk import / tenant-transfer-of-ownership-as-account-move** -- architecture marks Enterprise / not-now. "Tenant transfer = change role, not move account" is realized by `changeMemberRole` (Section 8).

---

## 3. Current-state grounding (verified against HEAD `716f0d4`)

- **`organization_members` (migration 0047)**: `id` / `tenant_id` FK / `user_id` FK / `platform_role IN ('tenant_owner','tenant_admin','billing_admin','member')` / `status IN ('active','invited','suspended')` / `joined_at` / `updated_at`; `UNIQUE(tenant_id,user_id)`; indexes `(user_id)`, `(tenant_id, platform_role)`. PR4 mutates `status` + `platform_role` and INSERTs rows at accept. No migration change to this table. NOTE: `status` has no `'offboarded'` value -- Section 4.2 decides offboard representation.
- **`tenants` (0047)**: `type IN ('personal','organization')`; `status IN ('active','suspended','closed')`; `personal_owner_user_id` (personal only, CHECK-enforced); a CHECK forces personal tenants to be always `status='active' AND deleted_at IS NULL`. Member endpoints must REJECT `type='personal'` (Section 8).
- **No invitation system exists** (greenfield): no `invitations` table, no invite token/endpoint anywhere in `migrations/` `functions/` `src/` (Explore sweep confirmed). No member-mutation endpoint exists; `organization_members.status` is only ever read (`tenant-context.ts`, `tenants/index.ts`) -- never mutated.
- **No domain events / outbox exist** (greenfield): no `event_outbox`, no event schema, no emitter. PR4 introduces the FIRST domain-event contract. (`safeUserAudit` -> `audit_log` is forensic hash-chain, NOT a delivery queue; the two are distinct, Section 12.)
- **Revocation primitives reused (do NOT reinvent)**:
  - `requireRegularAccessToken(request, env)` (`functions/utils/auth.ts`) -> validated positive-int `userId`; rejects pre_auth / temp_bind / elevated tokens. Member endpoints use this for the actor.
  - `resolveIssuanceContextForTenant(db, userId, tenantId)` (`functions/utils/tenant-context.ts`) -> `{ok:true, platform_role}` only if tenant active + membership active + personal-owner-guard, else `{ok:false, code}`. This is the LIVE membership re-check; `requireActiveTenantRole` (Section 9) builds on it. PR4's authz never trusts the token's `platform_role` claim for sensitive ops.
  - `bumpTokenVersion(db, userId)` (`auth.ts`): per-USER (`users.token_version += 1` + revoke all `refresh_tokens`). Correct for `account.disabled` (whole-account ban, already used by `ban.ts`); WRONG for per-tenant member suspend (Section 9). PR4 does NOT call it for member lifecycle.
  - `consumeJtiOnce` / atomic INSERT-OR-IGNORE + `changes()===1` (`revocation.ts`, `feedback_stepup_atomic_consume`): the one-time-claim template `acceptInvitation` mirrors.
  - `hashToken(token)` = SHA-256 hex; `generateSecureToken()` = 32-byte hex (`functions/utils/crypto.ts`): invitation token mint + hash-at-rest.
- **Admin double-gate template**: `functions/api/admin/billing/grant.ts` (step-up + fine scope + server actor from `users` row + strict body allowlist + per-user rate limit + audit-on-every-disposition). PR4's endpoints mirror the strict-body / rate-limit / audit / server-actor parts, but authorize by **live tenant role**, not platform admin scope (Section 9) -- member management is a tenant-owner self-service action, not a platform-staff action.
- **Atomic / idempotency discipline**: `functions/utils/credit.ts` (single `D1.batch()`, message-independent re-read on throw, `request_hash` replay-vs-conflict, append-only). `acceptInvitation` reuses the message-independent-catch + post-batch re-read discipline (Section 7.2).
- **Audit**: `functions/utils/audit-policy.ts` warn-on-missing registry; `_registrySize` currently **186**; `tests/audit-policy.test.ts:225` asserts `toBe(186)` + per-category `it.each` (must add the 12 new events to BOTH the registry arrays AND the explicit `it.each`, per `feedback_audit_classification` and the PR1 red-CI lesson).
- **Test scaffold**: `tests/integration/_helpers.ts` has `seedUser/seedTenant/seedMembership/seedProduct/...`; `_setup.sql` (CREATE IF NOT EXISTS); `resetDb` DELETE list; `migrations.test.ts` has `ALL_UPS` + `EXPECTED_TABLES` (currently **45**, becomes **47**: +`invitations` +`org_create_operations`) + `EXPECTED_COLUMNS`.
- **Email**: `functions/utils/email.ts` Resend adapter; `sendVerificationEmail(apiKey, to, token, env, signal?)` is the template (note the `signal?` AbortSignal -- satisfies the external-call timeout rule).
- **TS pitfall (recurs)**: Pages `env` untyped -> use `Env['chiyigo_db']` indexed type for db params; `String(row?.x ?? '')` narrowing at the assignment site (functions tsconfig `strict:false`). (`feedback_ts_no_jsdoc_in_ts_mode`.)

---

## 4. Data model -- `migrations/0050_member_lifecycle.sql` (expand-only, idempotent)

### 4.1 `invitations` (pending-invite state holder; one-time signed token)
```sql
CREATE TABLE IF NOT EXISTS invitations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  email           TEXT    NOT NULL,                  -- invitee email (lowercased at write); bound at accept
  platform_role   TEXT    NOT NULL DEFAULT 'member'
                          CHECK(platform_role IN ('tenant_admin','billing_admin','member')),  -- NOT tenant_owner (Section 8)
  token_hash      TEXT    NOT NULL UNIQUE,           -- SHA-256(raw token); raw token only ever in the email link
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK(status IN ('pending','accepted','revoked','expired')),
  expires_at      TEXT    NOT NULL,                  -- set via datetime('now','+? seconds') + compared via datetime('now') (SQLite format, ORDERING-safe; feedback_sqlite_iso_datetime_compare)
  invited_by      INTEGER NOT NULL REFERENCES users(id),  -- actor snapshot (owner/admin who invited)
  accepted_user_id INTEGER REFERENCES users(id),     -- set atomically at accept (one-time consume marker)
  accepted_at     TEXT,                              -- set atomically at accept = this request's unique occurredAt; the freshness marker (matched by EXACT equality, so format is irrelevant; never ordering-compared)
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- accepted rows must carry both consume fields; non-accepted must carry neither (no half-consumed row).
  CONSTRAINT ck_inv_accept_fields CHECK(
        (status =  'accepted' AND accepted_user_id IS NOT NULL AND accepted_at IS NOT NULL)
     OR (status <> 'accepted' AND accepted_user_id IS NULL     AND accepted_at IS NULL) )
);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);
-- At most ONE live (pending) invite per (tenant, email): re-inviting supersedes (Section 7.1).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending
  ON invitations(tenant_id, email) WHERE status = 'pending';
```
- `token_hash` UNIQUE: hash-at-rest (never store the raw token; `feedback_security` / architecture Section 13). The raw 32-byte hex token travels only in the email link and the accept request body.
- `platform_role` CHECK EXCLUDES `tenant_owner`: you cannot invite someone straight to owner (ownership transfer is a deliberate `changeMemberRole` by an existing owner, Section 8; prevents an owner minting a second owner via an email link). Owner is also excluded from `tenant_owner` invitations because a personal tenant can't be invited into at all (Section 8 rejects `type='personal'`).
- Partial unique `uq_invitations_pending`: one outstanding invite per (tenant,email). Re-invite = revoke-or-supersede the old pending row then insert (Section 7.1) -- the unique index makes a double-pending impossible at the DB layer.
- The `(tenant_id, email)` pending invite plus the `accepted_user_id`/`accepted_at` consume markers make accept exactly-once (Section 7.2).
- NO FK CASCADE games: `tenant_id`/`invited_by`/`accepted_user_id` keep plain FKs for integrity; invitations are not financial-immutable, so a future cleanup job MAY prune expired/accepted rows (unlike ledgers).

### 4.2 `organization_members` -- offboard representation (decision, no migration change)
PR1's `status` enum is `('active','invited','suspended')` -- there is no `'offboarded'`. Two coherent options (decision item D4):
- **(RECOMMENDED) Offboard = row DELETE.** Offboarding removes the membership row entirely (the user keeps their account + personal tenant + other-tenant memberships -- "do not delete user", architecture Section 8). The forensic trail is the `member.offboarded` audit event (IMMUTABLE, permanent). Re-onboarding = a fresh invitation. This needs NO migration (the enum stays 3-valued) and matches `UNIQUE(tenant_id,user_id)` cleanly (re-invite later just inserts a new row).
- (Alternative) Offboard = `status='offboarded'` (requires adding the enum value, i.e. a CHECK rebuild -- SQLite cannot ALTER a CHECK, so it would mean a table rebuild of a PR1-shipped table; heavier, and a soft-removed row competes with the `UNIQUE(tenant,user)` on re-invite). Not recommended.

This plan uses DELETE for offboard. Suspend/reactivate stay as `status` flips (`active <-> suspended`); only offboard removes the row. (A suspended member is still a member, just blocked; an offboarded member is no longer a member.)

### 4.3 `org_create_operations` (durable idempotency for `POST /api/tenants`; Round-2 finding 2)
`POST /api/tenants` is an externally-retryable write: a network timeout + client retry must NOT create two organization tenants. A durable operation table keyed on `(creator_user_id, idempotency_key)` makes org creation replay-safe (same discipline as PR2 `grant_plan_operations` / PR3 `credit_ledger` idempotency, but the smallest shape that covers org creation).
```sql
CREATE TABLE IF NOT EXISTS org_create_operations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_user_id  INTEGER NOT NULL REFERENCES users(id),
  idempotency_key  TEXT    NOT NULL,                  -- caller-supplied; bounded
  request_hash     TEXT    NOT NULL,                  -- sha256(canonical {creator_user_id, name}); replay-vs-conflict
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),  -- the org tenant this op created (the replay result)
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(creator_user_id, idempotency_key)            -- the concurrency arbiter + pre-check covering index
);
CREATE INDEX IF NOT EXISTS idx_org_create_ops_tenant ON org_create_operations(tenant_id);
-- APPEND-ONLY at the app layer (createOrgTenant only INSERTs here); no DB trigger (repo house style).
-- This is NOT the event outbox (that is PR5, per D1). It is a per-op idempotency ledger for org creation only.
```

### 4.4 down migration (`migrations/down/0050_member_lifecycle.down.sql`)
```sql
-- Safe ONLY before any real invitation / org-create-op row exists (no data loss). Once real rows exist, rollback = forward-fix.
-- org_create_operations references tenants; invitations references tenants/users. Drop the children first.
DROP TABLE IF EXISTS org_create_operations;
DROP TABLE IF EXISTS invitations;
```

### 4.5 No seeds. Invitations + org-create-ops are tenant data (created by the domain). `resetDb` gains BOTH `invitations` and `org_create_operations` to its DELETE list, BEFORE `tenants`/`users` are wiped (FK order).

---

## 5. State machines

### 5.1 Invitation status
```
        createInvitation                      acceptInvitation (atomic, one-time)
  (none) ---------------> pending --------------------------------------> accepted   [terminal]
                            |  \
              revokeInvitation \ \-- expires_at passed (lazy: treated as expired on read;
                            |   \      a sweep MAY set status='expired', not required for correctness)
                            v    \
                         revoked   \--> expired   [both terminal]
```
- Transitions are monotonic; only `pending` is actionable. accept/revoke from a non-pending state -> structured deny (Section 7).
- Expiry is enforced at accept time (`expires_at > now`); a background sweep flipping `pending -> expired` is optional housekeeping (not a correctness dependency) and is deferred.

### 5.2 Membership status (organization tenant only; personal tenants are out of scope per Section 8)
```
  invite accepted ---> active <-----reactivate----- suspended
                         |  \                            ^
                  changeMemberRole (active only)         |
                         |   \---------- suspend --------/
                         |
                      offboard (DELETE row; from active OR suspended)
```
- `suspend`: `active -> suspended` (CAS `WHERE status='active'`).
- `reactivate`: `suspended -> active` (CAS `WHERE status='suspended'`).
- `offboard`: row DELETE (from `active` or `suspended`); guarded `WHERE` + invariants (Section 8).
- `changeMemberRole`: only on an `active` member; the role value transitions, not `status`.
- All four are gated by the last-owner / personal-tenant / self-action invariants (Section 8) and authorized by live tenant role (Section 9).

---

## 6. Domain-event contract -- `functions/utils/domain-events.ts` (FROZEN SSOT; the PR4 deliverable)

This module is the SSOT locked in Section 1. It is pure (no I/O): types, a frozen taxonomy, per-type payload validators, a builder, a stable canonical serializer, and the deny-state-semantics documentation. PR5's outbox and every RP reuse it; they never redefine an event shape.

### 6.1 `eventType` taxonomy (v1) -- resolves the Section 6 vs Section 11 naming split
Platform layer emits `member.*` (NOT `employee.*` -- that is an ERP-internal concept). The audit `event_type` strings (Section 12) deliberately MATCH these where they overlap (one concept, one string).

PR4 emits NOTHING (D1 = Option B); the "PR4 owns trigger?" column records which chiyigo transition WILL produce each event when PR5 wires emission. Payloads below show REQUIRED keys; OPTIONAL forward-compat keys (e.g. `reason`) are noted in the ERP-alignment review (6.5) and tolerated by the expand rule (6.3).

| eventType | tenantId | streamKey (ordering domain, 6.4) | data (required) | RP deny-state effect | PR4 owns trigger? |
|---|---|---|---|---|---|
| `member.invited` | tenant | `tenant:<tid>:member:<sub-or-email>` | `{ invitationId, email, platformRole }` | none (not yet a member) | createInvitation |
| `member.joined` | tenant | `tenant:<tid>:member:<sub>` | `{ sub, platformRole }` | UN-DENY (tenant,sub) | acceptInvitation |
| `member.suspended` | tenant | `tenant:<tid>:member:<sub>` | `{ sub, previousRole, reason? }` | **DENY** (tenant,sub) | suspendMember |
| `member.reactivated` | tenant | `tenant:<tid>:member:<sub>` | `{ sub, platformRole }` | UN-DENY (tenant,sub) | reactivateMember |
| `member.offboarded` | tenant | `tenant:<tid>:member:<sub>` | `{ sub, reason? }` | **DENY** (tenant,sub) | offboardMember |
| `member.role_changed` | tenant | `tenant:<tid>:member:<sub>` | `{ sub, fromRole, toRole }` | SOFT (role change; <=15min stale OK per arch Section 6) | changeMemberRole |
| `account.disabled` | null | `account:<sub>` | `{ sub, reason? }` | **DENY** (sub, all tenants) | trigger = `ban.ts` (emission PR5, D2) |
| `account.reenabled` | null | `account:<sub>` | `{ sub }` | UN-DENY (sub) | trigger = unban (emission PR5, D2) |
| `product_access.revoked` | tenant | `tenant:<tid>:product:<productId>` | `{ productId, reason? }` | **DENY** (tenant,product) | no trigger yet; PR2 grant-only (6.5) |
| `product_access.restored` | tenant | `tenant:<tid>:product:<productId>` | `{ productId, reason? }` | UN-DENY (tenant,product) | no trigger yet; pairs with revoked (6.5; Round-3 finding 2) |
| `session.revoked` | null | `session:<sub>:<scope>:<ref>` (per bounded session subject, 6.4) | `{ sub, scope:'device'|'jti', ref }` | **DENY** (one device-session / one jti) | device/jti revoke triggers exist (emission PR5, D2); whole-user logout-all = PR5 epoch, NOT this (R4 / D14) |

**deny-state semantics + ordering (frozen contract; RP impl is cross-repo/deferred):** an RP keeps a local deny-state and, on EVERY request (arch Section 6/12, not only sensitive endpoints), blocks when the token's `(tenant_id, sub)` is member-denied, OR `sub` is account-disabled, OR `(tenant_id, product)` is access-revoked, OR the session/jti is revoked. DENY events add to deny-state; UN-DENY events remove; SOFT (`member.role_changed`) is NOT a deny (rides the <=15min token TTL). **Every DENY has a paired UN-DENY** (Round-3 finding 2 -- no half-set contract): member suspend<->reactivate, account disable<->reenable, **product_access revoke<->restore**; `member.offboarded` is a one-way DENY (re-onboarding is a fresh `member.joined` UN-DENY); `session.revoked` is a one-way DENY per BOUNDED session subject -- one device-session or one jti only (a revoked jti/device-session is never un-revoked, and a later re-login is a NEW subject so the user is never permanently locked out). **`session.revoked` is NOT a whole-account or whole-user mechanism** (R4): a banned account is `account.disabled` (DENY whole `sub` until `account.reenabled`); a "logout everywhere / revoke-before" is a PR5 token-epoch cutoff (D14), NOT a deny-list subject. **Ordering is by `(streamKey, streamSeq)` -- NOT by `occurredAt`** (clock skew / equal-second collisions make a timestamp unsafe; Round-2 finding 4); the streamKey is the EXACT deny subject so independent subjects never share a sequence and cannot overwrite each other under out-of-order delivery (Round-3 finding 1 -- e.g. two jti revokes are two streams). See 6.4. The full contract (all 11 types) is frozen now -- envelope, payloads, per-subject streamKey scheme, streamSeq ordering, AND the expand rule (6.3) -- so PR5 and every RP reuse it verbatim and are never blocked by a v1 gap. The "PR4 owns trigger?" column names the chiyigo transition; under D1=Option B PR4 EMITS NOTHING -- PR5 wires all emission (assigning `streamSeq`) for both the `member.*` triggers and the existing-endpoint events; the non-`member.*` types are frozen-but-deferred (Section 2 / D2).

### 6.2 Envelope (frozen v:1) -- matches architecture Section 11
```ts
export const EVENT_SCHEMA_VERSION = 1
export interface DomainEvent {
  v: 1                     // === EVENT_SCHEMA_VERSION; explicit, never inferred
  eventId: string          // crypto.randomUUID(); unique; the DELIVERY-layer dedup key (at-least-once)
  eventType: DomainEventType
  streamKey: string        // stable deny-state subject + ORDERING domain (6.4 scheme); e.g. 'tenant:7:member:99'
  streamSeq: number        // positive int; STRICTLY MONOTONIC per streamKey; emitter(PR5)-assigned; the ORDERING authority
  occurredAt: string       // ISO-8601 UTC; human/audit + tie-break ONLY -- never the ordering authority
  tenantId: number | null  // null ONLY for account-/session-scoped events
  actorSub: string | null  // who performed the action (admin/owner sub); null if system-driven
  data: Record<string, ...> // per-eventType; required keys closed-validated; forward-compat optional keys tolerated (6.3)
}
```
- **Ordering authority = `(streamKey, streamSeq)`**, NOT `occurredAt` (Round-2 finding 4). `eventId` = delivery dedup (at-least-once); `(streamKey, streamSeq)` = STATE ordering. PR4 freezes both fields in v1 so PR5 is not blocked; PR5 assigns `streamSeq` (the contract requires only "strictly monotonic per streamKey", leaving the generation mechanism -- per-key counter, outbox autoincrement projection, etc. -- to PR5, so v1 does not over-constrain it).
- `actorSub` (envelope, the ACTOR) is distinct from `data.sub` (the SUBJECT). e.g. owner `actorSub=42` suspends member `data.sub='99'`. This is why arch Section 11 separates `actorSub` from `data`.
- Closed CORE: the 8 SCALAR envelope fields (`v`/`eventId`/`eventType`/`streamKey`/`streamSeq`/`occurredAt`/`tenantId`/`actorSub`) are strictly validated (present + typed; unknown top-level keys rejected). Payload `data` is validated per 6.3: each `eventType`'s REQUIRED keys closed-validated; forward-compat OPTIONAL keys tolerated. No `z.record(z.any())` for the required set (arch security rule).

### 6.3 Builder / validator / serializer + EXPAND rule
- `buildDomainEvent(type, { tenantId, actorSub, streamKey, streamSeq, data }, occurredAt, eventId)` -> validated `DomainEvent` (throws on bad shape; streamSeq/eventId/occurredAt injected by the caller -- in Functions runtime `crypto.randomUUID()` / `new Date().toISOString()` are fine and live at the call site; PR4 exercises the builder only in unit tests, since PR4 emits nothing).
- `validateDomainEvent(obj)` -> typed result; used by PR5's consumer + RPs on the wire (untrusted-input boundary, arch security rule). Validates: the 8 scalar envelope fields strictly (+ reject unknown top-level keys); `streamSeq` positive int; `streamKey` matches the eventType's scheme (6.4) AND is consistent with the payload subject -- e.g. `session.revoked` must have `scope IN ('device','jti')` (NOT `'user'` -- removed in R4, see 6.5), a REQUIRED `ref`, and `streamKey === 'session:'+sub+':'+scope+':'+ref` (a `scope='user'` event, a missing `ref`, or a mismatched streamKey is REJECTED at the schema boundary); each eventType's REQUIRED data keys present + typed (unknown data keys tolerated per the expand rule).
- `canonicalEventJson(event)` -> stable sorted-key JSON (same discipline as `credit.ts` `canonicalJson`) for the PR5 outbox `payload` + `payload_hash`.
- **EXPAND rule (frozen, Round-2 findings 4+5 -- so PR5/PR6 are never blocked by v1):**
  - Adding a NEW `eventType` (e.g. `tenant.suspended`, 6.5) = EXPAND, NO version bump, PROVIDED it reuses the envelope + a streamKey scheme (6.4). RPs MUST IGNORE unknown `eventType`s (forward-compat), so a new event never breaks an old RP.
  - Adding a NEW OPTIONAL `data` key to an existing eventType = EXPAND, no bump. `validateDomainEvent` therefore TOLERATES unknown `data` keys (does not reject) -- deliberate cross-system forward-compat: the chiyigo emitter is trusted and an unknown optional key never affects deny correctness (deny reads only `streamKey` + required keys). The REQUIRED-key set stays closed/strict; only the optional surface is open.
  - BREAKING (MUST bump `v` + keep v1 >= 1 release cycle, arch Section 17): removing/renaming a required key, changing a key's meaning/type, renaming an `eventType`, or changing an existing enum value. (Adding a NEW enum value is breaking for consumers that switch exhaustively -> treat as a bump-or-additive-with-default decision, documented per change.)
- Implementation: hand-rolled strict validators (no new dep), consistent with PR2/PR3 (decision item D5; lean confirmed: hand-rolled).

### 6.4 Ordering / convergence rule (frozen; Round-2 finding 4)
- **streamKey** = the EXACT deny-state subject's stable key + the ordering domain (a streamKey MUST be as fine as the smallest independently-revocable subject, Round-3 finding 1 -- otherwise two independent revokes share a sequence and out-of-order delivery drops one). Scheme (frozen):
  - member events -> `tenant:<tenantId>:member:<sub>` (`member.invited` may key on email pre-account, then re-key on `sub` at `member.joined` -- documented edge).
  - account events -> `account:<sub>`.
  - product access (revoke AND restore -- the DENY/UN-DENY pair share ONE key so a revoke->restore on the same product is totally ordered) -> `tenant:<tenantId>:product:<productId>`.
  - **session events -> per BOUNDED session subject ONLY (R4 finding -- `scope='user'` REMOVED from v1):** `session:<sub>:device:<ref>` (one device-session) or `session:<sub>:jti:<ref>` (one access-token jti). `ref` is a SESSION-SCOPED identifier (the device's CURRENT session id, or the jti), NOT a reusable principal -- so a later re-login produces a NEW jti / NEW device-session id = a NEW streamKey that is NOT in any prior deny, and the user is never permanently locked out. Revoking jti A and jti B are TWO independent streams (out-of-order safe). **There is deliberately NO `scope='user'`:** a whole-user "logout-all / revoke-before" is UNBOUNDED + time-based and CANNOT be expressed as a deny-list subject (it would permanently block the user's future logins); it is deferred to PR5 as a token EPOCH / `tokenVersion` / `revokedBefore` cutoff the RP compares against `token.iat`/version (D14). Whole-ACCOUNT deny (banned until reenable) is `account.disabled`, NOT `session.revoked` (6.5).
  - future tenant lifecycle (6.5) -> `tenant:<tenantId>`.
- **streamSeq** = strictly monotonic positive int PER streamKey, assigned by the emitter (PR5). Two events on the SAME streamKey are totally ordered by streamSeq; events on different streamKeys are independent.
- **RP convergence (idempotent, duplicate/out-of-order/replay safe):** per `streamKey` the RP stores `lastAppliedSeq`. On receive: if `streamSeq <= lastAppliedSeq` -> STALE/DUPLICATE -> no-op (covers at-least-once redelivery + DLQ replay + reordered late arrivals); if `>` -> apply the event's resulting deny/un-deny STATE and set `lastAppliedSeq`. Because deny-state is a SET/CLEAR terminal state (not a toggle), the highest-seq event per streamKey determines the current state -> converges regardless of arrival order. `eventId` separately dedups at the delivery layer.
- PR4 freezes these fields + this rule in the v1 contract/validator but emits nothing; PR5 supplies `streamSeq` and the delivery that makes the rule operational.

### 6.5 ERP / RP-facing alignment review (Gate-1, NOT PR4 implementation scope; Round-2 finding 5)
Because Section 6 becomes the SSOT every RP consumes, the payloads are reviewed for sufficiency NOW (conservative: prefer freezing a forward-compat optional field over forcing a later breaking add). This does NOT expand PR4 code scope or start ERP integration.
- **B3a `product_access` revoke/restore PAIR (Round-3 finding 2 -- Option A chosen).** v1 freezes BOTH `product_access.revoked` (DENY) and `product_access.restored` (UN-DENY), so the contract is not a half-set: access can come back (payment recovers / manual restore / plan fix) and the RP must be able to CLEAR the deny. Both share payload `{ productId }` REQUIRED + `reason?` OPTIONAL (revoke reasons: `manual_revoke` / `expired` / `payment_failed` / `plan_changed`; restore reasons: `payment_restored` / `manual_restore` / `plan_changed`) and the SAME streamKey `tenant:<tid>:product:<productId>` (so a revoke->restore on one product is totally ordered, last-seq wins). **Why Option A (not B = defer all product_access.* to PR5):** ERP triage already made `product_access.revoked` a PR4 must-consider hard-revoke type; deferring it would leave the ONLY hard-revoke family unfrozen while member/account/session are frozen -- inconsistent and exactly the half-set codex flagged. Naming `restored` (not `granted`) mirrors the `reactivated`/`reenabled` "clears a prior block" semantics; first-grant access still flows via the token `product_access` summary (arch Section 6), not via a deny-state event. **Deliberately NOT included:** `planId` / `grantId` / `entitlementId` (PR2's `tenant_product_access` is one effective row per `(tenant, product)` with no RP-facing grant/entitlement id; access is a per-product boolean for the RP -> exposing those leaks chiyigo's internal entitlement structure and over-constrains v1) and `effectiveAt` (use `occurredAt`). `source` is folded into `reason`. Neither event has a PR4 trigger (PR2 is grant-only, no revoke endpoint) -- contract-only, emission PR5+.
- **B4a hard-revoke payloads sufficiency.** `member.suspended {sub, previousRole, reason?}` -- `sub`+envelope `tenantId` suffice to deny; `previousRole` + `reason?` for RP audit. `member.offboarded {sub, reason?}` -- sufficient. `account.disabled {sub, reason?}` -- sufficient (sub denies all tenants). `session.revoked {sub, scope:'device'|'jti', ref}` -- `ref` is REQUIRED and is a SESSION-SCOPED id (device-session id or jti); the per-subject streamKey `session:<sub>:<scope>:<ref>` keeps each jti/device-session an independent, BOUNDED ordering stream (R3 finding 1). **`scope='user'` is REMOVED from v1 (R4 blocker):** a whole-user revoke is unbounded/time-based and a deny-list `session:<sub>` would permanently block the user's FUTURE logins -- which is `account.disabled` semantics, not session-revoke. So v1 splits cleanly: per-session kill = `session.revoked` (device/jti); whole-account ban = `account.disabled` (until `account.reenabled`); "logout everywhere / revoke-before" = PR5 token EPOCH / `tokenVersion` / `revokedBefore` cutoff compared against `token.iat`/version (deferred, D14 -- needs an RP-visible epoch that PR4 has no source for). `product_access.revoked`/`.restored` -- per B3a (paired). All hard-revoke types carry an OPTIONAL `reason` (forward-compat, RP triage) without it being required.
- **Tenant lifecycle events (`tenant.suspended` / `tenant.closed`) -- DEFERRED, NOT in v1 taxonomy.** PR4 has no tenant-suspend/close trigger (no endpoint mutates `tenants.status` yet). Adding them later is EXPAND (6.3): new eventType + envelope + streamKey `tenant:<tenantId>` (RP denies the whole tenant); RPs ignore unknown eventTypes, so no v1 ambiguity. Explicitly reserved so PR5/PR6 add them without reinventing the envelope.
- **Naming discipline:** the platform emits `member.*`; `employee.*` is an ERP-internal mapping concept and MUST NOT appear as a chiyigo eventType alias (`feedback_state_machine_naming_no_alias`).
- **NOT folded into PR4 (recorded as PR5/PR6 inputs/blockers only):** the other ERP-triage items B1 / B2 / B3b / B4b / B5 are RP token/API/product-integration contracts (correspond to architecture RP-facing token-contract gaps #1 RP token+tenant claim / #2 `sub` mapping (public_sub) / #3 tenant_id value space (public tenant id), plus product-catalog + RP-API alignment). PR4 neither implements nor finalizes them; they are logged as PR5/PR6 prerequisites in `project_rp_integration_chiyigo_backlog` and the architecture RP-facing-gap section. Only the deny-state event contract (gap #4) is designed here.

---

## 7. Invitation domain (`functions/utils/invitations.ts`)

### 7.1 `createInvitation(db, { tenantId, email, platformRole, invitedByUserId, ttlSeconds })`
1. Validate: tenant is `type='organization'` + `status='active'` (reject personal / suspended / closed); email well-formed + lowercased; `platformRole IN ('tenant_admin','billing_admin','member')` (NOT owner); ttl bounded.
2. **Reject inviting an existing member** (`already_member`): if `email` maps (via `users.email`, active account) to an `organization_members` row for this tenant with `status IN ('active','suspended')`. You do not "invite" an existing member; un-suspend via `reactivateMember`. This closes a bypass where re-inviting a SUSPENDED member could otherwise reactivate them at accept (also enforced fail-closed at accept, Section 7.2 step 2 + the plain-INSERT in step 3).
3. Supersede any existing `pending` invite for `(tenant,email)`: `UPDATE invitations SET status='revoked', updated_at=now WHERE tenant_id=? AND email=? AND status='pending'` (the partial unique then permits the new insert; the latest link supersedes older ones).
4. Mint raw token = `generateSecureToken()`; `token_hash = hashToken(raw)`.
5. INSERT invitation (`status='pending'`, `expires_at` via `datetime('now','+? seconds')` -- SQLite format for safe ordering compares, Section 4.1; `invited_by`). Idempotency: the partial unique guarantees one live invite; a concurrent double-create -> one wins, loser re-reads (re-issue is benign, returns the live invite).
6. AFTER the row is durable, `sendInvitationEmail(... raw token ...)` with an AbortSignal timeout. Email failure does NOT roll back the invite (owner can resend); a denial/telemetry audit records send failure. Raw token is returned to the caller ONLY for the email; never logged, never stored.

### 7.2 `acceptInvitation(db, { rawToken, acceptingUserId })` -- atomic one-time consume + join
The accepting user is already authenticated (regular access token). The matched email + verification status are read from the `users` row by `acceptingUserId` (authoritative; NOT trusted from the token/body -- a token `email` claim can be stale). Steps:
1. `token_hash = hashToken(rawToken)`; load invite by `token_hash`; load the accepting user's `email` + `email_verified` from `users` by `acceptingUserId`.
2. Deterministic pre-checks -> structured deny (no write): not found -> `not_found`; `expires_at <= datetime('now')` (still pending) -> `expired`; invitee `email` != the accepting user's DB email, OR that email is not `email_verified` -> `email_mismatch` (a leaked link cannot be redeemed by a different / unverified account, arch Section 13); tenant no longer active -> `tenant_ineligible`; the accepting user is ALREADY an active/suspended member of this tenant -> `already_member` (do not reactivate via accept).
2a. **Accepted-link replay MUST be gated on LIVE membership (Round-2 finding 3 -- a bare "accepted by me -> 200 replay" collides with hard-revoke).** If invite `status='accepted'`:
    - `accepted_user_id != acceptingUserId` -> `already_resolved` (someone else consumed it).
    - `accepted_user_id == acceptingUserId`: re-read THIS user's live `organization_members` row for the tenant -- `status='active'` -> **`replay` (200)** (idempotent re-click); `status='suspended'` -> **`MEMBERSHIP_NOT_ACTIVE` (403)** (a suspended member re-clicking the old link must NOT get `ok:true` and must NOT be reactivated); row ABSENT (offboarded, row DELETEd) -> **`already_resolved` (409)** -- the old accepted link cannot re-add an offboarded member; a FRESH invitation is required.
    - other terminal `status` (`revoked` / `expired`) -> `already_resolved` / `expired`.
    Replay/deny here NEVER touches `organization_members` (no INSERT/UPDATE) -- it only reads membership to choose a stable outcome, preserving the no-silent-reactivation rule.
3. Atomic consume + join in ONE `db.batch([S1, S2])`, with this request's unique `occurredAt` as the freshness marker:
   - S1 (CAS consume): `UPDATE invitations SET status='accepted', accepted_user_id=?u, accepted_at=?occurredAt, updated_at=?occurredAt WHERE token_hash=? AND status='pending' AND expires_at > datetime('now')`
   - S2 (conditional join, gated on S1 having applied THIS request -- PLAIN INSERT, no ON CONFLICT): `INSERT INTO organization_members (tenant_id, user_id, platform_role, status) SELECT tenant_id, ?u, platform_role, 'active' FROM invitations WHERE token_hash=? AND accepted_user_id=?u AND accepted_at=?occurredAt`
   - S2's SELECT yields a row ONLY when S1's CAS set `accepted_at=occurredAt` for THIS request, so a lost CAS (concurrent double-accept / already-resolved) -> 0-row INSERT (no membership) and the winner alone joins. Offboard DELETEs the row (Section 4.2), so re-onboarding is a clean fresh INSERT. If a membership UNEXPECTEDLY already exists (race vs step-2 `already_member`), the plain INSERT hits `UNIQUE(tenant_id,user_id)` -> whole-batch rollback (S1 consume also rolls back) -> re-read -> `already_member` deny. Deliberately NO `ON CONFLICT DO UPDATE`: accept must never silently flip a suspended member back to active. Exactly-once, atomic, fail-closed.
4. Post-batch re-read the invite: `accepted_user_id=u AND accepted_at=occurredAt` -> `joined` (success); else -> re-derive the structured deny from step 2 (covers the concurrent loser + the unique-violation rollback). Message-independent (never parse the batch error), mirroring `credit.ts`.
5. Caller (endpoint) on `joined` emits audit `member.joined`. (PR4 emits NO domain event -- D1=Option B; PR5 wires the `member.joined` domain event here.)

### 7.3 `revokeInvitation(db, { tenantId, invitationId, actorUserId })`
CAS `UPDATE invitations SET status='revoked', updated_at=now WHERE id=? AND tenant_id=? AND status='pending'`; `changes()===1` -> revoked; else -> `not_pending`/`not_found`. (tenant_id in the WHERE = cross-tenant guard.)

### 7.4 `listPendingInvitations(db, tenantId)` -- for the member-list endpoint (pending alongside active members). DTO only (no `token_hash`).

---

## 8. Member lifecycle + invariants (`functions/utils/members.ts`)

`createOrgTenant(db, { name, creatorUserId, idempotencyKey })` -- DURABLY IDEMPOTENT (Round-2 finding 2): a timeout+retry must never create two org tenants. Must ATOMICALLY create the tenant + its first owner membership + the idempotency op row (an org tenant with zero owners is unmanageable; an op row without its tenant is a phantom).
1. Validate `name` (bounded) + `idempotencyKey` (non-empty, bounded). `requestHash = sha256(canonical {creator_user_id, name})`.
2. **Idempotency pre-check** by `(creator_user_id, idempotency_key)` on `org_create_operations`: hit + same `request_hash` -> `replay` (return the stored `tenant_id`); hit + different -> `conflict` (409 IDEMPOTENCY_CONFLICT); miss -> proceed.
3. ONE `db.batch([ S1, S2, S3 ])`:
   - S1 `INSERT INTO tenants (type,name,status) VALUES ('organization', ?, 'active')` -> new tenant id T.
   - S2 `INSERT INTO org_create_operations (creator_user_id, idempotency_key, request_hash, tenant_id) SELECT ?creator, ?key, ?hash, last_insert_rowid()` -- captures T via `last_insert_rowid()` IMMEDIATELY after S1 (next statement). The `UNIQUE(creator_user_id, idempotency_key)` here is the CONCURRENCY ARBITER: a concurrent same-key retry that slipped past the pre-check raises UNIQUE -> WHOLE batch rolls back (incl. S1's tenant) -> NO orphan tenant.
   - S3 `INSERT INTO organization_members (tenant_id, user_id, platform_role, status) SELECT tenant_id, ?creator, 'tenant_owner', 'active' FROM org_create_operations WHERE creator_user_id=? AND idempotency_key=?` -- sources T by RE-READING the op row just written in S2 (NOT `last_insert_rowid()`, which by S3 would point at S2's row). Same-batch reads see S1/S2's uncommitted writes.
4. Message-independent catch (mirror `credit.ts`): on throw, re-read `org_create_operations` by `(creator,key)` -> exists -> `replay` (same hash) / `conflict` (diff hash); else transient -> bounded retry -> `contention`.
- **`last_insert_rowid()`-across-`batch()` (S1->S2) MUST be verified, not assumed** (`feedback_dont_assert_runtime_semantics_without_verify`); micro-spike in commit step 1 (D10). NOTE: durable idempotency does NOT depend on that semantic -- it is guaranteed by the `UNIQUE(creator_user_id, idempotency_key)` arbiter (S2) regardless; the spike only confirms S2 captures the correct T. If `last_insert_rowid()` is unreliable across batch statements, fallback = give `tenants` a per-create correlation token (a column set to a unique value in S1, re-read by S2/S3) -- still single-batch + UNIQUE-arbitered, still no orphan.

`suspendMember` / `reactivateMember` / `offboardMember` / `changeMemberRole(toRole)` -- each:
1. Resolve actor's LIVE tenant role (Section 9): MVP lean (D6) = these four member-state mutations (suspend / reactivate / offboard / role-change) are **`tenant_owner`-only**; `tenant_admin` is limited to INVITATION management (create / revoke / list members, Section 10) and cannot mutate member states. (D6 alternative: let `tenant_admin` suspend/reactivate plain `member`s but never touch admins/owners and never change roles -- more granular, deferred.)
2. Reject if tenant `type='personal'` (`personal_tenant_immutable`) -- personal tenants are tenant-of-one, managed by `ensurePersonalTenant`, never via member endpoints.
3. Self-action guard: actor cannot suspend/offboard/demote THEMSELVES (`cannot_target_self`) -- prevents an owner locking themselves out / orphaning the tenant.
4. **Last-owner protection -- STATEMENT-LEVEL guard, NOT pre-read COUNT (Round-2 finding 1).** The "another active owner must remain" condition is a conjunct INSIDE the same mutating `UPDATE`/`DELETE`'s `WHERE`, evaluated against live DB state at write time. Because D1/SQLite SERIALIZES writes, two owners concurrently removing each other resolve to exactly-one-applied + one `last_owner_protected`, with >=1 active owner guaranteed to remain -- no race, no reconciliation as the primary control. Pattern (suspend, target is an active owner):
   ```sql
   UPDATE organization_members SET status='suspended', updated_at=?occurredAt
   WHERE tenant_id=? AND user_id=?target AND status='active'
     AND ( platform_role <> 'tenant_owner'
        OR EXISTS (SELECT 1 FROM organization_members o2
                    WHERE o2.tenant_id=? AND o2.user_id<>?target
                      AND o2.platform_role='tenant_owner' AND o2.status='active') )
   ```
   - offboard (DELETE) uses the same `EXISTS` conjunct, but the "is this op removing an ACTIVE owner?" gate is `NOT (status='active' AND platform_role='tenant_owner')` (offboarding a SUSPENDED owner does not reduce the active-owner set, so it skips the guard). demote (`changeMemberRole` owner->other) is `platform_role <> 'tenant_owner'` on an active target. The general rule: the WHERE removes/invalidates an active owner ONLY when another active owner exists.
   - **Serialization proof (2 owners A,B both active):** req1 suspend B (EXISTS sees A active) -> applies, B suspended; req2 suspend A then evaluates EXISTS against the now-committed state where B is suspended -> no other active owner -> WHERE false -> 0-row -> `last_owner_protected`. Net: exactly one suspended, A stays active. (Symmetric if req2 wins first.)
5. **Outcome classification (no `changes()` for correctness ordering; message-independent re-read for the 0-row case).** Run the guarded mutation; if `changes()===1` -> `applied`. If `changes()===0`, RE-READ the target membership to disambiguate the deny deterministically: row absent / wrong status for this op -> `not_a_member` / `illegal_transition`; row present, is the sole active owner -> `last_owner_protected`. (Same discipline as `credit.ts`: the precise outcome comes from re-readable DB state, never from a batch/SQL error string.) Returns `{outcome}` (`feedback_updatestatus_structured_outcome`).
6. Audit the disposition (`member.suspended` etc. on success; `member.denied` with `reason_code` -- incl. `last_owner_protected` -- on any deny). PR4 emits NO domain event (D1=Option B); audit is the trail and DB state is the SoT.

`changeMemberRole`: `toRole IN ('tenant_owner','tenant_admin','billing_admin','member')`; promoting to `tenant_owner` is allowed (co-owner / ownership transfer = "change role, not move account", arch Section 8) but demoting the last owner is blocked by invariant 4. Role escalation is owner-only (arch Section 9: "member cannot self-promote").

---

## 9. Authorization model + chiyigo-side hard-revoke enforcement

**Member management is a TENANT self-service action authorized by LIVE tenant role, NOT a platform-admin scope.** (Contrast `grant.ts`, which is platform-staff `admin:billing:grant`.) So no new `admin:*` scope is added; no step-up for routine lifecycle (decision item D8; lean: no step-up -- there is no tenant-scoped step-up flow yet, and suspending an employee is routine owner work, not a destructive platform op like a refund). 

`requireActiveTenantRole(db, userId, tenantId, allowedRoles[])`:
1. `requireRegularAccessToken` (actor identity; rejects pre_auth/temp_bind/elevated).
2. `resolveIssuanceContextForTenant(db, userId, tenantId)` -> LIVE membership re-check (tenant active + membership active + role from DB). **This is the chiyigo-side hard-revoke enforcement**: the actor's `platform_role` is re-derived from the DB EVERY request, never trusted from the token claim. A suspended/offboarded/demoted actor is denied immediately (not after the <=15min token TTL) -- the chiyigo-side analog of the RP "every request checks deny-state" rule (arch Section 6/12).
3. `ctx.ok && allowedRoles.includes(ctx.platform_role)` else 403.

**Why suspension does NOT bump `token_version` (the multi-tenant revocation tension):** `bumpTokenVersion(userId)` is per-USER -- it revokes the member's refresh tokens + invalidates access tokens across ALL their tenants. A member suspended in tenant A may be a legitimate active member of tenant B (many-to-many, decision 5) or use their personal tenant. Bumping would wrongly log them out everywhere. So:
- The suspended member's still-valid access token (which has `tenant_id=A`) is naturally stale for <=15min only on RPs that have not yet seen the deny-state event (PR5+); on chiyigo it is denied IMMEDIATELY by the live re-check (step 2) on every tenant-scoped endpoint. On refresh, the token reverts to the personal tenant (PR1 behavior), and re-entering tenant A via org-switch is blocked by `resolveIssuanceContextForTenant` (membership not active). So chiyigo-side is fully fail-closed WITHOUT a cross-tenant-destructive `token_version` bump.
- Immediate cross-tenant-SAFE propagation to RPs is exactly what the `member.suspended` deny-state event delivers (PR5). `account.disabled` (whole-account ban) is the only one that legitimately bumps `token_version` -- and that already lives in `ban.ts`, untouched by PR4.

Cross-tenant isolation is an acceptance gate: every endpoint authorizes the path `:tenantId` via live membership; `:tenantId` is never trusted as a mere filter (mirrors PR3 GET wallet).

---

## 10. API contract

Three auth classes (Round-3 finding 4 -- NOT a blanket `requireActiveTenantRole`):
- **tenant-scoped writes** (invite / revoke / list / suspend / reactivate / offboard / role-change) -> `requireActiveTenantRole` (live role re-check on the path `:tenantId`, Section 9).
- **org-create** (`POST /api/tenants`, no `:tenantId` yet) -> `requireRegularAccessToken` (any user) + durable idempotency (Section 4.3 / 8); no tenant-role gate (you are creating the tenant).
- **invite accept** (`POST /api/invitations/accept`, not a tenant-owner action) -> `requireRegularAccessToken` (the invitee) + one-time token + email-match/verified + tenant-active + not-already-member checks (Section 7.2); the tenant is derived from the invitation row, never from a `:tenantId`.

Common to all writes: strict body allowlist (unknown field incl. `tenant_id`/`actor*` in body -> 400) + per-user rate limit + audit on every disposition + flat `res({error,code})` + traceId envelope. Tenant-scoped paths put `:tenantId` in the route, authorized server-side (never trusted as a filter).

| Method + path | Auth (live role) | Body | Domain call |
|---|---|---|---|
| `POST /api/tenants` | regular token (any user) | `{ name, idempotency_key }` | `createOrgTenant` (durably idempotent) -> 201 `{ tenant_id }` on create (audit `org.created` ONCE) / 200 `{ tenant_id, replay:true }` on same-key+payload replay (audit `org.create.replay` telemetry -- NEVER a second `org.created`, Round-3 finding 3) / 409 `IDEMPOTENCY_CONFLICT` on key+payload mismatch |
| `POST /api/tenants/:tenantId/invitations` | owner (or admin, D6) | `{ email, platform_role }` | `createInvitation` -> 201 `{ invitation_id }` (+`member.invited`) |
| `GET /api/tenants/:tenantId/members` | owner / admin | -- | active members + pending invites (DTO; no token_hash) |
| `POST /api/tenants/:tenantId/invitations/:id/revoke` | owner / admin | -- | `revokeInvitation` (+`invitation.revoked`) |
| `POST /api/invitations/accept` | regular token (the invitee) | `{ token }` | `acceptInvitation` -> 200 `{ tenant_id, platform_role }` (+`member.joined`) |
| `POST /api/tenants/:tenantId/members/:userId/suspend` | owner | -- | `suspendMember` (+`member.suspended`) |
| `POST /api/tenants/:tenantId/members/:userId/reactivate` | owner | -- | `reactivateMember` (+`member.reactivated`) |
| `POST /api/tenants/:tenantId/members/:userId/offboard` | owner | -- | `offboardMember` (DELETE; +`member.offboarded`) |
| `PATCH /api/tenants/:tenantId/members/:userId/role` | owner | `{ platform_role }` | `changeMemberRole` (+`member.role_changed`) |

`/api/invitations/accept` is NOT under `:tenantId` (the invitee may not be a member yet; the tenant comes from the token row). Accept is rate-limited per-user (`member_invite` shares the kind, or a dedicated `invite_accept`) to blunt token brute force, and a wrong/expired/mismatched token emits `invitation.accept.denied` (security signal).

### Outcome -> HTTP
| outcome | HTTP | code |
|---|---|---|
| applied / joined / created | 200/201 | `ok:true` |
| replay (org-create same key+payload; accept re-click while STILL active) | 200 | `ok:true, replay:true` |
| conflict (org-create same key, different payload) | 409 | `IDEMPOTENCY_CONFLICT` |
| membership_not_active (accept re-click while SUSPENDED -- F3) | 403 | `MEMBERSHIP_NOT_ACTIVE` |
| not_found | 404 | `INVITATION_NOT_FOUND` / `MEMBER_NOT_FOUND` |
| email_mismatch | 403 | `INVITE_EMAIL_MISMATCH` |
| expired | 410 | `INVITATION_EXPIRED` |
| already_resolved (incl. accept re-click after OFFBOARD -- F3; needs fresh invite) / illegal_transition / no_op | 409 | `INVITATION_NOT_PENDING` / `ILLEGAL_TRANSITION` |
| already_member | 409 | `ALREADY_MEMBER` |
| last_owner_protected | 409 | `LAST_OWNER_PROTECTED` |
| personal_tenant_immutable | 422 | `PERSONAL_TENANT_IMMUTABLE` |
| cannot_target_self | 409 | `CANNOT_TARGET_SELF` |
| insufficient role / not_a_member | 403 | `FORBIDDEN` / `NOT_A_MEMBER` |
| tenant_ineligible | 422 | `TENANT_INELIGIBLE` |
| contention (bounded-retry exhausted) | 503 | `CONTENTION` |
| rate_limited | 429 | `RATE_LIMITED` |
| invalid | 400 | `ERR_VALIDATION` |

---

## 11. Observability / audit
- DB state (`organization_members` / `invitations` / `org_create_operations`) is the SoT; `safeUserAudit` is the forensic trail (hash-chain via `audit_log`) and non-authoritative telemetry for denials. Membership is not a ledger and PR4 emits no domain event (D1=Option B), so no financial-grade atomic evidence row is needed; correctness comes from the statement-level guards + the durable idempotency UNIQUE.
- Every disposition audits (mirror `grant.ts`): success events (Section 12) + a `member.denied` / `invitation.accept.denied` with `reason_code` + `traceId` on deny. Payloads carry non-sensitive identifiers only (tenant_id, target user_id/sub, role, reason_code) -- never the raw token, never PII beyond the necessary email for the invite event.
- Deny responses return only `{error, code, traceId}` (no internal detail, arch error-envelope rule).

---

## 12. Audit-policy registration (`functions/utils/audit-policy.ts`; +12 events, 186 -> 198)
Add to the registry arrays AND the explicit `it.each` in `tests/audit-policy.test.ts` (per `feedback_audit_classification` + the PR1 red-CI lesson; bump the `toBe(186)` assertion to 198). These `event_type` strings deliberately MATCH the domain-event `eventType` (Section 6.1) where they overlap (no alias). NOTE: this audit count (12) is independent of the domain-event TAXONOMY size (now 11 types, 6.1) -- they are different registries.
- IMMUTABLE (8): `org.created`, `member.invited`, `member.joined`, `member.suspended`, `member.reactivated`, `member.offboarded`, `member.role_changed`, `invitation.revoked` (membership/org state changes = permanent forensic trail, same class as `admin.user.banned` / `admin.user.role_changed`).
- SECURITY_SIGNAL (2): `member.denied` (owner/admin lifecycle OR org-create action denied -- `reason_code` in payload: insufficient_role / not_a_member / last_owner_protected / personal_tenant_immutable / cannot_target_self / already_member / idempotency_conflict / contention / rate_limited / validation), `invitation.accept.denied` (accept failed: expired / revoked / email_mismatch / email_unverified / already_resolved / membership_not_active / not_found -- leaked-link / brute-force signal).
- TELEMETRY (2): `invitation.accept.replay` (same user re-clicks an already-accepted link; idempotent success, metering not error); `org.create.replay` (Round-3 finding 3 -- same-key+payload `POST /api/tenants` retry; idempotent success, metering -- NEVER re-emits the IMMUTABLE `org.created`, mirroring `billing.grant.idempotent_replay` / `billing.credit.idempotent_replay`).

(`account.disabled` / `session.revoked` / `product_access.revoked` reuse existing audit events -- `admin.user.banned`, `admin.token.revoked.*` -- so they need no new audit entries; only the domain-event CONTRACT for them is new, and its emission is deferred per D2.)

---

## 13. Test plan
`_setup.sql` adds `invitations` + `org_create_operations` (CREATE IF NOT EXISTS, named CHECK/UNIQUE, NO `;` in comments -- the resetDb runner splits on raw `;`); `_helpers.ts` adds `seedInvitation` + `seedOrgCreateOp`; `resetDb` DELETE list gains BOTH tables before `tenants`/`users`; `migrations.test.ts`: register `0050` in `ALL_UPS`, `EXPECTED_TABLES` **45 -> 47**, add `EXPECTED_COLUMNS` for both. Each negative test FAILS pre-impl, PASSES post-impl (`feedback_regression_test_must_lock_exact_failure`).

**Migration/schema**: round-trip up/down/idempotent re-run; DB-CHECK negatives (invitation `platform_role='tenant_owner'` rejected; `ck_inv_accept_fields` -- accepted row missing `accepted_user_id`/`accepted_at` rejected, non-accepted row WITH them rejected; invitation partial-unique double-pending rejected; **`org_create_operations` duplicate `(creator_user_id, idempotency_key)` rejected**).

**Domain-event contract (`domain-events.test.ts`) -- the frozen SSOT (Round-2 findings 4+5; Round-3 findings 1+2)**: every `eventType` builds + validates; envelope `v===1`; `streamKey` matches each eventType's scheme + `streamSeq` positive-int enforced; `tenantId=null` only for account/session events; required `data` keys closed (missing -> reject); `actorSub` vs `data.sub` distinct; `canonicalEventJson` stable (key-order independent). **Ordering/convergence**: a fixed `streamKey` with seqs applied out-of-order / duplicated / replayed converges to the highest-seq state (idempotent). **Session bounded-subject keying (R3 finding 1 + R4 finding)**: `session.revoked` accepts ONLY `scope IN ('device','jti')` with a REQUIRED `ref`, streamKey `session:<sub>:<scope>:<ref>`; **`scope='user'` is REJECTED (removed from v1)**; a missing `ref` or a mismatched streamKey is rejected. **Re-login NOT permanently blocked (R4)**: after revoking `jti:X`, a fresh login's NEW `jti:Y` (new streamKey) is NOT in the deny-state -> allowed (proves session.revoked is not a whole-user lockout; that distinction is `account.disabled` / PR5 epoch). **Two-JTI out-of-order regression (R3 finding 1)**: revoke `jti:A` (seq 1) and `jti:B` (seq 2) delivered B-then-A -> BOTH end denied (distinct streamKeys -> A is NOT marked stale by B; a per-user key would have dropped A). **Product access pair (Round-3 finding 2)**: `product_access.revoked` then `.restored` on the same `(tenant,product)` (same streamKey) -> revoke=DENY, higher-seq restore=UN-DENY converges to allowed; reordered (restore seq < revoke seq) converges to denied. **Expand rule**: UNKNOWN optional `data` key TOLERATED; UNKNOWN `eventType` ignorable (not a hard error); the full **11-type** v1 taxonomy present (incl. `product_access.restored`); `tenant.suspended`/`tenant.closed` are NOT in v1 (deferred-expand assertion).

**Invitation (`invitations.test.ts`)**: create (pending row, hashed token, email lowercased, owner role rejected, **already-active/suspended-member -> `already_member`**); re-invite supersedes old pending (one live invite); accept happy (membership active, invite accepted, exactly-once); accept negatives -- expired (410) / revoked / email_mismatch (accepting user's DB email differs -> 403) / **email_unverified (account email matches but not verified -> 403)** / cross-tenant / already-resolved / not_found / **already_member (accepting user already a member, incl. SUSPENDED -> NOT silently reactivated; plain-INSERT rollback path)**; accept replay while STILL active (same user re-click -> 200 replay, no second membership); **accept -> SUSPEND -> re-click old link -> 403 `MEMBERSHIP_NOT_ACTIVE`, NOT reactivated, no `ok:true`** (F3); **accept -> OFFBOARD -> re-click old link -> 409 `already_resolved` / needs fresh invite, NOT re-added** (F3); **concurrent double-accept same token -> exactly one joins, other = replay/deny** (atomic one-time consume); **offboard-then-FRESH-reinvite -> new active membership** (DELETE leaves no row for the plain INSERT); revoke (pending->revoked; non-pending -> deny).

**Member lifecycle (`members.test.ts`)**: createOrgTenant happy (creator = active owner -- assert BOTH the tenant row AND the owner membership land atomically, AND exactly one `org_create_operations` row; no org tenant ever without its owner = the D10 in-batch assertion); **createOrgTenant durable idempotency (F2)**: same `(creator, idempotency_key)` + same name -> 200 `replay` returning the SAME `tenant_id`, and EXACTLY ONE tenant + one op row (a timeout-retry creates no second org); **after the same-key retry `auditCount('org.created') === 1` and the replay emitted `org.create.replay` (telemetry), NOT a second `org.created`** (Round-3 finding 3 -- no double-created in the immutable trail); same key + DIFFERENT name -> 409 `IDEMPOTENCY_CONFLICT`, no new tenant; **concurrent same-key createOrgTenant -> exactly one tenant created, the other = replay (UNIQUE arbiter), never two tenants**; a different key -> a second legitimate tenant. suspend/reactivate/offboard/role-change happy; **last-owner STATEMENT-LEVEL protection (F1)**: suspend/offboard/demote the only owner -> 409 `LAST_OWNER_PROTECTED`; with a 2nd active owner -> allowed; **concurrent regression: two owners each removing the other (suspend and/or offboard) -> EXACTLY ONE applies, the other 409 `LAST_OWNER_PROTECTED`, and >=1 active `tenant_owner` always remains** (locks the WHERE-embedded EXISTS guard, not a pre-read COUNT); offboarding a SUSPENDED owner while another active owner exists is allowed (guard only fires on removing an ACTIVE owner). personal-tenant rejection (any member op on a personal tenant -> 422); self-action guard; illegal transitions (reactivate an active member -> no_op/409; suspend a non-member -> 403); role escalation (member self-promote attempt -> 403); offboard re-onboard (offboard then FRESH invite/accept -> fresh active row).

**Hard-revoke enforcement (`members-authz.test.ts`)**: a suspended member's STILL-VALID access token (tenant_id=that tenant) is denied by `requireActiveTenantRole` on a tenant-scoped endpoint (live re-check, NOT 15min stale); after suspend, org-switch back into the tenant -> 403; cross-tenant (non-member actor) on every endpoint -> 403; demoted actor's old `tenant_owner` token claim does NOT authorize an owner-only op (role re-derived from DB).

**Endpoints (`member-endpoints.test.ts`)**: live-role gate (non-member 403 / member-role on owner-only op 403 / wrong-tenant 403); strict body (unknown field / `actor*` / `tenant_id` in body -> 400); outcome->HTTP table; per-user rate limit (`member_invite` / `member_mutate` at cap -> 429, denial audited, per-user isolation); accept rate limit (token brute-force blunting).

**Audit registry**: all 12 new events classified (no unclassified warn); `_registrySize` **198** + `audit-policy.test.ts` count + `it.each` updated (incl. `org.create.replay`).

---

## 14. Architecture-doc drift override (authoritative over stale sketch lines)
| Stale architecture sketch | PR4 plan (authoritative) | Why |
|---|---|---|
| `employee.suspended` / `role.changed` (Section 11 event list) | `member.suspended` / `member.role_changed` | one concept one string; "employee" is ERP-internal, platform emits `member.*` (`feedback_state_machine_naming_no_alias`) |
| `organization_members.status='invited'` as the pending-invite state | pending lives in `invitations`; `'invited'` is RESERVED/unused (email-only invitees have no `user_id` for a member row) | NOT NULL FK `user_id`; single pending-state location; D3 |
| offboard implied as a status value | offboard = row DELETE (no `'offboarded'` enum; forensic trail = audit event) | avoids a CHECK rebuild of a PR1-shipped table; D4 |
| outbox in PR5 only, yet step 4 needs "deny-state" | PR4 freezes the event CONTRACT (SSOT) ONLY; the `event_outbox` table, emission, and delivery are ALL PR5 | D1 decided = Option B (codex Gate-1); contract is the deliverable, delivery is PR5 (Section 1) |
| suspension "immediately revoke refresh + bump ver" (Section 8 table) | suspension does NOT bump token_version (per-user, kills other tenants); chiyigo enforces via live re-check; cross-tenant-safe propagation = deny-state event | many-to-many membership (decision 5); only `account.disabled` legitimately bumps ver (Section 9) |
| deny-state ordering implied by event arrival / `occurredAt` | authoritative ordering = `(streamKey, streamSeq)`; `occurredAt` is human/tie-break only | clock skew / equal-second collisions make a timestamp unsafe; RP convergence rule frozen in v1 (Section 6.4; Round-2 finding 4) |
| (architecture has no org-create idempotency) | `POST /api/tenants` is durably idempotent via `org_create_operations` `UNIQUE(creator_user_id, idempotency_key)` | external retryable write must not create two orgs (Section 4.3 / 8; Round-2 finding 2) |
| last-owner via pre-read COUNT (was in the Round-1 plan) | last-owner guard is a conjunct INSIDE the mutating `UPDATE`/`DELETE` WHERE (`EXISTS` another active owner); serialized -> exactly-one-applies | pre-read COUNT has a concurrent-removal race; statement-level is race-free (Section 8; Round-2 finding 1) |
| `session.revoked` keyed per-user (`session:<sub>`, Round-2) / incl. unbounded `scope='user'` (Round-3) | BOUNDED subjects ONLY: `session:<sub>:device:<ref>` / `session:<sub>:jti:<ref>` (R4 removed `scope='user'`) | per-user key dropped reordered jti revokes (R3 finding 1); an unbounded `:user` deny would permanently lock out re-login = `account.disabled`, not session-revoke (R4 finding; Section 6.4/6.5) |
| `product_access.revoked` frozen WITHOUT a restore pair | freeze BOTH `product_access.revoked` (DENY) + `product_access.restored` (UN-DENY), same streamKey | half-set hard-revoke contract; access recovers (payment/manual/plan) -> RP must clear the deny (Section 6.5; Round-3 finding 2) |
| org-create replay still audits success | `org.created` IMMUTABLE only on create; same-key replay -> `org.create.replay` TELEMETRY, never a 2nd `org.created` | mirrors PR3 quota-set replay fix; no double-created in the immutable trail (Section 12; Round-3 finding 3) |

---

## 15. Owner / Codex Gate-1 decisions
- **D1 (primary): emission scope -- RESOLVED by codex Gate-1 = Option B.** PR4 = contract-only (no `event_outbox`, no emission, no consumer); PR5 owns the outbox table + emission + lease/retry/DLQ/replay + delivery. Option A rejected. (No longer open; whole plan is Option-B.)
- **D2: deferred emission wiring.** PR4 freezes `account.disabled` / `session.revoked` (device/jti only, R4) / `product_access.revoked`+`.restored` contracts but does NOT retrofit emission into `ban.ts` / logout / a (nonexistent) entitlement-revoke (first-do-no-harm; no consumer yet). Confirm defer, or require wiring `account.disabled` into `ban.ts` now.
- **D3: `organization_members.status='invited'`.** Reserved/unused (pending lives in `invitations`). Confirm, or require pre-creating an `'invited'` member row when inviting an already-registered user.
- **D4: offboard = row DELETE** (vs add `'offboarded'` enum = CHECK rebuild). Confirm.
- **D5: contract validator** = hand-rolled (no new dep, consistent with PR2/PR3) vs introduce a schema lib for the cross-system contract. Lean: hand-rolled.
- **D6: `tenant_admin` powers.** Lean MVP: member-state mutations (suspend/reactivate/offboard/role-change) are owner-only; `tenant_admin` = invitation management (create/revoke/list members). Confirm, or let `tenant_admin` suspend/reactivate plain `member`s (never admins/owners, never role changes).
- **D7: last-owner protection -- RESOLVED to statement-level guard (Round-2 finding 1).** The "another active owner remains" condition is now a conjunct in the mutating `UPDATE`/`DELETE` WHERE (`EXISTS`), race-free under D1 write serialization, locked by a concurrent two-owner mutual-removal regression test (Section 13). Reconciliation is a backstop only, NOT the primary control. Confirm the mechanism.
- **D8: no step-up for member lifecycle** (routine tenant self-service; no tenant-scoped step-up flow exists). Confirm, or require step-up for the destructive ops (offboard / owner demotion).
- **D9: PR size.** This is a large PR (org-create + invitation + member lifecycle + event contract). Keep unified with the Section 17 commit plan, or split (e.g. 4a = invitation+member-lifecycle, 4b = event-contract+enforcement)? Lean: unified -- the contract is the point of step 4 and binds the rest.
- **D10: `createOrgTenant` in-batch `last_insert_rowid()` (S1->S2).** The op-row INSERT (S2) captures the new tenant id via `last_insert_rowid()` right after the tenant INSERT (S1); a micro-spike in commit step 1 verifies D1 preserves it across batch statements (`feedback_dont_assert_runtime_semantics_without_verify`). NOTE (changed since Round 1): durable idempotency does NOT depend on this -- it is guaranteed by `org_create_operations`'s `UNIQUE(creator_user_id, idempotency_key)` regardless (finding 2); the spike only confirms the captured `tenant_id` is correct; documented fallback = a per-create correlation token. Confirm spike-then-rely.
- **D11 (Round-2): hard-revoke optional `reason` field.** v1 freezes `reason?` (optional) on `member.suspended` / `member.offboarded` / `account.disabled` / `product_access.revoked` / `product_access.restored` (Section 6.5) for RP audit/triage + forward-compat (so a real revoke trigger never needs a breaking add). Confirm including the optional field now, or drop it (RP gets reason via a future API instead).
- **D12 (Round-3): product_access = Option A (revoke + restore PAIR) -- RESOLVED in plan.** v1 freezes BOTH `product_access.revoked` (DENY) and `product_access.restored` (UN-DENY), same streamKey, so the hard-revoke contract is not half-set (Section 6.1 / 6.5). Chosen over Option B (defer the whole family to PR5) because ERP triage made product_access a PR4 must-consider and deferring it alone would leave the only unfrozen hard-revoke family. Confirm Option A (or override to B = drop both `product_access.*` from v1).
- **D13 (Round-3): session per-subject streamKey + org-create replay-not-created -- RESOLVED design fixes (no open choice).** `session.revoked` keys per bounded subject (`session:<sub>:<scope>:<ref>`, scope device/jti, Section 6.4) so independent jti/device revokes never overwrite under reorder; `POST /api/tenants` replay emits `org.create.replay` TELEMETRY and never a 2nd `org.created` IMMUTABLE (Section 12), `_registrySize` 197 -> 198. Noted for confirmation; no alternative proposed.
- **D14 (Round-4): `session.revoked scope='user'` REMOVED from v1; whole-user logout-all deferred to PR5 -- RESOLVED via Option A.** A per-user session deny-list subject would permanently block the user's future logins (it has no cutoff), which is `account.disabled` semantics, not session-revoke (the R3 blocker). v1 keeps only bounded `scope IN ('device','jti')`; "logout everywhere / revoke-before" becomes a PR5 token EPOCH / `tokenVersion` / `revokedBefore` cutoff (RP compares `token.iat`/version), which PR4 cannot freeze because it has no RP-visible epoch source yet (relates to RP-facing token gaps #1/#2). Confirm Option A (or override to Option B = keep `scope='user'` WITH a mandatory `revokedBefore`/`sessionVersion` cutoff + the frozen RP "deny only iat<=cutoff" rule + a "new token after revoke is NOT denied" test).

---

## 16. Self-review log (pre-Gate-1)
1. **Multi-tenant revocation**: caught that the architecture's "suspend -> bump ver" (Section 8) over-revokes a multi-tenant member; resolved via live re-check + deny-state event, no per-user bump (Section 9). Locked.
2. **Event naming**: caught `member.suspended` (arch Section 6) vs `employee.suspended` (Section 11); standardized on `member.*` with the no-alias rule (Sections 6.1, 14).
3. **Accept atomicity**: the one-time consume + join must be atomic AND exactly-once; designed S1-CAS + S2-conditional-INSERT-SELECT gated on the `occurredAt` freshness marker, message-independent re-read (Section 7.2). Verified the concurrent-double-accept and already-resolved paths.
4. **Last-owner / personal-tenant / self guards**: enumerated; last-owner is now a STATEMENT-LEVEL `EXISTS` guard inside the mutation (Round-2 finding 1, D7 resolved), race-free under D1 serialization -- NOT a pre-read COUNT.
5. **PR4/PR5 ordering**: contract-SSOT frozen in PR4; emission scope DECIDED = Option B by codex Gate-1 (Section 1, D1) -- PR4 contract-only, PR5 owns outbox + delivery.
6. **First-do-no-harm**: PR4 does not touch `ban.ts` / logout / `grant.ts` / token signing (D2); no `token_version` semantics change.
7. **Suspended-member reactivation bypass**: caught that re-inviting a SUSPENDED member + an accept `ON CONFLICT DO UPDATE` would silently flip them back to active (defeating the owner's suspend). Closed: `createInvitation` rejects `already_member` (Section 7.1 step 2), accept pre-checks `already_member`, and S2 is a PLAIN INSERT (unique violation -> rollback -> `already_member`) -- no silent reactivation (Section 7.2).
8. **`createOrgTenant` atomicity**: caught that a sibling `batch()` statement cannot bind the just-generated AUTOINCREMENT tenant id; proposed in-batch `last_insert_rowid()` and -- per `feedback_dont_assert_runtime_semantics_without_verify` -- flagged it as must-verify (D10) rather than assumed, with a documented fallback.
9. **Datetime compare trap**: `expires_at` is stored + ordering-compared via SQLite `datetime()` (not app-ISO) to avoid the lexical-compare bug (`feedback_sqlite_iso_datetime_compare`); the `accepted_at` freshness marker is matched by EXACT equality (format-irrelevant).

**Round 2 (codex Gate-1 findings + ERP triage):**
10. **F1 last-owner**: moved from pre-read COUNT + "rare-race MVP-accept" to a WHERE-embedded `EXISTS` conjunct in the mutating statement; added the serialization proof + a concurrent two-owner mutual-removal regression test (Section 8, 13). Reconciliation demoted to backstop.
11. **F2 createOrgTenant**: added `org_create_operations` durable-idempotency table (UNIQUE arbiter) + `idempotency_key` body param + replay/conflict outcomes + a 3-statement atomic batch (op-row arbiter prevents orphan/duplicate tenants); table count 45->47 (Section 4.3, 8, 10, 13). D10 reframed: idempotency no longer depends on `last_insert_rowid()`.
12. **F3 accepted-replay**: a bare "accepted by me -> 200" collided with hard-revoke; now gated on LIVE membership -- active->replay, suspended->`MEMBERSHIP_NOT_ACTIVE`, offboarded(row gone)->`already_resolved`/fresh-invite; replay path reads but never writes `organization_members` (Section 7.2 step 2a, 10, 13).
13. **F4 ordering**: replaced `occurredAt` LWW with frozen `(streamKey, streamSeq)` ordering + an idempotent RP convergence rule (duplicate/out-of-order/replay safe); added the fields to the v1 envelope + validator; the expand rule keeps PR5 unblocked (Section 6.2, 6.4, 6.3).
14. **F5 ERP alignment + Option B cleanup**: added the 6.5 alignment review (product_access.revoked + hard-revoke payloads conservative decision; tenant.* deferred-expand; B1/B2/B3b/B4b/B5 logged as PR5/PR6 inputs only); purged all Option A / `event_outbox` references (D1 decided = B) across Sections 1/2/4/6/8/11/13/14/15/17/18.

**Round 3 (codex Gate-1 Round-2 findings):**
15. **R3-F1 session streamKey too coarse**: per-user `session:<sub>` let two jti/device revokes share a sequence -> out-of-order delivery marked the earlier one stale and dropped it. Fixed: streamKey is the exact subject (R3 introduced `:user`/`:device`/`:jti`; **R4 item 20 then REMOVED `:user`** -- final scheme is device/jti only); validator cross-checks streamKey vs `{sub,scope,ref}`; added a two-JTI out-of-order regression (Sections 6.1, 6.3, 6.4, 6.5, 13).
16. **R3-F2 product_access half-set**: only `revoked` was frozen -> RP could never CLEAR a deny after payment/manual/plan restore. Fixed via Option A: froze the `product_access.restored` UN-DENY pair (same streamKey, `{productId, reason?}`); taxonomy 10 -> 11 types; "every DENY has a paired UN-DENY" stated (Sections 6.1, 6.5, 13; D12). Chose A over B (defer all product_access.*) for consistency with the already-frozen member/account/session hard-revokes + ERP triage's must-consider.
17. **R3-F3 org-create replay re-audited success**: replay would re-emit IMMUTABLE `org.created` (PR3 quota-set replay bug). Fixed: `org.created` ONCE on create; same-key+payload replay emits TELEMETRY `org.create.replay` (mirrors `billing.*.idempotent_replay`); `_registrySize` 197 -> 198; added `auditCount('org.created') === 1` after a same-key retry (Sections 10, 12, 13; D13).
18. **R3-F4 API-contract contradiction**: "All write endpoints require `requireActiveTenantRole`" was false for org-create (no `:tenantId`) and accept (not an owner action). Fixed: §10 now splits 3 auth classes -- tenant-scoped writes = `requireActiveTenantRole`; org-create = regular token + durable idempotency; accept = regular token + token/email-verify + live-membership checks.
19. **Scope discipline (Round 3)**: confirmed PR4 stays Option B contract-only -- NO `event_outbox` / delivery / consumer; NO Durable Objects / Queues added; chiyigo-core Queues/DO governance is a separate doc, not a PR4 blocker; B1/B2/B3b/B4b/B5 remain PR5/PR6 inputs, not folded in.

**Round 4 (codex Gate-1 Round-3 finding -- the last frozen-contract blocker):**
20. **R4 `session.revoked scope='user'` had no cutoff/epoch -> permanent lockout**: a per-user session deny subject would block the user's FUTURE logins (no time cutoff), i.e. `account.disabled` semantics mislabeled as session-revoke. Fixed via **Option A**: REMOVED `scope='user'` from v1; `session.revoked` now accepts ONLY bounded `scope IN ('device','jti')` with a REQUIRED session-scoped `ref` (streamKey `session:<sub>:<scope>:<ref>`), so a re-login is a NEW subject and never permanently blocked. Whole-user "logout-all / revoke-before" is deferred to PR5 as a token EPOCH / `tokenVersion` / `revokedBefore` cutoff (D14); whole-account ban stays `account.disabled`. Updated taxonomy/payload/validator/ordering/§6.5/tests/D2/D13/+D14. Added a "new jti after revoke is NOT denied" + "scope='user' rejected" test. Scope unchanged: still Option B contract-only, no DO/Queues/outbox, B-items untouched.

Open items are the explicit decisions D2/D3/D4/D5/D6/D8/D9/D10/D11/D12 (D1+D7 resolved R2; D13+F1/F4 resolved R3; **D14 resolved R4 via Option A**); no blocking self-contradiction found.

---

## 17. File list + commit plan (two-gate workflow, `feedback_codex_review_workflow`)
**New**: `migrations/0050_member_lifecycle.sql` (+down) -- **2 tables: `invitations` + `org_create_operations`** (NO `event_outbox` -- PR5); `functions/utils/domain-events.ts` (frozen contract incl. `streamKey`/`streamSeq` + expand rule); `functions/utils/invitations.ts`; `functions/utils/members.ts`; endpoints under `functions/api/tenants/*` + `functions/api/invitations/accept.ts`; tests (`domain-events.test.ts`, `invitations.test.ts`, `members.test.ts`, `members-authz.test.ts`, `member-endpoints.test.ts`).
**Modified (minimal)**: `functions/utils/audit-policy.ts` (+12; 186->198); `tests/audit-policy.test.ts` (count + it.each); `functions/utils/rate-limit.ts` (+`member_invite`, `member_mutate`); `functions/utils/email.ts` (+`sendInvitationEmail`); `tests/integration/_setup.sql` + `_helpers.ts` (+`seedInvitation`, `seedOrgCreateOp`) + `migrations.test.ts` (table count **45->47**, columns, seeders, resetDb).
**Do NOT touch**: `ban.ts` / logout / token signing points / `grant.ts` / `credit.ts` / chiyigo-core.

Gate 1 = THIS plan. After approval, commits: (1) migration 0050 (invitations + org_create_operations) + test scaffold + the **D10 `last_insert_rowid()`-across-batch micro-spike** (zero runtime change); (2) `domain-events.ts` contract + its unit tests (the frozen SSOT -- envelope/taxonomy/streamKey/streamSeq/expand-rule -- lands first so the rest references it); (3) `invitations.ts` + `members.ts` domains (incl. statement-level last-owner guard + durable-idempotent createOrgTenant) + domain tests; (4) endpoints + rate-limit/audit/email wiring + endpoint tests. (No event-emission commit -- D1=Option B.) Each step: full local CI parity (`lint` not tail-truncated / `typecheck:ratchet` / `verify:browser-pipeline` / `test:cov` -- add D1-dependent domain modules to vitest coverage-exclude like billing/credit / `test:int` / `build:functions` / `npm audit --omit=dev`); `git diff --stat` self-check; commit-quality hook via the PowerShell path if it trips (NOT `--no-verify`, `feedback_claude_code_hook_bash_matcher_bypass`); pure backend -> no cache-bust. Then Gate 2 (codex code review) -> migration-before-deploy -> push.

## 18. Deploy / migration-ordering note (PR1/PR2/PR3 lesson)
`deploy.yml` is `on: push:[main]` -> merge = auto-deploy. 0050 adds 2 tables (`invitations` + `org_create_operations`) used by new code in the same PR: apply `wrangler d1 migrations apply chiyigo_db --remote` (owner-run/authorized, auditable) -> verify BOTH tables exist in prod D1 -> THEN merge -> smoke. Blast radius is lower than PR1 (all-new endpoints, no existing hot path), but the ordering holds (`reference_pages_deploy_with_d1_migration`). Down/rollback DROPs the 2 new tables -- safe only before any real invitation / org-create-op row exists; once they exist, rollback = forward-fix (`feedback_irreversible_action_full_review`). Positive prod smoke (real invite/accept email round-trip) can ship credential-free (deploy + auth-gate 401/403 + no write) with full `test:int` of authenticated paths, same disposition as PR2/PR3.

---
*Plan complete (DRAFT). Next step = Codex Gate 1 plan review -> address findings -> implement (Section 17) -> Gate 2 -> migration-before-deploy -> push.*
