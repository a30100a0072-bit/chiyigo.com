-- Migration 0005: pkce_sessions 稽核欄位
-- 補上 ip_address / created_at，使 PKCE 授權流程可被追溯。
-- SQLite ALTER TABLE 不允許 non-constant DEFAULT，故 created_at 設 nullable，由應用層填值。

ALTER TABLE pkce_sessions ADD COLUMN created_at TEXT;
ALTER TABLE pkce_sessions ADD COLUMN ip_address TEXT;

UPDATE pkce_sessions SET created_at = datetime('now') WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pkce_sessions_expires ON pkce_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_pkce_sessions_ip      ON pkce_sessions(ip_address, created_at);
