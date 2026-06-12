/**
 * PAY-002 (P0) regression test — adapter 層 fail-closed 真值表。
 * 設計：docs/audit/pay-002-hotfix-plan.md §3 真值表 / §5 AC｜報告：docs/audit/01-payments.md
 *
 * 漏洞（pre-fix）：getCreds 在 ECPAY_MODE 未設時 fail-OPEN 到程式內公開 sandbox HashKey/HashIV，
 * 任何人可自簽 webhook 把 intent 標 succeeded。fix：以 ENVIRONMENT==='production' 為 prod SoT，
 * 公開 sandbox creds「有且僅有」非 production + 明確 ECPAY_MODE='sandbox' + 無真 creds 才可達；
 * 其餘 fail-closed → parseWebhook 回 { ok:false, error:'vendor_misconfigured', code }。
 *
 * 純 adapter 層、不需 D1，走 default(node) vitest config。handler 層的 critical audit + DLQ
 * 由 tests/integration/payments-ecpay.test.ts 的 handler-level regression 把關。
 */

import { describe, it, expect } from 'vitest'
import {
  ecpayCheckMacValue, ecpayPaymentAdapter,
} from '../functions/utils/payment-vendors/ecpay'

// 程式內 hardcode 的「公開」sandbox 金鑰（攻擊者已知；同 ecpay.ts SANDBOX_CREDS）。
const PUBLIC_SANDBOX_HASH_KEY = 'pwFHCqoQZGmho4w6'
const PUBLIC_SANDBOX_HASH_IV  = 'EkRm7iFT261dpevs'

const SUCCEEDED_PARAMS: Record<string, string> = {
  MerchantID:      '3002607',
  MerchantTradeNo: 'cy-test-001',
  TradeNo:         'ecpayTradeNo001',
  RtnCode:         '1',
  RtnMsg:          'Succeeded',
  TradeAmt:        '100',
  PaymentType:     'Credit_CreditCard',
  PaymentDate:     '2026/06/12 10:00:00',
}

function ecpayWebhookReq(params: Record<string, string>): Request {
  const body = new URLSearchParams(params).toString()
  return new Request('http://x/api/webhooks/payments/ecpay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
}

async function signedWebhook(
  params: Record<string, string>, hashKey: string, hashIV: string,
): Promise<Request> {
  const p = { ...params }
  p.CheckMacValue = await ecpayCheckMacValue(p, hashKey, hashIV)
  return ecpayWebhookReq(p)
}

describe('PAY-002 ECPay getCreds fail-closed 真值表（adapter 層）', () => {
  // ── REJECT 列：getCreds throw → parseWebhook 回 ok:false（簽章未驗，body 未讀）──────────
  it('非 production + 無 mode + 無 creds → reject (sandbox_requires_explicit_mode)', async () => {
    const req = await signedWebhook(SUCCEEDED_PARAMS, PUBLIC_SANDBOX_HASH_KEY, PUBLIC_SANDBOX_HASH_IV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(req, {})
    expect(parsed.ok).toBe(false)
    expect(parsed.error).toBe('vendor_misconfigured')
    expect(parsed.code).toBe('sandbox_requires_explicit_mode')
  })

  it('production + 缺三把 creds → reject (secret_missing)', async () => {
    const req = await signedWebhook(SUCCEEDED_PARAMS, PUBLIC_SANDBOX_HASH_KEY, PUBLIC_SANDBOX_HASH_IV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(req, { ENVIRONMENT: 'production' })
    expect(parsed.ok).toBe(false)
    expect(parsed.code).toBe('secret_missing')
  })

  it('production + 缺任一 creds → reject (secret_missing)', async () => {
    const req = await signedWebhook(SUCCEEDED_PARAMS, PUBLIC_SANDBOX_HASH_KEY, PUBLIC_SANDBOX_HASH_IV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(req, {
      ENVIRONMENT: 'production', ECPAY_MERCHANT_ID: 'x', ECPAY_HASH_KEY: 'y', // 缺 ECPAY_HASH_IV
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.code).toBe('secret_missing')
  })

  it('production + ECPAY_MODE=sandbox → reject (mode_mismatch)', async () => {
    const req = await signedWebhook(SUCCEEDED_PARAMS, PUBLIC_SANDBOX_HASH_KEY, PUBLIC_SANDBOX_HASH_IV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(req, {
      ENVIRONMENT: 'production', ECPAY_MODE: 'sandbox',
      ECPAY_MERCHANT_ID: '3002607', ECPAY_HASH_KEY: 'k', ECPAY_HASH_IV: 'iv',
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.code).toBe('mode_mismatch')
  })

  // ── 允許列：非 production + 明確 sandbox + 無真 creds → 公開 sandbox creds 可解析 ────────────
  it('非 production + ECPAY_MODE=sandbox → 允許公開 sandbox creds（正確簽章解析成功）', async () => {
    const req = await signedWebhook(SUCCEEDED_PARAMS, PUBLIC_SANDBOX_HASH_KEY, PUBLIC_SANDBOX_HASH_IV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(req, { ECPAY_MODE: 'sandbox' })
    expect(parsed.ok).toBe(true)
    expect(parsed.status).toBe('succeeded')
    expect(parsed.vendor_intent_id).toBe('cy-test-001')
  })

  // ── production 真 creds：公開金鑰自簽偽造 webhook 驗不過 ─────────────────────────────────
  it('production + 真 creds：公開 sandbox 金鑰自簽的偽造 webhook 不可通過', async () => {
    // 攻擊者只有公開金鑰可簽 → 與 prod 真 creds 驗算不符。
    const req = await signedWebhook(SUCCEEDED_PARAMS, PUBLIC_SANDBOX_HASH_KEY, PUBLIC_SANDBOX_HASH_IV)
    const parsed = await ecpayPaymentAdapter.parseWebhook(req, {
      ENVIRONMENT: 'production',
      ECPAY_MERCHANT_ID: '3002607',
      ECPAY_HASH_KEY: 'REAL-secret-key-not-public',
      ECPAY_HASH_IV:  'REAL-secret-iv16',
    })
    expect(parsed.ok).toBe(false)
  })
})
