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

import baseSql from '../../migrations/_base.sql?raw'
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
// 至少要有 targeted smoke。完整 0013-0037 forward 因 _base.sql ↔ schema_iam_fresh.sql drift
// 暫不做（refresh_tokens / auth_codes / local_accounts 等 prod 既有表不在 _base）。
// schema baseline 重整為獨立技術債，見 memory project_db_schema_baseline_drift.md。
import up0037 from '../../migrations/0037_refresh_tokens_issued_aud.sql?raw'

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
// _base.sql 與 prod fresh schema (database/schema_iam_fresh.sql) 有 drift —
// refresh_tokens / auth_codes / local_accounts 等 prod 既有表從未經 migration，直接寫進
// fresh schema。因此無法從 _base 一路跑 0001..0037。完整 forward 需先重整 schema baseline
// （獨立技術債，見 memory project_db_schema_baseline_drift.md）。
//
// 本 case 只手建 0037 必要的 fixture（users + pre-0037 refresh_tokens），跑 0037 migration，
// 驗欄位/索引/NULL 行為/綁定持久化。F-2 refresh.js 邏輯（rawAudProvided 條件、effectiveAud
// 由 issued_aud 主導）屬 handler integration test 範疇，不在此覆蓋；TODO 補 refresh.test.js。
describe('migrations smoke 0037 targeted', () => {
  beforeAll(async () => {
    await dropAllTables()
    // pre-0037 minimal fixture：模擬 0036 後狀態
    // refresh_tokens 取自 schema_iam_fresh.sql 的 0037 前形狀（沒 issued_aud 欄）
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
