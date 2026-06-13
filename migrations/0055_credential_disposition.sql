-- Migration 0055: credential disposition columns (SEC-FACTOR-ADD ADD-A PR-A4)
--
-- Plan: docs/audit/sec-factor-add-a4-disposition-plan.md (ChatGPT Arch Gate r2 + Codex Plan Gate APPROVED).
--   PR-A4 dispositions credentials (passkey / wallet / OAuth identity) that may have been added before the
--   #78 factor-add gate (prod deploy 2026-06-13T09:06:08Z). The disposition runner classifies each window
--   credential into a tier (high / unknown_context / low) and records the outcome ON THE CREDENTIAL ROW.
--   Disposition SSOT is the credential row itself (NOT elevation_grants.risk_reason, which scopes one-time
--   grant risk only).
--
-- EXPAND stage of expand/migrate/contract: this migration ONLY adds nullable/defaulted columns + a partial
--   index per table. No reader/writer ships before this migration applies (runner + list DTO are same PR).
--
-- requires_reverification: 0=ok / 1=needs re-verify (high or unknown_context). Passive flag in PR-A4 (list DTO
--   surfaces it). Active enforcement (block use until re-verified) is a RESUME-LOCKED follow-up PR.
-- disposition_reason: minimized enum code (high:<signal> / unknown_context / low_reviewed).
-- disposition_at: runner processed-marker (idempotency: runner skips rows where disposition_at IS NOT NULL).
-- disposition_by: source (a4_runner / admin:<id>) for traceability.
--
-- The migration + resetDb runners split SQL on raw semicolons, so NO comment in this file may contain a semicolon.

ALTER TABLE user_webauthn_credentials ADD COLUMN requires_reverification INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_webauthn_credentials ADD COLUMN disposition_reason TEXT;
ALTER TABLE user_webauthn_credentials ADD COLUMN disposition_at TEXT;
ALTER TABLE user_webauthn_credentials ADD COLUMN disposition_by TEXT;
CREATE INDEX IF NOT EXISTS idx_user_webauthn_credentials_reverif
  ON user_webauthn_credentials(requires_reverification) WHERE requires_reverification = 1;

ALTER TABLE user_wallets ADD COLUMN requires_reverification INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_wallets ADD COLUMN disposition_reason TEXT;
ALTER TABLE user_wallets ADD COLUMN disposition_at TEXT;
ALTER TABLE user_wallets ADD COLUMN disposition_by TEXT;
CREATE INDEX IF NOT EXISTS idx_user_wallets_reverif
  ON user_wallets(requires_reverification) WHERE requires_reverification = 1;

ALTER TABLE user_identities ADD COLUMN requires_reverification INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_identities ADD COLUMN disposition_reason TEXT;
ALTER TABLE user_identities ADD COLUMN disposition_at TEXT;
ALTER TABLE user_identities ADD COLUMN disposition_by TEXT;
CREATE INDEX IF NOT EXISTS idx_user_identities_reverif
  ON user_identities(requires_reverification) WHERE requires_reverification = 1;
