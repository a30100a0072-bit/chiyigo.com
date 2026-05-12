-- Migration 0041: F-3 Phase 2 PR 2.1b — audit_archive_chunks 加 compression 欄
--
-- 背景：PR 2.1b 引入 gzip 壓縮（spike 後 zstd → gzip pivot，詳 docs/AUDIT_RETENTION_PLAN.md
-- PR 2.1b 段）。R2 object 副檔名與 verify 路徑要依 chunk 寫入時的 compression 分支：
--   compression='none' → key '.jsonl'、verify 直接 obj.text() → sha256
--   compression='gzip' → key '.jsonl.gz'、verify obj.arrayBuffer() → DecompressionStream → sha256
--
-- 為何要新欄而非看 manifest.compression：cron worker 在算 R2 key 那一刻沒有 manifest（要先 GET
-- key 才能拿到 manifest，循環）；DB chunks 表是 source of truth。
--
-- DEFAULT 'none' 對齊 PR 2.0 既有行為：prod 既有 dry-run uploaded chunk（row 8-922 telemetry）
-- 仍走原 .jsonl 路徑直到該 chunk 走完 verified；PR 2.1b 之後新 INSERT 顯式帶 'gzip'。
--
-- 不 backfill：既存 row（prod 1 row）就是 'none' 對的，DEFAULT 已對齊。

ALTER TABLE audit_archive_chunks ADD COLUMN compression TEXT NOT NULL DEFAULT 'none';
