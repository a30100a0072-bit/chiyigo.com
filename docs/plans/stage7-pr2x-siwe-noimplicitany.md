# Stage 7 reduce PR-2x — utils/siwe noImplicitAny（auth-core chain 第 8 棒，SIWE 驗章/nonce 核銷 SSOT 單獨 plan-gate）

**目標**：`functions/utils/siwe.ts` **26 個 noImplicitAny error → 0**，純 type-only（siwe.ts 13 編輯點 +16/−12；外加 §OD-1 之 `types/env.d.ts` 2 行 optional keys +2/−0，合計 2 檔 +18/−12；零 runtime token 改動）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。…→ `2fa/verify.ts`（PR-2u `e71dda3`）→ `jwt.ts`（PR-2v `71402db`）→ `crypto.ts`（PR-2w `6ffc69e`）；本 PR = 第 8 棒 `utils/siwe.ts`，再續 scopes（14）/ rate-limit（3），middleware 群與 cors.ts 最後。

base main `6ffc69e`（接 PR-2w）。

> **Gate 紀錄（Dual Gate Workflow）**：
> - 2026-06-11 owner 當輪明示「開 PR-2x」= **SPEC_APPROVED**（沿用 chain 既定 spec 模板：scope = 本檔 noImplicitAny 清零、純 type-only reduce PR；Non-goals = 不碰 caller / tests / runtime 行為、不顯式標 return；§OD-1 的 env.d.ts 2 行為 plan 階段明示申報的 scope 裁決項，非靜默擴張）。
> - 2026-06-11 Claude plan 自審到零 blocker（`PLAN_SELF_REVIEW_CLEAN`）。
> - 2026-06-11 **A1 spike 已執行並全項達標**（見 §Spike 實證；單輪零修正），working tree 已 revert clean。
> - 2026-06-11 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`（@ `33dc29d`）** — 0 Blocker / 0 Required Change / 2 Non-blocking Note；**OD-1 採納**（Env 補 2 optional keys = 補齊 binding SSOT、否決 inline weak type 與 future-debt 路線）；SSOT / Runtime 不變性 / ambient 變更三判斷全過（條件：code stage 六項 gate 必重跑，已在 §驗證計劃）。**N1**：`fields: Record<string, string>` 僅限 parser 內部、不得 export、不得升級為 shared SIWE contract。**N2**：`SiweConfigEnv`/`SiweDbEnv` 僅表達 binding 需求、模組私有不外拋、禁演化成 exported `SiweEnvContract` 第二契約（Arch 範例片段 `Pick<Env, "DB">` 為示意、實際鍵名 = `chiyigo_db`，與本 plan 凍結 diff 一致）。**OD-1 異議處理指令**：若 Codex 對 OD-1 有異議 → 退回討論回報 owner，**不得**改 inline weak type 直接實作。Arch 指定 Codex 檢查 7 點已併入 §驗證計劃。
> - 2026-06-11 **Codex Plan Gate：`CODEX_PLAN_APPROVED`（@ `b1e8c54`）** — 零 blocking finding；獨立核對：branch docs-only、base 942、siwe.ts 恰 26 errors、`WALLET_SIWE_*` 僅現於 siwe.ts 與 wallet integration test、production caller 限 nonce.ts/verify.ts；OD-1 方向確認（Pick 自 Env SSOT 衍生、Record 限 parser 內部未升級共享契約）；提醒 = ambient 變更全程 forced full tsc 不得靠 incremental cache（已是 §驗證計劃 SOP）。
> - 2026-06-11 **`CODING_ALLOWED`** → coding（凍結 diff 逐行重放）→ 實跑 gates → 自審 → Codex Code Gate → owner 明示點頭 → squash-merge。

## ⚠ auth-flow 熱區敏感聲明（最高優先紀律）

`siwe.ts` = **SIWE（EIP-4361）登入鏈 SSOT**：自實作 minimal verifier（EIP-4361 parser / EIP-191 keccak hash / secp256k1 ecrecover）+ wallet nonce 簽發與**一次性原子核銷**（CAS `UPDATE … WHERE consumed_at IS NULL` + `changes` 檢查）— Tier-0 熱區。**修法若非純型別、或會牽動 EIP-4361 parse 嚴格性（缺欄位/順序錯 throw）/ EIP-191 prefix 字串 / ecrecover 字節邊界（65 bytes、v−27、0x04 檢查）/ nonce TTL 與原子核銷 SQL / domain・uri origin・時間窗檢查 / error 字串 / caller / tests → 立刻停手回 `PLAN_DRAFT`。** TS erase 後 runtime 行為必須不變（常數 / 字串 / 註解 / JSDoc byte-identical）。

**Coding 階段硬性邊界**：
- 允許：13 個 siwe.ts 編輯點（11 個函式 signature 參數標註 + 1 個 `fields` 區域變數標註 + 1 個 alias 區塊〔2 type alias + 1 行 why-comment，模組私有不外拋，PR-2v 前例〕）+ §OD-1 裁可後 `types/env.d.ts` 2 行 optional keys（Auth misc 區，依該檔自述契約「新增 secret 必更新本檔」）
- 禁止：改 parser / ecrecover / nonce SQL / 任何 throw・error 字串、改既有註解與 JSDoc、改 caller、改 tests、改 tsconfig / eslint / vitest、新增 any、新增 suppression、新增 import、**顯式標任何 return**（return 推斷由函式體決定 — 零 drift 以實證為據：spike sort-diff 全圖零新增行 + tests-leaf forced exit 0）

## Scout（對抗式驗證）

### exact errors（forced tsc @ `6ffc69e`，total 942）

恰 **26** 個：**TS7006 ×13**（env ×4〔L21/39/56/213〕、nonce、s ×2〔L73/L197〕、text ×2〔L85/L156〕、bytes、hex、msgHash、sigHex）+ **TS7031 ×4**（destructure binding：L39 `userId`/`address`、L213 `messageRaw`/`signature`）+ **TS7053 ×9**（L109 `const fields = {}` 之字串索引：寫入 ×1、REQUIRED_FIELDS 檢查 ×1、回傳七欄 ×7）。

### 依賴邊界（caller 契約逐一驗證）

- **production caller 僅 2 檔**：`wallet/nonce.ts`（issueWalletNonce / isValidEthAddress / getSiweConfig）與 `wallet/verify.ts`（verifySiweMessage / consumeWalletNonce）。兩檔現各 4 errors **全為 handler `{ request, env }` TS7031** → 流入值（body 欄位、env、userId）全 any → 對新 param 型別全 assignable。
- **🔑 verify.ts L67 union 解構分析**：`verifySiweMessage` 回傳 inferred union（5 個 `{ok:false,error}` + 1 個 `{ok:true,address,chainId,nonce}`）；L60 `if (!verifyResult.ok) return` 早退後 L67 解構**今天就不報錯**（base 量測實證）。本 PR 不標 return、union 成員結構不變，只把 ok:true 分支 `nonce/uri/…: any → string`（fields 標註的下游）→ 結構保持、零新破壞（spike sort-diff 收口）。
- **test caller 僅 1 檔**：`tests/integration/wallet.test.ts` 經 `_internal` 只用 `bytesToHex`（傳 `keccak_256(...).slice(-20)` → Uint8Array ✓）與 `hashMessageEip191`（傳 untyped test helper 參數 → any ✓，tests leaf noImplicitAny: false）。
- **vendor 型別本源**：`@noble/curves` / `@noble/hashes` 皆 TS-native typed — `keccak_256` 回 `Uint8Array`、`Signature.recoverPublicKey` 收 Hex（含 Uint8Array）、`toRawBytes(false)` 回 Uint8Array（spike 全圖零 error 實證選型相容）。
- **`WALLET_SIWE_DOMAIN` / `WALLET_SIWE_URI` 不存在於 Env**（repo 全 .d.ts grep 零命中）→ 引出 §OD-1。
- **與 F-3 / audit retention / R2 lock 零重疊**；無新 global 名稱（`Env` 已在 eslint globals）→ [[feedback_new_global_type_needs_eslint_globals]] 不觸發。`types/env.d.ts` 不在 `eslint functions tests` lint 面（既有狀態）。

### 型別選型（chain 既定 pattern；Convention A inline）

1. **env 雙 alias（PR-2m `EmailEnv` / PR-2v `Jwt*Env` 前例，模組私有）**：`type SiweConfigEnv = Pick<Env, 'WALLET_SIWE_DOMAIN' | 'WALLET_SIWE_URI'>`（getSiweConfig / verifySiweMessage）、`type SiweDbEnv = Pick<Env, 'chiyigo_db'>`（issueWalletNonce / consumeWalletNonce）— 簽驗 config 面與 DB 面分離 = 最小權限表達；無 fake-env unit caller（wallet.test 只走 endpoint + `_internal`），Pick 不需 Partial。
2. **防禦性 validator 標 `unknown`**（chain 前例 `validatePassword(pw: unknown)` / roles.ts）：`isValidEthAddress(s: unknown)`（typeof guard）、`parseSiweMessage(text: unknown)`（typeof + throw fail-closed）。
3. **`fields: Record<string, string>`**（一個區域變數標註消 TS7053 ×9；值全來自 `ln.slice()` string；SNC-off 下與 `string | undefined` 等價、取簡）。
4. **byte/hex helper 以 vendor 實際簽名為準**：`bytesToHex(bytes: Uint8Array)`（3 個內部 caller 全 Uint8Array + test caller ✓）、`hexToBytes(hex: string)`、`hashMessageEip191(text: string)`、`recoverAddressFromSig(msgHash: Uint8Array, sigHex: string)`。
5. **`parseIsoMs(s: string | null)`** — `!s` guard 的誠實型別（expirationTime/notBefore runtime 可為 null）。
6. **destructure shape**：`issueWalletNonce(…, { userId, address, chainId = 1 }: { userId: number; address: string; chainId?: number })`、`verifySiweMessage(…, { messageRaw, signature }: { messageRaw: string; signature: string })` — 鏡像 caller 流入（verify.ts L49-50 typeof 過濾、nonce.ts addrLower/chainId）。
7. **`consumeWalletNonce(env, nonce: string)`** — verify.ts 傳 union 窄化後的 `nonce`（本 PR 後 string）。

**考慮過、否決**：inline all-optional env type `{ WALLET_SIWE_DOMAIN?: string; WALLET_SIWE_URI?: string }`（**probe 實證 TS2559 weak-type**：未來 wallet handler 棒標 `env: Env` 時「no properties in common」即爆 → 埋回鍋 shipped 檔的債，見 OD-1）；`messageRaw: unknown`（hashMessageEip191 在 parse 成功後直接吃它，unknown 會逼內部 cast = 違最小 diff；runtime 防禦已在 parseSiweMessage typeof throw）；`fields: Record<string, string | undefined>`（SNC-off 下無差別、徒增噪音）；顯式 return / `Map` 泛型等無 error 驅動項。

### Open Decisions（prose 裁決，[[feedback_gate1_forks_prose_ruling]]）

- **OD-1 `types/env.d.ts` 增 2 行 optional keys（建議採納）**：`WALLET_SIWE_DOMAIN?: string` / `WALLET_SIWE_URI?: string` 入 Env「Auth misc」區。理由：① env.d.ts 自述契約即「新增 secret 必更新本檔」— 這 2 個 F-3 期 optional config 漏登錄，本項是**補齊既有 SSOT**而非新發明；② 替代案 inline all-optional type 經 standalone probe 實證 **TS2559 weak-type**（`Type 'Env' has no properties in common`）— 未來 wallet handler 棒次標 `env: Env` 時必爆、屆時得回鍋改已 shipped 的 siwe.ts；③ optional 成員為純加法，對既有 assignability 零影響（spike 全圖 sort-diff 零新增行實證，含 tests leaf）。成本：本 PR diff 多 1 檔 2 行；ambient .d.ts 變更 → 量測一律全重建（[[feedback_tsc_b_incremental_stale_after_ambient_dts]]，spike 已照辦）。**fallback（若 Arch 否決）**：改 inline weak type + 在 plan 與 memory 登記 TS2559 future-debt，留待 wallet handler 棒處理。

## Spike 實證（A1，2026-06-11，已 revert）

**程序**：套 14 編輯點（siwe.ts 13 + env.d.ts 1）→ 清 `.tscache` → `tsc -b tsconfig.solution.json --force` → sort-diff → `tsc -b tsconfig.tests.json --force` → 清 `.tscache` → canonical `typecheck:ratchet:report` → targeted integration → 單檔 eslint → `git stash`（revert）→ 驗 clean。

**單輪達標（零修正輪）**：

| 驗收條件 | 結果 |
|---|---|
| `siwe.ts` errors 26 → 0 | ✅ filter 0 殘留 |
| total errorCount 942 → 916（恰 −26） | ✅ forced tsc 916 + canonical `--report` errorCount 916 |
| errorFiles 108 → 107 / cleanFiles 196 → 197 | ✅ `--report` 實測（sourceFilesTotal 304 不變） |
| zero cascade（全 solution graph，含 ambient env.d.ts 變更面） | ✅ sort-diff：移除 35 行 = **26 行 siwe error + 9 行 TS7053 related-info 縮排行**（`No index signature…` ×2 + `Property 'X' does not exist on type '{}'` ×7，皆屬 siwe 9 顆 TS7053 的附屬輸出、不帶檔名前綴）、**零新增行**；`tsc -b tsconfig.tests.json --force` exit 0 |
| targeted test runtime 不變 | ✅ `npx vitest run --config vitest.workers.config.js tests/integration/wallet.test.ts` **13/13 passed**（標註套用狀態實跑；nonce 簽發 401/400/200/409 + verify 正簽/偽造簽章/他人 nonce/已消耗 nonce/domain 防 phishing 全 deny path） |
| lint | ✅ `npx eslint functions/utils/siwe.ts` exit 0（env.d.ts 本就不在 lint 面；全量 lint 列 code-stage gate） |
| diff 面 | ✅ `git diff --stat`：siwe.ts +16/−12、types/env.d.ts +2/−0（合計 2 檔 +18/−12），無其他檔 |
| working tree revert clean | ✅ stash 後 `git status --porcelain` 空、HEAD `6ffc69e`（stash 已 drop，本 doc 凍結 diff 為 SoT） |

**輔助 probe（standalone tsc，OD-1 證據）**：inline all-optional target vs Env-like source → **TS2559**；Env 宣告 optional keys + `Pick` → exit 0。

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，14 編輯點，2 檔 +18/−12）**：

```diff
--- types/env.d.ts（Auth misc 區，OD-1）
     TURNSTILE_SECRET_KEY?: string;
+    WALLET_SIWE_DOMAIN?: string;
+    WALLET_SIWE_URI?: string;

--- functions/utils/siwe.ts
 const VERIFY_DOMAIN_DEFAULT = 'chiyigo.com'

+// env 參數窄化（鏡像各函式實讀鍵 = 最小權限面；PR-2m EmailEnv / PR-2v Jwt*Env 前例）
+type SiweConfigEnv = Pick<Env, 'WALLET_SIWE_DOMAIN' | 'WALLET_SIWE_URI'>
+type SiweDbEnv = Pick<Env, 'chiyigo_db'>
+

-export function getSiweConfig(env) {
+export function getSiweConfig(env: SiweConfigEnv) {

-export async function issueWalletNonce(env, { userId, address, chainId = 1 }) {
+export async function issueWalletNonce(env: SiweDbEnv, { userId, address, chainId = 1 }: { userId: number; address: string; chainId?: number }) {

-export async function consumeWalletNonce(env, nonce) {
+export async function consumeWalletNonce(env: SiweDbEnv, nonce: string) {

-export function isValidEthAddress(s) {
+export function isValidEthAddress(s: unknown) {

-export function parseSiweMessage(text) {
+export function parseSiweMessage(text: unknown) {

-  const fields = {}
+  const fields: Record<string, string> = {}

-function bytesToHex(bytes) {
+function bytesToHex(bytes: Uint8Array) {

-function hexToBytes(hex) {
+function hexToBytes(hex: string) {

-function hashMessageEip191(text) {
+function hashMessageEip191(text: string) {

-function recoverAddressFromSig(msgHash, sigHex) {
+function recoverAddressFromSig(msgHash: Uint8Array, sigHex: string) {

-function parseIsoMs(s) {
+function parseIsoMs(s: string | null) {

-export async function verifySiweMessage(env, { messageRaw, signature }) {
+export async function verifySiweMessage(env: SiweConfigEnv, { messageRaw, signature }: { messageRaw: string; signature: string }) {
```

（EIP-4361 parser、EIP-191 prefix、ecrecover 字節邏輯、nonce SQL 與 CAS、所有 throw/error 字串、註解、JSDoc **byte-identical**；新增 = 2 alias + 1 行 why-comment + 1 空行 + env.d.ts 2 行；TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `6ffc69e` `--report` 現況：errorCount **942** / errorFiles **108** / cleanFiles **196** / sourceFilesTotal 304。
- 本 PR 後 current state：errorCount **942 → 916**（−26）、errorFiles **108 → 107**、cleanFiles **196 → 197**（spike 實測值）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 參數/變數型別標註 + 2 個模組私有 alias + Env 2 個 optional 宣告，TS erase 後 runtime 行為不變；wallet integration 13/13 已在標註狀態實跑（含原子核銷與全 deny path）。
- rollback：單一 squash revert 即完整回退（env.d.ts optional keys 為純加法、revert 無殘留）；無 migration、無 deploy 行為差；revert 後 ratchet 自然回 942。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（tests-leaf forced exit 0 實證）。
- 13 例直接覆蓋（1 檔）：`tests/integration/wallet.test.ts` — nonce 簽發 4 例（未登入/格式錯/happy/已綁 409）+ verify 5 例（正簽含 audit+consume、他人 nonce、偽造簽章、已消耗 nonce、domain mismatch 防 phishing）+ `_internal` 簽章 helper 實跑 ecrecover roundtrip。
- **未覆蓋、不宣稱**：`wallet/[id].ts`（解綁端點）不 import siwe、不在影響面；`getSiweConfig` 的 `WALLET_SIWE_*` 自訂值路徑無測例（prod 未設該 var、走 default，本 PR 不動該邏輯）。

## 驗證計劃（coding 階段，CODING_ALLOWED 後）

> ⚠ 本 PR 動 ambient `types/env.d.ts` → **所有 tsc/ratchet 量測一律清 `.tscache` 全重建**（[[feedback_tsc_b_incremental_stale_after_ambient_dts]]）。PowerShell 用 `$env:RATCHET_BASE_REF='6ffc69e'`。

- `$env:RATCHET_BASE_REF='6ffc69e'; npm run typecheck:ratchet` green（942→916 / 108→107 / 196→197）。
- `npm run lint` green（全量）、`npm run build:functions` green。
- filtered forced tsc：siwe.ts 0 殘留、sort-diff 重放（移除 26+9 行、零新增）；`tsc -b tsconfig.tests.json --force` exit 0。
- targeted test：`npx vitest run --config vitest.workers.config.js tests/integration/wallet.test.ts`（13 例）。
- baseline file 不得 `--update`（天花板 1119/175 保持）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（2 檔，不得多檔）；超出 = scope creep = Gate fail。
- **Arch Gate 指定 Codex 檢查 7 點**（`CHATGPT_ARCH_APPROVED` 附帶條件）：
  1. **OD-1** — 採納 Env optional keys，不走 inline weak type
  2. **Diff scope** — 僅 `functions/utils/siwe.ts` + `types/env.d.ts`
  3. **Runtime tokens** — parser / crypto / nonce SQL 一字不動
  4. **Return type** — 全不標註（防 caller drift）
  5. **Ambient rebuild** — code stage 全程 forced full tsc（清 .tscache）
  6. **`Record<string, string>`** — 僅限 parser 內部（N1）
  7. **Private aliases** — 不 export、不形成 Env SSOT 外的第二契約（N2）
- merge 後 smoke：wallet 端點皆需 auth → credential-free smoke = home / login 200（chain 預設）；SIWE 全鏈以 integration 13 例 + CI 全量為準。

## 流程定位

- Dual Gate Workflow：`SPEC_APPROVED`（owner「開 PR-2x」沿用 chain 模板）→ `PLAN_SELF_REVIEW_CLEAN` → A1 spike → 本 doc commit feature branch → **ChatGPT Architecture Gate（裁 OD-1）** → **Codex Plan Gate** → `CODING_ALLOWED` → coding（凍結 diff 逐行重放）→ 實跑 gates → 自審 → Codex Code Gate → owner 明示點頭 → squash-merge。
- merge 後監看 CI+Deploy（jwt.test flake 就 rerun）；memory 收尾 receipt。
- **下一刀（owner 排序，開工前再確認）**：scopes.ts（14）→ rate-limit.ts（3）→ middleware 群〔4 檔 18〕→ cors.ts（security-boundary 單獨 PR，~20 caller）。
