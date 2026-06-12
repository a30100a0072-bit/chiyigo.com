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
| `docs/audit/02-isolation.md` | P2 隔離報告(3 findings:ISO-ENUM-1 P2 / ISO-CROSS-01 P3 / ISO-ENUM-2 P3) | 已完成 |
| `docs/audit/iso-enum-1-fix-plan.md` | ISO-ENUM-1 修補 plan(含 dispatch 顯式化) | PLAN_DRAFT→送 Codex Plan Gate |
| `docs/audit/iso-cross-01-fix-plan.md` | ISO-CROSS-01 manager 邀請 owner-only plan | PLAN_DRAFT→送 Codex Plan Gate |
| `docs/audit/audit-loss-observability-plan.md` | safeUserAudit 靜默 catch 加 console.error plan | PLAN_DRAFT→送 Codex Plan Gate |
| `docs/audit/03..05-*.md`、`STAGE8-BACKLOG.md` | (未來) P3-P5 報告 + 最終 backlog | 尚未產出 |

完整 finder/verifier 原文留存:workflow 輸出檔(P1 金流 = `tasks/wfk965gx5.output`,在 temp,可能已清)。

---

## 3. 現況（每次更新此節 + 日期）

**更新：2026-06-12**

- ✅ **P0 起手**(SSOT `00-*.md`)
- ✅ **P1 金流**(報告 `01-*.md` + repro test)
- ✅ **PAY-002 P0 Hotfix**：**Code Gate APPROVED → branch + commit + squash-merge to main（已部署）**。Plan r2 過 Codex Plan Gate；Code 7 檔（getCreds fail-closed 真值表 + EcpayConfigError / parseWebhook 回 ok:false / webhook handler 重用 `payment.vendor.misconfigured` critical + DLQ / `env.d.ts` 補 ECPAY_MODE / vitest binding / adapter 6-case + handler-level regression / MANUAL_TODO go-live）過 Codex Code Gate（adapter 6/6 + integration 91/91 + ratchet OK 零新增 + lint + build:functions 綠）。plan = `pay-002-hotfix-plan.md`（§9 = Codex r1 對照）。**⚠️ prod 現 fail-closed：owner 設齊三把 ECPay secret 才恢復**（`MANUAL_TODO.md §6`）。
- ✅ **P2 隔離**(報告 `02-isolation.md`)：45 查核對象、INV-ISO-1..7 全覆蓋；隔離面整體健全。workflow `wrx927lm6` 跑 3/6 finder 後撞 session limit，**缺的 3 切角(query-sweep/billing-credit/token-claims)+2 verifier 由主線直接讀碼補完**(無覆蓋缺口)。3 findings 皆**非 live-exploitable 提權/無跨租戶外洩**：**ISO-ENUM-1(P2)** `[action].ts` action allowlist 原型鏈鍵(toString/constructor/__proto__)繞過 404→誤路由 offboard + 該次 HTTP audit row 靜默丟失(owner-only gated、domain outbox 事件仍存活；trivial 修，對照 retry.ts:128 Set-先驗 pattern)；**ISO-CROSS-01(P3)** tenant_admin 可邀 manager 級(tenant_admin/billing_admin)但 PATCH/role 升權 owner-only=授權不一致(需 owner business-rule ruling)；**ISO-ENUM-2(P3, sibling 非隔離面)** `resolvePaymentAdapter` ADAPTERS[vendor]??null，vendor=constructor|__proto__→繞 400→parseWebhook TypeError→500(無狀態變更/無洩漏，併 payments/security backlog；P4 順帶查 kyc/[vendor].ts 同款)。
  - **owner 裁決(2026-06-12 via GPT)**：ISO-ENUM-1 現修不 defer；ISO-CROSS-01 採 option b(manager 級邀請收斂 owner-only)；ISO-ENUM-2 併 payments/security backlog 標 P3 hardening。Claude 推薦預設定案：**D=dispatch 顯式化併入 ISO-ENUM-1 PR、A=audit-loss console.error 拆獨立 tiny PR、I=三顆都在末期 Gate 前 land**。
  - **3 顆 plan CODEX_PLAN_APPROVED → CODEX_CODE_APPROVED → 全 squash-merged to main(2026-06-12)**：
    - ISO-ENUM-1 → main `b28f30f`(branch tip `488b0ce`)：Set(Object.keys(ACTION_EVENT)) prototype-safe allowlist + dispatch 顯式化(else→500)。binding#1 fresh target。
    - ISO-CROSS-01 → main `ce1c2a6`(branch tip `d10c937`)：domain createInvitation 加必填 inviterPlatformRole + inviter_role_insufficient→403；endpoint 傳 gate.role(binding#2，非 token)。~18 既有 test call site 補 'tenant_owner'。
    - audit-loss → main `1ad0aec`(branch tip `5180c8c`)：user-audit.ts 最外層 catch 加 [audit-loss] console.error，swallow 語意不變(binding#3 兩面驗)。
    - ⚠ **squash-merge 後追加 `bf55893`**：ISO-CROSS-01 註解 prose "deny-by-default: any" 內含字面 ": any" 觸 ratchet 禁止 pattern→reword(comment-only)。教訓：ratchet 要**commit/git add 後**再跑(diff-scoped 看不到 uncommitted 註解；branch 上 pre-commit 跑漏了，merged main 才現形)＝[[feedback_ratchet_report_after_git_add]]。
    - **merged main gates 全綠實證**：ratchet OK(current 902/cleanFiles 200，零新增)、lint clean、build:functions compiled；affected tests 51/51(member-endpoints 含兩 PR 合併後仍綠、invitations、event-invited、user-audit-loss)。
    - **DEPLOY RECEIPT(2026-06-12)**：`git push origin main` → **pushed SHA `d59b8b2`**(67fd48b..d59b8b2 ff)。**GitHub CI=success**(lint/ratchet/browser canary/unit≥80%/integration+migration smoke/bundle gate/npm audit 全綠，run 27407369668)。**Cloudflare Pages deploy=success**(run 27407369607，wrangler-action，**無 rollback**)。**credential-free prod smoke 全綠**：home / =200、/login=200(/login.html→308 canonical)、**ISO-ENUM-1 fix 實證 live**(POST `/api/tenants/1/members/2/{toString,__proto__}` no-auth → **404**＝新 allowlist 在 gate 前擋下 prototype key；pre-fix 會是 401)、`.../suspend`=401 + `.../tenants/1/invitations`=401(ISO-CROSS-01 endpoint live) + `.../admin/users/2/ban`=401(全 fail-closed)。3 fix branch 全綠後已 `git branch -D` 刪除。
  - **P2 完全收尾**(報告 + 3 修補全 merged + 綠)。ISO-ENUM-2(P3) 仍在 payments/security backlog(P4 順帶查 kyc/[vendor].ts 同款)。**下一步＝/clear 開 P3 事件一致性**(§4-D，INV-EVT-1..10 首要 INV-EVT-10 deny-state enforcement seam)。
- ⏳ **P3 事件 / P4 安全邊界 / P5 整合 / P6 backlog**：pending。

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
| 斷點 1（✅ 過） | PAY-002 hotfix 已 merged → §4-C 開 P2 | §4-C |
| ★ 斷點 2（**← 現在在這**） | P2 完全收尾(報告 + ISO-ENUM-1/ISO-CROSS-01/audit-loss 三修補全 squash-merged to main + 綠) → 可 /clear 開 P3 | §4-D(P3) |
| 斷點 3 | P3 報告寫完 | §4-D(P4) |
| 斷點 4 | P4 報告寫完 | §4-D(P5/P6) |
| 末期 | P5+P6 完成 | 送末期完整 Codex+GPT Gate |
