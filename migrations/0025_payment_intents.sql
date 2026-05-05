-- Migration 0025: Payment scaffold（Phase F-2）
--
-- 緣起：
--   金流 webhook 接 PSP（Stripe / TapPay / 綠界 / mock）vendor-agnostic schema。
--   F-1 KYC 等同 pattern；amount 雙欄位（subunit INTEGER / raw TEXT）支援法幣 + 鏈上。
--
-- 故意不做（YAGNI，等真接 PSP 才知道對帳模型）：
--   - payment_ledger 雙記帳 — 充值 vs 訂閱 vs 一次性付款場景不同，先不鎖死
--   - balance 表 — 沒人付款，先不囤
--   - 退款 / chargeback 流程
--
-- 表設計：
--   payment_intents — 一筆 PSP intent 一 row；UNIQUE(vendor, vendor_intent_id)
--                     確保 webhook 重送只更新 status，不重複建 row
--   payment_webhook_events — dedupe (vendor, event_id)，鏡射 kyc_webhook_events

CREATE TABLE IF NOT EXISTS payment_intents (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vendor              TEXT    NOT NULL,                 -- 'mock' | 'stripe' | 'tappay' | 'ecpay' | ...
  vendor_intent_id    TEXT    NOT NULL,                 -- PSP 那邊的 payment_intent_id
  kind                TEXT    NOT NULL DEFAULT 'deposit',  -- deposit|withdraw|subscription|refund
  status              TEXT    NOT NULL DEFAULT 'pending',  -- pending|processing|succeeded|failed|canceled|refunded
  amount_subunit      INTEGER,                          -- 法幣最小單位（TWD 分 / USD cent）；鏈上交易 NULL
  amount_raw          TEXT,                             -- 鏈上交易 decimal string（18 decimals 放不下 INTEGER）；法幣 NULL
  currency            TEXT    NOT NULL,                 -- 'TWD' | 'USD' | 'ETH' | 'USDT' | ...
  metadata            TEXT,                             -- JSON（vendor 特定欄位 / order_id / 自訂 tag）
  failure_reason      TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, vendor_intent_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_user     ON payment_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_intents_status   ON payment_intents(status);
CREATE INDEX IF NOT EXISTS idx_payment_intents_vendor   ON payment_intents(vendor, vendor_intent_id);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor        TEXT    NOT NULL,
  event_id      TEXT    NOT NULL,                       -- vendor 的唯一 event id
  intent_id     INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_to     TEXT,                                   -- 處理後 payment_intents.status 設成什麼
  payload_hash  TEXT,                                   -- raw body hash（debug / 對帳）
  processed_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, event_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_processed ON payment_webhook_events(processed_at);
