# PR5 5d-3 — session.revoked `scope='jti'` EMISSION — Gate-1 Plan

- Created: 2026-06-04
- Status: Gate-1 plan only (NO code, NO spike yet). This phase has ONE blocking Open Decision (§1, the jti→sub
  source) that MUST be ruled by the owner before any emission code is written — there is currently NO server-side
  call site that supplies BOTH a session `sub` AND a jti, so `session:<sub>:jti:<ref>` cannot be formed correctly
  today. The body below is written around a RECOMMENDED ruling, clearly marked and cheap to revise pre-code.
- Predecessor: PR5 5d-1 (schema) + 5d-2 (device-scope emission) SHIPPED (PR #15 → `819008c`, PR #16 → `c6c3b4c`).
  `scope='device'` is live; this phase adds the SECOND (and final) bounded scope, `jti`, which the FROZEN contract
  already enumerates. 5d-3 invents NO taxonomy / envelope / ordering.
- Frozen contract: functions/utils/domain-events.ts (FROZEN by PR4). `session.revoked` already supports
  `scope ∈ {device, jti}` (SESSION_SCOPES), streamKey `session:<sub>:<scope>:<ref>`, `required {sub, scope, ref}`,
  DENY_EFFECT='deny'. Migration 0051's event_type CHECK already includes session.revoked. So 5d-3 is the
  CONTRACT-completing emission for a scope the contract was built to carry.
- Workgrade: L3 + HIGH-RISK ADDENDUM (Distributed State / deny-state projection on a Tier-0 revocation path). The
  blast radius is NARROW vs 5d-2: jti is a SINGLE token → a SINGLE streamKey → NO multi-family / NO chunk / NO
  casByFamily / NO COUNT preflight. The risk concentrates entirely in §1 (the subject) and §5 (one new gating shape).
- Constraints: $0 (Cloudflare free tier only), no CF Queues / Durable Objects, no vendor lock-in, Tier-0 baseline.
  CODE-ONLY (no migration: 0051 has the event_type; 0016 has revoked_jti; no schema is needed for the recommended
  rulings; option (b) in §1 WOULD need a migration and is disrecommended partly for that reason).

--------------------------------------------------------------------------------
## 0. OWNER LOCKS / carryover non-negotiables (must hold)
--------------------------------------------------------------------------------

L1. **NO guessing the sub from an opaque jti.** The streamKey subject must be SERVER-AUTHORITATIVE (verified or
    deliberately owner-accepted as caller-asserted), never inferred. "Rather not emit than emit a half-modeled
    subject" — the exact discipline that deferred session.revoked from 5c and jti from 5d/5d-2 (master plan D3).
L2. **Reuse the FROZEN contract + existing primitives.** scope='jti' is already legal; reuse
    deriveStreamKeyValidated / seqUpsert / outboxInsert verbatim; the 5b consumer is event-type-agnostic and
    DENY_EFFECT['session.revoked']='deny' already covers it → ZERO consumer change, NO new domain.event.* type.
    Reuse the EXISTING `admin.token.revoked.jti` (critical) + `session.integrity_violation` (critical) audit types
    → audit-policy registry STAYS 207 (assert as a guard). No taxonomy/envelope reinvention.
L3. **Preserve the colon-free `ref` guard.** emitSessionRevoked already throws on a colon/blank ref (the
    delimiter-safety invariant so `session:<sub>:jti:<ref>` stays cleanly 3-colon-splittable). For jti-scope the
    `ref` IS the jti — and the jti can be CLIENT-SUPPLIED (admin body), so it MUST be validated colon-free + non-empty
    at the ENDPOINT BOUNDARY (→ 400), NOT left to the builder's throw (which would 500). Our own minted jti is a
    `crypto.randomUUID()` (jwt.ts:125) = colon-free by construction; a pasted jti is untrusted input.
L4. **device-scope revocation LOGIC (5d-2 live) is UNCHANGED.** casByFamily, revokeSessionFamilies' enumeration /
    GLOBAL COUNT preflight / chunk / forward-progress, refresh.ts rotation, the COUNT!=1 SESSION_INTEGRITY_VIOLATION
    path — NO logic change. CAVEAT (reconciled with §4.1): if the owner picks the scope-PARAMETER builder (§4.1-i),
    the ONLY device-path touch is a literal `scope:'device'` argument added at the 2 existing call locations
    (auth/logout.ts directly + emitSessionRevoked inside session-revoke.ts) — a type-checked, NO-logic-change edit.
    The sibling-builder option (§4.1-ii) leaves the device path byte-for-byte untouched. Either way, no device
    REVOCATION behavior changes.
L5. **`mode=user` (token_version) NEVER emits; refresh.ts `device_mismatch` STAYS deferred.** Unchanged from 5d/5d-2.
L6. **Spike before any new SQL/CAS/emit shape.** §5 introduces ONE new gating shape (emit gated on a
    `revoked_jti` INSERT OR IGNORE's changes()=1 instead of a refresh_tokens UPDATE's). Per
    feedback_dont_assert_runtime_semantics_without_verify + the 5a/5d-2 spike discipline: run SP-JTI (local
    miniflare + throwaway remote D1, mirror 5d-2 §2) BEFORE wiring; if disproven → STOP + report, do NOT code on
    unproven D1 semantics. (Only relevant if §1 is ruled toward delivery.)

--------------------------------------------------------------------------------
## 1. THE BLOCKING OPEN DECISION — where does the jti's `sub` come from? (OWNER must rule)
--------------------------------------------------------------------------------

**The hard finding (verified against real code 2026-06-04, §3):** `session.revoked` requires
`streamKey = session:<sub>:jti:<ref>`, i.e. it needs the SESSION OWNER'S `sub`. But the ONLY call site that
revokes a real *session access token's* jti is `admin/revoke.ts mode='jti'` (revoke.ts:64-88), and it receives a
**bare opaque jti string with NO user resolution** — it even writes its hash-chain audit with `target_id: 0`. The
`revoked_jti` table (migration 0016) is `{jti PK, expires_at, revoked_at}` — there is **NO jti→user mapping**
anywhere, and access JWTs are stateless (the `sub` lives only inside the token the admin does not hold). The other
jti callers (`auth.ts` step-up consume, `oauth/bind-email.ts`, `change-password.ts`) operate on **one-time
elevation / bind tokens, NOT session access tokens** — they are nonce-burns, not session revocations, and must
never emit session.revoked. So **there is no existing path that holds both a session `sub` and a jti at once.**

This is a genuine design fork, not a coding detail. The options (prose for owner ruling per
feedback_gate1_forks_prose_ruling — do NOT collapse into a checkbox):

**(a1) Admin supplies `user_id` alongside the jti → caller-ASSERTED, UNVERIFIED sub.**
  `mode=jti` gains an (optional or required) `user_id`; emit `session:<user_id>:jti:<jti>` when present.
  - Pro: minimal, additive API; delivers jti-scope now.
  - Con (Tier-0 correctness): we have NO way to verify that `user_id` actually owns a token bearing that jti
    (no jti→user store, stateless JWT). A typo or a malicious/confused admin writes a DENY into the WRONG user's
    durable session stream — the precise "known-wrong semantic baked into a projection a future RP reads"
    anti-pattern that 5d was created to AVOID. The token's actual enforcement (the `revoked_jti` blacklist, checked
    by isJtiRevoked) is correct regardless of sub, so the wrong-sub damage is INVISIBLE today and only surfaces
    when an RP finally consumes the projection — the worst kind of latent bug. **Recommend AGAINST a1.**

**(a2) Admin supplies the full ACCESS TOKEN (not a bare jti) → server VERIFIES it → cryptographically-bound sub.**
  The endpoint accepts a token, runs `verifyJwt` (signature + exp), and extracts BOTH `payload.jti` AND
  `payload.sub` from the SAME verified token → the sub is system-verified, bound to the jti by the signature. Then
  revoke + emit `session:<sub>:jti:<jti>`.
  - Pro: a VERIFIED sub with NO new storage and NO hot-path cost — it closes a1's integrity hole cleanly. This is
    the structurally-correct producer for jti-scope.
  - Con: the admin must hold a STILL-VALID token (verifyJwt rejects an expired one). BUT note: revoking an
    already-expired token is a near-no-op (its own `exp` already blocks it), so the useful revoke window (token
    still live, ≤15 min) is exactly when a2 works. It is an additive API shape (accept token OR jti; only the
    token form emits). **This is the recommended mechanism IF the owner wants jti-scope delivered in 5d-3.**

**(b) Persist a jti→sub map at mint time → look up the verified sub on revoke.**
  Write `(jti, sub, exp)` to D1 whenever an access token is signed; `mode=jti` looks up the sub.
  - Pro: verified sub even for a bare-jti revoke.
  - Con: a D1 WRITE on EVERY access-token mint (every login + every 15-min refresh rotation) — massive hot-path
    write amplification + storage, for a table read only on a rare admin action. New migration (breaks code-only).
    Worst cost/value ratio; violates "measure first / no premature". **Recommend AGAINST b.**

**(c) DEFER jti-scope again — do NOT wire emission; keep `scope='jti'` a reserved-but-dormant contract slot.**
  5d-3 closes as a decision record: jti-scope's correct producer (a sub-bearing revoke) AND its consumer (an RP
  reading the deny-state projection) BOTH do not exist yet; emitting now means either an unverified subject (a1) or
  a costly map (b) for rows nothing reads. Its natural future home is the deferred **OIDC backchannel logout / RP
  logout** path (revocation.ts's own header names these), where a logout token carries `sub`/`sid` AND an RP
  consumes the projection — sub + jti + consumer all arrive together.
  - Pro: principled, $0, zero risk, consistent with the 5c→5d and 5d→5d-2 deferrals. The enforcement path
    (`revoked_jti` blacklist) is ALREADY complete and correct without the event.
  - Con: 5d-3 delivers no new runtime behavior; scope='jti' stays a forward-compat slot.

**A non-option (named to reject it):** keying on a sentinel sub (e.g. `session:unknown:jti:<jti>`) when the sub is
absent — this pollutes the streamKey namespace with un-attributable denies a future RP can't match to a user.
Strictly worse than not emitting. Rejected.

### RECOMMENDATION
**(c) DEFER**, for these reasons, in priority order:
1. **No consumer.** No RP reads the deny-state projection yet (RP pull API deferred, owner-LOCKED 2026-06-02). Unlike
   device-scope — which had a forcing function (the per-login `session_id` had to be built into the whole login
   fleet regardless, and device revoke is a common everyday operation) — jti-scope has NO forcing function.
2. **Enforcement is already complete.** A revoked jti is already blocked by the `revoked_jti` blacklist
   (isJtiRevoked, KV + D1). The session.revoked(jti) event adds NOTHING to enforcement; it is pure future-RP signal.
3. **The only correct producer needs an API change anyway (a2).** So "doing it now" is not free — it is an
   additive admin API surface for a signal nothing consumes.

**IF the owner overrides toward delivering jti-scope in 5d-3, the correct mechanism is (a2) — the verified full
token — NOT a1 (unverified sub) and NOT b (hot-path map).** Sections 4-9 below are written for the (a2) path and
are SKIPPED entirely if the ruling is (c).

**Codex Gate-1 (2026-06-04): R1 = APPROVE for (c) / REJECT for (a2)-as-written (3 blockers); R2 = folded plan
APPROVED, no new blocking findings** (token-class validation, mandatory rank guard, validate-before-coerce folded —
§4.4 + §20). (c) is approved outright; (a2)'s folded plan is APPROVABLE conditional on the owner choosing (a2) +
running SP-JTI before code. The extra (a2) validation surface REINFORCES the (c) recommendation.

--------------------------------------------------------------------------------
## 2. Scope and non-goals
--------------------------------------------------------------------------------

IN SCOPE (only if §1 is ruled (a2); under (c), 5d-3 is a decision-record commit + close):
- Parameterize `scope` in the session.revoked emitter (or add a jti sibling builder) so it can emit
  `scope='jti'`, keeping the colon-free ref guard.
- Accept a full access token at `admin/revoke.ts mode='jti'` (additive; bare jti remains accepted but does NOT
  emit), verify it, VALIDATE the token CLASS (§4.4 — regular session access token only), then extract sub+jti,
  revoke + emit one session.revoked(jti) gated on the `revoked_jti` insert.
- §4.4 regular-session-token + active-user + token-version + RANK validation (Codex R1 High#1/#2 + Medium) — REQUIRED.
- The one new gating shape (emit gated on `revoked_jti` INSERT OR IGNORE changes()=1) + its spike (§5).
- Post-commit best-effort `domain.event.emitted` audit (reuse, redacted). Boundary jti validation.
- Tests at every layer (§9).

NON-GOALS (explicit, to bound blast radius):
- NO change to device-scope (5d-2) — see L4.
- NO `mode=user` / token_version emission; NO refresh.ts device_mismatch (L5).
- NO RP pull API / RP wire (sink stays the INTERNAL event_deny_state projection — owner LOCKED).
- NO jti→sub persistent store (option b rejected) → NO migration.
- NO `sid` access-token claim work (a future shared-JWT-contract PR, feedback_shared_auth_contract_isolation).
- NO consumer / projection / DLQ / replay change (event-type-agnostic; DENY_EFFECT already covers session.revoked).

--------------------------------------------------------------------------------
## 3. Current-state evidence (verified against code 2026-06-04 — do not trust memory)
--------------------------------------------------------------------------------

- **`admin/revoke.ts mode='jti'` (revoke.ts:64-88):** input is `body.jti` (trimmed string) + optional `body.exp`.
  NO user lookup; hash-chain audit records `target_id: 0, target_email: 'jti:<first 32 chars>'`. Calls
  `revokeJti(env, jti, exp)` then audits `admin.token.revoked.jti`. **Confirmed: no sub anywhere on this path.**
- **`revoked_jti` (migration 0016):** `jti TEXT PRIMARY KEY, expires_at TEXT NOT NULL, revoked_at TEXT DEFAULT now`
  + index on expires_at. **No user/sub column.** Confirmed: no jti→user mapping exists.
- **jti minting (jwt.ts:125):** `crypto.randomUUID()` → UUID (hyphens, no colons). Our jtis are colon-free by
  construction; but an admin-pasted jti is untrusted → boundary validation required (L3).
- **Access token claims:** `signJwt` (jwt.ts:122-133) signs the caller's payload (which carries `sub`) and auto-adds
  `jti`. So sub AND jti coexist INSIDE a verified token — the basis for option (a2). They do NOT coexist anywhere
  the admin-revoke endpoint can currently reach (it holds a bare string, not a token).
- **Other jti callers (NOT session tokens — must never emit):** `auth.ts` uses `isJtiRevoked` (verify-time check,
  read-only) + `consumeJtiOnce` (step-up one-time token burn); `oauth/bind-email.ts` + `change-password.ts` use the
  one-time step-up/bind token burn. These are nonce-consumption locks, not session revocations.
- **emitSessionRevoked (domain-event-emit.ts:281-295):** currently HARDCODES `scope:'device'` in BOTH the streamKey
  derive and the `json_object('sub',?,'scope','device','ref',?)`. The colon-free ref guard is at lines 287-289.
- **Frozen contract (domain-events.ts):** SESSION_SCOPES = {device, jti} (line 74); session.revoked spec requires
  {sub, scope:sessionScope, ref} (line 151); streamKey = `session:<sub>:<scope>:<ref>` (line 153). scope='jti' is
  already a first-class, validated value.
- **audit-policy:** `admin.token.revoked.jti` (line 154) + `session.integrity_violation` (line 167) already
  registered; `_registrySize === 207` (audit-policy.test.ts:281). No new type needed.
- **Consumer:** event-type-agnostic; DENY_EFFECT['session.revoked']='deny' (domain-events.ts:66). Zero change.

--------------------------------------------------------------------------------
## 4. Design IF §1 = (a2) — verified full token at mode='jti'
--------------------------------------------------------------------------------

(Skip this entire section if §1 is ruled (c).)

### 4.1 emitter change — scope parameter
Two options; recommend the first:
- **(i) RECOMMENDED — add an explicit `scope: 'device' | 'jti'` to `SessionRevokedEmitInput`** and thread it into
  both the streamKey derive and the `json_object('sub',?,'scope',?,'ref',?)` (the literal `'device'` becomes a `?`
  bind). There are exactly TWO code locations that call emitSessionRevoked today — `auth/logout.ts` (directly) and
  `session-revoke.ts` (inside revokeSessionFamilies, which serves BOTH auth/devices/logout AND admin mode=device) —
  each passes `scope:'device'` explicitly: a small, mechanical, type-checked, no-logic-change edit; the FROZEN
  validator already constrains scope to {device,jti}. Keeps ONE builder (the contract already unifies the scopes).
- (ii) a sibling `emitSessionRevokedJti` that leaves the device builder byte-for-byte untouched (first-do-no-harm on
  the just-shipped device path) at the cost of ~duplicated builder code.
  → The colon-free ref guard (L3) is preserved in EITHER case. Final choice is a code-gate detail; (i) is cleaner
  (no duplication, scope is a real contract dimension) and the type-checker + ratchet catch every call site.

### 4.2 endpoint change — `admin/revoke.ts mode='jti'`
Additive: accept EITHER a bare `jti` (today's behavior, NO emit) OR a full `access_token` (verify → emit). Sketch:

    if (mode === 'jti') {
      // accept a full token (preferred — yields a VERIFIED sub) or a bare jti (legacy — revoke only, no emit)
      const rawToken = typeof body.access_token === 'string' ? body.access_token.trim() : ''
      let sub = null, jti = '', exp
      if (rawToken) {
        // verifyJwt (jwt.ts:152-175) returns the payload DIRECTLY and THROWS on bad sig / expired / wrong issuer;
        // it verifies issuer='https://chiyigo.com' by DEFAULT (so only OUR tokens pass) — pass audience:null to be
        // aud-agnostic (a session access token may be minted for any platform app: mbti/talo/chiyigo). Signature +
        // exp + issuer ALONE do NOT prove "a regular SESSION access token" — §4.4 validates the token CLASS.
        let payload
        try { payload = await verifyJwt(rawToken, env, { audience: null }) }
        catch { return res({ error: 'access_token invalid or expired', code: 'ACCESS_TOKEN_INVALID' }, 400) }
        // VALIDATE RAW TYPES BEFORE any String()/Number() coercion (Codex R1 Medium — a missing claim must NOT become
        // the literal "undefined" in a streamKey). §4.4 does the full regular-access-token + active-user + rank gate.
        const v = await validateRegularSessionTokenForRevoke(env, payload, /*adminRole*/ user.role)
        if (v.error) return v.error                 // 400/403 — not a regular session token / unknown-or-higher target
        sub = v.sub                                 // verified numeric-string user id (the SESSION owner)
        jti = v.jti                                 // verified non-empty, colon-free jti
        exp = v.exp                                 // verified finite exp
      } else {
        jti = (typeof body.jti === 'string' ? body.jti.trim() : '')   // legacy bare-jti path (no sub -> no emit)
        exp = Number.isFinite(body.exp) ? body.exp : now + 3600
        if (!jti) return res({ error: 'jti is required for mode=jti', code: 'JTI_REQUIRED' }, 400)
        if (jti.includes(':')) return res({ error: 'jti malformed', code: 'JTI_MALFORMED' }, 400)   // L3 boundary
      }
      // P1-15 hash-chain audit precedes the mutation (UNCHANGED); target_id = sub ? Number(sub) : 0.
      ...
      if (sub) {
        // VERIFIED-sub path: atomic db.batch([INSERT OR IGNORE revoked_jti, ...emitSessionRevoked(scope:'jti')]) (§5)
      } else {
        await revokeJti(env, jti, exp)   // legacy bare-jti path UNCHANGED (no emit)
      }
      // KV cache (UNCONDITIONAL best-effort) + admin.token.revoked.jti audit (UNCHANGED); post-commit
      // domain.event.emitted ONLY when an event was emitted (changes()=1).
    }

- sub is SERVER-VERIFIED (from the signature-checked token), NEVER client-asserted (this is why a2, not a1).
- ref = the verified jti (colon-free by our minting; re-validated at the boundary for defense in depth).
- actorSub = the admin's sub (the actor performing the revoke); the session OWNER is the token's sub.
- The P1-15 hash-chain audit still precedes the mutation (unchanged ordering, like 5c ban / 5d-2 admin device).

### 4.3 single token → single streamKey
jti-scope is structurally SIMPLE vs device-scope: one jti = one `revoked_jti` row = one streamKey
`session:<sub>:jti:<jti>`. NO multi-family, NO chunk, NO casByFamily, NO COUNT!=1 preflight, NO
SESSION_INTEGRITY_VIOLATION path (those exist only because a device matches MANY login families; a jti is one
token). This is why session-revoke.ts is NOT touched by 5d-3.

### 4.4 REQUIRED — regular-session-token + active-user + rank validation (Codex Gate-1 R1 High#1/#2 + Medium)
**The trap (Codex R1 High#1):** `verifyJwt` proves only "a signed, unexpired, chiyigo-issued JWT" — it does NOT
prove "a regular SESSION access token". The platform signs SEVERAL token classes with the same key that ALSO carry
sub (+ often jti): `pre_auth` (pre-2FA, scope='pre_auth'), step-up `elevated:*` (scope contains an elevated scope),
`temp_bind` (OAuth email-bind, scope='temp_bind', **sub = the provider id, NOT a user id** — callback.ts:162-167),
and the **OIDC id_token** (token.ts:208 — aud=client_id, claims sub/email/nonce, **NO `scope` claim, NO `ver`**).
Accepting any of these would emit a durable `session.revoked(jti)` for a NON-session token (wrong/garbage subject).

**The fix — reuse the codebase's EXISTING "regular access token" predicate, do NOT invent a new taxonomy.**
`functions/utils/auth.ts:298` already has `requireRegularAccessToken`, whose docstring describes this EXACT threat
("tenant 解析路徑必須只接受『一般 access token』…非登入完成 / 高權限一次性 token 可能滲進"). It rejects pre_auth /
temp_bind / any `elevated:*` (via isElevatedScope) + requires a positive-int sub. 5d-3 adds a pure payload-level
sibling that applies the SAME predicate to the body token (requireRegularAccessToken is header-based; we have a
verified payload), plus the id_token exclusion + the requireAuth-level liveness checks + the rank guard:

    validateRegularSessionTokenForRevoke(env, payload, adminRole) -> { sub, jti, exp } | { error: Response }
      // 1. RAW-TYPE gate BEFORE coercion (Codex R1 Medium):
      if (!Number.isFinite(payload.exp)) -> 400 ACCESS_TOKEN_INVALID
      if (typeof payload.jti !== 'string' || payload.jti.length === 0 || payload.jti.includes(':')) -> 400 JTI_MALFORMED
      const scope = typeof payload.scope === 'string' ? payload.scope : ''
      // 2. TOKEN-CLASS gate = the requireRegularAccessToken predicate + "modern access token" positive check (High#1):
      if (scope === '') -> 400 NOT_A_REGULAR_TOKEN          // NOT SAFELY CLASSIFIABLE as a modern regular access token
                                                            // (fail-closed: rejects id_tokens AND any legacy/no-scope
                                                            //  token — broader than "id_token only" ON PURPOSE; Codex R2)
      if (scope === 'pre_auth' || scope === 'temp_bind') -> 400 NOT_A_REGULAR_TOKEN
      if (scope.split(/\s+/).filter(Boolean).some(isElevatedScope)) -> 400 NOT_A_REGULAR_TOKEN   // step-up
      const userId = Number(payload.sub)
      if (!Number.isInteger(userId) || userId <= 0) -> 400 INVALID_SUBJECT     // temp_bind provider-id / id_token edge
      // 3. ACTIVE-USER + token-version (mirror requireAuth:79-92 + step-up P2-4) — ONE users lookup, fail closed:
      const row = SELECT role, status, token_version FROM users WHERE id=? AND deleted_at IS NULL  (userId)
      if (!row) -> 404 USER_NOT_FOUND
      if (row.status === 'banned') -> still revocable, but it is a known-target (no special-case needed; rank guard below)
      if ((Number.isFinite(payload.ver) ? payload.ver : 0) < (row.token_version ?? 0)) -> 400 TOKEN_STALE   // already globally revoked
      // 4. RANK guard = mode=user/device parity (Codex R1 High#2, revoke.ts:104-114) — NON-OPTIONAL:
      if (!isKnownRole(row.role)) -> 403 UNKNOWN_TARGET_ROLE   (+ critical admin.unknown_role_target audit)
      if (!actorOutranksTarget(adminRole, row.role)) -> 403 CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE
      // (self-target: revoking ONE of your own access tokens is not a lockout -> no self guard needed, unlike mode=user/device)
      return { sub: String(userId), jti: payload.jti, exp: Number(payload.exp) }

- **Reuse, not reinvention:** the class predicate is byte-identical to requireRegularAccessToken (scope checks +
  positive-int sub); the liveness checks mirror requireAuth/requireStepUp; the rank guard mirrors revoke.ts
  mode=user/device. RECOMMEND extracting a shared pure `isRegularAccessTokenPayload(payload)` that BOTH
  requireRegularAccessToken and this path call (behaviour-preserving extraction, locked by requireRegularAccessToken's
  existing tests) so the two can never drift; FALLBACK = inline-mirror with a regression test asserting parity. Decide
  at code-gate (first-do-no-harm: only extract if the existing tests fully cover the extracted predicate).
- **id_token exclusion** is the `scope === ''` reject (our id_tokens have no scope claim, token.ts:184) — a positive
  "must be a real access scope" check, not a fragile blocklist of id_token claims. Codex R2 NON-BLOCKING: this is
  slightly BROADER than "id_token only" — it also rejects any legacy/no-scope access token. That is fail-closed and
  acceptable for (a2); code comments + tests MUST phrase it as "not safely classifiable as a modern regular access
  token", NOT only "id_token", so the intent is not misread as id-token-specific.
- This is why §1's RECOMMENDATION is (c): even (a2)'s "minimal" path is a real Tier-0 validation surface (token-class
  + active-user + token-version + rank) for a signal no RP consumes yet.

--------------------------------------------------------------------------------
## 5. The one new gating shape + SP-JTI spike (gating artifact; IF (a2))
--------------------------------------------------------------------------------

(Skip if §1 is ruled (c).)

To make emit fire EXACTLY when this request is the one that revokes the jti (and never on a re-revoke), the emit
must be gated on the `revoked_jti` INSERT's changes()=1 — a NEW gating shape (5a/5d-2 proved changes()-chaining
after an `UPDATE … WHERE` and an `INSERT…SELECT…WHERE changes()`; here the gating mutation is an
`INSERT OR IGNORE`, whose IGNORE/CONFLICT branch must yield changes()=0 to the following batch statement):

    db.batch([
      db.prepare(`INSERT OR IGNORE INTO revoked_jti (jti, expires_at) VALUES (?, ?)`).bind(jti, expiresAt),  // gating
      ...emitSessionRevoked(db, { sub, ref: jti, scope: 'jti', actorSub: adminSub }, freshMeta()).statements, // seq+outbox WHERE changes()=1
    ])
    // emit ⟺ this request first-revoked the jti (changes()=1). A re-revoke = IGNORE = changes()=0 = no seq, no outbox.

This is a one-way deny at seq 1 per jti streamKey (a jti is revoked once; re-revoke is idempotent). The KV
positive-cache put moves to AFTER the batch and stays UNCONDITIONAL best-effort (NOT gated on changes() — it warms
the hot-path cache even on a re-revoke where the D1 row pre-existed, exactly as today's revokeJti does); only the
EMIT is gated on changes()=1. The existing `admin.token.revoked.jti` audit also moves to after the batch (best-
effort), mirroring 5d-2 c2/c4. Whether the
INSERT OR IGNORE is inlined in the endpoint (mirror 5c ban/unban inline wiring) or `revokeJti` is refactored to
return splice-able statements is a code-gate detail — RECOMMEND inline (revokeJti's only real-revoke caller is this
endpoint; keep the shared util's signature untouched; KV stays its post-batch best-effort responsibility).

We KNOW `.run().meta.changes` reflects INSERT OR IGNORE correctly (consumeJtiOnce already relies on it,
revocation.ts:110). What is UNPROVEN is the in-SQL `changes()` FUNCTION chaining to the next batch statement after
an INSERT OR IGNORE conflict — analogous to, but not identical to, the proven UPDATE-CAS chaining. So:

**SP-JTI (mandatory before wiring; mirror the 5d-2 §2 method — local miniflare + a throwaway remote D1, created →
verified → dropped, $0, never touching prod chiyigo_db):**
- SP-JTI-1 (first-revoke emits): `batch([INSERT OR IGNORE revoked_jti(<fresh jti>), seqUpsert(sk), outboxInsert(sk)])`
  → assert EXACTLY ONE outbox row (streamKey `session:<sub>:jti:<jti>`, seq 1, tenant NULL, data {sub,scope:'jti',ref}),
  AND the revoked_jti row exists.
- SP-JTI-2 (re-revoke = no-leak): pre-insert the jti, then run the same batch → assert ZERO outbox row + ZERO seq
  bump (the IGNORE branch yields changes()=0 → the gated seq/outbox add nothing). This is the idempotency guarantee.
- SP-JTI-3 (atomicity): force a UNIQUE(event_id) violation in the outbox insert → assert the WHOLE batch rolls back
  (no revoked_jti row, no seq, no outbox) — both-or-neither, so a failed emit never leaves a half-revoked jti.
- SP-JTI-4 (remote parity): re-run 1-3 on the throwaway remote D1 (multi-stmt command = one batch txn) → identical.

DISPROOF PROTOCOL (L6): if SP-JTI-1/2/3/4 fail (changes() does NOT chain across INSERT OR IGNORE, or the IGNORE
branch leaks a seq/outbox row) → STOP, report to owner, do NOT wire emission. Fallback under disproof = revoke
stays as-is (the bare-jti path, no emit) and jti-scope reverts to DEFER (c). Receipts attached to the PR body
(5a/5d-2 discipline).

--------------------------------------------------------------------------------
## 6. Failure model + idempotency (high-risk addendum; IF (a2))
--------------------------------------------------------------------------------

- N=1 single batch ALWAYS: any error → whole batch rolls back → NO jti revoked, NO event, 5xx. Both-or-neither
  (SP-JTI-3). Couples revoke success to emit success on this security path (no revoked-but-unemitted gap) — same
  deliberate coupling as 5d-2 §10, and trivially safe here because it is a single statement-triple (no chunking,
  so NO partial-failure / REVOKE_INCOMPLETE / forward-progress model is needed — those were multi-family-only).
- Re-revoke (idempotent): INSERT OR IGNORE 0-row → no seq, no outbox (structural). The jti is already blacklisted;
  the user is already enforced-out. No duplicate deny event.
- Per-jti streamKey sees exactly ONE deny at seq 1 (one-way; a jti is never un-revoked) → trivially contiguous, no
  head-of-line risk, no deny/undeny interleave. The 5b consumer applies it unchanged.
- KV put failure → best-effort (the D1 `revoked_jti` row is the source of truth; isJtiRevoked falls back to D1).
- post-commit domain.event.emitted failure → best-effort (never turns a committed 200 into a 500).
- Legacy bare-jti path (no token) → behaves EXACTLY as today (revokeJti, no emit) — a pure additive overlay.

--------------------------------------------------------------------------------
## 7. Security (high-risk addendum + baseline; IF (a2))
--------------------------------------------------------------------------------

- Authz UNCHANGED: `requireRole(request, env, 'admin')` gates the whole endpoint. 5d-3 adds NO route, NO scope.
- sub is SERVER-VERIFIED from the signature-checked token (a2) — NEVER client-asserted (the whole reason a2 ⟶ a1).
  ref = the verified jti. actorSub = the admin's validated sub. tenant_id = null (session-scoped).
- **TOKEN-CLASS gate (REQUIRED, Codex R1 High#1, §4.4):** a verified signature ≠ a session access token. The token
  MUST pass the requireRegularAccessToken predicate (reject pre_auth / temp_bind / elevated:* step-up) + the
  id_token exclusion (non-empty scope) + a positive-int sub, BEFORE any revoke/emit. Otherwise a pre_auth /
  step-up / temp_bind / id_token (all signed, all carry sub) would mint a garbage-subject durable deny.
- **TOKEN-VERSION + active-user (REQUIRED, §4.4):** revalidate payload.ver ≥ users.token_version + user exists /
  not deleted (mirrors requireAuth:79-92), so a globally-revoked or deleted-user token is not re-emitted.
- **RANK guard (REQUIRED, Codex R1 High#2 — NOT an open question, §4.4):** a2 resolves the target's identity, so it
  MUST apply the same `isKnownRole` + `actorOutranksTarget` guard mode=user/device use (revoke.ts:104-114), fail
  closed on unknown role. Without it a lower admin could revoke a peer's / a higher admin's specific access token by
  pasting it = a vertical privilege-escalation gap. (Self-target needs no guard: one access-token self-revoke ≠ a
  lockout, unlike mode=user/device.)
- **Validate-before-coerce (REQUIRED, Codex R1 Medium, §4.4):** raw claim types are checked BEFORE String()/Number(),
  so a missing sub/jti can never become the literal "undefined" inside a streamKey.
- Boundary validation (L3): the jti (ref) is validated non-empty + colon-free → 400 on bad input (both the verified
  and the legacy bare-jti path), so a malformed ref can never reach the builder/streamKey (defense in depth over the
  builder's throw).
- Token handling: the pasted access_token is verified then DISCARDED; only its jti (an opaque id) + sub (a numeric
  id) are used. The streamKey `session:<numeric sub>:jti:<uuid>` carries NO email / low PII; the audit hashes it to
  stream_key_hash regardless. The RAW refresh/access token is NEVER stored in the event (data is {sub,scope,ref}
  where ref is the jti, not a token secret). No raw token in any audit/alert.
- No external egress → no SSRF. eventId UNIQUE + (stream_key, stream_seq) UNIQUE inherited from 0051.
- P1-15 hash-chain audit STILL precedes the mutation (unchanged), recording the admin's revoke attempt.
- **AUTHZ DELTA (RESOLVED → REQUIRED, Codex R1 High#2):** the rank guard is no longer an open question — it is a
  mandatory part of §4.4 (isKnownRole + actorOutranksTarget on the verified target, fail closed). The single
  `users` lookup in §4.4 serves the active-user, token-version, AND rank checks at once; the legacy bare-jti path
  stays guard-free (it resolves no target).

--------------------------------------------------------------------------------
## 8. Observability (IF (a2))
--------------------------------------------------------------------------------

- Reuse `admin.token.revoked.jti` (critical, registered) for the endpoint audit + `domain.event.emitted`
  (TELEMETRY, registered) post-commit when an event was emitted. NO new audit type → audit-policy registry STAYS
  207 (assert `_registrySize === 207` as a guard).
- 5b consumer's delivered/.retry/.dlq/.consumer_run cover the session.revoked(jti) events with no change.
- NO `session.integrity_violation` emission from this path (that fail-closed COUNT!=1 guard is multi-family-only;
  a single jti has no one-live-head invariant to break). The type stays registered (used by device-scope) but
  5d-3 never writes it.

--------------------------------------------------------------------------------
## 9. Test plan (IF (a2))
--------------------------------------------------------------------------------

BUILDER unit (tests/integration/event-outbox-emission.test.ts):
- emitSessionRevoked with scope='jti' → outbox row reconstructs to a valid DomainEvent; streamKey ==
  `session:<sub>:jti:<ref>`; data == {sub, scope:'jti', ref}; tenant NULL. scope='device' regression unchanged.
- colon/blank ref → builder throws (the L3 guard) — locked for jti refs too.
- atomicity-at-the-builder-seam: dup event_id rolls back the stub+emit batch.

ENDPOINT integration (tests/integration/admin-revoke.test.ts; real local D1, real db.batch, assert by ROW COUNTS):
- VERIFIED-TOKEN path: admin posts a valid access_token → EXACTLY ONE session.revoked(jti) outbox row (streamKey
  `session:<token.sub>:jti:<token.jti>`, seq 1, data.ref == token.jti) + the revoked_jti row exists + the
  `admin.token.revoked.jti` audit fired.
- RE-REVOKE idempotent: post the same token twice → the 2nd yields NO new outbox row (INSERT OR IGNORE 0-row), the
  jti stays revoked, response still success.
- LEGACY bare-jti path: admin posts a bare `jti` (no token) → revoked_jti row created, ZERO session.revoked outbox
  rows (no sub → no emit) — proves the additive overlay leaves the legacy path's behavior intact.
- INVALID token → 400 ACCESS_TOKEN_INVALID, no revoke, no emit. EXPIRED token → 400 (verifyJwt rejects), no emit.
- MALFORMED jti (a colon-bearing pasted bare jti) → 400 JTI_MALFORMED, no revoke, no emit (L3 boundary).
- **TOKEN-CLASS NEGATIVES (Codex R1 High#1 — each asserts NO revoke + NO outbox row):** a `pre_auth` token, a
  step-up `elevated:*` token, a `temp_bind` token (sub=provider id), and an OIDC **id_token** (no scope claim) each
  → 400 NOT_A_REGULAR_TOKEN / INVALID_SUBJECT, zero revoked_jti write, zero session.revoked rows. These are the
  core High#1 regressions — they lock that a signed-but-non-session token never mints a deny.
- **STALE token-version NEGATIVE (§4.4):** a token whose `ver` < users.token_version → 400 TOKEN_STALE, no emit.
- **RANK-GUARD NEGATIVES (Codex R1 High#2):** admin pastes a token belonging to a PEER (equal role) or a HIGHER
  role → 403 CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE, no revoke, no emit; an UNKNOWN-role target → 403
  UNKNOWN_TARGET_ROLE (+ critical audit). A strictly-lower-role target → revoke + EXACTLY ONE emit (positive).
- **DELETED-user NEGATIVE:** a token whose sub no longer exists / is soft-deleted → 404 USER_NOT_FOUND, no emit.
- authz: non-admin → 401/403, no state change.
- contiguity THROUGH the real 5b consumer: emit → run consumer → event_deny_state for `session:<sub>:jti:<jti>`
  denied=1, last_applied_seq=1 (proves jti events need NO consumer change).
- whole-token-class NEGATIVE: mode='user' + a ban → ZERO session.revoked rows (unchanged; token-epoch ≠ deny).
- post-commit audit: domain.event.emitted fires once on emit (redacted stream_key_hash, never raw), zero on the
  legacy/no-emit path; `_registrySize === 207`.
- COALESCE/format: the emitted ref equals the verified jti verbatim (no transformation).

SP-JTI receipts (SP-JTI-1..4, local + remote) attached to the PR body (5a/5d-2 discipline).

--------------------------------------------------------------------------------
## 10. Deploy / migration discipline
--------------------------------------------------------------------------------

- (a2) is CODE-ONLY — no migration (0051 has the event_type; 0016 has revoked_jti). No migration-before-deploy step.
- credential-free prod smoke: homepage 200; `POST /api/admin/revoke` (any mode) without auth → 401/403 (no state
  change). Positive smoke (a real verified-token revoke → outbox → consumer → deny round-trip) follows the
  owner-waiver pattern (PR2-5d) — exercised fully by the local integration suite; positive prod smoke deferred.
- Branch `pr5d3-jti-emission`; double-gate (this plan → owner + Codex Gate-1; then code → Codex code-gate);
  squash-merge after Approve; never push main; never --no-verify.
- (c) DEFER → 5d-3 ships only this decision-record doc (or is closed without a PR), per the owner ruling.

--------------------------------------------------------------------------------
## 11. Commit plan
--------------------------------------------------------------------------------

  c1  this plan doc (Gate-1 checkpoint).
  --- after owner rules §1 + Codex Gate-1 Approve ---
  IF (c) DEFER:
    (no further code; close 5d-3 with the decision recorded here + in memory. Optionally a one-line doc note that
     scope='jti' is reserved for a future OIDC-backchannel/RP phase.)
  IF (a2) DELIVER:
    --- run SP-JTI-1..4; if disproven STOP + report (L6) ---
    c2  emitter scope parameter (emitSessionRevoked scope:'device'|'jti') + add the literal scope:'device' arg at
        the 2 existing call locations (auth/logout.ts + session-revoke.ts) + builder unit tests (incl. scope='device'
        regression). [contract seam] (or §4.1-ii sibling builder → no device-path touch)
    c3  admin/revoke.ts mode='jti' verified-token overlay (accept access_token → verify → atomic
        [INSERT OR IGNORE revoked_jti, ...emit] gated on changes()=1; legacy bare-jti path unchanged) + boundary
        validation + endpoint tests + SP-JTI receipts in the PR body. [Tier-0 admin path — careful code-gate]
  (one PR, squash-merged; no migration.)

--------------------------------------------------------------------------------
## 12. Reused assets (do not reinvent)
--------------------------------------------------------------------------------

- domain-events.ts (FROZEN) — session.revoked taxonomy + SESSION_SCOPES{device,jti} + streamKey deriver +
  DENY_EFFECT['session.revoked']='deny'. scope='jti' is already legal.
- domain-event-emit.ts seqUpsert / outboxInsert / deriveStreamKeyValidated / emitResult + emitSessionRevoked
  (extend the scope, keep the colon-free guard) — reused verbatim.
- revocation.ts revokeJti / the INSERT OR IGNORE revoked_jti pattern + consumeJtiOnce's proven changes() semantics.
- jwt.ts verifyJwt (extract verified sub+jti for a2) — reused as-is.
- migration 0051 (session.revoked event_type) + 0016 (revoked_jti) — no new migration.
- user-audit.ts auditDomainEventEmitted (post-commit redacted) + the existing admin.token.revoked.jti /
  session.integrity_violation registered audit types — registry stays 207.
- The 5b consumer (event-type-agnostic) — ZERO change.
- The 5a/5d-2 spike harness + throwaway-remote-D1 method — reused for SP-JTI.

--------------------------------------------------------------------------------
## 13. Open questions for Codex Gate-1
--------------------------------------------------------------------------------

(Beyond §1, which Codex should sanity-check as the lead decision.)
Q1. [folded Codex R1 High#1] (a2) = verified full token + the §4.4 regular-session-token CLASS gate
    (reject pre_auth/temp_bind/elevated:*/id_token, positive-int sub) + active-user/token-version + the legacy
    bare-jti no-emit overlay — is this the right server-authoritative-sub mechanism (vs a1 / b)?
Q2. Is the new gating shape (emit gated on `revoked_jti` INSERT OR IGNORE changes()=1) sufficiently covered by
    SP-JTI-1..4 (incl. the IGNORE-branch-yields-changes()=0 case + remote parity) to clear it before code? Is an
    INSERT OR IGNORE conflict materially different from the proven UPDATE-CAS for changes()-chaining?
Q3. [Codex R2 guidance] Scope parameter (single builder, §4.1-i) vs jti sibling builder (4.1-ii) — open for owner.
    For the §4.4 predicate: extract a pure `isRegularAccessTokenPayload` ONLY IF it is tiny + covered by parity
    tests; otherwise inline-mirror + a parity regression test is acceptable (first-do-no-harm). Decide at code-gate.
Q4. [RESOLVED, Codex R2] a2's expired-token limitation is ACCEPTABLE (revoking an expired token is a near-no-op).
    Do NOT use (a1) to work around it.
Q5. Confirm 5d-3 touches NEITHER device-scope LOGIC (5d-2) NOR mode=user NOR refresh.ts (blast-radius containment;
    scope-param option i adds only a literal `scope:'device'` arg at the 2 existing call locations — §4.1 / L4).
Q6. [RESOLVED, Codex R1 High#2] The `actorOutranksTarget` rank guard is now MANDATORY in §4.4 (not optional) — a2
    resolves the target, so it enforces isKnownRole + actorOutranksTarget, fail closed, parity with mode=user/device.

--------------------------------------------------------------------------------
## 14. Owner Gate-1 rulings (to be filled at the checkpoint)
--------------------------------------------------------------------------------

- §1 (jti→sub source): __ (a1 / a2 / b / c) — PENDING owner ruling. (Codex Gate-1 R2: APPROVE for c; a2 folded-plan
  APPROVABLE conditional on owner choosing a2 + running SP-JTI before code.)
- If (a2): §4.1 builder shape (scope param vs sibling): __ ; §4.4 shared-predicate extract vs inline (Q3, Codex:
  extract only if tiny+parity-tested else inline+parity regression): __ ; Q4 expired-token limitation: ACCEPTED
  (Codex R2; do NOT fall back to a1).
- If (c): record the deferral + the reserved-slot rationale here + in memory; close 5d-3.

--------------------------------------------------------------------------------
## 20. Codex Gate-1 review record
--------------------------------------------------------------------------------

CODEX GATE-1 R1 (2026-06-04) = **APPROVE for (c) DEFER; REJECT for (a2) DELIVER as first written** — 3 blockers,
all folded into the (a2) sections (NO change to the §1 decision framing or the (c) recommendation):
- **High#1 (token class):** verifyJwt proves only "signed + unexpired + chiyigo-issued", NOT "a regular SESSION
  access token". pre_auth / step-up elevated:* / temp_bind / OIDC id_token all carry sub (+jti) and would emit a
  garbage-subject deny. FOLD → §4.4 REQUIRED: reuse the requireRegularAccessToken predicate (reject
  pre_auth/temp_bind/elevated:*) + id_token exclusion (non-empty scope) + positive-int sub + active-user +
  token-version revalidation. §9 negative tests for pre_auth/step-up/temp_bind/id_token/stale-ver/deleted-user.
- **High#2 (rank guard mandatory):** once a2 resolves the target sub, skipping the mode=user/device
  actorOutranksTarget guard is a vertical-privilege gap (revoke a peer/higher's token by pasting it). FOLD → §4.4
  REQUIRED: isKnownRole + actorOutranksTarget, fail closed; §7 upgraded from open-question to mandatory; §9
  peer/higher/unknown-role negatives. (Q6 RESOLVED.)
- **Medium (validate before coerce):** String(payload.sub)/String(payload.jti) before type-checking would let a
  missing claim become the literal "undefined" in a streamKey. FOLD → §4.2/§4.4 raw-type gate BEFORE any coercion.
Codex also affirmed: SP-JTI-1..4 is the right spike shape and remote parity IS required (INSERT OR IGNORE is
materially different enough from UPDATE-CAS); consumer/DENY_EFFECT reuse is fine; keep raw tokens out of
audit/response/log. Release decision: approve for (c); for (a2), §4.4 + the negatives are non-optional before code.

CODEX GATE-1 R2 (2026-06-04) = **NO new blocking findings — folded plan APPROVED.** Critical risk RESOLVED (§4.4 no
longer treats verifyJwt as sufficient; reuses the requireRegularAccessToken threat model; rank guard mandatory).
- NON-BLOCKING (folded above, §4.4): the `scope === ''` reject is a good fail-closed classifier but is broader than
  "id_token only" (also rejects legacy/no-scope access tokens) — acceptable; code comments + tests MUST phrase it as
  "not safely classifiable as a modern regular access token", not only "id_token".
- Q3 (folded §13): extract a pure `isRegularAccessTokenPayload` ONLY IF tiny + parity-tested; else inline-mirror +
  parity regression (first-do-no-harm). Q4 (folded §13/§14): expired-token limitation ACCEPTED; do NOT use (a1).
- SP-JTI stays the REQUIRED gate before code; local + throwaway-remote D1 parity mandatory.
RELEASE DECISION: **APPROVE Gate-1 for (c) DEFER. For (a2) DELIVER: folded plan APPROVABLE, conditional on the
owner choosing (a2), then running SP-JTI before any code.** (Codex did not run tests; plan/diff review vs current code.)

--- END PR5 5d-3 GATE-1 PLAN (jti-scope emission; §1 = jti→sub source; Codex Gate-1 R1+R2 folded, R2 APPROVED) ---
