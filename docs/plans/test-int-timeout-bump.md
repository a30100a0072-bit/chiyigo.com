# test-infra: integration-suite `testTimeout` 5s → 20s（load-induced flaky fix）

**目標**：`vitest.workers.config.js` 的 integration test 加 `testTimeout: 20_000`（vitest 預設 5000ms 對 singleWorker + D1-local 的 int suite 太緊）。修掉 PR-2bb 期間浮現的 load-induced flaky timeout。純 test-infra config，**零 functions/ 改動、零 prod/runtime/security 面**。

> **來歷**：PR-2bb（cors.ts，`9c4d7218`）本機 `test:int` 滿載全量跑時，`tests/integration/credential-disposition.test.ts` 的 wallet-DTO case 撞 5000ms timeout 假紅（isolated 22/22 綠）。診斷＝該 case 本質 ~3.5s（heavy：full `runDisposition` + `signJwt` crypto + `walletList`→`_middleware`），在 `singleWorker: true` + `isolatedStorage: false`（全 int 串跑同一 workerd isolate、共用 D1-local）的累積負載下越過 5s。**非測試 bug、非 cors.ts 改動所致**（type-only、build:functions 證 runtime byte-identical）。

> **scope framing**：純抬「per-test 失敗上限」，不改任何測試行為 / 不縮短任何測試 / 不碰測試本體 / 不碰 unit config（`vitest.config.js`）。timeout 是**上限非延遲** → passing test 跑多快還多快、**零 CI 時間影響**。

> **Gate 紀錄（Dual Gate Workflow v3，[[feedback_codex_review_workflow]]；owner 裁定走完整 3 道）**：當前 state = **`CODEX_PLAN_APPROVED`**（@ `ff6bed3d`；待 owner 明示 `CODING_ALLOWED`；未 merge、未開 PR）。
> - 2026-06-16 owner 裁示「B＝走完整 Dual Gate」（即使 zero-risk test config 也照 Hard Rule 跑滿 3 道）= **SPEC_APPROVED**。spec：`vitest.workers.config.js` 加 `testTimeout: 20_000` + why-comment；Non-goals = 不碰測試本體 / 不碰 `vitest.config.js`（unit）/ 不動 `singleWorker`·`isolatedStorage`·miniflare bindings / 不加 `hookTimeout`（無 hook timeout 失敗）/ 不優化 slow test setup。
> - 2026-06-16 **A1 spike 已執行並達標**（見 §Spike 實證），working tree 已 revert clean（HEAD `9c4d7218`）。
> - 2026-06-16 Claude plan 自審到零（`PLAN_SELF_REVIEW_CLEAN`，單 agent 對抗式，L1）：見 §流程定位 自審紀錄。
> - **級別研判 = L1**（純測試 config 一行 + 註解；TS 無關、prod/runtime/security 無關；rollback = 單行 revert）。L1 仍走完整 3 道基本外部審查（owner 裁定）；self-review 單 agent。
> - 2026-06-16 **ChatGPT Architecture Gate：`CHATGPT_ARCH_APPROVED`（@ `29220916`）** — 0 blocker。OD-1/2/3 全裁＝建議版（`20_000` / config-global / 不加 `hookTimeout`）→ frozen diff 不變。架構 lock：僅 `vitest.workers.config.js`、僅加 `testTimeout: 20_000` + 註解；禁改測試本體 / unit config / `functions/**` / migration / runtime / `singleWorker` / `isolatedStorage` / `hookTimeout`。驗證要求：`test:int` 全量 1328 green / ratchet 869 不變 / lint / `test:cov`（CI 順序）/ `git diff --check` / diff scope review。
> - 2026-06-16 **Codex Plan Gate：`CODEX_PLAN_APPROVED`（@ `ff6bed3d`）** — 0 blocker / 0 critical risk。Codex read-only（未跑 tsc/test/lint）。對帳：`ff6bed3d` 僅更新 plan doc gate trail（+3/−2）；現行 `vitest.workers.config.js` 無 explicit testTimeout、保留 include/singleWorker/isolatedStorage；frozen 面僅 1 檔 +5/−0（`testTimeout: 20_000` + 註解）；驗證計劃含 test:int/ratchet 869/lint/test:cov/git diff --check。state consistency·queue·payment·distributed·observability 標 N/A（純改 vitest per-test timeout）。**只批 plan gate，非 coding approval**。
> - **MERGE：待 owner 明示點頭**。未到位前不 push / 不開 PR / 不 merge / 不動 main。

## 風險聲明（誠實定位）

- **這不是 prod/security 邊界**：`vitest.workers.config.js` 只在本機 / CI 跑測試時被 vitest 讀，**不進 Pages Functions bundle、不影響 runtime / prod / 任何使用者面**。改它的最壞情況 = 測試門檻不當（太鬆遮蔽 hang / 太緊仍 flaky），不會傷 prod。
- **唯一實質風險 = timeout 太鬆遮蔽真 hang**：mitigation = 20s 仍是有限上限（真 hang 會在 20s fail，只是較 5s 晚），且 20s ≈ 觀測到最慢 int 檔（credential-disposition 10.07s）的 ~2×、最慢單 case 的 3–4×——足夠 headroom 又不致把多分鐘級 hang 養成綠。
- **不改測試語意**：純抬上限,所有斷言 / setup / 行為一字不動。

## Coding 階段硬性邊界

- **允許（= §Spike frozen diff，1 檔 +5/−0）**：`vitest.workers.config.js` 的 `test` 區塊加 `testTimeout: 20_000` + 4 行 why-comment。
- **禁止**：改測試本體（`tests/**`）/ 改 `vitest.config.js`（unit lane）/ 動 `singleWorker`·`isolatedStorage`·`include`·miniflare `compatibilityDate`·`bindings` / 加 `hookTimeout` 或其他 config key / 改 functions/。

## Scout

### root cause（已實證）
- `vitest.workers.config.js` 現**無顯式 `testTimeout`** → 吃 vitest 預設 **5000ms**（已讀檔確認，line 4 `test: {` 下無此 key）。
- `singleWorker: true` + `isolatedStorage: false`（line 10-11）→ 全 75 個 int 檔在同一 workerd isolate 串跑、共用 D1-local，後段檔累積負載偏慢。
- credential-disposition 是**最慢 int 檔（10.07s / 22 tests）**；其 wallet-DTO case（`run()` full disposition + `signJwt` + `walletList`→middleware）~3.5s isolated，滿載越過 5s → per-test timeout 假紅。框架固有開銷（miniflare D1-local 每 query 延遲 + crypto），非測試可優化點。

### 為何 config-global 而非 per-test bump
- 問題系統性（整個 int suite 在 singleWorker 下偏慢；credential-disposition 只是先中槍的最慢檔，audit-archive 8.4s / migrations 7.2s / callback 7.0s 緊隨）→ 全域抬一次防未來 whack-a-mole。
- per-test `it(…, { timeout })` 或 per-file 只解一個點，下次另一檔在更重負載下又會撞。
- config 改動集中、單一 revert 可回退。

### 為何 20s
- 觀測：最慢 int **檔** 10.07s、最慢單 **case** < 10s（檔總和上界）、出事 case isolated 3.5s / 滿載 >5s（被 5s 砍）。
- 20s = 5s 預設的 4×、最慢檔的 ~2×、最慢單 case 的 3–4× → 充足 headroom；又遠小於「多分鐘級」真 hang，不遮蔽。

## Open Decisions（prose 裁決，[[feedback_gate1_forks_prose_ruling]]）

- **OD-1：timeout 值** — 主方案 **20_000**（建議）vs 15_000（較緊、出事 case 滿載 >5s 但真值未知、裕度可能不足）vs 30_000（更鬆、略增遮蔽 hang 風險）。建議 20s（上述 §為何 20s）；Arch 可改裁,以新值為凍結基準。
- **OD-2：作用域** — 主方案 **config-global（workers config `test.testTimeout`）**（建議，系統性、防 whack-a-mole）vs per-file/per-test bump（窄、易復發）。建議 global；Arch 偏好窄解則改裁。
- **OD-3：是否一併加 `hookTimeout`** — 主方案 **不加**（建議）。觀測到的失敗是 test-body timeout（`Test timed out in 5000ms`），非 hook；vitest `hookTimeout` 預設 10000ms（>testTimeout 5000ms）且 `beforeEach resetDb` 未報 hook timeout。無 error 驅動 → 不動（最小 diff）。若 Arch 認為 resetDb 在重負載下也該保險可改裁。

**考慮過、否決**：
- 優化 credential-disposition setup（減 row / 共用 seed）：省的是測試自身 ms，但耗時主體是 miniflare D1-local 框架開銷,優化不到根；且碰測試本體 = 擴大 scope。否決。
- 提高並行（關 singleWorker）：改 isolation 模型 = 大動作、可能引入 D1-local 共用狀態的測試污染,遠超「修 flaky timeout」scope。否決。

## Spike 實證（A1，2026-06-16，已 revert）

**程序**：套 `testTimeout: 20_000` → 全量 `npm run test:int`（觀測出事 case 滿載真實耗時 + 全綠）→ `RATCHET_BASE_REF=9c4d7218 npm run typecheck:ratchet`（confirm errorCount 不變）→ `npm run lint` → `git diff --check` → `git diff` 凍結 → `git checkout --` revert → 驗 clean。

| 驗收條件 | 結果 |
|---|---|
| 全量 `test:int` 綠 | ✅ **75 files / 1328 tests passed**（494s；exit 0） |
| 出事 case 不再 timeout | ✅ credential-disposition **22/22 綠**（檔總 **10.07s**，全 int 最慢檔；wallet-DTO case 滿載 <20s passed，前為 5s timeout） |
| 20s headroom 足 | ✅ 最慢檔 10.07s = 20s 的 ~2×；最慢單 case <10s = 3–4× headroom |
| errorCount 不受影響 | ✅ ratchet OK，**current 869/235 不變**（config 改動非 TS source error；base `9c4d7218`） |
| lint | ✅ `npm run lint` exit 0（eslint functions tests + compat-date + workflows；config 在 root 不在 lint glob、不破既有） |
| diff 面 | ✅ `git diff --stat` = **1 檔 +5/−0**；`git diff --check` exit 0 |
| revert clean | ✅ revert 後 `git status --porcelain` 僅 `?? CLEANUP_PLAN.md`、HEAD `9c4d7218` |

**Spike frozen diff（= coding 階段唯一允許落地，1 檔 +5/−0；resulting blob `8ee142bc`）**：

```diff
diff --git a/vitest.workers.config.js b/vitest.workers.config.js
index 28073fff..8ee142bc 100644
--- a/vitest.workers.config.js
+++ b/vitest.workers.config.js
@@ -2,6 +2,11 @@ import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

 export default defineWorkersConfig({
   test: {
+    // Integration tests share one workerd isolate (singleWorker) + D1-local storage;
+    // cumulative load pushes later cases past vitest's 5s default testTimeout
+    // (credential-disposition's heaviest case ~3.5s isolated, >5s under the full suite).
+    // 20s = ample headroom under load without masking a genuine hang.
+    testTimeout: 20_000,
     // PR-39 (Stage 4 enabler)：副檔名用 .{js,ts} glob，rename 期不漏 .test.ts
     // 參考 vitest.config.js 同步註解。
     include: ['tests/integration/**/*.test.{js,ts}'],
```

## 預期 ratchet
- current state **869/99/235 不變**（config 改動不產生 TS error；spike ratchet 實測 869/235）。baseline file 天花板 1119/175 不動。

## Runtime 行為不變保證 / Rollback
- `vitest.workers.config.js` 僅測試期被讀,**不進 Pages Functions bundle、零 prod/runtime 面**（無需 build:functions 驗——本檔不影響 bundle；spike 仍可選驗）。
- rollback = 單行 revert（移除 `testTimeout: 20_000` + 註解）；無 migration、無 ambient、無 deploy 差。

## 測試影響面（誠實）
- **改的就是測試 config**：唯一效果＝把 int test 的 per-test 失敗上限 5s→20s。passing test 行為·時間不變。
- spike 全量 `test:int` 1328/1328 證無破壞;不改任何測試斷言/setup。
- unit lane（`vitest.config.js` / `test:cov`）**不受影響**（不同 config 檔）。

## 驗證計劃（coding 階段，`CODING_ALLOWED` 後）
- `npm run test:int` green（全量 1328；觀測 credential-disposition 不再 timeout）。
- `RATCHET_BASE_REF=9c4d7218 npm run typecheck:ratchet` green（869/235、baseline 1119/175 不動）。
- `npm run lint` green。
- `npm run test:cov` green（CI fail-fast 順序對齊;本改不影響 unit lane，但 CI `test` job 先跑 cov，照跑確認）。
- `git diff --check` clean；source diff 逐行 == §Spike frozen diff（1 檔 +5/−0）。
- **硬驗收**：diff 僅 `vitest.workers.config.js`、僅加 `testTimeout` + 註解;無第 2 檔、無其他 config key。

## 流程定位
- Dual Gate Workflow v3：`SPEC_APPROVED`（owner 裁 B）✅ → A1 spike ✅ → **`PLAN_SELF_REVIEW_CLEAN`**（單 agent 對抗式，L1）✅ → 本 doc commit（feature branch `test-int-suite-timeout`）→ **`CHATGPT_ARCH_APPROVED`**（@ `29220916`，0 blocker、OD-1/2/3 全裁）✅ → **`CODEX_PLAN_APPROVED`**（@ `ff6bed3d`，0 blocker/critical）✅ → `CODING_ALLOWED`（owner）〔← 當前待 owner 明示〕→ coding（frozen replay）→ 機械 gates 全綠 → `CODE_SELF_REVIEW_CLEAN` → `CODEX_CODE_APPROVED` → owner 點頭 → squash-merge → `MERGED_MAIN`。
- **Claude plan 自審紀錄（單 agent 對抗式，L1，一輪 0 新發現）**：① root cause 實證（無 testTimeout→5s 預設、singleWorker 累積負載、credential-disposition 最慢檔 10.07s）✅；② 20s 值有據（最慢檔 ~2×、最慢 case 3-4×、遠小於真 hash hang）✅；③ scope 僅 config 一行、不碰測試本體/unit config/isolation 模型 ✅；④ 風險誠實定位（非 prod/security 面、唯一風險=遮蔽 hang 已 mitigate）✅；⑤ ratchet 不受影響（config 非 TS error）spike 證 869 不變 ✅；⑥ OD-1/2/3 留逃生給 Arch ✅。
- **下一刀**：本 PR 與 noImplicitAny chain 獨立;merge 後 chain 續 `strict:true`（functions leaf 已清零）。
