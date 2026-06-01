-- Down for migration 0050 (Invitation + Member Lifecycle foundation, PR4).
--
-- Safe ONLY before any real invitation / org-create-op row exists (no data loss). Once real rows exist,
-- rollback becomes forward-fix; DROP is forbidden (feedback_irreversible_action_full_review).
-- org_create_operations + invitations both reference tenants/users (no inter-table FK) -- drop order is free.
DROP TABLE IF EXISTS org_create_operations;
DROP TABLE IF EXISTS invitations;
