# Stage 7 · PR-2dw 批 B-read — `functions/api/admin/audit.ts` noImplicitAny 5 → 0

> **狀態讀法**（沿批 E `ARCH-E-R18-G1`；永久規則，🚫 本身不含任何會過期的值。
> 本段之 SoT 模型於 ① R1 `ARCH-BR-R1-STATE-SOT-CLOSURE-GAP` 後收窄，見 §14.2）：
>
> **兩個狀態各有其 SoT，邊界互斥且窮盡，🚫 不得互相推導：**
>
> | 狀態種類 | SoT 位置 | 本檔的角色 |
> |---|---|---|
> | **外部 gate verdict**（①②③④） | **本檔 §14 裁決 ledger** | 持有（append-only） |
> | **維度 A self-review closure**（`PLAN_SELF_REVIEW_CLEAN` ／ `CODE_SELF_REVIEW_CLEAN`） | **owner ／ workflow state，🚫 不在本檔** | 🚫 不持有、🚫 不可由本檔推導 |
>
> 🚫 本檔 §14 以外的任何章節**不複述**外部 gate 狀態。
> 🚫 本檔 **不自我宣告** self-review closure；§14.0 只記 finding 與處置之 **append-only 歷史**，
> 🚫 不記 closure、🚫 不持有「最新輪次／目前是否乾淨」之 live 副本。
> ⇒ 「唯一 SoT 在本檔」與「某必要狀態不在本檔」不再並存 —— 前者已限定為**外部 gate verdict**。
>
> **級別**：實作 L1 ／ 審查 care L2（沿批 D／E 先例；⚠ 任一 gate 得挑戰，疑義一律 fail-safe 升級）
> **維度 A self-review 形式**：**單 agent 對抗式**（owner 2026-08-22 當輪裁定；非 workflow）
> **base commit**：`acc98dfbeeed237533b5b844338b5798a148ce8f`（main）
> **base blob**（`functions/api/admin/audit.ts`）：`ec2a9b0795d500d72159988071807be86e8d049f`

---

## 1. 目的

把 `functions/api/admin/audit.ts` 的 **5 條 `noImplicitAny` 診斷清為 0**（`TS7006`×3 ＋ `TS7031`×2），
使該檔進入 ratchet 的 clean set。

**性質＝純 type-only**：全部改動皆為型別標註與型別宣告，**erase 後不產生任何語句**。
🚫 本棒**不**修改任何行為、不動 schema、不動 migration、不動測試、不動 caller、不動 SQL。

⚠ **證據與其範圍限定（`ARCH-BR-R2` 族，`SR-29`）**：上述性質之機械證據＝§6.3 的
**單檔 transpile emit byte-identical** ＋ §6.4 兩組負向控制。
該證據**只覆蓋本檔 transpile 後的 JS**，🚫 **不是** production bundle identity；
bundle 面由 §9.1 第 6 道 `build:functions` 守備。
🚫 本節不得被讀成「已證明 production 行為零差異」。

---

## 2. 定序位置

audit 域是 `noImplicitAny` 的**最後殘域**。定序（owner 定，producer-first ＋ destructive-last）：

```
A✅ → C✅ → C2✅ → D✅ → E✅ → 【B-read ← 本棒】 → F → G → H0 → H1 → I → K → L → B-delete → J1 → J2
```

### 2.1 ⚠ 字母 → 檔案對映之地位

16 單元的「字母 → 檔案」對映**從未落成 repo artifact**（依據＝批 E §2.1 所引 2026-08-12 窮盡搜尋之**結論**；
🚫 本棒未重驗其逐項計數，故只引用結論、不複述計數）。
批 C2 ① R2 已裁定：**「在字母對映證據不在 repo 的情況下猜字母，反而是不合格治理」**。

故本棒 scope **不是**由我推定字母得出，而是 **owner 於 SPEC 階段當輪裁定**（§3 `SPEC-B1`）。
本文件之後，「**批 B-read ＝ `functions/api/admin/audit.ts`**」這一組對映**首次成為 repo 內 artifact**。

#### 2.1.1 本棒新測得之結構關聯證據（⚠ 是**證據**，🚫 不是對其他單元的裁定）

批 E §2.1 記載 `B-read` / `B-delete` 屬「**零**關聯證據」之列。本棒 2026-08-22 之實測使該敘述**不再準確**，
依 [[feedback_verify_before_self_correction]] 於此逐字更正並附可重播量測：

> **母體 ＝ audit 殘域 12 檔全部**（零收窄、零啟發式排除；12 檔清單見 §6.2 註）
> **量測性質 ＝ 每檔 export 之 `onRequest*` handler 種類**
> **重播指令**：`grep -o "onRequest[A-Za-z]*" <每一檔> | sort -u`

實測結果：**5 檔為 util（無 handler）· 5 檔 `onRequestPost` · 恰 1 檔 `onRequestGet` · 恰 1 檔 `onRequestDelete`**
（5 ＋ 5 ＋ 1 ＋ 1 ＝ **12**，與母體規模相符 ⇒ 母體非空且無遺漏）；
且該 `Get` 檔（`functions/api/admin/audit.ts`）與該 `Delete` 檔（`functions/api/admin/audit/[id].ts`）
**同屬 route family `/api/admin/audit`**。

⇒ 殘域中「**一讀一刪、同 route family**」之配對**恰有一組且唯一**，與定序把 `B` 拆成
`B-read`（早）／`B-delete`（destructive-last）之形狀吻合。

**限定（依 [[feedback_scope_qualified_universal_claims]] 四項）**：
| 限定項 | 內容 |
|---|---|
| 適用範圍 | 僅 audit 殘域 12 檔；🚫 不含 repo 其他部分 |
| 生效時態 | 2026-08-22 於 `acc98dfb` 之量測；後續 commit 未涵蓋 |
| 例外集合 | 無（母體零排除） |
| closure | **不封閉** —— 「唯一配對」只證明*結構相符*，🚫 不證明字母對映本身 |

🚫 本節**不**裁定 `B-delete` 或任何其他單元的對映。

**對映帳（實測，🚫 非估數）**：16 單元中，**已落成 repo artifact 者 6 個** ——
`A`（`stage7-pr2dw-closeout-audit-aggregate-archive-ctx.md`）·
`C`（`…batchc-audit-policy-noimplicitany.md`）· `C2`（`…batchc2-audit-policy-type-spine.md`）·
`D`（`…batchd-user-audit-severity-parser.md`）· `E`（`…batche-audit-log-typing.md`）·
**`B-read`（本檔）**；
**未裁定者 10 個** —— `F` `G` `H0` `H1` `I` `K` `L` `B-delete` `J1` `J2`（6 ＋ 10 ＝ 16，帳平）。

未裁定 10 個之證據強度：`F` `G` `K` `J1` `J2` `B-delete` 為零／弱關聯；
`H0`↔`types/env.d.ts`、`H1/I/L`↔F-3 三檔 為未經 owner 裁定之中強度關聯。
（⚠ `B-delete` 現有 §2.1.1 之結構關聯證據，仍**未經裁定**。）

### 2.2 ⚠ 對「F-3 檔不得觸碰」表述之事實校正

坊間（含本棒接手 brief）常見表述為「F-3 檔未經授權不得觸碰」。查 memory `project_audit_phase2` 原文，
精確狀態為**兩條互相獨立的裁定**：

| 裁定 | 日期 | 實際約束 |
|---|---|---|
| **原 4 凍結檔已解凍** | 2026-05-29 | 硬凍結**已解除**；唯一條件＝動後維持 parity test ＋ canary fixture ＋ relevant gates 全綠，並以高敏感檔對待 |
| **DORMANT / wait-only** | 2026-06-11 | 禁**啟用 R2 lock**／禁新增固定 checkpoint／禁因 dry-run PASS 進 production retention posture／禁把 cron success 誤讀成 immutable retention 已上線 |

⇒ 準確約束是「**解凍但高敏感、parity 必續綠**」，**不是**對那三個 `.ts` 的 code freeze；
DORMANT 裁定的標的是 **R2 lock ／ retention posture**，不是原始碼。

**本棒之相關性**：**零**。§5.4 `B_EXCLUDES` 把 F-3 相關全部 6 檔列為零觸碰。
本節僅為避免後續 `H1` / `I` / `L` 棒次沿用不精確前提而記錄。

---

## 3. Owner 裁決紀錄（可追溯）

| 編號 | 事項 | 裁定 | 時點 |
|---|---|---|---|
| `SPEC-B1` | 批 B-read scope | **`functions/api/admin/audit.ts` 單檔**（同時裁定「B-read ＝ 該檔」落成 repo artifact）。落選候選：aggregate 純函式雙檔（32 條）／aggregate 全家族 4 檔（58 條）／前二者合併 3 檔（37 條） | 2026-08-22 |
| `SPEC-B2` | 維度 A self-review 形式 | **單 agent 對抗式**（同批 D／E；非 multi-agent workflow） | 2026-08-22 |
| `SPEC-B3` | 是否一次裁定殘域 12 檔完整字母對映 | **否，維持逐棒裁定**（只裁本棒；**其餘 10 單元**維持未裁定，帳見 §2.1.1） | 2026-08-22 |

`SPEC-B1` 之候選比較依據（各案錯誤數／destructive 命中／F-3 接觸面）為 2026-08-22 於 `acc98dfb` 之實測。

---

## 4. 設計

### 4.1 新增型別宣告（module-local，🚫 不 export）

**以下為將被插入之逐字內容**（自 §6.3 overlay 快照 `sha256 = 79792231…` 之 line 45–70 原樣取出，
**恰 26 行**＝ JSDoc 15 ＋ `interface` 10 ＋ 尾隨空行 1；行數與 §5.5 hunk 1 之計數互證）：

```ts
/**
 * 本檔 `audit_log` 查詢的**投影列**（projection），🚫 不是 `audit_log` 資料表的完整結構 ——
 * 表自 migration 0038 起另有 `archived_at` / `cold_class`，本查詢未投影、故不在此宣告內。
 * 欄位型別依 migration 0017 之 DDL（`event_type` / `severity` / `created_at` 為 NOT NULL；
 * `user_id` / `client_id` / `ip_hash` / `event_data` 可為 NULL）。
 *
 * ⚠ 本宣告**未經編譯期檢查**：本 repo 未安裝 `@cloudflare/workers-types`，
 * `Env['chiyigo_db']` 解析為 `any`，TypeScript 無從驗證實際 row 與此形狀相符。
 * 唯一保證＝下方 SELECT 欄位清單與本宣告必須同步維護。
 * 🚫 不得據此宣稱「D1 row 已型別化」。
 *
 * ⚠ 命名：🚫 不叫 `AuditLogRow` —— 該名已由 `utils/audit-log.ts` 用於 `admin_audit_log`
 * （hash-chain 表），與本表 `audit_log` 是**不同的表**。前綴沿 `user-audit.ts` 的
 * `UserAuditEnv` / `UserAuditEntry` 家族（該模組即本表的寫入端）。
 */
interface UserAuditRow {
  id: number
  event_type: string
  severity: string
  user_id: number | null
  client_id: string | null
  ip_hash: string | null
  event_data: string | null
  created_at: string
}

```

**落點（gate ③ 可逐字核對）**：插在 `const SAFE_EVENT_DATA_KEYS = new Set([...])` 之後、
`function redactEventData` 之前。🚫 不動既有任何一行的相對順序。

⚠ **JSDoc 為 load-bearing、🚫 不得於 review 中被當成可省的裝飾刪除** —— 它承載 §4.4 的四條範圍限定
（尤其「不是表結構 SoT」「未經編譯期檢查」），刪掉等於讓宣告脫離其誠實標示。

**為何 module-local 不 export**：本檔無跨檔 consumer 需要它（本檔 export 面＝僅 `onRequestGet`）。
沿 PR-2do／PR-2dq／批 E「zero export 優先、最小公開面」慣例。
⚠ 此為**本棒**之選擇；後續棒次若真有跨檔需求，得另行決定是否提升為 export。

### 4.2 三處標註 — 逐條對應 base 5 條診斷

**母體 ＝ base（`acc98dfb`）`tsc -b tsconfig.solution.json --force` 對本檔的全部 5 條診斷**（零收窄）。
5/5 逐條有對應處置、無遺漏、無額外：

| # | base `line,col` | 診斷 | 目標 | 處置 | 機制 |
|---|---|---|---|---|---|
| 1 | `45,26` | `TS7006` `raw` | `redactEventData` | `raw: unknown` | 直接標註 |
| 2 | `61,38` | `TS7031` `request` | `onRequestGet` | `{ request, env }: { request: Request; env: Env }` | 直接標註 |
| 3 | `61,47` | `TS7031` `env` | `onRequestGet` | 同上（單一標註消兩條） | 直接標註 |
| 4 | `134,39` | `TS7006` `r` | `rawRows.filter` | `const rawRows: UserAuditRow[] = …` | **contextual typing**（§4.3） |
| 5 | `135,33` | `TS7006` `r` | `filteredRows.map` | 同上（單一標註消兩條） | **contextual typing**（§4.3） |

⇒ **標註處恰 3 個 ＋ 型別宣告 1 個**，清 5 條診斷。

### 4.3 `B-OD-1`：型別下在**邊界**（`rawRows`）而非兩個 callback 參數 —— 有實測背書之設計決策

> ⚠ **軸的分離（`SR-22`）**：本節的 `v1` / `v2` **只區分「標註位置」軸**（callback 參數 vs 邊界宣告）。
> 型別**名稱**軸是獨立的一件事，見 §4.3.1 `B-OD-2`。
> **最終落地 ＝ 本節 v2 之標註位置 ＋ `B-OD-2` 之名稱**，其 anchor 為 §6.3 之 `79792231…`。
> 🚫 勿把 §6.3 anchor 誤讀成「本節 v2 當時那份檔案」（該份已被改名取代）。
> 兩軸正交之證據：改名前後 emit sha256 皆為 `10c1d1f8…`（名稱屬型別層、全部 erase）。

考慮過的兩案，**皆經完整量測**（§6.4 負向控制其一即為落選案）：

| 案 | 形式 | 診斷結果 | emit |
|---|---|---|---|
| **v1（落選）** | `rawRows.filter((r: UserAuditRow) => …)`、`.map((r: UserAuditRow) => …)` | REMOVED 5／ADDED 0 ✅ | **6603 B、非 byte-identical ❌** |
| **v2（採用）** | `const rawRows: UserAuditRow[] = rowsResult?.results ?? []` | REMOVED 5／ADDED 0 ✅ | **6599 B、byte-identical ✅** |

**v1 為何動到 emit**：替 arrow function 的**單一參數**加型別標註，語法上強制加括號
（`r => …` 必須寫成 `(r: T) => …`），TypeScript emitter **保留該括號形式** ⇒ emit 產生
`(r) => …`、每處 +2 bytes、兩處共 **+4 bytes**。逐字 diff 見 §6.4.2 —— 差異恰 2 行、
內容**僅**多出 `(` 與 `)`，屬 ECMAScript 層 no-op，但**「byte-identical emit」宣稱在 v1 之下為假**。

**v2 之額外優點（非事後合理化，皆可由型別檢查驗證）**：
1. 標註點 4 → 3；`r` 兩處由 `Array<T>.filter/map` 的 contextual typing 自然取得型別。
2. `filteredRows` 隨之成為 `UserAuditRow[]`（v1 之下仍為 `any`，因 `any.filter()` 回 `any`）
   ⇒ v2 的型別資訊實際上**多於** v1。
3. 型別宣告落在 **D1 結果進入本模組的那一行**，與 §安全要求「邊界驗證一次後才進 domain」之
   位置慣例一致（⚠ 精確表述：這是**型別標註**位置的一致，🚫 **不是** runtime validation，本棒未新增任何驗證）。

🚫 **不得**把 v2 讀成「已對 D1 row 做驗證」。見 §4.4 之範圍限定。

### 4.3.1 `B-OD-2`：型別名為何是 `UserAuditRow` 而非 `AuditLogRow`（**避免同字串異概念**）

> **母體 ＝ `functions/` ＋ `tests/` ＋ `types/` 全部**（零收窄）
> **重播指令**：`grep -rn "AuditLogRow\|UserAuditRow\|AuditLogEntry" functions/ tests/ types/`

**實測命中**：`functions/utils/audit-log.ts:30` 已存在
`type AuditLogRow = AuditLogEntry & { created_at: string }`（批 E 引入）。

⚠ **關鍵事實：兩者指涉不同的資料表**（皆經本棒實測）：

| 型別 | 檔 | 資料表 | 佐證 |
|---|---|---|---|
| `AuditLogRow`（既有） | `utils/audit-log.ts` | **`admin_audit_log`**（hash-chain） | 同檔 `INSERT INTO admin_audit_log`（L97）／`SELECT … FROM admin_audit_log`（L75） |
| `UserAuditRow`（本棒新增） | `api/admin/audit.ts` | **`audit_log`**（user 端事件） | 本檔 SELECT（§4.5）；寫入端＝`utils/user-audit.ts` `INSERT INTO audit_log`（L123/160/177） |

本檔既有 header 亦已明載兩表分離：「查詢 `audit_log` 表（一般 user 端事件，**與 `admin_audit_log` 分離**）」。

⇒ 沿用 `AuditLogRow` 會造成**同一識別字串在 audit 域指涉兩張不同表**，違反
[[feedback_state_machine_naming_no_alias]] 之「同概念同名」精神的**對偶面**（異概念不得同名）。
兩者雖皆 module-local、無編譯期衝突，但對讀者與 grep 皆是陷阱。

**採用 `UserAuditRow` 之兩個理由（皆可驗證）**：
1. **家族對齊**：`utils/user-audit.ts`（本表**唯一的列產生端**，見下方母體量測）已有
   `UserAuditEnv` / `UserAuditEntry` 家族 ⇒ 讀取端沿用 `UserAudit*` 前綴，讀寫兩側同一詞彙。
2. **grep 可完全分離**：`'UserAuditRow'.includes('AuditLogRow') === false`。
   ⚠ **落選名 `UserAuditLogRow` 正因此被否決** —— `'UserAuditLogRow'.includes('AuditLogRow') === true`，
   對 `AuditLogRow` 的 grep 仍會命中它，等於沒解決問題。

**名稱可用性**：`grep -rn "UserAuditRow" functions/ tests/ types/` ⇒ **0 命中**（未佔用）。

#### 4.3.1.1 `audit_log` 寫入端母體（**實測**；支撐上方第 1 點）

> **母體 ＝ `functions/` 全部 `.ts`**（零收窄）
> **性質 ＝ 對 `audit_log` 表之任何寫入語句**（INSERT ∪ UPDATE ∪ DELETE —— 🚫 不只看 INSERT，
> 否則母體會小於所宣稱的「寫入」性質）
> **重播指令**：`grep -rn "INSERT INTO audit_log\b" functions/ --include=*.ts` ／ 同法各查 `UPDATE audit_log\b`、`DELETE FROM audit_log\b`

| 寫入型態 | 命中 | 位置 |
|---|---|---|
| `INSERT` | **3**（同一檔） | `utils/user-audit.ts:123` · `:160` · `:177` |
| `UPDATE` | **1** | `api/admin/cron/audit-archive.ts:806`（archive 標記，非產生新列） |
| `DELETE` | **1** | `api/admin/audit/[id].ts:66`（＝ `B-delete`，非本棒） |

> ⚠ **自審更正（`SR-25`）**：上方第 1 點初稿曾寫「`user-audit.ts` 是本表**唯一寫入端**」，
> **經量測證偽** —— 它是唯一的 **INSERT／列產生**端，但 `audit_log` 另有 1 個 `UPDATE` 與 1 個 `DELETE` 寫入者。
> 已改為精確表述「唯一的列產生端」。
> 教訓＝全稱宣稱的**性質**（「寫入」）必須與**母體**（我只掃了 INSERT）對齊
> ——[[feedback_guard_population_must_cover_property]] 之同一族，本棒第 9 次復發。

### 4.4 ⚠ `UserAuditRow` 的宣稱範圍限定（誠實記錄）

`UserAuditRow` 是**本檔該筆查詢的投影列（projection）**，其 8 欄逐一對應 §4.5 之 SELECT 欄位清單。

**它不是什麼**（逐條否定，🚫 不得被讀成更強的宣稱）：

1. 🚫 **不是** `audit_log` 資料表結構的 SoT。該表自 migration `0038_audit_log_phase2.sql` 起
   另有 `archived_at TEXT` 與 `cold_class TEXT NOT NULL DEFAULT 'immutable'`，本查詢未投影、故不在宣告內。
2. 🚫 **不是**經編譯期檢查的保證。本 repo **未安裝 `@cloudflare/workers-types`**
   （**本棒實測**，🚫 非引用他棒：母體＝`package.json` 之 `dependencies` ＋ `devDependencies`
   全部 **17** 項、零收窄，含 `workers-types` 者 **0** 項）⇒ `Env['chiyigo_db']` 解析為 `any`
   ⇒ `db.prepare(...).all()` 回 `any` ⇒ `const rawRows: UserAuditRow[] = <any>` 是**未經檢查的賦值**。
   TypeScript 無從驗證實際 row 與此形狀相符。
3. 🚫 **不是** runtime validation。本棒未新增任何 schema 驗證、未改變任何錯誤路徑。
4. 🚫 `severity: string` **不**表達 DDL 之 `CHECK(severity IN ('info','warn','critical'))`。
   刻意不用 union：`severity` 在本檔**未被讀取**（僅隨 spread 原樣回傳），
   用 union 會建立一個本檔無法驗證、也無人消費的更強宣稱。

**唯一實質保證**：SELECT 欄位清單與本宣告必須**同步維護**（改一邊必改另一邊）。
此保證為**人工紀律，無機械強制**；🚫 不得宣稱其為 gate。

⚠ **連帶效果（沿批 E §4.2 同一誠實記錄）**：`db` / `rowsResult` / `countRow` 仍為 `any`。
本棒收益＝消除 `noImplicitAny` 診斷 ＋ 標示參數與投影契約，🚫 **不得**宣稱「D1 row 已型別化」。

#### 🔒 `UNSAFE-BOUNDARY-REGISTRY`（② R1 `TS-BOUNDARY-002` 之處置；本棒唯一登錄項）

> ② R1 判定 `const rawRows: UserAuditRow[] = <any>` 為 **D1 legacy interop 邊界之 type laundering**，
> 並指出「JSDoc 誠實揭露 ＋ 文字 suppression 為零」**不能取代** unsafe-boundary registry。
> ⚠ repo **無** TypeScript governance manifest／unsafe-boundary registry（本棒實測：
> `git ls-files | grep -iE '(^|/)AGENTS?\.md$'` ⇒ **0 命中**；`governance/rules.json` 不存在）。
> **沿批 E `UB-E-1` 之 gate-approved 先例**（該棒 ② R3 明示「明確登錄此 unsafe boundary」，
> 且因 SCOPE-LOCK 禁新增 repo 治理檔而**把登錄置於 PLAN 內**）：本登錄同置於 PLAN。
> ⇒ **不新增檔案、不改 `FINAL_PR_CHANGED_FILES`、不改 production design、不改 overlay anchor。**

| 欄位 | 值 |
|---|---|
| **id** | `UB-B-1` |
| **位置（scope）** | `functions/api/admin/audit.ts` · 單一行 `const rawRows: UserAuditRow[] = rowsResult?.results ?? []`。🚫 不涵蓋本檔其他行、🚫 不涵蓋其他檔 |
| **形式** | **unchecked assignment**（`any` → 具名型別之隱式賦值），🚫 **不是** `as` cast。⚠ 與批 E `UB-E-1`（`err as ErrorLike`）**形式不同** —— 這正是 §5.6 舊預算漏掉它的原因，見該節 errata |
| **未驗證假設（reason 之對象）** | D1 回傳列確實具備本宣告之 8 欄及其型別。TypeScript **無從驗證**：repo 未裝 `@cloudflare/workers-types`（實測 17 個依賴 0 命中）⇒ `Env['chiyigo_db']` 解析為 `any` ⇒ `.all()` 回 `any` ⇒ 賦值恆合法 |
| **安全論證（evidence；唯一成立的那一種）** | **標註全部 erased ⇒ 不新增任何 runtime 行為 ⇒ 相對 base 不新增 failure mode。** 機械證據＝§6.3 之 emit byte-identical（`10c1d1f8…`，6 道守衛全 fail-closed）。⚠ 這是**相對 base 的差分論證**，🚫 **不是**「這段程式碼安全」的絕對宣稱 |
| **仍然存在的既有 failure mode（本棒 🚫 不 harden）** | 若 D1 列缺 `event_type`／型別不符：`canRoleSeeAuditEvent(eventType: unknown, role)`（`functions/utils/roles.ts:73-81`，本棒實測逐字）僅在 `role === 'support'` 分支做 `typeof !== 'string' → return false`；**其餘角色一律 `return true`**（L80 註解明載「audit 內容不再裁切」）。⇒ 非 support 角色不因欄位缺失而被擋。**此為 base 既有行為，本棒不改善也不惡化。** |
| **未涵蓋** | 🚫 不保證欄位存在／型別／非空；🚫 不做輸入驗證；🚫 不構成 D1 row 之型別契約；🚫 不宣稱該路徑 exception-free |
| **recheck trigger（任一成立即須重審本登錄）** | ① 本檔 SELECT 欄位清單變更 ② `migrations/*` 改動 `audit_log` 結構 ③ 安裝 `@cloudflare/workers-types`（`any` 消失⇒賦值將被真檢查） ④ `strict: true` 落地 ⑤ 本行被移動或改寫 |
| **為何不改用 runtime validation** | 會破 type-only 性質（emit 不再 byte-identical）、需補測試、需重測 anchor；且 `SPEC-B1` 之 scope 是 `noImplicitAny` 清零、**不是** D1 邊界硬化 ⇒ 外送 `TD-BATCHB-3`（§10.3） |

> 📌 **ADDENDUM（coding 階段 `SR-59`；🚫 上表內文未改寫，保留 ①② 審查軌跡）**
>
> 上表「未驗證假設」欄把成因寫成**單一條件**（未安裝 `@cloudflare/workers-types`）。
> coding 階段追查實際機制，發現是**兩個條件的合成**：
> 1. `D1Database` 在本 repo **無任何宣告來源** —— `types/` 內 0 命中；
>    `node_modules/@cloudflare/` 僅 `kv-asset-handler`／`vitest-pool-workers`／`workerd-windows-64`。
> 2. `types/env.d.ts:23` 之 `chiyigo_db: D1Database` 之所以不噴 `TS2304`，
>    **是靠 `tsconfig.functions.json` 的 `skipLibCheck: true`**（`.d.ts` 內的錯誤被跳過）。
>    此機制在本 repo 既有註解中已載明：`functions/utils/auth.ts:127`
>    「裸 `D1Database` 在 source `.ts` 不可解析（僅 `env.d.ts` 靠 `skipLibCheck` 過）」。
>
> ⇒ **結論方向不變**（`Env['chiyigo_db']` 解析為 `any`、賦值未經檢查、`UB-B-1` 成立），
> 但上表 recheck trigger 少列一個成因。**新增 trigger ⑥**：
> **`tsconfig.functions.json` 之 `skipLibCheck` 由 `true` 改為 `false`**
> （屆時 `types/env.d.ts` 自身會先失敗，`any` 之來源鏈改變 ⇒ 須重審本登錄）。
>
> ⚠ 本 addendum **🚫 不改 production code、🚫 不改 overlay anchor `79792231…`、🚫 不改 `FINAL_PR_CHANGED_FILES`**。

### 4.5 SELECT 欄位清單 ↔ 宣告之逐欄對照（gate ③ 可逐字核對）

base `functions/api/admin/audit.ts:121` 之 SELECT：

```sql
SELECT id, event_type, severity, user_id, client_id, ip_hash, event_data, created_at
FROM audit_log
```

| SELECT 欄 | migration `0017_audit_log.sql` DDL | `UserAuditRow` |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | `number` |
| `event_type` | `TEXT NOT NULL` | `string` |
| `severity` | `TEXT NOT NULL DEFAULT 'info'` ＋ `CHECK(...)` | `string`（見 §4.4 第 4 點） |
| `user_id` | `INTEGER REFERENCES users(id) ON DELETE SET NULL` | `number \| null` |
| `client_id` | `TEXT`（可 NULL） | `string \| null` |
| `ip_hash` | `TEXT`（可 NULL） | `string \| null` |
| `event_data` | `TEXT`（可 NULL） | `string \| null` |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `string` |

⚠ **`| null` 在本棒之下無型別效力**：solution 目前 `strict: false`（僅 `noImplicitAny: true`）
⇒ `strictNullChecks` 未開 ⇒ `T | null` 塌陷為 `T`。保留 `| null` 是**為 Stage 7 終態
（`strict: true`）預先寫對**，並如實標示其今日為 no-op。🚫 不得宣稱今日已有 null 保護。

**schema drift 掃描（母體宣告）**：
> **母體 ＝ `migrations/*.sql` 全部 57 檔**（零收窄）
> **重播指令**：`grep -rn "ALTER TABLE audit_log\b" migrations/*.sql`
> **結果**：恰 2 命中，皆在 `0038_audit_log_phase2.sql:20-21`（`archived_at` / `cold_class`）
> ⇒ 已於 §4.4 第 1 點納入處置（未投影 ⇒ 不入宣告）。

### 4.6 為何 handler 用 inline 物件型別而非具名 alias

**母體 ＝ `functions/**/*.ts` 全部**（零收窄）
**重播指令（⚠ 需 GNU grep；`-E` 不可省 —— 用 basic grep 跑 `|` alternation 會得到 0 命中的假綠）**：
```bash
grep -rEn "onRequestGet\s*\(\s*\{[^}]*\}\s*:" functions --include=*.ts       # 正向：既有寫法
grep -rEn "type .*Ctx\b|interface .*Ctx\b|HandlerCtx|RequestCtx" functions --include=*.ts   # 反向：具名 alias
```
**結果（🚫 未截斷；`SR-26` 之處置）**：

> ⚠ **自審更正（`SR-26`）**：本節初稿之「一律 inline」係看了 `head -12` 的**截斷輸出**就下的全稱斷言。
> 已改為對**完整母體**量測。教訓＝`head -N` 之後不得下全稱結論
> ——[[feedback_guard_population_must_cover_property]] 同一族，本棒第 10 次復發。

**已標註型別之 `onRequest*` handler 母體 ＝ 143 個**，型別寫法分布（合計 143，帳平）：

| 寫法 | 數量 |
|---|---|
| `{ request: Request; env: Env }` ← **本棒採用** | **99** |
| `{ request: Request; env: Env; params: Record<string, string> }` | 32 |
| `{ request: Request; env: Env; waitUntil?: (promise: Promise<unknown>) => void }` | 3 |
| `{ request: Request; env: Env; next: () => Promise<Response> }` | 3 |
| `{ request: Request }` | 3 |
| `{ env: Env }` | 2 |
| `{ request: CfRequest; env: Env }` | 1 |

**反向掃描**（冒號後不是 `{` 者，即非 inline 物件型別）：**0 命中**。
**具名 ctx alias 掃描**：**0 命中**。

⇒ 「既有寫法**全部**為 inline 物件型別」現有完整母體背書；且本棒採用的
`{ request: Request; env: Env }` 是 **99/143 的多數形式**，非自創。
⇒ 本棒沿用之以維持命名 SSOT，🚫 不新創具名 alias（沿 [[feedback_state_machine_naming_no_alias]] 之同概念同名精神）。

### 4.7 為何 `redactEventData(raw: unknown)` 而非具體型別

`raw` 的實際來源＝ `r.event_data`（`string | null`），但函式體對輸入採**完全防禦**：
`raw == null` → `null`；`JSON.parse(String(raw))` 包在 `try/catch`；非物件／陣列 → `null`。
`unknown` 精確表達「不對輸入作任何假設」，且 `String(unknown)` 合法。

⚠ 若改標 `string | null`（今日塌陷為 `string`），等於**宣稱**呼叫端保證非空字串 —— 該宣稱在
`db` 為 `any` 的前提下無法背書。沿批 E `E-OD-1` 同一取捨（不確定的契約標 `unknown`，不標更強型別）。

---

## 5. Exact change scope

### 5.1 Production allowlist（恰 1 檔）

```
functions/api/admin/audit.ts
```

### 5.2 Tests / fixtures allowlist（**空集合**）

本棒**不新增、不修改任何測試檔或 fixture**。理由見 §8。

### 5.3 Governance allowlist（恰 1 檔）

```
docs/plans/stage7-pr2dw-batchb-read-admin-audit-noimplicitany.md   ← 本檔
```

依 memory SoT `feedback_codex_review_workflow` §7 **2026-07-18 amendment 規則 1**
（plan doc 自 SPEC 起納入 allowed changed-files），本檔**必須**隨 code PR 落地，
以免 ship 後須另開 docs-only closeout PR。

### 5.4 明確排除 —— `B_EXCLUDES`

以下**零觸碰**（🚫 一行都不改）：

| 排除項 | 理由 |
|---|---|
| `functions/utils/audit-archive.ts` | F-3 derive 公式核心（高敏感，見 §2.2） |
| `functions/utils/audit-aggregate-archive.ts` | 同上 |
| `functions/utils/audit-aggregate-archive-runner.ts` | 同上 |
| `functions/api/admin/cron/audit-archive.ts` | R2 archive pipeline runtime |
| `functions/api/admin/audit-archive/retry.ts` | force_purge／R2 lock（destructive） |
| `functions/api/admin/audit-aggregate-archive/retry.ts` | 同上 |
| `functions/api/admin/audit/[id].ts` | **destructive-last**；屬 `B-delete`，非本棒 |
| `functions/utils/audit-aggregate{,-debug}.ts` | 非本棒 scope（`SPEC-B1` 落選案） |
| `functions/api/admin/cron/audit-aggregate{,-debug}.ts` | 同上 |
| **`functions/utils/audit-log.ts`** | ⚠ §4.3.1 雖**討論**其既有 `AuditLogRow`，但本棒 **🚫 不改它、不改名、不動一行**。`B-OD-2` 的處置方式是**本棒新型別避開該名**，🚫 不是重構既有型別（那會擴大到批 E 已 ship 的檔，＝ scope creep） |
| `tsconfig*.json` | 不動 leaf 設定；不動 `strict` / `noImplicitAny` |
| `scripts/typecheck-ratchet.mjs` ＋ `types/typecheck-baseline.json`（實測路徑，見 `typecheck-ratchet.mjs:109` `BASELINE_PATH`） | **baseline `1119/175` 凍結，🚫 永不 `--update`** |
| `CLEANUP_PLAN.md` | untracked 治理草稿，🚫 永不 stage |
| 任何 `migrations/*.sql` | 無 schema 變更 |
| 任何 `.github/workflows/*` | 無 CI 變更 |

**🚫 治理 scanner／gate script 不得進 repo、不得進 CI。** 本棒之量測腳本（`emit-identity.mjs`）
刻意留在 session scratchpad，其**可獨立執行之等效版本內嵌於 §6.6**（量測邏輯與守衛逐字相同，
僅輸出格式化較精簡；🚫 非逐字全文複製）供外部自行重播 —— 這是**診斷器**，
🚫 不是 gate、🚫 不自我認證（依 [[feedback_guard_population_must_cover_property]] 之 2026-08-21 升級）。

### 5.5 `FINAL_PR_CHANGED_FILES` — diff shape（**可證偽**；coding 階段須逐項對上）

```
A  docs/plans/stage7-pr2dw-batchb-read-admin-audit-noimplicitany.md    ← 新增（本檔於 base 不存在）
M  functions/api/admin/audit.ts
```

> ⚠ **`MEMORY.md` 不在此清單內，且不應在**（① R1 條件式提問之解答，**本棒實測**）：
> 本專案的 `MEMORY.md` 位於 **repo 外之 agent-local 路徑**
> `~/.claude/projects/C--Users-User-Desktop-chiyigo-com/memory/`，
> `git ls-files --error-unmatch MEMORY.md` **不存在**、repo 工作樹亦無此檔
> ⇒ 對它的任何更新**不影響本 PR 的 changed-files**，「恰 2 檔」不變。
> 其地位與清理義務見 §14.2.4。

**恰 2 檔**。`functions/api/admin/audit.ts` 之 hunk shape —— ⚠ 下列**不是預測，是對 §6.3 overlay 快照
（`sha256 = 79792231…`）與 base blob 之實測 `diff -u` 結果**：

| hunk | `@@` 標頭（實測） | 位置 | 變化 |
|---|---|---|---|
| 1 | `@@ -42,7 +42,33 @@` | `redactEventData` 之前 ＋ 其簽章行 | `+27 / -1`（JSDoc 15 行 ＋ interface 10 行 ＋ 空行 1 行 ＋ 改寫後簽章 1 行） |
| 2 | `@@ -58,7 +84,7 @@` | `onRequestGet` 簽章行 | `+1 / -1` |
| 3 | `@@ -127,7 +153,7 @@` | `const rawRows` 行 | `+1 / -1` |

**實測合計 `+29 / -3`。**（27＋1＋1 ＝ 29；1＋1＋1 ＝ 3，帳平）

> ⚠ **自審更正（`SR-1`）**：本節初稿曾寫「預測 `+23 / -3`、hunk 1 為 `+21/-1`」，係**目測推估、未量測**，
> 與實測不符。已改為實測值。教訓＝可量測的東西不得用推估寫進 normative 章節
> （同批 E「母體 < 性質」族：以我腦中的計數代替真實母體）。

coding 階段須以 `git diff --stat` 對上 `+29 / -3` 與上列三個 `@@` 標頭；
不符即為 scope 偏離，須停手回報而非默默接受。

### 5.6 Suppression 預算（人工計數，供 gate 覆核）

| 項目 | 預算 | 實際（overlay 實測） |
|---|---|---|
| `: any` / `as any` / `<any>` 等 ratchet `BAN_PATTERNS` | **0** | 0 |
| `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` | **0** | 0 |
| non-`any` 型別 assertion（`as T`） | **0** | 0 |
| **unchecked assignment（`any` → 具名型別，隱式）** | **1** | **1**（`UB-B-1`，見 §4.4） |
| 新增 `eslint-disable` | **0** | 0 |

⚠ `BAN_PATTERNS` 不涵蓋 non-`any` `as`（§7.2），故該列以**人工計數**補位。
重播指令：`grep -nE "\bas\s+[A-Za-z]|: any|as any|@ts-(ignore|expect-error|nocheck)" functions/api/admin/audit.ts`

> 🚨 **errata（② R1 `TS-BOUNDARY-002` 之根因；`SR-35`）**：本表初版**只有 `as T` 一列**，
> 並據以宣稱「suppression 全為 0」。但 `const rawRows: UserAuditRow[] = <any>` 是
> **隱式的 unchecked assignment，不含 `as`**，因此既不被 `BAN_PATTERNS` 攔、也不被上述 grep 命中
> ⇒ **它落在預算母體之外，卻是本棒最強的型別宣稱。**
> 這是本棒第 11 次「母體 < 性質」：我把母體定義成「**文字上的** suppression 語法」，
> 而要保護的性質是「**未經檢查的型別宣稱**」—— 後者包含前者但不等於前者。
> ⇒ 已補上該列並登錄 `UB-B-1`。
> ⚠ 補充重播指令（母體含隱式賦值）：
> `grep -nE ":\s*[A-Z][A-Za-z0-9_]*(\[\])?\s*=" functions/api/admin/audit.ts`
> —— ⚠ 此 pattern 是**啟發式**（會命中無害的已檢查賦值），🚫 不得當機械閘；
> 真正的判準是「RHS 是否為 `any`／`unknown` 而未經 narrowing」，須人工判讀。

---

## 6. `MEASURED_OVERLAY` 證據

> ⚠ **全節數值皆為 2026-08-22 於 base `acc98dfb` 之實測**，🚫 非預測、🚫 非沿用他棒數字。
> ⚠ 本節是**診斷器輸出 ＋ 外部可自行重播之 recipe**，🚫 **不是**自我認證 gate。
> 依 [[feedback_guard_population_must_cover_property]]：信任錨點在 **git object**（content-addressed，
> 對方可自行 `git cat-file`）與**外部 gate 自行重跑**，🚫 不在我手上。

### 6.0 dual-leaf 的**實際**行為（沿批 E §6.0；本棒獨立複驗）

`functions/**` 同時被 `tsconfig.functions.json` 與 `tsconfig.tests.json` 收錄，
但兩者的 `noImplicitAny` **不同**（**本棒逐字 `JSON.parse` 讀 config 實測**，🚫 非引用批 E）：

| leaf | `noImplicitAny` | `strict` | include `functions/**` |
|---|---|---|---|
| `tsconfig.functions.json` | **`true`** | `false` | ✅ |
| `tsconfig.tests.json` | **`false`** | `false` | ✅ |
| `tsconfig.json`（root，非 solution 成員） | `false` | `false` | ✅ |

⇒ **`TS7xxx` 只由 functions leaf 產出、每條恰一次、無 dual-leaf 重複**；
**base check（`TS2xxx`）兩 leaf 皆啟用 ⇒ `functions/**` 的此類診斷成雙**。

**本棒之獨立佐證**（§6.4.1 負向控制實得）：注入一個 `TS2345` 後，
該診斷 raw ＝ **2**、distinct 位置 ＝ **1** ⇒ 與上表推論一致。

### 6.1 診斷 set-diff（line-shift robust）

> **母體 ＝ base 352 條 ／ overlay 347 條之全部診斷**（零收窄、非只看目標檔、非只看 functions/）
> **正規化 ＝ 刪去 `(line,col)` 後之 `file + code + message` 多重集**
> **為何必須正規化**：本棒在 `redactEventData` 之前**淨插入 26 行**（§5.5 實測 hunk 1）⇒ 其後所有行號位移；
> 以 `file(line,col)` 直接比對會產生大量假 REMOVED／假 ADDED
> （依 [[feedback_tsc_setdiff_must_be_line_shift_robust]]）。

```
REMOVED（base 有、overlay 無）＝ 5
  functions/api/admin/audit.ts: error TS7006: Parameter 'r' implicitly has an 'any' type.
  functions/api/admin/audit.ts: error TS7006: Parameter 'r' implicitly has an 'any' type.
  functions/api/admin/audit.ts: error TS7006: Parameter 'raw' implicitly has an 'any' type.
  functions/api/admin/audit.ts: error TS7031: Binding element 'env' implicitly has an 'any' type.
  functions/api/admin/audit.ts: error TS7031: Binding element 'request' implicitly has an 'any' type.

ADDED（overlay 有、base 無）＝ 0
```

⚠ **`ADDED = 0` 是 repo-wide 的宣稱**（母體含 `tests/**` 與全部 `functions/**`，非只本檔）。
本棒全部 REMOVED 皆為 `TS7xxx` ⇒ 依 §6.0，**raw 即真實數**（無 dual-leaf 加倍）。

### 6.2 ratchet

| | errors ¹ | clean files ¹ | dirty files ² | total ¹ |
|---|---|---|---|---|
| base | 352 | 325 | 12 | 337 |
| **overlay（實測）** | **347** | **326** | **11** | 337 |

¹ `npm run typecheck:ratchet:report` **直接輸出**（`errorCount` / `cleanFiles` / `sourceFilesTotal`）。
² **推導值**：dirty ＝ 有診斷的相異檔數（由全量診斷分組得出）。🚫 ratchet 不直接輸出 dirty，引用時須標明為推導值。

逐字輸出（base）：
```
errorCount      : 352
  fileErrors    : 352
  globalErrors  : 0
errorFiles      : 12
cleanFiles      : 325
sourceFilesTotal: 337
```
逐字輸出（overlay）：
```
errorCount      : 347
  fileErrors    : 347
  globalErrors  : 0
errorFiles      : 11
cleanFiles      : 326
sourceFilesTotal: 337
```

> **§6.1／§6.2 之「殘域 12 檔」母體清單**（base `acc98dfb` 實測，錯誤數降序）：
> `utils/audit-aggregate-archive-runner.ts` 83 · `api/admin/cron/audit-archive.ts` 73 ·
> `utils/audit-archive.ts` 50 · `utils/audit-aggregate-archive.ts` 36 ·
> `api/admin/audit-aggregate-archive/retry.ts` 34 · `utils/audit-aggregate-debug.ts` 22 ·
> `api/admin/cron/audit-aggregate.ts` 13 · `api/admin/cron/audit-aggregate-debug.ts` 13 ·
> `utils/audit-aggregate.ts` 10 · `api/admin/audit-archive/retry.ts` 10 ·
> **`api/admin/audit.ts` 5（本棒）** · `api/admin/audit/[id].ts` 3
> 合計 **352 ＝ ratchet `errorCount`**（兩獨立量測互證）。

### 6.3 type-only（byte-identical emit）

沿批 E §6.3 已經 gate 核可之形式：**輸入一律取 immutable Git blob**（`git show <commit>:<path>`），
**先斷言非空與 `CR = 0`**，再 emit。⚠ EOL 會影響 emit（template literal 內容逐字保留），
不從 immutable blob 取樣就會量到錯的東西。

**逐字輸出（fail-closed 腳本，2026-08-23 重跑；`SR-37` 之處置）**：
```
BASE(blob)       srcBytes= 6198 srcCR=0  emitBytes= 6599 emitCR=0 diags=0  sha256=10c1d1f87d28787475b481f8a210007863fd60bfd4bcabd827488139778b0b86
OVERLAY(temp)    srcBytes= 7495 srcCR=0  emitBytes= 6599 emitCR=0 diags=0  sha256=10c1d1f87d28787475b481f8a210007863fd60bfd4bcabd827488139778b0b86

✓ ALL GUARDS PASSED (6/6)：src 非空 · src CR=0 · emit 非空 · emit CR=0 · diags=0 · BYTE-IDENTICAL
exit=0
```

**逐條負向控制實測（`SR-39` 修正後；每條同時斷言 exit code ＋ 失敗守衛身分）**：
```
═══ 正向 ═══
  ✓ 真實 overlay              exit=0  命中「ALL GUARDS PASSED」
═══ 負向（斷言守衛身分；⚠ 分類見下方 errata：僅 G5／G6 為 isolated）═══
  ✓ guard 1  src 非空          exit=1  命中「source is EMPTY」
  ✓ guard 2  src CR=0          exit=1  命中「source contains」
  ✓ guard 5  transpile diags=0 exit=1  命中「transpile diagnostics」   ← 注入＝ type __BROKEN = ;
  ✓ guard 6  BYTE-IDENTICAL    exit=1  命中「BYTE-IDENTICAL FAILED」   ← 注入＝落選設計 v1
  結果：5 passed, 0 failed
```
> 🚨 **errata（`SR-44`；② R3 之處置）**：上一版此處寫「守衛 3／4 **無法獨立注入**、
> **獨立驗證者恰 4 條（1／2／5／6）**」—— **兩句皆為假**，本棒已實測更正：
> · 空輸入實際命中 **G1＋G3＋G6**、CRLF 實際命中 **G2＋G4＋G6** ⇒ G3／G4 **會被啟動**（耦合），
>   正確用詞是 **coupled activation**，🚫 不是「無法獨立注入／未驗證」。
> · 因此 G1／G2 也**不是**隔離的 ⇒ **真正 isolated 者恰 2 條（G5／G6）**。
> 完整實測表與新 driver 見 §6.6.B 末。

> 🚨 **errata（`SR-39`）**：本節上一版列的同樣是「4 條」，但當時 guard 5 的注入
> （`const x: number = "str"`）**實際觸發的是 guard 6** —— `transpileModule` 不做 semantic 檢查、
> 該注入之 `diagnostics = 0`，是新增的 runtime `const` 改了 emit。
> ⇒ 上一版的「4 條」**為假，真實只有 3 條**（1／2／6）。現在的 4 條是換注入後重測所得。

⚠ **`srcBytes` 差 1297 而 `emitBytes` 一位元組不差** —— 這正是「型別層全部 erase」的直接觀測：
新增的 26 行（JSDoc ＋ `interface`）與 3 處標註在 emit 中完全消失。
（`B-OD-2` 之改名亦在此獲得獨立佐證：改名前後 emit sha256 皆為 `10c1d1f8…`。）

**overlay replay anchor**：on-disk overlay 檔 `sha256 = 7979223135b8e6ed80b807f1f1262f2c4bebbe57e40e568eadc69705af39d450`、
`bytes = 7495`、`CR = 0`。

⚠ **此為檔案位元組之 SHA-256，🚫 不是 git blob SHA**（後者含 `blob <len>\0` 前綴，值必然不同）。
**驗證指令固定為** `sha256sum functions/api/admin/audit.ts`；
🚫 不得用 `git hash-object` 與本值比對（會恆為不符的假紅）。
coding 階段落地後之 `functions/api/admin/audit.ts` **必須**雜湊到此值；不符即代表實作與被量測的 overlay 不同，須停手回報。

⚠ **非空守衛不可省** —— 批 C2 曾踩到「兩邊皆 0 bytes、`cmp` 回報相同、sha 為空字串常數
`e3b0c442…`」的假綠。

> 🚨 **errata（② R1 `GOV-FAIL-001`；`SR-36`）**：本節初版寫「本量測**同時斷言** `bytes > 0`、
> `srcCR = 0`、`emitCR = 0`、`diags = 0`」—— **該宣稱當時為假**。舊腳本只對空 input／空 output
> `throw`，其餘三項與 `BYTE-IDENTICAL:false` **只是 `console.log`，程序仍 exit 0**。
> ⇒ 一個「印出 `GUARD: false` 卻回報成功」的量測器，正是本棒反覆在批判的**結構性假綠**，
> 而這次是**我自己的守衛**。已改為 6 條守衛全部累積失敗 → non-zero exit（現行實作見 §6.6.B 之 driver）。
> ⚠ **[指標更新 2026-08-24]** 原文指向「§6.6 步驟 4」，該分段編號已隨 driver 化取消。
> ⚠ **本 errata 當時同時宣稱「實測獨立轉紅 4 條」，該數字亦為假**（真實 3 條）——
> 見 `SR-39`：當時 guard 5 的注入實際觸發的是 guard 6。修正後才真正達到 4 條（1／2／5／6）。
> ⇒ 一個 errata 自己帶著另一個未被發現的錯值，是本棒第 2 次（前次為 `SR-1` → `SR-21` 之連鎖）。

**現行守衛（fail-closed，共 6 條）**：src 非空 · src CR=0 · emit 非空 · emit CR=0 · transpile diags=0 · BYTE-IDENTICAL。
腳本與逐條負向控制見 **§6.6.B**（driver 全文 ＋ 內嵌 helper ＋ 負向控制）。

⚠ **範圍限定**：此為**單檔 transpile identity**，🚫 **不是** production bundle identity
（實際 bundle 由 `wrangler pages functions build` 之 esbuild 產出，未在此量測範圍內）。
production bundle 面的守備交給 §9 之 `build:functions` gate。

### 6.4 兩組負向控制（證明兩個 oracle 都會轉紅）

> **為什麼需要**：「REMOVED=5 / ADDED=0」與「BYTE-IDENTICAL=true」若在 oracle 失靈時**也會**回綠，
> 就是結構性假綠。故兩個 oracle 各配一組會被抓到的注入。

#### 6.4.1 診斷 set-diff oracle 的負向控制

**注入基底 ＝ 最終 overlay**（先以 `sha256sum` 驗其為 `79792231…`，確認基底正確才注入）。
注入：`redactEventData(raw: unknown)` → `redactEventData(raw: number)`（其餘完全不動）。

> ⚠ **自審更正（`SR-18`）**：本節初稿之數據係施加於**落選設計 v1** 之 overlay 所得，卻被寫成適用於採用案。
> 已於採用案上**重新量測兩次**（`B-OD-1` 定案後一次、`B-OD-2` 改名後再一次，皆得 `ADDED = 2`），
> 🚫 不以「兩者應等價」之推理代替量測。

```
總診斷數 = 349（正確 overlay 為 347）
ADDED vs base = 2
  functions/api/admin/audit.ts: error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
  functions/api/admin/audit.ts: error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
```

⇒ oracle **確實會轉紅**；且 raw ＝ 2、distinct 位置 ＝ 1，獨立佐證 §6.0 的 dual-leaf 模型。

#### 6.4.2 emit identity oracle 的負向控制

注入＝**設計 v1**（§4.3 落選案：標註兩個 callback 參數而非邊界）。

```
OVERLAY-v1  emitBytes= 6603  emitCR=0  sha256=4f3da1faf4500cf1d51f0fde06c9ff78233f8e5af9512f7c9be50e50acc27a24
BYTE-IDENTICAL : false
```

emit 逐字 diff（恰 2 行，內容僅多出 `(` 與 `)`）：
```diff
-    const filteredRows = rawRows.filter(r => canRoleSeeAuditEvent(r.event_type, user.role));
-    const rows = filteredRows.map(r => ({ ...r, event_data: redactEventData(r.event_data) }));
+    const filteredRows = rawRows.filter((r) => canRoleSeeAuditEvent(r.event_type, user.role));
+    const rows = filteredRows.map((r) => ({ ...r, event_data: redactEventData(r.event_data) }));
```

⇒ emit oracle **確實會轉紅**，且能定位到違反行（依 [[feedback_guard_population_must_cover_property]] 第 4 條）。
⚠ 此負向控制**同時**是 `B-OD-1` 的決策依據 —— v1 若被採用，「byte-identical emit」之宣稱即為假。

> ⚠ **時序誠實標示（`SR-23`）**：本組 v1 量測在 `B-OD-2` 改名**之前**取得，故其 overlay 用的是舊型別名。
> 這**不影響**它作為負向控制的效力 —— 它證明的是「emit oracle 能偵測到真實的 emit 差異」，
> 而該差異源自 **arrow 參數括號化**（標註位置軸），與型別名稱無關。
> 🚫 但也**不得**把 `6603 B` / `4f3da1fa…` 當成「改名後 v1」之量測值（未量、不宣稱）。

### 6.5 overlay 還原證明

overlay 量測完成後以**單檔** `git checkout -- functions/api/admin/audit.ts` 還原
（🚫 未對目錄使用、🚫 未 `git stash`、🚫 未 `git checkout <base> -- <目錄>`；
沿批 E `CODEX-E-R1-RR4` 之紀律，避 [[feedback_parallel_track_staging_collision]]）。

```
worktree blob = ec2a9b0795d500d72159988071807be86e8d049f
base blob     = ec2a9b0795d500d72159988071807be86e8d049f
→ byte-identical
git status --porcelain → 僅 "?? CLEANUP_PLAN.md"
```

### 6.6 `EXTERNAL REPLAY RECIPE`（外部可自行重跑；🚫 不需信任本檔任何數字）

> 🚨 **本節已於 ② R1 `GOV-EVIDENCE-001` 後全面重做（`SR-36`）。舊 recipe 作廢、🚫 不得再執行。**
>
> **舊 recipe 的缺陷（② 指出，我方確認成立）**：它要求審查者在 **`<repo>` 共用工作樹**上
> `git checkout <base>`、跑 `npm ci`、改 source，結尾只還原**單一檔案** ——
> **未還原原 branch／ref、未還原 dependency state、未清 scratch 檔**。
> 這直接違反：
> · `CLAUDE.md` §6 平行 session 紀律（「非當前任務 → 唯讀優先，不 `git add`/commit/**checkout**/切 branch」）
> · `.claude/agents/readonly-reviewer.md`（本棒逐字查證存在）：「Never run a command that writes files,
>   **installs packages**, or mutates git state … **never check out into the shared working tree**」
> ⇒ 舊 recipe 等於指示審查者違反 repo 自己的 reviewer 契約。**這是我方的設計錯誤，非審查者的問題。**

**Shell 需求（不可省）**：Tier B driver 需 **bash**（本機為 Git Bash；Linux/macOS 原生可）——
用到 `trap`／`local`／`case` 等 POSIX-sh 之外或 bash 慣用語法。🚫 PowerShell 不可直接執行。
⚠ **[指標更新 2026-08-24]** 原文宣稱使用 **process substitution `<(...)`** ——
現行 driver **已改為先落檔再讀**（`comm … > "$WORK/added.txt"` 後 `wc -l < 檔`），
正是為了讓 `comm` 的 rc 可被 guard（② R4 `SR-46`）。🚫 該敘述已不成立。
Tier A 僅需 `git` ＋ `node`，🚫 不需 bash-only 語法。

### 6.6.0 🔒 `REPLAY-AUTHORIZATION-TIERS`（② R2 Blocker 之處置；**先讀完再執行任何一行**）

> 🚨 **② R2 指出兩件事，我方實測確認皆成立：**
> 1. 舊 §6.6.1 是 **happy-path isolation** —— `mktemp` / clone / `cd` / checkout / `npm ci` 之間
>    **沒有逐步失敗終止**。若 clone 或 `cd "$WORK/repo"` 失敗，bash 仍會往下走，
>    後續 `git checkout` 可能落在 **caller 原 cwd（含來源共用 repo）** ⇒ 重現 R1 的污染風險。
> 2. `.claude/agents/readonly-reviewer.md` 禁止**所有**寫檔／安裝／checkout／rm，
>    **不限於共用工作樹**。⇒「disposable clone 保護了來源 repo」**不等於**授權 readonly reviewer 執行它。
>    ⚠ ② 同時撤回其 R1 建議（把「isolated clone ＋ own npm ci」直接列為 reviewer-safe 是過廣的）。

**⇒ 本 recipe 分為兩個授權層。🚫 不得混用。**

| Tier | 誰可執行 | 涵蓋 | 對檔案系統之作用 |
|---|---|---|---|
| **A · readonly** | **readonly reviewer 可直接執行**（落在 `readonly-reviewer.md` 契約內） | base 側全部事實：base blob 身分 · base source 內容 · **base emit sha256** · changed-files · 不變式比對 | **零寫檔 · 零安裝 · 零 checkout · 零 rm**（`git show` ＋ `node --input-type=module -e`，內容走 **stdin**） |
| **B · mutable disposable runner** | **需另行授權**；🚫 **readonly reviewer 不得執行** | overlay 重建 · `tsc` 全量診斷 · ratchet · lint · emit identity 之 overlay 側 · 逐條負向控制 | 寫 temp · `git clone` · `npm ci` · `rm -rf` |

⚠ **為何 Tier B 無法降級為 Tier A**：`tsc -b tsconfig.solution.json` 需要真實檔案樹與 `node_modules`，
無法全記憶體。⇒ 該面**必須**由具寫入授權者在 disposable 環境執行，
🚫 不得退回共用樹、🚫 不得要求 readonly reviewer 代跑。
⚠ **🚫 不用 `git worktree add`**：`worktree remove` 會穿過 junction 清空目標
（[[feedback_worktree_junction_deletes_target]] 本機實際發生過）。用 `git clone --local`。
⚠ Tier B 之 clone **自帶 `npm ci`**，🚫 不借共用 repo 的 `node_modules`（同上風險）。

### 6.6.A Tier A — readonly 子集（**零寫檔**；readonly reviewer 可直接跑）

> 🚨 **② R3 Required 之處置（`SR-43`）**：上一版此段寫 `SRC=…` 但 Node 讀 `process.env.SRC`，
> **按字面執行會得到 `undefined/package.json`**；且 `PLAN` 仍釘在已過時的 R2 commit。已修。

> 🚨 **② R5 Required 之處置（`SR-51`）**：上一版 Tier A 接受一般 `<repo path>`，但 A2 直接把
> **環境值**餵給 `createRequire()` ⇒ 依公開 recipe 用 `SRC=.` 會得 `ERR_INVALID_ARG_VALUE`（實測復現）。
> ⇒ 現在**先 canonicalize、驗證、再 re-export absolute `SRC`**，A1／A2 才開始。

```bash
SRC_IN=<chiyigo.com repo 路徑>            # 可為相對路徑（例：. 或 ../chiyigo.com）
# A0 canonicalize：把 SRC 固定為「已驗證的 absolute git top-level」後才 export
git -C "$SRC_IN" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "FAIL: SRC 不是 git work tree"; exit 1; }
SRC_TOP="$(git -C "$SRC_IN" rev-parse --show-toplevel)" || { echo "FAIL: show-toplevel"; exit 1; }
export SRC="$(cd "$SRC_TOP" && pwd -P)"   || { echo "FAIL: canonicalize SRC"; exit 1; }
case "$SRC" in /*) : ;; *) echo "FAIL: SRC 非 absolute：$SRC"; exit 1;; esac
echo "✓ A0：SRC canonicalized → $SRC"

BASE=acc98dfbeeed237533b5b844338b5798a148ce8f
PLAN=<本輪 PLAN commit —— 完整 40-hex，取自送審 packet §0>
#   ⚠ 本檔無法自我引用其所在 commit（chicken-and-egg），故 PLAN 由 operator 依 packet 填入。
#      🚫 不得填 branch 名或短 SHA。
EXPECT_SRC_BLOB=ec2a9b0795d500d72159988071807be86e8d049f

# A1 身分與 changed-files —— fail-closed（🚫 不是印出來看一眼）
[ "$(git -C "$SRC" rev-parse "$BASE:functions/api/admin/audit.ts")" = "$EXPECT_SRC_BLOB" ] \
  || { echo "FAIL: base source blob 不符"; exit 1; }
[ "$(git -C "$SRC" rev-parse "$PLAN:functions/api/admin/audit.ts")" = "$EXPECT_SRC_BLOB" ] \
  || { echo "FAIL: PLAN commit 之 source blob 已變 ⇒ 不再是 type-only 未動狀態"; exit 1; }
n=$(git -C "$SRC" diff "$BASE" "$PLAN" --name-status | wc -l)
[ "$n" -eq 1 ] || { echo "FAIL: changed-files = $n（預期恰 1）"; exit 1; }
git -C "$SRC" diff "$BASE" "$PLAN" --name-status \
  | grep -qE '^A[[:space:]]+docs/plans/stage7-pr2dw-batchb-read-admin-audit-noimplicitany\.md$' \
  || { echo "FAIL: 唯一 changed-file 不是 added plan doc"; exit 1; }
echo "✓ A1：base/PLAN 之 source blob 皆為 ec2a9b07…，changed-files 恰 1 個 added plan doc"

# A2 base emit sha256 —— 內容走 stdin，🚫 不寫任何檔、🚫 不裝任何東西、🚫 不 checkout
git -C "$SRC" show "$BASE:functions/api/admin/audit.ts" | node --input-type=module -e '
import { createHash } from "node:crypto"; import { createRequire } from "node:module";
const ts = createRequire(process.env.SRC + "/package.json")("typescript");
let src = ""; for await (const c of process.stdin) src += c;
const fails = []; const A = (c, m) => { if (!c) fails.push(m) };
A(Buffer.byteLength(src, "utf8") > 0, "source is EMPTY");
A((src.match(/\r/g) || []).length === 0, "source contains CR");
const out = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext, removeComments: false, newLine: ts.NewLineKind.LineFeed }, reportDiagnostics: true });
const t = out.outputText;
A(Buffer.byteLength(t, "utf8") > 0, "emit is EMPTY");
A((t.match(/\r/g) || []).length === 0, "emit contains CR");
A(out.diagnostics.length === 0, "transpile diagnostics = " + out.diagnostics.length);
const sha = createHash("sha256").update(t, "utf8").digest("hex");
console.log("base emit sha256 = " + sha);
A(sha === "10c1d1f87d28787475b481f8a210007863fd60bfd4bcabd827488139778b0b86", "BASE EMIT SHA MISMATCH");
if (fails.length) { console.error("✗ " + fails.join(" · ")); process.exit(1) }
console.log("✓ A2：base 側 5 條守衛全過");'
```

**本棒實測**：A2 → exit 0、`base emit sha256 = 10c1d1f8…`、`✓ A2：base 側 5 條守衛全過`。

---

### 6.6.B Tier B — **完整連續 driver**（需寫入授權；🚫 readonly reviewer 不得執行）

> 🚨 **② R3 Blocker 之處置（`SR-44`）**：上一版是**分段片斷**，且在 `set -u` 之下 ——
> `tsc`／ratchet／lint 的 exit status 未被捕捉、裸 `sha256sum -c` 不終止整段、
> `node …; echo "exit=$?"` 讓 Node 失敗被 echo 吃掉（**我方實測整段確實回 0**）、
> B3 equality 不在 EXIT finalizer 內（早期 `exit 1` 會跳過來源 after-state 證明）、
> cleanup 拒絕或 `rm` 失敗不提升最終 exit。
> ⇒ 改為**一支連續、無省略、我方已端到端實跑過**的 driver（下方全文；兩支 helper 以 heredoc 內嵌，無外部依賴）。

**實跑結果 —— ⚠ 以下為 driver `v2` 之歷史輸出**（2026-08-24，Windows Git Bash；
含 clone ＋ `npm ci` ＋ 2× full `tsc -b --force`）：

> 🚨 **`GOV-DRIFT-001` 之處置（② R7 Minor；coding 階段 `SR-58`）**：本區塊是 **v2 時期**的實跑紀錄，
> 🚫 **不是**下方 v4 driver 的輸出。逐字保留以存軌跡，但**兩處在 v4 語意下已不成立**：
> · 末行 `driver v2 rc=0` —— v2 已被 v3／v4 取代（§14.9.2／§14.10.3）。
> · `workdir 已清理` —— **v4 不再執行任何刪除**（`safe_rm()` 與全部 `rm -rf` 已移除，見 §14.10.3），
>   workspace 生命週期改由具寫入授權的 runner 負責 ⇒ v4 只**回報** workspace 路徑、🚫 不清理它。
> ⇒ 🚫 不得把本區塊讀成「v4 已端到端實跑且已自行清理」。

```
  ✓ G1 src 非空 [coupled]：exit=1，失敗集合恰 3 條且完全相符
  ✓ G2 src CR=0 [coupled]：exit=1，失敗集合恰 3 條且完全相符
  ✓ G5 diags=0 [isolated]：exit=1，失敗集合恰 1 條且完全相符
  ✓ G6 identity [isolated]：exit=1，失敗集合恰 1 條且完全相符

✓ Tier B v2 全部斷言成立
  base/overlay：tsc rc=2 · 診斷 352/347 · ratchet 三欄全驗 · lint 0
  set-diff：REMOVED 與 exact multiset 逐位元組相符 · ADDED=0
  emit identity 正向 + 4 組負向控制（完整失敗集合）
✓ finalizer：來源 repo 三項 probe rc=0 且逐字相等、workdir 已清理
driver v2 rc=0
```

**v4 相對 v1 之實質強化（② R4／R5／R6 逐條累積）**：

> ⚠ **[指標更新 2026-08-24]** 本表原標「v2 相對 v1」；driver 現已迭代至 **v4**。
> v3 增：禁 temp 位於 `SRC` 內 · trap 移到 **allocation 之前** · `cd` 失敗拒刪 · probe 前後各一次 · junction 檢查 · heredoc `cat` guard。
> **v4 增（② R6 之縮減）：移除 `safe_rm()` 與所有 `rm -rf`——driver 不再執行任何刪除，workspace 交 runner；
> ratchet 兩次執行改帶 `npm_config_offline=true npm_config_yes=false`。**


| ② 之 finding | v2 處置 |
|---|---|
| `added=$(comm … \| wc -l)` 的 **pipeline rc 被丟棄** ⇒ `comm` 失敗仍讓 `ADDED=0` 通過 | `comm` **先落檔**（`\|\| fail`）再 `wc -l < 檔`；`sed`／`sort` 亦逐一 guard |
| finalizer 三個 after-probe **只比字串**；probe 失敗回空字串會與 `BEFORE_STATUS=""` **誤判相等** | 每個 probe **先斷言 `rc=0`** 再比較，失敗印 `AFTER PROBE FAILED` 並提升 exit |
| `mktemp` 與 trap 安裝之間有**窗口**；`WORK="$(…)"` 失敗會把路徑覆寫為空 ⇒ temp 洩漏 | 先 canonicalize `SRC`／`TMPROOT` → `mktemp` → **立刻裝 trap**（`WORK_RAW` 保底）→ 才 canonicalize 到 `WORK`；finalizer 對 `WORK` 與 `WORK_RAW` **都清** |
| set-diff 只驗「5 條且屬 `TS7006/7031`」⇒ **來自錯誤檔案的合成輸入也能通過** | 與 §6.1 宣稱之 **exact `file+code+message` multiset 逐位元組 `cmp`**（期望集合以 heredoc 內嵌） |
| ratchet 只驗 `errorCount` | `assert_ratchet()` 兩側皆驗 **`errorCount` / `cleanFiles` / `sourceFilesTotal`**（base 352/325/337、overlay 347/326/337） |
| TypeScript 是 **devDependency**，driver 卻用裸 `npm ci` ＋ `npx tsc`（可能被 omit／改走下載） | `npm ci --include=dev` ＋ 斷言本地 `typescript` 版本 **恰 5.9.3** ＋ 直接用 `node_modules/.bin/tsc`，**🚫 不用 `npx`** |
| `SRC` 未 canonicalize（`SRC=.` 在 finalizer `cd /` 後會從錯位置跑 git ⇒ 假紅） | 開頭即以 `--is-inside-work-tree` ＋ `--show-toplevel` ＋ `pwd -P` 固定為**已驗證的 absolute top-level**，並斷言其為絕對路徑 |

**driver 自身之負向控制（🚫 只證明它會綠不算數；`SR-46`～`SR-48` 之處置）**：

| # | 注入 | 結果 | 覆蓋之缺陷 |
|---|---|---|---|
| 1 | `ANCHOR` 竄改為全 0 | **rc=1**，停在物化步驟（`FAIL: anchor 不符`） | overlay 身分 |
| 2 | `EXPECT_OVER_DIAGS` 改 999 | **rc=1**，`FAIL: overlay 診斷 347（預期 999）` | 診斷數 |
| 3 | **pre-clone early failure**（canonicalize `WORK` 失敗） | **rc=1**，`FAIL: canonicalize WORK`；**driver 殘留 0** | `SR-48` mktemp/trap 窗口 |
| 4 | **after-status probe 失敗**（finalizer 內 `git status` 指向不存在路徑） | **rc=1**，`AFTER PROBE FAILED: status (rc=128)` ＋ `finalizer invariant 失敗（原始 rc=0）` | `SR-47` probe 假綠 |
| 5 | **`comm` 失敗**（輸入檔不存在） | **rc=1**，`FAIL: comm ADDED`；**driver 殘留 0** | `SR-46` pipeline rc 丟棄 |

⚠ **#4 特別值得看**：driver 本體**成功（原始 rc=0）**，但 finalizer 因為**無法驗證**來源狀態
而把最終 rc 提升為 **1** —— 「不能證明沒動到」與「證明沒動到」被正確區分開，這正是 fail-closed 的定義。

**來源 repo 前後比對（實測）**：`HEAD` / `branch` / `status --porcelain` 三項逐字相同。
**cleanup 實證**：於 `$TMPDIR` canonical 根（本機解析為 `/tmp`）掃描 `tmp.*`，
具 driver 特徵（`repo/` 或 `materialize-overlay.mjs`）者 **0 個**。

```bash
#!/usr/bin/env bash
# ============================================================================
# Tier B replay driver v4 — Stage 7 PR-2dw 批 B-read
#
# ⚠ v4 之核心變更（② R6 建議「不再擴寫 shell machinery」）：
#   **本 driver 不再執行任何刪除**。workspace 生命週期交給 **runner**。
#   理由：v3 的 safe_rm() 只驗 $WORK 根自身、明示不掃子樹 junction，卻仍遞迴刪整棵 npm tree；
#   在一份「給人重播的文件」裡放 rm -rf 的風險大於它提供的保證。
#   ⇒ 保留唯讀的來源 equality probe（有價值），移除破壞性邏輯（風險來源）。
# ⚠ 需**寫入授權**。🚫 readonly reviewer 不得執行。
# 🚫 不用 `set -e`（`tsc -b` 預期回非零）；改逐一顯式 guard。
#
# v3 修正（② R5 Blocker + Required）：
#   C1 未禁止 TMPROOT/WORK 位於 SRC 內 ⇒ `TMPDIR="$SRC/node_modules"` 會把 clone 建在共用來源 repo 內，
#      且該路徑被 .gitignore 忽略 ⇒ `status --porcelain` 仍相同 ⇒ 「來源未被觸碰」假綠
#   C2 `cd / || true` 吞掉「離開 $WORK 失敗」⇒ 改為失敗即**拒絕刪除**
#   C3 來源 probe 只在 rm 前跑 ⇒ 改為 **cleanup 前後各跑一次**
#   C4 cleanup 未重驗 reparse/junction ⇒ 刪前斷言 `cd d && pwd -P` == d（junction 會解析到別處）
#   C5 三個 heredoc `cat` 未檢查 rc ⇒ 全部 guard（`-s` 無法排除部分寫入）
#   R-npx 「🚫 不用 npx」宣稱**為假**：`npm run typecheck:ratchet:report` 內部
#      （scripts/typecheck-ratchet.mjs:188）仍 `execSync('npx tsc …')`。
#      ⇒ 誠實縮窄宣稱，並以 `npx --no-install` 斷言**不可能走下載 fallback**
#
# 用法：  SRC=<chiyigo.com repo> bash replay-tier-b-v4.sh
#         （⚠ `GOV-DRIFT-001`／`SR-58`：本行原誤寫 v3，driver 實為 v4）
# ============================================================================
set -u
set -o pipefail

: "${SRC:?請設 SRC=<chiyigo.com repo 路徑>}"
BASE=acc98dfbeeed237533b5b844338b5798a148ce8f
ANCHOR=7979223135b8e6ed80b807f1f1262f2c4bebbe57e40e568eadc69705af39d450
BASE_EMIT_SHA=10c1d1f87d28787475b481f8a210007863fd60bfd4bcabd827488139778b0b86
EXPECT_TS_VERSION=5.9.3
EXPECT_TSC_RC=2
EXPECT_BASE_DIAGS=352 ; EXPECT_BASE_CLEAN=325 ; EXPECT_BASE_TOTAL=337
EXPECT_OVER_DIAGS=347 ; EXPECT_OVER_CLEAN=326 ; EXPECT_OVER_TOTAL=337
REL=functions/api/admin/audit.ts

WORK=""; WORK_RAW=""
fail() { echo "FAIL: $*" >&2; exit 1; }

# ── R4(v2)：SRC 固定為已驗證之 absolute git top-level ───────────────────────
git -C "$SRC" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "SRC 不是 git work tree：$SRC"
SRC_TOP="$(git -C "$SRC" rev-parse --show-toplevel)" || fail "SRC rev-parse --show-toplevel"
SRC="$(cd "$SRC_TOP" && pwd -P)" || fail "canonicalize SRC"
case "$SRC" in /*) : ;; *) fail "SRC 非 absolute：$SRC";; esac

# ── 0. before-state（每個 probe guard rc）──────────────────────────────────
BEFORE_HEAD="$(git -C "$SRC" rev-parse HEAD)"                || fail "before rev-parse HEAD"
BEFORE_BRANCH="$(git -C "$SRC" rev-parse --abbrev-ref HEAD)" || fail "before rev-parse branch"
BEFORE_STATUS="$(git -C "$SRC" status --porcelain)"          || fail "before status"

# ── probe / 安全刪除 helper ────────────────────────────────────────────────
probe_source() { # $1=label；三項皆先斷言 rc=0 再比較
  local label="$1" now prc bad=0
  now="$(git -C "$SRC" rev-parse HEAD 2>/dev/null)"; prc=$?
  if [ "$prc" -ne 0 ]; then echo "AFTER PROBE FAILED[$label]: rev-parse HEAD (rc=$prc)" >&2; bad=1
  elif [ "$now" != "$BEFORE_HEAD" ]; then echo "SOURCE MUTATED[$label]: HEAD" >&2; bad=1; fi
  now="$(git -C "$SRC" rev-parse --abbrev-ref HEAD 2>/dev/null)"; prc=$?
  if [ "$prc" -ne 0 ]; then echo "AFTER PROBE FAILED[$label]: branch (rc=$prc)" >&2; bad=1
  elif [ "$now" != "$BEFORE_BRANCH" ]; then echo "SOURCE MUTATED[$label]: branch" >&2; bad=1; fi
  now="$(git -C "$SRC" status --porcelain 2>/dev/null)"; prc=$?
  if [ "$prc" -ne 0 ]; then echo "AFTER PROBE FAILED[$label]: status (rc=$prc)" >&2; bad=1
  elif [ "$now" != "$BEFORE_STATUS" ]; then echo "SOURCE MUTATED[$label]: worktree/index" >&2; bad=1; fi
  return "$bad"
}

# ⚠ v4：safe_rm() 已整段移除 —— 本 driver 不刪任何東西（② R6 Blocker 之處置）。

finalize() {
  local rc=$? ok=1 d
  # C3(a)：cleanup **前** probe
  probe_source pre-cleanup || ok=0
  # v4：離開 $WORK 只為方便 runner 之後處置；失敗不影響正確性（本 driver 不刪任何東西）
  cd / 2>/dev/null || echo "NOTE: 未能離開 \$WORK（本 driver 不執行刪除，故不影響）" >&2
  # v4：🚫 本 driver 不刪除任何路徑。workspace 交由 runner 處置。
  if [ -n "$WORK" ]; then
    echo "WORKSPACE（**由 runner 負責清理**；本 driver 不刪）：$WORK" >&2
  fi
  # 再 probe 一次（此處已無刪除動作，仍保留以偵測期間之外部變動）
  probe_source post-run || ok=0
  if [ "$ok" -ne 1 ]; then echo "finalizer invariant 失敗（原始 rc=$rc）" >&2; exit 1; fi
  [ "$rc" -eq 0 ] && echo "✓ finalizer：來源 probe（前後各一次）皆 rc=0 且逐字相等；workspace 未刪除（交 runner）"
  exit "$rc"
}

# ── C1：TMPROOT 必須在 SRC 之外 ─────────────────────────────────────────────
TMPROOT="$(cd "${TMPDIR:-/tmp}" && pwd -P)" || fail "canonicalize TMPROOT"
case "$TMPROOT" in
  "$SRC"|"$SRC"/*) fail "TMPROOT 位於 SRC 內：$TMPROOT（會把 clone 建在共用來源 repo 內；若該路徑被 .gitignore 忽略，status 比對將假綠）";;
esac

# ── C-trap：trap 在**任何 allocation 之前**就緒（WORK/WORK_RAW 為空時 finalizer 自動跳過）──
trap finalize EXIT

WORK_RAW="$(mktemp -d)" || fail "mktemp"
WORK="$WORK_RAW"
WORK_CANON="$(cd "$WORK_RAW" && pwd -P)" || fail "canonicalize WORK"
WORK="$WORK_CANON"
case "$WORK" in "$TMPROOT"/?*) : ;; *) fail "WORK 不在 temp 根之下：$WORK";; esac
case "$WORK" in "$SRC"|"$SRC"/*) fail "WORK 位於 SRC 內：$WORK";; esac

# ── 1. disposable clone ────────────────────────────────────────────────────
git clone --local --no-hardlinks "$SRC" "$WORK/repo" >/dev/null 2>&1 || fail "clone"
cd "$WORK/repo" || fail "cd（🚫 後續步驟絕不可在原 cwd 執行）"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "不在 git work tree 內"
TOP_CANON="$(cd "$(git rev-parse --show-toplevel)" && pwd -P)" || fail "canonicalize toplevel"
[ "$TOP_CANON" = "$WORK/repo" ] || fail "cwd 不是 clone 內部：$TOP_CANON != $WORK/repo"
git checkout --detach "$BASE" >/dev/null 2>&1 || fail "checkout $BASE"

# ── 2. 依賴：devDependencies 必裝 ───────────────────────────────────────────
npm ci --include=dev >/dev/null 2>&1 || fail "npm ci --include=dev"
TSV="$(node -e 'process.stdout.write(require("typescript").version)')" || fail "讀取本地 typescript 版本"
[ "$TSV" = "$EXPECT_TS_VERSION" ] || fail "typescript $TSV（預期 $EXPECT_TS_VERSION）"
TSC="$WORK/repo/node_modules/.bin/tsc"
[ -x "$TSC" ] || [ -f "$TSC" ] || fail "本地 tsc 不存在於 $TSC"
# R-npx：⚠ 本 driver **無法**消除 npx —— `npm run typecheck:ratchet:report` 內部
#   （scripts/typecheck-ratchet.mjs:188）自行 `execSync('npx tsc …')`，不在本 driver 控制內。
#   ⇒ 改以 `--no-install` 斷言「本地已可解析、絕不走下載 fallback」，並固定版本。
NPXV="$(npx --no-install tsc --version 2>/dev/null)" || fail "npx --no-install tsc 失敗 ⇒ 本地未解析（🚫 不得讓 npx 下載）"
[ "$NPXV" = "Version $EXPECT_TS_VERSION" ] || fail "npx 解析到 '$NPXV'（預期 'Version $EXPECT_TS_VERSION'）"

assert_ratchet() { # $1=報告檔 $2=label $3=errorCount $4=cleanFiles $5=sourceFilesTotal
  grep -qE "errorCount +: $3\$"     "$1" || fail "$2 ratchet errorCount != $3"
  grep -qE "cleanFiles +: $4\$"     "$1" || fail "$2 ratchet cleanFiles != $4"
  grep -qE "sourceFilesTotal: $5\$" "$1" || fail "$2 ratchet sourceFilesTotal != $5"
}

# ── 3. helper 腳本（C5：每個 heredoc 的 cat 都 guard rc）────────────────────
cat > "$WORK/materialize-overlay.mjs" <<'___MATERIALIZE_EOF___' || fail "cat materialize-overlay.mjs"
// 從 immutable base blob 物化 overlay，🚫 不用 git apply。
// 理由（2026-08-24 實測）：Windows Git Bash 下 `git apply` 會在無 .gitattributes 的樹把 LF 轉 CRLF
//   （實測 +179 CR、7674 vs 7495 bytes），使 anchor 必然不符 —— 環境相依、非確定性。
// 本法：讀 raw blob（git show 輸出即 LF）→ 三次「唯一字串」替換（各自斷言恰 1 命中）→ 以 LF 原樣寫出
//   → 自驗 sha256 == anchor。任一步不成立即 non-zero exit。
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const [, , REPO, BASE_SHA, OUT_PATH, EXPECT_SHA] = process.argv
if (!REPO || !BASE_SHA || !OUT_PATH || !EXPECT_SHA) {
  console.error('usage: node materialize-overlay.mjs <repo> <base-sha> <out-path> <expect-sha256>')
  process.exit(2)
}
const REL = 'functions/api/admin/audit.ts'

let src = execFileSync('git', ['-C', REPO, 'show', `${BASE_SHA}:${REL}`]).toString('utf8')
if ((src.match(/\r/g) || []).length !== 0) { console.error('FAIL: base blob 含 CR（不應發生）'); process.exit(1) }

// 三處編輯（＝PLAN §4.2 的 3 個標註點 ＋ §4.1 的宣告 block）
const EDITS = [
  {
    id: 'E1 §4.1 宣告 block ＋ redactEventData 簽章',
    from: 'function redactEventData(raw) {',
    to: `/**
 * 本檔 \`audit_log\` 查詢的**投影列**（projection），🚫 不是 \`audit_log\` 資料表的完整結構 ——
 * 表自 migration 0038 起另有 \`archived_at\` / \`cold_class\`，本查詢未投影、故不在此宣告內。
 * 欄位型別依 migration 0017 之 DDL（\`event_type\` / \`severity\` / \`created_at\` 為 NOT NULL；
 * \`user_id\` / \`client_id\` / \`ip_hash\` / \`event_data\` 可為 NULL）。
 *
 * ⚠ 本宣告**未經編譯期檢查**：本 repo 未安裝 \`@cloudflare/workers-types\`，
 * \`Env['chiyigo_db']\` 解析為 \`any\`，TypeScript 無從驗證實際 row 與此形狀相符。
 * 唯一保證＝下方 SELECT 欄位清單與本宣告必須同步維護。
 * 🚫 不得據此宣稱「D1 row 已型別化」。
 *
 * ⚠ 命名：🚫 不叫 \`AuditLogRow\` —— 該名已由 \`utils/audit-log.ts\` 用於 \`admin_audit_log\`
 * （hash-chain 表），與本表 \`audit_log\` 是**不同的表**。前綴沿 \`user-audit.ts\` 的
 * \`UserAuditEnv\` / \`UserAuditEntry\` 家族（該模組即本表的寫入端）。
 */
interface UserAuditRow {
  id: number
  event_type: string
  severity: string
  user_id: number | null
  client_id: string | null
  ip_hash: string | null
  event_data: string | null
  created_at: string
}

function redactEventData(raw: unknown) {`,
  },
  {
    id: 'E2 §4.2 handler ctx 標註',
    from: 'export async function onRequestGet({ request, env }) {',
    to: 'export async function onRequestGet({ request, env }: { request: Request; env: Env }) {',
  },
  {
    id: 'E3 §4.2 邊界標註（B-OD-1）',
    from: '  const rawRows = rowsResult?.results ?? []',
    to: '  const rawRows: UserAuditRow[] = rowsResult?.results ?? []',
  },
]

for (const e of EDITS) {
  const n = src.split(e.from).length - 1
  if (n !== 1) { console.error(`FAIL: ${e.id} — 來源命中 ${n} 次（必須恰 1）`); process.exit(1) }
  src = src.replace(e.from, e.to)
}

if ((src.match(/\r/g) || []).length !== 0) { console.error('FAIL: overlay 含 CR'); process.exit(1) }
writeFileSync(OUT_PATH, src, { encoding: 'utf8' })   // Node 原樣寫出，🚫 不做 EOL 轉換

const sha = createHash('sha256').update(src, 'utf8').digest('hex')
console.log(`overlay bytes=${Buffer.byteLength(src, 'utf8')} CR=0 sha256=${sha}`)
if (sha !== EXPECT_SHA) { console.error(`FAIL: anchor 不符\n  實得 ${sha}\n  期望 ${EXPECT_SHA}`); process.exit(1) }
console.log('✓ overlay 物化完成且 anchor 相符')
___MATERIALIZE_EOF___
[ -s "$WORK/materialize-overlay.mjs" ] || fail "materialize-overlay.mjs 為空"

cat > "$WORK/emit-identity.mjs" <<'___EMIT_EOF___' || fail "cat emit-identity.mjs"
// 單檔 transpile identity 量測（fail-closed 版；② `GOV-FAIL-001` 之處置）。
//
// 母體 = 恰 2 個輸入：(1) base immutable git blob (2) overlay 檔（temp，🚫 非共用工作樹）
// 宣稱保護的性質 = 「型別標註 erase 後，emit 逐字不變」
// 🚫 這是單檔 transpile identity，不是 production bundle identity。
// 🚫 本腳本刻意留在 scratchpad，不得進 repo、不得進 CI。
//
// ⚠ ② R1 `GOV-FAIL-001` 指出舊版只對「空 input/output」throw，其餘守衛（srcCR / emitCR /
//    diagnostics / BYTE-IDENTICAL）只是 console.log ⇒ 全部失敗仍 exit 0，與 PLAN 宣稱的
//    「斷言守衛」不符。本版把**每一條**守衛都改成 throw / non-zero exit。
// ⚠ 本腳本 🚫 不觸碰工作樹：base 側走 `git show <sha>:<path>`（immutable blob），
//    overlay 側讀呼叫者給的 temp 路徑。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const [, , REPO, BASE_SHA, OVERLAY_PATH] = process.argv
if (!REPO || !BASE_SHA || !OVERLAY_PATH) {
  console.error('usage: node emit-identity.mjs <repo> <base-sha> <overlay-path>')
  process.exit(2)
}
const REL = 'functions/api/admin/audit.ts'

const require = createRequire(REPO + '/package.json')
const ts = require('typescript')

const opts = {
  target: ts.ScriptTarget.ES2022,   // 對齊 tsconfig target
  module: ts.ModuleKind.ESNext,     // 對齊 tsconfig module
  removeComments: false,            // 🚫 不剝註解
  newLine: ts.NewLineKind.LineFeed, // 只影響 emitter 自己的換行
}

const failures = []
const assert = (cond, msg) => { if (!cond) failures.push(msg) }

function measure(label, src) {
  const srcBytes = Buffer.byteLength(src, 'utf8')
  const srcCR = (src.match(/\r/g) || []).length
  // 守衛 1+2：source 非空、source CR=0（EOL 會改變 emit，見 PLAN §6.3）
  assert(srcBytes > 0, `${label}: source is EMPTY (bytes=0)`)
  assert(srcCR === 0, `${label}: source contains ${srcCR} CR — 必須取 LF 內容（immutable blob），否則量到的是錯的東西`)
  const out = ts.transpileModule(src, { compilerOptions: opts, reportDiagnostics: true })
  const text = out.outputText
  const bytes = Buffer.byteLength(text, 'utf8')
  const cr = (text.match(/\r/g) || []).length
  const diags = out.diagnostics.length
  // 守衛 3+4+5：emit 非空、emit CR=0、transpile diagnostics=0
  assert(bytes > 0, `${label}: emit is EMPTY (bytes=0) — 空字串 sha256 為 e3b0c442… 之假綠，批 C2 曾踩`)
  assert(cr === 0, `${label}: emit contains ${cr} CR`)
  assert(diags === 0, `${label}: transpile diagnostics = ${diags}（期望 0）`)
  return { label, srcBytes, srcCR, bytes, cr, diags, sha: createHash('sha256').update(text, 'utf8').digest('hex') }
}

const baseSrc = execFileSync('git', ['-C', REPO, 'show', `${BASE_SHA}:${REL}`]).toString('utf8')
const overSrc = readFileSync(OVERLAY_PATH, 'utf8')

const b = measure('BASE(blob)', baseSrc)
const o = measure('OVERLAY(temp)', overSrc)

for (const m of [b, o]) {
  console.log(
    `${m.label.padEnd(16)} srcBytes=${String(m.srcBytes).padStart(5)} srcCR=${m.srcCR}  ` +
    `emitBytes=${String(m.bytes).padStart(5)} emitCR=${m.cr} diags=${m.diags}  sha256=${m.sha}`,
  )
}

// 守衛 6：byte-identical（本量測的主張本身）
assert(b.sha === o.sha, `BYTE-IDENTICAL FAILED: base ${b.sha} !== overlay ${o.sha}（emit 差 ${o.bytes - b.bytes} bytes）`)

if (failures.length) {
  console.error('\n✗ ASSERTION FAILURES (' + failures.length + '):')
  for (const f of failures) console.error('  · ' + f)
  process.exit(1)          // ← fail-closed：任一守衛不成立即 non-zero exit
}
console.log('\n✓ ALL GUARDS PASSED (6/6)：src 非空 · src CR=0 · emit 非空 · emit CR=0 · diags=0 · BYTE-IDENTICAL')
process.exit(0)
___EMIT_EOF___
[ -s "$WORK/emit-identity.mjs" ] || fail "emit-identity.mjs 為空"

cat > "$WORK/expected-removed.txt" <<'___REMOVED_EOF___' || fail "cat expected-removed.txt"
functions/api/admin/audit.ts: error TS7006: Parameter 'r' implicitly has an 'any' type.
functions/api/admin/audit.ts: error TS7006: Parameter 'r' implicitly has an 'any' type.
functions/api/admin/audit.ts: error TS7006: Parameter 'raw' implicitly has an 'any' type.
functions/api/admin/audit.ts: error TS7031: Binding element 'env' implicitly has an 'any' type.
functions/api/admin/audit.ts: error TS7031: Binding element 'request' implicitly has an 'any' type.
___REMOVED_EOF___
[ "$(wc -l < "$WORK/expected-removed.txt")" -eq 5 ] || fail "expected-removed.txt 不是 5 行（部分寫入？）"

# ── 4. base 面 ─────────────────────────────────────────────────────────────
"$TSC" -b tsconfig.solution.json --force > "$WORK/tsc-base.txt" 2>&1
rc=$?; [ "$rc" -eq "$EXPECT_TSC_RC" ] || fail "base tsc rc=$rc（預期 $EXPECT_TSC_RC）—— 疑為工具失敗"
n=$(wc -l < "$WORK/tsc-base.txt") || fail "wc base"
[ "$n" -eq "$EXPECT_BASE_DIAGS" ] || fail "base 診斷 $n（預期 $EXPECT_BASE_DIAGS）"
npm_config_offline=true npm_config_yes=false \
  npm run typecheck:ratchet:report > "$WORK/ratchet-base.txt" 2>&1 || fail "base ratchet"
assert_ratchet "$WORK/ratchet-base.txt" base "$EXPECT_BASE_DIAGS" "$EXPECT_BASE_CLEAN" "$EXPECT_BASE_TOTAL"
npm run lint > "$WORK/lint-base.txt" 2>&1 || fail "base lint"

# ── 5. 物化 overlay ────────────────────────────────────────────────────────
node "$WORK/materialize-overlay.mjs" "$WORK/repo" "$BASE" "$WORK/repo/$REL" "$ANCHOR" \
  > "$WORK/materialize.txt" 2>&1 || { cat "$WORK/materialize.txt" >&2; fail "物化 overlay／anchor"; }

# ── 6. overlay 面 ──────────────────────────────────────────────────────────
"$TSC" -b tsconfig.solution.json --force > "$WORK/tsc-over.txt" 2>&1
rc=$?; [ "$rc" -eq "$EXPECT_TSC_RC" ] || fail "overlay tsc rc=$rc（預期 $EXPECT_TSC_RC）"
n=$(wc -l < "$WORK/tsc-over.txt") || fail "wc overlay"
[ "$n" -eq "$EXPECT_OVER_DIAGS" ] || fail "overlay 診斷 $n（預期 $EXPECT_OVER_DIAGS）"
npm_config_offline=true npm_config_yes=false \
  npm run typecheck:ratchet:report > "$WORK/ratchet-over.txt" 2>&1 || fail "overlay ratchet"
assert_ratchet "$WORK/ratchet-over.txt" overlay "$EXPECT_OVER_DIAGS" "$EXPECT_OVER_CLEAN" "$EXPECT_OVER_TOTAL"
npm run lint > "$WORK/lint-over.txt" 2>&1 || fail "overlay lint"

# ── 7. set-diff（每步 guard；exact multiset 逐位元組比對）───────────────────
sed -E 's/\(([0-9]+),([0-9]+)\)//' "$WORK/tsc-base.txt" > "$WORK/n-base-u.txt" || fail "sed base"
sort "$WORK/n-base-u.txt" > "$WORK/n-base.txt" || fail "sort base"
sed -E 's/\(([0-9]+),([0-9]+)\)//' "$WORK/tsc-over.txt" > "$WORK/n-over-u.txt" || fail "sed overlay"
sort "$WORK/n-over-u.txt" > "$WORK/n-over.txt" || fail "sort overlay"
comm -23 "$WORK/n-base.txt" "$WORK/n-over.txt" > "$WORK/removed.txt" || fail "comm REMOVED"
comm -13 "$WORK/n-base.txt" "$WORK/n-over.txt" > "$WORK/added.txt"   || fail "comm ADDED"
removed=$(wc -l < "$WORK/removed.txt") || fail "wc REMOVED"
added=$(wc -l < "$WORK/added.txt")     || fail "wc ADDED"
[ "$removed" -eq 5 ] || fail "REMOVED=$removed（預期 5）"
[ "$added" -eq 0 ]   || fail "ADDED=$added（預期 0）"
cmp -s "$WORK/removed.txt" "$WORK/expected-removed.txt" \
  || { echo "--- actual ---"; cat "$WORK/removed.txt"; echo "--- expected ---"; cat "$WORK/expected-removed.txt"; fail "REMOVED multiset 與 §6.1 宣稱不逐字相符"; }

# ── 8. emit identity（正向）─────────────────────────────────────────────────
node "$WORK/emit-identity.mjs" "$WORK/repo" "$BASE" "$WORK/repo/$REL" > "$WORK/emit.txt" 2>&1 \
  || { cat "$WORK/emit.txt" >&2; fail "emit identity（正向應 exit 0）"; }
grep -q "ALL GUARDS PASSED" "$WORK/emit.txt" || fail "emit 正向未見 ALL GUARDS PASSED"
grep -q "$BASE_EMIT_SHA" "$WORK/emit.txt"    || fail "base emit sha 不符"

# ── 9. 負向控制（斷言完整失敗集合）──────────────────────────────────────────
negctl() {
  local label="$1" file="$2"; shift 2
  local out rc got s
  out="$(node "$WORK/emit-identity.mjs" "$WORK/repo" "$BASE" "$file" 2>&1)"; rc=$?
  [ "$rc" -ne 0 ] || { echo "$out" >&2; fail "負向控制 $label 竟 exit 0"; }
  got=$(printf '%s\n' "$out" | grep -c '^  · ') || true
  [ "$got" -eq "$#" ] || { echo "$out" >&2; fail "負向控制 $label 失敗數 $got（預期 $#）"; }
  for s in "$@"; do printf '%s\n' "$out" | grep -q -- "$s" || { echo "$out" >&2; fail "負向控制 $label 未命中「$s」"; }; done
  echo "  ✓ $label：exit=$rc，失敗集合恰 $# 條且完全相符"
}
printf '' > "$WORK/n_empty.ts" || fail "造空 fixture"
node -e 'require("fs").writeFileSync(process.argv[2],require("fs").readFileSync(process.argv[1],"utf8").replace(/\n/g,"\r\n"))' "$WORK/repo/$REL" "$WORK/n_crlf.ts" || fail "造 CRLF fixture"
node -e 'require("fs").writeFileSync(process.argv[2],"type __BROKEN = ;\n"+require("fs").readFileSync(process.argv[1],"utf8"))' "$WORK/repo/$REL" "$WORK/n_diag.ts" || fail "造 TS1110 fixture"
node -e 'require("fs").writeFileSync(process.argv[2],require("fs").readFileSync(process.argv[1],"utf8")+"// G6 emit-changing comment\n")' "$WORK/repo/$REL" "$WORK/n_emit.ts" || fail "造 emit-diff fixture"

negctl "G1 src 非空 [coupled]"  "$WORK/n_empty.ts" "source is EMPTY" "emit is EMPTY" "BYTE-IDENTICAL FAILED"
negctl "G2 src CR=0 [coupled]"  "$WORK/n_crlf.ts"  "source contains" "emit contains" "BYTE-IDENTICAL FAILED"
negctl "G5 diags=0 [isolated]"  "$WORK/n_diag.ts"  "transpile diagnostics"
negctl "G6 identity [isolated]" "$WORK/n_emit.ts"  "BYTE-IDENTICAL FAILED"

echo ""
echo "✓ Tier B v4 全部斷言成立"
echo "  隔離：TMPROOT/WORK 均在 SRC 之外 · trap 先於 allocation · 前後各 probe 一次 · 🚫 driver 不執行刪除"
echo "  依賴：npm ci --include=dev · 本地 tsc 5.9.3 · npx --no-install → Version 5.9.3 · ratchet 以 npm_config_offline=true 執行"
echo "  證據：診斷 352/347 · ratchet 三欄 · REMOVED exact multiset · ADDED=0 · emit identity · 4 組負控"
exit 0
```

### 6.6.C driver 級負向控制 —— **宣告式清單**（② R6 Blocker 之處置：`SR-54`）

> 🚨 **上一版在此內嵌了一支會自動 `rm -rf` 的 harness，已整節移除。**
> ② R6 指出它**未隔離自己的 cleanup**：掃描整個共享 `$TMPROOT/tmp.*`，
> 並對「前後集合差」中的所有新目錄 `rm -rf` ⇒ **其他程序在該 case 執行期間建立的 `tmp.*`
> 會被當成 harness 殘留刪除**。另有三個 fail-open（`ls|sort` 無 pipefail、
> `comm … | grep -c . || true` 把量測失敗轉成 0、`trap` 內刪除失敗不提升 rc）——
> 三者我方皆以純 bash 復現。
>
> ⇒ **處置＝縮減，不是再加固**（② R6 明示「建議 R7 不再擴寫 shell machinery」）。
> 本節改為**宣告式變異清單**：只描述「改哪一行、期望什麼」，
> 🚫 **不提供會自動刪除任何東西的腳本**。要重播者請在 **runner 自有的 disposable workspace** 內套用。

**變異清單（對 §6.6.B 之 driver 逐一施加；每組期望 `rc=1` 並命中指定訊息）**：

| # | 變異（`sed` 運算式之語意） | 期望訊息 | 覆蓋之缺陷 |
|---|---|---|---|
| NC1 | `ANCHOR` 改為全 0 | `anchor 不符` | overlay 身分 |
| NC2 | `EXPECT_OVER_DIAGS` 改 999 | `overlay 診斷 347（預期 999）` | 診斷數 |
| NC3 | `WORK_CANON` 之 `cd` 改指不存在路徑 | `canonicalize WORK` | mktemp/trap 窗口 |
| NC4 | finalizer 內 `git status` 之 `-C` 改指不存在路徑 | `AFTER PROBE FAILED` | probe 假綠 |
| NC5 | `comm -13` 之輸入改為不存在檔 | `comm ADDED` | pipeline rc 丟棄 |
| NC6 | `TMPROOT` 改為 `$SRC` 自身 | `TMPROOT 位於 SRC 內` | temp/source overlap |

> ⚠ **NC6 已改用 `$SRC` 自身（`SR-55`）**：上一版用 `$SRC/node_modules`，
> 但那**依賴來源 repo 已存在未追蹤的 `node_modules`** ——
> 乾淨 checkout 會先失敗在 `canonicalize TMPROOT` 而非預期訊息 ⇒ **非環境獨立**（② R6 指出，我方確認）。
> `$SRC` 自身保證存在，equality rejection 可穩定重播。
>
> ⚠ **舊 NC7（`cd /` 失敗 ⇒ 拒絕刪除）已一併移除**：v4 driver **不執行任何刪除**，
> 該路徑已不存在 ⇒ 沒有可測的對象。（v3 之 `safe_rm()` 亦整段移除。）

**我方實測（2026-08-24，v3 driver ＋ 當時的 harness）**：7 組全部 `rc=1` 且命中預期訊息。
⚠ **誠實標示**：該次實測用的是 **v3 driver ＋ 已被移除的 harness**；
**v4 之上僅重跑了正向路徑（rc=0）**，🚫 未在 v4 上重跑全部變異。
⇒ 上表為**宣告式期望**，🚫 不宣稱「已在 v4 上逐組驗證」。
⚠ 且依 ② R6：這些結果**始終是作者自報**，非獨立 Tier B 證據。
> ⚠ **`git apply` 為何不可用於物化 overlay（`SR-43`；本棒實測）**：Windows Git Bash 下，
> 於無 `.gitattributes` 的樹執行 `git apply` 會把 LF 轉成 CRLF
> （實測 **+179 CR、7674 vs 7495 bytes**）⇒ anchor 必然不符，且**環境相依、非確定性**。
> ⇒ driver 改用「讀 immutable blob → 三次**唯一字串**替換（各自斷言恰 1 命中）→ Node 原樣寫出 → 自驗 sha256」。

> ⚠ **負向控制之 coupled vs isolated（`SR-44`；本棒實測，🚫 勿再宣稱四條皆隔離）**：
>
> | 注入 | 實際命中之守衛集合 | 分類 |
> |---|---|---|
> | 空輸入 | **G1 ＋ G3 ＋ G6**（3 條） | **coupled activation** |
> | CRLF | **G2 ＋ G4 ＋ G6**（3 條） | **coupled activation** |
> | `type __BROKEN = ;` | **G5**（1 條） | **isolated** ✅ |
> | emit-changing 註解 | **G6**（1 條） | **isolated** ✅ |
>
> ⇒ 精確表述：**isolated 恰 2 條（G5／G6）**；G1／G2 只能宣稱「target guard 已被啟動」，
> 🚫 **不得**宣稱逐條隔離。
> ⚠ 附帶收穫：G3／G4 先前被我標為「無法獨立注入」，實測顯示它們**確實會被啟動**（只是耦合），
> 故正確用詞是 **coupled activation**，🚫 不是「未驗證」。
> driver 對每組斷言**完整失敗集合**（條數 ＋ 逐條字串），🚫 不只看 exit code ——
> 這正是 ② R2 抓到 guard 5 測錯對象的根因。

## 7. 機械限制

### 7.1 EOL / encoding

本 repo 已由 `.gitattributes` 根治 CRLF churn。base blob 實測 `CR = 0`；overlay 實測 `CR = 0`。
🚫 改原始碼一律用逐檔編輯，**禁** PowerShell `-replace` ＋ `Set-Content`
（會把 CJK 打成 Big5 亂碼，[[feedback_powershell_batch_replace_encoding]] 實際發生過）。

⚠ 行數量測禁用 `Get-Content`（CJK 行低計，[[feedback_powershell_getcontent_cjk_line_undercount]]）；
本棒一律以 `wc -l` / `Buffer.byteLength` 量測。

### 7.2 ratchet `BAN_PATTERNS`

**本棒實測**（逐字讀 `scripts/typecheck-ratchet.mjs:803-825`，🚫 非引用他棒結論）：
掃描迴圈的輸入是 `unifiedDiff`，且只對 `line.startsWith('+') && !line.startsWith('+++')` 之行套 pattern。
⇒ `BAN_PATTERNS` 只套**在 diff 增量行**，🚫 不掃全檔既有行；且該 diff 取自 `origin/main...HEAD`（**committed**）。

⚠ **⇒ 改動未 commit 時，該檢查是 vacuous（母體為空）。**
本棒 §6.2 之 overlay ratchet 數字**只有 `errorCount` / `cleanFiles` / `sourceFilesTotal` 有效**
（來自真實 tsc 全量），🚫 **不得**把當時的 ratchet exit 0 讀成「BAN_PATTERNS 已通過」。
BAN_PATTERNS 的真實驗證只能在 **commit 之後**取得，列為 §9 coding 階段必跑項。

⚠ non-`any` `as` 不在 `BAN_PATTERNS` 之內 ⇒ §5.6 以人工計數補位。

### 7.3 dual-leaf 報數紀律

依 §6.0：`TS7xxx` 無重複、`functions/**` 的 base check 診斷成雙。
故 `ADDED` 一律**同時報 raw 與 distinct 位置數**；`REMOVED`（本棒全為 `TS7006`/`TS7031`）raw 即真實數。
🚫 禁只報其一、🚫 禁把兩種去重混為一談。

### 7.4 base 值必須在 coding 前取得

**已取得**（base `acc98dfb`，2026-08-22）：
`lint` EXIT 0 · `typecheck:ratchet` 352/325/337 · tsc 全量診斷 352 行 · base blob `ec2a9b07…` · base emit `10c1d1f8…`。

🚫 **禁**在 commit 之後用 `git stash` 取 base（source 已 commit ⇒ stash 為 no-op ⇒ 等於量了兩次 after）——
批 D 曾踩此假量測。
🚫 禁 `git checkout <base> -- <目錄>`（會改寫共用 worktree 與 index，撞平行 session）。
⚠ 唯一允許碰工作區的還原形式＝**單檔** `git checkout -- <單一檔案路徑>`。

### 7.5 隔離 worktree（若後續需要）

🚫 隔離 worktree 一律自帶 `npm ci`，不借主 repo `node_modules`
（junction ＋ `worktree remove` 會穿過 link 清空目標，[[feedback_worktree_junction_deletes_target]] 實際發生過）。
**本棒未使用隔離 worktree**（overlay 法已足夠），此條為紀律備載。

---

## 8. 測試計畫

**本棒不新增測試**，理由逐條：

1. **無行為可測**：全部改動 erase 後不產生任何語句（§4.2 逐條可核），
   §6.3 之單檔 transpile emit byte-identical 為其機械證據
   ⇒ **本檔內**不存在任何新的 runtime 行為可供 regression test 鎖定。
   依 [[feedback_regression_test_must_lock_exact_failure]]，測不到 exact failure 的 test 即為
   「為覆蓋率寫的無意義 test」，本基線明文禁止。
   ⚠ **範圍限定（`ARCH-BR-R2` 族，`SR-29`）**：此推論之作用域是**本檔的 transpile 輸出**，
   🚫 不延伸到 production bundle（該面由 §9.1 `build:functions` 守備）。
2. **既有覆蓋存在且已實證與新標註相容**（見 §8.1）。
3. **型別宣告本身不可測**：`UserAuditRow` 為 erase-only 宣告，無 runtime 存在。

### 8.1 既有測試耦合面（**實測**，🚫 非推定）

> **母體 ＝ `tests/` 全部檔**（零收窄）
> **重播指令**：`grep -rn "api/admin/audit'" tests/`

**實測結果**：`tests/integration/user-audit.test.ts:18` **直接 import 本檔的 `onRequestGet`**：

```js
import { onRequestGet as auditHandler } from '../../functions/api/admin/audit'
...
const resp = await auditHandler({
  request: new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
  env,
})
```

⇒ 本棒對 `onRequestGet` 簽章加的 `{ request: Request; env: Env }` 標註**確實會被 tests leaf 檢查到**
（tests leaf 之 `noImplicitAny` 雖為 `false`，但 base check `TS2345` 兩 leaf 皆啟用）。

**相容性之證據＝§6.1 之 `ADDED = 0`（母體含 `tests/**`）** —— 即實測未在該呼叫點產生任何新診斷。
🚫 此結論**不是**由「`env` 應該相容 `Env`」推理得出，而是由全量診斷 set-diff 實證。

> ⚠ **自審更正（`SR-7`）**：本節初稿曾寫「本檔零 export 給測試直接 import」，**經量測證偽**。
> 該敘述是在未跑 `tests/` 母體掃描的情況下寫下的推定。
> 教訓＝同批 E「母體 < 性質」族的又一實例：以「我沒看到」代替「我掃過且沒有」。
> ⚠ 反向掃描另得 4 個 test 檔提及字串 `api/admin/audit`
> （`admin-audit-delete` / `audit-aggregate-archive-retry` / `audit-archive-retry` / `user-audit`），
> 其中只有 `user-audit.test.ts` 是**直接 import 本檔**；其餘為路徑字串或鄰近端點，不構成本檔耦合。

⚠ **誠實標示**：本棒因此**不提供**任何「D1 row 真的符合 `UserAuditRow`」的證據。
該宣稱之地位見 §4.4，其風險登記於 §10 `TD-BATCHB-1`。

---

## 9. Required gates

### 9.1 CI-aligned（逐字讀 `.github/workflows/ci.yml`）

> **母體 ＝ `ci.yml` 之全部 `run:` step，實測恰 8 個**（重播：`grep -n "run:" .github/workflows/ci.yml`）
> **宣告排除 ＝ 1 個**：`npm ci`（依賴安裝，非品質 gate）。排除理由列於此處而非藏於推理。
> ⇒ **gate 數 ＝ 8 − 1 ＝ 7**，下表恰 7 列（列數與母體算式互證）。

| # | 命令 | 地位 |
|---|---|---|
| 1 | `npm run lint` | CI step「Lint (ESLint)」 |
| 2 | `npm run typecheck:ratchet` | CI step「Typecheck ratchet」⚠ **須在 commit 後跑**（§7.2） |
| 3 | `npm run verify:browser-pipeline` | CI step「Verify browser pipeline」 |
| 4 | `npm run test:cov` | CI step；⚠ CI 為 fail-fast 單 job，cov 紅會遮蔽其後 |
| 5 | `npm run test:int` | CI step |
| 6 | `npm run build:functions` | CI step；本棒唯一觸及 production bundle 的守備（§6.3 範圍限定） |
| 7 | `npm audit --omit=dev --audit-level=high` | CI step |

依 [[feedback_pre_merge_gate_checklist_match_ci]]：merge 前須**跑齊**上列 7 道並讀真實輸出，
🚫 不靠 agent 推理；且須查 main Actions。**最常漏 `test:cov`。**

> ⚠ **本 PLAN 階段尚未執行上列任一道**（`SR-20`）。§6 已跑者僅 `tsc --force`／`typecheck:ratchet:report`／`lint`
> 三項，且皆在 **overlay 而非 commit** 之上（`typecheck:ratchet` 的 `BAN_PATTERNS` 面因此 vacuous，見 §7.2）。
> 🚫 本檔任何章節**不得**被讀成「CI gate 已通過」。7 道之真實執行屬 **coding 階段**，
> 其結果由當時的中文報告第 5 欄承載，🚫 不寫回本節。

### 9.2 非 CI、但本棒仍會跑（誠實標示其地位）

| 命令 | 地位 |
|---|---|
| `tsc -b tsconfig.solution.json --force` ＋ set-diff（**Tier B driver 內以本地 `node_modules/.bin/tsc` 執行**） | **診斷器**，🚫 非 gate、🚫 不進 CI |
| §6.6.B driver 之 emit identity 段 | **診斷器**，🚫 非 gate、🚫 不進 CI |
| ⚠ **npx 之誠實限定（`SR-50`）** | 本 driver 直接呼叫 tsc 時用**本地 binary**；但 `npm run typecheck:ratchet:report` **內部**（`scripts/typecheck-ratchet.mjs:188`）仍 `execSync('npx tsc …')`，**不在本 driver 控制範圍內** ⇒ 🚫 **不得宣稱「本流程完全不用 npx」**。緩解兩層：(a) driver 斷言 `npx --no-install tsc --version` 恰為 `Version 5.9.3`（本地已解析）；(b) **v4 起**兩次 ratchet 皆以 `npm_config_offline=true npm_config_yes=false` 執行（實測不改變輸出）。⚠ 仍非絕對保證 —— ② R6 指出 `--no-install` 只證明**當下**可解析；🚫 不得宣稱「機械上不可能下載」 |
| `npm run lint:handlers` · `npm run lint:archive-no-delete` · `npm run lint:migrations` | 非 CI step；**個別直跑**（見下方警語），本棒無 migration、無 archive 檔改動，跑之為額外保險 |

> ⚠ **🚫 本棒不跑 `npm run build`**（自審 `SR-10`）。
> `build` ＝ `build:partials && lint:handlers && lint:archive-no-delete && lint:migrations`，
> 其首段 `build:partials` 會**重寫 `public/*.html`**。本棒為**純 backend 改動**，
> 依 [[feedback_asset_versioning_content_hash]]「純 backend/docs/tests 不需 cache-bust commit」，
> 觸發 frontend artifact 變更會把無關檔捲進 PR（＝ scope creep ＝ Gate fail）。
> ⇒ 只個別直跑後三個 lint 子命令，取得同等守備而不動 `public/`。

### 9.3 無 migration ⇒ 不觸發自動部署 schema 風險

本棒**零 `migrations/*.sql` 改動** ⇒ [[feedback_migration_before_merge_autodeploy]] 的
expand→migrate→contract 序列**不適用**。（⚠ 這是「不適用」，不是「已豁免」。）

---

## 10. 風險與失效模式

| ID | 風險 | 嚴重度 | 緩解 |
|---|---|---|---|
| `R-B1` | `UserAuditRow` 與 SELECT 欄位清單漂移（改一邊未改另一邊） | 中 | §4.5 逐欄對照表 ＋ 宣告內 JSDoc 明文要求同步；⚠ **無機械強制**，登記為 `TD-BATCHB-1` |
| `R-B2` | `UserAuditRow` 被後續讀者誤讀成「D1 row 已型別化」或「表結構 SoT」 | 中 | §4.4 四條逐項否定 ＋ 宣告內 JSDoc 同步書明 |
| `R-B3` | `strict: true` 落地後 `user.role`（`string \| undefined`）→ `canRoleSeeAuditEvent(role: string)` 可能轉紅 | 低 | 今日 `strictNullChecks` 未開故不觸發；登記為 `TD-BATCHB-2`，Stage 7 終態棒次處理 |
| `R-B4` | coding 階段實作與 §6 被量測的 overlay 不同 | 中 | §6.3 replay anchor `sha256 = 79792231…`（`sha256sum`，🚫 非 git blob SHA）；落地後必須雜湊到此值，不符即停手 |
| `R-B5` | 誤把 overlay 階段的 ratchet exit 0 讀成 `BAN_PATTERNS` 已過 | 中 | §7.2 明文標示其 vacuous；§9.1 列為 commit 後必跑 |

### 10.1 `TD-BATCHB-1`：投影列宣告與 SELECT 之同步為人工紀律

**內容**：`UserAuditRow` 與 `functions/api/admin/audit.ts` 之 SELECT 欄位清單必須同步，
但今日**無任何機械檢查**強制此事。

**母體與現況（本棒實測，供接手棒次起點；⚠ 接手者須自行重新量測，🚫 不得沿用本數字）**：
本 repo 中「D1 SELECT 投影 ↔ TypeScript 宣告」之配對母體**未經量測**，本棒僅處置本檔這一組。

**本棒不修**：屬 repo-wide 治理面（等同 `governance-hygiene-lints` backlog 之 P5 家族），
夾帶進一個 5 條標註的 type-only 棒次會構成 scope creep（＝ Gate fail）。
外送 backlog，🚫 不在本棒處置。

### 10.2 `TD-BATCHB-2`：`strict: true` 之前瞻紅點

`AuthedUser.role` 宣告為 `role?: string`（`functions/utils/auth.ts:29`），
而 `canRoleSeeAuditEvent(eventType: unknown, role: string)`（`functions/utils/roles.ts:73`）要求 `string`。
今日 `strictNullChecks: false` ⇒ `string | undefined` 塌陷為 `string` ⇒ **不報錯**。
`strict: true` 落地後此處會成為需處置點。**本棒不修**（超出 `noImplicitAny` scope）。

---

### 10.3 `TD-BATCHB-3`：D1 讀取邊界之 typed／validated boundary（`UB-B-1` 之根本解）

**內容**：`UB-B-1`（§4.4）登錄的是「`any` → `UserAuditRow[]` 之 unchecked assignment」。
根本解＝讓 D1 讀取邊界**真的有型別或有驗證**，兩條路徑：
(a) 安裝 `@cloudflare/workers-types` ⇒ `D1Database` 不再解析為 `any`，賦值會被真檢查；
(b) 在邊界加 runtime validation（schema 驗證後才進 domain）。

**本棒不做**：(a) 是 repo-wide 依賴變更（影響全部 `functions/**` 的型別面，且會與 Stage 7
的 ratchet baseline 交互作用）；(b) 破 type-only 性質、需補測試、需重測 anchor。
兩者皆遠超 `SPEC-B1` 之單檔 `noImplicitAny` 清零 scope ⇒ **外送 backlog**。

⚠ **本 TD 的母體未量測**：repo 中「D1 讀取後賦值給具名型別」的配對總數本棒**未清點**，
🚫 接手者不得沿用「只有這一處」的印象，須自行量測。

## 11. 高風險領域加碼判定

依全域 §高風險領域加碼層，逐條檢查觸發條件（母體＝該節列舉之 7 類，零收窄）：

| 觸發類 | 是否觸發 | 依據 |
|---|---|---|
| Queue / Message | ❌ | 本檔無 queue／outbox |
| WebSocket / SSE | ❌ | 本檔為單次 GET |
| Streaming | ❌ | 回應為一次性 JSON |
| Payment / 退款 / Webhook | ❌ | 本檔不觸金流 |
| Transaction 跨資源 | ❌ | 只讀 D1，無跨資源寫入 |
| Distributed State | ❌ | 無共享可變 state |
| 跨系統 JSON Contract | ❌ | 單 repo frontend↔backend，非跨服務 |

⇒ **加碼層不觸發。**

### 11.1 但本檔屬**安全邊界**（不因加碼層不觸發而放鬆）

本檔同時承載三項安全機制：
1. **RBAC 讀取過濾** — `canRoleSeeAuditEvent(r.event_type, user.role)`（support role 之 event 前綴白／黑名單）
2. **PII 白名單裁切** — `SAFE_EVENT_DATA_KEYS` ＋ `redactEventData`
3. **admin_read rate limit** — `checkRateLimit` / `recordRateLimit`，以及 rate-limit 命中時的 warn audit

⇒ 套用 [[feedback_security_boundary_pr_first_do_no_harm]]：**最小 diff**。
本棒**零**觸及上列三項的任何一行邏輯。

**機械背書及其範圍限定**：§6.3 之 byte-identical emit 證明「本檔 **transpile 後的 JS 逐字相同**」
⇒ 三項機制在**本檔內**的執行語意逐字未變；三項機制所依賴的外部模組
（`roles.ts` / `rate-limit.ts` / `user-audit.ts` / `auth.ts`）本棒**零改動**（§5.4）。
⚠ 但依 §6.3 之限定，該量測為**單檔 transpile identity**，🚫 **不是** production bundle identity；
bundle 面的守備是 §9.1 第 6 道 `build:functions`，🚫 不得把 §6.3 讀成已涵蓋 bundle。

### 11.2 F-3 三軸

| 軸 | 本棒狀態 |
|---|---|
| R2 lock / retention posture | **零觸碰**（本檔不接觸 R2；§5.4 已排除全部 6 個 archive 相關檔） |
| archive derive 公式 | **零觸碰** |
| parity test 27/27 | 不受影響（本棒不改 F-3 三檔、不改 `tsconfig.tests.json`）；仍由 §9.1 `test:cov` / `test:int` 覆蓋 |

---

## 12. Rollback

**回滾單位＝整個 squash commit**（`git revert <squash-sha>`）。

無 migration、無 schema、無 env 變更、無 R2 狀態 ⇒ **revert 即完全復原**，無殘留副作用、無資料面補償動作。

⚠ **rollback 之成立不需要、也不援引 bundle-equivalence 這個命題**（`ARCH-BR-R2` 之處置）：
上述四個「無」已足以說明 repo／資料面 rollback。
production bundle 面**仍由 coding-stage 之 `build:functions` 驗證**，
🚫 **不由 §6.3 之單檔 transpile identity 推導** —— 該證據的範圍限定見 §6.3 末段與 §11.1。

---

## 13. 非目標

🚫 本棒**不**做下列任何一項（列出以杜絕 scope creep）：

1. 不開 `strict` / 不動任何 `tsconfig*.json`
2. 不 `typecheck:baseline:update`（baseline `1119/175` **凍結**）
3. 不處置 `functions/api/admin/audit/[id].ts`（＝ `B-delete`，destructive-last）
4. 不處置 aggregate 家族 4 檔（`SPEC-B1` 落選案）
5. 不觸 F-3 相關 6 檔
6. 不新增／不修改測試（§8）
7. 不新增任何 runtime validation、不改任何 SQL、不改任何 audit event 名
8. 不建立 repo 內 scanner／gate script（§5.4）
9. 不裁定其餘 **10** 個未裁定單元的字母對映（`SPEC-B3`；對映帳見 §2.1.1）
10. 不處置 `TD-BATCHB-1` / `TD-BATCHB-2`（外送 backlog）

---

## 14. Gate 軌跡

### 裁決 ledger（append-only；**外部 gate verdict 之唯一 SoT**）

> ⚠ 本標題於 ① R1 `ARCH-BR-R1` 後由「gate 狀態之唯一 SoT」收窄為「**外部 gate verdict** 之唯一 SoT」——
> 維度 A self-review closure 不在本檔範圍內（見開頭狀態讀法）。自審 `SR-28` 補抓：R1 首次處置時
> 只改了開頭段落、**漏改本標題**，等於同一個矛盾仍原地存活。

| # | 時點 | 事件 | 錨點 |
|---|---|---|---|
| 1 | 2026-08-22 | `SPEC-B1` / `SPEC-B2` / `SPEC-B3` owner 當輪裁定 | §3 |
| 2 | 2026-08-22 | base 量測完成（lint EXIT 0 · ratchet 352/325/337 · tsc 352 · blob `ec2a9b07…`） | §7.4 |
| 3 | 2026-08-22 | MEASURED_OVERLAY 完成（REMOVED 5 / ADDED 0 · ratchet 347/326/337 · emit byte-identical） | §6 |
| 4 | 2026-08-22 | 兩組負向控制完成（診斷 oracle `ADDED=2`；emit oracle `BYTE-IDENTICAL:false`） | §6.4 |
| 5 | 2026-08-22 | overlay 還原並驗 blob `ec2a9b07…` byte-identical | §6.5 |
| 6 | 2026-08-22 | `B-OD-1` 設計改採 v2（邊界標註），v1 降為負向控制 | §4.3 |
| 7 | 2026-08-22 | 工作 branch 開出：`stage7/pr2dw-batchb-read-admin-audit`（base `acc98dfb`）。🚫 未動 main | — |
| 8 | 2026-08-22 | 負向控制於採用案 overlay 上重測（`SR-18` 之處置） | §6.4.1 |
| 9 | 2026-08-22 | `B-OD-2` 命名裁決（`AuditLogRow` → `UserAuditRow`，避同字串異概念） | §4.3.1 |
| 10 | 2026-08-22 | **改名後全套證據重測**：anchor `79792231…` · diff `+29/-3` · set-diff `5/0` · emit `10c1d1f8…` byte-identical · 負向控制 `ADDED=2` · ratchet 347/326/337 · lint EXIT 0 | §5.5 §6 |
| 11 | 2026-08-22 | PLAN R1 commit `9d1f29d5`；① packet v1 送出（`2aa808b8…` ＋ plan 副本 `942afd65…`） | §14.2 |
| 12 | 2026-08-23 | **① R1 verdict ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Blocker／2 Required／2 Non-blocking），錨點 PLAN `9d1f29d5` | §14.2 |
| 13 | 2026-08-23 | ① R1 兩個 Required 處置完成（ultra-narrow，**PLAN-only、零 code diff 變動**） | §14.2 |
| 14 | 2026-08-23 | PLAN R2 HEAD `d31cb3e2`；① R2 delta packet 送出（`5f68f9d2…`） | §14.3 |
| 15 | 2026-08-23 | **① R2 verdict ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Blocker／**1 Required**／2 NB carry-forward）：`ARCH-BR-R1` 與 `ARCH-BR-R2` **CLOSED**；新增 `ARCH-BR-R2-RR1-VERDICT-AMPLIFICATION` | §14.3 |
| 16 | 2026-08-23 | `ARCH-BR-R2-RR1` 族處置完成（4 成員；**PLAN-only、零 code diff 變動**） | §14.3 |
| 17 | 2026-08-23 | PLAN R3 HEAD `24a073f5`；① R3 delta packet 送出（`92896a86…`） | §14.4 |
| 18 | 2026-08-23 | **① R3 verdict ＝ `CHATGPT_ARCH_APPROVED`**（0 Blocker／0 Required／2 NB carry-forward）＠ `24a073f5`；三個 Required 全 CLOSED；`SR-32` 經 ① 裁定保留 | §14.4 |
| 19 | 2026-08-23 | PLAN `ee240a1e`；② Codex Plan Gate packet 送出（`142cb51f…`） | §14.5 |
| 20 | 2026-08-23 | **② R1 verdict ＝ `CODEX_PLAN_CHANGES_REQUESTED`**（**1 Blocker `TS-BOUNDARY-002`**／1 Required `GOV-EVIDENCE-001`+`GOV-FAIL-001`）＠ `ee240a1e` | §14.5 |
| 21 | 2026-08-23 | ② R1 兩個 family 處置完成（`UB-B-1` 登錄 ＋ replay recipe 隔離化 ＋ 守衛 fail-closed；**PLAN-only、零 code diff 變動**） | §14.5 |
| 22 | 2026-08-23 | PLAN R2 `548e2b89`；② R2 delta packet 送出（`eedabcc3…`） | §14.6 |
| 23 | 2026-08-23 | **② R2 verdict ＝ `CODEX_PLAN_CHANGES_REQUESTED`**（1 Blocker／1 Required）；**`TS-BOUNDARY-002` CLOSED**；② **撤回**其 R1 之「必然改 changed-files／需重送 ①」與「isolated clone 即 reviewer-safe」兩項過廣前提 | §14.6 |
| 24 | 2026-08-23 | ② R2 兩個 family 處置完成（`REPLAY-AUTHORIZATION-TIERS` 兩層 ＋ 逐步 fail-closed ＋ before/after equality 斷言 ＋ guard 5 注入改 `type __BROKEN = ;`；**PLAN-only、零 code diff 變動**） | §14.6 |
| 25 | 2026-08-23 | PLAN R3 `ce327b6b`；② R3 delta packet 送出（`8f1e9cf4…`） | §14.7 |
| 26 | 2026-08-24 | **② R3 verdict ＝ `CODEX_PLAN_CHANGES_REQUESTED`**（1 Blocker family／1 Required family）；guard 5 修正與 actor split 概念判 CLOSED | §14.7 |
| 27 | 2026-08-24 | ② R3 兩個 family 處置完成：**發布已端到端實跑之連續 Tier B driver**（rc=0）＋ Tier A 可執行化；**PLAN-only、零 code diff 變動** | §14.7 |
| 28 | 2026-08-24 | PLAN R4 `956ebe3a`；② R4 delta packet 送出（`a8ca80b3…`） | §14.8 |
| 29 | 2026-08-24 | **② R4 verdict ＝ `CODEX_PLAN_CHANGES_REQUESTED`**（1 Blocker family／1 Required family ＋ 4 項文字清理）；Tier A・連續 driver・overlay/emit 重播・coupled/isolated 分類 判 CLOSED | §14.8 |
| 30 | 2026-08-24 | ② R4 處置完成：**driver v2 端到端實跑 rc=0 ＋ 5 組 driver 級負控全紅**；四項文字清理併入；**PLAN-only、零 code diff 變動** | §14.8 |
| 31 | 2026-08-24 | PLAN R5 `dd4bb881`；② R5 delta packet 送出（`2cbcd9fb…`） | §14.9 |
| 32 | 2026-08-24 | **② R5 verdict ＝ `CODEX_PLAN_CHANGES_REQUESTED`**（1 Blocker／2 Required／1 Minor）；R4 之 comm rc・after-probe rc・exact multiset・ratchet 三欄・emit guard 判**已關閉** | §14.9 |
| 33 | 2026-08-24 | ② R5 處置完成：**driver v3 實跑 rc=0** ＋ **§6.6.C 可重播 harness 7 組全紅** ＋ Tier A canonicalize ＋ npx 宣稱誠實縮窄 ＋ stale pointer 斷言式清理；**PLAN-only、零 code diff 變動** | §14.9 |
| 34 | 2026-08-24 | PLAN R6 `c4317d63`；② R6 delta packet 送出（`0585a9e7…`） | §14.10 |
| 35 | 2026-08-24 | **② R6 verdict ＝ `CODEX_PLAN_CHANGES_REQUESTED`**（1 Blocker／2 Required／1 Minor）；Blocker **由我方新發布的 harness 自身引入**；② 主動建議「不再擴寫 shell machinery」 | §14.10 |
| 36 | 2026-08-24 | ② R6 處置＝**verification strategy 縮減**：§6.6.C harness 整節移除改宣告式清單 ＋ driver v4 移除全部 `rm -rf`（workspace 交 runner）＋ NC6 改用 `$SRC` 自身 ＋ ratchet 帶 offline ＋ 382→362 ＋ 根因帳 11→14；**PLAN-only、零 code diff 變動** | §14.10 |
| 37 | 2026-08-24 | PLAN R7 `d22e8b5e`；② R7 delta packet 送出（`ff3683cc…`／6309 B ＋ plan 副本 `4c99c075…`／174888 B，與 PLAN blob 逐位元組相同） | §14.11 |
| 38 | 2026-08-24 | **② R7 verdict ＝ `CODEX_PLAN_APPROVED`**（0 Blocker／0 Required／**1 Minor NB `GOV-DRIFT-001`**）＠ `d22e8b5e`；② 明示此 approval **≠ `CODING_ALLOWED`**，須 owner 明示；② 亦裁定不需重送 ① | §14.11 |
| 39 | 2026-08-24 | **owner 當輪明示 `CODING_ALLOWED`** → Phase 2 實作落地：檔案 sha256 **逐位元組命中** approved overlay anchor `79792231…`；7 道 CI gate 全綠；`GOV-DRIFT-001` 四項併修（`SR-58`）＋ `UB-B-1` addendum（`SR-59`） | §14.11 |

### 14.0 維度 A self-review 處置（**append-only 歷史**）

> 🚫 **本表不宣告 closure**、🚫 不持有「目前是否乾淨」之 live 副本 —— 它只記錄**曾經發生**的
> finding 與其處置。closure 之判定不在本檔（沿本檔開頭之狀態讀法）。
> **形式 ＝ 單 agent 對抗式**（`SPEC-B2`）；主線獨立讀真碼／真輸出裁決，🚫 無 subagent raw 輸出被直接採用。

| ID | 內容 | 性質 | 處置 |
|---|---|---|---|
| `SR-1` | §5.5 之 hunk 行數為目測推估、與實測不符（`+23/-3` vs 實際 `+25/-3`） | **實質錯誤** | 改為對 overlay 快照之實測 `diff -u`；加註更正 |
| `SR-2` | §2.1.1 寫「6 檔 `onRequestPost`」，實測為 5 | **實質錯誤** | 更正為 5，並補「5+5+1+1=12」母體帳平斷言 |
| `SR-3` | §9.1「恰 7 道」未宣告母體與排除項 | 治理形式 | 補「母體＝8 個 `run:` step、宣告排除 `npm ci`」算式 |
| `SR-4` | §4.6 重播指令用 basic grep 跑 `\|` alternation ⇒ 照抄會得 0 命中之**假綠** | **可執行性缺陷** | 改 `grep -rEn` 並明寫 `-E` 不可省 |
| `SR-5` | §6.6 replay recipe 未標 shell 需求（`<(...)` 需 bash） | 可執行性 | 補 Shell 需求段 |
| `SR-6` | §11.1 之機械背書未回指 §6.3 範圍限定，可能被讀成 bundle 級保證 | 過度宣稱 | 補範圍限定與 `build:functions` 指向 |
| `SR-7` | §8 宣稱「本檔零 export 給測試直接 import」，**經量測證偽**（`user-audit.test.ts:18` 直接 import） | **實質錯誤** | 新增 §8.1 實測段；相容性改由 `ADDED=0` 實證背書 |
| `SR-8` | §7.2 之 `BAN_PATTERNS` 掃描範圍為引用、未實測 | 未驗證引用 | 逐字讀 `typecheck-ratchet.mjs:803-825` 後改為本棒實測 |
| `SR-9` | §6.3 anchor 未指明雜湊指令，可能被誤用 `git hash-object` 比對 | 可執行性 | 明訂 `sha256sum`，並警告勿與 git blob SHA 混用 |
| `SR-10` | §9.2 建議跑 `npm run build`，其 `build:partials` 會重寫 `public/*.html` ⇒ 捲入無關檔 | **scope 風險** | 改為個別直跑三個 lint 子命令；加警語 |
| `SR-11` | §4.4「未安裝 `@cloudflare/workers-types`」為引用批 E、未實測 | 未驗證引用 | 本棒實測（母體 17 項、命中 0）後改寫 |
| `SR-12` | §6.0 兩 leaf `noImplicitAny` 設定為引用、未實測 | 未驗證引用 | 本棒 `JSON.parse` 逐字讀 config 後改寫 |
| `SR-13` | 未裁定單元數在 §2.1.1（14）與 §3（15）互相矛盾，且皆與實際（10）不符 | **實質錯誤** | 改為逐項列名之「6 已落成／10 未裁定」對映帳 |
| `SR-14` | §5.5 標題仍稱「預測」，內容已是實測 | 內部矛盾 | 標題改為「diff shape」 |
| `SR-15` | §5.5 把 plan doc 標為 `M`，實際為新增 `A` | **實質錯誤** | 更正為 `A` |
| `SR-16` | §5.4／§6.6 稱腳本「全文內嵌」，實為精簡等效版 | 過度宣稱 | 改為「可獨立執行之等效版本（邏輯逐字相同、輸出格式較精簡）」 |
| `SR-17` | §6.1 稱「插入 21 行」，實測為 22 | **實質錯誤** | 更正為 22，並與 §5.5 hunk 1 計數互證 |
| `SR-18` | §6.4.1 負向控制實際施加於 **v1** overlay，卻被寫成適用 v2 | **證據錯置** | **於 v2 上重新量測**（得同值 `ADDED=2`）；🚫 不以等價推理代替量測 |
| `SR-19` | §4.1 未給 JSDoc 逐字內容，但 §5.5 對其行數作計數宣稱 ⇒ gate 無法逐字核對 | 可核對性 | §4.1 補逐字 block，並與 §5.5 計數互證 |
| `SR-20` | §9.1 列出 7 道 CI gate，但未言明本 PLAN 階段**尚未執行**任一道 ⇒ 可能被讀成已通過 | 過度宣稱 | §9.1 補「PLAN 階段未執行」明示 |
| `SR-21` | 型別名 `AuditLogRow` 與 `utils/audit-log.ts:30` 既有同名型別**撞名且指涉不同資料表**（`audit_log` vs `admin_audit_log`） | **實質架構問題** | 改名 `UserAuditRow`（新增 `B-OD-2` §4.3.1）；**全部證據於改名後重測**（anchor／diff／set-diff／emit／負向控制／ratchet／lint） |
| `SR-22` | §4.3 之 `v1`/`v2` 標籤與 §4.3.1 改名軸的關係未說明 ⇒ §6.3 anchor 可能被誤讀成對應 §4.3 的 v2 | 內部可讀性 | §4.3 補「軸的分離」警語，明示最終落地＝v2 位置 ＋ `B-OD-2` 名稱 |
| `SR-23` | §6.4.2 之 v1 量測取得於改名前，未標時序 | 證據時序 | 補時序誠實標示；明說不宣稱「改名後 v1」之值 |
| `SR-24` | `functions/utils/audit-log.ts` 未列 `B_EXCLUDES`，但 §4.3.1 討論其 `AuditLogRow` ⇒ 可能被誤讀成本棒會一併改它 | **scope 清晰度** | 明列入 `B_EXCLUDES` 並寫明「避名而非重構既有型別」；同時把 baseline 路徑改為實測值 `types/typecheck-baseline.json` |
| `SR-25` | §4.3.1 稱 `user-audit.ts` 為 `audit_log`「唯一寫入端」，**經量測證偽**（另有 1 `UPDATE` ＋ 1 `DELETE`） | **實質錯誤**（全稱宣稱） | 新增 §4.3.1.1 三型態母體量測；表述改為「唯一的**列產生**端」 |
| `SR-26` | §4.6 稱既有寫法「一律 inline 物件型別」，但支撐之 grep 輸出被 `head -12` **截斷** ⇒ 對前 12 筆下全稱斷言 | **實質錯誤**（截斷母體） | 重跑完整母體（143 個 handler ＋ 兩道反向掃描），結論成立且更強（本棒形式為 99/143 多數） |
| `SR-27` | ① R1 處置時插入之 §14.2 落在 §14.1 **之前** ⇒ 子章節編號亂序（14.0→14.2→14.1） | 文件結構 | 把較短的 §14.1 移到 §14.2 之前；🚫 未改任何 §14.2 交叉引用（4 處皆仍指 §14.2） |
| `SR-28` | ① R1 之 SoT 收窄**只改了開頭段落**，`### 裁決 ledger` 標題仍寫「**gate 狀態**之唯一 SoT」⇒ 同一矛盾在標題原地存活 | **R1 漏修**（Required 未真正封上） | 標題同步收窄為「**外部 gate verdict** 之唯一 SoT」＋ 加註本次漏修事實 |
| `SR-29` | 依 `SR-28` 教訓做**族掃描**後發現：`ARCH-BR-R2` 之過度宣稱**不只在 §12** —— §1 之「零 runtime delta」與 §8 之「不存在任何新的 runtime 行為」同樣是由單檔 transpile 證據跨推 runtime 級性質 | **R2 族存活成員**（① 只點名 §12） | 兩處一併加範圍限定；三處（§1／§8／§12）同時封上。⚠ 這是**同一個 Required 的完整族處置**，🚫 非新增 scope |
| `SR-30` | §14.0 表格內有**三個**空行（在 `SR-21`／`SR-24`／`SR-25` 三列之後）⇒ markdown 把單一表格切成四張，渲染破碎 | 文件結構 | 刪除三個空行，恢復單一連續表格。⚠ **肉眼只抓到 2 個，第 3 個由機械掃描抓出**（母體＝全檔 25 張表之全部列）—— 再次印證「族處置須靠枚舉、不靠記憶」 |
| `SR-31` | `SR-28` 註記被插在「代替對真實母體的量測。」與其結論句「⇒ 印證…修過不代表免疫」之間 ⇒ 該結論句脫離其所屬段落、看起來像在總結 `SR-28` | 文脈斷裂 | 把結論句移回原段落末；`SR-28`／`SR-29` 合併為獨立註記段 |
| `SR-32` | §13 非目標第 9 項仍寫「其他 **15** 個單元」⇒ `SR-13`（單元數帳）之**第三個成員**，我修 §2.1.1 與 §3 時漏掉 | **實質錯誤**（族處置不完整，第 3 次） | 改為「其餘 **10** 個未裁定單元」＋ 指向 §2.1.1 對映帳 |
| `SR-34` | §14 待填清單標頭仍寫「留空待填」，但 ① 已由實際 gate 回覆填入 ⇒ 標頭與內容不一致 | 內部一致性 | 改為「只由實際 gate 回覆填入（已回覆者填 verdict／未回覆者維持 `_待填_`）」 |
| `SR-35` | §5.6 suppression 預算的**母體是「文字上的 suppression 語法」**（`as T` / `: any` / `@ts-*`），但要保護的性質是「**未經檢查的型別宣稱**」⇒ `const rawRows: UserAuditRow[] = <any>` 這種**隱式 unchecked assignment 落在母體外**，卻是本棒最強的型別宣稱 | **實質錯誤**（母體 < 性質，第 11 次；② `TS-BOUNDARY-002` 之根因） | §5.6 補「unchecked assignment」列（預算 1／實際 1）＋ errata；登錄 `UB-B-1`；附啟發式重播指令並標明其非機械閘 |
| `SR-54` | **我新發布的 §6.6.C harness 自己引入 Blocker**：掃描整個共享 `$TMPROOT/tmp.*`，並對「前後集合差」中所有新目錄 `rm -rf` ⇒ **其他程序於該 case 期間建立的 `tmp.*` 會被當成殘留刪除**；另三個 fail-open（`ls\|sort` 無 pipefail · `comm…\|grep -c . \|\| true` 把量測失敗轉成 0 · `trap` 內刪除失敗不提升 rc），三者皆以純 bash 復現 | **Blocker**（② R6；**「為了證明安全而寫的工具本身變成危險來源」**） | **縮減而非加固**（② 明示「不再擴寫 shell machinery」）：§6.6.C 整節改為**宣告式變異清單**、🚫 不再內嵌任何會刪除的腳本；driver 亦升 v4，**移除 `safe_rm()` 與全部 `rm -rf`**，workspace 交 runner。全檔 bash block 可執行行**刪除語句命中 0** |
| `SR-55` | NC6 用 `$SRC/node_modules` 測「temp 位於 SRC 內」，**依賴來源 repo 已存在未追蹤的 `node_modules`** ⇒ 乾淨 checkout 會先失敗在 `canonicalize TMPROOT`、得到不同訊息 ⇒ **7/7 非環境獨立** | **證據環境相依**（② R6 Required） | NC6 改用**保證存在的 `$SRC` 自身**測 equality rejection；舊 NC7 隨 v4 移除刪除邏輯而失去測試對象，一併刪除 |
| `SR-56` | §14.9.5 把 ② 對 **R5（362 行）** driver 的查證寫成 **382 行**（382 是 R6 的 v3） | **transcript drift**（② R6 Minor） | 更正為 362 並註明兩者之別 |
| `SR-57` | 我為了驗證「v4 已無刪除語句」而寫的檢查**把自己解釋『為何移除』的註解行也算進命中** ⇒ 誤報 | 母體（自審工具本身，第 3 次） | 檢查改為**宣告式排除註解／引文行**後再計數，並印出母體規模 |
| `SR-50` | **「🚫 不用 npx」之宣稱為假**：driver 呼叫 `npm run typecheck:ratchet:report`，而該 script 內部（`scripts/typecheck-ratchet.mjs:188`）自行 `execSync('npx tsc …')` ⇒ 我把宣稱的**作用域限縮成「我自己直接寫的那一行」**，未涵蓋間接執行面 | **過度宣稱**（② R5 Required；「宣稱作用域 < 實際執行面」族） | 誠實縮窄宣稱並標明該 npx 不在 driver 控制內；改以 `npx --no-install tsc --version` 斷言**恰為 `Version 5.9.3`**（本地已解析 ⇒ 不可能走下載 fallback）；§9.2 診斷器表同步更正 |
| `SR-51` | Tier B finalizer **仍非 fail-closed**：未禁 `TMPROOT`/`WORK` 位於 `SRC` 內（`TMPDIR="$SRC/node_modules"` 被 gitignore ⇒ `status` 比對假綠）· `cd / \|\| true` 吞掉「離開 `$WORK` 失敗」· 來源 probe 只在 `rm` 前跑 · cleanup 未重驗 junction/reparse · 三個 heredoc `cat` 未 guard rc。另 Tier A 直接把環境值餵 `createRequire()`（`SRC=.` → `ERR_INVALID_ARG_VALUE`，實測復現） | **Blocker**（② R5） | driver v3：禁 temp 位於 SRC 內 · trap 移到**任何 allocation 之前** · `cd` 失敗即**拒絕刪除** · probe 改 **cleanup 前後各一次** · 刪前斷言 `cd d && pwd -P == d` · 全部 `cat` guard；Tier A 新增 **A0 canonicalize** 後才 export（`SRC=.` 負控：修正前 rc=1、修正後 rc=0） |
| `SR-52` | 五組負控**只有結果表、無 mutation harness** ⇒ 無法從 packet 重播；且「殘留 0」的掃描以「含 `repo/` 或 materializer」為特徵，**恰好漏掉 canonicalize 失敗留下的空目錄** | **證據可重播性**（② R5 Required；又一次「檢查母體 < 要保護的性質」） | 發布 §6.6.C 完整 harness（7 組，逐組斷言 rc ＋ 訊息 ＋ **前後 `tmp.*` 集合差**，🚫 不再用內容特徵）；新增 NC6（temp 在 SRC 內）／NC7（`cd` 失敗拒刪）兩組 |
| `SR-53` | 上一輪自報「四項文字清理已做」**與 live PLAN 不符**：仍有舊 step 4/5 指標 · 仍宣稱 process substitution · §9.2 仍寫 `npx tsc` | **自報與實況不符**（② R5 Minor `GOV-DRIFT-001`） | 以斷言式腳本（每條命中必須恰 1，否則 non-zero exit）逐條更新現行指標；歷史 receipt 一律加 `[SUPERSEDED]`、🚫 不改寫原裁決 |
| `SR-46` | `added=$(comm … \| wc -l)` 之 **pipeline rc 被丟棄** ⇒ `comm` 失敗時 `added=0`，`ADDED=0` 斷言仍通過（**實測復現：`pipeline_rc=1` 而 `added=0`**） | **結構性假綠**（② R4 Blocker） | `comm` 先落檔（`\|\| fail`）再由檔案計數；`sed`／`sort`／`wc` 亦逐一 guard；新增負控「`comm` 失敗 → rc=1」 |
| `SR-47` | finalizer 三個 after-probe **只比字串**，未驗 git rc ⇒ 來源 repo 本就 clean（`BEFORE_STATUS=""`）時，**失敗的 `git status` 也回空字串、被判相等**（實測 `[ "$(false)" = "" ]` → true） | **結構性假綠**（② R4 Blocker） | 每個 probe 先斷言 `rc=0` 再比較；新增負控「after-status probe 失敗 → 原始 rc=0 被提升為 1」 |
| `SR-48` | `mktemp` 成功後到 trap 安裝之間有**窗口**；且 `WORK="$(…)"` 失敗會把路徑**覆寫為空** ⇒ temp 洩漏且無從清理 | **資源洩漏**（② R4 Blocker） | 先 canonicalize `SRC`／`TMPROOT` → `mktemp` → **立刻裝 trap**（保留 `WORK_RAW`）→ 才 canonicalize；finalizer 對兩者都清；新增負控「pre-clone early failure → 殘留 0」 |
| `SR-49` | 證據斷言**窄於 PLAN 宣稱之母體**：set-diff 只驗「5 條且屬 TS70xx」（錯誤檔案的合成輸入也能過）· ratchet 只驗 `errorCount` · 用裸 `npm ci`＋`npx tsc`（TypeScript 是 devDependency，可能被 omit／改走下載）· `SRC` 未 canonicalize。另 §14.7.3 把「tracked/index clean」寫成「工作樹 clean」（實際另有既存 `?? CLEANUP_PLAN.md`） | **Required**（② R4；同屬「斷言粒度 < 宣稱性質」族） | exact multiset 逐位元組 `cmp` · ratchet 三欄全驗 · `npm ci --include=dev` ＋ 斷言本地 tsc 版本 5.9.3 且禁 `npx` · `SRC` 固定為已驗證 absolute top-level · §14.7.3 表述更正 |
| `SR-43` | replay recipe **按字面不可執行**：Tier A 寫 `SRC=…` 但 Node 讀 `process.env.SRC`（實際得 `undefined/package.json`）· `PLAN` 釘在過時的 R2 commit · Tier B cwd guard 直接比較 `/c/…` 與 `C:/…`（Windows Git Bash 必然假紅）· 「完整 invocation」的 heredoc 內容仍是字面 `…（上方腳本全文）…` | **可執行性**（② R3 Required） | Tier A 改 `export SRC` ＋ `PLAN` 由 packet 填入 ＋ A1 改 fail-closed；cwd guard 改「兩側各自 `cd … && pwd -P`」＋ `--is-inside-work-tree`；driver 改為 heredoc **內嵌兩支 helper**、無外部依賴。⚠ 另實測發現 `git apply` 在 Windows 會把 LF 轉 CRLF（+179 CR）⇒ 物化改用「唯一字串替換 ＋ 自驗 sha256」 |
| `SR-44` | fail-closed family **仍未真正封住**：`set -u` 之下 `tsc`／ratchet／lint 的 rc 未捕捉 · 裸 `sha256sum -c` 不終止整段 · `node …; echo "exit=$?"` 讓 Node 失敗被 echo 吃掉（**實測整段回 0**）· B3 equality 不在 EXIT finalizer 內（早期 `exit 1` 會跳過）· cleanup 失敗不提升 exit。**且**負向控制分類錯誤：空輸入實際命中 G1+G3+G6、CRLF 命中 G2+G4+G6 ⇒ 「isolated 4 條」為假、真實 **2 條**（G5／G6） | **Blocker**（② R3；fail-closed 仍是表面功夫） | 改寫為**一支連續、無省略、已端到端實跑**的 driver：expected-zero 逐一 guard、`tsc` 斷言**確切 rc=2**（區分工具失敗）、finalizer 首行存原始 rc ＋ 先離開 `$WORK` ＋ 每次退出都跑來源三項 equality ＋ 刪前再驗 containment ＋ cleanup 失敗回非零；負向控制改斷言**完整失敗集合**並標 coupled／isolated |
| `SR-45` | 我為了驗證 driver cleanup 而掃 `/tmp/tmp.*`，但 driver 的 `TMPDIR` 未必解析到 `/tmp` ⇒ **檢查母體選錯**（雖本機恰好相同、結論未受影響） | 母體（自審工具本身） | 改以 `$(cd "${TMPDIR:-/tmp}" && pwd -P)` 取得 canonical 根後再掃，並以 driver 特徵（`repo/`／`materialize-overlay.mjs`）辨識而非只看時間 |
| `SR-41` | `SR-36` 的 errata **自己帶著另一個錯值**：它宣稱「實測獨立轉紅 4 條」，但當時 guard 5 的注入實際觸發 guard 6 ⇒ 真實 3 條。**errata 帶錯值**是本棒第 2 次（前次 `SR-1`→`SR-21` 連鎖） | **實質錯誤**（errata 未被自審覆蓋） | 於該 errata 內就地更正並指向 `SR-39` |
| `SR-42` | §6.6 步驟 6 兩處引用 **§6.6.1**，但該節已於本輪改名為 §6.6.B ⇒ 死引用 | 交叉引用漂移 | 改指 §6.6.B／§6.6.B3，並補「刪除前再驗 containment」與「三項 equality 斷言」之實質內容 |
| `SR-39` | guard 5 的負向控制注入 `const x: number = "str"`，**實際觸發的是 guard 6** —— `transpileModule` 不做 semantic 檢查（該注入 `diagnostics=0`），exit 1 來自新增 runtime `const` 改了 emit ⇒ **「4 條獨立轉紅」為假，真實 3 條**。根因＝負向控制**只斷言 exit code、未斷言失敗身分** | **實質錯誤**（負向控制測不到自己要測的東西；② R2 Required） | guard 5 改注入 `type __BROKEN = ;`（實測 `TS1110` ＋ emit 不變 ⇒ 乾淨隔離）；全部負向控制改為**同時斷言守衛身分**；重測得 `5 passed, 0 failed`（1 正向＋4 負向）；並補「transpile diagnostics 只覆蓋 syntax／options、semantic 由完整 `tsc` oracle 負責」之限定 |
| `SR-40` | §6.6 步驟 4 只給 usage 字串，**缺可直接執行的完整 Node invocation 與三個實參** | 可執行性（② R2 Required） | 補完整命令（含 heredoc 落檔到 `$WORK`、三個實參逐一註明），並註明 `ALL GUARDS PASSED (6/6)` ≠「6 條都被負控證明」 |
| `SR-37` | §6.3 的**逐字輸出 block 仍是舊（非 fail-closed）腳本的輸出**（`NON-EMPTY GUARD : true` 等格式）⇒ 修了腳本卻沒換證據，兩者脫節 | **證據與實作脫節** | 以 fail-closed 腳本重跑並換上真實輸出（含 `ALL GUARDS PASSED (6/6)` ＋ `exit=0`）＋ 逐條負向控制實測 |
| `SR-38` | 插入之 §10.3 落在 §10.2 **之前** ⇒ 子章節編號亂序（10.1→10.3→10.2）。與 `SR-27` 同一形態、**第 2 次** | 文件結構 | 交換兩節位置，恢復遞增 |
| `SR-36` | §6.3 宣稱「同時斷言 `bytes>0`／`srcCR=0`／`emitCR=0`／`diags=0`」，但腳本**只對空 input/output `throw`**，其餘守衛與 `BYTE-IDENTICAL:false` 僅 `console.log`、仍 exit 0 ⇒ **我自己的守衛在假綠** | **實質錯誤**（結構性假綠；② `GOV-FAIL-001`） | 腳本改 6 條守衛累積失敗 → non-zero exit；§6.3 加 errata；補逐條負向控制（**實測獨立轉紅 4 條**，守衛 3／4 無法獨立注入、如實標示） |
| `SR-33` | 依 ① R2 `ARCH-BR-R2-RR1` 做**裁決轉錄語氣**族掃描，母體＝全檔歸屬外部方之敘述，共 **4 個成員**：§14.2.3 標題（`accepted → immutable`）· `B-OD-2`（`不建議 → 明確否決` ＋ 自行外加「🚫 不得開 backlog」）· `B-OD-1`（`不應 → 🚫 不得` ＋ 自行外加「後續棒次須照此限定」）· **§14.1 標題**（自行核發「🚫 不得當成 blocker 重開」，無授權來源） | **權限升格**（① 只點名前兩個） | 四處全數改回原裁決強度；§14.2.3 補「acceptance ＝ anchor-scoped、後續 gate 保留升級權」＋ 反向節流條款 |
| `SR-58` | **`GOV-DRIFT-001` 之四項真 drift**（② R7 Minor 指出、coding 階段逐項復現）：(a) §6.6.B 用法行仍寫 `replay-tier-b-v3.sh`（driver 實為 v4）(b) §6.6.B 之 v2 實跑輸出區塊被留成像是現行結果，其 `workdir 已清理` 在 v4 語意下**已為假**（v4 不刪任何東西）(c) §14.10.5 稱根因帳 `11 → 14` 但**只改數字未改枚舉**（實列 11）(d) §14.10.3「可執行行 368 行」把 **44 個空白行**計為可執行行（實測總 420 ＝ 空白 44 ＋ 註解 52 ＋ 實碼 324） | **transcript drift ＋「修了一處就以為修完」**（(c) 本身即「母體 < 性質」之復發；本棒第 15 條） | 四項全數處置：(a) 改 v4 並標原誤 (b) 加 v2-historical 警語並逐條點出 v4 下不成立之兩句 (c) 補三個 ID ＋ 納入本條，並改為**下界**表述＋四項限定（因族歸屬係 prose 判定、非機械可導出：關鍵字掃描只命中 10 列且不含其中 8 個） (d) 改為「非空白非註解 324 行」並標明「刪除語句命中 0」之結論不受影響 |
| `SR-59` | `UB-B-1` 與 §4.4 第 2 點把「賦值未經檢查」的成因寫成**單一條件**「repo 未安裝 `@cloudflare/workers-types`」。coding 階段追查實際機制：`D1Database` 在本 repo **無任何宣告來源**（`types/` 內 0 命中、`node_modules/@cloudflare/` 只有 `kv-asset-handler`／`vitest-pool-workers`／`workerd-windows-64`），`types/env.d.ts:23` 之所以不噴 `TS2304` 是**靠 `tsconfig.functions.json` 的 `skipLibCheck: true`**（既有 repo 註解 `functions/utils/auth.ts:127` 已載明「裸 `D1Database` 在 source `.ts` 不可解析（僅 `env.d.ts` 靠 `skipLibCheck` 過）」）⇒ 成因是**兩個條件的合成**，而 `UB-B-1` 的 recheck trigger 只列了其中一個 | **因果鏈不完整**（⚠ 結論方向正確 —— `any`／未經檢查成立；缺的是第二個成因與其對應 trigger） | 🚫 不改 production code、🚫 不改 overlay anchor（`79792231…` 已 gate-approved）。改以**標記式 addendum** 補在 `UB-B-1` 之後（見該表下方），新增 recheck trigger ⑥「`skipLibCheck` 由 true 改 false」。🚫 不改寫已核准之表格內文，保留審查軌跡 |

| `SR-60` | **`SR-58` 的處置段落自己就犯了 `SR-58` 在修的錯（同一輪內）**：我在 §14.11.2 寫「『🚫 不用 npx』該字串共 **4 處**（§6.6.B ／ §9.2 ／ `SR-50` ／ **§14.9.4**）」，**未掃母體、憑印象列舉**。coding 階段實測（母體＝全檔零收窄）：既存 **5 處**，且 §14.9.4 **不存在該字串** —— 真實位置是 **§14.9.1** 與 **§14.9.3**，我**漏列一處、錯標一處**。另同輪把根因帳分母寫成 `58 條`，但我自己同時加了 `SR-58`＋`SR-59` ⇒ 分母當下已是 **59**（再加本條為 60）：**改了分子與枚舉、分母卻又立刻 stale** | **「母體 < 性質」之復發（本棒第 17 條）＋ 自指性最強的一次** —— 該族在「**正在修該族的段落**」內復發，且距我寫下「該族在新撰寫的段落最易復發」不到十分鐘。⚠ substantive 結論**未受影響**（5/5 仍全在更正／限定語句內 ⇒「刻意不改」之裁決成立），錯的只有**計數與章節標** §14.11.2 之母體改為**錨定 `d22e8b5e` 版本**（🚫 非「當前 HEAD」）並附 `git show … \| grep -c` 重播指令 ⇒ 值恆為 `5`、不隨後續編輯漂移；五處逐一標章節與語境。⚠ **此錨定是必要的，不只是嚴謹**：任何*談論*該字串的句子本身都含該字串（本列即是），對 HEAD 計數必然自我遞增 —— 這是本族的一個**自指變體**，`SR-58` 的原始寫法沒察覺到它。根因帳分母改 **60**、枚舉補 `SR-59`／`SR-60` 共 **17**（實測列數 60、ID 連續 1…60、枚舉 17 三者互證）。並以本條明文化：**分子／分母／枚舉三者必須同時重算**，🚫 不得只改被點名的那個數字 |

**根因分布（供後續棒次參考）**：60 條中 **至少 17 條**
（`SR-1` `SR-2` `SR-7` `SR-11` `SR-12` `SR-13` `SR-17` `SR-18` `SR-25` `SR-26` **`SR-35`**
`SR-49` `SR-50` `SR-52` **`SR-58`** `SR-59` **`SR-60`**）
同屬批 E 已記載之「**母體 < 性質**」族 —— 以腦中計數／他棒引用／未掃描的印象／**被 `head` 截斷的輸出**，
代替對真實母體的量測。
⇒ 印證 [[feedback_guard_population_must_cover_property]]「**修過不代表免疫**」：
該族在**新撰寫的段落**最易復發，即使作者剛讀過該教訓。

> 🚨 **`GOV-DRIFT-001` 之處置（② R7 Minor；coding 階段 `SR-58`）—— 本段自己就是該族的復發**：
> §14.10.5 之 R6 處置宣稱「根因帳由 11 → **14**，納入 `SR-49`／`SR-50`／`SR-52`」，
> 但**只改了數字、未改枚舉**（② R7 實測：稱 14、實列 11）。
> ⇒ 「改了被點名的那個計數、沒改承載該計數的母體」＝與 `SR-28`／`SR-29` 同一「修了一處就以為修完」紀律。
> 現已補齊三個 ID，並納入本輪 `SR-58`。
>
> ⚠ **四項限定（依 [[feedback_scope_qualified_universal_claims]]）**：
> · **適用範圍** ＝ 本檔 §14.0 之 SR ledger（58 列），🚫 不含他棒。
> · **生效時態** ＝ coding 階段（② R7 approved 之後）之快照。
> · **例外集合／為何是「至少」** ＝ 本族歸屬是 **prose 判定，🚫 非機械可導出的集合**。
>   coding 階段實測：以性質欄關鍵字（`母體`／`宣稱作用域`／`過度宣稱`／`全稱`）掃描 58 列
>   只命中 **10 列**，且**不含**上列 15 個中的 8 個（`SR-1` `SR-2` `SR-7` `SR-11` `SR-12` `SR-13`
>   `SR-17` `SR-18` 之性質欄無此類關鍵字）⇒ 關鍵字掃描與本判定**不是同一個母體**，🚫 不可互相導出。
>   另 `SR-45`／`SR-57` 之性質欄自標「母體（自審工具本身）」且自帶獨立計數（至「第 3 次」），
>   **未併入上列 15**；`SR-6`／`SR-16`／`SR-20` 標「過度宣稱」，是否同族**未逐條裁定**。
> · **closure** ＝ 🚫 **無**。本數字是**下界**，🚫 不得讀成「已窮舉」或「族已封閉」。

⚠ **`SR-28` ／ `SR-29` 值得單獨記錄（族：「修了一處就以為修完」）**：① R1 的兩個 Required 各是一個
**語意層的過度宣稱**，而該語意的字面在文件中都不只出現一次 ——
`R1` 出現**兩處**（開頭段落 ＋ ledger 標題）、`R2` 出現**三處**（§1 ／ §8 ／ §12，① 只點名 §12）。
我第一次處置時各只修了「被點名的那一處」與「自己記得的那一處」；
若非自審再做一次**族掃描**，送回 ① 的會是「宣稱已封上、實際仍矛盾」。
⇒ **處置語意類 finding 時，第一步應是把該語意的所有字面出現點枚舉出來**，
與 [[feedback_guard_population_must_cover_property]] 同一紀律（母體先於處置），
亦即使用者基線所稱「**處置單位是族、不是案例**」。

⚠ **`SR-32` ／ `SR-33` ＝ 同一紀律的第三、四次實測（族處置在本棒共失敗 4 次）**：

| 輪次 | finding | 被點名的成員 | 族的真實規模 | 我漏掉幾個 |
|---|---|---|---|---|
| 自審 | `SR-13`（單元數帳） | — | **3**（§2.1.1 · §3 · §13） | 1（§13，`SR-32` 才補） |
| ① R1 → R2 | `ARCH-BR-R1`（SoT 矛盾） | 開頭段落 | **2**（＋ ledger 標題） | 1（`SR-28` 才補） |
| ① R1 → R2 | `ARCH-BR-R2`（emit 跨推） | §12 | **3**（＋ §1 · §8） | 2（`SR-29` 才補） |
| ① R2 → R3 | `ARCH-BR-R2-RR1`（語氣升格） | §14.2.3 標題 · `B-OD-2` | **4**（＋ `B-OD-1` · §14.1 標題） | 2（`SR-33` 才補） |

**四次的共同形態**：外部 gate 只點名它**看得到的**成員（它無 repo 全文），
我若照字面處置就必然漏；**族的枚舉責任在我方，不在 gate**。
⇒ 收到任何語意類 finding，**先寫下「這個語意的母體是什麼」再動手**，🚫 不得從被點名的那一處開始修。

⚠ **`SR-21` 屬另一族且值得單獨記錄**：它不是量測失準，而是**新引入的識別字撞上既有識別字、且語意不同**。
自審之所以抓到，是因為對「新增的每一個公開/半公開名稱」主動跑一次 repo-wide 命名母體掃描 ——
🚫 不是靠「我覺得這個名字很自然」。建議後續棒次把此步驟列為**新增型別/常數時的固定動作**。

> 以下欄位**只由實際 gate 回覆填入**（已回覆者填 verdict ＋ 錨點 SHA；未回覆者維持 `_待填_`）；
> 🚫 不得預先自我宣告、🚫 不得以「預期會過」代填。
> ⚠ **本清單只列外部 gate**（`ARCH-BR-R1` 之處置）。維度 A self-review 的 closure
> **不在本檔的 SoT 範圍內**（見開頭狀態讀法之兩列表格）；§14.0 僅為其 append-only 歷史，🚫 非 closure。
>
> - ① ChatGPT Architecture Gate：**`CHATGPT_ARCH_APPROVED` ＠ PLAN `24a073f5`**（R3；R1→R2→R3 共 3 輪，2 次 CHANGES_REQUESTED）— 詳見 §14.2 / §14.3 / §14.4
> - ② Codex Plan Gate：verdict ＋ 錨點 SHA — _待填_
> - ③ Codex Code Gate：verdict ＋ 錨點 SHA — _待填_
> - ④ ChatGPT faithfulness：verdict ＋ 錨點 SHA — _待填_

### 14.1 承接自批 E 之未結項（**非本棒新發現；本棒不處置**）

> ⚠ **效力範圍（`ARCH-BR-R2-RR1` 族之處置，`SR-33`）**：本節初稿標題曾寫
> 「🚫 不得當成 blocker 重開」—— 那是**我自行核發的、對未來 gate 的永久禁令，無任何授權來源**。
> 已改回忠實語意：這些是**繼承自批 E 的既有未結項，不在本棒 scope 內**；
> 🚫 本節**不剝奪**任何後續 gate 就其升級 blocker 的權力。
> 若某後續 gate 認為其中一項對本棒構成 blocker，正確處理是**回報 owner 裁定 scope**，
> 而非由本檔預先封殺。

| ID | 內容 | 處置 |
|---|---|---|
| `FAITHFULNESS-NB-001` | 批 E PLAN §3 之「9 呼叫點／8 檔」derived-copy drift（正確值 9 處／7 檔） | owner 已裁定不修；④ 判 non-blocking |
| `TD-BATCHE-1` | audit 寫入端 `admin_email` 契約硬化 | 接手棒次須**自行重新量測母體**（批 E §14.30 為 factual errata、不具規範地位）；🚫 本棒不處置 |
| ① R20 Q2(b) 11 個同族 claim | closure mechanism 已由 ① R21 終止且未指定替代 | 維持 unresolved |
| `governance/rules.json` 不存在 | TypeScript governance rule 仍為 advisory／not enforced | 現況記錄 |

---

### 14.2 ① ChatGPT Architecture Gate — R1 verdict 與處置 receipt

**verdict**：`CHATGPT_ARCH_CHANGES_REQUESTED` — **0 Blocker ／ 2 Required ／ 2 Non-blocking**
**受審錨點**：PLAN commit `9d1f29d5`；base `acc98dfb`；production source 為 base blob `ec2a9b07…`（未動）
**① 明示之 R2 範圍限制**：ultra-narrow，只封兩個 Required；
🚫 **不得因本裁決去改 `functions/api/admin/audit.ts`**（須維持 base blob）；
R2 複核三點＝(1) SoT 模型不再矛盾 (2) §12 不再跨推 bundle (3) `B-OD-1`／`B-OD-2`／`UserAuditRow`／scope／code diff 均未順手擴張。

#### 14.2.1 兩個 Required 之處置

| ID | ① 之 finding | 處置 | 落點 |
|---|---|---|---|
| `ARCH-BR-R1-STATE-SOT-CLOSURE-GAP` | 開頭宣告「gate 狀態的唯一 SoT ＝ §14」，同時宣告本檔不持有 self-review closure；但 §14 無 terminal closure receipt ⇒ `PLAN_SELF_REVIEW_CLEAN` 無法由被宣稱為唯一 SoT 的 ledger 推導。「唯一 SoT 在這裡」與「這個必要狀態不在這裡」不可並存 | 採 ① 提供之**第二種最小修法**：**收窄 SoT 宣稱**。開頭改為兩列表格 —— 外部 gate verdict 的 SoT ＝ §14；維度 A closure ＝ **owner／workflow state、不在本檔**。並刪除 §14 待填清單中的 self-review 列（該列曾隱含 ledger 會持有 self-review 狀態）。🚫 **未**改為由本檔自我核發 closure | 開頭狀態讀法 · §14 待填清單 |
| `ARCH-BR-R2-EMIT-EVIDENCE-SCOPE-ESCAPE` | §12 寫「emit byte-identical ⇒ revert 前後的 production bundle 行為亦無差異」，把單檔證據提升到其未覆蓋的 production-bundle 性質，與本 PLAN 自己在 §6.3／§11.1 的證據邊界矛盾 | **刪除該句**；改寫為「rollback 之成立不需要、也不援引 bundle-equivalence；bundle 面仍由 coding-stage `build:functions` 驗證，🚫 不由 §6.3 推導」。⚠ **族處置**：自審 `SR-29` 另抓到同族存活成員 §1（「零 runtime delta」）與 §8（「不存在任何新的 runtime 行為」），一併加限定 ⇒ **三處同時封上**（§1／§8／§12） | §1 · §8 · §12 |

⚠ **根因（誠實記錄）**：`ARCH-BR-R2` 是典型 **cognition–artifact drift** —— 我在 §6.3、§7.2、§11.1
**三處**都正確寫了範圍限定，卻在 §12 又把同一證據跨推出去。
⇒ 「已在別處限定過」**不構成**該限定會自動套用到新寫段落的理由；
與 §14.0 之「母體 < 性質」族同源（皆為**新撰寫段落最易復發**），列為本棒第 11 次同類復發。

#### 14.2.2 兩個 Non-blocking 之 carry-forward（🚫 本輪不做，理由逐條）

| ID | ① 之建議 | 本輪處置 | 理由 |
|---|---|---|---|
| `ARCH-BR-NB1-PROJECTION-NAME` | `UserAuditProjectionRow` 語意更強，但現有 JSDoc 已充分限定；**不值得為此阻擋或增加本輪 diff** | **不做**，carry-forward | ① 明示不值得增加本輪 diff；改名會動到 §4.1 逐字 block ⇒ 改變 code diff 與 anchor `79792231…`，違反 R2 之 ultra-narrow 與「code diff 未擴張」複核點 |
| `ARCH-BR-NB2-GUARANTEE-WORDING` | 「唯一保證」宜改為「維護義務／人工契約」；**後續若正在碰同段**再改；本項單獨不阻擋 | **不做**，carry-forward | 該措辭同時存在於 §4.4 **與 §4.1 之 JSDoc 逐字內容**（後者即 production source 文字）。只改 PLAN 散文會使兩者**去同步**，比不改更糟；要改就得動 source ⇒ 違反 ① 之「不得改 `audit.ts`」。⚠ 若後續 gate 認為值得，應**整組**（JSDoc ＋ §4.4）一起改並重測 anchor |

#### 14.2.3 ① 對四個架構問題之 R1 裁決（**於 R1 受審錨點與證據下 accepted**）

> ⚠ **本節之效力範圍（`ARCH-BR-R2-RR1` 之處置）**：
> Architecture acceptance 只表示「**在 R1 當時的受審 anchor（PLAN `9d1f29d5` / base `acc98dfb`）、
> scope 與證據之下**，該項無 blocker」。🚫 **不是**永久 immutable 裁決。
> 若 anchor 漂移、scope 改變、證據失效、出現新事實，或發現原裁決依據有誤，
> **後續 gate 保留重新升級為 blocker 的權力** —— 這是 fail-safe gate 的必要屬性，🚫 不得被本檔削弱。
>
> 反向的節流（防無限重開）：**除 anchor／scope／evidence 改變、出現新事實、或發現裁決依據錯誤外，
> 後續不得無理由重審已裁項。**
>
> ⚠ 本節初稿曾把標題寫成「已 accept，🚫 後續不得重開為 blocker」，
> 係**轉錄時的權限升格**（`accepted → immutable`），① R1 從未核發該永久鎖。見 `SR-33`。

1. **字母 → scope 首次落成 artifact ＝ 接受** —— 正確區分 authority（owner `SPEC-B1`）與 evidence（結構量測），
   未把「殘域恰一組 GET/DELETE 配對」倒推成字母權威。
2. **`B-OD-1` ＝ 接受 v2** —— 但 ① 明示理由是**結構性的**（單一邊界建型別／callback 自然 contextual typing／
   `filteredRows` 不再是 `any`／標註數更少）；① 之原話為「byte-identical 是很好的額外證據／tie-breaker，
   **不應**升格成凌駕型別正確性的硬原則」。
   ⚠ 故引用本案時**宜**寫成「tie-breaker」而非「emit 差一 byte 即不可接受」。
   （⚠ 本節初稿把 ① 的「不應」轉錄成「🚫 不得」並自行外加「後續棒次…須照此限定」，
   屬同族的語氣升格，已改回 ① 原有強度；見 `SR-33`。）
3. **`B-OD-2` ＝ 接受避名，不要求本棒重構** —— ① R1 **不建議**以「統一兩者」作為 backlog 方向
   （理由：兩者本就不是同一概念）；**若未來要改善，① 建議以更明確的 disambiguation 為方向**
   （例：`AdminAuditLogRow` ／ `UserAuditProjectionRow`）。
   ⚠ 本棒據此**不開**「統一命名」backlog —— 這是**本棒的處置決定**，
   🚫 **不是** ① 核發的「禁止建立該類 backlog」之治理命令；owner／後續 gate 之權限不受本節限制。
4. **`UserAuditRow` ＝ 現方案可接受，不退回 `Record<string, unknown>`** —— 固定 SELECT projection 的
   局部契約值得明確建模；關鍵是已正確承認 D1 `any` 使賦值無 compiler/runtime validation。

#### 14.2.4 `MEMORY.md` 之地位（① 條件式提問之解答，**本棒實測**）

① 指出：若 `MEMORY.md` 是 repo tracked file，則「`FINAL_PR_CHANGED_FILES` 恰 2 檔」會被破壞。

**實測**（`git ls-files --error-unmatch MEMORY.md` ⇒ 不存在；repo 工作樹亦無此檔）：
`MEMORY.md` 位於 **repo 外之 agent-local 路徑** `~/.claude/projects/C--Users-User-Desktop-chiyigo-com/memory/`，
**非 repo tracked** ⇒ **不影響** `FINAL_PR_CHANGED_FILES`（§5.5 之「恰 2 檔」不變）。

依 ① 之建議採用：**保留 in-flight marker**，但視為**非權威 cache**；
**清理義務**＝branch abandon／rebase 失效／merge 後**皆須同步更新或清除**該 marker。

---

### 14.3 ① ChatGPT Architecture Gate — R2 verdict 與處置 receipt

**verdict**：`CHATGPT_ARCH_CHANGES_REQUESTED` — **0 Blocker ／ 1 Required ／ 2 Non-blocking carry-forward**
**受審錨點**：PLAN commit `d31cb3e2`；base `acc98dfb`
**① R2 對三個指定複核點之結果**：

| 複核點 | 結果 |
|---|---|
| 1. SoT ／ self-review closure 不再矛盾 | **PASS** |
| 2. 單檔 emit 不再跨推 bundle | **PASS** |
| 3. OD ／ `UserAuditRow` ／ scope ／ code diff 未擴張 | **code/design PASS；governance transcription FAIL**（唯一 Required） |

**R1 兩項 Required 之終局**：

| ID | R2 判定 |
|---|---|
| `ARCH-BR-R1-STATE-SOT-CLOSURE-GAP` | **CLOSED** |
| `ARCH-BR-R2-EMIT-EVIDENCE-SCOPE-ESCAPE` | **CLOSED** |

#### 14.3.1 `ARCH-BR-R2-RR1-VERDICT-AMPLIFICATION`（新 Required）之處置

**① 之 finding**：R2 在**記錄 R1 裁決時**把 anchor-scoped acceptance 擴張成永久 governance prohibition，
超過 R1 實際裁決。①：「`accepted → immutable`、`不建議 → 禁止` 都是轉錄時發生的**權限升格**」，
並指出這與本棒自審的 `SR-28`／`SR-29` 屬同一紀律，**只是母體換成了「裁決轉錄的語氣強度」**。

**族枚舉（`SR-33`；母體 ＝ 全檔中歸屬外部方之敘述行，零收窄）** —— 共 **4 個成員**，① 只點名前 2 個：

| # | 位置 | 原文（升格後） | ① 之實際裁決 | 處置 |
|---|---|---|---|---|
| 1 | §14.2.3 標題 | 「已 accept，**🚫 後續不得重開為 blocker**」 | acceptance 只在受審 anchor／scope／證據下成立 | 標題改為「**於 R1 受審錨點與證據下 accepted**」；刪除永久鎖；補明「後續 gate 保留升級 blocker 之權力」＋ 反向節流條款 |
| 2 | §14.2.3 `B-OD-2` | 「① **明確否決**『統一兩者』方向」＋「**🚫 不得開**『統一命名』backlog」 | ①「**不建議**」以統一兩者作 backlog 方向；建議方向為 disambiguation | 改回「不建議／建議」；明標「本棒不開該 backlog ＝ **本棒的處置決定**，非 ① 之治理命令；owner／後續 gate 權限不受限」 |
| 3 | §14.2.3 `B-OD-1` | 「**🚫 不得**升格為硬原則」＋ 自行外加「後續棒次引用本案時**須**照此限定」 | ① 原話為「**不應**升格成凌駕型別正確性的硬原則」 | 引 ① 原話與原強度；自行外加之條款降為「**宜**」 |
| 4 | **§14.1 標題** | 「非本棒新發現，**🚫 不得當成 blocker 重開**」 | **無任何授權來源** —— 此為我自行核發之永久禁令 | 改為「非本棒新發現；本棒不處置」；明標不剝奪後續 gate 之升級權；若後續 gate 認其構成 blocker，正確處理是回報 owner 裁定 scope |

⚠ 第 3、4 項**未被 ① 點名**，是依 ① 指出的族定義自行掃出的。
第 4 項尤其值得記錄：它**不是轉錄升格，而是我憑空自簽的治理命令** —— 沒有任何外部裁決作為來源。

#### 14.3.2 本輪 code diff 面不變式（① 複核點 3）

| 不變式 | 值 | 三輪是否變動 |
|---|---|---|
| production source blob | `ec2a9b0795d500d72159988071807be86e8d049f` | **未動一行** |
| overlay anchor sha256 | `7979223135b8e6ed80b807f1f1262f2c4bebbe57e40e568eadc69705af39d450` | 未變 |
| code diff stat | `+29 / -3` | 未變 |
| hunk 標頭 ×3 | `@@ -42,7 +42,33 @@` · `@@ -58,7 +84,7 @@` · `@@ -127,7 +153,7 @@` | 未變 |
| `SPEC-B1/2/3` · `B-OD-1` · `B-OD-2` · `interface UserAuditRow` | — | **零修改行** |

#### 14.3.3 兩項 Non-blocking：維持 carry-forward

① R2 重申 `ARCH-BR-NB1-PROJECTION-NAME` 與 `ARCH-BR-NB2-GUARANTEE-WORDING` 為
**Non-blocking carry-forward，本輪不需要做**，且明確認可
「**不為 NB2 去碰 source 的判斷正確**」。處置理由見 §14.2.2，本輪不變。

---

### 14.4 ① ChatGPT Architecture Gate — R3 verdict（**APPROVED**）

**verdict**：**`CHATGPT_ARCH_APPROVED`** — **0 Blocker ／ 0 Required ／ 2 Non-blocking carry-forward**
**受審錨點**：PLAN commit `24a073f5`；base `acc98dfb`

| finding | R3 裁決 |
|---|---|
| `ARCH-BR-R1-STATE-SOT-CLOSURE-GAP` | **CLOSED**（沿 R2） |
| `ARCH-BR-R2-EMIT-EVIDENCE-SCOPE-ESCAPE` | **CLOSED**（沿 R2） |
| `ARCH-BR-R2-RR1-VERDICT-AMPLIFICATION` | **CLOSED** |
| `ARCH-BR-NB1-PROJECTION-NAME` | Non-blocking carry-forward |
| `ARCH-BR-NB2-GUARANTEE-WORDING` | Non-blocking carry-forward |

#### 14.4.1 ① 對 `SR-32`（§13 之 `15 → 10`）之裁決

該行嚴格說超出 R3 指定之族，我方已於 packet §3 主動揭露。**① 裁定：接受，不要 revert。**
① 之理由（逐字要點）：它是「**允許的 factual errata closure，不構成 scope expansion**」——
§2.1.1 與 `SPEC-B3` 已建立「6 已落成 ＋ 10 未裁定 ＝ 16」之帳，§13 的「15」只是同一 derived-copy
的殘留錯值；改回一致**未修改 `SPEC-B3` 的 authority／scope／任何 code design**。
① 並指出「把它 revert 回已知錯值，反而會刻意恢復 cognition–artifact drift」。
⇒ `SR-32` 保留，🚫 不需為該行另起 gate。

#### 14.4.2 ① 對兩項 Non-blocking 之指示

① R3 明示（本棒範圍內）：**不要**為 `NB1` 改型別名；**不要**為 `NB2` **現在**去動 `audit.ts`。
`NB2` 之理由：現在處置會要求同步改 production JSDoc、**重建 overlay anchor**，
「收益不足以抵銷重新打開已穩定 code diff 的成本」。
⚠ 依 §14.2.3 之效力範圍條款，上述為**本棒情境下的指示**，🚫 不轉錄為永久禁令。

#### 14.4.3 ① 對 R3 不變式之認定

① 就受審 artifact 所提供之 receipt 認定：production source 仍為 base blob `ec2a9b07…`，
預定 overlay anchor `79792231…`、`+29 / -3`、三個 hunk 與 §4.1 之 26 行 block
**均未因 Architecture 修訂而改變** —— 即「這三輪修的都是 PLAN governance，
不是偷偷重新設計 production diff」。

#### 14.4.4 ⚠ 明確排除於本 gate 之外者（① 主動劃界）

同期進行之 **memory `check-memory.mjs` ／ harness hook「KB」單位更正**（詳見該 memory repo）
**不在本次受審 artifact 內**。① 表示：依所提供之驗算，撤回「bytes gate 與 char gate 衝突」
這個前提是正確的修正方向；但 **① 不把它標成本 gate 的「已驗證」事實**。
🚫 本 PLAN 不得引用 ① 之 approval 作為該 memory 改動的背書。

#### 14.4.5 gate 推進之界線（① 明示）

「① Architecture Gate 到此通過。下一關可送 ② Codex Plan Gate；
**這仍不等於 `CODING_ALLOWED`，也不授權現在修改 `functions/api/admin/audit.ts`**。」

---

### 14.5 ② Codex Plan Gate — R1 verdict 與處置 receipt

**verdict**：`CODEX_PLAN_CHANGES_REQUESTED` — **1 Blocker ／ 1 Required**
**受審錨點**：PLAN commit `ee240a1e`；base `acc98dfb`
**② 已重播確認無誤者**：commit 鏈／changed-files／packet hashes／PLAN blob `8850a2ca…`；
overlay `7495 B` ＋ sha256 `79792231…`；診斷 `352 → 347`、`REMOVED=5`、`ADDED=0`；
emit `6599 B` / `10c1d1f8…` byte-identical；負向控制／contextual typing／DDL 八欄對照／
suppression 預算／單一直接 test caller。

#### 14.5.1 Blocker `TS-BOUNDARY-002` 之處置

**② 之 finding**：§4.4 承認 `rowsResult` 實為 `any`，再未經檢查賦值成 `UserAuditRow[]`
（checker 重播：`initializer = any` / `rawRows = UserAuditRow[]`）＝ D1 legacy interop 邊界之
**type laundering**；JSDoc 誠實揭露與零文字 suppression **不能取代 unsafe-boundary registry**。
② 給兩條最小修正：(1) 增加具 `reason / scope / evidence / recheck` 的 record；(2) 改用真正
typed／validated D1 boundary。並認為兩案「都會改變 `FINAL_PR_CHANGED_FILES` 或 production design」，
故 owner 須裁定是否重送 ①。

**我方處置＝路徑 (1)，並主張其不觸發上述 owner 裁定條件。理由（皆可查證）**：

| 主張 | 查證 |
|---|---|
| repo **無** unsafe-boundary registry／governance manifest，故不存在「現場該有卻沒填」的檔 | 本棒實測：`git ls-files \| grep -iE '(^\|/)AGENTS?\.md$'` ⇒ **0 命中**；`governance/rules.json` 不存在。⚠ ② 自己亦於同份 verdict 結語確認「repo 沒有 TypeScript governance manifest；`TS-BOUNDARY-001/002` 等**均不得宣稱為 repo machine-enforced**」 |
| **登錄置於 PLAN 內**是本 repo **已經 gate 核可的先例** | 批 E `docs/plans/stage7-pr2dw-batche-audit-log-typing.md` §4.4 之 `🔒 UNSAFE-BOUNDARY-REGISTRY`／`UB-E-1`：該棒 ② R3 原文「明確登錄此 unsafe boundary，而非用 overload 隱藏」，並因 SCOPE-LOCK 禁新增 repo 治理檔而置於 PLAN 內 |
| ⇒ 故 **不改 `FINAL_PR_CHANGED_FILES`**（plan doc 本就是唯一的 `A`）、**不改 production design**（code diff 與 anchor 均未動） | §14.5.3 不變式表 |

⇒ 已於 §4.4 新增 `🔒 UNSAFE-BOUNDARY-REGISTRY` 之 `UB-B-1`，欄位涵蓋 ② 要求之
`reason`（未驗證假設 ＋ 安全論證）／`scope`（位置，明列不涵蓋範圍）／`evidence`（emit byte-identical）／
`recheck`（5 條 trigger），並額外記錄「仍存在的既有 failure mode」與「為何不改用 runtime validation」。

⚠ **本節是我方對 ② 前提的具名反駁，🚫 不是自我核准。** 若 ② 仍認為需 owner 裁定或需重送 ①，
請於 R2 明示；owner 亦可直接推翻本判斷。

#### 14.5.2 Required `GOV-EVIDENCE-001` ／ `GOV-FAIL-001` 之處置（**② 完全正確，我方無異議**）

| ② 之 finding | 我方確認 | 處置 |
|---|---|---|
| replay recipe 在**共用工作樹** checkout base、跑 `npm ci`、改 source，結尾只還原單檔，未復原 branch/ref、dependency state、scratch | **成立。** 逐字查證 `.claude/agents/readonly-reviewer.md` 存在且載明「never check out into the shared working tree／installs packages」；`CLAUDE.md` §6 亦禁 checkout／切 branch。**舊 recipe 等於指示審查者違反 repo 自己的 reviewer 契約** | §6.6 全面重做：新增 `🔒 ISOLATION-CONTRACT`（§6.6.0）＋ **disposable `git clone --local` ＋ `trap rm -rf`**（§6.6.1）；🚫 不用 `git worktree`（junction 風險）；clone 自帶 `npm ci`；末附「來源 repo 未被觸碰」之驗證兩行。⚠ **[SUPERSEDED by ② R2 → §14.6.2]**：此版仍是 happy-path isolation、且把 disposable clone 誤當 reviewer-safe。`ISOLATION-CONTRACT`／§6.6.1 已由 **`REPLAY-AUTHORIZATION-TIERS`（§6.6.0）＋ §6.6.A／§6.6.B** 取代；本列保留為 R1 當時之處置紀錄，🚫 其指向之節號已不存在 |
| 內嵌 emit script 只對空 input/output `throw`，`srcCR`／emit CR／diagnostics／`BYTE-IDENTICAL:false` 僅印出、仍 exit 0，與 PLAN 宣稱之「斷言守衛」不符 | **成立，且這是我自己的守衛在假綠。** §6.3 舊句「同時斷言 bytes>0／srcCR=0／emitCR=0／diags=0」**當時為假** | 腳本改為 6 條守衛累積失敗 → non-zero exit；§6.3 加 errata；§6.6 步驟 5 補**逐條**負向控制。⚠ 實測**獨立轉紅 4 條**；守衛 3／4 在本檔輸入下無法獨立注入，如實標示為「未獨立驗證」、🚫 不宣稱 6/6 皆已個別證明 |

#### 14.5.3 本輪不變式（code diff 面完全未動）

| 不變式 | 值 | 本輪是否變動 |
|---|---|---|
| production source blob | `ec2a9b0795d500d72159988071807be86e8d049f` | **未動一行** |
| overlay anchor sha256 | `7979223135b8e6ed80b807f1f1262f2c4bebbe57e40e568eadc69705af39d450` | 未變 |
| code diff stat ／ 三個 hunk 標頭 ／ §4.1 之 26 行 block | `+29 / -3` 等 | 未變 |
| `FINAL_PR_CHANGED_FILES` | `A` plan doc ＋ `M` audit.ts（恰 2 檔） | 未變 |

#### 14.5.4 ② 之其他認定（記錄，🚫 不轉錄升格）

- **State Consistency**：production diff 無資料寫入／migration／state transition，squash revert 模型成立；Blocker 屬型別邊界治理、非 runtime state mutation。
- **Queue / Payment / Distributed State**：Not Applicable。
- **Observability**：runtime observability 未改；七道 CI gate 未跑、committed-diff `BAN_PATTERNS` 仍 vacuous —— ② 認為「正確保留為 coding-stage 必驗項」。
- ② 明示：`TS-TYPE-001`／`TS-BOUNDARY-001/002`／`GOV-DECISION-001`／`GOV-DRIFT-001`／`GOV-EVIDENCE-001`／`GOV-FAIL-001` **均不得宣稱為 repo machine-enforced**（repo 無 TypeScript governance manifest）。
- ② 確認其審查全程未寫檔、未 commit、未 push；工作樹僅有既有的 `?? CLEANUP_PLAN.md`。

---

### 14.6 ② Codex Plan Gate — R2 verdict 與處置 receipt

**verdict**：`CODEX_PLAN_CHANGES_REQUESTED` — **1 Blocker ／ 1 Required**
**受審錨點**：PLAN commit `548e2b89`；base `acc98dfb`

#### 14.6.1 已 CLOSED ＋ ② 撤回之過廣前提

- **`TS-BOUNDARY-002` ＝ CLOSED**。② 認定 `UB-B-1` 涵蓋 boundary id／精確 scope／reason／risk／
  evidence／recheck triggers，且**符合批 E 的 PLAN-local registry 先例**。
- **② 明示撤回其 R1 前提**：「你對 R1 前提的反駁成立；我先前說『兩條修正路徑都必然改
  changed-files 或 production design』**過廣，予以撤回**。本案**不需因此重送 ①**。」
  ⚠ 記錄用途：後續棒次引用「unsafe boundary 登錄置於 PLAN 內」時，此為第二個 gate 認可先例。
- ② 亦撤回其 R1 建議之另一半：把「isolated clone ＋ own npm ci」直接列為 reviewer-safe **同樣過廣**。

#### 14.6.2 Blocker（`GOV-FAIL-001`／`GOV-EVIDENCE-001`）之處置

| ② 之 finding | 我方確認 | 處置 |
|---|---|---|
| 新 recipe 仍是 **happy-path isolation**：`mktemp`／clone／`cd`／checkout／`npm ci` 之間無逐步失敗終止；若 clone 或 `cd` 失敗，後續 checkout 可能落在 **caller 原 cwd（含來源共用 repo）** | **成立** | §6.6.B 每一步各自 `\|\| { echo FAIL…; exit 1; }`；`cd` 後再以 `git rev-parse --show-toplevel` 確認確實在 clone 內部才往下 |
| `sha256sum -c` 失敗不會終止整段 | **成立** | 步驟 2 之 anchor 驗證維持 `sha256sum -c -`（本身非零即終止），並於 §6.6.B 明示逐步終止原則。⚠ **[SUPERSEDED by ② R4 → §14.8]**：現行 driver **不再使用 `sha256sum -c`**，anchor 由 `materialize-overlay.mjs` 自驗（不符即 non-zero exit） |
| 來源 branch／status **只有事後列印，未保存 before 值並斷言相等** | **成立** | §6.6.B0 先存 `BEFORE_HEAD`／`BEFORE_BRANCH`／`BEFORE_STATUS`；B3 做**三項逐字 equality 斷言**。⚠ **[SUPERSEDED by ② R4 → §14.8]**：`§6.6.B0`／`§6.6.B3` 之分段編號已不存在；等價機制併入現行 driver 的 `finalize()`，且**每個 probe 先斷言 rc=0 再比較**（R2 版只比字串，probe 失敗會與 `BEFORE_STATUS=""` 誤判相等） |
| `readonly-reviewer.md` 禁止**所有**寫檔／安裝／checkout／rm，**不限共用工作樹** ⇒ disposable clone 保護來源 ≠ 授權 readonly reviewer 執行 | **成立**（逐字重讀該檔確認） | §6.6.0 改為 **`REPLAY-AUTHORIZATION-TIERS`** 兩層：**Tier A · readonly**（零寫檔／零安裝／零 checkout／零 rm；`git show` ＋ `node --input-type=module -e`、內容走 stdin）＝ readonly reviewer 可直接跑；**Tier B · mutable disposable runner**（需另行授權，🚫 readonly reviewer 不得執行） |
| cleanup 前需驗 canonical temp containment | **成立** | `WORK` 經 `pwd -P` canonicalize，並與 `TMPDIR` canonical 根做 `case` 比對；`cleanup()` **刪除前再驗一次**，不符則拒刪並告警 |
| 預期非零的 `tsc` 要另外捕捉，**不能盲加全域 `set -e`** | **成立**（base 有 352 條診斷，`tsc -b` 預期回非零） | §6.6.B 明文警示；採 `set -u` ＋ 逐步顯式判斷，🚫 不用全域 `set -e` |

**Tier A 已實測可行**（零寫檔）：`git show <base>:<path> \| node --input-type=module -e '…'`
⇒ exit 0、`base emit sha256 = 10c1d1f8…`、`✓ base 側 5 條守衛全過`。

#### 14.6.3 Required（guard 5 負向控制無效）之處置 —— **② 完全正確，我方實測復現**

② 指出我的 guard 5 注入 `const x: number = "str"` 其實觸發 guard 6。**本棒以 repo 之 TypeScript 5.9.3 實測**：

| 注入 | `transpile diagnostics` | emit sha 是否改變 | 實際觸發 |
|---|---|---|---|
| `const x: number = "str"`（舊） | **0** | **是** | **guard 6**，🚫 非 guard 5 |
| `type __BROKEN = ;`（② 建議，採用） | **1（TS1110）** | **否** | **guard 5**，乾淨隔離 |

⇒ 舊「4 條獨立轉紅」**為假（真實 3 條）**。已換注入並把**所有**負向控制改為
**同時斷言 exit code ＋ 失敗守衛身分**，重測得 `5 passed, 0 failed`。
另補 ② 要求之「完整可執行 Node invocation（含三實參）」與
「transpile diagnostics 只覆蓋 syntax／options、semantic 正確性由完整 `tsc` oracle 負責」之限定。

**根因（誠實記錄）**：我的負向控制**只斷言 exit code**，沒斷言「失敗的是哪一條守衛」——
於是一個測不到自己標的的負向控制，看起來是綠的。
⇒ 與本棒 `SR-35`（母體 < 性質）同源：**斷言的粒度小於它宣稱驗證的性質**。

#### 14.6.4 ② 之其他認定（記錄，🚫 不轉錄升格）

- Immutable evidence 全部吻合：六 commit 線性鏈 · R2 僅 plan `+256/-40` · base→R2 恰一個 added plan doc ·
  `audit.ts` 全程 `ec2a9b07…` · PLAN／packet 副本 blob 均 `ec94fdd0…` · 工作樹僅既有 `?? CLEANUP_PLAN.md`。
- State Consistency／Queue／Payment／Distributed State：**Not Applicable**。
- Observability：runtime observability 未變；七道 coding-stage CI、committed-diff ratchet、
  production bundle 仍未執行，維持既有 residual risk。
- ② 重申：repo 無 TypeScript governance manifest ⇒ `TS-*`／`GOV-*` 諸 rule ID 皆
  **advisory／not enforced**；其退回依據是「**實際可重播行為 ＋ repo reviewer 契約**」，
  🚫 不是 machine-enforcement 宣稱。
- ② 明示：本輪修正可做成 **PLAN-only R3**；若 production design／overlay 不變，**不要求重送 ①**。

---

### 14.7 ② Codex Plan Gate — R3 verdict 與處置 receipt

**verdict**：`CODEX_PLAN_CHANGES_REQUESTED` — **1 Blocker family ／ 1 Required family**
**受審錨點**：PLAN commit `ce327b6b`；base `acc98dfb`

**② R3 判為 CLOSED**：guard 5 修正成立（`type __BROKEN = ;` 唯一 `TS1110`、emit 仍 6599 B／`10c1d1f8…`）·
`REPLAY-AUTHORIZATION-TIERS` 的 actor split **概念正確** · `TS-BOUNDARY-002` 維持 CLOSED ·
production design／overlay 未變 ⇒ **不需重送 ①**。

#### 14.7.1 我方逐條實測復現 ②（🚫 未實測前不動手）

| ② 之宣稱 | 我方實測 |
|---|---|
| `set -u; false; echo` 仍續行 | ✅ 復現（`set -u` 不擋 non-zero） |
| `node …; echo "exit=$?"` 整段回 0 | ✅ 復現（Node exit 1 被 echo 吃掉，外層 rc=0） |
| 空輸入實際命中 **G1+G3+G6** | ✅ 復現（3 條失敗訊息） |
| CRLF 實際命中 **G2+G4+G6** | ✅ 復現（3 條失敗訊息） |
| `pwd -P` vs `git rev-parse --show-toplevel` 方言不同 | ✅ 復現（`/c/Users/…` vs `C:/Users/…`）⇒ 舊 guard **必然假紅** |

⇒ **五條全部成立。** 我方「isolated 4 條」之宣稱**為假，真實 2 條（G5／G6）**。

#### 14.7.2 Blocker 之處置 — 發布**已實跑**的連續 driver

依 ② 之 Minimal Safe Fix 六項逐條落實（全文見 §6.6.B）：

| ② 要求 | 落實 |
|---|---|
| 1 連續無省略 driver；expected-zero 皆 guard | driver 為單一連續腳本，兩支 helper **heredoc 內嵌**；每個 expected-zero 命令 `\|\| fail …` |
| 2 `tsc` 預期非零另捕捉、驗確切 status／診斷集合 | 斷言 **`rc == 2`**（實測：有診斷 rc=2、config 不存在 rc=1 ⇒ 可區分工具失敗）＋ 診斷行數 ＋ ratchet `errorCount`／`cleanFiles` |
| 3 EXIT finalizer 保存原始 rc、每次退出跑來源 equality、先離開 `$WORK`、驗 containment、檢查 cleanup、任何失敗回非零 | `finalize()` 首行 `local rc=$?` → `cd /` → 三項 equality → containment `case` → `rm -rf` 失敗即 `ok=0` → `[ -e "$WORK" ]` 再驗 → `ok≠1` 則 `exit 1` |
| 4 Windows cwd 驗證改 `pwd -P` equality ＋ `--is-inside-work-tree` | 兩側各自 `cd … && pwd -P` 後比對，並先 `git rev-parse --is-inside-work-tree` |
| 5 Tier A 改 `export SRC`、pin 完整 commit、A1 fail closed | 已改；`PLAN` 由 operator 依 packet 填入（本檔無法自我引用其 commit，已註明） |
| 6 Inline 完整 harness；斷言完整 failure set；G1／G2 標 coupled、G5／G6 才 isolated | 負向控制斷言**條數 ＋ 逐條字串**；分類表列於 §6.6.B 末 |

**實跑證據**：driver rc=0；4 組負向控制各自「失敗集合恰 N 條且完全相符」；
finalizer 回報來源三項逐字相等、workdir 已清理；來源 repo 前後 `HEAD`／`branch`／`status` 相同。
**driver 自身負向控制**：`ANCHOR` 竄改 → rc=1；`EXPECT_OVER_DIAGS` 竄改 → rc=1。
**cleanup 實證**：`$TMPDIR` canonical 根下具 driver 特徵者 **0 個**。

⚠ **附帶發現（`SR-43`）**：原擬用 `git apply` 物化 overlay，實測 Windows Git Bash 下會把 LF 轉 CRLF
（**+179 CR、7674 vs 7495 bytes**）⇒ anchor 必然不符。改用確定性物化（唯一字串替換 ＋ 自驗 sha256）。

#### 14.7.3 ② 之其他認定（記錄，🚫 不轉錄升格）

- Immutable evidence 吻合：七 commit 鏈及 parents · R3 只改 PLAN `+232/-47` ·
  `audit.ts` 全程 `ec2a9b07…` · R3 PLAN／packet copy blob `af272e08…` ·
  **tracked／index clean**（⚠ 精確表述：工作樹另有既存之 untracked `?? CLEANUP_PLAN.md`，
  該檔全程未 stage、未改動；🚫 不得寫成「工作樹 clean」——`SR-49`）。
- State Consistency／Queue／Payment／Distributed State：**Not Applicable**。
- Observability：② 已跑 commit/blob/packet replay · R2→R3 完整 delta · **Tier A 唯讀重播** ·
  guard 5／6 · Bash non-zero semantics · Windows Git Bash path-dialect probe；
  未跑者為七道 coding-stage CI · committed-diff ratchet · production bundle（**正確揭露之 residual risk**）。
- ② 重申 repo 無 TypeScript governance manifest ⇒ 相關 `TS-*`／`GOV-*` 皆 advisory／not enforced；
  其退回依據是**實際重播結果 ＋ repo reviewer 契約**，🚫 非 machine-enforcement 宣稱。
- ② 明示：可做成 **PLAN-only R4**；production design／overlay 不變則**仍不要求重送 ①**。

---

### 14.8 ② Codex Plan Gate — R4 verdict 與處置 receipt

**verdict**：`CODEX_PLAN_CHANGES_REQUESTED` — **1 Blocker family ／ 1 Required family**（＋4 項非 gate-driving 文字清理）
**受審錨點**：PLAN commit `956ebe3a`；base `acc98dfb`

**② R4 判為 CLOSED**：Tier A 以 packet 提供之完整 SHA 執行成功、A1/A2 fail-closed ·
連續 driver 與兩支 helper 通過語法檢查 · overlay 重播 `7495 B / CR=0 / 79792231…` ·
emit `6599 B / 10c1d1f8…` · G1/G2 coupled、G5/G6 isolated 之完整 failure sets 正確 ·
`TS-BOUNDARY-002` / `UB-B-1` 維持 CLOSED。

#### 14.8.1 我方逐條實測復現 ②（🚫 未實測前不動手）

| ② 之宣稱 | 我方實測 |
|---|---|
| `comm \| wc` 的 pipeline rc 被丟棄 ⇒ `ADDED=0` 假綠 | ✅ 復現（`pipeline_rc=1` 而 `added=0`，斷言仍過） |
| 失敗的 `git status` 回空字串，與 `BEFORE_STATUS=""` 誤判相等 | ✅ 復現（`[ "$(false)" = "" ]` → true） |
| `mktemp` 成功但 trap 未裝的窗口；`WORK="$(…)"` 失敗覆寫為空 | ✅ 復現（canonicalize 失敗後 `WORK=''`，原路徑洩漏） |
| TypeScript 5.9.3 為 **devDependency**（非 dependency） | ✅ 復現（`devDependencies.typescript = ^5.9.3`；`dependencies` 無） |

⇒ **四條全部成立。**

#### 14.8.2 Blocker family 之處置 — driver v2

三條缺陷（`SR-46`／`SR-47`／`SR-48`）之處置見 §6.6.B 之「v2 相對 v1 之實質強化」表。
**已端到端實跑，rc=0**；並補 ② 指定之**三組新負向控制**（pre-clone early failure ／
after-status probe failure ／ `comm` failure），連同既有兩組共 **5 組**，全部 rc=1。

⚠ 其中「after-status probe 失敗」一組最能說明修正的實質：
driver 本體**成功（原始 rc=0）**，但 finalizer 因無法驗證來源狀態而把最終 rc 提升為 **1**
—— 把「不能證明沒動到」與「證明沒動到」區分開。

#### 14.8.3 Required family 之處置 — 斷言母體對齊宣稱

四條（合併記為 `SR-49`）：exact multiset 逐位元組比對 · ratchet 三欄全驗 ·
`npm ci --include=dev` ＋ 本地 tsc 版本斷言且禁 `npx` · `SRC` canonicalize。
⇒ 與本棒 `SR-35`（母體 < 性質）、`SR-39`（斷言粒度 < 宣稱性質）**同族之第 3 次**。

#### 14.8.4 四項非 gate-driving 文字清理（② 建議 R5 一併修，已做）

| ② 之項目 | 處置 |
|---|---|
| §6.6 舊步驟 4/5、process-substitution、「修正後 4 條獨立」殘句 | 隨 §6.6 重寫已移除；殘餘命中經逐條分類**全為 errata／SR 條目之歷史引用**（mention ≠ use） |
| 歷史 §14.6 的 `sha256sum`／`B0`／`B3` 指標 | 就地加 **`[SUPERSEDED by ② R4 → §14.8]`** 並說明現行等價機制，🚫 不改寫歷史 receipt |
| §14.7.3 「工作樹 clean」 | 改為 **tracked／index clean**，並明載工作樹另有既存 untracked `?? CLEANUP_PLAN.md`（`SR-49`） |
| packet 的 base-SHA 負控宣稱與實際 inventory 對齊 | R5 packet 改列**逐項負控 inventory**（5 組 driver 級 ＋ 4 組 emit guard 級），並標明各自出處 |

#### 14.8.5 ② 之其他認定（記錄，🚫 不轉錄升格）

- Immutable evidence 吻合：HEAD `956ebe3a…` · R3→R4 只有 PLAN `+423/-167` ·
  packet SHA `a8ca80b3…` · PLAN blob `d3204e1a…` · `audit.ts` 在全部 anchors／index／worktree 皆 `ec2a9b07…`。
- State Consistency／Queue／Payment／Distributed State：**N/A**（本輪問題只在 replay driver 的狀態與證據完整性）。
- Observability：② 已跑 Git chain／merge-base／diff scope · packet/hash/blob · 全部 source blobs ·
  Tier A · Bash/Node syntax · in-memory materializer · emit 與四組 guard controls · 兩個 fail-open Bash probes；
  未跑 Tier B clone/npm/checkout/rm · 七道 coding-stage CI · committed-diff ratchet · production bundle。
- ② 重申相關 `TS-*`／`GOV-*` 皆 **advisory／not enforced**（repo 無 TypeScript governance manifest）；
  退回依據為**實際重播結果 ＋ repo reviewer 契約**。
- ② 明示：可維持 **PLAN-only R5**；不動 §4 design／overlay anchor／production changed-files
  ⇒ **不需重送 ①**。
- ⚠ **② 之 residual risk 提醒（如實轉錄）**：修正後仍須由**具 Tier B 寫入授權的 runner**
  重跑成功路徑與三組新負控。我方已於本機以該授權執行（§14.8.2），
  🚫 但這**不等於** ② 自身已重跑 Tier B —— ② 明載其未跑 Tier B clone/npm/checkout/rm。

---

### 14.9 ② Codex Plan Gate — R5 verdict 與處置 receipt

**verdict**：`CODEX_PLAN_CHANGES_REQUESTED` — **1 Blocker ／ 2 Required ／ 1 Minor**
**受審錨點**：PLAN commit `dd4bb881`；base `acc98dfb`

**② R5 判為已關閉**：`comm` rc · after-probe rc · exact multiset · ratchet 三欄 · emit guard
（皆為 R4 缺陷）。**Production overlay 未變 ⇒ 不需重送 ①。**

#### 14.9.1 我方逐條實測復現（🚫 未實測前不動手）

| ② 之宣稱 | 我方實測 |
|---|---|
| `TMPDIR="$SRC/node_modules"` ⇒ clone 建在共用來源 repo 內，且被 `.gitignore` 忽略 ⇒ `status` 仍相同 | ✅ `git check-ignore -q node_modules` → **yes** ⇒ 「來源未被觸碰」會**假綠** |
| Tier A 以 `SRC=.` 執行 → `ERR_INVALID_ARG_VALUE` | ✅ 復現（rc≠0） |
| **`scripts/typecheck-ratchet.mjs:188` 仍 `execSync('npx tsc …')`** | ✅ 逐字確認 ⇒ 我方「🚫 不用 npx」**為假** |
| L634／L720-721／L1363 仍是 stale pointer | ✅ 三處皆在 |

#### 14.9.2 Blocker（`SR-51`）之處置 — driver v3

| ② 之 finding | v3 處置 |
|---|---|
| 未禁 `TMPROOT`/`WORK` 位於 `SRC` 內 | 兩者皆以 `case … in "$SRC"\|"$SRC"/*) fail` 拒絕；負控 **NC6** |
| `cd / \|\| true` 吞掉失敗 | 改 `if ! cd /; then … SKIP_RM=1; fi` ⇒ **拒絕刪除**（寧留勿誤刪）；負控 **NC7** |
| 來源 probe 只在 `rm` 前 | `probe_source()` 於 **cleanup 前後各跑一次** |
| cleanup 未重驗 junction/reparse | `safe_rm()` 刪前斷言 `cd d && pwd -P == d`（junction 會解析到別處）。⚠ **誠實限制**：只涵蓋 `$d` **自身**，🚫 不掃子樹（子樹掃描會把 Linux `node_modules/.bin` 的正常 symlink 誤判） |
| 三個 heredoc `cat` 未 guard rc | 全部 `\|\| fail`；`expected-removed.txt` 另斷言**恰 5 行**（`-s` 無法排除部分寫入） |
| trap 應在 allocation 前就緒 | `trap finalize EXIT` 移到 `mktemp` **之前**（`WORK`/`WORK_RAW` 為空時 finalizer 自動跳過） |

**driver v3 端到端實跑 rc=0**；PLAN 內嵌版本與實跑版本**逐位元組相同（382 行）**。

#### 14.9.3 Required（`SR-50`／`SR-52`）之處置

- **npx**：誠實縮窄宣稱（見 `SR-50`），並加 `npx --no-install tsc --version` 恰為 `Version 5.9.3` 之斷言。
  🚫 **本 PLAN 不再宣稱「本流程完全不用 npx」**。
- **可重播 harness**：發布 §6.6.C（7 組，逐組斷言 rc ＋ 訊息 ＋ **前後 `tmp.*` 集合差**）。
  ⚠ 殘留量測改用**集合差**，🚫 不再用「含 `repo/` 或 materializer」之內容特徵 ——
  ② 指出那會恰好漏掉 canonicalize 失敗留下的**空目錄**（`SR-52`）。
- **Tier A canonicalize**：新增 A0（`--is-inside-work-tree` → `--show-toplevel` → `pwd -P` → 驗 absolute → `export`）。
  `SRC=.` 負控：**修正前 rc=1、修正後 rc=0**。

#### 14.9.4 Minor `GOV-DRIFT-001`（`SR-53`）

上一輪自報「四項文字清理已做」與 live PLAN 不符。已以**斷言式腳本**逐條更新
（每條命中必須恰 1，否則 non-zero exit ⇒ 🚫 不可能靜默略過）；歷史 receipt 一律加
`[SUPERSEDED]`、🚫 不改寫原裁決。

⚠ **根因**：我把「已做」的判準放在**我記得做了什麼**，而不是**對 live artifact 再掃一次**。
與 `SR-30`（肉眼只抓到 2/3 個空行）同形態。

#### 14.9.5 ② 之其他認定（記錄，🚫 不轉錄升格）

- ② 獨立確認：R5＝`dd4bb881…`、九 commit 鏈與 parent 全相符 · base→R5 恰一個 added PLAN ·
  R4→R5 實際 `+245/-88` · PLAN blob／packet 副本＝`899d8853…` ·
  `audit.ts` 在 base／九個 commits／index／worktree 均為 `ec2a9b07…` ·
  overlay 7,495 B／CR=0／`79792231…` · emit identity 與 exact 5 removed／0 added 重播通過 ·
  **362 行** driver 與兩個 Node helper 語法通過（⚠ `SR-56`：原誤寫 382 —— 382 是 R6 之 v3，② R5 當時查證的是 **v3 前身的 362 行版**）· 工作樹仍只有既存 `?? CLEANUP_PLAN.md`。
- Queue／payment／distributed-state：本輪 PLAN-only，**均不適用**。
- Observability：七道 CI · committed-diff ratchet · production bundle 仍未跑（揭露正確）。
- ⚠ **② 之 residual risk（如實轉錄，🚫 不由本 PLAN 宣稱關閉）**：
  「目前負控成功仍是**作者自報**，非本輪獨立 Tier B 證據」——
  ② 明載其未跑 Tier B clone/npm/checkout/rm。我方已以寫入授權在本機執行（§6.6.B／§6.6.C），
  **但這不等於 ② 自身已重跑**。此差距只能由具授權之 runner 或 ② 自行執行來關閉。

---

### 14.10 ② Codex Plan Gate — R6 verdict 與處置 receipt（**本輪為 verification strategy 縮減**）

**verdict**：`CODEX_PLAN_CHANGES_REQUESTED` — **1 Blocker ／ 2 Required ／ 1 Minor**
**受審錨點**：PLAN commit `c4317d63`；base `acc98dfb`

**② R6 判為已實質關閉**：Tier A · temp/source overlap · trap timing · `cd` 失敗 · 前後 probe · heredoc rc。
**Production overlay 未變 ⇒ 不需重送 ①。**

#### 14.10.1 🔴 本輪的關鍵轉向：② 主動建議**縮減**，而非再加固

② R6 原文：「**你的投入產出疑問是合理的。建議 R7 不再擴寫 shell machinery**」，
並具體指出更安全的做法是「把整個 mutable lifecycle 交給 disposable runner，**不在 PLAN 內自行 `rm -rf`**」。

⚠ **這是本棒的一個結構性教訓**：`SR-54` 的 Blocker **不是來自被審的 3 行標註，
而是來自我為了證明那 3 行安全而新寫的工具**。一個掃描並刪除共享 temp 的 harness，
其自身風險已超過它提供的保證。
⇒ 與批 E ① R21「終止自建 evidence machine」屬同一結論，**本棒是第 2 次踩到**。

#### 14.10.2 逐條實測復現（🚫 未實測前不動手）

| ② 之宣稱 | 我方實測 |
|---|---|
| `ls \| sort` 無 pipefail ⇒ 失敗仍 rc=0 | ✅ 復現 |
| `comm … \| grep -c . \|\| true` 把量測失敗轉成 `0` | ✅ 復現 |
| `trap 'false' EXIT; true` ⇒ 最終 rc=0 | ✅ 復現 |
| NC6 依賴既存 `node_modules` ⇒ 非環境獨立 | ✅ 確認（乾淨 checkout 會先失敗在 canonicalize） |
| §14.9.5 誤寫 382（應 362）· §6.6.B 前言仍寫 v2 · 根因帳仍 11 條 | ✅ 三處皆確認 |

#### 14.10.3 處置＝縮減（`SR-54`／`SR-55`）

| 項目 | 處置 |
|---|---|
| §6.6.C 自動化 harness | **整節移除**，改為**宣告式變異清單**（只說改哪行、期望什麼）。🚫 PLAN 內不再有任何會刪除的腳本 |
| driver `safe_rm()` ＋ 全部 `rm -rf` | **v4 整段移除**；workspace 路徑改為**回報給 runner**，由 runner 負責清理 |
| NC6 環境相依 | 改用**保證存在的 `$SRC` 自身**測 equality rejection |
| 舊 NC7（`cd` 失敗拒刪） | 隨刪除邏輯移除而**失去測試對象**，一併刪除 |

**機械驗證**：全檔 bash code block 之**刪除語句命中 0**。

> 🚨 **行數宣稱之更正（`GOV-DRIFT-001`／`SR-58`；② R7 Minor）**：原文寫「**可執行行 368 行**」，
> **該標籤為誤** —— 368 是「非註解行」之數，其中含 **44 個空白行**，空白行不是可執行行。
> **coding 階段獨立複算**（母體 ＝ 全檔 bash fence 內全部行，零收窄）：
> **總 420 行 ＝ 空白 44 ＋ 註解 52 ＋ 非空白非註解 324**（44＋52＋324 = 420，帳平）。
> ⇒ 正確表述為「**非空白非註解 324 行**」；368 ＝ 44 ＋ 324，即原數把空白行計入。
> ⚠ 但「**刪除語句命中 0**」之結論**不受影響** —— 被誤計入的 44 行皆為空白行，結構上不可能含指令。

**driver v4 實跑 rc=0**，正向路徑全綠、workspace 路徑已回報。

#### 14.10.4 Required 2（npx）之處置

`npm_config_offline=true npm_config_yes=false` 加在**兩次 ratchet 執行**上（實測不改變輸出）。
⚠ **但仍不宣稱「機械上不可能下載」** —— ② 正確指出 `--no-install` 只證明**當下**可解析。
本 PLAN 之宣稱限定為：(a) 本地已解析且版本恰 5.9.3；(b) ratchet 以 offline 模式執行。

#### 14.10.5 Minor（`SR-56`／根因帳）

§14.9.5 之 **382 → 362**（382 是 R6 的 v3，② R5 當時查證的是 362 行版）。
根因帳由 11 → **14**，納入 `SR-49`／`SR-50`／`SR-52`（三者皆自稱同族卻未入帳）。

#### 14.10.6 ② 之其他認定（記錄）

- ② 獨立確認：base→R6 恰一個 added PLAN · R5→R6 只有 PLAN（`+305/-97`）·
  PLAN blob／副本 `c9108dab…` · `audit.ts` 在 base／十個 commits／index／worktree 均 `ec2a9b07…` ·
  **literal Tier A 以 `SRC_IN=.` ＋ 完整 R6 SHA 重播 rc=0**，且前後 repo 狀態與 source/index blob 相同 ·
  driver 382 行、harness 69 行、兩個 Node helper 語法通過 · 工作樹仍只有既存 `?? CLEANUP_PLAN.md`。
- ② 另澄清：其收到的請求末尾有一處 SHA 轉錄錯字，**packet 與 Git object 本身一致**
  （我方 packet §0 所載為完整 40-hex `c4317d63c42c517554c8be26ae7a86ad483cd49f`，無誤）。
- Queue／payment／distributed-state：**Not Applicable**。
- ⚠ **② 之 residual risk（如實轉錄）**：本輪 ② **依唯讀契約未執行 Tier B 或任何刪除**；
  「目前 7/7 仍是**作者環境證據**」。此差距 🚫 不由本 PLAN 宣稱關閉。

---

### 14.11 ② Codex Plan Gate — R7 verdict（**APPROVED**）＋ coding 階段落地 receipt

**verdict**：**`CODEX_PLAN_APPROVED`** — **0 Blocker ／ 0 Required ／ 1 Minor（non-blocking）**
**受審錨點**：PLAN commit `d22e8b5e`（＝當時 HEAD，錨點未漂移）；base `acc98dfb`
**packet identity**：`02g-codex-plan-delta-r7-…-read.md` ＝ `ff3683cc…`／6309 B；
plan 副本 ＝ `4c99c075…`／174888 B，**與 `d22e8b5e` 之 PLAN blob（git blob `8abccf8d`）逐位元組相同**
（transport integrity 已驗，依 [[feedback_gate_packet_transport_integrity]]）。

**② R7 明載之兩項邊界（如實轉錄，🚫 不得弱化）**：
1. 「這項 approval 仍**不等於** `CODING_ALLOWED`」—— owner 明示前不得改 `audit.ts`／跑 Tier B／commit／push／deploy。
2. **不需重送 ① Architecture Gate**（production design 自 ① R3 起 byte-identical）。

⇒ owner 於 **2026-08-24 當輪明示 `CODING_ALLOWED`** 後才進 Phase 2（ledger 第 39 列）。

#### 14.11.1 ② R7 判為已實質關閉

driver v4 已移除 harness／`safe_rm()`／全部可執行刪除命令，workspace 生命週期交具授權 runner；
clone／checkout／安裝／產物皆限於 `$WORK`；source 前後 probe 維持 fail-closed。
state consistency 全項 PASS（blob 恆等 · overlay 7495 B／CR=0／`79792231…` · 診斷 352→347／REMOVED=5／ADDED=0 · emit 兩側 6599 B／`10c1d1f8…`）。

#### 14.11.2 Minor `GOV-DRIFT-001` 之處置（`SR-58`；**4 項成立、1 項不成立**）

| ② 之列舉 | coding 階段復現 | 處置 |
|---|---|---|
| §6.6.B 用法行仍寫 `replay-tier-b-v3.sh` | ✅ 成立 | 改 `v4` 並標原誤 |
| §6.6.B 仍殘留 v2 cleanup 結果 | ✅ 成立；其 `workdir 已清理` 在 v4 語意下**已為假** | 加 v2-historical 警語，逐條點出 v4 下不成立之兩句 |
| 根因帳稱 14、實列 11 個 ID | ✅ 成立（實測列舉數 ＝ 11） | 補 `SR-49`／`SR-50`／`SR-52` ＋ 納入 `SR-58`；改**下界**表述 ＋ 四項限定 |
| 「368 可執行行」實含 44 個空白行 | ✅ 成立（獨立複算：總 420 ＝ 空白 44 ＋ 註解 52 ＋ 實碼 **324**） | 改「非空白非註解 324 行」；標明「刪除語句命中 0」不受影響 |
| 「`🚫 不用 npx`」殘留 | ⚠ **不成立** | **母體 ＝ ② R7 受審錨點 `d22e8b5e` 版本之全檔（零收窄）該字串全部出現點；實測恰 5 處。**<br>⚠ **必須錨定版本**：任何*談論*該字串的句子本身都含該字串（本列與 `SR-60` 即是），故對「當前 HEAD」計數會隨編輯遞增 ⇒ 只有錨定版本的數字可重播。<br>**重播指令**：`git show d22e8b5e:docs/plans/stage7-pr2dw-batchb-read-admin-audit-noimplicitany.md \| grep -c "不用 npx"` ⇒ `5`。<br>五處分別為：§6.6.B driver header（「宣稱**為假**」）· §9.2「npx 之誠實限定」（「🚫 不得宣稱『本流程完全不用 npx』」）· §14.0 `SR-50` 列（「之宣稱為假」）· §14.9.1 實測復現表（「✅ 逐字確認 ⇒ 我方『🚫 不用 npx』**為假**」）· §14.9.3（「🚫 **本 PLAN 不再宣稱「本流程完全不用 npx」**」）。**5/5 皆落在更正或限定語句內**，🚫 無一處是 live 宣稱 ⇒ **刻意不改**。照字面「清掉」會把已誠實縮窄的限定改回過度宣稱（＝批 D 已記載之失效模式「照 gate 字面改反而重造問題」） |

#### 14.11.3 coding 階段落地 receipt（**實跑輸出，🚫 非推理**）

> ⚠ 依 §9.1 之自身禁令，7 道之結果**不寫回 §9.1**；此處僅作軌跡留存，
> 其權威呈現在當輪中文報告第 5 欄。

| 驗收項 | 期望（approved plan） | 實測 |
|---|---|---|
| 檔案 sha256 | `79792231…` | **完全相同** ✅ |
| bytes ／ CR | 7495 ／ 0 | 7495 ／ 0 ✅ |
| `git diff --stat` | `+29 / -3` | `+29 / -3` ✅ |
| 三個 `@@` 標頭 | `-42,7 +42,33`／`-58,7 +84,7`／`-127,7 +153,7` | 三者逐字相同 ✅ |
| 逐 hunk 增刪 | `+27/-1`／`+1/-1`／`+1/-1` | 相同 ✅ |
| 診斷總數 | 347 | 347 ✅ |
| 本檔殘餘診斷 | 0 | 0 ✅（5 條 `TS7006`/`TS7031` 全清） |
| ratchet | 347／326／337 | `errorCount=347 cleanFiles=326`、baseline 1119/175 未動 ✅ |
| emit identity | `10c1d1f8…` 兩側相同 | 兩側皆 `10c1d1f8…`／6599 B，`ALL GUARDS PASSED (6/6)` ✅ |
| emit oracle 負向控制 | 注入落選案 v1 應轉紅 | emit 6603 B／`4f3da1fa…`／exit 1 ✅（差恰 4 B ＝ §4.3 之預測） |
| suppression 預算 | 0／0／0／**1**／0 | 相同（唯一 unchecked assignment ＝ `UB-B-1`＠L156）✅ |
| export 面 | 僅 `onRequestGet` | AST 實測 ＝ 1 項 ✅（`UserAuditRow` 確為 module-local） |
| `B_EXCLUDES` | 零觸碰 | `git diff --name-only acc98dfb -- <全部排除項>` ⇒ 空 ✅ |

**7 道 CI gate**：`lint` 0 · `typecheck:ratchet` 0 · `verify:browser-pipeline` 0 · `test:cov` 0（740 passed）·
`test:int` 0（77 files／1385 tests）· `build:functions` 0（`Compiled Worker successfully`）· `npm audit` 0 vulnerabilities。
**§9.2 附加**：`lint:handlers` ／ `lint:archive-no-delete` ／ `lint:migrations` 皆 EXIT 0。
🚫 **未跑 `npm run build`**（會重寫 `public/*.html` ＝ scope creep，沿 `SR-10`）。

**JSDoc 內事實宣稱之現地複驗**（該註解隨 production code 上線，故不沿用 PLAN 階段數字）：
`@cloudflare/workers-types` 缺席（母體 17 項／0 命中）· `Env.chiyigo_db: D1Database`＠`types/env.d.ts:23` ·
migration `0038:20-21` 確為 `archived_at`／`cold_class`（`0044` 之同名欄屬 `audit_log_aggregate_*`，**非本表**）·
`0017` DDL 之 NOT NULL／nullable 分布與 §4.5 逐欄相符（含 `CHECK(severity IN …)`）·
`AuditLogRow`＠`utils/audit-log.ts:30` · `UserAuditRow` 於本檔外 **0 命中**。

#### 14.11.4 尚未取得（🚫 不得讀成已通過）

③ Codex Code Gate · ④ ChatGPT faithfulness · squash-merge 後之 main CI／deploy。
⇒ 本棒現態 ＝ **`CODE_SELF_REVIEW_CLEAN` 之後、`CODEX_CODE_APPROVED` 之前**，🚫 **不得**宣稱 CLOSED。
Tier B 連續 driver 於本階段**仍未由外部執行** ⇒ ② R6／R7 所載「7/7 為作者環境證據」之差距**依然存在**，本節不宣稱其關閉。

---

## 15. 連結

[[feedback_codex_review_workflow]] · [[feedback_guard_population_must_cover_property]] ·
[[feedback_scope_qualified_universal_claims]] · [[feedback_tsc_setdiff_must_be_line_shift_robust]] ·
[[feedback_ts_ratchet_discipline]] · [[feedback_security_boundary_pr_first_do_no_harm]] ·
[[feedback_pre_merge_gate_checklist_match_ci]] · [[feedback_parallel_track_staging_collision]] ·
[[feedback_verify_before_self_correction]] · [[project_audit_phase2]] · [[project_js_to_ts_migration]]
