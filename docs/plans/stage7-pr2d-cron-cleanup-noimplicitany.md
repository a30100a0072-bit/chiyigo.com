# Stage 7 — PR-2d：functions `noImplicitAny` reduce — `admin/cron/cleanup.ts`（destructive cron，FULL）

> 狀態：**plan 階段**（本檔即 plan-gate 標的；0 行 source 已 committed）。
> Base：main `4f5f78f`（baseline `1133/133/171`，ratchet 綠）。
> 動工分級：**L1 機械型遷移**（type-only，runtime 0 變更）**＋ FULL 四檢查點**（owner-ruled）。**為何 full（非 lighter）**：cleanup.ts 是每日 D1 GC cron，blast radius 硬——多表 `DELETE`（含 refresh_tokens / revoked_jti session·revocation）＋ `payment_intents` `pending→canceled` 狀態轉換。即使本批 diff 預期僅 2 行 handler annotation，full plan-gate 用於留下「SQL / TASKS / status transition byte-identical」的 governance receipt。
> 上位 plan：`docs/plans/stage7-strict-zero-error.md` §6 per-flag ladder。模板：Convention A（PR-2a 起）。

## scope
- **In**：`functions/api/admin/cron/cleanup.ts`（2 errors，皆 line 82 handler binding `{ request, env }`）。
- **Out（→ audit codex chain，另開 full chain）**：`admin/cron/audit-archive.ts`(73)、`audit-aggregate.ts`(13)、`audit-aggregate-debug.ts`(13)、`audit-aggregate-archive-debug.ts`(2)、`audit-aggregate-archive-telemetry.ts`(2)。

## 1. 唯一 source edit
```
- export async function onRequestPost({ request, env }) {
+ export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
```
Convention A inline handler shape（global `Env` + WebWorker `Request`）。type-erased、不轉 function→const、無 `:any`/suppression。

## 2. 必須逐字不碰（byte-identical；governance receipt 核心）
- `const TASKS = [...]` 整個陣列（11×`DELETE` + 1×`UPDATE payment_intents status='canceled'`）的**所有 SQL 字串**。
- `CRON_SECRET` auth gate（`env.CRON_SECRET` / `Bearer` 比對 / 401 / 500）。
- `for (const task of TASKS)` loop + try/catch（`e.message` 已 compile，不需動）。
- `r.meta?.changes`、`totalDeleted` 累加、`results.push(...)`。
- response shape `res({ ok: true, totalDeleted, results })`。

## 3. gates（code 階段實跑）
- `typecheck:ratchet`（reduce → 綠；base=main `4f5f78f`，避 HEAD~1 陷阱用 `RATCHET_BASE_REF`）+ `lint` + `build:functions`。
- **cron/cleanup tests：已 grep `tests/`（import / `admin/cron/cleanup` / `totalDeleted` / `stale_pending_24hr`）= 0 命中 → 無 dedicated test 可跑**（明確記錄）。`baseline:update` 收編。
- 無 cache-bust（functions-only type-only）。

## baseline delta（spike 已實測，已 revert）
errorCount `1133→1131`、errorFiles `133→132`、cleanFiles `171→172`。spike：套 annotation → `tsc -p tsconfig.functions.json` → cleanup.ts **0 error**、全量 **1131**（無 `env:Env` row-access cascade）→ `git checkout --` revert。

## merge path
normal squash-merge（reduce，無 override）；四檢查點 → owner 明示同意 → `gh pr merge --squash --delete-branch`。無 migration/D1/secret → auto-deploy 行為 no-op。
