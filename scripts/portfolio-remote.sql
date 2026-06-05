-- 遠端 D1 作品集管理 SQL
-- 執行方式：npx wrangler d1 execute chiyigo_db --remote --command "..."
-- 或：npx wrangler d1 execute chiyigo_db --remote --file=scripts/portfolio-remote.sql

-- ① 列出所有作品
-- SELECT id, title, category, sort_order FROM portfolio ORDER BY sort_order;

-- ② 新增作品（修改後取消註解執行）
-- INSERT INTO portfolio (title, category, description, image_url, link_url, tags, sort_order)
-- VALUES ('作品標題', 'Web', '作品描述', '/images/xxx.jpg', 'https://...', '標籤1,標籤2', 10);

-- ③ 更新作品
-- UPDATE portfolio SET title = '新標題', sort_order = 5 WHERE id = 1;

-- ④ 刪除作品
-- DELETE FROM portfolio WHERE id = 1;

-- ⑤ 查看需求表單
-- SELECT id, name, email, service, budget, created_at FROM requisition ORDER BY created_at DESC LIMIT 20;

-- ─────────────────────────────────────────────────────────────
-- 2026-05-10：新增「運動減重 APP」（sport-app）→ 已 apply (id=15)
-- ─────────────────────────────────────────────────────────────
-- INSERT INTO portfolio (title, category, description, image_url, link_url, tags, sort_order)
-- VALUES (
--   '運動減重 APP',
--   'App',
--   '跨平台健身 / 健康 / 飲食 / 地圖探索系統。Cloudflare-native 全棧（Workers + D1 + KV + R2 + Workers AI），Web 為 React + Vite PWA、Mobile 為 Expo iOS/Android，並串接 chiyigo OIDC 單一登入。',
--   '/images/portfolio/sport_app.jpg',
--   'https://sport-app-web.pages.dev/',
--   'React, PWA, Expo, Cloudflare Workers, D1, OIDC SSO, Workers AI',
--   10
-- );

-- ─────────────────────────────────────────────────────────────
-- 2026-05-10：刪掉舊的「健身紀錄 APP」(id=8，無圖無連結，被新的運動減重 APP 取代)
-- ─────────────────────────────────────────────────────────────
DELETE FROM portfolio WHERE id = 8 AND title = '健身紀錄 APP';

-- ─────────────────────────────────────────────────────────────
-- 2026-05-28：會員系統封面對齊全站格式（commit 098f392 已把全站 og 圖 jpg→webp，
--             唯獨此 DB row 漏改，仍指向已從 repo 移除的孤兒 .jpg）→ 已 apply (remote)
-- ─────────────────────────────────────────────────────────────
UPDATE portfolio SET image_url = '/images/portfolio/og-case-platform.webp' WHERE id = 6 AND title = 'CHIYIGO 會員系統';

-- ─────────────────────────────────────────────────────────────
-- 2026-06-05：新增「Vibe Coding Academy 程式教學平台」（vibe-coding-academy）
--             category=Web；排在現有 Web 項（解答之書 sort_order=101 / 塔羅作品集 102）之後 → sort_order=103
--             圖片 /images/portfolio/vibe-coding-banner-1672x914.webp（實際 1696×927、比例≈1.83；卡片 16:9 object-fit:cover 會左右各裁約 1.4%，owner 確認可接受）已隨 PR #23 merge→deploy 上線
--             → 已 apply (remote id=17；2026-06-05；CJK 字串以暫存 .sql --file 執行)
-- ─────────────────────────────────────────────────────────────
-- INSERT INTO portfolio (title, category, description, image_url, link_url, tags, sort_order)
-- VALUES (
--   'Vibe Coding Academy 程式教學平台',
--   'Web',
--   '程式教學平台，用圖解、流程圖與生活化比喻帶完全新手從 0 到 1 打造網站、SaaS 與 AI 產品。涵蓋 52+ 知識主題、113+ 互動圖解，提供作品集 / CRM / SaaS / AI 工具四條學習路徑，支援繁中 / English / 日本語 / 한국어。Next.js + Tailwind CSS + MDX + Mermaid，部署於 Cloudflare Pages。',
--   '/images/portfolio/vibe-coding-banner-1672x914.webp',
--   'https://vibe-coding-academy.pages.dev/zh-TW/',
--   'Next.js, Tailwind CSS, MDX, Mermaid, Cloudflare Pages',
--   103
-- );
