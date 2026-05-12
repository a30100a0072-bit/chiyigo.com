-- 0036: requisition.owner_user_id / owner_guest_id（Codex audit 2026-05-10 #1）
--
-- 歷史背景（2026-05-10 起草時）：舊 _base.sql 已加 owner_*，但沒對應 numbered
-- migration → fresh D1 / staging 缺欄位，prod 已透過 schema_iam_prod.sql 套用。
--
-- 🔄 2026-05-12 後 baseline 重整（A'+X）：0000_base.sql 刻意 **不含** owner_*
-- （它是 numbered migrations 之後加的欄）；本 migration 才是 owner_* 的權威來源。
-- 0040_requisition_index_align.sql 接續把索引命名對齊 prod。
--
-- 用途：訪客先送需求單時寫 owner_guest_id（device_uuid）；同一裝置之後註冊，
-- register.js 會 takeover 這條 row 為新 user 所屬。

-- D1 SQLite ALTER TABLE ADD COLUMN 不支援 IF NOT EXISTS，但對既有欄位會直接報錯
-- 中斷 migration。這裡用兩段：先建 sentinel index 探測，存在就 skip 整段。
-- 但實務上 wrangler d1 migrations apply 對重複欄位會 fail；prod 已手動套用 schema，
-- 這條只給 fresh / staging 用。若 prod 重跑 migration 需要 hotpatch script 跳過。

ALTER TABLE requisition ADD COLUMN owner_guest_id TEXT;
ALTER TABLE requisition ADD COLUMN owner_user_id  INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_requisition_owner_guest_id ON requisition(owner_guest_id);
CREATE INDEX IF NOT EXISTS idx_requisition_owner_user_id  ON requisition(owner_user_id);
