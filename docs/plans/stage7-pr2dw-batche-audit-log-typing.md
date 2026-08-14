# Stage 7 · PR-2dw 批 E — `functions/utils/audit-log.ts` noImplicitAny 10 → 0

> **狀態**：`PLAN_SELF_REVIEW_CLEAN`（Dual Gate v3.1；四道外部審查全走）
> ⚠ 此 state 僅表示**維度 A 自審**已達「一輪 0 新發現」（§15，R1→R17）；
> 🚫 **不是** gate 通過。**gate 狀態的唯一 SoT ＝ §14 裁決 ledger**；
> 🚫 本行（及本檔其他任何章節）**不複述** gate 當前狀態（`ARCH-E-R3-RR1`）。
> **級別**：實作 L1 ／ 審查 care L2（沿 PR-2ce 先例；⚠ 任一 gate 得挑戰，疑義一律 fail-safe 升級）
> **維度 A self-review 形式**：**單 agent 對抗式**（owner 2026-08-13 當輪裁定；非 workflow）
> **base commit**：`0a6593f637b902e389d50e30415537c22226b9d0`（main）
> **base blob**（`functions/utils/audit-log.ts`）：`0894b592c580ad77077b19047fb34fb3db12ab2a`

---

## 1. 目的

把 `functions/utils/audit-log.ts` 的 **10 條 `noImplicitAny` 診斷（全為 TS7006）清為 0**，
使該檔進入 ratchet 的 clean set。

**性質＝純 type-only、零 runtime delta**（§6 有 byte-identical emit 證明 ＋ 負向控制）。
🚫 本棒**不**修改任何行為、不動 schema、不動 migration、不動測試、不動 caller。

---

## 2. 定序位置

audit 域是 `noImplicitAny` 的**最後殘域**。定序（owner 定，producer-first ＋ destructive-last）：

```
A✅ → C✅ → C2✅ → D✅ → 【E ← 本棒】 → B-read → F → G → H0 → H1 → I → K → L → B-delete → J1 → J2
```

### 2.1 ⚠ 字母 → 檔案對映之地位（誠實聲明）

16 單元的「字母 → 檔案」對映**從未落成 repo artifact**。
依據＝ 2026-08-12 之窮盡搜尋（範圍：`~/Desktop/chiyigo-packets/` · repo `docs/plans/*.md` ·
repo git 歷史 · session transcript），結論為「對映從未落成 artifact」。
⚠ 該次搜尋的逐項檔數本棒**未重新驗證**，故此處只引用其**結論**、不複述其計數。
批 C2 ① R2 已裁定：**「在字母對映證據不在 repo 的情況下猜字母，反而是不合格治理」**。

故本棒的 scope **不是**由我推定字母得出，而是 **owner 於 SPEC 階段當輪裁定**（§3）。
本文件之後，「批 E ＝ `functions/utils/audit-log.ts`」這一組對映**首次成為 repo 內 artifact**。

🚫 本節**不**裁定其他 15 個單元的對映。
⚠ 精確表述：部分單元**有**強／中強度的關聯證據（如 `H0`↔`types/env.d.ts`、`H1/I/L`↔F-3 三檔、
`L`↔`AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN`），但**皆未經 owner 裁定落成 artifact**；
其餘（`F` `G` `K` `B-read` `B-delete` `J1` `J2`）則零關聯證據。
🚫 兩者都**不得**被當成已定案對映引用。

---

## 3. Owner 裁決紀錄（可追溯）

| 編號 | 事項 | 裁定 | 時點 |
|---|---|---|---|
| `SPEC-E1` | 批 E scope | **`functions/utils/audit-log.ts` 單檔**（候選另有 aggregate 家族 4 檔／aggregate utils 2 檔／唯讀 admin 端點 2 檔，均落選） | 2026-08-13 |
| `SPEC-E2` | 維度 A self-review 形式 | **單 agent 對抗式**（同批 D；非 multi-agent workflow） | 2026-08-13 |
| `E-OD-1` | `AuditLogEntry.admin_email` 型別 | **`unknown`**（否決「`string` ＋ 同棒硬化 caller」路徑；否決「不標 `entry`、留 2 條」）。⚠ 該路徑的真實規模見 §10.1（**今日下界 9 呼叫點／8 檔**），🚫 勿沿用選項標籤上的概數 | 2026-08-13 |

`E-OD-1` 之量測依據與代價見 §4.3 與 §10.1。

---

## 4. 設計

### 4.1 新增型別宣告（module-local，🚫 不 export）

```ts
interface AuditLogEntry {
  admin_id: number
  admin_email: unknown
  action: string
  target_id: number
  target_email: string
  ip_address?: string | null
}

type AuditLogRow = AuditLogEntry & { created_at: string }

type ErrorLike = { message?: unknown; cause?: { message?: unknown } }
```

**為何 module-local 不 export**：目前無跨檔 consumer 需要它（9 個 production caller 皆傳
object literal，不引用具名型別）。沿 PR-2do／PR-2dq「zero export 優先、最小公開面」慣例。
⚠ 此為**本棒**之選擇；後續棒次若真有跨檔需求，得另行決定是否提升為 export。

**為何 `AuditLogRow` 用交集而非重寫欄位**：`row` 就是 `entry` ＋ 落庫時間戳，
交集型別讓兩者的欄位定義只有**一處** SoT，避免兩份清單漂移。

⚠ **此 SoT 的範圍限定（`ARCH-E-R1-RR3` caveat）**：它是**這兩個 TypeScript 宣告之間**的
單一來源，🚫 **不是** `admin_audit_log` 資料表結構的 SoT、🚫 不等同 DB schema truth。
DB 的 nullability 與型別（如 `admin_email TEXT NOT NULL`）不因本宣告獲得任何 TypeScript 保證。

**落點（gate ③ 可逐字核對）**：三個宣告插在 `const GENESIS_HASH = '0'.repeat(64)` 之後、
`// ── 雜湊工具 ──` 分隔線之前。🚫 不動既有任何一行的相對順序。

### 4.2 十處標註（逐條對應 base 診斷）

母體＝base（`0a6593f6`）`tsc -b tsconfig.solution.json --force` 對本檔的**全部** 10 條診斷，
全為 `TS7006`。10/10 逐條有對應標註、無遺漏、無額外：

| # | base `line,col` | 函式 | 參數 | 標註 |
|---|---|---|---|---|
| 1 | `23,26` | `sha256Hex` | `text` | `text: string` |
| 2 | `31,23` | `canonicalize` | `row` | `row: AuditLogRow` |
| 3 | `44,31` | `computeRowHash` | `prevHash` | `prevHash: string` |
| 4 | `44,41` | `computeRowHash` | `row` | `row: AuditLogRow` |
| 5 | `60,45` | `prepareAppendAuditLog` | `db` | `db: Env['chiyigo_db']` |
| 6 | `60,49` | `prepareAppendAuditLog` | `entry` | `entry: AuditLogEntry` |
| 7 | `106,38` | `appendAuditLog` | `db` | `db: Env['chiyigo_db']` |
| 8 | `106,42` | `appendAuditLog` | `entry` | `entry: AuditLogEntry` |
| 9 | `132,39` | `isUniquePrevHashError` | `err` | `err: unknown`（見 §4.4） |
| 10 | `143,40` | `verifyAuditChain` | `db` | `db: Env['chiyigo_db']` |

**`db` 為何是 `Env['chiyigo_db']` 而非 `D1Database`**：本 repo **未安裝 `@cloudflare/workers-types`**
（`package.json` devDependencies 實測無此項），裸 `D1Database` 在 source `.ts` 不可解析
（TS2552 ＋ eslint `no-undef`）；`Env['chiyigo_db']` 是已註冊全域 `Env` 的 indexed access。
此為既定慣例（`rate-limit.ts` / `ai/assist.ts` PR-2cd `OD-1` / `brute-force.ts` PR-2ce），
本棒沿用以維持命名 SSOT，🚫 不新創寫法。

⚠ **連帶效果（誠實記錄）**：因 `D1Database` 在本 repo 解析為 `any`，`db` 標註後
檔內所有 D1 row 讀取（`lastRow?.row_hash`／`results`／`row.id`／`row.prev_hash`…）
**仍為 `any`、不獲型別保護**。本標註的收益是消除 `noImplicitAny` 診斷與標示參數契約，
🚫 **不得**宣稱「D1 row 已型別化」。

### 4.3 `E-OD-1`：`admin_email: unknown`

**實測事實**（§6 Leg B）：把 `admin_email` 標為 **`string | null`**，
會在 **7 個檔、8 個呼叫點**產生 `TS2322: Type 'unknown' is not assignable to type 'string'`，
且**每一條都落在 `admin_email: user.email` 這一個欄位**：

```
functions/api/admin/audit-aggregate-archive/retry.ts(239,7)
functions/api/admin/audit-archive/retry.ts(164,7)
functions/api/admin/oauth-clients.ts(160,7)
functions/api/admin/revoke.ts(73,37) / (120,37) / (153,35)
functions/api/admin/users/[id]/ban.ts(62,7)
functions/api/admin/users/[id]/unban.ts(64,7)
```

**根因（已實測，非推論）**：這些 caller 的 `user` 來自 `requireRole()`，其回傳型別為
`RoleCheckedUser = { role: string; [claim: string]: unknown }`（`functions/utils/requireRole.ts:50`）。
`email` **不是具名欄位**，而是經 **index signature** 解析 ⇒ 型別為 `unknown`。
⚠ 亦即這不是「某個檔案標錯」，而是 **JWT claim 存取面的既定設計**（gate 後只保證 `role`）。

⚠ **`string`（不帶 `| null`）之情形本棒未實測**（Leg B 量的是 `string | null`）。
**預測**：`string` 會**多**點亮 `functions/utils/role-change.ts:86`（該處傳 `actorEmail ?? null`
＝ `string | null`）⇒ 約 **9 個呼叫點、8 個檔**。
🚫 上述為**推測非量測**，引用時不得省略此限定。裁定採 `unknown` 後該腿已無執行必要。

**裁定＝`unknown`**（owner，§3）。理由：
1. `unknown` **誠實描述現況** —— 該值是未驗證的 JWT claim（經 index signature 取得）。
2. 移除該參數的 implicit `any`，使「未驗證」這件事在型別上**可見**。
3. 保持本棒為 type-only、scope 1 檔。

#### `admin_email: unknown` 的效力邊界（`ARCH-E-R1-RR3`，精確定性）

✅ **它做到的**：移除 implicit `any`；把「未驗證 claim」誠實暴露在簽章上；
禁止在該值上直接進行部分 typed operation（未先窄化即 `.length` / 算術 / 賦值給 `string` 等）。

🚫 **它沒有做到的（逐條否認，禁止被引用為反面證據）**：
- **不建立 `admin_email` 的 write contract** —— `unknown` 作為**輸入**屬性，
  caller 可把**任何**型別賦進來；它收窄的是**使用端**，不是 **producer 端**。
- **不證明 DB-safe** —— DB 是 `admin_email TEXT NOT NULL`，本標註對它零保證。
- **不保證流入 DB sink 的路徑真的發生窄化** —— 本 repo 無 `@cloudflare/workers-types`，
  `db` 解析為 `any`（§4.2），`.bind(row.admin_email, …)` 不受型別檢查。
- **不 closure `TD-BATCHE-1`**（§10.1）。

🚫 因此**不得**把本 interface 引用為「audit DB row 已受型別保護」或
「write boundary 已硬化」之證據。⚠ 舊表述「相對隱性 `any` 是**淨改善**、`unknown` 強制
使用端先窄化」**已作廢** —— 該句在 TypeScript 一般操作層成立，但套到本 write boundary 過度延伸。

🚫 **此裁定不消滅底層落差、只記錄它** —— 見 §10.1 `TD-BATCHE-1`。

### 4.4 `E-OD-2`：`isUniquePrevHashError(err: unknown)` ＋ 2 個 erased cast

`err` 的型別**被測試鎖死為 `unknown`**：
`tests/integration/audit-log.test.ts:142` 宣告 `let caught: unknown`，
`:149` 以 `isUniquePrevHashError(caught)` 傳入。TS 中 `unknown` 僅可賦值給 `unknown` / `any`；
`: any` 被 ratchet `BAN_PATTERNS`（`/:\s*any\b/`）擋 ⇒ **只剩 `unknown`**。

`unknown` 上不能直接讀 `.message`，故本體改為 inline erased cast：

```ts
const msg = [(err as ErrorLike)?.message, (err as ErrorLike)?.cause?.message].filter(Boolean).join('\n')
```

- **erase 後與 base 逐字相同**（`err?.message` / `err?.cause?.message`）→ 不破壞 byte-identical（§6 已實測）。
- cast 數量：**恰 2**（同一行）；型別為 `ErrorLike`，🚫 非 `any`、🚫 非雙重 cast（`as unknown as T`）。
- ratchet `BAN_PATTERNS` **不攔** non-any `as`（實測讀 `scripts/typecheck-ratchet.mjs:269-295`），
  故此處以**人工計數**列入 §5.5 suppression 預算，供 gate 覆核。

**負向控制 `NC-3`（coding 階段執行，注入後須還原）**：把 `err` 改標為比 `unknown` 窄的型別
（例：`Error | null | undefined`）。**預測**：`tests/integration/audit-log.test.ts:149` 產生
`TS2345`，且因 `tests/**` 只屬 tests 單一 leaf（§6.0）⇒ **恰 1 raw**、非成雙。
其餘三個呼叫點（`:157` `null`、`:158-161` `new Error(...)`、`:165` `wrapped`）皆可賦值 ⇒ 不轉紅。
若**不**轉紅，代表「測試鎖死 `unknown`」這條理由不成立，須回 `PLAN_DRAFT` 重新設計。

---

## 5. Exact change scope

### 5.1 Production allowlist（恰 1 檔）

- `functions/utils/audit-log.ts`（M）

### 5.2 Tests / fixtures allowlist（**空集合**）

本棒 **0 個測試檔改動**。理由：
1. 既有 `tests/integration/audit-log.test.ts`（**187** 行）已覆蓋 hash chain 正常／三種竄改／
   空表／CAS race／`isUniquePrevHashError` 正負例（逐條對照見 §8）。
2. 本棒為 type-only，**零新行為可測**。
3. ⚠ 本檔被 coverage **exclude**（§9.1）⇒ 連「補覆蓋率」這個動機都**不存在**；
   若仍新增 unit test，即屬為寫而寫（違反 §測試策略「禁為覆蓋率寫無意義 test」）。

### 5.3 Governance allowlist（恰 1 檔）

- `docs/plans/stage7-pr2dw-batche-audit-log-typing.md`（A，本檔）

依 2026-07-18 amendment，plan doc **自 SPEC 起**即納入 allowed changed-files，
與 code 同 PR 落地 ⇒ **merge 即 CLOSED、無需 docs-only closeout PR**。

### 5.4 明確排除 —— `E_EXCLUDES`

| 排除項 | 理由 |
|---|---|
| F-3 三檔（`audit-archive.ts` / `audit-aggregate-archive.ts` / `audit-aggregate-archive-runner.ts`） | F-3 DORMANT；本棒零觸碰（實測：`audit-log.ts` 無 import，三檔亦不 import 本檔） |
| `appendAuditLog` / `prepareAppendAuditLog` 的 caller：**9 個檔、12 個呼叫點**（`appendAuditLog` 10 ＋ `prepareAppendAuditLog` 2） | `E-OD-1` 已裁；硬化屬 `TD-BATCHE-1` backlog |
| `types/env.d.ts` | 屬批 H0 領土（衍生 scope 紀律：🚫 不得夾帶） |
| `tests/**` | §5.2 |
| `CLEANUP_PLAN.md` | 永不 stage（untracked scratch，Big5 亂碼） |
| ratchet baseline（1119/175） | 🚫 凍結、🚫 不得 `--update` |
| `admin_audit_log` schema / migration | 本棒零 DB 改動 |

### 5.4.1 `FINAL_PR_CHANGED_FILES` — 預測 diff shape（**可證偽**；coding 階段須逐項對上）

> ⚠ 本節定義的是「**branch 相對 base 的最終淨變更**」，**不是**任何單一 commit 的 staged set。
> 三者是**互相獨立的集合**，🚫 不得互相代入 —— 見 §5.6（`ARCH-E-R1-RR1`）。

| 項目 | 預測 |
|---|---|
| changed files | **恰 2**（`functions/utils/audit-log.ts` M ＋ 本 plan doc A） |
| 既有行**被修改** | **恰 8**：7 條函式簽章（L23 / L31 / L44 / L60 / L106 / L132 / L143）＋ 1 條 `msg` 本體（L134） |
| **新增**行 | **13**：`interface AuditLogEntry` 8 行 ＋ `type AuditLogRow` 1 行 ＋ `type ErrorLike` 1 行 ＋ 3 個分隔空行 |
| `git diff --stat`（source 檔） | **`21 insertions(+), 8 deletions(-)`** |
| 既有行**被刪除**（淨刪） | **0** |

🚫 若實測與上表不符，**不得**默默改寫本表 —— 須就地標註差異與原因，並重新評估是否仍為 type-only。

### 5.5 Suppression 預算（人工計數，供 gate 覆核）

| 項目 | 預算 | 說明 |
|---|---|---|
| `@ts-nocheck` / `@ts-ignore` | **0** | — |
| `@ts-expect-error` | **0** | — |
| `: any` / `as any` / `<any>` / 容器 any | **0** | ratchet 機械攔截 |
| JSDoc `{any}` | **0** | ratchet 機械攔截 |
| `as const` | **0** | — |
| **non-any `as` cast** | **恰 2** | 皆為 `err as ErrorLike`，同一行；ratchet 不攔 ⇒ 人工計數（§4.4） |
| 新增 `export` | **0** | 型別宣告皆 module-local |

### 5.6 落地機制 — **三個獨立 staged-set SSOT**（`ARCH-E-R1-RR1`）

**為何要拆**（① R1 Required，已驗證的自相矛盾）：plan doc 已於 `de6cc72f` / `11fa0925`
**先行 commit 進 branch**。舊 §5.6 寫「明確 stage 恰 2 檔」，而那個「2 檔」其實是 §5.4.1 的
**net changed-files**。照字面執行 ⇒ operator 不可能同時滿足「PLAN 已 commit」與
「coding commit stage 恰 2 檔」，因為 plan doc 已無內容可再 stage。三個集合必須各自為 SSOT：

| SSOT | 定義 | 值 | 量測法 |
|---|---|---|---|
| `FINAL_PR_CHANGED_FILES` | branch 相對 **base** 的最終淨變更 | **恰 2**：`functions/utils/audit-log.ts`(M) ＋ plan doc(A) | `git diff --name-status main...HEAD` |
| `CODE_COMMIT_STAGED_SET` | **coding commit** 當下的 staged set | **恰 1**：`functions/utils/audit-log.ts` | `git diff --cached --name-status` |
| `PLAN_REMEDIATION_STAGED_SET` | 因 gate finding 修 PLAN 而產生的 **docs commit** | **恰 1**：plan doc；**每次獨立計數** | 同上 |

- ⚠ `PLAN_REMEDIATION_STAGED_SET` **不與** `CODE_COMMIT_STAGED_SET` 合併計數；
  docs commit 與 code commit 是**分開的 commit**，各自驗各自的 staged set。
- ⚠ 若 coding 前 PLAN 又被 gate 要求修改，該次 docs commit 仍走 `PLAN_REMEDIATION_STAGED_SET`；
  **不因此改變** `FINAL_PR_CHANGED_FILES` 仍為 2（同一 plan doc 多次 commit，net 仍是 1 個 A）。
- 🚫 禁 `git add .` / `git add -A`；一律明確列檔 stage，**stage 後立即 commit**。
- 🚫 禁直推 main、禁 force push、禁 `--no-verify`、禁 amend、禁空 commit。
- commit 前後各核一次 staged set 與 net source diff（防 stray 檔被掃入）。
- 分支 `refactor/stage7-pr2dw-batche-audit-log` → PR → **squash-merge**（唯一進 main 路徑）。
  ⚠ 批 D 曾由 owner 明示走非 PR 路徑；那是**當輪例外、不跨輪繼承**，本棒預設回 PR 路徑。

---

## 6. `MEASURED_OVERLAY` 證據

**量測時點**：base `0a6593f6`，working tree 除 untracked `CLEANUP_PLAN.md` 外 clean。
**量測法**：`npx tsc -b tsconfig.solution.json --force --pretty false`，
診斷正規化為 `file|code|message`（**strip 行號與欄號**，避免行位移造成假差集）後做集合比對。

### 6.0 dual-leaf 的**實際**行為（⚠ 自審修正，勿沿用直覺）

`functions/**` 同時被 `tsconfig.functions.json` 與 `tsconfig.tests.json` 收錄，
但**兩者的 `noImplicitAny` 不同**（實測讀檔）：

| leaf | `noImplicitAny` | include `functions/**` |
|---|---|---|
| `tsconfig.functions.json` | **`true`** | ✅ |
| `tsconfig.tests.json` | **`false`** | ✅ |
| `tsconfig.json`（root，非 solution 成員） | `false` | ✅ |

**推論（有實測背書）**：
- **`TS7xxx`（noImplicitAny 家族）只由 functions leaf 產出 ⇒ 每條恰一次、無 dual-leaf 重複。**
  佐證：`audit-log.ts` 有 10 個 implicit-any 參數，base 診斷恰 **10** 行（非 20）。
- **base check（如 `TS2322` / `TS2345`）在兩個 leaf 皆啟用 ⇒ `functions/**` 的此類診斷出現兩次。**
  佐證：Leg B 的 `TS2322` raw = 16、distinct `file(line,col)` = 8。
- `tests/**` 只在 tests leaf ⇒ 其診斷不重複；且因該 leaf `noImplicitAny:false`，
  測試檔的 implicit-any 參數**不產生** `TS7006`（例：`audit-log.test.ts:19` 的 `ENTRY = (action, targetId) =>`）。

🚫 **勿把 base 的「362 raw / 228 unique」讀成 dual-leaf 去重** —— 228 是把診斷正規化為
`file|code|message` 後的**訊息文字**去重（同檔同訊息多次出現會被併），與 leaf 數無關。
base 的 362 **本身就是無重複的真實數量**（＝`typecheck:ratchet` 的 `errorCount`）。

### 6.1 兩腿量測

| 腿 | `admin_email` 標註 | REMOVED (raw＝真實) | ADDED (raw) | ADDED (distinct 位置) | 結論 |
|---|---|---|---|---|---|
| **B** | `string \| null` | 10 | 16 | **8** | 8 個位置全落 `admin_email:` → 該欄位型別 **load-bearing** |
| **C**（採用） | `unknown` | **10** | **0** | **0** | 零 cascade |

⚠ 本表為 **base overlay 之預測終態**；coding 階段須在真實 commit 上**重跑並重報**，
🚫 不得以本表代替 coding 後量測。

Leg B 同時**即是** Leg C 的負向控制：證明「ADDED=0」不是因為量測失靈，
而是 `unknown` 這個選擇真的在做事。

### 6.2 ratchet

| | errors ¹ | clean files ¹ | dirty files ² | total ² |
|---|---|---|---|---|
| base | 362 | 324 | 13 | 337 |
| **after（預期）** | **352** | **325** | **12** | 337 |

¹ `typecheck:ratchet` **直接輸出**（`errorCount` / `cleanFiles`）。
² **推導值**：dirty ＝ 有診斷的相異檔數（由全量診斷分組得出）；total ＝ clean ＋ dirty。
🚫 ratchet 不直接輸出 dirty / total，引用時須標明其為推導值。

baseline 維持 `errorCount=1119 cleanFiles=175`（🚫 未 `--update`）；overlay 下 `ratchet OK`。

### 6.3 type-only（byte-identical emit）

以 repo 自帶 `typescript@5.9.3`（`ts.version` 實測輸出）的 `ts.transpileModule`
轉譯 base 與 overlay 後比對。**可重播規格**（gate 得自行複製執行；本腳本刻意**不入 repo**，
以免擴張 §5 allowlist）：

```js
// node <this>.mjs <baseFile> <overlayFile>   —— 需在 repo 根目錄可 require typescript
const opts = {
  target: ts.ScriptTarget.ES2022,   // 對齊 tsconfig target
  module: ts.ModuleKind.ESNext,     // 對齊 tsconfig module
  removeComments: false,            // 🚫 不剝註解（批 C 曾因剝註解需另配 hunk allowlist）
  newLine: ts.NewLineKind.LineFeed, // 輸出端行尾正規化 → 本量測對行尾不敏感（見下方 ⚠）
}
const out = ts.transpileModule(readFileSync(f, 'utf8'),
  { compilerOptions: opts, fileName: 'audit-log.ts', reportDiagnostics: true })
// 報 outputText 的 byteLength / sha256 / diagnostics.length，並斷言 byteLength > 0
```

比對結果：

```
BASE    bytes=6769 sha256=3657b0acb0212983c74fb67f44c9c7db4e558686f4f2f958f2de6f9b438424b1
OVERLAY bytes=6769 sha256=3657b0acb0212983c74fb67f44c9c7db4e558686f4f2f958f2de6f9b438424b1
NON-EMPTY GUARD : base>0=true overlay>0=true      transpileDiags: 0 / 0
BYTE-IDENTICAL  : true
```

⚠ **非空守衛不可省** —— 批 C2 曾踩到「兩邊皆 0 bytes 而 `cmp` 回報相同、sha 為空字串常數
`e3b0c442…`」的假綠。本量測同時報 `bytes>0` 與 `transpileDiags=0`。
⚠ 此為**單檔 transpile identity**，🚫 **不是** production bundle identity。
⚠ 輸出端 newline 經 `NewLineKind.LineFeed` 正規化 ⇒ **此量測對行尾差異不敏感**，行尾另由 §7.1 守。

### 6.4 負向控制（emit 量測本身會不會轉紅）

於 overlay 副本注入**恰一行** runtime 敘述（`const __NEG_CONTROL__ = 1`，UTF-8 與 CRLF 皆保留、單變數）：

```
OVERLAY bytes=6796 sha256=3732d7973699293df52ac09e84b6a8149bb551ba2dc8ad8e5510c6850eb5b64d
BYTE-IDENTICAL  : false        Δ = +27 bytes
```

⚠ **首次嘗試作廢並重做**：初版負向控制用 PowerShell `-replace` ＋ `Set-Content` 產生，
中文註解被打成 Big5 亂碼 ⇒ **同時改了兩個變數**，控制不乾淨。已改用 Node `fs`（UTF-8 保真）重做，
上表為重做後之單變數結果。原始受污染那次**不採信**。

### 6.5 overlay 還原證明

overlay 量測後以 `git checkout -- functions/utils/audit-log.ts` 還原，驗證：

- `git diff -- functions/utils/audit-log.ts` = 空
- working-tree blob `0894b592c580ad77077b19047fb34fb3db12ab2a` ＝ `HEAD:` blob ✅
- `ratchet` 回到 `current: errorCount=362 cleanFiles=324` ✅
- `git status --porcelain` 僅 `?? CLEANUP_PLAN.md` ✅

⚠ **on-disk 行尾變化（誠實記錄）**：還原後檔案 raw bytes 由 6786（CRLF）變 6614（LF）。
機制＝`.gitattributes` 明文 `* text=auto eol=lf`（`git check-attr` 實測本檔 `eol: lf`），
checkout 以 LF 寫出；原 CRLF 是 `.gitattributes` 釘死前留下的陳舊工作區副本。
**git 層零差異**（clean filter 使兩者 blob 相同），且新狀態更貼近 committed blob。
⚠ 亦即 **`git hash-object` 鎖的是 committed blob、攔不到行尾差異**（批 C 已證），
故上列還原驗證同時報了 raw bytes 與 blob 兩軌。

---

## 7. 機械限制

### 7.1 EOL / encoding

- `.gitattributes`：`* text=auto eol=lf`；本檔 `git check-attr` ＝ `text: auto` / `eol: lf`。
- 落盤後須驗：檔案為 **LF**、UTF-8 無 BOM、`git diff --stat` 的變動行數與 §4.2 相符。
- 🚫 **禁**用 PowerShell `-replace` ＋ `Set-Content` 批次改本檔（§6.4 已實證會毀中文註解）。
- ⚠ 行尾量測一律 `tr -cd '\r' | wc -c`；`grep -c $'\r'` 在 Git Bash 不是可靠 CR oracle（批 C 教訓）。
  ⚠ 本機 PowerShell 無 `bash` on PATH ⇒ 改用 Node `fs` 計數（§6.4 腳本已內建 CRLF/LF 判定）。

### 7.1.1 ⚠ 行數量測禁用 `Get-Content`（本棒實測發現，`SR-19`）

**現象**：對含 CJK 的 UTF-8（無 BOM）檔案，PowerShell 5.1 的 `(Get-Content <f>).Count`
**系統性少算行數**。本棒實測差距：

| 檔案 | `Get-Content` | 真實 | 少算 |
|---|---|---|---|
| `tests/integration/audit-log.test.ts` | 177 | **187** | 10 |
| `functions/utils/audit-log.ts` | 150 | **172** | 22 |
| `functions/api/admin/cron/audit-archive.ts` | 999 | **1139** | 140 |
| `functions/utils/audit-aggregate-archive-runner.ts` | 1207 | **1352** | 145 |

**根因**：PS 5.1 `Get-Content` 未指定 `-Encoding` 時以系統 ANSI codepage（本機 cp950/Big5）
解碼。UTF-8 的 CJK 字每個 byte 皆 ≥ 0x80，落在 Big5 **lead byte** 範圍；
當某行以 CJK 結尾時，其末 byte 會把緊接的 `0x0A` **當作 trail byte 吞掉** ⇒ 兩行被併為一行。

**規定**：行數一律用 **`[System.IO.File]::ReadAllLines(<abs>).Length`** 或直接數 `0x0A` byte
（`[System.IO.File]::ReadAllBytes`），🚫 **禁**用裸 `Get-Content ... .Count`。
✅ 交叉驗證法：`git diff --stat` 的 insertions 應與 `ReadAllLines` 一致。

⚠ **本檔行數為活動值，引用必帶 commit 錨點**（`ARCH-E-R1-RR2` ＋ `ARCH-E-R2-RR1`）：

**本表只收錄 (commit, 值) 這種不可變配對；🚫 本表永不出現「現行值」這一列。**
理由（`ARCH-E-R2-RR1`）：上一版把 `11fa0925 = 690` 標成「現行值」，
下一個 commit 一落地就過期 —— 那正是本節規則要防的 drift，卻由本表自己犯。

| commit（不可變） | 本 plan doc 行數 | 該 commit 的角色 |
|---|---|---|
| `de6cc72f` | **644** | 初次落盤（該 commit `git diff --stat` ＝ `644 insertions(+)`） |
| `11fa0925` | **690** | **① R1 受審錨點**（PLAN sha `efd8dd28…`） |
| `eed35026` | **793** | **① R2 受審錨點**（PLAN sha `1939b3d9…`） |

**現行值不寫進本檔**，一律即時量測：`git show HEAD:<path> | wc -l`
（或 `[System.IO.File]::ReadAllLines(<abs>).Length`；🚫 禁裸 `Get-Content`，見上）。

🚫 **禁**在未標錨點的情況下引用本檔行數 —— 任一數字脫離其 commit 錨點就會被讀成現行機械規則。

### 7.2 ratchet `BAN_PATTERNS`

第一手讀 `scripts/typecheck-ratchet.mjs:269-295`（14 條）。與本棒相關者：
`: any` / `as any` / `<any>` / `Array<any>` / `Record<,any>` / `Promise<any>` / `Map<,any>` / `Set<any>` /
JSDoc `{any}` / `@ts-nocheck` / `@ts-ignore` / `@ts-expect-error`
（後者須寫成 `@ts-expect-error -- <理由>`，理由 trim 後長度 **≥ 15** 才放行）。
**non-any `as` 不在其中** ⇒ §5.5 以人工計數補位。
⚠ `BAN_PATTERNS` 只套**在 diff 增量行**，🚫 不掃全檔既有行。

### 7.3 dual-leaf 報數紀律

依 §6.0：`TS7xxx` 無重複、`functions/**` 的 base check 診斷成雙。
故 ADDED 一律**同時報 raw 與 distinct 位置數**；REMOVED（本棒全為 `TS7006`）raw 即真實數。
🚫 禁只報其一、🚫 禁把兩種去重混為一談。

### 7.4 base 值必須在 coding 前取得

已取得（base `0a6593f6`）：`lint` EXIT 0 · `typecheck:ratchet` 362/324 · tsc 全量診斷 362 行。
⚠ **禁**在 commit 之後用 `git stash` 取 base（source 已 commit ⇒ stash 為 no-op ⇒ 等於量了兩次 after）——
批 D 曾踩此假量測。若需重取，用 `git checkout <base> -- functions tests` 並以 tree hash 驗還原。

---

## 8. 測試計畫

本棒 **0 新測試**（§5.2）。
⚠ 既有守備**全在 `test:int`**（本檔被 coverage exclude，見 §9.1）——
`tests/integration/audit-log.test.ts`（**187** 行）：

| 既有測試 | 位置 | 對本棒的意義 |
|---|---|---|
| hash chain 正常串接 | `audit-log.test.ts:38` | 證 `canonicalize` 鍵序未變 → hash 可重現 |
| 三種竄改偵測（改欄位／重算 row_hash／刪列） | `:54` / `:70` / `:90` | 證 tamper evidence 未退化 |
| 空表 | `:105` | 邊界 |
| CAS race（UNIQUE + retry） | `:134` / `:168` | 證 `appendAuditLog` retry loop 未變 |
| `isUniquePrevHashError` 正負例（含 `cause` 包裝） | `:156` | 直接覆蓋 §4.4 改動處 |

**判準**：`test:cov` 與 `test:int` 必須**全數維持既有結果**（含 `test:cov` 的
統計數字不變 —— 本檔既被 exclude，改它**不應**影響任何 coverage 數字；若影響了，代表 exclude 失守）。
type-only 改動若造成任何測試行為變化 ⇒ 代表它不是 type-only ⇒ 停手回 `PLAN_DRAFT`。

⚠ **紅燈紀律**：任何測試首次轉紅一律 **halt ＋ 診斷**，🚫 禁 rerun-to-green
（`ARCH-ENV-11` RED-TEST-INTEGRITY 之延續）。

---

## 9. Required gates

### 9.1 CI-aligned（實測逐字讀 `.github/workflows/ci.yml`，**恰 7 道**）

| # | 指令 | ci.yml step 名 |
|---|---|---|
| 1 | `npm run lint` | Lint (ESLint) |
| 2 | `npm run typecheck:ratchet` | Typecheck ratchet (JS→TS day-1 gate) |
| 3 | `npm run verify:browser-pipeline` | Verify browser pipeline (Stage 4.5a canary) |
| 4 | `npm run test:cov` | Run unit tests with coverage (functions/utils ≥ 80%) |
| 5 | `npm run test:int` | Run integration tests (workerd + D1) |
| 6 | `npm run build:functions` | Pages Functions bundle gate (deploy-equivalent) |
| 7 | `npm audit --omit=dev --audit-level=high` | npm audit (production deps, high+) |

⚠ 最常漏 `test:cov`（CI `test` 是 fail-fast 單 job，coverage 紅會 skip 遮蔽 int/build/audit）。

⚠ **本檔不受 coverage 門檻管轄（自審修正，勿憑「它在 functions/utils/ 下」直覺推論）**：
`vitest.config.js` 的 `coverage.exclude` **明列** `'functions/utils/audit-log.{js,ts}'`
（列於「(A) D1-dependent」群，註解＝`hash-chain INSERT/SELECT`）。
故第 4 道的 80% statements/branches/functions/lines 門檻**不覆蓋本檔**。
本檔的行為守備**全部**落在第 5 道 `test:int`（`tests/integration/audit-log.test.ts`，
跑 `vitest.workers.config.js` 的 workerd + miniflare D1）。
✅ 該 exclude 用 `.{js,ts}` glob ⇒ `.js→.ts` rename 不會靜默失守（`feedback_coverage_exclude_ext_glob` 之教訓已內建）。

### 9.2 非 CI、但本棒仍會跑（**誠實標示其地位**）

`lint:migrations` · `lint:handlers` · `lint:archive-no-delete` —— 這三道**不在 `ci.yml`**，
它們掛在 `npm run build` 鏈上（`build:partials && lint:handlers && lint:archive-no-delete && lint:migrations`），
而 `npm run build` **不是** CI step。

本棒**零 migration、零 handler 新增、零 archive 刪除路徑改動** ⇒ 三者皆**非 load-bearing**，
但成本為零，仍會跑並回報，作為額外守備。
🚫 不得把它們述為「CI required gate」。

⚠ 機械 gate 一律**直接跑命令讀真實輸出**，🚫 不靠 agent 推理。

---

## 10. 風險與失效模式

| # | 風險 | 處置 |
|---|---|---|
| R1 | `canonicalize` 鍵序被動到 → 全鏈 hash 失效、既有 row 永久不可驗 | 本棒**不改該函式本體**，僅加參數標註；§6.3 byte-identical 為機械證明；§8 既有測試為行為證明 |
| R2 | `admin_email: unknown` 被誤讀為「寫入端已硬化」 | **不是** hardening、**不是** regression：它只移除 implicit `any` 並誠實暴露未驗證 claim。效力邊界逐條見 §4.3「效力邊界」；底層落差見 §10.1 `TD-BATCHE-1`（未 closure） |
| R3 | `db` 標註被誤讀為「D1 row 已型別化」 | §4.2 已明文否認；本 repo 無 `@cloudflare/workers-types` |
| R4 | overlay 未還原乾淨污染 base 量測 | §6.5 雙軌（raw bytes ＋ blob）驗證 |
| R5 | 假綠（emit 兩側皆空、量測失靈） | §6.3 非空守衛 ＋ §6.4 負向控制 |

### 10.1 `TD-BATCHE-1`：`admin_email` 型別與 DB 契約落差（**本棒不修，記錄並外送 backlog**）

**事實**（實測，非推論）：

1. `migrations/0003_admin_audit_log.sql:5` ＝ `admin_email TEXT NOT NULL`。
2. `functions/utils/role-change.ts:86` 傳入 `admin_email: actorEmail ?? null`，
   而 `actorEmail?: string | null`（`role-change.ts:53`）⇒ **可傳 `null` 進 NOT NULL 欄**。
3. 7 個 caller 傳 `admin_email: user.email`，型別為 `unknown` ⇒ 非 `string` 亦不被擋。

**可達性**：`changeUserRole` 目前**無任何 production caller**。
量測法＝`grep 'changeUserRole' **/*.{ts,js,mjs}`（含 tests；不含 `docs/`、不含 memory），
命中 15 處：定義 **1**（`role-change.ts:49`）＋ 註解 **3**（`roles.ts:11`、`roles.ts:14`、`role-change.ts:2`）
＋ 測試 **11**（`tests/integration/role-change.test.ts`）；**`functions/api/**` 恰 0 處** ⇒
第 2 點在**今日**不可達（latent）。第 3 點的 `user.email` 是否恆為 string **未經驗證**，
🚫 不得宣稱「今日安全」。

**硬化 scope 的實際大小（供 backlog 定範圍用）**：**至少 9 個呼叫點、8 個檔**
＝ §4.3 所列 8 處 `admin_email: user.email`（7 檔）＋ `role-change.ts:86`（1 處 1 檔）。
⚠ 另有 `functions/api/admin/audit/[id].ts:55`（`stepCheck.user.email`）**目前不顯現**，
因該檔仍是 13 個殘域檔之一、其 `user` 仍為 implicit any；該檔型別化後會加入此清單 ⇒
屆時為 **10 處、9 檔**。🚫 故「9 處／8 檔」是**今日下界**、不是終值。

**為何不在本棒修**：每個呼叫點都要各自決定「非 string 時 coerce／reject／500」，
＝ runtime 行為變更 × 多檔，與本棒 type-only 定位衝突，且 owner 已於 `E-OD-1` 明確否決該路徑。

**處置**：另立 backlog（audit 寫入端 `admin_email` 契約硬化），🚫 不得夾帶進任何已定案 scope 的棒次。

---

## 11. 高風險領域加碼判定

| 觸發條件 | 判定 | 依據 |
|---|---|---|
| Queue / Message | ❌ | 本檔無 |
| WebSocket / SSE / Streaming | ❌ | 本檔無 |
| Payment / Webhook | ❌ | 本檔無 |
| Transaction 跨資源 | ❌ | 本棒零 runtime 改動；既有 `db.batch()` 語義未動 |
| Distributed state | ❌ | 同上 |
| 跨系統 JSON contract | ❌ | 型別宣告為 module-local、零 export、零 wire format 改動 |
| **持久性序列化契約** | ⚠ **是（但零改動）** | `canonicalize()` 產出的 JSON **鍵序**是 hash chain 的持久性契約 —— 既有每一列 row 的 `row_hash` 都依賴它，改動 ＝ 全表歷史永久不可驗。本棒對該函式**本體零改動**（§6.3 機械證明 ＋ §8 既有竄改測試） |
| **稽核 audit log** | ⚠ **是（領域敏感）** | 檔案本身即 audit hash chain |

**結論**：領域敏感 ⇒ 走 **first-do-no-harm 最小 diff**（已滿足：10 處標註 ＋ 3 個型別宣告 ＋ 2 個 erased cast，
零函式本體改寫）。但因**零 runtime delta**（§6.3 機械證明），
🚫 不觸發「state machine / failure mode / idempotency / retry 四件式」——
那四件針對行為變更，本棒無行為可變。

### 11.1 F-3 三軸

| 軸 | 值 | 依據 |
|---|---|---|
| `F3_POSTURE` | `DORMANT_WAIT_ONLY` | memory 明令（2026-06-11 owner） |
| `F3_FILE_EDIT_POLICY` | `CONDITIONAL_ACTIVE` | 批 C2 `ARCH-C2-R2-L2` 第 6 項 |
| `F3_FILE_EDIT_TRIGGER` | **`NOT_TRIGGERED`** | 本棒 scope 恰 1 production 檔且非 F-3 三檔之一；`audit-log.ts` 零 import；F-3 三檔亦不 import 本檔（實測） |

### 11.2 C2 §5.1 classifier boundary

**不在其上。** 實測：`audit-log.ts` 對 `classifyForCold` / `severity` / `AuditSeverity` / `audit-policy`
**0 命中**；`admin_audit_log` 表亦無 `severity` 欄。
故本棒 🚫 不觸發 §5.2 過渡期條件、🚫 不涉 canonical parser 唯一性。

---

## 12. Rollback

單 commit、單 production 檔、零 runtime delta、零 schema 改動 ⇒
`git revert <squash sha>` 即完整回復；無資料面副作用、無部署順序依賴。
⚠ 本棒**無 migration**，故不適用 expand→migrate→contract。

---

## 13. 非目標

- 🚫 不修 `TD-BATCHE-1`（§10.1）
- 🚫 不動 F-3 三檔
- 🚫 不動 `types/env.d.ts`（批 H0 領土）
- 🚫 不推進其他 12 個殘域檔
- 🚫 不 rebaseline（1119/175 凍結）
- 🚫 不主張其他 15 個單元的字母對映（§2.1）

---

## 14. Gate 軌跡

**本節是 gate 狀態的唯一 SoT，且為 append-only 裁決 ledger。**（`ARCH-E-R3-RR1` 結構性修法）

**讀法規則（永久成立，故不會漂移）**：
1. **每一列 ＝ 一個已完成的裁決**，附其受審 commit 錨點 ⇒ 列一旦寫入即**不可變**。
2. 🚫 **本 ledger 不記錄瞬時狀態**（「待送」「審查中」「PENDING」等）。
   瞬時狀態只存在於**當輪 packet SECTION 2 與中文報告**，**不寫進 durable PLAN**。
3. **未出現於本 ledger 的 gate ＝ 尚無已完成裁決。**
4. `CODING_ALLOWED` 僅由 owner 明示核發；核發時**新增一列**記錄。
   **本 ledger 無該列 ⇒ 未核發。**
5. 🚫 本檔任何其他章節**不得**複述 gate 當前狀態（可引用歷史 verdict，但須帶輪次＋commit 錨點）。

> **為何這樣設計**：R3 之前，header 與本表各自持有一份「當前 gate 狀態」，
> 兩份都會隨每輪過期 —— 認知更新了、durable artifact 沒更新，於是 header 寫「①②③④ 皆尚未送審」
> 而 §14.1／§14.2 已記錄 ① 兩輪裁決，**同一份 artifact 自我否定**。
> 這與 `644`／「現行值」是**同一族**（current-state surface 重複 ⇒ 必然漂移）。
> 修法一致：**消滅重複 surface、把可變值換成讀法規則**，而不是把字改對。

### 裁決 ledger（append-only）

| # | 道 | 輪 | verdict | 受審錨點 | 摘要 |
|---|---|---|---|---|---|
| 1 | ① ChatGPT Architecture | R1 | `CHATGPT_ARCH_CHANGES_REQUESTED` | `11fa0925` / blob `a4b041e1` / sha `efd8dd28…` | 0 Blocker／**3 Required**（`RR1` staged-set·`RR2` 644·`RR3` unknown 定性）／1 non-blocking（`TR-R3-NB1`）。處置見 §14.1 |
| 2 | ① ChatGPT Architecture | R2 | `CHATGPT_ARCH_CHANGES_REQUESTED` | `eed35026` / blob `73e52e36` / sha `1939b3d9…` | 0 Blocker／**2 Required**（`RR1` 現行值標籤·`RR2` census vs 語意分類）／**0 新設計 objection**。R1 三項＋`TR-R3-NB1` 皆 CLOSED。處置見 §14.2 |
| 3 | ① ChatGPT Architecture | R3 | `CHATGPT_ARCH_CHANGES_REQUESTED` | `d4bcdbf9` / blob `8fc9bf5e` / sha `d33cb365…` | 0 Blocker／**1 Required**（`ARCH-E-R3-RR1` gate-state family drift）／**0 設計 objection**。R2 兩項 CLOSED、transport PASS。處置見 §14.3 |
| 4 | ① ChatGPT Architecture | R4 | **`CHATGPT_ARCH_APPROVED_WITH_LOCKS`** | **`6c06ae26`** / blob `3418a843` / sha `7e2f7fbb…aca935` | `ARCH-E-R3-RR1` **CLOSED**（① 複掃無新 live gate-state 副本）。頒 **`ARCH-E-L1`..`L7`**（§14.4）＋ 1 non-blocking（`ARCH-E-R4-NB1`）。⚠ **① 通過 ≠ `CODING_ALLOWED`** —— 仍須 ② Codex Plan Gate ＋ owner 明示授權 |

### 14.0 傳輸前置（3 輪，**皆非內容 finding**）

| 輪 | 載體 | 結果 | 損壞指紋 |
|---|---|---|---|
| R1 | `.md` | `TRANSPORT_INTEGRITY_FAILED` | markdown escape，**+4125 B**，行數/CR 不變 |
| R2 | `.txt` | `TRANSPORT_INTEGRITY_FAILED` | LF→CRLF，**+811 B ＝ 行數**，CR 0→811 |
| R3 | `.txt` ＋ base64 權威載體 | **transport 解除阻擋**，① 進入內容裁決 | ① 實測 decoded 40560 B / 690 LF / 0 CR / sha `efd8dd28…` ✅ |

⚠ 三輪皆 **repo 內容零變動**（同一 commit / blob / PLAN sha）。
🚫 傳輸失敗不得記為 `CHATGPT_ARCH_CHANGES_REQUESTED`。契約全文見 packet SECTION 0。

⚠ **「3 輪」指的是造成阻擋的輪數，🚫 不表示通道之後就正常了**（`SR-26`）：
LF→CRLF **在其後每一次傳輸都仍然發生**，① 逐輪實測 —— gate R2 packet **+1837 B ＝ 1837 CR**、
gate R3 packet **+2069 B ＝ 2069 CR**。差別只在於 **[N0] base64 載體把它吸收掉**，
故不再構成 blocker。**通道並未被修好，是契約承受住了。**
⇒ 後續棒次沿用本契約時，🚫 不得因「R3 之後沒再失敗」而推論可以改回純文字載體。

### 14.1 ① R1 之處置（`CHATGPT_ARCH_CHANGES_REQUESTED`；0 Tier-0 Blocker／3 Required／1 non-blocking）

**方向面 ① 已 PASS 之項目**（不再重開）：批 E scope 單檔 · module-local types / zero export ·
`ErrorLike` ＋ 2 erased casts · type-only 證據方向 · 0 新測試 · rollback · `TD-BATCHE-1` defer。
① 明示：**不要求拆棒、不要求換設計、不要求擴 scope**；阻擋點集中在「治理 artifact 必須先把自己說準」。

| ID | 等級 | ① 的 finding | 我方處置 |
|---|---|---|---|
| `ARCH-E-R1-RR1` | Required | staged-set SSOT 自相矛盾：plan doc 已 commit，「stage 恰 2 檔」不可執行 | **接受**。§5.6 改寫為**三個獨立 SSOT**（`FINAL_PR_CHANGED_FILES` / `CODE_COMMIT_STAGED_SET` / `PLAN_REMEDIATION_STAGED_SET`），並在 §5.4.1 加「非任何單一 commit 的 staged set」之警語 |
| `ARCH-E-R1-RR2` | Required | `644` 為 `de6cc72f` 的歷史值，卻活在現行機械規則與「final clean」敘述中 | **接受**。§7.1.1 改為 commit-anchored 對照表（`de6cc72f`＝644 歷史／`11fa0925`＝690 現行，皆以 `git show \| wc -l` 實測）；§15 R9 metrics 清單移除未錨點的 644；§15 `SR-19` 說明段與「量測工具失真」族說明段兩處歷史敘述補 `@ de6cc72f` 錨點。**全族已機械枚舉**（見 §15 R10）。⚠ 🚫 本表刻意**不用行號**指位 —— 行號會隨編輯漂移、引用會自我失效（`SR-20`） |
| `ARCH-E-R1-RR3` | Required | `unknown` 的安全收益被過度描述；它不是 write-contract hardening | **接受**。§4.3 新增「效力邊界」：逐條否認「建立 write contract／證明 DB-safe／保證 sink 路徑窄化／closure `TD-BATCHE-1`」；舊句「淨改善…強制使用端先窄化」**明文作廢**；§10.1 風險表 R2 同步改寫；§4.1 補 `AuditLogRow` SoT 範圍限定（**非** DB schema truth） |
| `TR-R3-NB1` | Non-blocking | packet 的 Git Bash replay 指令用 `sed -n "/TOKEN/,/TOKEN/p"`，會先撞到 SECTION 0 說明文字（① 實跑：decode 10 bytes、`invalid input`、exit≠0） | **接受**。屬 packet 缺陷非 PLAN 缺陷：R2 packet 改用 exact-line matcher，且**出貨前以真實 Git Bash 實跑驗證**（見報告） |

⚠ `ARCH-E-R1-RR2` 是本 PLAN 自己定義的 **`SR-16` 族（族處置不完整）第四次復發**，
且這次是由**外部 gate** 抓到、非自審抓到 —— 記錄此事實本身即為證據：
單 agent 自審對「文件與外部世界不一致」這一類問題的偵測力有結構性上限。

### 14.2 ① R2 之處置（`CHATGPT_ARCH_CHANGES_REQUESTED`；0 Tier-0 Blocker／2 Required／0 新設計 objection）

**① R2 已 closure 之項**：`ARCH-E-R1-RR1`（staged-set 三 SSOT）· `ARCH-E-R1-RR3`（`unknown` 定性）·
`TR-R3-NB1`（replay 指令；① 對實際附件重播成功）。**transport 亦 PASS**
（① 實測 decoded 50123 B / 793 LF / 0 CR / sha `1939b3d9…`，與 PRIMARY 一致）。
① 明示：**無新設計層 objection**，Architecture 方向全數 PASS，remediation 應「非常窄、PLAN-only」。

| ID | 等級 | ① 的 finding | 我方處置 |
|---|---|---|---|
| `ARCH-E-R2-RR1` | Required（carry-forward 自 `ARCH-E-R1-RR2`） | §7.1.1 表仍把 `11fa0925 = 690` 標為「**現行值**」，但現行 artifact 已是 `eed35026 / 793` ⇒ 該節的表**違反該節自己的規則** | **接受**。表格改為**只收 (commit, 值) 不可變配對**、**永不出現「現行值」列**；`11fa0925` 改標「① R1 受審錨點」，並新增 `eed35026 = 793`「① R2 受審錨點」。**現行值不寫進本檔**，改為即時量測。⚠ 這是把「值」換成「規則」的結構性修法 —— 若只把 690 改成 793，下一個 commit 立刻又過期 |
| `ARCH-E-R2-RR2` | Required（治理／自審證據精度） | R12 宣稱硬化族「**唯一出現處**為明文作廢句」，但 literal census 實為 `淨改善` 4／`hardening` 4／`硬化` 9 ⇒ 把**語意分類**結果冒充 **literal census** 結果 | **接受**。R12 該句就地標註失準（🚫 不靜默改寫）；新增 **§15.1**，把兩件事明確分離：(a) literal census（錨定 `eed35026`、標明為不可變快照）· (b) 逐處分類（腳本歸戶、`Σ 分類 == literal 總數`）· (c) **oracle `LIVE_POSITIVE_HARDENING_ASSERTION = 0`**（明列母體排除 `NEGATED`/`HISTORICAL`/`BACKLOG`/`META`，並定為後續棒次仍須維持之不變式） |

⚠ **兩條 Required 皆由外部 gate 抓到、自審未抓到**（`SR-23`／`SR-24`）。
加上 R9 那次，這是**第二次**同一結構：自審查得了「文件內部一致」，
查不出「文件與外部世界／與自己宣稱的量測方法不一致」。此事實已寫入 §15 誠實邊界。

### 14.3 ① R3 之處置（`CHATGPT_ARCH_CHANGES_REQUESTED`；0 Tier-0 Blocker／1 Required／**0 設計 objection**）

**① R3 已 closure 之項**：`ARCH-E-R2-RR1`（§7.1.1 改 immutable `(commit, line-count)` 配對）·
`ARCH-E-R2-RR2`（literal census 與 semantic oracle 已分離）· `SR-25` remediation **PASS**
（① 認可「保留事故紀錄 ＋ 逐項歸戶而非只驗 Σ=17」）。**transport PASS**
（① 實測 decoded 58464 B / 897 LF / 0 CR / sha `d33cb365…`；收到之 packet 再度被轉 CRLF，
+2069 B ＝ 2069 CR，N0 仍逐 byte 還原）。
① 亦獨立複掃硬化宣稱族，確認 **`LIVE_POSITIVE_HARDENING_ASSERTION` 仍為 0**，
🚫 不因本檔變長而重新打開 `RR2`。

| ID | 等級 | ① 的 finding | 我方處置 |
|---|---|---|---|
| `ARCH-E-R3-RR1` | Required（治理 artifact correctness，非設計） | **current gate-state family 自相矛盾**：header 仍寫「①②③④ 皆尚未送審」、§14 主表仍寫「R1 → R2 待送」，但 §14.1／§14.2 已記錄 ① 兩輪裁決 ⇒ 同一 artifact 的 current-state summary 與歷史明細互相否定。與 644／「現行值」**同族**，作用域換成 gate-state | **接受，且採結構性修法**：§14 改為 **append-only 裁決 ledger ＋ 5 條讀法規則**（每列＝已完成裁決且不可變 · 🚫 不記瞬時狀態 · 未列＝尚無裁決 · `CODING_ALLOWED` 無列即未核發 · 🚫 他節不得複述 current state）；header 的 current-state 句**整句移除**，改為指向 §14 之唯一 SoT 宣告。⇒ **可變 surface 由 2 個降為 0 個**，該族結構上不再可能漂移 |

⚠ **同族第三次**（`644` → 「現行值」 → gate-state），且**三次皆由外部 gate 抓到**。
三次的共同根因不是粗心，而是**在 durable artifact 裡放了 current-state 副本**。
故本輪不再逐字修，而是把該族的**可變 surface 數量歸零**。

**① R3 之 non-blocking（我方接受並順手處理）**：R15 寫「§7.1.1『現行值』出現數（0）」
字面像整節 literal count，實為 R14 定義之 scoped check（**表內**）。① 明示不列 Required；
本輪已把「表內」二字補回，消除下一輪歧義。

### 14.4 ① R4 `CHATGPT_ARCH_APPROVED_WITH_LOCKS` @ `6c06ae26` — locks receipt

> **本節為 receipt**：逐字轉錄 ① 所頒之 lock，🚫 **非我方新增規範**、🚫 不得自行增刪或改寫語意。
> 依 `ARCH-E-L7`，本節與上方 ledger 第 4 列同屬 **receipt-only** 落盤，不使 ① anchor 失效。

| Lock | 適用範圍與 closure |
|---|---|
| `ARCH-E-L1` **SCOPE-LOCK** | Production 只准改 `functions/utils/audit-log.ts`；tests／schema／migration／callers／F-3／`env.d.ts` 全禁。最終 PR net changed-files 恰 source M ＋ PLAN A；coding commit staged set 恰 source 1 檔。任何偏離**先停**。 |
| `ARCH-E-L2` **RUNTIME-HASH-LOCK** | 10 個參數標註、3 個 module-local type declaration、2 個 erased casts **之外**，不得改 runtime expression。`canonicalize` 鍵序、hash-chain、D1 query/bind、CAS/retry/error-classification 行為須保持。final source commit 必重跑 **non-vacuous** byte-identical emit；`build:functions` 必綠。 |
| `ARCH-E-L3` **CASCADE-LOCK** | final source commit **fresh** forced-tsc 必得 scoped **REMOVED=10 / ADDED=0**；🚫 不得沿用 overlay。`NC-3` 必如 PLAN 所述轉紅；若不轉紅或出現任何新 diagnostic，**退回 PLAN**。 |
| `ARCH-E-L4` **UNKNOWN-BOUNDARY-LOCK** | `admin_email: unknown` 僅表示未驗證 claim ＋ 消除 implicit any；**不得**宣稱 caller contract hardened／DB-safe／sink 已 narrow／`TD-BATCHE-1` 已 closure。不得藉本棒順手修 callers/schema。 |
| `ARCH-E-L5` **CAST-LOCK** | non-any casts 恰 **2 個 `err as ErrorLike`**；0 `any` suppression、0 `ts-ignore`/`nocheck`/`expect-error`、0 新 export、0 雙重 cast。 |
| `ARCH-E-L6` **TEST-REPLAY-LOCK** | `test:int`、`test:cov`、lint、ratchet、browser pipeline、`build:functions`、npm audit 等 PLAN 指定 gate 均以 **final source commit 真跑**。任何**首次紅燈 halt + diagnose**，🚫 不得 rerun-to-green。 |
| `ARCH-E-L7` **LEDGER-LOCK** | 本 approval 錨定 `6c06ae26`。若**只為收據**而在 §14 **append** 本 R4 verdict row，可視為 receipt-only；② packet 必**同時保留**本 approved anchor。除此之外任何 **normative** PLAN 改寫，都需重新判斷是否使 ① anchor 失效。 |

**`ARCH-E-R4-NB1`（non-blocking，① 明示不另開 remediation round）**：R16 寫「命中 4 處」。
① 依 R16 明列之 regex 對 959 行 PLAN 逐行重跑，實得 **13 行**。我方獨立重跑**逐字相符**：13 行。
根因＝那個「4」量於我加入 §14.3 與 R16 本身**之前**，是**同一次編輯 session 內就過期的快照數字**
—— 又一次 literal census 與 semantic classifier 混寫。
① 逐項複核該 13 行後確認**全屬讀法規則／ledger／history／舊 finding 引述／自審 meta**，
**current-state assertion 確為 0** ⇒ invariant 成立、`ARCH-E-R3-RR1` **不重開**。
處置：依 ① 建議在本 receipt-only commit 順手改為**不帶 literal 數字**之表述（見 §15 R16）。

---

## 15. 維度 A 自審軌跡（PLAN 階段）

**形式**：單 agent 對抗式（`SPEC-E2`，owner 裁定）；主線親自讀真檔／真輸出裁決，
🚫 未使用 multi-agent workflow、🚫 未採信任何未經主線複核之產出。
**紀律**：預設「本文件是錯的」，逐輪嘗試證偽自己下的機械宣稱。

**輪次總計**：R1 → R17，共 **26 條** finding，全部處置完畢；**R17** 為「一輪 0 新發現」。
⚠ R4 / R5 / R6 / R7 皆曾被我寫成或視為「0 新發現」而後被推翻（R7 是被 commit 時的
量測衝突推翻的）；**R9 之後更被外部 ① gate 推翻**（`ARCH-E-R1-RR2`）——
五次皆已就地更正、🚫 未靜默改寫成「一次就 clean」。
**這個軌跡本身就是本節最誠實的產出**，且 R9→① 那次證明：
單 agent 自審對「文件與外部世界不一致」有**結構性偵測上限**，外部 gate 不可被取代。

### R1 — 4 finding（全部為**我方文件的機械宣稱失準**，非設計缺陷）

| # | finding | 處置 |
|---|---|---|
| `SR-1` | 把 base 的「362 raw / 228 unique」誤述為 **dual-leaf 去重**。實測 `tsconfig.functions.json` `noImplicitAny:true`、`tsconfig.tests.json` `noImplicitAny:false` ⇒ **`TS7xxx` 只由 functions leaf 產出、無重複**；228 只是訊息文字去重 | 新增 §6.0 完整改寫；§7.3 同步改為「報數紀律」 |
| `SR-2` | §10.1 `changeUserRole` 命中計數寫成「定義 1 ＋ 註解 2 ＋ 測試 9」，實測為 **註解 3 ＋ 測試 11**（共 15） | 修正並補上量測法與範圍限定 |
| `SR-3` | §2.1 複述 2026-08-12 搜尋的逐項檔數，但該計數本棒未重驗（且與 memory 另一處記載不一致） | 改為只引用**結論**、明示不複述計數 |
| `SR-4` | §7.2 `@ts-expect-error` 放行條件漏寫 `-- ` 前綴；且未寫明 `BAN_PATTERNS` **只套 diff 增量行** | 補齊 |

### R2 — 4 finding（1 條為**實質錯誤**）

| # | finding | 處置 |
|---|---|---|
| `SR-5` ⚠ | §9 把 `lint:migrations` 列為「對齊 ci.yml」的 required gate。**實測 `ci.yml` 恰 7 道、不含它**；它掛在 `npm run build` 鏈上，而 `npm run build` 不是 CI step | §9 拆成 9.1（CI-aligned 7 道，附逐條 step 名）＋ 9.2（非 CI、仍跑、明示非 load-bearing） |
| `SR-6` ⚠⚠ | 斷言「本檔在 `functions/utils/` 下 ⇒ 受 coverage ≥80% 管轄」。**實測 `vitest.config.js` `coverage.exclude` 明列 `functions/utils/audit-log.{js,ts}`** ⇒ 完全不受該門檻管轄；行為守備全在 `test:int` | §9.1 加「自審修正」段；§8 改寫；§8 判準補「coverage 數字不應變動，變動即代表 exclude 失守」 |
| `SR-7` | §4.3 說根因是「已遷移檔案的 JWT payload 型別」，屬未驗證的因果宣稱 | 實測 `requireRole.ts:50` `RoleCheckedUser = { role: string; [claim: string]: unknown }` ⇒ 改寫為「經 **index signature** 解析成 `unknown`」，並標明這是既定設計非單檔標錯 |
| `SR-8` | §2.1 寫其他 15 單元「仍然未定義」，過度斷言 —— 部分有強／中證據 | 改為「未經 owner 裁定落成 artifact」，並分列有證據／零證據兩群 |

### R3 — 3 finding（皆為**缺漏**，非錯誤）

| # | finding | 處置 |
|---|---|---|
| `SR-9` | §6.3 的 emit 證據不可被 gate 重播（腳本在 scratchpad、不在 repo） | §6.3 內聯可重播規格（compilerOptions ＋ 斷言項），並說明刻意不入 repo 以免擴張 allowlist |
| `SR-10` | 未給可證偽的 diff shape，gate ② 無從機械核對 scope | 新增 §5.4.1（changed files 2 / 修改 8 行 / 新增 13 行 / `21 insertions, 8 deletions` / 淨刪 0） |
| `SR-11` | 未寫落地機制（分支／stage 紀律／禁項） | 新增 §5.6 |

### R4 — 4 finding（🚫 **不是** 0；R1–R3 之後仍有新發現）

| # | finding | 處置 |
|---|---|---|
| `SR-12` ⚠ | §4.3 寫「把 `admin_email` 標為 **`string` 或 `string \| null`** 會產生 8 處」，但 Leg B **只量過 `string \| null`**。`string` 未實測，且**理應多**點亮 `role-change.ts:86` | 句子收斂為只述已量之腿；另加「`string` 為**推測非量測**、約 9 處／8 檔」之明確限定 |
| `SR-13` | 文件狀態欄仍寫 `PLAN_DRAFT`，與 §15 宣告自審完成互相矛盾 | 狀態欄改 `PLAN_SELF_REVIEW_CLEAN`，並標明其含義 |
| `SR-14` | §5.2 用「為覆蓋率而寫」當不新增測試的理由，但本檔根本被 coverage exclude ⇒ 理由與事實脫節 | 改成三點式，明示「連補覆蓋率的動機都不存在」 |
| `SR-15` | §5.4 把「9 個 caller」寫得像呼叫點數，實為**檔數** | 改為「9 個檔、12 個呼叫點（10 ＋ 2）」 |

### R5 — 2 finding（🚫 **不是** 0；且兩條都是**自審軌跡本身**的缺陷）

| # | finding | 處置 |
|---|---|---|
| `SR-16` | §15 尾端殘留**一段作廢的「自審誠實邊界」**（寫「11 條中 10 條」的舊版），與新版並存 ⇒ 同一份文件出現兩個互相矛盾的統計 | 刪除舊段，只留一段 |
| `SR-17` | 新版誠實邊界寫「15 條中 **14** 條失準、1 條缺漏」，實際分類為 **12 條失準／矛盾 ＋ 3 條缺漏**（R3 的 `SR-9`/`SR-10`/`SR-11` 皆屬缺漏） | 更正為 12 ＋ 3 |

⚠ `SR-16` 的成因值得記錄：R4 的修正**只替換了標題與結論段**，未檢查被替換段落之後是否還有
同主題的殘留 —— 這正是「族處置不完整」在**文件層**的變體（批 D 曾在 code 層踩四次）。

### R6 — 1 finding（`SR-16` 族**第三次**復發）

| # | finding | 處置 |
|---|---|---|
| `SR-18` | R5 把輪次總計改成「R1 → R6」，但**狀態欄**（文件開頭）仍寫「R1→R5」⇒ 同一事實兩處不一致 | 兩處對齊，並改用機械枚舉重掃全文輪次敘述。⚠ 當時填的 `R1→R7` 後來又因 R8 而過期，於 R9 再次對齊為 `R1→R9` —— 正說明**輪次敘述本身就是一個需要每輪重掃的族** |

⚠ **這正是 `SR-16` 族的第三次復發**（R4 改標題漏掃結論段 → R5 改總計漏掃狀態欄）。
族的定義是「**同一事實在文件中的全部出現點**」，處置時必須**枚舉全族成員**而非只改被指出那處。
R7 起改用機械枚舉（`grep` 輪次字串 / `SR-\d+` 清單 / 「0 新發現」出現點）取代肉眼掃描。

### R7 — 0 新發現（**但非終輪** —— 見 R8）

R7 以**機械枚舉**重核（非肉眼）：
`SR-\d+` 全出現點清單（SR-1..18 皆有定義列）· 「0 新發現」出現點 ·
輪次字串 · 「誠實邊界」段落數（＝1）· 章節交叉引用（§4.3/§5/§6/§8/§9/§10.1）。
在**當時的量測方法下**未再發現新問題。

### R8 — 1 finding（**由 commit 時的量測衝突觸發**，R7 的機械掃描抓不到）

| # | finding | 處置 |
|---|---|---|
| `SR-19` ⚠⚠ | §5.2／§8 寫 `audit-log.test.ts`「177 行」，**錯**，真實為 **187**。根因是 PS 5.1 `Get-Content` 以 cp950 解碼 UTF-8，CJK 行尾把 `0x0A` 當 Big5 trail byte 吞掉 ⇒ **系統性少算**（實測四檔少算 10／22／140／145 行） | §5.2／§8 更正為 187；新增 §7.1.1 把「禁用裸 `Get-Content` 數行」立為機械限制 |

⚠ **這條是怎麼被抓到的，比它本身更重要**：`git commit`（@ `de6cc72f`）回報 `644 insertions`，
而我先前用 `Get-Content` 量同一檔得 438 —— **兩個量測法互相矛盾**。
若當時挑一個順眼的數字報，錯誤就會直接進 gate。
**規則**：同一事實出現兩個不一致的量測結果時，🚫 **不得擇一採信**，
必須查到根因並用**不可被中間層扭曲**的方法（raw byte）定案。

⚠ R7 的機械掃描**設計上抓不到本條** —— 它掃的是「文件內部一致性」，
而 `SR-19` 是**文件與外部世界不一致**。兩種掃描不可互相取代。

### R9 — 0 新發現（**但非終輪** —— 被外部 ① gate 於 `ARCH-E-R1-RR2` 推翻，見 R10）

R9 重掃全文所有數字，逐一標記其**量測法**，並剔除所有以裸 `Get-Content` 取得者：
`tsc` 診斷數（362／10／8／0）· ratchet（362/324→352/325）· emit bytes（6769／6796）·
raw bytes（6786／6614）· 行數（`audit-log.test.ts` 187 · `audit-log.ts` 172 —— 皆 `ReadAllLines`；
**本 plan doc 自身的行數為活動值、須帶 commit 錨點**，見 §7.1.1 表）·
diff shape 預測（8／13／21／8）。未再發現新問題。

### R10 — 2 finding（① R1 remediation 之自審）

處置 `ARCH-E-R1-RR1/RR2/RR3` 後，先做**機械全族枚舉**再宣稱乾淨（`SR-16` 族之教訓內化）：
`644` 全族 · `stage/staged/changed-files` 全族 · `淨改善/硬化/hardening` 全族。

| # | finding | 處置 |
|---|---|---|
| `SR-20` | §14.1 的 `RR2` 處置欄用**行號**（L661／L688）指位，而我在同一輪編輯後行號已漂移到 L739／L767 ⇒ **該引用自己就失效了**，正是 `SR-16` 族在「指位方式」上的變體 | 改用**章節／小節名**指位；並在該處明文禁用行號指位 |
| `SR-21` | §3 `E-OD-1` 裁決列沿用選項標籤的「硬化 7 caller」概數，與 §10.1 實測「至少 9 呼叫點／8 檔」不一致 | 保留 owner 選項原文語意，但加指標到 §10.1 並標「勿沿用概數」 |

### R11 — 1 finding

| # | finding | 處置 |
|---|---|---|
| `SR-22` | R9 的標題仍寫「**0 新發現** ⇒ `PLAN_SELF_REVIEW_CLEAN`」，但它已被 ① `ARCH-E-R1-RR2` 推翻 ⇒ 文件內同時存在**兩個**終輪宣告 | R9 標題改為「0 新發現（**但非終輪**）」並註明被誰推翻。與 R7 的處置同型 —— **終輪標記是一個族，每次新增輪次都必須重掃** |

### R12 — 0 新發現（**但非終輪** —— 其兩項宣稱皆被 ① R2 推翻，見 R13）

R12 以機械枚舉重跑全部族：`644`（全數帶 `de6cc72f` 錨點或在對照表內）·
`stage/staged/changed-files`（三 SSOT 一致）· 硬化宣稱族（⚠ **本句原寫「唯一出現處為明文作廢句」，
經 ① R2 `ARCH-E-R2-RR2` 判定失準 —— 那是**語意分類**結果，被我冒充成 **literal census** 結果。
正確表述與真實計數見 §15.1；本處不再自行給數字）·
輪次敘述（全為 `R1→R17`）· `SR-\d+` 定義列數 · 終輪宣告**恰 1 個** · 誠實邊界段落**恰 1 段**。

### R13 — 2 finding（**皆由 ① R2 抓到，非自審**）

| # | finding | 處置 |
|---|---|---|
| `SR-23` | §7.1.1 表把 `11fa0925 = 690` 標成「**現行值**」，而現行 artifact 已是 `eed35026 / 793` ⇒ **同一節的規則（引用必帶錨點）被該節的表自己違反**。`SR-16` 族第五次復發 | 表格改為**只收 (commit, 值) 不可變配對**、**永不出現「現行值」列**；現行值改為即時量測、不寫進本檔。**這是把「值」換成「規則」的結構性修法**，不是再填一個會過期的數字 |
| `SR-24` | R12 宣稱「`淨改善/硬化/hardening` **唯一出現處**為明文作廢句」 —— 那是**語意分類**結果，被冒充成 **literal census** 結果。① 實測 `淨改善` 4／`hardening` 4／`硬化` 9 | R12 就地標註失準；新增 **§15.1**：真實 literal census（錨定 commit）＋ 逐處分類 ＋ 明確的 oracle 定義 |

⚠ **兩條都不是設計缺陷，但都是治理 artifact 的誠實性缺陷** ——
且**兩條都由外部 gate 抓到、自審沒抓到**。這是 R9 之後**第二次**出現同一結構：
自審能查「文件內部一致」，查不出「文件與外部世界／與自己的量測方法不一致」。

### R14 — 1 finding

R14 重跑機械枚舉，並**新增兩項針對本輪的檢查**：
「現行值」字串在 §7.1.1 表內出現次數（須為 0）· §15.1 census 數字與實跑 census 一致。

| # | finding | 處置 |
|---|---|---|
| `SR-25` | §15.1 分類表的 `HISTORICAL`／`META` 兩格初稿為**手算**的 5／5，實際為 **4／6**。⚠ 合計仍是 17，**光看合計看不出錯** | 改用腳本逐 (行, token) 歸戶（line→class 對照表明列於腳本內、可重播），並斷言 `Σ 分類 == literal 總數`。表格加註此事 |

⚠ **這條的位置最難堪也最有價值**：它發生在一份**專門修正「未驗證數字」的 remediation 裡**。
證明「知道規則」與「執行規則」是兩件事 —— 唯一可靠的差別是**有沒有真的跑那支腳本**。

### R15 — 0 新發現（**但非終輪** —— 被 ① R3 `ARCH-E-R3-RR1` 推翻，見 R16）

R15 以腳本重跑：§7.1.1 **表列內**「現行值」出現數（0；⚠ scope 限定為**表列**，
整節仍有規則句提及該詞 —— 依 ① R3 non-blocking 建議補回「表內」二字消除歧義）·
§15.1 census 與分類（4/4/9；4/4/3/6/0，Σ=17）·
輪次族 · `SR-\d+` 定義列數 · 終輪宣告恰 1 · 誠實邊界恰 1 段。

### R16 — 1 finding（① R3 remediation 之自審）

處置 `ARCH-E-R3-RR1` 後，機械重跑 gate-state 全族（regex `尚未送審|待送|PENDING|CODING_ALLOWED|CHATGPT_ARCH_`）：
**候選命中行全數分類後，`current-state assertion = 0`** ✅（可變 surface 由 2 → 0）。

⚠ 🚫 **此處刻意不寫 literal 命中數**（`ARCH-E-R4-NB1`）：本節初稿寫「命中 4 處」，
但那個數字量於 §14.3 與本節自身落盤**之前**，同一次編輯 session 內即過期
（① 與我方各自重跑皆得 **13 行**）。
**不變式是分類結果（`current-state assertion = 0`），不是 literal 計數** ——
literal 計數會隨本檔每次編輯改變，屬 §15.1 所定義之「不可變快照」類，
須帶 commit 錨點才可引用。

| # | finding | 處置 |
|---|---|---|
| `SR-26` | §14.0 標題「傳輸前置（**3 輪**）」會被讀成「通道之後就正常了」。實測**並非如此**：LF→CRLF 在其後每次傳輸都仍發生（gate R2 packet +1837 B＝1837 CR、gate R3 packet +2069 B＝2069 CR），只是被 `[N0]` 吸收 | 補明「3 輪指造成**阻擋**的輪數」＋逐輪實測數據＋結論「**通道並未被修好，是契約承受住了**」；並禁止後續棒次因「沒再失敗」而改回純文字載體 |

### R17 — **0 新發現** ⇒ `PLAN_SELF_REVIEW_CLEAN`（重新達成）

R17 機械重跑：gate-state 族（current-state 斷言 0）· `CHATGPT_ARCH_*` 全帶輪次或為規則句 ·
§7.1.1 表列「現行值」0 · §15.1 census 4/4/9 與分類 4/4/3/6/0（Σ=17）· 輪次族 ·
`SR-\d+` 定義列數 · 終輪宣告恰 1 · 誠實邊界恰 1 段。

**⚠ 自審的誠實邊界**：26 條 finding 的分類為 **23 條失準／矛盾 ＋ 3 條缺漏**，
**全部**落在機械／宣稱層級，**0 條**是設計層級。
這正說明單 agent 自審的能力邊界 —— 它與主線共享盲點，
🚫 **不構成**「設計正確」之保證；架構級判斷仍以 ① ChatGPT Architecture 與 ② Codex Plan 為準。

**⚠ 特別提請 ①② 注意（兩個高復發族）**：
1. `SR-12` 族 —— 把「只量過 A」講成「A 和 B 都一樣」。批 D 抓出 5 次，本棒 R4 再犯 1 次。
2. `SR-16` 族 —— 族處置不完整（改了 X 卻沒掃 X 的其他成員）。批 D 在 code 層抓出 4 次，
   本棒 R5 在**文件層**再犯 1 次。

3. `SR-19` 族 —— **量測工具本身失真**。同一事實有兩個不一致的量測結果時擇一採信，
   等於把工具的 bug 當成事實。本棒差點如此（@ `de6cc72f`：`Get-Content` 438 vs `git` 644）。

**修過不代表免疫**，請以這三族為重點掃描角度。

---

## 15.1 硬化宣稱族 —— literal census ＋ oracle 定義（`ARCH-E-R2-RR2`）

**為何要分開講**：R12 把「語意分類結果」寫成「literal census 結果」。兩者母體不同，
不可互相代入。以下把**可機械重播的計數**與**語意判準**明確分離。

### (a) Literal census（錨定 `eed35026`；🚫 這是不可變快照，非現行值）

量測法：對該 commit 的 plan doc 內容做**逐字子字串計數**（非行數、非語意判斷）。

| token | 出現次數 @ `eed35026` |
|---|---|
| `淨改善` | **4** |
| `hardening` | **4** |
| `硬化` | **9** |

⚠ 此表**只對 `eed35026` 成立**。本檔每次修改都會改變這些計數（本次 remediation 即再次改變），
故 🚫 **不得**把它當成現行值、🚫 不得寫成「唯一出現處」這類 literal 全稱句。
現行計數一律即時量測，不寫進本檔（與 §7.1.1 行數同一紀律）。

### (b) 逐處分類（@ `eed35026`，17 處全歸戶）

量測法：對 `eed35026` 的內容逐 (行, token) 枚舉，每個占用點以**明列的 line→class 對照表**歸戶
（對照表寫在腳本內、可審可重播，🚫 不藏在散文裡），並斷言 `Σ 分類 == literal 總數`。

| 類別 | 定義 | 處數 |
|---|---|---|
| `NEGATED` | 明文否定或作廢（「不是 hardening」「舊表述已作廢」「不得引為…之證據」） | **4** |
| `HISTORICAL` | gate finding 原文、self-review finding 原文、owner 選項標籤 | **4** |
| `BACKLOG` | 指涉 `TD-BATCHE-1` 的未來硬化工作（明示不在本棒 scope） | **3** |
| `META` | 族名清單本身（如「`淨改善/硬化/hardening` 全族」） | **6** |
| **`LIVE_POSITIVE`** | **主張本棒確實構成 write-boundary hardening 的斷言** | **0** |
| — | **合計** | **17** ＝ literal 總數（4＋4＋9）✅ |

⚠ 本表的 `HISTORICAL`／`META` 兩格初稿曾被我手算成 5／5（合計仍湊成 17，故**光看合計看不出錯**）；
以腳本逐處歸戶後為 4／6。記為 `SR-25` —— **在一份「關於未驗證數字」的修正裡又寫了未驗證數字**。
⇒ 教訓：**合計對得上不等於分項對得上**，分類統計必須逐項機械歸戶。

### (c) Oracle（**這才是不變式**，適用於任何 commit）

> **`LIVE_POSITIVE_HARDENING_ASSERTION = 0`**
> ＝ 本 PLAN 中**不存在**任何「主張 `admin_email: unknown` 構成 write-boundary hardening
> ／建立 write contract ／證明 DB-safe ／closure `TD-BATCHE-1`」的**肯定**斷言。

- **母體限定**：只計**肯定斷言**。🚫 `NEGATED` / `HISTORICAL` / `BACKLOG` / `META` **不計入**。
- **驗證法**：literal grep 取得候選集合 → 逐處判定是否為肯定斷言 → 計數。
  🚫 不得只報 literal 計數就宣稱 oracle 成立，也不得只報 oracle 就宣稱 literal 計數為 1。
- **效力**：本 oracle 為**後續棒次亦須維持**之不變式；`TD-BATCHE-1` closure 前恆為 0。
