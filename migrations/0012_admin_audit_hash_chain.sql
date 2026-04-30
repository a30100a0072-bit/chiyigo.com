-- Migration 0012: admin_audit_log → 雜湊鏈（防竄改）
--
-- 設計：
--   每筆 row_hash = SHA-256( prev_hash || canonical(row) )
--   - prev_hash：前一筆的 row_hash（首筆 = 64 個 0）
--   - canonical(row)：固定欄位順序的 JSON 字串
--   - 任何中間列被竄改 → 後續所有 row_hash 不再 reproducible
--
-- 為何不寫 trigger 自動算：
--   - SQLite trigger 不支援 SHA-256，需在應用層計算後 INSERT
--   - 應用層計算同時可保證 hash 與 row 同 batch 寫入

ALTER TABLE admin_audit_log ADD COLUMN prev_hash TEXT;
ALTER TABLE admin_audit_log ADD COLUMN row_hash  TEXT;

CREATE INDEX IF NOT EXISTS idx_admin_audit_row_hash ON admin_audit_log(row_hash);
