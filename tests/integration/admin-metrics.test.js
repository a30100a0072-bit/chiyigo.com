/**
 * /api/admin/metrics 整合測試
 *
 * 驗證：
 *   1. 未授權 → 401
 *   2. role=player → 403 INSUFFICIENT_ROLE
 *   3. role=admin → 200，回傳結構完整
 *   4. 聚合計數正確（insert 假資料後比對）
 *   5. audit chain valid 在無資料時為 true
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, ensureJwtKeys } from './_helpers.js'
import { onRequestGet as metricsGet } from '../../functions/api/admin/metrics.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { appendAuditLog } from '../../functions/utils/audit-log.js'

function authReq(token) {
  return new Request('http://x/api/admin/metrics', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

async function adminToken(userId = 1, role = 'admin') {
  return signJwt(
    { sub: String(userId), email: 'admin@x', role, status: 'active', ver: 0 },
    '5m', env,
  )
}

async function callMetrics(token) {
  return metricsGet({
    request: authReq(token), env,
    params: {}, waitUntil: () => {}, data: {}, next: async () => new Response('next'),
  })
}

beforeAll(async () => { await ensureJwtKeys(); await resetDb() })
beforeEach(async () => { await resetDb() })

describe('GET /api/admin/metrics', () => {
  it('無 Authorization → 401', async () => {
    const res = await callMetrics(null)
    expect(res.status).toBe(401)
  })

  it('player role → 403 INSUFFICIENT_ROLE', async () => {
    const u = await seedUser({ email: 'p@x' })
    const tok = await signJwt(
      { sub: String(u.id), email: 'p@x', role: 'player', status: 'active', ver: 0 },
      '5m', env,
    )
    const res = await callMetrics(tok)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('INSUFFICIENT_ROLE')
  })

  it('admin role → 200 + 完整結構', async () => {
    const u = await seedUser({ email: 'a@x' })
    await env.chiyigo_db.prepare(`UPDATE users SET role='admin' WHERE id=?`).bind(u.id).run()
    const tok = await adminToken(u.id, 'admin')
    const res = await callMetrics(tok)
    expect(res.status).toBe(200)
    const body = await res.json()

    // top-level keys
    expect(body).toHaveProperty('generated_at')
    expect(body).toHaveProperty('users')
    expect(body).toHaveProperty('auth')
    expect(body).toHaveProperty('sessions')
    expect(body).toHaveProperty('audit')
    expect(body).toHaveProperty('ai')

    // users 子結構
    expect(typeof body.users.total).toBe('number')
    expect(body.users.by_status).toBeTypeOf('object')
    expect(body.users.by_role).toBeTypeOf('object')

    // auth 子結構
    expect(typeof body.auth.login_failures_24h).toBe('number')
    expect(Array.isArray(body.auth.login_top_ips_24h)).toBe(true)
    expect(typeof body.auth.twofa_failures_24h).toBe('number')

    // 空 audit 表 → chain valid
    expect(body.audit.chain_integrity.valid).toBe(true)
    expect(body.audit.chain_integrity.total).toBe(0)
  })

  it('insert 假資料 → metrics 反映正確 count', async () => {
    const admin = await seedUser({ email: 'admin@x' })
    await env.chiyigo_db.prepare(`UPDATE users SET role='admin' WHERE id=?`).bind(admin.id).run()

    // 5 筆 login 失敗、3 筆 2FA 失敗、2 筆 oauth_init、1 筆 email_send
    for (let i = 0; i < 5; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, email) VALUES ('login', ?, ?)`,
      ).bind(`1.1.1.${i}`, `bad${i}@x`).run()
    }
    for (let i = 0; i < 3; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, user_id) VALUES ('2fa', '2.2.2.2', ?)`,
      ).bind(admin.id).run()
    }
    for (let i = 0; i < 2; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip) VALUES ('oauth_init', '3.3.3.3')`,
      ).run()
    }
    await env.chiyigo_db.prepare(
      `INSERT INTO login_attempts (kind, ip) VALUES ('email_send', '4.4.4.4')`,
    ).run()

    // 1 筆有效 refresh token
    const fut = new Date(Date.now() + 7 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, 'h1', ?)`,
    ).bind(admin.id, fut).run()

    // 2 筆 audit log（hash chain）
    await appendAuditLog(env.chiyigo_db, {
      admin_id: admin.id, admin_email: 'admin@x', action: 'ban',
      target_id: 99, target_email: 't@x', ip_address: null,
    })
    await appendAuditLog(env.chiyigo_db, {
      admin_id: admin.id, admin_email: 'admin@x', action: 'unban',
      target_id: 99, target_email: 't@x', ip_address: null,
    })

    const tok = await adminToken(admin.id, 'admin')
    const res = await callMetrics(tok)
    const body = await res.json()

    expect(body.auth.login_failures_24h).toBe(5)
    expect(body.auth.twofa_failures_24h).toBe(3)
    expect(body.auth.oauth_init_calls_1h).toBe(2)
    expect(body.auth.email_send_calls_24h).toBe(1)
    expect(body.sessions.active_refresh_tokens).toBe(1)
    expect(body.audit.total_entries).toBe(2)
    expect(body.audit.ban_7d).toBe(1)
    expect(body.audit.unban_7d).toBe(1)
    expect(body.audit.chain_integrity.valid).toBe(true)
    expect(body.audit.chain_integrity.total).toBe(2)
  })
})
