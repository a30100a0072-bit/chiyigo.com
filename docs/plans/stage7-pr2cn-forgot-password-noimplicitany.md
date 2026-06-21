# Stage 7 reduce PR-2cn — `auth/local/forgot-password.ts` noImplicitAny（單檔 password-reset 起點 handler，**單一 direct handler ＋ `waitUntil`**，type-only，review care L2）

**目標**：`functions/api/auth/local/forgot-password.ts` 的 **3 個 noImplicitAny error（全 TS7031：`onRequestPost` destructure `request`/`env`/`waitUntil` ×3）→ 0**，**純 type-only**（**單一編輯點**＝唯一 exported handler `onRequestPost` 的 destructured param annotation；TS erase 後 emit byte-identical）。

**Scope（owner C-1 鎖 2026-06-21；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/local/forgot-password.ts` | 3（L23 `onRequestPost({request,env,waitUntil})` TS7031 ×3） | **1 個編輯點**（`onRequestPost` destructure param annotation）|

> **主線定位（owner C-1）**：A 域 handler 層續清，**A3 第三棒**。PR-2ch 清 A1 五檔 TOTP-caller handler（#104）→ PR-2ci `2fa/setup.ts`（#105）→ PR-2cj A2 `change-password.ts`+`identity/unbind.ts`（#106）→ PR-2ck A 域 `delete.ts` step-1（#107、**首個 wrapper/worker 雙 function handler 先例**）→ PR-2cl `email/send-verification.ts`（#108 `0c71d03b`、**A3 起手、wrapper/worker、複用 PR-2ck OD-ctx (a)**）→ PR-2cm `email/verify.ts`（#109 `8be32537`、**雙直連 handler + GET request-only partial-context 先例、零新正式 OD**）。本 PR = **A3 第三棒 `local/forgot-password.ts`**，owner 2026-06-21 C-1 裁 **單檔單獨成棒**。**新元素**：本檔為**單一 direct handler**（`onRequestPost`，param 直接 destructure，無 wrapper/worker、無 `ctx`、無 try/catch wrapper），且 destructure 含 **`waitUntil`** → 引入本 A 域**首個 `waitUntil` 型別化 OD**。**排除**：A3 餘檔（`local/{login,register}.ts`〔Tier-0 殿後、含 brute-force/turnstile/session、register 亦含 `waitUntil` 待本 PR 立先例後複用〕）、util `utils/{email,turnstile,jwt,crypto,auth,user-audit}.ts`、`auth/oauth/end-session.ts`（亦未遷移 `waitUntil` user，本 PR 不碰）、大熱區 `audit`/`payments` 域（defer）。

base main `8be32537`（接 PR-2cm #109；`git rev-parse HEAD` 實查 = `8be32537d769fc6e38e4db8852ed7e56b3dc4d04`）。branch `stage7-pr2cn-forgot-password`（自 clean main 開、未 push）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔、1 annotation）/ review care **L2**（password-reset 起點熱區：Turnstile self-skip + fail-close、IP 限流、60s 冷卻、token 生成、反枚舉 timing 對齊、發信 via `waitUntil` + 失敗回滾；非 destructive、非 step-up、非金流）。走**完整 Dual Gate v3.1 四道外部審查、不用 lighter**。
- **self-review = multi-agent workflow（owner C-1 2026-06-21 明示）**：即使 scout / spike 乾淨亦不得降級單 agent（[[feedback_self_review_form_not_downgradable_by_spike]]）。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（不碰 A3 餘檔、不碰任何 util、不碰 `end-session.ts`、不碰 `RESEND_API_KEY` undefined 行為、不碰 `CLEANUP_PLAN.md`）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-21：scope = 單檔、1 編輯點修 3 TS7031；self-review 形式 = multi-agent workflow；**OD ruling = `waitUntil?: (promise: Promise<unknown>) => void`（選項 A optional；重用 `_middleware.ts:33` canonical lambda form、僅加 `?`）＋ `request: Request` ＋ `env: Env`**；**禁** required `waitUntil`（guard 變靜態恆真、未來 register/end-session 先例變差）；**禁** 補 `RESEND_API_KEY` guard（行為改動）；**禁** 改 `typeof waitUntil === 'function'` guard；**禁** `CfRequest`/`EventContext`/`@cloudflare/workers-types`/新 import/新 ambient；A3 餘檔 + util + `end-session.ts` + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `8be32537`）→ 逐檔 error set（恰 3 TS7031）+ caller cascade（shared `verifyTurnstile` 3 caller，annotate 不牽動）+ 測試覆蓋分層（**有** direct integration test、9 cases）+ 結構判定（單一 direct handler、非 wrapper/worker）+ `waitUntil` OD 形態（既有 in-repo canonical form）+ 無 `.cf`，全對齊裁示（檔錯數 = 3 / shared-util 3 caller 不牽動 / 無 `.cf`）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、`git diff 8be32537` 空、blob 回 `b6cf6c04`）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow，3 agents 三維 rubric：scope / runtime·security / evidence；run `wf_e12fbc82-56f`、3 agents / ~320k subagent tokens / 77 tool uses；三維全 verdict=clean、**0 confirmedReal defect**、findings 皆 positive verification — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 維度 B，**0 required revision / 2 NB**、8 維全 PASS、binding locks CL-1..CL-10 — 見 §Gate 進程紀錄）→ ✅ `CODEX_PLAN_APPROVED`（② 維度 C，**0 required revision / 0 blocking**、獨立 replay 全數值重現 — 見 §Gate 進程紀錄）→ ⬜ owner `CODING_ALLOWED`
  - ✅ Code 階段（source commit `1ef28c7f`、full replay @ source 全綠、NB-2 雙證）→ ✅ `CODE_SELF_REVIEW_CLEAN`（multi-agent workflow `wf_bffb0a00-883`，3 agents 三維、0 confirmedReal defect）→ ⬜ `CODEX_CODE_APPROVED`（③，owner 驅動）→ ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④，owner 驅動）
  - ⬜ merge-front 7 gates 全綠 → ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-21 owner C-1 裁示（pre-SPEC → SPEC）：scope = 單檔、1 annotation 修 3 TS7031；self-review = multi-agent workflow（三維收斂、不擴全域）；**OD ruling = waitUntil 選項 A optional**（`waitUntil?: (promise: Promise<unknown>) => void`、重用 `_middleware.ts` canonical lambda、不創語意 alias）；`request: Request` / `env: Env`（full Env，handler 整包 forward 4 util）；**禁** required waitUntil / 補 RESEND guard / 改 guard / `CfRequest`·`EventContext`·workers-types / 碰 A3 餘檔·util·`end-session.ts`·tests·baseline·behavior·opportunistic cleanup。完整 8 條 lock（L1..L8）+ 風險表 + 防禦表 + 驗收標準見 §附。
- 2026-06-21 Claude **scout（read-only @ `8be32537`）** → 逐檔 error set（恰 3 TS7031：`(23,39)` `request` ＋ `(23,48)` `env` ＋ `(23,53)` `waitUntil`）+ caller cascade（shared `utils/turnstile.ts#verifyTurnstile` 恰 **3 caller**〔`register.ts:46`/`login.ts:51`/`forgot-password.ts:51`〕，annotate 本檔 param 不改 util、不牽動另 2 caller；`assist.ts:221` 為**同名 local 函式**〔`(token,secret,ip)` 不同簽名〕非此 util caller，4-file grep 第 4 命中為 homonym 偽陽性）+ coverage 分層（**有** direct integration test `tests/integration/forgot-password.test.ts` 9 cases、`await import` 直取 `onRequestPost`；但 `callFunction(handler,…)` 之 `handler` untyped→切斷 test↔handler 型別連結→type-only 0 tests-leaf cascade）+ 結構判定（**單一 direct handler** `onRequestPost`、無 wrapper/worker/`ctx`、另有非-handler helper `fakeHashDelay()` 無參數不在錯誤集）+ `waitUntil` OD（既有 in-repo canonical `_middleware.ts:33`）+ 無 `request.cf`，全對齊 owner 裁示 → 0 矛盾、不觸發 stop-rule（唯 OD 形態回報 C-1 裁、已裁 A optional）。
- 2026-06-21 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（solution 818→815、sort-diff REMOVED=3/ADDED=0、tests-leaf 0→0、byte-identical 4003B sha `84d11217…` 兩端一致、ratchet:report base 818/83/251/334 → patched 815/82/252/334）。
- 2026-06-21 **multi-agent workflow self-review（維度 A，3 agents 三維：scope / runtime·security / evidence；run `wf_e12fbc82-56f`、3 agents / ~320k subagent tokens / 77 tool uses）→ `PLAN_SELF_REVIEW_CLEAN`**：三維 finder **全 verdict=clean、0 confirmedReal defect**（scope 0 findings；runtime·security 3 + evidence 4 findings 皆 `confirmedReal=false` 之 positive/reinforcing verification，非 defect）。三 finder **獨立復現**關鍵證據：byte-identical（各自 `/tmp` 獨立 base+patched esbuild stdin → 兩端 4003B sha `84d11217…` `diff -q` IDENTICAL）、ratchet（base 818/83/251/334 → patched 815、forced sort-diff REMOVED=3/ADDED=0、blob `5602c86c`、numstat 1/1）、OD ruling 9 處一致（無 required 授權、`required` 字樣皆在 forbidding/risk context）、precedent（`_middleware.ts:33` waitUntil lambda、`verifyTurnstile` 恰 3 caller〔register/login/forgot-password〕+ `assist.ts:221` homonym、column coords `(23,39)/(23,48)/(23,53)`）、coverage 誠實不 overclaim、無 stale PR-2cm 數值洩漏（前棒 `verify.ts` 的 solution-count / emit-byte / emit-sha / blob 值皆不出現於本 PR current 數據）。**主線獨立對抗式裁決（非採 raw 輸出）認同 clean**。**review agents 未污染 git**（主線獨立驗：`git status --porcelain` 僅 2 untracked〔`CLEANUP_PLAN.md` + 本 plan doc〕、`git diff --cached` 空、`git diff HEAD -- functions/` 空、forgot-password blob 回 `b6cf6c04`、HEAD `8be32537`；evidence finder 一 gitignored side-effect `rm -rf .tscache`〔下次 typecheck 重建、無 tracked 檔動〕）→ PR-2ck stray-checkout 未復發。
- 2026-06-21 **plan doc commit `f6d22760`**（branch `stage7-pr2cn-forgot-password`、local、未 push、plan-only +284 / 0 source）→ 中文報告 6 欄（gate-state `PLAN_SELF_REVIEW_CLEAN`）→ owner 驅動產自足 **ChatGPT Arch packet**（`chiyigo-pr2cn-arch-packet.md`，repo 外 Desktop、25.3KB、9 區塊 + 附錄 A-D〔reviewer instructions / scope / frozen source diff / OD / precedent #108·#109 / 6 依賴簽名 / security invariants / evidence / non-goals / verdict format ＋ base source @ `8be32537` / Env ambient / memory glossary〕、path 一致性自查 0 stale path）→ 貼入送外部 ①。
- 2026-06-21 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 required revision / 2 NB**）— 8 維全 **PASS**：Scope 隔離（單檔、L23 單 annotation、1 ins/1 del、未混 source）/ OD 合理性（waitUntil optional 忠於 runtime guard、重用 `_middleware.ts` lambda 只加 optional）/ Precedent 一致性（對齊 #109 direct destructure、不誤套 #108 wrapper-ctx）/ Runtime neutrality（frozen diff 純 annotation、spike byte-identical 4003B sha 一致 `diff` identical；Code 階段仍須 full replay）/ Security invariant（Turnstile·rate-limit·cooldown·token·audit·mail-rollback·anti-enumeration 全列不改）/ Evidence 自洽（818→815、REMOVED=3/ADDED=0、tests-leaf 0→0 與 scope 一致）/ Coverage honesty（integration test 僅 runtime 旁證、不宣稱覆蓋型別標註）/ Isolation·non-goals（明禁 RESEND guard·waitUntil guard·util signature·tests·env·tsconfig·baseline）。
  - **Binding locks CL-1..CL-10（ChatGPT Arch；② Codex Plan 與 Code 階段須保留）**：CL-1 僅改 `forgot-password.ts` 的 `onRequestPost` destructured param annotation；CL-2 frozen source diff byte-faithful 重放 `request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void`；CL-3 `waitUntil` 維持 **optional**、不得改 required（除非重送 Arch Gate）；CL-4 不得改 `typeof waitUntil === 'function'` runtime guard；CL-5 不得新增 shared type·import·ambient·`EventContext`·`CfRequest`·`@cloudflare/workers-types`；CL-6 不得改 `verifyTurnstile`·`verifyJwt`·`safeUserAudit`·`sendPasswordResetEmail` 或任何 util signature；CL-7 不得補 `RESEND_API_KEY` undefined guard（另案 hardening）；CL-8 不得改 Turnstile·rate-limit·cooldown·token insert·mail rollback·audit·anti-enumeration timing 行為；CL-9 Code 階段必重新 full replay（tsc·sort-diff·ratchet·tests-leaf·byte-identical·source diff），不得沿用 plan spike 當 code 證據；CL-10 對外只宣稱 current solution `818→815`、不暗示 baseline file 已更新。
  - **NB-1（非阻擋）**：packet 已足夠做 Arch Gate；Codex Plan Gate 可要求核對 plan doc 原文 vs packet 一致（plan doc @ commit `f6d22760`）。**NB-2（非阻擋）**：Code Gate 特別看 byte-identical recipe、排除 esbuild file-entry 空輸出陷阱（packet 與 plan §Spike/§驗證計劃已列 stdin recipe）。
  - **可送 ② Codex Plan Gate；非 coding 授權，待 ② 通過 + owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-21 owner 驅動產 **Codex Plan packet**（`chiyigo-pr2cn-codex-plan-packet.md`，repo 外 Desktop、10.2KB、機械重驗指令 + 預期值 + 待填對照表 + CL-1..CL-10 核對 + verdict format；Codex 有 repo 存取故聚焦獨立 replay、不含 base source 全文）→ 送外部 ②。
- 2026-06-21 **Codex Plan Gate（② 維度 C）：`CODEX_PLAN_APPROVED`**（**0 required revision / 0 blocking finding**）— 機械重驗全數值**獨立重現**：base solution **818** / ratchet 818/83/251/334、標的恰 **3 TS7031**、patched solution **815** / ratchet 815/82/252/334、sort-diff **REMOVED=3 / ADDED=0**、tests-leaf **0→0**、emit **4003B** sha `84d11217…` **IDENTICAL**、frozen **1+/1−** blob `b6cf6c04→5602c86c`、`git diff --check` clean。Queue / payment / distributed-state **N/A**；既有 auth/runtime/DB 行為均被 frozen locks 排除。packet 10249B / 0 stale path / CL-1..CL-10 完整、plan doc 與 ① verdict + NB-1/NB-2 忠實一致。**原 repo 未受污染**（HEAD `da525f39`、source blob `b6cf6c04`、working tree 僅 `?? CLEANUP_PLAN.md`）。**Plan Gate 雙道（① ChatGPT Arch + ② Codex Plan）全通過 = plan 批准；仍非 coding 授權**（待 owner 明示 `CODING_ALLOWED`；Code 階段須依 CL-9 重新 full replay @ source、不得沿用本次 plan replay 結果）。
- 2026-06-21 **owner `CODING_ALLOWED` ✅** → 進 Code 階段。
- 2026-06-21 **Code 階段（source commit `1ef28c7f`）**：落地唯一編輯點 L23 `onRequestPost({ request, env, waitUntil }: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void })`，`git diff 8be32537..1ef28c7f -- functions/` = forgot-password.ts **+1/−1**、blob `b6cf6c04→5602c86c`、numstat `1 1`。**full replay gates 全綠（@ source、不沿用 spike）**：byte-identical（canonical `esbuild --loader=ts --format=esm` stdin，base `8be32537` 與 HEAD `1ef28c7f` 皆 via `git show`）兩端 **4003B** sha `84d11217…`、stderr 0、`diff -q` IDENTICAL · forced solution sort-diff（@ committed：patched 815、暫還原 base 量 818 → `git checkout HEAD --` restore，restore 後嚴格驗 working clean / staged 空 / blob `5602c86c`）**REMOVED=3 / ADDED=0** · tests-leaf **0→0** · ratchet enforce〔`RATCHET_BASE_REF=8be32537`〕**OK**（baseline 1119/175、current **815/82/252/334**）· `git diff --check` clean · **lint green**（eslint + compat-date + workflows）· **build:functions**「Compiled Worker successfully」。**NB-2 雙證齊**（byte-identical receipt @ committed blobs + source diff 逐行 annotation，不以 ratchet 數字單獨代表 runtime 不變）。
- 2026-06-21 **Code self-review = multi-agent workflow（維度 A，3 agents 三維：diff-fidelity / runtime·security / evidence；run `wf_bffb0a00-883`、3 agents / ~258k subagent tokens / 71 tool uses）→ `CODE_SELF_REVIEW_CLEAN`**：三維 finder **全 verdict=clean、0 confirmedReal defect**（diff-fidelity 0 / runtime·security 0 / evidence 6 findings 皆 `confirmedReal=false` positive verification）。三 finder **獨立復現**：committed diff word-diff 證唯一加 type annotation〔imports/body/SQL/comments/`fakeHashDelay` 全 byte-identical、單一 `onRequestPost`、`waitUntil` 於 L133 真消費故 optional shape 符實〕、byte-identical @ committed blobs〔base/HEAD esbuild 兩端 4003B sha `84d11217…`〕、**0-cascade 結構性實證**〔獨立 tsc --strict probe exit 0 證 full `Env` assignable to `verifyJwt` Partial<Pick> / `sendPasswordResetEmail` Pick / `verifyTurnstile` Pick / `safeUserAudit` untyped、`waitUntil` Promise<void>→Promise<unknown>、無 `.cf`〕、ratchet 815/82/252/334〔base 818 經 `/tmp` git-archive 隔離量測、主樹未動〕、sort-diff REMOVED=3/ADDED=0、tests-leaf 0、無 stale PR-2cm 值、coverage 誠實。**主線獨立對抗式裁決認同 clean**。**review agents 未污染 git**（主線獨立驗：`git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、`git diff HEAD -- functions/` 空、staged 空、forgot-password blob `5602c86c`、HEAD `1ef28c7f`、net numstat 1/1）→ PR-2ck stray-checkout 未復發。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；不得 merge 除非 owner 明示 `MERGE_ALLOWED`。**
- （後續 dated 收錄：③ Codex Code → ④ ChatGPT Faithfulness → merge-front 7 gates → `MERGE_ALLOWED` → squash-merge → SHIPPED memory）

## owner 鎖定表（C-1 ruling 2026-06-21，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 只改 `functions/api/auth/local/forgot-password.ts` handler destructure 型別 |
| L2 Type shape | `request: Request`、`env: Env`、`waitUntil?: (promise: Promise<unknown>) => void`（**唯一允許落地的 source diff**）|
| L3 No new shared type / no util change | 不新增 shared type、不中途改 util signature |
| L4 RESEND lock | 不碰 `RESEND_API_KEY` undefined 行為（已知 pre-existing、另案 hardening；補 guard = scope creep）|
| L5 Guard lock | 不改 `typeof waitUntil === 'function'` guard |
| L6 Runtime hot-zone lock | 不改 Turnstile（self-skip + fail-close）/ rate-limit / cooldown / token 生成·INSERT / `safeUserAudit` / 發信 via `waitUntil` + 失敗回滾 / `fakeHashDelay` 時序對齊 / response body·error code |
| L7 Spike evidence | full-solution spike 必須**非 commit**，證明 **REMOVED=3 / ADDED=0** |
| L8 byte-identical evidence | byte-identical 必須是 **type-strip / canonical emit 證據**，不接受「測試通過」替代 |
| L9 Coverage（補）| 逐 sub-path 下鑽；handler 有 direct integration test，但 type-only 改動 runtime 不可見 → **主硬保證 = byte-identical**，integration test 僅作 runtime 旁證、不宣稱「覆蓋型別標註」（[[feedback_pr_coverage_claim_accuracy]]）|
| L10 Evidence replay（補）| plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical / tests-leaf；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L11 Stop Rule（補）| 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / coverage overclaim / 偏離 C-1 裁定 OD（如改 required / 補 RESEND guard / 動 guard）→ 退回 `PLAN_DRAFT` |

## ⚠ forgot-password 熱區聲明（review care L2，password-reset 起點）

`auth/local/forgot-password.ts` 為**密碼重設起點**：匿名請求驗 Turnstile（已登入對自己 email 走 JWT `aud='chiyigo'` self-skip）→ IP 全域限流 → 反枚舉一律 200 + `fakeHashDelay` 時序對齊 → 60s 冷卻 → 生 token + INSERT → 發信 via `waitUntil`（失敗回滾 token、仍回 200）。修法若非純型別、或牽動下列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L4/L5/L6）：

| 區塊 | 紅線（typing 全程不得牽動）|
|---|---|
| Turnstile self-skip | `request.headers.get('Authorization')` + `Bearer ` 前綴 + `verifyJwt(…, env, { audience: 'chiyigo' })` + `payload.email` 比對 own email → `skipTurnstile`；catch → 走匿名路徑（[[feedback_forgot_password_self_skip_turnstile]]）|
| Turnstile fail-close | `verifyTurnstile(request, body, env)` → `!ts.ok` 回 `CAPTCHA_FAILED` 403 |
| IP 限流 | `SELECT COUNT(*) … email_verifications WHERE ip_address=? AND created_at>datetime('now','-1 hour')` ≥ `IP_HOURLY_LIMIT(5)` → `RATE_LIMITED` 429 |
| 反枚舉 | 帳號不存在 / soft-delete / 冷卻命中 / happy 一律回 200（`If that email is registered…`）；三路皆跑 `fakeHashDelay()` 對齊時序（timing oracle 防護）|
| 60s 冷卻 | `SELECT id … WHERE user_id=? AND token_type='reset_password' AND created_at>datetime('now','-${COOLDOWN_SECONDS} seconds')` → 命中跑 `fakeHashDelay` 回 200 |
| token 生成 | `generateSecureToken()` + `hashToken(token)`（SHA-256；DB 只存 hash）+ `INSERT INTO email_verifications (…, token_type='reset_password', …)` |
| 發信 + 回滾 | `sendJob = (async()=>{ try{ sendPasswordResetEmail(env.RESEND_API_KEY, userRow.email, token, env) } catch{ DELETE … WHERE token_hash=? } await safeUserAudit(…) })()`；`if (typeof waitUntil === 'function') waitUntil(sendJob)` |
| Audit | `safeUserAudit(env, { event_type:'account.password.reset_request', … })`（unknown_email user_id=null / happy user_id=userRow.id）|

註：本刀只在唯一 exported handler `onRequestPost` 簽名加型別標註，TS erase 後 runtime byte-identical（SQL / 常數 / audit·log / 字串 / 註解 / `waitUntil` guard / `fakeHashDelay` 全不變）。

### Coding 階段硬性邊界

- **允許**：`onRequestPost({ request, env, waitUntil })` 加 `: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void }`（單一編輯點，§frozen diff 唯一變更行）。
- **禁止**：改任何 SQL / Turnstile self-skip·fail-close / IP 限流 / 反枚舉 200·`fakeHashDelay` 時序 / 60s 冷卻 / token 生成·INSERT / 發信·回滾 / `safeUserAudit` / response body·error code / `typeof waitUntil === 'function'` guard / `RESEND_API_KEY` undefined 行為（不補 guard）/ caller（`register.ts`/`login.ts`）/ shared util（`turnstile`/`jwt`/`email`/`crypto`/`auth`/`user-audit`）/ `end-session.ts` / tests / `env.d.ts` / `tsconfig`·`eslint`·`vitest` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types` / required `waitUntil` shape / **碰 A3 餘檔 `local/{login,register}.ts`** / 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `8be32537`）

### exact errors（forced `tsc -b tsconfig.solution.json --force`，solution total 818）

```
functions/api/auth/local/forgot-password.ts(23,39): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/local/forgot-password.ts(23,48): error TS7031: Binding element 'env' implicitly has an 'any' type.
functions/api/auth/local/forgot-password.ts(23,53): error TS7031: Binding element 'waitUntil' implicitly has an 'any' type.
```

恰 **3 個，全 TS7031**：`onRequestPost` 單一 destructure param 的 `request`/`env`/`waitUntil`（L23）。**無 TS7006**（全 destructure binding element）。檔內 helper `fakeHashDelay()`（L140）無參數 → 不在錯誤集。**無 `onRequestGet`**（單一 handler，較 PR-2cm 雙 handler 更單純）。

> ⚠ 無 `request.cf` → plain `Request`、**禁引入 `CfRequest`**（owner 排除）。

### 依賴邊界（caller cascade）

`forgot-password.ts` 是 Pages file-routing entry，cascade 面：

| 面 | 判定 | 證據 |
|---|---|---|
| `onRequestPost` 外部 TS caller | **0 牽動** | 直接消費端：`tests/integration/forgot-password.test.ts` `await import` 取 `onRequestPost`，經 `callFunction(handler,…)`〔`handler` **untyped**〕呼叫 → 型別連結被 `any` 切斷、annotate 不引入 tests-leaf 新錯（spike tests-leaf 0→0 實證）|
| shared `verifyTurnstile` caller | **不牽動** | 本檔 L51 `verifyTurnstile(request, body, env)`；annotate 後 `Request`→param1 `Request` ✓、`body`(any)→`Record<string,unknown>` ✓、`Env`→`Pick<Env,'TURNSTILE_SECRET_KEY'>` ✓ 全 assignable；**不改 util、不牽動另 2 caller**〔`register.ts:46`/`login.ts:51`〕。`assist.ts:221` 為同名 local 函式（homonym，非此 util caller）|
| intra-file env / request / waitUntil 存取 | 全相容 | `request.json()`(WebWorker lib→`any` body)、`request.headers.get(…)`、`env.chiyigo_db`(D1Database→any，[[feedback_d1database_resolves_any_no_workers_types]])、`env.RESEND_API_KEY`(env.d.ts `RESEND_API_KEY?: string`→`string\|undefined`)、`verifyJwt(…)`回 `JWTPayload`〔`payload.email` 今已 `unknown`、非本次新增〕、`safeUserAudit(env,…)`〔util 本身 untyped→吃任何值〕、`sendPasswordResetEmail(env.RESEND_API_KEY, userRow.email(any), token, env)`〔param `(string\|undefined, string, string, Pick<Env,…>)` 全 assignable〕、`waitUntil(sendJob)`〔`Promise<void>`→`Promise<unknown>` ✓〕；**無 `.cf`** |

**precedent landscape（佐證 OD ruling）**：
- **`request: Request` / `env: Env` 直連 handler**＝repo 主流 Convention A（數十檔已清，含同域 PR-2cm `email/verify.ts` POST）→ **零新 OD**；`env` 用 **full `Env`**（handler 整包 forward `verifyJwt`/`verifyTurnstile`/`safeUserAudit`/`sendPasswordResetEmail`），util 各收 `Pick`/`Partial`/untyped、full Env structural assignable（[[feedback_util_env_param_pick_not_full_env]]：handler 用 Env、util 用 Pick）。
- **`waitUntil` 型別化**＝本 A 域**首個 `waitUntil` OD**，但**非從零發明**：in-repo 已有 canonical form `functions/api/_middleware.ts:33`（`MiddlewareContext.waitUntil: (promise: Promise<unknown>) => void`，**不靠 workers-types**）。OD 收斂為單一子決策「optional vs required」。

### 型別選型（owner C-1 OD ruling = A optional）

允許落地的唯一 source diff（單一編輯點）：

```ts
export async function onRequestPost({ request, env, waitUntil }: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void }) {  // L23
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| `request` | **`Request`（plain）** | `request.json()`(→`any` body) + `.headers.get(…)` + 傳 `verifyTurnstile`/`safeUserAudit`；**無 `.cf`** → 非 `CfRequest` |
| `env` | **`Env`（full，Convention A）** | 整包 forward 4 util（`verifyJwt`/`verifyTurnstile`/`safeUserAudit`/`sendPasswordResetEmail`）；`env.chiyigo_db`(any) + `env.RESEND_API_KEY`(declared)；spike ADDED=0 證零 cascade |
| `waitUntil` | **`waitUntil?: (promise: Promise<unknown>) => void`（A optional）** | 重用 `_middleware.ts:33` canonical lambda、僅加 `?`（不創語意 alias）；**optional 忠於 `typeof waitUntil === 'function'` guard 的「可能缺席」語意**、guard 內正確 narrow；為共用同 guard 的 `register.ts`/`end-session.ts`（皆未遷移）立**正確先例** |
| OD 形態 | **`request`/`env` 零新 OD；`waitUntil` optional = A 域首個 `waitUntil` OD（C-1 裁定）** | 單一 direct handler、非 wrapper/worker，套 direct-handler Convention A + `_middleware` canonical waitUntil lambda（加 `?`）|
| required `waitUntil`（**否決**）| **禁** | guard 變靜態恆真（雖無 `no-unnecessary-condition` lint 不報、且 byte-identical 不受影響，但語意漂移）、未來 register/end-session 先例變差（owner 風險表）|
| `RESEND_API_KEY` guard（**否決**）| **禁** | `env.RESEND_API_KEY` possibly-undefined 屬已知 pre-existing 行為（另案 hardening）；補 guard = 行為改動 = type-only PR 變 hardening PR（owner L4）|
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 3 錯 |

## Spike 實證（full-solution，本地未 commit，2026-06-21，已 revert clean）

**程序**：建 branch（自 clean main `8be32537`）→ 量 base（ratchet report 818/83/251/334、forced solution 818、forced tests-leaf 0、base emit 4003B）→ 套單一編輯點（Edit L23）→ forced `tsc -b tsconfig.solution.json --force`（sorted error set diff）→ forced `tsc -b tsconfig.tests.json --force`（tests-leaf）→ ratchet report → canonical byte-identical（esbuild stdin）→ frozen diff + `git diff --check` → `git checkout --` revert → 驗 clean（`git diff 8be32537` 空、blob 回 `b6cf6c04`、staged 空）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| forgot-password errors 3 → 0 | ✅ sort-diff REMOVED = 恰 3 行（`(23,39)` `request` / `(23,48)` `env` / `(23,53)` `waitUntil` TS7031）；patched 0 殘留 |
| solution errorCount 818 → 815（恰 −3）| ✅ forced tsc solution **815**；sort-diff ADDED = **空（0）** |
| zero cascade（functions + tests + scripts + browser，全 solution）| ✅ solution sort-diff **REMOVED=3 / ADDED=0**；另 `tsc -b tsconfig.tests.json --force` **base 0 → patched 0**（tests ADDED=0）|
| canonical ratchet `--report`（base → patched）| ✅ base errorCount **818** / errorFiles **83** / cleanFiles **251** / sourceFilesTotal **334** → patched **815** / **82** / **252** / **334** |
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`** stdin，[[feedback_byte_identical_emit_verification]]）| ✅ esbuild **stdin** type-strip base vs patched **IDENTICAL**、皆 **4003B**、esbuild stderr 空：<br>sha256 兩端 `84d11217e098ae4702fa63dbaf71ded1d434606effc8dfb382b99a1296c8c8f3` |
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace / lone space）|
| frozen diff numstat | ✅ `1  1`（1 insertion / 1 deletion；無 whole-file CRLF churn）；base blob `b6cf6c04` → head blob `5602c86c` |
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、`git diff 8be32537 -- forgot-password.ts` **空**、`git diff --cached` 空、blob 回 `b6cf6c04` |

**byte-identical 適用性**：forgot-password.ts 6 imports（crypto / email / turnstile / auth / jwt / user-audit）→ esbuild stdin transform **適用**（單檔 transform、import 行原樣保留；非完整 bundle，但 type-only annotation PR 這正是對的證明面——改動僅限本單檔、其他檔 byte 不變 → bundle 等價）。⚠ 用 **stdin**（`<` / pipe），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell，[[feedback_byte_identical_emit_verification]]）；本 spike emit 4003B 非空、已排除該坑。`waitUntil` 含 handler 仍是單檔 type-strip transform 適用。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/local/forgot-password.ts b/functions/api/auth/local/forgot-password.ts
index b6cf6c04..5602c86c 100644
--- a/functions/api/auth/local/forgot-password.ts
+++ b/functions/api/auth/local/forgot-password.ts
@@ -20,7 +20,7 @@ const COOLDOWN_SECONDS  = 60
 const TOKEN_TTL_HOURS   = 1
 const IP_HOURLY_LIMIT   = 5   // per IP, across all token types

-export async function onRequestPost({ request, env, waitUntil }) {
+export async function onRequestPost({ request, env, waitUntil }: { request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void }) {
   let body
   try { body = await request.json() }
   catch { return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400) }
```

`git diff --stat`：1 file changed, 1 insertion(+), 1 deletion(-)；`git diff --numstat`：`1  1`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `8be32537` `--report`：errorCount **818** / errorFiles **83** / cleanFiles **250→251**（實測 251）/ sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **818 → 815**（−3）、errorFiles **83 → 82**、cleanFiles **251 → 252**（spike 實測值、非預測；forgot-password 全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 815」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 唯一 exported handler `onRequestPost` 簽名型別標註，TS erase 後 runtime byte-identical（§Spike sha `84d11217…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 818、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。

## 測試影響面（覆蓋誠實，L9 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf base 0 → patched 0、ADDED=0 實證）。
- **覆蓋分層（誠實，逐 sub-path 下鑽）**：

| 標的 | direct test | indirect | 真打路徑 | 硬保證 |
|---|---|---|---|---|
| `local/forgot-password.ts`（handler `onRequestPost`）| ✅ **有**（`tests/integration/forgot-password.test.ts`，9 cases）| — | `await import('…/forgot-password')` 直取 `onRequestPost` + `callFunction` | **byte-identical 為主硬保證**；integration test 為 runtime 旁證 |

- **下鑽證據（不 overclaim）**：
  - direct integration test 9 cases：happy（DB 寫 reset token + sendMock 1 次）/ unknown-email 防枚舉（200、DB 0、sendMock 0）/ OAuth-only（200、寫 token + 寄信）/ 60s 冷卻（連發 2 次都 200、DB 1）/ IP 限流（連 6 次第 6 個 429）/ soft-delete（視為不存在）/ Resend 失敗回滾（200、DB 不留 token）/ invalid-JSON 400 / 缺 email 400。
  - **誠實界線**：type-only 改動 runtime 不可見（型別 erase）＋ `callFunction` 之 `handler` untyped 切斷 test↔handler 型別連結 → 此 integration test **不能「覆蓋」型別標註本身**；它提供的是「emit 不變則 9 路徑行為不變」的旁證。**主硬保證 = byte-identical emit（sha 兩端一致）**；本 PR type-only 不改 tests（L8/L9），9 路徑的不變保護 = byte-identical。
- 與 PR-2ci..2cm（皆以 byte-identical 為硬保證）同策略；本檔額外有 direct test 作旁證，但**仍不宣稱 type annotation 被測試覆蓋**。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`（或用 `--force`）。**PowerShell 用 `$env:RATCHET_BASE_REF='8be32537'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='8be32537'; npm run typecheck:ratchet` green（818→815 / 83→82 / 251→252）。
- filtered forced tsc：forgot-password.ts 0 殘留 + solution sort-diff **REMOVED=3 / ADDED=0** + `tsc -b tsconfig.tests.json --force` exit 0（base 0 → patched 0）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**：

```bash
git show 8be32537:functions/api/auth/local/forgot-password.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/fp-base.js 2>/tmp/fp-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/local/forgot-password.ts > /tmp/fp-head.js 2>/tmp/fp-head.err
wc -c /tmp/fp-base.js /tmp/fp-head.js        # 期望 4003 兩端
sha256sum /tmp/fp-base.js /tmp/fp-head.js     # 期望 84d11217… 兩端
cat /tmp/fp-base.err /tmp/fp-head.err          # 期望空（stderr 0 bytes）
diff -q /tmp/fp-base.js /tmp/fp-head.js         # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show 8be32537:` 讀未改 base。spike 本地實證：兩端 **4003B / `84d11217…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 1 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量；確認 `waitUntil?` annotation 不觸 `no-floating-promises`/`no-unused-vars`）、`npm run build:functions` green。
- targeted int：跑既有 `tests/integration/forgot-password.test.ts` 9 cases 確認綠（runtime 旁證、不宣稱涵蓋 type annotation）；跑全量 `test:int` 確認無跨檔破壞。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +1/−1、`git diff` 1 處為 `onRequestPost` 簽名 annotation）；超出 = scope creep = Gate fail。

## Merge SOP（process lock，順序不得寫反；[[feedback_pre_merge_gate_checklist_match_ci]]）

① faithfulness ✅ → ② **先**跑齊 merge 前 local gates 全綠（`lint`·`typecheck:ratchet`〔Git Bash `RATCHET_BASE_REF=8be32537` 或 PowerShell `$env:`〕·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit --omit=dev --audit-level=high`）→ ③ 全綠後 owner 明示 `MERGE_ALLOWED` → ④ push branch + 開 PR + `gh pr merge --squash --delete-branch`（禁直推 main）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 memory receipt（SHIPPED 才寫：topic PR-2cn 段 + MEMORY.md index 數字 818→815）。

## Diff hygiene

- 不碰 `CLEANUP_PLAN.md`（untracked、Stage 7 完工才清）；**不碰 A3 餘檔 `local/{login,register}.ts`、任何 util、`end-session.ts`**；baseline 不 `--update`；挑檔 add（1 source + 本 plan doc）禁 `git add .`/`-A`；feature branch `stage7-pr2cn-forgot-password` 禁直推 main；平行 session 唯讀優先、動 git 前先 `git status`。
- **commit 前後核 `git diff --cached --name-status` + net source diff**（[[feedback_commit_verify_staged_set_and_net_source_diff]]；PR-2ck self-review Explore agent stray `git checkout` 污染 index 教訓 — self-review workflow agent 具 Bash、可改 git state；plan-only commit 時 source net-diff 須為空）。
- **CRLF**：spike 實證 `git diff --numstat` = `1  1`（`.gitattributes` `* text=auto eol=lf` 已根治，[[feedback_windows_build_crlf_churn]]、無 whole-file churn）；code 階段 commit 前再驗 `numstat` `1 1`。

---

## 附：owner C-1 裁示表（faithful 收錄 2026-06-21）

### 決策表

| 決策項 | 裁示 | 原因 |
|---|---|---|
| scope | ✅ 批准 | Scout 實查與 owner 裁示一致，錯誤全在 handler destructure |
| waitUntil 型別 | ✅ A：`waitUntil?: (promise: Promise<unknown>) => void` | 忠於現有 `typeof waitUntil === 'function'` guard；避免把 guard 變成靜態恆真；可作為 register/end-session 同 guard 的正確先例 |
| canonical lambda | ✅ 重用既有形 | `_middleware.ts` 已有 `(promise: Promise<unknown>) => void`，不得另創語意 alias |
| self-review | ✅ multi-agent workflow | 不因 scout 乾淨降級；auth/reset password 熱區仍走 plan + code 多維收斂 |
| code 動作 | ❌ 現階段不得寫 code（已 revert spike）| 先 Spec → 非 commit full-solution spike → plan doc → Gate |

### 風險表

| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| `waitUntil` 標成 required | 中 | guard 語意漂移，未來 register/end-session 先例變差 | 採 optional（L2）|
| 誤補 `RESEND_API_KEY` guard | 高 | 行為改動，type-only PR 變 hardening PR | plan lock 明禁（L4）|
| byte-identical 驗證失真 | 中 | 誤判 runtime neutrality | 必跑 canonical emit diff，不用 esbuild 空輸出當證據（L8、emit 4003B 非空已排除）|
| util cascade | 低 | 擴 scope | spike 只驗證、不改 util（L3）；shared `verifyTurnstile` 3 caller 不牽動 |
| 測試覆蓋宣稱過度 | 中 | 把 integration test 說成覆蓋 type annotation | 只稱 runtime 旁證，主證據是 byte-identical（L9）|

### 防禦表

| 機制 | 處理否 | 實作 | 未處理因 |
|---|---|---|---|
| RateLimit | ✅ 保持 | 現有 5/hr IP 限流不動 | type-only PR 不改策略 |
| 權限 / 身分 | ✅ 保持 | JWT aud=`chiyigo` self-skip Turnstile 不動 | 無新增權限面 |
| Input | ✅ 保持 | `request.json()` / email path 不動 | 不改驗證邏輯 |
| XSS | N/A | 無 HTML render 改動 | 非前端輸出 |
| Log / Audit | ✅ 保持 | `safeUserAudit` 呼叫不動 | 不改 audit schema |
| Retry | ❌ 不新增 | 發信失敗回滾 token 的既有行為不動 | 新增 retry 屬 scope creep |
| 備援 / Rollback | ✅ 保持 | 發信失敗刪 token 不動 | type-only |
| 監控 | ✅ 保持 | 現有 audit/log 不動（ratchet 818→815 明列）| 不新增觀測 |
| Type boundary | ✅ 本刀核心 | `request: Request`；`env: Env`；`waitUntil?: (promise: Promise<unknown>) => void` | — |

### DB 鎖定

| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Schema | 不改 `email_verifications` / `users` |
| Atomic | 禁改 token 生成·INSERT·冷卻查詢·IP 限流查詢·發信失敗 `DELETE … WHERE token_hash=?` 回滾 條件與順序 |

### 隔離區 / 鎖定區

- **隔離區**：A3 餘檔（`local/{login,register}.ts`）、shared util（`functions/utils/{turnstile,jwt,email,crypto,auth,user-audit}.ts`）、`auth/oauth/end-session.ts`、`CLEANUP_PLAN.md`、baseline/ratchet override、`RESEND_API_KEY` undefined hardening **全部不得碰**。
- **鎖定區**：所有 runtime（Turnstile self-skip·fail-close / IP 限流 / 反枚舉 200·`fakeHashDelay` 時序 / 60s 冷卻 / token 生成·INSERT / 發信·回滾 / `safeUserAudit` / `typeof waitUntil === 'function'` guard / response body·error code）；return type / JSDoc / 註解 / 格式。

### 驗收標準（owner，faithful 收錄）

| 驗證 | 目標 | spike 實測 |
|---|---|---|
| `tsc -b tsconfig.solution.json --force` | forgot-password 三個 TS7031 消失，無新增錯誤 | ✅ 3→0、ADDED=0 |
| ratchet | `818→815` | ✅ 815/82/252/334 |
| forced solution sort-diff | `REMOVED=3 / ADDED=0` | ✅ |
| cascade | 0 util / 0 test / 0 helper cascade | ✅ tests-leaf 0→0、solution ADDED=0 |
| byte-identical | runtime output identical | ✅ 4003B sha `84d11217…` 兩端、`diff -q` IDENTICAL |
| tests | 跑既有 forgot-password integration；僅作 runtime 旁證 | ⬜ Code 階段 |
| gate | Dual Gate v3.1 全 4 道，不 lighter | ⬜ 進行中 |
