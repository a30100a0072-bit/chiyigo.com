# chiyigo.com — Claude Code 專案憲法（always-on 脊椎）

**版本**：v3.1 ｜ **狀態：生效**（landed to main 2026-06-17；Codex Code Gate ✅ `CODEX_CODE_APPROVED`；生效規則見 §9）。

> 本檔是 always-on 專案執行憲法。**SoT 地位僅限**：最高權限（§1）、chiyigo 專屬硬規則（§2）、路徑索引（§7）、更新規則（§9）。
> Dual Gate 流程全文、架構契約/ADR、領域標準等**仍以 §8 指向的各自 SoT 為準**。
> 本檔與其指向的 SoT 衝突 → **先停手回報，不自行選邊**。治理架構決策/理由/階段見 memory `project_governance_architecture`。

## 0. 開工前（按需，非每次全讀）
1. 判動工級別 L1/L2/L3（沿全域 §動工分級）；不明 → 問 owner。
2. **會 commit 進 repo** → 依 Dual Gate（§3）；流程細節不確定時讀 SoT memory `feedback_codex_review_workflow`。
3. 觸架構/契約/token/tenant → 讀 `docs/GOVERNANCE.md` → chiyigo-core（pin v0.1.4）。
4. 平行 session → 唯讀優先（§6）。
> 原則：讀**與本任務相關**的 SoT，不必每次全讀；**不確定 → 回 SoT，別憑記憶辦事**。

## 1. 最高權限（衝突裁決序，高→低，跨層高者必勝）
1. **Tier 0**（安全/隔離/正確/穩定）＋ **硬約束**（$0 / Cloudflare-first / no vendor lock-in）— 絕對，永不交換。
2. **chiyigo-core binding SSOT**（架構不變量/契約/ADR，pin v0.1.4）— 架構衝突以它為準。
3. **chiyigo.com 專案規則**（本檔 ＋ memory Dual Gate v3.1）— 只加嚴全域，不放寬。
4. **全域 `~/.claude/CLAUDE.md` baseline** — 地板。
- 任兩層衝突且無法同時滿足 → **停手、上報、禁靜默選一邊**。

## 2. 不可變硬規則（chiyigo 專屬，禁漂移；其餘見全域 Tier 0 + core 不變量）
- **禁**直推 main、force push 共享 branch、`--no-verify`、空 commit、amend（開新 commit）。唯一進 main＝squash-merge。
- 所有 repo 改動由 **Claude 執行**；ChatGPT/Codex 只審不改；沒「Approve」＝沒過，禁自我宣告。
- 任何進 repo 改動（就算一行）一律走 **4 道**基本外部審查（§3），無 standing 例外。
- secret 禁 hardcode / 禁進對話 stdout（混合 secret 檔走 count/shape/prefix 三段式）。
- scope creep ＝ Gate fail（停手回 PLAN_DRAFT）。

## 3. Dual Gate v3.1（薄錨點；完整見 SoT memory `feedback_codex_review_workflow`）
- **4 道外部審查**（任何級別 L1/L2/L3 全走、皆 12 states）：
  - Plan：① ChatGPT Architecture → ② Codex Plan
  - Code：③ Codex Code → ④ ChatGPT 方向對齊/faithfulness
- **通則**：任何更改（首次 + 每輪修 gate 回饋）→ 對抗式 self-review 至「一輪 0 新發現」→ commit → 報告 → 才送外部。
- **級別只決定 self-review 形式**：L1＝單 agent 對抗式；L2/L3＝multi-agent workflow（維度 A）；L2/L3 回應外部的**小修正**（不觸架構/單檔局部）用單 agent，達 L2/L3 規模才重跑 workflow。
- 流程：Spec → Plan Gate → Code Gate → squash。中文報告固定 6 欄、開頭標 gate-state。

## 4. 進 main 紀律
- merge 前跑齊 CI 對應 local gates（對齊 `.github/workflows/ci.yml`，最常漏 `test:cov`）：`lint` · `typecheck:ratchet` · `verify:browser-pipeline` · `test:cov` · `test:int` · `build:functions` · `npm audit --omit=dev --audit-level=high`。
- 機械 gate 直接跑命令讀真實輸出，不靠 agent 推理。
- 含 D1 migration（push-main 自動部署）：**禁單次 deploy 同改 schema+code**；走 expand→migrate→contract（additive migration → apply+verify prod D1 → code 才讀新 schema）。單 PR 須在 PLAN 證明 backward-compatible fallback、部署順序、rollback、prod verify。完整見全域 §資料庫要求 + memory `feedback_migration_before_merge_autodeploy`。

## 5. 範圍邊界（哪些「不」走 Dual Gate）
- **memory / 對話回應**：流程範圍外，直接寫。但 **memory-import rule**：影響 repo 實作的 memory-only 決策，coding 前必 import 進 SPEC/PLAN 進 Plan Gate。
- **純唯讀調查/盤點**：無 commit，不觸發。
- **repo 內文件**（`docs/`、README、本檔、`GOVERNANCE.md`、`.claude/rules/*`）：⚠️ **仍走完整流程**。
- **唯一繞過**＝owner **當輪明示**：逐次、不跨輪繼承；Claude 不主動提議。

## 6. 平行 session / git 紀律
- 多 session 並行常見；非當前任務 → 唯讀優先，不 `git add`/commit/checkout/切 branch。
- 要 stage 就**明確 stage 該 task 的檔**（禁 `git add .`/`-A`），stage 後立刻 commit。
- Windows LF/CRLF churn 不進 PR（`.gitattributes` 已根治；挑檔 add）。

## 7. 路徑索引（東西放哪；一列一 concern）
| concern | 家（SoT） | 載入 | 狀態 |
|---|---|---|---|
| 最高權限/硬規則/路徑索引/更新規則 | root `CLAUDE.md`（本檔） | always-on | active |
| Dual Gate 流程全文 | memory `feedback_codex_review_workflow` | recall + 本檔錨點 | active |
| 架構不變量/契約/ADR | `docs/GOVERNANCE.md` → chiyigo-core pin v0.1.4 | on-demand | active |
| 跨專案 baseline | `~/.claude/CLAUDE.md` | always-on(user) | active |
| 工程教訓/專案狀態 | memory `feedback_*` / `project_*` + `MEMORY.md` | recall / index | active |
| 領域標準 payments/auth/migration | `.claude/rules/<domain>.md` | lazy by path | planned Phase 2 |
| CI/部署/cron | `.github/workflows/*` | 執行層 | active |

## 8. SoT 指標（本檔不複製內容；衝突以 SoT 為準）
- 協作流程：memory `feedback_codex_review_workflow`（v3.1）
- 架構規則：`docs/GOVERNANCE.md` → chiyigo-core（pin v0.1.4）
- 治理架構/理由/階段：memory `project_governance_architecture`
- 全域 baseline（更寬）：`~/.claude/CLAUDE.md`（本專案只加嚴）

## 9. 更新規則（治理本身怎麼改）
- **本檔自我修訂**：修改本檔時，審查與執行一律依「**修改前已生效**版本」；新版 **merge 進 main 後才生效**，草稿不得自我授權。
- 改 core 規則 → ADR + review + bump pin。
- 改 Dual Gate / memory SoT → memory 可直接改，但須 owner 明示 + dated amendment + 同步 `MEMORY.md` + 歷史標 superseded。
- 改本檔 / `.claude/rules`（repo 檔）→ 走完整 Dual Gate。
- 通則：只更新單一 SoT、其餘指標同步、dated + 理由、不竄改歷史。
