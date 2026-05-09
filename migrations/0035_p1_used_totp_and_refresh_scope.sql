-- 0035: P1-5 refresh_tokens.scope + P1-6/P1-8 used_totp（防 TOTP code 60s 內 replay）
--
-- P1-5：refresh.js rotation 後遺失 OIDC scope。
--   refresh_tokens 加 scope 欄位；oauth/token.js 簽發時寫入；refresh.js rotation
--   時透傳，並 buildTokenScope(role, row.scope) 帶第二參數 → silent refresh 後仍保留
--   原本的 openid / email 等 OIDC scope。
--
-- P1-6 / P1-8：TOTP window=±1 = 90s 內三個 30s slot 都接受；無 used_totp →
--   攻擊者偷到一組 6 位 OTP 在 60s 視窗內可重放。
--   used_totp(user_id, slot) PRIMARY KEY → 任一 slot 一個 user 只能用一次；
--   slot = floor(unix_seconds / 30)。INSERT 衝突 = replay。
--   日常清理由 cron/cleanup.js 管：90s 之後的 row 已無價值，每 5 分鐘掃一次即可。

ALTER TABLE refresh_tokens ADD COLUMN scope TEXT;

CREATE TABLE IF NOT EXISTS used_totp (
  user_id  INTEGER NOT NULL,
  slot     INTEGER NOT NULL,
  used_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_used_totp_used_at ON used_totp(used_at);
