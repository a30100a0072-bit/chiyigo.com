# Deep Review — JS→TS Migration Stage 1–6 — Findings Report

**Audit anchor:** pinned worktree @ `a0af577` (Stage 6.2 HEAD / migration end-state)
**Pre-migration baseline:** `04b597a` (commit before Stage 0 `a196f68`)
**Method:** Claude full 4-dimension audit → this report → codex gate-2 review + spot-check (per approved plan v3)
**Date:** 2026-05-28

---

## Verdict

**Foundation is solid. 0 Blocker, 0 High. 4 Low (cosmetic/methodology/accepted-delta). Stage 7 may proceed on this base.**

> **Codex gate-2 (2026-05-28):** reviewed + spot-checked — **no Blocker/High code issue**; migration base approved for Stage 7 (functions-first then tests strict order). Report corrected per 3 gate-2 findings: A-3 reworded (concurrent feature deltas, not annotation), A-2 `apiFetch` narrowing added as **L4**, C CAS-race row split (done vs tracked).

The migration's load-bearing claims hold under independent reconstruction:
- Baseline reconstructs **exactly** (0 errors / 257 clean / 257 total) from a clean `npm ci` + `tsc -b`.
- Governance machinery (ratchet) intact; suppression/`any` surface clean incl. `.d.ts`.
- Browser emit is **reproducible & byte-equal** to committed.
- Conventions consistent across all stages.
- Deliberate runtime changes match their documented atomic designs with no overreach.
- **Zero** formal `TECH-DEBT:` tags incurred; deferrals all tracked or done.

**One carried-forward constraint for Stage 7** (not a finding, a dependency): `tsconfig.tests.json` duplicate-includes `functions/**`, so strict must be enabled **functions-leaf first, then tests-leaf** (else tests-strict transitively constrains functions). See C-6.

---

## Scope integrity note

- Migration span `a196f68..a0af577` = **440 commits** (per-PR content + cache-bust + docs + codex-round commits, interleaved with 12 days of concurrent feature work). Commit-by-commit attribution is therefore unreliable → all checks done by **endpoint diff / mechanical classification**, not commit attribution.
- Parallel-track delta `a0af577..a234ae2` (current HEAD) is **NOT docs-only** — it added `scripts/audit-archive-forensic-classify.mjs` + `tests/audit-archive-forensic-classify-parity.test.ts`. Running B at current HEAD would contaminate `sourceFilesTotal`/`cleanFiles` and the (still-257) `baseline.json` would read stale. **The pinned worktree @ a0af577 is mandatory** — confirmed.

---

## Dimension B — Governance integrity (GATE) — ALL GREEN

| Check | Result | Evidence |
|---|---|---|
| **B-1** reconstruct & record | **PASS** | `npm ci` → `npm run typecheck` (`tsc -b tsconfig.solution.json`) exit 0, no errors → `typecheck:ratchet:report` = **errorCount 0 / cleanFiles 257 / sourceFilesTotal 257**, matches `baseline.json` |
| **B-2** ratchet enforce | **PASS** | `npm run typecheck:ratchet` → `baseline 0/257, current 0/257, ratchet OK` (also confirms tsconfigSnapshot match → subsumes B-5) |
| **B-3** suppression/`any` scan over `.js/.ts/.d.ts` (full tree) | **PASS** (1 Low) | `@ts-nocheck/ignore/expect-error` = **0**. Real `any`/container-`any` = **0** in type position. `.d.ts` = **0**. See **L1**. 2 grep hits were comment text (false positives). |
| **B-4** tsconfig topology (10 files) | **PASS** (1 Low) | references DAG `solution→[functions,scripts,tests,browser-typecheck]`, no cycles; per-runtime lib/types correct; prod emit configs `types:[]`; no DOM↔WebWorker mix in any solution-graph leaf. See **L2**. |
| **B-5** baseline structural integrity | **PASS** | Subsumed by B-2 (ratchet enforce compares errorCount/cleanFiles/sourceFilesTotal/tsconfigSnapshot vs baseline and passed). `baselineSha=b63d971` is the known pre-commit/parent-SHA quirk — correctly treated as metadata, not integrity signal. |

**B-4 detail (per-runtime lib/types):**
- `functions` / `tests` leaves: lib `WebWorker(+Iterable)`, types `[@cloudflare/vitest-pool-workers]`, composite+noEmit+`.tscache/<name>`
- `scripts` leaf: lib `ES2022`, types `[node]`
- `browser-typecheck` leaf: lib `DOM(+Iterable)`, types `[]`, **explicit-includes** the 6 ambient `.d.ts` (no glob → no `env.d.ts` lib-conflict leak)
- prod build (`browser-classic.prod` / `browser-module.prod`): `types:[]`, `outDir public/js`; 29 classic + 1 module entries

---

## Dimension A — Cumulative runtime drift — PASS

| Check | Result | Evidence |
|---|---|---|
| **A-1** reproducible build (flagship) | **PASS** | `BUILD_VER=86935a74 npm run build` → `verify:browser-pipeline` → **"prod emit OK (29 entries … temp+inject/committed byte-equal)"** + module byte-equal. `git status --porcelain` showed 29 `public/js/*.js` modified, but `git diff --ignore-cr-at-eol` is **empty** and plain `git diff` shows **zero content** (only git's LF→CRLF warning) → pure Windows CRLF working-tree churn, content byte-identical. **No `public/*.html` / `public/css` diff** → cache-bust idempotent + tailwind reproducible. See **L3** (method refinement). |
| **A-2** collapse equivalence | **PASS, 1 Low (L4)** | `public/js/api.js` never deleted; Stage 4.5b-3 (`482bf81`, PR-58, codex-reviewed multi-round) added `src/js/api.ts` and api.js became the emit target. Handwritten→emitted = **2029-line** whole-file IIFE/structural transform (top-level `ApiError` + `window.*` mount). verify-pipeline proves current emit == committed. **Codex gate-2 spot-checked this transform** and found one input-contract narrowing → see **L4**; no other semantic delta. |
| **A-3** source type-only classifier (endpoint, not per-commit) | **PASS** | `git diff --name-status -M 04b597a a0af577 -- '*.js' '*.ts'` = **218 renames**. Score split: **18× R100** (content-identical → trivially safe); 200× R<100 (TS annotations **+ concurrent feature edits**, **all compile to 0 errors** per B-1, each per-PR type-only-reviewed). Hot-zone = 86 renames. **Codex gate-2 correction:** the lowest-similarity files are **concurrent runtime feature deltas, NOT annotation-dominated** — `audit-archive.ts` R050 = write-once R2 manifest key scheme (tagged *PR 0.2c-pre-1a*, prod-lock track) + lock-aware retry/`classifyR2LockError`; `audit-log.ts` R051 = CAS retry loop (`audit-log.ts:108-123`) backed by migration `0045_admin_audit_unique_prev_hash.sql`. These are separately-developed/-reviewed features that landed in the endpoint-diff window — not migration drift, but also not annotation. (`rate-limit.ts` R057 not re-inspected this pass.) |
| **A-4** known-runtime PR re-verify | **PASS** | All deliberate changes match documented atomic designs, **no overreach** — see below. |

**A-4 detail:**
- `functions/utils/role-change.ts` — batch `[audit, revoke, role_CAS]`; revoke + CAS both gated `role=oldRole AND deleted_at IS NULL`; caller `batchResults[2].meta.changes!==1 → ROLE_RACE`; audit row commits even on CAS-fail (hash-chain evidence). **Exactly F2/PR-A r2.** (Also a *latent* helper — no prod caller yet → zero current runtime risk.)
- `functions/api/admin/audit/[id].ts` — step-up (ELEVATED_ACCOUNT) + `admin:audit:write`; atomic batch `[audit, DELETE … WHERE id=? AND event_type=?]`; `changes!==1 → 409 AUDIT_RACE`; `DELETABLE_EVENTS={requisition.deleted}`. **Exactly F3.**
- `functions/api/auth/oauth/bind-email.ts` (F7) — `oauth.bind_email.fail` with reason codes `unsupported_provider`/`missing_jti`/`missing_exp`/`link_already_used` + `.success`. **Matches documented chain.**
- `failure_reason` DB landing — present & in active use (`intents.ts:52`). **Done.**
- email arity (PR-B') / payments `isPaymentStatus` guards — documented type/runtime-adjacent, per-PR reviewed (not re-diffed this pass; low residual).

---

## Dimension C — Deferred reconciliation — CLEAN (0 leaked)

| Deferral | Status | Evidence |
|---|---|---|
| Stage 8 ambient→explicit import | **Tracked** | `api-globals.d.ts` header: "Stage 8 RFC … shrinks toward removal"; 5 siblings note Stage 6.2 origin |
| Source-side inline `interface Window` kept (api.ts:77 / notify.ts:30 / confirm-dialog.ts:33 / dashboard.ts:18) | **Done-as-intended** | Present + set-aligned with siblings; still needed for prod tsconfig (`types:[]`) |
| Payments repository extraction | **Tracked** | backlog memory `project_payments_repository_backlog` |
| audit-log hash-chain CAS race hardening | **Done** (codex gate-2 correction) | migration `0045_admin_audit_unique_prev_hash.sql` (UNIQUE INDEX prev_hash) + `appendAuditLog` CAS retry loop (`audit-log.ts:108-123`) |
| verifyAuditChain full-table scan | **Tracked** | backlog memory `project_audit_log_integrity_todo` (revisit when rows > 10k) |
| `@types/node` ^20→^22 preflight | **Tracked** | `package.json:38` confirms `^20`; flagged as Stage 7 preflight |
| **tests-leaf includes `functions/**` → Stage 7 strict order** | **Live constraint** | `tsconfig.tests.json` confirmed; **must enable strict functions-first** |
| `failure_reason` DB landing | **Done** | `intents.ts:52` |
| audit-error-i18n.out.json regen | Not re-verified (low-priority report artifact) | — |

**In-code markers:** only **3** `TODO` across whole tree (coverage-exclude TODO; `oauth-providers.ts:84` Apple `$99/yr` paid-feature deferral; a `refresh.test` TODO) — all benign/tracked. **Zero** `TECH-DEBT:`/`FIXME` → no tracked tech-debt exceptions incurred during migration.

---

## Dimension D — Convention consistency — CLEAN

| Check | Result | Evidence |
|---|---|---|
| **D-1** extensionless imports | **PASS** | functions/ + tests/ relative imports = **0** `.js` suffixes; scripts/ relative imports **all carry `.js`** (`build-partials`/`lint-archive-no-delete`/`verify-browser-pipeline`). Convention holds both ways. |
| **D-2** ambient ownership | **PASS** | `globals.d.ts` vendor-only (QRCode + EIP-1193, uses `Record<string,unknown>`); 5 source-owned siblings each scoped; none leaked back; inline `interface Window` (api/notify/confirm-dialog/dashboard) **set-aligned** with siblings; dashboard inline `QRCode?`/`ethereum?` shapes **byte-identical** to globals.d.ts; `sidebar-auth.ts` deliberately removed its inline augmentation (no dual-maintenance). |
| **D-3** IIFE / lane | **PASS** | verify-pipeline: `manifest classic=29 / module=1`, classic emit "無 ESM 結構", module emit "含 export". `auth-ui.ts` is the documented non-IIFE classic exception (TAB_CONFIG script-global producer). |
| **D-4** cache-bust | **PASS** | All committed `public/*.html` `?v=` single-valued = `86935a74` (205/205) = parent `86935a7` `--short=8`. Rebuild with that BUILD_VER left HTML untouched (idempotent). |

---

## Findings (all Low)

- **L1 (B-3, cosmetic):** `functions/utils/audit-aggregate-archive-runner.ts:268` JSDoc `@param {(rows:any[]) => string}` — a JSDoc `any[]` in a `.ts` file (tsc ignores JSDoc types → ineffective doc debt, not a type hole). Broader pattern: several migrated `.ts` retain decorative JSDoc `@param`/`@returns` blocks (e.g. `role-change.ts`) now superseded by inline TS annotations. *Disposition: optional cleanup in a docs pass; not blocking.*
- **L2 (B-4, latent):** root `tsconfig.json` retains mixed `DOM+WebWorker` lib. Not in the solution typecheck graph (only an `extends` base for browser build configs, which override lib to DOM-only) → no active conflict; latent footgun for direct `tsc -p tsconfig.json` / IDE default. *Disposition: tighten in Stage 7/8; accept now.*
- **L3 (A-1, methodology):** the codex-approved A-1 gate "`git status --porcelain` empty" has a Windows-CRLF false-positive mode (build-partials writes CRLF; committed blobs are LF). Robust gate = `git diff --ignore-cr-at-eol` (content-level) **+** `verify:browser-pipeline` byte-equal. Matches existing `feedback_windows_build_crlf_churn` discipline (don't commit the churn). *Disposition: methodology note for future audits.*
- **L4 (A-2, accepted delta — codex gate-2):** `apiFetch` input contract was **narrowed** during the api.js→api.ts collapse: pre-migration `public/js/api.js:131` `const url = typeof input === 'string' ? input : input.url` (accepted `string | {url}`, RequestInfo-ish) → final `src/js/api.ts:190` `apiFetch(input: string, …)` / `const url = input` (string-only). All current callers pass strings → no active breakage, but it is a runtime/API-surface narrowing. *Disposition: accept as recorded low-risk delta, or restore `RequestInfo`-style compatibility if a non-string caller is ever added.*

---

## Recommended codex gate-2 spot-checks (highest residual)

1. **A-2 — `api.js` handwritten→emitted 2029-line transform** (auth/session-critical). Independent eyes on hand-written→transpiled semantic equivalence; PR-58 covered it per-PR but this is the single largest residual.
2. ~~A-3 sample of R<100 hot-zone renames~~ — **done in gate-2**: codex confirmed `audit-archive.ts` R050 / `audit-log.ts` R051 low-similarity = concurrent feature deltas (write-once manifest / CAS retry backed by migration 0045), not migration drift. Both spot-check targets resolved.

---

## Evidence appendix (key command outputs)

```
# B-1
$ npm run typecheck   # tsc -b tsconfig.solution.json  → exit 0, no output
$ npm run typecheck:ratchet:report
errorCount 0 / fileErrors 0 / globalErrors 0 / errorFiles 0 / cleanFiles 257 / sourceFilesTotal 257

# B-2
$ npm run typecheck:ratchet
baseline: errorCount=0 cleanFiles=257 (baseRef=origin/main)
current : errorCount=0 cleanFiles=257 → ratchet OK

# A-1
$ BUILD_VER=86935a74 npm run build && npm run verify:browser-pipeline
... ✓ prod emit OK (29 entries: classic shape + temp+inject/committed byte-equal)
... ✓ module prod emit OK (1 entries: ES module shape + temp+inject/committed byte-equal)
$ git status --porcelain -- public src/pages src/partials src/i18n   # 29× " M public/js/*.js" only
$ git diff --ignore-cr-at-eol -- public/js   # EMPTY → CRLF-only churn

# A-3
$ git diff --name-status -M 04b597a a0af577 -- '*.js' '*.ts' | grep -c '^R'   # 218
# score dist: R100×18, R099×20, R098×17, R097×22, R096×23, ... down to R050×1

# D-4
$ git grep -hoE '\?v=[^"&]+' a0af577 -- 'public/*.html' | sort | uniq -c   # 205 ?v=86935a74
$ git rev-parse --short=8 86935a7   # 86935a74
```

*This report is an untracked, uncommitted audit artifact.*
