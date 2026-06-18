# Stage 7 reduce PR-2cg — utils/totp noImplicitAny（TOTP verify util 單檔 type-only，安全鎖 L3）

**目標**：`functions/utils/totp.ts` **4 個 noImplicitAny error → 0**，**純 type-only**（1 個編輯點＝單一函式簽名型別標註）。

> **主線定位（owner C-1）**：domain-batched cadence。mechanical-misc 域已清空（metrics #98 → ai/assist #99 → brute-force #101 → turnstile #102 `4ab5eef0`）。本 PR = `utils/totp.ts`，**折回 2FA/elevation/account 域的單檔起手**；owner 裁示 **(a) 單檔 PR-2cg**，不與 2FA handler/account 域混包（避放大 blast radius、守一檔一 PR 節奏）。

base main `4ab5eef0`（接 PR-2cf turnstile #102；`git rev-parse HEAD` 實查）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（單檔 mechanical type-only）/ review care **L2** / **安全鎖 L3 標準**（觸 TOTP / replay / 2FA 驗證路徑，Tier-0 鄰接）。走**完整 Dual Gate v3.1 四道外部審查、不 lighter**；self-review = L1 單 agent 對抗式（單檔 type-only）。
- 2026-06-18 **owner C-1 裁示 `APPROVED_TO_SPEC_AND_PLAN_WITH_LOCKS`**（非 coding approval）：scope = 本檔 noImplicitAny 清零、純 type-only；OD-1..5 全鎖（見 §型別選型）；2FA handler/account 檔全部隔離不得併入。
- 2026-06-18 Claude scout（read-only）→ caller cascade 靜態分析 → owner 裁示 → **本 doc + 非 commit spike 實證**（見 §Spike 實證，working tree 已 revert clean）。
- 2026-06-18 **ChatGPT Architecture Gate：`APPROVED_WITH_LOCKS`** — Scope / 架構方向 / 型別契約 / 安全語意 / Spike 證據 / Gate 流程 六項全過；鎖 **L1-L7**（L1 source-diff 僅 `totp.ts` 簽名、L2 runtime 不動、L3 `Pick<Env,'chiyigo_db'>`、L4 `code:unknown`、L5 `secret:string`、L6 不加 return type / 不清 JSDoc / 不做格式整理、**L7 不得宣稱本 PR 證明 constant-time**）。L1-L6 本 doc 原已 enforce；L7 措辭已收緊落 doc（見 §熱區聲明 註）。可前進 Codex Plan Gate。
- **下一步**：→ **Codex Plan Gate**（迭代審到過）→ `CODING_ALLOWED`（owner 明示）→ coding（凍結 diff 逐行重放）→ 實跑 gates → 自審 → **Codex Code Gate** → **ChatGPT faithfulness** → owner 明示同意才 squash-merge。

## ⚠ TOTP / replay 熱區敏感聲明（最高優先紀律，安全鎖 L3）

`utils/totp.ts` = `verifyTotpReplaySafe`：包一層 otpauth `TOTP.validate` 做 second-factor 驗證 + 用 `used_totp(user_id, slot)` PK 做一次性 replay 防護。被 7 個 source caller 共用（2FA verify / disable / activate / backup-codes regenerate、step-up、reset-password、elevation `verifySecondFactor`）— **Tier-0 鄰接**。

owner / gate 紀律：**修法若非純型別、或會牽動以下任一 → 立刻停手回 `PLAN_DRAFT`，不硬寫**：
- `String(code ?? '').replace(/\s/g, '')` sanitize 語意
- `^\d{6}$` 格式 regex
- `new TOTP({ algorithm:'SHA1', digits:DIGITS, period:PERIOD_SEC })` 演算法/參數
- `Secret.fromBase32(secret)` secret 解析
- `totp.validate({ token, window })` 驗證視窗（含 `window = 1` default）
- `Math.floor(Date.now()/1000/PERIOD_SEC)` time-step slot 計算 + `currentSlot + delta`
- `INSERT INTO used_totp (user_id, slot)` replay 防護 SQL + PK 約束
- `catch { return { ok:false, reason:'replay' } }` 保守 fail 行為（其他 DB 錯誤也不放行）
- 常數 `PERIOD_SEC=30` / `DIGITS=6`

註：**TOTP secret 生成（randomness）不在本檔**（本檔只驗證）；**token comparison 在 otpauth dependency 內部、本 PR 不觸碰**（依 Arch Gate **L7**：本 PR 為 type-only，**不宣稱證明 constant-time 性質**，僅陳述比較邏輯不在本 diff 面）。TS erase 後 runtime 行為必須 byte-identical（SQL / 常數 / regex / 字串 / 註解不變；簽名多行展開屬 formatting）。

### Coding 階段硬性邊界

- **允許**：`verifyTotpReplaySafe` 單一簽名的參數型別標註（`env` + destructure pattern type）。
- **禁止**：改 SQL、改 regex、改 `validate` / `window` default、改 `Secret.fromBase32`、改 time-step / slot、改 `used_totp` insert、改 catch 保守行為、改常數、改 caller、改 tests、改 tsconfig / eslint / vitest、加 return type、清 JSDoc、新增 any / suppression / global / import / package、任何「順手修正」。

## Scout（對抗式驗證，命令真輸出）

### exact errors（forced `tsc -b tsconfig.functions.json --force` @ `4ab5eef0`，total 847）
```
functions/utils/totp.ts(24,44): TS7006 Parameter 'env'
functions/utils/totp.ts(24,51): TS7031 Binding element 'userId'
functions/utils/totp.ts(24,59): TS7031 Binding element 'secret'
functions/utils/totp.ts(24,67): TS7031 Binding element 'code'
```
恰 **4 個**（baseline file `types/typecheck-baseline.json` 同記 `"functions/utils/totp.ts": 4`）。全集中單一簽名（L24）：`env`（TS7006）+ destructure `userId/secret/code`（TS7031 ×3）。`window = 1` 有 default → 推得 `number`、**不報、不需動**。

### 依賴邊界（caller cascade 逐一驗證）

repo-wide grep `verifyTotpReplaySafe` → **7 個 source caller**、**0 個 test 直接 import 本 util**（測試走端點，間接）。逐檔 functions build error count + 傳入值型別：

| caller | 現狀 err | handler typed? | 傳入 totp 的值型別 | cascade |
|---|---|---|---|---|
| `api/auth/2fa/verify.ts:96` | 0 | ✅ typed (PR-2u) | `userId`=number / `secret`=`record.totp_secret`(**any**, D1 `.first()` [[feedback_d1database_resolves_any_no_workers_types]]) / `code`=`sanitized`(string) | 風險源① |
| `utils/elevation.ts:53` | 0 | ✅ typed | 經 wrapper `verifySecondFactor(env: Env, { userId: number; secret: string; code: unknown })` → 傳 `userId`=number / `secret`=string / `code`=`sanitized`(string) | 風險源② |
| `api/auth/2fa/disable.ts:53` | 2（handler） | ❌ | 全 `any` | 0 |
| `api/auth/2fa/activate.ts:95` | 2（handler） | ❌ | 全 `any` | 0 |
| `api/auth/2fa/backup-codes/regenerate.ts:51` | 2（handler） | ❌ | 全 `any` | 0 |
| `api/auth/step-up.ts:119` | 2（handler） | ❌ | 全 `any` | 0 |
| `api/auth/local/reset-password.ts:99` | 2（handler） | ❌ | 全 `any` | 0 |

**判定**：只有 verify.ts + elevation.ts 是 typed caller（cascade 風險源）；兩者傳 `userId`=number、`secret`=string|any、`code`=string，**對下方選型全 assignable**。其餘 5 個 handler 未 typed → 傳 `any` → 結構性零 cascade。tests leaf `noImplicitAny:false` + 無 test 直呼本 util → tests 域零 cascade。**（spike sort-diff added=0 + tests-leaf exit 0 實證，見 §Spike）**

### 型別選型（owner C-1 OD rulings；Convention A inline）

允許落地的唯一 source diff：
```ts
export async function verifyTotpReplaySafe(
  env: Pick<Env, 'chiyigo_db'>,
  { userId, secret, code, window = 1 }: { userId: number; secret: string; code: unknown; window?: number },
) {
```

| OD | 裁示 | 理由 |
|---|---|---|
| OD-1 sequencing | **單檔 PR-2cg** | `totp.ts` 自足 util、4 錯集中單簽名；不與 2FA handler/account 混包（放大 blast radius、違一檔一 PR） |
| OD-2 `env` | **`Pick<Env, 'chiyigo_db'>`** | util 只讀 `env.chiyigo_db`；沿 turnstile(`Pick`)/cors.ts:34/brute-force(`Env['chiyigo_db']`) util 收斂方向 + [[feedback_util_env_param_pick_not_full_env]] |
| OD-3 `code` | **`unknown`** | 與 `verifySecondFactor` 的 code input 語意一致 + 本檔 `String(code ?? '')` 防禦式契約；改 `string` 反把 util contract 寫窄 |
| OD-4 `secret` | **`string`** | `Secret.fromBase32(secret)` 需 string；`unknown` 會 TS2345（正確邊界） |
| OD-5 return type / JSDoc | **不加 / 不清** | 沿 PR-2cf 鎖：本刀只處理 TS7006/TS7031，不做格式與文件整理 |
| — `userId` | `number` | 兩 typed caller 皆傳 number；內部 `.bind(userId, ...)` 對型別無約束（D1 resolves any） |
| — `window` | `window?: number`（type 內） | 有 default `= 1` 故 destructure 引用必入 type annotation；**僅標型別，不改 default、不 coerce**。其值流入 `validate({token, window})` 安全敏感呼叫 → annotation-only |

**考慮過、否決**：`env: Env`（過寬、非 util 慣例；verify.ts 選 full Env 是 handler 用 `cloudflare:test` 完整 env 的理由，不適用 util）；`code: string`（窄於 contract、與 `verifySecondFactor` 不一致）；`secret: unknown`（`Secret.fromBase32` TS2345）；加 `Promise<...>` return 標註（無 error 驅動、非最小 diff、OD-5 鎖）；清 JSDoc（OD-5 鎖）。

## Spike 實證（full-solution，本地未 commit，2026-06-18，已 revert clean）

**程序**：套 1 編輯點 → byte-identical（esbuild stdin transform）→ 清 `.tscache` → forced `tsc -b tsconfig.functions.json` → 清 `.tscache` → forced `tsc -b tsconfig.tests.json` → 清 `.tscache` → canonical `--report` → 單檔 eslint → `git diff --stat`/`--check` → targeted int ×5 → `git restore` → 驗 clean。

**單輪達標**（scout caller cascade 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| `totp.ts` errors 4 → 0 | ✅ forced tsc filter `totp.ts` 0 殘留 |
| total errorCount 847 → 843（恰 −4） | ✅ forced tsc 843；sort-diff REMOVED = 恰那 4 行 totp param 錯、ADDED = **空** |
| zero cascade（functions + tests leaf） | ✅ sort-diff added=0；`tsc -b tsconfig.tests.json --force` **exit 0 / 0 error TS** |
| canonical `--report` | ✅ errorCount **843** / errorFiles **94** / cleanFiles **240** / sourceFilesTotal 334 |
| **bundle byte-identical**（TS erase 後 runtime 不變硬保證） | ✅ esbuild **stdin** type-strip base(`4ab5eef0`) vs HEAD：皆 **936 bytes（非空）**、`diff` IDENTICAL、sha256 兩端皆 `b1e68e9946ecd16b924267b0bd3b79584b8fa5e27ed4f1786bc2bbd92420602b`、esbuild stderr 空（避 `--loader` file-entry 空輸出陷阱 [[feedback_byte_identical_emit_verification]]） |
| lint | ✅ `npx eslint functions/utils/totp.ts` exit 0 |
| 無新增檔案 / 無 caller·test·config diff | ✅ `git diff --stat` 僅 `totp.ts`（+4/−1）；`git diff --check` clean |
| targeted int（標註套用狀態實跑） | ✅ `2fa-verify` + `step-up` + `reset-password-2fa` + `elevation-endpoints` + `change-password` = **50 passed / 5 suites / 21.8s**（含「正確 TOTP→200」「正確 TOTP→200 grant」「backup code 核銷」「concurrent step-up P0-3」等真實 validate+replay 路徑） |
| working tree revert clean | ✅ `git restore` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、HEAD `4ab5eef0` |

**byte-identical 適用性說明**：`totp.ts` 有 1 個 import（`otpauth`）→ esbuild stdin transform **適用**（單檔 transform 證明，import 行原樣保留；非完整 bundle，但 type-only annotation PR 這正是對的證明面）。

## 預期 ratchet

- clean main `4ab5eef0` `--report`：errorCount **847** / errorFiles **95** / cleanFiles **239** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **847 → 843**（−4）、errorFiles **95 → 94**、cleanFiles **239 → 240**（spike 實測值，非預測）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 型別標註，TS erase 後 runtime byte-identical（§Spike sha 實證）；targeted int 50 例已在標註狀態實跑證明（含 TOTP success / backup code / replay-adjacent / step-up concurrent 路徑）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 847、零殘留。

## 測試影響面（覆蓋誠實，[[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf exit 0 實證）。
- **direct unit test = 0**（無 `totp.test.ts`、無 test import `verifyTotpReplaySafe`）→ **不宣稱 direct coverage**。
- **indirect integration 覆蓋實質且真**（優於 PR-2cf turnstile 的 skip-path）：**7 個 integration test 檔直接 `import ... from 'otpauth'`**（2fa-verify / step-up / elevation-endpoints / reset-password-2fa / reset-2fa-bruteforce / change-password / rate-limit）；`2fa-verify.test.ts:45` `freshOtp()` 用 `new TOTP(...).generate()` 產真實 code 打端點 → 實打 `verifyTotpReplaySafe` 的 validate success + `used_totp` replay INSERT 路徑。本 PR spike 跑其中 5 suite / 50 例綠（未跑 reset-2fa-bruteforce / rate-limit，coding 階段可補）。
- **byte-identical** = direct 層缺位的硬保證補強（與 turnstile 同策略）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`。**PowerShell 用 `$env:RATCHET_BASE_REF='4ab5eef0'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='4ab5eef0'; npm run typecheck:ratchet` green（847→843 / 95→94 / 239→240）。
- `npm run lint` green（全量）、`npm run build:functions` green。
- filtered forced tsc：`totp.ts` 0 殘留 + sort-diff added=0 + `tsc -b tsconfig.tests.json --force` exit 0。
- byte-identical：esbuild stdin base(`4ab5eef0`) vs source → 936B / sha `b1e68e99…` 一致、非空。
- targeted int：`npm run test:int -- tests/integration/2fa-verify.test.ts tests/integration/step-up.test.ts tests/integration/reset-password-2fa.test.ts tests/integration/elevation-endpoints.test.ts tests/integration/change-password.test.ts`（50 例）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §型別選型 凍結 diff **逐行一致**（人審 `git diff -- functions/utils/totp.ts`）；超出 = scope creep = Gate fail。

---

## 附：owner C-1 鎖定表（faithful 收錄）

### 風險表
| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| TOTP 驗證語意漂移 | 高 | 2FA fail-open/close 變化 | 僅改 L24 type annotation；禁動 `validate`/`window=1`/regex/`Secret`/catch |
| replay 防護漂移 | 高 | 重放 TOTP code | 禁動 `used_totp` insert / time-step slot / catch |
| caller cascade | 中 | typed caller 新增錯 | forced tsc 若 `totp.ts` 外新增錯立即停（spike added=0 已證） |
| `window` 型別誤改 | 中 | 驗證容忍視窗改變 | 只標 `window?: number`，禁 coerce / 改 default / 改 validate window |
| 無 direct test | 中 | 單元層無直接保護 | byte-identical + integration indirect |

### 防禦表
| 機制 | 處理 | 實作 / 未處理因 |
|---|---|---|
| RateLimit | 否 | 不動 caller/endpoint（util type-only） |
| 權限 | 否 | 語意在 caller、不在本刀 scope |
| Input | 是 | `code: unknown` 保留 `String(code ?? '')` contract；不新增 runtime validation |
| XSS | N/A | 無 HTML/DOM |
| Log / Retry / 備援 / 監控 | 否 | 不新增 log/metric；不動 DB write/replay；保留 catch 保守 fail |

### DB 鎖定
| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Unique | 不改 `used_totp` replay 既有約束 |
| SoftDel / N+1 / Page / Backup | 不相關 |

### 隔離區 / 鎖定區
- **隔離區**：2FA handler/account 檔（disable/activate/regenerate/verify handler、2fa-account ≈50、step-up/reset-password handler）全部**不得併入 PR-2cg**。
- **鎖定區**：TOTP regex、`Secret.fromBase32`、`validate` window、`Date.now` slot、`used_totp` insert、catch fail behavior、return type/JSDoc。
