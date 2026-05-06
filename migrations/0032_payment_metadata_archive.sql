-- Migration 0032: payment_metadata_archive
--
-- T12（金流邏輯強化計畫，2026-05-06）：
--   anonymize 路徑會清空 payment_intents.metadata + failure_reason，避免 admin token
--   外洩 = 全清。但合規 / dispute 需要原始 metadata 可追溯，因此 anonymize 前
--   把 metadata + failure_reason snapshot 一份到此 archive，admin 帶 step-up 才能看。
--
-- 為什麼分開放：
--   - payment_intents 是 hot table，要保持精簡；archive 是 cold storage
--   - archive 訪問頻率極低（dispute / 法遵抽查才看）
--   - 用 ON DELETE CASCADE：intent 真的 hard delete 時 archive 一起清（極少發生，
--     因為 succeeded/refunded 已鎖死，hard delete 只剩 pending/failed/canceled）

CREATE TABLE IF NOT EXISTS payment_metadata_archive (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id         INTEGER NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  original_status   TEXT,                      -- anonymize 前的 status
  original_metadata TEXT,                      -- anonymize 前的 metadata（原樣 JSON 字串）
  original_failure_reason TEXT,                -- anonymize 前的 failure_reason
  archived_at       TEXT NOT NULL DEFAULT (datetime('now')),
  archived_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- admin user_id
  reason            TEXT                       -- archive 原因（目前固定 'admin_anonymize'）
);

CREATE INDEX IF NOT EXISTS idx_payment_metadata_archive_intent ON payment_metadata_archive(intent_id);
CREATE INDEX IF NOT EXISTS idx_payment_metadata_archive_archived_at ON payment_metadata_archive(archived_at DESC);
