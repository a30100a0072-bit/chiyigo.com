-- 回滾 0047：DROP 本 migration 自建的兩張新表。
-- ⚠️ 僅供「PR1 deploy 後、尚無真實 org tenant 建立前」的緊急回滾：
--    personal tenant 可由 users 重新 backfill 推導（無資料遺失）；
--    一旦有 org tenant 真實資料，回滾改走 forward-fix，不得 DROP（見 CLAUDE.md §資料庫要求 destructive 禁令）。
-- 對照 0034 down 刪自己建的 index —— 刪「同批 expand migration 新建」的物件是合法回滾路徑。
DROP TABLE IF EXISTS organization_members;
DROP TABLE IF EXISTS tenants;
