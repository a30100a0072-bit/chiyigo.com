# Stage 7 PR-2dd — annotate wallet domain (4 files) noImplicitAny (17 -> 0)

> **gate-log 文件**（非 source/scope）。Dual Gate v3.1：任何進 repo 改動（含本 docs 檔）全走 4 道外部審查。

## §0 SPEC（owner C-1 + ChatGPT 收斂 2026-06-29 — `SPEC_APPROVED_WITH_LOCKS`）

**背景**：Stage 7 noImplicitAny 清理、payments-path 收尾（PR-2dc #127 `ad70ea9b`）後、owner 排序 light→heavy 下一棒 = **wallet 域**（最純機械、4 檔全 handler-context TS7031）。

**scope（owner lock，WL-1..WL-10）**：

| Lock | 內容 |
|---|---|
| WL-1 exact files | 只允許改 4 檔：`functions/api/auth/wallet.ts`、`functions/api/auth/wallet/[id].ts`、`functions/api/auth/wallet/nonce.ts`、`functions/api/auth/wallet/verify.ts` |
| WL-2 exact scope | 只允許 **8 個 handler-context** 加 Convention A 型別標註 |
| WL-3 Convention A | 7 handler 用 `{ request: Request; env: Env }`；`[id].ts` DELETE 額外含 `params: Record<string, string>` |
| WL-4 no Path-A | 不改 `types/env.d.ts`、不新增 shared type、不新增 helper |
| WL-5 no runtime | 不改 SIWE 驗章 / nonce 發行·消耗 / wallet bind·unbind / factor-add grant / critical audit / rate-limit / SQL |
| WL-6 cascade gate | 只接受 **REMOVED=17 / ADDED=0**；任一檔新增錯誤 → 停止並拆棒 |
| WL-7 ratchet | 投影 **670→653**、errorFiles **62→58**、cleanFiles **273→277**；baseline 1119/175 不 --update |
| WL-8 byte-identical | 4 檔皆用 base 未標註 blob vs annotated source 做**非恆真** byte-identical |
| WL-9 tests/imports | direct-import tests 只作 assignability 驗證；**不得為通過 typecheck 改 tests** |
| WL-10 F-3 dormant-safe | 不碰 audit-archive / R2 / retention / aggregate / checkpoint；`safeUserAudit` 呼叫形狀不得變 |

- **禁新增 explicit `any`**、**禁 cast 壓錯**；只允許 Convention A context type。baseline 1119/175 凍結。

**success criteria**：wallet 域 4 檔 17 noImplicitAny→0、4 檔進 cleanFiles、零 runtime change、零 cascade、SIWE user-wallet 域 noImplicitAny=0。

> **「wallet 域」精確定義（self-review plan-faithfulness 採納、避 PR-2dc payments-path 類 drift）**：指 **SIWE user-wallet 4 檔**（`functions/api/auth/wallet*`、＝專案 `wallet17` 殘餘桶）。⚠ **`functions/api/admin/billing/wallets/[tenantId]/{adjust,topup}.ts` 是分離的 `credit_wallets` / billing 域**（在 `billing`19 桶、retain TS7006+TS7031、本棒不碰；`credit_wallets≠user_wallets`）；`functions/api/tenants/[tenantId]/wallet.ts` 已 error-free。完成後僅可稱「SIWE user-wallet 域 noImplicitAny=0」、**不得泛稱所有 wallet-named 檔全清**。

## §0.1 OD 裁決（owner C-1 + ChatGPT，2026-06-29）

| OD | 裁決 | 理由 |
|---|---|---|
| **OD-1 self-review 形式** | **L2/L3 multi-agent**（3 readonly-reviewer 三維；**非** L1 single-agent） | wallet verify/unbind = user-facing money-adjacent（SIWE + factor-add grant + critical audit）、不因 type-only 降審查 |
| **OD-2 批次粒度** | **domain-batch 單 PR**（4 檔） | 4 檔同型 handler-context、ADDED=0、4 檔 byte-identical、無 Path-A；拆單檔收益低 gate 成本高。除非 PLAN/Code Gate 發現 ADDED>0 / 非 byte-identical / 非 uniform hunk / runtime-scope 壓力才拆 |

## §1 base / branch（HEAD-independent anchor）

- **base ＝ `ad70ea9b`**（main HEAD ＝ #127 PR-2dc）。
- **branch ＝ `refactor/stage7-pr2dd-wallet-noimplicitany`**（off `ad70ea9b`、未 push）。
- **base blobs**（byte-identical replay 錨）：`wallet.ts`=`0e7ce977`、`[id].ts`=`a5f5a4ec`、`nonce.ts`=`0a112d1f`、`verify.ts`=`db868d26`。

## §2 scope：17×TS7031 + 修法（8 edits、type-only）

全 17 個 noImplicitAny 錯皆 TS7031（handler-context destructure binding element 未標型）：

| 檔 | site | handler | binding | 標註 |
|---|---|---|---|---|
| `auth/wallet.ts` | L17 | `onRequestOptions` | request,env | `{ request: Request; env: Env }` |
| `auth/wallet.ts` | L21 | `onRequestGet` | request,env | `{ request: Request; env: Env }` |
| `auth/wallet/[id].ts` | L26 | `onRequestOptions` | request,env | `{ request: Request; env: Env }` |
| `auth/wallet/[id].ts` | L30 | `onRequestDelete` | request,env,params | `{ request: Request; env: Env; params: Record<string, string> }` |
| `auth/wallet/nonce.ts` | L25 | `onRequestOptions` | request,env | `{ request: Request; env: Env }` |
| `auth/wallet/nonce.ts` | L29 | `onRequestPost` | request,env | `{ request: Request; env: Env }` |
| `auth/wallet/verify.ts` | L36 | `onRequestOptions` | request,env | `{ request: Request; env: Env }` |
| `auth/wallet/verify.ts` | L40 | `onRequestPost` | request,env | `{ request: Request; env: Env }` |

每 edit ＝ `export async function <name>({ … })` 加 `: { … }` 型別標註（type-only、emit 不變）。`wallet.ts:38` 既有 `(r: Record<string, unknown>)` 不動。

## §3 OD analysis — **零新型別/cascade OD**（唯一 OD ＝ §0.1 程序面）

- **Convention A handler-context type**：跨 18+ migrated handler 既定慣例（含 #127 refund-request、#123 delete、#124 approve/reject）。本 PR 沿用、非新範式。
- **`env: Env` single-file（非 Path-A）**：4 檔 env 存取**僅** `env.chiyigo_db`（含 `.batch` / `.prepare`，env.d.ts:23 `D1Database`）+ 整包 forward 給 util（getCorsHeaders / requireAuth / requireStepUp / requireFactorAddGrant / issueWalletNonce / getSiweConfig / verifySiweMessage / consumeWalletNonce / safeUserAudit / hashIdentifierForAudit / consumeFactorAddGrantStmt）→ 標 `env:Env` 零 TS2339 → 不碰 env.d.ts（WL-4）。WALLET_SIWE_* 由 `utils/siwe.ts` 消費、非本 4 檔直讀。
- **cascade-safe 根因（forced tsc ADDED=0 實證）**：
  1. **callee 回傳由自身 signature 決定**：`requireAuth`/`requireStepUp`/`requireFactorAddGrant` 回傳由自身 signature 固定、與 call-site 引數型別無關 → 標 `env:Env`/`request:Request` 不銳化其回傳 → 零新錯。
  2. **D1=any**：`db.prepare().bind().all()/.first()/.batch()` 鏈在本 repo（未裝 `@cloudflare/workers-types`、`node_modules/@cloudflare/` 無此包）解為 `any`（[[feedback_d1database_resolves_any_no_workers_types]]）→ `rs.results`/`row`/`nonceRow`/`batch[].meta`/`ins.meta` 等全 any → 零新錯。
  3. handler-context 標型不影響 `Number()`/`String()`/`JSON.parse`/`new Date()` 等標準用法。
- **dual-leaf 存在但 assignable（關鍵：vs ecpay PR-2db TS2345 陷阱不適用）**：`tests/integration/wallet.test.ts` direct-import 全 4 handler〔`nonceHandler`/`verifyHandler`/`listHandler`/`deleteHandler`〕並 call，**但傳的 `env` = `import { env } from 'cloudflare:test'`（`ProvidedEnv extends Env`，env.d.ts:110-112）、非 partial literal** → 標 `env:Env` 全 assignable（request=`bearer()`→Request、params `{ id: string }`⊆`Record<string,string>`）→ **無 test call-site TS2345**；17 TS7031 functions-leaf only ×1、無 doubling。**第 2 importer（exhaustive 列舉、self-review type-cascade 採納）**：`tests/integration/credential-disposition.test.ts:14` import `onRequestGet as walletList`〔= `wallet.ts`〕、L318 以 `new Request(...)` + cloudflare:test `env` call → 同 assignable、零 TS2345（**全 repo 僅此 2 test 檔 import 本 4 handler、無 functions/src importer**）。**Code Gate 仍重驗 ADDED=0**（WL-6/WL-9），並 diff committed source 確認恰 8 handler-signature 行、無 erased `as`/`import`（byte-identical 無法偵測 erased cast/import、須 diff-fidelity 收口）。

## §4 scout evidence（non-commit spike、已 `git checkout --` 還原、git 零殘留）

- forced `tsc -b tsconfig.solution.json --pretty false --force`（base `ad70ea9b`）→ 4 檔恰 **17×TS7031**（wallet.ts L17/L21、[id].ts L26/L30、nonce.ts L25/L29、verify.ts L36/L40）。
- 套 §2 八 edit → forced full-solution build sort-diff vs 670 baseline：
  - **REMOVED ＝ 恰 17**（`comm -23` 逐行核對 4 檔全部 TS7031）。
  - **ADDED ＝ 0**（`comm -13` count=0；零 cascade，含 4 檔 tests-leaf direct-call）。
  - raw 總數 **670 → 653**、wallet residual 0。
- **byte-identical emit 實證**（canonical `npx esbuild --loader=ts --format=esm`、**非恆真**：base 端 ＝ PR base blob〔未標註〕 vs head 端 ＝ 標註後）：
  - `wallet.ts` **1411B** `sha 4980442d…`
  - `[id].ts` **1660B** `sha 662ca68e…`
  - `nonce.ts` **1661B** `sha 92e432d4…`
  - `verify.ts` **4469B** `sha ab58caad…`
  - 4 檔 base==head `cmp` IDENTICAL → type annotation 全 erase、**零 runtime change**（WL-8）。
- **env:Env single-file 確認**：spike 後 4 檔零 `env.X` TS2339（只 `env.chiyigo_db` + forward）。
- **驗證紀律**：Code 階段重播以 §1 base blobs〔`0e7ce977`/`a5f5a4ec`/`0a112d1f`/`db868d26`〕為 base 端、committed annotated blob 為 head 端（禁 HEAD-vs-HEAD 恆真式）。

## §5 security / 風險（user-facing money-adjacent、first-do-no-harm）

- **`verify.ts`（Tier-0-adjacent）**：SIWE 綁定 = 金流前置；`requireFactorAddGrant`（validate-not-consume）+ grant consume 與 `user_wallets` INSERT 同一 atomic `db.batch`（both-or-neither）+ nonce 一次性消耗 + user_id/address 對齊防換綁 + `wallet.bind.success` **critical** audit。
- **`[id].ts`（Tier-0-adjacent）**：`requireStepUp(ELEVATED_ACCOUNT, 'unbind_wallet')` + 雙欄 (id,user_id) 防越權刪除 + `wallet.unbind` **critical** audit。
- **`wallet.ts`（read-only GET）**：列已綁 wallet。**`nonce.ts`**：SIWE nonce 發行 + 409 防重綁。
- 本 PR ＝ **type-only handler-context 標註**；4 檔 byte-identical emit（§4）→ **零 runtime change** → 上述 SIWE / factor-add grant / atomic batch / nonce 消耗 / step-up / IDOR / critical audit / SQL **完全不動**（WL-5）。
- 零 cascade（ADDED=0 實證）；不引入 any；不碰 env.d.ts（WL-4）。
- **F-3 DORMANT-safe（WL-10）**：4 檔不 import/不 invoke archive/R2/retention/aggregate/checkpoint；`safeUserAudit` 同 refund-request transitive `cold_class` feed〔classifyForCold、migration 0038〕— 但衍生在**未修改**的 user-audit.ts、byte-identical 證呼叫 args 不變 → cold_class provably 相同、dormant code 未改未 invoke。
- **impl L1（8 行 type-only）/ review care L3**（§0.1 OD-1）：wallet money-adjacent 邊界不因 impl=L1 降審查 → 4 道外部 + **L2/L3 multi-agent self-review**。

## §6 verification plan

- **byte-identical**：canonical `esbuild --loader=ts --format=esm`，4 檔各以 §1 base blob〔未標註〕 vs committed annotated blob 比 sha/size/cmp（[[feedback_byte_identical_emit_verification]]；禁 HEAD-vs-HEAD）— scout 已證、Code 階段 commit 後重播。
- **full-solution sort-diff（L6）**：Code 階段重跑 forced `tsc -b … --force`，對 670 baseline sort-diff → 必 **REMOVED 恰 17 / ADDED 0**；ADDED 非空 → 停止並拆棒、回 gate（WL-6）。
- **ratchet**：`npm run typecheck:ratchet` → 期望 current `653 / 277`（errorFiles 58）；baseline 不動（WL-7）。
- **merge-front 7 gates（對齊 CI `.github/workflows/ci.yml`）**：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int`〔含 `wallet.test.ts` 4 handler direct-call〕 · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **staged set**：僅 4 wallet 檔 + 本 plan doc；**禁** `git add -A`，`CLEANUP_PLAN.md` 不進 commit。

## §7 Locks（ChatGPT Arch `APPROVED_WITH_LOCKS`、2026-06-29、binding）

ChatGPT Architecture Gate 裁 **`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 blocker / 0 required revision / 0 major**；架構上可進 Codex Plan Gate、**非 merge 授權、非 code correctness 最終裁決**）。5 問全 APPROVED（8 標註一致 / 4 檔 domain-batch 適當 / Tier-0-adjacent 邊界〔接受前提＝Code Gate diff-fidelity〕/ wallet 域 framing 正確〔`user_wallets` vs `credit_wallets`/billing 分離〕/ WL 足夠+追加 4 條）。

SPEC WL-1..WL-10（§0）+ OD-1/OD-2（§0.1）已鎖。**4 條 ChatGPT code-stage lock（codify、已被本 plan §3/§4/§6 承諾、無 plan 邏輯變更）**：

| Lock | 內容 | plan 對應 |
|---|---|---|
| PR-2dd-L11 diff-fidelity | Code Gate 必確認 committed source diff **僅 8 handler signature annotation**、無第 9 個 source edit | §3/§6 + WL-1/WL-2 |
| PR-2dd-L12 no type escape | 禁新增 `as any` / `unknown as` / `@ts-ignore` / `@ts-expect-error` / runtime cast / erased helper | §3 + WL-4 |
| PR-2dd-L13 no import drift | 禁新增任何 import（**含 type-only**）；`Request`/`Env` 走 ambient/global | §3〔`Env` ambient 零 import〕 |
| PR-2dd-L14 security-line byte lock | `requireStepUp` / `requireFactorAddGrant` / `verifySiweMessage` / `consumeWalletNonce` / `db.batch` / grant replay check / critical audit / IDOR SQL 必 byte-identical | §4/§5 + WL-5/WL-8 |

**Code Gate 重點（ChatGPT 明示）**：唯一要嚴格看的不是演算法、而是「是否真的只有 8 行 handler context 型別」→ **diff-fidelity 收口**（byte-identical 測不到 erased cast/import，須對 committed source 逐行 diff）。

## §8 gate trail（state 隨進度更新）

- [x] `SPEC_APPROVED_WITH_LOCKS`（owner C-1 + ChatGPT 收斂 2026-06-29：wallet 域 4 檔；WL-1..WL-10；OD-1 ＝ L2/L3 multi-agent、OD-2 ＝ domain-batch 單 PR）
- [x] `PLAN_SELF_REVIEW_CLEAN`（L2/L3 multi-agent self-review：3 parallel readonly-reviewer 三維〔plan-faithfulness / type-cascade / security-scope，繼承 Opus 4.8〕→ **0 blocking / 0 major / 0 minor**；3 維各自獨立重驗：plan-faithfulness〔`comm` REMOVED=17 exact / ADDED=0、8 site 逐檔確認〔[id].ts L30 唯一帶 params〕、base blob SHA、WL-9 無 test 改〕、type-cascade〔per-error-code histogram TS7031 215→198 其餘碼全不變·TS2345=0、D1=any 三方靜態〔workers-types 缺席〕+empirical 確認、callee 非銳化〔getCorsHeaders `Pick<Env>` wide→narrow assignable、與 ecpay narrow→full 陷阱反向〕、stream-injected byte-identical 重算〕、security-scope〔4 檔 sed-rebuild **非恆真** byte-identical〔source bytes +64/+96、emit 全等〕、security path 位元未動、F-3 grep clean、`Env` ambient 故 8 標註零 import 無隱藏第 9 edit〕。**2 處 INFO 主線獨立裁決後採納修入 plan**：(1) §0「wallet 域」精確定義〔SIWE user-wallet 4 檔 ＝ wallet17 桶 vs `admin/billing/wallets` credit_wallets/billing 分離域〕避 payments-path 類 drift；(2) §3 dual-leaf exhaustive 補第 2 importer `credential-disposition.test.ts:14`〔主線 grep 證全 repo 僅 2 test 檔 import〕。security 方法論註〔byte-identical 無法測 erased cast/import〕→ Code Gate diff-fidelity 對 committed source 收口〔§3/§6〕。修正後一輪 0 新發現。)
- [x] `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（2026-06-29、**0 blocker / 0 required revision / 0 major**；+4 code-stage lock PR-2dd-L11 diff-fidelity · L12 no type escape · L13 no import drift · L14 security-line byte lock〔§7〕；5 問全 APPROVED；明示**非 merge 授權**）
- [x] `CODEX_PLAN_APPROVED`（2026-06-29、no blocking/required/major；live replay 全重現：HEAD `359a8b14` docs-only、4 wallet blob 仍 ==base、forced tsc 670 base / wallet 17 TS7031、annotated 653 / wallet residual 0 / histogram TS7031 215→198 其餘碼不變 / REMOVED=17 / ADDED=0、`ratchet --report` 653/58/277、4 檔 byte-identical hash 全 match、dual-leaf 2 test importer〔wallet.test + credential-disposition〕`ProvidedEnv extends Env` + workers-types 缺席、simulated source diff 恰 8 handler annotation 無 import/cast/helper drift；Payment Security 無 runtime 變更、明示 Code Gate 仍須 enforce **PR-2dd-L14** byte lock）
- [ ] `CODING_ALLOWED`（**待 owner 明示**；Codex + owner 皆明示 `CODEX_PLAN_APPROVED` ≠ `CODING_ALLOWED` / 非 Code Gate / 非 merge 授權）
- [ ] `CODE_SELF_REVIEW_CLEAN`（L2/L3 multi-agent）
- [ ] `CODEX_CODE_APPROVED`
- [ ] `CHATGPT_CODE_FAITHFULNESS_APPROVED` → `MERGE_ALLOWED`
- [ ] `MERGED_MAIN`（squash-merge --delete-branch；merge-front 重 7 gates 全綠後；更新 topic receipt + MEMORY.md index + 刪 packets）
