# Stage 7 PR-2dp — noImplicitAny 續清（oauth domain 棒2：admin oauth-clients RBAC pair）

**SPEC**: `STAGE7_ADMIN_OAUTH_CLIENTS_NOIMPLICITANY`
**狀態**: `SPEC_APPROVED_WITH_LOCKS · Plan gates ①② 全過〔ARCH_APPROVED_WITH_LOCKS + PLAN_DOC_REVIEW_APPROVED + CODEX_PLAN_APPROVED_WITH_LOCKS〕· AWAITING owner CODING_ALLOWED`
（scout + transient overlay 完成 → owner 需求糾正〔L2 實作 / L3 security review〕+ OD 全裁〔`OWNER_OD_ACCEPTED`〕→ **① ChatGPT Architecture Gate = `CHATGPT_ARCH_APPROVED_WITH_LOCKS`** → 本 plan doc formalize locks + evidence → **GPT 覆核本 doc ✅ `CHATGPT_PLAN_DOC_REVIEW_APPROVED`（0 required、10 檢查項全 PASS）** → **② Codex Plan Gate ✅ `CODEX_PLAN_APPROVED_WITH_LOCKS`（0 required、live replay 重證）** → **待 owner `CODING_ALLOWED`**；**repo 未動 / 無 commit / 無 PR / 非 CODING_ALLOWED**；tree = pre-existing `?? CLEANUP_PLAN.md` + 本 plan doc〔untracked、無 commit〕）
> **gate 進程**: scout（19 錯、zero dual-leaf、per-file loc 定位）→ **transient overlay 實測**（`REMOVED=19 / ADDED=0` + 2 檔 byte-identical `6288/7900` + eslint 0，已 `git checkout --` 還原、**overlay 零殘留**）→ owner **需求糾正 + OD 全裁** → **① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（10 locks 落地）** → **本 plan doc** → **GPT 覆核本 doc ✅ `CHATGPT_PLAN_DOC_REVIEW_APPROVED`（0 required）** → **② `CODEX_PLAN_APPROVED_WITH_LOCKS`（0 required、Codex live replay REMOVED=19/ADDED=0/byte-identical 重證）** → CODING_ALLOWED（owner 明示）→ CODE fresh replay → ③ Codex Code → ④ ChatGPT faithfulness → squash。
> **狀態 SoT**: 本 header + 對應中文報告為當前 gate-state 權威。**Plan stage 全過**：① Arch `APPROVED_WITH_LOCKS` + plan doc GPT 覆核 `PLAN_DOC_REVIEW_APPROVED` + ② Codex Plan `CODEX_PLAN_APPROVED_WITH_LOCKS`（皆 0 required revision）。**尚未 coding**——② 明示 **≠ code approval / ≠ commit / ≠ PR / ≠ merge**；CODE 前須 owner 明示 `CODING_ALLOWED`。

**base**: `7d12a7e9`（origin/main，#141 PR-2do oauth-utils SHIPPED 後）
**級別**: **L2 implementation + L3 security review**（owner 需求糾正 2026-07-08：實作量純 type-only 屬 L2；但觸及 admin / OAuth / DELETE handler / RBAC / step-up 邊界，治理與審查輸出升 L3 security-context）
**性質**: 純 type-only noImplicitAny 標註（`oauth-clients.ts` **7→0** · `oauth-clients/[client_id].ts` **12→0**；合 **19→0**）、byte-identical emit（esbuild stdin-pipe 實證）、**零 runtime / 零 schema / 零 API / 零 migration / 零部署面 / 零 test 改動**。2 檔為 admin oauth-clients RBAC-gated CRUD handler（`requireRole('admin')` / `requireStepUp` P0-5 / `requireAnyScope` / fine-grain scope / audit hash-chain），本棒僅描述型別、runtime 一字不改（byte-identical 坐實 first-do-no-harm）。

**owner ruling（2026-07-08）**: 5 棒序（棒1 utils leaf ✅ PR-2do SHIPPED → **本棒＝棒2 admin RBAC pair** → 棒3 flow handlers → 棒4 callback.ts → 棒5 LINE id_token hardening）。本棒 **single bang（19、2 檔）**。`OWNER_OD_ACCEPTED: single bang / Record<string, unknown> / isStringArray type guard / 3 erased casts / L2 implementation with L3 security review / plan doc companion`。

---

## 1. 錯誤帳（forced tsc `-b tsconfig.solution.json --pretty false --force`；19 raw = 19 uniq、**zero dual-leaf**、全 TS70xx functions-leaf、無 TS2xxx cascade）

### 1.1 `functions/api/admin/oauth-clients.ts`（7：3 TS7006 + 4 TS7031）
| loc（base） | error | form |
|---|---|---|
| 29,33 | TS7006 `uri` | `function isHttpsOrChiyigoScheme(uri: unknown): boolean`（內部 `typeof uri !== 'string'` narrow）|
| 40,24 | TS7006 `v` | `function isStringArray(v: unknown): v is string[]`（type guard，OD-B）|
| 48,29 | TS7006 `body` | `function validateCreateBody(body: Record<string, unknown>)`（OD-A flat property bag）|
| 104,38 / 104,47 | TS7031 `request` / `env` | `onRequestGet({ request, env }: { request: Request; env: Env })` |
| 131,39 / 131,48 | TS7031 `request` / `env` | `onRequestPost({ request, env }: { request: Request; env: Env })` |
| **53（enabler）** | —（cast，非獨立 tsc 錯）| `CLIENT_ID_RE.test(client_id as string)`（OD-C；貼近既有 regex path）|
| **76（enabler）** | —（cast，非獨立 tsc 錯）| `VALID_APP_TYPES.has(body.app_type as string)`（OD-C；貼近既有 set-membership path）|

### 1.2 `functions/api/admin/oauth-clients/[client_id].ts`（12：3 TS7006 + 9 TS7031）
| loc（base） | error | form |
|---|---|---|
| 21,33 | TS7006 `uri` | `function isHttpsOrChiyigoScheme(uri: unknown): boolean` |
| 32,24 | TS7006 `v` | `function isStringArray(v: unknown): v is string[]`（type guard，OD-B）|
| 38,38 / 38,47 / 38,52 | TS7031 `request` / `env` / `params` | `onRequestGet({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })` |
| 65,24 | TS7006 `body` | `function buildPatchSet(body: Record<string, unknown>)`（OD-A flat property bag）|
| 133,40 / 133,49 / 133,54 | TS7031 `request` / `env` / `params` | `onRequestPatch({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })` |
| 192,41 / 192,50 / 192,55 | TS7031 `request` / `env` / `params` | `onRequestDelete({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })` |
| **84（enabler）** | —（cast，非獨立 tsc 錯）| `VALID_APP_TYPES.has(body.app_type as string)`（OD-C）|

> **type surface（zero 新 named interface、zero export）**：5 handler-ctx inline 標註（涵蓋 13 TS7031 binding element）+ 4 helper param（`(uri: unknown): boolean` ×2 / `(v: unknown): v is string[]` ×2）+ 2 body param（`Record<string, unknown>`）+ **3 erased cast**（`client_id as string` ×1、`body.app_type as string` ×2）。`Env`/`Request` 為 global ambient（2 檔未 import；由 overlay ADDED=0 反證解析成功）。2 檔為 leaf route handler、**無 TS importer** → 型別面全 module-local。

### 1.3 Block locks（① `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 2026-07-08 逐字落地；owner refined 10 條）

| Lock | 內容 |
|---|---|
| **SCOPE-LOCK** | 僅允許 `functions/api/admin/oauth-clients.ts`、`functions/api/admin/oauth-clients/[client_id].ts`、plan doc companion。**禁改** `utils/auth`、`utils/requireRole`、`utils/oauth-clients`、`utils/audit-log`、`utils/user-audit`、`utils/scopes`、tests、schema、migration、`env.d.ts`、其他 handler。 |
| **RUNTIME-LOCK** | 2 檔 esbuild stdin-pipe emit 必 byte-identical，且輸出長度**非 0**。既有 **6288 / 7900** 可作 scout baseline，但 CODE stage 必 **fresh replay**（見 REPLAY-LOCK）。禁改任何 runtime branch / D1 query / RBAC gate / step-up / audit-chain / validation branch / normalized output。 |
| **TYPE-LOCK** | 僅允許 annotation、inline handler context type、`unknown` helper param、`v is string[]` guard、3 處 erased cast。**zero named interface、zero export。** |
| **UNKNOWN-BOUNDARY-LOCK**（OD-A）| `body: Record<string, unknown>` **只代表既有 flat property access boundary**，**不代表 schema validated body**。**禁 DTO / interface 偽裝、禁 `any`、禁新增 runtime guard。** |
| **CAST-LOCK**（OD-C）| 3 處 `as string` **僅允許貼近原 `.test` / `.has` 使用**（regex / set-membership 既有 runtime path），**不得擴散到 handler-level domain object**、不得新增 branch 或 validation。若加 `// SAFETY:`，**必須重新驗 byte-identical**（esbuild strip 註解已實測、byte-identical 不破，仍以 CODE stage fresh replay 為準）。 |
| **CASCADE-LOCK** | forced tsc set-diff 必 `REMOVED=19 / ADDED=0`（全 solution、含 tests-leaf、dual-leaf-aware）。若新增 TS2xxx 或測試型別錯 → **回 Plan Gate，不得現場補 mock**。 |
| **TEST-LOCK** | 不改 test（`tests/integration/admin-oauth-clients.test.ts`、`tests/integration/oauth-clients-d1.test.ts`）、不加 `as unknown as` mock、不新增 test。理由＝runtime byte-identical + ADDED=0。 |
| **SECURITY-SEPARATION** | RBAC（`requireRole`/`requireAnyScope`/`effectiveScopesFromJwt`）、step-up P0-5（`requireStepUp` ELEVATED_ACCOUNT）、fine-grain scope、audit hash-chain（`appendAuditLog`/`safeUserAudit`）、validation branch、D1 query、normalized output **全部禁止變更**（byte-identical 強制）。 |
| **REPLAY-LOCK** | CODE stage **不得引用 overlay 結果作 final evidence**；必須在 source commit 上 fresh replay：ratchet / forced tsc set-diff / byte-identical / lint / CI gates。 |
| **DOC-LOCK** | plan doc companion **只記錄 gate / scope / OD / locks / evidence**；不得夾帶 source / test / schema / migration；不得把 scout overlay 當正式 code evidence。 |

## 2. SSOT 對齊（每個型別決策的真相源）

- **handler-ctx（13 TS7031；zero OD）**：既定 idiom，全 codebase 一致（同域 admin siblings `admin/users.ts`、`admin/billing/wallets/[tenantId]/adjust.ts`、`admin/requisitions/[id]/save.ts` 等實證）：
  - `{ request, env }: { request: Request; env: Env }`（collection GET/POST）
  - `{ request, env, params }: { request: Request; env: Env; params: Record<string, string> }`（item GET/PATCH/DELETE）
  - `Env` / `Request` 為 global ambient（`types/env.d.ts` + WebWorker lib）、2 檔沿慣例不 import；overlay ADDED=0 反證解析。

- **`body: Record<string, unknown>`（OD-A UNKNOWN-BOUNDARY-LOCK）**：`request.json()` 於 call site 為 **`any`**（WebWorker lib `Body.json(): Promise<any>`；**overlay ADDED=0 反證** `any` boundary assignable 到 `Record<string, unknown>` param——若為 `unknown` 則觸 `TS2345` cascade、實測不成立）。現有 code 對 body 做 **flat property access + 手寫 runtime 檢查**（`typeof` / `isStringArray` / `isHttpsOrChiyigoScheme` / `VALID_APP_TYPES.has`）。本棒**選擇**把 param 由隱式 `any` 收斂為 `Record<string, unknown>`（object with unknown-valued keys、比 `any` 誠實），**精確描述「既有 flat property bag 存取邊界」**——與 PR-2do **OD-2 `rowToClient(row: Record<string, unknown>)`** 同性質（boundary bag、**非** validated domain object）。⚠ **明確不採 shape interface**（會宣稱 body 為已驗證 DTO、隱藏信任邊界，PR-2do OD-1 已 ban 此類偽裝）。與 OD-1 nested-access 情境的差異：本 body 為 **flat access**（無 `raw.picture?.data?.url` 類 nested chain），故 `Record` 直通不觸 TS18046、可用；不需 PR-2do 的 provider-specific erased interface。
  - `Record` value type = `unknown` → `body.redirect_uris` 等經 `isStringArray` type-guard narrow 為 `string[]` 後才 `.length` / `.every`（見 OD-B）；`.test` / `.has` 對非 guard 覆蓋的 `client_id` / `app_type` 用 OD-C erased cast。`tsconfig.functions.json` `strict: false`（strictNullChecks OFF）不影響本路徑（Record value 為 `unknown` 而非 `string[] | undefined`）。

- **`isStringArray(v: unknown): v is string[]`（OD-B）**：**誠實 user-defined type guard**——runtime check `Array.isArray(v) && v.every(s => typeof s === 'string')` **正是** `v is string[]` 的型別依據（narrowing 不超過 runtime evidence）。作用：讓 caller（`body.redirect_uris.length` / `.every(...)`）由 guard narrowing 免 cast。**縮窄範圍鎖死**＝僅 `Array.isArray + every(typeof === 'string')` 對應 `string[]`，禁過度宣稱。return-type annotation 於 emit 抹除 → byte-identical 不破。

- **`isHttpsOrChiyigoScheme(uri: unknown): boolean`**：內部 `if (typeof uri !== 'string' || !uri) return false` 自行 narrow → `new URL(uri)` 合法。caller `.every(isHttpsOrChiyigoScheme)`（`string[]`）與 `isHttpsOrChiyigoScheme(body.backchannel_logout_uri)`（unknown）皆 assignable（param contravariance）。

- **3 erased cast（OD-C CAST-LOCK）**：`CLIENT_ID_RE.test(client_id as string)`（validateCreateBody；client_id 由 Record destructure 為 unknown、`.test()` 要 string）、`VALID_APP_TYPES.has(body.app_type as string)` ×2（validateCreateBody + buildPatchSet；`Set<string>.has()` 要 string）。**cast 只服務既有 regex / set-membership runtime path**，emit 抹除（`test(client_id as string)` → `test(client_id)`）→ byte-identical。與 PR-2do **OD-2 `row.client_id as string`** 同性質（boundary erased cast、不宣稱已驗證、不新增信任邊界）。

## 3. 證據（scout transient overlay 實測 @ working-tree `7d12a7e9`，已 `git checkout --` 還原、**overlay 零殘留**；CODE stage 於 source commit **fresh replay** 重證，REPLAY-LOCK）

**A. forced tsc set-diff** — `npx tsc -b tsconfig.solution.json --pretty false --force`（uniq set、`sort -u` 後 `comm`）：
- base error set = **453**（= ratchet report 453/26/309）。
- 套 2 檔 type-affecting overlay → **434**；set-diff **REMOVED=19**（精確：oauth-clients.ts 7 + `[client_id].ts` 12，全 TS70xx〔6 TS7006 + 13 TS7031〕）/ **ADDED=0**（全 solution、含 tests-leaf；[[feedback_tsc_forced_solution_dual_leaf_error_count]]）。errorFiles 26→24、cleanFiles 309→311（CODE stage 重跑確認）。baseline `1119/175` frozen（reduce 禁 `--update`）。
- **cascade 結論**：與 PR-2do OD-5（option A 掀 23 test-mock cascade）不同，本棒 combo（Record + guard + cast + handler-ctx）**零 cascade**（無 test-mock、無 consumer、無內部 narrow cascade）。此為 combo 直接坐實、**非推斷**。

**B. byte-identical emit**（esbuild stdin-pipe、before==after、**非 vacuous**）：
| 檔 | base==head bytes | 結果 |
|---|---|---|
| `admin/oauth-clients.ts` | 6288 == 6288 | ✅ IDENTICAL |
| `admin/oauth-clients/[client_id].ts` | 7900 == 7900 | ✅ IDENTICAL |
> RUNTIME-LOCK 坐實（runtime branch / D1 query / RBAC gate / step-up / audit-chain / validation / normalized output 100% 未動；interface / return type / `as` cast / 參數註記 / 註解全於 emit 抹除）。
> **⚠ 驗法（[[feedback_byte_identical_emit_verification]]）**：byte-identical **必走 Git Bash stdin-pipe** — `git show HEAD:<f> | node_modules/.bin/esbuild --loader=ts --format=esm` vs `cat <f> | node_modules/.bin/esbuild --loader=ts --format=esm`，逐一 `cmp -s`。canonical recipe **必含 `--format=esm`**；`--loader=ts` 對 **file-arg 會 error → 0-byte vacuous 假 pass**，故必驗 **byte > 0**。PowerShell 5.1 無 `<` stdin redirection、命令走 Git Bash。**esbuild strip `//` 註解已實測**（`// SAFETY:` 於 emit 消失）→ CAST-LOCK 的 SAFETY 註解與 byte-identical 相容（仍以 CODE fresh replay 為準）。

**C. eslint**：`npx eslint functions/api/admin/oauth-clients.ts 'functions/api/admin/oauth-clients/[client_id].ts'` **EXIT 0**（type guard / inline ctx type / erased cast 無新 lint；無 `no-undef`）。

**D. transient revert clean**：`git checkout -- functions/api/admin/oauth-clients.ts 'functions/api/admin/oauth-clients/[client_id].ts'` → `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（pre-existing）+ 本 plan doc（untracked）、`git diff --stat` 空（未 commit、零殘留）、HEAD 未動 `7d12a7e9`、ratchet 還原後仍 453/26/309。

**E. TEST-LOCK 佐證**：`tests/integration/admin-oauth-clients.test.ts` / `oauth-clients-d1.test.ts` 存在；ADDED=0 全 solution（含 tests-leaf）→ 這些 test **零新增型別錯** + runtime byte-identical → 不需改 test。

## 4. 本地機械 gate（CODE stage 全套實跑；對齊 CI `ci.yml`；REPLAY-LOCK＝禁沿用 overlay）

CODE stage @ final source commit 必跑並讀真實輸出：`typecheck:ratchet`（enforce、baseline `1119/175` frozen 未 `--update`；帶 `RATCHET_BASE_REF=$(git rev-parse main)`；report 應 453→434）· `lint`（eslint + lint:workflows）· `verify:browser-pipeline` · `test:cov`（含 `admin-oauth-clients.test.ts` — TEST-LOCK 下不改）· `test:int`（含 `oauth-clients-d1.test.ts`）· `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。另 **REPLAY**：forced tsc set-diff（`REMOVED=19 / ADDED=0`、全 solution、dual-leaf-aware）+ byte-identical（esbuild stdin-pipe before==after、2 檔非 0 byte）於 **source commit fresh replay**。**`TS-CAST-REGISTRY` 人工核（② Codex residual）**：ratchet 只 ban explicit `any` / `as any`、**不機械攔** 3 處 non-`any` `as string`，故 CODE stage 必**人工核 cast surface = 恰 3 處**（`client_id as string` ×1 @ `.test` + `body.app_type as string` ×2 @ `.has`）、**無第 4 處、無擴散到 handler-level domain object**（CAST-LOCK）。Windows `public/` CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。
> known flaky `jwt.test.ts`（~1.6%/run）撞到即 rerun。

## 5. Open Decisions / owner ruling（2026-07-08）

| 項 | 裁決 | SoT / 理由 |
|---|---|---|
| 級別 | **L2 implementation + L3 security review** | 實作純 type-only；審查因 admin/OAuth/DELETE/RBAC/step-up 邊界升 L3 security-context |
| 拆棒 | **single bang（19、2 檔）** | 2 檔同一 admin oauth-clients concern、共用 helper/type-pattern；overlay 證 REMOVED=19/ADDED=0/byte-identical；拆分只有 gate 成本、無風險收益 |
| **OD-A** body 標型 | **`Record<string, unknown>`** | 精確定義＝「既有 runtime 對 flat JSON property bag 的 type-only 描述」、**非 validated DTO**；禁 shape interface（PR-2do OD-2 analog）|
| **OD-B** `isStringArray` | **type guard `(v: unknown): v is string[]`** | 有 runtime check 支撐、省 caller cast、emit 抹除、byte-identical 已證；縮窄鎖死 `Array.isArray + every(typeof === 'string')` |
| **OD-C** erased cast | **3 處 `as string`** | 僅服務既有 `.test` / `.has` regex/set-membership path、不新增信任邊界；`// SAFETY:` 加註須重驗 byte-identical |
| plan doc companion | **採** | 符合 Stage 7 慣例；限 plan doc、不夾帶 source/test/schema/migration（DOC-LOCK）|

### 5.1 風險表（① ChatGPT Arch 輸出）
| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| `Record<string, unknown>` 被誤讀成 body 已驗證 | 中 | 後續可能基於錯誤型別擴邏輯 | UNKNOWN-BOUNDARY-LOCK 明寫「flat property bag only；not validated DTO」|
| helper type guard 宣稱過度 | 低 | 型別縮窄超過 runtime check | 僅允許 `Array.isArray + every(typeof === 'string')` 對應 `string[]` |
| erased cast 掩蓋真實 invalid body | 中 | 型別通過但 runtime 邏輯仍沿舊路徑 | CAST-LOCK：僅限既有 `.test/.has`、不得新增 branch 或 validation |
| RBAC / step-up / audit 被誤改 | **高** | admin 權限邊界破壞 | byte-identical 強制；SECURITY-SEPARATION lock |
| test-mock cascade | 低 | 可能牽動測試假資料 | overlay 已證 ADDED=0；TEST-LOCK 禁改 test |
| SCOUT receipt 被重用 | 中 | 最終 commit 可能與 overlay 不一致 | REPLAY-LOCK：CODE stage 必 fresh replay、不准沿用 overlay |

### 5.2 防禦表（① ChatGPT Arch 輸出）
| 機制 | 處理否 | 實作 | 未處理因 |
|---|---|---|---|
| RateLimit | 不改 | byte-identical 保持原狀 | type-only 棒、禁 runtime 改動 |
| 權限 | 處理 | `requireRole` / scope / step-up 一字不動 | byte-identical 驗證 |
| Input | 處理 | 僅補 `unknown` / `Record<string, unknown>` / type guard | 禁新增 runtime validation |
| XSS | 不改 | 無輸出面變更 | type-only 棒 |
| Log / Audit | 處理 | audit hash-chain 一字不動 | byte-identical 驗證 |
| Retry | 不改 | 無外部呼叫策略變更 | 非本棒範圍 |
| 備援 | 不改 | 無 infra / fallback 改動 | 非本棒範圍 |
| 監控 | 不改 | 無 log schema / metric 改動 | 非本棒範圍 |

### 5.3 Gate 收據
- **scout overlay 實測**（2026-07-08 @ `7d12a7e9`）：REMOVED=19 / ADDED=0 · byte-identical 2 檔（6288 / 7900、非 vacuous）· eslint 0 · transient revert clean。
- **owner 需求糾正 + OD 全裁**（2026-07-08）：級別 L2 impl + L3 security review；OD-A/B/C + 拆棒 + plan doc companion 皆 `OWNER_OD_ACCEPTED`。
- **① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（2026-07-08）：可進 Codex Plan Gate；**≠ `CODING_ALLOWED`、≠ 可 commit、≠ 可改 repo**。10 locks（SCOPE / RUNTIME / TYPE / UNKNOWN-BOUNDARY / CAST / CASCADE / TEST / SECURITY-SEPARATION / REPLAY / DOC）落地本 §1.3。`SPEC_APPROVED_WITH_LOCKS — STAGE7_ADMIN_OAUTH_CLIENTS_NOIMPLICITANY`。
- **GPT plan-doc 覆核 `CHATGPT_PLAN_DOC_REVIEW_APPROVED`**（2026-07-08 @ 正式 plan doc）：**0 required revision**；**10 檢查項全 PASS**（gate-state / scope / OD-A / OD-B / OD-C / runtime safety / cascade safety / test boundary / security separation / next sequence）；**≠ `CODING_ALLOWED`、≠ commit、≠ PR、≠ merge**。**1 non-blocking note**＝relay-hygiene（外部 relay 文字誤植截斷檔名 `docs/plans/sts-noimplicitany.md`；正式檔名 `docs/plans/stage7-pr2dp-admin-oauth-clients-noimplicitany.md` 正確、實檔已核無誤〔無 stray 檔〕、**不改 source**）。可送 ② Codex Plan。
- **② `CODEX_PLAN_APPROVED_WITH_LOCKS`**（2026-07-08 @ plan doc；**≠ `CODING_ALLOWED`、≠ code approval、≠ commit / PR / merge**）：**0 required / 0 material finding**。Codex live-repo 獨立驗：`HEAD`=`origin/main`=`7d12a7e9`、2 source 檔無 diff（untracked＝`CLEANUP_PLAN.md` + 本 plan doc）；10 locks decision-complete；live forced-tsc target grep 恰 **19**（oauth-clients.ts 7 + `[client_id].ts` 12）；ratchet **453/26/309**；non-mutating overlay replay **base 453 / overlay 434 / REMOVED=19 / ADDED=0**；esbuild overlay replay **6288 / 7900** output-identical 非 0。附邊界句（＝REPLAY-LOCK）：*Approval is for plan-doc direction and lock completeness only. It is not CODING_ALLOWED. Final CODE evidence must be fresh replayed on the source commit, not inherited from scout overlay.*
  - **residual `TS-GOV-MANIFEST`**（standing、同 PR-2do）：repo 無 `governance/rules.json` / TS governance manifest → enforcement = advisory + ratchet/live replay、非 rule enforcement。已知條件、非本棒新缺。
  - **residual `TS-CAST-REGISTRY`**（CODE-stage actionable）：ratchet 不機械攔 3 處 non-`any` `as string` → CODE stage 必人工核 cast surface 恰 3 處 @ `.test` / `.has`（見 §4）。
  - **doc-hygiene（② non-blocking、已修）**：header 舊述「tree 僅 CLEANUP_PLAN.md」漏列本 plan doc → 已更正為「CLEANUP_PLAN.md + 本 plan doc（untracked）」（§3.D 原已正確）。
- **CODING_ALLOWED**：**待 owner 明示**。之後 CODE fresh replay（REPLAY-LOCK）→ CODE self-review 至零 → commit → 報告 → ③ Codex Code → ④ ChatGPT faithfulness → squash。

## 6. 非 blocking notes
- **NB-1**：2 檔為 leaf route handler、**無 TS importer**（僅 Pages router 觸發）→ 型別面全 module-local、**zero export**（不同 PR-2do 之 `OAuthClient` export）；無跨模組 public contract 變更。
- **NB-2**：`isHttpsOrChiyigoScheme` / `isStringArray` / `VALID_APP_TYPES` 在 2 檔**重複定義**（現況既有）；本棒**不去重**（去重＝runtime 結構變更、破 byte-identical、超 scope）；各檔獨立標型。
- **NB-3**：DELETE handler（`[client_id].ts` onRequestDelete）無 request body、僅 handler-ctx 標註（3 TS7031）；`buildPatchSet` 僅 PATCH 用。
- **NB-4**：`env.d.ts` 不觸（SCOPE-LOCK）；`Env` 以 global ambient 解析，本棒不擴 Env surface。
- **NB-5**：shipped 集 = 2 source + 本 plan doc companion（per stage7 慣例、DOC-LOCK）；owner CODE 前可否決 plan doc companion。
- **NB-6**：本棒不觸 LINE id_token hardening（棒5、`callback.ts` verifyLineIdToken；runtime/security 行為變更、與 byte-identical type-only 互斥）。

## 7. 後續棒次
- 棒1 oauth utils（33）✅ PR-2do SHIPPED → **本棒 棒2 admin oauth-clients RBAC pair（19）** → **棒3 oauth flow handlers（26；init/end-session/bind-email/authorize/token/code）** → **棒4 callback.ts（27；Tier-0 最重，透過 `getProvider()` return consume 棒1 module-local `ProviderConfig`）** → **棒5 LINE id_token hardening（獨立 additive-security、非 type-only）**。
- oauth 域（105）清完 → **audit 域（381，殿後最重，含 F-3 DORMANT）** → noImplicitAny=0 後 rebaseline `1119→0` → `strict:true`(~998) → scripts → tests → browser。

---

## Index receipt（archive 用；本檔結案後搬 MEMORY 對應）
- 清 admin oauth-clients RBAC pair 2 檔 19 noImplicitAny → 0（oauth-clients.ts 7 + `[client_id].ts` 12；6 TS7006 + 13 TS7031、zero dual-leaf）；REMOVED=19 / ADDED=0、byte-identical（6288 / 7900）、eslint 0。
- OD-A `body: Record<string, unknown>`（flat property bag、非 validated DTO、PR-2do OD-2 analog）；OD-B `isStringArray` type guard；OD-C 3 erased cast（`.test`/`.has` regex/set-membership、mirror OD-2 `row.client_id as string`）；handler-ctx 既定 idiom（zero OD）。
- 級別 L2 impl + L3 security review；SECURITY-SEPARATION（RBAC/step-up P0-5/scope/audit hash-chain byte-identical）；REPLAY-LOCK（CODE fresh replay 禁沿用 overlay）。zero export、無 named interface（不同 PR-2do 之 OAuthClient export）。
