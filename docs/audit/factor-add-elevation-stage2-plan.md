# FACTOR-ADD 前端 elevation 接線 plan（Stage 2：OAuth-only OAuth-reauth elevation）

> **狀態**：`CODE_FAITHFULNESS_APPROVED`（**Dual Gate v3 全閉環**：Plan＝self-review §12 ＋ ChatGPT Arch APPROVED §13 ＋ Codex Plan CODING_ALLOWED §14｜Code＝code-self-review §15〔RACE-3 fix + O7〕＋ Codex Code CODE_APPROVED §16 ＋ **ChatGPT Faithfulness APPROVED §17**〔code @ `bae2e9b3`〕）→ **ready squash-merge**（待 owner 授權 push/PR）。
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
    1. `apiFetch<{redirect_url?}>(GET /api/auth/oauth/${encodeURIComponent(reauthProvider)}/init?purpose=elevation&action=${action})`（same-origin，header 走 `apiFetch` 自動 Authorization）。**A1**：`encodeURIComponent` reauth provider path segment（即使候選已 §3.5 whitelist 過、server-sourced string 仍不裸進 path，defense-in-depth）。
    2. 失敗 / 無 `redirect_url` → modal 內顯示錯誤（`tApiError`，403/429 走 API_ERROR_I18N 友善碼）+ 重置 `submitting` 可重試；**不** persist、**不**導頁。
    3. 成功 → **先 persist 再導頁，且 persist 須成功**（A2）：`if (!persistReauthPending({ action, targetProvider, ts: Date.now() })) { modal 顯示 T('elev_reauth_storage_blocked') 錯誤 + 重置 submitting；不導頁；return; }` → 通過才 `window.location.href = data.redirect_url`，modal 切「前往中」狀態。**Promise 不 resolve**（整頁導航即將拆掉執行環境；await 永不完成是預期，非 leak）。
      - **A2 理由**：`persistReauthPending` 回 `boolean`（§3.6）；storage 被封鎖（無痕/隱私模式邊角）時若仍導頁，使用者會白做整段 OAuth roundtrip 才撞 `resume-lost`。先確認 persist 成功再導頁＝避免該 silent 失敗。
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
    // skipRefresh（HR-F3 fix）：exchange code 是 one-time。若用 apiFetch 預設 401→silent-refresh→retry，
    // 對「code 無效/過期/replay」的 401 `EXCHANGE_CODE_INVALID` 會 retry 同一死 code、第二次仍 401 →
    // apiFetch 把它誤判成 SESSION_EXPIRED 並**硬登出**（`api.ts:256-261`，footgun）。改 skipRefresh:true：
    // SESSION_REVOKED 仍硬登出（`api.ts:244` 的檢查在 skipRefresh 之前、不受其影響）；其餘 401 直接以原 code
    // 拋 ApiError → resume catch → 友善錯誤、不登出。token 過期（罕見）→ 不 auto-refresh、走重啟（§5.2/R6）。
    const data = await window.apiFetch<{ grant_token?: string }>('/api/auth/elevation/exchange', {
      method: 'POST', body: JSON.stringify({ code }), skipRefresh: true,
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
  - **`BIND_PROVIDERS` ＝既有 module-level `const`（`src/js/dashboard.ts:720`）**：`[{id,label,color}]` 四筆 `google/discord/line/facebook`。**靜態白名單、非 server-sourced → 無 TOCTOU**（與 `window.__reauthProviders` 不同，後者是 UX hint 容 TOCTOU）。module const 在任何 caller 之前初始化；`checkElevExchange` IIFE 與 `resumeFactorAddFromExchange` 皆在 module eval 後（async）才存取，無 TDZ。
  - **apple 不在 BIND_PROVIDERS**（後端 `init.ts:96` apple 回 `APPLE_LOGIN_NOT_AVAILABLE` 503，本就不可綁）→ 前端白名單 4 筆刻意為後端可綁集合子集。竄改 `targetProvider` 為 apple/未知值 → dispatch 不命中 → `elev_resume_lost`（§7.2 tamper test）。
- 無 context（fragment 在、context 不在）→ resume-lost 文案，**不** exchange（沒 context 無從得知 resume 哪條 ceremony；code 自然 2min 過期，無害）。
- resume 用 **preset grant** 路徑（§4），不再彈 modal。

### 3.5 `loadProfile` 補 `window.__reauthProviders`
```ts
// data.identities：[{ provider, requires_reverification, ... }]
// A1 hardening：交集 BIND_PROVIDERS（已知 OAuth 集合）→ server-sourced provider 不裸放進 reauth 候選/path。
const KNOWN = new Set(BIND_PROVIDERS.map(b => b.id));
window.__reauthProviders = [...new Set(
  (data.identities ?? [])
    .filter(i => !i.requires_reverification)
    .map(i => i.provider)
    .filter(p => KNOWN.has(p))          // A1：只留已知 provider（防 enum 漂移 / 髒值進 path）
)];
```
- 最小化：只存「可用於 reauth 的 provider 字串陣列」（非整包 identities）。Window interface 補 `__reauthProviders?: string[]`。
- 純 UX hint；後端 init 對 bound + 非-flagged 再驗一次（SoT）。reauth 候選 ⊆ `BIND_PROVIDERS`（可綁＝可 reauth；apple 不在集合）。
- **TDZ 安全**：此段在 `loadProfile` 的 `await /api/auth/me` **之後**（與既有 `__hasPassword`/`__totpEnabled` 同處 ~`dashboard.ts:226`），執行已是 module eval 後的 microtask → `BIND_PROVIDERS`（const `:720`）早已初始化，引用無 TDZ。

### 3.6 pending context 持久化（sessionStorage）
```ts
const REAUTH_PENDING_KEY = 'factor_add_reauth_pending';
const REAUTH_PENDING_TTL_MS = 10 * 60 * 1000;   // > grant 5min + 容裕；防陳舊 context

function persistReauthPending(ctx: { action: string; targetProvider?: string; ts: number }): boolean {
  // A2：回 boolean。寫入失敗（storage blocked）→ 回 false，caller 不導頁（避免 roundtrip 後 silent resume-lost）。
  try { sessionStorage.setItem(REAUTH_PENDING_KEY, JSON.stringify(ctx)); return true; } catch { return false; }
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
- **存活性（HR-F5）**：sessionStorage 綁 tab+origin、**與 HTML 版本無關** → roundtrip 期間即使有新 deploy 換了 `?v=` cache-bust hash、回跳載入新 `dashboard.js`，pending context 仍在（新 bundle 讀同一 key）。**per-tab 隔離**：多分頁各自獨立 reauth 不互擾（sessionStorage 非跨 tab 共享）。此性質與既有 OAuth login 的 `_cross_app_redirect`／`access_token`（`callback.ts:472-484`）相同、已在 prod 驗證。

### 3.7 `checkBindResult` 的 `elev_error` 全集處理（error path，對稱 §3.4 happy path）

> SS-F1/F4：§3.4 給了 happy-path（`#elev_exchange`）pseudocode，error-path（`?elev_error=`）也須在設計層給出，避免 implementer 從 §5.2/§7 拼湊。

`checkBindResult`（既有 IIFE `dashboard.ts:688`）已處理 `?bind=`/`?bind_error=`/`?elev_error=reverification_required`。Stage 2 把 `elev_error` 擴成**全集 + 統一清理**：
```ts
const elevError = sp.get('elev_error');
if (elevError) {
  history.replaceState(null, '', '/dashboard.html');   // 先剝 URL（與 §3.4 line 145 一致）
  readAndClearReauthPending();                          // 清陳舊 pending context（redirect 出去但 callback 回 error）
  // elev_error param（後端 callback 名）→ i18n key（前端名）的顯式 map，鏡射 Stage 1 bind_error→bind_err_* 慣例
  const ELEV_ERR_KEY = {
    provider_mismatch:       'elev_err_provider_mismatch',
    rate_limited:            'elev_err_rate_limited',
    invalid_state:           'elev_err_invalid_state',
    reverification_required: 'elev_reverify_required',   // 重用 Stage 1 既有 key（不另造，[[feedback_state_machine_naming_no_alias]]）
  };
  setTimeout(() => showBindToast(T(ELEV_ERR_KEY[elevError] ?? 'elev_err_generic'), 'warn'), 600);
  return;                                                // 不續 exchange；未知 code → fallback elev_err_generic（fail-closed）
}
```
- **順序固定**：剝 URL → 清 context → toast（與 happy path 一致）。
- **NS-F5（param vs key 前綴）**：`elev_error=<x>` 是後端 callback 參數名；`elev_err_<x>` 是前端 i18n key。兩者用**顯式 `ELEV_ERR_KEY` map** 橋接（非字串拼接），與 Stage 1 `bind_error`→`bind_err_*`（`dashboard.ts:701` `ERR_KEY`）同慣例 → 非 drift、無隱式耦合。
- **NS-F1（`bind_error` vs `elev_error` 兩 namespace）**：兩者都是**後端 callback 決定、frozen（後端零改）**：`?bind_error=`＝binding callback（`factor_add_binding`，`callback.ts:189-227`，含 `elevation_consumed` 逾時）；`?elev_error=`＝elevation callback（`purpose=elevation` 5a，`callback.ts:111/146/156/168`）。前端只**鏡射**，**不**重命名（不可改後端）。`checkBindResult` 同時處理兩 namespace（Stage 1 已處理 `bind_error`、Stage 2 補 `elev_error` 全集）。
- 取代既有 line 694 的單一 `reverification_required` 分支。

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
| **grant 在 exchange 後、register-verify/wallet-verify 前逾 5min**（慢速 WebAuthn/SIWE，HR-F6）| 寫入端回 403 `FACTOR_ADD_ELEVATION_REQUIRED` → caller `catch` 走 `tApiError` 友善錯誤 → 使用者重啟（與 bind_identity 的 `elevation_consumed` 同類、不同 code/path）|
| **exchange 階段 access token 過期**（罕見：token 將屆期 + 慢速 roundtrip）| exchange 用 `skipRefresh:true`（HR-F3）→ 401 不 auto-refresh → `elev_exchange_failed` err → 使用者重啟 reauth。換取「不對 invalid code 誤登出」；token 15min/code 2min，此窗極窄（§5.4／R6）|

### 5.3 Idempotency 策略
- 寫入路徑既有按鈕 `disabled` 防雙擊；reauth modal provider 按鈕 + exchange submit 各有 `submitting` in-flight guard（防 Enter/雙擊 double-mint）。
- exchange code one-time CAS + grant one-time CAS（後端）：並發只有一個成功，另一個回 `EXCHANGE_CODE_INVALID`／`FACTOR_ADD_GRANT_CONSUMED`，前端翻成友善訊息。
- pending context 寫入即覆寫（單一 in-flight reauth），resume 讀即清 → 不會 resume 兩次。

### 5.4 Retry + timeout 策略（HR-F3：明確區分各呼叫的 refresh 行為，消 §5.2 矛盾）
- **reauth init**（`openReauthElevationModal`）→ **走 apiFetch 預設**（401 token 過期 → silent-refresh → retry；init 無 one-time payload，retry 安全可自我恢復）。init 失敗（403/網路）→ modal 內可重試，上界＝後端 RL（`elevation_oauth_start` 10/300s，429 即止）。
- **exchange**（`/elevation/exchange`）→ **`skipRefresh:true`、不自動重試**。理由：exchange code one-time，retry 同一死 code 無意義且觸發 apiFetch 把 `EXCHANGE_CODE_INVALID` 401 誤判 `SESSION_EXPIRED` → 登出（footgun，§3.4）。401 → 直接顯示 `elev_exchange_failed`/`tApiError`，使用者重啟。**唯 `SESSION_REVOKED` 仍硬登出**（`api.ts:244` ungated）。
- **factor-add 寫入**（register-verify/wallet-verify/binding init）→ **走 apiFetch 預設**：grant 只在寫入成功時 consume，401（token 過期、pre-consume）→ silent-refresh → retry 帶同一 grant → 成功（grant 不浪費，retry 安全）。
- 所有外呼走 `apiFetch`（既有 timeout 紀律）；無新增 long-running/stream，無需 AbortSignal 新設計。

---

## 6. i18n + 錯誤碼對應

### 6.1 新 i18n key（`src/i18n/dashboard.json`，四語 zh-TW/en/ja/**ko**；[[feedback_i18n_multi_sentinel]] 驗 sentinel；ko 不可漏，[[feedback...]] Stage 1 #16 教訓）
- `elev_reauth_modal_title`、`elev_reauth_modal_hint`（「請用已綁定的帳號重新驗證以新增登入方式」）。
- `elev_reauth_provider_btn`（「用 ${p} 重新驗證」，`${p}` 模板填 provider label）。
- `elev_reauth_redirecting`（導頁中狀態）、`elev_reauth_cancel`。
- `elev_reauth_no_candidate`（無可用 reauth provider 引導）。
- `elev_reauth_storage_blocked`（A2：sessionStorage 被封鎖無法持久化 pending → 提示改用一般視窗/解除隱私限制再試）。
- `elev_resume_lost`（fragment 在但 context 遺失）。
- `elev_exchange_failed`（exchange 無 grant）。
- `elev_err_provider_mismatch`、`elev_err_rate_limited`、`elev_err_invalid_state`、`elev_err_generic`（未知 `elev_error` 的 fallback）（callback `?elev_error=`；`reverification_required` 重用 Stage 1 既有 `elev_reverify_required`）。
- **sealed-union 型別（AC-F2）**：前端定義 `type ElevError = 'provider_mismatch' | 'rate_limited' | 'invalid_state' | 'reverification_required'` 供 `ELEV_ERR_KEY` map key 對齊（與 `FactorAddAction` 同型，新增 callback error code 須同步改型別+map+i18n+後端＝breaking，tsc 即擋）。**不**在 callback 回應加 version 欄（over-engineering：callback 是 302 redirect 不是 JSON contract；§14 拒）。

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
| O5 | `persistReauthPending` 寫入失敗（sessionStorage.setItem throw，A5）| modal 顯示 `elev_reauth_storage_blocked` err；**不**導頁（`loc.href` 不變）；無 pending 殘留 |
| O6 | `__reauthProviders` 含髒值/未知 provider（A4）| 髒值不列入候選按鈕（§3.5 filter）；選合法候選 → init path 為 `encodeURIComponent` 後的 provider；全髒 → `elev_reauth_no_candidate` |
| R1 | resume `add_passkey`（hash=`#elev_exchange=CODE`, pending `{add_passkey}`）| `POST /elevation/exchange {code:'CODE'}` 被呼；`register-verify` 帶 `X-Factor-Add-Grant`==grant；fragment 已剝除（`history.replaceState` 呼叫 / hash 清空）；pending `removeItem` 被呼 |
| R2 | resume `bind_identity`（hash + pending `{bind_identity, google}`）| exchange → `bindProvider('google')` → `init?is_binding` for google 帶 header → `loc.href`=binding redirect |
| R3 | resume 無 context（hash 在、pending 無）| `elev_resume_lost` warn；**不**打 exchange |
| R4 | resume exchange fail-closed（exchange 回 `{}`）| **不**打任何 factor-add 端點；`elev_exchange_failed` err |
| R5 | resume context 竄改 action（pending `{action:'bogus'}`）| `elev_resume_lost`；不 dispatch |
| R6 | resume context 陳舊（ts 超 TTL）| 視同無 context → resume-lost；不 exchange |
| R7 | resume `bind_identity` 但 `targetProvider` 不在 BIND_PROVIDERS（pending `{bind_identity,'evil'}`，SB-F2）| 不 dispatch、**不**呼 `bindProvider`；`elev_resume_lost` |
| R8 | exchange 呼叫帶 `skipRefresh:true`（HR-F3）| spy 記錄的 `/elevation/exchange` call `init.skipRefresh === true`（dashboard 端責任；apiFetch 「invalid-code 不誤登出」行為由 `api-session-revoked.test.ts` 覆蓋）|
| L1 | grant_token / exchange code 洩漏防護 | 整個 resume：grant/code **不**入 storageWrites（除 removeItem）、不入 console、不入 DOM textContent/innerHTML/value |
| E1 | `elev_error=provider_mismatch`（search）+ pending 在 | `checkBindResult` warn；pending `removeItem` 被呼（清陳舊）；URL 剝除 |
| E2 | `elev_error=rate_limited` + pending 在 | `elev_err_rate_limited` warn；pending removeItem；URL 剝除 |
| E3 | `elev_error=invalid_state` + pending 在 | `elev_err_invalid_state` warn；pending removeItem；URL 剝除 |
| E4 | `elev_error=reverification_required` | `elev_reverify_required` warn（重用 Stage 1 key）；URL 剝除 |
| E5 | `elev_error=<unknown>` | `elev_err_generic` fallback warn（fail-closed）|
- **migration 前置（MIG-F4）**：Stage 2 為 frontend-only、不新增 migration。所依賴的 0054（elevation_grants/elevation_exchanges/oauth_states elevation 欄）/ 0055（requires_reverification）round-trip 已在 `tests/integration/migrations.test.ts`（0054 §1108-1184、0055 §1190-1272）覆蓋；本 PR 前端測試**假設** post-0054/0055 schema 已存在（prod 自 #75/#80 已套），不再重驗 migration。
- CI 對齊（[[feedback_pre_merge_gate_checklist_match_ci]]）：本機跑齊 lint / ratchet / test:int / **test:cov** / build:functions，全綠才宣告。

---

## 8. 安全考量

- **後端 0 改動**：gate / CAS / TTL / sid / OD-3 callback 5a flag-block 全不變，SEC-FACTOR-ADD P1 封閉性完好。本 PR 只讓前端「合法驅動既有 OAuth-reauth elevation」。
- **不擴攻擊面**：exchange code 2min/one-time/session-bound（後端）；grant 5min/one-time/sid+action-bound（後端）；前端不持久化 grant/code（記憶體即棄）。
- **grant/code 不入 URL/log/storage**：exchange code 由 fragment 交付（瀏覽器不送 server、不入 Referer）→ 立即 `history.replaceState` 剝除 → POST body 換 grant；grant_token 只在記憶體傳到 header。sessionStorage 只放非敏感路由 context。
- **竄改防禦（A3，措辭精確）**：pending context 的 action 經本地 runtime guard + 後端 action-bound CAS 雙重把關；targetProvider 經 BIND_PROVIDERS 白名單。竄改 `action`/未知 `targetProvider` → ceremony 失敗（fail-closed）。竄改 `targetProvider` 為**另一合法** BIND_PROVIDERS 值（如 google→discord）→ 可能改成綁該 provider（非必然失敗）；但**綁的仍是使用者本人在該 provider 的 OAuth 同意結果**（第二段 binding callback 是 user 自己的授權），grant action-bound + one-time、後端 CAS 為 SoT → **無提權、不綁到攻擊者帳號**，且需 same-origin script / 本機 storage 竄改前提（≈瀏覽器已失陷）。
- **OD-3 一致**：前端候選只列非-flagged provider（UX 早擋）；後端 callback 5a 對 flagged matched identity 不鑄 exchange（SoT）。§0.2 已釐清與 OD-3 self-reverify 的差異。
- **same-origin（R5 inherited）**：Stage 2 的 init / exchange 都是 dashboard same-origin `apiFetch`，不觸發 CORS preflight；exchange 用 Authorization + body，不用 `X-Factor-Add-Grant` header（grant header 只在 resume 後的 factor-add 寫入用，亦 same-origin）。`cors.ts` 不需改。
- **tenant-scope（TS-F3/F4，user-scoped by design）**：elevation grant/exchange 綁 `user_id + session_id`、**刻意非 tenant-scoped**——它們新增的 factor（passkey/wallet/OAuth identity）都是 **user-global**（跨租戶共用，非 tenant 資源），故 elevation 是「證明帳號擁有權」的 step-up、不涉 tenant 邊界（migration 0054 表無 `tenant_id` 為正確設計，非遺漏）。**token refresh 期間 tenant 重 derive**（`refresh.ts` → personal_tenant）對 factor-add **無影響**：exchange/grant CAS 只比對 user+session（不讀 tenant claim），factor-add 寫入也不依 tenant context。此為後端既有行為、Stage 2 frontend 不觸碰；若未來 elevation 變成 tenant 特權操作前置，須重審（非本 PR scope）。
- **revoked session 殘留（inherited R4／OD-5）**：grant/exchange 綁 sid-字串、非 live session row；access token 殘留 ≤15min 內，pre-mint grant/code 於 session 撤銷後仍可能被消費。維持既有 access-token tradeoff（frontend PR 不改後端時序）；鑄 exchange 已需通過 OAuth-reauth（≈帳號已 compromise，factor-add 保護本就失效）→ 邊際風險可忽略。後端加碼屬獨立決策。

---

## 9. 變更檔清單 + 部署

### 9.0 Prerequisites & Contract Phase（MIG-F1/F2）
- **Prerequisites（上游 migration）**：0054（elevation_grants/elevation_exchanges/oauth_states elevation 欄，#75）+ 0055（requires_reverification，#80）**已 applied+verified prod**；target 環境須已套兩者（prod 已套）。本 PR **不新增** migration。
- **Contract phase：不適用**。Stage 2 純前端、無 schema 改動 → 無 expand/migrate/contract。
- **不新增 schema 依賴**：Stage 2 前端**不直接** query D1，全走後端端點；0054/0055 的 runtime 依賴**早已**隨 #77/#78/#80/#83 在 prod 生效（後端既有）。故「rollback 0054/0055.down 會打斷 runtime」對既有後端**已成立**、非 Stage 2 引入；真要 rollback schema 須先回退那些後端 PR（一向如此），本 PR 不改變該 invariant。

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
- **OD-7（exchange 401 的 refresh 處理，HR-F3）**：exchange 用 `skipRefresh:true`、所有 401 視為「exchange 失敗→重啟」（簡單、消除 invalid-code 誤登出 footgun）**vs** 手動分支（對「非 EXCHANGE_CODE_* 的 401」`silentRefresh()` 一次再重打，保住「token 恰過期但 code 仍有效」的 auto-recover）。
  - 傾向：**`skipRefresh:true` 簡單版**（baseline 不過度工程；scenario-2 罕見、退化僅「重啟」非登出）。手動分支列 fallback（R6），gate 認為值得保 auto-recover 再加。

---

## 11. owner-accepted residuals（待 gate / owner 確認）
- **R1**：OAuth-only 帳號唯一 identity 已 flagged（high-risk）→ 無 reauth 候選、也無 owner-vouch 管道（無 TOTP/密碼）→ 只能聯絡客服。屬 OD-3 high-risk corner（既有設計），Stage 2 顯示引導文案。
- **R2**：`bind_identity` 雙 redirect 逾 grant 5min → 需重綁（OD-5）。
- **R3**：grant/exchange 綁 sid-字串；access token 殘留 15min 內、session 撤銷後仍可消費（既有 access-token tradeoff，§8）。
- **R4（inherited Stage 1 R5）**：Stage 2 僅 same-origin；跨 origin factor-add caller 需後端 `cors.ts` 加 `X-Factor-Add-Grant` allow-header＝另案 backend plan（本 PR 不做）。
- **R5**：reauth provider 候選用 `window.__reauthProviders`（UX hint，TOCTOU 容許）；flag 在 dashboard session 中途變動時，前端可能列出已 flagged 的 provider → init 403 graceful（§5.2）。
- **R6（HR-F3 trade-off）**：exchange 用 `skipRefresh:true` → 罕見情境（access token 恰在 roundtrip 中過期 + exchange code 仍有效）不 auto-refresh、退回「重啟 reauth」。換取「對 invalid/expired/replay code 的 401 不誤登出」（更常見、傷害更大）。token 15min/code 2min，重疊窗極窄；接受此退化。若 gate 要求保住該情境，fallback＝resume 對「非 EXCHANGE_CODE_* 的 401」手動 `silentRefresh()` 一次再重打（多一分支，§10 OD-7）。

---

## 12. dimension-A plan-self-review 裁決（workflow `wf_0f503e7c-d69`，44 agents，7 維 × finder→對抗式 verify）

> v3 紀律：workflow raw 輸出**非**結論。以下為主線獨立讀 plan + 核對 code（`dashboard.ts`/`api.ts`/`elevation.ts`/`callback.ts`）後的裁決。workflow 回報 **accepted 18 / suspicious_input 0**；其中**多數實為「確認 plan 已列的 scope 項」或「文件可更自足」**，**唯 1 條為實質正確性修補（HR-F3）**。**無 Tier-0 設計洞、無需後端改動。**

### 12.1 實質正確性修補（已改 plan 設計）
| ID | 維度 | 裁決 | 落點 |
|---|---|---|---|
| **HR-F3** | high-risk-idempotency t1 | **採納（最有價值）** | §5.2／§5.4 自相矛盾（exchange 是否 auto-retry）＋**logout footgun**：`/elevation/exchange` 走 apiFetch 預設 401→refresh→retry，會對 `EXCHANGE_CODE_INVALID` retry 死 code、第二次 401 被 `api.ts:256-261` 誤判 `SESSION_EXPIRED` **登出**。→ **fix：exchange 帶 `skipRefresh:true`**（§3.4）；§5.2/§5.4 重寫對齊（SESSION_REVOKED 仍硬登出；token 過期罕見→重啟＝R6）；新增 §7.2 R8 斷言。 |

### 12.2 文件/規格自足性（已補 plan，無設計變更）
| ID | 維度 | 落點 |
|---|---|---|
| SB-F2（+ security BIND_PROVIDERS 重複指控） | security-boundary t2 | §3.4：`BIND_PROVIDERS` 來源（`dashboard.ts:720`、4 筆、靜態白名單無 TOCTOU、apple 排除理由）＋ §7.2 R7 tamper test |
| SS-F1／SS-F4／NS-F5／NS-F1／AC-F6（handlers） | spec-scope t1 / naming t2 / api t1 | **新增 §3.7**：`checkBindResult` `elev_error` 全集 error-path pseudocode ＋ 顯式 `ELEV_ERR_KEY` map（param→i18n key，鏡射 Stage 1 `bind_error`→`bind_err_*`）＋ `bind_error`/`elev_error` 兩 namespace 皆後端 frozen 的釐清 |
| SS-F2 | spec-scope t2 | §7.2 新增 E2/E3/E4/E5（rate_limited/invalid_state/reverification_required/unknown fallback） |
| HR-F6 | high-risk t2 | §5.2 新增「grant 在 exchange 後、寫入前逾 5min」failure row（403 `FACTOR_ADD_ELEVATION_REQUIRED`→重啟） |
| HR-F5 | high-risk t2 | §3.6：sessionStorage 跨 cache-bust reload 存活 + per-tab 隔離 note |
| TS-F3／TS-F4 | tenant-scope t2 | §8：elevation user+session-scoped by design（factors user-global，0054 無 tenant_id 為正確）；token-refresh tenant 重 derive 對 factor-add 無影響 |
| MIG-F1／MIG-F2 | migration t2 | §9.0 Prerequisites & Contract Phase（0054/0055 已 prod；無 expand/migrate/contract；不新增 schema 依賴） |
| MIG-F4 | migration t3 | §7：migration round-trip 由 `migrations.test.ts` 覆蓋、前端測試假設 post-0054/0055 |
| AC-F2 | api-contract t2 | §6.1：`type ElevError` sealed union note；**拒** callback response version 欄（302 非 JSON contract，over-eng） |

### 12.3 已在 scope（workflow 標 accepted＝確認需求正確，非 plan 缺口，無改）
- **AC-F1**（API_ERROR_I18N 缺 EXCHANGE_CODE_*/ELEVATION_PROVIDER_NOT_BOUND）＝plan §6.2 **已列**要補（draft 尚未 implement 故 api.ts 現缺＝預期）。
- **AC-F7**（Window `__reauthProviders` 型別）＝plan §3.5 **已列**「Window interface 補 `__reauthProviders?: string[]`」。
- **AC-F6**（elev_error handlers 未 implement）＝plan §1.1 item 5 **已列**「elev_error 全集處理」；§3.7 補上 pseudocode。

### 12.4 主線駁回（同意 verifier refuted，或 verifier accept 但主線降判）
- security：fragment code 非空驗（§3.4 `if(!code)return` 已有）、ts/TTL clock-skew（明標 non-load-bearing，後端 CAS 為 SoT）、action 後端契約未載（§0.1 已載）、elev_error 未驗（§3.7 i18n map 即隱式白名單）＝皆 refuted。
- tenant：elevation_grants/exchanges 無 `tenant_id`＝**正確設計**（factors user-global），非缺口（verifier 自身亦 refuted F1/F2）。
- api：init/exchange response version 欄＝over-engineering（refuted）；action sealed enum「未集中宣告」＝已三處強制（refuted）。
- naming：`elev_`(前端)/`elevation_`(後端) 分層、`checkElevExchange`/`resumeFactorAddFromExchange` 命名＝**刻意的 stage 邊界**（refuted）；`elev_reauth_no_candidate` 單 key 統一兩 0-候選情境（refuted）。
- migration：oauth_states `session_id` 契約不清（init.ts:218 寫、callback 讀驗，load-bearing 已實作，refuted）。
- idempotency：exchange 並發/idempotency-key（後端 one-time CAS 已是 idempotency primitive，refuted）。

**結論：plan 經 1 實質修（HR-F3）+ 9 項文件自足補強後，無殘留 Tier-0 設計洞、後端零改不變、可送 ChatGPT Arch Gate。**

## 13. ChatGPT Arch Gate 裁決 ＝ **APPROVED**（無 blocking C-item）

r1 裁決＝**APPROVED**（C1：無需阻擋的架構/安全/完整性缺口）。A–F 六點全通過、OD-1..7 全裁「A＝採傾向」。鎖定區確認：OD-3 不放寬、exchange one-time 不 retry、grant/code 不落持久層、resume 顯式傳 grant、後端 gate/CAS/TTL 不變。

**5 個非-blocking A-item（Gate 說「可順手改」）→ 本 plan 全數採納（cheap hardening，Codex Plan Gate 前先落 plan）：**
| A | 採納 | 落點 |
|---|---|---|
| A1 | **採納** | §3.5 `__reauthProviders` filter 到 `BIND_PROVIDERS` 已知集合；§3.3 init path `encodeURIComponent(reauthProvider)`（server-sourced string 不裸進 path，defense-in-depth）|
| A2 | **採納** | §3.6 `persistReauthPending()` 回 `boolean`；§3.3 寫入失敗（storage blocked）→ **不導頁** + modal 顯示錯誤（避免 roundtrip 後 silent `resume-lost`）|
| A3 | **採納（措辭改窄）** | §8：竄改 `targetProvider` 為另一合法 `BIND_PROVIDERS` 值 → 可能改變第二段要綁的 provider（非必然失敗）；但第二段仍是**使用者本人在該 provider 的 OAuth 同意**（綁的是 user 自己的 identity）、grant action-bound + one-time → **無提權**、需 same-origin script / local tamper 前提 |
| A4 | **採納** | §7.2 新增 R9：reauth candidate provider 不在已知集合 → 不列入候選（防 provider enum 漂移）|
| A5 | **採納** | §7.2 新增 O5：`persistReauthPending` 寫入失敗 → 不導頁 + 顯示錯誤 |

**→ 下一步：Codex Plan Gate。**

## 14. Codex Plan Gate 裁決 ＝ **CODING_ALLOWED**

對 `feat/factor-add-elevation-stage2 @ 6bda85ee` 只讀查證；plan 忠實反映 repo，無 repo-視野 blocker。工作樹乾淨、diff 僅 `docs/`。**V1–V11 全 confirm**（附 repo file:line）：
- V1 init JSON `{redirect_url}`（`init.ts:259-261`）+ elevation 分支（`:129-162,216-233`）✓
- V2 callback state one-time `DELETE...RETURNING`（`callback.ts:81-90`）+ 5a match/mismatch/OD-3/exchange/fragment（`:143-183`）+ `elev_error`（`:111,146,156,168`）✓
- V3 `/elevation/exchange`（`exchange.ts:28-77`：requireAuth/sid/RL/CAS/replay/mint oauth_reauth）✓
- V4 `requireFactorAddGrant` 驗 action+purpose 不驗 method（`elevation.ts:139-170`）+ 三 consume action 對上（`register-verify.ts:41`/`wallet/verify.ts:44`/`callback.ts:218-228`）✓
- V5 apiFetch SESSION_REVOKED 檢查在 skipRefresh gate 前（`api.ts:228,244`）、`401&&!skipRefresh` 區塊被跳過（`:247-263`）→ **HR-F3 推理成立** ✓
- V6 三 caller 裸呼叫、加 optional `presetGrant` 不破壞委派（`dashboard.ts:772,1826,2041,2435-2436,2464`）✓
- V7 `BIND_PROVIDERS` 靜態 const 4 筆無 apple（`dashboard.ts:720-725`）✓
- V8 `checkBindResult` 現處理 bind_error + elev_error=reverification_required（`:688-716`）；成功 fragment／錯誤 query 互斥 ✓
- V9 sessionStorage 跨 roundtrip（`callback.ts:472-484`）✓
- V10 `cors.ts:34-40` 無 `X-Factor-Add-Grant`；Stage 2 same-origin → R4 residual 正確、非 blocker ✓
- V11 backend-zero-change：plan §9 變更面僅 `src/js`/`i18n`/`public`/`tests`/`docs`、無 `functions/**`、無 migration（`:399-407`）✓

**Residual（非 blocking，plan 已列）**：R4（cross-origin CORS 另案）、R6（skipRefresh 犧牲極罕見 auto-recover 換不誤登出）。**此為 Plan Gate 靜態查證、未跑 build/test。**

**→ Code 階段：守「後端零改、無 migration、grant/code 不落 storage/log/URL/DOM」，實作後過 Codex Code Gate + ChatGPT faithfulness。**

## 15. dimension-A code-self-review 裁決（workflow `wf_7b599d65-f9f`，52 agents，reviewed_sha `1745f218`）

> v3 紀律：workflow raw 輸出**非**結論。44 findings／**suspicious_input 0**；主線獨立讀真碼裁決：**絕大多數 accepted ＝ verifier PASS 確認**（code 正確），**唯 1 條真實正確性 bug（RACE-3）需修**，其餘為「與既有 codebase pattern 一致的邊際 nit（修了反而 inconsistent / gold-plating，Stage 1 review 已先例駁回）」或「benign（後端 SoT 兜底）」。

### 15.1 採納並修（code 變更）
| ID | 維度 | sev | 裁決 | fix |
|---|---|---|---|---|
| **RACE-3** | race | t1 | **採納（真 bug）** | `openReauthElevationModal` provider handler `await apiFetch` 後**未重檢 `settled`** → 使用者在 init 往返期間取消/點遮罩（`finish(null)` 已 resolve null 給 caller 還原按鈕），pending fetch resume 仍 `window.location.href` 導頁＝**違反取消意圖**。對比 Stage 1 `openElevationModal` 成功走 `finish()`（內含 settled guard）故安全；我這條直接導頁繞過 guard。**fix＝await 後 `if (settled) return;`**（init 建的 oauth_state 未消費、10min 過期，無副作用）。**＋ 新增 O7 regression test（pre-fix RED 已驗：取消後仍導 ELEV_REDIRECT → 失敗；post-fix 不導頁 → 綠）。** |

### 15.2 主線駁回／不修（附理由，與既有 pattern 一致或 benign）
- **RACE-1（openElevationModal 多 modal orphan，t2）**：**Stage 1 code**（do-no-harm 不碰）；且需「submit modal1 → 在其 network 完成前開 modal2」極窄交錯，且 modal1 已被使用者 submit（第二因子已證）＝grant 合法、非安全破口；benign UX edge。RACE-3 fix 已處理我這條的「取消」主路徑。
- **RACE-4（多 tab exchange code race，t2／benign）**：後端 atomic CAS（`consumed_at IS NULL`）為 SoT、第二個 401。前端 module flag **跨 tab 無效**（各 tab 獨立 module，checkElevExchange 每 load 僅一次）→ 加 flag 無實益。「補後端並發 test」屬後端檔（本 PR frontend-only scope 外）＝backlog。
- **RACE-5／async ts-TTL clock-skew（t2／benign）**：明標 non-load-bearing（後端 exchange 2min one-time CAS 為 SoT）。verifier 建議 `performance.now()` **不可行**（其 baseline 每 page-load 重置，無法跨 OAuth roundtrip 兩個 page-load 量測）；`Date.now()` 是跨 load 唯一選項，clock-skew 邊際且 benign。
- **async no-timeout-on-apiFetch（t2／gold-plating）**：apiFetch 全站皆無 per-call timeout（既有 infra）；單獨給 reauth modal 加 AbortController 不一致。**Stage 1 code-self-review 已先例駁回同款**（#9/#10/#11 gold-plating）。plan §5.4 明定「無新增 AbortSignal」。
- **async TTL-no-proactive-cleanup（t1 過評→實 t3／benign）**：lingering pending 由 **read-time TTL 中和**（stale→null）＋下次 reauth overwrite，且為非敏感路由 context、tab 關即清。無 wrong-resume 路徑（new fragment ⟹ new reauth 已 overwrite）。
- **async sensitive-object-cleanup（t3）/ modal-listener-cleanup（t3）/ removeItem silent-catch（t2）**：皆與既有 modal（`openElevationModal`/`openReverifyModal`）+ 全站 catch pattern 一致；JS nulling 不保證清記憶體（V8）；失敗已由 resume-lost toast 浮現。修了製造 Stage 1/2 不一致＝gold-plating。
- **naming `elev_resume_lost` 兼用 tamper case（t2）/ `elev_exchange` 非 const（t1 過評）**：tamper 為攻擊路徑（sessionStorage 竄改）非正常 UX，generic 訊息足夠；fragment key 單一使用點、const→regex 反更醜。
- **idempotency orphaned-grant（t3／benign）**：grant 5min 自然過期，非安全；觀測屬後端 backlog。

### 15.3 PASS 確認（accepted＝verifier 證實正確，無改）
exchange one-time CAS／fragment 交付＋即剝／sync read-clear／sid 三因子綁定／action+targetProvider 白名單／**skipRefresh:true（HR-F3 三段證據齊全）**／三 caller signature 向後相容／3 error code＋13 i18n key＋`__reauthProviders` 契約／FactorAddAction enum 不變／`isFactorAddActionClient` guard／test harness fidelity（測 shipped bundle）／L1 grant·code 三出口（storage/console/DOM）零洩漏／O1–O8·R1–R8·E 全集 regression lock — 全 verifier PASS。

**結論：1 fix（RACE-3 + O7）＋ scope_mapping/deviations 補入 faithfulness 包 → 送 Codex Code Gate + ChatGPT faithfulness。fix 後 gates 全綠（ratchet 898 dashboard.ts clean／stage2 22／stage1 6）。**

## 16. Codex Code Gate 裁決 ＝ **CODE_APPROVED**（無 correctness/security finding）

固定審 `feat/factor-add-elevation-stage2 @ bae2e9b3` 的 committed `main...HEAD` diff（working-tree `public/*` dirty noise 依計畫排除）。scope＝docs／dashboard·api frontend／i18n·types／built JS／dashboard cache-bust／Stage 2 tests；**`functions/**` 與 `migrations/**` 零變更**確認。核心證據：OAuth-reauth start（`__reauthProviders` ∩ BIND_PROVIDERS、排除 target、init path encode、init 成功＋`settled` recheck 後才 persist/navigate、storage 失敗不導頁）／**RACE-3**（`await` 後 `if(settled)return`，取消不再 persist/跳轉）／resume（`#elev_exchange` 即 `replaceState` 剝 fragment、sync read-and-clear、`skipRefresh:true`、action/targetProvider guard 後才 thread preset grant 進三 caller）／**leakage**（pending 僅 `{action,targetProvider,ts}`；grant·code 只在 fragment-即剝／POST body／header／memory，未入 storage·console·DOM·URL）／i18n·types·build·cache-bust 對齊。

**Codex 獨立本地驗證全綠**：stage2 22/22、Stage1+2 wiring 28/28、`typecheck:ratchet` OK（898）、`lint` passed、`test:cov` 714/714（90.28%）、`build:functions` Compiled、`vitest workers config` 75 files／**1328** passed。**Non-blocking residual**：repo 既存未提交 `public/*` dirty（依指示未審未改）。**無 fix 需求 → 最終 code 維持 `bae2e9b3`。**

**→ 下一步：ChatGPT 維度-B plan-faithfulness 複核（§17）→ squash-merge。**

## 17. ChatGPT 維度-B Faithfulness 複核 ＝ **FAITHFULNESS_APPROVED**

10 必驗項全 ✅／OD-1..7 如實落地（A）／RACE-3 確認 within-scope race hardening（非新功能·非改架構·不碰後端·不 invalidate Codex）／**無可信 Tier0/1 side-finding**。**Dual Gate v3 全閉環**：ChatGPT Arch APPROVED → Codex Plan CODING_ALLOWED → code-self-review fixed RACE-3/O7 → Codex Code CODE_APPROVED → ChatGPT Faithfulness APPROVED。

**Merge 前鎖定（Gate 提醒）**：feature branch → PR → squash（禁直推 main）｜code @ `bae2e9b3` 後不再改 code｜merge 後 CI/Deploy 綠 + 回寫 `RESUME.md` Stage 2 MERGED（另案 docs PR）｜prod 無痕驗收：OAuth-only 帳號用既綁 provider reauth 後新增 passkey / wallet / OAuth identity。
