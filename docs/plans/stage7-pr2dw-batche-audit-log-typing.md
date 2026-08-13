# Stage 7 · PR-2dw 批 E — `functions/utils/audit-log.ts` noImplicitAny 10 → 0

> **狀態**：`PLAN_SELF_REVIEW_CLEAN`（Dual Gate v3.1；四道外部審查全走）
> ⚠ 此 state 僅表示**維度 A 自審**已達「一輪 0 新發現」（§15，R1→R7）；
> 🚫 **不是** gate 通過 —— ①②③④ 皆尚未送審（§14）。
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
| `E-OD-1` | `AuditLogEntry.admin_email` 型別 | **`unknown`**（否決 `string` ＋ 同棒硬化 7 caller；否決「不標 `entry`、留 2 條」） | 2026-08-13 |

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
1. `unknown` **誠實描述現況** —— 該值是未驗證的 JWT claim。
2. 相對 base 的隱性 `any` 是**淨改善**：`any` 允許任意操作，`unknown` 強制使用端先窄化。
3. 保持本棒為 type-only、scope 1 檔。

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
1. 既有 `tests/integration/audit-log.test.ts`（177 行）已覆蓋 hash chain 正常／三種竄改／
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

### 5.4.1 預測 diff shape（**可證偽**；coding 階段須逐項對上）

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

### 5.6 落地機制

- 分支 `refactor/stage7-pr2dw-batche-audit-log` → PR → **squash-merge**（唯一進 main 路徑）。
  ⚠ 批 D 曾由 owner 明示走非 PR 路徑；那是**當輪例外、不跨輪繼承**，本棒預設回 PR 路徑。
- 🚫 禁 `git add .` / `git add -A`；**明確 stage 恰 2 檔**（§5.4.1），stage 後立即 commit。
- 🚫 禁直推 main、禁 force push、禁 `--no-verify`、禁 amend、禁空 commit。
- commit 前後各核一次 staged set 與 net source diff（防 stray 檔被掃入）。

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
`tests/integration/audit-log.test.ts`（177 行）：

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
| R2 | `admin_email: unknown` 削弱寫入端契約 | 見 §10.1；相對 base 的隱性 `any` 為淨改善，非退化 |
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

| 道 | Gate | 狀態 | 錨點 |
|---|---|---|---|
| ① | ChatGPT Architecture | `PENDING` | — |
| ② | Codex Plan | `PENDING` | — |
| ③ | Codex Code | `PENDING` | — |
| ④ | ChatGPT faithfulness | `PENDING` | — |

---

## 15. 維度 A 自審軌跡（PLAN 階段）

**形式**：單 agent 對抗式（`SPEC-E2`，owner 裁定）；主線親自讀真檔／真輸出裁決，
🚫 未使用 multi-agent workflow、🚫 未採信任何未經主線複核之產出。
**紀律**：預設「本文件是錯的」，逐輪嘗試證偽自己下的機械宣稱。

**輪次總計**：R1 → R7，共 **18 條** finding，全部處置完畢；**R7** 為「一輪 0 新發現」。
⚠ R4 / R5 / R6 皆曾被我預先寫成「0 新發現」而後被自己推翻 —— 三次皆已就地更正、
🚫 未靜默改寫成「一次就 clean」。**這個軌跡本身就是本節最誠實的產出**。

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
| `SR-18` | R5 把輪次總計改成「R1 → R6」，但**狀態欄**（文件開頭）仍寫「R1→R5」⇒ 同一事實兩處不一致 | 改為 `R1→R7`（＝最終真實輪數），並以機械方式重掃全文其他輪次敘述 |

⚠ **這正是 `SR-16` 族的第三次復發**（R4 改標題漏掃結論段 → R5 改總計漏掃狀態欄）。
族的定義是「**同一事實在文件中的全部出現點**」，處置時必須**枚舉全族成員**而非只改被指出那處。
R7 起改用機械枚舉（`grep` 輪次字串 / `SR-\d+` 清單 / 「0 新發現」出現點）取代肉眼掃描。

### R7 — **0 新發現** ⇒ `PLAN_SELF_REVIEW_CLEAN`

R7 以**機械枚舉**重核（非肉眼）：
`SR-\d+` 全出現點清單（SR-1..18 皆有定義列）· 「0 新發現」出現點 ·
輪次字串（`R1 → R7` / `R1→R7`）· 「誠實邊界」段落數（＝1）· 章節交叉引用（§4.3/§5/§6/§8/§9/§10.1）。
未再發現新問題。

**⚠ 自審的誠實邊界**：17 條 finding 的分類為 **14 條失準／矛盾 ＋ 3 條缺漏**，
**全部**落在機械／宣稱層級，**0 條**是設計層級。
這正說明單 agent 自審的能力邊界 —— 它與主線共享盲點，
🚫 **不構成**「設計正確」之保證；架構級判斷仍以 ① ChatGPT Architecture 與 ② Codex Plan 為準。

**⚠ 特別提請 ①② 注意（兩個高復發族）**：
1. `SR-12` 族 —— 把「只量過 A」講成「A 和 B 都一樣」。批 D 抓出 5 次，本棒 R4 再犯 1 次。
2. `SR-16` 族 —— 族處置不完整（改了 X 卻沒掃 X 的其他成員）。批 D 在 code 層抓出 4 次，
   本棒 R5 在**文件層**再犯 1 次。

**修過不代表免疫**，請以這兩族為重點掃描角度。
