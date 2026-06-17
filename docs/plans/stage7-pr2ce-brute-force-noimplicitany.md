# Stage 7 reduce PR-2ce — `functions/utils/brute-force.ts` noImplicitAny cleanup（domain-batched cadence 第 3 棒）

**目標**：`functions/utils/brute-force.ts` 的 **6 noImplicitAny（6×TS7006）→ 0**，純 type-only（1 檔 +3/−3、3 個函式簽名各補 2 個裸參數）。**無 cascade、無 deviation、bundle byte-identical**（純參數 annotation，無 `as` cast 留下 runtime alias —— 與 PR-2cc 同級、優於 PR-2cd）。

> **cadence 定位**：domain-batched + risk-tiered cadence **第 3 棒**（mechanical-misc 域）。owner C-1 裁示獨立 PR、完整 Dual Gate v3.1、不走 lighter。`brute-force.ts` = Phase E-4 **暴力破解 / credential-stuffing 防線**（漸進 cooldown + 跨帳號掃描黑名單），auth-defense 熱區、Tier-0 鄰接。**不與 `turnstile.ts`（captcha / fail-close，下一棒獨立 receipt）/ `totp.ts`（2FA 域）合包**（C-1 鎖定）。

base main `8f8018a6`（#100 root CLAUDE.md docs-only，#99 `5423c586` 後；docs-only 不動 TS error count）。baseline 已於該 SHA 實測（`node scripts/typecheck-ratchet.mjs --report`）：errorCount **856** / errorFiles **97** / cleanFiles **237** / sourceFilesTotal 334。baseline file 天花板 **1119/175** 凍結（reduce 不 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Gate 紀錄（Dual Gate Workflow v3.1，[[feedback_codex_review_workflow]]）

當前 state = **`PLAN_SELF_REVIEW_CLEAN`**（@ plan doc commit）。impl **L1** / review care **L2**。**未授權 source coding**（待 `CHATGPT_ARCH_APPROVED` → `CODEX_PLAN_APPROVED` → owner `CODING_ALLOWED`）。

- 2026-06-17 owner **C-1 `APPROVED_TO_SPEC_DRAFT`**（= `SPEC_APPROVED`）：scope = `brute-force.ts` 6 noImplicitAny → 0、純 type-only、單檔獨立 PR。typing 鎖 `Env['chiyigo_db']` + `string`。impl L1 / review care L2。完整 Dual Gate v3.1、不 lighter。鎖定區：禁混 `turnstile.ts`、禁碰 `login.ts`、禁 `baseline --update`、禁碰 `CLEANUP_PLAN.md`。
- 2026-06-17 **scout（read-only，實跑命令非推理）**：ratchet `--report` 確認 current 856/97/237（無漂移）；`tsc -p tsconfig.functions.json` 確認 brute-force.ts 恰 6×TS7006（全裸 `db`/`email`/`ip` 參數）；grep 全 repo 證唯一 source caller = `login.ts`；確認 `tests/integration/brute-force.test.ts` 16 tests direct 覆蓋。
- 2026-06-17 **plan-stage full-solution spike（已 revert，見 §Spike 實證）**：套 6 annotation → `tsc -p tsconfig.functions.json`（brute-force **0** residual）+ `typecheck:ratchet:report`（全 solution graph **856→850**、errorFiles 97→96、cleanFiles 237→238、**zero cascade**）+ targeted `brute-force.test.ts` **16/16 綠**。working tree revert clean（HEAD `8f8018a6`、僅 `?? CLEANUP_PLAN.md`、ratchet 回 856/97/237）。
- 2026-06-17 **Claude plan 自審到零**（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式，impl L1，一輪 0 新發現）：見 §流程定位。
- **待**：`CHATGPT_ARCH_APPROVED`（維度 B，owner-relayed）→ `CODEX_PLAN_APPROVED`（維度 C）→ owner `CODING_ALLOWED` → coding → 機械 gates → `CODE_SELF_REVIEW_CLEAN` → `CODEX_CODE_APPROVED` → `CHATGPT_CODE_FAITHFULNESS_APPROVED`（v3.1 任何級別全走）→ owner 明示 squash-merge → `MERGED_MAIN`。

## 敏感面聲明（review care L2；有 16-test direct 覆蓋 + byte-identical receipt 雙防線）

`functions/utils/brute-force.ts` = **Phase E-4 暴力破解防護 SSOT**。型別改動**全程不得牽動**任何防護行為，Code Gate 以 byte-identical receipt + targeted test 雙驗：

- **漸進 cooldown**（`getUserCooldownSeconds`）：`COOLDOWN_LADDER`（[3,5]/[5,30]/[7,300]/[10,3600]）+ `COOLDOWN_WINDOW_MIN`（30）+ `login_attempts` COUNT SQL + `Date.parse`/elapsed/remaining 計算。
- **跨帳號掃描黑名單**（`isIpBlacklisted` / `detectAndBlacklistCrossUserScan`）：`SCAN_DISTINCT_EMAIL_THRESHOLD`（10）+ `SCAN_WINDOW_HOURS`（1）+ `BLACKLIST_TTL_HOURS`（24）+ `ip_blacklist` SELECT/INSERT...ON CONFLICT/UPDATE hit_count SQL + `expires_at` 計算。
- **caller 接點**（`login.ts`，**不在本 PR scope**）：IP_BLOCKED 攔截 / COOLDOWN 攔截 / 自動黑名單寫入 + critical audit。

**修法若非純參數型別 annotation、或會牽動上述任一閾值/SQL/計算/控制流 → 立刻停手回 `PLAN_DRAFT`。**

## Coding 階段硬性邊界

- **允許（= §Spike 最終 diff 逐行，1 檔 +3/−3；恰 6 個裸參數 annotation）**：
  1. `getUserCooldownSeconds(db, email)` → `(db: Env['chiyigo_db'], email: string)`。
  2. `isIpBlacklisted(db, ip)` → `(db: Env['chiyigo_db'], ip: string)`。
  3. `detectAndBlacklistCrossUserScan(db, ip)` → `(db: Env['chiyigo_db'], ip: string)`。
- **禁止**：`db: D1Database`（本檔 TS2552 不可見 + eslint no-undef）；`email`/`ip` 標 `string | null`（唯一 caller 已保證 string，過寬 + 多餘 narrowing）；改 ambient / env.d.ts / eslint globals / tsconfig / eslint / vitest；改 `COOLDOWN_LADDER` / `COOLDOWN_WINDOW_MIN` / `SCAN_DISTINCT_EMAIL_THRESHOLD` / `SCAN_WINDOW_HOURS` / `BLACKLIST_TTL_HOURS` 任一常數；改任何 SQL（SELECT/INSERT/ON CONFLICT/UPDATE）；改 `Date.parse`/`Date.now`/`toISOString`/`elapsed`/`remaining`/`expiresAt` 計算；改 `if (!email)`/`if (!ip)`/`if (!row)` falsy guard 與 fail-safe return（`return 0`/`return null`/`return false`）；改 `_internal` export；動 `login.ts`、tests、`baseline --update`、`CLEANUP_PLAN.md`、`turnstile.ts`；新增字面 `:any` / suppression / 新 import / 新 runtime guard 或分支。

## Scout（對抗式驗證）

### exact errors（`tsc -p tsconfig.functions.json` @ `8f8018a6`）

恰 **6** 個，全在 `functions/utils/brute-force.ts`，全 **TS7006**（implicit any parameter）：

| 位置（line,col）/ 標的 | code | 性質 |
|---|---|---|
| (42,46) `getUserCooldownSeconds(db …)` | TS7006 | param |
| (42,50) `getUserCooldownSeconds(… email)` | TS7006 | param |
| (77,39) `isIpBlacklisted(db …)` | TS7006 | param |
| (77,43) `isIpBlacklisted(… ip)` | TS7006 | param |
| (98,55) `detectAndBlacklistCrossUserScan(db …)` | TS7006 | param |
| (98,59) `detectAndBlacklistCrossUserScan(… ip)` | TS7006 | param |

**無 cascade**：3 函式皆裸參數 annotation；補上後檔內 row reads（`row?.cnt`/`row.last_at`/`row?.n`/`row.expires_at`/`row.reason`）走本 repo D1 寬鬆解析（無 `@cloudflare/workers-types` → `Env['chiyigo_db']` row 不引 cascade，[[feedback_d1database_resolves_any_no_workers_types]]），spike 實證 0 殘留。

### caller proof（grep 全 repo `**/*.{ts,js}`）

三函式唯一 **source** caller = `functions/api/auth/local/login.ts`（auth-defense hot path）；另 `tests/integration/brute-force.test.ts` direct-call。傳入值型別全確定：
- `db = env.chiyigo_db` → **`Env['chiyigo_db']`**（login.ts:54）。
- `ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'` → 恆 **`string`**（login.ts:55；`?? 'unknown'` 消 null）。
- `emailNorm = email.toLowerCase()`（上游 `if (!email || !password)` 已 guard）→ 恆 **`string`**（login.ts:56）。

→ 無其他 caller、無其他傳入形態，typing 提案與所有 call site 吻合。

### 型別選型（per-symbol；spike 實證）

- **`db: Env['chiyigo_db']`**：`D1Database` 在 functions leaf **TS2552（不可見全域）** + eslint `no-undef`（[[feedback_d1database_resolves_any_no_workers_types]]、PR-2cd OD-1 既定）；`Env['chiyigo_db']` 用已註冊全域 `Env` indexed access、eslint+TS clean、忠於語意（caller 即傳 `env.chiyigo_db`）。沿 PR-2z `rate-limit.ts` / PR-2cd `ai/assist.ts` 既定慣例（命名 SSOT）。
- **`email: string` / `ip: string`（非 nullable）**：唯一 caller 三處皆傳具體 `string`（見 caller proof）；檔內 `if (!email)`/`if (!ip)` falsy guard 對 `string` 仍合法（防空字串 `''`，TS 不視為 dead code、不報錯）；test 全傳 string literal（`'a@x'`/`'1.1.1.1'` 等）。標 `string | null` 過寬且不忠於 caller 契約 → 駁回（C-1 鎖定 `string`）。

## Open Decisions

**無。** typing 由 owner C-1 鎖定（`Env['chiyigo_db']` + `string`），無設計分叉。

**考慮過、否決**：`db: D1Database`（TS2552 + eslint no-undef）；`email`/`ip: string | null`（唯一 caller 保證 string、過寬 + 多餘 narrowing、不忠契約）；具名 row-shape interface（reduce PR 非 data-model 整理；D1 row 本 repo 寬鬆、無 cascade 必要、留 strict 棒 cleanup）；`env: Pick<Env,…>`（本檔函式收 `db` 非 `env`，不適用）。

## Spike 實證（2026-06-17，已 revert）

**程序**：套 3 簽名 annotation（6 參數）→ `npx tsc -p tsconfig.functions.json --noEmit`（filter brute-force）→ `npm run typecheck:ratchet:report`（全 solution graph `tsc -b tsconfig.solution.json`）→ `npx vitest run --config vitest.workers.config.js tests/integration/brute-force.test.ts` → `npx eslint functions/utils/brute-force.ts` → 真實 `git diff`（取 blob anchor）→ `git checkout --` revert → 驗 `git status` clean。

| 驗證 | 目標 | 實測 | 結果 |
|---|---|---|---|
| functions leaf | brute-force.ts 6×TS7006 → 0 | 0 residual | ✅ |
| full solution graph | total 856 → 850、zero cascade | errorCount **850** / errorFiles **96** / cleanFiles **238**（恰 −6） | ✅ |
| targeted test | `brute-force.test.ts` 16 tests 綠 | **16/16 passed**（8.33s、無 flaky） | ✅ |
| eslint | `Env['chiyigo_db']` ambient global 乾淨 | **EXIT 0**（no-undef 不旗標 indexed access） | ✅ |
| frozen diff blob | 改後 blob 確定 | `8bc52bd5 → a32d12d7`（+3/−3、3 簽名） | ✅ |
| revert | working tree 回 clean | `git status` 僅 `?? CLEANUP_PLAN.md`、ratchet 回 856/97/237 | ✅ |

**zero cascade 數學證明**：total 恰降 **6**（= brute-force 的 6 個 noImplicitAny）且 brute-force.ts residual = **0** → 無任何其他檔（含 tests/scripts/browser leaves）新增或減少 error；errorFiles 97→96（brute-force 單檔退出 error bucket）、cleanFiles 237→238（進 clean bucket）= 單檔 bucket move。targeted test 16/16 綠（annotation 套用下）→ `env.chiyigo_db` assignable to `Env['chiyigo_db']`、string literal assignable to `string` 參數，tests-leaf 0 cascade 雙證。

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，1 檔 +3/−3；真實 `git diff`、blob `8bc52bd5→a32d12d7`、context 行皆非空白 → 無 `git diff --check` 空白陷阱，[[feedback_plan_frozen_diff_git_diff_check]]）**：

```diff
diff --git a/functions/utils/brute-force.ts b/functions/utils/brute-force.ts
index 8bc52bd5..a32d12d7 100644
--- a/functions/utils/brute-force.ts
+++ b/functions/utils/brute-force.ts
@@ -39,7 +39,7 @@ const BLACKLIST_TTL_HOURS           = 24
  *   2. 套階梯找對應 cooldown
  *   3. 比較「上次失敗時間 + cooldown」與 NOW，回傳剩餘秒數
  */
-export async function getUserCooldownSeconds(db, email) {
+export async function getUserCooldownSeconds(db: Env['chiyigo_db'], email: string) {
   if (!email) return 0
   const row = await db
     .prepare(
@@ -74,7 +74,7 @@ export async function getUserCooldownSeconds(db, email) {
  * IP 是否在黑名單（且未過期）。
  * @returns {Promise<{ blocked: true, expires_at: string, reason: string } | null>}
  */
-export async function isIpBlacklisted(db, ip) {
+export async function isIpBlacklisted(db: Env['chiyigo_db'], ip: string) {
   if (!ip) return null
   const row = await db
     .prepare(
@@ -95,7 +95,7 @@ export async function isIpBlacklisted(db, ip) {
  * 命中（distinct email ≥ 10 in 1hr）→ INSERT (or UPDATE expires) → 回 true。
  * 未命中 → 回 false。
  */
-export async function detectAndBlacklistCrossUserScan(db, ip) {
+export async function detectAndBlacklistCrossUserScan(db: Env['chiyigo_db'], ip: string) {
   if (!ip) return false
   const row = await db
     .prepare(
```

## 預期 ratchet

- clean main `8f8018a6`：errorCount **856** / errorFiles **97** / cleanFiles **237**。
- 本 PR 後 current state：errorCount **856 → 850**（−6）、errorFiles **97 → 96**（−1）、cleanFiles **237 → 238**（+1）、sourceFilesTotal 334 不變。
- baseline file 不變（天花板 1119/175；reduce 不 `--update`；對外報告稱「current state 降至 850」，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback（bundle byte-identical）

- 改動 = 6 個裸參數型別 annotation。**TS/esbuild type-strip 後完全消失**：`db: Env['chiyigo_db']` → `db`、`email: string` → `email`、`ip: string` → `ip`。**無 `as` cast、無投影 alias、無新 binding** → emit JS 與改前**逐位元組相同（bundle byte-identical）**——與 PR-2cc metrics 同級，**強於 PR-2cd**（後者有 `const o = obj` transparent alias，僅 behavior-preserving）。
- 所有閾值常數、SQL（SELECT/INSERT/ON CONFLICT/UPDATE）、`Date` 計算、falsy guard、fail-safe return、`_internal` export **未改一字**。
- rollback：單一 squash revert 完整回退；revert 後 ratchet 回 856。

## 測試影響面（覆蓋誠實 — 有 16-test direct 覆蓋）

- **`brute-force.ts` 有 dedicated integration test**：`tests/integration/brute-force.test.ts` **16 tests**（`getUserCooldownSeconds` 6 + `isIpBlacklisted` 3 + `detectAndBlacklistCrossUserScan` 3 + `login.js E-4 接點` 4，含 `[J-3]/[J-4]/[J-5]` 安全標記），三函式皆 direct-call + login 端整合。spike 已驗 16/16 綠（annotation 套用下）。
- **本 PR 防線（雙重，強於 PR-2cd 的純論證）**：(1) **16-test direct regression**（cooldown 階梯 / 黑名單命中·過期 / 跨帳號掃描閾值 / login 接點）；(2) **bundle byte-identical**（type-strip 後 emit 無差）；(3) `build:functions` compiled；(4) forced tsc zero-cascade（850、tests-leaf 0）；(5) diff +3/−3 機械可審。
- **strict-rung 邊界（不在本 PR）**：本檔開 `strict:true` 後 `row?.cnt`/`row.last_at`/`row?.n` 等可能浮 strictNull 債（`.first()` 回 `T | null`）——登記供 strict 棒，與本 noImplicitAny 棒無關、本 PR 不處理。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後）

> 無 ambient .d.ts 變更；保險 tsc/ratchet 可 `rm -rf .tscache` 全重建。branch 已有 plan-doc commit → plain ratchet base 自動 = origin/main `8f8018a6`；保險 `$env:RATCHET_BASE_REF='8f8018a6'; npm run typecheck:ratchet`。**不帶** `RATCHET_ALLOW_BASELINE_RAISE`（[[feedback_ts_ratchet_discipline]]）。

- `$env:RATCHET_BASE_REF='8f8018a6'; npm run typecheck:ratchet` green（856→850 / 97→96 / 237→238）。
- `npm run lint` green（全量）。
- `npm run build:functions` green（type-strip、Worker 編譯）。
- filtered `tsc -p tsconfig.functions.json`：`brute-force.ts` 0 殘留。
- **`npm run test:cov` green** + **全量 `npm run test:int` green**（CI 順序，[[feedback_pre_merge_gate_checklist_match_ci]]）；`brute-force.test.ts` **16/16** = 本檔 direct regression。
- baseline file 不得 `--update`（1119/175）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（1 檔 +3/−3、3 簽名、改後 blob = `a32d12d7`、= spike 同 blob）；超出 = scope creep = Gate fail。
- **byte-identical receipt（review care L2，Code Gate 必附）**：
  1. `COOLDOWN_LADDER` / `COOLDOWN_WINDOW_MIN` / `SCAN_DISTINCT_EMAIL_THRESHOLD` / `SCAN_WINDOW_HOURS` / `BLACKLIST_TTL_HOURS` 常數 —— 未改
  2. `login_attempts` COUNT SQL（cooldown + cross-user scan 兩處 `datetime('now', ?)` 視窗）—— 未改
  3. `ip_blacklist` SELECT / `INSERT...ON CONFLICT DO UPDATE` / `UPDATE hit_count` SQL —— 未改
  4. `Date.parse`/`Date.now`/`toISOString`/`elapsedSec`/`remaining`/`expiresAt` 計算 —— 未改
  5. falsy guard（`if (!email)`/`if (!ip)`/`if (!row)`）+ fail-safe return（`0`/`null`/`false`）—— 未改
  6. `.bind(...)` 參數順序與 fire-and-forget `.run().catch()` —— 未改
  7. `_internal` export —— 未改
- merge 後 smoke：credential-free home / login 200；brute-force 防線行為以 CI 16-test + prod 觀測為準。

## 流程定位

- Dual Gate Workflow v3.1：`SPEC_APPROVED`（owner C-1）✅ → scout（read-only 實跑）✅ → plan-stage spike（單輪達標：850/0/zero-cascade/16 tests）✅ → **`PLAN_SELF_REVIEW_CLEAN`**（單 agent 對抗式，impl L1）✅ → 本 doc commit（feature branch `stage7-pr2ce-brute-force-noimplicitany`）→ **`CHATGPT_ARCH_APPROVED`**（維度 B，owner-relayed）→ **`CODEX_PLAN_APPROVED`**（維度 C）→ owner `CODING_ALLOWED` → coding（frozen replay +3/−3）→ 機械 gates → **`CODE_SELF_REVIEW_CLEAN`**（單 agent，impl L1）→ **`CODEX_CODE_APPROVED`** → **`CHATGPT_CODE_FAITHFULNESS_APPROVED`**（v3.1 任何級別全走）→ owner 明示 squash-merge --delete-branch → `MERGED_MAIN`。
- **self-review 形式裁定**：依 PR-2cd 既定先例（同 impl L1 / review care L2），impl L1 → **單 agent 對抗式 self-review**（非 multi-agent workflow）；review care L2 → 外部全 4 道 chain + byte-identical receipt（不 lighter）。
- **Claude plan 自審紀錄（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式，impl L1，一輪 0 新發現）**：
  1. **delta 數學**：856−6=850 ✅；spike set-diff brute-force 6→0、total 恰 −6（zero cascade）✅；errorFiles 97→96 / cleanFiles 237→238（單檔 bucket move）✅。
  2. **cascade 誠實**：純裸參數、無 `raw:unknown` 式下游；`Env['chiyigo_db']` row reads 走本 repo D1 寬鬆解析無 cascade、spike 實證 0 殘留 ✅。
  3. **typing 忠實 caller**：`db`/`email`/`ip` 三型別逐一對 login.ts call site（`env.chiyigo_db`/`toLowerCase()`/`?? 'unknown'`）+ test string literal 核對 ✅；駁回 `string | null`（過寬不忠契約）✅。
  4. **runtime 誠實**：純參數 annotation、type-strip 後 **bundle byte-identical**（無 alias、無 cast）——明標強於 PR-2cd ✅。
  5. **direct test 防線**：16-test direct regression（非如 PR-2cd 無 direct test）+ byte-identical + zero-cascade + build，明標雙防線 ✅。
  6. **敏感面 byte-identical**：閾值/SQL/Date 計算/guard/fail-safe return/`_internal` 全在 diff 行外 ✅。
  7. **scope**：single-file、無 out-of-scope error、`login.ts`/tests/config/baseline/`CLEANUP_PLAN.md`/`turnstile.ts` 未碰（C-1 鎖定區全守）✅。
  8. **L1/L2**：impl L1（純參數 annotation、bundle byte-identical）/ review care L2（暴力破解防線、Tier-0 鄰接）✅。
- **本域後續序（owner C-1 裁，輕→重）**：metrics（PR-2cc ✅）→ ai/assist（PR-2cd ✅）→ **brute-force（本 PR）** → captcha-turnstile（`utils/turnstile.ts`、fail-close 邊界、獨立 receipt）；`utils/totp.ts` 折回 2FA/elevation/account 域。
