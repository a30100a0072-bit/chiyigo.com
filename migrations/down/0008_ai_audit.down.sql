-- Down 0008: 移除 ai_audit 表
-- ⚠️ 資料遺失：所有 AI 助手稽核 / 限流計數記錄會被丟棄

DROP INDEX IF EXISTS idx_ai_audit_user_time;
DROP INDEX IF EXISTS idx_ai_audit_fingerprint_time;
DROP INDEX IF EXISTS idx_ai_audit_session_time;
DROP INDEX IF EXISTS idx_ai_audit_ip_time;
DROP TABLE IF EXISTS ai_audit;
