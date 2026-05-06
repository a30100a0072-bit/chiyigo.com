-- Migration 0031: requisition_refund_request 加 amount_subunit
--
-- 緣起：目前退款流程都是「退整筆 intent」，amount 隱性等於 intent.amount_subunit。
-- 為部分退款（partial refund）日後實作留路：
--   - INSERT 時 backfill 自 intent.amount_subunit（與舊行為等價）
--   - approve 端拿這個值送 ECPay refund，未來若改部分退款只動 INSERT 端
-- 不加 NOT NULL 因為現有 row 沒值，舊資料設 NULL 不影響功能（程式 fallback intent.amount）。

ALTER TABLE requisition_refund_request ADD COLUMN amount_subunit INTEGER;
