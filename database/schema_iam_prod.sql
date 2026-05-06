-- prod D1 schema snapshot (read-only dump)
-- DB: chiyigo_db
-- Generated: 2026-05-06T16:23:47.633Z
-- Source: sqlite_master ; tool: scripts/dump-remote-schema.mjs
-- DO NOT EDIT BY HAND. Re-run the script to refresh.

-- =========================
-- Tables (33)
-- =========================
CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      ) WITHOUT ROWID;

CREATE TABLE admin_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     INTEGER NOT NULL,
  admin_email  TEXT    NOT NULL,
  action       TEXT    NOT NULL,   -- 'ban' | 'unban'
  target_id    INTEGER NOT NULL,
  target_email TEXT    NOT NULL,
  ip_address   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
, prev_hash TEXT, row_hash  TEXT);

CREATE TABLE ai_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER,                -- NULL = 訪客（理論上 AI 頁僅限會員，但保留欄位）
  ip           TEXT,
  fingerprint  TEXT,                   -- 前端瀏覽器指紋（簡易 canvas+UA 雜湊）
  session_id   TEXT,                   -- 同一前端 tab 共用，限制 hourly window
  prompt       TEXT NOT NULL,          -- 使用者輸入（≤ 500 字）
  response     TEXT,                   -- AI 結構化輸出（JSON 序列化）
  model        TEXT,                   -- e.g. @cf/meta/llama-3.1-8b-instruct-fast
  status       TEXT NOT NULL,          -- 'ok' / 'blocked' / 'rate_limited' / 'ai_error' / 'invalid_json'
  block_reason TEXT,                   -- 拒絕原因（黑名單關鍵字 / 長度超限 / 其他）
  duration_ms  INTEGER,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,
  severity    TEXT    NOT NULL DEFAULT 'info',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_id   TEXT,
  ip_hash     TEXT,
  event_data  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK(severity IN ('info','warn','critical'))
);

CREATE TABLE auth_codes (code_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_challenge TEXT NOT NULL, redirect_uri TEXT NOT NULL, state TEXT NOT NULL, expires_at TEXT NOT NULL, scope TEXT, nonce TEXT, auth_time TEXT);

CREATE TABLE backup_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT    NOT NULL,
  used_at   TEXT
);

CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE deals (
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
  total_amount_subunit     INTEGER NOT NULL DEFAULT 0,  -- 加總所有 succeeded intent
  refunded_amount_subunit  INTEGER NOT NULL DEFAULT 0,  -- 加總所有 refunded intent
  currency                 TEXT    NOT NULL DEFAULT 'TWD',
  payment_intent_ids       TEXT,                        -- JSON array of intent ids（成交當下快照）
  notes                    TEXT,
  saved_by_admin_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  saved_at                 TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE "email_verifications" (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  token_type  TEXT    NOT NULL,
  ip_address  TEXT,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK(token_type IN ('verify_email','reset_password','delete_account'))
);

CREATE TABLE ip_blacklist (
  ip          TEXT    PRIMARY KEY,
  reason      TEXT    NOT NULL,
  blocked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT    NOT NULL,
  hit_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE kyc_webhook_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor       TEXT    NOT NULL,
  event_id     TEXT    NOT NULL,                  -- vendor 的 unique event id
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_to    TEXT,                              -- 處理後 user_kyc.status 設成什麼
  payload_hash TEXT,                              -- raw body hash（debug 用）
  processed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, event_id)
);

CREATE TABLE local_accounts (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "login_attempts" (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT,
  email      TEXT,
  kind       TEXT    NOT NULL DEFAULT 'login',
  user_id    INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE oauth_clients (
  client_id                    TEXT    PRIMARY KEY,
  client_name                  TEXT    NOT NULL,
  client_secret_hash           TEXT,           -- NULL = public client (PKCE only)
  app_type                     TEXT    NOT NULL DEFAULT 'web',  -- web / native / mobile
  allowed_redirect_uris        TEXT    NOT NULL,                -- JSON array
  allowed_scopes               TEXT    NOT NULL,                -- JSON array
  allowed_grant_types          TEXT    NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  require_pkce                 INTEGER NOT NULL DEFAULT 1,
  token_endpoint_auth_method   TEXT    NOT NULL DEFAULT 'none', -- none / client_secret_basic / client_secret_post
  post_logout_redirect_uris    TEXT,                            -- JSON array, OIDC RP-Initiated Logout
  frontchannel_logout_uri      TEXT,
  logo_uri                     TEXT,
  client_uri                   TEXT,
  policy_uri                   TEXT,
  tos_uri                      TEXT,
  is_active                    INTEGER NOT NULL DEFAULT 1,
  created_at                   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT    NOT NULL DEFAULT (datetime('now')), aud                       TEXT, cors_origins              TEXT, backchannel_logout_uri    TEXT, frontchannel_logout_uris  TEXT,
  CHECK(app_type IN ('web','native','mobile')),
  CHECK(token_endpoint_auth_method IN ('none','client_secret_basic','client_secret_post'))
);

CREATE TABLE oauth_states (
  state_token     TEXT PRIMARY KEY,
  code_verifier   TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  platform        TEXT NOT NULL DEFAULT 'web',
  client_callback TEXT,
  expires_at      TEXT NOT NULL
, created_at TEXT, ip_address TEXT, nonce TEXT, aud TEXT);

CREATE TABLE password_resets (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL
);

CREATE TABLE "payment_intents" (
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

CREATE TABLE payment_metadata_archive (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id         INTEGER NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  original_status   TEXT,                      -- anonymize 前的 status
  original_metadata TEXT,                      -- anonymize 前的 metadata（原樣 JSON 字串）
  original_failure_reason TEXT,                -- anonymize 前的 failure_reason
  archived_at       TEXT NOT NULL DEFAULT (datetime('now')),
  archived_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- admin user_id
  reason            TEXT                       -- archive 原因（目前固定 'admin_anonymize'）
);

CREATE TABLE payment_webhook_dlq (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor          TEXT    NOT NULL,
  event_id        TEXT,                              -- 可能解析前就失敗 → null
  vendor_intent_id TEXT,                             -- 可能解析前就失敗 → null
  raw_body        TEXT,                              -- 原始 body（給人/replay 看）
  payload_hash    TEXT,                              -- SHA-256 of raw_body
  error_stage     TEXT,                              -- 'parse' | 'dedupe_insert' | 'create_intent' | 'update_status' | 'audit' | 'unknown'
  error_message   TEXT,                              -- 錯誤摘要（截 1000 字）
  http_status_returned INTEGER,                      -- 回應 PSP 的 HTTP code（PSP 可能會 retry）
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  replayed_at     TEXT,                              -- admin 重跑時間
  replayed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  replay_result   TEXT                               -- 'ok' | 'failed' + 錯誤摘要
);

CREATE TABLE payment_webhook_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor        TEXT    NOT NULL,
  event_id      TEXT    NOT NULL,                       -- vendor 的唯一 event id
  intent_id     INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_to     TEXT,                                   -- 處理後 payment_intents.status 設成什麼
  payload_hash  TEXT,                                   -- raw body hash（debug / 對帳）
  processed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, event_id)
);

CREATE TABLE pkce_sessions (session_key TEXT PRIMARY KEY, state TEXT NOT NULL, code_challenge TEXT NOT NULL, redirect_uri TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT, ip_address TEXT, scope TEXT, nonce TEXT);

CREATE TABLE portfolio (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT    NOT NULL,
  category  TEXT    NOT NULL,
  description TEXT,
  image_url TEXT,
  link_url  TEXT,
  tags      TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  device_info TEXT,
  device_uuid TEXT,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT
, auth_time TEXT);

CREATE TABLE requisition (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  contact       TEXT NOT NULL,
  company     TEXT,
  service_type     TEXT NOT NULL,
  budget      TEXT,
  message TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
, owner_guest_id TEXT, owner_user_id  INTEGER REFERENCES users(id), timeline TEXT, user_id INTEGER, tg_message_id INTEGER, status TEXT NOT NULL DEFAULT 'pending', deleted_at TEXT, source_ip TEXT);

CREATE TABLE "requisition_refund_request" (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id  INTEGER REFERENCES requisition(id) ON DELETE SET NULL,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_id       INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',
  admin_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_note      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at      TEXT
, amount_subunit INTEGER);

CREATE TABLE revoked_jti (
  jti        TEXT    PRIMARY KEY,
  expires_at TEXT    NOT NULL,
  revoked_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_identities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT    NOT NULL,
  provider_id  TEXT    NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  metadata     TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_id)
);

CREATE TABLE user_kyc (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT    NOT NULL DEFAULT 'unverified',  -- unverified|pending|verified|rejected|expired
  level             TEXT    NOT NULL DEFAULT 'basic',       -- basic|enhanced
  vendor            TEXT,                                    -- 'sumsub' | 'persona' | 'shinkong' | ...
  vendor_session_id TEXT,                                    -- 對方的 applicant / inquiry id
  vendor_review_id  TEXT,                                    -- 對方那次審核結果 id
  rejection_reason  TEXT,
  verified_at       TEXT,
  expires_at        TEXT,                                    -- 部分 KYC 有時效（如 1 年）
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE user_wallets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address       TEXT    NOT NULL,                 -- lowercase 0x... 42 chars
  chain_id      INTEGER NOT NULL DEFAULT 1,        -- 1=Ethereum mainnet
  nickname      TEXT,                              -- 使用者命名
  signed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  UNIQUE(user_id, address)
);

CREATE TABLE user_webauthn_credentials (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id     TEXT    NOT NULL UNIQUE,    -- base64url
  public_key        TEXT    NOT NULL,           -- base64url(COSE key bytes)
  counter           INTEGER NOT NULL DEFAULT 0,
  transports        TEXT,                       -- JSON array：['internal','hybrid'] 等
  aaguid            TEXT,                       -- attestation 揭露的 authenticator 型號
  nickname          TEXT,                       -- 使用者命名（"我的 iPhone"）
  backup_eligible   INTEGER NOT NULL DEFAULT 0, -- BE flag
  backup_state      INTEGER NOT NULL DEFAULT 0, -- BS flag（已被同步）
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at      TEXT
);

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  role            TEXT    NOT NULL DEFAULT 'player',
  status          TEXT    NOT NULL DEFAULT 'active',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
, token_version INTEGER NOT NULL DEFAULT 0, public_sub TEXT);

CREATE TABLE wallet_nonces (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nonce        TEXT    NOT NULL UNIQUE,            -- SIWE 規範的 random nonce
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address      TEXT    NOT NULL,                   -- 預先承諾要綁的 address
  chain_id     INTEGER NOT NULL DEFAULT 1,
  expires_at   TEXT    NOT NULL,                   -- 5 分鐘 TTL
  consumed_at  TEXT,                                -- 一次性消耗
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE webauthn_challenges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge    TEXT    NOT NULL UNIQUE,         -- base64url，作為 lookup key
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ceremony     TEXT    NOT NULL,                -- 'register' | 'login'
  expires_at   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- =========================
-- Indexes (63)
-- =========================
CREATE INDEX idx_admin_audit_action ON admin_audit_log(action,    created_at);
CREATE INDEX idx_admin_audit_admin  ON admin_audit_log(admin_id,  created_at);
CREATE INDEX idx_admin_audit_row_hash ON admin_audit_log(row_hash);
CREATE INDEX idx_admin_audit_target ON admin_audit_log(target_id, created_at);
CREATE INDEX idx_ai_audit_fingerprint_time ON ai_audit (fingerprint, created_at);
CREATE INDEX idx_ai_audit_ip_time          ON ai_audit (ip, created_at);
CREATE INDEX idx_ai_audit_session_time     ON ai_audit (session_id, created_at);
CREATE INDEX idx_ai_audit_user_time        ON ai_audit (user_id, created_at);
CREATE INDEX idx_audit_log_created_at    ON audit_log(created_at);
CREATE INDEX idx_audit_log_event_created ON audit_log(event_type, created_at);
CREATE INDEX idx_audit_log_severity      ON audit_log(severity, created_at);
CREATE INDEX idx_audit_log_user_created  ON audit_log(user_id, created_at);
CREATE INDEX idx_auth_codes_expires ON auth_codes(expires_at);
CREATE INDEX idx_auth_codes_user_id ON auth_codes(user_id);
CREATE INDEX idx_backup_codes_user_id    ON backup_codes(user_id);
CREATE INDEX idx_deals_req       ON deals(source_requisition_id);
CREATE INDEX idx_deals_saved_at  ON deals(saved_at DESC);
CREATE INDEX idx_deals_user      ON deals(user_id, saved_at DESC);
CREATE INDEX idx_email_verifications_expires ON email_verifications(expires_at);
CREATE INDEX idx_email_verifications_ip      ON email_verifications(ip_address, created_at);
CREATE INDEX idx_email_verifications_user    ON email_verifications(user_id);
CREATE INDEX idx_ip_blacklist_expires ON ip_blacklist(expires_at);
CREATE INDEX idx_kyc_webhook_events_processed ON kyc_webhook_events(processed_at);
CREATE INDEX idx_login_attempts_email       ON login_attempts(email,       created_at);
CREATE INDEX idx_login_attempts_ip          ON login_attempts(ip,          created_at);
CREATE INDEX idx_login_attempts_kind_ip     ON login_attempts(kind, ip,     created_at);
CREATE INDEX idx_login_attempts_kind_time   ON login_attempts(kind,        created_at);
CREATE INDEX idx_login_attempts_kind_user   ON login_attempts(kind, user_id, created_at);
CREATE INDEX idx_oauth_clients_active ON oauth_clients(is_active);
CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
CREATE INDEX idx_oauth_states_ip      ON oauth_states(ip_address, created_at);
CREATE INDEX idx_payment_intents_requisition ON payment_intents(requisition_id) WHERE requisition_id IS NOT NULL;
CREATE INDEX idx_payment_intents_status      ON payment_intents(status);
CREATE INDEX idx_payment_intents_user        ON payment_intents(user_id, created_at DESC);
CREATE INDEX idx_payment_intents_vendor      ON payment_intents(vendor, vendor_intent_id);
CREATE INDEX idx_payment_metadata_archive_archived_at ON payment_metadata_archive(archived_at DESC);
CREATE INDEX idx_payment_metadata_archive_intent ON payment_metadata_archive(intent_id);
CREATE INDEX idx_payment_webhook_dlq_event    ON payment_webhook_dlq(vendor, event_id);
CREATE INDEX idx_payment_webhook_dlq_pending  ON payment_webhook_dlq(created_at DESC) WHERE replayed_at IS NULL;
CREATE INDEX idx_payment_webhook_dlq_vendor   ON payment_webhook_dlq(vendor, created_at DESC);
CREATE INDEX idx_payment_webhook_events_processed ON payment_webhook_events(processed_at);
CREATE INDEX idx_pkce_sessions_expires ON pkce_sessions(expires_at);
CREATE INDEX idx_pkce_sessions_ip      ON pkce_sessions(ip_address, created_at);
CREATE INDEX idx_refresh_tokens_device   ON refresh_tokens(device_uuid);
CREATE INDEX idx_refresh_tokens_user_id  ON refresh_tokens(user_id);
CREATE INDEX idx_requisition_guest_id ON requisition(owner_guest_id);
CREATE INDEX idx_requisition_ip ON requisition(source_ip, created_at);
CREATE INDEX idx_revoked_jti_expires_at ON revoked_jti(expires_at);
CREATE INDEX idx_rrr_intent      ON requisition_refund_request(intent_id);
CREATE INDEX idx_rrr_requisition ON requisition_refund_request(requisition_id);
CREATE INDEX idx_rrr_status      ON requisition_refund_request(status, created_at DESC);
CREATE INDEX idx_rrr_user        ON requisition_refund_request(user_id, created_at DESC);
CREATE INDEX idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX idx_user_kyc_expires  ON user_kyc(expires_at);
CREATE INDEX idx_user_kyc_status   ON user_kyc(status);
CREATE INDEX idx_user_wallets_address   ON user_wallets(address);
CREATE INDEX idx_user_wallets_user      ON user_wallets(user_id);
CREATE INDEX idx_user_webauthn_credentials_user
  ON user_webauthn_credentials(user_id);
CREATE UNIQUE INDEX idx_users_public_sub ON users(public_sub);
CREATE INDEX idx_users_role              ON users(role);
CREATE INDEX idx_users_status            ON users(status);
CREATE INDEX idx_wallet_nonces_expires  ON wallet_nonces(expires_at);
CREATE INDEX idx_webauthn_challenges_expires
  ON webauthn_challenges(expires_at);
