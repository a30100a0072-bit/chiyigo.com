/**
 * Phase B / B4+B5 — user-level audit_log 整合測試
 *
 * 驗證：
 *  1. handler 觸發各事件 → audit_log 寫入正確 event_type / severity
 *  2. AUDIT_IP_SALT 缺值時 ip_hash=null（保守不存 raw IP）
 *  3. trace_id 從 X-Request-Id header 抽到 event_data.trace_id
 *  4. severity='critical' 不擋主流程（webhook 缺值即 noop）
 *  5. GET /api/admin/audit query API：filter / pagination / 角色守門
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser, jsonPost } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { safeUserAudit } from '../../functions/utils/user-audit.js'
import { onRequestPost as loginHandler } from '../../functions/api/auth/local/login.js'
import { onRequestGet as auditHandler } from '../../functions/api/admin/audit.js'

function reqWithSalt(extraEnv = {}) {
  return { ...env, ...extraEnv }
}

async function adminToken(userId) {
  return signJwt({ sub: String(userId), email: 'a@x', role: 'admin', status: 'active', ver: 0 },
    '15m', env, { audience: 'chiyigo' })
}

describe('Phase B audit_log writes', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('safeUserAudit 寫入 → audit_log 多一筆', async () => {
    await safeUserAudit(env, { event_type: 'auth.login.success', user_id: 42 })
    const row = await env.chiyigo_db
      .prepare(`SELECT event_type, severity, user_id, ip_hash FROM audit_log WHERE user_id = 42`)
      .first()
    expect(row.event_type).toBe('auth.login.success')
    expect(row.severity).toBe('info')
    expect(row.ip_hash).toBeNull() // 沒帶 request → 沒 IP
  })

  it('AUDIT_IP_SALT 缺值 → ip_hash=null（保守）', async () => {
    const request = new Request('http://x/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })
    await safeUserAudit(env, { event_type: 'auth.login.fail', user_id: 1, request })
    const row = await env.chiyigo_db
      .prepare(`SELECT ip_hash FROM audit_log WHERE user_id = 1`).first()
    expect(row.ip_hash).toBeNull()
  })

  it('AUDIT_IP_SALT 設定後 → ip_hash 為 SHA-256 hex（64 字元）', async () => {
    const request = new Request('http://x/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })
    await safeUserAudit(reqWithSalt({ AUDIT_IP_SALT: 'test-salt' }), {
      event_type: 'auth.login.fail', user_id: 2, request,
    })
    const row = await env.chiyigo_db
      .prepare(`SELECT ip_hash FROM audit_log WHERE user_id = 2`).first()
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('同一 IP 用同一鹽 hash 一致；換鹽後不一致', async () => {
    const r = new Request('http://x/', { headers: { 'CF-Connecting-IP': '5.5.5.5' } })
    await safeUserAudit(reqWithSalt({ AUDIT_IP_SALT: 'salt-A' }), { event_type: 'a', user_id: 10, request: r })
    await safeUserAudit(reqWithSalt({ AUDIT_IP_SALT: 'salt-A' }), { event_type: 'b', user_id: 10, request: r })
    await safeUserAudit(reqWithSalt({ AUDIT_IP_SALT: 'salt-B' }), { event_type: 'c', user_id: 10, request: r })
    const rows = await env.chiyigo_db
      .prepare(`SELECT event_type, ip_hash FROM audit_log WHERE user_id = 10 ORDER BY id ASC`).all()
    const [a, b, c] = rows.results
    expect(a.ip_hash).toBe(b.ip_hash)
    expect(a.ip_hash).not.toBe(c.ip_hash)
  })

  it('trace_id 從 X-Request-Id header 抽到 event_data', async () => {
    const request = new Request('http://x/', { headers: { 'X-Request-Id': 'trace-xyz-123' } })
    await safeUserAudit(env, { event_type: 'auth.login.success', user_id: 99, request })
    const row = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE user_id = 99`).first()
    expect(JSON.parse(row.event_data).trace_id).toBe('trace-xyz-123')
  })

  it('login.success → audit row 寫入', async () => {
    await seedUser({ email: 'l@x', password: 'Pass#1234' })
    const r = await loginHandler({
      request: jsonPost('http://x/api/auth/local/login', { email: 'l@x', password: 'Pass#1234' }),
      env,
    })
    expect(r.status).toBe(200)
    const row = await env.chiyigo_db
      .prepare(`SELECT event_type FROM audit_log WHERE event_type = 'auth.login.success'`).first()
    expect(row).toBeTruthy()
  })

  it('login.fail（密碼錯）→ audit warn', async () => {
    await seedUser({ email: 'l2@x', password: 'Pass#1234' })
    const r = await loginHandler({
      request: jsonPost('http://x/api/auth/local/login', { email: 'l2@x', password: 'WRONG' }),
      env,
    })
    expect(r.status).toBe(401)
    const row = await env.chiyigo_db
      .prepare(`SELECT event_type, severity FROM audit_log WHERE event_type = 'auth.login.fail'`).first()
    expect(row.severity).toBe('warn')
  })

  it('user_id=null 寫入合法（unknown email reset_request 場景）', async () => {
    await safeUserAudit(env, {
      event_type: 'account.password.reset_request',
      data: { reason_code: 'unknown_email' },
    })
    const row = await env.chiyigo_db
      .prepare(`SELECT user_id, event_data FROM audit_log WHERE event_type = 'account.password.reset_request'`)
      .first()
    expect(row.user_id).toBeNull()
    expect(JSON.parse(row.event_data).reason_code).toBe('unknown_email')
  })

  it('handler 失敗時 audit 也不擋（safeUserAudit catch all）', async () => {
    // 故意傳壞的 env（沒 chiyigo_db）→ 內部 catch 吞掉
    const broken = { ...env, chiyigo_db: null }
    await expect(safeUserAudit(broken, { event_type: 'x', user_id: 1 })).resolves.toBeUndefined()
  })
})

describe('GET /api/admin/audit', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  async function callAudit(token, queryString = '') {
    const url = `http://x/api/admin/audit${queryString ? '?' + queryString : ''}`
    const resp = await auditHandler({
      request: new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
      env,
    })
    return { status: resp.status, body: await resp.json() }
  }

  async function seedAudit(rows) {
    for (const r of rows) {
      await env.chiyigo_db
        .prepare(`INSERT INTO audit_log (event_type, severity, user_id) VALUES (?, ?, ?)`)
        .bind(r.event_type, r.severity ?? 'info', r.user_id ?? null).run()
    }
  }

  it('player 訪問 → 403', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const tok = await signJwt({ sub: String(id), role: 'player', status: 'active', ver: 0 },
      '15m', env, { audience: 'chiyigo' })
    const r = await callAudit(tok)
    expect(r.status).toBe(403)
  })

  it('admin 無 filter → 回所有 row（pagination 預設）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'auth.login.success', user_id: 1 },
      { event_type: 'auth.login.fail',    user_id: 2, severity: 'warn' },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok)
    expect(r.status).toBe(200)
    expect(r.body.total).toBe(2)
    expect(r.body.rows.length).toBe(2)
    // 由新到舊
    expect(r.body.rows[0].event_type).toBe('auth.login.fail')
  })

  it("filter user_id", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'auth.login.success', user_id: 100 },
      { event_type: 'auth.login.success', user_id: 200 },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'user_id=200')
    expect(r.body.total).toBe(1)
    expect(r.body.rows[0].user_id).toBe(200)
  })

  it("filter event_type", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'auth.login.success' },
      { event_type: 'auth.login.fail', severity: 'warn' },
      { event_type: 'auth.login.fail', severity: 'warn' },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'event_type=auth.login.fail')
    expect(r.body.total).toBe(2)
  })

  it("filter severity", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'a', severity: 'info' },
      { event_type: 'b', severity: 'warn' },
      { event_type: 'c', severity: 'critical' },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'severity=critical')
    expect(r.body.total).toBe(1)
    expect(r.body.rows[0].event_type).toBe('c')
  })

  it("severity 非法值 → 400", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'severity=PANIC')
    expect(r.status).toBe(400)
  })

  it("pagination limit 超過 200 → clamp", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'limit=999')
    expect(r.body.limit).toBe(200)
  })
})
