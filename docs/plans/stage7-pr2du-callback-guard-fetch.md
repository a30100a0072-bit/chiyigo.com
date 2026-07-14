# Stage 7 PR-2du — 棒5a：`callback.ts` File-narrow guard + exchangeCode 標型 + provider fetch 韌性

**SPEC**: `STAGE7_OAUTH_CALLBACK_RUNTIME_HARDENING`（owner `SPEC_APPROVED_WITH_LOCKS` 2026-07-14；SPEC 全文 `~/Desktop/chiyigo-packets/stage7-bang5-spec-draft.md`）
**狀態**: `PLAN_DRAFT`
**base**: `274a37b428e...` → 完整 SHA `274a37b4d45482842b1adbcf36d95f52b82fb2c8`（= main = origin/main、#146 PR-2dt 棒4-type SHIPPED 後；**IMMUTABLE-BASE**）
**worktree**: `C:/Users/User/Desktop/chiyigo-pr2du`、branch `stage7-pr2du-callback-guard-fetch`（`SINGLE_WRITER_READY` 已達成）
**級別**: **L3**（runtime/security；SPEC-C-9 明令棒5 重走完整 L3 SPEC + Plan Gate）
**高風險領域加碼層**: **觸發**（外部 API 呼叫 · 非冪等 `authorization_code` 單次核銷 · retry/timeout 策略）→ 本 plan §3 先出 state machine / failure mode / idempotency / retry+timeout 四件

> ⚠⚠ **這是行為變更 PR（runtime delta）**，與剛結案的 PR-2dt（棒4-type、byte-identical）**性質相反**：
> - **SPEC-C-4 / byte-identical 紀律不適用**（emit 必然改變）。
> - 驗證改為 **SPEC-D-5：每個新 reject path 必須有 negative test 在 pre-fix 真的 RED**（[[feedback_regression_test_must_lock_exact_failure]]）+ happy path 維持綠。
> - 棒5b（PR-2dv、LINE id_token hardening）**不在本 PR**；SPEC-D-12 禁交錯實作 / 禁共用未提交 diff。

---

## 1. Scope 與 locks

### 1.1 SCOPE（SPEC-D-1）

| 類別 | 檔 | 變更 |
|---|---|---|
| **production source** | `functions/api/auth/oauth/[provider]/callback.ts` | guard + exchangeCode 標型 + fetch timeout/retry |
| **production source** | `types/env.d.ts` | **additive +1 optional key** `OAUTH_FETCH_TIMEOUT_MS?: string`（零 JS emit；先例 = PR-2dr 棒3-env #144 additive +10 key） |
| **test** | `tests/integration/oauth-callback-guard-fetch.test.ts` | **新檔**：14 cases（DELTA_RED 8 + INVARIANT_GREEN 6、§6） |
| **治理文件** | 本 plan doc | companion |

**明禁動**（SPEC-D-1/2/6/7/8/12）：`oauth-providers.ts` · `init.ts` · `bind-email.ts` · `verifyLineIdToken` / `verifyGoogleIdToken` / `verifyAppleIdToken` **body** · **`fetchProfile` 內的 id_token 驗證區塊逐字不動**〔Apple early-return `L529-532` · Google `verifyGoogleIdToken` 呼叫 `L541` · LINE `verifyLineIdToken` 呼叫 `L549` + LINE nonce 檢查 `L550-552` · LINE email 注入 `L562-563` · Google claim 覆寫 `L565-571`〕——本 PR 只在**其後**的 `fetch(cfg.userInfoUrl)`（L556-560）包 retry loop，**retry loop 絕不涵蓋任何 verify\*IdToken**（self-review #1；SPEC-D-12 邊界，LINE nonce 區 = PR-2dv 目標）· `callback.ts:61` CT 子字串守門 · `oauthError`（L73）· **禁新建 `functions/utils/*`**。

### 1.2 SPEC Locks（**SPEC-D-1..12** = owner `SPEC_APPROVED_WITH_LOCKS` 2026-07-14）

| Lock | 約束 | 本 PR 對映 |
|---|---|---|
| **SPEC-D-1** | source allowlist = `callback.ts` + `types/env.d.ts`（+ test + plan doc） | §1.1 |
| **SPEC-D-2** | **禁擴散到 Google / Apple 的 nonce·exp 硬化** → 另棒（NF-3） | 三個 `verify*IdToken` body 逐字不動 |
| **SPEC-D-3** | no-weakening：新增檢查只能 reject 更多 | guard 是**純 additive 收斂**；fetch timeout 只增加失敗路徑 |
| **SPEC-D-4** | **ratchet post = `381 / 17 / 318`、`REMOVED=4 / ADDED=0`**；新 code 每個 function param 必須顯式標型；baseline `1119/175` 凍結禁 `--update`；**相對 `274a37b4` 任何漂移 → halt** | §4 REPLAY |
| **SPEC-D-5** | **byte-identical 不適用**；驗收分兩類（Arch R2）：**`DELTA_RED`**（每個新增行為 delta）base RED→candidate GREEN；**`INVARIANT_GREEN`**（no-weakening / policy-preservation）base GREEN∧candidate GREEN。**禁**把 invariant 測試逼成 pre-fix RED（邏輯不可能）。§6 = 14 cases（DELTA_RED 8 + INVARIANT_GREEN 6） | **§6** |
| **SPEC-D-6** | **禁新建 `functions/utils/*`**（coverage 80% 門檻，NF-7） | fetch helper 全 module-local |
| **SPEC-D-7** | `oauthError`（L73）不動 | 明示不夾帶 |
| **SPEC-D-8** | **`callback.ts:61` CT 子字串守門明禁動** | 動它 ⇒ guard 變 runtime-unreachable ⇒ T1/T2 失去 RED 著力點 ⇒ Gate fail |
| **SPEC-D-9** | **retry 鎖定條件**：token exchange **retry=0 永不重試**；userinfo GET **max 1 retry**（總 2 attempts）、固定 backoff、**只 retry**〔network / timeout（**fetch 階段 或 body-read 階段**，Arch R1）/ resolved 5xx〕、**絕不 retry**〔4xx / 429 / malformed body〕；**retry loop 只包 `fetch(cfg.userInfoUrl)+res.json()`、不含任何 verify\*IdToken**（self-review #1）；四個 transient trigger（5xx / fetch-timeout / body-timeout / network）**各有 test**（T5 / T8 / T8b / T9），耗盡端 T5b 鎖 `MAX_ATTEMPTS=2`，次數以 `fetchCalls.length` 機械斷言 | §3.3 / §3.4 / §4.2 / §6 |
| **SPEC-D-10** | `[provider]` 路徑陷阱：git pathspec 一律 `:(literal)functions/api/auth/oauth/[provider]/callback.ts`；`code-self-review.mjs` `REPO_PATH_PATTERN` 拒 `[` ⇒ **faithfulness packet 必人工補完整 hunk + 機械 `--name-status`** | §4 |
| **SPEC-D-11** | 單一寫者 + 獨立 worktree；跑機械 gate 前必 `npm ci` | ✅ 已達成 |
| **SPEC-D-12** | PR-2du 與 PR-2dv 禁交錯 / 禁共用未提交 diff；2du 先 merge，2dv 從 post-2du main 重建 | — |

### 1.3 owner OD 裁決（SPEC §5，逐字對映）

| OD | 裁決 |
|---|---|
| **OD-5-SPLIT** | 2 PRs：**PR-2du**(guard+fetch) → **PR-2dv**(LINE) |
| **OD-5-RETRY** | timeout + **最多 retry 1 次**（附鎖定條件 → SPEC-D-9） |
| **OD-5-CT-GATE** | **不修** `callback.ts:61`、記 backlog |
| **OD-5-TIMEOUT-IDIOM** | 沿 repo 既有手動 `AbortController` idiom + **env-overridable `OAUTH_FETCH_TIMEOUT_MS`**；**明禁 `AbortSignal.timeout()`** |
| **OD-5-TIMEOUT-MS** | token **8000ms** · userinfo **5000ms/attempt** · backoff **250ms** |
| **OD-5-SCOUT-OVERLAY** | 獨立 throwaway worktree（**已執行**，§5） |

---

## 2. 結構背景：為何需要 guard（PR-2dt Path C 的 descope 由來）

`callback.ts` 的 code/state 提取有兩條分支：

```
L61  POST ∧ contentType.includes('application/x-www-form-urlencoded')   ← 子字串比對（SPEC-D-8 明禁動）
       → form.get('code'|'state')  →  FormDataEntryValue = File | string
L67  else
       → url.searchParams.get(...)  →  string | null
```

- `code` / `state` 在 L76 的推斷型別 = `File | string | null`（evolving-let 收斂兩分支）。
- 標 `exchangeCode({ code: string })` → call site L120 觸 **TS2322**。改標 `code: FormDataEntryValue` → 錯搬家成 TS2345 ×2（`URLSearchParams` ctor）。
- ⇒ **零-assertion 的 type-only 解不存在**（PR-2dt §1.3，經 ① ChatGPT Arch + ② Codex Plan 雙審坐實）→ owner 裁 Path C：type-only 部分（23）走 PR-2dt，**guard（runtime delta）descope 到本棒**（SPEC-C-3/8/9）。

**File 分支 runtime 可達 + 後果，已由 workerd probe 機械坐實**（§5.B）——**不是推斷**。

---

## 3. 高風險領域加碼層四件（L3 要求：先出這四件才 code）

### 3.1 State transition

```
[REQUEST IN]
 ├─ POST ∧ CT.includes('application/x-www-form-urlencoded')     ← L61（不動，SPEC-D-8）
 │      → request.formData() → code/state/oauthError : FormDataEntryValue (File | string)
 └─ else
        → URL.searchParams.get(...)                             → string | null
                    │
              [EXTRACTED]
                    ├─ oauthError truthy                          → htmlError(400)               [terminal，既有，不動]
                    ├─ ✨ typeof code  !== 'string'                → htmlError(400) 缺少必要參數   [terminal，新，fail-closed]
                    ├─ ✨ typeof state !== 'string'                → htmlError(400) 缺少必要參數   [terminal，新，fail-closed]
                    ├─ !code ∨ !state                             → htmlError(400)               [terminal，既有]
                    └─ else ⇒ code: string, state: string         → [STATE_CONSUME]
                    │
              [STATE_CONSUME]  DELETE FROM oauth_states … RETURNING     ← 原子一次性核銷（既有，不動）
                    ├─ no row → audit(oauth.callback.fail / invalid_state) + htmlError(400)      [terminal]
                    └─ row    → [TOKEN_EXCHANGE]
                    │
              [TOKEN_EXCHANGE]  POST cfg.tokenUrl（grant_type=authorization_code）
                    │             ⚠️ 非冪等：code 於 IdP 端單次核銷
                    ├─ ✨ timeout 8000ms → abort → catch → audit(token_exchange_failed) + htmlError(400)
                    ├─ ✨ retry = 0（永不；SPEC-D-9 ①）
                    ├─ !res.ok → throw → catch → audit(token_exchange_failed) + htmlError(400)   [terminal]
                    └─ ok → [ID_TOKEN_VERIFY]
                    │
              [ID_TOKEN_VERIFY]  fetchProfile 前段（**SPEC-D-2 逐字不動、NOT in retry loop**）
                    ├─ apple → verifyAppleIdToken（含 jose JWKS fetch，jose default 5000ms）
                    │             → payload = user info ⇒ **early return，永不到 [USERINFO_FETCH]**（callback.ts:532）
                    │             ⚠️ Apple profile 完全靠此步；**本 PR 的 userinfo timeout/retry 對 Apple 不適用**
                    ├─ google → verifyGoogleIdToken（含 jose JWKS fetch，jose default 5000ms）→ claims → [USERINFO_FETCH]
                    ├─ line  → verifyLineIdToken（HMAC-SHA256，**無 JWKS**）+ nonce 檢查（L550-552，PR-2dv 目標）→ [USERINFO_FETCH]
                    │             verify\*IdToken throw（sig/nonce/exp）→ 不進 retry → catch → htmlError(400)  [terminal]
                    └─ discord / facebook（無 id_token）→ [USERINFO_FETCH]
                    │
              [USERINFO_FETCH]  GET cfg.userInfoUrl（Bearer）      ✅ 冪等純讀（apple 不到此）
                    │             ✨ retry loop **只包此 fetch + res.json()**（self-review #1；不含上方 verify）
                    ├─ ✨ timeout 5000ms / attempt，**timer 涵蓋 fetch + body-read**（Arch R1）
                    ├─ ✨ attempt 1 失敗且 transient → backoff 250ms → attempt 2；transient =
                    │       〔timeout（fetch 階段 **或** body-read 階段，didTimeout flag）／ fetch-stage rejection（network 等，res 未建立）／ resolved 5xx〕
                    ├─ ✨ 4xx（含 401/403）／ 429 → 立即終止，**不重試**；**malformed body（非 timeout 的 json reject）→ terminal、不重試**
                    ├─ 2 次皆敗 → throw → catch → audit(profile_fetch_failed) + htmlError(400)   [terminal]
                    └─ ok → normalizeProfile → 既有 elevation / binding / login 流程（**逐字不動**）
```

**未被本 PR 觸及的下游狀態**（逐字不動、byte-level 保全）：`[ID_TOKEN_VERIFY]` 全段（三個 verify\*IdToken + LINE nonce/email + Google claim 覆寫，SPEC-D-2/D-12）· `elevation` 分支（provider_mismatch / reverification_required / one-time exchange code）· `is_binding` factor-add（grant CAS consume + identity INSERT 同 batch）· 信箱碰撞守門（trustEmail × email_verified）· user/identity 建立 · risk score · access/refresh token 簽發 · cookie · HTML bridge。

### 3.2 Failure modes

| # | 失敗模式 | 現況（**實測**） | PR-2du 後 |
|---|---|---|---|
| F1 | poisoned CT → `code` = File | 400，但 **`fetchCalls = ["https://oauth2.googleapis.com/token"]`**（白打 provider 外呼）+ **state row 被燒**（survived=false） | 400 · **零外呼** · **state row 未燒**（guard 在核銷之前） |
| F2 | poisoned CT → `state` = File | **`THREW = D1_TYPE_ERROR: Type 'object' not supported for value '[object Object]'`**、**`status = null`（handler 不回 Response）** ⇒ prod **未捕捉例外 → 500** | 400 htmlError · **無 throw**（乾淨 fail-closed） |
| F3 | tokenUrl 掛住不回應 | **無限等**（違全域 §程式碼要求） | 8000ms → abort → htmlError(400) + audit |
| F4 | userInfoUrl 掛住不回應 | **無限等** | 5000ms/attempt → abort → retry ×1 → htmlError(400) + audit |
| F5 | userInfoUrl 暫時 5xx | 立即 400（使用者需重跑整段 OAuth：重拿 state + code） | backoff 250ms → attempt 2 → 多數 transient 自癒 |
| F6 | tokenUrl 暫時 5xx / timeout | 立即 400 | **維持立即 400、不重試**（§3.3）+ 註解說明取捨 |
| F7 | userInfoUrl 回 401/403（access_token 壞） | 400 | 400 · **不重試**（重試無用） |
| F8 | userInfoUrl 回 429 | 400 | 400 · **不重試**（立即重試只會加劇） |
| F9 | 合法 Apple form_post（urlencoded） | 正常（但**全 repo 零測試**，NF-5） | 正常 + **首次被測試鎖住**（T3） |
| F10 | Google/Apple id_token JWKS fetch 掛住（cold cache） | jose default **5000ms** timeout（非無限等；`createRemoteJWKSet` 未顯式設） | **不變**（SPEC-D-2 禁動 verify body ⇒ **本 PR 不硬化此步**；仍靠 jose default 5s）→ NB-7 backlog |

> ⚠ **Apple 的 profile 取得 = 100% 靠 `verifyAppleIdToken`（含 JWKS，callback.ts:532 early-return），無 userinfo GET**（self-review #3）⇒ 本 PR 的 userinfo timeout/retry（F4/F5/F7/F8）**對 Apple 不適用**；Apple 的 profile-side 韌性仍靠 jose default 5s JWKS timeout（F10）。**token exchange timeout（F3、8000ms）對含 Apple 的所有 provider 皆生效**（exchangeCode 不分 provider）。

### 3.3 Idempotency 策略（**本 PR 的核心正確性論述**）

| 外呼 | 冪等性 | retry policy | 理由 |
|---|---|---|---|
| `POST cfg.tokenUrl` | **❌ 非冪等** | **retry = 0（永不）** | `authorization_code` 在 IdP 端**單次核銷**。逾時後**執行結果未知**（可能未送達、亦可能已送達並核銷但回應在網路上遺失）⇒ **重送不安全**（Arch #3 措辭修正：非「必然失敗」而是「結果不確定、不可安全重送」）；且部分 IdP 把 code 重用視為攻擊訊號（可能觸發 client 封鎖）。**fail-fast 才正確**：使用者重跑 OAuth（拿新 code）成本低且語意乾淨。 |
| `GET cfg.userInfoUrl` | **✅ 冪等**（同 Bearer、純讀、無副作用） | **max 1 retry**（總 2 attempts） | 目前一個 transient blip 就殺掉整個登入（使用者須重跑整段 OAuth dance）。一次有界 retry 成本 ~250ms、**無安全語意**（同一個已驗證的 access_token 重讀同一個資源）。 |
| `createRemoteJWKSet`（jose） | ✅ | **不動**（jose 內建） | 最小 diff（[[feedback_security_boundary_pr_first_do_no_harm]]）；列 §8 backlog |

**oauth_states 一次性核銷不受影響**：guard 落在 `[EXTRACTED]`、**早於** `[STATE_CONSUME]` ⇒ 被 guard 擋下的請求**不會**核銷任何 state row（F1 實測從 survived=false → true 即此）。

### 3.4 Retry + Timeout 策略（named constants，含單位）

```ts
const TOKEN_FETCH_TIMEOUT_MS_DEFAULT   = 8_000   // provider token endpoint（沿 send-verification.ts FETCH_TIMEOUT_MS = 8000）
const PROFILE_FETCH_TIMEOUT_MS_DEFAULT = 5_000   // provider userinfo endpoint（每次 attempt）
const PROFILE_MAX_ATTEMPTS             = 2       // 1 次初試 + 最多 1 次 retry（SPEC-D-9 ②）
const PROFILE_RETRY_BACKOFF_MS         = 250
```

- **終止條件**：`attempt > PROFILE_MAX_ATTEMPTS` ⇒ throw；4xx / 429 ⇒ **立即** throw（不進 backoff）。**無無限 retry**。
- **default 最壞路徑（有界，含 JWKS；self-review #3）**：
  - **LINE / discord / facebook（無 JWKS）**：8000（token）＋ 5000 × 2（userinfo）＋ 250（backoff）≈ **18.25s**。
  - **Google（cold-cache JWKS，本 PR 未包 timeout，jose default 5s）**：8000（token）＋ 5000（JWKS）＋ 5000 × 2（userinfo）＋ 250 ≈ **~23.25s**。
  - **Apple（無 userinfo GET）**：8000（token）＋ 5000（JWKS，jose default）≈ **~13s**。
  - ⇒ default 全域最壞 bound ≈ **~23.25s（Google）**（先前寫的 18.25s 實為 LINE/userinfo 路徑）。
- **⚠ override-max 最壞路徑（round-2 tier3：env-override 放大）**：`OAUTH_FETCH_TIMEOUT_MS` 同時覆寫 token + userinfo、userinfo 再 ×2 attempts ⇒ 放大。以 clamp 上限 `FETCH_TIMEOUT_MAX_MS = 15_000`（§4.3；**已從 30_000 下修正為此因**）：Google override-max = 15000（token）＋ 5000（JWKS 不受 override）＋ 15000×2（userinfo）＋ 250 ≈ **~50.25s**。**⚠ 此 ~50s 非「Cloudflare wall-clock / 524 硬上限」契約**（Arch #5 修正：CF 官方文件——只要下游客戶端維持連線，incoming Worker request 無硬性 wall-clock 上限〔developers.cloudflare.com/workers/platform/limits〕）⇒ **以 latency budget 處理**：OAuth 使用者體驗 / 上游代理 timeout / 瀏覽器等待 / 營運 SLO 風險，而非平台強制中斷。clamp 目的＝防「禁無限等」被打破 + 收斂 override 放大（30s-clamp 的 ~95s → 15s-clamp 的 ~50s）；default 路徑 ~23s 才是常態。
- **env override（test/ops escape hatch）**：`OAUTH_FETCH_TIMEOUT_MS` **同時**覆寫 token + userinfo（沿 `utils/email.ts` `RESEND_TIMEOUT_MS` 先例）；**不覆寫 jose JWKS timeout**（SPEC-D-2 禁動 verify body）。**無此 override，T4/T8 只能真等 8/5 秒**（vitest `testTimeout: 20_000`）⇒ override 是可測性的**必要條件**。主要用途＝test（設極小值）；ops 若上調須知 §override-max 放大。

---

## 4. 型別決策的 SSOT 對齊（每個決策的真相源）

### 4.1 `exchangeCode` destructured param（清 4 × TS7031；**§5.A 已實測 REMOVED=4 / ADDED=0**）

```ts
async function exchangeCode({ cfg, code, code_verifier, redirect_uri, timeoutMs }: {
  cfg: ReturnType<typeof getProvider>
  code: string
  code_verifier: string | null
  redirect_uri: string
  timeoutMs: number
}) {
```
- `cfg: ReturnType<typeof getProvider>` — **沿用 PR-2dt 已 shipped 的 OD-4-CFG-NULL**（含 `| null`；`strictNullChecks:false` 不 cascade；strict:true 浪次補 narrow）。`getProvider` 已於 L23 import ⇒ **零新 import**。
- `code: string` — **由本 PR 的 guard 保證**（guard 之後 `code` narrow 成 `string`）。這正是 PR-2dt 無法清這 4 個的結構原因。
- `code_verifier: string | null` / `redirect_uri: string` — 來自 `stateRow`（D1 `.first()`）destructure。**先例**：PR-2dt 的 `fetchProfile(…, expectedNonce: string | null)` 取自**同一個** `stateRow` destructure 且 ADDED=0 ⇒ 本標型同構、已由 §5.A 機械坐實。
- `timeoutMs: number` — **新增參數**（least-privilege：只傳所需的 ms，**不傳整個 `env`**；對映 [[feedback_util_env_param_pick_not_full_env]]）。
- **零 assertion、零新 import、零新 named/exported type。**

**call-site 串接（完整 diff 面，FULL-DIFF-ALLOWLIST）**：`handle()` 內（持有 `env`）算兩個 timeout 一次、往下傳：
```ts
  const tokenTimeoutMs   = parseFetchTimeoutMs(env, TOKEN_FETCH_TIMEOUT_MS_DEFAULT)
  const profileTimeoutMs = parseFetchTimeoutMs(env, PROFILE_FETCH_TIMEOUT_MS_DEFAULT)
  // callback.ts:119 exchangeCode({ cfg, code, code_verifier, redirect_uri })       → + timeoutMs: tokenTimeoutMs
  // callback.ts:130 fetchProfile(provider, cfg, providerTokens, expectedNonce)     → + profileTimeoutMs
```
兩個 call site（L119 / L130）各尾綴新 arg；`OAUTH_FETCH_TIMEOUT_MS` env override 同時作用於兩者（§4.3）。

### 4.2 `fetchProfile` 新增 `timeoutMs` + **retry loop 精確邊界（self-review #1）**
```ts
async function fetchProfile(provider: string, cfg: ReturnType<typeof getProvider>,
  tokens: { id_token?: string; access_token?: string }, expectedNonce: string | null,
  timeoutMs: number) {
```
前 4 個 param **沿用 PR-2dt shipped 標型逐字不變**；僅尾綴 `timeoutMs: number`。

**⚠ retry loop 精確邊界（SPEC-D-9 / SPEC-D-12；self-review #1 accepted）**：`fetchProfile` body 內，**`[ID_TOKEN_VERIFY]` 全段（apple early-return / verifyGoogle / verifyLine + nonce + email 注入 + Google claim 覆寫，L529-571 中的驗證部分）逐字不動、且 NOT in retry loop**；retry 邏輯抽成 **callback.ts module-local helper `fetchUserInfoWithRetry`**（不新建 `functions/utils/*`、SPEC-D-6；與既有 module-local `exchangeCode`/`fetchProfile` 同層 idiom），只圈起 `fetch(cfg.userInfoUrl)` + 其 `res.json()`（callback.ts L556-560）：
```ts
// module-local helper（新增；每個 param 顯式標型、return 由 res.json() 推斷 Promise<any>——同 exchangeCode/fetchProfile）
async function fetchUserInfoWithRetry(url: string, accessToken: string | undefined, timeoutMs: number) {
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController()
    let didTimeout = false
    const timeoutId = setTimeout(() => { didTimeout = true; ctrl.abort() }, timeoutMs)  // ⭐ phase flag（Arch R1）
    let res
    let failure: unknown
    let failed = false
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: ctrl.signal })
      if (res.ok) return await res.json()          // body-read **在 timer 內**（F1；timer 涵蓋 fetch + body）；return any（無 TS7034，註 b）
    } catch (err) {
      failed = true; failure = err                 // 到達者 = fetch reject（res===undefined）或 res.json() reject（res 已設）
    } finally {
      clearTimeout(timeoutId)                       // 每 attempt 恰一次（涵蓋 return/throw/正常）
    }
    if (failed) {
      // transient = timeout(任一階段、didTimeout) ∨ network(fetch 階段、res===undefined)；malformed body(res 已設 ∧ ¬didTimeout) = terminal
      if ((didTimeout || res === undefined) && attempt < PROFILE_MAX_ATTEMPTS) { await sleep(PROFILE_RETRY_BACKOFF_MS); continue }
      throw failure
    }
    // res 已設且 !res.ok（resolved 4xx/5xx）
    if (res.status >= 500 && attempt < PROFILE_MAX_ATTEMPTS) { await sleep(PROFILE_RETRY_BACKOFF_MS); continue }  // 5xx transient
    throw new Error(`userInfo ${res.status}`)      // 4xx / 429 / 最終 5xx → terminal、不 retry
  }
}

// fetchProfile 內：原 `const raw = await (await fetch(...)).json()`（L556-560）→ 換成一行、其餘逐字不動
  const raw = await fetchUserInfoWithRetry(cfg.userInfoUrl, tokens.access_token, timeoutMs)   // const、any 推斷（無 TS7034）
  // ... 既有 LINE email 注入（L562-563）/ Google claim 覆寫（L565-571）逐字不動 ...
```
- **⚠ 核心不變式（分類靠「phase flag + 結構」、**零 error 形狀 introspection**；round-2 抗脆弱 + Arch R1 body-timeout）**：timer callback 設 `didTimeout=true` 再 `ctrl.abort()`；catch 包 **fetch + `res.json()`**（故 body-stall 的 timeout 也進 retry，**Arch R1 修正**）。retry 判定 = **`didTimeout || res === undefined`**：
  - `didTimeout` 由**我方 timer** 設 ⇒ 不依賴 workerd/mock 的 error shape（消 round-2 T8 mock 契約矛盾 + T9 `TypeError` 未證 + round-1 R-1 abort 分類）；**mock 只需 honor abort 即 reject（任何形狀）**。
  - `res === undefined` 純結構（fetch 階段 vs body 階段）：**fetch-stage rejection**（res 未設）→ transient。⚠ **精確語意（Arch R2-2b）**：`res===undefined` 證明的是「fetch 在回 Response 前 reject」，**不必然只有 network**（亦含無效 URL / header 建構等）——但 `cfg.userInfoUrl` 是 provider 常數（oauth-providers.ts 硬編、受控設定）、header 為 `Bearer <token>` 受控 ⇒ **fetch-stage rejection 實務上＝network/abort**；即便真是設定錯，也只是有界 1-retry 後 terminal（快速失敗兩次、無害）。**body-json-reject 且非 timeout（malformed）→ terminal**（不誤 retry 壞 body）。
  - 4 種 reject 全覆蓋：fetch-timeout〔didTimeout✔〕· fetch-stage rejection〔res===undefined✔〕· body-timeout〔didTimeout✔，**Arch R1 新納入 retry**〕· body-malformed〔兩者皆 false → terminal，**Arch R2 加 T11 鎖**〕。
- **註 a — bare `ctrl.abort()`（無 reason）**：分類不靠 abort 形狀（靠 didTimeout），bare abort **只為不洩漏 config**——token-exchange catch（callback.ts:122）`htmlError(...${err.message})`，bare abort 的 err.message 無 `${timeoutMs}ms`。
- **註 b — 避 `let raw`/`let body` 觸 TS7034**：`return await res.json()` **直接 return**（不經未初始化 `let`）；`const raw = await fetchUserInfoWithRetry(...)` 保留 any 推斷 ⇒ 零 TS7034/7005。`let res`（`Response|undefined` evolving、concrete 非 any）/ `let failure: unknown`（顯式標型）/ `let failed`（boolean）皆不觸 TS7034。**⚠ CODE stage 必 fresh replay 坐實 ADDED=0**（overlay scout 未含此 refactor、§5.A）。
- **四 transient trigger + 一 terminal 各有 test**：5xx = resolved `res.status>=500`（T5 rescue / T5b 耗盡）；fetch-timeout（T8）；**body-timeout（T8b、Arch R1）**；fetch-stage rejection（T9）；**malformed body = terminal（T11、Arch R2、INVARIANT_GREEN）**。**T8/T8b/T9 的 mock 只需 honor abort/reject（任何形狀）**（見 §6 mock 契約）。
- **token exchange（exchangeCode）同樣 bare `abort()`**（retry=0、單發無 loop；沿 `email.ts` 單發 idiom + bare abort、message 無 config leak；catch 在 callback.ts:122）。
- **`sleep` = 內聯 `await new Promise(r => setTimeout(r, ms))`**（module-local、不新建 util、SPEC-D-6；沿 `audit-log.ts:119` idiom）。`PROFILE_MAX_ATTEMPTS`(=2) / `PROFILE_RETRY_BACKOFF_MS`(=250) = module-level named const（§3.4）。

### 4.3 timeout 解析（**逐條對齊 `utils/email.ts` 既有 idiom**）

| email.ts 既有寫法 | 本 PR 對映 |
|---|---|
| `const RESEND_TIMEOUT_MS_DEFAULT = 5_000`（named const、`_` 分隔） | `TOKEN_FETCH_TIMEOUT_MS_DEFAULT = 8_000` / `PROFILE_FETCH_TIMEOUT_MS_DEFAULT = 5_000` |
| `parseTimeoutMs(env)`：`raw == null \|\| raw === ''` → default；`Number(raw)`；`!Number.isFinite(n) \|\| n < 10` → default；`Math.floor(n)` | `parseFetchTimeoutMs(env: Env, fallbackMs: number)` — **同套守門 + 補上限 clamp（self-found A）**：`n < 10` → fallback（下限）**＋ `Math.min(Math.floor(n), FETCH_TIMEOUT_MAX_MS)`（上限，`FETCH_TIMEOUT_MAX_MS = 15_000`）**。⚠ `email.ts` 原 `parseTimeoutMs` **只有下限、無上限** ⇒ 若照抄，`OAUTH_FETCH_TIMEOUT_MS=99999999` 會把「禁無限等」baseline 打回原形。⚠ **上限值 = 15_000（非 30_000）**：override 同時作用 token+userinfo、且 userinfo ×2 attempts ⇒ 放大係數大（§3.4 override-max bound）；15s 上限使 override-max ≈ 15+5(JWKS)+15×2+0.25 ≈ **50s**（round-2 tier3） |
| `ctrl.abort(new Error(\`Resend timeout after ${timeoutMs}ms\`))` — abort 帶**描述性 Error** | ⚠ **刻意分歧**：本 PR 用 **bare `ctrl.abort()`**（無 reason）→ err.message 無 `${timeoutMs}ms` config 洩漏（token-exchange catch `htmlError(...${err.message})` 會回 client）。**retry 分類不靠 abort 形狀**——靠 **`didTimeout` phase flag + `res` 是否已建立**（§4.2 核心不變式：**catch 包 fetch + `res.json()`**、分類 = `didTimeout \|\| res===undefined`；Arch R2-2a 修正舊敘述「catch 只包 fetch」）⇒ 與 email.ts 帶 reason 無功能衝突、純為 no-leak |
| `return await res.json()`（**非** `return res.json()`）+ 註解「await 拉進 try：success path 也要等 body 解析完才 clearTimeout」 | **相同**（[[feedback_async_return_await_with_finally_cleanup]]；否則 header 已回但 body 卡住時 timer 會被 `finally` 提早清掉 ⇒ timeout 失效） |
| `finally { if (timeoutId !== undefined) clearTimeout(timeoutId) }` | **相同** |

> `callback.ts` 是 **route handler**（非 util）⇒ 直接讀 `env.OAUTH_FETCH_TIMEOUT_MS`，**不建 `Pick<Env, …>` 窄型**（handler 本就持有完整 `Env`；一致於既有 `env.IAM_BASE_URL` / `env.RESEND_API_KEY` / `env.chiyigo_db` 讀法）。`email.ts` 的 `EmailEnv = Pick<Env, …>` 窄型是**util 端**規範，不適用 handler。

### 4.4 `types/env.d.ts` additive
```ts
    RESEND_TIMEOUT_MS?: string;
+   OAUTH_FETCH_TIMEOUT_MS?: string;   // provider token/userinfo fetch timeout override（ms；test/ops escape hatch）
```
`?: string`（Cloudflare env binding 一律 string）。**零 JS emit**、**無必要 DB/schema migration、無必要部署設定變更**——但**新增一個 optional runtime configuration contract**（Arch #Tier-2a 措辭修正：optional env key 即使 zero-emit 仍是新設定面，非「無部署面變更」）。**unset 語意**＝回落內建 default（token=8000ms、userinfo=5000ms）⇒ 不設定即與現狀等價。先例 = PR-2dr 棒3-env #144（additive +10 optional key，Codex 正規化後 bundle SHA-256 相同＝zero-emit 鐵證）。

### 4.5 失敗模式 observability — **round-2 self-review：整個 DROP 出本 PR、改 backlog**

round-1 self-review #4 建議加 `failure_kind` 判別欄區分新失敗模式（timeout/5xx/4xx/network/retry-exhausted）。**round-2 self-review 掀出此欄有連鎖問題，主線裁決：從本 PR 移除、backlog（見 §8 NB-11）**：
1. **分類本身壞**（3 個 round-2 finding：security-observability/api-contract/high-risk/naming 一致）：以 regex 對 `err.message` 分類與 §4.2 helper 實際 throw 字串不自洽——`http_5xx` 死桶（helper 5xx 走 retry、耗盡拋通用訊息無 status）、`retry_exhausted` 被 `network` catch-all 蓋掉、token catch 收到的是 `exchangeCode` 的 `${status} ${msg}`（無 `userInfo` 前綴）、**verify\* 失敗（id_token 偽造 / nonce-replay）被誤標 `network`**（把安全訊號蓋成基礎設施雜訊）。
2. **讀取端會 redact**（round-2 migration/spec-scope finding）：admin 稽核讀取端 `functions/api/admin/audit.ts:35-43` `SAFE_EVENT_DATA_KEYS` allowlist 會 **redact 未登錄的 `failure_kind`** ⇒ 寫了也看不到；補 allowlist = **動 `admin/audit.ts`、越界 SPEC-D-1**（本 PR source allowlist 僅 callback.ts + env.d.ts）。
3. **零 regression**：base 本就把 timeout/network/verify 全歸 `profile_fetch_failed`（無子判別）⇒ **不加 = 維持現狀、非退步**；加一個壞的反而 misleading。

**正解（backlog、NB-11）**：要做得對需 **(a)** helper 以結構化 outcome（error 帶 `{kind}` 欄位、非 regex 猜 message；對映 [[feedback_updatestatus_structured_outcome]]）；**(b)** token/profile 兩 catch 各自對映實際 throw 格式；**(c)** admin 讀取端 allowlist 登錄；**(d)** SPEC-D-5 test 鎖每個 kind——是一個獨立 observability PR，與 NB-9（風控 swallow）同批。**本 PR 兩個 catch 維持既有 `{ provider, reason_code }` 不動**（零 audit 面變更）。

### 4.6 Migration / rollback 契約（**Arch required governance lock**）

**migration 面**：
```
DB / schema migration        : 無
必要部署設定變更             : 無
新增 optional config         : OAUTH_FETCH_TIMEOUT_MS（runtime config contract、§4.4）
unset 語意                   : 回落 token=8000ms / userinfo=5000ms（＝現狀）
```

**事故處置＝selective 優先，`git revert` 整包為最後手段（Arch Tier-2b）**——完整 revert 會**同時退回** guard（重引 F1 白打外呼/燒 state + F2 的 `D1_TYPE_ERROR` 未捕捉 500）**與** exchangeCode 的 4 個 TS7031（ratchet 回退、oauth 域不再全清），故非首選：

| 故障 | 首選處置（forward / selective） |
|---|---|
| `OAUTH_FETCH_TIMEOUT_MS` 設錯（過大/過小） | **移除該 binding** → 回落 default（§4.4 unset 語意）；不需 code revert |
| retry 造成 provider 壓力 / 異常放大 | **forward-fix `PROFILE_MAX_ATTEMPTS = 1`**（等效關掉 retry、**保留 guard + timeout**）|
| timeout 數值不適合 | 調整 `*_DEFAULT` / clamp，**保留 guard + retry** |
| userinfo retry helper 出錯 | 可**獨立**撤回 `fetchUserInfoWithRetry`（改回單發 fetch）——它與 guard 無型別相依 |
| guard 誤擋合法 callback（regression） | **首選 forward-fix guard**（維持等價 runtime narrow）；T3(apple)/既有 suite 應先攔到 |

**⚠ guard 與 `code: string` 是同一 rollback unit（Arch R2-1 依賴矛盾修正）**：`exchangeCode({ code: string })` 的型別證明**來自 guard**（guard narrow `code` → `string`）。**不得只回退 guard 而保留 `code: string` 標型 / exchangeCode 相依**——那會使 call site 的 `code` 復為 `File | string | null` → 重現 Path C 的 **TS2322**（或迫使偷加 assertion / 擴 union / 移 guard，皆非 rollback 所述行為）。若 guard 必須緊急撤回：**依 dependency graph 一併撤回 guard + `code: string` + exchangeCode call-chain**（回到 PR-2dt 的 exchangeCode 4×TS7031 未標狀態），**或**先提供另一個經驗證的 string narrow 取代（禁 assertion）。
**⚠ `callback.ts:61` content-type gate 仍受 SPEC-D-8 owner lock**——rollback **不得**授權修改它；要動須重開 owner SPEC。

**完整 `git revert` 不是首選**（會重引已實證的 D1 500 / state 提前核銷 / 4×TS7031）；token exchange timeout 位於 `exchangeCode`、與 userinfo helper 無關，不能假設「保留 fetch 韌性」時它也無條件保留。

---

## 5. 證據（**scout 已實測**；CODE stage 於 worktree source commit fresh replay 重證）

### 5.A forced tsc set-diff（throwaway worktree @ `274a37b4`、`npm ci` 後跑、已移除）

| 項目 | 值 |
|---|---|
| base error set | **385 unique**（== ratchet current；非空已驗、非 vacuous） |
| callback.ts @ base | 恰 **4 × TS7031 @ L500**（`cfg` c31 / `code` c36 / `code_verifier` c42 / `redirect_uri` c57） |
| candidate error set | **381 unique** |
| **REMOVED** | **4**（恰為上述 4 個） |
| **ADDED** | **0**（全 solution、含 tests leaf、零 cascade） |
| callback.ts @ candidate | **CLEAN（0 錯）** ⇒ **oauth 域 105 全清成立** |
| **ratchet** | **errorCount 381 · errorFiles 17 · cleanFiles 318**（sourceFilesTotal 335；baseline 1119/175 凍結） |

> ⚠ 該 overlay 只含 **guard + exchangeCode 標型**。**fetch timeout/retry 的 ratchet 中性（ADDED=0）尚未實測** ⇒ CODE stage 必須 fresh replay 全套（SPEC-D-4；新 helper 的每個 param 必須顯式標型，否則 ADDED>0）。

### 5.B workerd probe（真 `@cloudflare/vitest-pool-workers` + 真 D1；pre-fix @ pristine base vs post-fix @ guard）

| probe | pre-fix（**RED 依據**） | post-fix |
|---|---|---|
| **P0** poisoned CT `multipart/form-data; boundary=X; probe=application/x-www-form-urlencoded` | L61 `.includes()` **passes = true**；`form.get('code')` → `typeof = object`、**`instanceof File = true`**、`ctor = File` | 同（型別事實不變） |
| **P1** `code` part 帶 `filename` → File | **400 · `fetchCalls = ["https://oauth2.googleapis.com/token"]` · state row survived = false** | **400 · `fetchCalls = []` · state row survived = true** |
| **P2** `state` part 帶 `filename` → File | **`THREW = D1_TYPE_ERROR: Type 'object' not supported for value '[object Object]'` · `status = null`** | **400 htmlError · 無 throw** |
| **P3** 合法 `application/x-www-form-urlencoded; charset=UTF-8` | 正常流到 token exchange | **正常流到 token exchange**（guard **未**誤擋 Apple） |

### 5.C 既有測試零破壞（guard overlay 上跑完整 CI-mirror）

| gate | 結果 |
|---|---|
| `vitest run --config vitest.workers.config.js`（= `test:int`） | **75 files / 1328 tests 全 PASS**（數字與 PR-2dt receipt `int 1328` 一致 ⇒ 無 skip） |
| `eslint functions tests` | **CLEAN** |

⇒ guard 對既有 15+ callback 測試、4 個 LINE nonce 測試、全 OAuth suite **零破壞**。

---

## 6. Negative / regression test 清單（SPEC-D-5；**14 cases、兩類**）

新檔 `tests/integration/oauth-callback-guard-fetch.test.ts`。fetch mock 沿 `oauth-nonce.test.ts:75-99` 的 **`fetchCalls.push(url)` 記錄器** idiom（retry 次數靠它機械斷言，禁靠推理）。

**⚠ 兩類驗收（Arch R2 修正——SPEC-D-5「每條 pre-fix RED」對 invariant 測試邏輯不可能成立）**：
- **`DELTA_RED`（新增行為 delta）**：**base RED → candidate GREEN**。＝{ T1, T2, T4, T5, T5b, T8, T8b, T9 }（8 條）。
- **`INVARIANT_GREEN`（no-weakening / policy-preservation）**：**base GREEN ∧ candidate GREEN**（證既有行為不被弱化）。＝{ T3, T6, T6b, T7, T10, **T11** }（6 條）。
- 合計 **14 cases**（含 T5b/T6b/T8b/T11；不再誤稱「T1–T10」）。

**provider 選擇（self-found C + Arch R3）**：retry/timeout 相關（T4–T9）用 **`discord`**——無 OIDC id_token 分支、無 JWKS ⇒ `fetchCalls` 只含 token + userinfo、retry 次數斷言最乾淨。**T3 改用 `apple`（Arch R3 修正）**——F9/風險表把 T3 定位為「**Apple** form_post 回歸」，故 provider 必須是 apple 才是該路徑的證據（discord 只證共用 parser、非 Apple-specific）。T10（驗 verify 不 retry）用 **`line`**（有 verify、無 JWKS）。

**⚠ mock 契約（self-found B + round-2 + Arch R1）**：測 timeout 的 mock **必須顯式監聽 abort 才會 reject**（`ctrl.abort()` 不會讓不理會 signal 的 pending promise reject）。**⭐ reject 值任意形狀即可**——§4.2 分類靠 `didTimeout` flag（我方 timer 設）+ `res===undefined`，**不 introspect `err.name`/`instanceof`**。兩種掛法：
```ts
// (i) fetch-hang（T4/T8）：fetch 本身永不 resolve、abort 時 reject
vi.fn((_url, init) => new Promise((_res, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
}))
// (ii) body-stall（T8b、Arch R1）：fetch RESOLVE 200 headers、但 res.json() 掛住、abort 時 reject（duck-typed Response）
vi.fn(async (_url, init) => ({
  ok: true, status: 200,
  json: () => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('body aborted')), { once: true })),
}))
```

| # | 類別 | provider | 測試 | pre-fix | post-fix 斷言 |
|---|---|---|---|---|---|
| **T1** | DELTA_RED | discord | POST + poisoned CT，`code` part → File | 實測 RED：400 **但** `fetchCalls` 含 tokenUrl **且** state row 被燒 | 400 · **`fetchCalls` 不含 tokenUrl** · **state row 仍在** |
| **T2** | DELTA_RED | discord | 同上，`state` part → File | 實測 RED：`D1_TYPE_ERROR` throw、**無 Response** | 400 htmlError · **不 throw** |
| **T3** | INVARIANT_GREEN | **apple** | 合法 urlencoded form_post（`onRequestPost` 路徑） | **base GREEN**：base 已處理 apple form_post → 到 token exchange | GREEN：`fetchCalls` 含 **apple** tokenUrl（guard 未擋合法 form_post；不必完成 JWKS/登入） |
| **T4** | DELTA_RED | discord | tokenUrl mock(i) 掛住 | RED：無限等 → vitest 20s testTimeout | `OAUTH_FETCH_TIMEOUT_MS='50'` ⇒ abort → 400 · 耗時 < 1s · **tokenUrl `fetchCalls` 恰 1 次**（Arch R2-3：鎖「token timeout 亦不 retry」——非冪等 authorization_code 的核心 idempotency lock，不可只靠 T7〔5xx〕間接推論） |
| **T5** | DELTA_RED | discord | userinfo：attempt1 **500**，attempt2 200（resolved 5xx） | RED：1 次 → 400 | **200 登入成功** · **userinfo `fetchCalls` 恰 2 次** |
| **T5b** | DELTA_RED | discord | userinfo：**兩次皆 500**（retry 耗盡；R-2） | RED：1 次 → 400 | 400 · **userinfo `fetchCalls` 恰 2 次**（鎖 `MAX_ATTEMPTS=2`） |
| **T6** | INVARIANT_GREEN | discord | userinfo → **401** | **base GREEN**：base 亦 1 次 → 400 | GREEN：400 · **userinfo `fetchCalls` 恰 1 次**（不 retry 4xx） |
| **T6b** | INVARIANT_GREEN | discord | userinfo → **429** | **base GREEN**：base 亦 1 次 → 400 | GREEN：400 · **userinfo `fetchCalls` 恰 1 次**（不 retry 429） |
| **T7** | INVARIANT_GREEN | discord | tokenUrl → **500** | **base GREEN**：base 亦 1 次 → 400 | GREEN：400 · **tokenUrl `fetchCalls` 恰 1 次**（token 永不 retry） |
| **T8** | DELTA_RED | discord | userinfo：attempt1 **fetch-timeout**（mock(i)），attempt2 200 | RED：無限等 → testTimeout | `OAUTH_FETCH_TIMEOUT_MS='50'` ⇒ **200 · userinfo `fetchCalls` 恰 2 次** |
| **T8b** | DELTA_RED | discord | userinfo：attempt1 **body-stall timeout**（mock(ii)、200 headers/body 掛住），attempt2 200（**Arch R1**） | RED：base 無 body timeout → 掛到 testTimeout | `OAUTH_FETCH_TIMEOUT_MS='50'` ⇒ **200 · userinfo `fetchCalls` 恰 2 次**（證 body-read timeout 亦 retry） |
| **T9** | DELTA_RED | discord | userinfo：attempt1 **network error**（mock `async()=>{throw new Error('network')}`，任意 reject），attempt2 200 | RED：base 1 次 → 400 | **200 · userinfo `fetchCalls` 恰 2 次** |
| **T10** | INVARIANT_GREEN | line | id_token 簽章無效（wrong secret）⇒ `verifyLineIdToken` throw（callback.ts:640） | **base GREEN**：base verify 亦在 userinfo 前失敗 | GREEN：400 · **userinfo `fetchCalls` 恰 0 次**（verify 在 retry loop 外、不觸 userinfo retry） |
| **T11** | INVARIANT_GREEN | discord | userinfo 回 **200 但 body 非法 JSON**（`json()` 拋 `SyntaxError`、**非 timeout**；Arch R2-2） | **base GREEN**：base `res.json()` 亦拋 → 400、userinfo 1 次 | GREEN：400 · **userinfo `fetchCalls` 恰 1 次**（機械證 `didTimeout \|\| res===undefined` **不**把 malformed body 誤當 transient；`res` 已設 ∧ ¬didTimeout → terminal） |

> **INVARIANT_GREEN 的 delta 佐證**：T6/T6b/T7/T10/T11 在 base 與 candidate 皆 GREEN、**斷言值不變**（次數/狀態相同）⇒ 證本 PR **未弱化**這些既有 no-retry / verify-first / malformed-terminal policy（Arch #7 + R2-2）。它們**不是** delta、故不可能 pre-fix RED；把它們列入 DELTA_RED 是原 SPEC-D-5 的邏輯矛盾。

**T10 helper 紀律（避踩 OD-5-HELPER）**：T10 需 forge 一個 LINE id_token（wrong-secret 使簽章驗證失敗）。**PR-2du 在新測試檔 file-local 定義最小 `signLineIdToken`**（複製 `oauth-nonce.test.ts:31-46` 現有 file-local helper 的形狀），**不 promote 到 `_helpers.ts`**（promote 是 PR-2dv 的 OD-5-HELPER scope）。T10 用 wrong-key（不碰 nonce）⇒ **不踩 NF-3、不硬化任何 verify body**。

> ⚠ scout 的 `zz-b5-probe.test.ts` 是**一次性證據、未進任何 commit**（throwaway worktree 已移除）。14 cases 必須在本 PR **正式落地**成 `tests/integration/` 交付物；**DELTA_RED 8 條須留「base RED」輸出證據、INVARIANT_GREEN 6 條須留「base GREEN ∧ candidate GREEN」證據**（SPEC-D-5 兩類）。

---

## 7. 本地機械 gate（CODE stage 於 worktree 全套實跑；對齊 CI `ci.yml`）

先跑 **IMMUTABLE-BASE guard**：`git merge-base --is-ancestor 274a37b4 HEAD`（exit 0）+ 重驗 HEAD / ratchet。再跑並讀真實輸出：

`typecheck:ratchet`（**enforce、post = `381/17/318`、baseline `1119/175` 未 `--update`**、帶 `RATCHET_BASE_REF=274a37b4`）· `lint` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。
（[[feedback_pre_merge_gate_checklist_match_ci]]：**最常漏 `test:cov`**；CI `test` 是 fail-fast 單 job，cov 紅會 skip 遮蔽 int/build/audit。）

另 **REPLAY（SPEC-D-4）**：
- forced tsc set-diff **`REMOVED=4 / ADDED=0`**（全 solution、含 tests leaf）。**任何 ADDED>0 直接阻斷、回 plan**（尤其 fetch helper 的新 param）。
- **FULL-DIFF-ALLOWLIST 機械核對**：`git diff --name-status 274a37b4..<source>` 完整 changed-files 恰 {`callback.ts`, `types/env.d.ts`, `tests/integration/oauth-callback-guard-fetch.test.ts`, 本 plan doc}。任一額外檔 = scope violation、停 gate。**尤其核對 `oauth-nonce.test.ts` / `_helpers.ts` 未被改**（SPEC-D-12：`:202` 反轉 + helper promote 皆 PR-2dv）。
- **RED-TEST-INTEGRITY**：任何 test red 先保留首次失敗輸出並判因；**禁「known flaky」直接 rerun 至 green**。Windows `public/` CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。
- **PROVIDER-PATH-HUNK（SPEC-D-10）**：`[provider]` 路徑含 `[` ⇒ `code-self-review.mjs` `REPO_PATH_PATTERN` 拒收、無法當 formal decision-point ⇒ **faithfulness packet 人工補完整 hunk + 機械 `--name-status`**，不得只依賴 reviewer script（**工具靜默回空 ≠「沒改動」**）。
- **兩類驗收實證（SPEC-D-5、Arch R2）**：**DELTA_RED 8 條**（T1/T2/T4/T5/T5b/T8/T8b/T9）須留「在 base `274a37b4` 上真的 fail」證據；**INVARIANT_GREEN 6 條**（T3/T6/T6b/T7/T10/T11）須留「base GREEN ∧ candidate GREEN」證據（證未弱化既有 policy）。禁把 invariant 逼成 RED。

---

## 8. 非 blocking notes / 明示不做（防夾帶）

- **NB-1**：`callback.ts:61` CT 子字串守門**明禁動**（SPEC-D-8 / owner OD-5-CT-GATE）。修它會讓 poisoned multipart 改走 else 分支 ⇒ **guard 變 runtime-unreachable** ⇒ T1/T2 失去 RED 著力點。且實測證明 CT 混淆**對攻擊者零收益**（送 File code ≡ 送 bogus 字串 code，皆 fail-closed）。→ backlog。
- **NB-2**：`oauthError`（L73 `if (oauthError)`）：File 為 truthy ⇒ 已 fail-closed 回 htmlError ⇒ **不動**（SPEC-D-7）。
- **NB-3（Google/Apple nonce）**：`verifyGoogleIdToken` / `verifyAppleIdToken` 的 `if (expectedNonce && …)` 為**同型 fail-open**，但 `callback.test.ts` 的 `seedOauthState` **無 `nonce` 欄位** ⇒ 全部 ~15 個 Google 測試跑在 `expectedNonce = null`、nonce 比對**恆被跳過**（test-fidelity gap）。硬化它會炸掉整個 `callback.test.ts` ⇒ **SPEC-D-2 明禁本棒動**，另開一棒（含 seed 保真）。**列此供 Gate 審者知悉，勿誤判為漏做。**
- **NB-4（LINE 缺 id_token — 本 PR 不裁決此政策；Arch 非阻塞措辭修正）**：`callback.ts:548` `if (provider === 'line' && tokens.id_token)` — 缺 id_token 時 LINE 分支的 id_token 驗證跳過。**本 PR 不改此行為、亦不裁決其安全/相容性政策**（不宣稱「只可能是 MITM」或「不可達」——那是未經實證的斷言）。現況：身份鍵 `provider_id` 仍來自**已授權的 userinfo profile API**（Bearer，由 code+PKCE+state 綁定）；**是否要求 LINE id_token 必須存在，交由 PR-2dv／後續 SPEC 依實證裁決**。列此供 Gate 審者知悉本 PR 的邊界、非漏做。
- **NB-5（htmlError 洩漏 err.message）**：`htmlError(\`無法向 ${provider} 換取 Token：${err.message}\`)` — **pre-existing pattern**（既有已吐 `id_token signature invalid` 等）。本 PR 的新 timeout 訊息沿既有風格、**不使其更糟**；統一 error envelope（code + traceId）收斂 → backlog。
- **NB-6（strict:true 延後成本）**：`cfg: ReturnType<typeof getProvider>`（含 null）在 `strictNullChecks:false` 不 cascade；strict 浪次需補 narrow（PR-2dt NB-3 已揭露，非本棒 scope）。
- **NB-7（jose JWKS timeout）**：`createRemoteJWKSet` 未顯式設 `timeoutDuration` / `cooldownDuration`（用 jose default）。**本棒不碰**（最小 diff）→ backlog。
- **NB-8（抽 fetch-with-timeout util）**：repo 現有 **5 個 site** 手刻同一段 `AbortController` + `setTimeout` + `finally{clearTimeout}`（`email.ts` / `send-verification.ts` / `invitations/index.ts` + 本棒 2 個）——已達「≥3 處重複」抽象門檻。**但 SPEC-D-6 明禁本棒新建 `functions/utils/*`**（會落入 `vitest.config.js` 的 80% coverage 門檻、需配套測試）→ backlog。
- **NB-9（風控 alert email swallow）**：`callback.ts:366` `catch { /* swallow */ }` 無 observability（3 site：callback + login + login-verify）— PR-2dt code-self-review 掀出、**非本棒**。
- **NB-10（`ctx` / `context` alias）**：`callback.ts:40-41` 用 `ctx`、`:45` 用 `context`（pre-existing）。統一為 `context` 對齊 init/bind-email → backlog（本棒不夾帶）。
- **NB-11（失敗模式 observability — round-2 從本 PR DROP、backlog；§4.5）**：本 PR 新增 4 個失敗模式（token timeout / userinfo timeout / retry-exhausted / 4xx·429），但 base 本就把它們與 verify 失敗全歸 `profile_fetch_failed`（無子判別）。round-1 曾提議加 `failure_kind` 判別欄，**round-2 self-review 掀出**：(a) 以 regex 猜 `err.message` 分類與實際 throw 字串不自洽（死桶 + verify 失敗被誤標 network）；(b) admin 讀取端 `admin/audit.ts:35-43 SAFE_EVENT_DATA_KEYS` allowlist 會 redact，補登錄 = 越界 SPEC-D-1；(c) base 無此欄 ⇒ drop = 零 regression。**正解需結構化 outcome（error 帶 `{kind}`）+ token/profile 兩 catch 各自對映 + admin allowlist + test 鎖**＝獨立 observability PR，與 NB-9（風控 swallow）＋ retry-rescued success signal（需註冊新 `event_type` 到 `audit-policy.ts`）同批。**本 PR 兩 catch 維持 `{ provider, reason_code }` 不動**。
- **NB-12（Apple profile 韌性缺口）**：self-review #3 揭示 Apple 的 profile 完全靠 `verifyAppleIdToken`（含 JWKS，callback.ts:532 early-return），**本 PR 的 userinfo timeout/retry 對 Apple 不適用**；Apple profile-side 仍靠 jose default 5s JWKS timeout（F10）。要顯式硬化 Apple 的 JWKS fetch timeout 須動 verify body（SPEC-D-2 禁）⇒ 與 NB-7（jose 顯式 timeout）**同一 backlog**。token exchange timeout（8000ms）對 Apple 仍生效。

---

## 9. 後續棒次

**棒5a = 本 PR（PR-2du）** → **棒5b = PR-2dv（LINE id_token hardening，5 項 additive、`oauth-nonce.test.ts:202` 反轉、N1–N13）** → **oauth 域 105 全清已於本棒達成**（callback.ts CLEAN） → audit ≈ 381 殿後 → noImplicitAny=0 → rebaseline `1119 → 0` → `strict:true`（~998） → scripts → tests → browser。
