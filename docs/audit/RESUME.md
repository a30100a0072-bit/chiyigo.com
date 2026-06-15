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

**更新：2026-06-15**（#82 SEC-REFRESH ✅ MERGED `452b478` / #83 OD-3 enforcement ✅ MERGED `a01d9571`+deploy；**FACTOR-ADD 前端 elevation 接線：已確診 + Stage 1 plan 進行中（插隊，排在回 Stage 7 strict 之前）**——接手讀本塊 + `docs/audit/factor-add-frontend-wiring-plan.md`）

- ✅ **SEC-REFRESH-REUSE（P1）MERGED #82 `452b478`**、**OD-3 enforcement MERGED #83 `a01d9571`+Cloudflare deploy success**（逐階段細節見 memory topic `project_security_audit_2026`；本檔下方 06-13 塊裡「enforcement PR … Phase 2 coding 中」「SEC-REFRESH … 下一步 Phase 2 coding」等描述**已被這兩個 merge 取代**，未逐字回填以免 scope creep）。
- ⚠ **FACTOR-ADD 前端 elevation 接線（現行主線；插隊在回 Stage 7 strict 之前）**：
  - **已確診（2026-06-15，非 OD-3）**：owner 解綁 Discord 後重綁失敗 toast `Factor-add elevation required` ＝ `FACTOR_ADD_GRANT_REQUIRED`。#78（PR-A3 `7ae5558`）對 `oauth/[provider]/init.ts`（`is_binding` 分支）／`webauthn/register-verify.ts`／`wallet/verify.ts` 三條 factor-add 入口加 `requireFactorAddGrant`（需 `X-Factor-Add-Grant` header），但 **SEC-FACTOR-ADD-A §11 staged PR（PR-0/A1/A2/A3/A4）從頭就沒排前端接線顆** → `src/js/dashboard.ts` 的 `bindProvider`(770)／`addPasskey`(1742)／`addWallet`(1953) 三條全裸打端點、從不鑄 grant、連 callback 回跳的 `#elev_exchange` fragment handler 都不存在 → **passkey 新增／wallet 綁定／所有 OAuth-identity 綁定自 2026-06-13 prod 全壞**。登入既有 factor、移除 factor 不受影響（＝解釋 owner 能解綁卻不能重綁）。**git 鐵證**：#78 改檔 zero 前端；#83 只動 `init.ts` 的 `isElevation` 分支、非 `isBinding` 403 路徑。**fail-closed＝無安全破口**，屬 P1 可用性 regression。
  - **為何全綠 PR 仍出壞 feature**：`tests/integration/_helpers.ts:383 seedFactorAddGrant` 直接 INSERT `elevation_grants` 並回傳明文 token 給 header，integration test 全程繞過前端 ceremony；無 dashboard 全鏈路 E2E。
  - **owner 裁＝Option 2 + 插隊現在跑**：**Stage 1**＝純前端 TOTP/password elevation（`obtainFactorAddGrant(action)` helper 依 `__totpEnabled`/`__hasPassword` 收 OTP/密碼 → `POST /api/auth/elevation/{totp,password}` → grant → 三條 caller 帶 `X-Factor-Add-Grant` header；OAuth-only 帳號顯示引導文案），解 owner（有 TOTP）+多數；**Stage 2**＝OAuth-only 的 OAuth-reauth elevation（`init?purpose=elevation` roundtrip + `#elev_exchange` fragment resume + `/elevation/exchange`）follow-up。**後端零改、無 migration。**
  - **狀態**：branch `feat/factor-add-elevation-ux`；plan `docs/audit/factor-add-frontend-wiring-plan.md` ＝ **dimension-A self-review workflow ✅（`wf_2ccd9b1b-41c`，7 維 14 accepted → 主線獨立裁決套入，見 plan §12；無 Tier-0 洞、無需後端改動）→ 送 ChatGPT Arch Gate + Codex Plan Gate（Dual Gate v3）**。**尚未進 Code 階段**（plan 過 gate 才 coding）。

**更新：2026-06-13**（窗內修執行：P4 報告 + #72/#73/#74/#75 merged + prod migration 0054；接手讀本節「窗內修執行」段 + `sec-factor-add-a-fix-plan.md`）

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
  - **Code 階段進行中**：實作順序 audit-redaction(EVT-006 暖身)→consumer-hardening(EVT-001+002)→delete-emit(EVT-003)，各自 feature branch+PR+squash，repro pre-fix 紅→實作→gates 全綠→Codex Code Gate→merge。docs PR #66(報告+3 plan)已 squash-merge 進 main(`30e5a75`)當 lineage base。
    - **EVT-006 ✅ MERGED**：PR #67 → main `700c2f5`(squash)。Code Gate r1=test-only revise(partial 路徑漏鎖)→在既有 session-revoke-multi forced-batch-error harness 補 EVT-006 斷言(commit `8e6c1fd`，pre-fix RED 實證`'dev-Z' to be undefined`)→r2 APPROVE。device_uuid 改 keyed-HMAC(sig.hex.slice(0,16)+salted)，ok+partial 兩 leak site 共用單一 deviceAudit 皆鎖。教訓：原始 finding 的精確 leak/failure site 必用 pre-fix-RED 鎖好，別拿「共用邏輯已覆蓋」當略過理由。
    - **EVT-001+002 ✅ CODE 完成→待 Code Gate**：PR(branch `fix/evt-001-002-consumer-hardening`，commit `942e11a`)。EVT-002＝deliver() prior-read/noop 納入 failTransition 保護(transient fault→bounded retry，非 orphan 誤 DLQ)；EVT-001a＝run report+consumer_run audit 加 `blocked_backlog`/`oldest_blocked_age_s`/`dlq_unreplayed`，severity warn on (dlq>0‖blocked>0)，blocked stream 每 run 持續可見；EVT-001b＝`GET /api/admin/event-dlq` list 端點(requireRole admin+admin:events:replay 無 step-up、redacted DTO stream_key_hash、deterministic ORDER BY id DESC + before cursor)、新 read-audit type `domain.event.dlq_list`(registry 208→209 兩處斷言同步)。gates：81/81 event tests+audit-policy 121/121、ratchet OK(902 零新增)、lint clean、build 綠。pre-fix RED 已驗(EVT-001/002 三案 `expected +0 to be 1`/`undefined to be 1`)。⚠ **過程教訓**：pre-fix 驗證用 `git checkout HEAD -- file` 在未 commit branch 上會還原到 main(=clobber 我的 fix)→應先 commit/stash 再做 checkout 類驗證([[feedback_parallel_track_staging_collision]] 同類)。
    - **EVT-001+002 ✅ MERGED**：PR #68 → main `07650f8`(squash)。Code Gate r1=Medium(limit parseInt→NaN bind)→`/^\d+$/` 守衛+malformed 測試(pre-fix RED 用 stash 驗)+finance 403 → r2 APPROVE。
    - **EVT-003 ✅ MERGED**：PR #69 → main `8c0b60a`(squash)。hard-delete 改 emit `account.disabled(reason='account_deleted')`(frozen optional key，無新 type、不動 0051 CHECK)+同 batch offboard org membership 每筆 emit `member.offboarded`(personal 排除)+users CAS(`deleted_at IS NULL`)+token atomic consume+sole-owner 409(OD-1=A，token 不消耗)+N>17→409(OD-2)+membership_skipped/overflow 兩新 immutable audit(registry 209→211)+requisition soft-delete 原樣保留+OD-3 unban deleted→404 negative test。emitAccountDisabled 加 optional reason。Code Gate r1=test-only revise(3 覆蓋缺口：OD-1 TOCTOU membership_skipped〔plan 標必驗，db.batch spy 製造 race〕/A3c 並發同 token/OD-2 overflow)→補測(commit `395c81a`，13/13)→r2 APPROVE。**過程**：補 `password_resets` 進 test `_setup.sql`、踩 `_setup.sql` 註解禁含 `;`(resetDb split) 教訓。
- ✅ **P3 三顆 P2 級窗內修補全 MERGED**(EVT-006 #67 / EVT-001+002 #68 / EVT-003 #69)。P3 P2 級收尾。EVT-004/005/006-adjacent P3 項留 STAGE8 backlog/Opus。
  - **小校準 Gate 裁決＝A（owner 2026-06-12）：P3 不單獨跑校準輪，`03 §6` 5 問併入末期完整 Gate（6/19–20）checklist**（理由：3 顆 Code Gate 已實作層深審 §2.4 心智模型）。
- ✅ **P4 安全邊界**(報告 `04-security-boundary.md`，2026-06-13)：workflow `wf_f3de1587-402`(task `wvq6s2fn4`) 7 finder(4 矩陣鋪全 **104 端點四欄矩陣** + 3 深潛)＋對抗式 verify。⚠ **3 個 dd-strong-auth verifier 昨夜撞 session limit 失敗→主線今日親自讀碼補裁(含 headline P1，無覆蓋缺口)**。**INV-SEC-1 gate 面整面健全(無裸奔端點)**；缺口全在非-gate 軸。**8 findings(confirmed)**：
  - **3×P1**：**SEC-FACTOR-ADD(headline)**＝新增 passkey/wallet 只需 requireAuth(移除才需 step-up)+reset/bump 不清因子+passkey 登入不檢查 2FA→偷 15min token 永久接管+繞 2FA(register-verify.ts:38／wallet/verify.ts:41 vs credentials/[id].ts:74 step-up；bumpTokenVersion 不刪 credentials)。**SEC-RESET-2FA-BF**＝reset-password TOTP 失敗不消耗 token+零 RL+零 audit→1h 窗無限暴破 ~333k 碼(reset-password.ts:84-124；2fa/verify.ts:66-77 同 helper 有 RL 證明 convention 遺漏)。**SEC-REFRESH-REUSE(需 owner 架構裁決)**＝reuse 偵測不撤 family→被盜 token 持久隱形 session；**但 naive casByFamily 修法會重開 Fork2 round-2 H 刻意關閉的反向向量**(revoked token 反殺 live successor)→§5 先 owner 裁 tradeoff。
  - **2×P2**：**SEC-CEREMONY-DOS**＝authorize/login-options/login-verify 匿名無 RL+每請求寫 D1+`webauthn_challenges` 不在 cleanup→無界灌 D1 額度+表膨脹(兩 finder 獨立命中)。**SEC-ADMIN-ENUM**＝admin/users GET 枚舉全站 email PII 無 RL+無 read-audit(vs 5 個同類 list 端點皆有)；metrics.ts 另洩 raw IP top-5。
  - **3×P3(報告列)**：SEC-KYC-ENUM-2(resolveKycAdapter 原型鏈，本輪明確複查項確認，與 ISO-ENUM-2 同批修)／SEC-CRON-TIMING(8 cron 非 timing-safe)／SEC-LOGOUT-CSRF(logout CT 豁免+無 Origin→強制登出)。
  - **2 駁回**：IdP 無 client_id 綁定(PKCE S256+redirect_uri exact+per-aud 已等價擋 code injection→P3 spec-compliance)／bind-email body.aud(5 端點共用標準 pattern，audience 隔離擋的是跨 RP 互打非自取)。**另 13 條 P3 進 backlog(報告 §6)**。
  - **P4 小校準 Gate ✅ 完成(2026-06-13，雙 Gate APPROVED WITH CORRECTIONS)**：ChatGPT Arch Gate(Q1-Q5 全裁：Q2 ADD-A 足夠/Q3 選 B/Q4 client_id first-party 接受)＋Codex Plan Gate。報告 PR **#71**(docs-only，補 OAuth binding 第三路徑)＝**MERGE_ALLOWED 待 owner 明示**。**兩條 Codex binding 校正(code 前必落 plan)**：
    - **PT-6＝code 前置 BLOCKER(非 residual)**：step-up 強制 totp_enabled(step-up.ts:108)+ change-password 本身需 step-up → 無 TOTP/純 OAuth 用戶無 elevation bootstrap。**reject first-factor-add 豁免**(否則被盜 token 仍能加第一把 rogue factor、P1 沒關)。ADD-A 二選一寫死：**嚴格版**(no-TOTP/no-password 先走 dashboard email reset 設密碼 dashboard.ts:1022/forgot-password.ts:32 → 啟 TOTP/step-up → 才能 add factor)／**UX 版**(擴 elevation primitive：local no-TOTP 用 current_password；OAuth-only 須對既綁 provider 重新 OAuth reauth 才 mint elevated:account)。**禁用「剛登入/token still fresh」當 elevation**(=被盜 token 前提)。**↑ owner 裁 strict vs UX**。
    - **PT-2＝refresh sub-path 明確拆**(禁把 reuse_detected 當單一觸發 refresh.ts:164)：successor_token_hash NULL(logout/admin/device 已撤)→**不**family-revoke、**不**critical theft audit、最多 warn/no-op 401；grace_device_mismatch(refresh.ts:133)→**不**撤;proven benign grace orphan→**不**撤;**唯 rotation-revoked 且非 proven benign**(out-of-grace/device-null candidate/dead-missing successor)→才用**被呈現 token 的 session_id family** revoke + idempotent audit + abuse cap。
    - **Observability(Codex)**：ADD-A 保留三路 factor-add audit;SEC-REFRESH 把 no-op replay／family-revoke／abuse-cap 命中拆成可查 reason code。**PT-5 確認**：3 路(register-verify/wallet-verify/oauth init is_binding)窮舉;bind-email **非**第四條(temp_bind 一次性 + email collision 拒)。
  - **CODING 狀態**：**P2 機械補強(SEC-CEREMONY-DOS+SEC-ADMIN-ENUM+SEC-KYC-ENUM-2)+ SEC-RESET-2FA-BF = CODING_ALLOWED**(不受兩校正阻擋);**ADD-A / SEC-REFRESH = NOT YET CODING_ALLOWED** until PT-6(owner strict/UX)+PT-2 拆解落 plan。
  - **PT-6 終裁＝UX-safe now(owner 2026-06-13，覆蓋原 strict vs UX 分叉)**：ADD-A 採 UX-safe elevation primitive(有 TOTP 用既有 step-up／local 有密碼無 TOTP 用 current_password／OAuth-only 對既綁 provider reauth → mint short-lived `elevated:factor_add` grant)，先過 Plan Gate；嚴格版(強迫設密碼)只當 fallback 不採。理由：UX primitive 遲早要補，趁上下文完整一次設計乾淨不留 passwordless 債。
- ✅ **窗內修執行(2026-06-13；報告 PR #71 docs-only merged `6552754` 當 lineage base)**：
  - **#72 P2 機械補強 ✅ MERGED `7111bd8`**：SEC-CEREMONY-DOS(authorize/login-options/login-verify per-IP RL〔新 kind oauth_authorize/webauthn〕+ cleanup 補 webauthn_challenges)／SEC-ADMIN-ENUM(admin/users+metrics admin_read RL+read-audit；metrics top-IP raw→HMAC16)／SEC-KYC-ENUM-2(resolveKycAdapter own-property 守門)。Codex APPROVE 無 finding。
  - **#73 SEC-RESET-2FA-BF(P1) ✅ MERGED `eda09be`**：reset_2fa RL 5/5min→429 + TOTP/backup 失敗 record + `account.password.reset.totp_fail` audit；節流不 burn token。Codex APPROVE；nit〔clearRateLimit on success〕留 follow-up backlog。
  - **ADD-A plan(`sec-factor-add-a-fix-plan.md`) Codex Plan Gate r1→r2→r3 = APPROVED / CODING_ALLOWED**(r1 ChatGPT Arch OD-1..5 → Codex r1 4 blocker → r2 3 blocker+1 contract → r3 全鎖)。§11 staged PR：PR-0 sid → PR-A1 schema → PR-A2 endpoints → PR-A3 gate → PR-A4 disposition，各自 Code Gate。**關鍵硬鎖**：獨立 `elevated:factor_add`(與 elevated:account 分離)、grant 綁 action+sid、`elevation_exchanges` 獨立表、OAuth-reauth **init+callback 雙層**、exchange_code 走 fragment、grant_token/code/provider_id **hash 存不入 URL/audit**、grant consume + factor-add **同 db.batch atomic**、missing-sid factor-add **fail-closed**。
  - **#74 ADD-A PR-0 sid claim ✅ MERGED `7d4eaa2`**：9 issuance path access token 帶 `sid`(== refresh row session_id)；pc/mobile direct-callback access-only token **不帶 sid**(Codex Code Gate r1 blocker 修：access-only 無 refresh row ⟺ 無 sid)；missing-sid → factor-add elevation fail-closed。
  - **#75 ADD-A PR-A1 schema ✅ MERGED `f1bd99a` + ⚠ prod D1 migration 0054 已 applied+verified**：`elevation_grants`/`elevation_exchanges` 表 + `oauth_states` 5 nullable elevation 欄 + 6 index + cleanup 2 task。migrations.test 0054 round-trip + full-forward 0001..0054(53 表/oauth_states 15 欄)。Codex APPROVE_CONDITIONAL → **prod apply 先行**(`wrangler d1 execute chiyigo_db --remote --file=migrations/0054_...`；verified 2 表+5 欄+6 idx) → merge。
  - **ADD-A PR-A2 ✅ MERGED #77 `eb7e018`**(elevation 端點 totp/password/exchange + OAuth-reauth init+callback 雙層)。
  - **ADD-A PR-A3 ✅ MERGED #78 `7ae5558`**：三 factor-add 路徑(register-verify/wallet-verify/oauth-binding)上 `requireFactorAddGrant`(validate-not-consume，sid fail-closed，pre-read==consume CAS predicate)+ consume 與寫入**同 db.batch**/`changes()=1`；replay→403+critical audit。F3 rollback regression 已鎖。Codex Code Gate APPROVE。**SEC-FACTOR-ADD P1 prod 封閉**(Deploy success；migration 0054 早在 prod)。
  - **#79 ✅ MERGED `a07ee14`**(附帶修)：CI `test:cov`(functions/utils ≥80%)**自 #77 連紅**——4 個 D1-dependent integration-only util(elevation/session-revoke/tenant-context/domain-event-emit)漏進 `vitest.config.js` category-A exclude → 各 0% 拖垮 aggregate。修＝4 檔全列 exclude(90%+)。**關鍵**：CI `test` 是 fail-fast 單 job，coverage 紅會 skip 掉 test:int/build:functions/npm audit → #79 解封後三者在 CI 首次真跑全綠＝完整 CI gate 恢復。教訓→memory `feedback_pre_merge_gate_checklist_match_ci`。
  - **ADD-A PR-A4 ✅ MERGED #80 `7da1f9c`（2026-06-13）＝ADD-A 全系列收尾**：既有 credential disposition：3 tier(high/unknown_context/low，OD-1=b)、migration 0055 **table-rebuild down**、admin runner(double-gate step-up+admin:users:write、**strict body schema**〔Codex Code r1 P1 修〕、dry-run default、count-only、run-lifecycle audit)、high notify、`oauth.identity.bind.success`、list DTO 被動 flag、registry 222→225 雙 lockstep。雙 Gate APPROVED(ChatGPT Arch r2 + Codex Plan + Codex Code r2)。**migration 0055 ✅ applied+verify prod D1（merge 前）**。**runner ✅ dry-run + real-run 執行+prod 驗證**：7 window credential＝2 passkey(low) + 5 OAuth identity(unknown_context)，**high=0（殘留母體實際 0）**；5 unknown 純因 `oauth.identity.bind.success` 在 #80 前不存在＝結構缺口非植入；real-run dispositioned=7/notified=0。**5 flagged identity 留 enforcement PR 處置**。⚠ **被動 flag only；主動 enforcement＝OD-3 LOCKED follow-up**。
  - **⚠ LOCKED FOLLOW-UP（OD-3 硬鎖，不得遺失）＝ credential `requires_reverification` enforcement PR**：PR-A4 只設**被動 flag**(list DTO 可見)+ high notify；**主動「使用前強制 re-verify」**(passkey login / wallet login·binding / OAuth login / account recovery，含 user-lockout / support fallback)為獨立 auth-runtime 安全 PR，排在 **PR-A4 merge 後、SEC-REFRESH 前後由 owner 明確排序**，不碰 SEC-REFRESH runtime。
  - **SEC-REFRESH-REUSE（P1）plan ✅ CODING_ALLOWED**：branch `feat/sec-refresh-reuse`，plan `docs/audit/sec-refresh-reuse-fix-plan.md` commit `d4cc82e`（ChatGPT Arch〔C1/C2/C3〕→ Codex Plan r3 APPROVED）。Option B + PT-2：COUNT preflight 三路(heads>1 `session.integrity_violation` fail-closed/heads=1 `casByFamily` single-head/heads=0 no-op)、revoke-before-cap、`family_revoked` 只在 changes>0、401 `SESSION_REVOKED`(前端只此 code 清)、template-kind cap(無 migration)、registry 225→226、Ordering-B 有界 tradeoff。
  - **SEC-REFRESH-REUSE（P1）✅ CODE+CACHE-BUST 完成 → squash-merge via 本 PR（Dual Gate r1→r2 APPROVED）**：code `4bd7e03` ＋ Codex r1 修 `aafdaa2` ＋ cache-bust `04f463d`（branch feat/sec-refresh-reuse）。落地＝PT-2 分流（successor NULL／grace 三類維持 read-only；dead_successor／device_null／out-of-grace→family-revoke）+ §4 COUNT preflight 三路 + single-head casByFamily + §5 revoke-before-cap（OD-SR-2 hard lock）+ C1（family_revoked 只在 changes>0）+ **C2 fail-secure 全覆蓋**（family-revoke try ＋ correct-device 分類 I/O try——後者為 Codex r1 blocker 修）+ 401 SESSION_REVOKED + registry 225→226 雙 lockstep。前端 api.ts 三個 SESSION_REVOKED 抵達點（初次 401／retry／**/api/auth/refresh 本身**＝Codex r1 high 修）全硬登出；`window.silentRefresh` 對外保 Promise<boolean>（`_silentRefreshBoolean` 吸收）、apiFetch 用內部 throwing `_silentRefresh`。gates 全綠（ratchet 898／test:int 1292／test:cov 90.27%／前端 api 8）；§10 矩陣＋3 pre-fix-RED regression（attacker-first／post-CAS C2／grace-path C2）。multi-agent workflow（17 candidate→4 confirmed／13 refuted）＋2 focused 複審。**無 D1 migration**。⚠ deploy=upload 已 commit 的 `public/`（無 build step）→ cache-bust `?v=` 必 commit（8590880a→aafdaa2b）。
  - **enforcement PR（OD-3 LOCKED）✅ Plan Gate 全過 → Phase 2 coding 中**（branch `feat/cred-reverify-enforcement`，plan `docs/audit/cred-reverify-enforcement-plan.md` v6.3 `CODING_ALLOWED`）：主動「使用前強制 re-verify」。**維度 A 四輪自審 + ChatGPT Arch APPROVED〔C1/C2/C3〕+ Codex Plan r1→r2 APPROVED**。設計＝**4 enforce surface**（passkey login／OAuth callback 5b／bind-email／**factor-add elevation OAuth-reauth callback 5a＝D1，flagged identity 不鑄 grant**）+ **owner-vouch self-reverify**（password/TOTP，**移除 OAuth-reauth-for-reverify**；high-risk 只能 delete/admin、tier-gate fail-closed whitelist、TOTP-enabled 禁 password downgrade、self 用 `requireRegularAccessToken`）+ **admin clear**（double-gate）+ **OD-CLEAR=A**（不覆寫 disposition_*、clear 事實落 audit）+ **merged event** `account.credential.reverification_cleared`（actor_type/動態 severity，admin·high→critical）+ **wallet informational-only**。**registry 226→228、無 migration**。owner-accepted residuals R1/R2/R3。**pre-existing dirty worktree baseline**：21 `public/js/*.js` 全 EOL/autocrlf noise（不清/不 stage，只挑檔 stage 本 PR 改檔）。下一步 P4 完整收尾 → **⚠ 回 Stage 7（JS→TS strict），非 P5/P7/P8**。
  - **窗內修 follow-up/backlog**：clearRateLimit on reset_2fa success(SEC-RESET nit，非 blocker)；13+ P3(報告 §6)+SEC-KYC-ENUM-2 隨 ISO-ENUM-2 同批；末期完整 Gate(6/19-20)folded-in checklist 含 P1 金流 4 問 + P3 事件 5 問。
- ⏳ **P5 整合+第二輪 / P7 config+CI / P8 前端 / P6 backlog**：pending(SEC-REFRESH land 後)。P5＝跨領域鏈 + completeness critic + **loop-until-dry 第二輪**(起手缺口 `webhook-dlq.ts`/`aggregate.ts`/`payment-return/ecpay.ts`)→ `05-integration.md`。

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
| 斷點 2（✅ 過） | P2 完全收尾(三修補全 merged + 綠) → 開 P3 | §4-D(P3) |
| 斷點 3（✅ 過） | P3 報告 + 三顆 P2 級窗內修補全 merged(#67/#68/#69)；小校準 Gate 裁決 A=併末期 | §4-D(P4) |
| 斷點 4（✅ 過） | P4 報告(`04-security-boundary.md`，8 findings)+ 雙 Gate 小校準完成；報告 PR #71 merged | 窗內修(非 /clear；同 context 跑) |
| ★ **窗內修執行中（← 現在在這，2026-06-13）** | #72 P2✅ / #73 SEC-RESET✅ / #74 PR-0 sid✅ / #75 PR-A1 schema✅(0054 prod) / PR-A2 #77✅ / **PR-A3 #78✅(SEC-FACTOR-ADD P1 prod 封閉)** / #79✅ CI-fix / **PR-A4 #80✅ MERGED(0055 prod applied + runner real-run 驗證,high=0)** ＝ADD-A 全收尾;**SEC-REFRESH plan ✅ CODING_ALLOWED(`d4cc82e`)→ 下一步 Phase 2 coding** → 之後 enforcement PR → 斷點 5 | 接手讀 §3 窗內修執行段；SEC-REFRESH plan `sec-factor-add... ` 改 `sec-refresh-reuse-fix-plan.md`(`d4cc82e`,branch feat/sec-refresh-reuse) |
| 斷點 5 | 窗內修(ADD-A A2-A4 + SEC-REFRESH)全收齊 → P5 整合 + 第二輪 dry(連兩輪零新發現) | §4-D(P5) |
| 斷點 6 | P7 config/CI 報告完 + P2 級即修 merged（目標 ~6/16） | §4-D(P8) |
| 斷點 7 | P8 前端報告完 + 窗內修收尾 + PAY-004 PR + regression pack（目標 ~6/18） | 末期完整 Codex+GPT Gate(**提前進窗,目標 6/19–6/20**) |
| 末期 | Gate findings 處置 + `STAGE8-BACKLOG.md` 定稿（~6/21–22） | Stage 7 是否解除暫停＝owner 動態裁決 |

**末期完整 Gate checklist（隨域累積；6/19–20 一起送 Codex+GPT）**：
- 各域校準問題（folded-in 小校準 Gate）：**P1 金流** `01-payments.md §给校準 Gate` 4 問；**P3 事件** `03-event-consistency.md §6` 5 問（裁決 A 併入，2026-06-12）；P4/P5/P7/P8 報告各自的校準問題完成時補列。
- 全 finding 總覆核（P0→P3 嚴重度、駁回是否成立、跨域 seam）。
- 已 merged 窗內修補的最終 diff 一致性複查。
