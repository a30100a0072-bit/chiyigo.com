/**
 * Session-family revocation primitive — PR5 5d-2 (plan §4 `casByFamily`).
 *
 * The canonical per-login-session-family revoke CAS, shared VERBATIM by the three session.revoked wire sites
 * (auth/logout, auth/devices/logout, admin/revoke mode=device). ONE statement closes all three Codex R1 blockers,
 * which is why every site MUST use this helper rather than its own refresh_tokens UPDATE:
 *
 *  - B1 ROTATION-RACE: the inner scalar subquery RE-RESOLVES the family's current unrevoked head at execution
 *    time, so a concurrent refresh that rotated the head (revoke old id + INSERT new id with session_id PRESERVED)
 *    is still caught — we revoke the NEW head. A naive `WHERE token_hash = ?` / `WHERE id = <old>` CAS would 0-row
 *    and let the live new head SURVIVE the revoke. SOUND ONLY because refresh.ts rotation is ATOMIC (plan §1.5/c2):
 *    without that, a revoke landing in the 0-live-head window mid-rotation would still miss the about-to-appear
 *    head — the atomic batch, not this CAS, closes that timing window.
 *  - B2 NULL-DEVICE: keyed on (user_id, family-ref) with NO device_uuid in the predicate — session_id is globally
 *    unique, so it identifies the family regardless of device. The device branch (device_uuid = ? vs IS NULL)
 *    lives ONLY in the multi-family ENUMERATION (plan §4.2), never in this CAS — a `device_uuid = ?` here would
 *    0-row on a web / NULL-device row.
 *  - B3 SINGLE-ROW: `WHERE id = (scalar subquery)` matches the PK → changes() ∈ {0,1}; a multi-row mutation is
 *    IMPOSSIBLE. The complementary EXACTLY-ONE-LIVE-HEAD invariant (a 2-live-head family must FAIL CLOSED, never
 *    "revoke 1 + emit 1 + leave the other live") is enforced by each caller's GLOBAL (user_id, ref) COUNT = 1
 *    preflight BEFORE this CAS (plan §4 / §4.1). We emit session.revoked ⟺ the family becomes FULLY revoked.
 *
 * Returns the prepared + bound Stmt to splice into the caller's db.batch() IMMEDIATELY BEFORE its
 * emitSessionRevoked(...) statements, so the emit's `WHERE changes() = 1` chain is gated on THIS CAS
 * (emit ⟺ a row was revoked). A 0-row CAS (already revoked / lost race) bumps no seq and writes no outbox row
 * (the no-leak invariant, plan §6 / L5). This builder does NO I/O — the caller executes the batch.
 */

import { emitSessionRevoked, type EmitIdentity } from './domain-event-emit'

/** D1 binding type via ambient Env indexed access (same convention as domain-event-emit.ts). */
type ChiyigoDb = Env['chiyigo_db']
type Stmt = ReturnType<ChiyigoDb['prepare']>

/**
 * The per-login session FAMILY id SQL expression: the live `session_id`, or a delimiter-safe `legacy_<rowid>` for
 * any pre-0052 NULL gap row (unique to that row's PK). Used IDENTICALLY in the pre-read, the integrity COUNT, and
 * this CAS's subquery so the runtime family identity NEVER diverges across the three reads (plan Q5 / L2 — the DB
 * invariant and the runtime ref must not drift). It is a FIXED internal constant (never user input), so it is safe
 * to interpolate into the prepared SQL below.
 */
export const FAMILY_REF_SQL = `COALESCE(session_id, 'legacy_' || id)`

/**
 * casByFamily — revoke a session family's single current live head (PK-pinned subquery → changes() ∈ {0,1}).
 *
 * @param db      the D1 binding
 * @param userId  the session owner (server-resolved; never client-supplied)
 * @param ref     the per-login family id = `COALESCE(session_id,'legacy_'||id)` (the caller's pre-read value)
 * @returns the bound UPDATE statement to splice as the GATING mutation before emitSessionRevoked(...).statements
 */
export function casByFamily(db: ChiyigoDb, userId: number, ref: string): Stmt {
  return db
    .prepare(
      `UPDATE refresh_tokens SET revoked_at = datetime('now')
        WHERE id = (SELECT id FROM refresh_tokens
                      WHERE user_id = ? AND ${FAMILY_REF_SQL} = ? AND revoked_at IS NULL
                      LIMIT 1)
          AND revoked_at IS NULL`,
    )
    .bind(userId, ref)
}

// ── multi-family revocation (5d-2 c5; auth/devices/logout + admin/revoke mode=device) ────────────────────────────
// auth/logout (c4) revokes a SINGLE family inline. The multi-family sites (a user logging out a whole device, an
// admin revoking a device) revoke MANY families at once. This orchestrator is the ONE place that logic lives, so the
// two endpoints cannot drift on the intricate Tier-0 concurrency rules (GLOBAL integrity preflight, chunk ceiling,
// both-or-neither WITHIN a chunk, forward-progress ACROSS chunks). The CALLER does the device-specific candidate
// ENUMERATION (the device_uuid filter lives THERE, never in the device-less casByFamily — B2) + the audits + the
// HTTP response; this helper is pure D1 orchestration and returns a structured outcome (no env / audit / Response →
// testable in isolation, and the per-endpoint audit type + envelope stay with each caller).

/**
 * Chunk ceiling (plan L3 / SP6, LOCKED): a multi-family revoke runs in atomic batches of ≤K families (3 statements
 * each → ≤3K per batch). K=20 is proven on local + remote D1 (a 60-statement one-txn batch). N>K → multiple batches.
 */
export const SESSION_REVOKE_CHUNK_SIZE = 20

/**
 * Large-N anomaly threshold (PR5 5d-2 observability residual): a multi-family revoke whose enumerated live-family
 * count on ONE device exceeds this is SURFACED as a warn signal (even on full success) — "no silent cap". It is an
 * ANOMALY threshold, NOT the chunk ceiling: it sits well ABOVE both the typical count (1-3, up to ~14 for a daily
 * re-login user over the 7-day TTL) AND K=20, so it only fires on a genuine outlier (bot / abuse / a family-minting
 * bug). Default is conservative; ops can tune via env without a redeploy (we have no prod distribution data yet).
 */
export const SESSION_REVOKE_LARGE_N_THRESHOLD = 50

/**
 * Resolve the effective large-N threshold from a raw env value, STRICTLY: only a finite POSITIVE INTEGER is
 * accepted; anything else (undefined, '', '0', '-1', '2.5', 'abc', 'Infinity', NaN) falls back to the safe default.
 * A naive `Number(env) || default` would wrongly accept -1 / Infinity (alarm always- or never-fires) — this guards
 * that. Pure (takes the raw value, no env/IO) so it stays out of the revoke logic and is unit-testable.
 */
export function resolveLargeNThreshold(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : NaN
  return Number.isInteger(n) && n > 0 ? n : SESSION_REVOKE_LARGE_N_THRESHOLD
}

export interface RevokeFamiliesResult {
  /**
   * 'ok'                  — every revocable family was processed (committed).
   * 'integrity_violation' — a candidate had >1 GLOBAL live head (one-live-head invariant broken) → NOTHING mutated.
   * 'incomplete'          — a chunk FAILED after earlier chunks committed → the client must retry `remaining`.
   */
  outcome: 'ok' | 'integrity_violation' | 'incomplete'
  revoked: number                   // families whose live head was revoked (casByFamily changes()=1)
  emitted: number                   // session.revoked events written (== revoked; the emit is gated on the CAS)
  remaining: number                 // revocable families NOT yet committed (only meaningful on 'incomplete')
  integrityRef?: string             // the ref with >1 live head (only on 'integrity_violation')
  integrityHeads?: number
  emittedIdentities: EmitIdentity[] // for the caller's POST-COMMIT domain.event.emitted audits (redacted stream_key)
}

/**
 * Revoke a set of session families (each by its per-login ref) + emit one session.revoked per family — fail-closed
 * on a broken EXACTLY-ONE-LIVE-HEAD invariant, chunked to a bounded batch size with forward-progress on a partial
 * failure. `candidateRefs` MUST be the DISTINCT, device-filtered, currently-live refs the caller enumerated (the
 * device filter is the caller's; this helper is device-less, matching casByFamily's (user_id, ref) keying).
 */
export async function revokeSessionFamilies(
  db: ChiyigoDb,
  userId: number,
  candidateRefs: string[],
  actorSub: string | null,
  opts: { chunkSize?: number } = {},
): Promise<RevokeFamiliesResult> {
  const base = { revoked: 0, emitted: 0, remaining: 0, emittedIdentities: [] as EmitIdentity[] }
  if (candidateRefs.length === 0) return { outcome: 'ok', ...base }

  // GLOBAL device-less live-head COUNT per candidate ref — ONE query via json_each(?) (reference_d1_query_budget_
  // json_each): the refs go in as a single JSON-array bind, never an IN(?,?,...) list. GLOBAL (no device filter) so a
  // same-ref-on-two-devices duplicate is SEEN (Codex R4), matching casByFamily's device-less (user_id, ref) key.
  const countRows = await db
    .prepare(
      `SELECT ${FAMILY_REF_SQL} AS ref, COUNT(*) AS heads FROM refresh_tokens
        WHERE user_id = ? AND ${FAMILY_REF_SQL} IN (SELECT value FROM json_each(?)) AND revoked_at IS NULL
        GROUP BY ref`,
    )
    .bind(userId, JSON.stringify(candidateRefs))
    .all<{ ref: string; heads: number }>()
  const headsByRef = new Map<string, number>()
  for (const row of countRows.results ?? []) headsByRef.set(String(row.ref), Number(row.heads))

  // FAIL CLOSED — if a candidate has >1 GLOBAL live head, the one-live-head invariant is broken (same session_id on
  // two rows / two devices). Revoking one + emitting a deny while a live head remains makes the event ⊥ the auth DB
  // → abort the WHOLE request, mutate nothing. (c4-consistent: 0 = benign skip below, >1 = violation here.)
  for (const ref of candidateRefs) {
    const h = headsByRef.get(ref) ?? 0
    if (h > 1) return { outcome: 'integrity_violation', integrityRef: ref, integrityHeads: h, ...base }
  }

  // Revocable = candidates with EXACTLY ONE live head. heads===0 (concurrently revoked between enumerate + count) is
  // a benign skip — its casByFamily would 0-row anyway; never a violation.
  const revocable = candidateRefs.filter((ref) => (headsByRef.get(ref) ?? 0) === 1)
  if (revocable.length === 0) return { outcome: 'ok', ...base }

  const chunkSize = opts.chunkSize && opts.chunkSize > 0 ? opts.chunkSize : SESSION_REVOKE_CHUNK_SIZE
  const emittedIdentities: EmitIdentity[] = []
  let revoked = 0
  let processed = 0
  try {
    for (let i = 0; i < revocable.length; i += chunkSize) {
      const chunk = revocable.slice(i, i + chunkSize)
      const stmts: Stmt[] = []
      const tracking: { identity: EmitIdentity; casIdx: number }[] = []
      for (const ref of chunk) {
        // eventId / occurredAt are the only side effects — generated per family (this helper is the I/O adapter).
        const emit = emitSessionRevoked(
          db,
          { sub: String(userId), ref, actorSub },
          { eventId: crypto.randomUUID(), occurredAt: new Date().toISOString() },
        )
        tracking.push({ identity: emit.identity, casIdx: stmts.length })
        stmts.push(casByFamily(db, userId, ref), ...emit.statements)
      }
      // WITHIN a chunk = ONE atomic batch (both-or-neither) — a chunk failure rolls the whole chunk back (SP4).
      const results = await db.batch(stmts)
      for (const t of tracking) {
        if (results[t.casIdx]?.meta?.changes === 1) {
          revoked++
          emittedIdentities.push(t.identity)
        }
      }
      processed += chunk.length
    }
  } catch {
    // ACROSS chunks = forward progress: earlier chunks are COMMITTED (revoked + emitted); this chunk + later ones are
    // not. The caller returns NON-2xx with these counts; a client RETRY re-enumerates (committed families are now
    // revoked → excluded) → converges with NO double-emit.
    return { outcome: 'incomplete', revoked, emitted: revoked, remaining: revocable.length - processed, emittedIdentities }
  }
  return { outcome: 'ok', revoked, emitted: revoked, remaining: 0, emittedIdentities }
}
