-- Down for migration 0055 (credential disposition columns on user_webauthn_credentials / user_wallets / user_identities).
--
-- Strategy = conservative TABLE-REBUILD (ChatGPT Arch Gate r2 F1), NOT ALTER DROP COLUMN.
--   requires_reverification carries a partial index, and the gate ruled against relying on DROP COLUMN
--   compatibility for credential tables. (Context: 0054 down does use DROP COLUMN successfully on this D1 for
--   index-free columns, but the gate chose the conservative rebuild here. Reversibility + data preservation are
--   proven by the migrations.test 0055 targeted round-trip on workerd D1.)
--
-- All three tables are FK-leaf (verified: no inbound REFERENCES to them), so the rebuild needs no
--   PRAGMA foreign_keys dance — only the outbound user_id REFERENCES users is recreated on the new table.
--   Each rebuild: drop partial index, recreate the pre-0055 ORIGINAL schema as a temp table, copy ONLY the
--   original columns (disposition_* dropped, all original credential data preserved), drop old, rename temp,
--   recreate original indexes.
--
-- Original schemas reconstructed from: user_webauthn_credentials = 0021_webauthn.sql, user_wallets =
--   0023_user_wallets.sql, user_identities = 0000_base.sql.
--
-- The migration + resetDb runners split SQL on raw semicolons, so NO comment in this file may contain a semicolon.

-- ── user_webauthn_credentials ──────────────────────────────────────────────
DROP INDEX IF EXISTS idx_user_webauthn_credentials_reverif;

CREATE TABLE user_webauthn_credentials_rebuild0055 (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id     TEXT    NOT NULL UNIQUE,
  public_key        TEXT    NOT NULL,
  counter           INTEGER NOT NULL DEFAULT 0,
  transports        TEXT,
  aaguid            TEXT,
  nickname          TEXT,
  backup_eligible   INTEGER NOT NULL DEFAULT 0,
  backup_state      INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at      TEXT
);

INSERT INTO user_webauthn_credentials_rebuild0055
  (id, user_id, credential_id, public_key, counter, transports, aaguid, nickname, backup_eligible, backup_state, created_at, last_used_at)
  SELECT id, user_id, credential_id, public_key, counter, transports, aaguid, nickname, backup_eligible, backup_state, created_at, last_used_at
  FROM user_webauthn_credentials;

DROP TABLE user_webauthn_credentials;
ALTER TABLE user_webauthn_credentials_rebuild0055 RENAME TO user_webauthn_credentials;
CREATE INDEX IF NOT EXISTS idx_user_webauthn_credentials_user ON user_webauthn_credentials(user_id);

-- ── user_wallets ───────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_user_wallets_reverif;

CREATE TABLE user_wallets_rebuild0055 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address       TEXT    NOT NULL,
  chain_id      INTEGER NOT NULL DEFAULT 1,
  nickname      TEXT,
  signed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  UNIQUE(user_id, address)
);

INSERT INTO user_wallets_rebuild0055
  (id, user_id, address, chain_id, nickname, signed_at, last_used_at)
  SELECT id, user_id, address, chain_id, nickname, signed_at, last_used_at
  FROM user_wallets;

DROP TABLE user_wallets;
ALTER TABLE user_wallets_rebuild0055 RENAME TO user_wallets;
CREATE INDEX IF NOT EXISTS idx_user_wallets_user    ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_address ON user_wallets(address);

-- ── user_identities ────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_user_identities_reverif;

CREATE TABLE user_identities_rebuild0055 (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     TEXT    NOT NULL,
  provider_id  TEXT    NOT NULL,
  display_name TEXT,
  avatar_url   TEXT,
  metadata     TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(provider, provider_id)
);

INSERT INTO user_identities_rebuild0055
  (id, user_id, provider, provider_id, display_name, avatar_url, metadata, created_at, updated_at)
  SELECT id, user_id, provider, provider_id, display_name, avatar_url, metadata, created_at, updated_at
  FROM user_identities;

DROP TABLE user_identities;
ALTER TABLE user_identities_rebuild0055 RENAME TO user_identities;
CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities(user_id);
