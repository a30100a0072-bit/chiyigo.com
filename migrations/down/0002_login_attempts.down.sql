-- Down 0002: 移除 login_attempts 表
-- ⚠️ 資料遺失：所有登入失敗記錄會被丟棄

DROP INDEX IF EXISTS idx_login_attempts_email;
DROP INDEX IF EXISTS idx_login_attempts_ip;
DROP TABLE IF EXISTS login_attempts;
