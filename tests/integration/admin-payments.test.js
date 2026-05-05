/**
 * Phase F-2 wave 4 — admin 對帳 + 退款 整合測試
 *
 *  - GET /api/admin/payments/intents：列表 + filter + 越權 + totals
 *  - POST /api/admin/payments/intents/:id/refund：step-up 守門 + ECPay refund call + status
 */

import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { SCOPES } from '../../functions/utils/scopes.js'
import {
  createPaymentIntent, getPaymentIntent, PAYMENT_STATUS,
} from '../../functions/utils/payments.js'
import { onRequestGet  as listHandler   } from '../../functions/api/admin/payments/intents.js'
import { onRequestPost as refundHandler } from '../../functions/api/admin/payments/intents/[id]/refund.js'

const SANDBOX = {
  MerchantID: '2000132',
  HashKey:    '5294y0726k67Nck0',
  HashIV:     'v77hoKGq4kWxNNIS',
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

async function adminStepUpToken(userId, forAction = 'refund_payment') {
  // step-up token：scope=elevated:payment + admin:payments + for_action
  return signJwt(
    { sub: String(userId), role: 'admin', status: 'active', ver: 0,
      scope: `${SCOPES.ELEVATED_PAYMENT} ${SCOPES.ADMIN_PAYMENTS}`,
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

  function mockEcpayRefund({ rtnCode = '1', rtnMsg = '退款成功' } = {}) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/CreditDetail/DoAction')) {
        return new Response(`RtnCode=${rtnCode}&RtnMsg=${encodeURIComponent(rtnMsg)}`, {
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
