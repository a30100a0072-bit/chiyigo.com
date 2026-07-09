# Stage 7 PR-2dq — noImplicitAny 續清（oauth domain 棒3a：flow issuance clean-4）

**SPEC**: `STAGE7_OAUTH_FLOW_ISSUANCE_NOIMPLICITANY`
**狀態**: `SPEC_APPROVED_WITH_LOCKS · ① CHATGPT_ARCH_APPROVED_WITH_LOCKS · ② CODEX_PLAN_APPROVED · AWAITING owner CODING_ALLOWED`
（scout〔6 檔 26 錯、zero dual-leaf〕→ **transient overlay 實測**〔4 輪：full-6 REMOVED=26/ADDED=9 掀出兩 cascade → **clean-4 REMOVED=20/ADDED=0** + byte-identical 4 檔 + `git checkout --` 還原〕→ owner **拆棒糾正 + 微決策全裁 + OD 方向**〔採 overlay 縫：棒3a=authorize/token/code/end-session、棒3b=init/bind-email〕→ **① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（僅批棒3a、8 lock ARCH-3A-L1..L8、不批 full-6、不納 init/bind-email/env.d.ts）** → **本 plan doc** → **② `CODEX_PLAN_APPROVED`（plan only、live replay 重證：HEAD 157dbb88、REMOVED=20/ADDED=0、byte 4228/6437/1745/5404、ratchet 434/24/311；3 non-blocking note、已修 2 doc-hygiene）** → 待 owner `CODING_ALLOWED`；**未 push / 無 PR / 未 commit / 未動 source**；tree 僅 pre-existing `?? CLEANUP_PLAN.md` + 本 plan doc untracked）
> **gate 進程**: scout → transient overlay（clean-4 `REMOVED=20/ADDED=0` + byte-identical `5404/4228/6437/1745` + eslint 待 CODE、`git checkout --` 還原、**overlay 零殘留**）→ owner **拆棒 + 微決策 + OD 裁決** → **① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（8 lock）** → **本 plan doc** → **② `CODEX_PLAN_APPROVED`（0 material、live replay）** → 待 owner `CODING_ALLOWED` → CODE（fresh replay ARCH-3A-L7）→ **③ Codex Code** → **④ ChatGPT faithfulness** → owner `MERGE_ALLOWED` → squash-merge。
> **狀態 SoT**: 本 header + 對應中文報告為當前 gate-state 權威。**①② 全過（① Arch `APPROVED_WITH_LOCKS` + ② `CODEX_PLAN_APPROVED`，皆 0 material）**；下一步＝**owner 明示 `CODING_ALLOWED`** 才動 4 source（gate 由 owner 送、Claude 不自跑）。type-only、零 migration、無 schema 自動部署風險。

**base**: `157dbb88`（origin/main，#142 PR-2dp admin oauth-clients SHIPPED 後）
**級別**: **L2 implementation + L3 security review**（實作純 type-only 屬 L2；但 4 檔為 OAuth authorization-code issuance〔authorize/token/code〕+ RP-initiated logout〔end-session〕Tier-0 端點，治理與審查輸出升 L3 security-context）
**性質**: 純 type-only noImplicitAny 標註（`authorize.ts` **5→0** · `token.ts` **4→0** · `code.ts` **2→0** · `end-session.ts` **9→0**；合 **20→0**）、byte-identical emit（esbuild stdin-pipe 實證）、**零 runtime / 零 schema / 零 API / 零 migration / 零部署面 / 零 test 改動 / 零 env.d.ts / 零新 interface / 零 export**。4 檔為 OAuth flow 端點（PKCE / silent SSO / auth-code exchange / OIDC id_token / refresh 撤銷 / backchannel logout），本棒僅描述型別、runtime 一字不改（byte-identical 坐實 first-do-no-harm）。

**owner ruling（2026-07-09）**: 採 scout overlay 實測縫（**非**起手設想）——棒3a=**clean-4**（`authorize/token/code/end-session`）、棒3b=**dirty-2**（`init/bind-email`，另棒）。理由：`end-session` 不呼 `getProvider`、tests 不多帶 ctx 屬性 → 屬乾淨組；`init/bind-email` 為 `getProvider` caller + tests 傳完整 EventContext literal → 屬 dirty 組（卡 env.d.ts R1 blocker，另棒）。禁 full-6 直接進 implementation（`ADDED=9` + 觸 env.d.ts type-surface）。微決策 4 項全採；env.d.ts R1 走**獨立治理棒 `棒3-env`（S2）**、先於棒3b/棒4。

> ⚠ 本棒 **tree 非 fully clean**：`CLEANUP_PLAN.md`（pre-existing untracked）+ 本 plan doc（untracked）。gate evidence 的 net source diff **只計本棒 4 scoped 檔**，pre-existing 項不納入。

---

## 1. Scope 與 locks

**SCOPE（owner SCOPE-LOCK / ARCH-3A-L1）**: **4 source**
- `functions/api/auth/oauth/authorize.ts`（PKCE/OIDC 授權入口 + silent SSO + rate-limit + pkce_sessions 寫入）
- `functions/api/auth/oauth/token.ts`（authorization-code → access/refresh/id_token exchange，Tier-0 issuance）
- `functions/api/auth/oauth/code.ts`（login 後鑄一次性 auth_code）
- `functions/api/auth/oauth/end-session.ts`（OIDC RP-Initiated Logout：id_token_hint 驗簽 + refresh 撤銷 + frontchannel iframe + backchannel dispatch）
- （+ 本 plan doc companion，per stage7 慣例）

**20 noImplicitAny → 0**（forced tsc `-b tsconfig.solution.json --pretty false --force` 實證，base `157dbb88`；**zero dual-leaf**，全 TS70xx functions-leaf ×1）：

### 1.1 `authorize.ts`（5：3 TS7006 + 2 TS7031）
| loc（base） | error | form |
|---|---|---|
| 56,31 | TS7006 `uri` | `function isAllowedRedirectUri(uri: string)`（caller post-guard string；`getAllowedRedirectUris().includes(uri)` 要 string）|
| 66,25 | TS7006 `raw` | `function normalizeScope(raw: string \| null)`（caller = `params.get('scope')`）|
| **68,58**（cascade） | TS7006 `s` | **由 `raw: string \| null` 消**：`if (!raw) return null` 後 `raw.split(/\s+/)` → `string[]` → `.filter(s => …)` 之 `s: string` 自動推得（1 annotation 清 2 錯）|
| 72,38 / 72,47 | TS7031 `request` / `env` | `onRequestGet({ request, env }: { request: Request; env: Env })` |

### 1.2 `token.ts`（4：4 TS7031）
| loc（base） | error | form |
|---|---|---|
| 43,42 / 43,51 | TS7031 `request` / `env` | `onRequestOptions({ request, env }: { request: Request; env: Env })` |
| 50,39 / 50,48 | TS7031 `request` / `env` | `onRequestPost({ request, env }: { request: Request; env: Env })` |

> `token.ts` 既有 inline type（`responseBody` / `idTokenPayload`）為前棒殘留、非本棒觸點；`body = await request.json()`（`any` boundary）+ `const { code, code_verifier, redirect_uri } = body ?? {}` 為 variable destructure（非 param binding）→ 不觸 TS7031、不標。

### 1.3 `code.ts`（2：2 TS7031）
| loc（base） | error | form |
|---|---|---|
| 22,39 / 22,48 | TS7031 `request` / `env` | `onRequestPost({ request, env }: { request: Request; env: Env })` |

### 1.4 `end-session.ts`（9：6 TS7006 + 3 TS7031）
| loc（base） | error | form |
|---|---|---|
| 34,18 | TS7006 `s` | `function escAttr(s: string)`（callers 全 string：`getFrontchannelUris()` element + `finalRedirect`）|
| 39,33 | TS7006 `uri` | `function isAllowedPostLogoutUri(uri: unknown)`（內部 `typeof uri === 'string'` narrow；**鏡像 PR-2dp `isHttpsOrChiyigoScheme(uri: unknown): boolean`**）|
| 44,40 / 44,49 | TS7006 `idToken` / `env` | `async function verifyIdTokenHintGetSub(idToken: string \| null, env: Env)`（caller = `searchParams.get('id_token_hint')`；`env` 傳 `getPublicJwks(env: JwtVerifyEnv)`，Env→JwtVerifyEnv **assignable**、無 TS2559）|
| 63,28 / 63,36 | TS7006 `header` / `name` | `function parseCookieHeader(header: string \| null, name: string)`（caller = `request.headers.get('Cookie')` + literal name）|
| 69,38 / 69,47 / 69,52 | TS7031 `request` / `env` / `waitUntil` | `onRequestGet({ request, env, waitUntil }: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void })`（**waitUntil? 照抄既有 precedent `auth/local/forgot-password.ts:23` / `register.ts:29`**）|

> **type surface（zero 新 named interface、zero export）**：5 handler-ctx inline 標註〔authorize 1 + token 2 + code 1 + end-session 1，涵蓋 11 TS7031〕+ 6 helper/param 標註〔`uri: string` / `raw: string\|null`（連帶清 `s`）/ `s: string`(escAttr) / `uri: unknown` / `idToken: string\|null` + `env: Env` / `header: string\|null` + `name: string`〕。`Env` / `Request` 為 global ambient（4 檔未 import；overlay ADDED=0 反證解析）。4 檔為 leaf route handler、**zero export type/interface** → 型別面全 module-local（production 僅 Pages router 觸發；integration test 以 value import `onRequest*`，故 CASCADE-LOCK 含 tests-leaf，見 NB-1）。

### 1.5 Block locks（① `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 2026-07-09 逐字落地；owner 8 條）

| Lock | 內容 |
|---|---|
| **ARCH-3A-L1 SCOPE-LOCK** | 只改 4 個 source 檔：`authorize/token/code/end-session`。不得碰 `init/bind-email/callback/env.d.ts/tests/utils/schema/migration`。 |
| **ARCH-3A-L2 TYPE-ONLY-LOCK** | 只允許補 handler ctx、helper 參數、回傳相關 type annotation。不得新增 interface、export、runtime branch、validation、normalization。 |
| **ARCH-3A-L3 BYTE-IDENTICAL-LOCK** | 4 檔 esbuild stdin-pipe 檢查必須非 vacuous，輸出 byte size > 0，且 byte-identical。 |
| **ARCH-3A-L4 CASCADE-LOCK** | `tsc -b tsconfig.solution.json --force` 必須 `REMOVED=20 / ADDED=0`；若出現 tests-leaf 或 env cascade，立即退回。 |
| **ARCH-3A-L5 SECURITY-SEPARATION-LOCK** | 不得改 OAuth authorization code、PKCE、token exchange、logout、backchannel、audit、cookie/session 邏輯。 |
| **ARCH-3A-L6 NO-ENV-SURFACE-LOCK** | 棒3a 不得處理 `ProviderSecretsEnv`、`Env` assignability、OAuth secret keys。 |
| **ARCH-3A-L7 FRESH-REPLAY-LOCK** | Codex Plan / Code gate 必須用 fresh source commit 重跑，不接受 scout overlay 當唯一證據。 |
| **ARCH-3A-L8 DOC-LOCK** | plan doc 可記錄 scout 結論，但不得把 3b OD 包成 3a scope。 |

## 2. SSOT 對齊（每個型別決策的真相源）

- **handler-ctx（11 TS7031；zero OD）**：既定 idiom、全 codebase 壓倒性一致（`{ request: Request; env: Env }`〔no-params〕**近百處**〔`grep` 量法對空白/換行敏感，本地與 ② Codex 分別實測 98 / 95〕、`+params: Record<string, string>` **×32**〔兩端一致〕；⚠ **精確計數非 load-bearing，compiler overlay `ADDED=0` 為決定性證據**）：
  - `{ request, env }: { request: Request; env: Env }`（authorize GET / token OPTIONS+POST / code POST；4 端點無 `[...]` route param）。
  - `end-session` onRequestGet 額外 destructure `waitUntil` → `{ request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void }`。**waitUntil? optional 對應 runtime `if (typeof waitUntil === 'function')` guard**（dev fallback 走同步 await），且**照抄既有 precedent**（`auth/local/forgot-password.ts:23` / `register.ts:29` 逐字同型、`_middleware.ts:33` 同簽名）→ 非新 shape、不抽 shared type。
  - `Env` / `Request` 為 global ambient（`types/env.d.ts` + WebWorker lib）、4 檔沿慣例不 import；overlay ADDED=0 反證解析。

- **`isAllowedPostLogoutUri(uri: unknown)`（end-session；PR-2dp analog）**：內部 `typeof uri === 'string' && getAllowedPostLogoutUris().includes(uri)` 自行 narrow → param 誠實標 `unknown`（外部 redirect_uri 為 untrusted boundary）。**與 PR-2dp `isHttpsOrChiyigoScheme(uri: unknown): boolean` 同性質**（有 typeof guard 支撐、不宣稱 validated、return-type annotation 於 emit 抹除）。caller `isAllowedPostLogoutUri(postLogoutRedirectUri)`（string）assignable（contravariance）。

- **`isAllowedRedirectUri(uri: string)`（authorize；非 unknown）**：與 end-session 的 unknown-guard **刻意不同**——此 helper 內部 `getAllowedRedirectUris().includes(uri)`（`string[].includes` 要 string）+ `/regex/.test(uri)`，且 caller 於 L95 `if (!redirectUri || …) return 400` 後才呼叫（post-guard 必 string）→ `uri: string` 為精確型（若標 `unknown` 反觸 `.includes(uri)` TS2345）。**caller-faithful，非 boundary helper**。

- **`normalizeScope(raw: string | null)`（authorize；連帶清 `s`）**：caller = `params.get('scope')`（`string | null`）。內部 `if (!raw) return null` 後 `raw.split(/\s+/).filter(Boolean).filter(s => KNOWN_SCOPES.has(s))` → `s` 自 `string[]` element 推得 `string`（**1 annotation 清 2 錯**，file-internal cascade、非跨檔）。

- **`verifyIdTokenHintGetSub(idToken: string | null, env: Env)`（end-session）**：`idToken` caller = `searchParams.get('id_token_hint')`（`string | null`）；內部 `if (!idToken || typeof idToken !== 'string') return null`。`env: Env` 傳 `getPublicJwks(env)`——**⚠ 關鍵區別於 init/bind-email 的 getProvider**：`getPublicJwks(env: JwtVerifyEnv)` 的 `JwtVerifyEnv = Partial<Pick<Env, 'JWT_PUBLIC_KEYS' | 'JWT_PUBLIC_KEY'>>`（jwt.ts:35，JWT public/verify key，**非** signing key）**與 Env 有重疊屬性**（`JWT_PUBLIC_KEY` required + `JWT_PUBLIC_KEYS?` optional 皆宣告於 env.d.ts:30-31），故 `Env` **assignable to `JwtVerifyEnv`**、**無 TS2559**（clean-4 overlay ADDED=0 坐實）。此即 end-session 歸乾淨組、init/bind-email 歸 dirty 組的型別根據。

- **`escAttr(s: string)` / `parseCookieHeader(header: string | null, name: string)`（end-session）**：caller-faithful——escAttr callers 全 string（`getFrontchannelUris()` element + `finalRedirect`）；parseCookieHeader caller = `request.headers.get('Cookie')`（string|null）+ literal name。`String(s)` / `if (!header)` 既有 runtime 不動。

## 3. 證據（scout transient overlay 實測 @ working-tree `157dbb88`，已 `git checkout --` 還原、**overlay 零殘留**；CODE stage 於 source commit **fresh replay** 重證，ARCH-3A-L7）

**A. forced tsc set-diff** — `npx tsc -b tsconfig.solution.json --pretty false --force`（uniq set、`sort -u` 後 `comm`）：
- base error set = **434**（= ratchet report 434/24/311）。
- 套 4 檔 type-affecting overlay → **414**；set-diff **REMOVED=20**（精確：authorize 5 + token 4 + code 2 + end-session 9、全 TS70xx〔9 TS7006 + 11 TS7031〕）/ **ADDED=0**（全 solution、含 tests-leaf；[[feedback_tsc_forced_solution_dual_leaf_error_count]]）。errorFiles 24→20、cleanFiles 311→315（CODE stage 重跑確認）。baseline `1119/175` frozen（reduce 禁 `--update`）。
- **cascade 結論**：clean-4 combo（handler-ctx + primitive/unknown param）**零 cascade**——無 test-mock、無 consumer、無內部 narrow cascade。與 full-6 對照坐實：**full-6 overlay REMOVED=26 但 ADDED=9**（2×TS2559 `getProvider(env)` @ init/bind-email + 7×TS2353 test 傳完整 EventContext literal @ init/bind-email tests）；**9 個 ADDED 全在 init/bind-email 及其 tests、與本棒 4 檔零交集** → clean-4 自成乾淨集（此為 overlay 直接坐實、**非推斷**）。

**B. byte-identical emit**（esbuild stdin-pipe、before==after、**非 vacuous**）：
| 檔 | base==head bytes | 結果 |
|---|---|---|
| `authorize.ts` | 4228 == 4228 | ✅ IDENTICAL |
| `token.ts` | 6437 == 6437 | ✅ IDENTICAL |
| `code.ts` | 1745 == 1745 | ✅ IDENTICAL |
| `end-session.ts` | 5404 == 5404 | ✅ IDENTICAL |
> RUNTIME-LOCK（ARCH-3A-L3/L5）坐實（PKCE / silent SSO / auth-code exchange / id_token 簽發 / refresh 撤銷 / backchannel dispatch / rate-limit / audit / cookie 100% 未動；interface 無、return type / `as` cast 無、參數註記 / 註解全於 emit 抹除）。
> **⚠ 驗法（[[feedback_byte_identical_emit_verification]]）**：byte-identical **必走 Git Bash stdin-pipe** — `git show HEAD:<f> | node_modules/.bin/esbuild --loader=ts --format=esm` vs `cat <f> | node_modules/.bin/esbuild --loader=ts --format=esm`，逐一 `cmp -s`。canonical recipe **必含 `--format=esm`**；`--loader=ts` 對 **file-arg 會 error → 0-byte vacuous 假 pass**，故必驗 **byte > 0**（本棒 4 檔皆 >0、sha ≠ empty-string sha `e3b0c442…`）。PowerShell 5.1 無 `<` stdin redirection、命令走 Git Bash。**⚠ ② Codex 環境 `bash` 不在 PATH（② non-blocking note）**：CODE / ③ Code Gate replay 須用明確路徑 `C:\Program Files\Git\bin\bash.exe`，或改走 esbuild JS transform fallback（`node` 呼 esbuild `transform` API 對等驗 type-erasure output）。

**C. transient revert clean**：`git checkout -- functions/api/auth/oauth/authorize.ts functions/api/auth/oauth/token.ts functions/api/auth/oauth/code.ts functions/api/auth/oauth/end-session.ts` → `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（pre-existing）+ 本 plan doc（untracked）、`git diff --stat HEAD` 空（未 commit、零殘留）、HEAD 未動 `157dbb88`、ratchet 還原後仍 434/24/311。

## 4. 本地機械 gate（CODE stage 全套實跑；對齊 CI `ci.yml`；ARCH-3A-L7＝禁沿用 overlay）

CODE stage @ final source commit 必跑並讀真實輸出：`typecheck:ratchet`（enforce、baseline `1119/175` frozen 未 `--update`；帶 `RATCHET_BASE_REF=$(git rev-parse main)`；report 應 434→414）· `lint`（eslint + lint:workflows）· `verify:browser-pipeline` · `test:cov` · `test:int`〔含觸及本 4 檔的 integration test — TEST-LOCK 下不改；clean-4 overlay ADDED=0 已含 tests-leaf 反證無新型別錯〕· `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。另 **REPLAY**：forced tsc set-diff（`REMOVED=20 / ADDED=0`、全 solution、dual-leaf-aware）+ byte-identical（esbuild stdin-pipe before==after、4 檔非 0 byte）於 **source commit fresh replay**。Windows `public/` CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。
> known flaky `jwt.test.ts`（~1.6%/run）撞到即 rerun。

## 5. Open Decisions / owner ruling（2026-07-09）

| 項 | 裁決 | SoT / 理由 |
|---|---|---|
| 拆棒 | **採 scout overlay 縫：棒3a=clean-4（authorize/token/code/end-session）** | overlay 逼出——含 init/bind-email 必卡 env.d.ts R1 blocker；clean-4 是「零跨模組改動下 ADDED=0 可達的最大集」。禁 full-6（ADDED=9 + 觸 env.d.ts）|
| 級別 | **L2 impl + L3 security review** | 實作純 type-only；審查因 OAuth issuance/logout/Tier-0 邊界升 L3 security-context |
| **微決策 escAttr** | **`s: string`** | callers 全 string；用 `unknown` 會假裝存在外部輸入邊界、反擴 scope |
| **微決策 verifyIdTokenHintGetSub** | **`idToken: string \| null, env: Env`** | `searchParams.get()` 原生回 `string \| null`、caller-faithful；env: Env → getPublicJwks(JwtVerifyEnv) assignable |
| **微決策 waitUntil** | **`waitUntil?: (promise: Promise<unknown>) => void`** | end-session 需要；optional 對應 runtime typeof guard、避免 over-model Pages context；照抄既有 precedent |
| **微決策 handler ctx** | **採既有 convention**（`{ request: Request; env: Env }` 或含 waitUntil?） | 不抽新 shared type |

### 5.1 風險表（① ChatGPT Arch 輸出 / 防禦表）
| 機制 | 處理否 | 實作 | 未處理原因 |
|---|---|---|---|
| 權限 / OAuth flow | 是 | 明鎖 runtime zero-change（byte-identical）| 不新增授權邏輯 |
| Input | 是 | 只標現有 caller type，不新增 parse/validate | 非本棒 scope |
| XSS | 是 | `escAttr(s: string)` 僅補型、輸出不變 | 不改 escaping 實作 |
| Log / Audit | 是 | 禁改 audit/backchannel/logout 行為 | 非本棒 scope |
| Retry / 備援 | 不處理 | 無 runtime 變更 | noImplicitAny 棒不碰流程 |
| 監控 | 不處理 | 無 runtime 變更 | 非本棒 scope |
| Type cascade | 是 | `REMOVED=20 / ADDED=0` lock（ARCH-3A-L4）| 3b cascade 另棒處理 |
| Env surface | 是 | 棒3a 禁碰（ARCH-3A-L6）；3-env 另棒 | 避免 scope creep |

### 5.2 Gate 收據
- **scout overlay 實測**（2026-07-09 @ `157dbb88`）：clean-4 REMOVED=20 / ADDED=0 · byte-identical 4 檔（4228/6437/1745/5404、非 vacuous）· transient revert clean。full-6 對照 REMOVED=26/ADDED=9（cascade 全在 init/bind-email，坐實 clean-4 縫）。
- **owner 拆棒 + 微決策 + OD 裁決**（2026-07-09）：採 overlay 縫（棒3a=clean-4）；微決策 4 項全採；OD-3b 方向（R1 / index-sig / buf cast）；env.d.ts R1 走獨立治理棒 `棒3-env`（S2）先於棒3b/棒4。
- **① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（2026-07-09；**僅批棒3a、≠ `CODING_ALLOWED`、≠ 可 commit、≠ 可改 repo**）：8 lock（ARCH-3A-L1..L8）落地本 §1.5。**不批 full-6、不納 init/bind-email 進棒3a、不納 env.d.ts 進棒3a、不授權 coding/commit/merge**。可送 ② Codex Plan。
- **② `CODEX_PLAN_APPROVED`**（2026-07-09 @ plan doc；**plan only、≠ `CODING_ALLOWED`、≠ commit/PR/merge/release**）：**0 material finding**。Codex live-repo 獨立重證：`HEAD`=`157dbb885ca9df05c56875ca24e32f6b66de119f`、working-tree source diff 空（untracked 僅 `CLEANUP_PLAN.md` + 本 plan doc）；forced tsc base **434**、scoped 4 檔恰 **20 TS70xx**；in-memory clean-4 overlay **base 434 / overlay 414 / REMOVED=20 / ADDED=0**；esbuild type-erasure replay byte 全 match（authorize 4228 / token 6437 / code 1745 / end-session 5404、output-identical）；ratchet **434/24/311**；test call-site search 佐證 clean split（clean-4 exact/subset ctx、dirty init/bind-email rich ctx）。**3 non-blocking note**：① `TS-GOV-MANIFEST` — repo 無 TS governance manifest → enforcement `not enforced`、approval 基於 live compiler/diff 證據（standing、同 PR-2do/2dp）；② idiom no-params count Codex 量 95 vs 本地 98（量法敏感、非 load-bearing、compiler overlay 決定性）— **已軟化 §2**；③ ② 環境 `bash` 不在 PATH（Git Bash `C:\Program Files\Git\bin\bash.exe`）→ handoff/replay 用明確路徑或 esbuild JS transform fallback — **已補 §3.B**。
- **授權邊界**：**①② 全過（① Arch `APPROVED_WITH_LOCKS` + ② `CODEX_PLAN_APPROVED`，皆 0 material）**。下一步＝**owner 明示 `CODING_ALLOWED`** 才動 4 source；CODE stage 必 fresh replay（ARCH-3A-L7）+ 跑齊機械 gate（§4）。**未 push / 無 PR / 未 commit。**

## 6. 非 blocking notes
- **NB-1**：4 檔為 leaf route handler、**zero export type/interface**（同 PR-2dp、不同 PR-2do 之 `OAuthClient` export）——production 僅 Pages router 觸發、**無跨模組 public type contract**。⚠ integration test 確以 **value** import `onRequest*` handler（如 `tests/integration/end-session.test.ts`、`pkce-flow.test.ts`、`rate-limit-e3.test.ts` 等），故 CASCADE-LOCK（ARCH-3A-L4）**必含 tests-leaf**；clean-4 overlay ADDED=0 已全 solution（含 tests-leaf）涵蓋、且該些 test 皆傳 exact/subset ctx literal（非 rich EventContext）→ 不觸 excess-property（對照 NB-2）。
- **NB-2**：`end-session` 用 **exact-inline ctx**（`{ request, env, waitUntil? }`，overlay ADDED=0 坐實）；init/bind-email（棒3b）因 tests 傳完整 EventContext literal（`{ request, env, params, waitUntil, data, next }`）必須改用 **index-signature ctx**（OD-3b-2）。差異根源＝哪些 tests 傳 rich ctx literal；本棒 4 檔的 tests 皆傳 exact/subset shape → 不觸 excess-property check。
- **NB-3**：`token.ts` 既有 `responseBody` / `idTokenPayload` inline type 為前棒殘留、非本棒觸點；本棒僅補 2 handler-ctx（onRequestOptions + onRequestPost）。
- **NB-4**：`end-session` 的 `env: Env` 傳 `getPublicJwks(env: JwtVerifyEnv)`——`JwtVerifyEnv` 非零重疊 weak type、Env assignable、無 TS2559（**與 init/bind-email 的 `getProvider(env: ProviderSecretsEnv)` 弱型不符 crux 明確區別**；後者屬棒3b + `棒3-env` R1）。
- **NB-5**：shipped 集 = 4 source + 本 plan doc companion（per stage7 慣例、ARCH-3A-L8 DOC-LOCK）；owner CODE 前可否決 plan doc companion。
- **NB-6**：本棒不觸 LINE id_token hardening（棒5、`callback.ts` verifyLineIdToken；runtime/security 行為變更、與 byte-identical type-only 互斥）。

## 7. 後續棒次（owner 2026-07-09 序列，S2）
- 棒1 oauth utils（33）✅ PR-2do SHIPPED → 棒2 admin oauth-clients pair（19）✅ PR-2dp SHIPPED → **本棒 棒3a flow issuance clean-4（20；PR-2dq）** → **`棒3-env`（types/env.d.ts 加 10 個 optional OAuth secret key；R1 治理棒，閉合 PR-2do NB-2 gap、解棒3b/棒4 `getProvider` blocker）** → **棒3b init/bind-email（6；index-sig ctx + buf cast）** → **棒4 callback.ts（27；Tier-0 最重，R1 已解其 getProvider blocker）** → **棒5 LINE id_token hardening（獨立 additive-security、非 type-only）**。
- oauth 域（105）清完 → **audit 域（381，殿後最重，含 F-3 DORMANT）** → noImplicitAny=0 後 rebaseline `1119→0` → `strict:true`(~998) → scripts → tests → browser。

---

## Index receipt（archive 用；本檔結案後搬 MEMORY 對應）
- 清 oauth flow issuance clean-4 4 檔 20 noImplicitAny → 0（authorize 5 + token 4 + code 2 + end-session 9；9 TS7006 + 11 TS7031、zero dual-leaf）；REMOVED=20 / ADDED=0、byte-identical（4228/6437/1745/5404）。
- 微決策：escAttr `s: string`、verifyIdTokenHintGetSub `idToken: string|null` + `env: Env`（getPublicJwks JwtVerifyEnv assignable、無 TS2559）、waitUntil? optional（precedent forgot-password/register）、handler-ctx 既有 idiom；isAllowedPostLogoutUri `uri: unknown`（PR-2dp analog）、isAllowedRedirectUri `uri: string`（caller-faithful 非 boundary）。
- 拆棒＝overlay 縫（clean-4）；full-6 ADDED=9 全在 init/bind-email（TS2559 getProvider + TS2353 test ctx）→ 棒3b + `棒3-env`(R1) 另棒。zero export、zero named interface、zero env.d.ts。
- ARCH-3A-L1..L8（SCOPE / TYPE-ONLY / BYTE-IDENTICAL / CASCADE / SECURITY-SEPARATION / NO-ENV-SURFACE / FRESH-REPLAY / DOC）。
