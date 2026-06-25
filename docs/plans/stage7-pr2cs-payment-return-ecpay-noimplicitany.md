# Stage 7 reduce PR-2cs — `payment-return/ecpay.ts` noImplicitAny（**payments 域第三棒 / micro**；2 個 direct handler、**無 env、無 params、無 waitUntil、無 D1**、type-only、review care **L2**）

**目標**：`functions/payment-return/ecpay.ts`（ECPay OrderResultURL 中介、**純 UX 303 redirect**）的 **2 個 noImplicitAny error（2×TS7031：2 個 handler destructure 的 `request`）→ 0**，**純 type-only**（**2 個編輯點** ＝ 2 個 exported handler `onRequestPost`/`onRequestGet` 的 destructured param annotation；TS erase 後 emit byte-identical）。本 PR ＝ payments 大熱區 **第三棒（micro，error 數最低、blast radius 最小）**（接 PR-2cq #115 `4ac4dfab` `[id].ts`、PR-2cr #116 `91fc49c4` `intents.ts` list）。owner 2026-06-25：A 域全清 + payments 前兩棒（讀取面）清完後，續清 payments light→heavy，本棒為候選裡 error 數最低、**非權威**（不驗章、不寫 D1）的 micro 入口。

> ⚠ **路徑校正（faithful 收錄）**：owner SPEC_APPROVED scope-lock 文字寫 `functions/api/payment-return/ecpay.ts`，**實際檔案在 `functions/payment-return/ecpay.ts`（無 `/api/` 段）**——tsc error 輸出、`checkout/ecpay.ts:146` 的 OrderResultURL 字串 `${origin}/payment-return/ecpay`、`Glob functions/**/payment-return/**` 皆證實**唯一檔位於 `functions/payment-return/ecpay.ts`**、`functions/api/payment-return/` 不存在。判定為明顯路徑筆誤（指向同一檔、errors 同為 L13/L32），**以驗證過的真實路徑為準**、本 plan 全程用 `functions/payment-return/ecpay.ts`。

**Scope（owner 鎖 2026-06-25；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/payment-return/ecpay.ts` | 2（2 handler destructure，全 TS7031）| **2 個編輯點**（`onRequestPost` L13 / `onRequestGet` L32 的 destructure param annotation）|

精確錯位（forced `tsc -b tsconfig.solution.json --force`，filtered 本檔）：

```
functions/payment-return/ecpay.ts(13,39): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/payment-return/ecpay.ts(32,38): error TS7031: Binding element 'request' implicitly has an 'any' type.
```

**恰 2 個**（owner 預估一致）：2 handler × destructure param（各 `request`）。`onRequestPost`（request）= 1；`onRequestGet`（request）= 1。**無第 3 錯**：兩 handler 皆**只 destructure `{ request }`**（無 env / params / waitUntil）；body 內 `await request.text()`（request→Request、回 string）、`new URLSearchParams(body)`、`params.get(...)`（string|null）、`new URL(request.url)`（request→Request、url→URL）、`url.searchParams.get(...)`（string|null）、`encodeURIComponent(...)`、`new Response(null, {...})` 皆已被既有型別涵蓋、無新隱式 any；**無 env**（不存取 `env.*`、無 D1 / KV / binding）、**無 D1-row callback**、**無 `params`**（OrderResultURL 中介、非動態路由段）。

> **主線定位**：A 域（A1..A3 auth handler 層）全清（殿後棒 PR-2cp `local/login.ts` #114 `c04d1fab`）→ payments 域第一棒 PR-2cq `auth/payments/intents/[id].ts` #115 `4ac4dfab`（詳情/自刪）→ 第二棒 PR-2cr `auth/payments/intents.ts` #116 `91fc49c4`（列表）→ **第三棒本棒 `payment-return/ecpay.ts`（micro、非權威 UX redirect）**。payments 域 light→heavy 候選（owner 2026-06-25）：**`payment-return/ecpay.ts`(2，本棒) →** `utils/payment-vendors/mock.ts`(6) / `auth/payments/checkout/ecpay.ts`(6) / `admin/payments/intents.ts`(9〔TS7053+CSV PII 首見 OD、另立一棒〕) / `utils/payments.ts`(18) → 重檔殿後（`utils/payment-vendors/ecpay.ts` 27 / `webhooks/payments/[vendor].ts` 19 / refund·delete·aggregate·dlq·metadata-archive·refund-request）→ **audit 域(~375/12 檔，含 F-3 DORMANT)最後**。**結構特性**：**2 個 direct handler**（`onRequestPost`/`onRequestGet`，param 直接 destructure，**無 wrapper/worker、無 `ctx`、無 `env`、無 `waitUntil`、無 `params`、無其他 export**）；**無任何 import**（檔頭僅 docstring + 2 export）→ payments 域**結構最簡入口**（2 錯、2 編輯點、零新 OD；比 #115/#116 更簡，無 env/無 SQL/無 auth gate）。**非權威金流** → review care **L2**（非 #115/#116 的 Tier-0 讀取面 L3）。**排除**：`utils/payment-vendors/mock.ts`、`auth/payments/checkout/ecpay.ts`、`admin/payments/intents.ts`、`utils/payments.ts`、`auth/payments/intents.ts`（#116 已清）、`auth/payments/intents/[id].ts`（#115 已清）、其餘 payments / 重檔、util、大熱區 `audit` 域（defer 殿後）。

## base 錨點（current main，非 stale）

- **base ＝ current main `91fc49c4`**（`git rev-parse HEAD` 實證 `91fc49c45be691904e615070d5b7ba251a048a2f`、main clean〔僅 `?? CLEANUP_PLAN.md` untracked〕、HEAD==main==origin/main 三者一致）。
- 此即 PR-2cr #116（`intents.ts` list）squash commit；owner prompt base SHA 與實查一致、**無 stale 修正**。
- branch `refactor/stage7-pr2cs-payment-return-ecpay-noimplicitany`（自 clean main `91fc49c4` 開、未 push）。
- base:src blob ＝ `63b2a4b2ec611b2cbaee508494220ee20b0b74fd`；plan-only commit 後 `HEAD:src` blob 仍須 == base（source 零落地，[[feedback_gate_packet_replay_anchor_head_vs_base]]）。

## annotation 形式裁定（沿 PR-2cp/2cq/2cr frozen form：function-declaration + inline param type）

- **正式 frozen form ＝ function-declaration ＋ inline param type**（沿 PR-2cp..2cr 既定，[[feedback_gate_packet_replay_anchor_head_vs_base]] 同段「annotation 形式 = function-declaration、非 arrow const」）：
  ```ts
  export async function onRequestPost({ request }: { request: Request }) {
  export async function onRequestGet({ request }: { request: Request }) {
  ```
- **禁** arrow const（破壞 byte-identical / 編輯點 / function-declaration hoisting runtime shape）、**禁** named type alias、**禁** 拆多行。
- 與 #115/#116 唯一差別：**本檔 2 handler 皆只 destructure `{ request }`**（OrderResultURL 中介、不用 env/SQL/CORS）→ type shape 為 `{ request: Request }`（**無** `env: Env`、**無** `params`、**無** `waitUntil`）。屬 Convention A 的 **request-only 最小子集**（對稱於 PR-2a `portfolio.ts` 的 env-only `{ env }`），**只標 destructure 到的 `request`、不加未使用的 env binding**（保最小 diff、不改 destructure 結構）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔、2 annotation）/ review care **L2**（payments 域**鄰接**，但本檔**非權威**：docstring L9 自證「不在這裡驗章 / 不寫 D1 — 真實狀態更新走 ReturnURL〔webhook handler〕。這隻純 UX redirect」；無 auth gate、無 D1、無簽章驗證、無 tenant scope、redirect target 恆同源相對路徑 + `encodeURIComponent`〔無 open-redirect 面〕）。**仍走完整 Dual Gate v3.1 四道外部審查、不降級**（金流鄰接、就高不就低）。
- **self-review ＝ multi-agent workflow（owner 2026-06-25 明示不降單 agent；payments 鄰接域就高不就低、維持 #115/#116 cadence、不開 downgrade 先例，[[feedback_self_review_form_not_downgradable_by_spike]]）**。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（不碰任何他檔、不碰排除檔、不碰 runtime 紅線〔redirect target 構築 / 303 status / Location header / `encodeURIComponent` / `MerchantTradeNo` 取值 / try-catch / docstring〕、不碰 `CLEANUP_PLAN.md`）。finder/verifier 用 **`readonly-reviewer` agent**（無 model pin → 繼承 session model Opus 4.8，[[feedback_selfreview_workflow_model_inheritance]]；options `__proto__:null` no-haiku 機械保證；**非機械安全邊界、持 Bash、read-only 屬 best-effort**）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner 2026-06-25：scope ＝ 單檔 `payment-return/ecpay.ts`、納入全 2 錯；base 錨 `91fc49c4`；OD ① `request: Request`（plain）② **無 env / 無 params / 無 waitUntil**；annotation 形式 ＝ function-declaration + inline type；self-review 形式 ＝ multi-agent workflow（不降單 agent）；**禁** `CfRequest`、**禁** 加 env/params/waitUntil、**禁** required runtime 改動、**禁** 新增安全功能、**禁** `EventContext`/`@cloudflare/workers-types`/新 import/新 ambient；排除檔 + 全 util + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `91fc49c4`）→ 逐檔 error set（**恰 2 錯：2 TS7031 `request`**，符 owner 預估）+ caller cascade（**無任何 TS importer**：全 repo grep「payment-return」8 命中皆 docs/baseline/別檔字串、無 test、無 functions import；`checkout/ecpay.ts:146` 僅 URL 字串引用）+ 結構判定（2 direct handler、無 wrapper/worker/`ctx`/`env`/`waitUntil`/`params`/其他 export、無 import）+ 無 `request.cf` + 無 D1。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、blob 回 `63b2a4b2`）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow `wf_50a54d0b-324`、3 readonly-reviewer finders 全 `claude-opus-4-8`〔54/54 model 記錄、0 haiku model〕、收斂三維 rubric scope-fidelity / runtime-security / evidence-integrity；**candidateCount 0 / 0 findings**；主線獨立裁決非採 raw — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 維度 B、**0 Blocker / 0 Required Revision / 1 NB**、binding locks LOCK-1..11、全對齊本 plan L1..L13 + frozen diff、無 plan 改動 — 見 §Gate 進程紀錄）→ ✅ `CODEX_PLAN_APPROVED`（② 維度 C、**0 blocking / 0 required**、HEAD-independent anchor 零 false-reject、live repo 機械 replay 全數重現 — 見 §Gate 進程紀錄）→ ⬜ owner `CODING_ALLOWED`（**待 owner 明示；Codex 已聲明 ② 非 coding 授權**）
  - ✅ Code 階段（owner `CODING_ALLOWED` → source commit `5791b165`、full replay @ committed 全綠、NB-2 雙證）→ ✅ `CODE_SELF_REVIEW_CLEAN`（維度 A workflow `wf_a8b26619-b23`、3 readonly-reviewer finders 全 `claude-opus-4-8`〔64/64、0 haiku〕、三維 diff-fidelity/runtime-security/evidence、**0 findings** — 見 §Gate 進程紀錄）→ ✅ `CODEX_CODE_APPROVED`（③ 維度 C、**0 blocking / 0 required**、repo 機械重放全數重現 — 見 §Gate 進程紀錄）→ ✅ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④ 維度 B-code、**15/15 Faithful、0 deviation、無需 Codex 重審**；**外部 4 道全過** — 見 §Gate 進程紀錄）
  - ✅ merge-front 7 gates 全綠（lint / ratchet **795·257** / verify:browser-pipeline 25p·214ref / test:cov **737**·90.28% / test:int **1328** / build:functions / npm audit **0** — 見 §Gate 進程紀錄）→ ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-25 Claude **scout（read-only @ `91fc49c4`）** → 逐檔 error set（**恰 2 錯**：L13,39〔request〕、L32,38〔request〕、皆 TS7031）+ caller cascade（**無任何 TS importer**：全 repo grep「payment-return」無 test、無 functions import；`functions/api/auth/payments/checkout/ecpay.ts:146` 僅以 URL 字串 `${origin}/payment-return/ecpay`〔OrderResultURL〕引用、非 type import）+ 結構判定（**2 direct handler**、無 wrapper/worker/`ctx`/`env`/`waitUntil`/`params`/其他 export、**無任何 import**）+ 無 `request.cf`（plain `Request`）+ 無 D1。全對齊 owner 預估。
- 2026-06-25 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（solution 797→795、sort-diff REMOVED=2/ADDED=0、byte-identical 877B sha `611b28c2…` 兩端一致 esbuild stderr 0、ratchet 797/78/256/334 → 795/77/257/334、frozen diff numstat 2/2 blob `63b2a4b2→e981d835`、`git diff --check` clean、revert 後 blob 回 `63b2a4b2`）。
- 2026-06-25 **multi-agent workflow self-review（維度 A，run `wf_50a54d0b-324`、3 agents〔3 finder、0 verifier ∵ 0 candidate〕/ 168119 subagent tokens / 37 tool uses / ~2.7min；finder 皆 `readonly-reviewer` 繼承 session model `claude-opus-4-8`〔subagent 記錄 54/54 `claude-opus-4-8`、0 haiku model〕、options `__proto__:null`）→ `PLAN_SELF_REVIEW_CLEAN`**：收斂三維 rubric（scope-fidelity / runtime-security / evidence-integrity）**candidateCount 0 / verified [] / 全 0 findings**。三 finder 各自 read-only 獨立重現：scope-fidelity（恰 2 編輯點 / 1 檔 / 2 TS7031 `request` / 無漏 handler / 無 excluded-file 接觸 / 路徑 `functions/payment-return/ecpay.ts` 正確非 api/ / frozen diff = 2 簽名行 / 無加 env·params·waitUntil）、runtime-security（byte-identical base emit 877B sha `611b28c2…` 重現 / redirect·303·Location·encodeURIComponent·MerchantTradeNo·try-catch·docstring 全不動 / plain Request 正確〔無 `.cf`、無 env 存取〕/ 非權威〔無驗章·無 D1·無 auth〕確認 / 無 open-redirect 面）、evidence-integrity（base SHA `91fc49c4` == current main / base blob `63b2a4b2` / 算術自洽 797−2=795·78−1=77·256+1=257 / 無 sibling-PR 數據洩漏〔2546/5643a2a9/1972/d89b28ae 等未誤植為本 PR 證據〕/ coverage 誠實無 overclaim）。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：採自跑 spike 為原始證據、finder 重現一致 → 一輪 0 新發現。**review agents 未污染 git**（主線驗：HEAD `91fc49c4`、source blob `63b2a4b2` 未動、working-tree hash `63b2a4b2`、staged 空、`git diff 91fc49c4..HEAD -- functions/` 空、working tree 僅 `?? CLEANUP_PLAN.md` + 本 plan doc）。
- 2026-06-25 **plan doc commit `6806a35d`**（branch `refactor/stage7-pr2cs-payment-return-ecpay-noimplicitany`、local、未 push、plan-only +239 / 0 source；commit 前後核 staged set 僅 plan doc、`git diff 91fc49c4..HEAD -- functions/` 空、`HEAD:ecpay.ts` blob 仍 `63b2a4b2`）→ 中文報告 6 欄（gate-state `PLAN_SELF_REVIEW_CLEAN`）→ 產自足 **ChatGPT Arch packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cs-chatgpt-arch-packet.md`、repo 外、§2 含全 39 行 base source）→ 送外部 ①。
- 2026-06-25 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Blocker / 0 Required Revision / 1 Non-blocking Note**）— 6 項架構提問全認可（① typing `request: Request` plain 正確·`CfRequest` 過度·`env` 不必要且非最小 diff / ② 非權威語義健全〔docstring 自證不驗章·不寫 D1、真實狀態走 webhook〕/ ③ 同源 relative redirect `/payment-result.html` + `encodeURIComponent` 無 open-redirect / ④ 無 migration·schema·前端·API 契約·cache-bust、rollback 單 squash revert / ⑤ frozen diff 恰 2 簽名行無偷渡 / ⑥ byte-identical 877B `611b28c2…` 為主硬證據符 NB-2、不以 ratchet/測試替代）。**Binding locks LOCK-1..11（② Codex Plan 與 Code 階段須保留）**：LOCK-1 只改 `functions/payment-return/ecpay.ts`；LOCK-2 只 `onRequestPost`/`onRequestGet` 兩簽名行；LOCK-3 只 `({ request }: { request: Request })`；LOCK-4 禁加 `env`/`params`/`waitUntil`；LOCK-5 禁 `CfRequest`/`EventContext`/`@cloudflare/workers-types`/new import/shared alias/ambient；LOCK-6 runtime 紅線（redirect target / 303 / Location / `encodeURIComponent` / `MerchantTradeNo` 取值 / `URLSearchParams` / `URL` parse / try-catch / `?? ''`）；LOCK-7 禁 arrow const/named alias/拆多行/return type/format cleanup/docstring cleanup；LOCK-8 payments 邊界禁新增驗章/D1 write/auth gate/tenant scope/payment success 判定；LOCK-9 Code 階段重跑 forced sort-diff/ratchet/byte-identical/`git diff --check`、不沿用 spike 當最終證據；LOCK-10 `CLEANUP_PLAN.md` untracked 不進任何 commit；LOCK-11 gate 邊界（僅授權進 ② Codex Plan、非 coding/merge/deploy）。**全 11 locks 與本 plan 既有 L1..L13 + frozen diff 一致、無 plan 改動需求。** **NB-1**：owner 原 scope 寫 `functions/api/payment-return/ecpay.ts`、packet 校正為 `functions/payment-return/ecpay.ts`（合理路徑筆誤、非 RR）→ 後續 ②/③/④ packet 開頭保留「路徑校正」段、列明 `functions/api/payment-return/` 不存在。**可送 ② Codex Plan Gate；非 coding 授權，待 ② 通過 + owner 明示 `CODING_ALLOWED`。**
- 2026-06-25 owner 驅動產 **Codex Plan packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cs-codex-plan-packet.md`、repo 外、**HEAD-independent anchor**〔blocking 純 source-base：base `91fc49c4` + `HEAD:src` blob `63b2a4b2` == base + `91fc49c4..HEAD -- functions/` 空；branch HEAD `a1e3fd55` + 2 plan-only commit 標 [info, 非 blocking]〕、§1 路徑校正 + §3 repo replay + §4 13 項對照 + §5 LOCK-1..11 + §6 cascade + §7 覆蓋誠實）→ 送外部 ②。
- 2026-06-25 **Codex Plan Gate（② 維度 C）：`CODEX_PLAN_APPROVED`**（**0 blocking / 0 required**）— live repo read-only replay 全數**獨立重現**：3 blocking anchor 全符（base `91fc49c45…` / base·HEAD source blob `63b2a4b2…` 一致 / `91fc49c4..HEAD -- functions/` 空）、全樹 diff plan-only（`A docs/plans/stage7-pr2cs-…md`）、**路徑校正成立**（`functions/api/payment-return/` 不存在、`git ls-files | rg payment-return` 僅命中 plan doc + 實檔 `functions/payment-return/ecpay.ts`）、byte-identical base==virtual-patched **877B** sha `611b28c2253f1c9c4d7d32a6469a0c34ee142a5aadd088188907ed8824f9d7ab` stderr 0 `diff -q` identical、base forced tsc **797/78** 含 2 預期 ecpay TS7031、patched in-memory solution **795/77/257/334** ecpayErrors=0、sort-diff **REMOVED=2〔(13,39)+(32,38)〕/ ADDED=0**、frozen blob `63b2a4b2→e981d835` +2/−2 numstat `2 2`、final source blob 仍 `63b2a4b2…` status 僅 `?? CLEANUP_PLAN.md`。**HEAD-independent anchor → 零 false-reject。** **Plan Gate 雙道（①+②）全過 = plan 批准；Codex 明示 ② 非 `CODING_ALLOWED`、code 階段須在 committed source edit 後重跑 evidence；待 owner 明示 `CODING_ALLOWED` 才進 Code 階段。** ⚠ Codex 附帶 non-blocking 觀察：memory-hygiene closeout audit `WARN`（`MEMORY.md` 超行數門檻、近 byte 門檻）→ 屬 memory 治理範圍外項、與本 PR 解耦、另案處理（不 bundle 進本 review）。
- 2026-06-25 owner **`CODING_ALLOWED` ✅ → Code 階段（source commit `5791b165`）**：落地 2 handler 簽名（function-declaration、frozen form）。`git diff 91fc49c4..5791b165 -- functions/` = ecpay.ts **+2/−2**、blob `63b2a4b2→e981d835`、numstat 2/2；全樹 name-status 僅 plan doc(A) + ecpay.ts(M)、無 stray。**full replay @ committed（不沿用 spike、LOCK-9）全綠**：byte-identical @ committed blobs（base `91fc49c4:` 與 `HEAD:` 皆 git show、canonical esbuild `--loader=ts --format=esm` stdin）兩端 **877B** sha `611b28c2253f1c9c4d7d32a6469a0c34ee142a5aadd088188907ed8824f9d7ab`、stderr 0、`diff -q` IDENTICAL（LOCK-5、NB-2 #1）· forced sort-diff（patched HEAD **795** / base **797**）**REMOVED=2 全為目標 2×TS7031〔(13,39)/(32,38)〕/ ADDED=0** · ratchet enforce〔`RATCHET_BASE_REF=91fc49c4`〕**OK**（baseline 1119/175、current **795/257**）· `git diff 91fc49c4..HEAD --check` clean · **lint green**（eslint + compat-date + workflows 3 檔）· **build:functions「Compiled Worker successfully」**。**NB-2 雙證齊**（byte-identical @ committed blob + source diff 逐行 == frozen 2 行）。本檔無 direct test → byte-identical 為主硬保證（全量 test:int/test:cov 留 merge-front）。
- 2026-06-25 **Code self-review = multi-agent workflow（維度 A、converged 三維 diff-fidelity / runtime-security / evidence；run `wf_a8b26619-b23`、3 agents〔3 finder、0 verifier ∵ 0 candidate〕/ 183528 subagent tokens / 42 tool uses / ~4.2min、finder 皆 `readonly-reviewer` 繼承 session model `claude-opus-4-8`〔subagent 記錄 64/64、0 haiku model〕、options `__proto__:null`）→ `CODE_SELF_REVIEW_CLEAN`**：三維 **candidateCount 0 / 全 0 findings**。diff-fidelity（committed diff = 恰 2 簽名 function-declaration、無 env/params/waitUntil、全樹僅 plan doc(A)+ecpay.ts(M)、CLEANUP_PLAN.md 未 commit、numstat 2/2、blob `63b2a4b2→e981d835`、LOCK-1..11 compliant、diff --check clean）、runtime-security（byte-identical @ committed 877B `611b28c2…` 重現、redirect·303·Location·encodeURIComponent·MerchantTradeNo·URLSearchParams·URL parse·try-catch·`?? ''`·docstring 全不動、`request: Request` plain 正確〔HEAD source 無 `.cf`·無 env 存取〕、非權威邊界保留〔無驗章·D1·auth·tenant·payment-state·open-redirect〕）、evidence-integrity（797→795·REMOVED=2·ADDED=0·ratchet 795/257·cleanFiles 256→257 自洽、byte-identical 877B/`611b28c2` 一致、無 sibling-PR 數據洩漏〔2546/5643a2a9/1972/d89b28ae 未誤植於本 PR 證據或 commit message〕、coverage 誠實無 overclaim、anchor 完整）。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：① `git diff 91fc49c4..5791b165 -- functions/` 逐字 == frozen 2 handler 簽名、全樹僅 plan doc(A)+ecpay.ts(M)、numstat 2/2、blob `e981d835`；② byte-identical @ committed 877B sha `611b28c2` IDENTICAL；③ 機械值親驗（HEAD 795 無 ecpay 錯 / REMOVED 2·ADDED 0 / ratchet 795·257 / lint·build green）；④ 無 cross-PR 洩漏（commit message 引 877B/`611b28c2` 本 PR 值）→ 一輪 0 新發現。**review agents 未污染 git**（主線驗：HEAD `5791b165`、source blob `e981d835` 未動、working-tree hash `e981d835`、staged 空、`git diff 91fc49c4..HEAD -- functions/` 恰 2 行、working tree 僅 `?? CLEANUP_PLAN.md`）。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；非 merge 授權。**
- 2026-06-25 owner 驅動產 **Codex Code packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cs-codex-code-packet.md`、repo 外、**HEAD-independent anchor**〔blocking = base `91fc49c4` + `HEAD:src` blob `e981d835`〔patched〕 + `91fc49c4..HEAD -- functions/` 恰 2 行 + name-status 無 stray；source-bearing commit `5791b165` + branch HEAD `bb0c0ea5` 標 [info]〕、§3 committed diff + §3b 全 39 行 HEAD source + anti-curated artifacts + §4 11 項對照 + §5 LOCK-1..11 + §6 cascade + §7 self-review + §8 覆蓋誠實）→ 送外部 ③。
- 2026-06-25 **Codex Code Gate（③ 維度 C，code 正確性主力）：`CODEX_CODE_APPROVED`**（**0 blocking / 0 required**）— 機械重放 committed 全數**獨立重現**：`HEAD:ecpay.ts` blob `e981d835…`、base blob `63b2a4b2…`、`git diff 91fc49c4..HEAD` = plan doc added + ecpay.ts modified（唯一 source touched）、source diff 恰 frozen +2/−2 numstat `2 2` `git diff --check` clean、byte-identical committed base==HEAD **877B** sha `611b28c2253f1c9c4d7d32a6469a0c34ee142a5aadd088188907ed8824f9d7ab` stderr 0 `diff -q` identical、forced type replay base **797/78/256/334** → HEAD **795/77/257/334** sort-diff **REMOVED=2〔(13,39)+(32,38) TS7031 request〕/ ADDED=0**、ratchet OK current **795/257** baseline 1119/175、lint green、build:functions green〔Codex 首次 fail = Wrangler/AppData sandbox access、非 code；rerun green〕。**Critical Risk none、Payment Security no blocker**（runtime/redirect/303/Location/MerchantTradeNo/encodeURIComponent/try-catch/非權威 webhook 邊界全不變）。**HEAD-independent anchor → 零 false-reject。** **可進 ④ ChatGPT Faithfulness；非 merge/deploy 授權。** ⚠ Codex 重申 non-blocking：`.codex/memories/MEMORY.md` 530/500 行超門檻、與本 PR 解耦、另案處理。
- 2026-06-25 owner 驅動產 **ChatGPT Faithfulness packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2cs-chatgpt-faithfulness-packet.md`、repo 外、自足〔ChatGPT 無 repo access〕：§0 approved plan 錨點 + OD/LOCK + §1 路徑校正 + §2 approved frozen vs actual committed 逐行並排 + §3 anti-curated git artifacts〔全樹 name-status / source-commit name-status / functions stat / status〕+ §4 全 39 行 committed source + §5 byte-identical 硬證據 + §6 15 項 matrix）→ 送外部 ④。
- 2026-06-25 **ChatGPT Code Faithfulness Gate（④ 維度 B-code）：`CHATGPT_CODE_FAITHFULNESS_APPROVED`**（**15/15 Faithful、0 deviation、0 scope creep、無需 Codex 重審**）— actual committed diff 與 approved frozen diff 逐行相同（僅 L13/L32 兩 handler 簽名 inline annotation）；byte-identical 877B sha `611b28c2…` 支撐 runtime emit 不變；15 matrix 全 Faithful（檔範圍 / 2 編輯點 / inline annotation / function-declaration 非 arrow / plain Request 無 .cf / 無 env / 無 params / 無 waitUntil / 無新 import·alias·ambient / runtime 紅線全不動〔redirect·303·Location·encodeURIComponent·MerchantTradeNo〕/ docstring 未動 / 非權威邊界〔無驗章·D1·auth·tenant·payment-state〕/ byte-identical / 無 return-type·JSDoc·format drift / CLEANUP_PLAN.md 未 commit）；anti-curated：`git diff --name-status 91fc49c4..HEAD` 僅 plan doc(A)+ecpay.ts(M)、唯一 source-bearing = ecpay.ts、無「改動但未附 source」檔。**外部 4 道全過（① ChatGPT Arch + ② Codex Plan + ③ Codex Code + ④ ChatGPT Faithfulness）。** 非 merge 授權：merge-front 7 gates + owner `MERGE_ALLOWED` 仍必走。
- 2026-06-25 **merge-front 7 gates 全綠（@ source `5791b165`、CI-equivalent、[[feedback_pre_merge_gate_checklist_match_ci]]）**：`lint` ✅（eslint + compat-date + workflows 3 檔）· `typecheck:ratchet`〔`RATCHET_BASE_REF=91fc49c4`〕✅（baseline 1119/175、current **795/257**、ratchet OK）· `verify:browser-pipeline` ✅（classic prod 30 entries + module prod 1 entry byte-equal、HTML `?v=` governance **25 pages / 214 refs** 全等 committed content-hash）· `test:cov` ✅（**25 files / 737 tests passed**、Statements **90.28%** 1933/2141、Branches 92.77%、Functions 92.08%）· `test:int` ✅（**75 files / 1328 tests passed**；log 內 `VERIFY_FAILED_R2_MISSING`/`uploaded_blocker_verify_failed`/aggregate-archive crash 等為 error-path 測試刻意觸發〔各帶 ✓〕、非 failure）· `build:functions` ✅（Compiled Worker successfully）· `npm audit --omit=dev --audit-level=high` ✅（**0 vulnerabilities**）。post-gate working tree 僅 `?? CLEANUP_PLAN.md`、HEAD:src blob `e981d835`、net source 2/2。**外部 4 道 + merge-front 7 gates 全綠；待 owner `MERGE_ALLOWED` → push branch + 開 PR + squash-merge `--delete-branch`。**
- ⬜（後續 dated 收錄：owner `MERGE_ALLOWED` → push branch + 開 PR + squash-merge `--delete-branch` → 監看 main CI + Cloudflare deploy → SHIPPED memory）

## owner 鎖定表（2026-06-25，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 只改 `functions/payment-return/ecpay.ts`；納入全 2 錯，目標 0 noImplicitAny、cleanFiles +1 |
| L2 Handler type shape | `request: Request`（plain）；**無 `env`**（handler 不 destructure env、不存取 `env.*`）、**無 `params`**（OrderResultURL 中介、無動態段）、**無 `waitUntil`**（無 fire-and-forget）|
| L3 annotation 形式 | **function-declaration ＋ inline param type**（2 handler）；**禁** arrow const、named type alias、拆多行 |
| L4 No new shared type / no new import | 不新增 shared type、不新增任何 import（本檔現無 import、維持 0 import）|
| L5 request = plain Request（**禁 CfRequest**）| 僅 `await request.text()`（POST）+ `new URL(request.url)`（GET），**無 `.cf` 存取** → plain `Request` |
| L6 No env binding added（**禁加 env**）| 兩 handler 皆不需 env（無 D1 / KV / secret / binding 存取）→ **不得加 `env: Env`**（會改 destructure 結構、非最小 diff、且引入未使用 binding）|
| L7 No new security feature | 本檔無 auth / 無簽章驗證 / 無 D1 / 無 tenant scope（**非權威**，真實狀態走 webhook）；**本 PR 禁新增任何安全功能或驗證**（type-only、不改行為面）|
| L8 Runtime hot-zone lock | 不改 redirect target 構築（`vendorIntentId ? '/payment-result.html?vendor_intent_id='+encodeURIComponent(...) : '/payment-result.html'`）/ **303 status** / **Location header** / `MerchantTradeNo` 取值（POST `new URLSearchParams(await request.text()).get('MerchantTradeNo')` / GET `new URL(request.url).searchParams.get('MerchantTradeNo')`）/ POST try-catch（`/* keep empty */`）/ `?? ''` fallback / docstring |
| L9 Spike evidence | full-solution spike 必須**非 commit**，證明 **REMOVED=2 / ADDED=0** |
| L10 byte-identical evidence | byte-identical 必須是 **type-strip / canonical emit 證據**（esbuild `--loader=ts --format=esm` stdin），不接受「測試通過」替代；本檔**無 import** → stdin transform == bundle 等價 |
| L11 Coverage | 本檔**無 direct test**（無 `payment-return` test 檔、無 importer）→ **主硬保證 ＝ byte-identical**（emit 不變）；不宣稱任何 runtime 覆蓋（[[feedback_pr_coverage_claim_accuracy]]）|
| L12 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L13 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / 偏離 OD（用 `CfRequest` / arrow const / 加 `env` / 加 `params` / 加 `waitUntil` / 新增安全功能 / 動 redirect·status·header·encodeURIComponent）→ 退回 `PLAN_DRAFT` |

## ⚠ payments 鄰接聲明（review care L2，**非權威** UX redirect）

`payment-return/ecpay.ts` 為 **ECPay OrderResultURL 中介**：ECPay 付款後 server POST form-urlencoded 過來；static `/payment-result.html` 不收 POST（405），故本 Function 收 POST，把 `vendor_intent_id`（MerchantTradeNo）當 query 帶到 result 頁、用 **303 GET redirect** 讓瀏覽器跳過去。**非權威金流**：

| handler | 流程 | 紅線（typing 全程不得牽動）|
|---|---|---|
| `onRequestPost` | `await request.text()` → `new URLSearchParams(body).get('MerchantTradeNo')`（try-catch、fail 保 `''`）→ target = `vendorIntentId ? '/payment-result.html?vendor_intent_id='+encodeURIComponent(vendorIntentId) : '/payment-result.html'` → `new Response(null, { status: 303, headers: { Location: target } })` | text 解析、`MerchantTradeNo` 取值、try-catch、`encodeURIComponent`、303、Location 全不動 |
| `onRequestGet` | `new URL(request.url).searchParams.get('MerchantTradeNo')`（`?? ''`）→ 同 target 構築 → `new Response(null, { status: 303, headers: { Location: target } })` | URL parse、searchParams 取值、target 構築、303、Location 全不動 |

**權威性界定（防審查誤判）**：本檔**不驗 CheckMacValue / 不寫 D1 / 不更新 payment 狀態**；真實付款狀態更新走 **ReturnURL（webhook handler `webhooks/payments/[vendor].ts`，本 PR 未碰）**。對齊全域「前端禁決定 payment success；以 webhook + server query 為準」。redirect target 恆為**同源相對路徑** `/payment-result.html[?vendor_intent_id=…]`（hardcoded 前綴 + `encodeURIComponent` 包覆 vendorIntentId）→ **無 open-redirect 面**。

修法若非純型別、或牽動上列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L7/L8）。本刀只在 2 個 exported handler 簽名加 inline param annotation，TS erase 後 runtime byte-identical（redirect / 常數 / 字串 / 註解全不變）。

### Coding 階段硬性邊界

- **允許**：2 handler 簽名各加 inline param type（§frozen diff 唯一變更行，L13/L32）。
- **禁止**：改任何 redirect target 構築 / 303 status / Location header / `encodeURIComponent` / `MerchantTradeNo` 取值 / `URLSearchParams`·`URL` parse / try-catch / `?? ''` fallback / docstring / **新增任何安全功能或驗證** / shared util / tests / `env.d.ts` / `tsconfig`·`eslint`·`vitest` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types` / 加 `env`·`params`·`waitUntil` / **碰排除檔**（`mock.ts`、`checkout/ecpay.ts`、`admin/payments/intents.ts`、`utils/payments.ts`、其餘 payments 檔）/ 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `91fc49c4`）

### 依賴邊界（caller cascade）

`payment-return/ecpay.ts` 是 Pages file-routing entry，cascade 面（spike 實測 = 0）：

| 面 | 判定 | 證據 |
|---|---|---|
| 外部 production TS caller | **0 牽動** | functions/ **無任何 TS/JS importer**（Pages file-routing、production runtime 由 Pages 注入 context、不靜態 type-check 本 annotation）；全 repo grep「payment-return」8 命中 = 2 prior plan docs + playbook + 3 audit docs + baseline JSON + `checkout/ecpay.ts`（後者僅 **URL 字串** `${origin}/payment-return/ecpay`、L146 OrderResultURL、非 import）|
| direct test importer | **0（不存在）** | 無 `payment-return` 相關 test 檔、無 test import 本 handler（grep 全 repo 無命中 test）|
| util / env binding | **N/A** | 本檔無 import、無 `env.*` 存取、無 util forward、無 D1 → 無 util/env cascade 面 |

**precedent landscape（佐證 OD ruling）**：
- **`request: Request` 直連 handler** ＝ repo 主流 Convention A 的 request 部分（數十檔已清）→ **零新 OD**；本檔**無 env** → 採 request-only 最小子集 `{ request: Request }`（對稱 PR-2a `portfolio.ts` env-only `{ env }`、PR-2cq/2cr 的 `{ request, env }`）。
- **無 `env`**：兩 handler 皆不存取 `env.*`（無 D1 / KV / secret）→ 不加 `env: Env`（加 = 改 destructure 結構、引入未使用 binding、非最小 diff）。
- **無 `params`**：OrderResultURL 中介（無 `[id]`/`[vendor]` 動態段）→ 不觸 `Record<string, string>` params convention。
- **無 `waitUntil`**：2 handler 皆不 destructure `waitUntil`（無 fire-and-forget）→ 不觸 waitUntil OD。
- **無 D1-row `.map` callback**：本檔無 D1 查詢 → 不觸 register #111 的 D1-row callback OD。
- **無 test caller** → 無 tests-leaf cascade 面（spike 全 leaf sort-diff ADDED=0 實證）。

### 型別選型（OD ruling）

允許落地的唯一 source diff（2 編輯點）：

```ts
export async function onRequestPost({ request }: { request: Request }) {  // L13
export async function onRequestGet({ request }: { request: Request }) {   // L32
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| `request` | **`Request`（plain）** | `await request.text()`（POST）+ `new URL(request.url)`（GET）；**無 `.cf`** → 非 `CfRequest` |
| `env` | **不加** | 兩 handler 不 destructure env、不存取 `env.*`（無 D1 / KV / binding）→ 加 env = 改 destructure 結構、非最小 diff |
| `params` | **不加**（OrderResultURL 中介、無動態段）| 本檔 handler 不 destructure params |
| `waitUntil` | **不加**（無 fire-and-forget）| 本檔 handler 不 destructure waitUntil |
| annotation 形式 | **function-declaration + inline type** | 保原 runtime shape、byte-identical、編輯點最小；**禁** arrow const |
| OD 形態 | **零新 OD**（純 Convention A request-only 子集；無 env、無 params、無 waitUntil、無 D1-row callback）| payments 域最簡入口 |
| `CfRequest`（**否決**）| **禁** | 無 `.cf` 存取；引入多餘語義 |
| 加 `env: Env`（**否決**）| **禁** | handler 不用 env；加 binding 改 destructure、非最小 diff、未使用 |
| arrow const 形式（**否決**）| **禁** | 破壞 byte-identical / 編輯點 / runtime shape |
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 2 錯 |

## Spike 實證（full-solution，本地未 commit，2026-06-25，已 revert clean）

**程序**：建 branch（自 clean main `91fc49c4`）→ 量 base（base emit 877B sha `611b28c2…` stderr 0、forced solution leaf total 797、本檔 2 錯）→ 套 2 編輯點（L13/L32）→ forced `tsc -b tsconfig.solution.json --force`（sorted error set diff、含全 leaf）→ ratchet report → canonical byte-identical（esbuild stdin）→ frozen diff + `git diff --check` → `git checkout HEAD --` revert → 驗 clean（blob 回 `63b2a4b2`、staged 空、`git status` 僅 `?? CLEANUP_PLAN.md`、net source vs base 空）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| `ecpay.ts` errors 2 → 0 | ✅ sort-diff REMOVED = 恰 2 行（L13,39 / L32,38 TS7031 `request`）；patched 0 殘留（grep NONE-clean）|
| solution total errorCount 797 → 795（恰 −2）| ✅ forced `tsc -b tsconfig.solution.json --force` total **795**；sort-diff ADDED = **空（0）**|
| zero cascade（全 leaf：functions + scripts + tests + browser）| ✅ solution sort-diff **REMOVED=2 / ADDED=0**；**無 test importer** → tests-leaf cascade 結構性為 0（全 leaf ADDED=0 實證）|
| canonical ratchet `--report`（base → patched）| ✅ base errorCount **797** / errorFiles **78** / cleanFiles **256** / sourceFilesTotal **334** → patched **795** / **77** / **257** / **334**（本檔全清入 cleanFiles）|
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`** stdin，[[feedback_byte_identical_emit_verification]]）| ✅ esbuild **stdin** type-strip base vs patched **IDENTICAL**、皆 **877B**、esbuild stderr 空：<br>sha256 `611b28c2253f1c9c4d7d32a6469a0c34ee142a5aadd088188907ed8824f9d7ab` 兩端 |
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace / lone space）|
| frozen diff numstat | ✅ `2  2`（2 insertion / 2 deletion；無 whole-file CRLF churn）；base blob `63b2a4b2` → head blob `e981d835` |
| working tree revert clean | ✅ `git checkout HEAD --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、blob 回 `63b2a4b2`、staged 空、`git diff 91fc49c4..HEAD -- functions/` 空 |

**byte-identical 適用性**：`payment-return/ecpay.ts` **無任何 import statement**（檔頭僅 docstring + 2 export）→ esbuild stdin transform **完全等價於 bundle**（無依賴解析、單檔 transform）；type-only annotation PR 這正是最乾淨的證明面。⚠ 用 **stdin**（`<` / pipe），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell，[[feedback_byte_identical_emit_verification]]）；本 spike emit 877B 非空、已排除該坑。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/payment-return/ecpay.ts b/functions/payment-return/ecpay.ts
index 63b2a4b2..e981d835 100644
--- a/functions/payment-return/ecpay.ts
+++ b/functions/payment-return/ecpay.ts
@@ -10,7 +10,7 @@
  * 這隻純 UX redirect。
  */

-export async function onRequestPost({ request }) {
+export async function onRequestPost({ request }: { request: Request }) {
   let vendorIntentId = ''
   try {
     const body = await request.text()
@@ -29,7 +29,7 @@ export async function onRequestPost({ request }) {
 }

 // 沙箱有時 user 會重整或從 history 點 → 也支援 GET
-export async function onRequestGet({ request }) {
+export async function onRequestGet({ request }: { request: Request }) {
   const url = new URL(request.url)
   const vendorIntentId = url.searchParams.get('MerchantTradeNo') ?? ''
   const target = vendorIntentId
```

`git diff --stat`：1 file changed, 2 insertions(+), 2 deletions(-)；`git diff --numstat`：`2  2`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `91fc49c4` `--report`：errorCount **797** / errorFiles **78** / cleanFiles **256** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **797 → 795**（−2）、errorFiles **78 → 77**、cleanFiles **256 → 257**（spike 實測值、非預測；本檔全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 795」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 2 個 exported handler 簽名 inline param 型別標註，TS erase 後 runtime byte-identical（§Spike sha `611b28c2…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 797、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。
- **無 D1 migration**（純 type-only、不觸 schema）→ 不觸發 migration-before-merge（[[feedback_migration_before_merge_autodeploy]]）。

## 測試影響面（覆蓋誠實，L11 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike 全 leaf sort-diff ADDED=0、無 test importer）。
- **覆蓋分層（誠實）**：

| 標的 | direct test | 硬保證 |
|---|---|---|
| `onRequestPost`（ECPay POST 中介）| ⚠ **無 direct test**（無 `payment-return` test 檔）| **byte-identical 為唯一硬保證**（emit 877B sha 不變）|
| `onRequestGet`（GET 重整/history fallback）| ⚠ **無 direct test** | byte-identical（emit 不變）|

- **誠實界線**：本檔無 direct test、無 importer → 無 integration 旁證；type-only 改動 runtime 不可見（型別 erase）→ **主硬保證 ＝ byte-identical emit（sha 兩端一致 877B）**。與 PR-2cf `turnstile.ts`（同樣無 direct test、byte-identical 為唯一硬保證）同策略。**不宣稱任何 runtime test 覆蓋**。
- merge-front 仍跑全量 `test:int` / `test:cov` 確認無跨檔破壞（本檔無 importer → 預期零牽動）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`（或用 `--force`）。**PowerShell 用 `$env:RATCHET_BASE_REF='91fc49c4'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='91fc49c4'; npm run typecheck:ratchet` green（797→795 / 78→77 / 256→257）。
- forced `tsc -b tsconfig.solution.json --force`：本檔 0 殘留 + sort-diff **REMOVED=2 / ADDED=0**。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**：

```bash
git show "91fc49c4:functions/payment-return/ecpay.ts" | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/pr-base.js 2>/tmp/pr-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < "functions/payment-return/ecpay.ts" > /tmp/pr-head.js 2>/tmp/pr-head.err
wc -c /tmp/pr-base.js /tmp/pr-head.js          # 期望 877 兩端
sha256sum /tmp/pr-base.js /tmp/pr-head.js       # 期望 611b28c2253f1c9c4d… 兩端
cat /tmp/pr-base.err /tmp/pr-head.err            # 期望空（stderr 0 bytes）
diff -q /tmp/pr-base.js /tmp/pr-head.js           # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show 91fc49c4:` 讀未改 base。spike 本地實證：兩端 **877B / `611b28c2…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 2 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量；確認 inline param annotation 不觸 `no-unused-vars`/`no-undef` 等）、`npm run build:functions` green。
- 全量 `test:int` / `test:cov` 確認無跨檔破壞（本檔無 importer → 預期零牽動）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +2/−2、`git diff` 2 處為 handler 簽名）；超出 = scope creep = Gate fail。
