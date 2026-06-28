# Stage 7 reduce PR-2cw — `admin/payments/intents.ts` noImplicitAny（**payments 域第七棒 / single-file（非 Path A）/ minimal 變體（無 row cast）**；type-only、review care **L2**）

**目標**：admin payments 對帳列表 + CSV PII export endpoint 的 **9 個 noImplicitAny error → 0**，**純 type-only**。env typing 不掀 `Env` 缺口（檔內 `env` 存取僅 `env.chiyigo_db`〔已宣告〕+ 整包 forward util）→ scope ＝ **single-file（1 source 檔、無 env.d.ts 變更、非 Path A）**。

| 檔 | 現狀 err | 編輯點 | 變更性質 |
|---|---|---|---|
| `functions/api/admin/payments/intents.ts` | 9（4×TS7031 handler ctx + 1×TS7053 `countByStatus={}` index + 4×TS7006 CSV helper param）| **5 行改**（L29 / L33 / L170 / L190 / L195）| handler ctx annotation（Convention A）+ `countByStatus` index-sig 型別 + CSV helper param 型別 |

本 PR ＝ payments 大熱區續清第七棒（接 PR-2cq #115 `[id].ts`、PR-2cr #116 `auth/payments/intents.ts` list、PR-2cs #117 `payment-return/ecpay.ts`、PR-2ct #118 `mock.ts`、PR-2cu #119 `checkout/ecpay.ts` Path A、PR-2cv #120 admin-ops 三檔 batch）。本檔特性：**admin 對帳 read + CSV PII export endpoint**（無金流寫入路徑；CSV 路徑帶 step-up `elevated:payment` + 整批 PII export + critical audit）→ review care **L2**。完整 Dual Gate v3.1 四道外部審查、不降級。

---

## ⚠️ 為何 minimal（不加 row cast）— PR-2cv MainRow 對照差異（owner 指定必寫，防 faithfulness gate 誤判）

**owner SPEC_APPROVED（2026-06-28，1/1/1）**：選 intents.ts + **minimal aggRows（不加 AggRow cast）** + `cors: Record<string, string>`。

本 PR 與剛 SHIPPED 的 **PR-2cv `aggregate.ts`（同目錄、同 batch）刻意不一致**：aggregate.ts 用 `MainRow` cast（`(main.results ?? []) as MainRow[]`），本檔的對帳迴圈 `aggRows`**不加任何 row cast**。此差異**非漂移、非 scope 不足**，而是**結構性根因不同**，spike 雙變體實證皆全清：

| 維度 | PR-2cv `aggregate.ts`（需 MainRow cast） | 本 PR `intents.ts`（不需 cast） |
|---|---|---|
| 對帳迴圈形式 | **`.map(r => ({...}))`**（L95） | **`for (const r of (aggRows.results ?? []))`**（L172） |
| `r` 的 noImplicitAny 狀態 | `.map` callback param `r` **無 contextual type → TS7006**（D1 `.all()` 解為 any → `.results` any → callback param 觸 implicit-any）| `for...of` binding `r` **靜默 any、不觸 TS7006**（for-of 不要求 contextual typing；over any-iterable 的 `const r` 即 any，無 implicit-any error）|
| 解 TS7006 的手段 | **必須給 `r` 一個型別** → cast `as MainRow[]` 讓 `.map` callback 有 element type（且 `r.bucket` 餵 `Map<string,RefundRow>.get` 需 string，`Record<string,unknown>` 會掀 TS2345）| **不需給 `r` 型別**（本來就沒 TS7006）|
| L173 真正的 error | （aggregate 無此行）| **TS7053**：`countByStatus[r.status]` 其中 `countByStatus = {}`（**空物件型別、無 index signature**）→ 用任意 key 索引即 implicit-any。**根因是 `{}` 缺 index sig、非 `r` 的型別** |
| 修法 | handler ctx + MainRow cast + callback | handler ctx + **`countByStatus: Record<string, number>`**（補 index sig；`r` 留 any） |

**核心機制（[[feedback_d1database_resolves_any_no_workers_types]]）**：本 repo 未裝 `@cloudflare/workers-types` → `D1Database` 解為 `any` → `env.chiyigo_db.prepare(...).bind(...).all()` 為 any → `aggRows.results` any → `r: any`、`r.status: any`、`r.cnt: any`。給 `countByStatus` 補上 `Record<string, number>`（有 string index signature）後，用 `any` key 索引、賦 `any` 值皆合法 → TS7053 消、**不冒 TS2538/TS2345**（`r` 是 any 不是 unknown）。

**spike 雙變體實證（皆全清、皆 byte-identical）**：
- **minimal（採用）**：僅 `countByStatus: Record<string, number>`，`for...of` 與 `r` 不動 → forced tsc 770→**761（−9）**、intents 0 殘留、REMOVED=9/ADDED=0。
- **AggRow 變體（否決，僅作對照）**：加 `type AggRow` + `as AggRow[]` → **同樣** 770→761、0 殘留、0 cascade。**兩者都過，但 AggRow 是「可選窄化」非「修錯必需」**（for-of 沒有 TS7006 強制它），故依 scope 紀律 + [[feedback_d1database_resolves_any_no_workers_types]]「D1 row 要窄化才顯式標」採 minimal。

**結論**：intents.ts 不加 row cast 與 aggregate.ts 加 MainRow，**由 `for...of` vs `.map()` 的結構差異正當化**，非任意不一致。faithfulness gate 若質疑「為何 PR-2cv 有 MainRow、此處沒有」→ 即本段。

---

## ⚠️ 為何 single-file（非 Path A）— spike 實證

intents.ts 檔內 `env` 存取**僅 `env.chiyigo_db`**（D1 binding，`types/env.d.ts` 已宣告）+ 整包 forward 給 `getCorsHeaders`/`requireStepUp`/`requireAnyScope`/`checkRateLimit`/`recordRateLimit`/`safeUserAudit`（`effectiveScopesFromJwt` 取 `user` 非 `env`）。**無任何 exotic / 未宣告 env key 存取** → 標 `env: Env` **不掀 TS2339**（與 PR-2cu `checkout/ecpay.ts` 存取未宣告 `ECPAY_*_URL`、被迫 Path A 不同；與 PR-2cv 三檔同為 single-file）。

- spike 實測（套 5 source annotation，**不**改 env.d.ts）：forced full-solution `tsc -b tsconfig.solution.json --force` total **770 → 761（恰 −9）**、intents 殘留 **0 error**、全 leaf sort-diff **REMOVED=9 / ADDED=0**（零 cascade，含 payment 域與全樹）。
- → **無 Env 缺口、無需 Path A、source 改動 = 1 檔**。scout 必跑 env:Env spike 才能判（不靠讀碼推斷；[[feedback_tsc_forced_solution_dual_leaf_error_count]] 同源教訓）→ 已跑、判定 single-file。

## base 錨點（current main，非 stale）

- **base ＝ current main `c05d44e982a4e820b7c84676435f081183b8e15c`**（`git rev-parse HEAD` 實證、`origin/main == HEAD == branch tip` 一致、working tree clean〔僅 `?? CLEANUP_PLAN.md` untracked〕）。
- 此即 PR-2cv #120 `c05d44e9`（admin-ops 三檔 batch）squash commit；owner prompt base 與實查一致、**無 stale 修正**。
- branch `refactor/stage7-pr2cw-admin-payments-intents-noimplicitany`（自 clean main `c05d44e9` 開、未 push）。
- base source blob：intents.ts `2ce708e880fb98bfa9a46ce615406d3a933e5f25`；plan-only commit 後 `HEAD:src` blob 仍須 == base（source 零落地，[[feedback_gate_packet_replay_anchor_head_vs_base]]）。

## annotation 形式裁定（沿 Convention A function-declaration + inline param type）

唯一允許落地的 source diff（共 5 行改、0 增）：

```ts
export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {  // L29
export async function onRequestGet({ request, env }: { request: Request; env: Env }) {       // L33
  const countByStatus: Record<string, number> = {}                                           // L170
function csvCell(v: unknown) {                                                                // L190
function csvResponse(rows: Record<string, unknown>[], cors: Record<string, string>, baseName: string) {  // L195
```

- **正式 frozen form ＝ function-declaration ＋ inline param type / inline 變數型別**（沿 PR-2cp..2cv 既定）；**禁** arrow const、named ctx type alias、拆多行、加 return type。
- handler ctx ＝ **full Convention A `{ request: Request; env: Env }`**（兩 handler 皆 destructure `{ request, env }`、實讀 `env.chiyigo_db` + 整包 forward env → 用 full `Env`，**非** `Pick`、**非** `CfRequest`〔無 `.cf` 存取〕）。
- `countByStatus` ＝ **`Record<string, number>`**（補 index signature 消 L173 TS7053；語意 = status 字串 → 計數；`r` **留 any、不加 row cast**，見 §MainRow 對照）。
- CSV helper ＝ **`csvCell(v: unknown)`** + **`csvResponse(rows: Record<string, unknown>[], cors: Record<string, string>, baseName: string)`**（皆 spike-clean；`cors: Record<string, string>` 而非 `ReturnType<typeof getCorsHeaders>`，見 §OD ruling）。

## OD ruling（型別選型，對抗式驗證 + owner 拍板 1/1/1）

| 決策點 | 裁示 | 理由 |
|---|---|---|
| handler `request`（兩處）| **`Request`（plain）** | 僅 `getCorsHeaders(request,…)` + `new URL(request.url)` + 傳 `request` 給 `requireStepUp`/`requireAnyScope`/`safeUserAudit`；**無 `.cf` 存取** → 非 `CfRequest` |
| handler `env`（兩處）| **`Env`（full）** | 兩 handler 實讀 `env.chiyigo_db` 並**整包 forward** 給 util → 需 full Env；**Pick 否決**（forward 面要 full、窄 Pick 會 cascade）|
| L170 `countByStatus`（OD-A）| **`Record<string, number>`** | L173 TS7053 唯一根因 = `countByStatus = {}` 無 index signature；補 `Record<string, number>` 即解。語意 = `count_by_status`（status 字串 → 計數）|
| **aggRows `r`（L172 `for...of`）= minimal、不加 cast（OD-B、owner 1）** | **不動 `for (const r of (aggRows.results ?? []))`** | `D1Database`→any → `r: any`；`for...of` binding 不觸 TS7006（不像 `.map` callback param）→ **無 error 強制給 `r` 型別**。補 `countByStatus` 後 `r.status:any` 索引 `Record<string,number>` 合法、不冒 TS2538/TS2345。**AggRow cast 是可選窄化非必需** → 依 scope 紀律採 minimal（見 §MainRow 對照）|
| `csvResponse` `cors`（OD-C、owner 1）| **`Record<string, string>`** | spike 證 `getCorsHeaders` 早 `return {}` 對 `Record<string,string>` assignable、call site L153 **零 TS2345**；`ReturnType<typeof getCorsHeaders>`（=`{} \| Record<string,string>`）**否決**（多耦合 getCorsHeaders 型別、冗長、無實益）|
| `csvResponse` `rows` | **`Record<string, unknown>[]`** | 內部 `r[h]`（h: string）→ `unknown` → 餵 `csvCell(v: unknown)`，internally consistent；沿 PR-2cd/2cc `Record<string,unknown>` 投影慣例；`any[]` 否決（用 any）|
| `csvCell` `v` | **`unknown`** | `v == null` guard + `String(v)` 皆對 unknown 合法；最小、明確 |
| `AggRow` cast / `Record<string,unknown>` on `r`（**否決**）| **禁** | 非修錯必需（for-of 無 TS7006）；加了是 scope creep（除非 gate 產出具體 TS error/blocker，owner lock）|
| `CfRequest`（**否決**）| **禁** | 無 `.cf` 存取 |
| `Pick<Env,…>`（**否決**）| **禁** | env 整包 forward、需 full Env |
| arrow const / return type / JSDoc / 改 SQL·audit·CSV 欄位·step-up·rate-limit（**否決**）| **不改** | 沿 lock，只處理 noImplicitAny 9 錯 |

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（mechanical type-only、5 改、0 增）/ review care **L2**（**admin 對帳 read + CSV PII export endpoint**：CSV 路徑帶 step-up `elevated:payment` + `effectiveScopesFromJwt` 二次 scope 驗 + 整批 PII export〔含 metadata 排除但 row 仍含 user_id/vendor_intent_id/amount 等〕 + `admin.payments.intents.exported` **critical** audit；JSON 路徑帶 admin:payments fine scope read + `admin.payments.intents.read` info audit。**無金流寫入、無 redirect、純讀 + type-only byte-identical 不改 PII gate / audit / rate-limit 行為**）。**完整 Dual Gate v3.1 四道外部審查、不降級**。
- **self-review ＝ multi-agent workflow（payments 熱區、不降單 agent；[[feedback_self_review_form_not_downgradable_by_spike]]）**。rubric **收斂 scope-fidelity / runtime-security / evidence-integrity 三維、不擴全域**（不碰任何排除檔、不碰 runtime 紅線、不碰 `CLEANUP_PLAN.md`）。finder/verifier 用 **`readonly-reviewer` agent**（無 model pin → 繼承 session model Opus 4.8，[[feedback_selfreview_workflow_model_inheritance]]；options `__proto__:null` no-haiku 機械保證；**非機械安全邊界、持 Bash、read-only 屬 best-effort**）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner 2026-06-28「1/1/1」：候選＝intents.ts（payments 第七棒）；OD ＝ handler `{request:Request;env:Env}` + L170 `countByStatus: Record<string,number>` + **minimal aggRows（不加 AggRow cast）** + `cors: Record<string,string>`；single-file（spike 證無 Env 缺口、非 Path A）；self-review ＝ multi-agent workflow（不降）；**禁** `CfRequest`/`Pick`/arrow const/return type/`AggRow` cast/`ReturnType`/碰排除檔/改 CSV·audit·scope·rate-limit 行為。
  - ✅ Claude scout（read-only @ `c05d44e9`）→ error set（9 錯：L29/L33 4×TS7031 + L173 TS7053 + L190/L195 4×TS7006）+ caller cascade（兩 handler ＝ Pages entrypoint；direct importer ＝ `admin-payments.test.ts:16` `onRequestGet as listHandler` direct-literal call；csvCell/csvResponse module-local 未 export 無跨檔）+ env 存取掃描（僅 `env.chiyigo_db`，無缺口）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 revert clean、blob 回 base `2ce708e8`；雙變體 minimal + AggRow 皆驗）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent self-review = 3 parallel `readonly-reviewer` agent〔Agent tool、繼承 session model Opus 4.8〕各攻一維 scope-fidelity / runtime-security / evidence-integrity；runtime-security **0** / evidence-integrity **0** findings、scope-fidelity **2** findings〔Tier2 L-1「三檔」殘留→修「本檔」、Tier3 §MainRow `.map` 行號 L94→L95〕主線裁決修正 → 一輪 0 新發現；見 §Gate 進程紀錄）
  - ⏳ `CHATGPT_ARCH_APPROVED`（① 維度 B、**待送**）→ ⏳ `CODEX_PLAN_APPROVED`（② 維度 C、**待送**）→ ⏳ owner `CODING_ALLOWED`（**待明示**）
  - ⏳ Code 階段（`CODING_ALLOWED` 後 source commit → full replay @ committed、不沿用 spike）→ ⏳ `CODE_SELF_REVIEW_CLEAN`（維度 A workflow）→ ⏳ `CODEX_CODE_APPROVED`（③）→ ⏳ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④）
  - ⏳ **merge-front 7 gates** → ⏳ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-28 Claude **scout（read-only @ `c05d44e9`）** → 9 錯（L29/L33 4×TS7031 handler ctx、L173 TS7053〔`countByStatus={}` index〕、L190 TS7006〔`csvCell(v)`〕、L195 3×TS7006〔`csvResponse(rows,cors,baseName)`〕）+ env 存取掃描（僅 `env.chiyigo_db`、無未宣告 key → 無 Path A 風險）+ caller cascade（兩 handler Pages entry；`admin-payments.test.ts:16` direct import `onRequestGet as listHandler` + L85/99/105/125/141/155/182 direct-literal call；csvCell/csvResponse module-local 未 export）。
- 2026-06-28 Claude **non-commit full-solution spike**（已 revert clean）→ single-file（1 source、不改 env.d.ts）證足：total **770→761**、intents 0 殘留、sort-diff **REMOVED=9 / ADDED=0**、emit **byte-identical**（7019B sha `c80b2826159e477f` 兩端）。**雙變體驗證**：minimal（採用）與 AggRow（對照）皆全清、皆 byte-identical → 確認 AggRow 非必需、採 minimal。frozen blob：intents.ts `2ce708e8→910d2688`。
- 2026-06-28 **plan self-review = multi-agent self-review（維度 A、3 parallel `readonly-reviewer` agent〔Agent tool、繼承 session model `claude-opus-4-8`〕各攻一維 scope-fidelity / runtime-security / evidence-integrity）→ `PLAN_SELF_REVIEW_CLEAN`**：**runtime-security 0 findings**（5 處全 type-erase、安全紅線〔step-up/scope gate/PII audit/rate-limit/SQL/CSV escape〕零重疊、byte-identical 健全）、**evidence-integrity 0 findings**（獨立重現 base forced tsc **770** + intents **9 錯** exact loc、base emit **7019B** sha `c80b2826159e477f`、ratchet **770/72/262/334**、base blob `2ce708e8`；且在 /tmp 構造 patched.ts 驗 blob `910d2688` + patched emit 7019B IDENTICAL、未碰 tracked 檔）、**scope-fidelity 2 findings**：[Tier2] L-1 Scope lock 殘留 PR-2cv「三檔」字樣（與同格「1 source 檔 / cleanFiles +1」矛盾）、[Tier3] §MainRow 對照表 aggregate.ts `.map` 行號 L94（實為 L95）。**主線獨立裁決（v3.1 §5、非採 raw）**：grep 確認「三檔」其餘三處（L9/L39/L47）皆正確指 PR-2cv batch、唯 L-1 self-ref 錯 → 修「三檔」→「本檔」；`sed -n '93,95p' aggregate.ts` 證 L94=`type MainRow`、L95=`.map` → 修 L94→L95 → round-2 grep 0 新矛盾 → 一輪 0 新發現。**review agents 未污染 git**（主線驗：HEAD `c05d44e9`〔plan commit 前〕、intents blob 未動 `2ce708e8`、staged 空、`git diff base..working -- functions/ types/` 空；agents 只寫 /tmp）。
- ⏳（後續 dated 收錄：plan doc commit → 中文報告 6 欄 → ChatGPT Arch packet → 外部 ①②）

## owner 鎖定表（2026-06-28；single-file minimal 版）

| Lock | 內容 |
|---|---|
| L-1 Scope | **1 source 檔** `intents.ts`（4 ctx-err + 1 index-err + 4 CSV-helper-err = 9 錯，5 行改 / 0 增）。本檔目標 0 noImplicitAny、cleanFiles +1。**無 env.d.ts 變更（single-file，spike 證無 Env 缺口）** |
| L-2 Runtime hot-zone lock | **不改** 任何 SQL query / `WHERE`·`wherePlain` / `ISO_RE` 驗證 / scope gate（`requireAnyScope`/`requireStepUp`/`effectiveScopesFromJwt`）/ step-up action（`export_payment_intents`）/ PII read·export audit（event_type·severity·payload·filters）/ rate-limit（`checkRateLimit`/`recordRateLimit`/admin_read 60/min）/ query param parse（`page`/`limit`/`user_id`/`status`/`vendor`/`from`/`to`/`include_deleted`/`format`）/ soft-delete 過濾 / `csvCell` escape 邏輯·CSV header 欄位·BOM·Content-Disposition / response shape·status·CORS·docstring / `countByStatus`·`sumSucceededSubunit` 計算 / `for...of` 迴圈體 |
| L-3 No new shared logic / no new import | 不新增 shared logic、不抽 helper、不新增任何 import；**無新增 type 宣告**（minimal 變體連 `type AggRow` 都不加）|
| L-4 row OD（minimal）| aggRows `r` **不加 cast/annotation**；`countByStatus` 用 **`Record<string, number>`**；**禁** `AggRow` cast、`Record<string,unknown>` on `r`、annotate `for...of` binding、改迴圈體（除非 gate 產出具體 TS error/blocker）|
| L-5 byte-identical evidence | intents.ts emit **byte-identical**（type-strip / canonical esbuild `--loader=ts --format=esm` stdin、Git Bash）為 merge 前必要證據（7019B sha `c80b2826159e477f` 兩端）|
| L-6 No env.d.ts | **不**動 `types/env.d.ts`（single-file）；若 coding 階段意外掀 Env 缺口 → 立刻停手回 `PLAN_DRAFT`（owner 重裁 Path A）|
| L-7 OD 形態 | handler `{request:Request;env:Env}` full Convention A；`countByStatus: Record<string,number>`；`csvCell(v: unknown)`；`csvResponse(rows: Record<string,unknown>[], cors: Record<string,string>, baseName: string)`；**禁** `CfRequest`/`Pick`/arrow const/`ReturnType`/`AggRow` |
| L-8 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L-9 Coverage 誠實 | intents.ts 有 direct test（`admin-payments.test.ts` direct-literal `listHandler`，**僅 JSON 路徑**；CSV/csvResponse 路徑 test 未直接觸發〔URL 無 `?format=csv`〕，type-check 仍覆蓋）；不 overclaim runtime 覆蓋、不預先宣稱通過數（[[feedback_pr_coverage_claim_accuracy]]）|
| L-10 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / 偏離 OD（`CfRequest`/`Pick`/arrow const/加 return type/`AggRow`/`Record<string,unknown>` on `r`/`ReturnType`/動函式體·SQL·audit·CSV·rate-limit/掀 Env 缺口需 env.d.ts）→ 退回 `PLAN_DRAFT` |

## ⚠ payments admin-ops 聲明（review care L2，**admin read + CSV PII export + critical audit**）

intents.ts ＝ payments 對帳列表 + CSV export read endpoint（無金流寫入、無 redirect）：

| 紅線（typing 全程不得牽動）| 位置 |
|---|---|
| `requireStepUp(elevated:payment, 'export_payment_intents')` + `effectiveScopesFromJwt` 二次 `admin:payments` 驗（CSV 路徑）| L42-47 |
| `requireAnyScope`（admin:payments fine scope，JSON 路徑）| L50-55 |
| admin rate-limit（`checkRateLimit`/`recordRateLimit`、admin_read 60/min、含 CSV）| L61-66 |
| **PII export / read audit**（`admin.payments.intents.exported` severity `critical` / `admin.payments.intents.read` info、filters payload）| L139-149 |
| SQL query（`payment_intents` LEFT JOIN refund_request 列表 / COUNT total / GROUP BY status 對帳）+ soft-delete 過濾（`pi.deleted_at IS NULL`、`include_deleted`）| L119-168 |
| query param parse + ISO_RE 驗證 + CSV 50000 row 硬上限 | L37-115 |
| CSV 產出（`csvCell` escape / header 欄位序 / BOM / Content-Disposition filename）| L190-215 |

本刀只在 2 個 handler 簽名 + 1 個 `const` 變數型別 + 2 個 CSV helper 簽名加 inline 型別（TS erase 後 byte-identical），**函式體 / 迴圈體 / SQL / audit / CSV 邏輯一律不動**。修法若非純型別、或牽動上列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L-2/L-10）。

### Coding 階段硬性邊界

- **允許**：intents.ts 2 handler 簽名各加 inline ctx type；L170 `countByStatus: Record<string, number>`；L190 `csvCell(v: unknown)`；L195 `csvResponse(...)` 3 param type（§frozen diff 的 5 行）。
- **禁止**：改任何函式體 / `for...of` 迴圈體 / SQL / WHERE / audit / scope gate / step-up / rate-limit / CSV 欄位·escape·BOM / response shape / docstring / 加 return type / annotate `for...of` binding / 用 `AggRow` cast / 用 `Record<string,unknown>` on `r` / 用 `ReturnType<typeof getCorsHeaders>` / 新增任何安全功能或驗證 / shared util logic / tests / `tsconfig`·`eslint`·`vitest` / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types`·`Pick` / 動 `types/env.d.ts` / 新增 any·suppression·global·import·package·type 宣告 / **碰排除檔**（payments 域其他檔：`utils/payments.ts`、`auth/payments/intents.ts`、`intents/[id]/refund.ts`·`delete.ts`、`payments/intents/[id]/refund-request.ts`、vendor `payment-vendors/ecpay.ts`、`webhooks/payments/[vendor].ts`，及其餘 util / audit 域）/ 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `c05d44e9`）

### error set（forced `tsc -b tsconfig.solution.json --force`，filtered，loc+code）

```
functions/api/admin/payments/intents.ts(29,42): error TS7031   # onRequestOptions request
functions/api/admin/payments/intents.ts(29,51): error TS7031   # onRequestOptions env
functions/api/admin/payments/intents.ts(33,38): error TS7031   # onRequestGet request
functions/api/admin/payments/intents.ts(33,47): error TS7031   # onRequestGet env
functions/api/admin/payments/intents.ts(173,5): error TS7053   # countByStatus[r.status] — {} 無 index sig
functions/api/admin/payments/intents.ts(190,18): error TS7006  # csvCell(v)
functions/api/admin/payments/intents.ts(195,22): error TS7006  # csvResponse rows
functions/api/admin/payments/intents.ts(195,28): error TS7006  # csvResponse cors
functions/api/admin/payments/intents.ts(195,34): error TS7006  # csvResponse baseName
```

**恰 9 錯**：4×TS7031（2 handler × {request,env} destructure）+ 1×TS7053（`countByStatus={}` index-assignment）+ 4×TS7006（`csvCell` 1 + `csvResponse` 3 param）。**目前 line-count == unique（零 dual-leaf 重複）** = 只報 TS70xx〔functions leaf 獨有〕，無 noImplicitAny-independent 錯。

### 依賴邊界（caller cascade，spike 實測 = 0）

| 面 | 判定 | 證據 |
|---|---|---|
| 外部 production TS caller（兩 handler）| **0 牽動** | `onRequestOptions`/`onRequestGet` ＝ Pages file-routing entry，production runtime 由 Pages 注入 context、不靜態 type-check 本 annotation |
| direct test importer | **0 牽動（dual-leaf、direct-literal）** | `tests/integration/admin-payments.test.ts:16` `import { onRequestGet as listHandler }` + L85/99/105/125/141/155/182 等 **direct-literal call** `listHandler({ request: bearer(...), env })`；標 ctx 後 literal `{request,env}` 恰兩屬性、`bearer()`→`Request`、`env`（`cloudflare:test`、`ProvidedEnv extends Env`）assignable → **0 TS2345**（同 PR-2cv/2cc direct-literal 先例；spike 全 leaf ADDED=0 實證）|
| csvCell / csvResponse | **0（module-local）** | 兩者**未 export**、僅檔內 `onRequestGet` L153 + `csvResponse` 內呼叫 → 無跨檔 cascade |
| `countByStatus` / `r` | **0** | `Record<string,number>` 純補 index sig；`r: any`（D1→any）索引合法、輸出 shape 不變 |
| 跨檔/util cascade | **0（全 leaf）** | spike forced full-solution sort-diff ADDED=0（functions + scripts + tests + browser）|

**precedent landscape（佐證 OD ruling）**：
- handler `{ request: Request; env: Env }` ＝ repo 主流 Convention A（PR-2cp..2cv 數十 handler）→ 零新 OD。
- `countByStatus: Record<string, number>` ＝ PR-2cc metrics `byKey: Record<string,unknown>` 同類 index-sig 補洞先例。
- `cors: Record<string, string>` / `rows: Record<string, unknown>[]` / `v: unknown` ＝ PR-2cd/2cc `Record<string,unknown>` 投影 + unknown narrowing 慣例。
- direct-literal test 維持綠 ＝ PR-2cv aggregate/dlq/metadata + PR-2cc 先例。

## Spike 實證（full-solution，本地未 commit，2026-06-28，已 revert clean）

**程序**：branch（自 clean main `c05d44e9`）→ 量 base（forced tsc total 770、base emit 7019B、ratchet:report 770/72/262/334）→ 套 5 source annotation（minimal）→ forced tsc + sort-diff + byte-identical → frozen diff + `git diff --check` → 另跑 AggRow 變體對照 → `git checkout --` revert → 驗 clean（blob 回 base、staged 空、net source vs base 空）。

| 驗收條件 | 結果 |
|---|---|
| intents.ts errors 9 → 0 | ✅ sort-diff REMOVED = 恰 9 行（4×TS7031 + 1×TS7053 + 4×TS7006）；patched grep intents NONE-clean |
| **single-file（不改 env.d.ts）→ 證足、無 Env 缺口** | ✅ 檔內 `env` 僅 `env.chiyigo_db`（已宣告）→ 標 `env: Env` 零 TS2339；total **770 → 761（恰 −9）** |
| **minimal 變體乾淨（vs AggRow 對照）** | ✅ minimal（僅 `countByStatus: Record<string,number>`）→ intents 9→0、零新錯；對照 AggRow 變體**亦** 9→0 零新錯 → 確認 AggRow 可選非必需、採 minimal（owner 1）|
| **`cors: Record<string,string>` 乾淨（vs ReturnType）** | ✅ call site L153 零 TS2345（getCorsHeaders 早 return `{}` assignable）→ 不需 ReturnType（owner 1）|
| zero cascade（全 leaf：functions + scripts + tests + browser）| ✅ sort-diff **REMOVED=9 / ADDED=0** |
| canonical ratchet `--report`（base → patched）| ✅ base errorCount **770** / errorFiles **72** / cleanFiles **262** / sourceFilesTotal **334** → patched **761** / **71** / **263** / **334**（intents 清入 cleanFiles）|
| **intents.ts emitted-JS byte-identical**（TS erase runtime 不變硬保證；canonical `esbuild --loader=ts --format=esm` stdin、Git Bash、[[feedback_byte_identical_emit_verification]]）| ✅ base vs patched **IDENTICAL**、stderr 空：**7019B** sha `c80b2826159e477f`（base==patched 兩端同 byte 同 sha；含 5 處 annotation erase 後不變）|
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace）|
| frozen diff numstat | ✅ intents.ts `5 5`（blob `2ce708e8→910d2688`）；diff --stat 1 file / +5 / −5；無 whole-file CRLF churn |
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、blob 回 base `2ce708e8`、staged 空 |

**byte-identical 適用性**：intents.ts **有 import** → esbuild stdin transform 是**單檔 type-strip**（import 原樣穿透、不解析依賴），非完整 bundle。**對 type-only 證明而言這是正確粒度**：5 處 annotation erase 後輸出逐 byte 不變 → runtime 行為不變（同 PR-2cq..2cv 有 import 檔作法）。⚠ 用 **stdin**（`<`），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell）；本 spike emit 非空（7019B）、已排除該坑。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

```diff
diff --git a/functions/api/admin/payments/intents.ts b/functions/api/admin/payments/intents.ts
index 2ce708e8..910d2688 100644
--- a/functions/api/admin/payments/intents.ts
+++ b/functions/api/admin/payments/intents.ts
@@ -26,11 +26,11 @@ import { PAYMENT_STATUS, isPaymentStatus } from '../../../utils/payments'
 import { safeUserAudit } from '../../../utils/user-audit'
 import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit'

-export async function onRequestOptions({ request, env }) {
+export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
   return new Response(null, { status: 204, headers: getCorsHeaders(request, env) })
 }

-export async function onRequestGet({ request, env }) {
+export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
   const cors = getCorsHeaders(request, env)

   // P0-6：CSV export 帶整批 PII，必須 step-up（一次性 elevated:payment token）
@@ -167,7 +167,7 @@ export async function onRequestGet({ request, env }) {
     )
     .bind(...binds).all()

-  const countByStatus = {}
+  const countByStatus: Record<string, number> = {}
   let sumSucceededSubunit = 0
   for (const r of (aggRows.results ?? [])) {
     countByStatus[r.status] = r.cnt
@@ -187,12 +187,12 @@ export async function onRequestGet({ request, env }) {
 }

 // T9（2026-05-06）：CSV 直接從 worker 產出，避免前端跑 500 頁分頁迴圈撞 401 / OOM
-function csvCell(v) {
+function csvCell(v: unknown) {
   if (v == null) return ''
   const s = String(v)
   return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
 }
-function csvResponse(rows, cors, baseName) {
+function csvResponse(rows: Record<string, unknown>[], cors: Record<string, string>, baseName: string) {
   const header = ['id','user_id','vendor','vendor_intent_id','kind','status',
                   'amount_subunit','amount_raw','currency','requisition_id',
                   'refund_request_status','created_at','updated_at']
```

`git diff --stat`：1 file changed, 5 insertions(+), 5 deletions(-)；`git diff --numstat`：intents.ts `5 5`。

## 預期 ratchet

- clean main `c05d44e9` `--report`：errorCount **770** / errorFiles **72** / cleanFiles **262** / sourceFilesTotal **334**。
- 本 PR 後 current ratchet state：errorCount **770 → 761**（−9）、errorFiles **72 → 71**、cleanFiles **262 → 263**（spike 實測值；intents 清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 761」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 改動 = 2 handler 簽名 inline ctx 型別 + 1 `const` 變數型別 + 2 CSV helper param 型別，TS erase 後 runtime byte-identical（§Spike 7019B sha 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 770、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。
- **無 D1 migration**（純 type-only、不觸 schema）→ 不觸發 migration-before-merge（[[feedback_migration_before_merge_autodeploy]]）。
- **無 env.d.ts 變更**（single-file）→ 無 ambient `.d.ts` stale 風險（但 coding 階段 forced tsc 仍 `--force`）。

## 測試影響面（覆蓋誠實，L-9 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike 全 leaf sort-diff ADDED=0）。
- **覆蓋分層（誠實）**：

| 標的 | direct test | 硬保證 |
|---|---|---|
| `onRequestGet`（JSON 對帳列表）| `admin-payments.test.ts` direct-literal `listHandler`（L78+ `GET /api/admin/payments/intents` describe；scope 403 / soft-delete / status filter / user_id filter / date range / audit）| byte-identical（7019B 不變）+ integration（merge-front 實跑）|
| `onRequestGet`（CSV export 路徑）| **間接**（test URL 無 `?format=csv` → csvResponse 路徑 runtime 未直接觸發；但 type-check 全覆蓋）| byte-identical（csvCell/csvResponse type-strip 後不變）|
| `onRequestOptions`（CORS preflight）| 視 test 覆蓋 | byte-identical |
| `csvCell` / `csvResponse`（module-local）| 無 direct（未 export）| byte-identical（emit 不變）|

- **誠實界線**：type-only 改動 runtime 不可見（型別 erase）→ **主硬保證 ＝ byte-identical emit（7019B sha 兩端一致）**。`admin-payments.test.ts` 具體覆蓋與通過數**於 coding 階段實跑後據實記錄、不在 plan 階段預先宣稱**（[[feedback_dont_assert_runtime_semantics_without_verify]]）；CSV export 路徑 direct test 未觸發（誠實標註、不 overclaim）。
- merge-front 跑全量 `test:int` / `test:cov` 確認無跨檔破壞（type-only → 預期零牽動）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測用 `--force`（清 incremental）。**PowerShell 用 `$env:RATCHET_BASE_REF='c05d44e9'`**；唯獨 byte-identical 段用 **Git Bash**（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='c05d44e9'; npm run typecheck:ratchet` green（770→761 / 72→71 / 262→263）。
- forced `tsc -b tsconfig.solution.json --force`：intents 0 殘留 + 全 leaf sort-diff **REMOVED=9 / ADDED=0**。
- **byte-identical**（canonical recipe；NB-2 雙證之一）⚠ **Git Bash**（base `git show c05d44e9:` vs HEAD `git show HEAD:`，皆 stdin esbuild）：期望 **7019B** sha `c80b2826159e477f` 兩端、stderr 空、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「intents base vs patched emit byte-identical（sha + bytes）」與「source diff 僅 5 行（`git diff` 逐行 == frozen）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green、`npm run build:functions` green（Compiled Worker successfully）。
- 全量 `test:int` / `test:cov` 確認無跨檔破壞。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔、intents +5/−5）；超出 = scope creep = Gate fail。
