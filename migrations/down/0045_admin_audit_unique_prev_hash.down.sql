-- Down migration for 0045
--
-- 移除 UNIQUE INDEX 將重新開啟 CAS race window。
-- 緊急 rollback 才使用；正常流程不該降版（appendAuditLog retry loop 依賴此 invariant）。

DROP INDEX IF EXISTS idx_admin_audit_prev_hash_unique;
