# Stage 7 reduce PR-2t — utils/risk-score noImplicitAny（auth-core chain 第 4 棒，security-adjacent 單獨 plan-gate）

**目標**：`functions/utils/risk-score.ts` **15 個 noImplicitAny error → 0**，**純 type-only**（8 個編輯點，全為型別標註）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。`password.ts`（PR-2q `4d6d075`）→ `role-change.ts`（PR-2r `b43770b`）→ `roles.ts`（PR-2s `7307c91`）；本 PR = 第 4 棒 `risk-score.ts`〔owner 既定 security-adjacent 單獨 plan-gate〕，再續 2fa/verify → _middleware〔最後、blast radius 最大〕。

base main `7307c91`（接 PR-2s）。

> **Gate 紀錄（Dual Gate Workflow）**：
> - 2026-06-11 Claude plan 自審到零 blocker（`PLAN_SELF_REVIEW_CLEAN`）。
> - 2026-06-11 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`（條件式）** — 條件 ①：先補 A1 spike 且結果必須「risk-score.ts 15→0、total 恰 −15、zero cascade、working tree revert clean」，不符則回 `PLAN_DRAFT`；條件 ②：spike 通過後 plan 落檔本 doc 並 commit，才進後續 gate。
> - 2026-06-11 **A1 spike 已執行並全項達標**（見 §Spike 實證），working tree 已 revert clean；本 doc 即條件 ② 的落檔。
> - 下一關：**Codex Plan Gate**（過了才 `CODING_ALLOWED`）。

## ⚠ security-adjacent 敏感聲明（最高優先紀律）

`risk-score.ts` = Phase E-2 risk-based authentication 評分模型，**score ≥ 70 會 deny 登入**（login / oauth callback / webauthn 三路共用）— Tier-0 鄰接。owner / gate 紀律：**修法若非純型別、或會牽動評分常數 / threshold（70/30）/ factor 字串 / fail-open catch 行為 / SQL / caller / tests / config → 立刻停手回 `PLAN_DRAFT`，不硬寫。** TS erase 後 runtime 必須 **byte-identical**。

**Coding 階段硬性邊界（ChatGPT Arch Gate 裁定原文）**：
- 允許：function parameter type annotation / inline object parameter type annotation / explicit Promise return type / `const factors: string[]` / callback parameter type annotation / local variable type annotation / catch-callback return annotation（spike 證實必要）
- 禁止：改 SQL、改 score 常數、改 threshold 70/30、改 factor string、改 fail-open catch 行為、改 caller、改 tests、改 tsconfig / eslint / vitest、新增 any、新增 suppression、新增 global、新增 package

## Scout（對抗式驗證）

### exact errors（forced tsc @ `7307c91`，total 1017）
```
functions/utils/risk-score.ts(44,30):  TS7006 ua          (60,40): TS7006 env
functions/utils/risk-score.ts(60,45):  TS7006 request     (60,56): TS7031 userId
functions/utils/risk-score.ts(60,64):  TS7031 email       (63,42): TS7011 catch-callback
functions/utils/risk-score.ts(67,9):   TS7034 factors     (70,21): TS7005 factors
functions/utils/risk-score.ts(83,49):  TS7006 r           (107,12): TS7006 r
functions/utils/risk-score.ts(108,15): TS7006 h           (111,29): TS7006 h
functions/utils/risk-score.ts(140,24): TS7018 factors:[]  (147,34): TS7006 score
functions/utils/risk-score.ts(151,30): TS7006 score
```
恰 15 個（baseline file `types/typecheck-baseline.json` 同記 `"functions/utils/risk-score.ts": 15`）。

### 依賴邊界
- **zero-dependency leaf util**：不 import 任何 repo 模組；env 只讀 `chiyigo_db`（D1 本 repo 解為 any → row 無 cascade）。
- **production caller 4 檔**：`local/login.ts:173`、`oauth/[provider]/callback.ts:259`、`webauthn/login-verify.ts:167`（三路傳 env/request/userId 皆 any → assignable）；`2fa/verify.ts:173` 只用 `hashUa`（傳 string ✓）。
- **caller 回傳讀取面（grep `risk\.\w+` 實證）**：只讀 `score / factors / country / ua_hash` 四欄，三個 return 分支全有 → 回傳型別化零 TS2339。`error`（僅 catch 分支）/ `hour_utc` 無人讀。
- **test**：`tests/integration/risk-score.test.ts`（11 例 = 8 直測 + 3 login 整合）。餵 `cloudflare:test` env（`ProvidedEnv extends Env`）+ 真 `new Request()`（`cf` 用 defineProperty 注入、靜態型別 `Request`）→ `Request` assignable `CfRequest`（`cf?` optional；PR-2o device-alerts in-repo 前例）。
- **與 F-3 / audit archive 零重疊**：不碰 F-3 四敏感檔；runtime 讀 audit_log 表是既有行為、非 archive pipeline。
- eslint globals 已含 `CfRequest: 'readonly'`（PR-2o 註冊）→ 零 config 改動。

### 型別選型（chain 既定 pattern）

1. **`hashUa(ua: string)`** — 全 caller 實傳 string；body `TextEncoder().encode(ua)` 要 string（`unknown` 需加 typeof 守衛 = 非最小 diff，否決）。
2. **`computeRiskScore(env: Env, request: CfRequest, { userId, email }: { userId: number | null; email: string | null })`** — 完整複製 PR-2o device-alerts 模板（`safeAlertAnomalies` 同構簽名）。`env: Env` 同 PR-2r（Pick 條件不成立：test 用完整 typed env）；`| null` 對齊 fail-open 守衛語意（`!userId` / `if (email)` 不動）。
3. **顯式回傳型別（inline）** `Promise<{ score: number; factors: string[]; country: string | null; ua_hash: string | null; hour_utc: number; error?: string }>` — (a) contextual typing 修 TS7018；(b) 三個 return 分支 union 正規化成單一 contract；(c) caller 穩定契約。
4. **`const factors: string[] = []`** — 修 TS7034 + TS7005。
5. **D1 row 路徑**：callback 參數 inline shape `(r: { event_data?: string; created_at?: string })` + `let data: Record<string, unknown> = {}`（自審 F-1：不標 data 會推 `{}` → spread 後缺 country/ua_hash → line 92/99 新 TS2339）+ **`const recentLogins: Array<Record<string, unknown> & { created_at_ms: number }>`**（spike r1 證實：`.map` on any 回 any、契約斷鏈 → 在 const 斷 any-chain，1 個標註解 3 個 TS7006，line 107/108/111 全走 contextual typing）。
6. **catch callback `(): null => null`**（spike r1 證實必要：strictNullChecks off 下 `() => null` 推 implicit any return → TS7011 不自動消；顯式 return annotation 是最小 type-only 補法）。
7. **`shouldDenyByRisk(score: number)` / `isRiskMedium(score: number)`** — caller 傳 `risk.score`（number）✓、test 傳字面值 ✓。

**考慮過、否決**：`hashUa(ua: unknown)`（需加 typeof 守衛改 body）；具名 exported return type（單一 consumer、Convention A inline 優先）；逐 callback 標 3 處（const 斷鏈 1 處更小且把 element 契約顯式化）。

## Spike 實證（A1，2026-06-11，已 revert）

**程序**：套標註 → 清 `.tscache` → `tsc -b tsconfig.solution.json --force` → canonical `--report` → `tsc -b tsconfig.tests.json --force` → targeted int test → 單檔 eslint → `git restore` → 驗 clean。

**Round 1**（plan 原 6 編輯點）：risk-score 殘留 **4**（= plan §7 R1/R2 預測點原樣命中：TS7011 未自動消 + line 107/108/111 contextual 因 any-chain 斷裂未生效）、total 1006 = 1017 − 11（**零新增 cascade**，殘留全屬原 15 個）。
**Round 2**（套 plan 既定 fallback：`(): null => null` + recentLogins const 標註）：

| 驗收條件（Arch Gate 裁定） | 結果 |
|---|---|
| `risk-score.ts` errors 15 → 0 | ✅ filter 0 殘留 |
| total errorCount 1017 → 1002（恰 −15） | ✅ forced tsc 1002 + canonical `--report` errorCount 1002 |
| errorFiles 112 → 111 / cleanFiles 192 → 193 | ✅ `--report` 實測 111 / 193（sourceFilesTotal 304 不變） |
| zero cascade（含 tests leaf） | ✅ `tsc -b tsconfig.tests.json --force` **exit 0**；total 恰 −15 數學證明其他檔全未變 |
| targeted test runtime 不變 | ✅ `npm run test:int -- tests/integration/risk-score.test.ts` **11/11 passed**（標註套用狀態實跑） |
| lint | ✅ `npx eslint functions/utils/risk-score.ts` exit 0（全量 lint 列 code-stage gate） |
| 無新增檔案 / 無 caller/test/config diff | ✅ `git diff` 僅 risk-score.ts 1 檔 |
| working tree revert clean | ✅ `git restore` 後 `git status --porcelain` 空、`git diff --stat` 空、HEAD `7307c91` |

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，8 編輯點）**：
```diff
-export async function hashUa(ua) {
+export async function hashUa(ua: string) {

-export async function computeRiskScore(env, request, { userId, email }) {
+export async function computeRiskScore(
+  env: Env,
+  request: CfRequest,
+  { userId, email }: { userId: number | null; email: string | null },
+): Promise<{
+  score: number
+  factors: string[]
+  country: string | null
+  ua_hash: string | null
+  hour_utc: number
+  error?: string
+}> {

-  const uaHash  = await hashUa(ua).catch(() => null)
+  const uaHash  = await hashUa(ua).catch((): null => null)

-  const factors = []
+  const factors: string[] = []

-    const recentLogins = (rs.results ?? []).map(r => {
-      let data = {}
+    const recentLogins: Array<Record<string, unknown> & { created_at_ms: number }> =
+      (rs.results ?? []).map((r: { event_data?: string; created_at?: string }) => {
+      let data: Record<string, unknown> = {}

-export function shouldDenyByRisk(score) {
+export function shouldDenyByRisk(score: number) {

-export function isRiskMedium(score) {
+export function isRiskMedium(score: number) {
```
（評分常數、threshold、factor 字串、SQL、fail-open catch、`_internal`、所有註解 **byte-identical**。）

## 預期 ratchet

- clean main `7307c91` `--report` 現況：errorCount **1017** / errorFiles **112** / cleanFiles **192** / sourceFilesTotal 304（spike 前實測）。
- 本 PR 後 current ratchet state：errorCount **1017 → 1002**（−15）、errorFiles **112 → 111**、cleanFiles **192 → 193**（spike 實測值，非預測）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 型別標註，TS erase 後 runtime byte-identical；targeted int test 11/11 已在標註狀態實跑證明。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 1017，零殘留。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（spike tests-leaf exit 0 實證）。
- 11 例實跑覆蓋：4 signal 個別+累加、首登 score=0、UA 相同不加分、test 環境無 cf.country、helper threshold 邊界、login 低/中/高分三分支（403 RISK_BLOCKED + critical audit + email）。
- **未覆蓋、不宣稱**：oauth callback 與 webauthn login-verify 的 risk 接點無直接測例（本 PR 不動該二檔）。

## 驗證計劃（coding 階段，CODING_ALLOWED 後）

> ⚠ ratchet/tsc 量測前清 `.tscache`（PowerShell `Remove-Item -Recurse -Force .tscache`）。**PowerShell 用 `$env:RATCHET_BASE_REF='7307c91'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='7307c91'; npm run typecheck:ratchet` green（1017→1002 / 112→111 / 192→193）。
- `npm run lint` green（全量）、`npm run build:functions` green。
- filtered forced tsc：risk-score.ts 0 殘留 + `tsc -b tsconfig.tests.json --force` exit 0。
- targeted test：`npm run test:int -- tests/integration/risk-score.test.ts`（11 例）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（人審 `git diff -- functions/utils/risk-score.ts`）；超出 = scope creep = Gate fail。

## 流程定位

- Dual Gate Workflow：`PLAN_SELF_REVIEW_CLEAN` → `CHATGPT_ARCH_APPROVED`（條件式，兩條件已清）→ 本 doc commit → **Codex Plan Gate**（迭代審到過）→ `CODING_ALLOWED` → coding → 實跑 gates → 自審 → Codex Code Gate → owner 明示同意才 squash-merge。
- merge 後監看 CI+Deploy（撞 `jwt.test` flake 就 rerun）；risk-score 無自身端點 → credential-free prod smoke 確認 deploy 健康即可。
- **下一刀（owner 排序）**：2fa/verify → _middleware〔最後、blast radius 最大〕。
