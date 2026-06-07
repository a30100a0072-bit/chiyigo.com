# Fork 2 — refresh-token rotation grace (Route B: audit hygiene)

Status: **Gate-1 APPROVED** (Codex, round 5, 2026-06-07) — contingent on the owner ratification below.
Owner ratification (2026-06-07): **OD1 = B** (audit hygiene, no resurrection) / `grace_orphan` = **SECURITY_SIGNAL/warn** (no downgrade, "1b") / **`REFRESH_GRACE_SECONDS = 30`**.

Base SHA at design time: `55c9550`. Work branch: `fork2-rotation-grace-orphan`.

## Problem (root cause)

Refresh-token rotation revokes the old token and inserts a successor in one atomic `db.batch`
(`functions/api/auth/refresh.ts`). If the response / `Set-Cookie` is lost **after commit** (network
black-hole, navigation cancelling the in-flight fetch), the client still holds the now-revoked old
cookie and its next refresh re-presents it. Today that records a **false token-theft signal**
(`auth.refresh.fail` / `reason_code=reuse_detected`) and logs the user out. The front-end
(#27/#29/#30) already did everything the client can; the cookie-side orphan is server-only.

## Route B (chosen): re-classify, do NOT resurrect

Recognize the benign rotation-orphan and record it as a **distinct, non-alarming security signal**
(`auth.refresh.grace_orphan`) instead of the false `reuse_detected`. **No token is issued** (status-quo
401 → clean re-login) and the genuine reuse / token-theft detection is **preserved for every other
case**. This is audit hygiene, not session resurrection (Route A — encrypted successor at rest — was
deferred as too costly for the near-zero orphan frequency).

### Binding invariant (Codex round-2 H)

> The revoked-token / grace path is **READ-ONLY w.r.t. `refresh_tokens` rows**. It may write audit +
> the rate-limit counter, but it MUST NOT mutate any `refresh_tokens` row (no family-revoke, no
> revoke, no insert). An already-revoked token can never be weaponized to kill the live successor.

`family-revoke` on a device mismatch stays **exclusively on the LIVE-token path** (unchanged).

### Accepted security-observability tradeoff (Codex round-4 M2; owner-accepted "1b")

The narrow pattern *revoked-by-rotation + same-device + live-successor + within 30s* is recorded as
`auth.refresh.grace_orphan` rather than `auth.refresh.fail/reuse_detected`. Owner chose **1b**:
`grace_orphan` is a **SECURITY_SIGNAL/warn** (same forensic tier as `reuse_detected`, NOT telemetry),
so there is **no retention downgrade** — only a distinct event type so theft analytics can exclude the
benign pattern. A theft that exactly matches the pattern is still recorded at security tier (just under
a different event type) and is granted nothing (401). `REFRESH_GRACE_SECONDS = 30` is the
classification window.

## Final flow (`functions/api/auth/refresh.ts`)

```
lookup tokenRow (SELECT now also returns successor_token_hash + a SQL-computed grace_candidate flag:
  successor_token_hash IS NOT NULL AND revoked_at > datetime('now','-30 seconds')  -- window evaluated
  SQL-side, same-format UTC comparison per feedback_sqlite_iso_datetime_compare; NEVER parse in JS)

if tokenRow.revoked_at:            # READ-ONLY re-classification, never issues a token, never mutates a row
  if grace_candidate:
    deviceBound = device_uuid set on the row
    if deviceBound and device mismatch -> auth.refresh.fail/grace_device_mismatch + 401
                                          (NO quota, NO family-revoke, NO mutation)   # round-3 device-before-rate-limit
    if deviceBound and device match:
      rate-limit (check+record)   # only the correct-device candidate spends quota (Codex round-3 accepted)
      successor-liveness SELECT (read-only):
        live    -> auth.refresh.grace_orphan (SECURITY_SIGNAL/warn) + 401   # benign rotation-orphan
        dead    -> fall through to reuse_detected
    device-null candidate          -> fall through to reuse_detected (cannot confirm same device)
  # genuine reuse: out-of-window / revoked by logout-admin-device (successor_token_hash NULL) /
  # device-null candidate / dead-or-missing successor
  -> auth.refresh.fail/reuse_detected + 401     # UNCHANGED for every non-benign case

else (live token): rate-limit -> device (family-revoke on mismatch, UNCHANGED) -> status -> rotation batch
  S1 = UPDATE ... SET revoked_at=now, successor_token_hash=? WHERE id=? AND revoked_at IS NULL   # only new write
  S2 = INSERT new ... WHERE changes()=1            (unchanged; rot[0]/rot[1] guards unchanged)
```

All revoked-path outcomes return `401 REFRESH_TOKEN_REVOKED` (indistinguishable to the caller — no
info leak); the audit event/`reason_code` distinguishes them server-side. Caller contract unchanged.

### Scope decision (deviation from the design's "race-loss re-eval", flagged for Gate-2)

The rotation **race-loss branch** (`rot[0].changes !== 1`) keeps emitting `reuse_race_lost`
**unchanged**. The sequential orphan (the documented root cause) is fully handled at the initial
revoked-token check. `reuse_race_lost` is already a *distinct* `reason_code` (excluded from
`reuse_detected` theft analytics), so the audit-hygiene goal is already met for the concurrent
double-submit; re-evaluating grace there would need an extra re-read SELECT and would change an
existing security-signal reason_code for a cosmetic relabel. Kept out to honor first-do-no-harm /
minimal diff on the auth hot path. If Codex wants it, it is a clean additive follow-up.

## Schema (migration 0053, EXPAND-only)

`ALTER TABLE refresh_tokens ADD COLUMN successor_token_hash TEXT;` — nullable, no backfill (legacy
rows NULL = not grace-eligible = today's reuse path, fail-safe), no index (old row found by its UNIQUE
`token_hash`; successor found by the UNIQUE `token_hash` the column stores). Provenance marker: only
rotation S1 sets it; logout / admin-revoke / device-mismatch leave it NULL. Down: plain
`DROP COLUMN` (D1 ≥ 3.39, per 0052), reversible round-trip tested.

## Audit

- New `auth.refresh.grace_orphan` → **SECURITY_SIGNAL** (`_registrySize` 207→208 + audit-policy.test).
- `auth.refresh.fail` reason_code `grace_device_mismatch` (existing SECURITY_SIGNAL event type, no new type).
- `auth.refresh.fail` / `reuse_detected` and `reuse_race_lost` unchanged.

## Known limitation (Codex round-5 non-blocking)

If the daily cleanup cron (`functions/api/admin/cron/cleanup.ts`, `DELETE ... WHERE revoked_at IS NOT
NULL`) lands within a rotated row's 30s window (daily × 30s → very rare), the row is deleted and the
orphan replay is classified `invalid_or_expired` rather than `grace_orphan` — still **not** a false
`reuse_detected`, no token issued. Safe fallback; not fixed.

## Files

- `migrations/0053_refresh_token_successor_hash.sql` (+ `down/`)
- `functions/api/auth/refresh.ts` (lookup + revoked-branch re-classification + S1 widened SET)
- `functions/utils/audit-policy.ts` (register `auth.refresh.grace_orphan`)
- `tests/integration/_setup.sql`, `tests/integration/_helpers.ts` (test schema parity)
- `tests/integration/refresh.test.ts`, `tests/integration/migrations.test.ts`, `tests/audit-policy.test.ts`

## Spike / verification

`changes()` chain after widening S1's SET is verified by running the rotation tests (the existing
`rot[1]` guard fail-closes if it ever broke). Window comparison done SQL-side (no JS datetime parsing).
