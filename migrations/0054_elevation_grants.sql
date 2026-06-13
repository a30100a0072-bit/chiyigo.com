-- Migration 0054: elevation_grants + elevation_exchanges + oauth_states elevation columns (SEC-FACTOR-ADD-A, ADD-A PR-A1)
--
-- Plan: docs/audit/sec-factor-add-a-fix-plan.md (ChatGPT Arch Gate + Codex Plan Gate r3 APPROVED).
--   factor-add elevation 是 server-side one-time grant（非純 JWT）：register-verify / wallet-verify /
--   oauth is_binding 三條 factor-add 路徑要求一張 elevation_grants（purpose=factor_add + action），consume 與
--   factor-add credential 寫入 atomic 同 batch。grant 結構上與 elevated:account（delete/change-password）分離。
--
-- EXPAND stage of expand/migrate/contract：本 migration ONLY 建表 + 加 nullable 欄 + index。沒有任何 reader——
--   elevation runtime（端點 / gate）在後續 PR-A2/A3。grant_token / exchange_code / provider_id 明文不入 DB（只存 hash）。
--
-- The migration + resetDb runners split SQL on raw semicolons, so NO comment in this file may contain a semicolon.

CREATE TABLE IF NOT EXISTS elevation_grants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_token_hash  TEXT NOT NULL UNIQUE,
  user_id           INTEGER NOT NULL,
  session_id        TEXT NOT NULL,
  purpose           TEXT NOT NULL CHECK (purpose = 'factor_add'),
  action            TEXT NOT NULL CHECK (action IN ('add_passkey', 'bind_wallet', 'bind_identity')),
  method            TEXT NOT NULL CHECK (method IN ('totp', 'current_password', 'oauth_reauth')),
  provider          TEXT,
  provider_id_hash  TEXT,
  expires_at        TEXT NOT NULL,
  consumed_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  risk_reason       TEXT
);

CREATE INDEX IF NOT EXISTS idx_elevation_grants_user ON elevation_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_elevation_grants_session ON elevation_grants(session_id);
CREATE INDEX IF NOT EXISTS idx_elevation_grants_action ON elevation_grants(action);
CREATE INDEX IF NOT EXISTS idx_elevation_grants_expires ON elevation_grants(expires_at);

CREATE TABLE IF NOT EXISTS elevation_exchanges (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_code_hash  TEXT NOT NULL UNIQUE,
  user_id             INTEGER NOT NULL,
  session_id          TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_id_hash    TEXT NOT NULL,
  action              TEXT NOT NULL CHECK (action IN ('add_passkey', 'bind_wallet', 'bind_identity')),
  expires_at          TEXT NOT NULL,
  consumed_at         TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_elevation_exchanges_session ON elevation_exchanges(session_id);
CREATE INDEX IF NOT EXISTS idx_elevation_exchanges_expires ON elevation_exchanges(expires_at);

ALTER TABLE oauth_states ADD COLUMN purpose TEXT;
ALTER TABLE oauth_states ADD COLUMN elevation_user_id INTEGER;
ALTER TABLE oauth_states ADD COLUMN session_id TEXT;
ALTER TABLE oauth_states ADD COLUMN action TEXT;
ALTER TABLE oauth_states ADD COLUMN factor_add_grant_hash TEXT;
