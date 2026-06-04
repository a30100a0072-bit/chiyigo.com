# PR5 — large-N session-revoke threshold alarm — Gate-1 Plan

- Created: 2026-06-04
- Status: Gate-1 plan (NO code yet). The last residual of PR5 5d-2 (multi-family session revoke), tracked as an
  observability follow-up ("no silent cap"). Independent of any other track.
- Workgrade: **L1 + OBSERVABILITY** (adds a warn-level audit SIGNAL on an existing Tier-0 revoke path; NO change to
  revoke correctness, NO mutation, NO new control flow in the helper). High-risk-addendum is light: the path is
  Tier-0 but this change is read-only telemetry.
- Constraints: $0, Tier-0 baseline. **CODE-ONLY** — no migration, **no new audit type** (reuse the existing endpoint
  types → audit-policy registry STAYS 207), no change to `revokeSessionFamilies` revoke/chunk logic.

--------------------------------------------------------------------------------
## 1. What + why
--------------------------------------------------------------------------------

The 5d master/emission plans specify TWO DISTINCT operational signals on a multi-family revoke (pr5d-session-
revoked-plan §13 / §7.1):
- (i) PARTIAL-FAILURE — already shipped: on a chunk error mid-operation the endpoint writes its audit with
  `partial:true` + counts and returns NON-2xx `REVOKE_INCOMPLETE`. Fires on FAILURE.
- (ii) **LARGE-N THRESHOLD — NOT YET BUILT (this plan):** a warn when the number of live session families on ONE
  device exceeds an anomaly threshold. It is a DIFFERENT signal — **it fires even on FULL success** — so ops can see
  an abnormal mass-revocation (bot / abuse / a bug minting families) instead of it passing silently. "no silent cap"
  (feedback_audit / feedback_audit_classification): chunking already handles large N functionally (K=20), but a
  large N should be SURFACED, not just quietly processed.

This is the ONLY remaining PR5 5d-2 residual; building it closes the PR5 emission line to 100%.

--------------------------------------------------------------------------------
## 2. Scope / non-goals
--------------------------------------------------------------------------------

IN SCOPE — the two MULTI-family revoke endpoints only:
- `functions/api/auth/devices/logout.ts` (self device-logout)
- `functions/api/admin/revoke.ts` mode=device (admin)
Add a large-N warn signal (reusing each endpoint's EXISTING audit type) when N exceeds the threshold.

NON-GOALS / INVARIANTS:
- NO change to `revokeSessionFamilies` (session-revoke.ts) revoke/chunk/integrity logic — the count N is already
  available in the endpoint (the enumerated `candidateRefs`), so the helper's pure D1 orchestration is untouched.
  Only a sibling THRESHOLD CONSTANT is added to that file (a plain const beside SESSION_REVOKE_CHUNK_SIZE).
- NO new audit type → registry STAYS 207 (assert as a guard). Reuse `auth.devices.logout` /
  `admin.token.revoked.device` (both already fire at multiple severities today — devices/logout already fires
  info on ok AND warn on incomplete, so a warn large-N needs NO registry/severity change).
- `auth/logout.ts` (single-family, N always 1) is EXCLUDED — never large.
- NO change to revoke outcomes / HTTP responses — telemetry only.
- NO migration.

--------------------------------------------------------------------------------
## 3. Design
--------------------------------------------------------------------------------

**N = the number of DISTINCT live session families enumerated on the device** = `candidateRefs.length`, already
computed in each endpoint BEFORE calling `revokeSessionFamilies`. This is the right anomaly measure ("how many live
login families does this one device have"), available with no helper change.

**Threshold = ENV-CONFIGURABLE with a conservative default.** A named default const
`SESSION_REVOKE_LARGE_N_THRESHOLD` (proposed default **50**) in session-revoke.ts; each endpoint reads
`Number(env.SESSION_REVOKE_LARGE_N_THRESHOLD) || <default>`. Rationale:
- Distinct from K=20 (chunk size): K bounds a batch; the alarm flags an ANOMALY, so it must sit clearly ABOVE both
  the typical count (a device usually has 1-3, up to ~14 for a daily-re-login user over the 7-day TTL) AND above K,
  so it only fires on a genuine outlier (avoid alert fatigue).
- ENV-configurable because (a) we have NO production data on the real distribution yet — "don't assume a number,
  measure + tune" (feedback_dont_assert_runtime_semantics_without_verify) — so ops can adjust without a redeploy;
  (b) it makes the alarm deterministically testable (tests set a low value). Mirrors the existing EVENT_OUTBOX_*
  env knobs.
- The exact default (50) is a JUDGMENT CALL with no data → flagged for owner/Codex (§8 Q1).

**Where + how it fires (reuse existing audits; one extra computed flag):**
- Compute once per request: `const n = candidateRefs.length; const largeN = n > threshold`.
- `ok` path (the NEW coverage — fires on FULL success):
  - devices/logout: today severity `info`. → if `largeN`, severity `warn` + data `{..., large_n:true, n, threshold}`;
    else unchanged (`info`, no flag).
  - admin mode=device: today severity `critical` (stays critical — already ≥ warn). → if `largeN`, add
    `{large_n:true, n, threshold}` to the existing critical audit's data.
- `incomplete` path (already a warn/critical partial audit): also include `{large_n, n, threshold}` (cheap
  consistency — a large N that also failed partway is doubly notable). The `partial:true` flag stays distinct.
- `integrity_violation` path: UNCHANGED — that is its own critical signal; large-N is not added there (no revoke
  happened).

So ops can query `data.large_n = true` across both endpoints to find anomalous mass-revocations, on success OR
partial. No new type, no severity that the registry doesn't already see.

--------------------------------------------------------------------------------
## 4. Files
--------------------------------------------------------------------------------

- `functions/utils/session-revoke.ts`: + `export const SESSION_REVOKE_LARGE_N_THRESHOLD = 50` (a plain sibling
  const beside SESSION_REVOKE_CHUNK_SIZE; NO logic change to casByFamily / revokeSessionFamilies).
- `functions/api/auth/devices/logout.ts`: read the env-overridable threshold, compute `n`/`largeN`, add the flag +
  bump severity to `warn` on the `ok` path when `largeN`; add the flag on `incomplete`.
- `functions/api/admin/revoke.ts` (mode=device): same (add the flag; severity stays `critical`).
- `types/env.d.ts`: + `SESSION_REVOKE_LARGE_N_THRESHOLD?: string` (env vars are strings; mirror EVENT_OUTBOX_*).

--------------------------------------------------------------------------------
## 5. Observability
--------------------------------------------------------------------------------

- Reuse `auth.devices.logout` (self) + `admin.token.revoked.device` (admin); registry size UNCHANGED (=207, assert).
- New data fields: `large_n` (bool), `n` (the enumerated live-family count), `threshold` (the effective value). No
  raw refs / no PII (n is a count; the device is already HMAC-hashed in devices/logout's audit).
- Severity: devices/logout escalates info→warn on large N (matches its existing info/warn-by-disposition pattern);
  admin stays critical. The signal is the `data.large_n` flag, queryable uniformly.

--------------------------------------------------------------------------------
## 6. Test plan
--------------------------------------------------------------------------------

Tests live in `tests/integration/session-revoke-multi.test.ts` (the existing multi-family endpoint suite). Pattern
CONFIRMED feasible: that suite already mutates the cloudflare:test `env` directly (`env.EVENT_OUTBOX_* = '...'`) and
already seeds `SESSION_REVOKE_CHUNK_SIZE + 1` families, so setting `env.SESSION_REVOKE_LARGE_N_THRESHOLD = '2'` and
seeding a handful is a deterministic, cheap trigger (no 50-family seed):
- devices/logout: set `SESSION_REVOKE_LARGE_N_THRESHOLD` low (e.g. 2); seed 3 live families on one device → revoke
  → assert ok 200, the `auth.devices.logout` audit has `large_n:true, n:3, threshold:2` AND severity `warn`. Seed 1
  family (≤ threshold) → assert NO `large_n` flag + severity `info` (unchanged).
- admin mode=device: low threshold; seed N > threshold non-null-device families → admin revoke → assert the
  `admin.token.revoked.device` audit has `large_n:true, n, threshold` (severity still critical).
- DEFAULT path: no env set → threshold defaults to 50 → a normal small revoke has NO flag (assert the default is
  read + that small N never trips it).
- registry guard: `_registrySize === 207` (no new audit type).
- regression: existing devices/logout + admin-revoke + session-revoke-multi suites stay green (no behavior change to
  revoke outcomes / responses).

(How tests read audits: follow the existing audit-assertion pattern in admin-revoke / devices-logout tests — query
the audit_log row by event_type + user_id and assert the data JSON / severity.)

--------------------------------------------------------------------------------
## 7. Commit plan
--------------------------------------------------------------------------------

  c1  this plan doc (Gate-1 checkpoint).
  --- after Codex Gate-1 Approve ---
  c2  threshold const + env type + both endpoints (flag + severity) + tests. One focused commit. No migration.
  (one PR, squash-merged; base main.)

--------------------------------------------------------------------------------
## 8. Open questions for Codex Gate-1
--------------------------------------------------------------------------------

Q1. Threshold default = 50, ENV-configurable (`SESSION_REVOKE_LARGE_N_THRESHOLD`). Agree with env-configurable +
    measure/tune (no prod data yet), and is 50 a sane conservative default (well above typical ≤14 and K=20)?
Q2. N = `candidateRefs.length` (DISTINCT live families enumerated on the device) — the right anomaly measure, vs
    `result.revoked` (which excludes 0-head/concurrently-revoked refs)? candidateRefs.length is the "how many
    families did this device have" signal and needs no helper change.
Q3. Include the `large_n` flag on the `incomplete` (partial-failure) audit too, or keep it ONLY on the `ok`/success
    audit (the master plan's emphasis was "fires even on full success")? (Recommend: include on both; `partial`
    stays the distinct partial signal.)
Q4. Reusing the endpoint types with a `data.large_n` flag (no new audit type) — confirm this is the intended
    "registry UNCHANGED" approach (master plan §13), vs a dedicated `session.revoke.large_n` type.

--- END Gate-1 PLAN (PR5 large-N session-revoke threshold alarm) ---
