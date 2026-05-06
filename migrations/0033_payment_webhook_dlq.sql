-- Migration 0033: payment webhook dead-letter queue
--
-- T17（Wave 4 觀測層，2026-05-06）：
--   webhook 處理失敗（簽章錯 / DB 例外 / adapter throw）目前只記 audit warn，
--   raw payload 就消失。PSP 重送窗口過了 = 永久掉資料。
--
-- 解法：每次失敗把 raw_body + error 落 DLQ，admin 可手動 replay 或對帳。
--
-- 不用 ON DELETE CASCADE：DLQ 是獨立 cold storage，不依賴 intent / event。

CREATE TABLE IF NOT EXISTS payment_webhook_dlq (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor          TEXT    NOT NULL,
  event_id        TEXT,                              -- 可能解析前就失敗 → null
  vendor_intent_id TEXT,                             -- 可能解析前就失敗 → null
  raw_body        TEXT,                              -- 原始 body（給人/replay 看）
  payload_hash    TEXT,                              -- SHA-256 of raw_body
  error_stage     TEXT,                              -- 'parse' | 'dedupe_insert' | 'create_intent' | 'update_status' | 'audit' | 'unknown'
  error_message   TEXT,                              -- 錯誤摘要（截 1000 字）
  http_status_returned INTEGER,                      -- 回應 PSP 的 HTTP code（PSP 可能會 retry）
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  replayed_at     TEXT,                              -- admin 重跑時間
  replayed_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  replay_result   TEXT                               -- 'ok' | 'failed' + 錯誤摘要
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_dlq_pending  ON payment_webhook_dlq(created_at DESC) WHERE replayed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_payment_webhook_dlq_vendor   ON payment_webhook_dlq(vendor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_webhook_dlq_event    ON payment_webhook_dlq(vendor, event_id);
