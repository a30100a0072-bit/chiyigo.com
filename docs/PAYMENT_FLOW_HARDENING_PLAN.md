# 金流邏輯強化計畫（Payment Flow Hardening）

> 起點：2026-05-06 review，從 `eb49ad8` 之後的 wave 7（refund-request 中介態）延伸。
> 觸發需求：
> - **L1.1**：充值成功紀錄必須永久保存在 D1，admin 後台需獨立**唯讀**頁面顯示，**不可刪除/改動**。
> - **L1.2**：接案諮詢紀錄＝現有需求單頁，案件狀態須連動 Telegram。✅ 已完成。
> - **L2**：接案成功（deal）需要獨立頁面讓 admin / user 直觀看到所有成交紀錄。

---

## 現況審查發現

### 🔴 高風險

1. **succeeded 充值可被 admin 直接 hard delete**
   `/api/admin/payments/intents/:id/delete` 沒檢查 status，雖有 step-up + elevated:payment + OTP，但金流憑證本體（`vendor_intent_id` / `amount`）一旦誤刪就**永久消失**，audit_log 只留事件不留憑證。違反 L1.1。

2. **requisition 刪除用 LIKE 掃 metadata 判斷有無付款**
   `metadata LIKE '%"requisition_id":N%'` 會被前綴誤判（id=12 匹配到 id=120）。`metadata` 是 JSON 純文字，沒 schema validation。

3. **`payment_intents.user_id ON DELETE CASCADE`**
   user 自刪帳號會把所有金流 intent 連根拔起 → 公司端帳務消失。

4. **requisition 用 hard delete（含 deal 狀態）**
   admin 強刪 deal 狀態 req → `deals.source_requisition_id` SET NULL，喪失追溯起點。

### 🟡 設計問題

5. **payment_intents ↔ requisitions 靠 metadata JSON 不是 FK** — 無法 join，被迫用 LIKE。
6. **deals.payment_intent_ids 是 JSON 陣列** — 無法 join，對帳要 parse。
7. **refund_request 沒有 amount 欄位** — 未來開放部分退款會炸。
8. **processing / completed 狀態是死碼** — 沒進入路徑也沒 TG 同步。

---

## 實作優先序

### P0（金流憑證完整性，本輪做）

| # | 項目 | 變更面 | 狀態 |
|---|---|---|---|
| P0-1 | `payment_intents` delete endpoint 加 status 白名單；succeeded/refunded 走 **anonymize** 不走 hard delete | `functions/api/admin/payments/[id]/delete.js` | ⬜ |
| P0-2 | `payment_intents.user_id` 改 `ON DELETE SET NULL`（migration 新建） | `migrations/0029_payment_intents_user_set_null.sql` | ⬜ |
| P0-3 | 新增 `payment_intents.requisition_id` FK，backfill 從 metadata；admin-requisitions delete 檢查改 FK join | `migrations/0030_payment_intents_requisition_fk.sql` + endpoints | ⬜ |

**Anonymize 規範**：保留 `id / vendor / vendor_intent_id / kind / status / amount_subunit / amount_raw / currency / created_at`；清空 `metadata = '{}' / failure_reason = NULL`；標記 `metadata.anonymized_at`。

### P1（L1.1 / L2 落地，本輪做）

| # | 項目 | 變更面 | 狀態 |
|---|---|---|---|
| P1-4 | `admin-payment-records.html`：read-only 充值紀錄頁，只看 succeeded，含 user/vendor/amount/關聯 req/deal/CSV 匯出 | 新頁 + `functions/api/admin/payment-records.js` | ⬜ |
| P1-5 | `admin-deals.html`：成交紀錄頁，列 deals 表，含篩選/匯出 | 新頁 + `functions/api/admin/deals.js`（list） | ⬜ |
| P1-6 | dashboard 加「我的成交紀錄」section，user 看自己的 deals | `src/pages/dashboard.html` + `dashboard.js` + `functions/api/auth/deals.js` | ⬜ |

### P2（後續）

- `requisition` admin delete 改 soft delete（用既有 `deleted_at`）
- 移除 `requisition` delete 的 LIKE metadata 檢查 → 改 FK join（P0-3 完成後）
- processing / completed 狀態決定實裝 or 刪除
- `refund_request` 加 `amount_subunit` 欄位

### P3（觀測）

- admin-payment-records / admin-deals 加日報/月報 aggregate
- `audit_log` 對「succeeded intent 任何 UPDATE」標 critical + Discord

---

## 路徑/檔案參考

- 既有充值對帳工具（**不刪除，與新頁並存**）：`src/pages/admin-payments.html` + `src/js/admin-payments.js` + `functions/api/admin/payments/`
- 既有需求單：`src/pages/admin-requisitions.html` + `src/js/admin-requisitions.js` + `functions/api/admin/requisitions/`
- deals 表：migration 0028（`source_requisition_id ON DELETE SET NULL`、`payment_intent_ids` JSON）
- TG 同步：`functions/_lib/tg-requisition.js`（pending / refund_pending / revoked / deal / deleted 全覆蓋）
