/**
 * P4 P2 機械補強 — pre-fix RED repro（窗內修第一顆）
 *
 * 覆蓋三條 confirmed finding 的 EXACT failure mode（pre-fix 必 fail、post-fix pass）：
 *
 *  SEC-CEREMONY-DOS：
 *   - webauthn/login-options 匿名無 rate-limit → 無界寫 D1（pre-fix 第 31 次仍 200）
 *   - webauthn/login-verify 無 rate-limit（pre-fix 第 31 次仍進流程非 429）
 *   - oauth/authorize 無 rate-limit（pre-fix 第 61 次仍 302）
 *   - webauthn_challenges 不在 cron cleanup → 過期 challenge 永不被掃（pre-fix 留存）
 *
 *  SEC-ADMIN-ENUM：
 *   - admin/users 無 admin_read rate-limit（pre-fix 第 61 次仍 200）+ 無 read-audit（pre-fix 無 row）
 *   - admin/metrics 無 read-audit（pre-fix 無 row）+ top-IP 回 raw（pre-fix 有 `ip` 欄）
 *
 *  SEC-KYC-ENUM-2：
 *   - resolveKycAdapter 原型鏈鍵未守門（pre-fix 回 truthy Object 成員，非 null）
 *   - webhooks/kyc/[vendor] 對 __proto__ 走到 adapter.parseWebhook → TypeError/500（post-fix 400）
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { resolveKycAdapter } from '../../functions/utils/kyc'
import { onRequestGet as usersHandler } from '../../functions/api/admin/users'
import { onRequestGet as metricsHandler } from '../../functions/api/admin/metrics'
import { onRequestPost as loginOptionsHandler } from '../../functions/api/auth/webauthn/login-options'
import { onRequestPost as loginVerifyHandler } from '../../functions/api/auth/webauthn/login-verify'
import { onRequestGet as authorizeHandler } from '../../functions/api/auth/oauth/authorize'
import { onRequestPost as cleanupHandler } from '../../functions/api/admin/cron/cleanup'
import { onRequestPost as kycWebhookHandler } from '../../functions/api/webhooks/kyc/[vendor]'

const TEST_IP = '9.9.9.9'

async function adminToken(userId: number) {
  return signJwt({
    sub: String(userId), email: 'admin@x', role: 'admin', status: 'active', ver: 0,
  }, '15m', env, { audience: 'chiyigo' })
}

function getReq(url: string, token?: string, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extraHeaders }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request(url, { headers })
}

function jsonPostIp(url: string, body: unknown, ip = TEST_IP) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  })
}

// ───────────────────────────────────────────────────────────────────
describe('SEC-KYC-ENUM-2: resolveKycAdapter 原型鏈守門', () => {
  it('原型鏈鍵 (__proto__/constructor/toString) → null（pre-fix 回 truthy Object 成員）', () => {
    expect(resolveKycAdapter('__proto__')).toBeNull()
    expect(resolveKycAdapter('constructor')).toBeNull()
    expect(resolveKycAdapter('toString')).toBeNull()
    expect(resolveKycAdapter('hasOwnProperty')).toBeNull()
  })

  it('未知 vendor → null；真實 own-property vendor (mock) → truthy', () => {
    expect(resolveKycAdapter('nope')).toBeNull()
    expect(resolveKycAdapter('mock')).toBeTruthy()
  })

  it('POST /api/webhooks/kyc/__proto__ → 400 UNKNOWN_KYC_VENDOR（pre-fix TypeError→500）', async () => {
    const resp = await kycWebhookHandler({
      request: jsonPostIp('http://x/api/webhooks/kyc/__proto__', {}),
      env, params: { vendor: '__proto__' },
    })
    expect(resp.status).toBe(400)
    const body = await resp.json()
    expect(body.code).toBe('UNKNOWN_KYC_VENDOR')
  })
})

// ───────────────────────────────────────────────────────────────────
describe('SEC-CEREMONY-DOS: ceremony 端點 rate-limit + cleanup', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('webauthn/login-options 匿名 31 連發同 IP → 第 31 次 429（pre-fix 全 200）', async () => {
    let last = 0
    for (let i = 0; i < 31; i++) {
      const resp = await loginOptionsHandler({
        request: jsonPostIp('http://x/api/auth/webauthn/login-options', {}),
        env,
      })
      last = resp.status
    }
    expect(last).toBe(429)
  })

  it('webauthn/login-verify 31 連發同 IP → 第 31 次 429（pre-fix 全進驗證流程非 429）', async () => {
    let last = 0
    for (let i = 0; i < 31; i++) {
      const resp = await loginVerifyHandler({
        request: jsonPostIp('http://x/api/auth/webauthn/login-verify', { response: {} }),
        env,
      })
      last = resp.status
    }
    expect(last).toBe(429)
  })

  it('oauth/authorize 61 連發同 IP → 第 61 次 429（pre-fix 全 302）', async () => {
    const base = 'http://x/api/auth/oauth/authorize'
      + '?response_type=code'
      + '&redirect_uri=' + encodeURIComponent('http://127.0.0.1:8080/callback')
      + '&code_challenge=abc123'
      + '&code_challenge_method=S256'
      + '&state=s1'
    let last = 0
    for (let i = 0; i < 61; i++) {
      const resp = await authorizeHandler({ request: getReq(base, undefined, { 'CF-Connecting-IP': TEST_IP }), env })
      last = resp.status
    }
    expect(last).toBe(429)
  })

  it('cron cleanup 清除過期 webauthn_challenges（pre-fix 表不在 TASKS → 留存）', async () => {
    // 過期 challenge（expires_at 已過去）
    await env.chiyigo_db
      .prepare(`INSERT INTO webauthn_challenges (challenge, user_id, ceremony, expires_at)
                VALUES (?, ?, ?, datetime('now','-1 hour'))`)
      .bind('expired-challenge-1', null, 'login').run()
    // 未過期 challenge（不該被刪）
    await env.chiyigo_db
      .prepare(`INSERT INTO webauthn_challenges (challenge, user_id, ceremony, expires_at)
                VALUES (?, ?, ?, datetime('now','+1 hour'))`)
      .bind('live-challenge-1', null, 'login').run()

    const resp = await cleanupHandler({
      request: new Request('http://x/api/admin/cron/cleanup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CRON_SECRET}`, 'Content-Type': 'application/json' },
      }),
      env,
    })
    expect(resp.status).toBe(200)

    const expired = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM webauthn_challenges WHERE challenge = 'expired-challenge-1'`).first()
    expect(Number(expired.c)).toBe(0)   // pre-fix: 1（未被清）
    const live = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM webauthn_challenges WHERE challenge = 'live-challenge-1'`).first()
    expect(Number(live.c)).toBe(1)      // 未過期不動
  })
})

// ───────────────────────────────────────────────────────────────────
describe('SEC-ADMIN-ENUM: admin/users + metrics rate-limit + read-audit', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('admin/users 61 連發同 admin → 第 61 次 429（pre-fix 全 200）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    let last = 0
    for (let i = 0; i < 61; i++) {
      const resp = await usersHandler({ request: getReq('http://x/api/admin/users', tok), env })
      last = resp.status
    }
    expect(last).toBe(429)
  })

  it('admin/users 一次 GET → 寫 admin.users.read read-audit（pre-fix 無 row）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedUser({ email: 'u1@x' })
    const tok = await adminToken(id)
    const resp = await usersHandler({ request: getReq('http://x/api/admin/users?q=u1', tok), env })
    expect(resp.status).toBe(200)

    const audit = await env.chiyigo_db
      .prepare(`SELECT event_type, event_data FROM audit_log WHERE event_type = 'admin.users.read' AND user_id = ?`)
      .bind(id).first()
    expect(audit).toBeTruthy()
    expect(audit.event_data).toContain('result_count')
    expect(audit.event_data).toContain('"q":"u1"')
  })

  it('admin/metrics 一次 GET → 寫 admin.metrics.read read-audit + top-IP 為 hmac16 非 raw（pre-fix 無 audit + raw ip）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    // seed 一筆 login 失敗紀錄（帶 raw ip）讓 top-IP query 有資料
    await env.chiyigo_db
      .prepare(`INSERT INTO login_attempts (kind, ip, email, user_id) VALUES ('login', '1.2.3.4', 'v@x', NULL)`)
      .run()

    const resp = await metricsHandler({ request: getReq('http://x/api/admin/metrics', tok), env })
    expect(resp.status).toBe(200)
    const body = await resp.json()

    // read-audit row 存在
    const audit = await env.chiyigo_db
      .prepare(`SELECT 1 FROM audit_log WHERE event_type = 'admin.metrics.read' AND user_id = ?`).bind(id).first()
    expect(audit).toBeTruthy()

    // top-IP 不得回 raw ip 欄；應為 ip_hmac16
    const top = body.auth.login_top_ips_24h
    expect(Array.isArray(top)).toBe(true)
    expect(top.length).toBeGreaterThanOrEqual(1)
    expect(top[0].ip).toBeUndefined()         // pre-fix: '1.2.3.4'
    expect(typeof top[0].ip_hmac16).toBe('string')
    expect(top[0].ip_hmac16).not.toContain('1.2.3.4')
  })
})
