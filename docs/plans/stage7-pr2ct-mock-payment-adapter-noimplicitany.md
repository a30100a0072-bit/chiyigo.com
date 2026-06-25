# Stage 7 reduce PR-2ct — `payment-vendors/mock.ts` noImplicitAny（**payments 域第四棒 / util 層首棒**；3 函式 6×TS7006、OD-A local 標註 defer interface、type-only、review care **L2**）

**目標**：`functions/utils/payment-vendors/mock.ts`（mock payment adapter，**test-only / smoke-only、非真實 PSP**）的 **6 個 noImplicitAny error（6×TS7006：3 函式各 2 param）→ 0**，**純 type-only**（**3 個編輯點** ＝ 3 個函式簽名的 inline param annotation；TS erase 後 emit byte-identical）。本 PR ＝ payments 大熱區 **第四棒（util/vendors 層首棒）**（接 PR-2cq #115 `4ac4dfab` `[id].ts`、PR-2cr #116 `91fc49c4` `intents.ts` list、PR-2cs #117 `b83b9ecd` `payment-return/ecpay.ts` micro）。owner 2026-06-25：A 域全清 + payments 前三棒清完後，續清 payments light→heavy，**owner 選 `mock.ts`（最低敏感：mock/test-only/零真金流）並裁定走 OD-A（local 標註、不建 shared interface、vendor-adapter 契約 defer 到後段 ecpay-vendor + spine cluster）**。

**Scope（owner 鎖 2026-06-25；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/utils/payment-vendors/mock.ts` | 6（3 函式各 2 param，全 TS7006）| **3 個編輯點**（`parseWebhook` L25 / `hmacSha256Hex` L60 / `constantTimeEq` L72 的簽名 param annotation）|

精確錯位（forced `tsc -b tsconfig.solution.json --force`，filtered 本檔 @ base `b83b9ecd`）：

```
functions/utils/payment-vendors/mock.ts(25,22): error TS7006: Parameter 'request' implicitly has an 'any' type.
functions/utils/payment-vendors/mock.ts(25,31): error TS7006: Parameter 'env' implicitly has an 'any' type.
functions/utils/payment-vendors/mock.ts(60,30): error TS7006: Parameter 'secret' implicitly has an 'any' type.
functions/utils/payment-vendors/mock.ts(60,38): error TS7006: Parameter 'body' implicitly has an 'any' type.
functions/utils/payment-vendors/mock.ts(72,25): error TS7006: Parameter 'a' implicitly has an 'any' type.
functions/utils/payment-vendors/mock.ts(72,28): error TS7006: Parameter 'b' implicitly has an 'any' type.
```

**恰 6 個**（owner 預估一致）：3 函式 × 2 param。`parseWebhook(request, env)`（adapter 方法）= 2；`hmacSha256Hex(secret, body)`（local HMAC helper）= 2；`constantTimeEq(a, b)`（local constant-time compare helper）= 2。**無第 7 錯**：函式 body 內 `request.headers.get(...)`（→ Request）、`await request.text()`（→ string）、`env?.PAYMENT_MOCK_SECRET`（Env 含此欄、→ string|undefined）、`JSON.parse`、`crypto.subtle.*`、`new TextEncoder()`、`a.length`/`a.charCodeAt`（`unknown` 經 typeof guard narrow 後合法）皆已被既有型別涵蓋或 narrow 後合法、無新隱式 any。

> **主線定位**：A 域全清（殿後棒 PR-2cp `functions/api/auth/local/login.ts` #114 `c04d1fab`）→ payments 第一棒 PR-2cq `functions/api/auth/payments/intents/[id].ts` #115 `4ac4dfab` → 第二棒 PR-2cr `functions/api/auth/payments/intents.ts` #116 `91fc49c4`（列表）→ 第三棒 PR-2cs `functions/payment-return/ecpay.ts` #117 `b83b9ecd`（micro UX redirect）→ **第四棒本棒 `functions/utils/payment-vendors/mock.ts`（util/vendors 層首棒、mock adapter）**。payments 域 light→heavy 候選（owner 2026-06-25，scout 實證數字）：**`functions/utils/payment-vendors/mock.ts`(6，本棒) →** `functions/api/auth/payments/checkout/ecpay.ts`(6，寫入路徑) / `functions/api/admin/payments/intents.ts`(9〔TS7053+CSV PII 首見 OD、另立一棒〕) / admin-ops 小批(`functions/api/admin/payments/aggregate.ts` 5 / `functions/api/admin/payments/webhook-dlq.ts` 4 / `functions/api/admin/payments/metadata-archive.ts` 4) / `functions/utils/payments.ts`(18，spine、cascade、殿後) → 重檔殿後（`functions/utils/payment-vendors/ecpay.ts` 27 / `functions/api/webhooks/payments/[vendor].ts` 19 / `functions/api/admin/payments/intents/[id]/refund.ts`·`delete.ts`·`functions/api/payments/intents/[id]/refund-request.ts`）→ **audit 域(~? / 多檔，含 F-3 DORMANT)最後**。**結構特性**：mock.ts ＝ **util module**（export `const mockPaymentAdapter` object + 2 module-local helper function；**零 import**——檔頭僅 docstring + `const SIGNATURE_HEADER` + 3 定義）；被 `payments.ts:412 import { mockPaymentAdapter }` 收進 `ADAPTERS` registry（L416 `mock: mockPaymentAdapter`）。**有 caller，但 NET 零 cascade**（見 §Scout caller cascade：registry 的 `ADAPTERS[vendor]` index 因 `vendor:any` 已是 TS7053 → 回傳 `any` → 充當 firewall，mock 簽名標註被 `any` 吸收、不向下游 propagate）。**非真實金流**（mock vendor 僅 integration test + 上 prod 前 webhook smoke 用）→ review care **L2**。**排除**：`functions/api/auth/payments/checkout/ecpay.ts`、`functions/api/admin/payments/intents.ts`、`functions/utils/payments.ts`、`functions/utils/payment-vendors/ecpay.ts`、`functions/api/webhooks/payments/[vendor].ts`、`functions/utils/kyc-vendors/mock.ts`、其餘 payments / util / 大熱區 `audit` 域（defer 殿後）。

## OD-A 裁定（owner 2026-06-25：local 標註、不建 shared interface）

owner 在 scout 後**明選 OD-A**：mock.ts 的 6 個 param 用 **local inline annotation**，**不**引入 `PaymentVendorAdapter` interface / `WebhookParseResult` union 型別。理由：

- vendor-adapter typing 是 **mock.ts + ecpay-vendor.ts + payments.ts(registry) 三檔共享的首見 OD**（`mockPaymentAdapter`/`ecpayPaymentAdapter` 皆裸 object literal、無 interface；`payments.ts:423 ADAPTERS[vendor]` 的 TS7053 是 registry index OD）。
- OD-A（local 標註）使本棒維持**最小、最低敏感、純 mechanical**；vendor-adapter 契約決策 **defer 到後段 ecpay-vendor(27) + spine(18) cluster** 一次有意識地定。
- **代價誠實**：OD-A 下 mock.ts **不**構成 ecpay 的 typing「pattern-proof」（local 標註 ≠ shared interface）；若要 pattern-proof 價值須走 OD-B（建 interface），owner 已否決（scope 大、須預判 ecpay 需求）。

## annotation 形式裁定（沿 PR-2cp..2cs frozen form：原樣簽名 + inline param type）

3 個編輯點，唯一允許落地的 source diff（owner 鎖定表 L2 + constantTimeEq OD ruling）：

```ts
async parseWebhook(request: Request, env: Env) {                 // L25（adapter 方法）
async function hmacSha256Hex(secret: string, body: string) {     // L60（local helper）
function constantTimeEq(a: unknown, b: unknown) {                 // L72（local helper）
```

- **保原簽名結構**（method shorthand 保 method shorthand、function-declaration 保 function-declaration），只在既有 param 後加 inline `: Type`；**禁** 改 arrow const、**禁** named type alias、**禁** 拆多行、**禁** 加 return type。
- **`constantTimeEq(a, b)` ＝ `unknown`（owner 2026-06-25 ruling）**：函式內有防禦性 `if (typeof a !== 'string' || typeof b !== 'string') return false` guard；`unknown` 保留 guard 意義（guard 後 TS narrow → string，`a.length`/`a.charCodeAt` 合法）、lint-safe（不觸 `no-unnecessary-condition` dead-branch）、忠於作者防禦意圖。**否決 `string`**（會使 typeof guard 變 static always-false dead-branch、潛在 lint fire）。
- **`parseWebhook(request, env)` ＝ `request: Request`（plain）+ `env: Env`**：body 只 `request.headers.get` + `await request.text()`（**無 `.cf`** → 非 CfRequest）；`env?.PAYMENT_MOCK_SECRET`（`Env` 含 `PAYMENT_MOCK_SECRET?: string`〔env.d.ts:58〕→ 解析乾淨；`env?.` optional chaining 保留〔忠於原碼、lint exit 0 實證〕）。
- **`hmacSha256Hex(secret, body)` ＝ `secret: string` + `body: string`**：呼叫點 `secret`（`env?.PAYMENT_MOCK_SECRET` 經 `if (!secret) return` narrow 到 string）、`body`（`await request.text()` → string）；無防禦 guard、直接 string。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔、3 簽名 6 annotation、byte-identical）/ review care **L2**（payments util/vendors 域；mock adapter 含 signature-verify 安全相關邏輯〔HMAC + constant-time compare〕，但**本 PR 純 type-only、不改任何該邏輯**；mock = test-only、非真實金流）。**仍走完整 Dual Gate v3.1 四道外部審查、不降級**（金流域、就高不就低）。
- **self-review ＝ multi-agent workflow（owner 2026-06-25 明示不降單 agent；payments 域就高不就低、維持 #115/#116/#117 cadence、不開 downgrade 先例，[[feedback_self_review_form_not_downgradable_by_spike]]）**。workflow rubric **收斂 scope-fidelity / runtime-security / evidence-integrity 三維、不擴全域 7 維**（不碰任何他檔/排除檔、不碰 runtime 紅線〔HMAC 簽章驗證 / constant-time compare / payload normalize / `JSON.parse` / `env?.PAYMENT_MOCK_SECRET` 守門 / `?? null` fallback / docstring〕、不碰 `CLEANUP_PLAN.md`）。finder/verifier 用 **`readonly-reviewer` agent**（無 model pin → 繼承 session model Opus 4.8，[[feedback_selfreview_workflow_model_inheritance]]；options `__proto__:null` no-haiku 機械保證；**非機械安全邊界、持 Bash、read-only 屬 best-effort**）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner 2026-06-25：scope ＝ 單檔 `payment-vendors/mock.ts`、納入全 6 錯；base 錨 `b83b9ecd`；OD-A（local 標註、不建 interface）；param typing ＝ `parseWebhook(request: Request, env: Env)` / `hmacSha256Hex(secret: string, body: string)` / `constantTimeEq(a: unknown, b: unknown)`；annotation 形式 ＝ 原樣簽名 + inline type；self-review 形式 ＝ multi-agent workflow（不降單 agent）；**禁** `CfRequest`、**禁** shared interface / `PaymentVendorAdapter` / `WebhookParseResult` 型別、**禁** required runtime 改動、**禁** 改 HMAC/constant-time/normalize 邏輯、**禁** `EventContext`/`@cloudflare/workers-types`/新 import/新 ambient；排除檔 + 全其餘 payments/util + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `b83b9ecd`）→ 逐檔 error set（**恰 6 錯：6 TS7006**，符 owner 預估）+ caller cascade（payments.ts import → registry → **NET 零 cascade**，見 §Scout）+ env.d.ts 確認 `PAYMENT_MOCK_SECRET?: string` + 結構判定（util module、零 import、3 定義）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、blob 回 `0eb91bc9`）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow `wf_0b9bb408-ba5`、3 readonly-reviewer finders + 2 verifier 全 `claude-opus-4-8[1m]`〔0 haiku〕、收斂三維 scope-fidelity / runtime-security / evidence-integrity、`__proto__:null`；**accepted 2 / suspicious_input 0**＝同根因 tier3 路徑精確度〔排除清單 + cascade 引用漏 `functions/api/` 前綴〕→ 主線獨立裁決採納 + 修正 + re-verify 一輪 0 新發現 — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 維度 B、**0 Blocker / 0 Required Revision / 3 NB**、7 架構提問全認可、binding locks GL1..GL10、全對齊本 plan 既有 owner 鎖定表 + OD ruling、無 plan 改動 — 見 §Gate 進程紀錄 + §ChatGPT Arch binding locks）→ ✅ `CODEX_PLAN_APPROVED`（② 維度 C、**0 blocking / 0 required / 1 NB**、live repo replay 全數重現、HEAD-independent anchor 零 false-reject — 見 §Gate 進程紀錄）→ ⬜ owner `CODING_ALLOWED`（**待 owner 明示；Codex 已聲明 ② 非 coding 授權**）
  - ✅ Code 階段（owner `CODING_ALLOWED` 2026-06-25 → source commit `076fbb4c`、full replay @ committed 全綠、NB-2 雙證）→ ✅ `CODE_SELF_REVIEW_CLEAN`（維度 A workflow `wf_7356b3a6-1f3`、3 finder 全 `claude-opus-4-8[1m]`、三維 diff-fidelity/runtime-security/evidence、**0 findings**、主線獨立裁決 — 見 §Gate 進程紀錄）→ ✅ `CODEX_CODE_APPROVED`（③ 維度 C、**0 blocking / 0 required / 0 NB**、live repo 機械重放全數重現 — 見 §Gate 進程紀錄）→ ✅ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④ 維度 B-code、**16/16 Faithful、0 deviation、0 scope creep、無未附 hunk、無 Tier0/1 finding、無需 Codex 重審**；**外部 4 道全過** — 見 §Gate 進程紀錄）
  - ✅ merge-front 7 gates 全綠（lint / ratchet **789·258** / verify:browser-pipeline 25p·214ref / test:cov **737**·90.28% / test:int **1328** / build:functions / npm audit **0**）→ ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-25 Claude **scout（read-only @ `b83b9ecd`）** → 逐檔 error set（**恰 6 錯**：L25〔request/env〕、L60〔secret/body〕、L72〔a/b〕、皆 TS7006）+ caller cascade（payments.ts:412 `import { mockPaymentAdapter }` → L416 `ADAPTERS.mock`；**NET 零 cascade**：spike 實測 loc+code 粒度 REMOVED=6/ADDED=0、payments.ts count 18→18 不變，唯一非-mock delta ＝ payments.ts:423 既存 TS7053 的 message-text 更新〔詳 §Scout〕）+ env.d.ts:58 `PAYMENT_MOCK_SECRET?: string` 確認 + 結構判定（util module、**零 import**、`const SIGNATURE_HEADER` + `mockPaymentAdapter` object〔含 `parseWebhook` 方法〕+ 2 module-local helper〔`hmacSha256Hex`/`constantTimeEq`〕）。全對齊 owner 預估。
- 2026-06-25 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（solution 795→789、loc+code sort-diff REMOVED=6/ADDED=0、byte-identical 1946B sha `5ee278c4…` 兩端一致 esbuild stderr 0、ratchet 795/77/257 → 789/76/258、frozen diff numstat 3/3 blob `0eb91bc9→cd74f0a8`、`git diff --check` clean、targeted lint exit 0、revert 後 blob 回 `0eb91bc9`）。
- 2026-06-25 **multi-agent workflow self-review（維度 A，run `wf_0b9bb408-ba5`、5 agents〔3 finder + 2 verifier〕/ 343281 subagent tokens / 117 tool uses / ~14.4min；finder/verifier 皆 `readonly-reviewer` 繼承 session model `claude-opus-4-8[1m]`〔workflowProgress 5/5 model 記錄、0 haiku〕、options `__proto__:null`）→ `PLAN_SELF_REVIEW_CLEAN`**：收斂三維 rubric（scope-fidelity / runtime-security / evidence-integrity）**accepted 2 / suspicious_input 0**。runtime-security **0 findings**。兩條 accepted（皆 tier3、verifier 對抗式 ACCEPTED）＝**同一根因**：plan 把 3 個排除的 `functions/api/...` handler 檔（`auth/payments/checkout/ecpay.ts` / `admin/payments/intents.ts` / `webhooks/payments/[vendor].ts`）與 §Scout cascade 引用 `[vendor].ts:39` 寫成漏 `functions/api/` 前綴的 shorthand → 路徑無法 resolve（**文件精確度/traceability tier3，非 scope 違反、非算術錯**）。**finder 同時獨立 VERIFIED 正確且未誤報**：in-scope target 全 load-bearing 點全路徑 / 恰 3 簽名 6 TS7006〔(25,22)(25,31)(60,30)(60,38)(72,25)(72,28)〕/ OD-A 0-import faithful / `constantTimeEq=unknown` 型別正確〔且 `no-unnecessary-condition` 確不在 eslint.config.js〕/ base mock.ts 簽名符 frozen diff / env.d.ts:58 PAYMENT_MOCK_SECRET / `:39` 行錨本身正確〔real 行 = `const parsed = await adapter.parseWebhook(request, env)`〕/ ratchet base 795/77/257 / `[vendor].ts`=19·kyc `[vendor].ts`=5 count 正確 / firewall 機制真實〔forced tsc 第 39 行無錯、`adapter: any`〕。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：`git ls-files` 親驗 3 檔確在 `functions/api/`（`functions/api/auth/payments/checkout/ecpay.ts`·`functions/api/admin/payments/intents.ts`·`functions/api/webhooks/payments/[vendor].ts`）→ 採納 2 finding → 修 L24（候選+排除清單）·L106（排除清單）·L117（cascade 引用）·L24 narrative 歷史 PR 序列，全正規化為完整 functions/ repo 路徑 → **re-verify：plan 內 19 個完整 functions/ 路徑 citation 全數 resolve against `git ls-files`、load-bearing 路徑全 qualified**（target/歷史 narrative shorthand 沿 pr2cs title 慣例保留、finder 未 flag、target 於所有 load-bearing 點全路徑）→ 一輪 0 新發現。**review agents 未污染 git**（主線驗：HEAD `b83b9ecd`、source blob `0eb91bc9` 未動、staged 空、`git diff b83b9ecd..HEAD -- functions/` 空、working tree 僅 `?? CLEANUP_PLAN.md` + 本 plan doc）。**待 commit plan-only → 中文報告 6 欄 → 產 ChatGPT Arch packet → 送外部 ①。**
- 2026-06-25 **plan-only commit `18bff827`**（branch `refactor/stage7-pr2ct-mock-payment-adapter-noimplicitany`、local、未 push、plan-only **+251 / 0 source**；commit 前後核 staged set 僅 plan doc、`git diff b83b9ecd..HEAD -- functions/` 空、`HEAD:mock.ts` blob 仍 `0eb91bc9`、`git diff --cached --check` clean、CLEANUP_PLAN.md 未 staged）→ 中文報告 6 欄（gate-state `PLAN_SELF_REVIEW_CLEAN`）→ 產自足 **ChatGPT Arch packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2ct-chatgpt-arch-packet.md`、repo 外、§2 含全 78 行 base source）→ 送外部 ①。
- 2026-06-25 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Blocker / 0 Required Revision / 3 Non-blocking Note**）— 7 架構提問全認可（① OD-A 同意〔現不建 `PaymentVendorAdapter`/`WebhookParseResult`、defer ecpay+spine cluster 較安全〕② `request: Request` plain〔無 `.cf`、禁 CfRequest〕③ `env: Env` 保 `env?.`〔符 type-only 最小 diff〕④ `constantTimeEq(a: unknown, b: unknown)`〔最忠實 defensive contract；`string` 會使 guard 變 dead branch〕⑤ defer spine 契約〔`payments.ts:423` message-text 更新非本 PR 應處理、屬後續 spine PR〕⑥ 無 migration/rollback/cache-bust 遺漏〔rollback = revert 單 squash〕⑦ 不牽動 security boundary〔HMAC + constant-time 不改 runtime、byte-identical 為足夠硬證〕）。**Non-blocking**：NB-1 mock 不應被包裝成 ecpay typing pattern-proof（後續 cluster 重審 adapter interface、不沿用本 PR 當 shared contract）· NB-2 error diff 用 loc+code 粒度〔本 plan §Spike 已採、完整 message 文字 diff 會顯 REMOVED=7/ADDED=1 表象〕· NB-3 `constantTimeEq unknown` 是 lock 非風格〔後續禁改 string〕——**3 NB 皆已在本 plan 既有內容反映、無新增動作**。**Binding locks GL1..GL10**（② Codex Plan 與 Code 階段須保留；見 §ChatGPT Arch binding locks）：全與本 plan 既有 owner 鎖定表 L1..L14 + OD ruling + 排除清單 + §Scout payments.ts:423 nuance **一致、無 plan 改動需求**。**可送 ② Codex Plan Gate；非 coding 授權。**
- 2026-06-25 owner 驅動產 **Codex Plan packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2ct-codex-plan-packet.md`、repo 外、**HEAD-independent anchor**〔blocking 純 source-base：base `b83b9ecd` + `HEAD:mock.ts` blob `0eb91bc9` == base + `b83b9ecd..HEAD -- functions/` 空；branch HEAD `eab59fbe` + 2 plan-only commit 標 [info]〕、§1 路徑精確度自驗 + §3 機械 replay + §4 11 項對照 + §5 GL1-GL10 + §6 cascade/firewall + §7 ① verdict + 覆蓋誠實）→ 送外部 ②。
- 2026-06-25 **Codex Plan Gate（② 維度 C）：`CODEX_PLAN_APPROVED`**（**0 blocking / 0 required / 1 NB**）— live repo read-only replay 全數**獨立重現**：anchor 全符（`HEAD:mock.ts` == base `0eb91bc9` / `b83b9ecd..HEAD -- functions/` 空 / tracked diff 僅 plan doc / working tree 僅 `?? CLEANUP_PLAN.md`）、forced tsc base **795** + mock.ts 恰 6 TS7006〔(25,22)(25,31)(60,30)(60,38)(72,25)(72,28)〕、virtual patch **795→789** + mock.ts **6→0** + payments.ts **18→18** + loc+code **REMOVED=6/ADDED=0** + `payments.ts(423,10) TS7053` 兩端皆在（符 cascade/firewall 分析）、byte-identical base==virtual-patched **1946B** sha `5ee278c49250b32caf45e88cc5baedc5e69fd21a147fd16ccd73cd1fbccbc746`。**HEAD-independent anchor → 零 false-reject。** **NB（non-blocking）**：packet §1 grep-style 自驗指令也命中 plan prose 裡的**省略號占位字串**（`functions/` 開頭、省略號、`.ts` 結尾的類別描述詞、非真路徑）→ 報 `MISS`；屬 packet/self-check hygiene、非 plan 正確性問題（load-bearing repo 路徑——target / 排除 / webhook·payment——全 resolve）→ **已處置**：本 commit 把 line 68 占位字串 reword 為非路徑形式（`functions/ 路徑`），**純 cosmetic、語意不變、不觸任何 load-bearing 內容〔scope/OD/frozen diff/evidence/locks 全不動〕→ 不觸發 plan re-review**。**Plan Gate 雙道（①+②）全過 = plan 批准；Codex 明示 ② 非 `CODING_ALLOWED`、code 階段須在 committed source edit 後重跑 evidence；待 owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-25 owner **`CODING_ALLOWED` ✅ → Code 階段（source commit `076fbb4c`）**：落地 3 函式簽名（原樣簽名 + inline param type、frozen form）。`git diff b83b9ecd..076fbb4c -- functions/` = mock.ts **+3/−3**、blob `0eb91bc9→cd74f0a8`、numstat 3/3；全樹 name-status 僅 plan doc(A) + mock.ts(M)、無 stray、CLEANUP_PLAN.md 未 commit。**full replay @ committed（不沿用 spike、GL8）全綠**：① byte-identical @ committed blobs（base `b83b9ecd:` 與 `HEAD:` 皆 git show、canonical esbuild `--loader=ts --format=esm` stdin）兩端 **1946B** sha `5ee278c49250b32caf45e88cc5baedc5e69fd21a147fd16ccd73cd1fbccbc746`、stderr 0、`diff -q` IDENTICAL（NB-2 #1）· ② forced sort-diff（patched committed **789** / base temp-swap 重量 **795**、swap 後 restore blob `cd74f0a8` 驗 clean）loc+code **REMOVED=6 全為目標 6×TS7006〔(25,22)(25,31)(60,30)(60,38)(72,25)(72,28)〕/ ADDED=0** · ③ ratchet enforce〔`RATCHET_BASE_REF=b83b9ecd`〕**OK**（baseline 1119/175、current **789/258**、errorFiles 77→76）· ④ `git diff b83b9ecd..HEAD --check` clean · ⑤ **lint green**（eslint functions tests + compat-date + workflows 3 檔）· ⑥ **build:functions「Compiled Worker successfully」**。**NB-2 雙證齊**（byte-identical @ committed + source diff 逐行 == frozen 3 簽名）。
- 2026-06-25 **Code self-review = multi-agent workflow（維度 A、converged 三維 diff-fidelity / runtime-security / evidence；run `wf_7356b3a6-1f3`、3 agents〔3 finder、0 verifier ∵ 0 candidate〕/ 199326 subagent tokens / 77 tool uses / ~10min；finder 皆 `readonly-reviewer` 繼承 session model `claude-opus-4-8[1m]`〔workflowProgress 3/3 model 記錄、0 haiku、皆收斂 StructuredOutput、20/28/29 tool uses 實質驗證〕、options `__proto__:null`）→ `CODE_SELF_REVIEW_CLEAN`**：三維 **全 0 findings**（diff-fidelity / runtime-security / evidence-integrity）。**主線獨立對抗式裁決（v3.1 §5、非採 raw）**：① `git diff b83b9ecd..HEAD -- functions/` 逐字 == frozen 3 簽名行（parseWebhook/hmacSha256Hex/constantTimeEq）、全樹僅 plan doc(A)+mock.ts(M)、numstat 3/3、blob `cd74f0a8`；② byte-identical @ committed 1946B sha `5ee278c4…` IDENTICAL；③ 機械值親驗（HEAD forced tsc 789 無 mock 錯 / REMOVED 6·ADDED 0 / ratchet 789·258 / lint·build green）；④ 無 cross-PR 洩漏（commit message 引本 PR 值 1946B/`5ee278c4`/3 edits/6 errors，無 pr2cs 877B/`611b28c2`/2-edit/payment-return 誤植）→ 一輪 0 新發現。**review agents 未污染 git**（主線驗：HEAD `076fbb4c`、source blob `cd74f0a8` 未動、worktree hash `cd74f0a8`、staged 空、working tree 僅 `?? CLEANUP_PLAN.md`）。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；非 merge 授權。**
- 2026-06-25 owner 驅動產 **Codex Code packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2ct-codex-code-packet.md`、repo 外、**HEAD-independent anchor**〔blocking = base `b83b9ecd` + `HEAD:mock.ts` blob `cd74f0a8`〔patched〕 + `b83b9ecd..HEAD -- functions/` 恰 3 行 + name-status 無 stray；source commit `076fbb4c` + branch HEAD `c951af98` 標 [info]〕、§3 committed diff + §3b 全 78 行 HEAD source + anti-curated artifacts + §4 11 項機械 replay + §5 GL1-GL10 + §6 cascade + §7 self-review + §8 覆蓋誠實）→ 送外部 ③。
- 2026-06-25 **Codex Code Gate（③ 維度 C、code 正確性主力）：`CODEX_CODE_APPROVED`**（**0 blocking / 0 required / 0 NB**）— 機械重放 committed 全數**獨立重現**：`HEAD:mock.ts` blob `cd74f0a85c0071dc1f870e74d7f63d8a46dce25f`、base blob `0eb91bc9…`、`git diff b83b9ecd..HEAD --numstat -- functions/` = `3 3 mock.ts`、全樹 name-status 僅 plan doc + mock.ts(M)、working tree 僅 `?? CLEANUP_PLAN.md`、byte-identical base==head **1946B** sha `5ee278c49250b32caf45e88cc5baedc5e69fd21a147fd16ccd73cd1fbccbc746`、forced tsc total **789** / mock.ts **0** / payments.ts **18** / `payments.ts(423,10) TS7053` 仍 **1**（GL9 確認）、loc+code **REMOVED=6/ADDED=0**、ratchet current **789/258** OK、lint pass、build:functions「Worker compiled successfully」。**3 簽名逐一確認**（L25 `Request`/`Env`、L60 `string`/`string`、L72 `constantTimeEq` 保 `unknown` defensive）。**HEAD-independent anchor → 零 false-reject。** **可進 ④ ChatGPT Faithfulness；非 merge/deploy 授權**（④ + merge-front test:int/test:cov/audit 仍須走）。
- 2026-06-25 owner 驅動產 **ChatGPT Faithfulness packet**（`~/Desktop/chiyigo-packets/chiyigo-pr2ct-chatgpt-faithfulness-packet.md`、repo 外、自足〔ChatGPT 無 repo access〕：§0 approved plan 錨點 + OD/GL locks + §2 approved frozen vs actual committed 逐行並排 + §3 anti-curated git artifacts〔全樹 name-status / source-commit name-status / functions stat / status〕+ §4 全 78 行 committed source + §5 byte-identical 硬證據 + §6 16 項 matrix）→ 送外部 ④。
- 2026-06-25 **ChatGPT Code Faithfulness Gate（④ 維度 B-code）：`CHATGPT_CODE_FAITHFULNESS_APPROVED`**（**16/16 Faithful、0 deviation、0 scope creep、0 有改動但未附 hunk、0 可信 Tier0/1 finding、無需 invalidate ③ / 無需 Codex 重審**）— actual committed diff 與 approved frozen diff 逐行相同（3 簽名 inline annotation）；byte-identical 1946B sha `5ee278c4…` 支撐 runtime emit 不變；16 matrix 全 Faithful（檔範圍單 mock.ts / 3 編輯點 / inline annotation 非 arrow / Request plain 無 .cf / env: Env 保 env?. / hmac string·string / constantTimeEq unknown 保 guard / 無 shared interface / 0 import / 無 return-type·JSDoc·format drift / HMAC·constant-time·normalize·守門·JSON parse 全不變 / 無新安全功能 / mock 非真實金流 / byte-identical / CLEANUP_PLAN.md 未 commit / payments.ts:423 既存同碼錯誤未碰 payments.ts）；anti-curated：name-status 唯一 source-bearing = mock.ts、無「改動但未附 hunk」檔。**外部 4 道全過（① ChatGPT Arch + ② Codex Plan + ③ Codex Code + ④ ChatGPT Faithfulness）。** 非 merge 授權：merge-front 7 gates + owner `MERGE_ALLOWED` 仍必走。
- 2026-06-25 **merge-front 7 gates 全綠（@ source `076fbb4c`、CI-equivalent、[[feedback_pre_merge_gate_checklist_match_ci]]）**：`lint` ✅（eslint + compat-date + workflows 3 檔）· `typecheck:ratchet`〔`RATCHET_BASE_REF=b83b9ecd`〕✅（baseline 1119/175、current **789/258**、ratchet OK）· `verify:browser-pipeline` ✅（classic+module prod emit byte-equal、HTML `?v=` governance **25 pages / 214 refs** 全等 committed content-hash、canary OK）· `test:cov` ✅（**25 files / 737 tests passed**、coverage **90.28%** Stmts / 92.77% Branches / 92.08% Functions；log 內 audit-archive `callback-broke` 等為 error-path 測試刻意觸發、非 failure）· `test:int` ✅（**75 files / 1328 tests passed**、828s）· `build:functions` ✅（Compiled Worker successfully）· `npm audit --omit=dev --audit-level=high` ✅（**0 vulnerabilities**）。0 fail markers；post-gate source blob `cd74f0a8` 未動、working tree 僅 `?? CLEANUP_PLAN.md`（+ 本 plan doc gate-trail）。**外部 4 道 + merge-front 7 gates 全綠；待 owner `MERGE_ALLOWED` → push branch + 開 PR + squash-merge `--delete-branch`。**
- ⬜（後續 dated 收錄：owner `MERGE_ALLOWED` → push branch + 開 PR + squash-merge `--delete-branch` → 監看 main CI + Cloudflare deploy → SHIPPED memory）

## owner 鎖定表（2026-06-25，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 只改 `functions/utils/payment-vendors/mock.ts`；納入全 6 錯，目標 0 noImplicitAny、cleanFiles +1 |
| L2 Param typing | `parseWebhook` → `request: Request`(plain) + `env: Env`；`hmacSha256Hex` → `secret: string` + `body: string`；`constantTimeEq` → `a: unknown` + `b: unknown` |
| L3 annotation 形式 | **原樣簽名 + inline param type**（method shorthand 保 shorthand、function-declaration 保 declaration）；**禁** arrow const、named type alias、拆多行、加 return type |
| L4 OD-A：No shared interface / no new import | **不**建 `PaymentVendorAdapter` interface / `WebhookParseResult` union / 任何 shared type；不新增任何 import（本檔現 0 import、維持 0）|
| L5 request = plain Request（**禁 CfRequest**）| `parseWebhook` 僅 `request.headers.get` + `await request.text()`，**無 `.cf`** → plain `Request` |
| L6 env = Env（**禁加/改 binding 結構**）| `env: Env`；`env?.PAYMENT_MOCK_SECRET`（Env 含此欄）；保留 `env?.` optional chaining（忠於原碼、不改守門邏輯）|
| L7 constantTimeEq = unknown（**禁 string**）| 保防禦 guard 意義 + lint-safe；guard 後 narrow → string |
| L8 Runtime hot-zone lock（安全相關、純 type-only 不得牽動）| 不改 HMAC 簽章驗證（`crypto.subtle.importKey/sign`、hex 編碼）/ constant-time compare 演算法（`diff |= charCodeAt ^ charCodeAt`）/ `env?.PAYMENT_MOCK_SECRET` 缺 secret → fail 守門 / payload normalize（`String()`/`Number()`/`?? null`）/ `JSON.parse` try-catch / docstring |
| L9 No new security feature | mock 現有安全邏輯（HMAC verify / constant-time）**保持原樣**；**本 PR 禁新增/強化任何安全功能或驗證**（type-only、不改行為面）|
| L10 Spike evidence | full-solution spike 必須**非 commit**，證明 loc+code 粒度 **REMOVED=6 / ADDED=0** |
| L11 byte-identical evidence | byte-identical 必須是 **type-strip / canonical emit 證據**（esbuild `--loader=ts --format=esm` stdin），不接受「測試通過」替代；本檔**無 import** → stdin transform == bundle 等價 |
| L12 Coverage | mock adapter 經 integration test（`tests/integration/payments.test.ts` HTTP 路徑、`PAYMENT_MOCK_SECRET` + HMAC）間接覆蓋；**無 direct typed unit 呼叫 `mockPaymentAdapter.parseWebhook`**（ecpay 才有 direct test 呼叫）→ 主硬保證 ＝ **byte-identical**（emit 不變）+ merge-front 全量 test:int 旁證；不宣稱本 PR 新增任何 runtime 覆蓋（[[feedback_pr_coverage_claim_accuracy]]）|
| L13 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L14 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / 偏離 OD（用 `CfRequest` / `string` for constantTimeEq / arrow const / 建 interface / 新 import / 改 HMAC·constant-time·normalize·守門 / 新增安全功能）→ 退回 `PLAN_DRAFT` |

## ChatGPT Arch binding locks（GL1..GL10，2026-06-25 ① `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 認可；②③④ 須保留；faithful 收錄）

| Lock | 內容 | 對應本 plan |
|---|---|---|
| GL1 | 只允許修改 `functions/utils/payment-vendors/mock.ts` | owner L1 / 排除清單 |
| GL2 | 唯一允許 source diff = §frozen diff 三處 annotation | owner L3 / §frozen diff |
| GL3 | 不新增 import / type alias / interface、不改 object shorthand·function declaration 形式 | owner L3/L4 |
| GL4 | 禁止建立 `PaymentVendorAdapter` / `WebhookParseResult` | owner L4 / OD-A |
| GL5 | 禁碰 `functions/utils/payment-vendors/ecpay.ts`·`functions/utils/payments.ts`·`functions/api/webhooks/payments/[vendor].ts`·admin payments·checkout·`CLEANUP_PLAN.md` | owner 排除清單 / Coding 邊界 |
| GL6 | `parseWebhook(request: Request, env: Env)`；禁 `CfRequest`/`EventContext`/workers-types import | owner L2/L5 |
| GL7 | `constantTimeEq(a: unknown, b: unknown)`；禁改 `string` | owner L7 / NB-3 |
| GL8 | 保 byte-identical runtime；禁改 HMAC·signature header·payload normalize·`env?.PAYMENT_MOCK_SECRET`·JSON parse·constant-time loop | owner L8/L9 |
| GL9 | ②③④ 驗證須承認 `payments.ts:423` message-text update 為**既存同碼同位置**錯誤、非新 cascade（NB-2：用 loc+code 粒度）| §Scout nuance / §Spike |
| GL10 | merge 前仍需完整 4 gate；本裁示非 coding/merge 授權 | owner L13 / checklist |

> **3 NB 處置**：NB-1（mock ≠ ecpay pattern-proof）已在 §OD-A 裁定「代價誠實」段明載；NB-2（loc+code 粒度）本 plan §Spike 已採；NB-3（`unknown` 是 lock）= GL7 + owner L7。**無新增動作、無 plan 改動。**

## ⚠ payments 鄰接聲明（review care L2，**mock / test-only / 非真實金流**）

`payment-vendors/mock.ts` 為 **mock payment adapter**：docstring 自證「給 integration test + 上 prod 前的 webhook 端點 smoke test 用。真實 PSP（Stripe / TapPay / 綠界）會替換成自己的簽章 + payload schema」。**非真實金流權威**：

| 函式 | 角色 | 紅線（typing 全程不得牽動）|
|---|---|---|
| `parseWebhook(request, env)` | 收 mock webhook → 驗 HMAC 簽章 → normalize payload | `env?.PAYMENT_MOCK_SECRET` 缺→fail 守門 / `request.headers.get('X-Payment-Signature')` / `await request.text()` / `hmacSha256Hex` 比對 / `constantTimeEq` / `JSON.parse` try-catch / 必填欄位檢查 / `String()`·`Number()`·`?? null` normalize 全不動 |
| `hmacSha256Hex(secret, body)` | HMAC-SHA256 hex（簽章計算）| `crypto.subtle.importKey`（HMAC/SHA-256）/ `crypto.subtle.sign` / hex 編碼 全不動 |
| `constantTimeEq(a, b)` | 常數時間字串比對（防 timing attack）| `typeof` guard / length 檢查 / `charCodeAt ^` XOR 累加 / `diff === 0` 全不動 |

**權威性界定（防審查誤判）**：mock adapter **僅 mock vendor 路徑使用**（`ADAPTERS.mock`），真實付款走 ecpay（`ADAPTERS.ecpay`，本 PR 未碰）。但 mock 仍實作**安全相關邏輯**（HMAC 簽章驗證 + constant-time compare 防 timing attack）→ review care **L2**、**self-review 不降級**。本 PR **純 type-only**：3 簽名加 inline param annotation，TS erase 後 runtime byte-identical（簽章驗證 / 常數時間比對 / normalize / 守門全不變、§Spike sha `5ee278c4…` 兩端一致實證）。

修法若非純型別、或牽動上列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L8/L9）。

### Coding 階段硬性邊界

- **允許**：3 函式簽名各加 inline param type（§frozen diff 唯一變更行，L25/L60/L72）。
- **禁止**：改任何 HMAC 簽章驗證 / constant-time compare 演算法 / `env?.PAYMENT_MOCK_SECRET` 守門 / payload normalize（`String`/`Number`/`?? null`）/ `JSON.parse` try-catch / 必填欄位檢查 / docstring / **新增任何安全功能或驗證** / **建 shared interface / `PaymentVendorAdapter` / `WebhookParseResult` 型別** / tests / `env.d.ts` / `tsconfig`·`eslint`·`vitest` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types` / `string` for constantTimeEq / **碰排除檔**（`functions/api/auth/payments/checkout/ecpay.ts`、`functions/api/admin/payments/intents.ts`、`functions/utils/payments.ts`、`functions/utils/payment-vendors/ecpay.ts`、`functions/api/webhooks/payments/[vendor].ts`、`functions/utils/kyc-vendors/mock.ts`、其餘 payments 檔）/ 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `b83b9ecd`）

### 依賴邊界（caller cascade）— **本棒與 #115..#117 最大差異：有 caller，但 NET 零 cascade**

`mock.ts` 是 util module（**非** Pages handler），被 production 程式碼 import：

| 面 | 判定 | 證據 |
|---|---|---|
| production TS importer | **1（payments.ts），但 NET 零 cascade** | `functions/utils/payments.ts:412 import { mockPaymentAdapter }` → L416 `ADAPTERS = { mock: mockPaymentAdapter, ecpay: ecpayPaymentAdapter }`；標註 mock param 後 `ADAPTERS.mock.parseWebhook` 推斷型別由 `(request: any, env: any)` → `(request: Request, env: Env)`。**此型別變更僅出現在 `payments.ts:423` 既存 TS7053 的 message 顯示文字**（`resolvePaymentAdapter(vendor) { return ADAPTERS[vendor] ?? null }` 中 `vendor: any` index 一個無 index-signature 的型別 → TS7053；錯誤本身 = 同位置〔423,10〕、同碼〔TS7053〕、同 count〔payments.ts 18→18 不變〕，**只有 message 內渲染的型別字串更新**）。spike 實證 loc+code 粒度 **REMOVED=6 / ADDED=0**（payments.ts:423 TS7053 兩端皆 1）。|
| 下游 propagate | **0（被 `any` firewall 吸收）** | `resolvePaymentAdapter` 回傳 `ADAPTERS[vendor] ?? null`；因 `ADAPTERS[vendor]` 是 `any`（TS7053），回傳型別 = `any` → `functions/api/webhooks/payments/[vendor].ts:39 adapter.parseWebhook(request, env)` 中 `adapter: any` → **不對 mock 新簽名做型別檢查** → 零向下游 cascade |
| direct typed test importer | **0** | mock 經 **HTTP integration 路徑**驗（`tests/integration/payments.test.ts` 用 `env.PAYMENT_MOCK_SECRET` + HMAC 打 webhook 端點 → 端點內部呼叫 `adapter.parseWebhook`，`adapter: any`）；**無**直接 `import { mockPaymentAdapter }` + 呼叫其簽名的 typed test（`ecpayPaymentAdapter.parseWebhook` 才有 direct test 呼叫，如 `tests/payments-ecpay-failopen.test.ts`）→ tests-leaf 零 cascade（spike 全 leaf ADDED=0 實證）|
| env binding | `Env` 含 `PAYMENT_MOCK_SECRET?: string` | env.d.ts:58 → `env: Env` 標註乾淨、`env?.PAYMENT_MOCK_SECRET` → `string\|undefined` |

> **關鍵 nuance（gate reviewer 必讀，防 REMOVED=7/ADDED=1 誤判）**：若用**完整 error-line 字串**（含 message）做 sort-diff，會見 REMOVED=7/ADDED=1——多出的一對是 `payments.ts:423` TS7053 的**同一個錯誤**在 base/patched 兩端 message 文字不同（`parseWebhook(request: any...)` ↔ `(request: Request, env: Env...)`）。這**不是**新錯/移除錯/行為變更/count 變更，是 mock 簽名被標註後其推斷型別在「一個無關的 pre-existing 錯誤」的顯示文字裡更新。用 **(file,line,col,code) 粒度**（剝 message）sort-diff = **REMOVED=6 / ADDED=0**（乾淨）。ratchet 按 file→count 計（不比 message 文字）→ payments.ts 恆 18、零 ratchet 影響。

**precedent landscape（佐證 OD ruling）**：
- **TS7006 param 直接標註** ＝ repo 主流 Convention（數十檔已清）→ **零新 OD**（OD-A 下）。
- **OD-A defer interface**：vendor-adapter 契約（mock + ecpay + spine registry 共享）留待後段 cluster；本棒只 local 標 mock 自身 6 param，registry TS7053（payments.ts:423）屬 spine PR、不在本棒。
- **無 handler context**：mock 非 Pages handler（無 `onRequest*`、無 `{request, env, params}` destructure context）→ 全 TS7006（param）、無 TS7031（binding element）；與 #115..#117 的 handler-binding 形態不同，但標註原則一致（plain Request / Env / 無 CfRequest）。

### 型別選型（OD ruling）

| 決策 | 裁示 | 理由 |
|---|---|---|
| `parseWebhook` `request` | **`Request`（plain）** | `request.headers.get` + `await request.text()`；**無 `.cf`** → 非 CfRequest |
| `parseWebhook` `env` | **`Env`** | `env?.PAYMENT_MOCK_SECRET`；Env 含 `PAYMENT_MOCK_SECRET?: string`（env.d.ts:58）|
| `hmacSha256Hex` `secret`/`body` | **`string`/`string`** | 呼叫點皆 string（secret narrow 後 / body = text()）；無防禦 guard |
| `constantTimeEq` `a`/`b` | **`unknown`/`unknown`**（owner ruling）| 內有 `typeof` 防禦 guard；`unknown` 保 guard 意義 + lint-safe；guard 後 narrow → string |
| shared interface | **不建**（OD-A）| vendor-adapter 契約 defer 後段 cluster |
| 新 import | **不加**（維持 0 import）| 純 local 標註 |
| `CfRequest`（**否決**）| **禁** | 無 `.cf` 存取 |
| `string` for constantTimeEq（**否決**）| **禁** | guard 變 dead-branch、潛在 lint fire |
| arrow const / 拆多行 / return type / JSDoc（**否決**）| **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 6 錯 |

## Spike 實證（full-solution，本地未 commit，2026-06-25，已 revert clean）

**程序**：建 branch（自 clean main `b83b9ecd`）→ 量 base（base emit 1946B sha `5ee278c4…` stderr 0、forced solution leaf total 795、本檔 6 錯）→ 套 3 編輯點（L25/L60/L72）→ forced `tsc -b tsconfig.solution.json --force`（sorted error set diff、含全 leaf）→ ratchet enforce → canonical byte-identical（esbuild stdin）→ frozen diff + `git diff --check` + targeted lint → `git checkout HEAD --` revert → 驗 clean（blob 回 `0eb91bc9`、staged 空、`git status` 僅 `?? CLEANUP_PLAN.md`、net source vs base 空）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| `mock.ts` errors 6 → 0 | ✅ loc+code sort-diff REMOVED = 恰 6 行（L25×2 / L60×2 / L72×2，全 TS7006）；patched 0 殘留 |
| solution total errorCount 795 → 789（恰 −6）| ✅ forced `tsc -b tsconfig.solution.json --force` total **789**；loc+code sort-diff ADDED = **0** |
| zero NET cascade（全 leaf：functions + scripts + tests + browser）| ✅ loc+code sort-diff **REMOVED=6 / ADDED=0**；payments.ts count **18→18 不變**（唯一非-mock delta = payments.ts:423 既存 TS7053 message-text 更新、同位置同碼同 count、被 `any`-index firewall 吸收）；**無 test importer typed cascade** |
| canonical ratchet enforce（`RATCHET_BASE_REF=b83b9ecd`）| ✅ baseline 1119/175、current **789 / cleanFiles 258**（base 795/257 → −6 errorCount / +1 cleanFile）、ratchet **OK**；errorFiles 77→76 |
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`** stdin，[[feedback_byte_identical_emit_verification]]）| ✅ esbuild **stdin** type-strip base vs patched **IDENTICAL**、皆 **1946B**、esbuild stderr 空：<br>sha256 `5ee278c49250b32caf45e88cc5baedc5e69fd21a147fd16ccd73cd1fbccbc746` 兩端 |
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace / lone space）|
| frozen diff numstat | ✅ `3  3`（3 insertion / 3 deletion；無 whole-file CRLF churn）；base blob `0eb91bc9` → head blob `cd74f0a8` |
| targeted lint（patched mock.ts）| ✅ `npx eslint functions/utils/payment-vendors/mock.ts` exit 0（`unknown` narrow / `env?.` optional chaining 皆不觸 lint）|
| working tree revert clean | ✅ `git checkout HEAD --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、blob 回 `0eb91bc9`、staged 空、`git diff b83b9ecd..HEAD -- functions/` 空 |

**byte-identical 適用性**：`mock.ts` **無任何 import statement**（檔頭僅 docstring + `const SIGNATURE_HEADER` + 3 定義）→ esbuild stdin transform **完全等價於 bundle**（無依賴解析、單檔 transform）；type-only annotation PR 這正是最乾淨的證明面。⚠ 用 **stdin**（`<` / pipe），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell，[[feedback_byte_identical_emit_verification]]）；本 spike emit 1946B 非空、已排除該坑。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取，code 階段重生）。

```diff
diff --git a/functions/utils/payment-vendors/mock.ts b/functions/utils/payment-vendors/mock.ts
index 0eb91bc9..cd74f0a8 100644
--- a/functions/utils/payment-vendors/mock.ts
+++ b/functions/utils/payment-vendors/mock.ts
@@ -22,7 +22,7 @@
 const SIGNATURE_HEADER = 'X-Payment-Signature'

 export const mockPaymentAdapter = {
-  async parseWebhook(request, env) {
+  async parseWebhook(request: Request, env: Env) {
     const secret = env?.PAYMENT_MOCK_SECRET
     if (!secret) return { ok: false, error: 'PAYMENT_MOCK_SECRET not configured' }

@@ -57,7 +57,7 @@ export const mockPaymentAdapter = {
   },
 }

-async function hmacSha256Hex(secret, body) {
+async function hmacSha256Hex(secret: string, body: string) {
   const key = await crypto.subtle.importKey(
     'raw',
     new TextEncoder().encode(secret),
@@ -69,7 +69,7 @@ async function hmacSha256Hex(secret, body) {
   return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('')
 }

-function constantTimeEq(a, b) {
+function constantTimeEq(a: unknown, b: unknown) {
   if (typeof a !== 'string' || typeof b !== 'string') return false
   if (a.length !== b.length) return false
   let diff = 0
```

`git diff --stat`：1 file changed, 3 insertions(+), 3 deletions(-)；`git diff --numstat`：`3  3`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `b83b9ecd` base：errorCount **795** / errorFiles **77** / cleanFiles **257**。
- 本 PR 後 current ratchet state：errorCount **795 → 789**（−6）、errorFiles **77 → 76**、cleanFiles **257 → 258**（spike 實測值、非預測；本檔全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 789」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 3 個函式簽名 inline param 型別標註，TS erase 後 runtime byte-identical（§Spike sha `5ee278c4…` 兩端一致實證；HMAC 簽章驗證 / constant-time compare / payload normalize / 守門全不變）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 795、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。
- **無 D1 migration**（純 type-only、不觸 schema）→ 不觸發 migration-before-merge（[[feedback_migration_before_merge_autodeploy]]）。

## 測試影響面（覆蓋誠實，L12 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike 全 leaf sort-diff ADDED=0、無 typed test importer）。
- **覆蓋分層（誠實）**：

| 標的 | direct test | 硬保證 |
|---|---|---|
| `parseWebhook`（mock webhook 驗章 + normalize）| ⚠ **無 direct typed 呼叫**（經 HTTP integration 路徑 `tests/integration/payments.test.ts`、`adapter: any`）| **byte-identical 為主硬保證**（emit 1946B sha 不變）+ merge-front 全量 test:int 旁證 |
| `hmacSha256Hex` / `constantTimeEq`（module-local helper）| ⚠ **無 direct test**（module-local、未 export）| byte-identical（emit 不變）|

- **誠實界線**：mock adapter 經 integration HTTP 路徑間接覆蓋（webhook 端點 → `adapter.parseWebhook`、但 `adapter: any` 故不檢查簽名型別）；type-only 改動 runtime 不可見（型別 erase）→ **主硬保證 ＝ byte-identical emit（sha 兩端一致 1946B）**。**不宣稱本 PR 新增任何 runtime test 覆蓋**。
- merge-front 仍跑全量 `test:int` / `test:cov` 確認無跨檔破壞（NET 零 cascade → 預期零牽動）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前用 `--force`。**PowerShell 用 `$env:RATCHET_BASE_REF='b83b9ecd'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='b83b9ecd'; npm run typecheck:ratchet` green（795→789 / 77→76 / 257→258）。
- forced `tsc -b tsconfig.solution.json --force`：本檔 0 殘留 + loc+code sort-diff **REMOVED=6 / ADDED=0**。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**：

```bash
git show "b83b9ecd:functions/utils/payment-vendors/mock.ts" | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/pr-base.js 2>/tmp/pr-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < "functions/utils/payment-vendors/mock.ts" > /tmp/pr-head.js 2>/tmp/pr-head.err
wc -c /tmp/pr-base.js /tmp/pr-head.js          # 期望 1946 兩端
sha256sum /tmp/pr-base.js /tmp/pr-head.js       # 期望 5ee278c49250b32c… 兩端
cat /tmp/pr-base.err /tmp/pr-head.err            # 期望空（stderr 0 bytes）
diff -q /tmp/pr-base.js /tmp/pr-head.js           # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show b83b9ecd:` 讀未改 base。spike 本地實證：兩端 **1946B / `5ee278c4…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 3 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量；確認 inline param annotation 不觸 `no-unused-vars`/`no-unnecessary-condition` 等）、`npm run build:functions` green。
- 全量 `test:int` / `test:cov` 確認無跨檔破壞（NET 零 cascade → 預期零牽動；mock 經 integration 路徑、`adapter: any` 不檢型別）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +3/−3、`git diff` 3 處為函式簽名）；超出 = scope creep = Gate fail。
