# PR5 5d — session.revoked (correct per-login modeling) — Gate-1 Plan

- Created: 2026-06-03
- Status: Owner Gate-1 APPROVED 2026-06-03 (section 0 decisions D1-D6 ruled 1/1/1/1 + 2 refinements; section 20).
  Pushed for formal Codex Gate-1. NOT yet coded. NO spike run yet (the multi-family spike runs at the start of
  5d-2, AFTER 5d-1 ships — section 7 / 16).
- Predecessor: PR5 5a/5b/5c SHIPPED. 5c explicitly DEFERRED session.revoked to this phase (5d) because the
  refresh_tokens schema had no per-login id (pr5c-account-events-plan-2026-06-03.md sections 0/16).
- Frozen contract: functions/utils/domain-events.ts (FROZEN by PR4). session.revoked is ALREADY in the 11-type
  taxonomy + the migration 0051 event_type CHECK. 5d invents NO taxonomy / envelope / ordering — it only (a) adds
  the schema that makes a CORRECT `ref` possible, and (b) wires emission.
- Workgrade: L3 + HIGH-RISK ADDENDUM (schema change on an auth-critical table + Distributed State / multi-writer
  deny-state + the entire login fleet as write surface). The full 10-step high-risk artifacts are in sections 9-15.
- Constraints: $0 (Cloudflare free tier only), no CF Queues / Durable Objects, no vendor lock-in, Tier-0 baseline.

--------------------------------------------------------------------------------
## 0. OPEN DECISIONS FOR OWNER (BLOCKING — rule before any code)
--------------------------------------------------------------------------------

These are the design forks 5c flagged for 5d. The plan body below is written around a RECOMMENDED default for
each, clearly marked; if the owner rules differently the body is revised (cheap, pre-code). DO NOT treat the
recommended option as decided.

D1. **Where does the per-login id live?** (section 3)
    - (A) RECOMMENDED — a new NULLABLE column `refresh_tokens.session_id TEXT` (a UUID), generated fresh at each
      interactive login and PRESERVED across rotation (exactly like the existing auth_time / scope / issued_aud
      carried fields, refresh.ts:218). Minimal; follows the established preserve-on-rotation pattern.
    - (B) a new first-class table `login_sessions(id, user_id, device_uuid, created_at, revoked_at, ...)` +
      `refresh_tokens.login_session_id`. Normalizes a "login session" as an entity (enables a future "list/!revoke
      my sessions" UX), but is a much larger schema + migration + a second write on every login.
    - (C) derive from `refresh_tokens.id` carried forward as a "root id". Rejected: id is the rotating PK; carrying
      it forward is just (A) with a worse-named column.
    Trade-off: (A) = first-do-no-harm minimal change, the projection is INTERNAL so we don't need the entity yet;
    (B) = nicer 5-year model but enlarges a Tier-0 auth-table change now. Recommend (A), track (B) as a follow-up.
    → RULED 2026-06-03: (A). DESIGN session_id AS THE FORERUNNER of a future `login_sessions.id`: a globally-unique
    UUID, generated at login, preserved on rotation. Do NOT build login_sessions now. Upgrade path (later phase): a
    migration creates login_sessions seeded from the DISTINCT session_id values, and refresh_tokens.session_id
    becomes its FK — so 5d corrects session.revoked semantics short-term AND keeps the long-term first-class-table
    door open. Keep session_id opaque + uuid-shaped so that upgrade is clean.

D2. **Backfill value for existing refresh_tokens rows** (section 4)
    - (A) RECOMMENDED — `UPDATE refresh_tokens SET session_id = 'legacy_' || id WHERE session_id IS NULL`. Uses the
      row's own AUTOINCREMENT PK, which is UNIQUE and NEVER reused → each legacy row becomes its own stable family
      id; a re-login gets a fresh UUID that can never collide with `legacy_<n>` → the contract's "re-login = new
      streamKey, never permanently denied" holds for legacy rows too.
    - (B) leave NULL and treat NULL as "not yet emittable" (skip emission for un-migrated rows; they age out within
      the ≤7-day TTL as they rotate/expire). Simpler migration, but a revoke of a NULL-id row in the deploy gap
      can't emit — a silent coverage hole on exactly the security path 5d exists to cover.
    Recommend (A) + a read-time `COALESCE(session_id, 'legacy_' || id)` belt-and-suspenders (handles the
    migrate→deploy gap where a brand-new login lands a NULL id before the code that writes it deploys).
    → RULED 2026-06-03: (A), but the backfill literal is `'legacy_' || id` (UNDERSCORE), NOT `'legacy:'`. The frozen
    streamKey is `session:<sub>:<scope>:<ref>` and the contract does NOT explicitly sanction a colon inside `ref`
    (verified: ref is just a non-empty string; the deriver interpolates without parsing-back, so a colon validates
    but is not blessed). A `:` in ref would make a future RP/tool's colon-split of the streamKey ambiguous. So 5d
    holds a DELIMITER-SAFETY INVARIANT: ref NEVER contains `:` (UUIDs are colon-free; the legacy backfill uses `_`)
    → every session streamKey has EXACTLY 3 colons and stays cleanly splittable. (section 3/6)

D3. **jti-scope sub sourcing** (section 8) — `admin/revoke.ts mode=jti` gets a BARE jti and does not know the user,
    so it cannot form `session:<sub>:jti:<ref>`.
    - (A) RECOMMENDED for 5d — DEFER jti-scope entirely; 5d ships scope=`device` ONLY. Rationale: jti denies a
      single access token (≤15-min TTL) whose enforcement already runs through revoked_jti (KV+D1); the durable
      session.revoked event adds little until an RP actually consumes the projection (RP pull API is deferred — RP
      契約缺口 #4). "Rather not emit than emit a half-modeled subject." jti-scope gets its own later phase when a
      sub-bearing call site + an RP consumer exist.
    - (B) add an optional/required `user_id` to `mode=jti` so the admin supplies the target; emit scope=jti when
      present. Small additive API change, but extra admin friction for marginal near-term value.
    Recommend (A): device-scope only in 5d.
    → RULED 2026-06-03: (A). 5d does scope=device ONLY (per-login session-family revoke). jti → 5d-3 or later, once
    a call site can credibly supply BOTH sub AND jti/ref. Do not guess the sub from an opaque jti.

D4. **Multi-family device-revoke mechanism** (section 7) — a device revoke matches MULTIPLE login families
    (`WHERE user_id=? AND device_uuid=?` hits one unrevoked head per family; web clients have device_uuid=NULL so
    families are distinguished ONLY by session_id). Per the contract each family is its OWN streamKey, so a
    device-revoke must emit ONE session.revoked PER family.
    - (A) RECOMMENDED — "Mechanism B": decompose the multi-row revoke into N single-row CAS triples in ONE atomic
      batch `[CAS(id=head₁), seq(sk₁), outbox(sk₁), CAS(id=head₂), seq(sk₂), outbox(sk₂), …]`, reusing the
      5a-proven `changes()=1` gate N times (NOT a new `changes()>=1` primitive). REQUIRES a fresh spike (section 7)
      proving `changes()` reflects each triple's OWN preceding CAS across N interleaved triples, local + remote D1.
    - (B) the 5c-outline's `changes()>=1` variant on a single multi-row UPDATE. REJECTED unless the spike kills (A):
      a single UPDATE+one emit can only carry ONE streamKey, which forces ref back onto device_uuid → the exact
      permanent-deny bug 5d exists to avoid.
    Recommend (A), spike-gated. If the spike DISPROVES (A): STOP, report, fall back to single-family sites only
    (D5) + defer multi-family — do NOT code multi-family on unproven D1 semantics.
    SUB-DECISION (found in self-review, section 7.1): Mechanism B turns one N-row UPDATE into 3N batched statements,
    introducing a per-batch ceiling the single UPDATE never had. N is usually 1-3 but unbounded in principle.
    Recommend CHUNK into atomic batches of ≤K families (K measured by spike SP6) + idempotent retry + alarm on large
    N; fallback = single-UPDATE-revoke + best-effort emit. Owner: confirm chunk-and-alarm?
    → RULED 2026-06-03: Mechanism B (per-family single-row CAS triples, reuse the proven changes()=1 — do NOT invent
    a changes()>=1 primitive) + CHUNK + spike-gated. SP1-SP6 must clear before 5d-2 multi-family code; disproof →
    STOP + report + fall back to single-family only.

D5. **Phasing** (section 16) — recommend splitting 5d into independently-gated PRs (each its own double-gate):
    - **5d-1 (schema + write surface)**: migration 0052 (session_id + backfill) + wire session_id into all 8
      refresh_tokens INSERT sites (7 logins write fresh, 1 rotation preserves) + tests. NO emission. This is the
      Expand+Migrate; it lets session_id populate across the LIVE fleet and bake before emission depends on it, AND
      isolates a shared-auth-primitive change from feature logic (feedback_shared_auth_contract_isolation).
    - **5d-2 (emission + spike)**: the multi-family spike + `emitSessionRevoked` builder + wire the revoke sites +
      tests. This is the Contract step (emission now relies on a populated session_id).
    - **5d-3 (jti-scope)**: only if D3=(B).
    Alternative: one combined 5d PR. Recommend phased (smaller Tier-0 diffs, expand/migrate/contract honored).
    → RULED 2026-06-03: phased (this is a Tier-0 auth path — do NOT do it in one PR). 5d-1 schema+backfill+write all
    8 sites (no emit) → 5d-2 spike+builder+wire logout/devices-logout/admin-device → 5d-3 jti only if needed.

D6. **Which revoke sites does 5d-2 wire?** (section 5/7) — recommend:
    - IN: `auth/logout.ts` (self, single-family), `auth/devices/logout.ts` (self, multi-family),
      `admin/revoke.ts mode=device` (admin, multi-family).
    - DEFER (own decision): `refresh.ts` device_mismatch auto-revoke (a security path in the HOT refresh endpoint;
      emitting there is correct semantically but touches the highest-traffic auth file — first-do-no-harm suggests
      a separate follow-up). Owner: include device_mismatch in 5d-2, or defer?
    - NEVER: `admin/revoke.ts mode=user` + ban's token_version bump (whole-user logout-all = token-epoch, NOT a
      deny-list subject — frozen contract + non-negotiable).
    → RULED 2026-06-03: 5d-2 IN = auth/logout.ts, auth/devices/logout.ts, admin/revoke.ts mode=device. DEFER =
    refresh.ts device_mismatch (hot refresh path — first-do-no-harm), admin/revoke.ts mode=jti (→ 5d-3), and NEVER
    admin/revoke.ts mode=user.

--------------------------------------------------------------------------------
## 1. Scope and non-goals
--------------------------------------------------------------------------------

IN SCOPE (assuming the recommended rulings above):
- migration 0052: add `refresh_tokens.session_id TEXT` (nullable) + backfill `'legacy_' || id` + supporting index;
  fully rollback-able (down drops index then column).
- Write surface: generate a fresh `session_id` (crypto.randomUUID()) at the 7 interactive-login INSERT sites;
  PRESERVE `session_id` across the rotation INSERT in refresh.ts (carried field, like auth_time/scope/issued_aud).
- 1 new emit builder `emitSessionRevoked` (BOUND data {sub, scope:'device', ref}; ref supplied by the caller from
  its pre-read of the immutable session_id) reusing seqUpsert + outboxInsert verbatim.
- Wire emission at the device-scope revoke sites (D6): single-family (token_hash) + multi-family (user_id+device).
- The multi-family mechanism (Mechanism B) + a fresh local+remote D1 spike (section 7).
- Post-commit best-effort `domain.event.emitted` audit at each site (reuse auditDomainEventEmitted; redacts to
  stream_key_hash). No new audit type.
- Tests at every layer (section 14).

NON-GOALS (explicit, to bound blast radius):
- NO jti-scope (D3=A) — deferred.
- NO whole-user logout-all event (mode=user / token_version) — token-epoch, NOT a deny subject.
- NO RP pull API / RP wire contract (sink stays the INTERNAL event_deny_state projection — owner LOCKED 2026-06-02).
- NO consumer / projection / DLQ / replay change — the 5b consumer is event-type-agnostic; DENY_EFFECT already has
  `session.revoked='deny'`, so 5d events flow through with ZERO consumer change.
- NO change to access-token CLAIMS (embedding session_id as a `sid` claim for RP matching is a FUTURE concern, and
  is a shared-JWT-contract change that belongs in its own PR — feedback_shared_auth_contract_isolation).
- NO change to token_version / ban / unban (5c owns account.*; 5d touches neither).

--------------------------------------------------------------------------------
## 2. The core finding (recap + deepened): why ref MUST be a per-login id
--------------------------------------------------------------------------------

The frozen contract (domain-events.ts:16-18, 148-154) derives `streamKey = session:<sub>:<scope>:<ref>` and
PROMISES that "a re-login is a NEW streamKey and is never permanently denied", with DENY_EFFECT='deny' (one-way,
never un-revoked). That promise holds ONLY if `ref` is PER-LOGIN.

Verified against real code (2026-06-03):
- `refresh_tokens` (0000_base.sql:138-146 + 0019/0035/0037) has `device_uuid` (STABLE per browser — localStorage
  identity, reused across logins) + `token_hash` (UNIQUE, ROTATES every refresh) + auth_time/scope/issued_aud.
  There is NO per-login id. Keying device-scope on device_uuid → permanent denied=1 → a re-login on that browser
  reuses the SAME key → permanently denied. KNOWN-WRONG semantic baked into a projection a future RP reads.
- For WEB clients device_uuid is NULL (refresh.ts:132 skips the device check when null; the 7 web login sites bind
  `device_uuid ?? null`). So device_uuid cannot even distinguish two web logins — the per-login id is the ONLY
  viable discriminator, not just the correct one.
- ROTATION CONSEQUENCE (the deepened finding): refresh.ts rotates by INSERTing a NEW row each refresh and PRESERVES
  auth_time/scope/issued_aud (refresh.ts:218-220). The per-login id must be a CARRIED field on that same INSERT, or
  it would change every 15 min and defeat its purpose. So session_id = generated-at-login + preserved-on-rotation
  = STABLE for the life of one login, DIFFERENT per login. (This is the OAuth "refresh-token family" id.)
- session_id is IMMUTABLE per row (rows are only ever UPDATEd to set revoked_at; session_id is never rewritten) →
  a caller PRE-READ of session_id is authoritative under concurrency (unlike member.suspended.previousRole, which
  could change and therefore had to be SQL-derived). This keeps streamKey BOUND (computed in JS pre-batch) — no
  SQL-derived-streamKey complication.

account.disabled keys on the STABLE account:<sub> and that is CORRECT (an account toggle is sticky). session.revoked
is the precise inverse: the subject is a SESSION, which must be per-login. Same contract, opposite key lifetime.

--------------------------------------------------------------------------------
## 3. Schema: refresh_tokens.session_id (migration 0052) — D1=(A)
--------------------------------------------------------------------------------

    -- up (0052_refresh_token_session_id.sql)  [NO semicolons in comments — 0050/0051 runner splits on raw ;]
    ALTER TABLE refresh_tokens ADD COLUMN session_id TEXT
    UPDATE refresh_tokens SET session_id = 'legacy_' || id WHERE session_id IS NULL
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON refresh_tokens(session_id)

    -- down
    DROP INDEX IF EXISTS idx_refresh_tokens_session
    ALTER TABLE refresh_tokens DROP COLUMN session_id

- Nullable column (SQLite ADD COLUMN cannot be NOT NULL without a constant default; 'legacy_'||id is not constant)
  → add nullable, backfill in the same migration. New code writes it on every login going forward.
- Rollback: D1/SQLite ≥3.35 supports `ALTER TABLE … DROP COLUMN`, but REFUSES to drop a column referenced by an
  index → the down MUST `DROP INDEX` first. VERIFY at coding that the migration runner + remote D1 accept DROP
  COLUMN in the down round-trip (migrations.test.ts already does up+down round-trips — extend it for 0052). If
  remote D1 rejects DROP COLUMN, the down falls back to the 12-step table-rebuild OR the column is documented as a
  one-way expand (PR-listed, per 資料庫要求) — decide at coding from the round-trip test result.
- Backfill cost: the UPDATE touches every existing refresh_tokens row. refresh_tokens is bounded by active-users ×
  logins and old rows age out (≤7-day TTL), so it is expected small; if the row count is large at coding, batch the
  backfill (keep each statement < 100ms — 資料庫要求). MEASURE row count before applying remote.
- Index rationale: enables a future "revoke by session_id" + the round-trip test; the device-revoke enumeration
  (section 7) reads session_id off rows already selected by (user_id, device_uuid), which the existing
  idx_refresh_tokens_device + idx_refresh_tokens_user_id already serve.
- FORERUNNER intent (owner ruling D1): session_id is a globally-unique UUID INTENDED to become a future
  `login_sessions.id`. 5d does NOT build that table; the upgrade path is a later migration seeding login_sessions
  from the DISTINCT session_id values + repointing refresh_tokens.session_id as its FK. Keep session_id opaque +
  uuid-shaped (no embedded structure) so that upgrade stays clean.
- DELIMITER-SAFETY INVARIANT (owner ruling D2): backfill is `'legacy_' || id` (UNDERSCORE) and live ids are UUIDs
  → ref NEVER contains a `:`. The frozen streamKey `session:<sub>:<scope>:<ref>` therefore always has EXACTLY 3
  colons and stays unambiguously colon-splittable for future RP/tooling. 5d's ref construction must uphold this.

--------------------------------------------------------------------------------
## 4. Expand / Migrate / Contract sequencing — D2=(A)
--------------------------------------------------------------------------------

Zero-downtime, three observable stages (資料庫要求 §Schema 變更):
- EXPAND (0052 up): add nullable session_id + backfill `'legacy_'||id`. Transparent to existing INSERTs (they omit
  it → NULL on brand-new rows in the deploy gap). Applied to remote BEFORE the code deploys (migration-before-deploy
  鐵律, reference_pages_deploy_with_d1_migration).
- MIGRATE (5d-1 code): all 7 login INSERTs write a fresh UUID; rotation PRESERVES it (and HEALS a NULL: rotation
  writes `tokenRow.session_id ?? <fresh uuid>` so any deploy-gap NULL row gets a stable id on its first refresh).
  After 5d-1 bakes, ~all live rows carry a session_id.
- CONTRACT (5d-2 emission): emission reads `ref = COALESCE(session_id, 'legacy_'||id)` (belt-and-suspenders for any
  residual NULL/gap row). Only now does correctness depend on a populated session_id.

This is exactly why D5 recommends 5d-1 and 5d-2 as separate deploys: the Expand+Migrate must bake before the
Contract relies on it.

--------------------------------------------------------------------------------
## 5. Write surface — wiring session_id into the 8 INSERT sites (5d-1)
--------------------------------------------------------------------------------

All confirmed by grep (2026-06-03). 7 interactive logins generate a FRESH id; 1 rotation PRESERVES it:

  FRESH (add `session_id` column + bind `crypto.randomUUID()`):
   - functions/api/auth/local/login.ts:246
   - functions/api/auth/local/register.ts:191
   - functions/api/auth/2fa/verify.ts:164
   - functions/api/auth/webauthn/login-verify.ts:232
   - functions/api/auth/oauth/[provider]/callback.ts:331
   - functions/api/auth/oauth/bind-email.ts:217
   - functions/api/auth/oauth/token.ts:138   (OIDC authcode→token; each token grant is a new session)

  PRESERVE (carry forward + heal NULL):
   - functions/api/auth/refresh.ts:218  → bind `tokenRow.session_id ?? crypto.randomUUID()` (SELECT at :96-103
     must add `session_id` to its column list).

NOTE — this is the ENTIRE login fleet (8 auth-critical files). That blast radius is exactly why D5 isolates 5d-1
as its own PR (first-do-no-harm + feedback_shared_auth_contract_isolation). The change per site is mechanical
(one column, one bind), but every site is a Tier-0 auth path and each gets a test asserting a non-null session_id.

--------------------------------------------------------------------------------
## 6. The emit builder (5d-2) — emitSessionRevoked
--------------------------------------------------------------------------------

Mirrors emitMemberJoined (all-BOUND data) — but `ref` is supplied by the CALLER from its pre-read of the IMMUTABLE
session_id (section 2), so streamKey stays BOUND (computed in JS pre-batch). NO SQL-derived field, NO new helper.

    export interface SessionRevokedEmitInput {
      sub: string            // String(userId) — the session owner
      ref: string            // COALESCE(session_id,'legacy_'||id) read from the row(s) being revoked (immutable)
      actorSub: string | null // self-logout: the user; admin: the admin sub; system (device_mismatch): null
    }
    emitSessionRevoked(db, input, meta):
      scope='device'  (v1; jti deferred per D3)
      streamKey = deriveStreamKeyValidated('session.revoked', null, input.actorSub,
                    { sub: input.sub, scope: 'device', ref: input.ref }, meta)   // -> session:<sub>:device:<ref>
      statements = [ seqUpsert(db, streamKey),
                     outboxInsert(db, {eventId, eventType:'session.revoked', streamKey, tenantId:null,
                       actorSub:input.actorSub, occurredAt}, `json_object('sub',?,'scope','device','ref',?)`,
                       [input.sub, input.ref]) ]

validateDomainEvent (frozen) enforces scope∈{device,jti} + ref non-empty + streamKey match; throws on programmer
error. The 5b consumer re-validates at delivery (defense in depth). DENY_EFFECT['session.revoked']='deny' → the
projection sets denied=1 (one-way; a session is never un-revoked → each session streamKey only ever sees a single
deny at seq 1, so NO head-of-line deny/undeny interleave risk).

--------------------------------------------------------------------------------
## 7. Multi-family emission + THE SPIKE (the gating artifact) — D4=(A)
--------------------------------------------------------------------------------

A device revoke (`WHERE user_id=? AND device_uuid=?` or `device_uuid IS NULL`) matches ONE unrevoked head per
active login family. The contract requires ONE session.revoked per family (each its own streamKey). Mechanism B
decomposes the multi-row revoke into N single-row CAS triples in ONE atomic batch, reusing the proven changes()=1:

  caller (e.g. auth/devices/logout.ts):
   1. PRE-READ heads:  SELECT id, COALESCE(session_id,'legacy_'||id) AS ref
                        FROM refresh_tokens WHERE user_id=? AND device_uuid=? AND revoked_at IS NULL   (immutable ref)
   2. build batch = heads.flatMap(h => [
          db.prepare(`UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE id=? AND revoked_at IS NULL`).bind(h.id),  // per-family CAS, changes()=1 iff THIS req revoked it
          ...emitSessionRevoked(db, {sub, ref:h.ref, actorSub}, freshMeta()).statements,                                    // seq(skᵢ) gated on the CAS, outbox(skᵢ) gated on seq
        ])
   3. await db.batch(batch)
   4. post-commit: for each family whose CAS meta.changes===1, best-effort auditDomainEventEmitted(emit.identity)

Single-family sites (auth/logout.ts, `WHERE token_hash=?` → exactly one row) are just N=1 — the 5a-proven single
triple, NO new spike needed.

### 7.1 The N-overflow problem (D4 sub-decision — found in self-review)
The CURRENT code revokes all N families in ONE `UPDATE … WHERE user_id=? AND device_uuid=?` statement → NO ceiling.
Mechanism B decomposes that into 3N statements (~11 bound params each: CAS=1, seqUpsert=1, outboxInsert≈9) in one
db.batch → it INTRODUCES a per-batch statement/param ceiling the single UPDATE never had. The repo today only ever
batches 2-3 statements (grep-confirmed); there is NO precedent + NO measured D1 batch limit here. Do NOT assume a
number (feedback_dont_assert_runtime_semantics_without_verify) — SP6 measures it. N (active unrevoked families on
one device) is usually 1-3 but is UNBOUNDED in principle (each login without logout/rotation-away adds a family;
expired-but-unrevoked rows still match `revoked_at IS NULL`), so the tail must be handled:
  - (a) RECOMMENDED — CHUNK into atomic batches of ≤K families (K from SP6, with margin). The endpoint is idempotent
    + forward-progress: a mid-way failure leaves earlier chunks fully revoked+emitted; a retry RE-ENUMERATES heads,
    which now excludes the already-revoked (revoked_at NOT NULL) families → it never double-emits and only finishes
    the remainder. ALARM (warn audit) when N exceeds a threshold (anomalous multi-login) — no silent cap
    (feedback_audit no-silent-caps). Cost: if the client does NOT retry, a partial revoke leaves some sessions live
    (the admin/user sees the device still logged in and re-revokes) — acceptable + observable.
  - (b) FALLBACK if (a) is rejected — keep the single multi-row UPDATE for the REVOKE (atomic, all N, no ceiling)
    and emit per-family BEST-EFFORT post-commit (not gated in the mutation batch). Trades the section-10 atomic
    revoke+emit coupling for always-complete-revoke + eventually-projected emit (needs a reconciliation note). Only
    if owner prefers revoke-completeness over emit-atomicity for large N.
  Recommend (a) chunk+idempotent-retry+alarm.

THE SPIKE (mandatory before coding multi-family; mirror the 5a spike — local miniflare + a throwaway remote D1,
$0, never touching prod chiyigo_db; feedback_dont_assert_runtime_semantics_without_verify):
- SP1 (core): batch [CAS(A), seqA, obA, CAS(B), seqB, obB] on two distinct unrevoked rows → assert exactly 2 outbox
  rows (skA seq1, skB seq1), both rows revoked. Proves changes()=1 reflects each triple's OWN preceding CAS (CAS(B)
  RESETS changes() after obA).
- SP2 (0-row no leak): pre-revoke B, add a third family C → batch [CAS(A),seqA,obA, CAS(B→0row),seqB,obB,
  CAS(C),seqC,obC] → assert ONLY A and C emit; B's 0-row CAS produces no seq/outbox AND does not poison C.
- SP3 (per-family read-your-writes): obB's `(SELECT last_seq … WHERE stream_key=skB)` reads skB's freshly-allocated
  seq, NOT skA's. Assert seq correctness per stream.
- SP4 (atomicity across families): force a UNIQUE(event_id) violation in B's outbox → WHOLE batch rolls back (A NOT
  revoked, zero outbox rows, zero seq bumps). Both-or-neither across N families.
- SP5 (remote parity): re-run SP1-SP4 on a throwaway remote D1 (`wrangler d1 execute --remote`, multi-stmt = one
  batch txn), confirm identical to local.
- SP6 (the ceiling): find the largest db.batch (statement count AND bound-param count) D1 accepts local + remote →
  derive the safe per-batch family count K for 7.1(a). Measurement, not assumption.
DISPROOF PROTOCOL: if SP1-SP5 fail (changes() leaks across triples, or read-your-writes crosses streams) → STOP,
report to owner. Fallback: ship single-family sites only (auth/logout.ts) + DEFER multi-family. Do NOT code
multi-family on unproven semantics. (SP6 failing just sets K for chunking — not a stop.)

Mechanism B race note (acceptable, flag for reviewer): a brand-new login on the same device landing BETWEEN the
pre-read (step 1) and the batch (step 3) is not in the enumerated set, so it is not revoked/emitted — identical to
the race window the existing SELECT-then-UPDATE patterns already have, and that fresh login is the user's own new
session. The per-family CAS also means a family revoked by a concurrent request just 0-rows out (no double emit).

--------------------------------------------------------------------------------
## 8. jti-scope — D3
--------------------------------------------------------------------------------

scope=jti would key `session:<sub>:jti:<jti>` (ref = an access token's jti, a one-way deny of one token).
`admin/revoke.ts mode=jti` (revoke.ts:57-81) takes a BARE jti and never resolves the user → cannot form the sub.
Recommended D3=(A): DEFER jti-scope from 5d. Reasons: (i) the jti is a ≤15-min access token whose enforcement
already runs through revoked_jti (KV+D1, revocation.ts); (ii) a durable session.revoked(jti) adds value only once
an RP consumes the projection (RP pull API deferred); (iii) no current call site both revokes a specific jti AND
knows the sub. If owner picks (B), 5d-3 adds an optional `user_id` to mode=jti and an `emitSessionRevoked` scope
param. Either way: NO guessing the sub from the opaque jti.

--------------------------------------------------------------------------------
## 9. State machine + idempotency (high-risk addendum)
--------------------------------------------------------------------------------

Per-streamKey projection on `session:<sub>:device:<ref>` (applied by the UNCHANGED 5b consumer, contiguous seq):
    session.revoked (DENY_EFFECT='deny') -> denied=1   [one-way; no undeny event exists for a session]
  A given session streamKey sees exactly ONE deny (seq 1) in normal operation → trivially contiguous, no
  deny/undeny interleave, no head-of-line risk. A re-revoke of the same family (rare: double-click) is seq 2 deny =
  idempotent re-deny (denied stays 1).
Idempotency:
  - EMIT side: a 0-row per-family CAS (already-revoked / lost race) bumps NO seq and writes NO outbox row
    (structural via the WHERE changes() chain). eventId is UNIQUE per emit.
  - DELIVERY side (5b, inherited): the contiguous per-streamKey cursor makes a re-delivered seq ≤ last_applied a
    no-op. session events ride this unchanged.
  - Re-login is a NEW family id → a NEW streamKey → a fresh (absent) projection row → never inherits the old deny.

--------------------------------------------------------------------------------
## 10. Failure modes + recovery (high-risk addendum)
--------------------------------------------------------------------------------

- EMIT-time DB error (any statement in the multi-family batch) → WHOLE batch rolls back → NO token revoked, NO
  event, endpoint returns 5xx. Both-or-neither (SP4 + section 14 atomicity test). This couples revocation success
  to emission success — ACCEPTABLE and arguably correct (we never want a "revoked but un-emitted" silent gap on a
  security path); flagged because it changes auth/logout.ts / devices/logout.ts from "best-effort revoke" to
  "atomic revoke+emit". (Contrast the post-commit AUDIT, which stays best-effort — its loss never affects the
  outbox SoT.)
- Consumer crash / transient delivery / poison / DLQ / replay / lease fencing — ALL inherited from 5b UNCHANGED
  (session events are just more event_outbox rows; the consumer is event-type-agnostic).
- Migrate→deploy gap (NULL session_id) — handled by COALESCE at emission + rotation NULL-heal (section 4).

--------------------------------------------------------------------------------
## 11. Retry / timeout (high-risk addendum)
--------------------------------------------------------------------------------

5d introduces NO new external call and NO new long-running path. Emission is part of each endpoint's existing D1
batch (D1's own statement timeout applies; the multi-family batch is bounded by the small # of active families per
device). All retry / backoff / lease / max-attempts / crash-sweep behavior lives in the UNCHANGED 5b consumer.
Post-commit auditDomainEventEmitted is best-effort (safeUserAudit swallow-on-failure).

--------------------------------------------------------------------------------
## 12. Security (high-risk addendum + baseline)
--------------------------------------------------------------------------------

- Authz UNCHANGED at every wired site: auth/logout.ts (no-auth-by-design, idempotent), auth/devices/logout.ts
  (requireAuth, self only), admin/revoke.ts mode=device (requireRole('admin') + actorOutranksTarget + self-target
  guard + isKnownRole). 5d adds NO endpoint, NO scope, NO route.
- sub is SERVER-resolved (self sub / admin's validated targetId / token row's user_id), NEVER client-supplied.
  ref is the server-side immutable session_id (or 'legacy_'||id), NEVER client-supplied.
- tenant_id = null (session-scoped, per contract). actorSub = server-resolved or null (system).
- PII/redaction: streamKey = session:<numeric sub>:device:<uuid|legacy_n> — NO email, low PII; audit hashes it to
  stream_key_hash regardless (uniform B4). Raw streamKey/data live ONLY in access-controlled event_outbox /
  event_deny_state columns. No raw streamKey in any audit/alert.
- No external egress → no SSRF. eventId UNIQUE + (stream_key,stream_seq) UNIQUE inherited from 0051.
- session_id is a RANDOM uuid (crypto.randomUUID) — not guessable, not enumerable; it is NOT a secret (it only
  names a deny subject) but is hashed in audit anyway.
- admin/revoke.ts mode=device: the P1-15 hash-chain admin_audit_log write STILL precedes the mutation (unchanged,
  like 5c's ban) — the deny-state emit batch replaces only the single revoke UPDATE; appendAuditLog ordering is
  untouched, and on a rare all-0-row enumeration the pre-batch hash-chain row records a revoke ATTEMPT (true).

--------------------------------------------------------------------------------
## 13. Observability
--------------------------------------------------------------------------------

- Reuse `domain.event.emitted` (TELEMETRY, already registered) post-commit at each site. NO new audit type →
  audit-policy registry size UNCHANGED (assert it = 206 as a guard).
- 5b consumer's domain.event.delivered/.retry/.dlq/.consumer_run already cover session events with no change.
- Multi-family emit: audit ONCE PER applied family (skip 0-row CAS families) so the emitted-count matches the
  revoked-family-count for revocation-propagation-lag observability.

--------------------------------------------------------------------------------
## 14. Test plan
--------------------------------------------------------------------------------

5d-1 (schema + write surface):
  - migration round-trip: 0052 up adds session_id + backfills 'legacy_'||id; DOWN drops index then column
    (assert the round-trip; if remote D1 rejects DROP COLUMN, record as one-way + adjust the test). UPDATE the
    migrations.test table/column SNAPSHOT for the new refresh_tokens.session_id column + idx_refresh_tokens_session.
  - write-surface: for EACH of the 7 login paths, a successful login writes a NON-NULL session_id (one focused
    assertion per path, reusing each path's existing happy-path test).
  - rotation PRESERVES: login → refresh → assert the new row's session_id == the original (and token_hash differs);
    a NULL-session_id row (simulated gap) → refresh → assert it is HEALED to a non-null id.

5d-2 (emission):
  BUILDER unit tests (injectable meta → deterministic eventId/occurredAt):
   - shape/streamKey: emitSessionRevoked produces an outbox row that reconstructs to a valid DomainEvent;
     streamKey == deriveStreamKey == session:<sub>:device:<ref>; tenant_id NULL; data=={sub,scope:'device',ref}.
   - atomicity-at-the-builder-seam: pre-seed a duplicate event_id, run db.batch([<single-row stub>,
     ...emit.statements]) → UNIQUE violation rolls back the whole batch (5a/5c pattern).
  ENDPOINT integration tests (real local D1, real db.batch, assert by ROW COUNTS):
   - single-family (auth/logout.ts): logout a live session → EXACTLY ONE session.revoked outbox row (streamKey
     session:<sub>:device:<session_id>, seq 1, tenant NULL, data.ref==that session_id); logout an
     already-revoked/absent token → NO outbox row, still 200 (idempotent).
   - multi-family (devices/logout.ts + admin mode=device): seed TWO logins on one device (two families, two
     session_ids; AND a web/device_uuid=NULL variant) → revoke device → EXACTLY TWO session.revoked rows with
     DISTINCT streamKeys, each seq 1 on its own stream; all matching refresh_tokens revoked.
   - CONCURRENT double-revoke of the same device → each family emits EXACTLY ONCE (per-family CAS 0-rows the loser);
     assert outbox row count == family count, each stream last_seq == 1, refresh_tokens finally all revoked.
   - whole-user NEGATIVE: admin mode=user + a ban → assert ZERO session.revoked outbox rows (token-epoch ≠ deny).
   - contiguity THROUGH the real 5b consumer: emit → run consumer → event_deny_state for each session streamKey
     denied=1, last_applied_seq=1 (proves session events need NO consumer change).
   - re-login clean: revoke a family (denied=1) → simulate a re-login (new session_id) → its NEW streamKey has NO
     projection row (would be denied=0) — locks the contract's "re-login never permanently denied".
   - post-commit audit: domain.event.emitted fires once per applied family (redacted stream_key_hash, NEVER raw),
     zero on a no-op.
   - contract: every emitted row passes validateDomainEvent; streamKey==deriveStreamKey.
  SPIKE receipts (SP1-SP5, local+remote) attached to the 5d-2 PR body (5a/5b discipline).

--------------------------------------------------------------------------------
## 15. Deploy / migration discipline
--------------------------------------------------------------------------------

- 5d-1 is a SCHEMA phase: `wrangler d1 migrations apply chiyigo_db --remote` (0052) BEFORE merge/deploy; verify the
  session_id column + backfill on remote; THEN merge (migration-before-deploy 鐵律).
- 5d-2 is CODE-ONLY (0052 already applied in 5d-1).
- credential-free prod smoke each phase: homepage 200; the wired endpoints → 401/403 without auth (no state change).
  Positive smoke (a real login→revoke→outbox→consumer→deny round-trip) follows the owner-waiver pattern
  (PR2-5c) — exercised fully by the local integration suite; positive prod smoke deferred.
- Branch pr5d-session-revoked (or pr5d-1-* / pr5d-2-* if phased); double-gate each (plan→Codex; code→Codex);
  squash-merge after Approve; never push main.

--------------------------------------------------------------------------------
## 16. Commit / phasing plan — D5
--------------------------------------------------------------------------------

RECOMMENDED (phased):
  5d-1 PR (schema + write surface):
    c1 this plan doc (Gate-1 checkpoint).  --- after Codex Gate-1 Approve ---
    c2 migration 0052 + migrations.test round-trip.
    c3 wire session_id into the 7 login INSERTs + rotation preserve/heal + per-path write tests.
  5d-2 PR (emission + spike):  [after 5d-1 ships + bakes]
    c1 the multi-family SPIKE receipts (throwaway, recorded in the PR body; the spike code is not committed).
    c2 emitSessionRevoked builder + builder unit tests.
    c3 auth/logout.ts single-family wire + tests.
    c4 devices/logout.ts + admin mode=device multi-family wire + tests. (device_mismatch is DEFERRED — D6 ruling.)
  5d-3 PR (jti-scope): only if D3=(B) — DEFERRED by the D3 ruling.
ALTERNATIVE: one combined 5d PR (c1 plan, c2 migration, c3 write-surface, c4 builder+spike, c5 single-family,
  c6 multi-family). Larger Tier-0 diff in one review; recommend phased.

--------------------------------------------------------------------------------
## 17. Baseline conflicts / tech-debt surfaced (proactive)
--------------------------------------------------------------------------------

- The wired revoke endpoints are ROUTE handlers operating D1 directly (pre-existing "Route 不直接操作 DB" deviation,
  same as 5c's ban/unban). 5d does NOT refactor them (extracting a session-revoke domain util enlarges a Tier-0
  auth diff — first-do-no-harm); the emit BUILDER is the unit-test seam, endpoints are integration-tested. Tracked
  as a possible future "session-revoke domain util", NOT 5d scope.
- Coupling revoke success to emit success (section 10): auth/logout.ts/devices/logout.ts move from best-effort
  revoke to atomic revoke+emit. Deliberate (no silent "revoked-not-emitted" gap on a security path); flagged.
- 5d-1 ships a column nothing emits from yet (dead until 5d-2). NOT debt — it is the Expand+Migrate stage of a
  documented expand/migrate/contract; 5d-1 tests prove it populates, so it is not untested dead code.
- session_id as an access-token CLAIM (for real RP matching) is explicitly OUT of scope (future shared-JWT-contract
  PR). 5d only populates the INTERNAL projection with a correct per-login ref.
- DROP COLUMN rollback support on remote D1 is VERIFY-at-coding (section 3) — not assumed.

--------------------------------------------------------------------------------
## 18. Reused assets (do not reinvent)
--------------------------------------------------------------------------------

- domain-events.ts (FROZEN) — session.revoked taxonomy + streamKey deriver (session:<sub>:<scope>:<ref>) +
  SESSION_SCOPES{device,jti} + DENY_EFFECT.
- domain-event-emit.ts seqUpsert / outboxInsert / deriveStreamKeyValidated / emitResult — reused verbatim;
  emitSessionRevoked is a new BOUND-data builder beside emitAccountDisabled.
- The members.ts/ban.ts `[mutation, ...emit.statements]` db.batch + `if changes===1` applied pattern — extended to
  N families (Mechanism B).
- user-audit.ts auditDomainEventEmitted — post-commit redacted emitted audit, reused as-is.
- migration 0051 — already has session.revoked in the event_type CHECK + the deny-state machinery.
- refresh.ts carried-field pattern (auth_time/scope/issued_aud preserved on rotation) — session_id joins it.
- The 5a spike harness + remote throwaway-D1 method — reused for the multi-family spike.

--------------------------------------------------------------------------------
## 19. Open questions for Codex Gate-1
--------------------------------------------------------------------------------

(Beyond the owner decisions in section 0, which Codex should also sanity-check.)
Q1. Mechanism B correctness — is decomposing the multi-row revoke into N single-row CAS triples (vs the contract's
    single multi-row UPDATE) acceptable given the pre-read→batch race delta AND the N-overflow ceiling (section 7 +
    7.1), and is the spike battery (SP1-SP6, incl. the chunking ceiling K) sufficient to clear it before code?
Q2. Coupling revoke success to emit success via one atomic batch (section 10) — correct for a security path, or
    should revocation stay independent of emission (which would reintroduce a revoked-not-emitted gap)?
Q3. session_id IMMUTABLE-pre-read as authoritative (vs SQL-derived) — agree this is safe because session_id is
    never rewritten, so streamKey stays bound? (section 2/6)
Q4. 0052 DROP COLUMN rollback on remote D1 — accept "verify at coding, fall back to PR-listed one-way expand if
    rejected", or require a confirmed reversible down before Gate-1 Approve? (section 3)
Q5. Phasing (D5) + the deferred device_mismatch site (D6) + jti deferral (D3) — agree with the recommended cuts?

--------------------------------------------------------------------------------
## 20. Owner Gate-1 rulings (RESOLVED 2026-06-03)
--------------------------------------------------------------------------------

Owner reviewed against the production-SaaS gate: 1/1/1/1 + two refinements. Folded into section 0:
- D1 = (A) new column refresh_tokens.session_id (UUID), DESIGNED as the forerunner of a future login_sessions.id
  (don't build the table now; keep the upgrade path open).
- D2 = (A) legacy backfill + COALESCE, BUT delimiter-safe `legacy_<id>` (underscore) — ref must never contain `:`
  so the 3-colon streamKey stays cleanly splittable (the contract does not sanction a colon in ref).
- D3 = (A) device-scope ONLY in 5d; jti deferred (no sub guessing).
- D4 = Mechanism B (per-family single-row CAS, reuse changes()=1) + chunk + spike-gated (SP1-SP6; disproof → stop).
- D5 = phased 5d-1 (schema+write) / 5d-2 (emission+spike) / 5d-3 (jti if needed).
- D6 = 5d-2 wires auth/logout.ts + auth/devices/logout.ts + admin mode=device; DEFER device_mismatch + mode=jti;
  NEVER mode=user.

NEXT: formal Codex Gate-1 review of this plan → on Approve, code 5d-1 (migration 0052 + write surface, no emit).

--- END PR5 5d GATE-1 PLAN (R1, owner-approved 2026-06-03) ---
