-- Migration 0014: pkce_sessions / auth_codes 加 scope + nonce（OIDC 標準化）
--
-- 緣起：
--   chiyigo IAM 升級為合規 OIDC IdP（Phase 1 of Option B）。
--   OIDC 規範要求 token endpoint 在 scope 含 'openid' 時回傳 id_token，
--   且 id_token 必須帶 nonce claim 給 client 防 replay。
--   原 PKCE flow 只走 OAuth 2.0 不認識這兩個欄位，現在補上。
--
-- 行為：
--   - 既有 PKCE client（mbti 舊版、game/app）不傳 scope/nonce → 兩欄 NULL
--     → token endpoint 不回 id_token，向後相容
--   - 新 OIDC client 傳 scope=openid + nonce → 走完整 OIDC flow
--
-- 流向：
--   /authorize  ?scope=openid+profile+email&nonce=xxx
--      → INSERT pkce_sessions (..., scope, nonce)
--   /code       (login 完成後)
--      → INSERT auth_codes (..., scope, nonce)  抄自 pkce_sessions
--   /token      (code exchange)
--      → DELETE...RETURNING auth_codes 取出 scope, nonce
--      → 若 scope 含 'openid' 則簽 id_token（aud + iat + exp + sub + nonce + email...）
--
-- SQLite ALTER TABLE 限制：只能 ADD COLUMN，不重建表。

ALTER TABLE pkce_sessions ADD COLUMN scope TEXT;
ALTER TABLE pkce_sessions ADD COLUMN nonce TEXT;

ALTER TABLE auth_codes ADD COLUMN scope TEXT;
ALTER TABLE auth_codes ADD COLUMN nonce TEXT;
