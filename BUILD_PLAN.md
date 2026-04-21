# CHIYIGO.COM 建構計畫

**架構**：MPA + Cloudflare Pages Functions + D1 SQLite  
**風格**：Arshire Style — Tailwind CSS + Vanilla JS，零框架

---

## 建構步驟

### 階段一：專案骨架
- [ ] 1.1 建立目錄結構（public/, functions/api/）
- [ ] 1.2 建立 `wrangler.toml`（Cloudflare Pages 設定）
- [ ] 1.3 建立 D1 Schema（`schema.sql`）
- [ ] 1.4 建立 `tailwind.config.js`

### 階段二：前端頁面
- [ ] 2.1 `index.html` — 靜態首頁（Hero + 服務 + CTA）
- [ ] 2.2 `portfolio.html` — 動態作品集（fetch GET /api/portfolio）
- [ ] 2.3 `requisition.html` — 需求表單（POST /api/requisition）

### 階段五：內容管理工具（B）
- [ ] 5.1 `scripts/portfolio-add.mjs` — 互動式新增作品集（Node CLI）
- [ ] 5.2 `scripts/portfolio-list.mjs` — 列出 / 刪除作品（Node CLI）
- [ ] 5.3 `scripts/portfolio-remote.sql` — 遠端 D1 管理 SQL 範本

### 階段六：SEO 與效能（C）
- [ ] 6.1 Open Graph / Twitter Card meta — 三頁面
- [ ] 6.2 `sitemap.xml`
- [ ] 6.3 `robots.txt`（requisition & api 禁止索引）
- [ ] 6.4 Cloudflare Web Analytics（部署後填入 token）

### 階段三：後端 API（Cloudflare Pages Functions）
- [ ] 3.1 `functions/api/portfolio.js` — GET，查詢 D1
- [ ] 3.2 `functions/api/requisition.js` — POST，寫入 D1 + Telegram 警報

### 階段四：部署準備
- [ ] 4.1 建立 `.gitignore`
- [ ] 4.2 驗證 wrangler 設定
- [ ] 4.3 部署指令說明

### 階段七：上線後收尾
- [ ] 7.1 等待 chiyigo.com DNS 驗證完成（最多 48h）
- [ ] 7.2 設定 www.chiyigo.com 重導向至 chiyigo.com
- [ ] 7.3 填入 Cloudflare Web Analytics token（三個 HTML 頁面）
- [ ] 7.4 製作並上傳 OG 封面圖（/images/og-cover.jpg）
- [ ] 7.5 提交 sitemap 至 Google Search Console
- [ ] 7.6 設定 GitHub → Cloudflare Pages 自動部署（CI/CD）

---

## 進度記錄

| 步驟 | 狀態 | 完成時間 | 備註 |
|------|------|----------|------|
| 1.1 目錄結構 | ✅ 完成 | 2026-04-22 | `public/`, `functions/api/` |
| 1.2 wrangler.toml | ✅ 完成 | 2026-04-22 | D1 binding = `DB`，需填入 `database_id` |
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
| 6.4 Cloudflare Analytics | ⏳ 待填入 | — | 部署後在 Dashboard 取得 token 填入三頁面 |
| A.1 GitHub repo 建立 | ✅ 完成 | 2026-04-22 | github.com/a30100a0072-bit/chiyigo.com |
| A.2 推送至 GitHub | ✅ 完成 | 2026-04-22 | branch: main，2 commits |
| A.3 Cloudflare Pages 部署 | ✅ 完成 | 2026-04-22 | wrangler CLI 直接部署，跳過 GitHub 整合 bug |
| A.4 Telegram secrets 設定 | ✅ 完成 | 2026-04-22 | TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID 已上傳 |
| A.5 D1 binding（production） | ✅ 完成 | 2026-04-22 | chiyigo_db 綁定，/api/portfolio 線上測試通過 |
| A.6 自訂網域 chiyigo.com | ✅ Active | 2026-04-22 | SSL enabled |
| A.7 自訂網域 www.chiyigo.com | 🔄 驗證中 | 2026-04-22 | pending，稍後自動 active |
| 7.6 GitHub Actions CI/CD | ✅ 完成 | 2026-04-22 | deploy.yml + CLOUDFLARE_API_TOKEN secret 已設定 |
| 7.3 Cloudflare Web Analytics | ✅ 完成 | 2026-04-22 | token be8c93... 已填入三個頁面 |
| 7.4 OG 封面圖 | ⏳ 待上傳 | — | 圖片放至 public/images/chiyigo.jpg 即完成 |
| 7.5 Google Search Console | ⏳ 待執行 | — | 提交 sitemap.xml |

---

## 部署前必做事項

1. **建立 D1 資料庫** ✅ 已完成
   - database_id: `59f73214-1203-44b7-840f-86cb3998fbb6`
   - binding: `chiyigo_db`

2. **執行 Schema** ✅ 已完成（2026-04-22）
   - 2 張資料表建立完成（portfolio, requisition）
   - 3 筆範例資料已寫入

3. **設定 Telegram 環境變數** ✅ 已完成
   - `.dev.vars` 已建立（已加入 .gitignore，不會提交）
   - `TELEGRAM_BOT_TOKEN` & `TELEGRAM_CHAT_ID` 已設定並測試通過

4. **本機開發預覽** ✅ 已完成（2026-04-22）
   ```bash
   npx wrangler pages dev public --d1 chiyigo_db
   ```
   - 表單送出 → D1 寫入成功 → Telegram 通知已確認收到

5. **本機 D1 同步問題** ✅ 已解決（2026-04-22）
   - 原因：`pages dev` 與 `d1 execute` 使用不同 SQLite hash 檔
   - 解法：建立 `scripts/seed-local.mjs`，重啟 dev server 後執行一次即可

6. **GitHub 推送** ✅ 已完成（2026-04-22）
   - Repo：https://github.com/a30100a0072-bit/chiyigo.com
   - Branch：main

7. **部署至 Cloudflare Pages** ⏳ 待執行
   步驟：
   1. Cloudflare Dashboard → Pages → Create a project → Connect to Git
   2. 選擇 `a30100a0072-bit/chiyigo.com`
   3. Build settings：Framework = None，Build output = `public`
   4. 設定環境變數：`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`
   5. Deploy

8. **部署後待辦** ⏳
   - 填入 Cloudflare Web Analytics token（三個 HTML 頁面）
   - 確認線上版表單送出與 Telegram 通知正常
   - 上傳 OG 封面圖 `/images/og-cover.jpg`
