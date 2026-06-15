# FACTOR-ADD 前端 elevation 接線 plan（Stage 2：OAuth-only OAuth-reauth elevation）

> **狀態**：`PLAN_DRAFT` → 待 dimension-A plan-self-review（§12）→ ChatGPT Arch Gate（§13）→ Codex Plan Gate（§14）。
> **分級**：L2（前端 feature 接線）+ **敏感熱區**（auth / factor-add / token / OAuth roundtrip）→ 三道基本外部審查全走（GPT Arch + Codex Plan + Codex Code）+ §5 高風險加碼 4 件。
> **前置裁決**：owner = **Option 2**；Stage 1（TOTP/password elevation）已 MERGED #84 `285b8987`，本 PR 接續 Stage 1 的 §1.2 OUT 項。
> **後端**：**零改動、無 migration**。整套 OAuth-reauth elevation primitive（`init?purpose=elevation` + `callback` 5a + `/api/auth/elevation/exchange`）已於 #77（PR-A2）建全並測全綠。本 PR 只補**前端跨 redirect ceremony 驅動**。
> **branch**：`feat/factor-add-elevation-stage2`。

---

## 0. 背景與定位

Stage 1（#84）讓**有 TOTP 或有密碼**的帳號能在單頁內鑄 factor-add grant（TOTP/password elevation modal → `/elevation/{totp,password}` → grant → 三 caller 帶 `X-Factor-Add-Grant` header）。Stage 1 對 **OAuth-only 帳號**（無 TOTP **且**無密碼）只顯示引導文案（`factor_add_no_channel`），不支援新增 factor。

Stage 2 補上 OAuth-only 帳號的唯一可信 elevation 管道：**用既有綁定的 OAuth provider 重新授權（OAuth-reauth）**證明本人 → 鑄 factor-add grant → 續原 factor-add ceremony。

### 0.1 後端 primitive（已建全，本 PR 不改）

| 階段 | 端點 / seam | 契約 |
|---|---|---|
| 啟動 | `GET /api/auth/oauth/[provider]/init?purpose=elevation&action=<action>` | `requireAuth` + sid fail-closed（`ELEVATION_SID_REQUIRED` 403）+ 驗 provider 既綁（`ELEVATION_PROVIDER_NOT_BOUND` 400）+ OD-3 早擋（該 provider 全 flagged → `CREDENTIAL_REVERIFICATION_REQUIRED` 403）+ RL `elevation_oauth_start` → 寫 `oauth_states(purpose='elevation')` → 回 **JSON `{ redirect_url }`**（非 302，因需先帶 Authorization；`init.ts:259-261`）|
| 回跳 | `GET /api/auth/oauth/[provider]/callback`（5a，`callback.ts:143-183`）| atomic 核銷 state → 換 token+profile → 驗回跳 `(provider, provider_id)` match 當前 user 既綁 identity（不 match → `auth.elevation.provider_mismatch` critical → `?elev_error=provider_mismatch`）→ **OD-3 D1 load-bearing**：matched identity flagged → `?elev_error=reverification_required`（**不**鑄 exchange）→ match 且非 flagged → 建一次性 `elevation_exchanges`（2min、session 綁、action 透傳、provider_id 只存 keyed-HMAC）→ **302 到 `dashboard.html#elev_exchange=<code>`**（fragment 交付，降 referer/server 暴露）|
| 換 grant | `POST /api/auth/elevation/exchange`，body `{ code }`（`exchange.ts`）| `requireAuth` + sid fail-closed + RL `elevation_exchange` → atomic consume `elevation_exchanges`（CAS：`user_id`+`session_id`+未過期+未消費）→ 0 row → `auth.elevation.replay_detected` critical + 401 `EXCHANGE_CODE_INVALID` → 成功 → `mintFactorAddGrant(method='oauth_reauth')` → 回 `{ grant_token, expires_in }`（grant_token 只經 body、不入 URL）|
| 消費 grant | factor-add 端點（`register-verify`/`wallet/verify`/`init?is_binding` callback）| `requireFactorAddGrant` 驗 `grant_token_hash`+`user_id`+`sid`+`action`+`purpose='factor_add'`（**不**驗 method）→ 同 `db.batch` CAS consume。故 `method='oauth_reauth'` grant 對「action 相符」的任一 ceremony 皆有效 |

### 0.2 與 OD-3（#83）的關係 —— 不衝突（必讀，防審查誤判）

OD-3 enforcement 移除的是「**OAuth-reauth 作為 flagged identity 的 self-reverify 管道**」（植入的 identity 自證無意義）。Stage 2 用的是「**非-flagged identity 的 OAuth-reauth 作為 factor-add elevation**」——**目的不同、對象不同**：

- self-reverify（OD-3）：清除某 identity 的 `requires_reverification` flag → owner-vouch 只接受 TOTP/password（獨立持有的因子），**禁** OAuth-reauth。
- factor-add elevation（Stage 2）：證明本人以鑄 grant 去**新增**因子 → OAuth-only 帳號用既綁 provider OAuth-reauth 是合法路徑。

且後端已 enforce OD-3：callback 5a 對 **flagged** matched identity **不鑄 exchange**（`?elev_error=reverification_required`）。Stage 2 前端 reauth 候選清單也只列**非-flagged** provider（§3.4），與後端 fail-closed 一致（前端只是 UX 早擋，後端是 SoT）。

---

## 1. 範圍

### 1.1 Stage 2 IN（本 PR，純前端）
1. **OAuth-reauth 啟動**：`obtainFactorAddGrant` 的 OAuth-only 分支（Stage 1 原本只彈引導文案）改為驅動 OAuth-reauth：選一個既綁、非-flagged 的 provider → `init?purpose=elevation&action=<action>` → JSON `{redirect_url}` → 整頁導去 provider。
2. **pending-action 跨 redirect 持久化**：導頁前把「要 resume 的 action（+ `bind_identity` 的 target provider）」寫進 `sessionStorage`（非敏感路由 context）。
3. **`#elev_exchange=<code>` fragment handler**：dashboard 載入時讀 fragment → 立即 `history.replaceState` 剝除 → 讀並清 pending context → `POST /elevation/exchange` 換 grant → 以 **preset grant** resume 原 ceremony。
4. **三 caller resume**：`addPasskey`/`addWallet`/`bindProvider` 加 optional `presetGrant` 參數；resume 直接帶 preset grant 跑原 ceremony（不再彈 modal）。
5. **`elev_error` 全集處理**：`checkBindResult` 補齊 callback 可能回的四種 `?elev_error=`（`provider_mismatch`/`rate_limited`/`invalid_state`/`reverification_required`）+ 清 pending context。
6. **i18n + 錯誤碼**：reauth modal、no-candidate 引導、resume-lost、exchange-failed、`elev_error` toast、redirecting label；`api.ts` API_ERROR_I18N 補 exchange/init 新碼。
7. **測試（§7）**：沿用 Stage 1 node:vm built-bundle harness（無 jsdom），補 outbound + resume 全鏈路斷言。
8. build `public/js` + cache-bust `?v=`（[[feedback_npm_build_not_copy]]／[[feedback_cache_bust_versioning]]）。

### 1.2 明確非目標（不做）
- **不**放寬／移除任何後端 gate（`requireFactorAddGrant`／OD-3 callback 5a flag-block／grant one-time CAS／TTL）。重開 SEC-FACTOR-ADD P1 = Tier 0 安全不可妥協。
- **不**動任何後端檔、不改 migration、不改 grant/exchange TTL。
- **不**把 OAuth-reauth 引入 reverify 路徑（§0.2；OD-3 已明令 reverify 只 owner-vouch）。
- **不**重構 Stage 1 的 TOTP/password elevation modal 或 `openReverifyModal`（[[feedback_security_boundary_pr_first_do_no_harm]]）。
- **不**把 grant_token / exchange code 寫進 sessionStorage / localStorage / URL / console / DOM（只在記憶體流轉，用完即棄）。

---

## 2. 設計總覽（ceremony）

```
OAuth-only 使用者點「新增 passkey / 綁 wallet / 綁新 provider」
        │
        ▼  obtainFactorAddGrant(action, {targetProvider?})
   hasTotp || hasPw ? ──► Stage 1 TOTP/password modal（本 PR 不碰）
        │ 皆無（OAuth-only）
        ▼  startOAuthReauthElevation(action, targetProvider?)
   候選 = window.__reauthProviders（非-flagged 既綁）排除 targetProvider
        ├─ 0 候選 ──► 引導文案（須先 reverify flagged identity / 聯絡客服）→ return null
        └─ ≥1 候選 ──► openReauthElevationModal：列 provider 按鈕
                            │ 使用者選 reauthProvider
                            ▼
                  apiFetch(GET init?purpose=elevation&action=<action>) → { redirect_url }
                            │ 成功才 persist sessionStorage {action, targetProvider?, ts}
                            ▼
                  window.location.href = redirect_url   （整頁導去 provider；modal 顯示「前往中」）
   ═══════════ 整頁 redirect 至 provider → 使用者同意 → 後端 callback 5a ═══════════
                            ▼
                  302 dashboard.html#elev_exchange=<code>
        ┌───────────────────────────────────────────────────────────────────────┐
        ▼  dashboard 載入 → checkElevExchange()（IIFE）
   讀 location.hash 的 code → history.replaceState 剝除 fragment
   讀並清 sessionStorage pending context（ts 過期則丟棄）
        │ 無 context / 無效 ──► resume-lost 文案（不 exchange，無從 resume）
        ▼
   apiFetch(POST /elevation/exchange {code}) → { grant_token }
        │ 無 grant_token ──► exchange-failed 文案（fail-closed，不續）
        ▼  dispatch（驗 action ∈ 3 known；bind_identity 驗 targetProvider ∈ BIND_PROVIDERS）
   add_passkey   → addPasskey({grant_token})    → register-options → create() → register-verify (header)
   bind_wallet   → addWallet({grant_token})     → eth_requestAccounts → nonce → sign → wallet/verify (header)
   bind_identity → bindProvider(target,{grant}) → init?is_binding (header) → 整頁 redirect → callback consume
```

`bind_identity` 是**雙 redirect**：reauth roundtrip（取 grant）→ binding roundtrip（用 grant 綁新 provider）。grant 5min TTL 覆蓋第二段（exchange→init→target 同意→callback consume）。

---

## 3. 前端模組設計（`src/js/dashboard.ts`）

### 3.1 `obtainFactorAddGrant(action, opts?)` — 擴 OAuth-only 分支
```ts
type FactorAddAction = 'add_passkey' | 'bind_wallet' | 'bind_identity';

async function obtainFactorAddGrant(
  action: FactorAddAction,
  opts?: { targetProvider?: string },
): Promise<{ grant_token: string } | null> {
  const hasTotp = !!window.__totpEnabled;
  const hasPw   = !!window.__hasPassword;
  if (hasTotp || hasPw) return openElevationModal(action, hasTotp);   // Stage 1，不改
  // OAuth-only：Stage 2 OAuth-reauth elevation
  return startOAuthReauthElevation(action, opts?.targetProvider);
}
```
- `opts.targetProvider` 只在 `bind_identity` 的 OAuth-reauth 用到（要 persist 才能 resume 對的 binding 目標）。`bindProvider` 傳 `{ targetProvider: provider }`；`addPasskey`/`addWallet` 不傳。

### 3.2 `startOAuthReauthElevation(action, targetProvider?)`
```ts
async function startOAuthReauthElevation(
  action: FactorAddAction, targetProvider?: string,
): Promise<{ grant_token: string } | null> {
  const candidates = (window.__reauthProviders ?? []).filter(p => p !== targetProvider);
  if (!candidates.length) { showBindToast(T('elev_reauth_no_candidate'), 'warn'); return null; }
  return openReauthElevationModal(action, candidates, targetProvider);
}
```
- 候選 = `window.__reauthProviders`（loadProfile 算出的「有 ≥1 非-flagged identity 的 provider」，§3.5）排除 `targetProvider`（綁新 provider 不能拿它自己 reauth）。
- 0 候選 → 引導文案（OAuth-only 但唯一 identity 已 flagged，或只剩 target 自己）。

### 3.3 `openReauthElevationModal(action, candidates, targetProvider?)` — **dedicated modal**
- 自帶 markup（仿 `openElevationModal`/`openReverifyModal` 視覺），每個 candidate provider 一顆按鈕（label 用既有 provider 名）。
- 回傳 `Promise<{grant_token}|null>`；語意：
  - 取消 / 點遮罩 / Esc → `resolve(null)`（caller 還原按鈕）。
  - 選 provider（async handler，含 `submitting` in-flight guard）：
    1. `apiFetch<{redirect_url?}>(GET /api/auth/oauth/<p>/init?purpose=elevation&action=<action>)`（same-origin，header 走 `apiFetch` 自動 Authorization）。
    2. 失敗 / 無 `redirect_url` → modal 內顯示錯誤（`tApiError`，403/429 走 API_ERROR_I18N 友善碼）+ 重置 `submitting` 可重試；**不** persist、**不**導頁。
    3. 成功 → `persistReauthPending({ action, targetProvider, ts: Date.now() })` → `window.location.href = data.redirect_url`，modal 切「前往中」狀態。**Promise 不 resolve**（整頁導航即將拆掉執行環境；await 永不完成是預期，非 leak）。
- **為何 dedicated（OD-3-frontend）**：與 Stage 1 elevation modal（收 OTP/密碼、單頁 resolve grant）控制流不同（這裡是「選 provider → 導頁、不在本頁 resolve」）；與 reverify modal（fire-and-forget reload）也不同。三者都在安全邊界，硬抽象會耦合三條安全流程。抽象判斷不過關（僅此一 caller 群、讀者更難懂），複製 ~15 行 markup 成本低、隔離性高（[[feedback_security_boundary_pr_first_do_no_harm]]）。

### 3.4 `#elev_exchange` fragment handler + resume
```ts
;(function checkElevExchange() {
  const m = (location.hash || '').match(/[#&]elev_exchange=([^&]+)/);
  if (!m) return;
  let code = ''; try { code = decodeURIComponent(m[1]); } catch { code = m[1]; }
  history.replaceState(null, '', '/dashboard.html');   // 立即剝除 fragment（防 reload 重觸 / 殘留）
  const ctx = readAndClearReauthPending();             // 讀並清；ts 過期→null
  void resumeFactorAddFromExchange(code, ctx);
})();

async function resumeFactorAddFromExchange(
  code: string, ctx: { action?: string; targetProvider?: string } | null,
): Promise<void> {
  if (!code) return;
  if (!ctx || !isFactorAddActionClient(ctx.action)) { showBindToast(T('elev_resume_lost'), 'warn'); return; }
  try {
    const data = await window.apiFetch<{ grant_token?: string }>('/api/auth/elevation/exchange', {
      method: 'POST', body: JSON.stringify({ code }),
    });
    if (typeof data?.grant_token !== 'string' || !data.grant_token) { showBindToast(T('elev_exchange_failed'), 'err'); return; }
    const grant = { grant_token: data.grant_token };
    if (ctx.action === 'add_passkey')      await addPasskey(grant);
    else if (ctx.action === 'bind_wallet') await addWallet(grant);
    else if (ctx.action === 'bind_identity' && BIND_PROVIDERS.some(p => p.id === ctx.targetProvider))
      await bindProvider(ctx.targetProvider as string, grant);
    else showBindToast(T('elev_resume_lost'), 'warn');
  } catch (e) { showBindToast(window.tApiError(e, T('net_err')), 'err'); }
}
```
- `isFactorAddActionClient(a): a is FactorAddAction` — 前端本地 runtime guard（`['add_passkey','bind_wallet','bind_identity'].includes(a)`），擋 sessionStorage 被竄改的 action。後端 grant action-bound CAS 仍是最終 fail-closed 防線（竄改只會讓 ceremony 失敗，無安全破口）。
- `bind_identity` dispatch 額外驗 `targetProvider ∈ BIND_PROVIDERS`（防竄改值被插進 init URL path）。
- 無 context（fragment 在、context 不在）→ resume-lost 文案，**不** exchange（沒 context 無從得知 resume 哪條 ceremony；code 自然 2min 過期，無害）。
- resume 用 **preset grant** 路徑（§4），不再彈 modal。

### 3.5 `loadProfile` 補 `window.__reauthProviders`
```ts
// data.identities：[{ provider, requires_reverification, ... }]
window.__reauthProviders = [...new Set(
  (data.identities ?? []).filter(i => !i.requires_reverification).map(i => i.provider)
)];
```
- 最小化：只存「可用於 reauth 的 provider 字串陣列」（非整包 identities）。Window interface 補 `__reauthProviders?: string[]`。
- 純 UX hint；後端 init 對 bound + 非-flagged 再驗一次（SoT）。

### 3.6 pending context 持久化（sessionStorage）
```ts
const REAUTH_PENDING_KEY = 'factor_add_reauth_pending';
const REAUTH_PENDING_TTL_MS = 10 * 60 * 1000;   // > grant 5min + 容裕；防陳舊 context

function persistReauthPending(ctx: { action: string; targetProvider?: string; ts: number }): void {
  try { sessionStorage.setItem(REAUTH_PENDING_KEY, JSON.stringify(ctx)); } catch { /* storage blocked */ }
}
function readAndClearReauthPending(): { action?: string; targetProvider?: string } | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(REAUTH_PENDING_KEY); sessionStorage.removeItem(REAUTH_PENDING_KEY); }
  catch { return null; }
  if (!raw) return null;
  try {
    const ctx = JSON.parse(raw);
    if (!ctx || typeof ctx.ts !== 'number' || Date.now() - ctx.ts > REAUTH_PENDING_TTL_MS) return null;  // 陳舊
    return ctx;
  } catch { return null; }
}
```
- **只存非敏感路由 context**（action 是公開 enum、targetProvider 是公開 provider 名、ts 是時戳）。**grant_token / exchange code 永不入 storage**。
- 寫入時機：**只在 init 成功、導頁前**（init 失敗不留陳舊 context）。
- 清除時機：(a) resume 讀即清；(b) `checkBindResult` 的 `elev_error` 分支清（redirect 出去但 callback 回 error，resume 不會觸發，須主動清）；(c) 新一次 reauth 覆寫。
- ts + TTL = 陳舊防禦（[[feedback_irreversible_action_full_review]] 級的縱深，非 load-bearing；真正一次性由後端 exchange code 2min one-time CAS 保證）。

---

## 4. 三 caller resume 接線（加 optional preset grant）

> 共同 pattern：`const grant = presetGrant ?? await obtainFactorAddGrant('<action>'[, opts]); if (!grant) { 還原按鈕; return; }`
> resume 直接帶 preset grant → 跳過 modal/reauth、直接跑寫入 ceremony。事件委派（document click delegation）呼叫時 `presetGrant` 為 undefined → 走 `obtainFactorAddGrant`（Stage 1 行為不變）。
> **設計理由（OD-resume）**：用顯式 preset 參數而非隱藏 module 變數 → 無 shared mutable state、resume 路徑可在 request 邊界直接斷言（[[feedback_security]]／基線禁 shared mutable state）。

### 4.1 `addPasskey(presetGrant?)`（`dashboard.ts:1826`）
- `const grant = presetGrant ?? await obtainFactorAddGrant('add_passkey');`
- 其餘不變（register-options → create() → register-verify 帶 header）。

### 4.2 `addWallet(presetGrant?)`（`dashboard.ts:2041`）
- `const grant = presetGrant ?? await obtainFactorAddGrant('bind_wallet');`
- 其餘不變（eth_requestAccounts → nonce → sign → wallet/verify 帶 header）。

### 4.3 `bindProvider(provider, presetGrant?)`（`dashboard.ts:772`）
- `const grant = presetGrant ?? await obtainFactorAddGrant('bind_identity', { targetProvider: provider });`
- 其餘不變（init?is_binding 帶 header → `window.location.href = redirect_url`）。
- resume 時 `presetGrant` = exchange 換來的 grant → 直接做 binding init → 第二段 redirect（雙 redirect 的下半）。

---

## 5. 高風險加碼 4 件（L2 + 敏感熱區，code 前先輸出）

### 5.1 State machine — exchange code + grant lifecycle（後端持有，前端只驅動）
| 物件 | 狀態轉移 | 觸發 |
|---|---|---|
| exchange code | (none)→minted | callback 5a：reauth match 非-flagged identity |
| exchange code | minted→consumed | `/elevation/exchange` CAS（user+session+未過期）唯一一次 |
| exchange code | minted→expired | 2min TTL |
| exchange code | minted→replay | 已用/過期/不屬本 session → 401 `EXCHANGE_CODE_INVALID` + `replay_detected` critical |
| grant | minted→consumed | factor-add 寫入同 batch CAS（action-bound）唯一一次 |
| grant | minted→expired | 5min TTL |
| pending ctx | persisted→consumed | resume 讀即清 / elev_error 清 / 覆寫 |

前端**不**自行追蹤後端狀態；一切以後端 CAS 為準。

### 5.2 Failure mode 列表
| 情境 | 前端行為 |
|---|---|
| OAuth-only 但無非-flagged 候選 provider | `elev_reauth_no_candidate` 引導（先 reverify flagged / 聯絡客服），return null |
| reauth init 403（`ELEVATION_PROVIDER_NOT_BOUND`／`CREDENTIAL_REVERIFICATION_REQUIRED`／`ELEVATION_SID_REQUIRED`） | modal 內友善錯誤（API_ERROR_I18N），可重試/取消；未 persist、未導頁 |
| reauth init 429（`RATE_LIMITED`） | 節流文案，可關閉 |
| callback 5a `provider_mismatch`（reauth 回非本人既綁） | `?elev_error=provider_mismatch` → `checkBindResult` warn + 清 context |
| callback 5a `reverification_required`（matched identity flagged，OD-3） | `?elev_error=reverification_required` → warn（引導去帳號綁定 reverify）+ 清 context |
| callback 5a `rate_limited` / `invalid_state` | 對應 `?elev_error=` warn + 清 context |
| fragment 在但 pending context 不在/陳舊 | `elev_resume_lost` 文案，不 exchange |
| exchange 401 `EXCHANGE_CODE_INVALID`（過期/已用/replay） | `tApiError`（API_ERROR_I18N）err 文案 |
| exchange 回無 `grant_token`（形狀守衛） | `elev_exchange_failed` fail-closed，不續 ceremony |
| resume 後 WebAuthn/SIWE 取消 | 還原按鈕；grant 未 consume，5min 後自然失效（無副作用）|
| `bind_identity` 第二段 binding 逾 grant 5min TTL | callback `bind_error=elevation_consumed` → `checkBindResult` 既有「逾時請重綁」|
| 取 grant 後直接關頁 | 無副作用（grant 失效）|
| reauth roundtrip 期間 access token 過期（<15min 窗）| exchange `apiFetch` 401 → silent-refresh → retry（既有 api.ts）；refresh 死則 SESSION_EXPIRED 硬登出 |

### 5.3 Idempotency 策略
- 寫入路徑既有按鈕 `disabled` 防雙擊；reauth modal provider 按鈕 + exchange submit 各有 `submitting` in-flight guard（防 Enter/雙擊 double-mint）。
- exchange code one-time CAS + grant one-time CAS（後端）：並發只有一個成功，另一個回 `EXCHANGE_CODE_INVALID`／`FACTOR_ADD_GRANT_CONSUMED`，前端翻成友善訊息。
- pending context 寫入即覆寫（單一 in-flight reauth），resume 讀即清 → 不會 resume 兩次。

### 5.4 Retry + timeout 策略
- reauth init 失敗（403/網路）→ modal 內可重試，上界＝後端 RL（`elevation_oauth_start` 10/300s，429 即止）。
- exchange 失敗（401）→ 不自動重試（code 已 one-time consume/過期，重試無意義）→ 顯示 err，使用者需重啟整個 reauth。
- 所有外呼走 `apiFetch`（既有 timeout/retry 紀律）；無新增 long-running/stream，無需 AbortSignal 新設計。

---

## 6. i18n + 錯誤碼對應

### 6.1 新 i18n key（`src/i18n/dashboard.json`，四語 zh-TW/en/ja/**ko**；[[feedback_i18n_multi_sentinel]] 驗 sentinel；ko 不可漏，[[feedback...]] Stage 1 #16 教訓）
- `elev_reauth_modal_title`、`elev_reauth_modal_hint`（「請用已綁定的帳號重新驗證以新增登入方式」）。
- `elev_reauth_provider_btn`（「用 ${p} 重新驗證」，`${p}` 模板填 provider label）。
- `elev_reauth_redirecting`（導頁中狀態）、`elev_reauth_cancel`。
- `elev_reauth_no_candidate`（無可用 reauth provider 引導）。
- `elev_resume_lost`（fragment 在但 context 遺失）。
- `elev_exchange_failed`（exchange 無 grant）。
- `elev_err_provider_mismatch`、`elev_err_rate_limited`、`elev_err_invalid_state`（callback `?elev_error=`；`reverification_required` 重用 Stage 1 既有 `elev_reverify_required`）。

### 6.2 `api.ts` API_ERROR_I18N 補碼（四語，防洩後端英文原文）
- `EXCHANGE_CODE_INVALID`（exchange 401）、`EXCHANGE_CODE_REQUIRED`（exchange 400）、`ELEVATION_PROVIDER_NOT_BOUND`（init 400）。
- 既有可重用：`CREDENTIAL_REVERIFICATION_REQUIRED`／`RATE_LIMITED`／`ELEVATION_SID_REQUIRED`／`INVALID_ACTION`／`INVALID_JSON`／`FACTOR_ADD_GRANT_CONSUMED`（Stage 1 已補）。

---

## 7. 測試策略（沿用 Stage 1 node:vm built-bundle harness，無 jsdom）

> root cause 同 Stage 1：缺 dashboard 全鏈路測試。Stage 2 必須補能抓「resume 沒帶 header / 送錯 action / context 遺失誤 resume / grant 洩漏」的測試。檔：擴 `tests/dashboard-factor-add-wiring.test.ts` 或新 `tests/dashboard-factor-add-stage2.test.ts`（傾向後者，隔離 Stage 2 場景）。

### 7.1 harness 擴充（在 Stage 1 harness 基礎上）
- `loc.hash` 欄位；`loadDashboard` opts 加 `hash?`（load 前設 `loc.hash`）、`pending?`（sessionStorage `getItem(REAUTH_PENDING_KEY)` 回該 JSON）、`reauthProviders?`（post-load 設 `window.__reauthProviders`）、`exchangeGrant?`（控 `/elevation/exchange` 回應，預設 `{grant_token: GRANT}`，可設 `{}` 測 fail-closed）。
- `apiFetch` spy 補：`/init?purpose=elevation` → `{redirect_url}`、`/elevation/exchange` → `{grant_token}` 或 `{}`。
- sessionStorage stub：`getItem(REAUTH_PENDING_KEY)` 回 pending、track `setItem`/`removeItem`（驗清除 + 驗無 grant 寫入）。
- `driveReauthProviderClick(d, provider)`：找 reauth modal 內該 provider 按鈕、呼其 click handler（仿 `driveModalSubmit`）。

### 7.2 測試案例（核心）
| # | 場景 | 斷言 |
|---|---|---|
| O1 | OAuth-only outbound `add_passkey`（reauthProviders=['discord']）| 選 discord → `init?purpose=elevation&action=add_passkey` for discord 被呼；sessionStorage persist `{action:'add_passkey'}`（**無 targetProvider**）；`loc.href`=redirect_url |
| O2 | OAuth-only outbound `bind_identity` target=google（reauthProviders=['discord']）| reauth modal 候選排除 google；選 discord → `init?purpose=elevation&action=bind_identity` for discord；persist `{action:'bind_identity', targetProvider:'google'}`；`loc.href`=redirect_url |
| O3 | OAuth-only 無候選（reauthProviders=[] 或只剩 target）| 引導 toast；**不**打任何 init/elevation；無 persist |
| O4 | reauth init 失敗（init 回 `{}`/403）| modal 內 err；**不** persist；**不**導頁 |
| R1 | resume `add_passkey`（hash=`#elev_exchange=CODE`, pending `{add_passkey}`）| `POST /elevation/exchange {code:'CODE'}` 被呼；`register-verify` 帶 `X-Factor-Add-Grant`==grant；fragment 已剝除（`history.replaceState` 呼叫 / hash 清空）；pending `removeItem` 被呼 |
| R2 | resume `bind_identity`（hash + pending `{bind_identity, google}`）| exchange → `bindProvider('google')` → `init?is_binding` for google 帶 header → `loc.href`=binding redirect |
| R3 | resume 無 context（hash 在、pending 無）| `elev_resume_lost` warn；**不**打 exchange |
| R4 | resume exchange fail-closed（exchange 回 `{}`）| **不**打任何 factor-add 端點；`elev_exchange_failed` err |
| R5 | resume context 竄改 action（pending `{action:'bogus'}`）| `elev_resume_lost`；不 dispatch |
| R6 | resume context 陳舊（ts 超 TTL）| 視同無 context → resume-lost；不 exchange |
| L1 | grant_token / exchange code 洩漏防護 | 整個 resume：grant/code **不**入 storageWrites（除 removeItem）、不入 console、不入 DOM textContent/innerHTML/value |
| E1 | `elev_error=provider_mismatch`（search）+ pending 在 | `checkBindResult` warn；pending `removeItem` 被呼（清陳舊）；URL 剝除 |
- CI 對齊（[[feedback_pre_merge_gate_checklist_match_ci]]）：本機跑齊 lint / ratchet / test:int / **test:cov** / build:functions，全綠才宣告。

---

## 8. 安全考量

- **後端 0 改動**：gate / CAS / TTL / sid / OD-3 callback 5a flag-block 全不變，SEC-FACTOR-ADD P1 封閉性完好。本 PR 只讓前端「合法驅動既有 OAuth-reauth elevation」。
- **不擴攻擊面**：exchange code 2min/one-time/session-bound（後端）；grant 5min/one-time/sid+action-bound（後端）；前端不持久化 grant/code（記憶體即棄）。
- **grant/code 不入 URL/log/storage**：exchange code 由 fragment 交付（瀏覽器不送 server、不入 Referer）→ 立即 `history.replaceState` 剝除 → POST body 換 grant；grant_token 只在記憶體傳到 header。sessionStorage 只放非敏感路由 context。
- **竄改防禦**：pending context 的 action 經本地 runtime guard + 後端 action-bound CAS 雙重把關；targetProvider 經 BIND_PROVIDERS 白名單；竄改最壞只造成 ceremony 失敗（後端 fail-closed），無提權。
- **OD-3 一致**：前端候選只列非-flagged provider（UX 早擋）；後端 callback 5a 對 flagged matched identity 不鑄 exchange（SoT）。§0.2 已釐清與 OD-3 self-reverify 的差異。
- **same-origin（R5 inherited）**：Stage 2 的 init / exchange 都是 dashboard same-origin `apiFetch`，不觸發 CORS preflight；exchange 用 Authorization + body，不用 `X-Factor-Add-Grant` header（grant header 只在 resume 後的 factor-add 寫入用，亦 same-origin）。`cors.ts` 不需改。
- **revoked session 殘留（inherited R4／OD-5）**：grant/exchange 綁 sid-字串、非 live session row；access token 殘留 ≤15min 內，pre-mint grant/code 於 session 撤銷後仍可能被消費。維持既有 access-token tradeoff（frontend PR 不改後端時序）；鑄 exchange 已需通過 OAuth-reauth（≈帳號已 compromise，factor-add 保護本就失效）→ 邊際風險可忽略。後端加碼屬獨立決策。

---

## 9. 變更檔清單 + 部署

| 檔 | 變更 |
|---|---|
| `src/js/dashboard.ts` | `obtainFactorAddGrant` OAuth-only 分支 + `startOAuthReauthElevation` + `openReauthElevationModal` + `checkElevExchange` IIFE + `resumeFactorAddFromExchange` + pending-context helpers + `isFactorAddActionClient` + 三 caller `presetGrant` 參數 + `loadProfile` 設 `__reauthProviders` + `checkBindResult` elev_error 全集 + Window interface `__reauthProviders?` |
| `src/js/api.ts` | API_ERROR_I18N 補 `EXCHANGE_CODE_INVALID`/`EXCHANGE_CODE_REQUIRED`/`ELEVATION_PROVIDER_NOT_BOUND`（四語） |
| `src/i18n/dashboard.json` | §6.1 新 key（四語含 ko）|
| `public/js/dashboard.js`、`public/js/api.js` | `npm run build` 產物（非手改）|
| `public/*.html` | cache-bust `?v=<git HEAD hash>`（[[feedback_cache_bust_versioning]]／[[feedback_backend_commit_still_needs_cache_bust]]）|
| `tests/dashboard-factor-add-stage2.test.ts` | §7 測試 |
| `docs/audit/RESUME.md` | 狀態回寫（Stage 2 merged）|

部署：feature branch → PR → squash（禁直推 main）；merge 後自動 Pages deploy；prod 無痕驗收（[[feedback_prod_verify_incognito]]）OAuth-only 帳號三條 factor-add。**無 D1 migration。**

---

## 10. Open Decisions（送 ChatGPT Arch Gate 裁）

- **OD-1（`bind_identity` 是否納入 Stage 2）**：OAuth-only 帳號綁「新」OAuth provider＝**雙 redirect**（reauth roundtrip 取 grant → binding roundtrip 用 grant），複雜度/風險最高。
  - 傾向：**納入**。owner 指示 Stage 2 涵蓋 `action=...`（三 action）；排除 bind_identity 會讓 OAuth-only 用戶無法綁第二個 provider（真實 gap）。雙 redirect 後端已支援、grant 5min 足夠覆蓋。風險用 §5.2 failure mode + §7 R2 鎖。若 Gate 認為風險過高，fallback＝Stage 2 只做 add_passkey/bind_wallet，bind_identity 留 Stage 3。
- **OD-2（reauth provider 選擇 UX）**：多 provider 時必須讓使用者選；單 provider 時。
  - 傾向：**一律列候選按鈕**（1 個就 1 顆），明確讓使用者知道用哪個帳號 reauth。不自動靜默導頁（避免使用者不知為何跳去 provider）。
- **OD-resume（resume dispatch 機制）**：caller 加 explicit `presetGrant` 參數 **vs** 隱藏 one-shot module 變數。
  - 傾向：**explicit preset 參數**（無 shared mutable state、request 邊界可斷言、callers 簽名誠實）。
- **OD-3-frontend（reauth modal 共用度）**：dedicated `openReauthElevationModal` **vs** 泛化共用 Stage 1 elevation modal。
  - 傾向：**dedicated**（控制流不同：選 provider→導頁 vs 收因子→resolve；do-no-harm）。
- **OD-4（pending context 持久化 + 陳舊防禦）**：`sessionStorage` + ts/TTL guard **vs** 純 consume（不加 ts）。
  - 傾向：**sessionStorage + ts/TTL**（cheap 縱深；真正一次性靠後端 exchange code 2min CAS）。確認 sessionStorage 跨 OAuth roundtrip 存活（同 tab+同 origin 導外回來保留，既有 OAuth login `_cross_app_redirect` 已依賴此性質，`callback.ts:474-477`）。
- **OD-5（grant TTL 跨 bind_identity 雙 redirect，inherited Stage 1 OD-4）**：5min grant 需覆蓋 exchange→init→target 同意→callback。慢速使用者可能逾時→`elevation_consumed`。
  - 傾向：**Stage 2 接受逾時即重綁**（frontend-only 不改 TTL）；後端調 TTL = 獨立決策，記 residual。

---

## 11. owner-accepted residuals（待 gate / owner 確認）
- **R1**：OAuth-only 帳號唯一 identity 已 flagged（high-risk）→ 無 reauth 候選、也無 owner-vouch 管道（無 TOTP/密碼）→ 只能聯絡客服。屬 OD-3 high-risk corner（既有設計），Stage 2 顯示引導文案。
- **R2**：`bind_identity` 雙 redirect 逾 grant 5min → 需重綁（OD-5）。
- **R3**：grant/exchange 綁 sid-字串；access token 殘留 15min 內、session 撤銷後仍可消費（既有 access-token tradeoff，§8）。
- **R4（inherited Stage 1 R5）**：Stage 2 僅 same-origin；跨 origin factor-add caller 需後端 `cors.ts` 加 `X-Factor-Add-Grant` allow-header＝另案 backend plan（本 PR 不做）。
- **R5**：reauth provider 候選用 `window.__reauthProviders`（UX hint，TOCTOU 容許）；flag 在 dashboard session 中途變動時，前端可能列出已 flagged 的 provider → init 403 graceful（§5.2）。

---

## 12. dimension-A plan-self-review 裁決
> （待跑 `.claude/workflows/plan-self-review.mjs`，scriptPath 調用，`args.planDocPath` 指本檔 → 主線獨立讀 plan 裁決後填）

## 13. ChatGPT Arch Gate 裁決
> （待 Arch Gate r1 後填）

## 14. Codex Plan Gate 裁決
> （待 Codex Plan Gate 後填）
