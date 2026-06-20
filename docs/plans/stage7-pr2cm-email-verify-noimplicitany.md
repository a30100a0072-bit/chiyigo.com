# Stage 7 reduce PR-2cm — `auth/email/verify.ts` noImplicitAny（單檔 email 驗證 token 核銷 handler，**雙直連 handler** GET+POST，type-only，review care L2）

**目標**：`functions/api/auth/email/verify.ts` 的 **3 個 noImplicitAny error（全 TS7031：`onRequestGet` destructure `request` ×1 ＋ `onRequestPost` destructure `request`/`env` ×2）→ 0**，**純 type-only**（**兩個編輯點**＝兩個 exported handler 的 destructured param annotation；TS erase 後 emit byte-identical）。

**Scope（owner C-1 鎖 2026-06-20；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/email/verify.ts` | 3（L13 `onRequestGet({request})` TS7031 ×1 ＋ L21 `onRequestPost({request,env})` TS7031 ×2） | **2 個編輯點**（`onRequestGet({request})` 簽名 ＋ `onRequestPost({request,env})` 簽名） |

> **主線定位（owner C-1）**：A 域 handler 層續清，**A3 第二棒**。PR-2ch 清 A1 五檔 TOTP-caller handler（#104）→ PR-2ci `2fa/setup.ts`（#105）→ PR-2cj A2 `change-password.ts`+`identity/unbind.ts`（#106）→ PR-2ck A 域 `delete.ts` step-1（#107、**首個 wrapper/worker 雙 function handler 先例**）→ PR-2cl `email/send-verification.ts`（#108 `0c71d03b`、**A3 起手、wrapper/worker、複用 PR-2ck OD-ctx (a)**）。本 PR = **A3 第二棒 `email/verify.ts`**，owner 2026-06-20 C-1 裁 **單檔單獨成棒**。**結構與 PR-2cl 本質不同**：本檔為**雙直連 handler**（`onRequestGet` + `onRequestPost`，param 直接 destructure；**無 wrapper/worker、無 `ctx`、無 try/catch wrapper**），故**非複用 PR-2ck/2cl 的 wrapper-`ctx` OD (a)**，而是套用 repo 主流 direct-handler Convention A（POST）＋ exact-fit partial-context（GET）。**排除**：A3 餘檔（`local/forgot-password.ts`〔含 `waitUntil`＝未來新 OD〕、`local/{login,register}.ts`〔Tier-0 殿後〕）、util `utils/email.ts`、`auth/2fa/verify.ts`（命名陷阱、用 `CfRequest`、非本檔）。

base main `0c71d03b`（接 PR-2cl #108；`git rev-parse HEAD` 實查 = `0c71d03b5a62a5544f9c56adb7f885ce2edc9c21`）。branch `stage7-pr2cm-email-verify-noimplicitany`（自 clean main 開、未 push）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔、2 annotation）/ review care **L2**（auth-adjacent：email 驗證 token 原子核銷 + `email_verified` 寫入 + audit；非 destructive、非 step-up、無限流，較 PR-2cl 低一層風險面但仍涉 token 核銷與帳號狀態寫入）。走**完整 Dual Gate v3.1 四道外部審查、不用 lighter**。
- **self-review = multi-agent workflow（owner C-1 2026-06-20 明示）**：即使 scout / spike 乾淨亦不得降級單 agent（[[feedback_self_review_form_not_downgradable_by_spike]]）。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（不碰 A3 餘檔、不碰 util `email.ts`、不碰 `auth/2fa/verify.ts`、不碰 `CLEANUP_PLAN.md`）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-20：scope = 單檔、2 編輯點修 3 TS7031；self-review 形式 = multi-agent workflow；**OD ruling = POST `{ request: Request; env: Env }`（repo 主流 Convention A、零新 OD）＋ GET exact-fit `{ request: Request }`（既有 partial-context 原則新實例、C-1 裁定可用、不升正式新 OD）**；**禁** GET 用 full `{ request: Request; env: Env }`（`env` unused、違最小揭露）；**禁** 引入 `CfRequest`（本檔無 `request.cf`）；A3 餘檔 + util + `auth/2fa/verify.ts` + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `0c71d03b`）→ 逐檔 error set（恰 3 TS7031）+ caller cascade（0 TS importer）+ 測試覆蓋分層（無 direct/indirect test）+ 結構判定（雙直連 handler、非 wrapper/worker）+ byte-identical 適用性，全對齊裁示（檔錯數 = 3 / 0 TS caller / 無 `.cf` / 無 `waitUntil`）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、`git diff 0c71d03b` 空、blob 回 `ac19a25b`）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow，3 agents 三維 rubric：scope / runtime·security / evidence — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 維度 B，0 blocker / 0 required / 1 NB、7 維 Pass、CL-1..CL-11 — 見 §Gate 進程紀錄）
  - ✅ `CODEX_PLAN_APPROVED`（② 維度 C，0 blocker / 0 required / 1 NB；獨立 replay 全數值重現 — 見 §Gate 進程紀錄）→ ⬜ owner `CODING_ALLOWED`
  - ✅ Code 階段（source `95f5a37a`、full replay @ source 全綠）→ ✅ `CODE_SELF_REVIEW_CLEAN`（multi-agent workflow，3 維 0 findings）→ ✅ `CODEX_CODE_APPROVED`（③ 維度 C，0 blocker / 0 required / 1 NB；含 int 1328 tests pass）
  - ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④ 維度 B）→ ⬜ merge-front 7 gates → ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-20 owner C-1 裁示（pre-SPEC → SPEC）：scope = 單檔、2 annotations 修 3 TS7031；self-review = multi-agent workflow（三維收斂、不擴全域）；**OD ruling**：POST `{ request: Request; env: Env }` = repo-mainstream Convention A 零新 OD；GET exact-fit `{ request: Request }` = 既有 partial-context 原則新實例、本次 C-1 裁定可用、plan 記錄但不升正式新 OD；禁 GET full shape（env unused）；禁 `CfRequest`；禁碰 A3 餘檔 / util / `auth/2fa/verify.ts` / tests / baseline / behavior / opportunistic cleanup。
- 2026-06-20 Claude **scout（read-only @ `0c71d03b`）** → 逐檔 error set（恰 3 TS7031：`(13,38)` `request` ＋ `(21,39)` `request` ＋ `(21,48)` `env`）+ caller cascade（**0 TS importer**：全 repo grep `from '…email/verify'`/`import('…email/verify')` 0 命中；`email/verify` 字面命中皆 runtime `fetch('/api/auth/email/verify')`〔`src/js/verify-email.ts:53`〕/ i18n 文件字串 / baseline·plan docs）+ coverage 分層（handler 無 direct/indirect test；`tests/` 內無 import/fetch 本 handler）+ 結構判定（**雙直連 handler** `onRequestGet`+`onRequestPost`、無 wrapper/worker、無 `ctx`）+ 無 `.cf`、無 `waitUntil`，全對齊 owner 裁示 → 0 矛盾、不觸發 stop-rule（唯 OD 形態回報 C-1 裁、已裁）。
- 2026-06-20 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（solution 821→818、sort-diff REMOVED=3/ADDED=0、tests-leaf 0→0、byte-identical 1575B sha `1bad1bfd…` 兩端一致、ratchet:report 818/83/251）。
- 2026-06-20 **multi-agent workflow self-review（維度 A，3 agents converged 三維：scope / runtime·security / evidence；run `wf_d7cf0be3-18a`，3 agents / ~219k subagent tokens / 55 tool uses）→ `PLAN_SELF_REVIEW_CLEAN`**：3 維 finder **全 verdict=clean**（rawFindings nit-only：scope **1**〔§precedent 路徑 `account/change-password.ts`→精確化 `auth/account/change-password.ts`，非 scope/edit/exclusion 標的〕、runtime·security **2**〔皆 reinforcing observation：finder 於 `/tmp` repo 外獨立重生 patched copy 復現 byte-identical **1575B** sha `1bad1bfd…` `diff -q` IDENTICAL；GET token-不核銷 anti-prefetch invariant byte-identically 保留〕、evidence **0**；**0 blocker/high/medium、0 confirmedReal defect**）。主線**獨立讀 plan 對抗式裁決（非採 raw 輸出）**：scope（單檔 2 簽名、frozen diff +2/−2、A3 餘檔+util+`auth/2fa/verify.ts`+`CLEANUP_PLAN.md`+baseline 排除鎖、OD ruling 跨 9 段一致、line/path 正確）✓、runtime·security（2 annotation 純 type-position、byte-identical sha 兩端一致證 runtime 不變、GET redirect/POST body/原子核銷/`hashToken`/`UPDATE users`/`safeUserAudit`/response 全在 diff 行外、無 `.cf`/無 `waitUntil`、GET body 不引用 env 證 request-only 正確）✓、evidence（exact-error 3 行 coords `(13,38)`/`(21,39)`/`(21,48)` 正確、ratchet 821→818·84→83·250→251 算術自洽、byte-identical 1575B/`1bad1bfd…` base 側 finder 獨立重現、coverage 誠實不 overclaim、PR-2cl stale 值 `824`/`3398`/`b1765521`/`61a0d6ce`/`1b03a131`/errorFiles 85/cleanFiles 249 反向 grep 皆 0 hit）✓。**唯一 actionable nit（§precedent 路徑精確化）已修並就地 `ls` 驗證 corrected paths 存在 → 收斂**。**review agents 未污染 git**（主線獨立驗：post-review `git status` 僅 2 untracked〔`CLEANUP_PLAN.md` + 本 plan doc〕、staged 空、`git diff 0c71d03b -- functions/` 空、verify.ts blob 回 `ac19a25b`）→ PR-2ck stray-checkout 未復發。
- 2026-06-20 **plan doc commit `61467e5c`**（branch `stage7-pr2cm-email-verify-noimplicitany`、local、未 push、plan-only +270 / 0 source）→ 中文報告 6 欄 → owner **C-2/C-3** 裁示產自足 **ChatGPT Arch packet**（`chiyigo-pr2cm-arch-packet.md`，repo 外 Desktop，482 行：reviewer instructions + C-1/C-2 ruling + plan 原文 + 附錄 A〔base source @ 0c71d03b〕/ B〔依賴簽名 `res`·`hashToken`·`safeUserAudit`〔env 形參 untyped→0 cascade 鐵證〕·`Env` ambient·OD precedent〕/ C〔[[memory]] glossary〕），全文貼入對話送外部 ①。
- 2026-06-20 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 blocker / 0 required revision / 1 NB**）— 7 維全 **PASS**：Scope（單檔 2 edit point 修 3 TS7031、隔離 A3/util/`auth/2fa/verify.ts`/baseline/tsconfig/tests）/ OD-ctx（POST direct-handler Convention A；GET request-only 為 C-1 裁定 partial-context 原則新實例、不升正式 OD；排除 `CfRequest`/`EventContext`/workers-types 合理）/ Runtime neutrality（frozen diff 純 type-position；esbuild stdin type-strip base/patched **1575B** sha `1bad1bfd…` 相同足證 byte-identical）/ Security（GET redirect·POST JSON parse·token guard·原子核銷 SQL·`UPDATE users`·`safeUserAudit`·response/error code 全列鎖定區、不在 2 行 diff 內）/ Evidence（821→818·REMOVED=3/ADDED=0·tests-leaf 0→0·ratchet 818/83/251·byte-identical 數值互洽、與 scope 相符）/ Coverage honesty（承認 handler 無 direct/indirect test、只宣稱 byte-identical）/ Isolation（A3 餘檔·`utils/email.ts`·`auth/2fa/verify.ts`·`CLEANUP_PLAN.md`·baseline/ratchet·`env.d.ts`·tsconfig 全鎖）。
  - **NB-1（非阻擋，coverage/future work）**：本 handler runtime 分支仍無 direct test；本 PR 可因 byte-identical 通過，但**不得把這次通過解讀成 email verify 行為已有測試覆蓋**；後續若補 coverage 應**獨立 PR、不併本刀**。
  - **Binding locks CL-1..CL-11（ChatGPT Arch；② Codex Plan 與 Code 階段須保留）**：CL-1 僅改 `verify.ts`；CL-2 僅兩處 handler param annotation；CL-3 GET 必 `({ request }: { request: Request })`、**禁加 env**；CL-4 POST 必 `({ request, env }: { request: Request; env: Env })`；CL-5 禁 `CfRequest`/`EventContext`/`@cloudflare/workers-types`/任何新 import·package；CL-6 runtime lock（GET redirect·POST body parse·token guard·SQL·`hashToken`·`UPDATE users`·`safeUserAudit`·response/error code 不改）；CL-7 禁相鄰 cleanup（格式·JSDoc·return type·相鄰 noImplicitAny）；CL-8 exclusion（A3 餘檔·`utils/email.ts`·`auth/2fa/verify.ts`·tests·`env.d.ts`·tsconfig·baseline/ratchet·`CLEANUP_PLAN.md`）；CL-9 evidence replay（Code **不沿用 spike**、source commit 後重跑 forced typecheck delta·ratchet report·tests-leaf·byte-identical·`git diff --check`·numstat）；CL-10 coverage wording（只稱 byte-identical runtime neutrality、不稱 handler direct/indirect test covered）；CL-11 gate control（① 後僅可進 ②；source coding 待 ② 通過 + owner 明示 `CODING_ALLOWED`）。
  - **可送 ② Codex Plan Gate；非 coding 授權，待 ② 通過 + owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-20 **Codex Plan Gate（② 維度 C）：`CODEX_PLAN_APPROVED`**（**0 blocker / 0 required revision / 1 NB**；獨立 replay 重現全數值）— 機械重驗全通過：base **821**（恰 3 verify.ts TS7031）→ patched **818**（REMOVED 3 / ADDED 0）、tests-leaf base 0 → patched 0、ratchet **818 / 83 errorFiles / 251 cleanFiles / 334 sources**、patched blob `2b7300bd…`、numstat **2/2**、`git diff --check` clean、emit **1575B** sha `1bad1bfd…` byte-identical、coverage/import hits **0** / tests handler hits **0** / `.cf` hits **0**、排除檔與 baseline/ratchet 設定未動、**branch state 還原**（HEAD `7c002689`、僅 plan 與 base 差、source blob `ac19a25b`、status 僅 `?? CLEANUP_PLAN.md`）。Critical Risk **None**（auth-adjacent runtime 受 2-edit frozen diff + byte-identical 保護）；State Consistency / Queue / Payment / Distributed State / Observability 皆 **N/A**（無 SQL / token 核銷 / user-state / audit / transaction / response 行為改動；logging 與 `safeUserAudit` byte-identical）。CL-1..CL-11 完整保留（含 Code 階段須 source commit 後重跑證據、不沿用 spike；coverage 只稱 byte-identical）。**NB-1（非阻擋）**：handler 仍無 direct/indirect runtime test、正確記為 future work、未宣稱覆蓋。**Plan Gate（① ChatGPT Arch + ② Codex Plan）雙道全通過 = plan 批准；仍非 coding 授權**（Codex 明示：不授權 coding/commit/push/PR/baseline/release，待 owner 明示 `CODING_ALLOWED`）。
- 2026-06-20 **owner `CODING_ALLOWED` ✅** → 進 Code 階段。
- 2026-06-20 **Code 階段（source commit `95f5a37a`）**：落地唯二 2 編輯點（`onRequestGet({ request }: { request: Request })` ＋ `onRequestPost({ request, env }: { request: Request; env: Env }`)），`git diff 0c71d03b..95f5a37a -- functions/` = `verify.ts` **+2/−2**、blob `ac19a25b→2b7300bd`、numstat **2 2**。**full replay gates 全綠（@ source、不沿用 spike）**：byte-identical（canonical `esbuild --loader=ts --format=esm`，base `0c71d03b` via `git show` vs working==committed）兩端 **1575B** sha `1bad1bfd…`、stderr 0、`diff -q` IDENTICAL · forced solution sort-diff（暫還原 base verify.ts 量測 base **821** → restore HEAD）**REMOVED=3 / ADDED=0**、head **818** · tests-leaf **0→0** · ratchet `--report` **818/83/251/334**、enforce〔`RATCHET_BASE_REF=0c71d03b`〕**OK**（baseline 1119/175、current 818/251）· `git diff --check` clean · **lint green**（eslint + compat-date + workflows）· **build:functions**「Compiled Worker successfully」。**NB-2 雙證齊**（source diff 逐行 annotation + byte-identical receipt，不以 ratchet 數字單獨代表 runtime 不變）。
- 2026-06-20 **Code self-review = multi-agent workflow（維度 A，3 agents 三維：diff-fidelity / runtime·security / evidence；run `wf_3c7644cf-748`，3 agents / ~203k subagent tokens / 51 tool uses）→ `CODE_SELF_REVIEW_CLEAN`**：3 維 finder **全 verdict=clean、0 findings**（連 nit 皆無）。主線**獨立讀真碼裁決**：diff-fidelity（committed diff 恰 2 annotation、+2/−2、blob `2b7300bd`、word-diff 證僅加 `}: { request: Request`〔GET〕/`}: { request: Request; env: Env`〔POST〕、GET 無 env、net `0c71d03b..95f5a37a` = plan doc + verify.ts、無 staged 污染）✓、runtime·security（兩 committed blob `ac19a25b`/`2b7300bd` 經 esbuild emit 皆 **1575B** sha `1bad1bfd…` = runtime 不變硬證、hot-zone〔GET redirect·POST body·原子核銷·`hashToken`·`UPDATE users`·`safeUserAudit`·response/error code〕全在 diff 行外、無 `.cf`/無 `waitUntil`、env 僅 POST 用）✓、evidence（ratchet 818/83/251 + enforce OK、verify.ts 0 殘留、base 821 transitive〔verify.ts 唯一 compiled-source delta + 0-importer entry〕、REMOVED=3/ADDED=0、tests-leaf 0、coverage 誠實〔0 importer / 0 test、僅宣稱 byte-identical〕、PR-2cl stale 值反向 grep 0 hit、current 值 821/818/1575/`1bad1bfd`/`ac19a25b`/`2b7300bd` 皆在）✓ → **一輪 0 新發現**。**review agents 未污染主 repo**（主線獨立驗：working tree 僅 `?? CLEANUP_PLAN.md`、HEAD `95f5a37a`、verify.ts blob `2b7300bd`、staged 空、working diff 空；evidence finder 自建 `/tmp/wt-base` worktree 已自清；另兩個 `/tmp/chiyigo-review-item*` worktree 為 parallel-session 既有、非本任務、唯讀不動）→ PR-2ck stray-checkout 未復發。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；不得 merge 除非 owner 明示 `MERGE_ALLOWED`。**
- 2026-06-20 **Codex Code Gate（③ 維度 C）：`CODEX_CODE_APPROVED`**（**0 blocker / 0 required revision / 1 NB**）— 機械重驗 committed code（reviewed HEAD `cd6d16d3`、source commit `95f5a37a`）全通過：source scope 僅 verify.ts **+2/−2**、blob `ac19a25b→2b7300bd`、CL-1..CL-11 保留；獨立 evidence：solution **821→818**（REMOVED 3 / ADDED 0）、tests typecheck base/head 皆 0、ratchet **818 / 83 errorFiles / 251 cleanFiles / 334 total** enforce OK、emit 兩端 **1575B** sha `1bad1bfd…` IDENTICAL、**lint + build:functions pass**、**int 75 files / 1328 tests pass**、full `git diff --check` clean、index 空、status 僅 `?? CLEANUP_PLAN.md`；無 `.cf`/`waitUntil`/handler importer/排除檔/baseline/test/config/env 改動。Critical Risk **None**（committed diff = frozen 2-annotation、emit byte-identical）；State Consistency / Queue / Payment / Distributed State **N/A**（token 核銷·SQL·user update·audit·response 路徑不變）；Observability **No change**（`safeUserAudit` + 既有診斷 byte-identical）。**NB-1（非阻擋）**：handler 仍無 direct/indirect runtime test；1328 int 為 breadth regression、runtime neutrality 靠 byte-identical emit 證明。**非 merge 授權**：④ ChatGPT Faithfulness + merge-front gates 仍必走，未 push/PR/merge/baseline/`MERGE_ALLOWED`。
- （後續 dated 收錄：④ ChatGPT Faithfulness → merge-front 7 gates → `MERGE_ALLOWED` → squash → main CI / deploy → SHIPPED memory）

## owner 鎖定表（C-1 ruling，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 僅 `functions/api/auth/email/verify.ts` 單檔 |
| L2 Edit Point | **兩個**：`onRequestGet({request})` 簽名 ＋ `onRequestPost({request,env})` 簽名；其餘零改動 |
| L3 Type-only | emitted JS 必 byte-identical |
| L4 OD shape | GET = exact-fit `{ request: Request }`（partial-context、無 env）；POST = `{ request: Request; env: Env }`；**禁** GET full shape（env unused、違最小揭露）；**禁** `CfRequest`（本檔無 `request.cf`）|
| L5 Exclusion | 不碰 A3 餘檔（`local/forgot-password.ts`、`local/{login,register}.ts`）、util `utils/email.ts`、`auth/2fa/verify.ts`、tests、`env.d.ts`、tsconfig、baseline、`CLEANUP_PLAN.md` |
| L6 Security Hot Zone（auth-adjacent） | 不得改 GET redirect 流程（`new URL('/verify-email.html', url.origin)` + 302、token 不核銷）、POST body 解析（`request.json()` + `INVALID_JSON`/`TOKEN_REQUIRED` guard）、**原子核銷** `UPDATE email_verifications SET used_at … WHERE token_hash=? AND token_type='verify_email' AND used_at IS NULL AND expires_at>… RETURNING user_id`、`hashToken`、`UPDATE users SET email_verified=1`、`safeUserAudit(env,{event_type:'account.email.verify',…})`、response body / error code |
| L7 Env | 不改 `types/env.d.ts`、不新增 env key |
| L8 Tests | 不為過 PR 改 tests；只跑既有 tests |
| L9 Evidence | plan + code 階段都重跑 ratchet / sort-diff / byte-identical / tests-leaf |
| L10 Coverage | 逐 sub-path 下鑽；handler 無 direct test → 僅宣稱 byte-identical，未覆蓋分支明載、不 overclaim |
| L11 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / coverage overclaim / 新 OD 超出 C-1 裁定 → 退回 `PLAN_DRAFT` |

## ⚠ verify.ts 熱區聲明（review care L2，auth-adjacent）

`auth/email/verify.ts` 為 **email 驗證 token 核銷**（GET 向後相容 redirect 不核銷；POST 原子核銷 token + 寫 `email_verified=1` + audit）。修法若非純型別、或牽動下列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L6）：

| 區塊 | 紅線（typing 全程不得牽動） |
|---|---|
| GET redirect | `new URL('/verify-email.html', url.origin)` + `searchParams.set('token', token)` + `Response.redirect(target.href, 302)`；**token 不核銷**（防郵件代理 / 預載提前消耗）|
| POST body | `await request.json()`（try/catch → `INVALID_JSON` 400）+ `body?.token ?? ''` + `typeof token !== 'string'` guard（→ `TOKEN_REQUIRED` 400）|
| 原子核銷 | `UPDATE email_verifications SET used_at = datetime('now') WHERE token_hash=? AND token_type='verify_email' AND used_at IS NULL AND expires_at > datetime('now') RETURNING user_id`（單語句原子防重放；`hashToken(token)` SHA-256）|
| 帳號寫入 | `UPDATE users SET email_verified = 1 WHERE id = ?`（`row.user_id`）|
| Audit | `await safeUserAudit(env, { event_type: 'account.email.verify', user_id: row.user_id, request })`（await、不改 fire-and-forget）|
| 回應 | response body（成功 `Email verified successfully` / error code：`INVALID_JSON` / `TOKEN_REQUIRED` / `TOKEN_INVALID_OR_EXPIRED`）|

註：本刀只在 2 個 exported handler 簽名加型別標註，TS erase 後 runtime byte-identical（SQL / 常數 / audit·log / 字串 / 註解不變）。

### Coding 階段硬性邊界

- **允許**：`onRequestGet({ request })` 加 `: { request: Request }`；`onRequestPost({ request, env })` 加 `: { request: Request; env: Env }`。
- **禁止**：改任何 SQL / GET redirect 流程 / POST body 解析 / 原子核銷條件與順序 / `hashToken` / `UPDATE users` / `safeUserAudit` / response body·error code / caller / tests / util `email.ts` / `auth/2fa/verify.ts` / `tsconfig`·`eslint`·`vitest` / `env.d.ts` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext` / 用 `CfRequest` / 加 `@cloudflare/workers-types` / GET 標 full `{request,env}` shape / **碰 A3 餘檔** / 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `0c71d03b`）

### exact errors（forced `tsc -b tsconfig.solution.json --force`，solution total 821）

```
functions/api/auth/email/verify.ts(13,38): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/email/verify.ts(21,39): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/email/verify.ts(21,48): error TS7031: Binding element 'env' implicitly has an 'any' type.
```

恰 **3 個，全 TS7031**：`onRequestGet` destructure 的 `request`（L13）＋ `onRequestPost` destructure 的 `request`/`env`（L21）。**無 TS7006**（與 PR-2cl wrapper-`ctx` 不同 — 本檔兩 handler 皆 param 直接 destructure）。檔內無其他碼。

> ⚠ 命名陷阱：用 `CfRequest` 的是 **`auth/2fa/verify.ts`（不同檔）**，因其讀 `request.cf`。本檔 `auth/email/verify.ts` **無 `request.cf`** → plain `Request`、**禁引入 `CfRequest`**（owner L4）。

### 依賴邊界（caller cascade）

`verify.ts` 是 Pages file-routing entry，cascade 面：

| 面 | 判定 | 證據 |
|---|---|---|
| `onRequestGet` / `onRequestPost` 外部 TS caller | **0** | 全 repo grep `from '…email/verify'` / `import('…email/verify')` **0 命中**（background 任務確認 `NONE`）；`email/verify` 字面命中＝runtime `fetch('/api/auth/email/verify')`〔`src/js/verify-email.ts:53` + build artifact `public/js/verify-email.js`〕/ i18n 文件字串〔`case-platform.json`〕/ baseline·plan docs — **無一為型別 import** |
| intra-file env / request 存取 | 全相容 | GET：僅 `request.url`（→ `new URL` → `Response.redirect`）；POST：`request.json()`（WebWorker lib → `any` body，無 cascade）+ `env.chiyigo_db`（D1Database→any，[[feedback_d1database_resolves_any_no_workers_types]]）+ `safeUserAudit(env, …)`（full `Env` assignable）；**無 `.cf`、無 `waitUntil`** |
| tests-leaf | **0 接觸** | 無 test import / fetch 本 handler（見 §測試影響面）|

**precedent landscape（佐證 OD ruling）**：
- **POST `{ request: Request; env: Env }` 直連 handler**＝repo 主流 Convention A：grep `export async function onRequest*({…}: {…})` 命中數十檔已清（含同域已 SHIPPED 的 `auth/2fa/setup.ts` #105、`auth/account/change-password.ts`·`auth/identity/unbind.ts` #106，及 `auth/userinfo.ts`/`auth/step-up.ts`/`auth/me.ts`/`auth/elevation/*` 等；路徑相對 `functions/api/`）→ **零新 OD**。
- **GET `{ request: Request }`（request-only、無 env）**＝此 shape 字串全 repo **0 現存**（grep `: { request: Request }` `No matches`），但「只標 destructure 子集」之 partial-context 原則**已有先例**：`functions/api/portfolio.ts:1` 與 `functions/.well-known/jwks.json.ts:29` 用 `{ env }: { env: Env }`（env-only、無 request）→ GET request-only 為**同原則新實例**，**owner C-1 裁定可用、不升正式新 OD**（L4）。

### 型別選型（owner C-1 OD ruling）

允許落地的唯一 source diff（兩處編輯點）：

```ts
export async function onRequestGet({ request }: { request: Request }) {                  // L13
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {   // L21
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| POST `{ request, env }` | **`{ request: Request; env: Env }`（Convention A）** | repo 主流直連-handler 先例（數十檔）；`safeUserAudit(env, …)` 收 full `Env`（structural assignable）+ `env.chiyigo_db`；spike ADDED=0 證零 cascade |
| POST `request` | **`Request`（plain）** | `request.json()`（WebWorker lib → `any` body）+ `safeUserAudit(…, {request})`；**無 `.cf`** → 非 `CfRequest` |
| GET `request` | **exact-fit `{ request: Request }`（partial-context、無 env）** | GET 只用 `request.url`，**不用 env**；標 full shape 會引入 unused `env`、違最小揭露（owner 禁方案 b）；貼合 `portfolio.ts`/`jwks.json.ts` 的 `{ env }: { env: Env }` partial-context 先例 |
| OD 形態 | **POST 零新 OD；GET partial-context 新實例（C-1 裁定可用、不升正式 OD）** | 結構為雙直連 handler、非 wrapper/worker，故不複用 PR-2ck/2cl 的 wrapper-`ctx` OD (a)；改套 direct-handler Convention A + exact-fit partial-context |
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 3 錯 |

## Spike 實證（full-solution，本地未 commit，2026-06-20，已 revert clean）

**程序**：建 branch（自 clean main `0c71d03b`）→ 量 base（solution 821 / tests-leaf 0 / base emit 1575B）→ 套 2 編輯點（Edit）→ forced `tsc -b tsconfig.solution.json --force`（含 functions / tests / scripts / browser-typecheck 全 leaf，sorted error set diff）→ forced `tsc -b tsconfig.tests.json --force`（tests-leaf）→ canonical byte-identical（esbuild stdin）→ canonical `--report` → frozen diff + `git diff --check` → `git checkout --` revert → 驗 clean（`git diff 0c71d03b` 空、blob 回 `ac19a25b`、staged 空）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| verify.ts errors 3 → 0 | ✅ sort-diff REMOVED = 恰 3 行（`(13,38)`/`(21,39)`/`(21,48)` TS7031）；patched 0 殘留 |
| solution errorCount 821 → 818（恰 −3） | ✅ forced tsc solution **818**；sort-diff ADDED = **空（0）** |
| zero cascade（functions + tests + scripts + browser，全 solution） | ✅ solution sort-diff **REMOVED=3 / ADDED=0**；另 `tsc -b tsconfig.tests.json --force` **base 0 → patched 0**（tests ADDED=0）|
| canonical `--report`（patched） | ✅ errorCount **818** / errorFiles **83** / cleanFiles **251** / sourceFilesTotal 334 |
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`**，[[feedback_byte_identical_emit_verification]]） | ✅ esbuild **stdin** type-strip base(`0c71d03b` via `git show`) vs patched(working-tree) **IDENTICAL**、皆 **1575B**、esbuild stderr 空：<br>sha256 兩端 `1bad1bfd6b6c6869f2952bc067667975b4b0a386945b376e94ba6a1a190743fe` |
| `git diff --check`（source） | ✅ exit 0（無 trailing whitespace / lone space）|
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、`git diff 0c71d03b -- verify.ts` **空**、`git diff --cached` 空、blob 回 `ac19a25b` |

**byte-identical 適用性**：verify.ts 3 imports（crypto / auth / user-audit）→ esbuild stdin transform **適用**（單檔 transform、import 行原樣保留；非完整 bundle，但 type-only annotation PR 這正是對的證明面）。⚠ 用 **stdin**（`<` / pipe），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell，[[feedback_byte_identical_emit_verification]]）；本 spike emit 1575B 非空、已排除該坑。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/email/verify.ts b/functions/api/auth/email/verify.ts
index ac19a25b..2b7300bd 100644
--- a/functions/api/auth/email/verify.ts
+++ b/functions/api/auth/email/verify.ts
@@ -10,7 +10,7 @@ import { hashToken } from '../../../utils/crypto'
 import { res } from '../../../utils/auth'
 import { safeUserAudit } from '../../../utils/user-audit'

-export async function onRequestGet({ request }) {
+export async function onRequestGet({ request }: { request: Request }) {
   const url   = new URL(request.url)
   const token = url.searchParams.get('token') ?? ''
   const target = new URL('/verify-email.html', url.origin)
@@ -18,7 +18,7 @@ export async function onRequestGet({ request }) {
   return Response.redirect(target.href, 302)
 }

-export async function onRequestPost({ request, env }) {
+export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
   let body
   try { body = await request.json() }
   catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }
```

`git diff --stat`：1 file changed, 2 insertions(+), 2 deletions(-)；`git diff --numstat`：`2  2`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `0c71d03b` `--report`：errorCount **821** / errorFiles **84** / cleanFiles **250** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **821 → 818**（−3）、errorFiles **84 → 83**、cleanFiles **250 → 251**（spike 實測值、非預測；verify.ts 全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 818」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 2 個 exported handler 簽名型別標註，TS erase 後 runtime byte-identical（§Spike sha `1bad1bfd…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 821、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。

## 測試影響面（覆蓋誠實，L10 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf base 0 → patched 0、ADDED=0 實證）。
- **覆蓋分層（誠實，逐 sub-path 下鑽）**：

| 標的 | direct test | indirect | 真打路徑 | 硬保證 |
|---|---|---|---|---|
| `email/verify.ts`（handler，GET+POST） | ❌ **無** | ❌ **無** | — | **byte-identical 為唯一硬保證** |
| `email_verifications` 表 migration `0007` | ✅ 有（`tests/integration/migrations.test.ts`） | — | — | （out-of-scope，測表 schema、非本 handler）|

- **下鑽證據（不 overclaim）**：
  - 全 repo grep `from '…email/verify'` / `import('…email/verify')` → **0 命中**本 handler module（命中皆 runtime fetch 字串 / i18n / docs）。
  - `tests/` 內 grep `email/verify` → **0 命中本 handler**；`email.test.ts` 測 util `email`、`oauth-bind-email.test.ts` 測 `oauth/bind-email`（異檔）、`migrations.test.ts` 測 `email_verifications` 表 SQL → 無任何 test fetch `POST/GET /api/auth/email/verify` 或 import 本 handler。
  - **未覆蓋分支明載**：handler 全部 runtime 分支（GET redirect-with-token / redirect-no-token；POST invalid-JSON / token-required / token-invalid-or-expired / 成功核銷 + `email_verified=1` + audit）**皆無 direct test 斷言**；本 PR type-only 不改 tests（L8），這些分支的不變保護 = byte-identical emit（sha 兩端一致）。
- 與 PR-2ci `setup` / PR-2cj `unbind` / PR-2ck `delete` / PR-2cl `send-verification`（皆無 direct test）同策略：缺 coverage 的 handler **僅以 byte-identical 為硬保證、不宣稱 runtime coverage**。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`（或用 `--force`）。**PowerShell 用 `$env:RATCHET_BASE_REF='0c71d03b'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection）。

- `$env:RATCHET_BASE_REF='0c71d03b'; npm run typecheck:ratchet` green（821→818 / 84→83 / 250→251）。
- filtered forced tsc：verify.ts 0 殘留 + solution sort-diff **REMOVED=3 / ADDED=0** + `tsc -b tsconfig.tests.json --force` exit 0（base 0 → patched 0）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**（PowerShell 5.1 不支援 `<` stdin redirection；ratchet 段用 PowerShell `$env:` 見上注）：

```bash
git show 0c71d03b:functions/api/auth/email/verify.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/v-base.js 2>/tmp/v-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/email/verify.ts > /tmp/v-head.js 2>/tmp/v-head.err
wc -c /tmp/v-base.js /tmp/v-head.js        # 期望 1575 兩端
sha256sum /tmp/v-base.js /tmp/v-head.js     # 期望 1bad1bfd… 兩端
cat /tmp/v-base.err /tmp/v-head.err          # 期望空（stderr 0 bytes）
diff -q /tmp/v-base.js /tmp/v-head.js         # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show 0c71d03b:` 讀未改 base。spike 本地實證：兩端 **1575B / `1bad1bfd…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 2 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量）、`npm run build:functions` green。
- targeted int：**無 handler direct test**（0 coverage）→ 不跑 targeted；跑全量 `test:int` 確認無跨檔破壞（**不宣稱涵蓋 verify.ts**）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +2/−2、`git diff` 2 處皆 exported handler 簽名 annotation）；超出 = scope creep = Gate fail。

## Merge SOP（process lock，順序不得寫反；[[feedback_pre_merge_gate_checklist_match_ci]]）

① faithfulness ✅ → ② **先**跑齊 merge 前 local gates 全綠（`lint`·`typecheck:ratchet`〔Git Bash `RATCHET_BASE_REF=0c71d03b` 或 PowerShell `$env:`〕·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit --omit=dev --audit-level=high`）→ ③ 全綠後 owner 明示 `MERGE_ALLOWED` → ④ push branch + 開 PR + `gh pr merge --squash --delete-branch`（禁直推 main）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 memory receipt（SHIPPED 才寫：topic PR-2cm 段 + MEMORY.md index 數字 821→818）。

## Diff hygiene

- 不碰 `CLEANUP_PLAN.md`（untracked、Stage 7 完工才清）；**不碰 A3 餘檔、util `email.ts`、`auth/2fa/verify.ts`**；baseline 不 `--update`；挑檔 add（1 source + 本 plan doc）禁 `git add .`/`-A`；feature branch `stage7-pr2cm-email-verify-noimplicitany` 禁直推 main；平行 session 唯讀優先、動 git 前先 `git status`。
- **commit 前後核 `git diff --cached --name-status` + net source diff**（[[feedback_commit_verify_staged_set_and_net_source_diff]]；PR-2ck self-review Explore agent stray `git checkout` 污染 index 教訓 — self-review workflow agent 具 Bash、可改 git state）。
- **CRLF**：spike 實證 `git diff --numstat` = `2  2`（`.gitattributes` `* text=auto eol=lf` 已根治，[[feedback_windows_build_crlf_churn]]、無 whole-file churn）；code 階段 commit 前再驗 `numstat` `2 2`。

---

## 附：owner C-1 鎖定表（faithful 收錄）

### 風險表

| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| GET `{ request: Request }` 是 repo 首次 exact shape | 中 | 可能被誤判為新 OD | C-1 明示裁定：屬 partial-context 既有原則新實例，plan 需記錄但不展開成正式 OD |
| GET 多標 `env` | 中 | 增加 unused/context overexposure、違反最小揭露 | 禁用方案 (b)；GET 僅標 `{ request: Request }` |
| POST handler 涉 email verify | 中 | 型別修補不可改 runtime 行為 | 必做 byte-identical / bundle hash / diff 最小化（spike sha `1bad1bfd…` 兩端一致）|
| 無 direct/indirect test | 中 | 不能宣稱 runtime coverage | Plan/Report 僅能宣稱 type-only + byte-identical 保證，不得 overclaim 測試覆蓋 |
| `auth/2fa/verify.ts` 命名混淆 | 低 | 可能誤套 `CfRequest` | 明確鎖定 `auth/email/verify.ts`，不得引入 `CfRequest` |

### 防禦表

| 機制 | 處理否 | 實作 | 未處理因 |
|---|---|---|---|
| RateLimit | 否 | 不改現有邏輯（本 handler 無限流）| 本刀純 noImplicitAny type-only |
| 權限 | 否 | 不改現有驗證流程（GET public redirect、POST token-based 核銷）| scope 外 |
| Input | 否 | 不改 `request.json()` / query parsing / token guard | scope 外 |
| XSS | 否 | 不涉 HTML output | 無關 |
| Log / Audit | 是 | 保持既有 `safeUserAudit` await 行為 | 不新增 |
| Retry | 否 | 不涉外部 retry | scope 外 |
| 備援 | 否 | 不涉 infra | scope 外 |
| 監控 | 否 | 不改觀測（ratchet 821→818 明列）| scope 外 |
| Type boundary | 是 | GET exact-fit `{ request: Request }`；POST `{ request: Request; env: Env }` | 本刀核心 |

### DB 鎖定

| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Schema | 不改 `email_verifications` / `users` |
| Atomic | 禁改 `UPDATE email_verifications … RETURNING user_id`（原子核銷防重放）條件與順序、`UPDATE users SET email_verified=1` |

### 隔離區 / 鎖定區

- **隔離區**：A3 餘檔（`local/forgot-password.ts`、`local/{login,register}.ts`）、util `functions/utils/email.ts`、`auth/2fa/verify.ts`、`CLEANUP_PLAN.md`、baseline/ratchet override **全部不得碰**。
- **鎖定區**：所有 runtime（GET redirect 流程 / POST body 解析·token guard / 原子核銷 / `hashToken` / `UPDATE users` / `safeUserAudit` / response body·error code）；return type / JSDoc / 註解 / 格式。
