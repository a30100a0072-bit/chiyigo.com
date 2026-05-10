-- Down 0038: 拆 F-3 Phase 2 audit retention 設施
--
-- 注意：SQLite 不支援 ALTER DROP COLUMN（要 rebuild table）；audit_log 兩欄
-- archived_at / cold_class 留著，靠 app 層忽略。down 主要是把新表 + 索引拆掉。

DROP INDEX IF EXISTS idx_audit_log_archived_at;
DROP INDEX IF EXISTS idx_audit_log_cold_id;

DROP INDEX IF EXISTS idx_archive_chunks_state;
DROP INDEX IF EXISTS idx_archive_chunks_purge;
DROP INDEX IF EXISTS idx_archive_chunks_blacklist;
DROP TABLE IF EXISTS audit_archive_chunks;

DROP INDEX IF EXISTS idx_agg_tele_event;
DROP INDEX IF EXISTS idx_agg_tele_user;
DROP INDEX IF EXISTS uniq_agg_tele_bucket;
DROP TABLE IF EXISTS audit_log_aggregate_telemetry;

DROP INDEX IF EXISTS idx_agg_debug_event;
DROP INDEX IF EXISTS uniq_agg_debug_bucket;
DROP TABLE IF EXISTS audit_log_aggregate_debug;
