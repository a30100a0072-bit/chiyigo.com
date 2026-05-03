-- Migration 0016: revoked_jti — Token 黑名單（精準 revoke）
--
-- 緣起：
--   現況只有 users.token_version（粗粒度全域 revoke）。要做「只撤一張被竊
--   token 不影響其他裝置」就需要 jti 級黑名單。OIDC 標準 logout / RP 切登
--   都會用到。
--
-- 行為：
--   - verifyJwt 驗簽通過後查此表（KV 快取 revoked:<jti>，TTL = token 剩餘
--     壽命，避免每次打 D1）
--   - 過期後 cron 清（Migration 0019 cron 開好後接）
--
-- 為何極簡：
--   $0 + 個人專案 + 沒有金流，先不需要 reason / revoked_by 等 audit 欄位。
--   真要查誰 revoke 哪張 token 走 audit_log（migration 0017）。

CREATE TABLE IF NOT EXISTS revoked_jti (
  jti        TEXT    PRIMARY KEY,
  expires_at TEXT    NOT NULL,
  revoked_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_revoked_jti_expires_at ON revoked_jti(expires_at);
