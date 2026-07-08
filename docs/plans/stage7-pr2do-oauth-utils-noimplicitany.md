# Stage 7 PR-2do — noImplicitAny 續清（oauth domain 首棒：utils leaf）

**SPEC**: `STAGE7_OAUTH_UTILS_NOIMPLICITANY`
**狀態**: `CODEX_CODE_APPROVED · AWAITING ④ FAITHFULNESS`（**①②③ Gate 全過 + CODE committed `7cf741cc`** 2026-07-08：① `ARCH_APPROVED_WITH_LOCKS` + ② `CODEX_PLAN_APPROVED` → `CODING_ALLOWED` → CODE `7cf741cc`〔ARCH-L12 fresh-replay green〔REMOVED=33/ADDED=0、byte-identical 2479/6614/3442、ratchet enforce OK〕+ CODE self-review 2-lens 收斂〕→ **③ `CODEX_CODE_APPROVED`〔0 material、Codex live-verify〕**；**未 push / 無 PR / 未 merge**；⚠ tree **非 fully clean** — pre-existing untracked `CLEANUP_PLAN.md` + gitignored `.tscache/`/`*.tsbuildinfo`，見下方 ⚠）
> **gate 進程**: scout（domain 分帳 486=105 oauth+381 audit、oauth 12 檔 105 錯 zero-dual-leaf）→ **transient overlay 實測**（`REMOVED=33 / ADDED=0` + 3 檔 byte-identical + eslint 0，已 `git checkout --` 還原、**overlay 零殘留**〔tree 非 fully clean，見下方 ⚠〕）→ owner **OD-1..OD-5 全裁**（含 OD-5=F ProviderSecretsEnv 窄型）→ **本 plan doc** → **① ChatGPT Arch ✅ `APPROVED_WITH_LOCKS`（ARCH-L1/L2 回寫）** → **② Codex Plan ✅ `CODEX_PLAN_APPROVED`（0 material）** → owner `CODING_ALLOWED` ✅ → **CODE committed `7cf741cc`（ARCH-L12 fresh-replay green + CODE self-review 收斂）** → **③ Codex Code ✅ `CODEX_CODE_APPROVED`（0 material、live-verify）** → 待送 ④ ChatGPT faithfulness → squash。
> **狀態 SoT**: 本 header + 對應中文報告為當前 gate-state 權威。**①②③ Gate 全過（① Arch + ② Plan + ③ Code）+ CODE committed `7cf741cc`；尚未 push / 無 PR / 未 merge**。下一步＝送 **④ ChatGPT faithfulness Gate**（最後一道 gate）。

**base**: `b59451b1`（origin/main，#140 PR-2dn auth SHIPPED 後）
**性質**: 純 type-only noImplicitAny 標註（`oauth-session.ts` **15→0** · `oauth-clients.ts` **8→0** · `oauth-providers.ts` **10→0**；合 **33→0**）、byte-identical emit（esbuild stdin-pipe 實證）、**零 runtime / 零 schema / 零 API / 零 migration / 零部署面 / 零 test 改動**。oauth 域含 Tier-0 issuance handler，但本棒僅觸 **utils leaf**（silent SSO helper / client registry / provider config），型別只描述、runtime 一字不改。

**owner ruling（2026-07-08）**: 5 棒序（本棒＝首棒 utils leaf → 棒2 admin RBAC pair → 棒3 flow handlers → 棒4 callback.ts → 棒5 LINE hardening 獨立安全棒）｜級別 **L2 + OAuth security context locks**｜OD-1 unknown-boundary + provider-specific erased interface｜OD-2 D1 row/domain 分離｜OD-3 callback 棒4 consume（`ProviderConfig` **module-local**；棒4 透過 `getProvider()` return shape consume）｜**OD-5 = F**（`ProviderSecretsEnv` 窄型，非 full `Env`）。

> ⚠ 本棒 **tree 非 fully clean**：`CLEANUP_PLAN.md`（pre-existing untracked）+ `.tscache/`、`*.tsbuildinfo`（gitignored build artifact）為 **pre-existing dirty**。gate evidence 的 net source diff **只計本棒 3 scoped 檔**，pre-existing 項不納入。

---

## 1. Scope 與 locks

**SCOPE（owner SCOPE-LOCK）**: **3 source**
- `functions/utils/oauth-session.ts`（silent SSO helper：`readRefreshCookie` / `findActiveUserByRefreshCookie` / `isWithinMaxAge` / `issueAuthCodeAndBuildRedirect` / `buildLoginRequiredRedirect`）
- `functions/utils/oauth-clients.ts`（OAuth/OIDC client registry：`OAuthClient` 型別 / `IN_CODE_CLIENTS` / `rowToClient` / `refreshClientsCache` / `invalidateClientsCache` / `getClient` / `flat`）
- `functions/utils/oauth-providers.ts`（provider config：`ProviderConfig` / 5 provider / `getProvider` / `ProviderSecretsEnv`）
- （+ 本 plan doc companion，per stage7 慣例）

**33 noImplicitAny → 0**（forced tsc 實證，base `b59451b1`；zero dual-leaf，全 TS70xx 只在 functions-leaf ×1）：

### 1.1 `oauth-session.ts`（15：8 TS7006 + 7 TS7031）
| loc（base） | cleared | form |
|---|---|---|
| 15,35 | TS7006 `cookieHeader` | `readRefreshCookie(cookieHeader: string \| null)` |
| 33,53 / 33,58 | TS7006 `env` / `refreshToken` | `findActiveUserByRefreshCookie(env: Env, refreshToken: string \| null)` |
| 64,32 / 64,42 | TS7006 `authTime` / `maxAgeSeconds` | `isWithinMaxAge(authTime: string \| null, maxAgeSeconds: number \| null)` |
| 81,53 | TS7006 `env` | `issueAuthCodeAndBuildRedirect(env: Env, {...})` |
| 82,3/11/24/39/46/53/60 | TS7031 ×7（`userId`/`redirectUri`/`codeChallenge`/`state`/`scope`/`nonce`/`authTime`） | inline options 型別（見 §2） |
| 107,44 / 107,57 | TS7006 `redirectUri` / `state` | `buildLoginRequiredRedirect(redirectUri: string, state: string)` |

### 1.2 `oauth-clients.ts`（8：7 TS7006 + 1 TS7053）
| loc（base） | cleared | form |
|---|---|---|
| 20-29 JSDoc typedef | —（enabler） | 轉真 `export interface OAuthClient {...}`（見 §2） |
| 32 | —（enabler） | `export const IN_CODE_CLIENTS: OAuthClient[] = [` |
| 102,22 | TS7006 `row` | `rowToClient(row: Record<string, unknown>): OAuthClient` + erased cast（OD-2） |
| 103,14 / 103,17 | TS7006 `s` / `def` | `j = (s: string \| null, def: string[]): string[]` |
| 127,43 | TS7006 `env` | `refreshClientsCache(env: Env, force = false)` |
| 175,46 | TS7006 `env` | `invalidateClientsCache(env: Env)` |
| 191,27 | TS7006 `clientId` | `getClient(clientId: string)` |
| 224,15 / 224,52 | TS7006 `key` / **TS7053** `c[key]` | `flat = (key: 'origins' \| 'redirect_uris' \| 'post_logout_redirect_uris' \| 'frontchannel_logout_uris')` |

### 1.3 `oauth-providers.ts`（10：7 TS7006 + 2 TS7018 + 1 TS7053）
| loc（base） | cleared | form |
|---|---|---|
| （header 前，new） | —（enabler） | 7 interface：`NormalizedProfile` / `RawDiscordProfile` / `RawGoogleProfile` / `RawLineProfile` / `RawFacebookProfile` / `RawAppleProfile` / `ProviderConfig`（見 §2） |
| 11 | —（enabler；清 TS7018 + 5×raw TS7006 contextual + 112 index） | `const PROVIDERS: Record<string, ProviderConfig> = {` |
| 19/38/55/72/92 | TS7006 `raw` ×5 | 各 normalizeProfile 內 inline `(raw as RawXProfile)` erased cast（OD-1） |
| 89 / 98 | TS7018 `userInfoUrl` / `avatar`（null-prop） | 由 `ProviderConfig` contextual type 消（`userInfoUrl: string\|null` / `NormalizedProfile.avatar: string\|null`） |
| 111,29 / 111,35 | TS7006 `name` / `env` | `getProvider(name: string, env: ProviderSecretsEnv)`（OD-5=F） |
| 112,15 | **TS7053** `PROVIDERS[name?.toLowerCase()]` | 由 `name: string` + `PROVIDERS: Record<string, ProviderConfig>` 消 |
| （118/119 env 動態存取，base 非錯） | —（防 ADDED） | `env[\`${upper}_CLIENT_ID\` as keyof ProviderSecretsEnv]`（erased，byte-identical） |

**Block locks（owner ruling 2026-07-08 逐字落地）**：

| Lock | 內容 |
|---|---|
| **SCOPE-LOCK** | 僅 3 source（`oauth-session.ts` / `oauth-clients.ts` / `oauth-providers.ts`）+ plan doc companion。**禁改** consumer（callback / authorize / token / end-session / admin / `_middleware` / `cors` / `resolveAud` 等 getProvider·getClient·session-helper importer）、test、schema、migration、`env.d.ts`、`callback.ts`。 |
| **RUNTIME-LOCK** | 三檔 esbuild stdin-pipe emit 必 **byte-identical**（before==after，byte count **非 0**）；禁改任何 runtime branch / query / return value（`env.chiyigo_db` query / `JSON.parse` / `Array.isArray` fallback / `Number(userId)` / `?? null` / KV↔D1↔in-code 三層 fallback / `PROVIDERS` 值 / `env[...]` secret 讀取 / `trustEmail` / normalizeProfile 輸出欄位）。 |
| **TYPE-LOCK** | 僅新增 type annotation / interface / erased cast；不改 runtime。type surface = **9 interface**（`OAuthClient` + `NormalizedProfile` + `RawDiscordProfile` + `RawGoogleProfile` + `RawLineProfile` + `RawFacebookProfile` + `RawAppleProfile` + `ProviderConfig` + `ProviderSecretsEnv`）+ param/return 型別 + inline erased cast。**visibility（ARCH-L2 option B）**：僅 `OAuthClient` export（registry getter 回傳具名型別）；其餘 8 個（含 `ProviderConfig`）**module-local 不 export**，callback 棒4 透過 `getProvider()` return shape consume、不 import `ProviderConfig`。 |
| **UNKNOWN-BOUNDARY-LOCK**（OD-1） | provider raw profile 維持 `raw: unknown` boundary（`ProviderConfig.normalizeProfile(raw: unknown)`）+ provider-specific erased interface（`RawXProfile` 只描述**現讀欄位**含 nested `picture.data.url`）。**禁 `any`、禁把整包 raw 當 `Record<string,unknown>` 後一路點存取、禁新增 runtime validation。** |
| **DB-ROW-LOCK**（OD-2） | `rowToClient` 的 D1 row input 維持 `Record<string, unknown>`（boundary row，**不宣稱 validated domain object**）；輸出用 `OAuthClient` interface；必要處 erased `as string / string\|null` 維持 emit。 |
| **PROVIDER-SECRETS-ENV-LOCK**（OD-5=F） | 見下方 verbatim lock。 |
| **CASCADE-LOCK**（OD-3） | forced tsc set-diff 必 `REMOVED=33 / ADDED=0`（全 solution、dual-leaf-aware）。任何 consumer / test error 因 `ProviderConfig` / `OAuthClient` / `getProvider` 型別具體化而 ADDED>0 → **停 gate、回 plan review**。 |
| **TEST-LOCK** | **不改 test**、**不用 `as unknown as Env`** 修 mock。（OD-5=F 已使 test minimal mock + `{}` 保持 assignable，無需觸 test。） |

**PROVIDER-SECRETS-ENV-LOCK（owner verbatim，2026-07-08）**：
```text
OD-5 PROVIDER-SECRETS-ENV LOCK:
getProvider() must not require full Env because it only reads OAuth provider client id/secret
bindings and does not forward env to requireAuth or other full-Env consumers. Introduce a narrow
ProviderSecretsEnv interface in the scoped utils file with only the OAuth provider secret keys
currently read by getProvider(), all optional. Do not modify tests, env.d.ts, handlers, callback.ts,
or consumers for this OD. Production Env must remain assignable to ProviderSecretsEnv, and existing
minimal test mocks including {} must remain assignable. This must preserve REMOVED=33 / ADDED=0 and
byte-identical emit for all scoped files.
```

**ARCH locks（① `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 2026-07-08 逐字落地；L1/L2 為 required refinement，已回寫）**：

| Lock | 內容 | 對應 |
|---|---|---|
| **ARCH-L1** TYPE-SURFACE-COUNT | type surface = **9 interface**（非 8）：`OAuthClient` + `NormalizedProfile` + 5×`Raw*Profile` + `ProviderConfig` + `ProviderSecretsEnv`。 | ✅ 回寫（TYPE-LOCK） |
| **ARCH-L2** PROVIDERCONFIG-VISIBILITY | 凍結 **option B**：`ProviderConfig` **module-local 不 export**；callback 棒4 僅透過 `getProvider()` return shape consume（不 import）。唯一 export = `OAuthClient`。 | ✅ 回寫（TYPE-LOCK / §6 NB-1） |
| **ARCH-L3** SCOPE | CODE 僅改 3 source + plan doc companion；禁改 consumer / test / schema / migration / `env.d.ts` / callback。 | = SCOPE-LOCK |
| **ARCH-L4** RUNTIME | 3 檔 esbuild stdin-pipe emit 必 byte-identical 且 byte count 必非 0；**file-arg 0-byte 驗法不得使用**。 | = RUNTIME-LOCK |
| **ARCH-L5** TYPE | 只 type annotation / interface / erased cast；禁 runtime branch / query / return / fallback / provider config value 變更。 | = TYPE-LOCK |
| **ARCH-L6** UNKNOWN-BOUNDARY | `ProviderConfig.normalizeProfile(raw: unknown)` 固定；`Raw*Profile` 只描述現讀欄位；禁 `any` / 禁宣稱 validated。 | = UNKNOWN-BOUNDARY-LOCK |
| **ARCH-L7** DB-ROW | `rowToClient(row: Record<string, unknown>): OAuthClient` 固定；D1 row 是 boundary row，不宣稱 validated domain。 | = DB-ROW-LOCK |
| **ARCH-L8** PROVIDER-SECRETS-ENV | OD-5=F；`getProvider(name: string, env: ProviderSecretsEnv)`，10 optional secret key；不改 test / `env.d.ts` / handler / consumer。 | = PROVIDER-SECRETS-ENV-LOCK |
| **ARCH-L9** CASCADE | final source commit 必重跑 forced tsc set-diff `REMOVED=33 / ADDED=0`，全 solution、dual-leaf-aware。 | = CASCADE-LOCK |
| **ARCH-L10** TEST | 不改 test；不得用 `as unknown as Env` 修 mock。 | = TEST-LOCK |
| **ARCH-L11** SECURITY-SEPARATION | `callback.ts:620 verifyLineIdToken` hardening 必留棒5；任何 alg / iss / aud / sub / nonce runtime hardening 禁混入本棒。 | 新增（棒5 分離） |
| **ARCH-L12** REPLAY | CODE stage 禁沿用 overlay receipt；final source commit 必 **fresh replay**：ratchet / forced tsc set-diff / 3 檔 byte-identical / eslint / CI gates。 | 新增（CODE fresh replay） |

## 2. SSOT 對齊（每個型別決策的真相源）

- **`OAuthClient`（oauth-clients.ts；export）**：既有 JSDoc `@typedef OAuthClient`（base 20-29，`.ts` mode 下 inert、且 esbuild 丟棄註解）轉真 `export interface`。shape 由 `rowToClient` 回傳 + `IN_CODE_CLIENTS` seed 既定：`{ client_id: string; aud: string; origins: string[]; redirect_uris: string[]; post_logout_redirect_uris: string[]; frontchannel_logout_uris: string[]; backchannel_logout_uri: string | null }`。`IN_CODE_CLIENTS: OAuthClient[]` 提供 seed 型別；`flat` 的 key 收斂為 4 個 array-valued key union（`c[key]` → `string[]`，消 TS7053）。內部 consumer（`getClient`/`getValidAuds`/`getAudByOrigin`/deprecated const）+ external consumer（`cors`/`resolveAud`/`_middleware`）實測 ADDED=0（§3.A）。

- **`rowToClient(row: Record<string, unknown>): OAuthClient`（OD-2 DB-ROW-LOCK）**：D1 `.all()` results 為 boundary row（`Record<string, unknown>`），非 validated domain object。輸出 shape 用 `OAuthClient`；`row.client_id as string` / `(row.aud ?? row.client_id) as string` / `(row.backchannel_logout_uri ?? null) as string | null` 為 **erased cast**（emit 抹除 → byte-identical）；`j(s: string | null, def: string[]): string[]` + call-site `row.X as string | null`。cast 只反映 D1 TEXT column 契約，不宣稱已驗證。

- **`NormalizedProfile` + `ProviderConfig` + `Raw*Profile`（oauth-providers.ts；OD-1 UNKNOWN-BOUNDARY-LOCK）**：
  - `ProviderConfig.normalizeProfile(raw: unknown): NormalizedProfile` — **uniform honest boundary**：外部 OAuth profile JSON 為 untrusted → param 型別誠實標 `unknown`，provider-specific 解讀為 **local 顯式 erased cast** `(raw as RawXProfile).field`（emit 抹除 → byte-identical；`(raw as T).id` → `raw.id`）。**禁 `Record<string,unknown>` 直通**（會使 nested `raw.picture?.data?.url` 噴 TS18046）、**禁 per-method typed param**（會把 param 宣稱為 validated RawXProfile，隱藏信任邊界）。
  - `RawXProfile` 只列**現讀欄位**（discord: id/email/username/avatar/verified；google: sub/email/name/picture/email_verified；line: userId/email/displayName/pictureUrl；facebook: id/email/name/**picture.data.url** nested；apple: sub/email/name/email_verified）；欄位型別依 use site（`String(x)` / template `${x}` → `string | number`；其餘 `string | null` optional）。
  - `PROVIDERS: Record<string, ProviderConfig>` 提供 object literal contextual type → 消 TS7018 null-prop（`userInfoUrl: null` / apple `avatar: null`）+ 5×normalizeProfile `raw` contextual `unknown`（消 TS7006）+ `PROVIDERS[string]` 可解析（消 112 TS7053）。

- **`getProvider(name: string, env: ProviderSecretsEnv)`（OD-5=F PROVIDER-SECRETS-ENV-LOCK）**：`getProvider` 只讀 `env[\`${X}_CLIENT_ID/SECRET\`]` secret binding、**不 forward requireAuth** → 依 [[feedback_util_env_param_pick_not_full_env]] 邏輯採**窄型**（least privilege），非 full `Env`。`ProviderSecretsEnv` = 10 個 optional OAuth secret key（`{DISCORD,GOOGLE,LINE,FACEBOOK,APPLE}_CLIENT_{ID,SECRET}?: string`）。理由：
  - production `env: Env`（全 optional target）**assignable** → callback 等 consumer 零 cascade；
  - test minimal mock（`{ DISCORD_CLIENT_ID: 'd-id', ... }`）+ `getProvider('google', {})` **assignable** → **test 不需改**（避免 `as unknown as Env` 雙 cast，型別誠實度不降）；
  - 動態存取 `env[\`${upper}_CLIENT_ID\` as keyof ProviderSecretsEnv]` → value `string | undefined`（10 key 全 optional string）→ `?? null` → `string | null`，**免 result cast**；cast `as keyof ProviderSecretsEnv` 為 erased（emit → `env[\`${upper}_CLIENT_ID\`]`，byte-identical）。
  - **⚠ 對 `env: Env` 慣例的偏離**：owner 明裁此為凍結例外（getProvider 不 forward auth、只讀 secret；least privilege > 慣例一致）。OAuth secret 未宣告於 `env.d.ts` 為 pre-existing latent gap，**本棒不觸**（避免 A' 的 Env surface 變更）。

## 3. 證據（scout transient overlay 實測 @ working-tree `b59451b1`，已 `git checkout --` 還原、**overlay 零殘留**〔3 scoped 檔回 base；tree 非 fully clean，見 §性質 ⚠〕；CODE stage 於 source commit 重證）

**A. forced tsc set-diff** — `npx tsc -b tsconfig.solution.json --pretty false --force`（uniq set，`sort -u` 後 `comm`）：
- base error set = **486**（= ratchet report 486/29/306）。
- 套 3 檔 type-affecting overlay（option F）→ **453**；set-diff **REMOVED=33**（精確：oauth-session 15 + oauth-clients 8 + oauth-providers 10，全 TS70xx）/ **ADDED=0**（全 solution、含 tests-leaf；[[feedback_tsc_forced_solution_dual_leaf_error_count]]）。errorFiles 29→26、cleanFiles 306→309（CODE stage 重跑確認）。baseline `1119/175` frozen（reduce 禁 `--update`）。

**B. cascade 實證（compiler 當 oracle；OD-5 由此得出）** — 中途以 **option A（`getProvider(env: Env)`）** 探得 cascade：
| overlay 版本 | 結果 | 判讀 |
|---|---|---|
| option A（`env: Env`） | REMOVED=33 / **ADDED=23** | 23×TS2345 **全在 `tests/oauth-providers.test.ts`**（minimal mock env `{ DISCORD_CLIENT_ID: string, ... }` + `{}` 不 assignable 到 full `Env`；缺 `chiyigo_db`/JWT keys）；**production consumer 零 cascade** |
| **option F（`env: ProviderSecretsEnv`）** | **REMOVED=33 / ADDED=0** | 窄型使 production `Env` + test mock + `{}` 皆 assignable → **無 test 改動、無 cascade** |
> cascade 唯一命中點＝test mock（非 production）；option F 自洽在 3 檔內解決（OD-5=F）。**此為「實測不推斷」典例**：靜態分析無法斷言 test mock cascade，overlay 才掀出。

**C. byte-identical emit**（esbuild stdin-pipe、before==after、**非 vacuous**）：
| 檔 | base==head bytes | 結果 |
|---|---|---|
| `oauth-session.ts` | 2479 == 2479 | ✅ IDENTICAL |
| `oauth-clients.ts` | 6614 == 6614 | ✅ IDENTICAL |
| `oauth-providers.ts` | 3442 == 3442 | ✅ IDENTICAL |
> RUNTIME-LOCK 坐實（runtime branch / query / return / secret 讀取 / normalizeProfile 輸出 100% 未動；`import type` 無、interface / return type / `as` cast / 參數註記 / 註解全於 emit 抹除）。
> **⚠ 驗法（[[feedback_byte_identical_emit_verification]]）**：byte-identical **必走 Git Bash stdin-pipe** — `git show HEAD:<f> | node_modules/.bin/esbuild --loader=ts --format=esm` vs `cat <f> | node_modules/.bin/esbuild --loader=ts --format=esm`，逐一 `cmp -s`。canonical recipe **必含 `--format=esm`**；`--loader=ts` 對 **file-arg 會 error → 0-byte vacuous 假 pass**，故必驗 **byte > 0**。PowerShell 5.1 無 `<` stdin redirection，命令走 Git Bash。

**D. eslint**：`npx eslint functions/utils/oauth-session.ts functions/utils/oauth-clients.ts functions/utils/oauth-providers.ts` **EXIT 0**（`ProviderSecretsEnv` `keyof` cast / interface / erased cast 無新 lint；無 `no-undef`）。

**E. transient revert clean**：`git checkout -- functions/utils/oauth-session.ts functions/utils/oauth-clients.ts functions/utils/oauth-providers.ts` → `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（pre-existing）+ 本 plan doc（untracked）、`git diff --stat` 空（未 commit、零殘留）、HEAD 未動 `b59451b1`。

## 4. 本地機械 gate（CODE stage 全套實跑；對齊 CI `ci.yml`）

CODE stage @ final source commit 必跑並讀真實輸出：`typecheck:ratchet`（enforce、baseline `1119/175` frozen 未 `--update`；帶 `RATCHET_BASE_REF=$(git rev-parse main)`；report 應 486→453）· `lint`（eslint + lint:workflows）· `verify:browser-pipeline` · `test:cov` · `test:int`（含 `tests/oauth-providers.test.ts` — TEST-LOCK 下 mock 保持 assignable）· `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。另 REPLAY：forced tsc set-diff（`REMOVED=33 / ADDED=0`）+ byte-identical（esbuild stdin-pipe before==after，3 檔非 0 byte）於 source commit 重證（禁沿用 scout/transient overlay，ARCH-L12 fresh replay）。**① gate NB-1 專項確認**：`ProviderSecretsEnv` optional-only weak type 下，明確驗 **production consumer（callback / authorize / token / end-session / `_middleware` / `cors` / `resolveAud` 等 getProvider·getClient importer）與 `tests/oauth-providers.test.ts` 皆無新增 TS2345**（set-diff ADDED=0 已全 solution 覆蓋，CODE 報告須逐一點名此二面確認）。Windows `public/` CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。

> known flaky `jwt.test.ts`（~1.6%/run）撞到即 rerun。

## 5. Open Decisions / owner ruling（2026-07-08 全裁）

| 項 | 裁決 | SoT / 理由 |
|---|---|---|
| 級別 | **L2 + OAuth security context locks** | type-only 契約標註、無新系統/schema/API/migration；utils leaf 非 issuance handler |
| 棒序 | **首棒 = utils leaf**（不改 admin） | shared type root（`ProviderConfig`/`OAuthClient`）先落，handler（棒2-4）才有型可引；dependency-correct |
| **OD-1** normalizeProfile raw | **unknown boundary + provider-specific erased interface** | 誠實信任邊界；禁 `any` / 禁 `Record<string,unknown>` 直通 / 禁 runtime validation |
| **OD-2** OAuthClient vs D1 row | **DB row（`Record<string,unknown>`）與 domain output（`OAuthClient`）分離** | 不宣稱 D1 row 為 validated domain object |
| **OD-3** callback cfg coupling | **callback 不併本棒；`ProviderConfig` module-local 不 export（ARCH-L2 option B）；callback 棒4 透過 `getProvider()` return shape consume** | 避免提前改 handler；實測 production 零 cascade（§3.A） |
| **OD-5** getProvider env | **F = `ProviderSecretsEnv` 窄型**（10 optional secret key） | least privilege（只讀 secret、不 forward auth）；ADDED=0 + byte-identical 實測；test 不需雙 cast；不採 A（擴 test scope）/ A'（+env.d.ts） |

### Gate 收據
- **scout overlay 實測**（2026-07-08 @ `b59451b1`）：REMOVED=33 / ADDED=0（option F）· byte-identical 3 檔（2479/6614/3442，非 vacuous）· eslint 0 · transient revert clean。OD-1..OD-5 owner 全裁。
- **① `CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（2026-07-08）：0 blocker + **2 required refinement 已回寫**（ARCH-L1 type-surface count **8→9**；ARCH-L2 ProviderConfig visibility **凍結 option B = module-local 不 export**）+ 2 non-blocking note（**① NB-1** CODE 須確認 prod+test 無新 TS2345〔見 §4〕、**① NB-2** env.d.ts latent gap 本棒不修為正確〔對映 §6 NB-2〕）。**ARCH-L1..L12 生效**。（註：「① NB-x」= gate 的 note，與本 plan §6 的「NB-x」為不同命名空間。）
- **②→③ handoff（① gate NB-1）**：`ProviderSecretsEnv` optional-only weak type 雖 overlay ADDED=0，**② Codex Plan / ③ Code Gate 仍須特別確認 production consumer 與 `tests/oauth-providers.test.ts` 皆無新增 TS2345**（§4 已納入；CASCADE-LOCK / ARCH-L9 涵蓋）。
- **② `CODEX_PLAN_APPROVED`**（2026-07-08，plan doc only；**≠ CODING_ALLOWED / ≠ code approval / ≠ merge**）：0 material finding。Codex live-repo 獨立驗：`HEAD`=`origin/main`=`b59451b1`；scoped 3 檔無 working-tree diff（僅 `CLEANUP_PLAN.md`+plan doc untracked）；forced tsc **486 unique / 29 files**、scoped oauth utils 恰 **33**；ratchet **486/29/306**；stdin esbuild byte oracle non-vacuous **2479/6614/3442** match HEAD/WT；`env.d.ts` 無 OAuth secret binding → NB-2 為 real pre-existing gap、正確 out-of-scope。**TS governance caveat**：repo 無 `governance/rules.json`／TS governance manifest → approval 基於 live compiler/ratchet/source 證據、非 rule enforcement。**residual risk**：Codex 不把 reverted overlay 當 current source proof of `453/ADDED=0`（無 source diff 可 replay）→ 由 **ARCH-L12 final-source-commit fresh replay** 把關（可接受）。
  - **② impl-report note（CODE replay 精確 importer surface；supersede §4 illustrative 清單）**：`getProvider` **production importer = `init` / `callback` / `bind-email`**（僅此 3）；oauth-clients registry（`getClient` 等）importer = 較廣 middleware / CORS / backchannel / admin / flow / test surface。CODE stage 的 ① NB-1 確認須以此精確 surface 逐一點名（實際以 CODE replay grep import 為準）。
- **CODING_ALLOWED + CODE committed**（owner 2026-07-08 → commit **`7cf741cc`**，branch `stage7-pr2do-oauth-utils-noimplicitany`，base `b59451b1`；staged 恰 4：3 source + 本 plan doc companion）：**ARCH-L12 fresh replay @ source commit**（禁沿用 overlay）——forced tsc set-diff **REMOVED=33 / ADDED=0**（453/26/309、全 TS70xx、零 TS2345）· byte-identical stdin-pipe **2479/6614/3442**（非 vacuous、working-tree+index 雙面）· eslint 0 · **ratchet enforce**（`RATCHET_BASE_REF=main`）**OK**（current 453 vs baseline 1119、cleanFiles 309）· `lint` 0 · `verify:browser-pipeline` OK · `test:cov` **737** pass〔含 `oauth-providers.test.ts` 13〕· `test:int` **1328** pass · `build:functions` · `npm run build`〔public/ CRLF churn 不 stage、[[feedback_windows_build_crlf_churn]]〕· `npm audit` **0 vuln**。**① NB-1 確認**：`getProvider` importer = `init`/`callback`/`bind-email`（+ test）全在 ADDED=0 覆蓋、`tests/oauth-providers.test.ts` **零 TS2345 regression**（OD-5=F 坐實）。**CODE self-review**（foreground 2-lens readonly-reviewer：security/runtime + faithfulness/scope）= **CONVERGED 0 material finding**〔byte-identical 獨立重證、0 drift、interface count 9、ProviderConfig module-local、scope 恰 4、無 banned pattern〕。② residual-risk（reverted overlay 非 current proof）由本 fresh replay **discharged**。
- **③ `CODEX_CODE_APPROVED`**（2026-07-08 @ `7cf741cc`；**code approval only ≠ push/PR/merge/release**）：0 material finding。Codex live-repo 獨立驗：`HEAD`=`807bb864`（docs-only follow-up over source `7cf741cc`）；scope 恰 3 source + plan doc；type-only diff；forced tsc set-diff base `b59451b1`→current **486→453 / REMOVED=33 / ADDED=0 / split 15/8/10 / 無 TS2345**；byte-identical committed blob replay **2479/6614/3442 cmp=0**；**9 interface 唯 `OAuthClient` export、`ProviderConfig` module-local**；`getProvider` importer surface = `init`/`callback`/`bind-email`（+ test）確認。gates 全過（ratchet/lint/verify:browser-pipeline/test:cov 737/test:int 1328/build:functions/build/audit）。**TS governance caveat**：無 `governance/rules.json` → 基於 live compiler/diff/test 證據。post-check note：Codex `npm.cmd run build` 產生 public/ CRLF status churn（無內容 delta）、review 非 mutating 未清 → 已由本地 `git checkout -- public/` 清除。
- **④ `CHATGPT_CODE_FAITHFULNESS`**：pending。
- **授權邊界**：**CODE committed ≠ push / PR / merge**。仍待 **③ Codex Code + ④ ChatGPT faithfulness 全過 + owner 明示 merge token** 才 squash-merge 進 main。

## 6. 非 blocking notes

- **NB-1**（ARCH-L2 凍結 option B）：`ProviderConfig` / `NormalizedProfile` / `Raw*Profile`（5）/ `ProviderSecretsEnv` 皆 **module-local 不 export**；`ProviderConfig` 僅隨 `getProvider()` 回傳型別經 inference 外露給 callback 棒4 consume（棒4 用 `ReturnType<typeof getProvider>` 類、**不 import `ProviderConfig`**）、不升格為跨模組 public auth contract。**唯一 export 的型別 = `OAuthClient`**（registry getter `getClient`/`getAllClients` 回傳的具名型別；替代原 module-level JSDoc typedef）。
- **NB-2**：OAuth secret（`GOOGLE_CLIENT_ID` 等）未宣告於 `env.d.ts` 為 **pre-existing latent gap**；本棒採 OD-5=F 窄型繞過、**不觸 `env.d.ts`**（A' 的 Env surface 變更屬本棒外）。若未來要把 secret 收進 `env.d.ts`，另開 governance 棒。
- **NB-3**：`oauth-clients.ts` deprecated const 段（`OAUTH_CLIENTS` / `ALLOWED_*` 等）由 `IN_CODE_CLIENTS: OAuthClient[]` + `flat` 型別化後自動變綠，實測 ADDED=0；不順改其 `@deprecated` 語意。
- **NB-4**：`getProvider` 的 `env[\`${upper}_CLIENT_ID\` as keyof ProviderSecretsEnv]` 用 `keyof` cast 處理動態 computed-key 索引（TS 無法將 runtime 字串解析為 literal key）；此為 type-level workaround，runtime `env[\`${upper}_CLIENT_ID\`]` 一字不動（byte-identical 坐實）。
- **NB-5**：shipped 集 = 3 source + 本 plan doc companion（per stage7 慣例）；owner CODE 前可否決 plan doc companion。
- **NB-6**：本棒清 utils leaf，不觸 LINE id_token hardening（棒5，`callback.ts:620 verifyLineIdToken`；runtime/security 行為變更、與 byte-identical type-only 互斥）。

## 7. 後續棒次

- 本棒（oauth utils 33）→ **棒2 admin oauth-clients RBAC pair（19）** → **棒3 oauth flow handlers（26；init/end-session/bind-email/authorize/token/code）** → **棒4 callback.ts（27；Tier-0 最重，透過 `getProvider()` return consume 本棒 module-local `ProviderConfig`）** → **棒5 LINE id_token hardening（獨立 additive-security，非 type-only）**。
- oauth 域（105）清完 → **audit 域（381，殿後最重，含 F-3 DORMANT）** → noImplicitAny=0 後 rebaseline `1119→0` → `strict:true`(~998) → scripts → tests → browser。

---

## Index receipt（archive 用；本檔結案後搬 MEMORY 對應）
- 清 oauth utils leaf 3 檔 33 noImplicitAny → 0（session 15 + clients 8 + providers 10）；REMOVED=33 / ADDED=0、byte-identical（2479/6614/3442）、eslint 0。
- OD-1 unknown-boundary + `Raw*Profile` erased cast；OD-2 `rowToClient(row: Record<string,unknown>): OAuthClient` erased cast；OD-3 `ProviderConfig` **module-local**（ARCH-L2 option B；callback 棒4 透過 `getProvider()` return consume、零 cascade）；**OD-5=F `ProviderSecretsEnv` 窄型**（getProvider least privilege、避 test 雙 cast、避 env.d.ts 變更）。
- overlay 掀出 option A（`env: Env`）→ 23 TS2345 test-mock cascade → option F 自洽解（實測不推斷典例）。
