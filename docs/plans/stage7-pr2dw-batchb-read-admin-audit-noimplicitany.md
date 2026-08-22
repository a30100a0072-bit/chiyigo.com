# Stage 7 · PR-2dw 批 B-read — `functions/api/admin/audit.ts` noImplicitAny 5 → 0

> **狀態讀法**（沿批 E `ARCH-E-R18-G1`；永久規則，🚫 本身不含任何會過期的值）：
> 🚫 本檔任何章節**不複述** gate 當前狀態。**gate 狀態的唯一 SoT ＝ §14 裁決 ledger。**
> 🚫 本 artifact **不自我宣告** self-review closure，🚫 不持有「最新輪次／finding 總數」之 live 副本。
>
> **級別**：實作 L1 ／ 審查 care L2（沿批 D／E 先例；⚠ 任一 gate 得挑戰，疑義一律 fail-safe 升級）
> **維度 A self-review 形式**：**單 agent 對抗式**（owner 2026-08-22 當輪裁定；非 workflow）
> **base commit**：`acc98dfbeeed237533b5b844338b5798a148ce8f`（main）
> **base blob**（`functions/api/admin/audit.ts`）：`ec2a9b0795d500d72159988071807be86e8d049f`

---

## 1. 目的

把 `functions/api/admin/audit.ts` 的 **5 條 `noImplicitAny` 診斷清為 0**（`TS7006`×3 ＋ `TS7031`×2），
使該檔進入 ratchet 的 clean set。

**性質＝純 type-only、零 runtime delta**（§6.3 有 byte-identical emit 實測 ＋ §6.4 兩組負向控制）。
🚫 本棒**不**修改任何行為、不動 schema、不動 migration、不動測試、不動 caller、不動 SQL。

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
| 新增 `eslint-disable` | **0** | 0 |

⚠ `BAN_PATTERNS` 不涵蓋 non-`any` `as`（§7.2），故該列以**人工計數**補位。
重播指令：`grep -nE "\bas\s+[A-Za-z]|: any|as any|@ts-(ignore|expect-error|nocheck)" functions/api/admin/audit.ts`

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

```
BASE(blob)         srcBytes= 6198 srcCR=0  emitBytes= 6599 emitCR=0 diags=0  sha256=10c1d1f87d28787475b481f8a210007863fd60bfd4bcabd827488139778b0b86
OVERLAY(on-disk)   srcBytes= 7495 srcCR=0  emitBytes= 6599 emitCR=0 diags=0  sha256=10c1d1f87d28787475b481f8a210007863fd60bfd4bcabd827488139778b0b86

NON-EMPTY GUARD : base=true overlay=true
SRC CR=0 GUARD  : base=true overlay=true
EMIT CR=0 GUARD : base=true overlay=true
BYTE-IDENTICAL  : true
```

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
`e3b0c442…`」的假綠。本量測同時斷言 `bytes > 0`、`srcCR = 0`、`emitCR = 0`、`diags = 0`。

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

**Shell 需求（不可省）**：步驟 1／3／6 之指令使用 process substitution `<(...)` 與 `comm`，
需 **bash**（本機為 Git Bash；Linux/macOS 原生可）。🚫 PowerShell 不支援 `<(...)`，照貼會失敗。
步驟 4 為 Node ESM，任何 shell 皆可。

**前置**：`git -C <repo> fetch && git -C <repo> checkout acc98dfbeeed237533b5b844338b5798a148ce8f && npm ci`

**步驟 1 — base 診斷／ratchet**
```bash
npx tsc -b tsconfig.solution.json --force > tsc-base.txt 2>&1   # 期望 352 行
npm run typecheck:ratchet:report                                 # 期望 352 / 12 / 325 / 337
npm run lint                                                     # 期望 EXIT 0
```

**步驟 2 — 重建 overlay**：對 `functions/api/admin/audit.ts` 施以 §4.2 三處標註 ＋ §4.1 逐字宣告 block；
以 `sha256sum` 驗其為 `79792231…`（§6.3 anchor）。

**步驟 3 — overlay 診斷／set-diff**
```bash
npx tsc -b tsconfig.solution.json --force > tsc-over.txt 2>&1   # 期望 347 行
norm() { sed -E 's/\(([0-9]+),([0-9]+)\)//' "$1" | sort; }
comm -23 <(norm tsc-base.txt) <(norm tsc-over.txt)   # 期望 5 行，全為本檔 TS7006/TS7031
comm -13 <(norm tsc-base.txt) <(norm tsc-over.txt)   # 期望 0 行
npm run typecheck:ratchet:report                      # 期望 347 / 11 / 326 / 337
```

**步驟 4 — emit identity**（可獨立執行之等效腳本；🚫 不進 repo、🚫 不進 CI）
```js
// 母體 = 恰 2 個輸入：(1) base immutable git blob (2) on-disk overlay 檔
// 宣稱保護的性質 = 「型別標註 erase 後，emit 逐字不變」
// 🚫 單檔 transpile identity，不是 production bundle identity
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
const REPO = '<repo>', REL = 'functions/api/admin/audit.ts'
const ts = createRequire(REPO + '/package.json')('typescript')
const opts = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
               removeComments: false, newLine: ts.NewLineKind.LineFeed }
function measure(label, src) {
  const srcCR = (src.match(/\r/g) || []).length
  if (src.length === 0) throw new Error(`${label}: source is EMPTY`)
  const out = ts.transpileModule(src, { compilerOptions: opts, reportDiagnostics: true })
  const text = out.outputText, bytes = Buffer.byteLength(text, 'utf8')
  if (bytes === 0) throw new Error(`${label}: emit is EMPTY`)
  return { label, srcBytes: Buffer.byteLength(src,'utf8'), srcCR, bytes,
           cr: (text.match(/\r/g)||[]).length,
           sha: createHash('sha256').update(text,'utf8').digest('hex'),
           diags: out.diagnostics.length }
}
const b = measure('BASE(blob)', execFileSync('git',['-C',REPO,'show',`${process.argv[2]}:${REL}`]).toString('utf8'))
const o = measure('OVERLAY(on-disk)', readFileSync(process.argv[3],'utf8'))
console.log(b, o, 'BYTE-IDENTICAL:', b.sha === o.sha)
```
期望：兩側 `emitBytes = 6599`、`emitCR = 0`、`diags = 0`、`sha256 = 10c1d1f8…`、`BYTE-IDENTICAL: true`。

**步驟 5 — 兩組負向控制**：依 §6.4.1／§6.4.2 各注入一次，期望分別得 `ADDED = 2` 與 `BYTE-IDENTICAL: false`。

**步驟 6 — 還原**：`git checkout -- functions/api/admin/audit.ts`，驗 `git hash-object` ＝ `ec2a9b07…`。

⚠ **本 recipe 的信任模型**：所有 base 側輸入皆 content-addressed（commit / blob SHA），
外部可自行 `git cat-file` 驗證；overlay 側由 §6.3 anchor sha256 綁定。
🚫 本檔**不**宣稱「已封閉」，只宣稱「已示範上列量測可被外部重播、且兩個 oracle 各已示範抓到一類注入」。

---

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

1. **無行為可測**：§6.3 已證 emit byte-identical ⇒ 不存在任何新的 runtime 行為可供 regression test 鎖定。
   依 [[feedback_regression_test_must_lock_exact_failure]]，測不到 exact failure 的 test 即為
   「為覆蓋率寫的無意義 test」，本基線明文禁止。
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
| `npx tsc -b tsconfig.solution.json --force` ＋ set-diff | **診斷器**，🚫 非 gate、🚫 不進 CI |
| §6.6 步驟 4 emit identity | **診斷器**，🚫 非 gate、🚫 不進 CI |
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
emit byte-identical ⇒ revert 前後的 production bundle 行為亦無差異。

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
9. 不裁定其他 15 個單元的字母對映（`SPEC-B3`）
10. 不處置 `TD-BATCHB-1` / `TD-BATCHB-2`（外送 backlog）

---

## 14. Gate 軌跡

### 裁決 ledger（append-only；**gate 狀態之唯一 SoT**）

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

**根因分布（供後續棒次參考）**：26 條中 **10 條**
（`SR-1` `SR-2` `SR-7` `SR-11` `SR-12` `SR-13` `SR-17` `SR-18` `SR-25` `SR-26`）
同屬批 E 已記載之「**母體 < 性質**」族 —— 以腦中計數／他棒引用／未掃描的印象／**被 `head` 截斷的輸出**，
代替對真實母體的量測。
⇒ 印證 [[feedback_guard_population_must_cover_property]]「**修過不代表免疫**」：
該族在**新撰寫的段落**最易復發，即使作者剛讀過該教訓。

⚠ **`SR-21` 屬另一族且值得單獨記錄**：它不是量測失準，而是**新引入的識別字撞上既有識別字、且語意不同**。
自審之所以抓到，是因為對「新增的每一個公開/半公開名稱」主動跑一次 repo-wide 命名母體掃描 ——
🚫 不是靠「我覺得這個名字很自然」。建議後續棒次把此步驟列為**新增型別/常數時的固定動作**。

> 🚫 以下欄位**留空待填**，由實際 gate 回覆填入；🚫 不得預先自我宣告。
>
> - 維度 A self-review（單 agent 對抗式）：輪次與 findings — _待填_
> - ① ChatGPT Architecture Gate：verdict ＋ 錨點 SHA — _待填_
> - ② Codex Plan Gate：verdict ＋ 錨點 SHA — _待填_
> - ③ Codex Code Gate：verdict ＋ 錨點 SHA — _待填_
> - ④ ChatGPT faithfulness：verdict ＋ 錨點 SHA — _待填_

### 14.1 承接自批 E 之未結項（**非本棒新發現，🚫 不得當成 blocker 重開**）

| ID | 內容 | 處置 |
|---|---|---|
| `FAITHFULNESS-NB-001` | 批 E PLAN §3 之「9 呼叫點／8 檔」derived-copy drift（正確值 9 處／7 檔） | owner 已裁定不修；④ 判 non-blocking |
| `TD-BATCHE-1` | audit 寫入端 `admin_email` 契約硬化 | 接手棒次須**自行重新量測母體**（批 E §14.30 為 factual errata、不具規範地位）；🚫 本棒不處置 |
| ① R20 Q2(b) 11 個同族 claim | closure mechanism 已由 ① R21 終止且未指定替代 | 維持 unresolved |
| `governance/rules.json` 不存在 | TypeScript governance rule 仍為 advisory／not enforced | 現況記錄 |

---

## 15. 連結

[[feedback_codex_review_workflow]] · [[feedback_guard_population_must_cover_property]] ·
[[feedback_scope_qualified_universal_claims]] · [[feedback_tsc_setdiff_must_be_line_shift_robust]] ·
[[feedback_ts_ratchet_discipline]] · [[feedback_security_boundary_pr_first_do_no_harm]] ·
[[feedback_pre_merge_gate_checklist_match_ci]] · [[feedback_parallel_track_staging_collision]] ·
[[feedback_verify_before_self_correction]] · [[project_audit_phase2]] · [[project_js_to_ts_migration]]
