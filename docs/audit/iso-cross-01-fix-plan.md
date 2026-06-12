# ISO-CROSS-01 修補 Plan（送 Codex Plan Gate）

> Gate State: **PLAN_DRAFT**（自審後 → 送 Codex Plan Gate）
> 來源 finding：`docs/audit/02-isolation.md` §1 ISO-CROSS-01（P3）。owner 裁決（2026-06-12 via GPT）：**採 option b — manager 級邀請收斂為 owner-only**。
> 獨立於 ISO-ENUM-1 PR（GPT 明示不混）。屬「權限/RBAC」敏感熱區 → 走 Dual Gate。報告語言繁中；code identifier 保留原文。

---

## 1. 問題（已驗證）

授權面不一致（橫向 manager 權限增殖 seam）：

- `functions/api/tenants/[tenantId]/invitations/index.ts:22`：`MANAGER_ROLES = ['tenant_owner','tenant_admin']` —— `tenant_admin` 可呼叫邀請端點。
- `functions/utils/invitations.ts:27`：`INVITABLE_ROLES = Set(['tenant_admin','billing_admin','member'])` —— 邀請對象可為 manager 級的 `tenant_admin` / `billing_admin`。
- `functions/utils/invitations.ts:110-125` `createInvitation`：只驗 `platformRole ∈ INVITABLE_ROLES`，**不校驗「邀請者 role ≥ 被邀 role」**。
- 對比 `functions/api/tenants/[tenantId]/members/[userId]/role.ts:15`：`PATCH /role` 升權是 `OWNER_ONLY`。

**結果**：`tenant_admin` 無法用 `PATCH /role` 把既有成員升成 `tenant_admin`，卻可用「邀請新帳號」直接造出新的 `tenant_admin` / `billing_admin`（其中 `billing_admin` 可讀 tenant 錢包餘額），繞過 owner-only 升權意圖。

**邊界**：`INVITABLE_ROLES` 已排除 `tenant_owner`（無法經 invite 造 owner）→ 非垂直越權到頂權，屬橫向 manager 增殖；需 attacker 已是該 tenant 的 `tenant_admin`。

---

## 2. 裁決規則（owner option b）

| 邀請目標 role | 可邀請者 |
|---|---|
| `member` | `tenant_owner` + `tenant_admin`（既有） |
| `billing_admin` | **`tenant_owner` only** |
| `tenant_admin` | **`tenant_owner` only** |
| `tenant_owner` | 不可經 invite 建立（INVITABLE_ROLES 已排除，不變） |

意圖對齊 `PATCH /role` 的 owner-only：**高權限授與不得由 manager 自行擴張**，不以「邀請是新帳號」當例外。

---

## 3. 修法（domain-level，單一事實來源）

授權不變量放 domain（對齊 `members.ts` statement-level 紀律），endpoint 維持薄。

### 3.1 `functions/utils/invitations.ts`

- `CreateInvitationInput` 加**必填**欄位 `inviterPlatformRole: PlatformRole`（型別 import 自 `tenant-context.ts` 的 `PlatformRole`；endpoint 傳入 gate 驗過的 live role）。
  - **刻意設必填**：TS 在 typecheck 階段強制**所有** caller 顯式傳入 → 無 silent gap（缺漏不會默默走 deny 或默默放行，而是 compile error）。現有 caller 影響見 §5（1 prod + ~18 test call site，皆需同步加 `inviterPlatformRole`）。
- 新增 manager-level 集合：
  ```ts
  const OWNER_ONLY_INVITE_ROLES: ReadonlySet<string> = new Set(['tenant_admin', 'billing_admin'])
  ```
- `InviteCreateOutcome` union 加 `| { outcome: 'inviter_role_insufficient' }`。
- `createInvitation` 內，於 `platformRole ∈ INVITABLE_ROLES` 驗證**之後**、tenant eligibility 之前，加：
  ```ts
  if (OWNER_ONLY_INVITE_ROLES.has(input.platformRole) && input.inviterPlatformRole !== 'tenant_owner') {
    return { outcome: 'inviter_role_insufficient' }
  }
  ```
  （deny-by-default：未知/缺 inviterPlatformRole 也不等於 tenant_owner → 落入拒絕。）

### 3.2 `functions/api/tenants/[tenantId]/invitations/index.ts`

- `MANAGER_ROLES` gate **不變**（`tenant_admin` 仍可呼叫端點以邀 member）。
- 傳 `inviterPlatformRole: gate.role` 進 `createInvitation`（`requireActiveTenantRole` 回傳的 `gate.role` 是 live-derived 的 `PlatformRole`，authoritative）。
- `switch (result.outcome)` 加 case：
  ```ts
  case 'inviter_role_insufficient':
    await emitDenied(env, request, userId, tenantId, 'inviter_role_insufficient')
    return res({ error: 'Only a tenant owner can invite a manager-level member', code: 'INVITER_ROLE_INSUFFICIENT' }, 403)
  ```

**不改**：`INVITABLE_ROLES`（仍排除 owner）、`MANAGER_ROLES`（仍 owner+admin）、token / tenant query / migration / schema。

---

## 4. 測試（Code 階段）

整合測試（vitest-pool-workers + local D1），複用 PR4 invitation 既有 fixture：

**Negative（pre-fix 紅、fix 後綠 — 鎖定 exact failure）**
- `tenant_admin` 邀 `tenant_admin` → **403 `INVITER_ROLE_INSUFFICIENT`** + `member.denied` audit reason `inviter_role_insufficient` + **無 invitation row 建立**。
- `tenant_admin` 邀 `billing_admin` → 同上 403。
- pre-fix 預期：兩者得 201 + invitation row 建立（測試此時紅）→ 證明 seam。

**Regression（fix 後仍綠）**
- `tenant_admin` 邀 `member` → 201（manager 邀低權限仍可）。
- `tenant_owner` 邀 `tenant_admin` / `billing_admin` / `member` → 201（owner 全可）。
- `tenant_admin` 邀 `tenant_owner` → 既有 `INVITABLE_ROLES` 擋（400 ERR_VALIDATION，不變）。

**domain unit（可選，補單元層）**
- `createInvitation` 以 `inviterPlatformRole='tenant_admin'` + `platformRole='tenant_admin'` → `{ outcome: 'inviter_role_insufficient' }`，不寫 DB、不 emit。

---

## 5. 變更檔案

| 檔 | 變更 |
|---|---|
| `functions/utils/invitations.ts` | §3.1：input 加必填 `inviterPlatformRole`、新 outcome、owner-only manager 規則 |
| `functions/api/tenants/[tenantId]/invitations/index.ts` | §3.2：傳 `gate.role`、新 case → 403 |
| `tests/integration/invitations.test.ts` | 既有 ~16 處 `createInvitation(...)` 補 `inviterPlatformRole`（多數 inviter=owner → `'tenant_owner'`，含 L74/L290 邀 tenant_admin 案）+ §4 negative/regression 新測 |
| `tests/integration/event-invited-emission.test.ts` | 既有 2 處 `createInvitation(...)`（含 L43 邀 tenant_admin）補 `inviterPlatformRole: 'tenant_owner'` |

無 migration、無 schema、無新套件。

> **必填參數的 caller 影響（self-review 確認）**：`createInvitation` 現有 caller = 1 prod（`invitations/index.ts:64`）+ ~18 test call site（`invitations.test.ts`、`event-invited-emission.test.ts`）。設必填後全部須補傳；既有 test 的 inviter 皆為 owner，補 `'tenant_owner'` 即語意正確、測試續綠。**typecheck 會逐一抓出漏改點**（這正是設必填、不設 optional-default 的理由 —— 杜絕 silent gap）。

---

## 6. Acceptance Criteria

| 類型 | 目標 |
|---|---|
| negative | tenant_admin 邀 tenant_admin/billing_admin pre-fix 紅（201）、fix 後綠（403 + 無 row + denied audit） |
| regression | tenant_admin 邀 member、owner 邀任一 manager 級 全綠；INVITABLE_ROLES 仍排除 owner |
| security | manager 級邀請僅 `tenant_owner` 可成功（與 `PATCH /role` owner-only 對齊） |
| audit | 拒絕路徑 emit `member.denied` reason `inviter_role_insufficient` |
| typecheck / lint / build:functions | clean；ratchet 零新增 |

---

## 7. Non-goals

- 不處理 ISO-ENUM-1（獨立 PR：`docs/audit/iso-enum-1-fix-plan.md`）。
- 不改 `INVITABLE_ROLES` / `MANAGER_ROLES` 的既有語意（只加 inviter-role 約束層）。
- 不改 `PATCH /role`（已 owner-only，本 PR 只把 invite 面對齊它）。
- 不引入 tenant-scoped role hierarchy 抽象（YAGNI；目前只需 owner vs 非 owner 一條規則）。

---

## 8. 註記

- 屬「權限/RBAC」敏感熱區，走 Dual Gate Code Gate。
- 與 ISO-ENUM-1、audit-loss 觀測 PR 無相依，可並行；三顆皆於末期 Gate 前 land（owner 定案 I）。

---

## 9. Codex Plan Gate 對照

**CODEX_PLAN_APPROVED**（2026-06-12）。Code-Gate binding condition #2：endpoint 須以 `inviterPlatformRole: gate.role`（live DB-derived）傳入，**非** body/token claim → **已遵守**（`invitations/index.ts:65` 傳 `gate.role`；endpoint wiring 測試用 'player' token role + seeded tenant_admin membership 證明決策來自 live gate role）。

**Code 狀態**：CODEX_CODE_APPROVED(2026-06-12，findings none) → squash-merged to main `ce1c2a6`(branch tip `d10c937`；後續 `bf55893` reword 註解清 ratchet ':any' false-positive)。Gate State → **MERGED_MAIN**。
- 測試：invitations.test.ts 18 + member-endpoints.test.ts 22 + event-invited-emission.test.ts 2 = 43/43 綠；2 個 negative 案 pre-fix 實測 RED（`expected 403, got 201` + domain `created` 非 `inviter_role_insufficient`）。
- `inviterPlatformRole` 設必填 → typecheck 強制所有 caller 補傳（無 silent gap）；既有 ~18 test call site 已補 `'tenant_owner'`。
- ratchet OK（902，零新增；PlatformRole import 無循環）/ lint clean / build compiled。
