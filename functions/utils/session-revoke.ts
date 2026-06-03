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
