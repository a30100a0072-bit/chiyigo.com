-- Down migration for 0044
--
-- SQLite 不支援 DROP COLUMN（D1 後續版本才有）。實務上 PR 3.2 archive worker 已寫入
-- chunks row + 標 archived_at，down 拿掉欄會破壞冷存對帳；本檔保留歷史記錄但不執行。
-- 緊急 rollback 走資料庫快照復原，而非 ALTER。
--
-- 若必須走 D1 新版 DROP COLUMN：
--   DROP INDEX IF EXISTS idx_agg_tele_archived_at;
--   DROP INDEX IF EXISTS idx_agg_debug_archived_at;
--   ALTER TABLE audit_log_aggregate_telemetry DROP COLUMN archived_at;
--   ALTER TABLE audit_log_aggregate_telemetry DROP COLUMN cold_class;
--   ALTER TABLE audit_log_aggregate_debug     DROP COLUMN archived_at;
--   ALTER TABLE audit_log_aggregate_debug     DROP COLUMN cold_class;

SELECT 1;
