# PR5 5d-2 — session.revoked EMISSION (spike-first) — Gate-1 Plan

- Created: 2026-06-03
- Status: Codex Gate-1 R1 REJECT (3 plan-level blockers) → R2 fixes applied 2026-06-03 (a single PK-pinned
  family-id CAS — `casByFamily`, §4 — closes B1/B2/B3 + the L4 inconsistency). Resubmitting. NOT yet coded. The
  SPIKE (section 2) runs FIRST after approval, BEFORE any emission code — if it does not prove out, STOP + report.
- Predecessor: PR5 5d-1 SHIPPED (PR #15 → main `819008c`). refresh_tokens.session_id is live + populated (7 logins
  write a fresh UUID, refresh.ts rotation preserves/heals; backfill = `legacy_<id>`). NO emission yet.
- Approved design SoT: docs/reviews/pr5d-session-revoked-plan-2026-06-03.md (Codex Gate-1 R2 APPROVED) — §6
  emitSessionRevoked, §7 Mechanism B + SP1-SP6, §7.1 N-overflow/chunk-K, §10 two-layer failure, §13 observability.
  This doc is the IMPLEMENTATION Gate-1 for 5d-2 (files / spike harness / wire shapes / tests / commits); it does
  NOT relitigate the approved design — it executes it.
- Workgrade: L3 + HIGH-RISK ADDENDUM (Distributed State / multi-writer deny-state on a Tier-0 revocation path).
- Constraints: $0 (Cloudflare free tier), no CF Queues / Durable Objects, Tier-0 baseline. CODE-ONLY (no migration:
  0051 has the session.revoked event_type, 0052 has session_id).

--------------------------------------------------------------------------------
## 0. OWNER LOCKS (must hold; non-negotiable for 5d-2)
--------------------------------------------------------------------------------

L1. **SPIKE FIRST, STOP-IF-FAIL.** SP1-SP6 (section 2) on local miniflare AND a throwaway remote D1 run BEFORE any
    emission wiring. If any of SP1-SP5 is disproven → STOP, report, fall back to SINGLE-FAMILY sites only
    (auth/logout.ts) + DEFER multi-family. Do NOT enter multi-family emission on unproven D1 semantics.
L2. **ref = `COALESCE(session_id, 'legacy_' || id)`** at every emission site — NEVER trust the column is non-NULL,
    NEVER use bare session_id. (Heals any residual migrate-gap NULL; delimiter-safe — the ref never contains `:`.)
L3. **chunk ceiling K** (from SP6) — a multi-family revoke is chunked into ≤K-family atomic batches; never emit an
    unbounded 3N-statement batch.
L4. **multi-family CAS triple (Mechanism B)** — decompose into per-family `[casByFamily(ref), seqUpsert(skᵢ),
    outboxInsert(skᵢ)]`, each gated on its OWN preceding CAS `changes()=1`. casByFamily (§4) is PK-pinned via a
    scalar subquery → single-row (changes ∈ {0,1}) + rotation-robust + keyed on the family id (NO device_uuid).
    Reuse the proven changes()=1 primitive; do NOT invent `changes()>=1`; do NOT CAS by row-id (rotation race, B1).
L5. **0-row no-leak** — a 0-row per-family CAS (already-revoked / lost race) bumps NO seq + writes NO outbox row AND
    does not poison the next family's gate. Proven by SP2; asserted in the endpoint concurrency test.
L6. Carryover non-negotiables: scope=`device` ONLY (no jti) · `refresh.ts` device_mismatch DEFERRED · whole-user
    `admin/revoke.ts mode=user` + ban token_version NEVER emit · reuse the FROZEN contract (no taxonomy/envelope
    reinvention) · consumer ZERO change · no new migration · no new audit type (registry stays 206).

--------------------------------------------------------------------------------
## 1. Pre-flight (verify before the spike)
--------------------------------------------------------------------------------

- 5d-1 live: confirm prod `event_outbox` has NO session.* rows yet (controlled start) and session_id is populated
  (already verified at 5d-1 ship: 12 rows backfilled `legacy_<id>`, new logins write UUIDs).
- The 3 wire sites are UNCHANGED by 5d-1 (5d-1 touched the login INSERTs + refresh.ts only). Re-read their CURRENT
  shape at code time (don't trust this doc): auth/logout.ts (revoke by token_hash RETURNING user_id),
  auth/devices/logout.ts (requireAuth self; revoke by (user_id, device_uuid|null) + a 404 anti-probe exists-check),
  admin/revoke.ts mode=device (requireRole admin; non-null device_uuid; P1-15 hash-chain audit precedes the revoke).

--------------------------------------------------------------------------------
## 2. THE SPIKE (SP1-SP6) — the gating opener (run FIRST, throwaway, $0)
--------------------------------------------------------------------------------

Mirror the 5a spike method: local miniflare (`db.batch()`, real workerd) + a throwaway REMOTE D1 (create
`chiyigo-spike-5d2` → run → drop; never touch prod chiyigo_db). Throwaway vitest + wrangler d1 execute --remote.
Proves the Mechanism-B multi-family batch semantics that section 4 depends on. Receipts attached to the 5d-2 PR.

- SP1 (core N-triple): `batch([casByFamily(A),seqA,obA, casByFamily(B),seqB,obB])` on two distinct unrevoked
  families → assert EXACTLY 2 outbox rows (skA seq1, skB seq1), both revoked. casByFamily = the PK-pinned subquery
  CAS (§4). Proves changes()=1 reflects each triple's OWN preceding CAS (casByFamily(B) RESETS changes() after obA).
  SUB-CASES: (i) ROTATION (B1) — rotate A's head (revoke old id, INSERT new id, session_id preserved) between
  enumerate + batch → casByFamily revokes the NEW head + emits. (ii) NULL-DEVICE (B2) — a `device_uuid IS NULL`
  family revokes + emits via family-id. (iii) 2-HEAD DEFENSE (B3) — seed 2 unrevoked rows with the SAME session_id
  → casByFamily revokes EXACTLY 1 (subquery LIMIT 1 + PK match) + emits 1, NEVER 2, NEVER revoke-without-emit.
- SP2 (0-row no-leak — L5): pre-revoke B, add a third family C → `batch([CAS(A),seqA,obA, CAS(B→0row),seqB,obB,
  CAS(C),seqC,obC])` → assert ONLY A + C emit; B's 0-row CAS yields no seq/outbox AND does not poison C.
- SP3 (per-family read-your-writes): obB's `(SELECT last_seq … WHERE stream_key=skB)` reads skB's freshly-allocated
  seq, not skA's. Assert per-stream seq correctness.
- SP4 (atomicity across families): force a UNIQUE(event_id) violation in B's outbox → WHOLE batch rolls back (A NOT
  revoked, zero outbox, zero seq bump). Both-or-neither across the chunk.
- SP5 (remote parity): re-run SP1-SP4 on the throwaway remote D1 (multi-stmt command = one batch txn) → identical.
- SP6 (chunk ceiling K — L3): find the largest db.batch (statement count AND bound-param count) the remote D1
  accepts → derive the safe per-batch family count K (3 statements + ~9 binds per family). Measurement, not
  assumption (feedback_dont_assert_runtime_semantics_without_verify).

DISPROOF PROTOCOL (L1): SP1-SP5 fail → STOP + report; ship SINGLE-FAMILY (auth/logout.ts) only + DEFER multi-family.
SP6 just SETS K (its failure is not a stop — it bounds the chunk size).

--------------------------------------------------------------------------------
## 3. emitSessionRevoked builder (functions/utils/domain-event-emit.ts)
--------------------------------------------------------------------------------

Mirrors emitAccountDisabled (BOUND data) — ref is supplied by the caller from its pre-read of the IMMUTABLE
session_id (so streamKey stays BOUND, no SQL-derived). scope fixed 'device' (jti deferred). Reuse seqUpsert +
outboxInsert verbatim.

  export interface SessionRevokedEmitInput { sub: string; ref: string; actorSub: string | null }
  emitSessionRevoked(db, input, meta):
    streamKey = deriveStreamKeyValidated('session.revoked', null, input.actorSub,
                  { sub: input.sub, scope: 'device', ref: input.ref }, meta)        // -> session:<sub>:device:<ref>
    statements = [ seqUpsert(db, streamKey),
                   outboxInsert(db, {eventId, eventType:'session.revoked', streamKey, tenantId:null,
                     actorSub:input.actorSub, occurredAt}, `json_object('sub',?,'scope','device','ref',?)`,
                     [input.sub, input.ref]) ]

The FROZEN validateDomainEvent enforces scope∈{device,jti}+ref non-empty+streamKey match; the 5b consumer
re-validates at delivery. DENY_EFFECT['session.revoked']='deny' → projection denied=1 (one-way; each session
streamKey sees a single deny at seq 1 → no head-of-line interleave).

--------------------------------------------------------------------------------
## 4. Wire sites + Mechanism B + chunking
--------------------------------------------------------------------------------

THE CANONICAL PER-FAMILY CAS (`casByFamily`) — one design closes all 3 Codex R1 blockers. Keyed on the STABLE,
globally-unique family id, PK-PINNED via a scalar subquery:

    casByFamily(userId, ref) =
      UPDATE refresh_tokens SET revoked_at = datetime('now')
       WHERE id = (SELECT id FROM refresh_tokens
                     WHERE user_id = ? AND COALESCE(session_id,'legacy_'||id) = ? AND revoked_at IS NULL
                     LIMIT 1)
         AND revoked_at IS NULL                                              -- binds: [userId, ref]

- B1 ROTATION-RACE (was the master §7 by-row-id CAS): the subquery RE-RESOLVES the current unrevoked head at
  execution time, so a concurrent refresh that rotated the head (revoke old id, INSERT new id with session_id
  PRESERVED) is still caught — casByFamily revokes the NEW head + emits. by-row-id (`WHERE id=100`) would 0-row and
  let the live new head SURVIVE the revoke. This applies to auth/logout.ts too (§4.1), not just device revoke.
- B2 NULL-DEVICE: casByFamily keys on (user_id, family-id) with NO device_uuid in the predicate — session_id is
  globally unique, so it identifies the family regardless of device. The device branch (device_uuid=? vs IS NULL)
  lives ONLY in the ENUMERATION (§4.2). A `device_uuid=?` inside the CAS would 0-row on web/NULL rows (B2 bug).
- B3 SINGLE-ROW / NEVER REVOKE-WITHOUT-EMIT: `WHERE id=(scalar subquery)` matches the PK → changes() ∈ {0,1};
  MULTI-ROW MUTATION IS IMPOSSIBLE. A hypothetical invariant-violating 2-unrevoked-head family → the subquery
  LIMIT 1 picks one → revokes EXACTLY 1 + emits 1 (never 2, never revoke-without-emit). emit stays gated on
  changes()=1 of that one row. (The prior plan's "accept changes()=2 → no emit" edge is REMOVED.)

ref = `COALESCE(session_id,'legacy_'||id)` (L2). For a NULL-session_id gap row, COALESCE='legacy_<id>' is unique to
that row's PK, so casByFamily still targets exactly it. All three wire sites (§4.1-4.3) use casByFamily verbatim.

### 4.1 auth/logout.ts — SINGLE-family (N=1; ships even if the spike kills multi)
- PRE-READ the LIVE row only (Codex B1): `SELECT user_id, COALESCE(session_id,'legacy_'||id) AS ref FROM
  refresh_tokens WHERE token_hash=? AND revoked_at IS NULL`. No live row (absent / already revoked) → idempotent
  200, NO emit (unchanged; no surprise family-logout for a stale token).
- Else `db.batch([ casByFamily(user_id, ref), ...emitSessionRevoked({sub:String(user_id), ref,
  actorSub:String(user_id)}).statements ])`; emit gated on casByFamily changes()=1.
- ROTATION-ROBUST (Codex B1): the OLD design CAS'd `WHERE token_hash=? AND revoked_at IS NULL`; if a concurrent
  refresh rotated the head between the pre-read and the batch, that 0-rows → logout 200 + NO emit + the live new
  head SURVIVES. casByFamily's subquery re-resolves the current head → revokes + emits it. Add a
  self-logout-vs-refresh-race spike/test (§2 SP1-i, §8).
- Post-commit best-effort auditDomainEventEmitted (redacted stream_key_hash).

### 4.2 auth/devices/logout.ts — MULTI-family (self; BOTH device_uuid=string AND device_uuid IS NULL/web)
- Keep the existing 404 anti-probe exists-check (unchanged).
- ENUMERATE heads — the device branch lives in the ENUMERATION, NOT the CAS (Codex B2): non-null →
  `… WHERE user_id=? AND device_uuid=? AND revoked_at IS NULL`; web/null → `… WHERE user_id=? AND device_uuid IS
  NULL AND revoked_at IS NULL`. SELECT `COALESCE(session_id,'legacy_'||id) AS ref` (one head per family; web
  families are distinguished ONLY by session_id, since device_uuid is NULL).
- CHUNK heads into ≤K (L3): per chunk `db.batch(heads.flatMap(h => [casByFamily(user_id, h.ref), ...emit(h.ref)]))`.
  casByFamily (§4) keys on (user_id, family-id) with NO device_uuid → the web/NULL path revokes + emits correctly
  (a `device_uuid=?` inside the CAS would 0-row on a NULL-device row — Codex B2). Post-commit audit per family CAS
  changes()=1.

### 4.3 admin/revoke.ts mode=device — MULTI-family (admin; NON-NULL device_uuid only — UNCHANGED contract)
- Same Mechanism-B chunked pattern as 4.2, but device_uuid is non-null (admin API not expanded to null — see master
  plan D6). actorSub = the admin sub. The P1-15 hash-chain audit STILL precedes the batch (unchanged).

(sub is server-resolved everywhere: self user_id / admin targetId / token row user_id. ref is server-side
immutable. Never client-supplied.)

--------------------------------------------------------------------------------
## 5. Failure model (two-layer — master §10) + chunk-failure contract
--------------------------------------------------------------------------------

- N ≤ K (single batch — the common case): any error → WHOLE batch rolls back → NO token revoked, NO event, 5xx.
  Both-or-neither (SP4). Couples revoke success to emit success (acceptable — no revoked-but-unemitted gap).
- N > K (chunked): WITHIN a chunk = atomic; ACROSS chunks = forward-progress. A chunk failure → earlier chunks are
  committed (revoked+emitted); the endpoint returns NON-2xx (code REVOKE_INCOMPLETE) with {revoked, emitted,
  remaining} (NEVER a misleading 2xx) + writes a DISTINCT partial-failure audit (warn/critical, on the endpoint's
  existing audit type — registry unchanged), and the client RETRY re-enumerates (excludes revoked rows) → converges
  with NO double-emit. (master §10 / §7.1.)
- Large-N THRESHOLD alarm (warn) is a SEPARATE signal (fires even on full success) — not a partial-failure signal.

--------------------------------------------------------------------------------
## 6. Idempotency + state machine
--------------------------------------------------------------------------------

- 0-row CAS (already-revoked / lost race) → no seq, no outbox (structural via WHERE changes() chain) — L5.
- Cross-endpoint concurrency (admin revoke device while user self-logs-out the same device): both enumerate
  overlapping heads → per-family CAS lets exactly ONE revoke each head (changes()=1), the other 0-rows → exactly one
  event per family.
- Re-login = a NEW session_id → a NEW streamKey → a fresh (absent) projection row → never inherits the old deny
  (the contract promise; locked by a test).
- DELIVERY side (5b, inherited): contiguous per-streamKey cursor; a re-delivered seq ≤ last_applied is a no-op.

--------------------------------------------------------------------------------
## 7. Observability
--------------------------------------------------------------------------------

- Reuse `domain.event.emitted` (TELEMETRY, registered) post-commit per applied family → emitted-count == revoked-
  family-count. NO new audit type (registry stays 206 — assert as a guard).
- 5b consumer's delivered/.retry/.dlq/.consumer_run already cover session events with no change.
- Partial-failure audit (section 5) distinct from the large-N threshold alarm.

--------------------------------------------------------------------------------
## 8. Test plan
--------------------------------------------------------------------------------

- BUILDER unit: emitSessionRevoked shape/streamKey (session:<sub>:device:<ref>, tenant NULL, data {sub,scope,ref});
  atomicity-at-the-builder-seam (dup event_id rolls back the stub+emit batch).
- single-family (auth/logout.ts): logout a live session → EXACTLY ONE session.revoked outbox row (ref = that
  session_id); already-revoked/absent → NO row, still 200. SELF-LOGOUT-vs-REFRESH-RACE (B1): rotate the head
  between the pre-read and the batch → casByFamily revokes the NEW head + emits ONCE (no stale-row miss).
- single-row defense (B3): seed 2 unrevoked rows sharing one session_id → a revoke mutates EXACTLY 1 + emits 1
  (never 2, never revoke-without-emit).
- multi-family (auth/devices/logout.ts): 2 logins on one device → revoke → EXACTLY 2 rows, distinct streamKeys, each
  seq 1; run BOTH device_uuid=string AND device_uuid IS NULL (web). admin mode=device: 2 logins (non-null) → 2 rows.
- 0-row no-leak / CONCURRENT double-revoke: each family emits EXACTLY once; outbox count == family count, each stream
  last_seq == 1, refresh_tokens finally all revoked.
- CHUNK-FAILURE + RETRY CONVERGENCE (N>K, force K small): 2nd chunk errors → 1st chunk revoked+emitted, endpoint
  NON-2xx REVOKE_INCOMPLETE + partial audit; retry finishes remainder → total emitted == family count (NO dup).
- whole-user NEGATIVE: admin mode=user + a ban → ZERO session.revoked rows.
- contiguity THROUGH the real 5b consumer: emit → run consumer → event_deny_state denied=1, last_applied_seq=1.
- re-login clean: revoke family (denied=1) → new session_id → its NEW streamKey has NO projection row.
- COALESCE ref: a NULL-session_id row → revoke → emitted ref == `legacy_<id>` (L2).
- post-commit audit redacted (stream_key_hash, never raw); registry size UNCHANGED (206).
- SPIKE receipts (SP1-SP6, local+remote) in the PR body.

--------------------------------------------------------------------------------
## 9. Deploy / migration discipline
--------------------------------------------------------------------------------

- CODE-ONLY (no migration). credential-free prod smoke: home 200; wired endpoints 401/403 without auth (no state
  change). Positive smoke (real revoke → outbox → consumer → deny projection) follows the owner-waiver pattern.
- Branch pr5d2-emission; double-gate (this plan → Codex; SPIKE receipts; then code → Codex); squash-merge after
  Approve; never push main.

--------------------------------------------------------------------------------
## 10. Commit plan
--------------------------------------------------------------------------------

  c1  this plan doc (Gate-1 checkpoint).
  --- after Gate-1 Approve: run SP1-SP6; if disproven STOP+report ---
  c2  emitSessionRevoked builder + builder unit tests + SP1-SP6 receipts in the PR body.
  c3  auth/logout.ts single-family wire + tests.
  c4  auth/devices/logout.ts + admin/revoke.ts mode=device multi-family wire + chunk-K + failure contract + tests.
  (one PR, squash-merged; no migration.)

--------------------------------------------------------------------------------
## 11. Open questions for Codex Gate-1
--------------------------------------------------------------------------------

Q1. [RESOLVED, Codex R1] REVOKE_INCOMPLETE on a chunk failure uses the STANDARD error envelope
    `{error:{code:'REVOKE_INCOMPLETE', message, traceId, data:{revoked,emitted,remaining}}}` — counts under
    error.data (not a bespoke body).
Q2. [RESOLVED, Codex R1] Coupling revoke success to emit success (N≤K single batch) is correct for a security path.
Q3. [RESOLVED, Codex R1] SP1-SP6 as c2 PR-body receipts (throwaway, uncommitted) accepted (5a precedent); the
    code-gate cross-checks the spike SQL + outputs.
Q4. [RESOLVED via §4 casByFamily] Per-family CAS = PK-pinned family-id subquery — closes B1 (rotation, incl.
    auth/logout.ts), B2 (NULL device), B3 (single-row → multi-row mutation impossible → NEVER revoke-without-emit;
    the prior "accept changes()=2" edge is REMOVED). No new open questions; submitting R2.

--- END PR5 5d-2 GATE-1 PLAN (R2 — Codex R1 B1/B2/B3 fixed via the §4 PK-pinned family-id CAS `casByFamily`) ---
