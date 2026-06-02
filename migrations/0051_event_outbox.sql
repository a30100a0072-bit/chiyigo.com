-- Migration 0051: Event Outbox + per-streamKey Sequence + DLQ + internal Deny-State projection (B2B platform PR5)
--
-- Upstream design: docs/reviews/pr5-event-outbox-consumer-plan-2026-06-02.md (Codex Gate-1 APPROVED, R4).
--   Reuses the PR4-frozen domain-event contract (functions/utils/domain-events.ts) VERBATIM. PR5 is the first
--   module that emits / persists / delivers events. D1 outbox + HTTP cron consumer is the established 0-cost
--   pattern (no CF Queues / Durable Objects).
--
-- 4 tables (expand-only, fully idempotent IF NOT EXISTS, no ALTER of existing tables):
--   event_stream_sequences -- per-streamKey monotonic allocator (last_seq = the most-recently-ALLOCATED seq)
--   event_outbox           -- durable transactional event log + delivery state (5a emits; 5b consumes)
--   event_dlq              -- dead letters (actionable, admin replay) -- exercised in 5b
--   event_deny_state       -- INTERNAL materialized deny-state projection (NOT an RP wire contract) -- 5b
--
-- The emitter assigns event_id (UUID) + stream_seq (in-batch allocated) + occurred_at at emission. stream_key is
--   DERIVED from the event (deriveStreamKey). Ordering authority = (stream_key, stream_seq), NOT occurred_at.
--
-- Transition discipline is enforced at the APP layer (the repo uses NO DB triggers -- the migration + resetDb
--   runners split SQL on raw semicolons, so NO comment in this file may contain a semicolon). event_outbox
--   transitions are owner-CAS fenced + changes()-gated in the 5b consumer (plan section 9.3 F-R3-1); the
--   in-batch seq allocation + changes() chaining + SQL-derived payload were validated by the 5a spike on local
--   AND remote D1.

-- event_stream_sequences: one row per streamKey. last_seq starts at 1 on first emit, +1 each subsequent emit.
CREATE TABLE IF NOT EXISTS event_stream_sequences (
  stream_key TEXT PRIMARY KEY,
  last_seq   INTEGER NOT NULL CONSTRAINT ck_ess_last_seq_pos CHECK(last_seq >= 1),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- event_outbox: the durable event log. status pending->processing->done|dead. UNIQUE(stream_key,stream_seq) is
-- the ordering-integrity guard (one event per seq per stream). event_id is the delivery-layer dedup key.
-- tenant_id is a denormalized tag (null for account/session events) -- deliberately NO FK (an event log is not
-- tenant-owned data; the future RP read API filters on it).
CREATE TABLE IF NOT EXISTS event_outbox (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id        TEXT    NOT NULL UNIQUE,
  event_type      TEXT    NOT NULL CONSTRAINT ck_eo_type CHECK(event_type IN (
                    'member.invited','member.joined','member.suspended','member.reactivated',
                    'member.offboarded','member.role_changed','account.disabled','account.reenabled',
                    'product_access.revoked','product_access.restored','session.revoked')),
  stream_key      TEXT    NOT NULL,
  stream_seq      INTEGER NOT NULL CONSTRAINT ck_eo_seq_pos CHECK(stream_seq > 0),
  tenant_id       INTEGER,
  actor_sub       TEXT,
  occurred_at     TEXT    NOT NULL,
  data_json       TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending'
                    CONSTRAINT ck_eo_status CHECK(status IN ('pending','processing','done','dead')),
  attempts        INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_eo_attempts_nonneg CHECK(attempts >= 0),
  next_attempt_at TEXT    NOT NULL DEFAULT (datetime('now')),
  lease_until     TEXT,
  locked_by       TEXT,
  last_error      TEXT,
  processed_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  CONSTRAINT uq_eo_stream_seq UNIQUE(stream_key, stream_seq)
);
CREATE INDEX IF NOT EXISTS idx_event_outbox_claim  ON event_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_event_outbox_lease  ON event_outbox(lease_until) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_event_outbox_stream ON event_outbox(stream_key, stream_seq);

-- event_dlq: dead letters. NO UNIQUE(event_id) by design -- a replay that later re-fails writes a NEW episode
-- row (the old row is stamped replayed_at). replayed_by is the only FK.
CREATE TABLE IF NOT EXISTS event_dlq (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id    TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  stream_key  TEXT    NOT NULL,
  stream_seq  INTEGER NOT NULL,
  tenant_id   INTEGER,
  actor_sub   TEXT,
  occurred_at TEXT    NOT NULL,
  data_json   TEXT    NOT NULL,
  dlq_reason  TEXT    NOT NULL
              CONSTRAINT ck_dlq_reason CHECK(dlq_reason IN ('max_attempts','validation_failed','gap_detected')),
  attempts    INTEGER NOT NULL,
  last_error  TEXT,
  failed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  replayed_at TEXT,
  replayed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_event_dlq_pending ON event_dlq(failed_at DESC) WHERE replayed_at IS NULL;

-- event_deny_state: INTERNAL materialized projection (chiyigo-owned; NOT the RP wire contract). One row per
-- streamKey. The 5b consumer applies CONTIGUOUSLY (stream_seq == last_applied_seq + 1) -- plan section 5.2.
CREATE TABLE IF NOT EXISTS event_deny_state (
  stream_key       TEXT    PRIMARY KEY,
  event_type       TEXT    NOT NULL,
  deny_effect      TEXT    NOT NULL CONSTRAINT ck_eds_effect CHECK(deny_effect IN ('deny','undeny','soft','none')),
  denied           INTEGER NOT NULL CONSTRAINT ck_eds_denied_bool CHECK(denied IN (0,1)),
  tenant_id        INTEGER,
  last_applied_seq INTEGER NOT NULL CONSTRAINT ck_eds_seq_pos CHECK(last_applied_seq > 0),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_deny_state_tenant ON event_deny_state(tenant_id);
