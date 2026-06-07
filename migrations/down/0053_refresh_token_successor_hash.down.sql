-- Down for migration 0053 (refresh_tokens.successor_token_hash, Fork 2 Route B).
--
-- Plain DROP COLUMN (D1 >= 3.39, per the 0052 precedent). No index was added, so nothing to drop first. The column
-- carries no FK / CHECK / generated-column dependency, so the drop succeeds. Reversibility is proven by the
-- migrations.test 0053 targeted round-trip on the workerd D1 engine.
--
-- Safe rollback: once the column is gone, every revoked token is a non-candidate again, so the refresh handler falls
-- back to the pre-Route-B behavior (reuse_detected for all revoked-token replays) -- no data loss, no token issuance.
-- Once Route B classification ships and is relied on for audit hygiene, a rollback becomes forward-fix per
-- feedback_irreversible_action_full_review.
--
-- The migration + resetDb runners split SQL on raw semicolons, so NO comment in this file may contain a semicolon.

ALTER TABLE refresh_tokens DROP COLUMN successor_token_hash;
