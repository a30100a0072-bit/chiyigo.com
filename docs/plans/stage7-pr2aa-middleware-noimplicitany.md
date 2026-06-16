# Stage 7 reduce PR-2aa — api middleware 群 noImplicitAny（auth-core chain 第 11 棒，blast-radius 最大、放最後）

**目標**：`functions/api/` 下 **4 個 `_middleware.ts`** 共 **18 個 noImplicitAny error → 0**，純 type-only（4 檔 +41/−12；零 runtime 行為改動、零其他檔 cascade）。18 個 error 分布：
- `functions/api/_middleware.ts` — **9**（全 TS7006 named-function 參數 implicit-any）
- `functions/api/admin/_middleware.ts` — **3**（TS7031 binding element `{ request, env, next }`）
- `functions/api/ai/_middleware.ts` — **3**（TS7031 同上）
- `functions/api/auth/_middleware.ts` — **3**（TS7031 同上）

> **主線定位（owner C-1）**：auth-core 單檔 codex chain。…→ `jwt.ts`（PR-2v）→ `crypto.ts`（PR-2w）→ `siwe.ts`（PR-2x）→ `scopes.ts`（PR-2y `01a42a2`）→ `rate-limit.ts`（PR-2z `52c5f0b3`，chain 首個 Dual Gate v3 案）；本 PR = **第 11 棒 api middleware 群**（chain **首個多檔 PR**；`_middleware` = 全站 request context / auth·觀測性注入 + CORS 邊界，blast radius 最大、care level 最高，故排 chain 最後一刀的前一棒）。再續 `cors.ts`（security-boundary 單獨 PR，~20 caller）為 functions leaf 最後一刀。

base main `52c5f0b3`（PR-2z squash 後現行 main，branch fork point）。baseline 已於該 SHA 實測（見 §預期 ratchet / §Spike 實證），**勿**沿用更舊快照數字（memory 舊記 902/106/198 係 `01a42a2` 快照；本 PR base 實測 895/104/230）。

> **Gate 紀錄（Dual Gate Workflow v3，[[feedback_codex_review_workflow]]）**：當前 state = **`CODEX_CODE_APPROVED`**（@ source `95adc3fa`；三道基本外部審查全過；**待 owner 明示點頭 squash-merge；未 merge、未 push**）。
> - 2026-06-16 owner 當輪明示「開 middleware 群（第 11 棒）」= **SPEC_APPROVED**（沿 chain 既定 spec 模板：scope = 4 檔 noImplicitAny 清零、純 type-only reduce PR；Non-goals = 不碰 caller / tests / config / runtime 行為、不改 CORS·觀測·告警·Content-Type 守門邏輯、不顯式標 onRequest 的 return；同輪預授權 A1 spike + plan doc 落檔 commit feature branch）。
> - 2026-06-16 **A1 spike 已執行並全項達標**（見 §Spike 實證；主方案單輪零修正，含 admin getAll cast / request.cf 標註兩個實測 cascade 點），working tree 已 revert clean。
> - 2026-06-16 Claude plan 自審到零（`PLAN_SELF_REVIEW_CLEAN`，**單 agent 對抗式**，L1）：對抗 15+ 探針（cascade 數學、`next` narrowing 安全性、admin cast 不遮蔽 bug、`cf`/`data.observe`/`emit` 標型、L1 研判、middleware 檔完整盤點 4/4），一輪 0 新發現。
> - **級別研判 = L1（純 type annotation、TS erase 後 0 runtime；但較前棒多 3 個 local interface + 1 個 type cast，故附 PR-2z 式「Code Gate 用 L3 熱區檢查法複核」但書）**。理由：4 檔改動全為型別層（interface erase / cast erase / 參數標註 erase），無新 endpoint / schema / 權限 / 契約 / runtime 邏輯；spike 證 runtime byte-identical。**L1 仍走完整 3 道基本外部審查**（ChatGPT Arch + Codex Plan + Codex Code）；L1 不產生 `CHATGPT_CODE_FAITHFULNESS_APPROVED` state、self-review 用單 agent。**級別可由 Arch / Codex 任一方挑戰，疑義 fail-safe 升 L2**（[[feedback_codex_review_workflow]] §7）。**→ ChatGPT Arch 已裁（@ `89a961cf`）：implementation 維持 L1 型別修補、review care 升 L2**（Code Gate 以熱區法驗 TS erase 後 runtime 不變；重點 admin cast + request.cf/data.observe 觀測注入）。
> - 2026-06-16 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`（@ `89a961cf`）** — 准單一 PR、准 minimal `next`、准 admin getAll erased cast、**禁混入任何 set-cookie runtime 重構**。OD-1/2/3 全裁（與 frozen 版一致 → frozen diff 不變）。Arch hard constraints：source scope 僅 4 檔（不得碰第 5 個 source）/ forced tsc 精準 895→877（−18）/ 4 檔 TS7006·TS7031=0 / `comm -13` 新增 0 / removed-set 18 行逐行對應原 18 個 implicit-any / eslint clean / `git diff --check` clean / runtime byte-identical / 禁新 helper·import·套件·DB。另登記 backlog（admin/ai/auth set-cookie 統一 behavior-review PR）。
> - 2026-06-16 **Codex Plan Gate：`CODEX_PLAN_APPROVED`（@ `5090bf7e`）** — 無 blocker、無 critical risk。Gate note：code-stage gate list 須顯式含 `npm run test:cov`（已補進 §驗證計劃為一級項；plan 本身無缺陷、不阻擋）。Codex 本輪 read-only（未跑 tsc/test）。**只批 plan gate，非 coding approval**。
> - 2026-06-16 **owner 明示 `CODING_ALLOWED`** → 進 Code Gate。frozen diff 逐行 replay（live `git diff` 對 spike `frozen.diff` **byte-identical**，4 檔 +41/−12）。
> - 2026-06-16 **機械層 gates 全綠**：forced tsc 895→877（−18）/ 4 檔 0 / zero cascade（`comm -13` 空）；`tsc -b tsconfig.tests.json --force` exit 0；`lint` 0；`build:functions` 0；`test:cov` 737/737；`test:int` 1328/1328（75 files）；ratchet OK（base origin/main `52c5f0b3`，877/234，baseline 1119/175 不動）。
> - 2026-06-16 **`CODE_SELF_REVIEW_CLEAN`（單 agent 對抗式，@ source commit `95adc3fa`）**：faithful replay 確認、runtime-invariance（type-erase + `test:int` 全綠，middleware 全站注入）。**1 個 cosmetic nit 浮出、刻意保持 frozen 忠實**：`MiddlewareContext` 內 `// L144 讀 request.cf` 行號已 stale（實際 `request.cf` 讀在 **L172**，因上方插 28 行 interface）。**決策＝不擅改 gate-approved frozen 內容**，交 Codex Code Gate 裁（fix-in-PR vs follow-up；屬 §註解規則「禁過時引用」cosmetic，零 runtime/type、零 cascade）。
> - 2026-06-16 **Codex Code Gate：`CODEX_CODE_APPROVED`（@ source `95adc3fa`）** — 0 blocking。對帳：source surface 僅 4 檔 +41/−12、無第 5 source / 無新 import·helper·config·tests·DB / 無 `:any` / 無 suppression / 無 `as unknown as`；admin cast erase 後 = 原 `getAll('set-cookie')` 呼叫；request.cf·data.observe 僅型別化既有觀測 shape。Codex 本輪重跑 `git diff --check 52c5f0b3..HEAD` / ratchet（877/234、1119/175 不動）/ lint / build:functions 全綠；test:cov·test:int 採 gate-record 已跑結果（Codex 未重跑、未偽裝為本機證據）。`// L144` nit 裁**不阻塞、不在本 PR 修**（merge 後或下次碰 `api/_middleware.ts` 再改無行號 why-comment）。
> - **closeout 措辭紀律（Codex 建議採納）**：merge message / memory receipt 以 Codex 可獨立驗的「source scope + added/removed source lines faithful」描述，**勿強調**外部 local `frozen.diff` byte-identical artifact（Codex 無法獨立驗該 local 檔）。
> - **MERGE：待 owner 明示點頭**（L1 路徑不產生 `CHATGPT_CODE_FAITHFULNESS_APPROVED` state）。未點頭前不 push / 不開 PR / 不 merge / 不動 main。

## ⚠ auth / 邊界熱區敏感聲明（最高優先紀律）

4 檔 middleware 皆為**全站請求邊界 SSOT**：
- `api/_middleware.ts` = **全 `/api/*` 的觀測性注入（traceId / structured log / userId 標籤）+ 例外攔截（500 + traceId）+ Content-Type 守門（415）+ 5xx Discord 告警 + OAuth client cache refresh**。`data.observe` 是下游所有 handler 的觀測 metadata 掛載點。
- `admin/_middleware.ts` / `ai/_middleware.ts` / `auth/_middleware.ts` = 各子樹的 **CORS 邊界**（OPTIONS preflight 204 / 回應附 CORS header / auth 子樹額外 `Allow-Credentials: true` + 3xx 透傳不加 CORS）。CORS = 跨來源信任邊界，誤改 = 安全事件。

**修法若非純型別、或會牽動：log 欄位組裝 / traceId 產生 / Content-Type 豁免清單（`CT_EXEMPT_EXACT`·`CT_EXEMPT_PATTERN`）/ 415·500 回應 / `data.observe` 寫入結構 / 告警節流（`shouldAlert` cooldown）/ CORS header 套用 / OPTIONS·3xx 分支 / set-cookie 複製邏輯 → 立刻停手回 `PLAN_DRAFT`。** TS erase 後 runtime 行為必須不變（所有字串字面值 / 控制流 / 既有註解與 JSDoc byte-identical）。

**Coding 階段硬性邊界**：
- **允許（= §Spike 最終 diff 逐行）**：
  1. `api/_middleware.ts`：9 個參數型別標註（`tryDecodeAuthSub` / `routePattern` / `emit` / `shouldAlert` / `sendAlert`×2 / `levelFor`×2 / `onRequest`）+ 3 個 **local interface** 宣告（`RequestObserve` / `MiddlewareContext` / `AlertPayload`）+ 1 個 `const cf` 型別標註（避 `request.cf ?? {}` union-access）。
  2. `admin/_middleware.ts`：1 個 `onRequest` 參數 inline 標註 + 1 個 `getAll` 處 **type cast**（`as Headers & { getAll(name: string): string[] }`）+ 1 行 why-comment。
  3. `ai/_middleware.ts` / `auth/_middleware.ts`：各 1 個 `onRequest` 參數 inline 標註。
- **禁止**：改任何 log 欄位 / SQL（本群無 SQL）/ CORS header 值 / `CT_EXEMPT_*` / 415·500·204 回應字面值 / 控制流 / `data.observe` 寫入物件 / 告警字串 / cooldown 常數 / set-cookie 複製演算法、改 caller、改 tests、改 tsconfig / eslint / vitest、新增字面 `:any`、新增 suppression、新增 import、新增 runtime guard 或分支、**把 `getAll('set-cookie')` 改成 `getSetCookie()`**（= runtime 改動，超出 type-only scope，見 OD-2 → 改走獨立 backlog PR）、**顯式標 `onRequest` 的 return**（無 error 驅動）。

## Scout（對抗式驗證）

### exact errors（forced tsc @ `52c5f0b3`，total 895）

恰 **18** 個，全在 4 個目標檔（forced `tsc -b tsconfig.solution.json --force` 實測；無其他 error code 殘餘於這 4 檔）：

| 檔 | 數量 | 位置（line,col）/ 參數 | code |
|---|---|---|---|
| `api/_middleware.ts` | 9 | (32,27)`authHeader` (44,23)`path` (50,15)`line` (59,22)`pathPattern` (67,26)`webhookUrl` (67,38)`payload` (84,19)`status` (84,27)`hasError` (90,33)`context` | TS7006 |
| `api/admin/_middleware.ts` | 3 | (8,35)`request` (8,44)`env` (8,49)`next` | TS7031 |
| `api/ai/_middleware.ts` | 3 | (11,35)`request` (11,44)`env` (11,49)`next` | TS7031 |
| `api/auth/_middleware.ts` | 3 | (14,35)`request` (14,44)`env` (14,49)`next` | TS7031 |

`functions/**/_middleware.ts` 全盤點 = **恰這 4 檔**（glob 實證，無 root `functions/_middleware.ts`、無其他 hidden middleware）→ 本 PR 涵蓋 middleware noImplicitAny 全集。

### 依賴邊界（cascade 面逐一驗證）

- **零 importer**：`grep -rn "import.*_middleware|from.*_middleware" functions/` → **0 match**。Pages Functions `_middleware.ts` 的 `onRequest` 由 **Cloudflare runtime 直接呼叫**，非任何 source 檔 import；其他檔對 `_middleware` 的引用全為**註解**（如 `userinfo.ts:66` 「CORS preflight 由 _middleware.ts 處理」）。故改 `onRequest` 簽章 / 加 local interface **不可能 cascade 到 importer**。
- **零 test importer**：`*middleware*.test.*` glob → 0 檔；無任何 test 直接 import middleware。
- **module-local helper**：`api/_middleware.ts` 的 9 個 named function（`tryDecodeAuthSub` 等）全 module-local（未 export）→ 標註不外溢。3 個新 interface（`RequestObserve` / `MiddlewareContext` / `AlertPayload`）亦 module-local（未 export、`moduleDetection:"force"` 下不跨檔可見）→ 零 cascade。
- **caller 面 = runtime（非 TS）**：middleware 在每個 `/api/*` request 由 runtime 注入 `context`，TS 不檢查該注入點 → 標 `context: MiddlewareContext`（subset view）不對 runtime 形成約束。
- **D1 / Env / CfRequest 既有 ambient**：`Env`（`types/env.d.ts` `declare global`）、`CfRequest`（同檔 `type CfRequest = Request & { cf?: { country?: string } }`）皆既有 global，prior PR-2u/2v/2x 已用 + eslint globals 已註冊 → [[feedback_new_global_type_needs_eslint_globals]] 不觸發（spike 已併跑 eslint exit 0 防漏）。

### 型別選型（per-file；chain pattern + 既有 handler 慣例）

**通則**：本 repo handler 一律以 **inline object-literal type** 標 context（非 `EventContext`/`PagesFunction` — `@cloudflare/workers-types` 未安裝），既有 40+ handler 證實（`{ request: Request; env: Env; params: Record<string, string> }` 等）。CfRequest 為 opt-in alias，**只在實讀 `request.cf` 的參數標**（env.d.ts 註解：「不污染全 codebase 的 `request: Request`」）。

**`api/_middleware.ts`（9 標 + 3 interface + 1 const 標）**：
- `tryDecodeAuthSub(authHeader: string | null)` — 流入 = `request.headers.get('Authorization')`（`string | null`）。
- `routePattern(path: string)` / `shouldAlert(pathPattern: string)` — 流入皆 string。
- `emit(line: Record<string, unknown>)` — emit 僅 `JSON.stringify(line)`，shape-agnostic；2 個 call site 物件形狀不同 → `Record<string, unknown>` 比 union/interface 更 faithful（物件字面值對含 index signature 的 Record 無 excess-property check）。
- `sendAlert(webhookUrl: string, payload: AlertPayload)` — `AlertPayload` = local interface（`{ method; path; status; traceId; ms; errName: string|null; errMessage: string|null }`，對應 L173 call site）。
- `levelFor(status: number, hasError: boolean)`。
- `onRequest(context: MiddlewareContext)` — `MiddlewareContext` = local interface，`request: CfRequest`（**L144 讀 `request.cf`**，故須 CfRequest 非 plain Request）、`env: Env`、`next: () => Promise<Response>`、`data: { observe?: RequestObserve }`、`waitUntil: (promise: Promise<unknown>) => void`。`RequestObserve` = local interface（記錄既有 `data.observe` 隱性 shape，未改契約）。
- `const cf: { country?: string } = request.cf ?? {}`（L144）— 標型別避免 `{country?:string} | {}` union 的 `.country` 存取在 L159 報 TS2339（spike 證：不標則 cascade +1）。

**`admin` / `ai` / `auth` _middleware.ts（各 1 標）**：`onRequest({ request, env, next }: { request: Request; env: Env; next: () => Promise<Response> })`。三檔 `request` 皆**不讀 `.cf`** → 用 plain `Request`（非 CfRequest，遵 opt-in 紀律）。`next` 統一 `() => Promise<Response>`（middleware 僅 `await next()` 無參數，最小 faithful 型）。

**`admin` getAll cast（唯一非標註型變更）**：`admin/_middleware.ts` L23 用 `response.headers.getAll('set-cookie')`（CF runtime 對 set-cookie 的非標準擴充）。一旦 `next` 標型 → `response: Response` → `response.headers: Headers`（WebWorker lib），而該 lib `Headers` **無 `getAll`**（只有 `get/getSetCookie/has/set/append/delete/forEach`，已讀 lib.webworker.d.ts:4793-4831 確認）→ TS2339 cascade。type-only 解 = localized cast `(response.headers as Headers & { getAll(name: string): string[] })`（narrowing cast，無 `as unknown as` 雙重 cast、無遮蔽其他 error；CF runtime 確有 getAll，prod 現役該呼叫，cast 斷言為**真實 runtime 事實**非掩蓋 bug）。

### Open Decisions（prose 裁決，[[feedback_gate1_forks_prose_ruling]]）

- **OD-1：`next` 型別粒度** — 主方案 `next: () => Promise<Response>`（minimal，對應實際用法 `await next()` 無參數）vs 完整 Pages 簽章 `(input?: Request | string, init?: RequestInit) => Promise<Response>`。
  - **主方案（minimal，建議）**：4 檔 middleware 皆只 `await next()`，零參數呼叫；narrower 型 = deny-by-default（未來誤 `next(req)` 會編譯期擋）；最小 diff；spike 全綠零 cascade。
  - **完整簽章（defensible）**：對齊平台真實契約，但本群無 caller 用到參數形態 → 收益僅理論；+token。
  - **建議裁 minimal**；若 Arch 改裁完整簽章，以該裁決為新凍結基準（4 檔 `next` 同步改）。
  - **✅ 裁決（2026-06-16 ChatGPT Arch Gate @ `89a961cf`）：採 minimal `() => Promise<Response>`**。限制：不得引入泛型 Context helper / 共用抽象。OD-1 關閉。
- **OD-2：admin getAll 處理** — 主方案 localized cast（type-only、in-scope，見上）vs 改 runtime `getSetCookie()`（標準 API、語意等價，但**屬 runtime 改動**）。
  - **主方案（cast，建議）**：純型別、runtime byte-identical、最小 diff、in-scope（本 PR = type-only reduce）。
  - **`getSetCookie()` 變體**：是更乾淨的長期解（`getAll('set-cookie')` 為 CF 舊式非標準 API；`auth/_middleware.ts` L27-28 註解正是為避 getAll 相容性風險才改用 `new Response(body, response)` 原生繼承）—— **但改 method = runtime 行為改動，且 set-cookie 複製為 CORS 安全相關，須獨立 behavior-review**，超出本 type-only PR scope（[[feedback_prefer_plan_fidelity_over_small_waiver]]：不拿相鄰 runtime 改動替代 type-only scope）。
  - **建議裁 cast + 登記 backlog**：另開獨立小 PR 評估 `admin/_middleware.ts` 是否比照 ai/auth 改用 `new Response(body, response)` 原生 set-cookie 繼承、徹底消滅非標準 getAll（主動指出，[[feedback]] 基線 §主動指出）。
  - **✅ 裁決（同上 @ `89a961cf`）：採 erased cast**。限制：本 PR 禁改 `getSetCookie()` / `new Response(body, response)` / 任何 set-cookie 行為重構；統一改走獨立 backlog behavior-review PR（admin/ai/auth 三檔）。OD-2 關閉。
- **OD-3：1 PR vs 拆多 PR**（owner 點名要評估） — 主方案**單一 PR**（4 檔一刀）vs 拆（如 PR-A = `api/_middleware.ts` 9〔substantive：3 interface〕、PR-B = 3 個 CORS 檔 9〔trivial 同形〕）。
  - **主方案（單一 PR，建議）**：4 檔 = 同一邏輯單元（middleware 群，owner 框定為「第 11 棒」一刀）；**數學證明零跨檔 cascade**（彼此不 import、不共型）→ 拆 PR 無 integration de-risk 收益；3 個 CORS 檔為近同形 trivial 標註（各 1 行）；拆 = 2× 外部 gate 輪數審 provably-isolated 變更，token / 工序成本高、零風險降低。chain 前例 PR-2p 單 PR 清 3 個 read-only handler（6→0）。
  - **拆變體（defensible）**：若 Arch / Codex 認為 `api/_middleware.ts`（含 cast-adjacent 觀測核心 + 3 interface）blast radius 應與 3 個 trivial CORS 檔隔離審 → 可拆。代價 = +1 gate 週期。
  - **建議裁單一 PR**；若改裁拆，本 doc frozen diff 按檔拆成對應子 PR、各自走 gate。
  - **✅ 裁決（同上 @ `89a961cf`）：採單一 PR**。限制：Code Gate 必須重驗 exact removed-set = 18、新增 TS error = 0、4 檔互不 import / 無共用型別 / 無 cascade / 無新 shared abstraction。OD-3 關閉。

**考慮過、否決**：
- **共用 middleware context 型別**（抽 `MiddlewareContext` 給 4 檔共用）：命中 §抽象判斷「≥3 處重複」，但 `moduleDetection:"force"` 下跨檔型別須走 `.d.ts` ambient 或 import → 新 surface 大於 chain「最小 diff / inline」慣例；3 個 CORS 檔的 context 是 trivial 3-field、與 api/ 的 5-field（含 nested observe + waitUntil + CfRequest）形狀不同，強抽會犧牲可讀性。否決，維持 inline（api/ 因複雜度用 local interface、3 CORS 用 inline）。
- **`data: Record<string, unknown>`（忠於 Pages「data 是 mutable bag」）**：會讓 `data.observe?.userId` 變 unknown-access（TS2571，與 strict flag 無關）→ in-file cascade。改用窄 shape `{ observe?: RequestObserve }`（本檔只用 observe）；如需兼顧 bag，`{ observe?: RequestObserve; [k: string]: unknown }` 亦可（explicit prop 優先於 index）—— 但本檔不讀其他 data key，窄 shape 已足、更小。否決 bag 型，採窄 shape。
- **`request: Request`（api/_middleware.ts）**：L144 讀 `request.cf` → plain Request 無 `.cf` → TS2339 cascade。必用 CfRequest。否決。
- **顯式標 `onRequest` return（`Promise<Response>`）**：無 error 驅動；chain 紀律「無 error 驅動項不動」。否決。

## Spike 實證（A1，2026-06-16，已 revert）

**程序**：套 4 檔候選標註（含 admin why-comment）→ `tsc -b tsconfig.solution.json --force`（全重建）→ sort-diff（error TS 行 `comm`）→ `tsc -b tsconfig.tests.json --force` → 4 檔 eslint → `git diff` 凍結 + `git diff --check` → revert → 驗 clean。（tsc 一律走 `node ./node_modules/typescript/bin/tsc`；`npx tsc` 在本機誤解析冒牌包，必用 local bin。）

**主方案單輪達標（零修正輪）**：

| 驗收條件 | 結果 |
|---|---|
| 4 檔 errors 18 → 0 | ✅ forced tsc：4 檔 0 殘留 |
| total errorCount 895 → 877（恰 −18） | ✅ forced tsc `grep -c 'error TS'` = 877 |
| errorFiles 104 → 100 / cleanFiles 230 → 234 | ✅ 4 檔全由 error→clean（sourceFilesTotal 334 不變；100+234=334） |
| zero cascade（全 solution graph：functions + scripts + tests + browser leaf） | ✅ sort-diff（`comm -13`）：**新增 0 行**；removed-set = 恰 18 行（即 4 檔的 18 個 TS7006/TS7031，逐行對上）；`tsc -b tsconfig.tests.json --force` **exit 0 / 0 error TS** |
| admin getAll cast 不引 TS2352（cast 合法） | ✅ forced tsc 0 殘留於 admin（`Headers & {getAll}` narrowing cast 合法、無需 `as unknown as`） |
| request.cf 標型不引新 TS2339 | ✅ `const cf: { country?: string }` 後 L159 `cf.country` 0 error |
| lint | ✅ `eslint` 4 檔 exit 0（`Env`/`CfRequest`/`Headers`/`Request`/`Response` 既有 global、local interface 無 no-undef） |
| diff 面 | ✅ `git diff --stat` = **4 檔 +41/−12**；`git diff --check` exit 0（source 無 trailing whitespace） |
| working tree revert clean | ✅ revert 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`（untracked scratch，與本 PR 無關）、HEAD `52c5f0b3`（本 doc 凍結 diff 為 SoT） |

**Spike 最終 diff（= coding 階段唯一允許落地的 source diff，4 檔 +41/−12；OD-1 採 minimal `next`、OD-2 採 cast）**：

```diff
diff --git a/functions/api/_middleware.ts b/functions/api/_middleware.ts
@@ -16,6 +16,34 @@
 import { getCorsHeaders } from '../utils/cors'
 import { refreshClientsCache } from '../utils/oauth-clients'

+// 下游 handler 在 data.observe 上掛的觀測 metadata（handler 可覆寫 userId/extras）
+interface RequestObserve {
+  traceId: string
+  userId: string | null
+  extras: Record<string, unknown> | null
+}
+
+// Pages Functions EventContext 的最小型別（@cloudflare/workers-types 未安裝，
+// 比照既有 handler 慣例以 inline shape 標註，僅涵蓋本檔實讀的欄位）。
+interface MiddlewareContext {
+  request: CfRequest                          // L144 讀 request.cf
+  env: Env
+  next: () => Promise<Response>
+  data: { observe?: RequestObserve }
+  waitUntil: (promise: Promise<unknown>) => void
+}
+
+// 5xx Discord 告警的 payload shape
+interface AlertPayload {
+  method: string
+  path: string
+  status: number
+  traceId: string
+  ms: number
+  errName: string | null
+  errMessage: string | null
+}
+
 const CT_EXEMPT_EXACT   = new Set(['/api/auth/logout'])
 // 第三方 webhook 多用 application/x-www-form-urlencoded（ECPay、PSP 等）；
 // /api/webhooks/* 全段豁免 Content-Type 守門，由各 vendor adapter 自行解析+驗章。
@@ -29,7 +57,7 @@ function genTraceId() {
 // 從 Authorization: Bearer <jwt> 取出 payload.sub（不驗證簽章，只給 log 標籤用）
 // — handler 仍會用 requireAuth 做真實驗證；status 4xx 表示這個 sub 是「自稱」，
 //   2xx/3xx 表示已被驗證通過。
-function tryDecodeAuthSub(authHeader) {
+function tryDecodeAuthSub(authHeader: string | null) {
   if (!authHeader || !authHeader.startsWith('Bearer ')) return null
   const parts = authHeader.slice(7).trim().split('.')
   if (parts.length < 2) return null
@@ -41,13 +69,13 @@ function tryDecodeAuthSub(authHeader) {
 }

 // 把 path 中的數字 / UUID 動態段替換為 :id / :uuid，避免高基數爆炸
-function routePattern(path) {
+function routePattern(path: string) {
   return path
     .replace(/\/\d+(?=\/|$)/g, '/:id')
     .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid')
 }

-function emit(line) {
+function emit(line: Record<string, unknown>) {
   try { console.log(JSON.stringify(line)) } catch { /* never throw from logger */ }
 }

@@ -56,7 +84,7 @@ function emit(line) {
 const ALERT_COOLDOWN_MS = 60_000
 const alertLastSentAt = new Map()

-function shouldAlert(pathPattern) {
+function shouldAlert(pathPattern: string) {
   const now = Date.now()
   const last = alertLastSentAt.get(pathPattern) ?? 0
   if (now - last < ALERT_COOLDOWN_MS) return false
@@ -64,7 +92,7 @@ function shouldAlert(pathPattern) {
   return true
 }

-async function sendAlert(webhookUrl, payload) {
+async function sendAlert(webhookUrl: string, payload: AlertPayload) {
   try {
     await fetch(webhookUrl, {
       method: 'POST',
@@ -81,13 +109,13 @@ async function sendAlert(webhookUrl, payload) {
   } catch { /* never throw from alerter */ }
 }

-function levelFor(status, hasError) {
+function levelFor(status: number, hasError: boolean) {
   if (hasError || status >= 500) return 'error'
   if (status >= 400) return 'warn'
   return 'info'
 }

-export async function onRequest(context) {
+export async function onRequest(context: MiddlewareContext) {
   const { request, env, next, data, waitUntil } = context
   const url     = new URL(request.url)
   const path    = url.pathname
@@ -141,7 +169,7 @@ export async function onRequest(context) {
   }

   const ms     = Date.now() - start
-  const cf     = request.cf ?? {}
+  const cf: { country?: string } = request.cf ?? {}
   const status = caught ? 500 : (response?.status ?? 0)

   const pathPattern = routePattern(path)
diff --git a/functions/api/admin/_middleware.ts b/functions/api/admin/_middleware.ts
@@ -5,7 +5,7 @@

 import { getCorsHeaders } from '../../utils/cors'

-export async function onRequest({ request, env, next }) {
+export async function onRequest({ request, env, next }: { request: Request; env: Env; next: () => Promise<Response> }) {
   const corsHeaders = getCorsHeaders(request, env)

   if (request.method === 'OPTIONS') {
@@ -20,7 +20,8 @@ export async function onRequest({ request, env, next }) {
   for (const [k, v] of response.headers) {
     if (k.toLowerCase() !== 'set-cookie') newHeaders.append(k, v)
   }
-  for (const c of response.headers.getAll('set-cookie')) newHeaders.append('set-cookie', c)
+  // CF runtime Headers 有 getAll（WebWorker lib 型別未含此非標準擴充）；此 cast 僅補型別、runtime 不變
+  for (const c of (response.headers as Headers & { getAll(name: string): string[] }).getAll('set-cookie')) newHeaders.append('set-cookie', c)
   for (const [k, v] of Object.entries(corsHeaders) as [string, string][]) newHeaders.set(k, v)

   return new Response(response.body, {
diff --git a/functions/api/ai/_middleware.ts b/functions/api/ai/_middleware.ts
@@ -8,7 +8,7 @@

 import { getCorsHeaders } from '../../utils/cors'

-export async function onRequest({ request, env, next }) {
+export async function onRequest({ request, env, next }: { request: Request; env: Env; next: () => Promise<Response> }) {
   const corsHeaders = getCorsHeaders(request, env)

   if (request.method === 'OPTIONS') {
diff --git a/functions/api/auth/_middleware.ts b/functions/api/auth/_middleware.ts
@@ -11,7 +11,7 @@

 import { getCorsHeaders } from '../../utils/cors'

-export async function onRequest({ request, env, next }) {
+export async function onRequest({ request, env, next }: { request: Request; env: Env; next: () => Promise<Response> }) {
   // 全 /api/auth/* 都可能帶 cookie / Authorization，統一加 Allow-Credentials: true
   // （瀏覽器只在客戶端 credentials:'include' 時才送，所以這裡放寬不會自動帶憑證）
   const corsHeaders = getCorsHeaders(request, env, { credentials: true })
```

（所有 log 欄位 / CORS header / `CT_EXEMPT_*` / 415·500·204 字面值 / 控制流 / `data.observe` 寫入物件 / 告警字串 / cooldown / set-cookie 複製演算法 / 既有註解與 JSDoc **byte-identical**；新增 = 13 個參數·const 型別標註 + 3 個 local interface + 1 個 type cast + 1 行 why-comment；TS erase 後 runtime 行為不變。）

## 預期 ratchet

- clean main `52c5f0b3` `--report` 現況：errorCount **895** / errorFiles **104** / cleanFiles **230** / sourceFilesTotal 334（canonical `npm run typecheck:ratchet:report` 實測）。
- 本 PR 後 current state：errorCount **895 → 877**（−18）、errorFiles **104 → 100**（−4）、cleanFiles **230 → 234**（+4）、sourceFilesTotal 334 不變（spike 實測值）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 877」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 13 個型別標註 + 3 個 local interface + 1 個 type cast + 1 行 comment，**TS erase 後 runtime 行為不變**（esbuild type-strip，interface/cast/annotation 全消；admin 的 cast erase 後 = 原 `response.headers.getAll('set-cookie')` byte-identical runtime 呼叫）。
- middleware 在每個 `/api/*` request 由 runtime 注入執行 → 全量 integration suite 隱性覆蓋（無 middleware 專屬 unit）；coding 階段跑全量 `test:int` 確認（見 §驗證計劃）。
- rollback：單一 squash revert 即完整回退（無 ambient 變更、無 migration、無 deploy 行為差）；revert 後 ratchet 自然回 895。

## 測試影響面（覆蓋誠實）

- **零測試檔改動**（tests-leaf forced exit 0 實證）；無 middleware 專屬 unit/integration test（glob 0 檔）。
- **間接覆蓋（不宣稱為 direct）**：4 檔 middleware 在**每個 `/api/*` request** 注入 → CI 全量 integration（login / oauth / webauthn / elevation / payment / tenant / admin / ai 等 suite）每例皆隱性經過觀測注入 + CORS 套用 + Content-Type 守門。
- **runtime-invariance 論證（非靠新 test）**：型別標註對 esbuild bundle 為 no-op（type-strip）→ 「標註版」與「原版」runtime bundle 對 admin 以外檔 byte-identical、對 admin 僅差一個 type-erased cast（runtime 呼叫不變）→ integration 結果 construction-invariant。coding 階段仍跑全量 `test:int` 作 belt-and-suspenders。
- **strict-rung 邊界（不在本 PR scope）**：`MiddlewareContext` 多處 nullable（`request.cf?` / `data.observe?` / `response?.status`）本檔已用 `?.`/`??` null-safe；未來 functions leaf 開 `strict:true` 預期零本檔新 strictNull 債。登記供 strict 棒對帳，與本 noImplicitAny 棒無關。

## 驗證計劃（coding 階段，CODING_ALLOWED 後）

> 本 PR 無 ambient .d.ts 變更；沿 chain SOP 所有 tsc/ratchet 量測一律 `rm -rf .tscache` 全重建。reduce-PR local-verify 陷阱（[[feedback_ts_ratchet_discipline]]）：branch 尚無 commit 時 tip==origin/main → `getBaseRef` 落 `HEAD~1`（開 flag 前 commit）→ false-RED。**驗法**：commit 後跑 plain ratchet（base 自動=origin/main `52c5f0b3`）；或 commit 前 PowerShell `$env:RATCHET_BASE_REF='52c5f0b3'; npm run typecheck:ratchet`。**不帶** `RATCHET_ALLOW_BASELINE_RAISE`（error-reducing reduce PR、正常下降；非 open-strict override PR，無需 governance workflow）。

- `$env:RATCHET_BASE_REF='52c5f0b3'; npm run typecheck:ratchet` green（895→877 / 104→100 / 230→234）。
- `npm run lint` green（全量 `eslint functions tests` + compat-date + workflows）。
- `npm run build:functions` green（type-only、esbuild type-strip，bundle 無型別殘留）。
- filtered forced tsc：4 檔 0 殘留、sort-diff 重放（移除 18 行、零新增）；`tsc -b tsconfig.tests.json --force` exit 0。
- **`npm run test:cov` green**（CI `test` 為 fail-fast 單 job、先跑 cov；cov 紅會 skip test:int/build/audit → 必先綠，[[feedback_pre_merge_gate_checklist_match_ci]]；**Codex Plan Gate note 點名須顯式列**）。
- **全量 `npm run test:int` green**（middleware 全站注入、無 targeted lane → 跑全量；接在 test:cov 之後，對齊 CI 順序）。
- baseline file 不得 `--update`（天花板 1119/175 保持）。
- **硬驗收**：source diff 與本 doc §Spike 最終 diff **逐行一致**（4 檔，不得多檔；OD-1 minimal `next` / OD-2 cast 為凍結版；若 Arch 改裁則以該裁決為新凍結基準）；超出 = scope creep = Gate fail。
- **Arch Gate approved-scope 對帳基準（Codex / code stage 逐項複核）**：
  1. 18 errors → 0（不多不少；ratchet 895→877）
  2. type-only（TS erase 後 runtime 行為不變、所有字面值 byte-identical）
  3. 僅 4 個 production 檔（無 ambient / config / tests 改動）
  4. OD-1/2/3 裁決落實（minimal next / cast / 單一 PR，或 Arch 改裁版）
  5. 全檔無字面 `:any` / 無 suppression / 無新 import / 無新 runtime 分支；admin cast 為唯一 `as`、且為 `Headers & {getAll}` narrowing（非 `as unknown as`）
- merge 後 smoke：credential-free = home / login 200（chain 預設）；middleware 行為以全量 integration + CI 為準。

## 流程定位

- Dual Gate Workflow v3：`SPEC_APPROVED`（owner 開棒）✅ → A1 spike ✅ → `PLAN_SELF_REVIEW_CLEAN`（單 agent 對抗式）✅ → 本 doc commit `89a961cf` ✅ → **`CHATGPT_ARCH_APPROVED`**（@ `89a961cf`，OD-1/2/3 全裁、impl L1 / review care L2）✅ → **`CODEX_PLAN_APPROVED`**（@ `5090bf7e`，無 blocker、test:cov note 已補）✅ → **`CODING_ALLOWED`**（owner）✅ → coding（frozen byte-identical replay）✅ → 機械 gates 全綠 ✅ → **`CODE_SELF_REVIEW_CLEAN`**（@ `95adc3fa`）✅ → **`CODEX_CODE_APPROVED`**（@ `95adc3fa`，0 blocking、`// L144` nit 不阻塞）✅ → **owner 明示點頭**〔← 當前，待 owner〕→ squash-merge（L1：不走 ChatGPT faithfulness 複核、不產生該 state）→ `MERGED_MAIN`。
- merge 後監看 CI+Deploy；memory 收尾 receipt。
- **下一刀（owner 排序，開工前再確認）**：`cors.ts`（security-boundary 單獨 PR，~20 caller，本 4 檔的 `getCorsHeaders` 上游）。cors.ts 後 functions leaf noImplicitAny 清零 → 開 `strict:true`（~140 strictNull/catch）→ scripts → tests → browser leaf。
