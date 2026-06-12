# Stage 7 reduce PR-2y — utils/scopes noImplicitAny（auth-core chain 第 9 棒，RBAC scope SSOT 單獨 plan-gate）

**目標**：`functions/utils/scopes.ts` **14 個 noImplicitAny error → 0**，純 type-only（1 檔 13 編輯點 +22/−12；零 runtime token 改動、零其他檔）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。…→ `jwt.ts`（PR-2v `71402db`）→ `crypto.ts`（PR-2w `6ffc69e`）→ `siwe.ts`（PR-2x `592a8b2`）；本 PR = 第 9 棒 `utils/scopes.ts`，再續 rate-limit（3），middleware 群〔4 檔 18〕與 cors.ts 最後。

base main `592a8b2`（接 PR-2x）。

> **Gate 紀錄（Dual Gate Workflow）**：
> - 2026-06-12 owner 當輪明示開第 9 棒 scopes.ts = **SPEC_APPROVED**（沿用 chain 既定 spec 模板：scope = 本檔 noImplicitAny 清零、純 type-only reduce PR；Non-goals = 不碰 caller / tests / config / runtime 行為、不顯式標 return；同輪預授權 A1 spike + plan doc 落檔 commit feature branch）。
> - 2026-06-12 **A1 spike 已執行並全項達標**（見 §Spike 實證；主方案＋OD-1 變體兩輪量測皆零修正），working tree 已 revert clean。
> - 2026-06-12 Claude plan 自審到零 blocker（`PLAN_SELF_REVIEW_CLEAN`，4 輪：r2 修 caller 檔數 19・補 strict-rung L39；r3 補 standalone probe 實證否決案、修正機制歸因為 weak-type 檢查）。
> - 2026-06-12 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`（@ `1411b38`）** — **0 Blocking finding**。Approved scope（Codex 對帳基準）：① 14 errors → 0；② type-only；③ 僅 1 個 production 檔；④ **OD-1 採納**（`new Set<string>()` 入凍結 diff = 主方案）；⑤ **唯一允許 cast = `ROLE_BASE_SCOPES[role as string] ?? []`**。Non-blocking debts（確認登記、不擋本 PR）：(a) `hasExactScopeInToken` 無直接 unit 覆蓋；(b) strict-rung nullable 流入維持 SNC 已知債（見 §測試影響面）。
> - Codex Plan Gate：待送（Codex 輪不回送 ChatGPT；若 Codex 對已 approve 架構決策有異議 → 回報 owner 裁定）。

## ⚠ auth-flow 熱區敏感聲明（最高優先紀律）

`scopes.ts` = **RBAC scope SSOT**：全站 admin 權限判斷核心 — `SCOPES` catalog 被 ~30 檔 import；`SCOPE_HIERARCHY` coarse→fine 展開決定「外洩 read-only token 不能退款」的 blast-radius 邊界；`ROLE_BASE_SCOPES` 決定 finance/support 禁升權；`hasExactScopeInToken` 是 step-up 嚴格檢查（elevated:* 絕不走 role fallback）的唯一實作。**修法若非純型別、或會牽動 scope 字串字面值 / SCOPES・KNOWN_ELEVATED_SCOPES・SCOPE_HIERARCHY・ROLE_BASE_SCOPES 任何清單內容 / 判斷邏輯與 fallback 分支 / caller / tests → 立刻停手回 `PLAN_DRAFT`。** TS erase 後 runtime 行為必須不變（scope 字串 / 清單 / 判斷式 / 既有註解與 JSDoc byte-identical）。

**Coding 階段硬性邊界**：
- 允許：13 個 scopes.ts 編輯點（2 個 const 宣告型別標註〔含 1 個 2 行 why-comment〕＋8 個函式 signature 參數標註＋1 個 index-access cast〔含 2 行 why-comment〕＋1 個 alias 區塊〔1 type alias + 4 行 why-comment，模組私有不外拋，PR-2v/2x 前例〕＋1 個 `new Set()` type-arg〔§OD-1，檔內 L133 `new Set<string>` 既有慣例〕）
- 禁止：改任何 scope 字串 / 四張清單內容 / 判斷邏輯・fallback 分支 / throw・error 字串 / 既有註解與 JSDoc、改 caller、改 tests、改 tsconfig / eslint / vitest、新增 any、新增 suppression、新增 import、新增 runtime guard 或判斷分支、**顯式標任何 return**（return 推斷由函式體決定 — 零 drift 以實證為據：spike sort-diff 全圖零新增行 + tests-leaf forced exit 0）

## Scout（對抗式驗證）

### exact errors（forced tsc @ `592a8b2`，total 916）

恰 **14** 個：**TS7006 ×12**（L123 `set`、L143 `s`、L207 `role`、L220 `role`、L235 `payload`、L245 `payload`+`scope`、L249 `payload`+`scopes`、L251 callback `s`、L261 `payload`+`scope`）+ **TS7053 ×2**（L126 `SCOPE_HIERARCHY[coarse]`：`string` 索引 `Readonly<{…7 個 literal key…}>`；L208 `ROLE_BASE_SCOPES[role]`：**`any`** 索引 9-key precise literal map — 即「光標 `role: string` 不消 L208、反轉成 string-index 同款 7053」，宣告處必須一併處理）。

oidcScope（L220 default `''` 推斷 string）非 error、不動（無 error 驅動項否決，PR-2x 前例）。**本檔無 env 參數**（[[feedback_util_env_param_pick_not_full_env]] Pick 規則不適用，已掃）。

### 依賴邊界（caller 契約逐一驗證）

- **🔑 決定性 probe — requireAuth user 今天就是 jose `JWTPayload`，不是 any**：`verifyJwt`（jwt.ts:180-181，PR-2v 後）回 `jwtVerify` 解構的 `payload` → 推斷 `JWTPayload`；auth.ts `requireAuth` 把它原樣放進 `{ user: payload }`。故 auth.ts 對本檔 4 個 payload 函式的呼叫（`hasAllScopes` L137 / `effectiveScopesFromJwt` L138・L166 / `hasExactScopeInToken` L212）**當場做 assignability check**。`JWTPayload` 無顯式 `scope`/`role` props、靠 `[propName: string]: unknown` index signature 供值 → **payload 參數若標 `{ role?: string }` 類精確 shape，`unknown ⊄ string` 立即在 auth.ts 爆 TS2345**（非未來債，是當場炸）— 此 probe 鎖死選型 §3。
- **auth.ts 一檔集中消費 4 函式**：`hasAllScopes(user, requiredScopes)`（requiredScopes 已標 `string[]` rest param）、`effectiveScopesFromJwt(user)` 後只做 `eff.has(s: string)`（L144/167）、`isElevatedScope(requiredScope: string)`（L203）+ 作 callback `scope.split(/\s+/).filter(Boolean).some(isElevatedScope)`（L312，scope: string — `(s: unknown) => boolean` 參數逆變 ✓）、`hasExactScopeInToken(user, requiredScope: string)`（L212）。
- **effectiveScopesFromJwt 其餘 production caller 19 檔**（grep 實測，spec 預估 ~15 偏低：ban/unban、requisition-refund ×2、payments ×5、oauth-clients ×2、event-dlq replay、billing ×4、audit-archive retry ×2、audit/[id]）：消費形態全部 = `.has(SCOPES.X)`，user 來自 requireAuth / requireStepUp（同 JWTPayload 源）。
- **buildTokenScope production caller ×8**（login / register / refresh / oauth callback / token / bind-email / 2fa verify / webauthn login-verify）：全傳 D1 row `.role`（D1 解 any，[[feedback_d1database_resolves_any_no_workers_types]]）→ 對 `role: string` 全 assignable。
- **test caller**：直接 unit 僅 `tests/scopes.test.ts`（38 例）— 流入面含 `scopesForRole(undefined)`（L39）、`effectiveScopesFromJwt(null)`／`('string')`（L100-101 垃圾輸入 fallback 測例）、partial object literal `{ role: 'admin' }` 等 → **jose `JWTPayload` 裸標必破 L101（string 不 assignable to object type，SNC off 也一樣）**。另 `SCOPES` const import ×7 test 檔（不受 param 標註影響）、`buildTokenScope('admin'…)` ×4 integration 檔 — 全被 tests-leaf forced exit 0 覆蓋實證。
- **與 F-3 / audit retention / R2 lock 零重疊**；無新 global 名稱（模組私有 alias 非 `declare global`）→ [[feedback_new_global_type_needs_eslint_globals]] 不觸發（spike 已併跑 eslint 防漏）。

### 型別選型（chain 既定 pattern；Convention A inline）

1. **兩張 scope map 顯式標寬 view `Record<string, readonly string[]>`**（消 TS7053 ×2 的載體）：`SCOPE_HIERARCHY` 與 `ROLE_BASE_SCOPES` 的 runtime 契約本就是「任意 string key 查表、miss 走 fallback」（`'hacker'` 是測例、`Object.keys` 回 string[] 是 TS 設計）— 寬 view 誠實對齊；keyof precision 全 repo 零消費者。`readonly` 值型別 = 純 type-level 防護：`scopesForRole` 回傳的是表內 array 的**直接 reference**，readonly 讓未來 caller `push()` 污染 RBAC SSOT 直接編譯失敗（runtime 兩表值 array 本未 frozen，shallow freeze 不及）。
2. **`type ScopeClaims = Record<string, unknown>`（模組私有 alias）+ 4 個 payload 參數統一 `payload: ScopeClaims | string`**：untrusted JWT payload view — claim 名任意、值一律 unknown，本模組只讀 `scope`（typeof guard 窄化）/ `role`（lookup fallback 防禦）。index-signature 型 ① 可收 jose `JWTPayload`（probe 鎖定的實際流入型別）、② 結構性免疫 TS2559 weak-type（PR-2x OD-1 教訓 — 有 index signature 即非 weak type）、③ object literal 傳入零 excess-property 問題。`| string` = 垃圾輸入防禦面（tests L101 鎖「非物件 → 空 set / false」fallback）。
3. **`scopesForRole(role: unknown)` + 本 PR 唯一 cast `ROLE_BASE_SCOPES[role as string] ?? []`**：role 流入鏈 = `payload.role`（經 ScopeClaims 為 `unknown`）→ `scopesForRole` → 表 lookup。三角約束：unknown 不可作 index type（TS2538）、加 typeof guard = 動 runtime（spec 禁）、role 收窄成 string = auth.ts 當場炸（probe）。**`as string` 是 sound cast**：JS 物件索引本就把 key coerce 成 string、未知 key 由既有 `?? []` fallback 接住（deny by default）— cast 僅鏡像 runtime 語意，不是繞過檢查的謊言；附 2 行 why-comment。
4. **防禦性 validator 標 `unknown`**（chain 前例 `validatePassword(pw: unknown)` / roles.ts `isValidRole(role: unknown)`）：`isElevatedScope(s: unknown)`（typeof guard 既有）。
5. **`expandHierarchy(set: Set<string>)`**：內部函式、唯一 caller L242 傳 `new Set([...string[], ...string[]])` ✓。
6. **`buildTokenScope(role: string, …)`**：簽發端 — role 來自 DB `users.role`（受信欄位），string 是誠實契約；8 個 production caller 全 any-laden、tests 傳 string literal ✓。
7. **`scope: string` / `scopes: string[]`**（hasScope / hasExactScopeInToken / hasAllScopes 第二參）：resource server 守門值、caller 全傳 `SCOPES.X` literal 或已標 `string[]` 的 rest param；`scopes: string[]` 同時讓 L251 callback `s` 取得 contextual type（1 標註連動消 2 errors，[[feedback_ts_any_chain_breaks_contextual_typing]] 正向應用）。

**考慮過、否決**：
- **jose `JWTPayload` 裸標 payload**（jwt.ts PR-2v 同款）：tests L101 `effectiveScopesFromJwt('string')` TS2345 必破（string ⊄ object，SNC off 不救）；且 scopes.ts 是純 scope 計算 util、不該為型別引入 jose 耦合與新 import（spec 禁新增 import）。
- **精確 shape `{ scope?: unknown; role?: string }`**：standalone probe 實證（見 §輔助 probe）— `JWTPayload` 傳入即 **TS2345 `has no properties in common`（weak-type 檢查）** → auth.ts 4 個呼叫點**當場炸**（非未來債）。probe 同時修正兩個推理盲點：含 `| string` 的 union **不**豁免 weak check、source 帶 index signature 也**不**豁免 — PR-2x TS2559 教訓直系重演，反向強化選型 §2（`Record<string, unknown>` 自帶 index signature = 非 weak、結構性免疫）。
- **`payload: unknown`**：guard 後 narrow 到 `object`，`payload.scope` access TS2339；修法只剩「加 cast 中介 `const claims = payload as …`」= erase 後新增 runtime 行（非 byte-identical）— 比 annotation-only 侵入大，否決。
- **keyof typeof 窄化路線**（L126 `Object.keys(...) as Array<keyof typeof SCOPE_HIERARCHY>` / L208 `role as keyof typeof ROLE_BASE_SCOPES`）：L208 的 keyof cast 把 `'hacker'`（合法 runtime 輸入）謊稱成已知 key = **unsound cast 進 Tier-0 RBAC 檔、會被人抄**；keyof precision 又零消費者。寬 view + 單一 sound cast 勝（cast ×1 vs ×2）。
- **為型別加 runtime guard / 判斷分支**（如 `typeof role === 'string'` 包 lookup）：spec 明禁，且改變 scopesForRole 對非 string 輸入的執行路徑形狀（行為等價但非 byte-identical）。
- 顯式 return 標註等無 error 驅動項（chain 紀律）。

### Open Decisions（prose 裁決，[[feedback_gate1_forks_prose_ruling]]）

- **OD-1 `new Set()` → `new Set<string>()`（L236 guard 分支 return）— ✅ 2026-06-12 Arch 裁決：採納**（凍結 diff 維持主方案含 type-arg）。原 prose：非 error 驅動，但屬**本 PR 標註後新產生的型別劣化收口** — base 下 `effectiveScopesFromJwt` return 推斷 any（caller 全吃 any）；標 payload 後兩個 return 分支推斷分裂成 `Set<unknown> | Set<string>` union。現有 caller 全 `.has()`（union 上可呼叫、兩變體 spike 皆零 cascade 實證），但 union 留給未來 iteration-site caller（`for…of` / spread 元素變 unknown）一個 latent footgun。type-arg 是 expression-level annotation（非 return 標註，不違「不標 return」紀律），檔內 L133 `new Set<string>([...])` 既有慣例。**兩變體皆已 spike 實證**（量測記錄見 §Spike 實證）。裁決已完成：**主方案含 type-arg 為唯一允許落地版**。

## Spike 實證（A1，2026-06-12，已 revert）

**程序**（×2 輪：主方案含 OD-1、變體不含 OD-1）：套標註 → 清 `.tscache` → `tsc -b tsconfig.solution.json --force` → sort-diff → `tsc -b tsconfig.tests.json --force` → 清 `.tscache` → canonical `typecheck:ratchet:report` → targeted unit → 單檔 eslint → revert → 驗 clean。

**主方案單輪達標（零修正輪）**：

| 驗收條件 | 結果 |
|---|---|
| `scopes.ts` errors 14 → 0 | ✅ filter 0 殘留 |
| total errorCount 916 → 902（恰 −14） | ✅ forced tsc 902 + canonical `--report` errorCount 902 |
| errorFiles 107 → 106 / cleanFiles 197 → 198 | ✅ `--report` 實測（sourceFilesTotal 304 不變） |
| zero cascade（全 solution graph，**含 auth.ts `user: JWTPayload` → 4 函式 assignability 實證**） | ✅ sort-diff：移除 **15 行 = 14 error 行 + 1 行 L126 TS7053 related-info 縮排行**（`No index signature…`，不帶檔名前綴 — PR-2x 帳目教訓同款；L208 的 TS7053 無附屬行）、**零新增行**；`tsc -b tsconfig.tests.json --force` exit 0（undefined / null / 'string' / partial literal 全流入面實證） |
| targeted test runtime 不變 | ✅ `npx vitest run tests/scopes.test.ts`（unit lane，默認 config）**38/38 passed**（標註套用狀態實跑：role mapping / hierarchy 展開 / finance・support 防升權 / elevated 白名單 / 垃圾輸入 fallback 全 deny path） |
| lint | ✅ `npx eslint functions/utils/scopes.ts` exit 0（全量 lint 列 code-stage gate） |
| diff 面 | ✅ `git diff --stat`：scopes.ts +22/−12，**僅 1 檔** |
| working tree revert clean | ✅ revert 後 `git status --porcelain` 空、HEAD `592a8b2`（本 doc 凍結 diff 為 SoT） |

**OD-1 變體（`new Set()` 不帶 type-arg，其餘 12 編輯點同）**：✅ total 902 / sort-diff 移除 15・新增 0 / tests-leaf forced exit 0 — 兩分支皆綠，OD-1 純屬 return 推斷品質差異。

**輔助 probe（standalone tsc，否決案證據；throwaway 檔已刪）**：`declare const u: JWTPayload` 分別傳入兩種參數型別 — `{ scope?: unknown; role?: string } | string` → **TS2345 `Type 'JWTPayload' has no properties in common with type 'Precise'`**（weak-type 檢查；`| string` union 與 source index signature 皆不豁免）；`Record<string, unknown> | string` → **exit 通過**。

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，13 編輯點，1 檔 +22/−12；OD-1 已採納 → 含 `new Set<string>()` 的主方案即凍結版）**：

```diff
--- functions/utils/scopes.ts
@@ L94
- const SCOPE_HIERARCHY = Object.freeze({
+ // 寬 view（string-keyed lookup table）：查詢鍵來自 untrusted claim / Object.keys，
+ // runtime 契約本就是「任意 key 查表、miss 走 fallback」；readonly 防止誤改 RBAC SSOT 內容。
+ const SCOPE_HIERARCHY: Record<string, readonly string[]> = Object.freeze({

@@ L123
- function expandHierarchy(set) {
+ function expandHierarchy(set: Set<string>) {

@@ L143
- export function isElevatedScope(s) {
+ export function isElevatedScope(s: unknown) {

@@ L164
- const ROLE_BASE_SCOPES = {
+ const ROLE_BASE_SCOPES: Record<string, readonly string[]> = {

@@ L207-209
- export function scopesForRole(role) {
-   return ROLE_BASE_SCOPES[role] ?? []
+ export function scopesForRole(role: unknown) {
+   // role 為 untrusted claim（可為任意 JSON 值）；JS 物件索引本就把 key coerce 成
+   // string，未知 key 由 ?? [] fallback 接住（deny by default），cast 僅鏡像此語意。
+   return ROLE_BASE_SCOPES[role as string] ?? []

@@ L220
- export function buildTokenScope(role, oidcScope = '') {
+ export function buildTokenScope(role: string, oidcScope = '') {

@@ L229（「── token scope 檢查」分隔註解後、effectiveScopesFromJwt JSDoc 前，新增 alias 區塊）
+ // untrusted JWT payload view：claim 名任意、值一律 unknown（本模組只讀 scope / role，
+ // 各自靠 typeof guard / lookup fallback 防禦）。index-signature 型可收 jose JWTPayload
+ // （requireAuth user 實際流入型別）且非 weak type；`| string` = 垃圾輸入防禦面
+ // （tests 鎖「非物件 → 空 set / false」fallback 行為）。模組私有，不外拋。
+ type ScopeClaims = Record<string, unknown>
+

@@ L235-236（第二行的 `new Set<string>()` type-arg = §OD-1 已採納項）
- export function effectiveScopesFromJwt(payload) {
-   if (!payload || typeof payload !== 'object') return new Set()
+ export function effectiveScopesFromJwt(payload: ScopeClaims | string) {
+   if (!payload || typeof payload !== 'object') return new Set<string>()

@@ L245
- export function hasScope(payload, scope) {
+ export function hasScope(payload: ScopeClaims | string, scope: string) {

@@ L249
- export function hasAllScopes(payload, scopes) {
+ export function hasAllScopes(payload: ScopeClaims | string, scopes: string[]) {

@@ L261
- export function hasExactScopeInToken(payload, scope) {
+ export function hasExactScopeInToken(payload: ScopeClaims | string, scope: string) {
```

（SCOPES catalog、KNOWN_ELEVATED_SCOPES、SCOPE_HIERARCHY / ROLE_BASE_SCOPES 清單內容、所有 scope 字串、判斷邏輯、fallback 分支、既有註解與 JSDoc **byte-identical**；新增 = 2 個宣告型別 + 8 個參數標註 + 1 cast + 1 type-arg + 1 alias + 8 行 why-comment + 1 空行；TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `592a8b2` `--report` 現況：errorCount **916** / errorFiles **107** / cleanFiles **197** / sourceFilesTotal 304。
- 本 PR 後 current state：errorCount **916 → 902**（−14）、errorFiles **107 → 106**、cleanFiles **197 → 198**（spike 實測值）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 參數/宣告型別標註 + 1 個模組私有 alias + 1 個鏡像 JS 索引語意的 cast + 1 個 Set type-arg，TS erase 後 runtime 行為不變；scopes unit 38/38 已在標註狀態實跑（含全部 deny path 與垃圾輸入 fallback）。
- rollback：單一 squash revert 即完整回退（無 ambient 變更、無 migration、無 deploy 行為差）；revert 後 ratchet 自然回 916。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（tests-leaf forced exit 0 實證）。
- 38 例直接覆蓋（1 檔）：`tests/scopes.test.ts` — scopesForRole 4 例（含 undefined / 未知 role）+ buildTokenScope 4 例（OIDC 合併去重）+ effectiveScopesFromJwt/hasScope/hasAllScopes 6 例（含 null / 'string' 垃圾輸入）+ P1-17 latent role 6 例（finance/support 防升權 negative）+ :approve fine 2 例 + hierarchy 展開 5 例 + audit_archive 6 例 + billing/elevated 5 例。
- 間接覆蓋（不宣稱為 direct）：auth.ts 守門鏈（requireScope / requireAnyScope / requireStepUp）走 CI 全量 integration（step-up.test / admin-payments.test / wallet.test 等 7 檔 import SCOPES 者）。
- **未覆蓋、不宣稱**：`hasExactScopeInToken` 無直接 unit（僅經 step-up integration 間接）；`moderator` role mapping 無測例（本 PR 不動該邏輯）。
- **strict-rung 已知債（不在本 PR scope）**：未來 tests leaf 開 strictNullChecks 時 tests L100 `effectiveScopesFromJwt(null)` 與 L39 `scopesForRole(undefined)` 將需顯式 nullable union 或測試端 cast — 與 jwt.ts PR-2v「strict-rung 反轉」同類，登記於此供 strict 棒對帳。

## 驗證計劃（coding 階段，CODING_ALLOWED 後）

> 本 PR 無 ambient .d.ts 變更；惟沿 chain SOP 所有 tsc/ratchet 量測一律清 `.tscache` 全重建。PowerShell 用 `$env:RATCHET_BASE_REF='592a8b2'`（commit 前 local-verify；或 commit 後 plain ratchet）。

- `$env:RATCHET_BASE_REF='592a8b2'; npm run typecheck:ratchet` green（916→902 / 107→106 / 197→198）。
- `npm run lint` green（全量）、`npm run build:functions` green。
- filtered forced tsc：scopes.ts 0 殘留、sort-diff 重放（移除 14+1 行、零新增）；`tsc -b tsconfig.tests.json --force` exit 0。
- targeted test：`npx vitest run tests/scopes.test.ts`（38 例，unit lane 默認 config — 注意**不是** workers config）。
- baseline file 不得 `--update`（天花板 1119/175 保持）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（1 檔，不得多檔；OD-1 已採納 → 主方案含 `new Set<string>()` 即凍結版）；超出 = scope creep = Gate fail。
- **Arch Gate approved-scope 對帳基準（`CHATGPT_ARCH_APPROVED` 附帶，Codex / code stage 逐項複核）**：
  1. 14 errors → 0（不多不少；ratchet 916→902）
  2. type-only（TS erase 後 runtime 行為不變、scope 字串與四張清單 byte-identical）
  3. 僅 1 個 production 檔（`functions/utils/scopes.ts`，無 ambient / config / tests 改動）
  4. OD-1 採納：`new Set<string>()` 在凍結 diff 內
  5. 唯一允許 cast：`ROLE_BASE_SCOPES[role as string] ?? []`（全檔不得出現第二個 `as`）
  6. Non-blocking debts 照登記不擴 scope：(a) `hasExactScopeInToken` 直接 unit 留 backlog；(b) strict-rung nullable 債留 strict 棒
- merge 後 smoke：scope 守門全需 auth → credential-free smoke = home / login 200（chain 預設）；RBAC 全鏈以 unit 38 例 + CI 全量 integration 為準。

## 流程定位

- Dual Gate Workflow：`SPEC_APPROVED`（owner 開棒訊息）→ `PLAN_SELF_REVIEW_CLEAN` → A1 spike（已執行）→ 本 doc commit feature branch → **ChatGPT Architecture Gate（裁 OD-1 + 審唯一 cast）** → **Codex Plan Gate** → `CODING_ALLOWED` → coding(凍結 diff 逐行重放) → 實跑 gates → 自審 → Codex Code Gate → owner 明示點頭 → squash-merge。
- merge 後監看 CI+Deploy（jwt.test flake 就 rerun）；memory 收尾 receipt。
- **下一刀（owner 排序，開工前再確認）**：rate-limit.ts（3：db param ×3〔L57/77/91〕→ `Env['chiyigo_db']` indexed-access，PR-2u respondWithToken 前例，預計 chain 最小一棒）→ middleware 群〔4 檔 18〕→ cors.ts（security-boundary 單獨 PR，~20 caller）。
