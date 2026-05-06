-- Migration 0028: deals 表（成交資料庫，Phase F-2 wave 8）
--
-- 緣起：admin 在 admin-requisitions detail modal 點「保存」→ 把 requisition 移
--   到此表 = 業務成交。未來查老客戶 / 對帳 / 報表都從這查。
--
-- 為什麼不直接在 requisition 加一個 status='deal'：
--   1. requisition 可能被硬刪（admin 清單管理），但 deal 不能跟著消失
--   2. 成交時要快照客戶當下資訊（name/contact/company），日後 user 改 profile 不污染歷史
--   3. 串多筆 payment_intents（一單可能多次充值），需獨立 JSON column
--
-- 為什麼 requisition_id ON DELETE SET NULL：
--   admin 之後可能硬刪原 requisition；deal 仍要保留，用 source_requisition_id 追溯即可。

CREATE TABLE IF NOT EXISTS deals (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  source_requisition_id    INTEGER REFERENCES requisition(id) ON DELETE SET NULL,
  user_id                  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name            TEXT    NOT NULL,
  customer_contact         TEXT    NOT NULL,
  customer_company         TEXT,
  service_type             TEXT,
  budget                   TEXT,
  timeline                 TEXT,
  message                  TEXT,
  total_amount_subunit     INTEGER NOT NULL DEFAULT 0,  -- 加總所有 succeeded intent
  refunded_amount_subunit  INTEGER NOT NULL DEFAULT 0,  -- 加總所有 refunded intent
  currency                 TEXT    NOT NULL DEFAULT 'TWD',
  payment_intent_ids       TEXT,                        -- JSON array of intent ids（成交當下快照）
  notes                    TEXT,
  saved_by_admin_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  saved_at                 TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deals_user      ON deals(user_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_req       ON deals(source_requisition_id);
CREATE INDEX IF NOT EXISTS idx_deals_saved_at  ON deals(saved_at DESC);
