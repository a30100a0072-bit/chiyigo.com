-- Migration 0039: F-3 Phase 2 PR 2.1c — audit_archive_chunks 加 dry_run 欄
--
-- 修 codex review H-1（dry-run / live provenance）：
--   PR 2.0 + 2.1a chunks 不記自己當初是 dry-run 還是 live；
--   deriveKeysFromChunk 用「當前 AUDIT_ARCHIVE_DRY_RUN env」算 R2 key，
--   PR 4 flip flag 後同一 chunk 會混 dryrun + live prefix → marked_archived
--   manifest 寫去 live prefix，但 data 物件其實只存在 dryrun prefix，
--   cron-purge-worker 走後資料就 silent 損毀。
--
-- 修法：chunks row 自己記 dry_run；deriveKeysFromChunk 改吃 row.dry_run。
--   DEFAULT 0 對齊 PR 4 endgame（live）。既存 row 在 PR 2.0/2.1a 階段全部
--   都是 dry-run，backfill UPDATE 補回 1，保留正確 provenance。
--
-- backfill 安全性：UPDATE 不附 WHERE → 套到所有既存 row，這在 prod 階段是
-- 對的（PR 2.0 沒有任何 live 路徑、AUDIT_ARCHIVE_DRY_RUN 一直 = 'true'）。
-- 之後 PR 4 之後新 INSERT 全部顯式帶 dry_run，不依賴 DEFAULT。

ALTER TABLE audit_archive_chunks ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0;

UPDATE audit_archive_chunks SET dry_run = 1;
