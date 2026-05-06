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
  auth_time   TEXT
);

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
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
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
  UNIQUE(vendor, vendor_intent_id)
);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor        TEXT    NOT NULL,
  event_id      TEXT    NOT NULL,
  intent_id     INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_to     TEXT,
  payload_hash  TEXT,
  processed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, event_id)
);

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
