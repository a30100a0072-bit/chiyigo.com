# Stage 7 — PR-1：functions leaf `noImplicitAny` 開 flag（locked override，per-flag ladder rung 1）

> 狀態：**plan 階段**，0 行 code 變更（本檔本身是 plan-gate 標的）。
> Base / fork-point：`c694366`（main，working tree clean，non-strict solution = 0 error，baseline.errorCount=0）。
> 動工分級：**L3**（行使 Tier-0 ratchet 治理機制）＋「治理 + 機械型遷移」，**runtime 0 變更**，不跑 §輸出順序 11 步。
> 上位 plan：`docs/plans/stage7-strict-zero-error.md`（v3.1 Codex plan-gate APPROVED）§3 locked override / §6 per-flag ladder。PR-0 機制已 SHIPPED（main `c694366`，PR #34）。

## 0. 這是什麼 PR（範圍）

本 PR = **functions leaf 的第一個 open-strict override PR**：只把 `tsconfig.functions.json` 的 `noImplicitAny` 由 `false` 翻成 `true`（**`strict` 仍保持 `false`**），同 PR 跑 `typecheck:baseline:update` 收編 current 實測，**不修任何一個 error**。error reduce 由後續 reduce PR 逐批做（上位 plan §5 補洞紀律）。

- **per-flag ladder**：functions leaf 先 `noImplicitAny` → 清零 → 再 `strict:true`。本 PR 是 rung 1 的「開 flag」步。
- **no-source（override P1）**：diff 只含 4 個非 source 檔（§2）。禁任何 `.ts/.js/.mjs/.cjs/.d.ts`。

## 1. 勘查實況（以 code 實測為準，2026-06-08 @ `c694366`）

單顆 leaf 量測（noImplicitAny 強制開、strict 維持關，對齊「真值須雙開個別 flag」紀律）：

```
npx tsc -p tsconfig.functions.json --noImplicitAny --composite false --incremental false --noEmit --pretty false
```

| 指標 | 值 |
|---|---|
| functions `noImplicitAny` error 總數 | **1193** |
| 涉及檔數 | **146** |
| global（無檔）error | **0** |
| 非 `functions/` 路徑 error | **0**（P5 機械保證會過） |

TS code 分佈（全機械型）：

| code | 數 | 意義 |
|---|---|---|
| TS7006 | 657 | Parameter implicitly any（補 `env: Env` / inline annotation） |
| TS7031 | 427 | Binding element implicitly any（destructure 補型別） |
| TS7053 | 36 | element implicitly any（index signature） |
| TS7018 | 26 | object literal implicitly any |
| TS7005 | 15 | variable implicitly any |
| TS7008 | 14 | member implicitly any |
| TS7034 | 8 | variable implicitly any（某些位置） |
| TS7011 | 5 | function expression implicit any return |
| **TS70xx 小計** | **1188** | 純 annotation |
| TS2339 | 4 | property 不存在（`{}`-widening 家族） |
| TS2551 | 1 | 同上 |

> 5 個非 TS70xx（TS2339/TS2551）是 `= {}` / `const o = {}` 在 noImplicitAny 下不 widen 成 `any` 而成 `{}` 的家族（[[feedback_ts_destructure_default_empty_type]]）；仍是 type-only 補洞，由 reduce PR 處理。**本 PR 全數收編，不修。**

熱區檔（top，與上位 plan §1.5e 一致）：`audit-aggregate-archive-runner.ts`(83)、`cron/audit-archive.ts`(73)、`audit-archive.ts`(50)、`audit-aggregate-archive.ts`(36)、`jwt.ts`(35)、`audit-aggregate-archive/retry.ts`(34)、`email.ts`(31)、`payment-vendors/ecpay.ts`(27)、`oauth/[provider]/callback.ts`(27)、`webhooks/payments/[vendor].ts`(19)…（reduce PR：非熱區 utils 先，熱區走 codex chain）。

current 全 solution 狀態（flag OFF，`npm run typecheck:ratchet:report`）：errorCount=0、**cleanFiles=304**、sourceFilesTotal=304。
→ 既有 baseline 的 `cleanFiles:257` 是 `b63d971` 留下的**過期值**（其後新增 47 個 clean source 未收編）。

## 2. 預計改哪些檔（恰 4 個，全非 source）

1. `tsconfig.functions.json` — `compilerOptions.noImplicitAny`：`false → true`（`strict` 不動，維持 `false`）。
2. `types/typecheck-baseline.json` — `npm run typecheck:baseline:update` 重產（§3 預測值）。
3. `docs/governance-exceptions.md` — 加一筆 (B) open-strict override entry（§5）。
4. `docs/plans/stage7-pr1-functions-noimplicitany.md` — 本 plan 檔。

P1 白名單比對（`scripts/lib/ratchet-override.mjs` `isOverrideAllowedPath`）：4 檔全允許（`types/typecheck-baseline.json` / `docs/governance-exceptions.md` / `docs/plans/` 前綴 / 單一 leaf `tsconfig.*.json`）；`SOURCE_EXT_RE` 命中 0。
**全程禁 cache-bust**：`public/*.html` 非白名單會觸發 P1 `strayNonAllowed`；且本 PR 0 個前端 asset 變更，cache-bust 在語意上 N/A（非 skip）。

## 3. post-flip baseline（plan 階段已 verify；code 階段 baseline:update 重寫真值）

| 欄位 | base(`c694366`) | 本 PR（**已 verified**） |
|---|---|---|
| errorCount | 0 | **1193** |
| fileErrors | 0 | 1193 |
| globalErrors | 0 | 0 |
| errorFiles | 0 | **146** |
| cleanFiles | 257（過期） | **158**（= 實 clean 304 − 146 errored） |
| sourceFilesTotal | 257 | 304 |
| tsconfigSnapshot[`tsconfig.functions.json`].compilerOptions.noImplicitAny | (false) | **true** |

> **cleanFiles `257 → 158` 同時吃下兩件事**：(a) 過期 base 257 → 實 clean 304 的刷新；(b) 146 個 functions 檔因 noImplicitAny 落入 error。算式 `304 − 146 = 158` 會在 `[OVERRIDE]` log / ledger 寫清楚，避免「257→158 為何不是 257−146」的疑問。
> **已於 plan 階段 verify（非預測）**：暫 flip flag → `Remove-Item .tscache -Recurse` → `npm run typecheck:ratchet:report`（read-only，0 寫入）實測 = `errorCount 1193 / fileErrors 1193 / globalErrors 0 / errorFiles 146 / cleanFiles 158 / sourceFilesTotal 304`，與 one-shot 完全一致（solution build 用同一份 functions compilerOptions、同一檔集；tests leaf 雖重複 include functions/** 但其 noImplicitAny 仍 false → 0 新 error；noImplicitAny 不改 inferred type → 無跨 leaf cascade）→ 隨即 `git checkout -- tsconfig.functions.json` revert，working tree 只剩本 plan 檔。code 階段 baseline:update 重跑寫真值（P4 要求 baseline==current 自洽）。

## 4. governance / merge path（gate of record）

- **base_ref（fork-point，full SHA）**：`c694366b2dd2d80639c72daf32ccd038893dd3d9`（其 baseline.errorCount=0，符合 P3）。code 階段 push 前再 `git fetch origin main` + `git merge-base HEAD origin/main` 復核（不 rebase → merge-base 恆為 fork point）。
- **合法綠燈** = `.github/workflows/strict-leaf-governance.yml`（`workflow_dispatch`）：inputs `leaf=functions`、`reason=<env value>`、`base_ref=c694366b2dd2d80639c72daf32ccd038893dd3d9`。workflow 先驗 base_ref 為 hex + resolvable + `== merge-base(HEAD,origin/main)`（anti-spoof T0），再帶 `RATCHET_BASE_REF` + `RATCHET_ALLOW_BASELINE_RAISE` 跑 ratchet。
- **一般 ci.yml 的 ratchet step 對本 PR 預期 RED**（不帶 env）= 上位 plan §3.6 Approval Record 的設計內 red、bounded per leaf（P3 保證同時最多一個 strict surface 未清零）。其餘 ci 步驟（lint / unit / int / build:functions）不受影響（0 source 變更）。
- **merge**：owner 在 governance workflow 綠燈後 admin-merge（branch protection 由 owner override）。**squash-merge 前等 owner 確認**——outward-facing：push main 觸發 Pages auto-deploy，但本 PR 0 asset / 0 functions source 變更 → deploy 為**內容 no-op**（deploy.yml 不跑 typecheck/build）。無 migration、無 D1 變更，[[feedback_migration_before_merge_autodeploy]] 不適用。

## 5. `docs/governance-exceptions.md` ledger entry（草稿；(B) open-strict override，§3.5 格式）

欄位：觸發 commit / leaf=`functions` / flag=`noImplicitAny` / governance workflow run id（code 階段 dispatch 後補）/ `errorCount 0→1193`、`cleanFiles 257→158`（附 `304−146=158` 註）/ 被豁免 failure 列表（**逐字**，code 階段從 no-env ratchet run 貼）/ reason（= env value）。

reason 草案：
```
Stage 7 PR-1: open functions leaf noImplicitAny (per-flag ladder rung 1; strict stays false); baseline errorCount 0->1193 / cleanFiles ->158; reduce PRs follow
```

預期被豁免的 5 條 base-derived（逐字於 code 階段 capture）：
- `[BASE] baseline.errorCount 被同 PR 削弱：0 → 1193 …`
- `[BASE] baseline.cleanFiles 被同 PR 削弱：257 → 158`
- `[BASE-B'] 新增 error 檔（base ref baseline 無對應…）：<146 檔>`
- `[BASE-EBF] branch baseline.errorsByFile 新增 <file> (count=N) …`（×146）
- `[BASE-D-tsconfig] tsconfig.functions.json compilerOptions.noImplicitAny 變更：false → true …`

ledger 記錄法：`[BASE-B']`（單行列 146 檔）+ `[BASE-EBF]`（146 行）量大 → ledger 記**distinct 失敗類別逐字** + 重複類標 `×146` + 指向 `types/typecheck-baseline.json` 的 `errorsByFile`（已 committed，146 檔可重建），不貼滿 146 行。

（branch-local `[A]/[B]/[B']/[B'']/[SCHEMA]/[D-tsconfig]/[C]/[D/E]` 全不觸發 = 機制設計，非豁免；見 §6 對照。）

## 6. Code 階段 adversarial 自審（commit 前實跑 + PR body 貼 receipt；對齊上位 plan §3.7）

- **T1（無 env → 照常 enforce）**：`npm run typecheck:ratchet`（不帶 env）→ 期望 **RED**，且 failure 全集 ⊆ §5 那 5 條 base-derived（逐字 capture 進 ledger / PR body；確認沒有任何 branch-local 規則誤觸發）。
- **T4（env + 合法單 leaf flag + 全 precondition）**：
  ```
  RATCHET_BASE_REF=c694366b2dd2d80639c72daf32ccd038893dd3d9 \
  RATCHET_ALLOW_BASELINE_RAISE="<reason>" npm run typecheck:ratchet
  ```
  → 期望 **GREEN** + `[OVERRIDE] leaf=functions flag=noImplicitAny errorCount 0→1193 cleanFiles 257→158 baseRef=c694366… reason=…`。
- precondition 逐條人工核對（並由 T4 綠燈機械證明）：
  - **P1** no-source：`git diff c694366...HEAD --name-only` 只 4 檔，0 個 source ext。
  - **P2** 單 leaf strict-family：snapshot diff（base live read vs current）恰 `tsconfig.functions.json` 的 `noImplicitAny` `false→true`，無其他 key / include / references。
  - **P3** base errorCount==0：`c694366` baseline.errorCount=0。
  - **P4** baseline==current：baseline:update 寫 current 快照 → 全 derived 欄位相等。
  - **P5** errorsByFile ⊆ `functions/`：§1 實測 0 非 functions 路徑。
- override unit test 不回歸：`npx vitest run`（`scripts/lib/ratchet-override.mjs` 對應 test）。
- **runtime test N/A**：0 source 變更 → 行為不可能改；不跑 full int/unit（報告會明列「N/A，本 PR 0 source」）。仍跑 `npm run lint`（eslint functions tests，0 變更 → 綠）作 sanity。

## 7. 風險 / open forks（請 owner / Codex 裁）

1. **stale cleanFiles 與 flag flip 併在同一 override（Option A，本 plan 採）vs 拆兩 PR（Option B）**
   - **A**（owner 指示「順帶收編過期 cleanFiles」）：單 PR，cleanFiles 257→158，`[OVERRIDE]` log 用算式註明。機械健全（P1–P5 全過、`[BASE] cleanFiles` 屬豁免集）。
   - **B**：先一個「純刷新 cleanFiles 257→304」maintenance PR（errorCount 仍 0、無 flag、normal ratchet 綠、**無 override / 無 governance workflow**），再 flip（304→158，override 歸因更乾淨：`304−146=158` 直觀）。代價多一個 PR。
   - 預設 **A**（依指示）；列此 fork 讓 owner 決定。
2. **ledger run id / squash commit SHA 的時點**：兩者皆 post-dispatch / post-merge 才知。建議 entry 先寫 leaf/flag/數字/豁免列/reason，**run id 於 governance workflow dispatch 綠後、squash-merge 前**補上（branch 上多一筆 commit）；最終 commit SHA 以 PR#＋merge 後補註處理。請 owner 裁時點。
3. **ci.yml red 的可見性**：PR body 必置頂聲明「ratchet step red = 設計內，gate of record 為 governance workflow run #<id>」，避免後人誤判 CI 壞。

## 8. 本 PR 不做

- 不修任何 error（1193 全收編）。
- 不開 `strict:true`（下一階梯）。
- 不動其他 3 個 leaf（scripts / tests / browser-typecheck）。
- 不 cache-bust（0 asset 變更 + P1 禁）。
- 不碰任何 `.ts/.js/.mjs/.cjs/.d.ts`。
