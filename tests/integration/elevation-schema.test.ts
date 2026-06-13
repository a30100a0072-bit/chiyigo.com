/**
 * SEC-FACTOR-ADD-A PR-A1（schema/migration）— elevation_grants / elevation_exchanges 的
 * cron cleanup 行為測試（migration 0054 + cleanup.ts 兩 task）。
 *
 * migration round-trip + CHECK/UNIQUE 約束在 migrations.test.ts 0054 targeted block 驗；
 * 本檔驗「cleanup 只刪過期 elevation row、live row 不動」（schema 已由 _setup.sql 提供）。
 * elevation runtime（端點/gate）在 PR-A2/A3，本 PR 無 reader。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers'
import { onRequestPost as cleanupHandler } from '../../functions/api/admin/cron/cleanup'

function cronReq() {
  return new Request('http://x/api/admin/cron/cleanup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CRON_SECRET}`, 'Content-Type': 'application/json' },
  })
}

describe('PR-A1: elevation_grants / elevation_exchanges cron cleanup', () => {
  beforeAll(async () => { await resetDb() })
  beforeEach(async () => { await resetDb() })

  it('cleanup 刪過期 elevation_grants、保留未過期', async () => {
    await env.chiyigo_db.prepare(
      `INSERT INTO elevation_grants (grant_token_hash, user_id, session_id, purpose, action, method, expires_at)
       VALUES ('g_expired', 1, 's1', 'factor_add', 'add_passkey', 'totp', datetime('now','-1 minute'))`,
    ).run()
    await env.chiyigo_db.prepare(
      `INSERT INTO elevation_grants (grant_token_hash, user_id, session_id, purpose, action, method, expires_at)
       VALUES ('g_live', 1, 's1', 'factor_add', 'add_passkey', 'totp', datetime('now','+5 minutes'))`,
    ).run()

    const resp = await cleanupHandler({ request: cronReq(), env })
    expect(resp.status).toBe(200)

    const expired = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM elevation_grants WHERE grant_token_hash='g_expired'`).first()
    expect(Number(expired.c)).toBe(0)
    const live = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM elevation_grants WHERE grant_token_hash='g_live'`).first()
    expect(Number(live.c)).toBe(1)
  })

  it('cleanup 刪過期 elevation_exchanges、保留未過期', async () => {
    await env.chiyigo_db.prepare(
      `INSERT INTO elevation_exchanges (exchange_code_hash, user_id, session_id, provider, provider_id_hash, action, expires_at)
       VALUES ('x_expired', 1, 's1', 'google', 'ph', 'bind_identity', datetime('now','-1 minute'))`,
    ).run()
    await env.chiyigo_db.prepare(
      `INSERT INTO elevation_exchanges (exchange_code_hash, user_id, session_id, provider, provider_id_hash, action, expires_at)
       VALUES ('x_live', 1, 's1', 'google', 'ph', 'bind_identity', datetime('now','+1 minute'))`,
    ).run()

    const resp = await cleanupHandler({ request: cronReq(), env })
    expect(resp.status).toBe(200)

    const expired = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM elevation_exchanges WHERE exchange_code_hash='x_expired'`).first()
    expect(Number(expired.c)).toBe(0)
    const live = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM elevation_exchanges WHERE exchange_code_hash='x_live'`).first()
    expect(Number(live.c)).toBe(1)
  })
})
