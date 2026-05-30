# Chiyigo Platform — Production SaaS Ecosystem Core 架構規劃（✅ codex APPROVED 2026-05-28）

- **建立日期**：2026-05-28
- **狀態**：✅ **codex r5 APPROVED — full design gate passed**（architecture/doc level，2026-05-28）。r1–r4 findings 全修。**PR1 Tenant Foundation 可開工**；**PR3 wallet 設計放行但實作前必跑 D1 batch rollback spike（§5）**。§0.2 五項已 user 拍板。
- **動工分級**：L3（新系統 / 新 bounded context / 安全模型變更）
- **規劃前提**：Production SaaS Ecosystem Core（非 demo / 非教學 / 非一次性 / 非單體會員系統）
- **優先順序**：安全 > Tenant Isolation > 可維護 > 擴展 > 觀測 > 效能 > 開發速度
- **硬性約束**：$0 Cloudflare 免費額度內、不提前微服務化、避免 vendor lock-in、baseline Tier 0–3 全條
- 🔓 **檔案凍結已於 2026-05-29 解除**（原 2026-06-10；lock trigger 改 event-based，見 lock plan banner）：`functions/utils/audit-archive.ts` / `audit-aggregate-archive.ts` / `audit-aggregate-archive-runner.ts` / `tsconfig.tests.json`。本計劃為純設計文件，不碰 code。

---

## 系統背景

**Chiyigo Platform** 定位為 Central Identity Provider + Tenant Platform + Billing Center + SaaS Ecosystem Core。

- **近期具體產品（2 個）**：ERP（B2B：公司買、員工用）、銀髮族 App（**B2B + B2C 混搭**：機構買給住民/員工 + 個人/家屬自用）
- **未來產品**：CRM / AI Tool / CMS / POS / HRM / Booking / Analytics

**核心架構方向**：Centralized Identity + Multi-Tenant SaaS + **Decentralized Product Authorization**

- **Chiyigo（控制面）**：登入、身份、Tenant、Billing、Subscription、Invitation、Member、Product Access
- **產品（資料面，ERP/CRM…）**：自管業務 RBAC、Data Permission、Workflow；**不碰登入**

---

# 0. 需求修正與風險分析

## 0.0 Codex review 紀錄

**r1（`a151a88`，2026-05-28）→ Reject at design gate**（方向 OK，Tier 0/1 語意需精確化）。7 findings 已 patch：

| # | Finding | 處理 | 章節 |
|---|---|---|---|
| 1 | 產品端 token 撤銷被高估（本地 JWKS 看不到 version bump） | 定義 soft / hard revoke 兩級 + 產品 deny-state / 即時查 | §6、§12 |
| 2 | per-tenant rate limit 不能延後 | write paths per-tenant + per-user 限流納 MVP | §13、§18 |
| 3 | 扣點原子性 / quota CAS / 財務 idempotency 永久性 | `deductCredits` 條件式序列 + quota version + 永久 idempotency + request_hash | §5、§10 |
| 4 | grantPlan 需 durable 狀態機 | `grant_plan_operations` ledger + 單調轉移 + 去重 + 對帳 | §5、§7 |
| 5 | D1 outbox 缺 lease / retry / crash recovery | outbox 完整欄位 + claim/lease + replay SOP | §5、§11 |
| 6 | elder 跨租戶 vs tenant_id-from-token | Delegated-Access Context（server-resolved resourceTenantId）+ negative test | §8 |
| 7 | 觀測太籠統 | 新風險專屬事件 / 指標 | §14 |

**r2（`e7cd467`，2026-05-28）→ Reject full gate，但 Tenant Foundation PR 接近放行**。5 小 patch：

| Finding | 處理 | 章節 |
|---|---|---|
| Hard revoke 仍允許一般讀寫 stale → 矛盾 | deny-state **每個 request 都查**（全 endpoint）；soft 僅限角色微調 | §6、§12 |
| org-switch / token issuance invariant 不明確 | PR1 驗收門：驗 tenant/member active + role 由 DB 推導 + fail-closed + negative tests | §20 |
| deductCredits 缺 transaction boundary | **單一 D1 `batch()` 原子交易** + joint conditioning + 對帳 backstop | §5 |
| provider_event_id 未 namespace | 加 `provider`，unique 改 `(provider, provider_event_id)`；狀態+投影+audit+outbox 同交易 | §5、§7 |
| elder 用 elderUserId 反解 tenant 歧義 | 改用 **`relationshipId`**，resourceTenantId 以 row 為準，多筆/歧義 fail-closed | §5、§8 |

**codex r2 結論**：org-switch invariant 補進 §20 後 **PR1（Tenant Foundation）可開工**；wallet / grantPlan / elder 等其餘 patch 複驗。

**r3（`ea653a3`，2026-05-28）→ Reject full gate（只剩 1 blocker）+ ✅ Approve PR1 to start**：
- **PR1 Tenant Foundation：codex Approved**（§20 invariant 已足夠開工）。
- 唯一 blocker：deductCredits 對 D1 `batch()` 原子性誤判 —— batch 只在語句 **error** 才 rollback，`UPDATE...WHERE` 影響 0 row 是 success（changes=0）**不 abort**。已修：改用 **CHECK constraint 把「不足/超額」變 statement error → 觸發 rollback**（§5）。
- minor（grantPlan PR 前）：`grant_plan_operations` 加 CHECK 強制 payment 必有 provider/event_id、manual 必有 admin_idempotency_key（SQLite unique 容多 NULL）。已補（§5）。
- 其餘 4 項（hard-revoke 全 endpoint / PR1 invariant / provider namespace / elder relationshipId）r3 確認 OK。

**r4（`e3a2bff`，2026-05-28）→ Reject full gate（剩 1 blocker，同區）+ PR1 仍 Approved**：
- blocker：`product_usage_quota` 仍有「0-row success / NULL bypass」—— (a) quota 欄位非 NOT NULL，SQLite **CHECK 遇 NULL 不算違反**會被繞過；(b) **quota row 漏建** → 0-row UPDATE success，且 `balance_after` 只護 wallet row、不護 quota row → wallet/ledger 已扣但 quota 沒增 = 半完成。
- 已修（§5）：wallet/quota 欄位寫死 `NOT NULL DEFAULT + CHECK`；`credit_ledger` 加 `quota_used_after / quota_limit_after NOT NULL`（subquery 讀 quota row，漏建 → NULL → rollback）。PR3 spike 加「quota row missing」「quota/wallet NULL」case。

**r5（`34787c8`，2026-05-28）→ ✅ APPROVE full design gate**：
- Full design gate **Approve**（architecture/doc level）；PR1 Tenant Foundation **Approved to start**；PR3 wallet 設計放行，**實作前必先跑 §5 PR3 spike 的 D1 batch rollback 案例**。
- r4 的 CHECK-on-NULL / quota-row-missing 兩洞 r5 確認已堵。
- PR3 實作 forward note（codex r5，非 doc blocker）：deductCredits payload 必做 schema validation —— **扣點 amount 必正整數**；**ledger signed amount 方向用 schema/DB CHECK 固定**（topup>0 / deduct<0）。

**首個實作 PR 收斂為 tenant foundation only**（見 §20）；wallet / grantPlan / elder delegation 在不變式明確前不動工。

## 0.1 必須先拍板的架構衝突（我提出的修正）

### 衝突 A — B2C vs「Tenant 才是資源擁有者」→ 解法：Personal Tenant（強烈建議）

brief 鐵則「User belongs to Tenant、Tenant owns resources、禁止 tenant data without tenant_id」與銀髮 App 的 **B2C 個人**（無公司）直接互斥。

**修正**：導入 **Personal Tenant（個人租戶 / tenant-of-one）**。每個 B2C 個人在註冊時自動建立一個「只有自己一個成員、自己即 owner、type=personal」的薄租戶。

- **效果**：brief 鐵則 100% 成立（全系統永遠有 `tenant_id`、tenant 永遠是資源擁有者）；B2C 與 B2B 走**同一條 tenant isolation 程式路徑**，消除 nullable 分支（對 Tier 0 隔離更安全）。
- **代價**：每個個人多一筆薄 tenant row（lightweight，可接受）。
- **billing 統一**：billing owner 永遠是 tenant（個人 = personal tenant、公司 = org tenant），`grantPlan` / 錢包 / ledger 全 key 在 `tenant_id`，無多型分支。
- **狀態**：⚠️ **需 user 確認**。替代方案見 §0.4 風險表（nullable tenant_id 多型擁有者，較不推薦）。

### 衝突 B — $0 / 不提前微服務化 vs brief 的分散式架構

brief §11/§15 傾向 API Gateway、Permission Gateway、Event Bus、Queue、Read Replica、微服務拆分。

**修正**：現階段做 **Cloudflare 上的 modular monolith**（Pages Functions + D1 + KV），但**嚴守 domain boundary**讓未來可拆。

- 事件走 **D1 outbox + cron consumer**（既有 $0 pattern），**不用 CF Queues**。
- DLQ = D1 表（非 CF Queues DLQ）。
- API Gateway / Permission Gateway / Event Bus / Read Replica / 微服務 → **標 Enterprise 才做**（§15、§18）。
- ⚠️ **PAID FEATURE 警示**：CF Queues、Durable Objects 需 Workers Paid（$5/mo 起）。預設不用；未來若需要走 §0.5 PAID SOP。

### 衝突 C — 大半認證/安全已建，不重做

roadmap 顯示**已上線**：MFA(TOTP/WebAuthn)、multi-device session、token version、refresh rotation、jti revoke、immutable audit chain(hash)、rate limit、brute force、CSP/CSRF、step-up、OIDC(PKCE/JWKS)、金流(ECPay/Stripe scaffold)+webhook dedup。

**修正**：§6/§13/§14 採「**引用既有 + 只補 multi-tenant delta**」，不重新規劃已完成項。

## 0.2 已定案（user 2026-05-28 拍板）

| # | 項目 | 決策 | 關鍵設計 |
|---|---|---|---|
| 1 | Personal Tenant | **採用** | `tenant.type ∈ {personal, organization}`；**type 是唯一判斷依據，禁用 member_count 推測類型** |
| 2 | 家屬代管長輩 | **做垂直場景版，不做通用 delegation framework** | 銀髮 App 自有 `elder_relationships`（scoped/expirable/audited），permission 限 `view_health/manage_schedule/emergency_contact`；**不做** generic delegation / nested / impersonation / universal proxy |
| 3 | 點數錢包 | **單 tenant wallet + per-product quota** | `credit_wallets`（tenant 餘額）+ `product_usage_quota`（per-product 用量上限）；**不做** per-product wallet |
| 4 | 角色命名 | **文件 convention，不做中央 catalog** | 命名規範 `<product>_<scope>_<action>`；product RBAC 自治，中央不存 |
| 5 | 一人多 tenant | **現在就支援** | `organization_members` 多對多（**禁 `users.tenant_id`**）；UI 先做 tenant switcher + current tenant context |

> 理由詳見各對應章節。Elder delegation 等到 CRM/ERP/POS 都需要 delegation 才抽象化（避免提前 over-engineering）。

## 0.3 風險表

| 領域 | 問題 | 影響 | 防禦方式 | 低成本替代 |
|---|---|---|---|---|
| Tenant Isolation | 查詢漏帶 `tenant_id` | **跨租戶 data leak（安全事件）** | repository 層強制 `WHERE tenant_id=?`；`tenant_id` 一律取自 token claim，禁信 client | lint 規則禁裸 query；測試每個 RBAC 規則 ≥1 negative cross-tenant 案例 |
| 權限 | product RBAC 滲進中央平台 | IAM 變 god-object、改權限要動中央發版 | 中央只存 platform role + product access；product RBAC 留產品 | 文件化邊界 + code review gate |
| JWT | giant JWT（塞滿細權限） | token 膨脹、權限 stale、洩漏面大 | token 只放 `sub/tenant_id/platform_role/product_access 摘要`；細權限產品端查 | per-product 即時 entitlement API |
| JWT | 改 claim 結構後相容性 | 舊 token 解析失敗、被踢 | claim 版本化（`v`）；新增欄位不破舊；舊 token role fallback | 已有 `effectiveScopesFromJwt` fallback pattern |
| RBAC 擴展 | role 寫死、無 tenant scope | global role 越權、無法多租戶 | 所有 role 必帶 `tenant_id` scope；禁 global role | — |
| Billing 耦合 | 業務邏輯綁死單一金流 vendor | 換 vendor / 加方案痛 | adapter pattern（已有）；`grantPlan` 單一開通路徑、兩觸發 | — |
| ERP Mapping | ERP 直接改 identity 資料 | 破壞 source of truth、資料分岔 | ERP 只讀 identity（經 token/API）；只寫自己的 employee mapping | 事件驅動 sync（outbox） |
| Personal Tenant | 個人租戶過度膨脹 | tenant 表暴量 | personal tenant 薄（無 billing 預設）、與 org tenant 同表 type 區分 | — |
| 過度設計 | MVP 先做 Event Bus/微服務/distributed cache | 時間燒在沒人用的基礎設施 | §18 MVP Boundary 嚴格砍；先 modular monolith | D1 outbox / KV cache |
| Email identity | 用 email 當不可變身份 | 改 email = 換身份、衝突 | `sub`（不可變假名 id）為唯一身份；email 是可變 attribute | — |

---

# 1. 整體系統架構

## 1.1 分層圖

```
┌─────────────────────────────────────────────────────────┐
│ 客戶端：ERP SPA / 銀髮 App / CRM / 未來產品 / Admin       │
└───────────────┬─────────────────────────┬───────────────┘
                │ OIDC 登入                │ 業務 API（帶 access_token）
                ▼                         ▼
┌───────────────────────────┐   ┌───────────────────────────┐
│ Chiyigo 控制面（IdP+平台）  │   │ 產品資料面（ERP/CRM…）       │
│ ─ Identity / OIDC          │   │ ─ 驗 token（JWKS 本地）      │
│ ─ Tenant / Member          │   │ ─ tenant_id 隔離            │
│ ─ Subscription / Billing   │   │ ─ Product RBAC（自管）       │
│ ─ Invitation               │   │ ─ Employee Mapping（自管）   │
│ ─ Product Access           │   │ ─ Business Workflow         │
│ ─ Credit Wallet / Ledger   │   │ ─ 回報 usage / 扣點（API）   │
│ ─ Audit（hash-chain）      │   │                             │
└───────────────┬───────────┘   └───────────────┬───────────┘
                │  Domain Events（D1 outbox + cron consumer）
                └───────────────────────────────┘
        基礎設施：Cloudflare Pages Functions + D1 + KV +（金流 webhook）
```

## 1.2 各架構面摘要

| 架構面 | 設計 |
|---|---|
| Platform | modular monolith on Cloudflare；clean domain boundary，未來可拆 |
| Identity | 統一 OIDC（PKCE/ES256/JWKS），既有四 RP 生態延伸 |
| Multi-Tenant | tenant 為資源擁有者；Personal Tenant 統一 B2C/B2B |
| Organization | tenant + `organization_members`（user↔tenant + platform_role） |
| Subscription | 綁 tenant；plan = entitlement（功能解鎖） |
| Billing | credit wallet + append-only ledger，綁 tenant；`grantPlan` 單路徑 |
| Invitation | 簽名邀請 token + D1 狀態表，一次性、限時、限 email/role |
| Permission | platform role（中央）+ product RBAC（產品）+ data scope（產品） |
| Session | refresh cookie / token（既有）+ token version + 多裝置 |
| ERP Integration | ERP 為 OIDC RP；只做 employee mapping + role；事件 sync |

---

# 2. 完整系統樹狀圖

```
Chiyigo Platform（控制面 — Source of Truth：身份/租戶/計費/存取）
├─ Identity（身份）
│  ├─ Account（users：sub 不可變、email 可變）
│  ├─ Auth（login / OAuth / MFA / passkey）— 已建
│  ├─ Session（refresh rotation / token version / 多裝置 / force logout）— 已建
│  └─ OIDC Provider（discovery / authorize / token / JWKS / logout）— 已建
├─ Tenant（租戶）
│  ├─ Tenant（type = personal | organization）
│  ├─ Organization Member（user↔tenant + platform_role）
│  └─ Invitation（邀請生命週期）
├─ Billing（計費）
│  ├─ Product（產品目錄：erp / senior-app / crm…）
│  ├─ Subscription / Product Access（tenant 有哪些產品 + 方案）
│  ├─ Credit Wallet（綁 tenant，余額 + CAS version）
│  ├─ Credit Ledger（append-only，記 product_id）
│  └─ grantPlan（webhook 自動 / admin 手動匯款，單一路徑）
├─ Access Control（平台層）
│  └─ Platform Role（tenant_owner / tenant_admin / billing_admin / member）
├─ Audit（hash-chain，append-only）— 已建
└─ Observability（traceId / structured log / Discord 告警）— 已建

ERP（資料面 — Source of Truth：員工業務資料）
├─ Employee Mapping（chiyigo user ↔ erp employee）
├─ ERP RBAC（hr_admin / accounting / inventory_manager / employee）
├─ Department（部門 + data scope）
├─ Business Data（全帶 tenant_id 隔離）
└─ Usage Reporting（回報可計費事件 → 中央扣點）

銀髮族 App（資料面 — B2B + B2C 混搭）
├─（B2B）機構 tenant + 住民/員工 member + 產品角色
├─（B2C）個人 personal tenant + 自用
├─ Elder-Caregiver（elder_relationships，受控跨租戶 delegated-access，§8）
└─ Business Data（帶 tenant_id）

Shared Services（共用基礎設施 — 純 infra，無業務）
├─ JWKS（公鑰發布）
├─ Event Outbox + Cron Consumer（D1）
├─ Audit infra（hash-chain util）
└─ Notification（email / Discord）
```

---

# 3. Domain Boundary Design

| Boundary | 擁有 | 對外溝通 |
|---|---|---|
| Chiyigo | identity / tenant / member / subscription / product access / billing / audit | 發 OIDC token（JWKS 驗）+ Identity/Permission/Billing API + Domain Events |
| ERP | employee mapping / erp role / department / 業務資料 | 消費 chiyigo token + 呼叫 chiyigo API + 訂閱 events |
| CRM / 未來 | 各自業務資料 | 同 ERP |
| Shared Service | JWKS / event infra / audit util / notify | 純 infra，無業務狀態 |

**鐵則（禁止）**：
- ❌ DB Cross Access（ERP 不得直連 chiyigo DB，反之亦然）
- ❌ Shared ORM Model（不共用 entity class；跨服務只透過 API contract / event payload）
- ❌ Tight Coupling（產品間只能 API / Event，禁同步互呼業務邏輯）

**可共享 vs 禁止跨服務直接存取**：
- 可共享（經 token / API）：user 身份摘要、tenant_id、platform_role、product access、plan 摘要
- 禁止跨服務直接存取：彼此的業務資料表、彼此的 RBAC 表、彼此的 DB

---

# 4. Data Ownership Rules（Source of Truth）

| 資料 | Owner | Update flow | Sync flow | Conflict 處理 |
|---|---|---|---|---|
| User Identity（sub/email/password/MFA） | **Chiyigo** | 僅 chiyigo 寫 | 產品讀 token / Identity API | chiyigo 為準；產品不得寫 |
| Tenant / Member / platform_role | **Chiyigo** | chiyigo 寫 | token claim + event | chiyigo 為準 |
| Subscription / Product Access / 點數 | **Chiyigo（Billing）** | grantPlan / 扣點 API | token 摘要 + event | ledger append-only 為準 |
| ERP Employee Profile（職稱/部門/業務角色） | **ERP** | ERP 寫 | ERP 自存；以 chiyigo `sub` 為外鍵 | ERP 為準 |
| 業務資料（訂單/CRM 客戶…） | **各產品** | 產品寫 | 不跨服務 | 產品為準 |
| Audit（身份/計費事件） | **Chiyigo** | append-only | — | 不可變 |

**原則**：identity 永遠 chiyigo 單向往產品流；產品只能以 `sub` 當外鍵自存衍生資料，**禁回寫 identity**。

---

# 5. 完整資料模型（ERD 概念）

> **Chiyigo DB（控制面）**。ERP/產品表在各自 DB（§3 boundary），列於此僅標 owner。

**Chiyigo 擁有：**

- `users`（既有）：`id(sub, 不可變)`、`email(可變, citext)`、`status`、`created_at/updated_at`、`deleted_at`(soft)
  - unique：`email`（active 範圍）；index：email、status
- `tenants`（新）：`id`、`type(personal|organization)`、`name`、`status(active|suspended|closed)`、`created_at/updated_at`、`deleted_at`
  - index：status、type
  - **`type` 為租戶類型唯一判斷依據；禁用 `member_count` 等推測（決策①）**
- `organization_members`（新）：`tenant_id`、`user_id`、`platform_role(tenant_owner|tenant_admin|billing_admin|member)`、`status(active|invited|suspended)`、`joined_at`
  - unique：`(tenant_id, user_id)`；index：`(user_id)`、`(tenant_id, platform_role)`
  - 多對多：支援一人多 tenant（顧問）；personal tenant 則一筆 owner
- `products`（新）：`id(erp|senior-app|crm…)`、`name`、`is_active`
- `subscriptions` / `tenant_product_access`（新，**投影表**）：`tenant_id`、`product_id`、`plan_id`、`status(active|pending|expired|revoked)`、`period_start/end`、`granted_via(payment|manual)`、`granted_by`、`payment_ref`
  - unique：`(tenant_id, product_id)`（同產品一筆有效）；index：status
  - SoT 是下方 `grant_plan_operations` ledger；本表是當前狀態投影
- `grant_plan_operations`（新，entitlement ledger，codex r1 f4 + r2）：`id`、`tenant_id`、`product_id`、`plan_id`、`trigger(payment|manual)`、`provider(ecpay|stripe|...)`、`provider_event_id`(payment)、`admin_idempotency_key`(manual)、`from_status`、`to_status`、`audit_id`、`occurred_at`、`reconciled_at`、`created_at`
  - unique：**`(provider, provider_event_id)`**（webhook 去重 + **拒 stale/replay**；event id 跨 provider 不假設全域唯一）、`admin_idempotency_key`（manual 去重，手滑不重開）
  - **`CHECK`（codex r3）**：`trigger='payment'` → `provider` 與 `provider_event_id` 皆 NOT NULL；`trigger='manual'` → `admin_idempotency_key` NOT NULL（SQLite unique 允許多個 NULL，必須 CHECK 強制必填，否則 payment 漏 event_id 會繞過去重）
  - **狀態轉移 + `tenant_product_access` 投影更新 + audit + outbox event 必寫在同一交易**（codex r2）
  - 每筆 grant / 狀態變更都落一筆（不可變歷史）
- `plans`（新）：`id`、`product_id`、`features(JSON)`、`included_credits`、`price_subunit`、`currency`、`is_active`
- `credit_wallets`（新，**單 tenant 一個錢包，決策③**）：`tenant_id(PK)`、`balance INTEGER NOT NULL DEFAULT 0`、`version`、`updated_at`
  - **`CHECK(balance >= 0)`**（codex r3/r4：扣到負 → statement error → rollback。**NOT NULL 必要**：SQLite CHECK 遇 NULL **不算違反**會被繞過）
- `product_usage_quota`（新，決策③）：`tenant_id`、`product_id`、`quota_limit INTEGER NOT NULL CHECK(quota_limit >= 0)`、`quota_used INTEGER NOT NULL DEFAULT 0`、`period`、`version`、`updated_at`
  - unique：`(tenant_id, product_id, period)`；**`CHECK(quota_used >= 0 AND quota_used <= quota_limit)`**（codex r3/r4：超額 → error → rollback。**欄位必 NOT NULL**，否則 CHECK 遇 NULL 失效；相對更新 + CHECK 取代 conditional `WHERE`，因 0-row 不 abort）
  - **不做 per-product wallet**（避免 wallet fragmentation、refund/bundle 複雜）—— 除非未來某產品完全獨立營運
- `credit_ledger`（新，append-only）：`id`、`tenant_id`、`product_id`、`entry_type(topup|deduct|refund|adjust)`、`amount(signed)`、`balance_after INTEGER NOT NULL`、`quota_used_after INTEGER NOT NULL`、`quota_limit_after INTEGER NOT NULL`、`idempotency_key`、`request_hash`、`ref`、`prev_hash`、`this_hash`、`created_at`
  - unique：`(tenant_id, idempotency_key)`；trigger 擋 UPDATE/DELETE
  - **`balance_after` / `quota_used_after` / `quota_limit_after` 皆 NOT NULL，由 scalar subquery 讀對應 row（codex r4）**：wallet row 漏建 → `balance_after` NULL；**quota row 漏建 → `quota_*_after` NULL** → NOT NULL violation → insert 失敗 → 整批 rollback（補「quota row missing」漏洞）
  - **財務 idempotency 永久保存（無 TTL，codex r1 f3）**：重送同 key → 回上次結果；同 key 但 `request_hash` 不符 → **409 IDEMPOTENCY_CONFLICT**，不執行

**扣點原子模型 `deductCredits`（codex r1 f3 + r2 + r3 CAS-abort）** — 整段在單一 D1 `batch()` 原子交易內，且**「不足/超額」必須變成 statement error 才會 rollback**。
> ⚠️ 關鍵（codex r3）：D1 `batch()` **只在語句 error 時 rollback**；`UPDATE ... WHERE` 影響 0 row 是 **success（changes=0）不會 abort**。故**不可**靠 `changes()=0` 或「jointly conditioned」，必須讓「不足/超額」**觸發 statement error**。機制 = **CHECK constraint**：
- schema 約束（codex r4）：`credit_wallets.balance NOT NULL CHECK(balance >= 0)`、`product_usage_quota.quota_used/quota_limit NOT NULL CHECK(quota_used >= 0 AND quota_used <= quota_limit)`、`credit_ledger.balance_after/quota_used_after/quota_limit_after NOT NULL`。
- 單一 batch（任一語句 error → 整批 rollback）：
  1. `UPDATE product_usage_quota SET quota_used = quota_used + ? WHERE (tenant_id,product_id,period)=…` → 超 quota → **CHECK 違反 → error → rollback**（= 402 超額）。
  2. `UPDATE credit_wallets SET balance = balance - ? WHERE tenant_id=?` → 不足 → **CHECK(balance>=0) 違反 → error → rollback**（= 402 不足）。
  3. `INSERT INTO credit_ledger (…, balance_after=(SELECT balance FROM credit_wallets WHERE tenant_id=?), quota_used_after=(SELECT quota_used FROM product_usage_quota WHERE …), quota_limit_after=(SELECT quota_limit FROM …), idempotency_key, request_hash, …)` → 重複 key → unique 違反；**wallet 或 quota row 漏建 → 對應 `*_after` NULL → NOT NULL 違反** → 皆 error → rollback。
- **NULL / 0-row 雙重防線（codex r4）**：(a) 欄位全 **NOT NULL**（SQLite CHECK 遇 NULL 不算違反，必靠 NOT NULL 補）；(b) wallet/quota **row 漏建**走 ledger `*_after` NOT NULL subquery 擋（0-row UPDATE 是 success 不 abort，靠這層轉成 error）。
- **相對更新 + CHECK 取代 version-CAS**：SQLite 寫入序列化，相對更新 `±?` 靠 CHECK 擋越界即正確且並發安全，無需 version 重試迴圈（`version` 保留給 admin adjust 等路徑）。
- **idempotency 前置查 + 唯一鍵雙保險**：先查同 key → 命中回上次結果（`request_hash` 不符 → 409）；並發漏網由唯一鍵擋（敗方 rollback → re-read 回上次）。
- **wallet/quota row 必在 provision 時建好**；扣點時若漏建由上述 `*_after` NULL 防線兜住。
- **對帳 backstop**：定期 job 驗 `wallet.balance == Σtopup − Σdeduct(ledger)` 且 `quota_used == Σdeduct(ledger, product)`；drift → 告警 + 凍結扣點待人工。
- **金額驗證（codex r5，PR3 實作）**：payload schema 強制**扣點 amount 為正整數**；ledger `amount` 正負方向用 schema/DB CHECK 固定（`entry_type='deduct'` → amount<0、`topup` → amount>0），防方向寫反。
- **PR3 spike 必測（codex r4）**：並發雙扣同 key（只成功一次）、餘額/配額剛好邊界、超額/不足必 rollback、**quota row missing**、**quota/wallet 欄位 NULL**、模擬 crash —— 全驗「CHECK / NOT NULL → statement error → 整批 rollback」，非 changes=0。
- `invitations`（新）：`id`、`tenant_id`、`email`、`platform_role`、`token_hash`、`status(pending|accepted|revoked|expired)`、`expires_at`、`invited_by`、`accepted_user_id`
  - unique：`token_hash`、`(tenant_id, email, status=pending)`；index：expires_at
- `sessions` ≈ `refresh_tokens`（既有）：含 `device_uuid`、`auth_time`、`revoked_at`
- `token_versions` ≈ 既有 token version 機制（per-user `ver`；可評估擴 per-device）
- `oauth_accounts` ≈ `user_identities`（既有）：`(provider, provider_id)` unique
- `audit_logs`（既有）：hash-chain，append-only
- `event_outbox`（新，修正 codex r1 finding 5）：`id`、`event_id`(unique)、`event_type`、`payload`、`payload_hash`、`status(pending|processing|done|dead)`、`attempts`、`next_attempt_at`、`lease_until`、`locked_by`、`last_error`、`processed_at`、`created_at`
  - index：`(status, next_attempt_at)`、`lease_until`
- `event_dlq`（新）：`id`、`event_id`、`event_type`、`payload`、`dlq_reason`、`attempts`、`failed_at`

**ERP 擁有（在 ERP DB，不在 chiyigo）：**
- `erp_employees`：`chiyigo_sub(FK 概念)`、`tenant_id`、`employee_no`、`title`、`department_id`、`status`
- `erp_user_roles`：`(chiyigo_sub, tenant_id, role)`
- `departments`：`tenant_id`、`name`、`parent_id`
- `permission_scopes`：ERP 自定 data scope（department/resource）

**銀髮 App 擁有（在銀髮 App DB，不在 chiyigo；決策②）：**
- `elder_relationships`：`id(PK, = relationshipId)`、`tenant_id`、`elder_user_id(sub)`、`caregiver_user_id(sub)`、`role`、`permissions(JSON: view_health|manage_schedule|emergency_contact)`、`expires_at`、`created_at`、`revoked_at`
  - **唯一被允許的受控跨租戶讀取路徑**：caregiver 以自己帳號登入，存取 elder 所屬 tenant 的資料，由銀髮 App 依本表 scoped / expirable / audited 授權
  - unique：`(tenant_id, elder_user_id, caregiver_user_id)`；index：caregiver_user_id、expires_at

**通用策略**：
- **Index**：所有租戶範圍表 `tenant_id` 前綴 composite index；高流量 endpoint 加 query-count 斷言。
- **Unique**：見各表；跨租戶唯一性一律含 `tenant_id`。
- **Soft delete**：critical 表（users/tenants/members/business）用 `deleted_at`，read 預設過濾；ledger/audit **永不刪**。
- **Migration**：zero-downtime expand→migrate→contract（§17）。

---

# 6. Authentication Architecture（既有為主 + 多租戶 delta）

**已建（引用，不重做）**：login / OAuth / OIDC(PKCE) / JWT(ES256) / refresh rotation / session revoke / 多裝置 / token version / force logout(撤 refresh + bump ver) / password reset / MFA(TOTP+passkey) / step-up。

**Token lifecycle**：
- access_token：≤15min，含 `sub / tenant_id / platform_role / product_access 摘要 / ver / amr / acr`
- refresh_token：可撤銷、rotation、device binding（既有）
- revoke：per-user(bump ver) / per-device / per-jti（既有）
- replay：step-up token 一次性 jti 黑名單；webhook eventId 去重（既有）

**多租戶 delta（新）**：
- token 加 `tenant_id`（active tenant）+ `platform_role`。
- **一人多 tenant → active tenant 機制**：token 綁單一 active tenant；切 tenant = 重發 token（org-switch）。
- product_access 摘要放 token（慢變，快取）；點數即時查（精確）。
- B2C：active tenant = personal tenant。

**撤銷模型（對產品，codex r1 f1 + r2 修正）— 兩級分界**：
產品對 access_token 走本地 JWKS 驗章，**看不到** chiyigo token-version bump（bump 只對 chiyigo 自家 endpoint + refresh 即時）。撤銷分兩級：
- **Soft revoke（≤15min stale 可接受）**：**僅限角色微調 / 權限降級（非停權）** → 靠 access_token 自然過期（≤15min），下次 refresh 換新狀態；產品本地驗章即可，不需 per-request 中央查。
- **Hard revoke（即時，且作用於所有 endpoint）**：member 停權 / 帳號停用 / product access 撤銷 / 安全事件 → 產品消費 `member.suspended` / `product_access.revoked` / `session.revoked` / `account.disabled` 事件寫入本地 **deny-state**（KV/D1）；**每一個 product request（含一般讀寫）都先查 deny-state，命中即擋**。最關鍵操作（金流 / admin / 刪除）可再加同步中央 introspection 達零延遲。
- **產品最低要求（r2 修正）**：(1) **每個 request 都查本地 deny-state**（hard revoke 全 endpoint 生效，**非只敏感**）；(2) 角色微調類 soft 變更可 ≤15min stale；(3) 最關鍵操作加同步中央查。
- **傳達延遲**：deny-state 由事件驅動，延遲 = outbox 傳達 lag（§14 監控 revocation propagation lag）；零延遲需求走同步中央查。
- **必測**：member 停權後、**未過期** access_token 對產品**任一 endpoint（一般 + 敏感）**→ 必被擋（僅受 deny-state 傳達 lag 限）；**不再有「一般 endpoint stale 15min」例外**。

---

# 7. Tenant 與 ERP 整合流程

**Sequence（公司購買 ERP → 員工可用）**：

1. 公司負責人以個人 chiyigo 帳號登入（或註冊 → 自動有 personal tenant）。
2. 建立 **organization tenant** → 該 user 成為 `tenant_owner`。
3. 購買 ERP 產品方案：
   - 線上金流 → webhook 成功 → `grantPlan(tenant, plan, {trigger:payment, ref})`
   - 匯款 → admin 後台確認 → `grantPlan(tenant, plan, {trigger:manual, ref})`（**同函式**）
4. tenant 取得 ERP product access。
5. owner 邀請員工（email + platform_role=member）→ 發簽名 invitation token。
6. 員工收信 → 開連結 → 登入/註冊 chiyigo 帳號 → 接受邀請 → 加入 tenant（`organization_members`）。
7. 員工登入 ERP（OIDC）→ token 帶 `tenant_id / platform_role / product_access(含 erp)`。
8. ERP 驗 token → 首次見此 `(sub, tenant_id)` → **建立 erp_employee mapping**。
9. owner 在 ERP 後台 assign ERP role（accounting…）+ department。
10. 員工操作 → ERP permission check（自管 RBAC + data scope + tenant 隔離）。

**Data flow**：identity/tenant/access 由 chiyigo 經 token 單向流入 ERP；ERP 只回報 usage（扣點）。

**grantPlan 狀態機（codex r1 f4 + r2）**：
- 狀態：`none → pending → active → (expired | revoked)`；**單調轉移，禁倒退**（如 active→pending 拒絕）。
- **payment 觸發**：webhook 必驗簽 + **`(provider, provider_event_id)`** 去重（收過 → no-op）；**stale/亂序 webhook**（event 時間早於目前狀態）→ 拒絕，不回滾 active。
- **manual 觸發**：admin 帶 `admin_idempotency_key`（unique 擋重複開通）；必過 step-up + 寫 audit。
- **單一交易（codex r2）**：每次轉移的 `grant_plan_operations` 寫入 + `tenant_product_access` 投影更新 + audit + outbox event **同一交易 commit**。
- **對帳路徑**：每日比對 provider 流水 vs `grant_plan_operations`（payment）+ 匯款回執 vs manual；差異告警。

**Failure handling**：
- 邀請過期/被撤 → 接受失敗，狀態明確。
- 付款未完成 → product access = pending，員工 ERP 入口顯示「未開通」。
- 員工已屬其他 tenant → `organization_members` 多對多允許；ERP active tenant 由 token 決定。
- grantPlan 重複觸發 → idempotent（webhook eventId / admin idempotency key）。

---

# 8. Employee Lifecycle Design

**三者關係**：
- **User（chiyigo）**：個人身份，跨產品唯一（`sub`）。離開公司不刪帳號。
- **Organization Member（chiyigo）**：user 在某 tenant 的平台層成員資格 + platform_role。
- **ERP Employee（ERP）**：member 在 ERP 的業務身份（職稱/部門/業務角色）。

**生命週期**：

| 階段 | 動作 | 邊界 |
|---|---|---|
| invitation | 發/收/接受/過期/撤銷 | chiyigo |
| onboarding | 加入 tenant（member）→ ERP 首登建 mapping | chiyigo→ERP |
| role change | platform_role 改 chiyigo；ERP role 改 ERP | 分層 |
| department transfer | ERP 內 | ERP |
| suspension | member status=suspended（chiyigo）→ 立即撤 refresh + bump ver；ERP 連帶禁用 | chiyigo 主導 |
| offboarding | member 軟移除（**不刪 user**）；撤 session；ERP employee status=inactive | 軟處理、保稽核 |
| reactivation | member 恢復 | chiyigo |
| tenant transfer | 改 `organization_members`（owner 重指派）；**易主 = 改 role 非轉帳號** | chiyigo |

**關鍵鐵則**：
- 關閉公司 → tenant status=closed + member 停用，**user 帳號只解 tenant 連結、不刪**（同一人可能 B2C 自用或屬他 tenant）。
- 員工**自管憑證**（密碼/2FA）；owner 管成員資格/角色，**碰不到憑證**。初始密碼走邀請連結自設。
- **Elder-Caregiver（銀髮 App 專用，決策②）**：家屬/照護者代管長輩走銀髮 App 自有 `elder_relationships`，**不做通用 delegation**。它是「caregiver 存取 elder 所屬 tenant 資料」的**受控跨租戶存取**：必須顯式關係、限定 scope（view_health/manage_schedule/emergency_contact）、可過期（`expires_at`）、全程 audit、可即時 revoke。**禁** generic delegation / nested delegation / impersonation / universal proxy。等 CRM/ERP/POS 都需要再抽象化。

**Delegated-Access Context（codex r1 f6 + r2 識別修正）**：
caregiver 的 active token `tenant_id` = 自己的（多半 personal tenant），**與 elder 資源所屬 tenant 不同**。跨租戶存取**不可**走「tenant_id 來自 token」的正常 guard，必走專屬路徑：
1. 請求帶 **`relationshipId`**（明確指定哪一條代管關係）；**不用 `elderUserId` 反解 tenant** —— elder 可能同時有 personal + 機構 tenant，反解會歧義。
2. 讀該 `elder_relationships` row：以 **row 上的 `tenant_id` 為 `resourceTenantId`**、`elder_user_id` 為目標；驗 `caregiver_user_id = token.sub`、active、未過期（`expires_at`）、未撤（`revoked_at`）、`scope` 涵蓋本操作。
3. **找不到 / 不屬此 caregiver / 任何不確定 → fail-closed（拒）**。
4. 通過 → repository 進入 **delegated guard mode**：以 row 的 `resourceTenantId` 為隔離鍵，只允許 scope 內操作。
5. 全程寫 audit `delegated.access`（actorSub、relationshipId、elderUserId、resourceTenantId、scope、allow/deny、traceId）。
- **必測（negative）**：無關係 / 已過期 / 已撤 / scope 不符 / `relationshipId` 不屬此 caregiver / 同 elder 多 tenant → 一律 deny；caregiver 不得讀關係外任何 tenant 資料。

---

# 9. RBAC Architecture

**三層分離（核心）**：

| 層 | 擁有 | 範例 | scope |
|---|---|---|---|
| **Platform RBAC** | Chiyigo | tenant_owner / tenant_admin / billing_admin / member | tenant scoped |
| **Product RBAC** | 各產品 | hr_admin / accounting / inventory_manager / employee | tenant + product scoped |
| **Data Scope** | 各產品 | department / resource / own-only | tenant + 業務維度 |

**設計**：
- 所有 role **必帶 tenant scope**（禁 global role）。
- permission inheritance：product role → 細 permission 由產品定義；platform role 不下放 product 語意。
- **role escalation protection**：member 不可自升 tenant_admin；step-up 用於高權限變更；改 platform_role 寫 audit。
- 中央 token 只帶 platform_role + product_access 摘要；**細 permission 不進 token、不進中央 DB**。
- **角色命名約定（決策④）**：`<product>_<scope>_<action>`（如 `erp_payroll_manage`、`crm_sales_view`）。只做文件規範，**不做中央 role catalog**（product RBAC 自治，避免 god-object / naming collision / release coupling）。
- **Elder-Caregiver permission（銀髮 App）**屬產品 data-scope（view_health/manage_schedule/emergency_contact），由產品強制，不上平台。

**RBAC vs ABAC**：
- **MVP 用 RBAC**（role + tenant scope + 簡單 department scope）。直觀、易稽核、夠用。
- **ABAC（屬性式）** 等出現複雜跨維度規則（如「只有同部門+金額<X+上班時段」）再加，且以「RBAC 為骨幹 + 少量 attribute 條件」混合，不全面 ABAC（過度複雜）。

---

# 10. API Contract Architecture

**中央 API 群**：Identity API / Permission(Access) API / Invitation API / Subscription API / Session API / Credit API。

**統一規範**：
- **Request**：JSON；schema validation（Zod，邊界一次）；未知欄位 reject/strip。
- **Response**：DTO/serializer，禁 dump DB row。
- **Error envelope**（既有）：`{ error: { code, message, traceId } }`；區分 BusinessError(4xx) / SystemError(5xx)。
- **Pagination**：>10k 用 cursor-based。
- **Idempotency**：分兩類（修正 codex r1 finding 3）——(1) **一般請求**：D1 持久化 + TTL 可接受；(2) **財務 / ledger / entitlement**：**永久保存、無 TTL**，且記 `request_hash` 做衝突偵測（同 key 不同參數 → 409 IDEMPOTENCY_CONFLICT）。
- **Versioning**：路徑 `/v1/`；breaking change 升版 + 舊版保留 ≥1 cycle。

**禁止**：Internal DB coupling、Shared ORM Model、把產品業務邏輯塞進中央 API。

---

# 11. Event Architecture（$0：D1 outbox + cron consumer）

**Domain Events**：`user.created` / `member.invited` / `member.joined` / `subscription.updated` / `employee.suspended` / `role.changed` / `tenant.closed` / `credit.deducted`。

**Payload 規範**：`{ v:1, eventId, eventType, occurredAt, tenantId, actorSub, data:{...} }`（schema 同源、版本顯式）。

**機制（$0，修正 codex r1 finding 5）**：
- **outbox**：寫業務變更同 transaction 寫 `event_outbox`（D1，欄位見 §5）。
- **claim/lease（防 cron overlap 雙處理）**：consumer 條件式搶租 `UPDATE ... SET status='processing', locked_by=?, lease_until=now+T WHERE (status='pending' OR (status='processing' AND lease_until < now)) AND ...`；只處理搶到的 row。
- **retry**：失敗 → `attempts+1`、設 `next_attempt_at=now+backoff(attempts)`、釋放 lease、寫 `last_error`；`attempts >= N` → 移 `event_dlq`（記 `dlq_reason`）+ 告警。
- **crash recovery**：consumer 中途死 → `lease_until` 過期後該 row 自動可被重搶（不卡死 processing）。
- **processed-after-side-effect**：side effect 成功**後**才 `status='done' + processed_at` → **at-least-once**，消費端必 idempotent（以 `event_id` 去重表）。
- **ordering risk**：不保證全序；消費端可亂序 + idempotent；需順序用 `(aggregateId, seq)`。
- **eventual consistency**：跨服務最終一致；UI 標「處理中」；critical 路徑（計費）走同步 API 不靠事件。
- **replay SOP**：DLQ row 修因後 → reset 回 outbox（`status=pending, attempts=0`）重放；SOP 進 runbook。

> CF Queues = 付費，現階段不用（§0.1-B）。

---

# 12. Permission Cache Strategy

- **JWT claim**：放慢變的 `platform_role` + `product_access 摘要`（access_token ≤15min 即天然 TTL）。
- **Permission cache**：產品端 role→permission 對應可 KV/記憶體快取（TTL 短）。
- **Stale 處理（codex r1 f1 + r2）**：token-version bump 產品本地驗章看不到。**Soft（角色微調/降級）** → 接受 ≤15min stale。**Hard（停權/停用/撤 access/安全）** → 走 §6 deny-state，**每個 product request 都查**（全 endpoint 即時生效，非只敏感）；零延遲需求加同步中央查。**不可假設產品會看到 token-version**。
- **Invalidation**：role/access 改 → 發 event + bump 相關 cache key；token version 撤舊 token。
- **Distributed cache**：現階段 KV（eventual）夠；強一致需求走 D1 即時查（如扣點），不靠 cache。

---

# 13. Security Architecture（防禦表）

| 機制 | 是否處理 | 實作方式 | 未處理原因 |
|---|---|---|---|
| Tenant Isolation | ✅ | repository 強制 `WHERE tenant_id`；tenant_id 取自 token；cross-tenant negative test | — |
| JWT Security | ✅ | ES256 + JWKS 本地驗 + iss/aud/exp/nonce（既有） | — |
| Token Rotation | ✅ | refresh rotation（既有） | — |
| Session Revocation | ✅ | per-user/device/jti（既有） | — |
| Replay Attack | ✅ | step-up jti 一次性 + webhook eventId 去重 + nonce | — |
| Permission Escalation | ✅ | role 必 tenant scope；改權限 step-up + audit；中央不存 product 細權限 | — |
| Invite Token Security | ✅ | 簽名 + hash 存 + 一次性 + 限時 + 限 email/role | — |
| CSRF | ✅ | 既有（SameSite + token） | — |
| XSS | ✅ | CSP 嚴格 nonce/hash、output DTO（既有） | — |
| SSRF | ✅ | 外呼白名單 + 不接受 client 提供 URL | — |
| SQL Injection | ✅ | prepared statement / 參數化（D1） | — |
| Audit Log | ✅ | hash-chain append-only（既有） | — |
| Rate Limit（IP/user，auth 路徑） | ✅ | 既有（login/refresh/token/step-up） | — |
| per-tenant + per-user rate limit（write paths，修正 codex r1 finding 2） | ✅ **MVP 必做** | 用既有 rate-limit infra（D1 bucket）對 write/expensive endpoint 加寬鬆 per-tenant + per-user 上限：**invite / org-switch / credit consume / product-access / admin grant** | — |
| Brute Force | ✅ | 既有（cooldown + IP 黑名單） | — |
| Secret Management | ✅ | Cloudflare Secrets / wrangler；禁 hardcode（既有） | — |
| Personal Tenant 隔離 | 🆕 | B2C 走同一 tenant isolation 路徑 | 新增 |
| Delegated cross-tenant（elder） | 🆕 | server-resolved resourceTenantId + 關係驗證 + audit（§8） | 新增 |

---

# 14. Observability Architecture（既有為主）

- **Structured log**（JSON：`ts/level/traceId/tenantId/userId/event`）+ **traceId**（middleware 注入）+ **correlationId**（業務鏈）+ **eventId**（事件去重）—— 既有。
- **Audit Trail**：身份/計費/權限變更/刪除 → hash-chain（既有）。
- **Monitoring/Metrics**：API latency p50/95/99 by endpoint、auth failure、rate limit、扣點失敗。
- **Alerting**：critical → Discord（既有）。
- **新風險專屬事件/指標（修正 codex r1 finding 7）**：entitlement grant/revoke、credit idempotency 衝突(409)、quota reject(402)、elder delegated-access allow/deny、outbox retry / DLQ 深度、**product revocation 傳達延遲**（hard-revoke 事件發出 → 產品 deny-state 生效的 lag）。
- **Log ownership**：各服務自留 app log；身份/計費 audit 歸 chiyigo。
- **Retention**：audit 依法遵長期（cold archive 已建）；一般 log 短期。
- **Security logging**：敏感欄位 redact（PII/token allowlist）。

---

# 15. Scalability Strategy（modular monolith → 未來可拆）

**現在（$0 monolith）**：Pages Functions + D1 + KV，domain 模組邊界清楚。

**未來拆分路徑（Enterprise 才做，§18）**：
- Identity Service / Billing Service / Permission Service / 各產品 Service 沿 §3 boundary 切。
- 條件：6 個月內有具體拆分計畫、或單庫到瓶頸、或團隊變多。
- 屆時引入：API Gateway、Permission Gateway、Event Bus、Read Replica、Background Job、Horizontal Scaling。
- ⚠️ 多為付費基礎設施 → 走 PAID SOP。

**現在就做的擴展準備**：clean boundary、API contract、event outbox、無 shared mutable state、stateless function。

---

# 16. 部署架構

- **CI/CD**：既有（GitHub Actions + wrangler；pre-commit typecheck+lint）。
- **Environment**：Dev（local D1）/ Staging（preview）/ Production。
- **Rollback**：Pages deployment rollback + DB migration down。
- **Health Check**：`/health`（純讀，無業務）。
- **Feature Flag**：env flag（如 `CRON_PURGE_ENABLED` pattern）控新功能漸進開。
- **Secret Management**：Cloudflare Secrets；`.dev.vars` 禁 commit。
- **Backup**：D1 定期匯出；audit cold archive（已建）。
- **DR**：Cloudflare 多 region；critical 設定文件化 runbook。

---

# 17. Migration / Rollback Strategy

- **DB Migration**：每 migration 必 up+down；zero-downtime **expand→migrate→contract**（加欄位→backfill+雙寫→切讀→下版移除）。
- **Backward Compatibility**：新 claim/欄位不破舊；舊 token role fallback。
- **Permission Migration**：role 模型變更走雙寫過渡。
- **Token Migration**：claim 結構升 `v`；舊 token 寬限至自然過期（≤15min）+ refresh 換新。
- **Rollback**：destructive migration 禁（無逃生門）；廢欄位走 deprecation。

---

# 18. MVP Boundary（積極砍，防過度設計）

| 功能 | MVP 必做 | MVP 可簡化 | 正式版 | Enterprise 才需要 |
|---|---|---|---|---|
| Identity/Auth/MFA/Session | ✅（已建） | | | |
| Tenant + Personal Tenant | ✅ | | | |
| organization_members（多對多，決策⑤） | ✅（現在做） | UI 先 tenant switcher | tenant_admin/billing_admin | cross-tenant analytics / unified inbox |
| Invitation | ✅ | email 邀請 | | SCIM 自動佈建 |
| Subscription / Product Access | ✅ | | | |
| Credit Wallet + Ledger + Quota（決策③） | ✅ 單 tenant wallet + per-product quota | | | per-product 錢包（除非產品完全獨立營運） |
| grantPlan（金流+手動匯款） | ✅ | | | |
| ERP RBAC（產品端） | ✅（產品自管） | role + dept scope | 細 resource scope | ABAC |
| Event（outbox+cron） | 簡化 | 少數 critical event | 完整 event 目錄 | Event Bus |
| Elder-Caregiver（銀髮，決策②） | ✅ 垂直場景版 | | | generic delegation / impersonation / nested |
| federation（企業 SSO）/ SCIM | ❌ | | | ✅ 客戶要求才做 |
| API Gateway / 微服務 / Read Replica | ❌ | | | ✅ |
| per-tenant + per-user rate limit（write paths） | ✅ MVP（修正 codex r1 finding 2） | | 全 endpoint 細緻限流 | |
| distributed cache | ❌ | | 流量起來 | |

**現在明確不該做**：微服務拆分、API/Permission Gateway、Event Bus、Read Replica、federation/SCIM、ABAC、per-product 錢包、distributed cache、CF Queues/DO（付費）。

---

# 19. 常見錯誤與反模式

| 類別 | 反模式 | 為何危險 | 正確做法 |
|---|---|---|---|
| SaaS 架構 | 子系統各自做登入 | 帳號分裂、安全面爆炸 | 統一 chiyigo OIDC，產品只當 RP |
| SaaS 架構 | 以 User 為資源擁有者（無 tenant） | B2B 易主/多人/計費全卡 | tenant 為擁有者（含 personal tenant） |
| RBAC | 權限全集中中央 | IAM god-object、產品改權限要動中央 | platform role 中央、product RBAC 產品 |
| RBAC | global role 無 tenant scope | 跨租戶越權 | 所有 role 必帶 tenant_id |
| RBAC | 前端做權限判斷 | client 可繞過 | 後端強制；前端只做 UX 隱藏 |
| JWT | giant JWT 塞滿細權限 | 膨脹、stale、洩漏面大 | 只放 sub/tenant/platform_role/access 摘要 |
| JWT | 信任 client 傳的 role/tenant_id | 偽造越權 | 一律取自驗章後的 token claim |
| Tenant | 業務表無 tenant_id | cross-tenant leak | 全表 tenant_id + repository 強制 |
| Tenant | tenant_id 來自 client | 偽造跨租戶 | 來自 token |
| ERP Mapping | ERP 直接改 identity 資料 | 破壞 source of truth | ERP 只讀 identity、自存 mapping |
| Identity | email 當不可變身份 | 改 email = 換身份/衝突 | sub 不可變、email 可變 attribute |
| 資料 | hard delete critical data | 毀稽核、不可逆 | soft delete；ledger/audit 永不刪 |
| 快取 | shared mutable cache 跨租戶 | 污染、leak | 無 shared mutable；cache key 帶 tenant |
| Tenant | 用 member_count 推測 tenant 類型 | 誤判 personal/org、邏輯分岔 | `tenant.type` 為唯一依據（決策①） |
| Tenant | `users.tenant_id`（一人綁一 tenant） | 顧問/多公司無解、後補 migration 痛 | `organization_members` 多對多（決策⑤） |
| 權限 | 提前做 generic delegation framework | 高複雜、over-engineering、各產品規則差異大 | 先做垂直場景版（elder_relationships，決策②） |

---

# 20. 實作順序（codex r1 採納）

**首個 PR = Tenant Foundation only**（codex r1 Minimal Safe Fix）。在以下不變式明確且有測試前，**不動** wallet / grantPlan / elder delegation：

- `tenants`（含 personal tenant）+ `organization_members`（多對多）
- active tenant context + token claim delta（`tenant_id` / `platform_role`）
- repository tenant guard（強制 `WHERE tenant_id`，tenant_id 取自 token）
- org switch（切 active tenant → 重發 token）
- **cross-tenant negative tests**（核心驗收門）

**org-switch / token issuance invariant（codex r2，PR1 驗收門）**：每次發 / 換 token（含 org switch）server 端必須——
- 驗 `tenant.status = active`（suspended / closed → 拒）
- 驗 `organization_members.status = active`（invited / suspended → 拒）
- 驗該 user 確為目標 tenant 的 member（非 member → 拒）
- `platform_role` **由 DB 推導**，**禁信 client 傳入**
- 任一不符 → **fail-closed**（不發 token / 不切 tenant）
- **PR1 negative tests**：suspended tenant / closed tenant / 非 member / invited 未接受 / suspended member / 偽造 tenant_id 切換 → 全拒。

後續 PR 順序（每個都先把對應不變式測起來）：
1. Tenant Foundation（上述）
2. Subscription / Product Access + grantPlan 狀態機（payment/manual 去重 + 對帳）
3. Credit Wallet + Quota + Ledger（`deductCredits` 原子 + 並發雙扣測試）
4. Invitation + Member lifecycle（含 hard-revoke deny-state）
5. Event outbox + consumer（lease / retry / DLQ / replay）
6. Product 整合（ERP 先）：employee mapping + product RBAC + 本地 deny-state
7. 銀髮 App + Elder Delegated-Access Context（含 negative tests）

---

# 給 codex 的問題

> ✅ **codex r5 APPROVED — full design gate passed（2026-05-28，doc HEAD 見 git log）**。r1–r5 findings 全數解決/確認。以下原始設計問題保留供實作追溯；PR3 wallet 實作前須先跑 §5 D1 batch rollback spike。

1. **§0.1-A Personal Tenant**：用「個人租戶」統一 B2C/B2B、消除 nullable tenant_id 是否最佳？或 nullable 多型擁有者更務實？
2. **§0.2 五項已定案**（Personal Tenant 採用 / Elder-Caregiver 垂直版 / 單 wallet + per-product quota / 文件 role convention / 多對多 membership）—— 請 validate 風險邊界，特別是：(a) 單 wallet + quota 並發扣點 race / 對帳；(b) `elder_relationships` 受控跨租戶存取的隔離正確性。
3. **§5 ERD**：是否足以支撐 zero-downtime expand/migrate/contract？credit_ledger 與既有 audit_log hash-chain 應共用 infra 還是獨立？
4. **§9 RBAC 三層分離**強制點是否完整？role escalation 防禦有無漏洞？
5. **§11 D1 outbox 取代 CF Queues**在本規模是否足夠？ordering/eventual consistency 風險邊界？
6. **§13 防禦表**有無遺漏的 multi-tenant 越權路徑？per-tenant rate limit 延後是否可接受？
7. **§18 MVP Boundary**砍得對不對？有沒有「現在不做、之後痛」的漏網（schema 不可逆類）？
8. **整體**與既有 OIDC / 金流 / audit / session 資產的整合點有無衝突？第一個 PR 建議切什麼？
