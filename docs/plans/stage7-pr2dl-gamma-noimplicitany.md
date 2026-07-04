# Stage 7 PR-2dl γ — noImplicitAny 續清（misc leaf γ cluster：utils/backchannel + utils/revocation）

**狀態**：PLAN_DRAFT → PLAN_SELF_REVIEW_CLEAN（維度 A L3 self-review 完成）｜**待送 ① ChatGPT Architecture**
**base**：`894646e2`（origin/main，PR-2dk β）｜**source commit**：pending（CODE stage）
**性質**：純 type-only noImplicitAny 標註（13 → 0）、byte-identical emit 2/2、零 runtime / 零 schema/API/migration。**帶 2 個 owner-ruled OD（jti / sub）+ JSDoc jti 同步**（非純機械，OD 顯式攤開、禁機械偷渡）。

> ⚠ γ 是 misc leaf 拆棒（owner LOCKED α→β→γ）收尾棒：α（`admin/revoke`+`auth/devices`+`devices/logout` 13）#134 SHIPPED、β（`auth/logout`+`auth/refresh` 12）#136 SHIPPED、**γ（本棒）= session-token leaf 最後 13**。
> ⚠ 本棒解鎖 α/BLOCK-5、β/BLOCK-4 明列的「jti OD 屬 γ/PR-2dl」。

---

## 1. Scope 與 locks

**SCOPE-1**：僅 2 source
- `functions/utils/backchannel.ts`（OIDC Back-Channel Logout：對 cross-site RP 平行 fire-and-forget 送 `logout_token`、ES256 簽章、`getBackchannelEndpoints()` registry dispatch）
- `functions/utils/revocation.ts`（jti 精準撤銷：`isJtiRevoked` hot-path KV 正向快取+D1 SoT、`revokeJti` 寫入、`consumeJtiOnce` 一次性 atomic acquire〔Codex r1 P0-3 防一 token 多用〕）

**13 noImplicitAny → 0**：**全 TS7006（util-fn 參數 implicit-any）**，跨 5 個 function 簽名：
- backchannel `signLogoutToken(sub, aud, env)` ×3 + `dispatchBackchannelLogout(env, sub)` ×2 = 5
- revocation `isJtiRevoked(env, jti)` ×2 + `revokeJti(env, jti, expSec)` ×3 + `consumeJtiOnce(env, jti, expSec)` ×3 = 8

> 與 α（TS7031 handler-ctx）/ β（TS7031 handler-ctx + TS7006 parseCookieHeader）不同：γ **全為 util-fn 參數 TS7006**，無 handler-ctx、無 row-map。

**Edit locks**：
- EDIT-1 `env` 參數 = **util `Pick<Env, 實讀 key>`**（非全 Env；[[feedback_util_env_param_pick_not_full_env]]、handler full Env ⟂ util Pick 刻意分流）：
  - backchannel：`type BackchannelEnv = Pick<Env, 'JWT_PRIVATE_KEY'>`（只讀 `env.JWT_PRIVATE_KEY`）
  - revocation：`type RevocationEnv = Pick<Env, 'chiyigo_db' | 'CHIYIGO_KV'>`（只讀 `env.chiyigo_db` + `env.CHIYIGO_KV`）
- EDIT-2 **OD-1 `jti: string | null | undefined`**（revocation ×3，owner-ruled）
- EDIT-3 **OD-2 `sub: string | number`**（backchannel ×2，owner-ruled）
- EDIT-4 非-OD 直述：`aud: string`（`.setAudience` 用法）、`expSec: number`（JSDoc-directed + `Number.isFinite` guard）
- EDIT-5 **JSDoc jti 同步**（owner-ruled (b)）：revocation `@param {string} jti` ×3 → `@param {string | null | undefined} jti`（與 TS 權威型別自洽；comment-only、esbuild 抹除）

**Block locks（owner ruling 落地）**：
- BLOCK-1 **TYPE-ONLY**：只允許參數型別、2 local type alias、jti JSDoc comment 同步；**禁改任何 runtime expression**（含 guard `if (!jti || typeof jti !== 'string')`、`String(sub)`、`Number.isFinite(expSec)`、KV/D1 呼叫）。
- BLOCK-2 **SOURCE-SET**：source 只允許 `utils/backchannel.ts` + `utils/revocation.ts`（+ 本 plan doc companion）；**禁改 `env.d.ts`**（3 key `chiyigo_db`/`CHIYIGO_KV`/`JWT_PRIVATE_KEY` 已宣告於 `Env` L23/24/29，Pick 合法無需補宣告）。
- BLOCK-3 **JTI-CONTRACT**：jti 三處統一 `string | null | undefined`、JSDoc 同步、**禁窄化成 `string`**（strict:true forward-compat 地雷）或 `string | undefined`（L111 傳 `null` 不足）。
- BLOCK-4 **SUB-CONTRACT**：sub 兩處統一 `string | number`、**禁窄成 `string`**（L127/129 傳 number cascade）、**禁放寬成 `string | number | undefined`**（無 undefined caller 證據）。
- BLOCK-5 **禁改 test**（含契約測試 `revocation.test.ts`；不得為配合型別調測試）。
- BLOCK-6 禁 helper / shared util 抽取、禁改 `getBackchannelEndpoints()` / `oauth-clients` / caller。
- BLOCK-7 `Env` ambient、禁 import。

**ARCH locks（① ChatGPT Architecture）**：pending — 送 ① 後回填 ARCH-L1..Ln。

## 2. Edit matrix（10 edit hunk：5 簽名 + 2 alias + 3 JSDoc；清 13 TS7006）

| # | file:line（base `894646e2`） | cleared | form |
|---|---|---|---|
| 1 | backchannel.ts:28（after LOGOUT_EVENT，new） | — | `type BackchannelEnv = Pick<Env, 'JWT_PRIVATE_KEY'>` |
| 2 | backchannel.ts:40 | TS7006×3 | `signLogoutToken(sub: string \| number, aud: string, env: BackchannelEnv)` |
| 3 | backchannel.ts:67 | TS7006×2 | `dispatchBackchannelLogout(env: BackchannelEnv, sub: string \| number)` |
| 4 | revocation.ts:20（before KV_PREFIX，new） | — | `type RevocationEnv = Pick<Env, 'chiyigo_db' \| 'CHIYIGO_KV'>` |
| 5 | revocation.ts:29 | TS7006×2 | `isJtiRevoked(env: RevocationEnv, jti: string \| null \| undefined)` |
| 6 | revocation.ts:56 | TS7006×3 | `revokeJti(env: RevocationEnv, jti: string \| null \| undefined, expSec: number)` |
| 7 | revocation.ts:96 | TS7006×3 | `consumeJtiOnce(env: RevocationEnv, jti: string \| null \| undefined, expSec: number)` |
| 8 | revocation.ts:26 | — | `@param {string} jti` → `@param {string \| null \| undefined} jti` |
| 9 | revocation.ts:53 | — | `@param {string} jti` → `@param {string \| null \| undefined} jti` |
| 10 | revocation.ts:92 | — | `@param {string} jti` → `@param {string \| null \| undefined} jti` |

**SSOT 對齊**：
- **`Pick<Env, …>` util 慣例**＝ shipped siblings：`jwt.ts:34 JwtSignEnv = Pick<Env, 'JWT_PRIVATE_KEY'>`（**與 BackchannelEnv 同 Pick、最強先例**）、`cors.ts`、`totp.ts:25 Pick<Env,'chiyigo_db'>`、`siwe.ts`、`email.ts`、`device-alerts.ts`。named alias（多函式共用）對齊 email/jwt/siwe/device-alerts。
- **jti OD `string | null | undefined` SoT**＝ runtime guard（`if (!jti || typeof jti !== 'string') return …` 顯式防禦 null/undefined/空字串/非字串，**設計防禦契約非 dead code**）+ 契約測試 `revocation.test.ts:111/113`（明傳 `null`/`undefined`，L112 傳 `''`）。narrow 後（`!jti || typeof!=='string'` 之後）內部用 jti 皆為 `string`、無下游 error。
- **sub OD `string | number` SoT**＝ backchannel 內部 `String(sub)`（:47）+ `if(!sub)`（:68）吃 string/number；caller `end-session.ts` **兩 dispatch site**：① id_token_hint 路徑 L96/99 傳 `sub`（L80-81 `verifyIdTokenHintGetSub`→`string|null`、`if(sub)` narrow 成 `string`）；② cookie-fallback 路徑 L127/129 傳 `userId`（**L120 `const userId = row.user_id`**＝D1 `refresh_tokens.user_id` INTEGER、runtime number；現 handler ctx 未標型故靜態 `any`）。**一 string、一 number id、無 undefined caller** → `string | number` 精準（runtime 語意 + owner ruling + strict:true forward-compat）；JSDoc `@param {string|number} sub`（backchannel:64 已對、無需改）。〔註：L82 `parseInt(sub,10)` 的同名 `userId` 只餵 id_token_hint 區塊 UPDATE/audit、**從未 dispatch**，非 sub caller。〕
- **`aud: string`**＝ `getBackchannelEndpoints()` 回傳 `{aud, url}` + `.setAudience(aud)` 用法；set-diff ADDED=0 坐實相容。

## 3. 證據（scout 實測 @ working-tree overlay，已還原；CODE stage 於 source commit 重證）

- **forced tsc** `tsc -b tsconfig.solution.json --pretty false --force`：**518 → 505**、REMOVED=13（set-diff 精確＝那 13 條 TS7006）、**ADDED=0**（set-diff、非算術；含 dual-leaf tests leaf 全域）。errorFiles 33→31、cleanFiles 302→304。baseline `1119/175` frozen（reduce 禁 --update）。
- **byte-identical**（canonical `esbuild --loader=ts --format=esm` stdin、非空、防空字串 trap）：2/2 MATCH —
  - backchannel `631f3903a65102dc…`/1613B
  - revocation `6e138b6f8d5aeec6…`/2082B
  - **最終形態（含 JSDoc sync ×3）hash 與純 TS 標註版完全相同** → 坐實 JSDoc comment 100% esbuild 抹除、零 JS 影響。（orig `HEAD:blob` == 標註版）
- **name-status（預期）**：2 source code 檔（+ 本 plan doc companion，per stage7 慣例、α#134/β#136 同型）。

**dual-leaf assignable（type-level importers；ADDED=0 已坐實）**：
- **backchannel.ts** → 唯一 production importer＝`api/auth/oauth/end-session.ts:26`（`dispatchBackchannelLogout`）；**無直接 test importer**。caller 傳值 assignable 到 `string|number`（見 §2 SSOT）；`env` 由 end-session handler ctx 傳、assignable 到 `Pick<Env,'JWT_PRIVATE_KEY'>`。
- **revocation.ts** → production importer：`utils/auth.ts:15`（`isJtiRevoked`+`consumeJtiOnce`；hot-path `requireAuth`，`requireAuth(request:Request, env:Env)` 之 `env:Env` assignable 到 `Pick<Env,subset>`）、`api/admin/revoke.ts:42`（`revokeJti`）、`api/auth/oauth/bind-email.ts:25`（`consumeJtiOnce`；**:86 `tokenJti = typeof payload.jti==='string' ? … : null` 實傳 `string|null`＝OD-1 `|null` 之 production caller 證據，非僅契約測試**）；**直接 test importer＝`tests/integration/revocation.test.ts:17`（`revokeJti`+`isJtiRevoked`）**。
  - 契約測試 L111-113 `isJtiRevoked(env, null/''/undefined)` → 全 assignable 到 `string|null|undefined`（OD-1 之所以必含 null/undefined）。
  - `env` 來自 `cloudflare:test`＝`ProvidedEnv extends Env`（`env.d.ts:112-115`）→ Env superset assignable 到 Pick subset。無 production narrow-literal TS2345 陷阱。**已被 ADDED=0（含 tests leaf 全域）坐實**。

**F-3 DORMANT-safe**：2 檔 0 命中 archive / R2 / retention / aggregate / checkpoint（backchannel＝jose+fetch+oauth-clients；revocation＝KV+D1 `revoked_jti`）；type-only byte-identical → 無 transitive dormant invoke。

## 4. 本地機械 gate（scout 已測；CODE stage + merge-front 全套重跑）— pending CODE stage
- scout 已測：forced tsc set-diff **518→505 / REMOVED=13 / ADDED=0** · byte-identical 2/2（含 JSDoc 最終形態）。
- CODE stage 重證（對齊 CI `.github/workflows/ci.yml`）：`typecheck:ratchet` enforce（505/31/304、baseline `1119/175` frozen）· `lint` · `verify:browser-pipeline` · `test:cov` · `test:int`（75 檔、含 `revocation.test.ts` 契約測試）· `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。
> known flaky `jwt.test.ts:33`（~1.6%/run）非本棒引入（tamper no-op false-pass、與本 diff 無關）→ CI 撞到 rerun、非本棒 failure。npm audit deps 未改＝非 blocker。本機 build 的 public/ CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。self-review 與 `test:int` 並行時囑 reviewer **勿跑 `tsc --force`**（避 Miniflare 飢餓 flake）。

## 5. Dual Gate v3.1 — 4 道外部審查 — pending
- ① ChatGPT Architecture `CHATGPT_ARCH_APPROVED` — pending（審查面預期：SPEC/OD fidelity〔jti/sub 兩 OD + JSDoc (b)〕 / scope / util Pick 慣例〔⟂ handler full Env〕 / byte-identical 零行為 / revocation hot-path 安全面 / F-3 / dual-leaf / plan-doc companion 身分）。
- ② Codex Plan `CODEX_PLAN_APPROVED` — pending（隔離 replay 驗 base 518→505、REMOVED=13、ADDED=0、TS2345/TS2353=0 新增、byte-identical hash）。
- ③ Codex Code `CODEX_CODE_APPROVED` — pending（CODE stage @ source commit）。
- ④ ChatGPT Faithfulness `CHATGPT_CODE_FAITHFULNESS_APPROVED` — pending。

**維度 A self-review（內部放大器、主線親裁不採 raw）**：
- PLAN（L3-security fail-safe、multi-agent workflow / N readonly-reviewer）→ 結果見報告第 4 欄。
- CODE（L3）→ pending CODE stage。

## 6. OD 狀態（owner-ruled 2026-07-04，SPEC_APPROVED）
| OD | 裁決 | SoT / 理由 |
|---|---|---|
| OD-1 `jti`（revocation ×3） | **`string \| null \| undefined`** | 契約測試 `revocation.test.ts:111/113` 明傳 null/undefined + **production caller `bind-email.ts:86` 實傳 `string\|null`**（`typeof payload.jti==='string' ? … : null`）+ runtime guard 防禦契約；strict:true forward-compat（避免未來 TS2345 地雷）。禁窄成 `string`。 |
| OD-2 `sub`（backchannel ×2） | **`string \| number`** | caller `end-session.ts` 兩 dispatch：L96/99 傳 narrowed `string`、L127/129 傳 `userId`＝`row.user_id`（L120，D1 user_id runtime number、靜態 any）；無 undefined caller。禁窄成 `string`、禁放寬成 `+undefined`。 |
| JSDoc jti ×3 | **(b) 同步 `@param {string \| null \| undefined} jti`** | 與 TS 權威型別自洽、降 reviewer 誤判；comment-only byte-identical。 |
| 非-OD | BackchannelEnv/RevocationEnv Pick、aud:string、expSec:number、不改 env.d.ts | owner 同意。 |

## 7. 非 blocking notes
- **NB-1**：backchannel `@param {object} env`（:63）與 revocation `@param {object} env`（:25/52/91）為既有泛型註解，本棒不改（非 jti OD 範疇、與 TS Pick 型別不衝突）。
- **NB-2**：shipped 集＝2 source + 本 plan doc（governance companion，per stage7 慣例）；source scope 為 2 檔、plan doc 非 source churn。owner CODE 前可否決。
- **NB-3**：LINE id_token 等 oauth 域 backlog、requireRole TS7053、auth TS7018 皆非本棒；本棒不觸 oauth-clients / jwt / auth.ts。

## 8. 後續棒次
- 殿後 requireRole 12（TS7053 index-sig）→ auth 7（TS7018·與 jwt）→ oauth 105 → audit 381（含 F-3 DORMANT）。
- **γ SHIPPED 後 → session-token leaf（revocation/backchannel/logout/refresh/devices）noImplicitAny=0 全閉環**；剩 requireRole/auth/oauth/audit → noImplicitAny=0 後 rebaseline 1119→0 → strict:true(~998) → scripts → tests → browser。
