-- Down for migration 0051 (Event Outbox + Sequence + DLQ + Deny-State projection, PR5).
--
-- Safe ONLY before any real event row exists (no data loss). Once real events exist, rollback becomes
-- forward-fix and DROP is forbidden (feedback_irreversible_action_full_review / destructive-migration ban).
-- event_dlq.replayed_by -> users(id) is the only FK (ON DELETE SET NULL); drop order is otherwise free.
DROP TABLE IF EXISTS event_deny_state;
DROP TABLE IF EXISTS event_dlq;
DROP TABLE IF EXISTS event_outbox;
DROP TABLE IF EXISTS event_stream_sequences;
