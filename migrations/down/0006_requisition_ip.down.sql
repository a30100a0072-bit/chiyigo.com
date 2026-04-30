-- Down 0006: 移除 requisition.source_ip + 索引
-- ⚠️ 資料遺失：source_ip 內的資料會被丟棄

DROP INDEX IF EXISTS idx_requisition_ip;
ALTER TABLE requisition DROP COLUMN source_ip;
