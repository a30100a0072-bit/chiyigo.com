
# Stage 7 PR-2dw 批 C2 — `functions/utils/audit-policy.ts` 型別脊椎

**PR id**：`PR-2DW-BATCH-C2`｜**級別**：`L1_CONDITIONAL`（見 §7 判級條件）
**base**：`3dc8e6600d7af5aef7a191014ba15205b7ee0db5`
**定序**：`A✅ → C✅ → **C2** → D → E → B-read → F → G → H0 → H1 → I → K → L → B-delete → J1 → J2`
（16 工作單元，producer-first + destructive-last；批 A `CLOSED`〔#149 `6aae9570` ＋ closeout #150 `78714975`〕、批 C `CLOSED`〔#151 `3dc8e660`〕）

## 1. 目標與定位

批 A 的 OD 裁定「批 C 型別脊椎**選項 1 僅作過渡**；另立 **C2**，須在 **H1／I／K／L 與 destructive archive API 之前**完成」。本棒即該 C2。

建立 `audit-policy.ts` 的 **compile-time 型別脊椎**：三個 exported type alias ＋ typed `REGISTRY` ＋ 三個具名回傳型別 ＋ `severity` 收窄。

> ⚠ **本棒不減少任何 `noImplicitAny` 診斷** —— `audit-policy.ts` 已於批 C 歸零（4→0）。
> 本棒目標是讓 **downstream 批次（D／E／B-read／F／G／H1／I／K／L）有可消費的型別地基**，
> 而非推進 ratchet 數字。**ratchet 維持 `373 / 14 / 323 / 337` 不變即為正確結果**；
> 任何 ratchet 變動都代表 scope 外溢，須停手。

## 2. 變更（唯一允許之變更）

**Allowed changed-files 恰三檔**（SPEC 核准鎖 5）：

| 檔 | 性質 | 行尾（硬約束） |
|---|---|---|
| `functions/utils/audit-policy.ts` | M | **純 LF**，base `CR=0` |
| `tests/audit-policy.test.ts` | M | **純 CRLF**，base `CR=452` ＝ 行數 `452`（每行皆 CRLF） |
| `docs/plans/stage7-pr2dw-batchc2-audit-policy-type-spine.md` | A | LF（同既有 plan doc 慣例） |

> ⚠ **兩個 source 檔行尾不同，且必須各自保留**。批 C 教訓：`git hash-object` 會套 Git clean
> filter、**攔不到行尾差異**；`grep -c $'\r'` 在 Git Bash **不是**可靠 CR oracle，
> 一律用 `tr -cd '\r' | wc -c`（SPEC 核准鎖 9）。

### 2.1 `functions/utils/audit-policy.ts` — 5 hunk

| # | 位置（base 行號） | 變更 |
|---|---|---|
| 1 | `:27` 之後（`AUDIT_CATEGORY` 的 `})` 後） | **新增 13 行**：三個 exported type alias |
| 2 | `:360` | `const REGISTRY = new Map()` → `new Map<string, AuditCategory>()` |
| 3 | `:372` | `classifyAuditEvent(eventType: string)` → `…: AuditCategory \| null` |
| 4 | `:395` | `classifyForCold(eventType: string, severity: string)` → `(eventType: string, severity: AuditSeverity): AuditColdClass` |
| 5 | `:413` | `listEventsByCategory(category: string)` → `(category: AuditCategory): string[]` |

### 2.2 Frozen intent diff（source 面）

> ⚠ **本區塊之 `@@` 標頭為人工示意、非 `git diff` 原文**（真實 hunk header 帶行號與長度）。
> 用途是**凍結變更意圖**供 gate 比對語義；🚫 不得拿去做機械 byte 比對。
> CODE stage 產出的**真實** `git diff` 依 §4.2 驗收，兩者若語義不符 → 以本區塊為準、停手。

```diff
@@ AUDIT_CATEGORY 之後 @@
   DEBUG_FAILURE:   'debug_failure',
 })
+
+export type AuditCategory =
+  (typeof AUDIT_CATEGORY)[keyof typeof AUDIT_CATEGORY]
+
+export type AuditSeverity = 'info' | 'warn' | 'critical'
+
+export type AuditColdClass =
+  | 'immutable'
+  | 'security_critical'
+  | 'security_warn'
+  | 'read_audit'
+  | 'telemetry'
+  | 'debug_failure'
 
 // F-3 Phase 2 archive 操作事件（commit 0038 起加入；全部歸 immutable category，
@@ :360 @@
-const REGISTRY = new Map()
+const REGISTRY = new Map<string, AuditCategory>()
@@ :372 @@
-export function classifyAuditEvent(eventType: string) {
+export function classifyAuditEvent(eventType: string): AuditCategory | null {
@@ :395 @@
-export function classifyForCold(eventType: string, severity: string) {
+export function classifyForCold(eventType: string, severity: AuditSeverity): AuditColdClass {
@@ :413 @@
-export function listEventsByCategory(category: string) {
+export function listEventsByCategory(category: AuditCategory): string[] {
```

### 2.3 `tests/audit-policy.test.ts` — 恰 5 處 `as const`（SPEC 核准鎖 4）

| # | base 行號 | 標的 |
|---|---|---|
| 1 | `:385` | immutable `it.each` → `] as const)` |
| 2 | `:394` | critical security `it.each` → `] as const)` |
| 3 | `:403` | non-critical security `it.each` → `] as const)` |
| 4 | `:435` | unknown-event fallback `it.each` → `] as const)` |
| 5 | `:444` | deterministic `const cases = [ … ]` → `] as const` |

**不得多、不得少。** 其餘 `it.each` **一律不加** `as const`，加了即 scope creep。其不需要的理由**分兩類**（🚫 不可混為一談）：

1. **根本不呼叫 `classifyForCold`** —— 例：`:163-169`／`:179-190` 等以 `AUDIT_CATEGORY.*` 為期望值的 tuple，只呼叫 `classifyAuditEvent(e)`，而 `eventType` 依 `OD-C1c` 維持 `string`。
2. **有呼叫，但 severity 是 inline 字面量** —— 例：`:407-413`（`read_audit`）／`:415-421`（`telemetry`）／`:423-429`（`debug_failure`）呼叫 `classifyForCold(e, 'info')`／`(e, 'warn')`。
   這些**確實流進收窄後的 `severity` 參數**，但傳的是字面量、本就可賦值給 `AuditSeverity`，故無需 `as const`。

⚠ 需要 `as const` 的**唯一**成因＝severity 值來自**陣列解構**（`it.each` tuple／`const cases`）而被 widen 為 `string`。

### 2.4 明確**不**改（負向清單）

- `const out = []`（`:414`）**不加型別標註** —— 實測不需要（`REGISTRY` 標型後 `out` 自然演進為 `string[]`），加了即非最小 diff。
- `Object.freeze({...})` 本體、七個 registry 陣列內容、`_registrySize`（維持 `228`）：**零修改**。
- JSDoc `@param {string}` / `@returns` 區塊：**全數保留原樣**（`.ts` 下 inert）。TypeScript signature 為型別 SoT。
  既有慣例實測（本 base、`functions --include=*.ts`）：`@param\s+\{` 命中 **25** 檔；併計 `@returns\s+\{`／`@type\s+\{` 為 **27** 檔。
  ⚠ 引用此數字**必須同時標明 pattern** —— 兩者差異純為 pattern 寬窄，非 base 漂移。
- 🚫 禁 `as any`／`as AuditSeverity`／`as AuditEventType`／任何 cast（SPEC 核准鎖 2）。

#### 2.4.1 `COLD_CLASS_VERSION` **明確不 bump**（已審視之既有規則，非遺漏）

`functions/api/admin/cron/audit-archive.ts:75-76` 有既有註解：

```ts
// PR 2.0：cold_class 版本固定 1。audit-policy 改動時 bump（design doc v8 cold_class_version）
const COLD_CLASS_VERSION = 1
```

**本棒不 bump，理由三層**：

1. **語意**：該版本號標記的是「產出 `cold_class` 值的 **classifier 世代**」，用途是讓已存 row 能對回當時的分類規則。本棒**分類行為零變更**（byte-identical emit 為機械證明），世代未變。
2. **bump 會造成實害**：該常數會寫進 R2 manifest（`audit-archive.ts:428`）與 `audit_archive_chunks` D1 row（`cron/audit-archive.ts:1041-1045`、`audit-aggregate-archive-runner.ts:582-586`）。
   在 write-once R2 key ＋ retention lock 之下，變更 manifest 內容屬**不可逆**面；並會**假性切分** forensic 資料世代。
3. **會破測**：`tests/audit-archive.test.ts:340` 與 `tests/audit-aggregate-archive.test.ts:231` 皆斷言 `cold_class_version === 1`；
   而這兩檔**不在** allowed changed-files 內 → bump 即 scope creep ＋ gate fail。

⚠ 反向約束：**未來真正改變分類行為的棒次**（例：改某 event 的 category、動 `classifyForCold` 規則）
**必須**重新評估此 bump，🚫 不得援引本節作為「永遠不用 bump」之先例。

## 3. 型別決策（三個 OD 的最終裁決 ＋ SPEC-1）

| 標的 | 裁決 | 依據 | OD |
|---|---|---|---|
| `category` domain union | ✅ **採用** `AuditCategory` | `Object.freeze` 保留字面量型別（實測反證：若 widen 為 `string`，`return category` 對 `AuditColdClass` 必噴 `TS2322`；實測 0 錯） | `OD-C1b` |
| `severity` domain union | ✅ **採用** `AuditSeverity` ＋ 5 處 `as const` | 批 C 記為「現行 scope 內無 union 解」；**本棒實測為恰 5 個 `as const` 即解**，非技術不可行 | `OD-C1a` |
| `eventType` domain union | ❌ **否決**（Tier 0 correctness） | 見 §3.1 | `OD-C1c` |
| `AuditColdClass` 構造 | ❌ 禁 `Exclude<>`，✅ **明列固定六值** | 見 §3.2 | `SPEC-1` |

### 3.1 `OD-C1c` 否決依據（Tier 0，非 scope 便利）

`AuditEventType`（228 字面量 union）**技術上建得起來**，`functions/` 零新錯 —— 🚫 **禁稱「技術上不可行」**。
否決理由是**它會用型別抹掉一條刻意開放的 runtime fail-safe 契約**：

- `classifyAuditEvent()` 對未分類事件回 `null`、`classifyForCold()` 回 `'immutable'`（最長 retention 保險）。
- `safeUserAudit`（`user-audit.ts:71`）**明確設計成**：未分類事件只 `console.warn`，**照常寫入**。
- 收窄後 `if (!category) return 'immutable'` 成為**型別上不可達**（runtime 仍可達）→ 邀請未來重構刪除「死碼」。
- 實測：`tests/audit-policy.test.ts` 的 `436`／`446`／`448` 三行（傳 `'unknown.event'`／`'totally.fake'`／`''`）
  **不是 `as const` 修得掉的**；要讓它們過就得加 `as AuditEventType`，而那正好廢掉被測的東西。

> 未來若 producer 端需要 closed union，應另立 `KnownAuditEventType` 並**限制在 producer-side**；
> 🚫 不得收窄 fail-safe classifier boundary（SPEC 核准鎖 2／3）。

### 3.2 `SPEC-1` 依據：`Exclude<>` 會靜默擴張 cold-class 域

SPEC R1 原採 `Exclude<AuditCategory, typeof AUDIT_CATEGORY.SECURITY_SIGNAL>`。該構造
**只保證「不含 `security_signal`」，不保證「恰六值」**。

**A/B 實測**（同樣加一個第 6 個 category `FORENSIC_HOLD: 'forensic_hold'`）：

| 構造 | `tsc -b solution` 結果 |
|---|---|
| `Exclude<>` | **無任何 `TS2322`**（total `373`）—— 新 category **靜默被吸進** cold-class 域 |
| 明列六值 | **`audit-policy.ts:419: error TS2322`**，正是 `return category` 那行 |

> ⚠ **量測邊界（誠實性）**：本 A/B **只跑 `tsc`，未跑 vitest** —— 🚫 不得敘述為「零測試失敗」。
> 兩臂之 test 檔狀態亦不同，**兩個 total 不可相減**；決定性判別子與完整條件揭露見 §4.1 A/B 附註。

> ⚠ 行號說明：base 的 `return category` 在 `:405`；上述 probe 情境多了 13 行 type alias ＋ 1 行
> `FORENSIC_HOLD` ＝ `:419`。**本棒最終 candidate 無 probe 那行**，同一敘述在 candidate 為 `:418`。
> 兩個行號皆正確、對應不同情境，🚫 不得互相援引為矛盾。

**不變式**：`AuditColdClass` 恰為六值，且 **🚫 永不包含 `security_signal`** ——
`security_signal` 是 *category*，在 cold-class 面必依 severity 分裂為
`security_critical`／`security_warn` 兩值（`classifyForCold` `:401-403`）。

**失敗鏈**（registry 已從 209 長到 228 event，新增 category 是可預期的未來動作）：

1. 未來 PR 加第 6 個 `AUDIT_CATEGORY` → `AuditColdClass` 靜默多一值，**編譯全綠**。
2. `classifyForCold` 回該值 → `safeUserAudit` 寫進 `audit_log.cold_class`（migration `0038`）。
3. 該值不在 `SUPPORTED_COLD_CLASSES`（`audit-archive.ts:51` 凍結六值）→ archive worker
   round-robin **永遠撈不到這些 row**：不進 R2、不從 D1 purge → **靜默 retention／forensic 缺口**。
4. 若有路徑到 `hotRetentionDaysFor()`（`audit-archive.ts:95`），拿 `DEFAULT_HOT_DAYS_BY_CLASS[coldClass] ?? 0`
   → `0`，而 `:79` 註解寫明 `<=0` 被 worker 解讀為「**不設下限，撈所有未 archive row**」
   —— 對一個沒人審過的類別套用最激進設定。

明列六值的成本＝字面量重複一次；換到的是**在正確的那一行**（`return category`）強制作者
面對 cold_class ＋ retention ＋ `SUPPORTED_COLD_CLASSES` 三處對映。**Tier 0 > Tier 1。**

## 4. 證據

> ⚠ **狀態欄為誠實性要求，不得省略**：`MEASURED` ＝ 已於 base／scout 階段實測；
> `PENDING_CODE` ＝ **CODE stage 驗收目標，落盤當下尚未量測**。
> 🚫 **禁**把 `PENDING_CODE` 列敘述為既成證據。

### 4.1 已實測（base／scout 階段，SPEC Gate 前後）

| 項 | 值 | 狀態 |
|---|---|---|
| ratchet（base） | `373 / 14 / 323 / 337`；baseline `1119/175` 凍結、不 `--update` | `MEASURED` |
| base blob `audit-policy.ts` | `7d0b1d371098a71e60ad8af24bc6bfe11bd0cddf` | `MEASURED` |
| base blob `audit-policy.test.ts` | `0490105281bdce4382be3b2469d681580570e043` | `MEASURED` |
| 行尾 base（`tr -cd '\r' \| wc -c`） | `audit-policy.ts` `CR=0`／`audit-policy.test.ts` `CR=452`（＝行數） | `MEASURED` |
| **SPEC-R2 精確組合** `tsc -b solution`（`rm -rf .tscache` 全重建） | **`373`**，逐檔分佈與 base 完全相同 | `MEASURED` |
| **SPEC-R2 精確組合** targeted vitest | `tests/audit-policy.test.ts` **137/137 passed** | `MEASURED` |
| canonical single-file esbuild transform（base） | `audit-policy.ts` `20846` B、sha256 `f18e7f139b5e2269f8927d2c51386bae35c95a1a29ab9c8cb5a459b94091cc15`、stderr `0` | `MEASURED` |
| canonical transform **base↔candidate 這一面**（三面中的第 1 面）× **2 檔** | `audit-policy.ts` `20846` B／`audit-policy.test.ts` `13279` B，`cmp` **byte-identical**、stderr `0`、bytes `>0` 已斷言 | `MEASURED` |
| `OD-C1a` 破壞面 | severity 收窄未配 `as const` → `379`（+6，**全在 test 檔**，`functions/` 零新錯） | `MEASURED` |
| `OD-C1c` 破壞面 | eventType 收窄 → `379`（+6，其中 `436`／`446`／`448` 三行 `as const` 修不掉） | `MEASURED` |
| `SPEC-1` A/B（⚠ 兩臂條件不對稱，見下） | 臂1 `Exclude<>`＋第6類＝**無 `TS2322`**（total `373`）／臂2 明列六值＋第6類＝**`TS2322` @ `:419`**（total `381`） | `MEASURED` |
| 三支 read-only lint（base 基準） | `lint:handlers` OK／`lint:archive-no-delete` ok，6 files clean／`lint:migrations` OK，N=`0056`，4 rules passed | `MEASURED` |

> ⚠ **`SPEC-1` A/B 之條件不對稱（誠實性揭露）**：兩臂的 **test 檔狀態不同** ——
> 臂 1（`Exclude<>`）量測時 test 檔**已套** 5 處 `as const`（故 total `373`）；
> 臂 2（明列六值）量測時 test 檔**在 base、未套** `as const`（故 total `381`
> ＝ `373` ＋ 2 條 `TS2322` ＋ 6 條 as-const-可修的 `TS2345`）。
> **兩個 total 不可直接相減。** 本 A/B 的**決定性判別子**是
> 「`return category` 那行有無 `TS2322`」—— 該訊號只取決於 `AuditColdClass` 的構造，
> 與 test 檔狀態無關（test 檔完全不參與 `functions/` leaf 的該行型別檢查）。
> 🚫 不得以 `373 vs 381` 的差值作為 `SPEC-1` 之論據。

> ⚠ **canonical transform 證據之範圍**：證明型別標註未改變**該 transform 之輸出**，
> 🚫 **不是** production bundle identity；且該 transform **剝除註解**，對「僅改註解」不敏感
> → 須與 §2 hunk allowlist **併用**（兩支柱聯合證明）。

> ⚠ **一次已作廢的假通過（過程誠實性）**：首次 emit 比對誤用 `--loader=ts`（該旗標只對 stdin 有效），
> esbuild 失敗、兩邊輸出皆 `0` bytes、`cmp` 回報 `byte-identical`、sha256 為空字串常數 `e3b0c442…`。
> 該結果**已作廢、未進入任何核准證據**。→ 故 SPEC 核准鎖 7 要求 emit 證據**必須同時**報
> `bytes > 0` 與 `stderr = 0`；本 PLAN 所有 emit 數字皆來自修正後量測。

### 4.2 CODE-stage 驗收目標（**尚未量測**）

| 項 | 目標值 | 狀態 |
|---|---|---|
| 全域 diagnostic multiset vs base | **`REMOVED=0 / ADDED=0`** | `PENDING_CODE` |
| ratchet（after） | **`373 / 14 / 323 / 337`（不變）** | `PENDING_CODE` |
| diffstat `audit-policy.ts` | `+17 / -4`（新增 13 行 ＋ 4 行改寫），`422 → 435` 行 | `PENDING_CODE` |
| diffstat `audit-policy.test.ts` | `+5 / -5`，行數維持 `452` | `PENDING_CODE` |
| 行尾（after） | `audit-policy.ts` `CR=0`／`audit-policy.test.ts` `CR=452` | `PENDING_CODE` |
| candidate blob OID ×2 | pre-commit `git hash-object` ＋ post-commit `git rev-parse HEAD:<path>` **兩時點**（SPEC 核准鎖 8） | `PENDING_CODE` |
| canonical transform **三面**（base／working-tree／committed blob）×2 檔 | 同 bytes、同 sha256、stderr `0`、bytes `>0` | `PENDING_CODE` |
| CI 七道 | `lint`／`typecheck:ratchet`／`verify:browser-pipeline`／`test:cov`／`test:int`／`build:functions`／`npm audit --omit=dev --audit-level=high` 全綠 | `PENDING_CODE` |
| 三支 read-only lint（after） | 與 §4.1 base 基準相同（CI **不跑**這三支，故基準值已先取，轉紅可直接歸因本棒） | `PENDING_CODE` |
| unknown-event fallback ＋ deterministic cases | 在**無任何 event cast** 下可編譯、可執行、全過 | `PENDING_CODE` |

⚠ `4.2` 全部項目於本 doc 落盤當下皆未成立。🚫 取得實測前，**不得**宣稱本棒相容性或型別安全已成立。

### 4.3 ESLint 風險預評（**分析，不是證據**；實跑仍列 §4.2 `PENDING_CODE`）

依 `eslint.config.js` 逐條比對本棒變更面：

| 規則 | 等級 | 對本棒之影響 |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | `error` | 本棒**零** `any`、零 cast → 不觸發 |
| `@typescript-eslint/no-unused-vars` | `warn` | 三個 type alias 皆 `export`，非 unused → 不觸發 |
| `archive-discipline/no-forbidden-r2-or-sql` | `error` | **files 範圍為 `audit-archive*`／`audit-aggregate-archive*`；`audit-policy.ts` 不在其中** → 不適用 |
| `tests/**/*.ts` block（`no-explicit-any` `error`） | `error` | 測試面僅加 `as const`，無 `any` → 不觸發 |
| `consistent-type-definitions` 類規則 | **未啟用** | union type alias 無風格衝突 |

⚠ 上表為**靜態比對之預期**，🚫 **不得**當作 `lint` 已通過之證據；`npm run lint` 實跑結果依 §4.2。

## 5. 消費面

| 消費者 | 用到的 export | 實參靜態型別（base） |
|---|---|---|
| `functions/utils/user-audit.ts:71,83` | `classifyAuditEvent`／`classifyForCold` | `any`（`entry` 為 implicit-any param） |
| `functions/utils/audit-archive.ts:716` | `classifyForCold`（**F-3 受保護檔，僅 import、零修改**） | `any` |
| `functions/utils/audit-aggregate.ts:227` | `classifyForCold` | `any` |
| `functions/utils/audit-aggregate-debug.ts:333` | `classifyForCold` | `any` |
| `tests/audit-policy.test.ts` | **5 個 symbol**：`AUDIT_CATEGORY` ＋ 3 個 function（`classifyAuditEvent`／`classifyForCold`／`listEventsByCategory`）＋ `_registrySize` | `string`（本棒 5 處收成字面量） |
| `tests/integration/session-revoke-multi.test.ts:22` | `_registrySize`（維持 `228`，未改） | — |

**完整性依據**：`grep -rn "audit-policy" functions --include=*.ts` 全命中已逐條檢視 ——
真正 `import` 者恰上表 4 個 production 檔；`functions/utils/billing.ts:13` 與
`functions/api/admin/cron/audit-archive.ts:75,939` **僅在註解提及**、無 import，故不列消費者。
另兩個 F-3 受保護檔（`audit-aggregate-archive.ts`／`-runner.ts`）**無 `audit-policy` import**（已驗）。

**⚠ 這不是相容性證明。** 四個 production call site 目前傳 `any`，所以本棒**不會立即**暴露 cascade。
待 D／E／B-read／F／G 把 D1 row 標型後，`row.severity` 會是 `string`，屆時**必須在資料進入
application logic 的邊界以 runtime guard／parser 窄化為 `AuditSeverity`**，
🚫 **不得用 assertion 消音**（SPEC「後續棒次責任」）。本 PLAN 顯式承認此為**已知後果、非本棒留坑**。

## 6. F-3 隔離

```text
F3_POSTURE           = DORMANT_WAIT_ONLY
F3_FILE_EDIT_POLICY  = CONDITIONAL_ACTIVE
F3_FILE_EDIT_TRIGGER = NOT_TRIGGERED      # 本棒零修改受保護三檔
```

**受保護三檔**（權威定義：closeout doc `stage7-pr2dw-closeout-…md` §8.1）：

| 受保護檔 | 與本棒之關係 | 本棒動作 |
|---|---|---|
| `functions/utils/audit-archive.ts` | `classifyForCold` 之 import 端（`:716`）；亦持 `SUPPORTED_COLD_CLASSES`／`DEFAULT_HOT_DAYS_BY_CLASS` | **零修改** |
| `functions/utils/audit-aggregate-archive.ts` | 無 `audit-policy` import | **零修改** |
| `functions/utils/audit-aggregate-archive-runner.ts` | 無 `audit-policy` import | **零修改** |

三檔皆**不在** allowed changed-files（§2）內，故 `F3_FILE_EDIT_TRIGGER` 維持 `NOT_TRIGGERED`。
⚠ §3.2 雖**引用** `audit-archive.ts` 的 `:51`／`:64`／`:95` 作為 `SPEC-1` 論據，
但那是**唯讀引用**，🚫 不構成修改、🚫 不觸發 `F3_FILE_EDIT_TRIGGER`。
`tests/audit-archive-forensic-classify-parity.test.ts` 鎖的是 R2 key derivation
（把 `cold_class` 當**輸入欄位**讀），**不呼叫 `classifyForCold`** → 與本棒耦合度為零；
該測試為 **`SUPPLEMENTAL ONLY`**：可跑，但 🚫 不列 Required gate、🚫 不改變 `F3_FILE_EDIT_TRIGGER`、
🚫 不構成「F-3 已驗證」之依據。

## 7. 宣稱用語紀律 ＋ 判級條件

- ✅ 可宣稱：「批 C2 為 `audit-policy.ts` 建立 compile-time 型別脊椎（3 type alias ＋ typed REGISTRY ＋ 3 具名回傳型別 ＋ severity 收窄）」
- ❌ 禁宣稱：「audit 域型別安全」／「audit-policy 已完整標型」／「F-3 已驗證」／「production bundle identity」
- ❌ **禁宣稱「無新 export」** —— 本棒新增**三個 compile-time exports**（`AuditCategory`／`AuditSeverity`／`AuditColdClass`）。
  正確表述：**無新 runtime export、零 runtime 行為變更；但 public type surface 確有新增**。
- ❌ 禁宣稱本棒推進 ratchet —— 本棒 `REMOVED=0`，ratchet **刻意不變**。

**`L1_CONDITIONAL` 判級條件（SPEC 核准鎖 6）**：

> `L1` 成立的**必要前提**，是 production source 與五處 `as const` 測試變更在
> **base／candidate／committed blob 三面**皆維持 byte-identical TypeScript emit。
> 任一 emit identity 失敗 ＝「純 type-only」前提不成立 → **立即停止**，
> 🚫 不得只記為普通 gate fail，須**撤銷 L1 判級並回 Plan Gate** 重新分級與收斂。

（以上為 owner 核准鎖 6 之引用，**未經改寫**。）

⚠ **命名對齊（本 doc 之註，非 lock 內容）**：SPEC 核准鎖 6 稱「base／candidate」、
核准鎖 7 稱「base／working-tree」—— **兩者為同一組三面**（`candidate` ＝ 落盤前之 working-tree 內容）。
本 doc §4.2 用「base／working-tree／committed blob」，與此處等義，🚫 不得解讀為兩套不同要求。

同理：實測 `ADDED≠0`、ratchet 漂移、需要修改 caller、出現任何 cast、baseline update、
registry size／value 變動、或 base 漂移 → 一律停手回 Plan Gate。

## 8. 後續變更鎖與未結項

### 8.1 cold-class 變更鎖（SPEC 核准鎖 11，本棒起生效）

> 任何 `AuditColdClass` 的**增／刪／改名**，必須在**同一個經核准 scope** 內同步審查：
> `classifyForCold` · `SUPPORTED_COLD_CLASSES`（`audit-archive.ts:51`）·
> `DEFAULT_HOT_DAYS_BY_CLASS`（`:64`）· env retention key（`AUDIT_ARCHIVE_HOT_DAYS_*`）·
> worker／tests · retention 文件。
> **只補 union 讓編譯通過，不構成完整修復。**

### 8.2 未結項

| 項 | 狀態 |
|---|---|
| D1 邊界 `severity` runtime 窄化 | → 批 **D／E／B-read／F／G**（見 §5；不得用 assertion 消音） |
| L-1：`AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN` 未宣告於 `env.d.ts` | → 批 **L**／**`H0b`**（`OR-3`：不得夾帶進批 H0）。**本棒零交集** |
| repo-local TypeScript governance manifest 仍缺 | `TS-TYPE-001`／`TS-STATE-001`／`GOV-DRIFT-001`／`GOV-DECISION-001`／`GOV-EVIDENCE-001` 維持 `advisory / not enforced`；本棒以 live evidence 手動閉合。🚫 未授權於本 PR 夾帶修復 |

## 9. Gate 軌跡

| 階段 | 狀態 |
|---|---|
| SPEC | `SPEC_APPROVED` @ R2（`0 Blocking / 0 Required / 0 Non-blocking`；判級 `L1_CONDITIONAL`；`CODING_ALLOWED` 未核發。R1 → Claude 提 `SPEC-1` blocking → R2 以明列六值 union 關閉） |
| ① ChatGPT Architecture | `PENDING` |
| ② Codex Plan | `PENDING` |
| ③ Codex Code | 核發後以 **docs-only commit append 於 `## 10`**（本表不回填） |
| ④ ChatGPT Faithfulness | 🚫 **本 PR 內不記錄** —— 見下方「④ 自我收據悖論」 |

> **①② 的錨定機制（避免與 ④ 相同的悖論）**：①② 審的是**本 plan doc 的文字**，
> 故其 verdict **錨定「PLAN 第 N 輪的 sha256 ＋ byte 數」，不錨定 git commit**。
> 受審文字凍結後，僅 `## 9` 表的 ①② 兩個儲存格為可變面（carve-out），
> 填值後須能機械證明**差集恰為那兩列**（批 C 先例：`134,135c134,135`）。
>
> ⚠ **①② vs ③ vs ④ 三段處置刻意不同**：
> - **①②** 於 `CODING_ALLOWED` **之前**核發，且錨定 PLAN 文字 sha256 → 可直接填入本表。
> - **③** 於落盤後核發，可於 **④ 之前**以 docs-only commit append 於 `## 10` —— 該 append 本身仍會被 ④ 覆核，無悖論。
> - **④** 🚫 **禁在本 PR 自我追加**。
>
> ### ⚠ ④ 自我收據悖論
>
> ④ 的審查標的是**某個確定的 commit**。若在 ④ 核發後把 ④ receipt append 進本檔，
> 該寫入**必然產生新 commit**，使 HEAD **移離 ④ 所審之 anchor** ——
> 「④ 已核准的樹」與「實際 merge 的樹」不再是同一個，receipt 自身證偽了它所宣稱的事。
>
> **處置（三選一，由 owner 於 ④ 核發時指定）**：
> 1. ④ receipt 存 **repo-external packet**（`~/Desktop/chiyigo-packets/`），本 PR 不動；
> 2. ④ verdict 僅記於 **squash commit body**（merge metadata，非本檔）；
> 3. merge 後另走 **docs-only closeout PR**（走完整四道）。
>
> 🚫 本表 ③④ 兩列**永不編輯**。

> **closeout 適用性**：本 plan doc 自 SPEC 起即在 allowed changed-files 內（2026-07-18 amendment
> 規則 1），故與批 C 同型 —— **merge 即 `CLOSED`、無需 closeout PR**（批 A 需 #150 是因其 ARCH lock
> 把 scope 凍在「恰 2 檔 2 行」使 plan doc 進不了 PR）。

> **gate packet 紀律**（批 C ④ R1 教訓）：外部 gate 送審包**一律走檔案**
> （`~/Desktop/chiyigo-packets/`）、🚫 **禁貼聊天正文**（曾遭字元級截斷 4 行而假性 reject）；
> packet 須**自帶 sha256**，使收方能分辨「傳輸損毀」vs「內容問題」。

---

## 10. ③ Codex Code Gate receipt（append-only）

> 🔒 本節於 ③ 核發後以 **docs-only commit** append，依 `## 9` 分層規則：
> **append-only、🚫 不回改既有內容、🚫 不編輯 `## 9` 表之任何列**。
> 本節仍寫於 ④ 之前，**會被 ④ 覆核**，故無自我收據悖論。
> 🚫 **④ receipt 不在本檔記錄** —— 處置由 owner 於 ④ 核發時依 `## 9` 三選一指定。

_（待 ③ 核發後 append）_
