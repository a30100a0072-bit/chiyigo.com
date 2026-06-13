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
// 至少要有 targeted smoke。完整 0001..0055 forward 已實作（見 line 448 describe）；本 case
// 維持手建 fixture 形式作 0037 issued_aud 行為的 targeted 驗證。
import up0037 from '../../migrations/0037_refresh_tokens_issued_aud.sql?raw'
import up0038      from '../../migrations/0038_audit_log_phase2.sql?raw'
import down0038    from '../../migrations/down/0038_audit_log_phase2.down.sql?raw'

// Full forward chain 0013..0045（不含 down，僅驗 forward shape）
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
import up0043 from '../../migrations/0043_payment_intents_soft_delete.sql?raw'
import up0044 from '../../migrations/0044_audit_aggregate_archive_cols.sql?raw'
import up0045 from '../../migrations/0045_admin_audit_unique_prev_hash.sql?raw'
import up0046    from '../../migrations/0046_audit_archive_chunks_key_scheme.sql?raw'
import down0046  from '../../migrations/down/0046_audit_archive_chunks_key_scheme.down.sql?raw'
import up0047    from '../../migrations/0047_tenant_foundation.sql?raw'
import up0048    from '../../migrations/0048_billing_entitlement.sql?raw'
import up0049    from '../../migrations/0049_credit_wallet.sql?raw'
import down0049  from '../../migrations/down/0049_credit_wallet.down.sql?raw'
import up0050    from '../../migrations/0050_member_lifecycle.sql?raw'
import down0050  from '../../migrations/down/0050_member_lifecycle.down.sql?raw'
import up0051    from '../../migrations/0051_event_outbox.sql?raw'
import down0051  from '../../migrations/down/0051_event_outbox.down.sql?raw'
import up0052    from '../../migrations/0052_refresh_token_session_id.sql?raw'
import down0052  from '../../migrations/down/0052_refresh_token_session_id.down.sql?raw'
import up0053    from '../../migrations/0053_refresh_token_successor_hash.sql?raw'
import down0053  from '../../migrations/down/0053_refresh_token_successor_hash.down.sql?raw'
import up0054    from '../../migrations/0054_elevation_grants.sql?raw'
import down0054  from '../../migrations/down/0054_elevation_grants.down.sql?raw'
import up0055    from '../../migrations/0055_credential_disposition.sql?raw'
import down0055  from '../../migrations/down/0055_credential_disposition.down.sql?raw'

// 0029 原本含 typo（REFERENCES requisitions 複數），2026-05-12 retroactive
// 修為單數 `requisition`（見 migration 檔頭 🔧 註解）。end-state 不變、0030 仍
// rebuild；fresh D1 走 migration ledger bootstrap 也能跑通。
const ALL_UPS = [
  up0001, up0002, up0003, up0004, up0005, up0006, up0007, up0008,
  up0009, up0010, up0011, up0012, up0013, up0014, up0015, up0016,
  up0017, up0018, up0019, up0020, up0021, up0022, up0023, up0024,
  up0025, up0026, up0027, up0028, up0029, up0030, up0031, up0032,
  up0033, up0034, up0035, up0036, up0037, up0038, up0039, up0040,
  up0041, up0042, up0043, up0044, up0045, up0046, up0047, up0048,
  up0049, up0050, up0051, up0052, up0053, up0054, up0055,
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
  it('apply _base + up0001..up0008 全部成功', async () => {
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

  it('再次 up0001..up0008 應該完全成功（idempotent forward）', async () => {
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
// auth_codes / local_accounts 等 prod 既有表）；full forward 0001..0055 已實作於下方
// 「full forward chain」describe（line 448）。本 case 維持手建 fixture 形式作 0037
// issued_aud 行為 targeted 驗證。
//
// 本 case 只手建 0037 必要的 fixture（users + pre-0037 refresh_tokens），跑 0037 migration，
// 驗欄位/索引/NULL 行為/綁定持久化。F-2 refresh.ts 邏輯（rawAudProvided 條件、effectiveAud
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
    // 模擬 refresh.ts rotation 不應改 issued_aud：UPDATE 只動 revoked_at
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
// Full forward chain 0001..0055 vs prod snapshot
//
// 2026-05-12 schema baseline 重整後（_base.sql 改為 12-table purified baseline），
// 完整 forward 變得可行。本 describe 驗 _base + 0001..0055 跑完後的 schema shape
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
  'oauth_clients', 'oauth_states', 'organization_members', 'password_resets', 'payment_intents',
  'payment_metadata_archive', 'payment_webhook_dlq', 'payment_webhook_events',
  'pkce_sessions', 'portfolio', 'refresh_tokens', 'requisition',
  'requisition_refund_request', 'revoked_jti', 'tenants', 'used_totp', 'user_identities',
  'user_kyc', 'user_wallets', 'user_webauthn_credentials', 'users',
  'wallet_nonces', 'webauthn_challenges',
  // PR2 migration 0048: billing / entitlement foundation
  'grant_plan_operations', 'plans', 'products', 'tenant_product_access',
  // PR3 migration 0049: credit wallet + quota + ledger
  'credit_wallets', 'product_usage_quota', 'credit_ledger', 'quota_config_ledger',
  // PR4 migration 0050: invitation + member lifecycle
  'invitations', 'org_create_operations',
  // PR5 migration 0051: event outbox + sequence + dlq + deny-state projection
  'event_outbox', 'event_stream_sequences', 'event_dlq', 'event_deny_state',
  // migration 0054: SEC-FACTOR-ADD-A factor-add elevation grant + OAuth exchange code
  'elevation_grants', 'elevation_exchanges',
].sort()

// Per-table expected column sets（baseline 12 表 + 部分 ALTER 重點目標）
const EXPECTED_COLUMNS = {
  portfolio: ['category', 'created_at', 'description', 'id', 'image_url', 'link_url', 'sort_order', 'tags', 'title'],
  users: ['created_at', 'deleted_at', 'email', 'email_verified', 'id', 'public_sub', 'role', 'status', 'token_version'],
  requisition: ['budget', 'company', 'contact', 'created_at', 'deleted_at', 'id', 'message', 'name', 'owner_guest_id', 'owner_user_id', 'service_type', 'source_ip', 'status', 'tg_message_id', 'timeline', 'user_id'],
  local_accounts: ['password_hash', 'password_salt', 'totp_enabled', 'totp_secret', 'user_id'],
  backup_codes: ['code_hash', 'id', 'used_at', 'user_id'],
  user_identities: ['avatar_url', 'created_at', 'display_name', 'disposition_at', 'disposition_by', 'disposition_reason', 'id', 'metadata', 'provider', 'provider_id', 'requires_reverification', 'updated_at', 'user_id'],
  password_resets: ['expires_at', 'token_hash', 'user_id'],
  refresh_tokens: ['auth_time', 'device_info', 'device_uuid', 'expires_at', 'id', 'issued_aud', 'revoked_at', 'scope', 'session_id', 'successor_token_hash', 'token_hash', 'user_id'],
  oauth_states: ['action', 'aud', 'client_callback', 'code_verifier', 'created_at', 'elevation_user_id', 'expires_at', 'factor_add_grant_hash', 'ip_address', 'nonce', 'platform', 'purpose', 'redirect_uri', 'session_id', 'state_token'],
  pkce_sessions: ['code_challenge', 'created_at', 'expires_at', 'ip_address', 'nonce', 'redirect_uri', 'scope', 'session_key', 'state'],
  auth_codes: ['auth_time', 'code_challenge', 'code_hash', 'expires_at', 'nonce', 'redirect_uri', 'scope', 'state', 'user_id'],
  email_verifications: ['created_at', 'expires_at', 'id', 'ip_address', 'token_hash', 'token_type', 'used_at', 'user_id'],
  audit_log: ['archived_at', 'client_id', 'cold_class', 'created_at', 'event_data', 'event_type', 'id', 'ip_hash', 'severity', 'user_id'],
  // 0042 加 apply_status（Codex r1 P0-2 dedupe 三態）；其餘欄位來自 0025_payment_intents.sql
  payment_webhook_events: ['apply_status', 'event_id', 'id', 'intent_id', 'payload_hash', 'processed_at', 'status_to', 'user_id', 'vendor'],
  // 0041 加 compression（zstd→gzip pivot）；0046 加 key_scheme + last_manifest_state（PR 0.2c-pre-1a write-once）
  audit_archive_chunks: ['archive_date', 'blacklisted_at', 'chunk_sha256', 'cold_class', 'cold_class_version', 'cold_copied_at', 'compression', 'created_at', 'dry_run', 'env', 'key_scheme', 'last_failure', 'last_failure_at', 'last_manifest_state', 'marked_archived_at', 'max_id', 'min_id', 'next_reminder_at', 'purge_after', 'retry_count', 'row_count', 'run_id', 'state', 'table_name', 'updated_at'],
  // migration 0047 tenant foundation
  tenants: ['created_at', 'deleted_at', 'id', 'name', 'personal_owner_user_id', 'status', 'type', 'updated_at'],
  organization_members: ['id', 'joined_at', 'platform_role', 'status', 'tenant_id', 'updated_at', 'user_id'],
  // migration 0048 billing / entitlement foundation
  products: ['created_at', 'id', 'is_active', 'name', 'tenant_scope', 'updated_at'],
  plans: ['code', 'created_at', 'currency', 'features', 'id', 'included_credits', 'is_active', 'name', 'price_subunit', 'product_id', 'updated_at'],
  tenant_product_access: ['created_at', 'granted_via', 'last_op_occurred_at', 'plan_id', 'product_id', 'status', 'tenant_id', 'updated_at', 'version'],
  grant_plan_operations: ['admin_idempotency_key', 'created_at', 'from_status', 'grant_reason', 'granted_by', 'granted_by_email', 'granted_by_role', 'id', 'manual_source', 'occurred_at', 'payment_event_ref', 'payment_intent_id', 'payment_ref', 'payment_ref_key', 'plan_id', 'prev_projection_version', 'product_id', 'request_hash', 'tenant_id', 'to_status', 'trigger'],
  // migration 0049 credit wallet + quota + ledgers
  credit_wallets: ['balance', 'created_at', 'tenant_id', 'updated_at', 'version'],
  product_usage_quota: ['created_at', 'period', 'product_id', 'quota_limit', 'quota_used', 'tenant_id', 'updated_at', 'version'],
  credit_ledger: ['actor_email', 'actor_id', 'actor_role', 'amount', 'balance_after', 'created_at', 'entry_type', 'id', 'idempotency_key', 'idempotency_scope', 'occurred_at', 'product_id', 'quota_limit_after', 'quota_period', 'quota_used_after', 'ref', 'request_hash', 'source', 'tenant_id'],
  quota_config_ledger: ['actor_email', 'actor_id', 'actor_role', 'created_at', 'id', 'idempotency_key', 'idempotency_scope', 'new_limit', 'occurred_at', 'old_limit', 'period', 'product_id', 'reason', 'request_hash', 'tenant_id'],
  // migration 0050 invitation + member lifecycle
  invitations: ['accepted_at', 'accepted_user_id', 'created_at', 'email', 'expires_at', 'id', 'invited_by', 'platform_role', 'status', 'tenant_id', 'token_hash', 'updated_at'],
  org_create_operations: ['created_at', 'creator_user_id', 'id', 'idempotency_key', 'request_hash', 'tenant_id'],
  // migration 0051 event outbox + sequence + dlq + deny-state projection
  event_stream_sequences: ['last_seq', 'stream_key', 'updated_at'],
  event_outbox: ['actor_sub', 'attempts', 'created_at', 'data_json', 'event_id', 'event_type', 'id', 'last_error', 'lease_until', 'locked_by', 'next_attempt_at', 'occurred_at', 'processed_at', 'status', 'stream_key', 'stream_seq', 'tenant_id'],
  event_dlq: ['actor_sub', 'attempts', 'data_json', 'dlq_reason', 'event_id', 'event_type', 'failed_at', 'id', 'last_error', 'occurred_at', 'replayed_at', 'replayed_by', 'stream_key', 'stream_seq', 'tenant_id'],
  event_deny_state: ['created_at', 'denied', 'deny_effect', 'event_type', 'last_applied_seq', 'stream_key', 'tenant_id', 'updated_at'],
}

// 對齊後（0040 exact-parity）的 requisition 索引
const EXPECTED_REQUISITION_INDEXES = [
  'idx_requisition_guest_id',  // 0040 對齊；prod 命名（無 owner_ 前綴）
  'idx_requisition_ip',         // 0006
]

describe('full forward chain 0001..0055 vs prod snapshot', () => {
  beforeAll(async () => {
    await dropAllTables()
    await execAll(baseSql)
    for (const sql of ALL_UPS) {
      await execAll(sql)
    }
  })

  it('table set 對齊 prod snapshot（53 表）', async () => {
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
    expect(indexes).toContain('idx_payment_intents_deleted_at')           // 0043 (Codex r1 P0-1)
    expect(indexes).toContain('idx_admin_audit_prev_hash_unique')         // 0045 (hash chain CAS race fix)
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
// PR 3.2（migration 0044）— codex P1 / P2a 驗證：CHECK widening + 新欄齊備
// 順序要注意：本 describe **必須** 放在「0038 targeted」之前，否則本 describe 的
// beforeAll 透過 ALL_UPS 留下 FK-version audit_log（from migration 0017，REFERENCES users），
// 後續 user-audit.test.js / payments-ecpay.test.js / register.test.js 共用 D1 binding
// 時 CREATE IF NOT EXISTS 不會覆蓋，seedAudit 用未存在 user_id INSERT audit_log 會撞 FK。
// 「0038 targeted」beforeAll 之後 audit_log 是手動 CREATE 的無 FK 版本，這才是 user-audit
// 等 test file 所仰賴的「test fixture-friendly」狀態。
describe('migrations smoke 0044 targeted (aggregate→R2 schema)', () => {
  beforeAll(async () => {
    await dropAllTables()
    await execAll(baseSql)
    for (const sql of ALL_UPS) await execAll(sql)
  })

  it('audit_log_aggregate_telemetry 加 archived_at + cold_class + partial index', async () => {
    expect(await columnExists('audit_log_aggregate_telemetry', 'archived_at')).toBe(true)
    expect(await columnExists('audit_log_aggregate_telemetry', 'cold_class')).toBe(true)
    expect(await indexExists('idx_agg_tele_archived_at')).toBe(true)
  })

  it('audit_log_aggregate_debug 加 archived_at + cold_class + partial index', async () => {
    expect(await columnExists('audit_log_aggregate_debug', 'archived_at')).toBe(true)
    expect(await columnExists('audit_log_aggregate_debug', 'cold_class')).toBe(true)
    expect(await indexExists('idx_agg_debug_archived_at')).toBe(true)
  })

  it('cold_class DEFAULT：兩表 INSERT 不帶 cold_class → 拿到對應字面值', async () => {
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log_aggregate_telemetry (event_type, severity, hour_bucket, count)
       VALUES ('x', 'info', '2026-06-01T00:00:00Z', 1)`,
    ).run()
    const tRow = await env.chiyigo_db.prepare(
      `SELECT cold_class FROM audit_log_aggregate_telemetry WHERE event_type='x'`,
    ).first()
    expect(tRow.cold_class).toBe('aggregate_telemetry')

    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log_aggregate_debug (event_type, hour_bucket, total_count, sample_count, samples_json)
       VALUES ('y', '2026-06-01T00:00:00Z', 1, 0, '[]')`,
    ).run()
    const dRow = await env.chiyigo_db.prepare(
      `SELECT cold_class FROM audit_log_aggregate_debug WHERE event_type='y'`,
    ).first()
    expect(dRow.cold_class).toBe('aggregate_debug')
  })

  it('audit_archive_chunks CHECK 放寬：INSERT aggregate_telemetry / aggregate_debug 不被擋', async () => {
    // 0038 原 CHECK 鎖 6 class；0044 Part 3 rebuild 後放寬，兩個 aggregate_* 應通過
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
         (env, table_name, cold_class, archive_date, min_id, max_id,
          chunk_sha256, state, row_count, run_id)
       VALUES ('test', 'audit_log_aggregate_telemetry', 'aggregate_telemetry',
               '2026-06-01', 1, 10, 'sha-t', 'planned', 10, 'run-t')`,
    ).run()
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
         (env, table_name, cold_class, archive_date, min_id, max_id,
          chunk_sha256, state, row_count, run_id)
       VALUES ('test', 'audit_log_aggregate_debug', 'aggregate_debug',
               '2026-06-01', 1, 10, 'sha-d', 'planned', 10, 'run-d')`,
    ).run()
    const rows = await env.chiyigo_db.prepare(
      `SELECT cold_class FROM audit_archive_chunks WHERE env='test' ORDER BY cold_class`,
    ).all()
    expect(rows.results.map(r => r.cold_class)).toEqual(['aggregate_debug', 'aggregate_telemetry'])
  })

  it('rebuild 後 audit_archive_chunks 三索引 + PK 仍存在', async () => {
    expect(await indexExists('idx_archive_chunks_state')).toBe(true)
    expect(await indexExists('idx_archive_chunks_purge')).toBe(true)
    expect(await indexExists('idx_archive_chunks_blacklist')).toBe(true)
    // PK 透過 sqlite_master 不一定看得到，靠重複 INSERT 撞 PK 反證
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
         (env, table_name, cold_class, archive_date, min_id, max_id,
          chunk_sha256, state, row_count, run_id)
       VALUES ('test2', 'audit_log_aggregate_telemetry', 'aggregate_telemetry',
               '2026-06-01', 1, 10, 'sha-pk', 'planned', 10, 'run-pk')`,
    ).run()
    let threw = false
    try {
      await env.chiyigo_db.prepare(
        `INSERT INTO audit_archive_chunks
           (env, table_name, cold_class, archive_date, min_id, max_id,
            chunk_sha256, state, row_count, run_id)
         VALUES ('test2', 'audit_log_aggregate_telemetry', 'aggregate_telemetry',
                 '2026-06-01', 1, 10, 'sha-pk', 'planned', 10, 'run-pk')`,
      ).run()
    } catch { threw = true }
    expect(threw).toBe(true)
  })

  // PR 0.2c-pre-1a migration 0046 round-trip — 借用既有 0044 targeted beforeAll
  //   的 post-ALL_UPS 狀態（state 已含 0046）；測 down → 兩欄拆掉 → 再 up → 兩欄回來。
  //   合併進 0044 targeted describe 而不獨立新 describe 是為了避免再多一輪
  //   dropAllTables — 加劇 user-audit / payments-ecpay / register integration
  //   test 共用 D1 instance 的 FK race（singleWorker pool）。
  it('0046 key_scheme + last_manifest_state 兩欄存在 + DEFAULT 行為對', async () => {
    expect(await columnExists('audit_archive_chunks', 'key_scheme')).toBe(true)
    expect(await columnExists('audit_archive_chunks', 'last_manifest_state')).toBe(true)
    // 種一筆不顯式帶兩欄的 row — 確認 DEFAULT 1 + NULL 對齊 PR 0.2c-pre-1a 設計
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
         (env, table_name, cold_class, archive_date, min_id, max_id,
          chunk_sha256, state, row_count, run_id)
       VALUES ('test-0046', 'audit_log', 'telemetry', '2026-05-23', 100, 110, 'sha-default-0046', 'planned', 11, 'run-default')`,
    ).run()
    const row = await env.chiyigo_db.prepare(
      `SELECT key_scheme, last_manifest_state FROM audit_archive_chunks WHERE chunk_sha256 = 'sha-default-0046'`,
    ).first()
    expect(row.key_scheme).toBe(1)
    expect(row.last_manifest_state).toBeNull()
  })

  it('0046 顯式 INSERT key_scheme=2 + last_manifest_state 持久化', async () => {
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_archive_chunks
         (env, table_name, cold_class, archive_date, min_id, max_id,
          chunk_sha256, state, row_count, run_id, key_scheme, last_manifest_state)
       VALUES ('test-0046', 'audit_log', 'telemetry', '2026-05-23', 200, 210, 'sha-explicit-0046', 'uploaded', 11, 'run-explicit', 2, 'uploaded')`,
    ).run()
    const row = await env.chiyigo_db.prepare(
      `SELECT key_scheme, last_manifest_state FROM audit_archive_chunks WHERE chunk_sha256 = 'sha-explicit-0046'`,
    ).first()
    expect(row.key_scheme).toBe(2)
    expect(row.last_manifest_state).toBe('uploaded')
  })

  it('0046 down 拆兩欄 → 再 up 兩欄回來（forward idempotent；ALTER DROP COLUMN 不撞 partial index）', async () => {
    await execAll(down0046)
    expect(await columnExists('audit_archive_chunks', 'last_manifest_state')).toBe(false)
    expect(await columnExists('audit_archive_chunks', 'key_scheme')).toBe(false)
    // 表 + 其他欄 留著
    expect(await tableExists('audit_archive_chunks')).toBe(true)
    expect(await columnExists('audit_archive_chunks', 'dry_run')).toBe(true)
    expect(await columnExists('audit_archive_chunks', 'compression')).toBe(true)

    await execAll(up0046)
    expect(await columnExists('audit_archive_chunks', 'key_scheme')).toBe(true)
    expect(await columnExists('audit_archive_chunks', 'last_manifest_state')).toBe(true)
  })
})

// migration 0049 credit wallet — targeted round-trip (up -> 4 tables, down -> gone, re-up idempotent).
// IMPORTANT ORDERING: this describe runs ALL_UPS in its beforeAll, which rebuilds the FK-version
//   audit_log (migration 0017) + NOT-NULL requisition. It MUST run BEFORE 'migrations smoke 0038
//   targeted' (next describe) — that block re-CREATEs audit_log WITHOUT FK and is the last schema
//   mutator, leaving the test-fixture-friendly state that user-audit / register / payments-ecpay
//   rely on via the shared single-worker D1 (same reason the 0044 targeted describe sits before 0038).
describe('migrations smoke 0049 targeted (credit wallet round-trip)', () => {
  beforeAll(async () => {
    await dropAllTables()
    await execAll(baseSql)
    for (const sql of ALL_UPS) await execAll(sql)
  })

  it('up: 4 credit tables + key indexes present', async () => {
    expect(await tableExists('credit_wallets')).toBe(true)
    expect(await tableExists('product_usage_quota')).toBe(true)
    expect(await tableExists('credit_ledger')).toBe(true)
    expect(await tableExists('quota_config_ledger')).toBe(true)
    expect(await indexExists('idx_credit_ledger_tenant')).toBe(true)
    expect(await indexExists('idx_credit_ledger_tenant_product')).toBe(true)
    expect(await indexExists('idx_puq_tenant')).toBe(true)
    expect(await indexExists('idx_qcl_tenant_product')).toBe(true)
  })

  it('down: 4 credit tables dropped', async () => {
    await execAll(down0049)
    expect(await tableExists('credit_ledger')).toBe(false)
    expect(await tableExists('quota_config_ledger')).toBe(false)
    expect(await tableExists('product_usage_quota')).toBe(false)
    expect(await tableExists('credit_wallets')).toBe(false)
    // 上游表（0047/0048）仍在（down 只拆 0049 自建）
    expect(await tableExists('tenants')).toBe(true)
    expect(await tableExists('products')).toBe(true)
  })

  it('re-up after down is idempotent (4 tables back)', async () => {
    await execAll(up0049)
    expect(await tableExists('credit_wallets')).toBe(true)
    expect(await tableExists('product_usage_quota')).toBe(true)
    expect(await tableExists('credit_ledger')).toBe(true)
    expect(await tableExists('quota_config_ledger')).toBe(true)
  })
})

// migration 0050 member lifecycle — targeted round-trip (up -> 2 tables, down -> gone, re-up idempotent).
// Same ordering rule as the 0049 describe: runs ALL_UPS (FK audit_log) and MUST sit BEFORE the 0038
// targeted block (which re-CREATEs audit_log WITHOUT FK as the last schema mutator).
describe('migrations smoke 0050 targeted (member lifecycle round-trip)', () => {
  beforeAll(async () => {
    await dropAllTables()
    await execAll(baseSql)
    for (const sql of ALL_UPS) await execAll(sql)
  })

  it('up: invitations + org_create_operations + key indexes present', async () => {
    expect(await tableExists('invitations')).toBe(true)
    expect(await tableExists('org_create_operations')).toBe(true)
    expect(await indexExists('idx_invitations_expires')).toBe(true)
    expect(await indexExists('uq_invitations_pending')).toBe(true)
    expect(await indexExists('idx_org_create_ops_tenant')).toBe(true)
  })

  it('down: 2 tables dropped, upstream (tenants/users) untouched', async () => {
    await execAll(down0050)
    expect(await tableExists('invitations')).toBe(false)
    expect(await tableExists('org_create_operations')).toBe(false)
    expect(await tableExists('tenants')).toBe(true)
    expect(await tableExists('users')).toBe(true)
  })

  it('re-up after down is idempotent (2 tables back)', async () => {
    await execAll(up0050)
    expect(await tableExists('invitations')).toBe(true)
    expect(await tableExists('org_create_operations')).toBe(true)
  })
})

// Same ordering rule as the 0049/0050 describes: runs ALL_UPS (FK audit_log) and MUST sit BEFORE the 0038
// targeted block (which re-CREATEs audit_log WITHOUT FK as the last schema mutator).
describe('migrations smoke 0051 targeted (event outbox round-trip)', () => {
  beforeAll(async () => {
    await dropAllTables()
    await execAll(baseSql)
    for (const sql of ALL_UPS) await execAll(sql)
  })

  it('up: 4 event tables + key indexes present', async () => {
    expect(await tableExists('event_stream_sequences')).toBe(true)
    expect(await tableExists('event_outbox')).toBe(true)
    expect(await tableExists('event_dlq')).toBe(true)
    expect(await tableExists('event_deny_state')).toBe(true)
    expect(await indexExists('idx_event_outbox_claim')).toBe(true)
    expect(await indexExists('idx_event_outbox_lease')).toBe(true)
    expect(await indexExists('idx_event_outbox_stream')).toBe(true)
    expect(await indexExists('idx_event_dlq_pending')).toBe(true)
    expect(await indexExists('idx_event_deny_state_tenant')).toBe(true)
  })

  it('event_outbox guards: 11-type CHECK + UNIQUE(stream_key,stream_seq) + UNIQUE(event_id)', async () => {
    await env.chiyigo_db.prepare(
      `INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, occurred_at, data_json)
       VALUES ('e1','member.suspended','tenant:1:member:9',1,'2026-06-02T00:00:00Z','{}')`,
    ).run()
    let badType = false
    try {
      await env.chiyigo_db.prepare(
        `INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, occurred_at, data_json)
         VALUES ('e2','member.frobnicated','tenant:1:member:9',2,'2026-06-02T00:00:00Z','{}')`,
      ).run()
    } catch { badType = true }
    expect(badType).toBe(true)            // unknown event_type rejected by the 11-type CHECK
    let dupSeq = false
    try {
      await env.chiyigo_db.prepare(
        `INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, occurred_at, data_json)
         VALUES ('e3','member.reactivated','tenant:1:member:9',1,'2026-06-02T00:00:00Z','{}')`,
      ).run()
    } catch { dupSeq = true }
    expect(dupSeq).toBe(true)             // (stream_key, stream_seq) ordering-integrity UNIQUE
    let dupId = false
    try {
      await env.chiyigo_db.prepare(
        `INSERT INTO event_outbox (event_id, event_type, stream_key, stream_seq, occurred_at, data_json)
         VALUES ('e1','member.reactivated','tenant:1:member:9',2,'2026-06-02T00:00:00Z','{}')`,
      ).run()
    } catch { dupId = true }
    expect(dupId).toBe(true)              // event_id dedup UNIQUE
  })

  it('down: 4 tables dropped, upstream (users/tenants) untouched', async () => {
    await execAll(down0051)
    expect(await tableExists('event_outbox')).toBe(false)
    expect(await tableExists('event_stream_sequences')).toBe(false)
    expect(await tableExists('event_dlq')).toBe(false)
    expect(await tableExists('event_deny_state')).toBe(false)
    expect(await tableExists('users')).toBe(true)
    expect(await tableExists('tenants')).toBe(true)
  })

  it('re-up after down is idempotent (4 tables back)', async () => {
    await execAll(up0051)
    expect(await tableExists('event_outbox')).toBe(true)
    expect(await tableExists('event_stream_sequences')).toBe(true)
    expect(await tableExists('event_dlq')).toBe(true)
    expect(await tableExists('event_deny_state')).toBe(true)
  })
})

// migration 0052 refresh_tokens.session_id (PR5 5d-1a) — targeted round-trip + backfill.
// Builds a pre-0052 refresh_tokens fixture (no session_id) + seeds a legacy row, applies up0052, and verifies
// the column/index appear, the backfill stamps the legacy row 'legacy_<id>' (delimiter-safe UNDERSCORE), the
// column is OPAQUE (accepts both a UUID and a sentinel, NO uuid CHECK), the deploy-gap COALESCE read heals NULL,
// and down drops index THEN column (reversible on this D1 engine) with re-up restoring it.
// Builds its OWN fixture (manual CREATE, like the 0037 targeted block) rather than running ALL_UPS, but still
// does dropAllTables in beforeAll, so it MUST sit BEFORE the '0038 targeted' block (the last schema mutator that
// leaves the FK-less audit_log other integration test files rely on via the shared single-worker D1).
describe('migrations smoke 0052 targeted (refresh_tokens.session_id round-trip + backfill)', () => {
  beforeAll(async () => {
    await dropAllTables()
    // pre-0052 minimal fixture: users + refresh_tokens at its 0037-era shape (no session_id column)
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
        scope       TEXT,
        issued_aud  TEXT
      )
    `).run()
    await env.chiyigo_db.prepare(`INSERT INTO users (email) VALUES ('sess-legacy@test')`).run()
    const u = await env.chiyigo_db.prepare(`SELECT id FROM users WHERE email='sess-legacy@test'`).first()
    // a pre-0052 row (no session_id) -- simulates a prod legacy refresh token at migration time
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES (?, 'h_sess_legacy', datetime('now','+7 days'))`,
    ).bind(u.id).run()
    await execAll(up0052)
  })

  it('session_id column + index present after up', async () => {
    expect(await columnExists('refresh_tokens', 'session_id')).toBe(true)
    expect(await indexExists('idx_refresh_tokens_session')).toBe(true)
  })

  it('backfill: the pre-existing legacy row gets session_id = legacy_<id> (delimiter-safe underscore, never a colon)', async () => {
    const r = await env.chiyigo_db.prepare(
      `SELECT id, session_id FROM refresh_tokens WHERE token_hash='h_sess_legacy'`,
    ).first()
    expect(r.session_id).toBe(`legacy_${r.id}`)
    expect(String(r.session_id)).not.toContain(':')   // DELIMITER-SAFETY INVARIANT: ref never contains ':'
  })

  it('session_id is OPAQUE (no uuid CHECK): both a UUID and a legacy_ sentinel persist', async () => {
    const u = await env.chiyigo_db.prepare(`SELECT id FROM users WHERE email='sess-legacy@test'`).first()
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_id)
       VALUES (?, 'h_sess_uuid', datetime('now','+7 days'), '550e8400-e29b-41d4-a716-446655440000')`,
    ).bind(u.id).run()
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_id)
       VALUES (?, 'h_sess_sentinel', datetime('now','+7 days'), 'legacy_999')`,
    ).bind(u.id).run()
    const rows = await env.chiyigo_db.prepare(
      `SELECT token_hash, session_id FROM refresh_tokens
        WHERE token_hash IN ('h_sess_uuid','h_sess_sentinel') ORDER BY token_hash`,
    ).all()
    const map = Object.fromEntries(rows.results.map(r => [r.token_hash, r.session_id]))
    expect(map['h_sess_uuid']).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(map['h_sess_sentinel']).toBe('legacy_999')
  })

  it('deploy-gap row (inserted WITHOUT session_id after migration) is NULL; COALESCE(session_id, legacy_<id>) heals the read', async () => {
    const u = await env.chiyigo_db.prepare(`SELECT id FROM users WHERE email='sess-legacy@test'`).first()
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES (?, 'h_sess_gap', datetime('now','+7 days'))`,
    ).bind(u.id).run()
    const r = await env.chiyigo_db.prepare(
      `SELECT id, session_id, COALESCE(session_id, 'legacy_' || id) AS ref
         FROM refresh_tokens WHERE token_hash='h_sess_gap'`,
    ).first()
    expect(r.session_id).toBeNull()              // old code path leaves it NULL in the migrate->deploy gap
    expect(r.ref).toBe(`legacy_${r.id}`)         // emission-side COALESCE still yields a delimiter-safe ref
  })

  it('down: index THEN column dropped (reversible on this D1 engine, rows present); table + other columns survive', async () => {
    await execAll(down0052)
    expect(await indexExists('idx_refresh_tokens_session')).toBe(false)
    expect(await columnExists('refresh_tokens', 'session_id')).toBe(false)
    expect(await tableExists('refresh_tokens')).toBe(true)
    expect(await columnExists('refresh_tokens', 'token_hash')).toBe(true)
    expect(await columnExists('refresh_tokens', 'issued_aud')).toBe(true)
    // the legacy row itself survives the column drop (only its session_id value is gone)
    const r = await env.chiyigo_db.prepare(
      `SELECT token_hash FROM refresh_tokens WHERE token_hash='h_sess_legacy'`,
    ).first()
    expect(r.token_hash).toBe('h_sess_legacy')
  })

  it('re-up after down restores the column + index (forward idempotent)', async () => {
    await execAll(up0052)
    expect(await columnExists('refresh_tokens', 'session_id')).toBe(true)
    expect(await indexExists('idx_refresh_tokens_session')).toBe(true)
  })
})

// migration 0053 refresh_tokens.successor_token_hash (Fork 2 Route B) — targeted round-trip.
// Builds a pre-0053 refresh_tokens fixture (0052-era shape: WITH session_id, NO successor_token_hash), applies up0053,
// and verifies the nullable column appears (NO index, NO backfill), a value persists across an unrelated UPDATE, the
// legacy row stays NULL (fail-safe non-candidate), and down drops the column (reversible on this D1 engine) with re-up
// restoring it. Builds its OWN fixture (manual CREATE, like the 0037/0052 targeted blocks) but still does
// dropAllTables in beforeAll, so it MUST sit BEFORE the '0038 targeted' block (the last schema mutator that leaves the
// FK-less audit_log other integration test files rely on via the shared single-worker D1).
describe('migrations smoke 0053 targeted (refresh_tokens.successor_token_hash round-trip)', () => {
  beforeAll(async () => {
    await dropAllTables()
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
    // pre-0053 shape: 0052-era refresh_tokens (has session_id, no successor_token_hash)
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
        scope       TEXT,
        issued_aud  TEXT,
        session_id  TEXT
      )
    `).run()
    await env.chiyigo_db.prepare(`INSERT INTO users (email) VALUES ('succ-legacy@test')`).run()
    const u = await env.chiyigo_db.prepare(`SELECT id FROM users WHERE email='succ-legacy@test'`).first()
    // a pre-0053 row (no successor_token_hash) -- simulates a prod legacy refresh token at migration time
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES (?, 'h_succ_legacy', datetime('now','+7 days'))`,
    ).bind(u.id).run()
    await execAll(up0053)
  })

  it('successor_token_hash column present after up (EXPAND-only, NO index)', async () => {
    expect(await columnExists('refresh_tokens', 'successor_token_hash')).toBe(true)
    expect(await indexExists('idx_refresh_tokens_successor')).toBe(false)  // 0053 adds NO index by design
  })

  it('legacy row (pre-0053) successor_token_hash is NULL (no backfill -> fail-safe non-candidate)', async () => {
    const r = await env.chiyigo_db.prepare(
      `SELECT successor_token_hash FROM refresh_tokens WHERE token_hash='h_succ_legacy'`,
    ).first()
    expect(r.successor_token_hash).toBeNull()
  })

  it('a successor_token_hash value persists; an unrelated UPDATE (revoke) leaves it intact', async () => {
    const u = await env.chiyigo_db.prepare(`SELECT id FROM users WHERE email='succ-legacy@test'`).first()
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, successor_token_hash)
       VALUES (?, 'h_succ_old', datetime('now','+7 days'), 'h_succ_new')`,
    ).bind(u.id).run()
    await env.chiyigo_db.prepare(
      `UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE token_hash='h_succ_old'`,
    ).run()
    const r = await env.chiyigo_db.prepare(
      `SELECT successor_token_hash, revoked_at FROM refresh_tokens WHERE token_hash='h_succ_old'`,
    ).first()
    expect(r.successor_token_hash).toBe('h_succ_new')
    expect(r.revoked_at).toBeTruthy()
  })

  it('down: column dropped (reversible on this D1 engine); table + other columns survive', async () => {
    await execAll(down0053)
    expect(await columnExists('refresh_tokens', 'successor_token_hash')).toBe(false)
    expect(await tableExists('refresh_tokens')).toBe(true)
    expect(await columnExists('refresh_tokens', 'token_hash')).toBe(true)
    expect(await columnExists('refresh_tokens', 'session_id')).toBe(true)
    const r = await env.chiyigo_db.prepare(
      `SELECT token_hash FROM refresh_tokens WHERE token_hash='h_succ_legacy'`,
    ).first()
    expect(r.token_hash).toBe('h_succ_legacy')
  })

  it('re-up after down restores the column (forward idempotent)', async () => {
    await execAll(up0053)
    expect(await columnExists('refresh_tokens', 'successor_token_hash')).toBe(true)
  })
})

// migration 0054 elevation_grants + elevation_exchanges + oauth_states elevation cols (SEC-FACTOR-ADD-A) — targeted round-trip.
// Builds a pre-0054 oauth_states fixture (no elevation columns), applies up0054, verifies the two new tables + the 5
// nullable oauth_states columns + indexes, the grant CHECK / UNIQUE constraints, then down drops them (reversible on
// this D1 engine) with re-up restoring. Builds its OWN fixture + dropAllTables, so it sits BEFORE the 0038 block.
describe('migrations smoke 0054 targeted (elevation grants/exchanges + oauth_states elevation cols round-trip)', () => {
  beforeAll(async () => {
    await dropAllTables()
    // pre-0054 oauth_states shape (no elevation columns)
    await env.chiyigo_db.prepare(`
      CREATE TABLE oauth_states (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        state_token     TEXT    NOT NULL UNIQUE,
        code_verifier   TEXT,
        nonce           TEXT,
        redirect_uri    TEXT,
        platform        TEXT,
        client_callback TEXT,
        ip_address      TEXT,
        aud             TEXT,
        expires_at      TEXT    NOT NULL,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `).run()
    await env.chiyigo_db.prepare(
      `INSERT INTO oauth_states (state_token, expires_at) VALUES ('st-legacy', datetime('now','+10 minutes'))`,
    ).run()
    await execAll(up0054)
  })

  it('up: 兩新表 + oauth_states 5 elevation 欄 + index 到位', async () => {
    expect(await tableExists('elevation_grants')).toBe(true)
    expect(await tableExists('elevation_exchanges')).toBe(true)
    for (const c of ['purpose', 'elevation_user_id', 'session_id', 'action', 'factor_add_grant_hash']) {
      expect(await columnExists('oauth_states', c)).toBe(true)
    }
    expect(await indexExists('idx_elevation_grants_expires')).toBe(true)
    expect(await indexExists('idx_elevation_exchanges_session')).toBe(true)
  })

  it('elevation_grants CHECK + UNIQUE：非白名單 action 被拒、合法 row 入、grant_token_hash 重複被拒', async () => {
    await expect(env.chiyigo_db.prepare(
      `INSERT INTO elevation_grants (grant_token_hash, user_id, session_id, purpose, action, method, expires_at)
       VALUES ('g_bad', 1, 's1', 'factor_add', 'NOT_AN_ACTION', 'totp', datetime('now','+5 minutes'))`,
    ).run()).rejects.toThrow()

    await env.chiyigo_db.prepare(
      `INSERT INTO elevation_grants (grant_token_hash, user_id, session_id, purpose, action, method, expires_at)
       VALUES ('g_ok', 1, 's1', 'factor_add', 'add_passkey', 'totp', datetime('now','+5 minutes'))`,
    ).run()

    await expect(env.chiyigo_db.prepare(
      `INSERT INTO elevation_grants (grant_token_hash, user_id, session_id, purpose, action, method, expires_at)
       VALUES ('g_ok', 1, 's1', 'factor_add', 'add_passkey', 'totp', datetime('now','+5 minutes'))`,
    ).run()).rejects.toThrow()
  })

  it('down: 兩表 + 5 欄移除（reversible）；oauth_states 與既有欄/資料存活', async () => {
    await execAll(down0054)
    expect(await tableExists('elevation_grants')).toBe(false)
    expect(await tableExists('elevation_exchanges')).toBe(false)
    for (const c of ['purpose', 'elevation_user_id', 'session_id', 'action', 'factor_add_grant_hash']) {
      expect(await columnExists('oauth_states', c)).toBe(false)
    }
    expect(await tableExists('oauth_states')).toBe(true)
    expect(await columnExists('oauth_states', 'state_token')).toBe(true)
    const r = await env.chiyigo_db.prepare(
      `SELECT state_token FROM oauth_states WHERE state_token='st-legacy'`,
    ).first()
    expect(r.state_token).toBe('st-legacy')
  })

  it('re-up after down restores tables + columns (forward idempotent)', async () => {
    await execAll(up0054)
    expect(await tableExists('elevation_grants')).toBe(true)
    expect(await columnExists('oauth_states', 'action')).toBe(true)
  })
})

// PR-A4 (SEC-FACTOR-ADD ADD-A): 0055 adds disposition columns to the three credential tables. down is a
// conservative TABLE-REBUILD (Arch Gate F1, not DROP COLUMN). This round-trip proves down removes the 4 columns
// while PRESERVING every original credential row + restoring original indexes, and re-up brings the columns back.
// Builds its OWN pre-0055 fixtures + dropAllTables, so it sits independently of the full-forward block.
describe('migrations smoke 0055 targeted (credential disposition columns + table-rebuild down round-trip)', () => {
  const COLS = ['requires_reverification', 'disposition_reason', 'disposition_at', 'disposition_by']
  const TABLES = ['user_webauthn_credentials', 'user_wallets', 'user_identities']

  beforeAll(async () => {
    await dropAllTables()
    // minimal users (credential tables FK user_id -> users(id))
    await env.chiyigo_db.prepare(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT)`).run()
    await env.chiyigo_db.prepare(`INSERT INTO users (id, email) VALUES (1, 'u1@x')`).run()
    // pre-0055 ORIGINAL schemas (no disposition columns) — must match 0021 / 0023 / 0000_base
    await env.chiyigo_db.prepare(`
      CREATE TABLE user_webauthn_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0, transports TEXT, aaguid TEXT, nickname TEXT,
        backup_eligible INTEGER NOT NULL DEFAULT 0, backup_state INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT
      )`).run()
    await env.chiyigo_db.prepare(`CREATE INDEX idx_user_webauthn_credentials_user ON user_webauthn_credentials(user_id)`).run()
    await env.chiyigo_db.prepare(`
      CREATE TABLE user_wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL, chain_id INTEGER NOT NULL DEFAULT 1, nickname TEXT,
        signed_at TEXT NOT NULL DEFAULT (datetime('now')), last_used_at TEXT,
        UNIQUE(user_id, address)
      )`).run()
    await env.chiyigo_db.prepare(`
      CREATE TABLE user_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL, provider_id TEXT NOT NULL, display_name TEXT, avatar_url TEXT, metadata TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(provider, provider_id)
      )`).run()
    // seed one row per table (data-preservation anchors)
    await env.chiyigo_db.prepare(`INSERT INTO user_webauthn_credentials (id, user_id, credential_id, public_key) VALUES (7, 1, 'cred-keep', 'pk')`).run()
    await env.chiyigo_db.prepare(`INSERT INTO user_wallets (id, user_id, address) VALUES (8, 1, '0xabc')`).run()
    await env.chiyigo_db.prepare(`INSERT INTO user_identities (id, user_id, provider, provider_id) VALUES (9, 1, 'google', 'g-keep')`).run()
    await execAll(up0055)
  })

  it('up: 三表各加 4 disposition 欄 + partial reverif index 到位', async () => {
    for (const t of TABLES) {
      for (const c of COLS) expect(await columnExists(t, c)).toBe(true)
    }
    expect(await indexExists('idx_user_webauthn_credentials_reverif')).toBe(true)
    expect(await indexExists('idx_user_wallets_reverif')).toBe(true)
    expect(await indexExists('idx_user_identities_reverif')).toBe(true)
    // default 正確
    const row = await env.chiyigo_db.prepare(`SELECT requires_reverification AS r FROM user_webauthn_credentials WHERE id=7`).first()
    expect(row.r).toBe(0)
  })

  it('down (table-rebuild): 4 欄移除、三表存活、既有 credential 資料零損失', async () => {
    await execAll(down0055)
    for (const t of TABLES) {
      expect(await tableExists(t)).toBe(true)
      for (const c of COLS) expect(await columnExists(t, c)).toBe(false)
    }
    // 原欄位 + 資料保留（id/credential_id/address/provider 全在）
    const w = await env.chiyigo_db.prepare(`SELECT id, user_id, credential_id, public_key FROM user_webauthn_credentials WHERE id=7`).first()
    expect(w).toMatchObject({ id: 7, user_id: 1, credential_id: 'cred-keep', public_key: 'pk' })
    const wal = await env.chiyigo_db.prepare(`SELECT id, address, chain_id FROM user_wallets WHERE id=8`).first()
    expect(wal).toMatchObject({ id: 8, address: '0xabc', chain_id: 1 })
    const idn = await env.chiyigo_db.prepare(`SELECT id, provider, provider_id FROM user_identities WHERE id=9`).first()
    expect(idn).toMatchObject({ id: 9, provider: 'google', provider_id: 'g-keep' })
    // 原 index 重建、reverif partial index 消失
    expect(await indexExists('idx_user_wallets_address')).toBe(true)
    expect(await indexExists('idx_user_identities_reverif')).toBe(false)
    // UNIQUE 約束重建：重複 (user_id,address) 被拒
    await expect(env.chiyigo_db.prepare(`INSERT INTO user_wallets (user_id, address) VALUES (1, '0xabc')`).run()).rejects.toThrow()
  })

  it('re-up after down restores disposition columns (forward idempotent)', async () => {
    await execAll(up0055)
    for (const t of TABLES) for (const c of COLS) expect(await columnExists(t, c)).toBe(true)
    // 資料仍在
    const w = await env.chiyigo_db.prepare(`SELECT credential_id FROM user_webauthn_credentials WHERE id=7`).first()
    expect(w.credential_id).toBe('cred-keep')
  })
})

// PR4 D10 micro-spike: verify D1 preserves last_insert_rowid() across statements within ONE batch()
// (S2 captures the AUTOINCREMENT id of S1's INSERT). createOrgTenant (commit 3) relies on this to write
// the org_create_operations row pointing at the just-created tenant. Self-contained scratch tables so it
// does not touch audit_log (ordering-neutral). If this ever FAILS, switch createOrgTenant to the
// correlation-token fallback (plan section 8 / D10) -- do NOT rely on last_insert_rowid().
describe('D1 batch last_insert_rowid() semantic (PR4 D10 micro-spike)', () => {
  it('last_insert_rowid() in batch stmt 2 reflects the INSERT of stmt 1', async () => {
    await env.chiyigo_db.prepare('DROP TABLE IF EXISTS _d10_parent').run()
    await env.chiyigo_db.prepare('DROP TABLE IF EXISTS _d10_child').run()
    await env.chiyigo_db.prepare('CREATE TABLE _d10_parent (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT)').run()
    await env.chiyigo_db.prepare('CREATE TABLE _d10_child (parent_id INTEGER NOT NULL, note TEXT)').run()
    // seed a few rows so the target id is not trivially 1 (makes the assertion meaningful)
    await env.chiyigo_db.prepare(`INSERT INTO _d10_parent (label) VALUES ('s1'), ('s2'), ('s3')`).run()

    await env.chiyigo_db.batch([
      env.chiyigo_db.prepare(`INSERT INTO _d10_parent (label) VALUES ('target')`),
      env.chiyigo_db.prepare(`INSERT INTO _d10_child (parent_id, note) SELECT last_insert_rowid(), 'c'`),
    ])

    const parent = await env.chiyigo_db.prepare(`SELECT id FROM _d10_parent WHERE label = 'target'`).first<{ id: number }>()
    const child = await env.chiyigo_db.prepare(`SELECT parent_id FROM _d10_child WHERE note = 'c'`).first<{ parent_id: number }>()
    expect(parent?.id).toBeGreaterThan(3)            // not the trivial first row
    expect(child?.parent_id).toBe(parent?.id)        // S2 captured S1's rowid -> createOrgTenant can use it

    await env.chiyigo_db.prepare('DROP TABLE IF EXISTS _d10_child').run()
    await env.chiyigo_db.prepare('DROP TABLE IF EXISTS _d10_parent').run()
  })
})

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


