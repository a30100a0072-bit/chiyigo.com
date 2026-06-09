# Stage 7 reduce PR-2n — utils/kyc noImplicitAny（Partial −8，fail-closed 降級）

**目標**：`functions/utils/kyc.ts` **9 noImplicitAny → 1**（純 type-only），net **−8**。**classification = small-surface compliance-adjacent utils PR**（非「low-sensitivity」——`requireKyc` 是 KYC/entitlement gate，gate 提款等高權限操作）。base main `4ad0040`（接 PR-2m）。

> **為何是 Partial −8 而非 Full −9（owner fail-closed 裁定）**：唯一無法在本檔乾淨清掉的是 **(143) TS7018**（`{ user: null, error }` 在 `strictNullChecks:false` 下 `null` literal 推成 `any`）。要清它須給 `requireKyc` explicit return type，其 `user` 只能從 `requireAuth` 衍生——但 **`requireAuth` success 回 `{ user: payload }`、`payload` 來自未型別化的 `verifyJwt`（jwt.ts，auth-core，35 errors）**。owner 定：只有 spike 證明衍生 user **不是 any** 才准 Full −9，否則降 Partial −8、**不准用 derived-any return type 蓋掉 143**。**spike 已證 = any → Full 撤回 → Partial −8**（anti-any 證據見下）。(143) 留待 auth-core（jwt/requireAuth）typed 或 `strict:true` 後自然消。

## Anti-any 證據（owner 要求附）

kyc.ts 已 import `requireAuth`。注入探針：
```ts
type __IsAny<T> = 0 extends (1 & T) ? true : false
const __probe: __IsAny<Awaited<ReturnType<typeof requireAuth>>['user']> = false
```
`tsc -b tsconfig.solution.json --force` → **`kyc.ts: error TS2322: Type 'false' is not assignable to type 'true'`** → `__IsAny<…>` 解為 `true` → **衍生 user = `any`**。故 Full −9 fail-closed 撤回。探針已 revert（throwaway spike）。

## Scout（對抗式驗證 + spike）

`npx tsc -b tsconfig.solution.json --force` 實證 kyc.ts **9 errors**：

| line:col | code | 點 | 本 PR |
|---|---|---|---|
| (45,40)(45,45) | TS7006 | `getUserKycStatus(env, userId)` | ✅ 修 `env: Env, userId: number` |
| (78,40)(78,45) | TS7006 | `setUserKycStatus(env, userId, patch={})` | ✅ 修 `env: Env, userId: number`（**patch 不動**——已 `{}` 非 implicit-any） |
| (138,34)(138,43) | TS7006 | `requireKyc(request, env, opts={})` | ✅ 修 `request: Request, env: Env` |
| (143,23) | **TS7018** | `return { user: null, error }` 的 `user` | ❌ **留**（auth-core-coupled，見上） |
| (210,35) | TS7006 | `resolveKycAdapter(vendor)` | ✅ 修 `vendor: string` |
| (211,10) | TS7053 | `ADAPTERS[vendor]` string-index | ✅ 修 `ADAPTERS: Partial<Record<string, typeof mockKycAdapter>>` |

**Partial spike 實證**（params + ADAPTERS fix，已 revert）：kyc.ts → **剩 1（僅 143）**；total errorCount **1050 → 1042（−8）**；caller（`auth/kyc/status.ts`/`webhooks/kyc/[vendor].ts`/`payments.ts`）的既有 error **不變、無新增**（net = 剛好 kyc.ts 的 −8 → **零 cascade**）。

## 端點 / 用途

- `getUserKycStatus(env, userId)`：thin D1 read（`user_kyc`）；callers = `auth/kyc/status.ts`、`payments.ts`（withdraw gate）、`kyc.test.ts`。
- `setUserKycStatus(env, userId, patch)`：D1 UPSERT；callers = `webhooks/kyc/[vendor].ts`、kyc/payments 多個 test。**patch 維持 `= {}`（default 推出非 implicit-any、不在本 PR 收）**。
- `requireKyc(request, env, opts)`：KYC entitlement gate（同 requireScope pattern）；caller = `kyc.test.ts`（prod gate 走 `payments.ts` 自己的 getUserKycStatus）。
- `resolveKycAdapter(vendor)`：webhook adapter dispatch；caller = `webhooks/kyc/[vendor].ts`。

## 改動（純 type-only）

1. **`getUserKycStatus(env: Env, userId: number)`**
2. **`setUserKycStatus(env: Env, userId: number, patch = {})`**（patch byte-identical）
3. **`requireKyc(request: Request, env: Env, opts: {...} = {})`**（opts 已具型別）
4. **`resolveKycAdapter(vendor: string)`**
5. **`const ADAPTERS: Partial<Record<string, typeof mockKycAdapter>> = { mock: mockKycAdapter }`**（衍生型別、非新 named abstraction；`Partial` 保 unknown-vendor → `undefined` → `?? null` 的現行 runtime 語意，不過度宣稱每個 string 都有 adapter）
6. **不碰 (143)**：保留 `return { user: null, error }`（auth-core-coupled residual）

## 不碰（runtime byte-identical）

- 所有 D1 SQL（`getUserKycStatus` SELECT、`setUserKycStatus` UPSERT 含 fields/placeholders/bind 順序）、過期判斷 `Date.parse(...)`、KYC_STATUS/KYC_LEVEL/VALID_* 常量
- `requireKyc` 的 `requireAuth` gate、status/level 比對、`kyc.gate.fail` audit、403 envelope（KYC_REQUIRED / KYC_LEVEL_INSUFFICIENT）
- `resolveKycAdapter` 的 `ADAPTERS[vendor] ?? null` 行為（unknown vendor → null）
- **patch 處理**（`patch = {}` + `const p = patch as {...}`）、所有 throw（Invalid KYC status/level）

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `4ad0040` 現況：errorCount **1050** / errorFiles **119** / cleanFiles **185** / sourceFilesTotal **304**。
- 本 PR 後 **current ratchet state**：errorCount **1050 → 1042**（−8）、errorFiles **119 → 119**（**不變**——kyc.ts 留 1 residual、仍在 errored set）、cleanFiles **185 → 185**（**不變**——kyc.ts 不入 clean）。
- **⚠ 首個 partial reduce PR**：不同於 PR-2a~2m「單檔全清 +1 cleanFile」，本 PR 刻意留 (143)，故 errorFiles/cleanFiles 不動、僅 errorCount −8。理由＝fail-closed（見上），非遺漏。
- baseline file 不變，天花板 errorCount 1119 / cleanFiles 175（reduce PR 不跑 `--update`）。

## Tier / 風險

- **compliance-adjacent**（`requireKyc` gate 提款）：改動純參數型別 + 1 個 const 型別標註，TS erase 後 runtime **零變化**。
- **零 cascade（spike 實證）**：net errorCount −8 = 剛好 kyc.ts 的降幅；callers 既有 error 不變。`env: Env` 不觸發 D1-row cascade（spike 證 `.first()` → `any`，`row.expires_at.replace()` 不報錯）。`Partial<Record<string, typeof mockKycAdapter>>` 的 `resolveKycAdapter` 回傳 `typeof mockKycAdapter | null`，`webhooks/kyc/[vendor].ts` 既有 null-check + `.parseWebhook` 相容（無 caller cascade，net 已證）。
- **(143) residual 是已知、已記錄**：strictNullChecks-off 的 null-as-any artifact，auth-core typed 後消；本 PR 不引入 derived-any 蓋掉它（owner 紀律）。

## 驗證計劃（coding 階段）

- `RATCHET_BASE_REF=4ad0040 npm run typecheck:ratchet` green（current 1050→1042 / errorFiles 119 不變 / cleanFiles 185 不變）。
- `npm run lint` green、`npm run build:functions` green。
- 整合測試（**owner 指定**，因 getUserKycStatus/setUserKycStatus 被 payment flows 直用）：
  - `tests/integration/kyc.test.ts`（getUserKycStatus / setUserKycStatus / requireKyc gate / UPSERT / invalid status throw / adapter）
  - **payments targeted**：`tests/integration/payments.test.ts` + `tests/integration/payments-ecpay.test.ts`（withdraw KYC gate 路徑；含 :479 string-patch 既有行為驗證不變）
  - 跑：`npx vitest run --config vitest.workers.config.js tests/integration/kyc.test.ts tests/integration/payments.test.ts tests/integration/payments-ecpay.test.ts`
- 全 `tsc --force` 確認 kyc.ts **剩剛好 1（143）**、total **−8**、無 caller cascade。
- **硬驗收**：source diff 僅 5 處 type 標註（4 param sites + 1 ADAPTERS const）；SQL / UPSERT / audit / gate / patch / throw byte-identical；(143) 原樣保留；ratchet errorCount −8 / errorFiles·cleanFiles 不變。

## Follow-up（不在本 PR）

1. **(143) TS7018**：auth-core（jwt/requireAuth）typed 或 `strict:true` 後，給 `requireKyc` 衍生 return type 一次清掉。
2. **`payments.test.ts:479` 既有測試 bug**：`setUserKycStatus(env, u.id, KYC_STATUS.VERIFIED)` 傳 **string** 當 patch（應 `{ status: KYC_STATUS.VERIFIED }`）→ `p.status` undefined → 實際寫入 UNVERIFIED 非 VERIFIED。本 PR type-only 不動（patch 未 retype、編譯與行為皆 byte-identical）。屬 **test-correctness fix**，另案。

## 流程定位

- compliance-adjacent、純 type-only → **full 四檢查點 + codex chain**（plan-gate = 本 doc + local diff〔含 anti-any 證據〕；code-gate = 實際 source diff）。
- 後續（不在本 PR）：PR-2o request.cf canonical typing（解鎖 device-alerts + risk-score）→ 低敏感 utils 續收 → auth-core（每檔確認）→ 熱區 codex chain；cors.ts 按 security-boundary PR 單獨處理（~20 caller 爆炸面）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy，補 credential-free prod smoke。
