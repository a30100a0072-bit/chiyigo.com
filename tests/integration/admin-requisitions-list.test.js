/**
 * Stage 3 PR-16b — admin/requisitions + admin/requisition-refund list integration tests
 *
 * Coverage（review focus 在 scope/role/filter/pagination/soft-delete/output shape）：
 *
 *  GET /api/admin/requisitions
 *    - 401 missing token
 *    - 403 INSUFFICIENT_SCOPE (player no admin scopes)
 *    - 200 admin role (base scope coarse expands to fine)
 *    - 200 each of 4 admin:payments:* fine scopes accepted
 *    - q filter searches name OR contact OR message OR company（4 欄 OR）
 *    - q filter substring positive
 *    - q filter truncated at 100 chars（slice 守門）
 *    - include_deleted=1 reveals soft-deleted, default hides
 *    - pagination + limit cap=100
 *    - rate limit 60/min admin_read → 429 + audit row
 *    - read audit row written (admin.requisitions.read)
 *    - output shape includes status + created_at but no secret columns
 *
 *  GET /api/admin/requisition-refund
 *    - 401 missing token
 *    - 403 INSUFFICIENT_SCOPE
 *    - 200 each of 4 admin:payments:* scopes accepted
 *    - default status=pending
 *    - explicit status: approved / rejected / processing 各回對應 rows
 *    - invalid status → 400 INVALID_STATUS
 *    - pagination + limit cap=200
 *    - rate limit 429 + audit
 *    - read audit row (admin.refund_requests.read)
 *    - output shape includes JOIN columns (req_name / intent_vendor / intent_status)
 *
 * 設計說明：兩 endpoint 都走 requireAnyScope(ADMIN_PAYMENTS_{READ,WRITE,REFUND,APPROVE})
 * 而非 admin/users 的 requireRole('admin')。canonical admin/super_admin/developer
 * 透過 role base scopes 含 admin:payments coarse → expandHierarchy 自動有所有 fine；
 * player + explicit fine scope claim 也應放行（finance/support role 未來路徑）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt'
import { onRequestGet as listHandler } from '../../functions/api/admin/requisitions'
import { onRequestGet as refundListHandler } from '../../functions/api/admin/requisition-refund'

// ── helpers ────────────────────────────────────────────────────────

async function tokenFor(userId, role = 'admin', extra = {}) {
  return signJwt({
    sub: String(userId), email: `${role}@x`, role, status: 'active', ver: 0, ...extra,
  }, '15m', env, { audience: 'chiyigo' })
}

function reqWith(token, url) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  return new Request(url, { headers })
}

async function callList(token, query = '') {
  const resp = await listHandler({ request: reqWith(token, `http://x/api/admin/requisitions${query}`), env })
  return { status: resp.status, body: await resp.json() }
}

async function callRefundList(token, query = '') {
  const resp = await refundListHandler({ request: reqWith(token, `http://x/api/admin/requisition-refund${query}`), env })
  return { status: resp.status, body: await resp.json() }
}

async function seedReq({ name = 'r', contact = 'c@x', company = null, service_type = 'web',
                        message = 'm', status = 'pending', deleted_at = null } = {}) {
  const r = await env.chiyigo_db
    .prepare(`INSERT INTO requisition (name, contact, company, service_type, message, status, deleted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(name, contact, company, service_type, message, status, deleted_at).run()
  return r.meta.last_row_id
}

/**
 * @param {{ user_id: number, requisition_id?: number|null, intent_id?: number|null,
 *           status?: string, reason?: string }} opts
 */
async function seedRefundRequest({ user_id, requisition_id = null, intent_id = null,
                                   status = 'pending', reason = 'r' }) {
  const r = await env.chiyigo_db
    .prepare(`INSERT INTO requisition_refund_request (user_id, requisition_id, intent_id, status, reason)
              VALUES (?, ?, ?, ?, ?)`)
    .bind(user_id, requisition_id, intent_id, status, reason).run()
  return r.meta.last_row_id
}

async function fillRateLimit(userId, count = 60) {
  // 直接灌 60 筆 admin_read 進 login_attempts；下次 checkRateLimit 即 blocked
  const stmts = []
  for (let i = 0; i < count; i++) {
    stmts.push(env.chiyigo_db.prepare(`INSERT INTO login_attempts (kind, user_id) VALUES ('admin_read', ?)`).bind(userId))
  }
  await env.chiyigo_db.batch(stmts)
}

// ── GET /api/admin/requisitions ─────────────────────────────────────

describe('GET /api/admin/requisitions', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒帶 token → 401', async () => {
    const r = await callList(null)
    expect(r.status).toBe(401)
  })

  it('player 無 admin scope → 403 INSUFFICIENT_SCOPE', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const r = await callList(await tokenFor(id, 'player'))
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_SCOPE')
  })

  it('admin role → 200（base scope coarse → fine 展開）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedReq({ name: 'Alice', message: 'hi' })
    const r = await callList(await tokenFor(id, 'admin'))
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body.requisitions)).toBe(true)
    expect(r.body.total).toBeGreaterThanOrEqual(1)
  })

  it.each([
    ['admin:payments:read'],
    ['admin:payments:write'],
    ['admin:payments:refund'],
    ['admin:payments:approve'],
  ])('player + explicit %s 也放行', async (scope) => {
    const { id } = await seedUser({ email: 'p@x' })
    const r = await callList(await tokenFor(id, 'player', { scope }))
    expect(r.status).toBe(200)
  })

  it('q filter 搜 name OR contact OR message OR company（4 欄 OR）', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedReq({ name: 'aliceN', contact: 'x', message: 'x', company: 'x' })
    await seedReq({ name: 'x', contact: 'aliceC@y', message: 'x', company: 'x' })
    await seedReq({ name: 'x', contact: 'x', message: 'aliceM body', company: 'x' })
    await seedReq({ name: 'x', contact: 'x', message: 'x', company: 'aliceCorp' })
    await seedReq({ name: 'no', contact: 'no', message: 'no', company: 'no' })

    const tok = await tokenFor(aid, 'admin')
    const rN = await callList(tok, '?q=aliceN')
    const rC = await callList(tok, '?q=aliceC')
    const rM = await callList(tok, '?q=aliceM')
    const rCo = await callList(tok, '?q=aliceCorp')
    expect(rN.body.requisitions.some(r => r.name === 'aliceN')).toBe(true)
    expect(rC.body.requisitions.some(r => r.contact === 'aliceC@y')).toBe(true)
    expect(rM.body.requisitions.some(r => r.message === 'aliceM body')).toBe(true)
    expect(rCo.body.requisitions.some(r => r.company === 'aliceCorp')).toBe(true)
  })

  // q-length boundary test 故意不寫：requisitions.ts L47 slice 上限是 100 字元，
  // 但 D1 SQLite「LIKE or GLOB pattern too complex」會在更短就先觸發（4-OR LIKE
  // 把 complexity 放大；exact ceiling 需 PR-16c spike）。此 PR 是純 regression
  // test，不夾帶 production fix；PR-16c 候選範圍：
  //   (1) 確認 D1 真實上限並把 slice cap 改到安全值（或先 SELECT instr 替代 LIKE）；
  //   (2) 加 q 長度邊界測試 + 觀察 endpoint 在過長 q 不應 500（截斷或 400 都比 500 好）。

  it('include_deleted=1 顯示軟刪 row，預設隱藏', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedReq({ name: 'live', message: 'hi' })
    await seedReq({ name: 'dead', message: 'hi', deleted_at: '2026-01-01 00:00:00' })

    const tok = await tokenFor(aid, 'admin')
    const def = await callList(tok)
    expect(def.body.requisitions.some(r => r.name === 'live')).toBe(true)
    expect(def.body.requisitions.some(r => r.name === 'dead')).toBe(false)

    const all = await callList(tok, '?include_deleted=1')
    expect(all.body.requisitions.some(r => r.name === 'live')).toBe(true)
    expect(all.body.requisitions.some(r => r.name === 'dead')).toBe(true)
  })

  it('pagination limit + page；limit 超 100 被夾到 100', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    for (let i = 0; i < 5; i++) await seedReq({ name: `r${i}`, message: 'x' })
    const tok = await tokenFor(aid, 'admin')

    const p1 = await callList(tok, '?limit=2&page=1')
    expect(p1.body.requisitions.length).toBe(2)
    expect(p1.body.page).toBe(1)
    expect(p1.body.limit).toBe(2)
    expect(p1.body.total).toBe(5)

    const big = await callList(tok, '?limit=999')
    expect(big.body.limit).toBe(100)  // dampened by Math.min(100, ...)
  })

  it('admin_read rate limit 60/min → 429 + admin.read.rate_limited audit', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    await fillRateLimit(aid, 60)
    const r = await callList(await tokenFor(aid, 'admin'))
    expect(r.status).toBe(429)
    expect(r.body.code).toBe('RATE_LIMITED')

    const audit = await env.chiyigo_db
      .prepare(`SELECT severity, event_data FROM audit_log
                WHERE event_type = 'admin.read.rate_limited' AND user_id = ?`)
      .bind(aid).first()
    expect(audit).toBeTruthy()
    expect(audit.severity).toBe('warn')
    expect(audit.event_data).toContain('"endpoint":"requisitions"')
  })

  it('happy 寫 admin.requisitions.read audit row（含 filters + result_count）', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedReq({ name: 'r1', message: 'x' })
    await callList(await tokenFor(aid, 'admin'), '?q=r1&page=1&limit=20')

    const audit = await env.chiyigo_db
      .prepare(`SELECT severity, event_data FROM audit_log
                WHERE event_type = 'admin.requisitions.read' AND user_id = ?`)
      .bind(aid).first()
    expect(audit).toBeTruthy()
    expect(audit.severity).toBe('info')
    expect(audit.event_data).toContain('"q":"r1"')
    expect(audit.event_data).toContain('"result_count":1')
  })

  it('output shape：含 status / created_at；不含 user_id / source_ip / tg_message_id 等敏感欄', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedReq({ name: 'r', message: 'x', status: 'pending' })
    // 直接 UPDATE 補敏感欄，確保即使存在也不外洩
    await env.chiyigo_db.prepare(`UPDATE requisition SET user_id = 999, tg_message_id = 12345, source_ip = '1.2.3.4'`).run()

    const r = await callList(await tokenFor(aid, 'admin'))
    expect(r.body.requisitions.length).toBeGreaterThan(0)
    const row = r.body.requisitions[0]
    expect(row).toHaveProperty('status')
    expect(row).toHaveProperty('created_at')
    expect(row).not.toHaveProperty('user_id')
    expect(row).not.toHaveProperty('source_ip')
    expect(row).not.toHaveProperty('tg_message_id')
    expect(row).not.toHaveProperty('deleted_at')
  })
})

// ── GET /api/admin/requisition-refund ───────────────────────────────

describe('GET /api/admin/requisition-refund', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒帶 token → 401', async () => {
    const r = await callRefundList(null)
    expect(r.status).toBe(401)
  })

  it('player 無 admin scope → 403 INSUFFICIENT_SCOPE', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const r = await callRefundList(await tokenFor(id, 'player'))
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_SCOPE')
  })

  it.each([
    ['admin:payments:read'],
    ['admin:payments:write'],
    ['admin:payments:refund'],
    ['admin:payments:approve'],
  ])('player + explicit %s 也放行', async (scope) => {
    const { id } = await seedUser({ email: 'p@x' })
    const r = await callRefundList(await tokenFor(id, 'player', { scope }))
    expect(r.status).toBe(200)
  })

  it('預設 status=pending 只回 pending', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    await seedRefundRequest({ user_id: uid, status: 'pending' })
    await seedRefundRequest({ user_id: uid, status: 'approved' })
    await seedRefundRequest({ user_id: uid, status: 'rejected' })
    await seedRefundRequest({ user_id: uid, status: 'processing' })

    const r = await callRefundList(await tokenFor(aid, 'admin'))
    expect(r.status).toBe(200)
    expect(r.body.total).toBe(1)
    expect(r.body.rows.every(x => x.status === 'pending')).toBe(true)
  })

  it.each([
    ['approved'], ['rejected'], ['processing'],
  ])('explicit status=%s 回對應 rows', async (status) => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    await seedRefundRequest({ user_id: uid, status: 'pending' })
    await seedRefundRequest({ user_id: uid, status })

    const r = await callRefundList(await tokenFor(aid, 'admin'), `?status=${status}`)
    expect(r.status).toBe(200)
    expect(r.body.rows.every(x => x.status === status)).toBe(true)
    expect(r.body.total).toBe(1)
  })

  it('invalid status → 400 INVALID_STATUS', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const r = await callRefundList(await tokenFor(aid, 'admin'), '?status=evil')
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('INVALID_STATUS')
  })

  it('pagination + limit 超 200 被夾到 200', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    for (let i = 0; i < 3; i++) await seedRefundRequest({ user_id: uid, status: 'pending' })

    const tok = await tokenFor(aid, 'admin')
    const p1 = await callRefundList(tok, '?status=pending&limit=2&page=1')
    expect(p1.body.rows.length).toBe(2)
    expect(p1.body.total).toBe(3)
    expect(p1.body.limit).toBe(2)

    const big = await callRefundList(tok, '?status=pending&limit=99999')
    expect(big.body.limit).toBe(200)
  })

  it('admin_read rate limit → 429 + audit endpoint=refund-requests', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    await fillRateLimit(aid, 60)
    const r = await callRefundList(await tokenFor(aid, 'admin'))
    expect(r.status).toBe(429)
    expect(r.body.code).toBe('RATE_LIMITED')

    const audit = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log
                WHERE event_type = 'admin.read.rate_limited' AND user_id = ?`)
      .bind(aid).first()
    expect(audit).toBeTruthy()
    expect(audit.event_data).toContain('"endpoint":"refund-requests"')
  })

  it('happy 寫 admin.refund_requests.read audit row', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    await seedRefundRequest({ user_id: uid, status: 'pending' })

    await callRefundList(await tokenFor(aid, 'admin'))
    const audit = await env.chiyigo_db
      .prepare(`SELECT severity, event_data FROM audit_log
                WHERE event_type = 'admin.refund_requests.read' AND user_id = ?`)
      .bind(aid).first()
    expect(audit).toBeTruthy()
    expect(audit.severity).toBe('info')
    expect(audit.event_data).toContain('"status":"pending"')
    expect(audit.event_data).toContain('"result_count":1')
  })

  it('output shape：JOIN 帶出 req_name / intent_vendor / intent_status', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ name: 'JoinedReq', message: 'x' })
    // seed payment_intents 取得 intent_id
    const piRow = await env.chiyigo_db.prepare(`
      INSERT INTO payment_intents (user_id, requisition_id, kind, vendor, vendor_intent_id, amount_subunit, currency, status)
      VALUES (?, ?, 'one_time', 'ecpay', 'EC-int-1', 10000, 'TWD', 'succeeded')
    `).bind(uid, reqId).run()
    const intentId = piRow.meta.last_row_id
    await seedRefundRequest({ user_id: uid, requisition_id: reqId, intent_id: intentId, status: 'pending' })

    const r = await callRefundList(await tokenFor(aid, 'admin'))
    expect(r.status).toBe(200)
    expect(r.body.rows.length).toBeGreaterThan(0)
    const row = r.body.rows[0]
    expect(row.req_name).toBe('JoinedReq')
    expect(row.intent_vendor).toBe('ecpay')
    expect(row.intent_status).toBe('succeeded')
    expect(row.intent_amount_subunit).toBe(10000)
    expect(row.intent_currency).toBe('TWD')
  })
})
