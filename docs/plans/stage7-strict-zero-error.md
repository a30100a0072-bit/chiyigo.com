# Stage 7 — Strict Zero-Error Gate（Plan v3.1）

> 狀態：plan 階段，**0 行 Stage 7 code 變更**。本檔為 Codex plan-gate v3.1 審查標的。
> Base HEAD：`1185ed5`（main，working tree clean，non-strict solution = EXIT 0 / 0 error）。
> 動工分級：**L3**（跨全 codebase + Tier-0 治理機制變更）；屬「治理 + 機械型遷移」，runtime 0 變更，不跑 §輸出順序 11 步。

## 0. 決策紀錄（plan-gate 迭代）

- **架構分叉拍板（owner + Codex 一致）**：**方案 A（locked override）**，非 B'（雙軌 strict-probe）。
- **執行 refinement 拍板**：**per-flag ladder**（每 leaf 先 `noImplicitAny` 再 `strict:true`），非 per-leaf 一次 full strict。理由：red window 更小、PR 更同質、hot-zone review 更乾淨。
- **plan-gate 軌跡**：v1 reject（PR-0 override 太鬆）→ v2 reject（override 豁免集不完整 + operational deadlock + 機械化缺口）→ v3 reject（governance workflow 缺 explicit base ref）→ **v3.1（本檔）**。
- **數字雙方復現**：functions 1293 / scripts 49 / browser-typecheck 1088 / tests(全)2485 由 Claude 與 Codex 各自實測一致。

## 1. 目標與終態

把 solution graph 的 4 個 leaf 從 `strict:false` 階梯式開到 `strict:true` 且 **zero-error**，順序 **functions → scripts → tests → browser-typecheck**。終態：ratchet gate 鎖 zero-error + `npm run typecheck` 接進 CI/build（§7 PR-終）。

## 2. 勘查實況（以 code 為準）

| Leaf | strict errors | files | 主成分 |
|---|---|---|---|
| functions | 1,293 | 146 | noImplicitAny TS70xx ~1,150（89%）｜strictNull/catch ~140 |
| scripts | 49 | 6 | TS70xx 40（含 `.js` infra helper）｜catch TS18046 9 |
| tests（tests-only） | 1,178 | ~60 | 同型；tests-leaf 全量 2,485 = functions 1,293 + forensic 14 + tests-only 1,178 |
| browser-typecheck | 1,088 | 25 | TS70xx ~743｜strictNull TS18047 247 + TS2531 38 = ~285 |
| **去重總計** | **≈ 3,608** | | noImplicitAny 約佔 70%，strictNullChecks 次之 |

熱區檔（§1.5e）：functions `audit-aggregate-archive-runner.ts`(97)、`cron/audit-archive.ts`(88)、`jwt.ts`(36)、`oauth/[provider]/callback.ts`(28)、`webhooks/payments/[vendor].ts`(23)、`ecpay.ts`(25)；browser `dashboard.ts`(256)、`admin-payments.ts`(34)、`admin-requisitions.ts`(46)、`erp-architecture-3d.ts`(220, Three.js)。

**量測方法修正**：`tsc -p <leaf> --strict` 量到的數字偏低（leaf tsconfig 顯式 `noImplicitAny:false`，CLI `--strict` 群組預設無法 override 個別 flag 的顯式設定）。真值須 `--strict --noImplicitAny` 雙開。所有數字已用雙開法重量。

Error 全為機械型（無結構障礙）：`Parameter 'env' implicitly any`（補 `env: Env`）、`catch(e)` → `e is unknown`、module var 無初始型別、object member 無型別。補洞 pattern 同 Stage 2-5。

## 3. 治理機制：locked override（PR-0 核心）

### 3.1 為何需要 override

開 strict 會讓 solution `errorCount` 從 0 跳到該 leaf 全量（從 zero base 創造大量 new error files）。ratchet 的 base-derived 守備群會擋下「合法的 open-strict PR」。CI 只 gate `typecheck:ratchet`（`ci.yml:32`），不裸跑 `npm run typecheck`；`deploy.yml` 不跑 typecheck/build → 中間態主線可暫時 red 而不影響部署。

### 3.2 開 strict 會觸發的守備（精確盤點 @ `1185ed5`）

前提：open-strict PR = 同 PR 跑 `baseline:update` 收編 current + **無任何 source 變更**。

| 守備 | 行為 | override 處置 |
|---|---|---|
| `[A]` errorCount > branch baseline (965) | 不觸發（baseline:update 使 current==branch baseline） | **保持 enforce** |
| `[B]` cleanFiles < branch baseline (968) | 不觸發（同上） | **保持 enforce** |
| `[B']` 新 error 檔 vs branch (979) | 不觸發（baseline:update 收編進 branch.errorsByFile） | **保持 enforce** |
| `[B'']` per-file 升 vs branch (992) | 不觸發（同上） | **保持 enforce** |
| `[BASE-B'']` per-file 升 vs base (999) | 不觸發（全為 new file，由 BASE-B' 處理；`findIncreasedErrorFiles` 對 new file 不報） | **保持 enforce** |
| `[SCHEMA-baseline]` / `[SCHEMA-baseBaseline]` (1027/1030) | 不觸發（baseline:update 產 canonical 自洽） | **保持 enforce**（防手改竄改） |
| `[D-tsconfig]` branch snapshot (1042) | 不觸發（baseline:update 收編 strict=true 進 branch snapshot） | **保持 enforce** |
| `[C]` suppression (1053) | 不觸發（不加 suppression） | **保持 enforce** |
| `[D/E]` 新 source (1058) | 不觸發（無新 source） | **保持 enforce**（+ precondition P1 強化） |
| `[BASE]` baseline.errorCount 削弱 (957) | **觸發**（0→N） | **override 豁免** |
| `[BASE]` baseline.cleanFiles 削弱 (960) | **觸發**（257→M） | **override 豁免** |
| `[BASE-B']` 新 error 檔 vs base (983) | **觸發**（base.errorsByFile={}，全 new） | **override 豁免** |
| `[BASE-EBF]` branch errorsByFile 新增 vs base (1012) | **觸發**（base={}，全 kind='new'） | **override 豁免** |
| `[BASE-D-tsconfig]` strict-family compilerOptions 變更 (1045) | **觸發**（base ref live read = strict:false） | **override 豁免（限 strict-family key）** |

對齊 Codex High 1：豁免集 = `BASE errorCount / BASE cleanFiles / BASE-B' / BASE-EBF / BASE-D-tsconfig strict-family`；branch-local `A/B/B'/B''/SCHEMA/D` 全保持 enforce。

### 3.3 override 精確契約 — 「以 precondition 證明歸因」而非無差別豁免

override **不是**直接吃掉 BASE failures，而是先驗「導致這些 failure 的唯一原因 = 單一 leaf 的 strict flag」，證明成立才豁免那 5 條。Preconditions（全 AND，任一不過 → 不啟用 override、照常 enforce 全部 → PR fail）：

- **P1（no source）**：`git diff base...HEAD --name-only` 只含 `tsconfig.<leaf>.json` + `types/typecheck-baseline.json` + `docs/plans/**` + `docs/governance-exceptions.md`。任何 `.ts/.js/.mjs/.cjs/.d.ts` 出現 → 拒。
- **P2（單 leaf strict-family，方向強化）**：tsconfigSnapshot diff（current vs **base ref live read**）剛好單一 `tsconfig.<leaf>.json` 的 strict-family key（`strict`/`noImplicitAny`/`strictNullChecks`）變更，方向限 `false→true` 或 `unset→true`；無其他 leaf、無其他 compilerOptions key、無 include/exclude/references 變更。（禁 `true→false` 弱化）
- **P3（一次一 leaf）**：base ref baseline.errorCount **=== 0**（前一 leaf/flag 階梯已清零並 merge）。
- **P4（防灌水）**：branch baseline.errorCount **=== current.errorCount**（current 實測 == 宣稱 baseline；配合既有 SCHEMA `sum==fileErrors` 雙重防護）。
- **P5（error 歸屬 changed leaf）**：current.errorsByFile 所有 path 屬於 changed leaf 的 include 範圍（leaf→prefix 映射見下）。

leaf→path-prefix 映射（P5 用；由 leaf include 推導）：
- functions → `functions/`（含 `functions/.well-known/`）
- scripts → `scripts/`
- browser-typecheck → `src/js/`
- tests → `tests/`（functions/forensic 由 §5 preflight 證明 0，故 override 時 errorsByFile 不得含它們）

啟用 override 時：豁免 §3.2 五條 → log durable line：
```
[OVERRIDE] leaf=<name> flag=<strict-family> errorCount 0→N cleanFiles 257→M baseRef=<sha> reason=<env value>
```

### 3.4 env / merge path（Codex High 2 解 deadlock + v3-H base ref）

- env：`RATCHET_ALLOW_BASELINE_RAISE=<reason>`，**CI 預設不帶**（`ci.yml` 一般 PR 流程不注入）。
- **merge path（明文，不留隱含）**：open-strict PR 走**專用 governance workflow** `.github/workflows/strict-leaf-governance.yml`（`workflow_dispatch`），input：`leaf` + `reason` + **`base_ref`（required）**。一般 `ci.yml` 對 open-strict PR 的 ratchet step **預期 red**（§3.6 Approval Record、bounded per leaf），由 owner 經 governance workflow 綠燈 + admin merge 進 main。
- **base_ref（v3-H，Codex High）**：`workflow_dispatch` 非 PR event，`github.base_ref` / `pull_request.base.sha` 皆不存在；ratchet 在 CI 環境缺 `RATCHET_BASE_REF`+`GITHUB_BASE_REF` 會 **`exit 3`**（`getBaseRef` F8-CI @ `typecheck-ratchet.mjs:298`）。故 governance workflow 必須：(a) `base_ref` 為 **required input**（= open-strict branch 的 fork point；其 baseline.errorCount 應為 0，即 P3 讀取對象）；(b) `actions/checkout` 用 **`fetch-depth: 0`** 讓 base_ref 可 resolve；(c) 跑 ratchet 前先 `git rev-parse --verify <base_ref>^{commit}`，不可 resolve → **fail-closed（T0）**；(d) step env `RATCHET_BASE_REF: ${{ inputs.base_ref }}` + `RATCHET_ALLOW_BASELINE_RAISE: ${{ inputs.reason }}`；(e) **不依賴** ratchet 的 `origin/main` fallback（line 291-293，fetch 狀態不定 + fork point 未必等於當前 origin/main）。
- 後續 reduce PR **不帶 env**（error-reducing，走正常 ratchet 下降，CI 正常綠）。

### 3.5 durable ledger（Codex Medium 2）

PR-0 同步更新 `docs/governance-exceptions.md`：
- policy 段（line 4）從「manual only / 本 script 未實作 env gate」改為「**locked override model**（env + 5-precondition + 限豁免集）」。
- 每次 open-strict override 留 durable entry：commit / leaf / flag / errorCount 0→N / 被豁免的 failure 列表（逐字）/ reason / governance workflow run id。

### 3.6 Approval Record（Codex High 2 — red 狀態明文 + bounded）

寫入本檔 + 每個 open-strict PR body + memory：
> open strict leaf 期間，`typecheck:ratchet`（經 governance workflow，帶 env）是 gate of record；plain `npm run typecheck` 預期 **RED（≤ baseline）** 直到該 leaf/flag 階梯歸零。此 RED **bounded per leaf**：P3 機械保證同一時間最多一個 strict surface 開著未清零；該階梯清零並 merge（base errorCount 回 0）才能開下一個。

### 3.7 adversarial tests（commit 前實跑 + PR body 貼 receipt；[[feedback_two_gate_defense_in_depth]]）

| # | 場景 | 預期 |
|---|---|---|
| T0 | governance workflow 缺 `base_ref` 或不可 resolve | workflow **fail-closed**（rev-parse step 先擋，不跑到 ratchet `exit 3`） |
| T1 | 開 strict flag、**無 env** | 照常 enforce → `[BASE]/[BASE-B']/[BASE-EBF]/[BASE-D-tsconfig]` fail (exit 1) |
| T2 | 有 env、tsconfigSnapshot **無 strict-family 變更**（P2 fail） | override 不啟用 → fail |
| T3 | 有 env + strict flag、diff **含 source**（P1 fail） | override 不啟用 → fail |
| T4 | 有 env + 合法單 leaf strict flag + 全 precondition 過 | override 啟用 → ratchet OK + log 含 leaf/count/baseRef |
| T5 | 有 env + 合法、但 base baseline.errorCount **!= 0**（P3 fail，前一 leaf 未清零） | fail（擋同時開兩 leaf） |
| T6 | 有 env + 合法、但 errorsByFile 含**非 changed-leaf path**（P5 fail） | fail |
| T7 | 有 env + strict flag 方向 **true→false**（P2 方向 fail，弱化） | fail |
| T8 | 有 env + 合法、但 branch baseline.errorCount **!= current**（P4 灌水） | fail |

## 4. tests preflight script（Codex Medium 1 + Low/Medium）

開 tests strict **前**強制跑、輸出 4 count、`exit 0` 僅當 `functions==0 && forensic==0`，PR body 貼 receipt：
- 新增 `scripts/strict-tests-preflight.mjs`（同 PR 加進 `NEW_JS_ALLOWLIST` + post-commit 復跑 ratchet 驗；[[feedback_ratchet_new_js_allowlist_post_commit]]）。
- log `total / functions / forensic / tests-only` 四 count（Codex 與我實測 2485/1293/14/1178 一致）。
- **不用 `grep -c` pipeline**：`grep -c` 在 count=0 時 exit 1（無 match）→ 會讓 gate 誤判；且 Windows shell ergonomics 差。改 .mjs 解析 tsc 輸出。
- 機械意義 = P5 對 tests leaf 的前置保證（functions/** 在 tests config 內已 0，故開 tests strict 後 errorsByFile 只剩 `tests/`）。

## 5. 補洞紀律 + hot-zone taxonomy（每個 reduce PR 強制）

通則：
- **0 runtime 變更**（pure-annotation PR）：只 type annotation / narrowing；禁 `any`/`as any`/`@ts-nocheck`/`@ts-ignore`/無 reason `@ts-expect-error`（ratchet 規則 C）；補洞用 `unknown` / `Record<string, unknown>` / 既有 `Env`，不發明新名。
- `.ts` 不讀 JSDoc（[[feedback_ts_no_jsdoc_in_ts_mode]]）→ 一律 inline TS。
- reduce PR 收尾 `baseline:update` 降數；報告數字前先 `git add`（[[feedback_ratchet_report_after_git_add]]）。

**hot-zone taxonomy（Codex Medium 2 + Low；auth/payment/audit/oauth/session/webhook）**：
- **type-only（pure-annotation PR 可含）**：annotation、`as T` cast、`!` non-null、**type-predicate signature**（`(v): v is X`）。
  - hot-zone 的每個 `as T` / `!` **必須註明所依賴的 invariant 或 validator**（為何此處保證該型別）——cast/`!` runtime-erased 但會掩蓋 boundary bug（[[feedback_security_boundary_pr_first_do_no_harm]] + CLAUDE.md 註解規則）。
- **runtime-narrowing（獨立 PR + focused integration test）**：新增 `if`/`instanceof`/短路改值改 control flow、**type-predicate 的 implementation 邏輯**。test 須在 pre-fix 真 fail（[[feedback_regression_test_must_lock_exact_failure]]）。
- 真實可能 null 且原 code 沒處理 = **pre-existing bug，不順手修**，標 TECH-DEBT 或獨立 PR。不無腦全 `!`（否則 strictNullChecks 價值歸零）。

## 6. 分段 PR 序列（per-flag ladder；A locked override）

**PR-0｜治理（熱區：改 ratchet Tier-0 gate，必 codex chain）**
- ratchet 加 locked override（§3.2–3.4 豁免集 + 5 precondition + log）。
- 新增 `.github/workflows/strict-leaf-governance.yml`（§3.4；required `base_ref` input + `fetch-depth:0` + rev-parse 驗證 fail-closed）。
- 新增 `scripts/strict-tests-preflight.mjs`（§4）+ NEW_JS_ALLOWLIST。
- 更新 `docs/governance-exceptions.md` policy（§3.5）。
- 跑 §3.7 T0–T8 adversarial（含 T0 base_ref fail-closed receipt），PR body 貼 receipt。**無任何 leaf 開 strict**（純機制）。

**順序正確性（已驗）**：tests leaf 與 functions leaf 用完全相同 lib/types（`WebWorker` + `@cloudflare/vitest-pool-workers`），functions 修乾淨後 tests leaf 對 functions/** 0 新 error（§6.1 紀律）；scripts 的 `forensic.mjs` 也被 tests include，scripts 先清則 tests 受益。**functions→scripts→tests→browser 採納。**

每個 leaf 走 per-flag ladder（each flag 一個 open-strict override PR + 多個 reduce PR）：

| Leaf | flag 階梯 | 估 reduce PR |
|---|---|---|
| functions (~1,293) | ① `noImplicitAny`（~1,150 純 annotation）→ 清零｜② `strict:true`（~140 strictNull/catch，hot-zone 拆 PR）→ 清零 | 10–15 |
| scripts (~49) | ① `noImplicitAny`（~40，含 `.js` infra checkJs 補洞）→ 清零｜② `strict:true`（~9 catch）→ 清零 | 1–2 |
| tests (~1,178) | **先跑 §4 preflight（必 0）** → ① `noImplicitAny` → ② `strict:true`（[[feedback_ts_test_strict_surface_pattern]] A/B/C/D 四類） | 6–10 |
| browser-typecheck (~1,088) | ① `noImplicitAny`（~743）→ ② `strict:true`（strictNull ~285，hot-zone：dashboard 走 Plan A [[feedback_plan_a_single_pr_for_large_high_risk_file]]、erp-3d Three.js） | 10–15 |

**PR-終｜接線（Codex Low）**：4 leaf 全 0 → ratchet 鎖 zero-error（baseline 永鎖 0）。wiring：**CI 新增 plain `npm run typecheck` step**（canonical zero-error gate，與 `typecheck:ratchet` 並存 = 雙 gate）+ **`npm run build` 串入 `npm run typecheck`**（路線圖原意；deploy 不跑 build 不影響部署）。預設兩者都加，PR-終 owner 最終確認。

總估 **30–50 PR**（含 PR-0 + per-flag override PRs + reduce PRs + PR-終）。

## 7. 風險 / Claude 自審（對抗式，一輪 0 新發現）

1. **override = 永久後門** → 5-precondition「以歸因證明」+ no-source + 單 leaf 方向限定 + log + durable ledger + T0–T8 adversarial；豁免限 5 條 base-derived。最高 review 點。
2. **operational deadlock**（CI 不帶 env）→ §3.4 專用 governance workflow + 明文 red-CI Approval Record 解。**`workflow_dispatch` 非 PR event 缺 base ref → ratchet `exit 3`（F8-CI）**：required `base_ref` input + `RATCHET_BASE_REF=inputs.base_ref` + `fetch-depth:0` + rev-parse 驗證 + T0 fail-closed，不依賴 origin/main fallback。
3. **同時開多 leaf** → P3（base errorCount==0）+ P5（errorsByFile 歸屬）機械 enforce。
4. **tests leaf 非 standalone**（include functions/**）→ §4 preflight script gate（exit-code 正確、非 grep -c）。
5. **hot-zone 型別補洞無聲改 runtime** → annotation/runtime 拆 PR + cast/`!` 註明 invariant + integration test。
6. **per-flag ladder 增 override 次數**（per leaf 2 次、共 ~8 次）→ locked override 後每次都過 5-precondition + T0–T8 adversarial，安全可接受；換取 red 更小段 + PR 更同質。

## 8. 下一步（四檢查點）

1. v3.1 doc 新 commit 到 `stage7-strict-plan` 分支 → owner 拿 diff 給 **Codex 審 plan v3.1**（v3 唯一 blocker = governance workflow base ref，已補）。
2. Codex Approve → 開 **PR-0**（locked override + governance workflow + preflight script + ledger，走完整四檢查點 + codex chain）。
3. PR-0 merged → 依 §6 per-flag ladder 逐 leaf/flag 推進，每個 open-strict 走 governance workflow（帶 base_ref + reason）+ durable ledger，每個 reduce PR 守 §5 補洞紀律。
