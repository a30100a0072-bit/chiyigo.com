/**
 * Stage 3 PR-17b — admin/requisitions state transitions integration tests
 *
 * 接 PR-17（save.js+delete.js → save.ts+delete.ts 純 rename）的 test gap 收尾。
 *
 * Coverage（review focus：role gate / status machine / 帳務黑洞防護 / audit / soft-delete 不可逆）：
 *
 *  POST /api/admin/requisitions/:id/save
 *    - 401 missing token (UNAUTHORIZED)
 *    - 403 INSUFFICIENT_ROLE (player) — requireRole('admin') 守門
 *    - 404 REQUISITION_NOT_FOUND（bad id / 已 soft-deleted）
 *    - 409 INVALID_STATUS（非 pending：'deal'/'revoked'/'refund_pending'）
 *    - 409 MIXED_CURRENCY（TWD+USD 同 requisition 各有 succeeded → 拒絕，含 breakdown）
 *    - happy（無 intent）：deals row + status=deal + audit info 寫入 + admin_user_id 帶上
 *    - happy（單一幣別 succeeded+refunded）：total_amount_subunit / refunded_amount_subunit /
 *      payment_intent_ids JSON 對齊
 *    - 重複保存第二次 → 409 INVALID_STATUS（atomic UPDATE 已把 status 改 deal）
 *    - notes truncate 到 500 字
 *
 *  POST /api/admin/requisitions/:id/delete
 *    - 401 missing token
 *    - 403 INSUFFICIENT_ROLE (player)
 *    - 404 REQUISITION_NOT_FOUND（bad id / 已 soft-deleted）
 *    - 409 HAS_UNREFUNDED_PAYMENT（FK requisition_id 主路徑）
 *    - 409 HAS_UNREFUNDED_PAYMENT（FK NULL，metadata.requisition_id 老資料 fallback，P2-5）
 *    - happy（任意 status）：deleted_at 設值 + audit critical row + mode='soft_delete'
 *    - notes truncate 500
 *
 * 設計說明：
 *  - save.ts 的 SAVE_RACE_CONFLICT 路徑（status 在 SELECT 與 UPDATE 之間被改）需要真實
 *    parallelism 才能觸發；本檔以「重複保存」近似覆蓋同樣的 atomic-lock 不雙寫意圖
 *    —— 第二次 save 撈到 status='deal'，提早被 INVALID_STATUS 攔下，code path 不同但
 *    保護意圖（不會雙寫 deals + 不會掉錢）等價。真實 RACE 路徑（撈時 pending、UPDATE
 *    時被搶走）只能靠 production trace 或 chaos test 驗證。
 *  - TG sync 在測試 env 因 TELEGRAM_BOT_TOKEN/CHAT_ID 未注入 → noop（vitest.workers.config.js
 *    bindings 沒有此兩個 key），不需 mock。
 *  - audit_log 寫入靠 safeUserAudit；本檔斷言 event_type + severity + data 關鍵欄位，
 *    不對 hash chain 細節較真（那是 audit infra 自己的責任）。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt'
import { onRequestPost as saveHandler } from '../../functions/api/admin/requisitions/[id]/save'
import { onRequestPost as deleteHandler } from '../../functions/api/admin/requisitions/[id]/delete'

// ── helpers ────────────────────────────────────────────────────────

async function tokenFor(userId, role = 'admin', extra = {}) {
  return signJwt({
    sub: String(userId), email: `${role}@x`, role, status: 'active', ver: 0, ...extra,
  }, '15m', env, { audience: 'chiyigo' })
}

function reqWith(token, url, body = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

async function callSave(token, id, body = {}) {
  const resp = await saveHandler({
    request: reqWith(token, `http://x/api/admin/requisitions/${id}/save`, body),
    env, params: { id: String(id) },
  })
  return { status: resp.status, body: await resp.json() }
}

async function callDelete(token, id, body = {}) {
  const resp = await deleteHandler({
    request: reqWith(token, `http://x/api/admin/requisitions/${id}/delete`, body),
    env, params: { id: String(id) },
  })
  return { status: resp.status, body: await resp.json() }
}

async function seedReq({ user_id = null, name = 'r', contact = 'c@x', company = null,
                         service_type = 'web', budget = null, timeline = null,
                         message = 'm', status = 'pending', deleted_at = null } = {}) {
  const r = await env.chiyigo_db
    .prepare(`INSERT INTO requisition (user_id, name, contact, company, service_type,
                                       budget, timeline, message, status, deleted_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(user_id, name, contact, company, service_type, budget, timeline, message, status, deleted_at)
    .run()
  return r.meta.last_row_id
}

async function seedIntent({ user_id = null, requisition_id = null, status = 'succeeded',
                            amount_subunit = 100000, currency = 'TWD',
                            metadata = null, vendor = 'ecpay', vendor_intent_id = null } = {}) {
  const vid = vendor_intent_id || `vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const r = await env.chiyigo_db
    .prepare(`INSERT INTO payment_intents (user_id, vendor, vendor_intent_id, kind, status,
                                           amount_subunit, currency, metadata, requisition_id)
              VALUES (?, ?, ?, 'deposit', ?, ?, ?, ?, ?)`)
    .bind(user_id, vendor, vid, status, amount_subunit, currency, metadata, requisition_id)
    .run()
  return r.meta.last_row_id
}

async function getReq(id) {
  return env.chiyigo_db.prepare(`SELECT * FROM requisition WHERE id = ?`).bind(id).first()
}

async function getDeal(reqId) {
  return env.chiyigo_db
    .prepare(`SELECT * FROM deals WHERE source_requisition_id = ?`).bind(reqId).first()
}

async function getAuditEvents(eventType) {
  const r = await env.chiyigo_db
    .prepare(`SELECT event_type, severity, user_id, event_data FROM audit_log
              WHERE event_type = ? ORDER BY id DESC`)
    .bind(eventType).all()
  return (r?.results ?? []).map(row => ({
    ...row, data: row.event_data ? JSON.parse(row.event_data) : null,
  }))
}

// ── save ──────────────────────────────────────────────────────────

describe('POST /api/admin/requisitions/:id/save', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒帶 token → 401 UNAUTHORIZED', async () => {
    const reqId = await seedReq()
    const r = await callSave(null, reqId)
    expect(r.status).toBe(401)
    expect(r.body.code).toBe('UNAUTHORIZED')
  })

  it('player → 403 INSUFFICIENT_ROLE', async () => {
    const { id: aid } = await seedUser({ email: 'p@x' })
    const reqId = await seedReq()
    const r = await callSave(await tokenFor(aid, 'player'), reqId)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_ROLE')
  })

  it('id 不合法 → 404 REQUISITION_NOT_FOUND', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const r = await callSave(await tokenFor(aid, 'admin'), 'not-a-number')
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('REQUISITION_NOT_FOUND')
  })

  it('id 不存在 → 404', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const r = await callSave(await tokenFor(aid, 'admin'), 999999)
    expect(r.status).toBe(404)
  })

  it('已 soft-deleted → 404（deleted_at IS NULL gate）', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const reqId = await seedReq({ deleted_at: '2026-05-01T00:00:00Z' })
    const r = await callSave(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(404)
  })

  it.each([
    ['deal'], ['revoked'], ['refund_pending'],
  ])('status=%s → 409 INVALID_STATUS', async (status) => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const reqId = await seedReq({ status })
    const r = await callSave(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('INVALID_STATUS')
    expect(r.body.actual_status).toBe(status)
  })

  it('多幣別 succeeded → 409 MIXED_CURRENCY（含 breakdown，且不會雙寫 deals/不會改 status）', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ user_id: uid })
    await seedIntent({ user_id: uid, requisition_id: reqId, status: 'succeeded', amount_subunit: 100000, currency: 'TWD' })
    await seedIntent({ user_id: uid, requisition_id: reqId, status: 'succeeded', amount_subunit: 500, currency: 'USD' })
    const r = await callSave(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('MIXED_CURRENCY')
    expect(r.body.currencies.sort()).toEqual(['TWD', 'USD'])
    expect(r.body.breakdown.TWD.succeeded_subunit).toBe('100000')
    expect(r.body.breakdown.USD.succeeded_subunit).toBe('500')

    // 重要：MIXED_CURRENCY 在 lock 之前擋下 → status 仍 pending、無 deals row
    const reqRow = await getReq(reqId)
    expect(reqRow.status).toBe('pending')
    expect(await getDeal(reqId)).toBeFalsy()
  })

  it('happy（無 intent）：deals row + status=deal + audit info', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({
      user_id: uid, name: 'Alice', contact: 'alice@x', company: 'Acme',
      service_type: 'web', budget: '50k', timeline: 'Q3', message: 'hi',
    })
    const r = await callSave(await tokenFor(aid, 'admin'), reqId, { notes: 'offline deal' })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.requisition_status).toBe('deal')

    const reqRow = await getReq(reqId)
    expect(reqRow.status).toBe('deal')

    const deal = await getDeal(reqId)
    expect(deal).toBeTruthy()
    expect(deal.customer_name).toBe('Alice')
    expect(deal.customer_contact).toBe('alice@x')
    expect(deal.customer_company).toBe('Acme')
    expect(deal.total_amount_subunit).toBe(0)
    expect(deal.refunded_amount_subunit).toBe(0)
    expect(deal.currency).toBe('TWD')  // fallback default
    expect(deal.payment_intent_ids).toBeNull()  // 無 intent → null
    expect(deal.notes).toBe('offline deal')
    expect(deal.saved_by_admin_id).toBe(aid)

    const audits = await getAuditEvents('requisition.saved_as_deal')
    expect(audits.length).toBe(1)
    expect(audits[0].severity).toBe('info')
    expect(audits[0].user_id).toBe(uid)
    expect(audits[0].data.admin_user_id).toBe(aid)
    expect(audits[0].data.total_succeeded).toBe(0)
    expect(audits[0].data.total_refunded).toBe(0)
  })

  it('happy（succeeded + refunded 單幣別）：金額加總 + intent_ids JSON 對齊', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ user_id: uid })
    const i1 = await seedIntent({ user_id: uid, requisition_id: reqId, status: 'succeeded', amount_subunit: 300000, currency: 'TWD' })
    const i2 = await seedIntent({ user_id: uid, requisition_id: reqId, status: 'succeeded', amount_subunit: 200000, currency: 'TWD' })
    const i3 = await seedIntent({ user_id: uid, requisition_id: reqId, status: 'refunded',  amount_subunit:  50000, currency: 'TWD' })

    const r = await callSave(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(200)

    const deal = await getDeal(reqId)
    expect(deal.total_amount_subunit).toBe(500000)
    expect(deal.refunded_amount_subunit).toBe(50000)
    expect(deal.currency).toBe('TWD')
    expect(JSON.parse(deal.payment_intent_ids).sort()).toEqual([i1, i2, i3].sort())
  })

  it('重複保存第二次 → 409 INVALID_STATUS（atomic lock 已搶到 deal；deals 只一筆）', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const reqId = await seedReq()
    const tok = await tokenFor(aid, 'admin')

    const r1 = await callSave(tok, reqId)
    expect(r1.status).toBe(200)

    const r2 = await callSave(tok, reqId)
    expect(r2.status).toBe(409)
    expect(r2.body.code).toBe('INVALID_STATUS')
    expect(r2.body.actual_status).toBe('deal')

    const dealCount = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM deals WHERE source_requisition_id = ?`).bind(reqId).first()
    expect(dealCount.n).toBe(1)
  })

  it('notes 超過 500 字 → 截斷', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const reqId = await seedReq()
    const longNotes = 'x'.repeat(800)
    const r = await callSave(await tokenFor(aid, 'admin'), reqId, { notes: longNotes })
    expect(r.status).toBe(200)
    const deal = await getDeal(reqId)
    expect(deal.notes.length).toBe(500)
  })
})

// ── delete ──────────────────────────────────────────────────────────

describe('POST /api/admin/requisitions/:id/delete', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒帶 token → 401 UNAUTHORIZED', async () => {
    const reqId = await seedReq()
    const r = await callDelete(null, reqId)
    expect(r.status).toBe(401)
    expect(r.body.code).toBe('UNAUTHORIZED')
  })

  it('player → 403 INSUFFICIENT_ROLE', async () => {
    const { id: aid } = await seedUser({ email: 'p@x' })
    const reqId = await seedReq()
    const r = await callDelete(await tokenFor(aid, 'player'), reqId)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_ROLE')
  })

  it('id 不存在 → 404 REQUISITION_NOT_FOUND', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const r = await callDelete(await tokenFor(aid, 'admin'), 999999)
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('REQUISITION_NOT_FOUND')
  })

  it('已 soft-deleted → 404', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const reqId = await seedReq({ deleted_at: '2026-05-01T00:00:00Z' })
    const r = await callDelete(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(404)
  })

  it('FK 主路徑：有 succeeded 未退款 intent → 409 HAS_UNREFUNDED_PAYMENT', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ user_id: uid })
    const intentId = await seedIntent({
      user_id: uid, requisition_id: reqId, status: 'succeeded',
      amount_subunit: 100000, currency: 'TWD',
    })
    const r = await callDelete(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('HAS_UNREFUNDED_PAYMENT')
    expect(r.body.intent_id).toBe(intentId)
    expect(r.body.amount_subunit).toBe(100000)
    expect(r.body.currency).toBe('TWD')

    // 沒被刪
    const reqRow = await getReq(reqId)
    expect(reqRow.deleted_at).toBeNull()
  })

  it('legacy fallback：FK NULL 但 metadata.requisition_id 指向本 id → 409 HAS_UNREFUNDED_PAYMENT (P2-5)', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ user_id: uid })
    // 老資料：FK 為 NULL，只在 metadata 帶 pointer
    const intentId = await seedIntent({
      user_id: uid, requisition_id: null, status: 'succeeded',
      amount_subunit: 50000, currency: 'TWD',
      metadata: JSON.stringify({ requisition_id: reqId }),
    })
    const r = await callDelete(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('HAS_UNREFUNDED_PAYMENT')
    expect(r.body.intent_id).toBe(intentId)
  })

  it('refunded intent 不擋（已退款 → 允許刪）', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ user_id: uid })
    await seedIntent({ user_id: uid, requisition_id: reqId, status: 'refunded', amount_subunit: 100000, currency: 'TWD' })
    const r = await callDelete(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
  })

  it.each([
    ['pending'], ['deal'], ['revoked'], ['refund_pending'],
  ])('任意 status=%s 都可刪（hard 清單管理）', async (status) => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ user_id: uid, status })
    const r = await callDelete(await tokenFor(aid, 'admin'), reqId)
    expect(r.status).toBe(200)
    expect(r.body.id).toBe(reqId)

    const reqRow = await getReq(reqId)
    expect(reqRow.deleted_at).not.toBeNull()
    expect(reqRow.status).toBe(status)  // soft delete 不改 status，只設 deleted_at
  })

  it('happy 寫 audit critical + mode=soft_delete + admin_user_id + original_status', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ user_id: uid, status: 'deal' })
    const r = await callDelete(await tokenFor(aid, 'admin'), reqId, { notes: 'cleanup' })
    expect(r.status).toBe(200)

    const audits = await getAuditEvents('requisition.admin_deleted')
    expect(audits.length).toBe(1)
    expect(audits[0].severity).toBe('critical')
    expect(audits[0].user_id).toBe(uid)
    expect(audits[0].data.requisition_id).toBe(reqId)
    expect(audits[0].data.original_status).toBe('deal')
    expect(audits[0].data.admin_user_id).toBe(aid)
    expect(audits[0].data.mode).toBe('soft_delete')
    expect(audits[0].data.notes).toBe('cleanup')
  })

  it('notes 超過 500 字 → 截斷', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: uid } = await seedUser({ email: 'u@x' })
    const reqId = await seedReq({ user_id: uid })
    const longNotes = 'y'.repeat(800)
    const r = await callDelete(await tokenFor(aid, 'admin'), reqId, { notes: longNotes })
    expect(r.status).toBe(200)
    const audits = await getAuditEvents('requisition.admin_deleted')
    expect(audits[0].data.notes.length).toBe(500)
  })
})
