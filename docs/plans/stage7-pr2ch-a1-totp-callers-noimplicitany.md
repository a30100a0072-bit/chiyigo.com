# Stage 7 reduce PR-2ch — A1 五檔 TOTP-caller handler noImplicitAny（純 type-only，安全鎖 L3）

**目標**：5 個 auth / 2FA / elevation handler 的 **10 個 noImplicitAny error → 0**，**純 type-only**（每檔 1 個編輯點＝`onRequestPost` 簽名 destructure 型別標註）。

**Scope（owner C-1 鎖；5 檔一包，禁併入他檔）**：

| 檔 | 現狀 err | edit point |
|---|---|---|
| `functions/api/auth/2fa/disable.ts` | 2（L19 handler） | `onRequestPost` 簽名 |
| `functions/api/auth/2fa/activate.ts` | 2（L34 handler） | `onRequestPost` 簽名 |
| `functions/api/auth/2fa/backup-codes/regenerate.ts` | 2（L14 handler） | `onRequestPost` 簽名 |
| `functions/api/auth/step-up.ts` | 2（L59 handler） | `onRequestPost` 簽名 |
| `functions/api/auth/local/reset-password.ts` | 2（L26 handler） | `onRequestPost` 簽名 |
| **合計** | **10（全 TS7031）** | **5 個編輯點** |

> **主線定位（owner C-1）**：domain-batched cadence。mechanical-misc 域已清空（metrics #98 → ai/assist #99 → brute-force #101 → turnstile #102 → totp #103 `5b4ae52b`）。PR-2cg 折回 2FA/elevation/account 域、單檔 type 了 `utils/totp.ts`（TOTP replay util）。**PR-2ch = 該 util 在 PR-2cg cascade 表中「5 個傳 `any` 的 untyped caller」的自然依賴續作**——把這 5 個 handler 自身 typed。owner C-1 裁示 **A1 五檔一包**（同構、語意內聚於 TOTP second-factor caller 面），**`2fa/setup.ts` 不併入**（屬 A2、產 secret 非 TOTP-verify caller，避 scope 漂移）。

base main `5b4ae52b`（接 PR-2cg totp #103；`git rev-parse HEAD` 實查）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- **級別**：impl **L1**（純 mechanical type-only、5 檔同構）/ review care **L2**（首個多檔熱區批次）/ **安全鎖 L3**（觸 2FA / elevation / step-up / password-reset 驗證路徑，Tier-0 鄰接）。走**完整 Dual Gate v3.1 四道外部審查、不 lighter**。
- **gate 狀態（前瞻 checklist；外部 gate 尚未送、不得自我宣告通過）**：
  - ✅ `SPEC_APPROVED` — owner C-1 2026-06-18 裁示 scope = A1 五檔一包、typing convention 鎖定（見下 §型別選型）、`2fa/setup.ts` + A2/A3 + CLEANUP_PLAN.md + baseline 全隔離。
  - ✅ Claude scout（read-only）→ 全 A 域逐檔 error set + caller cascade 靜態分析 + 測試覆蓋分層 + byte-identical 適用性。
  - ✅ **非 commit full-solution spike 實證**（見 §Spike，working tree 已 revert clean）。
  - ✅ `PLAN_DRAFT` — 本 doc。
  - ⬜ `PLAN_SELF_REVIEW_CLEAN` — **self-review 形式待 owner 裁**（v3.1：review care L2 → 預設 multi-agent workflow；但 5 檔機械同構 + spike 已數學證 0 cascade + byte-identical，owner 可裁單 agent 對抗式即足）。
  - ⬜ `CHATGPT_ARCH_APPROVED`（維度 B）
  - ⬜ `CODEX_PLAN_APPROVED`（維度 C）→ `CODING_ALLOWED`
  - ⬜ `CODE_SELF_REVIEW_CLEAN` → `CODEX_CODE_APPROVED`（維度 C）
  - ⬜ `CHATGPT_CODE_FAITHFULNESS_APPROVED`（維度 B，v3.1 任何級別全走）→ `MERGE_ALLOWED` → `MERGED_MAIN`
- **通則**：任何更改（首次 plan / code ＋ 每輪回應外部 gate 的修正）先對抗式 self-review 至「一輪 0 新發現」才 commit → 中文報告 6 欄 → 送外部。

## ⚠ 2FA / elevation / password-reset 熱區敏感聲明（最高優先紀律，安全鎖 L3）

5 檔皆為高權限 auth handler，**Tier-0 鄰接**。修法若非純型別、或會牽動下列任一逐檔紅線 → **立刻停手回 `PLAN_DRAFT`，不硬寫**：

| 檔 | Tier-0 紅線（typing 全程不得牽動） |
|---|---|
| `step-up.ts`（最敏感，elevation token 簽發） | `KNOWN_ELEVATED_SCOPES.has(scope)` 白名單 gate · rate-limit `step_up` 300s/5（P1-6 決策）· SQL `users LEFT JOIN local_accounts … WHERE deleted_at IS NULL` · `status==='banned'` / `totp_enabled` gate · `verifyTotpReplaySafe(env,{userId,secret,code})` · backup `/^[0-9a-f]{20}$/` + 原子核銷 `UPDATE … WHERE id=? AND used_at IS NULL` `consumed.meta?.changes>0` · `amr=['pwd','totp']` / `acr='urn:chiyigo:loa:2'` · `signJwt(claims,'5m',env,{audience})` / `STEP_UP_TTL_SECONDS=300` · `claims`(sub/role/status/`ver:token_version??0`/scope/for_action) · `resolveAud(aud)` · audit `auth.step_up.{rate_limited,fail,success}` |
| `local/reset-password.ts`（unauth，reset-token 驅動） | `validatePassword` 密碼政策 · `hashToken` + token SELECT(`token_type='reset_password'`/`used_at IS NULL`/`expires_at>now`) · **雙路徑 race 設計 P2-2**（TOTP=先驗後 atomic 消耗；backup=先 atomic 鎖 token 後驗）· rate-limit `reset_2fa` 300s/5（SEC-RESET-2FA-BF）· `/^\d{6}$/` + `/^[0-9a-f]{20}$/i` · `verifyTotpReplaySafe` · 原子核銷 `UPDATE email_verifications … RETURNING user_id` · `INSERT … ON CONFLICT DO UPDATE`(密碼) · `DELETE refresh_tokens` + `bumpTokenVersion` · audit `account.password.reset.{totp_rate_limited,backup_code_fail,totp_fail}` + `account.password.change` |
| `2fa/disable.ts` | rate-limit `2fa_disable` 60s/5 · `verifyTotpReplaySafe`(`r.reason` bad_format/replay) · `verifyBackupCode` 常時比較 loop · `db.batch`(UPDATE totp_enabled=0/totp_secret=NULL + DELETE backup_codes) · `bumpTokenVersion` 強制下線 · audit `mfa.totp.disable.fail`(warn)/`mfa.totp.disable`(**critical**) |
| `2fa/activate.ts` | **anti-takeover：先驗 current_password（403 非 401，2026-05-08 fix）** `verifyPassword` · `/^\d{6}$/` + `verifyTotpReplaySafe` · rate-limit `2fa_activate` 60s/5 · `generateBackupCodes`(明文僅回一次) · `db.batch`(totp_enabled=1 + DELETE + INSERT 10) · audit `mfa.totp.activate.fail`/`mfa.totp.activate` |
| `2fa/backup-codes/regenerate.ts` | rate-limit `2fa_regen` 60s/5 · `verifyTotpReplaySafe` + backup verify loop(matchId 原子核銷 `used_at`) · `db.batch`(DELETE + INSERT 10) · audit `mfa.backup_code.regenerate` |

註：TOTP 驗證/replay 語意本體在 `utils/totp.ts`（PR-2cg 已 typed）、token 比較在 otpauth dependency 內部，**本 PR 皆不觸碰**；本刀只在 5 個 handler 簽名加 destructure 型別標註。TS erase 後 runtime 必 byte-identical。

### Coding 階段硬性邊界

- **允許**：每檔 `onRequestPost` 單一簽名的 destructure pattern 型別標註（`{ request, env }: { request: Request; env: Env }`）。
- **禁止**：改任何 SQL / regex / rate-limit 常數·kind / token scope·TTL·claims / audit event·level / atomic consume 順序 / `db.batch` 內容 / caller / tests / tsconfig·eslint·vitest / 加 return type / 清·改 JSDoc / 新增 any·suppression·global·import·package / 任何「順手修正」或格式整理。

## Scout（對抗式驗證，命令真輸出 @ `5b4ae52b`）

### exact errors（forced `tsc -b tsconfig.functions.json --force`，functions total 843）
```
functions/api/auth/2fa/disable.ts(19,39) TS7031 Binding element 'request'
functions/api/auth/2fa/disable.ts(19,48) TS7031 Binding element 'env'
functions/api/auth/2fa/activate.ts(34,39) TS7031 Binding element 'request'
functions/api/auth/2fa/activate.ts(34,48) TS7031 Binding element 'env'
functions/api/auth/2fa/backup-codes/regenerate.ts(14,39) TS7031 Binding element 'request'
functions/api/auth/2fa/backup-codes/regenerate.ts(14,48) TS7031 Binding element 'env'
functions/api/auth/step-up.ts(59,39) TS7031 Binding element 'request'
functions/api/auth/step-up.ts(59,48) TS7031 Binding element 'env'
functions/api/auth/local/reset-password.ts(26,39) TS7031 Binding element 'request'
functions/api/auth/local/reset-password.ts(26,48) TS7031 Binding element 'env'
```
恰 **10 個、100% TS7031**（`request`+`env` binding element ×5 檔）。**每檔僅 handler destructure 報錯、檔內 helper/callback 全 0 error**（`.map(h=>…)` 操作 typed crypto 回傳；`for…of codes.results` 操作 D1 `any`；故無額外 TS7006）。baseline file `types/typecheck-baseline.json` 同記各檔 2。

### 依賴邊界（caller cascade — handler 是 entry point，與 util 不同）

handler 非被其他 functions-leaf TS code 呼叫 → cascade 只可能來自：(a) **functions leaf intra-file**（typed request/env 流入檔內 typed util）；(b) **tests leaf**（test 直接 import handler 並調用）。

**(a) functions-leaf intra-file**：5 檔直接 env 存取**只有 `env.chiyigo_db`**（D1Database 本 repo 解為 `any`，[[feedback_d1database_resolves_any_no_workers_types]]）→ 無 TS2339。env/request 流入的 util 簽名全相容：

| util（被 A1 呼叫） | 簽名 | 傳 `Env`/`Request` 後 |
|---|---|---|
| `requireAuth(request, env)` | `(request: Request, env: Env, …)` | **完全吻合**（disable/activate/regenerate/step-up）→ 0 cascade，最強佐證 |
| `verifyTotpReplaySafe(env,…)` | `(env: Pick<Env,'chiyigo_db'>,…)` | Env→Pick assignable（PR-2cg typed） |
| `signJwt(…,env,…)` | `(…, env: JwtSignEnv, …)` | Env→JwtSignEnv（full→subset）assignable（step-up） |
| `safeUserAudit(env, entry)` / `bumpTokenVersion(db,…)` | 自身仍 untyped（`any`） | `any` 吸收 typed 值 → 0 cascade |
| `checkRateLimit`/`recordRateLimit`/`clearRateLimit(db,…)` | `(db: Env['chiyigo_db'],…)`（PR-2z typed） | D1(`any`)→`Env['chiyigo_db']` assignable |

**owner 提醒的 TS7011（`()=>null` callback）→ A1 不命中**：5 檔無 null-returning arrow callback（callback 皆 `.map(h=>db.prepare(...))` / `for…of`）。

**(b) tests-leaf（呼叫 pattern 不一致，是唯一需特別驗的面）**：

| 檔 | test 調用 pattern | tests-leaf cascade |
|---|---|---|
| `reset-password.ts` | `callFunction(resetPost, …)`（`callFunction(handler,…)` 的 `handler` 在 tests-leaf `noImplicitAny:false` 下為隱式 `any`）→ any-call | **0**（型別關係被 helper 抹除） |
| `2fa/disable.ts` · `activate.ts` · `regenerate.ts` | **無任何 test import** | **0**（零接觸） |
| `step-up.ts` | **direct-literal**：`stepUpHandler({ request, env })`（step-up.test.ts:47,56 + change-password.test.ts:37）→ literal 受 excess-property/型別相容檢查 | **須 spike 證**；實讀三處 literal 皆**剛好 `{request, env}` 兩屬性、無 excess**，`request`=`new Request(...)`、`env`=cloudflare:test `ProvidedEnv`（env.d.ts 橋接 Env）→ **預期 0**（spike 已證，見下） |

### 型別選型（owner C-1 OD rulings；全 5 檔同一 Convention A）

允許落地的唯一 source diff（每檔一處，5 檔逐字相同型態）：
```ts
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
```

| OD | 裁示 | 理由 |
|---|---|---|
| OD-1 scope | **A1 五檔一包；不併 `2fa/setup.ts`** | 5 檔同構（純 destructure、各 2×TS7031）、語意內聚於 TOTP second-factor caller；setup.ts 屬 A2、產 secret 非 verify-caller |
| OD-2 `env` | **`Env`（full，非 `Pick`）** | handler 既有先例（2fa/verify PR-2u）；`requireAuth(…, env: Env)` 即收 full Env；env 整包傳 requireAuth/signJwt/safeUserAudit。**與 util 檔（totp/turnstile/cors 用 `Pick`）刻意分流**——util 最小權限，handler 用 full Env |
| OD-3 `request` | **`Request`（非 `CfRequest`）** | 5 檔只用 `.json()` / `.headers.get('CF-Connecting-IP')`，無 `.cf`；`requireAuth(request: Request,…)` 即收 Request |
| OD-4 return type / JSDoc / 格式 | **不加 / 不清 / 不整理** | 沿 PR-2cf/2cg 鎖：本刀只處理 TS7031，不做格式與文件整理 |
| OD-5 編輯點 | **每檔恰 1 處**（`onRequestPost` 簽名）；其餘零改動 | 各檔僅 1 個 handler、2 個 destructure 錯集中該行 |

**考慮過、否決**：`env: Pick<Env,'chiyigo_db'>`（handler 整包傳 env 給多 util、且 requireAuth 收 full Env、用 Pick 反不一致）；`request: CfRequest`（無 `.cf` 存取、且 requireAuth 收 Request、CfRequest 過窄會與 `new Request()` test literal TS2345）；加 `Promise<Response>` return 標註（無 error 驅動、非最小 diff、OD-4 鎖）。

## Spike 實證（full-solution，本地未 commit，2026-06-18，已 revert clean）

**程序**：量 base tests-leaf（0）→ 套 5 編輯點 → 清 `.tscache` → forced `tsc -b tsconfig.functions.json`（sort-diff）→ forced `tsc -b tsconfig.tests.json` → canonical `--report` → byte-identical（esbuild stdin ×5）→ `git checkout --` revert → 驗 clean。

**單輪達標**（scout 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| 5 檔 errors 10 → 0 | ✅ forced tsc filter 5 檔 0 殘留 |
| functions total errorCount 843 → 833（恰 −10） | ✅ forced tsc 833；**sort-diff REMOVED = 恰那 10 行 TS7031、ADDED = 空** |
| zero cascade（functions + tests leaf） | ✅ functions sort-diff added=0；tests leaf `--force` **base 0 → after 0**（含 step-up direct-literal ctx call，最大 caveat 已解除） |
| canonical `--report` | ✅ errorCount **833** / errorFiles **89**（94−5）/ cleanFiles **245**（240+5）/ sourceFilesTotal 334 |
| **bundle byte-identical**（TS erase 後 runtime 不變硬保證） | ✅ esbuild **stdin** type-strip base(`5b4ae52b`) vs HEAD 逐檔 IDENTICAL、皆非空、esbuild stderr 空（避 `--loader` file-entry 空輸出陷阱 [[feedback_byte_identical_emit_verification]]）：<br>`disable.ts` 3529B sha `abb3b354…`／`activate.ts` 3801B sha `163c4425…`／`regenerate.ts` 3308B sha `b422306b…`／`step-up.ts` 5114B sha `bf727d0f…`／`reset-password.ts` 5789B sha `98e1d29a…` |
| working tree revert clean | ✅ `git checkout --` 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、HEAD `5b4ae52b` |

**byte-identical 適用性說明**：5 檔皆有 import（disable/activate/regenerate 各 5、step-up 8、reset-password 6）→ esbuild stdin transform **適用**（單檔 transform 證明、import 行原樣保留；非完整 bundle，但 type-only annotation PR 這正是對的證明面）。

## 預期 ratchet

- clean main `5b4ae52b` `--report`：errorCount **843** / errorFiles **94** / cleanFiles **240** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **843 → 833**（−10）、errorFiles **94 → 89**、cleanFiles **240 → 245**（spike 實測值、非預測；5 檔全清入 cleanFiles）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 5 個 handler 簽名型別標註，TS erase 後 runtime byte-identical（§Spike sha 實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 843、零殘留。

## 測試影響面（覆蓋誠實，per-file 分層，[[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf base 0 → after 0 實證）。
- **覆蓋分裂（誠實分開報、不泛稱 covered）**：

| 檔 | direct test | 真打路徑 | 硬保證 |
|---|---|---|---|
| `step-up.ts` | ✅ `step-up.test.ts`（dedicated）+ `change-password.test.ts` | `enableTotp` + `freshTotp()`(otpauth `new TOTP().generate()`) 產真 OTP 打 handler → 驗 scope 白名單 / OTP / backup 原子核銷 / 簽 token / rate-limit / concurrent | direct + byte-identical |
| `local/reset-password.ts` | ✅ `reset-password.test.ts` + `reset-password-2fa.test.ts` + `reset-2fa-bruteforce.test.ts` | token consume + TOTP + backup race path + 限流 + audit | direct + byte-identical |
| `2fa/disable.ts` | ❌ 無 direct 亦無 indirect | — | **byte-identical 為唯一硬保證**（同 turnstile PR-2cf 策略） |
| `2fa/activate.ts` | ❌ 無 | — | **byte-identical 為唯一硬保證** |
| `2fa/backup-codes/regenerate.ts` | ❌ 無 | — | **byte-identical 為唯一硬保證** |

- 3 個 2FA handler 無測試 → 不宣稱其 coverage；其改動為純 destructure 標註（type-strip 為零）+ byte-identical 證明、與 turnstile/totp 缺 direct 的先例同策略。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`。**PowerShell 用 `$env:RATCHET_BASE_REF='5b4ae52b'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='5b4ae52b'; npm run typecheck:ratchet` green（843→833 / 94→89 / 240→245）。
- filtered forced tsc：5 檔 0 殘留 + functions sort-diff added=0 + `tsc -b tsconfig.tests.json --force` exit 0（base 0 → after 0）。
- byte-identical：esbuild stdin base(`5b4ae52b`) vs source → 5 檔 sha 與 §Spike 一致、皆非空。
- `npm run lint` green（全量）、`npm run build:functions` green。
- targeted int（標註套用狀態實跑）：`npm run test:int -- tests/integration/step-up.test.ts tests/integration/change-password.test.ts tests/integration/reset-password.test.ts tests/integration/reset-password-2fa.test.ts tests/integration/reset-2fa-bruteforce.test.ts`（覆蓋 step-up + reset-password direct path）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §型別選型 凍結 diff **逐行一致**（人審 `git diff --stat` 僅 5 檔各 +1/−1、`git diff` 5 處皆 `onRequestPost` 簽名）；超出 = scope creep = Gate fail。

## Merge SOP（process lock，順序不得寫反；[[feedback_pre_merge_gate_checklist_match_ci]]）

① faithfulness ✅ → ② **先**跑齊 merge 前 local gates 全綠（`lint`·`typecheck:ratchet`·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit`）→ ③ 全綠後 owner 明示 `MERGE_ALLOWED` → ④ squash-merge（`--delete-branch`）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 branch cleanup + memory receipt。

## Diff hygiene

- 不碰 `CLEANUP_PLAN.md`（untracked、Stage 7 完工才清）；baseline 不 `--update`；挑檔 add（5 source + 本 plan doc）禁 `git add -A`/`-A`；開 feature branch 禁直推 main；平行 session 唯讀優先、動 git 前先 `git status`。

---

## 附：owner C-1 鎖定表（faithful 收錄）

### 風險表
| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| `step-up.ts` elevation token 簽發 | 高 | scope/TTL/acr/amr 任一漂移破壞 step-up 安全邊界 | 僅改 handler destructure 標註；spike 已證 functions+tests leaf 0 cascade |
| 3 個 2FA handler 無測試覆蓋 | 中高 | runtime 漂移測試不一定抓 | byte-identical（非空、IDENTICAL）為硬保證 |
| A1 併入 A2 scope 漂移 | 中 | setup.ts 雖乾淨但非 verify-caller | OD-1 鎖：禁併入 |
| `CLEANUP_PLAN.md` untracked | 中 | 誤 add 汙染 scope | 禁 `git add -A`、挑檔 add |
| baseline/ratchet 誤更新 | 高 | 掩蓋真實 Stage 7 進度 | reduce 不 `--update` |

### 防禦表
| 機制 | 處理 | 實作 / 未處理因 |
|---|---|---|
| 權限 | 是 | `requireAuth(request, env)` 簽名吻合、呼叫順序不動 |
| Input | 是 | 禁改 regex / body parse / TOTP·backup 驗證邏輯 |
| RateLimit | 是 | 禁改 `step_up`/`2fa_disable`/`2fa_activate`/`2fa_regen`/`reset_2fa` kind 與閾值 |
| XSS | N/A | Functions API type-only、無前端輸出面 |
| Log/Audit | 是 | 禁改 audit event 名稱 / level / payload |
| Retry/備援 | N/A | 無外部 retry / 部署架構變更 |
| 監控 | 是 | ratchet 843→833 明列；coverage 不 overclaim |

### DB 鎖定
| 項目 | 裁示 |
|---|---|
| Migrate/Rollback/Index/Tx | 不允許 / 不改 |
| Unique | 不改 `backup_codes`/`used_totp`/`email_verifications` 既有約束 |
| Atomic consume | 禁改 `RETURNING`/`changes()`/`WHERE … used_at IS NULL` 順序與條件 |

### 隔離區 / 鎖定區
- **隔離區**：`2fa/setup.ts`、A2/A3 其餘檔（change-password/unbind/delete/forgot-password/email/login/register）、`CLEANUP_PLAN.md`、baseline/ratchet override **全部不得碰**。
- **鎖定區**：所有 runtime token（SQL / regex / rate-limit / token scope·TTL·claims / audit event / atomic consume 順序 / `db.batch`）；return type / JSDoc / 格式。
