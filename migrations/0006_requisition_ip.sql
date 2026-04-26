-- Migration 0006: requisition 加上來源 IP（per-IP 限流用）
-- 每 IP 每日上限獨立於 user/guest 計算，避免機器人耗光全域訪客配額。

ALTER TABLE requisition ADD COLUMN source_ip TEXT;

CREATE INDEX IF NOT EXISTS idx_requisition_ip ON requisition(source_ip, created_at);
