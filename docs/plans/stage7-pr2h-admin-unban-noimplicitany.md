# Stage 7 reduce PR-2h — admin/users/[id]/unban.ts noImplicitAny

**目標**：`functions/api/admin/users/[id]/unban.ts` 3 個 noImplicitAny error → 0，純 type-only handler context annotation。**auth 熱區 mutating endpoint**（account-state 轉移）→ full 四檢查點 + codex chain。

接續剛 SHIPPED 的 PR-2g（`ban.ts`，squash `2264529`）。與 ban.ts **分開做**：unban 風險模型不同（見 §風險模型差異）。

## Scout（對抗式驗證）

`npx tsc -b tsconfig.solution.json` 實證，3 errors 全在 handler context、無其他型別點：

- `(25,39)` TS7031 `request` implicitly has 'any'
- `(25,48)` TS7031 `env` implicitly has 'any'
- `(25,53)` TS7031 `params` implicitly has 'any'

（無 map callback / 無 evolving-any / 無 cascade；grep tsc 輸出僅這 3 行，全 line 25。）

## 風險模型差異（為何與 ban.ts 分開）

| | ban.ts（PR-2g） | unban.ts（本 PR） |
|---|---|---|
| status 轉移 | active → `banned` | `banned` → active |
| token_version | **+1**（立即失效所有 access token） | **不 bump** |
| refresh_token | **原子撤銷全部**（batch 第 3 句） | **不碰**（使用者重新登入即可） |
| atomic batch 內容 | `[CAS update, ...emit, refresh revoke]` | `[CAS update, ...emit]`（無 refresh revoke） |
| domain event | `emitAccountDisabled` | `emitAccountReenabled` |

→ 風險面更窄；但仍屬 auth / account-state 熱區，走 full 流程。

## mutation 邏輯逐行確認、全部不碰（byte-identical）

- `requireRole(request, env, 'admin')` + `effectiveScopesFromJwt(user).has(ADMIN_USERS_WRITE)` scope 守門
- `parseInt(params.id, 10)` + role-level guard（`actorOutranksTarget` / `isKnownRole` / `safeRoleString`）
- `target.status !== 'banned'` pre-read guard（非 banned → 400 `USER_NOT_BANNED`）
- hash-chain `appendAuditLog`（fail → 拒絕，不允許「動作成功但無證據」）
- **atomic batch（順序固定，不可重排）**：CAS `UPDATE users SET status='active' WHERE id=? AND status='banned'` → `emit.statements`（`emitAccountReenabled`，eventId/occurredAt 在此注入）
- 0-row CAS（`unbanBatch[0].meta.changes !== 1`）並發 unban 仲裁 → 回 not-banned 400
- `safeUserAudit` critical（`admin.user.unbanned`）+ `auditDomainEventEmitted`（post-commit best-effort，redact，失敗不擋 200）

## 改動（純 type-only，1 處）

- **line 25 handler context** → Convention A inline：
  ```ts
  export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })
  ```
- `params: Record<string, string>`：採 PR-2g 已確立的 repo 慣例（**7 處先例**：`ban.ts` / `tenants/[tenantId]/wallet.ts` / `tenants/[tenantId]/members/index.ts` / `tenants/[tenantId]/entitlements.ts` / `requisition/[id].ts` / `admin/requisitions/[id]/delete.ts` / `admin/requisitions/[id]/save.ts`）。不用 `{ id: string }`（架構一致性 > 收窄；`parseInt(params.id, 10)` 在兩型別下皆相容）。
- `Env` / `Request` 為 ambient global（ban.ts 同樣不 import 即用，同目錄、同 tsconfig，已證可編譯）。

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- **current ratchet state**：errorCount **1113 → 1110**、errorFiles 127 → 126、cleanFiles **177 → 178**（淨降剛好 3）。
- baseline file（`types/typecheck-baseline.json`）不變，保留舊天花板 errorCount 1119 / cleanFiles 175（reduce PR 不跑 `--update`；ratchet 仍 enforce：current ≤ ceiling 且 cleanFiles ≥ floor）。

## Tier / 風險

- **Tier-0 auth / account-state mutation 熱區**：改動純 handler context 型別，TS erase 後 runtime 行為**零變化**。
- **coding verify 點**：`params: Record<string, string>` 與 `parseInt(params.id, 10)` 相容（`params.id: string`）。7 處先例已證 inline annotation 不依賴 `PagesFunction` / `EventContext`，無型別衝突。

## 驗證計劃（coding 階段）

- `RATCHET_BASE_REF=2264529 npm run typecheck:ratchet` green（current 1113→1110 / 177→178）
  - 本機 base 用 main SHA，避免 branch 無 commit 時 HEAD~1 false-RED。
- `npm run lint` green、`npm run build:functions` green
- `npx vitest run --config vitest.workers.config.js tests/integration/admin-users.test.ts` green（Codex 鎖：account-state mutation runtime 驗證）
- 全 `tsc` 確認**只降這 3、tests-leaf 0 cascade**
- **硬驗收**：source diff **僅 handler context 1 行**；SQL / CAS / emit（`emitAccountReenabled`）/ hash-chain audit / `safeUserAudit` / `auditDomainEventEmitted` **byte-identical**；mutation **零行改動**。

## 流程定位

- auth 熱區 mutating → **full 四檢查點 + codex chain**（plan-gate = 本 doc + local diff；code-gate = 實際 source diff）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge。
