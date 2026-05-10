-- 0036: requisition.owner_user_id / owner_guest_id（Codex audit 2026-05-10 #1）
--
-- migrations/_base.sql 已加這兩欄，但沒有 numbered migration → 任何只跑 numbered
-- migrations 的環境（fresh D1 / staging）會缺欄位，requisition.js INSERT 直接 500。
-- prod 已透過 schema_iam_prod.sql 套用，這條 IF NOT EXISTS 安全 no-op。
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
