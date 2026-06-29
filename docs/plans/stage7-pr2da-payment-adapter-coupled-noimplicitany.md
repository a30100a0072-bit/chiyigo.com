# Stage 7 PR-2da — PaymentAdapter interface coupled PR: annotate payments spine + webhook noImplicitAny (37 → 0)

> **gate-log 文件**（非 source/scope）。Dual Gate v3.1：任何進 repo 改動（含本 docs 檔）全走 4 道外部審查。

## §0 SPEC（owner directive 2026-06-29 — `SPEC_APPROVED`）

**背景**：payments 域 noImplicitAny 清理的 **DEFERRED coupled spine PR**。PR-2cx（`refund.ts`、#122）scout 實證 `utils/payments.ts`（spine 18 errors）不是 minimal single-file，而是 **payment spine ↔ webhook coupling**：標 `resolvePaymentAdapter(vendor:string)` → 回傳由 `any` 銳化成精確 adapter union `mock|ecpay` → caller `webhooks/payments/[vendor].ts` 的 `.successResponse`/`.failureResponse`/`.code`/`.payment_info`/`.trade_no` 在精確 union 上不存在 → cascade 12 TS2339、FAIL ratchet（OD-1）。owner 當時裁 **DEFER**（拒 A 方案＝spine 放 explicit any），留未來專門 **PaymentAdapter interface coupled PR**。本 PR 即該 deferred PR。

**owner scope 裁定（2026-06-29，+ ChatGPT SPEC 收斂）= Scope-1a（最小 coupled）**：
- **僅改 3 檔**：`functions/utils/payments.ts`（spine，18→0）、`functions/api/webhooks/payments/[vendor].ts`（webhook caller，19→0）、**新增** `functions/utils/payment-types.ts`（純型別契約，emit 0 bytes）。
- **禁碰**（owner 明示 non-goal）：`functions/utils/payment-vendors/ecpay.ts`（27 維持殿後、下一棒）、`functions/utils/payment-vendors/mock.ts`（0、結構 assignable、無需標註）、`types/env.d.ts`、同域 payments 其他檔。
  > 註：owner/ChatGPT SPEC 文字寫 `functions/payment-vendors/{ecpay,mock}.ts`（少 `utils/`）= path typo；實檔在 `functions/utils/payment-vendors/`。以實檔為準（[[feedback_path_typo]] 同 PR-2cs 教訓），「禁改」語意不變。
- **禁新增 explicit `any`**（spine boundary-any 不作預設解；A 方案已否決）。
- **禁改 runtime branch / SQL / CAS / 狀態機 / idempotency / refund / 簽章 / webhook response shape / audit / step-up / scope / rate-limit**。
- **byte-identical emit**（純 type-only；spike 已實證三檔 erase）。
- ratchet：**737 → 700**（REMOVED 37 / ADDED 0）、errorFiles **66 → 64**、cleanFiles **268 → 271**（payments + [vendor] + 新 payment-types 全進 clean）；baseline `1119/175` 凍結（**不** `--update`）。

**OD 裁定（owner + ChatGPT，binding 進 Plan Gate）**：
| OD | 裁定 | 理由 |
|---|---|---|
| interface 位置 | 新檔 `functions/utils/payment-types.ts`（純型別、emit 0） | 避免 payments.ts ↔ adapter 回引 circular import；Env/Request/Response 皆 ambient、本檔無 runtime import |
| OD-2 寫法 | `Record<string, ReadonlySet<string>>` + 空集合 `new Set<string>()` | `before.status` 實測為 `any`（D1=any）；string index sig 吸收 any key、免 cast、byte-identical |
| `WebhookParseResult` 形態 | flat-optional（`ok: boolean` + 其餘 optional） | 現 strict:false 已足；strict:true discriminated-union 留後 |
| mock / ecpay 標註 | **不做** | mock 已 0、結構 assignable；ecpay 殿後；contract 由 `ADAPTERS: Record<string, PaymentAdapter>` registry 行機械強制 |
| `requirePaymentAccess` | 顯式 return type：`user: JWTPayload \| null` + `import type { JWTPayload } from 'jose'`（沿 jwt.ts:29 既有慣例）；`error: Response \| null`；`kyc?:` 維持 derived | **self-review 修正（owner 裁 Option B、2026-06-29）**：原提案 `Awaited<ReturnType<typeof requireAuth>>['user']` **實為 derived-any**（requireAuth 8 條 `{user:null}` 早返在 strict:false widen 成 any、baseline `auth.ts(30/135/164/209/300) TS7018` 為證、union 含 any 塌成 any）→ 改顯式 `JWTPayload \| null`（成功分支真為 verifyJwt 的 jose `JWTPayload`、honest 契約）。**不宣稱整 return type 零 derived-any**：`kyc` 欄參照 getUserKycStatus（未標型、殿後）仍 derived；本 PR 只消 lexical any + user 欄真實化 |

**non-goals（owner 明示，本 PR 不做）**：ecpay.ts cleanup（27 殿後）、mock.ts 標註、strict:true closure fix（見 §5 NB）、任何 runtime / 狀態機 / CAS / idempotency / refund / 簽章 / webhook response 行為變更。

**success criteria**：payments.ts 18 + [vendor].ts 19 = 37 noImplicitAny → 0；PaymentAdapter contract 建立並由 registry 強制；OD-1 cascade 消除（ecpay/mock 不動）；零 runtime change（byte-identical）；ecpay 維持 27（deferred）。

## §1 base / branch（HEAD-independent anchor）

- **base ＝ `9d096b60`**（main HEAD ＝ #124 PR-2cz `admin/requisition-refund` family；`git rev-parse HEAD` 實證 `9d096b60…`；tracked source 對 base 零 diff；untracked 僅 `CLEANUP_PLAN.md` + 本 plan doc）。
- **branch ＝ `refactor/stage7-pr2da-payment-adapter-coupled-noimplicitany`**（off `9d096b60`、未 push）。
- base source blobs（`9d096b60`）：`payments.ts` `023a6cc5`、`[vendor].ts` `8b0d2060`；新檔 `payment-types.ts` base 不存在（new file mode）。
- **plan-only commit 後 `HEAD:src` 兩既存 blob 仍須 == base**（source 零落地，[[feedback_gate_packet_replay_anchor_head_vs_base]]）；新檔在 Code 階段才落地。

## §2 scope：37 noImplicitAny + 修法（3 檔、type-only）

baseline 錯（scout forced `tsc -b … --force` 實證、loc 逐一吻合）：
- `utils/payments.ts` = **18**（**self-review 修正分項**：TS7006 ×11〔env/request/metadata/intentId/vendor param〕 + TS7031 ×4〔updatePaymentStatus 第2參 destructure〕 + TS7053 ×2〔L224 ALLOWED_TRANSITIONS index + L423 ADAPTERS firewall index〕 + TS7018 ×1〔L351 requirePaymentAccess `{user:null}`〕；grep `tsc-baseline.txt` 實證）。
- `webhooks/payments/[vendor].ts` = **19**（TS7031 ×5〔handler L29×3 + handleOrphan L222×2〕 + TS7011 ×2〔L37/L155 `.catch(()=>null)` arrow〕 + TS7006 ×12〔markWebhookEventApplied/Failed/mergeMetadata/sha256Hex/dlqInsert helper params〕）。**全本地 param/arrow、零 `adapter.*`/`parsed.*` TS2339**（cascade 只在 spine 銳化後才現）。
- `payment-vendors/ecpay.ts` = **27**（禁碰、殿後）；`payment-vendors/mock.ts` = **0**（禁碰）。

**修法（3 檔、全 type-only、frozen diff 見 §4）**：

1. **`payment-types.ts`（新、純型別、emit 0）**：`WebhookParseResult`（flat-optional）+ `PaymentAdapter`（`parseWebhook(request: Request, env: Env): Promise<WebhookParseResult>` + optional `successResponse?`/`failureResponse?`）。無 runtime import（Env/Request/Response ambient）。
2. **`payments.ts`（18→0）**：`import type { PaymentAdapter } from './payment-types'` + `import type { JWTPayload } from 'jose'`〔OD-3 Option B〕；param 標註（`sanitizeMetadata(metadata: unknown)`、`createPaymentIntent(env: Env)`、`getPaymentIntent(env: Env)`、`updatePaymentStatus(env: Env, {…}: {…})`、`lockIntentForRefund(env: Env, intentId: number\|string)`、`unlockIntentToSucceeded(env: Env, intentId: number\|string)`、`requirePaymentAccess(request: Request, env: Env)` + 顯式 return type `{ user: JWTPayload \| null; error: Response \| null; kyc?: Awaited<ReturnType<typeof getUserKycStatus>> }`〔OD-3 Option B〕）；**OD-2** `ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>>` + 3 空集合 `new Set<string>()`；**registry** `ADAPTERS: Record<string, PaymentAdapter>` + `resolvePaymentAdapter(vendor: string): PaymentAdapter | null`。
3. **`[vendor].ts`（19→0）**：handler `onRequestPost({…}: { request: Request; env: Env; params: Record<string, string> })`；helper params（`markWebhookEventApplied`/`markWebhookEventFailed`/`mergeMetadata`/`sha256Hex`/`dlqInsert`/`handleOrphan` inline 型）；2 個 arrow `(): null => null`。`adapter.*`/`parsed.*` 由 `resolvePaymentAdapter` 回 `PaymentAdapter|null` + `WebhookParseResult` 自動 typecheck（optional 成員）→ 零 cascade。

## §3 OD analysis — 3 個 OD（spike 實證解法）

### OD-1（cascade）✅ 解 = PaymentAdapter interface

- **機制**：mock 只有 `parseWebhook`（return shape 無 `code`/`payment_info`/`trade_no`）；ecpay 有 `parseWebhook` + `successResponse()` + `failureResponse()`（return shape 有上述三欄）。raw union `typeof mock | typeof ecpay` 上存取上述五類成員 = 12 TS2339（dual-leaf 雙倍）。
- **解**：`PaymentAdapter` interface 把 `successResponse`/`failureResponse` 設 **optional**、`WebhookParseResult` 把所有 vendor-specific 欄位設 **optional**。`resolvePaymentAdapter` 回 `PaymentAdapter | null`（非 raw union）→ `[vendor].ts` 的 `typeof adapter.successResponse === 'function'` guard narrow optional、`parsed.code`/`.payment_info`/`.trade_no` 對 optional 欄位合法存取 → **零 cascade**。
- **mock/ecpay 無需標註**：`ADAPTERS: Record<string, PaymentAdapter>` 對 mockPaymentAdapter/ecpayPaymentAdapter 做**結構 assignability** 檢查（spike 實證通過、ADDED=0）；契約由此 registry 行機械強制（adapter drift → 此行 TS2322/2345）。故 ecpay 殿後（27 不動）、mock 不標、契約仍守。

### OD-2（`ALLOWED_TRANSITIONS` TS7053）✅ 解 = `Record<string, ReadonlySet<string>>`

- **⚠ 記憶修正**：PR-2cx scout 記憶寫「clean form＝`Record<PaymentStatus, ReadonlySet<string>>` 無需 cast」**為未驗證的錯誤假設**。spike 實證：標 `Record<PaymentStatus,…>` 後 TS7053 **仍在**（訊息 "expression of type **'any'** can't be used to index type 'Record<PaymentStatus, ReadonlySet<string>>'"）——`Record<literal-union, V>` 展開為有限 key 物件、**無 string index signature**，`before.status`（D1=any）的 `any` key 索引仍 TS7053。
- **真解**：`Record<string, ReadonlySet<string>>`（**string index sig**）→ `any` key 索引回 `ReadonlySet<string>`、無 TS7053；3 個空集合改 `new Set<string>()`（element=string、assignable to `ReadonlySet<string>`、且 `.has(status: string)` 合法）。非空集合 `Set<'processing'|…>` covariant assignable to `ReadonlySet<string>`、無需改。byte-identical（型別標註 + `<string>` type-arg 皆 erase）。
- **取捨**：`Record<string,…>` 失去 key 完整性（不強制 6 status 齊全），但物件字面值仍含全 6 computed key、runtime `if (!allowed || …)` 已防 undefined；vs `Record<PaymentStatus,…>` + `before.status as PaymentStatus`（保完整性但 cast untrusted any）。owner 裁 `Record<string,…>`（免 cast）。

### OD-3（`requirePaymentAccess` L351 TS7018）✅ 解 = 顯式 return type（**Option B、owner 裁 2026-06-29**）

- **機制**：`requirePaymentAccess` 無 return type → 早返 `{ user: null, error }` 的 `user: null` 無 contextual type → TS7018。
- **⚠ self-review 修正（維度 A dim1 MAJOR + dim3 MEDIUM 命中、主線獨立驗證；dim2 此點誤判「pass」只看成功分支）**：原提案 `user: Awaited<ReturnType<typeof requireAuth>>['user']` 宣稱 = `JWTPayload | null`、零 any，**實證為假**——`requireAuth`（`auth.ts`、**非本 PR scope**）8 條 `{ user: null }` 早返在 strict:false（strictNullChecks off）下 widen 成 any（baseline `auth.ts(30/135/164/209/300) TS7018` 實證）→ `ReturnType<typeof requireAuth>['user']` = `any | JWTPayload` = **`any`**（union 含 any 塌成 any；dim3 `IsAny<U>` probe = true）。原寫法只消 TS7018、不引入 *lexical* any，但 `user` 實為 **derived-any**。
- **解（owner Option B）**：顯式 `user: JWTPayload | null`（+ `import type { JWTPayload } from 'jose'`、沿 `jwt.ts:29` 既有慣例）。成功分支 `{ user: payload }` 的 payload 真為 verifyJwt 回的 jose `JWTPayload`（`jwt.ts:180-181`）→ 標 `user: JWTPayload | null` 為 **honest 契約**（caller 拿真 `user.sub` 等型別）；早返 `{ user: null }` 與 `{ user(any), error: null }` 皆 assignable（any → JWTPayload|null）。byte-identical（import type + return type erase、emit 同 10014B/`2113e620`、實證）。
- **誠實邊界（不過度宣稱）**：return type 的 `kyc?: Awaited<ReturnType<typeof getUserKycStatus>>` **仍 derived**（getUserKycStatus 未標型、final return `level/vendor/expires_at` 來自 D1 row=any、殿後）→ **本 PR 不宣稱整 return type 零 derived-any**，僅消 lexical any + `user` 欄真實化。`kyc` shape 不顯式化（owner 裁不採 Option C：避免複製 getUserKycStatus 定義 drift + 對 D1 any row 做型別斷言）。`requireAuth` 標型留殿後 baton。

### 其他 typing 決策（非新 OD，但 gate 須知）

- `sanitizeMetadata(metadata: unknown)`：`unknown` 保既有 `typeof metadata !== 'object'` guard 意義（沿 mock.ts `constantTimeEq` OD-A 慣例）。
- `[vendor].ts` `dlqInsert` row / `handleOrphan` liveIntent / `mergeMetadata` patch：inline 物件型（matching DLQ row 欄位 / intent 子集 / `Record<string, unknown>`），erase；非 spine、無 any。
- `[vendor].ts` 2 arrow `(): null => null`：TS7011 根因 = `.catch(onrejected)` 的 contextual return 在現環境不足以推斷 → 顯式 return type 補；erase（byte-identical 已證）。

## §4 scout evidence（non-commit spike、已 `git checkout --` 還原；branch 重套復現）

- **current ratchet 實跑驗證（非記憶）**：forced `tsc -b tsconfig.solution.json --force` @ `9d096b60` → file-errors **737** / global **0**（== ratchet errorCount 737、errorFiles 66、cleanFiles 268）。
- 套 §2 三檔 edit → forced full-solution build sort-diff vs 737 baseline（loc+code 粒度 `comm`）：
  - **REMOVED ＝ 恰 37**（payments.ts 18 + [vendor].ts 19 全清）。
  - **ADDED ＝ 0**（零 cascade，含 [vendor].ts adapter union 面、ecpay/mock 不動面、tests-leaf、全樹）。
  - raw 總數 **737 → 700**；per-file：payments.ts 18→**0**、[vendor].ts 19→**0**、ecpay.ts 27→**27**（不變）、mock.ts 0→**0**、payment-types.ts **0**（新）。
  - **branch 重套復現實證**：同 base `9d096b60`、套 frozen diff → forced tsc 同得 700 / REMOVED 37 / ADDED 0（reproducible）。
- ratchet after：errorCount **700** / errorFiles **64**（payments + [vendor] 離 errorFiles）/ cleanFiles **271**（payments + [vendor] + 新 payment-types 入 clean）；baseline `1119/175` 凍結。
- **OD-1 cascade-safe 實證**：[vendor].ts 19 baseline 錯全本地 param/arrow（無 `adapter.*`/`parsed.*` TS2339）；spike 套 interface 後 `adapter.successResponse`/`.failureResponse` + `parsed.code`/`.payment_info`/`.trade_no` 全對 optional 成員 typecheck 通過、零新錯。`webhooks/payments/[vendor].ts` 自身 19→0（非 19→31 cascade）。
- **mock/ecpay 結構 assignability 實證**：`ADAPTERS: Record<string, PaymentAdapter> = { mock, ecpay }` 未報 TS2322/2345（ecpay parseWebhook 內部 any param 不阻 assignability、return union assignable to WebhookParseResult；mock narrower shape assignable）→ ecpay 27 不動仍 typecheck、mock 0 不動仍 typecheck。
- **D1=any 確認**：`before.status`/`intent.*` 標 `env:Env` 後維持 `any`（`env.chiyigo_db` D1Database 無 `@cloudflare/workers-types` 解為 any，[[feedback_d1database_resolves_any_no_workers_types]]）→ 無大範圍 unknown cascade。
- **byte-identical emit 實證**（canonical recipe `esbuild --loader=ts --format=esm` stdin；**base 端 pin `9d096b60` 未標註 blob、head 端 = 標註版**，非 HEAD-vs-HEAD 恆真比對〔[[feedback_byte_identical_emit_verification]]〕；stderr 皆空、sha ≠ 空字串 sha `e3b0c442…`）：

  | 檔 | base blob | head blob | base emit | head emit | 結論 |
  |---|---|---|---|---|---|
  | `payments.ts` | `023a6cc5` | `f0ec0d92`〔Option B〕 | 10014B `2113e620…` | 10014B `2113e620…` | IDENTICAL |
  | `[vendor].ts` | `8b0d2060` | `dd284160` | 15791B `df30c7f5…` | 15791B `df30c7f5…` | IDENTICAL |
  | `payment-types.ts` | — (new) | `a1a1b22e` | — | **0 bytes** | 純型別、無 runtime |

  payments/[vendor] base==head 同 byte 同 sha → type annotation 全 erase；payment-types emit 0 bytes → 純型別契約、零 runtime。**整 PR = 零 runtime change**。

- **dual-leaf**：payments.ts/[vendor].ts 皆經 `tsconfig.functions.json`（noImplicitAny:true）+ `tsconfig.tests.json`（noImplicitAny:false）兩 leaf 編譯。37 錯皆 TS70xx〔functions-leaf only、單算〕；若 interface 引入任何 TS2339/TS2345 會 dual-leaf 雙倍 → spike ADDED=0 證**無**此類新錯（含 tests-leaf）。

### frozen diff（git-format，spike 實取、branch 重套；`git diff --check` exit 0、`--stat` 3 檔 **+81/−24**〔Option B：payments 29/15 含 jose import、[vendor] 22/9、payment-types 30/0〕；authoritative = `chiyigo-pr2da-B.diff`）

```diff
diff --git a/functions/api/webhooks/payments/[vendor].ts b/functions/api/webhooks/payments/[vendor].ts
index 8b0d2060..dd284160 100644
--- a/functions/api/webhooks/payments/[vendor].ts
+++ b/functions/api/webhooks/payments/[vendor].ts
@@ -29 +29 @@
-export async function onRequestPost({ request, env, params }) {
+export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
@@ -37 +37 @@
-  const rawBody = await request.clone().text().catch(() => null)
+  const rawBody = await request.clone().text().catch((): null => null)
@@ -155 +155 @@
-    ? await sha256Hex(parsed.raw_body).catch(() => null)
+    ? await sha256Hex(parsed.raw_body).catch((): null => null)
@@ -222 +222 @@
-  async function handleOrphan({ liveIntent, reason }) {
+  async function handleOrphan({ liveIntent, reason }: { liveIntent: { id?: number | string | null; user_id?: number | string | null; deleted_at?: string | null } | null; reason: string }) {
@@ -485 +485 @@
-async function markWebhookEventApplied(env, vendor, eventId) {
+async function markWebhookEventApplied(env: Env, vendor: string, eventId: string) {
@@ -493 +493 @@
-async function markWebhookEventFailed(env, vendor, eventId) {
+async function markWebhookEventFailed(env: Env, vendor: string, eventId: string) {
@@ -502 +502 @@
-async function mergeMetadata(env, intentId, patch) {
+async function mergeMetadata(env: Env, intentId: number | string, patch: Record<string, unknown>) {
@@ -516 +516 @@
-async function sha256Hex(s) {
+async function sha256Hex(s: string) {
@@ -525 +525 @@ (multi-line)
-async function dlqInsert(env, row, { strict = false } = {}) {
+async function dlqInsert(
+  env: Env,
+  row: {
+    vendor?: string | null
+    event_id?: string | null
+    vendor_intent_id?: string | number | null
+    raw_body?: string | null
+    payload_hash?: string | null
+    error_stage?: string
+    error_message?: string
+    http_status_returned?: number | null
+  },
+  { strict = false }: { strict?: boolean } = {},
+) {

diff --git a/functions/utils/payment-types.ts b/functions/utils/payment-types.ts
new file mode 100644
index 00000000..a1a1b22e
--- /dev/null
+++ b/functions/utils/payment-types.ts
@@ -0,0 +1,30 @@ (full new file — see §2.1 / scratchpad)
+export interface WebhookParseResult { ok: boolean; error?: string; code?: string; event_id?: string;
+  vendor_intent_id?: string; user_id?: number | null; status?: string; amount_subunit?: number | null;
+  amount_raw?: string | null; currency?: string | null; failure_reason?: string | null;
+  payment_info?: Record<string, unknown> | null; trade_no?: string | null; raw_body?: string }
+export interface PaymentAdapter { parseWebhook(request: Request, env: Env): Promise<WebhookParseResult>;
+  successResponse?(extra?: { deduplicated?: boolean }): Response; failureResponse?(reason?: string): Response }

diff --git a/functions/utils/payments.ts b/functions/utils/payments.ts
index 023a6cc5..f0ec0d92 100644
--- a/functions/utils/payments.ts
+++ b/functions/utils/payments.ts
@@ -21,6 +21,8 @@
+import type { PaymentAdapter } from './payment-types'
+import type { JWTPayload } from 'jose'                  (OD-3 Option B)
@@ -69 +70 @@
-function sanitizeMetadata(metadata): Record<string, unknown> | null {
+function sanitizeMetadata(metadata: unknown): Record<string, unknown> | null {
@@ -105 +106 @@
-export async function createPaymentIntent(env, payload: CreatePaymentIntentPayload = {}) {
+export async function createPaymentIntent(env: Env, payload: CreatePaymentIntentPayload = {}) {
@@ -144 +145 @@
-  env,
+  env: Env,                            (getPaymentIntent)
@@ -179 +180 @@
-const ALLOWED_TRANSITIONS = {
+const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
@@ -183..185 +186..188 @@
-  [PAYMENT_STATUS.FAILED]:     new Set(),
-  [PAYMENT_STATUS.CANCELED]:   new Set(),
-  [PAYMENT_STATUS.REFUNDED]:   new Set(),
+  [PAYMENT_STATUS.FAILED]:     new Set<string>(),
+  [PAYMENT_STATUS.CANCELED]:   new Set<string>(),
+  [PAYMENT_STATUS.REFUNDED]:   new Set<string>(),
@@ -206 +207 @@  (updatePaymentStatus — env: Env + 2nd-param inline type, multi-line)
@@ -302 +311 @@
-export async function lockIntentForRefund(env, intentId) {
+export async function lockIntentForRefund(env: Env, intentId: number | string) {
@@ -320 +329 @@
-export async function unlockIntentToSucceeded(env, intentId) {
+export async function unlockIntentToSucceeded(env: Env, intentId: number | string) {
@@ -345 +354 @@  (requirePaymentAccess — request: Request, env: Env + explicit return type Promise<{ user: JWTPayload | null; error: Response | null; kyc?: Awaited<ReturnType<typeof getUserKycStatus>> }>) — OD-3 Option B
@@ -415 +428 @@
-const ADAPTERS = {
+const ADAPTERS: Record<string, PaymentAdapter> = {
@@ -422 +435 @@
-export function resolvePaymentAdapter(vendor) {
+export function resolvePaymentAdapter(vendor: string): PaymentAdapter | null {
```

> 完整 byte-for-byte frozen diff（含 multi-line `updatePaymentStatus`/`requirePaymentAccess`/`dlqInsert` 全 hunk + 新檔全文）= Code Gate packet `chiyigo-pr2da-B.diff`（authoritative）。本 §4 為人審摘要；Code 階段 committed diff 必與 authoritative frozen diff byte-for-byte 對齊（L-parity）。

## §5 security / 風險（Tier-0 金流 spine + webhook、first-do-no-harm）

| 檔 | 角色 | 紅線（typing 全程不得牽動）|
|---|---|---|
| `payments.ts` | **金流 spine**（D1 thin wrapper + gate + 狀態機 + refund lock + adapter registry）| `ALLOWED_TRANSITIONS` 狀態機合法轉移、`updatePaymentStatus` structured outcome（applied/same_status/no_row/illegal_transition）+ illegal-transition critical audit + CAS UPDATE…WHERE status=before、`lockIntentForRefund` succeeded→processing atomic CAS + `unlockIntentToSucceeded`、`createPaymentIntent` metadata allowlist + UNIQUE、`getPaymentIntent` soft-delete 預設過濾、`requirePaymentAccess` KYC gate + enhanced level、`resolvePaymentAdapter` registry |
| `[vendor].ts` | **webhook 入口**（PSP 通知、cross-system JSON contract）| 簽章驗證（adapter.parseWebhook）+ 金額/幣別雙閘門、dedupe + single-applier 三態 claim（INSERT OR IGNORE + CAS）、in-flight conflict 回 failure、orphan/soft-deleted/PSP-direct 分流、illegal_transition/CAS-lost skipSuccessTail、payment_info/trade_no metadata merge、markApplied/markFailed + DLQ strict、critical audit |
| `ecpay.ts` / `mock.ts` | union member | **禁碰**（ecpay 27 殿後；mock 0 結構 assignable）|

- 本 PR ＝ **type-only**（含新 interface 契約）；byte-identical emit（§4：payments 10014B / [vendor] 15791B base==head、payment-types 0B）→ **零 runtime change** → 上列所有狀態機 / CAS / idempotency / 簽章 / 金額閘門 / dedupe / DLQ / audit / step-up / scope 邏輯**完全不動**、可證。
- **高風險領域（Payment + 跨系統 JSON contract）對齊**：`WebhookParseResult` 是 PSP webhook normalized payload 的**描述性 typing**（descriptive、非新契約）——formalize 既有 runtime shape（mock/ecpay parseWebhook 已回此形），flat-optional 對齊既有防禦式存取（`parsed.amount_subunit != null` 等）；byte-identical 證 parse/dedupe/idempotency/狀態機行為不變。`PaymentAdapter` 契約由 `ADAPTERS: Record<string, PaymentAdapter>` registry 行機械強制（取代 PR-2ct OD-A 的 local-only 標註、解誠實債）。
- 零 cascade（scout 實證）→ ecpay/mock/env.d.ts/同域 payments 其他檔皆不動、不引入 any。
- **impl L2/L3（新 interface 契約 + spine/webhook 標註）/ review care L3**：payment spine + webhook 為 Tier-0，**不因 byte-identical 而降低外部審查強度**，走完整 4 道外部審查；self-review form ＝ **L2/L3 multi-agent workflow**（payments 熱區、不降單 agent）。
- **NB（strict:true follow-up、非本 PR 引入、byte-identical 不變、out of scope）**：`[vendor].ts` L43 `(extra) => adapter.successResponse(extra)` 在 closure 內對 optional `successResponse` 為 possibly-undefined invocation；現 strict:false（strictNullChecks off）不報、byte-identical 不變；strict:true 階段需處理（明列、不混入本 PR）。

## §6 verification plan

- **byte-identical（L7）**：canonical `esbuild --loader=ts --format=esm`（stdin、Git Bash）對 **base `9d096b60` 未標註 blob vs 已標註 committed blob** 比對 sha（[[feedback_byte_identical_emit_verification]]；**禁 HEAD-vs-HEAD 恆真式**）— scout 已證 payments 10014B/`2113e620…`、[vendor] 15791B/`df30c7f5…`、payment-types 0B；Code 階段 commit 後以 `9d096b60` 為 base 重播確認。
- **full-solution sort-diff（L6）**：Code 階段（commit 後）重跑 forced `tsc -b … --force`，對 737 baseline sort-diff → 必 **REMOVED 恰 37 / ADDED 0**（含 [vendor].ts adapter 面、ecpay/mock 不動面、tests-leaf）；ADDED 非空 → 回 gate 重審、禁自擴 scope。per-file 必：payments.ts 0、[vendor].ts 0、ecpay.ts 27、mock.ts 0、payment-types.ts 0。
- **ratchet**：`RATCHET_BASE_REF=9d096b60 npm run typecheck:ratchet` → 期望 current **700 / 271**（errorFiles 64）；baseline 不動（**不** `--update`）。
- **merge-front 7 gates（對齊 CI `.github/workflows/ci.yml`）**：`lint`（含 `@typescript-eslint/no-explicit-any` — 本 PR 零 **lexical** any；OD-3 kyc derived-any 非 lexical、不觸此 lint）· `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int`（含 `payments.test.ts` + webhook/payment integration、含 ecpay/mock adapter 路徑）· `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **NB-2 雙證**：Code 階段報告**同時列**「三檔 base vs patched emit byte-identical（sha + bytes）」與「source diff（`git diff` 逐行 == authoritative frozen diff）」，不以 ratchet 數字單獨替代行為保證。
- **staged set**：僅 3 source 檔（payments.ts / [vendor].ts / 新 payment-types.ts）+ 本 plan doc；**禁** `git add -A`、`CLEANUP_PLAN.md` 不進 commit。
- **authoritative landing blobs（Code Gate L11 對齊 `chiyigo-pr2da-B.diff`〔Option B〕）**：`payments.ts` `f0ec0d92`、`[vendor].ts` `dd284160`、`payment-types.ts` `a1a1b22e`（⚠ M-2：勿用 scratchpad `payment-types.ts.spike`〔blob `0e5ee200`、註解 stale、非 authoritative〕）。
- **硬驗收**：source diff 與 authoritative frozen diff **byte-for-byte 一致**（人審 `git diff --stat` 僅 3 檔 **+81/−24**）；超出 = scope creep = Gate fail。

## §7 Binding locks（① ChatGPT Arch `CHATGPT_ARCH_APPROVED_WITH_LOCKS`、2026-06-29、binding）

ChatGPT Architecture Gate 裁 `APPROVED_WITH_LOCKS`（**0 blocker / 0 required revision / 4 added locks L13-L16**；架構上可進 Codex Plan Gate ②、**非 merge 授權、非 code correctness 最終裁決**）。A1-A7 全 APPROVE/APPROVE_WITH_LOCK（A1 payment-types 位置 / A2 registry 契約強制〔限收斂、非 adapter leaf 完工〕/ A3 flat-optional descriptive〔不宣稱新 runtime contract〕/ A4 optional methods / A5 OD-2 `Record<string>`〔接受實測、鎖 status set〕/ A6 OD-3 Option B / A7 cascade-safe Scope-1a）。L1-L12 self-proposed 全採納 + 新增 L13-L16；全部已被本 plan 滿足（codify、無 plan 邏輯變更、byte-identical 保證）。

- **L1 Scope**：僅 3 source（payments.ts / [vendor].ts / 新 payment-types.ts）；diff byte-for-byte == authoritative frozen diff；plan doc 只可更新 gate log。
- **L2 Runtime hot-zone**：不改狀態機 / CAS / idempotency / 簽章 / 金額閘門 / dedupe / DLQ / orphan / audit / step-up / scope / rate-limit / response shape / SQL；byte-identical 證。
- **L3 排除檔**：禁碰 `payment-vendors/ecpay.ts`（殿後）/ `payment-vendors/mock.ts` / `env.d.ts` / 同域 payments 其他檔。
- **L4 No lexical any**：spine/webhook 禁 *lexical* explicit `any`、禁 `as any` 雙 cast（ratchet/eslint no-explicit-any 機械 enforce）；interface 用 optional + `unknown`/`Record<string, unknown>`；boundary-any 不作預設解。⚠ 上游未標型依賴（requireAuth/getUserKycStatus）帶入的 **derived-any**（OD-3 kyc 欄）非 lexical any、非本 PR 引入、屬殿後 baton；plan 誠實標示、不偽稱整體零 derived-any（self-review 修正）。
- **L5 OD-2**：`Record<string, ReadonlySet<string>>` + `new Set<string>()`；不引入 `before.status as PaymentStatus` cast。
- **L6 OD-3（Option B、owner 裁）**：`requirePaymentAccess` 顯式 return type `user: JWTPayload | null`（+ `import type { JWTPayload } from 'jose'`、沿 jwt.ts:29 慣例）；`kyc?:` 維持 derived（誠實標示、不複製 getUserKycStatus shape、不採 Option C）；不改 requireAuth。委 lexical any → L4。
- **L7 Contract enforcement**：`ADAPTERS: Record<string, PaymentAdapter>` 為 contract 機械強制點；不標註 mock/ecpay（殿後/結構 assignable）。
- **L8 sort-diff**：Code 階段必重跑；只接受 REMOVED 恰 37 / ADDED 0；per-file payments 0/[vendor] 0/ecpay 27/mock 0。
- **L9 byte-identical**：Code 階段必以 base `9d096b60` 未標註 blob vs committed 標註 blob 重證 payments/[vendor] emit identical、payment-types 0B。
- **L10 Ratchet baseline**：不得 `--update`；只接受 737→700 / 66→64 / 268→271 方向。
- **L11 Source landing parity**：committed diff 必與 authoritative frozen diff byte-for-byte；額外 hunk → 回 Plan Gate。
- **L12 高風險領域**：webhook = cross-system JSON contract；`WebhookParseResult` 為描述性 typing、非新契約；payment 狀態機/idempotency/dedupe 行為由 byte-identical 保證不變。
- **L13（新、Arch ①）WebhookParseResult 非 ok:true 必填契約**：欄位不得被當成 `ok:true` 必填；caller 既有 null/undefined guard（`!= null`/`?? null`/`&&`）不得移除。〔履行：byte-identical → caller body 不變〕
- **L14（新、Arch ①）ALLOWED_TRANSITIONS 語義鎖**：物件字面值既有 status key / value / transition set 不得新增/刪除/改名/重排語義。〔履行：本 PR 僅加型別標註 + 3 空集合 `new Set<string>()` type-arg；6-key set 與非空 Set 內容不變、byte-identical 證 runtime 不變〕
- **L15（新、Arch ①）optional method 不得壓錯**：`successResponse?`/`failureResponse?` 不得用 `!`、cast、或新增 runtime fallback。〔履行：frozen diff 不碰 `successFn`/`adapter.successResponse`/`adapter.failureResponse` guard 行（既有 `typeof … === 'function'`）、byte-identical 證〕
- **L16（新、Arch ①）strict:true closure 只列 follow-up**：[vendor].ts L43 closure possibly-undefined 只可列 follow-up（§5 NB）、不得混入本 PR 修。

## §8 gate trail（state 隨進度更新）

- [x] `SPEC_APPROVED`（owner directive 2026-06-29 + ChatGPT SPEC 收斂：Scope-1a；OD 裁定 §0 表；non-goals = ecpay/mock/strict-closure/runtime 全不動）
- [x] `PLAN_SELF_REVIEW_CLEAN`（2026-06-29、L2/L3 multi-agent workflow self-review〔payments 熱區、**3 readonly-reviewer 並行三維** scope-fidelity / runtime-security / evidence-integrity、繼承 Opus 4.8、read-only〕。**一輪發現 1 MAJOR + 2 minor**，主線獨立裁決後全處置：**OD-3 MAJOR**〔dim1+dim3 命中、**dim2 誤判 pass→證主線不採 subagent raw 必要**〕＝原 `Awaited<ReturnType<typeof requireAuth>>['user']` **實為 derived-any、非 JWTPayload|null**〔baseline `auth.ts` TS7018 ×5 + dim3 `IsAny` probe 實證、union 含 any 塌成 any〕→ **owner 裁 Option B**〔顯式 `user: JWTPayload | null` + `import type{JWTPayload}from'jose'`；empirically 700/REMOVED 37/ADDED 0/byte-identical 10014B`2113e620`、payments blob `654ec854→f0ec0d92`〕；**M-1**〔minor〕§2 payments.ts TS-code 分項錯 → 修為 TS7006×11/7031×4/7053×2/7018×1；**M-2**〔minor〕scratchpad spike blob ≠ authoritative → Code Gate 落地 `chiyigo-pr2da-B.diff` 版〔payment-types `a1a1b22e`〕。**主線獨立驗證 CONFIRMED**：737→700 / REMOVED 37 / ADDED 0〔含 tests-leaf dual-leaf〕· OD-1 cascade-safe〔mock/ecpay 結構 assignable、ecpay 27 不變〕· OD-2 記憶修正〔`Record<PaymentStatus>` 仍 TS7053、須 `Record<string>`〕· byte-identical 非恆真〔base `9d096b60` 未標註 vs head〕· **Option B caller 零 breakage**〔ADDED 0 含 requirePaymentAccess 全 caller〕。Option B delta〔2-line、單檔〕依 Dual Gate workflow §9 回路節流主線單-agent 複驗 → 一輪 0 新發現。review agent 未污染 git〔HEAD `9d096b60`、源未動、實測在 scratchpad 複本〕）
- [x] `CHATGPT_ARCH_APPROVED`（① 維度 B、2026-06-29、`APPROVED_WITH_LOCKS`：0 blocker / 0 required revision / **4 added locks L13-L16**〔§7〕；A1-A7 全 APPROVE/APPROVE_WITH_LOCK；確認**無 DB migration**〔純 type-only、不適用 expand/migrate/contract〕。明示非 merge 授權、非 code correctness 最終裁決）
- [x] `CODEX_PLAN_APPROVED`（② 維度 C、2026-06-29、**r2 `APPROVED`**；r1 `CHANGES_REQUESTED` = 純 evidence-integrity doc-consistency〔frozen diff 名稱混用 → 全 canonical `chiyigo-pr2da-B.diff`〔4 處〕；§6 硬驗收 `+80`→`+81`；packet line-count 宣稱移除〕、**source-plan logic 零變更**、主線單-agent 複驗修正〔Dual Gate workflow §9 回路節流〕→ plan-only `cddb701f` + r2 delta packet 重送。**r2 Codex 親驗全綠**：cddb701f plan-only〔source == base〕· 737→700 · REMOVED37/ADDED0 · per-file payments0·[vendor]0·ecpay27·mock0·types0 · byte-identical 10014B`2113e620`·15791B`df30c7f5`·0B〔stderr 0〕· landing blobs `f0ec0d92`·`dd284160`·`a1a1b22e` · ratchet 700·64·271 · OD-2 probe `Record<PaymentStatus>` 復現 TS7053 · OD-3 auth.ts TS7018 + patched ADDED0 · **added-line lexical any scan 0**。明示**非 Code Gate / 非 merge / 非 CODING_ALLOWED**）→ ⏳ owner `CODING_ALLOWED`（待明示）
- [ ] `CODE_SELF_REVIEW_CLEAN`（Code 階段；apply frozen diff → 明確 stage 3 source〔禁 -A〕→ full replay 重證 L6/L7/L8 + merge-front 7 gates）
- [ ] `CODEX_CODE_APPROVED`（③ 維度 C）
- [ ] `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④ 維度 B-code）→ owner `MERGE_ALLOWED`
- [ ] `MERGED_MAIN`（squash-merge --delete-branch；merge-front 重 7 gates；更新 topic receipt + 刪 packets）
