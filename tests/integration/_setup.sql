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
