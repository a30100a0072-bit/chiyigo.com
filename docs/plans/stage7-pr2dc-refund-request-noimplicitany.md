# Stage 7 PR-2dc — annotate `payments/intents/[id]/refund-request.ts` noImplicitAny (3 → 0)

> **gate-log 文件**（非 source/scope）。Dual Gate v3.1：任何進 repo 改動（含本 docs 檔）全走 4 道外部審查。

## §0 SPEC（owner C-1 + ChatGPT 收斂 2026-06-29 — `SPEC_APPROVED_WITH_LOCKS`）

**背景**：Stage 7 payments 域收尾。盤點階段 forced tsc 實測：記憶記「payments 域全清」**僅指 payments baton 集**（`utils/payments`·`webhooks/payments`·`payment-vendors`·`admin/payments`·`auth/payments/checkout`·`admin/requisition-refund`），但 **payments-path 仍剩唯一遺漏檔** `functions/api/payments/intents/[id]/refund-request.ts`（3×TS7031），當初被歸進「misc」桶。owner C-1 拍板**下一棒 = 此檔**，目的之一 = **關閉 payments-path noImplicitAny=0、修正「payments 全清」語義 drift**（BL-7）。

**⚠ 此檔 ≠ 已 SHIP 的 admin 退款族**（`admin/payments/intents/[id]/refund.ts`#122、`admin/requisition-refund/[id]/approve.ts`#124 是 **admin 退款執行端**）。本檔是 **user-facing 退款*請求*端**（user 對自己 succeeded payment_intent 申請退款），含 IDOR / status / 防重（migration 0034 partial UNIQUE `uq_rrr_intent_pending`）/ P0-8 race 防護 — Tier-0-adjacent。

**scope（owner lock，BL-1..BL-8）**：

| Lock | 內容 |
|---|---|
| BL-1 single-file | 只允許改 `functions/api/payments/intents/[id]/refund-request.ts` |
| BL-2 exact hunk | 只允許 L20 handler-context 加 Convention A 型別標註（1 行） |
| BL-3 no Path-A | 不改 `env.d.ts`、不新增 shared type、不中介 helper |
| BL-4 no runtime | 不改退款流程、權限、IDOR、防重、rate-limit、vendor、audit-log |
| BL-5 byte-identical | base 未標註 blob vs head 標註 blob 必 emit byte-identical |
| BL-6 ratchet | 只接受 REMOVED=3 / ADDED=0；投影 673→670、errorFiles 63→62、cleanFiles 272→273 |
| BL-7 drift closure | 完成後才可稱 payments-path noImplicitAny=0；不得再泛稱舊 baton 等於所有 payments-path |
| BL-8 dormant-safe | 不碰 audit-archive / R2 lock / retention / aggregate / checkpoint（F-3 DORMANT） |

> **payments-path 定義（BL-7 精確化、self-review plan-faithfulness 採納）**：本檔完成後「payments-path noImplicitAny=0」**僅指**已 SHIP baton 集（`functions/utils/payment*` · `functions/api/webhooks/payments/**` · `functions/utils/payment-vendors/**` · `functions/api/admin/payments/**` · `functions/api/auth/payments/**` · `functions/api/admin/requisition-refund*`）**＋本檔** `functions/api/payments/intents/[id]/refund-request.ts`（盤點 forced tsc 實證：此 6 類 glob 內僅本檔殘 noImplicitAny）。⚠ **`billing`（`admin/billing/*`、19 錯）與 `wallet`（`auth/wallet*`、17 錯）是分離的待清域、非 payments-path**——不得因本 closure 泛稱「payments 全清」涵蓋它們（正是 BL-7 要殺的語義 drift）。

- **禁新增 explicit `any`**、**禁 cast 壓錯**；只允許 Convention A context type。
- baseline `1119/175` 凍結（**不** `--update`）。

**success criteria**：refund-request.ts 3 noImplicitAny→0、進 cleanFiles、零 runtime change、零 cascade、payments-path noImplicitAny=0（drift closure）。

## §0.1 OD-1 裁決（owner C-1，2026-06-29）— self-review 形式

| 項目 | 裁決 |
|---|---|
| impl 分級 | **L1**：單檔、單行、3×TS7031、byte-identical、ADDED=0 |
| review care | **L3**：user-facing payments refund-request / Tier-0-adjacent / owner 明示不降審查 |
| self-review 形式 | **L2/L3 multi-agent self-review**（**非** L1 single-agent） |
| reviewer 要求 | **3 readonly-reviewer 三維**：plan-faithfulness、type/cascade、security/scope boundary |
| 禁止 | L1 single-agent self-review、直接進 code、把 scout 當 code approval |

## §1 base / branch（HEAD-independent anchor）

- **base ＝ `5fd17536`**（main HEAD ＝ #126 PR-2db `payment-vendors/ecpay.ts`）。
- **branch ＝ `refactor/stage7-pr2dc-refund-request-noimplicitany`**（off `5fd17536`、未 push）。

## §2 scope：3×TS7031 + 修法（1 edit、type-only）

`refund-request.ts` 全部 3 個 noImplicitAny 錯皆 TS7031（單一 `onRequestPost` handler context destructure binding element 未標型）：

| loc | binding | handler |
|---|---|---|
| L20,39 | `request` | `onRequestPost` |
| L20,48 | `env` | `onRequestPost` |
| L20,53 | `params` | `onRequestPost` |

**Edit 1（L20，唯一 edit）**：
```
- export async function onRequestPost({ request, env, params }) {
+ export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
```

> 本檔僅 `onRequestPost` 一個 handler（無 `onRequestOptions`）→ 1 edit、3 binding element。

## §3 OD analysis — **零新型別/cascade OD**（唯一 OD ＝ §0.1 程序面 self-review 形式）

- **Convention A handler-context type** `{ request: Request; env: Env; params: Record<string, string> }`：跨 **18 個 migrated handler** 既定慣例（含剛 SHIP 的 `admin/payments/intents/[id]/{refund,delete}.ts`、`admin/requisition-refund/[id]/{approve,reject}.ts`、`auth/payments/intents/[id].ts`#115 …）。本 PR 沿用、**非新範式**。
- **`params: Record<string, string>`**：L24 `Number(params?.id)` 消費 `params.id`（string）→ 對齊慣例與用法。
- **`env: Env`**：single-file（檔內只直接存取 `env.chiyigo_db`〔env.d.ts:23 已宣告 `D1Database`〕，其餘整包 forward 給 `requireAuth`(L21)/`safeUserAudit`(L110)/`syncRequisitionTgMessage`(L107)）→ 標 `env:Env` 零 TS2339 → **非 Path A、不碰 env.d.ts**（BL-3）。
- **cascade-safe 根因（refund-request.ts 專屬獨立論證；§4 spike 實證 ADDED=0）**：
  1. **`requireAuth(request, env)` → `{ user, error }`**：`requireAuth`（`utils/auth.ts:22-27`）的 `request`/`env` 參數**已顯式標型** `Request`/`Env`（**非未標型**；self-review type/cascade 修正原 prose 誤述）；其 inferred 回傳 union `{user:null,error:Response} | {user:<jwt payload>,error:null}` 由**自身 signature 決定、與 caller 引數型別無關**。call-site 現傳 implicit-any `request`/`env`（assignable 到已標型參數）、標註後傳 `Request`/`Env` — 兩者 requireAuth 回傳**全等** → `user`/`error` **不銳化** → `user.sub`(L33，`if(error)` guard 後 user 為 payload) 在 functions leaf `strict:false`（strictNullChecks off）下 type-check → 零新錯。（同 PR-2cy/2cz「callee 回傳由自身 signature 決定」原理；此處因 requireAuth 參數已標型而**更強健**——回傳 union 完全固定、不可能受 call-site 影響。）
  2. **D1 query 鏈全 any**：`db = env.chiyigo_db`，`D1Database` 在本 repo（**未裝 `@cloudflare/workers-types`**）解為 `any`（[[feedback_d1database_resolves_any_no_workers_types]]）→ `db.prepare().bind().first()` 維持鬆型 → `intent` / `existing` / `reqRow` / `inserted` / `dup` 全 `any` → `intent.user_id` / `intent.status` / `intent.metadata`（L46 `JSON.parse(intent.metadata)`）/ `intent.amount_subunit` / `intent.currency` / `existing.id` / `inserted?.id` / `dup?.id` 皆作用於 `any` → 零新錯。**活證**：#121 `admin/payments/intents.ts`、#123 `delete.ts` 已 `env:Env`-typed 且 clean 對 D1 結果索引/`JSON.parse(intent.metadata)`。
  3. `Number(...)` / `String(body?.reason ?? '')` / `JSON.parse(any)` / `reason.slice(0,500)` / `String(e?.message ?? e).includes('UNIQUE')`：標準用法、不受 handler-context 標型影響。
  - ⚠ 若未來裝 `@cloudflare/workers-types` 或銳化 `requireAuth` 回傳型別，本面（D1/`requireAuth` 結果 any-ness）需重評 cascade。

## §4 scout evidence（non-commit spike、已 `git checkout --` 還原、git 零殘留）

- forced `tsc -b tsconfig.solution.json --pretty false --force`（base `5fd17536`）→ refund-request.ts 恰 **3×TS7031**（L20 col39 `request` / col48 `env` / col53 `params`）；皆 TS70xx（noImplicitAny error）。total file-errors **673**、global **0**。
- 套 §2 edit → forced full-solution build sort-diff vs 673 baseline：
  - **REMOVED ＝ 恰 3**（refund-request.ts L20 3×TS7031 全清，`comm -23` 逐行核對）。
  - **ADDED ＝ 空**（`comm -13` count=0；零 cascade）。
  - raw 總數 **673 → 670**。
- **dual-leaf ＝ 無（functions-leaf only ×1）**：全 repo（`functions/` + `tests/` + `src/`）**無任何檔 import 本 handler**（`tests/` 唯一 `refund-request` 命中 ＝ `admin-requisitions-list.test.ts:393/405` 的**無關** audit endpoint 字串 `"endpoint":"refund-requests"`；`functions/api/admin/requisition-refund.ts` 是 admin list 端、不 import 本檔；`src/js/admin-refund-requests.ts` 是前端 browser-pipeline）→ 3×TS7031 functions-leaf only ×1、**無 dual-leaf doubling**；**且無 test call-site 傳 partial env literal → ecpay PR-2db 的 TS2345 partial-env 陷阱不適用、無需 narrow `Pick<Env>`**。**前端僅 URL-string caller、不影響**（`src/js/dashboard.ts:638` `window.apiFetch('/api/payments/intents/${id}/refund-request',…)` + `scripts/audit-error-i18n-render.mjs:217` 為 URL 字串 / path-matcher、**非 TS module import** → 不進 functions/tests leaf 編譯、不影響 cascade；本節 importer enumeration 為子集、no-importer 結論不變）。
- **env:Env single-file 確認**：spike 後 refund-request.ts 零 `env.X` TS2339（env.d.ts:23 `chiyigo_db: D1Database` 已宣告；其餘 env forward）。
- **byte-identical emit 實證**（canonical recipe、Git Bash stdin transform；**base 端 pin PR base `5fd17536`〔未標註〕、head 端＝已標註版**，非 HEAD-vs-worktree / HEAD-vs-HEAD 恆真比對〔[[feedback_byte_identical_emit_verification]]〕）：
  ```bash
  # base ＝ PR base 5fd17536（未標註）；head ＝ 套 §2 edit 後（已標註）
  git show "5fd17536:functions/api/payments/intents/[id]/refund-request.ts" | npx esbuild --loader=ts --format=esm > base.mjs
  # head.mjs ＝ 套 §2 edit 後的 refund-request.ts，同 recipe
  cmp -s base.mjs head.mjs && echo BYTE_IDENTICAL   # + wc -c（兩端 3932）+ sha256sum（兩端同）
  ```
  - base.mjs（未標註 emit）＝ head.mjs（已標註 emit）＝ **3932 bytes**、sha256 兩端同 ＝ `885205827c892fecde16f036370aaa7726befa5af2bb10b758b71054100c75e5`、`cmp -s` IDENTICAL、stderr 皆空（sha ≠ 空字串 sha → 真實非空輸出）。→ type annotation 全 erase、**零 runtime change**（BL-5）。
  - **驗證紀律**：code 階段重播以 `5fd17536` 為 base 端、已標註 commit blob 為 head 端（**禁 HEAD-vs-HEAD / annotated-vs-annotated 恆真式**）。

## §5 security / 風險（user-facing 退款請求端、Tier-0-adjacent、first-do-no-harm）

- refund-request.ts ＝ user 對自己 succeeded payment_intent 申請退款：`requireAuth` + **IDOR**（`intent.user_id === request user`、L40）+ **status gate**（`intent.status==='succeeded'`、L41）+ **防重**（pending refund_request → 409，L59-69）+ **race 防護**（L78-99 INSERT UNIQUE conflict catch、依 migration 0034 partial UNIQUE `uq_rrr_intent_pending`，雙擊/競態擋第二筆）+ requisition `refund_pending` 連動（L101-108）+ critical user audit（L110）+ TG sync（L107）。
- 本 PR ＝ **type-only handler-context 標註**；byte-identical emit（§4）→ **零 runtime change** → auth/IDOR/status/防重/race/requisition 連動/audit/TG 邏輯**完全不動**（BL-4）。
- 零 cascade（scout 實證 ADDED=0）→ 不影響任何其他檔。
- 不引入 any；不碰 env.d.ts（BL-3）。
- **F-3 DORMANT-safe（BL-8、self-review security 精確化）**：本檔 import 僅 `utils/auth`·`utils/user-audit`·`utils/tg-requisition`，**不 import / 不 invoke** 任何 audit-archive / R2 lock / retention / aggregate / checkpoint code。⚠ 精確：`safeUserAudit`（`user-audit.ts:65`）內部會 `classifyForCold(event_type, severity)` 衍生 `cold_class` 寫進 `audit_log` row（migration 0038），DORMANT archive worker 之後**會**依 `cold_class` 分流 — 故本檔經 `safeUserAudit` **transitively feed** cold-archive 分類前門（原 prose「完全不碰」略過度）。但：(a) `cold_class` 衍生在**未修改**的 `user-audit.ts`；(b) byte-identical emit 證 `safeUserAudit(env,{event_type:'payment.refund.requested',severity:'warn',…})` 呼叫與引數零變動 → 衍生 `cold_class` **provably 相同**；(c) DORMANT 的 R2-lock / retention / checkpoint worker code **既未修改、也未被本檔 invoke**。→ BL-8 實質成立（cold-archive pipeline 輸入不變、dormant 行為零觸發）；audit hash chain 不變量未牽動。
- **impl L1（1 行 type-only）/ review care L3**（§0.1）：user-facing payments refund-request 邊界**不因 impl=L1 而降低審查強度**；走完整 4 道外部審查 + **L2/L3 multi-agent self-review**（3 readonly-reviewer 三維）。

## §6 verification plan

- **byte-identical**：canonical recipe `esbuild --loader=ts --format=esm`（stdin、Git Bash）對 **PR base `5fd17536` blob（未標註）vs 已標註 commit blob** 比對 sha（[[feedback_byte_identical_emit_verification]]；**禁 HEAD-vs-HEAD 恆真式**）— scout 已證 3932B/`885205…`，code 階段 commit 後以 `5fd17536` 為 base 重播確認。
- **full-solution sort-diff（L6）**：Code 階段（commit 後）重跑 forced `tsc -b … --force`，對 673 baseline sort-diff → 必 **REMOVED 恰 3 / ADDED 0**；ADDED 非空 → 回 Codex/ChatGPT gate 重審、**禁自擴 scope**。
- **ratchet**：`npm run typecheck:ratchet` → 期望 current `670 / 273`（errorFiles 62）；baseline 不動（**不** `--update`）。
- **merge-front 7 gates（對齊 CI `.github/workflows/ci.yml`）**：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **staged set**：僅 `refund-request.ts` + 本 plan doc；**禁** `git add -A` / `-A`，**`CLEANUP_PLAN.md` 不進 commit**。

## §7 Locks（ChatGPT Arch `APPROVED_WITH_LOCKS`、2026-06-29、binding）

ChatGPT Architecture Gate 裁 **`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 blocker / 0 required revision / 3 non-blocking locks**；架構上可進 Codex Plan Gate、**非 merge 授權、非 code correctness 最終裁決**）。逐題 5 問全通過：①架構/治理一致性〔不改 API contract / IAM / tenant / DB schema / migration / rollback〕②BL-7 framing 通過+加鎖 ③F-3 邊界 通過+措辭精確化〔「不改 import/invoke + `safeUserAudit` 參數 byte-identical + `cold_class` 衍生 provably unchanged」，**非**「完全無關」〕④byte-identical zero-runtime 通過〔Code Gate 必重跑非恆真〕⑤locks 足夠+追加 3 條。

3 條 ChatGPT lock（codify、已被本 plan 滿足、無 plan 邏輯變更）：

| Lock | 內容 | plan 對應 |
|---|---|---|
| PR-2dc-L1 | Code 階段 diff 只有 `functions/api/payments/intents/[id]/refund-request.ts` 一檔、hunk **僅 L20** handler-context type annotation | §2 / §6 staged set / BL-1·BL-2 |
| PR-2dc-L2 | Code Gate 重跑**非恆真** byte-identical：base `5fd17536:$F` 未標註 blob vs committed annotated source、emit sha/size/cmp 一致才過 | §4 / §6 / BL-5 |
| PR-2dc-L3 | 報告用語只能稱「payments-path noImplicitAny=0 **under enumerated baton set + refund-request.ts**」；**不得**寫成所有 payment-like / `billing` / `wallet` 全清 | §0 payments-path 定義 / BL-7 |

**Code Gate 必看（ChatGPT 列）**：source diff 1 檔 1 行無他 hunk · tsc sort-diff REMOVED=3/ADDED=0 · ratchet 673→670 / 63→62 / 272→273 不 update baseline · byte-identical 非恆真 base-vs-head 重算 · dormant 無 audit-archive/R2/retention/aggregate/checkpoint diff · runtime 無退款流程/權限/IDOR/防重/vendor/audit payload 改動。

## §8 gate trail（state 隨進度更新）

- [x] `SPEC_APPROVED_WITH_LOCKS`（owner C-1 + ChatGPT 收斂 2026-06-29：refund-request.ts ＝ 下一棒；BL-1..BL-8；OD-1 ＝ L2/L3 multi-agent self-review）
- [x] `PLAN_SELF_REVIEW_CLEAN`（L2/L3 multi-agent self-review：3 parallel readonly-reviewer 三維〔plan-faithfulness / type-cascade / security-scope，繼承 Opus 4.8〕→ **0 blocking / 0 major**；4 處 minor/info 經主線獨立裁決採納修入 plan：**(1)** §3 bullet-1 `requireAuth` premise 事實錯誤〔`auth.ts:22-27` 參數**已標型** `Request`/`Env`、非未標型；結論不變、機制更強健〕→ 修正；**(2)** BL-7「payments-path」術語未定義〔billing/wallet 仍帶 noImplicitAny〕→ 加精確定義 + billing/wallet 標分離待清域；**(3)** §5 BL-8「完全不碰 cold-archive」略過度〔`safeUserAudit` 內部衍生 `cold_class` transitively feed〕→ 收斂 wording、證 `cold_class` provably 相同；**(4)** §4 importer enumeration 漏 `dashboard.ts:638` apiFetch〔URL 字串非 import〕→ 補註。主線**獨立重驗** heavy claims：`comm` REMOVED=3 exact / ADDED=0、files 63→62、`node_modules/@cloudflare/` 無 workers-types → D1=any cascade-safe、byte-identical 非恆真 3932B/`885205…`〔3 reviewer 各自獨立 esbuild 重算同 sha〕。修正後一輪 0 新發現。)
- [x] `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（2026-06-29、**0 blocker / 0 required revision / 3 non-blocking locks** PR-2dc-L1..L3〔§7〕；逐題 5 問全通過〔Q2 BL-7 framing 加鎖、Q3 F-3 措辭精確化、Q4 byte-identical Code Gate 必重跑〕；明示**非 merge 授權、非 code correctness 最終裁決**）
- [ ] `CODEX_PLAN_APPROVED` → `CODING_ALLOWED`
- [ ] `CODE_SELF_REVIEW_CLEAN`（L2/L3 multi-agent）
- [ ] `CODEX_CODE_APPROVED`
- [ ] `CHATGPT_CODE_FAITHFULNESS_APPROVED` → `MERGE_ALLOWED`
- [ ] `MERGED_MAIN`（squash-merge --delete-branch；merge-front 重 7 gates 全綠後；更新 topic receipt + MEMORY.md index + 刪 packets）
