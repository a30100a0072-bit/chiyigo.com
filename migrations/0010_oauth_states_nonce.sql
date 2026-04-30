-- Migration 0010: oauth_states.nonce — OIDC nonce 驗證（防 id_token replay）
--
-- 套用對象：google / line / apple（OIDC 流程，會回傳 id_token 的 provider）
-- discord / facebook 為純 OAuth2，無 id_token，nonce 欄位保持 NULL。
--
-- 流程：
--   init.js  → 對 OIDC provider 生成 nonce，寫入此欄並注入授權 URL
--   callback → 解析 id_token 後比對 payload.nonce === stored.nonce
ALTER TABLE oauth_states ADD COLUMN nonce TEXT;
