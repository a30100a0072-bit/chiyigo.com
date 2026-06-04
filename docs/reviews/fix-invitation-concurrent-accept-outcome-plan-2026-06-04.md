# Fix — acceptInvitation same-user concurrent loser returns wrong `expired` — Gate-1 Plan

- Created: 2026-06-04
- Status: Gate-1 plan (NO code yet). Follow-up surfaced by the owner during PR #17 (5d-3) review; independent of 5d-3.
- Workgrade: **L1 bug fix + HIGH-RISK ADDENDUM (concurrency / race on a member-lifecycle + deny-state-emission
  path).** Per the addendum, this plan carries the outcome-state table (§4) + the idempotency/concurrency reasoning
  (§5) + a deterministic exact-failure regression spec (§6). No 11-step (not L3).
- Constraints: $0, Tier-0 baseline. **CODE-ONLY** — no migration, no new endpoint, no new outcome type, no contract
  change. Minimal diff on a Tier-0-adjacent path (first-do-no-harm, feedback_security_boundary_pr_first_do_no_harm).

--------------------------------------------------------------------------------
## 1. Root cause (verified against code 2026-06-04)
--------------------------------------------------------------------------------

`functions/utils/invitations.ts` `acceptInvitation` post-batch classification (lines ~264-274). After the atomic
`db.batch([consume(CAS), join(SELECT-gated), ...emit(changes-gated)])`, the outcome is derived from a re-read
`after`:
- L269 — `after.accepted_user_id === self && after.accepted_at === occurredAt` → `joined` (THIS request won).
- L273 — `after.accepted_user_id !== null && after.accepted_user_id !== self` → `already_resolved` (ANOTHER user won).
- L274 — else → **`expired`**.

The gap: a **same-user concurrent loser** (two accepts for the SAME user; one wins the consume CAS, the other reads
`pending` at the pre-check then 0-rows the CAS) lands with `after.accepted_user_id === self` BUT
`after.accepted_at !== its own occurredAt`. Both guarded branches are false → it falls through to **`expired`**,
which is WRONG: the user IS a member (via the winner). It should be `replay` / `already_member`.

Note the SEQUENTIAL accepted-by-self replay (a later, separate call) is already correct (L191-201): the pre-check
sees `status='accepted'`, re-reads membership, returns `replay`/`membership_not_active`/`already_resolved`. The bug
is ONLY on the request that passed the pre-check while still `pending` and then lost the CAS.

--------------------------------------------------------------------------------
## 2. Scope / non-goals
--------------------------------------------------------------------------------

IN SCOPE: add the missing same-user-loser branch in the post-batch classification, returning the SAME outcomes the
sequential replay path already returns (reuse, no new taxonomy). Add a deterministic regression (§6).

NON-GOALS / INVARIANTS THAT MUST NOT CHANGE (the bug is data-SAFE; the fix must keep it that way):
- Exactly ONE `organization_members` row per (tenant_id, user_id) — backed by UNIQUE; the loser's `join` is
  `INSERT…SELECT…WHERE accepted_at=<my occurredAt>` → 0 rows for the loser. UNCHANGED.
- Exactly ONE `member.joined` outbox row — the emit is `changes()=1`-gated on the loser's 0-row join. UNCHANGED.
- The `consume` CAS, the `join` SELECT-gate, the emit gating, the F2 catch/rethrow (L243-262), and the
  `joined` / `already_resolved` (different-user) / genuine-`expired` branches — ALL UNCHANGED.
- No new outcome variant, no endpoint, no migration, no event/contract change.

--------------------------------------------------------------------------------
## 3. The fix (mirrors the existing replay branch L191-201)
--------------------------------------------------------------------------------

Insert BEFORE the final `return { outcome: 'expired' }` (L274):

    // Same-user concurrent winner: this request saw 'pending' at the pre-check, then a sibling accept by the SAME
    // user won the consume CAS (committed a different occurredAt). We did NOT 'expire' — the user IS resolved.
    // Re-read membership and classify exactly like the sequential accepted-by-self replay (L191-201).
    if (after && after.accepted_user_id === input.acceptingUserId) {
      const m = await db
        .prepare(`SELECT status, platform_role FROM organization_members WHERE tenant_id = ? AND user_id = ?`)
        .bind(after.tenant_id, input.acceptingUserId)
        .first<{ status: string; platform_role: string }>()
      if (!m) return { outcome: 'already_resolved' }                 // offboarded between win and re-read
      if (m.status !== 'active') return { outcome: 'membership_not_active' }
      return { outcome: 'replay', tenantId: after.tenant_id, platformRole: m.platform_role }
    }
    return { outcome: 'expired' }   // genuinely never consumed (accepted_user_id null / after null) — KEEP

Reuses the existing `replay` / `membership_not_active` / `already_resolved` outcomes verbatim (see
feedback_updatestatus_structured_outcome). `after` already selects `tenant_id` (L266), so no extra read shape.

--------------------------------------------------------------------------------
## 4. Outcome-state table (high-risk addendum) — all post-pre-check terminal classifications
--------------------------------------------------------------------------------

| situation at the post-batch `after` read | accepted_user_id | accepted_at vs mine | BEFORE | AFTER (fix) |
|---|---|---|---|---|
| this request won the consume | self | == mine | joined | joined (unchanged) |
| another USER won | other | (n/a) | already_resolved | already_resolved (unchanged) |
| **same USER won concurrently** | **self** | **!= mine** | **expired (BUG)** | **replay / membership_not_active / already_resolved** |
| never consumed (expired between pre-check and CAS) | null | (n/a) | expired | expired (unchanged) |

Only the bolded row changes. The new row's sub-classification (replay / not_active / resolved) is decided by the
LIVE membership re-read, identical to L191-201.

--------------------------------------------------------------------------------
## 5. Idempotency / concurrency reasoning
--------------------------------------------------------------------------------

- Data-safety is preserved because the fix touches NO mutation — it only reclassifies an outcome AFTER the atomic
  batch already committed (or 0-rowed) for the loser. The loser still writes nothing (consume 0-row, join 0-row,
  emit 0-row). The re-read is read-only.
- The membership re-read can itself race a concurrent offboard/suspend; that is exactly why it maps to
  `already_resolved` (row gone) / `membership_not_active` (suspended) — the SAME tolerant classification the
  sequential replay path uses. No new race is introduced.
- Re-running the loser (client retry) now returns a STABLE `replay` (or the membership's current state), not a
  spurious `expired` — convergent + idempotent.

--------------------------------------------------------------------------------
## 6. Test plan (the regression discipline the owner pinned)
--------------------------------------------------------------------------------

**The regression MUST be DETERMINISTIC and provably pre-fix RED — it must NOT rely on `Promise.all` luck**
(the existing `invitations.test.ts:166-180` Promise.all test is non-deterministic; relying on the race to be red is
the very flakiness we are removing). Force the exact interleaving:

- **Regression A (locks the exact failure):** run a single `acceptInvitation` whose pre-check observes `pending`,
  then force a SAME-USER winner to commit BEFORE its batch via a one-shot seam (e.g. `vi.spyOn(db,'batch')
  .mockImplementationOnce(...)` that first commits the winner — set the invite `accepted` by the same user at a
  DIFFERENT occurredAt + an active membership row — then delegates to the ORIGINAL `db.batch`). The technique mirrors
  the 5b consumer fence tests (real D1, real SQL, injected interleaving). Assert:
    - PRE-FIX: outcome === `'expired'` (this is the RED that proves the test catches the bug).
    - POST-FIX: outcome === `'replay'` (active membership) — and a suspended variant → `'membership_not_active'`,
      an offboarded variant → `'already_resolved'`.
- **Data invariants (must still hold, asserted in/with Regression A):** after the forced-loser run, EXACTLY ONE
  `organization_members` row for (tenant,user) and EXACTLY ONE `member.joined` outbox row — the loser added neither.
- **Existing Promise.all test (L166-180):** KEEP. Post-fix it is deterministically green for ANY interleaving
  (every outcome now lands in the asserted allow-set), so it stops flaking — but it is NOT the pre-fix-red lock
  (Regression A is). Optionally tighten its assert to include `membership_not_active`/`already_resolved` is NOT
  needed (the winner+active path yields joined/replay/already_member).

Gates to run at code time: `typecheck:ratchet`, eslint, the invitations + member-endpoints + event-outbox-emission
integration tests, build:functions.

--------------------------------------------------------------------------------
## 7. Commit plan
--------------------------------------------------------------------------------

  c1  this plan doc (Gate-1 checkpoint).
  --- after Codex Gate-1 Approve ---
  c2  the same-user-loser branch in invitations.ts + Regression A (deterministic forced interleaving, pre-fix red)
      + the data-invariant asserts. One focused commit (≈6 LOC fix + tests). No migration.
  (one PR, squash-merged; base main.)

--------------------------------------------------------------------------------
## 8. Open questions for Codex Gate-1
--------------------------------------------------------------------------------

Q1. Is mirroring the sequential replay branch (L191-201) for the concurrent same-user loser the right reuse (vs a
    distinct outcome)? It returns `replay`/`membership_not_active`/`already_resolved` from a LIVE membership re-read.
    The membership re-read + classify now appears TWICE (L191-201 + the new branch). Per the abstraction rule
    (≥3 real uses → abstract; 2 → don't), I lean INLINE (matches the file's style, keeps the Tier-0 diff minimal).
    Extract a small `classifyAcceptedBySelfReplay(db, tenantId, userId)` helper instead? (Owner/Codex preference.)
Q2. Is the deterministic forced-interleaving regression (one-shot `db.batch` spy committing the same-user winner
    mid-flight) the right way to guarantee pre-fix RED, given a Promise.all regression can't be reliably red?
Q3. Confirm the fix adds NO mutation and cannot affect the exactly-one-membership / exactly-one-`member.joined`
    invariants (read-only reclassification after the committed/0-rowed batch).

--- END Gate-1 PLAN (acceptInvitation same-user concurrent loser outcome fix) ---
