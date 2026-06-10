# Stage 7 reduce PR-2q — utils/password noImplicitAny（auth-core 單檔 codex chain 首發）

**目標**：`functions/utils/password.ts` **1 個 noImplicitAny error → 0**，**純 type-only**（`pw: unknown`）。

> **主線切換（owner 拍板 2026-06-10，C-1）**：非熱區低風險 endpoint batch 已 PR-2a..2l 清光（PR-2p scout 證實），承認 reduce 已抵 **auth-core**。**不再硬找低風險 batch**，改走「auth-core 單檔 codex chain」。`password.ts` 作首發＝最小核心（1 err、純 utility、blast radius 比 endpoint/token/middleware 小、有 targeted unit test），用來**校準 auth-core 單檔模板**，再接 role-change.ts → roles.ts → risk-score.ts〔單獨 plan-gate〕→ 2fa/verify → _middleware〔最後、blast radius 最大〕。

base main `217e796`（接 PR-2p）。

## Scout（對抗式驗證，含 spike 實證）

### exact error（forced tsc，base `217e796`、total 1022）
```
functions/utils/password.ts(11,34): error TS7006: Parameter 'pw' implicitly has an 'any' type.
```
**僅 1 個**——唯一 export `validatePassword(pw)` 的 `pw` 參數無型別標註。檔內 JSDoc 已寫 `@param {unknown} pw`，但 **.ts 檔的 JSDoc type 不被 TS 採用**（[[feedback_ts_no_jsdoc_in_ts_mode]]）→ implicit-any。

### 純 type-only 確認（owner 紀律：非純型別 / 牽 runtime policy 即停手回報）
- fix = `pw: unknown`（**對齊既有 JSDoc `@param {unknown}`**）。
- 函式 body 全程 `typeof pw !== 'string'` 先窄化 → `pw.length` / 正則 `.test(pw)` 對 narrowed `string` 合法（spike 證 0 殘留）。
- **密碼強度規則（長度 ≥12 / ≥8+3 類）、error 字串、回傳 shape 完全不碰** → 無 runtime policy 變更。**確認純 type-only，繼續出 plan**。

### 為何 `unknown` 而非 `string`（關鍵 cascade 點）
`tests/password.test.ts` **故意傳非字串測 type guard**：`validatePassword(undefined)` / `(null)` / `(12345678)`（number）。
- `pw: unknown` → 三者皆 assignable（任何型別 → `unknown`）→ **0 新 TS2345、test 不需改**。
- `pw: string` → number/null/undefined 觸 TS2345 → **tests-leaf cascade、且要改 test**（破壞「type guard 該擋非字串」的測試意圖）。
→ `unknown` 是唯一正確解（語意 = 「邊界 untrusted 輸入、窄化前」，符 §安全要求 input validation 精神）。

### callers（3 個，皆傳值非取窄型別）
`api/auth/account/change-password.ts`、`api/auth/local/register.ts`、`api/auth/local/reset-password.ts` 各 `validatePassword(<body 值>)`。傳入值 → assignable 到 `unknown` ✓。回傳型別由 literal 推斷（`{ ok: false; error: string } | { ok: true }`），**不因 param any→unknown 改變** → caller 讀 `.ok`/`.error` 不受影響、零 cascade。

### spike 實證（已 revert）
套 `pw: unknown` 後 `tsc -b --force`：
- password.ts 1 → **0**。
- 全量 file-errors 1022 → **1021**（淨 **−1**）。
- **零 cascade 數學證明**：只改 1 檔、total 恰 −1 == password 釋放的 1 → 其他所有檔（含 3 caller 的既存 error）計數完全未變。
- `--report`：errorFiles 115 → **114**、cleanFiles 189 → **190**。
- `tests/password.test.ts` **5/5 passed**（runtime byte-identical）。

## 改動（source scope = 1 檔，純 type-only）

### `functions/utils/password.ts`（1 處）
```ts
export function validatePassword(pw: unknown) {
```
- **不碰**：JSDoc 註解、`typeof pw !== 'string'` guard、長度/字元類別規則、所有 error 字串、回傳 shape、回傳型別（保持 literal 推斷，已正確且對齊 JSDoc `@returns`）。

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `217e796` `--report` 現況：errorCount **1022** / errorFiles **115** / cleanFiles **189** / sourceFilesTotal 304。
- 本 PR 後 **current ratchet state**：errorCount **1022 → 1021**（−1）、errorFiles **115 → 114**（−1）、cleanFiles **189 → 190**（+1，password.ts 全清）。
- baseline file 不變，天花板保留 errorCount **1119** / cleanFiles **175**（reduce PR 不跑 `--update`）。

## Tier / 風險

- **auth-core util，但純 type-only**：改動僅 1 個參數 `any → unknown`（更嚴格、非更寬鬆），TS erase 後 runtime **零變化**。
- **blast radius 最小**：1 export、3 caller（皆傳值）、1 targeted unit test。
- **零 cascade（含 tests-leaf）**：spike 數學證明 total 恰 −1；`password.test.ts` 非字串引數對 `unknown` 全 assignable（5/5 pass）；3 caller 回傳型別不變。
- 無新 global、無新套件、無 tsconfig 改動。

## 驗證計劃（coding 階段）

> ⚠ ratchet/tsc 量測前先清 `.tscache` 全重建（PowerShell `Remove-Item -Recurse -Force .tscache` 或 `tsc --force`，**勿照字面跑 POSIX `rm -rf`**）。**PowerShell 用 `$env:RATCHET_BASE_REF='217e796'`**（勿照字面跑 POSIX `VAR=x npm`，否則 fallback HEAD~1）。

- `$env:RATCHET_BASE_REF='217e796'; npm run typecheck:ratchet` green（current 1022→1021 / errorFiles 115→114 / cleanFiles 189→190）。
- `npm run lint` green、`npm run build:functions` green。
- **filtered forced tsc**：確認 `password.ts` **0 殘留** + 無其他檔 error 增加（零 cascade）。
- **targeted test**（owner 指定）：`npx vitest run tests/password.test.ts`（直接 import validatePassword；含非字串 / 太短 / ≥12 / 8–11+3 類 / 2 類拒絕路徑）。
- **硬驗收**：source diff 僅 `password.ts` 第 11 行 `pw` → `pw: unknown` 一處；規則 / error 字串 / 回傳 shape **byte-identical**；ratchet 淨降剛好 **1**、零 cascade。

## 測試覆蓋誠實

`password.test.ts` 5 例實跑覆蓋 validatePassword 的非字串拒絕 / 長度 / 字元類別全分支。callers（change-password/register/reset-password）的 validatePassword 串接由 `register.test.ts:91`「弱密碼→400」整合測試間接涵蓋（非本 PR 必跑 gate、不宣稱）。

## 流程定位（auth-core 單檔模板）

- auth-core util → **full 四檢查點 + codex chain**（plan-gate = 本 doc；code-gate = 實際 source diff）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy（撞 `jwt.test` flake 就 rerun --failed），補 credential-free prod smoke（password.ts 無自身端點 → smoke 確認 deploy 健康 + register/change-password/reset-password route 載入）。
- **下一刀（owner 排序）**：role-change.ts 單檔 → roles.ts → risk-score.ts〔單獨 plan-gate〕→ 2fa/verify → _middleware〔最後〕。
