# PR5 - Event Outbox + Consumer (Gate-1 Plan)

- Created: 2026-06-02
- Status: DRAFT R3 for Codex Gate-1 re-review. Addresses Codex Gate-1 R2 REJECT (4 findings); R1 (4 blockers) already folded. NOT yet coded.
- Plan order: docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md section 20, step 5
  ("Event outbox + consumer: lease / retry / DLQ / replay"). PR1-PR4 SHIPPED.
- Workgrade: L3 (new bounded-context infra + security model surface) + HIGH-RISK ADDENDUM
  (Queue/Message + Distributed State + cross-system JSON contract). Runs the full 10-step domain flow.
- Predecessor contract: functions/utils/domain-events.ts (FROZEN by PR4, Codex Gate-1 APPROVED R4).
  PR5 REUSES it verbatim and is the FIRST module that emits / persists / delivers events.
- Constraints: $0 (Cloudflare free tier only), no CF Queues / Durable Objects (paid), no vendor lock-in,
  Tier-0 baseline. D1 outbox + HTTP cron consumer is the established $0 pattern (see audit-archive cron).

--------------------------------------------------------------------------------
## R2 -> R3 changelog (what changed since Codex Gate-1 R2 REJECT)
--------------------------------------------------------------------------------

The R2 reject centered on 5a WIRING amplifying latent races in the EXISTING PR4 domain code. The "all 5a data is
PRE-batch known" claim was WRONG. Fixes:

F1 (CRITICAL, stale role payload): member.suspended.previousRole / member.reactivated.platformRole /
   member.role_changed.fromRole were taken from an app PRE-READ (pre.member.platform_role) that the CAS does NOT
   pin, so a concurrent role change emits a STALE role. Fix per field:
   - suspend.previousRole / reactivate.platformRole -> SQL-DERIVED authoritative: read platform_role from the row
     IN THE SAME BATCH AFTER the mutation (suspend/reactivate do NOT change the role, so the post-mutation row
     carries the true role regardless of concurrency). No CAS change, no new failure mode.
   - role_changed.fromRole -> CANNOT be read post-UPDATE (the UPDATE overwrites it), so BIND the pre-read role
     into the CAS (`AND platform_role = ?fromRole`): the emit only fires when the role was still fromRole, making
     fromRole authoritative + adding optimistic-concurrency safety (a concurrent change to a 3rd role now 0-rows
     -> illegal_transition instead of applying on a stale base).
   - offboard ({sub,reason}) + joined ({sub,platformRole from the IMMUTABLE invite}) carry no stale-role risk.
   Consequence: the emit helper MUST support SQL-DERIVED data fields (not pre-bound-only); see 9.1/9.2. Race tests
   added (12). See sections 9.1, 9.2, 4 (spike), 12, 16.

F2 (CRITICAL, accept catch swallows system errors): acceptInvitation's catch ASSUMES the only batch error is the
   join's UNIQUE violation and returns already_member/already_resolved. Adding [..., seqUpsert, outboxInsert] to
   the batch means an emission/outbox failure also rolls the batch back and would be MISCLASSIFIED as a business
   outcome (event lost + wrong 200). Fix: the catch must rethrow (system failure / 5xx) UNLESS a re-read POSITIVELY
   proves a business cause (membership now exists -> already_member; invite consumed by another -> already_resolved).
   Forced-outbox-failure test added. This RESTRUCTURES accept's catch (the R2 "does not restructure" claim is
   revised). See sections 9.2, 12.

F3 (GAP branch must be loud + bounded): the projection GAP branch did a SILENT attempts-1 + immediate retry --
   if the contiguity invariant ever broke it would retry forever with no DLQ/alarm. Fix: a GAP is an INVARIANT
   VIOLATION -> critical audit (domain.event.gap_detected) + atomic DLQ(reason='gap_detected') + status='dead'
   (loud, bounded, terminating; replayable after the bug is fixed). No silent attempt-decrement. See sections
   5.2, 9.3, 8, 11, 12.

F4 (DLQ replay scope too coarse): replay was just "admin auth + step-up", but event_dlq holds raw stream_key /
   data_json and replay mutates the deny projection. Fix: require an EXPLICIT fine scope (admin:events:replay) +
   step-up; the response + audit emit only stream_key_hash, NEVER raw streamKey/data_json (B4). Negative authz
   tests added. See sections 9.4, 10, 12.

--------------------------------------------------------------------------------
## R1 -> R2 changelog (what changed since Codex Gate-1 R1 REJECT)
--------------------------------------------------------------------------------

B1 (CRITICAL, projection correctness): the projection no longer applies on streamSeq > last_applied_seq with
   gap-skip. It is now CONTIGUOUS: apply iff streamSeq == last_applied_seq + 1; <= is duplicate/stale (ignore);
   > is a GAP that must NOT apply (the predecessor is blocked/retrying/dead). The consumer claim SQL now also
   refuses to deliver a row while an earlier-seq row on the same streamKey is not yet 'done'. This closes the
   soft/none-before-deny skip (member.role_changed advancing past a member.suspended). See sections 5.2, 7, 9.3, 12.

B2 (member.invited payload): member.invited is DEFERRED from 5a to 5b. Its invitationId is only known
   post-INSERT (a read-your-writes case the generic pre-bound helper cannot serve), and it is a 'none'-effect
   event on an ISOLATED email-keyed streamKey (tenant:T:member:<email>, distinct from the sub-keyed member.*),
   so deferring it has zero deny-state impact. 5b wires it via an explicit SQL-derived json_object payload path
   (reads the just-inserted invitations row by token_hash) with its own spike case. (NOTE: R2 here claimed all
   5a-wired events had pre-batch data -- R3/F1 corrected that; suspend/reactivate use SQL-derived role.) See
   sections 1, 9.2, 9.3, 14.

B3 (attempts / crash convergence): attempts is incremented at CLAIM ONLY (single source). The failure path only
   READS attempts to decide retry-vs-DLQ (no second increment). A new MAX-ATTEMPT SWEEP collects crashed rows
   (status='processing' AND lease expired AND attempts>=MAX) into the DLQ so pure crashes provably converge.
   See sections 5.1, 7, 9.3, 12.

B4 (PII in logs): streamKey can contain an email (member.invited). Audit events / Discord alerts / run reports
   now emit a stream_key_hash (sha256) + eventType + seq + eventId, NEVER the raw streamKey. Raw streamKey stays
   only in DB columns (access-controlled). See sections 10, 11, 9.3.

Rulings applied (section 18): product_access.* deferred ENTIRELY to F-2 (no lone 'restored'); one migration 0051
   for all four tables; defaults 5min cron / 120s lease / 6 attempts accepted; REMOTE D1 sanity required in the
   spike before 5a code (not local/miniflare only); acceptInvitation emit gates on the JOIN mutation.

--------------------------------------------------------------------------------
## 0. Owner decisions (LOCKED 2026-06-02) -- do not relitigate in code
--------------------------------------------------------------------------------

D1. Consumer sink = LOCAL DENY-STATE PROJECTION (internal materialized state), NOT push, NOT pull-API,
    NOT an RP wire contract.
    - The consumer applies events into a chiyigo-owned `event_deny_state` projection table, idempotently and
      seq-ordered: CONTIGUOUS apply (streamSeq == last_applied_seq + 1 per streamKey; see 5.2 / B1), NOT gap-skip.
    - This proves the consumer / lease / retry / DLQ / replay / idempotency / ordering paths against a REAL,
      testable sink WITHOUT committing the RP delivery shape (push vs pull) ahead of the integration thaw.
    - GUARDRAIL (owner): the projection is an INTERNAL chiyigo artifact only. It is explicitly NOT the
      RP-facing deny-state contract. A future RP pull API MAY read from it, but that API's shape is a
      SEPARATE decision (RP-facing contract gap #4, still deferred). PR5 ships NO public/RP endpoint over it.

D2. Phased delivery 5a / 5b / 5c (each its own double-gate PR per feedback_codex_review_workflow):
    - 5a: schema (migration 0051) + per-streamKey seq allocator + transactional emit helper, wired into the
          FRESH PR4 member + invitation sites only. Gate-0 of 5a is a D1 batch/CAS/changes() SPIKE.
    - 5b: cron consumer (lease / retry / DLQ / crash recovery / replay) + `event_deny_state` projection sink
          + DLQ replay admin endpoint.
    - 5c: retro-wire the HOTTER Tier-0 security paths one surface at a time
          (ban -> account.disabled, unban -> account.reenabled, per-device/per-jti revoke -> session.revoked).
    - Rationale: PR5 simultaneously touches auth / session / billing / member hot paths. Splitting keeps every
      gate a small, reviewable, independently-rollback-able diff (feedback_security_boundary_pr_first_do_no_harm).
      The largest risk lives in 5a (seq allocator + CAS emission gate); if that is not proven, a beautiful
      consumer just delivers wrong events more reliably.

D3. SPIKE-FIRST (owner guardrail, mirrors the PR3 D1 batch-rollback spike).
    Before ANY 5a production code, a throwaway spike must PROVE the in-batch mechanism (section 4). The spike runs
    on local D1 (miniflare) AND a REMOTE D1 sanity pass (Codex R1 ruling) -- changes()/batch semantics must be
    confirmed on the real engine, not assumed from local only. If we cannot reliably gate seq-allocation +
    outbox-insert on "the business CAS actually applied", STOP and redesign -- do not advance to the consumer.
    (feedback_dont_assert_runtime_semantics_without_verify)

--------------------------------------------------------------------------------
## 1. Scope and non-goals
--------------------------------------------------------------------------------

IN SCOPE (the PR5 program, across 5a/5b/5c):
- migration 0051: `event_outbox`, `event_stream_sequences`, `event_dlq`, `event_deny_state` (+ down).
- Transactional emission: business mutation + seq allocation + outbox insert in ONE atomic D1 batch,
  with the emit GATED on the mutation's CAS actually applying (no event on a 0-row no-op).
- Per-streamKey strictly-monotonic streamSeq allocation (the field PR4's contract requires the emitter to assign).
- eventId (UUID) + occurredAt assignment at emission (the other two emitter-assigned envelope fields).
- Reuse of domain-events.ts: deriveStreamKey / buildDomainEvent / validateDomainEvent / canonicalEventJson /
  DENY_EFFECT. NO re-invention of taxonomy, envelope, payload shape, or ordering rule.
- Cron consumer: claim/lease, bounded retry with backoff, DLQ after N attempts, crash recovery via lease
  expiry, at-least-once delivery, idempotent + seq-ordered projection apply, replay SOP + admin replay endpoint.
- Observability: new audit events + a structured run report + depth/lag signals.
- Tests at every layer (emission atomicity, no-emit-on-noop, seq monotonicity under concurrency, claim
  no-double-process, retry->DLQ, crash recovery, idempotent re-delivery, per-streamKey contiguity + gap-refusal,
  replay).

NON-GOALS (explicit, to bound the blast radius):
- NO push to RP endpoints (no RP URLs; SSRF surface; would prematurely fix the wire shape). [D1]
- NO RP-facing / public pull API over the projection. [D1 guardrail]
- NO CF Queues / Durable Objects (paid). [environment constraint]
- NO whole-user logout-all event (that is a token epoch / revokedBefore cutoff, a FUTURE PR; session.revoked
  is BOUNDED to device|jti per the frozen contract).
- NO product_access.* emission at all in PR5 (Codex R1 ruling: defer ENTIRELY to F-2). PR2 is Option B
  (manual grant, NO revoke endpoint) so there is no deny SOURCE; a lone 'restored' with no matching 'revoked'
  adds a hot-path touch for no deny-state value. The contract types stay reserved; both are wired together when
  the F-2 revoke mutation site exists.
- member.invited is NOT wired in 5a (deferred to 5b; see B2). It is wired in 5b via a SQL-derived payload path.
- NO hash-chain over the outbox (correctness is the atomic batch + UNIQUE constraints; chaining is future
  hardening, additive later -- same disposition as PR3 ledger hash-chain).

--------------------------------------------------------------------------------
## 2. Contract reuse -- what PR5 supplies on top of the frozen envelope
--------------------------------------------------------------------------------

domain-events.ts (FROZEN) already provides, per eventType: required/optional data keys, value enums, the
streamKey deriver, the envelope validator, the stable canonical JSON serializer, and DENY_EFFECT. The envelope
fields it documents as EMITTER-ASSIGNED (i.e. PR5's job, currently unfilled) are exactly three:

- eventId    : unique delivery-layer dedup key. PR5 = crypto.randomUUID() at emission (app code, a bind param).
- streamSeq  : positive int, strictly monotonic PER streamKey, the ORDERING AUTHORITY. PR5 = allocated IN-BATCH
               from `event_stream_sequences` (section 4). This is the hard part.
- occurredAt : ISO-8601 UTC, human/audit + tie-break ONLY (never the ordering authority). PR5 = new Date().
               toISOString() at emission (app code, a bind param).

streamKey is DERIVED (never supplied) via deriveStreamKey(eventType, tenantId, data) -- PR5 binds the derived
value into the row and the DB UNIQUE(stream_key, stream_seq) enforces ordering integrity.

EXPAND rule (already in the contract): new eventType / new OPTIONAL data key is additive (no version bump);
unknown data keys tolerated; removing/retyping a required key or changing an enum is BREAKING. PR5 adds NO new
types and NO breaking change -- EVENT_SCHEMA_VERSION stays 1.

--------------------------------------------------------------------------------
## 3. Why store structured columns, not pre-baked canonical JSON
--------------------------------------------------------------------------------

The original section-5 ERD (pre-PR4) sketched outbox as `payload` + `payload_hash` (a pre-baked blob). That
predates PR4's ordering fields. Because streamSeq is allocated IN-BATCH (it does not exist before the batch
runs), we CANNOT canonical-serialize the event before insert. Therefore:

- event_outbox stores the envelope as STRUCTURED COLUMNS (event_type, stream_key, stream_seq, tenant_id,
  actor_sub, occurred_at, data_json) + delivery bookkeeping.
- At delivery the consumer reconstructs the DomainEvent from the stored columns + allocated seq via the FROZEN
  buildDomainEvent (which re-derives streamKey AND re-validates -- it throws on a corrupt row -> poison -> DLQ;
  defense in depth: the same invariant guarded at the write boundary AND the delivery boundary,
  feedback_two_gate_defense_in_depth).
- The INTERNAL projection sink only needs the validated fields (eventType / streamKey / streamSeq / tenantId), so
  canonicalEventJson is NOT run per-delivery here -- it is reserved for a FUTURE EXTERNAL wire sink (single
  derivation path, no second serializer to drift).

No stored payload_hash column in v1 (it would have to be a second, drift-prone copy of derivable data). If a
future external sink needs a stored integrity hash, it is an additive ALTER. Flagged in section 16.

--------------------------------------------------------------------------------
## 4. CORE CORRECTNESS: in-batch seq allocation + CAS-gated emit (the 5a spike)
--------------------------------------------------------------------------------

The outbox invariant: a committed business mutation NEVER lacks its event, and an un-applied (0-row CAS) mutation
NEVER produces an event. That requires mutation + seq-bump + outbox-insert to be ONE atomic D1 batch, with the
two emit statements GATED on the mutation having changed a row.

Proposed mechanism (PRIMARY) -- a 3-statement batch, gated by changes():

  S1 (business mutation, CAS):
      UPDATE organization_members SET status='suspended', updated_at=datetime('now')
       WHERE <existing PR4 CAS predicate>            -- changes() == 1 iff THIS request applied it

  S2 (seq allocation, gated on S1):
      INSERT INTO event_stream_sequences (stream_key, last_seq, updated_at)
      SELECT ?, 1, datetime('now') WHERE changes() = 1
      ON CONFLICT(stream_key) DO UPDATE SET last_seq = last_seq + 1, updated_at = datetime('now')
      -- if S1 changed 0 rows, the SELECT yields 0 rows, nothing is inserted/updated, changes() becomes 0.
      -- if S1 changed 1 row, allocate: first time -> last_seq=1; subsequently -> last_seq+1.

  S3 (outbox insert, gated on S2, reads the freshly allocated seq):
      INSERT INTO event_outbox
        (event_id, event_type, stream_key, stream_seq, tenant_id, actor_sub, occurred_at, data_json,
         status, attempts, next_attempt_at, created_at)
      SELECT ?, ?, ?, (SELECT last_seq FROM event_stream_sequences WHERE stream_key = ?),
             ?, ?, ?, ?, 'pending', 0, datetime('now'), datetime('now')
      WHERE changes() = 1
      -- changes() here reflects S2 (the immediately prior write). 1 iff seq was allocated -> emit; else skip.

  All three in db.batch([S1,S2,S3]) -> atomic: any statement error rolls back ALL (incl. the mutation), and the
  no-event-on-noop property is structural (the WHERE changes()=1 chain), not a post-hoc app check.

Three runtime semantics this RELIES ON, which the SPIKE must prove on real D1 (miniflare/local + a remote sanity
check), because D1 docs do not guarantee them and we will not assert them blind:

  (a) changes() PERSISTS and CHAINS across statements within a single db.batch() (one connection, one txn).
  (b) `INSERT ... SELECT ... WHERE changes() = 1` evaluates changes() against the PRIOR completed statement,
      and an upsert (ON CONFLICT DO UPDATE) counts as 1 change for the NEXT statement's changes().
  (c) the subquery `(SELECT last_seq FROM event_stream_sequences WHERE stream_key=?)` in S3 reads the value
      S2 just wrote (read-your-writes within the batch txn).

Spike matrix (throwaway, deleted before commit; PR-body records the receipts):
  - applied mutation -> exactly one outbox row, stream_seq == allocated, monotonic.
  - 0-row CAS (no-op) -> NO seq bump, NO outbox row, NO orphan.
  - two concurrent applied mutations on the SAME streamKey -> two rows, DISTINCT strictly-increasing seqs (no
    gap: seq is bumped ONLY on emit, so per-streamKey seqs are contiguous 1,2,3...), and seq order == D1
    commit/serialization order (D1 single-writer serializes the batches). [contiguity is what B1 relies on]
  - forced error in S3 -> whole batch rolls back: mutation NOT applied, no seq bump, no row.
  - cold streamKey first event -> seq == 1.
  - SQL-derived payload read-your-writes (5a, F1): in [suspend CAS, seqUpsert, outboxInsert], outboxInsert's
    json_object subquery (SELECT platform_role ... AFTER the suspend) reads the POST-mutation COMMITTED role in
    the same batch -> data_json.previousRole == the row's actual role. Verify it is correct even when a concurrent
    role change committed between this request's pre-read and its CAS (the whole point of F1).
  - role_changed CAS pin (5a, F1): with `AND platform_role = ?fromRole` added, a concurrent change to a 3rd role
    makes the CAS 0-row -> NO emit, NO wrong fromRole; a still-fromRole row emits fromRole correctly.
  - REMOTE D1 sanity (Codex R1 ruling, REQUIRED before 5a code): re-run applied / no-op / rollback / SQL-derived
    cases on a real remote D1, not just local miniflare -- changes()/batch/json_object read-your-writes confirmed
    on the real engine. (member.invited's invitationId read-your-writes is the same mechanism, exercised in 5b.)

FALLBACK (only if the spike disproves (a)-(c)) -- explicitly worse, documented so codex sees the tradeoff:
  Do the mutation in its own batch, read upd.meta.changes in app code; if applied, run a SECOND batch
  [seqUpsert, outboxInsert]. This LOSES strict mutation+event atomicity (a crash between the two batches leaves a
  committed mutation with no event), so it REQUIRES a reconciliation sweep (a cron that detects "mutation without
  a corresponding outbox row" and back-fills/alarms). We do NOT prefer this; if the spike fails we bring the
  result back to owner/codex before proceeding (D3). SQLite has no DML-in-CTE (no Postgres-style
  `WITH x AS (UPDATE ... RETURNING) INSERT ... SELECT FROM x`), so that cleaner fallback is unavailable on D1.

--------------------------------------------------------------------------------
## 5. State machines (high-risk addendum: state flow)
--------------------------------------------------------------------------------

5.1 event_outbox row lifecycle (attempts incremented at CLAIM ONLY -- B3 single source):

   (insert)
      |
      v
   pending --claim(attempts+=1, lease)--> processing --deliver ok--> done            [terminal]
      ^                          |
      |                          +--deliver fail, attempts<MAX --> pending (next_attempt_at = now + backoff)
      |                          |   (failure path only READS attempts; never increments -- B3)
      |                          +--deliver fail, attempts>=MAX--> dead  [terminal] (+ event_dlq, reason=max_attempts)
      |                          +--poison (validateDomainEvent fail)--> dead [terminal] (+ event_dlq, reason=validation_failed)
      |
      |  lease_until expires + attempts<MAX  -> re-claimable (crash recovery: attempts+=1 again on re-claim)
      |  lease_until expires + attempts>=MAX -> MAX-ATTEMPT SWEEP --> dead [terminal] (+ event_dlq, reason=max_attempts)
   replay: a 'dead' row's event_id can be reset to pending (attempts=0) by the admin replay endpoint (section 9).

   B3 pure-crash convergence proof: every re-claim increments attempts (lease expiry makes the stuck row eligible
   while attempts<MAX). Attempts climbs 1->...->MAX. The claim predicate requires attempts<MAX, so once a crash
   leaves the row at attempts==MAX it can no longer be re-claimed; the MAX-ATTEMPT SWEEP (status='processing' AND
   lease expired AND attempts>=MAX) collects it to the DLQ. Bounded, terminating.

   Transition rules (single-writer serialized; claim is a conditional UPDATE so two overlapping cron runs cannot
   both own a row -- see section 8). Claim is also gated on per-streamKey CONTIGUITY (B1): a row is only claimed
   when NO earlier-seq row on the same streamKey is still un-'done':
     pending    -> processing : claim (status='pending' AND next_attempt_at<=now) [or expired processing],
                                AND attempts<MAX, AND no earlier-seq same-streamKey row with status<>'done'
     processing -> done       : projection apply + mark-done in ONE atomic batch (9.3 STEP C); at-least-once via
                                idempotent re-delivery if the consumer crashed before that batch committed
     processing -> pending    : transient delivery failure with attempts<MAX (next_attempt_at = now + backoff)
     processing -> dead       : delivery fail at attempts>=MAX, OR poison, OR max-attempt sweep, OR gap_detected -- writes event_dlq
     dead       -> pending    : admin replay only

5.2 event_deny_state projection per streamKey (the sink, 5b) -- CONTIGUOUS apply (B1):

   Let prior = row.last_applied_seq for streamKey K, or 0 if no projection row exists yet.
   For each delivered event E on K:
     if E.stream_seq <= prior      -> IGNORE (duplicate / already applied / stale re-delivery). Idempotent no-op.
     if E.stream_seq >  prior + 1  -> GAP = INVARIANT VIOLATION (F3). Do NOT apply, do NOT mark 'done'. This is
                                      PROVABLY unreachable in correct operation: apply + mark-'done' commit in ONE
                                      atomic batch (9.3 STEP C), so a 'done' predecessor implies last_applied_seq
                                      >= its seq, and the claim SQL (9.3) only hands out a row whose earlier-seq
                                      peers are all 'done' -> E.stream_seq == prior+1. So a gap means the
                                      contiguity invariant ITSELF broke (claim bug / projection corruption /
                                      manual tampering). The pure apply rule RETURNS a 'gap' outcome; the CONSUMER
                                      (9.3 STEP C) then treats it LOUD + BOUNDED, never a silent retry: critical
                                      audit domain.event.gap_detected + atomic DLQ(reason='gap_detected') +
                                      status='dead'. It is then replayable after the root cause is fixed
                                      (feedback_two_gate_defense_in_depth: the assertion FIRES the alarm, it does
                                      not paper over the bug).
     if E.stream_seq == prior + 1  -> APPLY (the only path that mutates the projection + marks 'done'):
        last_applied_seq = E.stream_seq
        event_type       = E.eventType
        deny_effect      = DENY_EFFECT[E.eventType]
        denied           = (deny_effect=='deny') ? 1 : (deny_effect=='undeny') ? 0 : <prior denied, default 0>
        tenant_id        = E.tenantId
        updated_at       = now

   WHY contiguous (R1 B1): under the old `> last_applied_seq` gap-skip, a `soft`/`none` event arriving before its
   predecessor would advance last_applied_seq and PERMANENTLY skip a lower-seq `deny`. Example: member.suspended
   at seq 4 and member.role_changed (soft, denied unchanged) at seq 5 on the SAME sub-keyed streamKey -- if seq 5
   applied first under gap-skip, seq 4's deny would be dropped forever. Contiguous apply makes seq 5 un-appliable
   until seq 4 is applied; deny is never skipped. `soft`/`none` still ADVANCE the cursor (they are real stream
   points) but only IN ORDER. The materialized `denied` boolean is the future RP pull source of truth.

   Head-of-line tradeoff (accepted): a row stuck in retry/DLQ at seq N blocks delivery of seq N+1.. on the SAME
   streamKey until it is delivered or replayed. This is the CORRECT ordering behavior (you must not skip), it is
   alarmed (DLQ critical), and per-subject event rate is low (admin actions). Cross-streamKey is unaffected.

   Granularity note: `denied` is per-SUBJECT-streamKey, not per-user. One user spans multiple streamKeys (their
   account:<sub> stream + each tenant:<t>:member:<sub> stream + each session:<sub>:... stream). Composing "is
   user X effectively denied in tenant T" (account.disabled denies globally; member.suspended denies that tenant)
   is a QUERY-TIME concern of the FUTURE RP read API, out of PR5 scope. PR5 only maintains the per-streamKey rows.

--------------------------------------------------------------------------------
## 6. Event flow (high-risk addendum: event flow)
--------------------------------------------------------------------------------

   business endpoint (e.g. POST /api/tenants/:id/members/:uid/suspend)
     -> domain fn (suspendMember) builds [S1 mutation, S2 seqUpsert, S3 outboxInsert] and db.batch() them
        (eventId=randomUUID, occurredAt=now, streamKey=deriveStreamKey, data validated via buildDomainEvent shape)
     -> event_outbox row: status=pending
   ... (decoupled in time) ...
   cron POST /api/admin/cron/event-outbox (Bearer CRON_SECRET; GitHub Actions schedule)
     -> claim up to N eligible rows (lease)
     -> per row: reconstruct DomainEvent from columns + seq; validateDomainEvent (defense in depth)
        -> apply to event_deny_state + mark status=done in ONE atomic batch (9.3 STEP C); idempotent, seq-ordered
           (at-least-once: a crash before that batch leaves the row claimable -> redelivered, idempotent)
     -> on failure: backoff/retry or DLQ
     -> emit run report + per-row audit events

Dedup (at-least-once): for THIS internal projection sink, dedup is the per-streamKey CONTIGUOUS seq cursor (5.2)
-- a re-delivered seq <= last_applied_seq is a no-op -- which is STRONGER than an eventId set (it also enforces
order). eventId stays the stable UNIQUE id (a FUTURE external sink can keep its own eventId dedup set).
correlationId/traceId: the consumer run carries a run_id (correlation); each event carries its own eventId.
(Observability triad per baseline: traceId / correlationId / eventId.)

--------------------------------------------------------------------------------
## 7. Failure modes + recovery + retry + idempotency + consistency
--------------------------------------------------------------------------------

(high-risk addendum: failure / recovery / retry / idempotency / consistency)

- Emit-time DB error  -> whole batch rolls back: mutation NOT applied, no event. Endpoint returns 5xx. No partial.
- Consumer crash mid-process -> 'processing' row's lease_until expires -> re-claimable while attempts<MAX (each
  re-claim increments attempts -- B3 single source). Once attempts==MAX the MAX-ATTEMPT SWEEP moves it to DLQ.
  Provably bounded + terminating (proof in 5.1). No stuck-forever row.
- Cron overlap (two runs) -> claim UPDATE is serialized + conditional; a row claimed by run A (status=processing,
  future lease) is invisible to run B's eligibility predicate. No double-processing.
- Transient delivery failure -> set status='pending', next_attempt_at = now + backoff(attempts), last_error.
  attempts is NOT incremented here (it was incremented at claim -- B3); the failure path only READS attempts to
  pick retry-vs-DLQ. Backoff schedule bounded + env-tunable for tests (audit-archive's backoff-CSV pattern).
- Poison event (validateDomainEvent fails on reconstruct) -> DLQ immediately, reason='validation_failed'
  (do NOT retry structurally-bad data; feedback_dlq_strict_vs_swallow: credential/correctness path = strict).
  HEAD-OF-LINE caveat (flagged honestly): a DLQ'd / stuck event BLOCKS later seqs on its streamKey (ordering
  integrity -- you must not skip). Since EMISSION validates via buildDomainEvent, a poison row should be
  unreachable (only D1 corruption or a breaking contract change could produce one). If one ever occurs, recovery
  is a MANUAL admin quarantine that deliberately advances the projection past the bad seq -- out of PR5 default
  scope, but alarmed via the critical DLQ audit so it cannot rot silently. A correctness-path deny is never
  silently dropped; worst case it is delayed until an operator acts.
- Permanent failure (delivery fail at attempts>=MAX, or the sweep) -> event_dlq row + outbox status='dead' +
  critical audit + alarm. reason distinguishes max_attempts vs validation_failed.
- Idempotency: CONTIGUOUS projection apply (5.2) -- seq <= prior is a no-op, seq == prior+1 applies, seq > prior+1
  is held (never skipped). Re-delivery / duplicate eventId / out-of-order are all safe. At-least-once + idempotent
  consumer (never exactly-once).
- Ordering: NOT globally ordered. Per streamKey, streamSeq is the authority and delivery is CONTIGUOUS (claim
  refuses a row while an earlier-seq same-streamKey row is not 'done'; projection refuses a gap). Cross-streamKey
  order is not assumed (matches the contract's documented ordering rule).
- Eventual consistency: the projection lags emission by at most the cron interval + retry backoff
  (= revocation propagation lag, a monitored signal). chiyigo's OWN hot-revoke enforcement does NOT depend on
  this projection -- requireActiveTenantRole already does a LIVE DB role re-check (PR4). The projection is the
  future RP read source, not chiyigo's own gate. So a lagging projection is not a chiyigo security hole.

--------------------------------------------------------------------------------
## 8. Schema -- migration 0051 (high-risk addendum: schema)
--------------------------------------------------------------------------------

Discipline: expand-only (new tables, no ALTER of existing). Fully idempotent (IF NOT EXISTS). up + down.
CRITICAL runner caveat (0050 lesson): the migration + resetDb runners split on RAW semicolons -> NO comment in
the .sql may contain a ';'. APPEND-ONLY enforced at the APP layer (house style; repo uses NO DB triggers).

  event_stream_sequences   -- per-streamKey allocator; last_seq = the most-recently-ALLOCATED seq for the key
    stream_key  TEXT PRIMARY KEY
    last_seq    INTEGER NOT NULL  CHECK(last_seq >= 1)   -- always set by the upsert (1 on first emit); no dead default
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))

  event_outbox             -- the durable, transactional event log + delivery state
    id              INTEGER PRIMARY KEY AUTOINCREMENT
    event_id        TEXT    NOT NULL UNIQUE                 -- emitter UUID; delivery dedup key
    event_type      TEXT    NOT NULL  CHECK(event_type IN (<the 11 frozen types>))
    stream_key      TEXT    NOT NULL
    stream_seq      INTEGER NOT NULL  CHECK(stream_seq > 0)
    tenant_id       INTEGER                                 -- null for account/session events
    actor_sub       TEXT                                    -- null if system-driven
    occurred_at     TEXT    NOT NULL
    data_json       TEXT    NOT NULL                        -- the per-type `data` object as JSON
    status          TEXT    NOT NULL DEFAULT 'pending'
                            CHECK(status IN ('pending','processing','done','dead'))
    attempts        INTEGER NOT NULL DEFAULT 0  CHECK(attempts >= 0)
    next_attempt_at TEXT    NOT NULL DEFAULT (datetime('now'))
    lease_until     TEXT
    locked_by       TEXT
    last_error      TEXT
    processed_at    TEXT
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    UNIQUE(stream_key, stream_seq)                          -- ordering integrity: one event per (key,seq)
    indexes: (status, next_attempt_at)  [claim];  (lease_until) WHERE status='processing' [recovery];
             (stream_key, stream_seq)   [projection / forensic]

  event_dlq                -- dead letters (actionable; admin replay)
    id           INTEGER PRIMARY KEY AUTOINCREMENT
    event_id     TEXT    NOT NULL
    event_type   TEXT    NOT NULL
    stream_key   TEXT    NOT NULL
    stream_seq   INTEGER NOT NULL
    tenant_id    INTEGER
    actor_sub    TEXT
    occurred_at  TEXT    NOT NULL
    data_json    TEXT    NOT NULL
    dlq_reason   TEXT    NOT NULL                           -- 'max_attempts' | 'validation_failed' | 'gap_detected'
    attempts     INTEGER NOT NULL
    last_error   TEXT
    failed_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    replayed_at  TEXT
    replayed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL
    index: (failed_at DESC) WHERE replayed_at IS NULL

  event_deny_state         -- INTERNAL projection sink (5b). NOT an RP contract (D1 guardrail).
    stream_key       TEXT PRIMARY KEY
    event_type       TEXT    NOT NULL
    deny_effect      TEXT    NOT NULL  CHECK(deny_effect IN ('deny','undeny','soft','none'))
    denied           INTEGER NOT NULL  CHECK(denied IN (0,1))
    tenant_id        INTEGER
    last_applied_seq INTEGER NOT NULL  CHECK(last_applied_seq > 0)
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
    index: (tenant_id)

down 0051: DROP the four tables. SAFE ONLY while they hold no real rows; once real events exist, a rollback is
forward-fix (destructive-migration ban) -- same discipline noted for PR3 0049 ledger tables.

Migration: ONE migration 0051 for all four tables (Codex R1 ruling 18.2). 5a uses outbox + sequences
immediately; dlq + deny_state are created in 0051 too but only EXERCISED in 5b -- one expand migration avoids a
second schema touch and keeps migration-before-deploy a single step. Unused-until-5b tables are harmless.

--------------------------------------------------------------------------------
## 9. Modules + API contracts (high-risk addendum: code surface)
--------------------------------------------------------------------------------

9.1 Emission helper -- functions/utils/domain-event-emit.ts (DOMAIN layer, framework-agnostic; 5a)
    - Imports domain-events.ts (frozen). Per-eventType statement builders: given (eventType, envelope inputs,
      {eventId, occurredAt}) each RETURNS the two D1 prepared statements [seqUpsert, outboxInsert] to splice into
      the CALLER's batch IMMEDIATELY AFTER the GATING mutation. The streamKey is derived via deriveStreamKey; the
      shape is validated pre-batch via buildDomainEvent with a sentinel seq (throws on bad BOUND input; the
      consumer re-validates the fully-concrete event at delivery -- defense in depth for SQL-derived fields).
    - data_json is built IN-SQL via json_object(...), because some data fields must be AUTHORITATIVE, not a stale
      app pre-read (F1):
        * BOUND fields (?) -- values fully known + immutable pre-batch (sub, toRole, reason, an immutable invite
          role, member.invited email/platformRole).
        * SQL-DERIVED fields -- read in-batch so they reflect the committed state, never a stale pre-read:
            suspend.previousRole / reactivate.platformRole = (SELECT platform_role FROM organization_members
            WHERE tenant_id=? AND user_id=?) evaluated in S3 AFTER the mutation (the mutation does not change the
            role, so this is the true role under any concurrency). member.invited.invitationId = (SELECT id FROM
            invitations WHERE token_hash=?) (read-your-writes of the just-inserted row, 5b).
        * CAS-PINNED fields -- role_changed.fromRole is bound AND pinned in the mutation CAS (`= ?fromRole`), so
          the emit (gated on that CAS) only fires when the role was fromRole -> the bound value is authoritative.
    - eventId + occurredAt are INJECTED by the caller (side-effects-through-adapter baseline + deterministic
      tests): prod callers pass crypto.randomUUID() / new Date().toISOString(); tests pass fixed values. The
      helper does NO I/O and NO time/random generation. streamSeq is filled by the in-batch seqUpsert subquery.
    - Contract with callers (documented + asserted in tests): the emit statements MUST sit directly after the
      gating statement -- the LAST business statement whose changes() means "this request applied it" (the bare
      CAS for members.ts; the JOIN insert for acceptInvitation, ruling 18.6). No other write may intervene
      between the gating statement and seqUpsert (the changes() chain).

9.2 Wired emit sites -- 5a (FRESH PR4 surfaces; lowest traffic). Payload provenance is per-field (F1):
    functions/utils/members.ts
      suspendMember      -> member.suspended   data {sub(bound), previousRole(SQL-DERIVED post-suspend), reason?(bound)}
                            [gate on the suspend CAS; previousRole read from the row AFTER suspend -- authoritative]
      reactivateMember   -> member.reactivated data {sub(bound), platformRole(SQL-DERIVED post-reactivate)}
                            [gate on the reactivate CAS; role read from the row AFTER reactivate -- authoritative]
      offboardMember     -> member.offboarded  data {sub(bound), reason?(bound)}   [gate on the offboard DELETE; no role -> safe]
      changeMemberRole   -> member.role_changed data {sub(bound), fromRole(CAS-PINNED), toRole(bound)}
                            [F1: add `AND platform_role = ?fromRole` to the CAS so fromRole is authoritative;
                             same-role still no_op; concurrent change to a 3rd role -> 0-row -> illegal_transition
                             (optimistic concurrency), never a wrong-fromRole emit]
      createOrgTenant    -> (no event; org.created is NOT in the frozen 11-type set -- do NOT invent one)
    functions/utils/invitations.ts
      acceptInvitation   -> member.joined      data {sub(bound), platformRole(bound: from the IMMUTABLE invite row)}
                            [only on 'joined', not replay; ruling 18.6: gate on the JOIN insert (membership
                            created = "this request joined"), NOT the consume CAS.
                            F2: REWRITE the catch -- on a batch error, re-read state; return a BUSINESS outcome
                            ONLY if it is positively proven (membership now exists -> already_member; invite
                            consumed by another sub -> already_resolved). Otherwise RETHROW (system failure /
                            5xx): an emission/seq/outbox failure rolled the batch back and must NOT be masked as a
                            business 200. (forced-outbox-failure test in 12.)]
      createInvitation   -> member.invited     -> DEFERRED to 5b: SQL-DERIVED invitationId (read-your-writes,
                            now a supported helper mode, 9.1) + email-keyed streamKey (tenant:T:member:<email>,
                            'none' effect, isolated from the sub-keyed member.*). Deferral is now a SCOPE choice
                            (bound the createInvitation wiring + email-stream surface), NOT a helper-capability gap.
    NOTE: 5a MODIFIES these domain fns minimally -- it extends each batch with [seqUpsert, outboxInsert] gated on
    the gating mutation, AND makes the two correctness fixes the emission exposes (F1 role_changed CAS pin;
    F2 accept catch rethrow). It does NOT change the proven outcome SEMANTICS of the happy/no-op/last-owner paths.
    The gating-statement choice + the SQL-derived role read-your-writes are spike cases before wiring.

9.3 Consumer -- functions/api/admin/cron/event-outbox.ts (5b)
    - Auth: Authorization: Bearer <CRON_SECRET> (mirror audit-archive cron; 500 if unset, 401 on mismatch).
    - Bindings: env.chiyigo_db. No R2/KV needed.
    - Defaults (Codex R1 ruling 18.3 accepted): LEASE=120s, MAX_ATTEMPTS=6, cron=every 5 min,
      backoff=[1m,5m,30m,2h,12h,24h]. All env-overridable: EVENT_OUTBOX_CLAIM_LIMIT (default 50),
      EVENT_OUTBOX_RETRY_BACKOFF_MS (CSV, for tests), EVENT_OUTBOX_MAX_ATTEMPTS, EVENT_OUTBOX_LEASE_SECONDS.
    - Run order: STEP A sweep, then STEP B claim, then STEP C deliver.

    STEP A -- MAX-ATTEMPT SWEEP (B3 crash convergence): for rows status='processing' AND lease_until<now AND
      attempts>=MAX -> move to DLQ. The DLQ transition is a SINGLE atomic db.batch([INSERT event_dlq(reason=
      'max_attempts'), UPDATE event_outbox SET status='dead']) so a crash can never leave a half-DLQ'd row (no
      orphan, no duplicate DLQ row) + critical audit. (Also any pending row whose attempts somehow reached MAX.)
      This is what guarantees crashed-at-claim rows terminate. (event_dlq has NO UNIQUE(event_id): replay -> later
      re-failure legitimately writes a NEW DLQ row for the new episode; the OLD row is marked replayed_at.)

    STEP B -- CLAIM (attempts incremented HERE only -- B3 single source; CONTIGUOUS per streamKey -- B1):
      run lock token = randomUUID.
      UPDATE event_outbox SET status='processing', locked_by=<token>,
             lease_until=datetime('now','+<LEASE> seconds'), attempts=attempts+1
      WHERE id IN (
        SELECT o.id FROM event_outbox o
        WHERE ((o.status='pending' AND o.next_attempt_at<=datetime('now'))
            OR (o.status='processing' AND o.lease_until<datetime('now')))
          AND o.attempts < <MAX>                                   -- never claim past MAX (sweep owns those)
          AND NOT EXISTS (SELECT 1 FROM event_outbox e             -- B1: earlier-seq same-streamKey must be done
                            WHERE e.stream_key = o.stream_key
                              AND e.stream_seq < o.stream_seq
                              AND e.status <> 'done')
        ORDER BY o.id ASC LIMIT ?);
      then SELECT * WHERE locked_by=<token> AND status='processing' ORDER BY stream_key, stream_seq.
      NOTE the NOT EXISTS yields AT MOST ONE claimable row per streamKey per run (the next contiguous seq), so a
      single run never needs to apply two events of the same streamKey -- no intra-run ordering hazard. (Per-
      streamKey throughput = 1 event / cron tick; acceptable, per-subject event rate is low. Index (stream_key,
      stream_seq) backs the NOT EXISTS.)

    STEP C -- DELIVER (per claimed row, processed in stream_key,stream_seq order). The apply rule (5.2) lives in
      a pure unit-testable module functions/utils/deny-state-projection.ts, not inline in the cron handler.
      reconstruct via buildDomainEvent (re-derives streamKey + re-validates); read prior=last_applied_seq for the
      streamKey (0 if none).
      - valid + seq==prior+1 -> SINGLE atomic db.batch([ event_deny_state upsert, CAS-guarded
                                ON CONFLICT(stream_key) DO UPDATE SET ... WHERE event_deny_state.last_applied_seq
                                = prior ; UPDATE event_outbox SET status='done', processed_at, lease cleared ]).
                                Projection + mark-done commit together (shrinks the crash window). The CAS guard is
                                belt-and-braces -- the lease already gives single-owner so prior cannot move.
      - valid + seq<=prior   -> idempotent no-op -> UPDATE status='done', clear lease (apply already happened).
      - valid + seq>prior+1  -> GAP = invariant violation (F3; unreachable in correct operation, see 5.2). Do NOT
                                apply, do NOT silent-retry. atomic db.batch([INSERT event_dlq(reason=
                                'gap_detected'), UPDATE status='dead']) + critical audit domain.event.gap_detected.
                                Loud + bounded + replayable; surfaces the broken contiguity invariant instead of
                                looping forever.
      - invalid (poison)     -> atomic db.batch([INSERT event_dlq(reason='validation_failed'), UPDATE status=
                                'dead']) + critical audit.
      - apply throws (transient): READ attempts -> attempts<MAX: status='pending', clear lease, next_attempt_at=
                                now+backoff(attempts), last_error; attempts>=MAX: atomic db.batch([INSERT event_dlq
                                (reason='max_attempts'), UPDATE status='dead']) + critical audit.

    - Report: structured run report (run_id, swept, claimed, delivered, retried, dlq, errors) as the HTTP body
      (mirror audit-archive cron). Report + per-row audit log a STREAM_KEY_HASH, never the raw streamKey (B4).
      status 200 if ok else 500.
    - Cron trigger: .github/workflows/cron-event-outbox.yml (every 5 min, per ruling 18.3).

9.4 DLQ replay -- functions/api/admin/event-dlq/[id]/replay.ts (5b)
    - AUTHZ (F4, tightened): NOT just "admin auth". Require an EXPLICIT fine scope `admin:events:replay` (under
      the existing scope hierarchy, same shape as PR3's admin:billing:wallet; admin/dev/super_admin inherit,
      others do NOT -- negative test) PLUS step-up (for_action='event_dlq_replay'). Rationale: event_dlq holds raw
      stream_key + data_json and a replay MUTATES the deny projection, so it is a privileged, audited action.
    - REDACTION (F4): the endpoint RESPONSE and the audit emit only stream_key_hash + eventId + dlq_reason --
      NEVER the raw stream_key or data_json (B4). The raw payload stays in the DB row for the consumer only.
    - Action: resets the outbox row by event_id to status='pending', attempts=0, next_attempt_at=now,
      last_error=null; stamps event_dlq.replayed_at/replayed_by; server-actor; per-user rate limited; audited.
    - Replaying a head-of-line blocker (a 'dead' seq N) automatically UNBLOCKS its streamKey: once N redelivers
      to 'done', the claim NOT EXISTS (9.3 STEP B) lets N+1.. flow again. No manual unblock needed.
    - Replay SOP documented in a runbook section (fix root cause -> replay -> watch delivery).

9.5 NO public/RP endpoint over event_deny_state in PR5 (D1 guardrail). Reads are tests + future RP API only.

--------------------------------------------------------------------------------
## 10. Security boundary (high-risk addendum + baseline)
--------------------------------------------------------------------------------

- Consumer is CRON_SECRET gated; DLQ replay needs the EXPLICIT fine scope admin:events:replay + step-up (F4),
  not blanket admin; deny-by-default; no anonymous access. Replay response/audit redact raw streamKey/data_json.
- No external egress (no push; no client-supplied URLs) -> no SSRF surface introduced.
- Emission carries actor_sub from the SERVER-resolved actor (never client input); tenant_id from the
  authenticated tenant context (PR1 claim), never from the request body.
- data_json holds only contract-validated fields (validateDomainEvent at write). PII REDACTION (B4): the raw
  streamKey can contain an email (member.invited = tenant:T:member:<email>), so audit events / Discord alerts /
  run reports emit a STREAM_KEY_HASH (sha256 hex) + eventType + streamSeq + eventId, and NEVER the raw streamKey
  or data_json. Raw streamKey lives ONLY in DB columns (event_outbox / event_dlq / event_deny_state), which are
  access-controlled and are the authorized forensic lookup path by eventId. This matches audit-archive's "no body
  in audit" discipline and prevents the audit_log (broadly readable + R2-archived) from becoming a PII sink.
- event_deny_state is tenant-scoped where applicable (tenant_id column + index); account/session rows are
  global by contract (tenant_id null). Any FUTURE RP read API MUST enforce tenant scope -- out of PR5 scope.
- Idempotency / replay defense: eventId UNIQUE + (stream_key, stream_seq) UNIQUE prevent duplicate / forged
  ordering rows; the projection's seq guard prevents replay from regressing state.

--------------------------------------------------------------------------------
## 11. Observability (high-risk addendum: observability)
--------------------------------------------------------------------------------

New audit events (added to audit-policy.ts REGISTRY with explicit it.each classification + _registrySize bump;
current registry size = 198 from PR4, verify at coding time). ALL data fields use streamKeyHash, never raw
streamKey or data_json (B4):
  emission (5a):   domain.event.emitted                 (info; data: eventType, streamKeyHash, streamSeq, eventId, tenantId)
  consumer (5b):   domain.event.delivered               (info; eventType, streamKeyHash, streamSeq, eventId)
                   domain.event.retry                   (warn; streamKeyHash, attempts, next_attempt_at, last_error)
                   domain.event.dlq                     (critical; streamKeyHash, dlq_reason, attempts)
                   domain.event.consumer_run            (info; run report summary -- counts only, no streamKeys)
                   domain.event.validation_failed       (critical; eventId, dlq_reason; NO streamKey/data)
                   domain.event.gap_detected            (critical; streamKeyHash, streamSeq, expected=prior+1; F3 invariant breach)
  (5b also wires member.invited emission, reusing domain.event.emitted. 5c reuses domain.event.emitted at the new
   security sites and adds NO new audit types.)
domain.event.emitted is a BEST-EFFORT post-commit safeUserAudit (swallow-on-failure) -- it is NOT inside the
emit batch (audit_log is its own hash-chain) so its loss never affects emission correctness; the outbox row is
the durable record. The consumer's domain.event.* audits are likewise observability, not the source of truth.
Metrics / signals: outbox pending depth, oldest pending age, DLQ depth, retry rate, and REVOCATION PROPAGATION
LAG (emit occurred_at -> projection updated_at), which section-14 of the architecture plan explicitly calls out.
Alerting: DLQ insert + validation_failed are critical -> existing Discord alert path.

--------------------------------------------------------------------------------
## 12. Test plan (baseline: critical-path integration + negative + idempotency + migration round-trip)
--------------------------------------------------------------------------------

5a (emission + seq; NO consumer yet):
  - emit-on-apply: a real suspend/reactivate/offboard/role_change/accept(joined) produces exactly ONE outbox row
    with the correct eventType, derived streamKey, seq. (member.invited NOT here -- deferred to 5b, B2.)
  - no-emit-on-noop: a 0-row CAS (same-role PATCH, double-suspend, already-resolved/replay accept) produces NO
    outbox row and NO seq bump. (regression-locks the EXACT failure mode: feedback_regression_test_must_lock_exact_failure)
  - atomicity: forced failure in the emit statements rolls back the mutation (both-or-neither).
  - seq contiguity + monotonicity: N concurrent applied mutations on one streamKey -> N rows, CONTIGUOUS
    strictly-increasing seqs 1..N (no gaps, since seq bumps only on emit), seq order == commit order; different
    streamKeys are independent. (this contiguity is what 5b's claim/projection rely on -- B1.)
  - F1 stale-role race (suspend/reactivate): a role change commits between this request's pre-read and its CAS;
    the emitted previousRole/platformRole == the ACTUAL (post-change) role from the SQL-derived subquery, NOT the
    stale pre-read. (regression-locks the EXACT failure mode.)
  - F1 role_changed CAS pin: concurrent change to a 3rd role -> CAS 0-row -> NO emit + illegal_transition (no
    wrong-fromRole row); same-role concurrent -> no_op + no emit; clean case -> fromRole emitted correctly.
  - F2 accept catch: a FORCED outbox-insert failure makes acceptInvitation RETHROW (5xx), NOT return
    already_member/already_resolved; a genuine concurrent membership (real UNIQUE) still returns already_member.
  - contract: every emitted row passes validateDomainEvent on reconstruct; streamKey == deriveStreamKey.
  - migration 0051 up+down round-trip.

5b (consumer + projection + member.invited wiring):
  - claim leases only eligible rows; two overlapping runs never both own a row (no double-deliver).
  - happy path: pending -> done; projection denied/undenied per DENY_EFFECT; last_applied_seq advances by 1.
  - CONTIGUITY (B1): while seq N on a streamKey is not 'done', seq N+1 is NOT claimed/delivered (head-of-line).
  - GAP DETECTION (B1 net + F3): force-deliver seq N+1 before seq N applied -> projection does NOT apply, the row
    goes to DLQ(reason='gap_detected') + critical audit domain.event.gap_detected (NOT a silent retry loop).
  - SOFT/NONE-BEFORE-DENY regression (B1 root cause): member.role_changed (soft, seq N+1) can NEVER apply or
    advance past a still-pending member.suspended (deny, seq N) -> the suspend is never skipped. (locks EXACT mode)
  - idempotent re-delivery: same eventId / seq <= last_applied_seq delivered again -> no state change.
  - attempts SINGLE SOURCE (B3): claim increments attempts exactly once; a transient delivery failure does NOT
    increment again (assert attempts after one failed delivery == 1, not 2).
  - transient failure (injected sink error) -> status=pending + backoff; eventual success -> done.
  - poison (corrupt data_json) -> DLQ reason=validation_failed, no infinite retry.
  - delivery fail at attempts>=MAX -> DLQ reason=max_attempts + status=dead + critical audit.
  - MAX-ATTEMPT CRASH SWEEP (B3 convergence): simulate repeated crash (claim then no completion, lease expiry) so
    attempts climbs to MAX; the next run's sweep moves the stuck 'processing' row to DLQ. Provably terminates.
  - crash recovery (transient): a 'processing' row with expired lease and attempts<MAX is re-claimed and completes.
  - replay: a dead/DLQ row reset -> pending -> delivered (and on a blocked streamKey, replaying seq N unblocks N+1).
  - F4 replay authz: admin WITHOUT admin:events:replay -> 403; finance/support roles -> 403; with scope but no
    step-up -> 401/STEP_UP_REQUIRED; with scope + step-up -> ok. Response + audit contain stream_key_hash only,
    asserted to carry NO raw stream_key / data_json.
  - member.invited SQL-derived path: createInvitation emits member.invited with invitationId read from the just-
    inserted row (read-your-writes); assert data_json.invitationId == the real id, and streamKey is email-keyed.

5c (retro-wire security paths):
  - ban -> account.disabled emitted atomically with the user-status mutation; unban -> account.reenabled.
  - per-device / per-jti revoke -> session.revoked with scope+ref; whole-user logout-all emits NOTHING (bounded).
  - each site: emit-on-apply, no-emit-on-noop, atomicity, projection deny/undeny effect.

Test infra: vitest workers pool + real local D1 (no DB mock), in-batch via real db.batch (the spike's mechanism
exercised for real). audit-policy registry test updated with the new events.

--------------------------------------------------------------------------------
## 13. Deploy / migration discipline
--------------------------------------------------------------------------------

- migration-before-deploy (merge == deploy; PR1 500 lesson): for EACH phase PR that lands 0051 (5a), run
  `wrangler d1 migrations apply chiyigo_db --remote` and verify the new tables exist BEFORE merge. 5b/5c add NO
  new tables (0051 already applied), so they only ship code.
- credential-free prod smoke per phase (homepage 200; new cron/admin endpoints 401/403 without secret/step-up;
  no writes) -- positive smoke (real emission round-trip) follows the owner waiver pattern (PR2/PR3/PR4): the
  consumer + emission are exercised by the full local integration suite; positive prod smoke is deferred.
- Each phase = its own branch, double-gate (plan if non-trivial / code), squash-merge after codex Approve.

--------------------------------------------------------------------------------
## 14. Per-phase deliverables + commit plan
--------------------------------------------------------------------------------

5a (this Gate-1's primary coding target after approval + spike). Spike is pre-c1, on local AND remote D1,
    throwaway, never committed; receipts in the PR body (D3 / ruling 18.5):
  c1 migration 0051 (4 tables + down) + scaffold + this plan doc
  c2 functions/utils/domain-event-emit.ts (emit helper: bound + SQL-derived + CAS-pinned data fields, 9.1; F1)
  c3 wire members.ts emit into existing batches; suspend/reactivate use SQL-derived role; role_change adds the
     `AND platform_role = ?fromRole` CAS pin (F1); offboard pre-bound
  c4 wire invitations.ts ACCEPT only (member.joined, gated on the join) + REWRITE accept catch to rethrow on
     unexplained failure (F2) -- member.invited NOT wired here (scope)
  c5 audit-policy +1 (domain.event.emitted) + tests (emit-on-apply/no-emit-on-noop/atomicity/seq-contiguity/
     F1-stale-role-race/F1-role-pin/F2-accept-rethrow/migration)
  NOTE: after 5a ships, outbox rows accumulate as 'pending' (no consumer until 5b) -- durable + harmless. The
  pending-depth / oldest-pending-age alarms (section 11) are ENABLED only in 5b when the consumer exists, so a
  growing pending backlog between 5a-ship and 5b-ship pages no one (and is drained the moment 5b deploys).

5b: consumer cron (sweep+claim+deliver) + event_deny_state projection (contiguous apply) + DLQ replay endpoint
    (scope admin:events:replay + step-up + redaction, F4) + new scope wiring + cron workflow yml + member.invited
    SQL-derived emit path + audit-policy +6 (incl. domain.event.gap_detected) + consumer tests (contiguity/
    gap-detection/soft-before-deny/idempotency/attempts-single-source/crash-sweep/replay/F4-authz).
5c: ban->account.disabled, unban->account.reenabled, per-device|per-jti revoke->session.revoked wiring + tests,
    one Tier-0 surface per commit. (product_access.* NOT here -- deferred to F-2 per ruling.)

--------------------------------------------------------------------------------
## 15. Reused assets / patterns (do not reinvent)
--------------------------------------------------------------------------------

- domain-events.ts (FROZEN contract) -- the single SSOT for taxonomy/envelope/derivation/DENY_EFFECT.
- audit-archive cron (functions/api/admin/cron/audit-archive.ts) -- CRON_SECRET auth, claim/lease, env-tunable
  backoff, structured run report, safeUserAudit telemetry: the template for the consumer.
- payment_webhook_dlq + admin retry endpoint -- the template for event_dlq + replay endpoint.
- credit.ts / members.ts -- atomic db.batch + message-independent re-read classification (no SQL-string parsing).
- audit-policy it.each + _registrySize bump (feedback_audit_classification).

--------------------------------------------------------------------------------
## 16. Baseline conflicts / tech-debt surfaced (proactive)
--------------------------------------------------------------------------------

- The changes()-chain emit (section 4) is non-obvious; it gets a "WHY" comment block + the spike receipts in the
  PR body. If the spike disproves it, the fallback (section 4) carries a TECH-DEBT marker (reconciliation sweep)
  and goes back to owner/codex before coding (D3).
- product_access.* deferred ENTIRELY to F-2 (Codex R1 ruling): PR2 Option B has no deny source, so PR5 emits
  neither revoked nor restored. Contract types stay reserved; both wire together when F-2 adds the revoke site.
  Explicitly deferred, not silently skipped.
- PR5 emission SURFACES + FIXES two latent PR4 correctness gaps (proactive): (F1) the member transitions emitted
  a STALE pre-read role under a concurrent role change -- in PR4 this only mis-coloured the HTTP response, but as
  a deny-state EVENT consumed by RPs it is a contract-integrity bug; (F2) acceptInvitation's catch could mask a
  system error as a business outcome. Both are corrected in 5a (SQL-derived/CAS-pinned role; rethrow-on-unexplained).
  These are FIXES landed with the feature, not new debt; the regression tests lock them.
- member.invited deferred from 5a to 5b is now a pure SCOPE choice (bound the createInvitation + email-stream
  surface), NOT a helper-capability gap -- the 5a helper already does SQL-derived read-your-writes (for the
  suspend/reactivate role), so member.invited's invitationId subquery is the same mechanism, just landed in 5b.
- No stored payload_hash in v1 (section 3): if an external sink later needs it, it is an additive ALTER.
- event_outbox 'done' rows grow unbounded. Pruning 'done' rows is SAFE w.r.t. the contiguity claim -- a missing
  earlier row that was already 'done' simply stops blocking via the NOT EXISTS (correct: it WAS delivered). So a
  periodic purge of 'done' rows older than N days (piggyback the existing cleanup cron) is the intended long-term
  hygiene. The purge is OUT of 5a/5b critical scope -- flagged so growth is not silently unbounded. event_dlq +
  event_stream_sequences are NOT pruned (DLQ = forensic; sequences must keep advancing per streamKey forever).

--------------------------------------------------------------------------------
## 17. Architecture-plan alignment check (section 11 / 5 / 6 / 12 / 14 / 20)
--------------------------------------------------------------------------------

- section 11 outbox mechanics (claim/lease, retry+backoff, DLQ, crash recovery, processed-after-side-effect
  at-least-once, idempotent consumer, replay SOP) -- all covered.
- section 5 outbox/dlq columns -- covered + EXTENDED with event_stream_sequences (PR4 ordering) and the
  structured-columns choice (section 3) instead of the pre-baked payload blob; flagged for codex.
- section 6/12 deny-state -- PR5 builds chiyigo's INTERNAL projection; RP-side consumption stays step 6 / deferred.
- section 14 -- revocation propagation lag + outbox/DLQ depth signals added.
- section 20 step 5 (lease/retry/DLQ/replay) -- the consumer covers all four.

--------------------------------------------------------------------------------
## 18. Codex Gate-1 R1 rulings (RESOLVED -- folded into R2)
--------------------------------------------------------------------------------

18.1 product_access.* emission -> DEFER ENTIRELY to F-2. No lone 'restored'. (sections 1, 9.2, 16)
18.2 migration -> ONE migration 0051 for all four tables (after the schema/consumer semantics fixes). (section 8)
18.3 defaults -> 5 min cron / 120 s lease / 6 attempts / backoff [1m,5m,30m,2h,12h,24h] ACCEPTED for the internal
     projection. (section 9.3)
18.4 attempts -> CLAIM-time increment ACCEPTED, but it is now the SINGLE counting source + a max-attempt crash
     sweep guarantees convergence (B3). (sections 5.1, 7, 9.3, 12)
18.5 spike -> REMOTE D1 sanity REQUIRED before 5a code (not local/miniflare only). (D3, section 4)
18.6 acceptInvitation -> emit gates on the JOIN mutation (membership created), not the consume. (section 9.2)

R3 carries NO new open questions. R1 blockers (B1 contiguous projection, B2 member.invited defer, B3 single-source
attempts + crash sweep, B4 PII redaction) AND R2 findings (F1 authoritative role payload, F2 accept catch rethrow,
F3 gap = loud+bounded DLQ, F4 fine-scope replay) are all addressed in the cited sections; the two changelogs at
the top map each item to its sections. The directions Codex affirmed are unchanged: structured columns, one
migration 0051, product_access deferred, remote-D1 spike, local projection sink.

--- END PR5 GATE-1 PLAN (R3) ---
