# ISO-ENUM-1 修補 Plan（送 Codex Plan Gate）

> Gate State: **PLAN_DRAFT**（自審後 → 送 Codex Plan Gate）
> 來源 finding：`docs/audit/02-isolation.md` §1 ISO-ENUM-1（P2）。owner 裁決（2026-06-12 via GPT）：**現在修，不 defer**。
> Dual Gate Workflow：本 plan 過 Codex Plan Gate 才進 Code。報告語言繁中；code identifier 保留原文。

---

## 1. 問題（已驗證）

`functions/api/tenants/[tenantId]/members/[userId]/[action].ts`：

```ts
const ACTION_EVENT: Record<string, string> = { suspend, reactivate, offboard }   // L17-19 plain object literal
...
const action = String(params?.action ?? '')                                       // L26
const eventType = ACTION_EVENT[action]                                             // L29
if (!eventType) return res({ error: 'Unknown member action', code: 'NOT_FOUND' }, 404)  // L30
...
if (action === 'suspend') ...
else if (action === 'reactivate') ...
else result = await offboardMember(...)                                            // L48-50 dispatch
```

`ACTION_EVENT['toString'|'constructor'|'__proto__'|'valueOf'|'hasOwnProperty']` 回繼承自 `Object.prototype` 的 truthy 值 → 繞過 L30 的 404 → dispatch 落入 `else = offboardMember`。隨後 L56 `safeUserAudit({ event_type: eventType, ... })`（eventType 為 function）在 `user-audit.ts` 內 throw、不匹配 cold_class fallback → 最外層 `catch { /* 不擋主流程 */ }`（user-audit.ts:162）**靜默吞掉**，該次 offboard 的 HTTP `audit_log` row 遺失。

**邊界**：caller 必為 active `tenant_owner`（L32 gate 先於 dispatch；無提權、無跨租戶）；domain `member.offboarded` outbox 事件仍正確 emit（event-sourcing trail 不破）。屬 latent correctness footgun + 部分 audit-evidence 缺口。

---

## 2. 根因

「物件被外部派生字串索引後檢查 falsy」對 `Object.prototype` 繼承鍵失效。同 repo `functions/api/admin/audit-archive/retry.ts:128` 已用正確 pattern：`VALID_ACTIONS.has(action)`（Set 先驗）**才**索引 `SCOPE_FOR_ACTION[action]`。本檔缺這道先驗。

---

## 3. 修法

### 3.1 主修（必做）— allowlist 改 prototype-safe，且與 ACTION_EVENT 同源不漂移

L29-30 改為：

```ts
const ALLOWED_ACTIONS = new Set(Object.keys(ACTION_EVENT))   // module-scope const；單一事實來源，與 ACTION_EVENT 不漂移
...
// handler 內：
if (!ALLOWED_ACTIONS.has(action)) {
  return res({ error: 'Unknown member action', code: 'NOT_FOUND' }, 404)   // 保留既有 NOT_FOUND/404 response shape
}
const eventType = ACTION_EVENT[action]   // 此時 action 保證為三鍵之一，eventType 必為 string
```

- 用 `new Set(Object.keys(ACTION_EVENT))` 而非另寫 `new Set(['suspend','reactivate','offboard'])`：避免第二份硬編清單與 `ACTION_EVENT` 漂移（DRY、單一事實來源）。`Set.has('toString')`/`('constructor')`/`('__proto__')` 皆 false → 正確 404。
- response code 不變（`NOT_FOUND`/404），不發明新 code。
- **不改** owner gate、不改 member lifecycle domain、不改 tenant query、不改 audit schema。

### 3.2 dispatch 顯式化（**併入本 PR — owner 2026-06-12 定案 D**）

主修後，能通過 `ALLOWED_ACTIONS` 的只有三鍵，故 `else = offboard` 已安全。但 dispatch 仍是「未列分支的 action 默默變 offboard」的形狀——若未來有人往 `ACTION_EVENT` 加第四鍵（如 `archive`）卻漏加 dispatch 分支，該 action 會通過 guard 後默默 offboard。同檔順手收斂：

```ts
if (action === 'suspend') result = await suspendMember(...)
else if (action === 'reactivate') result = await reactivateMember(...)
else if (action === 'offboard') result = await offboardMember(...)
else return res({ error: 'Unexpected action', code: 'INTERNAL_ERROR' }, 500)   // 不可達；防 ACTION_EVENT 增鍵漏 dispatch
```

理由：同檔、同缺陷類（誤路由到破壞性 offboard）、2 行、移除耦合 footgun。

---

## 4. 測試（Code 階段）

整合測試（vitest-pool-workers + local D1），複用 PR4 member-lifecycle 既有 fixture（seed tenant + owner membership + 一個 active org member + mint owner access token）。

**A. pre-fix repro（pre-fix 必紅、fix 後綠）— 鎖定 exact failure mode**
- owner `POST /api/tenants/<tid>/members/<targetUid>/toString`
- owner `POST .../constructor`
- owner `POST .../__proto__`
- 斷言（fix 後）：HTTP **404** `NOT_FOUND`；target member row **未被 DELETE**（offboard 未發生）；無 `member.offboarded` outbox 事件。
- pre-fix 預期：同呼叫得 **200** + member row 被 DELETE（測試此時紅）→ 證明 bug。

**B. 正向 regression（鎖定主流程不破 + audit row 不丟）**
- owner `POST .../offboard`（合法）→ 200 + member row 被移除 + `audit_log` 有對應 `member.offboarded` row（鎖定風險表「audit row 不可丟」）。
- owner `POST .../suspend`、`.../reactivate` 合法路徑全綠。

> 註：CF 測試 runtime 對 `__proto__` 路徑段若有 normalization，該案行為以實跑為準；`toString`/`constructor` 風險最低、已足以證明 bug。Set 修法對所有鍵皆正確，與路由細節無關。

---

## 5. 變更檔案

| 檔 | 變更 |
|---|---|
| `functions/api/tenants/[tenantId]/members/[userId]/[action].ts` | §3.1 主修（+ §3.2 若 owner 採納） |
| `tests/`（member-lifecycle 既有整合測試檔或新增鄰近檔） | §4 A/B 測試 |

無 migration、無 schema、無新套件、無 domain/event/gate 改動。

---

## 6. Acceptance Criteria

| 類型 | 目標 |
|---|---|
| repro | prototype-key invalid action 測試 pre-fix 紅、fix 後綠（404、無 offboard、無 outbox 事件） |
| regression | 既有合法 action（suspend/reactivate/offboard）全綠 |
| security | `toString`/`constructor`/`__proto__` 不得進入任何 lifecycle handler |
| audit | 合法 offboard 仍寫 `audit_log` row（正向鎖定）；invalid action 路徑無 audit-loss / 無未捕捉例外 |
| typecheck / lint / build:functions | clean；ratchet 零新增 |

---

## 7. Non-goals

- 不處理 ISO-CROSS-01（獨立 PR：`docs/audit/iso-cross-01-fix-plan.md`）。
- 不處理 ISO-ENUM-2（併 payments/security backlog，標 P3 security-hardening）。
- 不在本 PR 改 `user-audit.ts`（audit-loss 根因觀測強化走獨立 tiny PR：`docs/audit/audit-loss-observability-plan.md`）。
- 不重構 member lifecycle、不改 owner gate、不改 tenant query、不改 audit schema。

---

## 8. Resolved Decisions（owner 2026-06-12 定案）

- **D（scope）→ 併入本 PR**：§3.2 dispatch 顯式化納入主修。
- **A（audit 根因觀測）→ 拆獨立 tiny PR**：`safeUserAudit` 最外層靜默 catch 的 `console.error` 強化走 `docs/audit/audit-loss-observability-plan.md`，不綁本 PR。
- **I（順序）→ 兩顆都在末期 Gate 前 land**：ISO-ENUM-1 + ISO-CROSS-01 皆於末期 Codex+GPT Gate 前合併，讓 Gate 審到最終隔離面。

> 三顆 PR 順序建議：ISO-ENUM-1（本 plan）→ ISO-CROSS-01 → audit-loss 觀測（可與前二者並行，無相依）。各自獨立過 Code Gate。

---

## 9. Codex Plan Gate 對照

**CODEX_PLAN_APPROVED**（2026-06-12，三 plan 一併過，無 blocker）。Code-Gate binding condition #1：invalid-action 測試每個 prototype key 用 fresh target（pre-fix 破壞性）→ **已遵守**（測試 `for...of` 每輪 `orgWithOwner()` + 新 target member）。

**Code 狀態**：CODEX_CODE_APPROVED(2026-06-12，findings none) → squash-merged to main `b28f30f`(branch tip `488b0ce`)。Gate State → **MERGED_MAIN**。
- 測試：`member-endpoints.test.ts` 25/25 綠（post-fix）；5 個 prototype-key 案 + 1 正向 audit 案，pre-fix 實測 RED（`expected 200 to be 404` + target 被 offboard）。
- ratchet OK（current 902，零新增）/ lint clean / build:functions compiled。
