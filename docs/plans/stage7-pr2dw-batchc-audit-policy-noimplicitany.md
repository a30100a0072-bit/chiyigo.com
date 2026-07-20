
# Stage 7 PR-2dw 批 C — `functions/utils/audit-policy.ts` noImplicitAny 4→0

**PR id**：`PR-2DW-BATCH-C`｜**級別**：`L1`（type-only、零 runtime、單一 production 檔）
**base**：`787149759f6fdf603992d38fc5575d933f9e27ef`
**定序**：`A✅ → **C** → C2 → D → E → B-read → F → G → H0 → H1 → I → K → L → B-delete → J1 → J2`
（16 工作單元，producer-first + destructive-last；批 A ＝首棒，已 `CLOSED`〔#149 `6aae9570` ＋ closeout #150 `78714975`〕）

## 1. 目標與定位

清除 `functions/utils/audit-policy.ts` 的 **4 條 `TS7006`**，使該檔在
`tsconfig.functions.json`（`noImplicitAny: true`）下歸零。

**本批為過渡性**（批 A OD 裁定「選項 1 僅作過渡」）：
`classifyForCold()` 回傳 inferred `any` 之根因（`const REGISTRY = new Map()` @`:360` 未標型）
**不在本批處理**，屬**批 C2 型別脊椎**——該棒須在 **H1／I／K／L 與 destructive archive API 之前**完成。

## 2. 變更（唯一允許之 source 變更）

3 個 hunk / 3 changed lines / 4 處 `: string`：

| 位置 | 變更 |
|---|---|
| `:372` | `classifyAuditEvent(eventType)` → `(eventType: string)` |
| `:395` | `classifyForCold(eventType, severity)` → `(eventType: string, severity: string)` |
| `:413` | `listEventsByCategory(category)` → `(category: string)` |

**JSDoc `@param {string}` 全數保留未改**（`.ts` 模式下 JSDoc 型別 inert，與 `: string` 語意一致；
repo 既有 25 檔同此慣例，如 `requireRole.ts:113`／`scopes.ts:224`）。

**blob OID**：base `44970d6694de38db7df0e2d551a2ebaebcba75a6` → `7d0b1d371098a71e60ad8af24bc6bfe11bd0cddf`

## 3. 型別決策（三個標的，依據各異）

| 標的 | 現行 scope 內 union 可行性 | 證據狀態 | 否決依據 | OD |
|---|---|---|---|---|
| `severity` | ❌ 不可行（當場 `ADDED>0`） | 已實測 | `it.each` tuple 字面量未加 `as const`、widen 為 `string[]`，解構出 `string` 不可賦值給 union。⚠ ＝「**現行 scope 內**無 union 解」，**非** TypeScript 技術上不可行 | `OD-C1a` |
| `category` | ✅ 可行 | 已實測 | **純 scope 決策**：domain narrowing 統一留 C2，避免不對稱半標型 | `OD-C1b` |
| `eventType` ×2 | ⚠ 未知 | **未實測** | **純 scope 決策**，同上。🚫 禁稱「技術上不可行」 | `OD-C1c` |

⚠ `Object.freeze` **保留字面量型別**（lib.es5 之 `freeze<T…, U extends primitive>` overload
觸發 literal inference）——故 `AUDIT_CATEGORY.*` **未** widen 為 `string`，`category` union 不會炸。
union 可採**具名 alias**（會新增 type alias）或 **inline indexed-access**（不會）；
故 `ARCH-C3` **只能排除具名形式**，禁 union 之唯一操作性依據為 `ARCH-C2`。

## 4. 證據

> ⚠ **狀態欄為誠實性要求，不得省略**：`MEASURED` ＝ 已於 base 實測；
> `ISOLATED_ONLY` ＝ 僅以隔離副本實證、未涵蓋跨檔 cascade；
> `PENDING_CODE` ＝ **CODE stage 驗收目標，尚未量測**。
> 🚫 **禁**把 `PENDING_CODE` 列敘述為既成證據。

### 4.1 已實測（base／scout 階段）

| 項 | 值 | 狀態 |
|---|---|---|
| 目標錯誤 | 恰 4×`TS7006` @ `372:36`／`395:33`／`395:44`／`413:38` | `MEASURED` |
| dual-leaf | **不重複計** —— tests leaf 雖重複 include `functions/**` 但 `noImplicitAny:false`；solution 全建錯誤總行數 `377` ＝ ratchet `errorCount 377` | `MEASURED` |
| ratchet（base） | `377 / 15 / 322 / 337`；baseline `1119/175` 凍結 | `MEASURED` |
| env 存取面 | **ZERO** → single-file、非 Path A、**不觸 L-1／`OR-3`／`H0b`** | `MEASURED` |
| import 面 | **ZERO** → esbuild 單檔 transform 為全保真 | `MEASURED` |
| base blob OID | `44970d6694de38db7df0e2d551a2ebaebcba75a6` | `MEASURED` |
| canonical single-file transform（base vs candidate 副本） | byte-identical：`20846` B、sha256 `f18e7f139b5e2269f8927d2c51386bae35c95a1a29ab9c8cb5a459b94091cc15`、stderr `0` | `ISOLATED_ONLY` |
| 隔離編譯負向對照 | base 副本 **4 errors** → candidate 副本 **0 errors** | `ISOLATED_ONLY` |

### 4.2 CODE-stage 驗收目標（**尚未量測**）

| 項 | 目標值 | 狀態 |
|---|---|---|
| 全域 multiset | `REMOVED=4 / ADDED=0`，四條均為目標 `TS7006` | `PENDING_CODE` |
| ratchet（after） | `373 / 14 / 323 / 337` | `PENDING_CODE` |
| candidate blob OID | `7d0b1d371098a71e60ad8af24bc6bfe11bd0cddf`（pre-commit ＋ post-commit 兩時點） | `PENDING_CODE` |
| canonical transform **三面**（base／working-tree／committed blob） | 同 `20846` B、同 sha256、stderr `0` | `PENDING_CODE` |
| CI 七道 | 全綠（`test:int` 須附完成性 receipt：`77` files／`1377` tests） | `PENDING_CODE` |

⚠ **`4.2` 全部項目於本 doc 落盤當下皆未成立**；其實測結果由 CODE stage 產出，
receipt 依 `## 9` 規則處置。🚫 在取得實測前，**不得**宣稱本批相容性或型別安全已成立。

⚠ **canonical transform 證據之範圍**：證明型別標註未改變**該 transform 之輸出**，
🚫 **不是** production bundle identity；且該 transform **剝除註解**，對「僅改註解」不敏感
→ 須與 §2 hunk allowlist **併用**（兩支柱聯合證明，PR-2dt ① `RR2`）。

## 5. 消費面

| 消費者 | 用到的 export |
|---|---|
| `functions/utils/user-audit.ts:71,83` | `classifyAuditEvent`／`classifyForCold` |
| `functions/utils/audit-archive.ts:716` | `classifyForCold`（**F-3 受保護檔，僅 import、零修改**） |
| `functions/utils/audit-aggregate.ts:227` | `classifyForCold` |
| `functions/utils/audit-aggregate-debug.ts:333` | `classifyForCold` |
| `tests/audit-policy.test.ts` | 全 4 export |
| `tests/integration/session-revoke-multi.test.ts:22` | `_registrySize`（維持 `228`，未改） |

production 端 4 個 call site 之實參靜態型別皆為 `any`；test 端皆為 `string`。

## 6. F-3 隔離

```text
F3_POSTURE           = DORMANT_WAIT_ONLY
F3_FILE_EDIT_POLICY  = CONDITIONAL_ACTIVE
F3_FILE_EDIT_TRIGGER = NOT_TRIGGERED      # 本批零修改受保護三檔
```

`tests/audit-archive-forensic-classify-parity.test.ts` 鎖的是 **R2 key derivation**
（`deriveKeysFromChunk`／`deriveAggregateKeysFromChunk`，把 `cold_class` 當**輸入欄位**讀），
**不呼叫 `classifyForCold`** → 與本批**耦合度為零**。
該測試為 **`SUPPLEMENTAL ONLY`**：可跑，但🚫 不列 Required gate、🚫 不改變 `F3_FILE_EDIT_TRIGGER`、
🚫 不構成「F-3 已驗證」之依據。

## 7. 宣稱用語紀律（owner lock 續行）

- ✅ 可宣稱：「批 C 清除 `audit-policy.ts` 之 4 條 `TS7006` noImplicitAny 診斷」
- ❌ 禁宣稱：「audit 域型別安全」／「audit-policy 已完整標型」／「F-3 已驗證」
- ❌ 禁宣稱：「零 API／零 public type contract 變更」／「零契約新增」
- **契約正式表述**：無新 export、零 runtime；但既有 exported signatures 的 compile-time
  contract **會由** implicit `any` **收窄為** `string`；現有 repo consumers 相容性
  **須於 CODE stage 以全域 `ADDED=0` 驗證，驗證完成前不得宣稱已成立**。
- **L1 判級依據**（SPEC `OD-C5` APPROVE，前提＝上述契約描述已更正）
  ＝「零 runtime、單一 production 檔、預期變更面有限」，非「契約未變」、
  非尚未取得之相容性證據。⚠ 判級為**預判／維持條件**：若實測 `ADDED≠0` 則 L1 失效、停手回 Plan Gate。

## 8. 未結項與後續棒次

| 項 | 狀態 |
|---|---|
| `REGISTRY` 標型 ／ `classifyForCold` 具名回傳型別 ／ 三處 domain union | → **批 C2**（須在 H1／I／K／L 與 destructive archive API 之前） |
| L-1：`AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN` 未宣告於 `env.d.ts` | → 批 **L**／**`H0b`**（`OR-3`：**不得**夾帶進批 H0）。**本批零交集** |

## 9. Gate 軌跡

| 階段 | 狀態 |
|---|---|
| SPEC | `SPEC_APPROVED` @ R4（normalized sha256 `d844e0a8f42a43201e986860f2046a585d7f97458c6d075a2186fd261899b67b`、`34196` bytes；R1 4 Required＋2 NB → R2 2 Required → R3 1 Required → R4 approve） |
| ① ChatGPT Architecture | `CHATGPT_ARCH_APPROVED_WITH_LOCKS` @ PLAN R8（錨定 sha256 `a0028f1a53d5fc756c22bed8fc8d7cef03e605ef6bb161620cb5f33dade18ac8`、`45039` bytes；R1 6 → R2 5 → R3 1 → R4 1 → R5 1 → R6 approve；經 ② R1 後重審 R7 2 Required → R8 approve） |
| ② Codex Plan | `CODEX_PLAN_APPROVED` @ PLAN R8（錨定 sha256 `a0028f1a53d5fc756c22bed8fc8d7cef03e605ef6bb161620cb5f33dade18ac8`、`45039` bytes；0 Critical / 0 Required / 0 Non-blocking；R1 1 Required〔`CODEX-BC-PLAN-R1`〕→ R2 approve） |
| ③ Codex Code | 核發後以 **docs-only commit append 於檔末 receipt 區**（本表不回填） |
| ④ ChatGPT Faithfulness | 🚫 **本 PR 內不記錄** —— 見下方「④ 自我收據悖論」 |

> ⚠ **①② vs ③ vs ④ 三段處置刻意不同**：
> - **①②** 於 `CODING_ALLOWED` **之前**即已核發，落盤當下為已知事實 → 直接填入。
> - **③** 於落盤後核發，可於 **④ 之前**以 docs-only commit append —— 該 append 本身仍會被 ④ 覆核，無悖論。
> - **④** 🚫 **禁在本 PR 自我追加**。
>
> ### ⚠ ④ 自我收據悖論（① `GPT-BC-ARCH-R6`）
>
> ④ 的審查標的是**某個確定的 commit**。若在 ④ 核發後把 ④ receipt append 進本檔，
> 該寫入**必然產生新 commit**，使 HEAD **移離 ④ 所審之 anchor** ——
> 於是「④ 已核准的樹」與「實際 merge 的樹」不再是同一個，receipt 自身證偽了它所宣稱的事。
>
> **處置（三選一，由 owner 於 ④ 核發時指定）**：
> 1. ④ receipt 存 **repo-external packet**（`~/Desktop/chiyigo-packets/`），本 PR 不動；
> 2. ④ verdict 僅記於 **squash commit body**（merge metadata，非本檔）；
> 3. merge 後另走 **docs-only closeout PR**（走完整四道）或明確的新窄 gate。
>
> 🚫 本表 ③④ 兩列**永不編輯**。



