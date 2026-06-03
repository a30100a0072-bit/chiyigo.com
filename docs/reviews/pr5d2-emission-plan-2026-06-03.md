# PR5 5d-2 — session.revoked EMISSION (spike-first) — Gate-1 Plan

- Created: 2026-06-03
- Status: Codex Gate-1 R1→R2→R3→R4 (each REJECT, fixes applied) → R4 REJECT (the multi-family integrity count was
  device-FILTERED while casByFamily is device-LESS → a same-ref-across-two-devices duplicate could revoke the wrong
  head + emit) → R5 fixes applied 2026-06-03 (GLOBAL (user_id,ref) integrity count) → R5 ✅ APPROVED 2026-06-03.
  SPIKE SP1-SP7 ✅ PASS local + remote 2026-06-03 (no disproof; K=20 locked — §2 SPIKE RESULT). NOT yet coded —
  emission (c2-c5) is the next step.
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

L1. **SPIKE FIRST, TIERED STOP-IF-FAIL (Codex R2/R3).** SP1-SP7 (section 2) on local miniflare AND a throwaway remote
    D1 run BEFORE any emission wiring. Because auth/logout.ts ALSO uses casByFamily, the fallback is TIERED: (a) a
    SHARED-primitive failure — casByFamily semantics / N=1 single-triple gating / self-logout rotation sub-case /
    remote parity — → STOP ALL emission (single-family is NOT a safe fallback). (b) ONLY the multi-family-specific
    parts failing (cross-triple changes() chaining / chunk) WHILE (a) is fully proven local+remote → MAY ship
    auth/logout.ts (single-family) only + DEFER multi-family. Never enter emission on an unproven shared primitive.
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
    reinvention) · consumer ZERO change · no new migration. EXCEPTION (Codex R2): ONE new endpoint audit type
    `session.integrity_violation` (critical) for the fail-closed COUNT!=1 guard → audit-policy registry 206→207
    (code-only); no new domain.event.* type.

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
## 1.5 PREREQUISITE — refresh.ts rotation atomicity (Codex R3 Tier-0 blocker)
--------------------------------------------------------------------------------

casByFamily ALONE does NOT close the revoke-vs-refresh race, because refresh.ts rotation is TWO separate D1 writes
with a 0-LIVE-HEAD WINDOW between them: `UPDATE old SET revoked_at … RETURNING` (refresh.ts:184-189) THEN, after an
intervening audit, `INSERT new` (refresh.ts:220-224). Interleaving: a revoke's casByFamily that runs AFTER the
rotation's UPDATE committed but BEFORE its INSERT finds NO `revoked_at IS NULL` row → 0-row, NO emit; the rotation
then INSERTs the new live head → it SURVIVES. The exact old race, at a different boundary — and a partial UNIQUE
index would NOT fix it (the window is about TIMING, not uniqueness).

FIX (5d-2 prerequisite, code-only, NO migration): make the rotation ONE atomic db.batch so a concurrent reader
never sees a 0-live-head state:

    const b = await db.batch([
      db.prepare(`UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE id=? AND revoked_at IS NULL`).bind(oldId),
      db.prepare(`INSERT INTO refresh_tokens
                    (user_id, token_hash, device_uuid, expires_at, auth_time, scope, issued_aud, session_id)
                  SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`).bind(...newRowValues),   -- gated on the UPDATE
    ])
    if (b[0].meta.changes !== 1) return 401 REFRESH_TOKEN_REVOKED   -- reuse / lost race (gated INSERT added NOTHING)

- REUSE DETECTION PRESERVED: changes()=0 → the old head was already revoked (replay, or a logout/revoke won) → 401,
  and the gated INSERT inserted NO new head. changes()=1 → rotation succeeded.
- session_id PRESERVED + NULL-heal exactly as 5d-1; auth_time/scope/issued_aud/device_uuid move into the
  INSERT…SELECT binds. The aud_mismatch audit + token signing move to AFTER the batch (best-effort / pure).
- ATOMIC ⇒ a concurrent casByFamily sees a CONSISTENT snapshot: the OLD head (pre-batch) OR the NEW head
  (post-batch), NEVER 0. So a revoke either revokes+emits the old head (then the rotation reuse-aborts: its UPDATE
  0-rows, gated INSERT adds nothing) OR revokes+emits the new head. NO miss. Proven by SP7 (both interleavings).
- Strictly BETTER than today even ignoring emission: also removes the crash-between-window (old revoked + new
  lost). Touches refresh.ts (hot Tier-0 path) → its OWN commit, spike-proven, full refresh.test regression green.
- If this prerequisite is NOT done, 5d-2 emission is NOT safe and MUST NOT ship (Codex R3).

--------------------------------------------------------------------------------
## 2. THE SPIKE (SP1-SP7) — the gating opener (run FIRST, throwaway, $0)
--------------------------------------------------------------------------------

Mirror the 5a spike method: local miniflare (`db.batch()`, real workerd) + a throwaway REMOTE D1 (create
`chiyigo-spike-5d2` → run → drop; never touch prod chiyigo_db). Throwaway vitest + wrangler d1 execute --remote.
Proves the Mechanism-B multi-family batch semantics (§4) AND the rotation-atomicity prerequisite (§1.5). Receipts
attached to the 5d-2 PR.

- SP1 (core N-triple): `batch([casByFamily(A),seqA,obA, casByFamily(B),seqB,obB])` on two distinct unrevoked
  families → assert EXACTLY 2 outbox rows (skA seq1, skB seq1), both revoked. casByFamily = the PK-pinned subquery
  CAS (§4). Proves changes()=1 reflects each triple's OWN preceding CAS (casByFamily(B) RESETS changes() after obA).
  SUB-CASES: (i) ROTATION (B1) — rotate A's head (revoke old id, INSERT new id, session_id preserved) between
  enumerate + batch → casByFamily revokes the NEW head + emits. (ii) NULL-DEVICE (B2) — a `device_uuid IS NULL`
  family revokes + emits via family-id. (iii) 2-HEAD FAIL-CLOSED (B3) — seed 2 unrevoked rows with the SAME session_id
  → the GROUP BY ref COUNT preflight sees heads=2 → NO mutation, NO emit, critical audit + non-2xx (emit ⟺ the
  family is FULLY revoked; never a deny while a live head remains).
- SP2 (0-row no-leak — L5): pre-revoke B, add a third family C → `batch([CAS(A),seqA,obA, CAS(B→0row),seqB,obB,
  CAS(C),seqC,obC])` → assert ONLY A + C emit; B's 0-row CAS yields no seq/outbox AND does not poison C.
- SP3 (per-family read-your-writes): obB's `(SELECT last_seq … WHERE stream_key=skB)` reads skB's freshly-allocated
  seq, not skA's. Assert per-stream seq correctness.
- SP4 (atomicity across families): force a UNIQUE(event_id) violation in B's outbox → WHOLE batch rolls back (A NOT
  revoked, zero outbox, zero seq bump). Both-or-neither across the chunk.
- SP5 (remote parity): re-run SP1-SP4 on the throwaway remote D1 (multi-stmt command = one batch txn) → identical.
- SP6 (chunk ceiling K — L3) ✅ RESOLVED: K=20 LOCKED, proven LOCAL (one db.batch of 60 statements + ~240 bound
  params → 20 families each emit seq1, all revoked) AND REMOTE (a 60-statement one-txn batch on a throwaway D1 →
  20 outbox rows, all seq1). K=20 is generous vs the typical 1-3 families/device; N>20 chunks into ≤20-family batches.
- SP7 (rotation atomicity + revoke-vs-rotation NO-MISS — Codex R3 / §1.5): (a) the atomic rotation batch:
  changes()=1 → old revoked + new inserted (BOTH); changes()=0 → reuse → NEITHER (no new head). (b) REVOKE-BEFORE
  rotation: casByFamily revokes+emits the old head, THEN the rotation batch's UPDATE 0-rows → gated INSERT adds NO
  new head → 401 reuse. (c) ROTATION-BEFORE revoke: atomic rotation (one head) → casByFamily finds + revokes +
  emits the NEW head. (d) assert NO interleaving leaves "revoke 0-rows AND a new live head survives". local+remote.

DISPROOF PROTOCOL (L1, TIERED — Codex R2/R3): a SHARED-primitive failure (casByFamily semantics / N=1 gating /
self-logout rotation / rotation-atomicity + revoke-vs-rotation no-miss / remote parity = SP1 incl. sub-cases +
SP3 + SP4 + SP5 + SP7) → STOP ALL emission, report — NO single-family fallback (auth/logout.ts uses casByFamily AND
depends on the atomic rotation too). ONLY a multi-family-specific failure (cross-triple chaining / chunk) WITH the
shared primitive + rotation atomicity proven local+remote → MAY ship auth/logout.ts only. SP6 just SETS K (bounds
the chunk size, not a stop).

SPIKE RESULT (2026-06-03; throwaway, deleted, NOT committed — receipts for the 5d-2 PR body): ALL PASS, NO disproof.
- LOCAL (miniflare workerd D1): SP1 (2-family N-triple, both seq1 + revoked) · SP2 (pre-revoked family emits
  nothing, no neighbour poison) · SP3 (each outbox row carries its OWN ref + seq) · SP4 (dup event_id → whole-batch
  rollback, family A NOT revoked) · SP7a/b/c (atomic rotation both / reuse-neither; revoke-before-rotation = no
  survivor; rotation-before-revoke = no stale-id miss) · cross-device global-count fail-closed (heads=2 caught) ·
  SP6 K=20 (60 stmts / ~240 binds).
- REMOTE (throwaway chiyigo-spike-5d2, created→verified→deleted, $0, never touched prod chiyigo_db): SP1 parity
  (sA/sB seq1) · SP2 (sA+sC emit, sB silent) · SP4 (dup → FULL rollback: s4A_live=1, s4A_outbox=0, s4A_seq=0) ·
  SP7 (rotation live=1; reuse changes()=0 → live still 1) · SP6 (60-stmt one-txn → 20 rows, all seq1). IDENTICAL
  to local.
→ shared primitive + rotation atomicity PROVEN local + remote; disproof protocol NOT triggered → emission code
  (c2-c5) unblocked.

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
  SOUND ONLY because §1.5 makes rotation ATOMIC: without it, a revoke landing in the 0-live-head window BETWEEN the
  rotation's UPDATE-old and INSERT-new would STILL 0-row + miss the about-to-appear head (Codex R3 — the §1.5
  prerequisite, not casByFamily, closes that window).
- B2 NULL-DEVICE: casByFamily keys on (user_id, family-id) with NO device_uuid in the predicate — session_id is
  globally unique, so it identifies the family regardless of device. The device branch (device_uuid=? vs IS NULL)
  lives ONLY in the ENUMERATION (§4.2). A `device_uuid=?` inside the CAS would 0-row on web/NULL rows (B2 bug).
- B3 SINGLE-ROW + EMIT-IFF-FULLY-REVOKED (Codex R2): `WHERE id=(scalar subquery)` matches the PK → changes() ∈
  {0,1}; MULTI-ROW MUTATION IS IMPOSSIBLE. But a 2-LIVE-HEAD family must NOT be "revoke 1, emit 1, leave the other
  live" — that emits a deny while a live token of the family REMAINS (event ⊥ auth DB). So the EXACTLY-ONE-LIVE-HEAD
  invariant is FAIL-CLOSED: each site PREFLIGHTS the family's GLOBAL live-head COUNT on (user_id, ref) — DEVICE-LESS,
  matching casByFamily's (user_id, ref) keying (Codex R4). COUNT != 1 → NO emit, NO mutation, critical audit
  `session.integrity_violation`, non-2xx `SESSION_INTEGRITY_VIOLATION`, ABORT. We emit session.revoked ⟺ the family
  becomes FULLY revoked (its single live head is revoked). [The count is GLOBAL, NOT device-filtered — a
  device-filtered count would miss a same-ref-across-two-devices duplicate; the prior "revoke 1, emit 1" REMOVED.]
- DISTINCT-by-ref: the multi-family enumeration GROUPS BY ref, so a family is processed ONCE — never chunked twice
  (which would emit a duplicate seq-2 event) even if it momentarily had >1 row.

ref = `COALESCE(session_id,'legacy_'||id)` (L2). For a NULL-session_id gap row, COALESCE='legacy_<id>' is unique to
that row's PK, so casByFamily still targets exactly it. All three wire sites (§4.1-4.3) use casByFamily verbatim,
BEHIND the COUNT=1 preflight. (DB hardening — a partial UNIQUE index on session_id WHERE revoked_at IS NULL would
enforce the one-live-head invariant at the DB; it is a MIGRATION → flagged Q4, NOT in this code-only phase.)

### 4.1 auth/logout.ts — SINGLE-family (N=1; depends on casByFamily → see the tiered disproof protocol §2)
- PRE-READ the token's LIVE row (Codex B1): `SELECT user_id, COALESCE(session_id,'legacy_'||id) AS ref FROM
  refresh_tokens WHERE token_hash=? AND revoked_at IS NULL`. No live row (absent / already revoked) → idempotent
  200, NO emit (unchanged; no surprise family-logout for a stale token).
- INTEGRITY COUNT the family's live heads (Codex R2; already GLOBAL/device-less — logout has no device param, so it
  matches casByFamily): `SELECT COUNT(*) AS heads FROM refresh_tokens WHERE user_id=? AND
  COALESCE(session_id,'legacy_'||id)=? AND revoked_at IS NULL`. heads != 1 → critical audit
  `session.integrity_violation` + 5xx SESSION_INTEGRITY_VIOLATION + ABORT (no mutation, no emit).
- Else `db.batch([ casByFamily(user_id, ref), ...emitSessionRevoked({sub:String(user_id), ref,
  actorSub:String(user_id)}).statements ])`; emit gated on casByFamily changes()=1.
- ROTATION-ROBUST (Codex B1): the OLD design CAS'd `WHERE token_hash=? AND revoked_at IS NULL`; if a concurrent
  refresh rotated the head between the pre-read and the batch, that 0-rows → logout 200 + NO emit + the live new
  head SURVIVES. casByFamily's subquery re-resolves the current head → revokes + emits it. Add a
  self-logout-vs-refresh-race spike/test (§2 SP1-i, §8).
- Post-commit best-effort auditDomainEventEmitted (redacted stream_key_hash).

### 4.2 auth/devices/logout.ts — MULTI-family (self; BOTH device_uuid=string AND device_uuid IS NULL/web)
- Keep the existing 404 anti-probe exists-check (unchanged).
- ENUMERATE CANDIDATES (device-FILTERED → which families live on THIS device; the device branch lives ONLY here,
  Codex B2, NOT in the CAS): `SELECT DISTINCT COALESCE(session_id,'legacy_'||id) AS ref FROM refresh_tokens WHERE
  user_id=? AND <device> AND revoked_at IS NULL`, where `<device>` = `device_uuid=?` (non-null) or `device_uuid IS
  NULL` (web — families distinguished ONLY by session_id).
- GLOBAL INTEGRITY COUNT — DEVICE-LESS, matching casByFamily's (user_id, ref) keying (Codex R4): `SELECT
  COALESCE(session_id,'legacy_'||id) AS ref, COUNT(*) AS heads FROM refresh_tokens WHERE user_id=? AND
  COALESCE(session_id,'legacy_'||id) IN (SELECT value FROM json_each(?)) AND revoked_at IS NULL GROUP BY ref` (the
  candidate refs as a JSON array — reference_d1_query_budget_json_each). If ANY candidate ref has GLOBAL heads != 1
  → critical audit `session.integrity_violation` + 5xx SESSION_INTEGRITY_VIOLATION + ABORT (no mutation, no emit).
  [A DEVICE-filtered count would PASS a same-ref-on-two-devices duplicate, then casByFamily (device-less) could
  revoke the WRONG device's row + emit — event ⊥ auth DB; Codex R4.]
- Else CHUNK the validated refs into ≤K (L3): per chunk `db.batch(refs.flatMap(ref => [casByFamily(user_id, ref),
  ...emit(ref)]))`. GLOBAL heads==1 ⇒ casByFamily revokes exactly that one head (which IS the device candidate) +
  emits. Post-commit audit per family CAS changes()=1.

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
  committed (revoked+emitted); the endpoint returns NON-2xx in the STANDARD error envelope
  `{error:{code:'REVOKE_INCOMPLETE', message, traceId, data:{revoked, emitted, remaining}}}` (counts under
  error.data — Codex R1 Q1; NEVER a misleading 2xx) + a DISTINCT partial-failure audit (warn/critical), and the
  client RETRY re-enumerates (excludes revoked rows) → converges with NO double-emit. (master §10 / §7.1.)
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
  family-count. ONE new audit type `session.integrity_violation` (critical) for the fail-closed COUNT!=1 guard →
  audit-policy registry 206→207 (assert =207 as a guard); no new domain.event.* type.
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
- 2-HEAD FAIL-CLOSED (B3): seed 2 unrevoked rows sharing one session_id → revoke → NO mutation, NO emit, response
  5xx SESSION_INTEGRITY_VIOLATION + a critical `session.integrity_violation` audit (emit ⟺ family fully revoked).
- CROSS-DEVICE DUPLICATE (Codex R4): seed 2 live rows with the SAME ref on DIFFERENT device_uuids → revoke device A
  → the GLOBAL device-less count sees heads=2 → fail-closed (0 mutation, 0 outbox, 5xx + critical audit), even
  though device A's candidate enumeration alone showed 1.
- DISTINCT dedupe: a family that would be enumerated twice is processed ONCE (no duplicate seq-2 event).
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
- post-commit audit redacted (stream_key_hash, never raw); audit-policy registry == 207 (the one new
  session.integrity_violation type).
- SPIKE receipts (SP1-SP7, local+remote) in the PR body (incl. SP7 rotation atomicity + revoke-vs-rotation no-miss).

--------------------------------------------------------------------------------
## 9. Deploy / migration discipline
--------------------------------------------------------------------------------

- 5d-2 touches refresh.ts (the rotation-atomicity prerequisite §1.5/c2) IN ADDITION to the emit builder + 3 revoke
  sites — still CODE-ONLY (no migration), but the refresh.ts change is a Tier-0 HOT PATH needing its own careful
  code-gate + the FULL refresh.test regression green.
- credential-free prod smoke: home 200; wired endpoints 401/403 without auth (no state change); a refresh round-trip
  still 200 + rotates (the atomic rotation must not regress refresh). Positive revoke→outbox→consumer→deny smoke
  follows the owner-waiver pattern.
- Branch pr5d2-emission; double-gate (this plan → Codex; SPIKE receipts; then code → Codex); squash-merge after
  Approve; never push main.

--------------------------------------------------------------------------------
## 10. Commit plan
--------------------------------------------------------------------------------

  c1  this plan doc (Gate-1 checkpoint).
  --- after Gate-1 Approve: run SP1-SP7; if disproven STOP+report (TIERED, §2) ---
  c2  PREREQUISITE (§1.5): refresh.ts rotation → ONE atomic db.batch (UPDATE old + gated INSERT new; session_id +
      auth_time/scope/issued_aud/device_uuid preserved; reuse = changes()=0) + FULL refresh.test regression +
      SP7 receipts. [Tier-0 hot path — its OWN commit]
  c3  emitSessionRevoked builder + builder unit tests + SP1-SP6 receipts in the PR body.
  c4  auth/logout.ts single-family wire (incl. the COUNT=1 fail-closed preflight + the new
      `session.integrity_violation` audit type → registry 207) + tests.
  c5  auth/devices/logout.ts + admin/revoke.ts mode=device multi-family wire (DISTINCT enumeration + COUNT!=1
      fail-closed) + chunk-K + failure contract + tests.
  (one PR, squash-merged; no migration.)

--------------------------------------------------------------------------------
## 11. Open questions for Codex Gate-1
--------------------------------------------------------------------------------

Q1. [RESOLVED, Codex R1] REVOKE_INCOMPLETE on a chunk failure uses the STANDARD error envelope
    `{error:{code:'REVOKE_INCOMPLETE', message, traceId, data:{revoked,emitted,remaining}}}` — counts under
    error.data (not a bespoke body).
Q2. [RESOLVED, Codex R1] Coupling revoke success to emit success (N≤K single batch) is correct for a security path.
Q3. [RESOLVED, Codex R1] SP1-SP7 as PR-body receipts (throwaway, uncommitted) accepted (5a precedent); the
    code-gate cross-checks the spike SQL + outputs.
Q4. [RESOLVED, R3] Per-family CAS = PK-pinned family-id subquery (casByFamily) + an EXACTLY-ONE-LIVE-HEAD
    FAIL-CLOSED preflight (COUNT!=1 → no emit / no mutation / critical audit / non-2xx) + DISTINCT-by-ref
    enumeration — closes B1 (rotation, incl. auth/logout.ts), B2 (NULL device), B3 (Codex R2: 2-head is NO longer
    "revoke 1 emit 1"; emit ⟺ family FULLY revoked). Disproof protocol TIERED (L1); error envelope standardized (§5).
Q5. [OPEN — owner/Codex] DB hardening: a partial UNIQUE index `ON refresh_tokens(session_id) WHERE revoked_at IS
    NULL` would make a 2-live-head family IMPOSSIBLE at the DB (not just detected). It is a MIGRATION (breaks
    code-only). It does NOT fix the §1.5 rotation window (needs the atomic batch regardless). If ever built, the
    index expression MUST align with the runtime ref `COALESCE(session_id,'legacy_'||id)` (don't let the DB
    invariant diverge from the runtime one — Codex R4). Default: NOT in 5d-2 (the code-level GLOBAL fail-closed
    preflight suffices); track as follow-up. Fold in (a 5d-2a schema step), or keep separate?
Q6. [RESOLVED, R4 — Codex R3] refresh.ts rotation has a 0-LIVE-HEAD window (two separate writes) casByFamily alone
    cannot close → 5d-2 PREREQUISITE (§1.5) makes rotation ONE atomic db.batch (UPDATE old + gated INSERT new; reuse
    = changes()=0), proven by SP7. Without it, 5d-2 emission MUST NOT ship.
Q7. [RESOLVED, R5 — Codex R4] multi-family integrity COUNT is GLOBAL on (user_id, ref) — DEVICE-LESS, matching
    casByFamily — NOT device-filtered (which would miss a same-ref-across-two-devices duplicate). The device filter
    selects CANDIDATE refs only (§4.2); the global count validates each before any mutation/emit.

--- END PR5 5d-2 GATE-1 PLAN (R5 — Codex R4: multi-family integrity count GLOBAL (user_id,ref) device-less, matches casByFamily; device filter selects candidates only) ---
