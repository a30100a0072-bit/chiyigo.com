# Stage 7 reduce PR-2cj — change-password + identity/unbind noImplicitAny（2 檔 auth 熱區 type-only，安全鎖 L3）

**目標**：2 個 auth handler 的 **4 個 noImplicitAny error（TS7031 ×4 handler destructure）→ 0**，**純 type-only**（每檔 1 個編輯點＝`onRequestPost` 簽名 destructure 型別標註）。

**Scope（owner C-1 鎖；2 檔一包，禁併入他檔）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/account/change-password.ts` | 2（L40 handler） | `onRequestPost` 簽名 |
| `functions/api/auth/identity/unbind.ts` | 2（L18 handler） | `onRequestPost` 簽名 |
| **合計** | **4（全 TS7031）** | **2 個編輯點** |

> **主線定位（owner C-1）**：A 域 handler 層。PR-2ch 清 A1 五檔 TOTP-caller handler（disable/activate/regenerate/step-up/reset-password，#104 `176bf542`）→ PR-2ci 清 `2fa/setup.ts`（#105 `9fcc095c`）。本 PR = **A2 兩檔小批**（`change-password.ts` + `identity/unbind.ts`）。owner 2026-06-19 裁 **兩檔一包**（同構、各 2×TS7031、皆 single-destructure handler），**排除 `auth/delete.ts`**（destructive + `onRequestPost(ctx)` wrapper／內層 `handleDelete({ request, env })` worker 雙 function 結構、修法形態與本批 single-destructure handler 不同 → PR-2ck 單獨成棒、走 full）。

base main `9fcc095c`（接 PR-2ci #105；`git rev-parse HEAD` 實查）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、2 檔同構）/ review care **L2**（多檔 auth 熱區批次）/ **安全鎖 L3**（`change-password` = step-up-gated 改密 + `bumpTokenVersion` 撤全 token；`unbind` = 防自殺 last-auth-method + identity 解綁；皆 Tier-0 鄰接）。走**完整 Dual Gate v3.1 四道外部審查、不 lighter**。
- **self-review = multi-agent workflow**（多檔 auth 熱區批次；**不可因 scout/spike 乾淨度降單 agent**，引 [[feedback_self_review_form_not_downgradable_by_spike]]；rubric 收斂 **scope drift / runtime·security drift / evidence integrity** 三維，不擴全域）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-19 裁示 scope = A2 兩檔一包、typing Convention A 鎖定（見 §型別選型）、`auth/delete.ts` + A3 + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only）→ 兩檔逐檔 error set + caller cascade 靜態分析 + 測試覆蓋分層 + byte-identical 適用性。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 revert clean）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ⬜ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow，三維 rubric）
  - ⬜ `CHATGPT_ARCH_APPROVED`（維度 B）
  - ⬜ `CODEX_PLAN_APPROVED`（維度 C）→ `CODING_ALLOWED`
  - ⬜ `CODE_SELF_REVIEW_CLEAN` → `CODEX_CODE_APPROVED`（維度 C）
  - ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（維度 B，v3.1 任何級別全走）→ `MERGE_ALLOWED` → `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪回應外部 gate 的修正）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。

## owner 鎖定表（L1-L10，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 僅 `change-password.ts` + `identity/unbind.ts` 兩檔 |
| L2 Edit Point | 各檔僅 handler destructuring annotation（各 1 編輯點） |
| L3 Type-only | emitted JS 必 byte-identical |
| L4 Exclusion | 不得碰 `auth/delete.ts` |
| L5 Security Hot Zone | 不得改 step-up、password hash/salt、token version bump、identity count（防自殺）、provider allowlist、SQL、audit、response body |
| L6 Env | 不改 `types/env.d.ts`、不新增 env key |
| L7 Tests | 不為過 PR 改 tests；只跑既有 tests |
| L8 Evidence | plan + code 階段都重跑 ratchet / sort-diff / byte-identical / tests-leaf |
| L9 Coverage | `change-password` 可宣稱 direct test + byte-identical；`unbind` 僅 byte-identical（無 direct/indirect） |
| L10 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰 `delete.ts` → 退回 `PLAN_DRAFT` |

## ⚠ change-password / identity-unbind 熱區敏感聲明（最高優先紀律，安全鎖 L3）

2 檔皆為高權限 auth handler，**Tier-0 鄰接**。修法若非純型別、或會牽動下列任一逐檔紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L5）：

| 檔 | Tier-0 紅線（typing 全程不得牽動） |
|---|---|
| `account/change-password.ts`（step-up-gated 改密） | `requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'change_password')` 一次性 jti gate（內部 `revokeJti` + 嚴格 scope、不走 role fallback）· `validatePassword` 密碼政策 · `generateSalt()` + `hashPassword()` · `users` `status==='banned'` / `deleted_at IS NULL` gate · `INSERT … ON CONFLICT(user_id) DO UPDATE`（UPSERT local_accounts，OAuth-only 首設密碼，保持 `totp_enabled=0`）· **`bumpTokenVersion(db, userId)` 撤所有 token（含 step_up_token 本身）** · audit `account.password.change`（severity=warn，`via=step_up`）· response body |
| `identity/unbind.ts`（OAuth 解綁） | `requireAuth(request, env)` 身份閘門 · `ALLOWED_PROVIDERS` Set 白名單（google/discord/line/facebook）· `users` `status==='banned'` / `deleted_at IS NULL` gate · **防自殺 Minimum Auth Rule（`localCount + identityCount <= 1` reject）** · provider-bound 確認 `SELECT 1 FROM user_identities WHERE user_id=? AND provider=?` · `DELETE FROM user_identities WHERE user_id=? AND provider=?` · audit `oauth.identity.unbind`（severity=warn）· response body |

註：本刀只在 2 個 handler 簽名加 destructure 型別標註。TS erase 後 runtime 必 byte-identical（SQL / 常數 / 白名單 / audit event·level / 字串 / 註解不變）。

### Coding 階段硬性邊界

- **允許**：每檔 `onRequestPost` 單一簽名的 destructure pattern 型別標註（`{ request, env }: { request: Request; env: Env }`）。
- **禁止**：改任何 SQL / `requireStepUp`·`requireAuth` gate / `validatePassword` / hash·salt / `bumpTokenVersion` / `ALLOWED_PROVIDERS` 白名單 / 防自殺 count 邏輯 / `INSERT…ON CONFLICT`·`DELETE` / audit event·level·payload / response body / caller / tests / `tsconfig`·`eslint`·`vitest` / `env.d.ts` / 加 return type / 清·改 JSDoc / 新增 any·suppression·global·import·package / **碰 `auth/delete.ts`** / 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `9fcc095c`）

### exact errors（forced `tsc -b tsconfig.functions.json --force`，functions total 831）

```
functions/api/auth/account/change-password.ts(40,39): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/account/change-password.ts(40,48): error TS7031: Binding element 'env' implicitly has an 'any' type.
functions/api/auth/identity/unbind.ts(18,39): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/identity/unbind.ts(18,48): error TS7031: Binding element 'env' implicitly has an 'any' type.
```

恰 **4 個、100% TS7031**（`request`+`env` binding element ×2 檔）。**每檔僅 handler destructure 報錯、檔內 helper/callback 全 0 error**（change-password：`Number(user.sub)` / `db.prepare(...)` 操作 typed 回傳 + D1 `any`；unbind：`Promise.all([...])` / `COUNT(*)` 操作 D1 `any`）→ 無額外 TS7006。baseline file `types/typecheck-baseline.json` 同記各檔 2。

### 依賴邊界（caller cascade — handler 是 entry point）

handler 非被其他 functions-leaf TS code 呼叫 → cascade 只可能來自：(a) **functions-leaf intra-file**（typed request/env 流入檔內 typed util）；(b) **tests-leaf**（test 直接 import handler 並調用）。

**(a) functions-leaf intra-file**：2 檔直接 env 存取**只有 `env.chiyigo_db`**（D1Database 本 repo 解為 `any`，[[feedback_d1database_resolves_any_no_workers_types]]）→ 無 TS2339。env/request 流入的 util 簽名全相容：

| util（被本批呼叫） | 簽名 | 傳 `Env`/`Request` 後 |
|---|---|---|
| `requireStepUp(request, env, …)`（CP） | `(request: Request, env: Env, …)` | **完全吻合** → 0 cascade，最強佐證 |
| `requireAuth(request, env)`（UB） | `(request: Request, env: Env, …)` | **完全吻合** → 0 cascade，最強佐證 |
| `validatePassword(pw)` / `generateSalt()` / `hashPassword(pw, salt)`（CP） | 不涉 env/request | 無關 |
| `bumpTokenVersion(db, userId)`（CP） | 自身 untyped（`any`） | `any` 吸收 typed 值 → 0 |
| `safeUserAudit(env, entry)`（both） | 自身 untyped（`any`） | `any` 吸收 typed env → 0 |

functions/ grep 本批 module import：命中皆 doc-comment / self（`elevation.ts:5`、`forgot-password.ts:33` 是註解；CP/UB 自身 doc 字串）→ **0 internal caller**。

**(b) tests-leaf**（呼叫 pattern 不一致，是唯一需特別驗的面）：

| 檔 | test 調用 pattern | tests-leaf cascade |
|---|---|---|
| `change-password.ts` | **direct-literal**：`changePwHandler({ request: new Request(...), env })`（change-password.test.ts:55,71）→ literal 受 excess-property/型別相容檢查 | **須 spike 證**；實讀兩處 literal 皆**剛好 `{request, env}` 兩屬性、無 excess**，`request`=`new Request(...)`、`env`=`cloudflare:test` `ProvidedEnv`（env.d.ts 橋接 `Env`）→ **預期 0**（spike 已證，見下） |
| `identity/unbind.ts` | **無任何 test import**（grep `tests/` `unbind` 只命中 `wallet.test.ts` 的 `wallet.unbind`/`unbind_wallet`，**非 identity unbind**） | **0**（零接觸） |

**owner 提醒的 TS7011（`()=>null` callback）→ 本批不命中**：2 檔無 null-returning arrow callback。

### 型別選型（owner Convention A；兩檔同一型態）

允許落地的唯一 source diff（每檔一處，兩檔逐字相同）：

```ts
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| `env` | **`Env`（full，非 `Pick`）** | handler 既有先例（PR-2ch A1 五檔 + PR-2ci `2fa/setup` + `2fa/verify` PR-2u）；`requireStepUp(…, env: Env)` / `requireAuth(…, env: Env)` 即收 full `Env` ＝最強零-cascade 佐證；handler 用 full `Env` 與 util 用 `Pick` 刻意分流（[[feedback_util_env_param_pick_not_full_env]]）。CP 讀 `env.chiyigo_db`、UB 讀 `env.chiyigo_db`，皆在 `Env` interface |
| `request` | **`Request`（plain）** | 2 檔只用 `request.json()` + `request` 流入 `requireStepUp`/`requireAuth`（收 `Request`）+ `safeUserAudit`；**無 `.cf` 存取** → 非 `CfRequest` |
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 PR-2ch / PR-2ci 鎖：本刀只處理 TS7031，不做格式與文件整理 |

**考慮過、否決**：`env: Pick<Env,'chiyigo_db'>`（handler 整包傳 env 給 `requireStepUp`/`requireAuth`、用 `Pick` 反不一致）；`request: CfRequest`（無 `.cf` 存取、且 `CfRequest` 過窄會與 `new Request()` test literal TS2345）；加 `Promise<Response>` return 標註（無 error 驅動、非最小 diff）；清 JSDoc（lock 鎖）。

## Spike 實證（full-solution，本地未 commit，2026-06-19，已 revert clean）

**程序**：量 base（clean main `9fcc095c`：solution 831 + tests-leaf 0）→ 套 2 編輯點 → canonical byte-identical（esbuild stdin ×2）→ 清 `.tscache` → forced `tsc -b tsconfig.solution.json --force`（含 functions / tests / scripts / browser-typecheck 4 leaf，sort-diff）→ forced `tsc -b tsconfig.tests.json --force`（tests-leaf）→ canonical `--report` → frozen diff + `git diff --check` → `git checkout --` revert → 驗 clean + ratchet 回 831。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| 2 檔 errors 4 → 0 | ✅ sort-diff REMOVED = 恰 4 行 TS7031（CP `(40,39)`/`(40,48)` + UB `(18,39)`/`(18,48)`）；patched 兩檔 0 殘留 |
| solution errorCount 831 → 827（恰 −4） | ✅ forced tsc solution **827**；sort-diff ADDED = **空** |
| zero cascade（functions + tests + scripts + browser，全 solution） | ✅ solution sort-diff ADDED=0；另 `tsc -b tsconfig.tests.json --force` **base 0 → patched 0**（含 change-password.test direct-literal ctx call，最大 caveat 已解除） |
| canonical `--report` | ✅ errorCount **827** / errorFiles **86** / cleanFiles **248** / sourceFilesTotal 334 |
| **bundle byte-identical**（TS erase 後 runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`**，[[feedback_byte_identical_emit_verification]]） | ✅ esbuild **stdin** type-strip base(`9fcc095c`) vs patched 逐檔 IDENTICAL、皆非空、esbuild stderr 空（避 `--loader` file-entry 空輸出陷阱）：<br>`change-password.ts` **2151B** sha `f40ce744debef668dbfd9f64fc835b8245268fc1c71b91fc76d461b2bfd2ad65`<br>`unbind.ts` **2202B** sha `270403e2c9cbc3aa8363f90e9a57ea9df4172da727ee79ddb9acb55b0c61b942` |
| `git diff --check`（source） | ✅ exit 0（無 trailing whitespace / lone space） |
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、ratchet 回 **831/88/246** |

**byte-identical 適用性**：2 檔皆有 import（change-password 5：crypto/password/auth/scopes/user-audit；unbind 2：auth/user-audit）→ esbuild stdin transform **適用**（單檔 transform 證明、import 行原樣保留；非完整 bundle，但 type-only annotation PR 這正是對的證明面）。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原會輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/account/change-password.ts b/functions/api/auth/account/change-password.ts
index 3d815a0f..7f11fc3d 100644
--- a/functions/api/auth/account/change-password.ts
+++ b/functions/api/auth/account/change-password.ts
@@ -37,7 +37,7 @@ import { requireStepUp, bumpTokenVersion, res } from '../../../utils/auth'
 import { SCOPES } from '../../../utils/scopes'
 import { safeUserAudit } from '../../../utils/user-audit'

-export async function onRequestPost({ request, env }) {
+export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
   // step-up 守門：驗 step_up_token + scope=elevated:account + for_action=change_password
   // requireStepUp 內部已 revokeJti（一次性）+ 嚴格 scope（不走 role fallback）
   const { user, error } = await requireStepUp(
diff --git a/functions/api/auth/identity/unbind.ts b/functions/api/auth/identity/unbind.ts
index 8af3d00c..d12ad25d 100644
--- a/functions/api/auth/identity/unbind.ts
+++ b/functions/api/auth/identity/unbind.ts
@@ -15,7 +15,7 @@ import { safeUserAudit } from '../../../utils/user-audit'

 const ALLOWED_PROVIDERS = new Set(['google', 'discord', 'line', 'facebook'])

-export async function onRequestPost({ request, env }) {
+export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
   const { user, error } = await requireAuth(request, env)
   if (error) return error

```

`git diff --stat`：2 files changed, 2 insertions(+), 2 deletions(-)（各檔 +1/−1）。

## 預期 ratchet

- clean main `9fcc095c` `--report`：errorCount **831** / errorFiles **88** / cleanFiles **246** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **831 → 827**（−4）、errorFiles **88 → 86**、cleanFiles **246 → 248**（spike 實測值、非預測；2 檔全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 2 個 handler 簽名型別標註，TS erase 後 runtime byte-identical（§Spike sha 實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 831、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。

## 測試影響面（覆蓋誠實，per-file 分層，L9 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf base 0 → patched 0 實證）。
- **覆蓋分裂（誠實分開報、不泛稱 covered）**：

| 檔 | direct test | 真打路徑 | 硬保證 |
|---|---|---|---|
| `change-password.ts` | ✅ `change-password.test.ts`（dedicated，**10 例**） | `enableTotp` + `freshTotp()`（otpauth `new TOTP().generate()`）產真 step-up token → `changePwHandler` → 驗 step-up gate / scope 白名單(非 role fallback) / OTP 一次性消耗 / 密碼真換 / `bumpTokenVersion` 撤舊 access / UPSERT(OAuth-only) / 弱密碼 reject / audit `account.password.change` | direct + byte-identical |
| `identity/unbind.ts` | ❌ 無 direct 亦無 indirect | —（grep `tests/` `unbind` 只命中 `wallet.unbind`，非 identity） | **byte-identical 為唯一硬保證**（同 PR-2ci `setup` / PR-2ch 3 個 2FA handler 策略） |

- `unbind` 無測試 → **不宣稱其 coverage**；其改動為純 destructure 標註（type-strip 為零）+ byte-identical 證明，與 turnstile/setup 缺 direct 的先例同策略。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`。**PowerShell 用 `$env:RATCHET_BASE_REF='9fcc095c'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='9fcc095c'; npm run typecheck:ratchet` green（831→827 / 88→86 / 246→248）。
- filtered forced tsc：2 檔 0 殘留 + solution sort-diff ADDED=0（含 tests leaf）+ `tsc -b tsconfig.tests.json --force` exit 0（base 0 → patched 0 的 tests-leaf 0 cascade，涵蓋 change-password.test direct-literal）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**（經 Bash tool / Git Bash 執行；**PowerShell 5.1 不支援 `<` stdin redirection、且 `esbuild.ps1` 受 execution policy 阻擋** → 此 receipt 不在 PowerShell 原文跑；唯獨 ratchet 段用 PowerShell `$env:` 見上注）：

```bash
git show 9fcc095c:functions/api/auth/account/change-password.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/cp-base.js 2>/tmp/cp-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/account/change-password.ts > /tmp/cp-head.js 2>/tmp/cp-head.err
git show 9fcc095c:functions/api/auth/identity/unbind.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/ub-base.js 2>/tmp/ub-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/identity/unbind.ts > /tmp/ub-head.js 2>/tmp/ub-head.err
wc -c /tmp/cp-base.js /tmp/cp-head.js /tmp/ub-base.js /tmp/ub-head.js     # 期望 cp 2151 兩端 / ub 2202 兩端
sha256sum /tmp/cp-base.js /tmp/cp-head.js /tmp/ub-base.js /tmp/ub-head.js  # 期望 cp f40ce744… 兩端 / ub 270403e2… 兩端
cat /tmp/cp-base.err /tmp/cp-head.err /tmp/ub-base.err /tmp/ub-head.err    # 期望空（stderr 0 bytes）
diff -q /tmp/cp-base.js /tmp/cp-head.js     # 期望 IDENTICAL（無輸出 + exit 0）
diff -q /tmp/ub-base.js /tmp/ub-head.js     # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show 9fcc095c:` 讀未改 base。spike 本地實證：CP 兩端 **2151B / `f40ce744…`**、UB 兩端 **2202B / `270403e2…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 1-line annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量）、`npm run build:functions` green。
- targeted int：`npm run test:int -- tests/integration/change-password.test.ts`（覆蓋 change-password direct path）；`unbind` 無 targeted int（0 coverage），跑全量 `test:int` 確認無跨檔破壞（**不宣稱涵蓋 unbind**）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §型別選型 凍結 diff **逐行一致**（人審 `git diff --stat` 僅 2 檔各 +1/−1、`git diff` 2 處皆 `onRequestPost` 簽名）；超出 = scope creep = Gate fail。

## Merge SOP（process lock，順序不得寫反；[[feedback_pre_merge_gate_checklist_match_ci]]）

① faithfulness ✅ → ② **先**跑齊 merge 前 local gates 全綠（`lint`·`typecheck:ratchet`·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit`）→ ③ 全綠後 owner 明示 `MERGE_ALLOWED` → ④ squash-merge（`--delete-branch`）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 branch cleanup + memory receipt。

## Diff hygiene

- 不碰 `CLEANUP_PLAN.md`（untracked、Stage 7 完工才清）；**不碰 `auth/delete.ts`（PR-2ck）**；baseline 不 `--update`；挑檔 add（2 source + 本 plan doc）禁 `git add .`/`-A`；開 feature branch（`stage7-pr2cj-changepw-unbind-noimplicitany`）禁直推 main；平行 session 唯讀優先、動 git 前先 `git status`。
- **CRLF**：`unbind.ts` working-tree 為 CRLF（`.gitattributes` `* text=auto eol=lf` 已根治，[[feedback_windows_build_crlf_churn]]）；spike 實證 `git add` 後 `git diff --cached --numstat` = `1 1`（clean 1-line、**無 whole-file churn**）；code 階段 commit 前再驗 `numstat` 每檔 `1 1`。

---

## 附：owner C-1 鎖定表（faithful 收錄）

### 風險表

| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| `change-password` step-up / 密碼 / token 撤銷漂移 | 高 | step-up gate / hash / `bumpTokenVersion` 任一漂移破壞改密安全邊界 | 僅改 handler destructure 標註；spike 已證 functions+tests leaf 0 cascade + byte-identical |
| `unbind` 防自殺 / 白名單漂移 | 高 | `localCount+identityCount<=1` 或 `ALLOWED_PROVIDERS` 漂移 → 幽靈帳號 / 非法 provider | 禁動 count 邏輯與白名單；byte-identical 證 runtime 不變 |
| `unbind` 無測試覆蓋 | 中高 | runtime 漂移測試不一定抓 | byte-identical（非空、IDENTICAL）為唯一硬保證 |
| A2 併入 `delete.ts` scope 漂移 | 中 | delete.ts destructive + wrapper/worker 雙 function（修法形態不同） | L4/L10 鎖：禁併入，留 PR-2ck |
| `CLEANUP_PLAN.md` untracked | 中 | 誤 add 汙染 scope | 禁 `git add -A`、挑檔 add |
| baseline/ratchet 誤更新 | 高 | 掩蓋真實 Stage 7 進度 | reduce 不 `--update` |

### 防禦表

| 機制 | 處理 | 實作 / 未處理因 |
|---|---|---|
| 權限 | 是 | `requireStepUp`(CP) / `requireAuth`(UB) 簽名吻合、呼叫順序不動 |
| Input | 是 | 禁改 body parse / `validatePassword` / provider 白名單檢查 |
| RateLimit | N/A | 本批 handler 自身不含 rate-limit 常數（不新增） |
| XSS | N/A | Functions API type-only、無前端輸出面 |
| Log/Audit | 是 | 禁改 `account.password.change` / `oauth.identity.unbind` event 名稱 / level / payload |
| Retry/備援 | N/A | 無外部 retry / 部署架構變更 |
| 監控 | 是 | ratchet 831→827 明列；coverage 不 overclaim（unbind 不宣稱） |

### DB 鎖定

| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Schema | 不改 `local_accounts` / `user_identities` / `users` |
| Atomic | 禁改 `INSERT…ON CONFLICT DO UPDATE`(CP) / `DELETE…WHERE user_id=? AND provider=?`(UB) 條件與順序 |

### 隔離區 / 鎖定區

- **隔離區**：`auth/delete.ts`（PR-2ck）、A3 其餘檔（forgot-password / email* / local/{login,register}）、`CLEANUP_PLAN.md`、baseline/ratchet override **全部不得碰**。
- **鎖定區**：所有 runtime token（SQL / provider 白名單 / step-up·token-version 撤銷 / 防自殺 count / audit event·level / hash·salt）；return type / JSDoc / 格式。
