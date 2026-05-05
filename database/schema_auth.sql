-- CHIYIGO Auth System Schema
-- 零依賴高安規全端認證系統
-- 所有時間欄位使用 ISO 8601 UTC 字串儲存

-- =============================================
-- 核心身分表
-- =============================================

-- 主用戶表（不含密碼，支援 OAuth 擴充）
-- role   : 'player' | 'moderator' | 'admin' | 'developer'
-- status : 'active' | 'banned' | 'suspended'
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,     -- BOOL: 0=false, 1=true
  role            TEXT    NOT NULL DEFAULT 'player',
  status          TEXT    NOT NULL DEFAULT 'active',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at      TEXT    -- Soft delete 標記
);

-- 本地帳號密碼表（與 users 1:1）
CREATE TABLE IF NOT EXISTS local_accounts (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  totp_secret   TEXT,           -- NULL = 尚未設定 2FA
  totp_enabled  INTEGER NOT NULL DEFAULT 0 -- BOOL: 兩階段啟用後才設為 1
);

-- 2FA 一次性備用救援碼（已使用不刪除，以 used_at 標記）
CREATE TABLE IF NOT EXISTS backup_codes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT    NOT NULL,
  used_at   TEXT    -- NULL = 未使用
);

-- OAuth / 第三方平台身分表
-- provider 支援：'google' | 'apple' | 'github' | 'steam' | 'discord' | 'epic'
-- display_name : 該平台的顯示名稱（Steam 暱稱、Discord Tag 等）
-- avatar_url   : 該平台的頭像 URL
-- metadata     : JSON 字串，存放平台特定資料（Steam 等級、Discord guild 等）
CREATE TABLE IF NOT EXISTS user_identities (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT    NOT NULL,
  provider_id  TEXT    NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  metadata     TEXT,            -- JSON string
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_id)
);

-- =============================================
-- 狀態與憑證表
-- =============================================

-- 信箱驗證 / 密碼重設 / 刪除帳號 Token（合併表，以 token_type 區分）
-- 與 prod 實際結構同步（migration 0004 之前已手動 ALTER）
CREATE TABLE IF NOT EXISTS email_verifications (
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

-- LEGACY：舊 password_resets 表，現由 email_verifications + token_type 取代。
-- 保留以避免 DROP 影響歷史資料；新流程不再寫入。
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL
);

-- 長效 Refresh Token（支援多裝置、可撤銷）
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  device_info TEXT,
  expires_at  TEXT    NOT NULL,
  revoked_at  TEXT    -- NULL = 有效
);

-- OAuth PKCE State 表（防 CSRF / 防重放）
CREATE TABLE IF NOT EXISTS oauth_states (
  state_token     TEXT PRIMARY KEY,
  code_verifier   TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  platform        TEXT NOT NULL DEFAULT 'web',
  client_callback TEXT,
  expires_at      TEXT NOT NULL,
  created_at      TEXT,
  ip_address      TEXT
);

-- =============================================
-- 索引（效能優化）
-- =============================================

CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id        ON backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id      ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id     ON user_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user    ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verifications_ip      ON email_verifications(ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires        ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_ip             ON oauth_states(ip_address, created_at);

-- =============================================
-- 訪客綁定遷移（Lazy Registration）
-- 為現有業務表新增 guest 欄位，支援訪客轉正流程。
-- ALTER TABLE 在欄位已存在時會報錯，首次部署前執行一次即可。
-- =============================================

ALTER TABLE requisition ADD COLUMN owner_guest_id TEXT;
ALTER TABLE requisition ADD COLUMN owner_user_id  INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_requisition_guest_id ON requisition(owner_guest_id);

-- =============================================
-- 遊戲平台擴充遷移（既有部署執行一次）
-- =============================================

ALTER TABLE users ADD COLUMN role   TEXT NOT NULL DEFAULT 'player';
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE user_identities ADD COLUMN display_name TEXT;
ALTER TABLE user_identities ADD COLUMN avatar_url   TEXT;
ALTER TABLE user_identities ADD COLUMN metadata     TEXT;
ALTER TABLE user_identities ADD COLUMN updated_at   TEXT NOT NULL DEFAULT (datetime('now'));

CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

-- =============================================
-- 遊戲端登入擴充遷移（既有部署執行一次）
-- =============================================

-- refresh_tokens: 以 device_uuid 取代 device_info 進行硬體綁定
ALTER TABLE refresh_tokens ADD COLUMN device_uuid TEXT;

-- oauth_states: 儲存平台類型與最終客戶端回呼 URI
ALTER TABLE oauth_states ADD COLUMN platform        TEXT NOT NULL DEFAULT 'web';
ALTER TABLE oauth_states ADD COLUMN client_callback TEXT;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_device ON refresh_tokens(device_uuid);

-- =============================================
-- WebAuthn / Passkeys（migration 0021，Phase D-2）
-- =============================================

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

CREATE INDEX IF NOT EXISTS idx_user_webauthn_credentials_user
  ON user_webauthn_credentials(user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge    TEXT    NOT NULL UNIQUE,
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ceremony     TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires
  ON webauthn_challenges(expires_at);
