/**
 * PR-C: login_attempts.kind 統一限流整合測試
 *
 * 驗證：
 *   1. 2FA verify 連續失敗 5 次 → 鎖定 (429)
 *   2. 2FA verify 成功 → 清除該 user 的 kind='2fa' 記錄
 *   3. login 限流不會被 2fa / email_send 計數污染（kind 隔離）
 *   4. oauth init per-IP 11 次內第 11 次 429
 *   5. 限流工具 unit-level：clear / record / check 行為
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { TOTP, Secret } from 'otpauth'
import {
  resetDb, seedUser, enableTotp, ensureJwtKeys, callFunction, jsonPost,
} from './_helpers.js'
import { onRequestPost as twofaVerify } from '../../functions/api/auth/2fa/verify.js'
import { onRequestPost as loginPost } from '../../functions/api/auth/local/login.js'
import { onRequestGet as oauthInit } from '../../functions/api/auth/oauth/[provider]/init.js'
import {
  checkRateLimit, recordRateLimit, clearRateLimit,
} from '../../functions/utils/rate-limit.js'
import { signJwt } from '../../functions/utils/jwt.js'

const TEST_SECRET = 'JBSWY3DPEHPK3PXP'

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})

beforeEach(async () => {
  await resetDb()
})

afterEach(() => vi.unstubAllGlobals())

// ── unit-level（透過真 D1）─────────────────────────────────────

describe('rate-limit util', () => {
  it('record 累計、check 在達上限時 blocked=true、clear 重置', async () => {
    const db = env.chiyigo_db
    for (let i = 0; i < 5; i++) {
      await recordRateLimit(db, { kind: '2fa', userId: 42, ip: '1.1.1.1' })
    }
    const r1 = await checkRateLimit(db, { kind: '2fa', userId: 42, windowSeconds: 300, max: 5 })
    expect(r1.count).toBe(5)
    expect(r1.blocked).toBe(true)

    await clearRateLimit(db, { kind: '2fa', userId: 42 })
    const r2 = await checkRateLimit(db, { kind: '2fa', userId: 42, windowSeconds: 300, max: 5 })
    expect(r2.count).toBe(0)
    expect(r2.blocked).toBe(false)
  })

  it('kind 隔離：login 計數不會被 2fa 污染', async () => {
    const db = env.chiyigo_db
    await recordRateLimit(db, { kind: '2fa', userId: 99, ip: '2.2.2.2' })
    await recordRateLimit(db, { kind: '2fa', userId: 99, ip: '2.2.2.2' })
    const r = await checkRateLimit(db, {
      kind: 'login', ip: '2.2.2.2', windowSeconds: 900, max: 20,
    })
    expect(r.count).toBe(0)
  })
})

// ── 2FA verify 鎖定 ───────────────────────────────────────────

describe('2FA verify rate limit', () => {
  async function preAuthToken(userId) {
    return signJwt(
      { sub: String(userId), scope: 'pre_auth', role: 'player', status: 'active', ver: 0 },
      '5m', env,
    )
  }
  function verifyReq(token, body) {
    return new Request('http://x/api/auth/2fa/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'CF-Connecting-IP': '3.3.3.3',
      },
      body: JSON.stringify(body),
    })
  }

  it('連續錯 OTP 5 次 → 第 6 次 429', async () => {
    const u = await seedUser({ email: 'totp@b.com', password: 'GoodPass#1234' })
    await enableTotp(u.id, TEST_SECRET)
    const token = await preAuthToken(u.id)

    for (let i = 0; i < 5; i++) {
      const res = await callFunction(twofaVerify, verifyReq(token, { otp_code: '000000' }))
      expect(res.status).toBe(401)  // Invalid OTP
    }
    const blocked = await callFunction(twofaVerify, verifyReq(token, { otp_code: '000000' }))
    expect(blocked.status).toBe(429)
    const body = await blocked.json()
    expect(body.code).toBe('RATE_LIMITED')
  })

  it('正確 OTP 成功 → 清除該 user 的 kind=2fa 計數', async () => {
    const u = await seedUser({ email: 'ok@b.com', password: 'GoodPass#1234' })
    await enableTotp(u.id, TEST_SECRET)
    const token = await preAuthToken(u.id)

    // 先錯 3 次
    for (let i = 0; i < 3; i++) {
      const res = await callFunction(twofaVerify, verifyReq(token, { otp_code: '000000' }))
      expect(res.status).toBe(401)
    }
    let cnt = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE kind='2fa' AND user_id=?`,
    ).bind(u.id).first()
    expect(cnt.n).toBe(3)

    // 真 OTP 通過
    const totp = new TOTP({
      algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(TEST_SECRET),
    })
    const goodCode = totp.generate()
    const ok = await callFunction(twofaVerify, verifyReq(token, { otp_code: goodCode }))
    expect(ok.status).toBe(200)

    cnt = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE kind='2fa' AND user_id=?`,
    ).bind(u.id).first()
    expect(cnt.n).toBe(0)
  })

  it('超過鎖定後再傳正確 OTP → 仍 429（不可繞過）', async () => {
    const u = await seedUser({ email: 'lock@b.com', password: 'GoodPass#1234' })
    await enableTotp(u.id, TEST_SECRET)
    const token = await preAuthToken(u.id)
    for (let i = 0; i < 5; i++) {
      await callFunction(twofaVerify, verifyReq(token, { otp_code: '000000' }))
    }
    const totp = new TOTP({
      algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(TEST_SECRET),
    })
    const goodCode = totp.generate()
    const res = await callFunction(twofaVerify, verifyReq(token, { otp_code: goodCode }))
    expect(res.status).toBe(429)
  })
})

// ── login（既有功能 + kind 隔離回歸）──────────────────────────

describe('login kind 隔離（回歸）', () => {
  it('被 2FA 寫入 kind=2fa 後，login 限流仍視為 0 次', async () => {
    const u = await seedUser({ email: 'iso@b.com', password: 'GoodPass#1234' })
    // 模擬 30 筆 2fa 失敗（同 IP），login 限流上限 IP=20，若沒 kind 隔離會直接 429
    for (let i = 0; i < 30; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, user_id) VALUES ('2fa', ?, ?)`,
      ).bind('1.2.3.4', u.id).run()
    }
    const res = await callFunction(loginPost, jsonPost(
      'http://x/api/auth/local/login',
      { email: 'iso@b.com', password: 'GoodPass#1234' },
      { 'CF-Connecting-IP': '1.2.3.4' },
    ))
    expect(res.status).toBe(200)
  })
})

// ── OAuth init per-IP 限流 ─────────────────────────────────────

describe('oauth init rate limit', () => {
  it('同 IP 第 11 次 → 429', async () => {
    env.GOOGLE_CLIENT_ID     = 'goog-cid'
    env.GOOGLE_CLIENT_SECRET = 'goog-sec'
    const ip = '9.9.9.9'

    for (let i = 0; i < 10; i++) {
      const res = await oauthInit({
        request: new Request('http://x/api/auth/oauth/google/init?platform=web', {
          headers: { 'CF-Connecting-IP': ip },
        }),
        env, params: { provider: 'google' },
        waitUntil: () => {}, data: {}, next: async () => new Response('next'),
      })
      expect(res.status).toBe(302)  // 前 10 次成功
    }

    const blocked = await oauthInit({
      request: new Request('http://x/api/auth/oauth/google/init?platform=web', {
        headers: { 'CF-Connecting-IP': ip },
      }),
      env, params: { provider: 'google' },
      waitUntil: () => {}, data: {}, next: async () => new Response('next'),
    })
    expect(blocked.status).toBe(429)
    const body = await blocked.json()
    expect(body.code).toBe('RATE_LIMITED')
  })
})
