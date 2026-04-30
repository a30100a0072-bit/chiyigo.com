-- Down 0004: 移除 oauth_states 稽核欄位 + 連帶索引
-- ⚠️ 資料遺失：oauth_states.created_at / ip_address 會被丟棄
-- 同時移除 0004 加上的 email_verifications 索引（欄位本身在更早 schema 已存在）

DROP INDEX IF EXISTS idx_email_verifications_ip;
DROP INDEX IF EXISTS idx_email_verifications_expires;
DROP INDEX IF EXISTS idx_email_verifications_user;
DROP INDEX IF EXISTS idx_oauth_states_ip;
DROP INDEX IF EXISTS idx_oauth_states_expires;

ALTER TABLE oauth_states DROP COLUMN ip_address;
ALTER TABLE oauth_states DROP COLUMN created_at;
