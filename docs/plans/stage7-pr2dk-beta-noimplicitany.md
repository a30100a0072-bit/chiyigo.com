# Stage 7 PR-2dk β — noImplicitAny 續清（misc leaf β cluster：auth/logout + auth/refresh）

**狀態**：PLAN_DRAFT（Phase 1；SPEC_APPROVED＝Option A / params-only，owner 2026-07-03）｜**gate-log 待補**（4 道外部審查軌跡）
**base**：`5be20373`（origin/main）｜**source commit**：待 CODING_ALLOWED 後產
**性質**：純 type-only noImplicitAny 標註（12 → 0）、byte-identical emit 2/2、零 runtime / 零 schema/API/migration。

> ⚠ `auth/logout.ts` ≠ `auth/devices/logout.ts`（後者 α/PR-2dj 已 SHIPPED，本棒未碰）。

---

## 1. Scope 與 locks

**SCOPE-1**：僅 2 source
- `functions/api/auth/logout.ts`（server-side logout：token_hash→family ref、GLOBAL live-head COUNT、casByFamily 撤 + emit session.revoked、>1-head fail-closed）
- `functions/api/auth/refresh.ts`（refresh token rotation：grace-orphan 分類、family-revoke、device 綁定、單一 atomic rotation batch、簽發新 access token）

**12 noImplicitAny → 0**：TS7031×8（handler-ctx destructure：4 handler × {request,env}）+ TS7006×4（parseCookieHeader `header`/`name` × 2 檔）。

**Edit locks**：
- EDIT-1 handler-ctx `{ request, env }: { request: Request; env: Env }`（×4：logout O/P、refresh O/P）
- EDIT-2 `parseCookieHeader(header: string | null, name: string)`（×2、**兩檔原地標註**）
- EDIT-3 `Env` ambient、禁 import

**Block locks**：
- BLOCK-1 禁 env.d.ts
- BLOCK-2 禁 parseCookieHeader 抽取 / 禁 shared cookie util（dup 兩份原地、列 backlog；抽取＝behavior-adjacent scope creep、屬另案）
- BLOCK-3 禁改 test
- BLOCK-4 禁 γ（`utils/backchannel.ts`/`utils/revocation.ts`）、禁 jti OD（`string | null | undefined` 屬 γ/PR-2dl）
- BLOCK-5 **禁 parseCookieHeader 顯式 return type**（SPEC Option A params-only；回傳交 inference＝`string | null`）
- BLOCK-6 禁 row-map（本棒 2 檔無 row-map callback）、禁任何 runtime logic / behavior diff

**ARCH locks（① ChatGPT `CHATGPT_ARCH_APPROVED_WITH_LOCKS`，2026-07-03）**：
- ARCH-L1 source code 只允許改 `logout.ts`、`refresh.ts`。
- ARCH-L2 final source diff 只有 6 個 approved annotation site，不得新增 return type。
- ARCH-L3 `parseCookieHeader` 不得抽取、不建 shared util、不改 regex、不改 call site。
- ARCH-L4 不得改 `Env` 宣告 / env.d.ts / row-map / jti OD / migration / schema / test expectation。
- ARCH-L5 CODE stage 必重證 forced tsc set-diff：REMOVED=12、ADDED=0；若 ADDED>0 回退。
- ARCH-L6 CODE stage 必重證兩檔 byte-identical emit 且 non-empty。
- ARCH-L7 final packet 必把 `source name-status=2` 與 `governance companion plan doc=1` 分開列，不得宣稱 source 3 檔。
- ARCH-L8 `oauth/end-session.ts:63` 第三份 parseCookieHeader 只列 backlog、不得併入本棒。
- ARCH-L9 flaky `jwt.test.ts:33` 不得作本棒 failure，除非能以本 diff 穩定重現。

## 2. Edit matrix（6 edit site）

| # | file:line | cleared | form |
|---|---|---|---|
| 1 | logout.ts:29 | TS7031×2 | `onRequestOptions({ request, env }: { request: Request; env: Env })` |
| 2 | logout.ts:33 | TS7031×2 | `onRequestPost({ request, env }: { request: Request; env: Env })` |
| 3 | logout.ts:119 | TS7006×2 | `parseCookieHeader(header: string \| null, name: string)` |
| 4 | refresh.ts:48 | TS7031×2 | `onRequestOptions({ request, env }: { request: Request; env: Env })` |
| 5 | refresh.ts:52 | TS7031×2 | `onRequestPost({ request, env }: { request: Request; env: Env })` |
| 6 | refresh.ts:413 | TS7006×2 | `parseCookieHeader(header: string \| null, name: string)` |

SSOT：
- handler-ctx 對齊 **89** shipped siblings（exact 2-field 字串 `{ request, env }: { request: Request; env: Env }` @ base `5be20373`；如 α `admin/revoke.ts:49`、`tenants/index.ts:22/49`，兩檔 handler 皆無 `params`）。
- `parseCookieHeader` 的 `header: string | null` ＝ `Headers.get()` 精確回傳型別（call site：logout:41、refresh:55 皆 `parseCookieHeader(request.headers.get('Cookie'), 'chiyigo_refresh')`）；`name: string`（call 端字面值 `'chiyigo_refresh'`）。回傳型別 infer `string | null`（`strict:false` → 無 noUncheckedIndexedAccess → `match[1]` 為 `string`）。

## 3. 證據（scout 實測 @ working-tree overlay，已還原；CODE stage 於 source commit 重證）

- **forced tsc** `tsc -b tsconfig.solution.json --pretty false --force`：**530 → 518**、REMOVED=12（set-diff 精確＝那 12 條 TS7031/TS7006）、**ADDED=0**（set-diff、非算術；含 dual-leaf test 檔全域）。errorFiles 35→33、cleanFiles 300→302。baseline `1119/175` frozen（reduce 禁 --update）。
- **byte-identical**（canonical `esbuild --loader=ts --format=esm` stdin、非空、防空字串 trap）：2/2 MATCH — logout `38d0a417f67cdee1`/3016B · refresh `f8766503e02e7173`/13429B（orig HEAD:blob == 標註版）。
- **name-status（預期）**：僅 2 source code 檔（+ 本 plan doc companion，per stage7 慣例、α #134 同型）。

**dual-leaf assignable（type-level importers）**：
- `logout.ts` → 唯一 type-level importer＝`tests/integration/event-outbox-emission.test.ts`（直接呼叫 `logoutHandler({ request: req, env })`）。
- `refresh.ts` → `tests/integration/refresh.test.ts`（直接 ×6）、`rate-limit-e3.test.ts`（直接 ×3）、`jwt-sid-claim.test.ts`（經 `callFunction`）。
- `callFunction`（`_helpers.ts:324`）handler 參數自身未標型別（tests project `noImplicitAny:false`→`any`）→ 對其呼叫免 assignability 檢查、免疫。
- 直接呼叫端物件字面值恰為 `{ request, env }`（無多餘屬性→無 excess-property check）；`env` 來自 `cloudflare:test`＝`ProvidedEnv extends Env`（`types/env.d.ts:112-115`）→ 結構 assignable 到 `env: Env`。無 production cross-import。**已被 ADDED=0 坐實**。

**F-3 DORMANT-safe**：2 檔 0 命中 archive / R2 / retention / aggregate / checkpoint；`safeUserAudit` transitive cold_class feed 之 args byte-identical（type-only）→ dormant 未改未 invoke。

## 4. 本地機械 gate（CODE stage 實跑、全綠才往下）— pending
`typecheck:ratchet`（518）· `lint` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions`（含完整 `npm run build`：chains lint:migrations/handlers/archive）· `npm audit --omit=dev --audit-level=high`。
> reviewer 於 test:int 並行時**勿跑 `tsc --force`**（避 Miniflare 飢餓假 flake）。known flaky `jwt.test.ts:33`（~1.6%/run）非本棒引入 → CI 撞到 rerun。

## 5. Dual Gate v3.1 — 4 道外部審查 — pending
- ① ChatGPT Architecture `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（2026-07-03；0 blocker / 0 required / 3 NB；8 審查面全 PASS：SPEC fidelity / scope / Convention A / parseCookieHeader lean / Pages contract / refresh-logout 安全面 / dup 治理 / plan-doc companion）→ ARCH-L1..L9（見 §1）。NB：dup 3-份描述已修正 / plan doc 保治理檔身分不算 source scope 擴張 / Codex Plan 仍須 replay 驗 TS2345·TS2353=0 新增。
- ② Codex Plan `CODEX_PLAN_APPROVED`（2026-07-03；0 blocking / 0 required）：隔離 overlay replay 坐實 base `5be20373`、530→518、REMOVED=12（TS7031=8/TS7006=4）、ADDED=0、TS2345/TS2353=0 新增、byte-identical logout 3016B/refresh 13429B hash 相符、numstat 3/3·3/3、僅 6 annotation site 無 return type、`oauth/end-session.ts:63` 仍 backlog、source/governance doc 分離維持。
- ③ Codex Code — pending
- ④ ChatGPT Faithfulness — pending

**維度 A self-review**：
- PLAN（L3-security fail-safe、3 readonly-reviewer：SPEC-scope-fidelity / behavior-preservation-security / type-cascade-naming-SSOT）→ 結果待填。
- CODE（L3、reviewer 維度待 CODE stage）→ 待填。
- 主線親裁（非採 raw）。

## 6. OD 狀態
β **零新型別 OD**。jti null-union OD（`string | null | undefined`）屬 γ/PR-2dl（BLOCK-4 明禁未碰）。parseCookieHeader return type 由 owner 裁 **params-only**（BLOCK-5）。

## 7. 非 blocking notes
- **NB-1**：parseCookieHeader 為 byte-identical 內聯 dup，全 repo 共 **3 份**（本棒 2 檔 `logout.ts:119`/`refresh.ts:413` ＋ 範圍外 `oauth/end-session.ts:63`，後者亦 untyped、屬 oauth 域後續棒次）。本棒僅在 logout/refresh 兩份**原地標註**、end-session 份未碰；抽取為 shared util（須涵蓋 3 份）列 backlog（另案 Dual Gate；behavior-adjacent、非本棒）。
- **NB-2**：shipped 集＝2 source + 本 plan doc（governance companion，per stage7 慣例）；SPEC「two source files」指 source code 檔，plan doc 非「unrelated churn」。owner CODE 前可否決。

## 8. 後續棒次（misc leaf 續清）
- **PR-2dl γ**：`utils/backchannel.ts` + `utils/revocation.ts`（13、util params + **jti OD `string | null | undefined`**）。
- 之後：requireRole 12（TS7053）· auth 7（TS7018）· oauth 105 · audit 381（含 F-3 DORMANT 殿後）。
