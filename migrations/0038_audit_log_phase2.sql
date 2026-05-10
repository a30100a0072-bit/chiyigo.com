-- Migration 0038: F-3 Phase 2 audit retention 基礎建設
--
-- 範圍：
--   1. audit_log 加 archived_at + cold_class（不加 admin_audit_log，v3 user decision）
--   2. cold_class 用 DEFAULT 'immutable'；既有 row 用 UPDATE+IN backfill 改回正確分類
--   3. 新建 audit_archive_chunks 表（per-chunk 狀態 + cold_class_version + 雙路徑驗證需要的時間欄）
--   4. 新建 audit_log_aggregate_telemetry / audit_log_aggregate_debug 兩表
--
-- 設計 trade-off：
--   - cold_class 不在 ALTER 加 CHECK：SQLite ALTER+CHECK 在 D1 行為較不確定；改靠 app 層
--     classifyForCold() + safeUserAudit 寫入路徑保證合法值。CREATE TABLE 上的 CHECK 仍保留。
--   - backfill 用獨立 UPDATE per cold_class，cold_class='immutable' guard 確保 idempotent re-run。
--     immutable 不需 UPDATE（DEFAULT 已是）。順序：security_critical → security_warn → 其他。
--   - 5 個 cold_class 的 event_type IN (...) 列表是 functions/utils/audit-policy.js 的鏡射；
--     兩邊未來改動需同步（PR 描述提一句 reviewer 看）。

-- ── Part 1：audit_log 加欄 + 索引 ──
ALTER TABLE audit_log ADD COLUMN archived_at TEXT;
ALTER TABLE audit_log ADD COLUMN cold_class TEXT NOT NULL DEFAULT 'immutable';

CREATE INDEX IF NOT EXISTS idx_audit_log_archived_at ON audit_log(archived_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_cold_id    ON audit_log(cold_class, id);

-- ── Part 2：backfill cold_class（idempotent；每 UPDATE 都帶 cold_class='immutable' guard）──

-- security_critical：category=security_signal AND severity='critical'
UPDATE audit_log SET cold_class = 'security_critical'
 WHERE cold_class = 'immutable' AND severity = 'critical' AND event_type IN (
  'account.password.reset.backup_code_fail',
  'admin.unknown_role_actor',
  'admin.unknown_role_target',
  'auth.country_jump',
  'auth.login.banned_attempt',
  'auth.login.cooldown',
  'auth.login.fail',
  'auth.login.ip_blacklist_added',
  'auth.login.ip_blacklisted',
  'auth.login.success',
  'auth.new_device',
  'auth.refresh.fail',
  'auth.risk.blocked',
  'auth.risk.medium',
  'auth.step_up.fail',
  'auth.step_up.success',
  'kyc.gate.fail',
  'mfa.totp.activate.fail',
  'mfa.totp.disable.fail',
  'mfa.totp.verify.fail',
  'mfa.totp.verify.replay',
  'mfa.totp.verify.success',
  'oauth.bind_email.collision_blocked',
  'oauth.callback.fail',
  'oauth.code.exchange.fail',
  'payment.gate.fail',
  'payment.webhook.psp_direct_blocked',
  'register.guest_id_invalid_format',
  'wallet.bind.fail',
  'webauthn.register.fail'
);

-- security_warn：category=security_signal AND severity!='critical'（已先過 security_critical UPDATE）
UPDATE audit_log SET cold_class = 'security_warn'
 WHERE cold_class = 'immutable' AND event_type IN (
  'account.password.reset.backup_code_fail',
  'admin.unknown_role_actor',
  'admin.unknown_role_target',
  'auth.country_jump',
  'auth.login.banned_attempt',
  'auth.login.cooldown',
  'auth.login.fail',
  'auth.login.ip_blacklist_added',
  'auth.login.ip_blacklisted',
  'auth.login.success',
  'auth.new_device',
  'auth.refresh.fail',
  'auth.risk.blocked',
  'auth.risk.medium',
  'auth.step_up.fail',
  'auth.step_up.success',
  'kyc.gate.fail',
  'mfa.totp.activate.fail',
  'mfa.totp.disable.fail',
  'mfa.totp.verify.fail',
  'mfa.totp.verify.replay',
  'mfa.totp.verify.success',
  'oauth.bind_email.collision_blocked',
  'oauth.callback.fail',
  'oauth.code.exchange.fail',
  'payment.gate.fail',
  'payment.webhook.psp_direct_blocked',
  'register.guest_id_invalid_format',
  'wallet.bind.fail',
  'webauthn.register.fail'
);

-- read_audit
UPDATE audit_log SET cold_class = 'read_audit'
 WHERE cold_class = 'immutable' AND event_type IN (
  'admin.audit.read',
  'admin.payment_webhook_dlq.read',
  'admin.refund_requests.read',
  'admin.requisitions.read',
  'payment.metadata_archive.viewed'
);

-- telemetry
UPDATE audit_log SET cold_class = 'telemetry'
 WHERE cold_class = 'immutable' AND event_type IN (
  'admin.read.rate_limited',
  'auth.login.rate_limited',
  'auth.refresh.rate_limited',
  'auth.step_up.rate_limited',
  'oauth.backchannel.dispatch',
  'oauth.token.rate_limited',
  'webauthn.register.options'
);

-- debug_failure
UPDATE audit_log SET cold_class = 'debug_failure'
 WHERE cold_class = 'immutable' AND event_type IN (
  'auth.delete.exception',
  'kyc.webhook.fail',
  'payment.refund.fail',
  'payment.refund.network_error',
  'payment.vendor.misconfigured',
  'payment.webhook.fail',
  'requisition.refund.fail',
  'requisition.refund.network_error',
  'requisition.save_as_deal.fail'
);

-- immutable：DEFAULT 已是 'immutable'；以及未列在上述 5 桶的未知 event_type 也保留 'immutable'
-- （safest fallback，最長 retention；prod 出現 unclassified event 時 audit-policy 會 console.warn）

-- ── Part 3：audit_archive_chunks 表（per-chunk 狀態機）──
CREATE TABLE IF NOT EXISTS audit_archive_chunks (
  env                TEXT    NOT NULL,
  table_name         TEXT    NOT NULL,
  cold_class         TEXT    NOT NULL
                     CHECK(cold_class IN ('immutable','security_critical','security_warn','read_audit','telemetry','debug_failure')),
  cold_class_version INTEGER NOT NULL DEFAULT 1,
  archive_date       TEXT    NOT NULL,           -- YYYY-MM-DD
  min_id             INTEGER NOT NULL,
  max_id             INTEGER NOT NULL,
  chunk_sha256       TEXT    NOT NULL,
  state              TEXT    NOT NULL
                     -- audit_log success terminal: purged
                     -- admin_audit_log (Phase 2) success terminal: cold_copied
                     -- blocking failure（非完成 terminal，卡 cursor / month finalize）: failed / blacklisted
                     CHECK(state IN ('planned','uploaded','verified','marked_archived','purged','cold_copied','failed','blacklisted')),
  row_count          INTEGER NOT NULL,
  retry_count        INTEGER NOT NULL DEFAULT 0,
  last_failure_at    TEXT,
  last_failure       TEXT,
  next_reminder_at   TEXT,
  blacklisted_at     TEXT,
  marked_archived_at TEXT,
  purge_after        TEXT,                       -- = marked_archived_at + 7 days
  cold_copied_at     TEXT,
  run_id             TEXT    NOT NULL,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256)
);

CREATE INDEX IF NOT EXISTS idx_archive_chunks_state ON audit_archive_chunks(state, table_name, cold_class);
CREATE INDEX IF NOT EXISTS idx_archive_chunks_purge ON audit_archive_chunks(state, purge_after)
  WHERE state = 'marked_archived';
CREATE INDEX IF NOT EXISTS idx_archive_chunks_blacklist ON audit_archive_chunks(blacklisted_at)
  WHERE blacklisted_at IS NOT NULL;

-- ── Part 4：aggregate 表 ──

CREATE TABLE IF NOT EXISTS audit_log_aggregate_telemetry (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT NOT NULL,
  user_id       INTEGER,                         -- nullable（unauth events）；UNIQUE 用 COALESCE 處理
  severity      TEXT NOT NULL,
  hour_bucket   TEXT NOT NULL,                   -- YYYY-MM-DDTHH:00:00Z
  count         INTEGER NOT NULL,
  ip_hash_top   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agg_tele_event ON audit_log_aggregate_telemetry(event_type, hour_bucket);
CREATE INDEX IF NOT EXISTS idx_agg_tele_user  ON audit_log_aggregate_telemetry(user_id, hour_bucket)
  WHERE user_id IS NOT NULL;
-- Codex round-11 M/L-3：bucket 唯一約束，PR 3 aggregate worker crash/retry 時 idempotent。
-- SQLite UNIQUE 認 NULL 為 distinct → 用 COALESCE 轉空字串/0 sentinel 確保正確去重。
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agg_tele_bucket ON audit_log_aggregate_telemetry(
  event_type, COALESCE(user_id, -1), severity, hour_bucket
);

CREATE TABLE IF NOT EXISTS audit_log_aggregate_debug (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type      TEXT NOT NULL,
  reason_code     TEXT,                          -- nullable
  hour_bucket     TEXT NOT NULL,
  total_count     INTEGER NOT NULL,
  sample_count    INTEGER NOT NULL,
  samples_json    TEXT NOT NULL,
  sampled         INTEGER NOT NULL DEFAULT 0,    -- 1 = total_count > sample_count
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agg_debug_event ON audit_log_aggregate_debug(event_type, hour_bucket);
-- 同上：bucket 唯一；reason_code NULL 用空字串 sentinel
CREATE UNIQUE INDEX IF NOT EXISTS uniq_agg_debug_bucket ON audit_log_aggregate_debug(
  event_type, COALESCE(reason_code, ''), hour_bucket
);
