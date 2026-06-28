# Stage 7 PR-2cy — annotate `admin/payments/intents/[id]/delete.ts` noImplicitAny (5 → 0)

> **gate-log 文件**（非 source/scope）。Dual Gate v3.1：任何進 repo 改動（含本 docs 檔）全走 4 道外部審查。

## §0 SPEC（owner directive 2026-06-28 — `SPEC_APPROVED`）

**背景**：payments 域 noImplicitAny 清理。PR-2cx（`refund.ts`、#122 `cc8c786d`）SHIPPED 後，owner 指定**下一棒 = `delete.ts`**（同 dir、同 test、同 5×TS7031 形態）。`utils/payments.ts`（spine 18 errors）已於 PR-2cx scout 實證 spine+webhook cascade → owner 裁 DEFER，留未來專門 **PaymentAdapter interface coupled PR**（範圍：`utils/payments.ts` + adapter registry + `mock/ecpay` + `webhooks/payments/[vendor].ts`、0 any），**非本 PR scope**。

**⚠ 不可假設同 refund.ts（owner 明示）**：`delete.ts` body 含 **soft-delete UPDATE + anonymize（archive INSERT + metadata UPDATE）** 兩條寫入路徑，存取 `intent.metadata` / `intent.failure_reason` 等欄位 — 為 refund.ts 所無。本 PR **獨立 spike**（§4），不沿用 refund.ts 結論，實證該 anonymize/INSERT 路徑零 cascade（§3 根因 + §4 sort-diff）。

**scope（owner lock）**：
- 僅 `functions/api/admin/payments/intents/[id]/delete.ts`（single-file）。
- **禁碰** `functions/utils/payments.ts`、同 dir `refund.ts`、`types/env.d.ts`、adapter registry、mock/ecpay、webhooks。
- **禁新增 explicit `any`**（payment spine boundary-any 不作預設解）。
- **禁改 runtime branch / SQL / response shape / audit**。
- **byte-identical emit**（純 type-only）。
- ratchet：**756 → 751**（REMOVED 5 / ADDED 0）、cleanFiles **264 → 265**、errorFiles **70 → 69**；baseline `1119/175` 凍結（**不** `--update`）。

**success criteria**：delete.ts 5 noImplicitAny→0、進 cleanFiles、零 runtime change、零 cascade。

## §1 base / branch（HEAD-independent anchor）

- **base ＝ `cc8c786d`**（main HEAD ＝ #122 PR-2cx `admin/payments/intents/[id]/refund.ts`）。
- **branch ＝ `refactor/stage7-pr2cy-admin-delete-noimplicitany`**（off `cc8c786d`、未 push）。

## §2 scope：5×TS7031 + 修法（2 edits、type-only）

`delete.ts` 全部 5 個 noImplicitAny 錯皆 TS7031（handler context destructure binding element 未標型）：

| loc | binding | handler |
|---|---|---|
| L40,42 | `request` | `onRequestOptions` |
| L40,51 | `env` | `onRequestOptions` |
| L44,39 | `request` | `onRequestPost` |
| L44,48 | `env` | `onRequestPost` |
| L44,53 | `params` | `onRequestPost` |

**Edit 1（L40）**：
```
- export async function onRequestOptions({ request, env }) {
+ export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
```
**Edit 2（L44）**：
```
- export async function onRequestPost({ request, env, params }) {
+ export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
```

## §3 OD analysis — **零新 OD**

- **Convention A handler-context type** `{ request: Request; env: Env; params: Record<string, string> }`：跨大量 migrated handler 既定慣例（`refund.ts` #122、`auth/payments/intents/[id].ts` #115、`admin/requisitions/[id]/{delete,save}.ts`、`admin/users/[id]/{ban,unban}.ts` … 皆此型）。本 PR 沿用、非新範式。
- **`params: Record<string, string>`**：delete.ts L55 `Number(params?.id)` 消費 `params.id`（string）→ Record<string,string> 對齊慣例與用法。
- **`env: Env`**：single-file（檔內只直接存取 `env.chiyigo_db`〔env.d.ts:23 已宣告 `D1Database`〕，其餘 forward 給 getCorsHeaders(L41/45)/requireStepUp(L47)/getPaymentIntent(L58)/safeUserAudit(L117)；⚠ `effectiveScopesFromJwt`(L50) 吃 `stepCheck.user`、**非 env**〔self-review M-2 修正〕）→ 標 `env:Env` 零 TS2339 → **非 Path A、不碰 env.d.ts**。
- **cascade-safe 根因（delete.ts 專屬獨立論證；§4 spike 實證）**：
  1. `intent = await getPaymentIntent(env, { id })`：`getPaymentIntent`（`utils/payments.ts` L143）的 **`env` 參數本身未標型**（payments.ts 自身 18 個 deferred noImplicitAny 之一），其回傳 ＝ D1 `.first()` 的 `row`（→ `any`）→ **回傳型別 `any`、與傳入 `env` 引數型別無關**。故本 PR 標 `env:Env` **不銳化 `intent`** → `intent.status` / `intent.metadata` / `intent.failure_reason` / `intent.user_id` / `intent.vendor` / `intent.vendor_intent_id` / `intent.amount_subunit` 全維持 `any`。
  2. **anonymize 路徑（refund.ts 所無、本 PR 重點驗證）**：L87-89 `typeof intent.metadata === 'string' ? intent.metadata : JSON.stringify(intent.metadata)`、L96 `intent.failure_reason ?? null` 皆作用於 `any` → 零新錯。
  3. **三條 D1 寫入**（L75 soft-delete UPDATE、L90 archive INSERT、L105 anonymize UPDATE）：`env.chiyigo_db` 型別 `D1Database` 在本 repo（**未裝 `@cloudflare/workers-types`**）解為 `any`（[[feedback_d1database_resolves_any_no_workers_types]]）→ `.prepare().bind().run()` 維持鬆型 → 零新錯。**活證**：#121 `admin/payments/intents.ts` 已 `env:Env`-typed 且 clean 對 D1 `.all()` 結果索引/賦值。
  4. `new Date().toISOString()` / `JSON.stringify({...})` / `Number(...)` / `Set.has(any)`：標準用法、不受 handler-context 標型影響。
  - ⚠ 若未來裝 workers-types，本面（D1 結果 any-ness）需重評。

## §4 scout evidence（non-commit spike、已 `git checkout --` 還原）

- forced `tsc -b tsconfig.solution.json --pretty false --force` → delete.ts 恰 **5×TS7031**（L40×2 + L44×3）；皆 TS70xx（noImplicitAny error）→ **functions leaf only、無 dual-leaf 重複計**。total file-errors **756**、global **0**。
- 套 §2 兩 edit → forced full-solution build sort-diff vs 756 baseline：
  - **REMOVED ＝ 恰 5**（delete.ts 5×TS7031 全清）。
  - **ADDED ＝ 空**（零 cascade，含 anonymize/INSERT 路徑、含 tests-leaf）。
  - raw 總數 **756 → 751**。
- **dual-leaf 實證**：delete.ts 經 `tests/integration/admin-payments.test.ts:20` direct import `onRequestPost as deleteHandler`，並於 L538/571/586/618 **4 處 call-site** 以 literal `{ request: bearer(...), env, params: { id: String(intentId) } }` 呼叫（涵蓋 anonymize-archive / no-stepup-403 / soft-delete / locked 路徑）。full-solution build ADDED=0 → 4 處 literal 對標註後 context type **皆 assignable**、tests-leaf 零 cascade。
- **env:Env single-file 確認**：spike 後 delete.ts 零 `env.X` TS2339（env.d.ts:23 `chiyigo_db: D1Database` 已宣告）。
- **byte-identical emit 實證**（canonical recipe、Git Bash stdin transform；**base 端 pin PR base `cc8c786d`〔未標註〕、head 端＝已標註版**，非 HEAD-vs-worktree 恆真比對〔self-review M-1〕）：
  ```bash
  # base ＝ PR base（未標註）；head ＝ 已標註（scout spike 期 working tree / code 階段 commit blob）
  git show "cc8c786d:functions/api/admin/payments/intents/[id]/delete.ts" > base.ts   # 未標註
  # head.ts ＝ 套 §2 兩 edit 後的 delete.ts
  node_modules/.bin/esbuild --loader=ts --format=esm < base.ts > base.js 2> base.err
  node_modules/.bin/esbuild --loader=ts --format=esm < head.ts > head.js 2> head.err
  diff -q base.js head.js && echo IDENTICAL   # + wc -c（兩端 3632）+ sha256sum（兩端同）
  ```
  - base.js（未標註 emit）＝ head.js（已標註 emit）＝ **3632 bytes**、sha256 同 ＝ `e8d8c565a1773d1a4d02945593f5b727d935efa100ae8c6e3713754f2dbbe3fd`、`diff -q` IDENTICAL、stderr 皆空（且 sha ≠ 空字串 sha `e3b0c442…` → 真實非空輸出）。→ type annotation 全 erase、**零 runtime change**。
  - **驗證紀律（self-review M-1）**：byte-identical CLAIM 已雙重證實 ——（a）scout 期此檢於 working tree ＝已標註 狀態跑（annotated-vs-base〔HEAD〕、有效）；（b）self-review 獨立把 §2 edit 套上 base blob 重算（annotated-vs-base）再得同 3632B/`e8d8c565…`。**code 階段重播必以 `cc8c786d` 為 base 端、已標註 commit blob 為 head 端**（禁 HEAD-vs-HEAD / annotated-vs-annotated 恆真式）。

> **DEFER 的 payments.ts spine cascade（記錄、非本 PR scope）**：PR-2cx scout 實證 OD-1＝`resolvePaymentAdapter` 標 `vendor:string` → 回傳型別 `any`→精確 `mock|ecpay` union → caller `webhooks/payments/[vendor].ts` cascade 12 錯、FAIL ratchet。→ 留 PaymentAdapter coupled PR，**本 PR 禁碰 payments.ts**。

## §5 security / 風險（admin destructive 寫入路徑、first-do-no-harm）

- delete.ts ＝ admin 刪除/匿名化執行端（**destructive 寫入**：`requireStepUp(ELEVATED_PAYMENT,'delete_payment')` + `admin:payments` scope + LOCKED_STATUSES（refunded 鎖死）+ 分流 soft-delete vs anonymize + archive INSERT + critical audit）。P0-1 金流憑證完整性設計（檔頭）。
- 本 PR ＝ **type-only handler-context 標註**；byte-identical emit（§4）→ **零 runtime change** → auth/step-up/scope/狀態分流/soft-delete/anonymize/archive/audit 邏輯**完全不動**。
- 零 cascade（scout 實證）→ 不影響任何其他檔。
- 不引入 any；不碰 payments.ts/refund.ts/env.d.ts。
- **impl L1（2 行 type-only）/ review care L2**：payment + destructive 寫入路徑邊界**不因 impl=L1 而降低外部審查強度**，走完整 4 道外部審查（self-review form 依 §動工分級＝L1 single-agent；分類疑義可在 Plan/Code Gate 被挑戰、fail-safe 升級）。

## §6 verification plan

- **byte-identical**：canonical recipe `esbuild --loader=ts --format=esm`（stdin、Git Bash）對 **PR base `cc8c786d` blob（未標註）vs 已標註 commit blob** 比對 sha（[[feedback_byte_identical_emit_verification]]；**禁 HEAD-vs-HEAD 恆真式**，self-review M-1）— scout 已證 3632B/`e8d8c565…`，code 階段 commit 後以 `cc8c786d` 為 base 重播確認。
- **ratchet**：`npm run typecheck:ratchet` → 期望 current `751 / 265`（errorFiles 69）；baseline 不動（**不** `--update`）。
- **merge-front 7 gates（對齊 CI `.github/workflows/ci.yml`）**：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int`（含 admin-payments delete 4 case）· `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **staged set**：僅 `delete.ts` + 本 plan doc；**禁** `git add -A`、`CLEANUP_PLAN.md` 不進 commit。

## §7 Locks（ChatGPT Arch — 待裁；APPROVE 後 codify 於此）

_pending `CHATGPT_ARCH_APPROVED`。_

## §8 gate trail（state 隨進度更新）

- [x] `SPEC_APPROVED`（owner directive 2026-06-28：delete.ts ＝ 下一棒）
- [x] `PLAN_SELF_REVIEW_CLEAN`（L1 single-agent 對抗式 readonly-reviewer〔繼承 Opus〕→ 0 blocking / 0 major / **2 minor**，皆採納修入 plan：**M-1** byte-identical recipe 原為 HEAD-vs-worktree 恆真式 → 改 pin base `cc8c786d`〔未標註〕vs 已標註 head〔§4/§6〕，且 reviewer 獨立把 §2 edit 套 base blob 重算得同 3632B/`e8d8c565…` 雙證 claim；**M-2** §3 prose 誤列 `effectiveScopesFromJwt` 為 env-forward〔實吃 `stepCheck.user`〕→ 修正。cascade root-cause〔getPaymentIntent env 參數 baseline TS7006、回傳 any〕+ sort-diff ADDED=0 + ratchet 756/70/264→751/69/265 + scope 無 creep 皆 reviewer 獨立 CONFIRMED）
- [ ] `CHATGPT_ARCH_APPROVED`
- [ ] `CODEX_PLAN_APPROVED` → `CODING_ALLOWED`
- [ ] `CODE_SELF_REVIEW_CLEAN`
- [ ] `CODEX_CODE_APPROVED`
- [ ] `CHATGPT_CODE_FAITHFULNESS_APPROVED` → `MERGE_ALLOWED`
- [ ] `MERGED_MAIN`（squash-merge --delete-branch；merge-front 重 7 gates 全綠後；更新 topic receipt + 刪 packets）
