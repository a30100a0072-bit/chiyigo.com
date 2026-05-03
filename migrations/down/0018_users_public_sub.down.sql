DROP INDEX IF EXISTS idx_users_public_sub;
-- SQLite 限制：無法 DROP COLUMN（需重建表），rollback 留 column 不致命
