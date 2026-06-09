# Stage 7 reduce PR-2k — tenants members action/role noImplicitAny

**目標**：`functions/api/tenants/[tenantId]/members/[userId]/[action].ts`（suspend/reactivate/offboard 成員）＋ `members/[userId]/role.ts`（變更成員 platform_role）共 **10 個 noImplicitAny error → 0**，**純 type-only**（handler context + `emitDenied` helper param annotation）。**Tier-0 tenant-boundary + RBAC + member state-transition 熱區**（owner-only、last-owner guard、self-guard、personal-tenant rejection、role escalation、domain event emit）→ full 四檢查點 + codex chain。

tenants mutating IAM 6 檔的**第三批**（Codex 建議序：tenants-create〔PR-2i ✅〕→ invitations×2〔PR-2j ✅〕→ **members-action·role 小批〔本 PR〕** → org-switch/billing）。base main `823c444`（接 PR-2j）。

## Scope 決定：併一個 PR（PR-2k）

兩檔同域（tenant member lifecycle / IAM）、同改動型態（handler ctx inline + `emitDenied` helper）、皆 **owner-only mutating** Tier-0、皆由**同一 test 檔** `member-endpoints.test.ts` direct-import（`memberAction` / `changeRole`）。Codex 建議序亦明列「members-action·role 小批」為一批。→ 併一個 PR。

⚠ **兩檔非完全對稱，逐檔精確 annotate**：`[action].ts` handler 是 `onRequestPost`、`emitDenied` **6 參數**（含 `action: string`）；`role.ts` handler 是 `onRequestPatch`（PATCH）、`emitDenied` **5 參數**（無 `action`，body 內硬編 `'role_change'`）。兩檔皆只需補 `env`/`request` 型別。

## Scout（對抗式驗證）

`npx tsc -b tsconfig.solution.json` 實證，**本 PR target scope 涵蓋 10 errors / 2 files / 4 sites**（repo 另有大量既有 ratchet errors、不在本 PR 範圍；本表僅列 target scope），皆 TS7031/TS7006 pure noImplicitAny，無其他型別點、無 cascade：

| file | line:col | code | 位置 |
|---|---|---|---|
| [action].ts | (23,39) | TS7031 | `onRequestPost` handler context `request` |
| [action].ts | (23,48) | TS7031 | `onRequestPost` handler context `env` |
| [action].ts | (23,53) | TS7031 | `onRequestPost` handler context `params` |
| [action].ts | (77,27) | TS7006 | helper `emitDenied(env, …)` param `env` |
| [action].ts | (77,32) | TS7006 | helper `emitDenied(…, request, …)` param `request` |
| role.ts | (20,40) | TS7031 | `onRequestPatch` handler context `request` |
| role.ts | (20,49) | TS7031 | `onRequestPatch` handler context `env` |
| role.ts | (20,54) | TS7031 | `onRequestPatch` handler context `params` |
| role.ts | (90,27) | TS7006 | helper `emitDenied(env, …)` param `env` |
| role.ts | (90,32) | TS7006 | helper `emitDenied(…, request, …)` param `request` |

（其餘 `emitDenied` 參數 `userId: number` / `tenantId: number` / `action: string`〔僅 [action].ts〕 / `reasonCode: string` 已具型別、不動。`denyResponse(result: MemberOutcome)` 已具型別、不動。）

⚠ 同 glob 命中的第三檔 `members/index.ts`（read-only GET members list）**已於 PR-2e 收齊、現 0 error**（tsc filter 證實只剩本兩檔）；不在本 PR。

## 端點性質

- **POST `/api/tenants/:tenantId/members/:userId/:action`**（[action].ts）：**mutating**，**owner-only**（`requireActiveTenantRole` LIVE re-check = hard-revoke enforcement）。`action ∈ {suspend, reactivate, offboard}`（未知 action → 404）；domain 層強制 **last-owner guard（statement-level）+ personal-tenant rejection + self-guard**；per-user RL（`member_mutate` 60s/60）；`member.suspended`/`member.reactivated`/`member.offboarded` audit + domain event emit（PR5 5b）。
- **PATCH `/api/tenants/:tenantId/members/:userId/role`**（role.ts）：**mutating**，**owner-only**（role escalation owner-only、arch §9「member cannot self-promote」）。strict body allowlist（`platform_role`）；domain 層 **block 降級最後一位 active owner + self-targeting**；`no_op`（role 已等於目標值 → idempotent 200、**不寫、不發 `member.role_changed` audit**）；per-user RL（`member_mutate` 60s/60）；`member.role_changed` audit + domain event emit。

## 改動（純 type-only，4 sites / 10 bindings）

**[action].ts**
1. **line 23 `onRequestPost` handler context** → `({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })`
2. **line 77 helper `emitDenied`** → `(env: Env, request: Request, userId: number, tenantId: number, action: string, reasonCode: string)`〔**6 參數**，保留 `action: string`〕

**role.ts**
3. **line 20 `onRequestPatch` handler context** → `({ request, env, params }: { request: Request; env: Env; params: Record<string, string> })`
4. **line 90 helper `emitDenied`** → `(env: Env, request: Request, userId: number, tenantId: number, reasonCode: string)`〔**5 參數**，無 `action`〕

- **`params: Record<string, string>`**：兩檔皆有動態段（`[tenantId]`/`[userId]`/`[action]`）→ 採 repo 慣例 `Record<string, string>`（ban/unban/invitations + 10 處先例；勿用 `{ tenantId/userId/action: string }`）。
- **`Env` / `Request` 為 ambient global**（`types/env.d.ts:21` `interface Env`；同 tsconfig 已證可編譯）。
- **`emitDenied(env: Env, …)`**：`env` 傳入 `safeUserAudit(env, …)`；ban/tenants-index/invitations 已證相容。
- body 內 `params?.tenantId` / `params?.userId` / `params?.action`（`String(params?.action ?? '')`）讀取 **byte-identical**（僅加 annotation，不動 `?.` / `??` / 邏輯；`Number(string | undefined)` / `String(string | undefined ?? '')` 合法、無 cascade）。

## 不碰（byte-identical）

**[action].ts**
- `requireActiveTenantRole(OWNER_ONLY)` gate + gate-fail `emitDenied`
- `ACTION_EVENT` lookup（unknown action → 404）、`checkRateLimit`/`recordRateLimit`（`member_mutate`）
- **`suspendMember` / `reactivateMember` / `offboardMember`（依 action dispatch）整段**
- `applied` 分支：`safeUserAudit`（eventType + 條件 `previous_role`/`platform_role`）+ `auditDomainEventEmitted(result.emitted)` + 200
- `denyResponse(result)` switch：`not_a_member`(404)/`illegal_transition`(409)/`last_owner_protected`(409)/`personal_tenant_immutable`(422)/`cannot_target_self`(409)/`invalid`(400)/default(500)
- 所有 `safeUserAudit` / `emitDenied`（`member.denied` warn）/ SQL / response shapes / HTTP status

**role.ts**
- `requireActiveTenantRole(OWNER_ONLY)` gate + gate-fail `emitDenied`
- `checkRateLimit`/`recordRateLimit`（`member_mutate`）、JSON parse + `ALLOWED_BODY_KEYS` strip-unknown + `platform_role` 型別檢查
- **`changeMemberRole(db, { tenantId, targetUserId, actorUserId, toRole })` 整段**
- `applied`（200 + `member.role_changed` audit + `auditDomainEventEmitted`）/ `no_op`（200 + `{ ok, no_op }`、**無 audit**）
- `denyResponse(result)` switch（同上 shape）；所有 `safeUserAudit` / `emitDenied` / SQL / response / HTTP status

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `823c444` `--report` 實測現況：errorCount **1093** / errorFiles **123** / cleanFiles **181** / sourceFilesTotal **304**。
- 本 PR 後 **current ratchet state**：errorCount **1093 → 1083**（−10）、errorFiles **123 → 121**（−2）、cleanFiles **181 → 183**（+2；兩檔全清入 cleanFiles）、sourceFilesTotal 304 不變。
- baseline file（`types/typecheck-baseline.json`）不變，保留天花板 errorCount 1119 / cleanFiles 175（reduce PR 不跑 `--update`）。

## Tier / 風險

- **Tier-0 tenant isolation + RBAC + member state-transition 熱區**（比 invitations 更熱：state machine、role mutation、self-targeting、last-owner protection、domain event emission evidence）：改動純參數型別，TS erase 後 runtime 行為**零變化**。
- **tests-leaf 0 cascade（機制 + 先例雙證）**：`member-endpoints.test.ts` 的 `call()` helper（line 35）將 handler 收為 `(ctx: unknown) => unknown`，且 Stage 7 目前**僅開 `noImplicitAny`、`strict`（含 `strictFunctionTypes`）仍 false** → 參數 bivariant 比對，typed handler 仍 assignable，不產生 tests-leaf error。PR-2i/2j 將同型態 handler typed、同 test 檔、0 cascade 已連續證實。
- **`params: Record<string, string>`**：body 讀 `params?.tenantId`/`params?.userId`/`String(params?.action ?? '')` 不需 narrowing（先例同）。若任一 site 觸發 cascade（unlikely），退回該 site 收窄並重驗。

## 驗證計劃（coding 階段）

- `RATCHET_BASE_REF=823c444 npm run typecheck:ratchet` green（current 1093→1083 / errorFiles 123→121 / cleanFiles 181→183）
  - 本機 base 用 main SHA，避免 branch 無 commit 時 HEAD~1 false-RED（[[feedback_ratchet_local_base_ref]]）。
- `npm run lint` green、`npm run build:functions` green
- 整合測試（grep 證實**唯一** direct-import 本兩 handler 的 test 檔）：`tests/integration/member-endpoints.test.ts`
  - **[action].ts（memberAction）實跑分支**：owner suspends → 200 + `member.suspended`／plain member cannot suspend → 403 + `member.denied`（owner-only gate）／owner offboards a SECOND owner → 200（≥1 owner remains）／owner offboarding SELF → 409 `CANNOT_TARGET_SELF`。
  - **role.ts（changeRole）實跑分支**：owner changes role → 200 + `member.role_changed`／same-role PATCH → 200 `no_op`（**NO** `member.role_changed` audit）。
  - 跑：`npx vitest run --config vitest.workers.config.js tests/integration/member-endpoints.test.ts`
  - **測試覆蓋誠實**（PR-2i Codex Low finding 教訓）：上列為 endpoint 測例**實跑**分支。**不宣稱實跑**（無 endpoint 測例 / 僅 domain-tested）：[action].ts 的 `reactivate` applied、`not_a_member`(404)、`illegal_transition`(409)、**`last_owner_protected`(409)〔plan §test NOTE：domain-tested，非 endpoint〕**、`personal_tenant_immutable`(422)、`rate_limited`(429)、`invalid`(400)、unknown action(404)；role.ts 的 role-endpoint gate-denial、`unknown_field`/`bad_field_type`(400)、`not_a_member`(404)、`illegal_transition`(409)、`last_owner_protected`(409)、`personal_tenant_immutable`(422)、`cannot_target_self`(409)、`rate_limited`(429)、`invalid`(400)。本 PR type-only TS-erase 不碰任何分支。
- 全 `tsc` 確認**只降這 10、tests-leaf 0 cascade**（`members/index.ts` 維持 0、僅本兩檔清零）。
- **硬驗收**：source diff **僅 4 sites / 純 type annotation**；`suspendMember`/`reactivateMember`/`offboardMember`/`changeMemberRole` / 所有 audit（`member.suspended`/`member.reactivated`/`member.offboarded`/`member.role_changed`/`member.denied`）/ domain event emit / RL / SQL **byte-identical**；`no_op` 路徑（不寫不 audit）/ `denyResponse` switch **byte-identical**；mutation **零行邏輯改動**；ratchet 淨降剛好 **10** 無 cascade。

## 流程定位

- Tier-0 tenant-boundary + RBAC + member state-transition mutating → **full 四檢查點 + codex chain**（plan-gate = 本 doc + local diff；code-gate = 實際 source diff）。
- 後續批次（不在本 PR）：org-switch/billing〔`auth/org-switch.ts`〕（tenants mutating IAM 最後一批，依 Codex 建議序，full）。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy，補 credential-free prod smoke（mutating POST/PATCH 帶 `Content-Type: application/json`，否則被全域 CSRF/ct-guard 擋成 415 而非 auth 401）。
