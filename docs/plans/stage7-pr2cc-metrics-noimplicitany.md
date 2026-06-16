# Stage 7 reduce PR-2cc — `functions/api/admin/metrics.ts` noImplicitAny cleanup（domain-batched cadence 第 1 棒 = cadence-smoke）

**目標**：`functions/api/admin/metrics.ts` 的 **6 個 noImplicitAny error（2×TS7031 + 1×TS7018 + 3×TS7006）→ 0**，純 type-only（1 檔 +3/−3；零 runtime 行為改動、零其他檔 cascade）。

> **cadence 定位（owner 2026-06-16 裁示）**：cors PR-2bb 後經 scout 實測校正——functions leaf noImplicitAny **未清零、尚餘 869／99 檔**（auth-core 單檔 chain 只清了 auth-core subset；audit/payments/oauth/webauthn/billing/kyc/session 等 defer 熱區 chain 從未跑）。owner 拍板新 cadence＝**domain-batched + risk-tiered、輕→重、owner 每域批次確認**。mechanical-misc 域 scout 後再細拆（owner 否決「26 一包」與「metrics+ai/assist 合包」）→ **本 PR = 第 1 棒 `admin/metrics.ts` 單檔 cadence-smoke**，驗證新 domain-batched cadence 的最小安全節奏。後續序：ai-assist-type-only → auth-defense-brute-force → captcha-turnstile → …；`utils/totp.ts` 移出本域、折回未來 2FA/elevation/account 域（2FA replay 核心、不作 cadence 試驗品）。

> **為何選 metrics 當 cadence-smoke（owner 裁）**：(a) 有 regression test `tests/integration/admin-metrics.test.ts`；(b) 主體純 SELECT 觀測聚合、admin read-only、0 INSERT/UPDATE/DELETE；(c) 補洞全機械（handler ctx + 1 fallback shape + 1 projection helper），唯一 watch-point 是 `brokenAt: null` 的 TS7018。

base main `540f07c1`（branch fork point）。baseline 已於該 SHA 實測（canonical `node scripts/typecheck-ratchet.mjs --report`）：**errorCount 869 / errorFiles 99 / cleanFiles 235 / sourceFilesTotal 334**。**勿**沿用更舊快照。baseline file 天花板 **1119/175** 凍結（reduce PR 不 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Gate 紀錄（Dual Gate Workflow v3，[[feedback_codex_review_workflow]]）

當前 state = **`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（@ plan commit `02de7acc`）。impl **L1** / review care **L2**（Arch 升）。**待 owner 送 Codex Plan Gate**。

- 2026-06-16 owner 裁示（mechanical-misc 細拆 + 「先寫 `admin/metrics.ts` cadence-smoke plan doc，進 Codex chain」）= **`SPEC_APPROVED`**。spec：scope = `admin/metrics.ts` 6 noImplicitAny → 0、純 type-only reduce PR；Non-goals = 不碰任何 SQL / rate-limit 邏輯 / audit 寫入 / HMAC / `verifyAuditChain` 契約 / payload 結構 / scope gate；不碰 caller / tests / config。impl 級別 = **L1**、review care = **L1**（admin read-only、非 security-boundary SSOT；audit/PII 鄰接面以 receipt byte-identical 守，gate 可挑戰升 L2）。同輪預授權 A1 spike + plan doc 落檔 commit feature branch。
- 2026-06-16 **A1 spike 已執行並全項達標**（見 §Spike 實證；主方案單輪零修正），working tree 已 revert clean（HEAD `540f07c1`、僅 `?? CLEANUP_PLAN.md` untracked、ratchet `--report` 回 869/99/235）。
- 2026-06-16 **Claude plan 自審到零**（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式，L1，一輪 0 新發現）：見 §流程定位 自審紀錄。
- 2026-06-16 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（@ plan commit `02de7acc`）— 0 blocker、不需重寫 plan、可進 Codex Plan Gate。**review care L1 → L2**（diff 僅 3 行 type-only，但鄰接 admin / audit / PII-hash）。**OD 全裁**：OD-1 採 `number | null`（精確對齊 `verifyAuditChain` 契約、不為保守放寬到未出現型別）；OD-2 採 `Record<string, unknown>` + `r[key] as string`（最小 TS-only 投影、不把 D1 row 值誤宣告成 `string | number`）。**必鎖**：source diff 只能是凍結 3 行（禁順手整理 / 改名 / 重排 / 抽 helper）；零 runtime；不改 SQL / binding / 排序 / limit / aggregation；不改 `verifyAuditChain` 呼叫·fallback 流程·payload shape（除 TS annotation 必要點）；不改 `hashIdentifierForAudit` / HMAC 呼叫與輸入；不改 scope / role / auth gate；禁 `any` / suppression / 放寬 tsconfig；PR 必附 SQL / `verifyAuditChain` / HMAC / payload / scope-gate **byte-identical receipt**。**NB（Arch 提醒）**：`CLEANUP_PLAN.md`（untracked、session 既存）不得進本 PR——一律 explicit `git add <檔>`（禁 `-A` / `.`），merge 前驗 PR diff 不含它（取代舊措辭：untracked 檔存在 ≠ clean worktree）。
- **待**：Codex Plan Gate → owner `CODING_ALLOWED` → Code → Codex Code Gate → owner squash。未 push、未開 PR、未動 main。

## 敏感面聲明（review 對齊）

`functions/api/admin/metrics.ts` 是 **admin 全站觀測聚合端點**（`Authorization: Bearer`，scope gate `admin:users:read|write`）。**非 security-boundary SSOT**，但本檔鄰接三個敏感面，型別改動**全程不得牽動**，code gate 以 receipt byte-identical 驗：

- **rate-limit**：`checkRateLimit` / `recordRateLimit`（per-admin `admin_read` 60/60s）+ `admin.read.rate_limited` audit。
- **audit 完整性**：`verifyAuditChain(db)` hash-chain 驗證 + `admin.metrics.read` read-audit。
- **PII**：top-IP 經 `hashIdentifierForAudit` keyed-HMAC16（raw IP = PII，不外洩）。

**修法若非純型別、或會牽動：任何 SQL 字面值 / `Promise.all` 查詢集 / rate-limit 分支 / `verifyAuditChain` 呼叫或其 fallback 語意 / `hashTopIps` HMAC / payload 欄位與 `?? 0` 預設 / scope gate → 立刻停手回 `PLAN_DRAFT`。** TS erase 後 runtime 行為必須 byte-identical。

## Coding 階段硬性邊界

- **允許（= §Spike 最終 diff 逐行，1 檔 +3/−3）**：
  1. `onRequestGet({ request, env })` → `onRequestGet({ request, env }: { request: Request; env: Env })`（handler context 解構標註）。
  2. `verifyAuditChain(db).catch(err => ({ … brokenAt: null … }))` → `brokenAt: null as number | null`（修 TS7018；型別取自 `verifyAuditChain` 實際回傳契約，見 §型別選型 / OD-1）。
  3. `const byKey = (rows, key) => …map(r => [r[key], r.n])` → `(rows: { results?: Record<string, unknown>[] }, key: string) => …map((r: Record<string, unknown>) => [r[key] as string, r.n])`（projection helper 標註；鏡像同檔既有 `hashTopIps` 的 `rows: { results?: … }` 慣例）。
- **禁止**：改任何 SQL 字面值 / 查詢順序 / `Promise.all` 結構；改 rate-limit 分支 / 上限數字；改 `verifyAuditChain` 呼叫、其 fallback 物件的其他欄位（`valid`/`total`/`reason`）或語意；改 `hashTopIps` / HMAC / `String(r.ip)`；改 payload 欄位名 / `?? 0` 預設 / `byKey` 的 runtime 演算（`Object.fromEntries`/`.map`/`r[key]`/`r.n` 不動）；改 scope gate；改 caller、tests、tsconfig / eslint / vitest；新增字面 `:any`、新增 suppression、新增 import、新增 runtime guard 或分支；`String(r[key])`-式 runtime coercion 改寫（用 `as string` 純型別、非 `String()` 呼叫）。

## Scout（對抗式驗證）

### exact errors（forced `tsc -b tsconfig.solution.json --force` @ `540f07c1`，total 869）

恰 **6** 個，全在 `functions/api/admin/metrics.ts`（無其他 error code 殘餘於本檔）：

| 位置（line,col）/ 標的 | code | 性質 |
|---|---|---|
| (22,38) `onRequestGet({ request … })` | TS7031 | noImplicitAny（handler ctx 解構元素）|
| (22,47) `onRequestGet({ … env })` | TS7031 | noImplicitAny（handler ctx 解構元素）|
| (105,29) `brokenAt: null`（verifyAuditChain `.catch` fallback）| TS7018 | object literal property 隱式 any（strictNullChecks:false 下 `null` 型別 ≡ any）|
| (109,18) `byKey = (rows, …)` | TS7006 | noImplicitAny |
| (109,24) `byKey = (…, key)` | TS7006 | noImplicitAny |
| (109,76) `.map(r => …)` 的 `r` | TS7006 | noImplicitAny |

`(105)` 與其他 5 個 TS70xx 不同：它**不是** param 缺型別，而是 `null` literal 在 `strictNullChecks:false` 下被推為 `any` → object literal property TS7018。修法必為「給該 property 顯式型別」（見 §型別選型 / OD-1），非裸 param annotation。

### out-of-scope（forced tsc 同時浮出、明確不在本刀）

無。`metrics.ts` 的 6 個 error 是本檔全部；其餘 863 個分散在 audit/payments/oauth/webauthn 等 defer 域（後續批次）。

### 依賴邊界（cascade 面，spike comm 實證）

- **caller 面**：`metrics.ts` 的 `onRequestGet` 由 Pages Functions runtime 與 `tests/integration/admin-metrics.test.ts` 的 `metricsGet({ request, env })` direct-call 呼叫。`byKey` / `hashTopIps` 為 module-local helper（無外部 caller）。
- **handler ctx 型別選 full `Env`（非 `Pick`）**：本檔把 `env` 整包傳給 `requireAnyScope(request, env, …)` / `checkRateLimit(env.chiyigo_db, …)` / `safeUserAudit(env, …)` / `hashIdentifierForAudit(env, …)`——後二者要 full `Env`，`Pick` 會破。且 `admin-metrics.test.ts` 以 `cloudflare:test` 的 **full `env`（ProvidedEnv ≈ Env）** direct-call（非 partial fake env）→ full `Env` 既正確又 test-safe（[[feedback_util_env_param_pick_not_full_env]] 的 Pick 觸發條件＝unit test 傳 partial fake env，此處不成立）。
- **zero cascade（實證，非推論）**：spike forced full rebuild（`tsc -b tsconfig.solution.json --force`，含 tests-leaf）後 before/after error-set diff：**REMOVED = 恰 6 行**（本檔 6 個 error 逐行對上）、**ADDED = 0**（全 solution graph：functions + scripts + tests + browser leaf 無任何新增 error 行）。total 恰 869→863（−6）。

### 型別選型（per-symbol；spike 實證）

- **`{ request: Request; env: Env }`（handler ctx）**：`Request` = WebWorker lib global（本檔讀 `request.headers` 經 `requireAnyScope`，不讀 `request.cf` → 標準 `Request` 非 `CfRequest`）；`Env` = `types/env.d.ts` `declare global` ambient（prior chain PR 已用 + eslint globals 已註冊，無需 import）。full `Env`（非 `Pick`）理由見上 §依賴邊界。
- **`brokenAt: null as number | null`**：`verifyAuditChain`（`functions/utils/audit-log.ts:143-148`）回傳契約為 `Promise<{ valid: boolean; total: number; brokenAt: number | null; reason: string | null }>`。fallback 的 `brokenAt` runtime 永遠是 `null`（error path），但 `strictNullChecks:false` 下 `null` literal ≡ any → TS7018；cast 成 `number | null` 給它顯式型別、**且與 success-path 同型**（`chain` union 收斂乾淨）。owner 例示 `string | number | null`（保守 superset）；scout 實讀契約 → 採精確 `number | null`（更窄、忠於 `verifyAuditChain`、仍 conservative inline、**不碰 `verifyAuditChain` 契約本體**）。見 OD-1。
- **`byKey` 的 `rows: { results?: Record<string, unknown>[] }` + `r: Record<string, unknown>` + `r[key] as string`**：
  - `rows` 結構型別**鏡像同檔既有 `hashTopIps`（line 113）的 `rows: { results?: { … }[] }` 慣例**——非新發明風格。caller 傳 `usersByStatus` / `usersByRole`（D1 `.all()` 結果，結構含 `results`）→ assignable。
  - `r[key] as string`：`r[key]` 為 `unknown`（`Record<string, unknown>` 索引），而 `Object.fromEntries` 要求 entry 首元素為 `PropertyKey`（`unknown` 不 assignable）→ 需顯式型別。`key` 恆為 `'status'`/`'role'`（GROUP BY 投影欄位），runtime 恆為 string；`Object.fromEntries` 本就對鍵做 ToString → **cast erased、runtime byte-identical**（非 `String()` 呼叫，純型別斷言）。
  - `r.n`（count，`unknown`）為 entry 值，`Object.fromEntries` 值型別不限 → 不需處理。

## Open Decisions（prose 裁決，[[feedback_gate1_forks_prose_ruling]]）

- **OD-1：`brokenAt` 型別** — `number | null`（精確、=`verifyAuditChain` 契約）vs `string | number | null`（owner 例示的保守 superset）。
  - **主方案（`number | null`，建議）**：忠於 `verifyAuditChain` 實際回傳，使 `chain` union 同型；spike 證零 cascade（`chain` 僅用於 `chain.valid` 與整包嵌入 payload，無 `chain.brokenAt` 下游存取，故任一 superset 亦可，但精確型最誠實）。
  - **`string | number | null` 變體（owner 例示）**：更寬，無 error 驅動需要；接受度高但與契約不一致。
  - **建議裁 `number | null`**；若 owner/Arch 偏好沿用例示 superset，改 `string | number | null` 即可（兩者 spike 皆 0 cascade；`strictNullChecks:false` 下都收斂為 `number`）。**【Arch 裁定：採 `number | null`】**
- **OD-2：`byKey` 投影 `r` 是否用 cast** — 主方案 `r: Record<string, unknown>` + `r[key] as string`（spike 實證 0 cascade）vs `r: Record<string, string | number>`（讓 `r[key]` 自然為 `PropertyKey`、免 cast）。
  - **主方案（cast，建議）**：鏡像同檔 `hashTopIps` 的 `Record<string, unknown>` 風格；不對 D1 `.all()` 的 row 值型別作未驗證斷言（D1Result 元素可能為 `unknown`，narrowing 成 `string | number` 有 call-site cascade 風險）。`as string` 限縮在「key 欄位恆 string」此一已知不變量。
  - **`Record<string, string | number>` 變體**：免 cast，但對 row 值型別作較強斷言、且 spike 未驗（採 cast 版已單輪達標）。
  - **建議裁主方案**；變體若 Arch 偏好「免 cast」可改裁，但須回 spike 驗 call-site 0 cascade。**【Arch 裁定：採主方案 `Record<string, unknown>` + `r[key] as string`】**

**考慮過、否決**：
- **`env: Pick<Env, …>`**：本檔把 env 整包傳 `safeUserAudit`/`hashIdentifierForAudit`（要 full `Env`）→ Pick 破 caller。且 test 傳 full env → 無 Pick 必要。否決，用 full `Env`。
- **`request: CfRequest`**：本檔不讀 `request.cf` → 違反 CfRequest opt-in 紀律、過寬。否決，用 `Request`。
- **`String(r[key])`（runtime coercion）**：改 runtime（新增函式呼叫，即使語意等價）→ 超出 type-only scope。否決，用 `as string`（型別 erase）。
- **重構 `.catch` fallback 為顯式 return-type 標註**（`(err): {…完整 shape…} => …`）：可免 `as`，但比單一 property cast 多標一整個 object shape、且重複 `verifyAuditChain` 契約。否決，用最小的 `brokenAt: null as number | null`。

## Spike 實證（A1，2026-06-16，已 revert）

**程序**：`rm -rf .tscache` → 套 3 處標註 → `node ./node_modules/typescript/bin/tsc -b tsconfig.solution.json --force --pretty false`（全重建，含 tests-leaf）→ before/after error-set（`file(line,col): TSxxxx` 鍵）set-diff → `npx eslint functions/api/admin/metrics.ts` → `git diff --stat` / `git diff --check` → `git diff` 凍結 → `git checkout --` revert → 驗 clean。（tsc 走 `node ./node_modules/typescript/bin/tsc`、`--force` 全重建避增量短報 [[feedback_tsc_b_incremental_stale_after_ambient_dts]]。）

**主方案單輪達標（零修正輪）**：

| 驗收條件 | 結果 |
|---|---|
| `metrics.ts` errors 6 → 0 | ✅ forced tsc：本檔 0 殘留（after byLeaf `{functions:863}`）|
| total errorCount 869 → 863（恰 −6） | ✅ forced tsc error-line count = 863 |
| zero cascade（全 solution graph：functions + scripts + tests + browser leaf） | ✅ before/after set-diff：**ADDED = 0**；**REMOVED = 恰 6 行**（本檔 (22,38)/(22,47)/(105,29)/(109,18)/(109,24)/(109,76) 逐行對上）|
| tests-leaf 無 cascade | ✅ after byLeaf 僅 `functions:863`（tests/scripts/browser leaf = 0；`admin-metrics.test.ts` direct-call `{ request, env }` 與 handler ctx 型別吻合）|
| lint | ✅ `npx eslint functions/api/admin/metrics.ts` exit 0（無 `:any`；`Request`/`Env` 既有 global、`Record`/cast TS 內建）|
| diff 面 | ✅ `git diff --stat` = **1 檔 +3/−3**；`git diff --check` exit 0（無 trailing whitespace）|
| working tree revert clean | ✅ revert 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、`--report` 回 869/99/235、HEAD `540f07c1`（本 doc 凍結 diff 為 SoT）|

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，1 檔 +3/−3；OD-1 採 `number | null` / OD-2 採 cast）**：

```diff
diff --git a/functions/api/admin/metrics.ts b/functions/api/admin/metrics.ts
--- a/functions/api/admin/metrics.ts
+++ b/functions/api/admin/metrics.ts
@@ -19,7 +19,7 @@ import { verifyAuditChain } from '../../utils/audit-log'
 import { safeUserAudit, hashIdentifierForAudit } from '../../utils/user-audit'
 import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'

-export async function onRequestGet({ request, env }) {
+export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
   // P1-17 Phase 3: metrics 主要是用戶/session 統計 → 收進 admin:users:read|write
   const { user, error } = await requireAnyScope(request, env, SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE)
   if (error) return error
@@ -102,11 +102,11 @@ export async function onRequestGet({ request, env }) {

   // hash chain 驗證另外做（要從頭 walk，不便和上面平行）
   const chain = await verifyAuditChain(db).catch(err => ({
-    valid: false, total: 0, brokenAt: null, reason: 'verify_failed:' + err?.message,
+    valid: false, total: 0, brokenAt: null as number | null, reason: 'verify_failed:' + err?.message,
   }))

   // ── 整理輸出 ───────────────────────────────────────────────────
-  const byKey = (rows, key) => Object.fromEntries((rows.results ?? []).map(r => [r[key], r.n]))
+  const byKey = (rows: { results?: Record<string, unknown>[] }, key: string) => Object.fromEntries((rows.results ?? []).map((r: Record<string, unknown>) => [r[key] as string, r.n]))
```

（所有 SQL / `Promise.all` 查詢集 / rate-limit 分支 / `verifyAuditChain` 呼叫與 fallback 其他欄位 / `hashTopIps` HMAC / payload 欄位與 `?? 0` 預設 / scope gate / `Object.fromEntries`·`.map`·`r[key]`·`r.n` runtime 演算 **byte-identical**；新增 = 1 handler ctx 標註 + 1 property cast + 1 helper 雙 param 標註；TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `540f07c1` `--report` 現況：errorCount **869** / errorFiles **99** / cleanFiles **235** / sourceFilesTotal 334。
- 本 PR 後 current state：errorCount **869 → 863**（−6）、errorFiles **99 → 98**（−1）、cleanFiles **235 → 236**（+1）、sourceFilesTotal 334 不變。delta 由「proven zero-cascade + 單檔 bucket move」決定（`metrics.ts` 由 error→clean，他檔不變）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 863」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 1 handler ctx 標註 + 1 property 型別 cast（`null as number | null`）+ 1 helper 雙 param 標註，**TS erase 後 runtime 行為不變**（esbuild type-strip：annotation 與 `as` cast 全消；`byKey` 的 `Object.fromEntries`/`.map`/`r[key]`/`r.n` runtime 演算 byte-identical）。
- rollback：單一 squash revert 即完整回退（無 ambient 變更、無 migration、無 deploy 行為差）；revert 後 ratchet 自然回 869。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（spike set-diff 證 tests-leaf 0 新 error）。
- **direct regression**：`tests/integration/admin-metrics.test.ts`（401 未授權 / 403 player scope / 200 admin + 完整結構 / insert 假資料比對 count + `chain_integrity.valid`）—— 型別改動後此 suite 必須**全綠不改一行**。`onRequestGet` ctx 標 `{ request: Request; env: Env }` 與 test 的 `metricsGet({ request: authReq(token), env })` direct-call 吻合（spike comm 證 0 新 error）。`npm run test:cov`（含此檔）/ `test:int` 覆蓋（coding 階段跑）。
- **runtime-invariance 論證（非靠新 test）**：型別標註 + `as` cast 對 esbuild bundle 為 no-op（type-strip）→「標註版」與「原版」runtime bundle byte-identical → 既有 test 結果 construction-invariant。coding 階段仍跑 `test:cov` + `test:int` 作 belt-and-suspenders。
- **strict-rung 邊界（不在本 PR scope）**：本檔開 `strict:true` 後預期 `usersTotal?.n ?? 0` 等 `?.` 已 null-safe；`r[key]`/`r.n` index access 在 `noUncheckedIndexedAccess` 下可能浮 strictNull 債——登記供 strict 棒對帳，與本 noImplicitAny 棒無關。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後）

> 本 PR 無 ambient .d.ts 變更；所有 tsc/ratchet 量測 `rm -rf .tscache` 全重建。branch 已有 plan-doc commit → tip ≠ origin/main，plain ratchet base 自動 = origin/main `540f07c1`；保險 `$env:RATCHET_BASE_REF='540f07c1'; npm run typecheck:ratchet`。**不帶** `RATCHET_ALLOW_BASELINE_RAISE`（error-reducing reduce PR、正常下降）。

- `$env:RATCHET_BASE_REF='540f07c1'; npm run typecheck:ratchet` green（869→863 / 99→98 / 235→236）。
- `npm run lint` green（全量）。
- `npm run build:functions` green（type-only、esbuild type-strip）。
- filtered forced tsc：`metrics.ts` 0 殘留、before/after set-diff 重放（移除 6 行、零新增）。
- **`npm run test:cov` green**（CI `test` 為 fail-fast 單 job、先跑 cov；cov 紅會 skip test:int/build/audit → 必先綠，[[feedback_pre_merge_gate_checklist_match_ci]]；**含 `tests/integration/admin-metrics.test.ts`，必逐 case 綠**）。
- **全量 `npm run test:int` green**（接在 test:cov 之後，對齊 CI 順序）。
- baseline file 不得 `--update`（天花板 1119/175 保持）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（1 檔 +3/−3，不得多檔；若 Arch 改裁 OD-1/OD-2 則以該裁決為新凍結基準）；超出 = scope creep = Gate fail。
- **approved-scope 對帳基準（Codex / code stage 逐項複核）**：
  1. 6 errors（2 TS7031 + 1 TS7018 + 3 TS7006）→ 0（不多不少；ratchet 869→863）
  2. type-only（TS erase 後 runtime 行為 byte-identical：所有 SQL / rate-limit / audit / HMAC / payload / `byKey` 演算）
  3. 僅 `functions/api/admin/metrics.ts` 1 個 production 檔（無 ambient / config / tests / caller 改動）
  4. OD-1/OD-2 裁決落實（`brokenAt: null as number | null` / `byKey` cast 版，或 Arch 改裁版）
  5. 全檔無字面 `:any` / 無 suppression / 無新 import / 無新 runtime 分支；`as` 僅 `r[key] as string`（key 恆 string 不變量）與 `null as number | null`（=契約型別）
- merge 後 smoke：credential-free home / login 200（chain 預設）；metrics 行為以 `admin-metrics.test.ts` + CI 全量 integration 為準。

## 流程定位

- Dual Gate Workflow v3：`SPEC_APPROVED`（owner 2026-06-16 裁示 + 「先寫 metrics cadence-smoke plan doc」）✅ → A1 spike ✅ → **`PLAN_SELF_REVIEW_CLEAN`**（單 agent 對抗式，L1）✅ → 本 doc commit（feature branch `stage7-pr2cc-metrics-noimplicitany` `02de7acc`）✅ → **`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（review care 升 L2、OD-1/OD-2 採主方案、frozen 3 行鎖 + receipt 必附）✅ → **Codex Plan Gate**〔← 當前待 owner 送審〕→ owner `CODING_ALLOWED` → coding（frozen byte-identical replay）→ 機械 gates 全綠 → `CODE_SELF_REVIEW_CLEAN`（單 agent，impl L1）→ Codex Code Gate → owner 明示 squash-merge → push → PR → CI `test` 綠 → squash-merge --delete-branch → `MERGED_MAIN`。
- **Claude plan 自審紀錄（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式，L1，一輪 0 新發現）**：對抗以下探針——
  1. **delta 數學**：869−6=863 ✅；set-diff ADDED=0（零 cascade）、REMOVED=6 行 ✅；errorFiles/cleanFiles 由單檔 bucket move 決定（99→98 / 235→236）✅。
  2. **TS7018 framing**：(105) 明標為 `null`≡any（strictNullChecks:false）非 param 缺型別、修法為 property 顯式型別非裸 annotation ✅；型別取自 `verifyAuditChain` 契約 `number | null`（audit-log.ts:143-148 實證）✅。
  3. **tests 安全性**：handler ctx full `Env` 與 `admin-metrics.test.ts` direct-call full env 吻合（spike comm 0 新 error）✅；非 partial fake env → 無 Pick 必要 ✅。
  4. **cast 誠實性**：`r[key] as string`——key 恆為 GROUP BY 投影欄位（status/role）、runtime 恆 string、`Object.fromEntries` 本就 ToString → cast erased、runtime byte-identical ✅；非 `String()` 呼叫（純型別）✅。
  5. **敏感面不變**：rate-limit / `verifyAuditChain` 呼叫與 fallback 其他欄位 / `hashTopIps` HMAC / 所有 SQL / payload / scope gate 全 byte-identical（frozen diff 逐行核）✅。
  6. **scope 邊界**：single-file ✅；無 out-of-scope error 夾帶 ✅；caller/tests/config 未碰 ✅。
  7. **L1 研判**：純型別、TS erase 後 0 runtime；admin read-only 非 security-boundary SSOT → review care L1（audit/PII 鄰接以 receipt 守）✅；級別可由 gate 挑戰升 L2 ✅。
- merge 後監看 CI+Deploy；memory 收尾 receipt。
- **本域後續序（owner 裁，輕→重）**：metrics（本 PR）→ `ai/assist.ts`（ai-assist-type-only，獨立、無 direct test + raw narrowing watch）→ `utils/brute-force.ts`（auth-defense）→ `utils/turnstile.ts`（captcha）→ … ；`utils/totp.ts` 折回未來 2FA/elevation/account 域。
