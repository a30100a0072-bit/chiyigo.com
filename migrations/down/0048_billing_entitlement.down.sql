-- 回滾 0048：DROP 本 migration 自建的 4 張新表（billing / entitlement foundation）。
-- ⚠️ 僅供「PR2 deploy 後、尚無真實 grant 建立前」的緊急回滾：
--    tenant_product_access 投影可由 grant_plan_operations ledger 重建（無資料遺失）；
--    一旦有真實 grant，回滾改走 forward-fix，不得 DROP（見 CLAUDE.md §資料庫要求 destructive 禁令）。
-- 對照 0047 down —— 刪「同批 expand migration 新建」的物件是合法回滾路徑。
-- 子表先刪（FK 安全）。
DROP TABLE IF EXISTS grant_plan_operations;
DROP TABLE IF EXISTS tenant_product_access;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS products;
