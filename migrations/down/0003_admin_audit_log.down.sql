-- Down 0003: 移除 admin_audit_log 表
-- ⚠️ 資料遺失：所有 admin 操作稽核記錄會被丟棄（合規時請先匯出）

DROP INDEX IF EXISTS idx_admin_audit_action;
DROP INDEX IF EXISTS idx_admin_audit_target;
DROP INDEX IF EXISTS idx_admin_audit_admin;
DROP TABLE IF EXISTS admin_audit_log;
