# Plan：維度 A self-review workflows（plan-self-review + code-self-review）

> v3 Dual Gate Workflow 第一案。實作 v3 §5 維度 A（multi-agent workflow self-review）的兩支可執行腳本。
> 狀態：`PLAN_DRAFT` → 送 ChatGPT Architecture Gate。分級：**L2**。

## 0. 錨點與裁決（不可漂移）

- **SPEC_APPROVED**：owner 2026-06-14。Scope/Non-goals/Acceptance 見 §1。
- **OD 裁決**：
  - OD-1 = **A**（腳本進 `.claude/workflows/`，改 `.gitignore` 只 allowlist 該子目錄；禁 user 層、禁 un-ignore 整個 `.claude/`、禁追蹤 `settings.local.json`/lock）。
  - OD-2 = 自訂 code-review 腳本；`/code-review ultra` 僅補充，不作主流程依賴。
  - OD-3 = L2。OD-4 = 可執行腳本（非設計稿）。
- **Bootstrapping 紀律**：本 PR 製作「維度 A 工具」本身，工具尚不存在 → **本 PR 的維度 A self-review（plan + code 兩階段）皆退化為單 agent 對抗式自審**（明說、非偷跳；自審 F6）。同理本 PR 進 Code Gate 時，維度 A code self-review 退單 agent、ChatGPT faithfulness 複核包**手動產**（code-self-review.mjs 尚未 merge/驗證）。

## 1. Scope / Non-goals / Acceptance Criteria

**Scope**：
1. `.claude/workflows/plan-self-review.mjs` — 7 finder 各攻 Plan checklist 一維 → 對抗 verify（預設 refuted）→ 結構化輸出供主線裁決。
2. `.claude/workflows/code-self-review.mjs` — 語意維 fan-out（race/idempotency/tenant 漏裸 query/async 邊界/contract·enum/命名 SSOT/regression 鎖 exact failure）→ 對抗 verify → **產 v3 §6 faithfulness 複核包**。
3. `.gitignore` 最小修正（allowlist `.claude/workflows/`）。
4. `scripts/typecheck-ratchet.mjs` 的 `NEW_JS_ALLOWLIST` 加兩條（解 Critical blocker）。
5. 本 plan doc。

**Non-goals**：不取代外部 gate（只產 self-review findings 進報告第 4 欄）；不做機械層（typecheck/lint/test 仍跑命令）；不自動執行（opt-in，主線先報可喊停）；不碰 chiyigo production code（`functions/`、`src/`、`migrations/`）；不引入 npm 套件。

**Acceptance Criteria**（含 owner 補充 4 條）：
- AC1：輸出 deterministic — 至少含 machine-readable JSON（schema-validated）+ 可貼用中文摘要。**「deterministic」定義＝輸出 shape/schema 固定（非 LLM 內容 bit-identical；LLM 本質非確定，這是誠實邊界）。**
- AC2：腳本 read-only — 不呼叫外部網路、不讀 secrets、不修改 repo 檔案。達成見 §4.3。
- AC3：每條 finding 含 `evidence_path` / `ref`（line 或 hunk）/ `severity` / `recommendation` / `status`(candidate|refuted|accepted)。
- AC4：code-self-review 產的複核包符合 v3 §6 七項（錨點 / scope 對照 / 機械 git artifacts / 決策點完整 hunks / 偏離 plan·OD / 維度 A findings / 明確提問）。
- AC5：兩支腳本可被 Workflow 工具 `name` 或 `scriptPath` 載入；符合 Workflow 腳本約束（`meta` 純 literal、`agent()/pipeline()/parallel()`、無 `Date.now`/`Math.random`、純 JS）。**（自審 F1）`name` 解析 project 層 `.claude/workflows/` 的行為待 dry-run 驗證；`scriptPath` 絕對路徑為保證 fallback。**

## 2. 檔案改動清單

| 檔案 | 動作 | 性質 |
|---|---|---|
| `.claude/workflows/plan-self-review.mjs` | 新增 | workflow 腳本 |
| `.claude/workflows/code-self-review.mjs` | 新增 | workflow 腳本 |
| `.gitignore` | 改（L6） | config（owner 已定規則） |
| `scripts/typecheck-ratchet.mjs` | 改（`NEW_JS_ALLOWLIST` +2） | governance config |
| `docs/reviews/dimension-a-self-review-workflows-plan-2026-06-14.md` | 新增 | 本 plan doc |
| `scripts/lint-workflows.mjs`（**OD-A 待裁**） | 可能新增 | 靜態檢查（見 §8） |

## 3. 共用設計

### 3.1 finding schema（agent `schema` option 強制結構化；滿足 AC1/AC3）
```
FINDING = {
  dimension: string,                       // 哪一維 finder
  title: string,
  evidence_path: string,                   // 檔案路徑
  ref: string,                             // file:line 或完整 hunk / artifact reference（對齊 v3 §6 Codex r2 nit）
  severity: 'tier0'|'tier1'|'tier2'|'tier3',  // 對齊 CLAUDE.md 核心優先級
  mechanism: string,                       // 具體違反機制（禁泛泛臆測）
  recommendation: string,
  status: 'candidate'|'refuted'|'accepted',// finder 產 candidate；verify 後改 refuted/accepted
  verdict_note: string                     // verify 裁決理由（refuted/accepted 必填）
}
FINDINGS_RESULT = { dimension: string, findings: FINDING[] }
```

### 3.2 severity 標度
`tier0`–`tier3` 對齊 CLAUDE.md 核心優先級（tier0=安全/隔離/正確/穩定；tier1=長期健康；tier2=工程權衡；tier3=表面）。

### 3.3 read-only 達成（AC2）— 縱深防禦
1. **腳本層天然 read-only**：Workflow 腳本沙箱「No filesystem or Node.js API access」→ 腳本本體無法改檔/聯網。
2. **subagent 層結構擋寫**：finder/verifier/collector 全用 `agentType: 'Explore'`（工具集排除 `Edit`/`Write`/`NotebookEdit`）→ 結構性無法改檔。
3. **prompt 硬性約束**：每個 agent prompt 明令「**唯讀**：只用 `Read`/`Grep`/`Glob` + 唯讀 git（`git diff`/`log`/`show`/`check-ignore`）；**禁** `WebFetch`/`WebSearch`/任何網路、**禁** Bash 寫操作（`git add`/`commit`/`rm`/`>` 重導向/`curl`）、**禁**讀 secrets（`.dev.vars`/`.env*`/`.canary-*`）」。
4. **誠實殘留**：Explore 仍持有 `Bash`/`WebFetch`/`WebSearch`（理論逃生口；Bash 為 git collector 必需故不可全禁）。**Mitigation**：(2)(3) 雙鎖 + 任務本質不需要寫/網路 + **主線複查（自審 F2）：若 finding 的 `evidence_path` 顯示來自網路或 repo 外來源，一律 reject 該 finding 並視為 read-only 違規告警**（detection 補償 prompt-level 無法硬擋的網路逃生口）。**prompt-level 約束非 100% 硬保證 → 列為已知殘留**（§10）。

### 3.4 determinism（AC1）
腳本層無 `Date.now()`/`Math.random()`/argless `new Date()`（Workflow 約束，否則 throw）。輸出經 `schema` option 強制 schema-validated JSON。**deterministic = 輸出 shape 固定，非 LLM 內容 bit-identical**（誠實邊界，寫進報告）。

### 3.5 結果回傳 + 中文摘要（AC1；自審 F4）
結構化結果經 `log()` 以 **machine-readable JSON 形式輸出到 task output**（+ 中文報告可貼用摘要：findings 表 + 嚴重度統計），主線從 **task output 解析該 JSON**，**不依賴 background workflow 的 `return` 物件跨邊界傳遞**（Workflow 為 background 模式，主線實得 task output 文字）。主線解析後讀真碼裁決，貼進中文報告第 4 欄。

## 4. plan-self-review.mjs 設計

### 4.1 meta（純 literal）
```
name: 'plan-self-review'
description: 'v3 維度 A plan self-review：7 維 finder 對抗式撕 plan'
phases: [{title:'Find'},{title:'Verify'}]
```
### 4.2 args
`args = { planDocPath: string }`（要 review 的 plan doc 路徑）。

### 4.3 7 finder 維度（= v3 §5 Plan checklist 七維）
security boundary／tenant scope（`WHERE tenant_id=?`/RBAC）／migration up·down（expand-migrate-contract）／API contract·enum（enum 變更=breaking）／高風險領域 state machine+idempotency+retry/timeout／命名 SSOT（跨層同字串）／SPEC scope 對齊（Non-goals/Acceptance 逐條）。

### 4.4 形狀（pipeline 優先，對齊 Workflow canonical pattern）
```
pipeline(
  DIMENSIONS,                                            // 7 維
  d => agent(finderPrompt(d, planDocPath),               // Find：讀 plan doc，產 candidate findings
        {agentType:'Explore', phase:'Find', schema: FINDINGS_RESULT}),
  review => parallel(review.findings.map(f => () =>       // Verify：每條對抗式（預設 refuted）
        agent(verifyPrompt(f), {agentType:'Explore', phase:'Verify', schema: FINDING})
        .then(v => ({...f, ...v}))))                      // 回填 status/verdict_note
)
```
finder prompt 要點：讀 `planDocPath`、聚焦該維、產 candidate findings（具體 `evidence_path`+`ref`，禁泛泛）。verify prompt 要點：**預設 refuted**，讀 plan doc 核對 evidence，成立才 accepted。
**主線裁決**：workflow 回 findings（含 verify 結果），主線（我）獨立讀 plan 裁決、去重、不採 raw 輸出（v3 §5 紀律）。

## 5. code-self-review.mjs 設計

### 5.1 meta（純 literal）
```
name: 'code-self-review'
description: 'v3 維度 A code self-review + 產 §6 faithfulness 複核包'
phases: [{title:'Artifacts'},{title:'Find'},{title:'Verify'},{title:'Package'}]
```
### 5.2 args
```
args = {
  baseRef, headRef,          // diff 範圍
  planDocPath,               // approved plan
  archApprovedSha,           // §6.0 錨點
  planApprovedSha,           // §6.0 錨點
  odRulings: string[],       // §6.0 OD 裁決
  decisionPoints: [{file, symbol, tier}]  // plan 標記的安全/state/idempotency/tenant 決策點（供 §6.3 完整 hunks 機械納入）
}
```
> **設計依賴 + SOP 連動（自審 F3）**：`decisionPoints` 由 plan doc 標記、主線透過 args 傳入（機械化選取的來源）。**這對 v3 plan doc 格式產生新要求：未來用 code-self-review 的 PR，其 plan 須結構化標記決策點（file/symbol/tier）。** 本 PR 因純工具腳本無 runtime 決策點而降級（見 §12 OD-E）；「plan template 補 `decisionPoints` 欄位 + 回寫 v3 SOP §6 第 3 項依賴」列為 **SOP follow-up**（memory 範圍外，另案）。

### 5.3 語意維 finder
race／idempotency／tenant 漏裸 query／async 邊界 error+timeout+retry／contract·enum breaking／命名 SSOT／regression test 真鎖 exact failure。形狀同 §4.4（finder→verify pipeline）。

### 5.4 §6 複核包組裝（AC4）
- **Artifacts stage**（Explore agent 跑唯讀 git）：`git diff --name-status <base>..<head>`、`git diff --stat`、完整 changed-file list、`git rev-parse <head>`（reviewed_sha）；對每個 `decisionPoints[i]` 跑 `git diff <base>..<head> -- <file>` 取**完整 hunks**。
- **Package stage**（主線組裝）：產 `REVIEW_PACKAGE`（§6 七項）：
  ```
  { anchor:{plan_doc_path, arch_approved_sha, plan_approved_sha, od_rulings},
    git_artifacts:{reviewed_sha, name_status, stat, changed_files},
    scope_mapping:[{scope_item, files}],
    decision_hunks:[{decision_point, hunk}],
    deviations:[...], dimension_a_findings:[FINDING...],
    questions:[...,'B 必做：對照 name_status 點名有改動但未附 hunk 的檔'] }
  ```
- 輸出 machine JSON + 中文摘要（給主線貼進報告第 6 欄送 ChatGPT faithfulness）。

## 6. `.gitignore` 改動（owner 規則）

`.gitignore` L6 `.claude/` 改為：
```
.claude/*
!.claude/workflows/
!.claude/workflows/**
```
**Branch 策略（自審 F7）**：從 `main` 開乾淨 feature branch `feat/dimension-a-self-review-workflows`，確保下方 `git status --short` 斷言不混入無關檔（當前 `feat/factor-add-a4-disposition` 已隨 #80 merged，不在其上續做）。

**驗證命令（owner 指定，全須符合預期）**：
```
git check-ignore -v .claude/settings.local.json   # 預期：仍被 ignore
git check-ignore -v .claude/scheduled_tasks.lock  # 預期：仍被 ignore
git check-ignore -v .claude/workflows/plan-self-review.mjs  # 預期：不被 ignore（exit 1 / 無輸出）
git status --short                                 # 預期：只出現預期新增/修改檔
```
**禁止**：un-ignore 整個 `.claude/`、追蹤 `settings.local.json`/`scheduled_tasks.lock`、改 user 層、改放 `scripts|tools/workflows/`（除非後續 Gate 判定 `.claude/workflows/` 不可行）。

## 7. `scripts/typecheck-ratchet.mjs` 改動（解 Critical blocker）

規則 D（L819-855）擋「非 `NEW_JS_ALLOWLIST` 且非 `public/js/` 的新增 `.js/.mjs`」。`NEW_JS_ALLOWLIST`（L122-130）加兩條 **exact path**：
```
'.claude/workflows/plan-self-review.mjs',
'.claude/workflows/code-self-review.mjs',
```
> **OD-B 待裁**：逐條加（最小變更）vs 改 ratchet 支援 `.claude/workflows/*.mjs` glob（未來新增 workflow 免再改，但動 ratchet 比對邏輯=擴大 scope+需 ratchet 自身 regression）。plan 預設**逐條加**（first-do-no-harm）。
> **自審 F8 連動**：allowlist 條目數隨 OD-A（+`scripts/lint-workflows.mjs`）/OD-D（+`.claude/workflows/lib/schemas.mjs`）增加；基線 2 條（兩支 workflow），每新增一個 `.mjs` +1 條。`.claude/workflows/lib/` 受 §6 `!.claude/workflows/**` allowlist 涵蓋但仍須各自登記 ratchet。若 OD-B 選 glob 則一勞永逸涵蓋 `.claude/workflows/**`。

## 8. 測試 / 驗證策略（誠實處理 workflow 腳本可測性限制）

**限制**：workflow 腳本需 Workflow runtime（`agent`/`pipeline` 全域注入），node 直接 `import` 會執行 body 而炸；且不在 `tests/` glob → **傳統 vitest unit test 不適用**。

**驗證三層**：
1. **靜態檢查（OD-A 待裁是否進 CI）**：`scripts/lint-workflows.mjs` 驗 `.claude/workflows/*.mjs`：`meta` 為純 literal（無變數/呼叫）、無 `Date.now`/`Math.random`/argless `new Date`、finder 用 `agentType:'Explore'`、prompt 含 read-only 標記、schema 欄位齊全。**（自審 F8）此檔本身為新增 `scripts/*.mjs`，亦撞規則 D，須一併進 `NEW_JS_ALLOWLIST`。**
2. **schema 自驗**：finding/package schema 抽成可獨立 `import` 的純資料（`*.schema.mjs`，不含 workflow 全域）→ node 驗 schema 合法 + 對 sample finding 驗 pass/fail。
3. **真實 dry-run（acceptance，owner-monitored）**：用 Workflow 工具實跑兩支一次（plan-self-review 餵本 plan doc；code-self-review 餵一個既有小 diff），人工核對輸出符合 schema + 複核包符合 §6。**非自動 test（LLM 非 deterministic）**。

> **OD-A 待裁**：(a) 加 `lint-workflows.mjs` 進 `build`/CI（強保障，scope+1 lint 腳本，且它自己也要進 `NEW_JS_ALLOWLIST`）；(b) 只做一次性 dry-run + 人工核對（最小 scope，無持續 enforce）。plan 預設**傾向 (a)**（v3 治理工具該有持續 enforce），但標 owner 裁。

## 9. 對既有 gate 的影響（勘查結論）

| gate | 影響 | 處置 |
|---|---|---|
| `typecheck:ratchet` 規則 D | 💥 **會擋**（Critical） | §7 加 `NEW_JS_ALLOWLIST` |
| eslint | 不掃 `.claude/` | 無需改（workflow 全域不被 no-undef 旗標）；若 OD-A 加 `lint-workflows.mjs` 該檔在 `scripts/` 會被既有規則涵蓋 |
| tsconfig（含 solution/leaf） | 不掃 `.claude/` | 無需改 |
| vitest（unit/workers） | 不掃 `.claude/` | 無需改 |
| CI `build:functions`/`build` | 不碰 `.claude/` | 無需改 |
| `lint:migrations`/`lint:handlers`/`lint:archive-no-delete` | 不掃 `.claude/` | 無需改 |

## 10. 安全 / read-only 邊界（已知殘留）

- read-only 達成見 §3.3；**殘留**：Explore agent 持 `Bash`/`WebFetch`/`WebSearch` 為理論逃生口，靠 agentType 結構鎖（無 Write/Edit）+ prompt 硬性禁令 + 主線複查 evidence 來源收斂，非 100% 硬保證。
- secrets：prompt 明令禁讀 `.dev.vars`/`.env*`/`.canary-*`（對齊 CLAUDE.md secret container 紀律）；evidence_path 落這些路徑 → 主線裁決時 reject。
- `.gitignore` allowlist 不得洩漏 `settings.local.json`（§6 驗證）。

## 11. Observability

- 每支 workflow `log()` 階段進度 + 最終中文摘要；workflow id 記入中文報告第 4 欄（v3 §5/§11）。
- 主線裁決後，findings 進報告第 4 欄、複核包進第 6 欄。

## 12. Open Decisions（送 ChatGPT Arch / Codex Plan 裁）

- **OD-A 測試策略**：加 `lint-workflows.mjs` 進 CI（持續 enforce，預設傾向）vs 只 dry-run 人工核對（最小 scope）。
- **OD-B ratchet allowlist**：逐條加（預設）vs glob 支援。
- **OD-C eslint workflow 覆蓋**：本 PR 不加 eslint 掃 workflow（最小 scope，預設）vs 加 block + workflow globals。
- **OD-D schema 共用（自審 F5：原「預設 inline」與 §8 層2「抽檔自驗」矛盾，已對齊）**：**預設改為抽 `.claude/workflows/lib/schemas.mjs` 共用**（同時支援 §8 層2 schema 自驗 + DRY）；**依賴「workflow 腳本能 import 同 repo 相對檔」未驗證 → dry-run 驗；若不可行 fallback 各自 inline + §8 層2 退為靜態 regex 檢查**。
- **OD-E code-self-review decisionPoints 來源**：本 PR 兩支腳本**無 runtime 決策點**（純工具腳本），故本 PR 的 faithfulness 複核包 `decision_hunks` 退化為「ratchet/gitignore config 改動 hunks」；未來 runtime PR 才有 security/state 決策點。確認此降級。

## 13. Rollback

純新增 2 腳本 + 2 config 小改 + 1 doc。Rollback = 刪兩支 `.mjs` + revert `.gitignore` L6 + revert `NEW_JS_ALLOWLIST` 兩條 + 刪 doc。無 DB/migration、無 runtime、無資料風險。

## 14. 自審修正紀錄（單 agent 對抗式；bootstrapping 降級，見 §0）

**8 findings accepted（已 inline 修進對應 §）**：
- F1（tier2，§1 AC5）：`name` 解析機制未驗證 → 標 dry-run 驗 + `scriptPath` 為保證 fallback。
- F2（tier1，§3.3/§10）：read-only 對「禁網路」保證最弱（Bash curl + WebFetch）→ 加主線複查 evidence 來源、網路/repo 外 = reject + 告警（detection 補償）。
- F3（tier1，§5.2/§12）：§6 複核包 `decisionPoints` 產生「對 v3 plan doc 格式的新要求」→ 標明 + 列 SOP follow-up（plan template 補欄位 + 回寫 SOP §6）。
- F4（tier1，§3.5）：workflow 結構化結果回主線機制 → 改 `log()` 輸出 JSON 到 task output 解析，不依賴 background `return` 物件。
- F5（tier2，§12 OD-D）：OD-D 原預設 inline 與 §8 層2「抽檔自驗」矛盾 → 對齊：預設抽 `lib/schemas.mjs`，標 import 可行性 dry-run + fallback。
- F6（tier2，§0）：補「本 PR 的 code self-review 亦退單 agent」。
- F7（tier2，§6）：補 branch 策略（從 main 開乾淨 branch，確保 git status 斷言有效）。
- F8（tier2，§7/§8）：`lint-workflows.mjs` / `lib/schemas.mjs` 若加，本身也撞 ratchet 規則 D，須一併進 `NEW_JS_ALLOWLIST`。

**4 refuted（對抗式嘗試證偽後不成立）**：
- 「`agentType` + `schema` 不能並用」→ refuted（Workflow 工具描述明說 composes）。
- 「Workflow 工具不能跑被 gitignore 的檔」→ refuted（Workflow 讀檔案系統，與 git 追蹤無關；.gitignore 只影響版控）。
- 「determinism 不可能」→ refuted（已澄清 = schema-deterministic 非 LLM bit-identical）。
- 「.md plan doc 撞 ratchet」→ refuted（規則 D 只管 `.js/.mjs`）。

一輪後 0 新發現 → `PLAN_SELF_REVIEW_CLEAN`。架構級盲點仍待 ChatGPT Architecture Gate（自審只清便宜~中等錯誤）。
