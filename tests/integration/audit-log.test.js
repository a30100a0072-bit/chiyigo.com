/**
 * PR-D: admin_audit_log hash chain 整合測試
 *
 * 注意：AUTOINCREMENT 跨測試遞增，不能假設 id=1/2/3。
 * 改以「從表頭 ORDER BY id 取出 ids」對照。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb } from './_helpers.js'
import { appendAuditLog, verifyAuditChain, _internal } from '../../functions/utils/audit-log.js'

const ENTRY = (action, targetId) => ({
  admin_id:     1,
  admin_email:  'admin@chiyigo.com',
  action,
  target_id:    targetId,
  target_email: `t${targetId}@x`,
  ip_address:   '1.1.1.1',
})

async function fetchIds() {
  const { results } = await env.chiyigo_db
    .prepare(`SELECT id FROM admin_audit_log ORDER BY id ASC`).all()
  return (results ?? []).map(r => r.id)
}

beforeAll(async () => { await resetDb() })
beforeEach(async () => { await resetDb() })

describe('audit-log hash chain', () => {
  it('append 3 筆 → verify 通過，prev_hash 正確串接', async () => {
    const db = env.chiyigo_db
    const r1 = await appendAuditLog(db, ENTRY('ban', 100))
    const r2 = await appendAuditLog(db, ENTRY('unban', 100))
    const r3 = await appendAuditLog(db, ENTRY('ban', 200))

    expect(r1.prevHash).toBe(_internal.GENESIS_HASH)
    expect(r2.prevHash).toBe(r1.rowHash)
    expect(r3.prevHash).toBe(r2.rowHash)

    const v = await verifyAuditChain(db)
    expect(v.valid).toBe(true)
    expect(v.total).toBe(3)
    expect(v.brokenAt).toBeNull()
  })

  it('竄改中間列的 target_email → brokenAt 指向該列', async () => {
    const db = env.chiyigo_db
    await appendAuditLog(db, ENTRY('ban', 1))
    await appendAuditLog(db, ENTRY('ban', 2))
    await appendAuditLog(db, ENTRY('ban', 3))
    const ids = await fetchIds()

    await db.prepare(`UPDATE admin_audit_log SET target_email = 'tampered@x' WHERE id = ?`)
      .bind(ids[1]).run()

    const v = await verifyAuditChain(db)
    expect(v.valid).toBe(false)
    expect(v.brokenAt).toBe(ids[1])
    expect(v.reason).toBe('row_hash mismatch')
  })

  it('攻擊者重新計算 row_hash 但不 update 後續 prev_hash → 第 3 筆 prev_hash mismatch', async () => {
    const db = env.chiyigo_db
    await appendAuditLog(db, ENTRY('ban', 1))
    await appendAuditLog(db, ENTRY('ban', 2))
    await appendAuditLog(db, ENTRY('ban', 3))
    const ids = await fetchIds()

    const row2 = await db.prepare(`SELECT * FROM admin_audit_log WHERE id = ?`).bind(ids[1]).first()
    const tampered = { ...row2, target_email: 'evil@x' }
    const newHash = await _internal.computeRowHash(row2.prev_hash, tampered)
    await db.prepare(
      `UPDATE admin_audit_log SET target_email = ?, row_hash = ? WHERE id = ?`,
    ).bind('evil@x', newHash, ids[1]).run()

    const v = await verifyAuditChain(db)
    expect(v.valid).toBe(false)
    expect(v.brokenAt).toBe(ids[2])
    expect(v.reason).toBe('prev_hash mismatch')
  })

  it('刪除中間列 → 後續 prev_hash 不指向新前者', async () => {
    const db = env.chiyigo_db
    await appendAuditLog(db, ENTRY('ban', 1))
    await appendAuditLog(db, ENTRY('ban', 2))
    await appendAuditLog(db, ENTRY('ban', 3))
    const ids = await fetchIds()

    await db.prepare(`DELETE FROM admin_audit_log WHERE id = ?`).bind(ids[1]).run()

    const v = await verifyAuditChain(db)
    expect(v.valid).toBe(false)
    expect(v.brokenAt).toBe(ids[2])
    expect(v.reason).toBe('prev_hash mismatch')
  })

  it('空表 → valid=true, total=0', async () => {
    const v = await verifyAuditChain(env.chiyigo_db)
    expect(v.valid).toBe(true)
    expect(v.total).toBe(0)
  })

  it('append 後 row 的 created_at 與 hash 計算用值一致（hash 可重現）', async () => {
    const db = env.chiyigo_db
    const r = await appendAuditLog(db, ENTRY('ban', 42))
    const ids = await fetchIds()
    const row = await db.prepare(`SELECT * FROM admin_audit_log WHERE id = ?`).bind(ids[0]).first()
    expect(row.created_at).toBe(r.createdAt)
    expect(row.row_hash).toBe(r.rowHash)
    const recomputed = await _internal.computeRowHash(row.prev_hash, row)
    expect(recomputed).toBe(row.row_hash)
  })
})
