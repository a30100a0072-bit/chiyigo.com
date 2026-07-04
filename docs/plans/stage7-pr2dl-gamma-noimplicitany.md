# Stage 7 PR-2dl γ — noImplicitAny 續清（misc leaf γ cluster：utils/backchannel + utils/revocation）

**狀態**：**`CODEX_CODE_APPROVED`（③ @ `0af55e69`，2026-07-04）**〔Plan ①+② + Code ③ 三道過、機械層全綠〕｜**待送 ④ ChatGPT Faithfulness**（未授權 push/merge）
**base**：`894646e2`（origin/main，PR-2dk β）｜**source commit**：`0af55e69`（2 source、+14/-8）
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

**ARCH locks（① ChatGPT `CHATGPT_ARCH_APPROVED_WITH_LOCKS`，2026-07-04 @ `c8d64d89`）**：
- ARCH-L1 TYPE-ONLY：CODE stage 只允許參數型別、2 local type alias、3 處 jti JSDoc 同步；禁改任何 runtime expression。
- ARCH-L2 SOURCE-SET：source 僅 `utils/backchannel.ts` + `utils/revocation.ts`（+ plan doc companion）；禁改 caller / test / schema / migration / `env.d.ts`。
- ARCH-L3 JTI-CONTRACT：`isJtiRevoked` / `revokeJti` / `consumeJtiOnce` 之 `jti` 必 `string | null | undefined`；JSDoc 同步；禁窄化。
- ARCH-L4 SUB-CONTRACT：`signLogoutToken` / `dispatchBackchannelLogout` 之 `sub` 必 `string | number`；禁窄成 `string`、禁放寬 `undefined/null`。
- ARCH-L5 ENV-PICK：util env 只用 `Pick<Env, 實讀 key>`（`JWT_PRIVATE_KEY` / `chiyigo_db` / `CHIYIGO_KV`）；禁 full `Env` 掩蓋依賴面。
- ARCH-L6 NO-TEST-ADAPT：禁改 `revocation.test.ts` 或其他測試配合型別；測試只作驗證。
- ARCH-L7 REPLAY-REQUIRED：CODE stage 必以 final source commit 重跑 forced tsc set-diff：ADDED=0、REMOVED=13 TS7006；禁沿用 scout。
- ARCH-L8 BYTE-IDENTICAL：final diff 必重跑 2/2 byte-identical，JSDoc 同步後 hash 不得改 JS emit。
- ARCH-L9 BUILD-COVERAGE：CODE stage 必跑 `typecheck:ratchet` / lint / browser pipeline / coverage / integration / functions build / full build / audit；audit deps 未改可非 blocker 但需報告。
- ARCH-L10 NO-DORMANT：禁觸 archive/R2/retention/aggregate/checkpoint（F-3 dormant）；name-status 出現額外檔案自動退回 plan。

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

> **註（alias hunk 完整形）**：edit matrix #1/#4 的 `type XxxEnv = Pick<…>` 別名各**上帶一行 why-comment**（`// util env 子集…handler full Env ⟂ util Pick 刻意分流`，理由同 §1 EDIT-1）+ 一分隔空行，對齊 sibling named-Pick-alias（`jwt.ts`/`siwe.ts`/`device-alerts.ts`）帶註解慣例。comment/空行 esbuild AST-neutral（byte-identical 不破），已含於 ②-approved `intended-source.patch`（非新增 scope）。

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

## 4. 本地機械 gate（CODE stage @ `0af55e69` 全套實跑、全綠）
- **ARCH-L7 forced tsc set-diff**：`518→505` / **ADDED=0** / **REMOVED=13**（全 TS7006）；errorFiles 33→31、cleanFiles 302→304。
- **ARCH-L8 byte-identical 2/2**（committed vs `894646e2:blob`，含 JSDoc sync）：backchannel `631f3903…`/1613B · revocation `6e138b6f…`/2082B。
- `typecheck:ratchet` enforce OK（505/304、baseline `1119/175` frozen 未 --update）· `lint` OK（eslint+compat-date+workflows）· `verify:browser-pipeline` OK（25 pages ?v=）· `test:cov` **90.28%（1933/2141）** · `test:int` **75 檔/1328 passed**（無 flake、761s）· `build:functions` Compiled OK · 完整 `npm run build` OK（lint:handlers/archive-no-delete/migrations）· `npm audit --omit=dev --audit-level=high` **0 vuln**。
> known flaky `jwt.test.ts:33`（~1.6%/run）本次未撞。npm audit deps 未改＝非 blocker。本機 build 的 public/ CRLF churn 已 `git checkout -- public/` 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）；source commit `0af55e69` name-status 僅 2 檔。

## 5. Dual Gate v3.1 — 4 道外部審查
- ① ChatGPT Architecture **`CHATGPT_ARCH_APPROVED_WITH_LOCKS`（2026-07-04 @ `c8d64d89`）**：APPROVE、0 blocker。核准限定 2 source / 13 TS7006 / type-only / byte-identical 2/2 / 零 runtime·schema·API·migration；OD-1 jti / OD-2 sub / JSDoc 同步對齊 owner 裁決；ARCH-L1..L10（見 §1）。NB：① `@param {object} env` 可暫留、CODE 不得順改（除非 owner 明示）；② ② 必隔離 replay、③ 必 source-commit replay；③ sub SoT 已修正為 `row.user_id` dispatch path（不再依賴舊 `parseInt` 歸因）；④ backchannel 無直接 test importer→③ Code 可特別看 end-session path assignability。**只核准 plan/locks、不授權 CODE、不授權 merge。**
- ② Codex Plan **`CODEX_PLAN_APPROVED`（2026-07-04）**：no material findings。隔離 replay 坐實：branch diff 僅 plan doc（source/runtime/test/schema/env/caller 空）；patch 只動 2 source；forced tsc **518→505**、errorFiles 33→31、cleanFiles 302→304、**ADDED=0**（無新 TS2345/TS2339/TS2367/TS2353）、**REMOVED=13**（全 TS7006）；byte-identical 2/2 hash 吻合（backchannel `631f3903…`/1613B、revocation `6e138b6f…`/2082B）。註：無 repo-local `governance/rules.json`＝依 live replay 證據非 manifest enforcement。**此裁決 ≠ CODING_ALLOWED。**
- ③ Codex Code **`CODEX_CODE_APPROVED`（2026-07-04 @ `0af55e69`）**：no material findings。獨立 replay 坐實：source/docs split（`0af55e69` 僅 2 source、`8ce7d3db` 為 docs gate-log）；**faithfulness — live source diff == `code-diff-0af55e69.patch` == ②-approved `intended-source.patch` byte-for-byte**（3990B、SHA-256 `959ebbee80b0c4530b44c1dddffd3caca20bebb4189eb6957b2287c23ac3dea8`）；forced tsc 518→505/ADDED=0/REMOVED=13（全 TS7006）；byte-identical 2/2（`631f3903`/1613B、`6e138b6f`/2082B）；0 escape-hatch/`any`；security guard（jti fail-safe/fail-closed + `INSERT OR IGNORE`+`changes()` atomic）未觸。gates 綠（ratchet/tsc/lint/browser-pipeline/test:cov 737/test:int 1328/build:functions/handlers/archive-no-delete/migrations）。npm audit（outbound）+ full build（寫 public/）未獨立重跑＝deps/config 未改非 blocker。**≠ push/merge/release。**
- ④ ChatGPT Faithfulness `CHATGPT_CODE_FAITHFULNESS_APPROVED` — pending。

**維度 A self-review（內部放大器、主線親裁不採 raw）**：
- PLAN（L3-security fail-safe、3 readonly-reviewer：OD-fidelity/scope-lock · type-cascade/dual-leaf · behavior/L3-security）→ 一輪 0 blocking/high；主線核真碼修正 OD-2 SoT 行號歸因（改 `row.user_id` dispatch path、非 `parseInt`）+ 補 `bind-email.ts:86` production `string|null` caller 證據。
- CODE（L3、3 readonly-reviewer：diff-fidelity · runtime-security · evidence）→ 一輪 0 blocking；evidence reviewer **獨立重算 byte-identical 命中**（`631f3903`/`6e138b6f`）、baseline 未 --update、0 escape-hatch/`any`；runtime-security 逐行確認 fail-safe/fail-closed/atomic guard 未觸；diff-fidelity 1 LOW（alias why-comment 超出 §2 字面列舉）→ 主線裁決非 scope creep（已在 ②-approved patch、AST-neutral、對齊 sibling 慣例）+ §2 補註。
- 主線親裁（非採 raw）：兩階段各一輪 0 新發現。

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
