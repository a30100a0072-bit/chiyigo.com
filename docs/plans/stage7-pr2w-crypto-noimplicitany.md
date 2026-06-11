# Stage 7 reduce PR-2w — utils/crypto noImplicitAny（auth-core chain 第 7 棒，密碼/PKCE/token-hash/備用碼核銷 SSOT 單獨 plan-gate）

**目標**：`functions/utils/crypto.ts` **12 個 noImplicitAny error → 0**，**純 type-only**（7 個編輯點，全為函式參數型別標註；零 runtime token 改動）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。`password.ts`（PR-2q `4d6d075`）→ `role-change.ts`（PR-2r `b43770b`）→ `roles.ts`（PR-2s `7307c91`）→ `risk-score.ts`（PR-2t `7ca8456`）→ `2fa/verify.ts`（PR-2u `e71dda3`）→ `jwt.ts`（PR-2v `71402db`）；本 PR = 第 7 棒 `utils/crypto.ts`，再續 siwe（26）/ scopes（14）/ rate-limit（3），middleware 群與 cors.ts 最後。

base main `71402db`（接 PR-2v）。

> **Gate 紀錄（Dual Gate Workflow）**：
> - 2026-06-11 owner 當輪明示 **SPEC_APPROVED**（scope = 本檔 noImplicitAny 清零、純 type-only reduce PR；Non-goals = 不碰 caller / tests / config / runtime 行為、不顯式標 return），並預授權 A1 spike + plan doc 落檔 commit feature branch。
> - 2026-06-11 Claude plan 自審到零 blocker（`PLAN_SELF_REVIEW_CLEAN`）。
> - 2026-06-11 **A1 spike 已執行並全項達標**（見 §Spike 實證；單輪零修正），working tree 已 revert clean。
> - 2026-06-11 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`（@ `4ccc81c`）** — 審查面 9 項全過（scope / runtime drift / SSOT / auth contract / caller blast radius / DB N/A / rollback / baseline policy / OD 無需裁決）；**bufferToHex 選型裁定採 `ArrayBuffer | Uint8Array`**（minimum honest contract；否決 `BufferSource`〔過寬，DataView 等未使用面〕/ `ArrayBufferLike`〔SharedArrayBuffer 非必要面〕/ `ArrayLike<number>`〔一般 number array 誤納〕）；return 不標 = 正確選擇（避免 reduce PR 混入新公共契約）；Arch Gate 指定 Codex 檢查 5 點已併入 §驗證計劃。
> - ⏳ Codex Plan Gate（Codex 輪不回送 GPT；若 Codex 修正推翻 Arch 架構級決策 → 回報 owner 裁定）。
> - ⏳ `CODING_ALLOWED` → coding（凍結 diff 逐行重放）→ Codex Code Gate → owner 明示點頭 → squash-merge。

## ⚠ auth-flow 熱區敏感聲明（最高優先紀律）

`crypto.ts` = **全站密碼雜湊 / PKCE 驗證 / token 雜湊 / 2FA 備用碼核銷比對 SSOT**（純 Web Crypto、零依賴）— Tier-0 核心。所有本地密碼（register / login / change / reset / delete / 2fa-activate）經 `hashPassword` / `verifyPassword`；所有 refresh token / email token / oauth code / 冪等 requestHash 經 `hashToken`（外部呼叫 31 站）；OAuth PKCE 經 `pkceVerify`；2FA 備用碼核銷經 `verifyBackupCode`（5 站，含 step-up / reset-password 高敏感路徑）。owner / gate 紀律：**修法若非純型別、或會牽動 PBKDF2 參數（SHA-256 / 100,000 iterations / 32 bytes）/ constant-time 比對迴圈（`diff |= charCodeAt ^ charCodeAt` 與等長 early-return 語意）/ 亂數長度（32 bytes salt/token、備用碼 5×2 bytes）/ base64url 轉換 / dash 正規化 / caller / tests / config → 立刻停手回 `PLAN_DRAFT`，不硬寫。** TS erase 後 runtime 行為必須不變（常數 / 字串 / 既有註解 / JSDoc byte-identical）。

**Coding 階段硬性邊界**：
- 允許：**僅** 7 個函式 signature 行的參數型別標註（Convention A inline；見 §凍結 diff）
- 禁止：改 PBKDF2 常數、改 constant-time 比對、改任何 throw / return 值、改既有註解、改 JSDoc（stale `@param {string}` 文字保留 — .ts 模式不讀 JSDoc 型別，純 docs）、改 caller、改 tests、改 tsconfig / eslint / vitest、新增 any、新增 suppression、新增 import（本檔零依賴，維持）、新增 type alias（無 env 參數，[[feedback_util_env_param_pick_not_full_env]] 不適用）、**顯式標任何 return**（Non-goal；export 面 return 全靠既有推斷，且推斷由函式體決定、與參數標註無關 — `bufferToHex` body `join('')` → string 鏈、比對函式回 boolean 比較式、`generateBackupCodes` evolving array 由 push 收斂 — **零 drift 以實證為據**：spike sort-diff 全圖零新增行 + tests-leaf forced exit 0）

## Scout（對抗式驗證）

### exact errors（forced tsc @ `71402db`，total 954）

恰 **12** 個、全 **TS7006**（implicit any param），分布於 7 個函式 signature：
- L15 `bufferToHex(buffer)` ×1（module-private）
- L21 `hexToBuffer(hex)` ×1（module-private）
- L51 `hashPassword(password, saltHex)` ×2
- L80 `verifyPassword(password, saltHex, storedHashHex)` ×3
- L99 `hashToken(token)` ×1
- L114 `pkceVerify(codeVerifier, codeChallenge)` ×2
- L154 `verifyBackupCode(inputCode, storedHash)` ×2

### 🔑 開工 prompt 預警校正：password.ts `pw: unknown` 流入點

預警內容為「password.ts 已標 `pw: unknown`，crypto helper 標 `password: string` 恐在 password.ts 炸 TS2345」。**scout 實證校正**：`functions/utils/password.ts` 只有 `validatePassword(pw: unknown)` 一個函式，**完全不 import / 不呼叫 crypto helper** — 該檔與本 PR 零交集。真正的流入鏈 = endpoint 先 `validatePassword(password)` 再 `hashPassword(password, ...)`；`validatePassword` 回傳 `{ok}` union **不是 type predicate、不窄化 caller 變數**，但這些 endpoint（register / login / reset-password / change-password / delete / 2fa-activate）的 `password` 皆來自 untyped `request.json()` body（檔各帶 2–4 個既有 error，body 為 any）→ `any → string` assignable，零 cascade。**全圖 spike sort-diff 實證收口**（見下）。

### 依賴邊界（caller 契約逐一驗證）

- **型別本源 = Web Crypto 實際簽名（lib.dom，TS 5.9.3）**：`crypto.getRandomValues(new Uint8Array(n))` → `Uint8Array`（×3 站：L33/L39/L138）；`crypto.subtle.deriveBits(...)` / `crypto.subtle.digest(...)` → `Promise<ArrayBuffer>`（L70 `bits`、L102 `digest`；pkceVerify 的 digest L117 直接 `new Uint8Array(digest)`、不經 bufferToHex）→ `bufferToHex` 參數 = **`ArrayBuffer | Uint8Array` union 鏡像兩類實際流入**；`new Uint8Array(buffer)` 對該 union 過 lib.es5 `ArrayLike<number> | ArrayBufferLike` overload（spike 實證零 error）。
- **production caller ×31 檔**（25 api + 6 utils；`hashToken` 外部 31 站最大面 — grep 35 行 − 本檔 3 行〔def + 內部 ×2〕− user-audit.ts L172 註解 1 行）：
  - 已 typed clean 檔（cascade 敏感面，逐站驗）：`2fa/verify.ts`（PR-2u；`sanitized` 經 `typeof otp_code !== 'string'` guard → string ✓、`hashToken(refreshToken)` ← `generateSecureToken()` string ✓）、`oauth/[provider]/callback.ts`（同 refreshToken pattern ✓）、`billing.ts` / `credit.ts` / `members.ts`（`hashToken(canonicalJson({...}))` ← string ✓）、`invitations.ts`（`rawToken` string ✓）、`admin/cron/event-outbox.ts`（`row.stream_key` ← D1 row any ✓，[[feedback_d1database_resolves_any_no_workers_types]]）、`admin/event-dlq/[id]/replay.ts`（`String(dlqRow.stream_key)` ✓）。
  - 備用碼 5 站：step-up / 2fa-disable / regenerate 全 `String(backup_code).replace(...).toLowerCase()` → string ✓；2fa/verify typeof guard ✓；reset-password `sanitized` ← any body ✓；`code.code_hash` 全為 D1 row → any ✓。
  - `pkceVerify` 唯一站 oauth/token.ts：`code_verifier` ← any body ✓、`authCode.code_challenge` ← D1 row any ✓。
  - 其餘帶 error 檔（login / register / refresh / logout / delete / forgot-password / end-session / email/* / webauthn / oauth-session / user-audit…）：流入值為 any body / D1 row / `generateSecureToken()` string，全 assignable。
- **test caller**：`tests/crypto.test.ts` 直接 unit 12 例（string literal + RFC 7636 vector + `plain[i]`〔noUncheckedIndexedAccess 未開 → string；tests leaf 且 noImplicitAny: false〕）✓；16 個 integration 檔（含 `_helpers.ts`）經直接 import，傳生成 token string ✓ — `tsc -b tsconfig.tests.json --force` exit 0 實證。
- **無 env 參數**（Pick 規則不適用）、**無新 import**、**無 ambient global**（[[feedback_new_global_type_needs_eslint_globals]] 不觸發）→ 零 config 改動（spike 單檔 eslint exit 0 實證）。
- **與 F-3 / audit retention / R2 lock 零重疊**。

### 型別選型（chain 既定 pattern；Convention A inline）

1. **字串參數 ×10 全標 `string`**：hex salt / hash / token / verifier / challenge / 備用碼輸入，runtime 全為 string 流（caller 實證 + 函式體 `enc.encode()` / `.replace()` / `.charCodeAt()` 皆 string 操作）— 誠實契約，且讓 35 個 call site 即刻獲得編譯期把關。
2. **`bufferToHex(buffer: ArrayBuffer | Uint8Array)`**：以 Web Crypto 實際簽名為準（[[feedback_dont_assert_runtime_semantics_without_verify]] — 經 spike 實測非 memory 斷言）。
3. **`hexToBuffer(hex: string)`**：唯一 caller = `hashPassword` 傳 `saltHex: string` ✓；return `bytes.buffer` 推斷不動（`deriveBits` 的 `salt: BufferSource` 收 ✓）。

**考慮過、否決**：`password: unknown` 鏡像 validatePassword（① password.ts 不是 caller，鏡像對象不存在；② unknown 會把窄化負擔塞進 crypto 函式體 → 需內部 cast 或 runtime guard = 違反 type-only / first-do-no-harm；③ 實證全 caller assignable，string 即誠實契約）；`buffer: ArrayBufferLike | ArrayLike<number>`（lib 內部寬型別，弱於實際流入面的表達、引入 SharedArrayBuffer 等不存在的流入）；`buffer: BufferSource`（= `ArrayBufferView | ArrayBuffer`，過寬同理）；顯式標 return / `Uint8Array<ArrayBuffer>` 泛型參數（無 error 驅動、非最小 diff）。

### Open Decisions

無 — 設計空間已由 caller 實證 + spike 收斂為單一方案，無需 owner prose 裁決的分叉（[[feedback_gate1_forks_prose_ruling]]：僅真分叉才列）。

## Spike 實證（A1，2026-06-11，已 revert）

**程序**：套 7 編輯點 → 清 `.tscache` → `tsc -b tsconfig.solution.json --force` → `tsc -b tsconfig.tests.json --force` → 清 `.tscache` → canonical `typecheck:ratchet:report` → targeted unit → 單檔 eslint → `git restore` → 驗 clean。

**單輪達標（零修正輪）**：

| 驗收條件 | 結果 |
|---|---|
| `crypto.ts` errors 12 → 0 | ✅ filter 0 殘留 |
| total errorCount 954 → 942（恰 −12） | ✅ forced tsc 942 + canonical `--report` errorCount 942 |
| errorFiles 109 → 108 / cleanFiles 195 → 196 | ✅ `--report` 實測（sourceFilesTotal 304 不變） |
| zero cascade（全 solution graph） | ✅ base/spike error 輸出逐行 sort-diff：**僅 12 行 crypto.ts 移除、零新增行**；`tsc -b tsconfig.tests.json --force` exit 0 |
| targeted test runtime 不變 | ✅ `npx vitest run tests/crypto.test.ts` **12/12 passed**（標註套用狀態實跑；含 PBKDF2 roundtrip / wrong-password / 等長 early-exit / salt 隔離 / hashToken 決定性 / RFC 7636 PKCE vector / 備用碼 dash 正規化矩陣） |
| lint | ✅ `npx eslint functions/utils/crypto.ts` exit 0（全量 lint 列 code-stage gate） |
| 無新增檔案 / 無 caller/test/config diff | ✅ `git diff --stat` 僅 crypto.ts 1 檔（+7/−7） |
| working tree revert clean | ✅ `git restore` 後 `git status --porcelain` 空、HEAD `71402db` |

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，7 編輯點，+7/−7）**：

```diff
-function bufferToHex(buffer) {
+function bufferToHex(buffer: ArrayBuffer | Uint8Array) {

-function hexToBuffer(hex) {
+function hexToBuffer(hex: string) {

-export async function hashPassword(password, saltHex) {
+export async function hashPassword(password: string, saltHex: string) {

-export async function verifyPassword(password, saltHex, storedHashHex) {
+export async function verifyPassword(password: string, saltHex: string, storedHashHex: string) {

-export async function hashToken(token) {
+export async function hashToken(token: string) {

-export async function pkceVerify(codeVerifier, codeChallenge) {
+export async function pkceVerify(codeVerifier: string, codeChallenge: string) {

-export async function verifyBackupCode(inputCode, storedHash) {
+export async function verifyBackupCode(inputCode: string, storedHash: string) {
```

（PBKDF2 常數、constant-time 迴圈、base64url 轉換、dash 正規化、所有註解 / JSDoc **byte-identical**；新增 = 0 行，純參數標註；TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `71402db` `--report` 現況：errorCount **954** / errorFiles **109** / cleanFiles **195** / sourceFilesTotal 304（spike 前實測）。
- 本 PR 後 current ratchet state：errorCount **954 → 942**（−12）、errorFiles **109 → 108**、cleanFiles **195 → 196**（spike 實測值，非預測）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 12 個參數型別標註（7 行），TS erase / esbuild strip 後 runtime 行為不變；direct unit 12/12 已在標註狀態實跑。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 954，零殘留。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（tests-leaf forced exit 0 實證）。
- 12 例直接覆蓋（1 檔）：`tests/crypto.test.ts`（鹽/token 生成格式與唯一性、PBKDF2 roundtrip 正反、等長 early-exit、hashToken 決定性、RFC 7636 PKCE 正反、備用碼 10 組格式 + dash/無 dash 核銷矩陣）。
- **未覆蓋、不宣稱**：31 個 production caller 檔的 integration suites（pkce-flow / reset-password(-2fa) / change-password / refresh…16 檔）不在 targeted 集（CI 全量跑會覆蓋）；`generateBackupCodes` 與各 caller 的端到端 2FA 流程歸各 endpoint suite。

## 驗證計劃（coding 階段，CODING_ALLOWED 後）

> ⚠ ratchet/tsc 量測前清 `.tscache`（PowerShell `Remove-Item -Recurse -Force .tscache`）。**PowerShell 用 `$env:RATCHET_BASE_REF='71402db'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='71402db'; npm run typecheck:ratchet` green（954→942 / 109→108 / 195→196）。
- `npm run lint` green（全量）、`npm run build:functions` green（零 import 改動，照 chain SOP 必跑）。
- filtered forced tsc：crypto.ts 0 殘留、**954→942 恰 −12 零新增**（sort-diff 重放）；`tsc -b tsconfig.tests.json --force` exit 0。
- targeted test：`npx vitest run tests/crypto.test.ts`（12 例）。
- baseline file 不得 `--update`（天花板 1119/175 保持）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（人審 `git diff -- functions/utils/crypto.ts`），不得擴張 beyond 7 編輯點；超出 = scope creep = Gate fail。
- **Arch Gate 指定 Codex 檢查 5 點**（`CHATGPT_ARCH_APPROVED` 附帶條件）：
  1. **Diff freeze** — 實作 diff = plan 凍結 diff：僅 `functions/utils/crypto.ts`、+7/−7
  2. **No return annotation** — 不得補任何 return type
  3. **No alias / import** — 不得新增 type alias、import、helper、wrapper
  4. **Runtime byte-identical** — TS erase / bundle 等價證明零 runtime token 變動（`npm run build:functions` 即此項驗證）
  5. **Baseline unchanged** — 不得更新 canonical baseline ceiling（1119/175 保持）
- merge 後 smoke：crypto.ts 無自身 endpoint、全為 helper。credential-free 替代 = 已登入 session 正常活動即覆蓋 `hashToken`（refresh 路徑）；owner 無痕登入一次可同時覆蓋 `verifyPassword` + `hashToken` 活路徑（沿用 [[reference_codex_prod_verification]] 模式，owner 裁量）。

## 流程定位

- Dual Gate Workflow：`SPEC_APPROVED`（owner 當輪明示）→ `PLAN_SELF_REVIEW_CLEAN` → A1 spike（owner 預授權前置）→ 本 doc commit feature branch → **ChatGPT Architecture Gate** → **Codex Plan Gate**（迭代審到過）→ `CODING_ALLOWED` → coding（凍結 diff 逐行重放）→ 實跑 gates → 自審 → Codex Code Gate → owner 明示點頭 → squash-merge。
- merge 後監看 CI+Deploy（撞 `jwt.test` flake 就 rerun）。
- merge 後 memory 收尾：receipt + 校正「password.ts `pw: unknown` 流入點」預警（實為 validatePassword 獨立函式、非 crypto caller）。
- **下一刀（owner 排序，開工前再確認）**：siwe（26）→ scopes（14）→ rate-limit（3）同 chain；middleware 群〔實際 = 4 檔 18 errors：api/_middleware 9 + admin/ai/auth 各 3；`functions/_middleware.ts` 量測 0 errors，repo 無單檔 middleware 標的〕與 cors.ts（security-boundary 單獨 PR，~20 caller）最後。
