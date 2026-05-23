-- Down migration for 0046：把 key_scheme + last_manifest_state 拿掉。
--
-- 與 0039 / 0041 down 相同警語：D1 ≥ 3.39 支援 ALTER DROP COLUMN，但 partial index 或
-- 外部 ref 可能 fail；安全 down 走 rebuild + INSERT-SELECT + rename pattern（參考
-- migration 0044 Part 3 寫法）。
--
-- 不建議自動 rollback：key_scheme=2 chunk 的 R2 物件分散在 4 個 distinct key（.planned /
-- .uploaded / .verified / .marked_archived.json）；down 後 worker 用 legacy single-key
-- 路徑會找不到 manifest，新一輪 cron 進 handleUploadedBlocker 時 loadAndAppend
-- bucket.get(manifestKey) 拿 null → 降級 fallback 寫 minimal manifest 覆寫，
-- 等同丟失 state_history forensic 軌跡。
--
-- 真要 rollback PR 0.2c-pre-1a 必須配套：
--   1) 找出所有 key_scheme=2 chunks（SELECT WHERE key_scheme=2）
--   2) 對每個 chunk 把對應 4 個 R2 manifest 合併回單一 key（用最新 state 那份 + 完整
--      state_history）
--   3) 確認所有 R2 prefix 仍未上 retention lock（lock 上後此合併步驟做不了）
--   4) 才能跑這個 down
--
-- 在這之前直接 down 會 silently 損毀 forensic trail。

ALTER TABLE audit_archive_chunks DROP COLUMN last_manifest_state;
ALTER TABLE audit_archive_chunks DROP COLUMN key_scheme;
