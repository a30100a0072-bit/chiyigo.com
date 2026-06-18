# Stage 7 reduce PR-2cf — `functions/utils/turnstile.ts` noImplicitAny cleanup（domain-batched cadence 第 4 棒）

**目標**：`functions/utils/turnstile.ts` 的 **3 noImplicitAny（3×TS7006）→ 0**，純 type-only（1 檔 +5/−1、單一函式簽名補 3 個裸參數、多行展開）。**無 cascade、無 deviation、bundle byte-identical**（純參數 annotation、無 `as` cast、無 alias —— 與 PR-2cc / PR-2ce 同級）。

> **cadence 定位**：domain-batched + risk-tiered cadence **第 4 棒**（mechanical-misc 域）。owner C-1 裁示獨立 PR、完整 Dual Gate v3.1、不走 lighter。`turnstile.ts` = Cloudflare Turnstile siteverify、**captcha fail-close 邊界**（key 未設→skip / 驗證失敗→403 / siteverify 異常→fail-close 拒絕），auth 前置防線、Tier-0 鄰接、**比 brute-force 更敏感**（owner C-1 明示）。**不與 `totp.ts`（2FA 域，後續折回）合包**（C-1 鎖定）。本檔之後 mechanical-misc 域僅餘 `totp.ts`。

base main `3bd26315`（#101 brute-force `5fd6c0b1` squash 後；docs-only #100 之後）。baseline 已於該 SHA 實測（`node scripts/typecheck-ratchet.mjs --report`）：errorCount **850** / errorFiles **96** / cleanFiles **238** / sourceFilesTotal 334。baseline file 天花板 **1119/175** 凍結（reduce 不 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Gate 紀錄（Dual Gate Workflow v3.1，[[feedback_codex_review_workflow]]）

當前 state = **`PLAN_SELF_REVIEW_CLEAN` → 待 plan-doc commit → 待外部 Plan Gate（ChatGPT Arch → Codex Plan）**。impl **L1** / review care **L2**。**未到 `CODING_ALLOWED`，不得改 source、不開 merge path。**

- 2026-06-18 owner **C-1 `SPEC_APPROVED`**：scope = `turnstile.ts` 3 noImplicitAny → 0、純 type-only、單檔獨立 PR。typing 鎖 `request: Request` + `body: Record<string, unknown>` + `env: Pick<Env, 'TURNSTILE_SECRET_KEY'>`。OD-1 不加 return type、OD-2 不清 JSDoc。impl L1 / review care L2。完整 Dual Gate v3.1、不 lighter。測試宣稱限 indirect integration skip-path。鎖定區：禁混 `totp.ts`、禁碰 3 caller（register/login/forgot-password）、禁碰 `api/ai/assist.ts` 同名 local helper、禁 `baseline --update`、禁碰 `CLEANUP_PLAN.md`。
- 2026-06-18 **scout（read-only，實跑命令非推理）**：ratchet `--report` 確認 current 850/96/238（無漂移）；`tsc -p tsconfig.functions.json` 確認 turnstile.ts 恰 3×TS7006（L31 裸 `request`/`body`/`env`）；grep 全 repo 證 util `verifyTurnstile` 唯三 source caller = register/login/forgot-password（皆傳 `(request, body, env)`、皆 implicit any）；確認 **無 `turnstile.test.ts`（direct test = 0）**、3 caller 各有 integration test 但 `tests/` + vitest/wrangler 皆未設 `TURNSTILE_SECRET_KEY`/未送 `cf-turnstile-response` → 僅間接覆蓋 skip-path。
- 2026-06-18 **plan-stage full-solution spike（已 revert，見 §Spike 實證）**：套 3 annotation →（`rm -rf .tscache` 對齊 CI clean-checkout）`typecheck:ratchet:report`（全 solution graph **850→847**、errorFiles 96→95、cleanFiles 238→239、**zero cascade**）+ `tsc -p tsconfig.functions.json`（turnstile **0** residual、total 847）+ `tsc -p tsconfig.tests.json`（tests leaf **0**、無新增任何類別錯）+ `eslint` exit 0 + **esbuild stdin byte-identical**（base==head 皆 955 bytes / sha `1924bcbc…`）+ `git diff --check` clean。working tree revert clean（HEAD `3bd26315`、僅 `?? CLEANUP_PLAN.md`、turnstile.ts:31 回原簽名、ratchet 回 850/96/238）。
- 2026-06-18 **Claude plan 自審到零（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式，impl L1，一輪 0 新發現）**：見 §流程定位。
- **待（owner-relayed 補入）**：plan-doc commit（feature branch）→ **`CHATGPT_ARCH_APPROVED`**（維度 B）→ **`CODEX_PLAN_APPROVED`**（維度 C）→ owner `CODING_ALLOWED` → code 階段。本 PR **尚未進入 code 階段**。

## 敏感面聲明（review care L2；⚠ **無 direct test** — byte-identical receipt 為**首要且近乎唯一**防線）

`functions/utils/turnstile.ts` = **captcha fail-close 邊界 SSOT**。型別改動**全程不得牽動**任何驗證行為。⚠ **特別注意**：本檔 **無 dedicated test**，且 integration 間接覆蓋僅及 skip-path（`TURNSTILE_SECRET_KEY` 測試環境未設）→ **token-missing / siteverify-fetch / fail-close-catch 三路徑 0 test 覆蓋**。故 **fail-close 語意的保證完全仰賴 emit byte-identical receipt**（證 type-strip 後 JS 逐位元組不變、含未被測的 fail-close 路徑），非靠 test、非靠人工讀 diff（owner C-1 風險表「fail-close 語意漂移＝高」對應防禦）。

fail-close 四語意（鎖定，全在 diff 行外）：
1. **skip**：`env?.TURNSTILE_SECRET_KEY` 未設 → `{ ok: true, skipped: true }`（graceful degradation，code 可早於 dashboard 設 key）。
2. **token-missing**：`body?.['cf-turnstile-response']` 缺/非字串 → `{ ok: false, reason: 'token_missing' }`。
3. **verify**：`data.success` → `{ ok: true }`，否則 `{ ok: false, reason: error-codes }`。
4. **fail-close**：siteverify fetch throw → `catch` → `{ ok: false, reason: 'siteverify_unreachable' }`（Cloudflare 故障時拒絕，避免 captcha 失效被刷註冊 / 登入 / 忘密碼）。

**修法若非純參數型別 annotation、或會牽動上述任一 return / branch / fetch / catch → 立刻停手回 `PLAN_DRAFT`。**

## Coding 階段硬性邊界

- **允許（= §Spike 最終 diff 逐行，1 檔 +5/−1；恰單一簽名、3 個裸參數 annotation、多行展開）**：
  `verifyTurnstile(request, body, env)` →
  ```ts
  verifyTurnstile(
    request: Request,
    body: Record<string, unknown>,
    env: Pick<Env, 'TURNSTILE_SECRET_KEY'>,
  )
  ```
- **禁止**：加顯式 return type（OD-1 = 不加）；清 / 改 JSDoc `@param`/`@returns`（OD-2 = 不清）；碰 `data`（L51 `res.json()` 的 inferred any、非 noImplicitAny 錯、out-of-scope）；`request: CfRequest`（本檔只讀 `.headers.get`、非 `.cf`，慣例用 `Request`）；`body: unknown`（被 index、會 TS 報錯）或具名 body interface；`env: Env`（過寬、tests-leaf cascade 風險，[[feedback_util_env_param_pick_not_full_env]]）；改 ambient / env.d.ts / eslint globals / tsconfig / eslint / vitest；改 `SITEVERIFY_URL` 常數；改任何 fetch（method / body / URL）、`URLSearchParams` 組裝、`data.success`/`data['error-codes']` 解析；改 `if (!secret)`/`if (!token || typeof…)` guard 與 return 形態；改 try/catch fail-close；動 3 caller（register/login/forgot-password）、`api/ai/assist.ts` 同名 local helper、tests、`baseline --update`、`CLEANUP_PLAN.md`、`totp.ts`；新增字面 `:any` / suppression / 新 import / 新 runtime guard 或分支。

## Scout（對抗式驗證）

### exact errors（`tsc -p tsconfig.functions.json` @ `3bd26315`）

恰 **3** 個，全在 `functions/utils/turnstile.ts`，全 **TS7006**（implicit any parameter）：

| 位置（line,col）/ 標的 | code | 性質 |
|---|---|---|
| (31,39) `verifyTurnstile(request …)` | TS7006 | param |
| (31,48) `verifyTurnstile(… body …)` | TS7006 | param |
| (31,54) `verifyTurnstile(… env)` | TS7006 | param |

**無 cascade**：單一裸參數簽名 annotation；補上後檔內使用點全乾淨——`request.headers.get('CF-Connecting-IP') ?? ''`（`Request.headers.get` 回 `string | null`、`?? ''` → string）、`body?.['cf-turnstile-response']`（`Record<string, unknown>` index → `unknown` → `!token || typeof token !== 'string'` narrow 成 string）、`env?.TURNSTILE_SECRET_KEY`（`Pick<Env,…>` → `string | undefined` → `!secret` narrow）、`data`（`res.json()` 回 inferred any、不受參數型別影響、out-of-scope）。spike 實證 0 殘留。

### caller proof（grep 全 repo `verifyTurnstile`）

util `verifyTurnstile`（**≠** `api/ai/assist.ts:221` 同名 module-local helper，後者 PR-2cd 已遷、簽名 `(token, secret, ip)`、**明確排除於 scope 外**）唯三 source caller，全在 auth/local，全傳 `(request, body, env)`，傳入值型別全為 **implicit any**：

| caller | request / env 來源 | body 來源 | 傳入型別 |
|---|---|---|---|
| `register.ts:46` | `onRequestPost({ request, env, waitUntil })`（未標型）| `let body = await request.json()`（未標型）| 全 implicit any |
| `login.ts:51` | `onRequestPost({ request, env })`（未標型）| 同上 | 全 implicit any |
| `forgot-password.ts:51` | `onRequestPost({ request, env, waitUntil })`（未標型）| 同上 | 全 implicit any |

→ 三 caller 的 `request`/`env`/`body` 在 call site 皆 **implicit any**（其本身的 param TS7006 計在 850、屬 defer 的 auth/local 熱區、**不在本 PR**）。**`any` assignable to 任何型別 → 收緊 util 參數型別 0 caller cascade**（比 brute-force 傳入具體型別更不可能 cascade）。spike 實證 functions leaf 恰 −3、tests leaf 0。無其他 caller、無 re-export / barrel / dynamic import。

### 型別選型（per-symbol；spike 實證 + in-repo 先例）

- **`request: Request`**：本檔只讀 `request.headers.get('CF-Connecting-IP')`（標準 header，非 `request.cf` 地理屬性）→ 用 `Request`（非 `CfRequest`）。沿 `auth.ts`/`cors.ts`/`kyc.ts`/`elevation.ts` 多數 util 慣例；`CfRequest` 僅 `device-alerts.ts`/`risk-score.ts`（讀 `.cf`）使用。functions leaf lib = WebWorker，`Request` 解為 WebWorker `Request`、`.headers.get` 回 `string | null`。標準 lib global、eslint 不需註冊（spike exit 0）。
- **`body: Record<string, unknown>`**：body 被 `body?.['cf-turnstile-response']` index → **不能用 `unknown`**（indexing unknown 報錯）；`Record<string, unknown>` index 回 `unknown`、配 `typeof token !== 'string'` narrow 成 string、內部乾淨。沿 [[feedback_ts_test_strict_surface_pattern]] 標準（補洞用 `unknown` / `Record<string, unknown>`）。eslint `no-unnecessary-condition` 未啟（全 repo grep 0；僅 ratchet flag 名）→ `body?.` 不被旗標冗餘（spike exit 0）。
- **`env: Pick<Env, 'TURNSTILE_SECRET_KEY'>`**：util env 參數用 `Pick<Env, 實讀 key>` 非 full `Env`（[[feedback_util_env_param_pick_not_full_env]]：full Env 會在 tests-leaf 以 partial fake env 呼叫時 TS2345 cascade）；本檔僅讀 `TURNSTILE_SECRET_KEY`。沿 `cors.ts:34` `Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>`（PR-2bb）先例。`Env` 已註冊 eslint global；`TURNSTILE_SECRET_KEY?: string` 存於 `env.d.ts:36`（optional、`string | undefined`，與 runtime `if (!secret)` 早退吻合）。

## Open Decisions

**無。** typing 與兩個 OD 由 owner C-1 鎖定：
- **OD-1 顯式 return type = 不加**：本刀是 noImplicitAny reduce；return contract hardening 屬 scope 外；沿 PR-2cd/PR-2ce 只標參數策略；inferred return（`{ok:true,skipped:true} | {ok:false,reason} | {ok:true}` 之 union）已正確，3 caller 的 `ts.ok`/`ts.reason`（`!ts.ok` narrow 後取 `reason`）正常。
- **OD-2 清 JSDoc type tag = 不清**：`.ts` 內 JSDoc type inert（[[feedback_ts_no_jsdoc_in_ts_mode]]）；保留 prose 價值；最小 diff。

**考慮過、否決**：`request: CfRequest`（本檔不讀 `.cf`、過度）；`body: unknown`（被 index 會報錯）/ 具名 body interface（reduce PR 非 data-model 整理）；`env: Env`（過寬、tests-leaf cascade 風險）；標 return type / 清 JSDoc（OD-1/OD-2 否決）；碰 `data:any`（inferred、非 noImplicitAny 錯、scope 外）。

## Spike 實證（2026-06-18，已 revert）

**程序**：套單一簽名 3 annotation → `rm -rf .tscache`（對齊 CI clean-checkout）→ `npm run typecheck:ratchet:report`（全 solution graph `tsc -b tsconfig.solution.json`）→ `tsc -p tsconfig.functions.json`（filter turnstile）→ `tsc -p tsconfig.tests.json`（tests leaf cascade）→ `eslint turnstile.ts` → `esbuild --loader=ts --format=esm` stdin transform base vs head → 真實 `git diff`（取 blob anchor + `git diff --check`）→ `git checkout --` revert → 驗 `git status` clean。

| 驗證 | 目標 | 實測 | 結果 |
|---|---|---|---|
| functions leaf | turnstile.ts 3×TS7006 → 0 | 0 residual、total 847 | ✅ |
| full solution graph | total 850 → 847、zero cascade | errorCount **847** / errorFiles **95** / cleanFiles **239**（恰 −3） | ✅ |
| tests leaf | 維持 0（無其他類別 cascade） | **0** | ✅ |
| eslint | `Request`/`Record`/`Pick<Env>` + `body?.` 乾淨 | **EXIT 0** | ✅ |
| **emit byte-identical** | base==head type-strip JS | 皆 **955 bytes / sha `1924bcbc…`**、非空 | ✅ |
| frozen diff blob | 改後 blob 確定 + 無空白陷阱 | `79afadc7 → 049b0dc5`（+5/−1、單簽名）、`git diff --check` clean | ✅ |
| revert | working tree 回 clean | `git status` 僅 `?? CLEANUP_PLAN.md`、turnstile.ts:31 回原簽名、ratchet 回 850/96/238 | ✅ |

**zero cascade 數學證明**：total 恰降 **3**（= turnstile 的 3 個 noImplicitAny）且 turnstile.ts residual = **0** → 無任何其他檔（含 tests/scripts/browser leaves）error 增減；errorFiles 96→95（turnstile 單檔退 error bucket）、cleanFiles 238→239（進 clean bucket）= 單檔 bucket move。tests leaf 0（3 caller 傳 any、無 test 直呼 `verifyTurnstile`）→ tests-leaf 0 cascade 雙證。

**emit byte-identical（plan-stage 證據；⚠ NB-2 紀律：final 以 code 階段 `build:functions` + esbuild replay receipt 為準，不 overclaim）**：turnstile.ts **無 import**（適用 esbuild stdin transform 單檔法、[[feedback_byte_identical_emit_verification]]）；base(`3bd26315`) vs head 的 type-strip JS 皆 955 bytes / sha `1924bcbc878e83751553f1ddd38c093cea40a98e055e01e8edc96871fd2e48bc` → 3 個 annotation type-strip 後完全消失、runtime bytecode 證實不變（**含未被 test 覆蓋的 fail-close 路徑**）。⚠ 已避 PR-2ce 踩過的 esbuild file-entry `--loader` 空輸出陷阱（空字串 sha `e3b0c442…`）——本 spike 用 stdin transform、實測 955 bytes（非空）。

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，1 檔 +5/−1；真實 `git diff`、blob `79afadc7→049b0dc5`、嵌入時空白 context 行已清成真空行 → 無 `git diff --check` 陷阱、[[feedback_plan_frozen_diff_git_diff_check]]）**：

```diff
diff --git a/functions/utils/turnstile.ts b/functions/utils/turnstile.ts
index 79afadc7..049b0dc5 100644
--- a/functions/utils/turnstile.ts
+++ b/functions/utils/turnstile.ts
@@ -28,7 +28,11 @@ const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverif
  * @param {object} env   含 TURNSTILE_SECRET_KEY
  * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
  */
-export async function verifyTurnstile(request, body, env) {
+export async function verifyTurnstile(
+  request: Request,
+  body: Record<string, unknown>,
+  env: Pick<Env, 'TURNSTILE_SECRET_KEY'>,
+) {
   const secret = env?.TURNSTILE_SECRET_KEY
   if (!secret) return { ok: true, skipped: true }
```

## 預期 ratchet

- clean main `3bd26315`：errorCount **850** / errorFiles **96** / cleanFiles **238**。
- 本 PR 後 current state：errorCount **850 → 847**（−3）、errorFiles **96 → 95**（−1）、cleanFiles **238 → 239**（+1）、sourceFilesTotal 334 不變。
- baseline file 不變（天花板 1119/175；reduce 不 `--update`；對外報告稱「current state 降至 847」，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback（bundle byte-identical）

- 改動 = 3 個裸參數型別 annotation。**TS/esbuild type-strip 後完全消失**：`request: Request` → `request`、`body: Record<string, unknown>` → `body`、`env: Pick<Env, 'TURNSTILE_SECRET_KEY'>` → `env`。**無 `as` cast、無投影 alias、無新 binding** → emit JS 與改前**逐位元組相同**（spike 已實測 955 bytes / sha `1924bcbc…`）——與 PR-2cc / PR-2ce 同級。⚠ **NB-2**：plan-stage 已實測；final 以 code 階段 `build:functions` + esbuild replay receipt 為準（不僅憑推斷）。
- `SITEVERIFY_URL`、fetch（method/body/URL）、`URLSearchParams` 組裝、`data.success`/`data['error-codes']` 解析、`if (!secret)`/`if (!token…)` guard、try/catch fail-close、所有 return 形態 **未改一字**。
- rollback：單一 squash revert 完整回退；revert 後 ratchet 回 850。

## 測試影響面（覆蓋誠實 — ⚠ **direct test = 0**）

- **`turnstile.ts` 無 dedicated test**（無 `turnstile.test.ts`）。**direct coverage = 0**。
- **間接覆蓋僅 skip-path**：3 caller 各有 integration test（`tests/integration/{register,login,forgot-password}.test.ts`），但 `tests/` 全域 + vitest/wrangler 設定**皆未設 `TURNSTILE_SECRET_KEY`、未送 `cf-turnstile-response`**（grep 0 命中）→ 測試 env `env.TURNSTILE_SECRET_KEY` undefined → `verifyTurnstile` 走早退 `if (!secret) return { ok: true, skipped: true }`。**僅 skip 分支被間接執行；token-missing / verify / fail-close-catch 三路徑 0 test 覆蓋。**
- **本 PR 防線（無 direct test → byte-identical 為首要防線）**：(1) **emit bundle byte-identical**（type-strip 後 JS 逐位元組相同、含未被測的 fail-close 路徑——這是 fail-close 不漂移的**唯一硬保證**）；(2) `build:functions` compiled；(3) forced tsc zero-cascade（847、tests-leaf 0）；(4) `eslint` 0；(5) diff +5/−1 機械可審；(6) 全量 `test:int`（含 3 caller integration、skip-path regression breadth，無 spillover）。
- **覆蓋宣稱（誠實，[[feedback_pr_coverage_claim_accuracy]]）**：**不得宣稱 direct Turnstile coverage**；只能宣稱「3 integration caller 的 skip-path 間接覆蓋」+「byte-identical receipt 保 fail-close 路徑 emit 不變」。
- **strict-rung 邊界（不在本 PR）**：本檔開 `strict:true`/`noUncheckedIndexedAccess` 後 `data`（`res.json()` any）/ `body?.['cf-turnstile-response']`（NUIA → `unknown | undefined`）等可能浮 strict 債——登記供 strict 棒，本 noImplicitAny 棒不處理（spike 已驗：未來 NUIA 開啟後 `!token`+`typeof` 仍 narrow，無 forward 風險）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後）

> 無 ambient .d.ts 變更；保險 tsc/ratchet 可 `rm -rf .tscache` 全重建（= CI clean-checkout）。branch 已有 plan-doc commit → plain ratchet base 自動 = origin/main `3bd26315`；保險 `$env:RATCHET_BASE_REF='3bd26315'; npm run typecheck:ratchet`。**不帶** `RATCHET_ALLOW_BASELINE_RAISE`（[[feedback_ts_ratchet_discipline]]）。

> **NB-1 / L-8（沿 PR-2ce 紀律）**：以下全項於 **code 階段（`CODING_ALLOWED` 後）對真實 source diff 重新實跑**（含 full solution graph `tsc -b` + esbuild replay）；**§Spike 實證的數字僅 plan-stage 證據、非 final receipt**，不得沿用當 Code Gate 收據。

- `$env:RATCHET_BASE_REF='3bd26315'; npm run typecheck:ratchet` green（850→847 / 96→95 / 238→239）。
- `npm run lint` green（全量；= `eslint functions tests && lint:compat-date && lint:workflows`）。
- `npm run build:functions` green（type-strip、Worker 編譯）。
- filtered `tsc -p tsconfig.functions.json`：`turnstile.ts` 0 殘留。
- **`npm run test:cov` green** + **全量 `npm run test:int` green**（CI 順序，[[feedback_pre_merge_gate_checklist_match_ci]]）；含 `tests/integration/{register,login,forgot-password}.test.ts` skip-path 間接 regression（**非** direct turnstile coverage）。
- baseline file 不得 `--update`（1119/175）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（1 檔 +5/−1、單簽名、改後 blob = `049b0dc5`、= spike 同 blob）；超出 = scope creep = Gate fail。
- **byte-identical receipt（review care L2，⚠ 無 direct test → Code Gate 必附、首要防線）**：
  1. base(`3bd26315`) vs HEAD 的 `turnstile.ts` esbuild stdin type-strip JS **逐位元組相同**（預期 955 bytes / sha `1924bcbc…`）——證 fail-close 四路徑 emit 全不變。
  2. `SITEVERIFY_URL` / fetch（method/body/URL）/ `URLSearchParams` / `data.success`·`data['error-codes']` 解析 / `if (!secret)`·`if (!token…)` guard / try-catch fail-close / 所有 return —— 未改（全在 diff 行外）。
- merge 後 smoke：credential-free home / login / register / forgot-password 200（skip-path；prod `TURNSTILE_SECRET_KEY` 視 owner 設定）；fail-close 行為以 byte-identical receipt + prod 觀測為準（無 test 覆蓋）。

## 流程定位

- Dual Gate Workflow v3.1：`SPEC_APPROVED`（owner C-1）✅ → scout（read-only 實跑）✅ → plan-stage spike（單輪達標：847/0/zero-cascade/tests-leaf 0/byte-identical）✅ → **`PLAN_SELF_REVIEW_CLEAN`**（單 agent 對抗式，impl L1）✅ → 本 doc commit（feature branch `stage7-pr2cf-turnstile-noimplicitany`）→ **`CHATGPT_ARCH_APPROVED`**（維度 B，owner-relayed）→ **`CODEX_PLAN_APPROVED`**（維度 C）→ owner `CODING_ALLOWED` → coding（frozen replay +5/−1）→ 機械 gates → **`CODE_SELF_REVIEW_CLEAN`**（單 agent，impl L1）→ **`CODEX_CODE_APPROVED`** → **`CHATGPT_CODE_FAITHFULNESS_APPROVED`**（v3.1 任何級別全走）→ owner 明示 squash-merge --delete-branch → `MERGED_MAIN`。
- **self-review 形式裁定**：依 PR-2cd/PR-2ce 既定先例（同 impl L1 / review care L2），impl L1 → **單 agent 對抗式 self-review**（非 multi-agent workflow）；review care L2 → 外部全 4 道 chain + byte-identical receipt（不 lighter）。⚠ 本 PR **無 direct test**（不同於 PR-2ce 的 16-test direct）→ byte-identical receipt 防線權重更高。
- **Claude plan 自審紀錄（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式，impl L1，一輪 0 新發現）**：
  1. **delta 數學**：850−3=847 ✅；spike set-diff turnstile 3→0、total 恰 −3（zero cascade）✅；errorFiles 96→95 / cleanFiles 238→239（單檔 bucket move）✅。
  2. **cascade 誠實**：純裸參數、無 `raw:unknown` 式下游；3 caller 傳 implicit any（`any`→任何型別）、無 test 直呼 → functions leaf 恰 −3、tests leaf 0，spike 雙證 ✅。
  3. **typing 忠實 caller + in-repo 先例**：`request: Request`（只讀 `.headers.get`、非 `.cf`、多數 util 慣例）/ `body: Record<string,unknown>`（被 index、標準補洞型）/ `env: Pick<Env,'TURNSTILE_SECRET_KEY'>`（cors.ts:34 先例、util-env-Pick 紀律、env.d.ts:36 確存）逐一核對 ✅；駁回 CfRequest/unknown/full-Env ✅。
  4. **runtime 誠實**：純參數 annotation、type-strip 後 **bundle byte-identical**（無 alias、無 cast，spike 實測 955 bytes/sha `1924bcbc…`）✅；NB-2 標明 final 以 code 階段 receipt 為準 ✅。
  5. **無 direct test → byte-identical 首要防線**：誠實標 direct=0、integration 僅 skip-path（grep 證 TURNSTILE_SECRET_KEY 測試未設）；fail-close 三路徑 0 test → byte-identical 為 fail-close 不漂移唯一硬保證，權重高於 PR-2ce ✅。
  6. **敏感面 byte-identical**：fail-close 四語意（skip / token-missing / verify / catch）+ SITEVERIFY_URL + fetch + URLSearchParams + data 解析全在 diff 行外 ✅。
  7. **scope**：single-file、無 out-of-scope error、3 caller / `api/ai/assist.ts` 同名 helper / tests / config / baseline / `CLEANUP_PLAN.md` / `totp.ts` 未碰（C-1 鎖定區全守）✅；同名函式誤傷風險由 scope 明確排除 assist local helper 化解 ✅。
  8. **L1/L2**：impl L1（純參數 annotation、bundle byte-identical）/ review care L2（captcha fail-close、Tier-0 鄰接、比 brute-force 更敏感）✅。
  9. **doc 機械**：嵌入 frozen diff 空白 context 行清成真空行、`git diff --check` 對 plan-doc 須 clean（commit 前實跑）✅。
- **本域後續序（owner C-1 裁，輕→重）**：metrics（PR-2cc ✅）→ ai/assist（PR-2cd ✅）→ brute-force（PR-2ce ✅）→ **turnstile（本 PR）** → `totp.ts` 折回 2FA/elevation/account 域。本檔結束後 mechanical-misc 域清空。
