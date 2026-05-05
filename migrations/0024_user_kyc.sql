-- Migration 0024: KYC scaffold（Phase F-1）
--
-- 緣起：
--   金流 / 提款場景前置 — KYC 流程 vendor-agnostic schema。Sumsub / Persona /
--   永豐 / 其他都共用這張表，只是 `vendor` 欄位不同。等選好 vendor 開
--   `/api/auth/kyc/start` 接他們 SDK，本 migration 不綁特定 vendor。
--
-- 表設計：
--   user_kyc — 一個 user 一筆（UNIQUE user_id），status 驅動 elevated:withdraw 等
--             高權限 scope 的 gate；level 給未來 tier'd 提款額度用
--   kyc_webhook_events — dedupe（vendor, event_id），webhook 重送不會重複處理

CREATE TABLE IF NOT EXISTS user_kyc (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT    NOT NULL DEFAULT 'unverified',  -- unverified|pending|verified|rejected|expired
  level             TEXT    NOT NULL DEFAULT 'basic',       -- basic|enhanced
  vendor            TEXT,                                    -- 'sumsub' | 'persona' | 'shinkong' | ...
  vendor_session_id TEXT,                                    -- 對方的 applicant / inquiry id
  vendor_review_id  TEXT,                                    -- 對方那次審核結果 id
  rejection_reason  TEXT,
  verified_at       TEXT,
  expires_at        TEXT,                                    -- 部分 KYC 有時效（如 1 年）
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_kyc_status   ON user_kyc(status);
CREATE INDEX IF NOT EXISTS idx_user_kyc_expires  ON user_kyc(expires_at);

CREATE TABLE IF NOT EXISTS kyc_webhook_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor       TEXT    NOT NULL,
  event_id     TEXT    NOT NULL,                  -- vendor 的 unique event id
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_to    TEXT,                              -- 處理後 user_kyc.status 設成什麼
  payload_hash TEXT,                              -- raw body hash（debug 用）
  processed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vendor, event_id)
);

CREATE INDEX IF NOT EXISTS idx_kyc_webhook_events_processed ON kyc_webhook_events(processed_at);
