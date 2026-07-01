# PR-2di PLAN — Stage 7 noImplicitAny → 0（non-token handler batch）

> 3-file risk-homogeneous **type-only** batch：`api/auth/game/login.ts` + `api/admin/event-dlq/[id]/replay.ts` + `api/invitations/accept.ts`。

## Gate anchors（此 PLAN 的上游批准鏈）
- **SPEC_APPROVED**（owner，本 session）｜packet：`~/Desktop/chiyigo-packets/stage7-pr2di-SPEC-draft.md`
- **CHATGPT_SPEC_APPROVED_WITH_LOCKS**（Phase-0 ChatGPT SPEC review；locks ARCH-L1..L8 見 §4）
- **Base**：main HEAD `86fbe70d`（#132 PR-2dh）｜ratchet current `558 / 41 / 294`（baseline `1119 / 175` 凍結）
- **Gate-state（本檔）**：`CODE_SELF_REVIEW_CLEAN` @ source commit `a2295981`（維度 A workflow `wf_10739e54-963`：15 findings 全 `refuted` / 0 accepted / 0 suspicious；主線親裁 0 source 改動；詳 §14）｜前置 Plan Gate 兩道全過（① `CHATGPT_ARCH_APPROVED` 0 blocking + ② `CODEX_PLAN_APPROVED`，Codex live-repo 覆核 BASE=558·OVERLAY=543·REMOVED=15·ADDED=0·byte-identical 3/3）＋ `CODING_ALLOWED`（owner 本 session）｜**下一步＝③ Codex Code Gate（對 committed blob `a2295981`）**
- **動工分級**：impl **L1**（byte-identical type-only）／ review care **L3**（admin step-up+CAS replay、一次性 token consume + tenant join 不降審）

---

## 1. 目標
清 3 檔共 **15** 個 noImplicitAny 錯（全 7xxx：TS7031 handler 解構 / TS7006 helper 參數 / TS7053 index）→ 0，僅 type annotation / index-signature，**byte-identical emit、零 runtime 變更**。ratchet `558 → 543`（−15）。

## 2. Scope — 檔案與精確 leaf 成員（forced tsc 逐行實測）

| 檔案 | 錯數 | leaf 明細 |
|---|---|---|
| `functions/api/auth/game/login.ts` | 3 | TS7031×2 @L36〔handler `{request,env}`〕；**TS7053×1 @L57**〔`PROVIDER_INIT_PATHS[provider]`：`{discord:string}` 被 string index〕 |
| `functions/api/admin/event-dlq/[id]/replay.ts` | 8 | TS7006×5 @L22〔內部 helper `auditReplay`〕；TS7031×3 @L26〔handler `{request,env,params}`〕 |
| `functions/api/invitations/accept.ts` | 4 | TS7031×2 @L19〔handler `{request,env}`〕；TS7006×2 @L94〔內部 helper `emitDenied` 之 env/request；userId/reasonCode 已標型〕 |

全 15 錯均 noImplicitAny-dependent；**無** D1 row-map / derived-any / adapter-union cascade。

## 3. Frozen diff（6 處，完整字串、無縮寫、+6/−6 語義；唯一允許的改動）

**F1 — `functions/api/auth/game/login.ts` L32（index signature，OD-1）**
```
- const PROVIDER_INIT_PATHS = {
+ const PROVIDER_INIT_PATHS: Record<string, string> = {
```
**F2 — `functions/api/auth/game/login.ts` L36（handler，Convention A 無 params）**
```
- export async function onRequestGet({ request, env }) {
+ export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
```
**F3 — `functions/api/admin/event-dlq/[id]/replay.ts` L22（內部 helper）**
```
- async function auditReplay(env, request, userId, severity, data) {
+ async function auditReplay(env: Env, request: Request, userId: number, severity: string, data: Record<string, unknown>) {
```
**F4 — `functions/api/admin/event-dlq/[id]/replay.ts` L26（handler，Convention A 帶 params）**
```
- export async function onRequestPost({ request, env, params }) {
+ export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
```
**F5 — `functions/api/invitations/accept.ts` L19（handler，Convention A 無 params）**
```
- export async function onRequestPost({ request, env }) {
+ export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
```
**F6 — `functions/api/invitations/accept.ts` L94（內部 helper 之 env/request）**
```
- async function emitDenied(env, request, userId: number, reasonCode: string) {
+ async function emitDenied(env: Env, request: Request, userId: number, reasonCode: string) {
```

> **Convention A**（`{ request: Request; env: Env[; params: Record<string, string> ] }`）＝跨 ~30 shipped handler 的硬 SSOT，逐字一致。`Env` 為全域 interface（`types/env.d.ts` `declare global`）→ 三檔皆**不需 import**。
> **Compiler-config anchor**：`tsconfig.functions.json` current measured = `strict:false` / `noImplicitAny:true` / `noUncheckedIndexedAccess` unset(off) → OD-1 之 `Record<string,string>[provider]` 解析為 `string`（非 `string|undefined`），`new URL(string, baseUrl)` clean。本 PR **禁改 tsconfig / compiler option**。

## 4. Architecture Gate Locks → 可機械驗收的 Code Gate 檢查點（ChatGPT ARCH-L1..L8，全 Blocking）

| Lock | 內容 | Code Gate 機械驗收動作 |
|---|---|---|
| ARCH-L1 | 只允許 §3 六處 diff；任何 runtime/DB/CAS/token/tenant/權限/audit payload 改動 = scope creep | `git diff -U0` 人工核 6 hunk = §3；`git diff --shortstat` 語義 +6/−6 |
| ARCH-L2 | `PROVIDER_INIT_PATHS` 固定 `Record<string, string>`；禁 provider union / type guard / usage-point `as` cast | grep diff 無 `union`/`as `/type-guard 新增；F1 逐字 == §3 |
| ARCH-L3 | `severity` 固定 `string`；禁建 audit severity union / enum | F3 逐字 == §3；無新 enum/union 宣告 |
| ARCH-L4 | 三檔不 import/invoke/修改 archive、R2、retention、checkpoint、cold-archive；`user-audit.ts` 禁改 | `git diff --name-status` 不含 `user-audit.ts`；grep 三檔 diff 無新 archive/R2/retention/checkpoint import |
| ARCH-L5 | Code Gate 必對 **committed blob** 重跑 forced tsc + esbuild byte-identical；不得沿用 spike hash | 見 §7 Code-Gate re-run recipe（base-blob vs committed-blob 各自 esbuild） |
| ARCH-L6 | `git diff --name-status` 必反查所有 changed files；不得漏報 source 或混入 `CLEANUP_PLAN.md`/`MANUAL_TODO.md` | Code Gate 報告貼完整 `--name-status`；stage 用明確檔清單、禁 `git add .`/`-A` |
| ARCH-L7 | ratchet 只允許 `558 → 543`；reduce PR 禁 `--update` baseline | 跑 `typecheck:ratchet` 讀真實輸出；baseline `1119/175` 不動 |
| ARCH-L8 | merge 必須 owner 明示 `MERGE_ALLOWED`；approval ≠ coding/merge authorization | 4 道外部 gate 全過後停手等 owner |

## 5. Open Decisions（皆已 resolved，無待決）
- **OD-1（resolved）**：`PROVIDER_INIT_PATHS: Record<string, string>`。runtime 由 `SUPPORTED_PROVIDERS.includes(provider)` gate 保護不變；tradeoff = compile-time key safety 略鬆（接受）。此為殿後 requireRole 12×TS7053 的 index-sig 先例，但本 PR **不**擴張到 requireRole。禁 provider union / type-guard / usage-point `as`（ARCH-L2）。
- **micro（resolved）**：`severity: string`（忠實反映 call-site 全傳 `'warn'`/`'info'` 字面 + `safeUserAudit` loose any-sink 自驗 `KNOWN_SEVERITY`）。本 PR 不建 severity union（ARCH-L3）。
- **OD-2（resolved）**：`request: Request`（非 `CfRequest`）。三檔皆不讀 `request.cf`（grep 0 命中）；request 之 sink（`replay.ts`→`requireStepUp` @`auth.ts:198`；`accept.ts`→`requireRegularAccessToken` @`auth.ts:298`，皆 `request: Request`；兩檔 + loose `safeUserAudit` 皆不讀 `.cf`；`game/login.ts` 僅 `new URL(request.url)`、無 forward-sink）非 `.cf`-consumer（`device-alerts` / `risk-score`，本批**不** import）→ CfRequest opt-in 未觸發、過寬否決（`env.d.ts:97-98` opt-in 紀律，對齊 PR-2aa/2bb/2cc/2cd chain precedent）。此決策鏡像 chain：pr2cc:95「本檔不讀 request.cf → 違反 CfRequest opt-in 紀律、過寬。否決，用 Request」。

## 6. 七維 pre-clearance（對齊 plan-self-review 7 finder；每維：本 PR 為何無 gap）
- **security-boundary**：三 handler 的 auth gate（`requireStepUp`/`requireRegularAccessToken`）與參數驗證流程**逐字未改**，僅標 ctx/helper 型別。byte-identical 證 runtime 授權路徑不變。
- **tenant-scope**：無 query 改動。`accept.ts` 的 tenant 由 invitation row 衍生（domain `acceptInvitation` 內、未改）；`replay.ts` 為 server-actor admin 端、無 tenant query 改動。
- **migration**：本 PR **無 migration**（純 type-only、無 schema/DB 改動）。
- **api-contract-enum**：response DTO shape、error code、enum **全未改**；`Record<string,string>` / `Record<string,unknown>` 為**內部**型別、不進對外 contract。
- **high-risk-state-idempotency**：`replay.ts` 的 CAS-gated `db.batch`（S1 reset + S2 stamp、both-or-neither、409 idempotent no-op）**逐字未改**；`accept.ts` 一次性 token consume + LIVE-membership-gated replay 未改。byte-identical 佐證。
- **naming-ssot**：Convention A 逐字對齊 SSOT（~30 shipped handler）；`Env`/`Request` 全域型別；CfRequest opt-in alias 經 sink-trace 否決（見 §5 OD-2）、本 PR 不新增 alias、無新命名概念。
- **spec-scope**：6 處 diff ⊆ SPEC_APPROVED scope；不觸任何 Non-goal（§11）；15 個 leaf error 每一條對應一處 §3 diff（Acceptance Criterion 全覆蓋）。

## 7. Scout 實證 + ARCH-L5 Code-Gate re-run（不沿用 spike hash）
**Scout（read-only spike，工作樹已 `git checkout --` 還原零殘留）**：
- forced tsc sort-diff：`558 → 543`（−15）；REMOVED = 恰 §2 十五條、**ADDED = 空（0）**、全 build 無連鎖。
- byte-identical emit 3/3（canonical esbuild `--loader=ts --format=esm` **stdin**）：login `6f6df247…` / replay `405d4bfc…` / accept `441aebb6…`（base == spike）。
- dual-leaf：`replay.ts` 被 `event-dlq-replay.test.ts:25` 經 `(handler as (ctx:unknown)=>Promise<Response>)(…)` 型別抹除 cast + `env` from `cloudflare:test`（assignable）；`accept.ts` 被 `member-endpoints.test.ts:35` 經 `call(handler:(ctx:unknown)=>unknown,…)` 同款 wrapper → 皆 PR-2de 第 3 變體（最安全）、**非** ecpay narrow-literal TS2345 陷阱；`game/login.ts` 無 test/production importer（functions-leaf only）。內部 helper `auditReplay`/`emitDenied` 未 export → 無 test-leaf 曝露；`safeUserAudit(env,entry)` 仍 loose JS（雙 implicit-any）→ 灌 any-sink 零新錯。

**ARCH-L5 Code-Gate re-run recipe（Phase 2 對 committed-blob 重跑，證據以此為準）**：
1. `git show <base>:<file>` 與 `git show HEAD:<file>` 各自 `| esbuild --loader=ts --format=esm | sha256sum` → 3 檔 base-blob == committed-blob。
2. `npx tsc -b tsconfig.solution.json --force --pretty false` → sort-diff vs base：REMOVED 恰 15、ADDED=0、total 543。
3. import-graph（三檔 importer 集合）交 **Codex Plan Gate** 複核（pre-empt bounce）。

## 8. 測試影響（無 test 改動）
- `tests/integration/event-dlq-replay.test.ts`（import replay handler）、`tests/integration/member-endpoints.test.ts`（import accept handler）：皆型別抹除 wrapper、`env` from `cloudflare:test` → 標註後 tests-leaf ADDED=0，**不改任何 test**。
- `game/login.ts`：無 test importer。
- Code Gate 仍跑 full `test:int`（75f/1328 baseline）+ `test:cov` 佐證 runtime 行為不變（byte-identical 已先證）。

## 9. Phase 2 執行序（待 owner `CODING_ALLOWED` 後）
1. branch `refactor/stage7-pr2di-nontoken-handlers-noimplicitany`（自 `86fbe70d`）。
2. Edit §3 六處 frozen diff（逐字）。
3. 明確 stage 3 source 檔（`git add <三檔>`）——**禁** `git add .`/`-A`、**排除** `CLEANUP_PLAN.md`/`MANUAL_TODO.md`/本 gate-log（gate-log 另 commit）。
4. 機械層 9 gates 全綠（直接跑命令讀真實輸出）：forced tsc REMOVED=15/ADDED=0 · byte-identical 3/3(committed-blob) · `typecheck:ratchet` 558→543 · `lint` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
5. 維度 A **code self-review workflow**（L2/L3 multi-agent，語意維 fan-out → 主線親裁至一輪 0 新發現）→ `CODE_SELF_REVIEW_CLEAN`。
6. commit（source commit + gate-log docs commit，分開；禁空 commit、禁 amend、禁 `--no-verify`）→ 中文報告 6 欄。
7. → ③ **Codex Code Gate**（對 committed blob）→ `CODEX_CODE_APPROVED`。
8. → ④ **ChatGPT Faithfulness**（複核包：approved-plan 錨點 + 機械 git artifacts `--name-status`/`--stat`/完整 hunks + OD 裁決）→ `CHATGPT_CODE_FAITHFULNESS_APPROVED`。
9. **待 owner `MERGE_ALLOWED`** → 開 PR → squash-merge（唯一進 main）。
10. post-merge：驗 main CI 綠（注意 pre-existing `jwt.test.ts` ~1.6% flaky，紅則 rerun、非本 PR）+ ratchet 543 + memory topic receipt + `MEMORY.md` index + `node memory/check-memory.mjs` budget check + 刪 packet。

## 10. Rollback
byte-identical emit → 無 runtime 行為可回滾；如需撤回＝revert squash commit（純 type-only、無 schema/DB/deploy 副作用，無 expand/migrate/contract 顧慮）。

## 11. Non-goals / anti-scope（違反 = scope creep = Gate fail，回 PLAN_DRAFT）
- 不改 runtime 邏輯、DB query、CAS batch、token consume、tenant join、權限流程、audit payload shape。
- 不改 `functions/utils/user-audit.ts` 或本批 3 檔以外任何檔（含 tsconfig / env.d.ts / tests）。
- 不做 provider union / type-guard refactor；不建 severity enum/union。
- 不觸 F-3 dormant（archive/R2/retention/checkpoint/cold-archive 禁改/import/invoke）。
- 不擴張到 requireRole（TS7053 先例僅建立、不順手清）。

## 12. F-3 DORMANT boundary
三檔不 import/invoke archive/R2/retention/checkpoint。`replay.ts` 操作 `event_outbox`/`event_dlq` = PR5 event outbox（活躍系統，非 F-3 冷歸檔）。唯一 F-3 transitive 觸點 = `safeUserAudit → cold_class`；本 PR 不新增 import / 不新增 invoke path / 不改 call args / 不改 `user-audit.ts` → **F-3 dormant surface provably unchanged**。

## 13. memory-import provenance（§12 memory-import rule）
本 PLAN 已 import：Convention A SSOT（PR-2dd..2dh receipts）、dual-leaf 第 3 變體分類（PR-2de）、byte-identical canonical recipe（`feedback_byte_identical_emit_verification`）、D1=any（`feedback_d1database_resolves_any_no_workers_types`）、util env full-Env vs Pick 判定（`feedback_util_env_param_pick_not_full_env`：內部 helper 無 partial-fake-env caller → `env: Env` 安全）、F-3 DORMANT 紅線（`project_audit_phase2`）。

---

## 14. Phase 2 execution receipt（gate-log；append-only）
- **CODING_ALLOWED**（owner 明示，本 session）→ branch `refactor/stage7-pr2di-nontoken-handlers-noimplicitany` @ base `86fbe70d`。
- **Source commit `a2295981`**（`a22959818a9566e9e9b99c746779ee6e6e8363da`）：§3 六處 frozen diff 逐字套用；`git diff -U0` 人工核 6 hunk == §3；`3 files changed, +6/−6`；`--name-status` 僅 3 source 檔（無 `user-audit.ts`/tsconfig/env.d.ts/tests/`CLEANUP_PLAN.md`）。
- **機械層 9 gates（直接跑真實輸出）**：
  - forced-tsc：BASE `558` → current `543`；**REMOVED=15**（逐條 == §2 leaf：replay 8 / login 3 / accept 4）、**ADDED=0**；543 全為 70xx noImplicitAny 家族、0 TS2xxx。
  - byte-identical committed-blob 3/3（esbuild 0.21.5，`git show BASE` vs `git show a2295981`）：login `6f6df24706082e3c` / replay `405d4bfc6cdee92e` / accept `441aebb6c231b454`。
  - `typecheck:ratchet` 558→543、ratchet OK、baseline `1119/175` 未動（無 `--update`）｜`lint` clean｜`verify:browser-pipeline` OK（25 pages/214 hash）｜`test:int` 75f/1328｜`test:cov` 25f/737｜`build:functions` Compiled OK｜`npm audit --omit=dev --high` 0 vuln。
- **維度 A code self-review workflow**（plan §9 step 5；owner 選 multi-agent）：`wf_10739e54-963`（23 agents；跨 session 中斷後 `resumeFromRunId` 續跑，cached 5 + 重跑 contract-enum/naming-ssot/regression-lock + verify）。7 語意維 finder → 對抗式 verify。
  - **結果：15 findings 全 `refuted`、0 accepted、0 suspicious_input**（全 tier3）。
  - 兩條探到 approved 決策點者經 verify 正確 refuted：**contract-enum**「`Record<string,string>` 放寬 index」＝ OD-1 已批准 tradeoff（收緊需 ARCH-L2 禁止之 type-guard；改前 `{discord:string}[provider:string]` 本即 15 錯之一、從非可編譯 guard）；**naming-ssot**「`severity: string` bare」＝ micro 已批准（全 functions 無 `type AuditSeverity` SSoT、runtime `KNOWN_SEVERITY` 兜底、`audit-aggregate.ts` JSDoc 早已 bare string）。
  - **主線親裁**（獨立讀真 diff、不採 subagent raw）：diff shape / forced-tsc REMOVED=15·ADDED=0 / byte-identical / Convention A 逐字對齊 121 siblings / import-graph 皆本 session 自驗，與 15 refuted 一致 → **0 source 改動**。
  - **→ `CODE_SELF_REVIEW_CLEAN` @ `a2295981`**（一輪 0 accepted）。
- **gate-log docs commit**：本檔（plan doc）獨立於 source commit。
- **下一步**：③ Codex Code Gate（committed blob `a2295981`）→ ④ ChatGPT Faithfulness（複核包：本檔 anchor + git artifacts + 3 hunks + OD rulings）→ owner `MERGE_ALLOWED` → squash（唯一進 main）。
