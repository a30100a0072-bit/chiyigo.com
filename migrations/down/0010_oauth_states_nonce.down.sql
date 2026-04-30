-- Down 0010: 移除 oauth_states.nonce
-- ⚠️ Rollback 後 OIDC id_token replay 防禦消失（state + PKCE 仍生效）
ALTER TABLE oauth_states DROP COLUMN nonce;
