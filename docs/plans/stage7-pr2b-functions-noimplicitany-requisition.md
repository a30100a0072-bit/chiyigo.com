# Stage 7 — PR-2b：functions `noImplicitAny` reduce — requisition 域（payment-context）

> 狀態：**plan 階段**（本檔即 plan-gate 標的；0 行 source code 變更已 committed）。
> Base / fork-point：`630fb53`（main，working tree clean；solution non-strict = 0 baseline-violation，`typecheck:ratchet` 綠；baseline `errorCount=1189 / errorFiles=143 / cleanFiles=161`）。
> 動工分級：**L1 機械型遷移**（type-only inline annotation，**runtime 0 變更**，不轉 function→const、無 `:any`/suppression）**＋ payment-context 加碼層**（requisition 屬接案金流脈絡 → 走 codex chain + first-do-no-harm，care level 拉高、gate 結構與非熱區一致）。不跑 §輸出順序 11 步。
> 上位 plan：`docs/plans/stage7-strict-zero-error.md` §6 per-flag ladder（functions leaf：`noImplicitAny` 已開〔PR-1 `4be5414`〕→ **逐批 reduce 清零**〔本 PR〕→ 再 `strict:true`）。模板：PR-2a（`630fb53`）確立的 Convention A reduce SOP。

## 0. 這是什麼 PR（範圍）

functions leaf 第三個 **reduce** PR（PR-2a 是 micro pattern-proof 3 檔；本 PR 收 requisition 域 7 檔）。**純 type-only**：補 handler 參數型別（Convention A）+ 少量 file-local helper / lookup-table inline 型別。**不修 runtime、不改任何控制流、不動 SQL、不碰 audit/payment 寫入邏輯。**

- **normal ratchet reduce**（errorCount 下降 → 綠）：**不帶** `RATCHET_ALLOW_BASELINE_RAISE`、**無** override env、**無** governance workflow。PR-CI 一般 ratchet step 應綠。
- **payment-context first-do-no-harm**：requisition 域含「撤銷 → 退款申請」「保存成 deal（加總 succeeded/refunded 金額）」「刪除攔截未退款 intent」等金流脈絡。本 PR 全程 minimum diff、零行為變更，讓 Codex review 焦點對齊 idempotency / state machine / 金額計算 / audit 對齊「**未被本 PR 觸碰**」。

## 1. 勘查實況（以 code 實測為準，2026-06-08 @ `630fb53`）

`npx tsc -p tsconfig.functions.json --pretty false` → 全 solution `errorCount=1189`，與 committed baseline 完全一致（無 drift）。requisition 域分佈：

### 1.1 In-batch（7 檔 / 40 errors）

| # | 檔 | err | 性質 | error 種類 |
|---|---|---|---|---|
| 1 | `functions/api/requisition.ts` | 6 | 公開提單（訪客可送）；file-local `validate`/`escapeTgHtml`/`sendTelegram` | TS7006×4 + TS7031×2 |
| 2 | `functions/api/requisition/[id].ts` | 6 | GET 明細（串 payment_intents 唯讀）/ DELETE soft-delete | TS7031×6（2 handler）|
| 3 | `functions/api/requisition/revoke.ts` | 5 | **payment-context 重**：有 succeeded intent → 建 refund_request | TS7006×3 + TS7031×2 |
| 4 | `functions/api/admin/requisitions.ts` | 2 | admin 列表（scope=`admin:payments:*`，原碼註明「金流脈絡」）| TS7031×2 |
| 5 | `functions/api/admin/requisitions/[id]/delete.ts` | 5 | admin soft-delete（攔未退款 intent）| TS7031×5（OPTIONS+POST）|
| 6 | `functions/api/admin/requisitions/[id]/save.ts` | 6 | admin → deals（加總金額）| TS7031×5 + TS7006×1（`it`）|
| 7 | `functions/utils/tg-requisition.ts` | 10 | **共用 util**：TG 訊息渲染（含 lookup table + 付款摘要）| TS7006×7 + TS7053×2（index）+ … |

### 1.2 明確排除（→ 之後 payments 熱區 codex chain，不在本 PR）

退款（refund）= payment 熱區，獨立切：
- `functions/api/admin/requisition-refund.ts`（4）
- `functions/api/admin/requisition-refund/[id]/approve.ts`（5）
- `functions/api/admin/requisition-refund/[id]/reject.ts`（5）
- `functions/api/payments/intents/[id]/refund-request.ts`（3）

## 2. 預計改哪些檔（per-file annotation spec；全 type-only inline）

**Handler（Convention A，inline 精確 shape）**：`PagesFunction`/`EventContext` 不在 scope → 用 global `Env` + WebWorker `Request`/`Response`，只列 handler 實際用到的欄位。
- `({ request, env }: { request: Request; env: Env })` — requisition.ts、revoke.ts、admin/requisitions.ts、delete.ts/save.ts 的 `onRequestOptions`
- `({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })` — [id].ts（GET/DELETE）、delete.ts/save.ts 的 `onRequestPost`

**File-local helper / callback / lookup table（minimal inline）**：
| 檔 | 站點 | 型別 |
|---|---|---|
| requisition.ts | `validate(body)` | `body: Record<string, string \| undefined>`（內部全 string op；index `body[key]` 需 index sig）|
| requisition.ts | `escapeTgHtml(s)` | `s: unknown`（`String(s)` 容納；honest「stringify 任意輸入」）|
| requisition.ts | `sendTelegram(env, text)` | `env: Env, text: string` |
| revoke.ts | `editTelegramMessage(env, messageId, text)` | `env: Env, messageId: number \| null, text: string` |
| save.ts | `intents.map(it => it.id)` | `it: { id: number }` |
| tg-requisition.ts | `escapeTgHtml(s)` | `s: unknown` |
| tg-requisition.ts | `STATUS_HEADER` | `: Record<string, { icon: string; label: string }>`（`STATUS_HEADER[status]` index + `\|\| .pending` fallback 保留）|
| tg-requisition.ts | `PAYMENT_STATUS_LABEL` | `: Record<string, string>` |
| tg-requisition.ts | `payments.map(p => …)` | `p: { id: number; status: string; amount_subunit: number \| null; currency: string \| null }` |
| tg-requisition.ts | `buildRequisitionTgText` / `syncRequisitionTgMessage` | `(env: Env, reqId: number, overrideStatus?: string)` |

**紀律遵循**：
- 不寫 JSDoc 型別（.ts 模式不讀，[[feedback_ts_no_jsdoc_in_ts_mode]]）；tg-requisition.ts 既有 `@param {object} env` 等 **prose 保留不動**（minimal diff；現為 informational-only）。
- `= {}` / `Record` 家族補 inline（[[feedback_ts_destructure_default_empty_type]]）。
- D1 `.first()/.run()/.all()` 結果在本 tsconfig 仍寬鬆（見 §5 spike）→ row 屬性存取（`countRow.cnt`/`meta.last_row_id`/`row.status`…）**無 cascade**，不需動。

## 3. baseline 變動（spike 已實測 2 檔；全批預測）

| 欄位 | base(`630fb53`) | 本 PR（預測）|
|---|---|---|
| errorCount | 1189 | **1149**（−40）|
| errorFiles | 143 | **136**（−7）|
| cleanFiles | 161 | **168**（+7）|
| sourceFilesTotal | 304 | 304（不變）|

> code 階段以 `npm run typecheck:baseline:update` 重產真值（reduce PR 收尾固化）。

## 4. 風險分析 + spike receipts（plan 階段已實證，已 revert）

對最簡（requisition.ts）與最繁（tg-requisition.ts）兩檔做 spike，套上 §2 型別後 `tsc -p tsconfig.functions.json`：

1. **無 `env: Env` → row-access cascade**：requisition.ts 套型別後 **0 error**（`countRow.cnt`/`meta.last_row_id`/`data.ok` 等皆未變 error）。
2. **無跨 leaf excess-property（tests）**：direct-call test 站點 shape 與 Convention A **逐一吻合** —
   - `admin/requisitions` `listHandler({ request, env })` ✓ / `save`/`delete` `({ request, env, params:{id} })` ✓
   - `api/requisition` 經 `callFunction(handler, req)` helper，helper `handler` 參數在 tests leaf 為 untyped(any) → 不檢查 shape ✓
   - `requisition/[id].ts`、`revoke.ts`：**無 direct-call test**（純 HTTP）→ 無風險
3. **無洩漏到 out-of-batch consumer**：tg-requisition.ts 套型別後，其 import 方 refund 檔（approve/reject/requisition-refund）error 數 **維持 14 不變**（call 端傳 `(env, number/any, string/undefined)` 皆 assignable）。
4. **總量**：spike 後全 solution `1189 → 1173`（恰 −16 = requisition.ts 6 + tg-requisition.ts 10），**0 新 error**。
5. **excess-property 後備**（Convention A 既定）：若 code 階段全量 `tsc -b` 意外冒出極窄 shape 的 excess-property → 對該 handler 放寬欄位（不預做）。

## 5. gates（code 階段實跑，PR body 貼 receipt）

- `npm run typecheck:ratchet`（reduce → 綠；**不帶任何 env**）。**local-verify 陷阱**：commit 後跑 plain ratchet（base 自動 = origin/main）；或 commit 前用 `RATCHET_BASE_REF=630fb53… npm run typecheck:ratchet`（= CI `pull_request.base.sha`），**避免 branch 尚無 commit 時落 `HEAD~1`(PR-1 前) → false-RED**。
- `npm run lint`（eslint functions tests → 0）。
- `npm run build:functions`（wrangler Pages bundle gate；reduce PR 動 .ts 必跑）。
- **payment-context 加碼**：實跑相關 integration suite — `requisition.test.ts` / `admin-requisitions-list.test.ts` / `admin-requisitions-state.test.ts` / `admin-payments.test.ts`（含 refund consumer），全綠證「type-only 0 行為變更」。
- **無 cache-bust**（functions-only、未跑 `npm run build`、`public/js` 不變 → N/A，非 skip）。
- **runtime regression test N/A**：type-only，無 bug fix。

## 6. merge path

- **normal squash-merge**（無 override / 無 governance workflow）。reduce PR base=main `630fb53`，PR-CI ratchet reduce → 綠。
- 四檢查點：plan→自審→**Codex plan-gate**→code→自審(gates)→**Codex code-gate**→**owner 明示同意 → Claude 代跑 `gh pr merge --squash`**（無 auto-merge）。
- 無 migration / 無 D1 / 無 secret → [[feedback_migration_before_merge_autodeploy]] 不適用；push main 觸發 Pages auto-deploy，但 functions type-only → 行為 no-op。

## 7. Open Decisions（請 owner 以 prose 裁；不用 AskUserQuestion）

1. **scope 大小**（主 fork）：
   - **(A)〔建議〕** 7 檔 requisition-core 一個 PR：同一域、全 type-only、單一 codex chain；spike 已證 2 檔 −16、其餘 5 檔更單純。errorCount 1189→1149。
   - **(B)** entrypoint 6 檔先（30 err）、`tg-requisition.ts` util 併入低敏感 utils 波次（it 是唯一非 handler-param、有 lookup-table 型別）。
   - **(C)** 再切細：公開 `api/requisition*` 3 檔（17 err）一 PR、admin 3 檔（13 err）一 PR、tg-requisition 一 PR（最 first-do-no-harm，但 PR 數最多）。
   - 預設 **(A)**；列此 fork 因 requisition 屬 payment-context，scope 顆粒度是 owner 風險偏好決策。
2. **排除確認**：requisition-refund/* + payments/.../refund-request（4 檔 / 17 err）排除本 PR、歸後續 payments 熱區 codex chain — 請確認。
3. **次要實作細節**（非 fork，列供 review）：`escapeTgHtml(s: unknown)`（vs `string`）；tg-requisition 既有 JSDoc prose 保留不動。

## 8. 本 PR 不做

- 不修 requisition-refund / refund-request（payment 熱區，後續切）。
- 不改任何 runtime 行為 / 控制流 / SQL / audit / 金額計算。
- 不轉 function→const、不用 `:any` / `@ts-ignore` / `as any`。
- 不開 `strict:true`（清零後才開）。
- 不動其他 leaf（scripts / tests / browser-typecheck）。
- 不 cache-bust（functions-only type-only）。
