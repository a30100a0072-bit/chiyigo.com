-- Migration 0030: 修正 0029 typo — requisitions → requisition
--
-- 0029 寫了 `REFERENCES requisitions(id)` 但實際表名是單數 `requisition`。
-- SQLite parse FK 不檢查目標表存在，所以 0029 跑成功但 FK 沒實際生效
-- （ON DELETE SET NULL 不會 cascade）。重建表修正。
--
-- 資料保留：第 0029 已 backfill requisition_id；本次只改 FK target，欄位值原樣保留。

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
  requisition_id      INTEGER REFERENCES requisition(id) ON DELETE SET NULL,
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
  -- 0029 已 backfill；但若 requisition_id 指向不存在的 requisition，FK 啟用後 INSERT 會炸
  -- → 用 EXISTS 過濾，孤兒 requisition_id 改回 NULL（不可能 cascade 到的本來就該 NULL）
  CASE
    WHEN requisition_id IS NULL THEN NULL
    WHEN EXISTS (SELECT 1 FROM requisition r WHERE r.id = payment_intents.requisition_id) THEN requisition_id
    ELSE NULL
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
