# Stage 7 reduce PR-2cu — `auth/payments/checkout/ecpay.ts` noImplicitAny（**payments 域第五棒 / Path A 2-檔**；**寫入路徑 Tier-0 金流建單**、type-only、review care **L3**）

**目標**：`functions/api/auth/payments/checkout/ecpay.ts`（ECPay AIO 結帳建單 endpoint）的 **6 個 noImplicitAny error → 0**，**純 type-only**。但因 handler typing 掀出 `Env` 缺口，scope 採 **Path A = 2 檔**（PR-2m `email.ts` 先例 / owner 2026-06-26 裁定）：

| 檔 | 現狀 err | 編輯點 | 變更性質 |
|---|---|---|---|
| `functions/api/auth/payments/checkout/ecpay.ts` | 6（4×TS7031 handler ctx + 2×TS7006 helper param）| **3 行**（L52 / L56 / L174）| handler ctx + helper param annotation（type-only、TS erase 後 byte-identical）|
| `types/env.d.ts` | 0（被動）| **3 行新增**（L57 後）| 補 3 個 **additive optional** ECPAY callback-URL key（封 sealed Env 缺口；`.d.ts` 永不 emit runtime）|

本 PR ＝ payments 大熱區續清（接 PR-2cq #115 `[id].ts`、PR-2cr #116 `intents.ts` list、PR-2cs #117 `payment-return/ecpay.ts`、PR-2ct #118 `mock.ts`）。與前四棒差異：**本檔是金流寫入路徑（建 payment_intents、算 CheckMacValue），非讀取/非權威 redirect** → review care **L3**（Tier-0），完整 Dual Gate v3.1 四道外部審查、不降級。

## ⚠️ Path A scope 擴張的緣由（spike 實證、owner 批准；ChatGPT Arch / Codex Plan 必看）

**owner 原 SPEC_APPROVED（2026-06-26）鎖定「6 annotation、單檔」OD**。Claude **non-commit full-solution spike** 證明該 OD **無法淨降**：

- 標 `onRequestOptions`/`onRequestPost` 的 `env: Env` → 掀出 **3 個 unique TS2339**（`env?.ECPAY_RETURN_URL` @L135、`env?.ECPAY_CLIENT_BACK_URL` @L139、`env?.ECPAY_ORDER_RESULT_URL` @L146 — 三個 callback-URL 覆寫 key 未宣告於 `Env`）。
- 結果（single-file，只標 ecpay.ts、不補 env.d.ts）：REMOVED 6（目標 noImplicitAny）/ ADDED **3 個 unique TS2339**。forced full-solution tsc 把這 3 個 unique error 計為 **6 條 error-line**（dual-leaf 計數，見下） → ratchet errorCount **789→789（淨 ≈0）**。**但真正使單檔不足的不是「淨 ≈0」，而是：ecpay.ts 仍殘留 3 個 TS2339 → 維持 error file → 無法歸零、無法進 cleanFiles**（敗在「cleanFiles +1」目標；L-1）。
- **dual-leaf 計數（為何 3 個 unique TS2339 在 forced tsc 顯示為 6 條 error-line；Codex/ChatGPT 重跑 forced tsc 會看到 ADDED=6，本段使其與「3 unique」reconcile）**：`functions/api/auth/payments/checkout/ecpay.ts` 同時被**兩個 leaf tsconfig 的 `include` 直接納入編譯**：① `tsconfig.functions.json`（`include: functions/**/*.ts`、**`noImplicitAny: true`**）② `tsconfig.tests.json`（`include: functions/**/*.ts`、**`noImplicitAny: false`**；`payments-ecpay.test.ts` 亦 import 本檔）。**TS2339（property 不存在）與 noImplicitAny 無關、兩 leaf 皆報** → 3 unique × 2 leaf = **6 條 line**；而 **TS7031/TS7006（implicit-any）只在 `noImplicitAny:true` 的 functions leaf 報** → base 的 6 個 noImplicitAny 只算 **1×**（共 6 條）。ratchet 每條 error-line 計 1（不去重）→ base **789**（含 6 noImplicitAny）→ single-file **789**（−6 noImplicitAny、+6 TS2339-line）→ **Path A 783**（−6 noImplicitAny、3 個 TS2339 因 key 已宣告而全消、ADDED 0）。**dual-leaf 不影響 Path A 交付**（最終 ecpay.ts 在兩 leaf 皆 0 error、進 cleanFiles）。
- 根因：`Env` 已宣告 4 個 sibling ECPAY key（`ECPAY_MODE/MERCHANT_ID/HASH_KEY/HASH_IV` @env.d.ts:54-57），**獨缺這 3 個 URL key**。implicit-`any` 時 `env` 是 any、靜默放行；一標 `env: Env` 即掀缺口。**與 PR-2m `email.ts`「sealed Env 缺口」同型**。
- `Pick` 救不了：handler 把 `env` **整包 forward** 給 `getCorsHeaders`/`requirePaymentAccess`/`createPaymentIntent`/`getEcpayCheckoutUrl`/`buildEcpayCheckoutFields`/`safeUserAudit` → 需 full `Env`，不能用窄 `Pick`。

**owner 裁定（2026-06-26）＝Path A（2 檔）**：ecpay.ts 6 annotation + `types/env.d.ts` 補 3 個 additive optional key。**Path A spike 實證**：errorCount **789→783**（淨 −6）、forced full-solution sort-diff **REMOVED=6 / ADDED=0（零 cascade）**、ecpay.ts emit **byte-identical**、`.d.ts` 零 runtime → 忠實「封缺口」、非發明邏輯。

**為何 additive key 安全（Tier-0 shared contract 變更的防審查點）**：
1. **additive optional**（`?: string`）→ backward-compatible，無法破壞既有 code（無任何 code 依賴這些 key「不存在」）。
2. 補的是**真實 runtime env config**（已被 L135/139/146 消費）→ 補上 = 文件化現狀、非新增行為。
3. forced full-solution tsc（functions + scripts + tests + browser 全 leaf）**ADDED=0** → 零 cascade、零破壞，全樹實證。
4. `.d.ts` **永不 emit JS** → 對 runtime bytecode 零足跡；ecpay.ts emit byte-identical → handler runtime 不變。
5. **不碰** 既有 4 個 ECPAY key、不改任何既有 key 的型別/optionality、不動 `Env` 其他段、不動 `CfRequest` alias、不動 `cloudflare:test` bridge。

## base 錨點（current main，非 stale）

- **base ＝ current main `31ac2fa6`**（`git rev-parse HEAD` 實證 `31ac2fa66b0a833856deba93e69812b7c8884bcc`、`origin/main == HEAD == branch tip` 三者一致、working tree clean〔僅 `?? CLEANUP_PLAN.md` untracked〕）。
- 此即 PR-2ct #118 `31ac2fa6`（`mock.ts`）squash commit；owner prompt base 與實查一致、**無 stale 修正**。
- branch `refactor/stage7-pr2cu-checkout-ecpay-noimplicitany`（自 clean main `31ac2fa6` 開、未 push）。
- base source blobs：ecpay.ts `4a25858953c29ea5b5e5b6ceffb618ca6aadd596`、env.d.ts `852dc08cbc51d8b663b5488c084d5dc7e73a8a5f`；plan-only commit 後 `HEAD:src` blob 仍須 == base（source 零落地，[[feedback_gate_packet_replay_anchor_head_vs_base]]）。

## annotation 形式裁定（沿 Convention A function-declaration + inline param type）

ecpay.ts 唯一允許落地的 3 行 source diff：

```ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {  // L52
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {      // L56
function pickSafeUrl(input: unknown, origin: string) {                                       // L174
```

env.d.ts 唯一允許落地的 3 行新增（接在 L57 `ECPAY_HASH_IV?` 後、L58 `PAYMENT_MOCK_SECRET?` 前）：

```ts
    ECPAY_RETURN_URL?: string;
    ECPAY_CLIENT_BACK_URL?: string;
    ECPAY_ORDER_RESULT_URL?: string;
```

- **正式 frozen form ＝ function-declaration ＋ inline param type**（沿 PR-2cp..2ct 既定）；**禁** arrow const、named type alias、拆多行、加 return type。
- handler ctx ＝ **full Convention A `{ request: Request; env: Env }`**（兩 handler 皆 destructure `{ request, env }` 且實讀 `env.*` + 整包 forward env → 用 full `Env`，**非** request-only 子集、**非** `Pick`、**非** `CfRequest`〔無 `.cf` 存取〕）。
- env.d.ts key ＝ **bare `KEY?: string;`**（對齊既有 4 個 ECPAY key 形式；不加 per-key 註解、不重排既有 key）。

## OD ruling（型別選型，對抗式驗證）

| 決策點 | 裁示 | 理由 |
|---|---|---|
| handler `request` | **`Request`（plain）** | `getCorsHeaders(request,…)` + `new URL(request.url)` + `request.json()`；**無 `.cf` 存取** → 非 `CfRequest` |
| handler `env` | **`Env`（full）** | 兩 handler 實讀 `env.chiyigo_db`/`env?.ECPAY_*` 並**整包 forward** 給 6 個 util → 需 full Env；**Pick 否決**（forward 面要 full）|
| `pickSafeUrl(input)` | **`unknown`** | 函式體 `if (!input \|\| typeof input!=='string') return null` defensive guard（narrow 後 `new URL(input)` 合法）；boundary 值、untrusted；**PR-2ct `constantTimeEq=unknown` / PR-2q `validatePassword(pw:unknown)` 先例**；call-site 傳 `body?.client_back_url`（`string\|undefined`）→ assignable to `unknown`、零 cascade |
| `pickSafeUrl(origin)` | **`string`** | call-site `const origin = new URL(request.url).origin`（@L134、`URL.origin` 回 string）；函式體 `parsed.origin === origin` 比對 string → `string`（已實證）|
| env.d.ts 3 key | **additive optional `?: string`** | 真實 callback-URL 覆寫 env（`env?.X \|\| fallback`）；封 sealed Env 缺口；backward-compatible |
| `CfRequest`（**否決**）| **禁** | 無 `.cf` 存取 |
| `Pick<Env,…>`（**否決**）| **禁** | env 整包 forward、需 full Env；用 Pick 會破壞 forward 面 |
| arrow const / return type / JSDoc / 格式（**否決**）| **不改** | 沿 lock，只處理 noImplicitAny 6 錯 |

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（mechanical type-only、3+3 行）/ review care **L3**（**金流寫入路徑 Tier-0**：建 payment_intents、算 CheckMacValue、requisition owner 驗證、idempotent MerchantTradeNo；本檔有 auth gate〔requirePaymentAccess〕+ D1 write〔createPaymentIntent〕+ tenant/owner scope〔requisition_id owner 驗〕）。**完整 Dual Gate v3.1 四道外部審查、不降級**（金流寫入、就高不就低）。
- **self-review ＝ multi-agent workflow（payments 熱區、不降單 agent；[[feedback_self_review_form_not_downgradable_by_spike]]）**。rubric **收斂 scope-fidelity / runtime-security / evidence-integrity 三維、不擴全域**（不碰任何排除檔、不碰 runtime 紅線、不碰 `CLEANUP_PLAN.md`）。finder/verifier 用 **`readonly-reviewer` agent**（無 model pin → 繼承 session model Opus 4.8，[[feedback_selfreview_workflow_model_inheritance]]；options `__proto__:null` no-haiku 機械保證；**非機械安全邊界、持 Bash、read-only 屬 best-effort**）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner 2026-06-26：候選＝`checkout/ecpay.ts`（A 修正 C 誤點）；OD ＝ handler `{request:Request;env:Env}` + `pickSafeUrl(input:unknown,origin:string)`；spike 揭 env 缺口後 owner 裁 **Path A（2 檔）**＝補 3 個 ECPAY_*_URL key；self-review ＝ multi-agent workflow（不降）；**禁** `CfRequest`/`Pick`/arrow const/return type/新 import/碰排除檔。
  - ✅ Claude scout（read-only @ `31ac2fa6`）→ 逐檔 error set（**恰 6 錯**：L52,42 / L52,51 / L56,39 / L56,48 〔4×TS7031 ctx〕+ L174,22 / L174,29 〔2×TS7006 helper〕）+ caller cascade（handler ＝ Pages entrypoint 無 TS importer；`pickSafeUrl` 局部非-export、caller 僅同檔 L137/L138）+ env 缺口發現（3×TS2339）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 revert clean、blobs 回 base）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ⬜ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow；收斂三維；主線獨立裁決非採 raw）
  - ⬜ `CHATGPT_ARCH_APPROVED`（① 維度 B）→ ⬜ `CODEX_PLAN_APPROVED`（② 維度 C）→ ⬜ owner `CODING_ALLOWED`
  - ⬜ Code 階段（source commit → full replay @ committed、不沿用 spike）→ ⬜ `CODE_SELF_REVIEW_CLEAN`（維度 A workflow）→ ⬜ `CODEX_CODE_APPROVED`（③）→ ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④）
  - ⬜ merge-front 7 gates → ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

## owner 鎖定表（2026-06-26，faithful 收錄；Path A 更新版）

| Lock | 內容 |
|---|---|
| L-1 Scope | **2 檔**：① `functions/api/auth/payments/checkout/ecpay.ts` 6 annotation（3 行：L52/L56/L174）② `types/env.d.ts` 補 3 個 additive optional ECPAY_*_URL key（3 行新增）。納入全 6 錯，ecpay.ts 目標 0 noImplicitAny、cleanFiles +1 |
| L-2 Runtime hot-zone lock | **不改** ECPay payload / amount / MerchantTradeNo / CheckMacValue / returnUrl·clientBackUrl·orderResultUrl 構築 / requisition_id owner 驗證 / createPaymentIntent / getEcpayCheckoutUrl creds 檢查 / pickSafeUrl 函式體（same-origin 驗證 policy）/ safeUserAudit / 任何 response shape·status·CORS·docstring |
| L-3 No new shared logic / no new import | 不新增 shared **logic**、不抽 helper、不新增任何 import；**例外（owner 批准）**：`types/env.d.ts` 3 個 additive optional type-only key（封 Env 缺口、非 shared logic）|
| L-4 helper 回傳型別維持推斷 | `pickSafeUrl` **不加 return type**，維持 TS 推斷 `string \| null` |
| L-5 byte-identical evidence | ecpay.ts emit **byte-identical**（type-strip / canonical esbuild `--loader=ts --format=esm` stdin）為 merge 前必要證據；`.d.ts` 零 emit（不入 byte-identical、其安全由 additive-optional + forced-tsc ADDED=0 證）|
| L-6 env.d.ts 邊界 | 只新增 3 個指定 key、bare `?: string`、接 L57 後；**禁** 改既有 key、重排、改 optionality、動 `CfRequest`/`cloudflare:test` bridge/其他段 |
| L-7 OD 形態 | handler `{request:Request;env:Env}` full Convention A；`input:unknown`/`origin:string`；**禁** `CfRequest`/`Pick`/arrow const |
| L-8 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L-9 Coverage 誠實 | 覆蓋分層誠實標示（§測試影響面）；不 overclaim runtime 覆蓋（[[feedback_pr_coverage_claim_accuracy]]）|
| L-10 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / 偏離 OD（`CfRequest`/`Pick`/arrow const/加 return type/動函式體·redirect·payload/env.d.ts 超出 3 key）→ 退回 `PLAN_DRAFT` |

## ⚠ payments 寫入路徑聲明（review care L3，**Tier-0 金流建單**）

`auth/payments/checkout/ecpay.ts` ＝ ECPay AIO 結帳建單 endpoint：require KYC/payment access → 驗 requisition_id owner → creds 檢查 → `createPaymentIntent`（D1 INSERT，status=pending）→ 算 ECPay checkout fields + CheckMacValue → 回 `{ checkout_url, fields, intent_id }`。**金流寫入 + auth gate + tenant scope** 全在本檔：

| 紅線（typing 全程不得牽動）| 位置 |
|---|---|
| auth gate `requirePaymentAccess(request, env)` | L58 |
| amount 驗證（MIN/MAX、Number.isFinite）| L73-76 |
| requisition_id **owner 驗證**（防 A 塞 B 的 req id 污染對帳）| L88-106 |
| vendor creds 檢查（建 intent 前、避殘留 pending）| L110-119 |
| `createPaymentIntent`（D1 write、idempotent vendor_intent_id）| L122-131 |
| same-origin URL 驗證 policy（`pickSafeUrl` 函式體）| L174-180 |
| ECPay fields + CheckMacValue 構築 | L147-156 |
| audit（`payment.checkout.created` / `requisition_owner_mismatch` / `vendor.misconfigured`）| L98/113/158 |

本刀只在 2 個 handler 簽名 + 1 個 helper 簽名加 inline param annotation（TS erase 後 byte-identical），**函式體一律不動**。修法若非純型別、或牽動上列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L-2/L-10）。

### Coding 階段硬性邊界

- **允許**：ecpay.ts 2 handler 簽名 + 1 helper 簽名各加 inline param type（§frozen diff 的 3 行）；env.d.ts 補 3 個指定 key（§frozen diff 的 3 行新增）。
- **禁止**：改 ecpay.ts 任何函式體 / redirect·payload·CheckMacValue·createPaymentIntent·requisition 驗證·pickSafeUrl 函式體 / docstring / 加 return type / 新增任何安全功能或驗證 / shared util logic / tests / `tsconfig`·`eslint`·`vitest` / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types`·`Pick` / 新增 any·suppression·global·import·package / env.d.ts 超出 3 個指定 key（改既有 key·重排·動其他段）/ **碰排除檔**（`mock.ts`〔#118 已清〕、`payment-return/ecpay.ts`〔#117 已清〕、`intents.ts`〔#116〕、`[id].ts`〔#115〕、`admin/payments/intents.ts`、`utils/payments.ts`、vendor `payment-vendors/ecpay.ts`、`webhooks/payments/[vendor].ts`、refund·delete·aggregate·dlq·metadata-archive·refund-request、其餘 payments / util / audit 域）/ 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `31ac2fa6`）

### 逐檔 error set（forced `tsc -b tsconfig.solution.json --force`，filtered，loc+code）

```
functions/api/auth/payments/checkout/ecpay.ts(52,42): error TS7031   # onRequestOptions request
functions/api/auth/payments/checkout/ecpay.ts(52,51): error TS7031   # onRequestOptions env
functions/api/auth/payments/checkout/ecpay.ts(56,39): error TS7031   # onRequestPost request
functions/api/auth/payments/checkout/ecpay.ts(56,48): error TS7031   # onRequestPost env
functions/api/auth/payments/checkout/ecpay.ts(174,22): error TS7006  # pickSafeUrl input
functions/api/auth/payments/checkout/ecpay.ts(174,29): error TS7006  # pickSafeUrl origin
```

**恰 6 錯**（owner 預估一致）：4×TS7031（2 handler × {request,env} destructure）+ 2×TS7006（pickSafeUrl input/origin）。

### 依賴邊界（caller cascade，spike 實測 = 0）

| 面 | 判定 | 證據 |
|---|---|---|
| 外部 production TS caller（handler）| **0 牽動** | `onRequestOptions`/`onRequestPost` ＝ Pages file-routing entry，production runtime 由 Pages 注入 context、不靜態 type-check 本 annotation |
| `pickSafeUrl` caller | **0 牽動（局部）** | 非-export、全 repo grep `pickSafeUrl` 僅 3 命中（L137/L138 caller + L174 def，皆同檔）；回傳維持推斷 `string\|null`、不加 return type → caller `safeClientBack`/`safeOrderResult` 型別不變 |
| env.d.ts additive key cascade | **0（全 leaf）** | Path A forced full-solution sort-diff ADDED=0（functions + scripts + tests + browser）；additive optional key 無法破壞既有 code |
| direct test importer（ecpay handler）| 見 §測試影響面 | `tests/integration/payments-ecpay.test.ts` 存在（覆蓋面誠實見下）|

**precedent landscape（佐證 OD ruling）**：
- handler `{ request: Request; env: Env }` ＝ repo 主流 Convention A（PR-2cq/2cr 等數十檔）→ 零新 OD。
- `input: unknown`（defensive guard boundary）＝ PR-2ct `constantTimeEq` / PR-2q `validatePassword` 先例 → 零新 OD。
- env.d.ts 補 key 封 Env 缺口 ＝ PR-2m `email.ts` Path A 先例（`MAIL_FROM_ADDRESS?`/`RESEND_TIMEOUT_MS?`）→ 零新 OD pattern。

## Spike 實證（full-solution，本地未 commit，2026-06-26，已 revert clean）

**程序**：branch（自 clean main `31ac2fa6`）→ 量 base（forced tsc total、base ecpay emit、ratchet:report）→ 套 6 ecpay annotation（單檔，先驗 OD 缺口）→ forced tsc 揭 **3 個 unique TS2339**（forced full-solution 計為 6 條 error-line＝dual-leaf〔§Path A 緣由〕；env 缺口）→ 套 Path A（+env.d.ts 3 key）→ forced tsc sort-diff + ratchet + byte-identical → frozen diff + `git diff --check` → `git checkout HEAD --` revert → 驗 clean（blobs 回 base、staged 空、net source vs base 空）。

| 驗收條件 | 結果 |
|---|---|
| ecpay.ts errors 6 → 0 | ✅ sort-diff REMOVED = 恰 6 行（L52,42/L52,51/L56,39/L56,48 TS7031 + L174,22/L174,29 TS7006）；patched grep `checkout/ecpay.ts` NONE-clean |
| **單檔 OD（只標 ecpay）→ 證 OD 不足** | ⚠ REMOVED 6 / ADDED **3 個 unique TS2339**（ECPAY_RETURN_URL@135 / CLIENT_BACK_URL@139 / ORDER_RESULT_URL@146；forced full-solution 計為 **6 條 error-line**＝dual-leaf〔functions leaf〔noImplicitAny:true〕+tests leaf〔noImplicitAny:false〕皆報 TS2339〕）→ ecpay.ts 殘留 3 TS2339、**維持 error file**、total **789→789（淨 ≈0）** → **單檔無法清零、無法進 cleanFiles → 觸發 Path A** |
| **Path A（ecpay 6 ann + env.d.ts 3 key）solution total 789 → 783（恰 −6）** | ✅ forced `tsc -b tsconfig.solution.json --force` total **783**；sort-diff **REMOVED=6 / ADDED=空（0）** |
| zero cascade（全 leaf：functions + scripts + tests + browser）| ✅ Path A solution sort-diff **REMOVED=6 / ADDED=0** |
| canonical ratchet `--report`（base → Path A）| ✅ base errorCount **789** / errorFiles **76** / cleanFiles **258** / sourceFilesTotal **334** → Path A **783** / **75** / **259** / **334**（ecpay.ts 全清入 cleanFiles）|
| **ecpay.ts emitted-JS byte-identical**（TS erase runtime 不變硬保證；canonical `esbuild --loader=ts --format=esm` stdin，[[feedback_byte_identical_emit_verification]]）| ✅ esbuild **stdin** type-strip base vs Path A **IDENTICAL**、皆 **4594B**、esbuild stderr 空：sha256 `190247ce377803df375e1b3e8864662155a72a911685ddbbee3cdf1f854b2c40` 兩端 |
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace）|
| frozen diff numstat | ✅ ecpay.ts `3 3`（base blob `4a258589`→head `78ab4e31`）+ env.d.ts `3 0`（base blob `852dc08c`→head `17efab36`）；無 whole-file CRLF churn |
| working tree revert clean | ✅ `git checkout HEAD --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、blobs 回 base、staged 空、`git diff 31ac2fa6..HEAD -- functions/ types/` 空 |

**byte-identical 適用性**：`checkout/ecpay.ts` **有 import**（L37-47）→ esbuild stdin transform 是**單檔 type-strip**（import 原樣穿透、不解析依賴），非完整 bundle。**對 type-only 證明而言這是正確粒度**：6 個 annotation erase 後輸出逐 byte 不變 → runtime 行為不變（同 PR-2cq/2cr/2ct 有 import 檔的作法）。⚠ 用 **stdin**（`<`），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell）；本 spike emit 4594B 非空、已排除該坑。env.d.ts ＝ `.d.ts` 永不 emit → 不入 byte-identical 比對（其安全由 additive-optional + forced full-solution ADDED=0 證）。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

```diff
diff --git a/functions/api/auth/payments/checkout/ecpay.ts b/functions/api/auth/payments/checkout/ecpay.ts
index 4a258589..78ab4e31 100644
--- a/functions/api/auth/payments/checkout/ecpay.ts
+++ b/functions/api/auth/payments/checkout/ecpay.ts
@@ -49,11 +49,11 @@ import { DEBUG_REASON_CODES } from '../../../../utils/audit-aggregate-debug'
 const MIN_AMOUNT = 1
 const MAX_AMOUNT = 200000  // 單筆綠界限額；金融操作上限再調

-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env, { credentials: true }) })
 }

-export async function onRequestPost({ request, env }) {
+export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
   const cors = getCorsHeaders(request, env, { credentials: true })
   const { user, error } = await requirePaymentAccess(request, env)
   if (error) return error
@@ -171,7 +171,7 @@ export async function onRequestPost({ request, env }) {

 // 限制 user 提供的 callback URL 必須 same-origin（http/https + 同 host）。
 // 任何不合法輸入回 null → 上層 fallback 到 env / 預設值。
-function pickSafeUrl(input, origin) {
+function pickSafeUrl(input: unknown, origin: string) {
   if (!input || typeof input !== 'string') return null
   let parsed
   try { parsed = new URL(input) } catch { return null }
diff --git a/types/env.d.ts b/types/env.d.ts
index 852dc08c..17efab36 100644
--- a/types/env.d.ts
+++ b/types/env.d.ts
@@ -55,6 +55,9 @@ declare global {
     ECPAY_MERCHANT_ID?: string;
     ECPAY_HASH_KEY?: string;
     ECPAY_HASH_IV?: string;
+    ECPAY_RETURN_URL?: string;
+    ECPAY_CLIENT_BACK_URL?: string;
+    ECPAY_ORDER_RESULT_URL?: string;
     PAYMENT_MOCK_SECRET?: string;
     KYC_MOCK_SECRET?: string;
     PSP_DIRECT_INTENT_ENABLED?: string;
```

`git diff --stat`：2 files changed, 6 insertions(+), 3 deletions(-)；`git diff --numstat`：ecpay.ts `3 3` / env.d.ts `3 0`。

## 預期 ratchet

- clean main `31ac2fa6` `--report`：errorCount **789** / errorFiles **76** / cleanFiles **258** / sourceFilesTotal **334**。
- 本 PR 後 current ratchet state：errorCount **789 → 783**（−6）、errorFiles **76 → 75**、cleanFiles **258 → 259**（spike 實測值；ecpay.ts 全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 783」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- ecpay.ts 改動 = 2 handler 簽名 + 1 helper 簽名 inline param 型別標註，TS erase 後 runtime byte-identical（§Spike sha `190247ce…` 兩端一致、4594B 實證）。
- env.d.ts 改動 = 3 個 additive optional type-only key，`.d.ts` 永不 emit → 零 runtime 足跡。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 789、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。
- **無 D1 migration**（純 type-only、不觸 schema）→ 不觸發 migration-before-merge（[[feedback_migration_before_merge_autodeploy]]）。

## 測試影響面（覆蓋誠實，L-9 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike 全 leaf sort-diff ADDED=0）。
- **覆蓋分層（誠實）**：

| 標的 | direct test | 硬保證 |
|---|---|---|
| `onRequestPost`（ECPay 建單）| `tests/integration/payments-ecpay.test.ts` 存在 → coding 階段以實跑結果為準（不預先宣稱通過數）| byte-identical（emit 4594B 不變）+ integration（merge-front 實跑）|
| `onRequestOptions`（CORS preflight）| 視 test 覆蓋 | byte-identical |
| `pickSafeUrl`（same-origin 驗證 helper）| 局部、隨 handler 覆蓋 | byte-identical |
| env.d.ts 3 key | 型別層（無 runtime test 面）| additive optional + forced-tsc ADDED=0 |

- **誠實界線**：type-only 改動 runtime 不可見（型別 erase）→ **主硬保證 ＝ byte-identical emit（ecpay.ts sha 兩端一致 4594B）**。`payments-ecpay.test.ts` 的具體覆蓋與通過數**於 coding 階段實跑後據實記錄、不在 plan 階段預先宣稱**（[[feedback_dont_assert_runtime_semantics_without_verify]]）。
- merge-front 跑全量 `test:int` / `test:cov` 確認無跨檔破壞（本檔 type-only + env.d.ts additive → 預期零牽動）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`（或 `--force`）；**改 ambient `.d.ts` 後尤須 `--force`**（[[feedback_tsc_b_incremental_stale_after_ambient_dts]]）。**PowerShell 用 `$env:RATCHET_BASE_REF='31ac2fa6'`**；唯獨 byte-identical 段用 **Git Bash**（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='31ac2fa6'; npm run typecheck:ratchet` green（789→783 / 76→75 / 258→259）。
- forced `tsc -b tsconfig.solution.json --force`：ecpay.ts 0 殘留 + 全 leaf sort-diff **REMOVED=6 / ADDED=0**。
- **byte-identical**（canonical recipe；NB-2 雙證之一）⚠ **Git Bash**：

```bash
git show "31ac2fa6:functions/api/auth/payments/checkout/ecpay.ts" | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/pr-base.js 2>/tmp/pr-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < "functions/api/auth/payments/checkout/ecpay.ts" > /tmp/pr-head.js 2>/tmp/pr-head.err
wc -c /tmp/pr-base.js /tmp/pr-head.js          # 期望 4594 兩端
sha256sum /tmp/pr-base.js /tmp/pr-head.js       # 期望 190247ce377803df… 兩端
cat /tmp/pr-base.err /tmp/pr-head.err            # 期望空（stderr 0 bytes）
diff -q /tmp/pr-base.js /tmp/pr-head.js           # 期望 IDENTICAL
```

- **NB-2 雙證**：Code 階段報告**同時列**「ecpay.ts base vs patched emit byte-identical（esbuild stdin、sha + bytes）」與「source diff 僅 3+3 行（`git diff` 逐行 == frozen）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green、`npm run build:functions` green（Compiled Worker successfully）。
- 全量 `test:int` / `test:cov` 確認無跨檔破壞。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 2 檔、ecpay.ts +3/−3 + env.d.ts +3/−0）；超出 = scope creep = Gate fail。
