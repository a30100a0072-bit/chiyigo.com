-- Migration 0052: refresh_tokens.session_id -- per-login session identity for session.revoked (PR5 5d-1a)
--
-- Upstream design: docs/reviews/pr5d-session-revoked-plan-2026-06-03.md (Codex Gate-1 R2 APPROVED).
--   PR5 5d models the FROZEN session.revoked event (functions/utils/domain-events.ts). Its streamKey is
--   session:<sub>:<scope>:<ref>, and the contract PROMISES "a re-login is a NEW streamKey and is never
--   permanently denied" -- which holds ONLY if ref is PER-LOGIN. refresh_tokens had only device_uuid (stable
--   per browser, NULL for web clients) + token_hash (rotates on every refresh) and NO per-login id. session_id
--   is that per-login id (the OAuth refresh-token-family id).
--
-- session_id is OPAQUE delimiter-safe TEXT, NOT uniformly uuid-shaped: live logins write a UUID (5d-1b code),
--   this backfill writes a legacy_<id> sentinel. The DELIMITER-SAFETY INVARIANT (ref never contains a colon)
--   keeps the 3-colon streamKey cleanly splittable for future RP/tooling -- so the backfill uses an UNDERSCORE
--   (legacy_<id>), never a colon. NO uuid CHECK/regex is added on the column (it must accept both shapes). It is
--   designed as the forerunner of a future login_sessions.id, which must likewise accept opaque TEXT.
--
-- EXPAND stage of expand/migrate/contract: this migration ONLY adds a nullable column, backfills it, and indexes
--   it. 5d-1b code then writes session_id at the 7 interactive-login INSERTs and PRESERVES it across rotation
--   (like auth_time/scope/issued_aud). Emission of session.revoked is 5d-2 -- NOTHING here emits.
--
-- The migration + resetDb runners split SQL on raw semicolons, so NO comment in this file may contain a semicolon.

ALTER TABLE refresh_tokens ADD COLUMN session_id TEXT;

-- Backfill existing rows with a delimiter-safe per-row sentinel. id is the AUTOINCREMENT PK (UNIQUE, never
-- reused), so each legacy row becomes its own stable family id that a future re-login (a fresh UUID) can never
-- collide with -- honoring the contract's "re-login = new streamKey, never permanently denied" for legacy rows.
UPDATE refresh_tokens SET session_id = 'legacy_' || id WHERE session_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id);
