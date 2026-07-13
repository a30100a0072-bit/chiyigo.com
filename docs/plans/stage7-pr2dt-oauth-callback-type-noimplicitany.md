# Stage 7 PR-2dt — 棒4-type：`callback.ts` noImplicitAny 續清（oauth domain 最後一塊、Path C 之 PR1）

**SPEC**: `STAGE7_OAUTH_CALLBACK_NOIMPLICITANY`（owner `SPEC_APPROVED_WITH_LOCKS` 2026-07-13，Path C）
**狀態**: `PLAN_SELF_REVIEW_CLEAN`（維度 A workflow `wf_77126efb-acd` 2 accepted〔皆 tier2、已修〕+ 10 refuted、主線裁決一輪 0 新發現、§5.5 收據 → 下一步 commit plan → ① ChatGPT Arch → ② Codex Plan）
**base**: `67111ad428e836a9729362847ac68ee5f8d71e01`（= main = origin/main、#145 PR-2ds 棒3b SHIPPED 後；IMMUTABLE-BASE = SPEC-C locks）
**worktree**: `C:/Users/User/Desktop/chiyigo-pr2dt-callback-type`、branch `stage7-pr2dt-callback-type`（`SINGLE_WRITER_READY` 已達成）
**級別**: **L2 implementation + L3 security review**（實作純 type-only 屬 L2；但 `callback.ts` = 動態 OAuth callback〔state/PKCE 原子核銷、identity 簽發、elevation exchange、access/refresh token 簽發〕，Tier-0 最重端點，治理與審查輸出升 L3 security-context）
**性質**: 純 type-only noImplicitAny 標註（**23→0 於 callback.ts 的 27 個中；exchangeCode 的 4 個 TS7031 明示保留、descope 到棒5**）、byte-identical emit（esbuild stdin-pipe + SHA-256 + cmp -s 實證）、**零 runtime AST / 零 control-flow / 零 validation / 零 schema / 零 API / 零 migration / 零部署面 / 零 test 改動 / 零 env.d.ts / 零新 interface / 零 export / 零新套件 / 零 lockfile**。棒4-type 是 reduce PR（**REMOVED=23**）；post-ratchet = **385 / 18 / 317**（callback 仍 dirty、留 4 錯）。

> ⚠⚠ **這是 Path C 的 PR1**。callback.ts 因 `FormData File | string` 結構障礙（見 §1.3）**無法同時 byte-identical + 全清**。owner 裁決拆兩 PR：
> - **PR1（本 plan）= 棒4-type**：byte-identical 標 23、**不碰 exchangeCode**、**不宣稱 callback 或 OAuth domain 全清**（SPEC-C-7）。
> - **PR2 = 棒4-guard，併入棒5**：補 exchangeCode 4 錯 + `typeof code!=='string'` guard（runtime-delta L3 security、SPEC-C-8/9）。**本 plan 不預核棒5 實作細節**。

---

## 1. Scope 與 locks

### 1.1 SCOPE（SPEC-C-1 lock）: **1 production source**

- `functions/api/auth/oauth/[provider]/callback.ts`（動態 OAuth callback：code+state 提取、oauth_states 原子核銷 DELETE-RETURNING、access_token 換取、provider profile 正規化 + OIDC nonce 驗證、elevation OAuth-reauth exchange、is_binding factor-add、信箱碰撞守門、user/identity 建立、access/refresh token 簽發、依 platform 回傳）
- production source allowlist = **僅 `callback.ts`**；另可含本 plan doc、gate packet、gate-log 等**治理文件**（SPEC-C-1）。

**23 noImplicitAny → 0（callback.ts 27 個中；exchangeCode 4 個保留）**（forced tsc `-b tsconfig.solution.json --pretty false --force` 實證，base `67111ad4`；**zero dual-leaf**，base error set = 408 raw = 408 unique；callback.ts 佔 27）：

分布：TS7006 ×17 + TS7031 ×4 + TS7034 ×2 + TS7005 ×4 = 27；**本棒清 23**（全部除 exchangeCode 的 4 TS7031）。

#### 1.1.1 標註清單（SPEC-C-2：恰 23）
| # | loc（base） | error | 型別決策（form） |
|---|---|---|---|
| 1-2 | 40,31 / 41,31 | TS7006 `ctx` ×2 | `onRequestGet/onRequestPost = (ctx: { request: Request; env: Env; params: { provider?: string }; [key: string]: unknown }) => handle(ctx)` |
| 3 | 45,23 | TS7006 `context` | `async function handle(context: { request: Request; env: Env; params: { provider?: string }; [key: string]: unknown })` |
| 4-7 | 525,29/39/44/52 | TS7006 ×4 | `fetchProfile(provider: string, cfg: ReturnType<typeof getProvider>, tokens: { id_token?: string; access_token?: string }, expectedNonce: string \| null)` |
| 8-10 | 578,5 / 580,8 / 583,10 | TS7034 + TS7005 ×2 | `let _googleJwks: ReturnType<typeof createRemoteJWKSet> \| null = null` |
| 11-13 | 586,36/45/58 | TS7006 ×3 | `verifyGoogleIdToken(idToken: string, expectedAud: string \| null, expectedNonce: string \| null)` |
| 14-16 | 598,5 / 600,8 / 603,10 | TS7034 + TS7005 ×2 | `let _appleJwks: ReturnType<typeof createRemoteJWKSet> \| null = null` |
| 17-19 | 606,35/44/57 | TS7006 ×3 | `verifyAppleIdToken(idToken: string, expectedAud: string \| null, expectedNonce: string \| null)` |
| 20-21 | 620,34/43 | TS7006 ×2 | `verifyLineIdToken(idToken: string, channelSecret: string \| null)` ⚠ **NO-FOLD-IN：只標型別、絕不碰驗證邏輯本體**（L620–645，棒5 目標） |
| 22 | 647,21 | TS7006 | `escapeHtml(s: string)` |
| 23 | 653,20 | TS7006 | `htmlError(message: string, status = 400)` |

#### 1.1.2 明示保留、**不標**（SPEC-C-3）
| loc（base） | error | 為何保留 |
|---|---|---|
| 500,31/36/42/57 | TS7031 `cfg`/`code`/`code_verifier`/`redirect_uri` ×4 | `exchangeCode` 的 `code` 實為 `FormDataEntryValue = File \| string`（§1.3）；清它需 runtime narrow（guard）→ **descope 到棒5**（PR2）。PR1 **不得補型別/guard/assertion/改寫參數結構**。 |

> **type surface（zero 新 named interface、zero export、zero 新 import）**：handler-ctx inline 標註 ×3（1 個 shape：init 已用 `[key:string]:unknown` envelope、precedent 見 §2）+ `let` JWKS 型 **2 處標註**（各解消 3 error = 6 error，對映 SPEC-C-2『JWKS `let` ×6』的 error 口徑）+ function param 標註（fetchProfile 4 / verify 8 / escapeHtml 1 / htmlError 1）；`ReturnType<typeof getProvider>` 與 `ReturnType<typeof createRemoteJWKSet>` 皆槓桿既有 import（`getProvider` L23、`createRemoteJWKSet` L19）、**零新 import**；`Env`/`Request` global ambient（callback.ts 未 import，overlay ADDED=0 反證解析）。callback.ts = leaf route handler、**zero export type/interface** → 型別面全 module-local（production 僅 Pages router 觸發；integration test 以 value import `onRequestGet`，故 CASCADE 含 tests-leaf，見 §6 NB-1）。

> ⚠ **計數口徑校準（三個不同判準，勿混；自審 accepted finding 修正）**：
> 1. **noImplicitAny error 數 = 23**（= REMOVED=23、forced-tsc set-diff / ratchet 機械 gate 值、SPEC-C-5 綁定不變）——SPEC-C-2『恰 23 標註』與 §1.1.1 表頭『恰 23』的**精確語意即此**、各群 ×3/×4/×6/×8/×2 皆為 **error 數**（非 syntactic 標註數）。
> 2. **source `: Type` 標註 site 數 = 19**（handler ctx 3 + fetchProfile 4 + JWKS `let` **2** + verify 8 + escapeHtml/htmlError 2）；JWKS 群 = 2 個 `let` 各解消 3 error〔TS7034 宣告 + TS7005×2 讀取〕= **6 error**（故 §1.1.1 rows 8-10/14-16「3 loc / 3 error / 1 `let`」× 2 = 6 error / 2 標註）。
> 3. **changed line 數 = 11**（3 handler + 1 fetchProfile 簽名 + 2 JWKS `let` + 3 verify 簽名 + 2 escapeHtml/htmlError）。
>
> **§4 PROVIDER-PATH-HUNK 人工 hunk faithfulness review 以 (2)=19 標註 site / (3)=11 changed line 為預期**，勿以 (1)=23 誤判「缺 4 個標註」（false-halt）或反向 false-pass。三數各有機械來源：(1) 由 set-diff/ratchet 驗、(2)(3) 由人工 hunk `git diff` 驗。

### 1.2 SPEC Locks（**SPEC-C-1..10** = owner `SPEC_APPROVED_WITH_LOCKS` 2026-07-13 逐字）

| Lock | 約束 |
|---|---|
| **SPEC-C-1** | PR1 production source allowlist 僅 `callback.ts`；另可含 plan/packet/gate-log 等治理文件 |
| **SPEC-C-2** | PR1 恰處理 23 標註：handler ctx ×3、fetchProfile ×4、JWKS `let` ×6、verify functions ×8、escapeHtml/htmlError ×2 |
| **SPEC-C-3** | `exchangeCode` 4 個 TS7031 **原樣保留**；PR1 不得補型別/guard/assertion/改寫參數結構 |
| **SPEC-C-4** | PR1 **禁 runtime AST 變更**：不得新增 guard/控制流/函式呼叫/import·export/重新命名/重排/錯誤處理變動 |
| **SPEC-C-5** | 驗收 `REMOVED=23 / ADDED=0`；ratchet `385/18/317`、callback 剩 4 錯。相對 `67111ad4` 基準漂移 → **立即 halt、不可自行更新數字** |
| **SPEC-C-6** | byte-identical **必比 before/after 實際 bytes**（既有 stdin-pipe 法、禁 file-argument loader vacuous pass）；`2c313404…` 只作輔助錨點、**byte equality 為主判準** |
| **SPEC-C-7** | PR1 **不得宣稱** callback 或 OAuth domain 全清 |
| **SPEC-C-8** | 棒5 明列子 scope＝`exchangeCode` 4 錯 + `typeof code!=='string'` guard；不得以「附帶清理」加入 |
| **SPEC-C-9** | 棒5 **必須重走 L3 runtime/security SPEC 與 Plan Gate**；本次核准不預核其實作細節 |
| **SPEC-C-10** | PR1 與棒5 不得交錯實作或共用未提交 source diff |

#### 1.2.1 對映 SPEC-C-4「禁 runtime AST 變更」的機械保證
本棒**唯一** source delta = 參數/`let` 型別標註（TypeScript type annotation）。type annotation 於 esbuild `--loader=ts` emit **全 strip** → JS bytecode 不變（§3.B byte-identical 實證）。不新增任何 guard/branch/call/import/export/rename/reorder/error-handling。→ SPEC-C-4 由 byte-identical（§3.B）機械坐實：emit 逐 byte 相同 ⟺ runtime AST 零變更。

### 1.3 ⚠ 結構障礙：`FormData File | string`（為何 exchangeCode 4 錯 descope）

`callback.ts` 不能同時「純 type-only + byte-identical」**且**「callback 全清」——卡在 exchangeCode 這顆：

```
let code                              // L58
code = form.get('code')              // L63  → FormDataEntryValue = File | string
                                     //        (workers-types 未載入；走 lib.webworker.FormData.get)
code = url.searchParams.get('code')  // L68  → string | null
exchangeCode({ cfg, code, ... })     // L119 → 內部 new URLSearchParams({ code, ... }) 只收 Record<string,string>
```

- 標 `exchangeCode({ code: string })` → TS2322（`FormDataEntryValue` not assignable to `string`）於 call site L120。
- 改標 `code: FormDataEntryValue` → 錯搬家成 TS2345 ×2（object literal 不 assignable to URLSearchParams ctor param、dual-leaf）於 L501。
- **零 assertion 的 type-only 解不存在**（ARCH 禁 assertion；且 `File` 型別誠實）。

**File 分支 runtime 可達（scout 真實 workerd 實測）**：L61 守門 `contentType.includes('application/x-www-form-urlencoded')` 是子字串比對；poisoned CT `multipart/form-data; boundary=X; probe=application/x-www-form-urlencoded` 通過 `.includes()`、真實 media type = multipart；帶 filename 的 multipart part → `form.get('code')` 回 `instanceof File === true`。→ 型別 `File` 誠實、TS 正確拒絕、type-only 無法遮蓋。**非漏洞**（攻擊者送 File code 只 fail-closed、無得利），是 robustness code-smell。**修法（guard）＝ runtime-delta → 依 owner 裁決 descope 到棒5（PR2、SPEC-C-8/9）**。

## 2. SSOT 對齊（每個型別決策的真相源）

- **handler-ctx（3 標註；OD-3b-1 沿用）**：`onRequestGet`/`onRequestPost`/`handle` 皆用**單一 context 參數**（非 destructure-in-signature）、僅補 inline object 型別 + `[key: string]: unknown`。**單一 context 參數是 byte-identical 的必要條件**（把 destructure 搬進簽名會改 emit）。precedent = 棒3b `init.ts`（同 shape、integration test 傳 rich EventContext）。
  - **`[key: string]: unknown` 真相源（load-bearing、負控制實證 §3.C）**：callback 的 2 個 value-import integration test（`callback.test.ts`、`oauth-nonce.test.ts`）傳**完整 EventContext literal**（`{ request, env, params, waitUntil, data, next }`）。handler ctx 標 exact-inline（無 index-sig）→ `waitUntil`/`data`/`next` 觸 TS2353 excess-property。index-sig `[key:string]:unknown` 抑制 excess-property check（extra prop assignable to `unknown`）。`unknown`（非 `any`）確保 handler 不能未 narrow 讀那些 framework prop（SPEC-C 對映 ARCH-3B-7 NO-DYNAMIC-KEY 精神）。**不建共用 type、不 export、不宣稱正式 `EventContext`**。
  - **params `{ provider?: string }`（沿 MC-1）**：禁寬泛 `Record<string,string>`。`strictNullChecks:false` → optional `provider?` 讀取端不帶 `|undefined`（`params.provider?.toLowerCase()` 得 string）→ `ALLOWED_PROVIDERS.has(provider)`〔`Set<string>`〕/ `getProvider(provider, env)`〔`name: string`〕皆不 cascade（overlay ADDED=0 坐實）。所有 callback test call-site 傳 provider present（`{ provider }` / `{ provider:'google' }` / `{ provider:'discord' }`）、無 `params:{}`。

- **`env: Env`（OD-3b-2 沿用）**：`getProvider(provider, env)`〔L54〕的 `env` 由 context 型別帶出 `Env`。槓桿棒3-env #144（`Env` +10 optional OAuth credential key → `Env` 與 weak-type `ProviderSecretsEnv` 10 屬性重疊 → assignable、**無 TS2559**）。**util 端 `getProvider(name, env: ProviderSecretsEnv)` least-privilege 窄型不放寬**（SPEC-C 對映 ARCH-3B-9 UTIL-FROZEN、棒3-env ARCH-ENV-5 凍結）。callback 另用 `env.chiyigo_db`〔D1Database〕/ `env.IAM_BASE_URL`〔`?:string`〕/ `env.RESEND_API_KEY`，皆在 `Env` → 標 `env:Env` 不 cascade TS2339（overlay ADDED=0 坐實）。

- **`cfg: ReturnType<typeof getProvider>`（fetchProfile + exchangeCode 共用型別源；本棒 fetchProfile 標、exchangeCode 不標）**：`getProvider` 回 `{...ProviderConfig, clientId, clientSecret} | null`（inferred、無顯式 return type）。`ReturnType<typeof getProvider>` **零新 import**（getProvider 已 import L23）。含 `| null`；`strictNullChecks:false` 下 `cfg.clientId`/`cfg.tokenUrl` 等不 cascade（同 params 機制）。**OD-4-CFG-NULL**：strict:true 浪次需補 null-narrow（已知 deferral、§6 NB、非本棒 scope）。

- **`tokens: { id_token?: string; access_token?: string }`（fetchProfile；OD-4-TOKENS）**：`tokens` 來自 `providerTokens = await exchangeCode(...)`（`res.json()`、實為 any）。fetchProfile 只讀 `tokens.id_token`〔L530/540/548〕/ `tokens.access_token`〔L557〕2 欄 → inline shape 只宣稱這 2 欄（誠實 least-claim、不宣稱其他 key）。caller 傳 `any`（assignable to 任何 shape）→ overlay ADDED=0。

- **`let _googleJwks` / `_appleJwks: ReturnType<typeof createRemoteJWKSet> | null = null`（OD-4-JWKS；新 OD form vs 棒3b）**：⚠ **非 param 標註**——`let x = null` 是 TS7034（隱含 any-in-some-locations）+ 後續讀取 TS7005。需顯式 `let` 型標註。`createRemoteJWKSet` 已 import（L19）→ `ReturnType<typeof createRemoteJWKSet>` **零新 import**。`| null` 誠實（初值 null、lazy 建立）。byte-identical 維持（`let` 型標註 esbuild strip、§3.B 實證）。**getGoogleJwks/getAppleJwks body 一字不動**（`if (!_googleJwks) { _googleJwks = createRemoteJWKSet(...) }`）。

- **micro（caller-faithful）**：`verifyGoogleIdToken`/`verifyAppleIdToken(idToken: string, expectedAud: string|null, expectedNonce: string|null)`（callers: `idToken`=`tokens.id_token`〔string〕、`expectedAud`=`cfg.clientId`〔string|null〕、`expectedNonce`=`expectedNonce`〔string|null〕）；`verifyLineIdToken(idToken: string, channelSecret: string|null)`（`channelSecret`=`cfg.clientSecret`〔string|null〕）；`escapeHtml(s: string)`；`htmlError(message: string, status = 400)`（既有 default param 不動）。

## 3. 證據（scout transient overlay 實測 @ **main-tree working-tree** `67111ad4`，已 `git checkout --` 還原、overlay 零殘留；CODE stage 於 worktree source commit **fresh replay** 重證，SPEC-C-2/5/6）

**A. forced tsc set-diff** — `npx tsc -b tsconfig.solution.json --pretty false --force`（uniq set、`sort -u` 後 `comm`；error-line 與 uniq 同、zero dual-leaf）：
- base error set = **408 unique**（= ratchet current 408/18/317）。
- 套 23 處 type-affecting overlay（callback 全 27 除 exchangeCode 4）→ **385 unique**；set-diff **REMOVED=23**（3 handler ctx + 4 fetchProfile + 6 JWKS-let + 8 verify + 2 escapeHtml/htmlError、全 callback.ts、TS7006/7034/7005）/ **ADDED=0**（全 solution、含 tests-leaf）。callback.ts 殘 4 TS7031@L500（exchangeCode、SPEC-C-3 保留）。
- ratchet 預期 **385/18/317**（callback 仍 errorFile〔4 錯〕→ errorFiles 18 不變、cleanFiles 317 不變、errorCount 408-23=385；SPEC-C-5）。baseline `1119/175` frozen（reduce 禁 `--update`）。
- **關鍵消解坐實**：TS2559 未出現（`getProvider(provider, env:Env)` assignable to `ProviderSecretsEnv`＝棒3-env #144 之效）· TS2353 未出現（index-sig ctx 吸收 test rich EventContext）· **零 `as` assertion** · 無 TS2339（env sink 在 Env）· 無 TS2345（`params.provider` 讀為 string、`tokens`=any caller assignable）。

**B. byte-identical emit（SPEC-C-6；esbuild stdin-pipe、非 vacuous、byte-equality 主判準）**：
| 檔 | base size | cand size | cmp -s exit | SHA-256（base = cand） | vacuous guard |
|---|---|---|---|---|---|
| `[provider]/callback.ts`（descope-23） | 22854 | 22854 | **0** | `2c313404d2401109fb27fb3d85771c23bdf3dfc0aa2bd78fe82378c87a2ea7f5` | non-vacuous（≠ empty sha `e3b0c442…`、stderr 空、size>0）|
> RUNTIME-LOCK（SPEC-C-4）坐實：code+state 提取 / oauth_states 原子核銷 / access_token 換取 / OIDC nonce 驗證 / elevation OAuth-reauth exchange / is_binding factor-add / 信箱碰撞守門 / user·identity 建立 / access·refresh token 簽發 / cookie / HTML bridge 100% 未動；23 處參數/`let` 型別註記全於 emit 抹除。**本棒零 `as` assertion；exchangeCode 4 錯保留 → emit 中 exchangeCode 簽名逐字不變**。
> **⚠ 驗法（SPEC-C-6；[[feedback_byte_identical_emit_verification]]；自審 accepted finding 修正）**：**before 側鎖固定 base ref `67111ad4`（CODE stage fresh 從 base 重推 emit、禁用 `HEAD`）**——`git show 67111ad4:'functions/api/auth/oauth/[provider]/callback.ts' | esbuild --loader=ts --format=esm`（before=base 67111ad4）vs candidate **兩面**（`cat <f>` 工作區 + `git show <source-commit>:<f>` committed blob）各 `| esbuild --loader=ts --format=esm`，取 **`cmp -s` exit 0 + 兩側 SHA-256 一致 + 兩側 size > 0**（byte-equality = SPEC-C-6 主判準；base emit SHA-256 應 == scout anchor `2c313404…`，SPEC-C-6『輔助錨點』cross-check）。⚠ **CODE stage 禁用 `git show HEAD:<f>` 當 before**：commit 後 HEAD=candidate → before/after 皆 candidate → cmp -s 恆 0＝**vacuous pass**、未證 shipped==base（此即 self-review accepted finding；改鎖 `git show 67111ad4:` 對齊 cited SoT L16-19 canonical `git show <base>:`）。canonical recipe **必含 `--format=esm`**；`--loader=ts` 對 file-arg 會 error → 0-byte vacuous 假 pass，故必驗 byte>0 且 sha≠empty。PowerShell 5.1 無 `<` stdin redirection、命令走 Git Bash。

**C. 負控制（index-sig load-bearing、ADDED=0 非 vacuous；[[feedback_ts_negative_control_proves_suppression_load_bearing]]）**：拿掉 3 處 handler ctx 的 `[key:string]:unknown`、其餘全留 → forced tsc **精確 +2 TS2353**（`waitUntil` excess-property）於 `callback.test.ts:44` + `oauth-nonce.test.ts:69`。→ 證 (a) tests-leaf 確有編到並在檢 handler call site；(b) index-sig load-bearing 非裝飾；(c) CASCADE 含 tests-leaf（SPEC-C 對映 ARCH-3B-12 CASCADE）。

**D. transient revert clean（historical scout snapshot @ main-tree、非現況）**：`git checkout -- ':(literal)functions/api/auth/oauth/[provider]/callback.ts'`（`:(literal)` pathspec 處理 `[provider]` glob）→ forced tsc 回 408、與 base error set 逐行 IDENTICAL、ratchet 408/317、`git diff --numstat HEAD` 空。〔worktree 現況：從 `67111ad4` fresh checkout、callback.ts LF blob `a0ed09e7…`、27 錯基準完整；此段記 scout 階段證據〕

## 4. 本地機械 gate（CODE stage 於 worktree 全套實跑；對齊 CI `ci.yml`；SPEC-C-2/5/6 fresh replay，禁沿用 main-tree overlay）

CODE stage @ worktree source commit 必先跑 **IMMUTABLE-BASE guard（SPEC-C-5）**：`git merge-base --is-ancestor 67111ad4 HEAD`（exit 0）+ 重驗 HEAD/tree/ratchet；再跑並讀真實輸出：`typecheck:ratchet`（**enforce、post = `385/18/317`、baseline `1119/175` frozen 未 `--update`**、SPEC-C-5；帶 **`RATCHET_BASE_REF=67111ad4`**）· `lint`（eslint + lint:workflows）· `verify:browser-pipeline` · `test:cov` · `test:int`〔含觸及本檔的 `callback.test.ts` + `oauth-nonce.test.ts` — SPEC-C 對映 ARCH-3B-16 下不改；clean overlay ADDED=0 已含 tests-leaf 反證無新型別錯〕· `build:functions` · 完整 `npm run build` · `npm audit --omit=dev --audit-level=high`。

另 **REPLAY（SPEC-C-5/6，worktree source commit fresh replay）**：
- forced tsc set-diff **`REMOVED=23 / ADDED=0`**（全 solution、dual-leaf-aware、含 tests leaf）；任何 ADDED>0 直接阻斷、回 plan。callback 殘 4 TS7031（exchangeCode）為**預期**（SPEC-C-3）、非 fail。
- **byte-identical（SPEC-C-6）**：esbuild stdin-pipe `--loader=ts --format=esm`，**before = `git show 67111ad4:<f>`（pinned base、禁 `HEAD`＝自審 accepted finding）** vs candidate **兩面**（`cat <f>` 工作區 + `git show <source-commit>:<f>` committed blob），**cmp -s exit 0 + 雙側 SHA-256 一致 + size>0**，base emit SHA == anchor `2c313404…`（輔助 cross-check）。
- **FULL-DIFF-ALLOWLIST 機械核對**：`git diff --name-only 67111ad4..<source>` 完整 changed-files 恰 {`callback.ts`, 本 plan doc}；source 面恰 {`callback.ts`}。任一額外檔 = scope violation、停 gate（SPEC-C-1/10）。
- **RED-TEST-INTEGRITY**：任何 test red 先保留首次失敗輸出並判因；禁「known flaky」直接 rerun 至 green。Windows `public/` CRLF churn 挑檔不進 PR（[[feedback_windows_build_crlf_churn]]）。
- **PROVIDER-PATH-HUNK（SPEC-C 對映 ARCH-3B-14）**：`[provider]/callback.ts` 因路徑含 `[` → `code-self-review.mjs` REPO_PATH_PATTERN 拒 `[`、無法當 formal decision-point → faithfulness packet **人工補完整 hunk + 機械 `git diff --name-status`**，不得只依賴 reviewer script。

## 5. Open Decisions / owner ruling（2026-07-13 `SPEC_APPROVED_WITH_LOCKS`）

### 5.1 OD-4-CODE 裁決（owner）
| OD | 裁決 | 鎖定 |
|---|---|---|
| **OD-4-CODE** callback 無法 byte-identical + 全清 | **Path C（拆兩 PR）** | PR1=棒4-type（byte-identical、23、留 exchangeCode 4、SPEC-C-1..7/10）；PR2=棒4-guard 併棒5（SPEC-C-8/9）|
| OD-4-JWKS `let` 型 | **採用** | `let _googleJwks/_appleJwks: ReturnType<typeof createRemoteJWKSet> \| null = null`；零新 import；byte-identical 維持 |
| OD-4-TOKENS shape | **採用 least-claim** | `{ id_token?: string; access_token?: string }`（只宣稱讀取 2 欄）|
| OD-4-CFG-NULL | **採用、strict deferral** | `ReturnType<typeof getProvider>`（含 null）；strictNullChecks:false 不 cascade；strict:true 浪次補 narrow |

### 5.2 風險表（owner SPEC 明列 + 本棒對映）
| 項目 | 等級 | 影響 | 防禦 |
|---|---:|---|---|
| PR1 混入 guard | 高 | byte-identical 宣稱失效 | **SPEC-C-3/4**：PR1 明禁任何 runtime 修改；byte-identical（§3.B）機械擋 |
| 平行 session 共用工作區 | 高 | 覆蓋檔案、branch/SHA 與證據失真 | **單一 owner＋獨立 worktree**（`SINGLE_WRITER_READY` 已達成）|
| 23 個標註範圍漂移 | 中 | ratchet 或 scope claim 不可信 | **SPEC-C-2/5**：精確位置 allowlist、REMOVED/ADDED set-diff、ratchet 385/18/317 halt-on-drift |
| 棒5 順帶加入 guard | 中 | 安全語意未被完整審查 | **SPEC-C-8/9**：棒5 SPEC 明列獨立子 scope、測試與失敗路徑 |
| 過早宣告 OAuth 全清 | 中 | 狀態與實際錯誤數不一致 | **SPEC-C-7**：PR1 固定保留 callback 4 錯、不宣稱全清 |
| callback = Tier-0 型別誤導 | Tier-0 | 掩蓋 provider/綁定/token 缺陷 | 僅型別標註、零 runtime AST（§3.B）；byte-identical 逐行審 |
| `context` index signature 過寬 | 中 | 任意欄位可存在 | 僅函式參數 local inline shape；值固定 `unknown`；禁動態 key 讀取；負控制證 load-bearing |

### 5.3 防禦表（owner-style）
| 機制 | 處理否 | 實作 | 未處理原因 |
|---|---|---|---|
| RateLimit / elevation 節流 | 保持 | 現有 callback 流程 byte-identical | 本棒不改 runtime |
| 權限／identity binding / factor-add | 保持 | 現有驗證與 token 路徑不動 | 本棒僅 type-only |
| Input validation（provider/code/state/nonce）| 保持 | 現有 narrowing 不動；**File narrow=棒5** | 禁新增 validation（SPEC-C-4）|
| PKCE / OIDC nonce / id_token 驗簽 | 保持 | verifyGoogle/Apple/Line 邏輯不動（只標型別）| NO-FOLD-IN（SPEC-C-8）|
| XSS | 不適用 | escapeHtml/htmlError 只標型別、body 不變 | 無新 HTML surface |
| Structured Log / TraceID / audit | 保持 | 現有 safeUserAudit 不變 | 不擴 scope |

### 5.4 驗證要求（owner-style）
| 類型 | 目標 | 工具 |
|---|---|---|
| 單元/整合 | callback 既有測試零行為變更、solution+tests leaf 無新增 TS error | `tsc -b tsconfig.solution.json --pretty false` + `test:int` |
| E2E | 本棒不新增；既有 OAuth suite 全綠 | 現有 CI |
| Emit | callback.ts 輸出逐 byte 相同且非空 | esbuild stdin pipe + `cmp -s` + SHA-256（SPEC-C-6）|
| Ratchet | 408→385、errorFiles 18、cleanFiles 317、callback 剩 4 | 現有 ratchet script（halt-on-drift、SPEC-C-5）|

### 5.5 維度 A 對抗式 self-review 收據（`plan-self-review.mjs` workflow `wf_77126efb-acd`、19 agents〔7 finder + 12 verifier〕、0 error、2026-07-13）
7 維 finder（security-boundary / tenant-scope / migration / api-contract-enum / high-risk-state-idempotency / naming-ssot / spec-scope）各攻一維、對抗式 verify（預設 refuted）→ **12 findings、accepted 2（皆 tier2）、refuted 10、suspicious_input 0**。**主線獨立讀 plan + 實算裁決**（不採 raw）：

**ACCEPTED（2、皆已於本 plan 修正）**：
1. **[security-boundary/tier2] byte-identical 用 `git show HEAD:<f>` 在 CODE stage vacuous**：commit 後 HEAD=candidate → before/after 皆 candidate → cmp -s 恆 0、未證 shipped==base。**主線獨立確認為真**（scout 時 HEAD=67111ad4=base 故當時正確；CODE stage HEAD≠base）→ **修 §3.B footnote + §4 REPLAY：before 側改鎖 `git show 67111ad4:`（fresh 從 base 重推 emit）**，對齊 cited SoT canonical `git show <base>:` 與 SPEC-C-6 byte-equality 主判準（anchor `2c313404…` 維持 SPEC-C-6『輔助』cross-check、未升為強制）。
2. **[naming-ssot/tier2] SPEC-C-2『23 標註』混淆 error 數與標註數（JWKS ×2 vs ×6 互斥）**：**主線實算坐實** 23 error = 19 `: Type` 標註 site = 11 changed line（JWKS 2 `let` 各消 3 error = 6）→ **修 §1.1 type-surface note + 加 §1.1「計數口徑校準」三分 note**（error 23 / 標註 site 19 / changed line 11；SPEC-C-2 verbatim 不改、加 gloss 定義其『23』= error 數）。§4 人工 hunk review 改以 19/11 為預期、防 false-halt。

**REFUTED（10、主線抽查裁決正確、無 accept 反轉）**：File-code descope 非 vuln〔verifier 源碼追蹤強化：File→URLSearchParams `[object File]`→固定 tokenUrl→!res.ok throw→fail-closed，且需先燒一次性 state；等價於送 bogus 字串 code、零新攻擊面〕· 23 type-only 標註無安全語意遮蔽〔cfg|null/tokens least-claim/ctx unknown/env:Env 皆誠實〕· tenant-scope resolveActiveTenantClaims〔runtime、byte-identical 保全〕· migration rollback / 零 migration〔reduce PR revert 不被 ratchet 擋、無 D1 schema〕· File-reachability state 副作用〔一次性 state 先行核銷、fail-closed〕· 外部呼叫 timeout/retry〔pre-existing、byte-identical 不改、非本棒 scope〕· exchangeCode 名稱碰撞〔module fn L500 vs elevation local var L171 不同 scope〕· 棒5 denotation ×2〔SPEC-C-8 要求 exchangeCode+guard 子 scope **明列不得夾帶**、不排除 LINE hardening 並存；NB-5 已明列兩子 scope〕。

**主線 fresh-pass re-read（修正後）**：grep 全文確認無殘留 `git show HEAD:` 當 recipe（僅 1 次為「禁用」警告）、無 ×2/×6 互斥、before 兩處鎖 67111ad4、23/19/11 三計數並存且各有機械來源。**修正皆 plan-doc 層（不觸架構/scope/型別決策/REMOVED=23）→ 依 Dual Gate §9 回路節流用主線對抗式 re-read、未重跑 7-finder workflow**。**一輪 0 新發現 → `PLAN_SELF_REVIEW_CLEAN`**。

## 6. 非 blocking notes
- **NB-1**：callback.ts = leaf route handler、**zero export type/interface**——production 僅 Pages router 觸發、無跨模組 public type contract。⚠ integration test 以 **value** import：`callback.test.ts`〔`onRequestGet as cbGet` 靜態〕、`oauth-nonce.test.ts`〔`onRequestGet as cbGet` 靜態 + `init` 動態 import〕。故 CASCADE（SPEC-C 對映 ARCH-3B-12）**必含 tests-leaf**；overlay ADDED=0 已全 solution 涵蓋。
- **NB-2**：callback 用 **index-signature ctx**（`[key:string]:unknown`）吸收 tests 傳的完整 EventContext literal（同 棒3b init.ts；負控制 §3.C 坐實 load-bearing）。
- **NB-3（OD-4-CFG-NULL / strict:true 延後成本，已揭露非本棒缺陷）**：`cfg: ReturnType<typeof getProvider>`（含 null）、`params { provider?: string }` 於本階段（`strictNullChecks:false`）不 cascade；未來 `strict:true`（rebaseline 之後、~998 error 浪次）會使 `cfg.clientId`/`params.provider?.toLowerCase()` 等成 `X | undefined/null` → 需補 narrowing。此為 strict 浪次已知待補點、**非本棒 scope**（本階段誠實型）；列此供 ① Arch / ② Codex Plan 審者知悉。
- **NB-4**：`getProvider` 第 3 caller = callback.ts:54（本檔）；env:Env 由棒3-env #144 解 TS2559，**本棒不觸 env.d.ts**（SPEC-C 對映 ARCH-3B-10）、僅槓桿其效果。
- **NB-5（⚠ File reachability → 棒5）**：exchangeCode 4 錯的根因 = `FormData File|string`（§1.3、scout workerd 實測 `instanceof File`）；修法 guard = runtime-delta、**依 owner descope 到棒5**（SPEC-C-8）。**本棒不碰**（SPEC-C-3）。棒5 另含 LINE id_token hardening（[[project_line_idtoken_verify_hardening_backlog]]），兩子 scope 皆 runtime、須各自明列（SPEC-C-8/9）。
- **NB-6**：shipped 集 = 1 source（callback.ts）+ 本 plan doc companion；source surface = {`callback.ts`}（SPEC-C-1）。
- **NB-7（棒4-type vs 棒5 邊界；SPEC-C-8/10）**：本棒**只標型別**，`verifyLineIdToken`（L620–645）驗證邏輯本體、L61 substring 守門、exchangeCode narrowing **全不碰**；棒5 才做這些 runtime/security 變更。PR1 與棒5 **禁交錯實作/共用未提交 diff**（SPEC-C-10）。

## 7. 後續棒次（owner S2 序列）
- 棒1 oauth utils(33)✅ 2do → 棒2 admin oauth-clients(19)✅ 2dp → 棒3a flow issuance(20)✅ 2dq → 棒3-env(enabler)✅ 2dr #144 → 棒3b init/bind-email(6)✅ 2ds #145 → **本棒 棒4-type callback(23；PR-2dt)** → **棒5 = LINE id_token hardening + 棒4-guard（exchangeCode 4 錯 + File narrow guard）**（runtime/security、L3 重走 SPEC+Plan Gate、SPEC-C-8/9）。
- **oauth 域（105）全清 = 棒5 完成後**（本棒 callback 留 4；SPEC-C-7 禁本棒宣稱全清）。→ noImplicitAny=0 後 rebaseline `1119→0` → `strict:true`(~998) → scripts → tests → browser。

---

## Index receipt（archive 用；本檔結案後搬 MEMORY 對應）
- Path C 之 PR1：清 callback.ts 23/27 noImplicitAny → 0（3 handler ctx + 4 fetchProfile + 6 JWKS-let + 8 verify + 2 escapeHtml/htmlError；exchangeCode 4 TS7031 明示保留 descope 棒5）；REMOVED=23/ADDED=0、byte-identical（sha `2c313404…` 22854、cmp -s + SHA-256、byte-equality 主判準）。post-ratchet 385/18/317（callback 仍 dirty）。
- 結構障礙 §1.3：`FormData File|string`（scout workerd 實測 File 可達）→ exchangeCode 無 byte-identical type-only 解 → owner Path C descope guard 到棒5。
- 新 OD form：OD-4-JWKS（`let ...: ReturnType<typeof createRemoteJWKSet> | null`）、OD-4-TOKENS（least-claim shape）、OD-4-CFG-NULL（strict deferral）。
- SPEC-C-1..10（allowlist 僅 callback / 恰 23 標註 / exchangeCode 保留 / 禁 runtime AST / ratchet 385-18-317 halt-drift / byte-equality 主判準 / 禁宣稱全清 / 棒5 子 scope / 棒5 重走 gate / 禁交錯）。
