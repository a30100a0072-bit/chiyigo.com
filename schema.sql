-- CHIYIGO D1 Schema

CREATE TABLE IF NOT EXISTS portfolio (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  title     TEXT    NOT NULL,
  category  TEXT    NOT NULL,
  description TEXT,
  image_url TEXT,
  link_url  TEXT,
  tags      TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS requisition (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  company      TEXT,
  contact      TEXT NOT NULL,
  service_type TEXT NOT NULL,
  budget       TEXT,
  timeline     TEXT,
  message      TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now'))
);

-- 範例資料
INSERT INTO portfolio (title, category, description, image_url, tags, sort_order)
VALUES
  ('品牌識別設計', 'Branding', '從零開始建立企業視覺識別系統', '/images/portfolio-1.jpg', '品牌,Logo,視覺', 1),
  ('電商網站開發', 'Web', '高轉換率電商前端開發', '/images/portfolio-2.jpg', '網站,電商,UI', 2),
  ('社群媒體策略', 'Marketing', '整合性社群行銷規劃與執行', '/images/portfolio-3.jpg', '社群,行銷,策略', 3);
