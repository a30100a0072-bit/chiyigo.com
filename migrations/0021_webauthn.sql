-- Migration 0021: WebAuthn / Passkeys 支援（Phase D-2 Wave A）
--
-- 緣起：
--   Phase D 把行動 App 與金融場景拉進來；passkey 是金融級必備（抗釣魚 +
--   彌補密碼的撞庫風險）。原 roadmap 寫 user_webauthn_credentials 已在
--   Phase 0 建好，實際翻 migrations 0001–0020 沒有任何 webauthn 表，本 migration 補上。
--
-- 設計：
--   - user_webauthn_credentials：
--       一個 user 可綁多把 passkey；以 base64url 形式存 credential_id 方便比對
--       （SimpleWebAuthn 也是 base64url IO）。public_key 以 COSE key bytes
--       存 BLOB（base64url 編碼後存 TEXT，D1 對 BLOB 支援不一致，改用 TEXT 統一）。
--   - webauthn_challenges：
--       register/login 兩種 ceremony 暫存挑戰（5 分鐘 TTL），驗證後立即刪除
--       避免重放。register 必綁 user_id；login 在 usernameless 流程下 user_id
--       可為 NULL。

CREATE TABLE IF NOT EXISTS user_webauthn_credentials (
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

CREATE INDEX IF NOT EXISTS idx_user_webauthn_credentials_user
  ON user_webauthn_credentials(user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  challenge    TEXT    NOT NULL UNIQUE,         -- base64url，作為 lookup key
  user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ceremony     TEXT    NOT NULL,                -- 'register' | 'login'
  expires_at   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires
  ON webauthn_challenges(expires_at);
