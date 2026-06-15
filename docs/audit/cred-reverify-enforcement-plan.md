# Credential `requires_reverification` Enforcement — 修補 plan（OD-3 LOCKED follow-up）

> **Gate state**：`CODING_ALLOWED`（v6.3，**Phase 1 Plan Gate 全過：維度 A 四輪 + ChatGPT Arch C1/C2/C3 + Codex Plan r1→r2 APPROVED**；尚未開 branch、未碰 src —— Phase 2 Code 待 owner go）
> **動工分級**：**L3**（碰 login + factor-add elevation runtime + 新安全模型）+ 高風險加碼（auth / credential state machine / idempotency）
> **領域**：安全邊界 / auth-runtime｜Tier-0：安全 + 正確性（first-do-no-harm，login/elevation 是全站最敏感熱區）
> **SSOT**：`04-security-boundary.md` §3 SEC-FACTOR-ADD（P1）→ A4 disposition（被動 flag）→ 本顆 = 主動 enforcement
> **前置**：PR-A4（#80 `7da1f9c`，migration 0055 已套 prod）已 merged；SEC-REFRESH（#82）已 merged
> **Migration**：**無**（0055 欄位已在 prod；本顆純 runtime + clear 寫入，**不碰 `elevation_grants` CHECK**）

---

## 0. SPEC_APPROVED + 維度 A self-review（四輪）收斂摘要

**Goal**：把 A4 的被動 `requires_reverification` flag 變成既有 credential「使用前」的主動 runtime enforcement，**不**擴張成完整 credential lifecycle 重設計。

**OD-ENF-1..6 終裁（owner + ChatGPT v2，2026-06-14）**：hard-block（不 inline step-up）／migration-free self-service reverify（不用 grant table）／wallet runtime defer／保留 5 identity dogfood + pre-merge 防自鎖／reset-password 不自動清 flag／admin clear 必做。

**核心安全模型（SEC-REVERIFY-1）**：reverify = **owner-vouch 獨立因子**（password/TOTP）。**禁**用「重 auth 該 credential 本身」自證（對植入物＝攻擊者自證、無效）。

**維度 A 四輪（`wf_e8a5d356-a4e` 14 confirmed → `wf_dd0bccc5-33e` 6 → `wf_9862e0aa-32c` 部分 2/7 → `wf_8907e924-168` 7）共處理 ~28 confirmed**。第四輪後 owner 裁 D1–D4 + clear-cut，定案如下：

- **D1（SEC-1，A=修）**：enforcement **延伸到第 4 surface = factor-add elevation OAuth-reauth**。flagged identity **不得**當 elevation-reauth proof；callback 5a match 到 `requires_reverification=1` 的 identity **不鑄 factor-add grant**。關掉「植入 identity 繞 #78 gate 鑄新永久因子」的持久化縫。
- **D2（命名）**：data 識別子統一 **`reverification` 詞幹**（對齊 DB 欄 `requires_reverification`）；URL path `/credential/reverify` 保留動詞（例外、註明）。**self/admin clear 併成單一 event** `account.credential.reverification_cleared` + `actor_type`/`method` payload。**registry 226→228**（block + clear 各 1）。
- **D3（wallet）**：wallet flag = **informational-only**（無 live enforcement）。self-reverify **拒** wallet；admin clear **可清但 audit 標 dormant**；dashboard 對 flagged wallet 只給 **delete/聯絡客服**（不給 reverify）。§14 locked follow-up：未來 `user_wallets` 消費路徑必 enforce flag。
- **D4（backup-code race，b=接受 residual）**：self-reverify 用 backup code 時 destructive 核銷在 CAS 前，並發 clear 可白燒 1 碼 → **接受為 documented residual**（harm bounded、可重產）；不為此把兩寫做原子；§12 鎖「CAS 輸家不毀 credential row」、§14 記未來 hardening。
- **clear-cut**：reverify error codes 進前端 i18n／`login.js`→`login.ts`／**anti-downgrade**（TOTP-enabled 帳號禁 password-fallback + 負測）／「零狀態寫入」措辭收斂為「不寫 credential row / 不簽 token 或 grant」。
- **9+ refuted 主線複核全成立**（含 TOTP-downgrade 兩度被提皆駁回＝設計是 account-state-driven）。

**ChatGPT Architecture Gate（2026-06-14）= APPROVED_WITH_REQUIRED_CLARIFICATIONS → C1/C2/C3 已落地**：
- **C1**：D1 elevation enforcement 鎖 callback 5a（match 後、鑄 exchange code 之前），init 為 supplementary 早擋，unflagged 不變（§3/§4/§13#2）。
- **C2**：tier-gate deny-by-default SSOT helper 為唯一權威，端點禁 inline 字串比對，malformed/NULL/未知一律 deny（§3/§4/§13#6）。
- **C3**：clear 維持**單一** `account.credential.reverification_cleared` SECURITY_SIGNAL event，**動態 severity**（self·unknown→info／admin·non-high→warn／**admin·high→critical**）達 forensic 對稱（非拆 event、非 IMMUTABLE）；payload 帶 `actor_type`/`clear_method`/`credential_tier`/pre-clear 三欄（§9/§12/§13#11）。

**Codex Plan Gate r1 = REJECT〔3 finding〕→ 修畢 → r2 = `CODEX_PLAN_APPROVED`（2026-06-14；架構/C1-C3 未推翻、registry 維持 228；r2 nit〔token-class bad-sub=401 非 403〕已併修）。Phase 1 Plan Gate 全過 → `CODING_ALLOWED`。Code Gate 重點盯：requireRegularAccessToken 真接上 / CAS loser 不 emit audit / registry 228 lockstep。** r1 三 finding：
- **P1（Tier-0 Security）**：self `/credential/reverify` 改 **`requireRegularAccessToken`**（非裸 `requireAuth`；後者只擋 pre_auth、會放行 `temp_bind`/`elevated:*` token → token-class confusion）；用其回傳 validated `userId`。已驗 `auth.ts:298-322` 拒 temp_bind/elevated/pre_auth/bad-sub（§1/§3/§4/§6.1/§7/§12/§13#7）。
- **P2（Contract）**：self CAS race loser 明定 → `200 {ok:true, cleared:false}` 不發成功 audit（§6.1/§12/§13#18）。
- **P2（Observability）**：clear D1 失敗 → 500 + **structured error log（非 registry audit event）**，registry 維持 228（§8/§13#18）。

**owner-accepted residuals（明列，外部 gate 知情前提）**：
- **R1**：no-TOTP `unknown_context` 帳號 password-fallback —— token+password 同竊可自清（更高階入侵，非本 PR 能完全解；§3 已優先 TOTP、tier-gate 擋 high-risk）。
- **R2**：A4 flag 不撤既有 session —— 攻擊者可騎既有 refresh session ≤7 天（但清不了 flag、登不了被擋 credential、且 **D1 已關掉鑄新永久因子**）。本 PR 不做 session family-revoke。
- **R3**：self-reverify backup-code 在並發 clear 競態下可白燒 1 碼（D4-b）。

---

## 1. 系統架構 / 資料流

```
┌─ ENFORCE（block flagged credential 在「使用」點；deny-by-default；4 surfaces）──────────┐
│ passkey  login-verify.ts : SELECT +requires_reverification → flagged → 403 JSON          │
│ OAuth    callback.ts 5b  : existingIdentity +flag → flagged → 302 ?reverification_required=│
│ OAuth    bind-email.ts   : existingIdentity +flag（jti consume 前 read-only 預檢）→ 403 JSON│
│ FACTOR-ADD elevation     : callback.ts 5a（purpose='elevation'）match 到 +flag identity   │
│   (D1)                     → 不鑄 exchange/grant → 302 ?elev_error=reverification_required │
│   （四者 flagged：emit auth.credential.reverification_required + 不簽 token/grant + 零 credential-row 寫入）│
└──────────────────────────────────────────────────────────────────────────────────────────┘

┌─ CLEAR（owner-vouch：證明獨立因子 → atomic CAS 清 flag）──────────────────────────────────┐
│ self  passkey/identity : POST /api/auth/credential/reverify                               │
│        requireRegularAccessToken → live banned/deleted 查核 → tier-gate(fail-closed)       │
│        → anti-downgrade                                                                    │
│        → verifySecondFactor(TOTP) | verifyPassword → clearReverificationFlag(CAS, self)   │
│ admin any              : POST /api/admin/credential-reverification/clear                  │
│        admin + security step-up → pre-SELECT row.user_id → clearReverificationFlag(admin) │
│ delete（OD-R5）        : flagged credential 可直接刪除/解綁（不認得的植入物正解）           │
└──────────────────────────────────────────────────────────────────────────────────────────┘

逃生口（不改）：OAuth-only + 唯一 flagged identity + 無 password/TOTP → forgot-password 建密碼
（`functions/api/auth/local/reset-password.ts:167`）→ 再用 password 自助 reverify；或 admin clear。
```

唯一 credential-flag clear 寫入點 = `clearReverificationFlag`（D1 CAS UPDATE + audit），self/admin 共用、byte-identical。

---

## 2. 資料流（state transition）

```
credential.requires_reverification:
  0 (usable)  ──A4 disposition runner（一次性 backfill，WINDOW_END=2026-06-13 09:10:00）──▶ 1 (flagged)
  1 (flagged) ──self reverify（owner-vouch）| admin clear──▶ 0 (cleared)   ← 本 PR 新增轉換
  1 (flagged) ──delete/unbind（OD-R5）──▶ (row 消失)        ← 植入物正解

use of flagged credential（4 surface）:
  requires_reverification=1 → DENY（不簽 token/grant）+ audit + 導向 reverify/recovery/delete
  requires_reverification=0 → 既有流程不變
```

**單向性 scope**：本 PR 只擁有 `1 → 0`。`0 → 1` 屬 A4 runner（一次性 frozen-window backfill），不在本 PR。clear 不影響 runner idempotency（runner 對任何 `disposition_at NOT NULL` 本就永久 skip）。

---

## 3. 安全邊界

| 邊界 | 規則 |
|---|---|
| **use block = deny-by-default** | flag=1 一律擋（4 surface）；flag NULL（0055 default 0）= usable |
| **block 不寫 credential row / 不簽 token 或 grant** | passkey：assertion 驗過後、counter/last_used update 前；callback 5b：existingIdentity 命中後、display_name/avatar UPDATE 前；bind-email：jti consume 前 read-only 預檢；**elevation 5a：match identity 後、鑄 exchange/grant 前**。〔註：one-time challenge（passkey）與 oauth_states（OAuth）在 block 之前由上游 ceremony 消耗屬既有行為，deny 後須重啟 ceremony；本條不宣稱保留它們，只保證不寫 credential row、不簽 token/grant〕 |
| **（D1+Arch C1）flagged identity 不可當 factor-add elevation proof** | **load-bearing enforcement 在 callback 5a**：`(user_id,provider,provider_id)` match（`callback.ts:148-151`）**成功後、鑄 exchange code 之前**（`callback.ts:158-168` 是鑄點）讀 `requires_reverification`；flagged → **不鑄 exchange code、不鑄 grant**、redirect `?elev_error=reverification_required`。init elevation 分支（`init.ts:144-146`）為**supplementary 早擋**（user 在該 provider 無 non-flagged identity → 400），**非**唯一防線。**unflagged identity → 流程完全不變**（regression 鎖）。對齊 SEC-REVERIFY-1：重 auth 植入物 ≠ 合法擁有者在場 |
| **self reverify tier-gating（fail-closed whitelist；Arch C2）** | 唯 `disposition_reason === 'unknown_context'` 准；**其餘一律 deny**＝`high:` 前綴 / NULL / 空 / 未知 / **malformed tier** → 403 `CREDENTIAL_REVERIFICATION_HIGH_RISK`，只能 delete/admin。判定**唯一權威**＝`credential-disposition.ts` 匯出的 deny-by-default SSOT helper `isSelfReverifyAllowed(reason)`（whitelist `=== 'unknown_context'`）；**端點禁任何 inline `startsWith`/字串比對**。admin clear **不** tier-gate。〔identity 結構上恆 `unknown_context`（無 add-event）→ high-deny 對 identity 不可達，防護全來自 owner-vouch；high-deny 僅作用 passkey/wallet〕 |
| **self reverify = owner-vouch 獨立因子 + anti-downgrade** | **以帳號 TOTP-state 分流（非 body 欄位有無）**：`local_accounts.totp_enabled=1` → **只**走 `verifySecondFactor`(otp/backup)，**送 password 一律拒**（鏡射 `elevation/password.ts:68` 防降級）；`totp_enabled=0` 且有密碼 → `verifyPassword`；皆無 → 403 `CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL`。**不**重 assert/re-auth 該 credential 本身 |
| **self reverify 只能清自己（原子）** | CAS `WHERE id=? AND user_id=<token.sub> AND requires_reverification=1`，`changes()=1` 才成功；授權謂詞在 atomic CAS 內。tier-gate 的 pre-SELECT 同帶 `user_id=token.sub`（不洩他人 tier；命中 0 row 一律 `CREDENTIAL_NOT_FLAGGED`，不分不存在/非本人/已清/high） |
| **self 端點 token-class gate（Codex P1）** | `/credential/reverify` 用 **`requireRegularAccessToken`（非裸 `requireAuth`）**：拒 `temp_bind` / 任何 `elevated:*` step-up / `pre_auth` / 非正整數 sub（`auth.ts:298-322`），回傳 **validated `userId`**（caller 一律用此 userId、非 raw `user.sub`）。理由：清 security flag 的 mutating self endpoint，裸 requireAuth 只擋 pre_auth、會放行 temp_bind / elevated token（token-class confusion） |
| **self 端點 live 主體查核** | token-class gate 後補 `SELECT status FROM users WHERE id=? AND deleted_at IS NULL`，row 無/banned → 403。**banned-only 為全站既有 parity**（global `suspended` 無 login enforcement = 既有 gap，本 PR 不擴張，§14） |
| **admin clear = double-gate + 非授權 user_id** | `requireStepUp(ELEVATED_ACCOUNT,'credential_reverification_clear')` + `effectiveScopesFromJwt.has(admin:users:write)`；POST-only；**pre-SELECT `SELECT user_id FROM <table> WHERE id=?`（無 row→fail-closed）** → CAS `WHERE id=? AND user_id=row.user_id AND requires_reverification=1`。**admin 的 user_id 子句是 no-op 防呆/uniformity 非授權閘**（admin cross-user by design） |
| **clear audit gate 在 changes()=1** | counts/`cleared:true`/成功 audit 一律 gate 在 CAS `changes()===1`；changes=0 → `cleared:false`、**不**發成功 audit（防並發輸家噴假事件） |
| **（D3）wallet flag informational-only** | self-reverify **拒** wallet（body type 不含 wallet）；admin clear **可清但 audit 標 `dormant:true`**（wallet 無 live enforcement 讀取點，清的是 dormant flag）；dashboard 對 flagged wallet 只給 delete/聯絡客服 |
| **input validation** | self reverify body strict（`{type:'passkey'|'identity', credential_id:int, otp_code?, backup_code?, password?}`，unknown reject）；admin clear strict（鏡射 `run.ts:34-66`，type 含 wallet） |
| **output 最小化 / PII** | clear 回 `{ok, cleared:bool}`；不吐 provider_id/address/credential detail；credential ref keyed-HMAC；DTO flag=0 時 `publicReasonCode`=null |
| **rate limit** | `credential_reverification`（self，per-user）、`credential_reverification_clear`（admin，per-user 低 max） |

---

## 4. 模組拆分

| 檔 | 動作 | 內容 |
|---|---|---|
| `functions/utils/credential-reverification.ts` | **新增** | `clearReverificationFlag(env,{type,id,userId,actorType,clearMethod,actorId?,reason?,dormant?,request})` → CAS UPDATE（§5）+ gate-on-changes()=1 + 讀 pre-clear `disposition_reason` 經 `dispositionTierFromReason` 推 `credential_tier` → **動態 severity（C3）** + emit merged audit（actor_type/clear_method/credential_tier/result + pre-clear 三欄快照 + dormant）；回 `{cleared:boolean}`。self/admin 共用。**D1-dependent → 同 PR 進 `vitest.config.js` category-A exclude** |
| `functions/utils/credential-disposition.ts` | 改 | export deny-by-default SSOT helpers：`isSelfReverifyAllowed(reason):boolean`（whitelist，唯 `'unknown_context'` true，Arch C2）+ `dispositionTierFromReason(reason):'high'|'unknown_context'|'unknown'`（供 clear audit 的 `credential_tier` + 動態 severity，Arch C3）；reverify 端點/clear 共用、**禁 inline `startsWith`/字串比對** |
| `functions/api/auth/credential/reverify.ts` | **新增** | POST self reverify（passkey+identity；**`requireRegularAccessToken`〔Codex P1，非裸 requireAuth〕取 validated userId** + live 查核 + tier-gate + anti-downgrade + verifySecondFactor/verifyPassword + clearReverificationFlag(actorType=self)） |
| `functions/api/admin/credential-reverification/clear.ts` | **新增** | POST admin clear（double-gate + strict schema〔type 含 wallet〕 + pre-SELECT user_id + clearReverificationFlag(actorType=admin, dormant=type==='wallet')） |
| `functions/api/auth/me.ts` | 改 | identities DTO **+`id`**（SELECT `ui.id` + map，比照 `credentials.ts:41`/`wallet.ts:39`）；DTO 變更須通知前端〔identity self-reverify 的 `credential_id` 來源〕 |
| `functions/api/auth/webauthn/login-verify.ts` | 改 | SELECT +`c.requires_reverification`；assertion 驗過後、counter update 前 block（JSON 403） |
| `functions/api/auth/oauth/[provider]/callback.ts` | 改 | **(5b)** existingIdentity SELECT +`ui.requires_reverification`；命中後、display_name/avatar UPDATE 前 block（302 `?reverification_required=`）。**(5a，D1)** elevation 分支 `SELECT ... requires_reverification`，flagged → 不鑄 exchange/grant、redirect `?elev_error=reverification_required` |
| `functions/api/auth/oauth/bind-email.ts` | 改 | jti consume（:108）**前** read-only `(provider,provider_id)→requires_reverification` 預檢；flagged → 403（不消費 jti） |
| `functions/api/auth/oauth/[provider]/init.ts` | 改（D1） | elevation 分支（init.ts:144-146）可早擋：user 在該 provider 無 non-flagged identity → 400（best-effort UX；load-bearing 在 callback 5a） |
| `functions/utils/rate-limit.ts` | 改 | RateLimitKind union +`credential_reverification`、`credential_reverification_clear`（帶 SEC 註解） |
| `functions/utils/audit-policy.ts` | 改 | 註冊 **2** event（block + merged clear）+ registry lockstep（§9） |
| `functions/utils/scopes.ts` | （視需要）| step-up `for_action` 若集中清單則加 `credential_reverification_clear`（`for_action` 走自由字串 mint，無需 allowlist 註冊；§13 已澄清） |
| `src/js/api.ts`（+`public/js/api.js`） | 改 | `API_ERROR_I18N` 註冊 `CREDENTIAL_REVERIFICATION_REQUIRED` / `_HIGH_RISK` / `_PROOF_FAILED` / `_NO_TRUSTED_CHANNEL` / `CREDENTIAL_NOT_FLAGGED` zh-TW 文案（APIC-V5-1） |
| `src/js/auth-ui.ts`（+public） | 改 | passkey login block 顯示引導 |
| `src/js/login.ts`（+public） | 改 | OAuth 跳回 `login.html?reverification_required=1&provider=` 的 query 通知（沿既有 verified/verify_error 慣例） |
| `src/js/dashboard.ts`（+public） | 改 | flagged 項依 `publicReasonCode` 渲染：`needs_review`(unknown)→「重新驗證」(POST `/credential/reverify`)+「刪除」；`security_review`(high)→**只給「刪除」+「聯絡客服」**；**wallet flagged → 只給 delete/客服**（D3）。backend tier-gate 為最終強制 |
| `vitest.config.js` | 改 | `credential-reverification.ts` 進 category-A exclude |
| `tests/integration/_setup.sql` | **不改**（明列） | authoritative 測試 schema 不動 = no schema change 的真實保證面 |
| `tests/integration/cred-reverify-enforcement.test.ts` | **新增** | 見 §12 |
| `tests/audit-policy.test.ts` / `tests/integration/session-revoke-multi.test.ts` | 改 | registry 228 lockstep 同步 |

**不複用**（C1 鎖）：`mintFactorAddGrant`/`requireFactorAddGrant`/`consumeFactorAddGrantStmt`（purpose 寫死 factor_add）。
**複用**：`verifySecondFactor`（`elevation.ts:46`）、`verifyPassword`（`crypto.ts:80`）、`requireStepUp`/`effectiveScopesFromJwt`、`hashIdentifierForAudit`、`checkRateLimit`/`recordRateLimit`、me.ts live-status pattern、callback elevation provider-match pattern。

---

## 5. 資料表設計（無 migration）+ clear 寫入語意

0055 既有欄（三表皆有，prod 已套）：`requires_reverification` / `disposition_reason` / `disposition_at` / `disposition_by` + partial index。`user_identities` 有 `id` PK + `UNIQUE(provider,provider_id)`。

**clear 寫入（OD-CLEAR=A）**：
```sql
UPDATE <table> SET requires_reverification = 0
 WHERE id = ? AND user_id = ? AND requires_reverification = 1   -- CAS, changes()=1
```
- **不覆寫** `disposition_reason`/`disposition_at`/`disposition_by`（保留 A4 的「為何被 flag」鑑識）。
- clear 事實（`actor_type` self/admin + `clear_method` + `credential_tier` + result + **pre-clear 三欄快照** + `dormant`）落 §9 audit event（append-only ledger，唯一記「如何被清」之處；severity 由 actor_type×credential_tier 動態決定，§9 C3）。
- flag=0 後 `publicReasonCode` 回 null，DTO 不洩漏既有 reason。

**no-migration 斷言（可證偽）**：(a) 本 PR git diff `--stat -- migrations/` **空**；(b) **不改** `tests/integration/_setup.sql`。D1 的 elevation flag-check 只 SELECT 既有 `requires_reverification` 欄，不改 schema。

---

## 6. API Contract

### 6.1 `POST /api/auth/credential/reverify`（self；passkey + identity）
- Header：`Authorization: Bearer <access_token>`（未被擋因子登入的 session）
- Body（strict）：`{ type: 'passkey'|'identity', credential_id: number, otp_code?: string, backup_code?: string, password?: string }`（**不含 wallet**，D3）
- 流程：**`requireRegularAccessToken`（Codex P1：拒 temp_bind/elevated/pre_auth/bad-sub，取 validated `userId`）** → **live `SELECT status,deleted_at`，無/banned→403** → **user-scoped pre-SELECT**「該 credential 屬 `userId`、flagged、取 `disposition_reason`」（0 row→403 `CREDENTIAL_NOT_FLAGGED`）→ **tier-gate**：`isSelfReverifyAllowed(disposition_reason)` 為 false→403 `CREDENTIAL_REVERIFICATION_HIGH_RISK` → **anti-downgrade + 證明**：載 `local_accounts.totp_enabled`；`totp_enabled=1`→`verifySecondFactor`（送 password 拒）；`=0` 有密碼→`verifyPassword`；皆無→403 `CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL` → `clearReverificationFlag(actorType=self)`
- 回（Codex P2 明定）：`200 {ok:true, cleared:true}`（CAS changes=1）｜**`200 {ok:true, cleared:false}`（proof 通過後 CAS race loser＝flag 已被並發 clear 清掉；不發成功 audit、前端 refresh 狀態；亦涵蓋 D4 R3 backup-code 白燒）**｜`403 CREDENTIAL_REVERIFICATION_HIGH_RISK / _PROOF_FAILED / _NO_TRUSTED_CHANNEL / CREDENTIAL_NOT_FLAGGED / ACCOUNT_BANNED`｜`429 RATE_LIMITED`｜`400 ERR_VALIDATION`｜`401 UNAUTHORIZED / INVALID_SUBJECT`｜`403 PRE_AUTH_TOKEN_FORBIDDEN / NOT_A_REGULAR_TOKEN`〔token-class〕
- RL `credential_reverification`（per-user）

### 6.2 `POST /api/admin/credential-reverification/clear`（admin fallback）
- 鏡射 `run.ts`：`requireStepUp(ELEVATED_ACCOUNT,'credential_reverification_clear')` + `effectiveScopesFromJwt.has(ADMIN_USERS_WRITE)`
- Body（strict，unknown reject）：`{ type: 'passkey'|'identity'|'wallet', credential_id: number, reason: string(bounded) }`
- 流程：RL `credential_reverification_clear` → **pre-SELECT `SELECT user_id FROM <table> WHERE id=?`（無 row→404/`cleared:false`）** → `clearReverificationFlag(actorType=admin, dormant = type==='wallet')`（CAS）。**admin user_id 子句非授權閘**（授權＝double-gate）
- 回：`200 {ok:true, cleared:boolean}`（already clear→`cleared:false` idempotent）｜403/400/429；count/bool only

### 6.3 modified use surfaces（block contract；flat envelope）
| surface | flagged 回應 |
|---|---|
| `login-verify.ts` (JSON) | `403 { error, code:'CREDENTIAL_REVERIFICATION_REQUIRED' }` |
| `bind-email.ts` (JSON) | `403 { error, code:'CREDENTIAL_REVERIFICATION_REQUIRED' }` |
| `callback.ts` 5b (redirect) | `302 /login.html?reverification_required=1&provider=<p>` |
| `callback.ts` 5a elevation (redirect，D1) | `302 /dashboard.html?elev_error=reverification_required` |

---

## 7. 權限模型

| 端點 | 身份 | 授權 |
|---|---|---|
| use surfaces (block) | 匿名/憑 credential | deny path，無新權限 |
| `/credential/reverify` | **`requireRegularAccessToken`（self；拒 temp_bind/elevated/pre_auth/bad-sub）** + live banned/deleted | 只能清自己（CAS `user_id==validated userId`）+ owner-held 因子 + tier-gate |
| elevation reauth (5a) | requireAuth（既有） | 既有 + D1 flag 預檢 |
| `/admin/credential-reverification/clear` | admin + security step-up | `elevated:account` for_action=`credential_reverification_clear` + `admin:users:write`；cross-user |

---

## 8. 錯誤模型（flat envelope）

全 codebase `res()` 為 **flat** `{ error:<message>, code:<CODE> }`（`auth.ts:324`）；**禁** nested。
- BusinessError(4xx)：`CREDENTIAL_REVERIFICATION_REQUIRED`(block) / `CREDENTIAL_REVERIFICATION_HIGH_RISK` / `_PROOF_FAILED` / `_NO_TRUSTED_CHANNEL` / `CREDENTIAL_NOT_FLAGGED` / `ACCOUNT_BANNED` / `ERR_VALIDATION` / `RATE_LIMITED` / `INSUFFICIENT_SCOPE`〔admin clear only〕
- SystemError(5xx + 告警)：clear D1 失敗 → **500 + structured SystemError log**（含 traceId + 告警；**非 registry audit event**，registry 維持 **228**）。clear-success audit 只在 CAS `changes()=1` emit（§9）；失敗走 error log 路徑、不偽裝成 audit ledger event（Codex P2-3：不留 impl 現場決定）
- redirect surface：`?reverification_required=1&provider=`（login）/ `?elev_error=reverification_required`（elevation）；沿既有 `?bind_error=`/`?elev_error=` 慣例。traceId 走 structured-log / `X-Request-Id` header（非 body 欄）

---

## 9. Observability

**2** 新 audit event（registry **226→228**；兩處 `_registrySize` lockstep：`tests/audit-policy.test.ts` + `tests/integration/session-revoke-multi.test.ts`）：
| event | category | severity | 時機 | data（PII-safe） |
|---|---|---|---|---|
| `auth.credential.reverification_required` | SECURITY_SIGNAL | warn | 4 use surface 擋下 flagged | `{ method:'webauthn'|'oauth_login:<p>'|'oauth_reauth_elevation:<p>', credential ref hmac16 }` |
| `account.credential.reverification_cleared` | SECURITY_SIGNAL | **動態（C3）**：self·unknown→`info`／admin·non-high→`warn`／**admin·high-risk→`critical`** | clear 成功（CAS changes=1） | `{ credential_type, actor_type:'self'|'admin', clear_method, credential_tier, result, id_hmac16, pre_clear_reason, pre_clear_by, pre_clear_at, [admin_actor, reason], [dormant] }` |

- **merged clear event（D2 + Arch C3）**：self 與 admin **同一 event**，靠 `actor_type`/`clear_method`/`credential_tier`/severity payload 區分（對齊 `account.credential.disposition` 一名多 severity 慣例，`credential-disposition.ts:209` 證實 repo audit policy 支援 per-emit severity 差異化）。**不**拆回 self/admin 兩 event。
- **severity 動態（Arch C3，取代 OBS-SEC-1 IMMUTABLE 替代案）**：靠 severity 而非 category 達 forensic 對稱——**admin 清 high-risk → `critical`**（落 `security_critical` cold_class，與 flagging 的 high→critical 對稱）；admin 清非 high → `warn`；self 清 unknown_context → `info`。severity 由 `(actor_type, credential_tier)` 決定，`credential_tier` 由 `dispositionTierFromReason(pre_clear_reason)` 推得。
- **命名 SSOT（D2）**：data 識別子統一 `reverification` 詞幹（event/code/RL kind/for_action/query 全用）；URL path `/credential/reverify` 為動詞例外（URL 慣例，明列）。`isSelfReverifyAllowed`/`dispositionTierFromReason` 為 code helper（函式動詞，比照 URL 例外）。
- §12 須補 **explicit per-event 分類斷言**（非只 `_registrySize`）+ **severity 矩陣斷言**（self·unknown=info／admin·high=critical）。

---

## 10. 部署架構

- **無 migration** → 無 D1 apply。push-main 自動部署；前端 JS/HTML 改 → `npm run build` → cache-bust `?v=`（HEAD hash）。
- **pre-existing dirty worktree baseline（branch 起手，2026-06-14；owner 裁決：不清/不 normalize/不 stage）**：開 branch 時 working tree 已有 **21 個 `public/js/*.js` modified**，inventory 確認**全為 EOL/autocrlf noise、零真實內容差異**——`core.autocrlf=true`、無 `.gitattributes`；default `git diff`＝空；autocrlf=false RAW 僅 **3 檔**有 byte 差（`auth-ui.js` **5/5**、`dashboard.js` **177/177**、`portfolio.js` **8/8** raw numstat，皆對稱 CRLF↔LF flip，`--ignore-space-at-eol` 後歸零）；其餘 **18 檔**純 index phantom（連 raw 都無差異）。**`api.js` Step 7 前為乾淨**（不在這 21 內）。**紀律**：本 PR 只挑檔 stage 自己改的檔，每次 commit 前 `git diff --name-only --cached` 人工核對；**禁 `git add -A`/`.`/`public/js`**；PR 報告明列未納入的 pre-existing noise。autocrlf=true 在 `git add` 正規化 EOL → rebuild 的 `api.js`/`login.js`/`dashboard.js` staged diff 只含真實內容（不挾 CRLF churn）。**Step 7 實際結果**：`api.js`/`login.js`/`dashboard.js` 已 commit 真實內容（`5d4efc92`）；`auth-ui.js` rebuild 後與 committed **byte-identical（無真實變更）→ 未 stage**；`portfolio.js` 本 PR 不碰、維持 noise；剩餘 **19 檔** phantom/EOL（17 A + 2 B：`auth-ui.js`/`portfolio.js`）全零真實內容、未 stage。
- **⚠ pre-merge safety gate（OD-ENF-4）**：merge 前確認 (a) owner 有可用非-OAuth 登入（password/passkey 未 flagged）；(b) 5 個 flagged identity 都在 owner 能用其他因子進的帳號；(c) admin clear fallback 可用。
- post-merge dogfood（OD-ENF-4）：owner dashboard 對 1 個 flagged identity 走 self-service reverify（TOTP）→ 成功 → 再清剩 4；任一失敗 → admin clear fallback + blocker，不卡 P4 closure。
- **manual smoke checklist（Step 8；前端無 E2E framework，靠 integration test + build + 手動 smoke）**：owner 用無痕視窗逐項——
  1. **light + dark 各切一次**：dashboard flagged identity（`needs_review`）顯示 amber badge「需重新驗證」+「重新驗證」鈕；確認 badge/modal 在兩主題下對比度 OK（chrome 用 CSS var 自適應）。
  2. 點「重新驗證」→ modal 開；TOTP 帳號輸入 OTP/備用碼、無 TOTP 有密碼帳號輸入密碼 → 成功 toast + badge 消失（flag 清、`loadProfile` 重渲染）。
  3. high-risk（`security_review`）identity → red badge「安全審查中」、**無 reverify 鈕、只有解綁**。
  4. flagged OAuth 帳號登入 → 跳 `/login.html?reverification_required=1&provider=…` → login 頁顯示提示。
  5. flagged identity 走 factor-add（OAuth reauth 新增 passkey/wallet）→ 回 dashboard 顯示 `elev_error` 提示 toast。
  6. 在地化：故意輸錯 proof → modal 內顯示在地化錯誤（`CREDENTIAL_REVERIFICATION_PROOF_FAILED`）；切語系確認 4 語系碼都接得上。

---

## 11. Open Decisions（全裁定，不再 open）

- **OD-R1/OD-R4 → RESOLVED**：reverify = owner-held password/TOTP；移除 OAuth-reauth-for-reverify（SEC-REVERIFY-1）。
- **OD-R2 → LOCKED**：bind-email flag 預檢在 jti consume 前 read-only。
- **OD-R5 → 採**：只擋使用面；管理/刪除不擋（植入物正解=刪除）。
- **OD-R3 → 採**：admin clear cross-user。
- **OD-CLEAR = A**：clear 不覆寫 disposition_*（§5/§9）。
- **OD-RESIDUAL → 接受 + tier-gating fail-closed whitelist**（§3）。
- **D1（SEC-1）= A**：enforcement 延伸 factor-add elevation OAuth-reauth（§1/§3/§4/§6/§12）。
- **D2（命名）= reverification 詞幹 + merged clear event + registry 228**（§9）。
- **D3（wallet）= informational-only**（§3/§4/§6.2/§14）。
- **D4（backup-code race）= b（accept documented residual R3）**（§3 無載；§11 R3 / §14 backlog）。

---

## 12. 測試矩陣（pre-fix RED → post-fix GREEN）

| 類型 | 測試 |
|---|---|
| **pre-fix RED**（enforce） | flagged passkey / identity(callback 5b) / identity(bind-email) / **identity(elevation 5a，D1)** 現在都成功（登入 / 鑄 grant） |
| **post-fix GREEN**（enforce） | 同四路徑 flagged → 擋（JSON 403 / 302 redirect），**不簽 token / 不鑄 grant** |
| **（D1）elevation reauth** | flagged identity 走 `?purpose=elevation` reauth → callback 5a **不鑄 exchange/grant**、redirect `?elev_error=reverification_required`；unflagged identity → 正常鑄 grant（regression） |
| enforce 零副作用 | callback 5b flagged block 時 `user_identities` profile 欄未改；bind-email flagged → 403 且 temp_bind jti 未消費；passkey block 不寫 counter/last_used、不簽 token；**deny path 不寫 credential row / 不簽 token-or-grant**（不斷言 challenge/oauth_states 保留） |
| enforce negative | unflagged passkey/identity（4 surface）→ 不變 |
| self reverify | 有 TOTP：valid otp/backup → clear；wrong → 403 + RL；無 TOTP 有密碼：valid password → clear；皆無 → 403 no_trusted_channel |
| **anti-downgrade**（clear-cut） | **TOTP-enabled 帳號送正確 password → 403**（不可降級自清；鏡射 elevation/password.ts:68） |
| self reverify 無 OAuth | identity reverify 走 password/TOTP（不經 OAuth roundtrip）；planted identity 無法 provider-reauth 自清 |
| **tier-gate（fail-closed）** | high(`high:%`)→403 HIGH_RISK（即使 TOTP 對）；unknown→准；NULL/未知值(flag=1)→403（deny-by-default） |
| **tier invariant** | `tier==='high' ⟺ reason.startsWith('high:')` 且 `isSelfReverifyAllowed` 唯 unknown_context true；+ 任何 flagged identity 的 `disposition_reason==='unknown_context'` |
| **high-risk 補救** | high → delete/unbind 可用；admin clear 可用 |
| self reverify scope（原子） | 清別 user 的 credential_id → CAS user_id 不符 → 不清；他人 flagged id（high/unknown 各一）→ 一律 `CREDENTIAL_NOT_FLAGGED`（不洩 tier） |
| **self token-class gate（Codex P1）** | `/credential/reverify` 送非 regular token → **non-200**：`temp_bind`/`elevated:*`/`pre_auth`=**403**（`NOT_A_REGULAR_TOKEN`/`PRE_AUTH_TOKEN_FORBIDDEN`）、**bad-sub（非正整數）=401**（`INVALID_SUBJECT`）〔Codex r2 nit：勿寫死「一律 403」〕；**且不進 credential pre-select / CAS**；regular access token 才放行 |
| **self CAS loser（Codex P2）** | proof 通過後 flag 被並發 clear → CAS changes=0 → `200 {ok:true, cleared:false}`、**不發成功 audit**、credential row 不毀損 |
| self reverify live 查核 | banned/soft-deleted（token 未失效）→ 403 |
| clear write（OD-CLEAR=A） | clear 後 `disposition_reason`/`by`/`at` **三欄保留**；audit 帶 pre-clear 三欄快照 + actor_type + method + result |
| **merged clear event + severity 矩陣（D2+C3）** | self·unknown clear → `account.credential.reverification_cleared` actor_type='self' **severity `info`** + `credential_tier='unknown_context'`；admin·non-high → actor_type='admin' **severity `warn`**；**admin·high-risk → severity `critical`**（落 security_critical）；payload 帶 `clear_method`/`credential_tier`/pre-clear 三欄。**explicit per-event 分類斷言**（2 event 皆 SECURITY_SIGNAL）+ severity 矩陣斷言 + 兩處 `_registrySize` **228** |
| **（D4）backup-code race residual** | self+admin 並發同 row：一個贏 CAS、輸家 `cleared:false` 不發成功 audit；**輸家即使已核銷 backup code，credential row 不毀損**（flag 已=0、無中間態）；〔白燒 1 碼為 accepted residual R3，不視為失敗〕 |
| **（D3）wallet** | wallet flag 為 informational-only：self-reverify 送 `type='wallet'` → 400（schema reject）；admin clear wallet → 成功但 audit `dormant:true`；dashboard wallet flagged 只渲染 delete/客服 |
| idempotency | 並發 self + admin 同 row → 一贏、另一 `cleared:false` 不發成功 audit |
| admin clear | 無 step-up → reject；valid double-gate → clear；already clear → idempotent；缺 `admin:users:write`→403；strict unknown key→400；pre-SELECT 無 row→`cleared:false` |
| reset-password | reset 成功**不**清任何 flag（OD-ENF-5 負測） |
| lockout escape | OAuth-only + flagged identity + 無 password/TOTP → forgot-password 設密碼 → 再 self-reverify |
| owner self-lock | owner 全 OAuth 被擋 + 有 password/TOTP → 仍可進 |
| **no-migration** | git diff 無 `migrations/`；`_setup.sql` 未改 |
| frontend | login 頁接 `?reverification_required=`；api.ts `API_ERROR_I18N` 註冊全部 reverify code（含 4 個 reverify-response code）；dashboard 渲染 flagged 項「重新驗證/刪除/客服」+ tier 分流；**identity reachability**（me.ts DTO 含 id → 組得出 credential_id） |
| gates | typecheck:ratchet 零新增 / lint / test:cov / test:int / build / CI |

**§12 closure（Step 8 實測 2026-06-15，全 gate 綠）**

- gates：`typecheck:ratchet` 898（0 new，cleanFiles 225）／`lint` clean／`test:cov` **90.28% stmts・92.77% branches**（threshold 80）unit 全綠／**`test:int` 75 files・1326 tests・0 failed**／`build:functions` compiled／`npm run build`（step 7，committed `5d4efc92`+cache-bust `be3c1c20`，public/js 與 source 一致）／`git diff --check` clean。target main CI 於 merge 前再查。
- 矩陣→測試檔對應：self reverify（8）+ admin clear（8）+ clear-core CAS loser + tier-gate + token-class + init block = **`cred-reverify-enforcement.test.ts`**；4 enforce surface = **`webauthn-login`**（passkey flagged/unflagged）/**`callback`**（5b login + **5a D1 seam** + 5b unflagged regression）/**`oauth-bind-email`**（bind-email flagged，jti 未消費）/**`cred-reverify-enforcement`**（init elevation early block）；registry **228** = `audit-policy.test.ts:364` + `session-revoke-multi.test.ts:393` + category-sum（`:291`）；frontend = me.ts DTO id（step-4 4 tests）+ build + §10 manual smoke checklist（前端無 E2E framework，owner accept）。
- **pre-fix RED 已實證**（Phase 2 step 6）：stash 移除 5 個 enforce edit 後跑測試 → 恰好 5 個 flagged-block test fail（passkey/5b/5a/bind-email/init），3 個 unflagged regression 維持綠；最關鍵 5a 失敗訊息 `Location=#elev_exchange`（flagged identity 真的鑄出 elevation exchange）。
- **OD-CLEAR=A**（code+test 雙證）：clear-core CAS `SET requires_reverification=0` 不碰 `disposition_*`（`credential-reverification.ts:72-73`）；audit 帶 `pre_clear_reason/by/at` 快照（`:97-99`）；test 斷言 `disposition_reason` 保留 + `pre_clear_reason` 快照（`cred-reverify-enforcement.test.ts:150,156`）。
- **D1（SEC-1）reconfirm**：callback 5a flagged identity → `elevation_exchanges` count = 0（不鑄 exchange/grant），redirect `?elev_error=reverification_required`（`callback.test.ts` 5a seam test）。
- **零副作用 reconfirm**：passkey counter 不變 + 無 access_token／callback 5b `display_name` 不改 + refresh 0／bind-email jti 未消費（第二次同 token 仍 403）／callback 5a 無 exchange／全 deny path 不簽 token-or-grant。
- **no-migration / public/js isolation**：見 §10（git diff 無 `migrations/`、`_setup.sql` 未改；staged 僅 step-7 intentional outputs；剩 19 phantom/EOL 零真實內容、未 stage）。

**Codex Code Gate r1（2026-06-15）→ REJECT〔2 finding〕→ fixed `633b9c69` → 待 r2**

- **P1**（observability / plan-contract，plan §8 line 201）：clear-path D1/HMAC 失敗原本沒走 structured SystemError log（只靠 `_middleware` 泛用 500）。修：`clearReverificationFlag` 包 try/catch → 結構化 error log（`event=credential.reverification.clear_error` + actor_type + credential_type + trace_id）+ re-throw；reverify / admin clear 兩 endpoint catch → `500 CREDENTIAL_REVERIFICATION_CLEAR_FAILED`；失敗路徑**不發 success audit**；**非 registry event**，registry 維持 **228**。
- **P2**（forensics）：bind-email flagged block 的 `auth.credential.reverification_required` audit 缺 affected `user_id`（其餘 4 surface 皆帶）。修：block query 補 `ui.user_id`、audit 帶 `user_id` → security signal 可歸屬帳戶。
- 3 條 regression test（**stash 實證 pre-fix RED**：移除 fix 後恰好這 3 條 fail）；gates：ratchet 898（0 new）／lint／build:functions／affected int **89 pass**；**backend-only，無 frontend / public/js 變更**。
- non-blocking note（admin clear `reason` raw text 入 audit）→ §14 backlog（plan 允許 `[admin_actor, reason]`，故非 blocker）。

---

## 13. Gate watch items（給 ChatGPT Arch + Codex Plan/Code）

1. **4 enforce surface**：login-verify / callback 5b / bind-email / **elevation 5a（D1）**；flagged 皆擋在簽 token 或鑄 grant 前。
2. **（D1+C1）flagged identity 不可鑄 factor-add grant**：load-bearing 在 callback 5a——provider/provider_id match **成功後、鑄 exchange code（`callback.ts:158-168`）之前**讀 flag，flagged → 不鑄 exchange/grant；init 為 supplementary 早擋非唯一防線；unflagged 流程不變（關永久持久化縫）。
3. **block 不寫 credential row / 不簽 token-or-grant**（不宣稱保留 upstream-consumed challenge/oauth_states）。
4. **clear 是 CAS** `WHERE id=? AND user_id=? AND requires_reverification=1`；self user_id=token.sub＝授權閘；**admin user_id=row.user_id（pre-SELECT）＝no-op 非授權**；audit/counts/`cleared:true` gate 在 `changes()=1`。
5. **self reverify = owner-held 獨立因子 + anti-downgrade**（TOTP-enabled 禁 password-fallback，account-state-driven）；禁重 assert/re-auth credential 本身。
6. **tier-gate fail-closed whitelist**（唯 `unknown_context` 准）走 `isSelfReverifyAllowed` SSOT helper，禁 inline；pre-SELECT 帶 user_id（不洩他人 tier）。
7. **self 端點 token-class gate（Codex P1）+ live 查核**：`/credential/reverify` 用 **`requireRegularAccessToken`**（拒 temp_bind/elevated/pre_auth/bad-sub、取 validated userId，**非裸 requireAuth**），再補 live banned/deleted（banned-only parity；suspended 記 §14）。
8. **不碰 `elevation_grants`、無 migration**：git diff 無 `migrations/`、`_setup.sql` 不改。
9. **不複用 factor_add grant helpers**；複用 verifySecondFactor/verifyPassword + callback elevation match pattern。
10. **錯誤 envelope flat**；admin clear double-gate；strict schema。`for_action` 走自由字串 mint（step-up.ts:76/167，無需 allowlist 註冊）。
11. **registry 228 lockstep** 兩處同步 + **explicit per-event 分類斷言** + **clear severity 矩陣**（self·unknown=info／admin·non-high=warn／**admin·high=critical**，Arch C3）。
12. **命名 SSOT（D2）**：data 識別子統一 `reverification` 詞幹（event/code/RL/for_action/query），URL `/credential/reverify` 動詞例外明列；merged clear event + actor_type payload。
13. **（D3）wallet informational-only**：self 拒 wallet、admin 清標 dormant、dashboard 只 delete/客服。
14. **（D4）backup-code race = accepted residual R3**；測試只鎖「CAS 輸家不毀 credential row」。
15. **前端接線**：passkey code 在 `api.ts`+`auth-ui.ts`（非 `login.ts`）；OAuth `?reverification_required=` 在 `login.ts`；dashboard tier 分流 + identity id 可達。
16. **pre-merge 防自鎖 gate**（owner 非-OAuth 登入；OD-ENF-4）。
17. **owner-accepted residuals R1/R2/R3** 明列（§0），ChatGPT/Codex 知情前提下審。
18. **self 回應契約（Codex P2）**：pre-select 0 row→403 `CREDENTIAL_NOT_FLAGGED`；proof 後 CAS race loser→`200 {ok:true, cleared:false}` 不發成功 audit；clear D1 失敗→500 + **structured error log（非 registry event）**，registry 維持 228（Codex P2-3）。

---

## 14. Backlog / forward-looking

- **future user_wallets consumption path（D3 locked follow-up）**：任何未來消費 `user_wallets` 並簽 token / 授權金流的路徑，**MUST** 在使用前讀 `requires_reverification` 並 block（wallet flag 屆時從 informational 轉 enforcing）。
- **token-signing / grant-minting 端點 × credential-flag 覆蓋 enumeration ratchet**：未來新增任何消費 credential 並簽 token 或鑄 elevation grant 的端點須機械守門讀 flag（SEC-REVERIFY-4；對齊 00-invariants「全端點四欄矩陣」；D1 已把 elevation 納入本 PR）。
- **backup-code race 原子化（D4 future hardening）**：未來可把 backup-code 核銷 + clear CAS 收進單一 `db.batch` 消除 R3 白燒窗。
- **high-tier flag 連帶 session revocation**（R2 選配；屬 disposition runner/另案）。
- **global `users.status='suspended'` 無 login/step-up enforcement**（repo-wide parity gap；本 PR 維持 parity）。
- **未來「週期性 re-flag」系統**（若有）：不可裸用 `disposition_at IS NULL` 當可見性 gate。
- **i18nize dynamic reverify modal chrome（Step 7 follow-up，owner accept non-blocking）**：dashboard reverify modal 的 chrome（標題／輸入 placeholder／取消·確認鈕）目前硬寫 zh-TW，對齊 `dashboard.ts` 既有動態 modal 慣例（`req-detail-modal` 同款硬寫）。持久 UI（badge／button／toast）已 4 語系 i18n。未來補 ~5 key × 4 語系把 modal chrome 也 i18n 化。
- **admin clear `reason` → reason_code / ticket_id（Codex Code Gate r1 non-blocking）**：admin clear 的 `reason` 目前是 raw free text 並入 `account.credential.reverification_cleared` audit payload。plan 明列允許 `[admin_actor, reason]`，故**非 blocker**；但若日後嚴格執行「audit 不落任何 free-text（僅 hmac / enum / code）」，可改成 `reason_code` enum 或 `ticket_id`，或入庫前 redact。

---

_v6.3 = `CODING_ALLOWED` 完成 2026-06-14。**Phase 1 Plan Gate 全過**：維度 A 四輪自審 + ChatGPT Arch APPROVED〔C1/C2/C3〕+ Codex Plan r1〔3 finding〕→ r2 APPROVED。架構/C1-C3/D1-D4/residuals R1/R2/R3 鎖定，registry 228、無 migration。下一步：**Phase 2 Code**（owner go 後開 feature branch → commit plan+RESUME → 依本 plan 最小 diff 實作 → 機械 gates → 維度 A code self-review → Codex Code Gate → ChatGPT faithfulness → squash-merge）。_
