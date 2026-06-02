# PR5 5b - Consumer + Deny-State Projection + DLQ Replay (Gate-1 Plan)

- Created: 2026-06-02
- Status: DRAFT R2 for Codex Gate-1 re-review. Addresses Codex Gate-1 R1 REJECT (2 state-machine blockers + emitted-audit boundary). NOT yet coded.
- DESIGN SoT: docs/reviews/pr5-event-outbox-consumer-plan-2026-06-02.md (the PR5 master plan, Gate-1 R4 APPROVED).
  This 5b plan does NOT re-derive that design -- it is the IMPLEMENTATION plan for the 5b slice: which files,
  which functions, the commit breakdown, the schema-sufficiency proof, and the six 5b locks confirmed against the
  approved design. Section refs like "(master 9.3)" point at the master plan.
- Predecessor: 5a SHIPPED (PR #12 -> main d675b35; migration 0051 applied to prod + 4 tables verified;
  credential-free smoke PASS). 5a emits domain events into event_outbox; NOTHING consumes them yet.
- Workgrade: L3 + HIGH-RISK ADDENDUM (Queue/Message + Distributed State). Reuses the master plan's full 10-step
  domain flow; this doc focuses on the 5b implementation surface.
- Constraints: $0 (Cloudflare free tier), no CF Queues / Durable Objects, no vendor lock-in, Tier-0 baseline.

--------------------------------------------------------------------------------
## R1 -> R2 changelog (what changed since Codex Gate-1 R1 REJECT)
--------------------------------------------------------------------------------

C1 (CRITICAL, crash recovery): R1's STEP B abbreviated the claim predicate to "eligible", which did NOT make it
   explicit that an EXPIRED 'processing' row with attempts<MAX is re-claimable. A consumer that crashes at
   attempts=1 (lease then expires) would otherwise be neither 'pending' nor maxed -> never reclaimed -> the
   streamKey is head-of-line blocked forever. R2 spells the claim predicate out IN FULL (section 5 STEP B):
   `(status='pending' AND next_attempt_at<=now) OR (status='processing' AND lease_until<now)`, AND attempts<MAX,
   AND contiguity. Added the explicit reclaim test (section 7).

C2 (CRITICAL, replay atomicity): R1's DLQ replay said "reset outbox + stamp dlq" with no atomicity / CAS gating.
   Two admins replaying, or a crash between the two writes, could let a stale unreplayed DLQ row reset an
   already-'done' outbox event back to 'pending'. R2 makes replay a SINGLE atomic db.batch, CAS-gated: the outbox
   reset fires ONLY when the outbox is 'dead' AND the target DLQ row is unreplayed; the dlq stamp is gated on the
   reset's changes()=1; 0-row -> 409 idempotent no-op. Added double-replay / stale-replay tests. (section 6)

C3 (emitted-audit boundary): domain.event.emitted placement is now defined EXPLICITLY (section 6 AUDIT): emitted
   at the ENDPOINT layer (repo pattern) from emission metadata the domain fn RETURNS on 'applied', best-effort
   (safeUserAudit swallow), post-commit, NEVER inside the Tier-0 emit batch. data = stream_key_hash + eventType +
   eventId + tenantId (no raw streamKey; streamSeq lives in the outbox row, so no Tier-0 read-back).

No schema change (Codex confirmed): all three fixes are SQL / state-machine contract fixes; 0051 remains
sufficient and 5b stays code-only.

--------------------------------------------------------------------------------
## 0. Preflight evidence (post-ship, captured 2026-06-02)
--------------------------------------------------------------------------------

prod `event_outbox` status counts (read-only query, served_by v3-prod/APAC/NRT):
    TOTAL = 0   (no rows in any status)

Interpretation: 5a is live but no AUTHENTICATED member/invitation operation has emitted yet (positive smoke was
owner-deferred). So 5b enters with ZERO accumulated backlog -- the "pending grows with no consumer" watch is
controlled, not urgent. This count is re-checked at 5b code time and recorded in the 5b PR body as the baseline.

--------------------------------------------------------------------------------
## 1. The six 5b locks (owner directives, confirmed against the approved design)
--------------------------------------------------------------------------------

L1. CRON PATTERN: HTTP endpoint + `Authorization: Bearer <CRON_SECRET>` + a GitHub Actions workflow on a schedule
    (mirror functions/api/admin/cron/audit-archive.ts + .github/workflows/cron-*.yml). NO native Workers
    [triggers], NO CF Queues, NO Durable Objects. (master 9.3 / 0.1-B)

L2. CONSUMER STATE MACHINE: the R4 fencing invariant F-R3-1 is IMPLEMENTED, not just documented:
    - G1 owner-CAS on EVERY worker transition processing -> {done,pending,dead}:
      `WHERE id=? AND status='processing' AND locked_by=<runToken>`.
    - G2 mark-done gated on the projection CAS actually applying (`AND changes()=1` after the projection upsert).
    - G3 every DLQ write is db.batch([UPDATE outbox->dead (CAS), INSERT event_dlq SELECT ... WHERE changes()=1]).
    - sweep (reaps abandoned rows) uses a status+lease+attempts CAS (not owner-CAS).
    - the run report counts FENCED rows (owner-CAS 0-row losers) + swept/claimed/delivered/retried/dlq.
    (master 5.1 / 9.3 STEP A-C; the changes()-gating reuses the 5a-spike-proven D1 semantics, local + remote.)

L3. CONTIGUOUS APPLY proves a gap is NEVER silently skipped:
    - the claim SQL refuses a row while an earlier-seq same-streamKey row is not 'done' (per-streamKey in-order).
    - the projection applies ONLY when streamSeq == last_applied_seq + 1; <= is an idempotent no-op; > is a GAP =
      invariant violation -> critical audit domain.event.gap_detected + DLQ(reason='gap_detected') + dead (NOT a
      silent skip, NOT a silent retry). soft/none events advance the cursor only IN ORDER.
    - tests assert: a forced out-of-order delivery does NOT skip a lower-seq deny; a soft event cannot pass a
      still-pending deny. (master 5.2 / B1 / F3)

L4. DLQ REPLAY ENDPOINT: explicit fine scope `admin:events:replay` (under the existing scope hierarchy; admin/
    dev/super_admin inherit, finance/support do NOT) + step-up + per-user rate limit. The RESPONSE and the audit
    emit only stream_key_hash + eventId + dlq_reason -- NEVER the raw stream_key or data_json. (master 9.4 / F4 / B4)

L5. domain.event.* AUDIT + RUN-REPORT OBSERVABILITY land in 5b (deferred from 5a):
    register all PR5 event types in audit-policy + emit them; the consumer returns a structured run report.
    All audit data fields use stream_key_hash, never the raw streamKey/data_json. (master 11 / B4)

L6. NO "code-only" assumption: section 4 PROVES per-operation that migration 0051's tables/indexes are sufficient
    for the consumer + replay + projection + audit, and ONLY THEN declares no new migration (else specifies 0052).

--------------------------------------------------------------------------------
## 2. Scope (5b) + non-goals
--------------------------------------------------------------------------------

IN SCOPE:
- deny-state projection module (pure, contiguous-apply, returns {apply|noop|gap}).
- consumer cron endpoint (sweep + claim + deliver; F-R3-1 fencing; run report).
- the GitHub Actions cron workflow.
- DLQ replay admin endpoint (scope + step-up + redaction).
- audit-policy registration of the PR5 event types + their emission (incl. the 5a-deferred domain.event.emitted).
- member.invited emission (the SQL-derived read-your-writes path deferred from 5a).
- the full 5b test matrix (master 12 5b).

NON-GOALS:
- NO push to RP endpoints / NO public RP pull API over event_deny_state (master D1 guardrail).
- NO product_access.* emission (deferred entirely to F-2; master ruling 18.1).
- NO whole-user logout-all event (future token epoch).
- 5c (ban/unban/session.revoked retro-wiring) is a SEPARATE later phase.
- NO outbox 'done'-row purge cron yet (master 16; flagged, separate hygiene task; safe to defer with TOTAL~0).

--------------------------------------------------------------------------------
## 3. Modules + files (implementation surface)
--------------------------------------------------------------------------------

NEW:
- functions/utils/deny-state-projection.ts      -- pure contiguous-apply rule (no I/O); returns the decision +
                                                   the upsert values. Unit-testable in isolation. (L3)
- functions/api/admin/cron/event-outbox.ts       -- the consumer (L1 auth, L2 fencing, run report). (master 9.3)
- functions/api/admin/event-dlq/[id]/replay.ts   -- DLQ replay (L4). (master 9.4)
- .github/workflows/cron-event-outbox.yml         -- 5-min schedule, Bearer CRON_SECRET (L1).
- tests/integration/event-outbox-consumer.test.ts -- consumer + projection + fencing + replay tests (master 12).
- tests/integration/event-invited-emission.test.ts -- member.invited SQL-derived emission tests.

MODIFIED:
- functions/utils/domain-event-emit.ts  -- add emitMemberInvited (SQL-derived invitationId read-your-writes) +
                                           a stream_key_hash helper for redaction.
- functions/utils/invitations.ts        -- wire createInvitation -> member.invited into its existing batch.
- functions/utils/scopes.ts             -- add admin:events:replay to the scope hierarchy (L4).
- functions/utils/audit-policy.ts       -- register the PR5 domain.event.* types + bump _registrySize (L5).
- members.ts / invitations.ts           -- RETURN emission identity (eventId/eventType/streamKey/tenantId) on
                                           'applied' so the endpoint can audit it (C3); no audit I/O in the domain.
- the member / invitation ENDPOINTS     -- emit best-effort post-commit domain.event.emitted from that metadata (C3).

--------------------------------------------------------------------------------
## 4. SCHEMA SUFFICIENCY PROOF (L6) -- does 5b need a migration 0052?
--------------------------------------------------------------------------------

Per-operation mapping of every 5b DB access to migration 0051 (functions/columns/indexes already on prod):

  CONSUMER claim (master 9.3 STEP B):
    reads/writes event_outbox.{id,status,next_attempt_at,lease_until,attempts,locked_by,stream_key,stream_seq}
    -> all present (0051). uses idx_event_outbox_claim (status,next_attempt_at) + the (stream_key,stream_seq)
       index for the contiguity NOT EXISTS. PRESENT.
  CONSUMER deliver/done/retry (STEP C):
    writes event_outbox.{status,processed_at,lease_until,last_error,next_attempt_at}; owner-CAS on
    {id,status,locked_by}. -> all present.
  PROJECTION upsert (5.2):
    event_deny_state.{stream_key(PK),event_type,deny_effect,denied,tenant_id,last_applied_seq,updated_at};
    CAS on last_applied_seq. -> all present (0051). tenant_id index present.
  DLQ write (G3) + sweep (STEP A):
    event_dlq insert of {event_id,event_type,stream_key,stream_seq,tenant_id,actor_sub,occurred_at,data_json,
    dlq_reason,attempts,last_error}; dlq_reason CHECK already includes 'gap_detected'. -> all present.
  DLQ replay (9.4):
    reset event_outbox by event_id (UNIQUE -> indexed); stamp event_dlq.{replayed_at,replayed_by}; list pending
    via idx_event_dlq_pending. -> all present.
  AUDIT (L5): domain.event.* -> rows in the EXISTING audit_log (no new table); classification is code (audit-policy).
  SCOPE admin:events:replay (L4): code (scopes.ts), NOT a DB object.
  RUN REPORT + fenced counter (L2): in-memory + HTTP body + an audit_log row. NO DB column.
  member.invited emission: writes event_outbox + event_stream_sequences (same as 5a). -> present.

CONCLUSION (to be confirmed by Codex): migration 0051 is SUFFICIENT for all of 5b. **5b is code-only, NO 0052.**
The dlq_reason CHECK already carries 'gap_detected' (added in 0051 ahead of 5b). If Codex finds any missing
index/column during plan review, 5b gains a 0052 -- but the per-operation mapping above finds none.

--------------------------------------------------------------------------------
## 5. Consumer design (L1 + L2) -- the implementation contract
--------------------------------------------------------------------------------

Endpoint: POST functions/api/admin/cron/event-outbox.ts
  - Auth: 500 if CRON_SECRET unset; 401 if `Authorization` != `Bearer <CRON_SECRET>` (mirror audit-archive).
  - Defaults (master 9.3, owner-accepted): LEASE=120s, MAX_ATTEMPTS=6, cron=5 min, backoff=[1m,5m,30m,2h,12h,24h];
    all env-overridable (EVENT_OUTBOX_CLAIM_LIMIT=50, _RETRY_BACKOFF_MS CSV for tests, _MAX_ATTEMPTS, _LEASE_SECONDS).
  - runToken = randomUUID() per run (the fence; uniqueness suffices, master G1).
  - STEP A sweep: per exhausted row (processing AND lease<now AND attempts>=MAX) -> atomic
    db.batch([UPDATE outbox SET status='dead' WHERE id=? AND status='processing' AND lease_until<now AND
    attempts>=MAX, INSERT event_dlq(reason='max_attempts') SELECT ... WHERE changes()=1]) + critical audit.
  - STEP B claim (attempts++ at claim ONLY -- single source; C1 explicit predicate):
      UPDATE event_outbox SET status='processing', locked_by=runToken, lease_until=datetime('now','+<LEASE> seconds'),
             attempts=attempts+1
      WHERE id IN (
        SELECT o.id FROM event_outbox o
        WHERE ( (o.status='pending'    AND o.next_attempt_at<=datetime('now'))
             OR (o.status='processing' AND o.lease_until    < datetime('now')) )   -- EXPIRED processing IS reclaimable
          AND o.attempts < <MAX>                                                   -- never claim past MAX (sweep owns those)
          AND NOT EXISTS (SELECT 1 FROM event_outbox e
                            WHERE e.stream_key=o.stream_key AND e.stream_seq<o.stream_seq AND e.status<>'done')
        ORDER BY o.id ASC LIMIT ?)
      then SELECT claimed WHERE locked_by=runToken AND status='processing' ORDER BY stream_key, stream_seq.
    CRASH RECOVERY (C1): a consumer that crashes at attempts=1 leaves a 'processing' row; once its lease expires it
    is RE-CLAIMED here (it is expired-processing AND attempts<MAX), attempts increments to 2, and it retries. It is
    NEVER stuck -- the sweep (STEP A) only reaps attempts>=MAX. Repeated crashes climb attempts to MAX, then the
    sweep collects it to DLQ. Bounded + terminating.
  - STEP C deliver per claimed row (OWNER = id+status='processing'+locked_by=runToken):
      reconstruct via frozen buildDomainEvent (re-validate; poison -> DLQ validation_failed);
      read prior=last_applied_seq; ask deny-state-projection module for {apply|noop|gap}:
        apply: db.batch([ event_deny_state upsert CAS ON CONFLICT WHERE last_applied_seq=prior ;
               UPDATE outbox SET status='done',processed_at,lease_until=null WHERE OWNER AND changes()=1 ]) (G2).
        noop : UPDATE outbox done WHERE OWNER.
        gap  : db.batch([UPDATE outbox dead WHERE OWNER, INSERT event_dlq(reason='gap_detected') WHERE changes()=1])
               + critical audit (F3).
      transient apply error: attempts<MAX -> pending+backoff WHERE OWNER; attempts>=MAX -> DLQ(max_attempts) (G3).
  - Run report (HTTP body + domain.event.consumer_run audit): {run_id, swept, claimed, delivered, retried, dlq,
    FENCED (owner-CAS 0-row losers), errors}. stream_key_hash only, never raw streamKey.

Per-streamKey throughput = 1 event / tick (the contiguity NOT EXISTS yields at most one claimable row per
streamKey/run); acceptable (per-subject event rate is low). Head-of-line: a dead/stuck seq blocks its streamKey
until replay (alarmed). (master 5.2)

--------------------------------------------------------------------------------
## 6. Projection (L3), Replay (L4), Audit/obs (L5), member.invited
--------------------------------------------------------------------------------

PROJECTION (deny-state-projection.ts, pure): given (event, prior) return apply|noop|gap + denied =
  deny -> 1, undeny -> 0, soft/none -> prior denied (default 0). The CONSUMER executes the DB writes (the module
  does no I/O), so the gap->DLQ side effect is the consumer's, not the module's. (master 5.2)

REPLAY (admin/event-dlq/[id]/replay.ts): requireStepUp(elevated) + for_action='event_dlq_replay' + effective
  scope admin:events:replay + per-user rate limit + server actor. The state transition is a SINGLE ATOMIC,
  CAS-GATED db.batch (C2) -- never two un-gated writes:
    S1: UPDATE event_outbox SET status='pending', attempts=0, next_attempt_at=datetime('now'),
            lease_until=NULL, locked_by=NULL, last_error=NULL
        WHERE status='dead'                                                    -- only re-enqueue a genuinely dead row
          AND event_id = (SELECT event_id FROM event_dlq WHERE id=? AND replayed_at IS NULL)  -- AND DLQ row unreplayed
    S2: UPDATE event_dlq SET replayed_at=datetime('now'), replayed_by=?
        WHERE id=? AND replayed_at IS NULL AND changes()=1                     -- stamp ONLY if S1 reset a row
  Outcome by S1.changes(): 1 -> replayed (200); 0 -> idempotent no-op -> 409 ALREADY_REPLAYED_OR_NOT_DEAD (the
  outbox is not 'dead', or the DLQ row is already replayed / mismatched). This PREVENTS a stale unreplayed DLQ row
  from resetting an already-'done' outbox to 'pending' (the `status='dead'` CAS), and double-replay (the
  `replayed_at IS NULL` subquery + the changes()=1 gate) -- both-or-neither, atomic, idempotent.
  Response + audit: stream_key_hash + eventId + dlq_reason ONLY (never raw stream_key/data_json). Replaying a
  head-of-line blocker auto-unblocks its streamKey (the claim NOT EXISTS). (master 9.4)

AUDIT (audit-policy.ts, +7 -- emitted moves here from 5a):
  domain.event.emitted (info), .delivered (info), .retry (warn), .dlq (critical), .consumer_run (info),
  .validation_failed (critical), .gap_detected (critical). ALL data fields use streamKeyHash. Explicit it.each
  classification + _registrySize bump (current 198, verify at coding time). (master 11)
  domain.event.emitted AUDIT BOUNDARY (C3, explicit): emitted at the ENDPOINT layer (the repo pattern -- endpoints
  already audit member/invitation outcomes), NOT inside the domain utils' Tier-0 batch. The domain transition
  returns its emission identity on 'applied' (eventId, eventType, streamKey, tenantId); the endpoint emits
  domain.event.emitted via safeUserAudit POST-COMMIT, BEST-EFFORT (swallow-on-failure). Its loss never affects
  correctness (the outbox row is the SoT). data = stream_key_hash + eventType + eventId + tenantId -- NO raw
  stream_key, NO streamSeq (streamSeq lives in the outbox row, so the applied path needs no read-back).

member.invited (deferred from 5a): emitMemberInvited builds data_json via json_object reading the just-inserted
  invitations row by token_hash (invitationId is post-INSERT -- the SQL-derived read-your-writes case the 5a
  spike's mechanism already proved). streamKey is email-keyed (tenant:T:member:<email>), 'none' effect, isolated
  from the sub-keyed member.* streams. Wired into createInvitation's existing batch, gated on the insert. (master B2)

--------------------------------------------------------------------------------
## 7. Test plan (master 12 5b, made concrete)
--------------------------------------------------------------------------------

- claim leases only eligible rows; two overlapping runs never both own a row.
- happy: pending -> done; projection denied/undenied per DENY_EFFECT; last_applied_seq +1.
- CONTIGUITY (L3): seq N not 'done' -> seq N+1 not claimed/delivered.
- GAP DETECTION (L3/F3): force-deliver a gap -> NO apply, DLQ(gap_detected) + critical audit (NOT silent).
- soft-before-deny: member.role_changed (soft) can never pass a still-pending member.suspended (deny).
- idempotent re-delivery: same eventId / seq<=last_applied -> no state change.
- attempts SINGLE SOURCE (B3): one failed delivery -> attempts==1 (claim-time only, not double).
- transient retry -> backoff -> eventual done.
- C1 CRASH RECOVERY (transient): an expired 'processing' row with attempts<MAX is RE-CLAIMED (not stuck), attempts
  increments exactly once per claim, and it completes on a later run. (locks the EXACT failure mode of blocker 1)
- poison -> DLQ(validation_failed); max attempts -> DLQ(max_attempts); MAX-ATTEMPT CRASH SWEEP converges.
- G1 FENCING: stale-worker resume (re-claim by another runToken) 0-rows + cannot stomp; fenced counter increments.
- G2: projection CAS 0-row -> outbox NOT marked done.
- G3: overlapping sweeps/DLQ -> exactly ONE event_dlq row.
- replay happy: dead -> pending -> delivered; head-of-line replay unblocks N+1.
- C2 REPLAY ATOMICITY: (a) double-replay of one DLQ row -> first 200, second 409 no-op (no second reset); (b) a
  stale unreplayed DLQ row whose outbox is already 'done' -> replay 409 no-op, outbox stays 'done' (NEVER reset to
  pending); (c) replay of a non-dead outbox -> 409. (locks the EXACT failure mode of blocker 2)
- F4 authz: no scope -> 403; finance/support -> 403; scope but no step-up -> 401; response/audit carry no raw
  streamKey/data_json (stream_key_hash only).
- member.invited: createInvitation emits with the real (post-insert) invitationId; streamKey email-keyed.
- audit-policy registry test updated (+7, it.each classification).
Infra: vitest workers pool + real local D1; the cron handler invoked directly with a Bearer header (like
audit-archive tests); env backoff override [0,0,0] to avoid real waits.

--------------------------------------------------------------------------------
## 8. Commit plan (5b; small, reviewable; each gate-checked)
--------------------------------------------------------------------------------

  d1 deny-state-projection.ts (pure module) + unit tests
  d2 consumer cron (sweep+claim+deliver, F-R3-1 fencing, run report) + cron-event-outbox.yml + consumer tests
  d3 DLQ replay endpoint + scopes.ts (admin:events:replay) + step-up + redaction + authz tests
  d4 audit-policy +7 (domain.event.*) + domain fns return emission identity on 'applied' + endpoints emit
     best-effort domain.event.emitted from it (C3)
  d5 emitMemberInvited (SQL-derived) + createInvitation wiring + member.invited tests

5b is CODE-ONLY (section 4): no migration. migration-before-deploy is therefore N/A for 5b (0051 already on prod);
the 5b PR still re-checks the prod event_outbox count as evidence and runs the full gate suite before merge.

--------------------------------------------------------------------------------
## 9. Open questions for Codex (Gate-1)
--------------------------------------------------------------------------------

9.1 Schema sufficiency (section 4) -- RESOLVED by R1 ("I do not see a reason for 0052 yet"). The R2 fixes (C1/C2/
    C3) are SQL / state-machine contract fixes, NOT schema; 5b stays code-only. Re-confirm.
9.2 domain.event.emitted placement -- RESOLVED by R1 (C3): endpoint-level, from returned emission metadata,
    best-effort post-commit, never in the Tier-0 batch (section 6 AUDIT).
9.3 cron interval / lease / MAX_ATTEMPTS (5m / 120s / 6) -- accepted (no R1 objection); reaffirm for the live
    consumer or tighten to the revocation-lag SLO.
9.4 per-streamKey 1 event / tick -- RESOLVED by R1 (acceptable for 5b: RP integration absent + chiyigo enforces
    live DB state).

R2 carries no new open questions; the two blockers (C1 claim predicate / C2 replay atomicity) + C3 emitted-audit
boundary are addressed above and in the cited sections.

--- END PR5 5b GATE-1 PLAN (R2) ---
