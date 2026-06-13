# SEC-FACTOR-ADD ADD-A PR-A4 — Existing-Credential Disposition Plan

狀態：`PLAN_DRAFT`（**Arch Gate r1 = REVISE_REQUIRED → 本版 r2 已修，重送** `CHATGPT_ARCH_APPROVED`）
動工分級：**L2 + 高風險加碼**（credential / auth / audit 熱區 → 補 disposition state machine + idempotency + failure mode + retry）
前置：PR-A3（#78 `7ae5558`，factor-add gate）已 merged + prod 部署；#79（`a07ee14`，CI coverage）已 merged。
Migration：本 PR = **0055**（latest = 0054）。

**Arch Gate r1 修正摘要（本版 r2）**：F1 migration down 改 **table-rebuild**（不用 DROP COLUMN）+ data-preservation test（§3）；F2 `unknown_context` 確立為**獨立 tier**（≠ low，`requires_reverification=1` + per-row audit + list user-visible，§4.3/§5）；RC3 runner 加 **dry-run / 防重入 RL / security-scope / run-lifecycle audit / count-only output**（§1/§2/§9）；RC5 **SSOT 分工**寫明（§3）；OD-A4-a/b/c 已裁（§11）；§12 測試矩陣補齊。

---

## 0. 定位與 owner 裁決（Phase 0 SPEC_APPROVED = owner 2026-06-13 prose ruling）

PR-A4 = **SEC-FACTOR-ADD 殘留風險 disposition PR**。處理：#78 gate 之前可能被偷 access token 植入的 passkey / wallet / OAuth identity 殘留。原則：**全量盤點 → 分級 → 對高風險動作 → 留可追蹤狀態**。不全站恐慌、不 blindly revoke、不把 audit-only 當終態。

| OD | 裁決 | 落地 |
|---|---|---|
| OD-1 風險模型 | **b**：盤點全部，high-risk 只限 add-time 有異常訊號者 | §4 risk tiering（high / low / **unknown_context**） |
| OD-2 schema | **a**：PR-A4 含 migration 0055 | §3 三表加 4 欄 + partial index；**down=table-rebuild**（Arch r1 F1） |
| OD-3 enforcement | **a**：被動 flag + high-risk notify now；主動 enforcement 另 PR | §8 RESUME **LOCKED follow-up**（不得模糊） |
| OD-4 通知廣度 | **a**：只通知 high-risk；low/unknown 不寄恐慌信 | §6 notify 僅 high tier |
| OD-5 identity add-event 缺口 | **補** `oauth.identity.bind.success` | §7（payload 不存明文 provider_id） |

---

## 1. 系統架構 / 資料流

```
[admin + security step-up]  POST only
   → POST /api/admin/credential-disposition/run   { dryRun, types?, maxPerRun? }
        ├─ emit account.credential.disposition.run (phase=start|dry_run)
        ├─ enumerate window credentials (created_at < WINDOW_END, disposition_at IS NULL)
        │     across user_webauthn_credentials / user_wallets / user_identities  (batched, maxPerRun)
        ├─ per-user BATCH preload audit_log (add + anomaly) → classifyRisk in memory (no N+1)
        │     → tier ∈ { high, unknown_context, low }
        ├─ per credential (CAS: WHERE disposition_at IS NULL):
        │     [dryRun=false] UPDATE <t> SET requires_reverification, disposition_reason,
        │                                    disposition_at, disposition_by
        │     [high|unknown] emit account.credential.disposition (per-row)
        │     [high]         queue notify → sendCredentialReverificationEmail (safe-send)
        │     [low]          summary count only
        │     [dryRun=true]  classify + count only, NO write / notify / per-row audit
        └─ emit account.credential.disposition.run (phase=complete|failed, count-only)
   → response: counts only (scanned / per-tier / notified / failed / remaining)

[user]  GET /api/auth/webauthn/credentials | /api/auth/wallet | /api/auth/me
   → DTO returns requires_reverification + minimized reason  ── high/unknown 顯示「需重新確認」, low 正常 (OD-3 被動可見)
```

資料來源唯一真相：credential 表（disposition 狀態）+ `audit_log`（分級訊號）。runner 是 side-effect 集中點（D1 write + email），全走既有 adapter。

## 2. 安全邊界

- **runner = admin/security-only + POST-only**（Arch Gate RC3）：`requireAuth` + RBAC `admin` + **security-operation step-up**（`elevated:account`，for_action=`credential_disposition`），**非**一般 admin-read 權限可跑（寫 credential 表 + 寄信屬高敏感）。新 `for_action='credential_disposition'` 註冊進 step-up action allowlist（同 `unbind_wallet` / `remove_passkey`）。deny by default。
- **dry-run（RC3 MUST）**：runner body 帶 `dryRun: boolean`。`dryRun=true` → 跑 classifyRisk + 回 inventory/counts，但**不寫 DB、不寄信、不 emit per-row audit**（只 emit run-lifecycle `phase='dry_run'`）。預設保守（建議 default `dryRun=true`，需顯式 `false` 才實寫）。
- **防重入（RC3）**：端點 rate-limit（kind=`credential_disposition_run`，低 max）防快速重入；**真正並發正確性**仍由 per-row CAS（`disposition_at IS NULL`）保證——並發兩 run 同一 row 只一個贏，不重複處置。
- **tenant scope**：平台級安全處置（跨全 user 殘留風險盤點），非租戶操作；runner 以 platform-admin 身分執行，**不**接受外部 tenant 參數 → 無 horizontal escalation。credential 表以 `user_id` FK 隔離，runner 唯讀分級 + 只寫該 credential 自己的 disposition 欄，無跨 user 汙染。
- **input validation**：runner body schema（Zod）僅接 `{ dryRun: boolean, types?: ('passkey'|'wallet'|'identity')[], maxPerRun?: int }`，allowlist + 上限；未知欄位 reject。
- **output = count-only（RC3）**：runner 回傳**只有計數**（scanned / dispositioned / per-tier(high/unknown/low) / notified / failed / remaining），**不吐任何明文 credential detail**。
- **list DTO output**：list 端點只回 `requires_reverification`(bool) + `disposition_reason` 的**最小化 reason code**（enum，不洩漏內部訊號細節）；不 dump 內部 disposition_by / 原始 audit context。`requires_reverification=1`（high/unknown）→ 顯示「需重新確認」狀態；low → 正常。
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

**Rollback（down 0055）— table-rebuild，不用 `DROP COLUMN`（Arch Gate F1）**：credential 表是安全關鍵 + `DROP COLUMN` 在 D1/SQLite 對 index·constraint·partial index 相容性不穩，故 down 走保守 **table-rebuild（12-step）**：
1. `DROP INDEX idx_<t>_requires_reverif`（×3）。
2. 每表：`CREATE TABLE <t>_old`（**逐字重建 0055 之前的原始 schema** —— passkey 取自 `0021_webauthn.sql`、wallet 取自 `0023_user_wallets.sql`、identity 取自 `0000_base.sql`，含原欄位·型別·constraint·default）。
3. `INSERT INTO <t>_old (<原欄位…>) SELECT <原欄位…> FROM <t>`（**只搬原欄位 → 既有 credential 資料完整保留**，丟棄 4 個 disposition 欄）。
4. `DROP TABLE <t>` → `ALTER TABLE <t>_old RENAME TO <t>`。
5. 重建原始 index（passkey/wallet/identity 各自原 index）。

**FK 完整性**：三表是 FK-leaf（只 `user_id` → `users(id)` 出向，無其他表入向參照——coding 時驗證確認）；table-rebuild 期間依需要 `PRAGMA foreign_keys` 處理，rebuild 後出向 FK 於新表重建。若驗出非 leaf（有入向 FK）→ 回報並改採 column-preserving down + rollback plan（Arch Gate 允許的替代）。

**down 正確性保險＝round-trip + data-preservation test**：up→down→up，斷言 (a) down 後 schema 等價於 0055 前（欄位集合、index）、(b) **既有 credential row 資料零損失**（id/user_id/credential_id/address/provider… 全保留）、(c) re-up 後 disposition 欄回來且 default 正確。reconstruction fidelity 風險由此 test 攔截。

**DB 要求對照（owner 表）**：migration ✅必須｜rollback ✅**table-rebuild** up/down/re-up + data-preservation round-trip test｜index ✅partial｜default ✅`requires_reverification=0`｜tx ✅backfill 以 `disposition_at IS NULL` CAS 保證 idempotent 可重跑｜schema verify ✅migration test 斷言欄位存在 + default + down 後欄位消失。

**SSOT 語意分工（Arch Gate RC5）**：`elevation_grants.risk_reason` = 一次性 elevation grant 的風險原因（grant 生命週期）；credential 表 `disposition_reason` = 既有 credential 殘留風險的**處置結果**，其 **SSOT 是 credential row 本身**。兩者**不得互為來源**：runner 分級讀 `audit_log`（訊號）→ 寫 credential row（結果），不從 `elevation_grants.risk_reason` 推導 credential disposition。

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

### 4.3 tier 決策（三層；Arch Gate RC1：`unknown_context` 是獨立 tier，**不可歸 low**）
| tier | 判斷 | disposition |
|---|---|---|
| `high` | add-time 有異常訊號（訊號 1–4 / 6 命中） | `requires_reverification=1` + **notify** + **per-row audit** + user-visible |
| `unknown_context` | 缺 add success audit / 無法關聯 add-time context（含**所有歷史 identity**） | `requires_reverification=1` + **per-row audit** + **user-visible（list DTO 顯示）**；email **可不寄**（OD-4 比例原則） |
| `low` | 有 add-time context 且無異常 | `requires_reverification=0` + `disposition_at` + **summary audit only**（不逐筆、不通知、list 顯示正常） |

**關鍵**：`unknown_context` 缺 context 本身就是「無法證明安全」的狀態 → 必 `requires_reverification=1` 且 user-visible，**不得**因不寄信而退化成 low（安全債）。其主動處置走 §8 enforcement locked follow-up。

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

**audit 分層（自審 P-4 + Arch Gate RC1，對齊 owner「low→summary」）**：`changes()===1` 後——
- `high` / `unknown_context` → emit **per-row** `account.credential.disposition`；`high` 另 queue notify。
- `low` → **不** emit per-row，只累加進 `account.credential.disposition.run`（phase=complete）的計數。
三 tier 全進 `.run` 收尾計數。

> 註（Arch Gate RC2 已裁）：`unknown_context` 缺 add-context = 無法證明安全 → 必 `requires_reverification=1` + **per-row audit** + **list DTO user-visible「需重新確認」**；email **可不寄**（OD-4 比例原則）。**不得**因不寄信而退化成 low。主動處置（用前強制 re-verify）走 §8 enforcement locked follow-up。

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
  - `account.credential.disposition`（**per-row，僅 high + unknown_context**；SECURITY_SIGNAL；data：credential_type, tier, reasonCode, requires_reverification, hashed id, notify_outcome）
  - `account.credential.disposition.run`（**run-lifecycle**，RC3；SECURITY_SIGNAL；data：`phase ∈ {start, dry_run, complete, failed}` + counts（scanned / dispositioned / per-tier high·unknown·low / notified / failed / remaining）。`start` 開跑即記、`complete`/`failed` 收尾記、`dry_run` 預覽記——含 low tier 的 summary 計數）
  - `oauth.identity.bind.success`（§7）
  - registry 222 → **225**（+3）。
- **監控**（owner 防禦表）：`.run` 事件帶 high / unknown / notified / failed counts，可從 audit 查 run 健康與殘留風險規模。

## 10. 部署 / 執行

- migration 0055：依「自動部署 repo 的 migration 紀律」—— push-main 自動部署 + 手動 D1 migration → **merge 前先 `wrangler d1 execute chiyigo_db --remote --file=0055` apply + verify prod schema**，list DTO 讀新欄才安全。runner 端點 merge 後手動觸發一次（admin + step-up）。
- runner 一次性：merge + migration apply 後，admin 手動 POST 跑（batched 至 drained）；非 cron、非公開高頻端點（防禦表 RateLimit「不適用」）。

## 11. Decisions（Arch Gate 已裁，r1）

- **OD-A4-a（unknown_context notify）→ 裁定**：`requires_reverification=1` + per-row audit + **list DTO user-visible**；email **可不寄**（比例原則）。**不得**退化成 low（§4.3 / §5 已落地）。
- **OD-A4-b（runner 機制）→ 裁定 admin endpoint**（非 offline script）。需 POST-only / dry-run / idempotent / batch / security-scope / run-lifecycle audit / count-only output（§1 / §2 / §9 已落地）。
- **OD-A4-c（low disposition_at）→ 裁定 low 寫 `disposition_at`**（idempotent），但**不**寫 per-row audit，只進 `.run` summary（§5 已落地）。

## 12. 測試計畫（對齊 owner test 表）

| 類型 | 測試（pre-fix/pre-feature 必鎖 exact 行為） |
|---|---|
| migration:up | 0055 up：三表 `requires_reverification`(default 0) / `disposition_reason` / `disposition_at` / `disposition_by` 存在；partial index 存在 |
| migration:down | **down 用 table-rebuild（不用 DROP COLUMN）**；down 後 4 欄消失、schema 等價 0055 前；**既有 credential row 資料零損失**（id/user_id/credential_id/address/provider 全保留） |
| migration:re-up | up→down→up round-trip，disposition 欄回來 + default 正確 |
| inventory | 三類 credential 都被枚舉（passkey/wallet/identity 各 seed → 都進 runner） |
| risk:high | add 事件 + 窗內 `auth.new_device` → tier=high + requires_reverification=1 |
| risk:high(burst) | 同 user 短時多 factor → high |
| risk:low | add 事件 + 無異常 → low + requires_reverification=0 |
| risk:unknown | identity 無 add 事件 / context 缺 → `unknown_context` + requires_reverification=1（**不可假裝 safe、不可歸 low**） |
| disposition | high → flag=1 + reason；CAS 寫入；unknown → flag=1 + per-row audit |
| idempotent | runner re-run：dispositioned row skip，**不重複 notify / 不重複 audit** |
| dry-run | `dryRun=true` → 分級 + 回 counts，但**不寫 DB / 不寄信 / 不 emit per-row audit** |
| N+1 | runner batch **query-count 斷言**：query 數不隨 credential 數線性成長 |
| notify | 僅 high tier 寄；low/unknown 不寄；寄信失敗不中斷 runner |
| audit | per-row（high/unknown）+ `.run`(start/complete/failed)；registry **225** + **兩處 lockstep 同步**（audit-policy + session-revoke-multi） |
| list DTO | GET webauthn/credentials \| wallet \| me → 回 `requires_reverification`；**high/unknown 顯示 flag、low 不顯示** |
| OD-5 | 新 binding 成功 emit `oauth.identity.bind.success`（payload 無明文 provider_id） |
| window | created_at ≥ WINDOW_END（post-gate）→ runner 不處理 |
| permission | 非 admin / 無 **security step-up** → 403（RBAC negative test）；runner POST-only |

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
