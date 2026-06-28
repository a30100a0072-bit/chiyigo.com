# Stage 7 PR-2cz — annotate `admin/requisition-refund` family noImplicitAny (14 → 0)

> **gate-log 文件**（非 source/scope）。Dual Gate v3.1：任何進 repo 改動（含本 docs 檔）全走 4 道外部審查。

## §0 SPEC（owner directive 2026-06-29 — `SPEC_APPROVED`）

**背景**：payments 域 noImplicitAny 清理。PR-2cy（`admin/payments/intents/[id]/delete.ts`、#123 `3da9b947`）SHIPPED 後，owner 指定**下一棒 = requisition-refund family**（admin 退款申請流程三檔，皆 handler-context TS7031 形態）。`utils/payments.ts`（spine 18 errors）已於 PR-2cx scout 實證 spine+webhook cascade → owner 裁 DEFER，留未來專門 **PaymentAdapter interface coupled PR**（範圍：`utils/payments.ts` + adapter registry + `mock/ecpay` + `webhooks/payments/[vendor].ts`、0 any），**非本 PR scope**。

**C-1 batch 範圍（owner 2026-06-29 確認）**：scout 實證三檔皆「Convention A + 0 cascade + 無 Path-A + 無 OD + byte-identical」→ owner 裁 **三檔一棒 domain-batch**（非拆 approve.ts）。precedent：PR-2cv（admin-ops 三檔 13-錯 batch、#119 前置）、PR-2cx 形態。

**⚠ 不可假設同 delete.ts / refund.ts（delete.ts M-教訓）**：本批含 `approve.ts` ＝ **Tier-0 退款執行端**（import 已 DEFER 的 `utils/payments` spine 五個 export + `ecpayRefund`、呼 ECPay + 三表同步 + 雙層 CAS），形態雖近 `refund.ts` #122 但 **body / import 面更廣**。本 PR **逐檔獨立 spike**（§4），**不沿用** refund.ts/delete.ts 結論，實證 approve.ts 對 DEFER spine 的 import **零 cascade**（含殿後檔 `webhooks/payments/[vendor].ts`）。

**scope（owner lock）**：
- 僅三 source 檔：`functions/api/admin/requisition-refund.ts`（list）、`functions/api/admin/requisition-refund/[id]/approve.ts`、`functions/api/admin/requisition-refund/[id]/reject.ts`。
- **禁碰** `functions/utils/payments.ts`、`payment-vendors/ecpay.ts`、`webhooks/payments/[vendor].ts`、`types/env.d.ts`、adapter registry、mock/ecpay、同域 payments 其他檔。
- **禁新增 explicit `any`**（payment spine boundary-any 不作預設解）。
- **禁改 runtime branch / SQL / CAS / response shape / audit / step-up / scope gate / rate-limit**。
- **byte-identical emit**（純 type-only）。
- ratchet：**751 → 737**（REMOVED 14 / ADDED 0）、cleanFiles **265 → 268**、errorFiles **69 → 66**；baseline `1119/175` 凍結（**不** `--update`）。

**success criteria**：三檔 14 noImplicitAny→0、全進 cleanFiles、零 runtime change、零 cascade（含 Tier-0 approve.ts 對 DEFER spine import）。

## §1 base / branch（HEAD-independent anchor）

- **base ＝ `3da9b947`**（main HEAD ＝ #123 PR-2cy `admin/payments/intents/[id]/delete.ts`；`git rev-parse HEAD` 實證 `3da9b947…`、tracked source 對 base 零 diff；untracked 僅 `CLEANUP_PLAN.md` + 本 plan doc〔plan-only commit 前的預期狀態，commit 後回歸僅 `CLEANUP_PLAN.md`〕）。
- **branch ＝ `refactor/stage7-pr2cz-admin-requisition-refund-noimplicitany`**（off `3da9b947`、未 push）。
- base source blobs：list `7fcaa694`、approve `a8418f21`、reject `18d39e63`；plan-only commit 後 `HEAD:src` 三 blob 仍須 == base（source 零落地，[[feedback_gate_packet_replay_anchor_head_vs_base]]）。

## §2 scope：14×TS7031 + 修法（6 edits、type-only）

三檔 14 個 noImplicitAny 錯**皆 TS7031**（handler context destructure binding element 未標型；scout forced tsc 實證、loc 逐一吻合）：

| 檔 | 現狀 err | handler / loc | 變更 |
|---|---|---|---|
| `admin/requisition-refund.ts`（list）| 4 | `onRequestOptions`(L37,42/L37,51) · `onRequestGet`(L41,38/L41,47) | 2 行改 |
| `admin/requisition-refund/[id]/approve.ts` | 5 | `onRequestOptions`(L37,42/L37,51) · `onRequestPost`(L41,39/L41,48/L41,53) | 2 行改 |
| `admin/requisition-refund/[id]/reject.ts` | 5 | `onRequestOptions`(L24,42/L24,51) · `onRequestPost`(L28,39/L28,48/L28,53) | 2 行改 |

**唯一允許落地的 source diff（6 改、純 Convention A）**：
```ts
// list（requisition-refund.ts）
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {  // L37
export async function onRequestGet({ request, env }: { request: Request; env: Env }) {       // L41

// approve.ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {                                  // L37
export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {  // L41

// reject.ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {                                  // L24
export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {  // L28
```

- **正式 frozen form ＝ function-declaration ＋ inline param type**（沿 PR-2cp..2cy 既定）；**禁** arrow const、named ctx type alias、拆多行、加 return type。
- handler `request` ＝ **`Request`（plain）**；`env` ＝ **`Env`（full）**；approve/reject 的 `POST` 多帶 **`params: Record<string, string>`**（list `GET` 無 params destructure）。

## §3 OD analysis — **零新 OD**

- **Convention A handler-context type** `{ request: Request; env: Env[; params: Record<string, string>] }`：跨大量 migrated handler 既定慣例（`delete.ts` #123、`refund.ts` #122、admin-ops 三檔 #119-batch、`auth/payments/intents/[id].ts` #115 … 皆此型）。本 PR 沿用、非新範式。
- **`params: Record<string, string>`**（approve/reject）：兩檔 L55/L41 `Number(params?.id)` 消費 `params.id`（string）→ Record<string,string> 對齊慣例與用法；list `GET` 不 destructure params → 無此型。
- **`request: Request`（六處）**：三檔僅 `getCorsHeaders(request,…)` + `request.json()`（approve/reject）+ `new URL(request.url)`（list）+ 傳 `request` 給 `requireStepUp`/`requireAnyScope`/`safeUserAudit`；**無 `.cf` 存取** → 非 `CfRequest`。
- **`env: Env`（六處）**：三檔檔內只直接存取 **`env.chiyigo_db`**（env.d.ts:23 已宣告 `D1Database`），其餘整包 forward 給 util（`getCorsHeaders`/`requireStepUp`/`requireAnyScope`/`getPaymentIntent`/`lockIntentForRefund`/`unlockIntentToSucceeded`/`updatePaymentStatus`/`ecpayRefund`/`safeUserAudit`/`syncRequisitionTgMessage`/`checkRateLimit`/`recordRateLimit`；⚠ `effectiveScopesFromJwt` 吃 `stepCheck.user`、**非 env**）→ 標 `env:Env` 零 TS2339（scout forced tsc 實證 ADDED=0）→ **非 Path A、不碰 env.d.ts**；Pick 否決（forward 面要 full）。
- **cascade-safe 根因（approve.ts 專屬獨立論證；§4 spike 實證）**：
  1. **DEFER spine import（refund.ts 同形、本 PR 重點獨立驗證）**：approve.ts 從 `utils/payments`（DEFER、18 errors）import `getPaymentIntent`/`updatePaymentStatus`/`lockIntentForRefund`/`unlockIntentToSucceeded`，從 `payment-vendors/ecpay` import `ecpayRefund`。這些 callee 的**回傳型別由其自身 signature 決定、與 call-site 傳入的 `env` 引數型別無關**（callee env 參數本身為 DEFER spine 的 implicit-any，回傳 ＝ D1 `.first()`/`.all()` row → `any`，或 ecpayRefund 自身宣告 shape）。故本 PR 在 handler 標 `env:Env` **不銳化** `intent`（維持 `any`）、`refundResult`、`lock` → `intent.status`/`.metadata?.trade_no`/`.vendor`/`.vendor_intent_id`/`.amount_subunit`/`.id`/`.user_id`、`refundResult.ok`/`.rtn_code`/`.rtn_msg`、`lock.ok` 全維持鬆型 → 零新錯、零 cascade 進殿後檔 `webhooks/payments/[vendor].ts`（DEFER 的 adapter union 未被觸發）。
  2. **D1 寫入路徑**（approve `db.prepare().bind().first()/.run()` CAS、reject CAS UPDATE…RETURNING、list `.all()/.first()`）：`env.chiyigo_db` 型別 `D1Database` 在本 repo（**未裝 `@cloudflare/workers-types`**）解為 `any`（[[feedback_d1database_resolves_any_no_workers_types]]）→ `.prepare().bind().run()/.first()/.all()` 維持鬆型 → 零新錯。**活證**：#119 admin-ops 三檔已 `env:Env`-typed 且 clean 對 D1 `.all()` 結果索引/賦值。
  3. `Number(...)`/`String(...).slice(...)`/`Set.has(...)`/`new URL(...)`/`Promise.all([...])`/`Math.max/min`/`parseInt`：標準用法、不受 handler-context 標型影響。
  - ⚠ 若未來裝 workers-types 或銳化 `getPaymentIntent` 回傳型別，本面（D1 / spine 回傳 any-ness）需重評 cascade。

## §4 scout evidence（non-commit spike、已 `git checkout --` 還原）

- **current ratchet 實跑驗證（非記憶）**：`npm run typecheck:ratchet:report` @ `3da9b947` → errorCount **751** / errorFiles **69** / cleanFiles **265** / sourceFilesTotal **334**。
- forced `tsc -b tsconfig.solution.json --force` baseline → 三檔恰 **14×TS7031**（list L37×2+L41×2 / approve L37×2+L41×3 / reject L24×2+L28×3）；皆 TS70xx（noImplicitAny error）→ **functions leaf only、無 dual-leaf 重複計**；三檔**只有** TS7031、無其他 code → 修完全進 cleanFiles。total file-errors **751**（== ratchet errorCount）。
- 套 §2 六 edit → forced full-solution build sort-diff vs 751 baseline（`diff <(base sorted) <(after sorted)`）：
  - **REMOVED ＝ 恰 14**（三檔 14×TS7031 全清）。
  - **ADDED ＝ 空**（零 cascade，含 approve.ts DEFER-spine import 面、含 tests-leaf、含全樹）。
  - raw 總數 **751 → 737**。
- ratchet after：errorCount **737** / errorFiles **66** / cleanFiles **268**（三檔全清入 cleanFiles）。
- **dual-leaf 實證（三檔皆 dual-leaf）**：
  - approve/reject 經 `tests/integration/admin-payments.test.ts:18-19` direct import `onRequestPost as {reject,approve}Handler`，於 L667/713/742/749 **4 處 call-site** 以 literal `{ request: bearer(...), env, params: { id: String(rrId) } }` 呼叫。
  - list 經 `tests/integration/admin-requisitions-list.test.ts:43` direct import `onRequestGet as refundListHandler`，於 L64 以 literal `{ request: reqWith(...), env }` 呼叫。
  - full-solution build ADDED=0 → call-site literal 對標註後 context type **皆 assignable**：`env`（`cloudflare:test` 的 `ProvidedEnv extends Env`、env.d.ts:110-113）assignable to `Env`；`params:{ id: String(rrId) }`（`{id:string}`）assignable to `Record<string,string>`（index signature、無 excess-property）；`request` from `bearer()`/`reqWith()`/`new Request()` = `Request`。**零 TS2345/TS2353**（同 delete.ts #123 / admin-ops #119 direct-literal 先例）。
- **env:Env single-file 確認**：spike 後三檔零 `env.X` TS2339（env.d.ts:23 `chiyigo_db: D1Database` 已宣告）→ 無 Path A。
- **byte-identical emit 實證**（canonical recipe、Git Bash stdin transform；**base 端 pin PR base `3da9b947`〔未標註 blob〕、head 端＝已標註版**，非 HEAD-vs-worktree / HEAD-vs-HEAD 恆真比對〔delete.ts self-review M-1〕）：
  ```bash
  # base ＝ PR base 3da9b947（未標註）；head ＝ 套 §2 edit 後（scout working tree / code 階段 commit blob）
  git show "3da9b947:<file>" > base.ts                                          # 未標註，顯式 SHA anchor
  node_modules/.bin/esbuild --loader=ts --format=esm < base.ts > base.js 2> base.err
  node_modules/.bin/esbuild --loader=ts --format=esm < <annotated file> > head.js 2> head.err
  diff -q base.js head.js && echo IDENTICAL   # + wc -c（兩端同）+ sha256sum（兩端同）
  ```

  | 檔 | base.js（未標註 emit）| head.js（已標註 emit）| 結論 |
  |---|---|---|---|
  | requisition-refund.ts | 3297B `8ce94bf2…` | 3297B `8ce94bf2…` | IDENTICAL |
  | approve.ts | 8496B `b3e8e268…` | 8496B `b3e8e268…` | IDENTICAL |
  | reject.ts | 2495B `e516dcaa…` | 2495B `e516dcaa…` | IDENTICAL |

  三檔 base==head 同 byte 同 sha、stderr 皆空（且 sha ≠ 空字串 sha `e3b0c442…` → 真實非空輸出）→ type annotation 全 erase、**零 runtime change**。三檔皆有 import → esbuild stdin transform 是**單檔 type-strip**（import 原樣穿透）、對 type-only 證明為正確粒度（[[feedback_byte_identical_emit_verification]]）。
- **驗證紀律（delete.ts self-review M-1）**：byte-identical CLAIM 必以 **`3da9b947`〔未標註〕為 base 端、已標註 commit blob 為 head 端** 重播（**禁 HEAD-vs-HEAD / annotated-vs-annotated 恆真式**）；code 階段 commit 後重證。

### frozen diff（git-format，spike 實取，`git diff --check` exit 0）

```diff
diff --git a/functions/api/admin/requisition-refund.ts b/functions/api/admin/requisition-refund.ts
index 7fcaa694..e1fd8a14 100644
--- a/functions/api/admin/requisition-refund.ts
+++ b/functions/api/admin/requisition-refund.ts
@@ -34,11 +34,11 @@ import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'
 // 反而在 UI/API 隱形。
 const VALID_STATUS = new Set(['pending', 'approved', 'rejected', 'processing'])
 
-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
 }
 
-export async function onRequestGet({ request, env }) {
+export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
   const cors = getCorsHeaders(request, env)
   // P1-17 Phase 3: 退款列表屬金流，任一金流 fine 即可讀
   const { user, error } = await requireAnyScope(
diff --git a/functions/api/admin/requisition-refund/[id]/approve.ts b/functions/api/admin/requisition-refund/[id]/approve.ts
index a8418f21..5b29b5ac 100644
--- a/functions/api/admin/requisition-refund/[id]/approve.ts
+++ b/functions/api/admin/requisition-refund/[id]/approve.ts
@@ -34,11 +34,11 @@ import { safeUserAudit } from '../../../../utils/user-audit'
 import { DEBUG_REASON_CODES } from '../../../../utils/audit-aggregate-debug'
 import { syncRequisitionTgMessage } from '../../../../utils/tg-requisition'
 
-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
 }
 
-export async function onRequestPost({ request, env, params }) {
+export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
   const cors = getCorsHeaders(request, env)
 
   const stepCheck = await requireStepUp(
diff --git a/functions/api/admin/requisition-refund/[id]/reject.ts b/functions/api/admin/requisition-refund/[id]/reject.ts
index 18d39e63..649ae26c 100644
--- a/functions/api/admin/requisition-refund/[id]/reject.ts
+++ b/functions/api/admin/requisition-refund/[id]/reject.ts
@@ -21,11 +21,11 @@ import { getCorsHeaders } from '../../../../utils/cors'
 import { SCOPES, effectiveScopesFromJwt } from '../../../../utils/scopes'
 import { safeUserAudit } from '../../../../utils/user-audit'
 
-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
 }
 
-export async function onRequestPost({ request, env, params }) {
+export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
   const cors = getCorsHeaders(request, env)
 
   const stepCheck = await requireStepUp(
```

`git diff --stat`：3 files / **6 insertions(+) / 6 deletions(-)**；`git diff --numstat`：list `2 2`（`7fcaa694→e1fd8a14`）+ approve `2 2`（`a8418f21→5b29b5ac`）+ reject `2 2`（`18d39e63→649ae26c`）；`git diff --check` exit 0（無 trailing whitespace）。

> **DEFER 的 payments.ts spine cascade（記錄、非本 PR scope）**：PR-2cx scout 實證 OD-1＝`resolvePaymentAdapter` 標 `vendor:string` → 回傳 any→精確 `mock|ecpay` union → caller `webhooks/payments/[vendor].ts` cascade 12 錯、FAIL ratchet。→ 留 PaymentAdapter coupled PR，**本 PR 禁碰 payments.ts/ecpay.ts/webhooks**。

## §5 security / 風險（admin 金流路徑、first-do-no-harm）

| 檔 | 角色 | 紅線（typing 全程不得牽動）|
|---|---|---|
| `approve.ts` | **Tier-0 退款執行端**（destructive 金流寫入）| `requireStepUp(ELEVATED_PAYMENT,'approve_requisition_refund')` + `admin:payments:refund` fine scope + rr atomic claim CAS（pending→processing）+ `lockIntentForRefund`（intent CAS）+ `ecpayRefund(Action='R')` + 三表同步（intent refunded / requisition revoked+deleted_at / rr approved）+ final CAS + reconciliation 路徑（502/202）+ critical audit + TG sync |
| `reject.ts` | admin 拒絕（不動錢）| `requireStepUp(ELEVATED_PAYMENT,'reject_requisition_refund')` + `admin:payments` scope + atomic CAS UPDATE…RETURNING（pending→rejected）+ 404/409 分流 + critical audit |
| `requisition-refund.ts`（list）| admin 對帳 read（無寫入）| `requireAnyScope(admin:payments fine 任一)` + admin rate-limit + `VALID_STATUS` 驗 + pagination（limit≤200）+ LEFT JOIN 補資料（`requisition`/`payment_intents` enrichment、`WHERE rrr.status=?`、**無 soft-delete 過濾**）+ read audit |

- 本 PR ＝ **type-only handler-context 標註**；byte-identical emit（§4）→ **零 runtime change** → 上列所有 auth/step-up/scope/CAS/ECPay/三表同步/reconciliation/audit/rate-limit 邏輯**完全不動**。
- 零 cascade（scout 實證）→ 不影響任何其他檔；不引入 any；不碰 payments.ts/ecpay.ts/webhooks/env.d.ts。
- **impl L1（6 行 type-only）/ review care L2**：approve.ts 為 payment + destructive 退款執行邊界，**不因 impl=L1 而降低外部審查強度**，走完整 4 道外部審查（self-review form 依 §動工分級＝L1 single-agent 對抗式；分類疑義可在 Plan/Code Gate 被挑戰、fail-safe 升級）。

## §6 verification plan

- **byte-identical**：canonical recipe `esbuild --loader=ts --format=esm`（stdin、Git Bash）對 **PR base `3da9b947` blob（未標註）vs 已標註 commit blob** 比對 sha（[[feedback_byte_identical_emit_verification]]；**禁 HEAD-vs-HEAD 恆真式**）— scout 已證三檔 3297B/`8ce94bf2…`、8496B/`b3e8e268…`、2495B/`e516dcaa…`，code 階段 commit 後以 `3da9b947` 為 base 重播確認。
- **full-solution sort-diff（L6）**：Code 階段（commit 後）重跑 forced `tsc -b … --force`，對 751 baseline sort-diff → 必 **REMOVED 恰 14 / ADDED 0**；ADDED 非空 → 回 Codex/ChatGPT gate 重審、禁自擴 scope。
- **ratchet**：`RATCHET_BASE_REF=3da9b947 npm run typecheck:ratchet` → 期望 current `737 / 268`（errorFiles 66）；baseline 不動（**不** `--update`）。
- **merge-front 7 gates（對齊 CI `.github/workflows/ci.yml`）**：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int`（含 `admin-payments.test.ts` approve/reject 4 case + `admin-requisitions-list.test.ts` refund-list case）· `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **NB-2 雙證**：Code 階段報告**同時列**「三檔 base vs patched emit byte-identical（sha + bytes）」與「source diff 僅 6 行（`git diff` 逐行 == frozen）」，不以 ratchet 數字單獨替代行為保證。
- **staged set**：僅三 source 檔 + 本 plan doc；**禁** `git add -A`、`CLEANUP_PLAN.md` 不進 commit。
- **硬驗收**：source diff 與本 doc §4 frozen diff **逐行一致**（人審 `git diff --stat` 僅 3 檔、各 +2/−2）；超出 = scope creep = Gate fail。

## §7 proposed locks（待 ChatGPT Arch 裁；先 codify 自我承諾、無 plan 邏輯變更）

> Plan Gate（① ChatGPT Arch）將裁定/補強 binding locks；以下為 plan 自我承諾，Arch 裁後以其 lock set 為準。

| Lock | 內容 | plan 對應 |
|---|---|---|
| L1 Scope | source 改動只能是三檔各兩處 handler context annotation（共 6 改）；plan doc 可更新 gate log、不得夾帶其他 source | §0/§2/§6 |
| L2 Runtime hot-zone | 不改 runtime branch / SQL / CAS（claim/lock/final）/ ECPay 呼叫 / 三表同步 / reconciliation 路徑 / audit payload / scope·step-up gate / rate-limit / response shape / docstring | §0/§5、byte-identical §4 |
| L3 排除檔 | 禁碰 `utils/payments.ts`/`payment-vendors/ecpay.ts`/`webhooks/payments/[vendor].ts`/`env.d.ts`/adapter/mock/ecpay/同域 payments 其他檔；需碰任一 → 停下回 `PLAN_DRAFT` | §0 |
| L4 No any / no cast | 禁新增 explicit `any`、禁用 cast 壓錯；只允許 Convention A context type | §0/§2 |
| L5 params 形態 | approve/reject `params` 維持 `Record<string, string>`；不改 `Number(params?.id)` 行為；list 不引入 params destructure | §2/§3 |
| L6 sort-diff | Code 階段必重跑 full-solution sort-diff；僅允許 REMOVED 恰 14 / ADDED 0；ADDED 非空 → 回 gate 重審、禁自擴 scope 修 | §6 |
| L7 byte-identical | Code 階段必重跑 byte-identical emit；base〔`3da9b947` 未標註 blob〕vs 標註後 blob 必 byte-identical；sha/bytes 不同＝runtime drift | §4/§6 |
| L8 baseline | baseline `1119/175` 不得 `--update`；只接受 raw 751→737 / cleanFiles 265→268 / errorFiles 69→66 reduce 型變更 | §0/§6 |
| L9 Tier-0 防線 | approve.ts 退款執行防線不降級：step-up `approve_requisition_refund` / `admin:payments:refund` scope / 雙層 CAS / ECPay / reconciliation / critical audit 皆不變；reject/list 防線同理 | §5 |
| L10 D1/spine any 不升格 | 不得把「D1 / `getPaymentIntent` 等 spine export 現為 `any`」升格長期架構結論；未來引入 workers-types 或銳化 spine 回傳型別 → 本檔需重評 cascade | §3.cascade / §4 ⚠ caveat |

## §8 gate trail（state 隨進度更新）

- [x] `SPEC_APPROVED`（owner directive 2026-06-29：requisition-refund family ＝ 下一棒；C-1 ＝ 三檔一棒 batch）
- [x] `PLAN_SELF_REVIEW_CLEAN`（2026-06-29、L1 single-agent 對抗式 `readonly-reviewer`〔繼承 session model Opus 4.8〕→ **0 blocking / 0 major / 1 minor + 2 informational**，主線獨立裁決後全處置：**M-1**〔minor〕§5 list red-line 誤列「soft-delete 過濾 LEFT JOIN」→ 主線獨立查實 list query〔L69-92〕僅 `WHERE rrr.status=?`、LEFT JOIN 為 enrichment、**無 deleted_at 過濾** → 修正為「enrichment、無 soft-delete 過濾」；**I-2**〔info〕§1 untracked 狀態 stale → clarify 為 plan-only commit 前預期態；**I-3**〔info〕scratchpad 缺 `*.head.ts`、但 plan recipe 為正確非恆真式、reviewer 已獨立 re-derive reject.ts byte-identical〔`3da9b947` 未標註 vs 標註得同 2495B/`e516dcaa…`〕補實 → 無 plan defect、無 action。**reviewer live 獨立驗證 CONFIRMED**（非採 raw）：scope 6 edits/14 TS7031〔loc 逐一吻合〕· cascade=0〔sort-diff REMOVED 14/ADDED 0、含 approve.ts DEFER-spine import 面 + `webhooks/payments/[vendor].ts` 19 錯前後不變 + tests-leaf assignable〕· byte-identical 非恆真〔explicit-SHA re-derive〕· ratchet 751/69/265→737/66/268〔live `--report`〕· `Env` ambient `declare global` + 三檔僅 `env.chiyigo_db` → 無 Path-A · §5 Tier-0 red-lines 完整。**review agent 未污染 git**〔主線驗 HEAD `3da9b947`、源 blob 未動、staged 空〕。一輪 0 新發現〔僅餘修正後 doc，技術核心同輪 CONFIRMED clean〕）
- [ ] `CHATGPT_ARCH_APPROVED`（① 維度 B）
- [ ] `CODEX_PLAN_APPROVED` → `CODING_ALLOWED`（② 維度 C）
- [ ] `CODE_SELF_REVIEW_CLEAN`（Code 階段 L1 single-agent 對抗式）
- [ ] `CODEX_CODE_APPROVED`（③ 維度 C）
- [ ] `CHATGPT_CODE_FAITHFULNESS_APPROVED` → `MERGE_ALLOWED`（④ 維度 B-code）
- [ ] `MERGED_MAIN`（squash-merge --delete-branch；merge-front 重 7 gates 全綠後；更新 topic receipt + 刪 packets）
