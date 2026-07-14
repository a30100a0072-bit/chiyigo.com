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
| **test** | `tests/integration/oauth-callback-guard-fetch.test.ts` | **新檔**：T1–T10 |
| **治理文件** | 本 plan doc | companion |

**明禁動**（SPEC-D-1/2/6/7/8/12）：`oauth-providers.ts` · `init.ts` · `bind-email.ts` · `verifyLineIdToken` / `verifyGoogleIdToken` / `verifyAppleIdToken` **body** · **`fetchProfile` 內的 id_token 驗證區塊逐字不動**〔Apple early-return `L529-532` · Google `verifyGoogleIdToken` 呼叫 `L541` · LINE `verifyLineIdToken` 呼叫 `L549` + LINE nonce 檢查 `L550-552` · LINE email 注入 `L562-563` · Google claim 覆寫 `L565-571`〕——本 PR 只在**其後**的 `fetch(cfg.userInfoUrl)`（L556-560）包 retry loop，**retry loop 絕不涵蓋任何 verify\*IdToken**（self-review #1；SPEC-D-12 邊界，LINE nonce 區 = PR-2dv 目標）· `callback.ts:61` CT 子字串守門 · `oauthError`（L73）· **禁新建 `functions/utils/*`**。

### 1.2 SPEC Locks（**SPEC-D-1..12** = owner `SPEC_APPROVED_WITH_LOCKS` 2026-07-14）

| Lock | 約束 | 本 PR 對映 |
|---|---|---|
| **SPEC-D-1** | source allowlist = `callback.ts` + `types/env.d.ts`（+ test + plan doc） | §1.1 |
| **SPEC-D-2** | **禁擴散到 Google / Apple 的 nonce·exp 硬化** → 另棒（NF-3） | 三個 `verify*IdToken` body 逐字不動 |
| **SPEC-D-3** | no-weakening：新增檢查只能 reject 更多 | guard 是**純 additive 收斂**；fetch timeout 只增加失敗路徑 |
| **SPEC-D-4** | **ratchet post = `381 / 17 / 318`、`REMOVED=4 / ADDED=0`**；新 code 每個 function param 必須顯式標型；baseline `1119/175` 凍結禁 `--update`；**相對 `274a37b4` 任何漂移 → halt** | §4 REPLAY |
| **SPEC-D-5** | **byte-identical 不適用**；改以「每個新 reject path 有 pre-fix RED negative test」驗收 | **§6** T1–T10（self-review #5 修 dangling ref §3.5→§6） |
| **SPEC-D-6** | **禁新建 `functions/utils/*`**（coverage 80% 門檻，NF-7） | fetch helper 全 module-local |
| **SPEC-D-7** | `oauthError`（L73）不動 | 明示不夾帶 |
| **SPEC-D-8** | **`callback.ts:61` CT 子字串守門明禁動** | 動它 ⇒ guard 變 runtime-unreachable ⇒ T1/T2 失去 RED 著力點 ⇒ Gate fail |
| **SPEC-D-9** | **retry 鎖定條件**：token exchange **retry=0 永不重試**；userinfo GET **max 1 retry**（總 2 attempts）、固定 backoff、**只 retry**〔network error / timeout(abort) / 5xx〕、**絕不 retry**〔4xx / 429〕；**retry loop 只包 `fetch(cfg.userInfoUrl)+res.json()`、不含任何 verify\*IdToken**（self-review #1）；三個 transient trigger（network / timeout / 5xx）**各有 test**（T5=5xx / T8=timeout / T9=network），retry **耗盡**端由 T5b 鎖 `MAX_ATTEMPTS=2`，次數由 T5–T10（含 T5b）以 `fetchCalls.length` 機械斷言（self-review #2 + 主線 R-2） | §3.3 / §3.4 / §4.2 / §6 |
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
                    ├─ ✨ timeout 5000ms / attempt
                    ├─ ✨ attempt 1 失敗且 transient〔network error / abort(timeout) / 5xx〕→ backoff 250ms → attempt 2
                    ├─ ✨ 4xx（含 401/403）或 429 → 立即終止，**不重試**
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
| `POST cfg.tokenUrl` | **❌ 非冪等** | **retry = 0（永不）** | `authorization_code` 在 IdP 端**單次核銷**。逾時後重送會撞上「IdP 已核銷但回應在網路上遺失」——重送**必然失敗**，且部分 IdP 把 code 重用視為攻擊訊號（可能觸發 client 封鎖）。**fail-fast 才正確**：使用者重跑 OAuth（拿新 code）成本低且語意乾淨。 |
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
- **最壞路徑（有界，含 JWKS；self-review #3 修正）**：
  - **LINE / discord / facebook（無 JWKS）**：8000（token）＋ 5000 × 2（userinfo）＋ 250（backoff）≈ **18.25s**。
  - **Google（cold-cache JWKS，本 PR 未包 timeout，jose default 5s）**：8000（token）＋ 5000（JWKS）＋ 5000 × 2（userinfo）＋ 250 ≈ **~23.25s**。
  - **Apple（無 userinfo GET）**：8000（token）＋ 5000（JWKS，jose default）≈ **~13s**。
  - ⇒ 全域最壞 bound ≈ **~23.25s（Google）**；先前寫的 18.25s **實為 LINE/userinfo 路徑**（未含 JWKS）。皆有界。
- **env override（test/ops escape hatch）**：`OAUTH_FETCH_TIMEOUT_MS` **同時**覆寫 token + userinfo 兩個 timeout（沿 `utils/email.ts` `RESEND_TIMEOUT_MS` 先例）；**不覆寫 jose JWKS timeout**（SPEC-D-2 禁動 verify body）。**無此 override，T4/T8 只能真等 8/5 秒**（vitest `testTimeout: 20_000`）⇒ override 是可測性的**必要條件**，非便利。

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
    const timeoutId = setTimeout(() => ctrl.abort(), timeoutMs)   // ⚠ bare abort()（R-1）
    let transient = false
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: ctrl.signal })
      if (res.ok) return await res.json()                    // ✅ body-read 在 timer + try 內（F1）；return any（無 TS7034，R-3）
      if (res.status >= 500) transient = true                // 5xx = resolved-but-transient
      else throw new Error(`userInfo ${res.status}`)         // 4xx/429 → 立即 throw、不 retry
    } catch (err) {
      if (err && (err.name === 'AbortError' || err instanceof TypeError)) transient = true  // abort(timeout)=AbortError、network=TypeError
      else throw err                                         // 非 transient（含上面手拋的 4xx Error）→ 立即 throw
    } finally {
      clearTimeout(timeoutId)                                // 單一 finally 覆蓋 return/throw/continue-前
    }
    if (transient && attempt < PROFILE_MAX_ATTEMPTS) { await sleep(PROFILE_RETRY_BACKOFF_MS); continue }
    throw new Error(`userInfo fetch failed after ${attempt} attempt(s)`)   // retry 耗盡；無 status、無 config leak
  }
}

// fetchProfile 內：原 `const raw = await (await fetch(...)).json()`（L556-560）→ 換成一行、其餘逐字不動
  const raw = await fetchUserInfoWithRetry(cfg.userInfoUrl, tokens.access_token, timeoutMs)   // const、any 推斷（無 TS7034）
  // ... 既有 LINE email 注入（L562-563）/ Google claim 覆寫（L565-571）逐字不動 ...
```
- **⚠ R-3（主線 re-read 抓出：`let raw` 會觸 noImplicitAny）**：早期草稿把 loop 內聯、用 `let raw`（未初始化、後賦 `res.json()`=any）→ **TS7034 宣告 + TS7005 讀取**（同 PR-2dt `_googleJwks` 病灶）⇒ 破 SPEC-D-4 `ADDED=0`。`let raw:any` 被 ESLint `no-explicit-any` 擋；`let raw:unknown` 在 strict:false 下對 `raw.email=`/`raw.sub=` cascade TS2571。**解=抽 helper**：helper `return await res.json()`、`const raw = await fetchUserInfoWithRetry(...)` 保留原 `const raw` any 推斷 ⇒ 零 TS7034。**⚠ CODE stage 必 fresh replay 坐實 ADDED=0**（overlay scout 未含此 refactor、§5.A 已標）。
- **⚠ R-1：bare `ctrl.abort()`、非 `abort(new Error(...))`**。`abort(reason)` 令 fetch 以 `reason` reject（`err.name==='Error'`）⇒ 無法用 `err.name==='AbortError'` 分類 timeout ⇒ T8 timeout-retry 永遠分類失敗。bare `abort()` → `DOMException{name:'AbortError'}` ⇒ 分類正確 + 無 ms config 洩漏（一併解 security finding 的 config-leak）。**與 `email.ts` idiom 刻意分歧**（email.ts retry=0 不需分類）。
- **兩條 transient 分支結構不同（self-review #2）**：5xx = **resolved** response（`res.status>=500`）；network / timeout = **rejected** promise（`catch` 判 `AbortError`/`TypeError`）。三 trigger 各有 test（T5=5xx / T8=timeout / T9=network），耗盡端 T5b 鎖 `MAX_ATTEMPTS=2`。
- **token exchange（exchangeCode）同樣 bare `abort()`**（retry=0，message 一致無 config leak；catch 在 callback.ts:122）。exchangeCode 的 timeout 為單次（無 loop），沿 `email.ts` 單發 idiom + bare abort。
- **`sleep` = 內聯 `await new Promise(r => setTimeout(r, ms))`**（module-local、不新建 util、SPEC-D-6；沿 `audit-log.ts:119` idiom）。`PROFILE_MAX_ATTEMPTS` / `PROFILE_RETRY_BACKOFF_MS` = module-level named const（§3.4）。

### 4.3 timeout 解析（**逐條對齊 `utils/email.ts` 既有 idiom**）

| email.ts 既有寫法 | 本 PR 對映 |
|---|---|
| `const RESEND_TIMEOUT_MS_DEFAULT = 5_000`（named const、`_` 分隔） | `TOKEN_FETCH_TIMEOUT_MS_DEFAULT = 8_000` / `PROFILE_FETCH_TIMEOUT_MS_DEFAULT = 5_000` |
| `parseTimeoutMs(env)`：`raw == null \|\| raw === ''` → default；`Number(raw)`；`!Number.isFinite(n) \|\| n < 10` → default；`Math.floor(n)` | `parseFetchTimeoutMs(env: Env, fallbackMs: number)` — **同套守門 + 補上限 clamp（self-found A）**：`n < 10` → fallback（下限）**＋ `Math.min(Math.floor(n), FETCH_TIMEOUT_MAX_MS)`（上限，`FETCH_TIMEOUT_MAX_MS = 30_000`）**。⚠ `email.ts` 原 `parseTimeoutMs` **只有下限、無上限** ⇒ 若照抄，`OAUTH_FETCH_TIMEOUT_MS=99999999` 會把「禁無限等」baseline 打回原形（Worker wall-clock 前一直掛）。故本 PR **不逐字照抄**、顯式補上限 |
| `ctrl.abort(new Error(\`Resend timeout after ${timeoutMs}ms\`))` — abort 帶**描述性 Error** | ⚠ **刻意分歧（R-1）**：本 PR 用 **bare `ctrl.abort()`**（無 reason）→ fetch reject `DOMException{name:'AbortError'}`，使 catch 能以 `err.name==='AbortError'` 分類 timeout 並 retry（email.ts retry=0 不需分類、故可帶 reason）；bonus = 無 ms config 洩漏 |
| `return await res.json()`（**非** `return res.json()`）+ 註解「await 拉進 try：success path 也要等 body 解析完才 clearTimeout」 | **相同**（[[feedback_async_return_await_with_finally_cleanup]]；否則 header 已回但 body 卡住時 timer 會被 `finally` 提早清掉 ⇒ timeout 失效） |
| `finally { if (timeoutId !== undefined) clearTimeout(timeoutId) }` | **相同** |

> `callback.ts` 是 **route handler**（非 util）⇒ 直接讀 `env.OAUTH_FETCH_TIMEOUT_MS`，**不建 `Pick<Env, …>` 窄型**（handler 本就持有完整 `Env`；一致於既有 `env.IAM_BASE_URL` / `env.RESEND_API_KEY` / `env.chiyigo_db` 讀法）。`email.ts` 的 `EmailEnv = Pick<Env, …>` 窄型是**util 端**規範，不適用 handler。

### 4.4 `types/env.d.ts` additive
```ts
    RESEND_TIMEOUT_MS?: string;
+   OAUTH_FETCH_TIMEOUT_MS?: string;   // provider token/userinfo fetch timeout override（ms；test/ops escape hatch）
```
`?: string`（Cloudflare env binding 一律 string）。**零 JS emit**、無 migration、無 secret、無部署面變更。先例 = PR-2dr 棒3-env #144（additive +10 optional key，Codex 正規化後 bundle SHA-256 相同＝zero-emit 鐵證）。

### 4.5 失敗模式 observability discriminator（**self-review #4 accepted**；additive、in-scope）

**問題**：本 PR 新增 4 個失敗模式（F3 token timeout / F4 userinfo timeout / F5 retry-exhausted / F7-F8 4xx·429），但現有兩個 catch（callback.ts:123 `token_exchange_failed` / :133 `profile_fetch_failed`）只記 `{ provider, reason_code }`；`safeUserAudit` 只存 `entry.data + trace_id`；callback.ts 無 console/logger ⇒ **timeout-vs-5xx-vs-4xx 的區別只在 `err.message`（僅送 client-facing htmlError、server 端無訊號）**。違全域 §可觀測性要求（「上線後驗證 Tier 0 真實有效的唯一手段」）——retry 加了卻無 post-deploy 訊號證明它在自癒。

**修法（最小 additive、零 migration）**：`event_data` 是 free-form JSON ⇒ 在既有兩個 catch 的 data object 追加一個判別欄位：
```ts
// callback.ts:123 / :133 的既有 catch，data 從 { provider, reason_code } 追加：
data: { provider, reason_code, failure_kind }   // failure_kind: 'timeout'|'http_5xx'|'http_4xx'|'network'|'retry_exhausted'
```
- `failure_kind` 由 catch 判 `err`（`err.name==='AbortError'`→'timeout'；`/userInfo 5\d\d/`→'http_5xx'；`/userInfo 4\d\d/`→'http_4xx'；否則 'network'；userinfo 2 次皆敗→'retry_exhausted'）。
- **In-scope 理由**：本 PR 本就在改這兩個 catch 的**觸發條件**（新增 timeout/retry 失敗路徑）⇒ 補判別欄位是同一改動面的自然延伸、非夾帶。
- **明示不做（→ backlog）**：retry-rescued success signal（attempt 2 救回登入時發正向 audit）需**註冊新 `event_type` 到 `audit-policy.ts`**（擴 scope）⇒ 列 §8 NB-11 backlog，本 PR 不做。
- **無新 reason_code / 無新 event_type** ⇒ 不動 `audit-policy.ts`（api-contract 面零變更；self-review 中 api-contract finder 的 reason_code enum 疑慮由此「不新增 enum」化解）。

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

## 6. Negative / regression test 清單（SPEC-D-5；每條 pre-fix 必須真的 RED）

新檔 `tests/integration/oauth-callback-guard-fetch.test.ts`。fetch mock 沿 `oauth-nonce.test.ts:75-99` 的 **`fetchCalls.push(url)` 記錄器** idiom（retry 次數靠它機械斷言，禁靠推理）。

**provider 選擇（self-found C）**：retry/timeout 相關（T4–T9）一律用 **`discord`**——discord **無 OIDC id_token 分支、無 JWKS**（`[ID_TOKEN_VERIFY]` 直接落 discord 分支到 `[USERINFO_FETCH]`）⇒ `fetchCalls` 只含 token + userinfo 兩種 URL、retry 次數斷言最乾淨，不被 verify\*/JWKS fetch 干擾。T10（驗 verify 不 retry）用 **`line`**（有 verify、無 JWKS）。

**⚠ mock signal 契約（self-found B）**：測 timeout（T4/T8）的 mock **必須顯式監聽 abort 才會 reject**——`ctrl.abort()` 不會讓一個不理會 signal 的 pending promise reject。沿 `tests/email.test.ts:113-129` 先例：
```ts
// hanging mock that honors init.signal（否則 T4/T8 會真的掛到 vitest 20s testTimeout）
vi.fn((_url, init) => new Promise((_res, reject) => {
  init?.signal?.addEventListener('abort', () => reject(new Error('aborted by internal timeout')), { once: true })
}))
```

| # | provider | 測試 | pre-fix（RED；**T1/T2/T3 已實測**） | post-fix 斷言 |
|---|---|---|---|---|
| **T1** | discord | POST + poisoned CT，`code` part 帶 filename → File | 實測：400 **但** `fetchCalls` 含 tokenUrl **且** state row 被燒 | 400 · **`fetchCalls` 不含 tokenUrl** · **state row 仍在**（三重鎖） |
| **T2** | discord | 同上，`state` part → File | 實測：`D1_TYPE_ERROR` throw、**無 Response** | 400 htmlError · **不 throw** |
| **T3** | discord | **positive**：合法 urlencoded form_post（`onRequestPost` 路徑） | 全 repo 無此測試（`onRequestPost` 零覆蓋、NF-5） | 正常流到 token exchange（`fetchCalls` 含 tokenUrl）⇒ **證 guard 未誤擋合法 form_post** |
| **T4** | discord | tokenUrl mock 掛住（honor signal） | 無限等 → vitest 20s testTimeout | `OAUTH_FETCH_TIMEOUT_MS='50'` ⇒ abort → 400 · 耗時 < 1s |
| **T5** | discord | userinfo：attempt 1 → **500**，attempt 2 → 200（**resolved 5xx 分支**） | 1 次 → 400 | **200 登入成功** · **userinfo `fetchCalls` 恰 2 次** |
| **T5b** | discord | userinfo：**兩次皆 500**（retry 耗盡；self-review #2 主線 R-2） | 1 次 → 400 | 400 · **userinfo `fetchCalls` 恰 2 次**（鎖 `PROFILE_MAX_ATTEMPTS=2`：**證 retry 停在 2、非無限/off-by-one**）· 選配斷言 audit `failure_kind='retry_exhausted'` |
| **T6** | discord | userinfo → **401** | 400 | 400 · **userinfo `fetchCalls` 恰 1 次**（鎖「不 retry 4xx」） |
| **T6b** | discord | userinfo → **429** | 400 | 400 · **userinfo `fetchCalls` 恰 1 次**（鎖「不 retry 429」，SPEC-D-9） |
| **T7** | discord | tokenUrl → **500** | 400 | 400 · **tokenUrl `fetchCalls` 恰 1 次**（鎖「token exchange 永不 retry」） |
| **T8** | discord | userinfo：attempt 1 **timeout(abort)**，attempt 2 → 200（**rejected/abort 分支**；self-review #2） | 無 test → timeout 分支 retry 未驗 | `OAUTH_FETCH_TIMEOUT_MS='50'` + 首次掛住(honor signal)/次次 200 ⇒ **200 · userinfo `fetchCalls` 恰 2 次** |
| **T9** | discord | userinfo：attempt 1 **network error**（mock `throw new TypeError()`），attempt 2 → 200（**rejected/network 分支**；self-review #2） | 無 test → network retry 未驗 | **200 · userinfo `fetchCalls` 恰 2 次** |
| **T10** | line | id_token 簽章無效（wrong channel secret）⇒ `verifyLineIdToken` throw（sig invalid，callback.ts:640） | 無 test 鎖「verify throw 不 retry userinfo」 | 400 · **userinfo `fetchCalls` 恰 0 次**（證 verify 在 retry loop **外**、verify throw 不觸發 userinfo retry；self-review #1） |

**T10 helper 紀律（避踩 OD-5-HELPER）**：T10 需 forge 一個 LINE id_token（wrong-secret 使簽章驗證失敗）。**PR-2du 在新測試檔 file-local 定義最小 `signLineIdToken`**（複製 `oauth-nonce.test.ts:31-46` 現有 file-local helper 的形狀），**不 promote 到 `_helpers.ts`**（promote 是 PR-2dv 的 OD-5-HELPER scope）。T10 用 wrong-key（不碰 nonce）⇒ **不踩 NF-3（Google/LINE nonce seed 保真是另一棒）、不硬化任何 verify body**。

> ⚠ scout 的 `zz-b5-probe.test.ts` 是**一次性證據、未進任何 commit**（throwaway worktree 已移除）。T1–T10 必須在本 PR **正式落地**成 `tests/integration/` 交付物；每條 pre-fix RED 須留輸出證據（SPEC-D-5）。

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
- **PRE-FIX RED 實證（SPEC-D-5）**：T1–T10 每條須留「在 base `274a37b4` 上真的 fail」的輸出證據。

---

## 8. 非 blocking notes / 明示不做（防夾帶）

- **NB-1**：`callback.ts:61` CT 子字串守門**明禁動**（SPEC-D-8 / owner OD-5-CT-GATE）。修它會讓 poisoned multipart 改走 else 分支 ⇒ **guard 變 runtime-unreachable** ⇒ T1/T2 失去 RED 著力點。且實測證明 CT 混淆**對攻擊者零收益**（送 File code ≡ 送 bogus 字串 code，皆 fail-closed）。→ backlog。
- **NB-2**：`oauthError`（L73 `if (oauthError)`）：File 為 truthy ⇒ 已 fail-closed 回 htmlError ⇒ **不動**（SPEC-D-7）。
- **NB-3（Google/Apple nonce）**：`verifyGoogleIdToken` / `verifyAppleIdToken` 的 `if (expectedNonce && …)` 為**同型 fail-open**，但 `callback.test.ts` 的 `seedOauthState` **無 `nonce` 欄位** ⇒ 全部 ~15 個 Google 測試跑在 `expectedNonce = null`、nonce 比對**恆被跳過**（test-fidelity gap）。硬化它會炸掉整個 `callback.test.ts` ⇒ **SPEC-D-2 明禁本棒動**，另開一棒（含 seed 保真）。**列此供 Gate 審者知悉，勿誤判為漏做。**
- **NB-4（LINE 缺 id_token）**：`callback.ts:548` `if (provider === 'line' && tokens.id_token)` — 缺 id_token 時整段驗證跳過。**已考慮、明示不做**：LINE scope 含 `openid` ⇒ 恆回 id_token；缺失只可能是 token endpoint 被 MITM（server-to-server TLS，不可達）。且身份鍵 `provider_id` 仍來自**已驗證的 profile API**（Bearer，由 code+PKCE+state 綁定），nonce 的作用（綁 id_token 到 session）在無 id_token 時本就不適用 ⇒ **非 fail-open 漏洞**。改成「必須有 id_token」是新的 live-breakage 風險。
- **NB-5（htmlError 洩漏 err.message）**：`htmlError(\`無法向 ${provider} 換取 Token：${err.message}\`)` — **pre-existing pattern**（既有已吐 `id_token signature invalid` 等）。本 PR 的新 timeout 訊息沿既有風格、**不使其更糟**；統一 error envelope（code + traceId）收斂 → backlog。
- **NB-6（strict:true 延後成本）**：`cfg: ReturnType<typeof getProvider>`（含 null）在 `strictNullChecks:false` 不 cascade；strict 浪次需補 narrow（PR-2dt NB-3 已揭露，非本棒 scope）。
- **NB-7（jose JWKS timeout）**：`createRemoteJWKSet` 未顯式設 `timeoutDuration` / `cooldownDuration`（用 jose default）。**本棒不碰**（最小 diff）→ backlog。
- **NB-8（抽 fetch-with-timeout util）**：repo 現有 **5 個 site** 手刻同一段 `AbortController` + `setTimeout` + `finally{clearTimeout}`（`email.ts` / `send-verification.ts` / `invitations/index.ts` + 本棒 2 個）——已達「≥3 處重複」抽象門檻。**但 SPEC-D-6 明禁本棒新建 `functions/utils/*`**（會落入 `vitest.config.js` 的 80% coverage 門檻、需配套測試）→ backlog。
- **NB-9（風控 alert email swallow）**：`callback.ts:366` `catch { /* swallow */ }` 無 observability（3 site：callback + login + login-verify）— PR-2dt code-self-review 掀出、**非本棒**。
- **NB-10（`ctx` / `context` alias）**：`callback.ts:40-41` 用 `ctx`、`:45` 用 `context`（pre-existing）。統一為 `context` 對齊 init/bind-email → backlog（本棒不夾帶）。
- **NB-11（retry-rescued success signal）**：self-review #4 建議「attempt 2 救回登入時發正向 audit」以驗 retry 真在自癒——但需**註冊新 `event_type` 到 `audit-policy.ts`**（擴 scope、動 api-contract 面）⇒ **本棒不做**（本棒只加 free-form `failure_kind` 到既有 audit、§4.5）。→ backlog（與 NB-9 observability 一批）。
- **NB-12（Apple profile 韌性缺口）**：self-review #3 揭示 Apple 的 profile 完全靠 `verifyAppleIdToken`（含 JWKS，callback.ts:532 early-return），**本 PR 的 userinfo timeout/retry 對 Apple 不適用**；Apple profile-side 仍靠 jose default 5s JWKS timeout（F10）。要顯式硬化 Apple 的 JWKS fetch timeout 須動 verify body（SPEC-D-2 禁）⇒ 與 NB-7（jose 顯式 timeout）**同一 backlog**。token exchange timeout（8000ms）對 Apple 仍生效。

---

## 9. 後續棒次

**棒5a = 本 PR（PR-2du）** → **棒5b = PR-2dv（LINE id_token hardening，5 項 additive、`oauth-nonce.test.ts:202` 反轉、N1–N13）** → **oauth 域 105 全清已於本棒達成**（callback.ts CLEAN） → audit ≈ 381 殿後 → noImplicitAny=0 → rebaseline `1119 → 0` → `strict:true`（~998） → scripts → tests → browser。
