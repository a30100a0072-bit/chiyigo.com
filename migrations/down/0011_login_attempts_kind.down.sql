-- Down 0011: 還原 login_attempts 為 0002 形狀（email NOT NULL，無 kind / user_id）
-- ⚠️ 非 login kind 的歷史記錄會被丟棄。
-- ⚠️ 0002 原本 email NOT NULL，搬資料時若有 NULL email（kind='login' 應不會出現）將失敗，
--   先以空字串補上避免 INSERT 錯誤。

DROP INDEX IF EXISTS idx_login_attempts_kind_ip;
DROP INDEX IF EXISTS idx_login_attempts_kind_user;
DROP INDEX IF EXISTS idx_login_attempts_kind_time;

CREATE TABLE login_attempts_old (
  id         INTEGER  PRIMARY KEY AUTOINCREMENT,
  ip         TEXT     NOT NULL,
  email      TEXT     NOT NULL,
  created_at DATETIME DEFAULT (datetime('now'))
);

INSERT INTO login_attempts_old (id, ip, email, created_at)
SELECT id, COALESCE(ip, ''), COALESCE(email, ''), created_at
FROM login_attempts WHERE kind = 'login';

DROP TABLE login_attempts;
ALTER TABLE login_attempts_old RENAME TO login_attempts;

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip    ON login_attempts(ip,    created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at);
