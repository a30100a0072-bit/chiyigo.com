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
