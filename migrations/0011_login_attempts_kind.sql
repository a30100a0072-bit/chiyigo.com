-- Migration 0011: login_attempts → 統一限流表（kind / user_id；email 改為可空）
--
-- 既有用途：login 失敗計數（kind='login' 預設值，向後相容）
-- 新增用途：
--   kind='2fa'         per-user_id 5min 內失敗 ≥5 次 → 鎖定 pre_auth_token
--   kind='email_send'  per-ip 1min ≥3 次 → 429
--   kind='oauth_init'  per-ip 1min ≥10 次 → 429
--
-- 變更：原表 email NOT NULL 對非 login kind 不適用，需重建表放寬。
-- SQLite 不支援 DROP NOT NULL，改採「建新表 → 搬資料 → drop old → rename」。

CREATE TABLE login_attempts_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT,
  email      TEXT,
  kind       TEXT    NOT NULL DEFAULT 'login',
  user_id    INTEGER,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO login_attempts_new (id, ip, email, kind, user_id, created_at)
SELECT id, ip, email, 'login', NULL, created_at FROM login_attempts;

DROP TABLE login_attempts;
ALTER TABLE login_attempts_new RENAME TO login_attempts;

-- 重建既有索引（保留 0002 風格）+ 新索引
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip          ON login_attempts(ip,          created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email       ON login_attempts(email,       created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_kind_time   ON login_attempts(kind,        created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_kind_user   ON login_attempts(kind, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_kind_ip     ON login_attempts(kind, ip,     created_at);
