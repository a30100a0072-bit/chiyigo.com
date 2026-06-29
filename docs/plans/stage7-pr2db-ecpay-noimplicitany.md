# Stage 7 PR-2db — annotate payment-vendors/ecpay.ts noImplicitAny (27 → 0)

> **gate-log 文件**（非 source/scope）。Dual Gate v3.1：任何進 repo 改動（含本 docs 檔）全走 4 道外部審查。

## §0 SPEC（owner directive 2026-06-29 — `SPEC_APPROVED`）

**背景**：payments 域 noImplicitAny 清理的 **最後一個 vendor adapter leaf**（殿後重檔）。前棒 PR-2da（#125 `3b7e9a13`）已建 `functions/utils/payment-types.ts`（`PaymentAdapter`/`WebhookParseResult` 純型別契約）並把 spine（`utils/payments.ts`）+ webhook（`[vendor].ts`）收斂；當時 owner 明示「ecpay 不標 PaymentAdapter、殿後」。本 PR 即 ecpay.ts 自己的清理棒（27→0）。audit 域 ~375 為 noImplicitAny 最後一塊（殿後）。

**owner scope 裁定（2026-06-29 + ChatGPT SPEC 收斂）= single-file（非 Path-A）**：
- **僅改 1 檔**：`functions/utils/payment-vendors/ecpay.ts`（27→0、純 type-only）。
- **禁碰**（owner 明示 non-goal）：`types/env.d.ts`（scout 證 5 把 creds key 已宣告、不需動）、`tests/payments-ecpay-failopen.test.ts`（PAY-002 安全回歸測試、禁改）、`tests/integration/payments-ecpay.test.ts`、`functions/utils/payment-types.ts`（既有契約、不動）、`functions/utils/payments.ts`（registry，不動）、同域 payments 其他檔。
- **禁新增 explicit `any`**、禁 `as any` 雙 cast、禁加 cast 壓 TS2345。
- **禁改 runtime branch / CheckMacValue 簽章演算 / getCreds fail-closed 真值表 / ecpayRefund 防偽校驗 / SANDBOX_CREDS / webhook parse 分流 / MerchantTradeNo 產生 / response shape**。
- **byte-identical emit**（純 type-only；scout 已實證 erase）。
- ratchet：**700 → 673**（REMOVED 27 / ADDED 0）、errorFiles **64 → 63**、cleanFiles **271 → 272**（ecpay 進 clean）；baseline `1119/175` 凍結（**不** `--update`）。

**OD 裁定（owner + ChatGPT，binding 進 Plan Gate）= OD-PR2db-1**：
| OD | 裁定 | 理由 |
|---|---|---|
| **OD-PR2db-1**：`parseWebhook` env 型別 | **方案 B：narrow `Pick<Env>`**（`type EcpayCredsEnv = Pick<Env, 'ENVIRONMENT' \| 'ECPAY_MODE' \| 'ECPAY_MERCHANT_ID' \| 'ECPAY_HASH_KEY' \| 'ECPAY_HASH_IV'>`） | ecpay 只讀 5 把 creds key（皆已 optional in env.d.ts）；PAY-002 fail-closed 測試直接 import 並傳 partial env（`{}`/`{ ENVIRONMENT:'production' }`…）；full `Env` 會噴 **6× TS2345** cascade 進安全測試、逼改測試或加 cast（scout 實證、§3）。B = 單檔、27→0、ADDED 0、byte-identical |
| const 標註 | **不標** `ecpayPaymentAdapter: PaymentAdapter` | 標了會把 `env: Env` 強加到外部簽章 → 撞 failopen（同上）；契約仍由 `payments.ts` 的 `ADAPTERS: Record<string, PaymentAdapter>` registry 機械強制（維持 PR-2da 安排）|
| return 型 | `parseWebhook(...): Promise<WebhookParseResult>`（用既有 `payment-types.ts` interface） | 給 return object literal contextual type → 消 `user_id`/`amount_raw` TS7018；assignability 已由 PR-2da registry 證（ecpay return 已 assignable to WebhookParseResult）|
| `filtered` TS7053 | `Record<string, string>`（×2） | 局部累加器、key=`Object.entries` 的 string、value=string；非 PR-2da OD-2 的 D1-any-key 陷阱 |
| `params` / helper params | `Record<string, string>` / `string` / `Date` / `number` 等精確型 | 所有 call-site 傳 string-valued record；精確型免 template-literal unknown 問題、byte-identical |

**non-goals（owner 明示，本 PR 不做）**：env.d.ts 改動、PAY-002/integration 測試改動、const PaymentAdapter 標註、strict:true 補洞、任何 runtime / 簽章 / fail-closed / refund / webhook 行為變更。

**success criteria**：ecpay.ts 27 noImplicitAny → 0；零 runtime change（byte-identical）；env.d.ts + 兩 test 檔零改動；payments 域 vendor leaf 清空（僅餘 audit ~375 殿後）。

## §1 base / branch（HEAD-independent anchor）

- **base ＝ `3b7e9a13`**（main HEAD ＝ #125 PR-2da `PaymentAdapter interface coupled`；`git rev-parse HEAD` 實證 `3b7e9a13b053…`；tracked source 對 base 零 diff；untracked 僅 `CLEANUP_PLAN.md` + 本 plan doc）。
- **branch ＝ `stage7-pr2db-ecpay-noimplicitany`**（off `3b7e9a13`、未 push）。
- base source blob（`3b7e9a13`）：`ecpay.ts` `1ab7b625`；標註後 head blob `5f3ebb3b`。
- **plan-only commit 後 `HEAD:src` 的 ecpay.ts blob 仍須 == base `1ab7b625`**（source 零落地，[[feedback_gate_packet_replay_anchor_head_vs_base]]）；annotation 在 Code 階段才落地。

## §2 scope：27 noImplicitAny + 修法（1 檔、type-only）

baseline 錯（scout forced `tsc -b … --force` @ `3b7e9a13` 實證、loc 逐一吻合）：
- `payment-vendors/ecpay.ts` = **27**：
  - **TS7006 ×18**（參數）：`getCreds(env)` L66 · `getEcpayCheckoutUrl(env)` L98 · `ecpayUrlEncode(s)` L112 · `ecpayCheckMacValue(params,hashKey,hashIV)` L129 ×3 · `parseWebhook(request,env)` L151 ×2 · `buildEcpayCheckoutFields(env,payload)` L301 ×2 · `formatTradeDate(d)` L327 · `pad(n)` L331 · `ecpayCheckMacValueDebug(params,hashKey,hashIV)` L337 ×3 · `truncate(s,max)` L354 ×2 · `ecpayRefund(env, …)` L386 env ×1。
  - **TS7053 ×4**（`filtered = {}` 索引）：ecpayCheckMacValue L134（寫）+ L137（讀）· ecpayCheckMacValueDebug L342（寫）+ L345（讀）。
  - **TS7018 ×2**（return object literal property `null` 在 strictNullChecks-off 為 implicit-any）：L247 `user_id: null` · L250 `amount_raw: null`。
  - **TS7031 ×3**（`ecpayRefund` 第 2 參解構）：L386 `merchantTradeNo` / `tradeNo` / `totalAmount`。
- **全 27 皆 TS70xx（functions-leaf only、單算、非 dual-leaf 重複計）**；無 `adapter.*`/`parsed.*` TS2339（cascade 只在 env 拉成 full Env 後才現，§3）。

**修法（1 檔、全 type-only、frozen diff 見 §4）= 12 處標註**：
1. **import + type alias**（檔頭）：`import type { WebhookParseResult } from '../payment-types'`（erase）+ `type EcpayCredsEnv = Pick<Env, 'ENVIRONMENT' | 'ECPAY_MODE' | 'ECPAY_MERCHANT_ID' | 'ECPAY_HASH_KEY' | 'ECPAY_HASH_IV'>`。
2. **env 參數 ×5** → `EcpayCredsEnv`：`getCreds` / `getEcpayCheckoutUrl` / `parseWebhook` / `buildEcpayCheckoutFields` / `ecpayRefund`（全部只透過 `getCreds(env)` 消費 env，least-privilege）。
3. **`parseWebhook` return** → `: Promise<WebhookParseResult>`（消 TS7018 ×2）。
4. **`filtered` ×2** → `: Record<string, string>`（消 TS7053 ×4）。
5. **`params`/`hashKey`/`hashIV` ×2 組** → `Record<string, string>`/`string`/`string`（ecpayCheckMacValue + Debug）。
6. **純值參數**：`ecpayUrlEncode(s: string)` · `formatTradeDate(d: Date)` · `pad(n: number)` · `truncate(s: string, max: number)`。
7. **`buildEcpayCheckoutFields` payload** → inline 結構型（8 欄、對 checkout/ecpay.ts:147 call-site 驗 assignable）。
8. **`ecpayRefund` 解構** → inline 結構型（`merchantTradeNo`/`tradeNo`/`totalAmount`/`action?`、對 refund.ts:124 + approve.ts:151 call-site 驗 assignable）。

## §3 OD analysis — OD-PR2db-1（env 型別、spike 實證）

### OD-PR2db-1（`parseWebhook` env 型別）✅ 解 = 方案 B：narrow `Pick<Env>`

- **機制**：ecpay.ts 被 `tests/payments-ecpay-failopen.test.ts`（PAY-002 fail-closed 安全回歸測試）直接 import，刻意傳 **partial env** 驗 fail-closed 真值表：`parseWebhook(req, {})` · `{ ENVIRONMENT: 'production' }` · `{ ENVIRONMENT:'production', ECPAY_MERCHANT_ID:'x', ECPAY_HASH_KEY:'y' }` · `{ ECPAY_MODE:'sandbox' }` 等。
- **⚠ 方案 A（full `env: Env`、含「標 const 為 PaymentAdapter」的 interface 法）實證會破**：scout 把 parseWebhook env 標 full `Env` → forced tsc 新增 **6× TS2345**（全在 PAY-002 測試 tests-leaf）：

  | loc | 訊息 |
  |---|---|
  | failopen L55 | `Argument of type '{}' is not assignable to parameter of type 'Env'` |
  | failopen L63 | `'{ ENVIRONMENT: string; }' is not assignable to 'Env'` |
  | failopen L70/79/90/100 | partial env literal 不 assignable to `Env` |

  根因：`Env` 有必填 binding（`chiyigo_db`/`CHIYIGO_KV`/`AUDIT_ARCHIVE_BUCKET`/`AI`/`JWT_*`），partial literal 缺必填欄 → TS2345（與 strictNullChecks 無關、missing-property 基本檢查）。→ A 會把單檔 type-only 任務擴成**改動 PAY-002 安全測試**（加 cast / 造 full env），違 [[feedback_security_boundary_pr_first_do_no_harm]]。
- **解（owner 裁 B）**：`type EcpayCredsEnv = Pick<Env, 'ENVIRONMENT' | 'ECPAY_MODE' | 'ECPAY_MERCHANT_ID' | 'ECPAY_HASH_KEY' | 'ECPAY_HASH_IV'>`。這 5 key 在 env.d.ts **皆 optional** → partial literal（含 `{}`）全 assignable → failopen 測試零改動。production handler 傳 full `Env` → assignable to `Pick` 子集 ✓。registry `ADAPTERS: Record<string, PaymentAdapter>`（parseWebhook 期望 `env: Env`）對 ecpay concrete `env: EcpayCredsEnv` 仍 assignable：`EcpayCredsEnv` ＝ **least-privilege env surface**（只要求 5 個 optional creds key）→ 結構上比 full `Env` **更寬鬆**（`Env <: EcpayCredsEnv`、full Env 含全部 5 key + 其餘必填 binding）→ concrete method 接受面 ⊇ interface 要求面 → **standard structural assignability** 即成立（**非靠 method bivariance**；ChatGPT Arch ARCH-L15 論述微調採納）。**compile evidence**：scout 套標註後 ADDED 0 已含 `payments.ts:431` registry assignment 行（`ecpay: ecpayPaymentAdapter`）編譯通過；Code Gate 必重證（ARCH-L15）。
- **語義正當性**：`EcpayCredsEnv` = least-privilege（只暴露 ecpay 實際讀的 5 key），且誠實描述 fail-closed 契約（webhook 可能在 env 未齊時抵達 = 正是測試覆蓋的情境）。綁 `Pick<Env>` → env.d.ts rename creds key 時編譯期 surface drift。

### 其他 typing 決策（非新 OD，但 gate 須知）

- **TS7018 → return type**：`parseWebhook(...): Promise<WebhookParseResult>` 給 return object literal contextual type，`user_id: null` 得 `number | null`、`amount_raw: null` 得 `string | null` → 消 implicit-any。**assignability 已由 PR-2da registry 證**：`ADAPTERS: Record<string, PaymentAdapter>`（含 `ecpay: ecpayPaymentAdapter`）今日已 typecheck → ecpay 現有 inferred return 已 assignable to `WebhookParseResult`（含 `paymentInfo: {…}|null` → `payment_info?: Record<string,unknown>|null`）；顯式標 return 只是把同一檢查寫明。failopen 測試讀 `parsed.ok/error/code/status/vendor_intent_id`、integration 測試讀的欄位皆在 `WebhookParseResult` → 零 breakage（scout ADDED 0 證）。
- **TS7053 `filtered` → `Record<string, string>`**：`filtered` 是 ecpayCheckMacValue/Debug 內局部累加器，`for (const [k, v] of Object.entries(params))` 的 k/v 皆 string（params: `Record<string,string>`）→ `filtered[k] = v` 合法、`${filtered[k]}` template 為 string（無 unknown-in-template 問題）。**非 PR-2da OD-2 陷阱**（那是 `ALLOWED_TRANSITIONS` 被 D1-any key 索引、需 string index sig；此處 key 本就是 string，`Record<string,string>` 直解）。
- **`params` → `Record<string, string>`**：全 call-site（parseWebhook 內 `Object.fromEntries(URLSearchParams)` / ecpayRefund 內 `fields`+`rtn` / 兩 test 的 `Record<string,string>` 變數）皆 string-valued record、assignable（scout 證）。
- **payload / ecpayRefund 解構 inline 結構型**：對 3 個 call-site（checkout L147 / refund L124 / approve L151）驗 assignable；call-site 多傳 D1-any（`intent.*`）或 any（`body?.*`）→ assignable to 結構型；required 欄（merchantTradeNo/totalAmount/returnUrl；merchantTradeNo/tradeNo/totalAmount）皆有傳、無 excess（scout ADDED 0 證）。
- **誠實邊界（WebhookParseResult return 的型別精度，self-review 維度 B-runtime NIT）**：標 `parseWebhook` return 為 `WebhookParseResult` 後，integration test 讀 `parsed.payment_info` 的精度由 base 端 inferred 的精確 `{ method?: 'atm'|'cvs'|'barcode'; … }|null` 降為 contract 的 `Record<string, unknown>|null`（sub-field 如 `.method` 變 `unknown`）。**benign、非 defect**：仍 compile（`.toBe(unknown)` 合法）、runtime 物件不變、**scout ADDED 0 已證無新錯**（含 integration tests-leaf）；屬採 shared contract（owner L7 mandate）的必然取捨，非本 PR 引入的 bug。

## §4 scout evidence（non-commit spike、已 `git checkout --` 還原；branch 重套復現）

- **current ratchet 實跑驗證（非記憶）**：`npm run typecheck:ratchet:report` @ `3b7e9a13` → errorCount **700** / errorFiles **64** / cleanFiles **271** / sourceFilesTotal 335。forced `tsc -b … --force` 同得 file-errors 700。
- 套 §2 十二處 edit → forced full-solution build sort-diff vs 700 baseline（loc+code 粒度 `comm`）：
  - **REMOVED ＝ 恰 27**（ecpay.ts 全 27 清，逐 loc 吻合 §2 清單）。
  - **ADDED ＝ 0**（零 cascade，含 failopen tests-leaf、integration tests-leaf、payments registry 面、全樹）。
  - raw 總數 **700 → 673**；per-file：ecpay.ts 27→**0**。
- ratchet after：errorCount **673** / errorFiles **63**（ecpay 離 errorFiles）/ cleanFiles **272**（ecpay 入 clean）；baseline `1119/175` 凍結。
- **OD-PR2db-1 對照實證**：方案 A（full `env: Env`）→ 673+6=**679**、6× TS2345 全在 failopen tests-leaf（§3 表）；方案 B（`Pick<Env>`）→ **673、ADDED 0**。
- **dual-leaf**：ecpay.ts 經 `tsconfig.functions.json`（noImplicitAny:true）+ `tsconfig.tests.json`（noImplicitAny:false）兩 leaf 編譯（被 `tests/integration/payments-ecpay.test.ts` + `tests/payments-ecpay-failopen.test.ts` import）。27 錯皆 TS70xx〔functions-leaf only、單算〕；若引入任何 TS2339/TS2345 會 dual-leaf 雙倍 → 方案 B ADDED=0 證**無**此類新錯（含兩 tests-leaf）。
- **byte-identical emit 實證**（canonical `esbuild --loader=ts --format=esm` stdin；**base 端 pin `3b7e9a13` 未標註 blob `1ab7b625` vs head 端 = 標註版**，非 HEAD-vs-HEAD 恆真比對〔[[feedback_byte_identical_emit_verification]]〕；stderr 空、sha ≠ 空字串 sha `e3b0c442…`）：

  | 檔 | base blob | head blob | base emit | head emit | 結論 |
  |---|---|---|---|---|---|
  | `ecpay.ts` | `1ab7b625` | `5f3ebb3b` | 11354B `04b32226…` | 11354B `04b32226…` | **IDENTICAL** |

  base==head 同 byte 同 sha → type annotation（含 `import type` + `Pick<Env>` alias + 各參數/return 型）全 erase → **零 runtime change**。

### frozen diff（git-format、spike 實取；`git diff --check` exit 0、`--stat` **+32/−13**；authoritative = scratchpad `chiyigo-pr2db.diff`、sha256 `118bf104…`、5910B）

> 完整 byte-for-byte frozen diff 見 Code Gate packet。本 §4 摘要關鍵 hunk；Code 階段 committed diff 必與 authoritative frozen diff byte-for-byte 對齊（L-parity）。

```diff
@@ 檔頭 +import type { WebhookParseResult } from '../payment-types'
       +type EcpayCredsEnv = Pick<Env, 'ENVIRONMENT' | 'ECPAY_MODE' | 'ECPAY_MERCHANT_ID' | 'ECPAY_HASH_KEY' | 'ECPAY_HASH_IV'>
-function getCreds(env) {                          +function getCreds(env: EcpayCredsEnv) {
-export function getEcpayCheckoutUrl(env) {        +... (env: EcpayCredsEnv)
-function ecpayUrlEncode(s) {                      +... (s: string)
-export async function ecpayCheckMacValue(params, hashKey, hashIV) {   +... (params: Record<string, string>, hashKey: string, hashIV: string)
-  const filtered = {}                             +  const filtered: Record<string, string> = {}     (×2：ecpayCheckMacValue + Debug)
-  async parseWebhook(request, env) {              +  async parseWebhook(request: Request, env: EcpayCredsEnv): Promise<WebhookParseResult> {
-export async function buildEcpayCheckoutFields(env, payload) {        +... (env: EcpayCredsEnv, payload: { merchantTradeNo: string; totalAmount: number; tradeDesc?: string; itemName?: string; returnUrl: string; clientBackUrl?: string; orderResultUrl?: string; choosePayment?: string })
-function formatTradeDate(d) {                     +... (d: Date)
-  const pad = n => …                              +  const pad = (n: number) => …
-async function ecpayCheckMacValueDebug(params, hashKey, hashIV) {     +... (params: Record<string, string>, hashKey: string, hashIV: string)
-function truncate(s, max) {                       +... (s: string, max: number)
-export async function ecpayRefund(env, { merchantTradeNo, tradeNo, totalAmount, action = 'R' }) {   +... (env: EcpayCredsEnv, { … }: { merchantTradeNo: string; tradeNo: string; totalAmount: number; action?: string })
```

## §5 security / 風險（Tier-0 金流 PSP adapter、first-do-no-harm）

| 區塊 | 角色 | 紅線（typing 全程不得牽動）|
|---|---|---|
| `getCreds` | **PAY-002 secure-by-default creds 解析** | fail-closed 真值表（production 禁 sandbox / 必三把真 creds / 非 prod 公開 sandbox creds「有且僅有」明確 ECPAY_MODE=sandbox+無真 creds 可達）；`EcpayConfigError.code` 機讀 |
| `ecpayCheckMacValue` / `ecpayUrlEncode` | **CheckMacValue 簽章演算** | SHA256 大寫 hex、.NET UrlEncode 規則（`~`→`%7e`/空白→`+`/lowercase）、key ASCII 排序、HashKey/HashIV 包夾；webhook 驗章 + refund 防偽共用 |
| `parseWebhook` | **webhook 解析 + fail-closed** | getCreds throw → `ok:false`（不在此 throw、留 handler 走 audit/DLQ）；簽章驗證；取號 vs 付款結果分流（RtnCode）；event_id/vendor_intent_id 抽取 |
| `ecpayRefund` | **退款 + 回應防偽** | P1-10/P2-7 回應校驗（MerchantID/MerchantTradeNo/TradeNo 一致 + 成功必帶身分欄 + CheckMacValue 重算）；Action=R |
| `buildEcpayCheckoutFields` / `generateMerchantTradeNo` | 結帳建單 | 欄位組裝 + CheckMacValue；MerchantTradeNo unique（≤20 char）；不洩 HashKey/HashIV |

- 本 PR ＝ **type-only**；byte-identical emit（§4：ecpay 11354B base==head `04b32226…`）→ **零 runtime change** → 上列簽章演算 / fail-closed 真值表 / refund 防偽 / webhook 分流 / 建單邏輯**完全不動**、可證。
- **高風險領域（Payment + 跨系統 JSON contract）對齊**：`parseWebhook` return 標 `WebhookParseResult` 是既有 runtime shape 的**描述性 typing**（PR-2da 已建契約、本 PR 沿用）；byte-identical 證 parse/簽章/分流行為不變。
- 零 cascade（scout 實證）→ env.d.ts / 兩 test 檔 / payments registry / mock 皆不動、不引入 any。
- **impl L1（純標註、無新抽象、沿用既有 interface）/ review care L3**：ecpay = 真實 PSP Tier-0，**不因 byte-identical 而降低外部審查強度**，走完整 4 道外部審查；self-review form ＝ **L2/L3 multi-agent workflow**（payments 熱區、不降單 agent）。
- **NB（strict:true follow-up、非本 PR 引入、byte-identical 不變、out of scope）**：`ecpayCheckMacValue` 內 `v === undefined || v === null`（v: string）在 strict:false 合法；strict:true（strictNullChecks on）可能觸 TS2367（型別無重疊）→ 屆時處理、不混入本 PR。

## §6 verification plan

- **byte-identical（L7）**：canonical `esbuild --loader=ts --format=esm`（stdin、Git Bash）對 **base `3b7e9a13` 未標註 blob `1ab7b625` vs 已標註 committed blob** 比對 sha（[[feedback_byte_identical_emit_verification]]；**禁 HEAD-vs-HEAD 恆真式**）— scout 已證 11354B/`04b32226…`；Code 階段 commit 後以 `3b7e9a13` 為 base 重播確認。
- **full-solution sort-diff（L6）**：Code 階段（commit 後）重跑 forced `tsc -b … --force`，對 700 baseline sort-diff → 必 **REMOVED 恰 27 / ADDED 0**（含 failopen + integration tests-leaf）；ADDED 非空 → 回 gate 重審、禁自擴 scope。per-file 必：ecpay.ts 0。
- **ratchet**：`RATCHET_BASE_REF=3b7e9a13 npm run typecheck:ratchet` → 期望 current **673 / 272**（errorFiles 63）；baseline 不動（**不** `--update`）。
- **merge-front 7 gates（對齊 CI `.github/workflows/ci.yml`）**：`lint`（含 `@typescript-eslint/no-explicit-any` — 本 PR 零 lexical any）· `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int`（含 `tests/integration/payments-ecpay.test.ts` + `tests/payments-ecpay-failopen.test.ts`，覆蓋 ecpay 簽章/fail-closed/refund 路徑）· `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **NB-2 雙證**：Code 階段報告**同時列**「ecpay base vs patched emit byte-identical（sha + bytes）」與「source diff（`git diff` 逐行 == authoritative frozen diff）」，不以 ratchet 數字單獨替代行為保證。
- **staged set**：僅 1 source 檔（ecpay.ts）+ 本 plan doc；**禁** `git add -A`、`CLEANUP_PLAN.md` 不進 commit。
- **硬驗收**：source diff 與 authoritative frozen diff **byte-for-byte 一致**（人審 `git diff --stat` 僅 1 檔 **+32/−13**）；超出 = scope creep = Gate fail。

## §7 Binding locks（owner SPEC 裁定 OD-PR2db-1；ChatGPT Arch Gate 可追加）

- **L1 Scope**：僅 1 source（ecpay.ts）；diff byte-for-byte == authoritative frozen diff；plan doc 只可更新 gate log。
- **L2 Runtime hot-zone**：不改 CheckMacValue 簽章演算 / getCreds fail-closed 真值表 / ecpayRefund 防偽校驗 / SANDBOX_CREDS / webhook parse 分流 / MerchantTradeNo 產生 / response shape / SQL；byte-identical 證。
- **L3 排除檔**：禁碰 `types/env.d.ts`、`tests/payments-ecpay-failopen.test.ts`（PAY-002）、`tests/integration/payments-ecpay.test.ts`、`payment-types.ts`、`payments.ts`、同域 payments 其他檔。
- **L4 No cast 壓 TS2345**：禁用 `as Env` / cast / full-env 物件去壓任何測試端 TS2345（= 不採方案 A）。
- **L5 不標 const PaymentAdapter**：`ecpayPaymentAdapter` const 不標 `: PaymentAdapter`；契約由 payments.ts registry 強制。
- **L6 env 型別 = `Pick<Env>`**：所有 ecpay env 參數標 `EcpayCredsEnv`（5 key Pick、綁 Env SoT）；不引入 full `Env` 到 parseWebhook。
- **L7 parseWebhook return**：必標 `Promise<WebhookParseResult>`（既有 payment-types.ts interface）。
- **L8 No lexical any**：禁 lexical explicit `any` / `as any` 雙 cast（ratchet/eslint no-explicit-any 機械 enforce）。
- **L9 sort-diff**：Code 階段必重跑；只接受 REMOVED 恰 27 / ADDED 0；per-file ecpay 0。
- **L10 byte-identical**：Code 階段必以 base `3b7e9a13` 未標註 blob vs committed 標註 blob 重證 emit identical。
- **L11 Ratchet baseline**：不得 `--update`；只接受 700→673 / 64→63 / 271→272 方向。

### ChatGPT Arch 追加 locks（① `APPROVED_WITH_LOCKS`、2026-06-29、binding）
- **ARCH-L12**：不得把 `EcpayCredsEnv` 改成完整 `Env`，除非 owner 另開「多檔 + 安全測試變更」PR。
- **ARCH-L13**：不得為消除 TS2345 對 PAY-002 測試加 `as Env` / `as any` / mock full binding / 或任何 cast。
- **ARCH-L14**：`EcpayCredsEnv` 必須用 `Pick<Env, 'ENVIRONMENT' | 'ECPAY_MODE' | 'ECPAY_MERCHANT_ID' | 'ECPAY_HASH_KEY' | 'ECPAY_HASH_IV'>`，不可另造脫離 Env SoT 的 local interface。
- **ARCH-L15**：Code Gate 必重跑 registry / use-site compile 證據；契約論證以 **structural assignability + compile evidence** 為準，**不得只以「bivariance」文字主張**（§3 已改）。
- **ARCH-L16**：`WebhookParseResult` 僅作既有 return 契約標註；不得趁機改 `payment_info` runtime shape 或 integration test assertion。
- **ARCH-L17**：frozen diff 必維持 **1 檔**；`types/env.d.ts`、PAY-002 test、integration test、`payment-types.ts`、`payments.ts` 皆不得改。
- **ARCH-L18**：emitted JS **byte-identical** 是 code-stage 必驗條件；若 byte diff 出現，回退重審。

## §8 gate trail（state 隨進度更新）

- [x] `SPEC_APPROVED`（owner directive 2026-06-29 + ChatGPT SPEC 收斂：single-file；OD-PR2db-1 = 方案 B；non-goals = env.d.ts / PAY-002 測試 / const PaymentAdapter / runtime 全不動）
- [x] `PLAN_SELF_REVIEW_CLEAN`（2026-06-29、L2/L3 multi-agent self-review〔payments 熱區、**3 readonly-reviewer 並行三維** scope-fidelity / runtime-security / evidence-integrity、繼承 Opus 4.8、read-only、未污染 git〕。**一輪 0 blocking/major/minor + 1 benign NIT**，主線獨立裁決全處置：**NIT〔dim2〕**＝WebhookParseResult return 令 integration test `parsed.payment_info` 精度降 `Record<string,unknown>|null` → 主線裁 benign〔仍 compile、runtime 不變、ADDED 0 證、owner L7 mandate〕、§3 補誠實邊界 disclosure〔additive doc、§9 回路節流主線單-agent 複驗、非 full workflow 重跑〕。**主線獨立驗證 CONFIRMED**：diff↔§2 12 site 1:1 · type-only〔唯一非 annotation 結構 edit `pad = n=>`→`(n:number)=>` esbuild 證 emit-neutral〕· locks L1-L11 守 · +32/−13 · Pick 完整〔ecpay 只讀 5 key、全經 getCreds〕· 3 call-site〔checkout/refund/approve〕全 assignable〔D1-any〕· registry assignment 編譯通過保契約〔structural assignability、`Env <: EcpayCredsEnv` 寬鬆面、ARCH-L15 Code Gate 重證〕 · REMOVED 27/ADDED 0〔含兩 tests-leaf〕· Variant-A 6×TS2345 cascade〔failopen L55/63/70/79/90/100〕· byte-identical 非恆真〔base `1ab7b625` emit `04b32226…`11354B vs head 標註版、reproduced〕· diff sha `118bf104…`/5910B · ratchet 700/64/271。誠實邊界〔plan 未過度宣稱〕：annotated-side emit fresh re-measure + forced sort-diff 留 Code Gate L9/L10〔worktree 已還原、read-only 不重跑 forced tsc〕）
- [x] `CHATGPT_ARCH_APPROVED`（① 維度 B、2026-06-29、`APPROVED_WITH_LOCKS`：0 blocker / 0 required revision / **6 added locks ARCH-L12..L18**〔§7〕；6 裁決點全 APPROVE〔OD-PR2db-1 `Pick<Env>` / 不標 const PaymentAdapter / `WebhookParseResult` return / 不改 env.d.ts / 不改 PAY-002 測試〔必維持〕/ 無 DB migration〕。**論述微調（非阻擋、已採納）**：`EcpayCredsEnv`（Pick 5 optional creds key）結構上比 full `Env` **更寬鬆**，registry 契約以「least-privilege env surface + structural assignability + Code Gate compile evidence」論證、**不以 method bivariance 為主要論據**（§3/§8 已修）。明示非 merge 授權、非 code correctness 最終裁決）
- [x] `CODEX_PLAN_APPROVED`（② 維度 C、2026-06-29、`APPROVED`：0 blocking / 0 required change；**live replay 全重現**〔HEAD `1f52b6bc`、`HEAD:ecpay.ts` == base `1ab7b625` 未落地、branch `3b7e9a13..HEAD` docs-only、frozen diff sha `118bf104…` `git apply --check` pass + stat 1 檔 +32/−13、isolated temp replay baseline 700→patched 673、ecpay 27→0、REMOVED 27/ADDED 0/non-ecpay removed 0、TS split 7006×18·7018×2·7031×3·7053×4、byte-identical 非恆真 base==patched `04b32226…`11354B、ECPay env keys optional·registry `Record<string,PaymentAdapter>`·checkout/refund/approve call-site compile、payment security clean〕。明示**非 Code Gate / 非 merge / 非 CODING_ALLOWED**）→ ⏳ owner `CODING_ALLOWED`（待明示）
- [x] `CODE_SELF_REVIEW_CLEAN`（2026-06-29、Code 階段；owner `CODING_ALLOWED` → `git apply chiyigo-pr2db.diff` → 明確 stage 僅 `ecpay.ts`〔禁 -A、CLEANUP_PLAN.md 未進〕→ **source commit `b05f4d8a`**〔blob `5f3ebb3b` == frozen target、+32/−13、working diff == frozen byte-for-byte〕。**full replay @ committed〔不沿用 spike〕全綠**：L6 forced tsc 700→**673** REMOVED **27**/ADDED **0**〔per-file ecpay 27→0、含 failopen+integration 兩 tests-leaf〕· L7 byte-identical **非恆真**〔`git show 3b7e9a13:` 未標註 vs `git show HEAD:` 標註、canonical esbuild `--loader=ts --format=esm`〕**11354B `04b32226…`** base==committed IDENTICAL〔非空 sha〕· L8 ratchet baseline 1119/175·current **673/63/272**·`ratchet OK`〔不 --update〕· L11 committed diff == frozen `chiyigo-pr2db.diff` byte-for-byte〔sha `118bf104…`、`diff -q` exit 0〕。**merge-front 7 gates 全綠**：lint〔eslint+compat-date+workflows 0〕· typecheck:ratchet〔673/272〕· verify:browser-pipeline〔25p/214r〕· test:cov〔**90.28%** 1933/2141；payment-types.ts 0%＝0-emit 純型別、不阻擋〕· test:int〔**75 files/1328 passed**、853s；targeted payments-ecpay 23/23〕· build:functions〔Compiled Worker successfully〕· npm audit〔0 vuln〕。**維度 A self-review = L2/L3 multi-agent〔3 readonly-reviewer 並行三維 diff-fidelity / runtime-security / evidence-integrity、繼承 Opus 4.8、read-only〕→ 0 blocking/major/minor + 2 benign INFO**〔dim2：SANDBOX_CREDS 為 ECPay 官方公開 sandbox 測試憑證、base 已存在非本 PR 引入、prod 走 env binding；dim3：commit changeset = ecpay.ts(M)+plan doc(A .md non-source)、source diff == frozen 準確〕。**主線獨立裁決**〔v3.1 §5、非採 subagent raw〕：親跑 L6/L7/L8/L11 + merge-front 7 gates 全綠 → 一輪 0 新發現。review agent 未污染 git〔HEAD `b05f4d8a`、working tree 僅 `?? CLEANUP_PLAN.md`〕。**待送 ③ Codex Code**〔NB：機械核 no-runtime-hunk、anti-curated full hunks 證函式體 byte-unchanged〕）
- [ ] `CODEX_CODE_APPROVED`（③ 維度 C）
- [ ] `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④ 維度 B-code）→ owner `MERGE_ALLOWED`
- [ ] `MERGED_MAIN`（squash-merge --delete-branch；merge-front 重 7 gates；更新 topic receipt + 刪 packets）
