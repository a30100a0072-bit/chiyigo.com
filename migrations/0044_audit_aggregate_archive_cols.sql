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

-- ── Part 3：rebuild audit_archive_chunks 放寬 cold_class CHECK ──
--
-- 背景：0038 Part 3 把 audit_archive_chunks.cold_class CHECK 鎖在既有 6 class
--   ('immutable','security_critical','security_warn','read_audit','telemetry','debug_failure')
-- PR 3.2 aggregate→R2 worker 要 INSERT 兩個全新 cold_class（'aggregate_telemetry' /
-- 'aggregate_debug'），不放寬會被 D1 CHECK 擋掉（codex P1）。
--
-- 設計：cold_class CHECK 整個拿掉，與 0038 對 audit_log.cold_class 的設計一致
--   （0038 註：「cold_class 不在 ALTER 加 CHECK：SQLite ALTER+CHECK 在 D1 行為較
--    不確定；改靠 app 層 classifyForCold() + safeUserAudit 寫入路徑保證合法值」）。
-- aggregate 端走 INSERT 寫死字面常數（與 migration 0044 Part 1/2 DEFAULT 對齊），
-- 兩 worker 各自 lint test 防 drift。
--
-- SQLite 不支援 ALTER 改 CHECK / DROP CONSTRAINT → 走「rebuild + INSERT-SELECT + 換名」
-- pattern。state CHECK 保留（state machine 仍嚴格 8 態）。所有 index 重建。
-- 既有 row 全保留（prod 已有 PR 2.x telemetry chunk row；prod 部署時 D1 migration runner
-- 跑完即完成 swap）。
--
-- ⚠️ 部署順序：本 migration 必須 D1 apply 後才能上 cron handler；裸 INSERT 'aggregate_*'
-- 進舊 CHECK 仍會 fail。Pages deploy + D1 migration 走 reference_pages_deploy_with_d1_migration
-- 流程。

CREATE TABLE audit_archive_chunks__rebuild_0044 (
  env                TEXT    NOT NULL,
  table_name         TEXT    NOT NULL,
  cold_class         TEXT    NOT NULL,                -- 0044：CHECK 移除，aggregate_* 走 app 層
  cold_class_version INTEGER NOT NULL DEFAULT 1,
  archive_date       TEXT    NOT NULL,
  min_id             INTEGER NOT NULL,
  max_id             INTEGER NOT NULL,
  chunk_sha256       TEXT    NOT NULL,
  state              TEXT    NOT NULL
                     CHECK(state IN ('planned','uploaded','verified','marked_archived','purged','cold_copied','failed','blacklisted')),
  row_count          INTEGER NOT NULL,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  last_failure_at    TEXT,
  last_failure       TEXT,
  next_reminder_at   TEXT,
  blacklisted_at     TEXT,
  marked_archived_at TEXT,
  purge_after        TEXT,
  cold_copied_at     TEXT,
  run_id             TEXT    NOT NULL,
  dry_run            INTEGER NOT NULL DEFAULT 0,
  compression        TEXT    NOT NULL DEFAULT 'none',
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256)
);

INSERT INTO audit_archive_chunks__rebuild_0044
  (env, table_name, cold_class, cold_class_version, archive_date,
   min_id, max_id, chunk_sha256, state, row_count, retry_count,
   last_failure_at, last_failure, next_reminder_at, blacklisted_at,
   marked_archived_at, purge_after, cold_copied_at, run_id,
   dry_run, compression, created_at, updated_at)
SELECT
   env, table_name, cold_class, cold_class_version, archive_date,
   min_id, max_id, chunk_sha256, state, row_count, retry_count,
   last_failure_at, last_failure, next_reminder_at, blacklisted_at,
   marked_archived_at, purge_after, cold_copied_at, run_id,
   dry_run, compression, created_at, updated_at
  FROM audit_archive_chunks;

DROP TABLE audit_archive_chunks;
ALTER TABLE audit_archive_chunks__rebuild_0044 RENAME TO audit_archive_chunks;

-- Recreate indexes（與 0038 Part 3 完全對齊；rebuild 後 SQLite 不會自動帶舊 index）
CREATE INDEX IF NOT EXISTS idx_archive_chunks_state
  ON audit_archive_chunks(state, table_name, cold_class);
CREATE INDEX IF NOT EXISTS idx_archive_chunks_purge
  ON audit_archive_chunks(state, purge_after)
  WHERE state = 'marked_archived';
CREATE INDEX IF NOT EXISTS idx_archive_chunks_blacklist
  ON audit_archive_chunks(blacklisted_at)
  WHERE blacklisted_at IS NOT NULL;
