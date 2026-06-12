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
- **PAY-004 業務裁決**(owner via GPT)：deal 成交後客戶**可**自助申請退款,但**不得回退 requisition 主狀態**;走 `refund_request`/`refund_intent`/`refund_status` 生命週期,**不覆寫成交事實**。獨立 PR(**窗內 land**,見下擴編裁決)。
- **窗口擴編(owner 2026-06-12 第二輪拍板;細節=00 doc §1/§3/§4/§6 擴編段)**：
  - 修復紅線:**P0–P2 窗內修**(Dual Gate,沿 ISO 三顆前例,各域收尾時即修);P3 留 Opus 6/26,但窗內寫好 pre-fix-fail regression pack(expected-fail/`.skip` 進 repo)。
  - 加深:P3/P4 並發競態**實測**(非僅讀碼推理)、P4 全端點四欄矩陣(gate×validation×rate-limit×audit)、projection/狀態機 property-fuzz、**P2 也強制 repro**、P3/P4 報告完各一次小校準 Gate、P5 後 loop-until-dry 第二輪。
  - 加寬:**P7 設定/環境漂移+CI 供應鏈**(`06-config-supply-chain.md`)+**P8 前端 client-side**(`07-frontend.md`);DoS/觀測併入 P4 矩陣;跨 repo SSO 僅餘裕再議;**F-3 pipeline 不審**(DORMANT 紀律)。
  - **末期完整 Codex+GPT Gate 提前進窗內(目標 6/19–6/20)**,findings 當場 Fable 5 處置;6/23–25 變 buffer。
  - 草案時間軸:6/13–14 P3+P4 → 6/15–16 P5+P7 → 6/17–18 P8+窗內修+PAY-004 → 6/19–20 末期 Gate → 6/21–22 buffer/backlog 定稿。
  - **Stage 7 維持暫停**:審計包接近完成時 owner 動態裁決是否解除。
- **EVT-003 裁決(owner 2026-06-12 via GPT,第三輪)**：(1) reuse `account.disabled`+optional `reason:'account_deleted'`,不新增事件型別、不動 0051 CHECK;(2) membership 殘留**同一顆 PR**修(同 transaction offboard+每筆 emit member.offboarded);(3) users hard-delete 必加 CAS guard;repro 三要件=delete 成功 emit/membership emits/重複 delete 不重複 emit;(4) 修補批次=consumer-hardening(EVT-001+002 併)+delete-emit(EVT-003)+audit-redaction(EVT-006 tiny)。**OD-1 sole-owner fork 待 owner 裁**(plan 預設 A=409 fail-closed)。
- **⚠ push 政策變更(owner 2026-06-12)**：**不再直接 push main**(含 docs(audit) 狀態 commit——舊慣例作廢)。一律 feature branch → PR → squash merge。本地 main 上的未推 commit 以 branch 化補救,禁硬推。

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
| `docs/audit/03-event-consistency.md` | P3 事件報告(6 findings:EVT-001..003 P2×3 / EVT-004..006 P3×3；4 條對抗式駁回) | 已完成 |
| `docs/audit/evt-consumer-hardening-fix-plan.md` | EVT-001+002 修補 plan(觀測欄位+failTransition 對齊+DLQ list 端點) | PLAN_REVISED(Codex r1 修畢)→送 Codex 確認 |
| `docs/audit/evt-delete-emit-fix-plan.md` | EVT-003 修補 plan(account.disabled reason+membership offboard+CAS;OD-1=A/OD-2=409/OD-3=已核對) | PLAN_REVISED(Codex r1 修畢)→送 Codex 確認 |
| `docs/audit/evt-audit-redaction-fix-plan.md` | EVT-006 tiny plan(device_uuid HMAC16) | PLAN_REVISED(Codex r1 修畢)→送 Codex 確認 |
| `docs/audit/04..05-*.md`、`06-config-supply-chain.md`、`07-frontend.md`、`STAGE8-BACKLOG.md` | (未來) P4-P5 報告 + P7 config/CI + P8 前端 + 最終 backlog | 尚未產出 |

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
- ✅ **窗口擴編裁決**(2026-06-12 owner 第二輪)：節奏遠快於原 7 段預估(6/12 一天消化 P0+P1+hotfix+P2,原排程會在 ~6/15 跑完留 6-7 天空轉) → 全包採納:加深(競態實測/P4 全端點矩陣/P2 repro/每域小校準/第二輪 dry)+加寬(P7 config/CI、P8 前端)+**P0–P2 窗內修**+末期 Gate 提前進窗(目標 6/19–6/20)+PAY-004 窗內 land+Stage 7 暫停待動態裁決。已寫入本檔 §1 與 00 doc §1/§3/§4/§6。
- ✅ **P3 事件一致性**(報告 `03-event-consistency.md`，2026-06-12)：workflow `wf_7c8052a4-b32` 4/4 切角完整(emitter-splice/consumer/projection-replay/enforcement-seam)＋對抗式 verify(尾端 3 verifier 撞 session limit→主線補裁，全駁回)。**INV-EVT-10 headline：「記了不擋」不成立**——projection 未被消費是 owner LOCKED by-design，每個 deny 事件都有獨立 live enforcement(報告 §1 對照表)；INV-EVT-1..9 機制面整面驗證全綠。**6 findings**：EVT-001(P2 dead-row HOL 阻塞零持續觀測+無 DLQ list 端點)/EVT-002(P2 prior-read/noop 在 failTransition 保護外→orphan 無 backoff 誤 DLQ)/EVT-003(P2 hard-delete 不 emit account.disabled+UPDATE users 無 CAS；streamSeq 不可事後補發故 P2)/EVT-004(P3 poison quarantine 工具+runbook 缺位)/EVT-005(P3 事件四表 retention；deny_state+session-sequences 累積=新發現)/EVT-006(P3 admin/revoke device_uuid 明文 audit)。**4 駁回**：product_access(F-2 裁決 deferral)/token-epoch(契約明文+NEGATIVE test)/device-mismatch(owner D6 DEFER)。
  - EVT-003 scope 已裁(§1 第三輪)；3 顆 plan r1=Revise→5 findings 全修→**r2 CODEX_PLAN_APPROVED(無 blocker)**。OD-1=A·OD-2=409·OD-3=已核對全定案。**Codex r2 Code-Gate watch items**：(a) DLQ list `before=<id>` 須 deterministic `ORDER BY id DESC`；(b) delete-emit 的 batch-level CAS 直測不得無謂擴大 public runtime surface。
  - **Code 階段進行中**：實作順序 audit-redaction(EVT-006 暖身)→consumer-hardening(EVT-001+002)→delete-emit(EVT-003)，各自 feature branch+PR+squash，repro pre-fix 紅→實作→gates 全綠→Codex Code Gate→merge。docs PR #66(報告+3 plan)squash-merge 當 lineage base。全 land 後→小校準 Gate→/clear 斷點 3 開 P4。
- ⏳ **P4 安全邊界 / P5 整合+第二輪 / P7 config+CI / P8 前端 / P6 backlog**：pending。

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

**D) 後續每個領域(P3 事件 / P4 安全邊界 / P7 config / P8 前端)**：同 C 模式,把領域、INV 群(或 hunt 種子)、§7 骨架、輸出檔名替換即可。
- P3 事件：INV-EVT-1..10,**首要 INV-EVT-10**(deny-state `denied` bit 是否在 chiyigo-side auth/refresh 被實際 enforce,還是只記不擋)。**加深**:outbox claim/sweep owner-CAS + webhook dedupe 三態並發**實測** repro、projection seq property-fuzz。輸出 `03-event-consistency.md` + 小校準 Gate + P2 級即修。
- P4 安全邊界：INV-SEC-1..11,先補讀 `auth.ts` token taxonomy + `scopes.ts`。**加深**:全端點四欄矩陣(gate×validation×rate-limit×audit,不只 tenant-scoped)、refresh rotation race 實測、`webhooks/kyc/[vendor].ts` ISO-ENUM-2 同款複查。輸出 `04-security-boundary.md` + 小校準 Gate + P2 級即修。
- P5 整合：跨領域鏈 + completeness critic + **loop-until-dry 第二輪**(起手缺口:`webhook-dlq.ts`/`aggregate.ts`/`payment-return/ecpay.ts`;連兩輪零新發現才收) → `05-integration.md`。
- P7 config/CI：00 doc §3 P7 hunt 種子(env.X vs Env vs wrangler.toml/MANUAL_TODO 三方對帳 + Actions pinning + migration up/down + 依賴 pin) → `06-config-supply-chain.md`。
- P8 前端：00 doc §3 P8 hunt 種子(XSS sinks / client token 紀律 / 跨分頁同步信任面 / CSP 回歸) → `07-frontend.md`。
- P6 backlog：全部域收齊後 → `STAGE8-BACKLOG.md`(含留給 Opus 的 regression pack 清單)。

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
| 斷點 3 | P3 報告寫完 + 小校準 Gate + P2 級即修 merged（目標 ~6/13） | §4-D(P3→P4) |
| 斷點 4 | P4 報告寫完 + 小校準 Gate + P2 級即修 merged（目標 ~6/14） | §4-D(P5) |
| 斷點 5 | P5 整合 + 第二輪 dry(連兩輪零新發現)（目標 ~6/15–16） | §4-D(P7) |
| 斷點 6 | P7 config/CI 報告完 + P2 級即修 merged（目標 ~6/16） | §4-D(P8) |
| 斷點 7 | P8 前端報告完 + 窗內修收尾 + PAY-004 PR + regression pack（目標 ~6/18） | 末期完整 Codex+GPT Gate(**提前進窗,目標 6/19–6/20**) |
| 末期 | Gate findings 處置 + `STAGE8-BACKLOG.md` 定稿（~6/21–22） | Stage 7 是否解除暫停＝owner 動態裁決 |
