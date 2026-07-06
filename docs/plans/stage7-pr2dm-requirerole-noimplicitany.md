# Stage 7 PR-2dm — noImplicitAny 續清（misc cluster 頭棒：`utils/requireRole`）

**狀態**：**`PLAN_DRAFT`**（Dual Gate v3.1；本棒 L2-security）｜待 dimension-A plan self-review → owner 送 ① ChatGPT Arch → ② Codex Plan
**base**：`d2269efe`（origin/main，#138 flaky-test fix SHIPPED 後）
**性質**：純 type-only noImplicitAny 標註（**12 → 0**）、byte-identical emit（esbuild before==after 已實證）、零 runtime / 零 schema / 零 API / 零 migration。**RBAC 特權判斷邊界**（ROLE_LEVEL 階層比較 + fail-closed 防禦）→ 型別只描述、runtime 一字不改。

> ⚠ 本棒觸 **Tier 0-adjacent 安全邊界**（RBAC role hierarchy）。全部改動 type-only、RBAC 執行邏輯（`?? -1` / `?? Infinity` / `in ROLE_LEVEL` / `userLevel < requiredLevel` / `actor > target`）**禁改**。
> ⚠ 本棒是 misc cluster（requireRole / auth / oauth / audit）頭棒；requireRole 為原排程下一棒（session-token leaf γ #137 已閉環）。

---

## 1. Scope 與 locks

**SCOPE-1（owner SCOPE-LOCK）**：**僅 1 source**
- `functions/utils/requireRole.ts`（RBAC 角色守門：`requireRole` 委派 `requireAuth` + `KNOWN_ROLES` gate + `ROLE_LEVEL` 階層比較；`actorOutranksTarget`/`isKnownRole`/`safeRoleString`/`KNOWN_ROLES` helper 供 ban/unban/revoke 用）

**12 noImplicitAny → 0**（forced tsc 實證，非摘要）：**5 TS7006 + 1 TS7018 + 4 TS7053 + 2 TS7006**（共 7 TS7006 + 1 TS7018 + 4 TS7053）跨 4 個 export + 1 const：

| code | loc (base `d2269efe`) | 位置 |
|---|---|---|
| TS7006 | 35,29 | `isKnownRole(role)` |
| TS7006 | 42,32 | `safeRoleString(role)` |
| TS7006 ×3 | 51,35 / 51,44 / 51,49 | `requireRole(request, env, minRole)` |
| TS7018 | 53,23 | `return { user: null, error }`（`null` 字面量在 `strictNullChecks:false` 下即 `any`） |
| TS7053 ×2 | 79,25 / 80,25 | `ROLE_LEVEL[user.role]` / `ROLE_LEVEL[minRole]`（index 型別 `any`、ROLE_LEVEL 無 index signature） |
| TS7006 ×2 | 102,37 / 102,48 | `actorOutranksTarget(actorRole, targetRole)` |
| TS7053 ×2 | 107,10 / 107,34 | `ROLE_LEVEL[actorRole]` / `ROLE_LEVEL[targetRole]` |

**Edit locks（6 edit，清 12 錯）**：

| # | file:line（base `d2269efe`） | cleared | form |
|---|---|---|---|
| 1 | requireRole.ts:22 | TS7053 ×4（@79/80/107×2，index-sig source fix） | `const ROLE_LEVEL: Record<string, number> = {` |
| 2 | requireRole.ts:35 | TS7006 @35 | `isKnownRole(role: string)` |
| 3 | requireRole.ts:42 | TS7006 @42 | `safeRoleString(role: string)` |
| 4 | requireRole.ts:46（before requireRole JSDoc，new） | — | `type RoleCheckedUser = { role: string; [claim: string]: unknown }` + 上帶 why-comment |
| 5 | requireRole.ts:51 | TS7006 ×3 @51 + TS7018 @53 | `requireRole(request: Request, env: Env, minRole: string): Promise<{ user: RoleCheckedUser \| null; error: Response \| null }>` |
| 6 | requireRole.ts:102 | TS7006 ×2 @102 | `actorOutranksTarget(actorRole: string, targetRole: string)` |

**Block locks（owner ruling 落地，2026-07-06 AskUserQuestion）**：
- **RUNTIME-LOCK**：byte-identical emit；**禁改任何 RBAC runtime expression**（`KNOWN_ROLES.has` / `?? -1` / `?? Infinity` / `in ROLE_LEVEL` / `<` / `>` / `safeUserAudit` 呼叫 / `res(...)` / `Number(user.sub)`）。只允許型別註記 + 1 local type alias（+ alias why-comment）。
- **TYPE-LOCK**：`ROLE_LEVEL: Record<string, number>`、`minRole: string`、`env: Env`（見下 §2 SSOT 三項理由）。
- **SCOPE-LOCK**：source 僅 `requireRole.ts`（+ 本 plan doc companion，per stage7 慣例）；**禁改** caller（ban/unban/revoke/event-dlq/requisitions×2/audit-archive×2/oauth-clients）、test（`auth.test.ts`）、schema、migration、`env.d.ts`（`Env` ambient、`Response`/`Request` global，無需補宣告或 import）。
- **TEST-LOCK**：forced tsc set-diff 為 ADDED=0 權威證據：`REMOVED=12`（那 12 條）/ `ADDED=0`（含 dual-leaf tests-leaf 全域）；byte-identical 為 RUNTIME-LOCK 權威（esbuild before==after）。CODE stage 於 final source commit **重跑**（禁沿用 scout/transient overlay）。
- **COUPLING-LOCK**：`requireAuth` 回傳現仍 collapse 成 `any`（其 5 條 TS7018 在「auth 7」bucket 未修）；本棒**不動 auth.ts**。requireRole 內部 `user` 亦 `any`，line-89 `{ user, error: null }`（user: any）→ `RoleCheckedUser | null` assignable、無需 cast。
- **DEFER-LOCK**：**不為未來 auth-7 提前加 cast**。forward-compat（見 §5）留給 auth-7 PR 在同一語意邊界收斂；本棒 transient tsc 已證現況無需 cast（未觸發）。
- **NAMING-LOCK**：`RoleCheckedUser` 命名反映「已過 KNOWN_ROLES gate」的 user；`ROLE_LEVEL: Record<string, number>` 對齊 scopes.ts 既有 precedent（無另立 alias；[[feedback_state_machine_naming_no_alias]]）。

**ARCH locks（待 ① ChatGPT Arch 落地填入）**：ARCH-L1..Ln placeholder。

## 2. SSOT 對齊（每個 TYPE-LOCK 決策的真相源）

- **`ROLE_LEVEL: Record<string, number>`**：4 個 TS7053 的訊息是「expression of type **'any'** can't index type `{player:number;...}`」——根因是 ROLE_LEVEL **缺 index signature**（noImplicitAny 下無 index-sig 物件被任意 key 索引即 TS7053）。`Record<string, number>` 一次補齊、與 param 型別無關全消 4 條。**precedent 同源**＝scopes.ts `SCOPE_HIERARCHY: Record<string, readonly string[]>`（L96）+ `ROLE_BASE_SCOPES: Record<string, readonly string[]>`（L166），兩者皆因「查詢鍵來自 untrusted claim / Object.keys、runtime 契約本就任意 key 查表 + fallback」而標 `Record<string, …>`。ROLE_LEVEL 語意完全相同（untrusted role 查階層 + `?? -1` fallback）。`KNOWN_ROLES = new Set(Object.keys(ROLE_LEVEL))` → `Object.keys(Record)` 仍 `string[]` → `Set<string>`（行為不變）。
  - **型別可見性（self-review 2026-07-06，非 blocker、需 gate 知悉）**：本 repo 全 tsconfig 皆**無 `noUncheckedIndexedAccess`**（default off）→ `Record<string, number>[key]` 型別為 non-nullable `number`，使 `?? -1`（:79）/ `?? Infinity`（:80）fail-closed fallback **型別上不可見**（型別讀者看似 dead branch）。**但 runtime 完全保留**（byte-identical；`ROLE_LEVEL['godmode']` runtime 仍 `undefined` → `??` 觸發、deny-by-default 生效）→ **零安全影響**。與 scopes.ts 同款 `Record + ?? fallback`（`ROLE_BASE_SCOPES[role as string] ?? []`）完全一致，非本棒新增型別債。
- **`minRole: string`（非 role-name 字面 union）**：`auth.test.ts:274` 明測 `requireRole(..., 'godmode')`（**故意非法 role**，驗 `ROLE_LEVEL[minRole] ?? Infinity`（:80）deny-by-default 永遠拒絕路徑）。`string` 誠實精準：callers 傳 `'admin'`/`'player'` 等字面 string，runtime 對未知 minRole fail-closed（拒全部）。**注意**：`keyof typeof ROLE_LEVEL` 在 `ROLE_LEVEL: Record<string, number>`（Edit #1）下 = string-based key type、**接受 `'godmode'`、不提供 role-name 收斂**（實測 `const k: keyof typeof ROLE_LEVEL = 'godmode'` 編過、`= 123` 才 TS2322）；唯一會 reject `'godmode'` 的是另立 role-name 字面 union（`'player'|'moderator'|…`），本棒**刻意不採**（會破該測試 + 違 deny-by-default 語意）。
- **`env: Env`（非 `Pick<Env>`）**：requireRole 把 `env` **原封轉給 `requireAuth(request, env)`**（`requireAuth(env: Env)` 要求 full `Env`）→ Pick 子集會炸 requireAuth 呼叫。[[feedback_util_env_param_pick_not_full_env]] 的 test-cascade 情境**不成立**：`auth.test.ts:8 let env`（無註記）→ tests-leaf（`noImplicitAny:false`）下 `env: any`，傳 full-Env 參數零 cascade（已被 ADDED=0 含 tests-leaf 全域坐實）。**此為相對 γ 棒 Pick precedent 的有據偏離**（γ util 只直讀 1-2 key、不轉發 requireAuth；requireRole 轉發、genuinely 需 full Env）。
- **`RoleCheckedUser = { role: string; [claim: string]: unknown }`**：
  - `role: string` 由 line-64 `if (!KNOWN_ROLES.has(user.role))` gate **保證**（requireRole 只在 `role ∈ KNOWN_ROLES` 才回非 null user）→ 誠實甚至保守（實為 known-role）。callers 唯一 `user.role` sink＝`actorOutranksTarget(string)`（ban/unban/revoke）+ test `expect(user.role)`，皆吃 string。
  - `[claim: string]: unknown` index sig **必需**：callers 存取 `user.sub`/`user.email` 等非 role claim → 經 index sig → `unknown`（無 TS2339），再進 `Number(unknown)`（Number 參數 any）/ `appendAuditLog(entry: any)` / `effectiveScopesFromJwt(user)`（`RoleCheckedUser` assignable 到 `Record<string,unknown>`）→ 全 ADDED=0。
- **TS7018 @53**：`{ user: null }` 的 `null` 在 `strictNullChecks:false` 下型別即 `any`。鐵證＝auth.ts 5 條同款 TS7018（30/135/164/209/300），連已標型的 `requireScope(env: Env)` 都中。⇒ **只標參數消不掉 @53**，需顯式 return type 提供 contextual type（一次涵蓋 line 53/73/83 三個 null return，避免 whack-a-mole）。

## 3. 證據（scout transient overlay 實測 @ working-tree，已還原；CODE stage 於 source commit 重證）

- **forced tsc** `tsc -b tsconfig.solution.json --pretty false --force`：**505 → 493**、set-diff **REMOVED=12**（精確＝那 12 條：7×TS7006 + 1×TS7018 + 4×TS7053）、**ADDED=0**（set-diff、非算術；含 dual-leaf tests-leaf 全域）。errorFiles 31→30、cleanFiles 304→305。baseline `1119/175` frozen（reduce 禁 `--update`）。
- **byte-identical**（esbuild `--format=esm` 生產 transformer、before==after）：**0 diff line**（modified 版與 original 版 emit 完全相同）→ 坐實 6 edit 全 type-only、JSDoc/type-alias/annotation 100% 抹除、零 JS 影響。
- **transient revert clean**：`git checkout -- functions/utils/requireRole.ts` → `git status --porcelain` 空、`git diff --exit-code`=0（未 commit、零殘留）。
- **name-status（預期）**：1 source code 檔（+ 本 plan doc companion，per stage7 慣例）。

**dual-leaf / caller assignable（type-level importers；ADDED=0 已坐實 §3）**——全 10 個 `requireRole` importer + 3 個 helper importer 逐一稽核：

| caller | user.* 用法 | sink | ADDED |
|---|---|---|---|
| ban / unban / revoke | `user.role` | `actorOutranksTarget(string)` | 0 |
| ban / unban / revoke | `effectiveScopesFromJwt(user)` | `Record<string,unknown> \| string`（RoleCheckedUser assignable） | 0 |
| ban / unban / revoke | `user.sub` / `user.email` | `Number()` ／ `appendAuditLog(entry:any)`〔`appendAuditLog(db, entry)` 參數未標型〕 | 0 |
| event-dlq/index | `user.sub` | `Number()` | 0 |
| requisitions/[id]/save · delete | `user.sub` | `Number()` | 0 |
| audit-archive/retry · audit-aggregate-archive/retry | `user.sub` / `user.email` | `Number()` ／ `appendAuditLog(any)` | 0 |
| oauth-clients | `user.sub` / `user.email` | `Number()` ／ `appendAuditLog(any)` | 0 |
| tests/auth.test.ts | `user.role` / `env` / `minRole('godmode')` | `expect(string)` ／ `Env(any)` ／ `string` | 0 |

> 唯二 `user.role` sink 皆吃 `role: string`；其餘 user.* 全走 `Number(user.sub)`（unknown→any）/ `user.email → appendAuditLog(entry: any)`（3 處 sink 已逐一確認為 untyped `appendAuditLog`）/ `effectiveScopesFromJwt(user)`。**helper importer（actorOutranksTarget/isKnownRole/safeRoleString）僅 ban/unban/revoke**，全傳 `user.role`(string)/`target.role`(D1 row `any`)→ string 參數 assignable。
> **`audit.ts` 非 requireRole caller**（其 `user` 來自 `requireScope`/`requireAnyScope`，本棒不影響其 `canRoleSeeAuditEvent(user.role)`）。

## 4. 本地機械 gate（CODE stage 全套實跑；對齊 CI `ci.yml`）
CODE stage @ final source commit 必跑並讀真實輸出：`typecheck:ratchet`（enforce，baseline `1119/175` frozen 未 `--update`）· `lint` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。另 ARCH-Lx REPLAY：forced tsc set-diff（`ADDED=0`/`REMOVED=12`）+ byte-identical（esbuild before==after）於 source commit 重證。Windows public/ CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。
> known flaky `jwt.test.ts`（~1.6%/run）撞到即 rerun（#138 已 deterministic 化該測試）。

## 5. Open Decisions / owner ruling（2026-07-06 AskUserQuestion，pre-Plan-Gate）
| 項 | 裁決 | SoT / 理由 |
|---|---|---|
| Design 方向 | **Design B**（type-only、單檔、6 edit） | REMOVED=12/ADDED=0 + byte-identical 已 transient 實證 |
| `RoleCheckedUser` | **`{ role: string; [claim: string]: unknown }`** | role 由 line-64 gate 保證；純 unknown 反逼 cast + 撞 string sink |
| `minRole` | **`string`** | callers 傳任意 role 字面 + runtime deny-by-default（`?? Infinity`）；role-name 字面 union 會破 `auth.test.ts:274 'godmode'` 測試故不採（`keyof typeof Record<string,number>` 不 narrow、見 §2） |
| `env` | **full `Env`** | 轉發 `requireAuth(env: Env)`；test `env: any` 無 cascade |
| `ROLE_LEVEL` | **`Record<string, number>`** | scopes.ts precedent；index-sig source fix |
| forward-compat cast | **不加**（DEFER-LOCK） | 現況 user: any 無需 cast；留 auth-7 PR 收斂 |

**forward-compat coupling note（交 auth-7 PR）**：未來 auth-7 若把 `requireAuth` 回傳標成型別（→ 內部 `user.role` 變 `unknown`），本檔 line-89 `return { user, error: null }` 會 `unknown → RoleCheckedUser.role(string)` TS2322。**現況 user 仍 `any` 故無事**；屆時由 auth-7 PR 在同一語意邊界對齊（加 narrow 或 cast），**不在本棒提前擴 scope**（owner DEFER-LOCK）。
> **補（self-review LOW，非 blocker）**：對稱地，`RoleCheckedUser` 的 `[claim: string]: unknown` 使 caller 端 `user.sub`/`user.email` 為 `unknown`、現流入 any-accepting sink（`Number()`/`appendAuditLog(entry:any)`）。未來若某 sink 改標具體型別，該 coupling 由 **ratchet 機械擋下**（ADDED>0 即 CI fail）→ 同屬 defer-to-future、非本棒缺陷、無需現在處理。

## 6. 非 blocking notes
- **NB-1**：requireRole JSDoc `@param {object} env`（:48）為既有泛型註解，本棒**不順改**（非 TYPE-LOCK 範疇、與 TS `env: Env` 不衝突；除非 owner/① 明示）。對齊 γ NB-1（`@param {object} env` 暫留）。
- **NB-2**：shipped 集＝1 source + 本 plan doc（governance companion，per stage7 慣例）；owner CODE 前可否決 plan doc companion。
- **NB-3**：`auth 7`（TS7018·與 jwt）、`oauth 105`、`audit 381`（含 F-3 DORMANT）皆非本棒；本棒不觸 auth.ts / oauth-clients / jwt.ts / audit 域。
- **NB-4**：`RoleCheckedUser` 為 module-local type（不 export；callers 只 destructure `{ user, error }`、不具名該型）。

## 7. 後續棒次
- 本棒（requireRole 12）→ **auth 7**（TS7018·與 jwt）→ **oauth 105** → **audit 381**（含 F-3 DORMANT，殿後最重）。
- requireRole SHIPPED 後：misc cluster 續清 auth；noImplicitAny=0 後 rebaseline `1119→0` → `strict:true`(~998) → scripts → tests → browser。
