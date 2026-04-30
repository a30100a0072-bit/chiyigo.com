-- Down 0007: 還原 email_verifications.token_type CHECK（移除 'delete_account'）
-- ⚠️ 資料遺失：所有 token_type='delete_account' 的列必須先刪除（CHECK 不允許）
-- 同 0007 注意事項：D1 batch 自動包 transaction，不可寫 BEGIN/COMMIT/PRAGMA

-- 1) 清掉所有 delete_account 類型的 token（一定會失效，因為 down 後此 type 違反 CHECK）
DELETE FROM email_verifications WHERE token_type = 'delete_account';

-- 2) 重建表，CHECK 恢復為原本兩個值
CREATE TABLE email_verifications_old (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,
  token_type  TEXT    NOT NULL,
  ip_address  TEXT,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK(token_type IN ('verify_email','reset_password'))
);

INSERT INTO email_verifications_old
       (id, user_id, token_hash, token_type, ip_address, expires_at, used_at, created_at)
SELECT  id, user_id, token_hash, token_type, ip_address, expires_at, used_at, created_at
FROM    email_verifications;

DROP TABLE email_verifications;

ALTER TABLE email_verifications_old RENAME TO email_verifications;

-- 重建 0004 加過的索引（0007 up 內也重建，down 後維持一致）
CREATE INDEX IF NOT EXISTS idx_email_verifications_user    ON email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires ON email_verifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verifications_ip      ON email_verifications(ip_address, created_at);
