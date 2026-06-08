# Stage 7 reduce PR-2f — admin/users.ts read-only noImplicitAny

**目標**：`functions/api/admin/users.ts` 的 3 個 noImplicitAny error → 0，純 type-only annotation，行為 / SQL / 權限 byte-identical。Warm restart after wrangler/Node20 infra detour（PR-W1/W2）。

## Scout（對抗式驗證）

- **read-only GET 確認**：`onRequestGet`，只有 `SELECT COUNT(*)` + `SELECT ... users`，**零 INSERT/UPDATE/DELETE**。
- **3 errors 精確定位**（bare `tsc -b tsconfig.solution.json`）：
  - `(22,38)` TS7031 `request` implicit any（handler context）
  - `(22,47)` TS7031 `env` implicit any（handler context）
  - `(66,37)` TS7006 param `u` implicit any（map 投影 callback）
- **`bindings = []`（line 39）不報**：evolving-any array，後續 push 全是 string → TS 推成 `string[]`，無需碰。印證「3 errors」精確、非 4。

## 改動（純 type-only，2 處）

1. **line 22 handler context** → Convention A inline（`PagesFunction`/`EventContext` 不在 scope）：
   `export async function onRequestGet({ request, env }: { request: Request; env: Env })`
2. **line 66 map callback** → owner-ruled generic（同 PR-2e 投影 callback）：
   `(rows.results ?? []).map((u: Record<string, unknown>) => ({ ... }))`

## 不碰（byte-identical）

- 所有 SQL：line 54（COUNT）、line 57–62（users SELECT + LIMIT/OFFSET）。
- `requireAnyScope(... ADMIN_USERS_READ, ADMIN_USERS_WRITE)` 權限邏輯。
- 分頁（page/limit/offset clamp）、LIKE `ESCAPE '\'` 邏輯、DTO 投影欄位與 `email_verified === 1` 轉換。

## 預期 baseline

- errorCount 1119 → **1116**
- errorFiles −1（admin/users.ts 移出 errored 集）
- cleanFiles 175 → **176**
- strict 仍 false（per-flag ladder，noImplicitAny only）

## Tier / 風險

- Tier-0 admin / IAM **read-only**：改動純型別，不動行為 / SQL / 權限邊界。
- **coding 階段 verify 點**：`u: Record<string, unknown>` 投影後，`res()` payload 的 unknown field 型別相容性。若 `res` 簽名對 unknown field 報新 error → 退用具體 row shape（`{ id: number; email: string; email_verified: number; role: string; status: string; created_at: string }`）。plan 預設先試 generic（與 PR-2e 一致）。

## 驗證計劃（coding 階段）

- `typecheck:ratchet` green（預期 errorCount 1116 / cleanFiles 176）
- `lint` green、`build:functions` OK
- 全 `tsc` 確認**只降這 3、無其他檔 cascade**（特別是 tests-leaf = 0 新 error）
- local-verify 用 `RATCHET_BASE_REF=1f2a3b8`（main HEAD；避 branch 無 commit 時 HEAD~1 false-RED）

## 流程定位

- admin / IAM read-only → 走 **full 四檢查點**（非 lighter；lighter 限 payment-adjacent read-only）。
- 含 Codex plan-gate（本 doc）+ code-gate（實際 diff）。
