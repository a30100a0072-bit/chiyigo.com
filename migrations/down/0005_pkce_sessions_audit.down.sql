-- Down 0005: 移除 pkce_sessions 稽核欄位 + 連帶索引
-- ⚠️ 資料遺失：pkce_sessions.created_at / ip_address 會被丟棄

DROP INDEX IF EXISTS idx_pkce_sessions_ip;
DROP INDEX IF EXISTS idx_pkce_sessions_expires;

ALTER TABLE pkce_sessions DROP COLUMN ip_address;
ALTER TABLE pkce_sessions DROP COLUMN created_at;
