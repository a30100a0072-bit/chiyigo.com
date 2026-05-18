/**
 * Phase F-2 wave 4 — admin 對帳 + 退款 整合測試
 *
 *  - GET /api/admin/payments/intents：列表 + filter + 越權 + totals
 *  - POST /api/admin/payments/intents/:id/refund：step-up 守門 + ECPay refund call + status
 */

import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt'
import { SCOPES } from '../../functions/utils/scopes'
import {
  createPaymentIntent, getPaymentIntent, PAYMENT_STATUS,
} from '../../functions/utils/payments'
import { onRequestGet  as listHandler   } from '../../functions/api/admin/payments/intents.js'
import { onRequestPost as refundHandler } from '../../functions/api/admin/payments/intents/[id]/refund.js'
import { onRequestPost as rejectHandler  } from '../../functions/api/admin/requisition-refund/[id]/reject.js'
import { onRequestPost as approveHandler } from '../../functions/api/admin/requisition-refund/[id]/approve.js'
import { onRequestPost as deleteHandler  } from '../../functions/api/admin/payments/intents/[id]/delete'
import { onRequestGet  as aggregateHandler } from '../../functions/api/admin/payments/aggregate'
import { onRequestGet  as dlqHandler       } from '../../functions/api/admin/payments/webhook-dlq'

// 對齊 functions/utils/payment-vendors/ecpay.ts 的新 SANDBOX_CREDS
// 舊 2000132/5294y0726k67Nck0/v77hoKGq4kWxNNIS 已被綠界停用
const _SANDBOX = {
  MerchantID: '3002607',
  HashKey:    'pwFHCqoQZGmho4w6',
  HashIV:     'EkRm7iFT261dpevs',
}

async function adminToken(userId) {
  return signJwt(
    { sub: String(userId), email: 'a@x', role: 'admin', status: 'active', ver: 0,
      scope: 'read:profile write:profile admin:audit admin:payments' },
    '15m', env, { audience: 'chiyigo' },
  )
}

async function playerToken(userId) {
  return signJwt(
    { sub: String(userId), email: 'p@x', role: 'player', status: 'active', ver: 0,
      scope: 'read:profile write:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

async function dlqStepUpToken(userId, forAction = 'view_webhook_dlq') {
  return signJwt(
    { sub: String(userId), role: 'admin', status: 'active', ver: 0,
      scope: SCOPES.ELEVATED_PAYMENT, for_action: forAction,
      amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
    '5m', env,
  )
}

async function adminStepUpToken(userId, forAction = 'refund_payment') {
  // step-up token 真實 shape：scope **只有** elevated:payment（不帶 admin:*）；
  // role=admin → effectiveScopesFromJwt fallback 自動補 admin:payments。
  return signJwt(
    { sub: String(userId), role: 'admin', status: 'active', ver: 0,
      scope: SCOPES.ELEVATED_PAYMENT,
      for_action: forAction,
      amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
    '5m', env,
  )
}

function bearer(method, url, token, body = null) {
  return new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('GET /api/admin/payments/intents', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('player 無 admin:payments → 403', async () => {
    const u = await seedUser({ email: 'np@x' })
    const tok = await playerToken(u.id)
    const resp = await listHandler({ request: bearer('GET', 'http://x/', tok), env })
    expect(resp.status).toBe(403)
  })

  it('[Codex r5 P2] 預設過濾 soft-deleted；?include_deleted=1 才看得到', async () => {
    const a = await seedUser({ email: 'admin-sd@x', role: 'admin' })
    const u = await seedUser({ email: 'u-sd@x' })
    const liveId = await createPaymentIntent(env, { user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'live', currency: 'TWD', amount_subunit: 100, status: PAYMENT_STATUS.SUCCEEDED })
    const delId  = await createPaymentIntent(env, { user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'del',  currency: 'TWD', amount_subunit: 200, status: PAYMENT_STATUS.SUCCEEDED })
    await env.chiyigo_db
      .prepare(`UPDATE payment_intents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .bind(delId).run()
    const tok = await adminToken(a.id)

    const r1 = await listHandler({ request: bearer('GET', 'http://x/', tok), env })
    const b1 = await r1.json()
    expect(b1.total).toBe(1)
    expect(b1.totals.sum_subunit_succeeded).toBe(100)
    expect(b1.rows.map(r => r.id)).toEqual([liveId])

    const r2 = await listHandler({ request: bearer('GET', 'http://x/?include_deleted=1', tok), env })
    const b2 = await r2.json()
    expect(b2.total).toBe(2)
    expect(b2.totals.sum_subunit_succeeded).toBe(300)

    // Codex r7 P2：include_deleted=1 必須記進 audit filters
    const audit = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE event_type = 'admin.payments.intents.read' ORDER BY id DESC LIMIT 1`)
      .first()
    const data = JSON.parse(audit.event_data)
    expect(data.filters.include_deleted).toBe(true)
  })

  it('admin → 200 + 列出全部 intent', async () => {
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const u1 = await seedUser({ email: 'u1@x' })
    const u2 = await seedUser({ email: 'u2@x' })
    await createPaymentIntent(env, { user_id: u1.id, vendor: 'ecpay', vendor_intent_id: 'a', currency: 'TWD', amount_subunit: 100, status: PAYMENT_STATUS.SUCCEEDED })
    await createPaymentIntent(env, { user_id: u2.id, vendor: 'ecpay', vendor_intent_id: 'b', currency: 'TWD', amount_subunit: 200, status: PAYMENT_STATUS.PENDING })
    const tok = await adminToken(a.id)
    const resp = await listHandler({ request: bearer('GET', 'http://x/', tok), env })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.total).toBe(2)
    expect(body.totals.count_by_status.succeeded).toBe(1)
    expect(body.totals.count_by_status.pending).toBe(1)
    expect(body.totals.sum_subunit_succeeded).toBe(100)
  })

  it('?status=succeeded 過濾 + sum 正確', async () => {
    const a = await seedUser({ email: 'a2@x', role: 'admin' })
    const u = await seedUser({ email: 'u@x' })
    await createPaymentIntent(env, { user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'x1', currency: 'TWD', amount_subunit: 1000, status: PAYMENT_STATUS.SUCCEEDED })
    await createPaymentIntent(env, { user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'x2', currency: 'TWD', amount_subunit: 500,  status: PAYMENT_STATUS.SUCCEEDED })
    await createPaymentIntent(env, { user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'x3', currency: 'TWD', amount_subunit: 300,  status: PAYMENT_STATUS.FAILED })
    const tok = await adminToken(a.id)
    const resp = await listHandler({ request: bearer('GET', 'http://x/?status=succeeded', tok), env })
    const body = await resp.json()
    expect(body.total).toBe(2)
    expect(body.totals.sum_subunit_succeeded).toBe(1500)
    expect(body.rows.every(r => r.status === 'succeeded')).toBe(true)
  })

  it('?user_id=N 過濾', async () => {
    const a = await seedUser({ email: 'a3@x', role: 'admin' })
    const u1 = await seedUser({ email: 'u1@x' })
    const u2 = await seedUser({ email: 'u2@x' })
    await createPaymentIntent(env, { user_id: u1.id, vendor: 'ecpay', vendor_intent_id: 'q1', currency: 'TWD' })
    await createPaymentIntent(env, { user_id: u2.id, vendor: 'ecpay', vendor_intent_id: 'q2', currency: 'TWD' })
    const tok = await adminToken(a.id)
    const resp = await listHandler({ request: bearer('GET', `http://x/?user_id=${u1.id}`, tok), env })
    const body = await resp.json()
    expect(body.total).toBe(1)
    expect(body.rows[0].user_id).toBe(u1.id)
  })

  it('vendor=ecpay + date range filters rows and totals', async () => {
    const a = await seedUser({ email: 'a4@x', role: 'admin' })
    const u = await seedUser({ email: 'u4@x' })
    const inRange = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'date_in',
      currency: 'TWD', amount_subunit: 100, status: PAYMENT_STATUS.SUCCEEDED,
    })
    const outRange = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'date_out',
      currency: 'TWD', amount_subunit: 200, status: PAYMENT_STATUS.SUCCEEDED,
    })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'mock_in',
      currency: 'TWD', amount_subunit: 300, status: PAYMENT_STATUS.SUCCEEDED,
    })
    await env.chiyigo_db.prepare(`UPDATE payment_intents SET created_at = ? WHERE id = ?`)
      .bind('2026-01-15 00:00:00', inRange).run()
    await env.chiyigo_db.prepare(`UPDATE payment_intents SET created_at = ? WHERE id = ?`)
      .bind('2026-02-15 00:00:00', outRange).run()

    const tok = await adminToken(a.id)
    const resp = await listHandler({
      request: bearer('GET', 'http://x/?vendor=ecpay&from=2026-01-01&to=2026-02-01', tok),
      env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.total).toBe(1)
    expect(body.rows[0].vendor_intent_id).toBe('date_in')
    expect(body.totals.sum_subunit_succeeded).toBe(100)
  })
})

describe('GET /api/admin/payments/aggregate', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('player 無金流 scope → 403', async () => {
    const u = await seedUser({ email: 'agg-np@x' })
    const tok = await playerToken(u.id)
    const resp = await aggregateHandler({ request: bearer('GET', 'http://x/', tok), env })
    expect(resp.status).toBe(403)
  })

  it('invalid status → 400 INVALID_STATUS', async () => {
    const a = await seedUser({ email: 'agg-a1@x', role: 'admin' })
    const tok = await adminToken(a.id)
    const resp = await aggregateHandler({
      request: bearer('GET', 'http://x/?status=bogus', tok), env,
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.code).toBe('INVALID_STATUS')
  })

  it('預設過濾 soft-deleted + refunded bucket 對齊 main bucket', async () => {
    const a = await seedUser({ email: 'agg-a2@x', role: 'admin' })
    const u = await seedUser({ email: 'agg-u@x' })

    // 兩筆 succeeded（同 bucket）+ 一筆 soft-deleted succeeded（不該算）+ 一筆 refunded
    const okA = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'agg_ok_a',
      currency: 'TWD', amount_subunit: 100, status: PAYMENT_STATUS.SUCCEEDED,
    })
    const okB = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'agg_ok_b',
      currency: 'TWD', amount_subunit: 250, status: PAYMENT_STATUS.SUCCEEDED,
    })
    const delId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'agg_del',
      currency: 'TWD', amount_subunit: 9000, status: PAYMENT_STATUS.SUCCEEDED,
    })
    const refId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'agg_ref',
      currency: 'TWD', amount_subunit: 80, status: PAYMENT_STATUS.REFUNDED,
    })
    // 鎖到同一天 bucket（台北 +8h 後仍為 2026-03-15）
    for (const id of [okA, okB, delId, refId]) {
      await env.chiyigo_db
        .prepare(`UPDATE payment_intents SET created_at = ? WHERE id = ?`)
        .bind('2026-03-15 04:00:00', id).run()
    }
    await env.chiyigo_db
      .prepare(`UPDATE payment_intents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .bind(delId).run()

    const tok = await adminToken(a.id)
    const resp = await aggregateHandler({ request: bearer('GET', 'http://x/', tok), env })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.period).toBe('daily')
    expect(body.status).toBe('succeeded')
    expect(body.buckets).toHaveLength(1)
    const bucket = body.buckets[0]
    expect(bucket.bucket).toBe('2026-03-15')
    expect(bucket.count).toBe(2)                  // soft-deleted 排除
    expect(bucket.sum_subunit).toBe(350)          // 100 + 250（不含 9000）
    expect(bucket.refunded_count).toBe(1)         // refunded bucket join 對齊
    expect(bucket.refunded_sum_subunit).toBe(80)
  })
})

describe('GET /api/admin/payments/webhook-dlq', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  /**
   * @param {{ vendor?: string; eventId: string; replayed?: boolean }} args
   */
  async function seedDlq({ vendor = 'ecpay', eventId, replayed = false }) {
    const replayedSql = replayed ? `strftime('%Y-%m-%dT%H:%M:%fZ','now')` : `NULL`
    await env.chiyigo_db.prepare(
      `INSERT INTO payment_webhook_dlq
         (vendor, event_id, vendor_intent_id, raw_body, payload_hash,
          error_stage, error_message, http_status_returned, replayed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${replayedSql})`,
    ).bind(vendor, eventId, `intent_${eventId}`, `{"raw":"${eventId}"}`,
           `h_${eventId}`, 'parse', 'boom', 200).run()
  }

  it('沒 step-up token → 401/403', async () => {
    const a = await seedUser({ email: 'dlq-no-step@x', role: 'admin' })
    const tok = await adminToken(a.id) // 一般 access_token
    const resp = await dlqHandler({ request: bearer('GET', 'http://x/', tok), env })
    expect([401, 403]).toContain(resp.status)
  })

  it('step-up 但缺 admin:payments scope → 403 INSUFFICIENT_SCOPE', async () => {
    const a = await seedUser({ email: 'dlq-noscope@x' })
    // step-up token 真實 shape：scope 僅 elevated:payment + role=player（fallback 不補 admin:payments）
    const tok = await signJwt(
      { sub: String(a.id), role: 'player', status: 'active', ver: 0,
        scope: SCOPES.ELEVATED_PAYMENT, for_action: 'view_webhook_dlq',
        amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
      '5m', env,
    )
    const resp = await dlqHandler({ request: bearer('GET', 'http://x/', tok), env })
    expect(resp.status).toBe(403)
    const body = await resp.json()
    expect(body.code).toBe('INSUFFICIENT_SCOPE')
  })

  it('pending/vendor/limit 過濾 + critical read audit', async () => {
    const a = await seedUser({ email: 'dlq-ok@x', role: 'admin' })
    await seedDlq({ vendor: 'ecpay', eventId: 'e1' })
    await seedDlq({ vendor: 'ecpay', eventId: 'e2' })
    await seedDlq({ vendor: 'mock',  eventId: 'm1' })
    await seedDlq({ vendor: 'ecpay', eventId: 'replayed1', replayed: true })

    // step-up token 走 atomic consumeJtiOnce → 每次呼叫必須是新 token
    // 預設 pending=1 vendor 不限 → 排除 replayed1，剩 3
    const r1 = await dlqHandler({
      request: bearer('GET', 'http://x/', await dlqStepUpToken(a.id)), env,
    })
    expect(r1.status).toBe(200)
    const b1 = await r1.json()
    expect(b1.rows.length).toBe(3)
    expect(b1.rows.every(r => r.replayed_at === null)).toBe(true)

    // vendor=ecpay → 只剩 e1/e2
    const r2 = await dlqHandler({
      request: bearer('GET', 'http://x/?vendor=ecpay', await dlqStepUpToken(a.id)), env,
    })
    const b2 = await r2.json()
    expect(b2.rows.map(r => r.event_id).sort()).toEqual(['e1', 'e2'])

    // limit=1 → 只回 1 筆
    const r3 = await dlqHandler({
      request: bearer('GET', 'http://x/?limit=1', await dlqStepUpToken(a.id)), env,
    })
    expect((await r3.json()).rows.length).toBe(1)

    // pending=0 → 包含 replayed1
    const r4 = await dlqHandler({
      request: bearer('GET', 'http://x/?pending=0', await dlqStepUpToken(a.id)), env,
    })
    const b4 = await r4.json()
    expect(b4.rows.length).toBe(4)

    // T14 critical read audit 寫入（每次讀都該寫，pending=0 那次是最後一發）
    const audit = await env.chiyigo_db
      .prepare(`SELECT severity, event_data FROM audit_log
                 WHERE event_type = 'admin.payment_webhook_dlq.read'
                 ORDER BY id DESC LIMIT 1`)
      .first()
    expect(audit.severity).toBe('critical')
    const data = JSON.parse(audit.event_data)
    expect(data.filters.pending).toBe(false)
    expect(data.result_count).toBe(4)
  })
})

describe('POST /api/admin/payments/intents/:id/refund', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })
  afterEach(() => { vi.unstubAllGlobals() })

  // 建一個 succeeded intent + 對應 webhook event（提供 TradeNo）
  async function setupSucceededIntent(userId, tradeNo = 'TN_R1', amount = 500) {
    const id = await createPaymentIntent(env, {
      user_id: userId, vendor: 'ecpay', vendor_intent_id: 'mtn_R_' + tradeNo,
      currency: 'TWD', amount_subunit: amount, status: PAYMENT_STATUS.SUCCEEDED,
    })
    await env.chiyigo_db.prepare(
      `INSERT INTO payment_webhook_events (vendor, event_id, intent_id, user_id, status_to)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind('ecpay', tradeNo, id, userId, PAYMENT_STATUS.SUCCEEDED).run()
    return id
  }

  // Codex r10 P2-7：ECPay DoAction 成功回應必帶 MerchantID/MerchantTradeNo/TradeNo
  // 三個身分欄位，否則 ecpayRefund() 視為 VERIFY_FAIL。mock 從 request body 抽出
  // 我方送出的 trade no 並回 echo（mirrors real ECPay behavior）。
  function mockEcpayRefund({ rtnCode = '1', rtnMsg = '退款成功', stripIdentity = false } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).includes('/CreditDetail/DoAction')) {
        const reqParams = Object.fromEntries(new URLSearchParams(init?.body ?? ''))
        const fields = stripIdentity
          ? { RtnCode: rtnCode, RtnMsg: rtnMsg }
          : {
              RtnCode:         rtnCode,
              RtnMsg:          rtnMsg,
              MerchantID:      reqParams.MerchantID,
              MerchantTradeNo: reqParams.MerchantTradeNo,
              TradeNo:         reqParams.TradeNo,
            }
        return new Response(new URLSearchParams(fields).toString(), {
          status: 200, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      }
      return new Response('', { status: 404 })
    }))
  }

  it('沒 step-up token → 401/403', async () => {
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const u = await seedUser({ email: 'u@x' })
    const id = await setupSucceededIntent(u.id)
    const tok = await adminToken(a.id)  // 一般 access_token，不是 step-up
    const resp = await refundHandler({
      request: bearer('POST', 'http://x/', tok, { reason: 'test' }),
      env, params: { id: String(id) },
    })
    expect([401, 403]).toContain(resp.status)
  })

  it('step-up for_action 不符 → 403 STEP_UP_ACTION_MISMATCH', async () => {
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const u = await seedUser({ email: 'u@x' })
    const id = await setupSucceededIntent(u.id)
    const tok = await adminStepUpToken(a.id, 'change_password')
    const resp = await refundHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(id) },
    })
    expect(resp.status).toBe(403)
  })

  it('step-up 但 scope 不含 admin:payments → 403', async () => {
    const a = await seedUser({ email: 'a@x' })
    const u = await seedUser({ email: 'u@x' })
    const id = await setupSucceededIntent(u.id)
    // 故意產 step-up token 不帶 admin:payments
    const tok = await signJwt(
      { sub: String(a.id), role: 'player', status: 'active', ver: 0,
        scope: SCOPES.ELEVATED_PAYMENT, for_action: 'refund_payment',
        amr: ['pwd','totp'], acr: 'urn:chiyigo:loa:2' },
      '5m', env,
    )
    const resp = await refundHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(id) },
    })
    expect(resp.status).toBe(403)
  })

  it('intent 不存在 → 404', async () => {
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminStepUpToken(a.id)
    const resp = await refundHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: '99999' },
    })
    expect(resp.status).toBe(404)
  })

  it('intent status != succeeded → 409 INVALID_STATUS', async () => {
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const u = await seedUser({ email: 'u@x' })
    const id = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'pending_x',
      currency: 'TWD', amount_subunit: 100,
    })
    const tok = await adminStepUpToken(a.id)
    const resp = await refundHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(id) },
    })
    expect(resp.status).toBe(409)
    const body = await resp.json()
    expect(body.code).toBe('INVALID_STATUS')
  })

  it('happy path → ECPay refund OK → status=refunded + critical audit', async () => {
    mockEcpayRefund({ rtnCode: '1', rtnMsg: 'OK' })
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const u = await seedUser({ email: 'u@x' })
    const id = await setupSucceededIntent(u.id, 'TN_HAPPY', 800)
    const tok = await adminStepUpToken(a.id)
    const resp = await refundHandler({
      request: bearer('POST', 'http://x/', tok, { reason: 'cust_request' }),
      env, params: { id: String(id) },
    })
    expect(resp.status).toBe(200)
    const intent = await getPaymentIntent(env, { id })
    expect(intent.status).toBe(PAYMENT_STATUS.REFUNDED)

    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'payment.refund.success' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')
  })

  it('[Codex r10 P2-7] ECPay 回裸 RtnCode=1 沒身分欄位 → VERIFY_FAIL，不放行假退款', async () => {
    mockEcpayRefund({ rtnCode: '1', rtnMsg: 'OK', stripIdentity: true })
    const a = await seedUser({ email: 'verify-a@x', role: 'admin' })
    const u = await seedUser({ email: 'verify-u@x' })
    const id = await setupSucceededIntent(u.id, 'TN_VERIFY', 600)
    const tok = await adminStepUpToken(a.id)
    const resp = await refundHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(id) },
    })
    expect(resp.status).toBe(400)
    const j = await resp.json()
    expect(j.code).toBe('ECPAY_REFUND_FAILED')
    // rtn_code 保留 PSP 原值（debug 用）；驗證失敗訊號在 rtn_msg
    expect(j.rtn_msg).toMatch(/verification failed.*success_missing_identity_fields/)
    // status 不能變 refunded（守住）
    const intent = await getPaymentIntent(env, { id })
    expect(intent.status).toBe(PAYMENT_STATUS.SUCCEEDED)
  })

  it('ECPay 退款失敗 → 400 + audit warn + status 不變', async () => {
    mockEcpayRefund({ rtnCode: '10100248', rtnMsg: '已超過可退款期限' })
    const a = await seedUser({ email: 'a@x', role: 'admin' })
    const u = await seedUser({ email: 'u@x' })
    const id = await setupSucceededIntent(u.id, 'TN_FAIL')
    const tok = await adminStepUpToken(a.id)
    const resp = await refundHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(id) },
    })
    expect(resp.status).toBe(400)
    const intent = await getPaymentIntent(env, { id })
    expect(intent.status).toBe(PAYMENT_STATUS.SUCCEEDED)

    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'payment.refund.fail'`,
    ).first()
    expect(audit).not.toBeNull()
  })
})

describe('[Codex r1 P2-8] admin anonymize archives metadata as parseable JSON', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('archive original_metadata 是可 parse 的 JSON，不是 [object Object]', async () => {
    const a = await seedUser({ email: 'archive-a@x', role: 'admin' })
    const u = await seedUser({ email: 'archive-u@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'TN_ARCHIVE',
      currency: 'TWD', amount_subunit: 800, status: PAYMENT_STATUS.SUCCEEDED,
      metadata: { trade_no: 'TN_ARCHIVE_REAL', payment_info: { method: 'atm', v_account: '99988' } },
    })
    const tok = await adminStepUpToken(a.id, 'delete_payment')
    const resp = await deleteHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(intentId) },
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.mode).toBe('anonymize')

    const archive = await env.chiyigo_db
      .prepare(`SELECT original_metadata FROM payment_metadata_archive WHERE intent_id = ?`)
      .bind(intentId).first()
    expect(archive).not.toBeNull()
    expect(archive.original_metadata).toBeTypeOf('string')
    expect(archive.original_metadata).not.toBe('[object Object]')
    // 必須能 round-trip parse 回原物件
    const parsed = JSON.parse(archive.original_metadata)
    expect(parsed.trade_no).toBe('TN_ARCHIVE_REAL')
    expect(parsed.payment_info.v_account).toBe('99988')
  })
})

describe('POST /api/admin/payments/intents/:id/delete', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 step-up token → 401/403', async () => {
    const a = await seedUser({ email: 'del-no-step@x', role: 'admin' })
    const u = await seedUser({ email: 'del-u@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'TN_DEL_NS',
      currency: 'TWD', amount_subunit: 100, status: PAYMENT_STATUS.PENDING,
    })
    const tok = await adminToken(a.id) // 一般 admin access token，不是 step-up
    const resp = await deleteHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(intentId) },
    })
    expect([401, 403]).toContain(resp.status)
  })

  it('pending intent → 200 soft_delete + deleted_at 寫入（row 保留給 webhook orphan 偵測）', async () => {
    const a = await seedUser({ email: 'del-pending-a@x', role: 'admin' })
    const u = await seedUser({ email: 'del-pending-u@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'TN_DEL_PEND',
      currency: 'TWD', amount_subunit: 100, status: PAYMENT_STATUS.PENDING,
    })
    const tok = await adminStepUpToken(a.id, 'delete_payment')
    const resp = await deleteHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(intentId) },
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.mode).toBe('soft_delete')

    // P0-1 invariant：row 仍存在（給 PSP race 補送 webhook 找得到）+ deleted_at 已寫
    const row = await env.chiyigo_db
      .prepare(`SELECT status, deleted_at FROM payment_intents WHERE id = ?`)
      .bind(intentId).first()
    expect(row).not.toBeNull()
    expect(row.status).toBe(PAYMENT_STATUS.PENDING) // status 不改
    expect(row.deleted_at).not.toBeNull()

    // 沒有 anonymize archive（soft_delete 路徑不應落 archive）
    const archive = await env.chiyigo_db
      .prepare(`SELECT 1 FROM payment_metadata_archive WHERE intent_id = ?`)
      .bind(intentId).first()
    expect(archive).toBeNull()
  })

  it('refunded intent → 409 STATUS_LOCKED + 0 anonymize archive', async () => {
    const a = await seedUser({ email: 'del-refunded-a@x', role: 'admin' })
    const u = await seedUser({ email: 'del-refunded-u@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'TN_DEL_REF',
      currency: 'TWD', amount_subunit: 100, status: PAYMENT_STATUS.REFUNDED,
      metadata: { trade_no: 'TN_DEL_REF_REAL' },
    })
    const tok = await adminStepUpToken(a.id, 'delete_payment')
    const resp = await deleteHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(intentId) },
    })
    expect(resp.status).toBe(409)
    const body = await resp.json()
    expect(body.code).toBe('STATUS_LOCKED')
    expect(body.status).toBe(PAYMENT_STATUS.REFUNDED)

    // refunded 不可被任何形式改動：metadata 不清、無 archive row
    const row = await env.chiyigo_db
      .prepare(`SELECT metadata, deleted_at FROM payment_intents WHERE id = ?`)
      .bind(intentId).first()
    expect(row.deleted_at).toBeNull()
    expect(JSON.parse(row.metadata).trade_no).toBe('TN_DEL_REF_REAL')
    const archive = await env.chiyigo_db
      .prepare(`SELECT 1 FROM payment_metadata_archive WHERE intent_id = ?`)
      .bind(intentId).first()
    expect(archive).toBeNull()
  })
})

describe('[Codex r1 P1-6] POST /api/admin/requisition-refund/:id/reject atomic CAS', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })
  // Codex r9 P2：r8 P2-2 approve final_cas_lost 測試用 vi.stubGlobal('fetch') 模擬
  // ECPay refund 回應；single-runtime workers config 共用 global fetch，必須 reset
  // 避免後續測試吃到 stub。
  afterEach(() => { vi.unstubAllGlobals() })

  async function setupRefundRequest(uid, intentId, status = 'pending') {
    const row = await env.chiyigo_db
      .prepare(`INSERT INTO requisition_refund_request
                  (user_id, intent_id, requisition_id, reason, status, created_at)
                VALUES (?, ?, NULL, 'test', ?, datetime('now'))
                RETURNING id`)
      .bind(uid, intentId, status).first()
    return row.id
  }

  it('reject 已 rejected 的 rr → 409 INVALID_STATUS（atomic CAS 不會悄悄改寫）', async () => {
    const a = await seedUser({ email: 'reject-a@x', role: 'admin' })
    const u = await seedUser({ email: 'reject-u@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'TN_R1', currency: 'TWD',
      amount_subunit: 100, status: PAYMENT_STATUS.SUCCEEDED,
    })
    const rrId = await setupRefundRequest(u.id, intentId, 'rejected')
    const tok = await adminStepUpToken(a.id, 'reject_requisition_refund')
    const resp = await rejectHandler({
      request: bearer('POST', 'http://x/', tok, { admin_note: 'no' }),
      env, params: { id: String(rrId) },
    })
    expect(resp.status).toBe(409)
    const j = await resp.json()
    expect(j.code).toBe('INVALID_STATUS')
    expect(j.actual_status).toBe('rejected')
  })

  it('[Codex r8 P2] approve final CAS lost → 202 RECONCILIATION + final_cas_lost audit，不寫 approved audit', async () => {
    const a = await seedUser({ email: 'approve-rec@x', role: 'admin' })
    const u = await seedUser({ email: 'approve-recu@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'TN_REC', currency: 'TWD',
      amount_subunit: 500, status: PAYMENT_STATUS.SUCCEEDED,
    })
    // 提供 trade_no（approve.js 需要拿 TradeNo 打 ECPay）
    await env.chiyigo_db.prepare(
      `INSERT INTO payment_webhook_events (vendor, event_id, intent_id, user_id, status_to)
       VALUES ('ecpay', 'TRADE_REC', ?, ?, 'succeeded')`,
    ).bind(intentId, u.id).run()
    const rrId = await setupRefundRequest(u.id, intentId, 'pending')

    // ECPay 回成功，但在回應前 race-tamper rr 讓 final CAS 落空
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).includes('/CreditDetail/DoAction')) {
        await env.chiyigo_db
          .prepare(`UPDATE requisition_refund_request SET status='approved' WHERE id = ?`)
          .bind(rrId).run()
        // Codex r10 P2-7：成功回應要回身分欄位給 ecpayRefund() verify 通過
        const reqParams = Object.fromEntries(new URLSearchParams(init?.body ?? ''))
        const fields = {
          RtnCode: '1', RtnMsg: 'OK',
          MerchantID: reqParams.MerchantID,
          MerchantTradeNo: reqParams.MerchantTradeNo,
          TradeNo: reqParams.TradeNo,
        }
        return new Response(new URLSearchParams(fields).toString(), {
          status: 200, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      }
      return new Response('', { status: 404 })
    }))

    const tok = await adminStepUpToken(a.id, 'approve_requisition_refund')
    const resp = await approveHandler({
      request: bearer('POST', 'http://x/', tok, {}),
      env, params: { id: String(rrId) },
    })
    expect(resp.status).toBe(202)
    const body = await resp.json()
    expect(body.ok).toBe(false)
    expect(body.code).toBe('REFUND_RECONCILIATION_REQUIRED')

    // final_cas_lost critical audit 寫了；approved audit 沒寫
    const lost = await env.chiyigo_db
      .prepare(`SELECT 1 FROM audit_log WHERE event_type = 'requisition.refund.final_cas_lost'`)
      .first()
    expect(lost).not.toBeNull()
    const approved = await env.chiyigo_db
      .prepare(`SELECT 1 FROM audit_log WHERE event_type = 'requisition.refund.approved'`)
      .first()
    expect(approved).toBeNull()
  })

  it('reject 雙擊：第一次 200 / 第二次 409（CAS 守住，不會二次 audit）', async () => {
    const a = await seedUser({ email: 'reject-a2@x', role: 'admin' })
    const u = await seedUser({ email: 'reject-u2@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'ecpay', vendor_intent_id: 'TN_R2', currency: 'TWD',
      amount_subunit: 100, status: PAYMENT_STATUS.SUCCEEDED,
    })
    const rrId = await setupRefundRequest(u.id, intentId, 'pending')
    const tok1 = await adminStepUpToken(a.id, 'reject_requisition_refund')
    const r1 = await rejectHandler({
      request: bearer('POST', 'http://x/', tok1, { admin_note: 'first' }),
      env, params: { id: String(rrId) },
    })
    expect(r1.status).toBe(200)
    // step-up token 已 atomic consume → 第二次拿新 token（模擬 admin 重新 step-up）
    const tok2 = await adminStepUpToken(a.id, 'reject_requisition_refund')
    const r2 = await rejectHandler({
      request: bearer('POST', 'http://x/', tok2, { admin_note: 'second' }),
      env, params: { id: String(rrId) },
    })
    expect(r2.status).toBe(409)
    // admin_note 維持 first（第二次 CAS 落敗未覆寫）
    const rr = await env.chiyigo_db
      .prepare(`SELECT admin_note FROM requisition_refund_request WHERE id = ?`)
      .bind(rrId).first()
    expect(rr.admin_note).toBe('first')
  })
})
