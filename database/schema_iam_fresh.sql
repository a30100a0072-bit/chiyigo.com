-- CHIYIGO IAM — 全量建表 Schema（全新 D1 初始化專用）
-- 包含所有欄位的最終狀態，不含 ALTER TABLE 遷移段。
-- 既有部署請改用 schema_auth.sql 底部的遷移腳本。

-- ── 核心身分表 ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  role            TEXT    NOT NULL DEFAULT 'player',
  status          TEXT    NOT NULL DEFAULT 'active',
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

CREATE TABLE IF NOT EXISTS user_identities (
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

-- ── 狀態與憑證表 ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  device_info TEXT,
  device_uuid TEXT,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state_token     TEXT PRIMARY KEY,
  code_verifier   TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  platform        TEXT NOT NULL DEFAULT 'web',
  client_callback TEXT,
  expires_at      TEXT NOT NULL
);

-- ── 索引 ─────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id    ON backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id  ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_device   ON refresh_tokens(device_uuid);
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_users_status            ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role              ON users(role);
CREATE INDEX IF NOT EXISTS idx_requisition_guest_id    ON requisition(owner_guest_id);

-- ── 訪客綁定欄位（requisition 已存在，補加兩個欄位）────────────

ALTER TABLE requisition ADD COLUMN owner_guest_id TEXT;
ALTER TABLE requisition ADD COLUMN owner_user_id  INTEGER REFERENCES users(id);
