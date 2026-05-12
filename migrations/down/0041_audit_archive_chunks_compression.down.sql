-- Down migration for 0041：把 compression 欄拿掉。
-- 與 0039 down 同樣警語：D1 ≥ 3.39 ALTER DROP COLUMN 可能因 INDEX 失敗。
--
-- 安全 down 路徑（手動）：先把所有 compression='gzip' 的 chunk 走完整個 state
-- machine（→ marked_archived → purge），再 DROP；否則 worker 走舊 .jsonl 路徑
-- 對 .jsonl.gz 物件會 sha 不過 → 卡 failed。

ALTER TABLE audit_archive_chunks DROP COLUMN compression;
