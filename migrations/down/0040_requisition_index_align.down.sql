-- 0040 down: 回到 0036 的索引命名
--
-- 注意：這條 down 在 prod 跑會 DROP 掉真正存在的 idx_requisition_guest_id，
-- 然後建出 prod 從未有過的兩個索引，等於把 prod 拉到「fresh D1 預期形」。
-- 一般情況不該對 prod 跑 down；保留此檔僅為 ledger 完整。

DROP INDEX IF EXISTS idx_requisition_guest_id;

CREATE INDEX IF NOT EXISTS idx_requisition_owner_guest_id ON requisition(owner_guest_id);
CREATE INDEX IF NOT EXISTS idx_requisition_owner_user_id  ON requisition(owner_user_id);
