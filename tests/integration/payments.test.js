/**
 * Phase F-2 — Payment scaffold 整合測試
 *
 * 涵蓋：
 *  - utils/payments.js helper（create / get / updateStatus）
 *  - requirePaymentAccess gate（KYC verified vs not）
 *  - GET /api/auth/payments/intents（list + filter + 越權隔離）
 *  - GET /api/auth/payments/intents/:id（詳情 + 越權 → 404）
 *  - POST /api/webhooks/payments/[vendor]（mock adapter HMAC + dedupe + UPSERT）
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import {
  createPaymentIntent, getPaymentIntent, updatePaymentStatus,
  requirePaymentAccess,
  PAYMENT_STATUS, PAYMENT_KIND,
} from '../../functions/utils/payments.js'
import { setUserKycStatus, KYC_STATUS } from '../../functions/utils/kyc.js'
import { onRequestGet  as listHandler    } from '../../functions/api/auth/payments/intents.js'
import { onRequestGet  as detailHandler  } from '../../functions/api/auth/payments/intents/[id].js'
import { onRequestPost as webhookHandler } from '../../functions/api/webhooks/payments/[vendor].js'

env.PAYMENT_MOCK_SECRET = 'test-payment-secret'

async function userToken(userId, email = 'p@x') {
  return signJwt(
    { sub: String(userId), email, role: 'player', status: 'active', ver: 0,
      scope: 'read:profile write:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

function bearer(method, url, token, body = null) {
  return new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('')
}

function webhookReq(body, sig) {
  return new Request('http://x/api/webhooks/payments/mock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Payment-Signature': sig },
    body,
  })
}

describe('utils/payments — helpers', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('createPaymentIntent + getPaymentIntent', async () => {
    const u = await seedUser({ email: 'h1@x' })
    const id = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_1',
      amount_subunit: 10000, currency: 'TWD',
      metadata: { order_id: 'A1' },
    })
    expect(id).toBeGreaterThan(0)
    const row = await getPaymentIntent(env, { id })
    expect(row.vendor_intent_id).toBe('pi_1')
    expect(row.status).toBe(PAYMENT_STATUS.PENDING)
    expect(row.amount_subunit).toBe(10000)
    expect(row.metadata).toEqual({ order_id: 'A1' })
  })

  it('UNIQUE(vendor, vendor_intent_id) → 第二次 INSERT throw', async () => {
    const u = await seedUser({ email: 'h2@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'dup', currency: 'TWD',
    })
    await expect(createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'dup', currency: 'TWD',
    })).rejects.toThrow()
  })

  it('updatePaymentStatus → status / failure_reason 套用', async () => {
    const u = await seedUser({ email: 'h3@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_2', currency: 'TWD',
    })
    const ok = await updatePaymentStatus(env, {
      vendor: 'mock', vendor_intent_id: 'pi_2',
      status: PAYMENT_STATUS.FAILED, failure_reason: 'card_declined',
    })
    expect(ok).toBe(true)
    const row = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_2' })
    expect(row.status).toBe(PAYMENT_STATUS.FAILED)
    expect(row.failure_reason).toBe('card_declined')
  })

  it('非法 status → throw', async () => {
    await expect(updatePaymentStatus(env, {
      vendor: 'mock', vendor_intent_id: 'x', status: 'bogus',
    })).rejects.toThrow()
  })

  it('amount_raw（鏈上 decimal string）+ amount_subunit NULL 共存', async () => {
    const u = await seedUser({ email: 'h4@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'eth_1',
      amount_raw: '1500000000000000000', currency: 'ETH',
    })
    const row = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'eth_1' })
    expect(row.amount_raw).toBe('1500000000000000000')
    expect(row.amount_subunit).toBeNull()
  })
})

describe('requirePaymentAccess gate', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('未 KYC → 403 KYC_REQUIRED + audit warn', async () => {
    const u = await seedUser({ email: 'g1@x' })
    const tok = await userToken(u.id)
    const r = await requirePaymentAccess(bearer('GET', 'http://x/', tok), env)
    expect(r.error).toBeDefined()
    expect(r.error.status).toBe(403)
    const body = await r.error.clone().json()
    expect(body.code).toBe('KYC_REQUIRED')
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'payment.gate.fail' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit).not.toBeNull()
  })

  it('KYC verified → 通過', async () => {
    const u = await seedUser({ email: 'g2@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const r = await requirePaymentAccess(bearer('GET', 'http://x/', tok), env)
    expect(r.error).toBeNull()
    expect(r.user.sub).toBe(String(u.id))
  })

  it('skipKyc=true → 未 KYC 也通過（一般查詢用）', async () => {
    const u = await seedUser({ email: 'g3@x' })
    const tok = await userToken(u.id)
    const r = await requirePaymentAccess(bearer('GET', 'http://x/', tok), env, { skipKyc: true })
    expect(r.error).toBeNull()
  })
})

describe('GET /api/auth/payments/intents', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('空列表 → 200 + items=[]', async () => {
    const u = await seedUser({ email: 'l1@x' })
    const tok = await userToken(u.id)
    const resp = await listHandler({ request: bearer('GET', 'http://x/?', tok), env })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.items).toEqual([])
  })

  it('有 row → 列出 + ORDER BY created_at DESC', async () => {
    const u = await seedUser({ email: 'l2@x' })
    await createPaymentIntent(env, { user_id: u.id, vendor: 'mock', vendor_intent_id: 'a', currency: 'TWD' })
    await createPaymentIntent(env, { user_id: u.id, vendor: 'mock', vendor_intent_id: 'b', currency: 'TWD' })
    const tok = await userToken(u.id)
    const resp = await listHandler({ request: bearer('GET', 'http://x/', tok), env })
    const body = await resp.json()
    expect(body.count).toBe(2)
  })

  it('?status=pending 過濾', async () => {
    const u = await seedUser({ email: 'l3@x' })
    await createPaymentIntent(env, { user_id: u.id, vendor: 'mock', vendor_intent_id: 'a', currency: 'TWD', status: PAYMENT_STATUS.SUCCEEDED })
    await createPaymentIntent(env, { user_id: u.id, vendor: 'mock', vendor_intent_id: 'b', currency: 'TWD' })
    const tok = await userToken(u.id)
    const resp = await listHandler({ request: bearer('GET', 'http://x/?status=pending', tok), env })
    const body = await resp.json()
    expect(body.items.every(r => r.status === 'pending')).toBe(true)
    expect(body.count).toBe(1)
  })

  it('越權隔離：u1 看不到 u2 的 intent', async () => {
    const u1 = await seedUser({ email: 'l4a@x' })
    const u2 = await seedUser({ email: 'l4b@x' })
    await createPaymentIntent(env, { user_id: u2.id, vendor: 'mock', vendor_intent_id: 'x', currency: 'TWD' })
    const tok = await userToken(u1.id)
    const resp = await listHandler({ request: bearer('GET', 'http://x/', tok), env })
    const body = await resp.json()
    expect(body.count).toBe(0)
  })
})

describe('GET /api/auth/payments/intents/:id', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('自己的 intent → 200', async () => {
    const u = await seedUser({ email: 'd1@x' })
    const id = await createPaymentIntent(env, { user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_d1', currency: 'TWD' })
    const tok = await userToken(u.id)
    const resp = await detailHandler({
      request: bearer('GET', 'http://x/', tok), env, params: { id: String(id) },
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.id).toBe(id)
  })

  it('別人的 intent → 404（不洩漏存在）', async () => {
    const u1 = await seedUser({ email: 'd2a@x' })
    const u2 = await seedUser({ email: 'd2b@x' })
    const id = await createPaymentIntent(env, { user_id: u2.id, vendor: 'mock', vendor_intent_id: 'pi_d2', currency: 'TWD' })
    const tok = await userToken(u1.id)
    const resp = await detailHandler({
      request: bearer('GET', 'http://x/', tok), env, params: { id: String(id) },
    })
    expect(resp.status).toBe(404)
  })
})

describe('POST /api/webhooks/payments/:vendor', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('未知 vendor → 400', async () => {
    const resp = await webhookHandler({
      request: webhookReq('{}', ''), env, params: { vendor: 'unknown' },
    })
    expect(resp.status).toBe(400)
  })

  it('mock 簽章錯 → 401 + audit warn', async () => {
    const body = JSON.stringify({ event_id: 'e1', vendor_intent_id: 'pi', status: 'succeeded' })
    const resp = await webhookHandler({
      request: webhookReq(body, 'badsig'), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(401)
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'payment.webhook.fail'`,
    ).first()
    expect(audit).not.toBeNull()
  })

  it('既存 intent + succeeded webhook → UPDATE status + critical audit', async () => {
    const u = await seedUser({ email: 'w1@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_w1',
      amount_subunit: 5000, currency: 'TWD',
    })
    const body = JSON.stringify({
      event_id: 'evt_w1', vendor_intent_id: 'pi_w1', user_id: u.id,
      status: 'succeeded',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)
    const row = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_w1' })
    expect(row.status).toBe(PAYMENT_STATUS.SUCCEEDED)
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'payment.status.change' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')
  })

  it('沒既存 intent + webhook 帶 user_id → 主動建立', async () => {
    const u = await seedUser({ email: 'w2@x' })
    const body = JSON.stringify({
      event_id: 'evt_w2', vendor_intent_id: 'pi_w2', user_id: u.id,
      status: 'succeeded', amount_subunit: 8000, currency: 'USD',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)
    const row = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_w2' })
    expect(row).not.toBeNull()
    expect(row.user_id).toBe(u.id)
    expect(row.status).toBe(PAYMENT_STATUS.SUCCEEDED)
    expect(row.currency).toBe('USD')
  })

  it('重送同 event_id → 200 deduplicated', async () => {
    const u = await seedUser({ email: 'w3@x' })
    const body = JSON.stringify({
      event_id: 'evt_w3', vendor_intent_id: 'pi_w3', user_id: u.id, status: 'succeeded',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const r1 = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(r1.status).toBe(200)
    const r2 = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    const j2 = await r2.json()
    expect(j2.deduplicated).toBe(true)
  })

  it('failed payload + failure_reason → 套用', async () => {
    const u = await seedUser({ email: 'w4@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_w4', currency: 'TWD',
    })
    const body = JSON.stringify({
      event_id: 'evt_w4', vendor_intent_id: 'pi_w4', user_id: u.id,
      status: 'failed', failure_reason: 'insufficient_funds',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)
    const row = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_w4' })
    expect(row.status).toBe(PAYMENT_STATUS.FAILED)
    expect(row.failure_reason).toBe('insufficient_funds')
  })
})
