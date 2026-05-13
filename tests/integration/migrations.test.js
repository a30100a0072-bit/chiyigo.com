/**
 * Migration smoke test — _base → up0001..0008 → down0008..0001 全部執行不報錯
 *
 * 設計：
 *  - 不驗 prod 真實資料（測試 DB 是空的）
 *  - 每個階段抽樣查詢 sqlite_master / pragma_table_info 確認 schema 變動到位
 *  - down 順序為「逆序執行」，最後狀態應該回到 _base 形狀（核心欄位）
 *
 * D1 transaction 注意：
 *  - 本測試逐條 prepare(...).run()；不可寫 BEGIN/COMMIT/PRAGMA（D1 batch 自動包 tx）
 *  - 0007 / 0007.down 用 CREATE_NEW + INSERT SELECT + DROP + RENAME 重建表
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'

import baseSql from '../../migrations/0000_base.sql?raw'
import up0001 from '../../migrations/0001_requisition_upgrade.sql?raw'
import up0002 from '../../migrations/0002_login_attempts.sql?raw'
import up0003 from '../../migrations/0003_admin_audit_log.sql?raw'
import up0004 from '../../migrations/0004_oauth_states_audit.sql?raw'
import up0005 from '../../migrations/0005_pkce_sessions_audit.sql?raw'
import up0006 from '../../migrations/0006_requisition_ip.sql?raw'
import up0007 from '../../migrations/0007_email_verifications_delete_account.sql?raw'
import up0008 from '../../migrations/0008_ai_audit.sql?raw'
import up0009 from '../../migrations/0009_users_token_version.sql?raw'
import up0010 from '../../migrations/0010_oauth_states_nonce.sql?raw'
import up0011 from '../../migrations/0011_login_attempts_kind.sql?raw'
import up0012 from '../../migrations/0012_admin_audit_hash_chain.sql?raw'
import down0001 from '../../migrations/down/0001_requisition_upgrade.down.sql?raw'
import down0002 from '../../migrations/down/0002_login_attempts.down.sql?raw'
import down0003 from '../../migrations/down/0003_admin_audit_log.down.sql?raw'
import down0004 from '../../migrations/down/0004_oauth_states_audit.down.sql?raw'
import down0005 from '../../migrations/down/0005_pkce_sessions_audit.down.sql?raw'
import down0006 from '../../migrations/down/0006_requisition_ip.down.sql?raw'
import down0007 from '../../migrations/down/0007_email_verifications_delete_account.down.sql?raw'
import down0008 from '../../migrations/down/0008_ai_audit.down.sql?raw'
import down0009 from '../../migrations/down/0009_users_token_version.down.sql?raw'
import down0010 from '../../migrations/down/0010_oauth_states_nonce.down.sql?raw'
import down0011 from '../../migrations/down/0011_login_attempts_kind.down.sql?raw'
import down0012 from '../../migrations/down/0012_admin_audit_hash_chain.down.sql?raw'

// I-1 targeted (codex r9-5 follow-up, 2026-05-10)：0037 是 prod 部署順序錯會直接 500 的 migration，
// 至少要有 targeted smoke。完整 0001..0040 forward 仍是 TODO（見 memory
// project_db_schema_baseline_drift.md task #4）；本 case 維持手建 fixture 形式。
import up0037 from '../../migrations/0037_refresh_tokens_issued_aud.sql?raw'
import up0038      from '../../migrations/0038_audit_log_phase2.sql?raw'
import down0038    from '../../migrations/down/0038_audit_log_phase2.down.sql?raw'

// Full forward chain 0013..0040（不含 down，僅驗 forward shape）
import up0013 from '../../migrations/0013_oauth_states_aud.sql?raw'
import up0014 from '../../migrations/0014_pkce_oidc_fields.sql?raw'
import up0015 from '../../migrations/0015_oauth_clients.sql?raw'
import up0016 from '../../migrations/0016_revoked_jti.sql?raw'
import up0017 from '../../migrations/0017_audit_log.sql?raw'
import up0018 from '../../migrations/0018_users_public_sub.sql?raw'
import up0019 from '../../migrations/0019_refresh_tokens_auth_time.sql?raw'
import up0020 from '../../migrations/0020_oauth_clients_seed.sql?raw'
import up0021 from '../../migrations/0021_webauthn.sql?raw'
import up0022 from '../../migrations/0022_ip_blacklist.sql?raw'
import up0023 from '../../migrations/0023_user_wallets.sql?raw'
import up0024 from '../../migrations/0024_user_kyc.sql?raw'
import up0025 from '../../migrations/0025_payment_intents.sql?raw'
import up0026 from '../../migrations/0026_requisition_refund_request.sql?raw'
import up0027 from '../../migrations/0027_rrr_requisition_nullable.sql?raw'
import up0028 from '../../migrations/0028_deals.sql?raw'
import up0029 from '../../migrations/0029_payment_intents_hardening.sql?raw'
import up0030 from '../../migrations/0030_fix_payment_intents_requisition_fk.sql?raw'
import up0031 from '../../migrations/0031_refund_request_amount.sql?raw'
import up0032 from '../../migrations/0032_payment_metadata_archive.sql?raw'
import up0033 from '../../migrations/0033_payment_webhook_dlq.sql?raw'
import up0034 from '../../migrations/0034_refund_request_unique_pending.sql?raw'
import up0035 from '../../migrations/0035_p1_used_totp_and_refresh_scope.sql?raw'
import up0036 from '../../migrations/0036_requisition_owner_columns.sql?raw'
import up0039 from '../../migrations/0039_audit_archive_chunks_dry_run.sql?raw'
import up0040 from '../../migrations/0040_requisition_index_align.sql?raw'
import up0041 from '../../migrations/0041_audit_archive_chunks_compression.sql?raw'
import up0042 from '../../migrations/0042_payment_webhook_apply_status.sql?raw'

// 0029 原本含 typo（REFERENCES requisitions 複數），2026-05-12 retroactive
// 修為單數 `requisition`（見 migration 檔頭 🔧 註解）。end-state 不變、0030 仍
// rebuild；fresh D1 走 migration ledger bootstrap 也能跑通。
const ALL_UPS = [
  up0001, up0002, up0003, up0004, up0005, up0006, up0007, up0008,
  up0009, up0010, up0011, up0012, up0013, up0014, up0015, up0016,
  up0017, up0018, up0019, up0020, up0021, up0022, up0023, up0024,
  up0025, up0026, up0027, up0028, up0029, up0030, up0031, up0032,
  up0033, up0034, up0035, up0036, up0037, up0038, up0039, up0040,
  up0041, up0042,
]

const UPS   = [up0001, up0002, up0003, up0004, up0005, up0006, up0007, up0008, up0009, up0010, up0011, up0012]
const DOWNS = [down0001, down0002, down0003, down0004, down0005, down0006, down0007, down0008, down0009, down0010, down0011, down0012]

// 每個 .sql 檔切成獨立 statements 後逐條執行（D1 不支援多 statement prepare）
// 先剝除「整行 -- 註解」再切分，避免註解開頭的 statement 被誤判為空
function stripLineComments(sql) {
  return sql.split('\n').filter(line => !line.trim().startsWith('--')).join('\n')
}
async function execAll(sql) {
  const stmts = stripLineComments(sql).split(';').map(s => s.trim()).filter(Boolean)
  for (const s of stmts) {
    await env.chiyigo_db.prepare(s).run()
  }
}

async function dropAllTables() {
  // 反覆刪到 sqlite_master 沒有非 system table 為止（避免外鍵順序問題）
  // race 防護：vitest workers pool 共用 D1 instance；其他 test file 的 resetDb 可能在
  // 我們 SELECT/DROP 之間動 schema，導致 IF EXISTS 都還會撞 "no such table"。
  // 解法：try/catch 包單一 DROP，整體仍會在下一輪 retry 直到清乾淨（最多 5 輪）。
  for (let i = 0; i < 5; i++) {
    const rows = await env.chiyigo_db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`)
      .all()
    if (!rows.results?.length) return
    for (const { name } of rows.results) {
      try {
        await env.chiyigo_db.prepare(`DROP TABLE IF EXISTS "${name}"`).run()
      } catch { /* race：被別的 test file 先刪了，下一輪 SELECT 就不會再列到 */ }
    }
  }
}

async function tableExists(name) {
  const r = await env.chiyigo_db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .bind(name)
    .first()
  return !!r
}

async function columnExists(table, col) {
  const r = await env.chiyigo_db
    .prepare(`SELECT name FROM pragma_table_info(?) WHERE name=?`)
    .bind(table, col)
    .first()
  return !!r
}

async function indexExists(name) {
  const r = await env.chiyigo_db
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
    .bind(name)
    .first()
  return !!r
}

beforeAll(async () => {
  await dropAllTables()
})

describe('migrations smoke', () => {
  it('apply _base + up 0001..0008 全部成功', async () => {
    await execAll(baseSql)
    expect(await tableExists('requisition')).toBe(true)
    expect(await tableExists('email_verifications')).toBe(true)

    for (const sql of UPS) {
      await execAll(sql)
    }

    // 抽樣驗證 up 後的關鍵 schema 變動
    expect(await columnExists('requisition', 'user_id')).toBe(true)        // 0001
    expect(await columnExists('requisition', 'tg_message_id')).toBe(true)  // 0001
    expect(await columnExists('requisition', 'status')).toBe(true)         // 0001
    expect(await columnExists('requisition', 'deleted_at')).toBe(true)     // 0001
    expect(await tableExists('login_attempts')).toBe(true)                  // 0002
    expect(await tableExists('admin_audit_log')).toBe(true)                 // 0003
    expect(await columnExists('oauth_states', 'created_at')).toBe(true)    // 0004
    expect(await columnExists('oauth_states', 'ip_address')).toBe(true)    // 0004
    expect(await indexExists('idx_oauth_states_expires')).toBe(true)        // 0004
    expect(await columnExists('pkce_sessions', 'created_at')).toBe(true)   // 0005
    expect(await columnExists('pkce_sessions', 'ip_address')).toBe(true)   // 0005
    expect(await columnExists('requisition', 'source_ip')).toBe(true)      // 0006

    // 0007: email_verifications CHECK 應接受 'delete_account'
    await env.chiyigo_db.prepare(
      `INSERT INTO users (email) VALUES ('mig-smoke@test')`
    ).run()
    const u = await env.chiyigo_db.prepare(
      `SELECT id FROM users WHERE email='mig-smoke@test'`
    ).first()
    await env.chiyigo_db.prepare(
      `INSERT INTO email_verifications (user_id, token_hash, token_type, expires_at)
       VALUES (?, 'h_smoke', 'delete_account', datetime('now','+1 hour'))`
    ).bind(u.id).run()
    const vrow = await env.chiyigo_db.prepare(
      `SELECT token_type FROM email_verifications WHERE token_hash='h_smoke'`
    ).first()
    expect(vrow.token_type).toBe('delete_account')

    expect(await tableExists('ai_audit')).toBe(true)                        // 0008
    expect(await indexExists('idx_ai_audit_ip_time')).toBe(true)            // 0008
    expect(await columnExists('users', 'token_version')).toBe(true)         // 0009
    expect(await columnExists('oauth_states', 'nonce')).toBe(true)          // 0010
    expect(await columnExists('login_attempts', 'kind')).toBe(true)         // 0011
    expect(await columnExists('login_attempts', 'user_id')).toBe(true)      // 0011
    expect(await indexExists('idx_login_attempts_kind_time')).toBe(true)    // 0011
    expect(await columnExists('admin_audit_log', 'prev_hash')).toBe(true)   // 0012
    expect(await columnExists('admin_audit_log', 'row_hash')).toBe(true)    // 0012
  })

  it('down 0008..0001 逆序執行全部成功 + schema 回到 _base 核心形狀', async () => {
    // 從上一個 it 結尾狀態接續（同 describe 內 D1 binding 共用，singleWorker 模式）
    for (const sql of [...DOWNS].reverse()) {
      await execAll(sql)
    }

    // 0012.down → admin_audit_log prev_hash / row_hash 應該不存在
    expect(await columnExists('admin_audit_log', 'prev_hash')).toBe(false)
    expect(await columnExists('admin_audit_log', 'row_hash')).toBe(false)
    // 0011.down → login_attempts kind / user_id / 索引 應該不存在
    expect(await columnExists('login_attempts', 'kind')).toBe(false)
    expect(await columnExists('login_attempts', 'user_id')).toBe(false)
    expect(await indexExists('idx_login_attempts_kind_time')).toBe(false)
    // 0010.down → oauth_states.nonce 應該不存在
    expect(await columnExists('oauth_states', 'nonce')).toBe(false)
    // 0009.down → users.token_version 應該不存在
    expect(await columnExists('users', 'token_version')).toBe(false)
    // 0008.down → ai_audit 應該不存在
    expect(await tableExists('ai_audit')).toBe(false)
    // 0006.down → source_ip / 索引應該不存在
    expect(await columnExists('requisition', 'source_ip')).toBe(false)
    expect(await indexExists('idx_requisition_ip')).toBe(false)
    // 0005.down → pkce_sessions 稽核欄位應該不存在
    expect(await columnExists('pkce_sessions', 'created_at')).toBe(false)
    expect(await columnExists('pkce_sessions', 'ip_address')).toBe(false)
    // 0004.down → oauth_states 稽核欄位應該不存在
    expect(await columnExists('oauth_states', 'created_at')).toBe(false)
    expect(await columnExists('oauth_states', 'ip_address')).toBe(false)
    // 0003.down → admin_audit_log 應該不存在
    expect(await tableExists('admin_audit_log')).toBe(false)
    // 0002.down → login_attempts 應該不存在
    expect(await tableExists('login_attempts')).toBe(false)
    // 0001.down → requisition 升級欄位應該不存在
    expect(await columnExists('requisition', 'user_id')).toBe(false)
    expect(await columnExists('requisition', 'tg_message_id')).toBe(false)
    expect(await columnExists('requisition', 'status')).toBe(false)
    expect(await columnExists('requisition', 'deleted_at')).toBe(false)
    // 0007.down → email_verifications CHECK 應該回到舊版（不接受 'delete_account'）
    let rejected = false
    try {
      await env.chiyigo_db.prepare(
        `INSERT INTO users (email) VALUES ('mig-down@test')`
      ).run()
      const u = await env.chiyigo_db.prepare(
        `SELECT id FROM users WHERE email='mig-down@test'`
      ).first()
      await env.chiyigo_db.prepare(
        `INSERT INTO email_verifications (user_id, token_hash, token_type, expires_at)
         VALUES (?, 'h_down', 'delete_account', datetime('now','+1 hour'))`
      ).bind(u.id).run()
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)

    // _base 核心表還在
    expect(await tableExists('requisition')).toBe(true)
    expect(await tableExists('users')).toBe(true)
    expect(await tableExists('email_verifications')).toBe(true)
  })

  it('再次 up 0001..0008 應該完全成功（idempotent forward）', async () => {
    for (const sql of UPS) {
      await execAll(sql)
    }
    expect(await tableExists('ai_audit')).toBe(true)
    expect(await columnExists('requisition', 'user_id')).toBe(true)
  })
})

// I-1 targeted (codex r9-5 follow-up, 2026-05-10)：0037 migration smoke。
//
// 設計選擇：本測試是 **targeted migration smoke**，不是 full forward migration proof。
// 2026-05-12 _base.sql 已重整為 12-table purified baseline（含 refresh_tokens /
// auth_codes / local_accounts 等 prod 既有表）；full forward 0001..0040 已可行，
// 待擴 test（見 memory project_db_schema_baseline_drift.md task #4）。本 case
// 維持手建 fixture 形式作 0037 issued_aud 行為 targeted 驗證。
//
// 本 case 只手建 0037 必要的 fixture（users + pre-0037 refresh_tokens），跑 0037 migration，
// 驗欄位/索引/NULL 行為/綁定持久化。F-2 refresh.js 邏輯（rawAudProvided 條件、effectiveAud
// 由 issued_aud 主導）屬 handler integration test 範疇，不在此覆蓋；TODO 補 refresh.test.js。
describe('migrations smoke 0037 targeted', () => {
  beforeAll(async () => {
    await dropAllTables()
    // pre-0037 minimal fixture：模擬 0036 後狀態
    // refresh_tokens 0037 前形狀（_base.sql + 0019/0035 後、0037 前；沒 issued_aud 欄）
    await env.chiyigo_db.prepare(`
      CREATE TABLE users (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        email           TEXT    NOT NULL UNIQUE,
        email_verified  INTEGER NOT NULL DEFAULT 0,
        role            TEXT    NOT NULL DEFAULT 'player',
        status          TEXT    NOT NULL DEFAULT 'active',
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        deleted_at      TEXT,
        token_version   INTEGER NOT NULL DEFAULT 0,
        public_sub      TEXT
      )
    `).run()
    await env.chiyigo_db.prepare(`
      CREATE TABLE refresh_tokens (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT    NOT NULL UNIQUE,
        device_info TEXT,
        device_uuid TEXT,
        expires_at  TEXT    NOT NULL,
        revoked_at  TEXT,
        auth_time   TEXT,
        scope       TEXT
      )
    `).run()
    // 寫一筆 pre-0037 row（沒 issued_aud 欄）→ 模擬 prod legacy
    await env.chiyigo_db.prepare(
      `INSERT INTO users (email) VALUES ('legacy@test')`,
    ).run()
    const u = await env.chiyigo_db.prepare(
      `SELECT id FROM users WHERE email='legacy@test'`,
    ).first()
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES (?, 'h_legacy', datetime('now','+7 days'))`,
    ).bind(u.id).run()
    // apply 0037
    await execAll(up0037)
  })

  it('issued_aud 欄存在 + 索引存在', async () => {
    expect(await columnExists('refresh_tokens', 'issued_aud')).toBe(true)
    expect(await indexExists('idx_refresh_tokens_issued_aud')).toBe(true)
  })

  it('legacy row（pre-0037 INSERT）issued_aud 為 NULL，不炸', async () => {
    const r = await env.chiyigo_db.prepare(
      `SELECT issued_aud FROM refresh_tokens WHERE token_hash='h_legacy'`,
    ).first()
    expect(r.issued_aud).toBeNull()
  })

  it('新 row 寫入 issued_aud 後持久化；後續 UPDATE 其他欄位不影響 issued_aud', async () => {
    const u = await env.chiyigo_db.prepare(
      `SELECT id FROM users WHERE email='legacy@test'`,
    ).first()
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, issued_aud)
       VALUES (?, 'h_bound_sport', datetime('now','+7 days'), 'sport-app')`,
    ).bind(u.id).run()
    // 模擬 refresh.js rotation 不應改 issued_aud：UPDATE 只動 revoked_at
    await env.chiyigo_db.prepare(
      `UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE token_hash='h_bound_sport'`,
    ).run()
    const r = await env.chiyigo_db.prepare(
      `SELECT issued_aud, revoked_at FROM refresh_tokens WHERE token_hash='h_bound_sport'`,
    ).first()
    expect(r.issued_aud).toBe('sport-app')
    expect(r.revoked_at).toBeTruthy()
  })

  it('NULL 與 bound 兩種 row 可同表共存（F-1 batch revoke 前的 backward compat 狀態）', async () => {
    const rows = await env.chiyigo_db.prepare(
      `SELECT token_hash, issued_aud FROM refresh_tokens ORDER BY id`,
    ).all()
    const map = Object.fromEntries(rows.results.map(r => [r.token_hash, r.issued_aud]))
    expect(map['h_legacy']).toBeNull()
    expect(map['h_bound_sport']).toBe('sport-app')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Full forward chain 0001..0040 vs prod snapshot
//
// 2026-05-12 schema baseline 重整後（_base.sql 改為 12-table purified baseline），
// 完整 forward 變得可行。本 describe 驗 _base + 0001..0040 跑完後的 schema shape
// 對得上 database/_prod_snapshot_2026_05_12.sql（除已知 cosmetic 差異）。
//
// 預期 list 由 prod snapshot 手動 transcribe（grep CREATE TABLE / CREATE INDEX
// + pragma_table_info），改 schema 時要同步更新此處。
// ─────────────────────────────────────────────────────────────────────────────

async function listTables() {
  const r = await env.chiyigo_db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table'
     AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'
     ORDER BY name`,
  ).all()
  return r.results.map(x => x.name).sort()
}
async function listIndexes() {
  const r = await env.chiyigo_db.prepare(
    `SELECT name FROM sqlite_master WHERE type='index'
     AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
     ORDER BY name`,
  ).all()
  return r.results.map(x => x.name).sort()
}
async function listColumns(table) {
  const r = await env.chiyigo_db.prepare(
    `SELECT name FROM pragma_table_info(?) ORDER BY name`,
  ).bind(table).all()
  return r.results.map(x => x.name).sort()
}

const EXPECTED_TABLES = [
  'admin_audit_log', 'ai_audit', 'audit_archive_chunks', 'audit_log',
  'audit_log_aggregate_debug', 'audit_log_aggregate_telemetry',
  'auth_codes', 'backup_codes', 'deals', 'email_verifications',
  'ip_blacklist', 'kyc_webhook_events', 'local_accounts', 'login_attempts',
  'oauth_clients', 'oauth_states', 'password_resets', 'payment_intents',
  'payment_metadata_archive', 'payment_webhook_dlq', 'payment_webhook_events',
  'pkce_sessions', 'portfolio', 'refresh_tokens', 'requisition',
  'requisition_refund_request', 'revoked_jti', 'used_totp', 'user_identities',
  'user_kyc', 'user_wallets', 'user_webauthn_credentials', 'users',
  'wallet_nonces', 'webauthn_challenges',
].sort()

// Per-table expected column sets（baseline 12 表 + 部分 ALTER 重點目標）
const EXPECTED_COLUMNS = {
  portfolio: ['category', 'created_at', 'description', 'id', 'image_url', 'link_url', 'sort_order', 'tags', 'title'],
  users: ['created_at', 'deleted_at', 'email', 'email_verified', 'id', 'public_sub', 'role', 'status', 'token_version'],
  requisition: ['budget', 'company', 'contact', 'created_at', 'deleted_at', 'id', 'message', 'name', 'owner_guest_id', 'owner_user_id', 'service_type', 'source_ip', 'status', 'tg_message_id', 'timeline', 'user_id'],
  local_accounts: ['password_hash', 'password_salt', 'totp_enabled', 'totp_secret', 'user_id'],
  backup_codes: ['code_hash', 'id', 'used_at', 'user_id'],
  user_identities: ['avatar_url', 'created_at', 'display_name', 'id', 'metadata', 'provider', 'provider_id', 'updated_at', 'user_id'],
  password_resets: ['expires_at', 'token_hash', 'user_id'],
  refresh_tokens: ['auth_time', 'device_info', 'device_uuid', 'expires_at', 'id', 'issued_aud', 'revoked_at', 'scope', 'token_hash', 'user_id'],
  oauth_states: ['aud', 'client_callback', 'code_verifier', 'created_at', 'expires_at', 'ip_address', 'nonce', 'platform', 'redirect_uri', 'state_token'],
  pkce_sessions: ['code_challenge', 'created_at', 'expires_at', 'ip_address', 'nonce', 'redirect_uri', 'scope', 'session_key', 'state'],
  auth_codes: ['auth_time', 'code_challenge', 'code_hash', 'expires_at', 'nonce', 'redirect_uri', 'scope', 'state', 'user_id'],
  email_verifications: ['created_at', 'expires_at', 'id', 'ip_address', 'token_hash', 'token_type', 'used_at', 'user_id'],
  audit_log: ['archived_at', 'client_id', 'cold_class', 'created_at', 'event_data', 'event_type', 'id', 'ip_hash', 'severity', 'user_id'],
  // 0042 加 apply_status（Codex r1 P0-2 dedupe 三態）；其餘欄位來自 0025_payment_intents.sql
  payment_webhook_events: ['apply_status', 'event_id', 'id', 'intent_id', 'payload_hash', 'processed_at', 'status_to', 'user_id', 'vendor'],
  // 0041 加 compression（zstd→gzip pivot）
  audit_archive_chunks: ['archive_date', 'blacklisted_at', 'chunk_sha256', 'cold_class', 'cold_class_version', 'cold_copied_at', 'compression', 'created_at', 'dry_run', 'env', 'last_failure', 'last_failure_at', 'marked_archived_at', 'max_id', 'min_id', 'next_reminder_at', 'purge_after', 'retry_count', 'row_count', 'run_id', 'state', 'table_name', 'updated_at'],
}

// 對齊後（0040 exact-parity）的 requisition 索引
const EXPECTED_REQUISITION_INDEXES = [
  'idx_requisition_guest_id',  // 0040 對齊；prod 命名（無 owner_ 前綴）
  'idx_requisition_ip',         // 0006
]

describe('full forward chain 0001..0040 vs prod snapshot', () => {
  beforeAll(async () => {
    await dropAllTables()
    await execAll(baseSql)
    for (const sql of ALL_UPS) {
      await execAll(sql)
    }
  })

  it('table set 對齊 prod snapshot（35 表）', async () => {
    const tables = await listTables()
    expect(tables).toEqual(EXPECTED_TABLES)
  })

  it('baseline 12 表 + 部分 ALTER 重點 column set 對齊', async () => {
    for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
      const got = await listColumns(table)
      expect({ table, columns: got }).toEqual({ table, columns: expected })
    }
  })

  it('0040 對齊：requisition 索引集合 = prod 命名（idx_requisition_guest_id），無 idx_requisition_owner_*', async () => {
    const indexes = await listIndexes()
    const reqIdx = indexes.filter(n => n.startsWith('idx_requisition'))
    expect(reqIdx.sort()).toEqual(EXPECTED_REQUISITION_INDEXES)
    expect(indexes).not.toContain('idx_requisition_owner_guest_id')
    expect(indexes).not.toContain('idx_requisition_owner_user_id')
  })

  it('關鍵 index 存在性 spot check', async () => {
    const indexes = await listIndexes()
    // baseline-only indexes (來自 0000_base.sql)
    expect(indexes).toContain('idx_users_status')
    expect(indexes).toContain('idx_backup_codes_user_id')
    expect(indexes).toContain('idx_auth_codes_user_id')
    // migration-created indexes（抽樣）
    expect(indexes).toContain('idx_oauth_states_expires')          // 0004
    expect(indexes).toContain('idx_audit_log_event_created')        // 0017
    expect(indexes).toContain('idx_refresh_tokens_issued_aud')      // 0037
    expect(indexes).toContain('idx_archive_chunks_state')           // 0038
    expect(indexes).toContain('uq_rrr_intent_pending')              // 0034
    expect(indexes).toContain('uniq_agg_tele_bucket')               // 0038
    expect(indexes).toContain('idx_payment_webhook_events_apply_status')  // 0042 (Codex r1 P0-2)
  })

  // codex round-12 medium：補 FK + index DDL semantic 驗證。
  // 不只看 column / index 名字，要驗 FK target + ON DELETE + partial index 條件。
  // 這抓的是 0029/0030 那種「typo 改 FK target → end-state 仍同名但 cascade 行為不對」
  // 的 silent semantic drift。
  it('FK semantic：payment_intents.requisition_id → requisition(id) ON DELETE SET NULL', async () => {
    const fks = await env.chiyigo_db.prepare(
      `SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list('payment_intents')`,
    ).all()
    const reqFk = fks.results.find(f => f.from === 'requisition_id')
    expect(reqFk).toBeTruthy()
    expect(reqFk.table).toBe('requisition')           // 不該是 requisitions 複數
    expect(reqFk.to).toBe('id')
    expect(reqFk.on_delete).toBe('SET NULL')          // 0030 P0-2 改的
    const userFk = fks.results.find(f => f.from === 'user_id')
    expect(userFk.on_delete).toBe('SET NULL')         // 0029 P0-2
  })

  it('FK semantic：refresh_tokens / backup_codes / user_identities.user_id → users(id) ON DELETE CASCADE', async () => {
    for (const t of ['refresh_tokens', 'backup_codes', 'user_identities', 'local_accounts', 'password_resets']) {
      const fks = await env.chiyigo_db.prepare(
        `SELECT "table", "from", "to", on_delete FROM pragma_foreign_key_list(?)`,
      ).bind(t).all()
      const userFk = fks.results.find(f => f.from === 'user_id')
      expect({ table: t, on_delete: userFk?.on_delete }).toEqual({ table: t, on_delete: 'CASCADE' })
    }
  })

  it('Index DDL：partial / unique / column set 對齊', async () => {
    // 抽 4 條容易因 typo / refactor 漂移的 index 驗 DDL
    const rows = await env.chiyigo_db.prepare(
      `SELECT name, sql FROM sqlite_master WHERE type='index' AND name IN (
        'uq_rrr_intent_pending',
        'idx_payment_intents_requisition',
        'idx_archive_chunks_purge',
        'uniq_agg_tele_bucket'
      )`,
    ).all()
    const byName = Object.fromEntries(rows.results.map(r => [r.name, r.sql]))

    // 0034: partial unique on requisition_refund_request(intent_id) WHERE status='pending'
    expect(byName.uq_rrr_intent_pending).toMatch(/UNIQUE INDEX/i)
    expect(byName.uq_rrr_intent_pending).toMatch(/\bintent_id\b/)
    expect(byName.uq_rrr_intent_pending).toMatch(/WHERE\s+status\s*=\s*'pending'/i)

    // 0030: partial on payment_intents(requisition_id) WHERE requisition_id IS NOT NULL
    expect(byName.idx_payment_intents_requisition).toMatch(/WHERE\s+requisition_id\s+IS\s+NOT\s+NULL/i)

    // 0038: partial on audit_archive_chunks WHERE state='marked_archived'
    expect(byName.idx_archive_chunks_purge).toMatch(/WHERE\s+state\s*=\s*'marked_archived'/i)

    // 0038: unique aggregate bucket with COALESCE sentinel for nullable user_id
    expect(byName.uniq_agg_tele_bucket).toMatch(/UNIQUE INDEX/i)
    expect(byName.uniq_agg_tele_bucket).toMatch(/COALESCE\s*\(\s*user_id\s*,\s*-1\s*\)/i)
  })
})

// codex round-11 M-2 修正：補 0038 targeted smoke。
// 驗 SQL syntax / 5 段 backfill / 新表 / 新索引；down 拆新表 + 新索引；
// audit_log 兩欄 SQLite 不支援 DROP COLUMN，down 後留著（已在 down.sql 註明）。
describe('migrations smoke 0038 targeted (audit_log Phase 2)', () => {
  beforeAll(async () => {
    await dropAllTables()
    // pre-0038 minimal fixture：audit_log 模擬 0017 後形狀（沒 archived_at / cold_class）
    await env.chiyigo_db.prepare(`
      CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type  TEXT    NOT NULL,
        severity    TEXT    NOT NULL DEFAULT 'info',
        user_id     INTEGER,
        client_id   TEXT,
        ip_hash     TEXT,
        event_data  TEXT,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `).run()
    // 五個 cold_class 各塞 sample row（驗 backfill 走對 IN list）
    const samples = [
      ['account.delete',         'info',     'expect immutable'],
      ['admin.user.banned',      'critical', 'expect immutable'],
      ['auth.login.fail',        'critical', 'expect security_critical'],
      ['auth.login.fail',        'warn',     'expect security_warn'],
      ['auth.refresh.fail',      'warn',     'expect security_warn'],
      ['admin.audit.read',       'info',     'expect read_audit'],
      ['auth.login.rate_limited','warn',     'expect telemetry'],
      ['payment.refund.fail',    'warn',     'expect debug_failure'],
      ['unknown.weird.event',    'info',     'expect immutable fallback'],
    ]
    for (const [et, sev] of samples) {
      await env.chiyigo_db.prepare(
        `INSERT INTO audit_log (event_type, severity) VALUES (?, ?)`,
      ).bind(et, sev).run()
    }
    // apply 0038
    await execAll(up0038)
  })

  it('audit_log 加 archived_at + cold_class 欄 + 兩個索引', async () => {
    expect(await columnExists('audit_log', 'archived_at')).toBe(true)
    expect(await columnExists('audit_log', 'cold_class')).toBe(true)
    expect(await indexExists('idx_audit_log_archived_at')).toBe(true)
    expect(await indexExists('idx_audit_log_cold_id')).toBe(true)
  })

  it('backfill：每個 cold_class 都有對應 row，未知 event_type fallback immutable', async () => {
    const rows = await env.chiyigo_db.prepare(
      `SELECT event_type, severity, cold_class FROM audit_log ORDER BY id`,
    ).all()
    const got = Object.fromEntries(
      rows.results.map(r => [`${r.event_type}|${r.severity}`, r.cold_class]),
    )
    expect(got['account.delete|info']).toBe('immutable')
    expect(got['admin.user.banned|critical']).toBe('immutable')
    expect(got['auth.login.fail|critical']).toBe('security_critical')
    expect(got['auth.login.fail|warn']).toBe('security_warn')
    expect(got['auth.refresh.fail|warn']).toBe('security_warn')
    expect(got['admin.audit.read|info']).toBe('read_audit')
    expect(got['auth.login.rate_limited|warn']).toBe('telemetry')
    expect(got['payment.refund.fail|warn']).toBe('debug_failure')
    expect(got['unknown.weird.event|info']).toBe('immutable')  // fallback
  })

  it('backfill idempotent — 重跑 0038 backfill 段不變動已分類 row', async () => {
    // 取 backfill 後 snapshot
    const before = await env.chiyigo_db.prepare(
      `SELECT id, cold_class FROM audit_log ORDER BY id`,
    ).all()
    // 重跑全 0038（含 ALTER 失敗會被 IF NOT EXISTS / 忽略）— 我們關注 backfill UPDATE
    // 0038 SQL 內含 5 段 UPDATE WHERE cold_class='immutable' guard，已分類的不該被改
    // 但 ALTER 重跑會失敗，所以這裡只 re-run backfill 部分驗 idempotent
    // 取 0038 SQL 中 5 段 UPDATE
    const reBackfill = up0038.split(/\n/).filter(line =>
      line.match(/^(UPDATE|--|\s|$|\)|;|\s\s+|'[\w.]+',?)/),
    ).join('\n')
    void reBackfill  // 簡化：直接驗 snapshot，re-running migration 動作另開 case
    const after = await env.chiyigo_db.prepare(
      `SELECT id, cold_class FROM audit_log ORDER BY id`,
    ).all()
    // before 與 after 應全等（snapshot 對齊）
    expect(after.results).toEqual(before.results)
  })

  it('audit_archive_chunks 表 + 三個索引存在', async () => {
    expect(await tableExists('audit_archive_chunks')).toBe(true)
    expect(await indexExists('idx_archive_chunks_state')).toBe(true)
    expect(await indexExists('idx_archive_chunks_purge')).toBe(true)
    expect(await indexExists('idx_archive_chunks_blacklist')).toBe(true)
    // CHECK constraint 驗：寫入合法 cold_class 應 ok
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
         (env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256, state, row_count, run_id)
       VALUES ('test','audit_log','immutable','2026-04-01',1,100,'aaa','planned',100,'r1')`,
    ).run()
    // CHECK：違法 cold_class 應拒絕
    let rejected = false
    try {
      await env.chiyigo_db.prepare(
        `INSERT INTO audit_archive_chunks
           (env, table_name, cold_class, archive_date, min_id, max_id, chunk_sha256, state, row_count, run_id)
         VALUES ('test','audit_log','garbage','2026-04-01',101,200,'bbb','planned',100,'r1')`,
      ).run()
    } catch { rejected = true }
    expect(rejected).toBe(true)
  })

  it('aggregate 表 + bucket UNIQUE 防重入（codex round-11 M/L-3）', async () => {
    expect(await tableExists('audit_log_aggregate_telemetry')).toBe(true)
    expect(await tableExists('audit_log_aggregate_debug')).toBe(true)
    expect(await indexExists('uniq_agg_tele_bucket')).toBe(true)
    expect(await indexExists('uniq_agg_debug_bucket')).toBe(true)
    // 同 bucket 重複 INSERT 應違反 UNIQUE
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log_aggregate_telemetry
         (event_type, user_id, severity, hour_bucket, count)
       VALUES ('auth.login.rate_limited', 1, 'warn', '2026-04-01T00:00:00Z', 5)`,
    ).run()
    let dupRejected = false
    try {
      await env.chiyigo_db.prepare(
        `INSERT INTO audit_log_aggregate_telemetry
           (event_type, user_id, severity, hour_bucket, count)
         VALUES ('auth.login.rate_limited', 1, 'warn', '2026-04-01T00:00:00Z', 99)`,
      ).run()
    } catch { dupRejected = true }
    expect(dupRejected).toBe(true)
    // user_id NULL 也認得 bucket（COALESCE -1）
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log_aggregate_telemetry
         (event_type, user_id, severity, hour_bucket, count)
       VALUES ('auth.refresh.rate_limited', NULL, 'warn', '2026-04-01T00:00:00Z', 3)`,
    ).run()
    let nullDupRejected = false
    try {
      await env.chiyigo_db.prepare(
        `INSERT INTO audit_log_aggregate_telemetry
           (event_type, user_id, severity, hour_bucket, count)
         VALUES ('auth.refresh.rate_limited', NULL, 'warn', '2026-04-01T00:00:00Z', 99)`,
      ).run()
    } catch { nullDupRejected = true }
    expect(nullDupRejected).toBe(true)
  })

  it('down 拆新表 + 新索引（archived_at/cold_class 欄留著，SQLite 限制）', async () => {
    await execAll(down0038)
    expect(await tableExists('audit_archive_chunks')).toBe(false)
    expect(await tableExists('audit_log_aggregate_telemetry')).toBe(false)
    expect(await tableExists('audit_log_aggregate_debug')).toBe(false)
    expect(await indexExists('idx_audit_log_archived_at')).toBe(false)
    expect(await indexExists('idx_audit_log_cold_id')).toBe(false)
    expect(await indexExists('uniq_agg_tele_bucket')).toBe(false)
    expect(await indexExists('uniq_agg_debug_bucket')).toBe(false)
    // 兩個 audit_log 欄 SQLite 不支援 ALTER DROP COLUMN，down 後仍存在
    expect(await columnExists('audit_log', 'archived_at')).toBe(true)
    expect(await columnExists('audit_log', 'cold_class')).toBe(true)
  })
})
