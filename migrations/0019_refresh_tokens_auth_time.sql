-- Migration 0019: refresh_tokens 加 auth_time（OIDC max_age 支援）
--
-- 緣起：
--   Silent SSO Phase 2 加 OIDC max_age 參數支援。spec 要求 IdP 知道使用者
--   「上次互動式認證」的時間，且 id_token 必須帶 auth_time claim。
--   原來 token.js 把 auth_time 設成「token 簽發 NOW」是簡化；rotation 後仍是 NOW，
--   max_age 比對失去意義。
--
-- 設計：
--   - auth_time 由互動式登入端點寫入（local/login、register、2fa/verify、
--     oauth/callback、oauth/bind-email、oauth/token）
--   - refresh.js rotation **保留**舊 token 的 auth_time（重點：silent refresh
--     不算重新認證，max_age 才有意義）
--   - 既有 row backfill：用 expires_at - REFRESH_TOKEN_DAYS 推算原始 issue 時間，
--     誤差在 token TTL 內，足夠 max_age 評估
--
-- 行為：
--   - max_age 未指定 → 不檢查 auth_time（向後相容）
--   - max_age 指定 + auth_time NULL → 視為超出（fall through 強制重認，保守）
--   - max_age 指定 + auth_time 存在 → now - auth_time > max_age → fall through

ALTER TABLE refresh_tokens ADD COLUMN auth_time TEXT;
ALTER TABLE auth_codes ADD COLUMN auth_time TEXT;

-- 既有 refresh_tokens row backfill：refresh.js / login.js 預設 7 天 TTL，
-- oauth/token.js 30 天，用 -7 days 是常見情況的近似（誤差最多 23 天，仍在合理
-- max_age 評估範圍內）
UPDATE refresh_tokens
SET auth_time = datetime(expires_at, '-7 days')
WHERE auth_time IS NULL;

-- auth_codes 是極短壽命（5 分鐘），在 migration apply 時應為空表，無需 backfill
