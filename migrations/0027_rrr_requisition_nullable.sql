-- Migration 0027: requisition_refund_request.requisition_id 改為 NULLABLE
--
-- 緣起：F-2 wave 7 之後，充值列表加「退款」按鈕。對「沒綁定需求單的 succeeded
--   payment」也要能申請退款；既有 schema 把 requisition_id 鎖 NOT NULL 擋住此情境。
--
-- 做法：SQLite 不能直接 DROP NOT NULL，必須 recreate table。複製資料後 RENAME。
--   FK 從 ON DELETE CASCADE 改 SET NULL — 因 admin 即將支援硬刪 requisition，
--   refund_request 應保留審計痕跡。

CREATE TABLE requisition_refund_request_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id  INTEGER REFERENCES requisition(id) ON DELETE SET NULL,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_id       INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',
  admin_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_note      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at      TEXT
);

INSERT INTO requisition_refund_request_new
  (id, requisition_id, user_id, intent_id, reason, status,
   admin_user_id, admin_note, created_at, decided_at)
SELECT
  id, requisition_id, user_id, intent_id, reason, status,
  admin_user_id, admin_note, created_at, decided_at
FROM requisition_refund_request;

DROP TABLE requisition_refund_request;
ALTER TABLE requisition_refund_request_new RENAME TO requisition_refund_request;

CREATE INDEX IF NOT EXISTS idx_rrr_status      ON requisition_refund_request(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrr_requisition ON requisition_refund_request(requisition_id);
CREATE INDEX IF NOT EXISTS idx_rrr_user        ON requisition_refund_request(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrr_intent      ON requisition_refund_request(intent_id);
