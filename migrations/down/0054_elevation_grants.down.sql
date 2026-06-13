-- Down for migration 0054 (elevation_grants + elevation_exchanges + oauth_states elevation columns).
--
-- DROP indexes FIRST, then tables (SQLite refuses DROP COLUMN referenced by an index; tables drop their own
--   indexes but explicit DROP INDEX IF EXISTS keeps the down idempotent and mirrors the 0052 index-aware pattern).
--   The oauth_states elevation columns carry NO index / FK / CHECK / generated dependency → ALTER DROP COLUMN
--   (D1 >= 3.39) succeeds directly. Reversibility proven by migrations.test 0054 targeted round-trip on workerd D1.
--
-- Safe while no code reads these（PR-A1 is schema-only EXPAND; elevation runtime is PR-A2/A3）. Once runtime relies
--   on them, a rollback becomes forward-fix per feedback_irreversible_action_full_review.
--
-- The migration + resetDb runners split SQL on raw semicolons, so NO comment in this file may contain a semicolon.

DROP INDEX IF EXISTS idx_elevation_grants_user;
DROP INDEX IF EXISTS idx_elevation_grants_session;
DROP INDEX IF EXISTS idx_elevation_grants_action;
DROP INDEX IF EXISTS idx_elevation_grants_expires;
DROP TABLE IF EXISTS elevation_grants;

DROP INDEX IF EXISTS idx_elevation_exchanges_session;
DROP INDEX IF EXISTS idx_elevation_exchanges_expires;
DROP TABLE IF EXISTS elevation_exchanges;

ALTER TABLE oauth_states DROP COLUMN factor_add_grant_hash;
ALTER TABLE oauth_states DROP COLUMN action;
ALTER TABLE oauth_states DROP COLUMN session_id;
ALTER TABLE oauth_states DROP COLUMN elevation_user_id;
ALTER TABLE oauth_states DROP COLUMN purpose;
