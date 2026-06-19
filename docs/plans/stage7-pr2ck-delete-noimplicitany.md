# Stage 7 reduce PR-2ck — `auth/delete.ts` noImplicitAny（單檔 destructive 帳號刪除 step-1，wrapper/worker 雙 function，type-only，安全鎖 L3）

**目標**：`functions/api/auth/delete.ts` 的 **3 個 noImplicitAny error（TS7006 ×1 ＋ TS7031 ×2）→ 0**，**純 type-only**（**兩個編輯點**＝`onRequestPost` wrapper 簽名 ＋ 內層 `handleDelete` worker destructure；TS erase 後 emit byte-identical）。

**Scope（owner C-1 鎖；單檔、destructive 單獨成棒、禁併他檔）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/delete.ts` | 3（L16 wrapper `ctx` TS7006 ×1 ＋ L31 worker destructure TS7031 ×2） | **2 個編輯點**（`onRequestPost(ctx)` 簽名 ＋ `handleDelete({request,env})` 簽名） |

> **主線定位（owner C-1）**：A 域 handler 層收尾。PR-2ch 清 A1 五檔 TOTP-caller handler（#104 `176bf542`）→ PR-2ci 清 `2fa/setup.ts`（#105 `9fcc095c`）→ PR-2cj 清 A2 `change-password.ts` + `identity/unbind.ts`（#106 `b5e76f69`）。本 PR = **A 域 `delete.ts`（step-1）**，owner 2026-06-19 裁 **單檔單獨成棒、full treatment**：`auth/delete.ts` 是**帳號刪除 Tier-0 destructive flow** 且為**本系列首個 wrapper/worker 雙 function handler**（修法形態 ≠ PR-2cj 的 single-destructure handler）→ 不併入、走完整 Dual Gate。**排除**：`delete/confirm.ts`（step-2，已 typed）、A3 餘檔（`forgot-password` / `email/*` / `local/{login,register}`）。

base main `b5e76f69`（接 PR-2cj #106；`git rev-parse HEAD` 實查 = `b5e76f698d5d17eb37be9a2d5ea0e62e0be91ef0`）。branch `stage7-pr2ck-delete-noimplicitany`（自 clean main 開、未 push）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、單檔）/ review care **L2/L3**（destructive 帳號刪除熱區）/ **安全鎖 L3**（step-up-gated + 密碼雙憑證 + email token + critical audit 的不可逆刪帳前置）。走**完整 Dual Gate v3.1 四道外部審查、destructive 熱區不用 lighter**。
- **self-review = multi-agent workflow（owner C-1 2026-06-19 明示）**：`delete.ts` 屬帳號刪除 Tier-0 destructive flow，且為首個 wrapper/worker handler 先例；**即使 scout / spike 乾淨亦不得降級單 agent**（[[feedback_self_review_form_not_downgradable_by_spike]]）。workflow rubric **收斂 scope / runtime·security / evidence 三維、不擴全域**（owner 鎖：不碰 deferred payments `delete.ts`、不碰 `CLEANUP_PLAN.md`）。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-19 裁示：scope = 單檔、self-review 形式 = multi-agent workflow、**OD-ctx = 候選 (a) `ctx: { request: Request; env: Env }`（鎖；禁 `EventContext` / 禁加 `@cloudflare/workers-types` / 禁新增 ambient）**、`delete/confirm.ts` + A3 + payments `delete.ts` + `CLEANUP_PLAN.md` + baseline 全隔離。
  - ✅ Claude scout（read-only）→ 逐檔 error set + caller cascade 靜態分析 + 測試覆蓋分層 + byte-identical 適用性，全對齊裁示（檔錯數 = 3 / 0 internal·external caller / 無 `.cf`）。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 `git checkout` revert clean、`git diff b5e76f69` 空）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ✅ `PLAN_SELF_REVIEW_CLEAN`（multi-agent workflow，3 agents 三維 rubric：scope / runtime·security / evidence — 見 §Gate 進程紀錄）
  - ✅ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（維度 B，0 blocker / 0 required / 2 NB；affirm wrapper/worker ctx convention 先例；binding locks L1-L10 見 §Gate 進程紀錄）
  - ✅ `CODEX_PLAN_APPROVED`（維度 C，0 blocker / 0 critical risk / 0 required）→ ✅ owner `CODING_ALLOWED`（2026-06-20）
  - ✅ `CODE_SELF_REVIEW_CLEAN`（multi-agent workflow，3 agents converged 三維：diff-fidelity / runtime·security / evidence；source `ed5a93af`）→ ⬜ `CODEX_CODE_APPROVED`（維度 C）
  - ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（維度 B）→ ⬜ `MERGE_ALLOWED`（merge-front 7 gates 全綠、待 owner 明示）→ ⬜ `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪回應外部 gate 的修正）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。

### Gate 進程紀錄（dated；faithful 收錄）

- 2026-06-19 owner C-1 裁示（pre-SPEC → SPEC）：self-review = multi-agent workflow（三維收斂、不擴全域）；OD-ctx = 候選 (a)（鎖、禁 EventContext / workers-types / ambient）；GO 進 Spec + plan（非 MERGE_ALLOWED、不得改 source、plan 須附 spike receipt）。
- 2026-06-19 Claude **scout（read-only @ `b5e76f69`）** → 逐檔 error set（恰 3：TS7006 `ctx` ×1 ＋ TS7031 `request`/`env` ×2）+ caller cascade（`handleDelete` intra-file only、`onRequestPost` Pages entry 0 TS importer）+ coverage 分層（step-1 `delete.ts` 無 direct/indirect test）+ byte-identical 適用性，全對齊 owner 裁示（檔錯數 = 3、cascade judged 0、無 `.cf`、wrapper/worker 結構符描述）→ 0 矛盾、不觸發 stop-rule。
- 2026-06-19 Claude **非 commit full-solution spike**（見 §Spike，working tree revert clean）→ 全 receipt 綠（ratchet 827→824、sort-diff REMOVED=3/ADDED=0、byte-identical 3721B sha `541e4cfb…`、tests-leaf 0→0）。
- 2026-06-20 **multi-agent workflow self-review（維度 A，3 agents converged 三維：scope / runtime·security / evidence；run `wf_c59cd05d-70d`）→ `PLAN_SELF_REVIEW_CLEAN`**：3 維 finder findings 全空（accepted 0 / suspicious_input 0），各 candidate 走 adversarial verifier（default-refuted）。主線**獨立讀 plan 對抗式裁決**（非採 raw 輸出）：scope（單檔 2 簽名、frozen diff +2/−2、排除區鎖）✓、runtime·security（Tier-0 紅線全鎖、type-only byte-identical、無 `.cf`、real hard-delete=step-2 `confirm.ts` 已載明）✓、evidence（ratchet/sort-diff/byte-identical/tests-leaf/cascade 數值與 spike 一致、無 PR-2cj stale 值洩漏〔`2151`/`2202`/`831`/`f40ce744`/`270403e2` 皆 0 hit〕、coverage 誠實〔step-1 無 direct test、byte-identical 唯一硬保證、不 overclaim〕、exact-error 三行正確）✓ → **一輪 0 新發現**。
- 2026-06-20 plan doc commit local（branch `stage7-pr2ck-delete-noimplicitany` @ `cb5ce96f`，**未 push**）→ 中文報告 6 欄 → owner 裁示直接送外部 Plan Gate（不先人工過目；ChatGPT 須收完整 plan doc 原文、非 packet 摘要）。
- 2026-06-20 **ChatGPT Architecture Gate（① 維度 B）：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（0 blocker / 0 required revision / 2 NB）— Scope（單檔 2 編輯點）/ OD-ctx（`ctx: { request: Request; env: Env }`、affirm wrapper/worker 先例、拒 `EventContext`/workers-types/ambient）/ Runtime（type-only byte-identical）/ Security（Tier-0 刪帳紅線全鎖）/ Evidence（ratchet·sort-diff·byte-identical·tests-leaf·cascade 一致）/ Coverage（step-1 無 direct test、不 overclaim）/ Isolation 全 ✅ Pass。
  - **NB-1**（文件可讀性，非阻擋）：chat UI 長行換行（如 diff 內 `env: Env` 被斷行）非真實內容；Code 階段以 repo committed plan doc 與實際 `git diff` 為準、不以聊天 UI 換行為準。
  - **NB-2**（Code 階段報告，非阻擋）：Code report 必同列 source diff 逐行 + byte-identical receipt，不以 ratchet `827→824` 單獨代表 runtime 不變（plan §驗證計劃「NB-2 雙證」已含此要求）。
  - **Binding locks L1-L10（ChatGPT Arch；為 owner L1-L10 + plan locks 之 restatement，無新增約束，Codex Plan 須保留）**：L1 僅動 `auth/delete.ts`；L2 僅兩簽名；L3 OD-ctx `ctx: { request: Request; env: Env }`；L4 禁 `EventContext`/`@cloudflare/workers-types`/ambient/helper；L5 byte-identical（runtime diff = fail）；L6 Tier-0 刪帳 runtime 全鎖；L7 coverage honesty（不宣稱 step-1 runtime coverage）；L8 Code 階段 evidence full replay、不沿用 spike；L9 isolation（`confirm`/A3/payments delete/tests/env/tsconfig/baseline/`CLEANUP_PLAN.md`）；L10 stop rule。
  - **可送 ② Codex Plan Gate；不得進 coding 除非 owner 明示 `CODING_ALLOWED`。**
- 2026-06-20 **Codex Plan Gate（② 維度 C）：`CODEX_PLAN_APPROVED`**（0 blocker / 0 critical risk / 0 required）— 機械核驗全通過：HEAD `b588b193` / base `b5e76f69`、base→HEAD 僅 plan doc、`functions/` diff = 0（source plan-only）、`b588b193` 僅 gate-log `+8/−2`、隔離快照重現 ratchet **827→824** / 86→85 / 248→249、sort-diff **REMOVED=3 / ADDED=0**、emit **3721B** sha `541e4cfb…9499` byte-identical、tests-leaf 0→0、status 僅 `?? CLEANUP_PLAN.md`、coverage 誠實（step-1 無 direct/indirect test）。State Consistency **PASS**（SQL / token / rollback / audit / 刪帳狀態流程鎖定且不在 proposed diff）；Queue / Payment（payments `delete.ts` 已隔離）/ Distributed State **N/A**；Observability **PASS**（既有 critical audit 不變、未虛稱 runtime coverage）；L1-L10 / OD-ctx / Tier-0 runtime / isolation / stop rule 完整保留。**Plan Gate（① ChatGPT Arch + ② Codex Plan）全通過 = plan 批准；仍非 coding 授權，待 owner 明示 `CODING_ALLOWED` 才進 Code 階段。**
- 2026-06-20 **owner `CODING_ALLOWED` ✅** → 進 Code 階段。
- 2026-06-20 **Code 階段（source commit `ed5a93af`）**：落地唯二 2 編輯點（`onRequestPost(ctx: { request: Request; env: Env })` ＋ `handleDelete({ request, env }: { request: Request; env: Env })`），`git diff b5e76f69..ed5a93af -- functions/` = `delete.ts` **+2/−2**、blobs `9e4102a4→5e697377`、`numstat 2 2`（無 CRLF whole-file churn）。**full replay gates 全綠（@ source、不沿用 spike）**：ratchet enforce〔`RATCHET_BASE_REF=b5e76f69`〕**OK**（current **824/249**、ceiling 1119/175 不變）· forced solution sort-diff **REMOVED=3 / ADDED=0**（base 827 vs HEAD 824；checkout dance 後 tree restored clean）· canonical byte-identical（`esbuild --loader=ts --format=esm`）兩端 **3721B** sha `541e4cfb…9499`、stderr 0、`diff -q` IDENTICAL · tests-leaf **0** · `git diff --check` clean · lint green · build:functions「Compiled Worker successfully」。**NB-2 雙證齊**（source diff 逐行 annotation + byte-identical receipt，不以 ratchet 數字單獨代表 runtime 不變）。
- 2026-06-20 **Code self-review = multi-agent workflow（維度 A，3 agents converged 三維：diff-fidelity / runtime·security / evidence；run `wf_fe5e2463-061`）→ `CODE_SELF_REVIEW_CLEAN`**：3 維 finder findings 全空（accepted 0 / suspicious_input 0），各 candidate 走 adversarial verifier（default-refuted）。主線**獨立讀真碼裁決**：diff-fidelity（`git diff b5e76f69 ed5a93af -- functions/` 恰 2 annotation、functions/ 僅 `delete.ts` 變更）✓、runtime·security（非簽名行 base↔head **逐行 IDENTICAL** + byte-identical emit sha 兩端一致 = runtime 不變硬證、Tier-0 紅線未動、無 `.cf`）✓、evidence（ratchet/sort-diff/byte-identical/tests-leaf 與 replay 一致、coverage honesty：grep `tests/` step-1 `auth/delete` import **0 命中**、不 overclaim）✓ → **一輪 0 新發現**。**待送 Code Gate（③ Codex Code → ④ ChatGPT Faithfulness）；不得 merge 除非 owner 明示 `MERGE_ALLOWED`。**
- （後續 dated 收錄：Codex Code / Faithfulness / merge-front gates）

## owner 鎖定表（L1-L10，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 僅 `functions/api/auth/delete.ts` 單檔 |
| L2 Edit Point | **兩個**：`onRequestPost(ctx)` 簽名 ＋ `handleDelete({request,env})` 簽名；其餘零改動 |
| L3 Type-only | emitted JS 必 byte-identical |
| L4 Exclusion | 不碰 `delete/confirm.ts`、A3 餘檔、payments `delete.ts`、tests、`env.d.ts`、tsconfig、baseline、`CLEANUP_PLAN.md` |
| L5 Security Hot Zone（destructive，最高敏感） | 不得改 step-up gate（`requireStepUp … 'delete_account'`）、密碼雙憑證（`verifyPassword`，擋 OAuth-only 刪帳）、IP 1h 限流、60s cooldown、`generateSecureToken`+`hashToken`、`INSERT email_verifications`(token_type='delete_account')、`sendDeleteConfirmationEmail`(RESEND_API_KEY)+失敗 rollback `DELETE`、catch audit `auth.delete.exception`(critical)、response body、常數 |
| L6 Env | 不改 `types/env.d.ts`、不新增 env key |
| L7 Tests | 不為過 PR 改 tests；只跑既有 tests |
| L8 Evidence | plan + code 階段都重跑 ratchet / sort-diff / byte-identical / tests-leaf |
| L9 Coverage | 逐 sub-path 下鑽；step-1 `delete.ts` 無 direct test → 僅宣稱 byte-identical，未覆蓋分支明載、不 overclaim |
| L10 Stop Rule | 任一 runtime diff / 相鄰 cleanup / 碰排除檔 / coverage overclaim → 退回 `PLAN_DRAFT` |

## ⚠ delete.ts 熱區敏感聲明（最高優先紀律，安全鎖 L3，destructive）

`auth/delete.ts` 為**帳號刪除 step-1**（高權限不可逆動作前置）。修法若非純型別、或牽動下列任一紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L5）：

| 區塊 | Tier-0 紅線（typing 全程不得牽動） |
|---|---|
| step-up gate | `requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'delete_account')` 一次性 step-up token（5min 短效、需 2FA 換）|
| 密碼雙憑證 | `verifyPassword(password, account.password_salt, account.password_hash)`（OAuth-only 無密碼帳號禁刪的閘門）|
| 限流 / 冷卻 | IP 1h 限流（`email_verifications` COUNT，`IP_HOURLY_LIMIT=5`）· 60s cooldown（`COOLDOWN_SECONDS=60`）|
| token 生成 | `generateSecureToken()` + `hashToken()`（DB 存 SHA-256 hash、`TOKEN_TTL_MINUTES=15`）|
| DB 寫入 | `INSERT INTO email_verifications (… token_type='delete_account' …)` · email 失敗 rollback `DELETE FROM email_verifications WHERE token_hash = ?` |
| 外送 | `sendDeleteConfirmationEmail(env.RESEND_API_KEY, userRow.email, token, env)` |
| audit | catch 內 `safeUserAudit(ctx.env, { event_type:'auth.delete.exception', severity:'critical', … })` |
| 回應 | response body（成功訊息 / 各 error code）|

註：真正 hard-delete 在 step-2 `delete/confirm.ts`（**不在本檔、不在 scope**）。本刀只在 2 個 function 簽名加型別標註，TS erase 後 runtime byte-identical（SQL / 常數 / audit event·level / 字串 / 註解不變）。

### Coding 階段硬性邊界

- **允許**：`onRequestPost(ctx)` 加 `ctx: { request: Request; env: Env }`；`handleDelete({ request, env })` 加 `: { request: Request; env: Env }`。
- **禁止**：改任何 SQL / `requireStepUp`·`verifyPassword` gate / token 生成·hash / `INSERT`·`DELETE` / `sendDeleteConfirmationEmail` / 限流·cooldown 邏輯與常數 / audit event·level·payload / response body / caller / tests / `tsconfig`·`eslint`·`vitest` / `env.d.ts` / 加 return type / 清·改 JSDoc·註解 / 新增 any·suppression·global·import·package / 用 `EventContext` / 加 `@cloudflare/workers-types` / **碰 `delete/confirm.ts` 或 payments `delete.ts`** / 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `b5e76f69`）

### exact errors（forced `tsc -b tsconfig.solution.json --force`，solution total 827）

```
functions/api/auth/delete.ts(16,37): error TS7006: Parameter 'ctx' implicitly has an 'any' type.
functions/api/auth/delete.ts(31,31): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/delete.ts(31,40): error TS7031: Binding element 'env' implicitly has an 'any' type.
```

恰 **3 個**：`onRequestPost` wrapper 的 `ctx`（**TS7006 ×1** @ L16）＋ `handleDelete` worker destructure 的 `request`/`env`（**TS7031 ×2** @ L31）。catch clause `catch (e)`（L19）**不被 noImplicitAny 旗標**（預期不算入 3 錯，實測確認）。檔內無其他 TS7006/其他碼。baseline file `types/typecheck-baseline.json:50` 同記 `delete.ts: 3`。

> ⚠ 釐清：另有 `functions/api/admin/payments/intents/[id]/delete.ts`（5×TS7031）**為不同檔**、屬 deferred payments 熱區、**不在 scope**（grep `delete.ts` 同尾才帶出）。

### 依賴邊界（caller cascade）

`delete.ts` 是 Pages file-routing entry，cascade 面：

| 面 | 判定 | 證據 |
|---|---|---|
| `onRequestPost` 外部 TS caller | **0** | 全 repo grep `from '…auth/delete'`（step-1 module import）**0 命中**；`src/js/dashboard.ts:1562` / `public/js` 命中皆為 runtime `apiFetch('/api/auth/delete')` 字串呼叫，非型別 import |
| `handleDelete` caller | **intra-file only** | grep `handleDelete` 僅 `delete.ts`（L18 呼叫、L31 定義）；OD-ctx (a) 使 `handleDelete(ctx)` exact-match assignable → 0 cascade |
| intra-file env / request 存取 | 全相容 | `ctx.env`(L22) / `env.chiyigo_db`(L46) / `env.RESEND_API_KEY`(L112) 皆在 `Env`（`types/env.d.ts:21`，ambient）；`request.json()`(L39) + `request.headers.get('CF-Connecting-IP')`(L47)、**無 `.cf`** → plain `Request` |
| tests-leaf | **0 接觸** | 無 test import step-1 `delete.ts`（見 §測試影響面）|

**最強佐證（precedent）**：`change-password.ts`（PR-2cj，現 0-error）逐行同構——`onRequestPost({request,env}:{request:Request;env:Env})` → `requireStepUp(request,env,…)` → `let body; body=await request.json()` → `const {…}=body??{}` → `Number(user.sub)` → `env.chiyigo_db`，全 clean。故 delete.ts worker 同款構造（`request.json()`→`body??{}`→destructure、`requireStepUp(request,env,…)`）在 `request:Request`/`env:Env` 下 **0-cascade 已被 precedent 證偽**；spike（下）機械復現。

### 型別選型（owner Convention A；OD-ctx owner-locked (a)）

允許落地的唯一 source diff（兩處編輯點）：

```ts
export async function onRequestPost(ctx: { request: Request; env: Env }) {   // L16 wrapper
async function handleDelete({ request, env }: { request: Request; env: Env }) {   // L31 worker
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| worker `{ request, env }` | **`{ request: Request; env: Env }`（Convention A）** | 沿 PR-2ch/2ci/2cj 三處先例（setup.ts L37 / change-password.ts L40 / unbind.ts L18 逐字相同）；`requireStepUp(…, env: Env)` 即收 full `Env` ＝最強零-cascade 佐證；handler 用 full `Env`（[[feedback_util_env_param_pick_not_full_env]] 區分 util 用 `Pick`）|
| worker `request` | **`Request`（plain）** | 僅 `request.json()` + `request.headers.get('CF-Connecting-IP')` + 流入 `requireStepUp`（收 `Request`）；**無 `.cf`** → 非 `CfRequest` |
| **OD-ctx：wrapper `ctx`** | **候選 (a) `ctx: { request: Request; env: Env }`（owner 鎖）** | 與 worker destructure 型別**完全相同** → `handleDelete(ctx)` exact-match 0 cascade；catch `ctx.env`/`ctx.request` 皆在型內；**免 import、免新增套件**、與 Convention A inline 風格一致 |
| return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 lock：本刀只處理 noImplicitAny 3 錯 |

**OD-ctx Open Decision（owner 已裁 (a)）**：本刀為**遷移首個 wrapper/worker handler、設 ctx convention 先例**。owner C-1 已鎖候選 (a)，**明確否決**候選 (b) `EventContext<Env,…>`（`@cloudflare/workers-types` 未安裝 → `EventContext` 不可得、需新增 ambient/import，違 L6；[[feedback_d1database_resolves_any_no_workers_types]]）。送 ChatGPT Architecture Gate **affirm 此 wrapper/worker ctx 先例**（非重開選型）。

## Spike 實證（full-solution，本地未 commit，2026-06-19，已 revert clean）

**程序**：量 base（clean main `b5e76f69`：solution 827 / tests-leaf 0）→ 套 2 編輯點（Edit）→ forced `tsc -b tsconfig.solution.json --force`（含 functions / tests / scripts / browser-typecheck 全 leaf，sorted error set diff）→ canonical byte-identical（esbuild stdin）→ forced `tsc -b tsconfig.tests.json --force`（tests-leaf）→ canonical `--report` → frozen diff + `git diff --check` + `numstat` → `git checkout --` revert → 驗 clean（`git diff b5e76f69` 空）。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| delete.ts errors 3 → 0 | ✅ sort-diff REMOVED = 恰 3 行（`(16,37)` TS7006 ＋ `(31,31)`/`(31,40)` TS7031）；patched delete.ts 0 殘留 |
| solution errorCount 827 → 824（恰 −3） | ✅ forced tsc solution **824**；sort-diff ADDED = **空** |
| zero cascade（functions + tests + scripts + browser，全 solution） | ✅ solution sort-diff **REMOVED=3 / ADDED=0**；另 `tsc -b tsconfig.tests.json --force` **base 0 → patched 0**（delete.ts 不在 tests-leaf graph，0 接觸驗證）|
| canonical `--report`（patched） | ✅ errorCount **824** / errorFiles **85** / cleanFiles **249** / sourceFilesTotal 334 |
| **single-file emitted-JS byte-identical**（TS erase runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`**，[[feedback_byte_identical_emit_verification]]） | ✅ esbuild **stdin** type-strip base(`b5e76f69`) vs patched **IDENTICAL**、皆 **3721B**、esbuild stderr 空：<br>sha256 兩端 `541e4cfb96534c9ad75b5047b61c513b4946ba2d54265be4fcbb11b1f99a9499` |
| `git diff --check`（source） | ✅ exit 0（無 trailing whitespace / lone space）|
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、`git diff b5e76f69 -- delete.ts` **空**、`numstat` spike 期 `2 2`（無 CRLF whole-file churn）|

**byte-identical 適用性**：delete.ts 6 imports（crypto / auth / scopes / email / user-audit / audit-aggregate-debug）→ esbuild stdin transform **適用**（單檔 transform、import 行原樣保留；非完整 bundle，但 type-only annotation PR 這正是對的證明面）。

### frozen diff（git-format，spike 實取，`git diff --check` clean）

> ⚠ 嵌入版本依 [[feedback_plan_frozen_diff_git_diff_check]] 將空白 context 行清為**真空行**（git unified diff 原輸出 lone leading space），以過 doc 自身的 `git diff --check`；逐行語意與 spike `git diff` 一致（blob hash 為 spike 實取、code 階段重生）。

```diff
diff --git a/functions/api/auth/delete.ts b/functions/api/auth/delete.ts
index 9e4102a4..5e697377 100644
--- a/functions/api/auth/delete.ts
+++ b/functions/api/auth/delete.ts
@@ -13,7 +13,7 @@ const COOLDOWN_SECONDS  = 60
 const TOKEN_TTL_MINUTES = 15
 const IP_HOURLY_LIMIT   = 5

-export async function onRequestPost(ctx) {
+export async function onRequestPost(ctx: { request: Request; env: Env }) {
   try {
     return await handleDelete(ctx)
   } catch (e) {
@@ -28,7 +28,7 @@ export async function onRequestPost(ctx) {
   }
 }

-async function handleDelete({ request, env }) {
+async function handleDelete({ request, env }: { request: Request; env: Env }) {
   // P1-3：刪帳號是高權限毀滅性動作，要求 step-up token（5min 短效，需通過 2FA 換來）
   // + 額外驗一次密碼作雙重憑證（step-up 雖已驗 TOTP，密碼是 OAuth-only 帳號禁止刪的閘門）
   const { user, error } = await requireStepUp(request, env, SCOPES.ELEVATED_ACCOUNT, 'delete_account')
```

`git diff --stat`：1 file changed, 2 insertions(+), 2 deletions(-)；`git diff --numstat`：`2  2`（無 whole-file CRLF churn）。

## 預期 ratchet

- clean main `b5e76f69` `--report`：errorCount **827** / errorFiles **86** / cleanFiles **248** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **827 → 824**（−3）、errorFiles **86 → 85**、cleanFiles **248 → 249**（spike 實測值、非預測；delete.ts 全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 2 個 function 簽名型別標註，TS erase 後 runtime byte-identical（§Spike sha `541e4cfb…` 兩端一致實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 827、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。

## 測試影響面（覆蓋誠實，L9 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf base 0 → patched 0 實證；delete.ts step-1 不在 tests-leaf 編譯圖內）。
- **覆蓋分層（誠實，逐 sub-path 下鑽）**：

| 檔 | direct test | indirect | 真打路徑 | 硬保證 |
|---|---|---|---|---|
| `auth/delete.ts`（step-1） | ❌ **無** | ❌ **無** | — | **byte-identical 為唯一硬保證** |

- **下鑽證據（不 overclaim）**：
  - `from '…auth/delete'`（step-1 module import）全 repo **0 命中** → 無任何 test direct import step-1 handler。
  - `tests/` 內 `api/auth/delete`（排除 `/confirm`）**0 命中**。
  - 兩支「delete」測試標的皆非本檔：`tests/integration/account-delete-emission.test.ts` import `auth/delete/**confirm**`（**step-2** hard-delete，非本檔）；`tests/integration/admin-audit-delete.test.ts` import `admin/audit/[id]`（admin 稽核 log 刪除，與帳號刪除無關）。
  - **未覆蓋分支明載**：step-1 `delete.ts` 全部 runtime 分支（step-up reject / 密碼 reject / IP 限流 / cooldown / email 失敗 rollback / 成功）**皆無 direct test 斷言**；本 PR type-only 不改 tests（A7/L7），這些分支的不變保護 = byte-identical emit（sha 兩端一致）。
- 與 PR-2ci `setup` / PR-2cj `unbind`（皆無 direct test）同策略：缺 coverage 的 handler **僅以 byte-identical 為硬保證、不宣稱 runtime coverage**。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`。**PowerShell 用 `$env:RATCHET_BASE_REF='b5e76f69'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='b5e76f69'; npm run typecheck:ratchet` green（827→824 / 86→85 / 248→249）。
- filtered forced tsc：delete.ts 0 殘留 + solution sort-diff **REMOVED=3 / ADDED=0**（含 functions intra-file `handleDelete(ctx)` + tests/scripts/browser leaf）+ `tsc -b tsconfig.tests.json --force` exit 0（base 0 → patched 0）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**（經 Bash tool / Git Bash 執行；PowerShell 5.1 不支援 `<` stdin redirection；唯獨 ratchet 段用 PowerShell `$env:` 見上注）：

```bash
git show b5e76f69:functions/api/auth/delete.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/del-base.js 2>/tmp/del-base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/delete.ts > /tmp/del-head.js 2>/tmp/del-head.err
wc -c /tmp/del-base.js /tmp/del-head.js        # 期望 3721 兩端
sha256sum /tmp/del-base.js /tmp/del-head.js     # 期望 541e4cfb… 兩端
cat /tmp/del-base.err /tmp/del-head.err          # 期望空（stderr 0 bytes）
diff -q /tmp/del-base.js /tmp/del-head.js         # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< <file>` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show b5e76f69:` 讀未改 base。spike 本地實證：兩端 **3721B / `541e4cfb…`**、stderr 0、`diff -q` IDENTICAL。
- **NB-2 雙證**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 2 處 annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。
- `npm run lint` green（全量）、`npm run build:functions` green。
- targeted int：**無 step-1 `delete.ts` direct test**（0 coverage）→ 不跑 targeted；跑全量 `test:int` 確認無跨檔破壞（**不宣稱涵蓋 delete.ts**）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §frozen diff **逐行一致**（人審 `git diff --stat` 僅 1 檔 +2/−2、`git diff` 2 處皆 function 簽名 annotation）；超出 = scope creep = Gate fail。

## Merge SOP（process lock，順序不得寫反；[[feedback_pre_merge_gate_checklist_match_ci]]）

① faithfulness ✅ → ② **先**跑齊 merge 前 local gates 全綠（`lint`·`typecheck:ratchet`〔Git Bash `RATCHET_BASE_REF=b5e76f69`〕·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit --omit=dev --audit-level=high`）→ ③ 全綠後 owner 明示 `MERGE_ALLOWED` → ④ push branch + 開 PR + `gh pr merge --squash --delete-branch`（禁直推 main）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 memory receipt（SHIPPED 才寫：topic PR-2ck 段 + MEMORY.md index 數字 827→824）。

## Diff hygiene

- 不碰 `CLEANUP_PLAN.md`（untracked、Stage 7 完工才清）；**不碰 `delete/confirm.ts`、payments `delete.ts`、A3 餘檔**；baseline 不 `--update`；挑檔 add（1 source + 本 plan doc）禁 `git add .`/`-A`；feature branch `stage7-pr2ck-delete-noimplicitany` 禁直推 main；平行 session 唯讀優先、動 git 前先 `git status`。
- **CRLF**：spike 實證 `git diff --numstat` = `2  2`（`.gitattributes` `* text=auto eol=lf` 已根治，[[feedback_windows_build_crlf_churn]]、無 whole-file churn）；code 階段 commit 前再驗 `numstat` `2 2`。

---

## 附：owner C-1 鎖定表（faithful 收錄）

### 風險表

| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| 帳號刪除流程 type-only 改動誤動 runtime | 高 | step-up / 密碼雙憑證 / token / email rollback / audit 任一漂移破壞不可逆刪帳前置安全邊界 | 僅改 2 個 function 簽名 annotation；spike 已證 solution+tests leaf 0 cascade + byte-identical sha 兩端一致 |
| 首個 wrapper/worker handler 先例 | 中高 | 先例錯誤污染後續 handler 遷移 | OD-ctx 鎖 (a) `{ request: Request; env: Env }`；送 ChatGPT Arch affirm 先例 |
| 無 direct test coverage | 中 | runtime regression 不易由測試捕捉 | byte-identical（非空、IDENTICAL、sha 兩端一致）為唯一硬保證；coverage 不 overclaim |
| grep 命中 payments `delete.ts` | 中 | scope creep 到 deferred 熱區 | L4/L10 鎖死單檔 `functions/api/auth/delete.ts` |
| `CLEANUP_PLAN.md` untracked | 低 | 誤 add 汙染 scope | 禁 `git add -A`、挑檔 add |
| baseline/ratchet 誤更新 | 高 | 掩蓋真實 Stage 7 進度 | reduce 不 `--update` |

### 防禦表

| 機制 | 處理 | 實作 / 未處理因 |
|---|---|---|
| 權限 / step-up | 是 | `requireStepUp(…, 'delete_account')` 簽名吻合、呼叫順序不動 |
| Input | 是 | 禁改 `request.json()` body parse / `verifyPassword` 密碼雙憑證 |
| RateLimit | 是 | IP 1h 限流 + 60s cooldown 常數與邏輯不動 |
| XSS | N/A | Functions API type-only、無前端輸出面 |
| Log/Audit | 是 | 禁改 `auth.delete.exception`(critical) event 名稱 / level / payload |
| Retry/備援/rollback | 是 | email send 失敗後 `DELETE` rollback 不動；無新增外部 retry |
| 監控 | 是 | ratchet 827→824 明列；coverage 不 overclaim |

### DB 鎖定

| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Schema | 不改 `email_verifications` / `local_accounts` / `users` |
| Atomic | 禁改 `INSERT email_verifications`(token_type='delete_account') 與 email 失敗 rollback `DELETE` 條件與順序 |

### 隔離區 / 鎖定區

- **隔離區**：`delete/confirm.ts`（step-2）、A3 餘檔（`forgot-password` / `email/*` / `local/{login,register}`）、`functions/api/admin/payments/intents/[id]/delete.ts`、`CLEANUP_PLAN.md`、baseline/ratchet override **全部不得碰**。
- **鎖定區**：所有 runtime（step-up gate / 密碼雙憑證 / token 生成·hash / `INSERT`·`DELETE` / email 外送 / 限流·cooldown 常數 / audit event·level / response body）；return type / JSDoc / 註解 / 格式。
