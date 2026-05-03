-- Migration 0015: oauth_clients — OAuth/OIDC client 註冊表
--
-- 緣起：
--   現況 redirect_uri 白名單寫死在程式（functions/api/auth/oauth/authorize.js
--   ALLOWED_REDIRECT_URIS 等常數），每加一個新 RP（健身 App / 撲克 / 桌遊）
--   都要改 code + 部署。Phase 0 為金融級多 App 平台先把 client 註冊表建好，
--   讓未來 INSERT 一列就能上線新 client。
--
-- 行為：
--   - 此 migration 只建空表 + index，code 仍走舊白名單常數（雙寫過渡）。
--   - Phase C 時切流：authorize / token / end-session 改讀此表。
--
-- 設計重點：
--   - client_id 不用自增 ID，採人類可讀字串（'chiyigo-web' / 'fitness-ios'）
--     方便 audit log 與 JWT aud claim 直接識別。
--   - client_secret_hash：confidential client 才有；public client（mobile / SPA）
--     走 PKCE 不需要 secret，欄位 NULL。
--   - allowed_redirect_uris / allowed_scopes：JSON array，避免另開關聯表
--     增加 join 成本（單一 client 的 URI/scope 數量極少）。
--   - allowed_grant_types：白名單 grant，避免無腦支援所有 grant。
--   - require_pkce：強制 PKCE（mobile/SPA 必開；server-to-server confidential
--     可關但建議全開）。
--   - token_endpoint_auth_method：'none' / 'client_secret_basic' / 'client_secret_post'
--   - logo_uri / client_uri / policy_uri / tos_uri：consent 畫面用（Phase C 才接）
--   - app_type：'web' / 'native' / 'mobile' — 決定 cookie / refresh 行為
--   - is_active：軟下架；不刪 row 保留 audit history
--
-- 命名規則（CLIENT_IDS.md）：
--   <product>-<platform>  例：chiyigo-web / mbti-web / talo-web /
--                              fitness-ios / fitness-android /
--                              poker-web / poker-mobile
--
-- 雙寫驗證：
--   Phase 0 期間 authorize.js 在比對白名單時，同時 SELECT oauth_clients
--   比對結果並 log 差異到 admin_audit_log，跑 1 個月零差異後切流。

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id                    TEXT    PRIMARY KEY,
  client_name                  TEXT    NOT NULL,
  client_secret_hash           TEXT,           -- NULL = public client (PKCE only)
  app_type                     TEXT    NOT NULL DEFAULT 'web',  -- web / native / mobile
  allowed_redirect_uris        TEXT    NOT NULL,                -- JSON array
  allowed_scopes               TEXT    NOT NULL,                -- JSON array
  allowed_grant_types          TEXT    NOT NULL DEFAULT '["authorization_code","refresh_token"]',
  require_pkce                 INTEGER NOT NULL DEFAULT 1,
  token_endpoint_auth_method   TEXT    NOT NULL DEFAULT 'none', -- none / client_secret_basic / client_secret_post
  post_logout_redirect_uris    TEXT,                            -- JSON array, OIDC RP-Initiated Logout
  frontchannel_logout_uri      TEXT,
  logo_uri                     TEXT,
  client_uri                   TEXT,
  policy_uri                   TEXT,
  tos_uri                      TEXT,
  is_active                    INTEGER NOT NULL DEFAULT 1,
  created_at                   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK(app_type IN ('web','native','mobile')),
  CHECK(token_endpoint_auth_method IN ('none','client_secret_basic','client_secret_post'))
);

CREATE INDEX IF NOT EXISTS idx_oauth_clients_active ON oauth_clients(is_active);
