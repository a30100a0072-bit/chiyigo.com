/**
 * Phase F-2 wave 2 — ECPay adapter 整合測試
 *
 * 涵蓋：
 *  - CheckMacValue 演算法（with sandbox creds）
 *  - parseWebhook 簽章驗證（valid / invalid / RtnCode 1 vs 0）
 *  - successResponse / failureResponse plain text "1|OK" / "0|..."
 *  - POST /api/auth/payments/checkout/ecpay（KYC + amount 範圍 + intent 建立 + form 欄位齊全）
 *  - 端到端：checkout → 模擬 ECPay 回 webhook → status=succeeded
 *  - dedup：同 TradeNo retry → 第二次仍回 1|OK 不重複處理
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import {
  ecpayCheckMacValue, ecpayPaymentAdapter, generateMerchantTradeNo,
} from '../../functions/utils/payment-vendors/ecpay.js'
import { setUserKycStatus, KYC_STATUS } from '../../functions/utils/kyc.js'
import { getPaymentIntent, PAYMENT_STATUS } from '../../functions/utils/payments.js'
import { onRequestPost as checkoutHandler } from '../../functions/api/auth/payments/checkout/ecpay.js'
import { onRequestPost as webhookHandler  } from '../../functions/api/webhooks/payments/[vendor].js'

// 必須跟 functions/utils/payment-vendors/ecpay.js 的 SANDBOX_CREDS 一致；
// 否則 webhook handler 在 env 沒設 ECPAY_HASH_KEY 時 fallback 到程式內的 sandbox creds，
// 這裡測試 payload 用舊 key 簽會 CheckMacValue mismatch → 假綠
// 舊 2000132/5294y0726k67Nck0/v77hoKGq4kWxNNIS 已被綠界停用
const SANDBOX = {
  MerchantID: '3002607',
  HashKey:    'pwFHCqoQZGmho4w6',
  HashIV:     'EkRm7iFT261dpevs',
}

async function userToken(userId, email = 'p@x') {
  return signJwt(
    { sub: String(userId), email, role: 'player', status: 'active', ver: 0,
      scope: 'read:profile write:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

function bearerJson(method, url, token, body) {
  return new Request(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function ecpayWebhookReq(params) {
  const body = new URLSearchParams(params).toString()
  return new Request('http://x/api/webhooks/payments/ecpay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

describe('ECPay CheckMacValue 演算法', () => {
  it('與綠界文件範例一致（基本 case）', async () => {
    // 綠界開發手冊 範例：
    //   MerchantID=2000132, MerchantTradeNo=Test123, ...
    //   依照排序 + .NET URL encode + lowercase → SHA256 大寫
    const params = {
      MerchantID:        SANDBOX.MerchantID,
      MerchantTradeNo:   'mtn0001',
      MerchantTradeDate: '2026/01/01 12:00:00',
      PaymentType:       'aio',
      TotalAmount:       '100',
      TradeDesc:         'test',
      ItemName:          'item',
      ReturnURL:         'https://example.com/return',
      ChoosePayment:     'ALL',
      EncryptType:       '1',
    }
    const sig = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    expect(sig).toMatch(/^[A-F0-9]{64}$/)  // SHA256 大寫 hex
    // 同一輸入兩次必須一致
    const sig2 = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    expect(sig2).toBe(sig)
  })

  it('CheckMacValue 欄位被忽略（避免遞迴）', async () => {
    const params = {
      A: '1', B: '2', CheckMacValue: 'should-be-ignored',
    }
    const sigWith    = await ecpayCheckMacValue(params, 'k', 'iv')
    const { CheckMacValue, ...rest } = params
    const sigWithout = await ecpayCheckMacValue(rest, 'k', 'iv')
    expect(sigWith).toBe(sigWithout)
  })
})

describe('ecpayPaymentAdapter.parseWebhook', () => {
  beforeAll(async () => { await ensureJwtKeys() })

  it('正確簽章 + RtnCode=1 → status=succeeded', async () => {
    const params = {
      MerchantID:      SANDBOX.MerchantID,
      MerchantTradeNo: 'mtn_succ',
      RtnCode:         '1',
      RtnMsg:          'Succeeded',
      TradeNo:         '2026010100000001',
      TradeAmt:        '500',
      PaymentDate:     '2026/01/01 12:30:00',
      PaymentType:     'Credit_CreditCard',
      TradeDate:       '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(ecpayWebhookReq(params), env)
    expect(parsed.ok).toBe(true)
    expect(parsed.event_id).toBe('2026010100000001')
    expect(parsed.vendor_intent_id).toBe('mtn_succ')
    expect(parsed.status).toBe(PAYMENT_STATUS.SUCCEEDED)
    expect(parsed.amount_subunit).toBe(500)
    expect(parsed.currency).toBe('TWD')
  })

  it('簽章錯 → ok=false signature_invalid', async () => {
    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: 'mtn_x',
      RtnCode: '1', TradeNo: 't1',
      CheckMacValue: 'WRONG_SIG_VALUE',
    }
    const parsed = await ecpayPaymentAdapter.parseWebhook(ecpayWebhookReq(params), env)
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('signature_invalid')
  })

  it('缺 MerchantTradeNo → missing_required_fields', async () => {
    const params = { RtnCode: '1', CheckMacValue: 'x' }
    const parsed = await ecpayPaymentAdapter.parseWebhook(ecpayWebhookReq(params), env)
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('missing_required_fields')
  })

  it('RtnCode != 1 → status=failed + failure_reason 帶 RtnMsg', async () => {
    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: 'mtn_fail',
      RtnCode: '10100050', RtnMsg: '額度不足',
      TradeNo: 'tnFail', TradeAmt: '100',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(ecpayWebhookReq(params), env)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe(PAYMENT_STATUS.FAILED)
    expect(parsed.failure_reason).toContain('額度不足')
  })

  it('ATM 取號成功 → status=processing + payment_info.method=atm', async () => {
    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: 'mtn_atm',
      RtnCode: '2', RtnMsg: 'ATM 取號成功',
      TradeNo: 'TN_ATM', TradeAmt: '500',
      BankCode: '004', vAccount: '9990001234567890',
      ExpireDate: '2026/01/15',
      PaymentType: 'ATM_TAISHIN', TradeDate: '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(ecpayWebhookReq(params), env)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe(PAYMENT_STATUS.PROCESSING)
    expect(parsed.payment_info?.method).toBe('atm')
    expect(parsed.payment_info?.bank_code).toBe('004')
    expect(parsed.payment_info?.v_account).toBe('9990001234567890')
    expect(parsed.payment_info?.expire_date).toBe('2026/01/15')
    expect(parsed.failure_reason).toBeNull()
  })

  it('CVS 取號成功 → status=processing + payment_info.method=cvs', async () => {
    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: 'mtn_cvs',
      RtnCode: '10100073', RtnMsg: 'CVS 取號成功',
      TradeNo: 'TN_CVS', TradeAmt: '300',
      PaymentNo: 'LLL12345678',
      ExpireDate: '2026/01/10 23:59:59',
      PaymentType: 'CVS_CVS', TradeDate: '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(ecpayWebhookReq(params), env)
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe(PAYMENT_STATUS.PROCESSING)
    expect(parsed.payment_info?.method).toBe('cvs')
    expect(parsed.payment_info?.payment_no).toBe('LLL12345678')
  })

  it('Barcode 取號成功 → payment_info.method=barcode + 三段條碼', async () => {
    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: 'mtn_bc',
      RtnCode: '10100073', RtnMsg: 'Barcode 取號成功',
      TradeNo: 'TN_BC', TradeAmt: '200',
      Barcode1: 'BC1XX', Barcode2: 'BC2YY', Barcode3: 'BC3ZZ',
      ExpireDate: '2026/01/10',
      PaymentType: 'BARCODE_BARCODE', TradeDate: '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(ecpayWebhookReq(params), env)
    expect(parsed.ok).toBe(true)
    expect(parsed.payment_info?.method).toBe('barcode')
    expect(parsed.payment_info?.barcode_1).toBe('BC1XX')
    expect(parsed.payment_info?.barcode_3).toBe('BC3ZZ')
  })

  it('successResponse 是 plain text "1|OK"', async () => {
    const r = ecpayPaymentAdapter.successResponse()
    expect(r.headers.get('Content-Type')).toContain('text/plain')
    expect(await r.text()).toBe('1|OK')
  })
})

describe('POST /api/auth/payments/checkout/ecpay', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('KYC 未 verified → 403 KYC_REQUIRED', async () => {
    const u = await seedUser({ email: 'c1@x' })
    const tok = await userToken(u.id)
    const resp = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 500 }), env,
    })
    expect(resp.status).toBe(403)
  })

  it('amount 太小 → 400 INVALID_AMOUNT', async () => {
    const u = await seedUser({ email: 'c2@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const resp = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 0 }), env,
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.code).toBe('INVALID_AMOUNT')
  })

  it('正常下單 → intent pending + checkout_url + fields 齊全', async () => {
    const u = await seedUser({ email: 'c3@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const resp = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 1000, trade_desc: 'test deposit' }), env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.checkout_url).toContain('payment-stage.ecpay.com.tw')
    expect(body.fields.MerchantID).toBeDefined()
    expect(body.fields.TotalAmount).toBe('1000')
    expect(body.fields.CheckMacValue).toMatch(/^[A-F0-9]{64}$/)
    expect(body.fields.ChoosePayment).toBe('ALL')

    const intent = await getPaymentIntent(env, { id: body.intent_id })
    expect(intent.status).toBe(PAYMENT_STATUS.PENDING)
    expect(intent.vendor).toBe('ecpay')
    expect(intent.vendor_intent_id).toBe(body.vendor_intent_id)
    expect(intent.amount_subunit).toBe(1000)
  })

  it('choose_payment=ATM → ECPay fields ChoosePayment=ATM', async () => {
    const u = await seedUser({ email: 'c4@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const resp = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 100, choose_payment: 'ATM' }), env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.fields.ChoosePayment).toBe('ATM')
  })
})

describe('端到端：checkout → ECPay webhook → succeeded', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('checkout 後送模擬 ReturnURL → status 變 succeeded + 回 "1|OK"', async () => {
    const u = await seedUser({ email: 'e1@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const checkoutResp = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 1500 }), env,
    })
    const { vendor_intent_id, intent_id } = await checkoutResp.json()

    // 模擬 ECPay 回 ReturnURL
    const params = {
      MerchantID:      SANDBOX.MerchantID,
      MerchantTradeNo: vendor_intent_id,
      RtnCode:         '1',
      RtnMsg:          'Succeeded',
      TradeNo:         'TN_E1_' + Date.now(),
      TradeAmt:        '1500',
      PaymentDate:     '2026/01/01 12:30:00',
      PaymentType:     'Credit_CreditCard',
      TradeDate:       '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const webhookResp = await webhookHandler({
      request: ecpayWebhookReq(params), env, params: { vendor: 'ecpay' },
    })
    expect(webhookResp.status).toBe(200)
    expect(await webhookResp.text()).toBe('1|OK')

    const intent = await getPaymentIntent(env, { id: intent_id })
    expect(intent.status).toBe(PAYMENT_STATUS.SUCCEEDED)
  })

  it('同 TradeNo 重送 → 第二次 1|OK + deduplicated（不重複 audit）', async () => {
    const u = await seedUser({ email: 'e2@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const co = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 200 }), env,
    })
    const { vendor_intent_id } = await co.json()

    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: vendor_intent_id,
      RtnCode: '1', RtnMsg: 'OK', TradeNo: 'TN_DEDUP_1',
      TradeAmt: '200', PaymentDate: '2026/01/01 12:30:00',
      PaymentType: 'Credit_CreditCard', TradeDate: '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)

    const r1 = await webhookHandler({
      request: ecpayWebhookReq(params), env, params: { vendor: 'ecpay' },
    })
    expect(await r1.text()).toBe('1|OK')

    const r2 = await webhookHandler({
      request: ecpayWebhookReq(params), env, params: { vendor: 'ecpay' },
    })
    expect(r2.status).toBe(200)
    expect(await r2.text()).toBe('1|OK')

    // 應只有一筆 critical audit（webhook 處理過）
    const cnt = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS c FROM audit_log WHERE event_type = 'payment.status.change' AND user_id = ?`,
    ).bind(u.id).first()
    expect(cnt.c).toBe(1)
  })

  it('checkout → ATM 取號 webhook → metadata.payment_info 寫進 intent', async () => {
    const u = await seedUser({ email: 'atm-e2e@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const co = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 500 }), env,
    })
    const { vendor_intent_id, intent_id } = await co.json()

    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: vendor_intent_id,
      RtnCode: '2', RtnMsg: 'ATM 取號成功', TradeNo: 'TN_ATM_E2E',
      TradeAmt: '500', BankCode: '004', vAccount: '9990001234567890',
      ExpireDate: '2026/01/15',
      PaymentType: 'ATM_TAISHIN', TradeDate: '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const wh = await webhookHandler({
      request: ecpayWebhookReq(params), env, params: { vendor: 'ecpay' },
    })
    expect(await wh.text()).toBe('1|OK')

    const intent = await getPaymentIntent(env, { id: intent_id })
    expect(intent.status).toBe(PAYMENT_STATUS.PROCESSING)
    expect(intent.metadata?.payment_info?.method).toBe('atm')
    expect(intent.metadata?.payment_info?.v_account).toBe('9990001234567890')
  })

  it('checkout → CVS 取號 webhook → metadata.payment_info 寫進 intent', async () => {
    const u = await seedUser({ email: 'cvs-e2e@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const co = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 300, choose_payment: 'CVS' }), env,
    })
    const { vendor_intent_id, intent_id } = await co.json()

    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: vendor_intent_id,
      RtnCode: '10100073', RtnMsg: 'CVS 取號成功', TradeNo: 'TN_CVS_E2E',
      TradeAmt: '300', PaymentNo: 'LLL12345678',
      ExpireDate: '2026/01/10 23:59:59',
      PaymentType: 'CVS_CVS', TradeDate: '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const wh = await webhookHandler({
      request: ecpayWebhookReq(params), env, params: { vendor: 'ecpay' },
    })
    expect(await wh.text()).toBe('1|OK')

    const intent = await getPaymentIntent(env, { id: intent_id })
    expect(intent.status).toBe(PAYMENT_STATUS.PROCESSING)
    expect(intent.metadata?.payment_info?.method).toBe('cvs')
    expect(intent.metadata?.payment_info?.payment_no).toBe('LLL12345678')
  })

  it('checkout → BARCODE 取號 webhook → 三段條碼寫進 intent', async () => {
    const u = await seedUser({ email: 'barcode-e2e@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const tok = await userToken(u.id)
    const co = await checkoutHandler({
      request: bearerJson('POST', 'https://chiyigo.com/api/auth/payments/checkout/ecpay', tok,
        { amount: 200, choose_payment: 'BARCODE' }), env,
    })
    const { vendor_intent_id, intent_id } = await co.json()

    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: vendor_intent_id,
      RtnCode: '10100073', RtnMsg: 'Barcode 取號成功', TradeNo: 'TN_BARCODE_E2E',
      TradeAmt: '200',
      Barcode1: 'BC1XX', Barcode2: 'BC2YY', Barcode3: 'BC3ZZ',
      ExpireDate: '2026/01/10',
      PaymentType: 'BARCODE_BARCODE', TradeDate: '2026/01/01 12:00:00',
    }
    params.CheckMacValue = await ecpayCheckMacValue(params, SANDBOX.HashKey, SANDBOX.HashIV)
    const wh = await webhookHandler({
      request: ecpayWebhookReq(params), env, params: { vendor: 'ecpay' },
    })
    expect(await wh.text()).toBe('1|OK')

    const intent = await getPaymentIntent(env, { id: intent_id })
    expect(intent.status).toBe(PAYMENT_STATUS.PROCESSING)
    expect(intent.metadata?.payment_info?.method).toBe('barcode')
    expect(intent.metadata?.payment_info?.barcode_1).toBe('BC1XX')
    expect(intent.metadata?.payment_info?.barcode_2).toBe('BC2YY')
    expect(intent.metadata?.payment_info?.barcode_3).toBe('BC3ZZ')
  })

  it('簽章錯 → 回 "0|signature_invalid" + audit warn', async () => {
    const params = {
      MerchantID: SANDBOX.MerchantID, MerchantTradeNo: 'mtn_bad',
      RtnCode: '1', TradeNo: 'TN_BAD',
      CheckMacValue: 'BADSIG',
    }
    const resp = await webhookHandler({
      request: ecpayWebhookReq(params), env, params: { vendor: 'ecpay' },
    })
    expect(resp.status).toBe(200)
    const text = await resp.text()
    expect(text.startsWith('0|')).toBe(true)
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'payment.webhook.fail'`,
    ).first()
    expect(audit).not.toBeNull()
  })
})
