-- Down 0009: 移除 users.token_version
-- ⚠️ Rollback 後 access token 全域 revoke 能力消失（refresh token 仍可單筆撤銷）
ALTER TABLE users DROP COLUMN token_version;
