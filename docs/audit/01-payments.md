# P1 金流領域 — 系統級安全審計報告

> 審計日期 2026-06-12｜模型 Fable 5｜方法：4 切角 workflow finder 並行 → 對抗式 verify → 主線(Claude)獨立讀碼裁決
> 對照不變量：`docs/audit/00-invariants-threat-model.md` §3 INV-PAY-1..10
> **本報告只審不修**；修復留待 Opus 4.8（6/26 起）。P1 等級附 repro test。

---

## 摘要

| 來源 | 數量 |
|---|---|
| Finder 候選 | 9（webhook 3、refund 2、credit-billing 2、intent-lifecycle 2） |
| 對抗式 verify 後判真 | 7 |
| 主線裁決時新增（finder 漏掉） | 1（PAY-008） |
| 對抗式 verify 駁回 | 2（記錄於文末，駁回理由本身是 audit 價值） |
| **確認 P0（live-exploitable）** | **0** |

**嚴重度分布（主線裁決後 + owner 確認）**：**P0 ×1**、P2 ×3、P3 ×4。

**Headline**：**PAY-002（P0 — gating confirmed 2026-06-12）** — ECPay 驗章在 `ECPAY_MODE` 未設時 fail-**open** 到程式內公開 sandbox 金鑰。owner 已確認 **prod 目前未設齊三把 ECPay secret**,在 repro 已證實「空 env fail-open 到公開 sandbox key」的前提下,**P0 升級條件成立 → 現行 prod 為 live-exploitable**。任何知道某 pending intent 的 `MerchantTradeNo`+`TotalAmount`(checkout 都回前端、client 可見)的人,可用公開金鑰自簽 `RtnCode=1` webhook 把自己 intent 標成已付款。**定為 ECPay 上線阻斷,下一步 = PAY-002 Hotfix PR**(plan 見 `docs/audit/pay-002-hotfix-plan.md`)。

**整體結論**：金流核心(idempotency、CAS、illegal-transition guard、退款雙路徑共用 lock、credit ledger 原子 batch)品質很高,已被 codex r1–r10 審硬。本輪 7 條 finding **全部偏向 §0 預測的方向**——secure-by-default 邊界、重度 gated 的組合競態、CLAUDE.md 硬性要求(idempotency key)未在某條寫入路徑落實、觀測性 parity、慣例漂移——**沒有單檔金額/帳本正確性破口**。

---

## 🔴 PAY-002 — P0 gating confirmed（owner 2026-06-12）

owner 已確認 **Cloudflare production 目前未設立 `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` 三把 secret**。在 repro(`tests/payments-ecpay-failopen.test.ts`)已證實「空 env → fail-open 到公開 sandbox key → 偽造 webhook 被接受」的前提下,**P0 升級條件成立**：

- 現行 prod 狀態下,`getCreds` 走 sandbox 分支用**公開** HashKey/HashIV 驗章。任何知道某 pending intent 的 `MerchantTradeNo`+`TotalAmount`(checkout 都回給前端、client 可見)的人,可自簽 `RtnCode=1` webhook 通過 CheckMacValue + 金額閘門 → **未付款標成 succeeded** → 污染下游 credit/餘額/對帳。
- 緩解現況:目前無真實金流流量(memory:金流完整 smoke 延後),實際 blast radius 受限,但這是**真實 ECPay 上線的硬阻斷**。

**處置**:不進 P2,先開 **PAY-002 Hotfix PR**(Dual Gate)。Plan 見 `docs/audit/pay-002-hotfix-plan.md`(送 Codex Plan Gate)。

---

## Findings（P1 → P3）

| ID | 嚴重度 | 標題 | INV | 檔案 |
|---|---|---|---|---|
| PAY-002 | **P0** | ECPay 驗章 `ECPAY_MODE` 未設時 fail-open 到公開 sandbox 金鑰（gating confirmed） | INV-PAY-3 / INV-SEC-6 | `payment-vendors/ecpay.ts:45-72` |
| PAY-006 | P2 | checkout/ecpay 建單缺 idempotency key + 無 rate limit | INV-PAY-9 | `auth/payments/checkout/ecpay.ts:56-131` |
| PAY-005 | P2 | billing topup/adjust/grant 成功 audit 為 info+fire-and-forget,無 critical 告警 | INV-PAY-8 | `billing/wallets/*`、`billing/grant.ts` |
| PAY-008 | P2 | `amount_subunit` 欄位名宣稱「最小單位(分)」但 ECPay 路徑實存整數 TWD（跨幣別 latent 陷阱） | INV-PAY 一致性 | `utils/payments.ts:15-18`、`checkout/ecpay.ts:128` |
| PAY-001 | P3 | webhook create-race loser 落 success tail,寫出與 intent 矛盾的 status.change audit | INV-PAY-4/8 | `webhooks/payments/[vendor].ts:331-348,409-438` |
| PAY-003 | P3 | revoke.ts 分支 B refund_request INSERT 未 try/catch UNIQUE,競態回 500 非 409 | INV-PAY-7 / INV-SEC-7 | `requisition/revoke.ts:97-122` |
| PAY-004 | P3 | refund-request.ts 對 requisition 改 refund_pending 無 status 守衛,可非法回退 deal 單 | INV-PAY-5 | `payments/intents/[id]/refund-request.ts:101-105` |
| PAY-007 | P3 | sanitizeMetadata 1000 字上限只擋 string,nested object/array 整包繞過 | INV-PAY-10 | `utils/payments.ts:75-85` |

---

## 詳細 findings

### PAY-002（P0 — gating confirmed）ECPay 驗章 fail-open 到公開 sandbox 金鑰
- **違反**：INV-PAY-3（webhook 必驗簽；密鑰外洩仍須擋）、INV-SEC-6、Tier-0 #1 secure-by-default。
- **證據**：`payment-vendors/ecpay.ts:46` `isProd = env?.ECPAY_MODE === 'prod'`(未設→false)；`:51-58` 的 prod fail-closed 守衛被 `if(isProd)` 包住,未設 mode 整段跳過；`:66-71` sandbox 分支 `env.X ?? SANDBOX_CREDS.X`,SANDBOX hashKey/hashIV 是 hardcode 公開值(`:41-42`,亦見 ECPay 官方文件)。`parseWebhook`(`:128,136`)用 `getCreds(env)` 驗章。`ECPAY_MODE` **未列入 `types/env.d.ts` 的 Env 介面**(只有三把 creds + PSP flag),增加被遺漏設定的機率。
- **攻擊路徑**：見上「P0 升級條件」。金額閘門救不了(checkout 把 `TotalAmount`+`MerchantTradeNo` 整包 `fields` 回前端,client 可見,照填即過);狀態機 pending→succeeded 合法;dedupe 對攻擊者自選 fresh event_id 是 INSERT changes=1 直接 claim。
- **blast radius**：ECPay 驗章 + checkout URL 選擇 + ecpayRefund 全部受 `getCreds` 影響。穩態(三 creds 已設)不受影響;僅在「prod 部署且 mode+三 creds 全未設」視窗成立。
- **修復方向(留 Opus)**：`getCreds` 改 secure-by-default fail-closed。擇一或併用：(1) `ECPAY_MODE` 列舉 {prod,sandbox} 列入 Env 為 required,未設一律 throw;(2) **驗簽路徑**若落到 SANDBOX_CREDS fallback 即視為 misconfig → `parseWebhook` 回 `ok:false` + critical audit + DLQ,禁用公開金鑰驗真實 webhook;(3) 由 `ENVIRONMENT='production'`(wrangler.toml 已是 SoT)推導,production 缺 creds → fail-closed;(4) sandbox fallback 命中至少發一筆 critical audit(現況零告警)。
- **repro（P1,已寫且已跑、已證實）**：`tests/payments-ecpay-failopen.test.ts`。空 env 下用公開 sandbox 金鑰自簽 webhook → `parseWebhook` 回 `ok:true`(現況),test 斷言期望的 `ok:false`,故 **pre-fix FAIL**(`expected true to be false`)= fail-open 已證實;對照組(真 creds 已設)偽造簽章被擋 PASS。Opus 修 `getCreds` fail-closed 後此 test 轉綠 = 直接當 regression test。
- **信心度**：high（finder→verifier→主線獨立讀碼→repro 跑過,四層確認）。

### PAY-006（P2）checkout 建單缺 idempotency key + 無 rate limit
- **違反**：INV-PAY-9 + CLAUDE.md §Payment「金流、寫入必有 idempotency key」(硬性要求)。
- **證據**：`checkout/ecpay.ts:82` 每次 `generateMerchantTradeNo()` 產新 key;`:122-131` `createPaymentIntent` 純 INSERT 無冪等預檢;整檔無 `checkRateLimit`/`Idempotency-Key`(對比 `admin/payments/intents.ts:61` 有 rate limit)。`rate-limit.ts` 的 `RateLimitKind` union 根本沒有 payment/checkout 類型。webhook `(vendor,event_id)` dedupe 是 PSP 回呼去重,對 client-facing 建單 write 不適用。
- **裁決**：這正面回答了 P0 doc 標記「待驗」的 INV-PAY-9——**payment-intent 建立路徑無獨立 idempotency-key 表**(credit 操作有,靠 `credit_ledger`;checkout 沒有)。緩解:KYC-gated、不會雙重扣款(每張 intent 獨立、user 只付一張)、cleanup cron 24h 後標 canceled。故是 spec-compliance + resource-exhaustion/對帳噪音缺口,非資金損失。
- **修復方向**：(A) 立即低成本:`RateLimitKind` 加 `payment_checkout`,checkout 在建 intent 前 `checkRateLimit`;(B) 正式解:client 帶 `Idempotency-Key`(或 body 穩定欄位 hash),D1 建 `payment_checkout_idempotency` 表(UNIQUE+TTL≥7d),命中回上次 intent_id/checkout_url 不重建——須把 key↔已生成的 `vendor_intent_id` 綁定持久化,回放回同一個,勿重 generate。
- **信心度**：high。

### PAY-005（P2）billing 成功 audit 為 info + fire-and-forget
- **違反**：INV-PAY-8(字面「critical audit」未達成的觀測性 parity)。
- **證據**：`topup.ts:96`/`adjust.ts:95`/`grant.ts:131-134` 呼叫 `safeUserAudit` 無 `severity` 欄 → `user-audit.ts:74` 走 default `'info'` → `:156` `if(severity==='critical')` 才告警,故不發 Discord;`:162` 最外層 catch 吞 D1 INSERT 失敗。對照 `webhooks/payments/[vendor].ts:423-424` 的 `payment.status.change` 帶 `critical`。
- **裁決(verifier 對 finder 的 overclaim 做了正確下修)**：**非正確性破口**。對帳 SoT 是 append-only `credit_ledger`/`grant_plan_operations`,與餘額在**同一 db.batch() 原子寫入**;audit_log 是 post-commit secondary telemetry,非 SoT。retention 由 `audit-policy.ts` 歸 IMMUTABLE,**與 severity 無關**(severity 只決定 alerting)。故缺口=金流成功狀態變更不發 critical 告警 + 寫失敗靜默,屬觀測性 parity。
- **修復方向**：三處成功路徑補 `severity:'critical'` 與 payment 域對齊。不要動 fire-and-forget swallow 語意(跨全站 audit 設計約定)。
- **信心度**：high。

### PAY-008（P2,主線新增——finder 漏掉）`amount_subunit` 慣例漂移
- **違反**：金流一致性(Tier-0 Correctness 之 currency/rounding 慣例);命名 vs 實際語意漂移。
- **證據**：`utils/payments.ts:15-18` 註解明定 `amount_subunit INTEGER` = 「法幣最小單位(TWD 分 / USD cent)」。但 `checkout/ecpay.ts:73,128` 存的是 `Math.round(Number(body.amount))`,而 body.amount 文件明定「整數 TWD,綠界不收小數」→ **ECPay 路徑的 `amount_subunit` 實存整數 TWD(NT$100→100),非分(應為 10000)**。webhook 比對(`Number(params.TradeAmt)`)與退款(`totalAmount: intent.amount_subunit`)三端**對 ECPay 內部一致**,故**目前不是金額 bug**。
- **裁決**：latent 陷阱,非 live bug。風險:系統規劃 TWD/USD/ETH/USDT 多幣別;若(a)未來 vendor 真用 subunit、或(b)reconciliation/顯示/跨幣別彙總層假設 TWD intent 是「分」而 `/100`,就會錯 100 倍。為「五年可維護」計,在名為 `_subunit` 的欄位存整數 TWD 是要記的債。
- **修復方向**：擇一明確化——(a) 文件+code 註明「TWD 在本系統 amount_subunit 存整數元(綠界不收小數),非分」並在跨幣別彙總處加 per-currency scale 表;或(b) 統一改存真分(TWD×100)並 migration 既有 row(現無真實流量,改成本低)。建議走(b)趁無流量,根除跨幣別假設分歧。
- **信心度**：high（我獨立讀 checkout/webhook/refund 三端確認一致性與漂移）。

### PAY-001（P3）webhook create-race loser 落 success tail
- **違反**：INV-PAY-4 / INV-PAY-8。
- **重度 gated**：需 `PSP_DIRECT_INTENT_ENABLED=1`(預設關、prod config 未設)+ 帶 user_id 的 vendor(僅 mock,test-only,ECPay 恆 user_id=null)+ 真實並發 race。三道 gate 全擋故 prod 不可達 → P3 latent。
- **核心**：create 分支 catch(`[vendor].ts:345-348`)re-fetch 後直接落 success tail(`:410`),`skipSuccessTail` 只在 else-if updatePaymentStatus 分支設 → 繞過 ALLOWED_TRANSITIONS 守衛,可寫出 `payment.status.change` audit `status='succeeded'` 但 intent 實際 `failed`。
- **修復方向**：create-loser re-fetch 後走與 else-if 同一條 `updatePaymentStatus` CAS,依 structured outcome 設 `skipSuccessTail`,勿用 loser 的 parsed.status 蓋寫。
- **repro**：mock + flag=1,先投 A(failed)建 intent,再投 B(succeeded,同 vendor_intent_id 異 event_id)。詳見 workflow 輸出 reproTestSketch。

### PAY-003（P3）revoke.ts 分支 B 缺 try/catch UNIQUE → 500 非 409
- **違反**：INV-PAY-7、INV-SEC-7(統一錯誤 envelope)。
- **可達路徑**：admin anonymize(`delete.ts`)對 succeeded intent **剝除 metadata.requisition_id 但保留 FK requisition_id**,造成發散態;之後 refund-request(用 metadata 推 reqId=NULL 建 pending row)+ revoke(用 FK 撈,去重 pre-check 用 `requisition_id` 而非 `intent_id`,與 0034 `uq_rrr_intent_pending`(鍵=intent_id)不對齊)→ INSERT 撞 UNIQUE → revoke.ts 此 INSERT **無 try/catch** → 冒泡 500 + 誤觸 Discord 5xx 告警。無資料毀損(UNIQUE 擋住重複退款)。
- **修復方向**：revoke.ts INSERT 包 try/catch UNIQUE→409(鏡像 refund-request.ts);治本:去重 pre-check 鍵改 `intent_id` 對齊 constraint(呼應 [[feedback_gating_preread_not_narrower_than_cas]])。
- **註**：本 finding 牽涉 `requisition/revoke.ts`(我尚未親讀),verifier 已逐行核對;修復前我會 spot-check。

### PAY-004（P3）refund-request 對 requisition 改 refund_pending 無 status 守衛
- **違反**：INV-PAY-5 + requisition 狀態機正確性。
- **可達**：`save.ts:119` 把 req 設 `status='deal'` 但不動 deleted_at、不退綁定 intent → 'deal' req 仍過 refund-request 的 `deleted_at IS NULL`+succeeded 檢查;`:102-105` `UPDATE requisition SET status='refund_pending' WHERE id=? AND user_id=?` 無 status 守衛 → 非法把成交單回退 refund_pending。對比 `revoke.ts:67` 有 `status!=='pending'` 守衛(入口不對稱)。
- **無資金損失**：deals 表(0028)與 requisition.status 解耦,真退款仍需 admin step-up + scope。屬狀態機完整性 + 顯示不一致。
- **修復方向**：`:102-105` 改 CAS `... AND status='pending'`,顯式 enforce 0026 狀態流。
- **✅ 業務裁決（owner via GPT Arch Gate,2026-06-12）**：成交(deal)後**客戶可以自助提出退款申請**,但**不得把 requisition 主狀態回退**。退款須走 `refund_request` / `refund_intent` / `refund_status` 生命週期,**不得覆寫成交事實**。
  → fix 方向定為:`refund-request` 對 `status='deal'`(或任何非 pending)的 req **不更新 requisition.status**(CAS `... AND status='pending'` 不命中即略過,不視為錯誤),但仍建立 refund_request row 走退款生命週期。**本 finding 仍是 PAY-002 Hotfix 的 Non-goal,留未來獨立 PR**(P3 backlog)。

### PAY-007（P3）sanitizeMetadata size 上限只擋 string
- **違反**：INV-PAY-10。
- **證據**：`payments.ts:78` `if(typeof v === 'string' && v.length > 1000)` → 非 string 值(object/array)走 `:80-81 out[k]=v` 原樣保留;`:138 JSON.stringify(cleanMeta)` 整包落 TEXT(0025 無長度限制)。KYC-verified user 可塞巨型 nested object 到 allowlist 鍵(note/description/tag)。
- **無正確性破口**:storage/CPU DoS-adjacent,受 KYC gate + CF ~100MB body cap 約束。但**根因是缺 schema validation**(違反 baseline「所有 input 必 schema validation、禁 z.record(z.any())」)。
- **修復方向**：sanitize 對 allowlist 值統一 `JSON.stringify(v)` byte 上限,或直接 reject `typeof v==='object'`(allowlist 語意上都應 scalar);上游補 Zod 約束 `body.metadata` 為 `Record<string, scalar>`。注意 sanitize throw 時 caller 須回 400 非 500。

---

## 對抗式 verify 駁回的候選（記錄 + 駁回理由）

> 駁回本身是 audit 的證據:這些是「看似合理但有 defense-in-depth 兜底」的,不進 backlog。

1. **mergeMetadata 非原子 read-modify-write → metadata.trade_no lost-update → 退款失能**：機械事實屬實(非原子 SELECT-then-UPDATE),但 **load-bearing 傷害為假**——兩條退款路徑(`refund.ts:85-99`、`approve.ts:91-104`)都有 fallback:`intent.metadata?.trade_no ?? (SELECT event_id FROM payment_webhook_events WHERE status_to='succeeded')`,succeeded 的 event_id 就是 bare TradeNo。dedupe row 在 claim 時就 INSERT,早於 mergeMetadata,lost-update 摧毀不了它。退款 source-of-truth 實質是 dedupe 表非 metadata 欄。殘留:metadata 顯示層短暫不一致(P3 觀測,不進 backlog)。

2. **deductCredits 無 caller + 拒收 source='payment' → 付款→扣 credit 鏈未接**：事實屬實(零 production caller、`credit.ts:201` reject 'payment'),但 REFUTE 成立——無 caller 故無可觸發序列;拒收未接通的 source 是 **deny-by-default 正確設計**;0049 schema 預留 'payment' 是 expand-only forward-compat;pr3 plan §6 已明文標記「Auto-provisioning credits on grantPlan = separate PR」= 已規劃未來工作,非隱藏債。屬「已規劃未實作 + 正確 fail-closed」。

---

## Completeness（不靜默宣稱全覆蓋）

- **未被任何 finder 覆蓋的金流檔(coverage gap)**：`admin/payments/webhook-dlq.ts`(DLQ replay/管理——replay 可能重觸發處理,值得查冪等)、`admin/payments/aggregate.ts`(對帳彙總)。→ 建議 P5 整合階段或一個小 follow-up finder 補。
- **已覆蓋但無 finding,建議獨立 spot-verify**：`payment-return/ecpay.ts`(OrderResultURL 瀏覽器 POST 回跳)——這正是 INV-PAY-6「前端不決定付款成功」最可能的破口位置;finder 在範圍內未報,建議主線親讀確認它不依瀏覽器 POST 改 payment status。
- **跨領域待 P5 串接**：refund→credit→event outbox→deny 端到端鏈尚未驗(deductCredits 鏈未接,見駁回 #2);留 P5 整合。

---

## 給校準 Gate 的問題（task #3）

1. §2 共用 infra 心智模型(尤其 webhook 三態 apply_status、退款雙路徑共用 lock、credit 原子 batch)我讀對了嗎?
2. PAY-002 從 P2 上修 P1 + P0 升級條件的判準合理嗎?
3. PAY-008(amount_subunit 漂移)我獨立新增的——有無誤判?ECPay 三端一致性的讀法對嗎?
4. 有無我與 finder 都漏掉的系統級金流破口?

_報告完成 2026-06-12。下一步:寫 PAY-002(P1)repro test → 校準 Gate。完整 finder/verifier 原文留存於 workflow 輸出 `tasks/wfk965gx5.output`。_
