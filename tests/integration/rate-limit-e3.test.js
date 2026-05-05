/**
 * Phase E3 — Rate limiting at IdP 整合測試
 *
 * 涵蓋四個 spec 端點的限流（既有 step-up 5→3 的回歸測試已在 step-up.test.js 改）：
 *  - /api/auth/refresh         30/user/min
 *  - /api/auth/oauth/token     10/IP/min
 *  - login email scope         （已在 login.test.js 涵蓋；此處補 helper 自身的 email 過濾）
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { generateSecureToken, hashToken } from '../../functions/utils/crypto.js'
import { onRequestPost as refreshHandler } from '../../functions/api/auth/refresh.js'
import { onRequestPost as tokenHandler } from '../../functions/api/auth/oauth/token.js'
import { checkRateLimit } from '../../functions/utils/rate-limit.js'

async function seedRT(userId, deviceUuid = null) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + 7 * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).bind(userId, hash, deviceUuid, exp).run()
  return plain
}

function jsonReq(url, body, headers = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('rate-limit helper — email scope（Phase E3 擴充）', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('email 過濾正確：只算同 email + 同 kind', async () => {
    for (let i = 0; i < 5; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, email) VALUES ('login', ?)`,
      ).bind('a@x').run()
    }
    await env.chiyigo_db.prepare(
      `INSERT INTO login_attempts (kind, email) VALUES ('login', ?)`,
    ).bind('b@x').run()

    const a = await checkRateLimit(env.chiyigo_db, {
      kind: 'login', email: 'a@x', windowSeconds: 900, max: 5,
    })
    const b = await checkRateLimit(env.chiyigo_db, {
      kind: 'login', email: 'b@x', windowSeconds: 900, max: 5,
    })
    expect(a).toEqual({ blocked: true,  count: 5 })
    expect(b).toEqual({ blocked: false, count: 1 })
  })
})

describe('POST /api/auth/refresh — rate limit 30/user/min（Phase E3）', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('30 筆 refresh 計數 + 第 31 次 → 429', async () => {
    const u = await seedUser({ email: 'rl-refresh@x' })
    // 預先塞 30 筆 refresh 計數（同 user）
    for (let i = 0; i < 30; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, user_id) VALUES ('refresh', ?)`,
      ).bind(u.id).run()
    }
    const tok = await seedRT(u.id)
    const resp = await refreshHandler({
      request: jsonReq('http://x/api/auth/refresh', { refresh_token: tok }),
      env,
    })
    expect(resp.status).toBe(429)
    const body = await resp.json()
    expect(body.code).toBe('RATE_LIMITED')
    // audit 記入
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.refresh.rate_limited' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit).not.toBeNull()
  })

  it('別 user 不受影響（per-user 隔離）', async () => {
    const a = await seedUser({ email: 'isoa@x' })
    const b = await seedUser({ email: 'isob@x' })
    for (let i = 0; i < 30; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, user_id) VALUES ('refresh', ?)`,
      ).bind(a.id).run()
    }
    const tokB = await seedRT(b.id)
    const resp = await refreshHandler({
      request: jsonReq('http://x/api/auth/refresh', { refresh_token: tokB }),
      env,
    })
    expect(resp.status).toBe(200)  // b 不受 a 的 30 筆影響
  })

  it('成功 refresh 也記入計數（不止 fail）', async () => {
    const u = await seedUser({ email: 'rec@x' })
    const tok = await seedRT(u.id)
    const r = await refreshHandler({
      request: jsonReq('http://x/api/auth/refresh', { refresh_token: tok }),
      env,
    })
    expect(r.status).toBe(200)
    const cnt = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE kind = 'refresh' AND user_id = ?`,
    ).bind(u.id).first()
    expect(cnt.n).toBe(1)
  })
})

describe('POST /api/auth/oauth/token — rate limit 10/IP/min（Phase E3）', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('同 IP 第 11 次（無效 code 也算）→ 429', async () => {
    const ip = '8.8.8.8'
    // 先填 10 筆 oauth_token 計數
    for (let i = 0; i < 10; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip) VALUES ('oauth_token', ?)`,
      ).bind(ip).run()
    }
    const resp = await tokenHandler({
      request: jsonReq('http://x/api/auth/oauth/token',
        { code: 'fake', code_verifier: 'fake', redirect_uri: 'https://x/cb' },
        { 'CF-Connecting-IP': ip }),
      env,
    })
    expect(resp.status).toBe(429)
    const body = await resp.json()
    expect(body.code).toBe('RATE_LIMITED')

    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'oauth.token.rate_limited'`,
    ).first()
    expect(audit).not.toBeNull()
  })

  it('別 IP 不受影響', async () => {
    for (let i = 0; i < 10; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip) VALUES ('oauth_token', ?)`,
      ).bind('1.1.1.1').run()
    }
    const resp = await tokenHandler({
      request: jsonReq('http://x/api/auth/oauth/token',
        { code: 'fake', code_verifier: 'fake', redirect_uri: 'https://x/cb' },
        { 'CF-Connecting-IP': '2.2.2.2' }),
      env,
    })
    // 2.2.2.2 還沒滿 → 不會撞 RL；但 code 是假的 → 會 400（非 429）
    expect(resp.status).toBe(400)
  })

  it('成功 / 失敗的 token 請求都記入計數', async () => {
    const ip = '3.3.3.3'
    // 跑一次 → 應記 1 筆（後面 code 驗失敗 400，但計數已寫）
    await tokenHandler({
      request: jsonReq('http://x/api/auth/oauth/token',
        { code: 'fake', code_verifier: 'fake', redirect_uri: 'https://x/cb' },
        { 'CF-Connecting-IP': ip }),
      env,
    })
    const cnt = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE kind = 'oauth_token' AND ip = ?`,
    ).bind(ip).first()
    expect(cnt.n).toBe(1)
  })
})
