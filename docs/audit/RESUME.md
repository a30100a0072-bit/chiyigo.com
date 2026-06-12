# chiyigo 系統級安全審計 — RESUME / 接手工作流程

> **用途**：context 被 `/clear` 或自動 summarize 後,讓 Claude(或你)無痛接回這個多階段審計。
> **設計原則**：所有狀態落在**磁碟 artifact + 本檔**,不依賴對話記憶。任何 context reset 後,讀本檔即可重建全貌。
> **首次建立**：2026-06-12（Fable 5 審計窗 6/12–6/22）。

---

## 0. 為什麼用 /clear（接手者先讀）

審計天生可從磁碟接手:每階段讀不同檔、產出一份獨立報告(`docs/audit/0X-*.md`)。下一階段**只需前面報告的結論**,不需上一階段讀過的檔案內容。故階段邊界 `/clear` 保持每階段推理銳利、避免 context 被 stale file-read 灌爆。

harness 會自動 summarize,但 lossy 不可控;明確 `/clear` + 本檔 = 你控制留下什麼,嚴格更好。**本檔對「是否手動 clear」皆有效**——它是讓任何 context reset 安全的單一事實來源。

**/clear 斷點**：階段邊界。具體=「每個領域報告寫完 + 該 task 標完成」之後。hotfix 類 tight Codex loop 建議留同一 context 到 merge 再 clear。

---

## 1. 鎖定的決策（不可漂移；接手者必守）

- **執行模式**：每領域開 multi-agent **workflow**（Fable 5 finder 並行找線索 → 對抗式 verify(預設 refuted) → 主線 Claude 獨立讀碼裁決 + 綜合）。**不自動啟動大 workflow,等 owner 說「開始 PX」**(大額 token 花費需 opt-in)。
- **P0/P1 finding**：寫 pre-fix 會 fail 的 repro test(local D1 / vitest),轉 Opus regression。
- **P0 處置**：live-exploitable 立即通報 + 提供 hotfix,其餘 defer 進 backlog。
- **Gate**：hybrid(金流後小型校準 + 末期完整 Codex+GPT)。實際因 PAY-002 P0 先轉做 hotfix。
- **finder 紀律**：不重列 inline 已標記為 codex-已修 的問題(除非能證明組合情境下失效);偏好系統級/跨模組/seam,勝過單檔 nitpick。詳見 `00-invariants-threat-model.md §0/§6`。
- **報告語言**：繁體中文;code identifier/欄位/路徑保留原文。
- **PAY-002 = P0 gating confirmed**(owner 2026-06-12 確認 prod 缺三把 ECPay secret;空 env fail-open 已 repro 證實)。ECPay 上線阻斷。
- **PAY-004 業務裁決**(owner via GPT)：deal 成交後客戶**可**自助申請退款,但**不得回退 requisition 主狀態**;走 `refund_request`/`refund_intent`/`refund_status` 生命週期,**不覆寫成交事實**。獨立 PR(P3 backlog)。

---

## 2. Artifact map（磁碟 SoT）

| 檔 | 內容 | 接手用途 |
|---|---|---|
| `docs/audit/00-invariants-threat-model.md` | **SSOT**：共用 infra 心智模型 §2、4 領域不變量 §3、threat model §4、finding schema §5、workflow 骨架 §7 | **每個 workflow finder 都先讀這份**;接手第一份讀的 |
| `docs/audit/01-payments.md` | P1 金流報告(8 findings;PAY-002 P0) | 已完成 |
| `docs/audit/pay-002-hotfix-plan.md` | PAY-002 hotfix plan(送 Codex Plan Gate) | hotfix 進行中 |
| `tests/payments-ecpay-failopen.test.ts` | PAY-002 repro/regression(現 pre-fix FAIL) | hotfix 改完轉綠 |
| `docs/audit/02..05-*.md`、`STAGE8-BACKLOG.md` | (未來) P2-P5 報告 + 最終 backlog | 尚未產出 |

完整 finder/verifier 原文留存:workflow 輸出檔(P1 金流 = `tasks/wfk965gx5.output`,在 temp,可能已清)。

---

## 3. 現況（每次更新此節 + 日期）

**更新：2026-06-12**

- ✅ **P0 起手**(SSOT `00-*.md`)
- ✅ **P1 金流**(報告 `01-*.md` + repro test)
- ✅ **PAY-002 P0 Hotfix**：**Code Gate APPROVED → branch + commit + squash-merge to main（已部署）**。Plan r2 過 Codex Plan Gate；Code 7 檔（getCreds fail-closed 真值表 + EcpayConfigError / parseWebhook 回 ok:false / webhook handler 重用 `payment.vendor.misconfigured` critical + DLQ / `env.d.ts` 補 ECPAY_MODE / vitest binding / adapter 6-case + handler-level regression / MANUAL_TODO go-live）過 Codex Code Gate（adapter 6/6 + integration 91/91 + ratchet OK 零新增 + lint + build:functions 綠）。plan = `pay-002-hotfix-plan.md`（§9 = Codex r1 對照）。**⚠️ prod 現 fail-closed：owner 設齊三把 ECPay secret 才恢復**（`MANUAL_TODO.md §6`）。
- ⏳ **P2 隔離 / P3 事件 / P4 安全邊界 / P5 整合 / P6 backlog**：pending。

> task list(#1-9)是次要 tracker,可能不跨 /clear 存活 → **本節才是權威狀態**。

---

## 4. Resume prompts（/clear 後貼對應這段）

**A) 中途 clear、Codex Plan Gate 回覆來了**
```
繼續 chiyigo 安全審計的 PAY-002 hotfix。先讀 docs/audit/RESUME.md 與 docs/audit/pay-002-hotfix-plan.md。
以下是 Codex Plan Gate 回覆:<貼 Codex 輸出>。據此迭代 plan(若有 blocker)或進 Code 階段。
```

**B) hotfix plan 已過 Codex Plan Gate、進 Code**
```
PAY-002 hotfix plan 已過 Codex Plan Gate。讀 docs/audit/pay-002-hotfix-plan.md,實作 §4 七檔變更,
跑 lint/typecheck/payment 相關 tests/build 全綠,自審到零,整理成可送 Codex Code Gate 的 diff。
```

**C) ★主斷點：hotfix 已 merge → 開 P2**
```
繼續 chiyigo 系統級安全審計。讀 docs/audit/RESUME.md + docs/audit/00-invariants-threat-model.md。
PAY-002 hotfix 已 merge。開始 P2 多租戶隔離審計:依 00 的 §3 INV-ISO-1..7 + §7 workflow 骨架,
開 workflow 整面列舉所有吃 [tenantId]/[userId]/[id] path-param 的端點逐一驗 IDOR + tenant gate,
重點查全域 role 軸 vs platform_role 軸的混淆(00 §2.3)。產出 docs/audit/02-isolation.md。
```

**D) 後續每個領域(P3 事件 / P4 安全邊界)**：同 C 模式,把領域、INV 群、§7 骨架、輸出檔名替換即可。
- P3 事件：INV-EVT-1..10,**首要 INV-EVT-10**(deny-state `denied` bit 是否在 chiyigo-side auth/refresh 被實際 enforce,還是只記不擋)。輸出 `03-event-consistency.md`。
- P4 安全邊界：INV-SEC-1..11,先補讀 `auth.ts` token taxonomy + `scopes.ts`。輸出 `04-security-boundary.md`。
- P5 整合 + P6 backlog：跨領域鏈 + completeness critic → `05-integration.md` + `STAGE8-BACKLOG.md`。

---

## 5. 每個領域 workflow 怎麼跑（給接手的 Claude）

形狀(參考 `00-*.md §7` + 已跑過的 P1 金流 workflow):
1. **Find**：pipeline,N 個 finder 各攻一切角(by-endpoint-enumeration / by-query-grep / by-role-axis / by-IDOR-scenario...)。每個 finder prompt 含:先讀 `00-*.md`(§2 心智模型 + 該領域 §3 INV + §6 紀律)、聚焦檔案清單、hunt 點。schema 強制結構化輸出。
2. **Verify**：對每條候選 finding 並行對抗式驗證(預設 refuted,讀檔核對 evidence,P0/P1 產 repro sketch)。
3. **Synthesize(主線)**：去重、歸 INV、定嚴重度、**獨立讀碼裁決**(駁回臆測、補 finder 漏掉的、不靜默宣稱全覆蓋)、寫報告。
4. **校準**：P0/P1 寫真 repro test 跑過(pre-fix fail)。完成後標 task done → /clear 斷點。

不自動啟動;等 owner「開始 PX」。

---

## 6. /clear 斷點清單

| 斷點 | 時機 | 之後貼的 prompt |
|---|---|---|
| ★ 斷點 1（**← 現在在這**） | PAY-002 hotfix **已 merged** → 可 /clear，用 §4-C 開 P2 | §4-C |
| 斷點 2 | P2 報告寫完 + task done | §4-D(P3) |
| 斷點 3 | P3 報告寫完 | §4-D(P4) |
| 斷點 4 | P4 報告寫完 | §4-D(P5/P6) |
| 末期 | P5+P6 完成 | 送末期完整 Codex+GPT Gate |
