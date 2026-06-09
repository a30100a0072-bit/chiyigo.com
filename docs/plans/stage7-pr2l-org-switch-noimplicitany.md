# Stage 7 reduce PR-2l — auth/org-switch noImplicitAny

**目標**：`functions/api/auth/org-switch.ts`（切換 active tenant、重發 access token）**2 個 noImplicitAny error → 0**，**純 type-only**（單一 handler context site）。**Tier-0 tenant-boundary + auth-context 敏感**（tenant switch、token re-issuance、membership active check、fail-closed issuance、audit、rate limit）→ full 四檢查點 + codex chain。

tenants mutating IAM 6 檔的**末批（第 6 / 6）**（Codex 建議序：tenants-create〔PR-2i ✅〕→ invitations×2〔PR-2j ✅〕→ members-action·role〔PR-2k ✅〕→ **org-switch/billing〔本 PR〕**）。base main `2904462`（接 PR-2k）。本 PR ship 後 tenants mutating IAM 批次清零。

## Scope：單檔單 PR（PR-2l）

只有 `auth/org-switch.ts` 一檔、**1 site / 2 bindings**（handler context `request`/`env`）。**無 `emitDenied` helper**（本檔 audit 為 inline `safeUserAudit`，非透過 helper）；**無 `params`**（route 是 flat `auth/org-switch.ts`、無動態段、handler 只用 `{ request, env }`）。是本 reduce 系列**迄今最小**的一筆。

## Scout（對抗式驗證）

`npx tsc -b tsconfig.solution.json` 實證，**本 PR target scope 涵蓋 2 errors / 1 file / 1 site**（repo 另有大量既有 ratchet errors、不在本 PR 範圍），皆 TS7031 pure noImplicitAny，無其他型別點、無 cascade：

| file | line:col | code | 位置 |
|---|---|---|---|
| org-switch.ts | (22,39) | TS7031 | `onRequestPost` handler context `request` |
| org-switch.ts | (22,48) | TS7031 | `onRequestPost` handler context `env` |

（handler body 內 `body`/`claims` 已具型別〔`unknown` / `Record<string, unknown>`〕、`targetTenantId` narrowing 已存在、`safeUserAudit`/`signJwt`/`resolveIssuanceContextForTenant` 皆已 typed import；無其他 implicit-any。）

## 端點性質

- **POST `/api/auth/org-switch`**：**mutating（token re-issuance）**，chiyigo control-plane only。`requireRegularAccessToken`（內含 `requireAuth` aud=`chiyigo` gate，擋 RP aud / temp_bind / step-up token）；per-user RL（`org_switch` 60s/20）；strict body validation（`tenant_id` 必 number + `Number.isSafeInteger` + 正整數，拒型別強制轉型）；`resolveIssuanceContextForTenant` **fail-closed**（tenant active + membership active + personal owner guard + role 由 DB 推導，禁信 client）；重發 token 明確 `audience: 'chiyigo'`、**不 spread 舊 payload**（避免帶舊 jti/iat/exp/aud），保留 `amr`/`acr`（present 才帶）；**不改 refresh token**（PR1 決策 D）；audit `tenant.switch.deny`（warn）/ `tenant.switch.success`。

## 改動（純 type-only，1 site / 2 bindings）

1. **line 22 `onRequestPost` handler context** → `({ request, env }: { request: Request; env: Env })`

- **無 `params`**（flat auth route；handler body 不使用 `params`）→ ctx 只列 `{ request, env }`（沿 PR-2i tenants/index 無-params 慣例）。
- **`Env` / `Request` 為 ambient global**（`types/env.d.ts:21` `interface Env`；同 tsconfig 已證可編譯）。

## 不碰（byte-identical）

- `requireRegularAccessToken(request, env)` gate（`error` 短路）
- `checkRateLimit` / `recordRateLimit`（`org_switch` 60s/20）
- body JSON parse（`INVALID_JSON` 400）+ non-object guard（400）+ `tenant_id` 嚴格型別檢查（`number` + `Number.isSafeInteger` + `>0`，拒 `"1"`/`true`/`[1]`/`1.5`/`0`/`-1`/`null` → 400 `ERR_VALIDATION`）
- **`resolveIssuanceContextForTenant(db, userId, targetTenantId)` fail-closed invariant 整段**（deny → `tenant.switch.deny` audit + 403 `TENANT_SWITCH_DENIED`，不洩 reason）
- claims 重建（明確 9 欄、`audience: 'chiyigo'`、`amr`/`acr` 條件帶、不 spread 舊 payload）+ `signJwt(claims, '15m', env, { audience: 'chiyigo' })`
- `tenant.switch.success` audit（`from_tenant_id` / `to_tenant_id` / `platform_role`）+ 成功 response（`access_token` / `tenant_id` / `platform_role`）
- 所有 `safeUserAudit` / SQL / response shapes / HTTP status

## 預期 ratchet（措辭依 [[feedback_ratchet_current_vs_baseline_file]]）

- clean main `2904462` `--report` 實測現況：errorCount **1083** / errorFiles **121** / cleanFiles **183** / sourceFilesTotal **304**。
- 本 PR 後 **current ratchet state**：errorCount **1083 → 1081**（−2）、errorFiles **121 → 120**（−1）、cleanFiles **183 → 184**（+1；本檔全清入 cleanFiles）、sourceFilesTotal 304 不變。
- baseline file（`types/typecheck-baseline.json`）不變，保留天花板 errorCount 1119 / cleanFiles 175（reduce PR 不跑 `--update`）。

## Tier / 風險

- **Tier-0 tenant isolation + auth-context 敏感熱區**（token re-issuance、membership active check、fail-closed issuance）：改動純參數型別，TS erase 後 runtime 行為**零變化**。
- **tests-leaf 0 cascade（機制 + 先例雙證）**：`_helpers.ts:322` `callFunction(handler, request)` 的 `handler` 為**未標型別（implicit any）** → typed handler 傳入 `any` 參數**無任何 contravariance 問題**（比 `(ctx: unknown)` 更寬鬆）。PR-2i 將 tenants/index handler 以**相同 `{ request, env }` 型態** typed、**同 test 檔** `tenant-foundation.test.ts`、0 cascade 已證（PR-2i 整合 53/53）。
- 若觸發 cascade（unlikely），退回收窄並重驗。

## 驗證計劃（coding 階段）

- `RATCHET_BASE_REF=2904462 npm run typecheck:ratchet` green（current 1083→1081 / errorFiles 121→120 / cleanFiles 183→184）
  - 本機 base 用 main SHA，避免 branch 無 commit 時 HEAD~1 false-RED（[[feedback_ratchet_local_base_ref]]）。
- `npm run lint` green、`npm run build:functions` green
- 整合測試（grep 證實 direct-import 本 handler 的 test 檔）：`tests/integration/tenant-foundation.test.ts`（`import { onRequestPost as orgSwitch }`）
  - **實跑分支**：happy active member → 200 + 正確 `tenant_id`/`platform_role` + **JWT claim wiring e2e**（`tenant.switch.success`）／suspended tenant → 403 `TENANT_SWITCH_DENIED`／非 member（forged tenant_id）→ 403／suspended membership → 403／進他人 personal tenant → 403／`tenant_id` 非嚴格正整數 → 400 `ERR_VALIDATION`（8 種 bad value）／temp_bind token → 403 `NOT_A_REGULAR_TOKEN`／step-up（elevated:*）→ 403 `NOT_A_REGULAR_TOKEN`／非 chiyigo aud → 401（requireAuth aud gate）。
  - 跑：`npx vitest run --config vitest.workers.config.js tests/integration/tenant-foundation.test.ts`
  - **測試覆蓋誠實**（PR-2i Codex Low finding 教訓）：上列為 endpoint 測例**實跑**分支（涵蓋 happy + **4 switch-deny 情境**〔suspended tenant / 非 member / suspended membership / 他人 personal，皆 403 `TENANT_SWITCH_DENIED`〕 + 型別驗證 + 2 token-class gate〔temp_bind / step-up，403 `NOT_A_REGULAR_TOKEN`〕 + aud gate〔401〕，覆蓋面廣）。**不宣稱實跑**（無 endpoint 測例）：`rate_limited`(429)、`INVALID_JSON`(400)、non-object-body(400)。本 PR type-only TS-erase 不碰任何分支。
- 全 `tsc` 確認**只降這 2、tests-leaf 0 cascade**。
- **硬驗收**：source diff **僅 1 site / 純 type annotation**；`requireRegularAccessToken` / `resolveIssuanceContextForTenant` fail-closed / claims 重建 / `signJwt` audience / RL（org_switch）/ 所有 audit（`tenant.switch.deny`/`tenant.switch.success`）/ SQL **byte-identical**；token re-issuance **零行邏輯改動**；ratchet 淨降剛好 **2** 無 cascade。

## 流程定位

- Tier-0 tenant-boundary + auth-context（token re-issuance）mutating → **full 四檢查點 + codex chain**（plan-gate = 本 doc + local diff；code-gate = 實際 source diff）。
- **本 PR ship 後 tenants mutating IAM 6 檔批次清零**。下一階段（不在本 PR）：依 migration 大序，functions 其餘 noImplicitAny（低敏感 utils → **auth-core**〔jwt/crypto/siwe/scopes/password/role-change/rate-limit，每次確認〕→ 熱區 codex chain）→ functions 清零後開 `strict:true` → scripts → tests → browser。
- merge：squash-merge，**owner 明示同意後**才執行，無 auto-merge；merge 後監看 CI+Deploy，補 credential-free prod smoke（POST 帶 `Content-Type: application/json`，否則被全域 CSRF/ct-guard 擋成 415 而非 auth 401）。
