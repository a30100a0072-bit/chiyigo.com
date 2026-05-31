-- Migration 0048: Billing / Entitlement Foundation（B2B 多租戶平台 PR2）
--
-- 上游設計：docs/reviews/pr2-billing-entitlement-plan-2026-05-30.md
--   （Codex Gate 1 approved；Option B = 永久存取；manual-only code path；
--     full ledger schema 一次到位，payment-trigger 欄位 schema-ready 但 PR2 不寫）。
--
-- 表：products / plans（目錄）+ tenant_product_access（投影）+ grant_plan_operations（append-only ledger = SoT）。
-- expand-only：只加新表 + seed，不 ALTER 既有表。全 idempotent（IF NOT EXISTS / INSERT OR IGNORE）。
--
-- APPEND-ONLY（plan drift 2026-05-30，Implementation Commit 1）：grant_plan_operations 的
--   append-only 由 **應用層 insert-only discipline** 保證（grantPlan 只 INSERT，永不 UPDATE/DELETE），
--   對齊 audit_log（0017）/ admin_audit_log house style。本 repo 不使用 DB trigger（migration/test
--   harness 走簡單 `split(';')`，無法套 trigger body）。Stage 0 的 trigger-RAISE 結果僅為 spike
--   evidence，**不**落進本 migration。PR2 的 fail-closed 不可變保證 = atomic INSERT + 投影寫入
--   經 CHECK / UNIQUE / D1.batch() rollback（Stage 0 已驗）。hash-chain / trigger tamper-evidence
--   列 future hardening，不在 PR2。

-- ── products（目錄；穩定 TEXT id；tenant_scope 限定可購買的租戶類型）─────────────
CREATE TABLE IF NOT EXISTS products (
  id           TEXT    PRIMARY KEY,                  -- 'erp' | 'senior-app'
  name         TEXT    NOT NULL,
  tenant_scope TEXT    NOT NULL CHECK(tenant_scope IN ('organization','personal','any')),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── plans（INTEGER surrogate id + immutable code；ledger 永久引用 surrogate）────────
CREATE TABLE IF NOT EXISTS plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id       TEXT    NOT NULL REFERENCES products(id),
  code             TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  features         TEXT,                              -- JSON（write-boundary 驗證）
  included_credits INTEGER NOT NULL DEFAULT 0,
  price_subunit    INTEGER,                           -- nullable（免費/客製）
  currency         TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, code)
);
CREATE INDEX IF NOT EXISTS idx_plans_product ON plans(product_id);

-- ── tenant_product_access（投影=current state；無 period 欄，Option B 永久存取）──────
CREATE TABLE IF NOT EXISTS tenant_product_access (
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  product_id          TEXT    NOT NULL REFERENCES products(id),
  plan_id             INTEGER NOT NULL REFERENCES plans(id),
  status              TEXT    NOT NULL CHECK(status IN ('pending','active','expired','revoked')),
  granted_via         TEXT    NOT NULL CHECK(granted_via IN ('payment','manual')),
  version             INTEGER NOT NULL DEFAULT 1,     -- optimistic lock
  last_op_occurred_at TEXT    NOT NULL,               -- server UTC ISO-8601；ordering 基準
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_tpa_tenant ON tenant_product_access(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tpa_status ON tenant_product_access(status);

-- ── grant_plan_operations（append-only ledger = SoT + fail-closed 證據）──────────────
-- payment_* 欄位 schema-ready 但 PR2 不寫（manual-only code path）。append-only 走應用層紀律（見檔頭）。
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

  -- actor snapshot（manual）：granted_by 無 FK —— ledger 必須 outlive user row（改 email/role / 刪帳號不抹除）
  granted_by            INTEGER,
  granted_by_email      TEXT,
  granted_by_role       TEXT,

  -- offline evidence
  payment_ref           TEXT,                          -- display（app-trimmed）
  payment_ref_key       TEXT,                          -- canonical key（dedup / request_hash 唯一面）
  grant_reason          TEXT,                          -- admin_override 用

  -- payment trigger（schema-ready；PR2 不寫；payer/證據在 payment_intents）
  payment_intent_id     INTEGER REFERENCES payment_intents(id),
  payment_event_ref     TEXT,

  -- transition + concurrency/ordering
  from_status TEXT NOT NULL CHECK(from_status IN ('none','pending','active','expired','revoked')),
  to_status   TEXT NOT NULL CHECK(to_status   IN ('pending','active','expired','revoked')),
  prev_projection_version INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,                            -- server UTC ISO-8601；禁 client 傳入
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(admin_idempotency_key),                          -- manual request dedup
  UNIQUE(payment_intent_id),                              -- payment OBJECT dedup（永不用 event_id）
  UNIQUE(tenant_id, product_id, prev_projection_version), -- per-entitlement serialize（fail-closed 並發鎖）

  -- conditioning 欄 `trigger` NOT NULL → 以下條件式 NOT-NULL CHECK 可靠觸發（避 PR3 NULL-bypass）
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
-- offline：一個 canonical 銀行 ref = 一筆 grant（variant-proof）
CREATE UNIQUE INDEX IF NOT EXISTS uq_gpo_offline_payment_ref_key
  ON grant_plan_operations(payment_ref_key) WHERE manual_source = 'offline_payment';
CREATE INDEX IF NOT EXISTS idx_gpo_tenant_product ON grant_plan_operations(tenant_id, product_id);

-- ── seed：products + 最小 placeholder plans（idempotent）─────────────────────────────
INSERT OR IGNORE INTO products (id, name, tenant_scope, is_active) VALUES
  ('erp',        'ERP',        'organization', 1),
  ('senior-app', 'Senior App', 'any',          1);

INSERT OR IGNORE INTO plans (product_id, code, name, included_credits, price_subunit, currency, is_active) VALUES
  ('erp',        'erp_basic',    'ERP Basic',        0, NULL, NULL, 1),
  ('senior-app', 'senior_basic', 'Senior App Basic', 0, NULL, NULL, 1);
