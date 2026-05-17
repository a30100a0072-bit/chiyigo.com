/**
 * Phase F-2 — Payment scaffold 整合測試
 *
 * 涵蓋：
 *  - utils/payments.ts helper（create / get / updateStatus）
 *  - requirePaymentAccess gate（KYC verified vs not）
 *  - GET /api/auth/payments/intents（list + filter + 越權隔離）
 *  - GET /api/auth/payments/intents/:id（詳情 + 越權 → 404）
 *  - POST /api/webhooks/payments/[vendor]（mock adapter HMAC + dedupe + UPSERT）
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt'

// Codex r7 P2：TOCTOU 補救分支（updatePaymentStatus no_row → re-read includeDeleted
// → handleOrphan）在純 SQL 測試裡撞不到 —— lookup includeDeleted=true 看到的就是
// 真實 row，soft-deleted row 會先被 upfront orphan 截走。改用 mock 強制
// getPaymentIntent 第一次回 deleted_at=null（模擬 lookup 先到、user delete 後到、
// update 撈不到的真實 race），第二次（re-read）才回真實 deleted 狀態。
const mockState = vi.hoisted(() => ({
  tocTouMode: false, callCount: 0,
  casLostMode: false,  // Codex r8 P2：強迫 updatePaymentStatus 回 no_row 模擬 CAS lost race
}))

vi.mock('../../functions/utils/payments', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getPaymentIntent: vi.fn(async (env, opts) => {
      if (mockState.tocTouMode) {
        mockState.callCount++
        if (mockState.callCount === 1) {
          const real = await actual.getPaymentIntent(env, opts)
          return real ? { ...real, deleted_at: null } : null
        }
      }
      return actual.getPaymentIntent(env, opts)
    }),
    updatePaymentStatus: vi.fn(async (env, opts) => {
      if (mockState.casLostMode) return { outcome: 'no_row' }
      return actual.updatePaymentStatus(env, opts)
    }),
  }
})

const {
  createPaymentIntent, getPaymentIntent, updatePaymentStatus,
  requirePaymentAccess,
  PAYMENT_STATUS,
} = await import('../../functions/utils/payments')
import { setUserKycStatus, KYC_STATUS } from '../../functions/utils/kyc'
import { onRequestGet  as listHandler    } from '../../functions/api/auth/payments/intents'
import { onRequestGet  as detailHandler  } from '../../functions/api/auth/payments/intents/[id].js'
import { onRequestPost as webhookHandler } from '../../functions/api/webhooks/payments/[vendor]'
import { onRequestDelete as userDeleteHandler } from '../../functions/api/auth/payments/intents/[id].js'

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
    expect(ok.outcome).toBe('applied')
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
  beforeEach(async () => {
    await resetDb()
    mockState.tocTouMode = false
    mockState.callCount = 0
    mockState.casLostMode = false
  })

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

  it('沒既存 intent + webhook 帶 user_id + PSP_DIRECT_INTENT_ENABLED=1 → 主動建立', async () => {
    // P0-9：fallback 改 opt-in，env flag 開才會自動建 intent。
    env.PSP_DIRECT_INTENT_ENABLED = '1'
    try {
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
    } finally {
      delete env.PSP_DIRECT_INTENT_ENABLED
    }
  })

  it('PSP-direct orphan create + failed → row.failure_reason 落 DB', async () => {
    // PR-4 type-only relax 收尾：createPaymentIntent INSERT 漏 failure_reason 欄
    // 導致初次 PSP webhook 就是 failed 的 orphan intent 在 DB 留 NULL。
    env.PSP_DIRECT_INTENT_ENABLED = '1'
    try {
      const u = await seedUser({ email: 'w2c@x' })
      const body = JSON.stringify({
        event_id: 'evt_w2c', vendor_intent_id: 'pi_w2c', user_id: u.id,
        status: 'failed', amount_subunit: 3000, currency: 'TWD',
        failure_reason: 'card_declined',
      })
      const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
      const resp = await webhookHandler({
        request: webhookReq(body, sig), env, params: { vendor: 'mock' },
      })
      expect(resp.status).toBe(200)
      const row = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_w2c' })
      expect(row).not.toBeNull()
      expect(row.status).toBe(PAYMENT_STATUS.FAILED)
      expect(row.failure_reason).toBe('card_declined')
    } finally {
      delete env.PSP_DIRECT_INTENT_ENABLED
    }
  })

  it('P0-9：沒既存 intent + flag 關 → 不建 intent + critical audit + DLQ', async () => {
    const u = await seedUser({ email: 'w2b@x' })
    const body = JSON.stringify({
      event_id: 'evt_w2b', vendor_intent_id: 'pi_w2b', user_id: u.id,
      status: 'succeeded', amount_subunit: 999999, currency: 'TWD',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)
    const row = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_w2b' })
    expect(row).toBeNull()  // 不建 intent
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'payment.webhook.psp_direct_blocked'`,
    ).first()
    expect(audit?.severity).toBe('critical')
    const dlq = await env.chiyigo_db.prepare(
      `SELECT error_stage FROM payment_webhook_dlq WHERE event_id = 'evt_w2b'`,
    ).first()
    expect(dlq?.error_stage).toBe('psp_direct_disabled')
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

  it('[Codex r1 P0-2] dedupe row 未 applied → PSP retry 必須重套狀態，不可吞成 dedup', async () => {
    const u = await seedUser({ email: 'orphan@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_orphan',
      status: 'pending', currency: 'TWD',
    })
    // 模擬上一輪：dedupe row 已插入但 apply_status='failed'（status update throw 後落 DLQ）
    await env.chiyigo_db
      .prepare(`INSERT INTO payment_webhook_events (vendor, event_id, status_to, apply_status) VALUES (?, ?, ?, 'failed')`)
      .bind('mock', 'evt_orphan', 'succeeded').run()

    const body = JSON.stringify({
      event_id: 'evt_orphan', vendor_intent_id: 'pi_orphan', user_id: u.id, status: 'succeeded',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)
    const j = await resp.json()
    expect(j.deduplicated).toBeFalsy()  // 不可吞成 dedup hit

    // 驗：retry 真的重跑了 status update
    const intent = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_orphan' })
    expect(intent.status).toBe('succeeded')

    // 驗：dedupe row 現在是 applied
    const dedupeRow = await env.chiyigo_db
      .prepare(`SELECT apply_status FROM payment_webhook_events WHERE vendor = ? AND event_id = ?`)
      .bind('mock', 'evt_orphan').first()
    expect(dedupeRow.apply_status).toBe('applied')

    // 第三次 retry → 真 dedup 了
    const resp3 = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    const j3 = await resp3.json()
    expect(j3.deduplicated).toBe(true)
  })

  it('[Codex r2 P1] 撞到 in-flight processing row → 回 PSP failure 不雙跑', async () => {
    const u = await seedUser({ email: 'inflight@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_inflight',
      status: 'pending', currency: 'TWD',
    })
    // 模擬：別的 instance 正在跑 → row 已存在 apply_status='processing'
    await env.chiyigo_db
      .prepare(`INSERT INTO payment_webhook_events (vendor, event_id, status_to, apply_status) VALUES (?, ?, ?, 'processing')`)
      .bind('mock', 'evt_inflight', 'succeeded').run()

    const body = JSON.stringify({
      event_id: 'evt_inflight', vendor_intent_id: 'pi_inflight', user_id: u.id, status: 'succeeded',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    // mock adapter 沒 failureResponse → fallback 409
    expect(resp.status).toBe(409)
    const j = await resp.json()
    expect(j.code).toBe('WEBHOOK_IN_FLIGHT')

    // 重要：intent 沒被雙跑改動（原 pending 沒變 succeeded）
    const intent = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_inflight' })
    expect(intent.status).toBe('pending')

    // dedupe row 仍維持 processing（不被誤 reset 為新一輪）
    const dedupeRow = await env.chiyigo_db
      .prepare(`SELECT apply_status FROM payment_webhook_events WHERE vendor = ? AND event_id = ?`)
      .bind('mock', 'evt_inflight').first()
    expect(dedupeRow.apply_status).toBe('processing')
  })

  it('[Codex r1 P0-1] user DELETE intent → soft delete (deleted_at set，list 看不到，getPaymentIntent 預設 404)', async () => {
    const u = await seedUser({ email: 'soft@x' })
    await setUserKycStatus(env, u.id, KYC_STATUS.VERIFIED)
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_soft', status: 'pending', currency: 'TWD',
    })
    const token = await userToken(u.id, 'soft@x')
    const resp = await userDeleteHandler({
      request: bearer('DELETE', `http://x/api/auth/payments/intents/${intentId}`, token),
      env, params: { id: String(intentId) },
    })
    expect(resp.status).toBe(200)
    // 預設過濾 → 找不到
    expect(await getPaymentIntent(env, { id: intentId })).toBeNull()
    // includeDeleted=true → 看得到，且 deleted_at 已 set
    const raw = await getPaymentIntent(env, { id: intentId, includeDeleted: true })
    expect(raw).toBeTruthy()
    expect(raw.deleted_at).toBeTruthy()
  })

  it('[Codex r1 P0-1] orphan webhook：intent soft-deleted 後 PSP 補送 succeeded → critical DLQ + intent.status 不變', async () => {
    const u = await seedUser({ email: 'orphan1@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_orphan_del', status: 'pending', currency: 'TWD',
    })
    // 直接 SQL soft-delete（不走 user delete handler 避免 KYC 設定干擾）
    await env.chiyigo_db
      .prepare(`UPDATE payment_intents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE vendor = ? AND vendor_intent_id = ?`)
      .bind('mock', 'pi_orphan_del').run()

    const body = JSON.stringify({
      event_id: 'evt_orphan_del', vendor_intent_id: 'pi_orphan_del', user_id: u.id, status: 'succeeded',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)  // 不讓 PSP retry spam；DLQ + critical 留證

    // intent.status 仍維持 pending（不可被 orphan webhook 改成 succeeded）
    const raw = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_orphan_del', includeDeleted: true })
    expect(raw.status).toBe('pending')

    // DLQ 該有一筆 orphan_intent_deleted
    const dlq = await env.chiyigo_db
      .prepare(`SELECT error_stage FROM payment_webhook_dlq WHERE event_id = ?`)
      .bind('evt_orphan_del').first()
    expect(dlq?.error_stage).toBe('orphan_intent_deleted')

    // dedupe row markApplied → 第二次 PSP retry 直接 dedup hit，不再灌 DLQ
    const resp2 = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp2.status).toBe(200)
    const dlqCount = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM payment_webhook_dlq WHERE event_id = ?`)
      .bind('evt_orphan_del').first()
    expect(dlqCount.c).toBe(1)
  })

  it('[Codex r7 P2] TOCTOU re-read 補救分支真的執行（不靠 upfront orphan）', async () => {
    // 純 SQL 測試撞不到 r5 P0 的 re-read 路徑（upfront 會先用 includeDeleted=true
    // 看到 deleted_at 並截斷）。用 mock 強迫 lookup 第一次回 deleted_at=null，模擬
    // 「lookup 跑完之後 user 才 soft-delete」的真實 race window。
    const u = await seedUser({ email: 'toctou-real@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_toctou_real',
      status: 'pending', currency: 'TWD',
    })
    // race 結果：lookup 之後、updatePaymentStatus 之前才 soft-delete。
    // 但測試裡兩段是同步的；改用 mock 偽造 lookup 回非 deleted（callCount===1），
    // 然後在 race 真的發生的 SQL 層面：updatePaymentStatus 的 deleted_at IS NULL
    // 撈不到此 row。
    await env.chiyigo_db
      .prepare(`UPDATE payment_intents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .bind(intentId).run()
    mockState.tocTouMode = true

    const body = JSON.stringify({
      event_id: 'evt_toctou_real', vendor_intent_id: 'pi_toctou_real', user_id: u.id, status: 'succeeded',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)
    // mock 至少被叫到第二次（upfront 沒擋住 → updatePaymentStatus no_row → re-read）
    expect(mockState.callCount).toBeGreaterThanOrEqual(2)

    mockState.tocTouMode = false  // 後續 query 用真實狀態

    // intent 仍 pending（沒被 race 改成 succeeded）
    const reread = await getPaymentIntent(env, { id: intentId, includeDeleted: true })
    expect(reread.status).toBe('pending')
    expect(reread.deleted_at).toBeTruthy()

    // DLQ 留 orphan_intent_deleted（從 re-read 分支進的 handleOrphan）
    const dlq = await env.chiyigo_db
      .prepare(`SELECT error_stage FROM payment_webhook_dlq WHERE event_id = ?`)
      .bind('evt_toctou_real').first()
    expect(dlq?.error_stage).toBe('orphan_intent_deleted')
  })

  it('[Codex r5 P0] TOCTOU：updatePaymentStatus 撞到 soft-delete race → 補走 orphan，不悄悄 mark applied', async () => {
    const u = await seedUser({ email: 'toctou@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_toctou', status: 'pending', currency: 'TWD',
    })
    // 模擬 race：webhook lookup 看到 live intent，但 updatePaymentStatus 跑之前 user
    // delete handler 把 intent 軟刪掉。直接在送 webhook 前 soft-delete 來重現結果
    // （lookup includeDeleted=true 仍會看到 row，update 撈不到 → 走 TOCTOU 補救）。
    await env.chiyigo_db
      .prepare(`UPDATE payment_intents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
      .bind(intentId).run()

    const body = JSON.stringify({
      event_id: 'evt_toctou', vendor_intent_id: 'pi_toctou', user_id: u.id, status: 'succeeded',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)

    // intent 仍是 pending（沒被 race 改成 succeeded）
    const reread = await getPaymentIntent(env, { id: intentId, includeDeleted: true })
    expect(reread.status).toBe('pending')
    expect(reread.deleted_at).toBeTruthy()

    // DLQ 留 orphan_intent_deleted（不是 noop 過去）
    const dlq = await env.chiyigo_db
      .prepare(`SELECT error_stage FROM payment_webhook_dlq WHERE event_id = ?`)
      .bind('evt_toctou').first()
    expect(dlq?.error_stage).toBe('orphan_intent_deleted')
  })

  it('[Codex r5 P1] orphan DLQ 寫入失敗 → markFailed + throw（不可悄悄 markApplied 把證據丟掉）', async () => {
    const u = await seedUser({ email: 'orphan-strict@x' })
    const body = JSON.stringify({
      event_id: 'evt_strict_dlq', vendor_intent_id: 'pi_strict', status: 'succeeded',
      // 不帶 user_id → 走 orphan_intent_not_found 分支
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)

    // 強制 DLQ INSERT 失敗：drop 整張 table
    await env.chiyigo_db.prepare(`DROP TABLE payment_webhook_dlq`).run()

    await expect(webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })).rejects.toThrow()

    // dedupe row 標 failed（不是 applied）→ 之後 PSP retry 才會被當 in-flight 重跑
    const dedupeRow = await env.chiyigo_db
      .prepare(`SELECT apply_status FROM payment_webhook_events WHERE event_id = ?`)
      .bind('evt_strict_dlq').first()
    expect(dedupeRow?.apply_status).toBe('failed')

    // 重建 DLQ table，給後續測試用（_setup 已 sandbox 化但保險）
    await env.chiyigo_db.prepare(`CREATE TABLE IF NOT EXISTS payment_webhook_dlq (
      id INTEGER PRIMARY KEY AUTOINCREMENT, vendor TEXT, event_id TEXT,
      vendor_intent_id TEXT, raw_body TEXT, payload_hash TEXT,
      error_stage TEXT, error_message TEXT, http_status_returned INTEGER,
      created_at TEXT DEFAULT (datetime('now')), replayed_at TEXT
    )`).run()
    // 防止其他測試吃到 u 未使用警告
    expect(u.id).toBeGreaterThan(0)
  })

  it('[Codex r1 P0-1] orphan webhook：ECPay-style 無 user_id + intent 不存在 → critical DLQ，不悄悄回 success 吞錢', async () => {
    // 沒 createPaymentIntent；webhook 不帶 user_id（模擬 ECPay）
    const body = JSON.stringify({
      event_id: 'evt_orphan_nf', vendor_intent_id: 'pi_nonexistent', status: 'succeeded',
      // 注意：故意不帶 user_id
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)

    // 沒任何 intent 被建出來
    const raw = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_nonexistent', includeDeleted: true })
    expect(raw).toBeNull()

    // DLQ 留 orphan_intent_not_found
    const dlq = await env.chiyigo_db
      .prepare(`SELECT error_stage FROM payment_webhook_dlq WHERE event_id = ?`)
      .bind('evt_orphan_nf').first()
    expect(dlq?.error_stage).toBe('orphan_intent_not_found')
  })

  it('[Codex r1 P1-4] terminal succeeded 不可被 webhook replay 改回 pending → critical audit + 不改 DB', async () => {
    const u = await seedUser({ email: 'sm1@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_sm1', currency: 'TWD', status: 'succeeded',
    })
    const ok = await updatePaymentStatus(env, {
      vendor: 'mock', vendor_intent_id: 'pi_sm1', status: PAYMENT_STATUS.PENDING,
    })
    expect(ok.outcome).toBe('illegal_transition')
    expect(ok.from).toBe('succeeded')
    expect(ok.to).toBe('pending')
    const intent = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_sm1' })
    expect(intent.status).toBe('succeeded')

    const audit = await env.chiyigo_db
      .prepare(`SELECT event_type FROM audit_log WHERE event_type = ? ORDER BY id DESC LIMIT 1`)
      .bind('payment.status.illegal_transition').first()
    expect(audit?.event_type).toBe('payment.status.illegal_transition')
  })

  it('[Codex r1 P1-4] succeeded → succeeded same-status replay = no-op，不算 illegal（無 audit）', async () => {
    const u = await seedUser({ email: 'sm2@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_sm2', currency: 'TWD', status: 'succeeded',
    })
    await env.chiyigo_db.prepare(`DELETE FROM audit_log WHERE event_type = 'payment.status.illegal_transition'`).run()
    const ok = await updatePaymentStatus(env, {
      vendor: 'mock', vendor_intent_id: 'pi_sm2', status: PAYMENT_STATUS.SUCCEEDED,
    })
    expect(ok.outcome).toBe('same_status')
    const audit = await env.chiyigo_db
      .prepare(`SELECT id FROM audit_log WHERE event_type = 'payment.status.illegal_transition'`)
      .first()
    expect(audit).toBeNull()
  })

  it('[Codex r1 P1-4] failed → succeeded（webhook 串錯）→ illegal_transition，不會悄悄入帳', async () => {
    const u = await seedUser({ email: 'sm3@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_sm3', currency: 'TWD', status: 'failed',
    })
    const ok = await updatePaymentStatus(env, {
      vendor: 'mock', vendor_intent_id: 'pi_sm3', status: PAYMENT_STATUS.SUCCEEDED,
    })
    expect(ok.outcome).toBe('illegal_transition')
    const intent = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_sm3' })
    expect(intent.status).toBe('failed')
  })

  it('[Codex r8 P2] webhook no_row CAS lost（intent 仍 live）→ critical status_cas_lost audit，不悄悄消失', async () => {
    const u = await seedUser({ email: 'caslost@x' })
    const intentId = await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_caslost',
      status: 'pending', currency: 'TWD',
    })
    mockState.casLostMode = true  // 強迫 updatePaymentStatus → no_row（live 但 race）

    const body = JSON.stringify({
      event_id: 'evt_caslost', vendor_intent_id: 'pi_caslost', user_id: u.id, status: 'succeeded',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)

    mockState.casLostMode = false

    // intent 沒被改（mock 沒寫 DB；CAS lost 的意義就是現實寫不進）
    const reread = await getPaymentIntent(env, { id: intentId })
    expect(reread.status).toBe('pending')

    // critical audit 留證
    const audit = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE event_type = 'payment.webhook.status_cas_lost' ORDER BY id DESC LIMIT 1`)
      .first()
    expect(audit).not.toBeNull()
    const data = JSON.parse(audit.event_data)
    expect(data.attempted_status).toBe('succeeded')
    expect(data.current_status).toBe('pending')

    // 沒寫 payment.status.change（不假裝成功）
    const change = await env.chiyigo_db
      .prepare(`SELECT id FROM audit_log WHERE event_type = 'payment.status.change' AND event_data LIKE '%pi_caslost%'`)
      .first()
    expect(change).toBeNull()
  })

  it('[Codex r6 P1-4] webhook 撞 illegal_transition：DB=failed 收到 succeeded → 不寫 trade_no，不發 payment.status.change，但 dedupe applied', async () => {
    const u = await seedUser({ email: 'r6illegal@x' })
    await createPaymentIntent(env, {
      user_id: u.id, vendor: 'mock', vendor_intent_id: 'pi_r6illegal', currency: 'TWD', status: 'failed',
    })
    const body = JSON.stringify({
      event_id: 'evt_r6illegal', vendor_intent_id: 'pi_r6illegal', user_id: u.id,
      status: 'succeeded', trade_no: 'TN_FAKE_SUCCESS',
    })
    const sig = await hmacHex(env.PAYMENT_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)

    // intent 仍 failed（state machine 守住）
    const intent = await getPaymentIntent(env, { vendor: 'mock', vendor_intent_id: 'pi_r6illegal' })
    expect(intent.status).toBe('failed')
    // metadata.trade_no 不可被寫入（否則對帳/退款查找會誤認）
    expect(intent.metadata?.trade_no).toBeUndefined()

    // 寫了 illegal_transition critical audit，但沒寫成功收尾的 payment.status.change
    const illegal = await env.chiyigo_db
      .prepare(`SELECT id FROM audit_log WHERE event_type = 'payment.status.illegal_transition' ORDER BY id DESC LIMIT 1`)
      .first()
    expect(illegal).not.toBeNull()
    const change = await env.chiyigo_db
      .prepare(`SELECT id FROM audit_log WHERE event_type = 'payment.status.change' AND event_data LIKE '%pi_r6illegal%'`)
      .first()
    expect(change).toBeNull()

    // dedupe row markApplied → PSP retry 走 dedup hit，不會再重複過 illegal_transition
    const dedupe = await env.chiyigo_db
      .prepare(`SELECT apply_status FROM payment_webhook_events WHERE event_id = ?`)
      .bind('evt_r6illegal').first()
    expect(dedupe?.apply_status).toBe('applied')
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
