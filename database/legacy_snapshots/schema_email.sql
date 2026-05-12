CREATE TABLE IF NOT EXISTS email_verifications (
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

CREATE INDEX IF NOT EXISTS idx_email_verif_hash ON email_verifications(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verif_user  ON email_verifications(user_id, token_type);
