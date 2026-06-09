# Stage 7 reduce PR-2j — tenants invitations create/revoke noImplicitAny

**目標**：`functions/api/tenants/[tenantId]/invitations/index.ts`（建立邀請）＋ `functions/api/tenants/[tenantId]/invitations/[invitationId]/revoke.ts`（撤銷邀請）共 **10 個 noImplicitAny error → 0**，**純 type-only**（handler context + `emitDenied` helper param annotation）。**Tier-0 tenant-boundary + RBAC + member-lifecycle 熱區**（hard-revoke gate evidence、pending-row CAS、cross-tenant guard）→ full 四檢查點 + codex chain。

tenants mutating IAM 6 檔的**第二批**（Codex 建議序：tenants-create〔PR-2i ✅〕→ **invitations×2〔本 PR〕** → members-action·role → org-switch/billing）。base main `7df27ae`（接 PR-2i）。

## Scope 決定：併一個 PR（PR-2j）

兩檔同域（tenant invitations）、同改動型態（handler ctx inline + `emitDenied` helper）、皆 mutating IAM、皆由**同一 test 檔** `member-endpoints.test.ts` direct-import。revoke 風險模型（pending-row CAS + `tenant_id` cross-tenant guard）與 create（`createInvitation` durable row + best-effort email）略異，但 annotation 改動結構相同且皆 type-only trivial。→ 併一個 PR。memory batch 描述亦明列「invitations×2」。

## Scout（對抗式驗證）

`npx tsc -b tsconfig.solution.json` 實證，**本 PR target scope 涵蓋 10 errors / 2 files / 4 sites**（repo 另有大量既有 ratchet errors、不在本 PR 範圍；本表僅列 target scope），皆 TS7031/TS7006 pure noImplicitAny，無其他型別點、無 cascade：

| file | line:col | code | 位置 |
|---|---|---|---|
| index.ts | (25,39) | TS7031 | `onRequestPost` handler context `request` |
| index.ts | (25,48) | TS7031 | `onRequestPost` handler context `env` |
| index.ts | (25,53) | TS7031 | `onRequestPost` handler context `params` |
| index.ts | (95,27) | TS7006 | helper `emitDenied(env, …)` param `env` |
| index.ts | (95,32) | TS7006 | helper `emitDenied(…, request, …)` param `request` |
| revoke.ts | (18,39) | TS7031 | `onRequestPost` handler context `request` |
| revoke.ts | (18,48) | TS7031 | `onRequestPost` handler context `env` |
| revoke.ts | (18,53) | TS7031 | `onRequestPost` handler context `params` |
| revoke.ts | (56,27) | TS7006 | helper `emitDenied(env, …)` param `env` |
| revoke.ts | (56,32) | TS7006 | helper `emitDenied(…, request, …)` param `request` |

（其餘 `emitDenied` 參數 `userId: number` / `tenantId: number` / `reasonCode: string` 已具型別、不動。）

⚠ 同次 tsc 另列 `functions/api/invitations/accept.ts`（4 errors）——**不同 route（公開 accept 端點、非 `tenants/` 子樹）、不在本批 Codex 建議序、明確排除、本 PR 不碰**。

## 端點性質

- **POST `/api/tenants/:tenantId/invitations`**（index.ts）：**mutating** — owner/admin invite member by email。`requireActiveTenantRole` LIVE re-check（hard-revoke enforcement：suspended/demoted actor 立即 deny）；strict body allowlist（`email`/`platform_role`）；per-user RL（`member_invite` 60s/30）；durable invitation row 先建，email best-effort（`AbortSignal` bound、send 失敗不 rollback、owner 可 resend）；`member.invited` audit + domain event emit（PR5 5b）。
- **POST `/api/tenants/:tenantId/invitations/:invitationId/revoke`**（revoke.ts）：**mutating** — revoke pending invite。`requireActiveTenantRole` LIVE re-check；domain CAS 內含 `tenant_id` cross-tenant guard（wrong `:tenantId` → `not_found`，永不洩漏他 tenant 的 invite）；per-user RL（`member_mutate` 60s/60）；`invitation.revoked` audit。

## 改動（純 type-only，4 sites / 10 bindings）

**index.ts**
1. **line 25 `onRequestPost` handler context** → `({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })`
2. **line 95 helper `emitDenied`** → `(env: Env, request: Request, userId: number, tenantId: number, reasonCode: string)`

**revoke.ts**
3. **line 18 `onRequestPost` handler context** → `({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })`
4. **line 56 helper `emitDenied`** → `(env: Env, request: Request, userId: number, tenantId: number, reasonCode: string)`

- **`params: Record<string, string>`**：兩檔皆有動態段（`[tenantId]` / `[invitationId]`）→ 採 repo 慣例 `Record<string, string>`（ban/unban + 8 處先例；**勿用** `{ tenantId: string }` / `{ invitationId: string }`，求架構一致）。
- **`Env` / `Request` 為 ambient global**（`types/env.d.ts:21` `interface Env`；ban.ts 等不 import 即用、同 tsconfig 已證可編譯）。
- **`emitDenied(env: Env, …)`**：`env` 傳入 `safeUserAudit(env, …)`；ban/tenants-index 已證 `safeUserAudit(env: Env, …)` 相容（結構型別 superset，不 reject）。
- body 內 `params?.tenantId` / `params?.invitationId` 讀取 **byte-identical**（僅加 annotation，不動 `?.` 或邏輯；`Number(string | undefined)` 合法、無 cascade）。

## 不碰（byte-identical）

**index.ts**
- `requireActiveTenantRole(MANAGER_ROLES)` gate + gate-fail `emitDenied`
- `checkRateLimit` / `recordRateLimit`（`member_invite`）
- JSON parse + `ALLOWED_BODY_KEYS` strip-unknown + `email`/`platform_role` 型別檢查
- **`createInvitation(db, { tenantId, email, platformRole, invitedByUserId })` 整段**
- switch `result.outcome`：`created`（201 + `member.invited` audit + `auditDomainEventEmitted` + best-effort `sendInvitationEmail` w/ `AbortController` timeout）/ `already_member`（409）/ `tenant_ineligible`（422）/ `invalid|default`（400/500）
- 所有 `safeUserAudit` / `emitDenied`（`member.denied` warn）/ SQL / response shapes / HTTP status

**revoke.ts**
- `requireActiveTenantRole` gate + gate-fail `emitDenied`
- `checkRateLimit` / `recordRateLimit`（`member_mutate`）
- **`revokeInvitation(db, { tenantId, invitationId, actorUserId })` 整段**（pending-row CAS + `tenant_id` cross-tenant guard）
- switch：`revoked`（200 + `invitation.revoked`）/ `not_pending`（409）/ `not_found`（404）/ `invalid|default`（400/500）
- 所有 `safeUserAudit` / `emitDenied` / SQL / response / HTTP status

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `7df27ae` `--report` 實測現況：errorCount **1103** / errorFiles **125** / cleanFiles **179** / sourceFilesTotal **304**。
- 本 PR 後 **current ratchet state**：errorCount **1103 → 1093**（−10）、errorFiles **125 → 123**（−2）、cleanFiles **179 → 181**（+2；兩檔全清入 cleanFiles）、sourceFilesTotal 304 不變。
- baseline file（`types/typecheck-baseline.json`）不變，保留天花板 errorCount 1119 / cleanFiles 175（reduce PR 不跑 `--update`）。

## Tier / 風險

- **Tier-0 tenant isolation + RBAC + member-lifecycle 熱區**：改動純參數型別，TS erase 後 runtime 行為**零變化**。
- **tests-leaf 0 cascade（機制 + 先例雙證）**：`member-endpoints.test.ts` 的 `call()` helper（line 35）將 handler 收為 `(ctx: unknown) => unknown`，且 Stage 7 目前**僅開 `noImplicitAny`、`strict`（含 `strictFunctionTypes`）仍 false** → 參數 bivariant 比對，typed handler 仍 assignable，不產生 tests-leaf error。PR-2i 將 `createTenant` 以**相同型態** typed、**同 test 檔**、0 cascade 已證。
- **`params: Record<string, string>`**：body 讀 `params?.tenantId` / `params?.invitationId` 不需 narrowing（`Number(string | undefined)` 合法；ban/unban 先例同）。若任一 site 觸發 cascade（unlikely），退回該 site 收窄並重驗。

## 驗證計劃（coding 階段）

- `RATCHET_BASE_REF=7df27ae npm run typecheck:ratchet` green（current 1103→1093 / errorFiles 125→123 / cleanFiles 179→181）
  - 本機 base 用 main SHA，避免 branch 無 commit 時 HEAD~1 false-RED（[[feedback_ratchet_local_base_ref]]）。
- `npm run lint` green、`npm run build:functions` green
- 整合測試（grep 證實**唯一** direct-import 本兩 handler 的 test 檔）：`tests/integration/member-endpoints.test.ts`
  - **invite 段**（`describe POST /api/tenants/:tenantId/invitations (invite)`）：owner invites → 201 + `member.invited` + pending row / non-member actor → 403 + `member.denied`（gate-failure evidence）/ plain member → 403 + `member.denied`（owner/admin only）/ SUSPENDED member → 403 + `member.denied`（hard-revoke evidence）/ unknown body field → 400。
  - **revoke 段**（`describe member mutations + role`，line 236）：revoke pending invite → 200 + `invitation.revoked`。
  - 跑：`npx vitest run --config vitest.workers.config.js tests/integration/member-endpoints.test.ts`
  - **測試覆蓋誠實**（PR-2i Codex Low finding 教訓）：上列為 endpoint 測例**實跑**分支。invite 的 `already_member`(409) / `tenant_ineligible`(422) / `bad_field_type` / `rate_limited`(429) / `invalid` 與 revoke 的 `not_pending`(409) / `not_found`(404) / `rate_limited` / `invalid` 分支**無 endpoint 測例 → code-gate 報告不宣稱實跑**（本 PR type-only TS-erase 不碰任何分支）。
- 全 `tsc` 確認**只降這 10、tests-leaf 0 cascade**。
- **硬驗收**：source diff **僅 4 sites / 純 type annotation**；`createInvitation` / `revokeInvitation` / 所有 audit（`member.invited` / `invitation.revoked` / `member.denied`）/ domain event emit / RL / SQL **byte-identical**；mutation **零行邏輯改動**；ratchet 淨降剛好 **10** 無 cascade。

## 流程定位

- Tier-0 tenant-boundary + RBAC + member-lifecycle mutating → **full 四檢查點 + codex chain**（plan-gate = 本 doc + local diff；code-gate = 實際 source diff）。
- 後續批次（不在本 PR）：members-action·role 小批 → org-switch/billing（依 Codex 建議序，逐批 full）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy，補 credential-free prod smoke（mutating POST 帶 `Content-Type: application/json`，否則被全域 CSRF/ct-guard 擋成 415 而非 auth 401）。
