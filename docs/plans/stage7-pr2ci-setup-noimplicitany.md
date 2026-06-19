# Stage 7 reduce PR-2ci — 2fa/setup noImplicitAny（2FA setup handler 單檔 type-only，安全鎖 L3）

**目標**：`functions/api/auth/2fa/setup.ts` **2 個 noImplicitAny error（TS7031 ×2 handler destructure）→ 0**，**純 type-only**（1 個編輯點＝`onRequestPost` 簽名 destructure 型別標註）。

> **主線定位（owner C-1）**：A 域 handler 層。PR-2ch 已清 A1 五檔 TOTP-caller handler（disable/activate/regenerate/step-up/reset-password，#104 `176bf542`）。本 PR = `2fa/setup.ts`，owner 2026-06-19 裁 **選項 A：單檔**（A2 最乾淨起手；`change-password.ts`/`identity/unbind.ts`/`auth/delete.ts` 後續再依風險分棒，`delete.ts` destructive 末尾單獨成棒）。

base main `176bf542`（接 PR-2ch #104；`git rev-parse HEAD` 實查）。

## owner 裁示 / 治理級別（governance level 不因 scout 乾淨度降級）

- **級別**：impl **L1**（單檔 mechanical type-only）/ review care **L2** / **安全鎖 L3**（2FA setup：160-bit TOTP secret 生成 + 儲存路徑，Tier-0 鄰接）。
- **owner C-1 糾正（記入）**：`setup.ts` 雖乾淨（單檔、0 cascade、byte-identical），**仍屬 2FA/security 熱區，不得因 scout 乾淨度降成輕流程**；放寬的只有 **self-review 形式**（單 agent 可），**外部 gate 不放寬**——仍走完整 Dual Gate v3.1 四道。引 [[feedback_self_review_form_not_downgradable_by_spike]]。
- **self-review = 單 agent 對抗式**（單檔、**非**首個某類熱區批次；A 域 handler 批次先例已由 PR-2ch 建立；cadence 同 PR-2cg 單檔）。

## owner 鎖定表（L1-L7，faithful 收錄）

| Lock | 內容 |
|---|---|
| L1 Scope | 僅 `functions/api/auth/2fa/setup.ts` |
| L2 Type-only | 只允許 handler destructuring annotation，不得改 runtime code |
| L3 Behavior | 不得觸碰 TOTP 產生、Secret parsing、issuer fallback、rate limit、DB update、response body |
| L4 Env | `Env` 只用於 annotation；不得新增 env key、不得改 `types/env.d.ts` |
| L5 Cascade | 不得改 tests、utils、migration、config |
| L6 Evidence | plan 階段需實測 sort-diff、byte-identical、tests-leaf |
| L7 Claim | coverage 只能宣稱 byte-identical；不得宣稱 direct/indirect test coverage |

## Gate 1 精煉 locks（ChatGPT Architecture，L1-L10；owner L1-L7 之 superset）

2026-06-19 Gate 1 將 owner L1-L7 精煉擴充為 L1-L10（faithful 收錄；本 plan 逐項 compliant、已對 source 復核）：

| Lock | 內容 |
|---|---|
| L1 Scope | 僅 `functions/api/auth/2fa/setup.ts` |
| L2 Edit Point | 僅 L37 handler signature annotation |
| L3 Type-only | 不得改任何 emitted JavaScript 行為 |
| L4 Runtime Hot Zone | 不得觸碰 secret generation、`Secret.fromBase32`、TOTP 參數、issuer fallback、rate-limit、SQL、response body、常數 |
| L5 Env | 不得改 `types/env.d.ts`；不得新增 env key；**不得把本案推廣成 util full-Env 政策**（handler full `Env` ⟂ util `Pick` 刻意分流） |
| L6 Tests | 不得新增 / 刪除 / 修改 tests 配合本 PR |
| L7 Evidence | Code 階段需重跑 ratchet、forced sort-diff、esbuild stdin byte-identical、tests-leaf cascade、`git diff --check` |
| L8 Claim | setup.ts coverage 只能宣稱 byte-identical；不得宣稱 direct/indirect test coverage |
| L9 Gate | 不得因單檔或 spike clean 跳過 Codex Plan / Codex Code / ChatGPT Faithfulness |
| L10 Stop Rule | 任一非 annotation diff 出現 → 退回 PLAN_DRAFT，不得在 Code 階段自行擴 scope |

**對照**：L1-L10 ⊇ owner L1-L7（L1=L1；L2 明確化編輯點；L3⊇owner L2；L4=owner L3；L5=owner L4＋util 政策防外溢；L6⊆owner L5 之 tests 子集；L7=owner L6；L8=owner L7；L9/L10 新增治理 stop-rule）。

**Non-blocking notes 處置**：
- **NB-1（push for Codex）**：branch 目前僅本地。Codex Plan Gate 若需遠端 `main...HEAD` 比較，可 push `stage7-pr2ci-setup-noimplicitany`；此為流程需要、不改 gate-state、不等同 coding allowed。**待 owner 指示 push 或本地跑 Codex。**
- **NB-2（code 階段報告雙證）**：Code 階段報告**同時列**「base vs patched emit byte-identical（esbuild stdin，sha + bytes）」與「source diff 僅 1-line annotation（`git diff` 逐行）」，**不以 ratchet 數字單獨替代行為保證**。已併入 §驗證計劃 硬驗收（plan 原已含 byte-identical + 逐行 diff 人審，NB-2 明文強化）。

## 流程定位 / Gate 紀錄（Dual Gate Workflow v3.1）

- 2026-06-19 Claude scout（read-only A2 域）→ 回報 4 檔實測 → **owner 裁 PR-2ci scope = 選項 A 單檔 `setup.ts` + L1-L7 鎖**（非 coding approval）。
- 2026-06-19 Claude **本 doc + 非 commit spike 實證**（見 §Spike 實證，working tree 已 revert clean）→ 單 agent 對抗式 self-review 至 0 新發現。
- 2026-06-19 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（0 blocker / 0 required revision / 2 non-blocking note）— 最小變更方向成立；`Request` 選型合理（無 `.cf` → 不引 CfRequest）；`Env` 選型合理（entry handler 非 util，`requireAuth` 亦收 `Env`，貼近 handler convention）；plan/code 分 SHA + source 未動 + A2 三檔隔離（尤其 destructive `auth/delete.ts` 不混包）全判定正確。locks 精煉為 **L1-L10**（見 §Gate 1 精煉 locks，為 owner L1-L7 之 superset）。NB-1/NB-2 處置見該節。**可送 Codex Plan Gate；不得進 coding 除非 owner 明示 `CODING_ALLOWED`。**
- 2026-06-19 **Codex Plan Gate r1：`CODEX_PLAN_CHANGES_REQUIRED`**（0 source / scope / security / Tier-0；1 docs-blocking finding）— byte-identical recipe 不可唯一重播：plan v1 記 `--loader=ts` / 2235B / `a4a12ce3…`，SoT canonical `--loader=ts --format=esm` 實得 2256B / `688cd77c…`。本地方案 (b)（owner 不需 push）；L37 / TS7031×2 / ratchet 833/89/245 / blob `3cf328c5→e1784b6c` / `Request`·`Env` 選型 / 零 coverage 均確認正確。
- 2026-06-19 **修正 r1（docs-only）**：改用 canonical recipe、receipt 更新為 **2256B / `688cd77c…`**（本地 re-verify base==patched **YES**、exit 0、stderr 空）、列 stdin replay 命令；L1-L10 不變、source 未動。
- 2026-06-19 **Codex Plan Gate r2：`CODEX_PLAN_CHANGES_REQUIRED`**（0 source / scope / Tier-0；1 docs-blocking）— r1 flags/bytes/SHA 修正正確、source 仍 0 diff，但 replay 命令非 PowerShell 5.1 原文可執行（`<` stdin redirection 不支援、`esbuild.ps1` execution policy 阻擋）；獨立驗證數值仍正確（2256B / `688cd77c…` / identical / stderr 空）。
- 2026-06-19 **修正 r2（docs-only，本 commit）**：§驗證計劃 byte-identical 區明標 **Git Bash commands** + 補完整 receipt（輸出檔、stderr、`wc -c`、`sha256sum`、`diff -q`）；本地用 doc 內 exact 命令（`node_modules/.bin/esbuild`）re-verify 兩端 **2256B / `688cd77c…` / stderr 0 / `diff -q` IDENTICAL**；數值與 L1-L10 不變、source 未動。**待重送 Codex Plan Gate r3。**
- 2026-06-19 **Codex Plan Gate r3：`CODEX_PLAN_APPROVED` @ `78678204`**（Findings: none）— r2 finding 完整閉合；Git Bash 原文 receipt 重播成功（兩端 2256B / `688cd77c…` / stderr 0 / `diff_exit=0`）；`main...HEAD` 僅 plan doc 4 commit、source diff=0、`CLEANUP_PLAN.md` 未進 diff；L1-L10 / typing / ratchet / cascade / coverage 誠實性一致。**Plan Gate（Gate 1 ChatGPT Arch + Gate 2 Codex Plan）全通過 = plan 批准，非 coding 授權。**
- **owner `CODING_ALLOWED`**：PENDING（Plan Gate 已過；待 owner **當輪明示** 才進 Code 階段）。
- **Codex Code Gate**：PENDING（code 階段）。
- **ChatGPT Faithfulness Gate**：PENDING（code 階段）。

## ⚠ 2FA setup 熱區敏感聲明（最高優先紀律，安全鎖 L3）

`2fa/setup.ts` = `POST /api/auth/2fa/setup` handler：驗 JWT → rate-limit → 產生 **160-bit TOTP secret** → 存入 `local_accounts.totp_secret`（`totp_enabled` 保持 0，真正啟用閘門在 `/activate`）→ 回 `{ secret, otpauth_uri }` 供前端產 QR。Tier-0 鄰接（2FA 第一階段；**secret 生成 + 儲存**）。

owner / gate 紀律：**修法若非純型別、或會牽動以下任一 → 立刻停手回 `PLAN_DRAFT`，不硬寫**（對齊 owner L3）：
- `generateBase32Secret(byteLength = 20)` + `crypto.getRandomValues(new Uint8Array(...))` — 160-bit secret 生成（`Secret.generate()` 在 CF Workers 相容性 workaround）
- `Secret.fromBase32(generateBase32Secret(20))` secret parsing
- `new TOTP({ issuer, label, algorithm: 'SHA1', digits: 6, period: 30, secret })` 演算法 / 參數
- `issuer: env.TOTP_ISSUER ?? TOTP_ISSUER` issuer fallback
- `checkRateLimit` / `recordRateLimit`（`kind: '2fa_setup'`, `windowSeconds: 60`, `max: 5`）
- `requireAuth(request, env)` 身份閘門
- `SELECT totp_enabled FROM local_accounts` / `SELECT email FROM users` 讀取
- `UPDATE local_accounts SET totp_secret = ? WHERE user_id = ?`（保持 `totp_enabled=0`）
- response body `{ secret: secret.base32, otpauth_uri: totp.toString() }`
- 常數 `TOTP_ISSUER='CHIYIGO'` / `RL_WINDOW_SEC=60` / `RL_MAX=5` / `BASE32_ALPHABET`

註：唯一允許 = `onRequestPost` 簽名 destructure 型別標註。TS erase 後 runtime 行為必須 byte-identical（SQL / 常數 / TOTP 參數 / 字串 / 註解不變）。

### Coding 階段硬性邊界

- **允許**：`onRequestPost` 單一簽名 `{ request, env }` 的 destructure pattern type 標註。
- **禁止**：改 secret 生成 / `Secret.fromBase32` / TOTP 參數 / issuer fallback / rate limit / `requireAuth` / SQL / response body / 常數 / caller / tests / `tsconfig`·`eslint`·`vitest` / `env.d.ts`；加 return type、清 JSDoc、新增 any / suppression / global / import / package、任何「順手修正」。

## Scout（對抗式驗證，命令真輸出 @ `176bf542`）

### exact errors（forced `tsc -b tsconfig.functions.json --force`，total 833）

```
functions/api/auth/2fa/setup.ts(37,39): error TS7031: Binding element 'request' implicitly has an 'any' type.
functions/api/auth/2fa/setup.ts(37,48): error TS7031: Binding element 'env' implicitly has an 'any' type.
```

恰 **2 個**（baseline file `types/typecheck-baseline.json:46` 同記 `"functions/api/auth/2fa/setup.ts": 2`）。全集中單一簽名（L37）：destructure `request` / `env`（TS7031 ×2）。`generateBase32Secret(byteLength = 20)` 有 default → 推得 `number`、**不報、不需動**。catch 變數本檔無（無 try/catch handler）。

### 型別選型（owner Convention A；handler 用 full `Env`）

唯一允許落地的 source 變更（before → after，1 行）：

```ts
// before
export async function onRequestPost({ request, env }) {
// after
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
```

| 決策 | 裁示 | 理由 |
|---|---|---|
| `env` | **full `Env`** | handler 先例（PR-2ch A1 五檔 + `2fa/verify` PR-2u）；`requireAuth(request: Request, env: Env)` 簽名吻合＝最強零-cascade 佐證；handler 用 full `Env` 與 util 用 `Pick` 刻意分流（[[feedback_util_env_param_pick_not_full_env]]）。`setup.ts` 讀 `env.chiyigo_db` + `env.TOTP_ISSUER` 兩 key，full `Env` 涵蓋（兩者皆在 `Env` interface，`TOTP_ISSUER?` optional + `??` fallback） |
| `request` | **`Request`（plain）** | `setup.ts` 只用 `request.headers.get('CF-Connecting-IP')` + `request` 流入 `requireAuth(request: Request)`；**無 `.cf` 存取** → 非 `CfRequest` |
| return type / JSDoc | **不加 / 不清** | 沿 PR-2cg / PR-2ch 鎖：只處理 TS7031，不做格式 / 文件整理 |

**考慮過、否決**：`env: Pick<Env, ...>`（handler 慣例用 full `Env`，PR-2ch A1 已定；且需 Pick 兩 key 反更繁）；`CfRequest`（無 `.cf` 存取）；加 `Promise<Response>` return 標註（無 error 驅動、非最小 diff）；清 JSDoc（lock 鎖）。

### 依賴邊界（cascade 逐一驗證）

- **functions-internal caller：0**（handler = Pages entry point；`grep functions/` 無任何檔 import 本 handler module；命中皆 doc-comment 路徑字串 + `activate.ts:74` 的 error message 字面 `'Run /api/auth/2fa/setup first'`，非 import）。intra-file env 存取僅 `env.chiyigo_db`（D1 resolves `any` [[feedback_d1database_resolves_any_no_workers_types]]）+ `env.TOTP_ISSUER`（`Env` 內 optional + `??` fallback）→ 流入 util 全 assignable。
- **tests-leaf：0**（無 test import `2fa/setup` handler；`change-password.test.ts` 等用 `enableTotp` helper **直插 DB secret 繞過 `setup.ts`**）。tests leaf `noImplicitAny:false`。
- **判定**：結構性零 cascade。spike sort-diff ADDED=0（全 solution）+ base solution 非-`functions/` error=0 實證。

## Spike 實證（full-solution，本地未 commit，2026-06-19，已 revert clean）

**程序**：套 1 編輯點 → esbuild stdin byte-identical（**canonical recipe `--loader=ts --format=esm`**；base 從 HEAD、patched 從 working tree）→ 清 `.tscache` → forced `tsc -b tsconfig.solution.json --force`（含 functions / tests / scripts / browser-typecheck 4 leaf）→ canonical `--report` → `git diff --check` → `git restore` → 驗 clean。

**單輪達標**（scout cascade 靜態分析直接命中）：

| 驗收條件 | 結果 |
|---|---|
| `setup.ts` errors 2 → 0 | ✅ sort-diff REMOVED = 恰 2 行 `setup.ts(37,39)`/`(37,48)` TS7031 |
| total errorCount 833 → 831（恰 −2） | ✅ forced tsc solution **831**；sort-diff ADDED = **空** |
| zero cascade（functions + tests + scripts + browser，全 solution） | ✅ sort-diff ADDED=0；base solution 非-`functions/` error = **0**（tests/scripts/browser 本就 0），patched 維持 |
| canonical `--report` | ✅ errorCount **831** / errorFiles **88** / cleanFiles **246** / sourceFilesTotal 334 |
| **bundle byte-identical**（TS erase 後 runtime 不變硬保證；**canonical recipe `esbuild --loader=ts --format=esm`**，[[feedback_byte_identical_emit_verification]]） | ✅ esbuild **stdin** type-strip base(`176bf542`) vs patched：皆 **2256 bytes（非空）**、`diff -q` IDENTICAL、sha256 兩端皆 `688cd77c271b0c7cec3ff88aed37e09961f9733bef76be45b5a62aa0b27c0c2a`、esbuild stderr 空（避 `--loader` file-entry 空輸出陷阱）。⚠ **Codex Plan r1 修正**：plan v1 原誤用 `--loader=ts`（無 `--format=esm`）→ 2235B / `a4a12ce3…`，非 SoT canonical；兩 recipe 皆證 base==patched，但 receipt 必鎖 canonical 才可唯一重播 |
| `git diff --check` | ✅ exit 0（無 trailing whitespace / lone space） |
| working tree revert clean | ✅ `git restore` 後 `setup.ts` 回 HEAD blob `3cf328c5`、`git status --porcelain` 僅 `?? CLEANUP_PLAN.md` |

**byte-identical 適用性**：`setup.ts` 有 3 import（`otpauth` / `utils/auth` / `utils/rate-limit`）→ esbuild stdin transform **適用**（單檔 transform，import 行原樣保留；type-only annotation PR 的正確證明面）。

**frozen diff（git-format，spike 實取，`git diff --check` clean）**：`@@ -34,7 +34,7 @@`，唯一變更行 L37：`onRequestPost({ request, env })` → `onRequestPost({ request, env }: { request: Request; env: Env })`（blob `3cf328c5` → `e1784b6c`，+1/−1）。

## 預期 ratchet

- clean main `176bf542` `--report`：errorCount **833** / errorFiles **89** / cleanFiles **245** / sourceFilesTotal 334。
- 本 PR 後 current ratchet state：errorCount **833 → 831**（−2）、errorFiles **89 → 88**、cleanFiles **245 → 246**（spike 實測值，非預測）。
- baseline file 不變，天花板 errorCount **1119** / cleanFiles **175** 保留（reduce PR 不跑 `--update`，[[feedback_ratchet_current_vs_baseline_file]]）。

## Runtime 行為不變保證 / Rollback

- 全部改動 = 型別標註，TS erase 後 runtime byte-identical（§Spike sha 實證）。
- rollback：單一 squash commit `git revert` 即完整回退；無 migration、無 deploy 行為差、baseline file 未動 → revert 後 ratchet 自然回 833、零殘留。
- 無 frontend 改動 → **無 cache-bust**（backend-only，[[feedback_asset_versioning_content_hash]]）。

## 測試影響面（覆蓋誠實，L7 + [[feedback_pr_coverage_claim_accuracy]]）

- **零測試檔改動**（spike tests-leaf ADDED=0 實證）。
- **direct test = 0**（無 test import `setup` handler）。
- **indirect test = 0**（無 integration test 打 `POST /api/auth/2fa/setup`；`enableTotp` helper 直插 DB secret 繞過 `setup.ts`）。
- **byte-identical = 唯一硬保證**（同 PR-2ch disable/activate/regenerate、turnstile 策略）。**不宣稱 direct/indirect coverage**（owner L7）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後 full replay @ source commit，不沿用 spike）

> ⚠ ratchet/tsc 量測前清 `.tscache`。**PowerShell 用 `$env:RATCHET_BASE_REF='176bf542'`**（勿照字面跑 POSIX `VAR=x npm`）。

- `$env:RATCHET_BASE_REF='176bf542'; npm run typecheck:ratchet` green（833→831 / 89→88 / 245→246）。
- `npm run lint` green（全量）、`npm run build:functions` green。
- filtered forced tsc：`setup.ts` 0 殘留 + 全 solution sort-diff ADDED=0（含 tests leaf；等同 `tsc -b tsconfig.tests.json --force` exit 0 的 tests-leaf 0 cascade，solution 建置已涵蓋）。
- **byte-identical**（canonical recipe，[[feedback_byte_identical_emit_verification]]；NB-2 雙證之一）。⚠ **Git Bash commands**（經 Bash tool / Git Bash 執行；**PowerShell 5.1 不支援 `<` stdin redirection、且 `esbuild.ps1` 受 execution policy 阻擋** → 此 receipt 不在 PowerShell 原文跑；唯獨 ratchet 段用 PowerShell `$env:` 見上注）：

```bash
git show 176bf542:functions/api/auth/2fa/setup.ts | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/base.js 2>/tmp/base.err
node_modules/.bin/esbuild --loader=ts --format=esm < functions/api/auth/2fa/setup.ts > /tmp/head.js 2>/tmp/head.err
wc -c /tmp/base.js /tmp/head.js       # 期望 2256 兩端
sha256sum /tmp/base.js /tmp/head.js   # 期望 688cd77c271b0c7cec3ff88aed37e09961f9733bef76be45b5a62aa0b27c0c2a 兩端
cat /tmp/base.err /tmp/head.err       # 期望 空（stderr 0 bytes）
diff -q /tmp/base.js /tmp/head.js     # 期望 IDENTICAL（無輸出 + exit 0）
```

  - patched 端 `< functions/api/auth/2fa/setup.ts` 讀 code 階段已落地 edit 的 working-tree 檔；base 端 `git show 176bf542:` 讀未改 base。本地實證：兩端 **2256B / `688cd77c…`**、stderr 0、`diff -q` IDENTICAL。
- `setup.ts` **無 targeted int**（0 coverage）；跑全量 `test:int` 確認無跨檔破壞（**不宣稱涵蓋 setup**）。
- merge 前 CI 對齊 local gates（[[feedback_pre_merge_gate_checklist_match_ci]]）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- **硬驗收**：source diff 與本 doc §型別選型 before→after **逐行一致**（人審 `git diff -- functions/api/auth/2fa/setup.ts`）；超出 = scope creep = Gate fail。

## merge SOP（process lock，順序別反）

① faithfulness ✅ → ② 跑齊 merge 前 local gates 全綠 → ③ owner `MERGE_ALLOWED` → ④ squash-merge（`--delete-branch`）→ ⑤ 監看 main CI + Cloudflare deploy（撞 flake 才 rerun）→ ⑥ merge 後 branch cleanup / memory receipt。

---

## 附：owner C-1 鎖定表（faithful 收錄）

### 風險表

| 項目 | 等級 | 影響 | 防禦 |
|---|---|---|---|
| TOTP secret 生成漂移 | 高 | secret entropy / base32 格式變化 | 僅改 L37 type annotation；禁動 `generateBase32Secret` / `crypto.getRandomValues` |
| secret 儲存漂移 | 高 | `totp_enabled` 閘門 / 儲存錯 | 禁動 `UPDATE local_accounts SET totp_secret`（保持 `totp_enabled=0`） |
| issuer / TOTP 參數漂移 | 中 | otpauth URI / 驗證相容性 | 禁動 `TOTP` 參數 / `env.TOTP_ISSUER ?? TOTP_ISSUER` |
| caller cascade | 低 | typed caller 新增錯 | handler = entry point、0 internal caller；sort-diff ADDED=0 已證 |
| 無 direct/indirect test | 中 | 端點層無自動保護 | byte-identical 唯一硬保證 |

### 防禦表

| 機制 | 處理 | 實作 / 未處理因 |
|---|---|---|
| RateLimit | 否（保留） | 不動既有 `2fa_setup` 60s/5 |
| 權限 | 否（保留） | `requireAuth` gate 不動 |
| Input | 否 | 無新增 runtime validation（type-only） |
| XSS | N/A | 無 HTML/DOM |
| Log / Retry / 監控 | 否 | 不新增；不動 DB write |

### DB 鎖定

| 項目 | 裁示 |
|---|---|
| Migrate / Rollback / Index / Tx | 不允許 / 不改 |
| Schema | 不改 `local_accounts` |

### 隔離區 / 鎖定區

- **隔離區**：`change-password.ts` / `identity/unbind.ts` / `auth/delete.ts`（A2 其餘）全部**不得併入 PR-2ci**（owner 選項 A）。
- **鎖定區**：secret 生成、`Secret.fromBase32`、TOTP 參數、issuer fallback、rate limit、SQL、response body、return type / JSDoc、`env.d.ts`。
