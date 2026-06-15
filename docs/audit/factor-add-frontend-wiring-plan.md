# FACTOR-ADD 前端 elevation 接線修補 plan（Stage 1：TOTP / password elevation）

> **狀態**：`PLAN_DRAFT`（dimension-A self-review workflow ✅ 跑畢，7 維 14 accepted → 主線獨立裁決後套入，逐項裁決見 §12）→ 送 ChatGPT Arch Gate + Codex Plan Gate（Dual Gate v3）。**plan 過 gate 才進 Code 階段。**
> **分級**：L2（前端 feature 接線）+ **敏感熱區**（auth / factor-add / token）→ 三道基本外部審查全走（GPT Arch + Codex Plan + Codex Code）。
> **前置裁決**：owner = **Option 2**（Stage 1 先上 TOTP/password elevation，OAuth-only 留 Stage 2）；**插隊在「回 Stage 7 strict」之前**。
> **後端**：**零改動、無 migration**。整套 elevation primitive（`/api/auth/elevation/{totp,password,exchange}` + `init`/`callback` elevation 分支）已於 #77（PR-A2）/ #78（PR-A3）建全並測全綠。本 PR 只補**前端 ceremony 驅動**。
> **前置（SR #5/#6）**：migration **0054**（`elevation_grants`/`elevation_exchanges` + `oauth_states` elevation 欄，PR-A1 #75）已 applied+verified prod D1；本 PR 依賴此 schema 但**不新增** migration。target 環境須已套 0054（prod 已套）。
> **branch**：`feat/factor-add-elevation-ux`。

---

## 0. 背景與根因（confirmed 2026-06-15）

#78（PR-A3，`7ae5558`）對三條 factor-add 入口加了 `requireFactorAddGrant`（需 `X-Factor-Add-Grant` header）：

| 端點 | gate |
|---|---|
| `functions/api/auth/oauth/[provider]/init.ts:118`（`is_binding` 分支） | `requireFactorAddGrant({action:'bind_identity'})` |
| `functions/api/auth/webauthn/register-verify.ts:41` | `requireFactorAddGrant({action:'add_passkey'})` |
| `functions/api/auth/wallet/verify.ts:44` | `requireFactorAddGrant({action:'bind_wallet'})` |

但 **SEC-FACTOR-ADD-A §11 staged PR（PR-0/A1/A2/A3/A4）從頭就沒有「前端接線」那一顆**。前端三條 caller（`src/js/dashboard.ts`：`bindProvider:770`／`addPasskey:1742`／`addWallet:1953`）至今**裸打端點、從不鑄 grant、不帶 header**，連 OAuth-reauth elevation 回跳的 `#elev_exchange=<code>` fragment 都**無任何 handler**。

**後果**：新增 passkey／綁 wallet／綁任何 OAuth identity **自 2026-06-13（#78 merge）起在 prod 全數 403 失效**。登入既有 factor、移除既有 factor 不受影響（解釋 owner 能解綁 Discord 卻不能重綁）。toast「Factor-add elevation required」＝ `init` 的 `FACTOR_ADD_GRANT_REQUIRED`（無 i18n key → `tApiError` 回退後端英文原文）。

**判定**：與 OD-3 #83 **無關**（#78 改檔 zero 前端；#83 只動 `init.ts` 的 `isElevation` 分支、非 `isBinding` 403）。方向是 **fail-closed（無安全破口）**，屬 **P1 可用性 regression**。

**為何全綠 PR 仍出壞 feature**：`tests/integration/_helpers.ts:383 seedFactorAddGrant` 直接 INSERT `elevation_grants` 並回傳明文 token 給 header，integration test 全程**繞過前端 ceremony**；repo 無 dashboard 全鏈路 test。**本 PR 必須順帶補上能抓到此類缺口的測試（§7）**，否則同盲點會復發。

---

## 1. 範圍

### 1.1 Stage 1 IN（本 PR）
- 新增前端共用 helper `obtainFactorAddGrant(action)`：依帳號能力（`window.__totpEnabled` / `window.__hasPassword`，dashboard 載入時由 `/api/auth/me` 填妥，見 `dashboard.ts:226/236`）選擇 elevation 方法，彈 modal 收第二因子，呼叫 `/api/auth/elevation/{totp,password}` 取得 `grant_token`。
- 三條 caller 接線：先取 grant，再帶 `X-Factor-Add-Grant: <grant_token>` 打原 factor-add 端點。
- OAuth-only 帳號（無 TOTP 且無密碼）：Stage 1 **不**支援，顯示引導文案（與 `reverifyIdentity` 的 `reverify_no_channel` 同型）。
- i18n key（modal 文案 + 引導 + 新錯誤碼對應）；`checkBindResult` 的 `bind_error` map 補 `elevation_required`/`elevation_consumed`。
- 測試（§7）：含**至少一條全鏈路 test**（驗 caller 真的先 elevate 再帶 header）。
- build `public/js` + cache-bust `?v=`（依 [[feedback_npm_build_not_copy]]／[[feedback_cache_bust_versioning]]）。

### 1.2 Stage 1 OUT（→ Stage 2 獨立 PR）
- OAuth-only 帳號的 OAuth-reauth elevation：`init?purpose=elevation&action=...` roundtrip + `#elev_exchange=<code>` fragment handler + pending-action 跨 redirect 持久化（sessionStorage）+ `/api/auth/elevation/exchange`。
- 理由：跨整頁 redirect 的 resume（WebAuthn challenge／SIWE nonce 會遺失，需重起 ceremony）複雜度與風險最高、受眾最小，隔離成 follow-up。

### 1.3 明確非目標（不做）
- **不**放寬／移除任何 `requireFactorAddGrant` gate（會重開 SEC-FACTOR-ADD P1，Tier 0 安全不可妥協）。
- **不**動任何後端檔、不改 migration、不改 grant TTL（OD-C = 5min 維持）。
- **不**重構 `openReverifyModal` 的安全 reverify 路徑（[[feedback_security_boundary_pr_first_do_no_harm]]，見 OD-1）。

---

## 2. 設計總覽（ceremony）

```
使用者點「新增 passkey / 綁 wallet / 綁 Discord」
        │
        ▼
obtainFactorAddGrant(action)
        │  讀 __totpEnabled / __hasPassword
        ├─ hasTotp ───────────► modal 收 OTP/備用碼 ─► POST /elevation/totp     {action, otp_code}     ─┐
        ├─ !hasTotp && hasPw ──► modal 收目前密碼   ─► POST /elevation/password {action, current_password}─┤
        └─ 皆無（OAuth-only）──► 引導文案 → return null（Stage 1 不續）                                    │
                                                                                                          ▼
                                                                                             { grant_token, expires_in }
        ┌─────────────────────────────────────────────────────────────────────────────────────────────┘
        ▼
  依 action 續原 ceremony，最後一個寫入呼叫帶 X-Factor-Add-Grant header：
    add_passkey   → register-options → navigator.credentials.create() → register-verify  (header)
    bind_wallet   → eth_requestAccounts → wallet/nonce → personal_sign → wallet/verify    (header)
    bind_identity → init?is_binding=true (header) → 整頁 redirect 到 provider → callback consume grant
```

grant 為後端 one-time、5min、session(sid)-bound、action-bound（`elevation_grants`，migration 0054）。前端只負責「鑄 → 帶」，consume 的原子性與一次性由後端 `db.batch` CAS 保證（`register-verify`/`wallet/verify` 同 batch consume；`bind_identity` 由 `init` validate-not-consume + `callback` consume）。

---

## 3. 前端模組設計

### 3.1 `obtainFactorAddGrant(action): Promise<{ grant_token: string } | null>`

- 位置：`src/js/dashboard.ts`（module-scoped async function）。
- **action 型別（SR #8）**：前端定義 literal union `type FactorAddAction = 'add_passkey' | 'bind_wallet' | 'bind_identity'`，簽名 `obtainFactorAddGrant(action: FactorAddAction)`。**不**從 `functions/` runtime import（前端 bundle 不跨 import 後端），用本地 type alias 讓 typo（如 `'add_key'`）在 tsc 即被擋（後端 `isFactorAddAction` 仍是最終 fail-closed 防線）。三 caller 各傳 hardcoded literal，action 永不來自 user input / URL。
- 流程：
  1. `const hasTotp = !!window.__totpEnabled; const hasPw = !!window.__hasPassword;`
  2. 皆無 → `showBindToast(T('factor_add_no_channel'), 'warn'); return null;`（OAuth-only，Stage 1 不續）。
  3. 否則 `openElevationModal({ action, useTotp: hasTotp })` → 回 `Promise<{grant_token}|null>`（modal 內完成 POST `/elevation/*`，成功 resolve grant、取消/失敗 resolve null）。
- **回傳語意**：成功 = `{ grant_token }`；取消/無管道/逾失敗 = `null`（caller 一律 `if (!grant) { 還原按鈕; return; }`）。

### 3.2 elevation 提示 modal（**dedicated**；OD-1）

- 新函式 `openElevationModal({ action, useTotp })`，**自帶 markup**（~15 行，複製 `openReverifyModal` 的視覺結構），**不**與 reverify 共用提交邏輯。
- 輸入：`useTotp` → `type=text`、placeholder「兩步驟驗證碼或備用救援碼」；否則 `type=password`、placeholder「目前登入密碼」。
- 提交：
  - `useTotp`：`POST /api/auth/elevation/totp`，body `{ action, otp_code: v }`（後端 `verifySecondFactor` 同時吃 6 位 TOTP 與 20-hex 備用碼，前端不需自行分流）。
  - else：`POST /api/auth/elevation/password`，body `{ action, current_password: v }`。
  - 成功（200）→ **回應形狀守衛（SR #4）**：`if (typeof data?.grant_token !== 'string' || !data.grant_token) → 顯示錯誤 + resolve(null)`（fail-closed，不拿空 grant 續 ceremony）；通過才 `resolve({ grant_token: data.grant_token })` + 關 modal。
  - 401（OTP/密碼錯）→ modal 內顯示錯誤、保留可重試（不關）。
  - 429（`RATE_LIMITED`，後端 5/5min）→ 顯示節流文案（i18n key `elevation_rate_limited`）、可關閉。後端 429 **無** `retry_after` 欄 → 用靜態文案，不做倒數（避免假精確）。
  - 其他/網路錯 → `tApiError` 文案。
- 取消 / 點遮罩 / Esc → `resolve(null)`。
- **理由（OD-1）**：reverify modal 是 fire-and-forget（提交 → success toast → `loadProfile`，`dashboard.ts:858-864`）；elevation 需「回傳 grant 給 caller 續 ceremony」＝ Promise 形狀。兩者控制流不同、且都在安全邊界上，硬抽象會讓兩條安全流程互相耦合（改一個可能弄壞另一個），抽象判斷不過關（僅 2 caller + 讀者更難理解）。複製 ~15 行 markup 成本低、隔離性高。

### 3.3 apiFetch header 透傳（**無需改 api.ts**）

- `apiFetch`（`src/js/api.ts`）既有 header merge：`new Headers(opts.headers || {})`（api.ts:208），且只在 caller **未給** 時才補 `Authorization`/`Content-Type`（:213/:219）→ 傳 `{ headers: { 'X-Factor-Add-Grant': grant.grant_token } }` 會被原樣保留。
- **Code 時驗證項**：確認 `apiFetch`（:226）本體確實套用該 merge（非僅 refresh 路徑）。若不然，最小改動讓 `apiFetch` 透傳 `init.headers`（仍 frontend-only）。

---

## 4. 三條 caller 接線

> 共同 pattern：函式開頭（按鈕 disable 之後）插入
> `const grant = await obtainFactorAddGrant('<action>'); if (!grant) { /* 還原按鈕/訊息 */ return; }`
> 然後在**寫入呼叫**帶 header。grant 5min TTL 足以覆蓋後續 ceremony（OTP 輸入 + authenticator 觸碰／錢包簽章，秒級）。

### 4.1 `addPasskey`（`dashboard.ts:1742`）
- 在 `register-options`（:1759）**之前**取 grant（避免無法 elevate 卻先叫出 authenticator）。
- `register-verify`（:1785）改帶 `headers: { 'X-Factor-Add-Grant': grant.grant_token }`。
- WebAuthn `create()` 取消（NotAllowedError/AbortError，:1769）→ grant 未 consume、5min 後自然失效，無副作用。

### 4.2 `addWallet`（`dashboard.ts:1953`）
- 在 `eth_requestAccounts`（:1973）**之前**取 grant。
- `wallet/verify`（:2033）改帶 header。
- 簽章取消（4001/AbortError，:2023）→ grant 未 consume，同上無害。

### 4.3 `bindProvider`（`dashboard.ts:770`）+ `checkBindResult`
- 在 `init?is_binding=true`（:774）**之前**取 grant；該 `apiFetch` 帶 header。
- `init` 為 **validate-not-consume**：驗 grant 有效後把 `grant_hash` 存進 `oauth_states`，回 `redirect_url`；前端整頁 redirect 到 provider；`callback` 在 binding INSERT 同 batch consume grant。
- **`checkBindResult`（:701-706）補 `bind_error` map（SR #1/#7/#11）**：明確新增兩鍵——
  - `elevation_required: 'bind_err_elevation_required'`（callback `:194`，grant 在 init 後 / state 不符）
  - `elevation_consumed: 'bind_err_elevation_consumed'`（callback `:227`，grant 在 provider 同意期間逾 5min TTL／已消費）
  - **i18n key 名鏡射後端 error code 字串**（`elevation_consumed` → `bind_err_elevation_consumed`，**不**用 `..._timeout` 以免 alias，[[feedback_state_machine_naming_no_alias]]）；user-facing 文案可寫「驗證已逾時，請重新綁定」。目前這兩碼會落到預設 `bind_fail`。

---

## 5. 高風險加碼 4 件（L2 + 敏感熱區，code 前先輸出）

### 5.1 State machine — grant lifecycle（後端持有，前端只驅動 mint→use）
| 狀態 | 轉移 | 觸發 |
|---|---|---|
| (none) → minted | `/elevation/{totp,password}` 200 | 第二因子驗證通過 |
| minted → consumed | factor-add 寫入同 batch CAS `changes()=1` | 唯一一次成功寫入 |
| minted → expired | 5min TTL 到（`expires_at`） | 時間 |
| minted → (lost) | 前端 ceremony 取消 | grant 留 DB 至 expired，無害 |

前端**不**自行追蹤 grant 狀態（無 client-side mutable 安全 state）；一切以後端 CAS 為準。

### 5.2 Failure mode 列表
| 情境 | 前端行為 |
|---|---|
| OAuth-only（無管道） | 引導文案，return null，不續 |
| OTP/密碼錯（401） | modal 內錯誤、可重試 |
| elevation 節流（429） | 節流文案 |
| 取得 grant 後 WebAuthn/SIWE 取消 | 還原按鈕；grant 自然失效 |
| factor-add 回 `FACTOR_ADD_GRANT_CONSUMED`（race/雙擊） | 友善錯誤訊息 |
| bind_identity：provider 同意逾 5min → `bind_error=elevation_consumed` | toast「逾時請重綁」 |
| **session 中途撤銷**（logout／device-revoke／refresh-reuse family-revoke）後才打 factor-add（SR #2/#10） | factor-add 回 401（access token 過期／`SESSION_REVOKED`）或 403 `ELEVATION_SID_REQUIRED` → 走 `apiFetch` 既有 session 處理（硬登出／重登提示）；不卡死在 ceremony state。後端時序不變（見 §8） |
| **bind_identity：init 階段 grant validate 失敗**（早於 redirect，SR #12） | `init` 回 403 `FACTOR_ADD_GRANT_REQUIRED`／`FACTOR_ADD_ELEVATION_REQUIRED`／`ELEVATION_SID_REQUIRED` → `bindProvider` try/catch → toast；使用者**未**被導去 provider（與 callback-stage 的 `?bind_error=` redirect 明確區分） |
| 取 grant 後使用者直接關頁 | 無副作用（grant 失效） |

### 5.3 Idempotency 策略
- 寫入路徑既有按鈕 `disabled = true` 防雙擊（`dashboard.ts:1752/1966/772`），ceremony 全程不重置。
- 後端 grant **one-time CAS consume**（`consumed_at IS NULL`）保證：即便兩 grant 並發，只有一個寫入成功，另一個回 `FACTOR_ADD_GRANT_CONSUMED`。前端僅需把該錯誤翻成友善訊息。

### 5.4 Retry + timeout 策略
- elevation 提交失敗（401）→ modal 內可重試，**上界＝後端 RL 5/5min**（429 即止），前端不自做無限重試。
- 所有外呼走 `apiFetch`（既有 timeout/retry 紀律）。
- 無新增 long-running／stream，無需 AbortSignal 新設計。

---

## 6. i18n + 錯誤碼對應

- 新 key（三語 zh-TW/en/ja，依 [[feedback_i18n_multi_sentinel]] 驗 sentinel）：
  - `factor_add_no_channel`（OAuth-only 引導，仿 `reverify_no_channel`）。
  - elevation modal：title／提示／OTP·密碼 placeholder／`elevation_rate_limited`（429 節流）／取消。
  - `bind_err_elevation_required`、`bind_err_elevation_consumed`（**key 名鏡射後端 code** `elevation_required`/`elevation_consumed`，SR #11；user-facing value 可寫「逾時請重綁」）。
- **錯誤碼 → 友善文案 map（防禦縱深）**：在 `src/js/api.ts` 的 `API_ERROR_I18N` 補 `FACTOR_ADD_GRANT_REQUIRED`/`FACTOR_ADD_ELEVATION_REQUIRED`/`FACTOR_ADD_GRANT_CONSUMED`/`ELEVATION_SID_REQUIRED`/`ELEVATION_REQUIRES_2FA`/`ELEVATION_USE_TOTP`/`ELEVATION_NO_PASSWORD` 等碼，避免再洩後端英文原文（即本次 toast 醜陋的根源）。

---

## 7. 測試策略（含關閉 root-cause 盲點的全鏈路 test）

> root cause 正是「無 dashboard 全鏈路測試」。Stage 1 **必須**補一條能抓到「caller 沒先 elevate / 沒帶 header」的測試，否則盲點復發。

- **全鏈路 test（核心，關盲點）**：載入 build 後的 `public/js/dashboard.js`（node:vm，沿用 api test「eval built bundle」既有 pattern，見 memory 前端 api 8 test），stub `document`/`location`/`window.apiFetch`/`__totpEnabled`/`__hasPassword`，觸發三條 caller，斷言：
  1. 先呼叫 `/api/auth/elevation/totp`（或 `/password`）取 grant；
  2. 後續 factor-add 呼叫**確實帶 `X-Factor-Add-Grant` header 且值 == grant_token**；
  3. OAuth-only（兩旗標皆 false）→ 不打任何 factor-add 端點、顯示引導。
- **method 選擇 unit**：`__totpEnabled`→totp 端點、`!totp&&pw`→password 端點、body 形狀正確。
- **grant_token 洩漏防護 test（SR #3，auth 衛生）**：mock `console.*` + `localStorage`/`sessionStorage`，斷言整個 ceremony 全程**無任何呼叫參數含 grant_token**；錯誤路徑斷言傳給 `tApiError` 的是 code/status（非整個 response body）。配 code-review checklist：grep `dashboard.ts` 確無 `console\..*grant` / `localStorage.*grant` / `sessionStorage.*grant`（[[feedback_security]] log 禁洩 token）。
- **per-caller action 正確性 test（SR #13）**：斷言三 caller 各送對的 action（addPasskey→`add_passkey`、addWallet→`bind_wallet`、bindProvider→`bind_identity`）＝防前端送錯 action 的 regression（後端 cross-action 比對仍是最終 fail-closed 防線）。
- **可行性（→ OD-3）**：`dashboard.js` 在 IIFE/載入期有 DOM 觸碰（`checkBindResult` 立即執行），node:vm 需 stub。若 bundle 不易 vm-eval，退而求其次＝把「elevation 網路步驟」抽成可測純函式 + 對它 node:vm 測，DOM/modal 部分以 prod 無痕驗收（[[feedback_prod_verify_incognito]]）補。**送 gate 裁可測邊界。**
- **CI 對齊**（[[feedback_pre_merge_gate_checklist_match_ci]]）：新增 test 必入 CI 對應 job；本機跑齊 lint / ratchet / test:int / **test:cov** / build:functions，全綠才宣告。

---

## 8. 安全考量

- **後端 0 改動**：所有 gate / CAS / TTL / sid 綁定不變，SEC-FACTOR-ADD P1 封閉性完好。本 PR 只讓前端「合法地取得並出示 grant」。
- **不擴攻擊面**：grant 仍 5min/one-time/sid-bound/action-bound；前端不持久化 grant（記憶體變數，用完即棄）；OAuth-only 在 Stage 1 直接擋（引導），不引入弱管道。
- **grant 不入 URL/log**：Stage 1 只走 header（totp/password 路徑無 redirect）；`#elev_exchange` 路徑屬 Stage 2。
- **fail-closed 維持**：任何取 grant 失敗 → 不續寫入。
- **grant 綁 sid-字串、非 live session row（SR #2/#10，既有 tradeoff）**：grant consume predicate 比對 `session_id = <sid 字串>`，**不**檢查該 session 是否已 revoke。因 access token 殘留 ≤15min（系統既有「access≤15min／refresh 可撤」tradeoff），一張 pre-mint grant 在 session 撤銷後、access token 未過期前仍可能被消費。**本 frontend PR 不改後端時序**；且鑄 grant 已需證明第二因子（＝帳號已全面 compromise，factor-add 保護本就失效）→ 邊際風險可忽略。是否後端加碼（consume 時 re-validate live session／縮 binding grant TTL）＝ 獨立 backend 決策，列 **OD-5／R4** 交 gate 裁。

---

## 9. 變更檔清單 + 部署

| 檔 | 變更 |
|---|---|
| `src/js/dashboard.ts` | `obtainFactorAddGrant` + `openElevationModal` + 三 caller 接線 + `checkBindResult` bind_error map |
| `src/js/api.ts` | （可能）`API_ERROR_I18N` 補錯誤碼文案；header 透傳僅驗證、預期不改邏輯 |
| `src/i18n/*`（三語 JSON） | 新增 key |
| `public/js/dashboard.js`、`public/js/api.js` | `npm run build` 產物（非手改） |
| `public/*.html` | cache-bust `?v=<git HEAD hash>`（[[feedback_cache_bust_versioning]]／[[feedback_backend_commit_still_needs_cache_bust]]） |
| `tests/...` | §7 測試 |
| `docs/audit/RESUME.md` | 狀態回寫 |

部署：feature branch → PR → squash（禁直推 main）；merge 後自動 Pages deploy；prod 無痕驗收三條 factor-add。**無 D1 migration。**

---

## 10. Open Decisions（送 ChatGPT Arch Gate + Codex Plan Gate 裁）

- **OD-1（modal 共用度）**：dedicated `openElevationModal`（複製 markup，不碰 reverify）**vs** 把 `openReverifyModal` 泛化成 promise-returning 共用 modal。
  - 傾向：**dedicated**（首要 do-no-harm、僅 2 caller、控制流不同）。
- **OD-2（bind_identity 的 elevation 方法選擇）**：有 TOTP/密碼的使用者綁新 provider 時，Stage 1 用 totp/password elevation（單頁，無需先 OAuth-reauth）即可取 `bind_identity` grant。確認「能用 totp/password 就不強制 OAuth-reauth」可接受（OAuth-reauth 只留給 OAuth-only ＝ Stage 2）。
  - 傾向：**是**（totp/password 嚴格更簡單、roundtrip 更少）。
- **OD-3（前端測試邊界）**：全鏈路 node:vm 測 `dashboard.js`（理想，關盲點）**vs** 抽純函式測 + DOM 部分靠 prod 無痕驗收。視 `dashboard.js` 是否易 vm-eval。
  - 傾向：**優先試全鏈路**；不可行才退抽純函式 + 明標 DOM 未自動覆蓋。
- **OD-4（grant TTL 跨 binding redirect）**：`bind_identity` 的 5min grant 需覆蓋「mint→init→provider 同意→callback」。慢速使用者可能逾時 → `elevation_consumed`。Stage 1 frontend-only **不改 TTL**，只補友善逾時文案 + 可重綁。是否要後端調高 binding 場景 TTL ＝ 獨立 backend 決策（記 residual，非本 PR）。
  - 傾向：**Stage 1 接受逾時即重試**；TTL 調整另案評估。
- **OD-5（grant 在 session 撤銷後的殘留可用性，SR #2/#10）**：factor-add grant 綁 sid-字串、非 live session row；access token 殘留 ≤15min 內，pre-mint grant 於 session 撤銷後仍可被消費。**維持既有 access-token tradeoff（frontend PR 不改後端）** vs **後端加碼**（consume 時 re-validate live session status／縮 binding grant TTL）。
  - 傾向：**維持既有 tradeoff**（鑄 grant 已需第二因子＝已全面 compromise；本 PR frontend-only 不改後端時序；加碼屬獨立 backend 決策）。記 R4，交 gate 確認。

---

## 11. owner-accepted residuals（待 gate / owner 確認）
- **R1**：OAuth-only 帳號在 Stage 1 無法新增 factor，只有引導文案（功能於 Stage 2 補齊）。
- **R2**：`bind_identity` grant 在 provider 同意期間逾 5min → 需重綁（OD-4）。
- **R3**：若 OD-3 退為「抽純函式測」，modal/DOM 互動層無自動化覆蓋，靠 prod 無痕驗收。
- **R4**：factor-add grant 綁 sid-字串；access token 殘留 15min 內、session 撤銷後 grant 仍可消費（既有 access-token tradeoff，見 OD-5／§8）。

---

## 12. dimension-A self-review 裁決（workflow `wf_2ccd9b1b-41c`，7 維 14 accepted / 0 suspicious）

> v3 紀律：workflow raw 輸出**非**結論；以下為主線獨立讀 plan + code 後的裁決。**無 Tier-0 設計洞、無需後端改動。**

| SR# | 維度 | sev | 裁決 | 落點 |
|---|---|---|---|---|
| #11 | naming-ssot | t1 | **採納（最佳）** | §4.3/§6：i18n key `..._timeout`→`..._consumed`（鏡射後端 code、消 alias） |
| #8 | api-contract | t2 | **採納** | §3.1 `action: FactorAddAction` literal union |
| #3 | security-boundary | t1 | **採納** | §7 grant_token 洩漏防護 test + grep checklist |
| #2/#10 | security/state | t2 | **採納（文件化，不重構）** | §5.2 row + §8 sid-字串 binding tradeoff + OD-5/R4 |
| #1/#7 | security/api-contract | t1 | **採納（精確化）** | §4.3 明列 ERR_KEY 兩鍵 + i18n key |
| #4 | security-boundary | t2 | **採納（防禦）** | §3.2 回應形狀守衛 |
| #12 | spec-scope | t2 | **採納（精確化）** | §5.2 init-stage 403 vs callback-stage redirect 分列 |
| #13 | spec-scope | t2 | **採納（reframe 為前端 action 正確性）** | §7 per-caller action test |
| #5/#6 | migration | t2 | **部分採納** | banner 加 0054 前置一行；**拒** expansive Prerequisites 章（0054 已套 prod、down 註解已述不可逆） |
| #9 | api-contract | t1 | **已在 scope** | §6 本就列 8 碼；補 sentinel 驗證 |
| #14 | spec-scope | t2 | **已在 scope（最小化）** | §3.2 已列 429 文案；**拒**倒數計時（後端無 `retry_after`） |

13 條 refuted（主線同意）＝多為「文件可更清楚」非真洞：action-untrusted-input 重複指控（call site 全 hardcoded literal）、apiFetch header merge 過慮（`new Headers(opts.headers)` 既保留 caller header）、5min TTL 對 local ceremony 過慮（秒級）、`#elev_exchange` phishing 過慮（Stage 1 不啟用該路徑）等。
