-- Minimal schema subset for reset-password / forgot-password integration tests.
-- Mirrors database/schema_auth.sql but only the tables this flow touches.

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  role            TEXT    NOT NULL DEFAULT 'player',
  status          TEXT    NOT NULL DEFAULT 'active',
  token_version   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS local_accounts (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS backup_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT    NOT NULL,
  used_at   TEXT
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  token_type  TEXT    NOT NULL,
  ip_address  TEXT,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  device_uuid TEXT,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT,
  auth_time   TEXT,
  scope       TEXT, -- migration 0035（P1-5）
  issued_aud  TEXT, -- migration 0037（Codex r9-5）
  session_id  TEXT  -- migration 0052（PR5 5d per-login session id, opaque TEXT, live=UUID or legacy_<id>）
);

-- migration 0035（P1-6/P1-8）— TOTP replay 防護
CREATE TABLE IF NOT EXISTS used_totp (
  user_id  INTEGER NOT NULL,
  slot     INTEGER NOT NULL,
  used_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, slot)
);
CREATE INDEX IF NOT EXISTS idx_used_totp_used_at ON used_totp(used_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT,
  email      TEXT,
  kind       TEXT    NOT NULL DEFAULT 'login',
  user_id    INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Full requisition schema (post-migration 0001 + 0006). Legacy owner_* 留給 register guest-upgrade UPDATE
CREATE TABLE IF NOT EXISTS requisition (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_guest_id  TEXT,
  owner_user_id   INTEGER,
  user_id         INTEGER,
  name            TEXT,
  company         TEXT,
  contact         TEXT,
  service_type    TEXT,
  budget          TEXT,
  timeline        TEXT,
  message         TEXT,
  source_ip       TEXT,
  tg_message_id   INTEGER,
  status          TEXT    NOT NULL DEFAULT 'pending',
  deleted_at      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_states (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  state_token     TEXT    NOT NULL UNIQUE,
  code_verifier   TEXT,
  nonce           TEXT,
  redirect_uri    TEXT,
  platform        TEXT,
  client_callback TEXT,
  ip_address      TEXT,
  aud             TEXT,
  expires_at      TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER,
  ip           TEXT,
  fingerprint  TEXT,
  session_id   TEXT,
  prompt       TEXT NOT NULL,
  response     TEXT,
  model        TEXT,
  status       TEXT NOT NULL,
  block_reason TEXT,
  duration_ms  INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     INTEGER NOT NULL,
  admin_email  TEXT    NOT NULL,
  action       TEXT    NOT NULL,
  target_id    INTEGER NOT NULL,
  target_email TEXT    NOT NULL,
  ip_address   TEXT,
  prev_hash    TEXT,
  row_hash     TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Migration 0045 (2026-05-23)：hash chain CAS race fix — UNIQUE on prev_hash 強制
-- 兩個 concurrent writer 算到同 prev_hash 時，第二個 INSERT 觸發 UNIQUE 衝突。
-- appendAuditLog 內建 retry loop 處理；prepareAppendAuditLog (batch) 由 caller 既有 catch 處理。
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_audit_prev_hash_unique
  ON admin_audit_log(prev_hash);

CREATE TABLE IF NOT EXISTS user_identities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT    NOT NULL,
  provider_id  TEXT    NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT,
  UNIQUE(provider, provider_id)
);

-- PKCE sessions: chiyigo IAM acts as Authorization Server (RFC 7636 + OIDC)
CREATE TABLE IF NOT EXISTS pkce_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_key     TEXT    NOT NULL UNIQUE,
  state           TEXT    NOT NULL,
  code_challenge  TEXT    NOT NULL,
  redirect_uri    TEXT    NOT NULL,
  scope           TEXT,
  nonce           TEXT,
  expires_at      TEXT    NOT NULL,
  ip_address      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One-time authorization codes (consumed atomically by /token)
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                    TEXT    PRIMARY KEY,
  client_name                  TEXT    NOT NULL,
  client_secret_hash           TEXT,
  app_type                     TEXT    NOT NULL DEFAULT 'web',
  allowed_redirect_uris        TEXT    NOT NULL,
  allowed_scopes               TEXT    NOT NULL,
  allowed_grant_types          TEXT    NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  require_pkce                 INTEGER NOT NULL DEFAULT 1,
  token_endpoint_auth_method   TEXT    NOT NULL DEFAULT 'none',
  post_logout_redirect_uris    TEXT,
  frontchannel_logout_uri      TEXT,
  frontchannel_logout_uris     TEXT,
  backchannel_logout_uri       TEXT,
  cors_origins                 TEXT,
  aud                          TEXT,
  logo_uri                     TEXT,
  client_uri                   TEXT,
  policy_uri                   TEXT,
  tos_uri                      TEXT,
  is_active                    INTEGER NOT NULL DEFAULT 1,
  created_at                   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,
  severity    TEXT    NOT NULL DEFAULT 'info',
  user_id     INTEGER,
  client_id   TEXT,
  ip_hash     TEXT,
  event_data  TEXT,
  archived_at TEXT,                                    -- migration 0038（F-3 Phase 2）
  cold_class  TEXT    NOT NULL DEFAULT 'immutable',    -- migration 0038
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- F-3 Phase 2 migration 0038：audit_archive_chunks（per-chunk 狀態機）
-- 整合測試需要這張表才能跑 archive worker 的 planned→uploaded→verified→marked_archived 升態。
CREATE TABLE IF NOT EXISTS audit_archive_chunks (
  env                TEXT    NOT NULL,
  table_name         TEXT    NOT NULL,
  cold_class         TEXT    NOT NULL,  -- 0044：CHECK 移除（aggregate_telemetry / aggregate_debug 加入後 app 層保證合法值）
  cold_class_version INTEGER NOT NULL DEFAULT 1,
  archive_date       TEXT    NOT NULL,
  min_id             INTEGER NOT NULL,
  max_id             INTEGER NOT NULL,
  chunk_sha256       TEXT    NOT NULL,
  state              TEXT    NOT NULL
                     CHECK(state IN ('planned','uploaded','verified','marked_archived','purged','cold_copied','failed','blacklisted')),
  row_count          INTEGER NOT NULL,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  last_failure_at    TEXT,
  last_failure       TEXT,
  next_reminder_at   TEXT,
  blacklisted_at     TEXT,
  marked_archived_at TEXT,
  purge_after        TEXT,
  cold_copied_at     TEXT,
  run_id             TEXT    NOT NULL,
  dry_run            INTEGER NOT NULL DEFAULT 0,   -- PR 2.1c migration 0039：provenance
  compression        TEXT    NOT NULL DEFAULT 'none', -- PR 2.1b migration 0041：'gzip'|'none'
  key_scheme         INTEGER NOT NULL DEFAULT 1,   -- PR 0.2c-pre-1a migration 0046：1=legacy single manifest key / 2=write-once state-suffixed
  last_manifest_state TEXT,                         -- PR 0.2c-pre-1a migration 0046：observability bookkeeping（非 correctness source）
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256)
);

-- F-3 Phase 2 migration 0038 part 4：telemetry aggregate（PR 3.0 worker 目標表）
-- 0044 補欄：archived_at + cold_class（PR 3.2 月度 aggregate→R2 用）
CREATE TABLE IF NOT EXISTS audit_log_aggregate_telemetry (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT NOT NULL,
  user_id       INTEGER,
  severity      TEXT NOT NULL,
  hour_bucket   TEXT NOT NULL,
  count         INTEGER NOT NULL,
  ip_hash_top   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at   TEXT,
  cold_class    TEXT NOT NULL DEFAULT 'aggregate_telemetry'
);
CREATE INDEX IF NOT EXISTS idx_agg_tele_event ON audit_log_aggregate_telemetry(event_type, hour_bucket);
CREATE INDEX IF NOT EXISTS idx_agg_tele_user  ON audit_log_aggregate_telemetry(user_id, hour_bucket)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agg_tele_archived_at ON audit_log_aggregate_telemetry(archived_at)
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agg_tele_bucket ON audit_log_aggregate_telemetry(
  event_type, COALESCE(user_id, -1), severity, hour_bucket
);

-- F-3 Phase 2 migration 0038 part 4：debug aggregate（PR 3.1 worker 目標表）
-- 0044 補欄：archived_at + cold_class
CREATE TABLE IF NOT EXISTS audit_log_aggregate_debug (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type      TEXT NOT NULL,
  reason_code     TEXT,
  hour_bucket     TEXT NOT NULL,
  total_count     INTEGER NOT NULL,
  sample_count    INTEGER NOT NULL,
  samples_json    TEXT NOT NULL,
  sampled         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  archived_at     TEXT,
  cold_class      TEXT NOT NULL DEFAULT 'aggregate_debug'
);
CREATE INDEX IF NOT EXISTS idx_agg_debug_event ON audit_log_aggregate_debug(event_type, hour_bucket);
CREATE INDEX IF NOT EXISTS idx_agg_debug_archived_at ON audit_log_aggregate_debug(archived_at)
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agg_debug_bucket ON audit_log_aggregate_debug(
  event_type, COALESCE(reason_code, ''), hour_bucket
);

CREATE TABLE IF NOT EXISTS revoked_jti (
  jti        TEXT    PRIMARY KEY,
  expires_at TEXT    NOT NULL,
  revoked_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_kyc (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT    NOT NULL DEFAULT 'unverified',
  level             TEXT    NOT NULL DEFAULT 'basic',
  vendor            TEXT,
  vendor_session_id TEXT,
  vendor_review_id  TEXT,
  rejection_reason  TEXT,
  verified_at       TEXT,
  expires_at        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kyc_webhook_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor       TEXT    NOT NULL,
  event_id     TEXT    NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_to    TEXT,
  payload_hash TEXT,
  processed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, event_id)
);

CREATE TABLE IF NOT EXISTS user_wallets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address       TEXT    NOT NULL,
  chain_id      INTEGER NOT NULL DEFAULT 1,
  nickname      TEXT,
  signed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  UNIQUE(user_id, address)
);

CREATE TABLE IF NOT EXISTS wallet_nonces (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nonce        TEXT    NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address      TEXT    NOT NULL,
  chain_id     INTEGER NOT NULL DEFAULT 1,
  expires_at   TEXT    NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ip_blacklist (
  ip          TEXT    PRIMARY KEY,
  reason      TEXT    NOT NULL,
  blocked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT    NOT NULL,
  hit_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_webauthn_credentials (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id     TEXT    NOT NULL UNIQUE,
  public_key        TEXT    NOT NULL,
  counter           INTEGER NOT NULL DEFAULT 0,
  transports        TEXT,
  aaguid            TEXT,
  nickname          TEXT,
  backup_eligible   INTEGER NOT NULL DEFAULT 0,
  backup_state      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at      TEXT
);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge    TEXT    NOT NULL UNIQUE,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ceremony     TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- payment_intents：對齊 prod migrations 0025 → 0029（P0-2 user_id SET NULL + P0-3 requisition_id FK）→ 0030（FK 修正：requisitions → requisition）
-- 直接建最終 shape，省去測試 setup 跑三次 rebuild
CREATE TABLE IF NOT EXISTS payment_intents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  vendor              TEXT    NOT NULL,
  vendor_intent_id    TEXT    NOT NULL,
  kind                TEXT    NOT NULL DEFAULT 'deposit',
  status              TEXT    NOT NULL DEFAULT 'pending',
  amount_subunit      INTEGER,
  amount_raw          TEXT,
  currency            TEXT    NOT NULL,
  metadata            TEXT,
  failure_reason      TEXT,
  requisition_id      INTEGER REFERENCES requisition(id) ON DELETE SET NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at          TEXT,                                -- 0043 soft delete (Codex r1 P0-1)
  UNIQUE(vendor, vendor_intent_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_deleted_at ON payment_intents(deleted_at);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor        TEXT    NOT NULL,
  event_id      TEXT    NOT NULL,
  intent_id     INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_to     TEXT,
  payload_hash  TEXT,
  apply_status  TEXT    NOT NULL DEFAULT 'applied',  -- 0042: processing|applied|failed
  processed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, event_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_apply_status ON payment_webhook_events(apply_status);

-- migration 0026 + 0027 + 0031 合併最終 shape（amount_subunit 由 0031 ALTER 加入；
-- requisition_id 在 0027 改成 nullable 但 _setup.sql 沒有舊資料壓力，直接建 NULLABLE）
CREATE TABLE IF NOT EXISTS requisition_refund_request (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id  INTEGER REFERENCES requisition(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_id       INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  admin_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_note      TEXT,
  amount_subunit  INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_rrr_status        ON requisition_refund_request(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrr_requisition   ON requisition_refund_request(requisition_id);
CREATE INDEX IF NOT EXISTS idx_rrr_user          ON requisition_refund_request(user_id, created_at DESC);

-- migration 0032: payment_metadata_archive（anonymize 前 metadata snapshot）
CREATE TABLE IF NOT EXISTS payment_metadata_archive (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id         INTEGER NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  original_status   TEXT,
  original_metadata TEXT,
  original_failure_reason TEXT,
  archived_at       TEXT NOT NULL DEFAULT (datetime('now')),
  archived_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason            TEXT
);

-- migration 0033: payment_webhook_dlq（webhook 失敗 dead-letter）
CREATE TABLE IF NOT EXISTS payment_webhook_dlq (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor          TEXT    NOT NULL,
  event_id        TEXT,
  vendor_intent_id TEXT,
  raw_body        TEXT,
  payload_hash    TEXT,
  error_stage     TEXT,
  error_message   TEXT,
  http_status_returned INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  replayed_at     TEXT,
  replayed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  replay_result   TEXT
);

-- migration 0028 deals 表（Phase F-2 wave 8；admin 保存 requisition → deal 成交快照）
CREATE TABLE IF NOT EXISTS deals (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  source_requisition_id    INTEGER REFERENCES requisition(id) ON DELETE SET NULL,
  user_id                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name            TEXT    NOT NULL,
  customer_contact         TEXT    NOT NULL,
  customer_company         TEXT,
  service_type             TEXT,
  budget                   TEXT,
  timeline                 TEXT,
  message                  TEXT,
  total_amount_subunit     INTEGER NOT NULL DEFAULT 0,
  refunded_amount_subunit  INTEGER NOT NULL DEFAULT 0,
  currency                 TEXT    NOT NULL DEFAULT 'TWD',
  payment_intent_ids       TEXT,
  notes                    TEXT,
  saved_by_admin_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  saved_at                 TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_user      ON deals(user_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_req       ON deals(source_requisition_id);
CREATE INDEX IF NOT EXISTS idx_deals_saved_at  ON deals(saved_at DESC);

CREATE TABLE IF NOT EXISTS auth_codes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash       TEXT    NOT NULL UNIQUE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge  TEXT    NOT NULL,
  redirect_uri    TEXT    NOT NULL,
  state           TEXT    NOT NULL,
  scope           TEXT,
  nonce           TEXT,
  auth_time       TEXT,
  expires_at      TEXT    NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- migration 0047: Tenant Foundation（B2B 多租戶平台 PR1）
CREATE TABLE IF NOT EXISTS tenants (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  type                   TEXT    NOT NULL CHECK(type IN ('personal','organization')),
  name                   TEXT    NOT NULL,
  status                 TEXT    NOT NULL DEFAULT 'active'
                                 CHECK(status IN ('active','suspended','closed')),
  personal_owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT,
  CHECK( (type = 'personal'     AND personal_owner_user_id IS NOT NULL)
      OR (type = 'organization' AND personal_owner_user_id IS NULL) ),
  CHECK( type <> 'personal' OR (status = 'active' AND deleted_at IS NULL) )
);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_type   ON tenants(type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_personal_owner
  ON tenants(personal_owner_user_id)
  WHERE type = 'personal';

CREATE TABLE IF NOT EXISTS organization_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  platform_role TEXT    NOT NULL DEFAULT 'member'
                        CHECK(platform_role IN ('tenant_owner','tenant_admin','billing_admin','member')),
  status        TEXT    NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','invited','suspended')),
  joined_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user        ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_tenant_role ON organization_members(tenant_id, platform_role);

-- migration 0048: Billing / Entitlement Foundation (B2B platform PR2)
-- NOTE: append-only is enforced at the app layer (insert-only discipline) with NO DB trigger,
--   matching audit_log / admin_audit_log house style. The resetDb runner splits this file on raw
--   semicolons (no comment stripping), so a trigger body cannot live here AND comments here must
--   contain no semicolon. Seeds are NOT placed here (resetDb wipes them) -- tests seed via helpers.
CREATE TABLE IF NOT EXISTS products (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  tenant_scope TEXT    NOT NULL CHECK(tenant_scope IN ('organization','personal','any')),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id       TEXT    NOT NULL REFERENCES products(id),
  code             TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  features         TEXT,
  included_credits INTEGER NOT NULL DEFAULT 0,
  price_subunit    INTEGER,
  currency         TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, code)
);
CREATE INDEX IF NOT EXISTS idx_plans_product ON plans(product_id);

CREATE TABLE IF NOT EXISTS tenant_product_access (
  tenant_id           INTEGER NOT NULL REFERENCES tenants(id),
  product_id          TEXT    NOT NULL REFERENCES products(id),
  plan_id             INTEGER NOT NULL REFERENCES plans(id),
  status              TEXT    NOT NULL CHECK(status IN ('pending','active','expired','revoked')),
  granted_via         TEXT    NOT NULL CHECK(granted_via IN ('payment','manual')),
  version             INTEGER NOT NULL DEFAULT 1,
  last_op_occurred_at TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (tenant_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_tpa_tenant ON tenant_product_access(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tpa_status ON tenant_product_access(status);

CREATE TABLE IF NOT EXISTS grant_plan_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  product_id TEXT    NOT NULL REFERENCES products(id),
  plan_id    INTEGER NOT NULL REFERENCES plans(id),
  trigger    TEXT    NOT NULL CHECK(trigger IN ('payment','manual')),
  manual_source         TEXT CHECK(manual_source IN ('offline_payment','admin_override')),
  admin_idempotency_key TEXT,
  request_hash          TEXT,
  granted_by            INTEGER,
  granted_by_email      TEXT,
  granted_by_role       TEXT,
  payment_ref           TEXT,
  payment_ref_key       TEXT,
  grant_reason          TEXT,
  payment_intent_id     INTEGER REFERENCES payment_intents(id),
  payment_event_ref     TEXT,
  from_status TEXT NOT NULL CHECK(from_status IN ('none','pending','active','expired','revoked')),
  to_status   TEXT NOT NULL CHECK(to_status   IN ('pending','active','expired','revoked')),
  prev_projection_version INTEGER NOT NULL DEFAULT 0,
  occurred_at TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(admin_idempotency_key),
  UNIQUE(payment_intent_id),
  UNIQUE(tenant_id, product_id, prev_projection_version),
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_gpo_offline_payment_ref_key
  ON grant_plan_operations(payment_ref_key) WHERE manual_source = 'offline_payment';
CREATE INDEX IF NOT EXISTS idx_gpo_tenant_product ON grant_plan_operations(tenant_id, product_id);

-- migration 0049: Credit Wallet + Per-Product Quota + Ledger (B2B platform PR3)
-- NOTE: same constraints as comments above -- this file is split on raw semicolons by resetDb,
--   so comments here must contain no semicolon and there are no DB triggers (append-only is app-layer).
-- NAMING TRAP: credit_wallets is UNRELATED to user_wallets / wallet_nonces (web3 EIP-1193, above).
CREATE TABLE IF NOT EXISTS credit_wallets (
  tenant_id  INTEGER PRIMARY KEY REFERENCES tenants(id),
  balance    INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_wallet_balance_nonneg CHECK(balance >= 0),
  version    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

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

-- migration 0050: invitation + member lifecycle (PR4). invitations (one-time signed invite) +
-- org_create_operations (durable idempotency for POST /api/tenants). No event_outbox (PR5, D1=Option B).
CREATE TABLE IF NOT EXISTS invitations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  email            TEXT    NOT NULL,
  platform_role    TEXT    NOT NULL DEFAULT 'member'
                           CONSTRAINT ck_inv_role CHECK(platform_role IN ('tenant_admin','billing_admin','member')),
  token_hash       TEXT    NOT NULL UNIQUE,
  status           TEXT    NOT NULL DEFAULT 'pending'
                           CONSTRAINT ck_inv_status CHECK(status IN ('pending','accepted','revoked','expired')),
  expires_at       TEXT    NOT NULL,
  invited_by       INTEGER NOT NULL REFERENCES users(id),
  accepted_user_id INTEGER REFERENCES users(id),
  accepted_at      TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT ck_inv_accept_fields CHECK(
        (status =  'accepted' AND accepted_user_id IS NOT NULL AND accepted_at IS NOT NULL)
     OR (status <> 'accepted' AND accepted_user_id IS NULL     AND accepted_at IS NULL) )
);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending
  ON invitations(tenant_id, email) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS org_create_operations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_user_id  INTEGER NOT NULL REFERENCES users(id),
  idempotency_key  TEXT    NOT NULL,
  request_hash     TEXT    NOT NULL,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(creator_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_org_create_ops_tenant ON org_create_operations(tenant_id);

-- migration 0051: event outbox + sequence + dlq + internal deny-state projection (PR5)
CREATE TABLE IF NOT EXISTS event_stream_sequences (
  stream_key TEXT PRIMARY KEY,
  last_seq   INTEGER NOT NULL CONSTRAINT ck_ess_last_seq_pos CHECK(last_seq >= 1),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS event_outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT    NOT NULL UNIQUE,
  event_type      TEXT    NOT NULL CONSTRAINT ck_eo_type CHECK(event_type IN (
                    'member.invited','member.joined','member.suspended','member.reactivated',
                    'member.offboarded','member.role_changed','account.disabled','account.reenabled',
                    'product_access.revoked','product_access.restored','session.revoked')),
  stream_key      TEXT    NOT NULL,
  stream_seq      INTEGER NOT NULL CONSTRAINT ck_eo_seq_pos CHECK(stream_seq > 0),
  tenant_id       INTEGER,
  actor_sub       TEXT,
  occurred_at     TEXT    NOT NULL,
  data_json       TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending'
                    CONSTRAINT ck_eo_status CHECK(status IN ('pending','processing','done','dead')),
  attempts        INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_eo_attempts_nonneg CHECK(attempts >= 0),
  next_attempt_at TEXT    NOT NULL DEFAULT (datetime('now')),
  lease_until     TEXT,
  locked_by       TEXT,
  last_error      TEXT,
  processed_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_eo_stream_seq UNIQUE(stream_key, stream_seq)
);
CREATE INDEX IF NOT EXISTS idx_event_outbox_claim  ON event_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_event_outbox_lease  ON event_outbox(lease_until) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_event_outbox_stream ON event_outbox(stream_key, stream_seq);
CREATE TABLE IF NOT EXISTS event_dlq (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  stream_key  TEXT    NOT NULL,
  stream_seq  INTEGER NOT NULL,
  tenant_id   INTEGER,
  actor_sub   TEXT,
  occurred_at TEXT    NOT NULL,
  data_json   TEXT    NOT NULL,
  dlq_reason  TEXT    NOT NULL
              CONSTRAINT ck_dlq_reason CHECK(dlq_reason IN ('max_attempts','validation_failed','gap_detected')),
  attempts    INTEGER NOT NULL,
  last_error  TEXT,
  failed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  replayed_at TEXT,
  replayed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_event_dlq_pending ON event_dlq(failed_at DESC) WHERE replayed_at IS NULL;
CREATE TABLE IF NOT EXISTS event_deny_state (
  stream_key       TEXT    PRIMARY KEY,
  event_type       TEXT    NOT NULL,
  deny_effect      TEXT    NOT NULL CONSTRAINT ck_eds_effect CHECK(deny_effect IN ('deny','undeny','soft','none')),
  denied           INTEGER NOT NULL CONSTRAINT ck_eds_denied_bool CHECK(denied IN (0,1)),
  tenant_id        INTEGER,
  last_applied_seq INTEGER NOT NULL CONSTRAINT ck_eds_seq_pos CHECK(last_applied_seq > 0),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_deny_state_tenant ON event_deny_state(tenant_id);
