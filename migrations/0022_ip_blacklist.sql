-- Migration 0022: IP 黑名單（Phase E-4 brute force protection 強化）
--
-- 緣起：
--   E3 已上 per-IP/per-user/per-email 限流（5/IP/min 等），但對「慢速撞庫」
--   無能（每 15 秒 1 次，遠低於 5/min）。E4 加兩道防護：
--     (1) 同 user 漸進 cooldown（在 login.js + login_attempts 表計數，無需建表）
--     (2) 同 IP 跨多個 user 嘗試 = credential stuffing → 24hr 黑名單，需建這張表
--
-- 表設計：
--   ip 為 PK：D1 對 PK + datetime() 比較很快，不需多餘 index
--   reason 用文字描述（'cross_user_scan' 等）方便日後分析
--   expires_at 寫死 24hr（caller 計算）；過期判斷由 query 加 WHERE 不靠 cleanup
--   cleanup cron 已可清理過期 row（admin/cron/cleanup.js 加進列表）

CREATE TABLE IF NOT EXISTS ip_blacklist (
  ip          TEXT    PRIMARY KEY,
  reason      TEXT    NOT NULL,
  blocked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT    NOT NULL,
  hit_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ip_blacklist_expires ON ip_blacklist(expires_at);
