-- Migration 0001: requisition 工單系統升級
-- 新增 user_id, tg_message_id, status, deleted_at 欄位

ALTER TABLE requisition ADD COLUMN user_id INTEGER;
ALTER TABLE requisition ADD COLUMN tg_message_id INTEGER;
ALTER TABLE requisition ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE requisition ADD COLUMN deleted_at TEXT;
