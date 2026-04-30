-- Down 0001: 移除 requisition 升級欄位
-- ⚠️ 資料遺失：user_id / tg_message_id / status / deleted_at 內的資料會被丟棄
-- D1 (SQLite ≥ 3.45) 支援 ALTER TABLE ... DROP COLUMN

ALTER TABLE requisition DROP COLUMN deleted_at;
ALTER TABLE requisition DROP COLUMN status;
ALTER TABLE requisition DROP COLUMN tg_message_id;
ALTER TABLE requisition DROP COLUMN user_id;
