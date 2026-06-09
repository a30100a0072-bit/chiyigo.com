# Test-fix — payments.test.ts:479 移除 dead+buggy KYC seed

**目標**：移除 `tests/integration/payments.test.ts:479` 的 **dead code + buggy** 一行 `await setUserKycStatus(env, u.id, KYC_STATUS.VERIFIED)`。**test-correctness fix**（非 noImplicitAny/reduce lane）。base main `204fadc`。

PR-2n 的 follow-up（三個之一，owner 選此最乾淨者先清）。

## 為什麼移除（而非修成 object）—— owner 拍板

`:479` 同時是**兩個問題**：
1. **buggy**：`setUserKycStatus(env, userId, patch)` 的 `patch` 應為 object，但這裡傳 **string** `KYC_STATUS.VERIFIED`（`'verified'`）→ 函式內 `p = patch as {...}`、`p.status` = `undefined` → UPSERT 實際寫入 **`status='unverified'`**（非 verified）。
2. **dead**：此測例（`[Codex r1 P0-1] user DELETE intent → soft delete`）的 DELETE handler `onRequestDelete`（`functions/api/auth/payments/intents/[id].ts:45`）用 **`requirePaymentAccess(request, env, { skipKyc: true })`** → **不 gate KYC**；且 `createPaymentIntent`（:480）是 **direct domain-call、無 endpoint KYC gate**。→ **此測例完全不依賴 KYC**，seed 結果**從不被讀/assert**，測試無論 KYC 狀態皆回 200。

→ seed 是從 sibling payment 測例（那些走 endpoint、真需 verified KYC，如 :175）**copy-paste 的殘留**。最乾淨的修法＝**刪掉**（移除 dead+buggy 行、使測例誠實表達「此 path 不需 KYC」），而非保留一個語法正確但 pointless 的 seed。

## Scout（對抗式驗證）

- **sweep**：`grep setUserKycStatus(…, KYC_STATUS.<x>)` 全 repo → **僅 :479** 一處 bare-string 誤用（其餘 caller 皆傳 object）。
- **DELETE handler**：`functions/api/auth/payments/intents/[id].ts:43-45` `onRequestDelete` → `requirePaymentAccess(..., { skipKyc: true })`（code-read 確認）。
- **createPaymentIntent**：domain util、test 直呼、無 KYC gate（`requirePaymentAccess` 才是 gate，在 endpoint 層）。
- **import 不會 orphan**：`:175` 仍用 `setUserKycStatus` + `KYC_STATUS`（`{ status: KYC_STATUS.VERIFIED, vendor: 'mock' }`）→ 移除 :479 後 import `:53` 仍 used。

## 改動

`tests/integration/payments.test.ts`：刪除 :479 整行
```diff
   const u = await seedUser({ email: 'soft@x' })
-  await setUserKycStatus(env, u.id, KYC_STATUS.VERIFIED)
   const intentId = await createPaymentIntent(env, {
```
（單行刪除；不動 import〔:175 仍用〕、不動測例其餘 setup/assert。）

## 不碰（byte-identical 測試行為）

- 此測例的 createPaymentIntent / userDeleteHandler 呼叫、200 斷言、soft-delete 斷言（`getPaymentIntent` 預設 null / includeDeleted deleted_at）全不動。
- payments.test.ts 其餘所有測例（含 :175 用 object 的正確 seed）不動。
- `functions/utils/kyc.ts` 的 `setUserKycStatus` 本體不動（patch=string 的 latent 行為仍在、但本 repo 無其他 caller 誤用——sweep 已證）。

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- **errorCount / errorFiles / cleanFiles 不變**（current 1042 / 119 / 185）。被刪那行本身**無 tsc error**（string→`{}` patch 當時合法編譯），移除它不改任何 error 計數。
- baseline file 不變（非 reduce PR、不跑 `--update`）。

## 風險

- **零行為風險**：DELETE path skipKyc:true + createPaymentIntent direct-call → 移除 seed 後該測例仍 200、soft-delete 斷言不變（KYC 從不參與）。
- **無 cascade**：單一 test 檔單行刪除、import 不 orphan。
- 不修 `setUserKycStatus` 本體（patch 容 string 的 latent 行為）——sweep 證無其他誤用，且那是型別契約議題、非本 test-fix scope。

## 驗證計劃（coding 階段）

- `npx vitest run --config vitest.workers.config.js tests/integration/payments.test.ts` → **全綠**（特別是 `[Codex r1 P0-1] user DELETE intent → soft delete` 仍 200 + soft-delete 斷言過）。
- `npm run lint` green（確認 `setUserKycStatus`/`KYC_STATUS` import 未 orphan）。
- `RATCHET_BASE_REF=204fadc npm run typecheck:ratchet` green（**1042 / 185 不變**，sanity）。
- **硬驗收**：diff 僅 payments.test.ts 單行刪除；無其他檔變動；ratchet 不變；目標測例與全 payments suite 綠。

## 流程定位

- test-correctness fix（行為相鄰、非 type-only）→ **full 四檢查點 + codex chain**（plan-gate = 本 doc；code-gate = 實際 diff）。owner 已選「刪除」方向。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy（無 prod 行為變更、smoke 為 deploy 健康確認）。
- 其餘兩個 PR-2n follow-up（kyc (143) / email Bearer undefined）owner 已裁定排後面（defer）。
