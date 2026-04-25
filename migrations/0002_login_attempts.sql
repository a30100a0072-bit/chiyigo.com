-- Migration 0002: login_attempts — 登入失敗記錄表（暴力破解防禦）
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER  PRIMARY KEY AUTOINCREMENT,
  ip         TEXT     NOT NULL,
  email      TEXT     NOT NULL,
  created_at DATETIME DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip    ON login_attempts(ip,    created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at);
