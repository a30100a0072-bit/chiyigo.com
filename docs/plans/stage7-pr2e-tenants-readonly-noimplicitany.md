# Stage 7 — PR-2e：functions `noImplicitAny` reduce — tenants read-only GET ×3（Tier-0, FULL）

> 狀態：**plan 階段**（本檔即 plan-gate 標的；0 行 source 已 committed）。
> Base：main `d2cbf65`（baseline `1131/132/172`，ratchet 綠）。
> 動工分級：**L1 機械型遷移**（type-only，runtime 0 變更）**＋ FULL 四檢查點**（Tier-0 tenant isolation：read-only 也不 routine；全 3 handler 被 test 直接呼叫）。
> 上位 plan：`docs/plans/stage7-strict-zero-error.md` §6。模板：Convention A（PR-2a 起）+ deals generic-callback ruling（PR-2c）。

## scope（owner-ruled：3 read-only GET 投影；mutating IAM 全 defer）
- **In（3 檔 / 12 err，全 GET，tenant-scoped 投影）**：
  - `functions/api/tenants/[tenantId]/entitlements.ts`（4）
  - `functions/api/tenants/[tenantId]/wallet.ts`（4）
  - `functions/api/tenants/[tenantId]/members/index.ts`（4）
- **Defer → PR-2f+（mutating IAM，逐批更嚴）**：`tenants/index.ts`（建 tenant）、`invitations/index.ts`、`invitations/[invitationId]/revoke.ts`、`members/[userId]/[action].ts`、`members/[userId]/role.ts`、`auth/org-switch.ts`（session/current-tenant 切換）。

## 1. source edits（每檔 2 處 = handler + `r` 投影 callback；共 6 處）
| 檔 | handler | row callback |
|---|---|---|
| entitlements.ts | `({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })` | `(r: Record<string, unknown>)` @ `.map` |
| wallet.ts | 同上 | `(r: Record<string, unknown>)` @ quotas `.map` |
| members/index.ts | 同上 | `(r: Record<string, unknown>)` @ members `.map` |

- `r` 一律 **generic `Record<string, unknown>`**（owner-ruled，沿用 deals PR-2c）：**不 assert** entitlement/quota/membership/role 任何欄位語意；既有 `Number()/String()` 投影 coercion 不變。
- members/index.ts 的 `(await listPendingInvitations(...)).map((i) => …)` 之 `i` **已具型別**（util 回傳型別）→ 非 error、不碰。

## 2. 明確逐字不碰（byte-identical；Tier-0 receipt 核心）
- **tenant guards / active membership / personal-owner guard**：`resolveIssuanceContextForTenant`（entitlements/wallet）、`requireActiveTenantRole`（members/index）呼叫與分支全不動。
- **billing-capable role check**（wallet.ts `BILLING_CAPABLE_ROLES.has(ctx.platform_role)`）不動。
- **`params.tenantId` 解析 + 正整數驗證**、**deny-path audit write**（members/index `member.denied`）、**所有 SQL**、**response shape**（`{ entitlements }` / `{ wallet, quotas }` / `{ members, pending_invitations }`）、**`Number(walletRow.balance)` 等投影 coercion** —— 全 byte-identical。
- **`wallet.ts:36` stale 註解**（「端點 env 無型別」typed env 後略 stale）：**本 PR 不動**（owner-ruled，記為 post-strict cleanup debt；`.first<T>()` 仍不採用、`Number()` 不變）。

## 3. gates（code 階段實跑）
- `typecheck:ratchet`（reduce → 綠；base=main `d2cbf65`，避 HEAD~1 用 `RATCHET_BASE_REF`）+ `lint` + `build:functions`。
- **direct-call integration suites（存在，必跑）**：`billing-endpoints`（entitlements）、`credit-endpoints`（wallet）、`member-endpoints`（members/index）、`tenant-foundation`（tenants/org-switch coverage）。
- `baseline:update` 收編。無 cache-bust（functions-only type-only）。

## 4. baseline delta + plan-stage full-solution spike（已實測，已 revert）
- 預測：errorCount `1131→1119`、errorFiles `132→129`、cleanFiles `172→175`。
- **spike**（套全 3 檔 → `rm -rf .tscache && tsc -b tsconfig.solution.json`）：全量 **1119**（=1131−12）、**tests leaf 0 error**（3 handler 皆 direct-call，excess-property 已證無）、3 target 檔 0 error、0 非 `functions/` 路徑 diagnostic → `git checkout --` revert。**無 `env:Env` row-access cascade**（`walletRow.balance` 等存取不受 typed env 影響）。

## merge path
normal squash-merge（reduce，無 override）；FULL 四檢查點 → owner 明示同意 → `gh pr merge --squash --delete-branch`。無 migration/D1/secret → auto-deploy 行為 no-op。
