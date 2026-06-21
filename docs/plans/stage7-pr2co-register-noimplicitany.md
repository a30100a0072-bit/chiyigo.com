# Stage 7 reduce PR-2co — `auth/local/register.ts` noImplicitAny（單檔帳號創建 handler，**單一 direct handler ＋ `waitUntil` ＋ D1-row `.map` callback**，type-only，review care **L3**）

**目標**：`functions/api/auth/local/register.ts` 的 **4 個 noImplicitAny error（3×TS7031：`onRequestPost` destructure `request`/`env`/`waitUntil` @ L29；1×TS7006：guest takeover 路徑 `takenRows.map(r => r.id)` 的 callback param `r` @ L144）→ 0**，**純 type-only**（**2 個編輯點**＝① 唯一 exported handler `onRequestPost` 的 destructured param annotation；② L143 承接 const `takenRows` 的 row array 型別標註以斷開 D1 any-chain；TS erase 後 emit byte-identical）。

**Scope（owner C-1 鎖 2026-06-21；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/local/register.ts` | 4（L29 `onRequestPost({request,env,waitUntil})` TS7031 ×3 ＋ L144 `takenRows.map(r=>r.id)` TS7006 ×1） | **2 個編輯點**（① `onRequestPost` destructure param annotation；② L143 `const takenRows` row array annotation）|

> **主線定位（owner C-1）**：A 域 handler 層續清，**A3 第四棒（倒數第二棒）**。PR-2ch 清 A1 五檔 TOTP-caller handler（#104）→ PR-2ci `2fa/setup.ts`（#105）→ PR-2cj A2 `change-password.ts`+`identity/unbind.ts`（#106）→ PR-2ck A 域 `delete.ts` step-1（#107、**首個 wrapper/worker 雙 function handler 先例**）→ PR-2cl `email/send-verification.ts`（#108 `0c71d03b`、**A3 起手、wrapper/worker、複用 PR-2ck OD-ctx (a)**）→ PR-2cm `email/verify.ts`（#109 `8be32537`、**雙直連 handler + GET request-only partial-context 先例、零新正式 OD**）→ PR-2cn `local/forgot-password.ts`（#110 `58664200`、**單一 direct handler、首個 `waitUntil` 型別化 OD＝optional 先例**）。本 PR = **A3 第四棒 `local/register.ts`**，owner 2026-06-21 C-1 裁 **單檔單獨成棒**。**新元素**：本檔為**單一 direct handler**（`onRequestPost`，param 直接 destructure，無 wrapper/worker、無 `ctx`），destructure 含 **`waitUntil`**（**複用 PR-2cn #110 已立的 optional 先例、非新 OD**），且 guest takeover 路徑含**本 A 域首個 D1-result-row `.map` callback 型別化 OD**（L144 TS7006，C-1 裁 const 層斷鏈）。**排除**：A3 殿後檔 `local/login.ts`〔Tier-0、最重、brute-force/session、單獨成棒〕、util `utils/{email,turnstile,jwt,crypto,auth,user-audit,password,cors,scopes,cookies,tenant-context}.ts`、`auth/oauth/end-session.ts`（亦未遷移 `waitUntil` user，本 PR 不碰）、大熱區 `audit`/`payments` 域（defer）。

base main `58664200`（接 PR-2cn #110；`git rev-parse HEAD` 實查 = `586642001d6332ac37072a2c890991924f4971fd`、main clean）。branch `stage7-pr2co-register`（自 clean main 開、未 push）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔、2 annotation）/ review care **L3**（**owner C-1**：register 是 **Tier-0 帳號創建入口**，含密碼 PBKDF2 hash、原子 batch INSERT users+local_accounts+email_verifications、refresh token + session_id、JWT access token + tenant claims、guest takeover + audit、email 寄送、Set-Cookie/body refresh — 目前 A 域最廣熱區）。走**完整 Dual Gate v3.1 四道外部審查、不用 lighter**。
- **self-review = multi-agent workflow（owner C-1 2026-06-21 明示）**：即使 scout / spike 乾淨亦不得降級單 agent（[[feedback_self_review_form_not_downgradable_by_spike]]）。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（不碰 `login.ts`、不碰任何 util、不碰 `end-session.ts`、不碰 `RESEND_API_KEY` 行為〔本檔已有 `if (env.RESEND_API_KEY)` guard〕、不碰 `CLEANUP_PLAN.md`、不改 guest takeover runtime）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-21：scope = 單檔、**納入全 4 錯**（含 L144 第 4 錯，否則 register.ts 仍非 clean file）；self-review 形式 = multi-agent workflow；**OD ruling**：① `request: Request` ② `env: Env`（full）③ `waitUntil?: (promise: Promise<unknown>) => void`（**複用 #110 optional 先例**）④ **L144 = strategy (a) const 層 typed row array**（在 `const takenRows` 斷 D1 any-chain，只露本區塊實用欄位 `id`/`user_id`，**禁只標 callback param**、禁 full table type、禁改 SQL）；**禁** required `waitUntil`、**禁** 補 `RESEND_API_KEY` guard、**禁** 改 `typeof waitUntil === 'function'` guard、**禁** 新增 rate-limit（register 本無、不新增安全功能）、**禁** `CfRequest`/`EventContext`/`@cloudflare/workers-types`/新 import/新 ambient；`login.ts` + util + `end-session.ts` + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `58664200`）→ 逐檔 error set（**4 錯：3 TS7031 + 1 TS7006**，非預期 3）+ caller cascade（shared `verifyTurnstile` 3 caller，annotate 不牽動）+ 測試覆蓋分層（**有** direct integration test `register.test.ts`、`callFunction` untyped 切斷型別連結）+ 結構判定（單一 direct handler、無 wrapper/worker/`ctx`/其他 export）+ `waitUntil` OD 形態（複用 #110 optional）+ L144 D1-row map callback（新 OD、C-1 已裁 const 層斷鏈）+ 無 `.cf`。**檔錯數不符（4≠3）→ 依 stop-rule 停手回報 → owner C-1 裁定納入第 4 錯 + L144 OD strategy (a)**（見 §Gate 進程紀錄）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、blob 回 `18976c9e`）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow `wf_630b5500-8d3`，3 agents 三維 rubric：scope / runtime·security / evidence；三維全 **0 findings**、accepted 0、suspicious 0；主線獨立對抗式裁決認同 clean — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 維度 B，**0 Blocker / 0 Required Revision / 3 NB**、8 維全 PASS、6 OD 全 APPROVED、binding locks CL-1..CL-8 — 見 §Gate 進程紀錄）→ ✅ `CODEX_PLAN_APPROVED`（② 維度 C，r1 `CHANGES_REQUESTED`〔2 docs-only：import 數 8→11、coverage 補 `jwt-sid-claim.test.ts` + Turnstile skip-path-only〕→ docs 修正 → **r2 `APPROVED`、0 blocking / 0 required**；**Plan Gate 雙道全過**）→ ✅ owner `CODING_ALLOWED`（2026-06-21）
  - ✅ Code 階段（source commit `08d17fba`、full replay @ source 全綠、NB-2 雙證）→ ✅ `CODE_SELF_REVIEW_CLEAN`（multi-agent workflow，3 維 diff-fidelity/runtime·security/evidence、全 **0 findings**、主線裁決 clean；v1 `wf_f2acc427-f12` Haiku → **owner 裁定重跑 v2 `wf_e00f766e-9e2` Opus 4.8** 亦 0 findings，見 §Gate 進程紀錄模型層級揭露）→ ✅ `CODEX_CODE_APPROVED`（③ 維度 C，**0 Critical/High/Med/Low**、機械重驗全 PASS、CL-1..CL-8 PASS、row schema 相符 — 見 §Gate 進程紀錄）→ ✅ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④ 維度 B-code，**14/14 Faithful、0 deviation / 0 scope creep / 0 未附 hunk source / 0 Tier0-1 finding**；**外部 4 道全過**）
  - ✅ merge-front 7 gates 全綠（lint / ratchet 811·253 / verify:browser-pipeline / test:cov 737 / test:int 1328 / build:functions / npm audit 0 vuln — 見 §Gate 進程紀錄）→ ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-21 Claude **scout（read-only @ `58664200`）** → 逐檔 error set（**4 錯**，非 owner 預期的 3：`(29,39)` `request` / `(29,48)` `env` / `(29,53)` `waitUntil` 三 TS7031 ＋ **`(144,41)` `r` TS7006**〔guest takeover `takenRows.map(r => r.id)`〕）+ caller cascade（shared `utils/turnstile.ts#verifyTurnstile` 恰 **3 caller**〔`register.ts:46`/`login.ts`/`forgot-password.ts`〕，annotate 本檔 param 不改 util、不牽動另 2 caller；`assist.ts:221` 為**同名 local 函式** homonym〔`(token,secret,ip)`〕非此 util caller）+ coverage 分層（**有** direct integration test `tests/integration/register.test.ts`、`await import` 直取 `onRequestPost`；但 `callFunction(handler,…)` 之 `handler` untyped→切斷 test↔handler 型別連結→type-only 0 tests-leaf cascade）+ 結構判定（**單一 direct handler** `onRequestPost`、無 wrapper/worker/`ctx`/其他 export）+ `waitUntil` OD（L220 `if (typeof waitUntil === 'function') waitUntil(sendTask)`，guard 與 #110 L133 逐字相同、`sendTask` = `Promise<void>` → **複用 #110 optional 先例**）+ **L144 D1-row map callback**（`takenRows` 來自 `db.prepare(...).all()` 之 D1 any-chain〔`D1Database` 解為 `any`，[[feedback_d1database_resolves_any_no_workers_types]]〕、`any.map(r=>…)` callback 無 contextual type → TS7006，[[feedback_ts_any_chain_breaks_contextual_typing]]；**與 3 個 binding element 標註互相獨立**，annotate env 不消此錯）+ 無 `request.cf`。**檔錯數不符（4≠3）→ 觸發 stop-rule、停手回報、不自改 scope**（其餘全對齊：結構 / waitUntil 複用 / env full / request plain / caller 不牽動 / tests untyped）。
- 2026-06-21 owner **C-1 裁示**（pre-SPEC → SPEC，faithful 收錄）：① **scope = 納入全 4 錯**（含 L144；不納入則 register.ts 仍非 clean file、ratchet 目標失敗）；② **L144 OD = strategy (a) const 層 typed row array**（斷 `.map(r)` 與 `takenRows[0]?.user_id` 兩處 any-chain、比 callback-only 穩；型別由 SELECT 欄位 + D1 schema + repo 既有 D1-row 先例定讞；只露 `id`/`user_id`；禁 full table type / 禁改 SQL / 禁 callback-param-only）；③ **review care = L3**（Tier-0 帳號創建入口）；④ self-review = multi-agent workflow（不降級）；⑤ runtime scope = 嚴格 type-only（只解 implicit-any、不補安全功能、不重構、byte-identical 必驗）；⑥ **校正**：register **不得描述為已有 rate-limit**（本檔無 `checkRateLimit/recordRateLimit`、防禦＝Turnstile + email unique；本 PR 不新增 rate-limit）。完整 lock + 風險表 + 防禦表見 §附。
- 2026-06-21 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（solution 815→811、sort-diff REMOVED=4/ADDED=0、tests-leaf 0→0、byte-identical 7563B sha `9227b6b9…` 兩端一致、ratchet:report base 815/82/252/334 → patched 811/81/253/334）。
- 2026-06-21 **multi-agent workflow self-review（維度 A，rubric 收斂三維：scope / runtime·security / evidence；run `wf_630b5500-8d3`、3 agents / ~184k subagent tokens / 152 tool uses / ~7min）→ `PLAN_SELF_REVIEW_CLEAN`**：三維 finder（pipeline + adversarial verify、default refuted、Explore read-only）**全 0 findings、accepted 0、suspicious_input 0**（type-only plan 忠實 → clean 為預期結果，rubric 依 [[feedback_self_review_form_not_downgradable_by_spike]] 收斂三項不擴全域、不跑通用 7-finder 以避免 tenant/migration/payment 等 N/A 維度系統性假陽性）。**主線獨立對抗式裁決（非採 raw 輸出，v3.1 §5）認同 clean**：① 無 PR-2cn(#110) 數據洩漏（`818`/`4003`/`84d11217`/blob `b6cf6c04`·`5602c86c` 皆不出現於本 PR current 數據）；② PR-2co current data 內部一致（emit `7563B`×8 / sha `9227b6b9`×7 / blob `18976c9e→778c1b4a` / solution `815→811`）；③ 嵌入 frozen diff 恰 **2 條 sanctioned 變更行**（L29 handler 簽名 + L143 `takenRows` const annotation）、無夾帶；④ row 型別 `{id:number; user_id:number|null}` 對 `RETURNING id,user_id` + schema（`requisition.id` PK INTEGER / `user_id` nullable INTEGER）型別正確、downstream（`r.id`/`takenRows[0]?.user_id`）自洽。**review agents 未污染 git**（主線獨立驗：`git status --porcelain` 僅 2 untracked〔`CLEANUP_PLAN.md` + 本 plan doc〕、staged 空、`git diff HEAD -- functions/` 空、register blob 回 `18976c9e`、HEAD `58664200`）→ PR-2ck stray-checkout 未復發。
- 2026-06-21 **plan doc commit `cbec3086`**（branch `stage7-pr2co-register`、local、未 push、plan-only +323 / 0 source；commit 前後核 staged set 僅 plan doc、`git diff 58664200..HEAD -- functions/` 空、register blob 仍 `18976c9e`）→ 中文報告 6 欄（gate-state `PLAN_SELF_REVIEW_CLEAN`）→ owner 驅動產自足 **ChatGPT Arch packet**（`~/Desktop/chiyigo-pr2co-arch-packet.md`，repo 外、§0 角色+裁決格式 / §1 scope+base / §2 frozen diff / §3 OD ruling+row 型別實證 / §4 依賴簽名 env=full Env / §5 security invariants / §6 evidence / §7 non-goals / §8 Env ambient glossary / §9 base source @ `58664200` / §10 verdict format）→ 貼入送外部 ①。
- 2026-06-21 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Blocker / 0 Required Revision / 3 NB**）— 8 維全 **PASS**（Scope 隔離 / OD 合理性 / Precedent 一致性 / Runtime neutrality / Security invariant 保全 / Evidence 自洽 / Coverage honesty / Isolation·non-goals）；**6 OD 全 APPROVED**（`request: Request` / `env: Env` full / `waitUntil?` optional / `takenRows` const row type 為正確斷鏈點且只露 `id`/`user_id` 最小欄位 / 不新增 shared type / 不引入 workers-types）。
  - **Binding locks CL-1..CL-8（ChatGPT Arch；② Codex Plan 與 Code 階段須保留）**：CL-1 只改 `register.ts`；CL-2 source diff 僅 2 編輯點（handler param annotation + `takenRows` const annotation）；CL-3 handler `request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void`；CL-4 D1 row `Array<{ id: number; user_id: number \| null }>`、**禁 callback-param-only、禁 full table type**；CL-5 runtime（Turnstile / email duplicate / PBKDF2 / batch INSERT / guest takeover / refresh token / JWT / audit / email send / cookie·body response）全不動；CL-6 security non-addition（**禁新增 rate-limit、禁補 RESEND guard、禁改 waitUntil guard**）；CL-7 Code 階段必重跑 forced tsc sort-diff / ratchet report / tests-leaf / byte-identical / `git diff --check`；CL-8 faithfulness — actual diff 必與 frozen diff byte/line-level 對齊、任何額外 formatting·comment·import 變更即 fail。
  - **NB-1（非阻擋）**：Code 階段需重新 replay，不得沿用 spike 數字作 final evidence（對齊 plan L12 / §驗證計劃 NB-2 雙證）。**NB-2（非阻擋）**：row 型別 `{ id: number; user_id: number \| null }` 的 schema 依據（`requisition.id` PK INTEGER / `user_id` nullable INTEGER）須在 **Code Gate packet ＋ Faithfulness packet** 仍保留，避免 Faithfulness 階段失去脈絡。**NB-3（非阻擋）**：中文報告續寫 **impl L1 / review care L3**，不得改成整體 L1（避免 reviewer 降級熱區）。
  - **可送 ② Codex Plan Gate；非 coding 授權，待 ② 通過 + owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-21 owner 驅動產 **Codex Plan packet**（`~/Desktop/chiyigo-pr2co-codex-plan-packet.md`，repo 外、§0 角色+裁決格式 / §1 base+plan doc path / §2 frozen diff / §3 獨立 replay 程序 / §4 待填對照表 / §5 CL-1..CL-8 核對 / §6 row 型別 schema 依據〔NB-2〕 / §7 verdict format；Codex 有 repo 存取故聚焦獨立 replay）→ 送外部 ②。
- 2026-06-21 **Codex Plan Gate（② 維度 C）r1：`CHANGES_REQUESTED`**（**機械 replay 全 PASS、CL-1..CL-8 全 PASS、row schema 核實、Queue/payment/distributed/state/observability N/A**，唯 **2 項 docs-only 證據敘述不精確 → 依 packet「任一 MISMATCH 即 blocking」判 CHANGES_REQUESTED**）：① 機械重驗全數值**獨立重現**（base solution 815 / register 4 錯〔3 TS7031 + 1 TS7006〕 / patched 811 / 殘留 0 / sort-diff REMOVED 4·ADDED 0 / tests-leaf 0 / ratchet 811·81·253·334 / emit 7563·7563 / sha `9227b6b914ec9664` 兩端 / `diff -q` IDENTICAL / frozen blob `18976c9e→778c1b4a` / numstat 2·2 / baseline 1119·175 不變）。**Required Revision 2（皆 docs-only、不推翻 ① 架構裁決）**：(R1) §byte-identical 適用性「8 import 群」與其後 11 模組列表 + §隔離區「11 檔 import」內部矛盾 → 校正為 **11 import statement**；(R2) coverage/caller 收斂 — 除 `register.test.ts`，`jwt-sid-claim.test.ts` **亦** direct import register handler（補列）；且兩測試檔**未設 `TURNSTILE_SECRET_KEY`/未斷言 `CAPTCHA_FAILED`** → 只走 missing-secret skip path、**不得無限定宣稱「涵蓋 Turnstile」**（校正為 skip-path only、fail-close 0 test）。
- 2026-06-21 Claude **docs-only 修正（R1+R2）** → 對抗式單 agent self-review（v3.1 §9：外部 finding 小 scope 修正用單 agent、未達 L2/L3 規模不重跑 workflow）：先**獨立查證** Codex 兩 finding 屬實（`grep -cE "^import " register.ts` = **11**；`jwt-sid-claim.test.ts:28` `await import('…/register')` + `:50` `callFunction(registerPost,…)` 確為第 2 importer；`grep TURNSTILE_SECRET_KEY/CAPTCHA_FAILED/cf-turnstile-response` 於兩測試檔 = **空** → 確 skip-path only）→ 修 §167 import 數、§108 caller cascade 補第 2 importer、§219 coverage 表補第 2 檔、§222 下鑽證據校正 Turnstile skip-path、§247 targeted int 補 jwt-sid-claim。**0 source 改動**（純 plan doc）。
- 2026-06-21 owner 驅動送 **Codex Plan r2 delta packet**（`~/Desktop/chiyigo-pr2co-codex-plan-r2-delta.md`，repo 外、聚焦增量：r1→r2 只改 plan doc `fa5e3fee→0f79fb72`、0 source、frozen diff + 機械證據未變、僅校正 R1/R2 兩處敘述 + 可獨立核命令）。
- 2026-06-21 **Codex Plan Gate（② 維度 C）r2：`CODEX_PLAN_APPROVED`**（**0 blocking / 0 required revision**）— r1 兩 finding 完整關閉：import 數 11 statements（PASS）/ direct importers `register.test.ts` + `jwt-sid-claim.test.ts`（PASS）/ Turnstile coverage 明確限定 skip path、fail-close 0 test（PASS）/ commit scope 僅 plan doc +11/−7（PASS）/ source blob 未動仍 `18976c9e`（PASS）/ CL-1..CL-8·OD·frozen diff 未漂移（PASS）/ hygiene diff-check clean·staged 空·僅 `CLEANUP_PLAN.md` untracked（PASS）。r1 機械 replay 證據持續有效（source/tests/schema/baseline/configs 均未改）；Queue/payment/state consistency/distributed/observability **N/A**。**Plan Gate 雙道（① ChatGPT Arch + ② Codex Plan）全過 = plan 批准；仍非 coding 授權，待 owner 明示 `CODING_ALLOWED`。**
- 2026-06-21 **owner `CODING_ALLOWED` ✅** → 進 Code 階段。
- 2026-06-21 **Code 階段（source commit `08d17fba`）**：落地唯二編輯點 — L29 `onRequestPost({ request, env, waitUntil }: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void })` ＋ L143 `const takenRows: Array<{ id: number; user_id: number \| null }> = taken?.results ?? []`。`git diff 58664200..08d17fba -- functions/` = register.ts **+2/−2**、blob `18976c9e→778c1b4a`、numstat `2 2`；全樹 name-status 僅 plan doc(A) + register.ts(M)、無 stray 檔。**full replay gates 全綠（@ source、不沿用 spike、CL-7）**：byte-identical（canonical `esbuild --loader=ts --format=esm` stdin，base `58664200` 與 head `08d17fba` 皆 via `git show`）兩端 **7563B** sha `9227b6b914ec9664`、stderr 0、`diff -q` IDENTICAL · forced solution sort-diff（HEAD patched 811 / checkout-dance base 815、restore 後嚴驗 working clean blob `778c1b4a`）**REMOVED=4 / ADDED=0** · tests-leaf forced **0**（無 register.ts 錯、exit 0）· ratchet enforce〔`RATCHET_BASE_REF=58664200`〕**OK**（baseline 1119/175、current **811/253**）· `git diff 58664200..HEAD --check` clean · **lint green**（eslint functions tests + compat-date ok + workflows OK）· **build:functions「Compiled Worker successfully」** · **targeted int `register.test.ts`(14) + `jwt-sid-claim.test.ts`(3) = 17/17 passed**（runtime 旁證；測試清單含「無/有 RESEND_API_KEY」案例、**無 Turnstile fail-close 案例** 印證 coverage 校正＝skip-path only）。**NB-2 雙證齊**（byte-identical receipt @ committed blobs + source diff 逐行 == frozen 2 行，不以 ratchet 數字單獨代表 runtime 不變）。
- 2026-06-21 **Code self-review = multi-agent workflow（維度 A，3 agents 三維：diff-fidelity / runtime·security / evidence；run `wf_f2acc427-f12`、3 agents / ~166k subagent tokens / 150 tool uses / ~11min）→ `CODE_SELF_REVIEW_CLEAN`**：三維 finder（pipeline + adversarial verify、default refuted、Explore read-only、可跑 read-only git/esbuild/tsc 獨立驗）**全 0 findings、accepted 0、suspicious 0**。**主線獨立對抗式裁決（非採 raw 輸出，v3.1 §5）認同 clean**：① committed diff 逐字 == frozen 2 sanctioned 行（`onRequestPost` 簽名 + `takenRows` const annotation）、`git diff 58664200..HEAD --name-status` 全樹僅 plan doc + register.ts、numstat 2/2；② 主線親跑 full replay 全綠（byte-identical 7563B sha `9227b6b9`、sort-diff REMOVED=4/ADDED=0、ratchet 811/253、tests-leaf 0、lint 0、build Compiled、int 17/17）；③ 無 PR-2cn 數據洩漏。**review agents 未污染 git**（主線獨立驗：`git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、HEAD `08d17fba`、register blob `778c1b4a`、staged 空、`git diff HEAD -- functions/` 空、net numstat 2/2）→ PR-2ck stray-checkout 未復發。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；不得 merge 除非 owner 明示 `MERGE_ALLOWED`。**
- 2026-06-21 owner 驅動產 **Codex Code packet**（`~/Desktop/chiyigo-pr2co-codex-code-packet.md`，repo 外、committed diff + 機械重驗 12 項 @ committed + CL-1..CL-8 核對 + row 型別 schema 依據〔NB-2〕+ Code self-review 摘要 + 覆蓋誠實；Codex checkout branch 獨立 replay）→ 送外部 ③。
- 2026-06-21 **Codex Code Gate（③ 維度 C）：`CODEX_CODE_APPROVED`**（**0 Critical / High / Med / Low**）— 機械重驗 committed code（source commit `08d17fba`）全數**獨立重現**：source diff 僅 `register.ts` 2/2、source commits 僅 `08d17fba`、solution 815→811（register 4→0）、sort-diff REMOVED 4·ADDED 0、tests-leaf exit 0、ratchet OK（1119/175 → current 811/253）、emit 7563B sha 完全相同·IDENTICAL、lint green·build Compiled、targeted integration **17/17 passed**、hygiene（diff-check clean·staged 空·僅 `CLEANUP_PLAN.md` untracked）。**CL-1..CL-8 全 PASS**；row 型別與 schema 相符（`id: number`、`user_id: number | null`）。Turnstile fail-close 仍 0 direct test，但**已誠實揭露**、本次 runtime byte-identical → 屬既有非阻擋殘留。State consistency / queue / payment / distributed state / observability **N/A**。**可進 ④ ChatGPT Faithfulness；此批准不構成 merge 授權**（④ + merge-front gates + owner `MERGE_ALLOWED` 仍必走）。
- 2026-06-21 **模型層級揭露 + Code self-review 重跑（owner 裁定 (1)）**：發現本 PR 兩支維度 A workflow（plan `wf_630b5500-8d3` + code `wf_f2acc427-f12`）用 `agentType: 'Explore'`，依 owner 當日剛 land 的 memory [[feedback_selfreview_workflow_model_inheritance]]，Explore 自帶 `model: haiku` → finder/verifier 實跑 **Haiku 4.5**（非 session Opus 4.8）。維度 A 為上游放大器、不取代外部 gate（①②③ 皆外部全能力跑、皆 APPROVED → PR 正確性未受影響）；主動揭露後 owner 裁定**重跑 Code self-review**。`readonly-reviewer` global agent 本 session registry 未載（agent 檔當日 21:34 才建、session 啟動已快照）→ 改用 memory 文件化解析序「opts.model > agentType frontmatter > 繼承 session」：**`agentType: 'Explore' + model: 'opus'`**（保 Explore 結構性 read-only、override haiku pin → **Opus 4.8**）。
- 2026-06-21 **Code self-review v2（維度 A、Opus 4.8、run `wf_e00f766e-9e2`、3 agents 三維 diff-fidelity/runtime·security/evidence、~152k tokens / 32 tool uses）→ `CODE_SELF_REVIEW_CLEAN`（正確模型層級確認）**：三維 finder **全 0 findings、accepted 0、suspicious 0**（與 Haiku v1 + 外部 Codex ③ 三方一致）。**主線獨立對抗式裁決認同 clean**（committed diff 逐字 == frozen 2 行、full replay 全綠已親驗、無 PR-2cn 洩漏）。**review agents 未污染 git**（HEAD `1123a032`、register blob `778c1b4a`、staged 空、`git diff HEAD -- functions/` 空）。**往後本 session 所有 inline self-review/audit workflow 一律用 `Explore + model:'opus'`（或 readonly-reviewer，若 session 重啟後可載）**。
- 2026-06-21 owner 驅動產 **ChatGPT Faithfulness 複核包**（`~/Desktop/chiyigo-pr2co-chatgpt-faithfulness-packet.md`，repo 外、§6 format：approved plan 錨點〔①②③ verdict + OD 裁決〕 + 機械 git artifacts〔`git show 08d17fba --name-status` + `git diff 58664200..HEAD --name-status` + `--stat` + 反 curated-diff 聲明〕 + frozen vs actual diff 並排逐行一致 + 14 項 Faithfulness Matrix + 偏離 self-report〔0〕 + self-review 摘要 + row 型別 schema 依據〔NB-2〕）→ 送外部 ④。
- 2026-06-21 **ChatGPT Code Faithfulness Gate（④ 維度 B-code）：`CHATGPT_CODE_FAITHFULNESS_APPROVED`**（**14/14 Faithful、0 deviation / 0 scope creep**）— approved frozen diff 與 actual committed source diff（`58664200..08d17fba`）逐行一致；14 項 matrix 全 Faithful（改動檔範圍 / 編輯點數 2 / request·env·waitUntil OD / L144 row 型別 const 斷鏈 / waitUntil 仍 optional / guard 未改 / 未補 RESEND guard / 未新增 rate-limit / 未改 SQL·runtime 熱區 / 未引入 import·ambient·workers-types / 未碰 login·util·end-session·tests·env·tsconfig·baseline / 無格式·註解·return-type drift）；**反 curated-diff**：`git show 08d17fba --name-status` 僅 `M register.ts`、`git diff 58664200..HEAD --name-status` = plan doc(A) + register.ts(M)、**無未附 hunk 的 source 檔**；**0 可信 Tier 0/1 finding**（不 invalidate ③）。**外部 4 道全過（① ChatGPT Arch + ② Codex Plan + ③ Codex Code + ④ ChatGPT Faithfulness）。** 非 merge 授權：merge-front 7 gates + owner `MERGE_ALLOWED` 仍必走。
- 2026-06-21 **merge-front 7 gates 全綠（@ source `08d17fba`、CI-equivalent，[[feedback_pre_merge_gate_checklist_match_ci]]）**：`lint` ✅ · `typecheck:ratchet`〔`RATCHET_BASE_REF=58664200`〕✅（baseline 1119/175 不變、current **811/253**）· `verify:browser-pipeline` ✅（25 pages / 214 refs content-hash equal、module-prod byte-equal）· `test:cov` ✅（**737 tests / 25 files passed**、Statements **90.28%** 1933/2141、Branches 92.77%、Functions 92.08%、Lines 90.28%）· `test:int` ✅（**1328 tests / 75 files passed**、659s）· `build:functions` ✅（Compiled Worker successfully）· `npm audit --omit=dev --audit-level=high` ✅（**0 vulnerabilities**）。post-gate working tree 僅 `?? CLEANUP_PLAN.md`（coverage/.tmp-* gitignored 未污染）、HEAD `f47652e7`、register blob `778c1b4a`、net source 2/2。**外部 4 道 + merge-front 7 gates 全綠；待 owner `MERGE_ALLOWED` → squash-merge `--delete-branch`。**
- （後續 dated 收錄：owner `MERGE_ALLOWED` → push branch + 開 PR + squash-merge `--delete-branch` → 監看 main CI + Cloudflare deploy → SHIPPED memory）

## owner 鎖定表（C-1 ruling 2026-06-21，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 只改 `functions/api/auth/local/register.ts`；**納入全 4 錯**（含 L144），目標 register.ts 0 noImplicitAny、cleanFiles +1 |
| L2 Handler type shape | `request: Request`、`env: Env`、`waitUntil?: (promise: Promise<unknown>) => void`（複用 #110 optional 先例）|
| L3 L144 OD = const 層斷鏈 | `const takenRows: Array<{ id: number; user_id: number \| null }> = taken?.results ?? []`；斷開 `.map(r)` ＋ `takenRows[0]?.user_id` 兩處 any-chain；只露 `id`/`user_id`；**禁** callback-param-only、**禁** full table type、**禁** 改 SQL |
| L4 No new shared type / no util change | 不新增 shared type、不改任何 util signature |
| L5 RESEND lock | 不碰 `RESEND_API_KEY` 行為（本檔 L217 已有 `if (env.RESEND_API_KEY)` guard、無 possibly-undefined；補 guard / 動現有 guard = scope creep）|
| L6 waitUntil guard lock | 不改 `typeof waitUntil === 'function'` guard、不改 required |
| L7 No new rate-limit | register 本無 `checkRateLimit/recordRateLimit`；**本 PR 禁新增任何安全功能**（type-only、不改防禦面）|
| L8 Runtime hot-zone lock | 不改 Turnstile fail-close / email 重複檢查 / PBKDF2 hash / 原子 batch INSERT / guest takeover SQL·audit / refresh token·session_id / JWT 簽發·tenant claims / `safeUserAudit` / email 寄送 via `waitUntil` / `isWebClient`·Set-Cookie·body refresh_token / response·error code |
| L9 Spike evidence | full-solution spike 必須**非 commit**，證明 **REMOVED=4 / ADDED=0** |
| L10 byte-identical evidence | byte-identical 必須是 **type-strip / canonical emit 證據**（esbuild `--loader=ts --format=esm` stdin），不接受「測試通過」替代 |
| L11 Coverage | 逐 sub-path 下鑽；handler 有 direct integration test，但 type-only 改動 runtime 不可見 → **主硬保證 = byte-identical**，integration test 僅作 runtime 旁證、不宣稱「覆蓋型別標註」（[[feedback_pr_coverage_claim_accuracy]]）|
| L12 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical / tests-leaf；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L13 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / coverage overclaim / 偏離 C-1 裁定 OD（改 required / 補 RESEND guard / 動 guard / 新增 rate-limit / callback-param-only / 改 SQL）→ 退回 `PLAN_DRAFT` |

## ⚠ register 熱區聲明（review care L3，Tier-0 帳號創建入口）

`auth/local/register.ts` 為**本地帳號創建入口**：解析 body → 驗 email/password → Turnstile fail-close → email 重複檢查 → PBKDF2 密碼 hash → email 驗證 token → **原子 batch INSERT users+local_accounts+email_verifications** → guest takeover（best-effort，UPDATE requisition + audit）→ refresh token（+ session_id + device_uuid）→ JWT access token（+ tenant claims）→ account.register audit → email 寄送 via `waitUntil` → `isWebClient` 決定 Set-Cookie refresh / body refresh_token。修法若非純型別、或牽動下列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L5/L6/L7/L8）：

| 區塊 | 紅線（typing 全程不得牽動）|
|---|---|
| 輸入驗證 | `EMAIL_RE.test(email)` / `validatePassword(password)` / `!email \|\| !password` guard 不動 |
| Turnstile fail-close | `verifyTurnstile(request, body, env)` → `!ts.ok` 回 `CAPTCHA_FAILED` 403 |
| email 重複檢查 | `SELECT id FROM users WHERE email=? AND deleted_at IS NULL` → 命中回 `EMAIL_ALREADY_REGISTERED` 409 |
| 密碼 hash | `generateSalt()` + `hashPassword(password, salt)`（PBKDF2）|
| 原子 batch | `db.batch([INSERT users, INSERT local_accounts SELECT…, INSERT email_verifications SELECT…])` 順序·子查詢取 user_id·原子性 不動 |
| guest takeover | `isValidGuestId` 驗 `web-<uuid>` 格式 / invalid-format audit（10% deterministic sampling + `hashIdentifierForAudit`）/ `UPDATE requisition SET owner_user_id…user_id…owner_guest_id=NULL … RETURNING id, user_id` / `requisition.takeover` audit；**SQL·sampling·audit 全不動**（L144 只標 `takenRows` 承接型別）|
| refresh token | `generateSecureToken()` + `hashToken()` + `INSERT refresh_tokens (…, session_id)` + `device_uuid ?? null` + `issued_aud` 不動 |
| JWT 簽發 | `resolveActiveTenantClaims(env.chiyigo_db, Number(user.id))` + `signJwt({…claims}, ACCESS_TOKEN_TTL, env, { audience })` 不動 |
| email 寄送 | `if (env.RESEND_API_KEY) { sendTask = sendVerificationEmail(env.RESEND_API_KEY,…,env).catch(…); if (typeof waitUntil === 'function') waitUntil(sendTask) }` 全不動 |
| 回應通道 | `isWebClient(request, { platform })` → web 走 `Set-Cookie: refreshCookie(...)` 201 / 非 web 走 body `refresh_token` 201；不動 |
| Audit | `safeUserAudit(env, { event_type:'account.register', user_id:user.id, request })` + guest 兩路 audit 不動 |

註：本刀只在 ① 唯一 exported handler `onRequestPost` 簽名 ② L143 `const takenRows` 承接型別 加標註，TS erase 後 runtime byte-identical（SQL / 常數 / audit·log / 字串 / 註解 / `waitUntil` guard / guest takeover 全不變）。

### Coding 階段硬性邊界

- **允許**：① `onRequestPost({ request, env, waitUntil })` 加 `: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void }`；② `const takenRows = taken?.results ?? []` 加 `: Array<{ id: number; user_id: number | null }>`（§frozen diff 唯二變更行）。
- **禁止**：改任何 SQL / Turnstile fail-close / email 重複檢查 / PBKDF2 hash / 原子 batch / guest takeover SQL·sampling·audit / refresh token·session_id / JWT 簽發·tenant claims / email 寄送·`waitUntil` guard / `isWebClient`·Set-Cookie·body refresh / `safeUserAudit` / response body·error code / `RESEND_API_KEY` 行為（不補·不動現有 guard）/ **新增 rate-limit** / caller（`login.ts`/`forgot-password.ts`）/ shared util（11 檔 import）/ `end-session.ts` / tests / `env.d.ts` / `tsconfig`·`eslint`·`vitest` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types` / required `waitUntil` shape / callback-param-only L144 寫法 / full table type / **碰 A3 殿後檔 `local/login.ts`** / 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `58664200`）

### exact errors（forced `tsc -b tsconfig.solution.json --force`，solution total 815）

```
functions/api/auth/local/register.ts(29,39): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/local/register.ts(29,48): error TS7031: Binding element 'env' implicitly has an 'any' type.
functions/api/auth/local/register.ts(29,53): error TS7031: Binding element 'waitUntil' implicitly has an 'any' type.
functions/api/auth/local/register.ts(144,41): error TS7006: Parameter 'r' implicitly has an 'any' type.
```

**恰 4 個**（**非 owner 預期的 3**）：3×TS7031（`onRequestPost` 單一 destructure param 的 `request`/`env`/`waitUntil` @ L29）＋ **1×TS7006**（guest takeover `takenRows.map(r => r.id)` callback param `r` @ L144）。**單一 handler**（無 `onRequestGet`、無 wrapper/worker、無其他 export）。

> ⚠ **L144 第 4 錯與 3 個 binding element 互相獨立**：`db = env.chiyigo_db`、`D1Database` 解為 `any`（[[feedback_d1database_resolves_any_no_workers_types]]，`@cloudflare/workers-types` 未裝、無 `interface D1Database` 宣告），`taken = db.prepare(...).all()` → `taken?.results ?? []` 為 `any`，`any.map(r=>…)` callback 無 contextual type → TS7006（[[feedback_ts_any_chain_breaks_contextual_typing]]）。標註 `env: Env` 後 `env.chiyigo_db` 仍解為 `D1Database`→`any` → **L144 不會自動消失、需獨立斷鏈**（spike 實證：只標 handler 簽名不夠，須同標 L143 const）。
> ⚠ 無 `request.cf` → plain `Request`、**禁引入 `CfRequest`**（owner 排除）。

### 依賴邊界（caller cascade）

`register.ts` 是 Pages file-routing entry，cascade 面：

| 面 | 判定 | 證據 |
|---|---|---|
| `onRequestPost` 外部 TS caller | **0 牽動** | `grep local/register` 於 functions/ **無任何 TS/JS importer**（production 0）；直接消費端＝**2 個 integration test**：`tests/integration/register.test.ts` ＋ `tests/integration/jwt-sid-claim.test.ts`，皆 `await import` 取 `onRequestPost`、經 `callFunction(handler, request)`〔`_helpers.ts:324` `handler` **untyped**〕呼叫 → 型別連結被切斷、annotate 不引入 tests-leaf 新錯（spike tests-leaf 0→0 實證）|
| shared `verifyTurnstile` caller | **不牽動** | 本檔 L46 `verifyTurnstile(request, body, env)`；annotate 後 `Request`→param1 `Request` ✓、`body`(any)→`Record<string,unknown>` ✓、`Env`→`Pick<Env,'TURNSTILE_SECRET_KEY'>` ✓ 全 assignable；**不改 util、不牽動另 2 caller**〔`login.ts`/`forgot-password.ts`〕。`assist.ts:221` 為同名 local 函式（homonym，非此 util caller）|
| intra-file env / request / waitUntil 存取 | 全相容 | `request.json()`(WebWorker lib→`any` body)、`env.chiyigo_db`(D1Database→any)、`env.RESEND_API_KEY`(env.d.ts `RESEND_API_KEY?: string`→`string\|undefined`，L217 `if` narrow 成 `string`)、`resolveAud`/`validatePassword`/`buildTokenScope`/`isWebClient`/`refreshCookie`/`hashIdentifierForAudit`/`safeUserAudit`/`resolveActiveTenantClaims`/`signJwt`/`sendVerificationEmail` 各 util param 全 assignable（spike ADDED=0 實證）、`waitUntil(sendTask)`〔`Promise<void>`→`Promise<unknown>` ✓〕；**無 `.cf`** |
| L144 const annotation 內部 cascade | 全自洽 | `takenRows: Array<{id:number; user_id:number\|null}>` 後：`takenRows.map(r => r.id)` → `r: {id;user_id}`、`r.id: number`（TS7006 消）；`allTakenIds: number[]`；`takenIds = .slice(…)` → `number[]`；`takenRows[0]?.user_id ?? null` → `number\|null`；`newUserId` → `number\|null` 流入 `safeUserAudit(env,{user_id:newUserId,…})`〔util untyped→吃任何值〕；`requisition_ids:takenIds`/`count:allTakenIds.length` 全在 audit data（any 消費）→ spike ADDED=0 證 0 cascade |

**precedent landscape（佐證 OD ruling）**：
- **`request: Request` / `env: Env` 直連 handler**＝repo 主流 Convention A（數十檔已清，含同域 #109 `email/verify.ts` POST / #110 `forgot-password.ts`）→ **零新 OD**；`env` 用 **full `Env`**（handler 整包 forward `verifyTurnstile`/`safeUserAudit`/`hashIdentifierForAudit`/`resolveActiveTenantClaims`/`signJwt`/`sendVerificationEmail`），util 各收 `Pick`/`Partial`/untyped、full Env structural assignable（[[feedback_util_env_param_pick_not_full_env]]：handler 用 Env、util 用 Pick）。
- **`waitUntil` 型別化**＝**複用 PR-2cn #110 已立的 optional 先例**（`_middleware.ts:33` canonical lambda `(promise: Promise<unknown>) => void` + `?`）；本檔 L220 guard 與 #110 L133 逐字相同、`sendTask` = `Promise<void>` → **零新 waitUntil OD**。
- **L144 D1-result-row `.map` callback 型別化**＝**本 A 域首個此形態 OD**。repo 既有兩種先例：① inline `Record<string, unknown>` 於 callback param（`deals/aggregate.ts:63`、`metrics.ts:109`、`users.ts:77`）；② named/inline typed row via `const x: RowType[] = results ?? []`（`event-dlq/index.ts:76` `const rowList: DlqRow[] = results ?? []`、`payments/aggregate.ts:92` `as RefundRow[]`）。**C-1 裁定走 ②的 const 層 + inline 最小 2-field shape**（斷鏈點在 `takenRows`，同時覆蓋 `.map(r)` 與 `takenRows[0]?.user_id`；只露本區塊實用欄位、不引入 full table type）。

### 型別選型（owner C-1 OD ruling）

允許落地的唯二 source diff（2 編輯點）：

```ts
export async function onRequestPost({ request, env, waitUntil }: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void }) {  // L29
...
      const takenRows: Array<{ id: number; user_id: number | null }> = taken?.results ?? []  // L143
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| `request` | **`Request`（plain）** | `request.json()`(→`any` body) + 傳 `verifyTurnstile`/`safeUserAudit`/`hashIdentifierForAudit`/`isWebClient`；**無 `.cf`** → 非 `CfRequest` |
| `env` | **`Env`（full，Convention A）** | 整包 forward 6+ util；`env.chiyigo_db`(any) + `env.RESEND_API_KEY`(declared)；spike ADDED=0 證零 cascade |
| `waitUntil` | **`waitUntil?: (promise: Promise<unknown>) => void`（複用 #110 optional）** | guard 與 #110 L133 逐字相同、`sendTask` Promise<void>；**零新 OD**、不改 required（guard 變靜態恆真） |
| L144 `r` | **const 層斷鏈 `Array<{ id: number; user_id: number \| null }>`（C-1 strategy a）** | `requisition.id` = `INTEGER PRIMARY KEY AUTOINCREMENT`→`number`；`requisition.user_id` = nullable `INTEGER`(0001 ALTER ADD)→`number\|null`（見 §row 型別實證）；斷 `.map(r)` + `takenRows[0]?.user_id` 兩處；只露 `id`/`user_id` |
| OD 形態 | **`request`/`env`/`waitUntil` 零新 OD（複用先例）；L144 = A 域首個 D1-row map callback OD（C-1 裁 const 層斷鏈）** | 單一 direct handler、套 Convention A + #110 waitUntil + ② const-typed-row 先例 |
| required `waitUntil`（**否決**）| **禁** | guard 變靜態恆真（語意漂移）、未來 login/end-session 先例變差 |
| callback-param-only L144（**否決**）| **禁** | C-1：只標 `(r: …)` 不涵蓋 `takenRows[0]?.user_id`、不如 const 層穩；走 const 斷鏈 |
| `RESEND_API_KEY` guard（**否決**）| **禁** | 本檔 L217 已有 `if (env.RESEND_API_KEY)` guard、無 possibly-undefined；補/動 guard = 行為改動 |
| 新增 rate-limit（**否決**）| **禁** | register 本無 rate-limit util；type-only PR 禁新增安全功能（owner 校正：防禦＝Turnstile + email unique）|
| full table type / 改 SQL / return type / JSDoc / 格式 | **不引入 / 不改 / 不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 4 錯 |

### row 型別實證（C-1：型別由 SELECT 欄位 + D1 schema + repo 既有 D1-row 先例定讞）

| 欄位 | SELECT 來源 | D1 schema | 型別 | 用途 |
|---|---|---|---|---|
| `id` | `RETURNING id, user_id`（L139 `UPDATE requisition`）| `requisition.id INTEGER PRIMARY KEY AUTOINCREMENT`（`migrations/0000_base.sql:70`）| **`number`** | `r.id`（L144）→ `allTakenIds`/`takenIds` → audit `requisition_ids` |
| `user_id` | 同上 RETURNING | `requisition.user_id INTEGER`（nullable，`migrations/0001_requisition_upgrade.sql:4` ALTER ADD）| **`number \| null`** | `takenRows[0]?.user_id ?? null`（L149）→ `newUserId` → `safeUserAudit user_id` |

> `safeUserAudit(env, entry)` 之 `entry` 參數**未標註（util 自身仍在 errorFiles、`entry` 為 `any`）**→ 傳入 `number\|null` 的 `newUserId` 0 cascade（且 C-1 鎖禁改 util 簽名、正好不需動）。只露 2 欄位（`id`/`user_id`）符 C-1「禁 full table type、只露本區塊實用欄位」。

## Spike 實證（full-solution，本地未 commit，2026-06-21，已 revert clean）

**程序**：建 branch（自 clean main `58664200`）→ 量 base（forced solution 815、register 4 錯、base emit 7563B sha `9227b6b9…`）→ 套 2 編輯點（Edit L29 + L143）→ forced `tsc -b tsconfig.solution.json --force`（sorted error set diff）→ forced `tsc -b tsconfig.tests.json --force`（tests-leaf）→ ratchet report → canonical byte-identical（esbuild stdin）→ frozen diff + `git diff --check` → `git checkout --` revert → 驗 clean（blob 回 `18976c9e`、staged 空、`git status` 僅 `?? CLEANUP_PLAN.md`）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| register errors 4 → 0 | ✅ sort-diff REMOVED = 恰 4 行（`(29,39)` `request` / `(29,48)` `env` / `(29,53)` `waitUntil` TS7031 ＋ `(144,41)` `r` TS7006）；patched 0 殘留 |
| solution errorCount 815 → 811（恰 −4）| ✅ forced tsc solution **811**；sort-diff ADDED = **空（0）** |
| zero cascade（functions + tests + scripts + browser，全 solution）| ✅ solution sort-diff **REMOVED=4 / ADDED=0**；另 `tsc -b tsconfig.tests.json --force` **base 0 → patched 0**（無 register.ts 錯、exit 0）|
| canonical ratchet `--report`（base → patched）| ✅ base errorCount **815** / errorFiles **82** / cleanFiles **252** / sourceFilesTotal **334** → patched **811** / **81** / **253** / **334** |
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`** stdin，[[feedback_byte_identical_emit_verification]]）| ✅ esbuild **stdin** type-strip base vs patched **IDENTICAL**、皆 **7563B**、esbuild stderr 空：<br>sha256 兩端前 16 碼 `9227b6b914ec9664` |
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace / lone space）|
| frozen diff numstat | ✅ `2  2`（2 insertion / 2 deletion；無 whole-file CRLF churn）；base blob `18976c9e` → head blob `778c1b4a` |
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、blob 回 `18976c9e`、staged 空 |

**byte-identical 適用性**：register.ts **11 個 import statement**（crypto / jwt / tenant-context / email / password / cors / scopes / turnstile / auth / cookies / user-audit，11 模組各一行）→ esbuild stdin transform **適用**（單檔 transform、import 行原樣保留；非完整 bundle，但 type-only annotation PR 這正是對的證明面——改動僅限本單檔、其他檔 byte 不變 → bundle 等價）。⚠ 用 **stdin**（`<` / pipe），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell，[[feedback_byte_identical_emit_verification]]）；本 spike emit 7563B 非空、已排除該坑。`waitUntil` + L144 const annotation 含 handler 仍是單檔 type-strip transform 適用。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/local/register.ts b/functions/api/auth/local/register.ts
index 18976c9e..778c1b4a 100644
--- a/functions/api/auth/local/register.ts
+++ b/functions/api/auth/local/register.ts
@@ -26,7 +26,7 @@ const ACCESS_TOKEN_TTL   = '15m'
 const VERIFY_TOKEN_HOURS = 24
 const REFRESH_TOKEN_DAYS = 7

-export async function onRequestPost({ request, env, waitUntil }) {
+export async function onRequestPost({ request, env, waitUntil }: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void }) {
   // ── 1. 解析 Body ────────────────────────────────────────────
   let body
   try { body = await request.json() }
@@ -140,7 +140,7 @@ export async function onRequestPost({ request, env, waitUntil }) {
         `)
         .bind(emailLower, emailLower, guest_id)
         .all()
-      const takenRows = taken?.results ?? []
+      const takenRows: Array<{ id: number; user_id: number | null }> = taken?.results ?? []
       const allTakenIds = takenRows.map(r => r.id)
       // Codex r5 #4（2026-05-10）：requisition_ids cap，避免訪客跨多日累積大量 row 後 audit 過大
       const TAKEN_IDS_CAP = 100
```

`git diff --stat`：1 file changed, 2 insertions(+), 2 deletions(-)；`git diff --numstat`：`2  2`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `58664200` `--report`：errorCount **815** / errorFiles **82** / cleanFiles **252** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **815 → 811**（−4）、errorFiles **82 → 81**、cleanFiles **252 → 253**（spike 實測值、非預測；register 全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 811」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = ① 唯一 exported handler `onRequestPost` 簽名型別標註 ② L143 `const takenRows` 承接型別標註，TS erase 後 runtime byte-identical（§Spike sha `9227b6b9…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 815、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。

## 測試影響面（覆蓋誠實，L11 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf base 0 → patched 0、無 register.ts 錯、exit 0 實證）。
- **覆蓋分層（誠實，逐 sub-path 下鑽）**：

| 標的 | direct test | indirect | 真打路徑 | 硬保證 |
|---|---|---|---|---|
| `local/register.ts`（handler `onRequestPost`）| ✅ **有**（**2 檔**：`tests/integration/register.test.ts` ＋ `tests/integration/jwt-sid-claim.test.ts`）| — | `await import('…/register')` 直取 `onRequestPost` + `callFunction`（兩檔皆 untyped 切斷型別連結）| **byte-identical 為主硬保證**；integration test 為 runtime 旁證 |

- **下鑽證據（不 overclaim）**：
  - direct integration test（`register.test.ts` ＋ `jwt-sid-claim.test.ts`、皆 mock `sendVerificationEmail`）涵蓋 register happy / 重複 email / web vs non-web cookie / guest takeover / sid claim 等路徑。
  - ⚠ **Turnstile 覆蓋校正（Codex Plan ② finding，不 overclaim）**：兩測試檔**皆未設 `TURNSTILE_SECRET_KEY`、亦未送 `cf-turnstile-response`、未斷言 `CAPTCHA_FAILED`** → 只走 `verifyTurnstile` 的 **missing-secret skip path（早退 `{ok:true,skipped:true}`）**；**fail-close（`!ts.ok` → 403 `CAPTCHA_FAILED`）路徑 0 test**。故不宣稱「涵蓋 Turnstile」，僅「涵蓋 Turnstile skip path」。
  - **誠實界線**：type-only 改動 runtime 不可見（型別 erase）＋ `callFunction` 之 `handler` untyped 切斷 test↔handler 型別連結 → 此 integration test **不能「覆蓋」型別標註本身**；它提供的是「emit 不變則 register 各路徑行為不變」的旁證。**主硬保證 = byte-identical emit（sha 兩端一致）**；本 PR type-only 不改 tests（L10/L11），各路徑的不變保護 = byte-identical。
  - **L144 guest takeover 路徑覆蓋誠實**：const 型別標註 erase 後 runtime 不可見；`takenRows`/`r.id`/`newUserId` 的 runtime 值與順序不變（byte-identical 證），integration test 對 guest takeover 路徑的覆蓋僅作旁證、不宣稱覆蓋型別標註。
- 與 PR-2ci..2cn（皆以 byte-identical 為硬保證）同策略；本檔額外有 direct test 作旁證，但**仍不宣稱 type annotation 被測試覆蓋**。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`（或用 `--force`）。**PowerShell 用 `$env:RATCHET_BASE_REF='58664200'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='58664200'; npm run typecheck:ratchet` green（815→811 / 82→81 / 252→253）。
- filtered forced tsc：register.ts 0 殘留 + solution sort-diff **REMOVED=4 / ADDED=0** + `tsc -b tsconfig.tests.json --force` exit 0（base 0 → patched 0）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**：

```bash
git show 58664200:functions/api/auth/local/register.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/reg-base.js 2>/tmp/reg-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/local/register.ts > /tmp/reg-head.js 2>/tmp/reg-head.err
wc -c /tmp/reg-base.js /tmp/reg-head.js        # 期望 7563 兩端
sha256sum /tmp/reg-base.js /tmp/reg-head.js     # 期望 9227b6b914ec9664… 兩端
cat /tmp/reg-base.err /tmp/reg-head.err          # 期望空（stderr 0 bytes）
diff -q /tmp/reg-base.js /tmp/reg-head.js         # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show 58664200:` 讀未改 base。spike 本地實證：兩端 **7563B / `9227b6b9…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 2 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量；確認 `waitUntil?` annotation + `Array<{…}>` annotation 不觸 `no-floating-promises`/`no-unused-vars`/`no-undef`）、`npm run build:functions` green。
- targeted int：跑既有 `tests/integration/register.test.ts` ＋ `tests/integration/jwt-sid-claim.test.ts` 確認綠（runtime 旁證、不宣稱涵蓋 type annotation；Turnstile 僅 skip path）；跑全量 `test:int` 確認無跨檔破壞。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +2/−2、`git diff` 2 處為 `onRequestPost` 簽名 + `takenRows` const annotation）；超出 = scope creep = Gate fail。

## Merge SOP（process lock，順序不得寫反；[[feedback_pre_merge_gate_checklist_match_ci]]）

① faithfulness ✅ → ② **先**跑齊 merge 前 local gates 全綠（`lint`·`typecheck:ratchet`〔Git Bash `RATCHET_BASE_REF=58664200` 或 PowerShell `$env:`〕·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit --omit=dev --audit-level=high`）→ ③ 全綠後 owner 明示 `MERGE_ALLOWED` → ④ push branch + 開 PR + `gh pr merge --squash --delete-branch`（禁直推 main）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 memory receipt（SHIPPED 才寫：topic PR-2co 段 + MEMORY.md index 數字 815→811）。

## Diff hygiene

- 不碰 `CLEANUP_PLAN.md`（untracked、Stage 7 完工才清）；**不碰 A3 殿後檔 `local/login.ts`、任何 util、`end-session.ts`**；baseline 不 `--update`；挑檔 add（1 source + 本 plan doc）禁 `git add .`/`-A`；feature branch `stage7-pr2co-register` 禁直推 main；平行 session 唯讀優先、動 git 前先 `git status`。
- **commit 前後核 `git diff --cached --name-status` + net source diff**（[[feedback_commit_verify_staged_set_and_net_source_diff]]；PR-2ck self-review Explore agent stray `git checkout` 污染 index 教訓 — self-review workflow agent 具 Bash、可改 git state；plan-only commit 時 source net-diff 須為空）。
- **CRLF**：spike 實證 `git diff --numstat` = `2  2`（`.gitattributes` `* text=auto eol=lf` 已根治，[[feedback_windows_build_crlf_churn]]、無 whole-file churn）；code 階段 commit 前再驗 `numstat` `2 2`。

---

## 附：owner C-1 裁示表（faithful 收錄 2026-06-21）

### 決策表

| 決策項 | 裁示 | 原因 | 鎖定 |
|---|---|---|---|
| scope | ✅ 納入 L144 第 4 錯 | 不納入則 register.ts 仍非 clean file、ratchet 目標失敗 | 本 PR 清到 0 noImplicitAny |
| L144 OD | ✅ (a) const 層 row array 斷鏈 | 同時斷 `.map(r)` 與 `takenRows[0]?.user_id` any-chain、比 callback-only 穩 | 禁只標 callback param |
| review care | ✅ L3 | register 是 Tier-0 帳號創建入口（密碼/token/session/JWT/audit/email）| Dual Gate v3.1 四道、不 lighter |
| self-review | ✅ multi-agent workflow | 不因 scout 乾淨降級 | 沿用既有規則 |
| runtime scope | ✅ 嚴格 type-only | 只解 implicit-any、不補安全功能、不重構 | byte-identical 必驗 |
| rate-limit 描述校正 | ✅ 校正 | 本檔無 `checkRateLimit/recordRateLimit`；防禦＝Turnstile + email unique、本 PR 不新增 | plan/review 只校正敘述、不改 code |

### 風險表（faithful 收錄）

| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| L144 any-chain 未清 | 高 | 檔案無法進 cleanFiles、ratchet 投影錯 | 納入本 PR、const 層 row type（L1/L3）|
| row 型別亂猜 | 中 | 型別與 D1 schema 漂移、後續維護誤導 | §row 型別實證：SELECT `RETURNING id,user_id` + schema(`id` PK INTEGER / `user_id` nullable INTEGER) + repo 既有 D1-row 先例（L3）|
| register 熱區過寬 | 高 | 帳號創建、session、JWT、email、audit 同檔，review 漏洞成本高 | L3 + 四 gate + byte-identical（L8/L10）|
| 誤補 RESEND guard | 中 | 非本 PR scope、可能改 runtime | 鎖定不動；本檔 L217 現有 guard 已足夠（L5）|
| 誤新增 rate-limit | 高 | scope creep、runtime 行為改變 | 本 PR 禁新增安全功能、只校正防禦表描述（L7）|
| `waitUntil` 標成 required | 中 | guard 語意漂移、未來 login/end-session 先例變差 | 採 optional（複用 #110，L2/L6）|
| byte-identical 驗證失真 | 中 | 誤判 runtime neutrality | 必跑 canonical emit diff、不用 esbuild 空輸出當證據（L10、emit 7563B 非空已排除）|

### 防禦表（owner C-1 校正後；register 無 rate-limit）

| 機制 | 處理否 | 實作 | 未處理因 |
|---|---|---|---|
| RateLimit | **否** | 本檔現況**未呼叫** `checkRateLimit/recordRateLimit`；防禦＝Turnstile + email unique | 本 PR 是 noImplicitAny type-only、**不新增 rate-limit 行為**（owner 校正）|
| 權限 | 否 | register 為公開入口 | 非本 PR scope |
| Input | 既有 | 保留現有 body / email / password / Turnstile 流程 | 禁重構 |
| XSS | N/A | API route、不產 HTML | 無需處理 |
| Log / Audit | 既有 | 保留 `safeUserAudit` 雙路徑（account.register + guest takeover/invalid）| 禁動 runtime |
| Retry | 否 | 不新增寄信 retry | 非本 PR scope |
| 備援 | 否 | 不新增 fallback | 非本 PR scope |
| 監控 | 既有 audit 旁證 | 保留既有 audit/log 路徑（ratchet 815→811 明列）| 不擴觀測功能 |
| DB Tx / Batch | 既有 | 保留原子 batch INSERT users+local_accounts+email_verifications | 禁動 SQL 行為 |
| Unique | 既有 | 保留 email unique / duplicate check | 禁動 schema |
| SoftDel / Backup / Page / N+1 | 不處理 | 不涉及本刀 type annotation | 非本 PR scope |
| Type boundary | ✅ 本刀核心 | `request: Request`；`env: Env`；`waitUntil?: (promise: Promise<unknown>) => void`；`takenRows: Array<{ id: number; user_id: number \| null }>` | — |

### DB 鎖定

| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Schema | 不改 `users` / `local_accounts` / `email_verifications` / `requisition` / `refresh_tokens` |
| Atomic | 禁改原子 batch INSERT、guest takeover `UPDATE requisition … RETURNING id, user_id`、refresh token INSERT 條件與順序 |

### 隔離區 / 鎖定區

- **隔離區**：A3 殿後檔（`local/login.ts`）、shared util（`functions/utils/{crypto,jwt,tenant-context,email,password,cors,scopes,turnstile,auth,cookies,user-audit}.ts`）、`auth/oauth/end-session.ts`、`CLEANUP_PLAN.md`、baseline/ratchet override、`RESEND_API_KEY` 行為 **全部不得碰**。
- **鎖定區**：所有 runtime（Turnstile fail-close / email 重複檢查 / PBKDF2 hash / 原子 batch / guest takeover SQL·sampling·audit / refresh token·session_id / JWT 簽發·tenant claims / email 寄送·`waitUntil` guard / `isWebClient`·Set-Cookie·body refresh / `safeUserAudit` / response body·error code）；return type / JSDoc / 註解 / 格式 / rate-limit（不新增）。

### 驗收標準（owner，faithful 收錄）

| 驗證 | 目標 | spike 實測 |
|---|---|---|
| `tsc -b tsconfig.solution.json --force` | register 4 個錯（3 TS7031 + 1 TS7006）消失、無新增錯誤 | ✅ 4→0、ADDED=0 |
| ratchet | `815→811` | ✅ 811/81/253/334 |
| forced solution sort-diff | `REMOVED=4 / ADDED=0` | ✅ |
| cascade | 0 util / 0 test / 0 helper / 0 caller cascade | ✅ tests-leaf 0→0、solution ADDED=0 |
| byte-identical | runtime output identical | ✅ 7563B sha `9227b6b9…` 兩端、`diff -q` IDENTICAL |
| tests | 跑既有 register integration；僅作 runtime 旁證 | ⬜ Code 階段 |
| gate | Dual Gate v3.1 全 4 道，不 lighter | ⬜ 進行中 |
