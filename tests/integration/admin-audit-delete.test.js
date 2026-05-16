/**
 * DELETE /api/admin/audit/:id atomicity 測試（codex 2026-05-16 F3）
 *
 * 驗證 SELECT → INSERT admin_audit_log → DELETE audit_log 從三步非原子改成
 * 「SELECT；INSERT + DELETE 同 D1 batch + event_type guard + changes===1」。
 *
 * 涵蓋：
 *   - 404：audit_log row 不存在
 *   - 403：event_type 不在 DELETABLE_EVENTS（非 requisition.deleted）
 *   - 200：happy path → row 刪除 + admin_audit_log 寫入 + hash chain valid
 *   - 409：DELETE.changes !== 1（race — batch 後 audit_log row 已不存在或 event_type 變了）
 *     使用 stub batch 模擬：保證即使 race 真發生也不會留下「刪了卻沒刪到」的污染
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt'
import { SCOPES } from '../../functions/utils/scopes.js'
import { verifyAuditChain } from '../../functions/utils/audit-log.js'
import { onRequestDelete as deleteHandler } from '../../functions/api/admin/audit/[id].js'

async function adminStepUpToken(userId, forAction = 'delete_audit') {
  return signJwt(
    {
      sub: String(userId), email: 'a@x', role: 'admin', status: 'active', ver: 0,
      scope: SCOPES.ELEVATED_ACCOUNT,
      for_action: forAction,
      amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2',
    },
    '5m', env,
  )
}

function bearerDel(id, token) {
  return new Request(`http://x/api/admin/audit/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

async function seedAuditLogRow({ event_type = 'requisition.deleted', user_id = null } = {}) {
  const r = await env.chiyigo_db.prepare(
    `INSERT INTO audit_log (event_type, severity, user_id, ip_hash, event_data)
     VALUES (?, 'info', ?, NULL, '{}')`,
  ).bind(event_type, user_id).run()
  return r.meta.last_row_id
}

async function callDelete(id, token, dbOverride) {
  return deleteHandler({
    request: bearerDel(id, token),
    env: dbOverride ? { ...env, chiyigo_db: dbOverride } : env,
    params: { id: String(id) },
  })
}

describe('DELETE /api/admin/audit/:id atomicity', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('row 不存在 → 404 AUDIT_NOT_FOUND', async () => {
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(a.id)
    const resp = await callDelete(99999, tok)
    expect(resp.status).toBe(404)
    const body = await resp.json()
    expect(body.code).toBe('AUDIT_NOT_FOUND')
  })

  it('event_type 不在 DELETABLE_EVENTS → 403 EVENT_NOT_DELETABLE', async () => {
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(a.id)
    const auditId = await seedAuditLogRow({ event_type: 'login.success' })
    const resp = await callDelete(auditId, tok)
    expect(resp.status).toBe(403)
    const body = await resp.json()
    expect(body.code).toBe('EVENT_NOT_DELETABLE')
    // 沒刪到 row
    const still = await env.chiyigo_db
      .prepare('SELECT 1 AS x FROM audit_log WHERE id = ?').bind(auditId).first()
    expect(still?.x).toBe(1)
  })

  it('happy path：row 刪除 + admin_audit_log 寫入 + hash chain valid', async () => {
    const a = await seedUser({ email: 'admin@x', role: 'admin' })
    const tok = await adminStepUpToken(a.id)
    const auditId = await seedAuditLogRow({ event_type: 'requisition.deleted' })

    const resp = await callDelete(auditId, tok)
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.ok).toBe(true)
    expect(body.id).toBe(auditId)

    // audit_log row 已刪
    const gone = await env.chiyigo_db
      .prepare('SELECT 1 AS x FROM audit_log WHERE id = ?').bind(auditId).first()
    expect(gone).toBeFalsy()

    // admin_audit_log 已記
    const adminLog = await env.chiyigo_db
      .prepare(`SELECT admin_id, action, target_id FROM admin_audit_log
                 WHERE action = 'audit_log.delete' ORDER BY id DESC LIMIT 1`).first()
    expect(adminLog).toBeTruthy()
    expect(Number(adminLog.admin_id)).toBe(a.id)
    expect(Number(adminLog.target_id)).toBe(auditId)

    // hash chain 仍 valid
    const chain = await verifyAuditChain(env.chiyigo_db)
    expect(chain.valid).toBe(true)
  })

  it('DELETE.changes===0（race：row 在 batch 前被改/刪）→ 409 AUDIT_RACE', async () => {
    const a = await seedUser({ email: 'admin@x', role: 'admin' })
    const tok = await adminStepUpToken(a.id)
    const auditId = await seedAuditLogRow({ event_type: 'requisition.deleted' })

    // stub batch：模擬 DELETE 對到 0 row（event_type 在 batch commit 前被改掉了）
    // 注意：INSERT admin_audit_log 仍實際執行 — 證明 hash-chain 證據保留是正確行為
    const realDb = env.chiyigo_db
    const stubDb = {
      prepare: realDb.prepare.bind(realDb),
      batch: async (stmts) => {
        // 實際跑 INSERT（第 0 個），讓 admin_audit_log 真的寫入
        await stmts[0].run()
        // DELETE 模擬 0 changes（真實情境：event_type 已不等於 'requisition.deleted'）
        return [
          { meta: { changes: 1 } },
          { meta: { changes: 0 } },
        ]
      },
    }

    const resp = await callDelete(auditId, tok, stubDb)
    expect(resp.status).toBe(409)
    const body = await resp.json()
    expect(body.code).toBe('AUDIT_RACE')

    // hash-chain entry 仍寫入（嘗試紀錄保留）
    const adminLog = await env.chiyigo_db
      .prepare(`SELECT id FROM admin_audit_log WHERE action = 'audit_log.delete'`).first()
    expect(adminLog).toBeTruthy()

    // hash chain 仍 valid
    const chain = await verifyAuditChain(env.chiyigo_db)
    expect(chain.valid).toBe(true)
  })

  it('event_type guard 真擋：手動把 row event_type 改成非 deletable 後再呼叫 → row 不變', async () => {
    // 這個 test 直接證明 DELETE WHERE event_type=? guard 在 batch 內生效（非 stub）
    // 模擬 race：handler SELECT 看到的 event_type 是 'requisition.deleted'，
    // 但我們在呼叫 handler 前先「未來」一步把 row 改成另一種 event_type —
    // 等價於 handler SELECT 後別人改了 row。
    const a = await seedUser({ email: 'admin@x', role: 'admin' })
    const tok = await adminStepUpToken(a.id)
    const auditId = await seedAuditLogRow({ event_type: 'requisition.deleted' })

    // 包一層 prepare 攔截 SELECT event_type 查詢，回傳「過去」的 event_type
    // 但底層 DB 上 row event_type 已被改 → DELETE batch 不會 match
    await env.chiyigo_db
      .prepare(`UPDATE audit_log SET event_type = 'login.success' WHERE id = ?`)
      .bind(auditId).run()

    // SELECT 攔截：第一次查 audit_log 的時候回原本的 event_type
    const realDb = env.chiyigo_db
    const stubDb = {
      prepare: (sql) => {
        const stmt = realDb.prepare(sql)
        if (/SELECT id, event_type FROM audit_log WHERE id = \?/.test(sql)) {
          return {
            bind: (...args) => ({
              first: async () => ({ id: args[0], event_type: 'requisition.deleted' }),
              run:   () => stmt.bind(...args).run(),
              all:   () => stmt.bind(...args).all(),
            }),
          }
        }
        return stmt
      },
      batch: realDb.batch.bind(realDb),
    }

    const resp = await callDelete(auditId, tok, stubDb)
    expect(resp.status).toBe(409)
    const body = await resp.json()
    expect(body.code).toBe('AUDIT_RACE')

    // 原 row 仍在（event_type guard 擋住 DELETE）
    const still = await env.chiyigo_db
      .prepare('SELECT event_type FROM audit_log WHERE id = ?').bind(auditId).first()
    expect(still?.event_type).toBe('login.success')
  })
})
