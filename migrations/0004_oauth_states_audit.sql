-- Migration 0004: oauth_states 稽核欄位
-- 補上 created_at / ip_address，使 OAuth 流程可被追溯。
-- email_verifications / password_resets 已於 prod 手動 ALTER 完成（schema_auth.sql 同步更新中），不在此處重複。

-- SQLite ALTER TABLE 不允許 non-constant DEFAULT，改為 nullable，由應用層填值。
ALTER TABLE oauth_states ADD COLUMN created_at TEXT;
ALTER TABLE oauth_states ADD COLUMN ip_address TEXT;

-- 既有資料 backfill 為當下時間（避免後續 NULL 造成查詢混亂）
UPDATE oauth_states SET created_at = datetime('now') WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_oauth_states_ip      ON oauth_states(ip_address, created_at);

-- 同步 email_verifications 缺漏的索引（PRIMARY KEY 為 id，以下為查詢熱路徑）
CREATE INDEX IF NOT EXISTS idx_email_verifications_user    ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verifications_ip      ON email_verifications(ip_address, created_at);
