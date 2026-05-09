-- Migration 0034: P0-8 防 refund-request 雙建
--
-- 緣起：functions/api/payments/intents/[id]/refund-request.js 用
-- SELECT-then-INSERT 檢查既有 pending 申請，雙擊 / 競態下兩個 request 都
-- 通過檢查 → 兩筆 pending row 同時建出來，admin 端可能各 approve 一次 →
-- 雙重退款。
--
-- 修法：partial UNIQUE — 同 intent_id 只能有一筆 status='pending' row。
-- approved/rejected 不受限（可重申請）。
-- code 端改 try/catch UNIQUE → 409 REFUND_ALREADY_PENDING。

CREATE UNIQUE INDEX IF NOT EXISTS uq_rrr_intent_pending
  ON requisition_refund_request(intent_id)
  WHERE status = 'pending';
