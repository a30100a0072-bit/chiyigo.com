# Stage 7 reduce PR-2cl — `auth/email/send-verification.ts` noImplicitAny（單檔 email 驗證信寄送 handler，wrapper/worker 雙 function，type-only，review care L2）

**目標**：`functions/api/auth/email/send-verification.ts` 的 **3 個 noImplicitAny error（TS7006 `ctx` ×1 ＋ TS7031 `request`/`env` ×2）→ 0**，**純 type-only**（**兩個編輯點**＝`onRequestPost` wrapper 簽名 ＋ 內層 `handle` worker destructure；TS erase 後 emit byte-identical）。

**Scope（owner C-1 鎖 2026-06-20；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/email/send-verification.ts` | 3（L25 wrapper `ctx` TS7006 ×1 ＋ L34 worker destructure TS7031 ×2） | **2 個編輯點**（`onRequestPost(ctx)` 簽名 ＋ `handle({request,env})` 簽名） |

> **主線定位（owner C-1）**：A 域 handler 層續清，**A3 起手**。PR-2ch 清 A1 五檔 TOTP-caller handler（#104）→ PR-2ci `2fa/setup.ts`（#105）→ PR-2cj A2 `change-password.ts`+`identity/unbind.ts`（#106）→ PR-2ck A 域 `delete.ts` step-1（#107 `d8153850`、**首個 wrapper/worker 雙 function handler 先例**）。本 PR = **A3 第一棒 `email/send-verification.ts`**，owner 2026-06-20 裁 **單檔單獨成棒**：與 `delete.ts` **同構 wrapper/worker**（`onRequestPost(ctx)` + `handle({request,env})`），**直接複用 PR-2ck 已設立並經 ChatGPT Arch affirm 的 OD-ctx (a) 先例、零新 OD**。**排除**：A3 餘檔（`email/verify.ts`、`local/forgot-password.ts`、`local/{login,register}.ts`〔Tier-0 殿後〕）、util `utils/email.ts`（`sendVerificationEmail`，非本檔）。

base main `d8153850`（接 PR-2ck #107；`git rev-parse HEAD` 實查 = `d8153850518e7a0b8c11001e3aece0f6f4946685`）。branch `stage7-pr2cl-send-verification-noimplicitany`（自 clean main 開、未 push）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔）/ review care **L2**（auth-adjacent：`requireAuth`-gated email 驗證 token 寄送 + 雙層 rate limit；非 destructive、非 step-up，較 PR-2ck `delete.ts` 低一級）。**owner C-1 明示：review care L2 合理、不得降 L1 流程**。走**完整 Dual Gate v3.1 四道外部審查、不用 lighter**。
- **self-review = multi-agent workflow（owner C-1 2026-06-20 明示）**：即使 scout / spike 乾淨亦不得降級單 agent（[[feedback_self_review_form_not_downgradable_by_spike]]）。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（不碰 A3 餘檔、不碰 util `email.ts`、不碰 `CLEANUP_PLAN.md`）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-20：scope = 單檔、self-review 形式 = multi-agent workflow、**OD-ctx = 複用 PR-2ck (a) `ctx: { request: Request; env: Env }`（零新 OD；禁 `EventContext` / 禁加 `@cloudflare/workers-types` / 禁新增 ambient）**、A3 餘檔 + util + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `d8153850`）→ 逐檔 error set + caller cascade 靜態分析 + 測試覆蓋分層 + byte-identical 適用性，全對齊裁示（檔錯數 = 3 / 0 internal·external TS caller / 無 `.cf`）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、`git diff d8153850` 空）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow，3 agents 三維 rubric：scope / runtime·security / evidence — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（維度 B，0 blocker / 0 required / 3 NB；7 維 Pass；CL-1..CL-10 + NB-1..NB-3 見 §Gate 進程紀錄）
  - ✅ `CODEX_PLAN_APPROVED`（維度 C，0 blocker / 0 required；獨立 replay 重現全數值）→ ✅ owner `CODING_ALLOWED`
  - ✅ `CODE_SELF_REVIEW_CLEAN`（multi-agent workflow，3 agents 三維：diff-fidelity / runtime·security / evidence）→ ✅ `CODEX_CODE_APPROVED`（維度 C，0 blocker / 0 critical / 0 required / 1 NB-doc）
  - ✅ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（維度 B，14/14 faithful、0 deviation；**外部 4 道全通過**）→ ⬜ `MERGE_ALLOWED`（merge-front 7 gates 全綠後待 owner 明示）→ ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪回應外部 gate 的修正）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-20 owner C-1 裁示（pre-SPEC → SPEC）：scope = 單檔、2 annotations；self-review = multi-agent workflow（三維收斂、不擴全域）；OD-ctx = **複用 PR-2ck (a)**（零新 OD、禁 EventContext / workers-types / ambient）；禁碰測試 / util / behavior / opportunistic cleanup；GO 進 Spec + plan（非 MERGE_ALLOWED、不得改 source、plan 須附 spike receipt）。
- 2026-06-20 Claude **scout（read-only @ `d8153850`）** → 逐檔 error set（恰 3：TS7006 `ctx` ×1 ＋ TS7031 `request`/`env` ×2）+ caller cascade（`handle` intra-file only、`onRequestPost` Pages entry 0 TS importer）+ coverage 分層（handler 無 direct/indirect test；測試僅覆蓋 util `sendVerificationEmail`，非本 handler）+ byte-identical 適用性，全對齊 owner 裁示（檔錯數 = 3、cascade judged 0、無 `.cf`、wrapper/worker 結構符描述）→ 0 矛盾、不觸發 stop-rule。
- 2026-06-20 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（ratchet 824→821、solution sort-diff REMOVED=3/ADDED=0、byte-identical 3398B sha `b1765521…`、tests-leaf 0→0）。
- 2026-06-20 **multi-agent workflow self-review（維度 A，3 agents converged 三維：scope / runtime·security / evidence；run `wf_d5c01eb7-04c`）→ `PLAN_SELF_REVIEW_CLEAN`**：3 維 finder 全 `clean`（rawFindings 0/0/0、無 candidate → 0 verifier、confirmedReal 0）。主線**獨立讀 plan 對抗式裁決（非採 raw 輸出）**：scope（單檔 2 簽名、frozen diff +2/−2、A3 餘檔+util `email.ts`+`CLEANUP_PLAN.md`+baseline+tsconfig 排除鎖、line/path 正確）✓、runtime·security（2 annotation 純 type-position、byte-identical sha `b1765521…` 證 runtime 不變、`requireAuth`/雙層限流/cooldown/token/`INSERT`·`DELETE`/`sendVerificationEmail`+`AbortController` timeout/response body 全在 diff 行外、`request:Request` 無 `.cf`/無 `request.json()`、`env:Env` 吻合 `requireAuth`+`sendVerificationEmail`）✓、evidence（exact-error 三行 `(25,37)`/`(34,25)`/`(34,34)` 正確、ratchet 824→821·85→84·249→250 算術+spike 一致、coverage 誠實〔handler 無 direct test、byte-identical 唯一硬保證、不 overclaim〕、stale-value 反向 grep〔PR-2ck `827`/`3721`/`541e4cfb`/`9e4102a4`/`5e697377`/`errorFiles 86`/`248` 皆 0 hit〕、current 值 824/821/3398/`b1765521`/`61a0d6ce`/`1b03a131`/250 皆在）✓。**review agents 未污染 git**（post-review `git status` 僅 2 untracked、staged 空、source working-tree diff 空、blob 回 `61a0d6ce`）→ **一輪 0 新發現**。
- 2026-06-20 plan doc commit local（branch `stage7-pr2cl-send-verification-noimplicitany` @ `139754c7`，**未 push**）→ 中文報告 6 欄 → owner C-2 裁示產 ChatGPT Arch packet（plan doc 完整原文 + 附錄 A〔`[[memory]]` glossary〕/ B〔受審檔 base 原文〕/ C〔`requireAuth`+`sendVerificationEmail` 依賴簽名〕展開 repo-only 引用，送外部 ①、不先人工過目）。
- 2026-06-20 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（0 blocker / 0 required revision / 3 NB）— 7 維全 Pass：Scope（單檔 2 annotation、未擴 A3/util/tests/baseline）/ OD-ctx（複用 PR-2ck (a) 合理、不需重開 `EventContext` 選型）/ Runtime neutrality（兩處皆 type position、byte-identical 證據形式正確）/ Security（auth gate·雙層限流·cooldown·token·`INSERT`·`DELETE` rollback·email timeout·response body 全列紅線、未授權碰 runtime）/ Evidence（824→821·REMOVED=3/ADDED=0·tests-leaf 0→0·emit sha 一致、與 scope 自洽）/ Coverage honesty（承認無 direct/indirect test、只宣稱 byte-identical）/ Isolation（A3 餘檔·`utils/email.ts`·`CLEANUP_PLAN.md`·baseline·tsconfig·`env.d.ts` 全鎖）。
  - **Binding locks CL-1..CL-10（ChatGPT Arch；為 owner L1-L10 + plan locks 之 restatement、Codex Plan 須保留）**：CL-1 僅改 `send-verification.ts`；CL-2 僅 2 簽名 annotation；CL-3 Code 階段必重跑 byte-identical（不沿用 spike receipt 當最終證據）；CL-4 不改 `requireAuth`/rate limit/cooldown/token/SQL/rollback/`sendVerificationEmail`/timeout/response body；CL-5 不用 `EventContext`/不加 `@cloudflare/workers-types`/不加 ambient·global·import；CL-6 不宣稱 handler runtime coverage（只 byte-identical neutrality）；CL-7 不跑 baseline update、只報 current 降至 821；CL-8 commit 前查 staged set（防 `CLEANUP_PLAN.md` 誤加）；CL-9 source diff 必與 frozen diff 逐行一致（+2/−2 外 = scope creep）；CL-10 stop rule（cascade/新錯/runtime diff/排除檔/coverage overclaim → 回 `PLAN_DRAFT`）。
  - **NB-1**（非阻擋）：byte-identical 是 type-strip 單檔 emit 證明、非完整 bundle 行為測試；Codex Plan 應確認此證明面足以支撐「type-only runtime 不變」、不得說成 integration coverage。
  - **NB-2**（非阻擋）：`CLEANUP_PLAN.md` untracked 仍是 commit 汙染風險；Code 階段挑檔 add + 列 `git diff --cached --name-status`。
  - **NB-3**（非阻擋）：plan 已寫 full replay @ source commit、方向正確；Codex Plan 應鎖「coding 後重跑」、不接受 spike 當最終 code gate 證據。
  - **可送 ② Codex Plan Gate；非 coding 授權，待 ② 通過 + owner 明示 `CODING_ALLOWED`。**
- 2026-06-20 **Codex Plan Gate（② 維度 C）：`CODEX_PLAN_APPROVED`**（0 blocker / 0 required revision；獨立 replay）— 機械核驗全通過：base `824` → patched `821`、恰 **3 target error removed / 0 added**、emit byte-identical **3398B** sha `b1765521…`、tests-leaf TS pass、source 與 `d8153850` 完全相同、branch diff 僅 plan doc、worktree 僅 untracked `CLEANUP_PLAN.md`、staged 空。Critical Risk **None**（type-only、未動 auth/限流/token/SQL/rollback/email/timeout/response）；State Consistency **No change**（DB 操作與 rollback 順序鎖在 scope 外）；Queue / Payment / Distributed State **N/A**；Observability **No change**（logging 不變、未虛稱 handler runtime coverage）。CL-1..CL-10 / NB-1..NB-3 完整保留。**Plan Gate（① ChatGPT Arch + ② Codex Plan）全通過 = plan 批准；仍非 coding 授權，待 owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-20 **owner `CODING_ALLOWED` ✅** → 進 Code 階段。
- 2026-06-20 **Code 階段（source commit `c3d3e835`）**：落地唯二 2 編輯點（`onRequestPost(ctx: { request: Request; env: Env })` ＋ `handle({ request, env }: { request: Request; env: Env })`），`git diff d8153850..c3d3e835 -- functions/` = `send-verification.ts` **+2/−2**、blob `61a0d6ce→1b03a131`、`numstat 2 2`（無 CRLF whole-file churn）。**full replay gates 全綠（@ source、不沿用 spike）**：byte-identical（canonical `esbuild --loader=ts --format=esm`，base `d8153850` via `git show` vs working）兩端 **3398B** sha `b1765521…a2a2d`、stderr 0、`diff -q` IDENTICAL · forced solution sort-diff **REMOVED=3 / ADDED=0** · tests-leaf **0→0** · ratchet:report **821/84/250**、ratchet enforce〔`RATCHET_BASE_REF=d8153850`〕**OK**（baseline 1119/175、current 821/250）· `git diff --check` clean · lint green · build:functions「Compiled Worker successfully」。**NB-2 雙證齊**（source diff 逐行 annotation + byte-identical receipt，不以 ratchet 數字單獨代表 runtime 不變）。
- 2026-06-20 **Code self-review = multi-agent workflow（維度 A，3 agents converged 三維：diff-fidelity / runtime·security / evidence；run `wf_6807078c-b30`）→ `CODE_SELF_REVIEW_CLEAN`**：3 維 finder 全 `clean`（rawFindings 0/0/0、confirmedReal 0）。主線**獨立讀真碼裁決**：diff-fidelity（`git diff -- functions/…` 恰 2 annotation、+2/−2、`numstat 2 2`、functions/ 僅本檔、無 staged 污染）✓、runtime·security（非簽名行 base↔head **逐行 IDENTICAL** + byte-identical sha 兩端一致 = runtime 不變硬證、`requireAuth`/限流/cooldown/token/`INSERT`·`DELETE`/`sendVerificationEmail`+timeout/response body 未動、無 `.cf`）✓、evidence（ratchet/sort-diff/byte-identical/tests-leaf/lint/build 與 replay 一致、coverage honesty：grep `from '…email/send-verification'` 全 repo **0 命中**、不 overclaim、無 stale leak）✓ → **一輪 0 新發現**。**review agents 未污染 git**（post-review `git status` 僅 source M + untracked、staged 空、working-tree 仍恰 2-line diff、byte-identical 再驗一致 — PR-2ck stray-checkout 事件未復發）。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；不得 merge 除非 owner 明示 `MERGE_ALLOWED`。**
- 2026-06-20 **Codex Code Gate（③ 維度 C）：`CODEX_CODE_APPROVED`**（0 blocker / 0 critical risk / 0 required / 1 NB-doc）— 機械重驗 committed code 全通過：5 commit 線性、`c3d3e835` 僅 `send-verification.ts` +2/−2、net base..HEAD = plan doc + source、index 空、status 僅 `?? CLEANUP_PLAN.md`；byte-identical base↔HEAD **3398B** sha `b1765521…`、forced solution 824→821 / REMOVED=3 / ADDED=0（target file 0 殘留）、tests-leaf pass、ratchet 821/84/250/334 + enforce OK、lint pass、Functions build success；Coverage（無 handler importer/test、只宣稱 byte-identical neutrality）、CL-1..CL-10 保留；State Consistency / Observability **No change**、Queue / Payment / Distributed State **N/A**。**NB-doc（非阻擋）**：checklist `CODING_ALLOWED` checkbox 原仍 ⬜（dated 紀錄已標 granted）→ 本 gate-log 同步修正為 ✅（併修剛通過的 `CODEX_CODE_APPROVED` checkbox）。**可送 ④ ChatGPT Faithfulness；仍非 `MERGE_ALLOWED`。**
- 2026-06-20 **ChatGPT Code Faithfulness Gate（④ 維度 B）：`CHATGPT_CODE_FAITHFULNESS_APPROVED`**（Faithfulness Matrix **14/14 faithful**、0 deviation / 0 blocker / 0 required / 1 NB）— actual committed source diff（`d8153850..c3d3e835`）與 approved frozen diff 逐行一致：scope / edit-point count(+2/−2) / OD-ctx annotation / worker annotation / frozen-diff match / error-target removed(3) / runtime-neutral(byte-identical 3398B 同 sha) / hot-zone untouched / env lock / test lock / coverage honesty / baseline lock / index-staging lock / gate locks(CL-1..CL-10) 全 Faithful。**NB-1（非阻擋，已實查解消）**：packet 附錄的 `// ← annotation #1/#2` 為 packet 註記、**非 repo source**；grep 源檔 `← annotation` **0 命中**、committed diff 僅 2 annotation（無 comment drift）→ 無 source drift。**外部 4 道全通過（① ChatGPT Arch + ② Codex Plan + ③ Codex Code + ④ ChatGPT Faithfulness）。可進 merge-front gates；仍非 `MERGE_ALLOWED`（待 owner 明示）。**
- （後續 dated 收錄：merge-front gates → MERGE_ALLOWED → squash → main CI / deploy）

## owner 鎖定表（L1-L10，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 僅 `functions/api/auth/email/send-verification.ts` 單檔 |
| L2 Edit Point | **兩個**：`onRequestPost(ctx)` 簽名 ＋ `handle({request,env})` 簽名；其餘零改動 |
| L3 Type-only | emitted JS 必 byte-identical |
| L4 Exclusion | 不碰 A3 餘檔（`email/verify.ts`、`local/forgot-password.ts`、`local/{login,register}.ts`）、util `utils/email.ts`、tests、`env.d.ts`、tsconfig、baseline、`CLEANUP_PLAN.md` |
| L5 Security Hot Zone（auth-adjacent） | 不得改 `requireAuth` gate、雙層 rate limit（短視窗 `checkRateLimit`/`recordRateLimit` kind='email_send' + IP 1h `email_verifications` COUNT `IP_HOURLY_LIMIT=10`）、`COOLDOWN_SECONDS=60`、`generateSecureToken`+`hashToken`（`TOKEN_TTL_HOURS=1`）、`INSERT email_verifications`(token_type='verify_email')、`sendVerificationEmail`(RESEND_API_KEY) + `AbortController`/`FETCH_TIMEOUT_MS=8000` timeout + 失敗 rollback `DELETE`、response body、常數 |
| L6 Env | 不改 `types/env.d.ts`、不新增 env key |
| L7 Tests | 不為過 PR 改 tests；只跑既有 tests |
| L8 Evidence | plan + code 階段都重跑 ratchet / sort-diff / byte-identical / tests-leaf |
| L9 Coverage | 逐 sub-path 下鑽；handler 無 direct test → 僅宣稱 byte-identical，未覆蓋分支明載、不 overclaim |
| L10 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / coverage overclaim → 退回 `PLAN_DRAFT` |

## ⚠ send-verification.ts 熱區聲明（review care L2，auth-adjacent）

`auth/email/send-verification.ts` 為**已登入使用者請求重發 email 驗證信**（`requireAuth`-gated；非 destructive、非 step-up，較 `delete.ts` 低一級，但仍涉 token 生成 + 限流 + 外送）。修法若非純型別、或牽動下列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L5）：

| 區塊 | 紅線（typing 全程不得牽動） |
|---|---|
| auth gate | `requireAuth(request, env)`（缺 token → 401/403；不得改簽名/順序）|
| 雙層限流 | 短視窗 `checkRateLimit(db,{kind:'email_send',windowSeconds:60,max:3})` + `recordRateLimit(db,{kind:'email_send',…})` · IP 1h `SELECT COUNT(*) FROM email_verifications … '-1 hour'` `IP_HOURLY_LIMIT=10` |
| 冷卻 | 60s cooldown（`COOLDOWN_SECONDS=60`，`email_verifications … '-60 seconds'`）|
| token 生成 | `generateSecureToken()` + `hashToken()`（DB 存 SHA-256 hash、`TOKEN_TTL_HOURS=1`）|
| DB 寫入 | `INSERT INTO email_verifications (… token_type='verify_email' …)` · email 失敗 rollback `DELETE FROM email_verifications WHERE token_hash = ?` |
| 外送 + timeout | `sendVerificationEmail(env.RESEND_API_KEY, userRow.email, token, env, ctrl.signal)` 包 `AbortController` + `setTimeout(…, FETCH_TIMEOUT_MS=8000)` + `finally clearTimeout` |
| 回應 | response body（成功訊息 / 各 error code：USER_NOT_FOUND / EMAIL_ALREADY_VERIFIED / COOLDOWN / RATE_LIMITED / EMAIL_SEND_FAILED）|

註：本刀只在 2 個 function 簽名加型別標註，TS erase 後 runtime byte-identical（SQL / 常數 / audit·log / 字串 / 註解不變）。

### Coding 階段硬性邊界

- **允許**：`onRequestPost(ctx)` 加 `ctx: { request: Request; env: Env }`；`handle({ request, env })` 加 `: { request: Request; env: Env }`。
- **禁止**：改任何 SQL / `requireAuth` gate / 限流·cooldown 邏輯與常數 / token 生成·hash / `INSERT`·`DELETE` / `sendVerificationEmail` 外送 / `AbortController`·timeout / response body / caller / tests / util `email.ts` / `tsconfig`·`eslint`·`vitest` / `env.d.ts` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext` / 加 `@cloudflare/workers-types` / **碰 A3 餘檔** / 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `d8153850`）

### exact errors（forced `tsc -b tsconfig.solution.json --force`，solution total 824）

```
functions/api/auth/email/send-verification.ts(25,37): error TS7006: Parameter 'ctx' implicitly has an 'any' type.
functions/api/auth/email/send-verification.ts(34,25): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/email/send-verification.ts(34,34): error TS7031: Binding element 'env' implicitly has an 'any' type.
```

恰 **3 個**：`onRequestPost` wrapper 的 `ctx`（**TS7006 ×1** @ L25）＋ `handle` worker destructure 的 `request`/`env`（**TS7031 ×2** @ L34）。wrapper catch clause `catch (err)`（L28）**不被 noImplicitAny 旗標**（且 catch 內**完全不存取 `ctx.*`**，比 `delete.ts` 更乾淨）。檔內無其他 TS7006/其他碼。

> ⚠ 釐清：util `functions/utils/email.ts` 的 `sendVerificationEmail`（同詞根、**不同檔**）**不在 scope**；grep `sendVerification` 命中皆為該 util。

### 依賴邊界（caller cascade）

`send-verification.ts` 是 Pages file-routing entry，cascade 面：

| 面 | 判定 | 證據 |
|---|---|---|
| `onRequestPost` 外部 TS caller | **0** | 全 repo grep `send-verification` 命中＝`utils/email.ts:6`（純註解）/ `src/js/dashboard.ts:1286`·`public/js/*`（runtime `apiFetch('/api/auth/email/send-verification')` 字串呼叫）/ `public/js/case-platform.js:48`（i18n 文件字串）— **無一為型別 import** |
| `handle` caller | **intra-file only** | `handle` **未 export**；grep 僅 `send-verification.ts`（L27 呼叫、L34 定義）；OD-ctx (a) 使 `handle(ctx)` exact-match assignable → 0 cascade |
| intra-file env / request 存取 | 全相容 | `env.chiyigo_db` / `env.RESEND_API_KEY` 皆在 `Env`（ambient）；`db`=`env.chiyigo_db`（D1Database→any，[[feedback_d1database_resolves_any_no_workers_types]]）；`request.headers.get('CF-Connecting-IP')` + 流入 `requireAuth(request)`、**無 `.cf`/無 `request.json()`** → plain `Request` |
| tests-leaf | **0 接觸** | 無 test import / fetch 本 handler（見 §測試影響面）|

**最強佐證（precedent）**：`delete.ts`（PR-2ck #107，現 0-error）逐行同構——`onRequestPost(ctx: {request:Request;env:Env})` wrapper → `handle*({request,env}:{request:Request;env:Env})` worker → `requireXxx(request,env,…)` → `env.chiyigo_db` → `Number(user.sub)`，全 clean。故 `send-verification.ts` worker 同款構造在 `request:Request`/`env:Env` 下 **0-cascade 已被 precedent 證偽**；spike（下）機械復現（REMOVED=3/ADDED=0 涵蓋 `checkRateLimit`/`recordRateLimit`/`user.sub`/`sendVerificationEmail`/`AbortController` 全 intra-file 存取點）。

### 型別選型（owner Convention A；OD-ctx 複用 PR-2ck (a)，零新 OD）

允許落地的唯一 source diff（兩處編輯點）：

```ts
export async function onRequestPost(ctx: { request: Request; env: Env }) {   // L25 wrapper
async function handle({ request, env }: { request: Request; env: Env }) {   // L34 worker
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| worker `{ request, env }` | **`{ request: Request; env: Env }`（Convention A）** | 沿 PR-2ch/2ci/2cj/2ck 四處先例；`requireAuth(request, env: Env)` 即收 full `Env`、`sendVerificationEmail(…, env)` 收 full `Env`（→ `EmailEnv` structural assignable，同 PR-2ck `delete.ts` 對 `sendDeleteConfirmationEmail` 已證）＝最強零-cascade 佐證；handler 用 full `Env`（[[feedback_util_env_param_pick_not_full_env]] 區分 util 用 `Pick`）|
| worker `request` | **`Request`（plain）** | 僅 `request.headers.get('CF-Connecting-IP')` + 流入 `requireAuth`（收 `Request`）；**無 `.cf`、無 `request.json()`** → 非 `CfRequest` |
| **OD-ctx：wrapper `ctx`** | **複用 PR-2ck (a) `ctx: { request: Request; env: Env }`（零新 OD）** | 與 worker destructure 型別**完全相同** → `handle(ctx)` exact-match 0 cascade；本檔 catch **不存取 `ctx.*`**（連 in-type 需求都不必）；**免 import、免新增套件**、與 Convention A inline 風格一致 |
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 3 錯 |

**OD-ctx 狀態（非新 OD）**：wrapper/worker ctx convention 先例已由 **PR-2ck `delete.ts` 設立並經 ChatGPT Architecture Gate affirm**（`CHATGPT_ARCH_APPROVED_WITH_LOCKS`，2026-06-20）。本 PR **直接複用、非重開選型**；候選 (b) `EventContext<Env,…>` 仍駁回（`@cloudflare/workers-types` 未安裝 → 不可得、需新增 ambient/import，違 L6；[[feedback_d1database_resolves_any_no_workers_types]]）。

## Spike 實證（full-solution，本地未 commit，2026-06-20，已 revert clean）

**程序**：量 base（clean main `d8153850`：solution 824 / tests-leaf 0）→ 套 2 編輯點（Edit）→ forced `tsc -b tsconfig.solution.json --force`（含 functions / tests / scripts / browser-typecheck 全 leaf，sorted error set diff）→ canonical byte-identical（esbuild stdin）→ forced `tsc -b tsconfig.tests.json --force`（tests-leaf）→ canonical `--report` → frozen diff + `git diff --check` → `git checkout --` revert → 驗 clean（`git diff d8153850` 空、staged 空）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| send-verification.ts errors 3 → 0 | ✅ sort-diff REMOVED = 恰 3 行（`(25,37)` TS7006 ＋ `(34,25)`/`(34,34)` TS7031）；patched 0 殘留 |
| solution errorCount 824 → 821（恰 −3） | ✅ forced tsc solution **821**；sort-diff ADDED = **空** |
| zero cascade（functions + tests + scripts + browser，全 solution） | ✅ solution sort-diff **REMOVED=3 / ADDED=0**；另 `tsc -b tsconfig.tests.json --force` **base 0 → patched 0** |
| canonical `--report`（patched） | ✅ errorCount **821** / errorFiles **84** / cleanFiles **250** / sourceFilesTotal 334 |
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`**，[[feedback_byte_identical_emit_verification]]） | ✅ esbuild **stdin** type-strip base(`d8153850`) vs patched **IDENTICAL**、皆 **3398B**、esbuild stderr 空：<br>sha256 兩端 `b1765521235724e8f6b569ae5f5ef70901421805e69cad70280ce60bcd322a2d` |
| `git diff --check`（source） | ✅ exit 0（無 trailing whitespace / lone space）|
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、`git diff d8153850 -- send-verification.ts` **空**、`git diff --cached` 空、blob 回 `61a0d6ce` |

**byte-identical 適用性**：send-verification.ts 4 imports（auth / crypto / email / rate-limit）→ esbuild stdin transform **適用**（單檔 transform、import 行原樣保留；非完整 bundle，但 type-only annotation PR 這正是對的證明面）。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/email/send-verification.ts b/functions/api/auth/email/send-verification.ts
index 61a0d6ce..1b03a131 100644
--- a/functions/api/auth/email/send-verification.ts
+++ b/functions/api/auth/email/send-verification.ts
@@ -22,7 +22,7 @@ const SHORT_WINDOW_SEC    = 60   // 新：login_attempts kind='email_send' 短
 const SHORT_WINDOW_MAX    = 3    //      每 IP 每分鐘 3 次
 const FETCH_TIMEOUT_MS    = 8000  // 防 Resend 卡住把 Worker 拖進 524

-export async function onRequestPost(ctx) {
+export async function onRequestPost(ctx: { request: Request; env: Env }) {
   try {
     return await handle(ctx)
   } catch (err) {
@@ -31,7 +31,7 @@ export async function onRequestPost(ctx) {
   }
 }

-async function handle({ request, env }) {
+async function handle({ request, env }: { request: Request; env: Env }) {
   const { user, error } = await requireAuth(request, env)
   if (error) return error
```

`git diff --stat`：1 file changed, 2 insertions(+), 2 deletions(-)；`git diff --numstat`：`2  2`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `d8153850` `--report`：errorCount **824** / errorFiles **85** / cleanFiles **249** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **824 → 821**（−3）、errorFiles **85 → 84**、cleanFiles **249 → 250**（spike 實測值、非預測；send-verification.ts 全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 821」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 2 個 function 簽名型別標註，TS erase 後 runtime byte-identical（§Spike sha `b1765521…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 824、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。

## 測試影響面（覆蓋誠實，L9 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf base 0 → patched 0 實證）。
- **覆蓋分層（誠實，逐 sub-path 下鑽）**：

| 標的 | direct test | indirect | 真打路徑 | 硬保證 |
|---|---|---|---|---|
| `email/send-verification.ts`（handler） | ❌ **無** | ❌ **無** | — | **byte-identical 為唯一硬保證** |
| `utils/email.ts` `sendVerificationEmail`（util，**非本檔**） | ✅ 有（`tests/email.test.ts`） | — | — | （out-of-scope，僅說明同詞根不同檔）|

- **下鑽證據（不 overclaim）**：
  - 全 repo grep `send-verification` → 0 個 TS `import` 本 handler module（命中皆為註解 / `apiFetch` 字串 / i18n 文件字串）。
  - `tests/` 內 grep `send-verification|email/send` → **0 命中本 handler**；命中皆 `sendVerificationEmail`（util，`tests/email.test.ts` 直測 + `tests/integration/{register,forgot-password,jwt-sid-claim}.test.ts` 以 `vi.fn()` mock 掉）→ 無任何 test fetch `POST /api/auth/email/send-verification` 或 import 本 handler。
  - **未覆蓋分支明載**：handler 全部 runtime 分支（短視窗限流 / IP 1h 限流 / cooldown / user-not-found / already-verified / email 失敗 rollback / 成功）**皆無 direct test 斷言**；本 PR type-only 不改 tests（L7），這些分支的不變保護 = byte-identical emit（sha 兩端一致）。
- 與 PR-2ci `setup` / PR-2cj `unbind` / PR-2ck `delete`（皆無 direct test）同策略：缺 coverage 的 handler **僅以 byte-identical 為硬保證、不宣稱 runtime coverage**。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`。**PowerShell 用 `$env:RATCHET_BASE_REF='d8153850'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection）。

- `$env:RATCHET_BASE_REF='d8153850'; npm run typecheck:ratchet` green（824→821 / 85→84 / 249→250）。
- filtered forced tsc：send-verification.ts 0 殘留 + solution sort-diff **REMOVED=3 / ADDED=0**（含 functions intra-file `handle(ctx)` + tests/scripts/browser leaf）+ `tsc -b tsconfig.tests.json --force` exit 0（base 0 → patched 0）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**（PowerShell 5.1 不支援 `<` stdin redirection；ratchet 段用 PowerShell `$env:` 見上注）：

```bash
git show d8153850:functions/api/auth/email/send-verification.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/sv-base.js 2>/tmp/sv-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/email/send-verification.ts > /tmp/sv-head.js 2>/tmp/sv-head.err
wc -c /tmp/sv-base.js /tmp/sv-head.js        # 期望 3398 兩端
sha256sum /tmp/sv-base.js /tmp/sv-head.js     # 期望 b1765521… 兩端
cat /tmp/sv-base.err /tmp/sv-head.err          # 期望空（stderr 0 bytes）
diff -q /tmp/sv-base.js /tmp/sv-head.js         # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show d8153850:` 讀未改 base。spike 本地實證：兩端 **3398B / `b1765521…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 2 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量）、`npm run build:functions` green。
- targeted int：**無 handler direct test**（0 coverage）→ 不跑 targeted；跑全量 `test:int` 確認無跨檔破壞（**不宣稱涵蓋 send-verification.ts**）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +2/−2、`git diff` 2 處皆 function 簽名 annotation）；超出 = scope creep = Gate fail。

## Merge SOP（process lock，順序不得寫反；[[feedback_pre_merge_gate_checklist_match_ci]]）

① faithfulness ✅ → ② **先**跑齊 merge 前 local gates 全綠（`lint`·`typecheck:ratchet`〔Git Bash `RATCHET_BASE_REF=d8153850`〕·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit --omit=dev --audit-level=high`）→ ③ 全綠後 owner 明示 `MERGE_ALLOWED` → ④ push branch + 開 PR + `gh pr merge --squash --delete-branch`（禁直推 main）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 memory receipt（SHIPPED 才寫：topic PR-2cl 段 + MEMORY.md index 數字 824→821）。

## Diff hygiene

- 不碰 `CLEANUP_PLAN.md`（untracked、Stage 7 完工才清）；**不碰 A3 餘檔、util `email.ts`**；baseline 不 `--update`；挑檔 add（1 source + 本 plan doc）禁 `git add .`/`-A`；feature branch `stage7-pr2cl-send-verification-noimplicitany` 禁直推 main；平行 session 唯讀優先、動 git 前先 `git status`。
- **commit 前後核 `git diff --cached --name-status` + net source diff**（[[feedback_commit_verify_staged_set_and_net_source_diff]]；PR-2ck self-review Explore agent stray `git checkout` 污染 index 教訓 — self-review workflow agent 具 Bash、可改 git state）。
- **CRLF**：spike 實證 `git diff --numstat` = `2  2`（`.gitattributes` `* text=auto eol=lf` 已根治，[[feedback_windows_build_crlf_churn]]、無 whole-file churn）；code 階段 commit 前再驗 `numstat` `2 2`。

---

## 附：owner C-1 鎖定表（faithful 收錄）

### 風險表

| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| email 驗證 handler type-only 改動誤動 runtime | 中 | auth gate / 限流 / token / email rollback 任一漂移破壞 email 驗證安全邊界 | 僅改 2 個 function 簽名 annotation；spike 已證 solution+tests leaf 0 cascade + byte-identical sha 兩端一致 |
| 第二個 wrapper/worker handler（複用先例） | 低 | 先例已由 PR-2ck 設立並經 ChatGPT Arch affirm | OD-ctx 複用 (a)、零新 OD；scope 與 delete.ts 同構 |
| 無 direct test coverage | 中 | runtime regression 不易由測試捕捉 | byte-identical（非空、IDENTICAL、sha 兩端一致）為唯一硬保證；coverage 不 overclaim |
| 同詞根 util `sendVerificationEmail` | 低 | 誤改 util `email.ts` | L4 鎖死單檔 handler、明列 util 隔離 |
| `CLEANUP_PLAN.md` untracked | 低 | 誤 add 汙染 scope | 禁 `git add -A`、挑檔 add |
| baseline/ratchet 誤更新 | 高 | 掩蓋真實 Stage 7 進度 | reduce 不 `--update` |

### 防禦表

| 機制 | 處理 | 實作 / 未處理因 |
|---|---|---|
| 權限 / auth | 是 | `requireAuth(request, env)` 簽名吻合、呼叫順序不動 |
| Input | 是 | 無 `request.json()` body（POST 空 body）；`request.headers.get('CF-Connecting-IP')` 不動 |
| RateLimit | 是 | 雙層限流（短視窗 + IP 1h）+ 60s cooldown 常數與邏輯不動 |
| XSS | N/A | Functions API type-only、無前端輸出面 |
| Log/Audit | 是 | `console.error` 不動；本 handler 無 audit event |
| Retry/備援/rollback | 是 | email send timeout（`AbortController`+`FETCH_TIMEOUT_MS`）+ 失敗 `DELETE` rollback 不動；無新增外部 retry |
| 監控 | 是 | ratchet 824→821 明列；coverage 不 overclaim |

### DB 鎖定

| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Schema | 不改 `email_verifications` / `users` / `login_attempts`（rate-limit 表）|
| Atomic | 禁改 `INSERT email_verifications`(token_type='verify_email') 與 email 失敗 rollback `DELETE` 條件與順序 |

### 隔離區 / 鎖定區

- **隔離區**：A3 餘檔（`email/verify.ts`、`local/forgot-password.ts`、`local/{login,register}.ts`）、util `functions/utils/email.ts`、`CLEANUP_PLAN.md`、baseline/ratchet override **全部不得碰**。
- **鎖定區**：所有 runtime（`requireAuth` gate / 雙層限流·cooldown 常數 / token 生成·hash / `INSERT`·`DELETE` / email 外送·timeout / response body）；return type / JSDoc / 註解 / 格式。
