# PR1 — Tenant Foundation 實作 Plan（待 codex gate-1 審）

- **建立日期**：2026-05-28
- **動工分級**：L3（新 bounded context + 安全模型變更）
- **狀態**：✅ **codex Plan Review r3 = APPROVE Gate 1**（2026-05-28）。r1（3 findings）+ r2（1 auth-boundary blocker）全數修正並複驗（見 §0.0）。**可進 PR1 實作**；因觸及 auth/session + tenant boundary + migration，ship-ready 前必跑 dynamic validation（codex r3 要求）。
- **上游**：`docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md`（✅ codex r5 full design gate APPROVED）。本 plan 落實該 doc §5 / §6 / §20 的 **Tenant Foundation only** 範圍。
- 🔒 **凍結檔（2026-06-10 前不得改）**：`functions/utils/audit-archive.ts` / `audit-aggregate-archive.ts` / `audit-aggregate-archive-runner.ts` / `tsconfig.tests.json`。本 PR 不碰這 4 檔（見 §11 檔案清單）。
- **HEAD 基準**：`0b021e4`（working tree clean，最新 migration `0046`）。

---

## 0.0 Codex Plan Review 紀錄

**r1（2026-05-28）→ Reject as written, approve after fixes**（方向對、範圍切得乾淨，2 個 tenant/auth boundary 風險須先補）。三項修正已套入本檔：

| # | Finding | 嚴重度 | 修正 | 章節 |
|---|---|---|---|---|
| 1 | **personal tenant 可被「錯誤 membership row」穿透** —— invariant 與 `GET /api/tenants` 只驗 active membership，schema 允許任何 membership row 指向 personal tenant；若 bug/seed/admin path 建出 `(alicePersonal, bob, active)`，Bob 可列出/切入 Alice 的 personal tenant | **Critical** | `resolveIssuanceContextForTenant` 與 `GET /api/tenants` 都加 personal-tenant owner guard：`t.type='organization' OR (t.type='personal' AND t.personal_owner_user_id = userId)`；加 negative test | §5、§6.2、§8 |
| 2 | **access_token 簽點少算 `oauth/bind-email.ts`** —— 它簽 access_token（L189）且建新 user（L162）；漏接會續發無 `tenant_id`/`platform_role` 的 token，並削弱「lazy ensure 覆蓋所有 user-creation path」保證 | **State consistency** | 7 → **8 簽點**；bind-email 納入檔案清單 / claim wiring / 測試 | §1、§3.3、§9、§11、§8 |
| 3 | **org-switch audience 策略需寫死** —— 「aud 沿用當前」語意模糊；`requireAuth` 預設只驗 `aud='chiyigo'` | **Contract** | 明寫：org-switch 為 chiyigo control-plane only，`requireAuth` 預設 aud gate 已擋非 chiyigo token；重發明確 `audience='chiyigo'`；加「非 chiyigo aud 被拒」測試；RP-scoped 切換不在 PR1 | §6.1、§8 |

**codex r1 已同意（裁示定案）**：
- 保留 `tenants.personal_owner_user_id`（同意非變相 `users.tenant_id`，且給 personal idempotency 硬保證）→ **決策 G 定案：保留**。
- 接受 refresh 後回 personal、PR1 不做 active-tenant persistence（UX tradeoff，非 Tier 0 blocker）→ **決策 D 定案**。
- 同意 8 簽點最小 diff、不做 claim builder 重構。
- **Zod 不在 `package.json`** → PR1 body 僅 `{tenant_id:number}`，改 inline runtime validator（不引入套件，合 §套件管理）→ §6.1。
- 測試檔名對齊 repo 現況 **`.ts`**（`tenant-foundation.test.ts`；helpers 在 `_helpers.ts`）→ §8、§9、§11。

**r2（2026-05-28）→ Reject as written, approve after one fix**（r1 三項認可不再卡；新抓 1 個 auth-boundary blocker）。已套入：

| # | Finding | 嚴重度 | 修正 | 章節 |
|---|---|---|---|---|
| 4 | **org-switch / `GET /api/tenants` 不能只靠裸 `requireAuth`** —— `requireAuth` 只擋 `scope='pre_auth'`（auth.ts:68）；但 `temp_bind_token`（callback.ts:161，`scope='temp_bind'`、`sub=provider_id`、**未傳 audience → 預設 aud='chiyigo' 會過 aud gate**）與 step-up token（step-up.ts:158，純 `elevated:*` scope、`sub`=真實 user id）都會穿過進 tenant resolution。最糟：temp_bind 的 numeric `provider_id` 撞真實 `users.id` → 未完成登入的 token 進 tenant 解析 | **Critical** | 新增 `requireRegularAccessToken`（`functions/utils/auth.ts` **加法 export**，不改 requireAuth）：requireAuth 後再拒 `temp_bind` / 任何 `KNOWN_ELEVATED_SCOPES` / `sub` 非正整數；org-switch + GET tenants 改用之；加 negative test | §5.1、§6.1、§6.2、§8 |

**codex r2 其他**：bind-email 修正已到位（8 簽點 / 3 user-creation path / test 18，無新 blocker）；observability 可接受（⚠️ 實作時 **audit-policy registry 同步** `tenant.switch.*`，否則只會 warn — 對齊 [[feedback_audit_classification]]）；Queue / Payment / Distributed-State N/A。

**r3（2026-05-28）→ ✅ APPROVE Gate 1**（無剩餘 plan-level critical risk）。r2 blocker 確認關閉（`requireRegularAccessToken` 加法 helper + 兩端點採用 + test 20-23 覆蓋 temp_bind/step_up/pre_auth/bad-sub）。實作須遵守兩點：
- **(observability)** 上線前把 `tenant.switch.success` / `tenant.switch.deny` 加進 **audit-policy registry**，避免淪為 warn-only 分類債（同 r2 提醒）。
- **(implementation precision)** `requireRegularAccessToken` 後**取一次 `const userId = Number(user.sub)`**（§5.1 已驗正整數），call site 一律傳 `userId` 進 tenant resolver，**不傳 raw `user.sub`**。
- **(ship gate)** 觸及 auth/session + tenant boundary + migration → ship-ready 前**必跑 dynamic validation**（非僅 unit/int test）。

---

## 0. 範圍（鎖定 §20，不擴張）

**In scope（PR1 = Tenant Foundation only）**
1. `tenants`（含 personal tenant）+ `organization_members`（多對多）兩張新表 + 既有 user backfill。
2. access_token claim delta：加 `tenant_id` + `platform_role`（**純加法、向後相容、不踢既有 session**）。
3. active tenant 決定邏輯（fresh login 預設 = personal tenant）。
4. tenant repository guard（新 module；`tenant_id` 一律取自 token / server 推導，禁信 client）。
5. org-switch endpoint（切 active tenant → 重發 access_token）+ **token issuance invariant**（fail-closed）。
6. `GET /api/tenants`（列自己的 active membership；給 switcher UI + cross-tenant read-guard 示範）。
7. cross-tenant + invariant **negative tests**（核心驗收門）。

**Out of scope（明確不做，留後續 PR）**
- wallet / credit ledger / quota / grantPlan（PR3，需先跑 D1 batch rollback spike）。
- subscription / product_access（PR2）。
- invitation / member lifecycle / hard-revoke deny-state（PR4）。
- event outbox / consumer（PR5）。
- elder delegated-access（PR7）。
- **org-switch 跨 refresh 持久化**（見 §4 決策 D：PR1 不做，refresh 一律回 personal；列為 PR2+ enhancement）。
- per-request membership 即時查（deny-state 屬 PR4；PR1 沿用既有 token model，membership 變更 ≤15min 由 access_token 自然過期收斂）。
- tenant switcher 前端 UI（§18 MVP 標「先做 tenant switcher」，但 PR1 只出 API；UI 獨立 PR）。
- 既有 unversioned `/api/auth/*` 不改版號（見 §4 決策 F）。

---

## 1. Code survey 摘要（grounding，已讀現況）

| 項目 | 現況 | 對 PR1 的意義 |
|---|---|---|
| `signJwt` | `functions/utils/jwt.ts`：ES256，自動補 `jti`，預設 `iss=https://chiyigo.com` / `aud=chiyigo`。簽名邏輯不動。 | claim delta 只加欄位，不改 signJwt 簽名。 |
| access_token claim 形狀 | 各簽點一致：`{ sub:String(id), email, email_verified, role, status, ver, scope }`（webauthn 多 `amr`、callback 多 `provider`）。`sub` = 內部整數 id。 | `tenant_id` 用內部 `tenants.id`（與 `sub` 現行慣例一致，不引入 public id 分歧）。 |
| access_token 簽點（**8 處**，codex r1 補 bind-email） | `local/login.ts:225`、`2fa/verify.ts:144`、`webauthn/login-verify.ts:211`、`refresh.ts:223`、`local/register.ts:197`、`oauth/token.ts:143`、`oauth/[provider]/callback.ts:289`、`oauth/bind-email.ts:189` | 全部要加 tenant claim。**不含**：pre_auth（login:207）、temp_bind_token（callback:161）、step-up token、id_token（oauth/token:204）。 |
| user-creation 路徑（**3 條**，codex r1 補 bind-email） | `local/register.ts`（INSERT）、`oauth/[provider]/callback.ts:231`（INSERT）、`oauth/bind-email.ts:162`（新用戶分支 INSERT；既有 email 碰撞分支走 409 不發 token） | personal tenant 自動建：靠 **issuance 時 lazy ensure** 覆蓋所有路徑（不必逐一改 INSERT）。 |
| `requireAuth` | `functions/utils/auth.ts`：回 `user=payload`；已對 `env.chiyigo_db` 做 per-request `SELECT token_version`。 | **PR1 不改 requireAuth**（純加法；未來 endpoint 讀 `user.tenant_id`）。 |
| `role` claim | `scopes.ts`：`role`=全域 IAM role（player/admin/super_admin…），治理 admin 權限。 | `platform_role`（tenant 範圍）**獨立新 claim**，與 `role` 正交，不混用、不改既有 `role` 行為。 |
| middleware | `functions/api/_middleware.ts`：純觀測（traceId / log / CT gate），**不注入 auth**。 | PR1 不靠 middleware 注入 tenant；endpoint 自取 token claim。 |
| repository 層 | **不存在**（無 `functions/repositories/`、無 `db*.ts`；query 全 inline）。 | PR1 建**第一個** tenant repo module 作為 guard 參考實作。 |
| schema | `users(id,email,email_verified,role,status,created_at,deleted_at)`+token_version+public_sub；最新 migration `0046`。 | 新 migration = `0047`。 |
| migration house style | up 重註解 + `CREATE ... IF NOT EXISTS`；partial unique 有先例（`0034`）；down 極簡（`DROP ... IF EXISTS`）。 | 沿用：`0047_tenant_foundation.sql` + `down/0047_*.down.sql`。 |
| `tenants`/`organization_members`/`platform_role` | 全 codebase **零命中**（只在 plan doc）。 | 無撞名，乾淨起點。 |
| test 架構 | vitest 雙設定；integration 在 `tests/integration/*.test.{js,ts}`（JS→TS 遷移中）+ `_setup.sql` + `_helpers.ts`（已 `.ts`）（miniflare D1，`singleWorker:true`/`isolatedStorage:false`）。 | 新表進 `_setup.sql` + `resetDb` DELETE list；加 `seedTenant`/`seedMembership`；新 test 用 `.ts`。 |

---

## 2. Migration（expand-only，零 downtime）

新增兩檔；**只 CREATE 新表 + backfill，不 ALTER 既有表**（最小 blast radius）。

### 2.1 `migrations/0047_tenant_foundation.sql`（up）

```sql
-- Migration 0047: Tenant Foundation（B2B 多租戶平台 PR1）
-- 上游設計：docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md §5 / §20
--
-- 加 tenants + organization_members 兩表，並為既有 user backfill personal tenant。
-- expand-only：不動既有表，不刪欄；既有讀路徑零影響（程式 deploy 後才會讀新表）。
-- 全 idempotent（IF NOT EXISTS / INSERT OR IGNORE），可安全重跑。

-- ── tenants ──────────────────────────────────────────────────
-- type 為租戶類型唯一判斷依據（決策①；禁 member_count 推測）。
-- personal_owner_user_id：僅 personal tenant 有值（= 該 personal tenant 的唯一 owner）；
--   org tenant 一律 NULL。CHECK 強制兩者對應，避免半成品 row。
--   注意：這不是被禁的 users.tenant_id —— 它在 tenants 側、只標 personal 歸屬，
--   user 仍可經 organization_members 多對多屬於 N 個 org tenant（多租戶不受限）。
CREATE TABLE IF NOT EXISTS tenants (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  type                   TEXT    NOT NULL CHECK(type IN ('personal','organization')),
  name                   TEXT    NOT NULL,
  status                 TEXT    NOT NULL DEFAULT 'active'
                                 CHECK(status IN ('active','suspended','closed')),
  personal_owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT,
  CHECK( (type='personal'     AND personal_owner_user_id IS NOT NULL)
      OR (type='organization' AND personal_owner_user_id IS NULL) )
);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_type   ON tenants(type);
-- 每 user 至多一個 personal tenant（ensurePersonalTenant 並發 idempotency 的 DB 護欄）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_personal_owner
  ON tenants(personal_owner_user_id)
  WHERE type = 'personal';

-- ── organization_members（多對多；決策⑤，禁 users.tenant_id）────
CREATE TABLE IF NOT EXISTS organization_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  platform_role TEXT    NOT NULL DEFAULT 'member'
                        CHECK(platform_role IN ('tenant_owner','tenant_admin','billing_admin','member')),
  status        TEXT    NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','invited','suspended')),
  joined_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user        ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_tenant_role ON organization_members(tenant_id, platform_role);

-- ── backfill：每個未刪 user → personal tenant + owner membership ──
INSERT OR IGNORE INTO tenants (type, name, status, personal_owner_user_id, created_at, updated_at)
SELECT 'personal', 'Personal', 'active', u.id, datetime('now'), datetime('now')
FROM users u
WHERE u.deleted_at IS NULL;

INSERT OR IGNORE INTO organization_members (tenant_id, user_id, platform_role, status, joined_at, updated_at)
SELECT t.id, t.personal_owner_user_id, 'tenant_owner', 'active', datetime('now'), datetime('now')
FROM tenants t
WHERE t.type = 'personal' AND t.personal_owner_user_id IS NOT NULL;
```

### 2.2 `migrations/down/0047_tenant_foundation.down.sql`

```sql
-- 回滾：DROP 本 migration 自建的兩張新表。
-- ⚠️ 僅供「PR1 deploy 後、尚無真實 org tenant 建立前」的緊急回滾：
--    personal tenant 可由 users 重新 backfill 推導（無資料遺失）；
--    一旦有 org tenant 真實資料，回滾改走 forward-fix，不得 DROP（見 §資料庫要求 destructive 禁令）。
DROP TABLE IF EXISTS organization_members;
DROP TABLE IF EXISTS tenants;
```

**為何 down 的 DROP TABLE 不違反「禁不可 rollback 的 destructive migration」**：該禁令針對「刪除既有 production 表 / 不可復原資料」。此 down 刪的是**本 expand migration 同批新建**的表（對照 `0034` down 刪自己建的 index），且 personal tenant 為 users 的決定性衍生資料，回滾無不可逆損失。已在 down 註解明列適用邊界。

**Scale note**：backfill 為單句 `INSERT...SELECT`，chiyigo 現有 user 量極小，無 D1 query 上限疑慮；未來巨量 user 平台另議分批（PR1 不需要）。

---

## 3. Token claim delta（shared auth contract，向後相容）

### 3.1 加什麼

access_token 加兩個 claim（其餘 claim 不動）：
- `tenant_id`：active tenant 的 `tenants.id`（number）。
- `platform_role`：該 active tenant 上的 membership role（`tenant_owner|tenant_admin|billing_admin|member`）。

**不動**：`role`（全域 IAM role，正交）、`scope`、`ver`、id_token、pre_auth、step-up。

### 3.2 向後相容（不踢既有 session）

- 純加法：舊 access_token 無 `tenant_id` 仍通過 `verifyJwt`（unknown claim 不影響驗章）。
- PR1 無任何 endpoint **要求** `tenant_id` 存在（`requireAuth` 不變）；未來 tenant-scoped endpoint 才讀 `user.tenant_id`。
- ≤15min 內所有 access_token 自然 refresh → 取得 `tenant_id`（refresh.ts 也補 default personal claim）。轉換窗口有界。

### 3.3 shared 收口（對齊 [[feedback_shared_auth_contract_isolation]]）

claim shape 改動是高 blast-radius（**8 簽點** + 未來所有 consumer + 產品端本地 JWKS 驗章）。為避免 8 處 copy-paste drift：

- 在 `functions/utils/tenant-context.ts`（新）定義共用 resolver，回 `{ tenant_id, platform_role }`。
- 每個簽點 **最小 diff**：`const tc = await resolveActiveTenantClaims(db, userId)`，再把 `...tc` 併進既有 signJwt payload literal（每處約 +2 行）。bind-email 新用戶分支（callback collision 走 409 不簽 token）一併接。
- **不**順手重構既有 claim 物件、不改 TTL、不動 signJwt 簽名（守 [[feedback_security_boundary_pr_first_do_no_harm]]）。
- 型別：在 `tenant-context.ts` 出 `export type TenantClaims = { tenant_id: number; platform_role: PlatformRole }`，集中一處，不散落。

---

## 4. 設計決策（含 codex 待裁示項）

**A. active tenant 預設 = personal tenant（fresh login）**
login / register / 2fa / webauthn / oauth-token / callback / refresh 一律解析為使用者的 personal tenant（`platform_role='tenant_owner'`）。理由：最小權限、B2C/B2B 統一路徑、無 client 輸入即無偽造面。切到 org tenant 是顯式 org-switch 動作。

**B. personal tenant lazy ensure（覆蓋所有 user-creation 路徑）**
resolver 內 `ensurePersonalTenant(db, userId)`：`INSERT OR IGNORE`（靠 §2 partial unique 擋並發重複）→ 回 personal tenant id。每次發 token 都自我修復，**不必**逐一改 register / callback 的 INSERT。migration backfill（既有 user）+ lazy ensure（新 user / 漏網）= 雙保險。

**C. 不對既有 user-creation 路徑加顯式建表**
完全靠 B 的 lazy ensure。好處：register / callback 的 INSERT 區塊零改動（更小 diff、更易審）。

**D. org-switch 不跨 refresh 持久化（PR1 範圍裁剪）**
§20 只要求「org-switch → 重發 token」，未要求跨 refresh 持久。為守 first-do-no-harm，**refresh.ts 一律解析回 personal tenant，不引入 refresh schema 變更、不讀 active_tenant_id**。代價：client 在 refresh 後若要回到 org tenant 須重呼 org-switch（前端記 preferred tenant、載入時 re-switch）。好處：refresh hot path 改動極小（僅補 default personal claim）、migration 不碰 refresh_tokens。
→ **「持久化 active tenant」（如 `user_active_tenant` 表或 refresh row 欄位）列為 PR2+ enhancement。** ✅ codex r1 定案：接受此裁剪（UX tradeoff，非 Tier 0 blocker）。

**E. `platform_role` 與既有 `role` 正交、命名一致**
DB 欄位、token claim、resolver 全用同一字串 `platform_role`（對齊 [[feedback_state_machine_naming_no_alias]]）；不與全域 `role` 混用、不 alias。

**F. org-switch endpoint 路徑 = `/api/auth/org-switch`（沿用 unversioned 慣例）**
全站既有 API 皆 unversioned `/api/...`；為架構一致性（Tier 1），PR1 **不**單獨引入 `/v1/`（會造成孤島不一致）。版號化是全站議題，列技術債。✅ codex r1 未反對。

**G.（✅ codex r1 定案：保留）`tenants.personal_owner_user_id`**
codex 同意它**不是**變相 `users.tenant_id`：在 tenants 側、僅標 personal 歸屬、不限制 user 的 org 多租戶；type 仍是類型唯一判斷依據。它換來 partial-unique idempotency 硬保證 + 乾淨 backfill，且是 Finding 1（personal tenant owner guard）的 enforcement 依據（§5/§6.2 用它驗 personal tenant 歸屬）。**保留。**

---

## 5. Active tenant 解析 + Issuance Invariant（新 module）

`functions/utils/tenant-context.ts`（新；side-effect 集中、framework-agnostic、可單測）：

```
type PlatformRole = 'tenant_owner' | 'tenant_admin' | 'billing_admin' | 'member'
type TenantClaims = { tenant_id: number; platform_role: PlatformRole }
type IssuanceResult =
  | { ok: true;  tenant_id: number; platform_role: PlatformRole }
  | { ok: false; code: 'TENANT_NOT_FOUND'|'TENANT_NOT_ACTIVE'|'NOT_A_MEMBER'|'MEMBERSHIP_NOT_ACTIVE'|'PERSONAL_TENANT_FOREIGN' }

ensurePersonalTenant(db, userId): Promise<number>
  // INSERT OR IGNORE tenants(personal) → 取回 id；確保 owner membership 存在（INSERT OR IGNORE）。
  // 並發安全：partial unique(uq_tenants_personal_owner) + UNIQUE(tenant_id,user_id)。

resolveActiveTenantClaims(db, userId): Promise<TenantClaims>
  // fresh-login 用：tenant_id = ensurePersonalTenant(userId)，platform_role='tenant_owner'。

resolveIssuanceContextForTenant(db, userId, targetTenantId): Promise<IssuanceResult>
  // org-switch 用，fail-closed invariant（§20 PR1 驗收門）：
  //   1. tenant 存在 + status='active' + deleted_at IS NULL，否則 TENANT_NOT_ACTIVE / TENANT_NOT_FOUND
  //   2. membership(tenant_id,user_id) 存在 + status='active'，否則 NOT_A_MEMBER / MEMBERSHIP_NOT_ACTIVE
  //   3. **personal tenant owner guard（codex r1 Finding 1）**：若 tenant.type='personal'
  //      則必須 tenant.personal_owner_user_id = userId，否則 PERSONAL_TENANT_FOREIGN。
  //      → 即使存在「錯誤 membership row」指向他人 personal tenant（bug/seed/admin path），
  //        也擋下；type='organization' 不受此限。
  //   4. platform_role 由 DB membership row 推導（**禁信 client 傳入**）
  //   5. 任一不符 → { ok:false }（caller 一律 403、不發 token、不切 tenant）
```

**tenant guard 紀律**：`tenant_id` 只來源於 (a) 驗章後的 token claim，或 (b) org-switch 經 `resolveIssuanceContextForTenant` 驗過的 target。**禁**直接信 client body/query 的 tenant_id 進任何讀寫。PR1 無業務表，guard 以這兩函式 + `GET /api/tenants`（僅回自己 membership）作參考實作；未來業務表 query 必經 tenant-scoped repo 帶 `WHERE tenant_id=?`。

## 5.1 Regular access token guard（codex r2 Finding 4，新增）

tenant-scoped endpoint（org-switch / `GET /api/tenants` / 未來業務表）入口**不可只用裸 `requireAuth`**：它只擋 `pre_auth`，會放行 `temp_bind`（aud 預設 chiyigo，過 aud gate）與 `elevated:*` step-up token。在 `functions/utils/auth.ts` 加**加法 export**（不改 `requireAuth` 既有行為；與 `requireScope`/`requireStepUp` 同家族同檔，符 §架構一致性）：

```
requireRegularAccessToken(request, env): Promise<{ user, error }>
  1. { user, error } = await requireAuth(request, env)  // 預設 aud='chiyigo' gate；有 error 直接回
  2. scope === 'pre_auth'   → 403 PRE_AUTH_TOKEN_FORBIDDEN（defense-in-depth；requireAuth 已擋，這裡再擋）
  3. scope === 'temp_bind'  → 403 NOT_A_REGULAR_TOKEN（temp_bind aud 預設 chiyigo 會過 requireAuth，必顯式擋）
  4. token scope 含任一 KNOWN_ELEVATED_SCOPES（scopes.ts isElevatedScope，嚴格看 token claim、不走 role fallback）
                            → 403 NOT_A_REGULAR_TOKEN（擋 step-up token）
  5. const userId = Number(user.sub); !Number.isInteger(userId) || userId <= 0 → 401 INVALID_SUBJECT
                            // temp_bind 的 provider_id 可能 numeric 撞 users.id → fail-closed
  6. 回 { user, userId, error:null }   // 回已驗證的整數 userId（codex r3）
```

- 一般 access_token 的 scope = `buildTokenScope(role)`，**永不含** `elevated:*`（scopes.ts 明定 `ELEVATED_* 絕不出現在 ROLE_BASE_SCOPES`），故第 4 步對正常 token 零誤擋。
- org-switch / `GET /api/tenants` / 未來所有 tenant-scoped endpoint 一律走此 guard（≥2 caller + 未來多 caller，集中化 secure-by-default）。
- **(codex r3 implementation precision)** guard 回傳已驗證的整數 `userId`；call site 一律把 **`userId`** 傳進 `resolveActiveTenantClaims` / `resolveIssuanceContextForTenant`，**不傳 raw `user.sub`**（避免 string/number 混用滲進 resolver）。

---

## 6. API Contract（PR1 兩支 endpoint）

### 6.1 `POST /api/auth/org-switch`

- **Auth（codex r1 F3 + r2 F4）**：`requireRegularAccessToken(request, env)`（§5.1）——它內含 `requireAuth` 預設 aud gate（`aud='chiyigo'`，擋 mbti/talo/RP token 進 org-switch），**且**再拒 `temp_bind` / `elevated:*` step-up / 非正整數 sub。**禁** `audience:null`（會放大攻擊面）。RP-scoped tenant 切換不在 PR1（產品端在自己的 OIDC login 拿 tenant_id；跨 RP 切換是未來 RP-facing 設計）。
- **Rate limit**：per-user（沿用既有 rate-limit infra；對齊 §13 MVP write-path 限流，含 org-switch）。
- **Body validation（inline runtime validator，不引 Zod）**：`{ tenant_id }` 必為正整數，否則 `400 ERR_VALIDATION`。Zod 不在 `package.json`；此 body 結構 trivial（<100 行可自實作，合 §套件管理「優先原生 / 不引非必要套件」），沿用 repo 既有手刻邊界驗證風格（如 register 的 `EMAIL_RE`）。未知欄位忽略（只讀 `tenant_id`）。
  > 未來（PR2+ subscription/grantPlan）出現複雜 schema 時，validation lib 選型走**獨立 §套件管理 PR** 決策，不在 PR1 夾帶。
- **流程**：
  1. `ctx = resolveIssuanceContextForTenant(db, userId, body.tenant_id)`（`userId` 來自 §5.1 guard 的已驗證整數）。
  2. `!ctx.ok` → `403 { error:{ code:'TENANT_SWITCH_DENIED', message, traceId } }` + audit `tenant.switch.deny`（含 `ctx.code` reason）。fail-closed。
  3. 重發 access_token：複用 user 現有 claim（sub/email/role/status/ver/scope…）+ 覆寫 `tenant_id=ctx.tenant_id` / `platform_role=ctx.platform_role`，TTL 同既有 15m，**明確 `audience='chiyigo'`**（不沿用變數、不 `null`）。
  4. audit `tenant.switch.success`（actorSub、from=`user.tenant_id??null`、to=ctx.tenant_id、traceId）。
  5. 回 `200 { access_token, tenant_id, platform_role }`。
- **不做**：不改 refresh token（決策 D）；不回 refresh_token。

### 6.2 `GET /api/tenants`

- **Auth（codex r2 F4）**：`requireRegularAccessToken`（§5.1）——同 org-switch，擋 temp_bind / elevated / 非正整數 sub 進 tenant resolution。
- **流程**：回**目前使用者**的 active membership 清單（由 `user.sub` 推導，**忽略任何 client 傳入的 tenant 篩選**）：
  ```sql
  SELECT t.id, t.type, t.name, t.status, m.platform_role
  FROM organization_members m JOIN tenants t ON t.id = m.tenant_id
  WHERE m.user_id = ?
    AND m.status = 'active'
    AND t.deleted_at IS NULL AND t.status = 'active'
    -- codex r1 Finding 1：personal tenant 只能列自己的；擋「錯誤 membership row」指向他人 personal
    AND (t.type = 'organization' OR t.personal_owner_user_id = m.user_id)
  ```
- **DTO**：`{ tenants: [{ id, type, name, status, platform_role }] }`（serializer，不 dump raw row）。
- 作用：switcher UI 資料源 + cross-tenant read-guard 示範（永遠只回自己的）。

兩支都走統一錯誤 envelope `{ error:{ code, message, traceId } }`。

---

## 7. Observability（對齊既有 + §14）

- 新 audit event：`tenant.switch.success` / `tenant.switch.deny`（走 `safeUserAudit`；同 PR 加分類，遵 [[feedback_audit_classification]] warn-on-missing）。
- log 帶 traceId（middleware 既有）；deny 記 reason code（不洩內部細節給 client，只給 code+traceId）。
- metric 留意：org-switch deny 率（異常升高 = 可能越權嘗試）。

---

## 8. 測試清單（核心驗收門，`tests/integration/`）

新增 `tests/integration/tenant-foundation.test.ts`（repo 現況 tests 已 `.ts`）；`tests/integration/_setup.sql` 加 `tenants`/`organization_members`（CREATE IF NOT EXISTS，含 CHECK + partial unique）並進 `resetDb` DELETE list；`tests/integration/_helpers.ts` 加 `seedTenant({type,status,ownerUserId})` / `seedMembership({tenantId,userId,role,status})`（含可建「錯誤 membership row」的低階 seed 以測 Finding 1）。

**Issuance invariant（org-switch）negative — §20 驗收門**
1. 切到 `status='suspended'` tenant → 403 deny。
2. 切到 `status='closed'` tenant → 403 deny。
3. 切到「自己非 member」的 tenant → 403 NOT_A_MEMBER。
4. 切到「membership status='invited'（未接受）」→ 403 deny。
5. 切到「membership status='suspended'」→ 403 deny。
6. 偽造：body 帶別人 tenant_id（非自己 membership）→ 403（forged tenant_id 不得切換）。
7. client 在 body 試圖夾帶 `platform_role='tenant_owner'` 但實為 member → 即使被 strip/ignore，發出的 token `platform_role` 仍為 DB 的 `member`（role 由 DB 推導）。

**Cross-tenant read guard**
8. user 屬 tenant A 不屬 B：`GET /api/tenants` 只回 A，**不**含 B（即使嘗試帶 query 篩選也忽略）。

**Happy path**
9. 屬 org tenant 的 active member → org-switch 成功，回 token 帶正確 tenant_id + platform_role。
10. fresh login（新 helper 或既有 login test 延伸）→ access_token 帶 personal tenant_id + `tenant_owner`。

**Personal tenant / idempotency**
11. register 新 user → 取得帶 personal tenant 的 token；DB 有 1 筆 personal tenant + owner membership。
12. OAuth callback 新 user → 同 11（覆蓋第二條 user-creation 路徑）。
13. `ensurePersonalTenant` 連呼兩次 → 只有 1 筆 personal tenant（partial unique 生效）。

**向後相容**
14. 舊 access_token（無 tenant_id claim）→ 既有受保護 endpoint 仍 200（不被踢）。

**Migration round-trip**
15. up → 兩表存在 + 既有 user 已 backfill；down → 兩表消失；up 再跑 → idempotent 無錯（`INSERT OR IGNORE` 不重複）。

**codex r1 追加（必測）**
16. **(Finding 1, org-switch)** seed 一條 active membership row 指向「他人的 personal tenant」（`(alicePersonal, bob, active)`）→ Bob org-switch 該 tenant **仍 403 `PERSONAL_TENANT_FOREIGN`**（擋錯誤 membership row 穿透）。
17. **(Finding 1, GET /api/tenants)** 同上 seed → Bob 的 `GET /api/tenants` 清單**不含** Alice 的 personal tenant（owner guard 生效）；對照 Alice 自己 list 得到該 personal tenant。
18. **(Finding 2, bind-email)** OAuth bind-email 新用戶分支完成 → 發出的 access_token 帶 personal `tenant_id` + `platform_role='tenant_owner'`；DB 有該新 user 的 1 筆 personal tenant + owner membership（覆蓋第三條 user-creation 路徑）。
19. **(Finding 3, org-switch aud)** 持 `aud='mbti'`（非 chiyigo）的有效 token 打 `POST /api/auth/org-switch` → **401**（被 `requireAuth` 預設 aud gate 擋，未進 switch 邏輯）。

**codex r2 追加（必測，regular-access-token guard §5.1）**
20. **(Finding 4, temp_bind)** 持 `temp_bind_token`（`scope='temp_bind'`、aud=chiyigo）打 `POST /api/auth/org-switch` → **403 `NOT_A_REGULAR_TOKEN`**，且 audit/log 無 tenant resolution 痕跡（未進 resolver）。
21. **(Finding 4, temp_bind, list)** 同上 token 打 `GET /api/tenants` → **403 `NOT_A_REGULAR_TOKEN`**。
22. **(Finding 4, step-up)** 持 `step_up_token`（純 `elevated:*` scope、sub=真實 user id）打 org-switch 與 `GET /api/tenants` → 兩者皆 **403 `NOT_A_REGULAR_TOKEN`**（不因 sub 是真實 user 而放行）。
23. **(Finding 4, pre_auth + bad sub)** `pre_auth` token → 403（沿用 requireAuth）；偽造 `sub='abc'`/`sub='-1'`/`sub='1.5'` 的 token → **401 `INVALID_SUBJECT`**（fail-closed，不進 resolver）。

> regression test 遵 [[feedback_regression_test_must_lock_exact_failure]]：每條 negative 先確認 pre-impl 會 fail（無 endpoint → 404/無守門），post-impl 才 pass。

---

## 9. 實作 commit 結構（對齊雙 feedback，降 review 失焦）

依序、各自可獨立 review（squash 收尾依 [[reference_codex_review_iteration]]）：

1. **commit 1 — migration + test scaffold**：`0047` up/down + `_setup.sql`/`_helpers.ts` 加表與 seed。零 runtime 行為變更。
2. **commit 2 — tenant-context module**：`functions/utils/tenant-context.ts`（ensure/resolve/invariant）+ 單元/整合測（idempotency、invariant 各 case）。純新增、未接線。
3. **commit 3 — claim delta 接線**（shared auth contract，高 blast-radius、隔離審）：**8 簽點**各 +`...tc`（含 `oauth/bind-email.ts` 新用戶分支）；backward-compat。commit message 明寫 "first do no harm" + 列「未動：signJwt 簽名 / TTL / role / id_token / temp_bind_token / step-up」。
4. **commit 4 — endpoints + access-token guard**：`functions/utils/auth.ts` 加 `requireRegularAccessToken`（加法 export，不改 requireAuth）+ `POST /api/auth/org-switch` + `GET /api/tenants` + invariant 強制 + rate limit + audit。
5. **commit 5 — 驗收測試**：§8 全 case（cross-tenant + invariant negative）。
6. cache-bust：PR1 為純後端 / 無 `public/` asset 變更 → 無 `?v=` 可 bump（N/A；若實作中意外動到前端再依 [[feedback_cache_bust_build_order_trap]] 補）。

每階段跑 `typecheck:ratchet` + lint + `npm run test:int` 確認 0 regression。**全程不碰凍結 4 檔**；commit 前 `git diff --stat` 自查。

---

## 10. 主動指出（風險 / 技術債）

- **refresh 後回 personal**（決策 D）：org-switch 非跨 refresh 持久；前端需自行 re-switch。屬 PR1 刻意裁剪，非 bug。
- **membership 變更 ≤15min stale**：PR1 無 per-request 查（deny-state 屬 PR4）；沿用既有 token model。suspend 一個 member 後，其既有 access_token 最多 15min 後失效（與既有 role-change staleness 同模型）。
- **tenant_id = 內部整數 id**：與現行 `sub=String(id)` 一致；若未來產品端不希望內部 id 外洩，再評估 public tenant id（PR1 不做，列 future hardening）。
- **`personal_owner_user_id` 欄**：✅ codex r1 定案保留（決策 G）；同時作為 Finding 1 owner guard 的 enforcement 依據。
- **org-switch endpoint 路徑版號**：unversioned，列全站版號化技術債（決策 F）。
- **Finding 1 root cause forward note（PR4）**：PR1 在「讀路徑」（org-switch / list）擋下指向他人 personal tenant 的錯誤 membership row，但**未從源頭禁止建立**該 row（PR1 無 member-add/invitation 路徑）。**PR4（invitation + member lifecycle）必須在「加 member」源頭 fail-closed：拒絕把任何 member 加進 `type='personal'` 的 tenant**（personal tenant 永遠單一 owner）。此 forward note 須帶進 PR4 plan。

---

## 11. 檔案清單（預估）

**新增**
- `migrations/0047_tenant_foundation.sql`
- `migrations/down/0047_tenant_foundation.down.sql`
- `functions/utils/tenant-context.ts`
- `functions/api/auth/org-switch.ts`
- `functions/api/tenants/index.ts`（`GET /api/tenants`）
- `tests/integration/tenant-foundation.test.ts`

**修改（最小 diff）— 8 個 access-token 簽點各 +tenant claim**
- `functions/api/auth/local/login.ts`、`2fa/verify.ts`、`webauthn/login-verify.ts`、`refresh.ts`、`local/register.ts`、`oauth/token.ts`、`oauth/[provider]/callback.ts`、**`oauth/bind-email.ts`（codex r1 補）**
- `functions/utils/auth.ts`（**codex r2 補**：加 `requireRegularAccessToken` export，不改 requireAuth）
- `tests/integration/_setup.sql`、`tests/integration/_helpers.ts`（新表 + seed helper；temp_bind/step_up token seed 供 §8 test 20-23）

**🔒 不碰（凍結至 2026-06-10）**
- `functions/utils/audit-archive.ts` / `audit-aggregate-archive.ts` / `audit-aggregate-archive-runner.ts` / `tsconfig.tests.json`

---

## 12. Codex Gate 1 ✅ APPROVED（r1→r2→r3 收斂紀錄）

> **r3 結論：Approve Gate 1**，無剩餘 plan-level critical risk。以下保留供實作追溯；實作須遵 §0.0 r3 三點（audit-policy registry / userId 精準化 / ship 前 dynamic validation）。

**r1 已裁示/解決**：決策 D（refresh 回 personal，接受）、G（保留 `personal_owner_user_id`）、F（unversioned 路徑）、claim delta 走 8 簽點最小 diff（不重構 builder）、Zod 改 inline validator、test 檔名 `.ts`。

**r2 待 codex 複審確認修正是否到位**：
0. **Finding 4（Critical）**：§5.1 `requireRegularAccessToken`（拒 `temp_bind` / `KNOWN_ELEVATED_SCOPES` / 非正整數 sub）+ §6.1/§6.2 兩端點改用 + §8 test 20-23，是否完整擋住非一般 access_token（temp_bind / step-up）進 tenant resolution？sub 正整數 fail-closed 是否足夠？

**r1 三項修正（r2 已認可，列此供 r3 追溯）**：
1. **Finding 1（Critical）**：§5 第 3 步 personal-tenant owner guard（`PERSONAL_TENANT_FOREIGN`）+ §6.2 query 的 `AND (t.type='organization' OR t.personal_owner_user_id = m.user_id)` + §8 test 16/17，是否完整堵住「錯誤 membership row 穿透 personal tenant」？root-cause forward note（§10，PR4 源頭禁止）是否足夠？
2. **Finding 2**：§1/§3.3/§9/§11 補入 `oauth/bind-email.ts`（第 8 簽點 + 第 3 user-creation 路徑）+ §8 test 18，lazy-ensure 覆蓋是否確實到位（含 collision 409 分支不簽 token 的釐清）？
3. **Finding 3**：§6.1 org-switch 明確 `requireAuth` 預設 aud gate（chiyigo-only）+ 重發 `audience='chiyigo'` + 禁 `audience:null` + §8 test 19，audience 攻擊面是否收斂？

**仍開放供 codex 補充（r1 未 flag，可順帶確認）**：
4. **migration**：expand-only（不 ALTER 既有表）+ down DROP 自建兩表的回滾安全論述（§2.2）；backfill `INSERT OR IGNORE` idempotency 是否足夠？
5. **整合點**：與既有 OIDC / session / audit 資產整合有無衝突（尤其 refresh / oauth-token / bind-email 簽點接線）？
