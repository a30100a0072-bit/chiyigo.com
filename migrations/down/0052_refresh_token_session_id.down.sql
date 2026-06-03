-- Down for migration 0052 (refresh_tokens.session_id, PR5 5d-1a).
--
-- DROP the index FIRST, then the column. SQLite ALTER TABLE DROP COLUMN refuses to drop a column that is
-- referenced by an index, so the index must go first (the 0046 down dropped columns that had NO index and noted
-- D1 >= 3.39 supports ALTER DROP COLUMN -- this is the index-aware variant of that same pattern). session_id
-- carries no FK / CHECK / generated-column dependency once the index is gone, so the column drop then succeeds.
-- Reversibility is proven by the migrations.test 0052 targeted round-trip on the workerd D1 engine.
--
-- Safe while no code reads session_id (5d-1a is schema-only -- 5d-1b write surface + 5d-2 emission come later).
-- Once emission relies on session_id, a rollback becomes forward-fix per feedback_irreversible_action_full_review.
--
-- The migration + resetDb runners split SQL on raw semicolons, so NO comment in this file may contain a semicolon.

DROP INDEX IF EXISTS idx_refresh_tokens_session;
ALTER TABLE refresh_tokens DROP COLUMN session_id;
