# Stage 7 reduce PR-2z — utils/rate-limit noImplicitAny（auth-core chain 第 10 棒，rate-limit SSOT 單獨 plan-gate）

**目標**：`functions/utils/rate-limit.ts` **3 個 noImplicitAny error → 0**，純 type-only（1 檔 3 編輯點 +3/−3；零 runtime 限流行為改動、零其他檔）。3 個 error 全為同一型：3 個 `db` 參數 implicit-any（TS7006）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。…→ `crypto.ts`（PR-2w `6ffc69e`）→ `siwe.ts`（PR-2x `592a8b2`）→ `scopes.ts`（PR-2y `01a42a2`）；本 PR = 第 10 棒 `utils/rate-limit.ts`（chain 最小一棒），再續 middleware 群〔4 檔 18〕與 cors.ts（security-boundary 單獨 PR，~20 caller）最後。

base main `6c548006`（branch fork point）。chain 前棒 scopes `01a42a2`〔PR #64〕後，main 經**約 29 個 PR（#65–93）平行推進** — JS→TS chain 與安全審計（SEC-FACTOR-ADD / credential-reverification / elevation / webauthn / ecpay-failopen 等）並行，rate-limit 棒延後至此；末段 #89–93 為 content-hash asset-versioning + docs。故本 PR base = 現行 main `6c548006`，baseline 已於該 SHA 實測（見 §預期 ratchet），**勿**沿用 scopes 收尾 memory 的舊快照數字。

> **Gate 紀錄（Dual Gate Workflow v3）**：當前 state = **`CHATGPT_ARCH_APPROVED`**（待 Codex Plan Gate；**尚未授權 coding**）。
> - 2026-06-16 owner 當輪明示「開第 10 棒 rate-limit.ts」= **SPEC_APPROVED**（沿用 chain 既定 spec 模板：scope = 本檔 noImplicitAny 清零、純 type-only reduce PR；Non-goals = 不碰 caller / tests / config / runtime 行為、不顯式標 return、不動 `RateLimitKind` union 或 `familyRevokeCapKind`；同輪預授權 A1 spike + plan doc 落檔 commit feature branch）。
> - 2026-06-16 **A1 spike 已執行並全項達標**（見 §Spike 實證；主方案單輪零修正），working tree 已 revert clean。
> - 2026-06-16 Claude plan 自審到零（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式 3 輪：R1 補凍結 diff 尾端 context + 校正 baseline drift 歸因〔#65–93 ~29 PR〕+ 驗 tests-leaf noImplicitAny:false；R2 修「無 TS7006 殘餘」矛盾措辭 + strict-rung 段不過度宣稱 debt + OD-1 補註；R3 零新發現）。
> - **級別研判 = L1**（純 type annotation、3 個同型 `db` 標註、TS erase 後 0 runtime、無新 import / alias / global / cast、無契約或架構變更）。L1 仍走**完整 3 道基本外部審查**（ChatGPT Arch + Codex Plan + Codex Code）；L1 不產生 `CHATGPT_CODE_FAITHFULNESS_APPROVED` state、self-review 用單 agent 對抗式（非 workflow）。
> - 2026-06-16 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`（@ plan commit `9361d4bb`）** — **0 Blocking finding**。裁示：① **L1 認可**（但但書 = 因本檔為 rate-limit SSOT，**Code Gate 必須用 L3 熱區檢查法複核 TS erase 後 runtime 不變**；觸發升級條件 = coding 階段一旦碰 SQL / limit 規則 / key format / 錯誤處理 / caller / test expectation → 即刻升 L3 退回重審）；② **OD-1 採主方案 inline `db: Env['chiyigo_db']` ×3**（alias defensible 但不採；不為風格一致性改已驗證 frozen diff）；③ Approved Scope 鎖定 = 僅 `functions/utils/rate-limit.ts` 的 3 個 `db` 參數標註，禁改 SQL / kind union / limit·計數邏輯 / 錯誤處理 / caller / test / config / migration；④ coding 後須重跑完整 gates（ratchet / sort-diff / `tsc -b tsconfig.tests.json --force` / eslint rate-limit / rate-limit integration 14/14 / **全量 `npm run lint`** / **`build:functions`**）。owner 裁示：可 push branch（限 plan commit `9361d4bb`，Codex Plan Gate 前禁新增 source commit）。
> - Codex Plan Gate：待 owner 送（外部 gate，Claude 不自跑；Codex 輪不回送 ChatGPT，若 Codex 對已 approve 架構決策〔OD-1〕有異議 → 回報 owner 裁定）。

## ⚠ auth-flow 熱區敏感聲明（最高優先紀律）

`rate-limit.ts` = **全站限流 / 暴力破解 · 憑證填充 · ceremony-DoS 防護 SSOT**：以 `login_attempts` 表為單一計數來源，`checkRateLimit` 的 `blocked` 判斷直接決定 login / 2fa / oauth(init·token·authorize) / refresh(含 family-revoke audit cap) / webauthn / elevation(5 面) / credential-reverification / email-send 等敏感端點是否回 429。**修法若非純型別、或會牽動 SQL 語句字面值 / `where`·`binds` 組裝邏輯 / `count >= max` 判斷 / `RateLimitKind` union 內容 / `familyRevokeCapKind` 產出 / INSERT·DELETE 欄位 → 立刻停手回 `PLAN_DRAFT`。** TS erase 後 runtime 行為必須不變（SQL 字串 / 計數邏輯 / kind union / 既有註解與 JSDoc byte-identical）。

**Coding 階段硬性邊界**：
- 允許：**3 個 `db` 參數型別標註**（`checkRateLimit` L83 / `recordRateLimit` L103 / `clearRateLimit` L117，全部 `db,` → `db: Env['chiyigo_db'],`）。
- 禁止：改任何 SQL 字串 / `where`·`binds` 組裝 / `count >= max` 判斷 / `RateLimitKind` union（含 `refresh_family_revoke:${string}` template literal 成員）/ `familyRevokeCapKind` / `RateLimitScope`·`RateLimitCheckOpts` interface / 既有註解與 JSDoc、改 caller、改 tests、改 tsconfig / eslint / vitest、新增 any、新增 suppression、新增 import、新增 type alias、新增 runtime guard 或判斷分支、**顯式標任何 return**（3 個函式 return 已 typed：`Promise<{ blocked: boolean, count: number }>` / `Promise<void>` ×2 — 不動）。

## Scout（對抗式驗證）

### exact errors（forced tsc @ `6c548006`，total 898）

恰 **3** 個，全 **TS7006**（`Parameter 'db' implicitly has an 'any' type`）：
- `functions/utils/rate-limit.ts(83,3)` — `checkRateLimit` 的 `db`
- `functions/utils/rate-limit.ts(103,3)` — `recordRateLimit` 的 `db`
- `functions/utils/rate-limit.ts(117,3)` — `clearRateLimit` 的 `db`

除此 3 個 TS7006 外無其他 error（無 TS7053 / TS7031，亦無其他 implicit-any 殘餘）。**本檔無 `env` 參數**（3 函式皆收 `db` binding 本身，非 env object → [[feedback_util_env_param_pick_not_full_env]] 的 `Pick<Env>` 規則不適用，已掃）。`familyRevokeCapKind`（L60）已完整 typed（`sessionIdHmac: string` → `RateLimitKind`），非 error、不動。

### 依賴邊界（caller 契約逐一驗證）

- **流入型別 = `db` binding 本身（非 env object）**：3 函式內部直接 `db.prepare(...).bind(...).first()/.run()`，`db` 是 D1 binding；故正解 = binding 型別 `Env['chiyigo_db']`（= `D1Database`），**不是** `Pick<Env,'chiyigo_db'>`（那是 `{ chiyigo_db: … }` env 物件 view，與本檔流入面不符）。
- **caller 面 = 42 個 production 檔**（grep `checkRateLimit|recordRateLimit|clearRateLimit` 命中 43 檔，扣本檔 = 42）：抽樣 `login.ts:74-75` / `refresh.ts:160-273`（含 `capKind` family-revoke）/ `2fa/verify.ts:66-139` 全部形態 = `checkRateLimit(db, {...})` / `recordRateLimit(db, {...})` / `clearRateLimit(db, {...})`，`db` 為 caller 本地變數，源頭 = `context.env.chiyigo_db`（`env: Env` → `Env['chiyigo_db']` = `D1Database`）。對 `db: Env['chiyigo_db']` 全 **exactly assignable**；少數 any-laden context 的 `db`（D1 解 any，[[feedback_d1database_resolves_any_no_workers_types]]）對 `D1Database`（本 repo 未裝 `@cloudflare/workers-types` → 解為 `any`）雙向 assignable。
- **D1Database 解析校正（[[feedback_d1database_resolves_any_no_workers_types]]）**：`tsconfig.functions.json` `types:[@cloudflare/vitest-pool-workers]`（無 workers-types）→ `Env['chiyigo_db']` = `D1Database` 實解為 `any`。故本標註 = **顯式 `any`-via-indexed-access**：消 TS7006（顯式型別非 implicit any）、不觸 ratchet 的 ban-`:any`（規則 C 禁字面 `:any` / JSDoc `{any}` / suppression，indexed-access 型別表達式不在禁列、且 PR-2u 已 blessed）、未來裝 workers-types 後自動升級成真 `D1Database`（SSOT-faithful）。
- **test caller**：直接 integration `tests/integration/rate-limit.test.ts`（7 例）+ `rate-limit-e3.test.ts`（7 例）走 `import { env } from 'cloudflare:test'`（`ProvidedEnv extends Env` → `env.chiyigo_db` 同 `Env['chiyigo_db']`）→ assignable；tests-leaf `noImplicitAny` 未開（Stage 7 僅開 functions leaf）→ 3 函式在 tests-leaf 本無 error、標註後仍 0（forced exit 0 實證）。
- **與 F-3 / audit retention / R2 lock 零重疊**；無新 global 名稱（`Env` 已是既有 ambient global，prior PR-2u/2v/2x 已用 + eslint globals 已註冊）→ [[feedback_new_global_type_needs_eslint_globals]] 不觸發（spike 已併跑 eslint exit 0 防漏）。

### 型別選型（chain 既定 pattern；inline `Env['chiyigo_db']`）

**3 個 `db` 參數統一標 `db: Env['chiyigo_db']`**（indexed-access，inline）：
- SSOT-faithful — `Env['chiyigo_db']` 直接索引 `types/env.d.ts` 的 binding 宣告（`chiyigo_db: D1Database`），binding 型別演進自動跟隨。
- 全 codebase 既定 db-binding 型別表達式：8 個 util/infra 檔以 `type ChiyigoDb = Env['chiyigo_db']` 定義同款 indexed-access（tenant-context / billing / credit / members / invitations / session-revoke / domain-event-emit / cron/event-outbox）；PR-2u `respondWithToken(db: Env['chiyigo_db'])` 為 inline 直用前例（chain note 明列）。
- `Env` 為 ambient global（`types/env.d.ts` `declare global { interface Env }`）→ functions leaf 免 import（符合 chain「不新增 import」紀律）。

### Open Decisions（prose 裁決，[[feedback_gate1_forks_prose_ruling]]）

- **OD-1：inline `Env['chiyigo_db']` ×3（主方案）vs 本檔 `type ChiyigoDb = Env['chiyigo_db']` 局部 alias + `db: ChiyigoDb` ×3。**（純宣告風格分叉 — 二者解析為同型、皆純 type-only、皆零 cascade；**不改本 PR L1 級別**，僅請 Arch 裁 codebase 一致性偏好。）
  - **主方案（inline，建議）**：chain note 明列前例（PR-2u inline）；最小 diff（3 行標註、0 新宣告）；hot-zone first-do-no-harm（更少新 token = 更小 review 面）；`Env['chiyigo_db']` 本身已自我說明。**已 spike 實證零 cascade（見 §Spike 實證）。**
  - **alias 變體（defensible）**：對齊 8 個 util/infra 檔的 `ChiyigoDb` 主流慣例（Tier 1 §架構一致性）；命中 §抽象判斷「≥3 處實際重複 → 可抽象」（本檔恰 3 個 db 標註）；代價 = +1 宣告行 + why-comment。
  - **型別等價保證**：`type ChiyigoDb = Env['chiyigo_db']` 為 TS 透明 alias（非 nominal）→ `db: ChiyigoDb` 與 `db: Env['chiyigo_db']` **解析為同一型別**，cascade / emit 行為 byte-identical；兩者差異純為宣告風格，故 alias 變體**無需另跑 spike**（語言層 alias 透明性保證，非 runtime 語意斷言）。
  - **✅ 裁決（2026-06-16 ChatGPT Architecture Gate @ `9361d4bb`）：採 inline 主方案 `db: Env['chiyigo_db']` ×3**，不採 alias。理由：本次優先序「安全熱區最小變更 > 凍結 diff 可重放 > TS erase runtime 零差 > Stage 7 reduce 範圍極窄」高於風格一致性；alias defensible 但 +1 宣告行收益不足、不為一致性改已 spike 全綠的 frozen diff。**OD-1 已關閉，inline 為唯一允許落地版。**

**考慮過、否決**：
- **`db: Pick<Env, 'chiyigo_db'>`**：型別為 `{ chiyigo_db: D1Database }`（env 物件 view），但 3 函式收的是 binding 本身（`db.prepare(...)`）非物件 → 標 Pick 會讓 `db.prepare` 變 property-not-exist（TS2339）、且 caller 傳 `env.chiyigo_db` 變 not-assignable。流入面不符，否決。
- **`db: D1Database`（直接引全域型別）**：可編譯（D1Database 為全域）但非 SSOT-faithful（不跟隨 env.d.ts binding 宣告演進）；chain 與 8-file 慣例均走 `Env['chiyigo_db']` indexed-access，consistency 勝，否決。
- **顯式標 return / 動 `RateLimitScope`·`RateLimitCheckOpts` interface**：無 error 驅動（3 函式 return 已 typed、2 interface 已 typed）；chain 紀律「無 error 驅動項不動」，否決。

## Spike 實證（A1，2026-06-16，已 revert）

**程序**：套 3 標註（`db,` → `db: Env['chiyigo_db'],` ×3）→ `rm -rf .tscache` → `tsc -b tsconfig.solution.json --force` → sort-diff（error TS 行）→ `tsc -b tsconfig.tests.json --force` → canonical `typecheck:ratchet --report` → targeted integration → 單檔 eslint → revert → 驗 clean。（tsc 一律走 `node ./node_modules/typescript/bin/tsc`；`npx tsc` 在本機誤解析到 npm `tsc` 冒牌包 → 必用 local bin。本機 `node_modules` 初始為空、已 `npm ci` 鋪 384 pkg。）

**主方案單輪達標（零修正輪）**：

| 驗收條件 | 結果 |
|---|---|
| `rate-limit.ts` errors 3 → 0 | ✅ forced tsc 0 殘留 |
| total errorCount 898 → 895（恰 −3） | ✅ forced tsc `grep -c 'error TS'` 895 + canonical `--report` errorCount 895 |
| errorFiles 105 → 104 / cleanFiles 229 → 230 | ✅ `--report` 實測（sourceFilesTotal 334 不變） |
| zero cascade（全 solution graph，含 42 caller + tests + browser leaf） | ✅ sort-diff（error TS 行）：移除 **3 行**（rate-limit.ts (83,3)/(103,3)/(117,3) 三 TS7006）、**新增 0 行**；`tsc -b tsconfig.tests.json --force` **exit 0 / 0 error TS** |
| targeted test runtime 不變 | ✅ `npm run test:int -- rate-limit`（workers config）**14/14 passed**（`rate-limit.test.ts` 7 + `rate-limit-e3.test.ts` 7：record/check/clear 累計與重置、2FA 連錯 5→6th 429、正確 OTP 清 kind=2fa、鎖定後仍 429 不可繞、login↔2fa kind 隔離回歸、oauth init 11th 429、refresh 30/user/min + per-user 隔離） |
| lint | ✅ `eslint functions/utils/rate-limit.ts` exit 0（`Env` 既有 global、無 no-undef） |
| diff 面 | ✅ `git diff --stat`：rate-limit.ts +3/−3，**僅 1 檔** |
| working tree revert clean | ✅ revert 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（untracked scratch，與本 PR 無關）、HEAD `6c548006`（本 doc 凍結 diff 為 SoT） |

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，3 編輯點，1 檔 +3/−3；OD-1 採 inline 主方案）**：

```diff
diff --git a/functions/utils/rate-limit.ts b/functions/utils/rate-limit.ts
@@ -80,7 +80,7 @@ interface RateLimitCheckOpts extends RateLimitScope {
  * windowSeconds: 計數視窗（秒）；max: 上限（含），超過 → 拒絕
  */
 export async function checkRateLimit(
-  db,
+  db: Env['chiyigo_db'],
   { kind, ip = null, userId = null, email = null, windowSeconds, max }: RateLimitCheckOpts,
 ): Promise<{ blocked: boolean, count: number }> {
   const where = ['kind = ?', `created_at > datetime('now', ?)`]
@@ -100,7 +100,7 @@ export async function checkRateLimit(

 /** 寫入一筆失敗記錄（kind 區分用途）。 */
 export async function recordRateLimit(
-  db,
+  db: Env['chiyigo_db'],
   { kind, ip = null, userId = null, email = null }: RateLimitScope,
 ): Promise<void> {
   await db
@@ -114,7 +114,7 @@ export async function recordRateLimit(

 /** 清除指定 user 在指定 kind 的所有記錄（成功事件後呼叫）。 */
 export async function clearRateLimit(
-  db,
+  db: Env['chiyigo_db'],
   { kind, userId = null, email = null }: { kind: RateLimitKind, userId?: number | null, email?: string | null },
 ): Promise<void> {
   if (userId) {
```

（`RateLimitKind` union、`familyRevokeCapKind`、`RateLimitScope`·`RateLimitCheckOpts` interface、所有 SQL 字串、`where`·`binds` 組裝、`count >= max` 判斷、既有註解與 JSDoc **byte-identical**；新增 = 3 個參數型別標註；TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `6c548006` `--report` 現況：errorCount **898** / errorFiles **105** / cleanFiles **229** / sourceFilesTotal 334。
  - （注：chain 前棒 scopes 收尾 memory 記 `902/106/198`，係 `01a42a2` 當時快照；main 經 #65–93〔~29 PR：安全審計功能 + asset-versioning〕推進後本 PR base 實測為 898/105/229，sourceFilesTotal 304→334〔+30；含 27 個新 .ts/.js source，git name-status 實測：webauthn / elevation / credential-reverification 等 test+impl〕。以本 SHA 實測為準，[[feedback_ratchet_current_vs_baseline_file]]。）
- 本 PR 後 current state：errorCount **898 → 895**（−3）、errorFiles **105 → 104**、cleanFiles **229 → 230**（spike 實測值）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 3 個參數型別標註，TS erase 後 runtime 行為不變（emit 由 esbuild type-strip，無型別參與）；rate-limit + rate-limit-e3 integration 14/14 已在標註狀態實跑（含 429 邊界、kind 隔離、per-user 隔離、family-revoke cap）。
- rollback：單一 squash revert 即完整回退（無 ambient 變更、無 migration、無 deploy 行為差）；revert 後 ratchet 自然回 898。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（tests-leaf forced exit 0 實證）。
- 14 例直接覆蓋（2 檔，workers config）：`rate-limit.test.ts` 7（util 累計/重置 + 2FA 限流矩陣 + login/2fa kind 隔離 + oauth init）+ `rate-limit-e3.test.ts` 7（refresh 30/user/min + per-user 隔離）。
- 間接覆蓋（不宣稱為 direct）：42 個 caller 端的限流呼叫走 CI 全量 integration（login / oauth / webauthn / elevation / credential-reverify / email-send 等 suite）。
- **未覆蓋、不宣稱**：`elevation_*` 5 面 kind、`oauth_authorize` / `webauthn` ceremony cap、`credential_disposition_run`、`member_invite`·`member_mutate`·`event_replay`·`billing_*`·`admin_read`·`org_switch` 等 kind 無直接 unit（僅經各自端點 integration 間接）；本 PR 不動該邏輯。
- **strict-rung 邊界（不在本 PR scope）**：本檔 body 自身已 null-safe（`checkRateLimit` 的 `row?.cnt ?? 0` 用 `?.`/`??` 接 `.first()` 的 nullable 回傳）；未來 functions leaf 開 `strict:true` 若 `Env['chiyigo_db']` 升為真 `D1Database`（`.first()` 回 `T|null`），既有寫法預期**零本檔新 strictNull 債**。caller 端 nullable 流入各自結算。與本 noImplicitAny 棒無關，登記供 strict 棒對帳。

## 驗證計劃（coding 階段，CODING_ALLOWED 後）

> 本 PR 無 ambient .d.ts 變更；惟沿 chain SOP 所有 tsc/ratchet 量測一律 `rm -rf .tscache` 全重建。PowerShell 用 `$env:RATCHET_BASE_REF='6c548006'`（commit 前 local-verify；或 commit 後 plain ratchet base 自動 = origin/main，[[feedback_ts_ratchet_discipline]] reduce-PR local-verify 陷阱）。**不帶** `RATCHET_ALLOW_BASELINE_RAISE`（本 PR 為 error-reducing reduce PR、走正常 ratchet 下降；非 Stage 7 open-strict override PR，無需 governance workflow）。

- `$env:RATCHET_BASE_REF='6c548006'; npm run typecheck:ratchet` green（898→895 / 105→104 / 229→230）。
- `npm run lint` green（全量 `eslint functions tests` + compat-date + workflows）、`npm run build:functions` green（type-only、esbuild type-strip，bundle 無型別殘留）。
- filtered forced tsc：rate-limit.ts 0 殘留、sort-diff 重放（移除 3 行、零新增）；`tsc -b tsconfig.tests.json --force` exit 0。
- targeted test：`npm run test:int -- rate-limit`（14 例，workers config — 注意**不是** unit lane 默認 config）。
- baseline file 不得 `--update`（天花板 1119/175 保持）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（1 檔，不得多檔；OD-1 採 inline → `db: Env['chiyigo_db']` ×3 即凍結版；若 Arch 改裁 alias 變體則以該裁決為新凍結基準）；超出 = scope creep = Gate fail。
- **Arch Gate approved-scope 對帳基準（`CHATGPT_ARCH_APPROVED` 附帶，Codex / code stage 逐項複核）**：
  1. 3 errors → 0（不多不少；ratchet 898→895）
  2. type-only（TS erase 後 runtime 行為不變、SQL 字串與 kind union byte-identical）
  3. 僅 1 個 production 檔（`functions/utils/rate-limit.ts`，無 ambient / config / tests 改動）
  4. OD-1 裁決落實（inline `Env['chiyigo_db']` 或 Arch 改裁的 alias 變體；二擇一、全檔一致）
  5. 全檔無 `:any` 字面 / 無 suppression / 無新 import / 無新 runtime 分支
- merge 後 smoke：限流端點全需請求脈絡，credential-free smoke = home / login 200（chain 預設）；限流矩陣以 14 例 integration + CI 全量為準。

## 流程定位

- Dual Gate Workflow v3：`SPEC_APPROVED`（owner 開棒訊息）✅ → A1 spike（已執行）✅ → `PLAN_SELF_REVIEW_CLEAN`（單 agent 對抗式，L1）✅ → 本 doc commit feature branch（`9361d4bb`）✅ → **`CHATGPT_ARCH_APPROVED`**（OD-1 裁 inline）✅ → **Codex Plan Gate**〔← 當前〕→ `CODING_ALLOWED` → coding（凍結 diff 逐行重放）→ 實跑 gates → 自審 → **Codex Code Gate（Arch 但書：用 L3 熱區檢查法複核 TS erase 後 runtime byte-faithful）** → owner 明示點頭 → squash-merge（L1：不走 ChatGPT faithfulness 複核，不產生該 state）。
- merge 後監看 CI+Deploy（jwt.test flake 就 rerun）；memory 收尾 receipt。
- **下一刀（owner 排序，開工前再確認）**：middleware 群〔4 檔 18：`functions/api/_middleware.ts`(9) + `api/admin/_middleware.ts`(3) + `api/ai/_middleware.ts`(3) + `api/auth/_middleware.ts`(3)，blast radius 最大、最後〕→ cors.ts（security-boundary 單獨 PR，~20 caller）。functions noImplicitAny 清零後開 `strict:true`（~140 strictNull/catch）。
