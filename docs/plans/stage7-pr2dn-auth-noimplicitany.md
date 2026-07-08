# Stage 7 PR-2dn — noImplicitAny 續清（misc cluster：`utils/auth` 收尾棒）

**狀態**：`CHATGPT_CODE_FAITHFULNESS_APPROVED_WITH_DOC_FIX`（**④ 2026-07-08**；**四道 gate 全過** @ commit `4c8e51f1`；待 owner merge token）
> **gate 進程**：① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`〔ARCH-L1..L10〕 → ② `CODEX_PLAN_APPROVED` → owner `CODING_ALLOWED` → CODE committed **`4c8e51f1`**〔11 edit；ARCH-L6 REPLAY @ final source：forced tsc set-diff **REMOVED=7 / ADDED=0**（fresh base via stash）+ byte-identical **auth.ts 7727 / requireRole.ts 1608 bytes**（stdin-pipe、non-vacuous）；ratchet 486/29/306；lint 0 / test:int 1328 pass / test:cov green / build 全過 / audit 0；CODE self-review 0 drift〕 → **③ `CODEX_CODE_APPROVED`**〔0 material；Codex live-repo 獨立驗〕 → **④ `CHATGPT_CODE_FAITHFULNESS_APPROVED_WITH_DOC_FIX`**〔FAITHFUL、0 scope creep / 0 plan drift / 0 Tier0-1 side-finding；1 required doc fix（本 commit 修）〕。**四道 gate 全過**；**待 owner merge token**（squash-merge）；未 push / 無 PR / 未 merge。
> **self-review 歷程（維度-A）**：R1 `wf_cf6df9c9-36a` **完整**=1 ACCEPTED〔NB-4 CI-ratchet 過度宣稱〕已修 + 12 refuted；R2 `wf_2fe9d88a-fec` session-limit **verifier 全 fail**〔5 finder tier3 doc-signal（`local/login` citation · step-up gate 列舉 · wrangler-vs-esbuild proxy · claim census）已修 + class-killer meta；high-risk finder 確認 idempotency/token_version 不變量 **HOLD**〕；R3 background `.mjs` 因 session cycling **三度 orphan** → 改 **foreground synchronous 3-lens 對抗式覆核**（security / correctness / scope-faithfulness，覆蓋全 7 維度 concern）= **0 material tier0-2 finding、CONVERGED**〔各 lens 0 accepted；scope reviewer 實跑 tsc 確認 REMOVED=7 / base 493 / 30 error-files〕+ 3 tier1/tier3 polish 已修。**① ChatGPT Arch Gate 2026-07-08 APPROVE**（ARCH-L1..L10；ARCH-L10 CLAIM-ALLOWLIST 見下）。
> **狀態 SoT**：本 header + 對應中文報告為當前 gate-state 權威。**已 CODING_ALLOWED**（owner 2026-07-08）→ CODE committed `4c8e51f1` → ③ `CODEX_CODE_APPROVED` → ④ `CHATGPT_CODE_FAITHFULNESS_APPROVED_WITH_DOC_FIX`；**尚未 push / PR / merge**（待 owner 明示 merge token）。

**base**：`885684bd`（origin/main，#139 PR-2dm requireRole SHIPPED 後）
**性質**：純 type-only noImplicitAny 標註（`auth.ts` **7 → 0**、`requireRole.ts` 維持 **0**）、byte-identical emit（esbuild before==after 已 transient 實證）、零 runtime / 零 schema / 零 API / 零 migration / 零部署面。**Tier-0 auth 核心邊界** → 型別只描述、runtime 一字不改。

**owner ruling（2026-07-07，pre-Plan-Gate）**：級別 **L2 + L3-security rigor**（type-only 契約標註、無新系統/schema/API/migration → 不跑 L3 11 步；但因觸 Tier-0 auth 核心 + 跨檔耦合，Plan Gate 用 L3 安全嚴格度審 + 維度-A multi-agent self-review）｜採 **Design A**｜`AuthedUser` **minimal consumed claims**｜允許 **邊界 cast + why-comment**｜允許觸 `requireRole.ts` **僅 line-99 cast**。

> ⚠ 本棒觸 **Tier 0 auth 核心**：`requireAuth` 幾乎被每個需認證 handler 呼叫。全部改動 type-only；auth 執行邏輯（banned / jti-revoke / token_version 比對 / scope gate / pre_auth 擋門 / step-up `consumeJtiOnce` atomic 一次性核銷 / temp_bind 擋門 / 非正整數 sub fail-closed）**禁改**。
> ⚠ 本棒收斂 **2dm ARCH-L7/L8 DEFER-LOCK** 交辦的 `requireAuth ↔ requireRole` forward-compat 耦合（同一語意邊界 narrow/cast）。

---

## 1. Scope 與 locks

**SCOPE（owner SCOPE-LOCK）**：**2 source**
- `functions/utils/auth.ts`（身份/授權原語：`requireAuth` / `requireScope` / `requireAnyScope` / `requireStepUp` / `requireRegularAccessToken` / `bumpTokenVersion` / `res`）
- `functions/utils/requireRole.ts`（**僅 line-99 一處 cast** — 收斂 2dm DEFER-LOCK 耦合；`requireRole` RBAC 判斷流程禁重寫）

**7 noImplicitAny → 0**（forced tsc 實證，非摘要；base `885684bd`）：**6 TS7018 + 1 TS7006**：

| code | loc | 位置 | 根因 |
|---|---|---|---|
| TS7018 | 30,14 | `requireAuth` 首個 `{ user: null }` return | `null` 字面量在 `noImplicitAny` + `strictNullChecks:false` 下 implicit-any；無顯式 return type 提供 contextual type（whack-a-mole：tsc 每 function 旗標一個代表性 null return〔loc 以 live tsc 為準、非必為原始碼第一個，如 requireStepUp 為 @209 非 @205〕；顯式 return type 一次涵蓋全部） |
| TS7006 | 109,40 | `bumpTokenVersion(db, …)` 的 `db` | 參數未標型 |
| TS7018 | 135,23 | `requireScope` `{ user: null }` | 同 @30 |
| TS7018 | 164,23 | `requireAnyScope` `{ user: null }` | 同 @30 |
| TS7018 | 209,23 | `requireStepUp` `{ user: null }` | 同 @30 |
| TS7018 | 300,23 | `requireRegularAccessToken` `{ user: null }` | 同 @30 |
| TS7018 | 300,35 | `requireRegularAccessToken` `{ userId: null }` | 同 @30 |

**Edit locks（11 physical edit：10 `auth.ts` + 1 `requireRole.ts`；#5a/#5b 為 NOTE-block 相鄰兩改，計 2 physical；清 7 錯、requireRole 維持 0）**：

| # | file:line（base `885684bd`） | cleared | form |
|---|---|---|---|
| 1 | auth.ts:17（scopes import 後，new） | — | `import type { JWTPayload } from 'jose'` |
| 2 | auth.ts:18（jose import 後、requireAuth 註解前，new） | — | `type AuthedUser = JWTPayload & { role?: string; email?: string; sid?: string; risk_score?: number; risk_factors?: string[]; risk_country?: string }` + 上帶 why-comment |
| 3 | auth.ts:27（requireAuth sig 收尾 `) {`） | TS7018 @30 | `): Promise<{ user: AuthedUser \| null; error: Response \| null }> {` |
| 4 | auth.ts:94（requireAuth 成功 return） | —（落地 cast） | `return { user: payload as AuthedUser, error: null }` + 上帶 SAFETY why-comment |
| 5a | auth.ts:107（stale NOTE） | — | 更新過時註解（「db 暫不標型別」→ 說明 `Env['chiyigo_db']` idiom / 為何非裸 `D1Database`） |
| 5b | auth.ts:109（bumpTokenVersion sig） | TS7006 @109 | `bumpTokenVersion(db: Env['chiyigo_db'], userId: number)` |
| 6 | auth.ts:133（requireScope sig） | TS7018 @135 | `…requiredScopes: string[]): Promise<{ user: AuthedUser \| null; error: Response \| null }> {` |
| 7 | auth.ts:162（requireAnyScope sig） | TS7018 @164 | `…acceptedScopes: string[]): Promise<{ user: AuthedUser \| null; error: Response \| null }> {` |
| 8 | auth.ts:202（requireStepUp sig 收尾 `) {`） | TS7018 @209 | `): Promise<{ user: AuthedUser \| null; error: Response \| null }> {` |
| 9 | auth.ts:298（requireRegularAccessToken sig） | TS7018 @300×2 | `…env: Env): Promise<{ user: AuthedUser \| null; userId: number \| null; error: Response \| null }> {` |
| 10 | requireRole.ts:99（成功 return） | —（防 ADDED） | `return { user: user as RoleCheckedUser, error: null }` + 上帶 why-comment |

**Block locks（owner ruling 2026-07-07 落地）**：

- **SCOPE-LOCK**：只允許改 `functions/utils/auth.ts`、`functions/utils/requireRole.ts`（+ 本 plan doc companion，per stage7 慣例）。**禁改** caller（35+ requireAuth importer）、test、schema、migration、`env.d.ts`（`Env` ambient / `Response`/`Request` global 無需補宣告）、`jwt.ts`（`verifyJwt` 回傳 `JWTPayload` 已足）。
- **TYPE-LOCK**：只新增 type-only import（`import type { JWTPayload }`）、1 module-local type alias（`AuthedUser`）、5 return type、1 參數型別（`db`）、2 type assertion。
- **RUNTIME-LOCK**：`auth.ts` / `requireRole.ts` esbuild emit 必 **byte-identical**（before==after）；**禁改任何 auth runtime expression**（`startsWith('Bearer ')` / `verifyJwt` / `payload.status==='banned'` / `isJtiRevoked` / `payload.scope` gate / `token_version` 比對 / `isElevatedScope` / `hasExactScopeInToken` / `consumeJtiOnce` / `Number(user.sub)` fail-closed / `res(...)` / requireRole `KNOWN_ROLES.has` / `?? -1` / `?? Infinity`）。
- **CLAIM-LOCK**：`AuthedUser` custom claim = **封閉 allowlist**（ARCH-L10），**僅** `role / email / sid / risk_score / risk_factors / risk_country`（+ 標準 claim 承 `JWTPayload`）。**禁全列** chiyigo 自訂 claim、**禁增列未消費 claim**（避免擴大長期型別承諾）。**minimality 由封閉 allowlist + §2 逐 claim sink justification + source review 該 type alias 保證，非委由 ADDED=0**（ADDED=0 只證 sink 覆蓋、不證無多列）。
- **CAST-LOCK**：`payload as AuthedUser`（requireAuth 成功 return）與 `user as RoleCheckedUser`（requireRole:99）**必附 why-comment**；cast 只反映既有 JWT custom claim 契約、不新增 runtime 語意。禁 `as any` / 雙重 cast。**CODE stage cast why-comment 禁含 esbuild legal/annotation magic token**（`@license` / `@preserve` / `@__PURE__` / `//!` / `/*!`）——否則 esbuild 保留該註解 → 破 byte-identical（維度-A R3 tier1 note；本棒 comment 為中英散文不含此類，ARCH-L6 REPLAY 亦攔）。
- **DB-LOCK**：`db` 型別用 **`Env['chiyigo_db']`**（既有 12 檔 idiom）；**禁裸 `D1Database`**（source `.ts` 不可解析 → TS2552 + eslint `no-undef`）。
- **COUPLING-LOCK**：`requireRole.ts` 觸檔**僅 line-99 cast**；`requireRole` 的 role 檢查流程（`KNOWN_ROLES.has` gate / `ROLE_LEVEL` 階層 / `?? -1` / `?? Infinity` / `safeUserAudit` critical）**禁重寫**。重證 requireRole 仍 0 錯 / byte-identical。
- **TEST-LOCK**：forced tsc set-diff 為 ADDED=0 權威證據：**REMOVED=7 / ADDED=0**（含 dual-leaf tests-leaf 全域）；byte-identical 為 RUNTIME-LOCK 權威。CODE stage 於 final source commit **重跑**（禁沿用 scout/transient overlay）。
- **SECURITY-LOCK**：banned / jti revoke / token_version / scope / step-up `consumeJtiOnce` atomic 一次性核銷 / requireStepUp `for_action` action-binding（auth.ts:224 `user.for_action !== requiredAction` → STEP_UP_ACTION_MISMATCH）/ missing-jti reject（auth.ts:266）/ consume-backend fail-closed（auth.ts:269 `!env?.chiyigo_db` → 503 STEP_UP_CONSUME_UNAVAILABLE）/ P2-4 role-drift 重驗（auth.ts:256 `row.role !== user.role`）/ `claim.ok` 核銷結果閘（auth.ts:278）/ temp_bind / 非正整數 sub fail-closed / `bumpTokenVersion` 的 `token_version += 1` + refresh_token revoke batch 寫 等 auth runtime **一字不動**（byte-identical 坐實）。

> **清單權威來源（維度-A R2 存證 + ① ARCH-L10 收斂）**：**RUNTIME-LOCK / SECURITY-LOCK 的 runtime-expression 清單** 為**示意非窮舉**（結尾「等 / …」）——完整性權威＝**byte-identical esbuild emit（§3.C，全檔 diff）**：任一未列出 expression 若被更動 emit diff 立即非 0，type-only 則全 erase → 0 diff。**但 CLAIM-LOCK 的 `AuthedUser` custom claim list 是封閉 allowlist、非 illustrative**（ARCH-L10）：**ADDED=0 forced-tsc set-diff（§3.A）只證 consumed sink 全覆蓋**（無 claim 少列 / 誤型；含未在 §3.B census 的 permissive sink：`org-switch` 重簽 payload、`safeUserAudit(entry:any)` 等）**，不證 minimality**——多列一個未消費 claim 亦可 ADDED=0。故 claim-set minimality 由**封閉 allowlist（ARCH-L10）+ §2 逐 claim sink justification（每 claim 對到實際 consuming sink）+ source review 該 type alias** 保證。

**ARCH locks（① `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 2026-07-08 逐字落地）**：

| Lock | 內容 |
|---|---|
| ARCH-L1 SCOPE | CODE 僅可改 `auth.ts` + `requireRole.ts`（line-99）；禁 caller / test / schema / migration / `env.d.ts` / `jwt.ts`。 |
| ARCH-L2 RUNTIME | 禁改任何 auth / RBAC runtime expression（見 RUNTIME-LOCK / SECURITY-LOCK 清單）。 |
| ARCH-L3 TYPE | 鎖 `AuthedUser`（JWTPayload & minimal claims）、`db: Env['chiyigo_db']`、5 return type。 |
| ARCH-L4 CLAIM | `AuthedUser` 僅 `role/email/sid/risk_score/risk_factors/risk_country`（minimal）。 |
| ARCH-L5 CAST | 2 處 cast 必附 why-comment；禁 `as any`。 |
| ARCH-L6 TEST/REPLAY | CODE source commit 必重跑 forced tsc set-diff（`REMOVED=7 / ADDED=0`）+ byte-identical（禁沿用 transient）。（prose 亦以「ARCH-L6 REPLAY」引用此鎖） |
| ARCH-L7 COUPLING | `requireRole.ts` 僅 line-99 cast；收斂 2dm ARCH-L7/L8 DEFER-LOCK。 |
| ARCH-L8 DB | `db` 用 `Env['chiyigo_db']`；禁裸 `D1Database`。 |
| ARCH-L9 DOC-HYGIENE | 進 ② 前更新 header 狀態；stale NOTE @107 同步更新。 |
| ARCH-L10 CLAIM-ALLOWLIST | `AuthedUser` custom claim list 是**封閉 allowlist**（只 `role/email/sid/risk_score/risk_factors/risk_country`）、**非** illustrative；ADDED=0 只證 consumed sink 覆蓋、不證無多列 claim（多列未用 claim 亦可 ADDED=0）→ minimality 由封閉 allowlist + §2 per-claim sink justification + source review 保證。RUNTIME/SECURITY runtime-expression 清單仍可 illustrative（byte-identical 為完整性權威）。 |

## 2. SSOT 對齊（每個型別決策的真相源）

- **`AuthedUser = JWTPayload & { role?, email?, sid?, risk_score?, risk_factors?, risk_country? }`**：
  - `verifyJwt`（jwt.ts:181）回傳 jose `JWTPayload`（`sub?/iss?/aud?/jti?/exp?/…` + `[propName]: unknown` index sig）。requireAuth 現況 caller-visible `user` collapse 成 **`any`**，純因 `{ user: null }` 分支 implicit-any 汙染 inferred return type（非 verifyJwt 無型）。
  - **minimal claim 逐一對 sink**（CLAIM-LOCK；每 claim 都由 §3 Design B cascade 實測反推）：
    - `role?: string` ← `admin/audit.ts:134 canRoleSeeAuditEvent(_, user.role)`（string 參數）+ requireRole 74/79/89（`KNOWN_ROLES.has` / `safeRoleString` / `ROLE_LEVEL[...]`）+ requireRole 99 `RoleCheckedUser.role`。
    - `email?: string` ← `webauthn/register-options.ts:44,45 user.email ?? String(userId)`（string sink）。
    - `sid?: string` ← `elevation.ts:31 sidFromUser(user: { sid?: unknown })` weak-type（JWTPayload 無 `sid` 具名 prop → TS2559；enumerate `sid` 即共有 prop）。
    - `risk_score?: number` / `risk_factors?: string[]` / `risk_country?: string` ← `2fa/verify.ts:59-60 riskClaims`（`respondWithToken` 要 `{ score:number; factors:string[]; country:string }`）。
  - 其餘 claim（`scope/status/ver/for_action/email_verified/amr/acr/token_version(N/A JWT)/…`，含 `org-switch`/`userinfo` 等經 index-sig 讀取者）**不 enumerate**：承 `JWTPayload` index sig → `unknown`，sink 全吃 unknown/any（`===` 比較 / `Number(unknown)` / `Number.isFinite(unknown)` / `typeof x==='string'` narrow / `effectiveScopesFromJwt(Record<string,unknown>)`）→ **ADDED=0 為此「非列舉」決策的 sink 覆蓋權威**（證無漏列任何需 enumerate 的 typed-sink claim；compiler-as-oracle；**非** minimality 權威，見上「清單權威來源」註 + ARCH-L10）。
  - **tenant claim（`tenant_id` / `platform_role`）刻意不 enumerate**（維度-A self-review tier3 clarify，Tier-0 isolation 存證）：access token 雖內嵌 tenant claim（`functions/api/auth/local/login.ts` 經 `resolveActiveTenantClaims` 簽入；用全路徑避免與 `game/login.ts` basename 歧義），但 **tenant 授權一律由 DB membership row 每請求重推導、禁信 token claim**（`tenant-context.ts:150/160/182`）；全 `functions/` 唯一讀 JWT tenant claim 處＝`org-switch.ts:82 from_tenant_id: user.tenant_id ?? null`（純 audit 資訊、非授權輸入）。留 `unknown` 對 **Tier-0 tenant isolation 零影響**（byte-identical 坐實），且合 CLAIM-LOCK minimal 原則。
- **`db: Env['chiyigo_db']`（非裸 `D1Database`）**：裸 `D1Database` 在 source `.ts` 不可解析（**TS2552** + eslint `no-undef`，§3 Design B 實測）——`env.d.ts` 用 `D1Database` 僅因它是 `.d.ts` 走 `skipLibCheck` 不檢查其 body。`Env['chiyigo_db']` 是 **既有 12 檔 idiom**，透過 `Env` interface indexed access 拿到 binding 型別、不引入裸 identifier。本棒採 **inline form** 對齊 `ai/assist.ts:235` / `rate-limit.ts:83` / `brute-force.ts:42`（皆 inline `db: Env['chiyigo_db']`）；`billing.ts:22` / `credit.ts:23` 等用 `type ChiyigoDb = Env['chiyigo_db']` alias 變體（單參數 inline 免建 module-local alias、非不一致）。[[feedback_d1database_resolves_any_no_workers_types]] / [[feedback_util_env_param_pick_not_full_env]]。
- **`payload as AuthedUser`（requireAuth 成功 return 邊界 cast）**：`payload: JWTPayload`（`role` 等自訂 claim 走 index sig = `unknown`）→ 收斂成 `AuthedUser` 宣告的具體型別需 narrow → `as` 邊界 cast（`AuthedUser` assignable to `JWTPayload` ∴ downcast 合法）。**honest**：`verifyJwt` 已對 token 做密碼學驗章（ES256 + iss/aud gate），token 由 chiyigo 自簽（`signJwt`）→ claim 形狀由簽發端契約保證；cast 只把「我方簽發契約」告知 compiler，**不弱化任何 runtime 驗證**。why-comment 鎖語意。
- **`user as RoleCheckedUser`（requireRole:99）**：TS2322 精確訊息＝「`role` **optional** in `AuthedUser` but **required** in `RoleCheckedUser`」（optional-vs-required 結構規則，與 SNC 無關）。cast **安全**：line-74 `KNOWN_ROLES.has(user.role)` gate 已保證 role 為已知 string（未過則上方已 403 return），正是 `RoleCheckedUser`（=「已過 KNOWN_ROLES gate 的 user」）語意。此即 2dm §5 forward-compat note 交辦「同一語意邊界 narrow/cast」。
- **5 個 return type 顯式化**：TS7018 根因＝`{ user: null }` 的 `null` 在 `noImplicitAny`+`strictNullChecks:false` 下 implicit-any。顯式 return type 提供 contextual type，**一次涵蓋該 function 內所有 null return**（避免 whack-a-mole）。requireRegularAccessToken 額外含 `userId: number | null`（fail 回 `userId: null`、成功回 `Number(user.sub)`）。

## 3. 證據（scout transient overlay 實測 @ working-tree `885684bd`，已 `git checkout --` 還原、tree clean；CODE stage 於 source commit 重證）

**A. forced tsc set-diff** — `npx tsc -b tsconfig.solution.json --pretty false --force`：
- base error set = **493**（= ratchet report 493/30/305）。
- 套 Design A 之 **type-affecting 10 edit**（scout overlay；§1 的 #5a stale-NOTE 更新為 comment-only、不入 overlay 亦不影響 set-diff → CODE plan 共 11 physical）→ **486**；set-diff **REMOVED=7**（精確那 7 條：6×TS7018 + 1×TS7006）/ **ADDED=0**（含 dual-leaf tests-leaf 全域；[[feedback_tsc_forced_solution_dual_leaf_error_count]]）。errorFiles 30→29、cleanFiles 305→306（CODE stage 重跑確認）。baseline `1119/175` frozen（reduce 禁 `--update`）。

**B. cascade 收斂實證（compiler 當 oracle）** — 中途以 **Design B（`user: JWTPayload` 裸型）** 探得 15 個 cascade site，Design A 之 minimal claim + `Env['chiyigo_db']` + requireRole cast 逐一中和至 ADDED=0：

| Design B cascade site | claim → sink | Design A 中和 |
|---|---|---|
| auth.ts:110 TS2552 + eslint | 裸 `D1Database` 不可解析 | `db: Env['chiyigo_db']`（DB-LOCK） |
| requireRole 74 | `KNOWN_ROLES.has(user.role)` role:unknown | `role?: string`（SNC-off ≈ string） |
| requireRole 79 | `safeRoleString(user.role)` | `role?: string` |
| requireRole 89 | `ROLE_LEVEL[user.role]` index | `role?: string` |
| requireRole 99 | `{ user }` → `RoleCheckedUser`（optional-vs-required） | line-99 `as RoleCheckedUser`（COUPLING-LOCK） |
| elevation.ts:149 / exchange:33 / password:34 / totp:32 / oauth-init:139 | `sidFromUser(user)` weak-type `{ sid?:unknown }` | `sid?: string`（共有 prop 消 TS2559） |
| 2fa/verify:102,132 | `riskClaims` factors/country unknown | `risk_factors?: string[]` / `risk_country?: string` / `risk_score?: number` |
| webauthn/register-options:44,45 | `user.email ?? String(userId)` string sink | `email?: string` |
| admin/audit:134 | `canRoleSeeAuditEvent(_, user.role)` | `role?: string` |

> 15 site（含 dual-leaf ×2 = 30 line）→ Design A ADDED=0。requireRole 74/79/89 由 `role?: string` 自動變綠（SNC-off `string|undefined ≈ string`），**唯一殘留** = line-99 optional-vs-required → 1 cast 收（COUPLING-LOCK）。

**C. byte-identical emit**（esbuild transform、before==after）：`auth.ts` **✅ 0 diff（base==new==7727 bytes、non-zero）** / `requireRole.ts` **✅ 0 diff（1608 bytes）** → RUNTIME-LOCK / SECURITY-LOCK 坐實（auth 執行邏輯 + fail-closed 不變式 100% 未動；`import type` / type alias / return type / `as` cast / 參數註記 / 註解全於 emit 抹除）。
> **⚠ 驗法修正（CODE stage 2026-07-08）**：byte-identical **必走 stdin pipe** — `git show HEAD:<f> | npx esbuild --loader=ts --format=esm` vs `cat <f> | npx esbuild --loader=ts --format=esm`，逐一 diff。`--loader=ts` 對 **file-arg 會 error**（"loader without extension only applies when reading from stdin"）→ scout 期的 file-arg 寫法兩側都 error 成 **0-byte、diff 假 pass（vacuous）**。CODE stage 改 stdin pipe 後得 **non-zero（7727 / 1608 bytes）真 diff = 0**，結論（type-only、emit 不變）不變、僅驗法修正。[[feedback_byte_identical_emit_verification]]
> **部署產物代理閉合（維度-A R2 clarify；auto-deploy repo）**：本棒 push-main → Cloudflare Pages 重建（§4 `build:functions` = `wrangler pages functions build`）。isolated `esbuild --loader=ts` 的 byte-identical 為部署 artifact 之**充分代理**——兩者共用 esbuild 型別抹除、type-only 構造（`import type`/type alias/return type/`as` cast/參數註記）為**確定性 erase** → wrangler bundle 同樣 byte-identical。CODE stage 另跑真實 `build:functions` 驗 exit-0（rollback trivial：type-only、零 schema/migration/部署行為面）。
> **35+ caller emit 不受影響、故只需 2 檔 byte-identical（維度-A R3 tier1 clarify）**：本棒改變 `requireAuth`/`requireRegularAccessToken` return 對 35+ caller 的**可見型別**（`any`→`AuthedUser`/`number`），但 caller **emit 不變**——esbuild 單檔獨立、型別無感 transpile，importing 檔的 emitted JS 只依自身 source、與被 import function 的 return type 無關；caller 仍能編譯由 **ADDED=0**（§3.A）保證。故 byte-identical 只需對 2 個被改檔成立、無需逐一 diff 35+ caller。

**D. eslint**：`npx eslint functions/utils/auth.ts functions/utils/requireRole.ts` **EXIT 0**（`Env['chiyigo_db']` 解掉 D1Database `no-undef`；無新 lint）。

**E. transient revert clean**：`git checkout -- functions/utils/auth.ts functions/utils/requireRole.ts` → `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（pre-existing）、`git diff --stat` 空（未 commit、零殘留）。

**dual-leaf 說明**：7 條 REMOVED（auth.ts 的 TS7018/TS7006 = noImplicitAny 錯）僅在 functions-leaf 觸發（tests-leaf `noImplicitAny:false`）→ 各 1 line；cascade 型別錯（TS2322/TS2345/TS2559，與 noImplicitAny 無關）會跨兩 leaf → 故 requireRole:99 中途 ×2。Design A final 於兩 leaf 皆 ADDED=0。

## 4. 本地機械 gate（CODE stage 全套實跑；對齊 CI `ci.yml`）

CODE stage @ final source commit 必跑並讀真實輸出：`typecheck:ratchet`（enforce、baseline `1119/175` frozen 未 `--update`；report 應 493→486）· `lint`（eslint + lint:workflows）· `verify:browser-pipeline` · `test:cov` · `test:int`（含 `tests/integration/token-version.test.ts` bumpTokenVersion caller、`tests/integration/step-up.test.ts` `consumeJtiOnce` idempotency 回歸、`tests/auth.test.ts`）· `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。另 ARCH-L6 REPLAY：forced tsc set-diff（`REMOVED=7 / ADDED=0`）+ byte-identical（esbuild before==after `auth.ts` + `requireRole.ts`）於 source commit 重證。Windows `public/` CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。

> known flaky `jwt.test.ts`（~1.6%/run）撞到即 rerun（#138 已 deterministic 化）。

## 5. Open Decisions / owner ruling（2026-07-07，pre-Plan-Gate）

| 項 | 裁決 | SoT / 理由 |
|---|---|---|
| 級別 | **L2 + L3-security rigor** | type-only 契約標註、無新系統/schema/API/migration；因觸 Tier-0 auth 用 L3 安全嚴格度 + 維度-A self-review |
| Design | **Design A** | REMOVED=7 / ADDED=0、無 cascade、byte-identical（§3 實證） |
| `AuthedUser` claim 範圍 | **minimal**（僅 consumed） | 只列 caller 實際消費欄位、避免擴大語意承諾（CLAIM-LOCK） |
| cast 形式 | **允許邊界 cast + why-comment** | runtime 不變；註解鎖「此 cast 只反映既有 JWT custom claim 契約」 |
| `requireRole.ts` 觸檔 | **允許（僅 line-99 cast）** | 2dm ARCH-L7/L8 留下的同一語意邊界 narrow/cast、非 scope creep |
| `db` 型別 | **`Env['chiyigo_db']`** | 既有 idiom；裸 `D1Database` 不可解析（DB-LOCK） |
| 下一步 | **寫 PLAN doc → Plan Gate** | 先凍結 Design A / locks / 驗證矩陣，再送 ① ChatGPT Arch |

### Gate 收據（①②③，2026-07-08；④ pending）
- **① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`**：APPROVE、0 blocker、1 required lock refinement（ARCH-L10 CLAIM-ALLOWLIST）已逐字落地、2 non-blocking note 已納（NB-7 / NB-1 補）。ARCH-L1..L10 生效。
- **② `CODEX_PLAN_APPROVED`**：0 material finding。Codex 獨立驗證：`HEAD`=`origin/main`=`885684bd`=`885684bdb9b2c7c8a3651df830d5d45122ae4b29`；無 tracked source diff（僅 untracked `CLEANUP_PLAN.md` + 本 plan doc）；`typecheck:ratchet:report` = 493/30/305；forced tsc filtered = 恰 7 auth.ts 錯 + 0 requireRole 錯（吻合 §1）。
- **②→③ handoff（Codex 明列）**：repo 無 `governance/rules.json`；ratchet 只 ban `any`/`as any`、**不 registry-enforce 本棒 2 個 non-`any` cast**。故 **③ Code Gate 必 re-check**：(a) 精確 2-cast surface（`payload as AuthedUser` @ auth.ts success return、`user as RoleCheckedUser` @ requireRole:99）、(b) 2 cast why-comment（ARCH-L5、禁 magic token）、(c) forced tsc set-diff `REMOVED=7 / ADDED=0`、(d) 2 檔 byte-identical replay（ARCH-L6 TEST/REPLAY）。**已被 ARCH-L5 + ARCH-L6 涵蓋**、CODE stage 於 final source commit 實跑。
- **CODING_ALLOWED**（owner 明示 2026-07-08）→ **CODE committed `4c8e51f1`**（branch `stage7-pr2dn-auth-noimplicitany`，base `885684bd`）。11 locked edit 全落地、無 scope creep。**byte-identical 驗法修正**：scout 期 `esbuild <file> --loader=ts` file-arg 會 error → 0-byte vacuous 假 pass；CODE stage 改 stdin-pipe 得 non-zero 真 diff=0（見 §3.C ⚠ 驗法修正）。
- **③ `CODEX_CODE_APPROVED`**（2026-07-08 @ `4c8e51f1`）：0 material。Codex live-repo 獨立驗：set-diff 493→486 REMOVED=7/ADDED=0、stdin esbuild 7727==7727 / 1608==1608、ratchet 486/306、`git diff --check` clean、lint pass、verify:browser-pipeline pass、build:functions ok、targeted auth tests（auth.test 32/32 + step-up/token-version 22/22）、audit 0。Codex env full `test:int` timeout（本地已跑 1328 pass 補齊）。
- **④ `CHATGPT_CODE_FAITHFULNESS_APPROVED_WITH_DOC_FIX`**（2026-07-08 @ `4c8e51f1`）：**FAITHFUL**。0 scope creep / 0 material plan drift / 0 Tier0-1 side-finding。faithfulness 主軸全 PASS：gate chain（①→②→CODING_ALLOWED→code→③）· scope（2 source）· 11 edit shape · ARCH-L10 closed allowlist · cast surface（2 cast、②→③ handoff 重驗）· runtime-lock（stdin byte-identical non-vacuous 7727/1608）· type gate（493→486 REMOVED=7/ADDED=0）· security posture（byte-identical 保 auth/RBAC runtime、未升 runtime validation 符 NB-7）。1 required doc fix（header stale「尚未 CODING_ALLOWED」句）已於本 doc commit 修正。
- **授權邊界**：**四道 gate 全過**（①②③④）**≠ merge / push / PR**；仍待 **owner 明示 merge token** 才進 main（squash-merge）。

## 6. 非 blocking notes

- **NB-1**（含 ① non-blocking note 2）：`AuthedUser` 為 module-local type（**不 export**；caller 只 destructure `{ user, error }`、不具名該型）。對稱 2dm `RoleCheckedUser`。**① 確認：不升格為跨模組 public auth contract**——本棒目標＝消除 `any` collapse，非建立跨模組 auth domain model。
- **NB-2**：requireAuth JSDoc（auth.ts:1-12）`// user.sub, user.email …` 使用範例為既有泛型註解，本棒**不順改**（除非 owner/① 明示）。
- **NB-3**：stale NOTE @107（「db 暫不標型別等 §1.5c wrangler types 上線」）於 Edit 5a 更新為 `Env['chiyigo_db']` idiom 說明（現況已可標，NOTE 已過時）。
- **NB-4**（維度-A self-review `wf_cf6df9c9-36a` ACCEPTED tier3 修正）：`requireRole.ts` line-99 cast 後，未來若某 `user.*` sink 改標具體型別而破 coupling，**擋它的是每-PR 的 forced-tsc set-diff（§3.A / ARCH-L6 REPLAY，要求 ADDED=0）**，**非** standing `typecheck:ratchet` CI gate。後者 baseline frozen（`errorCount 1119` / `cleanFiles 175`；per-file `errorsByFile` headroom `auth.ts=7` / `requireRole.ts=12`）下，sub-baseline 的 ADDED>0 **不觸發 CI fail**（rule A aggregate 486≪1119、rule B cleanFiles 遠超 175、rule B'' 只擋「超過 frozen per-file 計數」，0<7 / 0<12 皆過）。故此 coupling 屬 defer-to-future、由 **CODE stage 逐 PR 的 set-diff gate 把關**（非 CI 自動化）；待 Stage 7 末 rebaseline `1119→0` 後 CI ratchet 才對這些檔真正 enforce ADDED=0。**2dm §5 補註同款「ratchet 機械擋」宣稱亦屬過度宣稱**，本棒不繼承。
- **NB-5**：shipped 集 = 2 source（auth.ts + requireRole.ts）+ 本 plan doc companion（governance companion，per stage7 慣例）；owner CODE 前可否決 plan doc companion。
- **NB-6**（維度-A tier3 refuted 存證）：requireAuth 系列 return envelope `{ user, error }`（+ requireRegularAccessToken 多 `userId`）維持 **inline**、不抽單一具名型別：對稱 2dm；5 wrapper 形狀微異、抽具名型別非本棒 minimal type-only scope（如 owner/gate 要求可另開 refactor 棒）。
- **NB-7**（① non-blocking note 1）：`payload as AuthedUser` 是本棒可接受的 **tactical pattern**、非長期 auth schema strategy；未來若要更嚴格，應**另開安全棒**在 `verifyJwt` 後加 runtime claim validator，並承認那會是 **runtime / security 行為變更**（非 type-only）。本棒 cast 必限 post-`verifyJwt`、minimal claims、why-comment、禁 `as any`。

## 7. 後續棒次

- 本棒（auth 7）→ **oauth ≈105** → **audit ≈381**（含 F-3 DORMANT，殿後最重）。
- auth SHIPPED 後：misc cluster 續清 oauth；noImplicitAny=0 後 rebaseline `1119→0` → `strict:true`(~998) → scripts → tests → browser。

---

## Index receipt（archive 用；本檔結案後搬 MEMORY 對應）
- 清 `functions/utils/auth.ts` 7 noImplicitAny（6 TS7018 + 1 TS7006）→ 0；`requireRole.ts` line-99 cast 收 2dm ARCH-L7/L8 forward-compat 耦合。
- Design A：`AuthedUser = JWTPayload & { role?/email?/sid?/risk_score?/risk_factors?/risk_country? }` + `payload as AuthedUser` 邊界 cast + `db: Env['chiyigo_db']`；REMOVED=7 / ADDED=0、byte-identical、eslint 0。
