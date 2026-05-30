# PR2 -- Subscription / Product Access + grantPlan Foundation (Implementation Plan)

- **Created**: 2026-05-30
- **Work tier**: L3 (new bounded context: Billing/Entitlement) + high-risk domain layer (grantPlan = financial state machine)
- **Status**: Codex Gate 1 approved for contract through Rev 3.3; this document is the consolidated approved contract transcription. Implementation may begin only after the mandatory Stage 0 spike (Section 6).
- **Owner decision**: Option B -- permanent product access only (no period / expiry / renewal).
- **Upstream design**: `docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md` Sections 5 / 7 / 20 (codex r5 approved). This plan realizes "PR2 = Subscription / Product Access + grantPlan" and supersedes that doc's stale sketch fields via the Section 11 drift-override.
- **HEAD baseline**: `origin/main@1668996` (working tree clean, latest migration `0047`) -> new migration = `0048`.
- **Prerequisite**: PR1 Tenant Foundation is live (`tenants` / `organization_members` / token `tenant_id`+`platform_role` / `requireRegularAccessToken`).

> Note on encoding: this document is intentionally pure ASCII. Unicode code points are written in `U+XXXX` notation; the actual implementation/test source uses the real characters (full-width forms, zero-width chars) via backslash-u escape sequences.

---

## 0. Codex Gate 1 convergence log

| Round | Verdict | Highlights |
|---|---|---|
| Rev 1 | Direction good, not impl-ready | 8 blockers (payment idempotency / evidence / conflict / atomicity / state machine / tenant eligibility / naming / authz) |
| Rev 2 | Improved, not approved | Introduced ledger SoT, atomic batch, request_hash, tenant_scope, admin:billing |
| Rev 3 | Blockers resolved | Option B chosen; ledger reconstructs projection; offline payment_ref dedup; CHECK enums; occurred_at server-only |
| Rev 3.1 | Conditional approve | Actor snapshot (granted_by no-FK + email + role); payment_ref_key canonical |
| Rev 3.2 | Conditional approve | Payment-row forbids all manual evidence; offline vs override mutually exclusive; canonicalize Unicode/allowlist |
| Rev 3.3 | APPROVED | Manual-row also forbids `payment_event_ref`; display > 200 rejects (no truncation); Unicode test samples all escaped |

---

## 1. Scope

**In scope (PR2)**
1. `products` + `plans` catalog tables (+ seed).
2. `tenant_product_access` projection table (current state, NO period columns).
3. `grant_plan_operations` append-only ledger (SoT + fail-closed evidence), full schema landed now (including payment-trigger columns, schema-ready).
4. `grantPlan` domain function -- manual trigger fully implemented (offline_payment / admin_override).
5. Manual grant endpoint `POST /api/admin/billing/grant` (`admin:billing:grant` + step-up `elevated:billing`).
6. Tenant-scoped read `GET /api/tenants/:tenantId/entitlements`.
7. Stage 0 atomicity spike (mandatory pre-implementation gate).
8. audit-policy registration + tests (cross-tenant isolation, idempotency, canonicalization, projection rebuild, ...).

**Out of scope (explicitly deferred to later PRs)**
- Time semantics: period / expiry / renewal (Option B -> permanent access).
- Payment-trigger CODE PATH + webhook wiring (columns are pre-provisioned; the code lands in a dedicated PR once a plan-checkout flow exists).
- Revoke / auto-expire OPERATIONS (`revoked`/`expired` are reserved enum values only; the operations that produce them are deferred).
- Credit wallet / quota / `deductCredits` -> PR3 (each behind its own spike).
- Event outbox -> PR5.
- Adding a `product_access` claim to access_token -> RP-integration / JWT-Claim-Policy PR.
- Reconciliation job -> when real payment flow exists (per the standing "defer payment smoke" owner decision).

---

## 2. Current-state grounding (already read)

**Greenfield confirmed**: grep `subscription|grant_plan|entitlement|product_access|plans` only matches the `payment_intents.kind='subscription'` enum value (`functions/utils/payments.ts:43` / `migrations/0025_payment_intents.sql:22`) plus frontend display. No `products`/`plans`/`subscriptions`/`grant_plan_operations` tables exist; `tests/integration/_setup.sql` has only PR1's `tenants`/`organization_members`. The billing-entitlement domain is new.

**PR1 assets reused**
- `functions/utils/tenant-context.ts` -- `resolveIssuanceContextForTenant` (fail-closed tenant/member invariant), `PlatformRole`.
- `functions/utils/auth.ts:298` -- `requireRegularAccessToken` (returns verified integer `userId`; rejects temp_bind / elevated / non-positive sub). All PR2 tenant-scoped endpoints reuse it.
- `migrations/0047_tenant_foundation.sql` -- `tenants` (`type` + `personal_owner_user_id` + always-active CHECK), `organization_members` (`platform_role IN (tenant_owner, tenant_admin, billing_admin, member)`).

**Patterns to mirror (do not reinvent)**
- Idempotency / state machine / structured outcome: `functions/utils/payments.ts` (`ALLOWED_TRANSITIONS:179`, `updatePaymentStatus`, `lockIntentForRefund` CAS).
- Webhook dedup (payment OBJECT vs event separation): `payment_webhook_events` UNIQUE(vendor,event_id) + the three-state `apply_status` claim in `functions/api/webhooks/payments/[vendor].ts`.
- Admin + step-up double gate: `functions/api/admin/payments/intents/[id]/refund.ts:54-63` (`requireStepUp` + `effectiveScopesFromJwt` fine-scope check).
- Scopes: `functions/utils/scopes.ts` (coarse->fine `SCOPE_HIERARCHY`, `ROLE_BASE_SCOPES`, `KNOWN_ELEVATED_SCOPES`).
- Audit registry: `functions/utils/audit-policy.ts` (warn-on-missing; PR1 already added `tenant.switch.*`).
- Test scaffold: `tests/integration/_helpers.ts` (already has `seedTenant`/`seedMembership`) + `_setup.sql` (CREATE IF NOT EXISTS) + `resetDb` DELETE list.

---

## 3. Data model -- `migrations/0048_billing_entitlement.sql` (expand-only)

> The full ledger shape lands now: SQLite CANNOT `ALTER` a table-level CHECK, so adding payment columns later would force a rebuild of a populated append-only financial table (the baseline forbids non-reversible destructive migrations). Therefore the payment columns are created now (nullable, unwritten in PR2).

### 3.1 `products`
```sql
CREATE TABLE IF NOT EXISTS products (
  id           TEXT    PRIMARY KEY,                  -- 'erp' | 'senior-app' (stable human code)
  name         TEXT    NOT NULL,
  tenant_scope TEXT    NOT NULL CHECK(tenant_scope IN ('organization','personal','any')),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- seed (idempotent): ('erp','ERP','organization',1), ('senior-app','Senior App','any',1)
```

### 3.2 `plans`
```sql
CREATE TABLE IF NOT EXISTS plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,   -- surrogate (ledger references it forever; immune to code rename)
  product_id       TEXT    NOT NULL REFERENCES products(id),
  code             TEXT    NOT NULL,                     -- immutable human code (rename = new code + deprecate)
  name             TEXT    NOT NULL,
  features         TEXT,                                 -- JSON (validated at write boundary)
  included_credits INTEGER NOT NULL DEFAULT 0,
  price_subunit    INTEGER,                              -- nullable (free/custom)
  currency         TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, code)
);
CREATE INDEX IF NOT EXISTS idx_plans_product ON plans(product_id);
-- seed: minimal placeholder plans (real catalog/pricing is a business input; can be added later as data-only)
```

### 3.3 `tenant_product_access` (projection; NO period columns)
```sql
CREATE TABLE IF NOT EXISTS tenant_product_access (
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  product_id          TEXT    NOT NULL REFERENCES products(id),
  plan_id             INTEGER NOT NULL REFERENCES plans(id),
  status              TEXT    NOT NULL CHECK(status IN ('pending','active','expired','revoked')),
                                      -- PR2 produces only 'active'; the rest are reserved
  granted_via         TEXT    NOT NULL CHECK(granted_via IN ('payment','manual')),
                                      -- PR2 produces only 'manual'
  version             INTEGER NOT NULL DEFAULT 1,        -- optimistic lock
  last_op_occurred_at TEXT    NOT NULL,                  -- ordering basis (UTC ISO-8601; see Section 5.2); reconstructable from ledger
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_tpa_tenant ON tenant_product_access(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tpa_status ON tenant_product_access(status);
```
> The projection is MUTABLE (re-grant performs an UPDATE that bumps version); it is not append-only. It can be fully reconstructed from the ledger (Section 5.6).

### 3.4 `grant_plan_operations` (append-only ledger; SoT + fail-closed evidence)
```sql
CREATE TABLE IF NOT EXISTS grant_plan_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  product_id TEXT    NOT NULL REFERENCES products(id),
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  trigger    TEXT    NOT NULL CHECK(trigger IN ('payment','manual')),

  -- manual trigger
  manual_source         TEXT CHECK(manual_source IN ('offline_payment','admin_override')),
  admin_idempotency_key TEXT,
  request_hash          TEXT,

  -- actor snapshot (manual): immutable evidence. granted_by has NO FK -- the ledger must outlive the
  --   user row, so later email/role changes or account deletion do not erase "who granted". The id is
  --   a historical snapshot (AUTOINCREMENT ids are never reused); email/role are the durable label.
  granted_by            INTEGER,
  granted_by_email      TEXT,
  granted_by_role       TEXT,

  -- offline evidence
  payment_ref           TEXT,      -- display value (app-trimmed, as entered)
  payment_ref_key       TEXT,      -- canonical key (Section 4) -- the only dedup / request_hash surface
  grant_reason          TEXT,      -- admin_override reason

  -- payment trigger (schema-ready; UNWRITTEN in PR2; payer/evidence live in payment_intents)
  payment_intent_id     INTEGER REFERENCES payment_intents(id),  -- payment OBJECT (dedup unit)
  payment_event_ref     TEXT,                                    -- webhook event_id (trace only)

  -- transition + concurrency/ordering
  from_status TEXT NOT NULL CHECK(from_status IN ('none','pending','active','expired','revoked')),
  to_status   TEXT NOT NULL CHECK(to_status   IN ('pending','active','expired','revoked')),
  prev_projection_version INTEGER NOT NULL DEFAULT 0,   -- projection version this op supersedes
  occurred_at TEXT NOT NULL,                            -- SERVER-generated UTC ISO-8601 (Section 5.2); never client-provided
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  -- NOTE: reconciled_at was intentionally removed -- an append-only ledger cannot carry a mutable
  --       column (the UPDATE would hit the no-update trigger). Reconciliation is deferred and will
  --       use a separate record; it never writes back into this table.

  UNIQUE(admin_idempotency_key),                          -- manual request dedup
  UNIQUE(payment_intent_id),                              -- payment OBJECT dedup (never event_id)
  UNIQUE(tenant_id, product_id, prev_projection_version), -- per-entitlement serialize (fail-closed concurrency lock)

  -- the conditioning column `trigger` is NOT NULL, so these conditional NOT-NULL CHECKs fire reliably
  -- (this avoids the PR3 NULL-bypass trap where a CHECK on a NULL conditioner silently passes).
  CHECK( trigger <> 'manual' OR (
           manual_source IS NOT NULL AND admin_idempotency_key IS NOT NULL
           AND request_hash IS NOT NULL
           AND granted_by IS NOT NULL
           AND granted_by_email IS NOT NULL AND length(trim(granted_by_email)) > 0
           AND granted_by_role  IS NOT NULL AND length(trim(granted_by_role))  > 0
           AND payment_intent_id IS NULL
           AND payment_event_ref IS NULL) ),
  CHECK( trigger <> 'payment' OR (
           payment_intent_id IS NOT NULL
           AND manual_source IS NULL AND admin_idempotency_key IS NULL AND request_hash IS NULL
           AND granted_by IS NULL AND granted_by_email IS NULL AND granted_by_role IS NULL
           AND payment_ref IS NULL AND payment_ref_key IS NULL AND grant_reason IS NULL) ),
  CHECK( manual_source <> 'offline_payment' OR (
           payment_ref IS NOT NULL AND length(trim(payment_ref)) > 0
           AND payment_ref_key IS NOT NULL AND length(payment_ref_key) BETWEEN 3 AND 80
           AND grant_reason IS NULL) ),
  CHECK( manual_source <> 'admin_override' OR (
           grant_reason IS NOT NULL AND length(trim(grant_reason)) > 0
           AND payment_ref IS NULL AND payment_ref_key IS NULL) )
);
-- offline: one canonical bank ref = one grant (variant-proof)
CREATE UNIQUE INDEX IF NOT EXISTS uq_gpo_offline_payment_ref_key
  ON grant_plan_operations(payment_ref_key) WHERE manual_source = 'offline_payment';
CREATE INDEX IF NOT EXISTS idx_gpo_tenant_product ON grant_plan_operations(tenant_id, product_id);

-- append-only: block UPDATE / DELETE (mirrors audit_log no_update/no_delete)
CREATE TRIGGER IF NOT EXISTS gpo_no_update BEFORE UPDATE ON grant_plan_operations
  BEGIN SELECT RAISE(ABORT, 'grant_plan_operations is append-only'); END;
CREATE TRIGGER IF NOT EXISTS gpo_no_delete BEFORE DELETE ON grant_plan_operations
  BEGIN SELECT RAISE(ABORT, 'grant_plan_operations is append-only'); END;
```

**FK parent lifecycle (important).** `granted_by` intentionally has NO FK -- actor evidence must survive user mutation and account deletion (see the actor-snapshot note above). The other parents -- `tenant_id`, `product_id`, `plan_id`, `payment_intent_id` -- DO keep their FKs to enforce referential integrity. Because this ledger is append-only and immutable, once a row references those parents they MUST NOT be hard-deleted: use lifecycle patterns instead (tenant `status`, product/plan `is_active`, `deleted_at` soft-delete, anonymize/deactivate). A cascade delete or dangling orphan is not acceptable for a financial SoT. If a future feature genuinely requires physical deletion of such a parent, it must FIRST add an explicit archival/snapshot strategy (e.g. snapshot the referenced fields into the ledger or an archive table) before any hard delete.

### 3.5 down migration
```sql
-- Rollback: DROP the 4 tables created by this migration (and their indexes/triggers).
-- Only for emergency rollback "after PR2 deploy but before any real grant exists"
-- (the projection is reconstructable from the ledger, so no irreversible loss).
-- Once real grants exist, rollback becomes forward-fix; DROP is forbidden (destructive-migration rule).
DROP TABLE IF EXISTS grant_plan_operations;
DROP TABLE IF EXISTS tenant_product_access;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS products;
```

---

## 4. `canonicalizePaymentRef` contract (single shared util)

Deterministic, locale- and time-independent; computed at write time (insert + dedup); never accepts a client-supplied key. Code points below are given in `U+XXXX` notation; the real util uses the corresponding characters via backslash-u escapes.

```
canonicalizePaymentRef(raw: string):
  | { ok: true,  key: string, display: string }
  | { ok: false, code: 'INVALID_PAYMENT_REF' }

  1. display = strip leading/trailing Unicode whitespace from `raw`
  2. if display.length === 0    -> return { ok:false, code:'INVALID_PAYMENT_REF' }
  3. if display.length > 200    -> return { ok:false, code:'INVALID_PAYMENT_REF' }   (REJECT, do NOT truncate)
  4. s = display.normalize('NFKC')   -- fold full-width / compatibility forms (e.g. fullwidth A/B/C -> ABC)
  5. s = remove from s every char that matches the JS regex class \s under the /u flag
         (\s already covers U+00A0, U+2000..U+200A, U+3000, U+FEFF), PLUS every char in the
         invisible set { U+200B, U+200C, U+200D, U+2060 } (zero-width chars + word-joiner)
  6. key = s.toUpperCase()           -- plain toUpperCase(), NOT toLocaleUpperCase() (avoids the Turkish-i locale bug)
  7. if key does NOT match /^[A-Z0-9._:-]{3,80}$/   -> return { ok:false, code:'INVALID_PAYMENT_REF' }
  8. return { ok:true, key, display }
```
- Fixed order: trim-display -> empty/over-length reject -> NFKC -> strip-whitespace -> uppercase -> allowlist.
- The allowlist `^[A-Z0-9._:-]{3,80}$` exhaustively defines a valid key; anything else (CJK, emoji, control chars, punctuation outside `._:-`, out-of-bounds length) returns `INVALID_PAYMENT_REF` (endpoint -> 400). Reject, never silently mangle or truncate.
- Deterministic: no locale, no `Date`, no randomness; identical input -> identical key.
- `display` preserves the original formatting (minus surrounding whitespace); `key` is the only dedup/idempotency comparison surface and also feeds the offline branch of `request_hash` (Section 5.4).

---

## 5. State machine + idempotency + evidence + fail-closed

### 5.1 States (permanent access)
Enum (forward-compatible to avoid a future append-only-ledger CHECK rebuild): `pending` (payment-await, reserved) / `active` (the ONLY state PR2 produces) / `expired` (time-based, NOT implemented -- Option B) / `revoked` (admin revoke, reserved).
PR2 grants are permanent until an explicit revoke (the revoke operation is deferred). No period, no auto-expiry, no renewal.

### 5.2 Timestamp format rule (ordering correctness)
`occurred_at` and `tenant_product_access.last_op_occurred_at` are **server-generated UTC ISO-8601 strings from `new Date().toISOString()`** (e.g. `2026-05-30T12:34:56.789Z`). Both fields use the SAME format, and the stale-ordering comparison only ever compares these same-format values (fixed-width, lexicographically sortable). `created_at` keeps the DB default `datetime('now')` (SQLite `YYYY-MM-DD HH:MM:SS` form) but is NOT used for ordering -- the two formats must never be lex-compared against each other (see the known SQLite-vs-ISO lex-compare pitfall, memory `feedback_sqlite_iso_datetime_compare`). `occurred_at` is therefore app-provided (not a DB default); `last_op_occurred_at` is written from the same op's `occurred_at`.

### 5.3 grantPlan (manual) algorithm
```
grantPlanManual(env, { tenantId, productId, planId, manualSource, paymentRefRaw, grantReason,
                       adminIdempotencyKey, actor /* {id,email,role} from step-up token + users row */ }):
  1. validate (inline, no Zod): ids positive ints / productId known / manualSource in enum /
     adminIdempotencyKey non-empty bounded / occurred_at = SERVER now toISOString() (never from body).
     - offline_payment: canonicalizePaymentRef(paymentRefRaw); if not ok -> 400 INVALID_PAYMENT_REF;
                        grantReason must be absent (mutual exclusivity).
     - admin_override:  grantReason trimmed non-empty; paymentRef must be absent (mutual exclusivity).
  2. request_hash = sha256(canonicalJSON({ tenant_id, product_id, plan_id, manual_source,
                       payment_ref_key ?? "", grant_reason(trimmed) ?? "", target_status:"active" }))
       -- sorted keys, stable serialization. EXCLUDE: admin_idempotency_key, actor, timestamps/traceId.
       -- no access-window fields (permanent access, justified).
  3. idempotency pre-check (admin_idempotency_key):
       hit + same hash -> { outcome:'replay', prior }
       hit + diff hash -> { outcome:'conflict' }   (caller -> 409 IDEMPOTENCY_CONFLICT)
       miss            -> continue
  4. tenant eligibility (target, server lookup):
       tenants.status='active' AND deleted_at IS NULL  else TENANT_INELIGIBLE
       products.is_active=1                            else PRODUCT_INACTIVE
       tenant.type in products.tenant_scope            else PRODUCT_TENANT_TYPE_MISMATCH
       plan belongs to product AND active              else PLAN_INVALID
  5. offline evidence pre-check: SELECT WHERE manual_source='offline_payment' AND payment_ref_key=?
       hit (not the same idempotency request) -> { outcome:'evidence_conflict' } (409 EVIDENCE_ALREADY_USED)
  6. bounded retry loop (<=4):
       a. read projection {status, version, last_op_occurred_at} (absent -> from='none', version=0)
       b. (ordering guard, primarily for the future payment trigger) reject if
          occurred_at < last_op_occurred_at  (strictly older) -> { outcome:'stale_rejected' }.
          For manual, occurred_at = server-now, so it is never strictly older (incl. same instant).
       c. legality: to='active' in ALLOWED_TRANSITIONS[from] (manual -> active is allowed from any
          state, incl. revoked->active = intentional admin reinstatement).
       d. atomic batch (env.chiyigo_db.batch):
          - INSERT grant_plan_operations(... trigger='manual', from_status=status, to_status='active',
            prev_projection_version=version, occurred_at, actor snapshot, manual evidence, request_hash)
          - projection write:
              from='none' -> INSERT tenant_product_access(... status='active', version=1,
                             granted_via='manual', last_op_occurred_at=occurred_at)
              else        -> UPDATE ... SET status='active', plan_id=?, granted_via='manual',
                             version=version+1, last_op_occurred_at=occurred_at, updated_at=now
                             WHERE tenant_id=? AND product_id=? AND version=?
       e. success -> break (outcome='applied')
       f. UNIQUE(admin_idempotency_key) violation -> concurrent same key -> re-read by key -> replay/conflict
       g. UNIQUE(tenant,product,prev_projection_version) or UNIQUE(payment_ref_key) violation
          -> concurrent other op -> retry
       h. retries exhausted -> { outcome:'contention' } (caller -> 503)
  7. post-commit best-effort: safeUserAudit('billing.grant.applied', immutable, {...})  // telemetry only, NOT evidence
  8. return outcome
```

### 5.4 Idempotency + evidence dedup (two layers)
- `admin_idempotency_key`: pre-check + `UNIQUE` backstop. Same key + same `request_hash` -> replay; same key + different hash -> 409 `IDEMPOTENCY_CONFLICT` (no mutation). Permanent (no TTL).
- Offline `payment_ref_key`: partial `UNIQUE WHERE manual_source='offline_payment'`. Same canonical key + a different idempotency key -> 409 `EVIDENCE_ALREADY_USED`. One offline payment = one grant (no split/allocation model).
- Formatting variants (case / whitespace / full-width / zero-width) collapse to the same `payment_ref_key` -> (same idempotency key) replay / (different key) 409.

### 5.5 fail-closed evidence strategy (atomicity)
- The evidence of record is the atomic append-only ledger row, written in the SAME `D1.batch()` as the projection. Any ledger-INSERT violation (CHECK / NOT NULL / any UNIQUE / append-only trigger) rolls back the entire batch -> the projection is unchanged -> no silent grant (fail-closed).
- Concurrency is fail-closed via statement error, not 0-row: `UNIQUE(tenant_id, product_id, prev_projection_version)` makes the second concurrent op at the same version hit the UNIQUE -> the whole batch rolls back -> retry re-reads the latest state (PR1/PR3 lesson: never rely on `changes()=0`, since a 0-row UPDATE is a success).
- `safeUserAudit` is demoted to non-authoritative telemetry (Discord/alerting); its swallow-on-failure is acceptable because the evidence already persisted in the ledger.
- No hash-chain (the architecture chains only `credit_ledger`; append-only trigger + atomic batch already deliver fail-closed). Tamper-evidence hash-chaining is a future hardening; Stage 0 confirms the non-chained design is sufficient.

### 5.6 Projection reconstructable from ledger (SoT holds)
For each `(tenant_id, product_id)`: take the latest op (max `prev_projection_version`) -> `status=to_status`, `plan_id`, `granted_via=trigger`, `last_op_occurred_at=occurred_at`, `version = prev_projection_version + 1`. No projection field is absent from the ledger -> the SoT claim holds (verified by Section 10 tests).

---

## 6. Stage 0 mandatory spike (pre-implementation hard gate; throwaway / unshipped)

Mirrors PR3's mandated D1 batch-rollback spike (memory `feedback_spike_overrides_design_spec` / `feedback_dont_assert_runtime_semantics_without_verify`). Exit criteria:
1. A raising statement (UNIQUE / CHECK / NOT NULL / trigger `RAISE`) inside `batch()` rolls back the projection write in the same batch (assert projection unchanged).
2. `UNIQUE(tenant_id, product_id, prev_projection_version)` serializes two concurrent same-version grants (exactly one applies; the loser fully rolls back).
3. `UNIQUE(admin_idempotency_key)` race -> one applies, loser rolls back -> re-read yields replay/conflict.
4. `uq_gpo_offline_payment_ref_key` partial-unique race -> one applies, loser rolls back -> EVIDENCE_ALREADY_USED.
5. Append-only `UPDATE/DELETE` triggers `RAISE` and abort within a batch.
6. Confirm a 0-row `UPDATE` is a success (does NOT roll back) -- proving why correctness relies on the ledger UNIQUE, not the UPDATE's `changes()`.
7. (optional only, not required) Whether a SQLite `GENERATED ... STORED` column can derive `payment_ref_key` in D1; default remains app-computed.

Implementation may not begin until Stage 0 passes.

---

## 7. Authorization

- Scopes (`functions/utils/scopes.ts`): add `SCOPES.ADMIN_BILLING='admin:billing'` (coarse), `ADMIN_BILLING_GRANT='admin:billing:grant'` (fine); `SCOPE_HIERARCHY[ADMIN_BILLING]=[ADMIN_BILLING_GRANT]` (`:revoke` reserved for the future revoke PR). Add `ELEVATED_BILLING='elevated:billing'` to `KNOWN_ELEVATED_SCOPES`.
- Step-up: a manual grant must pass `requireStepUp(SCOPES.ELEVATED_BILLING, 'grant_plan')` (separated from the payment-refund `elevated:payment`; the `for_action` binding prevents cross-use).
- Role mapping (`ROLE_BASE_SCOPES`):
  - `admin` / `developer` / `super_admin` -> `admin:billing` (coarse).
  - `finance` -> `admin:billing:grant` (fine, latent) -- OWNER DECISION, see Section 15.
  - `support` -> none (read-only; may read its own tenant's entitlements via membership, cannot grant).
- The endpoint gate mirrors `admin/payments/intents/[id]/refund.ts`: first `requireStepUp(...)`, then `effectiveScopesFromJwt(user).has('admin:billing:grant')`.

---

## 8. API contract

### 8.1 `POST /api/admin/billing/grant`
- Auth: `requireStepUp(ELEVATED_BILLING,'grant_plan')` + `admin:billing:grant`.
- Body (strict allowlist validation, inline, no Zod): the ONLY accepted fields are `{ tenant_id, product_id, plan_id, manual_source, admin_idempotency_key, payment_ref?, grant_reason? }`. Any field outside this allowlist -> 400 `ERR_VALIDATION`. In particular `occurred_at` in the body -> 400 `ERR_VALIDATION` (it is server-generated only, never client-provided). Do not silently ignore unknown fields.
- Outcome -> HTTP: `applied`->200 / `replay`->200 / `conflict`->409 `IDEMPOTENCY_CONFLICT` / `evidence_conflict`->409 `EVIDENCE_ALREADY_USED` / `stale_rejected`->409 / validation failure->400 `ERR_VALIDATION` | `INVALID_PAYMENT_REF` / eligibility failure->422 `TENANT_INELIGIBLE` | `PRODUCT_INACTIVE` | `PRODUCT_TENANT_TYPE_MISMATCH` | `PLAN_INVALID` / authz->403 / `contention`->503.
- per-user rate limit (reuse existing infra, aligned with architecture Section 13 write-path limiting).

### 8.2 `GET /api/tenants/:tenantId/entitlements`
- Auth: `requireRegularAccessToken` + active-membership check on `:tenantId` (`resolveIssuanceContextForTenant`).
- Flow: returns that tenant's projection rows (caller must be an active member); ignores any client-supplied tenant filter (cross-tenant isolation = acceptance gate).
- DTO: `{ entitlements: [{ product_id, plan_id, status, granted_via }] }` (serializer, no raw-row dump).

Both use the flat `res({error,code})` + traceId envelope (codebase-consistent).

---

## 9. Observability / audit

- The fail-closed evidence is the ledger (Section 5.5); `safeUserAudit` is non-authoritative telemetry.
- New audit events (registered in `audit-policy.ts` in the same PR per memory `feedback_audit_classification`; update `_registrySize` and the `audit-policy.test.ts` count to avoid the PR1 red-CI incident):
  - `billing.grant.applied` (immutable)
  - `billing.grant.denied` (security_signal) -- eligibility / authz / validation failures
  - `billing.grant.idempotent_replay` (telemetry)
  - `billing.grant.conflict` (security_signal) -- 409 IDEMPOTENCY_CONFLICT
  - `billing.grant.evidence_conflict` (security_signal) -- 409 EVIDENCE_ALREADY_USED
- Logs carry traceId; deny responses return only code + traceId (no internal detail). Granter email/role is staff audit identity (not customer PII).

---

## 10. Test plan (`tests/integration/billing-entitlement.test.ts`)

`_setup.sql` adds the 4 tables (CREATE IF NOT EXISTS, with all CHECK/UNIQUE/triggers) + the `resetDb` DELETE list; `_helpers.ts` adds `seedProduct` / `seedPlan` / `seedEntitlement` + a low-level seeder able to construct reserved states (`pending`/`expired`/`revoked`) for guard tests.

**Migration / schema**
1. Migration round-trip: up -> 4 tables + seeds present; down -> gone; up re-run idempotent.
2. Schema CHECKs: a payment-row carrying any manual evidence (actor / idempotency / offline / override / `payment_event_ref`) -> rejected; `offline_payment` with `grant_reason` -> rejected; `admin_override` with `payment_ref`/`payment_ref_key` -> rejected; invalid `from_status`/`to_status` -> rejected; empty evidence (`payment_ref` = three spaces / `grant_reason` = empty string) -> rejected by both DB CHECK and app.

**Idempotency / evidence**
3. Replay: same `admin_idempotency_key` + same params -> prior result (200).
4. Conflict: same key + different params -> 409 `IDEMPOTENCY_CONFLICT`, no mutation.
5. Duplicate `payment_ref_key`: ref `"ABC 123"` (key K1) applies; ref `" abc123 "` (different idempotency key) -> 409 `EVIDENCE_ALREADY_USED`; bypassing the pre-check, the partial unique still rolls back.
6. Variant + same idempotency key -> replay (not conflict), because request_hash uses the canonical key.

**Canonicalization (the test source writes every non-ASCII sample as a backslash-u escape sequence -- no literal glyphs, mojibake-proof)**
7. Case/space: `"ABC 123"` vs `"abc123"` -> key `ABC123` -> 409.
8. Full-width (NFKC): input = the full-width forms at code points U+FF21 U+FF22 U+FF23 U+FF11 U+FF12 U+FF13 (i.e. full-width "ABC123") -> after NFKC -> key `ABC123` -> 409.
9. Zero-width / Unicode whitespace inserted between ABC and 123 -- each of U+200B (ZWSP), U+00A0 (NBSP), U+3000 (ideographic space), U+FEFF (BOM), U+2060 (word joiner) -> canonical key `ABC123` -> 409.
10. Invalid chars: `"ABC#123"`, `"abc/123"`, an emoji, a CJK string -> 400 `INVALID_PAYMENT_REF` (nothing stored).
11. Length: trimmed display length 201 -> 400 (NOT truncated; assert no ledger row); display length 200 accepted (if its key also satisfies `{3,80}`); key length < 3 (e.g. `"AB"`) and > 80 -> 400; key length 3 and 80 accepted.
12. Determinism: same raw input -> identical `key` across calls (no locale dependence).

**Actor snapshot**
13. Persisted: manual grant by admin A -> ledger row has `granted_by=A.id`, `granted_by_email`, `granted_by_role` exactly snapshotted.
14. Survives mutation/deletion: after the grant, change A's email/role and delete A's account -> the ledger row is unchanged (immutability + no-FK survival + the append-only trigger does not block the user delete since there is no FK cascade into the ledger).

**Tenant boundary / eligibility**
15. Cross-tenant read isolation: user belongs to A not B -> `GET /api/tenants/:B/entitlements` -> 403; the list never leaks another tenant.
16. Tenant eligibility: ERP (org-only) grant to a personal tenant -> 422 `PRODUCT_TENANT_TYPE_MISMATCH`; senior-app (any) grant to personal -> applies; suspended/closed tenant -> `TENANT_INELIGIBLE`.

**State machine / concurrency / rebuild**
17. version-UNIQUE concurrency: two same-version grants -> exactly one applies, loser retries (eventually consistent, no drift).
18. Projection rebuild from ledger: produce N grant ops, replay the ledger to rebuild the projection, assert it equals the live projection (status / plan_id / granted_via / version / last_op_occurred_at).
19. revoked->active: seed projection='revoked' -> manual grant -> applies (intentional reinstatement; ledger records from_status='revoked').

**Other**
20. audit-policy registry: all 5 `billing.grant.*` classified (no unclassified warn); `_registrySize` / `audit-policy.test.ts` count updated.
21. occurred_at server-only / strict body allowlist: a body that sets `occurred_at` -> 400 `ERR_VALIDATION` (rejected, NOT ignored); a body carrying any unknown/unexpected field -> 400 `ERR_VALIDATION`; a valid body stores the server-generated `occurred_at`.
22. Stage 0 spike acceptance (Section 6 all 6 required items; the optional generated-column probe recorded separately).

> Each negative test must fail pre-impl and pass post-impl (memory `feedback_regression_test_must_lock_exact_failure`).

---

## 11. Architecture-doc drift override (authoritative)

This PR2 plan is authoritative over the stale sketch lines in `docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md` Sections 5/7. Implementation must NOT follow these superseded fields:

| Stale architecture sketch | PR2 plan (authoritative) |
|---|---|
| `grant_plan_operations.period_start/period_end` (Section 5) | Dropped -- Option B permanent access; PR2 has no period |
| `UNIQUE(provider, provider_event_id)` for payment dedup (Sections 5/7) | Replaced by payment-OBJECT dedup `UNIQUE(payment_intent_id)`; `event_id` is trace-only (`payment_event_ref`), never a uniqueness key |
| `grant_plan_operations.audit_id` (Section 5) | Dropped -- the ledger row is self-describing fail-closed evidence + actor snapshot; no external `audit_id` |

(This table is embedded here so implementers do not regress to the old Section 5 sketch.)

---

## 12. Commit plan

0. Stage 0 spike (throwaway / unshipped) -> Section 6 exit criteria all pass -> release gate.
1. migration + seed + test scaffold -- `0048` up/down (4 tables, full ledger shape incl. unwritten payment columns), `_setup.sql` + `_helpers.ts` (seeders + reserved-state low-level seeder). Zero runtime change.
2. billing domain module `functions/utils/billing.ts` -- `grantPlan`(manual), `ALLOWED_TRANSITIONS`, `canonicalizePaymentRef`, request_hash, idempotency, atomic-batch, structured outcomes; unit/integration (transitions / idempotency / evidence / concurrency / canonicalization).
3. scopes + audit-policy -- `admin:billing[:grant]` + `elevated:billing` + role map; register the 5 `billing.grant.*` (and update `_registrySize`).
4. endpoints -- `POST /api/admin/billing/grant` + `GET /api/tenants/:tenantId/entitlements` + guards + per-user rate limit + audit.
5. acceptance tests -- all Section 10 cases.

Each step: `typecheck:ratchet` + lint + `npm run test:int` green; `git diff --stat` self-check; the commit-quality hook uses the governance/PowerShell path when needed (not `--no-verify`; memory `feedback_claude_code_hook_bash_matcher_bypass`). Pure backend, no `public/` asset -> no cache-bust. Follow the two-gate workflow (memory `feedback_codex_review_workflow`): Gate 1 done -> code -> Gate 2 -> push.

---

## 13. File list (estimated)

**New**
- `migrations/0048_billing_entitlement.sql` + `migrations/down/0048_billing_entitlement.down.sql`
- `functions/utils/billing.ts` (`grantPlan` / `canonicalizePaymentRef` / enums / outcomes)
- `functions/api/admin/billing/grant.ts`
- `functions/api/tenants/[tenantId]/entitlements.ts`
- `tests/integration/billing-entitlement.test.ts`
- (Stage 0) throwaway spike file (unshipped; deleted after verification)

**Modified (minimal diff)**
- `functions/utils/scopes.ts` (+`admin:billing[:grant]` / `elevated:billing` / role map)
- `functions/utils/audit-policy.ts` (+5 `billing.grant.*`)
- `tests/integration/_setup.sql`, `tests/integration/_helpers.ts` (4 tables + seeders)
- `tests/audit-policy.test.ts` (`_registrySize` count)

**Do not touch**: the 8 token signing points (no claim delta), `functions/api/webhooks/payments/[vendor].ts` (payment wiring deferred), chiyigo-core.

---

## 14. Deploy / migration-ordering note (PR1 lesson)

PR1's merge triggered a GitHub Action auto-deploy (NOT a purely manual Direct Upload), but `0047` had not been applied first -> prod auth signing broke for ~7-15 min. Therefore, before/at PR2 merge, `0048` MUST be applied first via `wrangler d1 migrations apply chiyigo_db --remote` (owner runs it or authorizes each step explicitly, auditable), then the deploy may take effect. New tables + code in the same PR that uses them -> migration-before-deploy (memory `reference_pages_deploy_with_d1_migration`). PR2's endpoints are new paths (not an existing hot path), so the risk is lower than PR1's, but the ordering still holds.

---

## 15. Remaining owner decisions (product, not implementation blockers)

1. Whether `finance` gets `admin:billing:grant` (latent; prod currently has only super_admin). Proposed: grant it (finance confirms offline payments). Confirm, or restrict to super_admin/developer.
2. Per-product tenant compatibility seed: ERP=`organization`, senior-app=`any`. Confirm.
3. Real plan catalog / pricing (business input): PR2 seeds placeholders; the real catalog can be added later as data-only.
4. One offline payment = one grant (no split/allocation). Confirm acceptable.

---

*Plan complete. Gate 1 approved (contract through Rev 3.3). Next step = Stage 0 spike (hard gate) -> implement -> Gate 2 -> migration-before-deploy -> push.*
