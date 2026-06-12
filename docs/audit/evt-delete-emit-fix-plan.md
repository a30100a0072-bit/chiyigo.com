# EVT-003 修補 Plan：account hard-delete 事件化（delete-emit）

> Gate State: **PLAN_DRAFT**（自審後 → 送 Codex Plan Gate）
> 來源 finding：`docs/audit/03-event-consistency.md` §2 EVT-003（P2）。
> owner 裁決（2026-06-12 via GPT）：(1) reuse `account.disabled` + optional `reason:'account_deleted'`，不新增事件型別、不動 0051 CHECK；(2) **membership 殘留同一顆 PR 修**（同 transaction offboard + 每筆 emit `member.offboarded`）；(3) `users` hard-delete mutation 必加 CAS guard；repro 必覆蓋三件：delete 成功 emit、membership offboard emits、重複 delete 不重複 emit。
> Dual Gate Workflow：本 plan 過 Codex Plan Gate 才進 Code。報告語言繁中；code identifier 保留原文。

---

## 1. 問題（已驗證，03 報告 EVT-003）

`functions/api/auth/delete/confirm.ts:50-64`：帳號 hard-delete 的原子 batch（6×DELETE + `UPDATE users SET email=匿名, deleted_at, token_version+1`）：

1. **零 domain event**——最強的 account disable 不發 `account.disabled`（較弱可逆的 ban 在 `ban.ts:78-89` 反而有 emit 同 batch）。streamSeq 必須在 mutation 當下 in-batch 分配，**RP 上線後無法對歷史刪號補發**。
2. **`UPDATE users` 無 CAS**（`WHERE id = ?` 無 `AND deleted_at IS NULL`）——`:38-44` pre-read 是 TOCTOU；並發 double-confirm 兩邊都會跑 batch（重 bump token_version、未來接 emit 會 double-emit）。
3. **token 消耗非 atomic**（`:47` DELETE 不驗 `changes===1`）——並發雙 confirm 都過第 4 步。
4. **org tenant membership 殘留**——batch 不動 `organization_members`、不發 `member.offboarded`；已刪 user 以匿名 email 殘留在 tenant 成員列表，未來 RP 視其 active member。

---

## 2. 修法

### 2.1 token 消耗 atomic 化（`:47`）

```ts
const consumed = await db.prepare('DELETE FROM email_verifications WHERE token_hash = ?').bind(tokenHash).run()
if (consumed.meta.changes !== 1) return res({ error: 'Invalid or expired deletion token', code: 'INVALID_DELETION_TOKEN' }, 400)
```
並發雙 confirm：loser 在此被擋（不進 batch）。沿用既有 error code，不發明新 code。

### 2.2 sole-owner 前置檢查（read-only，token 消耗**之前**）

刪號 user 若是任一 **org** tenant 的**唯一 active `tenant_owner`**，offboard 會讓 tenant 無主（違反 last-owner 不變量）。前置一條 read-only query：

```sql
SELECT om.tenant_id FROM organization_members om
JOIN tenants t ON t.id = om.tenant_id
WHERE om.user_id = ? AND t.type <> 'personal'
  AND om.status = 'active' AND om.platform_role = 'tenant_owner'
  AND NOT EXISTS (SELECT 1 FROM organization_members o2
                   WHERE o2.tenant_id = om.tenant_id AND o2.user_id <> om.user_id
                     AND o2.platform_role = 'tenant_owner' AND o2.status = 'active')
```

命中 → **409 `SOLE_TENANT_OWNER`**（回 blocking tenant 數，不洩 tenant 名）＋ **token 不消耗**（user 轉移 ownership 後可重試同一信）。＝ **§7 Open Decision OD-1 的 Option A（推薦預設，等 owner 確認）**。

### 2.3 membership 枚舉（read-only，pre-batch）

```sql
SELECT om.tenant_id FROM organization_members om
JOIN tenants t ON t.id = om.tenant_id
WHERE om.user_id = ? AND t.type <> 'personal' AND om.status IN ('active','suspended')
```

- **personal tenant 排除**＝結構性必然：`members.ts:126` 對 personal 一律 `personal_tenant_immutable` 拒絕，且 migration 0047 CHECK 強制 personal tenant 恆 active＋未刪——不可 offboard 也不可刪。personal tenant 與其 membership row 留存（現狀），account 層 deny 由 `account.disabled` 事件承載（RP 視角足夠）。
- 上限：N > **17** → 409 `ACCOUNT_DELETE_MEMBERSHIP_OVERFLOW` + critical audit（§7 OD-2；3N+9 ≤ 60 = session-revoke K=20 已證明的 batch 上限）。現實 N≈0-3。

### 2.4 重組單一原子 batch（核心）

順序固定（changes() 鏈不可中插）：

```
[ 每個 org membership（×N）:
    DELETE organization_members …（offboardMember 同款 SQL **verbatim**：status IN ('active','suspended')
      + last-owner statement-level guard 原樣保留 — 2.2 前置檢查後的 TOCTOU 縱深）,
    …emitMemberOffboarded(db,{tenantId,targetUserId:userId,actorUserId:userId},meta).statements,
  UPDATE users SET email=匿名, deleted_at=datetime('now'), token_version=token_version+1
    WHERE id = ? AND deleted_at IS NULL,            ← CAS（gating mutation）
  …emitAccountDisabled(db,{targetUserId:userId,actorUserId:userId},meta,{reason:'account_deleted'}).statements,
  DELETE local_accounts / backup_codes / refresh_tokens / email_verifications(user 全部) /
  password_resets / user_identities（既有 6 條，移到 batch 尾端 — 不得插入任何 gating→emit 之間）]
```

- `banBatch[0].meta.changes !== 1` 同款判定：**users UPDATE 0-row →（已被並發刪除）回 404 `ACCOUNT_NOT_FOUND`**，無事件（CAS 保證重複 delete 不重複 emit——owner repro 要件 3）。
- 每個 membership DELETE 的 emit 由其自身 changes()=1 gating（多 streamKey 同 batch＝session-revoke multi-family 已證明 pattern）。
- **TOCTOU 殘差（顯式可觀測，非靜默）**：若 2.2 與 batch 之間發生 race 使某 membership 的 last-owner guard 0-row → 該 membership 留存＋不發事件（= 現狀殘留行為），post-commit 逐筆檢查 batch results，0-row 的 membership 寫一筆 **critical audit `account.delete.membership_skipped`**（含 tenant_id）供人工跟進。帳號本體照常刪除（guard 保住「永不移除最後 active owner」不變量，殘差列可觀測）。

### 2.5 `emitAccountDisabled` 增加 optional reason

`functions/utils/domain-event-emit.ts`：`emitAccountDisabled(db, input, meta, opts?: { reason?: string })`——有 reason 時 dataSql 改 `json_object('sub', ?, 'reason', ?)`。契約 SPEC `account.disabled.optional = { reason:'string' }` **現成**（domain-events.ts:127），零契約變更；ban.ts 既有 caller 不帶 opts、行為不變。consumer 重建 re-validate 自然通過。

### 2.6 post-commit 觀測（ban.ts 同款）

`auditDomainEventEmitted(env, identity)` 對 account + 每筆 membership 的 emit identity 各一次（redacted hash；best-effort 不擋 200）。既有 `safeUserAudit('account.delete', critical)` 保留。

---

## 3. 測試（Code 階段；pre-fix-fail repro = owner 裁決三要件）

vitest + local D1（沿用 `event-outbox-emission.test.ts` harness + `_setup.sql`）：

**A. repro（pre-fix 紅 → fix 後綠）**
1. **delete 成功 emit**：seed user B（active、1 refresh、1 local_account、delete token）→ confirm → assert `event_outbox` 有 `account.disabled` @ `account:<B>`，`json_extract(data_json,'$.reason')='account_deleted'`。pre-fix＝0 row（紅）。
2. **membership offboard emits**：seed user C 為 org tenant T1 member + T2 suspended member（皆非 sole owner）→ confirm → assert `organization_members` 兩列被 DELETE + `event_outbox` 兩筆 `member.offboarded`（`tenant:T1:member:<C>`、`tenant:T2:member:<C>`）+ 1 筆 `account.disabled`。pre-fix＝membership 留存、0 事件（紅）。
3. **重複 delete 不重複 emit**：對已刪 user 以第二張有效 token 再 confirm → 404 + outbox 計數不變（驗 CAS）；同 token 並發雙 confirm → 恰一個 200，outbox 恰一組事件（驗 2.1 atomic consume）。

**B. regression**
- sole-owner：user D 為 org tenant 唯一 active owner → confirm → **409 `SOLE_TENANT_OWNER`**、token 未消耗（可重試）、零 mutation 零事件。
- ban 路徑不回歸：ban 仍 emit 無 reason 的 `account.disabled`（emitAccountDisabled 簽名相容）。
- consumer 端到端：跑 5b consumer → `event_deny_state` `account:<B>` denied=1、各 member streamKey denied=1（contiguity 過 real consumer）。
- 既有 51 affected tests 全綠。

---

## 4. 變更檔案

| 檔 | 變更 |
|---|---|
| `functions/api/auth/delete/confirm.ts` | §2.1-2.4、§2.6（主要重寫 batch 段） |
| `functions/utils/domain-event-emit.ts` | §2.5 emitAccountDisabled optional reason |
| `tests/integration/`（新檔 account-delete-emission.test.ts） | §3 A/B |

無 migration、無 schema 變更、無新套件、無契約 breaking（optional key 現成）。

---

## 5. Acceptance Criteria

| 類型 | 目標 |
|---|---|
| repro | §3-A 三件 pre-fix 紅、fix 後綠 |
| 冪等 | 重複/並發 delete 恰一組事件、恰一次 token_version bump 路徑可證 |
| 不變量 | 永不移除最後 active owner（409 前置 + statement guard 縱深）；personal tenant 不動 |
| 觀測 | membership_skipped 殘差 critical audit；emit identities post-commit audit（hash redacted） |
| gates | typecheck / lint / 相關 integration tests / build:functions 全綠；ratchet 零新增 |

## 6. Non-goals

- 不接 RP pull API、不動 deny-state consumer/projection（EVT-001/002 = `evt-consumer-hardening-fix-plan.md`）。
- 不處理 pending invitations to 該 email（member.invited email-keyed 流；deny-effect=none，殘留無 enforcement 影響——列 STAGE8 hygiene）。
- 不動 0051 CHECK、不新增事件型別（owner 裁決）。
- 不改 personal tenant 生命週期（0047 CHECK 結構性排除）。

## 7. Open Decisions

- **OD-1（owner 裁，本 plan 預設 A）**：sole-owner org tenant 的刪號行為——**A=409 fail-closed（推薦）** / B=照刪留無主 tenant / C=連 tenant 一起處置。利弊見審計報告交接（A 保不變量、可重試；代價＝sole owner 需先轉移 ownership 才能自助刪號）。
- **OD-2（Codex 可裁）**：N>17 memberships → 409 overflow（推薦：簡單、原子性完整、現實不可達）vs 分 chunk forward-progress（session-revoke 同款；複雜度高、跨 chunk 非原子）。
- **OD-3（Code 階段驗證）**：`unban.ts` target lookup 是否 `deleted_at IS NULL`（防「對已刪帳號 unban → 發 reenabled undeny」）；若無，加一行 guard + negative test（同 PR 順手，2 行內）。
