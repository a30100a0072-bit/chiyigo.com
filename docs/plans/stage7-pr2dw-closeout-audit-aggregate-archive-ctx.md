# Stage 7 PR-2dw — 批 A：aggregate-archive cron handler ctx 標型（治理 closeout）

**SPEC**: `PR-2DW-CLOSEOUT`（決策全文見 §10）
**級別**: `L1`（docs-only、零 runtime）
**subject-PR**: #149 — Stage 7 PR-2dw 批 A（merge commit `6aae95704cc151061cad0a05966d43f0d28c0eea`）
**subject-base**: `32810f9eb3bf1119c3ebc7a3a02b12058556b924`（批 A 的 IMMUTABLE-BASE）
**closeout-base**: `6aae95704cc151061cad0a05966d43f0d28c0eea`（本 closeout PR 之 base）
**狀態**: 見 §10.4 Gate 進程紀錄

> ⚠ **BYTE-FROZEN CARVE-OUT**
> **凍結錨點**：本檔 **抬頭與本 carve-out 區塊（除 `**狀態**` 行）＋ §0 → §10.3
> 自 CODE-stage 首個 commit 起逐 byte 未改**；
> **該 commit 之 SHA 記於 §10.4 dated log**（§10.4 屬可變面，故記錄動作不破壞凍結）。
> 〔涵蓋範圍刻意寫全，避免 §0／抬頭其餘欄位落入「既非凍結亦非可變」的第三類。〕
> 〔⚠ **不 inline 寫 `CODE-SHA` 佔位符**：carve-out 區塊自身已納入凍結區，
> commit 不可能包含自身 SHA，而由後續 commit 回填則會改動凍結區 → **結構上不可填**。
> 此與 §9 註「雜湊無法記於自身內部、但記於**另一檔案**毫無障礙」為同一自我指涉原理；
> 解法一致：把值移到**可變面**（§10.4）而非凍結區。〕
> 〔⚠ **不使用「Plan Gate approved SHA」作錨點**：本 PR 的 gate state 明定
> `CODING / branch / commit / push = NOT_ALLOWED`，doc 於 Plan Gate 核准時**只存在於 PLAN §8 之內、
> 無任何 repo SHA**。沿用既有 plan doc 的措辭會產生**填不出值、無法複驗**的錨點。〕
>
> **可變面（明確界定，較既有先例為寬，已向 closeout ① 揭露）**：
> (a) 抬頭 `**狀態**` 行；(b) **§10.4 Gate 進程紀錄**（正文最末節，非 header）。
> 〔本區塊所有 gate 符號皆指 **closeout PR 自身**之四道，非批 A。〕
> 〔既有先例（`stage7-pr2dt-…md:4`）只允許狀態行變動；本檔把可變面擴大到一個正文區段，
> 理由＝**dated gate log 須依序追加 closeout ①／②／③ receipts；④ 及其後之終局 receipt 僅進 squash commit body，本 doc 不再續寫。**
> **此擴大已於 Plan Gate 明示提交 closeout ① 評估，其裁決記於 §10.4。**〕
> 〔循環風險：若「記錄 **closeout ③** verdict」的 commit 改動了 **closeout ③** 審過的內容，依 SHA 不變式會 invalidate 之。
> 凍結區（抬頭與 carve-out 區塊除狀態行 ＋ §0→§10.3）涵蓋全部受 **closeout ③** 審查之實質內容，故 §10.4 續寫不觸發 invalidation。〕

---

## 0. 本檔是什麼

批 A（PR #149）的 **Dual Gate 軌跡持久保存**。

批 A 的 `ARCH-A1`（scope 恰 2 檔 2 行）＋ `ARCH-A7` 把 scope 凍死，
導致其 plan doc **進不了 PR #149**（實測 changed-files 恰 2 個 `.ts`）。
依 Dual Gate v3.1 §7 AMENDMENT 2026-07-18 規則 2，ship 後另開 docs-only closeout PR 補記軌跡。

**本檔為主載體**：決策、來源分類、anchors、tree equality、packet 處置條件皆在此自足保存。
本 closeout PR 的**終局 gate receipt** 另存於其 squash commit body（雙載體分工）。

---

## 1. Anchors（完整 OID，不縮寫）

| 錨點 | OID |
|---|---|
| **subject-base**（批 A 的 base） | `32810f9eb3bf1119c3ebc7a3a02b12058556b924` |
| **reviewed commit**（③ 審查標的） | `32fec8a46299da2d04f8f9f65bd565bbe85a2cd9` |
| **merge commit**（squash 進 main） | `6aae95704cc151061cad0a05966d43f0d28c0eea` |
| **tree**（reviewed 與 squash 共同指向） | `30858c7e6e7bb8e1e3298627c6b45b6b57293034` |
| **PR** | #149，head branch `stage7-pr2dw-batcha`（已於 squash 後刪除） |

⚠ **`32fec8a46299da2d04f8f9f65bd565bbe85a2cd9` 目前不被任何 ref 可達**
（`git for-each-ref --contains` 空、`git name-rev` 回 `undefined`），**可能被 `git gc` 清除**。
其 tree `30858c7e6e7bb8e1e3298627c6b45b6b57293034` 經 merge commit **永久可達**，
故等值性可用**不依賴 reviewed commit** 的方式複驗：

```bash
git rev-parse '6aae95704cc151061cad0a05966d43f0d28c0eea^{tree}'
# 期望 30858c7e6e7bb8e1e3298627c6b45b6b57293034
```

---

## 2. 四道 gate verdict ＋ 來源分類

**來源類型**（三類，為 provenance 類型，非可信度排序）：
`VERBATIM_EXTERNAL_REPLY`（外部逐字原文）／
`CONTEMPORANEOUS_TRANSCRIPTION`（審查當時之轉述）／
`RETROSPECTIVE_RECONSTRUCTION`（事後回憶／重建）。

> 🔑 **符號約定（全檔適用）**：**`①②③④` 專指批 A 之四道 gate**（下表定義）。
> 涉及**本 closeout PR 自身**四道時，一律寫「**closeout ①**」「**closeout ③**」等限定形式。
> **例外（不在此限）**：(i) **不作條列序號用**（條列改 `(1)(2)(3)`）；(ii) `## 9` receipt 表之 **packet 編號**（① ↔ `01-…md`…④ ↔ `04-…md`，與批 A 四道一一對應）；(iii) **引述上游原文**時保留原字面。
> 〔⚠ 二者若混用，讀者會把「避免 invalidate ③」誤解為批 A 的 ③（早已完成、結構上不可能被 invalidate），
> 而真正會被 invalidate 的是 **closeout 自己的 ③**。〕
>
> ⚠ **來源欄逐項綁定「該項內容」而非「整道 verdict」** —— 同一道 gate 的不同細節可能落在不同載體。
> 混寫會使可變載體的內容被誤認為已受 repo-immutable 保護（進而在 packet 刪除差集上開洞）。

| 道 | verdict 核心（載體 A：merge commit body，repo-immutable） | verdict 細節（載體 B：**逐列標明**，皆可變） | 核發事實 | 錨點（完整 OID） | 來源類型 | 原文存續 |
|---|---|---|---|---|---|---|
| ① | `CHATGPT_ARCH_APPROVED`；`Q1=(c)`；**頒 `ARCH-A1..A11`** | finding 計數 `0 Critical／0 Required／1 non-blocking`〔載體＝gate packet `04-chatgpt-faithfulness-stage7-pr2dw-batchA.md:24`〕 | ✅ 已確認 | `32810f9eb3bf1119c3ebc7a3a02b12058556b924` | `CONTEMPORANEOUS_TRANSCRIPTION` | `unavailable` |
| ② | `CODEX_PLAN_APPROVED`；`r1/r2 reject -> r3 approve`；`A4 working-tree anchor + hash-object 加固` | 各輪 finding 計數：r1 `1 blocking + 2 required`〔載體＝`02b-codex-plan-delta-stage7-pr2dw-batchA.md:14`〕／r2 `1 blocking + 1 required`〔載體＝`02c-codex-plan-delta-r3-stage7-pr2dw-batchA.md:12`〕／**r3 無 finding 計數紀錄**（r3 之核發本身見載體 A `r1/r2 reject -> r3 approve`；全六 packet 與 memory 皆未載 r3 計數） | ✅ 已確認 | `32810f9eb3bf1119c3ebc7a3a02b12058556b924` | `CONTEMPORANEOUS_TRANSCRIPTION` | `unavailable` |
| ③ | **無**（merge body 未記 ③） | `CODEX_CODE_APPROVED`、`0 blocking／0 required／0 Tier 0`〔載體＝gate packet `04-chatgpt-faithfulness-stage7-pr2dw-batchA.md:26` 之交叉陳述；⚠ **③ packet（`03-…md`）本身為送審前請求包、結構上不含 verdict**〕 | ✅ 已確認（owner 裁決） | `32fec8a46299da2d04f8f9f65bd565bbe85a2cd9` | `CONTEMPORANEOUS_TRANSCRIPTION` | `unavailable` |
| ④ | **無**（merge body 未記 ④） | `CHATGPT_CODE_FAITHFULNESS_APPROVED`；否決「永久靠本機 packets 當軌跡 SoT」；裁定另開 docs-only closeout PR ＋ 修改後續批 lock 模板；更正「三輪 reject」措辭〔載體與 amendment 滅失影響 → **詳見 `## 2.3`**〕 | ✅ 已確認（owner 裁決） | `32fec8a46299da2d04f8f9f65bd565bbe85a2cd9` | `RETROSPECTIVE_RECONSTRUCTION` | `unavailable` |

⚠ **載體 B 欄之全部內容，於獨立複核前一律計入 `unique evidence set`**（見 §9.1）。
**但載體並非全部為 gate packet** ——
- ①②③ 之載體＝`~/Desktop/chiyigo-packets/` 之 gate packet → **受 owner 裁決 6 禁刪保護**；
- ④ 之載體＝**Dual Gate memory 檔** → ⚠ **不在裁決 6 的 7 檔範圍內、無任何保留規則，且 memory 依專案規則可直接改寫**。
  → ⚠ **但 ④ verdict 內容已於本表 ④ 列完整轉錄** —— closeout **一旦合入即取得 repo-immutable 載體**，
    屆時 memory 之改寫**不再構成證據滅失**。
    **合入前**之唯一載體風險，由本 PLAN §8 草稿 ＋ §9.2 窗口 1／2 之凍結規則承擔。
    〔⚠ 不納入 §9.1 差集清單：該機制為 **packet-scoped 且處理「刪除」風險**，
    memory 檔非 packet、其風險為**靜默改寫**，屬類別錯配。〕

### 2.0 原文回收嘗試紀錄（owner 裁決 2 之 `(a)` 半）

裁決 2 為 **`(a)+(b)`**：`(a)` 盡力找回原始回覆 ＋ `(b)` repo 內自足保存。
本欄記錄 `(a)` 的執行結果，**不得以 `(b)` 已完成為由略過**。

| 道 | 已檢索途徑 | 結果 |
|---|---|---|
| ① | merge commit body · 六個 gate packet 全文 · repo 全樹 grep | 僅得轉述，**未得逐字外部回覆** |
| ② | 同上（另含 `02b`／`02c` delta packet 之 r1/r2 引述） | 同上 |
| ③ | 同上 | 同上 |
| ④ | 同上 · Dual Gate memory §7 AMENDMENT | 同上 |

**尚未窮盡之途徑**（⚠ 取得原文後之正確處置見下方 carve-out 約束——**不得改寫本節**）：
owner 端之 ChatGPT／Codex 對話歷史匯出。
→ 現況四道皆標 `unavailable`；**取得原文後可升級，但在此之前禁止升格**。

> ⚠ **升級路徑受 carve-out 約束（分時規則；ARCH-RR3-2）**：本節位於**凍結區**，**任何時點皆不得直接改寫本節正文**。
>
> **(1) closeout ④ 之前，且原文與現有記載無實質差異** →
>     可於 `## 10.4` **append receipt**（記「已取得 ①／②／③／④ 之某道原文，
>     來源類型由 `RETROSPECTIVE_RECONSTRUCTION`／`CONTEMPORANEOUS_TRANSCRIPTION`
>     升級為 `VERBATIM_EXTERNAL_REPLY`」）；**禁改 §2 正文**。
>
> **(2) closeout ④ 之後（含 merge 後）** → **一律另開 doc/PR，走完整四道**；
>     **禁再修改本 doc 或 `## 10.4`**（append 亦禁 —— 會破壞 ④ 之最終 SHA／blob 凍結）。
>
> **(3) 任一時點，若原文與現有記載有實質出入** → **一律另開 doc/PR，走完整四道**，
>     **禁止**只以 `## 10.4` append 處置。
>
> ⚠ **適用四道全部**（`## 2.0` 記錄的是①②③④**皆** `unavailable`），非僅批 A 之 ④。
> ⚠ **禁止**以「只是 append」為由在 ④ 後改動本 doc —— 那會破壞 ④ 之最終 SHA／blob 凍結。

### 2.1 誠實聲明

- **四道核發事實均已由 owner 確認**（③④ 錨定 `32fec8a46299da2d04f8f9f65bd565bbe85a2cd9`）。
  **原文缺失本身不推翻已確認的 gate verdict。**
- 目前**四道皆無 `VERBATIM_EXTERNAL_REPLY`**。
- **③④ 之逐字 repo 載體：機械掃描未找到。** merge commit body 僅留 ①② 之狀態摘要。
  〔此為**保存缺口**，**不是**未核發、**不是**未授權 merge。〕
- **來源獨立性為零**：四道之轉述皆出自同一 Claude session／owner；
  「多處一致」只能排除傳抄漂移，**不構成獨立佐證**。
- 🚫 **禁止**把 packet 轉述或事後回憶**升格**為原文。
- 🚫 **owner 裁決 1 措辭禁令**：本節及全檔述及 ③④ 之 repo 載體時，須寫「**機械掃描未找到 repo 載體**」，
  **禁**寫「**從未存在**」等無法證明的全稱句。〔此為 owner 裁決，非本 doc 自訂措辭偏好。〕

### 2.2 掃描依據（可複驗）

merge commit `6aae95704cc151061cad0a05966d43f0d28c0eea` body 之 gate 段落**逐字**（含原始換行；
`git log -1 --format=%B 6aae95704cc151061cad0a05966d43f0d28c0eea` 第 20-22 行）：

```
Plan Gate 兩道全過：(1) CHATGPT_ARCH_APPROVED（Q1=(c)、頒 ARCH-A1..A11）·
(2) CODEX_PLAN_APPROVED（r1/r2 reject -> r3 approve；A4 working-tree anchor +
hash-object 加固）。ARCH-A9 base 錨定 32810f9e。無 D1 migration、無 cache-bust
```

> ⚠ 第 22 行的 `ARCH-A9 base 錨定 32810f9e` 是 **ARCH-A9 base 錨點在 repo-immutable 載體中的唯一佐證**，
> 故本引用**不得於此截斷**。

---

### 2.3 ④ 之載體與 amendment 滅失影響（分支判定）

**載體**：Dual Gate memory `feedback_codex_review_workflow` §7 之 `📌 AMENDMENT 2026-07-18` 段落
（該檔 167-183 行；⚠ **memory 可改寫、行號會漂**），**非** gate packet ——
`04-chatgpt-faithfulness-stage7-pr2dw-batchA.md:196-197` 僅載該裁定之**選項字母 (c)/(d)**，不含 verdict。

⚠ **本 doc 不保存 amendment 全文，但 `## 9.0.2` 已保存全部 load-bearing 條文**（ARCH-R3 落修後之現況；
舊版寫「不宣稱保存 amendment 原文」係 `## 9.0.2` 尚未建立時之陳述，已過期）。
以下為**節錄範圍**之精確界定：`## 7.1`(ii) **尾句**（「須另立 `H0b` 或進 Gate 前重新裁決」）為逐字；
`## 9.1`／`## 9.2` 之語彙（`DELETE_ALLOWED`／`unique evidence set`／`104 KiB` 等）**出自 owner 裁決 6、非 amendment**
（該三詞於 memory 檔 grep 皆為 0）。

→ **amendment 之「全文」保存不在本 doc 範圍內**（scope 界定）；
但其**全部 load-bearing 條文已由 `## 9.0.2` 逐字保存**，**歷史 provenance 因此可複驗**。
⚠ 據此，amendment **全文**不屬 `## 9.1` 差集 (A) 之標的；**load-bearing 條文則已 repo-covered**。

**amendment 滅失之影響須分支判定（⚠ 不可一概而論）**：

| 分支 | 約束 | 權威來源 | 滅失影響 |
|---|---|---|---|
| **(a)** | packet 刪除相關 | **owner 裁決 6**（＋ `## 9.0.1` `OR-2`） | 無 —— 已由 `## 9.1`／`## 9.0.1` 逐字獨立承載，**不依賴** memory |
| **(b)** | 批 A 狀態標記（`CODE_SHIPPED / GOVERNANCE_CLOSEOUT_PENDING`、不得宣稱 CLOSED） | ✅ **已轉為 `## 9.0.1` `OR-1`**（owner 2026-07-19 重新核發；合入後取得 repo-immutable 載體）。**滅失影響已完全消解**：**現行效力**由 `OR-1` 承擔、不受影響；**歷史 provenance** 由 `## 9.0.2` 逐字節錄承擔、不受 memory 靜默改寫影響 | **實質條文**已由 `## 9.1` 末段與 `## 10.4` 載明且可執行；**授權來源之可複驗性亦已由 `## 9.0.2` load-bearing 逐字節錄封住**（舊版此處寫「amendment 滅失後該授權來源將不可複驗」，係 `## 9.0.2` 建立前之陳述，**已為假**、已更正 —— ARCH-RR2-2） |

〔⚠ 早期版本此處曾寫「約束之權威來源是 owner 裁決 6」為**過度概括**，且與 `## 9.2` provenance 分層直接矛盾
—— 正是本 doc 建 provenance 分層所要防的**鏡像同型錯誤**。〕

---

## 3. Plan Gate 歷史（**正確版本**）

**三輪審查：R1 reject、R2 reject、R3 approve** ＝ **兩次** reject。

🚫 **禁**寫成「三輪 reject」（易被誤讀為三次拒絕）。

| 輪 | 結果 | 內容 |
|---|---|---|
| r1 | `CODEX_PLAN_APPROVED = NOT_GRANTED`（1 blocking + 2 required） | blocking `GOV-FAIL-001`：replay anchor 只檢查 committed state，working-tree 偷跑可 false-pass → 新增 **A4 anchor**（`git status --porcelain=v1 --untracked-files=all -- functions/`；⚠ **pathspec `-- functions/` 為契約一部分**，省略會把語意由「`functions/` 零 drift」擴成「全樹零 drift」） |
| r2 | `CODEX_PLAN_APPROVED = NOT_GRANTED`（1 blocking + 1 required，皆 cross-reference 不同步） | packet EOF 提醒仍寫「以 A1/A2/A3 為 blocking」，與 §0 之四條 anchor 衝突 → 依其操作會漏跑 A4，重新打開 false-pass |
| r3 | ✅ `CODEX_PLAN_APPROVED` | cross-ref 修正 ＋ 主動採納 r2 建議：A3 加 `git hash-object` 直讀 working bytes（不受 `assume-unchanged`／`skip-worktree` index hint 遮蔽） |

**衍生教訓（後續批次複用）**：blocking anchor 為 **A1–A4 四條**，
branch HEAD commit SHA 與 commit-count 一律 `[info]`、**不得據以 reject**。

> **repo 存在性（實測，勿溢述）**：「HEAD commit SHA／commit-count 永不可當 blocking、一律標 `[info]`」
> 之**原則**已在 repo（`docs/plans/stage7-pr2cp-login-noimplicitany.md:63,71`）；
> 但「blocking anchor ＝ A1–A4 四條」之**具體契約**此前僅存於 gate packet
> `02-codex-plan-stage7-pr2dw-batchA.md`（§0）與 `02b-…md:160`，**經本 doc 首次落盤**。

---

## 4. `ARCH-A1..A11` 全文

| Lock | 內容 |
|---|---|
| ARCH-A1 | scope 恰兩個 wrapper、各一行，共兩行 |
| ARCH-A2 | annotation 恰為 `{ request: Request; env: Env }` |
| ARCH-A3 | `Env`/`Request` 沿用 ambient global，零 import |
| ARCH-A4 | normalized multiset `REMOVED=4 / ADDED=0`，四條均為目標 `TS7031` |
| ARCH-A5 | ratchet 精確 `377/15/322/337` |
| ARCH-A6 | emitted JavaScript 逐檔 byte-identical |
| ARCH-A7 | 禁改 F-3、測試、`Env`、tsconfig、baseline、cache-bust |
| ARCH-A8 | 獨立 worktree 自行 `npm ci`，禁共享 `node_modules` junction |
| ARCH-A9 | base 錨定 `32810f9e…b924`；漂移即重做證據 |
| ARCH-A10 | 任一 gate 失敗 / `ADDED≠0` / scope 漂移 → 停止回 Plan Gate |
| ARCH-A11 | 維持 inline idiom；**禁**建立 alias／加 import／順帶重構其他 handler。可記非阻塞 abstraction scout，但**不得預設**最終必須收斂；未來若立軸須先比較三案（CF 原生型別／局部 capability shape／共用 alias） |

> **來源**：上表 11 條逐字取自 gate packet `02-codex-plan-stage7-pr2dw-batchA.md:209-221`。
>
> ⚠ **OID 縮寫例外**：上表 `ARCH-A9` 的 `32810f9e…b924` 為 **owner 頒布之 lock 原文**，
> 依「逐字保存」原則不得改寫。其**完整 40-hex 見 `## 1`**：
> `32810f9eb3bf1119c3ebc7a3a02b12058556b924`。
> 本檔其餘所有 OID 一律使用完整 40-hex（`TREE-EQUALITY-LOCK`「文件內一律保存完整 OID」）。

**Provenance 分層**（🚫 不得籠統寫成「① 核發 A1..A11」）：
- **A1–A10** ＝ **owner 預頒**，① 驗證通過；
- **A11** ＝ ① 於 `Q1=(c)` 裁決後**追頒**，② carry-forward。

---

## 5. 批 A 的 Open Decisions 裁決結果（owner／① 拍板）

| OD | 裁決 | 對實作的約束 |
|---|---|---|
| **Q1 handler context 抽象** | **(c)** — 本批維持 inline；**且不認定為 SSOT 缺口**、**不強制**建立「收斂 145 處」重構棒 | → **ARCH-A11**：禁建 alias／禁加 import／禁順帶重構其他 handler |
| **批次順序** | owner 否決原 A→L，改 **producer-first + destructive-last**，共 **16 工作單元** | 批 A 僅為首棒，不得夾帶後續批內容 |
| **批 C 型別脊椎** | 選項 1 **僅作過渡**；另立 **C2** 脊椎棒，須在 H1/I/K/L 與 destructive archive API **之前**完成 | `classifyForCold()` 的 inferred `any` **本批不處理** |
| **批 J / 原 B** | 各自拆分（J1/J2、B-read/B-delete） | 本批不含任何 destructive 路徑 |
| **F-3 命名** | 採**雙軸→三軸**，不改寫既有 SoT 名稱 | 見 §8.1 三軸宣告 |
| **H1 型別策略** | 優先 template-literal type + 單一窄 assertion；**byte-identical emit 維持硬鎖** | 本批不涉及（屬 H1） |

> **來源**：上表逐字取自 gate packet `04-chatgpt-faithfulness-stage7-pr2dw-batchA.md:30-37`（8 行中 7 行；
> row 7「F-3 命名」cross-ref 由原文 `見 §5 三軸宣告` retarget 為 `見 §8.1 三軸宣告`，因原文 `§5` 指該 packet 自身章節）。

**16 單元定序**：`A → C → C2 → D → E → B-read → F → G → H0 → H1 → I → K → L → B-delete → J1 → J2`
（producer-first + destructive-last；批 A ＝首棒，已 SHIPPED）

> **來源**：序列本體逐字取自 gate packet `02-codex-plan-stage7-pr2dw-batchA.md:273`（**不在** `04-…md:30-37` 範圍內）；
> 前綴標籤與括號註為本檔所加。

---

## 6. 最終完整 hunks ＋ tree equality

```diff
diff --git a/functions/api/admin/cron/audit-aggregate-archive-debug.ts b/functions/api/admin/cron/audit-aggregate-archive-debug.ts
index 1c49a9f7..7ea308ae 100644
--- a/functions/api/admin/cron/audit-aggregate-archive-debug.ts
+++ b/functions/api/admin/cron/audit-aggregate-archive-debug.ts
@@ -27,7 +27,7 @@ const EVENT_PREFIX = 'audit.aggregate_archive.debug'
 const SELECT_COLUMNS =
   'id, event_type, reason_code, hour_bucket, total_count, sample_count, samples_json, sampled, cold_class, created_at'

-export async function onRequestPost({ request, env }) {
+export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
   return runAggregateArchive({
     request, env,
     tableName:     TABLE_NAME,

diff --git a/functions/api/admin/cron/audit-aggregate-archive-telemetry.ts b/functions/api/admin/cron/audit-aggregate-archive-telemetry.ts
index fc6aab29..6647dafc 100644
--- a/functions/api/admin/cron/audit-aggregate-archive-telemetry.ts
+++ b/functions/api/admin/cron/audit-aggregate-archive-telemetry.ts
@@ -32,7 +32,7 @@ const EVENT_PREFIX = 'audit.aggregate_archive.telemetry'
 const SELECT_COLUMNS =
   'id, event_type, user_id, severity, hour_bucket, count, ip_hash_top, cold_class, created_at'

-export async function onRequestPost({ request, env }) {
+export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
   return runAggregateArchive({
     request, env,
     tableName:     TABLE_NAME,
```

**blob OID（完整）**：

| 檔 | base | reviewed ＝ main（**同一 blob**） |
|---|---|---|
| `…-telemetry.ts` | `fc6aab297156192b106c8db65654dd659b5948d8` | `6647dafcd18a513990ba32429fc234ada9056411` |
| `…-debug.ts` | `1c49a9f795e8b90d4c2b276e17d7b1f97f8d74d9` | `7ea308ae60c1be3876fdb6a63acacea4fb61e61f` |

**機械證據**：
```
$ git diff --name-status 32810f9e..32fec8a4   → 恰 2 列 M
$ git diff --stat 32810f9e..32fec8a4          → 2 files changed, 2 insertions(+), 2 deletions(-)
```

### 6.1 Tree equality（受 `TREE-EQUALITY-LOCK` 約束）

✅ **可聲明**：
```
reviewed tree == squash tree == 30858c7e6e7bb8e1e3298627c6b45b6b57293034
```
兩個 commit 指向**同一 tree object** → 樹狀內容集合一致 → squash **未夾帶其他變更**。

🚫 **不可聲明**：`32fec8a46299da2d04f8f9f65bd565bbe85a2cd9`（reviewed commit）
與 `6aae95704cc151061cad0a05966d43f0d28c0eea`（squash commit）**「相同」**——
兩者為**不同的 commit object**（parent 相同、tree 相同，但 committer／時間／message 皆不同）。

---

## 7. 未結 finding 及處置約束

### 7.1 L-1（未結）— **必須兩層記錄，禁合併**

**內容**：`functions/utils/audit-aggregate-archive-runner.ts:89` 讀取
`AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN`，而 `types/env.d.ts` **未宣告**該 key。
**性質**：base 既有缺口，**非批 A 引入**。批 A 因 `ARCH-A7` 禁動 `env.d.ts` 故不修。
**爆點**：批 **L**（runner）標 `parseMaxRowsPerRun(env: Env)` 時會爆 `TS2339`。
**語意**：F-3 防爆量旋鈕（預設 `50_000`，超過即 `rows_exceed_max_per_run` run_failed）。

| 層 | 內容 | 出處 |
|---|---|---|
| **(i) gate 當時裁決** | 「本批不修（`ARCH-A7` 禁動 `env.d.ts`）→ **backlog 至批 L／H0**；禁以 `as any` 規避」 | gate packet `04-chatgpt-faithfulness-stage7-pr2dw-batchA.md:144`、`03-codex-code-stage7-pr2dw-batchA.md:218`（③ 認同，`TS-BOUNDARY-001` advisory） |
| **(ii) 事後收緊** | 「**不得夾帶進批 H0**（H0 只允許六個 hot-days key）→ 須另立 **`H0b`** 或進 Gate 前重新裁決」 | Dual Gate memory §7 AMENDMENT「衍生 scope 紀律」（owner 明示，**2026-07-18 事後頒**） |

⚠ **(i) 與 (ii) 對 H0 立場相反**：gate 當時**允許** backlog 到 H0，amendment 事後**禁止**。
把 (ii) 寫成「當時裁決」＝**竄改 gate 歷史**。
依 memory-import rule，(ii) 屬 memory-only 決策 → **須顯式標記，且必須 import 進 SPEC／PLAN
並經 closeout Plan Gate（closeout ①②）複核**；
〔⚠ **結構上不可能是批 A 的 ①②**：(ii) 為 2026-07-18 **事後**頒布，晚於批 A 的 Plan Gate。
上游 SPEC 原文作「並經**本次** Plan Gate（①②）複核」，本 doc 搬移時曾漏抄「本次」，已補為顯式限定。〕**不得僅憑 memory 記錄即當 approved requirement 直接 coding**。
⚠ 此為**兩段式義務**（標記 ＋ 送外部受審），缺一即等同未遵守。

**三條約束（全部有效；爭點僅在「何時、由誰頒」）**：
**(1)** 必須補宣告；**(2) 禁用 `as any` 規避**；**(3)** 不得夾帶進批 H0。
〔改用 `(N)` 而非圈號：依 `## 2` 符號約定，圈號**專指批 A 之四道 gate**，不作條列序號用。〕

### 7.2 M-1（已結，更正值）

① packet 原報之 idiom 計數為 **substring match**（已含 `+params` 變體），
並列呈現會被誤讀為 145+36=181。

**正確拆解（@ base `32810f9eb3bf1119c3ebc7a3a02b12058556b924`）**：

| 形式 | 數量 |
|---|---:|
| 恰好 `{ request: Request; env: Env }`（本 PR 採用之 exact form） | **102**（批 A 落地後 **104**） |
| `{ request: Request; env: Env; params… }` 變體 | **36** |
| **其他 ctx 變體**（`waitUntil` 3／`next` 3／index signature 1） | **7** |
| substring match 合計 | **145**（批 A 落地後 147） |

> ⚠ **本 doc 對原始 packet 之實測補正**：① packet 原表只列 exact `102` 與 `+params` `36`，
> 但 **102 + 36 = 138 ≠ 145** —— 殘差 **7** 未交代，讀者算出 138 後會產生**第二種誤讀**
> （而 M-1 的存在理由正是「數字呈現誠實性」）。
> 本 doc 實測補上該 7 項（`git grep` @ `32810f9eb3bf1119c3ebc7a3a02b12058556b924`），
> 使 **102 + 36 + 7 = 145 收斂**。原 packet 數值未竄改，僅補列殘差。

**對 ① 裁決 `Q1=(c)` 無影響**（102 與 145 同樣遠超「≥3 處重複即可抽象」之門檻）；`ARCH-A11` 續行有效。

---

## 8. F-3 隔離與宣稱用語紀律

### 8.1 F-3 三軸狀態（owner 2026-07-18 裁定；三者非 alias）

```text
F3_POSTURE           = DORMANT_WAIT_ONLY     # 功能運作姿態
F3_FILE_EDIT_POLICY  = CONDITIONAL_ACTIVE    # 觸碰三檔的驗證規則，始終有效
F3_FILE_EDIT_TRIGGER = NOT_TRIGGERED         # 批 A 僅 import、零修改三檔
```

受保護三檔：`functions/utils/audit-archive.ts` · `functions/utils/audit-aggregate-archive.ts` ·
`functions/utils/audit-aggregate-archive-runner.ts`。

批 A 自願跑 **F-3 derive parity 27/27**（`tests/audit-archive-forensic-classify-parity.test.ts`），
但**不得**據以宣稱「F-3 已啟用」或「批 A 完成 F-3 驗證」。

### 8.2 宣稱用語紀律（owner lock，續行有效）

- ✅ **可**宣稱：「批 A 清除 4 條 `TS7031` **noImplicitAny 診斷**」
- ❌ **禁**宣稱：「audit 域型別安全」／「aggregate-archive 已完整標型」／「F-3 已驗證」
- 理由：`classifyForCold()`（`functions/utils/audit-policy.ts:395`）仍回傳 inferred `any`
  （`const REGISTRY = new Map()` @ `:360` 未標型），屬後續**批 C2** 的型別脊椎工作。

---

## 9. Gate packet 清單、快照 receipt 與處置規則

批 A 的 gate 軌跡原始物件為 6 個 packet ＋ 1 份 SPEC 草稿（＝owner 裁決 6 所稱之「7 個 packet」）；
另本 PLAN 為**本 doc 之母本**（檔名 `stage7-pr2dw-closeout-PLAN.md`；**第 8 個檔，不在裁決 6 的 7 檔保護範圍內**，地位見 `## 9.2`）。存於本機
`~/Desktop/chiyigo-packets/`（**repo 外**）。

| # | 檔名 | bytes | SHA-256（快照 receipt） |
|---|---|---:|---|
| ① | `01-chatgpt-arch-stage7-pr2dw-batchA.md` | 16739 | `65b1637fbb8875cdfc038f8ce78243f7a14d0cdb5ac86fa3a972362f5e72475b` |
| ② | `02-codex-plan-stage7-pr2dw-batchA.md` | 16308 | `a457d1b117dee3df2116f5c1b0c77ad8ec6d29cb3813eef442ae689a7a1dc834` |
| ②r2 | `02b-codex-plan-delta-stage7-pr2dw-batchA.md` | 8234 | `b9fb81324f3b97f94162296b1c9f7a134cbac1342b87e14ead9f84ce8d1c786b` |
| ②r3 | `02c-codex-plan-delta-r3-stage7-pr2dw-batchA.md` | 4603 | `fd8661dd4bd2f79e07908bbb840413058471cfa79aebfca7ea9d4aedb7a3bc08` |
| ③ | `03-codex-code-stage7-pr2dw-batchA.md` | 14351 | `aa53a4c2b4232ab301588de3d110fffd00b6484e02ad2d0ccda97bf43f350d9f` |
| ④ | `04-chatgpt-faithfulness-stage7-pr2dw-batchA.md` | 12647 | `aab45086e368e684efc8854cdebe87d7bb7a888e9790129fea0b1a3b55259fd4` |
| SPEC | `stage7-pr2dw-closeout-spec-draft.md` | 66612 | `17275ad47869090a249a3405c900239c6665e12b407f78faa3e29b0eef3066a1` |
| PLAN | `stage7-pr2dw-closeout-PLAN.md`（**本 doc 之母本**） | 94153 | `24ed55e51a3175c5deb14d619941a830532c46f7d822b25278e5382540e8f54c` |

> 🔒 **`SELF-HASH-LOCK`**：上表各 SHA-256 **僅為該次外部快照 receipt**
> （記錄某時點之位元組狀態，供送 gate 時確認版本一致），
> **不得宣稱為文件自身之權威完整性證明**。
> **本 closeout doc 之最終 hash／blob OID 由其 squash commit body 承載。**
>
> ⚠ **SPEC／PLAN 兩列為何是佔位符**：雜湊無法記於**自身內部**（寫入即改變雜湊），
> 但**本 doc 是不同檔案，記錄毫無障礙**。故義務為 ——
> **CODE stage 落盤前實跑 `sha256sum` 於兩檔並填入本表**。
> **落盤前置檢查：本表 SPEC／PLAN 兩列不得留佔位符。**
> 〔⚠ 本行刻意**不重複佔位符 sentinel 字面、不引用 PLAN-only 節號** ——
> 前者會使機械閘自我觸發而永不轉綠，後者落盤後即 dangling。〕
> 此二列之用途＝供**窗口 1／2 複驗母本未被竄改**；⚠ **不是** §9.3 的比對對象（§9.3 比對的是 squash commit body 所載之本 doc blob/hash）。

### 9.0 ⚠ **CURRENT OWNER RULINGS**（2026-07-19 重新核發）＋ amendment 原文移轉

> 🔑 **owner 於 2026-07-19 依 ① `ARCH-R3` 建議之選項 (a) 明示重新核發** ——
> 下列三項自即日起為**本 closeout 之 current owner rulings**，
> **現行效力由本次 owner ruling 承擔；合入後由 repo 內載體提供不可變複驗性**
> （⚠ 二者為**不同的事**：ruling 之**效力**即刻生效，repo 載體提供的是**不可變複驗性**）——
> 均**不再倚賴可靜默改寫之 memory amendment**。
> 歷史來源仍如實標明（見本節 §9.0.2 逐字節錄）。

#### 9.0.1 三項 current owner rulings（現行權威）

| # | ruling | 內容 |
|---|---|---|
| **OR-1** | **批 A 狀態標記** | closeout 合入前，批 A 狀態**只能標** `CODE_SHIPPED / GOVERNANCE_CLOSEOUT_PENDING`，**不得宣稱 `CLOSED`**。 |
| **OR-2** | **驗收後方可刪** | packet **僅在**「該 PR 之 gate 軌跡已持久保存進 repo」**且**經 closeout 合入並驗證後，方進入可刪評估。 |
| **OR-3** | **`H0b` 約束** | 後續批次補既有缺口時，**不得夾帶進 scope 已定案的批**。批 A 之 **L-1**（`AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN`）**不得**塞進只允許六個 hot-days key 之批 **H0**，**須另立 `H0b`** 或進 Gate 前重新裁決。 |

**權威狀態**：`CURRENT_OWNER_RULING`；**隨本 doc 合入 main 後取得 repo-immutable 載體**
（⚠ 本 doc 尚未合入，故現為「將取得」而非既成事實 —— ARCH-RR2-2）—— **僅涵蓋上表 OR-1／OR-2／OR-3 三列**

> ⚠ **本 PR 決策（依 ARCH-R1），非 owner ruling**：本 PR **不建立任何直接刪除能力**（見 `## 9.4`）。
> 此為本 PR 採納 ① 低成本安全方案之自訂決策，**刻意置於權威表之外** ——
> 若日後某 PR 需建立刪除能力，**只需另做決策，毋須請 owner 推翻任何 ruling**。
> 〔前一版曾內嵌於 `OR-2` 儲存格，會使其繼承 `CURRENT_OWNER_RULING` 權威 ＝ 權威來源錯置。〕

**歷史來源**：Dual Gate memory §7 AMENDMENT 2026-07-18（見 §9.0.2）

> 🔑 **擬稿 provenance（三段式，逐段揭露）**：
> **(1)** ① `ARCH-R3` 提出三項標的（狀態標記／驗收後方可刪／`H0b` 約束）；
> **(2)** **owner 於 2026-07-19 明示選 (a)** —— 其核發範圍＝**授權「重新核發」此一行為**；
> **(3)** **OR-1／OR-2／OR-3 之文字由本 PR 依 §9.0.2 amendment 逐字條文擬定**，
> **未經 owner 逐字書寫** —— **如與 owner 本意有出入，一律以 owner 為準**。
>
> ⚠ 明示第 (3) 段，是為與本 doc 對 ①②③④ verdict 所套之三分類
> （`VERBATIM_EXTERNAL_REPLY`／`CONTEMPORANEOUS_TRANSCRIPTION`／`RETROSPECTIVE_RECONSTRUCTION`）**對稱** ——
> 對他人 verdict 錙銖必較、對自建最高權威節卻無來源標示，即為雙標。
> **擬稿忠實度可由 §9.0.2 逐字節錄自行比對**（三條皆可回溯，且 OR-1／OR-2 較 amendment **收窄**）。

⚠ **memory 縱使滅失或被改寫，OR-1／OR-2／OR-3 之效力不受影響。**

#### 9.0.2 Amendment 原文移轉（歷史來源，逐字）

> **為何保留本小節**：① 指出本 doc 曾一面把 amendment 原文**排除於 preservation scope**、
> 一面繼續把它列為**唯一授權來源**（批 A 狀態標記／驗收後方可刪）——
> memory 滅失後只能知道「文件聲稱 amendment 曾授權」，**不能複驗該 provenance**。
> **owner 已於 2026-07-19 選 (a) 併行處置**：§9.0.1 重新核發為 current rulings（解決權威可複驗性），
> 本小節保留逐字節錄（保存歷史 provenance）。**兩者併存、不互相取代。**
>
> **來源分類**：`CONTEMPORANEOUS_TRANSCRIPTION`（owner 於 memory 撰寫）
> **原載體**：Dual Gate memory `feedback_codex_review_workflow.md` §7，第 **167-183** 行
> **快照 receipt**（實測 2026-07-19）：`bytes=29930`｜`sha256=dc13a7a2745733c97ec22212447285fb0d01c2eeb68ce1d1721e6cd1ab471dac`
> ⚠ **memory 可改寫、行號會漂** —— 故以下為**逐字節錄**，不倚賴行號。

**逐字節錄（load-bearing 條文；非全文）**：

```text
【兩條新規則】
1. plan doc 自 SPEC 起納入 allowed changed-files：每個 PR 的 SPEC／ARCH lock 在寫 scope 當下
   就要把唯一對應的 docs/plans/stage7-*.md（或該專案對應 plan doc 路徑）列入允許變更清單。
   禁事後才發現 plan doc 進不來。
2. packet 刪除改為條件式，且綁 closeout：
   - packet 僅在「該 PR 的 gate 軌跡已持久保存進 repo」後方可刪除。
   - plan doc 未隨 code PR 落地時 → ship 後另開 docs-only closeout PR（依 §12，repo 內文件仍走完整四道）。
   - closeout 合入前，狀態只能標 CODE_SHIPPED / GOVERNANCE_CLOSEOUT_PENDING，不得宣稱 CLOSED。
   - closeout 合入並驗證後，才可刪該 PR packets。

【closeout doc 至少須保存 8 項】
base／reviewed SHA／PR＋merge SHA · ①②③④ verdict 與各自錨點 · Plan Gate 各輪正確歷史
（例：批 A ＝「三輪審查、兩次 reject」，非「三輪 reject」）· ARCH-* locks 全文＋OD 裁決 ·
最終完整 hunks（或 immutable hash）· 未結 finding 及其處置約束 · 各 packet 的 bytes＋SHA-256 ·
明載「packets 僅在 closeout 合入後方可刪除」。

【衍生 scope 紀律】
後續批次補既有缺口時，不得夾帶進 scope 已定案的批（批 A 的 L-1 即例：
AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN 不得塞進只允許六個 hot-days key 的批 H0，
須另立 H0b 或進 Gate 前重新裁決）。
```

→ **本節落地後**，amendment 之 load-bearing 條文**已具 repo-immutable 載體**；
memory 縱使靜默改寫，其**歷史 provenance 仍可由本節複驗**，
而**現行效力**另由 §9.0.1 之 `OR-1`／`OR-2`／`OR-3` 獨立承擔。

---

### 9.1 Packet 處置規則（owner 裁決，逐字）

> **7 個 packet 現在不得刪。** closeout 合入且**獨立複核證明 `unique evidence set = ∅`** 後，
> 才是 `DELETE_ALLOWED`，**不是必須刪除**。**104 KiB 不構成提前刪除理由。**
> 若任一 packet 仍是 **verdict、anchor 或 provenance 的唯一載體**，
> 就**必須保留或先完整移轉**。

**`unique evidence set` 三集合定義（ARCH-R1；舊版單一定義域過窄，可被讀成排除 (B) 而得假空集合）**：

| 集合 | 定義 |
|---|---|
| **`candidate evidence set`** | **所有支撐 verdict、anchor、provenance 或可重放性之 load-bearing evidence** —— 包括 source snapshot、完整 hunk、replay recipe、證據矩陣、receipt 對照對象、**裁決條文**。⚠ **域刻意寬於「verdict／anchor／provenance」三詞**，(A)(B) 兩類**皆屬之** |
| **`repo-covered evidence set`** | 上述元素中，已於 repo（本 doc ＋ squash commit body 雙載體）取得等價保存者 |
| **`unique evidence set`** | ＝ `candidate` **−** `repo-covered`。**非空 → 一律禁刪**（或先完整移轉再刪） |

> ⚠ **本 PR 對上述 owner 裁決 6 之落地方式見 `## 9.4`：本 PR 不建立任何直接刪除能力。**
> 裁決 6 之逐字引文**不得改動**，但**單讀本節不足以推出「差集清零後即可刪」** ——
> 窗口 3 之唯一效果為取得另立處置軸之資格，該軸須另走完整 Dual Gate 四道。

**差集初始候選（本 doc 未涵蓋之內容）**：
**(A) owner 裁決 1／3／5 之約束條文中未落盤者** —— ⚠ **整類**，非技術產物；
裁決 6 明訂「若任一 packet 仍是 verdict、anchor 或 **provenance** 的唯一載體，就必須保留或先完整移轉」，
**未落盤之 owner 裁決約束即屬此類**（落盤狀態：**裁決 5** 之檔名鎖定 → `## 10.1` scope 欄 ✓；**裁決 1** 之措辭禁令 → `## 2.1` ✓；
**裁決 3**（`OD-5=(a)`：memory 僅索引非權威／權威內容進 closeout doc／摘要與權威段落須同次更新）之約束 → 已落於 `## 10.3`，**惟未標歸屬**。複核時須逐條確認無遺）。
⚠ **對照母本＝SPEC 草稿 `§B.0`**（owner 六裁決＋三 LOCK 逐字全文）—— 該檔**本身即刪除評估對象之一**，
故**執行順序硬性要求：先讀 §B.0 逐條對照本 doc、驗畢無遺，才可進入其刪除評估**。
**(B) 技術產物**：兩個受改檔案之全文 source ·
gate replay recipe（worktree／`npm ci`／`tsc -b --force`／multiset 比對指令） ·
逐項證據對照表 · 可用來複驗上表 receipt 的對象本身。
→ 須於合入後逐項獨立複核清零，**不得由本 PR 自行宣告完成**。

**批 A 狀態**：closeout 合入前只能標 `CODE_SHIPPED / GOVERNANCE_CLOSEOUT_PENDING`，
**不得宣稱 CLOSED**。

### 9.2 處置三窗口

**適用對象**：`~/Desktop/chiyigo-packets/` 內 PR-2dw 之**全部 7 個檔**（六 packet ＋ SPEC 草稿）
—— 即 owner 裁決 6 所稱之「7 個 packet」。
⚠ **本 PLAN（第 8 檔）之地位**：它是**本 doc 之母本**（檔名 `stage7-pr2dw-closeout-PLAN.md`），**不在裁決 6 的 7 檔禁刪範圍內**；
但依窗口 1／2 之同一理由（母本須可複驗），本 PR 將其**納入窗口 1／2 之編輯與凍結規則**。

🔒 **ARCH-R4 鎖定 —— PLAN 之凍結跨越窗口 3，不得中斷**：
> **PLAN 自窗口 2 起持續唯讀凍結（禁刪、禁移動、禁編輯），跨越窗口 3，
> 直至 (a) 獨立複核收據已進 repo **且** (b) owner 對 PLAN 另行核發
> **`RETAIN_ALLOWED`** 或 **`DELETE_ALLOWED`** 為止。**
>
> 〔理由：窗口 3 之禁止欄僅有「禁刪」、**不涵蓋編輯／移動**；而 PLAN 之 receipt 已隨本 doc
> 凍結進 repo（`## 9` 表 PLAN 列）。若窗口 3 起 PLAN 可被自由編輯，該 receipt **即失去可複驗對象** ——
> 正是窗口 1／2 設計所要防之事。舊版僅寫「另待 owner 裁示」，使**中間期間無規則覆蓋**。〕

| 窗口 | 期間 | 允許 | 禁止 |
|---|---|---|---|
| **1** | 至本 doc **commit 之前** | 編輯（每次編輯後**須重算 §9 receipt**） | 刪除、移出目錄 |
| **2** | **本 doc commit** 之後 → **closeout merge ＋ `## 9.3A` 基礎驗收通過** | **唯讀查證（限母本分歧規則所列各用途）** | **禁刪、禁移動、禁編輯**；**禁複製外流**（複製僅限**本機查證**或**外部 gate 送審引用**〔owner 明示：本機路徑無法作為外部審查者輸入，送審必須貼本文；且 closeout ③／④ 之審查即發生於窗口 2，④ 之審查標的更是 PLAN 本身〕；**不得作為母本替身**，亦不得據以回改或替代本機母本） |
| **3** | **closeout merge ＋ `## 9.3A` 基礎驗收通過**之後 | **僅得另立 `packet-disposition closeout` 軸**（見 `## 9.4`）—— ⚠ **本 PR 不建立任何直接刪除能力** | **一律禁刪**（本 PR 不授權刪除） |

**窗口界線清單（逐點驗銜接；刻意不用 ASCII 圖 —— 見下註）**：

- **界線 A**（窗口 1 → 窗口 2）＝ **本 doc commit**
- **界線 B**（窗口 2 → 窗口 3）＝ **closeout merge ＋ `## 9.3A` 基礎驗收通過**

**半開區間表述（NB-2；界線事件一律歸屬後一窗口）**：
- **W1** ＝ `[PLAN freeze, 本 doc commit)`
- **W2** ＝ `[本 doc commit, closeout merge ＋ 9.3A 基礎驗收)`
- **W3** ＝ `[closeout merge ＋ 9.3A 基礎驗收, owner disposition)`

⚠ **相鄰窗口共用同一界線，無空隙、無重疊**（界線 A、B 各出現於兩窗口之期間欄，字面相同；
界線點依半開區間歸屬**後一**窗口 —— 舊版界線 A 為雙排除式，使 commit 瞬間形式上不屬任何窗口）。
⚠ `DELETE_ALLOWED` **非界線**，不列入本清單；且依 `## 9.4`，**本 PR 不建立任何直接刪除能力** ——
窗口 3 之效果**僅為取得「可另立 `packet-disposition closeout` 軸」之資格**（窗口表「允許」欄現即如此記載）。
⚠ **窗口 2 之工作範圍（ARCH-RR3-1 後修正）**：W2 **最多只做唯讀準備或 inventory**；
**正式的逐項 mapping 與差集清零屬 W3／disposition 軸**（見 `## 9.3B`／`## 9.4`），**不再屬於 W2**。
〔舊版寫「差集複核之整段工時落在窗口 2 內」，係差集清零仍為 W3 前置時之描述，已隨兩階段拆分過期。〕
窗口 2 之「禁刪、禁移動、禁編輯」與母本分歧規則 (i)(ii)(iii) 之唯讀授權**全程有效**。
〔早期版本窗口 2 終點為「機械驗收通過」、窗口 3 起點為「機械驗收通過＋差集清零」，
兩者間裂出**無規則覆蓋的區間**，而該區間正是複核者長時間翻閱 7 個檔之時 —— 已對齊為同一界線。〕
〔⚠ **不用 ASCII 時間軸的理由**：box-drawing 字元（U+2500-257F）屬 East Asian **Ambiguous width**，
渲染器以寬度 1 或 2 處理會使刻度與標籤大幅錯位；圖本身無法保證對位，反而新增一個會漂的物件。
界線清單以文字表述同一事實，**不可能錯位**。〕

> **窗口 2 的「母本分歧」規則**：**closeout ③／④** 若對本 doc 內容提出 finding，
> **必須改的是 repo 內的本 doc**（合法）；而本機 SPEC 草稿／PLAN 受窗口 2 凍結、**不得同步**。
> → **本 doc commit 之後，repo 內的本檔即為 SoT**；本機母本凍結為**歷史快照**，
> 其與 repo 版本之分歧為**預期且可接受**。
> 母本在窗口 2 的**剩餘功能如下**（刻意不寫基數，理由見本規則末段）：
> **(i)** 讓 `## 9` 記錄的 receipt 仍可複驗；
> **(ii)** 作為 `## 9.1` 差集 **(A)** 之**對照母本**（owner 裁決逐字全文，供逐條核對是否已落盤）；
> **(iii)** 以 **byte-identical 副本**供 **closeout ③／④ 外部審查**引用（NB-1）——
> 🚫 禁編輯、🚫 禁作為母本替身、🚫 審查後副本**不得成為新 SoT**。
> ⚠ **上述各項**皆為**唯讀查證**用途（⚠ **刻意不寫基數** —— 本清單即 **KL-1** 所記之失敗前例：
> `(i)(ii)` 增列第三種用途時基數／列舉未同步；同一紀律見 `## 9.3B`）；
> 它**不再是本 doc 內容的權威來源** ——
> 有 finding 時須改 **repo 內本 doc**，**不得回改母本**。
> 〔早期版本此處寫「**唯一**剩餘功能＝receipt 複驗」，與 `## 9.1` (A) **字面互斥**：
> 複核者照字面執行會判定 SPEC 不得用於 (A) 之內容對照 → 略過 (A)，
> 而 (A) 是不可逆刪除的前置閘。二者意圖本相容（唯讀查證 ≠ 內容權威來源），已改為列舉。〕

> 🔒 **適用範圍（防級別誤判）**：本節（§9.2）為**本 PR 之 packet 處置決策**，適用對象即上列逐一列舉之檔案；
> **非通用治理規則**（無全稱量詞、不宣告適用於本 PR 以外），一般化推廣屬 OD-5 範疇。
> → 依級別謂詞**不觸發升級**，`L1` 維持。

**Provenance 分層（防權威來源錯置）**：

| 內容 | 授權狀態 |
|---|---|
| 窗口 3 之「**驗收後方可刪**」＋ 批 A 狀態標記 | ✅ **`## 9.0.1` current owner rulings `OR-2`／`OR-1`**（2026-07-19 重新核發；**隨本 doc 合入 main 後取得 repo-immutable 載體**）—— 歷史來源為 Dual Gate memory §7 AMENDMENT（逐字節錄見 `## 9.0.2`）。⚠ **現行效力不倚賴 memory** |
| **刪除能力**之前置（`## 9.1` 差集清零；⚠ **非** W3 entry —— W3 entry 僅掛 `## 9.3A`，見 ARCH-RR3-1）＋「**`DELETE_ALLOWED`，非 `DELETE_REQUIRED`**」（＝保留是合法終局） | ✅ **owner 裁決 6**（`unique evidence set = ∅`）—— ⚠ **非** amendment（`unique evidence set`／`DELETE_ALLOWED`／`104 KiB` 於 memory 檔 grep 皆為 0） |
| 適用對象 scoping（**限 7 檔部分**）＋ 機械驗收指令 | ✅ amendment 只說「合入**並驗證**後」未指定方法 → 屬**授權步驟之實作** |
| **窗口 1／2 ＋ 母本分歧規則 ＋ PLAN（第 8 檔）之納入窗口 1／2 與窗口 3 排除** | ❌ **amendment 未涉 ＝ 本 PR 自訂執行決策** |

⚠ 若日後有人拿本節當「amendment 要求的標準做法」約束別的 PR，
會把**本 PR 自訂的窗口 1／2** 誤掛在 amendment 權威名下 —— 此即權威來源錯置。

### 9.3 兩階段驗收（ARCH-RR3-1；**拆解前一版之不可達循環**）

> ⚠ **前一版之死結**：進 W3 須差集清零 → 須有獨立複核收據 → 該收據由 disposition 軸落地 →
> **但該軸只能進 W3 後才得另立** → 回到起點。**fail-closed（不會錯刪）但狀態機永遠無法前進。**
> 拆為兩階段後，W3 仍維持「**一律禁刪**」，**安全性不降低**。

| 階段 | 條件 | 結果 |
|---|---|---|
| **9.3A** closeout 基礎驗收 | closeout 已 merge；以 squash receipt 完成 **`## 9.3A` 所列全部檢查**（⚠ **本表不複述條件集**，兩列同一紀律） | **進入 W3**；仍**一律禁刪**；僅取得**另立 disposition 軸之資格** |
| **9.3B** disposition 終局驗收 | 由 disposition 軸完成 **`## 9.3B` 所列全部項目**（⚠ **本表不複述條件集** —— 以 `## 9.3B` 為權威清單；複述即產生影子副本，會隨清單增項而過期） | 由**該軸**決定後續刪除狀態（**不在本 PR 範圍**） |

#### 9.3A closeout 基礎驗收（本 PR 之範圍；進入 W3 之唯一條件）

```bash
git fetch origin
git ls-tree origin/main docs/plans/stage7-pr2dw-closeout-audit-aggregate-archive-ctx.md
#   須非空
# ⚠ blob OID 與 SHA-256 為**兩種不同識別值**，須**分開**核對（ARCH-R1；舊版以「blob/hash」混寫）
# ⚠ 使用 shell 變數而非角括號佔位符（ARCH-RR2-1）——
#    §7.3 receipt gate 會把落盤 doc 內的非白名單角括號判為未填實佔位符，
#    若此處寫成角括號佔位形式，即使四個 cell 全填實仍必然擋住 commit。
#    ⚠ 本註解刻意**不複述**該佔位字面 —— 複述即自我觸發，與 §7.3 sentinel 同型陷阱。
test -n "$SQUASH_SHA"   # ⚠ 須取自 squash receipt，**不得**猜測為當下 origin/main tip
DOC=docs/plans/stage7-pr2dw-closeout-audit-aggregate-archive-ctx.md
git rev-parse "$SQUASH_SHA:$DOC"
#   → 對照 squash commit body 所載之 **blob OID**
git show "$SQUASH_SHA:$DOC" | sha256sum
#   → 對照 squash commit body 所載之 **SHA-256**
git ls-tree origin/main "$DOC"
#   → **mode** ＋ **blob OID** 對照 **squash commit body 所載值**（⚠ 9.3A 之依賴**僅限** squash receipt 與 origin/main）
#   🚫 **9.3A 不得引用「獨立複核收據」** —— 該收據要到 disposition 軸（9.3B）才產生，
#      在此引用會把未來依賴帶回 W3 前置、死結復發（owner 2026-07-19 指正）
#   ⚠ 比對對象**不是** §9 表的 SPEC／PLAN 列 —— 那兩列是母本 receipt、與本指令輸出無關
```

〔⚠ 舊版寫「**兩者**皆綠」，係**拆分前之舊 `## 9.3`**（尚未分為 9.3A／9.3B）僅含存在性與 hash 兩項時之計數；
**本節（9.3A）**現含之檢查項**已多於兩項**（清單以本節指令區為準，**此處刻意不複述** —— 複述即產生第二份影子副本，會隨清單增項而過期），故該計數已過期（ARCH-RR2-4）。
⚠ 本註記原誤置於 `## 9.3B`，然其所述清單為 **9.3A** 之檢查項，已歸還本節。〕

**上述全部檢查皆綠** 才進窗口 3（⚠ **不含**差集清零 —— 該項依 ARCH-RR3-1 移至 `## 9.4` 作為
**刪除能力**之前置，而非 W3 之前置）；任一不符 → **停手回報**。
⚠ **進入 W3 後仍一律禁刪** —— W3 之唯一效果為取得另立 disposition 軸之資格。

#### 9.3B disposition 終局驗收（**不在本 PR 範圍**，由未來 disposition 軸執行）

該軸須完成**下列全部項目**（⚠ **刻意不寫基數** —— 本 doc 已有「兩者皆綠」因增項而過期之前例；
增刪項目時只需改清單，不必同步任何數字）：

1. **逐項 mapping**（packet 承載之 verdict／anchor／provenance 逐一對映 repo 落點）
2. **`unique evidence set = ∅`**（三集合定義見 `## 9.1`）
3. **repo-immutable 獨立複核收據**已落地（必填欄見 `## 9.4`）
4. **owner `DELETE_ALLOWED` token**
5. **mode 三方一致**（ARCH-RR2-4 之 file mode 欄之存在理由；⚠ 9.3A 僅驗兩方，三方比對在此定義）：

```bash
# 三方 ＝ squash commit body 所載值 ／ origin/main 現況 ／ 獨立複核收據之 `doc file mode` 欄
git fetch origin
DOC=docs/plans/stage7-pr2dw-closeout-audit-aggregate-archive-ctx.md
git ls-tree origin/main "$DOC"          # 取 mode ＋ blob OID
#   → mode 須同時等於 squash commit body 所載值 **且** 等於獨立複核收據之 doc file mode 欄
#   ⚠ 三值任一不符 → 停手回報，禁刪
```

**上述全部項目全綠，方由該軸決定刪除狀態。**

---

### 9.4 Packet 處置：**本 PR 不建立刪除能力**（ARCH-R1 低成本安全方案）

🚫 **本 closeout PR 不授權、不執行任何 packet 刪除。** 窗口 3 之唯一效果＝
**取得「可另立 `packet-disposition closeout` 軸」之資格**，該軸須走完整 Dual Gate 四道。

**該軸放行刪除之前置（全部滿足才成立）** —— ⚠ 依 ARCH-RR3-1，以下為**刪除能力**之前置，**非進入 W3 之前置**：

1. **repo-immutable 獨立複核收據**已落地（非對話、非本機），至少記錄：
   - 7 個 packet 之**完整 64-hex SHA-256**
   - closeout **squash commit SHA**
   - closeout doc **blob OID**
   - closeout doc **SHA-256**
   - closeout doc **file mode**（例：`100644`）—— ARCH-RR2-4：無此欄則 **`## 9.3B`** 之 mode **三方一致**（squash body／origin/main／本收據）**無法證明**。⚠ **`## 9.3A` 之 mode 為兩方比對**（squash body ↔ origin/main），**不含本收據** —— 二者不得混淆，否則會把獨立複核收據重新接回 9.3A、復發 ARCH-RR3-1 死結
   - reviewer／日期／**逐項 mapping**
   - `unique evidence set = ∅` verdict
   - owner **`DELETE_ALLOWED` token**
2. 上述收據經 **`## 9.3B`** 終局驗收全綠（⚠ **非 `## 9.3A`** —— 二者不得合併：
   9.3A 為本 closeout 之 post-merge 基礎驗收、僅依賴 squash receipt 與 origin/main；
   9.3B 為 disposition 軸之終局驗收，**其條件集以 `## 9.3B` 為準**）。
   ⚠ 本項刻意**不複述** 9.3B 之條件集 —— 舊版此處以「**方含**…」作**排他性**斷言，
   既漏第 5 項（mode 三方一致）又反過來否定其存在，比單純漏列更強。

⚠ **若僅於對話或本機完成複核後即刪 packet，等同重製本 PR 正在修復的同型缺陷**
（裁決存在、但 repo 無可持久複驗之 receipt）。

## 10. 本 closeout PR 自身的決策與軌跡

### 10.1 決策全文

| 項 | 決策 |
|---|---|
| **PR id** | `PR-2dw-CLOSEOUT` |
| **目的** | 保存批 A（PR #149）之 Dual Gate 軌跡，使批 A 由 `CODE_SHIPPED / GOVERNANCE_CLOSEOUT_PENDING` → `CLOSED` |
| **依據** | Dual Gate v3.1 §7 AMENDMENT 2026-07-18 規則 2 |
| **級別** | `L1` docs-only（通用治理規則不落 `docs/plans/`，故不觸發升級謂詞） |
| **scope** | 恰 1 檔新增：本檔（`docs/plans/stage7-pr2dw-closeout-audit-aggregate-archive-ctx.md`）。檔名經 **owner 裁決 5（`OD-3=(a)`）鎖定**：**後續不得在未重開 OD 下改回模糊 slug** |
| **non-scope** | `functions/**` · `tests/**` · `types/**` · tsconfig · baseline · `package.json`/lockfile · `.github/workflows/**` · `src/**`/`public/**` · `CLAUDE.md` · `docs/GOVERNANCE.md` · `.claude/rules/**` · 其他既有 `docs/` 檔 · `CLEANUP_PLAN.md`。**明確不做**：不追溯改 #149、不改 `ARCH-A*` 內容、不修 L-1、不刪 packets |
| **雙載體分工** | **本 doc（主載體）**＝決策／來源分類／anchors／tree equality／packet 處置條件；**squash commit body（收據載體）**＝終局 gate receipt ＋ doc 路徑 ＋ doc blob/hash。🚫 **本 doc 不記錄自己的最終 commit SHA** |
| **gates** | ⚠ **本欄為便利副本；權威清單以 `## 7`（含 §7.1／§7.3）為準，增刪 gate 時須同步本欄**〔刻意保留列舉而非改指標，判準＝**副本失準之後果嚴重度**：本欄失準最多**少跑一道 gate**，而 CI 會兜底 → 容許便利副本。⚠ **對照組**：`## 9.3A`／`## 9.3B` 條件集失準＝**少驗一項不可逆刪除前置、無任何兜底** → **一律禁副本、只用指標式**。⚠ **不得以「執行語境」作判準** —— 舊版曾如此寫，但 9.3A／9.3B **同屬執行語境**（執行者依其跑指令），依該判準將反推出「條件集亦應保留副本」，恰為 R19–R23 五輪所清除之影子副本結構。〕。現況：CI 七道（`lint`·`typecheck:ratchet` 不帶 `--update`·`verify:browser-pipeline`·`test:cov`·`test:int`·`build:functions`·`npm audit`）＋ 三支 lint 作 read-only 驗證替代 ＋ 第 8 道 receipt 填實（落盤前置：`## 9` 表 SPEC／PLAN 兩列不得留佔位符） |
| **ratchet lock** | `377 / 15 / 322 / 337` 不變、baseline `1119/175` 凍結（`.md` 不在 ratchet source glob） |
| **rollback** | `git revert <squash-sha>` 可還原本 doc；packets **依 `## 9.4` 本 PR 一律禁刪**（解禁須 disposition 軸完成 **`## 9.3B` 所列全部項目** —— ⚠ **本欄不複述清單內容或基數**，以 `## 9.3B` 為準；複述會使該清單第四度發生「增項未同步」），故軌跡不會因 revert 而滅失 |

### 10.2 `BUILD-LOCK` 合規紀錄

不跑 `npm run build`（其 `build:partials` 會寫入 `public/**`，與「恰 1 個 `A`」及「禁動 `public/`」衝突）。
改跑三支 lint 作 **read-only 驗證替代**，🚫 **不得稱為完整 build 之等價替代**。

| 實際覆蓋 | 刻意未覆蓋 |
|---|---|
| `lint:handlers`（`src/js` + `public` 既有 committed 產物） | `build:partials` 之產物再生路徑 |
| `lint:archive-no-delete`（`SCAN_GLOBS`） | PASS-2 tailwind sentinel 斷言（僅再生時觸發） |
| `lint:migrations`（`migrations` + 對應 test） | 「若此刻全量再生，產物是否仍乾淨」之既有狀態檢查 |

**tree 狀態驗證**：gates 執行前後各跑 `git status --porcelain --untracked-files=all`，
兩次輸出須**逐字相同**。

### 10.3 壓縮紀律（COMPRESSION-LOCK；**本 PR 執行紀律**，非通用治理規則）

本 closeout 之編製過程中，「把內容壓縮進表格列／摘要／指標」的動作**重複造成載重內容遺失**
（實證多次：non-scope 條目、具約束力決策、memory-import 之送審義務、必填欄位清單）。
故本 PR 自訂三步紀律：

1. 把 X 壓成 Y 時，先對 X／Y 跑 `diff`（重構式壓縮無行對應時改用逐項對照表），**不靠目視**；
   **項 ＝ 每一條可獨立驗證的義務／約束／數值／錨點**，**不是**每一行、不是每個表格列；
   判準＝「若此片語消失，是否有任何一項義務、數值或可驗證錨點隨之消失？」；
   **跨段落／節→節搬移須逐句比對，不得以段或列為單位**。
2. **明列「刻意捨棄」清單**，每項附理由，未列出者視為遺漏、須還原；
   **並反向複驗「殘留」——原處是否仍留有應被移走的副本（尤其數值與代號）**。
3. **任何**關於壓縮結果的宣稱（**不限「逐字」**，含「不留副本」「已全數涵蓋」等）
   皆須與實測**零落差**。

⚠ **適用範圍**：本紀律**僅約束本 PR 自身**的壓縮動作，以**執行紀錄**形式保存於此。
其**一般形式**另行寫入 project memory 作為後續 workflow 規則；
**memory 僅為索引與教訓，不得作權威裁決或證據載體**，權威內容以本節為準。
**摘要與權威段落必須同次更新。**

### 10.4 Gate 進程紀錄（dated；faithful 收錄）

> 每條記：日期／commit SHA／verdict 全文／finding 數／anchor／下一步授權邊界。

- **2026-07-18**｜commit `6aae95704cc151061cad0a05966d43f0d28c0eea`（批 A squash-merge 進 main）｜
  **verdict**（**①②③④ ＝批 A 四道**，依 `## 2` 符號約定）：①`CHATGPT_ARCH_APPROVED` · ②`CODEX_PLAN_APPROVED` · ③`CODEX_CODE_APPROVED` ·
  ④`CHATGPT_CODE_FAITHFULNESS_APPROVED`（全文見 §2）｜
  **finding 數**：① 0 Critical/0 Required/1 non-blocking · ② r1 1 blocking+2 required／r2 1 blocking+1 required／**r3 無計數紀錄** ·
  ③ 0 blocking/0 required/0 Tier 0 · ④ **無 finding 計數紀錄**（裁定 (c)+(d)；載體＝memory amendment，未載計數）｜
  **anchor**：base `32810f9eb3bf1119c3ebc7a3a02b12058556b924`／reviewed `32fec8a46299da2d04f8f9f65bd565bbe85a2cd9`／
  tree `30858c7e6e7bb8e1e3298627c6b45b6b57293034`｜
  **下一步授權邊界**：merge body 僅記 ①②；③④ 之逐字 repo 載體**機械掃描未找到** →
  批 A 標 `CODE_SHIPPED / GOVERNANCE_CLOSEOUT_PENDING`，**不得宣稱 CLOSED**。
- **2026-07-18**｜commit **無**（本機 SPEC 收斂，未進 repo；SPEC 凍結 receipt 見 §9 表）｜
  **verdict**：owner 六項裁決 ＋ 三項 LOCK（`TREE-EQUALITY-LOCK`／`BUILD-LOCK`／`SELF-HASH-LOCK`）核發｜
  **finding 數**：對抗式 self-review 8 輪共 60 條全採納（過程產物，不入本檔）｜
  **anchor**：closeout-base `6aae95704cc151061cad0a05966d43f0d28c0eea`｜
  **下一步授權邊界**（**closeout PR 自身**）：`OWNER_RULINGS_COMPLETE_WITH_LOCKS` → `PLAN_DRAFT_ALLOWED`；
  `SPEC_APPROVED / CODING / branch / commit / push = NOT_ALLOWED`。
- **2026-07-19**｜commit **無**（PLAN 未進 repo）｜**verdict**：待 **closeout ①**｜**finding 數**：待 **closeout ①**｜
  **anchor**：PLAN 快照 receipt 見 `## 9` 表｜**下一步授權邊界**：`PLAN_DRAFT`，送 **closeout ①** 前不得 coding。
  （⚠ 以下為**流程順序參考**。依 ARCH-R2：**①②③ 之 receipt 依上方 append-only 規則追加進本 doc**；
**④ 及其後**之終局 receipt **非本 doc 之待填欄位**，一律只進 squash commit body：
  **closeout ①** `CHATGPT_ARCH_APPROVED` → **closeout ②** `CODEX_PLAN_APPROVED` → owner `CODING_ALLOWED` →
  `CODE_SELF_REVIEW_CLEAN` → **closeout ③** `CODEX_CODE_APPROVED` → **closeout ④** `CHATGPT_CODE_FAITHFULNESS_APPROVED` →
  owner `MERGE_ALLOWED` → `MERGED_MAIN`。）
- **2026-07-19**｜commit **無**（Plan Gate 審查標的＝repo-external frozen PLAN，receipt 見 `## 9` 表 PLAN 列）｜
  **verdict**（**closeout PR 自身**之 Plan Gate 兩道；來源＝交接 handoff 與 closeout ② packet 之 `CONTEMPORANEOUS_TRANSCRIPTION`，非外部逐字原文）：
  **closeout ①** `CHATGPT_ARCH_APPROVED`（R4）· **closeout ②** `CODEX_PLAN_APPROVED`（一輪過；「Approve — Plan Gate only」）｜
  **finding 數**：closeout ① R1 `CHANGES_REQUESTED`（6 blocking，含 3 Tier 1）→ RR2 `CHANGES_REQUESTED`（5 blocking，含 2 Tier 1）→
  RR3 `CHANGES_REQUESTED`（2 Tier 1 ＋ 2 non-blocking）→ R4 `APPROVED`（**0 Tier 0／0 Tier 1／0 blocking**）
  ＋ 2 carry-forward locks：`ARCH-CLOSEOUT-R4-1`（squash commit body 模板必須包含 `doc path`／`doc file mode`／`doc blob OID`／`doc SHA-256` 四欄；
  不要求修改目前 frozen PLAN，但 closeout ③／④ packet 必須驗證 merge-body 模板已含 `file mode` 欄；生效＝本 PR Code 階段）·
  `ARCH-CLOSEOUT-R4-2`（未來 `packet-disposition closeout` 軸解除 PLAN 跨 W3 凍結前，獨立複核收據須另記 `PLAN bytes`／`PLAN SHA-256`／
  與本 doc `## 9` PLAN receipt 之 match verdict 或語意等價之 repo-immutable 證明；屬未來 disposition 軸，不阻擋本 PR）
  ＋ 2 non-blocking notes（NB-1：不新增「依失範後果分級」獨立段落，§10.1 現有判準已足；NB-2：frozen PLAN 內殘留 pre-R17 gate-state
  文字不構成內容 finding、亦不得為此回改 frozen PLAN）；
  另 `ARCH-R6`〔SHA-256 位數〕由 closeout ① 於 R2 主動撤回——經位元組檢查確認差異在上傳表示層（CRLF）、非 receipt 錯誤
  （closeout ② packet 原文之 standalone 註記；其輪次隸屬與 blocking 計數之關係原文未載，不另推斷）
  · closeout ② **0 Tier 0／0 Tier 1／0 blocking**（九項提問全答通過；
  另附 3 條 non-blocking 執行註記：`ci.yml` 8 個 `run:` ＝ 1 個 `npm ci` setup ＋ 7 道品質 gate、`test:int` 實測 581.31 秒須背景執行、
  repo-local TypeScript governance manifest 不存在故相關 rule ID 維持 advisory／not-enforced）｜
  **anchor**：frozen PLAN `sha256=24ed55e51a3175c5deb14d619941a830532c46f7d822b25278e5382540e8f54c`（`94153` bytes／`1244` lines／CR `0`；
  closeout ① R4 對上傳副本之位元組檢查〔正規化為 LF 後〕與本 receipt 完全一致、closeout ② 所審亦同一 receipt）·
  closeout ② packet `sha256=5de7a61be15c6265db306a7e5b67514c48535a737a67e5d211fda5e4c7042540`（`11499` bytes）｜
  **下一步授權邊界**：closeout ② 明文**未核發** `CODING_ALLOWED`／Code Gate／merge／release authorization —— 四項須 owner 另行核發。
- **2026-07-20**｜commit `3bf1c7bc4f98872a5fef792e76fc4b5b94a2bc23`（**CODE-stage 首個 commit**＝byte-frozen carve-out 凍結錨點；依 carve-out 設計，
  該 SHA 由本 entry 於後續 append commit 記入可變面 §10.4——commit 不可能包含自身 SHA）｜
  **verdict**：owner 當輪明示核發 **`CODING_ALLOWED`**（2026-07-20）後落盤：本 doc 自 frozen PLAN §8 fence **純落盤**（零壓縮、零內容轉換），
  僅依 PLAN §7.3 填實 `## 9` receipt 表 SPEC／PLAN 兩列共 4 cell；該 commit 時點與 fence 原文之位元組差異**恰該 2 行**
  （fence 取出以 head＋取出內容＋tail 拼接後與 frozen PLAN cmp byte-identical，佐證取出無損），
  白名單制佔位符檢查通過（僅餘 `## 10.1` rollback 欄之命令模板）｜
  **finding 數**：CODE-stage 落盤自審（L1 單 agent 對抗式）末輪 **0 新發現**｜
  **anchor**：closeout-base `6aae95704cc151061cad0a05966d43f0d28c0eea`（branch 自此建出）｜
  **下一步授權邊界**：`CODE_SELF_REVIEW_CLEAN` → **closeout ③** `CODEX_CODE_APPROVED` → **closeout ④** `CHATGPT_CODE_FAITHFULNESS_APPROVED`
  → owner `MERGE_ALLOWED`；closeout ③ 核發後僅允許追加其 receipt 一則；closeout ④ 核發後本 doc（含 §10.4）一律禁止再修改；
  終局 receipt（closeout ④ verdict／`MERGE_ALLOWED`／`MERGED_MAIN`／本 doc 最終 blob OID＋SHA-256）僅進 squash commit body。

> ### ⚠ §10.4 為 **APPEND-ONLY RECEIPT AREA**（ARCH-R2 鎖定）
>
> - **既存 entry 禁修改、禁刪除、禁重排**；僅得依**本節前言所定 schema**（⚠ **此處刻意不複述** —— 同節 27 行內兩份列舉已現措辭分歧〔`commit SHA`／`commit`、`verdict 全文`／`verdict`〕，schema 增欄時亦須同步兩處）**追加**新 entry。
> - 每次 append **前後**須機械驗證既有 prefix **byte-identical**。
> - **closeout ③ 核發後**：僅允許追加「③ receipt」一則。
> - **closeout ④ 之審查標的＝包含該 ③ receipt 之最終 doc commit**。
> - 🚫 **④ 核發後，本 doc 一律禁止再修改**（含 §10.4）。
>
> ### ⚠ 終局 receipt 一律只進 squash commit body（不進本 doc）
>
> **closeout ④ verdict · owner `MERGE_ALLOWED` · `MERGED_MAIN` · 本 doc 最終 blob OID ＋ SHA-256**
> —— 以上全部**僅記於 squash commit body／PR merge metadata**。
> 〔理由（ARCH-R2 時序不可能性）：④ 核發後才能記 ④ verdict → 該寫入產生新 commit →
> 新 commit 已非 ④ 審查之 SHA；`MERGED_MAIN` 更不可能在自身 squash merge 前寫入本 doc；
> 且 merge 後若再改本 doc，**`## 9.3A`** 對 squash commit body hash 之比對將**永久失敗**
> （9.3A 為唯一依賴 squash body 者）。
> 故舊版「後續 dated 收錄至 `MERGED_MAIN`」之承諾**在單一 closeout PR 內不可實現，已刪除**。〕
>
> ⚠ 本 doc **不記錄自己的最終 commit SHA**（owner 裁決 4）。
