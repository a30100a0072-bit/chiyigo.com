-- Migration 0003: admin_audit_log — 管理員操作稽核日誌
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     INTEGER NOT NULL,
  admin_email  TEXT    NOT NULL,
  action       TEXT    NOT NULL,   -- 'ban' | 'unban'
  target_id    INTEGER NOT NULL,
  target_email TEXT    NOT NULL,
  ip_address   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin  ON admin_audit_log(admin_id,  created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_id, created_at);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action,    created_at);
