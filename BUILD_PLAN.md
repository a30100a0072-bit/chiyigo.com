# CHIYIGO.COM 建構計畫

**架構**：MPA + Cloudflare Pages Functions + D1 SQLite  
**風格**：Arshire Style — Tailwind CSS + Vanilla JS，零框架

---

## 建構步驟

### 階段一：專案骨架
- [x] 1.1 建立目錄結構（public/, functions/api/）
- [x] 1.2 建立 `wrangler.toml`（Cloudflare Pages 設定）
- [x] 1.3 建立 D1 Schema（`schema.sql`）
- [x] 1.4 建立 `tailwind.config.js`

### 階段二：前端頁面
- [x] 2.1 `index.html` — 靜態首頁（Hero + 服務 + CTA）
- [x] 2.2 `portfolio.html` — 動態作品集（fetch GET /api/portfolio）
- [x] 2.3 `requisition.html` — 需求表單（POST /api/requisition）

### 階段三：後端 API（Cloudflare Pages Functions）
- [x] 3.1 `functions/api/portfolio.js` — GET，查詢 D1
- [x] 3.2 `functions/api/requisition.js` — POST，寫入 D1 + Telegram 警報

### 階段四：部署準備
- [x] 4.1 建立 `.gitignore`
- [x] 4.2 驗證 wrangler 設定
- [x] 4.3 部署至 Cloudflare Pages（wrangler CLI）

### 階段五：內容管理工具
- [x] 5.1 `scripts/portfolio-add.mjs` — 互動式新增作品集（Node CLI）
- [x] 5.2 `scripts/portfolio-list.mjs` — 列出 / 刪除作品（Node CLI）
- [x] 5.3 `scripts/portfolio-remote.sql` — 遠端 D1 管理 SQL 範本

### 階段六：SEO 與效能
- [x] 6.1 Open Graph / Twitter Card meta — 三頁面
- [x] 6.2 `sitemap.xml`
- [x] 6.3 `robots.txt`（requisition & api 禁止索引）
- [x] 6.4 Cloudflare Web Analytics（token be8c93... 已填入三頁面）

### 階段七：上線後收尾
- [x] 7.1 chiyigo.com DNS 驗證完成，SSL 啟用
- [ ] 7.2 www.chiyigo.com 重導向至 chiyigo.com（等待 Cloudflare DNS 自動 active）
- [x] 7.3 填入 Cloudflare Web Analytics token（三個 HTML 頁面）
- [x] 7.4 製作並上傳 OG 封面圖（public/images/chiyigo.jpg）
- [x] 7.5 提交 sitemap 至 Google Search Console（2 頁已收錄）
- [x] 7.6 設定 GitHub → Cloudflare Pages 自動部署（CI/CD）
- [ ] 7.7 Google Search Console 搜尋流量數據（約 1–3 天後出現）

---

## 進度記錄

| 步驟 | 狀態 | 完成時間 | 備註 |
|------|------|----------|------|
| 1.1 目錄結構 | ✅ 完成 | 2026-04-22 | `public/`, `functions/api/` |
| 1.2 wrangler.toml | ✅ 完成 | 2026-04-22 | D1 binding = `chiyigo_db` |
| 1.3 schema.sql | ✅ 完成 | 2026-04-22 | portfolio + requisition 表，含範例資料 |
| 1.4 tailwind.config.js | ✅ 完成 | 2026-04-22 | brand 色系、fadeUp 動畫、Inter + Noto Sans TC |
| 2.1 index.html | ✅ 完成 | 2026-04-22 | Hero + 服務卡片 + CTA，IntersectionObserver 漸顯 |
| 2.2 portfolio.html | ✅ 完成 | 2026-04-22 | fetch `/api/portfolio`，Skeleton + 分類篩選 |
| 2.3 requisition.html | ✅ 完成 | 2026-04-22 | POST `/api/requisition`，表單驗證 + 成功畫面 |
| 3.1 portfolio.js | ✅ 完成 | 2026-04-22 | GET D1，60s Cache-Control |
| 3.2 requisition.js | ✅ 完成 | 2026-04-22 | POST D1 + Telegram `waitUntil` 非阻塞通知 |
| 4.1 .gitignore | ✅ 完成 | 2026-04-22 | 排除 node_modules, .wrangler, .dev.vars, .claude |
| 5.1 portfolio-add.mjs | ✅ 完成 | 2026-04-22 | 互動式 CLI 新增作品集 |
| 5.2 portfolio-list.mjs | ✅ 完成 | 2026-04-22 | 列出 / 刪除作品集，支援 `delete <id>` |
| 5.3 portfolio-remote.sql | ✅ 完成 | 2026-04-22 | 遠端 D1 CRUD SQL 範本 |
| 6.1 OG / Twitter Card | ✅ 完成 | 2026-04-22 | 三頁面，requisition 設 noindex |
| 6.2 sitemap.xml | ✅ 完成 | 2026-04-22 | 含 / 和 /portfolio |
| 6.3 robots.txt | ✅ 完成 | 2026-04-22 | 禁止索引 requisition & api |
| 6.4 Cloudflare Analytics | ✅ 完成 | 2026-04-22 | token be8c93... 已填入三個頁面 |
| A.1 GitHub repo 建立 | ✅ 完成 | 2026-04-22 | github.com/a30100a0072-bit/chiyigo.com |
| A.2 推送至 GitHub | ✅ 完成 | 2026-04-22 | branch: main |
| A.3 Cloudflare Pages 部署 | ✅ 完成 | 2026-04-22 | wrangler CLI 直接部署 |
| A.4 Telegram secrets 設定 | ✅ 完成 | 2026-04-22 | TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID 已上傳 |
| A.5 D1 binding（production） | ✅ 完成 | 2026-04-22 | chiyigo_db 綁定，/api/portfolio 線上測試通過 |
| A.6 自訂網域 chiyigo.com | ✅ Active | 2026-04-22 | SSL enabled |
| A.7 自訂網域 www.chiyigo.com | 🔄 等待中 | — | Cloudflare DNS 驗證後自動 active，重導向至主網域 |
| 7.6 GitHub Actions CI/CD | ✅ 完成 | 2026-04-22 | deploy.yml + CLOUDFLARE_API_TOKEN secret 已設定 |
| 7.3 Cloudflare Web Analytics | ✅ 完成 | 2026-04-22 | token be8c93... 已填入三個頁面 |
| 7.4 OG 封面圖 | ✅ 完成 | 2026-04-22 | public/images/chiyigo.jpg 24KB |
| 7.5 Google Search Console | ✅ 完成 | 2026-04-22 | 驗證網域 + 提交 sitemap，2 頁已收錄 |
| 7.7 Search Console 流量數據 | 🔄 等待中 | — | 約 1–3 天後出現，確認後打勾 |

---

## 階段八：零依賴高安規全端認證系統（Auth System）

> **架構**：Cloudflare Pages Functions + D1 + Web Crypto API + jose + otpauth  
> **目標**：100% 資料主權，支援訪客模式 (Lazy Registration)、PBKDF2 密碼、TOTP 2FA、JWT 無狀態驗證

### Step 1：環境依賴與資料庫初始化
- [x] 8.1.1 建立 `package.json` 並執行 `npm install jose otpauth`
- [x] 8.1.2 建立 `/database/schema_auth.sql`（users, local_accounts, backup_codes, user_identities, email_verifications, password_resets, refresh_tokens, oauth_states）

### Step 2：密碼與資安引擎 (Utils)
- [x] 8.2.1 建立 `/functions/utils/crypto.js`
- [x] 8.2.2 實作 PBKDF2 `hashPassword()` / `verifyPassword()`（10 萬次迭代 + Salt）
- [x] 8.2.3 實作一次性救援碼強亂數生成邏輯

### Step 3：後端 API 核心（註冊 / 訪客綁定 / 登入）
- [x] 8.3.1 建立 `/functions/api/auth/local/register.js`（email + password + guest_id 綁定 Transaction）
- [x] 8.3.2 建立 `/functions/api/auth/local/login.js`（密碼驗證 + totp_enabled 分支 + JWT 簽發）

### Step 4：後端 API 擴充（2FA 與合規刪除）
- [x] 8.4.1 建立 `/functions/api/auth/2fa/setup.js`（產生 TOTP Secret）
- [x] 8.4.2 建立 `/functions/api/auth/2fa/activate.js`（驗證首發 OTP + 啟用 + 生成備用碼）
- [x] 8.4.3 建立 `/functions/api/auth/delete.js`（驗密碼 + Soft/Hard Delete Transaction）

### Step 5：前端獨立登入視圖
- [x] 8.5.1 建立 `/public/login.html`（全螢幕 Arshire 風格，含返回首頁連結）
- [x] 8.5.2 建立 `/public/js/auth-ui.js`（密碼 10 秒自動隱藏、guest_id LocalStorage、JWT 存儲與跳轉）
- [x] 8.5.3 補建 `/functions/api/auth/2fa/verify.js`（登入時 TOTP + 備用碼核銷）

---

## 認證系統進度記錄

| 步驟 | 狀態 | 完成時間 | 備註 |
|------|------|----------|------|
| 8.1.1 package.json + npm install | ✅ 完成 | 2026-04-23 | jose + otpauth |
| 8.1.2 schema_auth.sql | ✅ 完成 | 2026-04-23 | 8 張資安合規表 |
| 8.2.1-3 crypto.js | ✅ 完成 | 2026-04-23 | PBKDF2 + 救援碼 |
| 8.3.1 register.js | ✅ 完成 | 2026-04-23 | 含 guest_id Transaction |
| 8.3.2 login.js | ✅ 完成 | 2026-04-23 | 密碼 + 2FA 分支 + fakeHashDelay |
| 8.4.1 2fa/setup.js | ✅ 完成 | 2026-04-23 | TOTP Secret 生成 |
| 8.4.2 2fa/activate.js | ✅ 完成 | 2026-04-23 | 驗 OTP + 備用碼 |
| 8.4.3 delete.js | ✅ 完成 | 2026-04-23 | 合規 Soft/Hard Delete |
| 8.5.1 login.html | ✅ 完成 | 2026-04-23 | Arshire 全螢幕視圖 |
| 8.5.2 auth-ui.js | ✅ 完成 | 2026-04-23 | 密碼隱藏 + JWT 流程 |
| 8.5.3 2fa/verify.js | ✅ 完成 | 2026-04-23 | TOTP + 備用碼原子核銷 |

---

## 上線後維護備忘

### 新增作品集
```bash
node scripts/portfolio-add.mjs
```

### 查看 / 刪除作品集
```bash
node scripts/portfolio-list.mjs
node scripts/portfolio-list.mjs delete <id>
```

### 查看收到的需求表單
```bash
npx wrangler d1 execute chiyigo_db --remote --command "SELECT * FROM requisition ORDER BY created_at DESC LIMIT 20;"
```

### 本機開發預覽
```bash
npx wrangler pages dev public --d1 chiyigo_db
# 重新啟動後需執行一次：
node scripts/seed-local.mjs
```

### 部署（推送至 GitHub 即自動觸發）
```bash
git push origin main
```

---

## 基礎設施資訊

| 項目 | 值 |
|------|-----|
| D1 database_id | `59f73214-1203-44b7-840f-86cb3998fbb6` |
| D1 binding name | `chiyigo_db` |
| Cloudflare Pages project | `chiyigo-com` |
| GitHub repo | https://github.com/a30100a0072-bit/chiyigo.com |
| Cloudflare Analytics token | `be8c93305dda4f16b57c925bc681b2f6` |
