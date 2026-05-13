-- 0042: payment_webhook_events.apply_status — Codex r1 P0-2
--
-- 為什麼要加：
--   原本 handler 先 INSERT payment_webhook_events（撞 UNIQUE = dedup hit），
--   之後才呼叫 updatePaymentStatus。若 status update / metadata merge 失敗，
--   第一次回 500/DLQ；但 PSP retry 同 event_id 時撞 UNIQUE 直接 deduplicated 成功，
--   付款狀態永遠不會被套用 → 帳務漂移。
--
-- 解法：dedupe row 加 apply_status 三態：
--   'processing' — INSERT 後 / retry 重置；尚未確定套用成功
--   'applied'    — updatePaymentStatus 成功；之後同 event_id 才視為真 dedup hit
--   'failed'     — 處理過程 throw；下次 retry 重置回 'processing' 重跑
--
-- 既有 row backfill 'applied'（歷史 webhook 都當作已套用完成，不會被 retry 重跑）。

ALTER TABLE payment_webhook_events ADD COLUMN apply_status TEXT NOT NULL DEFAULT 'applied';

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_apply_status
  ON payment_webhook_events(apply_status);
