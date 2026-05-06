# 金流邏輯強化計畫（Payment Flow Hardening）

> 起點：2026-05-06 review，從 `eb49ad8` 之後的 wave 7（refund-request 中介態）延伸。
> 觸發需求：
> - **L1.1**：充值成功紀錄必須永久保存在 D1，admin 後台需獨立**唯讀**頁面顯示，**不可刪除/改動**。
> - **L1.2**：接案諮詢紀錄＝現有需求單頁，案件狀態須連動 Telegram。✅ 已完成。
> - **L2**：接案成功（deal）需要獨立頁面讓 admin / user 直觀看到所有成交紀錄。

> **狀態**：P0–Wave 4 + 2026-05-07 codex 安全審查補丁全部完工並上 prod（截至 commit `73b2d13`）。

---

## 完工進度（commit hash 對照）

| Wave | Commit | 內容 |
|---|---|---|
| P0+P1 | `c800053` + `e2e409f` | anonymize / SET NULL / FK / 充值紀錄頁 / 成交紀錄頁 / 我的成交 |
| Wave 0 | `bb3812b` | 401 auto-refresh / refunded 鎖死 / 死按鈕對齊 / brand modal |
| Refund 頁 | `5f6b676` | 退款申請獨立頁 + 申請退款 pill + sidebar nav |
| Wave 1 | `fdfe4b5` | 砍死碼 / refund_request.amount / succeeded UPDATE 告警 |
| Wave 2 | `4840df6` | requisition soft delete / backend CSV / metadata schema |
| Wave 3 | `43ca3e1` | metadata archive / 日報月報 aggregate |
| UI 對齊 | `60dba8e` | admin sidebar trim + i18n 4 國語言 + sun icon 對齊 |
| Wave 4 | `d67ab98` | admin read audit / rate limit / webhook DLQ |
| codex P0+P1 | `e86dc4e` | ECPay `?debug=1` 外洩 HashKey/HashIV ✕ / webhook 缺金額校驗 ✕ / AI Turnstile env 名 / JWT iss 預設 / client_back_url 白名單 / revoke 狀態機 |
| 2FA 強化 | `38802f1` | activate 必傳 current_password / setup·disable·regenerate 加 rate limit / 前端 + 4 國 i18n |
| ECPay prod 守門 | `25ac234` | `ECPAY_MODE=prod` 缺 creds 直接 throw（不偷用 sandbox） |
| Refresh cookie | `7957429` | register / 2fa/verify 對齊 login 走 HttpOnly cookie（之前 body 暴露） |
| 測試 schema sync | `01e20ba` | _setup.sql 對齊 migration 0026-0033 / ECPay test creds 換 3002607 → 31 fail 變 0 |
| 低風險清理 | `73b2d13` | logout cors / delete.js 5xx 不外洩 message / metrics issued_7d 真實計算 |

---

## 現況審查發現（紀錄用）

### 🔴 高風險（已修）

1. **succeeded 充值可被 admin 直接 hard delete** — P0-1 修；改 status 白名單 + anonymize
2. **requisition 刪除用 LIKE 掃 metadata** — P0-3 修；改 FK join
3. **`payment_intents.user_id ON DELETE CASCADE`** — P0-2 修；改 SET NULL
4. **requisition hard delete 含 deal 狀態** — Wave 2 T8 修；改 soft delete
5. **refunded 仍可被 anonymize** — Wave 0 T2 修；後端 LOCKED_STATUSES + 前端隱藏按鈕
6. **admin 401 撞死** — Wave 0 T1 修；apiFetch 加 silent refresh + redirect

### 🟡 設計問題（部分已修）

5. ~~**payment_intents ↔ requisitions 靠 metadata JSON 不是 FK**~~ — P0-3 修
6. **deals.payment_intent_ids 是 JSON 陣列** — 未修（價值低，對帳查詢都已用 FK 做）
7. ~~**refund_request 沒有 amount 欄位**~~ — Wave 1 P2-4 修
8. ~~**processing / completed 狀態死碼**~~ — Wave 1 P2-3 修

---

## 階段詳細

### P0（金流憑證完整性）✅

| # | 項目 | 變更面 | 狀態 |
|---|---|---|---|
| P0-1 | `payment_intents` delete endpoint status 白名單；succeeded/processing 改 anonymize | `functions/api/admin/payments/intents/[id]/delete.js` | ✅ `c800053` |
| P0-2 | `payment_intents.user_id` 改 `ON DELETE SET NULL` | `migrations/0029_payment_intents_hardening.sql` | ✅ `c800053` |
| P0-3 | 新增 `payment_intents.requisition_id` FK + backfill；admin/user 6 endpoint 從 LIKE 改 FK | migration 0029 + 多個 endpoint | ✅ `c800053` |
| P0-3 fix | 0029 typo `requisitions` → `requisition`（單複數） | `migrations/0030_fix_payment_intents_requisition_fk.sql` | ✅ `e2e409f` |

**Anonymize 規範**：保留 `id / vendor / vendor_intent_id / kind / status / amount_subunit / amount_raw / currency / created_at`；清空 `metadata` / `failure_reason`；新 metadata 標記 `anonymized_at` + `anonymized_by` + `original_status`；原始 metadata 同步寫到 `payment_metadata_archive`（Wave 3 T12）。

### P1（L1.1 / L2 落地）✅

| # | 項目 | 狀態 |
|---|---|---|
| P1-4 | `admin-payment-records.html`：read-only 充值紀錄頁（succeeded only）+ CSV | ✅ `c800053` |
| P1-5 | `admin-deals.html`：成交紀錄頁 + CSV | ✅ `c800053` |
| P1-6 | dashboard 加「我的成交紀錄」+ `/api/auth/deals` | ✅ `c800053` |

### Wave 0（即時 bug 修補）✅ `bb3812b`

| # | 項目 | 狀態 |
|---|---|---|
| T1 | admin 4 頁 + dashboard 加 apiFetch + 401 silent refresh + redirect | ✅ |
| T2 | refunded intent 完全鎖死（後端 409 + 前端隱按鈕） | ✅ |
| T3 | dashboard 前端 canDelete 對齊後端 USER_DELETABLE | ✅ |
| T4 | admin delete modal 改用 brand `modal-bd`/`modal-card` 取代 inline style | ✅ |

### 退款申請獨立頁 ✅ `5f6b676`

- `/admin-refund-requests.html`（pending / approved / rejected tabs）
- admin-payments 對 succeeded+pending refund 顯示「申請退款」pill
- dashboard 「待審核退款」改「退款申請中」+ tooltip 顯示申請時間
- 4 admin 頁 sidebar 加「退款申請」nav

### Wave 1 ✅ `fdfe4b5`

| # | 項目 | 狀態 |
|---|---|---|
| P2-3 | 砍 requisition processing/completed 死碼 | ✅ |
| P2-4 | `refund_request.amount_subunit`（migration 0031）+ INSERT backfill | ✅ |
| P3-2 | `updatePaymentStatus` 偵測 succeeded 狀態變動 → critical audit + Discord | ✅ |

### Wave 2 ✅ `4840df6`

| # | 項目 | 狀態 |
|---|---|---|
| T8 | requisition admin/user delete → soft delete（用既有 `deleted_at`） | ✅ |
| T9 | CSV 改後端產出（`?format=csv`，50000 row hard cap） | ✅ |
| T11 | `payment_intents.metadata` 寫入白名單（`createPaymentIntent` 過濾鍵） | ✅ |

### Wave 3 ✅ `43ca3e1`

| # | 項目 | 狀態 |
|---|---|---|
| T12 | `payment_metadata_archive` 表（migration 0032）+ anonymize 落 archive + read endpoint（step-up） | ✅ |
| P3-1 | 充值/成交日報月報 aggregate 端點 + 前端 `<details>` 報表面板 | ✅ |

### UI 對齊 ✅ `60dba8e`

- admin-requisitions sidebar 砍公開 nav（首頁/服務/作品/關於 + sb-cta）
- admin-payment-records / admin-deals / admin-refund-requests：sun icon 升級 8 線版（對齊 `sidebar-public-bottom.hbs`）+ lang dropdown
- 3 個新 admin 頁 i18n 全套（zh-TW / en / ja / ko），新增 `src/i18n/admin-{payment-records,deals,refund-requests}.json`

### Wave 4 ✅ `d67ab98`

| # | 項目 | 狀態 |
|---|---|---|
| T14 | admin 4 個讀取 endpoint info-level audit（含 filter + result_count；CSV export 標 `*.exported`） | ✅ |
| T15 | 3 個敏感讀取 endpoint 60 read/min per admin；超過 → 429 + warn audit | ✅ |
| T17 | `payment_webhook_dlq` 表（migration 0033）+ webhook 4 個失敗點落 DLQ + admin 列表 endpoint | ✅ |

---

## 未做（決議擱置）

| # | 項目 | 理由 |
|---|---|---|
| T6 | `deals.payment_intent_ids` JSON 陣列 → 獨立 join 表 | 對帳查詢已用 FK；改造成本 > 收益 |
| T16 | CSP `strict-dynamic` 升級 | 預防性，現有 `style-src 'self'` 不擋 inline style attribute；之後 CSP 升級時再做 |
| T18 | step-up token 5min 過期沒 retry UX | 流程設計就是即時操作；admin 慢於 5min 重點是補 OTP，自動 retry 反而隱藏狀態 |

---

## 路徑/檔案參考

- 既有充值對帳工具（**不刪除，與新頁並存**）：`src/pages/admin-payments.html` + `src/js/admin-payments.js` + `functions/api/admin/payments/`
- 既有需求單：`src/pages/admin-requisitions.html` + `src/js/admin-requisitions.js` + `functions/api/admin/requisitions/`
- 新建獨立頁：`admin-payment-records.html` / `admin-deals.html` / `admin-refund-requests.html`
- TG 同步：`functions/utils/tg-requisition.js`（pending / refund_pending / revoked / deal / deleted 全覆蓋）
- D1 migrations 套用方式：用 `wrangler d1 execute --remote --file <path>` 直接套（drift 已知，`migrations apply` 會撞 0014 dup column；見 `reference_d1_schema_drift.md`）
