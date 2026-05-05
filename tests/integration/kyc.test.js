/**
 * Phase F-1 — KYC scaffold 整合測試
 *
 * 涵蓋：
 *  - utils/kyc.js helper（getUserKycStatus / setUserKycStatus / requireKyc）
 *  - GET /api/auth/kyc/status
 *  - POST /api/webhooks/kyc/[vendor]（mock adapter HMAC + dedupe + UPSERT）
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser, callFunction } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import {
  getUserKycStatus,
  setUserKycStatus,
  requireKyc,
  KYC_STATUS,
  KYC_LEVEL,
} from '../../functions/utils/kyc.js'
import { onRequestGet  as statusHandler  } from '../../functions/api/auth/kyc/status.js'
import { onRequestPost as webhookHandler } from '../../functions/api/webhooks/kyc/[vendor].js'

env.KYC_MOCK_SECRET = 'test-mock-secret'

async function userToken(userId, email = 'k@x') {
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
  return new Request('http://x/api/webhooks/kyc/mock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-KYC-Signature': sig },
    body,
  })
}

describe('utils/kyc — helpers', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 row → unverified / basic', async () => {
    const u = await seedUser({ email: 'h1@x' })
    const r = await getUserKycStatus(env, u.id)
    expect(r.status).toBe(KYC_STATUS.UNVERIFIED)
    expect(r.level).toBe(KYC_LEVEL.BASIC)
    expect(r.vendor).toBeNull()
  })

  it('setUserKycStatus 寫入 + 再讀回來', async () => {
    const u = await seedUser({ email: 'h2@x' })
    await setUserKycStatus(env, u.id, {
      status: KYC_STATUS.VERIFIED, level: KYC_LEVEL.ENHANCED, vendor: 'sumsub',
    })
    const r = await getUserKycStatus(env, u.id)
    expect(r.status).toBe(KYC_STATUS.VERIFIED)
    expect(r.level).toBe(KYC_LEVEL.ENHANCED)
    expect(r.vendor).toBe('sumsub')
  })

  it('UPSERT：第二次 setUserKycStatus 覆蓋第一次', async () => {
    const u = await seedUser({ email: 'h3@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.PENDING, vendor: 'sumsub' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'sumsub', verified_at: '2026-01-01 10:00:00' })
    const r = await getUserKycStatus(env, u.id)
    expect(r.status).toBe(KYC_STATUS.VERIFIED)
  })

  it('過期 row → 自動 expired', async () => {
    const u = await seedUser({ email: 'h4@x' })
    await env.chiyigo_db.prepare(
      `INSERT INTO user_kyc (user_id, status, expires_at) VALUES (?, 'verified', datetime('now', '-1 day'))`,
    ).bind(u.id).run()
    const r = await getUserKycStatus(env, u.id)
    expect(r.status).toBe(KYC_STATUS.EXPIRED)
  })

  it('非法 status → throw', async () => {
    const u = await seedUser({ email: 'h5@x' })
    await expect(setUserKycStatus(env, u.id, { status: 'invalid' })).rejects.toThrow()
  })
})

describe('utils/kyc — requireKyc gate', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  async function callGate(userId, opts) {
    const tok = await userToken(userId)
    return requireKyc(bearer('GET', 'http://x/', tok), env, opts)
  }

  it('未 verified → 403 KYC_REQUIRED + audit warn', async () => {
    const u = await seedUser({ email: 'g1@x' })
    const result = await callGate(u.id)
    expect(result.error).toBeDefined()
    expect(result.error.status).toBe(403)
    const body = await result.error.clone().json()
    expect(body.code).toBe('KYC_REQUIRED')

    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'kyc.gate.fail' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit).not.toBeNull()
  })

  it('verified → 通過（error null + user 帶出）', async () => {
    const u = await seedUser({ email: 'g2@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'mock' })
    const result = await callGate(u.id)
    expect(result.error).toBeNull()
    expect(result.user.sub).toBe(String(u.id))
    expect(result.kyc.status).toBe(KYC_STATUS.VERIFIED)
  })

  it('要 enhanced 但 user 只是 basic → 403 KYC_LEVEL_INSUFFICIENT', async () => {
    const u = await seedUser({ email: 'g3@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, level: KYC_LEVEL.BASIC })
    const result = await callGate(u.id, { requiredLevel: KYC_LEVEL.ENHANCED })
    expect(result.error).toBeDefined()
    const body = await result.error.clone().json()
    expect(body.code).toBe('KYC_LEVEL_INSUFFICIENT')
  })
})

describe('GET /api/auth/kyc/status', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 row → unverified + can_withdraw=false', async () => {
    const u = await seedUser({ email: 's1@x' })
    const tok = await userToken(u.id)
    const resp = await statusHandler({
      request: bearer('GET', 'http://x/', tok), env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.status).toBe(KYC_STATUS.UNVERIFIED)
    expect(body.can_withdraw).toBe(false)
  })

  it('verified → can_withdraw=true', async () => {
    const u = await seedUser({ email: 's2@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.VERIFIED, vendor: 'sumsub' })
    const tok = await userToken(u.id)
    const resp = await statusHandler({
      request: bearer('GET', 'http://x/', tok), env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.status).toBe(KYC_STATUS.VERIFIED)
    expect(body.can_withdraw).toBe(true)
    expect(body.vendor).toBe('sumsub')
  })
})

describe('POST /api/webhooks/kyc/:vendor', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('未知 vendor → 400', async () => {
    const resp = await callFunction(webhookHandler, new Request('http://x/', {
      method: 'POST', body: '{}',
    }))
    // 沒 :vendor params 會被認成 undefined → 400
    expect([400, 404]).toContain(resp.status)
  })

  it('mock vendor 簽章錯 → 401 + audit warn', async () => {
    const u = await seedUser({ email: 'wh1@x' })
    const body = JSON.stringify({ event_id: 'e1', user_id: u.id, status: 'verified' })
    const resp = await webhookHandler({
      request: webhookReq(body, 'badsig'), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(401)
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'kyc.webhook.fail'`,
    ).first()
    expect(audit).not.toBeNull()
  })

  it('正確簽章 + verified payload → 200 + UPSERT user_kyc + critical audit', async () => {
    const u = await seedUser({ email: 'wh2@x' })
    const body = JSON.stringify({ event_id: 'e-good', user_id: u.id, status: 'verified', level: 'enhanced' })
    const sig = await hmacHex(env.KYC_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)
    expect((await resp.json()).ok).toBe(true)

    const k = await getUserKycStatus(env, u.id)
    expect(k.status).toBe(KYC_STATUS.VERIFIED)
    expect(k.level).toBe(KYC_LEVEL.ENHANCED)
    expect(k.vendor).toBe('mock')

    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'kyc.status.change' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')
  })

  it('重送同 event_id → 200 deduplicated（不重複處理）', async () => {
    const u = await seedUser({ email: 'wh3@x' })
    const body = JSON.stringify({ event_id: 'e-dup', user_id: u.id, status: 'verified' })
    const sig = await hmacHex(env.KYC_MOCK_SECRET, body)

    const r1 = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(r1.status).toBe(200)

    const r2 = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(r2.status).toBe(200)
    expect((await r2.json()).deduplicated).toBe(true)
  })

  it('rejected 也能套用', async () => {
    const u = await seedUser({ email: 'wh4@x' })
    await setUserKycStatus(env, u.id, { status: KYC_STATUS.PENDING, vendor: 'mock' })
    const body = JSON.stringify({
      event_id: 'e-rej', user_id: u.id, status: 'rejected',
      rejection_reason: 'document_unclear',
    })
    const sig = await hmacHex(env.KYC_MOCK_SECRET, body)
    const resp = await webhookHandler({
      request: webhookReq(body, sig), env, params: { vendor: 'mock' },
    })
    expect(resp.status).toBe(200)

    const row = await env.chiyigo_db.prepare(
      `SELECT status, rejection_reason FROM user_kyc WHERE user_id = ?`,
    ).bind(u.id).first()
    expect(row.status).toBe(KYC_STATUS.REJECTED)
    expect(row.rejection_reason).toBe('document_unclear')
  })
})
