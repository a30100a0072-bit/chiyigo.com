# Stage 7 reduce PR-2i — tenants/index.ts noImplicitAny

**目標**：`functions/api/tenants/index.ts` 7 個 noImplicitAny error → 0，**純 type-only**（handler context + map callback + helper param annotation）。**Tier-0 tenant-boundary + idempotency 敏感**（建 organization tenant、durable idempotency）→ full 四檢查點 + codex chain。

tenants mutating IAM 6 檔的**第一批**（Codex 建議序首位、最敏感、單檔成 PR）。base main `f156092`（接 PR-2h）。

## Scout（對抗式驗證）

`npx tsc -b tsconfig.solution.json` 實證，**7 errors / 4 sites**，無其他型別點、無 cascade：

| line:col | code | 位置 |
|---|---|---|
| (22,38) | TS7031 | `onRequestGet` handler context `request` |
| (22,47) | TS7031 | `onRequestGet` handler context `env` |
| (39,45) | TS7006 | GET projection `.map((r) => …)` callback `r` |
| (49,39) | TS7031 | `onRequestPost` handler context `request` |
| (49,48) | TS7031 | `onRequestPost` handler context `env` |
| (104,27) | TS7006 | helper `emitDenied(env, …)` param `env` |
| (104,32) | TS7006 | helper `emitDenied(…, request, …)` param `request` |

（其餘 `emitDenied` 參數 `userId: number` / `action: string` / `reasonCode: string` 已具型別、不動。）

## 端點性質

- **GET `/api/tenants`**：read-only，列 caller 的 active tenant memberships（tenant switcher 資料源）。
- **POST `/api/tenants`**：**mutating** — 建 organization tenant（creator 成首位 active `tenant_owner`），**DURABLE idempotency**（same key + same name → replay 同 tenant_id + `org.create.replay` audit；same key + different name → 409 conflict）。

## 改動（純 type-only，4 處）

1. **line 22 GET handler context** → `({ request, env }: { request: Request; env: Env })`
2. **line 39 map callback** → `.map((r: Record<string, unknown>) => …)`（沿 PR-2e tenants read-only 投影慣例；`r.id`/`r.type`/… 為 `unknown`，純複製到 response projection，無語意 assert）
3. **line 49 POST handler context** → `({ request, env }: { request: Request; env: Env })`
4. **line 104 helper `emitDenied`** → `(env: Env, request: Request, userId: number, action: string, reasonCode: string)`

- 無 `params`（`/api/tenants` index route 無 `[tenantId]` 動態段；兩 handler 只用 `{ request, env }`）。
- `Env` / `Request` 為 ambient global（ban.ts 等同樣不 import 即用、同 tsconfig，已證可編譯）。
- `emitDenied(env: Env, …)`：`env` 傳入 `safeUserAudit(env, …)`；ban.ts 已證 `safeUserAudit(env: Env, …)` 相容（結構型別，`Env` 為 superset 不會 reject）。

## 不碰（byte-identical）

- `requireRegularAccessToken` auth、`checkRateLimit` / `recordRateLimit`（member_mutate RL window 60s/max 30）
- JSON parse + `ALLOWED_BODY_KEYS` strip-unknown + `name`/`idempotency_key` 型別檢查
- **`createOrgTenant(db, { name, creatorUserId, idempotencyKey })` 整段** —— durable idempotency 核心邏輯
- switch `result.outcome`：`created`(201+`org.created`) / `replay`(200+`org.create.replay`) / `conflict`(409) / `contention`(503) / `invalid|default`(400/500)
- `safeUserAudit` 所有呼叫、`emitDenied` audit（`member.denied` warn）、所有 SQL、response shapes、HTTP status

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- **current ratchet state**：errorCount **1110 → 1103**、errorFiles 126 → 125、cleanFiles **178 → 179**（淨降剛好 7）。
- baseline file（`types/typecheck-baseline.json`）不變，保留天花板 errorCount 1119 / cleanFiles 175（reduce PR 不跑 `--update`）。

## Tier / 風險

- **Tier-0 tenant isolation + idempotency 熱區**：改動純參數型別，TS erase 後 runtime 行為**零變化**。
- **coding verify 點**：`r: Record<string, unknown>` projection 不需 narrowing（`res({ tenants })` 接受寬 body，PR-2e wallet/entitlements/members 已證）；`emitDenied(env: Env, …)` → `safeUserAudit` 相容（precedent ban.ts）。若任一 site 觸發 cascade（unlikely），退回該 site 收窄/調整並重驗。

## 驗證計劃（coding 階段）

- `RATCHET_BASE_REF=f156092 npm run typecheck:ratchet` green（current 1110→1103 / 178→179）
  - 本機 base 用 main SHA，避免 branch 無 commit 時 HEAD~1 false-RED。
- `npm run lint` green、`npm run build:functions` green
- 整合測試（兩檔皆 direct-import 本檔 handler，grep 證實）：
  - `tests/integration/tenant-foundation.test.ts` — `import { onRequestGet as listTenants }`（GET membership list + cross-tenant guard + token-class guard）
  - `tests/integration/member-endpoints.test.ts` — `import { onRequestPost as createTenant }`（POST create / replay / conflict / contention runtime 驗證）
  - 跑：`npx vitest run --config vitest.workers.config.js tests/integration/tenant-foundation.test.ts tests/integration/member-endpoints.test.ts`
- 全 `tsc` 確認**只降這 7、tests-leaf 0 cascade**
- **硬驗收**：source diff **僅 4 處 type annotation**；`createOrgTenant` / idempotency switch / 所有 audit / SQL / RL **byte-identical**；mutation **零行邏輯改動**。

## 流程定位

- Tier-0 tenant-boundary + idempotency mutating → **full 四檢查點 + codex chain**（plan-gate = 本 doc + local diff；code-gate = 實際 source diff）。
- 後續批次（不在本 PR）：invitations×2 → members-action·role → org-switch/billing（依 Codex 建議序，逐批 full）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge。
