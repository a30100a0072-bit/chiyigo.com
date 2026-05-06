-- Migration 0026: requisition_refund_request（Phase F-2 wave 7）
--
-- 緣起：F-2 wave 6 收尾後發現缺口 — user revoke 不檢查已付款 succeeded intent
--   會造成「進帳但業務單已 revoked」帳務黑洞。
--
-- 設計：已付款的 requisition 不直接 revoke，改建一筆 refund_request；
--   admin 走 step-up + 2FA OTP 審核 → approve 才退款 + revoke。
--   reject 則維持 requisition 'refund_pending'（可拒絕後 user 改聯絡客服或重發單）。
--
-- 狀態流：
--   requisition.status: pending → refund_pending（refund_request created）→ revoked（admin approve）
--                                                                       → refund_pending（admin reject，保留 pending 給後續處理）
--   refund_request.status: pending → approved | rejected
--
-- intent_id 用 SET NULL 防 admin 強刪 payment_intent 後 cascade 砍掉 audit trail row。

CREATE TABLE IF NOT EXISTS requisition_refund_request (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  requisition_id  INTEGER NOT NULL REFERENCES requisition(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_id       INTEGER REFERENCES payment_intents(id) ON DELETE SET NULL,
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  admin_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_note      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_rrr_status        ON requisition_refund_request(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrr_requisition   ON requisition_refund_request(requisition_id);
CREATE INDEX IF NOT EXISTS idx_rrr_user          ON requisition_refund_request(user_id, created_at DESC);
