-- AI 助手稽核表：每次 /api/ai/assist 呼叫一筆
-- 同時作為限流計數來源（COUNT WHERE ip=? AND created_at > ...）
-- 與 login_attempts / requisition 一致的設計，避免額外維護 rate_limit 表
CREATE TABLE IF NOT EXISTS ai_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER,                -- NULL = 訪客（理論上 AI 頁僅限會員，但保留欄位）
  ip           TEXT,
  fingerprint  TEXT,                   -- 前端瀏覽器指紋（簡易 canvas+UA 雜湊）
  session_id   TEXT,                   -- 同一前端 tab 共用，限制 hourly window
  prompt       TEXT NOT NULL,          -- 使用者輸入（≤ 500 字）
  response     TEXT,                   -- AI 結構化輸出（JSON 序列化）
  model        TEXT,                   -- e.g. @cf/meta/llama-3.1-8b-instruct-fast
  status       TEXT NOT NULL,          -- 'ok' / 'blocked' / 'rate_limited' / 'ai_error' / 'invalid_json'
  block_reason TEXT,                   -- 拒絕原因（黑名單關鍵字 / 長度超限 / 其他）
  duration_ms  INTEGER,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_ip_time          ON ai_audit (ip, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_session_time     ON ai_audit (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_fingerprint_time ON ai_audit (fingerprint, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_audit_user_time        ON ai_audit (user_id, created_at);
