-- Migration 0044: F-3 Phase 2 PR 3.2 — aggregate 兩表加冷存所需欄位
--
-- 範圍：
--   1. audit_log_aggregate_telemetry / audit_log_aggregate_debug 各加 archived_at + cold_class
--   2. archived_at 走 PR 3.2 月度 aggregate→R2 worker 標記；NULL = 未冷存（worker 過濾條件）
--   3. cold_class 是常數欄（per table 固定一值），與 audit_archive_chunks 對齊；
--      用 DEFAULT + NOT NULL 寫死，無需 backfill UPDATE（新欄、所有現有 row 同一類）
--   4. 兩個全新 cold_class 值（aggregate_telemetry / aggregate_debug）— 不撞 audit_log 既有 6
--      class；R2 prefix 與 retention lock 也各自獨立（audit-log-aggregate-{telemetry,debug}/）
--
-- 設計 trade-off：
--   - 為何要 cold_class 欄而不是 worker 端寫死：aggregate archive worker 與 audit_log archive
--     worker 共用 audit_archive_chunks 表；chunks row 用 cold_class 區分來源表（PR 3.2 +
--     PR 4 reconcile 都靠這欄 disambiguate），SELECT/JOIN 都不需另傳常數。
--   - archived_at 同 audit_log 邏輯（migration 0038 part 1）：worker INSERT chunks row +
--     UPDATE aggregate row 用同一個 SQLite datetime('now')；PR 4 真刪由 archived_at 驅動
--     marked_archived→purged lifecycle。
--   - 為何沒 cold_class_version：aggregate 表本身不走 audit-policy classify（cold_class 固定），
--     沒有 policy 改動造成歷史 chunk 語義模糊的問題。
--   - 不加 CHECK 約束：SQLite ALTER+CHECK 在 D1 行為較不確定；走 app 層 worker INSERT 寫死
--     對齊 DEFAULT 值（與 0038 audit_log cold_class 同 trade-off）。
--
-- 不 backfill：兩表是 PR 3.0 / PR 3.1 才建（migration 0038 part 4），prod 已 deploy 後
-- 月底跑 PR 3.0/3.1 aggregate worker 才會寫入 row；目前 prod row 數 ~0~少量；DEFAULT 都對。

-- ── Part 1：audit_log_aggregate_telemetry ──
ALTER TABLE audit_log_aggregate_telemetry ADD COLUMN archived_at TEXT;
ALTER TABLE audit_log_aggregate_telemetry ADD COLUMN cold_class  TEXT NOT NULL DEFAULT 'aggregate_telemetry';

-- worker 過濾 unarchived row 走這 index；partial index 縮量
CREATE INDEX IF NOT EXISTS idx_agg_tele_archived_at
  ON audit_log_aggregate_telemetry(archived_at)
  WHERE archived_at IS NULL;

-- ── Part 2：audit_log_aggregate_debug ──
ALTER TABLE audit_log_aggregate_debug ADD COLUMN archived_at TEXT;
ALTER TABLE audit_log_aggregate_debug ADD COLUMN cold_class  TEXT NOT NULL DEFAULT 'aggregate_debug';

CREATE INDEX IF NOT EXISTS idx_agg_debug_archived_at
  ON audit_log_aggregate_debug(archived_at)
  WHERE archived_at IS NULL;
