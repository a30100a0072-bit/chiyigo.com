-- Migration 0020: oauth_clients 補欄位 + seed 現有 4 個 RP（Phase C-1 Wave 1）
--
-- 緣起：
--   `functions/utils/oauth-clients.js` 已是 Phase 1 的 in-code source of truth。
--   Phase C-1 把它搬到 D1，未來新 RP 從改 code 變成跑 SQL。0015 已建表，但
--   缺幾個欄位（aud / cors_origins / backchannel_logout_uri / frontchannel
--   多 URI 支援）。本 migration 補完 schema 並 seed 現有 4 個 RP。
--
-- 設計：
--   - aud 預設 = client_id（chiyigo / mbti / talo / sport-app 慣例）；可不同
--   - cors_origins / frontchannel_logout_uris：JSON array（多 origin/URI 支援）
--   - 0015 的 frontchannel_logout_uri 是單一字串；改用新欄位 frontchannel_logout_uris
--     存 JSON array（舊欄位保留不刪，避免破壞既有 rows）
--   - backchannel_logout_uri：cross-site RP 必備；其餘 NULL
--
-- 行為：
--   - ALTER TABLE 沒有 IF NOT EXISTS，drift 處理用 try/catch（runtime _helpers.js）。
--     直接套到 prod 失敗代表欄位已存在，等同 no-op
--   - INSERT OR REPLACE 確保 idempotent：重跑 migration 也只會更新 row 不重複

-- 1. 補欄位（drift 安全：ALTER TABLE 失敗代表已存在）
ALTER TABLE oauth_clients ADD COLUMN aud                       TEXT;
ALTER TABLE oauth_clients ADD COLUMN cors_origins              TEXT;
ALTER TABLE oauth_clients ADD COLUMN backchannel_logout_uri    TEXT;
ALTER TABLE oauth_clients ADD COLUMN frontchannel_logout_uris  TEXT;

-- 2. seed 現有 4 個 RP（in-code 真值搬過來）
INSERT OR REPLACE INTO oauth_clients (
  client_id, client_name, app_type,
  allowed_redirect_uris, allowed_scopes,
  post_logout_redirect_uris,
  frontchannel_logout_uris, backchannel_logout_uri,
  cors_origins, aud,
  is_active, created_at, updated_at
) VALUES
(
  'chiyigo', 'chiyigo Web + Mobile', 'web',
  '["chiyigo://auth/callback","https://chiyigo.com/callback","https://chiyigo.com/app/callback"]',
  '["openid","profile","email"]',
  '["https://chiyigo.com/","https://chiyigo.com/login"]',
  '["https://chiyigo.com/api/frontchannel-logout"]', NULL,
  '["https://chiyigo.com"]', 'chiyigo',
  1, datetime('now'), datetime('now')
),
(
  'mbti', 'MBTI Mental Modeling', 'web',
  '["https://mbti.chiyigo.com/login.html"]',
  '["openid","profile","email"]',
  '["https://mbti.chiyigo.com/","https://mbti.chiyigo.com/login.html"]',
  '["https://mbti.chiyigo.com/frontchannel-logout"]', NULL,
  '["https://mbti.chiyigo.com"]', 'mbti',
  1, datetime('now'), datetime('now')
),
(
  'talo', 'Talo SSO', 'web',
  '["https://talo.chiyigo.com/"]',
  '["openid","profile","email"]',
  '["https://talo.chiyigo.com/"]',
  '["https://talo.chiyigo.com/frontchannel-logout"]', NULL,
  '["https://talo.chiyigo.com"]', 'talo',
  1, datetime('now'), datetime('now')
),
(
  'sport-app', 'Sport App (web + admin)', 'web',
  '["https://sport-app-web.pages.dev/auth/callback","https://sport-app-admin.pages.dev/auth/callback"]',
  '["openid","profile","email"]',
  '["https://sport-app-web.pages.dev/","https://sport-app-admin.pages.dev/"]',
  '["https://sport-app-web.pages.dev/frontchannel-logout","https://sport-app-admin.pages.dev/frontchannel-logout"]',
  'https://sport-app-worker.a30100a0072.workers.dev/api/auth/backchannel-logout',
  '["https://sport-app-web.pages.dev","https://sport-app-admin.pages.dev"]', 'sport-app',
  1, datetime('now'), datetime('now')
);
