-- down for 0056: 移除 login_attempts(created_at) index
DROP INDEX IF EXISTS idx_login_attempts_created_at;
