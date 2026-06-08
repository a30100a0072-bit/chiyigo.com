# Stage 7 reduce PR-2g — admin/users/[id]/ban.ts noImplicitAny

**目標**：`functions/api/admin/users/[id]/ban.ts` 3 個 noImplicitAny error → 0，純 type-only handler context annotation。**auth 熱區 mutating endpoint** → full 四檢查點 + codex chain。

## Scout（對抗式驗證）

- **3 errors 全在 handler context**（bare `tsc -b tsconfig.solution.json`）：
  - `(22,39)` TS7031 `request` implicit any
  - `(22,48)` TS7031 `env` implicit any
  - `(22,53)` TS7031 `params` implicit any
  - 無其他型別點（無 map callback / 無 evolving-any）。
- **mutation 邏輯逐行確認、全部不碰**：
  - `requireRole` + `effectiveScopesFromJwt` scope 守門
  - `parseInt(params.id)` + self-ban guard + role-level guard（`actorOutranksTarget` / `isKnownRole` / `safeRoleString`）
  - hash-chain `appendAuditLog`（fail → 拒絕，不允許「動作成功但無證據」）
  - **atomic batch**（順序固定，不可重排）：CAS `UPDATE users SET status='banned', token_version=token_version+1 WHERE id=? AND status!='banned'` → `emit.statements`（`emitAccountDisabled`）→ `UPDATE refresh_tokens SET revoked_at WHERE revoked_at IS NULL`
  - 0-row CAS 並發雙 ban 仲裁
  - `safeUserAudit` critical + `auditDomainEventEmitted`（post-commit best-effort）

## 改動（純 type-only，1 處）

- **line 22 handler context** → Convention A inline：
  `export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: { id: string } })`
  - `params: { id: string }`：`[id]` 單段動態路由，只用 `params.id`（`parseInt(params.id, 10)`）。本批首個帶 `params` 的 inline annotation。

## 不碰（byte-identical）

- atomic batch（CAS `UPDATE users` / `emit.statements` / refresh revoke）、`token_version + 1`、hash-chain audit、domain event emit（`emitAccountDisabled` / `auditDomainEventEmitted`）、所有 role / scope / self guard、所有 SQL、`crypto.randomUUID()` / `new Date().toISOString()` 副作用注入。

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- **current ratchet state**：errorCount 1116 → **1113**、cleanFiles 176 → **177**（淨降 3）。
- baseline file（`types/typecheck-baseline.json`）不變，保留舊天花板（reduce PR 不跑 `--update`）。

## Tier / 風險

- **Tier-0 auth / account-state mutation 熱區**：改動純 handler context 型別，TS erase 後 runtime 行為**零變化**。
- **coding verify 點**：`params: { id: string }` 與 `parseInt(params.id, 10)` 相容（params.id: string）。若 Pages 型別系統對 inline params 有衝突（unlikely，inline 不依賴 `PagesFunction` / `EventContext`），退 `params: Record<string, string>`。

## 驗證計劃（coding 階段）

- `RATCHET_BASE_REF=727d53f npm run typecheck:ratchet` green（current 1116→1113 / 176→177）
- `npm run lint` green、`npm run build:functions` green
- 全 `tsc` 確認**只降這 3、tests-leaf 0 cascade**
- **硬驗收（Codex 鎖）**：SQL / CAS / audit / event emit **byte-identical**（diff 僅 handler context 1 行）

## 流程定位

- auth 熱區 mutating → **full 四檢查點 + codex chain**（plan-gate = 本 doc；code-gate = 實際 diff）。
- 與 `unban.ts` **分開**（unban 風險模型不同：狀態轉回 active、不 bump `token_version`、不碰 refresh token）。
