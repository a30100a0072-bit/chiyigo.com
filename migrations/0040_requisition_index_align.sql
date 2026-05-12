-- 0040: requisition index 命名對齊 prod（exact parity）
--
-- 背景：0036 設計時建了 idx_requisition_owner_guest_id + idx_requisition_owner_user_id
-- 兩個索引，但 prod 走的是 schema_iam_prod.sql 直接套用路徑（見 0036 header），
-- 結果 prod 上只長出一個 idx_requisition_guest_id（沒 owner_ 前綴）on owner_guest_id，
-- 而 owner_user_id 上沒有索引。
--
-- baseline 重整目標：fresh D1（_base + 0001..0039 + 本 migration）的最終 schema
-- 必須對得上 prod snapshot。這條對齊 index：
--
--   prod 行為：DROP IF EXISTS 兩個都 no-op、CREATE IF NOT EXISTS 也 no-op → 完全安全
--   fresh D1：DROP 0036 的兩個索引、CREATE 一個 prod 命名 → 對齊 prod
--
-- 也順帶承認「owner_user_id 上沒索引」是 prod 既成事實；未來真有需要再開新 migration。

DROP INDEX IF EXISTS idx_requisition_owner_guest_id;
DROP INDEX IF EXISTS idx_requisition_owner_user_id;

CREATE INDEX IF NOT EXISTS idx_requisition_guest_id ON requisition(owner_guest_id);
