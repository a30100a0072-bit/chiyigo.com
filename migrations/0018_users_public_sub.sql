-- Migration 0018: users.public_sub — JWT sub claim 用的假名化 ID
--
-- 緣起：
--   現況 JWT sub 直接用 users.id（自增整數），洩漏用戶數量 + 易枚舉。
--   未來 mobile App 出 v1.0 時，sub 一旦發出就鎖死（client 拿來當 user
--   primary key）。現在不補，未來搬就要全平台 RP 重新 mapping。
--
-- 規格：
--   public_sub = 'uid_' || base32( randomBytes(10) )  // 16 char base32
--   例：uid_abc123def456gh
--   發出後永不變，user 改 email / 改密碼都不影響。
--
-- 行為：
--   1. 此 migration 加欄位（NULL allowed）
--   2. 應用層上線雙寫：新註冊時生成；既有 user 在下次 login 時 lazy-fill
--      （UPDATE WHERE public_sub IS NULL）
--   3. 全部 backfill 後（單表 < 10k row 一個 query backfill 也行）
--      下個 migration 改 NOT NULL + UNIQUE
--   4. JWT 簽發改用 public_sub 作為 sub claim
--
-- 為何不在 migration 直接 backfill：
--   D1 wrangler exec 跑 random() 不易；且現階段 user 數少，可手動或在
--   Functions cold path 處理。

ALTER TABLE users ADD COLUMN public_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_public_sub ON users(public_sub);
