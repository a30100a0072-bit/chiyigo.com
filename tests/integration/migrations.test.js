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
  for (let i = 0; i < 5; i++) {
    const rows = await env.chiyigo_db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'`)
      .all()
    if (!rows.results?.length) return
    for (const { name } of rows.results) {
      await env.chiyigo_db.prepare(`DROP TABLE IF EXISTS "${name}"`).run()
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
