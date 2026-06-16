# Stage 7 reduce PR-2bb — `functions/utils/cors.ts` strict cleanup（auth-core chain 第 12 棒，functions leaf 最後一刀）

**目標**：`functions/utils/cors.ts` 的 **7 個 TS7006 + 1 個 TS2551 → 0**，純 type-only（1 檔 +5/−5；零 runtime 行為改動、零其他檔 cascade）。

> **scope framing（owner 糾正，2026-06-16）**：本刀**不是「8 個 noImplicitAny」**。實測 8 個 local error 中，**7 個是 TS7006（noImplicitAny 驅動），1 個是 TS2551（`headers` object literal 結構型別缺口，與 noImplicitAny flag 無關）**。TS2551 在本 doc 一律標為 **collateral strict type gap**——它是「為把 cors.ts strict errors 清空所必須順手修掉的既存型別缺口」，**不計入 noImplicitAny error 數**。不拆 PR（type-only、同檔、同一刀清空最自然）。

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。…→ `scopes.ts`（PR-2y `01a42a2`）→ `rate-limit.ts`（PR-2z `52c5f0b3`，chain 首個 Dual Gate v3）→ **api middleware 群**（PR-2aa `25754678`，chain 首個多檔、4 檔 18 個）→ 本 PR = **第 12 棒 `cors.ts`**（security-boundary 單獨 PR，CORS allowlist / credentials 邊界，為 PR-2aa 那 4 個 `_middleware.ts` 的 `getCorsHeaders` 上游）。**cors.ts = functions leaf noImplicitAny 最後一刀**；本刀後 functions leaf noImplicitAny 清零 → 開 `strict:true`（~140 strictNull/catch）→ scripts → tests → browser leaf。

base main `25754678`（PR-2aa squash 後現行 main，branch fork point）。baseline 已於該 SHA 實測（見 §預期 ratchet / §Spike 實證）：**877 / 100 / 234 / 334**（canonical `npm run typecheck:ratchet:report`）。**勿**沿用更舊快照數字。

> **Gate 紀錄（Dual Gate Workflow v3，[[feedback_codex_review_workflow]]）**：當前 state = **`CODEX_CODE_APPROVED`**（@ source `5a653db6`；三道外部 gate 全過、機械 gates 全綠；待 owner 明示 squash-merge；未 push、未開 PR、未動 main）。
> - 2026-06-16 owner 當輪明示「可以開 plan doc」+ scope 糾正 + 逐項裁決（見下）= **SPEC_APPROVED**。spec：scope = `cors.ts` 7 TS7006 + 1 TS2551 collateral 清零、純 type-only reduce PR；Non-goals = 不碰 CORS policy / allowlist / header value / credentials 分支 / origin 判斷、不碰 caller / tests / config、**不順手 trim JSDoc**（owner 鎖定）、`admin/payments/intents.ts` 的 `cors` param out-of-scope。impl 級別 = **L1**、review care = **L2**（owner 拍板）。同輪預授權 A1 spike + plan doc 落檔 commit feature branch。
> - 2026-06-16 **A1 spike 已執行並全項達標**（見 §Spike 實證；主方案單輪零修正，含「minimal candidate 無顯式 return annotation 即零 cascade」的實證），working tree 已 revert clean（HEAD `25754678`、僅 `?? CLEANUP_PLAN.md` untracked）。
> - 2026-06-16 Claude plan 自審到零（`PLAN_SELF_REVIEW_CLEAN`，**單 agent 對抗式**，L1）：見 §流程定位 自審紀錄。
> - **級別研判 = L1（純 type annotation + 1 個 object-variable 型別標註，TS erase 後 0 runtime）**。理由：5 行改動全為型別層（param annotation erase / `Record<string,string>` 變數標註 erase），無新 endpoint / schema / 權限 / 契約 / runtime 邏輯；spike 證 runtime byte-identical（type-strip no-op）。**但 cors.ts = CORS security boundary（跨來源信任邊界 + credentials gating），故沿 PR-2z/2aa 例附「Code Gate 用 L2 熱區檢查法複核」**（owner 已預先拍板 review care L2）。**L1 仍走完整 3 道基本外部審查**（ChatGPT Arch + Codex Plan + Codex Code）；L1 不產生 `CHATGPT_CODE_FAITHFULNESS_APPROVED` state、self-review 用單 agent。**級別可由 Arch / Codex 任一方挑戰，疑義 fail-safe 升 L2**（[[feedback_codex_review_workflow]] §7）。**→ ChatGPT Arch 已裁（@ `c52b7375`）：implementation 維持 L1 型別修補、review care 升 L2**（Code Gate 以熱區法驗 TS erase 後 CORS runtime 不變；重點 allowlist / credentials / fail-closed `{}` / `resolveAud` fail-safe byte-identical）。
> - 2026-06-16 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`（@ `c52b7375`）** — 0 blocker、0 required revision、2 non-blocking notes。OD-1..4 全裁（與 frozen 版一致 → frozen diff 不變）。Arch hard-lock approved scope：僅 `cors.ts` 1 檔 +5/−5 / 877→869 / errorFiles 100→99 / cleanFiles 234→235 / `comm -13` 空必重現 / baseline 1119/175 不動 / 無 `:any`·suppression·新 `as`·新 import·runtime branch；TS2551 修法須為 `Record<string,string>` 標註（非 conditional-spread runtime 改寫）；caller/tests/config/JSDoc/`admin/payments/intents.ts` 全不碰。
>   - **NB-1（採納，coding 紀律）**：實作對帳一律用 raw diff（`git diff --word-diff` / raw patch），勿被聊天介面長行折行誤導（`getCorsHeaders(...)` 那行 142 字元）。
>   - **NB-2（採納）**：`getCorsHeaders` inferred return 維持 `Record<string,string> | {}`，本 Gate 接受（spike 證 caller/test 零 cascade）；若 Codex 要改顯式 `: Record<string,string>` = **新裁決**，須回 plan 改 frozen diff，**不可在 coding 階段私改**。
> - 2026-06-16 **Codex Plan Gate：`CODEX_PLAN_APPROVED`（@ `c032864f`）** — 0 blocker / 0 critical risk。Codex 對帳：`main..HEAD` = 2 docs commit、tracked surface 僅本 plan doc（`c032864f` vs `c52b7375` 只改 Gate trail）；`functions/utils/cors.ts` 無 source diff、merge-base `25754678`、base blob `c9cb43ed` 對上 frozen diff 舊側；scope framing 正確（7 TS7006 + 1 TS2551 collateral，未誤報）；§驗證計劃 含 `test:cov`、baseline 不 `--update`、`comm -13` 空必重現、source diff 逐行 = frozen。Codex 本輪 read-only（未跑 tsc/test）。**只批 plan gate，非 coding approval**。
>   - **Residual（非 blocker）**：doc code fence 非可直接 `git apply --check` 的 raw patch（空白 context 行少 diff 前綴空格——為避 `git diff --check` trailing-ws 而刻意，[[feedback_plan_frozen_diff_git_diff_check]]）；NB-1 已訂 coding 用 raw `git diff` 對帳，不構成 blocker。
> - 2026-06-16 **owner 明示 `CODING_ALLOWED`** → 進 Code 階段。frozen diff replay：working-tree `git diff` 對 frozen **byte-identical**（1 檔 +5/−5，resulting blob `c94be48b` == frozen 新側；NB-1 raw-diff 對帳）。source commit `5a653db6`。
> - 2026-06-16 **機械層 gates 全綠**（@ source `5a653db6`）：forced tsc `cors.ts` 0 殘留 / total 877→869（−8）/ zero cascade（`comm -13` 空、`comm -23` = 恰 8 行、after-set == spike byte-identical）；`RATCHET_BASE_REF=25754678 npm run typecheck:ratchet` OK（current **869/235**、baseline **1119/175 不動**、effectiveRange `25754678...HEAD`）；`lint` 0；`build:functions` 0（Worker compiled）；`test:cov` **737/737**（`cors.ts` 100% stmt/branch/func/line）；`test:int` **1327/1328**——**1 個非本刀失敗 = `credential-disposition.test.ts` 某 wallet-disposition case 在 490s 滿載全量跑時 5000ms timeout（load-induced flaky；該 case 單跑 3562ms borderline），isolated 重跑 22/22 綠（exit 0）**；該 case 與 CORS/aud 無關、型別改動 runtime byte-identical（build:functions 證），不歸因本刀。`git diff --check main...HEAD` clean。
> - 2026-06-16 **`CODE_SELF_REVIEW_CLEAN`（單 agent 對抗式，@ source `5a653db6`，L1，一輪 0 新發現）**：對抗——faithful replay（blob == frozen `c94be48b`）✅；scope（僅 cors.ts，caller/tests/config/JSDoc/`admin/payments/intents.ts` 未碰）✅；runtime-invariance（型別 erase + build:functions compiled + test:cov `cors.ts` 100% 全綠）✅；security boundary byte-identical（allowlist / dev regex / fail-closed `{}` / credentials / resolveAud fail-safe）✅；無 `:any`/suppression/新 `as`/新 import/新 runtime branch（eslint 證）✅；**NB-2 守住**（未私標 `getCorsHeaders` return type，維持 inferred `Record<string,string> | {}`）✅；ratchet honesty（報「current 降至 869」、baseline file 未 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）✅；無新 cosmetic 債（JSDoc 依 OD-4 鎖定保留、非疏漏）✅。
> - 2026-06-16 **Codex Code Gate：`CODEX_CODE_APPROVED`（@ source `5a653db6`）** — 0 blocking。對帳：source scope 僅 `functions/utils/cors.ts` +5/−5（blob `c94be48b`）、added = 4 param 標註 + `const headers: Record<string,string>`、無 `:any`/suppression/新 `as`/import/runtime branch；CORS 行為 byte-identical（header key/value / allowlist / dev regex / fail-closed `{}` / `opts.credentials` / `resolveAud` fail-safe）；NB-2 守住（return 維持 inferred）。Codex 重跑 `ratchet`（869/235、1119/175 不動）/ forced tsc（869、cors 0）/ `lint` / `build:functions` / `git diff --check 25754678..HEAD` 全綠；`test:cov`·`test:int` 採 gate-record（未重跑、未偽裝為本機證據）。Residual：`?? CLEANUP_PLAN.md` 為 untracked scratch（預期、不 stage）、tracked tree clean。
> - **MERGE：待 owner 明示點頭**（L1 路徑不產生 `CHATGPT_CODE_FAITHFULNESS_APPROVED` state）。未點頭前不 push / 不開 PR / 不 merge / 不動 main。

## ⚠ CORS security-boundary 敏感聲明（最高優先紀律）

`functions/utils/cors.ts` 是**跨來源信任邊界 SSOT**（`docs/audit/04-security-boundary.md` 列冊）：
- `getCorsHeaders(request, env, opts?)` — 依 **origin allowlist**（`getAllowedCorsOrigins()` registry + `env.ALLOWED_ORIGINS` + dev-only localhost）決定是否回 CORS header；非白名單 origin **回空物件 `{}`**（不加任何 CORS header，瀏覽器自行攔截）。`opts.credentials` 控制 `Access-Control-Allow-Credentials: true`（僅 `/api/auth/*` 帶 cookie 端點用）。
- `resolveAud(input)` — JWT `aud` claim 解析：依 redirect/origin 決定 token 受眾（registry `getAudByOrigin` / `getValidAuds`），未匹配 fail-safe → `'chiyigo'`。

**誤改 = 安全事件**（allowlist 放寬 / credentials 誤帶 / aud 誤判 → 跨來源憑證外洩或越權）。**修法若非純型別、或會牽動：origin allowlist 判斷（`isAllowedOrigin` / `getAllowedOrigins` 控制流）/ dev-mode localhost regex / 空物件 fail-closed 分支（`return {}`）/ header key·value 字面值 / `opts.credentials` 分支 / `resolveAud` 的 narrowing·fail-safe `'chiyigo'` → 立刻停手回 `PLAN_DRAFT`。** TS erase 後 runtime 行為必須不變（所有字串字面值 / 控制流 / 既有 JSDoc·註解 byte-identical）。

## Coding 階段硬性邊界

- **允許（= §Spike 最終 diff 逐行，1 檔 +5/−5）**：
  1. `getAllowedOrigins(env)` → `env: Pick<Env, 'ALLOWED_ORIGINS'>`（本函式只讀 `env.ALLOWED_ORIGINS`）。
  2. `isAllowedOrigin(origin, env)` → `origin: string` + `env: Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>`（讀 `ENVIRONMENT` + 把 env 傳給 `getAllowedOrigins`）。
  3. `getCorsHeaders(request, env, opts)` → `request: Request` + `env: Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>`（`opts` 已 typed，不動）。
  4. `const headers = {…}` → `const headers: Record<string, string> = {…}`（**唯一非 param 標註；修 TS2551 collateral**）。
  5. `resolveAud(input)` → `input: unknown`（body 既有 `typeof input !== 'string'` narrowing）。
- **禁止**：改任何 CORS header key/value / origin allowlist 規則 / `isAllowedOrigin`·`getAllowedOrigins` 控制流 / dev-mode localhost regex / `return {}` fail-closed 分支 / `opts.credentials` 分支邏輯 / `resolveAud` narrowing 與 fail-safe；改 caller、改 tests、改 tsconfig / eslint / vitest；新增字面 `:any`、新增 suppression、新增 `as`/cast、新增 import、新增 runtime guard 或分支；**順手 trim JSDoc `@param {object}` 型別標註**（owner 鎖定不動，見 OD-4）；**顯式標 `getCorsHeaders` 的 return type**（無 error 驅動，spike 證零 cascade，見 OD-3）；改 `admin/payments/intents.ts` 的 `cors` param（out-of-scope，見 §Scout）。

## Scout（對抗式驗證）

### exact errors（forced tsc @ `25754678`，total 877）

恰 **8** 個，全在 `functions/utils/cors.ts`（`node ./node_modules/typescript/bin/tsc -b tsconfig.solution.json --force --pretty false` 實測；無其他 error code 殘餘於本檔）：

| 位置（line,col）/ 標的 | code | 性質 |
|---|---|---|
| (12,28) `getAllowedOrigins(env)` | TS7006 | noImplicitAny |
| (14,42) `.map(o => …)` 的 `o` | TS7006 | noImplicitAny（**標 `env` 後 cascade 自動消**，不單獨標） |
| (19,26) `isAllowedOrigin(origin, …)` | TS7006 | noImplicitAny |
| (19,34) `isAllowedOrigin(…, env)` | TS7006 | noImplicitAny |
| (34,32) `getCorsHeaders(request, …)` | TS7006 | noImplicitAny |
| (34,41) `getCorsHeaders(…, env, …)` | TS7006 | noImplicitAny |
| (51,28) `resolveAud(input)` | TS7006 | noImplicitAny |
| **(44,33)** `headers['Access-Control-Allow-Credentials'] = 'true'` | **TS2551** | **collateral strict type gap**（object literal 推窄後不含此 key；與 noImplicitAny flag 無關，runtime 正常） |

**= 7 TS7006 + 1 TS2551**。`(14,42)` 的 `o` 是 `getAllowedOrigins` 內 `.map(o => o.trim())`，標 `env` 參數後 `env.ALLOWED_ORIGINS.split(',')` 推為 `string[]` → `o` 自動推 `string`，故不單獨標（最小 diff）。

**out-of-scope（同 forced tsc 浮出、明確不在本刀）**：`functions/api/admin/payments/intents.ts(195,28): TS7006 Parameter 'cors'` — 那是該檔自己一個叫 `cors` 的 local param 的 implicit-any，與本檔無關，留待該檔輪到時處理。

### 依賴邊界（cascade 面，已 comm 實證）

- **caller 面**：`getCorsHeaders` / `resolveAud` 被 `functions/` 下約 40 個 handler / middleware import 呼叫（含 PR-2aa 剛 typed 的 4 個 `_middleware.ts`）。middleware 端以 `Object.entries(corsHeaders)` 消費（非 property access）；其餘 caller 傳 `context.env`（runtime 為完整 `Env`，assignable 到本檔 `Pick<Env, …>` subset）。
- **zero cascade（實證，非推論）**：spike forced full rebuild 後 `comm -13 before after` = **空**（全 solution graph：functions + scripts + tests + browser leaf 無任何新增 error 行）；`comm -23 before after` = **恰 8 行**（即本檔 8 個 error 逐行對上）。stricter 簽章只可能**新增** caller error、不可能消他檔 error；total 恰 877→869（−8）數學上排除任何淨新增。
- **tests-leaf 無 cascade**：`tests/cors.test.ts` 是本檔唯一 direct unit test（`resolveAud` + `getCorsHeaders`）。其以 partial fake env（`{}` / `{ ALLOWED_ORIGINS: … }` / `{ ENVIRONMENT: 'development' }`）與 non-string input（`resolveAud(123/null/undefined)`）呼叫；spike 證 0 新 error（見 §型別選型 對應設計）。tests-leaf 目前 noImplicitAny OFF（test 自身 `req(origin)` helper 仍 implicit-any 卻 clean 可證），故僅真型別不相容才 cascade，而本設計全部 assignable。

### 型別選型（per-symbol；chain pattern + 既有 handler 慣例 + spike 實證）

- **`env: Pick<Env, …>`（非 full `Env`）**：`Env` 為 `types/env.d.ts` `declare global` ambient（prior chain PR 已用 + eslint globals 已註冊）。用 `Pick` 而非 full `Env` 是為**保護 tests-leaf**：`cors.test.ts` 以 `{}` / 單鍵 partial 物件當 env 呼叫，full `Env` 會讓那些 call 報 TS2345 cascade（[[feedback_util_env_param_pick_not_full_env]]）。已驗 `types/env.d.ts:81,83` —`ENVIRONMENT?` / `ALLOWED_ORIGINS?` **皆 optional** → `Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>` 兩鍵皆 optional → test 的 `{}` / 單鍵 partial 全 assignable（spike comm 證 0 test error）。per-symbol 取實讀鍵：`getAllowedOrigins` 只讀 `ALLOWED_ORIGINS` → `Pick<Env, 'ALLOWED_ORIGINS'>`；`isAllowedOrigin` / `getCorsHeaders` 讀/傳 `ALLOWED_ORIGINS` + `ENVIRONMENT` → `Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>`（`isAllowedOrigin` 把較寬的 2-key Pick 傳給 1-key `getAllowedOrigins` → assignable）。
- **`request: Request`（非 `CfRequest`）**：`getCorsHeaders` 只讀 `request.headers.get('Origin')`，**不讀 `request.cf`** → 用標準 global `Request`（WebWorker lib），遵 chain 的 CfRequest opt-in 紀律（[[feedback...]] PR-2aa §型別選型：「CfRequest 只在實讀 `request.cf` 的參數標」）。`cors.test.ts` 傳標準 `new Request(...)` → 相容。
- **`origin: string`**：`isAllowedOrigin` 內全程當 string 用（`includes` / regex `.test`）；caller `getCorsHeaders` 傳 `request.headers.get('Origin') ?? ''`（`string`）。
- **`input: unknown`（非 `string`）**：`resolveAud` body 開頭即 `if (!input || typeof input !== 'string') return 'chiyigo'`（runtime narrowing 設計給 untrusted input）。`cors.test.ts` 明確測 `resolveAud(123)` / `resolveAud(null)` / `resolveAud(undefined)` → **標 `string` 會破這些 test（TS2345）**，必用 `unknown`（[[feedback_ts_no_jsdoc_in_ts_mode]]：`.ts` 不讀 JSDoc，補洞走 inline annotation；此處 `unknown` 最忠於既有 runtime 契約）。
- **`headers: Record<string, string>`（修 TS2551）**：原 `const headers = {…}` 被推為含 5 個固定 key 的 object literal，第 44 行 `headers['Access-Control-Allow-Credentials'] = 'true'`（conditional credentials key）因該 key 不在推窄型別 → TS2551。標 `Record<string, string>` 使動態加 key 合法、且讓 return 對 ~40 caller / test 的字串消費（`Object.entries` / `h['…']`）相容。**runtime 不變**（型別標註 erase；conditional 賦值演算法不動）。spike 證：此標註後**無需顯式 return annotation** 即零 cascade（見 OD-3）。

## Open Decisions（prose 裁決，[[feedback_gate1_forks_prose_ruling]]）

- **OD-1：TS2551 修法** — 主方案 `const headers: Record<string, string> = {…}`（型別標註、最小、in-scope）vs 改寫成 conditional spread（`{ …base, ...(opts.credentials ? { 'Access-Control-Allow-Credentials': 'true' } : {}) }`）。
  - **主方案（`Record<string,string>` 標註，建議）**：純型別、+0 行控制流改動、runtime byte-identical、最小 diff（單行 `const headers` 加標註）。
  - **conditional-spread 變體**：消滅「先建物件再動態加 key」的 pattern，但**改 runtime 物件建構演算法**（即使語意等價，已非 type-only）→ 超出本刀 type-only scope，且 CORS header 組裝為安全相關，須獨立 behavior-review（[[feedback_security_boundary_pr_first_do_no_harm]] 最小 diff）。
  - **建議裁主方案**；owner 已裁「`Record<string,string>` 允許」。
- **OD-2：`env` Pick 粒度** — 主方案 **per-symbol 取實讀鍵**（`getAllowedOrigins` = 1-key、另二 = 2-key）vs 三處共用同一個 `Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>` union。
  - **主方案（per-symbol，建議）**：最忠於 [[feedback_util_env_param_pick_not_full_env]] 的「實讀 key」精神（`getAllowedOrigins` 確實不讀 `ENVIRONMENT`）；deny-by-default（誤在 `getAllowedOrigins` 讀 `ENVIRONMENT` 會編譯期擋）。
  - **共用 union 變體（defensible）**：單一型別表達式、略少視覺重複，但讓 `getAllowedOrigins` 接受它不讀的鍵（過寬）。
  - **建議裁 per-symbol**；若 Arch 偏好共用 union（一致性 > 最小權限），以該裁決為新凍結基準（`getAllowedOrigins` 同步改 2-key）。
- **OD-3：`getCorsHeaders` 是否顯式標 return type** — 主方案**不標**（留 inferred）vs 顯式 `: Record<string, string>`。
  - **主方案（不標，建議）**：`headers` 標 `Record<string,string>` 後，return 型別為 `Record<string, string> | {}`（fail-closed `return {}` 分支）。**spike 實證：不標 return 即零 cascade**——`cors.test.ts` 重度 `h['Access-Control-Allow-Origin']` 索引與 ~40 caller 消費全部 0 新 error。chain 紀律「無 error 驅動項不動」（PR-2aa 同則）→ 不標。
  - **顯式 `: Record<string,string>` 變體**：理論上更整齊（消去 `| {}` arm），但**無 error 驅動**（spike 證不需），且多一處非最小標註。
  - **建議裁不標**；若 Arch / Codex 認為 `| {}` arm 應顯式收斂，可改裁顯式標（`return {}` 仍 assignable 到 `Record<string,string>`，不破 fail-closed 語意）。
- **OD-4：是否順手 trim 既有 JSDoc** — `getCorsHeaders` 上方 JSDoc 含 `@param {Request} request` / `@param {object} env` / `@param {object} [opts]`，在 `.ts` 模式型別部分已被 inline annotation 取代而冗餘。
  - **owner 裁決（2026-06-16）：不 trim、鎖定不動。** 理由：(a) 非 error 必要修復；(b) 會把 type-only PR 變 mixed cleanup；(c) cors.ts 是 security boundary，diff 越窄越好；(d) stale JSDoc 可等未來碰同檔或獨立 delint PR。`opts.credentials` 那段 JSDoc 描述（解釋為何帶 cookie 的端點才 `credentials:true`）本身是有效「why」註解，保留。OD-4 關閉。

**考慮過、否決**：
- **`input: string`（resolveAud）**：破 `cors.test.ts` 的 `resolveAud(123/null/undefined)`（TS2345）。否決，用 `unknown`。
- **`env: Env`（full）**：tests-leaf `{}` / partial fake env → TS2345 cascade。否決，用 `Pick`。
- **`request: CfRequest`**：本檔不讀 `request.cf` → 違反 CfRequest opt-in 紀律、過寬。否決，用 `Request`。
- **單獨標 `.map(o => …)` 的 `o`**：標 `env` 後自動 cascade 消，單獨標是冗餘。否決。
- **trim JSDoc**：owner 鎖定不動（OD-4）。否決。

## Spike 實證（A1，2026-06-16，已 revert）

**程序**：`rm -rf .tscache` → 套 5 處標註（4 param + 1 `const headers` 變數標註）→ `node ./node_modules/typescript/bin/tsc -b tsconfig.solution.json --force --pretty false`（全重建，含 tests-leaf——`tsconfig.solution.json` references `tsconfig.tests.json`）→ sort-diff（error TS 行 `comm`）→ `git diff --stat` / `git diff --check` / `eslint` → `git diff` 凍結 → `git checkout --` revert → 驗 clean。（tsc 走 `node ./node_modules/typescript/bin/tsc`；chain 紀律 `npx tsc` 本機可能誤解析、`--force` 全重建避增量短報 [[feedback_tsc_b_incremental_stale_after_ambient_dts]]。）

**主方案單輪達標（零修正輪）**：

| 驗收條件 | 結果 |
|---|---|
| `cors.ts` errors 8 → 0 | ✅ forced tsc：本檔 0 殘留 |
| total errorCount 877 → 869（恰 −8） | ✅ forced tsc `grep -c 'error TS'` = 869 |
| zero cascade（全 solution graph：functions + scripts + tests + browser leaf） | ✅ `comm -13 before after` = **空**（新增 0 行）；`comm -23` = **恰 8 行**（本檔 7 TS7006 + 1 TS2551 逐行對上） |
| TS2551 修復（`Record<string,string>` 後 conditional credentials 賦值合法） | ✅ forced tsc 本檔 (44,33) 0 殘留 |
| **無需顯式 return annotation 即零 cascade**（`cors.test.ts` 重度 `h['…']` 索引 + ~40 caller 消費） | ✅ minimal candidate（不標 return）comm -13 空，OD-3 主方案成立 |
| tests-leaf 無 cascade（partial env `{}`/單鍵 + `resolveAud(123/null/undefined)`） | ✅ `tests/cors.test.ts` 0 新 error（含在 solution forced build；comm 證） |
| lint | ✅ `npx eslint functions/utils/cors.ts` exit 0（`Env`/`Request` 既有 global、`Pick`/`Record` TS 內建、無 `:any`） |
| diff 面 | ✅ `git diff --stat` = **1 檔 +5/−5**；`git diff --check` exit 0（無 trailing whitespace） |
| working tree revert clean | ✅ revert 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（untracked scratch）、HEAD `25754678`（本 doc 凍結 diff 為 SoT） |

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，1 檔 +5/−5；OD-1 採 `Record<string,string>` / OD-2 採 per-symbol Pick / OD-3 不標 return / OD-4 JSDoc 不動）**：

```diff
diff --git a/functions/utils/cors.ts b/functions/utils/cors.ts
index c9cb43ed..c94be48b 100644
--- a/functions/utils/cors.ts
+++ b/functions/utils/cors.ts
@@ -9,14 +9,14 @@

 import { getAllowedCorsOrigins, getAudByOrigin, getValidAuds } from './oauth-clients'

-function getAllowedOrigins(env) {
+function getAllowedOrigins(env: Pick<Env, 'ALLOWED_ORIGINS'>) {
   const extras = env.ALLOWED_ORIGINS
     ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
     : []
   return [...getAllowedCorsOrigins(), ...extras]
 }

-function isAllowedOrigin(origin, env) {
+function isAllowedOrigin(origin: string, env: Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>) {
   if (!origin) return false
   if (getAllowedOrigins(env).includes(origin)) return true
   if (env.ENVIRONMENT === 'development' &&
@@ -31,10 +31,10 @@ function isAllowedOrigin(origin, env) {
  * @param {boolean} [opts.credentials] 跨子網域帶 cookie 的端點（refresh / logout / web token）
  *                                     傳 true 會加 Access-Control-Allow-Credentials: true
  */
-export function getCorsHeaders(request, env, opts: { credentials?: boolean } = {}) {
+export function getCorsHeaders(request: Request, env: Pick<Env, 'ALLOWED_ORIGINS' | 'ENVIRONMENT'>, opts: { credentials?: boolean } = {}) {
   const origin = request.headers.get('Origin') ?? ''
   if (!isAllowedOrigin(origin, env)) return {}
-  const headers = {
+  const headers: Record<string, string> = {
     'Access-Control-Allow-Origin':  origin,
     'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
     'Access-Control-Allow-Headers': 'Content-Type, Authorization',
@@ -48,7 +48,7 @@ export function getCorsHeaders(request, env, opts: { credentials?: boolean } = {
 // JWT aud claim 解析：依 redirect / origin 決定 token 受眾
 // 從 oauth-clients registry 動態讀（middleware refresh 後反映 D1 最新內容）
 // 未匹配 → 'chiyigo'（chiyigo.com 自家頁面）
-export function resolveAud(input) {
+export function resolveAud(input: unknown) {
   if (!input || typeof input !== 'string') return 'chiyigo'
   if (getValidAuds().has(input)) return input
   try {
```

（所有 CORS header key/value / origin allowlist 判斷 / dev-mode localhost regex / `return {}` fail-closed 分支 / `opts.credentials` 分支 / `resolveAud` narrowing·fail-safe / 既有 JSDoc·註解 **byte-identical**；新增 = 4 個 param 型別標註 + 1 個 `const headers` 變數型別標註；TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `25754678` `--report` 現況：errorCount **877** / errorFiles **100** / cleanFiles **234** / sourceFilesTotal 334（canonical `npm run typecheck:ratchet:report` 實測）。
- 本 PR 後 current state：errorCount **877 → 869**（−8，spike forced tsc `grep -c` 實測）、errorFiles **100 → 99**（−1）、cleanFiles **234 → 235**（+1）、sourceFilesTotal 334 不變。errorFiles/cleanFiles delta 由「proven zero-cascade + 單檔 bucket move」決定（`cors.ts` 由 error→clean，他檔 error-status 全不變，comm 證）；coding 階段 canonical `npm run typecheck:ratchet` 再確認。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 869」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 4 個 param 型別標註 + 1 個 `const headers` 變數型別標註，**TS erase 後 runtime 行為不變**（esbuild type-strip，annotation 全消；`Record<string,string>` 標註 erase 後 = 原 `const headers = {…}` + 動態加 key 的 byte-identical runtime）。
- `getCorsHeaders` / `resolveAud` 在 ~40 個 handler / middleware 同步呼叫 → 全量 integration suite 隱性覆蓋（middleware CORS 套用 / OAuth aud 解析）；另有 direct unit `tests/cors.test.ts`。coding 階段跑 `test:cov`（含 cors.test.ts）+ `test:int` 確認（見 §驗證計劃）。
- rollback：單一 squash revert 即完整回退（無 ambient 變更、無 migration、無 deploy 行為差）；revert 後 ratchet 自然回 877。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（spike comm 證 tests-leaf 0 新 error）。
- **direct unit**：`tests/cors.test.ts`（`resolveAud` 6+ case 含 non-string；`getCorsHeaders` 白名單 / 非白名單 / dev localhost / `ALLOWED_ORIGINS` 動態 / credentials 變體）—— 型別改動後此 suite 必須**全綠不改一行**（partial fake env + non-string input 設計已對應 §型別選型）。`npm test` / `test:cov` 覆蓋。
- **間接覆蓋（不宣稱為 direct）**：`getCorsHeaders` 在每個跨子樹 `/api/*` request 由 `_middleware.ts` 呼叫、`resolveAud` 在 token / oauth 路徑呼叫 → CI 全量 integration 隱性經過。
- **runtime-invariance 論證（非靠新 test）**：型別標註對 esbuild bundle 為 no-op（type-strip）→「標註版」與「原版」runtime bundle byte-identical → 既有 test 結果 construction-invariant。coding 階段仍跑 `test:cov` + `test:int` 作 belt-and-suspenders。
- **strict-rung 邊界（不在本 PR scope）**：本檔開 `strict:true` 後預期 `request.headers.get('Origin')` 已 `?? ''` null-safe、`getAudByOrigin()[origin]` index access 在 `noUncheckedIndexedAccess` 下可能浮 1-2 個 strictNull 債——登記供 strict 棒對帳，與本 noImplicitAny 棒無關。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後）

> 本 PR 無 ambient .d.ts 變更；沿 chain SOP 所有 tsc/ratchet 量測一律 `rm -rf .tscache` 全重建。reduce-PR local-verify 陷阱（[[feedback_ts_ratchet_discipline]]）：branch 已有 plan-doc commit → tip != origin/main，plain ratchet base 自動 = origin/main `25754678`；保險可 `$env:RATCHET_BASE_REF='25754678'; npm run typecheck:ratchet`。**不帶** `RATCHET_ALLOW_BASELINE_RAISE`（error-reducing reduce PR、正常下降）。

- `$env:RATCHET_BASE_REF='25754678'; npm run typecheck:ratchet` green（877→869 / 100→99 / 234→235）。
- `npm run lint` green（全量 `eslint functions tests` + compat-date + workflows）。
- `npm run build:functions` green（type-only、esbuild type-strip，bundle 無型別殘留）。
- filtered forced tsc：`cors.ts` 0 殘留、sort-diff 重放（移除 8 行、零新增）。
- **`npm run test:cov` green**（CI `test` 為 fail-fast 單 job、先跑 cov；cov 紅會 skip test:int/build/audit → 必先綠，[[feedback_pre_merge_gate_checklist_match_ci]]；**含 `tests/cors.test.ts` direct unit，必逐 case 綠**）。
- **全量 `npm run test:int` green**（middleware 全站注入 `getCorsHeaders`；接在 test:cov 之後，對齊 CI 順序）。
- baseline file 不得 `--update`（天花板 1119/175 保持）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（1 檔 +5/−5，不得多檔；若 Arch 改裁 OD-2/OD-3 則以該裁決為新凍結基準）；超出 = scope creep = Gate fail。
- **Arch Gate approved-scope 對帳基準（Codex / code stage 逐項複核）**：
  1. 8 errors（7 TS7006 + 1 TS2551）→ 0（不多不少；ratchet 877→869）
  2. type-only（TS erase 後 runtime 行為不變、所有 CORS header / 控制流 / 字面值 byte-identical）
  3. 僅 `functions/utils/cors.ts` 1 個 production 檔（無 ambient / config / tests / caller 改動）
  4. OD-1..4 裁決落實（`Record<string,string>` / per-symbol Pick / 不標 return / JSDoc 不動，或 Arch 改裁版）
  5. 全檔無字面 `:any` / 無 suppression / 無新 `as`·cast / 無新 import / 無新 runtime 分支；TS2551 修法為 `Record<string,string>` 標註（非 conditional-spread runtime 改寫）
  6. `admin/payments/intents.ts` 的 `cors` param 確認 out-of-scope（未動）
- merge 後 smoke：credential-free = home / login 200（chain 預設）；CORS 行為以全量 integration + CI 為準。

## 流程定位

- Dual Gate Workflow v3：`SPEC_APPROVED`（owner「可以開 plan doc」+ scope 糾正 + 逐項裁決）✅ → A1 spike ✅ → **`PLAN_SELF_REVIEW_CLEAN`**（單 agent 對抗式，L1）✅ → 本 doc commit（feature branch `stage7-pr2bb-cors-noimplicitany`）✅ → **`CHATGPT_ARCH_APPROVED`**（@ `c52b7375`，0 blocker、OD-1..4 全裁、NB-1/NB-2）✅ → **`CODEX_PLAN_APPROVED`**（@ `c032864f`）✅ → **`CODING_ALLOWED`**（owner）✅ → coding（frozen byte-identical replay @ source `5a653db6`）✅ → 機械 gates 全綠 ✅ → **`CODE_SELF_REVIEW_CLEAN`**（@ source `5a653db6`）✅ → **`CODEX_CODE_APPROVED`**（@ source `5a653db6`，0 blocking）✅ → **owner 明示 squash-merge**〔← 當前待 owner〕（L1：不走 ChatGPT faithfulness 複核、不產生該 state）→ push → PR → CI `test` 綠 → squash-merge --delete-branch → `MERGED_MAIN`。
- **Claude plan 自審紀錄（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式，L1，一輪 0 新發現）**：對抗以下探針——
  1. **delta 數學**：877−8=869 ✅；comm -13 空（零 cascade）、comm -23 = 8 行 ✅；errorFiles/cleanFiles 由單檔 bucket move 決定（100→99 / 234→235）✅。
  2. **TS2551 framing**：明標 collateral、不計入 noImplicitAny 數（owner 糾正落實）✅；修法 `Record<string,string>` 為型別標註非 runtime 改寫 ✅。
  3. **tests 安全性**：`Pick` 兩鍵 optional（env.d.ts:81,83 實證）→ test partial env assignable ✅；`input: unknown` 保 `resolveAud(123/null/undefined)` ✅；`request: Request` 容 `new Request()` ✅。
  4. **return type 風險**：spike 證不標 return 即零 cascade（`| {}` arm 不破 caller/test 索引）✅；OD-3 留逃生（Arch 可改裁顯式標）✅。
  5. **security boundary 不變**：origin allowlist / dev regex / `return {}` fail-closed / credentials 分支 / resolveAud fail-safe 全 byte-identical（frozen diff 逐行核）✅。
  6. **scope 邊界**：`admin/payments/intents.ts` cors param 明列 out-of-scope ✅；JSDoc owner 鎖定不動 ✅；single-file ✅。
  7. **L1 研判**：純型別、TS erase 後 0 runtime；security boundary 故 review care L2（owner 拍板）✅；級別可由 gate 挑戰升 L2 ✅。
- merge 後監看 CI+Deploy；memory 收尾 receipt。
- **下一刀（owner 排序）**：cors.ts 後 functions leaf noImplicitAny **清零** → 開 `strict:true`（~140 strictNull/catch，新 flag PR）→ scripts leaf → tests leaf → browser leaf。
