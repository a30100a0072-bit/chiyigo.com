-- Migration 0049: Credit Wallet + Per-Product Quota + Ledger (B2B platform PR3)
--
-- Upstream design: docs/reviews/pr3-credit-wallet-plan-2026-06-01.md (Codex Gate 1 approved).
--   Architecture decision (3): single tenant wallet + per-product quota (NOT per-product wallet).
--
-- 4 tables: credit_wallets (tenant balance) / product_usage_quota (per-product usage cap) /
--   credit_ledger (append-only credit-movement ledger = SoT) /
--   quota_config_ledger (append-only authoritative trail of quota-cap changes).
-- expand-only: only adds new tables, does not ALTER existing tables. Fully idempotent (IF NOT EXISTS).
--
-- APPEND-ONLY (both ledgers): enforced at the APP layer (credit.ts only ever INSERTs, never UPDATE/DELETE),
--   matching audit_log (0017) / admin_audit_log / grant_plan_operations (0048) house style. The repo uses
--   NO DB triggers (the migration + resetDb runners split SQL on raw semicolons and cannot carry a trigger
--   body, and comments here must contain no semicolon). Fail-closed correctness = atomic INSERT + relative
--   updates via CHECK / NOT NULL / UNIQUE / D1.batch() rollback (Stage 0 spike verified, codex-approved).
-- Hash-chain tamper-evidence is future hardening (plan section 5.7), not PR3.
--
-- NAMING TRAP: this is UNRELATED to user_wallets / wallet_nonces (web3 EIP-1193 crypto wallet, 0023).

-- credit_wallets: single wallet per tenant (mutable balance, never negative)
CREATE TABLE IF NOT EXISTS credit_wallets (
  tenant_id  INTEGER PRIMARY KEY REFERENCES tenants(id),
  balance    INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_wallet_balance_nonneg CHECK(balance >= 0),
  version    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- product_usage_quota: per-product usage cap (mutable quota_used, capped by quota_limit)
-- PR3 produces only period='lifetime' (column reserved for future YYYY-MM monthly reset)
CREATE TABLE IF NOT EXISTS product_usage_quota (
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  product_id  TEXT    NOT NULL REFERENCES products(id),
  period      TEXT    NOT NULL,
  quota_limit INTEGER NOT NULL CONSTRAINT ck_quota_limit_nonneg CHECK(quota_limit >= 0),
  quota_used  INTEGER NOT NULL DEFAULT 0
              CONSTRAINT ck_quota_used_bounds CHECK(quota_used >= 0 AND quota_used <= quota_limit),
  version     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, product_id, period)
);
CREATE INDEX IF NOT EXISTS idx_puq_tenant ON product_usage_quota(tenant_id);

-- credit_ledger: append-only credit-movement ledger (Source of Truth + fail-closed evidence)
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  product_id  TEXT    REFERENCES products(id),
  entry_type  TEXT    NOT NULL CHECK(entry_type IN ('topup','deduct','refund','adjust')),
  amount      INTEGER NOT NULL CHECK(amount <> 0),
  balance_after     INTEGER NOT NULL,
  quota_used_after  INTEGER,
  quota_limit_after INTEGER,
  quota_period      TEXT,
  idempotency_scope TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  ref               TEXT,
  source            TEXT NOT NULL CHECK(source IN ('manual','product','payment')),
  actor_id          INTEGER,
  actor_email       TEXT,
  actor_role        TEXT,
  occurred_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, idempotency_scope, idempotency_key),
  CONSTRAINT ck_ledger_amount_topup  CHECK( entry_type <> 'topup'  OR amount > 0 ),
  CONSTRAINT ck_ledger_amount_refund CHECK( entry_type <> 'refund' OR amount > 0 ),
  CONSTRAINT ck_ledger_amount_deduct CHECK( entry_type <> 'deduct' OR amount < 0 ),
  CONSTRAINT ck_ledger_deduct_snapshot CHECK( entry_type <> 'deduct' OR (
           product_id        IS NOT NULL
           AND quota_used_after  IS NOT NULL
           AND quota_limit_after IS NOT NULL
           AND quota_period      IS NOT NULL) ),
  CONSTRAINT ck_ledger_balance_after_nonneg CHECK( balance_after >= 0 ),
  CONSTRAINT ck_ledger_quota_used_nonneg    CHECK( quota_used_after  IS NULL OR quota_used_after  >= 0 ),
  CONSTRAINT ck_ledger_quota_limit_nonneg   CHECK( quota_limit_after IS NULL OR quota_limit_after >= 0 ),
  CONSTRAINT ck_ledger_quota_used_le_limit  CHECK( quota_used_after IS NULL OR quota_limit_after IS NULL OR quota_used_after <= quota_limit_after ),
  CONSTRAINT ck_ledger_balance_after_sane CHECK( balance_after <= 1000000000000 ),
  CONSTRAINT ck_ledger_manual_actor CHECK( source <> 'manual' OR (
           actor_id IS NOT NULL
           AND actor_email IS NOT NULL AND length(trim(actor_email)) > 0
           AND actor_role  IS NOT NULL AND length(trim(actor_role))  > 0) ),
  CONSTRAINT ck_ledger_nonmanual_no_actor CHECK( source = 'manual' OR (actor_id IS NULL AND actor_email IS NULL AND actor_role IS NULL) )
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_tenant         ON credit_ledger(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_tenant_product ON credit_ledger(tenant_id, product_id);

-- quota_config_ledger: append-only authoritative trail of quota-cap changes (plan section 4.4)
-- written in the SAME D1.batch() as the product_usage_quota UPSERT, so a cap change and its evidence
-- are atomic. old_limit captured by an in-batch scalar subquery (no endpoint read-before-write race).
-- Durable idempotency (admin write retry-safe): UNIQUE(tenant_id, idempotency_scope, idempotency_key).
CREATE TABLE IF NOT EXISTS quota_config_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  product_id  TEXT    NOT NULL REFERENCES products(id),
  period      TEXT    NOT NULL,
  old_limit   INTEGER,
  new_limit   INTEGER NOT NULL CONSTRAINT ck_qcl_new_nonneg CHECK(new_limit >= 0),
  idempotency_scope TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL,
  request_hash      TEXT NOT NULL,
  actor_id    INTEGER NOT NULL,
  actor_email TEXT    NOT NULL,
  actor_role  TEXT    NOT NULL,
  reason      TEXT,
  occurred_at TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, idempotency_scope, idempotency_key),
  CONSTRAINT ck_qcl_old_nonneg   CHECK( old_limit IS NULL OR old_limit >= 0 ),
  CONSTRAINT ck_qcl_actor_present CHECK( length(trim(actor_email)) > 0 AND length(trim(actor_role)) > 0 )
);
CREATE INDEX IF NOT EXISTS idx_qcl_tenant_product ON quota_config_ledger(tenant_id, product_id, period, id);
