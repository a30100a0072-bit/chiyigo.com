-- Migration 0045: admin_audit_log → UNIQUE INDEX on prev_hash (hash chain CAS race fix)
--
-- 背景：原 appendAuditLog (functions/utils/audit-log.ts) 的 SELECT row_hash + INSERT 是
-- 兩步非原子操作。並發場景：
--   - Writer A: SELECT → prev_hash=H_N
--   - Writer B: SELECT → prev_hash=H_N（race window）
--   - A: INSERT row_hash=H_A (with prev=H_N)
--   - B: INSERT row_hash=H_B (with prev=H_N，同 prev！)
--   - 結果：兩列 prev_hash 相同 → verifyAuditChain ASC walk 到 B 列時 prev_hash 不接 A 的 row_hash → 報 chain broken
--
-- 原 author 自留 comment「admin QPS 極低，已接受」(audit-log.ts line 13/52)，codex r1 flag
-- 為 low pre-existing risk。本 migration + appendAuditLog retry loop 一起把 race 從
-- 「設計上接受」升級為「DB-level 強制 atomic」，符合 [[CLAUDE.md §資料庫要求]]
-- 「D1 無 SELECT FOR UPDATE：單表 race 用 CAS（INSERT OR IGNORE + changes() 或 UNIQUE）」紀律。
--
-- Pre-check (2026-05-23)：prod 已驗 SELECT prev_hash, COUNT(*) FROM admin_audit_log
-- GROUP BY prev_hash HAVING COUNT(*)>1 → 0 dup。total=1 row。加 UNIQUE 安全。
--
-- 對 caller 行為：
--   - appendAuditLog (6 sites, 非 batch)：函式內加 retry loop（max 5 attempts，exp backoff 5+15+35+75ms = ~130ms 預算），caller 無感
--   - prepareAppendAuditLog (1 site, batch — admin/audit/[id].ts DELETE)：保留 single-shot；
--     UNIQUE 衝突會 propagate 為 batch failure → caller 既有 catch 回 500 AUDIT_CHAIN_FAILED → admin 重送，
--     比 silent chain corruption 嚴格優於

CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_audit_prev_hash_unique
  ON admin_audit_log(prev_hash);
