# Stage 7 reduce PR-2v — utils/jwt noImplicitAny（auth-core chain 第 6 棒，token 簽驗 SSOT 最熱區單獨 plan-gate）

**目標**：`functions/utils/jwt.ts` **35 個 noImplicitAny error → 0**，**純 type-only**（11 個編輯點，全為型別標註；零 runtime token 改動）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。`password.ts`（PR-2q `4d6d075`）→ `role-change.ts`（PR-2r `b43770b`）→ `roles.ts`（PR-2s `7307c91`）→ `risk-score.ts`（PR-2t `7ca8456`）→ `2fa/verify.ts`（PR-2u `e71dda3`）；本 PR = 第 6 棒 `utils/jwt.ts`（現況最大單顆 35 errors），再續 crypto / siwe / scopes / rate-limit，`_middleware` 最後。

base main `e71dda3`（接 PR-2u）。

> **Gate 紀錄（Dual Gate Workflow）**：
> - 2026-06-11 owner 當輪明示 **SPEC_APPROVED**（scope = 本檔 noImplicitAny 清零、純 type-only reduce PR；Non-goals = 不碰 caller / tests / config / runtime 行為），並預授權 A1 spike + plan doc 落檔 commit feature branch。
> - 2026-06-11 Claude plan 自審到零 blocker（`PLAN_SELF_REVIEW_CLEAN`）。
> - 2026-06-11 **A1 spike 已執行並全項達標**（見 §Spike 實證；單輪零修正），working tree 已 revert clean。
> - ⏳ ChatGPT Architecture Gate（本 doc 送審）。
> - ⏳ Codex Plan Gate。
> - ⏳ `CODING_ALLOWED` → coding（凍結 diff 逐行重放）→ Codex Code Gate → owner 明示點頭 → squash-merge。

## ⚠ auth-flow 熱區敏感聲明（最高優先紀律）

`jwt.ts` = **全站 token 簽發/驗證 SSOT**（ES256 私鑰簽發、JWKS 多 key 驗證、key rotation 預備、模組級金鑰快取）— Tier-0 核心。所有 access / pre_auth / step-up / temp_bind / id_token 都經 `signJwt`；所有 `requireAuth` 都經 `verifyJwt`。owner / gate 紀律：**修法若非純型別、或會牽動 alg `'ES256'` / issuer `'https://chiyigo.com'` / 預設 aud `'chiyigo'`（Codex #1 攻擊面收斂決策）/ jti 自動補發邏輯 / kid fallback（`'key-1'` / `'__default__'`）/ 金鑰快取與 `_resetJwtCache` / JSON.parse fail-closed throw / JWKS stripWs 防護 / error message 字串 / caller / tests / config → 立刻停手回 `PLAN_DRAFT`，不硬寫。** TS erase 後 runtime 行為必須不變（常數 / 字串 / 既有註解 byte-identical；新增的型別宣告與 2 行 why-comment 除外）。

**Coding 階段硬性邊界**：
- 允許：參數型別標註（Convention A inline）/ 模組級 let 型別標註 / 既有 `as` cast 的 type-literal 成員補型別 / module-local `type` alias（`JwtSignEnv` / `JwtVerifyEnv`，PR-2m `EmailEnv` 前例）/ **1 行 type-only import**（`import type { JWTPayload, KeyLike } from 'jose'`，見 §Open Decisions OD-2）
- 禁止：改 alg / iss / aud 預設、改 jti 補發、改 kid fallback、改快取邏輯、改 throw 字串、改既有註解、改 caller、改 tests、改 tsconfig / eslint / vitest、新增 any、新增 suppression、新增 runtime import、新增 package、改 JSDoc（stale `@param {object}` 文字保留，.ts 模式不讀 JSDoc 型別，純 docs）

## Scout（對抗式驗證）

### exact errors（forced tsc @ `e71dda3`，total 989）

恰 **35** 個（baseline 同記 `"functions/utils/jwt.ts": 35`），分布：
- **TS7034 ×3**（L31-33 模組級 `let _signingKey / _cachedKid / _verifyingMap = null`；SNC-off null 起始 + 跨函式 capture → flow 無法判定）+ **TS7005 ×5**（L38 ×3、L83 ×2 讀取點，隨宣告標註自動消）
- **TS7006 ×13**（8 函式的 env ×8、kid、payload、expiresIn、token、stripWs `s`）
- **TS7008 ×14**（L185 / L209 兩個既有 `as` cast type literal 的 7 個 shorthand 成員 ×2 — **即 PR-1 量測 functions leaf TS7008 全部 14 個**）

### 依賴邊界（jose v5.9.6 vendor 契約逐一驗證）
- `importJWK<KeyLikeType extends KeyLike = KeyLike>(jwk: JWK, alg?)` → `Promise<KeyLike | Uint8Array>`；`KeyLike = { type: string }` → 模組級 let 標 `KeyLike | Uint8Array | null` 鏡像 vendor return ✓
- `ProduceJWT constructor(payload?: JWTPayload)`；`JWTPayload` = 已知 claims（`iss?/sub?/aud?/jti?/nbf?/exp?/iat?`）+ `[propName: string]: unknown` index
- `SignJWT.sign(key: KeyLike | Uint8Array | JWK)`、`setProtectedHeader(JWTHeaderParameters)`（`kid?: string` ← `string | null` SNC-off ✓）、`setExpirationTime(number | string | Date)` ← `expiresIn: string` ✓
- `jwtVerify(jwt: string | Uint8Array, key: KeyLike | Uint8Array | JWK, options?: JWTVerifyOptions)` → 既有 `verifyOpts` 標註 assignable ✓
- **🔑 return 面 ground truth（CLI probe 實測）**：`verifyJwt` 現行 inferred return **已是 `Promise<JWTPayload>`**、`signJwt` 已是 `Promise<string>`（`jwtVerify` / `SignJWT.sign` 是 typed import，any 參數不改 declared return）— **memory「payload 來自 untyped verifyJwt → user any」說法經本 probe 校正**：requireAuth `user` 的 any 性來自 auth.ts 自身 pattern（TS7018 ×6 仍在該檔），非 verifyJwt return。本 PR 只標 params、**return 推斷一律不動** → 消費端 by construction 零 drift。
- **production caller**：`signJwt` ×13 站（2fa/verify、login ×2、register、refresh、oauth callback ×2 / token ×2 / bind-email、webauthn login-verify、org-switch、step-up）— payload 全為 fresh literal（`sub: String(...)` ✓）或 `claims: Record<string, unknown>` 變數（step-up L158、org-switch L60）；`verifyJwt` ×3 站（auth.ts requireAuth、bind-email、forgot-password）token 全 string-ish、env 全 `Env`；`getPublicJwks` → jwks.json.ts（serialize only）；`getPublicJwk` → 向後相容 surface。
- **🔑 Record<string, unknown> → JWTPayload assignability（CLI probe 實測 exit 0）**：SNC-off 下 **assignable**（含 `new SignJWT(record)` 直傳）→ step-up / org-switch 的 `claims: Record<string, unknown>` 呼叫點零 cascade、**無需 cast、無需動 caller**。⚠ strict:true rung 時此 assignability 反轉，該 2 站會各爆 TS2345 → 歸各檔 strict pass 處理（`claims: JWTPayload` 1-line），是已知 ladder 債、非本 PR scope。
- **test caller**：`tests/jwt.test.ts`（直接 unit，20 例）main env 為 untyped `let env`（any ✓）；**rotation 案例 `rotatedEnv` / `noOldEnv` 為 typed literal 且不帶必填 `JWT_PUBLIC_KEY`、L191 `getPublicJwks({ JWT_PUBLIC_KEYS })` 單鍵 literal** → 強制 env 參數不能標 full `Env` 或 required `Pick`（[[feedback_util_env_param_pick_not_full_env]]）。`tests/auth.test.ts`（32 例）env 帶雙鍵 ✓ payload 全 string-literal sub ✓。integration tests 經 `cloudflare:test` full env ✓。
- **與 F-3 / audit retention / R2 lock 零重疊**；eslint globals 已含 `Env`，新型別均為 import / module-local（非 ambient global，[[feedback_new_global_type_needs_eslint_globals]] 不觸發）→ 零 config 改動（spike 單檔 eslint exit 0 實證）。

### 型別選型（chain 既定 pattern；Convention A inline）

1. **env 窄化（module-local alias，PR-2m `EmailEnv` 前例）**：
   - `type JwtSignEnv = Pick<Env, 'JWT_PRIVATE_KEY'>`（getSigningKey / signJwt 實讀鍵）
   - `type JwtVerifyEnv = Partial<Pick<Env, 'JWT_PUBLIC_KEYS' | 'JWT_PUBLIC_KEY'>>`（readPublicJwks / getVerifyingMap / getVerifyingKey / verifyJwt / getPublicJwk / getPublicJwks）— **Partial 由 jwt.test rotation fake env 強制**（`Env.JWT_PUBLIC_KEY` 為必填 string，rotation env 不帶它）；runtime 對應 = readPublicJwks 既有顯式 fail-closed throw（兩鍵皆缺 → `'JWT_PUBLIC_KEY(S) is not configured'`），型別「兩鍵皆可缺」與 runtime「至少一鍵、否則 throw」語意一致
2. **`signJwt(payload: JWTPayload, expiresIn: string, env: JwtSignEnv, opts)`** — payload 用 jose vendor SSOT（見 OD-1）；`expiresIn: string` 鏡像既有 JSDoc 契約與全部 caller（TTL 常數全 string literal，spike 零 error 證明無 number caller）
3. **`verifyJwt(token: string, env: JwtVerifyEnv, opts)`** — opts 既已 typed（Stage 2）；return 維持推斷（不標）
4. **模組級 let**：`_signingKey: KeyLike | Uint8Array | null` / `_cachedKid: string | null` / `_verifyingMap: Map<string, KeyLike | Uint8Array> | null` — 鏡像 `importJWK` return；`| null` 在 SNC-off 下無語意但 strict-ready；L33 行尾註解 byte-identical 保留
5. **`getVerifyingKey(env, kid: string | null)`** — 鏡像 caller 值（`decodeProtectedHeader(token).kid ?? null`）
6. **兩個既有 `as` cast 成員補 `string`**（`{ kty: string; crv: string; x: string; y: string; kid: string; use: string; alg: string; d?: undefined }`）— 維持既有 assertion 語意（成員集合與 optionality 完全不變，僅 implicit any → string）；`d?: undefined` 私鑰不外洩保證原樣
7. **`stripWs = (s: unknown) => ...`** — 防禦性 typeof 檢查的誠實型別（值來自 JSON.parse 的 JWK 欄位）；回傳 unknown → cast 斷言為 string（assertion 合法、無 double cast）

**考慮過、否決**：`payload: Record<string, unknown>`（in-repo claims idiom，SNC-off 下也可行且免 cast，但 ① 放棄 literal caller 的已知 claim 編譯期檢查〔13 個 fresh-literal 簽發點的 `sub`/`aud`/`exp` 型別錯誤將靜默〕② strict rung 時 `new SignJWT(enriched)` 會在 jwt.ts 本檔爆、需回鍋；JWTPayload 則讓 jwt.ts 一次到位、債歸 caller 各檔）；`env: Env` full（rotation fake env TS2345 cascade，spike 前置排除）；required `Pick` 雙鍵（同上）；`payload: JWTPayload` + 內部 cast（probe 證明免 cast）；`getVerifyingKey` 顯式 return 標註 / `new Map<...>()` 泛型參數 / readPublicJwks return `JWK[]`（皆無 error 驅動、非最小 diff）；inline 重宣告 JWTPayload mirror（vendor 契約複製 = drift 風險，違 SSOT）。

### Open Decisions（prose 裁決，[[feedback_gate1_forks_prose_ruling]]）

- **OD-1 `payload: JWTPayload`（建議採納）**：jose vendor SSOT、13 個 literal 簽發點即刻獲得已知 claim 編譯期檢查、index signature 吸收自訂 claims（role / scope / ver / risk_* / tenant_id…型別為 unknown，僅流經簽章不在本檔讀取）、`Record<string, unknown>` caller 零 cascade（probe + leaf 雙實證）。本 PR 即 [[feedback_shared_auth_contract_isolation]] 指定的 shared auth contract 獨立 PR，claim 型別決策落於此。**不**另造 chiyigo 專屬 claims type（`AccessTokenClaims` 等）— signJwt 是 generic signer，端點別 claims 契約屬未來 requireAuth/_middleware 棒次。
- **OD-2 新增 1 行 type-only import**（`import type { JWTPayload, KeyLike } from 'jose'`）：前幾棒邊界寫「禁新增 import」（該棒 per-PR 邊界）；本檔型別本源即 jose，替代方案（inline 重宣告 = 契約複製、`ConstructorParameters<typeof SignJWT>[0]` 萃取 = 不可讀）皆更差。`import type` 整行 erase、esbuild/wrangler bundle 零差（code 階段 `build:functions` 驗證）。**建議允許**。
- **OD-3 env 拆雙 alias（sign/verify 分離）vs 單一合併 alias**：採雙 alias — 簽驗金鑰讀取面本就分離（私鑰僅簽發、公鑰僅驗證），合併 alias 會把 `JWT_PRIVATE_KEY` 帶進 7 個純驗證函式的型別面，弱化最小權限表達。**建議雙 alias**。

## Spike 實證（A1，2026-06-11，已 revert）

**程序**：套 11 編輯點 → 清 `.tscache` → `tsc -b tsconfig.solution.json --force` → `tsc -b tsconfig.tests.json --force` → 清 `.tscache` → canonical `typecheck:ratchet:report` → targeted unit ×2 檔 → 單檔 eslint → `git restore` → 驗 clean。

**單輪達標（零修正輪）**：

| 驗收條件 | 結果 |
|---|---|
| `jwt.ts` errors 35 → 0 | ✅ filter 0 殘留 |
| total errorCount 989 → 954（恰 −35） | ✅ forced tsc 954 + canonical `--report` errorCount 954 |
| errorFiles 110 → 109 / cleanFiles 194 → 195 | ✅ `--report` 實測（sourceFilesTotal 304 不變） |
| zero cascade（全 solution graph） | ✅ base/spike error 輸出逐行 sort-diff：**僅 35 行 jwt.ts 移除、零新增行**；`tsc -b tsconfig.tests.json --force` exit 0 |
| targeted test runtime 不變 | ✅ `npx vitest run tests/jwt.test.ts tests/auth.test.ts` **52/52 passed**（jwt 20 + auth 32，標註套用狀態實跑；含 roundtrip / tamper / aud 矩陣 / jti / rotation 多 key / getPublicJwk(s) / requireAuth gates） |
| lint | ✅ `npx eslint functions/utils/jwt.ts` exit 0（全量 lint 列 code-stage gate） |
| 無新增檔案 / 無 caller/test/config diff | ✅ `git diff --stat` 僅 jwt.ts 1 檔（+20/−14） |
| working tree revert clean | ✅ `git restore` 後 `git status --porcelain` 空、HEAD `e71dda3` |

**輔助 probe（standalone CLI tsc，非 leaf 量測）**：① `Record<string, unknown>` → `JWTPayload` 與 `new SignJWT(record)` 在 SNC-off 下 exit 0（assignable）；② `Awaited<ReturnType<typeof verifyJwt>>` = `JWTPayload`、`signJwt` = `string`（`const x: never = v` 錯誤訊息揭示法）— 證明 return 面今天已 typed、本 PR 不改變它。

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，11 編輯點，+20/−14）**：
```diff
 import { SignJWT, importJWK, jwtVerify, decodeProtectedHeader } from 'jose'
+import type { JWTPayload, KeyLike } from 'jose'
+
+// env 參數窄化（鏡像各函式實讀鍵）：unit test 以 partial fake env 呼叫
+// （tests/jwt.test.ts rotation 案例不帶 JWT_PUBLIC_KEY），標 full Env 會 tests-leaf TS2345
+type JwtSignEnv = Pick<Env, 'JWT_PRIVATE_KEY'>
+type JwtVerifyEnv = Partial<Pick<Env, 'JWT_PUBLIC_KEYS' | 'JWT_PUBLIC_KEY'>>
 
 // 模組級快取
-let _signingKey   = null
-let _cachedKid    = null
-let _verifyingMap = null   // Map<kid, CryptoKey>，含一個 'default' fallback
+let _signingKey: KeyLike | Uint8Array | null = null
+let _cachedKid: string | null = null
+let _verifyingMap: Map<string, KeyLike | Uint8Array> | null = null   // Map<kid, CryptoKey>，含一個 'default' fallback
 
-async function getSigningKey(env) {
+async function getSigningKey(env: JwtSignEnv) {
 
-function readPublicJwks(env) {
+function readPublicJwks(env: JwtVerifyEnv) {
 
-async function getVerifyingMap(env) {
+async function getVerifyingMap(env: JwtVerifyEnv) {
 
-async function getVerifyingKey(env, kid) {
+async function getVerifyingKey(env: JwtVerifyEnv, kid: string | null) {
 
-export async function signJwt(payload, expiresIn, env, opts: { audience?: string | null } = {}) {
+export async function signJwt(payload: JWTPayload, expiresIn: string, env: JwtSignEnv, opts: { audience?: string | null } = {}) {
 
-export async function verifyJwt(token, env, opts: { audience?: string | string[] | null; issuer?: string | null } = {}) {
+export async function verifyJwt(token: string, env: JwtVerifyEnv, opts: { audience?: string | string[] | null; issuer?: string | null } = {}) {
 
-export function getPublicJwk(env) {
+export function getPublicJwk(env: JwtVerifyEnv) {
   return { kty, crv, x, y, kid, use: use ?? 'sig', alg: alg ?? 'ES256' } as
-    { kty; crv; x; y; kid; use; alg; d?: undefined }
+    { kty: string; crv: string; x: string; y: string; kid: string; use: string; alg: string; d?: undefined }
 
-export function getPublicJwks(env) {
-  const stripWs = s => typeof s === 'string' ? s.replace(/\s+/g, '') : s
+export function getPublicJwks(env: JwtVerifyEnv) {
+  const stripWs = (s: unknown) => typeof s === 'string' ? s.replace(/\s+/g, '') : s
 
-  })) as Array<{ kty; crv; x; y; kid; use; alg; d?: undefined }>
+  })) as Array<{ kty: string; crv: string; x: string; y: string; kid: string; use: string; alg: string; d?: undefined }>
```
（alg `'ES256'`、iss `'https://chiyigo.com'`、預設 aud `'chiyigo'`、jti 補發、kid fallback、快取邏輯、所有 throw 字串、所有既有註解 **byte-identical**；新增 = 1 行 type-only import + 2 行 why-comment + 2 行 type alias；TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `e71dda3` `--report` 現況：errorCount **989** / errorFiles **110** / cleanFiles **194** / sourceFilesTotal 304（spike 前實測）。
- 本 PR 後 current ratchet state：errorCount **989 → 954**（−35）、errorFiles **110 → 109**、cleanFiles **194 → 195**（spike 實測值，非預測）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 型別標註 + type-only import + 2 行註解，TS erase / esbuild strip 後 runtime 行為不變；targeted unit 52/52 已在標註狀態實跑（含 rotation 多 key 與 cache reset 路徑）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 989，零殘留。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（spike tests-leaf forced exit 0 實證）。
- 52 例直接覆蓋（2 檔）：`tests/jwt.test.ts`（簽驗 roundtrip / tamper / aud 矩陣 / jti 唯一性與尊重自帶 / ver passthrough / kid header / rotation 多 key / getPublicJwk(s) 無 `d`）+ `tests/auth.test.ts`（requireAuth scope/status/aud gates）。
- **未覆蓋、不宣稱**：13 個 production 簽發端點的 integration suites 不在 targeted 集（CI 全量跑會覆蓋）；`getVerifyingKey` 的 `__default__` fallback 無獨立直接測例（本 PR 不動該邏輯）。

## 驗證計劃（coding 階段，CODING_ALLOWED 後）

> ⚠ ratchet/tsc 量測前清 `.tscache`（PowerShell `Remove-Item -Recurse -Force .tscache`）。**PowerShell 用 `$env:RATCHET_BASE_REF='e71dda3'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='e71dda3'; npm run typecheck:ratchet` green（989→954 / 110→109 / 194→195）。
- `npm run lint` green（全量）、`npm run build:functions` green（同時驗 type-only import erase）。
- filtered forced tsc：jwt.ts 0 殘留 + `tsc -b tsconfig.tests.json --force` exit 0。
- targeted test：`npx vitest run tests/jwt.test.ts tests/auth.test.ts`（52 例；jwt.test flake 就 rerun）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（人審 `git diff -- functions/utils/jwt.ts`）；超出 = scope creep = Gate fail。

## 流程定位

- Dual Gate Workflow：`SPEC_APPROVED`（owner 當輪明示）→ `PLAN_SELF_REVIEW_CLEAN` → A1 spike（owner 預授權前置）→ 本 doc commit feature branch → **ChatGPT Architecture Gate** → **Codex Plan Gate**（迭代審到過）→ `CODING_ALLOWED` → coding（凍結 diff 逐行重放）→ 實跑 gates → 自審 → Codex Code Gate → owner 明示同意才 squash-merge。
- merge 後監看 CI+Deploy（撞 `jwt.test` flake 就 rerun）；jwt.ts 無自身 endpoint、`/.well-known/jwks.json` 可作 credential-free smoke（GET 200 + keys 陣列無 `d`）。
- merge 後 memory 收尾：receipt + **校正 PR-2u scout 註記**（verifyJwt return 實為 `Promise<JWTPayload>` 而非 any；requireAuth `user` 的 any 性歸 auth.ts 自身 pattern）。
- **下一刀（owner 排序，開工前再確認）**：crypto / siwe / scopes / rate-limit 同 chain；`_middleware`〔最後、blast radius 最大〕。kyc.ts (143) 經本次 scout 確認為 `user: null` TS7018（SNC-off null-widening、與 jwt typing 無關）→ 歸 auth.ts/kyc 棒處理，非本 PR 可消。
