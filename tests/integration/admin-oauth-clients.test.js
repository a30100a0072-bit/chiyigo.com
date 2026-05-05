/**
 * Phase C-1 Wave 3 — Admin oauth_clients CRUD 整合測試
 *
 * 端點：
 *   GET    /api/admin/oauth-clients
 *   POST   /api/admin/oauth-clients
 *   GET    /api/admin/oauth-clients/:client_id
 *   PATCH  /api/admin/oauth-clients/:client_id
 *   DELETE /api/admin/oauth-clients/:client_id
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import {
  refreshClientsCache,
  invalidateClientsCache,
  getAllClients,
  _resetCacheForTests,
} from '../../functions/utils/oauth-clients.js'
import {
  onRequestGet  as listHandler,
  onRequestPost as createHandler,
} from '../../functions/api/admin/oauth-clients.js'
import {
  onRequestGet    as getOneHandler,
  onRequestPatch  as patchHandler,
  onRequestDelete as deleteHandler,
} from '../../functions/api/admin/oauth-clients/[client_id].js'

async function adminToken(userId) {
  return signJwt(
    { sub: String(userId), email: 'a@x', role: 'admin', status: 'active', ver: 0 },
    '15m', env, { audience: 'chiyigo' },
  )
}

async function call(handler, { token, method = 'GET', body = null, params = {}, query = '' }) {
  const url = `http://x/api/admin/oauth-clients${query ? '?' + query : ''}`
  const headers = token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : {}
  const init = { method, headers }
  if (body !== null) init.body = JSON.stringify(body)
  const resp = await handler({ request: new Request(url, init), env, params })
  return { status: resp.status, body: await resp.json() }
}

const VALID_BODY = {
  client_id:     'test-rp-1',
  client_name:   'Test RP 1',
  redirect_uris: ['https://test-rp-1.example/cb'],
  origins:       ['https://test-rp-1.example'],
}

describe('Admin oauth-clients CRUD', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    _resetCacheForTests()
    await invalidateClientsCache(env)
  })

  // ── 角色守門 ─────────────────────────────────────────────────
  it('non-admin → 403', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const tok = await signJwt(
      { sub: String(id), role: 'player', status: 'active', ver: 0 },
      '15m', env, { audience: 'chiyigo' },
    )
    const r = await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })
    expect(r.status).toBe(403)
  })

  it('no token → 401', async () => {
    const r = await call(createHandler, { method: 'POST', body: VALID_BODY })
    expect(r.status).toBe(401)
  })

  // ── POST validation ──────────────────────────────────────────
  it('POST happy path → 201 + cache invalidate + audit row', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)

    const r = await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })
    expect(r.status).toBe(201)
    expect(r.body).toMatchObject({ client_id: 'test-rp-1' })

    // D1 row 寫入
    const row = await env.chiyigo_db
      .prepare(`SELECT client_id, aud, is_active FROM oauth_clients WHERE client_id = ?`)
      .bind('test-rp-1').first()
    expect(row.aud).toBe('test-rp-1')
    expect(row.is_active).toBe(1)

    // Refresh cache 後 sync getter 看得到
    await refreshClientsCache(env, true)
    expect(getAllClients().some(c => c.client_id === 'test-rp-1')).toBe(true)

    // admin_audit_log 寫入
    const audit = await env.chiyigo_db
      .prepare(`SELECT action, target_email FROM admin_audit_log ORDER BY id DESC LIMIT 1`)
      .first()
    expect(audit.action).toBe('oauth_client.create')
    expect(audit.target_email).toBe('oauth_client:test-rp-1')
  })

  it('POST 重複 client_id → 409', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })
    const r = await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('CLIENT_ID_TAKEN')
  })

  it('POST client_id 格式不合法 → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(createHandler, {
      token: tok, method: 'POST',
      body: { ...VALID_BODY, client_id: 'BadID!' },
    })
    expect(r.status).toBe(400)
  })

  it('POST redirect_uris 空陣列 → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(createHandler, {
      token: tok, method: 'POST',
      body: { ...VALID_BODY, redirect_uris: [] },
    })
    expect(r.status).toBe(400)
  })

  it('POST redirect_uri 用 http (非 loopback) → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(createHandler, {
      token: tok, method: 'POST',
      body: { ...VALID_BODY, redirect_uris: ['http://evil.example/cb'] },
    })
    expect(r.status).toBe(400)
  })

  it('POST 接受 chiyigo:// scheme + http://127.0.0.1:port', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(createHandler, {
      token: tok, method: 'POST',
      body: {
        ...VALID_BODY,
        client_id: 'mobile-rp',
        redirect_uris: ['chiyigo://auth/cb', 'http://127.0.0.1:8080/callback'],
      },
    })
    expect(r.status).toBe(201)
  })

  // ── GET list ─────────────────────────────────────────────────
  it('GET list 預設只回 is_active=1', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })
    await call(createHandler, { token: tok, method: 'POST',
      body: { ...VALID_BODY, client_id: 'test-rp-2' } })
    await env.chiyigo_db
      .prepare(`UPDATE oauth_clients SET is_active=0 WHERE client_id='test-rp-2'`).run()

    const r = await call(listHandler, { token: tok })
    expect(r.body.rows.length).toBe(1)
    expect(r.body.rows[0].client_id).toBe('test-rp-1')
  })

  it('GET list ?include_inactive=1 回所有', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })
    await env.chiyigo_db
      .prepare(`UPDATE oauth_clients SET is_active=0 WHERE client_id='test-rp-1'`).run()

    const r = await call(listHandler, { token: tok, query: 'include_inactive=1' })
    expect(r.body.rows.length).toBe(1)
  })

  // ── GET single ───────────────────────────────────────────────
  it('GET /:id 找到 → 回單筆', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })

    const r = await call(getOneHandler, { token: tok, params: { client_id: 'test-rp-1' } })
    expect(r.status).toBe(200)
    expect(r.body.client_name).toBe('Test RP 1')
  })

  it('GET /:id 找不到 → 404', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(getOneHandler, { token: tok, params: { client_id: 'nope' } })
    expect(r.status).toBe(404)
  })

  // ── PATCH ────────────────────────────────────────────────────
  it('PATCH 部分欄位更新 → 200 + cache invalidate', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })

    const r = await call(patchHandler, {
      token: tok, method: 'PATCH', params: { client_id: 'test-rp-1' },
      body: { client_name: 'Renamed RP', backchannel_logout_uri: 'https://test-rp-1.example/bc' },
    })
    expect(r.status).toBe(200)

    const row = await env.chiyigo_db
      .prepare(`SELECT client_name, backchannel_logout_uri FROM oauth_clients WHERE client_id = ?`)
      .bind('test-rp-1').first()
    expect(row.client_name).toBe('Renamed RP')
    expect(row.backchannel_logout_uri).toBe('https://test-rp-1.example/bc')
  })

  it('PATCH 空 body → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })
    const r = await call(patchHandler, {
      token: tok, method: 'PATCH', params: { client_id: 'test-rp-1' }, body: {},
    })
    expect(r.status).toBe(400)
  })

  it('PATCH 不存在的 client_id → 404', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(patchHandler, {
      token: tok, method: 'PATCH', params: { client_id: 'nope' },
      body: { client_name: 'X' },
    })
    expect(r.status).toBe(404)
  })

  it('PATCH backchannel_logout_uri 設 null（清空）成功', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, {
      token: tok, method: 'POST',
      body: { ...VALID_BODY, backchannel_logout_uri: 'https://test-rp-1.example/bc' },
    })
    const r = await call(patchHandler, {
      token: tok, method: 'PATCH', params: { client_id: 'test-rp-1' },
      body: { backchannel_logout_uri: null },
    })
    expect(r.status).toBe(200)
    const row = await env.chiyigo_db
      .prepare(`SELECT backchannel_logout_uri FROM oauth_clients WHERE client_id = 'test-rp-1'`).first()
    expect(row.backchannel_logout_uri).toBeNull()
  })

  // ── DELETE（軟下架）──────────────────────────────────────────
  it('DELETE 把 is_active 設 0', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })

    const r = await call(deleteHandler, { token: tok, method: 'DELETE', params: { client_id: 'test-rp-1' } })
    expect(r.status).toBe(200)

    const row = await env.chiyigo_db
      .prepare(`SELECT is_active FROM oauth_clients WHERE client_id = 'test-rp-1'`).first()
    expect(row.is_active).toBe(0)

    // refresh cache 後 sync getter 看不到
    await refreshClientsCache(env, true)
    expect(getAllClients().some(c => c.client_id === 'test-rp-1')).toBe(false)
  })

  it('DELETE 已下架 → 409', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    await call(createHandler, { token: tok, method: 'POST', body: VALID_BODY })
    await call(deleteHandler, { token: tok, method: 'DELETE', params: { client_id: 'test-rp-1' } })
    const r = await call(deleteHandler, { token: tok, method: 'DELETE', params: { client_id: 'test-rp-1' } })
    expect(r.status).toBe(409)
  })

  it('DELETE 不存在 → 404', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(deleteHandler, { token: tok, method: 'DELETE', params: { client_id: 'nope' } })
    expect(r.status).toBe(404)
  })

  // ── 端到端：admin POST → middleware refresh → 立即可用 ───────
  it('e2e: 新建 RP 後 sync getter 立即看到（cache invalidate 生效）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)

    // 先讓 cache 為 in-code 狀態
    await refreshClientsCache(env, true)
    const before = getAllClients().map(c => c.client_id)
    expect(before).not.toContain('e2e-rp')

    // POST 建立 → 內部會 invalidateClientsCache
    await call(createHandler, {
      token: tok, method: 'POST',
      body: {
        client_id: 'e2e-rp', client_name: 'E2E RP',
        redirect_uris: ['https://e2e.example/cb'],
        origins: ['https://e2e.example'],
      },
    })

    // 模擬 middleware 跑 refresh（throttle 已被 invalidate 重置 → 真的去 D1 拉）
    await refreshClientsCache(env)
    expect(getAllClients().some(c => c.client_id === 'e2e-rp')).toBe(true)
  })
})
