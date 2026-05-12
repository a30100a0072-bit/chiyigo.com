-- migrations/_base.sql — post-fresh-rebuild baseline @ 2026-05-12
--
-- ⚠️  這不是「最古老 legacy schema」。
--    prod 的 oauth_states / pkce_sessions / requisition 在某次 fresh-rebuild 中被
--    重寫過（從未走 numbered migration ledger），此檔忠實反映 prod **真實 bootstrap
--    起點**，即 0001 套用之前 prod 應該長的樣子。
--
-- 用途：
--   - migration smoke / forward test：_base + 0001..0039 必須對得上 prod snapshot
--   - fresh D1（local / staging / preview）初始化骨架
--   - prod 不會執行此檔（既有資料）
--
-- 不含內容（由 numbered migrations 加入）：
--   users.token_version (0009) / public_sub (0018)
--   requisition.user_id/tg_message_id/status/deleted_at (0001) / source_ip (0006) / owner_* (0036)
--   oauth_states.created_at/ip_address (0004) / nonce (0010) / aud (0013)
--   pkce_sessions.created_at/ip_address (0005) / scope/nonce (0014)
--   refresh_tokens.auth_time (0019) / scope (0035) / issued_aud (0037)
--   auth_codes.scope/nonce (0014) / auth_time (0019)
--   email_verifications 由 0007 DROP + RENAME 重建（baseline 維持 pre-0007 CHECK）
--
-- 歷史 legacy 對照：
--   database/migration_001_requisition_contact.sql 是 pre-numbered 一次性 RENAME 腳本，
--   已標 deprecated；其 RENAME 後形（contact/service_type/message + timeline）併入本 baseline。

PRAGMA defer_foreign_keys=TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- portfolio：無任何 migration 動過
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  description TEXT,
  image_url   TEXT,
  link_url    TEXT,
  tags        TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT    DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- users：strip token_version (0009) / public_sub (0018)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  role            TEXT    NOT NULL DEFAULT 'player',
  status          TEXT    NOT NULL DEFAULT 'active',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- ─────────────────────────────────────────────────────────────────────────────
-- requisition：含 pre-numbered legacy rename + timeline；strip 0001/0006/0036 加的欄
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS requisition (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  contact      TEXT    NOT NULL,
  company      TEXT,
  service_type TEXT    NOT NULL,
  budget       TEXT,
  timeline     TEXT,
  message      TEXT    NOT NULL,
  created_at   TEXT    DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────────────────────────────────────────
-- local_accounts / backup_codes / user_identities / password_resets：無 ALTER
-- ─────────────────────────────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id ON backup_codes(user_id);

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
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- email_verifications：pre-0007 form（CHECK 不含 delete_account）；0007 DROP+RENAME
-- ─────────────────────────────────────────────────────────────────────────────
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

-- ─────────────────────────────────────────────────────────────────────────────
-- refresh_tokens：strip auth_time (0019) / scope (0035) / issued_aud (0037)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  device_info TEXT,
  device_uuid TEXT,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_device  ON refresh_tokens(device_uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- oauth_states：prod 形 state_token TEXT PK；strip 0004/0010/0013 加的欄
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS oauth_states (
  state_token     TEXT    PRIMARY KEY,
  code_verifier   TEXT    NOT NULL,
  redirect_uri    TEXT    NOT NULL,
  platform        TEXT    NOT NULL DEFAULT 'web',
  client_callback TEXT,
  expires_at      TEXT    NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- pkce_sessions：prod 形 session_key TEXT PK；strip 0005/0014 加的欄
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pkce_sessions (
  session_key    TEXT    PRIMARY KEY,
  state          TEXT    NOT NULL,
  code_challenge TEXT    NOT NULL,
  redirect_uri   TEXT    NOT NULL,
  expires_at     TEXT    NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────────
-- auth_codes：strip scope/nonce (0014) / auth_time (0019)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS auth_codes (
  code_hash      TEXT    PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_challenge TEXT    NOT NULL,
  redirect_uri   TEXT    NOT NULL,
  state          TEXT    NOT NULL,
  expires_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_user_id ON auth_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_codes_expires ON auth_codes(expires_at);
