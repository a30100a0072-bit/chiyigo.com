# PR5 5c — Retro-wire account.disabled / account.reenabled (Gate-1 Plan)

- Created: 2026-06-03
- Status: Owner Gate-1 APPROVED 2026-06-03 (Q1-Q5 ruled — section 18); pushed for formal Codex Gate-1 review.
  NOT yet coded.
- Plan order: docs/reviews/pr5-event-outbox-consumer-plan-2026-06-02.md section 0/D2 + section 14
  ("5c: retro-wire the HOTTER Tier-0 security paths one surface at a time"). PR5 5a + 5b SHIPPED.
- Workgrade: L2 (wire emission into 2 existing admin endpoints + 2 new emit builders; NO new module, NO new
  table, NO new migration, NO new audit type) + HIGH-RISK ADDENDUM (Distributed State / deny-state security path).
  The 4 high-risk pre-code artifacts (state transition / failure modes / idempotency / retry+timeout) are in
  sections 5-7 — MOST are INHERITED unchanged from the 5b consumer (5c only ADDS emit sites; it touches no
  consumer/retry/DLQ code).
- Predecessor contract: functions/utils/domain-events.ts (FROZEN by PR4). account.disabled / account.reenabled
  are ALREADY in the frozen 11-type taxonomy + the migration 0051 event_type CHECK. 5c invents NOTHING.
- Constraints: $0 (Cloudflare free tier only), no CF Queues / Durable Objects, no vendor lock-in, Tier-0 baseline.

--------------------------------------------------------------------------------
## 0. Owner decision (LOCKED 2026-06-03) — do not relitigate in code
--------------------------------------------------------------------------------

D-5c-1. **5c scope = account.disabled (ban) + account.reenabled (unban) ONLY. session.revoked is DEFERRED to a
        dedicated follow-up phase (5d).** Owner-approved 2026-06-03.

  WHY session.revoked is NOT wirable on today's schema (the Gate-1 finding):
  - The frozen contract derives `streamKey = session:<sub>:<scope>:<ref>` and PROMISES (domain-events.ts:16-18)
    that "a re-login is a NEW streamKey and is never permanently denied". That holds ONLY if `ref` is PER-LOGIN.
  - The actual `refresh_tokens` schema (0000_base.sql:138) has only `device_uuid` (STABLE per browser — it is the
    localStorage browser identity, reused across logins) and `token_hash` (rotates EVERY refresh). There is NO
    per-login "device-session id". Keying device-scope on `device_uuid` would write a permanent `denied=1` on
    `session:<sub>:device:<device_uuid>`, and a re-login on that browser reuses the SAME key → PERMANENTLY DENIED.
    That bakes a KNOWN-WRONG deny semantic into the projection a FUTURE RP reads — the exact F1-class
    contract-integrity bug 5a/5b avoided (and the reason member.invited / product_access were deferred, not
    emitted wrong).
  - admin jti-revoke (admin/revoke.ts mode=jti) revokes a bare jti and does NOT know the user → cannot form
    `session:<sub>:jti:<ref>`.
  - device revoke mutations are MULTI-ROW (`UPDATE refresh_tokens ... WHERE user_id=? AND device_uuid=?`), but the
    5a `seqUpsert` gate is `changes() = 1` EXACTLY → it would mis-fire for N≠1 rows; correct wiring needs a
    `changes() >= 1` helper variant + a FRESH remote-D1 spike. Too much for a small retro-wire phase.
  PRINCIPLE (the whole program's discipline): rather NOT emit than emit a deny event whose semantics are already
  known to be wrong. session.revoked gets its own phase (5d) that FIRST adds a per-login device-session-id to
  refresh_tokens (Expand migration) + decides jti sub-sourcing, THEN wires it correctly. See section 16.

--------------------------------------------------------------------------------
## 1. Scope and non-goals
--------------------------------------------------------------------------------

IN SCOPE:
- 2 new emit BUILDERS in functions/utils/domain-event-emit.ts: emitAccountDisabled, emitAccountReenabled.
  Both BOUND-only data (no SQL-derived, no CAS-pinned field) → reuse the EXISTING seqUpsert (changes()=1) +
  outboxInsert verbatim. No new low-level helper, no new spike (single-row changes()=1 proven by the 5a spike).
- Wire functions/api/admin/users/[id]/ban.ts  → account.disabled (account:<sub>, deny).
- Wire functions/api/admin/users/[id]/unban.ts → account.reenabled (account:<sub>, undeny).
- A LATENT-RACE HARDENING the emission surfaces (section 4): ban/unban currently gate on an APP PRE-READ
  (`if status==='banned'`), NOT a CAS. Two concurrent bans both write today. 5c adds the missing transition CAS so
  exactly ONE request transitions + emits exactly one event (regression-locked).
- Post-commit best-effort domain.event.emitted audit at each site, REUSING the existing
  auditDomainEventEmitted() helper (user-audit.ts; redacts streamKey → stream_key_hash). No new audit type.
- Tests at every layer (emit-on-apply / no-emit-on-noop / atomicity / concurrent-double-ban / ban→unban
  contiguity THROUGH the real 5b consumer / no-regression on token_version + refresh revoke).

NON-GOALS (explicit, to bound the blast radius):
- NO session.revoked (deferred to 5d — D-5c-1).
- NO whole-user logout-all event. admin/revoke.ts mode='user' (token_version bump + revoke ALL refresh_tokens)
  and ban's own `token_version+1` are a TOKEN-EPOCH cutoff, a FUTURE separate concept — they emit NOTHING here
  (the contract reserves whole-user logout-all as NOT a deny-list subject).
- NO product_access.* (still deferred ENTIRELY to F-2 per the parent plan ruling 18.1).
- NO new migration (0051 already has event_outbox / event_stream_sequences / event_deny_state AND the
  account.disabled/reenabled event_type CHECK values). 5c is CODE-ONLY.
- NO consumer / projection / DLQ / replay change. The 5b consumer is event-type-AGNOSTIC (it reconstructs via
  buildDomainEvent and applies DENY_EFFECT[eventType]); account.disabled='deny' / account.reenabled='undeny' are
  already in DENY_EFFECT, so 5c events flow through the existing consumer with ZERO consumer changes.
- NO account.disabled `reason` payload in v1 (ban.ts collects no reason; the contract key is OPTIONAL and
  additive later — see Open Question Q2).
- NO domain-util extraction of ban/unban (first-do-no-harm minimal diff on a security boundary — see Q1).

--------------------------------------------------------------------------------
## 2. Why these two are CLEAN where session.revoked is not
--------------------------------------------------------------------------------

account.disabled / account.reenabled key on `account:<sub>` where sub = the user's numeric id (String(userId)).
That id is STABLE FOR THE LIFETIME OF THE ACCOUNT — and that is exactly RIGHT here, because account
disabled/reenabled IS a sticky per-account toggle (unlike a session, which must be per-login). A ban then unban is
seq 1 (deny) then seq 2 (undeny) on the SAME streamKey account:<sub>; the projection ends denied=0. A later re-ban
is seq 3 (deny). The long-lived per-account stream is the CORRECT model — there is no re-login hazard because the
subject is the ACCOUNT, not a session. (This is the precise inverse of why session.revoked must NOT key on a
stable id — see D-5c-1.)

Other clean properties:
- Single-row PK CAS (`WHERE id=? AND status…`) → changes() is 0 or 1 → reuse the proven changes()=1 gate.
- actor_sub is ALWAYS the authenticated admin (ban/unban are admin-only) → never null, never client-supplied.
- tenant_id = null (account-scoped, per the contract spec `tenant: 'null'`).
- streamKey = account:<numeric id> contains NO PII (no email), and auditDomainEventEmitted hashes it regardless.

--------------------------------------------------------------------------------
## 3. The two emit builders (functions/utils/domain-event-emit.ts)
--------------------------------------------------------------------------------

Mirror the existing member.* builders EXACTLY. BOUND-only data (sub is the immutable target id; actor is the
admin) → no json_object subquery, no SQL-derived field, no CAS-pinned field. Reuse seqUpsert + outboxInsert as-is.

  export interface AccountEmitInput { targetUserId: number; actorUserId: number }

  emitAccountDisabled(db, input, meta):
    sub       = String(input.targetUserId)        // BOUND
    actorSub  = String(input.actorUserId)         // BOUND (the admin)
    streamKey = deriveStreamKeyValidated('account.disabled', null, actorSub, { sub }, meta)  // -> account:<sub>
    statements = [ seqUpsert(db, streamKey),
                   outboxInsert(db, {eventId, eventType:'account.disabled', streamKey, tenantId:null,
                                     actorSub, occurredAt}, `json_object('sub', ?)`, [sub]) ]

  emitAccountReenabled(db, input, meta):  // identical shape, eventType 'account.reenabled', data {sub}

Validation: deriveStreamKeyValidated runs buildDomainEvent (frozen contract) on the BOUND data → throws on bad
input (programmer error), same as the member.* builders. The 5b consumer re-validates the concrete event at
delivery (defense in depth) — unchanged.

--------------------------------------------------------------------------------
## 4. Wiring + the latent-race CAS hardening (the only NEW correctness surface)
--------------------------------------------------------------------------------

### 4.1 ban.ts (account.disabled)

CURRENT (lines 73-79) — gated on an APP PRE-READ (`if target.status==='banned' return ALREADY_BANNED`), then an
UNCONDITIONAL `UPDATE users SET status='banned' WHERE id=?` batched with a refresh_tokens revoke. Two concurrent
bans BOTH pass the pre-read and BOTH write (the second is a redundant `changes()=1` write) → as an emitted event
this would produce TWO account.disabled events for one logical transition.

NEW — add the transition CAS so the emit gates on a TRUE state transition, and REORDER so the emit statements sit
IMMEDIATELY AFTER the gating users-UPDATE (the changes() chain rule, plan 9.1: no write may intervene between the
gating statement and seqUpsert). The refresh_tokens revoke MOVES to AFTER the emit (it was S2; if left there it
would break the changes() chain). All four stay in ONE atomic batch:

    const emit = emitAccountDisabled(db, { targetUserId, actorUserId: Number(user.sub) }, emitMeta())
    const r = await db.batch([
      db.prepare(`UPDATE users SET status='banned', token_version=token_version+1
                   WHERE id=? AND status!='banned'`).bind(targetId),   // S1 gating CAS: changes()=1 iff THIS req transitioned
      ...emit.statements,                                              // S2 seqUpsert (gate S1), S3 outboxInsert (gate S2)
      db.prepare(`UPDATE refresh_tokens SET revoked_at=datetime('now')
                   WHERE user_id=? AND revoked_at IS NULL`).bind(targetId),  // S4 side-effect, after emit
    ])
    if (r[0].meta.changes === 1) { /* applied */ await auditDomainEventEmitted(env, emit.identity); ...existing admin.user.banned audit; return success }
    else return res({ error:'User is already banned', code:'USER_ALREADY_BANNED' }, 400)   // CAS lost the race

  CAS predicate `status != 'banned'` (NOT `= 'active'`): users.status has NO CHECK constraint (0000_base.sql:59,
  default 'active'); values are 'active'/'banned' by convention but a non-active non-banned value must still
  transition to banned and emit once. `!= 'banned'` is the safe choice (verify the status value-set at coding).
  token_version+1 STAYS inside the CAS'd statement (no bump on a 0-row no-op — already bumped by the winner).
  The existing pre-read (`if status==='banned'`) is KEPT as the cheap common-case short-circuit (avoids a wasted
  hash-chain admin_audit_log write + batch on the already-banned case); the CAS is the defense for the TOCTOU race
  only. appendAuditLog (hash-chain) ordering is UNCHANGED (it still runs before the batch).
  Two deliberate-and-benign edges on the RARE 0-row CAS (a concurrent ban won the race AFTER this request passed
  its pre-read): (i) the refresh_tokens revoke S4 is UNGATED, so it still runs and idempotently re-revokes any
  straggler active tokens — harmless defense-in-depth, never wrong; (ii) the pre-batch hash-chain admin_audit_log
  row records a ban ATTEMPT by this admin (which is true) even though no state transitioned + no event emitted.
  Both are acceptable; flagged so a reviewer is not surprised. (S4 is left ungated because, sitting after S2/S3,
  it cannot read S1's changes() directly; gating it would buy nothing over its natural idempotency.)

### 4.2 unban.ts (account.reenabled)

CURRENT (lines 73-76) — a standalone, NON-CAS `UPDATE users SET status='active' WHERE id=?`.run(). NEW — CAS +
wrap in a batch with the emit:

    const emit = emitAccountReenabled(db, { targetUserId, actorUserId: Number(user.sub) }, emitMeta())
    const r = await db.batch([
      db.prepare(`UPDATE users SET status='active' WHERE id=? AND status='banned'`).bind(targetId),  // S1 gating CAS
      ...emit.statements,                                                                             // S2/S3
    ])
    if (r[0].meta.changes === 1) { await auditDomainEventEmitted(env, emit.identity); ...existing admin.user.unbanned audit; return success }
    else return res({ error:'User is not banned', code:'USER_NOT_BANNED' }, 400)

  unban does NOT bump token_version and does NOT touch refresh_tokens today (the user re-logins) — KEEP that; 5c
  changes nothing about unban's side effects, it only adds the gated emit.

### 4.3 emitMeta() at the call site

eventId + occurredAt are the ONLY side effects (crypto.randomUUID() / new Date().toISOString()), injected at the
endpoint exactly like members.ts (the helper does NO I/O). ban.ts / unban.ts are endpoints, so they construct
`{ eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() }` inline (members.ts's private emitMeta()
is NOT exported across modules — same value, local construction; see Q1 on why we don't extract a domain util).

--------------------------------------------------------------------------------
## 5. State machine + idempotency (high-risk addendum — mostly INHERITED from 5b)
--------------------------------------------------------------------------------

Per-streamKey projection on account:<sub> (applied by the UNCHANGED 5b consumer, contiguous seq):
    account.disabled  (DENY_EFFECT='deny')   -> denied=1
    account.reenabled (DENY_EFFECT='undeny') -> denied=0
  Sequence example on account:<sub>:  ban=seq1(denied=1) -> unban=seq2(denied=0) -> re-ban=seq3(denied=1).
  Contiguous apply (5b §5.2) guarantees ordered application; cross-streamKey independent.

Idempotency:
  - EMIT side (5c): no-emit-on-noop — a 0-row CAS (double-ban / double-unban / lost race) bumps NO seq and writes
    NO outbox row (structural via the WHERE changes() chain). eventId is UNIQUE.
  - DELIVERY side (5b, inherited): the contiguous per-streamKey cursor makes a re-delivered seq <= last_applied a
    no-op. account events ride this unchanged.

--------------------------------------------------------------------------------
## 6. Failure modes + recovery (high-risk addendum — INHERITED, with one new emit-time case)
--------------------------------------------------------------------------------

- NEW (emit-time): a DB error in S2/S3/S4 rolls back the WHOLE batch — the user is NOT banned, no token_version
  bump, no refresh revoke, no event. The endpoint returns 5xx. Both-or-neither (atomicity test, section 8).
- Consumer crash / transient delivery failure / poison / DLQ / replay / lease fencing — ALL inherited from 5b
  UNCHANGED (account events are just more rows in event_outbox; the consumer code is event-type-agnostic).
- Head-of-line per streamKey (inherited): a stuck account.disabled at seq N blocks account.reenabled at seq N+1
  on the same account:<sub> until delivered/replayed. Correct ordering (you must not apply an undeny before its
  deny); per-account admin-action rate is low; alarmed via the existing DLQ critical audit.

--------------------------------------------------------------------------------
## 7. Retry / timeout (high-risk addendum — INHERITED)
--------------------------------------------------------------------------------

5c introduces NO new external call and NO new long-running path. The emit is part of the endpoint's existing D1
batch (D1's own statement timeout applies; no new unbounded wait). All retry / backoff / lease / max-attempts /
crash-sweep behavior lives in the 5b consumer and is UNCHANGED. The post-commit auditDomainEventEmitted is
best-effort (safeUserAudit swallow-on-failure) — its loss never affects correctness (the outbox row is the SoT).

--------------------------------------------------------------------------------
## 8. Test plan
--------------------------------------------------------------------------------

BUILDER unit tests (c2 — meta is INJECTABLE here, so eventId/occurredAt are deterministic):
  - shape / streamKey: emitAccountDisabled/Reenabled produce statements whose outbox row reconstructs to a valid
    DomainEvent; streamKey == deriveStreamKey == account:<sub>; tenant_id NULL; data == {sub}.
  - atomicity (both-or-neither): with a FIXED meta, pre-seed a duplicate event_id row, then run
    db.batch([<single-row users-update stub>, ...emit.statements]) → the UNIQUE violation rolls back the WHOLE
    batch (the stub mutation does NOT persist). This is why atomicity is tested at the BUILDER seam, NOT via the
    HTTP endpoint (where eventId is an inline randomUUID the test cannot pin). (5a atomicity pattern.)

ENDPOINT integration tests (c3/c4 — real local D1, real db.batch — NO mock; assert by ROW COUNTS, not eventId):
  - emit-on-apply: a real ban → EXACTLY ONE account.disabled outbox row (streamKey=account:<id>, seq monotonic,
    tenant_id NULL, actor_sub=admin, data.sub=<id>); a real unban → ONE account.reenabled row.
  - no-emit-on-noop (locks the EXACT failure mode): ban an already-banned user (CAS 0-row) → NO outbox row, NO
    seq bump, response USER_ALREADY_BANNED; unban a not-banned user likewise → USER_NOT_BANNED.
  - CONCURRENT DOUBLE-BAN — the FULL lost-race invariant set (owner Gate-1 code-gate LOCK, section 18): two
    concurrent bans on one active user MUST assert ALL FOUR — (1) EXACTLY ONE account.disabled outbox row, (2) NO
    second seq bump on account:<sub> (event_stream_sequences.last_seq == 1, not 2), (3) users.token_version
    incremented by EXACTLY 1 (winner +1, the 0-row loser does NOT bump — the bump is inside the CAS'd statement),
    (4) refresh_tokens ALL revoked at the end (the winner's S4, and the loser's UNGATED S4 is an idempotent
    re-revoke — "finally revoked" holds either way). These four lock the latent-race fix AND the S4-ungated edge.
  - ban→unban contiguity THROUGH THE REAL 5b CONSUMER: ban then unban, run the consumer, assert event_deny_state
    for account:<sub> ends denied=0, last_applied_seq=2 — proving account events need NO consumer change.
  - NO REGRESSION on ban side effects: a single real ban bumps users.token_version by EXACTLY 1 (assert +1, not
    +2); active refresh_tokens still revoked. unban still sets 'active' with NO token_version change.
  - post-commit audit: domain.event.emitted fires ONCE on applied (redacted — event_data contains stream_key_hash,
    NEVER the raw streamKey), ZERO on a no-op.
  - contract: every emitted row passes validateDomainEvent on reconstruct; streamKey == deriveStreamKey.

NOT needed: migration round-trip (no new migration); audit-policy registry change test (no new audit type — assert
_registrySize UNCHANGED as a guard).

--------------------------------------------------------------------------------
## 9. Security (high-risk addendum + baseline)
--------------------------------------------------------------------------------

- Authz UNCHANGED: ban/unban keep requireRole('admin') + admin:users:write scope + the role-hierarchy guard
  (actorOutranksTarget) + self-target guard + isKnownRole guard. 5c adds NO endpoint, NO scope, NO route.
- actor_sub = SERVER-resolved admin sub (Number(user.sub)); tenant_id = null. Never client-supplied.
- PII / redaction: streamKey = account:<numeric id> (no email, low PII); auditDomainEventEmitted hashes it to
  stream_key_hash regardless (uniform B4). Raw streamKey lives ONLY in the access-controlled event_outbox /
  event_deny_state columns. No raw streamKey/data in any audit or alert.
- No external egress (no push, no client URL) → no SSRF. Idempotency/forgery defenses (eventId UNIQUE,
  (stream_key,stream_seq) UNIQUE) inherited from 0051.
- The hash-chain admin_audit_log write (P1-15) is UNCHANGED and still precedes the mutation; the deny-state emit
  is independent of it.

--------------------------------------------------------------------------------
## 10. Observability
--------------------------------------------------------------------------------

- Reuse domain.event.emitted (info; TELEMETRY category; already registered) at both sites. NO new audit type →
  audit-policy REGISTRY size UNCHANGED (assert it as a guard; current = 206 after 5b).
- The 5b consumer's domain.event.delivered / .retry / .dlq / .consumer_run already cover account events with no
  change. Revocation-propagation-lag (emit occurred_at → projection updated_at) now also reflects account events.

--------------------------------------------------------------------------------
## 11. Deploy / migration discipline
--------------------------------------------------------------------------------

- CODE-ONLY phase (0051 already applied to remote in 5a). No `wrangler d1 migrations apply` step.
- credential-free prod smoke: homepage 200; POST /api/admin/users/:id/ban and /unban → 401/403 without an admin
  token/scope (no state change). Positive smoke (a real ban round-trip) follows the owner-waiver pattern
  (PR2/PR3/PR4/5a/5b) — exercised fully by the local integration suite; positive prod smoke deferred.
- Branch pr5c-account-events; double-gate (this plan → Codex; then code → Codex); squash-merge after Approve.

--------------------------------------------------------------------------------
## 12. Commit plan (one Tier-0 surface per small commit)
--------------------------------------------------------------------------------

  c1  this plan doc (the Gate-1 checkpoint commit).
  --- after Codex Gate-1 Approve, coding ---
  c2  domain-event-emit.ts: emitAccountDisabled + emitAccountReenabled + builder unit tests (shape / streamKey /
      BOUND-only / atomicity-at-the-builder-seam with injectable meta).
  c3  ban.ts → account.disabled (CAS + batch reorder + post-commit emitted audit) + integration tests
      (emit-on-apply / no-emit-on-noop / atomicity / concurrent-double-ban / no-regression on token_version+refresh).
  c4  unban.ts → account.reenabled (CAS + batch wrap + emitted audit) + tests (emit/no-emit/atomicity) +
      ban→unban contiguity-through-consumer test.
  (c2-c4 = the coding checkpoint; one PR, logical commits, squash-merged.)

--------------------------------------------------------------------------------
## 13. Baseline conflicts / tech-debt surfaced (proactive)
--------------------------------------------------------------------------------

- ban.ts / unban.ts are ROUTE handlers that operate D1 directly (a pre-existing baseline deviation, "Route 不直接
  操作 DB"). 5c does NOT fix it (extracting a domain util enlarges a Tier-0 security diff against
  first-do-no-harm — Q1). The emit BUILDERS provide the unit-test seam; the endpoint wiring is integration-tested.
  Tracked as a possible future refactor (account-state domain util), NOT 5c scope.
- The latent ban/unban pre-read race (section 4) is a PRE-EXISTING gap that 5c's emission SURFACES and FIXES (the
  CAS) — a fix landed with the feature, regression-locked, not new debt (same disposition as 5a's F1/F2).
- session.revoked deferral (D-5c-1) is EXPLICIT, not silently skipped — it becomes phase 5d with a per-login
  device-session-id model. See section 16.

--------------------------------------------------------------------------------
## 14. Architecture-plan alignment
--------------------------------------------------------------------------------

- Parent plan section 0/D2 + 14 named 5c as "ban→account.disabled, unban→account.reenabled, per-device/per-jti
  revoke→session.revoked, one Tier-0 surface per commit". 5c delivers the account.* half EXACTLY; the
  session.revoked half is split to 5d for the contract-integrity reason in D-5c-1 (the parent plan already flags
  session.revoked as BOUNDED and whole-user logout-all as out of scope; 5d honors that with a correct ref model).
- DENY_EFFECT / contiguous projection / outbox mechanics — all reused unchanged.

--------------------------------------------------------------------------------
## 15. Reused assets (do not reinvent)
--------------------------------------------------------------------------------

- domain-events.ts (FROZEN) — account.disabled/reenabled taxonomy + streamKey deriver + DENY_EFFECT.
- domain-event-emit.ts seqUpsert / outboxInsert / deriveStreamKeyValidated / emitResult — reused verbatim.
- members.ts — the [mutation, ...emit.statements] db.batch + `if changes===1` applied-classification pattern.
- user-audit.ts auditDomainEventEmitted — the post-commit redacted emitted audit (reused as-is).
- migration 0051 — already has the tables + the account.* event_type CHECK values.

--------------------------------------------------------------------------------
## 16. Follow-up: phase 5d — session.revoked (correct modeling)
--------------------------------------------------------------------------------

Out of 5c scope; recorded so the deferral is tracked, not lost:
- Add a PER-LOGIN device-session id (or token-family id) to refresh_tokens via an EXPAND migration (0052) +
  backfill, so device-scope `ref` is per-login (re-login = new streamKey, honoring the contract's promise).
- Decide jti-scope sub-sourcing (admin/revoke.ts mode=jti must learn the target user, or jti-scope is sourced
  from a site that knows the sub).
- Add the `changes() >= 1` seqUpsert variant for the MULTI-ROW refresh_tokens revoke gate + a fresh remote-D1
  spike (don't assert the >=1 chaining blind — feedback_dont_assert_runtime_semantics_without_verify).
- Wire sites: admin/revoke.ts mode=device, auth/devices/logout.ts (self), and evaluate auth/logout.ts; whole-user
  logout-all (mode=user / token_version bumps) stays a NON-event (token-epoch concept).

--------------------------------------------------------------------------------
## 17. Open questions for Codex Gate-1
--------------------------------------------------------------------------------

Q1. Wiring style: INLINE emit-builder into ban.ts/unban.ts (minimal diff on a Tier-0 security boundary;
    first-do-no-harm) vs EXTRACT a functions/utils/account-state.ts domain util (mirrors members.ts; more
    testable; but enlarges the security diff). Plan picks INLINE + the builders as the test seam, extraction as a
    tracked follow-up. Ruling?
Q2. account.disabled `reason`: OMIT in v1 (ban.ts has no reason input; contract key is OPTIONAL, additive later)?
Q3. CAS predicate `status != 'banned'` (ban) / `status = 'banned'` (unban) — given users.status has no CHECK
    constraint. Confirm `!= 'banned'` over `= 'active'` for ban.
Q4. 0-row CAS endpoint response: PRESERVE the existing USER_ALREADY_BANNED / USER_NOT_BANNED 400s (vs idempotent
    200). Plan keeps the existing responses.
Q5. Confirm the session.revoked → 5d deferral (D-5c-1) and the 5d outline (section 16).

--------------------------------------------------------------------------------
## 18. Owner Gate-1 rulings (RESOLVED 2026-06-03 — fold into coding)
--------------------------------------------------------------------------------

Owner reviewed against the production-SaaS gate: APPROVED, no blocking finding. The five open questions are ruled:

R-Q1. Wiring = INLINE emit-builder into ban.ts/unban.ts (small diff first on a Tier-0 phase). Domain-util
       extraction stays a tracked follow-up (section 13). [section 4 / Q1]
R-Q2. account.disabled carries NO `reason` in v1 — the endpoint has no reason input, do NOT fabricate one. The
       contract key stays OPTIONAL + additive later. [section 3 / Q2]
R-Q3. CAS predicates: ban `status != 'banned'`, unban `status = 'banned'`. users.status is NOT NULL (owner
       confirmed) — so no NULL-status edge to guard. [section 4 / Q3]
R-Q4. 0-row CAS preserves the existing USER_ALREADY_BANNED / USER_NOT_BANNED 400 responses (not idempotent 200).
       [section 4 / Q4]
R-Q5. session.revoked → 5d CONFIRMED. 5c is account-only. [D-5c-1 / section 16 / Q5]

NON-BLOCKING (owner, for code-gate attention): ban's S4 refresh_tokens revoke is UNGATED, so a rare CAS-loser may
re-run the revoke — ACCEPTABLE (same user, idempotent, defensive). The CODE-GATE must confirm the tests LOCK the
four lost-race invariants (now in section 8 CONCURRENT DOUBLE-BAN): exactly ONE account.disabled event, NO seq
bump on the loser, token_version incremented by EXACTLY 1, refresh_tokens finally revoked.

--- END PR5 5c GATE-1 PLAN (R1, owner-approved 2026-06-03) ---
