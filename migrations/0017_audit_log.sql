-- Migration 0017: audit_log — 一般使用者端事件審計
--
-- 緣起：
--   admin_audit_log（0003 + 0012 雜湊鏈）只記 admin 操作。一般 user 端事件
--   （login / logout / oauth.code.exchange / mfa.totp.* ...）需要獨立表，
--   避免量級差異拖垮 admin query。
--
-- 行為：
--   - 應用層 INSERT，不做 trigger 阻擋 UPDATE/DELETE
--   - 不做 hash chain：個人專案沒有「需要證明 admin 沒改紀錄」的場景；
--     真要做時再加 ALTER TABLE + chain 計算（同 0012 模式）
--   - severity='warn'/'critical' → middleware 推 Discord webhook（沿用既有
--     5xx 告警通道）
--   - 過期 row 由 cron 清（保留 90 天）
--
-- event_type 命名規則：
--   <domain>.<action>[.<result>]
--   domain: auth / account / oauth / mfa
--   例：auth.login.success / mfa.totp.verify.fail / oauth.code.exchange.success
--
-- event_data：
--   JSON。欄位無強制 schema，但約定：
--   - trace_id: 對應 middleware 注入的 traceId
--   - reason_code: 失敗原因標準化字串
--   一律不存 PII 明文（IP 用 hash、email 不入 audit）。

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT    NOT NULL,
  severity    TEXT    NOT NULL DEFAULT 'info',
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  client_id   TEXT,
  ip_hash     TEXT,
  event_data  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK(severity IN ('info','warn','critical'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created  ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_created ON audit_log(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_severity      ON audit_log(severity, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at    ON audit_log(created_at);
