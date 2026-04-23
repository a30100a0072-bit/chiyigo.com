-- CHIYIGO Auth System Schema
-- 零依賴高安規全端認證系統
-- 所有時間欄位使用 ISO 8601 UTC 字串儲存

-- =============================================
-- 核心身分表
-- =============================================

-- 主用戶表（不含密碼，支援 OAuth 擴充）
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT    NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0, -- BOOL: 0=false, 1=true
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

-- 預留 OAuth 身分表（未來擴充 Google / Apple 登入）
CREATE TABLE IF NOT EXISTS user_identities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider    TEXT    NOT NULL, -- 'google', 'apple', 'github' ...
  provider_id TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_id)
);

-- =============================================
-- 狀態與憑證表
-- =============================================

-- 信箱驗證 Token（token_hash 為 PK，防止重複核銷）
CREATE TABLE IF NOT EXISTS email_verifications (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL
);

-- 密碼重設 Token
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

-- 預留 OAuth PKCE State 表（防 CSRF 攻擊）
CREATE TABLE IF NOT EXISTS oauth_states (
  state_token   TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri  TEXT NOT NULL,
  expires_at    TEXT NOT NULL
);

-- =============================================
-- 索引（效能優化）
-- =============================================

CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id    ON backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id  ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);

-- =============================================
-- 訪客綁定遷移（Lazy Registration）
-- 為現有業務表新增 guest 欄位，支援訪客轉正流程。
-- ALTER TABLE 在欄位已存在時會報錯，首次部署前執行一次即可。
-- =============================================

ALTER TABLE requisition ADD COLUMN owner_guest_id TEXT;
ALTER TABLE requisition ADD COLUMN owner_user_id  INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_requisition_guest_id ON requisition(owner_guest_id);
