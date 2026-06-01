-- Migration 0050: Invitation + Member Lifecycle foundation (B2B platform PR4)
--
-- Upstream design: docs/reviews/pr4-invitation-member-lifecycle-plan-2026-06-01.md (Codex Gate 1 APPROVED, Round 4).
--   D1 = Option B: PR4 freezes the domain-event CONTRACT only. NO event_outbox / delivery / consumer (that is PR5).
--
-- 2 tables:
--   invitations           -- pending-invite state holder + one-time signed token (hash-at-rest)
--   org_create_operations -- durable idempotency ledger for POST /api/tenants (replay-safe org creation)
-- expand-only: only adds new tables, does not ALTER existing tables. Fully idempotent (IF NOT EXISTS).
--
-- APPEND-ONLY discipline (org_create_operations): enforced at the APP layer (members.ts only ever INSERTs here),
--   matching audit_log (0017) / grant_plan_operations (0048) / credit_ledger (0049) house style. The repo uses NO
--   DB triggers. CRITICAL: the migration + resetDb runners split SQL on raw semicolons, so NO comment in this file
--   may contain a semicolon (it would truncate the surrounding statement). org_create_operations is NOT the event
--   outbox (PR5) -- it is a per-op idempotency ledger for org creation only.
--
-- offboard is a row DELETE on organization_members (no offboarded status, no enum/CHECK change to 0047).

-- invitations: one pending invite per (tenant,email). token stored hashed. accept consumes atomically (plan section 7).
CREATE TABLE IF NOT EXISTS invitations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),
  email            TEXT    NOT NULL,                  -- invitee email, lowercased at write, bound at accept
  platform_role    TEXT    NOT NULL DEFAULT 'member'
                           CONSTRAINT ck_inv_role CHECK(platform_role IN ('tenant_admin','billing_admin','member')),  -- NOT tenant_owner (section 8)
  token_hash       TEXT    NOT NULL UNIQUE,           -- SHA-256 of the raw token (raw token only ever in the email link)
  status           TEXT    NOT NULL DEFAULT 'pending'
                           CONSTRAINT ck_inv_status CHECK(status IN ('pending','accepted','revoked','expired')),
  expires_at       TEXT    NOT NULL,                  -- set + ordering-compared via datetime() SQLite format, never app-ISO
  invited_by       INTEGER NOT NULL REFERENCES users(id),  -- actor snapshot (owner/admin who invited)
  accepted_user_id INTEGER REFERENCES users(id),      -- set atomically at accept (one-time consume marker)
  accepted_at      TEXT,                              -- set at accept = the request unique occurredAt (freshness marker, EXACT-equality matched)
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  -- accepted rows carry both consume fields, non-accepted carry neither (no half-consumed row).
  CONSTRAINT ck_inv_accept_fields CHECK(
        (status =  'accepted' AND accepted_user_id IS NOT NULL AND accepted_at IS NOT NULL)
     OR (status <> 'accepted' AND accepted_user_id IS NULL     AND accepted_at IS NULL) )
);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON invitations(expires_at);
-- At most ONE live (pending) invite per (tenant,email). re-inviting supersedes (section 7.1).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_pending
  ON invitations(tenant_id, email) WHERE status = 'pending';

-- org_create_operations: durable idempotency for org creation (section 4.3). UNIQUE is the concurrency arbiter.
CREATE TABLE IF NOT EXISTS org_create_operations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  creator_user_id  INTEGER NOT NULL REFERENCES users(id),
  idempotency_key  TEXT    NOT NULL,                  -- caller-supplied, bounded at the app layer
  request_hash     TEXT    NOT NULL,                  -- sha256 of canonical {creator_user_id, name} for replay-vs-conflict
  tenant_id        INTEGER NOT NULL REFERENCES tenants(id),  -- the org tenant this op created (the replay result)
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(creator_user_id, idempotency_key)            -- concurrency arbiter + pre-check covering index
);
CREATE INDEX IF NOT EXISTS idx_org_create_ops_tenant ON org_create_operations(tenant_id);
