# SEC-FACTOR-ADD-A 修補 plan（UX-safe elevation primitive）

> **Gate state**：`PLAN_REVISED_R3`（Codex Plan Gate r1 → r2 REVISE_REQUIRED 3 blockers + 1 contract，全鎖入）→ 待 **Codex Plan Gate r3**（Codex 預期 r3 → CODING_ALLOWED）。**plan-only；未 coding、未切 runtime branch、未碰 src。**（Codex 輪不回送 GPT。）
> **領域**：安全邊界（auth / elevation / factor registration）｜Tier-0：安全｜SSOT：`04-security-boundary.md` §3 SEC-FACTOR-ADD（P1）。
> **前置裁決**：PT-6 = UX-safe now（owner）；ChatGPT Arch Gate OD-1..5；Codex Plan Gate OD-A..D（2026-06-13）。

---

## 0. Scope + 不可逾越的鎖定（owner + 雙 Gate ratified）

**目標**：關閉 SEC-FACTOR-ADD（P1）。三條 factor-add 路徑（`webauthn/register-verify`、`wallet/verify`、`oauth/[provider]/init?is_binding=true`）一律需 **factor-add elevation**，並為無 TOTP / 純 OAuth 用戶提供安全 bootstrap。

**硬鎖（違反 = reject）：**
1. 禁 first-factor-add 豁免。 2. 禁 fresh-login / fresh-access-token elevation。 3. 三路徑全需 factor-add elevation。
4. factor-add elevation **只授權 factor-add**，結構上不得碰 delete / change-password / disable-2FA（OD-1：獨立 `elevated:factor_add`）。
5. OAuth-reauth 只能對**既綁** `(provider, provider_id)`（match 當前 user `user_identities`）。
6. factor-add elevation **不是純 JWT** —— server-side one-time grant（`elevation_grants`），consume 與 factor-add **atomic**（OD-5）。
7. elevated grant 不進 URL —— OAuth 走 one-time exchange code（OD-3）。
8. **grant 綁 action**（Codex r1 Blocker-1）：grant 必帶 `action`，mint/consume 雙比對，跨 action 不可消費。
9. **grant/exchange 綁 sid**（Codex r1 Blocker-2 / OD-D）：綁 per-login `sid`；access token 未帶 sid → factor-add elevation **fail-closed**。
10. **grant_token / provider_id 明文不入 DB / URL / audit**（hash 存）（Codex r2 contract）。**`exchange_code` 可進 redirect URL（優先 fragment `#elev_exchange=`，降 server/referrer 暴露）**，但須 short-TTL（2min）+ session-bound + single-use；DB / audit 亦只存其 hash。exchange_code 是低值一次性 pointer（無 session + 過 TTL + 已用即廢），grant_token（真正 elevation 憑據）僅經 exchange POST response body 交付、永不入 URL。

---

## 1. 威脅模型（不變）

attacker 持被盜 access token（step-up 自身前提）→ 現況三端點只 `requireAuth` → 植入永久登入因子，survive 改密碼 + bump + 繞 TOTP。strict-only 破壞 passwordless → UX-safe now。

---

## 2. 設計總覽（三 account 類型 → factor-add grant）

factor-add 端點要求 server-side one-time `elevation_grants`（`purpose='factor_add'` + `action`，概念名 `elevated:factor_add`），**與 `elevated:account`（delete/change-password、TOTP-only、不動）結構分離**。三條 elevation 路徑：

| account 類型 | elevation 路徑 | 證明因子 | method |
|---|---|---|---|
| 有 TOTP | **OD-B：新 `/api/auth/elevation/totp`**（抽共用 TOTP/backup verify helper；**不**讓 step-up.ts 同時回 elevated JWT + grant） | 第二因子 | `totp` |
| local 有密碼無 TOTP | 新 `/api/auth/elevation/password` | 知道密碼 | `current_password` |
| OAuth-only | 新 OAuth-reauth（既綁 provider）+ one-time exchange | 持有既綁 OAuth 帳號 | `oauth_reauth` |
| 皆無法 | — | — | 拒絕 add factor |

> 既有事實鎖：無 TOTP 用戶現況本就無法 in-app delete/change-password（require TOTP step-up）。本 plan 不改變該行為；新 elevation 路徑只開 factor-add。有 TOTP 用戶不准走 current_password（防降級）。

---

## 3. Schema（OD-5 + OD-A + Blocker-1/2/4，三表 + 一 migration 群）

### 3.1 `elevation_grants`（active one-time factor-add grants）

| 欄位 | 用途 |
|---|---|
| `id` INTEGER PK | |
| `grant_token_hash` TEXT **UNIQUE** | client grant token 之 hashToken（明文不入 DB） |
| `user_id` INTEGER | FK users |
| `session_id` TEXT | per-login sid（Blocker-2；mint/consume 比對 access token sid claim） |
| `purpose` TEXT CHECK(`purpose='factor_add'`) | |
| **`action` TEXT CHECK(`action IN ('add_passkey','bind_wallet','bind_identity')`)** | **Blocker-1：grant 綁 action；mint 寫、consume 比對** |
| `method` TEXT CHECK(`method IN ('totp','current_password','oauth_reauth')`) | |
| `provider` TEXT NULL / `provider_id_hash` TEXT NULL | oauth_reauth 用（HMAC，無明文） |
| `expires_at` TEXT | TTL **5min**（OD-C） |
| `consumed_at` TEXT NULL | 一次性 |
| `created_at` TEXT / `risk_reason` TEXT NULL | |

**Index**：`grant_token_hash`(unique)、`user_id`、`session_id`、`action`、`expires_at`。
**Atomic consume**：`UPDATE elevation_grants SET consumed_at=datetime('now') WHERE grant_token_hash=? AND user_id=? AND session_id=? AND action=? AND purpose='factor_add' AND consumed_at IS NULL AND expires_at>datetime('now')` → `changes()=1` 才贏 → **與 factor-add credential INSERT 同 `db.batch`**（both-or-neither）。

### 3.2 `elevation_exchanges`（OD-A：獨立 OAuth exchange code 表）

| 欄位 | 用途 |
|---|---|
| `id` INTEGER PK | |
| `exchange_code_hash` TEXT **UNIQUE** | redirect 帶的 one-time code 之 hash（明文不入 URL/DB） |
| `user_id` INTEGER / `session_id` TEXT | 綁定 |
| `provider` TEXT / `provider_id_hash` TEXT | 已驗 match 的既綁 identity（HMAC） |
| `action` TEXT CHECK(...) | 透傳到 exchange→grant |
| `expires_at` TEXT | TTL **2min**（OD-C） |
| `consumed_at` TEXT NULL / `created_at` TEXT | 一次性 |

**Index**：`exchange_code_hash`(unique)、`session_id`、`expires_at`。`/elevation/exchange` atomic consume 後鑄 `elevation_grants`。

### 3.3 `oauth_states` elevation 欄位（Codex r1 Blocker-4 + r2 Blocker-2/3：extend，非新表）

裁定 = **extend `oauth_states` with nullable elevation columns**（reuse 既有 atomic DELETE...RETURNING state-consume；callback 依 `purpose` 分派）。oauth_states 承載**兩條** OAuth elevation 流程，欄位須同時支援：

| 欄位 | 用途 |
|---|---|
| `purpose` TEXT NULL | `'elevation'`（OAuth-reauth 鑄 grant）/ `'factor_add_binding'`（is_binding factor-add）/ login·bind 為 NULL；callback DELETE RETURNING **必回** |
| `elevation_user_id` INTEGER NULL | init 階段 requireAuth user（callback 比對 provider_id 屬此 user / 綁 grant） |
| `session_id` TEXT NULL | per-login sid（callback 比對） |
| **`action` TEXT NULL CHECK(`action IN ('add_passkey','bind_wallet','bind_identity')`)**（r2 Blocker-2） | `'elevation'`：init 要求的 action（透傳→exchange→grant）；`'factor_add_binding'`：固定 `'bind_identity'` |
| **`factor_add_grant_hash` TEXT NULL**（r2 Blocker-3） | **僅 `'factor_add_binding'` 用**：init 已驗的 factor-add grant 之 hash，供 callback **atomic consume**（`'elevation'` purpose 為 NULL——它是鑄 grant，非消費） |

callback `DELETE ... RETURNING` 補回 `purpose, elevation_user_id, session_id, action, factor_add_grant_hash`（現況皆不回）。

**callback 依 purpose 嚴格分派（state confusion 防護）**：
- `purpose='elevation'`：**不** INSERT user_identities；驗 provider_id match 既綁 → 建 `elevation_exchanges`（帶 action）→ redirect（fragment）。
- `purpose='factor_add_binding'`：consume `factor_add_grant_hash` 指向的 grant（CAS，比對 user_id+sid+action='bind_identity'）+ INSERT user_identities **同一 db.batch**（both-or-neither）；provider_id 須**非**既綁（沿 callback.ts:141 existing-bind 檢查）。
- `purpose IS NULL`（login / 既有 bind）：**絕不**進任何 elevation / grant 路徑。
- 三 state-confusion 互斥負測必備（§9）。

### 3.4 Migration（OD-5）

- 新表 `elevation_grants` / `elevation_exchanges` + `oauth_states` ALTER（**5 nullable 欄**：purpose / elevation_user_id / session_id / action / factor_add_grant_hash）。
- **up/down round-trip** 必備。`cron/cleanup.ts` 補兩 task：`DELETE FROM elevation_grants WHERE expires_at<datetime('now')`、`DELETE FROM elevation_exchanges WHERE expires_at<datetime('now')`（沿 webauthn_challenges 模式）。

---

## 4. `sid` claim rollout（Blocker-2 / OD-D；**獨立前置 PR**）

**裁定 = JWT `sid` claim**。現況：`signJwt` 只補 jti，access token **不帶 sid**；per-login session_id 只寫進 `refresh_tokens`（login/2fa/webauthn/oauth 各鑄 `crypto.randomUUID()`，refresh rotation PRESERVE），access payload 無。

**依 [[feedback_shared_auth_contract_isolation]]：sid claim 是 shared auth contract 變更 → 獨立 PR-0（ADD-A 前置），不拼進 elevation feature PR。**

**PR-0 範圍 = 所有 access-token issuance path 帶同一 per-login sid（共 9 條；r2 Blocker-1 補 register）：**

| issuance path | sid 來源 |
|---|---|
| `local/login.ts` | 新鑄 session_id（同寫 refresh row + access `sid`） |
| **`local/register.ts`（r2 Blocker-1 補）** | **既有 refresh `session_id`（register.ts:191）+ 直接簽 access token（:200）→ 同帶 access `sid`** |
| `2fa/verify.ts` | 同上（pre_auth→正式 token） |
| `webauthn/login-verify.ts` | 既有 `crypto.randomUUID()`（line ~235）→ 同帶 access `sid` |
| `oauth/token.ts` | 既有 session_id（line ~141）→ 同帶 access `sid` |
| `oauth/[provider]/callback.ts` | 若直接簽 access token，帶 sid（否則經 token.ts 已涵蓋） |
| `auth/refresh.ts`（rotation） | `preservedSessionId` → 新 access `sid`（跨 rotation 不變） |
| `auth/org-switch.ts` | **preserve** 當前 token 的 `sid`（無 refresh 改動；缺 sid → 重發亦無 sid） |
| `bind-email.ts` | 新鑄 session_id + access `sid` |

**PR-0 test（每條 issuance）**：回傳 access token 的 `sid` claim == 對應 refresh row `session_id`（register / login / 2fa / webauthn / oauth-token 直接驗；refresh rotation 驗 sid 跨 rotation 不變；org-switch 驗 preserve）。

**missing-sid fail-closed（只影響 factor-add elevation）**：access token 無 `sid` claim（PR-0 上線前簽的舊 token，或缺 issuance path）→ 三條 elevation 路徑與 factor-add gate **一律拒**（無法 bind grant）→ user 重新登入取得帶 sid 的 token 才能 add factor。**其他所有功能（login / 一般 API / delete / change-password）不受影響**（graceful degradation）。

---

## 5. 三條 factor-add 端點改造

| 端點 | 改後 gate |
|---|---|
| `webauthn/register-verify` | `requireAuth`（取 userId + sid claim）+ `requireFactorAddGrant(env, { userId, sid, action:'add_passkey', grantToken })` → 驗 + **與 credential INSERT 同 batch atomic consume** |
| `wallet/verify` | 同，`action:'bind_wallet'` |
| `oauth/[provider]/init?is_binding=true` | **OD-2 雙層 + r2 Blocker-3**：init `requireAuth` + **驗** factor-add grant（action='bind_identity'，**validate-not-consume**，因實際 user_identities INSERT 在 callback async 發生）→ 把 `factor_add_grant_hash` + purpose='factor_add_binding' + elevation_user_id + session_id + action 寫入 `oauth_states`；**callback** DELETE...RETURNING 取回 → **atomic consume grant + INSERT user_identities 同一 db.batch**（§3.3 factor_add_binding 分派；provider_id 須非既綁）。grant consume 落在 callback（factor-add 的真正寫入點）而非 init。 |

`requireFactorAddGrant`（**同步路徑** register-verify / wallet-verify 用）：requireAuth（缺 sid → fail-closed）→ 取 grant_token → atomic consume `elevation_grants`（§3.1 CAS，比對 user_id+sid+action+purpose）→ 回 row 供 caller 在 factor-add batch 內 consume。失敗泛化 403。

`requireFactorAddGrantDeferred`（**is_binding async 路徑**）：init 只 **validate**（存在 + 未過期 + 未 consume + 比對 user_id+sid+action='bind_identity'），**不 consume**，回 grant_hash 供 init 寫入 oauth_states；真正 consume + identity INSERT 在 callback 同 batch（防 OAuth roundtrip 中途 grant 被別處消費 → both-or-neither）。

---

## 6. Elevation 端點流程

### 6.1 `/api/auth/elevation/totp`（OD-B 獨立端點）
`requireAuth` → 抽共用 TOTP/backup verify helper（與 2fa/verify、step-up 共用）→ 驗成功 → 鑄 `elevation_grants`（method=totp, action 由 body 指定 ∈ 白名單）→ 回 `{ grant_token }`。RL `elevation_totp`。**不**回 elevated:account JWT。

### 6.2 `/api/auth/elevation/password`（local 無 TOTP）
`requireAuth` → 僅當 totp_enabled=0 且有密碼（有 TOTP→拒，防降級）→ `verifyPassword` → 鑄 grant（method=current_password）→ `{ grant_token }`。RL `elevation_password`（5/5min/user）。

### 6.3 OAuth-reauth-for-elevation（purpose='elevation'；OD-2 雙層 + OD-3 exchange；**鑄 grant，非 binding**）
> 此流程 ≠ §5 的 is_binding factor-add（purpose='factor_add_binding'）。本流程供 **OAuth-only 用戶鑄一張 factor-add grant**，可用於任一 factor-add 端點（grant 帶 init 指定的 action）。
```
[init] /oauth/[provider]/init?purpose=elevation&action=<add_passkey|bind_wallet|bind_identity>  [requireAuth + 驗既綁 + 帶 sid]
   - 驗 action ∈ 白名單（r2 Blocker-2：action 是 grant 必要欄，init 即決定）
   - 驗當前 user 確有該 provider 既綁 identity；無→400 泛化
   - 寫 oauth_states（purpose='elevation', elevation_user_id=<sub>, session_id=<sid>, action=<action>, provider, state, 10min）
   - RL 'elevation_oauth_start'；audit auth.elevation.started
[callback]  - oauth_states DELETE...RETURNING（回 purpose/elevation_user_id/session_id/action；原子消費防 state replay）
   - purpose==='elevation'：不 bind；查 user_identities WHERE user_id=elevation_user_id AND provider AND provider_id
       match → 建 elevation_exchanges（one-time code, session 綁, action 透傳, 2min）→ redirect dashboard#elev_exchange=<code>（fragment，r2 contract）
       no match → audit auth.elevation.provider_mismatch(critical) + 泛化 error
   - RL 'elevation_oauth_callback'
[exchange] POST /api/auth/elevation/exchange { code }  [requireAuth]
   - atomic consume elevation_exchanges（驗 session_id + 未過期）→ 鑄 elevation_grants（method=oauth_reauth, action 來自 exchange row）
   - RL 'elevation_exchange'；audit auth.elevation.succeeded → 回 { grant_token }（body，不進 URL）
```

---

## 7. 既有 credential disposition（OD-4：audit + notify + risk，不盲撤）

對 `user_webauthn_credentials` / `user_wallets` / `user_identities`：產 security inventory report + security audit；可疑（近期 token theft 訊號）→ 標 `requires_reverification`（若 schema 支援，屬 **ADD-B**）/ risk flag + notify user + admin audit；無證據異常**不撤**。schema 未支援時至少：inventory report + audit + 高風險標記 + 留清單給 ADD-B migration。

---

## 8. Audit reason codes + RateLimitKind

**Audit（同 PR 補 audit-policy）**：`auth.elevation.started`(telemetry) / `.succeeded`(security_signal) / `.failed`(security_signal) / `.provider_mismatch`(security_signal,critical) / `.replay_detected`(security_signal,critical)；factor-add 成功沿用既有 register/bind audit + `via_elevation:true`+method+action。
**RateLimitKind（補 union）**：`elevation_totp`、`elevation_password`、`elevation_oauth_start`、`elevation_oauth_callback`、`elevation_exchange`、`factor_add`。

---

## 9. 測試矩陣（pre-fix RED → post-fix GREEN；雙 Gate 補強已併入）

| 類型 | 測試 |
|---|---|
| **pre-fix RED** | stolen token（無 grant）→ register-verify / wallet/verify / oauth init is_binding **三路徑各成功植入**（P1） |
| **post-fix GREEN** | 同三路徑 → 403（無 grant 拒） |
| local ✓/✗ | 正確/錯誤 current_password → grant/拒 + RL + audit |
| 防降級 | 有 TOTP 走 current_password → 拒 |
| OAuth ✓/✗ | 既綁 provider_id match → exchange → grant；attacker/新 provider_id mismatch → 拒 + provider_mismatch audit |
| **cross-action 拒絕（r1 Blocker-1）** | action='add_passkey' 的 grant 拿去 wallet/verify 或 oauth bind → 拒（action 不符） |
| **state confusion（r1 Blocker-4）** | login state / bind state / elevation state / factor_add_binding state 四者互斥不可挪用（purpose 嚴格分派） |
| **missing-sid fail-closed（r1 Blocker-2）** | 無 sid claim 的 access token → 三 elevation 路徑 + factor-add gate 全拒；其他功能正常 |
| **PR-0 sid 全 issuance（r2 Blocker-1）** | **9 條 issuance path（含 register）**回的 access token sid == 對應 refresh row session_id；rotation 跨輪不變；org-switch preserve |
| **OAuth action threading（r2 Blocker-2）** | init?action=bind_wallet 的 reauth → exchange → grant 的 action 必為 bind_wallet（不被竄成別的 action） |
| **is_binding callback grant consume（r2 Blocker-3）** | is_binding init 驗 grant（不 consume）→ callback consume grant + INSERT identity 同 batch；grant 在 roundtrip 中被別處消費 → callback both-or-neither 不插 identity |
| **exchange_code in fragment, grant not in URL（r2 contract）** | redirect 只帶 fragment `#elev_exchange=`（短 TTL/session/single-use）；grant_token 永不入 URL（只在 exchange POST body）；DB/audit 只存 code hash |
| exchange/grant replay | one-time code / grant_token 二次用 → 拒（atomic CAS） |
| expired | 過期 grant（>5min）/ exchange（>2min）→ 拒 |
| **scope non-escalation** | factor-add grant 拿去 delete/change-password → 無效（那兩條走 elevated:account，不認 grant） |
| atomic | grant consume + factor-add 同 batch；輸的一方不寫 credential |
| audit / cleanup / migration | reason code 可查；expired grant/exchange 清；表 up/down round-trip |

---

## 10. OD rulings（已裁，rN 不再 open）

- **OD-1**：獨立 `elevated:factor_add`（grant purpose+action，與 elevated:account 分離）。✅
- **OD-2**：OAuth binding elevation **雙層**（init + callback）。✅
- **OD-3**：one-time exchange code，grant 不進 URL。✅
- **OD-4**：既有 credential audit+notify+risk（不盲撤、不只 audit-only）。✅
- **OD-5**：新 `elevation_grants` 表 + migration。✅
- **OD-A**：**獨立 `elevation_exchanges` 表**（grant 表只放 active grants）。✅
- **OD-B**：**獨立 `/api/auth/elevation/totp` 端點**（抽共用 verify helper；step-up.ts 不同時回 JWT+grant）。✅
- **OD-C**：grant 5min / exchange code 2min。✅
- **OD-D**：JWT `sid` claim；**獨立前置 PR-0** 列全 issuance path + missing-sid fail-closed。✅

---

## 11. 實作序（PR 拆分）

1. **PR-0（shared auth contract）**：`sid` claim 全 issuance path（§4）+ missing-sid 契約。獨立 Dual Gate（不拼 elevation）。
2. **PR-A1（migration + schema）**：`elevation_grants` / `elevation_exchanges` 表 + `oauth_states` elevation 欄 + cleanup task。
3. **PR-A2（elevation 端點）**：`/elevation/{totp,password,exchange}` + OAuth-reauth init/callback elevation 分支。
4. **PR-A3（factor-add gate）**：三端點上 `requireFactorAddGrant` + atomic batch consume。
5. **PR-A4（disposition）**：既有 credential inventory + audit + risk flag。
（PR-A1..A4 可視 Codex Plan Gate r2 意見併拆；每顆獨立 Code Gate。）

---

## 12. Gate watch items（Codex Plan Gate r3 + Code Gate）

1. grant consume + factor-add 同 db.batch both-or-neither（同步 register/wallet；async is_binding 在 callback consume）。 2. grant 綁 user_id+sid+action 三鍵，cross-action / cross-session / cross-user 全拒。 3. provider_id-match 嚴格綁 elevation_user_id。 4. factor-add grant 結構上打不進 delete/change-password。 5. 有 TOTP 不走 current_password 降級。 6. 三端點無一遺漏（含 oauth is_binding init validate + callback consume 雙層）。 7. grant_token/provider_id hash 存不入 URL/audit；exchange_code 僅 fragment + hash 存。 8. sid PR-0 **9 條** issuance path（含 register）+ fail-closed。 9. migration up/down + index/unique（含 oauth_states 5 nullable 欄 + action/grant_hash）。 10. 四 state purpose（login/bind/elevation/factor_add_binding）互斥負測。 11. OAuth action threading（init→exchange→grant action 不被竄）。

---

_PLAN_REVISED_R3 完成 2026-06-13（Codex Plan Gate r2 的 3 blockers + 1 contract 鎖入：register sid / oauth_states action / is_binding callback grant consume / exchange_code fragment）。下一步：回 **Codex Plan Gate r3**（預期 → CODING_ALLOWED）。**ADD-A 在 Plan Gate 收斂前不開 runtime branch。**_
