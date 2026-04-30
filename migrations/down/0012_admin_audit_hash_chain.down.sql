-- Down 0012: 移除 admin_audit_log hash 欄位
-- ⚠️ Rollback 後既有 hash 鏈遺失，無法事後驗證歷史完整性
DROP INDEX IF EXISTS idx_admin_audit_row_hash;
ALTER TABLE admin_audit_log DROP COLUMN row_hash;
ALTER TABLE admin_audit_log DROP COLUMN prev_hash;
