# PAY-002 P0 Hotfix Plan — ECPay 驗章 fail-open 到公開 sandbox 金鑰

> **Gate 狀態**：PLAN r2（Codex Plan Gate r1 = REJECT-as-is，設計主軸保留，補 observability/audit 兩面後送回）｜分級 L1 微調 + 高風險加碼（auth/webhook 驗簽）
> **前置**：GPT Arch Gate 已對方向給意見；Codex r1 確認 ENVIRONMENT-SoT 主軸 + parseWebhook 回 ok:false 正確。r2 修訂見「§9 Codex r1 回應」。本 plan 過 Codex Plan Gate 後才進 Code 階段（Dual Gate）。
> **來源**：`docs/audit/01-payments.md` PAY-002（P0 gating confirmed）；repro `tests/payments-ecpay-failopen.test.ts` 已證實。

---

## 1. 問題（已證實）

`functions/utils/payment-vendors/ecpay.ts` 的 `getCreds(env)`：
```
const isProd = env?.ECPAY_MODE === 'prod'   // L46
if (isProd) { /* 缺 creds 才 throw */ }      // L51-58，被 if(isProd) 包住
return { merchantId: env?.ECPAY_MERCHANT_ID ?? SANDBOX_CREDS.merchantId, ... }  // L66-71 公開金鑰 fallback
```
`ECPAY_MODE` 未設 → `isProd=false` → 跳過 prod fail-closed → webhook 驗章用程式內 **hardcode 公開** sandbox HashKey/HashIV(`L41-42`,亦見 ECPay 官方文件)。

**已確認事實**：
- owner 確認 **prod 目前未設三把 `ECPAY_MERCHANT_ID/HASH_KEY/HASH_IV` secret**。
- 全 repo `ECPAY_MODE` 只出現在 `ecpay.ts:46`,**未在 wrangler.toml、未在 `types/env.d.ts`** → prod 必然 unset → 必然走 sandbox 分支 → fail-open。
- `wrangler.toml:11 ENVIRONMENT = "production"`(非 secret,prod 必設;本機 .dev.vars 覆寫成 development;miniflare test 為 'test')——**現行 code 完全沒用這個可靠信號**。

**攻擊**：知道某 pending intent 的 `MerchantTradeNo`+`TotalAmount`(checkout 都回前端、client 可見)即可用公開金鑰自簽 `RtnCode=1` webhook → 過 CheckMacValue + 金額閘門 → 未付款標 succeeded。repro 證實:空 env 下 `parseWebhook` 回 `ok:true`。

---

## 2. Scope / Non-goals / Acceptance Criteria（owner 拍板 2026-06-12）

**Scope**
1. production 缺任一 ECPay secret → **fail-closed**。
2. production **不允許** `ECPAY_MODE=sandbox`。
3. sandbox public-creds fallback **只能**在 non-production 且明確 `ECPAY_MODE=sandbox` 時啟用。
4. secret missing / mode mismatch → 寫 **critical audit**。
5. `tests/payments-ecpay-failopen.test.ts` 從 repro 轉 regression。
6. 更新 `docs/audit/01-payments.md` 標 PAY-002 為 P0 gating confirmed（**已完成**）。

**Non-goals**（本 PR 不碰）
- PAY-006 idempotency/rate limit、PAY-005 critical audit 全面化、PAY-008 amount_subunit rename、payment module 重構、**新增真實 ECPay secret 值**、PAY-004 退款生命週期(獨立 PR)。

**Acceptance Criteria**
- production 缺三把 → webhook reject。
- production 缺任一 → webhook reject。
- production + `ECPAY_MODE=sandbox` → webhook reject。
- non-production + `ECPAY_MODE=sandbox` → 允許 sandbox 測試資料。
- fake sandbox signature 在 production 不可通過。
- lint / typecheck / payment tests / build 全綠。
- `docs/audit/01-payments.md` 更新 PAY-002 狀態。

---

## 3. 設計：credential resolution（secure-by-default fail-closed）

**判斷信號**：`isProduction = env.ENVIRONMENT === 'production'`（部署 SoT,prod 必設,**不靠 ECPay-specific 的 ECPAY_MODE**）。`ECPAY_MODE ∈ {'prod','sandbox',undefined}`。`hasAll3 = MERCHANT_ID && HASH_KEY && HASH_IV`。

**真值表**（`SANDBOX_CREDS` 公開金鑰 = 只在標 ★ 的列才允許）：

| ENVIRONMENT | ECPAY_MODE | hasAll3 | 結果 |
|---|---|---|---|
| production | `sandbox` | — | **REJECT** `mode_mismatch`（prod 禁 sandbox）|
| production | 其他/unset | 缺任一 | **REJECT** `secret_missing` |
| production | 其他/unset | 是 | REAL creds + prod URL |
| 非 production | — | 是 | REAL creds + URL(由 ECPAY_MODE='prod' 決定 prod/stage) |
| 非 production | `sandbox` | 否 | ★ PUBLIC sandbox creds + stage URL（唯一允許公開金鑰列）|
| 非 production | 非 sandbox | 否 | **REJECT** `sandbox_requires_explicit_mode` |

**關鍵不變量**：`SANDBOX_CREDS` 公開金鑰**有且僅有**「非 production **且** `ECPAY_MODE==='sandbox'` **且** 無真實 creds」一條路徑可達。其餘一律 REAL creds 或 REJECT。

**驗證影響**：production 設好三把真 secret(go-live)後 → REAL creds + prod URL,**owner 不需另設 `ECPAY_MODE`**(unset 在 prod 即視為 prod;只有 `=sandbox` 被禁)。→ go-live 動作 = 只灌三把 secret。

**REJECT 的傳遞**：`getCreds` 在 REJECT 列 **throw** 一個帶 `reasonCode` 的 typed error（沿用既有 prod-missing throw pattern,擴充條件）。各 caller：
- `parseWebhook`(`:128`)：**只包 getCreds 的 try/catch** → catch 回 `{ ok:false, error:'vendor_misconfigured', code: e?.code ?? 'config' }`（adapter 不寫 audit,交給 handler;`.code` 為機讀,handler 直接放 audit `data.code`,**不 parse message**）。→ webhook reject + repro 拿到 `ok:false`。
- `getEcpayCheckoutUrl`(`:75`)：throw 冒泡 → checkout handler 既有 catch(`checkout/ecpay.ts:110-119`)→ `payment.vendor.misconfigured` critical + 500（**現有行為,自動變嚴**,無需改 checkout）。
- `buildEcpayCheckoutFields`(`:269`)：在 `getEcpayCheckoutUrl` gate 之後才呼叫,不會先到。
- `ecpayRefund`(`:354`)：throw → refund.ts/approve.ts 既有 try/catch（network-error 分支）→ `payment.refund.*.network_error` critical + 502。fail-closed 正確（無 creds 不該退款）；label 為 network_error 稍不精確 → 列已知殘留(§7)。

---

## 4. 逐檔變更（plan,非 code）

1. **`functions/utils/payment-vendors/ecpay.ts` — `getCreds`**：依 §3 真值表重寫。新增 typed error（如 `EcpayConfigError` 帶 `code: 'secret_missing'|'mode_mismatch'|'sandbox_requires_explicit_mode'`）。`isProd`/URL 回傳維持既有欄位形狀（caller 不需改解構）。
2. **`ecpay.ts` — `parseWebhook`**：把 `const { hashKey, hashIV } = getCreds(env)`（`:128`）包 try/catch；catch → `return { ok:false, error:'vendor_misconfigured', code: e?.code ?? 'config' }`（機讀 `.code`,不 parse message）。其餘驗章邏輯不動。
3. **`functions/api/webhooks/payments/[vendor].ts` — `!parsed.ok` 分支**（`:46-63`）：當 `parsed.error === 'vendor_misconfigured'` → 寫 **critical** audit,**重用既有 `payment.vendor.misconfigured`**（Codex r1 Critical-1 採此 minimal fix:該 event **已分類** DEBUG_FAILURE `audit-policy.ts:325`、**已測** `audit-policy.test.ts:141` → **零 audit-policy / 零 test-registry 改動**;與 checkout 路徑同 event,`data.stage='webhook'` 區分）+ DLQ(`error_stage:'vendor_misconfigured'`) + `failureResponse(parsed.error)` → 回 `0|vendor_misconfigured`(reject,PSP retry 無害)。`data` 帶 `reason_code: VENDOR_CREDS_MISSING`(bucket key) + `code: parsed.code`(機讀)。其他 `parsed.error`(signature_invalid 等)維持 `payment.webhook.fail` warn。
4. **`types/env.d.ts`**：新增 `ECPAY_MODE?: 'prod' | 'sandbox'`（補root-cause:型別缺漏）。
5. **`vitest.workers.config.js`**：miniflare `bindings` 加 `ECPAY_MODE: 'sandbox'`（test 為 non-prod,使既有 ECPay 整合測試在新 fail-closed 規則下仍走公開 sandbox creds）。
6. **`tests/payments-ecpay-failopen.test.ts`**（adapter-level）：擴成完整 regression,覆蓋 §2 adapter 面 AC（見 §5）。
7. **`tests/integration/payments-ecpay.test.ts`**（handler-level,**Codex r1 Critical-2 新增**）：加一條 regression 證明 handler 真的寫 critical audit + DLQ（見 §5 末列）。
8. **`MANUAL_TODO.md`**（**Codex r1 Other**）：更新 ECPay go-live 段——prod **只需設三把 secret**;`ECPAY_MODE` 在 prod **不需設**(unset 即視為 prod)且**禁 `=sandbox`**;移除舊「最後設 `ECPAY_MODE=prod`」步驟,避免手冊漂移。Code 階段先讀現檔再改。
9. **`docs/audit/01-payments.md`**：PAY-002 → P0 gating confirmed（**已完成**）。

---

## 5. AC → 驗證對應

| AC | 驗證方式 |
|---|---|
| production 缺三把 → reject | regression test：`env={ENVIRONMENT:'production'}` + 偽造 webhook → `parseWebhook.ok===false` |
| production 缺任一 → reject | test：`env={ENVIRONMENT:'production', ECPAY_MERCHANT_ID:'x', ECPAY_HASH_KEY:'y'}`(缺 IV) → `ok===false` |
| production + mode=sandbox → reject | test：`env={ENVIRONMENT:'production', ECPAY_MODE:'sandbox', ...3 creds}` → `ok===false` |
| non-prod + mode=sandbox → 允許 | test：`env={ENVIRONMENT:'test', ECPAY_MODE:'sandbox'}` + 用公開金鑰**正確**簽的 webhook → `ok===true`（sandbox 測試資料可解析）|
| fake sandbox sig 在 prod 不過 | test：`env={ENVIRONMENT:'production', ...3 真 creds}` + 公開金鑰自簽 → `ok===false` |
| 既有 payment 整合測試全綠 | `vitest.workers.config.js` 加 `ECPAY_MODE:'sandbox'` 後 `tests/integration/payments*.test.ts` 不破 |
| 空 env repro 轉綠 | 現有 test1（`env={}` → `ok===false`）pre-fix FAIL → post-fix PASS |
| **secret missing/mode mismatch 寫 critical audit + DLQ**（scope 第 4 條,Codex r1 Critical-2）| **新增 handler-level 整合 test**（`tests/integration/payments-ecpay.test.ts`）：`prodEnv = { ...env, ENVIRONMENT:'production', ECPAY_MODE:undefined, ECPAY_MERCHANT_ID/HASH_KEY/HASH_IV:undefined, chiyigo_db: env.chiyigo_db }` + 送 webhook → 斷言 (1) resp body 以 `0|vendor_misconfigured` 開頭;(2) `audit_log` 有 row `event_type='payment.vendor.misconfigured'`、`severity='critical'`、`data.reason_code='vendor_creds_missing'`、`data.code='secret_missing'`;(3) `payment_webhook_dlq` 有對應 row。證明修在 handler、非只 adapter。|

---

## 6. 回歸風險

- **既有 ECPay 整合測試**：依賴「env 無 creds → 公開 sandbox fallback」。新規則下需 `ENVIRONMENT='test'(已是) + ECPAY_MODE='sandbox'(新加 binding)` 才 fallback → §4-5 已處理。**實作時必跑 `tests/integration/payments-ecpay.test.ts`+`payments.test.ts`+`admin-payments.test.ts` 確認全綠**。
- **checkout 路徑**：getEcpayCheckoutUrl throw 條件變多 → 既有 catch 已涵蓋(payment.vendor.misconfigured + 500)；行為「變嚴」不「變鬆」,符合 secure-by-default。
- **本機開發**：`.dev.vars` 的 `ENVIRONMENT=development`(非 prod)+ 開發者需設 `ECPAY_MODE=sandbox` 才用公開 creds → 需在 onboarding/.dev.vars 範本註明（doc-only，非 code）。
- **prod 現況**：套用後 webhook 立即 reject（fail-closed)→ 阻斷攻擊;owner go-live 灌三把 secret 後恢復正常。**無真實流量,部署即生效無 downtime 風險**。

---

## 7. 已知殘留 / out-of-scope

- `ecpayRefund` misconfig 經 refund 既有 try/catch 報為 `*.network_error`（label 不精確,但 fail-closed 正確;refund 為 admin + step-up gated）→ 列 P3 follow-up,不在本 AC。
- PAY-004 退款生命週期(deal 後可申請不回退主狀態)→ 獨立 PR。
- 不新增真實 secret 值（owner go-live 時手動灌,屬 MANUAL_TODO）。

---

## 8. 自審到零（blockers）

- [x] 真值表覆蓋 owner 全部 AC（§5 對應表逐條對上）。
- [x] 公開金鑰唯一可達路徑 = 非prod + 明確 sandbox + 無真creds（§3 不變量）。
- [x] 修復面收斂：getCreds 4 caller 全在 ecpay.ts;webhook handler 1 處 audit;env.d.ts/test config/test 各 1。
- [x] secure-by-default：所有不確定 → REJECT（throw）,無沉默 fallback 到公開金鑰。
- [x] 既有測試破壞點已識別並給對策（ECPAY_MODE binding）。
- [x] critical audit 路徑明確（webhook handler vendor_misconfigured；checkout 既有；refund 既有）。
- [x] 不偏離 Non-goals（無 idempotency/rate-limit/rename/重構/真 secret）。
- [x] **Codex r1 已答**(見 §9)：(a) 真值表非prod 分支不誤傷(test env 補 `ECPAY_MODE=sandbox` binding);(b) parseWebhook 回 ok:false 經 Codex 確認正確(handler 無外層 catch,throw 會跳過 audit/DLQ 路徑);(c) 機讀 .code 已納入(§4-2、§4-3 audit `data.code`)。

---

## 9. Codex Plan Gate r1 回應（REJECT → r2 修訂對照）

設計主軸(ENVIRONMENT-SoT、真值表、parseWebhook 回 ok:false)Codex 確認保留,以下逐條補：

| Codex r1 項 | 級別 | r2 修訂 |
|---|---|---|
| 新增 audit event 未納 audit-policy（必同 PR 分類,否則 prod 持續 warn）| Critical | **採 minimal fix「重用 `payment.vendor.misconfigured`」**(已分類 `audit-policy.ts:325` + 已測 `audit-policy.test.ts:141`)→ **不新增 event、零 audit-policy/test 改動**。§4-3 已改。|
| critical audit 是 scope 但驗證矩陣沒覆蓋（恐只修 adapter）| Critical | **加 handler-level 整合 regression**（§4-7 + §5 末列）:prod 缺 creds → reject + critical audit(`payment.vendor.misconfigured`/critical/reason_code) + DLQ。|
| parseWebhook 回 ok:false 而非 throw 正確 | 確認 | 保留;§3「REJECT 的傳遞」已載明 handler 無外層 catch、throw 會跳過 audit/DLQ 路徑的理由。|
| typed error 保留機讀 .code,勿 parse message | Observability | §4-2 catch 回 `code: e?.code`;§4-3 audit `data.code ∈ {secret_missing,mode_mismatch,sandbox_requires_explicit_mode}`;bucket reason_code 續用 `VENDOR_CREDS_MISSING`。|
| MANUAL_TODO.md 仍舊 go-live 流程(叫設 ECPAY_MODE=prod) | Other | **同 PR 改**（§4-8）:prod 只需三把 secret、ECPAY_MODE 不需設且禁 sandbox。|

_Plan r2 完成 2026-06-12。Codex Plan Gate 通過後進 Code 階段;實作時 §4 全部變更同一 PR(getCreds + parseWebhook + webhook handler + env.d.ts + vitest config + 2 個 test 檔 + MANUAL_TODO + 01-payments[已完成]),先跑 §5/§6 驗證再自審到零。_
