# Stage 7 PR-2dw 批 D — `user-audit` 型別化與 **write-path** severity boundary 收斂

| 欄位 | 值 |
|---|---|
| 狀態 | `PLAN_DRAFT` |
| Gate state | ✅ **Plan Gate 兩道全數通過** —— `CHATGPT_ARCH_APPROVED_WITH_LOCKS`（① 於 **R12** 核發）· **`CODEX_PLAN_APPROVED`（② 於 **R4** 核發 @ `e6c6a2ed`）**。⚠ `ARCH-D-L1..L5` 為**既有 locks 續效、非 R12／R4 新增**。✅ **四道外部審查全數通過**（① R12 · ② R4 · ③ `1a416946` · ④ source `1a416946`），owner `CODING_ALLOWED` 亦已 `GRANTED`。**現行輪次＝待 owner 授權 squash-merge**。🚫 **`MERGE_ALLOWED` 不得由 ④ 裁決自行推導**（④ 明文）—— merge／push／deploy 仍須 owner 另行明示。⚠ **逐項標明核發者，🚫 我方「修訖」不得寫成「CLOSED」**（專案 `CLAUDE.md` §2：沒「Approve」＝沒過、禁自我宣告。**適用範圍**：本表頭與 §14／§14.x 對**外部 gate 之 Required 項**的狀態記載；**生效時態**：即刻至合入；**例外集合**：我方自有 tech-debt 之 closure token〔如 §10.1 `TD-BATCHD-1` 之 `CLOSED_PARTIAL`〕，其客體非外部 gate 裁定、不受本禁令拘束；**closure**：本檔 gate-state 記載處窮盡）：<br>· **R1**：`RR1`／`RR4` **CLOSED**、`RR2` **CLOSED WITH EXISTING LOCK**（皆 ① 於 R2 核發；🚫 不得把 `RR2` 平化為無限定 CLOSED —— 其例外之續鎖條件見 §5.4.2／§14.2）；`RR3` **未**由 ① 宣告 CLOSED，其殘留轉為 `GPT-D-ARCH-R2-RR1`<br>· **R2**：`R2-RR1` 之四項中 **#1／#3／#4 CLOSED（① 於 R3 核發）**、**#2 PARTIAL**，殘留轉為 `GPT-D-ARCH-R3-RR1`<br>· **R3**：2 Required（`R3-RR1`／`R3-RR2`）**皆 CLOSED（① 於 R4 核發）**；self-review prerequisite **SATISFIED（① 於 R4 認定）**<br>· **R4**：**1 Required（`GPT-D-ARCH-R4-RR1`）CLOSED（① 於 R5 核發）**；主動申報「**History A／B 客體限定**」**APPROVED（① 於 R4 核發）**<br>· **R5**：**0 Required／0 新 finding／0 新 lock**；self-review prerequisite **SATISFIED（① 於 R5 認定）** ⇒ ① Gate 通過（⚠ 該結論已隨 R5 之 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 失效而一併失效；**現行 ① Gate 通過依據一律以本格開頭之 state token 為準**，🚫 **不在此具名輪次** —— 該值每次 gate 推進即漂移，已於 R8→R10→R11 連續失準）<br>· ⚠ **R5 之 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 已失效**：② Codex Plan R1 判 **`CODEX_PLAN_CHANGES_REQUIRED`**（5 Required），其修正皆落在 §13.1 carve-out **外**（詳 §14.5）<br>· **R6**：**2 Required（`GPT-D-ARCH-R6-RR1`／`R6-RR2`）皆 CLOSED（① 於 R7 核發）**；② 五條中 `R1`／`R2`／`R3`／`R5` **ARCH-ACCEPTED**、`R4` **PARTIAL**；census 第 9 列申報 **① 准予極窄解凍**（`R6-RR1`；詳 §14.6）<br>· **R7**：self-review prerequisite **SATISFIED（① 於 R7 認定）**；**1 Required（`GPT-D-ARCH-R7-RR1`：表頭 gate-state SoT drift）CLOSED（① 於 R8 核發）**<br>· **R8（ultra-narrow）**：**0 Tier-0 Blocker／0 Required／0 新架構方向 finding／0 新 lock**；`GPT-D-ARCH-R7-RR1` **CLOSED（① 於 R8 核發）**；兩驗收點（header current-state 已閉合、header／§14 current-state 一致）**皆通過（① 於 R8 認定）**；本輪 bookkeeping 兩 hunk **合法落在 §13.1 W-1 carve-out（① 於 R8 認定）** ⇒ 當時 **① Gate 通過，下一合法狀態＝送 ② Codex Plan R2**<br>· ⚠ **R8 之 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 已失效**：② Codex Plan R2 判 **`CODEX_PLAN_CHANGES_REQUIRED`**（**4 Required**：`R2-RR1` §4.6 首句 pure-type 殘句 · `R2-RR2` 8000ms 上限族 · `R2-RR3` §12 ∅ 未限客體 · `R2-RR4` 告警可觀測性未帶二分），其修正皆落在 §13.1 carve-out **外**（詳 §14.7）⇒ 須送 ① R9。② 另判我方主動申報之兩條殘留**非阻擋**。🚫 不得援引 R8 之「不需要 R9」略過 —— 該句前提為「後續**只**為記錄 R8 approval 而回填」，本輪不成立（① 於 R9 已明示認同此判定）<br>· **R9**：**0 Tier-0 Blocker／1 Required／0 新架構方向 finding／0 新 lock**；self-review prerequisite **SATISFIED（① 於 R9 認定）**；② R2 四條中 `R2-RR1`／`R2-RR3`／`R2-RR4` **ARCH-ACCEPTED**、`R2-RR2` **PARTIAL**（timeout 實質語義修正接受，僅 evidence-family closure 尚缺一刀）；兩項自願修正 **① 判非 scope creep、可保留**；新增 **1 Required（`GPT-D-ARCH-R9-RR1`：§14.7 量測母體自引用）CLOSED（① 於 R10 核發）**<br>· **R10（ultra-narrow）**：**0 Tier-0 Blocker／0 Required／0 新架構方向 finding／0 新 lock**；`GPT-D-ARCH-R9-RR1` **CLOSED（① 於 R10 核發）**；`CODEX-D-PLAN-R2-RR2` 由 R9 之 **PARTIAL 升為 ARCH-ACCEPTED** ⇒ **② R2 四條在 Architecture 維度均已接受**；self-review prerequisite **SATISFIED（① 於 R10 認定）** ⇒ 當時 **① Architecture Gate 通過，下一合法狀態＝送 ② Codex Plan R3**；① 明示不需要 R11（⚠ **該句已被 ② R3 之 Required 推翻**，見下）<br>· ⚠ **R10 之 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 已失效**：② Codex Plan R3 判 **`CODEX_PLAN_CHANGES_REQUIRED`**（**1 Required**：`CODEX-D-PLAN-R3-RR1` —— §12 (c) rollback／durable-state 模型認錯客體，把既有 event row 之**狀態轉移**誤述為 row **新建**），其修正落在 §13.1 carve-out **外**（詳 §14.8）⇒ 須送 ① R11。🚫 不得援引 R10 之「不需要 R11」略過 —— 該句之適用前提為「後續只為記錄 R10 approval 而回填」，本輪為 carve-out 外之 plan 變更、前提不成立（同 R8→R9 之情形；① 於 R11 已明示認同）<br>· **R11**：**0 Tier-0 Blocker／1 Required／0 新架構方向 finding／0 新 lock**；self-review prerequisite **SATISFIED（① 於 R11 認定）**；**`CODEX-D-PLAN-R3-RR1` ARCH-ACCEPTED** —— 兩軸 durable-state 模型正確且與 §11.3.1 相容（History A／B 客體限定 · bullet 5 `PARTIALLY SATISFIED` · transition-evidence gap **三者皆不受影響**）、rollback 模型成立、**`UNMEASURED` 不構成 ③④ 驗收空洞**（該 architecture decision 不依賴數量，rollback rule 恆為「保留」）、§14.8 family closure **通過**（① 獨立重跑得 6 命中＝2 live 護欄／4 self-meta）；新增 **1 Required（`GPT-D-ARCH-R11-RR1`：表頭 exhaustive index 過期）CLOSED（① 於 R12 核發）**<br>· **R12（ultra-narrow）**：**0 Tier-0 Blocker／0 Required／0 新架構方向 finding／0 新 lock**；`GPT-D-ARCH-R11-RR1` **CLOSED（① 於 R12 核發）**；兩驗收點（表頭 index ＝ `§14.1–§14.8` 且與實際 8 個子節一致 · current-state bookkeeping 一致）**皆通過（① 於 R12 認定）**；self-review prerequisite **SATISFIED（① 於 R12 認定）**；`CODEX-D-PLAN-R3-RR1` **不重開、仍為 ARCH-ACCEPTED**（① 直接比對 R11／R12 artifact，確認實質 diff 恰為我方申報之 4 處）⇒ **① Architecture Gate 通過，下一合法狀態＝送 ② Codex Plan R4**；① 明示**不需要 R13**<br>· ⚠ **① 於 R12 對我方兩項主動申報之裁定**：**(A)** 表頭**維持** `§14.1–§14.8`、本輪不改為無範圍形式 —— ① 明示所指結構風險**為真**，但「R12 當下 artifact 沒有錯」且 R11 之 acceptance criterion 已指定該值，故不為「更耐未來修改」而移動已乾淨之 review object；**(B)** §6.2 之同族刀 **ACCEPTED／`NOT_SCOPE_CREEP`** —— 其 operative proposition 自始為「overlay 只套 §4.1」，後半僅為補集枚舉；改由 positive set 定義補集係**把證據敘述拉回既有真實語義**，未擴大或改變 measurement（§6.2 之 `base 373 / overlay 373 / REMOVED 0 / ADDED 0` 未動）。① 並明示該刀雖位於 §13.1 carve-out 外，**因新 hash 已經本次 R12 review，🚫 不需另開 R13**<br>· ⚠ **① 於 R10 之關鍵判定**（🚫 不得平化為無限定 CLOSED；🚫 不作處數宣稱，closure 由逐項具名承載）：**(a) 判準式 self／meta exclusion 通過** —— ① 明示接受我方**未照抄**其 R9「只排除 §14.7 本枚舉區塊」之字面，因**種類**判準消除了「列全所有 meta 位置」所生之下一層 closure；**(b)** ① **獨立重跑** `上限|無界|8000|確定性` 得 **31 行**，與本檔宣告之 19／11／1 結構吻合；**(c) 第 7 類「詞形假陽性」非 scope expansion** —— 係使 grep 母體之補集真正有歸屬，為 `R9-RR1` closure 所必需；**(d) §14.7 分類表之 §12 (a)→§12 (b) 更正可接受** —— 同一既有 member 之 reference correctness，分類與規範內容未變；**(e) timeout 正文未被 R10 偷改** —— §4.6 之精確語義與三項殘留仍在，未藉 evidence 修正改寫已接受之 architecture semantics<br>· ⚠ **① 於 R8 正式更正其 R7 裁決之內部矛盾**：R7 之最小修正原文寫「→ 待送 ① R7」，同一裁決卻明示「修正後需送一次 ① R8」；① 裁定**以 current-state SoT 為準、此時正確值必須是 R8**，我方採 `R8` **處置正確、不應改回 `R7`** ⇒ 前輪為此在本格所留之就地註記疑義**已閉合**（該註記隨本次回填移除）<br>· `ARCH-D-L1..L5` **全部 HOLD**<br>逐輪處置詳 §14 及其全部子節（§14.1–§14.8）〔⚠ **同步維護義務（① 於 R12 明確接受並課予）**：本 PLAN 完成 gate／merge 前，**若新增任何 §14.x 子節，本 range 須於同一變更內同步**，否則重新形成 `P`／`¬P`（即 `GPT-D-ARCH-R11-RR1` 之復發）。🚫 此為**既有 index 之維護條件、非新 `ARCH-D-L6` lock**，不增加 lock 數量〕｜ **`CODEX_PLAN_APPROVED = GRANTED`（② 於 R4 核發 @ `e6c6a2ed`）** · **`CODEX_CODE_APPROVED = GRANTED`（③ 核發 @ `1a416946`；receipt 見 §15）** · **`CHATGPT_CODE_FAITHFULNESS_APPROVED = GRANTED`（④ 核發 @ source `1a416946`；receipt 見 §15）**<br>⚠ **LHS 一律用 SoT 12 states 之全大寫精確字串**（`feedback_codex_review_workflow` §「引用 state 一律用上述全大寫精確字串，禁簡寫禁 alias」）。🚫 不得再寫 `CHATGPT_ARCH = …`／`CODEX_PLAN = …`／`CHATGPT_CODE_FAITHFULNESS = …` 等**截斷前綴**（此誤曾於本檔發生兩輪）。形式與既有 landed doc 對齊：`stage7-pr2dw-closeout-*:199`（`CODEX_PLAN_APPROVED = NOT_GRANTED`）· `stage7-pr2dw-batchc2-*:615`（`CHATGPT_ARCH_CHANGES_REQUESTED` 單 token） |
| 授權 | ✅ **`CODING_ALLOWED = GRANTED`**（owner 於 **2026-08-12** 明示，前提＝Plan Gate 兩道皆通過）。⚠ **維度 A self-review 形式：owner 指定用「單 agent 對抗式」**，🚫 **非** multi-agent workflow（Dual Gate v3.1 對 L2 之預設為 workflow，本棒由 owner 明示改為單 agent）。🚫 **授權範圍僅及於 §5.1／§5.2／§5.3 allowlist 內之檔案與 §1 量化目標**；merge／push 仍須經 ③④ 與 owner |
| 動工級別 | **L2**（新增 runtime parser + 收斂 legacy normalizer + 改變非法 severity fallback 行為 + §4.6 bounded timeout）。⚠ ① `ARCH-D-L5`：**實作維持 L2，但 ③ Codex Code 與 ④ faithfulness 必採 L3 payment + distributed-state review lens** |
| base commit | `4a8933bab7bdb9657550028439757902840379cc` (`4a8933ba`, main) |
| branch | `stage7-pr2dw-batchd-user-audit-severity-parser` |
| 高風險領域加碼 | **觸發 5 類**：Queue/Message · Payment/退款/Webhook · Transaction 跨資源 · Distributed State · 跨系統 JSON Contract。**Not Applicable 2 類**：WebSocket/SSE · Streaming。另有本檔自加之審查面 2 項（稽核保存期 · `safeUserAudit` 冪等姿態，**非**全域 7 類成員）。⚠ 本格為 **§11.3 之摘要、非獨立規範來源、不承載任何 closure**；上列三個數字之四項限定與逐類依據**全部委任 §11.3**（觸發／N-A 之 closure 見 §11.3 尾註；自加 2 項之 closure 見 §11.3「以上 7 類即全域清單之全部」段後之列舉）。兩者衝突一律**以 §11.3 為準** |

> **本文件的 SoT 邊界**：本文件是批 D 的計畫與證據紀錄。流程規則以 live `CLAUDE.md` Dual Gate v3.1 為準；架構不變量以 `docs/GOVERNANCE.md` → chiyigo-core (pin v0.1.4) 為準；批 D 的 merge-integrity／HALT 依 C2 §9 之**架構不變式**；其**文件內操作面**（凍結 carve-out 窗口、可編輯儲存格、receipt 落點）以本檔 **§13.1** 為準——C2 的 W-1／W-2 是以 **C2 自身節號**寫死的（「僅 `## 9` 表的 ①② 兩格」「僅 `## 10` 之 append」），字面繼承到本檔會指向錯誤章節（本檔 `## 9` ＝ Required gates、`## 10` ＝ 風險與失效模式、gate 表在 `## 14`）。抽取工作見 backlog `GOV-MERGE-INTEGRITY-EXTRACT-001`（未啟動）。

> **雙份 basename 之裸引用（已查證的例外，非未掃描區）**（適用範圍：本檔**帶行號**之裸 basename 引用，即 `file.ts:line` 形；生效時態：base `4a8933ba` 快照，無機械維持；例外集合：**不帶行號**之裸引用，由各節上下文錨定〔§4.5／§5.1 已給完整路徑、§11.1→§5.4 `F3_PROTECTED`〕，不在本 closure 內；closure：下列「**維持裸引用**」項窮盡本檔**帶行號裸引用**中 basename 為雙份者）：repo 內 `functions/` 有 **23 個**雙份 basename、`tests/` 有 **4 個**（量測法＝`git ls-files '<dir>/*' | awk -F/ '{print $NF}' | sort | uniq -d`）。本檔**曾**裸引用其中若干 basename，分兩組如下：
>
> - **已改寫為可唯一解析之路徑**：`tests/integration/audit-aggregate.test.ts` · `tests/integration/audit-aggregate-debug.test.ts` · `tests/integration/audit-archive.test.ts:636`（三者為**完整路徑**；不自曝之依據逐項：**唯一帶行號者**其根層 sibling 有 **1514** 行、涵蓋該行號，另二者**不帶行號**故無任何可越界之自曝訊號 ⇒ 三者皆須以路徑消歧義。量測法同「**維持裸引用**」項）· `payment-vendors/ecpay.ts` · `payment-vendors/mock.ts`（**截斷路徑**，各唯一解析）。⚠ 上列各項**已非裸引用**，故**不屬**上述 closure 之母體。
> - **維持裸引用（`functions/` 側 4 個 basename）**：`audit-archive.ts` · `audit-aggregate.ts` · `audit-aggregate-debug.ts` · `[vendor].ts`。⚠ **消歧義依據分兩類，皆可機械複驗**（量測法＝`git show 4a8933ba:<sibling> | wc -l` 與被引行號比較；🚫 **不作處數宣稱** —— 該數字隨每輪編輯漂移且無機械維持）：**(甲) 越界自曝**（sibling 行數不足以涵蓋被引行號，`cat` 即自曝）＝ `[vendor].ts`（kyc sibling **95** 行）· `audit-aggregate-debug.ts:333`（cron sibling **260** 行）；**(乙) 僅靠語義錨**（兩 sibling 皆涵蓋該行號、無自曝訊號，依函式名／「為註解」述詞／§2.2 交叉引用／「§4.5 單 hunk」就地錨定）＝ `audit-archive.ts`（siblings **1139／844** 行）· `audit-aggregate.ts`（**291／228** 行）· `audit-aggregate-debug.ts:169`。**🚫 不得據以推論「本檔所有裸引用皆已消歧義」。**
>
> ⚠ 🚫 **不得**為此另立「裸 basename → 某目錄」的全域展開規則 —— 該做法曾被試行並實測為淨負向（會把 `replay.ts` · `migrations.test.ts` · `_helpers.ts` 等**主動**誤解析成不存在的檔）。

---

## 1. 目的

清除 `functions/utils/user-audit.ts` 的 11 條 `TS7006`，同時把「severity 由外部字串進入稽核保存期決策」這條邊界從 legacy set-membership normalizer 收斂成具名 parser + category-aware fallback。

**量化目標（已 `MEASURED_OVERLAY`，見 §6）**：

| 指標 | 值 | 適用範圍 |
|---|---|---|
| `REMOVED` | 11 | `tsconfig.functions.json` leaf；全為 `user-audit.ts` 的 `TS7006` |
| `ADDED` | 0 | **僅 `tsconfig.functions.json` leaf**。tests leaf 未由 overlay 覆蓋，且**預期**新增恰 2 個 assignability error —— 即 §5.5 規劃的兩處 `@ts-expect-error` 站點；suppression 補上後淨值歸 0（見 §6、§7.4） |
| ratchet current | `373 / 14 / 323 / 337` → `362 / 13 / 324 / 337` | solution build |
| baseline | `1119 / 175` **凍結**；禁 `--update` | — |

> **本棒收斂的是 write-path**。`severity` 的 read path（DB 讀回後重推 cold_class）不在本棒範圍，見 §2.2 與 §13。

---

## 2. 定序位置

audit 域為 `noImplicitAny` 最後殘域，owner 定序 producer-first + destructive-last：

`A ✅ → C ✅ → C2 ✅ → **D（本棒）** → E → B-read → F → G → H0 → H1 → I → K → L → B-delete → J1 → J2`

**批 D 的檔案範圍由 owner 於 2026-07-27 以 `OWNER_SCOPE_RULING` 明示裁定**（`D_PRIMARY_SOURCE = functions/utils/user-audit.ts`）。**16 單元字母→檔案對映不在 repo 內**；本棒不推測其餘單元範圍，該對映另立 owner-ratified backlog（與 `GOV-MERGE-INTEGRITY-EXTRACT-001` **不合併**，owner 2026-07-27 裁定）。

### 2.1 §5.2 角色

本棒同時為 Establishment owner 與 Convergence owner（degenerate case）：`KNOWN_SEVERITY` 於同一 PR 內建立替代物並移除，**過渡期為零**，不產生方案 B 的雙軌並存視窗。依據＝C2 §5.2.3 line 464-466 明列之退化情形。

#### 2.1.1 C2 §5.2.4 五項受控條件之 discharge（逐項對照）

C2 §5.2.4 是**過渡期**受控條件。本棒過渡期長度為零，故逐項狀態如下（**不得**因「過渡期為零」而略過對照，否則第 3 項的 carry-forward lock 無承接紀錄）：

| C2 §5.2.4 | 內容 | 本棒狀態 | 依據 |
|---|---|---|---|
| 1 | `KNOWN_SEVERITY` 為 boundary 上唯一獲准 legacy exception | **vacuously satisfied** — 同一 PR 內建立替代物並移除，無過渡窗口 | §4.3 移除 `KNOWN_SEVERITY` |
| 2 | 禁在 classifier boundary 新增第三套 parser/validator/inline guard | **satisfied** — 本棒僅建立 `parseAuditSeverity` 一套；`admin/audit.ts` 之 `VALID_SEVERITY` 依 C2 §5.1 `CODEX-C2-PLAN-R1-2` 為 boundary 外 concern-specific validator，不計入且不觸碰（§5.4 `D_EXCLUDES`） | §4.1(b) · §5.4 |
| 3 | **legacy 與 canonical 的 domain 必須有機械保障**（C2 只鎖「必須可機械偵測 domain 漂移」，實作由 Establishment owner 的 Plan Gate 定案） | **定案並落地** — 見下 | §4.1(a) · §8.4-1/-5 |
| 4 | closure condition ＝ 第一個合法觸碰 `user-audit.ts` 的已核准棒次完成取代 | **本棒即 closure** | §2.2 |
| 5 | closure 前禁宣稱「boundary 已全域收斂」 | **closure 後由 §2.2 接手** | §2.2 |

**第 3 項之定案（本棒為 Establishment owner，此為 `ARCH-C2-R2-L2` 分工下應由本棒明文定案者）**：

採**型別層 ＋ 測試層**雙機制，**不**採 lint：

1. **型別層**：`AuditSeverity = (typeof AUDIT_SEVERITY)[keyof typeof AUDIT_SEVERITY]`（§4.1(a)）—— 型別由 runtime 常數衍生，compile-time 強制兩者同源，消除「型別與 runtime 各寫一份」的漂移面。
2. **測試層**：`AUDIT_SEVERITY` ↔ 端態 `sqlite_master` 的 `audit_log.severity` CHECK 值集**雙向 set equality**（§8.4-5(i)）＋ runtime 三值皆納/第四值被拒（§8.4-5(ii)）。

⚠ **受保護的漂移軸已改變，且此為升級非降級**：C2 寫該條時假設過渡期存在 legacy 與 canonical 兩套實作，故軸為「legacy ↔ canonical」；本棒 legacy 於同 PR 移除，該軸消失，改由「canonical ↔ D1 schema」承接 —— 後者才是 severity domain 的真實外部約束（違反會導致 audit row 靜默流失，見 §8.4-5「為何不能只驗存在性」）。

#### 2.1.2 `ARCH-C2-R2-L2` 六項必定案之 discharge（逐項對照）

C2 §5.1 的 `ARCH-C2-R2-L2`（① R2 carry-forward lock）規定：owner 棒次在 **coding 之前**，其 SPEC／PLAN **必須逐項明文定案**下列六項，**未定案即不得進 coding**。本棒為 owner 棒次，逐項落點如下（此表為**索引**，各項規範全文以所指章節為準）：

| # | 必定案項 | 本棒定案 | 落點 |
|---|---|---|---|
| 1 | parser／guard API | `parseAuditSeverity(raw: unknown): AuditSeverity \| null` 為**單一 canonical implementation**；classifier boundary 上其他 caller **只 import 不重寫**（`user-audit.ts` 於 §4.2 import 之）。⚠ 「單一」與「只 import」皆為**終態規範、對後續棒次生效**，非合入後現況陳述；**例外集合＝§2.2 所列三個 read-path 座標**（`audit-archive.ts:716` · `audit-aggregate.ts:227` · `audit-aggregate-debug.ts:333`），依 C2 §5.1 之雙向 boundary 定義它們在 boundary 上，但本棒不觸碰、C2 §8.2 第一列維持 `OPEN` | §4.1(b) · §4.2 · §2.1.1 · §2.2 |
| 2 | invalid 結果表示 | 回 **`null`**。🚫 不以 assertion 把非法值偽造成合法 `AuditSeverity` —— §4.1(b) 明載「無型別 assertion」（迴圈變數 `s` 本身即 `AuditSeverity`），且 §5.5 之禁令清單已**顯式納入 `as AuditSeverity`**。本棒自身亦受 C2 §5.1 規格表「非法值：🚫 assertion 消音」拘束 | §4.1(b) · §5.5 · C2 §5.1 |
| 3 | fallback 位置 | **明示選擇第二支**：由具 category context 的 **classification 層**處置（純 parser 無 `event_type → category` 資訊，無法獨力完成） | §4.1 · §4.3 |
| 4 | retention | **不降級**：非法 severity 不得解析成 retention 較短的結果；`security_signal` 取 `'critical'` 即為此 | §4.3 不變量 1 |
| 5 | 可觀測性 | **結構化 log**，tag ＝ `[audit-severity-invalid]`，payload 含 `event_type` / `category` / `fallback` / `notified`，🚫 不靜默吞。⚠ **完整訊息字串以 §4.3 規範碼為準**（本表為索引，不得作為字串來源 —— `feedback_state_machine_naming_no_alias`）。已誠實揭露其事後不可回溯之限制（Pages Direct Upload 無 `[observability]`） | §4.3 · §12 |
| 6 | F-3 | **不觸碰** `functions/utils/audit-archive.ts`（§5.4 `D_EXCLUDES.F3_PROTECTED`）⇒ `F3_FILE_EDIT_TRIGGER = NOT_TRIGGERED`，無須啟動 F-3 條件驗證 | §11.1 · §5.4 |

⚠ 本表與 §2.1.1（C2 §5.2.4 五項）是**兩張不同的清單**，來源分別為 C2 §5.1 的 `ARCH-C2-R2-L2` 必定案表與 C2 §5.2.4，**不得互相替代**。🚫 建立本表時不得只做其一 —— 兩張清單來源不同、效力不同，只 discharge 其中一張即為「只修被指出的那一個、未處置整族」。

⚠ **族邊界說明**：C2 §5.1 另有一張「規格（對後續棒次具約束力）」表（**8 列**），其效力為「**不得違反**」而非「**必須逐項明文定案**」（C2 自身於兩表分工段落明載此差異），故**不另立 discharge 表**。但為使完整性可機械核，仍附逐列落點對映（closure：8 列全數具名，無未對映者）：

| # | C2 §5.1 規格列 | 本棒落點 |
|---|---|---|
| 1 | 唯一性（終態，classifier boundary 上恰一個） | §2.1.1 第 1 項 · §2.1.2 row 1（含例外集合＝三個未遷移 read-path） |
| 2 | classifier boundary 之定義（**雙向**） | write path → §4.3；read path 三座標 → **§2.2**（維持 `OPEN`，本棒不觸碰） |
| 3 | 建議 home ＝ `functions/utils/audit-policy.ts` | **採納** → §4.1 |
| 4 | owner 棒次（＝ Establishment owner） | §2.1（本棒 scope 含 `user-audit.ts`，故為 owner；且同為 Convergence owner） |
| 5 | F-3 交互作用 | §11.1（不觸碰 `audit-archive.ts` ⇒ `F3_FILE_EDIT_TRIGGER = NOT_TRIGGERED`） |
| 6 | **raw 欄位**：D1 row 的 `severity` 欄維持 `string` | **vacuously satisfied** —— 本棒**不宣告任何 D1 row 型別**（read path 三座標皆在 `D_EXCLUDES`）。見下 ⚠ |
| 7 | 非法值：禁止（assertion 消音／靜默丟棄 row／降低 retention） | §5.5（`as AuditSeverity` 禁令）· §4.3 不變量 1（不降級）· §4.3 決策表（非法值仍落庫、不丟棄） |
| 8 | 非法值：必須（保留 fail-safe ＋ 結構化 log） | §4.3（`[audit-severity-invalid]` 結構化 log）· §4.3 不變量 4（既有行為維持）· §12（誠實揭露 log 不可回溯之限制） |

⚠ **對第 6 列的主動聲明（送 ① 時須顯式提出，勿等 ① 自行判讀）**：C2 的分層契約圖寫「D1 row **／外部輸入** `severity: string` ← untrusted raw boundary，維持 string，不標 `AuditSeverity`」，而本棒 §4.2 把 write-path 入參 `entry.severity` 標成 `AuditSeverity?`。兩者**不牴觸**，理由有二：(i) 規格表第 6 列的字面只綁「**D1 row 的 `severity` 欄**」，本棒未宣告任何 row 型別；(ii) 契約圖的 `AuditSeverity` 層明載為「**validated** application domain」，而本棒的 runtime 驗證（`parseAuditSeverity` ＋ §4.3 決策表）**完整保留、未被型別取代** —— 型別收窄只是讓 compile-time 也擋一層，`strict:false` 下 `null` 仍會走 present-but-invalid 分支（§12 第 2 點）。

### 2.2 宣稱用語紀律（closure 後接手 C2 §5.2.4 **第 5 項**護欄）

C2 §5.2.4 第 5 項的反過度宣稱護欄以「closure 前」為時態，本棒觸發 closure 後該護欄不再自動生效，**由本節接手**。（第 1–4 項之 discharge 見 §2.1.1，不由本節承擔。）

**✅ 可宣稱**：canonical parser 已建立 · **write-path** legacy normalizer（`KNOWN_SEVERITY`）已移除 · C2 §8.2 **第二列** legacy exception 已 closure。

**🚫 禁宣稱**：「classifier boundary 已全域收斂」「severity boundary 已完成」。

**仍未遷移的 read path（3 座標，C2 §8.2 第一列維持 `OPEN`）**：

| 座標 | 註記 |
|---|---|
| `functions/utils/audit-archive.ts:716` | F-3 受保護檔，本棒禁觸 |
| `functions/utils/audit-aggregate.ts:227` | 後續棒次 |
| `functions/utils/audit-aggregate-debug.ts:333` | 後續棒次 |

承接者＝後續定序中 scope 含該三檔之棒次；其約束仍以 C2 §5.1 為準（import 重用 · 禁 inline guard · 禁 `as AuditSeverity` · 禁 retention 降級）。

---

## 3. Owner 裁決紀錄（可追溯）

**編號 legend**（避免與 repo 既有階段名 `F-1`/`F-2`/`F-3` 撞名——那三者是 audit cold archive 的階段識別碼，見 §11.1）：

- `OD-D*` ＝ owner 於 SPEC 收斂前裁決的設計選項
- `SPEC-D*` ＝ 我方 scout 發現、owner 於 SPEC 修正中裁決者
- `D-VARIANT` ＝ `[vendor].ts` cascade 的解法變體（詳 §4.5）
- `OMIT-LOCK` ＝ 省略 vs present-but-invalid 二分鎖

| 編號 | 議題 | 裁決 |
|---|---|---|
| OD-D1 | 非法 severity fallback | **否決**無條件 `info`、**否決**無條件 `critical`；採 category-aware（§4.3） |
| OD-D2 | `entry.severity` 型別 | `severity?: AuditSeverity`；納入 `replay.ts` 兩行鄰接修正 |
| OD-D3 | `hashIdentifierForAudit.raw` | `string`；**保留** `String(raw)` 並註明理由 |
| OD-D4 | severity SoT 對齊 | 納入並加強（**owner 核准時為 5 項**；round 1 自審新增第 5/6 項〔來源＝維度 A plan-self-review round 1 finding [3]〕；**round 2 移除第 6 項**〔owner 2026-08-02 裁定，見 §8.4-6 已移除記錄〕⇒ 現生效 6 項：1–5 ＋ 7，編號槽保留不重排） |
| SPEC-D1 | `hashIdentifierForAudit` env 型別 | 明示例外：沿用共享 `UserAuditEnv`（salt-only 會觸發 TS2559，§7.3） |
| SPEC-D2 | capability type 理由 | 刪除「消除 suppression」敘述；改記契約誠實 + 前瞻 `strict:true` |
| SPEC-D3 | suppression 預算 | 採 (b)：共用 test-local helper，新增總數維持 **2** |
| D-VARIANT | `[vendor].ts` cascade | 採 **D**：維持 `number \| null`，`[vendor].ts` 一行收窄，production allowlist 3→4 |
| OMIT-LOCK | 省略 vs 非法 | 二分硬鎖（§4.3）；`undefined`／省略維持 `info` 且不記 invalid log |
| JSDoc | `user-audit.ts:55-63` | **不動**（line 58 契約在新設計下仍為真）；JSDoc 對齊屬另一 backlog |

---

## 4. 設計

### 4.1 `functions/utils/audit-policy.ts`

**(a) severity runtime SoT**（取代現行 `:32` 的裸 type alias）

```ts
/**
 * classifier boundary 上的 severity runtime 真相源。AuditSeverity 由本常數衍生，
 * parseAuditSeverity 以本常數查表；三個值與 audit_log.severity 的 CHECK constraint
 * 一一對應（該 CHECK 現由 migrations/0017_audit_log.sql 安裝）。
 *
 * 範圍限定：boundary 外之 concern-specific validator（如 admin/audit.ts 的 HTTP query
 * validator）依 C2 §5.1 `CODEX-C2-PLAN-R1-2` 裁決刻意不納，非遺漏。
 */
export const AUDIT_SEVERITY = Object.freeze({
  INFO:     'info',
  WARN:     'warn',
  CRITICAL: 'critical',
})

export type AuditSeverity = (typeof AUDIT_SEVERITY)[keyof typeof AUDIT_SEVERITY]
```

`AuditSeverity` 的值域**不變**（`'info' | 'warn' | 'critical'`），只是改由 runtime 常數衍生，消除「型別與 runtime 各寫一份」的漂移面。

**與同檔既有 `AUDIT_CATEGORY` (`:21-27`) / `AuditCategory` (`:29-30`) 逐字同型**：同為 `Object.freeze({ KEY: 'value' })` 物件形 ＋ `(typeof X)[keyof typeof X]` 衍生，命名亦同採**單數**。⚠ 初稿曾提「陣列 ＋ `as const`」形，雖亦可行但與同檔慣例**不同型**，且需額外一處 `as const` 預算與對應的 C2 carry-forward lock discharge；owner 2026-08-03 裁定改採物件形。

**`as const` 需求歸零**（`MEASURED`，見下）：`lib.es5` 的 `Object.freeze` 有一支 overload 將值約束為 primitive union，故物件字面量的屬性值**自動推成字面量型別**，無須 `as const`。這正是既有 `AUDIT_CATEGORY` 不帶 `as const` 仍能衍生 `AuditCategory` 的原因（[[feedback_ts_object_freeze_preserves_literals]]）。

**(b) 純 parser**

```ts
/**
 * 驗證外部傳入的 severity。只認 AUDIT_SEVERITY 三個字面值（大小寫敏感，與 D1 CHECK 一致）；
 * 其他一律回 null。純驗證：不記 log、不看 event_type — 非法值的 fallback 需要 category
 * context，屬呼叫端（classification 層）職責，見 ARCH-C2-R2-L2 第二支。
 */
export function parseAuditSeverity(raw: unknown): AuditSeverity | null {
  for (const s of Object.values(AUDIT_SEVERITY)) if (s === raw) return s
  return null
}
```

**無型別 assertion**：`Object.values(AUDIT_SEVERITY)` 推成 `AuditSeverity[]`，迴圈變數 `s` 本身即 `AuditSeverity`，直接回傳，不需 `as`。

> **`MEASURED`（2026-08-03，base `4a8933ba`）**：以 `npx tsc --noEmit` 搭配下列旗標編譯本節 (a)+(b) 之提議實作：`--strict false --noImplicitAny --target ES2022 --lib ES2022,WebWorker --moduleDetection force --module esnext --moduleResolution bundler` ⇒ **exit 0、零診斷**。
>
> ⚠ **此非 `tsconfig.functions.json` 的完整等價設定。** 與真實 parsed options 相比，delta 共 **12 個 key**：
>
> - **可能影響診斷者（8）**：`lib` 缺 `WebWorker.Iterable` · 未設 `types: ["@cloudflare/vitest-pool-workers"]`（CLI 預設反而納入全部 `node_modules/@types`）· 未設 `skipLibCheck` / `allowJs` / `checkJs` / `isolatedModules` / `esModuleInterop` / `resolveJsonModule`
> - **不影響診斷者（4）**：`composite` / `outDir`（於 `noEmit` 下不參與 `getSemanticDiagnostics`）· `forceConsistentCasingInFileNames` / `allowImportingTsExtensions`（TS 5.9 預設值，語意無差）
>
> **closure**：以上 12 項為 delta 之全部**語意成員**（量測法＝以 `ts.parseJsonConfigFileContent` 取真實 options 後與本段旗標逐 key 比對，得 13 key；適用範圍：`tsconfig.functions.json`；生效時態：base `4a8933ba`；**例外集合：`configFilePath`** —— 該 key 為 parse 過程產生之 metadata、非語意 compiler option，故不計入）。以真實 parsed options 的 project 級量測見 **§6.1／§6.2**，結論一致。
>
> 並附**負向控制**證明該量測有偵測力：加入 `const bad: AuditSeverity = 'PANIC'` 後恰報一條 `TS2322: Type '"PANIC"' is not assignable to type 'AuditSeverity'`，移除後回到零診斷 ⇒ `AuditSeverity` 確實被推成三字面量 union，而非退化成 `string`（[[feedback_ts_negative_control_proves_suppression_load_bearing]]）。
>
> ⚠ 此為**片段級**量測，僅證明 (a)+(b) 在孤立編譯下乾淨；**不**取代 project 級 overlay。植回真實 `audit-policy.ts`（含 `AUDIT_CATEGORY` / `REGISTRY` / `classifyForCold`）後的 project 級結果見 **§6.2**（§4.1(a)+(b) 隔離量測）與 **§6.1**（現行 §4 全套），兩者皆為實測、非推論。

**`ARCH-C2-R2-L2` fallback 位置定案**：明示選擇**第二支**（由具 category context 的 classification 層處置）。理由：category-aware fallback 在定義上需要 `event_type → category`，純 parser 無法獨力完成。

**REGISTRY 不受影響**：本節不新增／不移除任何 event_type，`_registrySize` 維持 `228`，`tests/audit-policy.test.ts:364` 與 `:284-291` 的斷言不變。

### 4.2 `functions/utils/user-audit.ts` 型別

**import hunk（`:22`，沿用同檔 `:24` 既有的獨立 `import type` 行慣例）**：

```diff
- import { classifyAuditEvent, classifyForCold } from './audit-policy'
+ import { AUDIT_CATEGORY, classifyAuditEvent, classifyForCold, parseAuditSeverity } from './audit-policy'
+ import type { AuditSeverity } from './audit-policy'
```

`AUDIT_SEVERITY` **不**被 user-audit.ts import（§4.3 的程式碼不需要它）。

```ts
/** 本模組實際讀取的 env capability（沿用 Env 為單一真相源，同 device-alerts.ts:27 AlertEnv 慣例）。 */
type UserAuditEnv = {
  chiyigo_db?: Env['chiyigo_db'] | null
  AUDIT_IP_SALT?: Env['AUDIT_IP_SALT']
  DISCORD_AUDIT_WEBHOOK?: Env['DISCORD_AUDIT_WEBHOOK']
}

type UserAuditEntry = {
  event_type: string
  severity?: AuditSeverity
  user_id?: number | null
  client_id?: string | null
  request?: Request
  trace_id?: string | null
  data?: Record<string, unknown>
}

type CriticalNotice = UserAuditEntry & {
  severity: AuditSeverity
  ipHash: string | null
  traceId: string | null
}
```

- `UserAuditEntry` **file-local，不 export**。測試端以 `Parameters<typeof safeUserAudit>[1]` 取得，避免為測試擴大 public surface。
- `client_id` / `trace_id` **必須納入**：實作分別於 `:95`、`:76` 讀取，省略會產生 TS2339。這不是文件契約選擇題。
- ⚠ **`severity?: AuditSeverity` 之定位（① `ARCH-D-L1`）**：本欄位是 **validated application-domain contract**，🚫 **不得**再被描述為 raw external string boundary。`safeUserAudit` 內的 `parseAuditSeverity` 是針對**不健全來源**（`any`、`.js` caller、`strictNullChecks=false`）的 **defense-in-depth**，非 raw 邊界驗證。真正的 raw caller（未來若有）**必先呼叫 parser**，🚫 不得 cast。此定位與 §2.1.2 row 6 之「raw 欄位＝D1 row 的 `severity` 欄維持 `string`」不衝突：前者是 write-path 入參（已驗證域），後者是 read-path row 型別（未驗證域）。
- ⚠ **`UserAuditEnv` 為 TS weak type（三鍵全 optional）—— 就地載明其語義，🚫 不得只寄生在 §7.3 的 SPEC-D1 例外段**：零共同屬性之 env 會被 **TS2559** 擋下（§7.3 之 `AlertEnv` 個案即此），但**僅帶其中一鍵**者（如 `{ AUDIT_IP_SALT: 'x' }`）**不會**被擋；缺 D1 binding 的最終防線是 `user-audit.ts:67` 的 runtime guard（**base 既有行為，本 PR 不改**）。
  ⚠ 三項限定，避免此節被反覆重開：(a) **方向為淨收緊**：base 五個簽章皆 implicit `any`，weak type 嚴格強於 `any`；(b) **今日可達集合 ＝ ∅**（⚠ 枚舉軸須涵蓋**三個 key 的全部 entry point**，🚫 不得只查 `safeUserAudit(`／只查 `chiyigo_db` —— `UserAuditEnv` 由五個函式共用，`AUDIT_IP_SALT` 面另有獨立 caller）：<br>　• **`chiyigo_db` 面**：`functions/**` 全部 `safeUserAudit(` 呼叫點第一引數皆為 `env`／`ctx.env`（型別 `Env`，`chiyigo_db` 於 `types/env.d.ts:23` 必填），`safeUserAudit({` object-literal 呼叫形 **0** 命中。<br>　• **`AUDIT_IP_SALT` 面**：`hashIdentifierForAudit(` 實測 **20 個 caller／8 個 domain**（`credential-detail` · `credential-id` · `device-uuid` · `guest-id-audit` · `metrics-ip` · `oauth-provider` · `session-id-audit` · `wallet-address`），第一引數**全部**為 `env`，`hashIdentifierForAudit({` object-literal 形 **0** 命中；`hashIp` 為 file-local，唯一 caller 是同檔 `:75`。<br>　• **`DISCORD_AUDIT_WEBHOOK` 面**：`notifyCritical` 為 file-local，唯一 caller 是同檔 `:160`，env 直接沿用 `safeUserAudit` 之入參。<br>　• 唯一 capability-窄化 caller `device-alerts.ts:27 AlertEnv` 含 `chiyigo_db`；(c) **repo 內已有同型前例**：`functions/utils/jwt.ts:35` `type JwtVerifyEnv = Partial<Pick<Env, 'JWT_PUBLIC_KEYS' | 'JWT_PUBLIC_KEY'>>` 為全 optional weak type，位於 JWT 驗簽路徑，理由同為測試便利、並以註解（`:31-33`）記錄較強之 runtime 契約。
  🚫 **不得**改為 `Pick<Env, 'chiyigo_db' | …>`：五個共用此型別的函式中，`hashIp`（`:32-41`）· `hashIdentifierForAudit`（`:215-234`）· `notifyCritical`（`:240-251`）**各讀 `chiyigo_db` 0 次**，唯一讀者為 `safeUserAudit:67`；在 SPEC-D1 鎖定的單一共用型別下把它設必填 ＝ 5 個函式中 3 個被迫索取永不使用的 capability（least-capability 反例）。
- **capability type 的理由**（SPEC-D2 修正後）：`:67` `if (!env?.chiyigo_db) return` 已是明示 runtime 契約，型別應忠實表達；並為後續 `strict:true` 階段保留 `chiyigo_db: null` 負向測試的合法表示。
  **不得宣稱**它在目前 `strict:false` 環境下消除了任何既有 suppression——實測該環境下 `env: Env` 亦不需 suppression。

五個函式簽章：

| 位置 | 變更後 |
|---|---|
| `:32` `hashIp` | `(env: UserAuditEnv, ip: string \| null \| undefined): Promise<string \| null>` |
| `:47` `extractTraceId` | `(request: Request \| undefined, explicitTraceId: string \| null \| undefined): string \| null` |
| `:65` `safeUserAudit` | `(env: UserAuditEnv, entry: UserAuditEntry): Promise<void>` |
| `:215` `hashIdentifierForAudit` | `(env: UserAuditEnv, domain: string, raw: string): Promise<{ hex: string; bytes: Uint8Array; salted: boolean }>` |
| `:240` `notifyCritical` | `(env: UserAuditEnv, entry: CriticalNotice): Promise<void>` |

**OD-D3 第二交付物：`String(raw)` 保留 + 註明理由。** 於 `:228-229` 上方加**行註解**（非 JSDoc，避開 §13 的 brace-type 禁令），內容須為已驗證事實：

> `raw` 僅在編譯期為 `string`。實測 20 個 caller 中 **6 個傳 `any`**（`admin/revoke.ts:196` · `auth/refresh.ts:223` · `auth/devices/logout.ts:101` · `auth/local/register.ts:157` · `webauthn/login-verify.ts:183` · `:267`），型別在該 6 處給不了 runtime 保證。`String()` 的實質作用是讓 runtime `undefined` 編成 `"undefined"` 而非與 `''` 產生**相同 HMAC 摘要**造成稽核識別符互撞／誤歸屬；`null`／number／object 有無 `String()` 結果相同。**故本行不得因「參數已是 string 看似冗餘」而在後續 `strict:true` 階段被清掉。**

⚠ 不得沿用「移除會讓非字串輸入直接進 HMAC」這類說法——`TextEncoder().encode()` 本身會做 `String()` 轉換，該說法為假。此 hunk **不屬於** JSDoc/source-comment 對齊 backlog（§13），為 OD-D3 明列交付物。

### 4.3 severity 邊界（硬鎖）

```ts
const category = classifyAuditEvent(entry.event_type)
if (entry.event_type && !category) {
  console.warn('[audit-policy] unclassified event_type:', entry.event_type)
}
// 二分（ARCH-C2-R2-L2）：省略/undefined ＝ 合法預設 info、不記 invalid log；
// present-but-invalid（null / 'PANIC' / 非字串）＝ 才進 category-aware fallback。
const parsed = entry.severity === undefined ? 'info' : parseAuditSeverity(entry.severity)
const severity: AuditSeverity =
  parsed ?? (category === AUDIT_CATEGORY.SECURITY_SIGNAL ? 'critical' : 'info')
if (parsed === null) {
  console.warn('[audit-severity-invalid] illegal severity coerced by category-aware fallback', {
    event_type: typeof entry.event_type === 'string' ? entry.event_type : `<${typeof entry.event_type}>`,
    category: category ?? null,
    fallback: severity,
    notified: false,   // fallback 產生的 critical 一律不觸發 webhook（見下表）
  })
}
```

決策表（**適用範圍**：`safeUserAudit` 單一入口；**生效時態**：本 PR 合入後；**例外集合**：∅；**closure**：末列為**補集**，四列聯集覆蓋 `entry.severity` 的完整 runtime 值空間）：

| `entry.severity` | `parsed` | 儲存 severity | `cold_class` 來源 | invalid log | Discord |
|---|---|---|---|---|---|
| 省略 / `undefined` | `'info'` | `info` | `classifyForCold(et, 'info')` | 否 | 否 |
| `'info'` / `'warn'` / `'critical'` | 原值 | 原值 | `classifyForCold(et, 原值)` | 否 | **僅**原值 `=== 'critical'` |
| `null` | `null` | category-aware | 同儲存值 | **是** | 否 |
| **其他任何**值：`entry.severity !== undefined` 且不嚴格等於三字面值之一（示例：`'PANIC'` · 大小寫變體 · 空字串 · number · bigint · boolean · symbol · object · function） | `null` | category-aware | 同儲存值 | **是** | 否 |

category-aware fallback：`SECURITY_SIGNAL → 'critical'`；其餘 category 與未分類 → `'info'`。

**四條不變量**：

1. **不降級**：非法 severity 不得解析成 retention 較短的結果（C2 carry-forward lock）。`security_signal` 取 `critical` 即為此。
2. **row/class parity**：`cold_class` 必須由**同一個有效儲存值**計算（`:83` 沿用 `severity` 變數），禁止 stored severity 與 cold_class 分歧，否則觸發 `audit.archive.cold_class_drift` gate。
3. **Discord eligibility 只由 `parsed === 'critical'` 決定**——亦即「成功解析出的原始 `critical`」。省略 → `'info'` ≠ critical；fallback 得到的 `critical` 因 `parsed === null` 而不觸發。實作為把現行 `:156` 的 `severity === 'critical'` 改為 `parsed === 'critical'`。
4. **既有行為維持**：`[audit-policy] unclassified event_type:` 的觸發條件（`entry.event_type` truthy 且未分類）、訊息字串與呼叫次數不變；`:101-154` missing-column fallback 與 `:162-171` audit-loss catch 不變。

**`KNOWN_SEVERITY` (`:26`) 移除**，其職責由 `parseAuditSeverity` 承接。

### 4.4 `functions/api/admin/event-dlq/[id]/replay.ts`

唯一乾淨檔 cascade。兩行：

```ts
+ import type { AuditSeverity } from '../../../../utils/audit-policy'
- async function auditReplay(env: Env, request: Request, userId: number, severity: string, data: Record<string, unknown>) {
+ async function auditReplay(env: Env, request: Request, userId: number, severity: AuditSeverity, data: Record<string, unknown>) {
```

五個 caller（`:32` `:41` `:52` `:76` `:79`）全部傳合法字面量（`'warn'`×4 / `'info'`×1），零連鎖。

### 4.5 `functions/api/webhooks/payments/[vendor].ts`（變體 D 唯一 hunk）

`:222` 的顯式標註使 `liveIntent.user_id` 為 `number | string | null`，與 `user_id?: number | null` 不相容（實測 TS2322）。**唯一允許的 hunk**：

```ts
- user_id:    liveIntent?.user_id ?? null,
+ user_id:    typeof liveIntent?.user_id === 'number'
+   ? liveIntent.user_id
+   : null,
```

**行為等價逐例證明**（對照現行 `user-audit.ts:94` `Number.isFinite(entry.user_id) ? entry.user_id : null`）：

| `liveIntent.user_id` | 現行落庫 | 變更後落庫 |
|---|---|---|
| finite number | 該值 | 該值 |
| `NaN` / `Infinity` | `null` | `null`（`typeof` 通過後仍被 `Number.isFinite` 濾掉） |
| `string`（如 `'5'`） | `null`（`Number.isFinite('5') === false`） | `null` |
| `null` / `undefined` | `null` | `null` |

**四例全同。** 選 D 而非放寬契約的理由：`audit_log.user_id` 與 `payment_intents.user_id` 皆為 `INTEGER`，`string` 是該處防禦性過度標註；把 `string` 永久納入 289 個 caller 共用的稽核契約，而實作又刻意把它轉成 `null`，會使型別契約與實際行為矛盾。

**限制**：本檔**只允許上述一個 hunk**（適用範圍：本 PR；生效時態：即刻；例外集合：∅）。不得順帶修改 webhook 驗簽、dedupe、DLQ、狀態轉移或任何其他邏輯。

---

### 4.6 `notifyCritical` 的 bounded timeout（`GPT-D-ARCH-RR1` 選項 B，owner 2026-08-05 裁定）

**為何納入本棒**：① `GPT-D-ARCH-RR1` 判定「以 repo 內未設定 `DISCORD_AUDIT_WEBHOOK` 推導 production 一定未設定」跨越 repo↔deployment 信任邊界、不成立。⇒ `DISCORD_AUDIT_WEBHOOK_PROD_STATE = UNKNOWN`。owner 選擇**選項 B（先行納入 bounded timeout）**而非 A（取得外部 presence receipt），使該邊界問題**不再承重** —— 無論 webhook 是否 live，該外呼皆會在 **8000ms 後被請求取消**（🚫 **不得**述為「皆有上限」；精確語義與三項殘留見 §4.6 標軸段之唯一定義處）。

**zero-env 變體**（🚫 不擴 `UserAuditEnv`／`types/env.d.ts`；前例 `functions/api/auth/email/send-verification.ts:23`、`functions/api/tenants/[tenantId]/invitations/index.ts:23`）：

```ts
/** Discord webhook 外呼逾時後請求取消（非精確 wall-clock 上限；見 PLAN §4.6）。
 *  目的：防單一外部服務卡住把 Worker 拖進平台 wall-clock 限制。
 *  zero-env：不讀 Env，故無須擴 UserAuditEnv／types/env.d.ts。前例 send-verification.ts:23 */
const AUDIT_WEBHOOK_TIMEOUT_MS = 8000
```

`notifyCritical`（`:246`）的 `fetch` 改為：

```ts
  // TECH-DEBT: notifyCritical 仍無 retry policy 且為 await 同步等待（TD-BATCHD-1 根因 (2)(4)），且投遞失敗零可觀測性（見 §10.1.2 之 (F-a)/(F-b)/(F-c)）— docs/plans/stage7-pr2dw-batchd-user-audit-severity-parser.md
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AUDIT_WEBHOOK_TIMEOUT_MS)
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
```

**三項不變量**：

1. **錯誤處理不新增路徑** —— abort 觸發時 `fetch` reject，由**既有**的 `:160` `try { await notifyCritical(…) } catch { /* swallow */ }` 承接，與任何 fetch **reject** 同路。

   ⚠ **失敗類二分（本檔唯一定義處，四處引用點見下；適用範圍：`notifyCritical` 之外呼；生效時態：本 PR 後；例外集合：∅；closure：`fetch` 之失敗僅此二類）**：
   - **(F-a) network／DNS／TLS／abort ⇒ `fetch` reject** ⇒ 進 `:160` 空 catch ⇒ 靜默吞掉、不影響落庫。§4.6 新增的 abort 屬本類。
   - **(F-b) HTTP 非 2xx（Discord 回 4xx／5xx／rate-limit 429）⇒ `fetch` 正常 resolve、不 reject** ⇒ **完全不進** `:160` catch；且 `notifyCritical`（`:246-251`）**從不讀 `res.ok`／不持有 response 變數** ⇒ **連「失敗」本身都未被偵測**，零訊號。
   ⚠ **(F-b) 為 base 既有性質，本 PR 不改變**，🚫 不得歸因於 §4.6。🚫 本棒**不**補 `res.ok` 檢查或 log —— 那是 `user-audit.ts` 的第 4 組 hunk，逾越 §5.1 對該檔的三 hunk 自我約束；追蹤見 §10.1「殘留」欄。
   🚫 **不得**再以「失敗一律由 `:160` catch 吞掉」作為全稱描述 —— 該句只對 (F-a) 成立。
2. **`audit_log` 欄位值零影響** —— 本 hunk 只約束外呼，**不碰** severity／cold_class／任何 INSERT 引數 ⇒ §12 的「落庫等價」自我約束（其客體即 `audit_log` 欄位值）不受影響。<br>⚠ **標題須帶客體，🚫 不得寫無限定的「落庫零影響」**：`handleOrphan` 的持久寫入客體是**三張表**（§11.3-5：`audit_log` → `payment_webhook_dlq` → `payment_webhook_events`）。依 §10 自身之因果，§4.6 使原本可能被 wall-clock 砍掉的 handler 得以續行 ⇒ 在 §10 之 (2a) 情境下產生**兩種性質不同**之 durable effect（② `CODEX-D-PLAN-R3-RR1`；🚫 **不得**混稱為「row 由不發生變為發生」）：**(甲) 可能新增**一筆 `payment_webhook_dlq` row（`:243-254` 之 strict `dlqInsert`）；**(乙) 既有**之 `payment_webhook_events` row 可能完成 `processing → applied`／`processing → failed` **狀態轉移**（`handleOrphan` 內為 `:256`／`:260`；`markWebhookEventFailed` 之五個呼叫點見 §10 之 (2a) 列）—— ⚠ 該 row **早於 `:159-163` 請求進入時即 `INSERT OR IGNORE … 'processing'`**，🚫 **非**本軸新建。兩者方向皆為改善。本不變量之 4-tuple **不涵蓋該軸**；該軸之 **rollback 處置見 §12 (c)**（revert 後該等 row 保留、🚫 不得刪除或倒轉；數量 `UNMEASURED`）。③④ 依 `ARCH-D-L5` 採 L3 payment lens 時須合讀 §10 與 §12 (c)。此與本節 §4.6 之「不得只寫方向為收斂而不標軸」屬同一紀律。
3. **觸發集合零變更** —— Discord 是否發送仍由 §4.3 不變量 3（`parsed === 'critical'`）決定，本 hunk 不改 gate。

**型別成本已 `MEASURED`（2026-08-05）**：以 §6.1 同一 overlay 工具加掛本 hunk 重跑 ⇒ `base 373 / overlay 362 / REMOVED 11 / ADDED 0`，與未加時**完全相同**。⇒ §1 之**四列**量化目標（`REMOVED` / `ADDED` / ratchet current / baseline，見 §1 表；🚫 先前誤稱「六項」——§1 表為 4 列。⚠ 本更正之客體**限定為「量化目標」**：本檔他處確有「六項」枚舉（§2.1.2 `ARCH-C2-R2-L2` 六項必定案 · §3 之 6 項），與量化目標無關，🚫 不得把本句讀成「全檔無六項」之全稱否定）、§5.1 allowlist（`user-audit.ts` 已在內、仍 4 檔）、§5.5 suppression 預算（恰 2）與 `as const`（0）**全部不變**。

⚠ **本 hunk 新增一條 runtime 軸，並帶來本 PR 唯一今日可觀測之 runtime 變更**（② `CODEX-D-PLAN-R2-RR1` Required）。🚫 **不得回寫為「本棒由『純型別收斂』變為 runtime 變更」** —— §4.3 之 fallback 映射本即 runtime 行為軸，該寫法與下句自我矛盾，此誤已發生過。<br>⚠ **② 之最小修正原文為「§4.6 新增**第二條** runtime 軸」，但本檔既有標號為 (軸 1)＝§4.6、(軸 2)＝§4.3** ⇒ 照字面寫「第二條」會與下一句的標號直接衝突。故採**不帶序數**之寫法；🚫 不靜默改寫 ② 原文，改以本註記更正並隨 R3 packet 呈給 ②。<br>⚠ **本 PR 之 runtime 行為軸恰兩條，🚫 不得只列一條**（② `CODEX-D-PLAN-R5` Required）：**(軸 1) §4.6 bounded timeout** —— 對**今日可達輸入**即產生可觀測差異，故為本 PR **唯一今日可觀測**之行為交付物；**(軸 2) §4.3 之非法 severity fallback 映射** —— 映射確實改變（表頭動工級別欄已列為 L2 依據之一），但其 present-but-invalid **今日可達集合 ＝ ∅**（§12 第 2 點舉證）⇒ 今日落庫值不變。兩軸皆為 runtime 變更，差別在**今日可觀測性**而非「是否為行為變更」。③④ 之 review lens 依 ① `ARCH-D-L5` 採 **L3 payment + distributed-state**。

⚠ **「收斂」之比較軸須限定**（適用範圍：本 hunk；生效時態：本 PR 後；例外集合：見下第二點；closure：下列兩軸窮盡本 hunk 之影響面）：

1. **wall-clock 軸 ＝ 收斂**（無界 → **8000ms 後請求取消**），非擴張。這是本 hunk 的目的，也是 §10／§11.3-4／§11.3-5 所援引的那一軸。<br>⚠ **精確語義（本檔唯一定義處；② `CODEX-D-PLAN-R2` Required）**：`setTimeout` 於 8000ms 觸發 `ctrl.abort()`，`fetch` 隨之 reject，handler 之 `await` 結束。🚫 **不得**述為「數學上的 8000ms wall-clock 上限」—— (a) timer 排程本身受 event loop 影響、(b) abort → reject 之傳播另有延遲、(c) **平台是否真正取消 in-flight 請求本棒未驗證**（abort 分支不被自動測試，取捨見 §8.2.2）。三者皆為**顯式殘留風險**，🚫 不得以「有界」二字掩蓋。
2. **告警投遞軸 ＝ 擴張** —— 新增一個丟棄觸發點：**未於 8000ms 內完成之投遞，經 timer callback 要求取消後 reject**，落入 (F-a) 靜默丟棄。🚫 **不得**述為「確定性丟棄點」或精確門檻 —— 其觸發時點受本段第 1 點之三項殘留影響（② `CODEX-D-PLAN-R2-RR2` Required）。⚠ 但 🚫 **不得**據此宣稱「§4.6 製造了系統性靜默」：(F-b)（HTTP 非 2xx 零偵測）**base 即存在**且不經本 hunk；本 hunk 只在 (F-a) 內新增一個觸發條件。

⚠ **委派範圍須限定，🚫 不得寫「整體」**：不變量 1 的 (F-a)/(F-b) 二分之 closure 客體是「**`fetch` 之失敗**」，**不涵蓋 `fetch` 從未發出**的情形 —— `user-audit.ts:241-242` 的 `if (!url) return`（**(F-c)**：`DISCORD_AUDIT_WEBHOOK` 缺值）外呼根本不發生、`:160` 空 catch 不會被進入、零 log。⇒ 本處僅委派「**`fetch` 已發出後**」之投遞可觀測性缺口予 §10.1.2；**(F-c) 亦由 §10.1.2 承接，但須在該節顯式列出**，🚫 不得以 (F-a)/(F-b) 二分代表投遞失敗全集。
⚠ 佐證此非外來分類：`user-audit.ts:159` 的**既有**註解自己把「**webhook URL 缺值** / Discord 失敗」並列為被吞的兩件事，且把 URL 缺值列在**第一位**。此紀律與本節「不得只寫方向為收斂而不標軸」同型。

🚫 不得只寫「方向為收斂、非擴張」而不標軸 —— 未標軸的全稱句會使 ③④ 以「純收斂」lens 審查，漏掉第 2 點。

---

## 5. Exact change scope

### 5.1 Production allowlist（4 檔）

1. `functions/utils/audit-policy.ts`
2. `functions/utils/user-audit.ts` — 三組 hunk：§4.2（三型別 ＋ 五簽章）· §4.3（severity 邊界 ＋ `parsed === 'critical'` gate）· **§4.6（bounded timeout）**
3. `functions/api/admin/event-dlq/[id]/replay.ts`
4. `functions/api/webhooks/payments/[vendor].ts` — **僅 §4.5 一個 hunk**

### 5.2 Tests / fixtures allowlist（5 檔）

- `tests/audit-policy.test.ts`
- `tests/integration/user-audit.test.ts`
- `tests/integration/user-audit-loss.test.ts`
- `tests/integration/_setup.sql` — **僅 `:245` 所屬的 `audit_log` 建表**（不得碰 `:293` / debug aggregate 等其他 `severity` 欄）
- `tests/integration/migrations.test.ts` — 兩處變更點（**除第 2 處另含一行頂層 import 外**，皆為既有 describe 內的新增）：
  1. `:1306`「0038 targeted」block 的手工 fixture 加 CHECK + 新增斷言
  2. `:501` full-forward-chain describe 加**端態**斷言（§8.4-5），**另含新增一行頂層** `import { AUDIT_SEVERITY } from '../../functions/utils/audit-policy'`（該檔現對 `functions/` 的引用數實測為 0，此為首次跨層 import）

  > **歷程註**：原第 3 變更點（`up0017` raw 文本跨檔比對，舊 §8.4-6）已於 plan self-review round 2 移除，理由見 §8.4-5 之「為何不另立 raw 文本比對」。該變更點屬自審輪次新增、非 owner 於 SPEC 核准之 OD-D4 五項內，移除為**縮小** scope。頂層 import **不隨之消失**：§8.4-5(i) 的雙向 set equality 本身即需 `AUDIT_SEVERITY`。
  >
  > **跨層 import 的取捨（顯式論證，非既成事實陳述）**：本棒替 `migrations.test.ts` 新增其史上第一個 `functions/` 依賴，而該檔同時是「describe 順序 load-bearing」且是 `lint:migrations` 的 `TEST_FILE` 客體（§9.1），故此依賴**不是零成本**。
  >
  > **本棒評估過的替代方案**（適用範圍：本 PR 之 §5.2 allowlist；生效時態：本 PR；例外集合：∅；closure：下列四項為本棒評估之全集，🚫 不宣稱為解空間全集）：
  >
  > | 替代方案 | 否決理由 |
  > |---|---|
  > | (a) 測試端硬編三值 | 使 §8.4-5(i) 退化成「硬編陣列比硬編陣列」的套套邏輯，**直接廢掉 §2.1.1 第 3 項承諾的機械化 domain-drift 偵測**（C2 §5.2.4 第 3 項明令「必須有機械保障，🚫 不得只寫成 prose」） |
  > | (b) 斷言改放已依賴 `functions/` 的 `user-audit.test.ts` | 該檔無 `ALL_UPS` 端態；端態只在 `migrations.test.ts:501` describe 的 `beforeAll` 內建構 ⇒ 換檔即失去斷言對象 |
  > | (c) 保留舊 §8.4-6 的 `up0017` `?raw` 比對 | 已於 round 2 依 owner 裁定移除（誤報源，見 §8.4-6），且它同樣需要該 import |
  > | (d) 三值 SoT 另置於 `tests/` 共用常數再雙向比對 | 製造第二份 SoT，抵觸 §8.4-1 單一 SoT；且 production 常數與測試常數漂移時無人偵測 |
  >
  > ⇒ (a)–(d) 皆劣於現案。
  >
  > ⇒ 取「一行 **test-runtime value import**」換「C2 carry-forward lock 的實質履行」。該 import 只引入 `AUDIT_SEVERITY` 一個 frozen 常數、**無外部副作用**、**不引入 production-runtime 相依**（⚠ ② `CODEX-D-PLAN-INFO-1`：🚫 不得寫成「type-only import」或「不引入 runtime 相依」—— 它是 **value import**，於 **test runtime** 被 `Object.values()` 取值，是 §8.4-5(i) 之機械耦合端點本身）（`audit-policy.ts` 為純資料 + 純函式模組），亦不改動 describe 順序。

  ⚠ **禁止新增或重排 `describe` block**。該檔的 describe 順序是 load-bearing：`:609` `:753` `:797` `:829` `:906` `:1021` `:1114` 七處註解明載其他 describe 必須排在「0038 targeted」之前，因為後者是最後一個 schema mutator，留下 `user-audit` / `register` / `payments-ecpay` 等測試檔透過共用單 worker D1 所仰賴的無 FK `audit_log`。新增斷言一律放進**既有** describe 內。

### 5.3 Governance allowlist（1 檔）

- `docs/plans/stage7-pr2dw-batchd-user-audit-severity-parser.md`（本檔）

> **`changed-files ≠ production allowlist`**。三張清單分列；plan doc、tests、fixtures **不得**混入 production allowlist。Dual Gate v3.1 §7 AMENDMENT 規則 1：plan doc 自 SPEC 起即納入 allowed changed-files（批 A 漏此條，導致另開 closeout PR #150）。

### 5.4 明確排除 — `D_EXCLUDES`

本節即 §11 所引用之 `D_EXCLUDES` 定義（與 §2 `D_PRIMARY_SOURCE` 同一命名體系）：

```
D_EXCLUDES = {
  F3_PROTECTED: [
    functions/utils/audit-archive.ts,
    functions/utils/audit-aggregate-archive.ts,
    functions/utils/audit-aggregate-archive-runner.ts,
  ],
  ARCHIVE_ADJACENT: [ functions/api/admin/cron/audit-archive.ts ],   // 非 F-3 三檔，但本棒亦不觸碰
  OTHER: [
    其餘 13 個 diagnostic files,
    functions/utils/device-alerts.ts,      // 不得為解 SPEC-D1 而擴充其 AlertEnv
    functions/api/admin/audit.ts,          // VALID_SEVERITY 依 C2 §5.1 刻意不納
    types/env.d.ts,
    migrations/**,                          // 所有 production migration
    tsconfig*.json, ratchet baseline, dependencies,
    CLEANUP_PLAN.md,                        // 既有 untracked，永不 stage
  ],
  WORK_ITEMS: [ 16 單元 mapping 治理, JSDoc/source-comment 對齊 backlog,
                GOV-MERGE-INTEGRITY-EXTRACT-001 ],
}
```

### 5.4.1 `COLD_CLASS_VERSION` 裁決

**`COLD_CLASS_VERSION = NO_BUMP`。**

**0. 先對話唯一寫著相反（寬）判準的 repo 文件。** `docs/AUDIT_RETENTION_PLAN.md` 三處 live 命中點皆寫「**audit-policy 改動時 bump**」：`:104`（`## v8 主要變更` changelog）· `:295`（Manifest 結構 living body）· `:538`（Schema 變更 living body）。第 4 個命中點 `functions/api/admin/cron/audit-archive.ts:75` 的註解自帶「（design doc v8 cold_class_version）」，是前者的衍生物；C2 的 `GPT-C2-ARCH-RR2` 只追蹤該 source comment，**docs 三處不在任何 closure 內**。

本棒採**窄判準**：「**runtime cold-class classification semantics 改變時**才 bump」（依據 C2 §2.4.1）。並顯式承接 §12 的事實——本 PR 確實改變「同一輸入 → 落庫值」的映射（present-but-invalid + `SECURITY_SIGNAL` 之 `cold_class` 由 `security_warn` 變 `security_critical`）——但 §12 已證**今日可達集合 = ∅**，故窄判準下亦不觸發。docs 三處與窄判準的落差列 §13 非目標。

⚠ `docs/AUDIT_RETENTION_PLAN.md` **不在**本棒任何 allowlist，本節僅引用、不編輯。

C2 已把「不 bump」例外**限定於 type-only／byte-identical emit 變更**並禁援引為先例；批 D 是 L2 runtime 行為變更，故**必須自行舉證**，不得沿用 C2 的豁免：

1. **classifier 世代未變**：`classifyForCold`（`audit-policy.ts:408-419`）的映射表與 `REGISTRY` / `_registrySize=228` 零改動（§4.1 已鎖）。
2. **archive 端 re-classification 契約不變**：`rowMatchesColdClass`（`audit-archive.ts:715-716`）讀的是**已落庫 severity** 重推，對既有 row 判定結果完全相同。
3. **無歷史語義分歧**：現行 `user-audit.ts:74` 在 INSERT 前已把所有非法 severity normalize 成 `'info'`，D1 內不存在「以非法 severity 產生的 row」；且 §12 已證今日 present-but-invalid 可達集合為 ∅。變更點在 write-path 輸入端。
4. **bump 反有實害**：值寫進 write-once R2 manifest（不可逆）、假性切分 forensic 世代；且 `tests/audit-archive.test.ts:340` 與 `tests/audit-aggregate-archive.test.ts:231` 皆斷言 manifest 欄位 `cold_class_version === 1`，bump 會破這兩檔 —— **兩檔不在任何 allowlist**。
5. **scope consistency 檢查（🚫 非正確性證據）**：常數只存在於 `functions/api/admin/cron/audit-archive.ts:76`（§5.4 `ARCHIVE_ADJACENT`）與 `functions/utils/audit-aggregate-archive-runner.ts:75`（§5.4 `F3_PROTECTED`），兩者皆在 `D_EXCLUDES` 內 ⇒ 裁決與 scope 一致。
   ⚠ **本項不得作為 `NO_BUMP` 的正確性論據**（① `GPT-D-ARCH-RR2`）：scope 禁止修改版本常數只能證明「**改不到**」，不能證明「**不該改**」。初稿以「allowlist 已機械性保證 NO_BUMP」為據，現降級為純一致性檢查。

### 5.4.2 `COLD_CLASS_VERSION` 之一次性架構例外（`GPT-D-ARCH-RR2` Required）

① 判定：`NO_BUMP` 的**結果**可辯護，但**治理方式**不可接受 —— PLAN 自承 `docs/AUDIT_RETENTION_PLAN.md` 三處 live 判準寫「audit-policy 改動時 bump」，而本 PR 確實改變 invalid raw input → stored severity／cold_class 的 runtime 映射；把此衝突列為「非目標」等於由本 PLAN 單方面窄化既有 SSOT。

**本棒據此建立一次性架構例外（明文，非默示）**：

```text
本批的 COLD_CLASS_VERSION 僅描述 persisted
(event_type, severity) → cold_class 與 manifest interpretation；
不涵蓋 raw-input normalization。
```

⇒ 本 PR 改變的是 **raw-input normalization**（哪些非法輸入被 coerce 成什麼 severity），**未**改變 persisted 值對之重推函式，亦未改變 archive verifier 對既有 row 的解讀 ⇒ 在上述界定下 `NO_BUMP` 成立。

🚫 **不得援引為一般 runtime audit-policy 變更之先例**（適用範圍：本 PR；生效時態：即刻；例外集合：∅；closure：僅涵蓋 raw-input normalization 一軸，任何觸及 persisted 重推函式或 manifest 解讀之變更**不適用**本例外）。

**三處 live 文件落差之收斂**：

| 欄位 | 內容 |
|---|---|
| backlog ID | **`GOV-COLD-CLASS-VERSION-CRITERION-001`** |
| 標的 | `docs/AUDIT_RETENTION_PLAN.md` 之三處 live 寬判準：`:104`（`## v8 主要變更` changelog）· `:295`（Manifest 結構 living body）· `:538`（Schema 變更 living body） |
| 問題 | 三處皆寫「audit-policy 改動時 bump」，與本節之窄判準（「runtime cold-class classification semantics 改變時才 bump」）分裂；C2 之 `GPT-C2-ARCH-RR2` closure 只綁 source comment，**未涵蓋 docs 三處** |
| owner | **repo owner**（單一 owner；🚫 不得留「待指派」—— ① RR1 第 3 點之同一理由：無 owner 的觸發條件不構成可執行控制） |
| 觸發條件 | **最遲須於下一次 `functions/utils/audit-policy.ts` 之 runtime semantic change 前收斂**（型別／註解／純資料重排不觸發）。二選一：把三處改為窄判準，或把窄判準廢除改採寬判準並回頭 bump。<br>⚠ **本觸發條件非機械觸發**（比照 §10.1.1 之同型申報）—— repo 內無任何 lint／test／CI 會在該檔 runtime semantic change 時提示本判準；依賴 owner 或承接棒次於該棒 SPEC/PLAN 階段主動回查本節。🚫 **不得**於本棒在 `audit-archive.ts:75-76` 常數旁補指標 —— 該檔在 §5.4 `D_EXCLUDES.ARCHIVE_ADJACENT` 內，動它即 scope creep |
| 本棒立場 | 🚫 **不改** `docs/AUDIT_RETENTION_PLAN.md` —— 該檔不在任何 allowlist，改它＝scope creep |

### 5.5 Suppression 預算

**新增 `@ts-expect-error` 恰 2 個**（適用範圍：本 PR 的 changed-files；生效時態：本 PR；例外集合：∅；closure：下列兩處窮盡）：

1. `tests/integration/user-audit-loss.test.ts` — 非字串 `event_type` 回歸
2. `tests/integration/user-audit.test.ts` — 共用 helper，供**兩個**非法 severity 案例使用

```ts
// 同一概念同一字串（feedback_state_machine_naming_no_alias）：測試端沿用 production 名稱，
// 以結構萃取取得，不需 export（§4.2 的 file-local 決策不變）。
type UserAuditEntry = Parameters<typeof safeUserAudit>[1]

function writeWithInvalidSeverity(entry: Omit<UserAuditEntry, 'severity'>, severity: string) {
  // @ts-expect-error -- deliberate illegal severity: runtime negative control for the category-aware fallback
  return safeUserAudit(env, { ...entry, severity })
}
```

⚠ **「恰 2 個」無機械 gate**：ratchet 的 `checkDiffSuppressions()` 只驗 `-- <reason>` 格式與長度，**不驗數量**。數量須於 coding 後以 `git diff` 逐字清點，作為 Code Gate 證據。

禁 `as any` · double cast · `@ts-ignore` · `@ts-nocheck` · 其他 suppression · **`as AuditSeverity` 及任何 severity 相關 type assertion**（後者為 C2 §5.1 規格表「非法值：🚫 assertion 消音」之落地；⚠ 它是 cast 不是 suppression，ratchet 的 `BAN_PATTERNS` **抓不到**，須於 Code Gate 以 `git diff` 人工清點）。

**`as const` 預算：本 PR changed-files 的新增（`+`）行中恰 0 處**（適用範圍：changed-files 之新增行；生效時態：本 PR；例外集合：`tests/audit-policy.test.ts` 既有 5 處 `:385` `:394` `:403` `:435` `:444`，屬批 C2 核准鎖，**逐字不動、不得增刪**；closure：合入後該檔總數維持 **5**，其餘 changed-files 合計 **0**）。

> **為何預算是 0 而非 1**：§4.1(a) 採 `Object.freeze` 物件形，`as const` 需求歸零（已 `MEASURED`，見 §4.1(a)）⇒ **不需要**論證是否違反 C2 carry-forward lock「五處 `as const` 為唯一允許 assertion」。🚫 若未來有人把 §4.1(a) 改回陣列形，本預算須回到 1 並補寫該 discharge 。

⚠ §8.1 新增的 parser 單元測試**不得**引入新的 `as const`，亦不得改動該檔既有 5 處 —— 實作上以 inline 字面量或直接餵 `parseAuditSeverity(raw: unknown)` 撰寫（後者參數型別為 `unknown`，本就不需 `as const`）。

`user-audit-loss.test.ts:18` 現行註解「safeUserAudit has untyped params, so no cast is needed」在本 PR 後**變為假**，必須同步更新為說明 suppression 存在的理由。

---

## 6. `MEASURED_OVERLAY` 證據

**定位**：PLAN feasibility evidence。**不是** committed-code 證明，**不是** Code Gate 證明。coding 後必須從實際 changed files 重跑 `typecheck:ratchet:report` 與 forced `tsc` set-diff。

### 6.1 composed overlay — 現行 §4 全套（`MEASURED_OVERLAY`，2026-08-03 整表重跑）

| 項目 | 值 |
|---|---|
| base commit | `4a8933bab7bdb9657550028439757902840379cc` |
| 方法 | `ts.createProgram` ＋ `CompilerHost.getSourceFile/readFile` in-memory overlay；編譯設定讀 **`tsconfig.functions.json` 之真實 parsed options**（`ts.parseJsonConfigFileContent`，非手抄旗標）；repo 零寫入 |
| overlay 內容 | **現行 §4 全套**：§4.1(a) 物件形常數 ＋ §4.1(b) parser ＋ §4.2 三型別與五簽章 ＋ §4.3 severity 邊界（含 `parsed === 'critical'` gate）＋ §4.4 `replay.ts` ＋ §4.5 `[vendor].ts` 單 hunk ＋ **§4.6 bounded timeout** |
| §4.6 之獨立影響 | **零** —— 加掛／不加掛 §4.6 兩組量測皆為 `373 / 362 / 11 / 0`（2026-08-05 實測對照組） |
| 診斷來源 | `program.getSemanticDiagnostics()` |
| 差分法 | `file\|TSxxxx\|message` multiset，line-shift robust |
| base | **373**（與 `typecheck:ratchet:report` current 完全吻合 ⇒ 量測工具可信） |
| overlay | **362** |
| `REMOVED` | **11**（全為 `user-audit.ts` 的 `TS7006`，逐條輸出：`env`×4 · `entry`×2 · `ip` · `request` · `explicitTraceId` · `domain` · `raw`） |
| `ADDED` | **0** |

⚠ **本節於 2026-08-03 整表重跑**，取代初稿餵入舊形（陣列 ＋ `as const`）的量測。故本表**逐字對應現行 §4 之型別／runtime 構造**（⚠ §4.6 之 `// TECH-DEBT:` 為**純註解**、不產生 semantic diagnostic，未納入 overlay 餵入內容亦不影響上列數字 —— 已以加掛／不加掛該註解行之對照組實測，兩組皆 `base 373 / overlay 362 / REMOVED 11 / ADDED 0`）；初稿為銜接形狀變更而設的「數字適用性逐項判定」推論鏈**已連同其獨立小節一併刪除** —— 不再有任何需要「假設形狀變更與 §4.2–§4.5 無交互作用」的推論。

**已排除的假警報**：`functions/utils/credential-reverification.ts:87` 的 `severity`（shorthand property；`:81-83` 為其巢狀三元式定義、`:85` 為 `safeUserAudit(` 呼叫起始行。⚠ 🚫 本座標須與 §12 表第 17 列同為 `:87`，不得寫成 `:85`）在 **本節 composed overlay** 實編下**零錯**。⚠ 此判定**必須**掛在 composed overlay 而非 §6.2：只有 composed 才套了 §4.2 的 `entry: UserAuditEntry`，`:87` 的 shorthand 才會被實際做 assignability check；掛在 shape-only 量測上會是空洞宣稱。先前基於 `checker.getTypeAtLocation` 的量測回報 `string` 是 widened 型別假象（assignment check 使用 fresh 型別）。**該探測腳本已作廢，不列入證據鏈；本 PR 唯一型別權威為真實 program diagnostics。**

**未由 overlay 覆蓋者（必須寫進任何引用本數字的宣稱）**（適用範圍：§6.1／§6.2 之 project 級量測；生效時態：base `4a8933ba`；例外集合：∅；closure：**僅涵蓋 leaf 面** —— 已逐檔查證 `tsconfig.solution.json` 之四個 leaf：`tsconfig.scripts.json` 與 `tsconfig.browser-typecheck.json` 的 `include` **皆不含 `functions/**` 或 `tests/**`**（前者另含 `scripts/lib/asset-versioning.mjs`、後者另含 8 個 `types/*.d.ts`，均不影響本結論）。⚠ **`include` ≠ TS program 檔案集** —— transitive import 亦入 program，故另實測 `src/js/**` 與 `scripts/**` 對 `functions/` 的 **import／require 數皆為 0**（量測法＝ `from|require|import()` 後接含 `functions/` 之路徑）。⚠ **非 import 之 `functions/` 字串另有 401 處，須一併揭露以免第三方重跑時誤判**：`src/js` 側 **1 處**（`dashboard.ts:2442`，註解）；`scripts` 側 **400 處**（其中 387 處集中於單一 `.json` 資料檔，餘 13 處分佈於 5 個 `.mjs` ＋ 1 個 `.js`，逐條確認皆為註解／字串常數／path prefix，如 `scripts/lib/ratchet-override.mjs` 的 `prefixes: ['functions/']`）——**皆非 import**。故兩者不會經 import 把 `functions/**` 拉進其 program ⇒ 編 `functions/**` 者恰 functions＋tests 兩 leaf、未覆蓋者恰 tests 一個。🚫 **不宣稱下列各項為未覆蓋軸之窮盡** —— 至少另有 suppression／cast 數量軸（§5.5 之「恰 2 個」＋ `as const` 0 ＋ `as AuditSeverity` 0），overlay 對其零覆蓋，由 §8.5 之 `git diff` 人工清點承擔）：

1. **`tsconfig.tests.json` leaf 未量測。** overlay 只建了 functions project。tests leaf 亦編譯 `functions/**` + `tests/**`，且**預期**新增恰 2 個 assignability error —— 即 §5.5 的兩處 suppression 站點（`user-audit-loss.test.ts` 的非字串 `event_type`、`user-audit.test.ts` helper 的非法 severity）。suppression 補上後淨值歸 0。此為**預期而非實測**，coding 後由 solution build 驗證。
2. **runtime 行為未量測**（severity fallback、cold_class parity、webhook gating）→ §8.2 覆蓋。
3. **SQL CHECK 未量測** → §8.4 覆蓋。

故 §1 的 `ADDED = 0` 僅對 functions leaf 成立；全域淨值須待 coding 後重跑。

### 6.2 §4.1 隔離量測（(a)+(b) only；非 §1 數字之來源）

同一工具、同一 base，**只套 §4.1**（(a) 常數形狀 ＋ (b) parser；🚫 **不套 §4.1 以外之任何 hunk** —— 原寫「不套 §4.2–§4.5」，該範圍於 §4.6 新增後即未涵蓋 §4.6，屬與 `GPT-D-ARCH-R11-RR1` **同族**之 exhaustive-range 過期；改為不具範圍之寫法以斷根）：**base 373 / overlay 373 / `REMOVED` 0 / `ADDED` 0**。

⇒ **§4.1(a)+(b) 合併的淨效果為零**。⚠ 由聯合為 0 推不出 (a) 單獨為 0（理論上可互相抵消），本檔不作該推論；本節結論僅及於 (a)+(b) 之聯合。§6.1 的 11 條 `REMOVED` 全部來自 §4.2 的參數標型，與常數形狀正交。本節僅供理解兩者貢獻的分解，**§1 的量化目標以 §6.1 為準**。

---

## 7. 機械限制

### 7.1 EOL / encoding

以 `tr -cd '\r' | wc -c` 實測（`grep -c '\r'` 不可靠）：

| 行尾 | 檔案 |
|---|---|
| **CRLF** | `functions/utils/user-audit.ts` · `tests/integration/_setup.sql` · `tests/integration/user-audit-loss.test.ts` |
| **LF** | `functions/utils/audit-policy.ts` · `replay.ts` · `[vendor].ts` · `tests/integration/migrations.test.ts` · `tests/audit-policy.test.ts` · `tests/integration/user-audit.test.ts` |

changed-files 為**混合行尾**。逐檔保留原行尾與 encoding，否則 diff 退化成整檔 churn（`.gitattributes` 已根治 build 產物，但編輯器行為仍須自律）。不做任何格式化或鄰接清理。

### 7.2 ratchet BAN_PATTERNS（第一手讀 `scripts/typecheck-ratchet.mjs`）

- `:275-282` — `@ts-expect-error` 必須形如 `@ts-expect-error -- <reason>`，且 `<reason>.trim().length >= 15`
- `:284` — diff **任何新增行**禁 `:\s*any`
- `:293` / `:294` — 禁 JSDoc `{any}`
- `:811-816` — 僅掃 `+` 行；`.d.ts` 豁免

⚠ 上述 `BAN_PATTERNS` **只在 enforcing 的 `typecheck:ratchet` 執行**。`typecheck:ratchet:report` 在 `:929-938` 提前 return，**不**執行規則 A–E、**不**呼叫 `checkDiffSuppressions()`。§9 的 gate 必須用 enforcing 變體，否則本計畫 §5.5 的兩個 suppression 完全沒有機械驗證。

### 7.3 SPEC-D1 例外（TS weak type）

`device-alerts.ts:27` 的 `AlertEnv = Pick<Env, 'chiyigo_db' | 'RESEND_API_KEY' | 'IAM_BASE_URL' | 'MAIL_FROM_ADDRESS' | 'RESEND_TIMEOUT_MS'>` **不含 `AUDIT_IP_SALT`**，卻在 `:67` 呼叫 `hashIdentifierForAudit`。若把該函式 env 標成 salt-only 窄型別（全 optional ⇒ weak type，與 `AlertEnv` 零共同屬性），實測產生：

```
TS2559: Type 'AlertEnv' has no properties in common with type 'SaltOnlyEnv'.
```

故 `hashIdentifierForAudit` 與 `hashIp` **明示沿用共享 `UserAuditEnv`**（與 `AlertEnv` 共享 `chiyigo_db` ⇒ 通過 weak-type 檢查）。

⚠ 本節**不授權** per-helper 窄化。真正要守的邊界只有一條：**不得因本例外而把 env 型別放寬成完整 `Env`**。env 型別名的唯一性鎖見 §4.2。

⚠ 引文中的 `SaltOnlyEnv` 僅為重現該診斷所用的假想名稱，**不得出現在實作**。**不得**為此擴充 `device-alerts.ts` 的 allowlist。

### 7.4 dual-leaf 去重

`tsconfig.tests.json:30` 亦 include `functions/**/*.ts`（`:29` 為 `.js` 對應項），故 production 檔在 `tsc -b tsconfig.solution.json` 下被編兩次。tests leaf `noImplicitAny:false` ⇒ `TS7006` 不重複計；但**新增的 assignability error 會兩個 leaf 各報一次**。驗 `ADDED=0` 時須依 dual-leaf 規則去重，禁以單 leaf 結論代表全域。

### 7.5 自審工具的路徑限制（CODE 階段必踩）

`.claude/workflows/code-self-review.mjs:17` 的 `REPO_PATH_PATTERN = /^[A-Za-z0-9._/@-]+$/` **拒絕中括號**。本棒 4 個 production 檔中有 **2 個**含 `[]`：

- `functions/api/admin/event-dlq/[id]/replay.ts`
- `functions/api/webhooks/payments/[vendor].ts`

⇒ CODE 階段的維度 A 自審 agent **讀不到這兩檔**，其 hunk 必須**手動補進** faithfulness package，否則 ④ 會收到不完整的客體。此為已知 backlog（維度 A workflow hardening 項 (c)），本棒不修工具、只在流程上補償。**Code Gate 證據包須顯式聲明這兩檔的 hunk 為手動補入。**

---

## 8. 測試計畫

### 8.1 Parser unit（`tests/audit-policy.test.ts`）

1. 三個合法值 round-trip 回原值
2. `'PANIC'` · `'INFO'`（大小寫變體）· `''` · `null` · `undefined` · `0` · `{}` → 全回 `null`
3. `AUDIT_SEVERITY` 為 frozen（`Object.isFrozen` 為 true）、`Object.values(AUDIT_SEVERITY)` 恰為三個落庫值 —— **此二者為 runtime 可觀測性質，落在本節**。

   ⚠ 「`AuditSeverity` 確由常數衍生（型別↔runtime 同源）」是 **compile-time** 性質，**不放本節**：vitest 的 runtime `expect` 無法區分「型別由常數衍生」與「型別手寫且值域碰巧相同」——後者正是 base 現況（`audit-policy.ts:32` 的裸 union），兩者 runtime 行為完全相同。

   **該子句的保證來源＝源碼構造，不是任何量測**：`AuditSeverity = (typeof AUDIT_SEVERITY)[keyof typeof AUDIT_SEVERITY]` 是**唯一衍生點**，改常數則型別自動跟著改；驗收手段為 **Code Gate 逐字核 diff**（確認該衍生式存在且無第二處手寫 union）。

   ⚠ **§4.1(a) 的負向控制不能拿來證明本子句** —— 實測把同一條 `const bad: AuditSeverity = 'PANIC'` 套在 base **未改的手寫 union** 上，得到**完全相同**的 1 條 `TS2322`。該負向控制只證明「衍生式解析出的值域為三字面量、未退化成 `string`」（§4.1(a) 的原始措辭正是如此），**不**證明「由常數衍生」。🚫 不得把該負向控制引述成「證明由常數衍生」。

   🚫 **不**改以 `expectTypeOf` 補測：那會新增測試構造並需回頭重算 §5.5 的 suppression／`as const` 預算，成本大於收益（owner 2026-08-03 裁定採「源碼構造 ＋ Code Gate 核 diff」路徑）。⚠ 此不削弱 §2.1.1 第 3 項的「型別層」機制 —— 該機制本就由單一衍生點的**構造**加 typecheck gate 保證，不依賴 runtime test。
   ⚠ **與 D1 schema 的跨層比對不放這裡**：unit lane（`vitest.config.js`）repo 內**零** `?raw` 使用前例，`types/raw-imports.d.ts` 的註解自述該宣告是給 integration／workers bundler 用；且 unit lane 無 D1 binding，取不到端態 schema。硬編陣列比硬編陣列＝套套邏輯。跨層比對改放 **§8.4-5**（integration lane，對**實跑 `ALL_UPS` 後的端態 `sqlite_master`** 斷言）。
4. 覆蓋 `parseAuditSeverity` 全分支；維持 `functions/utils/**` **聚合** coverage gate（`vitest.config.js:69-74`，全域門檻**非 per-file**；`audit-policy.ts` 為分母之一，不得因本棒被加進 exclude）。真正的分支保證來自上列 items 1–2 的具名斷言，`test:cov` 僅為不回歸的粗顆粒 backstop。
5. `_registrySize` 仍為 `228`（證明本棒未觸動 REGISTRY）

### 8.2 Runtime integration（`tests/integration/user-audit.test.ts`）

⚠ **webhook 斷言必須先被弄成 load-bearing。** 實測 `DISCORD_AUDIT_WEBHOOK` 在 `vitest*.config.*` / `tests/` / `wrangler.toml` **完全未設定** ⇒ `notifyCritical`（`user-audit.ts:241-242`）在**測試 runtime** 恆於 `if (!url) return` 折返、**不會 fetch**。若不注入該值，「Discord fetch 零次」對正反案例都成立，等於沒測。

> ⚠ **本推導之適用範圍嚴格限定為 repo 內測試環境**（`vitest*.config.*` / `tests/` / `wrangler.toml`；生效時態：本 PR 之測試執行；例外集合：∅；closure：僅涵蓋測試 runtime 之 env 來源）。🚫 **不得**由此推導 production 之設定狀態 —— ① `GPT-D-ARCH-RR1` 已判定該跨 repo↔deployment 邊界之推導不成立（`DISCORD_AUDIT_WEBHOOK_PROD_STATE = UNKNOWN`，見 §4.6）。兩者字面形態相同、承重範圍不同，此處逐條標定以免被讀成同一宣稱。

故所有 webhook 相關案例一律：**env 覆寫注入 `DISCORD_AUDIT_WEBHOOK`（假 URL）＋ `vi.stubGlobal('fetch', vi.fn())`**，並以「合法 critical 確實 fetch」作**正向控制**證明該 stub 具偵測力。

⚠ **stub 生命週期為規範、非實作建議**（同 §8.4-5(ii) 之「最自然的寫法不構成保證」標準）：

1. **teardown 必配對**：`afterEach(() => { vi.unstubAllGlobals() })`。⚠ 既有 pattern 之引用一律取 **stub＋teardown 成對行**（`admin-payments.test.ts:375`＋`:356` · `callback.test.ts:106`＋`:110`），🚫 不得只引 stub 行 —— `vitest.workers.config.js` 為 `singleWorker: true` ＋ `isolatedStorage: false`，`globalThis` 跨檔共用，漏 teardown 會污染其他測試檔。
2. **每案重建**：每個案例於 `beforeEach` 新建 `vi.fn()`（或明寫 `mockClear()` 時機）。🚫 否則本表「`fetch` 恰 1 次／0 次」之計數跨案例不可信，正向控制隨之失效。
3. **env 覆寫走既有 helper**：`DISCORD_AUDIT_WEBHOOK` 經同檔既有的 `reqWithSalt(extraEnv)`（`user-audit.test.ts:20`）注入。🚫 **不改** `vitest.workers.config.js`（不在任何 allowlist）。
4. **import delta 登記**：`tests/integration/user-audit.test.ts:12` 之 vitest import 須擴為含 `vi`、`afterEach`（比照 §8.2.1 對 `:16` 之 `hashIdentifierForAudit` import 的處理）。此為**同模組既有 import 的延伸，非新跨層依賴**。

| 案例 | 斷言 | webhook 注入 | suppression |
|---|---|---|---|
| **省略 severity 回歸**：`auth.login.success`（`SECURITY_SIGNAL`，`audit-policy.ts:258`） | `severity='info'` **且** `cold_class='security_warn'` | 否 | **無** |
| **正向控制**：合法 `critical` | 仍走既有 notification path，`fetch` **恰 1 次**；**且**該次呼叫之 `init.signal` 為 `AbortSignal`（`AUDIT_WEBHOOK_TIMEOUT_GUARD`，見下） | **是** | 無 |
| 非法 + `security_signal` | `severity='critical'`、`cold_class='security_critical'`、row 存在、`[audit-severity-invalid]` 恰一次、log 不含 raw 值、**無** `[audit-loss]`、`fetch` **0 次** | **是** | 共用 helper |
| 非法 + 非 security category | `severity='info'`、`cold_class` 為該 category、其餘同上 | **是** | 共用 helper |
| **`null` + `security_signal`**（`GPT-D-ARCH-RR4` Required） | `severity='critical'`、`cold_class='security_critical'`、row 存在、`[audit-severity-invalid]` **恰一次**、`fetch` **0 次**、**無** `[audit-loss]` | **是** | **無**（見下） |

> **`GPT-D-ARCH-RR4` — `null` 分支必須 load-bearing。** §4.3 把 runtime 值空間拆成四段（省略／`undefined` · 合法三值 · `null` · 其他非法值），但初稿的 integration 只覆蓋**省略**、**合法 critical**、**非法字串**三類。parser unit 的 `null → null` **無法**驗證 `safeUserAudit` 是否仍寫
> ```ts
> entry.severity === undefined
> ```
> 而非日後被誤改成 `entry.severity == null` —— 後者會把 `null` **錯併入省略路徑**（落 `'info'`／`security_warn`、不記 invalid log），而**現有非法字串案例不會轉紅**。⇒ 本列是二分鎖 `null` 側的唯一機械保障。
>
> **零 suppression 成本**：現行 `tsconfig.tests.json:13` `"strict": false` ⇒ `strictNullChecks` off ⇒ `severity: null` 可直接賦值給 `severity?: AuditSeverity`，**不需** `@ts-expect-error`。⇒ §5.5 之「新增 `@ts-expect-error` 恰 2」與 `as const` 0 **預算不變**。
> ⚠ 終態 `strict:true` 下本列預期需 +1 suppression（同 §8.2.1 之 landmine），🚫 不得以刪除本案例代替；承接點併入 §13。

> 「正向控制」與「非法 fallback 0 次」必須在**同一注入條件**下對照，否則後者仍非 load-bearing。

#### 8.2.2 `AUDIT_WEBHOOK_TIMEOUT_GUARD` —— §4.6 的機械鎖

⚠ **為何必要**：§4.6 是本 PR **唯一今日可觀測的 runtime 行為交付物**（⚠ 限定語為承重 —— 另一條 runtime 軸＝§4.3 之 fallback 映射，其今日可達集合 ＝ ∅；兩軸並列見 §4.6 標軸段），而 §10.1（`TD-BATCHD-1` `CLOSED_PARTIAL`，僅根因 (1)(3)）· §11.2 item 4（timeout 已交付）· §11.3-5（真正的 discharge 是 bounded timeout）**三處承重宣稱全建立其上**。若 coding 時漏寫 `signal: ctrl.signal`，§9 八道 gate（`lint` · `typecheck:ratchet` · `test:cov` · `test:int` · `verify:browser-pipeline` · `build:functions` · `npm audit` · `lint:migrations`）**全綠**而交付物無聲蒸發。
⚠ **`lint` 在此軸上為雙重不設防**（實測）：(a) `ctrl` 仍被 `setTimeout` callback 使用（`ctrl.abort()`）⇒ unused-var 規則**根本不會觸發**；(b) 即便觸發也不擋 —— `eslint.config.js:46/:189/:223/:245` 該規則一律為 **`'warn'`**，且 `package.json` 的 `lint` ＝ `eslint functions tests && …`、**無 `--max-warnings`** ⇒ 純 warning 之 ESLint 退出碼為 0。🚫 不得只寫 (a) 而略過 (b) —— 只寫 (a) 會讓讀者以為「其他 unused-var 失誤有 gate 擋」。這正是本檔在 §8.2.1 為 `String(raw)` 立 `STRING_RAW_COLLISION_GUARD` 所防的「守門自我拆除」形態 —— 🚫 不得對本 PR **唯一今日可觀測的**行為變更放寬同一標準。

於 §8.2 既有「正向控制：合法 `critical`」案例（已注入 webhook ＋ `fetch` stub，`init` 已被 `vi.fn()` 捕獲）**追加斷言**，不新增測試案例：

```ts
// AUDIT_WEBHOOK_TIMEOUT_GUARD：§4.6 之 signal 必須實際傳入 fetch init
const init = vi.mocked(fetch).mock.calls[0][1]
expect(init.signal).toBeInstanceOf(AbortSignal)
expect(init.signal.aborted).toBe(false)   // 正常路徑不應已 abort
```

⚠ **識別字為 Code Gate 之機械清點錨點**（適用範圍：本斷言；生效時態：本 PR 起，含終態；例外集合：∅；closure：全 repo 恰一處）。🚫 改名或移除即失去可清點性 —— 同 §8.2.1 之 `ARCH-D-L4` 紀律。

**零預算成本（四項限定）**：適用範圍＝本 PR changed-files；生效時態＝本 PR（`strict:false`）；例外集合＝∅；closure＝下列三項窮盡 —— (1) 載體 `tests/integration/user-audit.test.ts` 已在 §5.2 allowlist（`:419`）；(2) `strict:false` 下 `mock.calls[0][1]` 之索引存取與 `init.signal` 不產生 assignability／`noUncheckedIndexedAccess` 診斷 ⇒ **不需** `@ts-expect-error`，§5.5「恰 2」與 `as const` 0 不變；(3) 不新增案例 ⇒ §1 之四列量化目標不變（⚠ provenance 逐列：`REMOVED`／`ADDED` 之量測來源為 **§6**；`ratchet current` 之合入時點權威為 **§8.5**〔`typecheck:ratchet:report` 精確為 `362 / 13 / 324 / 337`〕；`baseline` 為**凍結政策值**、§6 未量。🚫 不得寫成「§6 為其量測來源」—— 該宣稱對 4 列中的後 2 列為假）。

**第 (2) 項已 `MEASURED`（tests leaf，2026-08-07）**：以 §6 同型 in-memory overlay 對 **`tsconfig.tests.json` 之真實 parsed options** 建 program，注入本節 code block ＋ `vi`／`afterEach` import delta ⇒ **`base 0 / overlay 0 / REMOVED 0 / ADDED 0`**。
⚠ **附負向控制（否則 `base=0` 之量測無偵測力可言）**：同一 overlay 另加 `const NEGCTL: number = "…"` ⇒ **`ADDED=1`（`TS2322`）**，證明該 harness 確實型檢此檔。🚫 本節之「零成本」不得以未附負向控制的量測為據 —— 首次量測即因替換靜默 no-op 而產生假 `ADDED=0`。

⚠ **abort 分支本身不被自動測試 —— 這是 zero-env 決策的已知取捨（明文揭露，非遺漏）**：
- repo 內 timeout 領域有**可測性前例**，且須分辨兩種、🚫 不得混引：
  - **(前例-A) abort 分支**：`tests/email.test.ts:114-129` —— `functions/utils/email.ts:70-91` 以 `parseTimeoutMs(env)` 讓預算可由 env 覆寫，故該測試能以 `RESEND_TIMEOUT_MS: '50'` ＋「只在 `signal` aborted 時 reject」之 stub，斷言 `elapsed < 1000`（`:128`）。**本棒因 zero-env 無法比照**。
  - **(前例-B) signal 有被接上**：`tests/email.test.ts:131-135` —— `expect(lastReq.init.signal).toBe(ctrl.signal)`。**這正是 `AUDIT_WEBHOOK_TIMEOUT_GUARD` 的同型前例**，與 zero-env 無關、本棒可直接比照。
- §4.6 採 **zero-env**（硬編 8000ms），前例 `send-verification.ts:23`／`invitations/index.ts:23` 是**常數形式**的前例、**非**可測性前例。⇒ 選 zero-env 即**放棄** abort-path 的低成本自動測試。
- **本棒維持 zero-env** 之理由：env-configurable 變體須同時擴 `UserAuditEnv`／`types/env.d.ts`／production allowlist 並重跑 §6（§10.1 已論證），成本遠大於本 hunk 本身。
- 🚫 **不得**把本取捨讀成「abort 分支已被覆蓋」。`AUDIT_WEBHOOK_TIMEOUT_GUARD` 鎖的是 **`signal` 有被接上**（防交付物蒸發）；timer↔controller↔常數之**耦合**由 **§8.5 (a2)** 逐字核（② `CODEX-D-PLAN-R2`）—— **兩者皆不是** abort 後的行為。abort 後行為之驗證承接點併入 §13。

> 「省略 severity 回歸」是本節的**反向護欄**：它證明二分鎖的省略側未被 fallback 汙染。`functions/` 內省略 severity 的 call site 實測為 **42 個**（289 − 247），全部依賴此行為。
>
> **量測法**（`feedback_quantified_claim_scope`；適用範圍：`functions/**/*.ts`；生效時態：base `4a8933ba`；例外集合：∅）：分母 289 ＝ `grep -rn "safeUserAudit(" functions/ --include=*.ts | wc -l` 得 292，扣除定義處 `user-audit.ts:65` 與兩處註解提及（`user-audit.ts:10` · `device-alerts.ts:9`）。帶 severity 者 247 ＝ `grep -rn "safeUserAudit(" -A 3 functions/ --include=*.ts | grep -c "severity"`。⚠ 後者以 3 行視窗近似 entry 物件範圍，對跨 4 行以上的 call site 會低估；本數字僅用於推導「省略側非空且量級為數十」，**不作為精確 closure**。

### 8.2.1 `String(raw)` 的機械 gate（OD-D3 第二交付物之守備）

⚠ §4.2 的 `String(raw)` 是「防稽核識別符互撞」的**唯一控制**，但初稿只以行註解 ＋ 🚫 prose 保護它 —— **無任何會轉紅的 gate**。若後續 `strict:true` 棒次因「參數已是 `string`、`String()` 看似冗餘」而清掉它，`undefined` 會編成 `''` 而與空字串產生**相同 HMAC 摘要**，造成稽核識別符互撞／誤歸屬，且**無測試會失敗**。

於 `tests/integration/user-audit.test.ts`（已在 §5.2 allowlist）補一條斷言。⚠ **另需擴既有 import**：該檔 `:16` 現為 `import { safeUserAudit } from '../../functions/utils/user-audit'`，須改為 `import { safeUserAudit, hashIdentifierForAudit } from …`（實測 `tests/` 全樹對 `hashIdentifierForAudit` 的引用數為 **0**，此為首次）。此為**同模組既有 import 的延伸，非新跨層依賴**，故不比照 §5.2 item 5 對 `migrations.test.ts` 的四案取捨論證。

```ts
// ARCH-D-L4：測試名須帶穩定識別字 STRING_RAW_COLLISION_GUARD，供 Code Gate 清點
it('STRING_RAW_COLLISION_GUARD: undefined 與空字串必須產生相異摘要', async () => {
  const a = await hashIdentifierForAudit(env, 'd', undefined)
  const b = await hashIdentifierForAudit(env, 'd', '')
  expect(a.hex).not.toBe(b.hex)
})
```

⚠ **識別字為 `ARCH-D-L4` 之機械清點錨點**（適用範圍：本斷言；生效時態：本 PR 起，含終態；例外集合：∅；closure：全 repo 恰一處）。🚫 改名或移除即失去 Code Gate 的可清點性。

**偵測力（已實測，非推論）**：`TextEncoder.encode` 依 WebIDL 對 `undefined` 套用預設值 `""` ⇒ `encode(undefined)` 與 `encode('')` 皆為 `[]`（**相同**），而 `encode(String(undefined))` 為 `[117,110,100,101,102,105,110,101,100]`（**相異**）⇒ 移除 `user-audit.ts:229` 的 `String(raw)` 後本斷言**必轉紅**。

**suppression 成本（四項限定）**：
- **適用範圍**：`tsconfig.tests.json` leaf；**生效時態**：**僅限本 PR 合入時之 `strict:false` 環境**；**例外集合：∅**（⚠ 終態 `strict:true` 之 +1 suppression **已由「生效時態」排除在本 4-tuple 之外**，不是本項之例外；下方 `noImplicitAny` 段為**歸因更正／負向控制**，亦非例外）；**closure**：本節單一斷言。
- **今日成本 ＝ 0**：`hashIdentifierForAudit` 為 `export`（`user-audit.ts:215`）可直接呼叫；承重旗標是 **`strictNullChecks`（由 `tsconfig.tests.json:13` 的 `"strict": false` 關閉）**，使 `undefined` 可賦值給 `raw: string` ⇒ 不產生 assignability error。§5.5「新增 `@ts-expect-error` 恰 2 個」之 closure **完整存活**，`as const` 預算維持 0。
- ⚠ **`noImplicitAny` 對此結果零貢獻**（負向控制實測：`strict:false` + `noImplicitAny:true` 下仍為 0 診斷）—— 🚫 不得把 `:14` 的 `noImplicitAny:false` 寫成理由。亦 🚫 不得稱 leaf「**承襲**」`strict:false` —— `tsconfig.tests.json` **無 `extends` 鍵**，`:13` 為直接宣告。

⚠ **終態 landmine（必須先聲明，否則本 gate 會被自我拆除）**：實測於 `strict:true`（或僅開 `strictNullChecks`）下，本斷言產生 `TS2345: Argument of type 'undefined' is not assignable to parameter of type 'string'`。⇒ Stage 7 終態（`noImplicitAny=0` rebaseline → `strict:true`）時，本斷言**預期需 +1 個 `@ts-expect-error`**。
🚫 **不得以刪除本斷言代替補 suppression** —— 本斷言存在的唯一理由，正是防止 `strict:true` 棒次因「`String()` 看似冗餘」而清掉 `user-audit.ts:229`；若屆時為消 TS2345 而刪掉它，等於守門自我拆除。此承接點列 §13 非目標。

### 8.3 audit-loss（`tests/integration/user-audit-loss.test.ts`）

非字串 `event_type` 仍 resolve `undefined`、產生恰一筆 `[audit-loss]`；改用具理由 suppression，並更新 `:18` 失效註解。

### 8.4 Schema 對齊（OD-D4 加強版）

1. `AUDIT_SEVERITY`（runtime）／`AuditSeverity`（type）／parser 三者單一 SoT
2. `tests/integration/_setup.sql:245` 所屬建表補 `CHECK(severity IN ('info','warn','critical'))`，逐字對齊 `migrations/0017_audit_log.sql:36`
3. `tests/integration/migrations.test.ts:1311` 的 0038 手工 fixture 補同一 CHECK
4. 新增斷言：CHECK 接受三值、拒絕第四值（**直接 SQL INSERT**，不經 `safeUserAudit`——runtime 證據而非 SQL 字串比對）。此斷言驗的是**當下生效**的那份 fixture，非同時驗兩份。
5. **端態斷言（新增，補上真正的漂移偵測）**：於既有 full-forward-chain describe（`migrations.test.ts:501`，其 `beforeAll` 已跑完 `ALL_UPS`）加一組 **conjunctive** 斷言（**不得**寫成「A 或 B」——弱式規格的強度等於其最弱可接受分支）：

   (i) 由端態 `sqlite_master.sql` 解析 `audit_log` 的 `CHECK(severity IN (...))` **值集**，assert 與 `Object.values(AUDIT_SEVERITY)` **雙向 set equality**（非 presence、非 subset）。⚠ 物件形常數取值集須經 `Object.values()`；🚫 不得改比對 `Object.keys()`（那是 `INFO`/`WARN`/`CRITICAL`，非落庫值）。此為本棒 SQL 側**唯一**機械耦合端點（適用範圍：本 PR 之 changed-files；生效時態：本 PR；例外集合：∅；closure：候選集＝本節 items 2/3/4/5(i)/5(ii)，逐一判定 —— item 2「`_setup.sql` 加 CHECK」與 item 3「`migrations.test.ts` fixture 加 CHECK」為**硬編字面值、不 import `AUDIT_SEVERITY`**故非耦合端點；item 4 為 runtime INSERT 斷言、其第四值亦為硬編故非耦合端點；5(ii) 同理；**僅 5(i) import 該常數並做雙向 set equality** ⇒ 恰一個）。
   (ii) runtime 補強：三個合法值 INSERT **皆被接受**（這半才對「CHECK 被改窄」有偵測力）**且**第四值被拒。

   ⚠ **fail-closed 解析契約（① 指示 ② Codex Plan 須鎖定之項）**：(i) 的解析器對端態 `sqlite_master.sql` 抽 `audit_log` 之 `CHECK(severity IN (...))` 時，**必須恰命中一個**；**0 個 match 與多於 1 個 match 一律 `fail`**，🚫 不得回退為「取第一個」「跳過」或「視為通過」。理由：0 match 可能是 CHECK 被整個移除（最致命方向），多重 match 可能是未來 migration 重建出第二個 severity 約束 —— 兩者若靜默通過，本斷言的偵測力歸零。<br>⚠ **實作形狀為規範、非建議**（② `CODEX-D-PLAN-R1` Required）：**必須先全域枚舉候選**（`matchAll` 或等價，🚫 不得用只回第一個的 `match`／`exec` 單次呼叫），**再於任何索引存取之前**斷言 **`expect(matches).toHaveLength(1)`**；通過後才取 `matches[0]` 解析值集。🚫 不得以 optional chaining／預設值／`if (!m) return` 之任一形式使 0-match 靜默通過。**理由**：今日 schema 恰有一個 CHECK ⇒ 「取第一個」與「0 個時跳過」之錯誤實作在**今日仍會全綠**，契約若不規定形狀即無驗收面（本項驗收見 §8.5）。

   ⚠ **(ii) 的三個合法值與第四值一律以行內字面量書寫，🚫 不得迭代 `AUDIT_SEVERITY`。** 否則會產生第二個機械耦合端點，直接打破 (i) 的「恰一個」closure。此為規範而非實作建議 —— round 2 的 closure 曾把「(ii) 為硬編」當成既定事實，但當時 §8.4-5(ii) 未規定值的來源，且它緊接在已 import 該常數的 (i) 之後、最自然的寫法正是迭代；現以本禁令使 closure 有規範依據。

   **為何不能只驗存在性**：若未來 migration 把 CHECK rebuild 成 `IN ('info','critical')`，presence regex 仍綠、硬編第四值仍被拒 ⇒ 兩者皆漏。而 `functions/` 內 `severity: 'warn'` 的 call site 實測 **114 處**（含 MFA 失敗、改密碼、退款 denied/conflict 等安全與金流事件），收窄後這些 row 落庫即 CHECK 違例 → `user-audit.ts:108-109` 刻意不走 fallback → `throw` → 外層 catch 只留 `[audit-loss]` ⇒ audit row 靜默流失。

   **為何必要**：items 2–4 只保護**本 PR 自己編輯**的兩份手工 fixture，且其斷言值為**硬編字面量**（值與 `AUDIT_SEVERITY` 相同但**不 import**，故非機械耦合端點，與 (i) 的「唯一」不衝突）⇒ 對「migration 端把 CHECK 改掉／移除」這個致命方向**零偵測力**。而該方向目前 repo-wide 無任何機械保護：full-forward-chain describe 已對 column set（`:467`）、index set（`:527`）、FK 語意（`:554-575`）、index DDL 文字（`:576-601`）做斷言，**唯獨 severity CHECK 零斷言**；prod snapshot（`database/_prod_snapshot_2026_05_12.sql:165`）僅被 `:401` 散文註解引用，無機械比對。且該漂移 pattern 在本 repo 是**活的**：`migrations/0044` Part 3 即以「rebuild + INSERT-SELECT + 換名」拿掉過 `audit_archive_chunks.cold_class` 的 CHECK（該次為經審查的刻意設計，此處引為 **pattern 前例**，非 `audit_log` 上的漂移實例）。

   **可行性論證（`DERIVED` ＋ prod 經驗佐證；⚠ 非 `MEASURED`）**：

   ⚠ **標籤紀律**：(α)(β) 是**同一演繹論證的兩個前提**，不是兩條獨立實測；(γ) 是經驗證據但量的是 **prod（`wrangler d1 apply` 路徑）**，非 §8.4-5 實際斷言的 **Miniflare 端態**。本檔 §6 對 `MEASURED_OVERLAY` 採嚴格標籤、C2 §5.2 亦明標 `PROJECTED`，故本項🚫 **不得**標為「已驗證」（此誤標曾於自審輪次發生）。**直接量測留待 CODE 階段**：跑 `test:int` 後讀 `SELECT sql FROM sqlite_master WHERE name='audit_log'` 的實際文本，即可把本族整批升為 `MEASURED`（§8.5 追加項）。

   (α) **安裝點唯一**（適用範圍：`migrations/*.sql` 之 up 鏈；生效時態：base `4a8933ba` 快照，無機械維持；例外集合：`migrations/down/**`；closure：全檔 grep `audit_log` ∩ {CREATE|ALTER|DROP|RENAME} 窮盡）：`migrations/0000_base.sql` 未建 `audit_log`（實測該檔 `audit_log` 命中數 ＝ 0）⇒ `0017_audit_log.sql:27` 的 `CREATE TABLE IF NOT EXISTS audit_log` 是該鏈中唯一安裝者，其 `:36` 帶 `CHECK(severity IN ('info','warn','critical'))`。
   (β) **機制面**：`0038_audit_log_phase2.sql:20-21` 對 `audit_log` 只做兩個 `ALTER TABLE … ADD COLUMN`；SQLite 的 `ADD COLUMN` **不 rebuild table**，CREATE TABLE 上宣告的 table-level CHECK 自動存活。在 (α) 的同一組限定下，實測其後無 migration 對 `audit_log` 做 rebuild／rename／DROP（`migrations/down/0017` 的 DROP 屬 down 鏈；實測 `DOWNS` 陣列只含 0001–0012，`down0017` 根本未被 import）。
   (γ) **經驗面**：`database/_prod_snapshot_2026_05_12.sql:164-165` 顯示 prod 的 post-0038 `audit_log` 同時帶 ALTER 追加的 `archived_at`／`cold_class` 與保留的 `CHECK(severity IN ('info','warn','critical'))`。（此處僅作 prose 佐證，**不**與 §8.4-6 移除後的副本記帳衝突 —— 該檔仍為未耦合副本。）

   ⚠ **不得**引用 `0038:9-11` 作為本項 warrant。實測該三行的主詞是 **`cold_class`**（原文：「cold_class 不在 ALTER 加 CHECK：SQLite ALTER+CHECK 在 D1 行為較不確定…CREATE TABLE 上的 CHECK 仍保留」），**隻字未提 `severity`**；且其所指的 `audit_archive_chunks.cold_class` CHECK 已被 `0044` Part 3 移除。初稿誤引該行，現以 (α)(β)(γ) 取代。

   **成本近零（同檔已有兩型前例）**：`:576-601` 有「讀 `sqlite_master.sql` 做 regex 斷言」（對應本項 (i)）；**`:1393-1409`** 有「以 runtime INSERT 驗 CHECK 的合法／違法兩側」（合法側 `:1393-1398`、`:1399` 為註解、違法側 `:1400-1408` 含 `try/catch` 與 `:1408` `expect(rejected).toBe(true)`；對應本項 (ii)，與本項要做的事幾乎逐字同型）。⚠ 引用範圍不得截在 `:1399`，否則看不到違法側。

6. **【已移除】原「`up0017` raw 文本 ↔ `AUDIT_SEVERITY` 跨檔比對」** —— 於 plan self-review round 2 移除（owner 2026-08-02 裁定）。**編號槽保留**，以免 §8.4-7 等下游引用位移。

   **為何不另立 raw 文本比對**（此即 §8.1-3 移置理由的最終落點）：§8.4-5 的端態由 `migrations.test.ts:501-508` 的 `beforeAll` **實跑 `ALL_UPS`**（其中 `up0017` 以 `?raw` 進陣列）建構 ⇒ 對 `0017` CHECK **值集**的任何變更都會傳導到端態而被 §8.4-5 捕捉。

   ⚠ **精確界線**：raw 文本比對**能多抓、但 §8.4-5 抓不到**的，僅限**語義中性**的差異 —— 值序調換（`IN ('warn','info','critical')`）、空白／引號風格。set equality 依定義對這些免疫。**這正是不值得為它付出維護成本的理由**，而非「偵測力被完全包含」（🚫 後者字面上為假，不得如此表述）。對**任何改變值集**的變更，兩者偵測力等價。

   ⚠ 此處**不得**加寫「值集變更是唯一會造成落庫失敗或 retention 漂移的方向」—— 該句為假：`severity` 欄被 drop／rename／改 `NOT NULL`／改 `DEFAULT`、其他欄新增 CHECK、`classifyForCold`（`audit-policy.ts:408`）映射表改動、或 ops 調整 `AUDIT_ARCHIVE_HOT_DAYS_*` env 鍵（`audit-archive.ts:89` 動態組鍵，C2 亦以此為風險），皆會造成同類後果而與 severity CHECK 值集無關。本節的比較僅限「**`audit_log.severity` 的 `CHECK` 子句**這一個比較軸」。round 2 初稿曾誤加該括號句，現移除並立此禁令。

   兩者唯一**分歧且有後果**的情境是「未來 migration 合法 rebuild 該 CHECK」—— 此時端態才是真相、raw 文本比對會**誤報**。移除它同時消去該未來誤報源與其維護契約需求。

   ⚠ 該項屬自審輪次新增（OD-D4 owner 核准時為 5 項），非 SPEC 核准內容，移除為 scope **縮小**。頂層 `import { AUDIT_SEVERITY }` **不隨之移除**：§8.4-5(i) 本身即需該常數（見 §5.2）。

   > **副本 vs 耦合端點需分開記帳。** 合入後**檔案副本**共 5 份：`migrations/0017_audit_log.sql:36` · `database/_prod_snapshot_2026_05_12.sql:165` · `database/legacy_snapshots/schema_iam_prod.sql:50` · `tests/integration/_setup.sql` · `migrations.test.ts` fixture。（母體＝`git ls-files`；gitignored 之 gate packet 暫存目錄內另有副本，不列入。）
   >
   > 機械耦合到 `AUDIT_SEVERITY` 的**只有端態 schema**（適用範圍：本 PR 之 changed-files 所建立的 **SQL／schema 側**斷言；生效時態：本 PR；例外集合：∅；closure：見 §8.4-5(i) 之候選集逐一判定）。⚠ 「SQL／schema 側」限定不可省 —— §8.1-3 的 unit test 亦 import 該常數，那是**型別／runtime 側**斷言、不在本宣稱範圍內。端態非檔案副本。`0017` 因是端態該 CHECK 的唯一安裝者而**間接**受涵蓋（改其**值集** ⇒ 端態變 ⇒ §8.4-5 fire），非獨立耦合端點。
   >
   > **5 份副本逐一歸類**（此即上列 5 份的完整分派，無未歸類者）：`0017`＝間接受涵蓋 · `migrations.test.ts` fixture＝受 §8.4-4 顯式斷言覆蓋 · **未耦合三份**＝prod snapshot · legacy snapshot · **`_setup.sql`**。未耦合三份皆列 §13 非目標。
   >
   > ⚠ **`_setup.sql` 的「未耦合」是指不被 §8.4-4 的顯式斷言覆蓋，不等於該 CHECK 為死碼。** 其是否為活約束**取決於 vitest 檔案執行順序**（見 §8.4-7）：在 `migrations.test.ts` **之後**執行的檔為死碼、**之前**執行的檔為活約束。初稿寫「在 §9 required gate 下永不被驗證」是把排序相依當成套件層級事實，現表述取代之。

7. **完整 `test:int` 為必要 gate**，理由是爆炸半徑而非流程慣例：

   `tests/integration/_helpers.ts:20` 以 `;` 切 `_setup.sql` 後逐句執行，且建表為 `CREATE TABLE IF NOT EXISTS` ⇒ 表已存在即不重建。而 `migrations.test.ts:1306` 的「0038 targeted」block 先 `dropAllTables()` 再手工 `CREATE TABLE audit_log`，是該檔**最後一個 schema mutator**（該檔 `:609` `:753` `:797` `:829` `:906` `:1021` `:1114` 七處註解明載其他 describe 必須排在其前 —— 此七處講的是**檔內** describe 順序）。

   ⚠ **跨檔生效範圍是排序相依，不是套件層級事實。** `audit_log` 的形狀由**最近一次 `dropAllTables()` 之後的第一個建表者**決定（`_helpers.ts:12-23` 的 `resetDb()` 只 drop `pkce_sessions`／`auth_codes`，`audit_log` 走 `CREATE TABLE IF NOT EXISTS` **不重建**；`migrations.test.ts:131` 的 `dropAllTables()` 才清全表，該檔內有 **12** 個呼叫點：`:174 :311 :503 :617 :760 :801 :833 :910 :1025 :1117 :1198 :1308`；量測法＝`grep -cE "^\s*await dropAllTables\(\)"`，須排除 `:131` 定義與 `:704 :906 :1021 :1114 :1192` 五處註解提及。round 2 初稿誤記為 8）。而檔案順序由 vitest 預設 `BaseSequencer` 決定（冷快取 size-desc／暖快取 duration-desc），實測 `vitest.workers.config.js` **未設定** `sequence` / `sequencer` / `fileParallelism` ⇒ **順序未釘死**。故兩份 fixture 各對**一部分**檔生效 —— 這正是兩處都必須補同一 CHECK 的理由，而非其一為冗餘。

   🚫 **不得**把本段簡化成「完整套件下跑的是 `migrations.test.ts` 的 fixture」（把一次排序結果當不變條件），亦**不得**簡化成「最先建表者」（忽略 `dropAllTables()` 會重置該狀態）—— 兩者皆為已發生之誤述。

   **既有測試破壞面已事前實測為 ∅**（適用範圍：`tests/` 全樹；生效時態：base commit `4a8933ba` 快照，無機械維持；例外集合：∅；closure：下列兩道掃描窮盡 **INSERT 側**；⚠ table-level CHECK 同時約束 **UPDATE** 與 **production code 寫入路徑**，兩者另以結構性論證覆蓋 —— (i) **UPDATE 側**：`severity` 欄為 `NOT NULL` 且 CHECK 自建表即存在 ⇒ 庫內不存在非法 severity row ⇒ 未設 severity 的 UPDATE 恆通過；唯一可違例者為在 `SET` 子句中賦值 `severity`。**量測法＝兩階段**（regex 枚舉**語句** → 逐處人工讀 `SET` 子句），取代舊的單階段**子句** pattern 比對（⚠ 舊法 `grep -rniE "SET +severity"` **結構性失明** —— 抓不到 `SET archived_at = ?, severity = ?` 這類非首位賦值，與 §12 對 ES6 shorthand 失明屬同一類錯）：實測 `grep -rnE "UPDATE +audit_log\b" tests/ functions/ migrations/` 恰 **3 處**，逐處讀其 `SET` 子句 —— `tests/integration/admin-audit-delete.test.ts:163`（`SET event_type`）· `functions/api/admin/cron/audit-archive.ts:806-811`（`SET archived_at`）· `migrations/0038_audit_log_phase2.sql:37`（`SET cold_class`）⇒ **無一賦值 `severity`**。
   ⚠ **兩道掃描之已知失明面（五類，均已於 base `4a8933ba` 實測可達集合為 ∅；適用範圍：`tests/` · `functions/` · `migrations/` 三目錄；須申報而非隱含）**：
   - **UPDATE 側**：(a) `UPDATE OR REPLACE|IGNORE|ABORT audit_log`（`+` 只吃空白、吃不到 `OR <conflict-clause>`）；(b) `UPDATE` 與表名跨行分置；(c) `INSERT … ON CONFLICT … DO UPDATE SET severity` —— 上述三目錄內 `ON CONFLICT` 命中 **15 行**（其中 4 行為註解／散文），真正的 `ON CONFLICT … DO UPDATE` **SQL 站點 11 處**（含 `tenant-context.ts:91-92` 一處跨行），**無一以 `audit_log` 為目標**。⚠ 此為三目錄內之計數，**非** repo-wide（repo-wide `ON CONFLICT` 為 37 行）。
   - **INSERT 側（同族，初稿漏申報）**：(d) `INSERT OR REPLACE|IGNORE INTO audit_log` 不會被 §8.4-7 母體之 `INSERT INTO audit_log\b` 命中 —— 該 pattern 在本 repo **是活的**（三目錄內 `INSERT OR … INTO` 共 16 處，如 `cron/audit-aggregate.ts:203`、`audit-aggregate-debug.ts:169`、`[vendor].ts:161`），惟實測**無一以 `audit_log` 為目標**；(e) **動態表名** `UPDATE ${…}` 共 4 處（`audit-aggregate-archive-runner.ts:841`／`:953`、`credential-disposition.ts:212`、`credential-reverification.ts:74`），其表名來源皆為固定 allowlist（如 `credential-disposition.ts:53-55`），不含 `audit_log`。(ii) **production 寫入側**：唯一寫 `audit_log.severity` 的路徑為 `safeUserAudit`，其值由 §4.3 決策表保證恆為三合法值之一）：

   1. **母體**：`grep -rln "INSERT INTO audit_log\b" tests/` ⇒ **9 個測試檔**（`admin-audit-delete` · `audit-aggregate-debug` · `audit-aggregate` · `audit-archive` · `credential-disposition` · `device-alerts` · `migrations` · `risk-score` · `user-audit`）。
      ⚠ **詞界 `\b` 不可省**：不加會前綴誤命中 `INSERT INTO audit_log_aggregate_telemetry` / `_debug`，得 **11 檔的假影**（`audit-aggregate-archive` 與 `audit-aggregate-archive-retry` 實際完全不動 `audit_log` 本表）。此假影曾被誤採為母體數。
   2. **逐檔取實際綁值**：硬編字面量全為 `'info'`／`'warn'`／`'critical'`；**五處**變數來源亦全合法 ——
      - `tests/integration/audit-aggregate.test.ts` 的 `o.severity` 預設 `'info'`，唯一 override 在 `:199`（值 `'info'`）
      - `tests/integration/audit-aggregate-debug.test.ts` 預設 `'critical'`，override 在 `:220`（值 `'info'`）
      - `tests/integration/audit-archive.test.ts:636` `seedRow(coldClass, severity = 'info', …)`：**17 個呼叫點全數只傳 1 個參數**，故一律走預設
      - `user-audit.test.ts:137-143` `seedAudit(rows)` 的 `r.severity ?? 'info'`：**5 個呼叫點**（`:155` `:170` `:182` `:194` `:271`）實參全為 `'info'`／`'warn'`／`'critical'` 或省略
      - `migrations.test.ts:1334-1337` `for (const [et, sev] of samples) … .bind(et, sev)`：severity 由陣列解構而來（非 INSERT 位置的硬編字面量），9 筆 `samples`（`:1323-1332`）實測為 info／critical／critical／warn／warn／info／warn／warn／info，全合法。round 2 初稿把此處另段處理、未折進本枚舉，故當時的「四處」與「窮盡」不成立

   ⇒ **加 CHECK 不會破壞任何既有測試。**

   ⚠ 上述 ∅ 為 base commit 快照、**無機械維持**；完整 `test:int` 仍為 §9 required gate（它才是合入時點的權威，且涵蓋本 PR 自身新增的測試）。

   已實測：`migrations.test.ts` fixture 的 9 筆 seed（`:1323-1332`）severity 全為合法三值；新增子句不含 `;`，不觸發 split 地雷。

### 8.5 靜態驗證（coding 後）

- forced `tsc` 前後 multiset 差分：只移除目標 11 條、`ADDED=0`（dual-leaf 去重）
- `typecheck:ratchet:report` 精確為 `362 / 13 / 324 / 337`
- 驗證 changed-files 與三張 allowlist 各自完全吻合、無交叉污染
- **三支 read-only lint 的 before/after 對照**（§9.1）：`lint:migrations` · `lint:handlers` · `lint:archive-no-delete`。**base 值須於 coding 前先取**（base commit `4a8933ba`），否則轉紅無法歸因本棒。三支皆 CI 不跑
- **§2.1.1 第 3 項「型別層」機制之逐字核 diff**（⚠ **本項原僅由 §8.1-3 之散文指定、未列入本清單**；🚫 不得寫成「原落單」—— §8.1-3 早已具名指定驗收手段為「Code Gate 逐字核 diff」）：以 `git diff` 確認 **兩項**（適用範圍：本 PR 之 changed-files；生效時態：本 PR；例外集合：∅；closure：兩項窮盡 §8.1-3 所列之驗收內容）——
  (i) `audit-policy.ts` 之 `AuditSeverity` **確為** `(typeof AUDIT_SEVERITY)[keyof typeof AUDIT_SEVERITY]` 衍生形，🚫 **非**手寫 union；
  (ii) **且 changed-files 內無第二處 severity 值域之手寫 union**（量測法：`git diff` 之新增行中，同行同時含 `'info'`／`'warn'`／`'critical'` 三者之型別 union 恰 **0** 行）。🚫 **(ii) 不得省** —— §8.1-3 之驗收原文為「確認該衍生式存在**且無第二處手寫 union**」；只驗 (i) 時，同 PR 另處新增 `type Severity2 = 'info'|'warn'|'critical'` 可通過本項與八道 gate，而 §2.1.1 第 3 項承諾要消除的漂移面原封不動回來。
  ⚠ **為何必須人工核**：型別於 emit 後全數抹除 ⇒ 若改寫成手寫 `'info' | 'warn' | 'critical'`（值恰相同），`typecheck:ratchet`／§8.4-5(i) 之 `Object.values(AUDIT_SEVERITY)` 雙向 set equality（量的是 **runtime 常數**、非型別衍生關係）／八道 gate **全部維持綠** ⇒ §2.1.1 第 3 項「消除型別與 runtime 各寫一份的漂移面」之承諾靜默失效。同 §8.2.2 之「gate-invisible ⇒ 須具名驗收」標準。
- **§8.4-5 之 `DERIVED` 承諾之落地（承接 §8.4-5 自我指定之「直接量測留待 CODE 階段」）**：以 **§8.4-5(i) 之斷言通過本身**作為量測依據 —— 該斷言即在端態 `sqlite_master.sql` 上執行 `Object.values(AUDIT_SEVERITY)` ↔ `audit_log` `CHECK(severity IN (...))` 之雙向 set equality。receipt ＝ 記錄 `test:int` 中該條 test 的**名稱與結果**，落 **§15**（append-only receipt 區）。<br>⚠ **僅記名稱與結果不足**（② `CODEX-D-PLAN-R1`）：receipt **另須逐字核 diff 確認** —— (α) 候選以全域枚舉取得（`matchAll` 或等價）；(β) **索引存取之前**存在 `expect(matches).toHaveLength(1)`；(γ) 無任何 0-match 靜默通過路徑（optional chaining／預設值／早退）；(δ) `AUDIT_SEVERITY` 之 import **只供 5(i)** 使用，5(ii) 維持行內字面量 ⇒ 「SQL 側機械耦合端點恰一個」之 closure 於 CODE 階段才真正閉合。<br>⚠ **殘留風險（顯式接受）**：本棒**不**做 synthetic 0-match／2-match negative control（需在測試內偽造端態 schema，逾越 §5.2 對 `migrations.test.ts` 之兩處變更點 closure）；cardinality 斷言為最低保障，🚫 不得據此宣稱該解析器已被反向驗證。
  🚫 **不得回頭改 §8.4-5 的 `DERIVED` 標籤字串**（適用範圍：送 ① 錨定後至合入；理由：§13.1 之 carve-out closure 逐項窮盡為「W-1 item 1 §14 三列 ＋ item 2 表頭 lines 5–7 ＋ item 3 §14 ③④ 兩格 ＋ W-2 兩類」，**不含 §8.4-5 之任何字元** ⇒ 改它即觸發「須重跑 ①②」）。標籤升級留待**合入後**的 doc 維護。
  🚫 **不得規定「跑 `test:int` 後由外部工具直接讀 Miniflare 端態」** —— 實測 **`tests/` 內 `sqlite_master` 之程式碼命中（非註解）恰 7 處，全部**在測試執行期間的 `env.chiyigo_db.prepare(...)` 內（`tests/integration/migrations.test.ts:138 :151 :167 :409 :417 :579` · `tenant-foundation.test.ts:53`；生效時態：base `4a8933ba`；量測法＝`git grep -n "sqlite_master" -- tests` 得 **10** 行，扣除 `migrations.test.ts:6 :132 :680` 三處註解），`vitest.workers.config.js` 未設 persist 路徑（pool 自管並於 storage reset 時清空）⇒ **post-run 可讀性無前例、未驗證**；要印出 DDL 逐字文本還須在 `migrations.test.ts` 再加變更點，會撞 §5.2 item 5 之「**兩處**變更點」closure。
  ⚠ **本項原為懸空承諾** —— §8.4-5 已明令🚫 不得標「已驗證」，卻無對應清單項可完成該承接。
- **§4.5 hunk 逐字核 diff（`[vendor].ts`；與 §4.6 同型，理由同 §8.2.2 之「gate-invisible ⇒ 須具名驗收」標準）**：以 `git diff` 確認 —— (i) 述詞為 `typeof liveIntent?.user_id === 'number'`；(ii) true 支為 `liveIntent.user_id`；(iii) false 支為 `null`；(iv) 該檔 diff 之 hunk 數**恰 1**。
  ⚠ **為何本項不可省**（實測）：`payment.webhook.orphan_intent` 在 `tests/` 之命中數為 **0**（全 repo 僅 `[vendor].ts:224` 之 emit 點與 `audit-policy.ts:296` 之 registry 兩處），`tests/integration/payments.test.ts` 四個 orphan 案例只斷言 `payment_webhook_dlq.error_stage` 與 intent status ⇒ 該稽核 row 的 `user_id` 是**活的、且無人斷言的值**。而 `strict:false`（`strictNullChecks` off）下把三元式誤寫成 **`? null : null`**（或等價常值化）**不產生任何診斷** ⇒ §8.5 期望之 `362/13/324/337` 與 `ADDED=0` 全部維持、八道 gate 全綠，orphan 稽核之 `user_id` 靜默歸零（Tier 0 證據面遺失）。
  ⚠ **已排除之子情形**：`typeof` 判**反**不屬本缺口 —— false 支窄化為 `string | null`，`string` → `number | null` 在 `strict:false` 下仍為 `TS2322` ⇒ `ADDED>0`、ratchet 轉紅。唯「兩支同值」為真正 gate-invisible 者。
- **§4.6 hunk 逐字核 diff（`ARCH-D-L4` 同型之機械清點）**：以 `git diff` 確認 —— (a) 常數具名 `AUDIT_WEBHOOK_TIMEOUT_MS` 且值為 `8000`，**且 `setTimeout` 之延遲引數逐字為該常數**（🚫 不得為字面量 `8000` 或另一常數）；**(a2) 同一 controller／同一 timer 之耦合逐字核**（② `CODEX-D-PLAN-R2` Required）：`const ctrl = new AbortController()` 恰一處、timer callback 逐字為 `() => ctrl.abort()`、(b) 之 `signal: ctrl.signal` 與 (c) 之 `clearTimeout(timer)` 皆綁**同一** `ctrl`／`timer` —— ⚠ **理由**：no-op timer（如 `setTimeout(() => {}, 8000)`）或另建之第二個 controller，**可通過原 (a)(b)(c)(d) 與 §8.2.2 之機械斷言而完全沒有 timeout**；(b) 本身亦只證明「某個未 abort 的 signal 被傳入 `fetch`」。🚫 較佳方案（abort-path integration test）因 zero-env 決策不做（取捨見 §8.2.2）⇒ **平台實際取消行為列為顯式殘留風險**（見 §4.6 標軸段）；(b) `signal: ctrl.signal` **確實傳入** `fetch` init；(c) `clearTimeout(timer)` 位於 `finally`；(d) 測試側 `AUDIT_WEBHOOK_TIMEOUT_GUARD` 識別字全 repo 恰 **1** 處（§8.2.2）；**(e) `functions/utils/user-audit.ts` 新增行含以 `// TECH-DEBT:` 起首之單行註解，且其文字與 §4.6 第二 code block 之 `// TECH-DEBT:` 行**逐字相同**（🚫 本項不枚舉字串，避免第二份可漂移副本）** —— ⚠ 該標記是全域 §例外處理流程 item ① 之**唯一 discharge artifact**，且**§9 八道 gate 無一會偵測其缺失**（`typecheck-ratchet.mjs` 之 `BAN_PATTERNS` 不命中、ESLint 無 `no-warning-comments`）⇒ 依本檔「gate-invisible ⇒ 須具名驗收」標準必須列項。⚠ **本項為顯式取捨、非遺漏**：§9 八道 gate 對 (b) 缺寫**無一會轉紅**（`ctrl` 仍被 `setTimeout` callback 使用 ⇒ ESLint `no-unused-vars` 不響），故本 PR **唯一今日可觀測的**行為交付物之驗收由「§8.2.2 機械斷言 ＋ 本項人工 receipt」雙層承擔
- **suppression 逐字清點**：以 `git diff` 確認新增 `@ts-expect-error` 恰 2、新增行 `as const` 恰 **0**、`as AuditSeverity` 恰 **0**（§5.5；ratchet 只驗 `@ts-expect-error` 格式、**不驗數量亦不擋 cast**）
- **emit 等價驗證**（§11.3 之承重量測）：`replay.ts` 的 §4.4 兩行被宣稱為「純型別、emitted-runtime diff ≡ ∅」，而 §11.3 **第 1 項（Queue/Message）** 的 discharge **完全建立在該 ∅ 上**（⚠ 第 6 項 Distributed State 之 **bullet 1–4** discharge 依據為（🚫 bullet 5 為 `PARTIALLY SATISFIED`、未 discharge，見 §11.3-6）「claim／租約／CAS 語義零改」與 §10 之 failure mode 記載，**不**依賴本 ∅；第 7 項亦僅部分依賴〔其 (a)(c) 兩處涉入面之 hunk 為純型別〕）。

  ⚠ **§9 之 required gates 無一驗證 `functions/` bundle 之 emit 等價**（適用範圍：§9 所列**八道**〔`lint` · `typecheck:ratchet` · `test:cov` · `test:int` · `verify:browser-pipeline` · `build:functions` · `npm audit` · `lint:migrations`，其中 `lint:migrations` 之列入理由見 §9.1〕；生效時態：本 PR；**例外集合：∅**；closure：八道**逐道具名**判定窮盡）：`lint` · `typecheck:ratchet` · `test:cov` · `test:int` · `verify:browser-pipeline` · `npm audit` · `lint:migrations` **七道皆不比對 `functions/` 產物位元組**；`build:functions` 只驗建置成功、**不比對 base 與 post-change**。
  ⚠ **易誤讀之近似項（非例外）**：`verify:browser-pipeline` **確有 artifact 位元組比對**（`scripts/verify-browser-pipeline.mjs:325-357`；比對前另跑 `assertClassicShape`〔`:331`〕與 `injectI18n`＋`I18N_RESIDUAL` 檢查〔`:338`／`:340`〕，CRLF→LF normalize 在 `:346-348`），但其客體為 **`public/js` 之 browser emit**，與 `replay.ts` 之 functions emit **零交集** ⇒ **滿足**上述宣稱、不構成例外，故例外集合仍為 ∅。⇒ 以 repo **canonical recipe**（`feedback_byte_identical_emit_verification`；落地前例 `stage7-pr2ci-setup-noimplicitany.md:138`／`:175`、`stage7-pr2cf-turnstile-noimplicitany.md:107`）對 `functions/api/admin/event-dlq/[id]/replay.ts` 做 **esbuild stdin type-strip** 之 base vs head 比對：

⚠ **落點必須在 repo 外**（`/tmp/`），與 canonical 前例 `stage7-pr2ci:175-180` 一致：相對路徑會把 4 個產物寫進 repo root，實測 `git check-ignore` **無一被忽略** ⇒ 會打破本節「changed-files 與三張 allowlist 完全吻合、無交叉污染」之驗證項，並踩 `feedback_commit_verify_staged_set_and_net_source_diff` 的 stray-file 掃入風險。

```bash
## 在 Git Bash 執行（PS 5.1 無 < redirection；esbuild.ps1 另受 execution policy 阻擋）
git show 4a8933ba:'functions/api/admin/event-dlq/[id]/replay.ts' \
  | node_modules/.bin/esbuild --loader=ts --format=esm > /tmp/base.js 2> /tmp/base.err
node_modules/.bin/esbuild --loader=ts --format=esm \
  < 'functions/api/admin/event-dlq/[id]/replay.ts'      > /tmp/head.js 2> /tmp/head.err
wc -c /tmp/base.js /tmp/head.js ; sha256sum /tmp/base.js /tmp/head.js
diff -q /tmp/base.js /tmp/head.js ; git status --porcelain   # 末項須維持僅 ?? CLEANUP_PLAN.md
```

receipt 須同時列：兩端 `wc -c` **皆 > 0 且相等** · 兩端 sha256 · `diff -q` IDENTICAL · **`base.err`／`head.err` 皆空**（🚫 不得 `2>/dev/null`）。<br>⚠ **必用 `--format=esm`** —— `stage7-pr2ci:138` 明載 plan v1 誤用裸 `--loader=ts` 曾遭 **Codex Plan r1 要求修正**；非 canonical 之 receipt 無法唯一重播。<br>⚠ 空輸出陷阱：`--loader` 用於 **file-entry**（而非 stdin）時 esbuild 輸出 0 bytes 而 `diff` 仍報相同，故上述 bytes>0 斷言為必要。<br>🚫 **不得改用 `npm run build:functions` 做此比對** —— 該指令為 `wrangler pages functions build`，產出**單一 bundled Worker**、無 per-source 產物；且本 PR 另刻意改動 `user-audit.ts`／`audit-policy.ts`／`[vendor].ts` 之 runtime，整包 bundle 必然不同，永遠 discharge 不了本 ∅。`build:functions` 於 §9 僅承擔「Compiled Worker successfully」。<br>⚠ 本 recipe 只驗**單檔 type-strip 等價**（`replay.ts` 有 import，非完整 bundle）—— 而 §11.3-1 所需者正是此層級

---

## 9. Required gates（merge 前跑齊，對齊 `.github/workflows/ci.yml`）

`lint` · **`typecheck:ratchet`（enforcing）** · `test:cov` · **完整 `test:int`** · `verify:browser-pipeline` · `build:functions` · `npm audit --omit=dev --audit-level=high` · **`lint:migrations`（CI 不跑，見下）**

### 9.1 `lint:migrations` 為何必須列入（本棒特有）

**本 PR 觸及該 linter 兩個輸入之一。** `scripts/lint-migrations-coverage.mjs` 有兩個輸入：`MIG_DIR = migrations/`（`:9`，rule M 驗編號無 gap／無重複，`:50-88`）與 `TEST_FILE`（`:10`，寫死 `tests/integration/migrations.test.ts`，rule A/B/C/D）。本棒**不動** `migrations/**`（§5.4 已排除），但**要動** `TEST_FILE` —— 加兩處變更點與一行頂層 import。

⚠ 🚫 **不得**把 `TEST_FILE` 稱為該 linter 的「唯一客體」—— `MIG_DIR` 是它的另一個輸入（此誤述曾於自審輪次發生）。

> **SPEC delta 聲明**：把 `lint:migrations` 列入 §9 required gates ＋ §8.5 新增「coding 前取三支 lint base 值」義務，屬**流程面 scope 增量**（來源＝plan self-review round 1 finding A2），非 owner 於 SPEC 核准之原始 gate 清單。送 ① 時須在 delta 中顯式列出，不得當作修 finding 的副產品滑入。

**且 CI 不會替我們跑它**（實測）：

| 指令 | 內容 | 是否含 `lint:migrations` |
|---|---|---|
| `npm run lint`（`ci.yml:30`） | `eslint functions tests && lint:compat-date && lint:workflows` | **否** |
| `npm run build:functions`（`ci.yml:54`） | 只建 functions bundle | **否** |
| `npm run build`（`package.json:9`） | `build:partials && lint:handlers && lint:archive-no-delete && lint:migrations` | 是，但 **CI 不跑此指令** |

⇒ `lint:migrations` 在 CI **完全不執行**，亦無 git hook 覆蓋。

⚠ **用獨立子命令 `npm run lint:migrations`，不要用整包 `npm run build`。** `build` 會先跑 `build:partials` 寫 tracked `public/`，在只有 10 檔 allowlist 的本 PR 會製造 churn 並牴觸 §5 三張清單。同理建議一併跑另兩支 read-only lint：`lint:handlers` · `lint:archive-no-delete`。

**base 基準（coding 前先取，否則轉紅無法歸因本棒）**：於 base commit `4a8933ba` 記錄三支 lint 的輸出，coding 後取 after 值對照。此為 §8.5 的追加項。

⚠ **必須是 `typecheck:ratchet`，不是 `typecheck:ratchet:report`。** 與 `ci.yml:33` / root `CLAUDE.md` §4 / `stage7-pr2dv-line-idtoken.md:189` / `stage7-pr2dw-batchc2-*.md:258` 同一字串。`:report` 變體在 `scripts/typecheck-ratchet.mjs:929-938` 提前 return，**不** enforce 規則 A–E、**不**呼叫 `checkDiffSuppressions()` ⇒ §5.5 的兩個 `@ts-expect-error` 將完全失去唯一的機械驗證。

`typecheck:ratchet:report` 僅保留為 §6 / §8.5 的**取數指令**，不得代替 gate。

local 執行：commit 後跑 plain `npm run typecheck:ratchet`；或 commit 前 `$env:RATCHET_BASE_REF='4a8933ba'; npm run typecheck:ratchet`（**不帶** `RATCHET_ALLOW_BASELINE_RAISE`）。

機械 gate 直接跑命令讀真實輸出，不靠 agent 推理。

**不需 cache-bust**：changed-files 全在 `functions/` · `tests/` · `docs/`，`src/js` 零變更（`docs/asset-versioning.md`）。

**無 migration**：production `migrations/**` 零改動 ⇒ 不觸發 `feedback_migration_before_merge_autodeploy` 的 expand→migrate→contract 流程。測試 fixture 的 CHECK 不是 migration。

---

## 10. 風險與失效模式

| 風險 | 影響 | 緩解 |
|---|---|---|
| CHECK 違例被誤判為 missing-column | audit row 靜默流失 | `user-audit.ts:108-109` 已明載 CHECK 違例**不**走 fallback → `throw` → outer catch → `[audit-loss]`。症狀是可觀測的 loss 訊號，非壞資料入庫。§8.2 斷言「無 `[audit-loss]`」即為此把關 |
| `_setup.sql` 共用 fixture 加 CHECK 觸發他處既有測試 | CI 紅 | **§8.4-7 已事前實測破壞面 ＝ ∅**（**9** 個 seed `audit_log` 本表的測試檔逐檔取綁值，全為合法三值；數字以 §8.4-7 為準）⇒ 與檔案執行順序**無關**皆不破壞；另以 §9 required gates 的完整 `test:int` 作合入時點權威（涵蓋本 PR 自身新增測試） |
| stored severity 與 `cold_class` 分歧 | 觸發 `audit.archive.cold_class_drift` critical 事件 | §4.3 不變量 2：同一有效值計算 |
| fallback 誤觸 Discord | 告警疲勞 | §4.3 不變量 3：`parsed === 'critical'` |
| 省略 severity 被誤送 fallback | 42 個 call site 的 retention 大面積漂移 | §4.3 二分鎖 + §8.2 專屬回歸案例 |
| `[vendor].ts` hunk 擴散 | 金流路徑 scope creep | §4.5 單 hunk 限制；orphan 路徑由 §9 的**完整 `test:int`** 涵蓋（`vitest.workers.config.js` include `tests/integration/**/*.test.{js,ts}` ⇒ `tests/integration/payments.test.ts` 的 orphan cases 必然執行） |
| **`payment_webhook_events` 永久卡 `'processing'`**（適用範圍：`[vendor].ts` 之 `apply_status` 狀態機；生效時態：**base 即存在，本 PR 不改變**；⚠ **本列不作 closure 宣稱** —— 下列 (1)+(2a/2b/2c) 為**充分條件（entry path）之已知枚舉**，🚫 不宣稱窮盡，故亦不列「例外集合」；**終端不可恢復性**則另由下述四條依據支撐，該四條**為窮盡**〔已掃遍 `functions/` · `migrations/` · `cron/` · adapter 層，無第五個可能的恢復面〕） | **進入該狀態之已知路徑**：(1) row 已由 `:163`（`VALUES … 'processing'`）或 `:185-186`（`failed → processing` 之 CAS 重新 claim）置為 `'processing'`；**且** (2) `markWebhookEventFailed` **未成功寫入** —— 涵蓋三種情形：(2a) 五個呼叫點（`:256` `:262` `:335` `:416` `:468`）**未執行**（Worker wall-clock 被砍、isolate 回收、未捕捉之 throw 逃出 handler）；(2b) 有執行但 `:499` 的 `catch { }` **吞掉 UPDATE 失敗**（⚠ 相關性失效：該 catch 正是在 D1 已出錯時被觸發）；(2c) `:486` 的 `if (!env?.chiyigo_db \|\| !eventId) return` 使 `markWebhookEventApplied` 靜默 no-op 而 handler 仍回 success ⇒ PSP 永不重送。⚠ **(2c) 今日不可達，列出僅為前瞻護欄**（依 §12 對可達集合之同一舉證標準）：`!env?.chiyigo_db` 與前提 (1) **互斥**（(1) 要求 row 已寫成 `'processing'`，而該 INSERT 於 `:159` 直接用 `env.chiyigo_db`，db falsy 則 row 從未建立）；`!eventId` 需要「回 ok 但 `event_id` falsy」之 adapter，而 `ADAPTERS`（`payments.ts:429-434`）僅 `ecpay`／`mock` 二者 —— `payment-vendors/ecpay.ts:239-246` 三分支恆產生非空字串、`payment-vendors/mock.ts:41-42` 顯式 `if (!payload?.event_id …) return { ok:false }`（全檔唯一 `ok: true` 在 `:46`）。⇒ **今日可達集合 ＝ ∅**；本項為**未來新增 adapter 時的護欄**，🚫 不得據以宣稱該路徑今日存在。<br>⇒ **終端且不可恢復**（四條獨立依據）：`'processing'` 不在 `:181-186` 的 CAS 可 claim 集合；`:215-218` 使 PSP 後續重送恆被擋（ECPay adapter 走 `failureResponse`〔`utils/payment-vendors/ecpay.ts:278`〕，未定義該方法之 adapter〔如 `mock`〕走 `:218` 的 `res(…, 409)`）；`functions/` 內除本 handler 外**無任何程式碼寫 `apply_status`**；**`cron/cleanup.ts:71-76` 對此表有具名條目，但為註解形式的刻意排除**（Codex r1 P1-4，2026-05-13：「不再 90 天清掉…dedupe 是第一道，不能挖洞」）—— 即其 `TASKS` 陣列（實測 14 個條目）**無該表之執行項** ⇒ 無 GC、無 TTL、無 reaper（`migrations/0042_payment_webhook_apply_status.sql` 亦僅 ADD COLUMN + index） | **既有性質，本 PR 不改變**（本 PR 對 `[vendor].ts` 僅 §4.5 一個落庫等價 hunk）。⚠ 本列為 §11.2 item 2「failure mode 列表」之交付內容；⚠ **(2a) 的既知最可能觸發路徑已於本棒收斂** —— 原為本表末列之 `notifyCritical` 無界外呼；§4.6 補上 bounded timeout 後，該路徑之 `await` 會在 **8000ms 後被請求取消**而結束，不再能無界拖長 handler（🚫 不得述為「8000ms 上限」；精確語義與三項殘留見 §4.6 標軸段）。🚫 但這**不代表 (2a) 已消除**：Worker wall-clock 上限仍可能被其他因素（D1 慢查詢、PSP payload 過大、isolate 回收）觸及，且本棒**未補 reaper** ⇒ 終端狀態本身不變。🚫 本棒**不**補 reaper（屬 `[vendor].ts` 狀態機變更，遠超 §5.1 allowlist 之單 hunk 限制）；⚠ 追蹤見 **§10.1.1 `GOV-WEBHOOK-STUCK-PROCESSING-REAPER-001`**（🚫 **不再**指向 `TD-BATCHD-1` —— 該債已於本棒 `CLOSED_PARTIAL`（僅根因 (1)(3)），其「清理觸發條件」欄位已不存在；reaper 缺口原寄生於該欄，本輪改為自有條目） |
| **PSP retry → audit 重放放大**：同一邏輯 event 重跑 `handleOrphan` | 重複 `payment.webhook.orphan_intent` critical row ＋ 重複同步 Discord fetch（⚠ **該外呼已於本棒 §4.6 收斂為每次 8000ms 後請求取消**（精確語義與殘留風險見 §4.6 標軸段），🚫 不得再述為「無界外呼債」；殘留放大面為外呼**次數**與告警風暴，**非**單次 wall-clock 無界。⚠ 亦 🚫 不得寫成「N 次 retry ⇒ 聚合 N×8000ms」—— PSP retry 為各自獨立的 webhook 投遞／獨立 Worker invocation，該 8000ms 取消請求不在單次 invocation 內累加）＋ 重複 `security_critical` archive 素材 | **既有性質，本 PR 不改變**（`audit_log` 無 dedupe key，見 §11.3）。⚠ **今日無 mitigation（accepted, pre-existing）** —— `event_id` 雖已隨 `event_data` 落庫並通過 `admin/audit.ts:36` 白名單與 `utils/audit-archive.ts` 匯出，但實測 **`functions/`** 現有 **12 個 `FROM audit_log` 站點／8 檔**（其中 `admin/audit/[id].ts:66` 為 `DELETE`，餘 11 個為讀取）**無一執行此去重**（適用範圍：`functions/**/*.ts`；生效時態：base `4a8933ba`；量測法＝`git grep -in "FROM audit_log" -- functions`，輸出行數即 12、去重路徑數即 8）。「下游以 `event_data.event_id` 去重」為 **prescriptive-for-future**，非現行控制 |
| **`notifyCritical` 的 Discord webhook 外呼**（`user-audit.ts:246` `fetch`） | **本棒前**：無 timeout、無 retry policy、無 `AbortSignal` ⇒ critical 事件可無界佔用 Worker wall-clock，為上方「永久卡 `'processing'`」列之 (2a) 的既知最可能觸發路徑。 | **⚠ 本棒已收斂（非「不改」）**：§4.6 補上 zero-env bounded timeout（`AUDIT_WEBHOOK_TIMEOUT_MS = 8000` ＋ `AbortController` ＋ `signal`），`TD-BATCHD-1` 隨之 **`CLOSED_PARTIAL`**（僅根因 (1)(3)；§10.1）。<br>依據＝① `GPT-D-ARCH-RR1`（Tier 1）：不得以 repo 內未設定推導 production 未設定 ⇒ `DISCORD_AUDIT_WEBHOOK_PROD_STATE = UNKNOWN`；owner 2026-08-05 選 **選項 B** 使該 UNKNOWN 不再承重。<br>🚫 **retry 明示不補**（fire-and-forget 告警；⚠ 失敗類二分見 §4.6 不變量 1 —— **(F-a)** reject 進 `:160` 空 catch、**(F-b)** HTTP 非 2xx 不 reject 且 `res.ok` 從未被讀 ⇒ 零訊號。🚫 不得寫成「失敗一律由 catch 吞」。兩類皆不影響落庫；補 retry 須連同告警去重設計）。<br>⚠ 本收斂**不消除**上方列之終端狀態 —— wall-clock 仍可被其他因素觸及，且本棒未補 reaper |

---

### 10.1 tech-debt 追蹤：`TD-BATCHD-1 notifyCritical 無界外呼` — **`CLOSED_PARTIAL`（僅根因 (1)(3)）**

⚠ **本節一律用具名 token `CLOSED_PARTIAL`，🚫 禁用無限定的「CLOSED」** —— 根因四項中 (2) retry 與 (4) `await` 同步等待**皆未處置**（見「狀態」與「殘留」欄）。無限定寫法會讓 ③④ 形成「四項根因全清」的既定印象，正是本節明令禁止的讀法。

> **本節即 record of record。** 本 repo **無以 GitHub issue 追蹤 tech-debt 之既有慣例**（**生效時態：base `4a8933ba` 快照**；實測追蹤檔內 code 標記恰 **2** 處：`src/js/portfolio.ts:24` 與其 build artifact `public/js/portfolio.js:24`，為同一標記之原始檔與產物副本，皆無 issue 編號；`.github/` 無 `ISSUE_TEMPLATE`。⚠ **本 PR 依 §4.6 將新增第 3 個 code 標記**（`functions/utils/user-audit.ts`），同樣無 issue 編號 ⇒ 不改變本結論），故不另開 issue。🚫 **不得**寫成「本 repo 無 issue 通道」——GitHub Issues 為平台側開關、工作樹不可見，由 repo 內缺席推平台側能力缺席即 ① `GPT-D-ARCH-RR1` 判為不成立之同型推論。

| 欄位 | 內容 |
|---|---|
| ID | `TD-BATCHD-1` |
| 狀態 | **`CLOSED_PARTIAL`（僅根因 (1)(3)）—— 由本棒 §4.6 清理**（🚫 具名 token，不得寫無限定「CLOSED」，見 §10.1 節首）。⚠ 四項限定：適用範圍＝根因 (1) 無 timeout ＋ (3) 無 `AbortSignal`；生效時態＝本 PR 合入後；例外集合＝根因 (2) retry 與 (4) `await` 同步等待，**兩者皆未處置**、見「殘留」欄；closure＝本 TD 之根因欄四項窮盡 |
| 標的 | `functions/utils/user-audit.ts:246` `notifyCritical` 的 `fetch` |
| 根因（**四項，逐項須有去向**） | (1) 無 timeout · (2) 無 retry policy · (3) 無 `AbortSignal` · (4) **為 `await` 同步等待**。<br>⚠ 去向：(1)(3) 由 §4.6 清理；(2) 見「殘留」欄；**(4) 未處置，見「殘留」欄** —— 🚫 不得因 (1)(3) 已清而把整條 TD 讀成「根因全清」 |
| 清理方式 | **§4.6 之 zero-env 變體**：模組常數 `AUDIT_WEBHOOK_TIMEOUT_MS = 8000` ＋ `AbortController` ＋ `try/finally clearTimeout` ＋ `signal`。🚫 未擴 `UserAuditEnv`／`types/env.d.ts`／allowlist |
| 觸發清理之依據 | ① `GPT-D-ARCH-RR1`（Tier 1）：`DISCORD_AUDIT_WEBHOOK_PROD_STATE = UNKNOWN`，不得以 repo 內未設定推導 production 未設定。owner 2026-08-05 選擇**選項 B**（先行納入 timeout）而非 A（取得外部 presence receipt） |
| owner 欄之處置（**逐根因**，🚫 不得再寫無限定的「不再適用」） | **(1)(3)**：不再適用 —— 已於本棒清理，無待執行控制需要 owner。<br>**(4)** `await` 同步等待：owner ＝ **repo owner**；觸發條件同「殘留」欄之承接說明。<br>**(2)** retry policy：owner ＝ **repo owner**；觸發條件＝「若未來要補 retry」之棒次啟動時，須連同告警去重／風暴抑制一併設計。<br>⚠ **依據**：① `GPT-D-ARCH-RR1` 第 3 點「無 owner 的觸發條件不構成可執行控制」對**延後**之根因 (2)(4) 適用；本檔於 §5.4.2／§10.1.1／§10.1.2 三處均據此填 owner，此處不得例外 |
| **驗收／防回歸依據** | ⚠ **`CLOSED_PARTIAL` 必須有機械維持，否則 record of record 會靜默失真**（未來棒次移除 hunk 時本表仍寫 `CLOSED_PARTIAL`）。二層：(a) **§8.2.2 `AUDIT_WEBHOOK_TIMEOUT_GUARD`** —— integration 斷言 `fetch` init 之 `signal` 為 `AbortSignal`，移除 §4.6 即轉紅；(b) **§8.5 §4.6 逐字核 diff** —— Code Gate 人工 receipt。🚫 缺此列時本 `CLOSED_PARTIAL` 無任何維持力（§9 八道 gate 對漏寫 `signal:` 全綠） |
| **殘留（不在本棒）** | **retry policy 未補**。§4.6 只補 timeout，未補有界重試。⚠ 失敗類二分見 **§4.6 不變量 1**：**(F-a)** reject（含 abort）進 `:160` 空 catch；**(F-b)** HTTP 非 2xx **不 reject**、且 `notifyCritical` 從不讀 `res.ok` ⇒ 該失敗**完全未被偵測**。🚫 不得以「失敗本就被 catch 吞掉」作全稱描述（只對 (F-a) 成立）。兩類皆不影響落庫（fire-and-forget，`user-audit.ts:9-10` 明載設計本意）⇒ 無 retry 不構成**落庫正確性**缺口。<br>⚠ **殘留其二＝告警投遞失敗零可觀測性**（(F-b) 尤然）：**機制 base 既有**；🚫 **不得**無限定寫成「本 PR 不改變」—— §4.6 之 abort 使 **(F-a) 之可達集合擴張**（機制／可達集合二分見 **§10.1.2 性質欄**；② `CODEX-D-PLAN-R2-RR4` Required）。🚫 本棒不補 `res.ok` 檢查或 log —— 那是 `user-audit.ts` 第 4 組 hunk，逾越 §5.1 三 hunk 自我約束；追蹤見 **§10.1.2**。🚫 retry 本棒不補、亦不另立 TD —— 若未來要 retry，須連同「告警去重／風暴抑制」一併設計。<br>⚠ **殘留其三＝根因 (4)「`await` 同步等待」未處置**：§4.6 只把該同步等待改為**8000ms 後請求取消**（精確語義與殘留風險見 §4.6 標軸段），**未**改變它仍在 handler 主線上阻塞的性質。<br>⚠ **`ctx.waitUntil` 派送軸：已評估、否決，理由如下（🚫 先前寫「未評估」卻同時給出成本結論，違反本檔之 `MEASURED`／`DERIVED` 標籤紀律；且該成本論證結構性錯誤，一併更正）**：<br>🚫 **作廢的舊論證**：「需 `safeUserAudit` 取得 `ctx` ⇒ 跨 289 個呼叫點／92 檔的簽章變更」**不成立** —— 在 `safeUserAudit(env, entry)` 後加**optional 第三參數**（`ctx?: { waitUntil(p: Promise<unknown>): void }`）對既有全部兩引數呼叫點**零改動即編譯通過**。<br>🚫 **作廢的舊前例引用**：`user-audit.ts:157-158` 之註解自述「沒 `ctx.waitUntil` 鉤點時只能同步等」只是**該檔當時未接**，非 repo 層事實 —— **`functions/` 實測**（適用範圍：`functions/**/*.ts`；生效時態：base `4a8933ba`；量測法＝`git grep -n "waitUntil" -- functions`）`waitUntil` 命中 **17 行**，且已有三處 optional-param plumbing 前例：`functions/api/auth/local/forgot-password.ts:23`＋`:133` · `functions/api/auth/local/register.ts:29`＋`:220` · `functions/api/auth/oauth/end-session.ts:69`＋`:95-96`（後者更是把**util 函式之回傳 promise** 交給 `waitUntil`，證明不限 handler-only）。<br>✅ **真正的阻擋點**：optional param 本身落在 §4.2 hunk 內、不逾越 §5.1；但**要拿到效益**必須在**呼叫端所在檔**加傳 `ctx`，而金流路徑之呼叫端 `[vendor].ts` 受 §4.5「本檔只允許一個 hunk」限制、其餘呼叫端所在檔亦不在 §5.1 allowlist ⇒ 逾越 scope。🚫 不得再把阻擋點記成「`safeUserAudit` 的簽章變更」或「§5.1 三 hunk 限制」（後者是 `user-audit.ts` 的預算，指錯限制對象）。<br>⚠ **本項之 record of record ＝本欄，🚫 不得委派給 §10.1.2** —— §10.1.2 之客體 closure 明限為「**告警未送達且無訊號**」之三類成因，而本項是「**告警阻塞 handler**」，**客體不同**；委派過去會破壞該節的 closure。（此誤曾於本檔發生：round 16 曾寫「追蹤併入 §10.1.2」。）<br>⚠ 故 `TD-BATCHD-1` 之 **`CLOSED_PARTIAL` 僅涵蓋根因 (1)(3)**，🚫 不得讀為「四項根因全清」 |

⚠ **全域 §例外處理流程 之**四件**要求，逐根因判定**（🚫 客體為全域流程本身，**四件**不得寫成三件 —— 第 4 件曾於本檔被靜默丟棄）：<br>· **根因 (1)(3)**（已清理）：四件要求皆不再適用。<br>· **根因 (2) retry ／ (4) `await` 同步等待**（**仍延後**）：全域 §程式碼要求「所有外部呼叫必設 retry policy」對 `notifyCritical` **仍被違反**，屬 live 規則例外。四件之落地：<br>　**① code 標記**＝**落點指定為** §4.6 **第二** code block（落地驗收見 §8.5 (e)；🚫 本處不複述字串）。⚠ **不新增 hunk**、不逾越 §5.1。🚫 先前以「§5.1 三 hunk 自我約束」為由不落，已作廢 —— 首要理由是**事實錯誤**（於已新增之 block 內加註解行**不新增 hunk**），次要理由才是循環論證。<br>⚠ **作廢範圍嚴格限定**（適用範圍：以本檔自訂之 scope 預算拒絕**全域強制流程所要求之交付物**，本例＝§例外處理流程 item ① 之 code 標記；生效時態：本 PR 起；例外集合：∅；closure：本例外恰此一用法）。🚫 **不得推廣** —— §4.6／§10.1「殘留」／§10.1.2／§12／§13 五處以同一約束拒絕者其用法**仍然有效**、未被作廢。<br>　**② PR 描述**＝本節 ＋ §13 非目標。<br>　**③ backlog issue**＝依**本節節首**之判定（🚫 不複述舉證素材，避免第二份可漂移副本）⇒ 以本節「殘留」欄替代。<br>　**④ 安全相關違反必額外通報**＝**判定為「是」**：本違反之客體為 **critical 稽核告警之投遞**（`mfa.totp.disable`／`account.delete`／`payment.webhook.orphan_intent` 等），屬安全訊號面。<br>**通報管道＝本 PLAN 送外部時之當輪中文 6 欄報告第 ⑥ 欄（殘留風險／需 gate 特別看的地方）**（🚫 不綁輪次；輪次時態由表頭與 §14 表持有，§10.1 不另持第二份）。🚫 **不得以 §10.1／§10.1.2 充當**（依據＝全域「不可只走此流程」）。

#### 10.1.1 `GOV-WEBHOOK-STUCK-PROCESSING-REAPER-001`

⚠ **為何必須新立**：`TD-BATCHD-1` 被部分 CLOSE（`CLOSED_PARTIAL`，僅根因 (1)(3)）之前，§10 之「永久卡 `'processing'`」列以「追蹤見 §10.1 之 `TD-BATCHD-1` **清理觸發條件**」把 reaper 缺口**寄生**在該債的追蹤欄位上。本棒把 `TD-BATCHD-1` 標為 `CLOSED_PARTIAL` 後，該寄生欄位隨之消失 ⇒ **reaper 缺口一度變成零追蹤 artifact**。依 ① `GPT-D-ARCH-RR1` 第 3 點之同一原則（「無 owner 的觸發條件不構成可執行控制」），此缺口須有**自己的**具名條目。

| 欄位 | 內容 |
|---|---|
| backlog ID | **`GOV-WEBHOOK-STUCK-PROCESSING-REAPER-001`** |
| 標的 | `payment_webhook_events.apply_status` 卡在 `'processing'` 後**無 reaper／無 GC／無 TTL**；`cron/cleanup.ts:71-76` 為註解形式之刻意排除（Codex r1 P1-4） |
| 性質 | **recovery gap**（§11.3.1 分類），**非** bullet 5 違反；base `4a8933ba` 既有，本 PR 不改變 |
| owner | **repo owner**（單一 owner；🚫 不得留「待指派」） |
| 觸發條件 | **二者先到即觸發**：(a) `payment_webhook_events` 出現任一筆 `apply_status='processing'` 且 `processed_at` 早於 24 小時之 row；(b) memory 待辦「金流完整 smoke（等 F-2 金流全寫完）」啟動時。<br>⚠ **(a) 目前不是機械觸發** —— 🚫 repo 內**無任何** cron／巡檢會偵測此狀態（`cleanup.ts` 對該表無執行項，正是本條目存在的理由，見 §10）⇒ (a) 需 owner 於真實流量啟用後**主動查詢**。承接棒次若要把 (a) 機械化，等於已在補 detection，屬本條目範圍內之第一步 |
| 🚫 本棒立場 | **不補** —— 屬 `[vendor].ts` 狀態機變更，遠超 §5.1 之單 hunk 限制；且 `cleanup.ts` 不在任何 allowlist |
| ⚠ 正交性 | 本項客體＝**recovery**。🚫 不得與 §10.1.2（**alert delivery observability**）或 §10.1.3（**transition history / durable evidence**）互相代替（① `GPT-D-ARCH-R2-RR1` 第 4 點） |
| ⚠ 設計約束（供承接棒次） | 任何 reaper **不得**直接把 `'processing'` 改回 `'failed'` 而不留憑證 —— 該狀態之成因包含「orphan 憑證未落」（§11.3.1 第三項殘留），盲目 reset 會使 PSP retry 重跑 `handleOrphan` 卻仍無憑證。須先落 DLQ 再 reset |

#### 10.1.2 `GOV-AUDIT-ALERT-DELIVERY-OBSERVABILITY-001`

| 欄位 | 內容 |
|---|---|
| backlog ID | **`GOV-AUDIT-ALERT-DELIVERY-OBSERVABILITY-001`** |
| 標的 | `functions/utils/user-audit.ts` 之 critical 告警**投遞失敗零可觀測性**，客體為**三類**（適用範圍：`notifyCritical` 之投遞軸；例外集合：∅；closure：下列三類窮盡「告警未送達且無訊號」之全部成因）：<br>**(F-a)** `fetch` reject（network／DNS／TLS／abort）由 `:160` **全空** catch 吞掉、無 log；<br>**(F-b)** HTTP 非 2xx —— `fetch` 正常 resolve，而 `notifyCritical`（`:246-251`）**從不讀 `res.ok`**、不持有 response 變數 ⇒ 連失敗都未被偵測；<br>**(F-c)** `:241-242` `if (!url) return` —— `DISCORD_AUDIT_WEBHOOK` 缺值 ⇒ **`fetch` 從未發出**、空 catch 不會被進入、零 log。<br>⚠ (F-a)/(F-b) 之定義見 §4.6 不變量 1（其 closure 客體為「`fetch` 之失敗」，**不含 (F-c)**）；🚫 **不得**以該二分代表本欄之三類客體 |
| 性質 | **缺口本身（零可觀測性）＝ base `4a8933ba` 既有，本 PR 不改變**；🚫 **不得**歸因於 §4.6 —— (F-a) 之靜默吞掉機制在 base 即存在。<br>⚠ **但須區分機制與可達集合**（② `CODEX-D-PLAN-R5` Required）：**機制既有**，而 §4.6 新增之 abort **使 (F-a) 的可達集合擴張** —— 多出「投遞未於 8000ms 內完成 ⇒ 經 timer callback 要求取消後 reject」這個新觸發條件（§4.6 標軸段第 2 點已載）。🚫 **不得**述為「確定性觸發點」或精確門檻 —— 同 §4.6 標軸段第 1 點之三項殘留（② `CODEX-D-PLAN-R2-RR2` Required）。🚫 不得以「本 PR 不改變」涵蓋此擴張。<br>⚠ 本棒**不**為該擴張新增 durable disposition（`res.ok` 檢查或 log 皆逾越 §5.1 三 hunk 自我約束）⇒ **此為 owner-accepted tradeoff**，其治理承接即本 backlog 條目，🚫 不得讀為「無殘留」 |
| owner | **repo owner**（單一 owner；🚫 不得留「待指派」） |
| 觸發條件 | **三者先到即觸發**：(a) 任一次 critical 告警被回報「應到未到」（類別無關，(F-a)/(F-b)/(F-c) 皆會啟動）；(b) memory 待辦「金流完整 smoke（等 F-2 金流全寫完）」啟動時；**(c)** prod `DISCORD_AUDIT_WEBHOOK` 之 presence 被確認或被變更時 —— ① `GPT-D-ARCH-RR1` 判 `DISCORD_AUDIT_WEBHOOK_PROD_STATE = UNKNOWN` 且 owner 未取選項 A 之外部 receipt，該 UNKNOWN 在**投遞軸**上仍承重（§4.6 之 discharge 只涵蓋 wall-clock 軸），本欄即其承接 artifact。<br>⚠ **(c) 之既有間接證據＝`IAM_PLATFORM_ROADMAP.md:431`**（2026-05-05「`AUDIT_IP_SALT` + `DISCORD_AUDIT_WEBHOOK` 已設；critical 告警鏈路…通」）—— 🚫 **不得據以宣稱已 discharge**：該行位於 `## 13. 維護紀錄`（歷史 changelog）、**未指名環境**、距今三個月且無機械維持 ⇒ 依 RR1 同一 repo↔deployment 邊界邏輯，**兩個方向都不能當 receipt**。<br>⚠ **全部非機械觸發**（比照 §10.1.1／§5.4.2 之同型申報）—— 依定義該三類失敗本身皆不留訊號，repo 內無 lint／test／CI 能偵測 |
| 🚫 本棒立場 | **不補** —— `res.ok` 檢查或 log 皆為 `user-audit.ts` 第 4 組 hunk，逾越 §5.1 對該檔的三 hunk 自我約束（§4.2／§4.3／§4.6）⇒ 構成 scope creep |
| ⚠ 正交性 | 本項客體＝**告警投遞可觀測性**。🚫 不得與 §10.1.1（**recovery**）或 §10.1.3（**transition history / durable evidence**）互相代替 —— 三者為三個獨立客體（① `GPT-D-ARCH-R2-RR1` 第 4 點） |
| ⚠ 承接棒次注意 | 🚫 **不得**逕以 `console.warn` 收案 —— §12 自證之兩件事**須分開讀、🚫 不得併成一句**：(i) **平台限制**：`wrangler.toml:45-50` 自述 Pages Direct Upload 不支援 `[observability]`（Workers 才有）；(ii) **repo config 事實**：repo 全域無 logpush／`tail_consumers`／`analytics_engine` binding。⇒ 合起來才推出「`console.*` 只存在於 Real-time logs 或 `wrangler pages deployment tail`、須部署前先掛 tail、**事後無法回溯**」。⚠ (ii) 是**可改變的**：承接棒次若補上 binding，本護欄的第 (ii) 半即失效，但 (i) 仍在 —— 屆時須重新評估而非逕自援引本列。同檔 `:163-170` 的 `[audit-loss]` 是同作者已把一個 swallow 升級為帶 log 之 swallow 的 in-file 前例，可參照但**不足以**構成 durable provenance |

#### 10.1.3 `GOV-WEBHOOK-TRANSITION-EVIDENCE-001`（① `GPT-D-ARCH-R2-RR1` Required）

| 欄位 | 內容 |
|---|---|
| backlog ID | **`GOV-WEBHOOK-TRANSITION-EVIDENCE-001`** |
| owner | **repo owner**（單一 owner；🚫 不得留「待指派」） |
| 性質 | **pre-existing distributed-state transition-history evidence gap**。⚠ base `4a8933ba` 既有，本 PR 不改變 —— §4.5 之單 hunk 為落庫等價、未動 state-machine semantics |
| 目前缺口（**至少**兩項，🚫 不作 closure 宣稱） | (a) **`:256` 之 `processing → failed`**：其執行之充要前提即配對之 strict DLQ 寫入（`:243-254`）已拋錯 ⇒ 僅 row state、**無 DLQ、無配對之 transition-completion audit evidence**（⚠ ② `CODEX-D-PLAN-R4`：🚫 不得寫成無限定的「無 audit」—— `handleOrphan` 於 `[vendor].ts:224` 已先寫 `payment.webhook.orphan_intent`；該 audit 為 **best-effort 的「開始側」訊號**，不能證明 transition 完成、亦不能重建歷史。DLQ 才是 orphan 之**唯一 strict／required 憑證**）；(b) **`failed → processing` 之 CAS 覆寫 `processed_at`**（`:185-186`）⇒ 歷史時間點被抹除。<br>⇒ 兩者合起來使 §11.3.1 表後之 History A／History B 在 **`payment_webhook_events` row 上不可區分**（⚠ 客體限定見 §11.3.1 表後之**客體限定段**；🚫 不得讀為兩者之**全部** durable evidence 皆相同） |
| closure（**適用範圍**：`payment_webhook_events.apply_status` 狀態機，即 §11.3.1 census 之同一客體，🚫 **非** repo 內其他狀態機；**生效時態**：自本 backlog 建立起至結案；**例外集合**：∅；**closure 客體**：下列二者擇一窮盡） | (a) 該狀態機**每個實際發生之 transition** 皆有不可覆寫（append-only）之 durable evidence；**或** (b) owner 正式修改／豁免全域 §高風險領域加碼層 之 Distributed State bullet 5。🚫 不得以「已補 reaper」或「已補告警 log」代替 |
| 觸發條件 | **二者先到即觸發**：(a) 下一次修改 `payment_webhook_events.apply_status` **state machine** 之棒次動工前；(b) memory 待辦「金流完整 smoke（等 F-2 金流全寫完）」啟動時。<br>⚠ **非機械觸發** —— 缺口本身依定義不留訊號，repo 內無 lint／test／CI 能偵測 |
| 🚫 本棒立場 | **不實作** —— event sourcing／append-only transition log 皆屬 `[vendor].ts` 之 state-machine 變更，遠超 §4.5「本檔只允許一個 hunk」與 §5.1 allowlist |
| ⚠ 正交性（① 第 4 點） | 三個 backlog **互不代替**：§10.1.1 `GOV-WEBHOOK-STUCK-PROCESSING-REAPER-001` ＝ **recovery** · §10.1.2 `GOV-AUDIT-ALERT-DELIVERY-OBSERVABILITY-001` ＝ **alert delivery observability** · 本項 ＝ **transition history / durable evidence**。🚫 任一項 CLOSED 不得推論其餘兩項已處置 |

---

## 11. 高風險領域加碼判定

### 11.1 F-3 三軸（`closeout` §8.1 明載三者非 alias）

| 軸 | 值 |
|---|---|
| `F3_POSTURE` | `DORMANT_WAIT_ONLY` |
| `F3_FILE_EDIT_POLICY` | `CONDITIONAL_ACTIVE` |
| `F3_FILE_EDIT_TRIGGER` | **`NOT_TRIGGERED`** |

依據：§5.4 `D_EXCLUDES.F3_PROTECTED` 排除三個受保護檔。權威來源＝`docs/plans/stage7-pr2dw-closeout-audit-aggregate-archive-ctx.md` §8.1。本棒不改變 R2 lock rules、不新增 checkpoint、不啟用 retention。

### 11.2 L2 + 高風險 → **四件式**（非 L1 二件式）

| # | 加碼要求 | 交付位置 |
|---|---|---|
| 1 | state machine | §4.3 決策表（已標四項限定 + 補集 closure） |
| 2 | failure mode 列表 | §10 |
| 3 | idempotency 策略 | 本節 §11.3 |
| 4 | **retry + timeout 策略** | ⚠ **本項於 ① 後反轉**（`GPT-D-ARCH-RR1`／owner 2026-08-05 選項 B）。原述「本 PR 不新增、不修改任何外部呼叫」**已作廢**。<br>**timeout：已交付** —— §4.6 為 `user-audit.ts:246` 的 `notifyCritical` `fetch` 補 zero-env bounded timeout（`AUDIT_WEBHOOK_TIMEOUT_MS = 8000` ＋ `AbortController` ＋ `signal`），`TD-BATCHD-1` 隨之 **`CLOSED_PARTIAL`**（僅根因 (1)(3)；§10.1）。<br>**retry：明示不補** —— `notifyCritical` 為 fire-and-forget 告警；失敗類二分見 **§4.6 不變量 1**（**(F-a)** reject 進 `:160` 空 catch；**(F-b)** HTTP 非 2xx 不 reject、`res.ok` 從未被讀 ⇒ 零偵測），🚫 不得寫成「失敗一律由 catch 吞掉」。兩類皆不影響落庫（`user-audit.ts:9-10` 明載設計本意）⇒ 無 retry 不構成**落庫正確性**缺口；補 retry 須連同告警去重／風暴抑制一併設計，不在本棒。<br>**本 PR 唯一外部呼叫**即該 `fetch`。⚠ **本項之交代為限定式、非全稱**（適用範圍：timeout 與 retry 兩軸；例外集合：**告警投遞失敗之可觀測性**〔(F-b) 尤然〕**未交付**，**機制** base 既有（🚫 不得無限定寫「本 PR 不改變」—— (F-a) 之**可達集合因 §4.6 abort 擴張**，二分見 §10.1.2 性質欄；② `CODEX-D-PLAN-R2-RR4` Required）、追蹤見 §10.1.2；closure：除該例外項外，本項對 timeout／retry 兩軸已完整交代）。🚫 不得再讀為無限定之「完整交代」 |

### 11.3 各領域判定

> **本節之判定紀律**：全域 §高風險領域加碼層 之觸發條件為「**任一即觸發**」＝領域涉入即觸發。本節**不自訂更窄的觸發 predicate**（專案 `CLAUDE.md` §1：專案規則**只加嚴全域、不放寬**，🚫 plan 不得自我授權窄化）。凡領域涉入者一律判**觸發**並就地 discharge；判 `Not Applicable` 者須具名說明**該領域在本 PR 之 changed-files 中無任何涉入面**。
>
> ⚠ **emitted-runtime diff ＝ ∅** 之分析（純型別標註與 `import type` 於 emit 後全數抹除）**僅作為 discharge 的內容**（用以說明觸發後的實質風險為零），**🚫 不作為「是否觸發」的判準** —— 兩者不可混用。該 ∅ 之機械驗證見 §8.5 追加項。
>
> **全域清單 7 類之逐類對照（closure：7/7 具名，無留白）**：Queue/Message · WebSocket/SSE · Streaming · Payment/退款/Webhook · Transaction 跨資源 · Distributed State · 跨系統 JSON Contract。

**1. Queue / Message：觸發。** `functions/api/admin/event-dlq/[id]/replay.ts` 是 **outbox DLQ replay handler**，在 §5.1 production allowlist 內且有 hunk ⇒ 領域涉入。
**discharge**：§4.4 的兩行分別為 `import type` 與 `auditReplay` 參數 `string → AuditSeverity`（純型別標註）⇒ **emitted-runtime diff ≡ ∅**（機械驗證見 §8.5）；5 個 caller（`:32` `:41` `:52` `:76` `:79`）全傳字面量（`'warn'`×4／`'info'`×1）；`:59-70` 的 CAS batch 與 `:62` 的 `lease_until`／`locked_by` 租約欄位**零觸碰**。DLQ · visibility timeout · max-retry · poison message 語義全未改。

**2. WebSocket / SSE：Not Applicable。** 本 PR 之 4 個 production 檔皆無 WebSocket upgrade、無 SSE stream ⇒ 該領域面與 changed-files **零交集**。

**3. Streaming：Not Applicable。** 同上 —— changed-files 內無 stream／chunk／`ReadableStream`／NDJSON 產出面。

**4. Payment／退款／Webhook：觸發。** `functions/api/webhooks/payments/[vendor].ts` 在 changed-files 內 ⇒ 領域涉入。
**discharge**：唯一 hunk 位於 `handleOrphan` 的 `payment.webhook.orphan_intent`（`severity:'critical'`）audit 引數，其 diff 為**落庫等價**（§4.5 四例逐例證明）。位置脈絡：該 audit 排在 **orphan 憑證之 strict DLQ 寫入（`:243-254`，`{ strict: true }` 於 `:254`）之前**（🚫 `:263` 的 `dlqInsert` 不帶 strict、語義為 `mark_applied_orphan`，不得混稱）；此順序**為既有行為、本 PR 不改變**。⚠ `notifyCritical` 的同步 fetch **已由 §4.6 補上 bounded timeout**（8000ms），故「無界阻塞」不再成立；該外呼由**無界**改為**8000ms 後請求取消**（精確語義與殘留風險見 §4.6 標軸段）即本 PR 對本領域之實質改善（終端狀態見 §10）。另註：`notifyCritical`（`:244`）讀的是**未過濾**的 `entry.user_id`，在現行三個 call site（皆 D1 INTEGER row 或 null）下不可達差異，不構成行為差。不改驗簽 · dedupe · DLQ · 狀態機 · idempotency。

**5. Transaction 跨資源：觸發。** 全域該類定義之**逐字原文見本節尾註之三組括號限定 code block**（🚫 本處不重複抄寫，避免兩份副本漂移）；其承重部分為「**多個持久化資源 + 外部**」。⚠ 初稿寫「橫跨 `payment_intents` → `audit_log` → `payment_webhook_events` → DLQ **四個持久化寫入面**」，**兩處皆誤**：(i) `payment_intents` 在 `handleOrphan` 路徑上是**讀取／CAS 落空**而非寫入（三個入口 `:283`／`:286`／`:384` 傳入的皆為已讀好的 intent；`payments.ts` 之 `no_row` 三來源 `:217`／`:228`／`:268` 無一寫入）；(ii) 三張表同屬**一個** D1 binding，依定義**不構成**「多個持久化資源」。
**真正令本類成立者**：`handleOrphan` 在同一 request 內對 **D1**（`audit_log` → `payment_webhook_dlq` → `payment_webhook_events`，三張表、非原子）與**外部 Discord webhook**（`user-audit.ts:246` 之 `fetch`，經 `:160` 由 `safeUserAudit` 同步 `await`）**兩個資源**產生寫入／外呼 ⇒ 符合「多個持久化資源 + 外部」⇒ 領域涉入。
⚠ 🚫 **不得**以「`DISCORD_AUDIT_WEBHOOK` 今日未設值故為 latent」作為 discharge 依據 —— ① `GPT-D-ARCH-RR1` 判定該推導跨越 repo↔deployment 信任邊界、不成立（`DISCORD_AUDIT_WEBHOOK_PROD_STATE = UNKNOWN`）。**真正的 discharge 是 §4.6 的 bounded timeout**：無論該 webhook 是否 live，該外呼皆會在 **8000ms 後被請求取消**、其 `await` 隨之結束，不再是無界佔用 Worker wall-clock 的路徑。<br>⚠ **本 discharge 之強度限定**（② `CODEX-D-PLAN-R2-RR2` Required）：🚫 **不得**述為「外呼皆有 8000ms 上限」—— 該取消不保證精確 wall-clock 上限，亦未驗證平台是否真正取消 in-flight 請求（三項殘留見 §4.6 標軸段之唯一定義處）。本 discharge 承載的是「**移除無界等待**」，**非**「取得數學上界」。
**discharge**：本 PR 對該路徑僅 §4.5 一個落庫等價 hunk，**不改變任何寫入順序、原子性假設或補償動作**。其既有非原子性與由此產生的終端狀態，已於 §10 之「`payment_webhook_events` 永久卡 `'processing'`」列完整記載為 failure mode（§11.2 item 2 之交付）。🚫 本棒不補 outbox／reaper。

**6. Distributed State：觸發。** ⚠ 初稿誤判 N/A，理由用的是「那幾行沒被碰」的 **hunk 層 predicate** —— 正是本節紀律所禁；且「其餘 3 個 production 檔不涉多寫者」對 `[vendor].ts` **為假**。實際涉入面有二：(a) `replay.ts:59-70` 的 `event_outbox` 租約（`lease_until`／`locked_by`）＋ `changes() = 1` CAS batch；(b) `[vendor].ts:146-219` 的 `payment_webhook_events` 三態 claim 即**跨 isolate 多寫者序列化**，程式碼自述「撞到別人正 `'processing'` 不能跟著雙跑」（`:148`）、「**另一個 instance 正在跑同 event_id**」（`:208`）。
**discharge**（對照全域該領域之**五**個 bullet，逐項；⚠ 初稿寫「四項要求」且把自家 discharge 語句混充成全域要求，致 bullet 4／5 完全未覆蓋 —— 現更正）：

| # | 全域 bullet | 本棒對照 |
|---|---|---|
| 1 | 單寫者 → 強一致序列化原語，critical state 落持久層非 memory | `payment_webhook_events.apply_status` 三態 claim 即序列化原語，狀態存於 **D1**（非 memory）；`event_outbox` 租約同理 |
| 2 | 多寫者 → transactional outbox ＋ 冪等 consumer；**衝突解析顯式** | **outbox 側**：`event_outbox`／`event_dlq` 即既有 transactional outbox，consumer 冪等由 `changes() = 1` CAS 保證（`replay.ts:59-70`）。**webhook 側**：衝突解析顯式為 `INSERT OR IGNORE` ＋ `changes()` ＋ `failed → processing` 條件 CAS（`:185-186`），**非** last-write-wins |
| 3 | 禁 memory-only critical state | 同 #1，無 memory-only 狀態 |
| 4 | cache vs source of truth 偏離容忍度顯式（TTL + 失效策略） | **Not Applicable** —— 本領域涉入面（`apply_status`／`event_outbox` 租約）**無 cache 層**，SoT 即 D1 本身；本 PR 亦未引入任何 cache |
| 5 | **所有 state transition 必可從 audit log / event log 重建** | **`PARTIALLY SATISFIED` / `PRE-EXISTING DEVIATION`**（① `GPT-D-ARCH-R2-RR1` 裁決）—— 逐 transition census 見 §11.3.1（12 列）。<br>**能證明的**：`payment_webhook_events` row 為 **current-state SoT／durable state ledger**，可完整證明**目前狀態**。<br>**不能證明的**：**歷史 transition sequence**。🚫 該 row **不得**等價替代 append-only transition／event history —— 這不是「event log」一詞的語義偏好問題，而是**該 row 上的資訊不可逆遺失**：兩條不同 transition history 可映射到**同一終態 row 狀態**（反證**及其客體限定**見 §11.3.1 表後 —— ⚠ 該限定為承重，🚫 不得引用成「同一終態可觀測證據」之無限定式）。<br>⚠ **R2 初稿曾誤判為 `✅ 滿足`**，其倚賴之前提（row state 計入 event log）已被 ① 否決。<br>⚠ **base `4a8933ba` 既有缺口，本 PR 不改變**（§4.5 單 hunk 未動 state-machine semantics）；🚫 本棒**不**實作 event sourcing／reaper。追蹤見 **§10.1.3 `GOV-WEBHOOK-TRANSITION-EVIDENCE-001`** |

⇒ 五項中 **#1/#2/#3 滿足、#4 Not Applicable、#5 `PARTIALLY SATISFIED` / `PRE-EXISTING DEVIATION`**（① `GPT-D-ARCH-R2-RR1`）。⚠ 本領域整體判定隨之為 **Triggered / bullet 1–4 discharged、bullet 5 partial**，🚫 不得再宣稱本領域已全數 discharge。

#### 11.3.1 `payment_webhook_events` transition／evidence 表（`GPT-D-ARCH-RR3` Required）

適用範圍：`[vendor].ts` 之 `apply_status` 狀態機；生效時態：base `4a8933ba`；例外集合：∅。

⚠ **closure 之客體須明示**：下表宣稱窮盡的是**該狀態機之 transition 與非-transition 終局（outcome）**，**不是**通往各終局之**機制（mechanism）**。理由：終局集合有限且可由 `apply_status` 值域（`processing`／`applied`／`failed`）＋「無 transition」封閉；機制集合則受未來新增 adapter／新增呼叫點影響、無法窮盡。故凡新機制導向已列終局者，本表視為**已涵蓋**；凡導向新終局者，本表**失效須重建**。
⚠ 本表之 closure 姿態**刻意嚴於 §10**：§10 之「永久卡 `'processing'`」列明示**不作 closure 宣稱**（其枚舉客體是 entry path＝機制），兩者不衝突 —— §10 枚舉機制故不封閉，本表枚舉終局故封閉。🚫 不得互相援引為對方的 closure 依據。

| Transition／事件 | D1 結果 | durable audit／event evidence | recovery |
|---|---|---|---|
| `absent → processing` | 成功（`:171` `changes===1`） | row 本身（`apply_status` ＋ `processed_at`）⚠ 無獨立 audit event | 續行 |
| `absent → processing` | INSERT 拋錯 | **`payment_webhook_dlq`**：`error_stage:'dedupe_claim'`（`:194`）＋ `throw` → 500 | PSP retry（row 未建立、可重新 claim） |
| `absent → processing` | CAS lose（已存在 processing／applied） | **`audit_log`**：`payment.webhook.in_flight_conflict`（`:209`）；applied 則 `:178` 短路 | PSP retry |
| `failed → processing` | CAS 成功（`:182-189`） | row 本身 ⚠ 無獨立 audit event；⚠ **`processed_at` 被覆寫** ⇒ 多次循環之**順序**不可由 row 單獨重建（⚠ failed 循環次數不可由 DLQ 記錄數忠實重建；見表後三條反證） | 續行 |
| `failed → processing` | CAS lose | 同上 in-flight audit（`:209`） | PSP retry |
| `processing → applied` | 成功 | row applied | — |
| `processing → applied` | UPDATE 拋錯 | → `markWebhookEventFailed` ＋ **DLQ**。⚠ 實有**三條**路徑（適用範圍：本表；例外集合：∅；closure：三者窮盡 —— 全檔 `markWebhookEventApplied` 呼叫點實測恰 `:260`／`:332`／`:466`）：`:260`→`:262`→`:263`（`error_stage:'mark_applied_orphan'`，`:269`）· `:332`→`:335`→`:336`（`'mark_applied_psp_direct'`，`:342`）· `:466`→`:468`→`:469`（`'mark_applied'`，`:475`） | DLQ replay |
| `processing → failed` | 成功（呼叫點 `:262`／`:335`／`:416`／`:468`，**四個**） | row failed ＋ **配對 DLQ 記錄**：`:262`（DLQ 已先落於 `:243-254`）· `:335`→`:336` · `:416`→`:417` · `:468`→`:469` | `:185-186` CAS 可重新 claim |
| `processing → failed` | 成功（呼叫點 **`:256`**，**單獨列出**） | ⚠ **僅 row failed —— 無 DLQ、無配對之 transition-completion audit evidence**。`:256` 執行之充要前提即其配對之 strict DLQ 寫入（`:243-254`，`{strict:true}`）**已拋錯**；`:257` 立即 `throw`，其後**無** `dlqInsert`。逃逸去向依 `handleOrphan` 呼叫點而分：`:283`／`:286` **不在任何 try 內**（該檔 try 起點實測 `:89 :158 :242 :259 :331 :351 :353 :465 :495 :544`）⇒ 逃出 handler，僅 `functions/api/_middleware.ts:167` 攔下 → `:177-197` 結構化 log ＋ `:200-210` 5xx 告警（**觀測面、非持久層，非 D1**）；`:384` 則被 `:351-414` 攔下 → `:417` **非 strict** `dlqInsert`（⚠ 相關性失效：本列前提就是 DLQ 表寫入已失敗，該 best-effort 寫入同樣可能靜默回 `false`〔`:566`〕） | `:185-186` CAS 可重新 claim |
| `processing → failed` | **UPDATE 失敗**（`:499` catch 吞） | ⚠ **該 transition 未發生**（row 仍 `processing`）。failure action 之 DLQ 記錄**依呼叫點而分**：`:262`／`:335`／`:416`／`:468` **有**（`:262` 之 DLQ 先落於 `:243-254`，其餘三者 markFailed 吞錯後**續行**至 `dlqInsert`）；**`:256` 無**（理由同上列） | ⚠ **無** —— row 停 `processing`、不在 `:181-186` 可 claim 集合 |
| **`markWebhookEventFailed` 靜默 no-op**（`:494` `if (!env?.chiyigo_db \|\| !eventId) return`） | 無 UPDATE 送出 | ⚠ transition 未發生；DLQ 之有無同上列（依呼叫點而分） | ⚠ **無** —— 同上列。⚠ **今日可達集合 ＝ ∅**：依 §10 對 `:486` 之同一 guard 所作舉證（`!env?.chiyigo_db` 與「row 已為 `'processing'`」互斥；`!eventId` 需要「回 ok 但 `event_id` falsy」之 adapter，現有 `ecpay`／`mock` 二者皆不可能）。列出係**前瞻護欄**，🚫 不得據以宣稱今日存在 |
| **Worker termination** | **無 transition 完成**；可能殘留 `processing` | ⚠ 若死於**任何持久寫入之前** ⇒ **零 durable evidence** | ⚠ **無 reaper**（`cron/cleanup.ts:71-76` 為刻意排除） |

**⇒ bullet 5 ＝ `PARTIALLY SATISFIED` / `PRE-EXISTING DEVIATION`**（① `GPT-D-ARCH-R2-RR1` 裁決；🚫 **不得**再寫成「所有實際 transition 皆可重建」）。

⚠ **上表（12 列 census）本身之價值不變**：它逐格記載每個 transition 之 D1 結果、durable evidence 與 recovery，仍是本領域之交付物。**被否決的是由它推出的那個全稱結論**；⚠ 此外**第 4 列括號內原有之緩解句亦不成立**（見下段三條反證），該括號句已依 ① `GPT-D-ARCH-R4-RR1` **就地更正為否定式**、**該列其餘欄位未動**；三條反證即其依據，須併讀。🚫 不得寫「只是…」之排他式。

**否決之依據 —— 反例（建材全部取自上表自身）**：

| 前提（上表已載） | 出處 |
|---|---|
| `failed → processing` 之 CAS **覆寫 `processed_at`** | 上表第 4 列 |
| `:256` 之 `processing → failed` **成功**但**僅 row state、無 DLQ、無配對之 transition-completion audit evidence**（措辭依據見 §10.1.3 缺口 (a)） | 上表第 9 列 |

```text
History A：absent → processing → applied
History B：absent → processing → failed（:256，無 DLQ／無配對之 transition-completion audit evidence）
                              → processing（覆寫 processed_at）
                              → applied
```

兩者之終態 **`payment_webhook_events` row** 皆為 `apply_status='applied'` ＋ `processed_at=<latest>` ⇒ **該 row 本身不可區分**。

⚠ **客體限定段（誠實記載本檔之推理缺漏；🚫 不得回寫成無限定的「durable observable 不可區分」）**：上句若擴及**全部** durable evidence 則**不成立** —— `handleOrphan` 的 `payment.webhook.orphan_intent` audit 其 emit 點為 `[vendor].ts:224`（座標同 §8.5），**早於** `:243-254` strict DLQ 與 `:256`，而 `audit_log` 無 dedupe key（§11.3 之「`safeUserAudit` write path 的絕對冪等姿態」項）⇒ History B 之兩次 `handleOrphan` 會落 **2 筆**、History A 至多 1 筆（⚠ **前提＝retry 仍走 orphan 路徑**，即 §10「PSP retry → audit 重放放大」列所述之「同一邏輯 event 重跑 `handleOrphan`」；該前提不成立時，區分訊號改由 **orphan audit 或 orphan DLQ 之有無**承擔，本段結論不變）。**但 bullet 5 之 `PARTIALLY SATISFIED` 不因此鬆動**，理由改由下列三點承載：**(i) 不忠實** —— 該 audit 記的是「`handleOrphan` **已開始**」，**非**「`processing → failed` **已完成**」；Worker 若死於該 audit 落庫後、`:256` 之前（上表第 12 列）**亦落一筆 orphan audit row，與已完成該 transition 者無異**，故「orphan audit 筆數 → transition 次數」之映射同樣不忠實；**(ii) 非 transition 記錄** —— 該憑證是 orphan 路徑的副作用：`:256` 之 `processing → failed` **無配對之 DLQ 與 transition-completion audit evidence**（上表第 9 列），與其餘四個呼叫點**有**配對 DLQ 記錄（上表第 8 列）恰成對比 ⇒ append-only evidence **未覆蓋全部 transition**；且 orphan audit 只覆蓋 orphan 路徑、不構成全域重建手段；**(iii) 時序仍遺失** —— `processed_at` 遭覆寫（上表第 4 列），row 自身之時序不可重建（§10.1.3 缺口 (b)）。🚫 **本段不改動 ① 之裁定本身**；若「不可區分」之措辭源自 ① 原文，處置見 §14.3 之主動申報。

⚠ **上表第 4 列括號內原有之緩解句「**次數**可由 DLQ 記錄數重建」不成立**（⚠ ① 之「保留／不要改 12 列 census」指示已由 `GPT-D-ARCH-R4-RR1` **極窄地 supersede** —— **僅**解凍該一個已證偽之 parenthetical；🚫 **12 列集合、列數、transition、D1 結果、durable-evidence 主欄與 recovery 主欄一律不得藉機改動**。該括號句已就地改為否定式，本段三條反證即其依據）。**三條獨立反證，皆取自上表與 base 原始碼**：

| # | 反證 | 依據 |
|---|---|---|
| (a) | **`:256` 路徑不留 DLQ** ⇒ 該次 `processing → failed` 完全不進計數 ⇒ **低估** | 上表第 9 列（round 15 拆出） |
| (b) | **單一循環可寫 2 筆 DLQ** ⇒ **高估**：orphan 路徑 `:243-254`（`error_stage:'orphan_intent_not_found'`／`'orphan_intent_deleted'`）成功後才進 `:259 try`，其 catch 於 `:262` markFailed **＋** `:263` 再寫 `'mark_applied_orphan'`；psp_direct 路徑同構（`:320-329` `'psp_direct_disabled'` ＋ `:336` `'mark_applied_psp_direct'`） | `[vendor].ts@4a8933ba` |
| (c) | **有 DLQ 但 transition 未發生** ⇒ **偽計數**：markFailed 之 UPDATE 被 `:499` catch 吞掉時 DLQ 仍已寫入，而該筆 DLQ 之 `error_stage` 與「markFailed 成功」情形**完全相同、無欄位可區分** | 上表第 10 列 |

⇒ 「DLQ 記錄數 → `failed` 循環次數」之映射**既非單射（2:1）亦非忠實（有 DLQ、無 transition）** ⇒ **以 DLQ 記錄數作為計數器不可重建次數**。⚠ **客體限定為該計數器**（🚫 不得寫成「無任何 durable 訊號可據以校正」—— (b) 之兩筆 DLQ `error_stage` 相異〔`orphan_intent_*` vs `mark_applied_orphan`〕、(a) 另有 orphan audit 筆數，二者皆為 durable 面；其為何仍不足以重建 transition，見上方**客體限定段**之 (i)(ii)）。
⚠ 此結論**反向強化** bullet 5 之 `PARTIALLY SATISFIED` 裁定：連「次數」這個最弱的重建目標都不成立。
⚠ **本檔之推理缺漏（誠實記載）**：該緩解句預設所有 `processing → failed` 皆留 DLQ，而上表第 9 列已證其不然。**兩條相斥前提同表並存卻未推翻結論**，是本檔的推理缺漏，非 ① 引入的新事實。

⇒ **架構裁定**：`payment_webhook_events` 為 **current-state SoT／durable state ledger**，可證明**目前狀態**；🚫 在現行 schema 與更新語義下，**不得**等價替代 **append-only transition／event history**。此為**該 row 上的資訊不可逆遺失**（客體限定見上方**客體限定段**），非名詞語義偏好。
**三項殘留**（⚠ 分類已依 ① `GPT-D-ARCH-R2-RR1` 更新：**第三項現為 bullet 5 partial 之直接構成要件**，🚫 不再是「取決於前提、交 ①」的待決項）：

| 殘留 | 分類 | 性質 |
|---|---|---|
| `processing → failed` UPDATE 失敗後 row 停 `processing`、無 reaper | **recovery gap** | transition 未發生 ⇒ 無「未記錄的 transition」；缺的是恢復路徑。已完整記載於 §10 之「永久卡 `'processing'`」列 |
| Worker 死於任何持久寫入前 ⇒ 零 evidence | **failure-observability gap** | 無 transition 發生 ⇒ 非 bullet 5 客體；缺的是失敗可觀測性 |
| `:256` 路徑之 `processing → failed` 僅 row state，無 DLQ、**無配對之 transition-completion audit evidence** ⇒ **orphan 之 strict 憑證未落**（措辭依據見 §10.1.3 缺口 (a)） | **transition-evidence gap ＝ bullet 5 `PARTIALLY SATISFIED` 之直接構成要件** | ⚠ transition **確實發生**，故與上兩項性質不同（上兩項為「transition 未發生」）。<br>🚫 **本列不帶任何條件分支** —— 先前寫「在『row state 計入 event log』之前提下 bullet 5 仍滿足；不接受該前提則此列即缺口」，該前提已由 ① `GPT-D-ARCH-R2-RR1` **否決**（理由：History A／B 映射到同一 `payment_webhook_events` row 狀態 ＝ 該 row 上的資訊不可逆遺失，非名詞選擇問題；⚠ 該理由之客體限定與 `audit_log` 側之更正見 §11.3.1 表後之**客體限定段**）。本列即 bullet 5 partial 的成因之一，**非待決項**。追蹤見 §10.1.3。<br>⚠ 另有獨立於 bullet 5 的實害：`:243-254` 之 strict DLQ 是 **orphan 事件的唯一 strict／required 憑證**（該檔 `:240-241` 自述「DLQ 是 orphan 唯一憑證 → strict 寫入」；⚠ **strict／required 之限定為本檔加註**〔② `CODEX-D-PLAN-R4`〕—— `:224` 之 `payment.webhook.orphan_intent` 為 best-effort 之**開始側 orphan-semantic evidence**，🚫 不得因 source comment 之措辭而讀成「orphan 語義的唯一證據」），寫失敗即該 strict 憑證永久遺失，而 row 只記 `apply_status='failed'`、不記 orphan 語義。base 既有，本 PR 不改變 |

⚠ **上表三項殘留皆** **base 既有、本 PR 不改變**（本 PR 對 `[vendor].ts` 僅 §4.5 一個落庫等價 hunk）。**本 PR 對上述機制零觸碰**：`replay.ts` 兩行皆純型別、`[vendor].ts` 僅 §4.5 一個落庫等價 hunk，claim／租約／CAS 語義全未改。🚫 本棒不補 reaper／不改狀態機（屬狀態機變更，遠超 §5.1 之單 hunk 限制）。

**7. 跨系統 JSON Contract：觸發。** ⚠ 初稿判 N/A，理由是「本 PR **不改**任何跨服務／跨 repo／Queue payload／外部 API 之 JSON schema」—— 那是**改變式 predicate**，與 #6 被判定違紀的錯誤形態相同（本節紀律要求 N/A 須說明「**無任何涉入面**」，而非「沒有改到」）。實際涉入面在 changed-files 內確實存在，共三處：
(a) **外部 API JSON ingest**：`[vendor].ts` 之 `adapter.parseWebhook`（該檔 `:8` 自述「驗章 + normalized payload」）；`payment-vendors/mock.ts:38` `JSON.parse(rawBody)`、`:41` 欄位契約檢查。
(b) **外部 API JSON egress**：`user-audit.ts:246` 對 Discord 送 `JSON.stringify({ content })` —— 即 #5 據以成立之「外部資源」同一呼叫。
(c) **Queue payload**：`replay.ts` 操作之 `event_outbox`／`event_dlq` 承載 `data_json`（該檔 `:6` 註解）。
⚠ 全域括號限定之 carve-out 為「一般單 repo frontend↔backend 不算」，**蓋不住** PSP ingest 與 Discord egress。
**discharge**：本 PR **不改變任何 payload 形狀或版本語義** —— `AuditSeverity` 為單 repo 內部型別，值域（三字面值）與 D1 `CHECK` 皆不變（§4.1(a)）；(a)(c) 兩處本 PR 之 hunk 皆為純型別（emit 抹除，見 §8.5）；(b) 之 payload 由 `notifyCritical` 內部組成、本 PR 僅改其 gate 述詞（§4.3 不變量 3）不改內容。enum 值域不變 ⇒ 不構成全域所指之 breaking change。

> **以上 7 類即全域清單之全部**（適用範圍：`~/.claude/CLAUDE.md` §高風險領域加碼層 之「觸發條件（任一即觸發）」列舉；生效時態：本檔送 ① 之時點；例外集合：∅；closure：該列舉之**標題**逐字為 `Queue / Message` · `WebSocket / SSE` · `Streaming` · `Payment / 退款 / Webhook` · `Transaction 跨資源` · `Distributed State` · `跨系統 JSON Contract`，恰 7 項）。⚠ **標題逐字，但括號限定另見全域原文** —— 其中三項自帶承重限定，🚫 引用時不得截斷（三組原文如下）：

```text
Transaction 跨資源（多個持久化資源 + 外部，如 D1 / R2 / KV `[platform: Cloudflare]`）
Distributed State（多寫者 / 跨 isolate / 跨 region）
跨系統 JSON Contract（跨服務 / 跨 repo / Queue payload / 外部 API；一般單 repo frontend↔backend 不算）
```
⚠ round 13 初稿在**本句**（即宣告不得截斷之處）自己截掉了第一組的 `` `[platform: Cloudflare]` ``；現以全域原文逐字取代，🚫 後續引用一律連平台標記一併帶上。本節第 5／6／7 項之判定即依此三組括號，非依標題。⚠ 該清單為 **user-owned 全域基線**，若日後增列，本節須同步補 discharge。
>
> 下列兩項為本檔**額外**自加之審查面（**非**全域清單成員），列出以免被誤讀為 7 類之一。

- **稽核保存期（額外）**：**觸發**。`classifyForCold` 對相同輸入 deterministic ⇒ archive worker 重跑 idempotent；§4.3 不變量 2 保證 row/class parity。
- **`safeUserAudit` write path 的絕對冪等姿態（額外，非僅 delta）**：`audit_log`（`migrations/0017_audit_log.sql:27-37`）只有 `id INTEGER PRIMARY KEY AUTOINCREMENT`，**無 UNIQUE、無 idempotency/event key 欄** ⇒ **該寫入路徑**語意為純 append、**at-least-once**（⚠ 客體限定為 `safeUserAudit` 之寫入路徑，🚫 不得推論該表不可變 —— 更新／刪除路徑見 §12 (b)）。同一邏輯 PSP event 在 retry 下可落 N 筆（`[vendor].ts:181-190` 的 `apply_status='failed'` 可被 CAS 重新 claim ⇒ `handleOrphan` 整段重跑）。下游去重須讀 `event_data.event_id`（`[vendor].ts` 已帶）。**本 PR 不改變此性質**；列此為絕對姿態而非留白。

---

## 12. Rollback

**分離 code 與 data；data 再分兩軸**，不得混談（② `CODEX-D-PLAN-R3` Info）：

**(a) code rollback** — 單 PR、無 migration、無 schema 變更。revert 該 squash commit 即完全復原 code。

**(b) 資料層** — **本 PR 之 `safeUserAudit` 寫入路徑只做 INSERT**；**revert 不回溯既有 row**（forward-only）。<br>⚠ 🚫 **不得述為「`audit_log` 為 append-only」**（② `CODEX-D-PLAN-R3` Required）：該表**無 DB 層不可變保證** —— `migrations/0017_audit_log.sql` 檔頭自述「應用層 INSERT，**不做 trigger 阻擋 UPDATE/DELETE**」，且 repo 內**確有 live 的更新與刪除路徑**：`functions/api/admin/cron/audit-archive.ts:806` 之 `UPDATE audit_log`（回填 `archived_at`）· `functions/api/admin/audit/[id].ts:66` 之 `DELETE FROM audit_log`。**適用範圍**：本項只涵蓋**本 PR 之寫入路徑**；既有之更新／刪除生命週期不在本 PR 客體內、亦不因 revert 而改變。<br>⚠ **full revert 之殘留（顯式）**：revert 會連同 §4.6 一併移除 ⇒ `notifyCritical` **回到無界外呼**、`TD-BATCHD-1` 之根因 (1)(3) 重新開啟、其 `CLOSED_PARTIAL` 失效。🚫 不得寫成「revert 無殘留」。

⚠ 原「值域不變 ⇒ 無資料層殘留」是**非充分推理**：本 PR 改的是「同一輸入 → 落庫值」的**映射**，與值域正交。具體殘留機制：present-but-invalid + `SECURITY_SIGNAL` 之 row 的 `severity` 由 `'info'` 變 `'critical'`、`cold_class` 由 `'security_warn'` 變 `'security_critical'`；revert 後 `rowMatchesColdClass`（`audit-archive.ts:715-716`）拿**已落庫 severity** 重推，`('critical','security_critical')` 仍自洽 ⇒ `audit.archive.cold_class_drift` **不會告警**，殘留是靜默的。

**殘留量收斂為 ∅ 的顯式論證**（**客體＝§4.3 invalid-fallback 之 audit mapping residue**，即上段所述 `severity`／`cold_class` 映射變更所產生之 `audit_log` row；🚫 **不涵蓋** §4.6 wall-clock 軸之 durable effects（**(甲)** `payment_webhook_dlq` row 之**新增** ＋ **(乙)** 既有 `payment_webhook_events` row 之**狀態轉移**）—— 該軸見本節 **(c)**〔② `CODEX-D-PLAN-R2-RR3` Required〕；適用範圍：本 PR 合入時 `functions/` 的 call site；生效時態：即刻；**例外集合：∅**；closure：下列兩項掃描窮盡）：

> ⚠ 本 4-tuple 的「例外集合：∅」與第 2 點內的「未列入下表者恰 2 個」**是不同層級的記帳，🚫 不得互相代入**：後者是**掃描母體**的分派（`utils/user-audit.ts:160` 與 `api/admin/audit.ts:143` 未列入逐處分類表），而該兩處**根本不是 `entry.severity` 賦值點** ⇒ 它們落在本論證的**主題之外**，不是「本論證的例外」。故本 4-tuple 的例外集合確為 ∅。

1. **typed surface 界限** —— §6 `ADDED = 0` 為真實 semantic diagnostics。post-PR `severity?: AuditSeverity`，且 `functions/` 下 `.js` caller 實測為 **0 檔**、289 個 `safeUserAudit` call site 全在 `.ts` ⇒ 任何傳 widened `string` 或非法字面量者必觸發 assignability error 使 `ADDED > 0`（§4.4 收窄 `replay.ts:22` 正是此機制觸發的證據）。
2. **`ADDED=0` 封不住的洞** —— `strict:false`（`strictNullChecks` off）下 `severity: null` 可過型檢卻落入 present-but-invalid 分支；**且任何 `any` 來源亦不觸發 assignability error**（本檔 §4.2 OD-D3 即記載 `hashIdentifierForAudit` 的 20 個 caller 中有 6 個傳 `any`，可見 `any` 在本 codebase 是活的來源型別）。⚠ 故 **本節之 ∅ 不靠型別、靠下方 17 列窮盡枚舉**；🚫 後續棒次不得由第 1 點推論「型別已自動守住 severity 入口」。獨立掃描 `functions/` 全部 severity 賦值，非三字面量者恰 **19 處**（＝道 1 的 14 ＋ 道 2 的 5）。三個計數的定義**互不相同，不得混用**：

| 集合 | 數 | 定義 |
|---|---|---|
| 掃描母體 | **19** | 兩道掃描的聯集 |
| **列入下表逐處分類者** | **17** | 19 − 2（見下 ⚠） |
| 其中**回流 `safeUserAudit`** 者 | **12** | 下表第 4 欄標「是」者＝rows 1–9 ＋ 15–17 |
| 其中 **read-path 出庫**（`r.severity` → JSONL／aggregate，不回流） | **5** | 下表 rows 10–14，第 4 欄標「否」 |

⚠ **未列入下表者恰 2 個**（適用範圍：本節掃描母體；生效時態：base `4a8933ba`；例外集合：∅；closure：下列兩者窮盡）：`utils/user-audit.ts:160`（模組內部對 `notifyCritical` 的呼叫，`severity` 為剛算出的 `AuditSeverity`）與 `api/admin/audit.ts:143`（寫進 audit `data.filters`，非 `entry.severity`）—— 兩者皆非 `entry.severity` 賦值點，故不納入逐處分類。

⚠ **引用本節數字時必須指名是哪一個集合**（19／17／12／5），🚫 不得只寫「17 處」或只寫「回流者」—— 述詞與計數不對應曾導致自審 finding。

**量測法（兩道，缺一不可）**：

1. **顯式 `severity:`** —— `grep -rn "severity:" functions/ --include=*.ts` 扣除三字面量後得 18 行，再扣除 4 行**非賦值**者（`audit-policy.ts:408` 與 `replay.ts:22` 為函式參數宣告、`audit-aggregate.ts:174` 與 `audit-archive.ts:411` 為註解）⇒ **14 處**。
2. **ES6 property shorthand `{ …, severity, … }`** —— ⚠ 第 1 道**對 shorthand 結構性失明**，必須另掃 `grep -rnE "severity\s*[,}]" functions/ --include=*.ts | grep -v "severity:"`，**raw 命中 24 行**（實測，base `4a8933ba`）。
   **24 行逐行歸類（適用範圍：`functions/**/*.ts`；生效時態：base `4a8933ba`；例外集合：∅；closure：24 行全數具名，無未分類者）** —— 附全表而非只給規則，是因為規則敘述無法涵蓋跨行情形（見下方 ⚠）：

   | 歸類 | 數 | 座標（`functions/` 起） |
   |---|---|---|
   | (a) SQL 字串內的欄位列 | 9 | `api/admin/audit.ts:121` · `api/admin/cron/audit-aggregate-debug.ts:118` · `api/admin/cron/audit-aggregate.ts:145` · `api/admin/cron/audit-aggregate.ts:204` · `api/admin/cron/audit-archive.ts:506` · `api/admin/cron/audit-archive.ts:921` · `utils/user-audit.ts:88` · `:125` · `:142` |
   | (b) `.bind()` 位置引數 | 3 | `api/admin/cron/audit-aggregate.ts:206`（同行）· `utils/user-audit.ts:93` · `:130`（**跨行**，`.bind(` 在 `:91`／`:128`） |
   | (c) JSDoc／註解 | 5 | `utils/audit-aggregate-debug.ts:261` · `:265` · `utils/audit-aggregate.ts:5` · `:165` · `:172` |
   | (d) template literal 內插 | 1 | `utils/audit-aggregate.ts:184` |
   | (e) 以常數持有的欄位列字串 | 1 | `api/admin/cron/audit-aggregate-archive-telemetry.ts:33`（`SELECT_COLUMNS`，形態不含 `SELECT`／`INSERT` 關鍵字故 (a) 抓不到） |
   | **KEEP ＝ object-literal shorthand** | **5** | 見下表 |

   ⚠ **(b) 不可只看 grep 輸出行**：`user-audit.ts:93`／`:130` 的輸出是孤零零的 `severity,`，行內無任何 `.bind` 線索，必須回看**外層呼叫**才能歸類。只做逐行判讀會把這兩行誤當 shorthand ⇒ 得 7 而非 5。

   ⚠ 🚫 **不得**把本表退回成「規則敘述」形式 —— 純規則敘述已兩度導致第三方複現得 7 而非 5。

   KEEP 的**真正 object-literal shorthand 恰 5 處**：

   | shorthand 座標 | 值來源 | 是否流入 `safeUserAudit` |
   |---|---|---|
   | `api/admin/event-dlq/[id]/replay.ts:23` | `:22` 的 `severity: string` 參數 | **是** → 下表第 15 列 |
   | `api/admin/cron/event-outbox.ts:65` | `:60` 的 typed union 參數 | **是** → 下表第 16 列 |
   | `utils/credential-reverification.ts:87` | `:81-83` 的巢狀三元式 | **是** → 下表第 17 列 |
   | `utils/user-audit.ts:160` | 本函式剛算出的 `AuditSeverity` 區域變數（`notifyCritical(env, { ...entry, severity, … })`），**非外部輸入** | 否（模組內部呼叫） |
   | `api/admin/audit.ts:143` | HTTP query（已過 `VALID_SEVERITY`），寫進 audit `data.filters`、**非 `entry.severity`** | 否 |

⚠ **本 closure 曾被證偽兩次**（見本節量測法之演進說明）：任何縮短本節量測法的改寫，都必須先證明它仍能複現「24 → 5」。逐處分類如下：

   | # | 座標 | 分類 | 是否回流 `safeUserAudit` |
   |---|---|---|---|
   | 1 | `api/admin/credential-disposition/run.ts:81` | 合法字面量三元式 | 是（值恆合法） |
   | 2 | `api/admin/cron/audit-archive.ts:125` | `sev = willRetry ? 'warn' : 'critical'`（定義於 `:122`） | 是（值恆合法） |
   | 3 | `api/admin/cron/event-outbox.ts:238` | 合法字面量三元式 | 是（值恆合法） |
   | 4 | `api/admin/payments/intents.ts:141` | 合法字面量三元式 | 是（值恆合法） |
   | 5 | `api/auth/devices/logout.ts:130` | 合法字面量三元式 | 是（值恆合法） |
   | 6 | `utils/audit-aggregate-archive-runner.ts:114` | `sev = willRetry ? 'warn' : 'critical'`（定義於 `:111`） | 是（值恆合法） |
   | 7 | `utils/audit-aggregate-archive-runner.ts:628` | 合法字面量三元式 | 是（值恆合法） |
   | 8 | `utils/credential-disposition.ts:234` | 合法字面量三元式 | 是（值恆合法） |
   | 9 | `utils/role-change.ts:139` | 合法字面量三元式 | 是（值恆合法） |
   | 10 | `api/admin/cron/audit-aggregate.ts:217` | `b.severity`（DB 讀回 → aggregate INSERT） | **否** |
   | 11 | `utils/audit-aggregate-archive.ts:111` | `r.severity`（DB 讀回 → JSONL） | **否** |
   | 12 | `utils/audit-aggregate-debug.ts:297` | `r.severity`（DB 讀回 → JSONL） | **否** |
   | 13 | `utils/audit-aggregate.ts:190` | `r.severity`（DB 讀回 → aggregate） | **否** |
   | 14 | `utils/audit-archive.ts:206` | `r.severity`（DB 讀回 → JSONL/bucket key） | **否** |
   | 15 | `api/admin/event-dlq/[id]/replay.ts:23` | **ES6 shorthand**，值來自 `:22` 的 `severity: **string**` 參數 | **是** —— 唯一**未經型別收窄**者 |
   | 16 | `api/admin/cron/event-outbox.ts:65` | **ES6 shorthand**，值來自 `:60` 的 typed union 參數 `severity: 'info' \| 'warn' \| 'critical'` | 是（**已由型別保證**；5 個 caller `:85 :119 :133 :169 :186` 實測全傳字面量） |
   | 17 | `utils/credential-reverification.ts:87` | **ES6 shorthand**，值來自 `:81-83` 的巢狀三元式 | 是（值恆為合法三值） |

   **第 15 列即本 PR §4.4 處理的對象**：`auditReplay` 的參數由 `string` 收窄為 `AuditSeverity`，其 5 個 caller（`:32` `:41` `:52` `:76` `:79`）實測全傳合法字面量（`'warn'`×4／`'info'`×1）⇒ 收窄後由型別保證，該路徑於本 PR 後不再是非字面量入口。**第 16／17 列不需本 PR 處理**：前者參數已是 union、後者為字面量三元式，兩者今日即由型別或構造保證。

   另：typed union 參數 `cron/event-outbox.ts:60`（`severity: 'info' | 'warn' | 'critical'`）由型別保證；唯一 untrusted 來源 `admin/audit.ts:95` 被 `:96-98` `VALID_SEVERITY` 擋下，且只綁 SQL WHERE 與寫進 audit `data.filters`（`:143`）、**不作 `entry.severity` 用**；`safeUserAudit` 之 call site 無 top-level spread（所有 `...` 皆在 `data:` 內；`user-audit.ts:160` 的 `{ ...entry, severity, … }` 是**模組內部**對 `notifyCritical` 的呼叫，其 `severity` 為剛算出的 `AuditSeverity`，不構成外部輸入）。⇒ **今日可達的 present-but-invalid 集合 = ∅，預期資料殘留 = 0 row。**

   ⚠ **∅ 為 base commit `4a8933ba` 之快照，無機械維持。** re-scan trigger：(a) `noImplicitAny=0` rebaseline 前；(b) 任何新增／修改 `safeUserAudit` 之 `severity:` 實參為**非字面量**的棒次。該 trigger 成立時須**同時**重新評估 §5.4.1 的 `COLD_CLASS_VERSION` 窄判準 —— 其抵銷論證即建立在本 ∅ 之上。⚠ `strict:true` **只封住第 1 個洞**（`severity: null`）；**`any` 來源之洞不因此消失**（`any` 於 strict 模式下仍可賦值給 `AuditSeverity`）⇒ 🚫 本 re-scan trigger 與 §5.4.1 之連動重評**不得**因升 `strict:true` 而撤除。

**殘留方向之 fail-safe 性質**：即使上述 ∅ 在未來被打破，漂移方向為 `security_warn → security_critical`（retention **變長**），與 §4.3 不變量 1 一致，屬 fail-safe。

**部署後輕量驗證（建議，非阻擋）**：

⚠ **不可**把 `[audit-severity-invalid]` 的次數當作事後可查的判準。`wrangler.toml:45-50` 自述 Pages Direct Upload 不支援 `[observability]`；repo 全域無 logpush / tail_consumers / analytics_engine binding ⇒ 該 `console.warn` **只存在於 Real-time logs 或 `wrangler pages deployment tail`，須部署前先掛 tail 才可得，事後無法回溯**。

可執行的那一半：以 `admin/audit.ts` 查時間窗內 `severity='critical'` 的 row，按 `event_type` 分群，比對已知合法 critical 事件集合（`mfa.totp.disable` / `account.delete` 等）；出現非預期 event_type 即為 coercion 痕跡。

⚠ 兩個數字**不可直接相減**：warn 發生於 INSERT **之前**，`[audit-loss]` 路徑會使 warn 次數 ≠ critical row 增量。

⚠ 落庫後該 row 與「真實 critical」在 schema 上不可區分（`eventData` 不含 coercion 標記）。要有持久 provenance 須在 `event_data` 加 marker ⇒ **不在本棒**。

**(c) 資料層之第二軸 —— §4.6 wall-clock 軸之 durable effects**（② `CODEX-D-PLAN-R2-RR3` Required；客體經 ② `CODEX-D-PLAN-R3-RR1` 更正；🚫 **不得**併入 (b) 的 ∅ 論證，兩者客體不同）

依 §4.6 自身之因果（**§4.6 三項不變量段之第 2 項**已就地標明該軸不在其 4-tuple 涵蓋範圍內；情境見 **§10** 之 (2a) 列）：timeout 使原本可能因 handler 被 Worker wall-clock 截斷而中止的處理得以續行。⚠ 其 durable effect **分兩種性質，🚫 不得混稱為「row 由不發生變為發生」**：

| 軸 | 性質 | 依據 |
|---|---|---|
| **(甲) DLQ row 新增** | 可能**新增**一筆 `payment_webhook_dlq` row | `:243-254` 之 strict `dlqInsert`（orphan 之唯一 strict 憑證） |
| **(乙) event row 狀態轉移** | **既有** row 完成 `processing → applied`／`processing → failed` —— 🚫 **非新建** | 該 row **早於 `:159-163` 請求進入時即 `INSERT OR IGNORE … 'processing'`**；轉移發生於 `:256`／`:260`（`handleOrphan` 內），`markWebhookEventFailed` 之五個呼叫點見 §10 之 (2a) 列 |

| 項 | 判定（**(甲)(乙) 皆適用**，除非另標） |
|---|---|
| revert 後之處置 | **保留，🚫 不得刪除、不得倒轉、不得補償**。(甲) 是**有效的** orphan strict 憑證、(乙) 是**有效的** apply-status 事實，其正確性皆不依賴 §4.6 是否在線；刪除或倒轉會製造 §11.3.1 census 所指之 evidence 遺失 |
| 是否屬「殘留」 | 屬 forward-only 之既成事實，與 (b) 的 **invalid-fallback audit mapping residue** 是**不同客體** ⇒ 🚫 不得以 (b) 的「例外集合：∅」涵蓋 |
| 數量 | **未量測**（`UNMEASURED`）—— **(乙) 之 `applied`／`failed` 分布亦同**。abort path 不被自動測試（§8.2.2 取捨）、production webhook state 亦未驗證 ⇒ 🚫 不作任何數量、分布或「為 0」之宣稱 |
| rollback 動作 | (a) code revert 即足。**資料層無需任何動作** —— 無回溯步驟、無補償寫入 |

> ⚠ **「落庫等價」之定義（本檔唯一定義處；🚫 先前為未定義之承重用語）**：指「**對今日可達之輸入集合，本 PR 前後寫入 `audit_log` 的欄位值完全相同**」（適用範圍：本 PR 之 changed-files；**生效時態：base commit `4a8933ba` 之可達集合快照** —— ⚠ 與 §12 同一錨點，🚫 不得寫成「本 PR 合入時」：§12 已明載該 ∅ **無機械維持**且列有 re-scan trigger〔(a) `noImplicitAny=0` rebaseline 前；(b) 任何新增／修改 `safeUserAudit` 之 `severity:` 實參為非字面量的棒次〕，trigger 成立時本定義同步失效；例外集合：∅；closure：下列兩個使用面窮盡）——
> 1. **§4.5 之 `[vendor].ts` hunk**：由 §4.5 四例逐例證明，該 hunk 對三個 call site 的落庫值恆等。
> 2. **§4.3 之 severity 邊界**：由 §12 證明 present-but-invalid 之**今日可達集合 ＝ ∅** ⇒ 映射雖改變，實際落庫值不變。
>
> 🚫 **本用語不等於「本 PR 無行為變更」** —— §4.6 是**確實的 runtime 行為變更**（見 §4.6 之標軸段），只是它不碰任何 INSERT 引數故不影響本定義。
> ⚠ **排除理由**（🚫 不得以「屬行為新增而非型別收斂」為由 —— §4.6 即行為變更，該理由對本棒不成立）：coercion marker 須改 `event_data` 之寫入內容 ⇒ 直接違反上述「落庫等價」定義（而 §4.6 不違反），且屬 `user-audit.ts` 第 4 組 hunk、逾越 §5.1 三 hunk 自我約束。

---

## 13. 非目標

- 不推測 16 單元其餘字母對映
- 不修 `user-audit.ts` 或他檔的 JSDoc brace type（另立 backlog，owner 2026-07-22：🚫 不得在其他棒次夾帶順手修）
- 不抽取 C2 §9 的 merge-integrity 治理規則（`GOV-MERGE-INTEGRITY-EXTRACT-001`，未啟動）
- 不改 ratchet baseline、不 `--update`
- **不遷移 severity 的 read path**（`audit-archive.ts:716` / `audit-aggregate.ts:227` / `audit-aggregate-debug.ts:333`）；C2 §8.2 第一列維持 `OPEN`，見 §2.2
- **不耦合三份 CHECK 副本**：`database/_prod_snapshot_2026_05_12.sql:165` · `database/legacy_snapshots/schema_iam_prod.sql:50`（兩者為歷史快照，非活 schema 來源）· **`tests/integration/_setup.sql`**（不被 §8.4-4 的顯式斷言覆蓋；其是否為活約束取決於 vitest 檔案執行順序，見 §8.4-7）。本棒只耦合 `AUDIT_SEVERITY` ↔ **端態 schema**（§8.4-5）；`0017` 因是端態該 CHECK 的唯一安裝者而間接受涵蓋，非獨立耦合端點
- **不新增 `docs/AUDIT_RETENTION_PLAN.md` 三處寬判準的治理覆蓋**（`:104` changelog／`:295`／`:538` living body）——見 §5.4.1 第 0 點；該三處未被 C2 `GPT-C2-ARCH-RR2` 涵蓋（其 closure 只綁 source comment），且該檔不在任何 allowlist，改它＝scope creep。⚠ 追蹤見 **§5.4.2** `GOV-COLD-CLASS-VERSION-CRITERION-001`（owner／觸發條件已填妥；🚫 不再寫「由 owner 裁定擴充 RR2 closure 或另立 backlog」之未來式）
- **不為 §4.5 之落庫等價新增自動測試**（承接點）：`tests/integration/payments.test.ts` **不在 §5.2 allowlist**，把它加進來會擴 scope。⚠ 實測 `payment.webhook.orphan_intent` 在 `tests/` 命中數為 **0** ⇒ 該 hunk 的落庫值今日零自動覆蓋；驗收由 **§8.5 之 §4.5 逐字核 diff receipt ＋ ③④（`ARCH-D-L5` 之 L3 payment lens）** 承擔。🚫 不得以 §10 風險表「orphan 路徑由完整 `test:int` 涵蓋」讀成「稽核引數已被覆蓋」—— 該句只對「hunk 擴散」成立
- **不驗證 §4.6 之 abort 分支行為**（承接點）：§8.2.2 之 `AUDIT_WEBHOOK_TIMEOUT_GUARD` 鎖「`signal` 有被接上」、**§8.5 (a)(a2) 另逐字核同一 `ctrl`／同一常數／`() => ctrl.abort()` 之耦合**（② `CODEX-D-PLAN-R2`），**兩者皆不**驗 abort 觸發後之行為（`safeUserAudit` 仍 resolve、落庫成功、不產生 `[audit-loss]`）。⚠ 根因為 **zero-env 決策**（硬編 8000ms ⇒ 無法比照 `email.ts`／`oauth-callback-guard-fetch.test.ts` 以極小預算在 <1s 內測 abort），已於 §8.2.2 明文揭露為取捨。承接條件＝若未來改採 env-configurable 變體，須同批補 abort 分支測試。🚫 不得以「已有 `AUDIT_WEBHOOK_TIMEOUT_GUARD`」宣稱 abort 分支已覆蓋
- **不處理 §8.2.1 與 §8.2 `null` 案例在 `strict:true` 下的 suppression**（承接點，**兩處**）：(a) §8.2.1 之 `STRING_RAW_COLLISION_GUARD` 斷言傳 `undefined` 給 `raw: string`（實測終態 `TS2345`）；(b) §8.2 之 `null + security_signal` 案例傳 `null` 給 `severity?: AuditSeverity`（`strictNullChecks` 開啟後同型）。兩者於終態各預期需 +1 個 `@ts-expect-error`。承接者＝Stage 7 執行 `strict:true` 的棒次；🚫 **不得以刪除該斷言／案例代替補 suppression** —— 兩者分別是 `String(raw)` 與二分鎖 `null` 側的唯一機械保障（理由見 §8.2.1 之終態 landmine 段與 §8.2 之 `GPT-D-ARCH-RR4` 段）。本棒僅在 `strict:false` 下交付，不預先寫入未來的 suppression。
- **不補 `notifyCritical` 的 retry policy**。⚠ **本項於 ① R1 後已窄化**：原文為「不補 `notifyCritical` 的 timeout / retry」，理由是 scope creep；**`timeout` 已於本棒補上**（§4.6，owner 2026-08-05 選項 B），`TD-BATCHD-1` 隨之 **`CLOSED_PARTIAL`**（僅根因 (1)(3)；§10.1）⇒ 🚫 本項**不再涵蓋 timeout**。<br>**仍不補 retry 之理由**：`notifyCritical` 為 fire-and-forget 告警；失敗類二分見 §4.6 不變量 1，兩類皆不影響落庫（`:9-10` 明載設計本意）⇒ 無 retry 不構成**落庫正確性**缺口；補 retry 須連同告警去重／風暴抑制一併設計。🚫 不另立 TD（§10.1「殘留」欄即 record of record）
- **不補 `notifyCritical` 的告警投遞可觀測性** —— 🚫 **本項之客體以 §10.1.2 標的欄之三類 (F-a)/(F-b)/(F-c) 為準**，不得由本行括號自帶更窄的補法定義（原寫「（`res.ok` 檢查／失敗 log）」只涵蓋 (F-b)/(F-a)，漏 (F-c) `!url` 缺值）。屬 `user-audit.ts` 第 4 組 hunk，逾越 §5.1 三 hunk 自我約束。⚠ **機制** base 既有；🚫 不得無限定寫「本 PR 不改變」—— (F-a) 之**可達集合因 §4.6 abort 擴張**（二分見 §10.1.2 性質欄；② `CODEX-D-PLAN-R2-RR4` Required）；追蹤見 **§10.1.2** `GOV-AUDIT-ALERT-DELIVERY-OBSERVABILITY-001`
- **不補 `payment_webhook_events` 的 stuck-`processing` reaper／GC**（屬 `[vendor].ts` 狀態機變更，遠超 §5.1 之單 hunk 限制）。⚠ 追蹤見 **§10.1.1** `GOV-WEBHOOK-STUCK-PROCESSING-REAPER-001`；**append-only transition log／event sourcing 亦不實作**（同屬 `[vendor].ts` 狀態機變更），⚠ 追蹤見 **§10.1.3** `GOV-WEBHOOK-TRANSITION-EVIDENCE-001` —— 🚫 **三個 backlog 互不代替**（§10.1.1／§10.1.2／§10.1.3，見各節「⚠ 正交性」列）
- **不修 `code-self-review.mjs` 的 `REPO_PATH_PATTERN`**（§7.5；本棒以流程補償，工具修正屬維度 A hardening backlog）
- 不宣稱任何 `TS-*` governance rule 已被正式 enforce——**repo 內未找到 repo-local TypeScript governance manifest**；本 PR 僅能宣稱已查證 `scripts/typecheck-ratchet.mjs` 的實際規則

---

## 13.1 凍結 carve-out 窗口（本檔本地化定義）

送 ① 時以本檔 sha256 錨定後，**下列 carve-out（W-1 之儲存格 ＋ W-2 之 §15 段落）以外的任何字元變更**皆視為 plan 變更，須重跑 ①②。⚠ 「儲存格」一詞只描述 W-1；W-2 兩類為 prose 段落，故本句以 carve-out 統稱，🚫 不得回寫成「儲存格以外」（那會使 §15 的 append 落在窗口外、與 W-2 直接衝突）。

**W-1（gate 狀態回填）** — 僅限下列三項：

1. `§14` 表的 ①（ChatGPT Architecture）· ②（Codex Plan）· **第 3 列（owner `CODING_ALLOWED`）** 三列的「狀態／產出」格

   > ⚠ 第 3 列**必須**納入：它與已納入本窗口的表頭 line 7（`授權 = CODING_ALLOWED NOT_GRANTED`）**同一事實的兩處記載**，owner 核發時必然同步翻轉。若只納表頭而不納該列，該必然回填即落在 carve-out 之外 ⇒ **依本節首句直接判定為 plan 變更、強制重跑 ①②**（並非「疑義 ⇒ fail-safe」—— 本節首句已把規則寫死，不存在不確定性）。

2. 表頭 lines 5–7 的 `狀態` · `Gate state` · `授權` 三欄

3. `§14` 表的 **③④ 兩列**之「狀態」格與「產出」格（現值：**狀態格 `NOT_RUN`、產出格 `—`**）。「產出」格之回填內容：③ 核發時指向 `§15`；④ 核發時為 **owner 於該 gate 指定之載體指標** —— 🚫 不得寫死為 `§15`，因 §15 自身明列 ④ 載體待 owner 指定、且可能是 closeout PR 而非本檔

   > ⚠ 括號內為**現值記載**，非識別判準；儲存格由「③④ 兩列之『狀態』格與『產出』格」唯一指定。🚫 不得因現值敘述有誤而推論某格不在 carve-out 內 —— 兩格**皆**在。

> 表頭三欄**顯式納入** W-1（非留白）。理由：本檔表頭含活狀態欄位（批 C／C2 的表頭是靜態 prose），若不納入，每次 gate 推進的必然回填都會落在未定義窗口，而 live SoT `feedback_codex_review_workflow` §9 的 fail-safe（疑義時預設失效、預設重審）會使每次回填都觸發重審。

**W-2（receipt append ＋ 佔位取代）** — 限下列兩類：

1. `§15` 的 append-only 追加。
2. **`§15` 兩處佔位文字的取代**（非 append）。⚠ **本項需 §15 同步授權**：§13.1 只界定「什麼算 plan 變更」，**無權**解除 §15 自身「僅允許 append、禁止改寫既有條目」之內容約束；故 §15 已明列該二句**不屬「既有條目」**、經本項授權後可於對應 gate 核發時取代。兩節缺一則該必然變更仍為 plan 變更。


> ⚠ **本窗口之族定義＝「gate 推進時必然發生、且不改變任何鎖／allowlist／量化目標之字元變更」**（適用範圍：本檔；生效時態：自送 ① 錨定起至合入；例外集合：∅；closure：W-1 item 1 之 §14 三列 ＋ item 2 之表頭 lines 5–7 ＋ item 3 之 §14 ③④ 兩列狀態與產出格 ＋ W-2 兩類，以上窮盡。⚠ 計數單位以 **item** 為準〔W-1 共 3 個 item〕，🚫 不得與「§14 三列」之**列**混用）。🚫 任何**不屬**此族的字元變更一律為 plan 變更，須重跑 ①②。

---

## 14. Gate 軌跡

| # | Gate | 狀態 | 產出 |
|---|---|---|---|
| 0 | SPEC 收斂（owner） | ✅ APPROVE WITH REQUIRED CORRECTION | 本檔 §3 |
| 1 | ① ChatGPT Architecture | **R1 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Tier-0 Blocker／4 Required／5 Locks；錨定 PLAN R1 sha256 `6516bd65…503bf`、`1062` lines、`126993` B、LF）<br>**R2 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Tier-0 Blocker／**1 Required**／`ARCH-D-L1..L5` 全部 HOLD；錨定 PLAN R2 sha256 `979f314d…4b0d0`、`1321` lines、`182576` B、LF）—— `RR1`／`RR4` **CLOSED**、`RR2` **CLOSED WITH EXISTING LOCK**、`RR3` 僅餘 bullet 5 判準未閉合<br>**R3 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Tier-0 Blocker／**2 Required**／**0 新架構方向 finding**；錨定 PLAN R3 sha256 `a1cb7d23…c2320`、`1372` lines、`188875` B、LF）—— 四項驗收中 #1/#3/#4 **CLOSED**、#2 **PARTIAL**（`R3-RR1`）；另 `R3-RR2` gate-state drift<br>**R4 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Tier-0 Blocker／**1 Required**／1 主動申報 `APPROVED`／**0 新架構方向 finding**；錨定 PLAN R4 sha256 `460d2c01…90100`、`1402` lines、`205727` B、LF）—— `R3-RR1`／`R3-RR2` 皆 **CLOSED**、self-review prerequisite **SATISFIED**、「History A／B 客體限定申報」**APPROVED**；唯一 Required ＝ `GPT-D-ARCH-R4-RR1`<br>**R12 ＝ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Tier-0 Blocker／0 Required／0 新架構方向 finding／0 新 lock**；錨定 PLAN R12 sha256 `824484bb…f06a3`、`1565` lines、`267960` B、LF）—— `GPT-D-ARCH-R11-RR1` **CLOSED**；兩驗收點皆通過；self-review prerequisite **SATISFIED**；`CODEX-D-PLAN-R3-RR1` **不重開、仍為 ARCH-ACCEPTED**（① 直接比對 R11／R12 artifact 確認實質 diff 恰為申報之 4 處）；`ARCH-D-L1..L5` **HOLD（既有 locks 續效，非 R12 新增）**；**(A)** 表頭維持 `§14.1–§14.8` ＋ ① 課予**同步維護義務**（詳表頭該句之就地註記；🚫 **非新 lock**）· **(B)** §6.2 同族刀 **`NOT_SCOPE_CREEP`**、🚫 不需另開 R13<br>⚠ ① 另做**傳輸複驗**：附件為 CRLF，**LF-normalize 後為 `1565` 行／`267960` B／CR 0／sha256 `824484bb…f06a3`**，與宣告逐位一致 ⇒ 無 transport／artifact drift<br>⇒ **① Architecture Gate 通過（現行依據）；下一合法狀態＝送 ② Codex Plan R4**；① 明示**不需要 R13**；🚫 **（R12 當時）**`CODING_ALLOWED` 仍為 `NOT_GRANTED`（② R4 即使通過，仍須 owner 明示）—— ⚠ owner 已於 **2026-08-12** 明示 `GRANTED`；**現行授權狀態一律以表頭「授權」欄為準**，🚫 不在此具名<br>**R11 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Tier-0 Blocker／**1 Required**／0 新架構方向 finding／**0 新 lock**；錨定 PLAN R11 sha256 `c37a03c9…3e6d4`、`1565` lines、`265070` B、LF）—— **`CODEX-D-PLAN-R3-RR1` ARCH-ACCEPTED**（兩軸 durable-state 模型正確；① 明示 `payment_webhook_events` 本即被 §11.3.1 定位為 **current-state ledger 而非 append-only transition history**〔`failed → processing` 覆寫 `processed_at`、`:256` 之 `processing → failed` 無配對 transition-completion evidence〕，故 History A／B 在 **event row 本身**仍收斂至相同終態 ⇒ History A／B 客體限定 · bullet 5 `PARTIALLY SATISFIED` · transition-evidence gap **三者皆不受影響**）；rollback 模型成立；**`UNMEASURED` 不構成 ③④ 驗收空洞**；§14.8 family closure **通過**（① 獨立重跑得 6 命中）；self-review prerequisite **SATISFIED**；唯一 Required ＝ **`GPT-D-ARCH-R11-RR1`**（表頭 exhaustive index 仍寫 `§14.1–§14.7` 而 §14.8 已存在 ⇒ `P`／`¬P`；① 明示**非新 architecture finding**，係本輪新增 §14.8 後之 governance／index closure drift）<br>⚠ ① 另做**傳輸複驗**：附件被傳輸層轉為 CRLF，**LF-normalize 後為 `1565` 行／`265070` B／CR 0／sha256 `c37a03c9…3e6d4`**，與宣告完全一致<br>→ **R12（ultra-narrow）之審查範圍〔① 於 R11 指定〕**：只驗表頭 exhaustive index 已為 `§14.1–§14.8` ＋ current-state bookkeeping 一致；🚫 **不得重開 `R3-RR1` durable-state 模型**。R12 若乾淨應核發 `CHATGPT_ARCH_APPROVED_WITH_LOCKS`，再送 ② R4<br>**R10 ＝ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Tier-0 Blocker／0 Required／0 新架構方向 finding／0 新 lock**；錨定 PLAN R10 sha256 `05723d16…86fb8`、`1534` lines、`254701` B、LF）—— `GPT-D-ARCH-R9-RR1` **CLOSED**；`CODEX-D-PLAN-R2-RR2` 由 **PARTIAL 升為 ARCH-ACCEPTED** ⇒ **② R2 四條在 Architecture 維度均已接受**；self-review prerequisite **SATISFIED**；`ARCH-D-L1..L5` **HOLD（既有 locks 續效，非 R10 新增）**；`:1193` 之 pre-existing 位置型指涉 ① **不要求修、不升 side-finding**（其 target 為緊接之表格、無實質解析歧義；保持不動判為正確之 scope discipline）<br>⚠ ① 另做**傳輸複驗**：其收到之掛載副本被傳輸層轉為 CRLF，**LF-normalize 後恰為 `1534` 行／`254701` B／CR 0／sha256 `05723d16…86fb8`**，逐位符合我方宣告 ⇒ 屬**傳輸正規化**，非 cognition–artifact drift<br>⇒ 當時 **① Architecture Gate 通過；下一合法狀態＝送 ② Codex Plan R3**；① 明示不需要 R11<br>⚠ **R10 之核發已失效**：② R3 判 `CODEX_PLAN_CHANGES_REQUIRED`（1 Required `CODEX-D-PLAN-R3-RR1`），其修正落在 §13.1 carve-out **外**（詳 §14.8）⇒ 須重送 ① **R11**；🚫 不得援引「不需要 R11」略過（前提為「只為記錄 approval 而回填」，本輪不成立）。🚫 **（R10 當時）**`CODING_ALLOWED` 仍為 `NOT_GRANTED`<br>**R9 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Tier-0 Blocker／**1 Required**／0 新架構方向 finding／**0 新 lock**；錨定 PLAN R9 sha256 `f0e91c5e…2608c`、`1529` lines、`251380` B、LF）—— ② R2 四條中 `R2-RR1`／`R2-RR3`／`R2-RR4` **ARCH-ACCEPTED**、`R2-RR2` **PARTIAL**（timeout 實質語義修正接受，僅 evidence-family closure 尚缺一刀）；self-review prerequisite **SATISFIED**；兩項自願修正判 **非 scope creep、可保留**；① 明示 **R9 本身必要**、不受其 R8「不需要 R9」之 bookkeeping 限定語拘束；唯一 Required ＝ **`GPT-D-ARCH-R9-RR1`**（§14.7 之量測母體含本枚舉區塊自身 ⇒ **集合完備性 closure 未成立**；🚫「不作處數 closure 宣稱」無法解掉 —— 客體是**集合**而非計數）<br>→ **R10（ultra-narrow）之審查範圍〔① 於 R9 指定〕**：只驗 `GPT-D-ARCH-R9-RR1` 之母體／self-meta exclusion 是否閉合；🚫 不得重開 `R2-RR1`／`R2-RR3`／`R2-RR4` 或任何先前 CLOSED／HOLD 項。⚠ ① 明示該刀位於 §14.7、**不在 §13.1 W-1／W-2 carve-out 內** ⇒ 🚫 不得修完直接送 ② R3<br>**R8 ＝ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Tier-0 Blocker／0 Required／0 新架構方向 finding／0 新 lock**；錨定 PLAN R8 sha256 `66a86da5…404ea`、`1480` lines、`235436` B、LF）—— `GPT-D-ARCH-R7-RR1` **CLOSED**；兩驗收點（header current-state 已閉合〔不再存在 `P`／`¬P`〕、header／§14 current-state 一致）**皆通過**；本輪 bookkeeping 兩 hunk **合法落在 §13.1 W-1 carve-out**、不構成新的 plan semantic change；`ARCH-D-L1..L5` **HOLD（既有 locks 續效，非 R8 新增）**；① 另**正式更正其 R7 裁決之內部矛盾**（最小修正原文寫「→ 待送 ① R7」、同一裁決卻明示「修正後需送一次 ① R8」）：裁定**以 current-state SoT 為準、此時正確值必須是 R8**，我方處置**正確、不應改回 `R7`**<br>⇒ 當時 **① Gate 通過，下一合法狀態＝送 ② Codex Plan R2**；① 明示**不需要 R9**，且為記錄本次 approval 而依 §13.1 回填 header／§14 **仍屬既有 W-1 bookkeeping carve-out、🚫 不因此重跑 ①**<br>⚠ **R8 之 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` 已失效**：② Codex Plan R2 判 **`CODEX_PLAN_CHANGES_REQUIRED`**（4 Required），其修正皆落在 §13.1 carve-out **外**（詳 §14.7）⇒ 須重送 ① **R9**。🚫 **不得**援引 R8 之「不需要 R9」略過 —— 該句之適用前提為「後續**只**為記錄 R8 approval 而回填」，本輪為 carve-out 外之 plan 變更、前提不成立<br>**R7 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Tier-0 Blocker／**1 Required**／0 新架構方向 finding／**0 新 lock**；錨定 PLAN R7 sha256 `60df2da5…a8af2`、`1480` lines、`234175` B、LF）—— `GPT-D-ARCH-R6-RR1`／`R6-RR2` **皆 CLOSED、不再重開**、self-review prerequisite **SATISFIED**；唯一 Required ＝ **`GPT-D-ARCH-R7-RR1`**（表頭 gate-state SoT drift：header 寫「待送 R6」而 §14.6 寫「送 R7」⇒ current-state `P`／`¬P`；① 明示該 header 儲存格屬 §13.1 gate-progression bookkeeping carve-out、**修正不構成新的 plan semantic change**）<br>→ **R8（ultra-narrow）之審查範圍〔① 於 R7 指定〕**：只驗 `GPT-D-ARCH-R7-RR1` ＋ 修正後之 header／§14 current-state consistency<br>**R6 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Tier-0 Blocker／**2 Required**／0 新架構方向 finding／**0 新 lock**；錨定 PLAN R6 sha256 `afe14408…7313c`、`1449` lines、`226925` B、LF）—— ② 五條中 `R1`／`R2`／`R3`／`R5` **ARCH-ACCEPTED**、`R4` **PARTIAL**；census 第 9 列 **REQUIRED CHANGE（准予極窄解凍）**、`INFO-1` **REQUIRED CLEANUP** ⇒ `GPT-D-ARCH-R6-RR1`／`R6-RR2`<br>→ **R7（ultra-narrow）之審查範圍〔① 於 R6 指定〕**：只驗該 2 項 ＋ **self-review prerequisite**；🚫 `ARCH-D-L1..L5` 續 HOLD、先前 CLOSED 項與 History A／B `APPROVED` 不重開<br>**R5 ＝ `CHATGPT_ARCH_APPROVED_WITH_LOCKS`**（**0 Tier-0 Blocker／0 Required／0 新 finding／0 新 lock**；錨定 PLAN R5 sha256 `9dbedec2…34f0c`、`1423` lines、`211290` B、LF）⚠ **已失效**（見表頭與 §14.5）—— `GPT-D-ARCH-R4-RR1` **CLOSED**（四點最小安全修正全數閉合）、self-review prerequisite **SATISFIED**、`ARCH-D-L1..L5` **HOLD（既有 locks 續效，非本輪新增）**；① 明示**無理由建立 `R5-RR1` 或再開 R6**<br>⇒ **（R5 當時）① Gate 通過，下一合法狀態＝送 ② Codex Plan Gate**〔⚠ 該結論已隨 R5 之失效一併失效；**現行 ① Gate 通過依據一律以表頭 Gate state 格為準**，🚫 不在此具名輪次〕；🚫 **（R5 當時）**`CODING_ALLOWED` 仍為 `NOT_GRANTED`（② R2 通過後仍須 owner 明示） | §14.1 · §14.2 · §14.3 · §14.4 · §14.5 · **§14.6**（⚠ **R5 為 0 Required、無 disposition 可寫**，其裁定就地存於左欄狀態格，故**無 §14.5-for-R5**。🚫 原護欄「新建子節會使 ① R5 之 APPROVE 失效」之前提**已於 ② R1 消失** —— ② 之 5 Required 落在 §13.1 carve-out 外，該 APPROVE 已失效、須重送 ① **R6**，見左欄與 §14.5）。⚠ **R8／R10／R12 同為 0 Required、無 disposition 可寫** ⇒ 其裁定亦就地存於左欄狀態格、**不另立該三輪之 §14.x 子節**；🚫 為其新建子節會落在 §13.1 carve-out **外**，依 §13.1 首句即為 plan 變更、須重跑 ①②。⚠ R9 之 1 Required 依 **R7 先例**（1 Required 亦不另立子節）就地記於左欄狀態格 |
| 2 | ② Codex Plan | **R1 ＝ `CODEX_PLAN_CHANGES_REQUIRED`**（0 Tier-0 Blocker／**5 Required**／2 Info；錨定 PLAN sha256 `2fe31177…94caf`、`1423` lines、`212088` B、LF）—— `CODEX-D-PLAN-R1`…`R5` ＋ `INFO-1` **本輪修訖（我方，未經 ② 核發）**；**`INFO-2` 為 ② packet 之缺陷、非 PLAN 客體 ⇒ 於重建 packet 時更正**（見 §14.5）；blocking replay A1–A4、四檔三方 blob、index hints、source 零落地、ratchet base `373/14/323/337` 皆經 ② 實跑通過<br>→ **R2 之前置條件〔② 於 R1 指定〕**：因 5 Required 皆落在 §13.1 carve-out **外**，須先重取 ① 對新 hash 之核准〔**已滿足**：① R6→R7→R8，R8 核發 `CHATGPT_ARCH_APPROVED_WITH_LOCKS`、錨定 `66a86da5…404ea`〕<br>**R2 ＝ `CODEX_PLAN_CHANGES_REQUIRED`**（0 Tier-0 Blocker／**4 Required**／2 Info；錨定 PLAN R2 sha256 `609cf817…47946`、`1480` lines、`237666` B、LF）—— **① R8 授權鏈成立**（② 實跑複驗 `3+/3-` 恰在三個 W-1 儲存格 ⇒ 該回填不要求 ① R9）；R1 五條之實質改善經 ② 逐條確認；`CODEX-D-PLAN-R2-RR1`…`RR4` ＋ 2 Info **本輪修訖（我方，未經 ② 核發）**；我方主動申報之兩條殘留 ② 判 **非阻擋、不要求單獨重跑 gate**<br>→ **R3 之前置條件〔② 於 R2 指定〕**：因 4 Required 皆落在 §13.1 carve-out **外**，須先重取 ① 對新 hash 之核准〔**已滿足**：① R9→R10，R10 核發 `CHATGPT_ARCH_APPROVED_WITH_LOCKS`、錨定 `05723d16…86fb8`〕<br>**R3 ＝ `CODEX_PLAN_CHANGES_REQUIRED`**（0 Tier-0 Blocker／**1 Required**／2 Info；錨定 PLAN R3 sha256 `456859e2…0aa78`、`1534` lines、`257362` B、LF）—— **① R10 授權鏈成立**（② 實跑複驗 `3+/3-` 全在 W-1 三格 ⇒ 不要求 R11）；**`R2-RR1`／`R2-RR2`／`R2-RR4`／`INFO-2` 均已閉合**；timeout family 獨立重播為 31 行＝19／11／1；`event_outbox` replay 之 type-only 收窄、lease/CAS、exact-one parser 契約**未退化**；唯一 Required ＝ **`CODEX-D-PLAN-R3-RR1`**（§12 (c) durable-state 認錯客體）**本輪修訖（我方，未經 ② 核發）**<br>→ **R4 之前置條件〔② 於 R3 指定〕**：該 Required 之修正落在 §13.1 carve-out **外**，須先重取 ① 對新 hash 之核准〔**已滿足**：① R11→R12，R12 核發 `CHATGPT_ARCH_APPROVED_WITH_LOCKS`、錨定 `824484bb…f06a3`，並明示不需要 R13〕<br>✅ **R4 ＝ `CODEX_PLAN_APPROVED` @ `e6c6a2ed`**（**0 Tier-0 Blocker／0 Required／1 Info**；錨定 PLAN R4 sha256 `1483dc52…26bf9`、`1565` lines、`270959` B、LF）—— **① R12 授權鏈成立**（② 實跑複驗 `3+/3-` 全在 W-1）；**`CODEX-D-PLAN-R3-RR1` 於 Plan 維度閉合**（② 以 live source 證實：DLQ row 為可能新增、event row 早已建立且只做 `processing → applied/failed`；§4.6／§12 (c)／§14.8 兩軸模型一致；rollback 保留兩類既成事實；**`UNMEASURED` 不形成驗收空洞**）；§14.8 census ② 重跑為 **7 行＝2 live guard ＋ 5 self／meta**、無未分派成員（⚠ ② 明示 §14.8 內記載之 `6 ＝ 2／4` 為 **① R11 當時 artifact 之歷史 receipt、非 current count 宣稱**）；Queue／payment／distributed-state／observability 既有風險與 Code Gate 驗收面**未退化**；**0 新 Tier-0 side-finding**<br>⚠ 唯一 Info **`PACKET-EVIDENCE-R4-1`** 為**我方 packet 之證據瑕疵、非 PLAN 客體**：R4 packet 對 `01-…-R12.md` 只寫「sha256 前 16 碼未變」而未列值，且目錄無版本歷史 ⇒ **不能獨立證明「未變」**。處置＝後續 packet **必列 current hash**，且**無先前錨點時 🚫 不得宣稱 unchanged／only-add 已證明**（🚫 不寫進本 PLAN 之規範面）<br>⚠ ② 明載：repo 無 `governance/rules.json` ⇒ 全域 TypeScript rule 僅 advisory；本輪**未跑** typecheck／tests／build —— 係 **docs-only Plan Gate、非 Code Gate**，production／test／config blobs 未變 | 逐項處置詳 **§14.5**（R1）· **§14.7**（R2）· **§14.8**（R3）。⚠ **R4 為 0 Required、唯一 Info 屬 packet 客體 ⇒ 無 disposition 可寫、不另立 R4 之 §14.x 子節**，其裁定就地存於左欄狀態格（同 row ① 對 R8／R10／R12 之處理）；🚫 為 R4 新建子節不僅落在 §13.1 carve-out 外，**且將觸發 ① 於 R12 課予之 range 同步義務**（表頭 `§14.1–§14.8` 須於同一變更內同步）。①`CHATGPT_ARCH_APPROVED[_WITH_LOCKS]` 後才送〔R2 前置已滿足：① R8；R3 前置已滿足：① R10；**R4 前置已滿足：① R12**〕。⚠ ① 指示 ② 須額外鎖定 §8.4-5(ii)〔**原文如此；正確為 (i)**，見 §8.4-5 之 fail-closed 解析契約段 —— (ii) 依規範為行內字面量 runtime 斷言、其內不存在解析器。🚫 不靜默改寫 ① 原文，改以中括號更正並隨 R2 packet 呈給 ①〕之 **fail-closed 解析契約**（恰一個 CHECK；0 或多重 match 均 fail）。⚠ 本格僅為索引，契約全文以 §8.4-5 為準 |
| 3 | owner `CODING_ALLOWED` | ✅ **`GRANTED`（owner 於 2026-08-12 明示）** —— 前提 Plan Gate 兩道皆通過（① R12 · ② R4）。⚠ owner 同時指定**維度 A self-review 用單 agent 對抗式**（🚫 非 multi-agent workflow） | 授權範圍＝§5.1／§5.2／§5.3 allowlist ＋ §1 量化目標；🚫 **不含** merge／push／deploy（仍須 ③④ ＋ owner） |
| 4 | ③ Codex Code | ✅ **`CODEX_CODE_APPROVED` @ `1a416946`**（**0 Blocker／0 Required／3 Info**；3 Info 皆為**我方 packet 之證據瑕疵、非 code**）—— 九面逐一裁定（Critical Risk／State Consistency／Queue／Payment／Distributed State／Observability）皆通過；我方兩處實作偏離 **③ 均接受**；殘留風險（abort 分支與平台實際取消行為未動態驗證）為 PLAN 已接受者 | **§15**（receipt 全文含 3 Info 逐條處置） |
| 5 | ④ ChatGPT faithfulness | ✅ **`CHATGPT_CODE_FAITHFULNESS_APPROVED` @ source `1a416946`**（**0 Blocker／0 Required／0 plan-architecture side-finding／1 packet-only Info**）—— 四個指定方向點（§4.6 未被寫成「已解決」· §4.3 二分未被語義近似寫法合併 · **無 scope creep**〔④ 獨立逐檔看完整 patch〕· 兩處字面偏離 `ACCEPTED / FAITHFUL`）**全數 PASS**；未發現「機械 gate 全綠、但實際做成另一件事」之 drift。`INFO-④-1` 為我方 packet 之量測形式未標（`-U0` 13 hunks vs `-U3` 7 hunks），🚫 不要求改 source、不要求重跑任一 gate | **§15**（receipt 全文）。⚠ 載體由 ④ 指定為 §15，🚫 不另開 closeout PR |

### 14.1 ① R1 之處置（`CHATGPT_ARCH_CHANGES_REQUESTED`，2026-08-05）

**4 Required 全數修訖**：

| ID | 級別 | 處置 | 落點 |
|---|---|---|---|
| `GPT-D-ARCH-RR1` | Required · Tier 1 | 改判 `DISCORD_AUDIT_WEBHOOK_PROD_STATE = UNKNOWN`；owner 2026-08-05 選 **選項 B**（先行納入 bounded timeout）而非 A（外部 presence receipt）⇒ 該 UNKNOWN 在 **wall-clock 軸**不再承重（投遞軸見 §10.1.2）。`TD-BATCHD-1` **`CLOSED_PARTIAL`（僅根因 (1)(3)）**；🚫 不得寫「CLOSED，owner 欄問題隨之不適用」—— 根因 (2)(4) 仍延後且**各自需要 owner**（見 §10.1 owner 欄） | **表頭動工級別 row** · **§4.6**（新增）· §5.1-2 · §6 · §8.2 · §10 · **§10.1**（改寫為 `CLOSED_PARTIAL`）· **§8.2.2**（新增 `AUDIT_WEBHOOK_TIMEOUT_GUARD` 機械鎖 ＋ zero-env 可測性取捨揭露）· **§8.5**（新增 §4.6 逐字核 diff receipt）· **§10 兩列**（永久卡 `'processing'` 列 ＋ 重放放大列，RR1 漣漪族窮盡）· **§10.1.1**（`GOV-WEBHOOK-STUCK-PROCESSING-REAPER-001` —— `TD-BATCHD-1` 部分 CLOSE（`CLOSED_PARTIAL`）後，reaper 缺口原寄生於其追蹤欄，須改為自有條目）· **§10.1.2**（`GOV-AUDIT-ALERT-DELIVERY-OBSERVABILITY-001`）· §11.2-4 · §11.3-4／-5 · **§13**（非目標清單須同步窄化，否則與 §4.6 直接矛盾） |
| `GPT-D-ARCH-RR2` | Required · Governance/SSOT | 建立一次性架構例外（`COLD_CLASS_VERSION` 僅描述 persisted 對之重推與 manifest 解讀、不涵蓋 raw-input normalization）＋ 🚫 禁援引為先例 ＋ 具名 backlog `GOV-COLD-CLASS-VERSION-CRITERION-001`（owner／觸發條件已填，含**非機械觸發**之申報）；移除「allowlist 保證正確」論證、降級為 scope consistency 檢查 | **§5.4.2**（新增）· §5.4.1 第 5 點 · **§13**（尾句由未來式「由 owner 裁定…或另立 backlog」改為具名指向 §5.4.2，與 RR1 列同構） |
| `GPT-D-ARCH-RR3` | Required · Distributed State | 校正狀態模型（UPDATE 失敗 ⇒ transition **未發生**）＋ 補上漏查的 `payment_webhook_dlq`（全域寫的是「audit log ／ **event log**」）；建 **12 列** transition／evidence 表 ⇒ bullet 5 **由「部分滿足」改為滿足**（⚠ 該滿足倚賴「row state 計入 event log」之**明示前提**，判準選擇交 ①）；殘留三項：recovery gap · failure-observability gap · **`:256` evidence gap**<br>⚠ **本列為 R1 當輪之處置紀錄，其結論已於 ① R2 被否決**：bullet 5 現為 `PARTIALLY SATISFIED`／`PRE-EXISTING DEVIATION`（見 §11.3-6 · §11.3.1 表後 · §14.2）；「row state 計入 event log」之前提與「判準選擇交 ①」**均已失效**，🚫 不得再援引。第三項殘留亦已於 §14.3 `R3-RR1` 重新定性為 bullet 5 partial 之直接構成要件 | **§11.3.1**（新增）· §11.3-6 bullet 5 |
| `GPT-D-ARCH-RR4` | Required · Contract test | 新增 `null + security_signal` integration case，使二分鎖 `null` 側成為 load-bearing（防日後 `=== undefined` 被誤改為 `== null`）；零 suppression 成本、預算不變 | §8.2 · §13 |

**5 Architecture Locks（已核可方向，🚫 不得反向漂移）**：

| Lock | 本檔落點 | 合規狀態 |
|---|---|---|
| `ARCH-D-L1` TYPE-BOUNDARY | §4.2 | ✅ 已明文標定 `severity?: AuditSeverity` 為 **validated application-domain contract**、parser 為 defense-in-depth；🚫 不得再述為 raw external string boundary |
| `ARCH-D-L2` PARSER | §4.1(a)(b) · §5.5 | ✅ 單一 SoT 方向（`AUDIT_SEVERITY` → `AuditSeverity` → `parseAuditSeverity(unknown)`）、`null` 作 invalid representation、禁 `as AuditSeverity` —— 均已就位，本輪未改動 |
| `ARCH-D-L3` EMIT | §8.5 | ✅ esbuild stdin ＋ `--format=esm` ＋ 雙端非零 bytes ＋ sha256 ＋ `diff -q` ＋ stderr 空 ＋ tracked tree clean —— 均已就位，本輪未改動 |
| `ARCH-D-L4` STRING-RAW | §8.2.1 · §13 | ✅ 已加穩定識別字 `STRING_RAW_COLLISION_GUARD`；終態補 suppression、🚫 不得刪測試 |
| `ARCH-D-L5` ISOLATION/ROLLBACK | 表頭動工級別 · §11.1 · §12 | ✅ F-3 三軸 `NOT_TRIGGERED`、code rollback 與 forward-only 殘留分開分析；已標明**實作維持 L2、③④ 採 L3 payment + distributed-state lens** |

⚠ 本輪修正**含 §13.1 carve-out 外之內容變更** ⇒ 產生新 PLAN sha256，須以新 canonical hash 重送 ①（判定規則見 §14.3；🚫 本句刻意不枚舉變更點）。② 尚未執行，無既有 Codex Plan approval 需失效處理。

### 14.2 ① R2 之處置（`CHATGPT_ARCH_CHANGES_REQUESTED`，0 Tier-0 Blocker／1 Required）

**R1 四條之 R2 判定**：`GPT-D-ARCH-RR1` **CLOSED** · `GPT-D-ARCH-RR2` **CLOSED WITH EXISTING LOCK** · `GPT-D-ARCH-RR4` **CLOSED** · `GPT-D-ARCH-RR3` **CHANGES REQUESTED（只剩 bullet 5）** · `ARCH-D-L1..L5` **全部 HOLD**。

**唯一 Required ＝ `GPT-D-ARCH-R2-RR1`**（位置：§11.3 Distributed State bullet 5 · §11.3.1 表後結論）：

| ① 之要求 | 本檔落點 | 狀態 |
|---|---|---|
| bullet 5 由 `✅ 滿足` 改為 `PARTIALLY SATISFIED`，並明列 row state 能證明**目前狀態**、不能證明**歷史 transition sequence** | §11.3-6 bullet 5 列 · §11.3 「⇒ 五項中…」句 | ✅ **CLOSED（① 於 R3 核發）** |
| 刪除「所有實際 transition 皆可重建」之全稱；**保留 12 列 census** | §11.3.1 表後結論（改為反例論證；census 集合與主欄保留，第 4 列 parenthetical 後由 `GPT-D-ARCH-R4-RR1` 就地更正，見 §14.4） | ⚠ **我方修訖 → ① 於 R3 判 `PARTIAL`**，殘留轉 `GPT-D-ARCH-R3-RR1`（見 §14.3）。🚫 不得讀為已 CLOSED |
| 新立**獨立於 reaper／alert observability** 之具名治理債，含 owner／性質／目前缺口／closure／觸發／本棒立場 | **§10.1.3 `GOV-WEBHOOK-TRANSITION-EVIDENCE-001`**（新增） | ✅ **CLOSED（① 於 R3 核發）** |
| 三個 backlog 保持**正交**，不得互相代替 | §10.1.1／§10.1.2／§10.1.3 各補「⚠ 正交性」列 | ✅ **CLOSED（① 於 R3 核發）** |


⚠ **本輪修正含 §13.1 carve-out 外之內容變更** ⇒ 產生新 PLAN sha256，須重送 ① **R3（ultra-narrow）**（判定規則見 §14.3；🚫 本句刻意不枚舉變更點）。① 已指定 R3 只審四點（見本節上方四列表；亦見 §14.3「R3 四項驗收」），🚫 RR1／RR2／RR4 與 `ARCH-D-L1..L5` **不重新開題**。

### 14.3 ① R3 之處置（`CHATGPT_ARCH_CHANGES_REQUESTED`，0 Tier-0 Blocker／2 Required／0 新架構方向 finding）

**R3 四項驗收**：#1 bullet 5 → partial **CLOSED** · #2 移除舊全稱／舊判準 **PARTIAL（見 `R3-RR1`）** · #3 transition-evidence backlog **CLOSED** · #4 三 backlog 正交 **CLOSED**。`ARCH-D-L1..L5` 與 R1 `RR1/RR2/RR4` **未重新開題、未發現反向漂移**。

| ID | 內容 | 處置 | 落點 |
|---|---|---|---|
| `GPT-D-ARCH-R3-RR1` | ⚠ **① 原文另含 census 指示：「不要改 12 列 census」**（此為 ① **第二度**明令；第一度見 §14.2 之 `R2-RR1` 第 2 列「保留 12 列 census」）。<br>§11.3.1「三項殘留」第三列仍留 **R2 已裁掉的條件分支**（「在『row state 計入 event log』之前提下 bullet 5 仍滿足；不接受該前提則此列即缺口」），與同節前文之現行架構裁定直接矛盾 | 該列「分類」欄改為 **transition-evidence gap ＝ bullet 5 `PARTIALLY SATISFIED` 之直接構成要件**；「性質」欄**整段刪除條件分支**並就地標記該前提已被否決之理由。🚫 **12 列 census 於 R3 輪次未動**（其第 4 列 parenthetical 後由 `GPT-D-ARCH-R4-RR1` 解凍更正，見 §14.4） | §11.3.1 殘留表第 3 列 |
| `GPT-D-ARCH-R3-RR2` | 表頭 Gate state 仍寫「R1；4 Required 全數修訖，**R2 待送**」，與 §14 已記載之 R2／R3 狀態不一致 ＝ **gate-state cognition–artifact drift** | 表頭改為**逐項標核發者**之現況：R1 之 `RR1`／`RR4` CLOSED、`RR2` CLOSED WITH EXISTING LOCK（皆 ① 於 R2 核發），`RR3` **未**由 ① 宣告 CLOSED、殘留轉 `R2-RR1`；R2 之 `R2-RR1` 四項中 #1／#3／#4 CLOSED（① 於 R3 核發）、**#2 PARTIAL** 殘留轉 `R3-RR1`；R3 兩項**本輪修訖（我方，未經 ① 核發）**、R4 待送。並指向 §14／§14.1／§14.2／§14.3。🚫 本欄先前寫「R1 CLOSED · R2 CLOSED」，與同節 `#2 PARTIAL` 及表頭自述之「`RR3` 未由 ① 宣告 CLOSED」相斥，已更正。⚠ 此欄位屬 **§13.1 W-1 carve-out**，修它**不觸發** R1/R2 架構內容重開 | 表頭 Gate state 格 |

⚠ **本輪變更之 carve-out 歸屬**：依 **§13.1** 之 carve-out 定義判定（W-1 ＋ W-2；🚫 本節**不複述**該定義、**不枚舉**本輪變更點 —— 複述會與 §13.1 產生第二份可漂移副本，枚舉則每輪皆須逐 hunk 維護，兩者本檔皆已實測為缺陷來源）。

⚠ **本輪事實**：本輪含 §13.1 carve-out **外**之內容變更 ⇒ 依 §13.1 首句視為 plan 變更、**須重跑 ①②**，並以新 canonical hash 送 ① **R4**。② 尚未執行，無既有 Codex Plan approval 需失效處理。

⚠ **census 第 4 列之處置（主動申報 → ① 於 R4 已裁定）**：R3 輪次之 self-review 發現 census **第 4 列**括號內之「次數可由 DLQ 記錄數重建」與同表第 9／10 列相斥；當時依 ① 兩度指示（R2「保留 12 列 census」· R3「不要改 12 列 census」）採**逐字不動**（該時點 census 12 列與 `c3039cbc` byte-identical），更正僅寫於 §11.3.1 表後之三條反證表。**① 於 R4 判為 `GPT-D-ARCH-R4-RR1`（Required）** —— 已證偽之 parenthetical 不得續留 normative row。**已就地更正，處置見 §14.4。**

⚠ **History A／B 客體限定之處置（主動申報 → ① 於 R4 已裁定）**：本輪 self-review 發現 §11.3.1 表後原寫「兩者之終態 durable observable … 不可區分」，若擴及**全部** durable evidence 則與本檔 §10「PSP retry → audit 重放放大」列及 §11.3 之「`safeUserAudit` write path 的絕對冪等姿態」項相斥（🚫 本節**不複述**舉證素材，避免第二份可漂移副本；素材與更正逐條見 §11.3.1 表後之**客體限定段**）。本輪處置＝**就地把客體限定為 `payment_webhook_events` row，並補記 bullet 5 partial 之替代理由三點**；**🚫 未改動 ① 之 `PARTIALLY SATISFIED` 裁定，亦未改動 12 列 census**（**該輪**；其第 4 列 parenthetical 後由 `GPT-D-ARCH-R4-RR1` 更正）。**① 於 R4 裁定 `APPROVED`** —— 應維持此限定，屬**語義精度提升、非撤回 R2 之 architecture ruling**；🚫 不得因 `GPT-D-ARCH-R4-RR1` 之修正而重寫本限定、`PARTIALLY SATISFIED` 裁定或第三殘留之分類（見 §14.4）。

⚠ **① 對流程之裁決（已接受並執行）**：窄範圍對抗式 self-review **不是可選項** —— live Dual Gate 規則要求「修 gate 回饋 → self-review 至一輪 0 新發現 → commit → 才送外部」，本輪無 owner waiver，**機械查證不能替代該前置條件**。R2→R3 期間曾以機械查證代之，本輪依 ① 指定順序執行：修兩處 → 對 `git diff cca8cedf`（送 R4 前之工作區；🚫 **不得寫 `..HEAD`** —— self-review 在 commit **之前**執行，當下 HEAD 尚為 `c3039cbc`、恰好排除本輪修正。族教訓見 `feedback_gate_packet_replay_anchor_head_vs_base`：packet 錨定禁用活指標）之 gate-feedback delta 跑窄範圍對抗式 self-review 至**一輪 0 新發現** → commit → 重建 packet → 送 ① **R4（ultra-narrow）**。


### 14.4 ① R4 之處置（`CHATGPT_ARCH_CHANGES_REQUESTED`，0 Tier-0 Blocker／1 Required／1 主動申報 `APPROVED`／0 新架構方向 finding）

**R4 ultra-narrow 之裁定**：`GPT-D-ARCH-R3-RR1` **CLOSED** · `GPT-D-ARCH-R3-RR2` **CLOSED** · self-review prerequisite **SATISFIED** · **History A／B 客體限定申報**（§14.3）**APPROVED** · **census 第 4 列申報**（§14.3）**REQUIRED CHANGE**（＝ `GPT-D-ARCH-R4-RR1`）。① 本輪未重開 `GPT-D-ARCH-RR1`／`RR2`／`RR4`、R2 已 CLOSED 項、或 `ARCH-D-L1..L5`。

| ID | 內容 | 處置 | 落點 |
|---|---|---|---|
| `GPT-D-ARCH-R4-RR1` | census 第 4 列之 parenthetical「次數可由 DLQ 記錄數重建」已由表後三條反證證偽，卻仍留在 **normative row**，僅靠表後 prose 更正 ⇒ 同一 artifact 內同時包含 `P` 與 `¬P`（**cognition–artifact contradiction**）。<br>⚠ ① 明示：R3 之「不要改 12 列 census」**被極窄地 supersede** —— 該指示保護的是 **12-row census 之集合、transition census 與既有已裁事實**，**不是**要求永久保存後續已證偽的敘述 | 僅改該一個括號句為否定式（採 ① 建議語義）：「⚠ failed 循環次數不可由 DLQ 記錄數忠實重建；見表後三條反證」。<br>🚫 **12 列集合、列數、transition、D1 結果、durable-evidence 主欄與 recovery 主欄一律未動** —— 機械證據（**R4 輪次時點**）：census 區塊對 `c3039cbc` 之 `diff` **恰 1 行**，且差異完全落在該 parenthetical 內。⚠ **R6 後為 2 行**（新增第 9 列，經 `GPT-D-ARCH-R6-RR1` 授權）—— 現行敘述見 §14.6 | §11.3.1 census **第 4 列** · §11.3.1 表後兩處敘述 · §14.2 `R2-RR1` 第 2 列落點欄 · §14.3 `R3-RR1` 處置欄 · §14.3 census 第 4 列申報段 · §14.3 History A／B 客體限定申報段（**census 本體 ＋ 上述 6 個 immutability 宣稱全數同步**） |

⚠ **「12 列 census byte-identical／逐字未動」之全部宣稱已同步失效並改寫**（依 ① R4 第 3 點；族 6 成員逐一處置，🚫 不得殘留任一舊式全稱）。現行精確敘述統一為：**12-row census membership、列數、transition 與 D1 結果未變；僅經 ① 逐次授權之兩個子句更正 —— 第 4 列已證偽之 mitigation parenthetical（`GPT-D-ARCH-R4-RR1`）· 第 9 列之 evidence 措辭（`GPT-D-ARCH-R6-RR1`）**（⚠ 該敘述於 R6 擴充，🚫 不得再引用只含第 4 列之舊版）。

⚠ **「History A／B 客體限定申報」之 `APPROVED` 與 bullet 5 之 `PARTIALLY SATISFIED` 不因本 Required 而動搖**（① R4 第 4 點明示）：History A／B 映射到相同者為 **`payment_webhook_events` current-state row**，**非**全部 durable evidence；承重點仍為「current-state ledger 能證**目前狀態**，不能等價替代 **append-only transition history**；`:256` 已發生 transition 卻無對應 DLQ／audit evidence」⇒ bullet 5 維持 `PARTIALLY SATISFIED` / `PRE-EXISTING DEVIATION`。🚫 **不得**因本修正重寫該申報之客體限定、該裁定、或 §11.3.1 第三殘留之分類。

⚠ **本輪變更之 carve-out 歸屬**：依 **§13.1** 之 carve-out 定義判定（W-1 ＋ W-2；🚫 本節**不複述**該定義、**不枚舉**本輪變更點 —— 複述會產生第二份可漂移副本，枚舉則每輪皆須逐 hunk 維護）。

⚠ **本輪事實**：本輪含 §13.1 carve-out **外**之內容變更 ⇒ 依 §13.1 首句視為 plan 變更、**須重跑 ①②**，並以新 canonical hash 送 ① **R5**。② 尚未執行，無既有 Codex Plan approval 需失效處理。

⚠ **R5 之審查邊界（① 於 R4 指定）**：**只驗 `GPT-D-ARCH-R4-RR1` ＋ self-review prerequisite**。🚫 `R3-RR1`／`R3-RR2`（自 R4 起 CLOSED）與「History A／B 客體限定申報」（`APPROVED`）**不得重開**；`ARCH-D-L1..L5` 繼續 HOLD。`CODING_ALLOWED` 維持 `NOT_GRANTED`；R5 取得 `CHATGPT_ARCH_APPROVED[_WITH_LOCKS]` 前**不送 ②**。

⚠ **① 對流程之裁決（延續適用）**：本輪同樣須先跑窄範圍對抗式 self-review 至**一輪 0 新發現**才 commit。本輪之 self-review 客體＝`git diff 03fc79c7`（送 R5 前之工作區；🚫 不得寫活指標，理由同 §14.3 所引之 `feedback_gate_packet_replay_anchor_head_vs_base`）。


### 14.5 ② Codex Plan Gate R1 之處置（`CODEX_PLAN_CHANGES_REQUIRED`，0 Tier-0 Blocker／5 Required／2 Info）

**② 已實跑通過之 blocking replay**（本檔不複述其命令，僅記結論）：A1–A4 · 四檔三方 blob · index hints · source 零落地 · PLAN `2fe31177…94caf`／`212088` B／`1423` LF／0 CR · `ce7308a5 → 9c49339c` 確為兩個 W-1 儲存格替換 · **ratchet base 實跑 `373 / 14 / 323 / 337`**、`user-audit.ts` 恰 **11** 條 `TS7006`。
⚠ ② 明載：repo 無 TypeScript governance manifest ⇒ 其 `rule_id` 取自全域 fallback、**advisory / not enforced**；且 ② **未**獨立重建未提交之 overlay ⇒ `362 / 13 / 324 / 337` 仍為 CODE-stage 驗收目標，非本輪 committed replay 結果。

| ID | ② 之 finding | 處置 | 落點 |
|---|---|---|---|
| `CODEX-D-PLAN-R1`<br>`GOV-FAIL-001` | §8.4-5 雖規定 0／多重 match 必須 fail，但 §8.5 只記端態 test 之**名稱與結果** ⇒ 「取第一個」或「0 個時跳過」之錯誤實作**今日仍會全綠**（今日 schema 恰一個 CHECK） | 契約補**實作形狀為規範**：全域枚舉候選（`matchAll` 或等價）→ **索引前** `expect(matches).toHaveLength(1)` → 才取 `matches[0]`；🚫 禁 optional chaining／預設值／早退使 0-match 靜默通過。§8.5 receipt 補 (α)(β)(γ)(δ) 四項逐字核 diff（含「`AUDIT_SEVERITY` 只供 5(i)」之 closure 核對）。⚠ 顯式記載殘留：**不做 synthetic 0/2-match negative control**（逾越 §5.2 對 `migrations.test.ts` 之兩處變更點 closure） | §8.4-5 fail-closed 契約段 · §8.5 |
| `CODEX-D-PLAN-R2`<br>`GOV-EVIDENCE-001` | §8.2.2 只證明「某個未 abort 的 signal 被傳入 fetch」；§8.5 漏驗 `setTimeout(() => ctrl.abort(), AUDIT_WEBHOOK_TIMEOUT_MS)` 之**同 controller／同常數**耦合 ⇒ **no-op timer 可通過雙層驗收而完全沒有 timeout**。另「≤ 8000ms」不構成數學上的 wall-clock 上限 | §8.5 新增 **(a2)** 逐字核：`new AbortController()` 恰一處、callback 逐字為 `() => ctrl.abort()`、`setTimeout` 延遲引數逐字為該常數、(b)(c) 綁同一 `ctrl`／`timer`。語義面：改「≤ 8000ms 有界」為「**8000ms 後請求取消**」，並於 §4.6 標軸段立**唯一定義處**，列出三項殘留（timer 排程延遲 · abort→reject 傳播 · **平台實際取消行為本棒未驗證**）。<br>⚠ **當時之「全族 4 處」closure 宣稱不成立**（② `CODEX-D-PLAN-R2-RR2` 於 R2 判定）：該枚舉漏掉「上限／確定性」變體寫法（正文 · **擬落地 code comment** · §10 兩處 · §11 之 Transaction discharge 等）。完整重新枚舉與逐處分類見 **§14.7**；🚫 不得再依處數宣稱本族 closure | §8.5 (a)(a2) · §4.6 標軸段 · §10 重放放大列 · §10.1 殘留欄 · §11.3-4 |
| `CODEX-D-PLAN-R3`<br>`GOV-EVIDENCE-001` | §12 稱 `audit_log` 為 append-only，但 `0017` 檔頭自述不做 trigger 阻擋、且 live code 有 `cron/audit-archive.ts:806` 之 `UPDATE`、`admin/audit/[id].ts:66` 之 `DELETE` | §12 (b) 限定為「**本 PR 之 `safeUserAudit` 寫入路徑只做 INSERT**」，並就地列出兩條 live 更新／刪除路徑座標；另補 **full revert 之殘留**（revert 連同 §4.6 移除 ⇒ 回到無界外呼、`TD-BATCHD-1` 之 `CLOSED_PARTIAL` 失效）。同族順修 §11.3.1 之「**`safeUserAudit` write path 的絕對冪等姿態**」項中「純 append」亦加客體限定 | §12 (b) · §11.3.1「`safeUserAudit` write path 的絕對冪等姿態」項 |
| `CODEX-D-PLAN-R4`<br>`GOV-EVIDENCE-001` | 多處稱 `:256` 之 `processing → failed`「無 audit」，但 `handleOrphan` 已於 `[vendor].ts:224`（DLQ 之前）寫 `payment.webhook.orphan_intent`，本檔**自己**在 §11.3.1 客體限定段亦承認此事 | **當時判定之三處非-census** 改為「**無配對之 transition-completion audit evidence**」，並就地標明該 orphan audit 為 **best-effort 的「開始側」訊號**、DLQ 才是 orphan 之**唯一 strict／required 憑證**。<br>⚠ **該枚舉不完整、closure 宣稱失真**（① 於 R6 判 **PARTIAL**）：History B code block（`無 DLQ／無 audit`）與客體限定段（`無配對 DLQ、無 audit`）之**變體寫法未被當時的 grep pattern 捕捉**。完整處置（含 census 第 9 列之極窄解凍）見 **§14.6** | §10.1.3 缺口 (a) · §11.3.1 反例表 · §11.3.1 殘留表第 3 列 |
| `CODEX-D-PLAN-R5`<br>`GOV-DECISION-001` | (a) 表頭承認 §4.3 fallback 與 §4.6 timeout **皆為** runtime 行為變更，§8.2.2 卻稱 §4.6 是「唯一的 runtime 行為交付物」；(b) §4.6 標軸段承認 timeout 新增 silent-abort 觸發點，§10.1.2 性質欄卻稱 observability 全屬 base、本 PR 不改變 | (a) **兩條 runtime 軸並列**寫進 §4.6：軸 1 §4.6（今日可觀測）· 軸 2 §4.3 fallback 映射（今日可達集合 ＝ ∅，§12 第 2 點）；全族 4 處統一限定為「**唯一今日可觀測的**行為交付物／變更」。(b) §10.1.2 性質欄**區分機制與可達集合**：機制既有、**可達集合因 abort 擴張**，並明記本棒不新增 durable disposition ＝ **owner-accepted tradeoff**、治理承接即本 backlog | §4.6（標軸段 · 三項不變量段）· §8.2.2 · §8.5 · §10.1.2 性質欄 |

**Info（非阻擋）**
- `INFO-1`：§5.2 之 `AUDIT_SEVERITY` import 原述為「type-only 用途…不引入 runtime 相依」為誤 —— 它是 **value import**、於 **test runtime** 被 `Object.values()` 取值（即 §8.4-5(i) 之機械耦合端點本身）。已改為「**無外部副作用、不引入 production-runtime 相依**」。
- `INFO-2`：**② packet 之缺陷、非 PLAN 缺陷** —— packet §1 之 Non-blocking 註記只列最後四個 commit，實際 base→HEAD 有 **13 個 plan-only commits**。重建 packet 時更正（🚫 不寫進本 PLAN：packet 為一次性 artifact，PLAN 不記其編號與內容）。

⚠ **census 第 9 列之處置（主動申報 → ① 於 R6 已裁定 `REQUIRED CHANGE`，處置見 §14.6）**：② `CODEX-D-PLAN-R4` 所指之不精確敘述亦出現於 **census 第 9 列**（`⚠ **僅 row failed —— 無 DLQ、無 audit event**`）。本檔**當時判定之三處**非-census 已改為精確措辭（⚠ **該枚舉不完整** —— 見本節 `CODEX-D-PLAN-R4` 列處置欄之 ⚠ 與 §14.6 之 live family 重新枚舉），**該列依 ① 之凍結逐字不動**（**申報當時**實測 census 對 `c3039cbc` 之 `diff` 仍恰 1 行，即 R4-RR1 之第 4 列 parenthetical；**R6 授權後為 2 行**）。⚠ 此與 `GPT-D-ARCH-R4-RR1` **屬同一形態** —— normative census row 保留一個與本檔他處自述不一致的敘述、僅靠他處 prose 更正。👉 **請 ① 於 R6 裁定是否比照 R4-RR1 極窄地解凍該列之該一子句**（僅該子句；12 列集合、列數、transition、D1 結果、durable-evidence 主欄與 recovery 主欄一律不得藉機改動）。**① 於 R6 之裁定：必須極窄解凍、不得以表後 prose 代替 normative row** ⇒ 已執行（見 §14.6）。

⚠ **本輪事實**：② 之 5 Required 修正**全部落在 §13.1 carve-out 外** ⇒ 依 §13.1 首句為 plan 變更、**須重跑 ①②**。① R5 之 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` **隨之失效**；順序為 **先重送 ① R6 → 再重送 ② R2**（② 於裁定中明示此順序）。

⚠ **carve-out 歸屬**：依 **§13.1** 判定（🚫 本節不複述該定義、不枚舉本輪變更點 —— 複述會產生第二份可漂移副本，枚舉則每輪皆須逐 hunk 維護）。

⚠ **① 對流程之裁決（延續適用）**：本輪同樣須先跑窄範圍對抗式 self-review 至**一輪 0 新發現**才 commit；本輪 self-review 客體＝`git diff 9c49339c`（送 ① R6 前之工作區）。


### 14.6 ① R6 之處置（`CHATGPT_ARCH_CHANGES_REQUESTED`，0 Tier-0 Blocker／2 Required／0 新架構方向 finding／0 新 lock）

**① 對 ② 五條之架構層裁定**：`CODEX-D-PLAN-R1`／`R2`／`R3`／`R5` **ARCH-ACCEPTED**（未改變既有設計方向、未與 `ARCH-D-L1..L5`／History A／B 客體限定／既有 CLOSED 裁定衝突）· `CODEX-D-PLAN-R4` **PARTIAL** · census 第 9 列申報 **REQUIRED CHANGE** · `INFO-1` **REQUIRED CLEANUP**。① 亦確認本檔已正確記載「R5 approval 已因 carve-out 外變更失效、須重走 ①②」。

| ID | ① 之 finding | 處置 | 落點 |
|---|---|---|---|
| `GPT-D-ARCH-R6-RR1` | census 第 9 列與 `:256 ＋ 無 audit` 語義族**必須收斂**。① 明示**不能選「維持 census 不動、由表後 prose 承載」**，故 **R7 無法省略**。證據更直接：normative census 第 9 列仍寫「無 DLQ、無 audit event」，而同一 PLAN 已確認 `[vendor].ts:224` 於 strict DLQ 與 `:256` 前產生 `payment.webhook.orphan_intent` ⇒ 該無限定敘述為假。⚠ 且**問題不只 census**：§11.3.1 前提表已改為正確措辭，緊接之 History B code block 卻仍寫 `failed（:256，無 DLQ／無 audit）` ⇒ **同一區塊內再生 `P`／`¬P`**；§14.5 之「三處非-census 已改」因此**closure 宣稱失真** | **極窄 supersede census freeze**，只更正第 9 列該一錯誤子句（`無 DLQ、無 audit event` → `無 DLQ、無配對之 transition-completion audit evidence`）。**重新枚舉 live semantic family**（🚫 不再依「三處」之預設數量宣稱 closure），逐一收斂為同一 canonical 語義；歷史引文與被反駁之舊字串**不誤改**。§14.5 之失真 closure 宣稱就地更正 | §11.3.1 **census 第 9 列** · §11.3.1 History B code block · §11.3.1 客體限定段 (ii) · §14.5 處置欄與申報段 |
| `GPT-D-ARCH-R6-RR2` | `INFO-1` 之 cognition–artifact drift 未消除：§5.2 同一段落**前半**仍寫「取『一行 **type-only 用途的常數 import**』換……」，後半才說「🚫 不得寫成 type-only import；它是 value import」⇒ artifact 內直接自我矛盾 | 前半舊描述改為「取「一行 **test-runtime value import**」換「C2 carry-forward lock 的實質履行」」；後半「無外部副作用、不引入 production-runtime 相依」與 🚫 護欄保留 | §5.2 |

**live semantic family 之重新枚舉（① `R6-RR1` 明令，🚫 不得再以預設數量宣稱 closure）**
全檔含 `:256` 之行**逐行判定**（**客體＝live normative／factual occurrences**；🚫 **排除 self／meta text** —— 即本節自身之枚舉文字與各處 gate 處置紀錄對本族的轉述，否則 closure 會遞迴包含枚舉段本身〔② `CODEX-D-PLAN-R2` INFO〕。🚫 **不作行數宣稱** —— 該數字隨每次編輯漂移且無機械維持；量測法＝`grep -n ':256' <本檔>` 後依本表之類別欄逐行分派。closure 由**下表逐項具名**承載，非由計數承載）：

| 類別 | 成員 | 處置 |
|---|---|---|
| **live 事實陳述（本輪收斂）** | §11.3.1 **census 第 9 列** · §11.3.1 **History B code block** · §11.3.1 **客體限定段 (ii)** | 全部改為 canonical 語義 |
| **已 canonical（前輪已改）** | §10.1.3 缺口 (a) · §11.3.1 反例表 · §11.3.1 殘留表第 3 列 | 不動 |
| **歷史引文／被反駁字串／不同客體** | §10.1.3 之 🚫 禁令引用「無 audit」· §14.5 對 ② finding 之轉述 · §14.4 引 ① R4 承重點原文「無**對應** DLQ／audit evidence」（已含配對語義）· §14.1 之「`:256` evidence gap」標籤 · §10 之五呼叫點列舉 · census 第 10 列與三條反證 (a)（客體為 **DLQ 有無**、非 audit） | **🚫 不誤改** |

**census 凍結範圍之現況（① 逐次授權，累計 2 個子句）**：對 `c3039cbc` 之 `diff` 現為 **2 行** —— 第 4 列已證偽之 mitigation parenthetical（`GPT-D-ARCH-R4-RR1`）· 第 9 列之 evidence 措辭（`GPT-D-ARCH-R6-RR1`）。🚫 **12-row membership、列數、transition、D1 結果及其餘 evidence／recovery 內容一律未動、亦不得藉機改動**。

⚠ **本修正不改動下列既有裁定**（① `R6-RR1` 明令）：History A／B 仍**只限定** `payment_webhook_events` row · bullet 5 仍為 `PARTIALLY SATISFIED` / `PRE-EXISTING DEVIATION` · §11.3.1 第三殘留仍為 **transition-evidence gap**。本輪只是把「**有 orphan start-side audit、但沒有 transition-completion evidence**」寫準，**不是**把 transition-history gap 關掉。

⚠ **① 對 self-review prerequisite 之立場**：① 接受本檔所附之 `1 → 1 → 1 → 1 → 0` 流程證據為 **prerequisite evidence**，但明示「它表示程序有跑到一輪 0，**不能覆蓋本次外部審查實際抓到的兩個殘留**」⇒ 修完 `R6-RR1`／`R6-RR2` 後**須重做**窄範圍對抗式 self-review 至一輪 0 再 commit。本輪 self-review 客體＝`git diff d6a71a79`（送 ① R7 前之工作區）。

⚠ **本輪事實**：本輪含 §13.1 carve-out **外**之內容變更 ⇒ 依 §13.1 首句為 plan 變更、**須重跑 ①②**，並以新 canonical hash 送 ① **R7**。

⚠ **R7 之審查邊界（① 於 R6 指定）**：**只驗 `GPT-D-ARCH-R6-RR1`／`GPT-D-ARCH-R6-RR2` ＋ self-review prerequisite**。`ARCH-D-L1..L5` 繼續 **HOLD**；先前所有 CLOSED 項與 History A／B `APPROVED` **均不重開**。R7 若 APPROVE，才重送 **② R2**。`CODING_ALLOWED = NOT_GRANTED`，目前不得送 coding。

⚠ **carve-out 歸屬**：依 **§13.1** 判定（🚫 本節不複述該定義、不枚舉本輪變更點）。

---

**送外部 gate 的 packet 紀律**：一律走檔案 + 自帶 body 行數與 sha256；送出前取消編輯器選取（批 C2 曾發生 IDE 選取內容被當附件送出，導致 ④ 收到錯的客體）。

---

### 14.7 ② Codex Plan Gate R2 之處置（`CODEX_PLAN_CHANGES_REQUIRED`，0 Tier-0 Blocker／4 Required／2 Info）

**② 已實跑通過者**（本節不複述命令，僅記結論）：PLAN @ `6d29ca7e` `609cf817…47946`／`237666` B／`1480` LF／CR 0、commit blob ＝ working tree · **① R8 授權鏈成立**（`ad5254ed` 之後的 `3+/3-` 恰位於 line 6／1310–1311 三個 W-1 儲存格 ⇒ 該回填不要求 ① R9）· A1–A4 · 四檔三方 blob · repo-wide index hints · 17 個 plan-only commits · census 12-row membership · `typecheck:ratchet:report` 實跑 `373 / 14 / 323 / 337` · exact-one SQL CHECK · 唯一機械耦合端點 · same-controller/timer receipt · `:256` semantic family · append-only 原誤述 · test-runtime value import。
⚠ ② 明載：repo 無 TypeScript governance manifest ⇒ 其 `rule_id` 取自全域 fallback、**advisory / not enforced**。

| ID | ② 之 finding | 處置 | 落點 |
|---|---|---|---|
| `CODEX-D-PLAN-R2-RR1`<br>`GOV-DECISION-001` | §4.6 標軸段首句仍稱本棒由「純型別收斂」變為 runtime 變更，同一句卻承認 §4.3 早已是第二條 runtime 軸 ＝ R1 要求清除的 pure-type-before-§4.6 殘句 | 首句改為「**本 hunk 新增一條 runtime 軸，並帶來本 PR 唯一今日可觀測之 runtime 變更**」＋🚫 護欄。⚠ ② 之最小修正原文為「§4.6 新增**第二條** runtime 軸」，但本檔既有標號為 (軸 1)＝§4.6、(軸 2)＝§4.3 ⇒ 照字面寫會與下句標號衝突，故採**不帶序數**寫法，🚫 不靜默改寫 ② 原文、隨 R3 packet 呈給 ② | §4.6 標軸段首句 |
| `CODEX-D-PLAN-R2-RR2`<br>`GOV-EVIDENCE-001` | §4.6 已正確否定數學上的 8000ms wall-clock 上限，但正文／擬落地註解／§10／§11 仍反向宣稱「上限」「確定性丟棄」；**§14.5 之「全族 4 處已改」因此不成立** | 見本節之**全族重新枚舉**表（🚫 不再依處數宣稱 closure） | 該表之「成員」欄 |
| `CODEX-D-PLAN-R2-RR3`<br>`GOV-EVIDENCE-001` | §4.6 已承認 timeout 可使原本被截斷而不發生的 `payment_webhook_dlq`／`payment_webhook_events` 寫入成功，§12 卻只處理 `audit_log`／fallback residue，並無客體限定地宣稱殘留量 ∅ | (b) 之 ∅ 論證加**客體限定**（＝§4.3 invalid-fallback 之 audit mapping residue，🚫 不涵蓋 §4.6 軸）；新增 **§12 (c)**：revert 後該等 durable effect **保留、🚫 不得刪除或倒轉**（有效 orphan strict 憑證與 apply-status 事實），數量標 `UNMEASURED`，資料層無需任何動作。⚠ **(c) 之客體於 ② R3 再經更正**（`CODEX-D-PLAN-R3-RR1`：原述兩表 row 皆「由不發生變為發生」，實則僅 DLQ 為新增、event row 為**既有 row 之狀態轉移**）—— 詳 **§14.8** | §12 (b) 4-tuple · **§12 (c)** |
| `CODEX-D-PLAN-R2-RR4`<br>`GOV-DECISION-001` | §10.1.2 性質欄已正確二分「機制既有」vs「abort 擴張 (F-a) 可達集合」，但 §10 殘留欄／§11.2 例外集合／§13 非目標仍無限定寫「base 既有、本 PR 不改變」 | 三處統一改為「**機制** base 既有」＋🚫 護欄＋指向 §10.1.2 性質欄之二分 | §10.1 殘留欄 · §11.2 四件式第 4 項 · §13 非目標 |

**`CODEX-D-PLAN-R2-RR2` 之全族重新枚舉**（🚫 **不作處數 closure 宣稱**；**量測母體＝** `grep -n '上限\|無界\|8000\|確定性' <本檔>` 之命中，**排除 self／meta text**，其餘命中逐行依下表類別分派）

> ⚠ **self／meta text 之判準**（① `GPT-D-ARCH-R9-RR1`；🚫 **判準為種類、非位置** —— 依位置枚舉會再產生一層 closure 問題）：**該命中是對本族之描述／枚舉／gate 處置轉述，而非該族之實例**。依此判準被排除者包括但不限於：**本節全文**（含上表之 finding 敘述與本枚舉表）· **§14.5** 對本族之處置紀錄 · **表頭 gate-state 格**對 `R2-RR2` 之提及。
>
> ⚠ **為何必須排除**：該 grep **亦會命中本節自身**。不排除則 closure 遞迴包含枚舉段本身；🚫「不作處數宣稱」無法解掉 —— 「grep 命中全部依下表分派」仍是**集合完備性 closure**、非計數問題。此為 §14.6 對 `:256` 族已採之同型處方。

| 類別 | 成員 | 處置 |
|---|---|---|
| **需收斂之上限／確定性宣稱** | §4.6「為何納入本棒」段之「外呼皆有上限」· **§4.6 擬落地 code comment 之「外呼上限」** · §4.6 標軸段第 2 點之「確定性丟棄點」· §10 (2a) 列之無限定 bound 敘述 · §10 重放放大列之「8000ms **上限**不在單次 invocation 內累加」· §10.1.2 性質欄之「**確定性**觸發點」· §11.3 Transaction **discharge** 之「外呼皆有 8000ms 上限」 | 全部改為「**8000ms 後被請求取消**」／「未於 8000ms 內完成 ⇒ 經 timer callback 要求取消後 reject」＋🚫 護欄＋指向 §4.6 唯一定義處 |
| **唯一定義處（不動）** | §4.6 標軸段第 1 點 | 保留其 (a)(b)(c) 三項殘留 |
| **已 canonical（查過保留）** | §10.1 根因 (4) 段 · §10 重放放大列首句 · §11.3 discharge 之「由**無界**改為 8000ms 後請求取消」句 | 皆已帶 canonical 措辭＋指向唯一定義處 |
| **客體為 base 或平台限制、非本 hunk 之宣稱（不得誤改）** | §10 「**本棒前**：無 timeout…可無界佔用 Worker wall-clock」（描述 base）· §10 (2a) 之「Worker wall-clock 上限仍可能被其他因素觸及」（客體＝**平台**限制）· §10.1 標題 `TD-BATCHD-1 notifyCritical 無界外呼`（債名）· §12 **(b)** 之 full-revert 殘留句「revert ⇒ 回到無界外呼」（客體＝revert 後狀態） | 🚫 未誤改 |
| **詞形假陽性（🚫 不得改）** | §13.1 之「不**確定性**」（uncertainty；`確定性` 僅為其子字串，與本族無關） | 🚫 未誤改；本類係 grep pattern 之詞形誤命中、**非本族成員** |
| **常數字面量／receipt 逐字核（不得改）** | `AUDIT_WEBHOOK_TIMEOUT_MS = 8000` 之各處引用（含 §11.2 四件式第 4 項）· §8.5 (a)(a2) 之逐字核項 · §8.2.2 之 zero-env 依據 · §13 之 zero-env 根因段 | 🚫 未誤改 |
| **歷史引文（不得改）** | §14.5 對 ② R1 原文「≤ 8000ms 不構成數學上的 wall-clock 上限」之轉述 | 🚫 未誤改；同列之「全族 4 處」closure 宣稱已標為**不成立**並指向本節 |

**Info（非阻擋）**

- `INFO-1`：**② packet（我方送審件）之缺陷、非 PLAN 缺陷** —— 我方 R2 packet 稱「整個 §11.3.1 區塊＝3 行」，實際該 `sed` range 只涵蓋 census 表＋緊接段落；完整 §11.3.1 為 **`23+/13-`**（② 之數字，我方已複驗相符）。census 表格本體恰 2 行之核心證據仍成立。重建 packet 時更正（🚫 不寫進本 PLAN）。
- `INFO-2`：§14.6 之「全檔含 `:256` 之行逐行判定」會**遞迴包含枚舉段自身** ⇒ 已把客體限定為 **live normative／factual occurrences**、明文排除 self／meta text。

⚠ **② 對我方主動申報之兩條殘留的裁定**：`(a) §11.3 末項 ×2`（同句內容錨可定位）與 `(b) 表頭索引漏 §14.5／§14.6`（父節 §14 與 §14 表已有完整索引）**均判非阻擋**，🚫 **不要求為它們單獨重跑 gate**。
⚠ **但本輪已一併修訖**（🚫 **非** Required 驅動 —— 本輪因 4 Required 已必然重跑 ①②，關掉已申報殘留之邊際成本為零，故不走 waiver）：(a) 兩處改為具名「§11.3.1 之『`safeUserAudit` write path 的絕對冪等姿態』項」（原寫法另有節號層級錯誤：該項在 **§11.3.1** 而非 §11.3 頂層）；(b) 表頭索引改為「§14 及其全部子節」（⚠ **當時之範圍值為 `§14.1–§14.7`；🚫 該值非 current-state** —— 現值以**表頭該句為準**，已隨 §14.8 之新增更新，見 §14 表 ① 列之 R11 與 `GPT-D-ARCH-R11-RR1`）。

⚠ **本輪事實**：② 之 4 Required 修正**全部落在 §13.1 carve-out 外** ⇒ 依 §13.1 首句為 plan 變更、**須重跑 ①②**。① R8 之 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` **隨之失效**；順序為 **先重取 ① 對新 hash 之核准 → 再重送 ② R3**（② 於裁定中明示此順序）。⚠ 實際為 **① R9 → ① R10 → ② R3**：R9 判 `CHANGES_REQUESTED`（`GPT-D-ARCH-R9-RR1`，見 §14 表 ① 列），故該前置順延至 R10。

⚠ **① 於 R8 所稱之「不需要 R9」不涵蓋本輪**：該句之適用前提為「後續**只**為記錄 R8 approval 而依 §13.1 回填」；本輪為 carve-out **外**之 plan 變更，前提不成立。🚫 不得援引該句略過 ①。**① 於 R9 已明示認同**：「這次 R9 本身是必要的，不受我 R8『不需要 R9』那句 bookkeeping 限定語拘束」。

---

### 14.8 ② Codex Plan Gate R3 之處置（`CODEX_PLAN_CHANGES_REQUIRED`，0 Tier-0 Blocker／1 Required／2 Info）

**② 已實跑通過者**：PLAN @ `d634ca23` `456859e2…0aa78`／`257362` B／`1534` LF／CR 0、commit blob ＝ working tree · **① R10 授權鏈成立**（`7406bbd5` 之後的 `3+/3-` 全在 §13.1 W-1 三格 ⇒ 不要求 R11）· A1–A4 · 四檔三方 blob · index hints · **20 個 plan-only commits** · `typecheck:ratchet:report` 實跑 `373 / 14 / 323 / 337` · **`R2-RR1`／`R2-RR2`／`R2-RR4`／`INFO-2` 均已閉合** · timeout family 獨立重播為 **31 行＝19 live／11 self-meta／1 詞形假陽性**、無殘留之精確 8000ms wall-clock 上限宣稱 · `event_outbox` replay 之 type-only 收窄／lease/CAS 語義／exact-one parser 契約**未退化**。
⚠ ② 明載：repo 無 TypeScript governance manifest ⇒ 其 `rule_id` 取自全域 fallback、**advisory / not enforced**。

| ID | ② 之 finding | 處置 | 落點 |
|---|---|---|---|
| `CODEX-D-PLAN-R3-RR1`<br>`GOV-EVIDENCE-001` | §12 (c) 之 rollback／durable-state 模型**認錯客體**：把 `payment_webhook_dlq` 與 `payment_webhook_events` **都**描述成 timeout 所「新形成」、由不存在變為存在之 row。live source 顯示 event row 在進入 `handleOrphan` **前**即已 `INSERT OR IGNORE … 'processing'`（`:159-163`）；timeout 後續真正可能**新增**者僅 strict DLQ row（`:243-254`），event row 則是**既有 row** 之 `processing → applied/failed` **UPDATE**（`:256`／`:260` 等）。方向雖仍安全，但不得以錯誤因果模型進入 ③④ | 全族 5 處統一改為**兩軸模型**：**(甲)** DLQ row **新增** · **(乙)** 既有 event row **狀態轉移**（🚫 非新建）；兩者 revert 後皆**保留、不刪除、不倒轉、不補償**；數量**與 (乙) 之 `applied`／`failed` 分布**維持 `UNMEASURED` | §4.6 三項不變量段第 2 項 · §12 (b) 4-tuple 排除句 · **§12 (c)** 標題／主文／兩表 · §14.7 之 `R2-RR3` 列 |

**族枚舉**（🚫 不作處數 closure 宣稱；量測母體＝`grep -n '由不發生變為發生\|新形成' <本檔>` 之命中，**排除 self／meta text**〔判準同 §14.7：對本族之描述／枚舉／gate 處置轉述而非實例〕）

| 類別 | 成員 | 處置 |
|---|---|---|
| **需改（錯誤因果模型）** | §4.6 三項不變量段第 2 項 · §12 (b) 4-tuple 之排除句 · §12 (c) 標題 · §12 (c) 主文 · §12 (c) 首表之 revert 處置列 | 全部改為兩軸模型。⚠ **修訖後 §4.6 與 §12 (c) 之文字仍含「由不發生變為發生」字樣 —— 係置於 🚫 護欄內（「不得混稱為…」）之引用，非殘留之錯誤宣稱**；🚫 重跑量測法者不得據該命中判定未修 |
| **本即正確（🚫 不得誤改）** | **§10 之 (2) 列**：原文為「`markWebhookEventFailed` **未成功寫入**…(2a) 五個呼叫點（`:256` `:262` `:335` `:416` `:468`）**未執行**」—— 客體本即為 **UPDATE 未執行**、非 row 未建立 | 🚫 未動；本輪之修正係使 §12 與 §10 之既有正確模型**對齊** |

**Info（非阻擋）**

- `INFO-1`（PLAN）：§12 之「**分離兩件事**」改為「**分離 code 與 data；data 再分兩軸**」。
- `INFO-2`（**我方 packet 之缺陷、非 PLAN**）：R3 packet §5 稱「涵蓋 4 個 commit」，實為 **3 個**（`af62d7f7`／`7406bbd5`／`d634ca23`；`6d29ca7e` 是 range 起點、不在 range 內）。重建 packet 時更正（🚫 不寫進本 PLAN）。
- ② 另指出：**packet 目錄無版本歷史** ⇒ 我方「39→40 only-add」之宣稱**無法被獨立證明**（② 僅能觀察到 R2 hash 未變、R3 為新檔、無覆寫跡象）。⇒ 後續 packet **🚫 不得再以目錄檔數作為 only-add 之證據**，改以「前輪 packet 檔之 sha256 未變」承載。

⚠ **本輪事實**：`CODEX-D-PLAN-R3-RR1` 之修正落在 §13.1 carve-out **外**（§4.6／§12／§14.7／新增 §14.8）⇒ 為 plan 變更、**須重跑 ①②**。① R10 之 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` **隨之失效**；② 明示順序為 **修正 → self-review 至一輪 0 → commit → 重取 ① 對新 hash 之核准（＝① R11）→ 回填 → 送 ② R4**。

---

## 15. ③ Codex Code Gate receipt（append-only · evidence-only · non-normative）

> **性質硬約束**：本節為**證據**紀錄，**非規範**。本節任何內容**不得**修改 §1–§13.1 的任何鎖、allowlist、量化目標或裁決；若 ③ 的回饋要求改變上述任一項，**不得**寫進本節，必須回 `PLAN_DRAFT` 並重跑 ①②。
>
> 僅允許 **append**，禁止改寫既有條目。
>
> ⚠ **例外（與 §13.1 W-2-2 對接）**：本節的兩處**佔位文字** —— 「_（佔位：③ 尚未執行…）_」與「④ …載體待 owner 於 ④ 核發時指定」 —— **不屬「既有條目」**，於對應 gate 核發時得**取代**之（適用範圍：僅該二句；生效時態：對應 gate 核發時；例外集合：∅；closure：本節除該二句外全部內容仍受 append-only 約束）。

### ③ Codex Code Gate receipt — `CODEX_CODE_APPROVED` @ `1a416946`（2026-08-12）

**裁決**：`CODEX_CODE_APPROVED`，**0 Blocker／0 Required／3 Info（皆 packet-only、非 code）**。受審客體 `1a416946f47e914a71b066a5d9251c318f536db7`。

**③ 實跑複驗通過者**：9 檔完全符合 allowlist · `D_EXCLUDES` 0 命中 · tracked working tree／index 乾淨（僅既有 `?? CLEANUP_PLAN.md`）· `lint` · `typecheck:ratchet` `362 / 13 / 324 / 337`（baseline `1119 / 175`）· forced TS delta `373 → 362`（`REMOVED 11`／`ADDED 0`）· `test:cov` 25 files／740 tests（Statements 90.34%）· `test:int` 77 files／1385 tests · `verify:browser-pipeline` · `build:functions` · `npm audit --omit=dev --audit-level=high` 0 vulnerabilities · `lint:migrations`／`lint:handlers`／`lint:archive-no-delete` · `replay.ts` emit 3383 B／SHA-256 相同／byte-identical／stderr 0。
⚠ ③ 明載：repo 無 `governance/rules.json` ⇒ 其引用之全域 rule ID 皆 **advisory／not enforced**。

**逐面裁定**：**Critical Risk** 未發現新增之安全／授權／tenant isolation／payment correctness 風險 · **State Consistency** `AUDIT_SEVERITY → AuditSeverity → parseAuditSeverity` 單一衍生鏈成立，fallback／row-cold_class parity／`parsed === 'critical'` gate 皆與 PLAN 一致，端態 schema 之 `matchAll → toHaveLength(1) → index` fail-closed 解析與雙向 set equality 通過 · **Queue** DLQ replay 僅 type import／annotation，CAS／lease／retry／replay 狀態語義未變、emit byte-identical · **Payment** `[vendor].ts` 恰一 hunk，四例落庫與 base 等價，驗簽／dedupe／DLQ／state machine 未觸碰 · **Distributed State** controller／timer／constant／signal／`finally` 耦合正確，abort rejection 由既有外層 catch 承接、不阻斷後續 durable flow · **Observability** 非法值 log 不含 raw severity，既有 webhook 無 retry／非 2xx 不檢測／缺 URL 與 abort 無 durable disposition **仍屬已揭露 backlog、未被誤宣告為已解決**。

**③ 對我方兩處實作偏離之裁定**：**均接受** —— (1) helper 之 typed env 參數係「讓正反案例使用**相同 webhook 注入條件**」所必需；(2) 直接讀 `fetchMock.mock.calls` 與 `vi.mocked(fetch)` 在此載體等價。

**③ 確認之殘留風險（PLAN 已接受者）**：8000ms abort 分支與 Cloudflare 平台實際取消行為**未動態驗證**。

**3 Info（`GOV-EVIDENCE-001`，advisory；皆為我方 packet 之證據瑕疵、🚫 非 PLAN 客體、無 code 修正需求）**：

| # | 內容 | 處置 |
|---|---|---|
| 1 | ③ packet 之 commit 鏈漏記 `631d1c48`。live 鏈為 `e6c6a2ed → 631d1c48`（② R4 approval 之 W-1 回填）→ `7f268680`（owner 授權之 W-1 回填），**兩次皆在 W-1** ⇒ 授權鏈無風險，殘餘僅 packet 歷史不完整 | 後續 packet 補列完整鏈 |
| 2 | ③ packet **實際未列**「前輪三檔 SHA-256」（我方於對話宣稱已列，實為終端量測未寫進 artifact）⇒ 該 packet 無法單獨證明 only-add | 後續 packet **必實際寫入** artifact |
| 3 | ③ packet 把 32-hex `bb6fc60d…3fdd` **標為 SHA-256** —— **標籤誤用成立**（SHA-256 為 64-hex，該值係 `cut -c1-32` 之截斷）。⚠ **TECH-DEBT 行兩端逐字相同之結論不受影響**（③ 獨立複驗確認）<br>⚠ **我方複驗後之更正（🚫 不照抄 ③ 之數值）**：③ 稱正確值為 `c5141fda…3b48`，但我方實算得 `bb6fc60d…1c14`。逐一測試變體後查明**二者雜湊之輸入不同、皆非錯誤**：`c5141fda…3b48` ＝ **含縮排、去尾換行**之原始行；`bb6fc60d…1c14` ＝ **去縮排後**之行（即我方原截斷值之完整形）。⇒ 逐字相同之結論在**兩種正規化下皆成立**；殘餘僅「32-hex 被標為 SHA-256」之標籤瑕疵 | 後續 packet 列**完整 64-hex** 且**明標正規化方式**（去縮排 vs 含縮排），🚫 不截斷 |

⚠ **此 3 Info 與我方於 ② R2／R3／R4 及 ① R9／R11 packet 所申報者同屬一族：packet 之機械宣稱未寫出範圍、證據形式不成立或 digest 失準。** 本 PR 內已第四次發生。

**下一道**：④ ChatGPT faithfulness ＝ `NOT_RUN`。🚫 本核准**不授權** merge／push／deploy。

---

### ④ ChatGPT faithfulness Gate receipt — `CHATGPT_CODE_FAITHFULNESS_APPROVED` @ source `1a416946`（2026-08-12）

**裁決**：`CHATGPT_CODE_FAITHFULNESS_APPROVED`，**0 Blocker／0 Required／0 plan-architecture side-finding／1 packet-only Info**。**source faithfulness anchor ＝ `1a416946`。**

**④ 之總結論**：實作**忠實實現 ①② 核准之方向**；**未發現「機械 gate 全綠、但實際做成另一件事」之 drift**；9 檔 source diff 之 production／test surface 與 PLAN allowlist 對得上。

**四個指定方向點之裁定**：

| # | 方向點 | 裁定 |
|---|---|---|
| 1 | §4.6 是否被寫成「已解決」 | **PASS** —— 實作只把 wall-clock 軸收斂（`AbortController → setTimeout(…8000) → ctrl.abort() → signal → finally clearTimeout`），source comment 明寫「**非精確 wall-clock 上限**」，TECH-DEBT 保留 retry／`await` 同步等待／投遞失敗零可觀測性三項未解 ⇒ **未把 `TD-BATCHD-1` 偷平化成完整 CLOSED**，亦未隱藏告警投遞擴張與殘留風險 |
| 2 | §4.3 二分是否被寫成「等價但語義不同」 | **PASS** —— production 明確為 `entry.severity === undefined ? 'info' : parseAuditSeverity(...)`，**非** `== null`；`null + security_signal` integration 案存在並斷言 critical／security_critical／invalid log 恰一次／無 audit-loss／`fetch` 0 次 ⇒ 省略側與 `null` 側**未被語義近似寫法合併** |
| 3 | scope creep | **PASS**（④ 獨立逐檔看完整 patch）—— production 恰 4 檔、tests/fixture 恰 5 檔；`[vendor].ts` **恰一個 default unified-diff hunk**（⚠ 量測形式依 ④ 原文標定 —— `INFO-④-1` 正為未標此形式而發）且只有 `user_id` number narrowing；`replay.ts` 只有 type import ＋ 參數型別；`user-audit.ts` 變更全部可歸三組。**無夾帶** webhook 驗簽／dedupe／DLQ／payment state-machine rewrite／production migration／Env surface 擴張。④ 特別指出：**金流高風險面未出現「藉 `[vendor].ts` cascade 順手修其他東西」** |
| 4 | 兩處字面偏離 | **兩者均 `ACCEPTED / FAITHFUL`** —— (a) helper env 由閉包改參數**未改變測試意圖**，反而使非法案例之 `fetch = 0` 能與合法 critical 之正向控制置於**同一 webhook-enabled 條件**下，屬「為滿足 PLAN 更高階 load-bearing requirement 之局部形狀調整」；(b) `fetchMock.mock.calls[0][1]` 與 `vi.mocked(fetch)` 讀取**同一 call record**（`stubGlobal` 綁的即該 function reference），兩個 signal assertion 仍執行 ⇒ **未削弱偵測力** |

**④ 另確認之 schema／domain-drift 方向**：runtime `AUDIT_SEVERITY` 與衍生 type 已落地；migration full-forward test **先 `matchAll` 全域枚舉、再於索引前 `toHaveLength(1)`、之後雙向 set equality**，三合法值與 `PANIC` 另以獨立 runtime INSERT 驗證 ⇒ **保持 PLAN 之「fail-closed cardinality ＋ runtime supplement」，未退化成 presence regex 或套套邏輯之自我比對**。

**`INFO-④-1`（packet-only，非阻擋；🚫 不要求改 source、不要求重跑 ①②③④）**：④ packet §4.3 之「`user-audit.ts` **13 個 git hunk**」**未標量測形式**。附檔採一般 context（`-U3`）顯示為 **7 個 hunk header**；依 **zero-context（`-U0`）** 切開不相鄰 change group 則確為 **13 組**。我方已複驗兩值皆成立（`-U0` ＝ 13、預設 `-U3` ＝ 7、附檔內該檔 hunk header ＝ 7）。⇒ 非 source／faithfulness finding，亦非「13 算錯」，僅**母體／正規化未標**。
⚠ ④ 明示此為**同族之第五次**（前四次：② R2／R3／R4 · ① R9／R11 · ③），建議後續一律寫成「`user-audit.ts`：`git diff -U0` 下 13 hunks；本附檔採一般 context 顯示為 7 hunks」形式。

**⚠ 族處置（我方自審補正，非 ④ 所指）**：本節**上方之 ③ receipt** 內「**Payment** `[vendor].ts` 恰一 hunk」**同樣未標量測形式**。🚫 **不改寫該既有條目**（§15 首段：「僅允許 append，禁止改寫既有條目」；兩處佔位例外均已消耗）⇒ **以本 append 更正**：`[vendor].ts` 之 hunk 數為 **`git diff -U0` ＝ 1、預設 `-U3` ＝ 1（form-independent）** ⇒ 該處數值本身不受量測形式影響、結論不變，殘餘僅與 `INFO-④-1` 同型之**標籤**瑕疵。

**🚫 `MERGE_ALLOWED` 不得由本 ④ 裁決自行推導**（④ 明文）。四道外部審查與 owner `CODING_ALLOWED` 皆已通過後，**squash-merge 仍須 owner 另行授權**。

**④ ChatGPT faithfulness 之處置**：**載體已由 ④ 於核發時指定 ＝ 本節（§15）之 append ／既有佔位取代，🚫 不另開 closeout PR**（④ 理由：§15 已明確允許 ④ 核發時取代該佔位，且本 plan doc 尚會隨本實作 PR 一併合入，此時另開 closeout PR 無收益）。⚠ 本句原佔位文字為「載體待 **owner** 於 ④ 核發時指定」；實際由 **④** 指定，與本段下述「不需另開 docs-only closeout PR」之預期一致，owner 未另行指定相異載體。**closeout 適用性**：本檔自 SPEC 起即在 allowed changed-files 內（§5.3），故 plan doc 隨實作 PR 一併合入，**預期 merge 即 `CLOSED`，不需另開 docs-only closeout PR**；若 ④ 產出需落在合入後，則依 Dual Gate v3.1 2026-07-18 amendment 標 `GOVERNANCE_CLOSEOUT_PENDING` 並開 closeout PR。

---

## 16. 維度 A 自審軌跡

**彙總式自審軌跡**（逐條 findings 清單、處置對照表、輪次統計）**不落在本檔** —— 依 Dual Gate v3.1 之報告規格，落在**中文 6 欄報告第 4 欄**（self-review findings 與修正），並隨 packet 送 ①。

適用範圍：本檔；生效時態：即刻；**例外集合：就地附於規範條文、用以支撐該條文存在理由之來源註記**（如 §3 OD-D4 列與 §9.1 的 SPEC delta 聲明，兩者各帶一個 round 1 finding 編號；以及各節 🚫 護欄句中「此誤已發生過」之陳述；**以及單點、就地、與具體 ① 指示直接綁定之 gate 申報與 ① 流程裁決紀錄** —— 其 provenance 為 self-review，但**形態為單點申報**，故不落入本節禁令之**彙總式**客體；列為例外係為把邊界寫死。🚫 **不得**為逐條 findings 清單／處置對照表／輪次統計；🚫 不得以「主動申報」為名重新引入被禁之彙總形態。）；closure：本檔不另設自審軌跡章節。

> **為何不在本檔留摘要**：plan doc 的規範內容應可由 ①②③④ 就本檔文字直接複核；自審過程之敘述無此性質，留在本檔只會增加需被複核的非規範文字。正文所需的**前瞻性護欄**（「🚫 不得再寫成 X」）已就地保留於各節，不依賴本節。

---
