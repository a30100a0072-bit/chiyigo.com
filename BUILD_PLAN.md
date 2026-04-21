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

### 階段三：後端 API（Cloudflare Pages Functions）
- [ ] 3.1 `functions/api/portfolio.js` — GET，查詢 D1
- [ ] 3.2 `functions/api/requisition.js` — POST，寫入 D1 + Telegram 警報

### 階段四：部署準備
- [ ] 4.1 建立 `.gitignore`
- [ ] 4.2 驗證 wrangler 設定
- [ ] 4.3 部署指令說明

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
| 4.1 .gitignore | ✅ 完成 | 2026-04-22 | 排除 node_modules, .wrangler, .dev.vars |

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

6. **部署** ⏳ 待執行
   ```bash
   npx wrangler pages deploy public
   ```
   需先在 Cloudflare Pages Dashboard 設定環境變數：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
