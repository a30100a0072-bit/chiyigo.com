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
