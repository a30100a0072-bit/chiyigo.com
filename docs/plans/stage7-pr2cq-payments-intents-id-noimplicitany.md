# Stage 7 reduce PR-2cq — `api/auth/payments/intents/[id].ts` noImplicitAny（**payments 域第一棒**；3 個 direct handler、**無 waitUntil、無 D1-row callback**、type-only、review care **L3**）

**目標**：`functions/api/auth/payments/intents/[id].ts` 的 **8 個 noImplicitAny error（8×TS7031：3 個 handler destructure 的 `request`/`env`/`params`）→ 0**，**純 type-only**（**3 個編輯點** ＝ 3 個 exported handler `onRequestOptions`/`onRequestGet`/`onRequestDelete` 的 destructured param annotation；TS erase 後 emit byte-identical）。本 PR ＝ **payments 大熱區第一棒**（owner C-1 2026-06-23：A 域全清後進 payments，light→heavy、payments 先 audit 殿後）。

**Scope（owner C-1 鎖 2026-06-23；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/payments/intents/[id].ts` | 8（3 handler destructure，全 TS7031）| **3 個編輯點**（`onRequestOptions` L24 / `onRequestGet` L28 / `onRequestDelete` L43 的 destructure param annotation）|

精確錯位（forced `tsc -b tsconfig.functions.json --force`，functions leaf total 809）：

```
functions/api/auth/payments/intents/[id].ts(24,42): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/payments/intents/[id].ts(24,51): error TS7031: Binding element 'env' implicitly has an 'any' type.
functions/api/auth/payments/intents/[id].ts(28,38): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/payments/intents/[id].ts(28,47): error TS7031: Binding element 'env' implicitly has an 'any' type.
functions/api/auth/payments/intents/[id].ts(28,52): error TS7031: Binding element 'params' implicitly has an 'any' type.
functions/api/auth/payments/intents/[id].ts(43,41): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/payments/intents/[id].ts(43,50): error TS7031: Binding element 'env' implicitly has an 'any' type.
functions/api/auth/payments/intents/[id].ts(43,55): error TS7031: Binding element 'params' implicitly has an 'any' type.
```

**恰 8 個**（owner C-1 預期一致）：3 handler × destructure param。`onRequestOptions`（request,env）= 2；`onRequestGet`（request,env,params）= 3；`onRequestDelete`（request,env,params）= 3。**無第 9 錯**：`row = await getPaymentIntent(env, { id })` → `getPaymentIntent` 的 `env` 參數 untyped、`.first()` 回 `any`（D1Database 解為 any，[[feedback_d1database_resolves_any_no_workers_types]]）→ row 為 any，`row.user_id`/`row.status`/`row.vendor` 等存取**無 cascade**；**無 register #111 的 `.all().map()` D1-row callback**（本檔查詢全走 util `getPaymentIntent`）。

> **主線定位（owner C-1）**：A 域（A1..A3 auth handler 層）全清（殿後棒 PR-2cp `local/login.ts` #114 `c04d1fab`）→ 進大熱區 **payments 域第一棒**。payments 域內 light→heavy：**① handler 層**（本棒 `auth/payments/intents/[id].ts`）→ ② `utils/payments.ts` → ③ `utils/payment-vendors/ecpay.ts` → ④ `webhooks/payments/[vendor].ts`。owner C-1 2026-06-23 裁 **單檔單獨成棒**（最乾淨入口、立 payments handler typing pattern）。**結構特性**：**3 個 direct handler**（`onRequestOptions`/`onRequestGet`/`onRequestDelete`，param 直接 destructure，**無 wrapper/worker、無 `ctx`、無 `waitUntil`**）；查詢走 util `getPaymentIntent`（`.first()`，**無 `.all().map()` D1-row callback**）→ payments 域**結構最簡入口**（8 錯、3 編輯點、零新 OD）。**但屬 Tier-0 金流** → review care L3。**排除**：`api/admin/payments/intents.ts`（**另立一棒**，含 TS7053 index + CSV PII export helper typing、首見 OD）、`payment-return/ecpay.ts`（**另列 trivially-clean micro PR 候選**、跨目錄不併）、其餘 12 個 payments 檔、util `utils/{payments,payment-vendors/*,...}.ts`、大熱區 `audit` 域（defer 殿後）。

## base 錨點（current main，非 stale）

- **base ＝ current main `c04d1fab`**（`git rev-parse HEAD` 實證 `c04d1fab668d26a4672f6f470d969181cbcc0fa4`、main clean〔僅 `?? CLEANUP_PLAN.md` untracked〕、`origin/main` 同步 `0/0`）。
- 此即 PR-2cp #114（login）squash commit；owner prompt base SHA 與實查一致、**無 stale 修正**（對比 PR-2cp 曾遇 stale base）。
- branch `stage7-pr2cq-payments-intents-id`（自 clean main `c04d1fab` 開、未 push）。
- payments scout 揭露 owner prompt domain map 3 處偏差（已回報、owner C-1 採納），但**不影響本棒 scope**：
  - `payment-return.ts (1)` 為幻影路徑 → 實 `payment-return/ecpay.ts (2)`，**本棒不處理**（另列 micro PR）。
  - `admin/payments/intents.ts (9)` 含 TS7053 + helper TS7006 首見 OD → **另立一棒**。
  - payments 域實為 **~125 errors / 15 files**（非 prompt 的 ~82/6）→ owner C-1 採為新 domain map 基準；full map 保留、第二棒排序前再附。

## annotation 形式裁定（owner C-1 採 function-declaration + inline param type）

- **正式 frozen form ＝ function-declaration ＋ inline param type**（沿 PR-2cp #114 owner C-1 裁定、[[feedback_gate_packet_replay_anchor_head_vs_base]] 同段「annotation 形式 = function-declaration、非 arrow const」）：
  ```ts
  export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
  export async function onRequestGet({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
  export async function onRequestDelete({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
  ```
- **禁** arrow const（破壞 byte-identical / 編輯點 / function-declaration hoisting runtime shape）、**禁** named type alias、**禁** 拆多行。
- `params: Record<string, string>` ＝ **repo 既有 convention**（13 個現役 handler 用，如 `admin/requisitions/[id]/delete.ts`、`requisition/[id].ts`、`tenants/[tenantId]/*`）→ 零新 OD。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔、3 annotation）/ review care **L3**（**owner C-1**：payments 屬 **Tier-0 金流**；本檔含越權雙欄過濾、soft-delete〔Codex P0-1 orphan 防護〕、`requirePaymentAccess(skipKyc)` gate、`USER_DELETABLE` 狀態集、payment.intent.deleted audit）。走**完整 Dual Gate v3.1 四道外部審查、不用 lighter**。
- **self-review ＝ multi-agent workflow（owner C-1 2026-06-23 明示；payments 域首棒不因 scout/spike 乾淨降級單 agent，[[feedback_self_review_form_not_downgradable_by_spike]]）**。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（不碰任何 util、不碰排除檔、不碰 runtime guard〔soft-delete UPDATE / 越權過濾 / `requirePaymentAccess` / `USER_DELETABLE` / audit〕、不碰 `CLEANUP_PLAN.md`）。finder/verifier 用 **`readonly-reviewer` global agent**（無 model pin → 繼承 session model；本 session registry 已載，[[feedback_selfreview_workflow_model_inheritance]]；**非機械安全邊界、持 Bash、read-only 屬 best-effort**）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-23：scope ＝ 單檔、納入全 8 錯；base 錨 `c04d1fab`；OD ① `request: Request`（plain）② `env: Env`（full）③ `params: Record<string, string>`（既有 convention）；annotation 形式 ＝ function-declaration + inline type；self-review 形式 ＝ multi-agent workflow；**禁** `Pick`、**禁** `CfRequest`、**禁** required runtime 改動、**禁** 新增安全功能、**禁** `EventContext`/`@cloudflare/workers-types`/新 import/新 ambient；排除檔 + 全 util + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `c04d1fab`）→ 逐檔 error set（**恰 8 錯：8 TS7031**，符 owner 預期）+ caller cascade（唯一 test importer `payments.test.ts`、direct-literal 拆解）+ coverage 分層 + 結構判定（3 direct handler、無 wrapper/worker/`ctx`/`waitUntil`/其他 export）+ 無 `.cf` + 無 D1-row callback（util `getPaymentIntent`）+ tests-leaf cascade 實測。**全對齊 owner 預期；scout 另揭 owner prompt domain map 3 偏差（payment-return 幻影 / admin-intents 首見 OD / 域 125-15）→ 依紀律停手回報、owner C-1 裁第一棒鎖單檔。**
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、blob 回 `ad00d83e`）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow `wf_500196ba-391`、4 agents〔3 finder + 1 verifier〕converged 三維 rubric scope / runtime·security / evidence；readonly-reviewer 繼承 session model；**accepted 0 / suspicious_input 0**；唯一 candidate〔scope 維 "13 vs 12 precedent count" nit〕經對抗式 verifier **REFUTED** + 主線獨立裁決確認「13 個現役 handler」正確 — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 維度 B、**0 Blocker / 0 Required / 2 NB**、11 維全 PASS〔dim 10 Tier-0 金流 PASS_WITH_LOCK〕、binding locks LOCK-1..LOCK-8 — 見 §Gate 進程紀錄）→ ✅ `CODEX_PLAN_APPROVED`（② 維度 C，**0 blocking / 0 required**；§4 對照表 15/15 PASS、§5 LOCK-1..8 全 OK、HEAD-independent anchor 零 false-reject；**Plan Gate 雙道全過** — 見 §Gate 進程紀錄）→ ⬜ owner `CODING_ALLOWED`
  - ✅ Code 階段（source commit `2b07aa3a`、full replay @ committed〔801·255 / sort-diff REMOVED=8·ADDED=0 / tests-leaf 0·0 TS2345 / byte-identical 2546B·`5643a2a9` / ratchet OK / lint / build:functions / payments.test.ts 35 passed〕、NB-2 雙證）→ ✅ `CODE_SELF_REVIEW_CLEAN`（維度 A workflow `wf_8b604387-443`、3 維 **0 findings** + 主線獨立裁決 + review agents 未污染 git — 見 §Gate 進程紀錄）→ ✅ `CODEX_CODE_APPROVED`（③ 維度 C、**0 blocking / 0 required**；§4 對照表 17/17 PASS、§5 LOCK-1..8 OK、HEAD-independent anchor — 見 §Gate 進程紀錄）→ ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④）
  - ⬜ merge-front 7 gates 全綠（lint / typecheck:ratchet / verify:browser-pipeline / test:cov / test:int / build:functions / npm audit）→ ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-23 Claude **scout（read-only @ `c04d1fab`）** → 逐檔 error set（**恰 8 錯**，符 owner 預期：L24 ×2〔request/env〕、L28 ×3〔request/env/params〕、L43 ×3〔request/env/params〕、皆 TS7031）+ caller cascade（唯一 test importer `payments.test.ts` import `onRequestGet as detailHandler` + `onRequestDelete as userDeleteHandler`、**全 direct-literal** 呼叫；functions/ 無內部 importer）+ coverage 分層（**有** direct integration test）+ 結構判定（**3 direct handler**、無 wrapper/worker/`ctx`/`waitUntil`/其他 export）+ 無 `request.cf`（plain `Request`）+ 無 D1-row map callback（util `getPaymentIntent`、`.first()`）。**全對齊 owner 預期**；另揭 owner prompt domain map 3 偏差（payment-return 幻影路徑 / admin-intents 首見 OD / payments 域實 125-15）→ 依紀律停手回報、不自改 scope。
- 2026-06-23 owner **C-1 裁示（SPEC_APPROVED；faithful 收錄）**：① 第一棒 scope ＝ 僅 `functions/api/auth/payments/intents/[id].ts` 單檔；② `payment-return/ecpay.ts` 確認為 prompt 所指 payment-return、但**不併第一棒**（另列 trivially-clean micro PR）；③ `api/admin/payments/intents.ts` 不進第一棒（另立一棒，因 TS7053 + helper typing + CSV PII export）；④ 接受 payments 域 **~125 errors / 15 files** 新 domain map（其餘 9 檔細表暫不貼、保留 full map 供第二棒排序）；⑤ Spec 鎖 type-only：Options=`{ request: Request; env: Env }`、Get/Delete=`{ request: Request; env: Env; params: Record<string, string> }`，不改 SQL / soft-delete UPDATE / 越權過濾 / `requirePaymentAccess(skipKyc)` / `USER_DELETABLE` / audit；⑥ 維持 Dual Gate v3.1、payments/auth 屬 L3 不 lighter；⑦ 進入 Spec → spike → plan doc → multi-agent self-review → Dual Gate v3.1，Plan/Gate 前不得改 code / 不得 commit source。完整 lock + 風險表 + 防禦表見 §附。
- 2026-06-23 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（solution 809→801、sort-diff REMOVED=8/ADDED=0、tests-leaf forced exit 0 / 0 TS2345、byte-identical 2546B sha `5643a2a9…` 兩端一致 esbuild stderr 0、ratchet:report base 809/80/254/334 → patched 801/79/255/334、frozen diff numstat 3/3 blob `ad00d83e→66d49528`、`git diff --check` clean、revert 後 blob 回 `ad00d83e`、functions leaf 回 809）。
- 2026-06-23 **multi-agent workflow self-review（維度 A，converged 三維 rubric scope / runtime·security / evidence；run `wf_500196ba-391`、4 agents〔3 finder + 1 verifier〕/ 261728 subagent tokens / 59 tool uses / ~4.4min；finder+verifier 皆 `readonly-reviewer` 繼承 session model、`__proto__:null` no-haiku 安全）→ `PLAN_SELF_REVIEW_CLEAN`**：runtime-security + evidence 維 **0 findings**；scope 維 1 candidate（"plan 稱 13 現役 handler、finder 誤判應為 12"）經**對抗式 verifier REFUTED**（finder 混淆 unit：13 ＝ handler 數〔`git grep` occurrences〕、12 ＝ file 數〔`git grep -l`〕；plan 明寫「13 個現役 handler」正確、套用 finder 建議反會引入錯誤）。**accepted 0 / suspicious_input 0**。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：① 親跑 `git grep -n "params: Record<string, string>" c04d1fab -- 'functions/api/**/*.ts'` ＝ **13 hits**、逐行確認皆 exported handler 簽名（onRequestGet/Post/Patch/Delete、無 alias/comment false-positive）、`git grep -l` ＝ **12 files**（`requisition/[id].ts` 含 2 handler L12+L45）→ plan「13 個現役 handler」**正確、不改**；② 無 PR-2cp/2co 數據洩漏（plan 內 PR-2cp 的 `9523`/`9f8d81e1`/`87d0d8cf`、register 的 `7563`/`18976c9e` 僅出現在「對比先例」描述、非 PR-2cq 數值）；③ frozen diff 唯一變更 ＝ 3 handler 簽名 function-declaration（無 arrow）。**review agents 未污染 git**（主線驗：HEAD `c04d1fab`、source blob `ad00d83e` 未動、working-tree hash `ad00d83e`、staged 空、`git diff c04d1fab..HEAD -- functions/` 空、working tree 僅 `?? CLEANUP_PLAN.md` + 本 plan doc）。
- 2026-06-23 **plan doc commit `eaf53f5e`**（branch `stage7-pr2cq-payments-intents-id`、local、未 push、plan-only +255 / 0 source；commit 前後核 staged set 僅 plan doc、`git diff c04d1fab..HEAD -- functions/` 空、`HEAD:[id].ts` blob 仍 `ad00d83e`）→ 中文報告 6 欄（gate-state `PLAN_SELF_REVIEW_CLEAN`）→ owner 驅動產自足 **ChatGPT Arch packet**（`~/Desktop/chiyigo-pr2cq-chatgpt-arch-packet.md`、repo 外、§9 含全 82 行 base source）→ 貼入送外部 ①。
- 2026-06-23 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Blocker / 0 Required Revision / 2 NB**）— 11 維全 **PASS**（Scope / Base anchor〔`c04d1fab` 非 stale〕/ Annotation form〔function-declaration〕/ Request〔plain `Request`〕/ Env〔full `Env`〕/ params〔`Record<string, string>` 既有 convention〕/ D1-callback OD〔不涉及、row 走 util〕/ Runtime drift defense〔byte-identical 硬證據〕/ Caller cascade〔tests-leaf 0〕/ **Tier-0 金流治理〔PASS_WITH_LOCK〕**/ Out-of-scope hygiene）。
  - **Binding locks LOCK-1..LOCK-8（ChatGPT Arch；② Codex Plan 與 Code 階段須保留）**：LOCK-1 只改 `[id].ts`、僅 3 handler signature annotation、不動其他 source/test/config；LOCK-2 runtime body byte-identical（CORS / `requirePaymentAccess` / id validation / 越權 404 / `USER_DELETABLE` / soft-delete SQL / audit payload / response body·status 全不變）；LOCK-3 `request` 維持 plain `Request`（不引入 `CfRequest`/`EventContext`/`waitUntil`）；LOCK-4 `env` 維持 full `Env`（不改 `Pick<Env>`/fake env/新 ambient·global·package import）；LOCK-5 `params` 維持 `Record<string, string>`（route-specific custom type 須另開 OD 重送 gate）；LOCK-6 不碰排除檔（`admin/payments/intents.ts`、`payment-return/ecpay.ts`、payments util、payment tests）；LOCK-7 Codex Plan/Code 必 replay（frozen diff / `git diff --check` / functions leaf −8 / ADDED=0 / tests-leaf 0 TS2345 / byte-identical）；LOCK-8 **本 approval ≠ 金流 runtime/security correctness approval、僅批 type-only annotation 架構**。
  - **NB-1（非阻擋）**：ChatGPT 無 repo access；base freshness / grep precedent count / ratchet / byte-identical / test cascade 皆 packet evidence、② Codex Gate 須在 repo 內機械重放。**NB-2（非阻擋）**：`onRequestOptions` 無 direct test importer、但 byte-identical 對本 PR 已足；**不得升級成要求補測**（會越過 type-only scope）。
  - **可送 ② Codex Plan Gate；非 coding 授權，待 ② 通過 + owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-23 owner 驅動產 **Codex Plan packet**（`~/Desktop/chiyigo-pr2cq-codex-plan-packet.md`、repo 外、**HEAD-independent anchor**〔套 PR-2cp r1/r2 教訓：blocking 純 source-base 不變量 + 機械值、branch HEAD commit SHA / plan-only commit 數標 [info, 非 blocking]〕、§3 repo replay 程序 + §4 對照表 + §5 LOCK-1..8 核對 + §6 cascade + §7 覆蓋誠實）→ 送外部 ②。
- 2026-06-23 **Codex Plan Gate（② 維度 C）：`CODEX_PLAN_APPROVED`**（**0 blocking / 0 required revision**）— 機械重驗全數**獨立重現**（§4 對照表 **15/15 PASS**）：base `c04d1fab`、base:src blob `ad00d83e`、`HEAD:src` blob == base（source 零落地）、`c04d1fab..HEAD -- functions/` 空、base functions leaf **809**〔[id].ts 8×TS7031 L24×2/L28×3/L43×3〕、patched **801**〔[id].ts 0、sorted REMOVED=8 全為目標八錯 / ADDED=0〕、tests-leaf exit 0 / 0 error / 0 TS2345 / 0 `payments.test.ts` diagnostic、byte-identical **2546B** sha `5643a2a9…` 兩端 IDENTICAL stderr 0、ratchet 809/80/254/334→**801/79/255/334**、restore blob `ad00d83e`（tracked/staged diff 0/0）。§5 **LOCK-1..8 全 OK**（frozen diff 僅單檔 3 inline handler annotation、`+3/−3`、blob `66d49528`、`git diff --check` clean）。§6 cascade 核實（唯一 importer `payments.test.ts` 3 direct-literal、`ProvidedEnv extends Env`、`onRequestOptions` 無 importer、coverage 未 overclaim）。Queue/payment-runtime/distributed/observability **N/A**（emit byte-identical、未改 runtime/SQL/狀態機/權限/audit/queue/外部副作用）。**HEAD-independent anchor → 零 false-reject（不重蹈 PR-2cp r1/r2）**；HEAD `30c2d2f3` 僅 [info, 非 blocking]。**Plan Gate 雙道（① ChatGPT Arch + ② Codex Plan）全過 = plan 批准；仍非 coding 授權，待 owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-23 **owner `CODING_ALLOWED` ✅ → Code 階段（source commit `2b07aa3a`）**：落地 3 個 handler 簽名（function-declaration、frozen form）。`git diff c04d1fab..2b07aa3a -- functions/` = [id].ts **+3/−3**、blob `ad00d83e→66d49528`、numstat 3/3；全樹 name-status 僅 plan doc(A) + [id].ts(M)、無 stray。**full replay @ committed（不沿用 spike、LOCK-7）全綠**：checkout-dance sort-diff（HEAD patched **801** / base **809**、restore 後 working blob `66d49528`）**REMOVED=8 全為目標 8×TS7031〔L24×2/L28×3/L43×3〕/ ADDED=0** · tests-leaf forced exit 0 / 0 error / 0 TS2345 · **byte-identical @ committed blobs**（base `c04d1fab:` 與 `HEAD:` 皆 git show、canonical esbuild `--loader=ts --format=esm` stdin）兩端 **2546B** sha `5643a2a9c27f2956f5c8462dbf6082f24c0f1302d39a8e2683b9029e49aa0e19`、stderr 0、`diff -q` IDENTICAL · ratchet enforce〔`RATCHET_BASE_REF=c04d1fab`〕**OK**（baseline 1119/175、current **801/255**）· `git diff c04d1fab..HEAD --check` clean · **lint green**（eslint + compat-date + workflows 3 檔）· **build:functions「Compiled Worker successfully」** · **targeted `payments.test.ts` 35 tests passed**（runtime 旁證：detail own→200 / 別人→404 不洩漏 / user DELETE→soft delete P0-1 / skipKyc gate / 越權隔離）。**NB-2 雙證齊**（byte-identical @ committed blob + source diff 逐行 == frozen 3 行）。
- 2026-06-23 **Code self-review = multi-agent workflow（維度 A、converged 三維 diff-fidelity / runtime·security / evidence；run `wf_8b604387-443`、3 agents〔3 finder、0 verifier ∵ 0 candidate〕/ 199961 subagent tokens / 64 tool uses / ~6.3min、finder 皆 `readonly-reviewer` 繼承 session model、`__proto__:null`）→ `CODE_SELF_REVIEW_CLEAN`**：三維 finder（read-only git/tsc 親驗、含 byte-identical 重跑）**全 0 findings、accepted 0、suspicious 0**。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：① `git diff c04d1fab..HEAD -- functions/` 逐字 == frozen 3 handler 簽名（function-declaration、非 arrow）、全樹 name-status 僅 plan doc(A) + [id].ts(M)、numstat 3/3、blob `66d49528`；② byte-identical @ committed 2546B sha `5643a2a9` IDENTICAL；③ 機械值親驗（HEAD functions leaf 801 無 [id].ts 錯 / REMOVED 8·ADDED 0 / tests-leaf 0 / ratchet 801·255 / payments.test.ts 35 passed）；④ 無 PR-2cp/2co 數據洩漏。**review agents 未污染 git**（HEAD `2b07aa3a`、source blob `66d49528` 未動、working-tree hash `66d49528`、staged 空、tracked changes 無、working tree 僅 `?? CLEANUP_PLAN.md`）。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；非 merge 授權。**
- 2026-06-23 owner 驅動產 **Codex Code packet**（`~/Desktop/chiyigo-pr2cq-codex-code-packet.md`、repo 外、**HEAD-independent anchor**、committed diff + §3 repo replay〔committed state 直量 + base checkout-dance〕+ §4 對照表 + §5 LOCK-1..8 + §6 cascade + §7 self-review 摘要 + §8 覆蓋誠實）→ 送外部 ③。
- 2026-06-23 **Codex Code Gate（③ 維度 C，code 正確性主力）：`CODEX_CODE_APPROVED`**（**0 blocking / 0 required revision**）— 機械重驗 committed code（source commit `2b07aa3a`）全數**獨立重現**（§4 對照表 **17/17 PASS**）：base `c04d1fab` / base:src blob `ad00d83e` / `HEAD:src` blob `66d49528` / `c04d1fab..HEAD -- functions/` 恰 1 行 `M [id].ts` / 全樹僅 plan doc(A)+[id].ts(M) / committed diff +3/−3 3 function-declaration signatures / HEAD functions leaf **801**〔[id].ts 0〕/ base **809** / sorted REMOVED=8〔目標 TS7031〕·ADDED=0 / tests-leaf 0·0 TS2345 exit 0 / byte-identical **2546B** sha `5643a2a9…` 兩端 stderr 0 IDENTICAL / ratchet OK current **801/255** baseline 1119/175 / restore blob `66d49528` / lint green / build:functions Compiled / `payments.test.ts` **35/35 passed**。§5 LOCK-1..8 全 OK（`git diff --check` clean）。§6 cascade 核實（direct-literal、`ProvidedEnv extends Env`、`onRequestOptions` 無 importer）。Queue/payment-runtime/distributed/observability **N/A**（committed runtime emit 完全相同、未變更 SQL/狀態/權限/audit/queue/外部副作用/可觀測性）。**HEAD-independent anchor → 零 false-reject**。**可進 ④ ChatGPT Faithfulness；非 merge 授權。**
- （後續 dated 收錄：ChatGPT Faithfulness packet → ④ ChatGPT Faithfulness → merge-front 7 gates → owner `MERGE_ALLOWED` → squash-merge → SHIPPED）

## owner 鎖定表（C-1 ruling 2026-06-23，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 只改 `functions/api/auth/payments/intents/[id].ts`；納入全 8 錯，目標 0 noImplicitAny、cleanFiles +1 |
| L2 Handler type shape | `request: Request`（plain）、`env: Env`（full）、`params: Record<string, string>`（Get/Delete；Options 無 params）；**無 `waitUntil`**（本檔不 destructure waitUntil）|
| L3 annotation 形式 | **function-declaration ＋ inline param type**（3 handler）；**禁** arrow const、named type alias、拆多行 |
| L4 No new shared type / no util change | 不新增 shared type、不改任何 util signature（含 `getPaymentIntent`/`requirePaymentAccess`/`getCorsHeaders`/`safeUserAudit`）|
| L5 env = full Env（**禁 Pick**）| 3 handler 整包 forward env 給 `getCorsHeaders`/`requirePaymentAccess`/`getPaymentIntent`/`safeUserAudit` ＋ `env.chiyigo_db`；無 partial-fake-env unit test → [[feedback_util_env_param_pick_not_full_env]] 不適用、full Env 正確（spike ADDED=0 證）|
| L6 request = plain Request（**禁 CfRequest**）| 僅 forward 給 util（`getCorsHeaders`/`requirePaymentAccess`/`safeUserAudit`），**無 `.cf` 存取** → plain `Request` |
| L7 params = `Record<string, string>`（既有 convention）| `Number(params?.id)` runtime 行為不改；13 個現役 handler 同 convention；test direct-literal `{ id: String(...) }` assignable（spike tests-leaf 0 證）|
| L8 No new security feature | soft-delete / 越權過濾 / `requirePaymentAccess` / `USER_DELETABLE` / audit 全鎖；**本 PR 禁新增/修改任何安全功能**（type-only、不改防禦面）|
| L9 Runtime hot-zone lock | 不改 soft-delete UPDATE（`deleted_at` set、Codex P0-1 orphan 防護）/ 越權雙欄過濾（`row.user_id !== Number(user.sub)` → 404 不洩漏）/ `requirePaymentAccess(request, env, { skipKyc: true })` gate / `USER_DELETABLE` 狀態集（pending/failed/canceled）/ `STATUS_LOCKED` 403 / `payment.intent.deleted` audit / `getPaymentIntent` 呼叫 / response·error code |
| L10 Spike evidence | full-solution spike 必須**非 commit**，證明 **REMOVED=8 / ADDED=0** |
| L11 byte-identical evidence | byte-identical 必須是 **type-strip / canonical emit 證據**（esbuild `--loader=ts --format=esm` stdin），不接受「測試通過」替代 |
| L12 Coverage | 逐 sub-path 下鑽；handler 有 direct integration test（`payments.test.ts`），但 type-only 改動 runtime 不可見 → **主硬保證 ＝ byte-identical**，integration test 僅作 runtime 旁證、不宣稱「覆蓋型別標註」（[[feedback_pr_coverage_claim_accuracy]]）|
| L13 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical / tests-leaf；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L14 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔（`admin/payments/intents.ts`、`payment-return/ecpay.ts`、其餘 payments 檔）/ coverage overclaim / 偏離 C-1 裁定 OD（用 `Pick` / 用 `CfRequest` / arrow const / 新增安全功能 / 動 guard）→ 退回 `PLAN_DRAFT` |

## ⚠ payments 熱區聲明（review care L3，Tier-0 金流）

`auth/payments/intents/[id].ts` 為**使用者單筆 intent 詳情（GET）＋ 自刪（DELETE）入口**，金流敏感：

| handler | 流程 | 紅線（typing 全程不得牽動）|
|---|---|---|
| `onRequestOptions` | CORS preflight → 204 + `getCorsHeaders(request, env, { credentials: true })` | CORS header 構築不動 |
| `onRequestGet` | `getCorsHeaders` → **`requirePaymentAccess(request, env, { skipKyc: true })` gate**（error 直回）→ `id = Number(params?.id)` 驗 → `getPaymentIntent(env, { id })` → **越權雙欄過濾 `!row \|\| row.user_id !== Number(user.sub)` → 404（不洩漏存在）** → `res(row, 200)` | requirePaymentAccess gate、id 驗證、越權過濾、404 不洩漏語意全不動 |
| `onRequestDelete` | `getCorsHeaders` → `requirePaymentAccess(skipKyc)` → id 驗 → `getPaymentIntent` → 越權過濾 404 → **`USER_DELETABLE` 狀態集 gate（pending/failed/canceled，否則 `STATUS_LOCKED` 403）** → **soft-delete UPDATE**（`deleted_at` set `WHERE id=? AND user_id=? AND deleted_at IS NULL`；**Codex P0-1：保留 row 給 webhook orphan 偵測 + 對帳**，禁改 hard delete）→ **`payment.intent.deleted` audit**（severity info、含 vendor/vendor_intent_id/status_was/amount_subunit/actor）→ `res({ ok, id }, 200)` | USER_DELETABLE 狀態集、STATUS_LOCKED 403、soft-delete SQL（含 P0-1 orphan 防護語意）、越權 user_id 綁定、audit 各欄全不動 |

修法若非純型別、或牽動上列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L8/L9）。本刀只在 3 個 exported handler 簽名加 inline param annotation，TS erase 後 runtime byte-identical（SQL / 常數 / audit·log / 字串 / 註解 / 全 guard 全不變）。

### Coding 階段硬性邊界

- **允許**：3 handler 簽名各加 inline param type（§frozen diff 唯一變更行，L24/L28/L43）。
- **禁止**：改任何 SQL / soft-delete UPDATE / 越權過濾 / `requirePaymentAccess(skipKyc)` / `USER_DELETABLE` 狀態集 / `STATUS_LOCKED` / `payment.intent.deleted` audit / `getPaymentIntent` 呼叫 / response body·error code / **新增任何安全功能** / caller（`payments.test.ts`）/ shared util / tests / `env.d.ts` / `tsconfig`·`eslint`·`vitest` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types` / `Pick<Env>` / arrow const 形式 / **碰排除檔**（`admin/payments/intents.ts`、`payment-return/ecpay.ts`、其餘 payments 檔）/ 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `c04d1fab`）

### 依賴邊界（caller cascade）

`[id].ts` 是 Pages file-routing entry，cascade 面（**頭號 scout 風險 ＝ tests-leaf cascade**；實測 = 0）：

| 面 | 判定 | 證據 |
|---|---|---|
| 外部 production TS caller | **0 牽動** | `grep` 於 functions/ **無任何 TS/JS importer**（Pages file-routing、production runtime 由 Pages 注入 context、不靜態 type-check 本 annotation）|
| direct integration test importer（**唯一檔 `payments.test.ts`**）| **0 cascade（spike 實測）** | import `onRequestGet as detailHandler`（L55）+ `onRequestDelete as userDeleteHandler`（L57）；**全 direct-literal** 呼叫：`detailHandler({ request: bearer('GET',…,tok), env, params: { id: String(id) } })`（L243/256）、`userDeleteHandler({ request: bearer('DELETE',…), env, params: { id: String(intentId) } })`（L483）。`bearer()` 回 `new Request(...)` → `Request` ✓；`env` 來自 `cloudflare:test`（`types/env.d.ts` `interface ProvidedEnv extends Env` 橋接）→ assignable `env: Env` ✓；`{ id: string }` literal → `params: Record<string, string>`（string-keyed string-valued、無 excess）✓ → 0 TS2345（同 PR-2cp login user-audit / PR-2cm verify direct-literal 先例）。`onRequestOptions` **無 test importer**（0 風險）。**spike `tsc -b tsconfig.tests.json --force` exit 0 / 0 TS2345 / 0 payments.test.ts error 實證** |
| util forward（`getCorsHeaders`/`requirePaymentAccess`/`getPaymentIntent`/`safeUserAudit`）| 全相容、0 cascade | 各 util `env`/`request` 參數現為 untyped（implicit any，屬各自 leaf 的待清錯）→ `Env`/`Request` assignable to any；`getPaymentIntent` 回 `any`（`.first()`，D1Database→any）→ `row` any、`row.*` 存取無錯（spike ADDED=0 實證）|

**precedent landscape（佐證 OD ruling）**：
- **`request: Request` / `env: Env` 直連 handler** ＝ repo 主流 Convention A（數十檔已清，含 A 域 #109..#114）→ **零新 OD**；`env` 用 **full `Env`**（handler 整包 forward util，util 各收 untyped/Pick、full Env structural assignable，[[feedback_util_env_param_pick_not_full_env]]）。
- **`params: Record<string, string>`** ＝ repo 既有 convention（13 個現役 `[id]`/`[tenantId]` handler 同形）→ payments 域首用、但非新 OD。
- **無 `waitUntil`**：3 handler 皆不 destructure `waitUntil`（DELETE 的 audit 走 `await safeUserAudit`，非 fire-and-forget）→ 不觸 waitUntil OD。
- **無 D1-row `.map` callback**：查詢走 util `getPaymentIntent`（`.first()`）→ 不觸 register #111 的 D1-row callback OD（row 為 any）。
- **direct-literal test caller**（`payments.test.ts`）：與 PR-2cp login user-audit / PR-2cm verify 同款（`{ request: bearer(...), env, params: { id } }` literal、`ProvidedEnv extends Env` 橋接）→ 0 cascade。

### 型別選型（owner C-1 OD ruling）

允許落地的唯一 source diff（3 編輯點）：

```ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {                                    // L24
export async function onRequestGet({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {  // L28
export async function onRequestDelete({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {  // L43
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| `request` | **`Request`（plain）** | 僅 forward 給 `getCorsHeaders`/`requirePaymentAccess`/`safeUserAudit`；**無 `.cf`** → 非 `CfRequest` |
| `env` | **`Env`（full，Convention A）** | 整包 forward util；`env.chiyigo_db`(any)；spike ADDED=0 證零 cascade；無 partial-fake-env unit test → 不用 Pick |
| `params` | **`Record<string, string>`（既有 convention）** | `Number(params?.id)`；13 precedent；test `{ id: string }` assignable |
| annotation 形式 | **function-declaration + inline type** | 保原 runtime shape、byte-identical、編輯點最小；**禁** arrow const |
| OD 形態 | **零新 OD**（複用 Convention A + Record params convention；無 waitUntil、無 D1-row callback）| payments 域最簡入口 |
| `Pick<Env>`（**否決**）| **禁** | env 整包 forward、無 partial-fake-env caller；Pick 會誤導讀者「只用部分 env」|
| `CfRequest`（**否決**）| **禁** | 無 `.cf` 存取；引入多餘語義 |
| arrow const 形式（**否決**）| **禁** | 破壞 byte-identical / 編輯點 / runtime shape |
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 8 錯 |

## Spike 實證（full-solution，本地未 commit，2026-06-23，已 revert clean）

**程序**：建 branch（自 clean main `c04d1fab`）→ 量 base（forced functions leaf 809、[id].ts 8 錯、base emit 2546B sha `5643a2a9…`）→ 套 3 編輯點（L24/L28/L43）→ forced `tsc -b tsconfig.functions.json --force`（sorted error set diff）→ forced `tsc -b tsconfig.tests.json --force`（tests-leaf）→ ratchet report → canonical byte-identical（esbuild stdin）→ frozen diff + `git diff --check` → `git checkout HEAD --` revert → 驗 clean（blob 回 `ad00d83e`、staged 空、`git status` 僅 `?? CLEANUP_PLAN.md`、functions leaf 回 809）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| [id].ts errors 8 → 0 | ✅ sort-diff REMOVED = 恰 8 行（L24 ×2 / L28 ×3 / L43 ×3 TS7031）；patched 0 殘留 |
| functions leaf errorCount 809 → 801（恰 −8）| ✅ forced tsc functions leaf **801**；sort-diff ADDED = **空（0）**|
| zero cascade（functions + tests leaf）| ✅ functions sort-diff **REMOVED=8 / ADDED=0**；`tsc -b tsconfig.tests.json --force` **exit 0 / 0 error / 0 TS2345 / 0 payments.test.ts error** = **tests-leaf cascade 0（頭號風險 cleared）**|
| canonical ratchet `--report`（base → patched）| ✅ base errorCount **809** / errorFiles **80** / cleanFiles **254** / sourceFilesTotal **334** → patched **801** / **79** / **255** / **334**（[id].ts 全清入 cleanFiles）|
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`** stdin，[[feedback_byte_identical_emit_verification]]）| ✅ esbuild **stdin** type-strip base vs patched **IDENTICAL**、皆 **2546B**、esbuild stderr 空：<br>sha256 `5643a2a9c27f2956f5c8462dbf6082f24c0f1302d39a8e2683b9029e49aa0e19` 兩端 |
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace / lone space）|
| frozen diff numstat | ✅ `3  3`（3 insertion / 3 deletion；無 whole-file CRLF churn）；base blob `ad00d83e` → head blob `66d49528` |
| working tree revert clean | ✅ `git checkout HEAD --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、blob 回 `ad00d83e`、staged 空、functions leaf 回 809 |

**byte-identical 適用性**：[id].ts 4 個 import statement（`utils/auth` / `utils/cors` / `utils/payments` / `utils/user-audit`）→ esbuild stdin transform **適用**（單檔 transform、import 行原樣保留；type-only annotation PR 這正是對的證明面 — 改動僅限本單檔、其他檔 byte 不變 → bundle 等價）。⚠ 用 **stdin**（`<` / pipe），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell，[[feedback_byte_identical_emit_verification]]）；本 spike emit 2546B 非空、已排除該坑。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/payments/intents/[id].ts b/functions/api/auth/payments/intents/[id].ts
index ad00d83e..66d49528 100644
--- a/functions/api/auth/payments/intents/[id].ts
+++ b/functions/api/auth/payments/intents/[id].ts
@@ -21,11 +21,11 @@ const USER_DELETABLE = new Set([
   PAYMENT_STATUS.PENDING, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELED,
 ])

-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
 }

-export async function onRequestGet({ request, env, params }) {
+export async function onRequestGet({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
   const cors = getCorsHeaders(request, env, { credentials: true })
   const { user, error } = await requirePaymentAccess(request, env, { skipKyc: true })
   if (error) return error
@@ -40,7 +40,7 @@ export async function onRequestGet({ request, env, params }) {
   return res(row, 200, cors)
 }

-export async function onRequestDelete({ request, env, params }) {
+export async function onRequestDelete({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
   const cors = getCorsHeaders(request, env, { credentials: true })
   const { user, error } = await requirePaymentAccess(request, env, { skipKyc: true })
   if (error) return error
```

`git diff --stat`：1 file changed, 3 insertions(+), 3 deletions(-)；`git diff --numstat`：`3  3`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `c04d1fab` `--report`：errorCount **809** / errorFiles **80** / cleanFiles **254** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **809 → 801**（−8）、errorFiles **80 → 79**、cleanFiles **254 → 255**（spike 實測值、非預測；[id].ts 全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 801」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 3 個 exported handler 簽名 inline param 型別標註，TS erase 後 runtime byte-identical（§Spike sha `5643a2a9…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 809、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。
- **無 D1 migration**（純 type-only、不觸 schema）→ 不觸發 migration-before-merge（[[feedback_migration_before_merge_autodeploy]]）。

## 測試影響面（覆蓋誠實，L12 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf forced exit 0 / 0 error 實證）。
- **覆蓋分層（誠實，逐 sub-path 下鑽）**：

| 標的 | direct test | 真打路徑 | 硬保證 |
|---|---|---|---|
| `[id].ts`（`onRequestGet` detail / `onRequestDelete` delete）| ✅ **有**：`payments.test.ts`（detail 自己→200 / 別人→404 不洩漏；user delete 路徑）| direct-literal `detailHandler/userDeleteHandler({ request: bearer(...), env, params: { id } })` | **byte-identical 為主硬保證**；integration test 為 runtime 旁證 |
| `onRequestOptions`（CORS preflight）| ⚠ **無 direct test**（OPTIONS 不被 test import）| — | byte-identical（emit 不變）|

- **下鑽證據（不 overclaim）**：
  - direct integration test 涵蓋 GET detail 的 own→200 / others→404（越權雙欄過濾、不洩漏存在）；DELETE 自刪路徑（runtime 旁證）。
  - **誠實界線**：type-only 改動 runtime 不可見（型別 erase）＋ direct-literal `handler({...})` 雖型別連結存在（非 callFunction sever），但測試斷言的是 runtime 行為（status / body）、非型別標註本身 → integration test **不能「覆蓋」型別標註本身**；它提供「emit 不變則各路徑行為不變」的旁證。**主硬保證 = byte-identical emit（sha 兩端一致）**。
  - `onRequestOptions` 無 direct test → 僅靠 byte-identical（OPTIONS handler emit 不變、CORS 行為不變）。
- 與 PR-2ci..2cp（皆以 byte-identical 為硬保證）同策略；本檔有 detail/delete direct test 作旁證，但**仍不宣稱 type annotation 被測試覆蓋**。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`（或用 `--force`）。**PowerShell 用 `$env:RATCHET_BASE_REF='c04d1fab'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='c04d1fab'; npm run typecheck:ratchet` green（809→801 / 80→79 / 254→255）。
- filtered forced tsc：[id].ts 0 殘留 + functions leaf sort-diff **REMOVED=8 / ADDED=0** + `tsc -b tsconfig.tests.json --force` exit 0（0 error / 0 TS2345）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**（檔名含 `[id]` 必 quote）：

```bash
git show "c04d1fab:functions/api/auth/payments/intents/[id].ts" | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/id-base.js 2>/tmp/id-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < "functions/api/auth/payments/intents/[id].ts" > /tmp/id-head.js 2>/tmp/id-head.err
wc -c /tmp/id-base.js /tmp/id-head.js          # 期望 2546 兩端
sha256sum /tmp/id-base.js /tmp/id-head.js       # 期望 5643a2a9c27f2956… 兩端
cat /tmp/id-base.err /tmp/id-head.err            # 期望空（stderr 0 bytes）
diff -q /tmp/id-base.js /tmp/id-head.js           # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show c04d1fab:` 讀未改 base。spike 本地實證：兩端 **2546B / `5643a2a9…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 3 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量；確認 inline param annotation 不觸 `no-floating-promises`/`no-unused-vars`/`no-undef`）、`npm run build:functions` green。
- targeted int：跑 `payments.test.ts` 確認綠（runtime 旁證、不宣稱涵蓋 type annotation）；跑全量 `test:int`（金流牽動多 test）確認無跨檔破壞。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +3/−3、`git diff` 3 處為 handler 簽名）；超出 = scope creep = Gate fail。
