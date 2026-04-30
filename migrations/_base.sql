-- _base.sql — 0001 之前的 schema 快照
-- 僅用於 migration smoke test（tests/integration/migrations.test.js）
-- 內含 0001–0008 ALTER 對象的最小 pre-migration shape；prod 不會執行此檔

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  role            TEXT    NOT NULL DEFAULT 'player',
  status          TEXT    NOT NULL DEFAULT 'active',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);

CREATE TABLE IF NOT EXISTS requisition (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_guest_id  TEXT,
  owner_user_id   INTEGER,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_states (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  state_token     TEXT    NOT NULL UNIQUE,
  code_verifier   TEXT,
  redirect_uri    TEXT,
  platform        TEXT,
  client_callback TEXT,
  expires_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS pkce_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pkce_key        TEXT    NOT NULL UNIQUE,
  code_challenge  TEXT    NOT NULL,
  expires_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS email_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  token_type  TEXT    NOT NULL,
  ip_address  TEXT,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK(token_type IN ('verify_email','reset_password'))
);
