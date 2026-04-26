-- 0007: email_verifications.token_type CHECK 加入 'delete_account'
-- 起因：prod 早期 schema 只允許 ('verify_email','reset_password')，
--       新流程 /api/auth/delete 需要寫入 token_type='delete_account'，
--       導致 D1 CHECK constraint 觸發 SQLITE_CONSTRAINT_CHECK。
-- SQLite 不支援 ALTER CHECK，必須重建表。
-- 注意：D1 自動把整個 batch 包成 transaction，不可寫 BEGIN/COMMIT/PRAGMA。

CREATE TABLE email_verifications_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  token_type  TEXT    NOT NULL,
  ip_address  TEXT,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK(token_type IN ('verify_email','reset_password','delete_account'))
);

INSERT INTO email_verifications_new
       (id, user_id, token_hash, token_type, ip_address, expires_at, used_at, created_at)
SELECT  id, user_id, token_hash, token_type, ip_address, expires_at, used_at, created_at
FROM    email_verifications;

DROP TABLE email_verifications;

ALTER TABLE email_verifications_new RENAME TO email_verifications;

CREATE INDEX IF NOT EXISTS idx_email_verifications_user    ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verifications_ip      ON email_verifications(ip_address, created_at);
