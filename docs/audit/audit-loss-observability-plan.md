# audit-loss 觀測強化 Plan（送 Codex Plan Gate）

> Gate State: **PLAN_DRAFT**（自審後 → 送 Codex Plan Gate）
> 來源：ISO-ENUM-1 裁決 §Open Decision A（owner 2026-06-12 via GPT：**拆獨立 tiny PR**）。
> 屬「audit / 安全邊界」敏感熱區 → 走 Dual Gate。獨立於 ISO-ENUM-1 / ISO-CROSS-01。報告語言繁中；code identifier 保留原文。

---

## 1. 問題（根因，跨所有 audit caller）

`functions/utils/safeUserAudit`（`user-audit.ts:65` 起）最外層：

```ts
export async function safeUserAudit(env, entry) {
  try {
    ...
  } catch { /* 表不存在 / D1 暫時失效 — 不擋主流程 */ }   // L162：完全靜默、無 error binding、無 log
}
```

此 catch-all **完全靜默**吞掉所有未被內層 cold_class fallback 處理的錯（含：`event_type` 非 string 導致 D1 `.bind()` throw、`classifyForCold` / `hashIp` 等前置 helper throw、其他非預期 DB 錯）。ISO-ENUM-1 的 audit-row 靜默丟失即經此路徑。即使 ISO-ENUM-1 主修後該端點不再觸發，**「audit 寫入失敗時無任何訊號」這個觀測缺口仍跨所有 caller 存在** —— 任何未來 caller 傳壞 `event_type` 或 DB 異常都會無聲丟稽核。

> 對照：同函式內層 catch 對「missing cold_class column」已有 `console.error`（L119）+ 寫 fallback 訊號 row；唯最外層 catch-all 是啞的。本 PR 讓兩者觀測對稱。

---

## 2. 設計原則（不可破）

- **絕不改「audit 失敗不擋主流程」語意**：catch 仍吞、`safeUserAudit` 仍永不對 caller throw、happy path 零變動。
- **只加觀測**：在 catch-all 內加 `console.error`（CF Workers logs / tail 可見），不改 schema、不改回傳、不改 DB 行為。
- **log 自身不可 throw**：event_type 可能是非 string（正是觸發此 catch 的情形之一），須以安全表示輸出。

---

## 3. 修法（單檔、單點）

`functions/utils/user-audit.ts` 的最外層 catch（L162）：

```ts
  } catch (e) {
    // audit 寫入失敗一律吞（不擋主流程），但不再「靜默」：留 log 訊號供 tail / 監控偵測 audit-loss。
    // event_type 可能非 string（ISO-ENUM-1 類 bug 即此情形）→ 以 typeof + 安全字串輸出，log 本身不得 throw。
    const etDesc = typeof entry?.event_type === 'string' ? entry.event_type : `<${typeof entry?.event_type}>`
    console.error('[audit-loss] safeUserAudit swallowed an error; audit_log row not written', {
      event_type: etDesc,
      message: e instanceof Error ? e.message : String(e),
    })
  }
```

- 僅在已失敗路徑執行 → 正常稽核零 log spam。
- 不記 `entry.data`（可能含 PII；既有 redact 紀律），只記 event_type 描述 + error message。

---

## 4. 測試（Code 階段）

單元測試（不需 D1 整合）：

- 傳 stub `env.chiyigo_db`，其 `prepare().bind().run()` throw 一個**不匹配** cold_class fallback regex 的一般 Error → 觸發最外層 catch。
- spy `console.error`：斷言被呼叫一次、含 `[audit-loss]` marker。
- 斷言 `safeUserAudit` **resolve（不 throw）** —— 鎖定「不擋主流程」語意不破。
- 補一案：`event_type` 傳 function（ISO-ENUM-1 類）→ 斷言 log 不 throw、輸出 `<function>` 描述。

> regression：既有成功 audit 路徑（合法 entry + 可寫 D1）**不**呼叫 `console.error`（無 spam）。

---

## 5. 變更檔案

| 檔 | 變更 |
|---|---|
| `functions/utils/user-audit.ts` | §3：最外層 catch 加 error binding + `console.error`（約 5 行） |
| `tests/`（user-audit 既有 / 鄰近新增單元測試） | §4 |

無 migration、無 schema、無新套件、無其他 caller 改動。

---

## 6. Acceptance Criteria

| 類型 | 目標 |
|---|---|
| unit | 強制 audit 寫入失敗 → `console.error('[audit-loss]…')` 被呼叫；`safeUserAudit` 不 throw |
| unit | `event_type` 為 function → log 安全輸出 `<function>`、不 throw |
| regression | happy path（成功寫入）不觸發 `console.error`；既有 user-audit 測試全綠 |
| 語意 | 「audit 失敗不擋主流程」不變（catch 仍吞、不對外 throw） |
| typecheck / lint / build:functions | clean；ratchet 零新增 |

---

## 7. Non-goals

- 不分類「預期 vs 非預期」audit 失敗（不擴大內層 cold_class fallback 邏輯）。
- 不改 audit schema、不加 DB 寫入（不在失敗路徑再串 DB 寫，避免疊加失敗模式 —— 對齊既有 L139-150 註解紀律：fallback 只 log 不再串 webhook/DB）。
- 不改其他 caller、不動 ISO-ENUM-1 / ISO-CROSS-01。
- 不把 `safeUserAudit` 改成會 throw（critical 路徑另有 notifyCritical，不在本 PR 範圍）。

---

## 8. 註記

- 此 PR 修的是 ISO-ENUM-1 audit-loss 的**根因 choke-point**（跨所有 caller），ISO-ENUM-1 主修則關掉該端點的**觸發路徑**；兩者互補、無相依。
- 與 ISO-ENUM-1 / ISO-CROSS-01 並行，皆於末期 Gate 前 land（owner 定案 I）。

---

## 9. Codex Plan Gate 對照

**CODEX_PLAN_APPROVED**（2026-06-12）。Code-Gate binding condition #3：測試須驗兩面 — 失敗 log 一次且 resolve、成功路徑不 log → **已遵守**（兩個 it：失敗案 assert `[audit-loss]` 出現一次 + `safeUserAudit` resolves undefined；成功案 assert `[audit-loss]` 出現 0 次）。

**Code 狀態**：CODEX_CODE_APPROVED(2026-06-12，findings none) → squash-merged to main `1ad0aec`(branch tip `5180c8c`)。Gate State → **MERGED_MAIN**。
- 測試：`user-audit-loss.test.ts` 2/2 綠；「logs once」案 pre-fix 實測 RED（silent catch → 0 calls）。
- swallow 語意未變（仍不 throw、不擋 caller）；只在已失敗路徑加一筆 `console.error`，正常 audit 零 log。
- ratchet OK（902，零新增）/ lint clean / build compiled。
