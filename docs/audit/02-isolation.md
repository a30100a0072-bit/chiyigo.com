# P2 多租戶隔離審計報告（Isolation）

> 領域：多租戶隔離 Isolation｜Tier-0 對應：**隔離**｜SSOT：`00-invariants-threat-model.md` §2/§3 Isolation/§4。
> 不變量標的：INV-ISO-1..7。報告語言繁體中文；code identifier / 欄位名 / 路徑保留原文。
> **產出日期**：2026-06-12（Fable 5 審計窗 6/12–6/22）。

---

## 0. 執行摘要

整面列舉並逐一驗證了 **45 個查核對象**（8 個 `tenants/*` 端點 + 16 個 user-owned 端點 + 21 個 admin/helper），涵蓋 INV-ISO-1..7 全部七條不變量。

**結論：隔離面整體高度健全。** B2B 多租戶（PR1–5）的 tenant 軸 gate（`requireActiveTenantRole` / `resolveIssuanceContextForTenant`）每 request 由 DB membership live 推導 `platform_role`、fail-closed、personal-tenant guard 齊備；所有 user-owned 端點雙欄 `(id, user_id)` 過濾無 IDOR；admin billing 端點雙閘門（step-up + fine scope）+ actor snapshot 從 DB 取 + tenant eligibility gate；全域 `role` 軸與 tenant `platform_role` 軸正交，無互相隱式繞過。

**3 條 finding（皆非 live-exploitable 提權 / 無跨租戶資料外洩）：**

| ID | 嚴重度 | 一句話 | 處置 |
|---|---|---|---|
| **ISO-ENUM-1** | **P2** | `members/[userId]/[action].ts` 的 action allowlist 用 plain-object 索引，原型鏈鍵（`toString`/`constructor`/`__proto__`…）繞過 404 → 誤路由為 offboard + 該次 HTTP audit row 靜默丟失 | 建議小型 PR 修（trivial、明確正確）；確認 owner 是否本窗口處理 |
| **ISO-CROSS-01** | **P3** | `tenant_admin` 可邀請新成員為 `tenant_admin`/`billing_admin`（manager 級），但 `PATCH /role` 升權卻是 owner-only —— 授權面不一致 | 業務規則裁決（owner ruling）後再定修法 |
| **ISO-ENUM-2** | **P3** | （ISO-ENUM-1 同類 sibling，非隔離面）`resolvePaymentAdapter` `ADAPTERS[vendor] ?? null`，`vendor=constructor\|__proto__` 回 truthy 原型值 → 繞過乾淨 400 → `adapter.parseWebhook` TypeError → 500（無狀態變更、無洩漏） | 併入 payments/security backlog，同 fix class |

> **執行註記**：本領域以 6 切角 multi-agent workflow 跑（`wrx927lm6`）。`user-idor` / `tenant-endpoints` / `admin-axis` 三個 finder 完成；`query-sweep` / `billing-credit` / `token-claims` 三個 finder 與 2 個 verifier 因撞 session limit 失敗。**缺的 3 個切角 + 2 條候選 finding 的對抗式裁決，由主線直接讀碼補完**（見 §3 各 INV 的「主線補驗」段），覆蓋無缺口。

---

## 1. Finding 詳述

### ISO-ENUM-1（P2）— `[action].ts` action allowlist 原型鏈繞過 + 靜默 audit 丟失

```
ID         : ISO-ENUM-1
領域        : Isolation
嚴重度      : P2
違反條款    : INV-ISO-2（端點 gate 完整性 / criterion g action allowlist）
            + Tier-0 #3 Correctness（unknown action → 靜默 offboard 而非 404）
            + Tier-0 證據要求（該路徑 HTTP audit row 丟失）
證據        : functions/api/tenants/[tenantId]/members/[userId]/[action].ts:17-19, 29-30, 46-62
            functions/utils/user-audit.ts:83, 91-92, 151-162（throw 被外層 catch 吞）
信心度      : high（已親自讀碼 + 真值表確認；audit-loss 路徑亦經 user-audit.ts 結構確認）
需 Gate 複核 : 修法 PR 走 Dual Gate；finding 本身證據明確
建議修者    : Haiku（trivial diff）/ 人工 review
```

**機制**：
- `const ACTION_EVENT: Record<string, string> = { suspend, reactivate, offboard }`（line 17-19）是 plain object literal。TS 型別 runtime 抹除，`ACTION_EVENT['toString']` 實際回繼承的 `Object.prototype.toString`（function，truthy）；`ACTION_EVENT['constructor']`、`ACTION_EVENT['__proto__']`、`ACTION_EVENT['valueOf']`、`ACTION_EVENT['hasOwnProperty']` 同理皆 truthy。
- line 29-30：`const action = String(params?.action ?? '')` → `const eventType = ACTION_EVENT[action]; if (!eventType) return 404`。原型鏈鍵使 `eventType` truthy → **不回 404**。
- line 32 的 `requireActiveTenantRole(..., OWNER_ONLY)` gate 仍正確擋住非 owner / 匿名（fail-closed 403）。
- line 48-50 dispatch：`if (action==='suspend') … else if (action==='reactivate') … else offboardMember(...)`。原型鏈鍵皆非 suspend/reactivate → **落入 else = offboardMember**。
- line 56 `safeUserAudit(env, { event_type: eventType, ... })`：`eventType` 是 function。`user-audit.ts` 內 `classifyForCold(entry.event_type, ...)`（line 83）或 D1 `.bind(entry.event_type, ...)`（line 91-92）對 function 會 throw；不匹配 cold_class fallback regex → `throw e`（line 152）→ 傳到最外層 `catch { /* 不擋主流程 */ }`（line 162）**被吞**。`safeUserAudit` 對 caller 不 throw，故 line 58 `auditDomainEventEmitted`、line 59 回 `{ok:true}` 200 照常。

**攻擊路徑 / 影響**：前提＝caller 已是該 tenant 的 active `tenant_owner`（gate 先於 dispatch，**無提權、無跨租戶**）。`POST /api/tenants/<tid>/members/<uid>/toString`（或 `constructor`/`__proto__`）→ 通過 404 allowlist → 通過 OWNER_ONLY → `offboardMember(<uid>)` 執行（DELETE row）→ 200。淨效果：
1. **Correctness footgun**：應回 404 的未知 action 改成執行**最具破壞性**的 offboard（dispatch else 分支恰好是 offboard）。前端 bug / typo 送 `/valueOf` 會靜默移除成員而非報錯。
2. **Audit-evidence 缺口（部分）**：該次 offboard 的 HTTP `audit_log` row 靜默丟失。**但** domain `member.offboarded` outbox 事件仍正確 emit（members.ts 用字面 `'member.offboarded'`，在 domain batch 內 commit，先於 safeUserAudit），event-sourcing trail 不破。故為「雙稽核通道之一在異常路徑丟失」，非 trail 全失。

**為何 P2 而非 P1**：blast radius 嚴格受限於 owner 已有的 offboard 權限（offboardMember 仍有 statement-level last-owner guard + personal_tenant_immutable + guardSelf）；無提權、無跨租戶、無資料外洩；outbox 事件存活。屬 latent correctness + 部分觀測缺口。

**修復方向**（trivial、明確正確；對照同 repo 已正確的 `audit-archive/retry.ts:128` `VALID_ACTIONS.has(action)` Set-先驗 pattern）：
```ts
// 在 line 29-30 之間先做 prototype-safe 存在性判斷
const VALID_ACTIONS = new Set(['suspend', 'reactivate', 'offboard'])
if (!VALID_ACTIONS.has(action)) return res({ error: 'Unknown member action', code: 'NOT_FOUND' }, 404)
const eventType = ACTION_EVENT[action]  // 此時 action 已保證為三者之一
```
或 `Object.hasOwn(ACTION_EVENT, action)` / 改 `ACTION_EVENT` 為 `Map`。

**Pre-fix repro test 草稿**（vitest + local D1）：以 active tenant_owner 身份 `POST .../members/<orgMemberUid>/toString`，斷言 (a) 應得 404 但 pre-fix 實得 200 + member row 被 DELETE；(b) `audit_log` 無對應 `member.offboarded` row（pre-fix 丟失）。post-fix：得 404、member row 不動、無 offboard 事件。

---

### ISO-CROSS-01（P3）— 邀請面 vs 升權面授權不一致（橫向 manager 增殖）

```
ID         : ISO-CROSS-01
領域        : Isolation
嚴重度      : P3
違反條款    : INV-ISO-5 / INV-ISO-6（雙軸授權一致性；橫向 manager 權限增殖 seam）
證據        : functions/api/tenants/[tenantId]/invitations/index.ts:22（MANAGER_ROLES 含 tenant_admin）
            functions/utils/invitations.ts:27（INVITABLE_ROLES 含 tenant_admin / billing_admin）
            functions/utils/invitations.ts:110-125（createInvitation 不校驗 inviter role ≥ invitee role）
            functions/api/tenants/[tenantId]/members/[userId]/role.ts:15（PATCH /role = OWNER_ONLY）
信心度      : high（機制確認）；**嚴重度與是否為「缺陷」取決於業務意圖 → 需 owner 裁決**
需 Gate 複核 : 否（先 owner business-rule ruling）
建議修者    : 人工（業務規則決策）
```

**機制**：`invitations/index.ts` 的 `MANAGER_ROLES = ['tenant_owner','tenant_admin']` 允許 `tenant_admin` 發邀請；`invitations.ts` 的 `INVITABLE_ROLES = {tenant_admin, billing_admin, member}` 允許邀請對象為 manager 級的 `tenant_admin` / `billing_admin`；`createInvitation` 不校驗「邀請者 role ≥ 被邀 role」。**對比** `role.ts` 的 `OWNER_ONLY` —— 既有成員升 manager 級必須 owner。

**結果**：一個 `tenant_admin` 無法用 `PATCH /role` 把任何人升成 `tenant_admin`，卻可用「邀請新帳號」的方式直接造出新的 `tenant_admin` / `billing_admin`，繞過 owner-only 升權的設計意圖。其中 `billing_admin` 可讀 tenant 錢包餘額（財務資料，`wallet.ts` BILLING_CAPABLE_ROLES）。

**邊界**：`INVITABLE_ROLES` 已正確排除 `tenant_owner`（無法經此路徑造出新 owner），故**非垂直越權到 owner 頂權**，屬橫向 manager 權限增殖。需 attacker 已是該 tenant 的 `tenant_admin`。

**為何 P3 + 需 owner 裁決**：許多 SaaS 設計上允許 admin 邀請 admin。此處的 signal 是「邀請面 owner+admin / 升權面 owner-only」的**不對稱** —— 暗示設計意圖可能是「manager 級授予一律 owner-only」，但邀請面漏了同一道閘。是否為缺陷取決於 owner 對「tenant_admin 能否自行擴編 manager」的業務決策。依 [[feedback_gate1_forks_prose_ruling]] 以 prose 交 owner 裁，不硬塞 AskUserQuestion。

**可能修法（待裁決後）**：(a) `createInvitation` 收 inviter role，限制「只能邀請 ≤ 自己 role 的對象」（tenant_admin 只能邀 member）；或 (b) 把 manager 級（tenant_admin/billing_admin）邀請收斂為 owner-only，與 `PATCH /role` 對齊；或 (c) 確認當前行為即意圖、補註解與測試鎖定。

---

### ISO-ENUM-2（P3，sibling，非隔離面 → 併 payments/security backlog）

```
ID         : ISO-ENUM-2
領域        : （Payments / Security boundary —— 經 ISO-ENUM-1 completeness sweep 發現）
嚴重度      : P3
違反條款    : Tier-0 #4 Stability（robustness）/ 統一錯誤 envelope（應 400 卻 500）
證據        : functions/utils/payments.ts:415-424（ADAPTERS plain object + resolvePaymentAdapter）
            functions/api/webhooks/payments/[vendor].ts:30-33
信心度      : high
需 Gate 複核 : 否（defer）
建議修者    : Haiku（同 fix class）
```

**機制**：`ADAPTERS` 是 plain object literal（`{ mock, ecpay }`）；`resolvePaymentAdapter(vendor)` = `ADAPTERS[vendor] ?? null`。webhook handler 先 `vendor = String(params.vendor).toLowerCase()`，故只有**全小寫**原型鍵漏過：`constructor`（`ADAPTERS['constructor']` = `Object` 函式，truthy）、`__proto__`（回 `Object.prototype`，truthy）。`?? null` 只 coalesce null/undefined，function/object 直接回。

**影響**：`POST /api/webhooks/payments/constructor` → adapter = truthy 非 null → 繞過 line 32 的乾淨 `400 UNKNOWN_PAYMENT_VENDOR` → 走到 `adapter.parseWebhook(...)`（`Object.parseWebhook` = undefined）→ TypeError → 中介層攔截回 **500**。**無狀態變更、無資料外洩**（parseWebhook 從未執行，無任何 DB 寫入），純粹「應 400 卻 500 + 一筆 uncaught-then-caught 例外噪音」。webhook 無 auth（PSP callback，靠 adapter 內驗章），故此 surface 本就對外開放。

**修法**：`resolvePaymentAdapter` 改 `Object.hasOwn(ADAPTERS, vendor) ? ADAPTERS[vendor] : null`，或 `ADAPTERS = Object.assign(Object.create(null), {...})`，或 Map。**P4 安全邊界領域請順帶複查 `webhooks/kyc/[vendor].ts` 是否同款 vendor 派發**（高機率同 pattern）。

---

## 2. 端點 / 查核對象矩陣（45 列；merge 3 finder + 主線補驗）

> verdict：ok / suspect（已轉 finding）/ not-applicable。「主線補驗」標記＝因 finder 失敗、由主線直接讀碼裁決。

### 2.1 tenant 軸端點（`/api/tenants/**`，8 列）

| 端點 | method | gate | verdict |
|---|---|---|---|
| `tenants/index.ts` | GET / POST | GET: requireRegularAccessToken + `WHERE m.user_id=?`（self only）；POST: 無 :tenantId，durable idempotency，creator→tenant_owner（設計） | ok |
| `tenants/[tenantId]/entitlements.ts` | GET | requireRegularAccessToken + resolveIssuanceContextForTenant（任一 active member，plan §8.2 刻意較寬） | ok |
| `tenants/[tenantId]/wallet.ts` | GET | requireRegularAccessToken + resolver + BILLING_CAPABLE_ROLES（owner/tenant_admin/billing_admin）；plain member 403 | ok |
| `tenants/[tenantId]/members/index.ts` | GET | requireActiveTenantRole owner/admin；DTO only 不 dump token_hash | ok |
| `tenants/[tenantId]/members/[userId]/role.ts` | PATCH | requireActiveTenantRole OWNER_ONLY；guardSelf + last-owner statement-level | ok |
| `tenants/[tenantId]/members/[userId]/[action].ts` | POST | requireActiveTenantRole OWNER_ONLY（gate 正確）**但 action allowlist 原型鏈繞過** | **suspect → ISO-ENUM-1** |
| `tenants/[tenantId]/invitations/index.ts` | POST | requireActiveTenantRole owner/admin；INVITABLE_ROLES 排除 owner **但 manager 級可邀** | **suspect → ISO-CROSS-01** |
| `tenants/[tenantId]/invitations/[invitationId]/revoke.ts` | POST | requireActiveTenantRole owner/admin；CAS `WHERE id=? AND tenant_id=?` cross-tenant guard | ok |

### 2.2 user-owned 端點（user_id 軸 IDOR，16 列）

全部 **ok**，逐一驗證雙欄 `(id, user_id)` 過濾、越權一律 404 不洩漏存在性：
`auth/payments/intents.ts`(GET)、`auth/payments/intents/[id].ts`(GET/DELETE)、`payments/intents/[id]/refund-request.ts`(POST)、`auth/wallet.ts`(GET)、`auth/wallet/[id].ts`(DELETE)、`auth/webauthn/credentials.ts`(GET)、`auth/webauthn/credentials/[id].ts`(PATCH/DELETE)、`requisition/me.ts`(GET)、`requisition/[id].ts`(GET/DELETE)、`requisition/revoke.ts`(POST)、`invitations/accept.ts`(POST)、`auth/devices.ts`(GET)、`auth/devices/logout.ts`(POST)、`auth/identity/unbind.ts`(POST)、`auth/deals.ts`(GET)、`auth/kyc/status.ts`(GET)。

> `invitations/accept.ts`：tenant 由 invitation row 推導（非 path），`acceptInvitation` 驗 `normalizeEmail(user.email)===invite.email` 且 `email_verified`（非僅持 token）；過期/撤銷/被他人 accept 皆有 stable deny；atomic CAS consume + plain INSERT 杜絕 leaked-link silent reactivation。

### 2.3 admin / 全域 role 軸 + helper（21 列）

全部 **ok**。關鍵：
- **helper**：`requireRole.ts`（finance/support=0 不靠 hierarchy 升權；`actorOutranksTarget` 嚴格 >、未知 role fail-closed）、`scopes.ts`（scope/role 皆簽章 JWT claim，user 無私鑰無法自塞；elevated 走 `hasExactScopeInToken` 不做 role fallback）、`tenant-context.ts`（**全域 role 在此無特權分支** —— 全域 admin 無 membership → `NOT_A_MEMBER` 403）。
- **admin billing**（grant/topup/adjust/quota）：雙閘門 step-up（`elevated:billing` + 對應 `for_action`）+ effective fine scope（`admin:billing:grant`/`:wallet`）；actor snapshot 由 DB 取（禁信 client）；`loadEligibleTenant` / `grantPlan` tenant eligibility gate（offboard/不存在 tenant → 422，不憑空生 row）。
- **admin users**（ban/unban/revoke）：`requireRole(admin)` + `admin:users:write` + `actorOutranksTarget`；ban 顯式擋 self，unban 雖無顯式 self-block 但 banned token 在 requireAuth 即被擋 + `actorOutranksTarget(self,self)=false` → 自我 unban 不可達。
- **整面掃 `functions/api/admin/` 38 檔**：無任一端點只 `requireAuth` 裸奔；cron/* 走 `CRON_SECRET` bearer。

---

## 3. INV-ISO-1..7 逐條結論

- **INV-ISO-1（platform_role DB live 推導，禁信 token claim）✅**：`resolveIssuanceContextForTenant` 每 request 由 DB membership 重推 role；suspended/demoted actor 立即被拒（window=0，不等 ≤15min TTL）。**主線補驗（token-claims 切角）**：grep 全 codebase，唯一從 token 讀 `tenant_id`/`platform_role` claim 的點是 `org-switch.ts:79`（純 audit data field，非授權決策）；無任何 authz 路徑信任 token tenant claim。`refresh.ts`/`me.ts`/`userinfo.ts` 完全不帶 tenant claim（PR1 決策 D：不跨 refresh 持久化）。
- **INV-ISO-2（每個 `/tenants/[tenantId]/**` 過 gate，fail-closed）⚠️**：8 端點全數有 gate 且 fail-closed；唯 `[action].ts` 的 action allowlist 有原型鏈繞過（**ISO-ENUM-1**），gate 本身無洞。
- **INV-ISO-3（personal tenant 只 owner 進入）✅**：resolver 的 `PERSONAL_TENANT_FOREIGN` + domain 的 `personal_tenant_immutable`/`tenant_ineligible` 雙層擋；migration 0047 CHECK 強制 personal tenant 恆 active+未刪。
- **INV-ISO-4（所有 tenant-scoped query 帶 tenant_id，無裸 query）✅**：**主線補驗（query-sweep 切角）**：列出 10 張 tenant-scoped table（tenants / organization_members / grant_plan_operations / tenant_product_access / credit_ledger / credit_wallets / product_usage_quota / quota_config_ledger / invitations / org_create_operations），grep 其全部 SQL 引用點逐一確認綁 `tenant_id`，或由全域唯一 secret/key 鎖定（`invitations.token_hash`、`org_create_operations`/`grant_plan_operations` 的 admin idempotency key、`payment_ref_key` —— 後者全域唯一為**正確**：同一筆 offline 付款不應給兩個 tenant 用）。`domain-event-emit.ts` 的 `SELECT platform_role FROM organization_members WHERE tenant_id=? AND user_id=?` 等 emit 衍生 query 亦 tenant-scoped。**migration 約束實證**：0047 確認 `platform_role CHECK IN (4 值)`、`uq_tenants_personal_owner`、`UNIQUE(tenant_id,user_id)` 皆存在 → `tenant-context.ts:152` 的 `as PlatformRole` cast 安全。
- **INV-ISO-5（無法自升 role / 改他人 role；ban 須 actorOutranksTarget）⚠️**：tenant 軸 `PATCH /role` OWNER_ONLY + guardSelf + last-owner guard；全域軸 ban/unban `actorOutranksTarget`。唯邀請面 manager 級授予與升權面不一致（**ISO-CROSS-01**，需 owner 裁決）。
- **INV-ISO-6（全域軸與 tenant 軸正交，無隱式繞過）✅**：admin billing 以全域 role 改 tenant 資料＝§2.3 平台面**設計意圖**（有 fine scope + critical audit + eligibility gate）；反向 `resolveIssuanceContextForTenant` 內全域 role 無特權分支（逐行確認）。
- **INV-ISO-7（credit/billing/quota 全 tenant-scoped，無跨租戶讀寫）✅**：**主線補驗（billing-credit 切角）**：`credit.ts`（573 行）+ `billing.ts` 每個 public function 皆顯式收 `tenantId` 參數，全部 SQL `WHERE tenant_id=?`；**無 walletId 直接操作的 confused-deputy**（無任何函式收 walletId 而不驗歸屬）；`loadEligibleTenant` gate 所有寫入；credit idempotency 鍵 `(tenant_id, idempotency_scope, idempotency_key)` per-tenant scoped。`tenants/[tenantId]/wallet.ts`/`entitlements.ts` DTO 只回該 tenant 投影、不 dump ledger、無 JOIN 溢出。

---

## 4. 死角 / 交其他領域

- **deductCredits 目前無 caller**：`functions/api` 內尚無端點呼叫 `deductCredits`（product/game 端點未接上 credit 消費）；其未來 tenant-scope 正確性無法以現存端點驗，待接上時複查。
- **step-up token 簽發流程本身**（哪些 role 能 mint `elevated:billing`）屬 **P4 安全邊界**領域，本領域未深讀 mint endpoint。
- **domain-event-emit splice 正確性 / 並發競態端到端 repro** → **P3 事件一致性**領域。
- **`webhooks/kyc/[vendor].ts` 是否同 ISO-ENUM-2 pattern** → **P4 安全邊界**順帶複查。
- 全域 `role` 軸 demote 延遲：role 存 JWT claim、撤權靠 `token_version` bump；`changeUserRole`（latent，無 live caller）demote 時會 bump → window=0；但現行唯一 live grant 機制是手動 D1 recipe（繞 token_version、只 grant 不 demote）—— 屬**既有 backlog**（`platform admin-grant 硬化`），非本次新洞。

---

## 5. 對主線後續的交接

- **ISO-ENUM-1（P2）**：trivial 修，明確正確（對照 retry.ts 已有的 Set-先驗 pattern）。建議問 owner 是否本窗口處理（修法 PR 走 Dual Gate）；若 defer 則進 `STAGE8-BACKLOG.md`。
- **ISO-CROSS-01（P3）**：先送 owner business-rule ruling（prose），裁決後再定修法。
- **ISO-ENUM-2（P3）**：併 payments/security backlog。
- **末期 Gate**：本報告 §2 矩陣 + §3 INV 結論可作為 Codex/GPT 末期完整 Gate 的隔離面對照。
