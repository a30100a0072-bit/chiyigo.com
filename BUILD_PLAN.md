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
