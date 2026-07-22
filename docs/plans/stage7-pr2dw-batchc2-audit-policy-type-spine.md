
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

⚠ **本節只修正了 PLAN 層的認知，source 端 local comment 仍是舊的較寬判準** ——
該 cognition–artifact drift 之追蹤項與 closure condition 見 **§8.3**（`GPT-C2-ARCH-RR2`）。

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

**兩次 probe observation**（`GPT-C2-ARCH-NB1`：**刻意不稱「受控 A/B」**，見下方量測邊界）
—— 兩次皆加同一個第 6 個 category `FORENSIC_HOLD: 'forensic_hold'`：

| probe | 構造 | `tsc -b solution` 之**判別子** |
|---|---|---|
| P-1 | `Exclude<>` | **無任何 `TS2322`** —— 新 category **靜默被吸進** cold-class 域 |
| P-2 | 明列六值 | **`audit-policy.ts:419: error TS2322`**，正是 `return category` 那行 |

> ⚠ **量測邊界（誠實性，`NB1`）**：
> 1. 兩次 probe **只跑 `tsc`、未跑 vitest** —— 🚫 不得敘述為「零測試失敗」。
> 2. 兩次的 **test 檔狀態不同**（P-1 已套 5 處 `as const`、P-2 未套），故**不是完全受控的 A/B**、
>    **兩個 total 不可相減**（完整條件揭露見 §4.1）。
> 3. 有效的論據**僅限**「該 production 行的 `TS2322` **有／無**」——
>    ① 已裁決此判別方向成立：該行是否報錯由 `AuditCategory`／`AuditColdClass`／
>    function body 控制流窄化決定，**與另一檔 test 是否加 `as const` 無關**。
>
> **可選強化**：若 owner 要求，CODE stage 可在**相同 test working tree** 下重跑兩臂，
> 把本節升格為受控 A/B。本棒不將其列為 Required（① 判定 `NB1` 不影響 `SPEC-1` 架構裁決）。

> ⚠ 行號說明（**僅適用 P-2**；P-1 未報錯故無行號）：base 的 `return category` 在 `:405`；
> P-2 情境多了 13 行 type alias ＋ 1 行 `FORENSIC_HOLD` ＝ `:419`。
> **本棒最終 candidate 無 `FORENSIC_HOLD` 那行**，同一敘述在 candidate 為 `:418`。
> 三個行號（`405`／`418`／`419`）各自對應不同情境、皆正確，🚫 不得互相援引為矛盾。

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
| `SPEC-1` **兩次 probe observation**（⚠ 非受控 A/B，見下） | P-1 `Exclude<>`＋第6類＝**無 `TS2322`**（total `373`）／P-2 明列六值＋第6類＝**`TS2322` @ `:419`**（total `381`） | `MEASURED` |
| 三支 read-only lint（base 基準） | `lint:handlers` OK／`lint:archive-no-delete` ok，6 files clean／`lint:migrations` OK，N=`0056`，4 rules passed | `MEASURED` |

> ⚠ **`SPEC-1` 兩次 probe 之條件不對稱（誠實性揭露，`GPT-C2-ARCH-NB1`）**：兩次的 **test 檔狀態不同** ——
> P-1（`Exclude<>`）量測時 test 檔**已套** 5 處 `as const`（故 total `373`）；
> P-2（明列六值）量測時 test 檔**在 base、未套** `as const`（故 total `381`
> ＝ `373` ＋ 2 條 `TS2322` ＋ 6 條 as-const-可修的 `TS2345`）。
> **兩個 total 不可直接相減；本組觀察不得稱為受控 A/B。** 其**決定性判別子**是
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
| **targeted vitest（`GPT-C2-ARCH-RR5`）** | `npx vitest run tests/audit-policy.test.ts` → 預期 **137/137 passed**。**至少須在 committed source 上執行並記錄**（🚫 不得只靠 `test:cov` 全域數字稀釋掉本檔的直接回歸訊號） | `PENDING_CODE` |
| unknown-event fallback ＋ deterministic cases | 在**無任何 event cast** 下可編譯、可執行、全過（涵蓋於上一列之 137/137，另須逐項點名確認） | `PENDING_CODE` |

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
此為**已知後果、非本棒留坑**；其收斂規格見 §5.1。

### 5.1 `severity` runtime 窄化：唯一 canonical parser（`GPT-C2-ARCH-RR3`）

**分層契約**（① 已批准之方向）：

```text
D1 row / 外部輸入
    severity: string            ← untrusted raw boundary，維持 string，不標 AuditSeverity
           │
           ▼
    canonical parser（唯一）
           │
           ▼
    severity: AuditSeverity     ← validated application domain
           │
           ▼
    classifyForCold(eventType, severity)
```

**規格（對後續棒次具約束力）**：

| 項 | 規定 |
|---|---|
| **唯一性** | 全 repo **恰一個** severity parser／guard。後續棒次一律 **import 重用**，🚫 禁各自重寫 inline guard |
| **建議 home** | `functions/utils/audit-policy.ts`（與 `AuditSeverity` 同源、四個消費者本就 import 此檔）。最終位置由該棒次自己的 Plan Gate 定案 |
| **owner 棒次** | **依凍結定序，第一個 scope 含下列任一檔的已核准棒次**：`functions/utils/user-audit.ts` · `functions/utils/audit-archive.ts`〔**⚠ F-3 受保護檔**〕· `functions/utils/audit-aggregate.ts` · `functions/utils/audit-aggregate-debug.ts`。該棒次**必須**在同一 scope 內建立 parser，🚫 不得只標型而把 parser 推給下一棒 |
| ⚠ F-3 交互作用 | 四檔之一（`audit-archive.ts`）為 **F-3 受保護三檔**成員。若 owner 棒次正是觸碰該檔者，將**同時觸發** `F3_FILE_EDIT_TRIGGER`，須依 `F3_FILE_EDIT_POLICY`（`CONDITIONAL_ACTIVE`）之驗證規則辦理。該棒次 SPEC 須顯式處理，🚫 不得因「只是加型別」而略過 |
| **raw 欄位** | D1 row 的 `severity` 欄**維持 `string`**；🚫 不得直接把 row 型別宣告成 `AuditSeverity` 來規避驗證 |
| **非法值：禁止** | 🚫 assertion 消音（`as AuditSeverity`）· 🚫 靜默丟棄 row · 🚫 降低 retention |
| **非法值：必須** | 保留現行 fail-safe 行為 ＋ 產生**結構化 log／可觀測訊號**（不得靜默吞掉） |

> **⚠ 給 owner 棒次的具體風險（本棒實測發現，非 ① 要求，但屬同一條 RR3）**：
> 現行 write path（`user-audit.ts:74`）對未知 severity 的行為是 **coerce 成 `'info'`**。
>
> **前提條件（誠實界定，避免高估此風險）**：凡經 `safeUserAudit` 寫入的 row，
> 其 `severity` 在**寫入時即已**被收斂為三個已知值之一 → 正常路徑下 D1 不會有非法 severity。
> 本風險的實際觸發面僅限：**(a)** 該 coercion 存在前寫入的歷史 row · **(b)** 繞過
> `safeUserAudit` 的直接 DB 寫入 · **(c)** migration／backfill 產生的值。
> 🚫 不得把本風險敘述為「常態路徑」；但也**不得因罕見而不設計** —— 這正是 archive／retention
> 這種一次錯就不可逆的面必須 fail-safe 的理由。
>
> **風險本體**：把同一套 coercion 直接搬到 **read／classification path 並不自動 retention-safe** ——
> 未知 severity 若 coerce 成 `'info'`，一個 `security_signal` 事件會得到 `security_warn` 而非 `security_critical`；
> 兩者在 `DEFAULT_HOT_DAYS_BY_CLASS` 雖同為 `180`，但
> `AUDIT_ARCHIVE_HOT_DAYS_SECURITY_WARN` 與 `_SECURITY_CRITICAL` 是**各自獨立可設的 env key**
> （`audit-archive.ts:89` 動態組 key），ops 一旦把 warn 調短，該 coercion 即構成**實質 retention 降級**。
> → 該棒次的規則應是「**非法 severity 解析為該 category 下 retention 最長的結果**」，
> 而非無條件 `'info'`。此為該棒次 Plan Gate 之待決項，本棒僅記錄約束。

> **⚠ 未決（需 owner 於 ① R2 或該棒次 SPEC 確認）**：本棒**無法從 repo 內容**判定
> 上述 owner 棒次對應 16 單元中的哪一個字母 —— 各單元的檔案對映定義在批 A 的
> gate packet（`02-codex-plan-…batchA.md`）內，不在 repo。
> 故本節以**功能判準**（scope 含四個消費檔之任一）鎖定 owner，該判準對凍結定序是確定的；
> 🚫 但本棒**不猜**字母，避免無根據地指定「批 D」。

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

### 8.1 cold-class 變更鎖（SPEC 核准鎖 11）

**生效範圍（`GPT-C2-ARCH-RR4`）**：本鎖**自本棒 merge 後、對後續變更生效**。
**本棒依已核准 SPEC 建立該 union 之初始六值，不在本鎖的觸發集合內** ——
否則依字面集合，本棒自身即會被要求同步修改 F-3 受保護檔，與 §2 的三檔 allowlist 直接矛盾。

> 自本棒 merge 後，任何 `AuditColdClass` 的**增／刪／改名**，必須在**同一個經核准 scope** 內同步審查：
> `classifyForCold` · `SUPPORTED_COLD_CLASSES`（`audit-archive.ts:51`）·
> `DEFAULT_HOT_DAYS_BY_CLASS`（`:64`）· env retention key（`AUDIT_ARCHIVE_HOT_DAYS_*`）·
> worker／tests · retention 文件。
> **只補 union 讓編譯通過，不構成完整修復。**

### 8.2 未結項

| 項 | 狀態 |
|---|---|
| D1 邊界 `severity` runtime 窄化 | → 見 §5.1（唯一 canonical parser，`GPT-C2-ARCH-RR3`） |
| **`COLD_CLASS_VERSION` local-comment drift**（`GPT-C2-ARCH-RR2`） | 見 §8.3 |
| L-1：`AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN` 未宣告於 `env.d.ts` | → 批 **L**／**`H0b`**（`OR-3`：不得夾帶進批 H0）。**本棒零交集** |
| repo-local TypeScript governance manifest 仍缺 | `TS-TYPE-001`／`TS-STATE-001`／`GOV-DRIFT-001`／`GOV-DECISION-001`／`GOV-EVIDENCE-001` 維持 `advisory / not enforced`；本棒以 live evidence 手動閉合。🚫 未授權於本 PR 夾帶修復 |

### 8.3 `COLD_CLASS_VERSION` local-comment drift 追蹤項（`GPT-C2-ARCH-RR2`）

**問題**：§2.4.1 已在 PLAN 層把判準收斂為「**runtime cold-class classification semantics 改變時**才 bump」，
但 source 端的 local comment 仍寫較寬的「audit-policy 改動時 bump」。
只看 local comment 的未來維護者仍會套用舊判準 ＝ **cognition–artifact drift**。

**⚠ 事實更正（`RR2` 敘述之精確化，經 live grep 查證）**：

| gate 敘述 | 實測 |
|---|---|
| 「受保護 source comment」 | 該 comment 位於 **`functions/api/admin/cron/audit-archive.ts:75`**，此檔**不是** F-3 受保護三檔之一（三檔見 §6）。它屬 archive worker codepath，且在 `archive-discipline` ESLint files 範圍內 |
| —— | **另一處** `COLD_CLASS_VERSION = 1` 在 `functions/utils/audit-aggregate-archive-runner.ts:75`（**是**受保護檔），但該處**無**任何 bump 註解 |

→ 故 closure condition 須綁**該 comment 實際所在檔**，而非「受保護檔」。

**追蹤項（本棒不執行，🚫 不得夾帶）**：

| 欄位 | 內容 |
|---|---|
| 標的 | `functions/api/admin/cron/audit-archive.ts:75` 之 comment |
| 目標措辭 | 由「audit-policy 改動時 bump」→「**runtime cold-class classification semantics 改變時** bump」 |
| **closure condition** | **第一個合法觸碰 `functions/api/admin/cron/audit-archive.ts` 的已核准棒次**，須在該棒 scope 內一併修正此 comment；若至 audit 域 16 單元全部完成仍未觸碰該檔，則**另立 docs/comment-only 棒次**收尾，不得無限延宕 |
| closure 可達性 | ✅ **必然可達**：該檔於 base 仍有 **73 條** `noImplicitAny` 診斷（14 個殘餘錯誤檔中第 2 大），故 audit 域收尾前**必有**棒次觸碰它 → fallback 分支實務上不會觸發 |
| 效力界定 | §2.4.1 **僅**構成 C2 這種 **type-only、byte-identical emit** 變更的例外；🚫 **不是**「audit-policy 改動一律不 bump」的永久先例 |

**順帶觀察（out-of-scope，🚫 本棒不修）**：`COLD_CLASS_VERSION` 在兩個檔各自獨立宣告
（`cron/audit-archive.ts:76`、`audit-aggregate-archive-runner.ts:75`），**非共用常數** ——
本身即為潛在 drift 面（兩者可能被改成不同值）。記錄備查，不在本棒處理。

## 9. Gate 軌跡

| 階段 | 狀態 |
|---|---|
| SPEC | `SPEC_APPROVED` @ R2（`0 Blocking / 0 Required / 0 Non-blocking`；判級 `L1_CONDITIONAL`；`CODING_ALLOWED` 未核發。R1 → Claude 提 `SPEC-1` blocking → R2 以明列六值 union 關閉） |
| ① ChatGPT Architecture | **R1 ＝ `CHATGPT_ARCH_CHANGES_REQUESTED`**（0 Blocking／**5 Required**／1 Non-blocking；錨定 PLAN R1 sha256 `25d7c9cf…d88d`、`27044` bytes、LF）→ **R2 送審中**。R1 五項：`RR1` carve-out 分階段＋tree identity／`RR2` `COLD_CLASS_VERSION` comment drift 追蹤／`RR3` 單一 severity parser owner＋非法值 fail-safe／`RR4` §8.1 改為 merge 後生效／`RR5` targeted 137/137。已批准方向 carry forward、不重開 |
| ② Codex Plan | `PENDING`（① 未 approve 前不送） |
| ③ Codex Code | 核發後以 **docs-only commit append 於 `## 10`**（本表不回填） |
| ④ ChatGPT Faithfulness | 🚫 **本 PR 內不記錄** —— 見下方「④ 自我收據悖論」 |

> **①② 的錨定機制（避免與 ④ 相同的悖論）**：①② 審的是**本 plan doc 的文字**，
> 故其 verdict **錨定「PLAN 第 N 輪的 sha256 ＋ byte 數」，不錨定 git commit**。
>
> ### 分階段 carve-out 定義（`GPT-C2-ARCH-RR1`）
>
> 舊敘述「凍結後僅 ①② 兩格可變」與 §10 允許 ③ 後 append receipt **互斥**。
> 正確定義為**兩個依序開啟、互不重疊的 carve-out 窗口**：
>
> | 窗口 | 開啟時點 | 可變面 | 證明義務 |
> |---|---|---|---|
> | **W-1** | ①② 核發後（仍在 `CODING_ALLOWED` 之前） | **僅** `## 9` 表的 ①② 兩個儲存格 | 對凍結文字之差集**恰為那兩列**（批 C 先例：`134,135c134,135`） |
> | **W-2** | **CODE stage 之後**、③ 核發後 | **僅** `## 10` 之 **append** | append-only；`## 9` 表與 W-1 之外的既有內容**0 byte 變動** |
>
> W-1 關閉後才開 W-2；**兩窗口不同時開啟**，故 ③ receipt 的 append **不使 ①② 失效**
> （①② 錨定的是 PLAN 文字，其 sha256 之變動已由 W-2 的 append-only ＋ 凍結區 0-byte 證明界定）。
>
> **`## 10` receipt 之性質硬約束**：**evidence-only · non-normative · append-only**。
> 🚫 receipt **不得**新增任何需求、scope、實作指示或約束；它只記錄「③ 量到什麼」。
> 若 ③ 產生新要求 → 走 gate 回路（修 PLAN → 重審），🚫 不得寫進 receipt 夾帶。
>
> ### ④ reviewed tree ≡ final squash tree（`GPT-C2-ARCH-RR1`）
>
> merge 前**必須**機械驗證：
>
> ```
> ④ reviewed_commit^{tree}  ==  final_squash_commit^{tree}
> ```
>
> 不相等 → **`CHATGPT_CODE_FAITHFULNESS_APPROVED` 立即失效**，須回 ④ 重審；
> 🚫 不得以「只差 receipt／只差 commit message」為由放行。
>
> **本要求與「④ 自我收據悖論」是同一件事的兩種表述**（形式化後即可機械檢查）：
> 若把 ④ receipt append 進本檔，必然產生 ④ 之後的新 commit → tree 改變 →
> `reviewed_commit^{tree} != final_squash_commit^{tree}` → 依本規則 ④ **當場失效**。
> 故下方「三選一」處置中，**選項 1／2 是唯一能同時滿足 tree identity 的**；
> 選項 3（merge 後另立 closeout PR）亦滿足，因該 PR 在 merge **之後**、不改本次 squash 的 tree。
>
> **序列不變式**：`code commit → ③ → W-2 append → ④ 審此 commit → squash`。
> ④ 之後 **🚫 禁止任何 commit**（含 receipt、typo 修正、rebase）；需要改 → 回 ④ 重審。
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
>
> ⚠ 與上方「三選一」之關係：因軌跡已在 repo 內，**選項 3 並非保存軌跡所必需**；
> 預期走**選項 1 或 2**。選項 3 仍保留為 owner 可選項，🚫 但不得被解讀為本棒的預設義務。

> **gate packet 紀律**（累積兩棒之傳輸層教訓）：外部 gate 送審包**一律走檔案**
> （`~/Desktop/chiyigo-packets/`）、🚫 **禁貼聊天正文**（批 C ④ R1：曾遭字元級截斷 4 行而假性 reject）；
> packet 須**自帶 sha256 ＋ byte 數 ＋ 行尾標記**，使收方能分辨「傳輸損毀」vs「內容問題」。
>
> **⚠ 本棒 ① R1 新增之教訓（行尾正規化）**：上傳通道把 canonical **LF** 檔轉成 **CRLF**，
> 收方需先 `CRLF → LF` 正規化才命中 `27044` bytes／`25d7c9cf…` 指紋。
> → 送審包**必須顯式聲明 canonical 行尾**，且指紋一律以 **LF 正規化後**之客體為準；
> 🚫 收方不得因未正規化的 byte 數不符就判定內容漂移。
> （兩棒兩次傳輸層事故 —— 截斷、行尾轉換 —— 皆非內容缺陷；此欄位存在的目的就是把兩者分開。）

---

## 10. ③ Codex Code Gate receipt（append-only）

> 🔒 本節 ＝ `## 9` 定義之 **carve-out 窗口 W-2**，於 ③ 核發後以 **docs-only commit** append：
> **append-only、🚫 不回改既有內容、🚫 不編輯 `## 9` 表之任何列**、`## 9` 與 W-1 之外的既有內容 **0 byte 變動**。
>
> **性質硬約束（`GPT-C2-ARCH-RR1`）**：本節為 **evidence-only · non-normative**。
> 🚫 **不得**新增任何需求、scope、實作指示或約束 —— 只記錄「③ 量到什麼」。
> 若 ③ 產生新要求 → 走 gate 回路（修 PLAN → 重審），🚫 不得寫進 receipt 夾帶。
> 本節仍寫於 ④ 之前，**會被 ④ 覆核**，故無自我收據悖論。
> 🚫 **④ receipt 不在本檔記錄** —— 處置由 owner 於 ④ 核發時依 `## 9` 三選一指定。

_（待 ③ 核發後 append）_
