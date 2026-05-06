# Manual TODO — 只能手動完成的 Cloudflare 設定

這份檔案列出**只有你能在 Cloudflare / GitHub Dashboard 操作的步驟**。
程式碼已部署，但需要這些設定才會真正生效。

未配置時的 graceful degradation：
- KV：`functions/utils/kv.js` 在 binding 未設時 fallback 為 cache miss（不破流程）
- Turnstile：secret 未設時 `verifyTurnstile()` 會 skip（不破流程，但無防護）
- Cron：`CRON_SECRET` 未設時 endpoint 回 500 + workflow 失敗（看得見，不會悄悄壞）
- Access：完全選擇性，不影響 app 行為

---

## 1. KV Namespace ✅ 已完成（2026-05-03）

- 已建 `CHIYIGO_KV`（id: `e3ca0c13ce5a4ec9aee7d550b0596e04`）
- wrangler.toml binding 已生效（dashboard binding 不需要）
- 驗證通過：`/api/admin/kv-test` 回 `bound: true, writeReadOk: true`（端點已刪）

---

## 2. Turnstile（反 bot 驗證）✅ 已完成（2026-05-03）

- Widget `chiyigo` 建立完成（hostname: chiyigo.com，mode: Managed）
- Site key `0x4AAAAAADISz6kSGZRC94TQ` 已替換到 login.html / forgot-password.html
- Secret key 已存 Pages env var `TURNSTILE_SECRET_KEY`（encrypted）
- 已串：`/api/auth/local/login` / `/register` / `/forgot-password`
- 本機 dev：`.dev.vars` 用 always-pass `1x0000000000000000000000000000000AA`

> 驗證最終：實際登入一次成功 → Turnstile 全鏈路通

---

## 3. Phase 0 Migrations 套用到 D1 ✅ 已完成（2026-05-03）

- 0015 `oauth_clients` ✅（表已存在 schema drift，IF NOT EXISTS 安全跑過）
- 0016 `revoked_jti` ✅ 新建成功（含 index）
- 0017 `audit_log` ✅（表已存在 schema drift，IF NOT EXISTS 安全跑過）
- 0018 `users.public_sub` ✅（欄位已存在，ALTER 安全跑過）

---

## 4. Cron — D1 Cleanup ✅ 已完成（2026-05-03）

- `CRON_SECRET` 已設於 Pages env var（Production，encrypted）與 GitHub repo secret（兩端一致）
- endpoint `/api/admin/cron/cleanup` 已串通，GitHub Actions workflow `Cron — D1 Cleanup` 可正常執行

<details>
<summary>原始設定步驟（保留供未來重建參考）</summary>

### 步驟

```bash
# 1. 產生隨機 secret（複雜度 ≥ 32 字元）
openssl rand -hex 32
# 或在 PowerShell：
# [Convert]::ToHexString((1..32 | %{[byte](Get-Random -Max 256)}))
```

#### 4.1 設定 Pages env var
Cloudflare Pages dashboard → chiyigo-com → Settings → Environment variables → Production：
- 新增 `CRON_SECRET` = 上面產的 hex
- 標記為 **Encrypt**

#### 4.2 設定 GitHub repo secret
GitHub repo → Settings → Secrets and variables → Actions → New repository secret：
- Name: `CRON_SECRET`
- Value: **同一個 hex**（兩邊必須一致）

#### 4.3 驗證
1. Push commits → GitHub Actions tab 看 `Cron — D1 Cleanup` workflow
2. Run manually 一次：Actions → Cron — D1 Cleanup → **Run workflow**
3. 看 log，正常會看到：
   ```
   Status: 200
   Body: {"ok":true,"totalDeleted":N,"results":[...]}
   ```

</details>

---

## 5. Cloudflare Access — Admin 保護 ✅ 已完成（2026-05-03）

- App `chiyigo-admin` 建立，保護 `chiyigo.com/admin*`
- Policy `Allow owner`：email `a30100a0072@gmail.com`
- `/api/admin/cron/*` 開頭是 `/api/` 不符合 `/admin*`，無需 Bypass policy

---

## 6. ECPay 綠界金流 — 申請正式商店（沒申請仍可用沙箱不會壞）

**現況**：env 沒設 `ECPAY_*` 時 fallback 沙箱公開 creds（新 MerchantID `3002607` / 舊 `2000132` 已停用），prod 部署照樣能跑但走測試環境 → **不會誤扣真錢**，只是真用戶付不了款。

**⚠️ 守門生效（commit 25ac234，2026-05-06）**：`ECPAY_MODE='prod'` 一旦存在，三把金鑰任一缺就 throw 500 `PAYMENT_VENDOR_MISCONFIGURED`，不會偷用 sandbox creds。設定順序務必對，不然中間會卡 throw。

### 6.1 申請特店帳號（個人戶可開，免月費）
- 去 https://www.ecpay.com.tw → 申請特店
- **個人戶**（自然人）即可開，不用公司行號
- 提供：身份證 + 銀行存摺 + 自拍持證件照
- 審核時間：3–7 個工作日
- **零月費 + 零 setup fee**，純抽成（信用卡 2.6–2.8%）

### 6.2 拿到後設定 Pages secret（未申請前可跳過）

**順序很重要**：先設三把 creds，**最後**才設 `ECPAY_MODE=prod`。
反過來 → `ECPAY_MODE=prod` 已存在但其他三把還沒設好的那段時間，所有付款 checkout 會回 500（守門生效）。

```bash
# 1. 先設三把正式 creds（這時 ECPAY_MODE 還沒設 / 還是空 → 走 sandbox 不影響線上）
wrangler pages secret put ECPAY_MERCHANT_ID  --project-name chiyigo-com
wrangler pages secret put ECPAY_HASH_KEY     --project-name chiyigo-com
wrangler pages secret put ECPAY_HASH_IV      --project-name chiyigo-com

# 2. 確認三把都進去（CF dashboard → Settings → Variables and Secrets，看 ECPAY_* 都在）

# 3. 最後一步：切 prod 模式
wrangler pages secret put ECPAY_MODE         --project-name chiyigo-com   # 填 prod

# 4. 驗證：登入後 hit POST /api/auth/payments/checkout/ecpay
#    response.fields.MerchantID 應該是你的正式 7 碼 ID（不是 sandbox 3002607）
```

**回退方式**（萬一正式 creds 設錯想暫時退回 sandbox）：
**四把全刪**。只刪 `ECPAY_MODE` 不夠 — sandbox 模式下程式邏輯是「env 有就用 env、沒有才 fallback」，所以你正式 ID/Key/IV 還在的話會被送去 sandbox URL，ECPay 沙箱認不得正式 MerchantID 直接拒。要回 sandbox 就連那三把一起刪乾淨。

### 6.3 ECPay 後台設 ReturnURL 白名單
- ECPay 商家後台 → 系統開發管理 → 系統介接設定
- ReturnURL = `https://chiyigo.com/api/webhooks/payments/ecpay`
- ClientBackURL（建議）= `https://chiyigo.com/dashboard/payment-result.html`

### 6.4 跑一筆 10 TWD 真實測試
- 自己用真信用卡刷 10 元
- 看 dashboard intent 是否變 `succeeded`
- 看 ECPay 後台金額是否進帳
- 對齊兩邊 = 整合驗收 PASS

---

## 7. （選擇性、有支出）規模到達才做

> **原則**：$0 成本最大化。下列項目**有金錢成本或公司流程成本**，等真規模到了才動。

### 7.1 Stripe Atlas — 海外公司（500 USD 一次性）

**成本**：USD 500 一次性 + 每年 USD 100 維運（Delaware franchise tax）+ 美國銀行帳戶月費 ~USD 20

**何時做**：
- 要收**海外用戶**付款（不是台灣 user）
- 投資人 / pitch deck 場合需要美國公司身份
- 月跨境流水 ≥ USD 5000（Stripe 跨境費 1% + 匯損 1–2% 才划算）

**不做**：純台灣 C2C / 國內接案 → 走 ECPay 就夠

**做的步驟**：
1. https://stripe.com/atlas 填表 + 付 USD 500
2. 1–2 週收到 EIN（美國稅號）+ Delaware C-Corp 註冊文件 + Stripe 帳號
3. Mercury / Brex 開美國銀行帳戶
4. 跟我說「Atlas 開好了」→ 我接 Stripe adapter（1–2 天）

### 7.2 TapPay 接入 — 台灣高 UX 信用卡（要公司行號）

**成本**：申請月費（部分方案）+ 月最低交易量門檻（部分方案）+ 公司行號設立成本（個人 → 公司：~NT$ 5000 + 維運稅務 ~NT$ 30000/年）

**何時做**：
- 月信用卡流水 ≥ NT$ 50 萬（量壓 ECPay 費率 0.6% 以上才有 ROI）
- 接案案件單筆 ≥ NT$ 30 萬（UX 摩擦顯著）
- 已有公司行號

**不做**：個人接案 / 散戶 → ECPay 全包通路更實用

### 7.3 PCI-DSS SAQ-A 自評（規模化 + 合規硬要求才做）

**成本**：ASV 季掃 ~USD 100/year（Trustwave / SecurityMetrics 等）+ 自評時間 2–4 hr/year

**何時做**：
- 月信用卡流水 ≥ USD 10000
- 接 B2B 客戶要看合規證明
- 法務正式提起

**現況**：走 PSP（ECPay/Stripe）一律不存卡號，技術上已是 SAQ-A 範圍最低，沒填 SAQ-A 表也不違規（但若被稽核要拿得出來）

### 7.4 payment_ledger 雙記帳對帳（金融級必備）

**成本**：開發 1 週 + D1 寫入量增加 ~30%（每筆 intent = 2 筆 ledger row）

**何時做**：
- 月流水 ≥ NT$ 50 萬
- 開始有退款 / chargeback 爭議
- 接會計師事務所做帳時

**現況**：靠 `payment_intents.status` + `audit_log` 暫代，散戶級足夠

### 7.5 Cloudflare Workers Paid 升級（$5/月）

**目前**：Pages Functions 免費版 = 10 萬 req/day（chiyigo 估 ~5000 req/day，遠未到）

**何時做**：
- 日 req > 8 萬（80% 用量）
- 要用 Durable Objects / Queues（免費版不支援）
- Cron Triggers > 5 min interval（免費版限制）

**不做**：目前用量遠低於免費額度

### 7.6 Resend 信件 Paid 升級（$20/月）

**目前**：免費版 100 封/天 / 3000 封/月

**何時做**：
- 月註冊 user > 1500（每人平均 2 封驗證/重設信）
- 要寄 marketing campaign

**不做**：個人接案站不會有 1500 個月新註冊

---

## 8. 完成後可以刪掉這份檔

全部設好 + 驗證通過 → `git rm MANUAL_TODO.md`

或保留作為 onboarding 文件（未來重建環境時參考）。F-2 ECPay + Atlas 等項目本身是「規模到達才做」永久 reference，建議保留。

---

## 維護紀錄

| 日期 | 事件 |
|---|---|
| 2026-05-03 | 初版（KV / Turnstile / Cron / Access / Migration 5 項）|
| 2026-05-03 | KV ✅ 完成、Turnstile ✅ 完成；剩 Migrations / Cron / Access |
| 2026-05-03 | Cron ✅ 完成、Access ✅ 完成；剩 Migrations |
| 2026-05-03 | Migrations 0015–0018 ✅ 全部完成 → MANUAL_TODO 全項打勾 |
| 2026-05-05 | 加入第 6 段（ECPay 申請特店）+ 第 7 段（規模到達才做：Atlas / TapPay / PCI / ledger / Workers Paid / Resend Paid）|
