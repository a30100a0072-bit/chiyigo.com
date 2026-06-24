# Stage 7 reduce PR-2cr — `api/auth/payments/intents.ts` noImplicitAny（**payments 域第二棒**；2 個 direct handler、**無 params、無 waitUntil、無 D1-row callback**、type-only、review care **L3**）

**目標**：`functions/api/auth/payments/intents.ts`（user payment intents **列表 GET** + CORS preflight）的 **4 個 noImplicitAny error（4×TS7031：2 個 handler destructure 的 `request`/`env`）→ 0**，**純 type-only**（**2 個編輯點** ＝ 2 個 exported handler `onRequestOptions`/`onRequestGet` 的 destructured param annotation；TS erase 後 emit byte-identical）。本 PR ＝ payments 大熱區 **第二棒**（接 PR-2cq #115 `4ac4dfab` 的姊妹 `[id].ts` 詳情 handler；同 `/api/auth/payments/intents` 路由族的 collection list handler）。owner 2026-06-24：A 域全清後進 payments、light→heavy，本棒為 payments 候選裡 error 數低、blast radius 最小、pattern 複用 #115 的續清。

**Scope（owner 鎖 2026-06-24；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/payments/intents.ts` | 4（2 handler destructure，全 TS7031）| **2 個編輯點**（`onRequestOptions` L23 / `onRequestGet` L27 的 destructure param annotation）|

精確錯位（forced `tsc -b tsconfig.functions.json --force`，filtered 本檔）：

```
functions/api/auth/payments/intents.ts(23,42): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/payments/intents.ts(23,51): error TS7031: Binding element 'env' implicitly has an 'any' type.
functions/api/auth/payments/intents.ts(27,38): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/payments/intents.ts(27,47): error TS7031: Binding element 'env' implicitly has an 'any' type.
```

**恰 4 個**（owner 預估一致）：2 handler × destructure param（各 `request`,`env`）。`onRequestOptions`（request,env）= 2；`onRequestGet`（request,env）= 2。**無第 5 錯**：`onRequestGet` body 內 `const url = new URL(request.url)`（request→Request、url→URL）、`url.searchParams.get(...)`（string|null）、`const binds: (string | number)[]`（**已標型別**）、`isPaymentStatus(status)`/`isPaymentKind(kind)`（既有 type-guard）、`env.chiyigo_db.prepare(...).bind(...).all()`（`env.chiyigo_db` ＝ `D1Database` 解為 `any`，[[feedback_d1database_resolves_any_no_workers_types]]）→ `rows` 為 any、`rows.results ?? []` 存取**無 cascade**；**無 register #111 的 `.all().map()` D1-row callback**（本檔直取 `rows.results`、無 per-row 欄位存取 / 無 `.map` callback）。

> **主線定位**：A 域（A1..A3 auth handler 層）全清（殿後棒 PR-2cp `local/login.ts` #114 `c04d1fab`）→ payments 域第一棒 PR-2cq `auth/payments/intents/[id].ts` #115 `4ac4dfab`（詳情/自刪 handler）→ **第二棒本棒 `auth/payments/intents.ts`（同路由族 collection list handler）**。payments 域 light→heavy 候選（owner 2026-06-24）：`auth/payments/intents.ts`(4，本棒) → `payment-return/ecpay.ts`(2,micro) / `utils/payment-vendors/mock.ts`(6) / `auth/payments/checkout/ecpay.ts`(6) / `admin/payments/intents.ts`(9〔TS7053+CSV PII 首見 OD、另立一棒〕) / `utils/payments.ts`(18) → 重檔殿後（`utils/payment-vendors/ecpay.ts` 27 / `webhooks/payments/[vendor].ts` 19 / refund·delete·aggregate·dlq·metadata-archive·refund-request）→ **audit 域(~375/12 檔，含 F-3 DORMANT)最後**。**結構特性**：**2 個 direct handler**（`onRequestOptions`/`onRequestGet`，param 直接 destructure，**無 wrapper/worker、無 `ctx`、無 `waitUntil`、無 `params`**〔list endpoint 無 `[id]` 段〕）；查詢走 **inline SQL**（`env.chiyigo_db.prepare(...).all()`，**非** util，但 `rows` 為 any → 無新 OD）→ payments 域**結構最簡入口**（4 錯、2 編輯點、零新 OD；比 #115 [id].ts 更簡，少 params/少一個 handler/少 audit/少 soft-delete UPDATE）。**但屬 Tier-0 金流** → review care L3。**排除**：`api/admin/payments/intents.ts`（**另立一棒**，TS7053 index + CSV PII export helper）、`payment-return/ecpay.ts`（**另列 micro PR 候選**、跨目錄不併）、`auth/payments/intents/[id].ts`（#115 已清、姊妹檔不重碰）、其餘 payments 檔、util `utils/{payments,payment-vendors/*}.ts`、大熱區 `audit` 域（defer 殿後）。

## base 錨點（current main，非 stale）

- **base ＝ current main `4ac4dfab`**（`git rev-parse HEAD` 實證 `4ac4dfab7fa2a5ba69a788ae8a5771053bb3ca22`、main clean〔僅 `?? CLEANUP_PLAN.md` untracked〕）。
- 此即 PR-2cq #115（`[id].ts`）squash commit；owner prompt base SHA 與實查一致、**無 stale 修正**。
- branch `refactor/stage7-pr2cr-auth-payments-intents-noimplicitany`（自 clean main `4ac4dfab` 開、未 push）。
- base:src blob ＝ `86b5639bcf806995fa3e394f7ae2a4f5c59de38d`；plan-only commit 後 `HEAD:src` blob 仍須 == base（source 零落地，[[feedback_gate_packet_replay_anchor_head_vs_base]]）。

## annotation 形式裁定（沿 PR-2cp/2cq frozen form：function-declaration + inline param type）

- **正式 frozen form ＝ function-declaration ＋ inline param type**（沿 PR-2cp #114 / PR-2cq #115 既定，[[feedback_gate_packet_replay_anchor_head_vs_base]] 同段「annotation 形式 = function-declaration、非 arrow const」）：
  ```ts
  export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
  export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  ```
- **禁** arrow const（破壞 byte-identical / 編輯點 / function-declaration hoisting runtime shape）、**禁** named type alias、**禁** 拆多行。
- 與 #115 [id].ts 唯一差別：**本檔 2 handler 皆無 `params`**（list/collection endpoint，無 `[id]` 動態段）→ type shape 為 `{ request: Request; env: Env }`（**無** `params: Record<string, string>`）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔、2 annotation）/ review care **L3**（payments 屬 **Tier-0 金流**；本檔含 `requirePaymentAccess(skipKyc)` gate、soft-delete 過濾〔`deleted_at IS NULL`，Codex P0-1 orphan 防護的讀取面〕、`user_id` 綁定、limit 上限 clamp、`isPaymentStatus`/`isPaymentKind` 過濾、`LEFT JOIN requisition_refund_request`）。走**完整 Dual Gate v3.1 四道外部審查、不用 lighter**。
- **self-review ＝ multi-agent workflow（fail-safe L3 預設；payments Tier-0 不因 scout/spike 乾淨降級單 agent，[[feedback_self_review_form_not_downgradable_by_spike]]）**。雖屬單檔 type-only（PR-2cg 先例曾以單 agent 處理單檔非首批），但本檔 review care L3（金流）＋ 緊接 PR-2cq/2cp 皆用 workflow → 採 fail-safe workflow 預設、不自行降級（owner 如要降單 agent 可當輪明示）。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（不碰任何 util、不碰排除檔、不碰 runtime 紅線〔SQL / `requirePaymentAccess` / soft-delete 過濾 / limit clamp / guards / JOIN / response〕、不碰 `CLEANUP_PLAN.md`）。finder/verifier 用 **`readonly-reviewer` agent**（無 model pin → 繼承 session model Opus 4.8，[[feedback_selfreview_workflow_model_inheritance]]；options `__proto__:null` no-haiku 機械保證；**非機械安全邊界、持 Bash、read-only 屬 best-effort**）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner 2026-06-24「照你推薦開跑」：scope ＝ 單檔 `auth/payments/intents.ts`、納入全 4 錯；base 錨 `4ac4dfab`；OD ① `request: Request`（plain）② `env: Env`（full）、**無 params、無 waitUntil**；annotation 形式 ＝ function-declaration + inline type；self-review 形式 ＝ multi-agent workflow；**禁** `Pick`、**禁** `CfRequest`、**禁** required runtime 改動、**禁** 新增安全功能、**禁** `EventContext`/`@cloudflare/workers-types`/新 import/新 ambient；排除檔 + 全 util + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `4ac4dfab`）→ 逐檔 error set（**恰 4 錯：4 TS7031**，符 owner 預估）+ caller cascade（唯一 test importer `payments.test.ts` import `onRequestGet as listHandler`、direct-literal 拆解；`onRequestOptions` 無 importer）+ coverage 分層 + 結構判定（2 direct handler、無 wrapper/worker/`ctx`/`waitUntil`/`params`/其他 export）+ 無 `.cf` + 無 D1-row callback（inline SQL、`rows` any）+ tests-leaf cascade 實測。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、blob 回 `86b5639b`）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow `wf_849ffe8d-fd8`、3 readonly-reviewer finders 全 `claude-opus-4-8[1m]`、收斂三維 rubric scope / runtime·security / evidence；**candidateCount 0 / 0 findings**；主線獨立裁決非採 raw — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 維度 B、**0 Blocker / 0 Required / 8 binding locks LOCK-1..8**、全對齊本 plan 既有鎖、無 plan 改動 — 見 §Gate 進程紀錄）→ ✅ `CODEX_PLAN_APPROVED`（② 維度 C、**0 blocking / 0 required**、repo 機械 replay 全數重現〔§4 對照表〕 — 見 §Gate 進程紀錄）→ ⬜ owner `CODING_ALLOWED`（**待 owner 明示；Codex 已聲明 ② 非 coding 授權**）
  - ✅ Code 階段（owner `CODING_ALLOWED` → source commit `1d47b43c`、full replay @ committed 全綠、NB-2 雙證）→ ✅ `CODE_SELF_REVIEW_CLEAN`（維度 A workflow `wf_81f718c6-3f3`、3 finder + 1 verifier、1 candidate〔evidence、low〕對抗式 **REFUTED** → 0 accepted — 見 §Gate 進程紀錄）→ ✅ `CODEX_CODE_APPROVED`（③ 維度 C、**0 blocking / 0 required**、repo 機械重放全數重現 — 見 §Gate 進程紀錄）→ ✅ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④ 維度 B-code、**14/14 Faithful、0 deviation、無需 Codex 重審**；**外部 4 道全過** — 見 §Gate 進程紀錄）
  - ✅ merge-front 7 gates 全綠（lint / ratchet **797·256** / verify:browser-pipeline 25p·214ref / test:cov **737**·90.28% / test:int **1328** / build:functions / npm audit **0** — 見 §Gate 進程紀錄）→ ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-24 Claude **scout（read-only @ `4ac4dfab`）** → 逐檔 error set（**恰 4 錯**：L23 ×2〔request/env〕、L27 ×2〔request/env〕、皆 TS7031）+ caller cascade（唯一 test importer `payments.test.ts:54` import `onRequestGet as listHandler`、**全 direct-literal** 呼叫 L197/208/218/229；`onRequestOptions` 無 importer；functions/ 無內部 importer）+ coverage 分層（**有** direct integration test）+ 結構判定（**2 direct handler**、無 wrapper/worker/`ctx`/`waitUntil`/`params`/其他 export）+ 無 `request.cf`（plain `Request`）+ 無 D1-row map callback（inline SQL、`rows.results` any）。全對齊 owner 預估。
- 2026-06-24 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（solution 801→797、sort-diff REMOVED=4/ADDED=0、tests-leaf 0/0、byte-identical 1972B sha `d89b28ae…` 兩端一致 esbuild stderr 0、ratchet 801/79/255/334 → 797/78/256/334、frozen diff numstat 2/2 blob `86b5639b→4bfaa33f`、`git diff --check` clean、revert 後 blob 回 `86b5639b`）。
- 2026-06-24 **multi-agent workflow self-review（維度 A，run `wf_849ffe8d-fd8`、3 agents〔3 finder、0 verifier ∵ 0 candidate〕/ 223416 subagent tokens / 70 tool uses / ~10.8min；finder 皆 `readonly-reviewer` 繼承 session model `claude-opus-4-8[1m]`〔workflowProgress model 欄實證、無 haiku〕、options `__proto__:null`）→ `PLAN_SELF_REVIEW_CLEAN`**：收斂三維 rubric（scope / runtime·security / evidence）**candidateCount 0 / verified [] / 全 0 findings**。三 finder 各自 read-only 獨立重現：scope（恰 2 編輯點 / 1 檔 / 4 TS7031 / 無漏 handler / 無 excluded-file 接觸 / frozen diff = 2 簽名行）、runtime-security（byte-identical pipe 重跑 1972B sha `d89b28ae…` IDENTICAL / SQL·guard·soft-delete·CORS·response 全不動 / plain Request·full Env 正確 / util forward 收 Pick·untyped 不 cascade）、evidence（base anchor `86b5639b` / ratchet 801/79/255 / patched blob `4bfaa33f` / numstat 2/2 / `git diff --check` clean / **污染交叉檢查 grep `2546|5643a2a9|9523|9f8d81e1` 在 plan doc 0 命中**＝無 #115/#114 數據洩漏）。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：採自跑 spike 為原始證據、finder 重現一致 → 一輪 0 新發現。**review agents 未污染 git**（主線驗：HEAD `4ac4dfab`、source blob `86b5639b` 未動、working-tree hash `86b5639b`、staged 空、`git diff 4ac4dfab..HEAD -- functions/` 空、working tree 僅 `?? CLEANUP_PLAN.md` + 本 plan doc）。
- 2026-06-24 **plan doc commit `e7be6dc8`**（branch `refactor/stage7-pr2cr-auth-payments-intents-noimplicitany`、local、未 push、plan-only +235 / 0 source；commit 前後核 staged set 僅 plan doc、`git diff 4ac4dfab..HEAD -- functions/` 空、`HEAD:intents.ts` blob 仍 `86b5639b`）→ 中文報告 6 欄（gate-state `PLAN_SELF_REVIEW_CLEAN`）→ owner 驅動產自足 **ChatGPT Arch packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cr-chatgpt-arch-packet.md`、repo 外、§5 含全 69 行 base source）→ 貼入送外部 ①。
- 2026-06-24 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Blocker / 0 Required Revision**）— 判定本案架構安全「if and only if 維持兩 handler 簽名純型別標註」。**Binding locks LOCK-1..LOCK-8（② Codex Plan 與 Code 階段須保留）**：LOCK-1 source scope：Code 階段只改 `functions/api/auth/payments/intents.ts`；LOCK-2 hunk：只 2 handler 簽名行可改；LOCK-3 runtime：不改 guard / SQL / soft-delete 過濾 / pagination·list 行為 / CORS preflight / response body / status / headers / logging；LOCK-4 env typing：full `Env` 可接受（boundary handler、對齊既有 handler context typing）但須維持 type-only、未另計畫審查前不得改 `Pick<Env>`；LOCK-5 evidence：Code 階段須**重跑 byte-identical** 並確認 emit 相同；LOCK-6 ratchet：預期 TS7031 4 removed / 0 added / 無 cascade；LOCK-7 dirty-tree：`CLEANUP_PLAN.md` 維持 untracked、不得進任何 commit；LOCK-8 gate：本 approval 僅授權「進 Codex Plan Gate」，**不授權 coding / commit / merge / deploy**。**全 8 locks 與本 plan 既有鎖（L1..L13）+ frozen diff 一致、無 plan 改動需求**。**可送 ② Codex Plan Gate；非 coding 授權，待 ② 通過 + owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-24 owner 驅動產 **Codex Plan packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cr-codex-plan-packet.md`、repo 外、**HEAD-independent anchor**〔blocking 純 source-base 不變量：base SHA `4ac4dfab` + `base..HEAD -- functions/` 空 + `HEAD:src` blob == base `86b5639b`；branch HEAD `ac034890` + plan-only commit 數標 [info, 非 blocking]，套 PR-2cp r1/r2 教訓〕、§3 repo replay 程序 + §4 15 項對照表 + §5 LOCK-1..8 核對 + §6 cascade + §7 覆蓋誠實）→ 送外部 ②。
- 2026-06-24 **Codex Plan Gate（② 維度 C）：`CODEX_PLAN_APPROVED`**（**0 blocking / 0 required**）— 機械重驗全數**獨立重現**：`HEAD` `ac034890`（[info]）、base `4ac4dfab` 可解析、**`HEAD:intents.ts` == `4ac4dfab:intents.ts` == `86b5639b`** + `git diff 4ac4dfab..HEAD -- functions/` 空（source 零落地）、in-memory frozen patch 只改 L23/L27 兩簽名、patched blob `4bfaa33f`、byte-identical esbuild stdin 兩端 **1972B** sha `d89b28ae52908385953fb978d3f9a2d5718aa5dfcf5caa2bac2e858d43d8de39` stderr 0、virtual TS replay **801/79/255/334 → 797/78/256/334**〔removed 恰 4 個 intents.ts TS7031、added 0、tests-leaf added 0〕、最終 working tree 僅 `?? CLEANUP_PLAN.md`（未授權/未落地 source）。**HEAD-independent anchor → 零 false-reject**。**Plan Gate 雙道（① ChatGPT Arch + ② Codex Plan）全過 = plan 批准；Codex 明示仍非 `CODING_ALLOWED`、非 code/merge/deploy 授權，待 owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-24 owner **`CODING_ALLOWED` ✅ → Code 階段（source commit `1d47b43c`）**：落地 2 個 handler 簽名（function-declaration、frozen form）。`git diff 4ac4dfab..1d47b43c -- functions/` = intents.ts **+2/−2**、blob `86b5639b→4bfaa33f`、numstat 2/2；全樹 name-status 僅 plan doc(A) + intents.ts(M)、無 stray。**full replay @ committed（不沿用 spike、LOCK-13）全綠**：byte-identical @ committed blobs（base `4ac4dfab:` 與 `HEAD:` 皆 git show、canonical esbuild `--loader=ts --format=esm` stdin）兩端 **1972B** sha `d89b28ae52908385953fb978d3f9a2d5718aa5dfcf5caa2bac2e858d43d8de39`、stderr 0、`diff -q` IDENTICAL（LOCK-5）· checkout-dance sort-diff（patched HEAD **797** / base **801**、restore 後 blob `4bfaa33f`、git status 僅 `?? CLEANUP_PLAN.md`、staged 空）**REMOVED=4 全為目標 4×TS7031〔L23×2/L27×2〕/ ADDED=0** · tests-leaf 0 · ratchet enforce〔`RATCHET_BASE_REF=4ac4dfab`〕**OK**（baseline 1119/175、current **797/256**）· `git diff 4ac4dfab..HEAD --check` clean · **lint green**（eslint + compat-date + workflows 3 檔）· **build:functions「Compiled Worker successfully」** · **targeted `payments.test.ts` 35 passed**（runtime 旁證：空列表 / ORDER BY created_at DESC / status 過濾 / **越權隔離 u1≠u2** / requirePaymentAccess skipKyc gate）。**NB-2 雙證齊**（byte-identical @ committed blob + source diff 逐行 == frozen 2 行）。
- 2026-06-24 **Code self-review = multi-agent workflow（維度 A、converged 三維 diff-fidelity / runtime·security / evidence；run `wf_81f718c6-3f3`、4 agents〔3 finder + 1 verifier〕/ 248672 subagent tokens / 79 tool uses / ~10.3min、finder+verifier 皆 `readonly-reviewer` 繼承 session model `claude-opus-4-8[1m]`、options `__proto__:null`）→ `CODE_SELF_REVIEW_CLEAN`**：diff-fidelity + runtime-security 維 **0 findings**（committed diff = 恰 2 簽名 function-declaration、blob `86b5639b→4bfaa33f`、byte-identical 1972B `d89b28ae`、所有 runtime 不變量〔SQL/JOIN/soft-delete 過濾/requirePaymentAccess/limit clamp/guards/CORS/response〕emit 一致、LOCK-1..8 compliant）。evidence 維 **1 candidate（low）對抗式 verifier REFUTED**：candidate 指「plan doc gate-log 行自身嵌入先例污染 grep pattern 字串 → 自指 false-positive」，verifier 證實**非 defect**（先例 token 在 doc 內僅 1 次、皆在自指 grep-描述字串內；過濾後 0 真洩漏；本 PR emit 值 1972B/`d89b28ae` 與 #115 [id].ts 的 2546B 系列相異、未誤植；**且 #115 plan doc 用同「記錄先例 token 作對比/污染檢查描述」慣例、已過全 4 道外部 gate 含 Codex Code**；移除非任何 LOCK/rule 要求、反降 audit 忠實度）。**accepted 0 / suspicious 0**。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：① `git diff 4ac4dfab..HEAD -- functions/` 逐字 == frozen 2 handler 簽名（function-declaration、非 arrow）、全樹僅 plan doc(A)+intents.ts(M)、numstat 2/2、blob `4bfaa33f`；② byte-identical @ committed 1972B sha `d89b28ae` IDENTICAL；③ 機械值親驗（HEAD 797 無 intents.ts 錯 / REMOVED 4·ADDED 0 / tests-leaf 0 / ratchet 797·256 / payments.test.ts 35 passed）；④ evidence candidate 採 verifier REFUTED〔自指、非真洩漏、#115 同慣例過 gate〕、**不 churn line-60 忠實記錄**、本則 gate-log 不再重嵌 token 字串。**review agents 未污染 git**（HEAD `1d47b43c`、source blob `4bfaa33f` 未動、working-tree hash `4bfaa33f`、staged 空、`git diff 4ac4dfab..HEAD -- functions/` 2 行、working tree 僅 `?? CLEANUP_PLAN.md`）。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；非 merge 授權。**
- 2026-06-24 owner 驅動產 **Codex Code packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cr-codex-code-packet.md`、repo 外、**HEAD-independent anchor**〔blocking = base SHA `4ac4dfab` + `HEAD:src` blob `4bfaa33f` + `4ac4dfab..HEAD -- functions/` 恰 2 行；source-bearing commit `1d47b43c` + branch HEAD `01b03b8f` 標 [info]〕、committed diff + §3 repo replay〔committed 直量 + base checkout-dance〕+ §4 13 項對照表 + §5 LOCK-1..8 + §6 cascade + §7 self-review 摘要 + §8 覆蓋誠實）→ 送外部 ③。
- 2026-06-24 **Codex Code Gate（③ 維度 C，code 正確性主力）：`CODEX_CODE_APPROVED`**（**0 blocking / 0 required**）— 機械重驗 committed code 全數**獨立重現**：committed source diff = 恰 frozen（intents.ts L23/L27 簽名、+2/−2、blob `86b5639b→4bfaa33f`）、`git diff --name-status 4ac4dfab..HEAD` = plan doc(A) + intents.ts(M) only、`CLEANUP_PLAN.md` 未 commit（final status 仍僅 `?? CLEANUP_PLAN.md`）、byte-identical committed base-vs-HEAD esbuild emit 兩端 **1972B** sha `d89b28ae52908385953fb978d3f9a2d5718aa5dfcf5caa2bac2e858d43d8de39` stderr 0、virtual solution replay **801/79/255/334 → 797/78/256/334**〔removed 恰 4 目標 TS7031、added 0、tests-leaf added 0〕、ratchet OK current **797/256**、lint green、build:functions Compiled、`payments.test.ts` **35/35**。State/Queue/Distributed/Observability/Payment-security **N/A 或無 regression**（runtime emit byte-identical、SQL·requirePaymentAccess·soft-delete 過濾·limit clamp·CORS·response·tenant isolation 全不變）。**HEAD-independent anchor → 零 false-reject**。**可進 ④ ChatGPT Faithfulness；非 merge/deploy 授權。**
- 2026-06-24 owner 驅動產 **ChatGPT Faithfulness packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cr-chatgpt-faithfulness-packet.md`、repo 外、自足〔ChatGPT 無 repo access〕：§0 approved plan 錨點 + OD/LOCK + §1 approved frozen vs §2 actual committed 並排 + §3 anti-curated git artifacts〔全樹 name-status / functions stat / source-commit show / status〕+ §4 全 69 行 committed source + §5 byte-identical 硬證據 + §6 14 項 matrix）→ 送外部 ④。
- 2026-06-24 **ChatGPT Code Faithfulness Gate（④ 維度 B-code）：`CHATGPT_CODE_FAITHFULNESS_APPROVED`**（**14/14 Faithful、0 deviation、0 scope creep、無需 Codex 重審**）— actual committed diff 與 approved frozen diff 逐行相同（僅 L23/L27 兩 handler 簽名 inline annotation）；byte-identical 1972B sha `d89b28ae…` 支撐 runtime emit 不變；14 matrix 全 Faithful（檔範圍 / 2 編輯點 / inline annotation / function-declaration 非 arrow / plain Request 無 .cf / full Env 非 Pick / 無 params〔list endpoint〕/ 無 waitUntil / 無 D1-callback·workers-types·新 import / runtime 熱區全不動〔guard·SQL·LEFT JOIN·soft-delete 過濾·limit clamp·CORS·response〕/ 排除檔未動 / 無 return-type·JSDoc·格式 drift / byte-identical / CLEANUP_PLAN.md 未 commit）；anti-curated：`git diff --name-status 4ac4dfab..HEAD` 僅 plan doc(A)+intents.ts(M)、唯一 source-bearing = intents.ts、無「改動但未附 source」檔。**外部 4 道全過（① ChatGPT Arch + ② Codex Plan + ③ Codex Code + ④ ChatGPT Faithfulness）。** 非 merge 授權：merge-front 7 gates + owner `MERGE_ALLOWED` 仍必走。
- 2026-06-24 **merge-front 7 gates 全綠（@ source `1d47b43c`、CI-equivalent、[[feedback_pre_merge_gate_checklist_match_ci]]）**：`lint` ✅（eslint + compat-date + workflows 3 檔）· `typecheck:ratchet`〔`RATCHET_BASE_REF=4ac4dfab`〕✅（baseline 1119/175、current **797/256**）· `verify:browser-pipeline` ✅（classic prod 30 entries + module prod 1 entry byte-equal、HTML `?v=` governance **25 pages / 214 refs** 全等 committed content-hash）· `test:cov` ✅（**25 files / 737 tests passed**、Statements **90.28%** 1933/2141、Branches 92.77%、Functions 92.08%、Lines 90.28%）· `test:int` ✅（**75 files / 1328 tests passed**、Duration 441s；stderr 內 stub-put-fail/uploaded_blocker_verify_failed 等為 error-path 測試刻意觸發、各帶 ✓、非 failure）· `build:functions` ✅（Compiled Worker successfully）· `npm audit --omit=dev --audit-level=high` ✅（**0 vulnerabilities**）。post-gate working tree 僅 `?? CLEANUP_PLAN.md`（.tmp-*/coverage/.tscache gitignored 未污染）、HEAD:src blob `4bfaa33f`、net source 2/2。**外部 4 道 + merge-front 7 gates 全綠；待 owner `MERGE_ALLOWED` → push branch + 開 PR + squash-merge `--delete-branch`。**
- ⬜（後續 dated 收錄：owner `MERGE_ALLOWED` → push branch + 開 PR + squash-merge `--delete-branch` → 監看 main CI + Cloudflare deploy → SHIPPED memory）

## owner 鎖定表（2026-06-24，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 只改 `functions/api/auth/payments/intents.ts`；納入全 4 錯，目標 0 noImplicitAny、cleanFiles +1 |
| L2 Handler type shape | `request: Request`（plain）、`env: Env`（full）；**無 `params`**（list endpoint 無 `[id]`）、**無 `waitUntil`**（本檔不 destructure waitUntil）|
| L3 annotation 形式 | **function-declaration ＋ inline param type**（2 handler）；**禁** arrow const、named type alias、拆多行 |
| L4 No new shared type / no util change | 不新增 shared type、不改任何 util signature（含 `getCorsHeaders`/`requirePaymentAccess`/`isPaymentStatus`/`isPaymentKind`/`res`）|
| L5 env = full Env（**禁 Pick**）| 2 handler 整包 forward env 給 `getCorsHeaders`/`requirePaymentAccess` ＋ `env.chiyigo_db`；無 partial-fake-env unit test → [[feedback_util_env_param_pick_not_full_env]] 不適用、full Env 正確（spike ADDED=0 證）|
| L6 request = plain Request（**禁 CfRequest**）| 僅 forward 給 util（`getCorsHeaders`/`requirePaymentAccess`）+ `new URL(request.url)`，**無 `.cf` 存取** → plain `Request` |
| L7 No new security feature | `requirePaymentAccess(skipKyc)` gate / soft-delete 過濾（`deleted_at IS NULL`）/ `user_id` 綁定 / limit clamp / `isPaymentStatus`·`isPaymentKind` 過濾 / `LEFT JOIN` 全鎖；**本 PR 禁新增/修改任何安全功能**（type-only、不改防禦面）|
| L8 Runtime hot-zone lock | 不改 SQL（SELECT 欄位 / `LEFT JOIN requisition_refund_request ON ... status='pending'` / `WHERE user_id=? AND deleted_at IS NULL` + optional status/kind / `ORDER BY created_at DESC` / `LIMIT ?`）/ `requirePaymentAccess(request, env, { skipKyc: true })` gate / soft-delete 讀取過濾（Codex r1 P0-1）/ `binds` 構築（`[Number(user.sub)]` + 條件 push）/ limit clamp（`<1→20`、`>100→100`）/ `isPaymentStatus`·`isPaymentKind` guard / response `{ items, count }` |
| L9 Spike evidence | full-solution spike 必須**非 commit**，證明 **REMOVED=4 / ADDED=0** |
| L10 byte-identical evidence | byte-identical 必須是 **type-strip / canonical emit 證據**（esbuild `--loader=ts --format=esm` stdin），不接受「測試通過」替代 |
| L11 Coverage | handler 有 direct integration test（`payments.test.ts`），但 type-only 改動 runtime 不可見 → **主硬保證 ＝ byte-identical**，integration test 僅作 runtime 旁證、不宣稱「覆蓋型別標註」（[[feedback_pr_coverage_claim_accuracy]]）；`onRequestOptions` 無 direct test |
| L12 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical / tests-leaf；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L13 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / coverage overclaim / 偏離 OD（用 `Pick` / 用 `CfRequest` / arrow const / 加 `params` / 加 `waitUntil` / 新增安全功能 / 動 guard·SQL）→ 退回 `PLAN_DRAFT` |

## ⚠ payments 熱區聲明（review care L3，Tier-0 金流）

`auth/payments/intents.ts` 為**使用者 payment intents 列表（GET collection，dashboard 交易紀錄用）＋ CORS preflight** 入口，金流敏感（讀取面）：

| handler | 流程 | 紅線（typing 全程不得牽動）|
|---|---|---|
| `onRequestOptions` | CORS preflight → 204 + `getCorsHeaders(request, env, { credentials: true })` | CORS header 構築不動 |
| `onRequestGet` | `getCorsHeaders` → **`requirePaymentAccess(request, env, { skipKyc: true })` gate**（error 直回）→ URL parse + `limit` clamp（`!Number.isFinite\|\|<1 → 20`、`>100 → 100`）→ **`where=['user_id = ?', 'deleted_at IS NULL']`（soft-delete 過濾，Codex P0-1）** + `binds=[Number(user.sub)]` → optional `isPaymentStatus(status)`/`isPaymentKind(kind)` push → **SELECT（含 `LEFT JOIN requisition_refund_request ON rr.intent_id=pi.id AND rr.status='pending'`）+ `WHERE pi.* ORDER BY pi.created_at DESC LIMIT ?`** → `res({ items: rows.results ?? [], count }, 200)` | requirePaymentAccess gate、limit 上限、soft-delete 過濾語意、user_id 綁定、status/kind guard、SQL+JOIN、response shape 全不動 |

修法若非純型別、或牽動上列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L7/L8）。本刀只在 2 個 exported handler 簽名加 inline param annotation，TS erase 後 runtime byte-identical（SQL / 常數 / limit clamp / guards / 字串 / 註解全不變）。

### Coding 階段硬性邊界

- **允許**：2 handler 簽名各加 inline param type（§frozen diff 唯一變更行，L23/L27）。
- **禁止**：改任何 SQL / `LEFT JOIN` / `WHERE`·soft-delete 過濾 / `requirePaymentAccess(skipKyc)` / limit clamp / `binds` 構築 / `isPaymentStatus`·`isPaymentKind` / response body·count / **新增任何安全功能** / caller（`payments.test.ts`）/ shared util / tests / `env.d.ts` / `tsconfig`·`eslint`·`vitest` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types` / `Pick<Env>` / arrow const 形式 / 加 `params`·`waitUntil` / **碰排除檔**（`admin/payments/intents.ts`、`payment-return/ecpay.ts`、`[id].ts`、其餘 payments 檔）/ 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `4ac4dfab`）

### 依賴邊界（caller cascade）

`intents.ts` 是 Pages file-routing entry，cascade 面（**頭號 scout 風險 ＝ tests-leaf cascade**；spike 實測 = 0）：

| 面 | 判定 | 證據 |
|---|---|---|
| 外部 production TS caller | **0 牽動** | functions/ **無任何 TS/JS importer**（Pages file-routing、production runtime 由 Pages 注入 context、不靜態 type-check 本 annotation；唯一非-test 出現點為 i18n JSON / case-platform 文案字串，非 import）|
| direct integration test importer（**唯一檔 `payments.test.ts`**）| **0 cascade（spike 實測）** | import `onRequestGet as listHandler`（L54）；**全 direct-literal** 呼叫：`listHandler({ request: bearer('GET', …, tok), env })`（L197/208/218/229，恰 `{ request, env }` 兩屬性）。`bearer()` 回 `new Request(...)` → `Request` ✓；`env` 來自 `cloudflare:test`（`types/env.d.ts` `interface ProvidedEnv extends Env` 橋接）→ assignable `env: Env` ✓；literal 恰 2 屬性、無 excess → 0 TS2345/TS2353（同 PR-2cq [id].ts / PR-2cp login direct-literal 先例）。`onRequestOptions` **無 test importer**（0 風險）。**spike `tsc -b tsconfig.solution.json --force` 全 leaf：tests-leaf 0→0、0 TS2345 實證** |
| util forward（`getCorsHeaders`/`requirePaymentAccess`）+ `env.chiyigo_db` | 全相容、0 cascade | 各 util `env`/`request` 參數現為 untyped（implicit any，屬各自待清錯）→ `Env`/`Request` assignable；`env.chiyigo_db`（`D1Database`→any）→ `.prepare().bind().all()` 回 any → `rows` any、`rows.results` 存取無錯（spike ADDED=0 實證）|

**precedent landscape（佐證 OD ruling）**：
- **`request: Request` / `env: Env` 直連 handler** ＝ repo 主流 Convention A（數十檔已清，含 A 域 #109..#114 + payments #115）→ **零新 OD**；`env` 用 **full `Env`**（handler 整包 forward util，util 各收 untyped/Pick、full Env structural assignable，[[feedback_util_env_param_pick_not_full_env]]）。
- **無 `params`**：list/collection endpoint（無 `[id]` 動態段）→ 不觸 `Record<string, string>` params convention（比 #115 [id].ts 更簡）。
- **無 `waitUntil`**：2 handler 皆不 destructure `waitUntil`（無 fire-and-forget）→ 不觸 waitUntil OD。
- **無 D1-row `.map` callback**：查詢走 inline SQL（`env.chiyigo_db...all()`）但 `rows` 為 any（D1Database→any）、僅 `rows.results ?? []` 直取（無 per-row 欄位存取 / 無 callback）→ 不觸 register #111 的 D1-row callback OD。
- **direct-literal test caller**（`payments.test.ts`）：與 PR-2cq [id].ts / PR-2cp login user-audit 同款（`{ request: bearer(...), env }` literal、`ProvidedEnv extends Env` 橋接）→ 0 cascade。

### 型別選型（OD ruling）

允許落地的唯一 source diff（2 編輯點）：

```ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {  // L23
export async function onRequestGet({ request, env }: { request: Request; env: Env }) {       // L27
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| `request` | **`Request`（plain）** | forward 給 `getCorsHeaders`/`requirePaymentAccess` + `new URL(request.url)`；**無 `.cf`** → 非 `CfRequest` |
| `env` | **`Env`（full，Convention A）** | 整包 forward util + `env.chiyigo_db`(any)；spike ADDED=0 證零 cascade；無 partial-fake-env unit test → 不用 Pick |
| `params` | **不加**（list endpoint 無 `[id]`）| 本檔 handler 不 destructure params |
| `waitUntil` | **不加**（無 fire-and-forget）| 本檔 handler 不 destructure waitUntil |
| annotation 形式 | **function-declaration + inline type** | 保原 runtime shape、byte-identical、編輯點最小；**禁** arrow const |
| OD 形態 | **零新 OD**（純 Convention A；無 params、無 waitUntil、無 D1-row callback）| payments 域最簡入口 |
| `Pick<Env>`（**否決**）| **禁** | env 整包 forward、無 partial-fake-env caller；Pick 誤導「只用部分 env」|
| `CfRequest`（**否決**）| **禁** | 無 `.cf` 存取；引入多餘語義 |
| arrow const 形式（**否決**）| **禁** | 破壞 byte-identical / 編輯點 / runtime shape |
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 4 錯 |

## Spike 實證（full-solution，本地未 commit，2026-06-24，已 revert clean）

**程序**：建 branch（自 clean main `4ac4dfab`）→ 量 base（forced solution leaf total 801、本檔 4 錯、base emit 1972B sha `d89b28ae…`、tests-leaf 0）→ 套 2 編輯點（L23/L27）→ forced `tsc -b tsconfig.solution.json --force`（sorted error set diff、含全 leaf）→ ratchet report → canonical byte-identical（esbuild stdin）→ frozen diff + `git diff --check` → `git checkout HEAD --` revert → 驗 clean（blob 回 `86b5639b`、staged 空、`git status` 僅 `?? CLEANUP_PLAN.md`）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| `intents.ts` errors 4 → 0 | ✅ sort-diff REMOVED = 恰 4 行（L23 ×2 / L27 ×2 TS7031）；patched 0 殘留 |
| solution total errorCount 801 → 797（恰 −4）| ✅ forced `tsc -b tsconfig.solution.json --force` total **797**；sort-diff ADDED = **空（0）**|
| zero cascade（全 leaf：functions + scripts + tests + browser）| ✅ solution sort-diff **REMOVED=4 / ADDED=0**；tests-leaf 行 patched **0**（base 0）= **tests-leaf cascade 0（頭號風險 cleared）**|
| canonical ratchet `--report`（base → patched）| ✅ base errorCount **801** / errorFiles **79** / cleanFiles **255** / sourceFilesTotal **334** → patched **797** / **78** / **256** / **334**（本檔全清入 cleanFiles）|
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`** stdin，[[feedback_byte_identical_emit_verification]]）| ✅ esbuild **stdin** type-strip base vs patched **IDENTICAL**、皆 **1972B**、esbuild stderr 空：<br>sha256 `d89b28ae52908385953fb978d3f9a2d5718aa5dfcf5caa2bac2e858d43d8de39` 兩端 |
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace / lone space）|
| frozen diff numstat | ✅ `2  2`（2 insertion / 2 deletion；無 whole-file CRLF churn）；base blob `86b5639b` → head blob `4bfaa33f` |
| working tree revert clean | ✅ `git checkout HEAD --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、blob 回 `86b5639b`、staged 空 |

**byte-identical 適用性**：`intents.ts` 3 個 import statement（`utils/auth` / `utils/cors` / `utils/payments`）→ esbuild stdin transform **適用**（單檔 transform、import 行原樣保留；type-only annotation PR 這正是對的證明面 — 改動僅限本單檔、其他檔 byte 不變 → bundle 等價）。⚠ 用 **stdin**（`<` / pipe），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell，[[feedback_byte_identical_emit_verification]]）；本 spike emit 1972B 非空、已排除該坑。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/payments/intents.ts b/functions/api/auth/payments/intents.ts
index 86b5639b..4bfaa33f 100644
--- a/functions/api/auth/payments/intents.ts
+++ b/functions/api/auth/payments/intents.ts
@@ -20,11 +20,11 @@ import { res } from '../../../utils/auth'
 import { getCorsHeaders } from '../../../utils/cors'
 import { requirePaymentAccess, isPaymentStatus, isPaymentKind } from '../../../utils/payments'

-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
 }

-export async function onRequestGet({ request, env }) {
+export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
   const cors = getCorsHeaders(request, env, { credentials: true })
   const { user, error } = await requirePaymentAccess(request, env, { skipKyc: true })
   if (error) return error
```

`git diff --stat`：1 file changed, 2 insertions(+), 2 deletions(-)；`git diff --numstat`：`2  2`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `4ac4dfab` `--report`：errorCount **801** / errorFiles **79** / cleanFiles **255** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **801 → 797**（−4）、errorFiles **79 → 78**、cleanFiles **255 → 256**（spike 實測值、非預測；本檔全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 797」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 2 個 exported handler 簽名 inline param 型別標註，TS erase 後 runtime byte-identical（§Spike sha `d89b28ae…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 801、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。
- **無 D1 migration**（純 type-only、不觸 schema）→ 不觸發 migration-before-merge（[[feedback_migration_before_merge_autodeploy]]）。

## 測試影響面（覆蓋誠實，L11 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf 0→0 實證）。
- **覆蓋分層（誠實，逐 sub-path 下鑽）**：

| 標的 | direct test | 真打路徑 | 硬保證 |
|---|---|---|---|
| `onRequestGet`（list collection）| ✅ **有**：`payments.test.ts`（GET list：自己的 intents、status/kind 過濾、limit）| direct-literal `listHandler({ request: bearer('GET',…,tok), env })`（L197/208/218/229）| **byte-identical 為主硬保證**；integration test 為 runtime 旁證 |
| `onRequestOptions`（CORS preflight）| ⚠ **無 direct test**（OPTIONS 不被 test import）| — | byte-identical（emit 不變）|

- **下鑽證據（不 overclaim）**：
  - direct integration test 涵蓋 GET list 的 user-scoped 列表 + status/kind 過濾 + limit（runtime 旁證）。
  - **誠實界線**：type-only 改動 runtime 不可見（型別 erase）＋ direct-literal `handler({...})` 雖型別連結存在（非 callFunction sever），但測試斷言的是 runtime 行為（status / body / 過濾結果）、非型別標註本身 → integration test **不能「覆蓋」型別標註本身**；它提供「emit 不變則列表行為不變」的旁證。**主硬保證 = byte-identical emit（sha 兩端一致）**。
  - `onRequestOptions` 無 direct test → 僅靠 byte-identical（OPTIONS handler emit 不變、CORS 行為不變）。
- 與 PR-2ci..2cq（皆以 byte-identical 為硬保證）同策略；本檔有 list direct test 作旁證，但**仍不宣稱 type annotation 被測試覆蓋**。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`（或用 `--force`）。**PowerShell 用 `$env:RATCHET_BASE_REF='4ac4dfab'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='4ac4dfab'; npm run typecheck:ratchet` green（801→797 / 79→78 / 255→256）。
- forced `tsc -b tsconfig.solution.json --force`：本檔 0 殘留 + sort-diff **REMOVED=4 / ADDED=0** + tests-leaf 行 0（0 TS2345）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**：

```bash
git show "4ac4dfab:functions/api/auth/payments/intents.ts" | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/intents-base.js 2>/tmp/intents-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < "functions/api/auth/payments/intents.ts" > /tmp/intents-head.js 2>/tmp/intents-head.err
wc -c /tmp/intents-base.js /tmp/intents-head.js          # 期望 1972 兩端
sha256sum /tmp/intents-base.js /tmp/intents-head.js       # 期望 d89b28ae52908385… 兩端
cat /tmp/intents-base.err /tmp/intents-head.err            # 期望空（stderr 0 bytes）
diff -q /tmp/intents-base.js /tmp/intents-head.js           # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show 4ac4dfab:` 讀未改 base。spike 本地實證：兩端 **1972B / `d89b28ae…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 2 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量；確認 inline param annotation 不觸 `no-floating-promises`/`no-unused-vars`/`no-undef`）、`npm run build:functions` green。
- targeted int：跑 `payments.test.ts` 確認綠（runtime 旁證、不宣稱涵蓋 type annotation）；跑全量 `test:int`（金流牽動多 test）確認無跨檔破壞。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +2/−2、`git diff` 2 處為 handler 簽名）；超出 = scope creep = Gate fail。
