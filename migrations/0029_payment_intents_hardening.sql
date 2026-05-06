-- Migration 0029: Payment intents 完整性強化（P0-2 + P0-3）
--
-- 兩個變更合一個 migration（SQLite 不支援 ALTER 改 FK，要 rebuild table）：
--
-- P0-2: user_id 改 ON DELETE SET NULL
--   原因：user 自刪帳號時不能讓金流憑證跟著消失（法遵 / 對帳 / 退款追溯）
--   後果：被孤兒化的 intent 仍可由 admin 用 vendor_intent_id 查回 PSP 對帳
--
-- P0-3: 新增 requisition_id FK 欄位 + backfill from metadata
--   原因：原本 admin requisition delete 用 LIKE '%"requisition_id":N%' 掃 metadata
--         會被前綴誤判（id=12 撞到 id=120）；metadata 是純 JSON 文字無 schema
--   後果：admin-requisitions delete 檢查 + dashboard payment list 都改 FK join，
--         查詢更快、判斷更準
--
-- 因為要重建表，順便恢復索引。

PRAGMA foreign_keys = OFF;

CREATE TABLE payment_intents_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  vendor              TEXT    NOT NULL,
  vendor_intent_id    TEXT    NOT NULL,
  kind                TEXT    NOT NULL DEFAULT 'deposit',
  status              TEXT    NOT NULL DEFAULT 'pending',
  amount_subunit      INTEGER,
  amount_raw          TEXT,
  currency            TEXT    NOT NULL,
  metadata            TEXT,
  failure_reason      TEXT,
  requisition_id      INTEGER REFERENCES requisitions(id) ON DELETE SET NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, vendor_intent_id)
);

INSERT INTO payment_intents_new
  (id, user_id, vendor, vendor_intent_id, kind, status,
   amount_subunit, amount_raw, currency, metadata, failure_reason,
   requisition_id, created_at, updated_at)
SELECT
  id, user_id, vendor, vendor_intent_id, kind, status,
  amount_subunit, amount_raw, currency, metadata, failure_reason,
  -- backfill requisition_id：metadata 若是合法 JSON 且有 requisition_id 欄位才取
  CASE
    WHEN metadata IS NULL OR metadata = '' THEN NULL
    WHEN json_valid(metadata) = 0 THEN NULL
    ELSE CAST(json_extract(metadata, '$.requisition_id') AS INTEGER)
  END,
  created_at, updated_at
FROM payment_intents;

DROP TABLE payment_intents;
ALTER TABLE payment_intents_new RENAME TO payment_intents;

CREATE INDEX idx_payment_intents_user        ON payment_intents(user_id, created_at DESC);
CREATE INDEX idx_payment_intents_status      ON payment_intents(status);
CREATE INDEX idx_payment_intents_vendor      ON payment_intents(vendor, vendor_intent_id);
CREATE INDEX idx_payment_intents_requisition ON payment_intents(requisition_id) WHERE requisition_id IS NOT NULL;

PRAGMA foreign_keys = ON;
