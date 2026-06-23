# Stage 7 reduce PR-2cp — `auth/local/login.ts` noImplicitAny（**A 域 A3 殿後棒、清完即 A 域全清**；單一 direct handler、**無 waitUntil、無 D1-row callback**、type-only、review care **L3**）

**目標**：`functions/api/auth/local/login.ts` 的 **2 個 noImplicitAny error（2×TS7031：`onRequestPost` destructure `request`/`env` @ L38）→ 0**，**純 type-only**（**1 個編輯點** ＝ 唯一 exported handler `onRequestPost` 的 destructured param annotation；TS erase 後 emit byte-identical）。清完 login.ts ＝ **A 域全清（A1..A3 收尾）**。

**Scope（owner C-1 鎖 2026-06-23；單檔、禁併他檔、禁 opportunistic cleanup）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/local/login.ts` | 2（L38 `onRequestPost({request,env})` TS7031 ×2：`(38,39)` request ＋ `(38,48)` env）| **1 個編輯點**（`onRequestPost` destructure param annotation）|

> **主線定位（owner C-1）**：A 域 handler 層續清，**A3 殿後棒（最後一棒）**。PR-2ch 清 A1 五檔 TOTP-caller handler（#104）→ PR-2ci `2fa/setup.ts`（#105）→ PR-2cj A2 `change-password.ts`+`identity/unbind.ts`（#106）→ PR-2ck A 域 `delete.ts` step-1（#107）→ PR-2cl `email/send-verification.ts`（#108）→ PR-2cm `email/verify.ts`（#109）→ PR-2cn `local/forgot-password.ts`（#110、首個 `waitUntil` optional OD 先例）→ PR-2co `local/register.ts`（#111 `a0e70293`、首個 D1-row `.map` callback OD＝const 斷鏈、複用 #110 waitUntil）。本 PR ＝ **A3 殿後棒 `local/login.ts`**，owner 2026-06-23 C-1 裁 **單檔單獨成棒**；**清完即 A 域（A1..A3）全清**。**結構特性**：本檔為**單一 direct handler**（`onRequestPost`，param 直接 destructure `{ request, env }`，**無 wrapper/worker、無 `ctx`、無 `waitUntil`**）＋ module-local helper `fakeHashDelay()`（無參數、不在錯誤集）；查詢用 `.first()`（單筆 JOIN，**無 register 那種 `.all().map()` D1-row callback**）→ A3 系列**結構最簡**（2 錯、1 編輯點、零新 OD）。**但 security 密度為 A 域最高（Tier-0）** → review care L3。**排除**：`game/login.ts`（**不同檔、game 域、out-of-scope**，見 §game/login.ts 裁示）、util `utils/{crypto,jwt,tenant-context,cors,turnstile,auth,cookies,user-audit,scopes,device-alerts,rate-limit,brute-force,risk-score,email}.ts`、其他 handler、大熱區 `audit`/`payments` 域（defer）。

## ⚠ base 錨點修正（stale-base correction；owner C-1 必載）

- **owner 原始 prompt 的 base SHA `a0e70293` 已 stale**。`a0e70293` ＝ PR-2co #111（register）。
- **實查 current main HEAD ＝ `327a2d01`**（`git rev-parse HEAD` 實證 `327a2d011910dd9d0cc09acd98f9a8a7f700467c`、main clean、`origin/main` 同步）。
- 中間 2 commit ＝ `a864faa4`（#112）＋ `327a2d01`（#113），皆 **readonly-reviewer / no-haiku lint workflow 治理 PR**（Part 3/4），**只動 `.claude/workflows/*` ＋ `scripts/lint-workflows.mjs`，零觸 `functions/`**。
- 故 **login.ts 遷移 scope 完全不受影響**；ratchet 三數仍 **811 / 81 / 253**（functions/ 未被那 2 顆動到的佐證）。
- **本 PR base 錨 `327a2d01`（current main），不沿用 stale `a0e70293`**（owner C-1 2026-06-23 裁；避免後續 gate packet base 不一致、降低 faithfulness 可審性）。
- branch `stage7-pr2cp-login`（自 clean main `327a2d01` 開、未 push）。

## ⚠ annotation 形式裁定（owner C-1 採 A；§4 arrow const 手誤已否決）

- **正式 frozen form ＝ §0 function-declaration ＋ inline param type**（owner C-1 2026-06-23 採 **(A)**）：
  ```ts
  export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  ```
- owner 原 C-1 §4 code block 顯示 `export const onRequestPost = async (...) =>`（**arrow const**）→ **判定為示意手誤、不採用**。理由：arrow const 會 ① 破壞 byte-identical（function declaration → const arrow 是結構改寫、type-strip 後 JS emit 不同）② 破壞「1 編輯點」（改寫宣告形式）③ 引入 runtime drift（function declaration hoisting vs const arrow TDZ；本檔 `fakeHashDelay` L302 正是 hoisted function declaration）④ 與 §0 決定表 annotation 欄 + §4 自身文字目標（「1 編輯點、零 runtime drift、若格式器維持單行也可接受」）自相矛盾。
- **不 waive §3 鎖定**（byte-identical / 1 edit point / no runtime drift 全有效）。採 (A) 保留原始 function declaration runtime shape，type-strip 後回到原 JS emit。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔、1 annotation）/ review care **L3**（**owner C-1**：login 是 **A 域 security 最密集 Tier-0 入口** — brute-force IP 黑名單 + cross-user scan 偵測、漸進 cooldown、rate-limit〔ip 5/min + email 10/15min〕、risk-score deny/medium、2FA `pre_auth_token` gating、anti-enumeration `fakeHashDelay`、banned 帳號擋發 token、session_id + JWT + refresh token + tenant claims、`login_attempts` 記錄/清除）。走**完整 Dual Gate v3.1 四道外部審查、不用 lighter**。
- **self-review ＝ multi-agent workflow（owner C-1 2026-06-23 明示）**：即使 scout / spike 乾淨亦不得降級單 agent（[[feedback_self_review_form_not_downgradable_by_spike]]）。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（不碰任何 util、不碰 `game/login.ts`、不碰 runtime guard〔brute-force / rate-limit / cooldown / risk-score / 2FA gating / `fakeHashDelay` 時序 / banned 擋 token / `login_attempts` / session_id / JWT / refresh INSERT / `if (env.RESEND_API_KEY)` risk-blocked email〕、不碰 `CLEANUP_PLAN.md`）。finder/verifier 用 **`readonly-reviewer` global agent**（無 model pin → 繼承 session model；本 session registry 已載，[[feedback_selfreview_workflow_model_inheritance]]）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-23：scope ＝ 單檔、納入全 2 錯（L38）；base 錨 `327a2d01`；OD ① `request: Request`（plain）② `env: Env`（full）；annotation 形式採 (A) function-declaration + inline type；self-review 形式 ＝ multi-agent workflow；**禁** `Pick`、**禁** `CfRequest`、**禁** required runtime 改動、**禁** 新增安全功能、**禁** `EventContext`/`@cloudflare/workers-types`/新 import/新 ambient；`game/login.ts` + 全 util + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only @ `327a2d01`）→ 逐檔 error set（**恰 2 錯：2 TS7031 @ L38**，符 owner 預期、不重演 register 3→4）+ caller cascade（7 直接 importer 拆解、shared `verifyTurnstile` 3-caller 不牽動）+ 測試覆蓋分層 + 結構判定（單一 direct handler、無 wrapper/worker/`ctx`/`waitUntil`/其他 export）+ 無 `.cf` + 無 D1-row callback（`.first()`）+ tests-leaf cascade 實測。**全對齊 owner 預期、無 stop-rule 觸發**（唯 base SHA stale → 回報 → owner C-1 裁錨 `327a2d01`）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、blob 回 `87d0d8cf`）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow `wf_bc6ef081-856`、3 agents 三維 rubric：scope / runtime·security / evidence；readonly-reviewer 繼承 session model Opus 4.8；三維全 **0 findings**、accepted 0、suspicious 0；主線獨立對抗式裁決認同 clean — 見 §Gate 進程紀錄）
  - ⬜ `CHATGPT_ARCH_APPROVED`（① 維度 B）→ ⬜ `CODEX_PLAN_APPROVED`（② 維度 C）→ ⬜ owner `CODING_ALLOWED`
  - ⬜ Code 階段（source commit、full replay @ source、NB-2 雙證）→ ⬜ `CODE_SELF_REVIEW_CLEAN` → ⬜ `CODEX_CODE_APPROVED`（③）→ ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（④）
  - ⬜ merge-front 7 gates → ⬜ owner `MERGE_ALLOWED` → ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪修 gate 回饋）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。外部未送不得自我宣告通過。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-23 Claude **scout（read-only @ `327a2d01`）** → 逐檔 error set（**恰 2 錯**，符 owner 預期：`(38,39)` `request` ＋ `(38,48)` `env`、皆 TS7031 @ L38；無第 3 錯 — 無 helper/callback implicit-any、`fakeHashDelay()` 無參數不在錯誤集、查詢 `.first()` 無 `.map` callback）+ caller cascade（見 §依賴邊界：7 直接 importer，6 走 `callFunction(handler,…)` untyped sever、1 走 user-audit direct-literal type-compatible；shared `verifyTurnstile` 3-caller〔register/login/forgot-password，另 2 已遷〕annotate 本檔 param 不改 util、不牽動另 2 caller）+ coverage 分層（**有** direct integration test、7 檔 import handler）+ 結構判定（**單一 direct handler** `onRequestPost`、無 wrapper/worker/`ctx`/`waitUntil`/其他 export；helper `fakeHashDelay` module-local 非 export）+ 無 `request.cf`（plain `Request`）+ 無 D1-row map callback。**唯一偏差 ＝ owner prompt base SHA stale（`a0e70293` → 實 `327a2d01`）→ 依紀律停手回報、不自改 scope**（其餘全對齊 owner 預期）。
- 2026-06-23 owner **C-1 裁示（APPROVED_TO_PLAN；pre-SPEC → SPEC，faithful 收錄）**：① base 錨 **current main `327a2d01`**（不沿用 stale `a0e70293`；plan 明載 stale 修正 + #112/#113 不觸 functions/ + ratchet 三數不變）；② scope ＝ 僅 `functions/api/auth/local/login.ts`；③ OD 全鎖（`request: Request` plain、`env: Env` full、1 編輯點 L38）；④ **annotation 形式採 (A) function-declaration + inline type**（§4 arrow const 判定手誤、否決；不 waive §3 byte-identical / 1-edit-point / no-runtime-drift 鎖定）；⑤ review care ＝ **L3**（A 域 security 最密集 Tier-0）；⑥ self-review ＝ multi-agent workflow（plan + code 各跑、readonly-reviewer 繼承 session model、不降級）；⑦ runtime 改動禁止（嚴格 type-only、不補/不動任何安全功能）；⑧ `game/login.ts` 明確 out-of-scope（只記 backlog/殘留盤點）。完整 lock + 風險表 + 防禦表見 §附。
- 2026-06-23 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（solution 811→809、sort-diff REMOVED=2/ADDED=0、tests-leaf 0→0、byte-identical 9523B sha `9f8d81e1…` 兩端一致 esbuild stderr 0、ratchet:report base 811/81/253/334 → patched 809/80/254/334、frozen diff numstat 1/1 blob `87d0d8cf→06dead7c`、`git diff --check` clean）。
- 2026-06-23 **multi-agent workflow self-review（維度 A，rubric 收斂三維 scope / runtime·security / evidence；run `wf_bc6ef081-856`、3 agents / 237103 subagent tokens / 75 tool uses / ~7.4min；finder+verifier 皆 `readonly-reviewer` 繼承 session model Opus 4.8）→ `PLAN_SELF_REVIEW_CLEAN`**：三維 finder（pipeline + adversarial verify、default refuted、readonly-reviewer read-only）**全 0 findings、accepted 0、suspicious_input 0**（type-only plan 忠實 → clean 為預期；rubric 依 [[feedback_self_review_form_not_downgradable_by_spike]] 收斂三項不擴全域、不跑通用 7-finder 以避免 tenant/migration/payment 等 N/A 維度系統性假陽性）。**主線獨立對抗式裁決（非採 raw 輸出，v3.1 §5）認同 clean**：① 無 PR-2co(#111) 數據洩漏（grep `18976c9e`/`778c1b4a`/`9227b6b9`/`7563`/`58664200`/`815` 全 **ABSENT**）；② login current data 內部一致（base `327a2d01`×18、blob `87d0d8cf→06dead7c`、emit `9523B`/sha `9f8d81e1`、solution 811→809、ratchet 811/81/253/334→809/80/254/334）；③ frozen diff 唯一變更行為 function-declaration `onRequestPost({ request, env }: { request: Request; env: Env })`（arrow const 僅出現在 §annotation 形式裁定的「已否決手誤」說明、未嵌為解）；④ hot-zone lock 表親讀 login.ts 對照、涵蓋全安全機制。**review agents 未污染 git**（主線獨立驗：`git status --porcelain` 僅 `?? CLEANUP_PLAN.md` + 本 plan doc、HEAD `327a2d01`、login.ts working blob `87d0d8cf` 未動、staged 空、`git diff 327a2d01..HEAD -- functions/` 空）。

## owner 鎖定表（C-1 ruling 2026-06-23，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 只改 `functions/api/auth/local/login.ts`；納入全 2 錯（L38），目標 login.ts 0 noImplicitAny、cleanFiles +1（**A 域全清**）|
| L2 Handler type shape | `request: Request`（plain）、`env: Env`（full）；**無 `waitUntil`**（本檔不 destructure waitUntil）|
| L3 annotation 形式 | **(A) function-declaration ＋ inline param type**：`onRequestPost({ request, env }: { request: Request; env: Env })`；**禁** arrow const（`§4` 手誤已否決）、**禁** named type alias、**禁** 拆多行（格式器維持單行即可，gate 以實際 hunk 為準）|
| L4 No new shared type / no util change | 不新增 shared type、不改任何 util signature |
| L5 env = full Env（**禁 Pick**）| handler 整包 forward env 給 7+ util（`verifyTurnstile`/`safeUserAudit`/`computeRiskScore`/`sendRiskBlockedAlertEmail`/`signJwt`/`resolveActiveTenantClaims`/`safeAlertAnomalies`）＋ `db = env.chiyigo_db` 給 4 util（`isIpBlacklisted`/`checkRateLimit`/`getUserCooldownSeconds`/`detectAndBlacklistCrossUserScan`）；無 partial-fake-env unit test → [[feedback_util_env_param_pick_not_full_env]] 不適用、full Env 正確（spike ADDED=0 證）|
| L6 request = plain Request（**禁 CfRequest**）| 僅 `request.headers.get('CF-Connecting-IP')` + `request.json()`，**無 `.cf` 存取** → plain `Request` |
| L7 No new security feature | login 既有 brute-force/rate-limit/cooldown/risk-score/2FA gating 全鎖；**本 PR 禁新增/修改任何安全功能**（type-only、不改防禦面）|
| L8 Runtime hot-zone lock | 不改 Turnstile fail-close / IP 黑名單 / rate-limit / 漸進 cooldown / user+local_account JOIN 查詢 / `fakeHashDelay` 時序 / `verifyPassword` / banned 擋 token / risk-score deny·medium + risk-blocked email guard / `login_attempts` INSERT·DELETE / 2FA `pre_auth_token` 簽發 / session_id + JWT access token + tenant claims / refresh token INSERT / `safeUserAudit` 各路徑 / `safeAlertAnomalies` / `isWebClient`·Set-Cookie·body refresh / response·error code |
| L9 Spike evidence | full-solution spike 必須**非 commit**，證明 **REMOVED=2 / ADDED=0** |
| L10 byte-identical evidence | byte-identical 必須是 **type-strip / canonical emit 證據**（esbuild `--loader=ts --format=esm` stdin），不接受「測試通過」替代 |
| L11 Coverage | 逐 sub-path 下鑽；handler 有 direct integration test（7 檔），但 type-only 改動 runtime 不可見 → **主硬保證 ＝ byte-identical**，integration test 僅作 runtime 旁證、不宣稱「覆蓋型別標註」（[[feedback_pr_coverage_claim_accuracy]]）；⚠ **Turnstile 僅 skip-path**（測試多未設 `TURNSTILE_SECRET_KEY`、不宣稱涵蓋 fail-close）|
| L12 Evidence replay | plan + code 階段都重跑 ratchet / forced sort-diff / byte-identical / tests-leaf；Code 階段 **不沿用 spike**、source commit 後重量（NB-2 雙證）|
| L13 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔（含 `game/login.ts`）/ coverage overclaim / 偏離 C-1 裁定 OD（用 `Pick` / 用 `CfRequest` / arrow const / 新增安全功能 / 動 guard）→ 退回 `PLAN_DRAFT` |

## ⚠ login 熱區聲明（review care L3，A 域 security 最密集 Tier-0 入口）

`auth/local/login.ts` 為**本地登入入口**，A 域 security 最密集：解析 body → Turnstile fail-close → **IP 黑名單擋**（`isIpBlacklisted`）→ **rate-limit**（ip 5/min + email 10/15min）→ **漸進 cooldown**（`getUserCooldownSeconds`）→ user+local_account JOIN 查詢 → 帳號不存在/軟刪 → `fakeHashDelay` anti-enumeration + `login_attempts` INSERT + **cross-user scan 偵測**（`detectAndBlacklistCrossUserScan`）→ `verifyPassword` → 密碼錯同上偵測 → **banned 擋發 token** → **risk-score**（`computeRiskScore` → `shouldDenyByRisk` deny / `isRiskMedium` warn + `if (env.RESEND_API_KEY)` risk-blocked email）→ 清 `login_attempts` → **2FA gating**（`totp_enabled` → `signJwt` `pre_auth_token` 403 `TOTP_REQUIRED`）→ 無 2FA：session_id + JWT access token（+ tenant claims + `sid`）+ refresh token INSERT → `safeUserAudit` success + `safeAlertAnomalies` → `isWebClient` 決定 Set-Cookie refresh / body refresh_token。修法若非純型別、或牽動下列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L7/L8）：

| 區塊 | 紅線（typing 全程不得牽動）|
|---|---|
| 輸入驗證 | `!email \|\| !password` guard / `resolveAud(aud)` 不動 |
| Turnstile fail-close | `verifyTurnstile(request, body, env)` → `!ts.ok` 回 `CAPTCHA_FAILED` 403 不動 |
| IP 黑名單 | `isIpBlacklisted(db, ip)` → `IP_BLOCKED` 429 + audit 不動 |
| rate-limit | `checkRateLimit(db, {…ip 5/60})` + `{…email 10/900}` → `RATE_LIMITED` 429 + audit 不動 |
| 漸進 cooldown | `getUserCooldownSeconds(db, emailNorm)` → `COOLDOWN` 429 + `retry_after` 不動 |
| 查詢 | user+local_account JOIN `.first()`（SELECT 欄位、`WHERE u.email=?`）不動 |
| anti-enumeration | `fakeHashDelay()` 時序 + `login_attempts` INSERT + `detectAndBlacklistCrossUserScan`（未知 user + 密碼錯兩路）不動 |
| 密碼驗證 | `verifyPassword(password, salt, hash)` 不動 |
| banned | `record.status === 'banned'` → `ACCOUNT_BANNED` 403 + audit 不動 |
| risk-score | `computeRiskScore` / `shouldDenyByRisk` deny 403 `RISK_BLOCKED` / `isRiskMedium` warn / `if (env.RESEND_API_KEY)` risk-blocked email（含 try/catch swallow）全不動 |
| login_attempts 清除 | `DELETE FROM login_attempts WHERE kind='login' AND email=?`（fire-and-forget、順序在 risk 後）不動 |
| 2FA gating | `if (record.totp_enabled)` → `signJwt({scope:'pre_auth',…risk forward}, PRE_AUTH_TOKEN_TTL, env)` → 403 `TOTP_REQUIRED` 不動 |
| token 簽發 | `crypto.randomUUID()` session_id / `resolveActiveTenantClaims` / `signJwt({…tenantClaims, sub, …sid}, ACCESS_TOKEN_TTL, env, {audience})` / `generateSecureToken` + `hashToken` + `INSERT refresh_tokens (…, session_id)` + `device_uuid ?? null` + `issued_aud` 不動 |
| Audit | `safeUserAudit` 各路徑（ip_blacklisted/rate_limited/cooldown/fail×2/ip_blacklist_added×2/banned_attempt/risk.blocked/risk.medium/success）+ `safeAlertAnomalies` 不動 |
| 回應通道 | `isWebClient(request, { platform })` → web 走 `Set-Cookie: refreshCookie(...)` 200 / 非 web 走 body `refresh_token`；不動 |

註：本刀只在唯一 exported handler `onRequestPost` 簽名加 inline param annotation，TS erase 後 runtime byte-identical（SQL / 常數 / audit·log / 字串 / 註解 / `fakeHashDelay` / 全 guard 全不變）。

### Coding 階段硬性邊界

- **允許**：`onRequestPost({ request, env })` 加 `: { request: Request; env: Env }`（§frozen diff 唯一變更行，L38）。
- **禁止**：改任何 SQL / Turnstile fail-close / IP 黑名單 / rate-limit / 漸進 cooldown / `fakeHashDelay` 時序 / `verifyPassword` / banned 擋 token / risk-score deny·medium·email guard / `login_attempts` INSERT·DELETE / 2FA `pre_auth_token` / session_id·JWT·tenant claims / refresh token INSERT / `safeUserAudit`·`safeAlertAnomalies` / `isWebClient`·Set-Cookie·body refresh / response body·error code / `RESEND_API_KEY` 行為（不補·不動現有 guard）/ **新增任何安全功能** / caller（7 test 檔 / 另 2 `verifyTurnstile` caller）/ shared util（14 檔 import）/ tests / `env.d.ts` / `tsconfig`·`eslint`·`vitest` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext`·`CfRequest`·`@cloudflare/workers-types` / `Pick<Env>` / arrow const 形式 / **碰 `game/login.ts`** / 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `327a2d01`）

### exact errors（forced `tsc -b tsconfig.solution.json --force`，solution total 811）

```
functions/api/auth/local/login.ts(38,39): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/local/login.ts(38,48): error TS7031: Binding element 'env' implicitly has an 'any' type.
```

**恰 2 個**（符 owner 預期）：2×TS7031（`onRequestPost` 單一 destructure param 的 `request`/`env` @ L38）。**單一 handler**（無 `onRequestGet`、無 wrapper/worker、無其他 export；`fakeHashDelay` @ L302 module-local 非 export、無參數、不在錯誤集）。**無第 3 錯**：查詢用 `.first()`（L100-118 單筆 JOIN）→ **無** register 那種 `.all().map()` D1-row callback TS7006；body `?? {}` destructure 在 `request: Request` 下 `request.json()` 回 `any`（WebWorker lib）→ `body` any → 0 錯（register 同形態已證）。

> ⚠ 無 `request.cf` → plain `Request`、**禁引入 `CfRequest`**（owner L6）。
> ⚠ 另有 `functions/api/auth/game/login.ts`（**不同檔、game 域**）亦未遷移（3 錯：2 TS7031 + 1 TS7053 index）→ **out-of-scope**（見 §game/login.ts 裁示）。

### 依賴邊界（caller cascade）

`login.ts` 是 Pages file-routing entry，cascade 面（**頭號 scout 風險 ＝ tests-leaf cascade**，因 7 test 檔直接 import handler；實測 = 0）：

| 面 | 判定 | 證據 |
|---|---|---|
| `onRequestPost` 外部 production TS caller | **0 牽動** | `grep local/login` 於 functions/ **無任何 TS/JS importer**（Pages file-routing、production runtime 由 Pages 注入 context、不靜態 type-check 本 annotation）|
| direct integration test importer（**7 檔**）| **0 cascade（實測）** | 6/7 走 `callFunction(loginPost, req)`〔`_helpers.ts:324` `callFunction(handler, request)` 的 `handler` 在 tests-leaf（noImplicitAny:false）為隱式 `any` → **型別連結被 helper 抹除**〕：`brute-force` / `rate-limit` / `login` / `risk-score` / `jwt-sid-claim` / `token-version`。**1/7** `user-audit.test.ts` 走 **direct-literal** `loginHandler({ request: jsonPost(...), env })`〔L83/L95〕：`jsonPost(...)` → `Request`（`_helpers.ts:336` 回 `new Request(...)`）✓、`env` 來自 `cloudflare:test`（`types/env.d.ts:107-109` **`interface ProvidedEnv extends Env`** 橋接）→ assignable `env: Env` ✓、object literal **恰 `{request, env}` 兩屬性無 excess** → 0 TS2345（同 PR-2cj change-password / PR-2ch step-up / PR-2cc metrics direct-literal 先例）。**spike `tsc -b tsconfig.tests.json --force` base 0 → patched 0 實證** |
| shared `verifyTurnstile` caller | **不牽動** | 本檔 L51 `verifyTurnstile(request, body, env)`；annotate 後 `Request`→param1、`body`(any)、`Env`→`Pick<Env,'TURNSTILE_SECRET_KEY'>` 全 assignable；**不改 util、不牽動另 2 caller**〔`register.ts`(#111 已遷)/`forgot-password.ts`(#110 已遷)〕。login 為最後一個 `verifyTurnstile` caller 遷移 |
| intra-file env / request / db 存取 | 全相容 | `request.json()`(WebWorker lib→`any` body)、`request.headers.get(...)`、`env.chiyigo_db`(D1Database→any、[[feedback_d1database_resolves_any_no_workers_types]])、`env.RESEND_API_KEY`(env.d.ts `RESEND_API_KEY?: string`→narrow)、7 env-util + 4 db-util forward 全 assignable（spike ADDED=0 實證）；**無 `.cf`** |

**precedent landscape（佐證 OD ruling）**：
- **`request: Request` / `env: Env` 直連 handler** ＝ repo 主流 Convention A（數十檔已清，含同域 #109 `email/verify.ts` / #110 `forgot-password.ts` / #111 `register.ts`）→ **零新 OD**；`env` 用 **full `Env`**（handler 整包 forward 7+ env-util，util 各收 `Pick`/untyped、full Env structural assignable，[[feedback_util_env_param_pick_not_full_env]]：handler 用 Env、util 用 Pick）。
- **無 `waitUntil`**：本檔 handler 不 destructure `waitUntil`（email 寄送走 `await`，非 `waitUntil` fire-and-forget）→ 比 #110/#111 更簡、**不觸 waitUntil OD**。
- **無 D1-row `.map` callback**：查詢用 `.first()`（單筆）非 `.all().map()` → **不觸 register #111 的 D1-row callback OD**。
- **direct-literal test caller（user-audit）**：與 PR-2cj/2ch/2cc 同款（`{ request: new Request/jsonPost(...), env }` 兩屬性 literal、`ProvidedEnv extends Env` 橋接）→ 0 cascade。

### 型別選型（owner C-1 OD ruling）

允許落地的唯一 source diff（1 編輯點）：

```ts
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {  // L38
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| `request` | **`Request`（plain）** | `request.json()`(→`any` body) + `request.headers.get('CF-Connecting-IP')` + 傳 `verifyTurnstile`/`safeUserAudit`/`computeRiskScore`/`safeAlertAnomalies`/`isWebClient`；**無 `.cf`** → 非 `CfRequest` |
| `env` | **`Env`（full，Convention A）** | 整包 forward 7+ env-util；`env.chiyigo_db`(any) + `env.RESEND_API_KEY`(declared)；spike ADDED=0 證零 cascade；無 partial-fake-env unit test → 不用 Pick |
| annotation 形式 | **(A) function-declaration + inline type**（C-1） | 保原 runtime shape、byte-identical、1 編輯點；**禁** arrow const（手誤）|
| OD 形態 | **零新 OD**（複用 Convention A；無 waitUntil、無 D1-row callback）| 單一 direct handler、A3 最簡 |
| `Pick<Env>`（**否決**）| **禁** | env 整包 forward、無 partial-fake-env caller；Pick 會誤導讀者「只用部分 env」|
| `CfRequest`（**否決**）| **禁** | 無 `.cf` 存取；引入多餘語義 |
| arrow const 形式（**否決**）| **禁** | 破壞 byte-identical / 1-編輯點 / runtime shape（§annotation 形式裁定）|
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 2 錯 |

## Spike 實證（full-solution，本地未 commit，2026-06-23，已 revert clean）

**程序**：建 branch（自 clean main `327a2d01`）→ 量 base（forced solution 811、login 2 錯、base emit 9523B sha `9f8d81e1…`）→ 套 1 編輯點（L38）→ forced `tsc -b tsconfig.solution.json --force`（sorted error set diff）→ forced `tsc -b tsconfig.tests.json --force`（tests-leaf）→ ratchet report → canonical byte-identical（esbuild stdin）→ frozen diff + `git diff --check` → `git checkout --` revert → 驗 clean（blob 回 `87d0d8cf`、staged 空、`git status` 僅 `?? CLEANUP_PLAN.md`）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| login errors 2 → 0 | ✅ sort-diff REMOVED = 恰 2 行（`(38,39)` `request` / `(38,48)` `env` TS7031）；patched 0 殘留 |
| solution errorCount 811 → 809（恰 −2）| ✅ forced tsc solution **809**；sort-diff ADDED = **空（0）**|
| zero cascade（functions + tests + scripts + browser，全 solution）| ✅ solution sort-diff **REMOVED=2 / ADDED=0**；另 `tsc -b tsconfig.tests.json --force` **base 0 → patched 0**（無 login.ts 錯、exit 0）= **tests-leaf cascade 0（頭號風險 cleared）**|
| canonical ratchet `--report`（base → patched）| ✅ base errorCount **811** / errorFiles **81** / cleanFiles **253** / sourceFilesTotal **334** → patched **809** / **80** / **254** / **334** |
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`** stdin，[[feedback_byte_identical_emit_verification]]）| ✅ esbuild **stdin** type-strip base vs patched **IDENTICAL**、皆 **9523B**、esbuild stderr 空：<br>sha256 `9f8d81e1d561616a1d19f9205c31ffde5f2f099c0fd03e09038033028b475320` 兩端 |
| `git diff --check`（source）| ✅ exit 0（無 trailing whitespace / lone space）|
| frozen diff numstat | ✅ `1  1`（1 insertion / 1 deletion；無 whole-file CRLF churn）；base blob `87d0d8cf` → head blob `06dead7c` |
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、blob 回 `87d0d8cf`、staged 空 |

**byte-identical 適用性**：login.ts **14 個 import statement**（crypto / jwt / tenant-context / cors / turnstile / auth / cookies / user-audit / scopes / device-alerts / rate-limit / brute-force / risk-score / email）→ esbuild stdin transform **適用**（單檔 transform、import 行原樣保留；type-only annotation PR 這正是對的證明面 — 改動僅限本單檔、其他檔 byte 不變 → bundle 等價）。⚠ 用 **stdin**（`<` / pipe），非 file-entry `--loader`（後者吐空字串 sha `e3b0c442…` 是 tell，[[feedback_byte_identical_emit_verification]]）；本 spike emit 9523B 非空、已排除該坑。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/local/login.ts b/functions/api/auth/local/login.ts
index 87d0d8cf..06dead7c 100644
--- a/functions/api/auth/local/login.ts
+++ b/functions/api/auth/local/login.ts
@@ -35,7 +35,7 @@ const ACCESS_TOKEN_TTL    = '15m'
 const PRE_AUTH_TOKEN_TTL  = '5m'
 const REFRESH_TOKEN_DAYS  = 7

-export async function onRequestPost({ request, env }) {
+export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
   // ── 1. 解析 Body ────────────────────────────────────────────
   let body
   try { body = await request.json() }
```

`git diff --stat`：1 file changed, 1 insertion(+), 1 deletion(-)；`git diff --numstat`：`1  1`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `327a2d01` `--report`：errorCount **811** / errorFiles **81** / cleanFiles **253** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **811 → 809**（−2）、errorFiles **81 → 80**、cleanFiles **253 → 254**（spike 實測值、非預測；login 全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]；對外報告稱「current state 降至 809」勿暗示 baseline file 已更新）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 唯一 exported handler `onRequestPost` 簽名 inline param 型別標註，TS erase 後 runtime byte-identical（§Spike sha `9f8d81e1…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 811、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。

## 測試影響面（覆蓋誠實，L11 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf base 0 → patched 0、無 login.ts 錯、exit 0 實證）。
- **覆蓋分層（誠實，逐 sub-path 下鑽）**：

| 標的 | direct test | 真打路徑 | 硬保證 |
|---|---|---|---|
| `local/login.ts`（handler `onRequestPost`）| ✅ **有（7 檔）**：`login` / `brute-force` / `rate-limit` / `risk-score` / `jwt-sid-claim` / `token-version` / `user-audit` | 6 檔 `callFunction(loginPost,…)`〔untyped 切斷型別連結〕；1 檔 `user-audit` direct-literal `loginHandler({request,env})` | **byte-identical 為主硬保證**；integration test 為 runtime 旁證 |

- **下鑽證據（不 overclaim）**：
  - direct integration test 涵蓋 login happy / web vs app cookie / 2FA TOTP_REQUIRED / 密碼錯 / 軟刪 / banned / rate-limit / IP 黑名單 / cooldown / cross-user scan / risk-score deny·medium / sid claim / token-version / audit 等路徑。
  - ⚠ **Turnstile 覆蓋校正（不 overclaim、[[feedback_pr_coverage_claim_accuracy]]）**：測試多**未設 `TURNSTILE_SECRET_KEY`、未送 `cf-turnstile-response`** → 只走 `verifyTurnstile` 的 **missing-secret skip path**；**fail-close（`!ts.ok` → 403 `CAPTCHA_FAILED`）路徑不在本 PR 宣稱涵蓋範圍**。故僅宣稱「涵蓋 Turnstile skip path」（Code 階段 grep 實證）。
  - **誠實界線**：type-only 改動 runtime 不可見（型別 erase）＋ 6/7 `callFunction` 之 `handler` untyped 切斷 test↔handler 型別連結（user-audit direct-literal 亦不「覆蓋」型別本身、只驗 runtime）→ integration test **不能「覆蓋」型別標註本身**；它提供「emit 不變則 login 各路徑行為不變」的旁證。**主硬保證 = byte-identical emit（sha 兩端一致）**。
- 與 PR-2ci..2co（皆以 byte-identical 為硬保證）同策略；本檔額外有 7 direct test 作旁證，但**仍不宣稱 type annotation 被測試覆蓋**。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`（或用 `--force`）。**PowerShell 用 `$env:RATCHET_BASE_REF='327a2d01'`**（勿照字面跑 POSIX `VAR=x npm`）；唯獨 byte-identical 段用 Git Bash（PowerShell 5.1 不支援 `<` stdin redirection、`esbuild.ps1` 受 execution policy 阻擋）。

- `$env:RATCHET_BASE_REF='327a2d01'; npm run typecheck:ratchet` green（811→809 / 81→80 / 253→254）。
- filtered forced tsc：login.ts 0 殘留 + solution sort-diff **REMOVED=2 / ADDED=0** + `tsc -b tsconfig.tests.json --force` exit 0（base 0 → patched 0）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**：

```bash
git show 327a2d01:functions/api/auth/local/login.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/login-base.js 2>/tmp/login-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/local/login.ts > /tmp/login-head.js 2>/tmp/login-head.err
wc -c /tmp/login-base.js /tmp/login-head.js        # 期望 9523 兩端
sha256sum /tmp/login-base.js /tmp/login-head.js     # 期望 9f8d81e1d561616a… 兩端
cat /tmp/login-base.err /tmp/login-head.err          # 期望空（stderr 0 bytes）
diff -q /tmp/login-base.js /tmp/login-head.js         # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show 327a2d01:` 讀未改 base。spike 本地實證：兩端 **9523B / `9f8d81e1…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 1 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量；確認 inline param annotation 不觸 `no-floating-promises`/`no-unused-vars`/`no-undef`）、`npm run build:functions` green。
- targeted int：跑既有 7 個 direct test 確認綠（runtime 旁證、不宣稱涵蓋 type annotation；Turnstile 僅 skip path）；跑全量 `test:int` 確認無跨檔破壞（login 牽動多 security 測試）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +1/−1、`git diff` 1 處為 `onRequestPost` 簽名）；超出 = scope creep = Gate fail。

## Merge SOP（process lock，順序不得寫反；[[feedback_pre_merge_gate_checklist_match_ci]]）

① faithfulness ✅ → ② **先**跑齊 merge 前 local gates 全綠（`lint`·`typecheck:ratchet`〔Git Bash `RATCHET_BASE_REF=327a2d01` 或 PowerShell `$env:`〕·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit --omit=dev --audit-level=high`）→ ③ 全綠後 owner 明示 `MERGE_ALLOWED` → ④ push branch + 開 PR + `gh pr merge --squash --delete-branch`（禁直推 main）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 memory receipt（SHIPPED 才寫：topic PR-2cp 段 + MEMORY.md index 數字 811→809、標 **A 域全清**）。

## Diff hygiene

- 不碰 `CLEANUP_PLAN.md`（untracked、Stage 7 完工才清）；**不碰 `game/login.ts`、任何 util、其他 handler**；baseline 不 `--update`；挑檔 add（1 source + 本 plan doc）禁 `git add .`/`-A`；feature branch `stage7-pr2cp-login` 禁直推 main；平行 session 唯讀優先、動 git 前先 `git status`。
- **commit 前後核 `git diff --cached --name-status` + net source diff**（[[feedback_commit_verify_staged_set_and_net_source_diff]]；self-review workflow agent 具 Bash、可改 git state；plan-only commit 時 source net-diff 須為空）。
- **CRLF**：spike 實證 `git diff --numstat` = `1  1`（`.gitattributes` `* text=auto eol=lf` 已根治，[[feedback_windows_build_crlf_churn]]、無 whole-file churn）；code 階段 commit 前再驗 `numstat` `1 1`。

## game/login.ts 裁示（owner C-1，out-of-scope）

`functions/api/auth/game/login.ts` **不納入 PR-2cp**。原因：它是**不同檔、不同域（game）**，且含 **TS7053 index 錯**（`{ discord: string }` 以 string index）→ 已非「`local/login.ts` A3 殿後棒」的單點 type annotation 清理。納入會把本 PR 從 2-error type annotation 變成 mixed-shape cleanup（scope creep）。→ **out-of-scope，另開殘留清單或下一棒處理**（與 `audit`/`payments` 大熱區同列 defer backlog）。

---

## 附：owner C-1 裁示表（faithful 收錄 2026-06-23）

### 決策表

| 決策項 | 裁示 | 原因 | 鎖定 |
|---|---|---|---|
| base SHA | ✅ 採 current main `327a2d01` | prompt `a0e70293` stale；#112/#113 不觸 functions/、ratchet 三數不變 | plan 明載 stale 修正 |
| scope | ✅ 僅 `local/login.ts`（全 2 錯）| A3 殿後棒、清完 A 域全清 | 單檔、禁併他檔 |
| annotation 形式 | ✅ (A) function-declaration + inline type | 保 runtime shape、byte-identical、1 編輯點；§4 arrow const 手誤否決 | 禁 arrow const / named alias |
| env | ✅ full `Env`（禁 Pick）| 整包 forward 7+ util、無 partial-fake-env caller | 禁 Pick |
| request | ✅ plain `Request`（禁 CfRequest）| 無 `.cf` 存取 | 禁 CfRequest |
| review care | ✅ L3 | login 是 A 域 security 最密集 Tier-0 入口 | Dual Gate v3.1 四道、不 lighter |
| self-review | ✅ multi-agent workflow（readonly-reviewer 繼承 session model）| 不因 scout 乾淨降級 | 沿用既有規則 |
| runtime scope | ✅ 嚴格 type-only | 只解 implicit-any、不補安全功能、不重構 | byte-identical 必驗 |
| game/login.ts | ✅ out-of-scope | 不同檔/域、含 TS7053、避免 scope creep | 另案/backlog |

### 風險表（faithful 收錄）

| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| stale base SHA | 中 | gate packet 對齊錯誤、faithfulness 被迫補查 | plan anchor 改 `327a2d01`、記錄 #112/#113 不觸 functions（L0 stale-base 段）|
| auth login runtime 誤改 | 高 | 登入 / brute-force / 2FA gating / `fakeHashDelay` 時序 / risk-score / session 可能變更 | 限定 type-only；code diff 只允許 L38；byte-identical（L8/L10）+ L3 四 gate |
| env 誤改 `Pick` | 中 | 7+ util forward 破型或引入額外 OD | 鎖 full `Env`（L5）|
| request 誤升 `CfRequest` | 低-中 | 無 `.cf` 使用、引入多餘語義 | 鎖 plain `Request`（L6）|
| tests-leaf cascade（7 direct importer）| 中 | direct importer 可能 TS2345 | scout forced rebuild 已證 ADDED=0 / tests-leaf 0→0；plan-phase 重跑（L9/L12）|
| arrow const 形式誤用 | 中 | 改 hoisting/binding 語義、破壞 byte-identical、非 type-only | 鎖 (A) function-declaration（L3）|
| 順手處理 `game/login.ts` | 中 | scope creep、破壞 A 域殿後棒邊界 | 明確 out-of-scope（L13、§game/login.ts 裁示）|

### 防禦表（owner C-1；login 既有完整安全鏈、本 PR 全不動）

| 機制 | 處理否 | 實作 | 未處理因 |
|---|---|---|---|
| RateLimit | 既有 | 本檔現有 `checkRateLimit`（ip 5/min + email 10/15min）+ IP 黑名單 + 漸進 cooldown + cross-user scan | 本 PR type-only、**不改/不新增 rate-limit 行為** |
| 權限 | 既有 | banned 擋發 token、2FA `pre_auth_token` gating、risk-score deny | 禁動 runtime |
| Input | 既有 | 保留 body / email / password / Turnstile 流程 | 禁重構 |
| XSS | N/A | API route、不產 HTML | 無需處理 |
| Log / Audit | 既有 | 保留 `safeUserAudit` 全路徑 + `safeAlertAnomalies` | 禁動 runtime |
| Retry / 備援 | 否 | 不新增 | 非本 PR scope |
| 監控 | 既有 audit 旁證 | 保留既有 audit/log 路徑（ratchet 811→809 明列）| 不擴觀測功能 |
| anti-enumeration | 既有 | `fakeHashDelay` 時序 + 同訊息回應 | 禁動時序 |
| Token / Session | 既有 | session_id + JWT + tenant claims + refresh INSERT + `issued_aud` | 禁動 |
| Type boundary | ✅ 本刀核心 | `request: Request`；`env: Env`（function-declaration inline） | — |

### DB 鎖定

| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Schema | 不改 `users` / `local_accounts` / `refresh_tokens` / `login_attempts` / `ip_blacklist` |
| Atomic | 禁改 user+local_account JOIN 查詢、`login_attempts` INSERT/DELETE、refresh token INSERT 條件與順序、cross-user scan 偵測寫入 |

### 隔離區 / 鎖定區

- **隔離區**：`game/login.ts`、shared util（`functions/utils/{crypto,jwt,tenant-context,cors,turnstile,auth,cookies,user-audit,scopes,device-alerts,rate-limit,brute-force,risk-score,email}.ts`）、7 test 檔、`CLEANUP_PLAN.md`、baseline/ratchet override、`env.d.ts`、`tsconfig`/`eslint`/`vitest` 全部不得碰。
- **鎖定區**：所有 runtime（Turnstile fail-close / IP 黑名單 / rate-limit / 漸進 cooldown / `fakeHashDelay` / `verifyPassword` / banned 擋 token / risk-score deny·medium·email guard / `login_attempts` INSERT·DELETE / 2FA `pre_auth_token` / session_id·JWT·tenant claims / refresh token INSERT / `safeUserAudit`·`safeAlertAnomalies` / `isWebClient`·Set-Cookie·body refresh / response·error code）；return type / JSDoc / 註解 / 格式 / 安全功能（不新增）。

### 驗收標準（owner，faithful 收錄）

| 驗證 | 目標 | spike 實測 |
|---|---|---|
| `tsc -b tsconfig.solution.json --force` | login 2 個錯（2 TS7031）消失、無新增錯誤 | ✅ 2→0、ADDED=0 |
| ratchet | `811→809` | ✅ 809/80/254/334 |
| forced solution sort-diff | `REMOVED=2 / ADDED=0` | ✅ |
| cascade | 0 util / 0 test / 0 helper / 0 caller cascade | ✅ tests-leaf 0→0、solution ADDED=0 |
| byte-identical | runtime output identical | ✅ 9523B sha `9f8d81e1…` 兩端、`diff -q` IDENTICAL |
| tests | 跑既有 7 login integration；僅作 runtime 旁證 | ⬜ Code 階段 |
| gate | Dual Gate v3.1 全 4 道，不 lighter | ⬜ 進行中 |
