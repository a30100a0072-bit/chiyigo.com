-- Minimal schema subset for reset-password / forgot-password integration tests.
-- Mirrors database/schema_auth.sql but only the tables this flow touches.

CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  role            TEXT    NOT NULL DEFAULT 'player',
  status          TEXT    NOT NULL DEFAULT 'active',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE TABLE local_accounts (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  totp_secret   TEXT,
  totp_enabled  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE backup_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT    NOT NULL,
  used_at   TEXT
);

CREATE TABLE email_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  token_type  TEXT    NOT NULL,
  ip_address  TEXT,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  device_info TEXT,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT
);
