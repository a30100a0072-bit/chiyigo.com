# Stage 7 PR-2cx — annotate `admin/payments/intents/[id]/refund.ts` noImplicitAny (5 → 0)

> **gate-log 文件**（非 source/scope）。Dual Gate v3.1：任何進 repo 改動（含本 docs 檔）全走 4 道外部審查。

## §0 SPEC（owner 2026-06-28 ruling — `SPEC_APPROVED`）

**背景**：PR-2cx 原挑 `utils/payments.ts`（payment domain spine，18 errors）。scout 用 non-commit spike 實證它**不是 minimal single-file，而是 spine + webhook coupling**（見 §4 OD-1：`resolvePaymentAdapter` 標型銳化回傳型別 → cascade 12 錯入殿後檔 `webhooks/payments/[vendor].ts`、會 FAIL ratchet）。owner 裁 **D：defer `payments.ts`**，留未來專門的 **PaymentAdapter interface coupled PR**（範圍：`utils/payments.ts` + adapter registry + `mock/ecpay` + `webhooks/payments/[vendor].ts`、0 any），本輪 **pivot 到已 scout-confirmed-clean 的輕候選 `refund.ts`**。

**scope（owner lock）**：
- 僅 `functions/api/admin/payments/intents/[id]/refund.ts`（single-file）。
- **禁碰** `functions/utils/payments.ts`、同 dir `delete.ts`、`types/env.d.ts`。
- **禁新增 explicit `any`**（payment spine boundary-any 不作預設解）。
- **byte-identical emit**（純 type-only）。
- ratchet：**761 → 756**（REMOVED 5 / ADDED 0）、cleanFiles **263 → 264**、errorFiles 71 → 70；baseline `1119/175` 凍結（**不** `--update`）。

**success criteria**：refund.ts 5 noImplicitAny→0、進 cleanFiles、零 runtime change、零 cascade。

## §1 base / branch（HEAD-independent anchor）

- **base ＝ `d60ef00f`**（main HEAD ＝ #121 PR-2cw `admin/payments/intents.ts`）。
- **branch ＝ `refactor/stage7-pr2cx-admin-refund-noimplicitany`**（off `d60ef00f`、未 push）。

## §2 scope：5×TS7031 + 修法（2 edits、type-only）

`refund.ts` 全部 5 個 noImplicitAny 錯皆 TS7031（handler context destructure binding element 未標型）：

| loc | binding | handler |
|---|---|---|
| L39,42 | `request` | `onRequestOptions` |
| L39,51 | `env` | `onRequestOptions` |
| L43,39 | `request` | `onRequestPost` |
| L43,48 | `env` | `onRequestPost` |
| L43,53 | `params` | `onRequestPost` |

**Edit 1（L39）**：
```
- export async function onRequestOptions({ request, env }) {
+ export async function onRequestOptions({ request, env }: { request: Request; env: Env }) {
```
**Edit 2（L43）**：
```
- export async function onRequestPost({ request, env, params }) {
+ export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
```

## §3 OD analysis — **零新 OD**

- **Convention A handler-context type** `{ request: Request; env: Env; params: Record<string, string> }`：跨大量 migrated handler 既定慣例（`auth/payments/intents/[id].ts` #115、`admin/requisitions/[id]/{delete,save}.ts`、`admin/users/[id]/{ban,unban}.ts`、`requisition/[id].ts` … 皆此型）。本 PR 沿用、非新範式。
- **`params: Record<string, string>`**：refund.ts L65 `Number(params?.id)` 消費 `params.id`（string）→ Record<string,string> 對齊慣例與用法。
- **`env: Env`**：single-file（檔內只直接存取 `env.chiyigo_db`〔已宣告〕，其餘整包 forward 給 getCorsHeaders/requireStepUp/getPaymentIntent/lockIntentForRefund/ecpayRefund/unlockIntentToSucceeded/updatePaymentStatus/safeUserAudit）→ 標 `env:Env` 零 TS2339 → **非 Path A、不碰 env.d.ts**。
- **cascade-safe 根因（standing 假設、self-review 補強）**：標 `env:Env` 後，`env.chiyigo_db` 的 **query 結果仍是 `any`**（如 L85 `intent.metadata?.trade_no`、L96 `/_\d+$/.test(eventRow.event_id)` 不會變 `.test(unknown)` 新錯）——因本 repo **未裝 `@cloudflare/workers-types`**、`D1Database` 解為 `any`（[[feedback_d1database_resolves_any_no_workers_types]]）。**活證**：#121 `admin/payments/intents.ts` 已 `env:Env`-typed 且 clean 地對 D1 `.all()` 結果做 `countByStatus[r.status]=r.cnt` index/assign（若 D1 有真型別會炸）。故 `env:Env` 不銳化 D1 結果存取 → 零 cascade。⚠ 若未來裝 workers-types，此面需重評。

## §4 scout evidence（non-commit spike、已 `git checkout --` 還原）

- forced `tsc -b tsconfig.solution.json --force` → refund.ts 恰 5×TS7031（L39×2 + L43×3）；皆 TS70xx（noImplicitAny error）→ **functions leaf only、無 dual-leaf 重複計**。
- 套 §2 兩 edit → forced sort-diff vs 761 baseline：
  - **ADDED ＝ 空**（零 cascade；refund.ts 雖 dual-leaf via `tests/integration/admin-payments.test.ts` direct import `onRequestPost as refundHandler`，但 test call-site direct-literal `{request,env,params}` assignable → 不破）。
  - **REMOVED ＝ 恰 5**（5×TS7031 全清）。
  - raw 總數 **761 → 756**。
- env:Env single-file 確認（spike 後 refund.ts 零 `env.X` TS2339）。
- byte-identical 預期（type annotation 全 erase、零 value change）。

> **DEFER 的 payments.ts spine cascade（記錄、非本 PR scope）**：OD-1＝`resolvePaymentAdapter` 標 `vendor:string`+`ADAPTERS[vendor as keyof typeof ADAPTERS]` → 回傳型別 `any`→精確 `mock|ecpay` union → caller `webhooks/payments/[vendor].ts` 的 `.successResponse`/`.failureResponse`/`.code`/`.payment_info`/`.trade_no` 在精確 union 不存在 → cascade 12 錯（該檔 19→31）、raw 761→770 FAIL ratchet。→ 留 PaymentAdapter coupled PR。

## §5 security / 風險（payment 寫入路徑、first-do-no-harm）

- refund.ts ＝ admin 退款執行端（**Tier-0 寫入**：`requireStepUp(ELEVATED_PAYMENT,'refund_payment')` + `admin:payments:refund` scope + `lockIntentForRefund` CAS + `ecpayRefund` + `updatePaymentStatus→refunded` + critical audit）。
- 本 PR ＝ **type-only handler-context 標註**；byte-identical emit → **零 runtime change** → auth/step-up/scope/CAS/refund/audit 邏輯**完全不動**。
- 零 cascade（scout 實證）→ 不影響任何其他檔。
- 不引入 any；不碰 payments.ts/delete.ts/env.d.ts。
- review 邊界**不因 L1 降級**（payment 寫入路徑、走完整 4 道外部審查）。

## §6 verification plan

- **byte-identical**：canonical recipe `esbuild --loader=ts --format=esm`（stdin、Git Bash）對 base blob vs HEAD blob 比對 sha（[[feedback_byte_identical_emit_verification]]）。
- **ratchet**：`npm run typecheck:ratchet` → 期望 current `756 / 264`（errorFiles 70）；baseline 不動。
- **merge-front 7 gates（對齊 CI `.github/workflows/ci.yml`）**：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **staged set**：僅 `refund.ts` + 本 plan doc；**禁** `git add -A`、`CLEANUP_PLAN.md` 不進 commit。

## §7 Locks（ChatGPT Arch `APPROVED_WITH_LOCKS`、2026-06-28、binding）

ChatGPT Architecture Gate 裁 `APPROVED_WITH_LOCKS`（架構上可進 Codex Plan Gate、**非 merge 授權**）。8 條 lock 全部已被本 plan 滿足（codify、無 plan 變更）：

| Lock | 內容 | plan 對應 |
|---|---|---|
| PR-2cx-L1 | source scope 僅 `functions/api/admin/payments/intents/[id]/refund.ts` | §0 |
| PR-2cx-L2 | 僅允許兩處 handler context annotation：L39、L43 | §2 |
| PR-2cx-L3 | 禁碰 `utils/payments.ts`、`delete.ts`、`env.d.ts`、adapter registry、mock/ecpay、webhooks | §0 |
| PR-2cx-L4 | 禁新增 explicit `any`、禁改 runtime branch、禁改 SQL、禁改 response shape | §0/§5 |
| PR-2cx-L5 | 必證 byte-identical emit / runtime 行為不變 | §6 |
| PR-2cx-L6 | 驗證目標：raw 761→756、`refund.ts` 5→0、+1 cleanFile、不淨增錯 | §0/§6 |
| PR-2cx-L7 | `payments.ts` adapter typing 只能由後續 PaymentAdapter interface coupled PR 處理 | §0/§4 |
| PR-2cx-L8 | migration/rollback/DB index/Tx/SoftDel/Unique/Page/Backup 皆不得變更（出現即 scope creep） | type-only、無 DB/schema 變更 |

## §8 gate trail（state 隨進度更新）

- [x] `SPEC_APPROVED`（owner ruling 2026-06-28）
- [x] `PLAN_SELF_REVIEW_CLEAN`（L1 single-agent 對抗式 readonly-reviewer〔繼承 Opus〕→ `PLAN_CLEAN` 0 blocking/major/minor；1 informational〔D1=any cascade-safe 根因〕主線採納補入 §3）
- [x] `CHATGPT_ARCH_APPROVED`（2026-06-28、`APPROVED_WITH_LOCKS` PR-2cx-L1..L8〔§7〕；plan 已滿足全部 8 lock、無 plan 變更）
- [ ] `CODEX_PLAN_APPROVED` → `CODING_ALLOWED`
- [ ] `CODE_SELF_REVIEW_CLEAN`
- [ ] `CODEX_CODE_APPROVED`
- [ ] `CHATGPT_CODE_FAITHFULNESS_APPROVED` → `MERGE_ALLOWED`
- [ ] `MERGED_MAIN`（squash-merge --delete-branch；更新 topic receipt）
