-- Rollback 0049: DROP the 4 tables created by this migration (+ their indexes).
-- Safe ONLY "after PR3 deploy but before any real credit movement / quota config exists"
--   (no credit_ledger / quota_config_ledger rows => no data loss).
-- Once real ledger rows exist, rollback becomes forward-fix and DROP is forbidden
--   (CLAUDE.md destructive-migration rule). The 4 tables only reference tenants/products
--   (not each other), so drop order among them is free.
DROP TABLE IF EXISTS quota_config_ledger;
DROP TABLE IF EXISTS credit_ledger;
DROP TABLE IF EXISTS product_usage_quota;
DROP TABLE IF EXISTS credit_wallets;
