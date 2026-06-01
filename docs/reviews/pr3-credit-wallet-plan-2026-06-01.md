# PR3 -- Credit Wallet + Per-Product Quota + Ledger (Implementation Plan)

- **Created**: 2026-06-01
- **Work tier**: L3 (extends the Billing/Entitlement bounded context) + high-risk financial domain (`deductCredits` = atomic credit/quota state mutation). High-risk-domain surcharge applies (Distributed State + financial correctness).
- **Status**: DRAFT for Codex Gate 1 (plan review). The mandatory D1 batch-rollback spike for PR3 is **already DONE and Codex-APPROVED** (16/16, real D1/miniflare, 2026-05-31) -- see Section 2. No second spike is required; implementation may begin once this plan passes Gate 1.
- **Owner decision baseline**: architecture decision (3) -- **single tenant wallet + per-product quota** (NOT per-product wallet).
- **Upstream design**: `docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md` Sections 5 / 7 / 20 (codex r5 approved). This plan realizes "PR3 = Credit Wallet + Quota + Ledger" and, where it deviates from the architecture sketch, the deviations are listed in Section 11 (drift-override).
- **HEAD baseline**: `origin/main@d06f7d1` (PR2 shipped at `f4c267b`; latest migration `0048`) -> new migration = **`0049`**.
- **Prerequisites (live)**: PR1 Tenant Foundation (`tenants` / `organization_members` / token `tenant_id`+`platform_role` / `requireRegularAccessToken`) and PR2 Billing/Entitlement (`products` / `plans` / `tenant_product_access` / `grant_plan_operations`; scopes `admin:billing[:grant]` + `elevated:billing`; audit `billing.grant.*`).

> Encoding note: this document is intentionally pure ASCII (same rule as the PR2 plan). Unicode code points, where referenced, are written in `U+XXXX` notation; real implementation/test source uses the actual characters via backslash-u escapes.

> NAMING TRAP (do not conflate): PR3's credit wallet = `credit_wallets` / `product_usage_quota` / `credit_ledger`. These are UNRELATED to the existing `user_wallets` / `wallet_nonces` (web3 EIP-1193 crypto-wallet login, migration 0023). Two different "wallet" concepts; never cross-reference them. The existing `elevated:wallet_op` scope belongs to the web3 wallet and MUST NOT be reused for credit operations (see Section 7).

> **Gate-1 round-1 resolution log (codex Reject -> addressed; 2026-06-01).** Codex rejected round 1 with 3 migration-baked findings; all fixed in this revision:
> 1. **Critical -- `setProductQuota` had no authoritative trail** (relied on swallow-on-failure `safeUserAudit`; old/new was racy endpoint read-before-write). **Fix:** new append-only `quota_config_ledger` table (Section 4.4) written in the SAME `D1.batch()` as the cap UPSERT, with `old_limit` captured by an in-batch subquery; `billing.quota.set` audit demoted to telemetry. Tests 15/15b/15c.
> 2. **Idempotency UNIQUE too coarse** (`(tenant_id, idempotency_key)` would false-conflict cross-product / admin-vs-product keys). **Fix:** widened to `(tenant_id, idempotency_scope, idempotency_key)` with domain-derived scope `product:<id>` / `manual:topup` / `manual:adjust` on `credit_ledger` (Sections 4.3, 5.1). Test 5b. (Round 2 extended the same scoped-idempotency pattern to `quota_config_ledger` with `manual:quota_set:<productId>:<period>` -- see the round-2 log below; the authoritative scope list is Section 5.1.)
> 3. **Ledger snapshot columns lacked value invariants** (raw insert could write `balance_after=-1` etc.). **Fix:** named VALUE-invariant CHECKs on `credit_ledger` (Section 4.3): non-negative balance/quota, `quota_used_after <= quota_limit_after`, sane ceiling. Tests 2b/2c.
>
> **Gate-1 round-2 resolution log (codex Reject Round 2 -> addressed; 2026-06-01).** Round 2 surfaced 2 more (the first introduced BY the round-1 quota_config_ledger fix); both fixed:
> 1. **Critical -- `setProductQuota` not idempotency-keyed, but now writes an AUTHORITATIVE trail** -> a timeout+retry would append a spurious second `quota_config_ledger` row (e.g. `20->20`), polluting the financial-limit SoT (and contradicting the "idempotent PUT" wording). **Fix:** `quota_config_ledger` gains `idempotency_scope`/`idempotency_key`/`request_hash` + `UNIQUE(tenant_id, idempotency_scope, idempotency_key)`; `setProductQuota` takes `adminIdempotencyKey` with replay/conflict semantics (Sections 4.4, 5.5, 8.3). Scope `manual:quota_set:<productId>:<period>`. Tests 15d.
> 2. **`period` missing from deduct `request_hash` + no domain rejection.** **Fix:** PR3 domain hard-rejects `period !== 'lifetime'` (UNSUPPORTED_PERIOD) in both `deductCredits` and `setProductQuota`; `period` added to the deduct `request_hash` so a future monthly-period rollout cannot false-replay across periods (Sections 5.1, 5.2, 5.5, 8.3). Tests 9b, 15e.
> All three are baked into migration 0049's first version (no later rebuild). Self-reviewed again post-fix.

---

## 1. Scope

**In scope (PR3)**
1. `migrations/0049_credit_wallet.sql` (+down): 4 tables -- `credit_wallets` (tenant balance), `product_usage_quota` (per-product usage cap), `credit_ledger` (append-only credit movement ledger = SoT), `quota_config_ledger` (append-only authoritative trail of quota-cap changes; codex Gate-1 finding 1). Full ledger shape lands now (including columns reserved for deferred features), because SQLite cannot `ALTER` a table-level CHECK and these are append-only financial tables (same PR2 lesson).
2. `functions/utils/credit.ts` domain module:
   - `deductCredits` -- the Tier-0 atomic core (wallet decrement + quota increment + ledger insert in one `D1.batch()`); fail-closed via CHECK / NOT NULL / UNIQUE rollback (NOT `changes()`).
   - `topUpCredits` (manual admin) -- add credits to a tenant wallet (UPSERT-creates the wallet).
   - `adjustCredits` (manual admin) -- signed wallet correction with reason.
   - `setProductQuota` (manual admin) -- create/raise/lower a product's quota cap; writes the authoritative `quota_config_ledger` in-batch (does NOT write the credit movement ledger).
   - shared helpers: strict input validation (amount = positive integer; codex r5 forward note), `request_hash`, idempotency pre-check, bounded retry, structured outcomes.
3. Admin endpoints (manual ops; mirror `admin/billing/grant.ts` double-gate):
   - `POST /api/admin/billing/wallets/:tenantId/topup`
   - `POST /api/admin/billing/wallets/:tenantId/adjust`
   - `PUT  /api/admin/billing/quotas/:tenantId/:productId`
4. Tenant-scoped read `GET /api/tenants/:tenantId/wallet` (balance + quotas; regular token + tenant guard; no ledger dump).
5. Scopes (`admin:billing:wallet` fine under `admin:billing` hierarchy; reuse `elevated:billing` step-up with new `for_action` values) + audit-policy registration + per-user rate limit (`billing_wallet`).
6. Full test suite: migration round-trip, deduct atomicity/idempotency/concurrency/boundaries, topup/adjust/setQuota, DB CHECK negatives, ledger reconciliation invariant, endpoint auth/validation/audit, cross-tenant isolation.

**Out of scope (explicitly deferred to later PRs)**
- **Product-facing deduct endpoint** (the HTTP path products call to report usage). `deductCredits` the DOMAIN is fully implemented + tested in PR3, but the endpoint is deferred to RP integration: no product caller exists yet, and the RP-facing token contract for `tenant_id` / `product_id` is an open blocker (architecture "RP-facing token contract gap" #1-#3). This mirrors PR2 landing `grantPlan` while deferring the payment-trigger code path. See Section 12 for the owner/codex confirm item and the alternative (interim admin deduct endpoint).
- **Credit-ledger hash-chain (tamper-evidence)** -- deferred to future hardening with a reasoned deviation (Section 5.7); correctness fail-closed comes from atomic batch + constraints, not a chain.
- **Auto-provisioning credits/quota on `grantPlan`** -- wiring PR2's grant into a wallet top-up / quota set is a separate PR (it would modify the already-shipped grant batch; first-do-no-harm). PR3 keeps wallet/quota provisioning as explicit manual admin ops.
- **Payment-triggered top-up** (buying credits via checkout) -- schema-ready (`source='payment'` enum + ledger columns) but unwritten; lands when a credit-purchase flow exists.
- **`refund` operation** -- enum value reserved/schema-ready only (like PR2's reserved `revoked`/`expired`); the operation that produces it is deferred.
- **Reconciliation JOB** -- the invariant is asserted by a test now; the periodic drift-detection job lands when real credit flow exists (per the standing "defer financial smoke" owner decision, 2026-05-14).
- **Time-bucketed quota periods** (`YYYY-MM` monthly reset) -- the `period` column lands now (forward-compat, avoids a future CHECK rebuild) but PR3 produces only the single constant period `'lifetime'`.
- **Adding a `credit_balance` / `quota` claim to access_token** -- products query the wallet API; nothing enters the token (architecture JWT-claim-policy).

---

## 2. Stage 0 spike -- ALREADY DONE + Codex APPROVED (no re-spike needed)

The architecture (Section 5) mandated a D1 batch-rollback spike before PR3 wallet implementation. It was run and approved:

- 2026-05-31, throwaway/unshipped (deleted, never committed), real D1 via miniflare, **16/16 tests incl. E3 concurrent quota oversubscription**.
- Verified empirically (the exact invariants this plan relies on):
  1. A raising statement (CHECK / NOT NULL / UNIQUE) inside `batch()` rolls back ALL prior statements in the same batch (incl. the wallet/quota updates) -- fail-closed.
  2. CHECK `balance >= 0` turns an over-deduct into a statement error -> rollback (insufficient).
  3. CHECK `quota_used <= quota_limit` turns an over-quota into a statement error -> rollback.
  4. NOT NULL `*_after` columns fed by scalar subqueries catch a **missing wallet/quota row** (0-row UPDATE is a SUCCESS, not a rollback -> the subquery returns NULL -> NOT NULL violation -> rollback).
  5. `UNIQUE` idempotency key serializes concurrent same-key ops (loser's batch fully rolls back).
  6. Relative update (`balance = balance - ?`) + CHECK is concurrency-safe under D1 write serialization WITHOUT a version-CAS retry loop.
  7. A 0-row `UPDATE` is a success (`changes()=0`) and does NOT roll back -- proving correctness must rely on the ledger UNIQUE / `*_after` NOT NULL, never on `changes()`.
- Scope of the spike = the `deductCredits` atomic subset (batch rollback / CHECK / NOT NULL subquery / UNIQUE / relative-update concurrency). NOT covered by the spike (and not assumed): full schema FK/trigger/outbox/backstop, hash-chain. Design confirmed; zero overturned assumptions.
- **The `quota_config_ledger` in-batch write (Section 5.5, added in Gate-1 round 2) uses the SAME verified mechanism as spike criterion 1** (a raising statement -- here the cap UPSERT's `quota_used <= quota_limit` CHECK -- rolls back the prior in-batch ledger INSERT). It introduces no new untested primitive: it is ledger-INSERT + UPSERT in one batch, identical in shape to the deduct's ledger-INSERT + UPDATE that the spike exercised. A targeted test (15b) re-confirms the rollback for this specific pair.

Memory: `feedback_spike_overrides_design_spec` / `feedback_dont_assert_runtime_semantics_without_verify`. Because the spike is done and approved, **PR3 implementation is unblocked** pending this plan's Gate 1.

---

## 3. Current-state grounding (verified against HEAD `d06f7d1`)

- **Greenfield for credit**: no `credit_wallets` / `product_usage_quota` / `credit_ledger` / `quota_config_ledger` tables exist; `tests/integration/_setup.sql` ends at PR2's `grant_plan_operations`. The only "wallet" tables are the web3 `user_wallets` / `wallet_nonces` (0023) -- unrelated (naming trap above).
- **PR2 assets reused (do not reinvent)**:
  - Atomic-batch + structured-outcome + idempotency + request_hash + bounded-retry: `functions/utils/billing.ts` (`grantPlan`).
  - Admin + step-up double gate: `functions/api/admin/billing/grant.ts` (`requireStepUp(ELEVATED_BILLING, <for_action>)` then `effectiveScopesFromJwt(user).has(<fine scope>)`); server-derived actor from `users` row; strict body allowlist.
  - Tenant-scoped read guard: `functions/api/tenants/[tenantId]/entitlements.ts` (`requireRegularAccessToken` + `resolveIssuanceContextForTenant`).
  - Scopes: `functions/utils/scopes.ts` (`SCOPES`, `SCOPE_HIERARCHY`, `ROLE_BASE_SCOPES`, `KNOWN_ELEVATED_SCOPES`, `effectiveScopesFromJwt`). PR2 already added `ADMIN_BILLING` / `ADMIN_BILLING_GRANT` / `ELEVATED_BILLING`.
  - Audit registry: `functions/utils/audit-policy.ts` (warn-on-missing; `_registrySize` currently **179** after PR2's 5 `billing.grant.*`). `tests/audit-policy.test.ts` asserts the count.
  - Rate limit: `functions/utils/rate-limit.ts` (`RateLimitKind` union; `checkRateLimit` / `recordRateLimit`; D1 `login_attempts` bucket). PR2 added `'billing_grant'`.
  - Test scaffold: `tests/integration/_helpers.ts` (`seedUser`/`seedTenant`/`seedMembership`/`seedProduct`/`seedPlan`/`seedEntitlement` + `resetDb` DELETE list) + `_setup.sql` (CREATE IF NOT EXISTS) + `tests/integration/migrations.test.ts` (`ALL_UPS` / `EXPECTED_TABLES` / `EXPECTED_COLUMNS` / count assertions).
- **TS pitfall carried from PR2** (will recur in PR3 endpoints): Pages Function `env` is untyped -> `db.first<{...}>()` generic raises TS2347, and under functions `tsconfig` `strict:false`, D1 row `unknown` values do not narrow across statements. Fix the same way: `Env['chiyigo_db']` indexed type for the db param; `String(row?.x ?? '')` / in-place `typeof` narrowing at the assignment site. (memory `feedback_ts_no_jsdoc_in_ts_mode`)

---

## 4. Data model -- `migrations/0049_credit_wallet.sql` (expand-only, idempotent)

> Full shape lands now. SQLite cannot `ALTER` a table-level CHECK, so the amount-sign CHECK and the `*_after` NOT NULL columns must exist from day one; adding them later would force a rebuild of a populated append-only financial table (forbidden destructive migration). Columns that are merely nullable and not part of any CHECK (e.g. a future hash-chain pair) are intentionally NOT created now and can be added later via a plain `ALTER ADD COLUMN` (Section 5.7).

### 4.1 `credit_wallets` (single wallet per tenant; mutable balance)
```sql
CREATE TABLE IF NOT EXISTS credit_wallets (
  tenant_id  INTEGER PRIMARY KEY REFERENCES tenants(id),
  balance    INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),   -- NOT NULL: SQLite CHECK passes on NULL
  version    INTEGER NOT NULL DEFAULT 0,                        -- reserved for admin-adjust optimistic lock; deduct does NOT use CAS
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### 4.2 `product_usage_quota` (per-product usage cap; mutable quota_used)
```sql
CREATE TABLE IF NOT EXISTS product_usage_quota (
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  product_id  TEXT    NOT NULL REFERENCES products(id),
  period      TEXT    NOT NULL,                                  -- PR3 produces only 'lifetime'; column reserved for future 'YYYY-MM'
  quota_limit INTEGER NOT NULL CHECK(quota_limit >= 0),
  quota_used  INTEGER NOT NULL DEFAULT 0
                      CHECK(quota_used >= 0 AND quota_used <= quota_limit),  -- over-quota deduct -> statement error -> rollback
  version     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, product_id, period)
);
CREATE INDEX IF NOT EXISTS idx_puq_tenant ON product_usage_quota(tenant_id);
```

### 4.3 `credit_ledger` (append-only credit movement ledger = SoT + fail-closed evidence)
```sql
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  product_id  TEXT    REFERENCES products(id),       -- NOT NULL for deduct (CHECK below); NULL for wallet-level topup/adjust
  entry_type  TEXT    NOT NULL CHECK(entry_type IN ('topup','deduct','refund','adjust')),
  amount      INTEGER NOT NULL CHECK(amount <> 0),   -- signed; per-entry_type direction enforced below (codex r5)
  -- post-state snapshots: fed by scalar subqueries reading the just-updated rows in the SAME batch.
  -- balance_after NOT NULL always (every entry moves the wallet); missing wallet row -> subquery NULL -> rollback.
  balance_after     INTEGER NOT NULL,
  -- quota_* only for deduct (the only entry that touches quota); NOT NULL enforced by the deduct CHECK below.
  quota_used_after  INTEGER,
  quota_limit_after INTEGER,
  quota_period      TEXT,                            -- the period row a deduct targeted (NOT NULL for deduct)
  -- idempotency_scope isolates key spaces (codex Gate-1 finding 2): 'product:<id>' for deduct,
  -- 'manual:topup' / 'manual:adjust' for wallet ops, '<...>' for future sources. So two products reusing
  -- the same event id, or an admin key colliding with a product event key, do NOT false-conflict.
  idempotency_scope TEXT    NOT NULL,
  idempotency_key   TEXT    NOT NULL,
  request_hash      TEXT    NOT NULL,
  ref               TEXT,                            -- free-form caller reference (e.g. product usage event id); bounded
  source            TEXT    NOT NULL CHECK(source IN ('manual','product','payment')),
  -- actor snapshot for manual entries: NO FK (ledger must outlive the user row; AUTOINCREMENT ids never reused).
  actor_id          INTEGER,
  actor_email       TEXT,
  actor_role        TEXT,
  occurred_at TEXT NOT NULL,                         -- SERVER-generated UTC ISO-8601 (new Date().toISOString()); never client-provided
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),  -- DB default; NOT used for ordering (format differs from occurred_at)

  -- scoped idempotency + concurrency backstop (codex finding 2); also the covering index for the pre-check lookup.
  UNIQUE(tenant_id, idempotency_scope, idempotency_key),

  -- amount sign direction (codex r5 forward note): topup/refund add, deduct subtracts; adjust either non-zero.
  CONSTRAINT ck_ledger_amount_topup  CHECK( entry_type <> 'topup'  OR amount > 0 ),
  CONSTRAINT ck_ledger_amount_refund CHECK( entry_type <> 'refund' OR amount > 0 ),
  CONSTRAINT ck_ledger_amount_deduct CHECK( entry_type <> 'deduct' OR amount < 0 ),
  -- deduct must carry product + a full quota snapshot (conditioning column entry_type is NOT NULL -> fires reliably).
  CONSTRAINT ck_ledger_deduct_snapshot CHECK( entry_type <> 'deduct' OR (
           product_id        IS NOT NULL
           AND quota_used_after  IS NOT NULL
           AND quota_limit_after IS NOT NULL
           AND quota_period      IS NOT NULL) ),
  -- snapshot VALUE invariants (codex Gate-1 finding 3): a raw insert must NOT record an impossible post-state
  -- (negative balance/quota, or used > limit). Migration-baked because a table-level CHECK cannot be added later
  -- without a rebuild. NULL-guarded so wallet-level rows (NULL quota_*) pass.
  CONSTRAINT ck_ledger_balance_after_nonneg CHECK( balance_after >= 0 ),
  CONSTRAINT ck_ledger_quota_used_nonneg    CHECK( quota_used_after  IS NULL OR quota_used_after  >= 0 ),
  CONSTRAINT ck_ledger_quota_limit_nonneg   CHECK( quota_limit_after IS NULL OR quota_limit_after >= 0 ),
  CONSTRAINT ck_ledger_quota_used_le_limit  CHECK( quota_used_after IS NULL OR quota_limit_after IS NULL OR quota_used_after <= quota_limit_after ),
  -- corruption tripwire (NOT a business limit): a generous absolute ceiling catches a catastrophic typo / overflow.
  -- App layer also bounds each op at MAX_CREDIT_AMOUNT (Section 5.1).
  CONSTRAINT ck_ledger_balance_after_sane CHECK( balance_after <= 1000000000000 ),
  -- manual source must carry an actor snapshot; non-manual must NOT (mirror grant_plan_operations exclusivity).
  CONSTRAINT ck_ledger_manual_actor CHECK( source <> 'manual' OR (
           actor_id IS NOT NULL
           AND actor_email IS NOT NULL AND length(trim(actor_email)) > 0
           AND actor_role  IS NOT NULL AND length(trim(actor_role))  > 0) ),
  CONSTRAINT ck_ledger_nonmanual_no_actor CHECK( source =  'manual' OR (actor_id IS NULL AND actor_email IS NULL AND actor_role IS NULL) )
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_tenant         ON credit_ledger(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_tenant_product ON credit_ledger(tenant_id, product_id);

-- APPEND-ONLY: enforced at the app layer (credit.ts only ever INSERTs; no update/delete path), matching
-- audit_log (0017) / admin_audit_log / grant_plan_operations (0048) house style. The repo uses NO DB triggers
-- (migration + resetDb runners split on raw ';' and cannot carry a trigger body, AND comments here must contain
-- no ';'). Fail-closed correctness = atomic INSERT + relative updates via CHECK / NOT NULL / UNIQUE / D1.batch()
-- rollback (Stage 0 verified). Hash-chain tamper-evidence is future hardening (Section 5.7), not PR3.
```

### 4.4 `quota_config_ledger` (append-only authoritative trail of quota-cap changes; codex Gate-1 finding 1)
A quota-cap change is a financial-limit state change, so it needs un-droppable evidence -- NOT a swallow-on-failure `safeUserAudit`. This dedicated append-only ledger is written in the SAME `D1.batch()` as the `product_usage_quota` UPSERT (Section 5.5), so a cap change and its evidence are atomic (fail-closed: if the ledger insert fails, the cap change rolls back). The `old_limit` is captured atomically by an in-batch scalar subquery (NOT an endpoint read-before-write), eliminating the concurrent old/new race.
```sql
CREATE TABLE IF NOT EXISTS quota_config_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  product_id  TEXT    NOT NULL REFERENCES products(id),
  period      TEXT    NOT NULL,
  old_limit   INTEGER,                               -- NULL = first-ever set (no prior quota row); captured atomically in-batch
  new_limit   INTEGER NOT NULL CHECK(new_limit >= 0),
  -- durable idempotency (codex Gate-1 round-2 finding 1): a quota set is an external admin write; a network
  -- timeout + client retry must NOT append a second authoritative row (e.g. a spurious 20->20). Same shape as
  -- credit_ledger: domain-derived scope 'manual:quota_set:<productId>:<period>' + caller admin key + request_hash.
  idempotency_scope TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  -- actor snapshot (setProductQuota is always a manual admin op); NO FK (must outlive the user row).
  actor_id    INTEGER NOT NULL,
  actor_email TEXT    NOT NULL,
  actor_role  TEXT    NOT NULL,
  reason      TEXT,                                  -- optional bounded note
  occurred_at TEXT    NOT NULL,                      -- server-generated UTC ISO-8601
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, idempotency_scope, idempotency_key),  -- retry/replay backstop; also the pre-check covering index
  CONSTRAINT ck_qcl_old_nonneg   CHECK( old_limit IS NULL OR old_limit >= 0 ),
  CONSTRAINT ck_qcl_actor_present CHECK( length(trim(actor_email)) > 0 AND length(trim(actor_role)) > 0 )
);
CREATE INDEX IF NOT EXISTS idx_qcl_tenant_product ON quota_config_ledger(tenant_id, product_id, period, id);
-- APPEND-ONLY at the app layer (setProductQuota only INSERTs here), same discipline + no DB trigger as credit_ledger.
```

### 4.5 down migration (`migrations/down/0049_credit_wallet.down.sql`)
```sql
-- Rollback: DROP the 4 tables created by this migration (+ indexes).
-- Safe ONLY "after PR3 deploy but before any real credit movement / quota config exists" (no ledger rows => no data loss).
-- Once real credit_ledger / quota_config_ledger rows exist, rollback becomes forward-fix; DROP is forbidden.
-- The 4 tables only reference tenants/products (not each other), so drop order among them is free; listed child-style.
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS quota_config_ledger;
DROP TABLE IF EXISTS product_usage_quota;
DROP TABLE IF EXISTS credit_wallets;
```

### 4.6 No seeds
Wallets/quotas are tenant data, created by ops (topup / setQuota), not seeded. `resetDb` wipes them (Section 10). Unlike 0048, 0049 seeds nothing.

### 4.7 FK parent lifecycle (financial SoT)
`actor_id` intentionally has NO FK (actor evidence must survive user mutation/deletion). The other parents -- `tenant_id`, `product_id` -- KEEP their FKs for referential integrity. Because `credit_ledger` is append-only/immutable, once a row references a parent that parent MUST NOT be hard-deleted: use lifecycle patterns (tenant `status`, product `is_active`, soft-delete). A future feature needing physical parent deletion must first snapshot the referenced fields. (Same rule as `grant_plan_operations`.)

---

## 5. Domain logic + idempotency + fail-closed (`functions/utils/credit.ts`)

### 5.1 Shared rules
- **Amount validation (codex r5)**: every caller-supplied amount is validated as a **positive integer within bounds** (`typeof === 'number' && Number.isInteger && 0 < amount <= MAX_CREDIT_AMOUNT`, a named constant e.g. `1_000_000_000`, to stop a typo'd 9-figure deduct/topup) BEFORE any DB work. Quota caps use `MAX_QUOTA_LIMIT` (same magnitude; `0 <= quotaLimit <= MAX_QUOTA_LIMIT`, allowing 0 = "no usage permitted"). Both stay well under the ledger's `balance_after` sane-ceiling CHECK (Section 4.3) so a legitimate op never trips the corruption tripwire. The signed value stored in the ledger is derived by the domain from `entry_type`/direction (deduct -> `-amount`, topup/refund -> `+amount`, adjust -> `+amount` for credit / `-amount` for debit), never taken signed from the caller. The DB amount-sign CHECK (Section 4.3) is the backstop, not the primary guard.
- **Server-generated `occurred_at`** = `new Date().toISOString()`; a client/body-supplied `occurred_at` is rejected at the endpoint (strict allowlist), never used.
- **`request_hash`** = sha256 of a stable canonical JSON of the ACCEPTED semantic fields, using the **SIGNED effective amount** that will be written to the ledger (NOT the positive input magnitude): `{ tenant_id, product_id ?? '', entry_type, signed_amount, period, ref ?? '', source }`, EXCLUDING `idempotency_key`, actor, timestamps. Used for replay-vs-conflict discrimination (mirror `grantPlan`). `period` is included (codex round-2 finding 2) so that, when monthly periods are added later, the same key + same amount + DIFFERENT period is a `conflict`, never a false `replay`. (`setProductQuota` uses its own hash over `{tenant_id, product_id, period, new_limit, reason}` -- Section 5.5.)
  - **Why signed (correctness):** an `adjust credit 10` and an `adjust debit 10` reuse the same `entry_type='adjust'`; if the hash used the positive magnitude they would collide and a debit would be falsely classified as a *replay* of the credit. Hashing the signed value (`+10` vs `-10`) makes them distinct -> same key + opposite direction = `conflict` (409), not a silent replay. `entry_type` is also in the hash, separating deduct/topup/adjust/refund.
- **Idempotency** is **per-tenant + per-scope** (codex Gate-1 finding 2): `UNIQUE(tenant_id, idempotency_scope, idempotency_key)`. The domain derives `idempotency_scope` from the operation (NOT caller-supplied): deduct -> `'product:<productId>'`, topUp -> `'manual:topup'`, adjust -> `'manual:adjust'`, setProductQuota -> `'manual:quota_set:<productId>:<period>'` (the latter on `quota_config_ledger`, Section 5.5; future: `'payment:topup'` etc.). Pre-check by `(tenant_id, idempotency_scope, idempotency_key)`: hit + same `request_hash` -> `replay`; hit + different -> `conflict` (409); miss -> proceed. Concurrent miss is caught by the UNIQUE backstop inside the batch (loser rolls back -> re-read -> replay/conflict). Permanent (no TTL) -- financial idempotency (architecture Section 10).
  - **Why scoped (finding 2):** a flat `(tenant_id, key)` would false-conflict when two products under one tenant each emit `event-123`, or when an admin idempotency key collides with a product usage-event id. Scoping by `'product:<id>'` vs `'manual:topup'` vs `'manual:adjust'` vs `'manual:quota_set:<productId>:<period>'` isolates those key spaces. The scope is part of the unique constraint (migration-baked) AND of the pre-check lookup; `request_hash` still guards same-(scope,key) param drift.
- **No `changes()` reliance** anywhere for correctness (Stage 0 criterion 7). Concurrency + insufficiency + missing-row are ALL driven to statement errors by CHECK / NOT NULL / UNIQUE.
- **Bounded retry** (MAX 4): only the idempotency-UNIQUE path retries (re-read decides replay/conflict). Insufficient/over-quota/missing-row are deterministic failures -> no retry.
- Structured outcomes (caller/endpoint maps to HTTP), e.g.: `applied` / `replay` / `conflict` / `insufficient_balance` / `quota_exceeded` / `wallet_not_found` / `quota_not_found` / `tenant_ineligible` / `product_inactive` / `product_tenant_type_mismatch` / `invalid{code}` / `contention`.

### 5.2 `deductCredits` (Tier-0 atomic core) -- source 'product' (or 'manual' for admin test/correction)

> **Unit model (stated decision; codex/owner confirm item 7).** A deduct of `amount` consumes `amount` from the tenant wallet AND counts `amount` against the product's quota -- i.e. **quota is denominated in the same credit unit as the wallet**: `quota_limit` is a per-product sub-cap on how much of the shared balance that product may spend. This matches the architecture Section 5 sketch (one `?` bound feeds both the `balance -= ?` and `quota_used += ?` updates). It is the simplest coherent reading of "single tenant wallet + per-product quota" (decision 3). The alternative -- quota in product-native units (e.g. API calls) decoupled from credit cost -- would require the deduct to carry TWO magnitudes (`creditAmount` + `quotaUnits`); PR3 deliberately does NOT do that (YAGNI until a product needs it; adding a second magnitude later is an additive change to the domain signature, not a schema rebuild). Flagged as decision item 7.
>
> **`period` is PR3-fixed to `'lifetime'`.** Both `deductCredits` and `setProductQuota` hard-reject any other `period` value (UNSUPPORTED_PERIOD; codex round-2 finding 2). The `period` column + its presence in the deduct `request_hash` and the quota-set idempotency scope land now (forward-compat, no future CHECK rebuild), but the only value any PR3 op accepts is `'lifetime'`. Monthly/periodic quota is decision item 4.

```
deductCredits(db, { tenantId, productId, amount, idempotencyKey, ref, period='lifetime', source, actor? }):
  1. validate: tenantId/amount positive ints (0 < amount <= MAX_CREDIT_AMOUNT); productId non-empty string;
     period === 'lifetime' (else invalid:UNSUPPORTED_PERIOD -- PR3 single-period, finding 2);
     idempotencyKey non-empty bounded; ref bounded; source in {'product','manual'};
     if source='manual' actor{id,email,role} required, else actor must be absent.
     (amount is the positive magnitude; ledger stores -amount; quota_used += amount.)
  2. idempotency_scope = 'product:' + productId
     request_hash = sha256(canonicalJSON({ tenant_id, product_id, entry_type:'deduct', signed_amount:-amount, period, ref ?? '', source }))
  3. idempotency pre-check (tenant_id, idempotency_scope, idempotency_key): hit+same -> replay; hit+diff -> conflict; miss -> continue
  4. eligibility (server lookup; deterministic deny, no write):
       tenants: status='active' AND deleted_at IS NULL   else tenant_ineligible
       products: is_active=1                              else product_inactive
     (Eligibility blocks a deduct against a closed tenant / disabled product. NOTE: tenant_scope is
      NOT re-checked on deduct -- a quota row only exists because setProductQuota already verified
      scope at provisioning time; re-checking here would strand already-purchased credits if a product's
      scope were later changed. Scope is a provisioning-time gate, not a consumption-time gate.)
  4b. deterministic pre-check (precise outcome, no write -- see 5.2.1): read wallet + quota(tenant,product,period);
       wallet row absent -> wallet_not_found; quota row absent -> quota_not_found;
       balance < amount -> insufficient_balance; quota_used + amount > quota_limit -> quota_exceeded.
  5. bounded-retry loop (<=4):
       atomic batch (db.batch), order chosen so the cheapest-to-violate constraints fire first:
         S1: UPDATE product_usage_quota
               SET quota_used = quota_used + ?amount, version = version + 1, updated_at = datetime('now')
               WHERE tenant_id=? AND product_id=? AND period=?
             -> over-quota: CHECK(quota_used <= quota_limit) violation -> ERROR -> whole batch rollback (quota_exceeded)
             -> 0 row (quota row missing): SUCCESS (changes=0), NOT a rollback by itself -> caught at S3 by NULL subquery
         S2: UPDATE credit_wallets
               SET balance = balance - ?amount, version = version + 1, updated_at = datetime('now')
               WHERE tenant_id=?
             -> insufficient: CHECK(balance >= 0) violation -> ERROR -> rollback (insufficient_balance)
             -> 0 row (wallet row missing): SUCCESS, caught at S3 by NULL subquery
         S3: INSERT INTO credit_ledger
               (tenant_id, product_id, entry_type, amount,
                balance_after      = (SELECT balance FROM credit_wallets WHERE tenant_id=?),
                quota_used_after   = (SELECT quota_used  FROM product_usage_quota WHERE tenant_id=? AND product_id=? AND period=?),
                quota_limit_after  = (SELECT quota_limit FROM product_usage_quota WHERE tenant_id=? AND product_id=? AND period=?),
                quota_period       = ?period,
                idempotency_scope='product:<productId>', idempotency_key, request_hash, ref, source,
                actor snapshot if manual, occurred_at)
               amount bound = -(magnitude)
             -> duplicate (tenant_id, idempotency_scope, idempotency_key): UNIQUE violation -> ERROR -> rollback -> go to (6)
             -> wallet row missing: balance_after subquery = NULL -> NOT NULL violation -> rollback (wallet_not_found)
             -> quota row missing: quota_*_after subquery = NULL -> NOT NULL violation -> rollback (quota_not_found)
       success -> outcome 'applied' (read back balance_after / quota_used_after for the response)
       UNIQUE(tenant_id, idempotency_scope, idempotency_key) error -> re-read by (scope,key) -> replay/conflict (do NOT retry blindly)
       (no other UNIQUE exists on this table, so there is no version-slot retry; relative update is concurrency-safe)
  6. retries exhausted -> 'contention'
```
**Why this is atomic & correct (Stage 0-verified):** all three statements are in one `D1.batch()`. Any CHECK/NOT NULL/UNIQUE violation in S1/S2/S3 rolls back the ENTIRE batch -> wallet/quota are unchanged AND no ledger row -> fail-closed (no silent half-deduct). Insufficiency and over-quota are turned into statement errors by CHECK (not 0-row, not `changes()`). Missing wallet/quota rows are caught because a 0-row UPDATE is a SUCCESS, so the `*_after` scalar subqueries return NULL and hit the NOT NULL columns. Concurrency is safe because D1 serializes writes and the updates are relative (`balance - ?`, `quota_used + ?`); the same-key idempotency UNIQUE serializes duplicate requests.

> Distinction (`insufficient_balance` vs `wallet_not_found`): a wallet with balance 0 that exists fails the pre-check (insufficient) / S2's CHECK under race; a tenant with NO wallet row is `wallet_not_found` (pre-check, or S3's NULL subquery under race). Quota mirrors this (`quota_exceeded` when the row exists and is full vs `quota_not_found` when no row). Provisioning (topup / setQuota) creates the rows; a deduct against an unprovisioned tenant is a deterministic `*_not_found`, never a silent pass.

> Statement-ordering subtlety (why pre-check matters even though the batch is authority): in the batch, S1 increments `quota_used` and S2 decrements `balance` BEFORE S3 detects a missing row via NULL subquery. If only the quota row exists but the wallet row does not, S1 would succeed and S2 would be a 0-row no-op, then S3's `balance_after` NULL subquery raises and rolls back ALL of S1/S2 -> still fail-closed (no partial apply), correctly `wallet_not_found`. The batch alone is sufficient for safety; step 4b's pre-check just returns the precise outcome cheaply on the common (uncontended) path. Verified shape matches Stage 0 criteria 1+4.

### 5.2.1 Outcome discrimination WITHOUT error-message parsing (Tier-0 robustness)
A `D1.batch()` failure surfaces as a single thrown error. Mapping it to the right outcome (insufficient vs over-quota vs missing-row vs idempotency) by string-matching the error message is fragile (SQLite/D1 message text is version-dependent; memory `feedback_dont_assert_runtime_semantics_without_verify`). PR3 therefore does NOT branch control flow on the batch error message. Instead:
- **Deterministic pre-checks produce the precise outcome on the common path** (after eligibility, before the batch): read wallet + quota rows; if wallet row absent -> `wallet_not_found`; if quota row absent -> `quota_not_found`; if `balance < amount` -> `insufficient_balance`; if `quota_used + amount > quota_limit` -> `quota_exceeded`. These return immediately with no DB write.
- **The batch is the atomic apply + the concurrency safety net.** Its CHECK/NOT NULL/UNIQUE exist to catch the race where another writer changed balance/quota between this request's pre-check read and its write (Stage 0 proved the rollback). The batch is correctness; the pre-check is just for a precise, cheap outcome.
- **Catch handler (message-independent):** on a thrown batch error, ALWAYS log the original error object (with the named constraint, for observability), then classify by re-reading DB state, never by parsing the message. FIRST re-read by `(tenant_id, idempotency_scope, idempotency_key)`; if a row now exists -> `replay` (same `request_hash`) or `conflict` (different) -- this covers the concurrent same-key duplicate. If NO such row exists, the failure was a guard violation caused by a concurrent state change: re-read wallet/quota and re-run the deterministic pre-check classification -- if it now reports insufficient/over/missing, return that deterministic outcome (the concurrent op genuinely consumed the headroom = correct fail-closed result); otherwise treat as transient serialization and retry (up to MAX 4) -> `contention` if exhausted. (If the re-read classification comes back "clean" repeatedly without the batch succeeding, that is the contention path, not an infinite loop -- MAX 4 bounds it.)
- **Constraint naming for OBSERVABILITY only (not control flow):** the CHECK/UNIQUE/NOT NULL constraints are given explicit names (e.g. `CONSTRAINT ck_wallet_balance_nonneg`, `ck_quota_not_exceeded`, `ck_ledger_balance_after_present`) so logs/traces record which invariant tripped. Control flow never parses these names; they are forensic aids satisfying the observability requirement for the deduct-denied path (architecture Section 14).

This keeps every Tier-0 decision driven by re-readable DB state, not by string matching, while still giving precise HTTP codes on the hot path. (The same re-read-by-key idempotency discrimination is already the approved pattern in `grantPlan`.)

**Applies to all mutating credit ops.** `topUpCredits` / `adjustCredits` / `setProductQuota` all use the identical message-independent catch (re-read by `(tenant_id, idempotency_scope, idempotency_key)` -> replay/conflict FIRST; then op-specific classification: adjust re-reads wallet for `insufficient_balance` / `wallet_not_found`; setProductQuota re-reads `quota_used` for `quota_below_used`; else retry/contention). All four ops are now idempotency-keyed and share this pattern. No credit op ever parses an error message.

**Idempotency-key scope = per-tenant + per-domain-scope (codex Gate-1 finding 2; differs from PR2).** `credit_ledger` uses `UNIQUE(tenant_id, idempotency_scope, idempotency_key)`, whereas `grant_plan_operations` used a GLOBAL `UNIQUE(admin_idempotency_key)`. Two reasons for the extra scope axis: (1) credit deducts will (in the deferred product path) be driven by PRODUCT-generated keys (per-usage-event ids) that different products under the same tenant may reuse -- tenant A's product `erp`/`event-123` must not collide with the same tenant's `senior-app`/`event-123`; (2) an admin idempotency key (topup/adjust/quota_set) must not collide with a product usage-event id. The domain derives `idempotency_scope` (`product:<id>` / `manual:topup` / `manual:adjust` on `credit_ledger`; `manual:quota_set:<productId>:<period>` on `quota_config_ledger`); the caller never supplies it. The `UNIQUE(tenant_id, idempotency_scope, idempotency_key)` constraint (on each ledger) is itself the covering index for the pre-check lookup -- no separate idempotency index is needed.

### 5.3 `topUpCredits` (manual admin; source 'manual') -- creates wallet on first top-up
```
topUpCredits(db, { tenantId, amount, idempotencyKey, ref, actor }):
  idempotency_scope = 'manual:topup'
  validate (amount positive int, 0 < amount <= MAX_CREDIT_AMOUNT; actor required) -> request_hash
  -> idempotency pre-check (tenant_id, scope, key) -> tenant eligibility ->
  atomic batch:
    UPSERT credit_wallets: INSERT (tenant_id, balance) VALUES (?, ?amount)
      ON CONFLICT(tenant_id) DO UPDATE SET balance = balance + ?amount, version = version + 1, updated_at = now
    INSERT credit_ledger (entry_type='topup', amount=+amount, balance_after=(SELECT balance ...),
      quota_* = NULL, source='manual', actor snapshot, idempotency_scope='manual:topup', idempotency_key,
      request_hash, ref, occurred_at)
  outcomes: applied / replay / conflict / tenant_ineligible / invalid / contention
```
Top-up is also the wallet-provisioning path (the UPSERT creates the row on first top-up). It has no upper-bound CHECK to violate, so it cannot be "insufficient"; the only statement error is the idempotency UNIQUE (handled as replay/conflict). Batch ordering matters: the wallet UPSERT runs BEFORE the ledger INSERT, so the `balance_after = (SELECT balance ...)` subquery reads the just-written balance and is never NULL for topup (the UPSERT guarantees the row exists in the same batch).

### 5.4 `adjustCredits` (manual admin; source 'manual') -- signed correction, mandatory reason
```
adjustCredits(db, { tenantId, amount, direction:'credit'|'debit', idempotencyKey, ref(reason, required), actor }):
  idempotency_scope = 'manual:adjust'
  validate amount positive int (0 < amount <= MAX_CREDIT_AMOUNT); reason non-empty bounded
  -> signed = direction==='debit' ? -amount : +amount -> request_hash
  -> idempotency pre-check (tenant_id, scope, key) -> tenant eligibility ->
  atomic batch:
    UPDATE credit_wallets SET balance = balance + ?signed, version=version+1, updated_at=now WHERE tenant_id=?
      -> debit beyond balance: CHECK(balance>=0) -> rollback (insufficient_balance)
      -> wallet missing: 0-row -> caught by ledger balance_after NULL subquery (wallet_not_found)
    INSERT credit_ledger (entry_type='adjust', amount=?signed, balance_after=(SELECT...), source='manual',
      actor, idempotency_scope='manual:adjust', idempotency_key, request_hash, ref, occurred_at)
  outcomes: applied / replay / conflict / insufficient_balance / wallet_not_found / tenant_ineligible / invalid / contention
```
`adjust` is the only entry whose ledger `amount` may be negative without being a `deduct`; the amount-sign CHECK permits `adjust` either sign (it is excluded from the three directional CHECKs). `ref` carries the mandatory human reason for an adjust (audit/forensics). `adjust` uses a plain UPDATE (NOT an UPSERT): a credit-adjust against a tenant with no wallet row is `wallet_not_found`, not a silent provision -- adjust corrects an EXISTING wallet; provisioning is `topUpCredits`'s job. (A 0-row UPDATE is a success, so this is caught by the ledger `balance_after` NULL subquery, per the same missing-row mechanism as deduct.)

### 5.5 `setProductQuota` (manual admin; idempotency-keyed; writes the authoritative `quota_config_ledger` in-batch -- codex Gate-1 findings 1 + round-2 1)
A quota-cap change is a financial-limit state change; its evidence must be un-droppable, so it is written to the append-only `quota_config_ledger` in the SAME `D1.batch()` as the cap UPSERT (NOT via swallow-on-failure `safeUserAudit`). The `old_limit` is captured atomically by an in-batch subquery, so concurrent sets cannot record a wrong old value.
```
setProductQuota(db, { tenantId, productId, period='lifetime', quotaLimit, adminIdempotencyKey, reason?, actor }):
  validate period === 'lifetime' (else invalid:UNSUPPORTED_PERIOD -- PR3 single-period, finding 2);
    quotaLimit non-negative int (0 <= quotaLimit <= MAX_QUOTA_LIMIT); adminIdempotencyKey non-empty bounded;
    reason bounded if present; tenant eligibility; product active + tenant_scope compatible (provisioning gate)
  idempotency_scope = 'manual:quota_set:' + productId + ':' + period
  request_hash = sha256(canonicalJSON({ tenant_id, product_id, period, new_limit:quotaLimit, reason ?? '' }))
  idempotency pre-check (tenant_id, idempotency_scope, idempotency_key):
      hit + same request_hash -> replay (no new row; return prior new_limit)
      hit + different hash    -> conflict (409 IDEMPOTENCY_CONFLICT)   <-- same key, different limit/reason
      miss -> continue
  occurred_at = server toISOString()
  atomic batch (ORDER MATTERS -- ledger first captures pre-update old_limit via subquery):
    S1: INSERT quota_config_ledger
          (tenant_id, product_id, period,
           old_limit = (SELECT quota_limit FROM product_usage_quota WHERE tenant_id=? AND product_id=? AND period=?),  -- NULL if first set
           new_limit = ?quotaLimit, idempotency_scope, idempotency_key, request_hash, actor snapshot, reason, occurred_at)
          -- duplicate (tenant_id, idempotency_scope, idempotency_key): UNIQUE violation -> ERROR -> whole batch rollback
          --   (concurrent retry slipped past pre-check) -> caught -> re-read by key -> replay/conflict
    S2: UPSERT product_usage_quota: INSERT (tenant_id, product_id, period, quota_limit) VALUES (?,?,?,?)
          ON CONFLICT(tenant_id, product_id, period) DO UPDATE SET quota_limit = ?, version = version + 1, updated_at = now
          -- lowering below current quota_used: CHECK(quota_used <= quota_limit) -> ERROR -> whole batch rollback
          --   (incl. the S1 ledger row -> NO orphan "applied" evidence for a rejected set) -> quota_below_used
  safeUserAudit billing.quota.set = TELEMETRY ONLY (the quota_config_ledger row is the SoT trail; audit may swallow).
  catch handler (message-independent, see 5.2.1): on throw, FIRST re-read by (tenant_id, scope, key) ->
      row exists -> replay (same hash) / conflict (diff hash);
      else re-read quota_used -> if quotaLimit < quota_used -> quota_below_used; else retry (<=4) -> contention.
  outcomes: applied / replay / conflict / quota_below_used / tenant_ineligible / product_inactive / product_tenant_type_mismatch / invalid / contention
```
- **Authoritative trail (finding 1):** the `quota_config_ledger` row and the cap change commit or roll back together. If the ledger INSERT itself fails (e.g. a constraint), the cap UPSERT never applies (fail-closed) -- there is never a cap change without evidence, and never evidence without a cap change.
- **Old/new correctness under concurrency (finding 1):** `old_limit` is read by S1's subquery INSIDE the serialized batch, not by a separate endpoint read-before-write. Two concurrent sets serialize (D1 write serialization), each capturing the true old at its turn -> the ledger reconstructs the exact 10->20->30 history with no race.
- **Durable idempotency (codex round-2 finding 1):** because `quota_config_ledger` is now the AUTHORITATIVE SoT trail (round-1 finding 1), a quota set MUST be idempotency-keyed -- otherwise a network timeout + client retry would append a second authoritative row (e.g. a spurious `20->20`), polluting the financial-limit history. `setProductQuota` therefore takes an `adminIdempotencyKey`: same key + same payload -> `replay` (no new row, returns prior result); same key + different `new_limit`/`reason` -> 409 `conflict`. This corrects the round-1 plan's "NOT idempotency-keyed" claim: a declarative-set is safe against double-APPLY (limit=N twice yields N) but NOT against double-RECORD into an authoritative trail; the key prevents the spurious second history row. Scope `manual:quota_set:<productId>:<period>` keeps quota-set keys isolated from credit/topup/adjust key spaces (same finding-2 rationale).
- **Reconciliation (Section 5.6) is unaffected:** the credit reconciliation invariant reads `credit_ledger` only; `quota_config_ledger` is a separate cap-change trail. `product_usage_quota.quota_limit` always equals the latest (by `id`) `quota_config_ledger.new_limit` for that key (asserted by a test).

### 5.6 Reconciliation invariant (asserted by test now; periodic JOB deferred)
For every tenant: `credit_wallets.balance == SUM(credit_ledger.amount WHERE tenant_id)` (signed sum of ALL entries -- topup/refund positive, deduct negative, adjust signed). For every `(tenant_id, product_id, period)`: `product_usage_quota.quota_used == -SUM(credit_ledger.amount WHERE entry_type='deduct' AND tenant_id AND product_id AND quota_period=period)` (deduct amounts are negative; usage is their magnitude; grouped by the ledger's `quota_period`, which a deduct always records). PR3 asserts both as integration tests (Section 10). The periodic drift-detection + freeze-on-drift JOB is deferred to when real credit flow exists (standing owner decision 2026-05-14), like PR2's reconciliation.

### 5.7 Reasoned deviation -- NO hash-chain on credit_ledger in PR3
The architecture Section 5 sketch lists `prev_hash` / `this_hash` on `credit_ledger`. PR3 **defers** the hash-chain (does NOT create those columns now), with this rationale, for codex to confirm:
- **Correctness does not need it.** Fail-closed atomicity comes from `D1.batch()` + CHECK/NOT NULL/UNIQUE (Stage 0-verified). The hash-chain is tamper-EVIDENCE, an integrity/forensic property, not a correctness mechanism. PR2 made the identical call for `grant_plan_operations` and codex approved it as future hardening.
- **The repo's chain pattern needs app-layer support that is its own work.** The only existing hash-chain (`admin_audit_log`, 0012/0045) requires a `UNIQUE(prev_hash)` CAS + an app-layer append-with-retry routine; bolting that onto credit correctly is a focused PR, not a side feature of the wallet PR (first-do-no-harm on a financial path).
- **It is non-destructively addable later.** `prev_hash`/`this_hash` are nullable, not part of any table-level CHECK -> a future `ALTER TABLE credit_ledger ADD COLUMN` (plus a backfill + the app-layer chain writer) adds them with no table rebuild. This is the explicit reason they are omitted now rather than reserved: unlike the amount-sign CHECK, they carry no rebuild risk.
- **Net**: PR3 = app-layer insert-only discipline + atomic-batch fail-closed (same guarantee level as PR2's ledger). Hash-chain tamper-evidence is logged as future hardening. If codex wants the columns reserved-but-unwritten now, that is a cheap change (add two nullable columns); flagged as a Gate-1 decision in Section 12.

---

## 6. Outcome -> HTTP mapping (shared by all credit endpoints)

| outcome | HTTP | code |
|---|---|---|
| `applied` | 200 | `ok:true` + balance/quota snapshot |
| `replay` | 200 | `ok:true, replay:true` |
| `conflict` | 409 | `IDEMPOTENCY_CONFLICT` |
| `insufficient_balance` | 402 | `INSUFFICIENT_BALANCE` |
| `quota_exceeded` | 402 | `QUOTA_EXCEEDED` |
| `wallet_not_found` | 409 | `WALLET_NOT_PROVISIONED` (deduct/adjust against a tenant with no wallet) |
| `quota_not_found` | 409 | `QUOTA_NOT_PROVISIONED` (deduct against a product with no quota row) |
| `quota_below_used` | 409 | `QUOTA_BELOW_USAGE` (setQuota lowering below current usage) |
| `tenant_ineligible` | 422 | `TENANT_INELIGIBLE` |
| `product_inactive` | 422 | `PRODUCT_INACTIVE` |
| `product_tenant_type_mismatch` | 422 | `PRODUCT_TENANT_TYPE_MISMATCH` |
| `invalid` | 400 | `ERR_VALIDATION` (or specific code) |
| `contention` | 503 | `CONTENTION` |

`402 Payment Required` is the natural code for "out of credits / over quota" (a billing limit), distinct from `422` (eligibility) and `409` (idempotency/provisioning state). All responses use the codebase-consistent flat `res({error,code})` + traceId envelope.

---

## 7. Authorization

- **New scope** (`functions/utils/scopes.ts`): `ADMIN_BILLING_WALLET = 'admin:billing:wallet'` (fine). Register under the existing hierarchy: `SCOPE_HIERARCHY[ADMIN_BILLING]` gains `ADMIN_BILLING_WALLET` (so `admin`/`developer`/`super_admin`, which hold coarse `admin:billing`, auto-get it; same as `:grant`). Do NOT add it to `finance`/`support` base scopes (owner decision item, Section 12; default = not granted, with a negative test locking the current state -- mirrors `:grant`).
- **Step-up**: reuse `ELEVATED_BILLING` (already in `KNOWN_ELEVATED_SCOPES`) with NEW `for_action` values per op: `wallet_topup`, `wallet_adjust`, `quota_set`. The `for_action` binding (checked by `requireStepUp`) prevents a step-up token minted for one billing op being replayed on another. **Do NOT reuse** `elevated:wallet_op` (that is the web3 crypto-wallet scope -- naming trap).
- **Endpoint gate** (mirror `admin/billing/grant.ts`): `requireStepUp(SCOPES.ELEVATED_BILLING, '<for_action>')` first, then `effectiveScopesFromJwt(user).has(SCOPES.ADMIN_BILLING_WALLET)`; server-derived actor from the `users` row (never client). All three manual admin endpoints (topup/adjust/setQuota) use this double gate.
- **Read endpoint** `GET /api/tenants/:tenantId/wallet`: `requireRegularAccessToken` + `resolveIssuanceContextForTenant` (active membership on `:tenantId`), AND the resolved `platform_role` must be billing-capable (`tenant_owner` / `tenant_admin` / `billing_admin`) -- a plain `member` cannot read the wallet balance. Rationale: balance/quota is financial data; deny-by-default favors restricting it to roles that manage billing, unlike entitlements (which a member may legitimately need to see for feature gating). `resolveIssuanceContextForTenant` already returns the active-membership `platform_role`, so this is a single in-handler check, no extra query. (This is stricter than `GET entitlements` on purpose; if owner prefers parity with entitlements, that is decision item 6 in Section 12.)
- **Product-facing deduct** (deferred, Section 1): when built, it authenticates the calling product (RP) -- it is NOT a step-up admin path. Its authz contract is part of the deferred RP-integration work; PR3 does not ship it. `deductCredits` the domain is product-agnostic and takes `source='product'` for that future caller.

---

## 8. API contract

All admin write endpoints: strict body allowlist (unknown field, incl. `occurred_at` -> 400 `ERR_VALIDATION`, never silently ignored); per-user rate limit `kind:'billing_wallet'` (window 60s, max 30 -- same as `billing_grant`); audit on every disposition; `grantPlan`-style server actor.

### 8.1 `POST /api/admin/billing/wallets/:tenantId/topup`
- Auth: `requireStepUp(ELEVATED_BILLING,'wallet_topup')` + `admin:billing:wallet`.
- Body: `{ amount, admin_idempotency_key, ref? }` (amount = positive int credits). `tenantId` from path.
- -> `topUpCredits`. Outcomes per Section 6. 200 returns `{ ok, tenant_id, balance, operation_id }`.

### 8.2 `POST /api/admin/billing/wallets/:tenantId/adjust`
- Auth: `requireStepUp(ELEVATED_BILLING,'wallet_adjust')` + `admin:billing:wallet`.
- Body: `{ amount, direction:'credit'|'debit', admin_idempotency_key, reason }` (reason required, bounded; stored as ledger `ref`).
- -> `adjustCredits`. A `debit` beyond balance -> 402 `INSUFFICIENT_BALANCE`.

### 8.3 `PUT /api/admin/billing/quotas/:tenantId/:productId`
- Auth: `requireStepUp(ELEVATED_BILLING,'quota_set')` + `admin:billing:wallet`.
- Body: `{ quota_limit, admin_idempotency_key, period?, reason? }` (quota_limit = non-negative int; `admin_idempotency_key` required, bounded; `period` defaults `'lifetime'`, PR3 rejects any other value with 400 `UNSUPPORTED_PERIOD`).
- -> `setProductQuota`. Lowering below current usage -> 409 `QUOTA_BELOW_USAGE`. Same `admin_idempotency_key` + same payload -> 200 `replay`; + different `quota_limit`/`reason` -> 409 `IDEMPOTENCY_CONFLICT`. PUT verb (the resource is the absolute quota cap for `(tenant,product,period)`); idempotency here is BOTH the natural declarative-set semantics AND, crucially, the durable key that stops a retry from appending a second authoritative `quota_config_ledger` row (codex round-2 finding 1). (Flat `quotas/:tenantId/:productId` path avoids 4-level dir nesting; `:tenantId`/`:productId` are still authorized server-side, never trusted as filters.)

### 8.4 `GET /api/tenants/:tenantId/wallet`
- Auth: `requireRegularAccessToken` + active-membership on `:tenantId` + billing-capable `platform_role` (`tenant_owner`/`tenant_admin`/`billing_admin`; plain `member` -> 403).
- Returns `{ wallet: { balance } | null, quotas: [{ product_id, period, quota_limit, quota_used }] }` (DTO; no ledger dump, no `version`/internal columns). `wallet:null` when the tenant has no wallet row yet (not provisioned) -- distinct from `balance:0`.

> All four reuse the flat `res({error,code})` + traceId envelope; cross-tenant isolation on the GET is an acceptance gate (the path `:tenantId` is authorized via membership, never trusted as a filter).

---

## 9. Observability / audit

- Fail-closed evidence is the ledger row (`credit_ledger` for credit movements, `quota_config_ledger` for quota-cap changes), atomic with its mutation; `safeUserAudit` is non-authoritative telemetry (swallow-on-failure acceptable because the ledger already persisted). **No financial/limit state change relies on `safeUserAudit` for its trail** (codex Gate-1 finding 1).
- **New audit events** (registered in `audit-policy.ts` SAME PR -- memory `feedback_audit_classification`; bump `_registrySize` 179 -> 186 and the `audit-policy.test.ts` count, to avoid the PR1 red-CI incident):
  - `billing.credit.deducted` (IMMUTABLE) -- successful deduct (financial movement, permanent forensic trail).
  - `billing.credit.topup` (IMMUTABLE) -- successful manual top-up.
  - `billing.credit.adjusted` (IMMUTABLE) -- successful manual adjust (carries reason).
  - `billing.quota.set` (IMMUTABLE) -- quota cap created/changed. **This is telemetry duplicating the authoritative `quota_config_ledger` row** (Section 5.5); the audit registration is for classification/alerting consistency, NOT the trail of record. Named in the `billing.*` namespace, consistent with `billing.grant.*` / `billing.credit.*`.
  - `billing.credit.denied` (SECURITY_SIGNAL) -- insufficient / quota_exceeded / not_provisioned / eligibility / authz / validation / rate_limited (reason_code in payload). One event, many reason_codes (mirror `billing.grant.denied`).
  - `billing.credit.conflict` (SECURITY_SIGNAL) -- 409 IDEMPOTENCY_CONFLICT.
  - `billing.credit.idempotent_replay` (TELEMETRY) -- replay (not an error; metering).
- **Required deny-path observability (architecture Section 14 + codex r5 forward note)**: idempotency conflict, deduct denied, quota exceeded, insufficient balance each emit `billing.credit.denied`/`.conflict` with `traceId` + `reason_code`; payload carries non-sensitive identifiers only (tenant_id, product_id, amount, reason_code) -- never the full `ref` if it could be sensitive, never actor PII beyond staff email/role for manual ops.
- Logs carry traceId; deny responses return only `{error, code, traceId}` (no internal detail). The `denied` event uses the constraint NAME (Section 5.2.1) in its payload for forensic precision.

---

## 10. Test plan

`_setup.sql` adds the 4 tables (CREATE IF NOT EXISTS, all named CHECK/UNIQUE, **no `;` in comments** -- the resetDb runner splits on raw `;`); `_helpers.ts` adds `seedWallet` / `seedQuota` (+ low-level `seedCreditLedger` / `seedQuotaConfigLedger` for reconstruction tests); `resetDb` DELETE list gains the 4 tables (`credit_ledger`, `quota_config_ledger`, `product_usage_quota`, `credit_wallets`, all BEFORE `tenants`/`products` are wiped). `migrations.test.ts`: register `0049` in `ALL_UPS`, add 4 names to `EXPECTED_TABLES` (45 total), add 4 `EXPECTED_COLUMNS` entries.

Each negative test must FAIL pre-impl and PASS post-impl (memory `feedback_regression_test_must_lock_exact_failure`).

**Migration / schema** (`tests/integration/migrations.test.ts` additions)
1. Round-trip: up -> 4 tables present; down -> gone; up re-run idempotent. `EXPECTED_TABLES` (45)/`EXPECTED_COLUMNS` updated.
2. DB CHECK negatives (raw insert, hits DB constraint directly): `credit_wallets.balance = -1` rejected; `product_usage_quota.quota_used > quota_limit` rejected; `quota_used = -1` rejected; ledger `entry_type='topup' AND amount<0` rejected; `entry_type='deduct' AND amount>0` rejected; `amount=0` rejected; deduct row missing `quota_*_after`/`product_id`/`quota_period` rejected; `source='manual'` missing actor rejected; non-manual source WITH actor rejected.
2b. **Snapshot VALUE invariants (codex finding 3; raw insert hits the named CHECK):** `credit_ledger.balance_after = -1` rejected (`ck_ledger_balance_after_nonneg`); a deduct row with `quota_used_after = -1` rejected; `quota_limit_after = -1` rejected; `quota_used_after > quota_limit_after` (e.g. 11 > 10) rejected (`ck_ledger_quota_used_le_limit`); `balance_after` above the sane ceiling rejected. Assert wallet-level rows (NULL `quota_*_after`) still insert (NULL-guarded CHECKs pass).
2c. **`quota_config_ledger` CHECKs + UNIQUE:** `new_limit = -1` rejected; `old_limit = -1` rejected; blank `actor_email`/`actor_role` rejected; duplicate `(tenant_id, idempotency_scope, idempotency_key)` rejected (the durable-idempotency backstop, codex round-2 finding 1).

**`deductCredits` (the Tier-0 core)** (`tests/integration/credit.test.ts`)
3. Happy: provisioned wallet+quota -> deduct -> 'applied'; wallet balance decremented, quota_used incremented, exactly one ledger row with correct `balance_after`/`quota_used_after`/negative `amount`.
4. Idempotency replay: same `(tenant, scope, key)` + same params -> 'replay', no second row, balance unchanged.
5. Idempotency conflict: same `(tenant, scope, key)` + different amount -> 'conflict', no mutation.
5b. **Idempotency scope isolation (codex finding 2):** same tenant, same `idempotency_key`, DIFFERENT products (`erp` vs `senior-app`) -> BOTH deducts 'applied' (distinct `product:<id>` scope), two ledger rows, no false conflict. Also: an admin topup with key `K` and a product deduct with key `K` under the same tenant -> both apply (distinct `manual:topup` vs `product:<id>` scope).
6. Insufficient: balance 5, deduct 10 -> 'insufficient_balance', wallet+quota+ledger unchanged (assert all three).
7. Boundary: balance exactly = amount -> 'applied' (balance 0); deduct 1 more -> 'insufficient_balance'.
8. Quota exceeded: quota_limit 10 used 8, deduct 3 -> 'quota_exceeded', nothing changed; deduct 2 (==remaining) -> 'applied'.
9. Missing wallet row -> 'wallet_not_found' (NOT silent pass, NOT insufficient); missing quota row -> 'quota_not_found'.
9b. **Deduct period validation + hash (codex round-2 finding 2):** `deductCredits` with `period='2026-06'` -> 'invalid' (UNSUPPORTED_PERIOD), no write. `period` is in the deduct `request_hash`: same `(tenant, scope, key)` + same amount but conceptually different period would NOT false-replay (locked now so the future monthly-period rollout is safe). (Asserted by constructing two would-be-same hashes differing only by period and checking they differ.)
10. Concurrency double-spend: balance 10; two concurrent different-key deducts of 7 each -> exactly one 'applied', the other 'insufficient_balance'; final balance 3; exactly one ledger row (Stage-0-aligned; assert no over-draw).
11. Concurrency same-key: two concurrent same-key deducts -> exactly one 'applied', the other 'replay'; one ledger row.
12. Eligibility: closed/suspended tenant -> 'tenant_ineligible' (no write); inactive product -> 'product_inactive'. (NOTE: deduct does NOT re-check tenant_scope -- that is a provisioning-time gate in setProductQuota, §5.2; a scope-incompatible product simply has no quota row -> 'quota_not_found'. product_tenant_type_mismatch is asserted on setProductQuota, test 15f.)

**`topUpCredits` / `adjustCredits` / `setProductQuota`**
13. Top-up creates wallet on first call (UPSERT), adds on subsequent; ledger `topup` rows with positive amount + actor snapshot; replay/conflict by key.
14. Adjust credit/debit: signed ledger amount; debit beyond balance -> 'insufficient_balance'; reason persisted in `ref`; adjust against missing wallet -> 'wallet_not_found'.
15. setQuota creates then raises then lowers; lowering below `quota_used` -> 'quota_below_used' (rejected). Assert NO `credit_ledger` row written by setQuota (count unchanged); assert ONE `quota_config_ledger` row PER applied set with correct `old_limit`/`new_limit` (first set old=NULL); assert a REJECTED set (below usage) writes NEITHER a quota_config_ledger row NOR changes the cap (whole-batch rollback). `product_usage_quota.quota_limit` equals the latest `quota_config_ledger.new_limit`.
15b. **Authoritative-trail rollback (codex finding 1):** force the in-batch `quota_config_ledger` INSERT to fail (raw harness: a config-ledger CHECK violation in the same batch shape) -> assert the cap UPSERT did NOT apply (no cap change without evidence). Conversely the rejected-lower case (15) proves no evidence without a cap change.
15c. **Concurrent old/new correctness (codex finding 1):** start limit=10; two concurrent sets (->20 and ->30) serialize; assert the two `quota_config_ledger` rows reconstruct a consistent history (each row's `old_limit` == the prior row's `new_limit`; final `quota_limit` == last `new_limit`); NO row records a stale old (the read-before-write race the endpoint approach would have had).
15d. **Quota-set durable idempotency (codex round-2 finding 1):** set limit=20 with `admin_idempotency_key='K'`; a network-timeout RETRY of the identical PUT -> 'replay', and `quota_config_ledger` has EXACTLY ONE row for that key (NO spurious second `20->20` authoritative row). Same `K` with a DIFFERENT `quota_limit` (or `reason`) -> 409 'conflict', no new row, cap unchanged. A different key for the same product+period -> a new legitimate config row (genuine second admin change).
15e. **Unsupported period rejected (codex round-2 finding 2):** `setProductQuota` with `period='2026-06'` -> 'invalid' (UNSUPPORTED_PERIOD), no `quota_config_ledger` / `product_usage_quota` write. (Endpoint mirror: PUT with non-lifetime period -> 400 UNSUPPORTED_PERIOD.)
15f. **setProductQuota eligibility:** closed tenant -> 'tenant_ineligible'; inactive product -> 'product_inactive'; org-only product (`tenant_scope='organization'`) on a personal tenant -> 'product_tenant_type_mismatch' (scope IS checked at provisioning, unlike deduct).

**Reconciliation invariant**
16. After a mixed sequence (topup, several deducts across 2 products, an adjust): assert `balance == SUM(credit_ledger.amount)` and per-product `quota_used == -SUM(deduct amounts grouped by quota_period)` (Section 5.6).

**Actor snapshot**
17. Manual op by admin A -> ledger `actor_id/email/role` snapshotted; after changing A's email/role and hard-deleting A, the ledger row is unchanged (no FK).

**Endpoints** (`tests/integration/credit-endpoints.test.ts`)
18. topup/adjust/quota: step-up + scope double gate (regular token -> 403; wrong elevated scope -> 403; wrong `for_action` -> 403; role without `admin:billing:wallet` -> 403 INSUFFICIENT_SCOPE + `billing.credit.denied`).
19. Strict body: unknown field / `occurred_at` in body -> 400; client cannot spoof actor (`actor`/`actor_id` in body -> 400).
20. Outcome->HTTP: applied 200 / replay 200 / conflict 409 / insufficient 402 / quota_exceeded 402 / not_provisioned 409 / eligibility 422 / contention 503; each emits the right audit event.
21. Per-user rate limit `billing_wallet`: at cap (30) -> 429 RATE_LIMITED, no write, denial audited; under cap -> proceeds; per-user isolation (a second admin unaffected).
22. GET wallet: own tenant as owner/billing_admin -> 200 with `{wallet, quotas}` (no ledger/version leak); plain `member` of the tenant -> 403 (billing-role gate); not-provisioned -> `wallet:null`; cross-tenant (non-member) -> 403; bad tenantId -> 400.

**Audit registry**
23. All 7 new `billing.credit.*` / `billing.quota.set` classified (no unclassified warn); `_registrySize` (186) + `audit-policy.test.ts` count updated.

---

## 11. Architecture-doc drift override (authoritative)

This PR3 plan is authoritative over stale sketch lines in `chiyigo-platform-architecture-plan-2026-05-28.md` Section 5. Implementation must NOT regress to:

| Stale architecture sketch | PR3 plan (authoritative) | Why |
|---|---|---|
| `credit_ledger.prev_hash` / `this_hash` (hash-chain) | Deferred -- columns NOT created in PR3 | Section 5.7; correctness via atomic batch, chain is future hardening, ALTER-addable (no rebuild) |
| `credit_ledger` UNIQUE `(tenant_id, idempotency_key)` "+ trigger to block UPDATE/DELETE" | UNIQUE widened to **`(tenant_id, idempotency_scope, idempotency_key)`** (codex finding 2); **NO DB trigger** -- append-only via app-layer insert-only discipline | scope isolates per-product/per-admin key spaces; repo uses no triggers; matches audit_log / grant_plan_operations (PR2 precedent codex-approved) |
| quota-cap change trail = audit log only | **`quota_config_ledger`** authoritative append-only table written in-batch with the cap UPSERT (codex finding 1); `billing.quota.set` audit demoted to telemetry | a financial-limit change needs un-droppable evidence; `safeUserAudit` swallows failures |
| `credit_ledger` snapshot columns NOT NULL only | + named VALUE-invariant CHECKs (codex finding 3): `balance_after>=0`, `quota_used_after>=0`, `quota_limit_after>=0`, `quota_used_after<=quota_limit_after`, sane ceiling | a raw insert must not record an impossible post-state; migration-baked (CHECK not ALTER-able) |
| `credit_wallets.version` as the deduct concurrency mechanism (CAS) | `version` reserved (admin paths); deduct uses **relative update + CHECK**, no CAS retry | Stage 0 criterion 6: relative update + CHECK is concurrency-safe under D1 write serialization; CAS loop unnecessary for deduct |
| `product_usage_quota` unique `(tenant_id, product_id, period)` | Same, as the table PRIMARY KEY | (no change; restated for clarity) |
| `credit_ledger.ref` / `idempotency_key` only | + `request_hash` (replay-vs-conflict), `source`, `quota_period`, actor snapshot, `balance_after`/`quota_*_after` NOT NULL | realizes codex r1-r4 fail-closed design + r5 amount-sign |

---

## 12. Owner / Codex decisions (Gate-1 confirm; not implementation blockers for the core)

1. **Hash-chain now or later?** Plan defers `prev_hash`/`this_hash` (Section 5.7, reasoned, ALTER-addable). Confirm defer, OR add two nullable reserved columns now (cheap), OR require the full chain in PR3 (larger scope; not recommended -- first-do-no-harm on a financial path).
2. **`finance` role gets `admin:billing:wallet`?** Default = NOT granted (negative test locks current state), same as `:grant`. Confirm, or grant finance the wallet scope.
3. **Product-facing deduct endpoint deferral.** `deductCredits` domain ships + is tested; the HTTP endpoint products call is deferred (no RP caller yet + open RP token contract). Confirm acceptable, OR add an interim `POST /api/admin/billing/wallets/:tenantId/deduct` (admin-driven `source='manual'` deduct, same double gate) so the deduct path is reachable in prod before RP integration. (Plan leans: ship the admin manual-deduct endpoint via `adjust`'s sibling is NOT enough -- adjust does not touch quota; a real deduct needs quota. If owner wants a reachable deduct now, add the admin deduct endpoint; otherwise domain-only.)
4. **Quota `period` semantics.** PR3 = single `'lifetime'` period (no reset). Confirm; monthly/periodic quota is a later feature (column reserved).
5. **`adjust` debit below zero.** Plan rejects (CHECK `balance>=0`) -> 402, even for an admin correction (no negative balances ever). Confirm (alternative: allow admin to force-negative -- NOT recommended; breaks the wallet invariant).
6. **GET wallet role gate.** Plan restricts balance read to billing-capable roles (`tenant_owner`/`tenant_admin`/`billing_admin`); a plain `member` gets 403 (stricter than `GET entitlements`, which any member can read). Confirm, OR relax to any active member for parity with entitlements.
7. **Quota unit model.** Plan denominates quota in the SAME credit unit as the wallet (a deduct of N spends N credits AND counts N against quota; `quota_limit` = per-product sub-cap on the shared balance). Confirm, OR require product-native quota units decoupled from credit cost (would add a second magnitude to `deductCredits`; not recommended for PR3 -- additive later). See the unit-model note in Section 5.2.

---

## 13. File list (estimated)

**New**
- `migrations/0049_credit_wallet.sql` + `migrations/down/0049_credit_wallet.down.sql` (4 tables: credit_wallets / product_usage_quota / credit_ledger / quota_config_ledger)
- `functions/utils/credit.ts` (`deductCredits` / `topUpCredits` / `adjustCredits` / `setProductQuota` / shared validate+hash+scope+outcomes)
- `functions/api/admin/billing/wallets/[tenantId]/topup.ts`
- `functions/api/admin/billing/wallets/[tenantId]/adjust.ts`
- `functions/api/admin/billing/quotas/[tenantId]/[productId].ts`
- `functions/api/tenants/[tenantId]/wallet.ts`
- `tests/integration/credit.test.ts` (domain) + `tests/integration/credit-endpoints.test.ts` (+ DB-CHECK negatives may live in credit.test.ts or migrations.test.ts)

**Modified (minimal diff)**
- `functions/utils/scopes.ts` (+`ADMIN_BILLING_WALLET` + hierarchy entry; role map unchanged unless owner decision 2)
- `functions/utils/audit-policy.ts` (+7 events; `_registrySize` 179->186)
- `functions/utils/rate-limit.ts` (+`'billing_wallet'` to `RateLimitKind`)
- `tests/integration/_setup.sql`, `tests/integration/_helpers.ts` (4 tables + seeders + resetDb)
- `tests/integration/migrations.test.ts` (`ALL_UPS` + `EXPECTED_TABLES` 45 + 4 `EXPECTED_COLUMNS`)
- `tests/audit-policy.test.ts` (registry count 179->186)

**Do not touch**: the 8 token signing points (no claim delta -- credit/quota are NOT in the token), `functions/utils/billing.ts` / `grant.ts` (PR2 grant path unchanged -- no auto-provision wiring in PR3), `functions/api/webhooks/payments/*`, the web3 `user_wallets` path, chiyigo-core.

---

## 14. Commit plan (two-gate workflow, memory `feedback_codex_review_workflow`)

Gate 1 = THIS plan (codex plan review). After approval:
1. migration + test scaffold -- `0049` up/down (4 tables: wallets/quota/credit_ledger/quota_config_ledger, full shape incl. named constraints), `_setup.sql` + `_helpers.ts` (seeders + resetDb), `migrations.test.ts` registration + DB-CHECK negatives (incl. snapshot value-invariants + quota_config_ledger). Zero runtime change.
2. credit domain `functions/utils/credit.ts` -- `deductCredits` (+ pre-check/batch/catch per 5.2/5.2.1), `topUpCredits`, `adjustCredits`, `setProductQuota`, validate/hash/outcomes; domain tests (deduct atomicity/idempotency/concurrency/boundary/eligibility + topup/adjust/setQuota + reconciliation + actor-snapshot).
3. scopes + audit-policy + rate-limit kind -- `admin:billing:wallet` + hierarchy; 7 events; `'billing_wallet'`; update registry-size test.
4. endpoints -- topup/adjust/quota (double gate + strict body + per-user rate limit + audit) + GET wallet (tenant guard); endpoint tests.

Each step: full CI parity locally before any push (memory PR2 ops lesson) -- `lint` (NOT tail-truncated) / `typecheck:ratchet` / `verify:browser-pipeline` / `test:cov` (add `functions/utils/credit.ts` to vitest coverage exclude IF it is D1-dependent and integration-tested, like billing.ts/payments -- else unit-coverage gate counts ~0% and fails) / `test:int` / `build:functions` / `npm audit --omit=dev`. `git diff --stat` self-check; commit-quality hook via PowerShell path if needed (NOT `--no-verify`; memory `feedback_claude_code_hook_bash_matcher_bypass`). Pure backend, no `public/` asset -> no cache-bust. Background test runs: do not edit files mid-run (memory PR2 ops lesson). Then Gate 2 (codex code review) -> migration-before-deploy -> push.

---

## 15. Deploy / migration-ordering note (PR1/PR2 lesson)

`deploy.yml` is `on: push:[main]` -> merge = immediate auto-deploy. New tables + code that uses them in the same PR -> migration MUST be applied first: `wrangler d1 migrations apply chiyigo_db --remote` (owner runs or authorizes each step, auditable) -> verify the 4 tables exist in prod D1 -> THEN merge (auto-deploy) -> smoke. PR3's endpoints are new admin paths (not an existing hot path), and the only public-facing addition (GET wallet) returns `wallet:null` gracefully when unprovisioned, so the blast radius if mis-ordered is lower than PR1's auth break -- but the ordering still holds (memory `reference_pages_deploy_with_d1_migration`).

Down/rollback: `0049` down DROPs the 4 tables -- safe ONLY before any real `credit_ledger` / `quota_config_ledger` row exists (projection-free; no data loss). Once real credit movements or quota-config changes exist, rollback = forward-fix; DROP forbidden (memory `feedback_irreversible_action_full_review`).

Positive prod smoke (a real deduct/topup) falls under the standing "defer financial smoke until all money flows are written" owner decision (2026-05-14); PR3 ships with credential-free smoke (deploy + auth-gate 401/403 + no write) + full `test:int` coverage of the authenticated paths, same disposition as PR2.

---

*Plan complete (DRAFT). Next step = Codex Gate 1 plan review -> address findings -> implement (Section 14) -> Gate 2 -> migration-before-deploy -> push.*
