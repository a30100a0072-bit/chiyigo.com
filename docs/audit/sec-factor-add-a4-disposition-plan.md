# SEC-FACTOR-ADD ADD-A PR-A4 — Existing-Credential Disposition Plan

狀態：`PLAN_DRAFT`（送審 `CHATGPT_ARCH_APPROVED`）
動工分級：**L2 + 高風險加碼**（credential / auth / audit 熱區 → 補 disposition state machine + idempotency + failure mode + retry）
前置：PR-A3（#78 `7ae5558`，factor-add gate）已 merged + prod 部署；#79（`a07ee14`，CI coverage）已 merged。
Migration：本 PR = **0055**（latest = 0054）。

---

## 0. 定位與 owner 裁決（Phase 0 SPEC_APPROVED = owner 2026-06-13 prose ruling）

PR-A4 = **SEC-FACTOR-ADD 殘留風險 disposition PR**。處理：#78 gate 之前可能被偷 access token 植入的 passkey / wallet / OAuth identity 殘留。原則：**全量盤點 → 分級 → 對高風險動作 → 留可追蹤狀態**。不全站恐慌、不 blindly revoke、不把 audit-only 當終態。

| OD | 裁決 | 落地 |
|---|---|---|
| OD-1 風險模型 | **b**：盤點全部，high-risk 只限 add-time 有異常訊號者 | §4 risk tiering（high / low / **unknown_context**） |
| OD-2 schema | **a**：PR-A4 含 migration 0055 | §3 三表加 4 欄 + partial index |
| OD-3 enforcement | **a**：被動 flag + high-risk notify now；主動 enforcement 另 PR | §8 RESUME **LOCKED follow-up**（不得模糊） |
| OD-4 通知廣度 | **a**：只通知 high-risk；low/unknown 不寄恐慌信 | §6 notify 僅 high tier |
| OD-5 identity add-event 缺口 | **補** `oauth.identity.bind.success` | §7（payload 不存明文 provider_id） |

---

## 1. 系統架構 / 資料流

```
[admin RBAC + step-up]
   → POST /api/admin/credential-disposition/run   (batched, idempotent runner)
        ├─ enumerate window credentials (created_at < WINDOW_END, disposition_at IS NULL)
        │     across user_webauthn_credentials / user_wallets / user_identities
        ├─ classifyRisk(credential)  ── reads audit_log (add event + anomaly signals)
        │     → tier ∈ { high, low, unknown_context }
        ├─ per credential (one D1 batch / row):
        │     UPDATE <table> SET requires_reverification, disposition_reason,
        │                        disposition_at, disposition_by   (CAS: WHERE disposition_at IS NULL)
        │     + emit account.credential.disposition  (per-row audit)
        │     + (tier=high) queue notify → sendCredentialReverificationEmail (safe-send)
        └─ end of run: emit account.credential.disposition.summary (counts × type × tier)

[user]  GET /api/auth/webauthn/credentials | /api/auth/wallet | /api/auth/me
   → DTO now returns requires_reverification (+ minimized disposition_reason)  ── 被動可見性 (OD-3)
```

資料來源唯一真相：credential 表（disposition 狀態）+ `audit_log`（分級訊號）。runner 是 side-effect 集中點（D1 write + email），全走既有 adapter。

## 2. 安全邊界

- **runner = admin-only**：`requireAuth` + RBAC `admin` + step-up（`elevated:account`，for_action=`credential_disposition`）。寫 credential 表 + 寄信屬敏感操作，deny by default。新 `for_action='credential_disposition'` 需註冊進既有 step-up action allowlist（同 `unbind_wallet` / `remove_passkey` 慣例）。
- **tenant scope**：本 disposition 是平台級安全處置（跨全 user 的殘留風險盤點），非租戶資料操作；runner 以 platform-admin 身分執行，**不**接受外部 tenant 參數 → 無 horizontal escalation 面。credential 表本身以 `user_id` FK 隔離，runner 唯讀分級 + 寫自己這顆 credential 的 disposition 欄，無跨 user 汙染。
- **input validation**：runner body schema（Zod）僅接 `{ types?: ('passkey'|'wallet'|'identity')[], maxPerRun?: int }`，allowlist + 上限；未知欄位 reject。
- **output DTO**：list 端點只回 `requires_reverification`(bool) + `disposition_reason` 的**最小化 reason code**（enum，不洩漏內部訊號細節）；不 dump 內部 disposition_by / 原始 audit context。
- **secret / PII**：notify email 走既有 Resend adapter；audit payload **不存明文** credential_id / address / provider_id（沿用 `hashIdentifierForAudit` keyed-HMAC，同既有 add 事件）。

## 3. 資料表設計 — migration 0055（expand-only，可 rollback）

三張表（`user_webauthn_credentials` / `user_wallets` / `user_identities`）各加：

```sql
requires_reverification INTEGER NOT NULL DEFAULT 0   -- 0=ok / 1=需 re-verify（高或未知風險）
disposition_reason      TEXT                          -- enum code：high:<signal> / unknown_context / low_reviewed
disposition_at          TEXT                          -- 處置時間（runner 已處理的 idempotency marker）
disposition_by          TEXT                          -- 來源：a4_runner / admin:<id>（追溯）
```

partial index（high-risk set 很小，runner 跨表掃 + 未來 enforcement 查 flag 用）：

```sql
CREATE INDEX idx_<table>_requires_reverif
  ON <table>(requires_reverification) WHERE requires_reverification = 1;
```

**Expand/migrate/contract**：本顆只 Expand（加 nullable/defaulted 欄 + index）。reader（list DTO）與 writer（runner）同 PR 上線但對舊 row 安全（default 0）。無 contract 階段（不刪舊欄）。

**Rollback（down 0055）**：先 `DROP INDEX idx_*_requires_reverif`（×3），再 `ALTER TABLE <t> DROP COLUMN`（×4 ×3 表）。SQLite ≥3.35 / D1 支援 DROP COLUMN；index 先於 column drop。

**DB 要求對照（owner 表）**：migration ✅必須｜rollback ✅up/down/re-up round-trip test｜index ✅partial｜default ✅`requires_reverification=0`｜tx ✅backfill 以 `disposition_at IS NULL` CAS 保證 idempotent 可重跑｜schema verify ✅migration test 斷言欄位存在 + default。

**migration 註解禁含 `;`**（runner/resetDb split on raw `;`，沿用 0054 教訓）。

## 4. 風險模型（OD-1=b；high-risk 訊號明列，不可模糊）

每顆 window credential 經 `classifyRisk()` → tier：

### 4.1 add-time anchor（自審 P-1 修正：用 created_at，不用 HMAC-id 比對）
**為何不用 hashed-id 比對**：add 事件存的 `credential_id_hmac16` / `address_hmac16` 帶 `salted` flag；若 salt 為 per-event 隨機則**無法**從 credential 明文重算 hash 來 join → correlation 會靜默失效。改以**時間 anchor**：credential 的 `created_at` 就是 add 時刻（與 add 成功事件同一 INSERT 瞬間 `datetime('now')`，秒級相等），直接拿 `credential.created_at` 當錨點，免 HMAC 重現。

- **anchor = credential 的建立時刻欄**（分表取欄，自審 P-3）：passkey=`user_webauthn_credentials.created_at`、**wallet=`user_wallets.signed_at`**（此表無 `created_at`）、identity=`user_identities.created_at`。下文「anchor」一律指該表對應欄。window 過濾（§4.4）同樣分表取此欄。
- **add 事件存在性檢查**：查同 user 在 `[anchor − ε, anchor + ε]`（ε = `ADD_EVENT_MATCH_TOLERANCE_SEC`，預設 5 秒）內是否有對應 add 成功事件（passkey=`webauthn.register.success` / wallet=`wallet.bind.success`）。
  - 有 → 進 §4.2 異常判定。
  - 無（passkey/wallet 找不到對應 add 事件，或 event context 缺失不可歸因）→ `unknown_context`（owner 訊號 7）。
- **identity**：歷史無 add 成功事件（OD-5 缺口）→ 一律 `unknown_context`。

### 4.2 high-risk 訊號（取 anchor = `credential.created_at`，查同 user 在 `[anchor − W, anchor + W]` 窗內的異常；`W = ANOMALY_CORRELATION_WINDOW_MIN`，named const，預設 60 分）
| # | 訊號 | 來源 audit event（coding 時 pin 確切名） |
|---|---|---|
| 1 | add 附近有新裝置登入 | `auth.new_device`（critical） |
| 2 | add 附近有 country / ASN / IP jump | `auth.country_jump`（critical） |
| 3 | add 附近有 risk-blocked / suspicious | risk-blocked 登入事件（callback 風險攔截，名 coding 時確認） |
| 4 | credential created_at 與異常 session 高度重疊 | 同 traceId / session 的異常事件 |
| 5 | OAuth identity 缺 add-context 且落在高風險窗口 | → 歸 `unknown_context`（見 4.1） |
| 6 | 同 user 短時間新增多個 factor | 同 user add 事件 ≥ `MULTI_FACTOR_BURST_N`（預設 3）落在 `MULTI_FACTOR_BURST_MIN`（預設 30 分）窗 |
| 7 | add-time 缺必要 audit context 且無法歸因 | → `unknown_context` |

### 4.3 tier 決策
- 任一訊號 1–4 / 6 命中 → **high**
- add 事件存在 + 無異常 → **low**
- 無 add 事件 / context 缺失不可歸因（含所有歷史 identity）→ **unknown_context**

### 4.4 window 邊界
- `WINDOW_END` = #78 prod 部署時間（從 Deploy run on `7ae5558` 的 success 時戳 pin；**保守向上取整**，邊界同日 credential 一律當 window 收進複查）。
- runner 只處理 `created_at < WINDOW_END AND disposition_at IS NULL`；post-gate credential（gate 已保護）不進 runner（created_at 過濾 → 天然 idempotent，不誤標）。

### 4.5 query 策略（自審 P-2：避免 N+1）
risk 分級若每顆 credential 各打多支 audit_log query → N+1。runner 改 **per-user 批次預載**：以 batch 內 distinct `user_id` 集合，**一支** query 撈該批所有相關 audit 事件（add 成功 + 異常 event_type allowlist + window 範圍 `[min(created_at)−W, max(created_at)+W]`），在記憶體內按 user_id + 時間做 correlation。每批 query 數 = O(1)（add+anomaly 各一），非 O(credentials)。`maxPerRun` 上限同時 cap 單批記憶體與 query 量。integration test 加 query-count 斷言（高風險加碼 N+1 防護）。

## 5. disposition 狀態機（高風險加碼）

```
undispositioned (disposition_at IS NULL, created_at < WINDOW_END)
   │ classifyRisk
   ├─ high            → requires_reverification=1, reason='high:<signal>',  notify=YES
   ├─ unknown_context → requires_reverification=1, reason='unknown_context', notify=NO（保守 flag + 被動可見，不恐慌）
   └─ low             → requires_reverification=0, reason='low_reviewed',     notify=NO
        ↓ (任一 tier) disposition_at=now, disposition_by='a4_runner', 寫入經 CAS
dispositioned (disposition_at NOT NULL) → runner 永遠 skip（idempotent 終態）
```

**idempotency 不變量**：**三 tier 全寫 `disposition_at`**（含 low —— 否則 re-run CAS 又成功 → 重複處理）；寫入用 `UPDATE … SET … WHERE id=? AND disposition_at IS NULL`（CAS）；`changes()===1` 才算這次處置。並發或 re-run 第二者 `changes()=0` → skip。

**audit 分層（自審 P-4，對齊 owner「low→summary」）**：`changes()===1` 後——
- `high` / `unknown_context` → emit **per-row** `account.credential.disposition`；`high` 另 queue notify。
- `low` → **不** emit per-row，只累加進 per-run summary 計數。
三 tier 全進 summary。

> 註：`unknown_context` 仍 `requires_reverification=1`（保守，不假裝 safe，OD-5）但 **不寄信**（OD-4 只通知 high）——使用者於 list 端點被動看到 flag，主動處置走 enforcement follow-up。此 high↔unknown 的「flag 同、notify 異」分界送 Arch Gate 複核（見 §11 OD-A4-a）。

## 6. Notify（OD-4：只 high tier）

- 新模板 `sendCredentialReverificationEmail(env, { email, credentialType, reasonCode })` → email.ts，沿用 Resend adapter + 既有錯誤處理。
- 內容：通知使用者帳號某登入因子因安全複查需重新驗證 + 引導連結（dashboard）；**不**含 credential 明文識別碼。
- 觸發：僅 `tier=high` 且該顆 disposition CAS `changes()===1`（首次處置）→ 天然不重寄。
- **safe-send**：寄信失敗不中斷 runner（log + 該顆標 notify_failed 於 audit data，不回滾 disposition）；憑證路徑 vs 觀察路徑分界沿用既有慣例。

## 7. OD-5 — 補 `oauth.identity.bind.success`

- 位置：`callback.ts` binding 分支，consume+INSERT batch `changes()===1` 成功後 emit。
- payload：`{ provider, provider_id_hmac16 }`（keyed-HMAC，**無明文** provider_id，沿用 wallet/passkey 慣例）。
- 分類：audit-policy 註冊（IMMUTABLE 或 SECURITY_SIGNAL，與既有 bind 事件對齊）。
- safe：失敗不中斷綁定核心流程（safeUserAudit）。
- **歷史影響**：此事件僅對**未來** identity 生效；既有 identity 無此事件 → 於 §4 一律 `unknown_context`（誠實，不假裝 safe）。

## 8. RESUME.md 回寫 + ⚠ LOCKED follow-up（OD-3 硬鎖）

PR-A4 merge 後於 RESUME.md（與本 PR 同批或緊接 docs）寫入：
1. PR-A4 已完成 disposition（盤點 + 分級 + high notify + flag）。
2. **明確 LOCKED follow-up（不得模糊）**：
   ```
   FOLLOW-UP LOCKED — credential requires_reverification enforcement PR
   範圍：requires_reverification=1 的 credential 在「使用前」強制 re-verify（passkey login /
        wallet login·binding / OAuth login / account recovery），含 user-lockout / support fallback。
   觸發：本顆（被動 flag）merge 後即列為下一個 auth-runtime 安全 PR 候選；不碰 SEC-REFRESH runtime。
   ```
3. 同步 backlog memory（F-2 backlog 或新 backlog 行）。

## 9. 錯誤模型 / Observability

- 統一 envelope（`{ error: { code, message, traceId } }`）；runner 4xx=BusinessError（權限/輸入）、5xx=SystemError（告警）。
- **audit 事件**（新增，需註冊 audit-policy + **同步更新兩處 `_registrySize` lockstep**：`tests/audit-policy.test.ts:333` 與 `tests/integration/session-revoke-multi.test.ts:392`，否則 CI 紅——#79 教訓）：
  - `account.credential.disposition`（per-row；SECURITY_SIGNAL；data：credential_type, tier, reasonCode, requires_reverification, hashed id, notify_outcome）
  - `account.credential.disposition.summary`（per-run；SECURITY_SIGNAL；data：counts × type × tier, scanned, dispositioned, notified, failures）
  - `oauth.identity.bind.success`（§7）
  - registry 222 → **225**（+3）。
- **監控**（owner 防禦表）：summary 事件帶 high-risk count / notify count / disposition count / failure count，可從 audit 查。

## 10. 部署 / 執行

- migration 0055：依「自動部署 repo 的 migration 紀律」—— push-main 自動部署 + 手動 D1 migration → **merge 前先 `wrangler d1 execute chiyigo_db --remote --file=0055` apply + verify prod schema**，list DTO 讀新欄才安全。runner 端點 merge 後手動觸發一次（admin + step-up）。
- runner 一次性：merge + migration apply 後，admin 手動 POST 跑（batched 至 drained）；非 cron、非公開高頻端點（防禦表 RateLimit「不適用」）。

## 11. Open Decisions（送 Arch Gate prose 裁）

- **OD-A4-a（unknown_context 的 notify）**：unknown_context `requires_reverification=1` 但**不寄信**（§5 註）。替代＝unknown_context 也寄一封較弱措辭信。建議維持不寄（OD-4「只 high notify」+ near-zero 母體避免恐慌；被動 flag 已可見）。
- **OD-A4-b（runner 機制）**：admin-only 端點（§1，可 RBAC+step-up+audit+監控）vs 純 offline script（wrangler）。建議**端點**（治理可控、可審、可監控），但接受 Arch Gate 改判 offline。
- **OD-A4-c（low tier 是否落 disposition_at）**：low 也寫 `disposition_at`（標「已複查為低風險」）→ re-run skip，idempotent 乾淨；代價＝對全 window low credential 寫一次。替代＝low 不寫 disposition_at（每次 re-run 重掃）。建議**寫**（idempotent 優先；near-zero 量無成本顧慮）。

## 12. 測試計畫（對齊 owner test 表）

| 類型 | 測試（pre-fix/pre-feature 必鎖 exact 行為） |
|---|---|
| migration | 0055 up / down / re-up round-trip + idempotent |
| schema | 三表 `requires_reverification`(default 0) / `disposition_reason` / `disposition_at` / `disposition_by` 存在；partial index 存在 |
| inventory | 三類 credential 都被枚舉（passkey/wallet/identity 各 seed → 都進 runner） |
| risk:high | add 事件 + 窗內 `auth.new_device` → tier=high + requires_reverification=1 |
| risk:high(burst) | 同 user 短時多 factor → high |
| risk:low | add 事件 + 無異常 → low + requires_reverification=0 |
| risk:unknown | identity 無 add 事件 / context 缺 → `unknown_context` + requires_reverification=1（**不可假裝 safe**） |
| disposition | high → flag=1 + reason；CAS 寫入 |
| idempotent | runner re-run：dispositioned row skip，**不重複 notify / 不重複 audit** |
| notify | 僅 high tier 寄；low/unknown 不寄；寄信失敗不中斷 runner |
| audit | per-row `account.credential.disposition` + per-run summary；registry 225 + 兩處 lockstep 同步 |
| list DTO | GET webauthn/credentials | wallet | me → 回 `requires_reverification` / disposition state |
| OD-5 | 新 binding 成功 emit `oauth.identity.bind.success`（payload 無明文 provider_id） |
| window | created_at ≥ WINDOW_END（post-gate）→ runner 不處理 |
| permission | 非 admin / 無 step-up → 403（RBAC negative test） |

## 13. 改檔清單（預計）

| 檔 | 動作 |
|---|---|
| `migrations/0055_credential_disposition.sql` + `down/` | 新增（三表 ×4 欄 + 3 partial index） |
| `functions/utils/credential-disposition.ts` | 新增（classifyRisk + runner core；D1-dependent → 建檔同 PR 進 vitest coverage exclude category-A） |
| `functions/api/admin/credential-disposition/run.ts` | 新增 runner 端點（admin+step-up） |
| `functions/utils/email.ts` | +`sendCredentialReverificationEmail` |
| `functions/utils/audit-policy.ts` | +3 event 註冊 |
| `functions/api/auth/oauth/[provider]/callback.ts` | binding 分支 emit `oauth.identity.bind.success` |
| `functions/api/auth/webauthn/credentials.ts` / `wallet.ts` / `me.ts` | list DTO +`requires_reverification` |
| `tests/integration/credential-disposition.test.ts`（新）+ `migrations.test.ts` / `audit-policy.test.ts` / `session-revoke-multi.test.ts`（registry 同步）/ callback·webauthn·wallet·me 既有測試 | 測試 |
| `vitest.config.js` | credential-disposition.ts 進 category-A exclude（建檔即裁，避免重蹈 #79） |
| `docs/audit/RESUME.md` | 回寫 + LOCKED follow-up |

> **預警**：新增 `functions/utils/credential-disposition.ts` 是 D1-dependent util → 建檔同 PR **必須**進 `vitest.config.js` category-A exclude，否則 unit coverage 0% 拖垮 gate（#79 同款）。已列入改檔清單。
