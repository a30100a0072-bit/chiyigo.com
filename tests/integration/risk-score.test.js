/**
 * Phase E-2 — Risk-based authentication 整合測試
 *
 * 涵蓋：
 *  - utils/risk-score.js 的 computeRiskScore（4 個 signal 各自 + 累加）
 *  - login.js 接點：低 / 中 / 高分各分支（high → 403 RISK_BLOCKED + email + audit critical）
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser, callFunction, jsonPost } from './_helpers.js'
import {
  computeRiskScore,
  hashUa,
  shouldDenyByRisk,
  isRiskMedium,
  RISK_LEVEL_HIGH,
  RISK_LEVEL_MEDIUM,
} from '../../functions/utils/risk-score.js'
import { onRequestPost as loginPost } from '../../functions/api/auth/local/login.js'

// 攔 fetch 觀察 Resend email 端點（同 device-alerts test 的策略）
const mailLog = []
const origFetch = globalThis.fetch
function installFetchSpy() {
  mailLog.length = 0
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (url && url.includes('api.resend.com')) {
      mailLog.push({ url, body: init?.body ? JSON.parse(init.body) : null })
      return new Response(JSON.stringify({ id: 'mock' }), { status: 200 })
    }
    return origFetch(input, init)
  }
}
function restoreFetch() { globalThis.fetch = origFetch }

afterAll(() => { restoreFetch() })

function reqWith({ country = null, ua = 'Mozilla/5.0', ip = '1.1.1.1' } = {}) {
  const req = new Request('http://x/', {
    headers: { 'User-Agent': ua, 'CF-Connecting-IP': ip, 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (country) Object.defineProperty(req, 'cf', { value: { country } })
  return req
}

async function seedSuccessAudit(userId, { country = 'TW', uaHash = 'abc123def456', daysAgo = 0 } = {}) {
  const data = JSON.stringify({ method: 'password', country, ua_hash: uaHash })
  await env.chiyigo_db.prepare(
    `INSERT INTO audit_log (event_type, severity, user_id, event_data, created_at)
     VALUES ('auth.login.success', 'info', ?, ?, datetime('now', ?))`,
  ).bind(userId, data, `-${daysAgo} days`).run()
}

describe('utils/risk-score — computeRiskScore', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒前次紀錄 → score=0（首登）', async () => {
    const u = await seedUser({ email: 'first@x' })
    const r = await computeRiskScore(env, reqWith({ country: 'TW' }), { userId: u.id, email: 'first@x' })
    expect(r.score).toBe(0)
    expect(r.factors).toEqual([])
  })

  it('country 變動 → +35', async () => {
    const u = await seedUser({ email: 'cc@x' })
    await seedSuccessAudit(u.id, { country: 'TW' })
    const r = await computeRiskScore(env, reqWith({ country: 'JP' }), { userId: u.id, email: 'cc@x' })
    expect(r.score).toBeGreaterThanOrEqual(35)
    expect(r.factors).toContain('country_change')
  })

  it('UA hash 變動 → +20', async () => {
    const u = await seedUser({ email: 'ua@x' })
    const oldUa = await hashUa('Old/UA')
    await seedSuccessAudit(u.id, { country: 'TW', uaHash: oldUa })
    const r = await computeRiskScore(env, reqWith({ country: 'TW', ua: 'Brand-New-Browser/1.0' }), {
      userId: u.id, email: 'ua@x',
    })
    expect(r.score).toBe(20)
    expect(r.factors).toEqual(['ua_change'])
  })

  it('UA 完全相同 → 不加分', async () => {
    const u = await seedUser({ email: 'sameua@x' })
    const sameUa = 'Mozilla/5.0 ChromeXyz'
    const sameHash = await hashUa(sameUa)
    await seedSuccessAudit(u.id, { country: 'TW', uaHash: sameHash })
    const r = await computeRiskScore(env, reqWith({ country: 'TW', ua: sameUa }), {
      userId: u.id, email: 'sameua@x',
    })
    expect(r.score).toBe(0)
  })

  it('近期失敗 ≥3 次 → +recent_fails', async () => {
    const u = await seedUser({ email: 'fl@x' })
    for (let i = 0; i < 4; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, email) VALUES ('login', '1.1.1.1', 'fl@x')`,
      ).run()
    }
    const r = await computeRiskScore(env, reqWith({ country: null }), { userId: u.id, email: 'fl@x' })
    expect(r.factors).toContain('recent_fails')
    expect(r.score).toBeGreaterThanOrEqual(30)  // 4 fails * 10 capped at 30
  })

  it('多 signal 累加（country + UA + fails）→ 高分', async () => {
    const u = await seedUser({ email: 'multi@x' })
    await seedSuccessAudit(u.id, { country: 'TW', uaHash: 'oldhashxyz' })
    for (let i = 0; i < 5; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, email) VALUES ('login', '1.1.1.1', 'multi@x')`,
      ).run()
    }
    const r = await computeRiskScore(env, reqWith({ country: 'JP', ua: 'New/UA' }), {
      userId: u.id, email: 'multi@x',
    })
    expect(r.score).toBeGreaterThanOrEqual(RISK_LEVEL_HIGH)
    expect(r.factors).toEqual(expect.arrayContaining(['country_change', 'ua_change', 'recent_fails']))
  })

  it('test 環境沒 cf.country → country signal 不觸發', async () => {
    const u = await seedUser({ email: 'nocf@x' })
    await seedSuccessAudit(u.id, { country: 'TW' })
    const r = await computeRiskScore(env, reqWith({ country: null }), { userId: u.id, email: 'nocf@x' })
    expect(r.factors).not.toContain('country_change')
  })

  it('helper：shouldDenyByRisk / isRiskMedium', () => {
    expect(shouldDenyByRisk(70)).toBe(true)
    expect(shouldDenyByRisk(69)).toBe(false)
    expect(isRiskMedium(30)).toBe(true)
    expect(isRiskMedium(29)).toBe(false)
    expect(isRiskMedium(70)).toBe(false)
    expect(RISK_LEVEL_MEDIUM).toBe(30)
    expect(RISK_LEVEL_HIGH).toBe(70)
  })
})

describe('login.js E-2 整合', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    installFetchSpy()
    env.RESEND_API_KEY = 'test-key'
  })

  function loginReq(body, ip = '5.5.5.5', ua = 'Mozilla/5.0') {
    return jsonPost('http://x/api/auth/local/login', body, {
      'CF-Connecting-IP': ip,
      'User-Agent': ua,
    })
  }

  it('低風險 → 200 + audit data 含 risk_score=0', async () => {
    await seedUser({ email: 'low@x', password: 'GoodPass#1234' })
    const res = await callFunction(loginPost, loginReq({ email: 'low@x', password: 'GoodPass#1234' }))
    expect(res.status).toBe(200)

    const audit = await env.chiyigo_db.prepare(
      `SELECT event_data FROM audit_log
        WHERE event_type = 'auth.login.success' AND user_id = (SELECT id FROM users WHERE email = 'low@x')`,
    ).first()
    const data = JSON.parse(audit.event_data)
    expect(data.risk_score).toBe(0)
    expect(data.ua_hash).toBeTruthy()
  })

  it('中風險 → 200 + 寫 auth.risk.medium audit', async () => {
    const u = await seedUser({ email: 'med@x', password: 'GoodPass#1234' })
    // 預埋 4 筆 fail（30s 前 — 過 cooldown 5s 但仍在 recent_fails 30min 內）
    // ip 不同避開 5/IP/min；email 同 → 算 recent_fails 但不撞 10/email/15min
    for (let i = 0; i < 4; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, email, created_at)
         VALUES ('login', ?, 'med@x', datetime('now', '-30 seconds'))`,
      ).bind(`192.168.99.${i}`).run()
    }
    void u
    const res = await callFunction(loginPost, loginReq({ email: 'med@x', password: 'GoodPass#1234' }))
    expect(res.status).toBe(200)
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.risk.medium' AND user_id = (SELECT id FROM users WHERE email = 'med@x')`,
    ).first()
    expect(audit).not.toBeNull()
  })

  it('高風險 → 403 RISK_BLOCKED + critical audit + email', async () => {
    const u = await seedUser({ email: 'hi@x', password: 'GoodPass#1234' })
    // 預埋 1 筆過去成功（country=TW + 舊 UA hash）
    await seedSuccessAudit(u.id, { country: 'TW', uaHash: 'oldhash000000' })
    // 預埋 5 筆 fail（不同 IP 避 5/IP/min；不同分鐘避 10/email/15min）
    for (let i = 0; i < 5; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, email, created_at)
         VALUES ('login', ?, 'hi@x', datetime('now', '-2 minutes'))`,
      ).bind(`172.16.0.${i}`).run()
    }
    // 製造 country_change(35) + ua_change(20) + recent_fails(20) = 75 ≥ 70
    const req = new Request('http://x/api/auth/local/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '99.99.99.99',
        'User-Agent': 'Brand-New-UA/2.0',
      },
      body: JSON.stringify({ email: 'hi@x', password: 'GoodPass#1234' }),
    })
    Object.defineProperty(req, 'cf', { value: { country: 'JP' } })

    const res = await callFunction(loginPost, req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('RISK_BLOCKED')

    const audit = await env.chiyigo_db.prepare(
      `SELECT severity, event_data FROM audit_log
        WHERE event_type = 'auth.risk.blocked' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')
    const data = JSON.parse(audit.event_data)
    expect(data.score).toBeGreaterThanOrEqual(70)

    expect(mailLog).toHaveLength(1)
    expect(mailLog[0].body.to).toBe('hi@x')
    expect(mailLog[0].body.subject).toMatch(/高風險/)
  })
})
