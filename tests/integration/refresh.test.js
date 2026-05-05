/**
 * Phase D1 — Refresh token device binding 整合測試
 *
 * 涵蓋：
 *  - X-Device-Id header 路徑 happy
 *  - Header mismatch → 401 + 整個 (user, device) 家族被撤銷 + critical audit
 *  - body.device_uuid 向後相容
 *  - Web cookie 路徑（device_uuid=null）不受影響
 *  - 舊 token rotation 後寫入新列繼承 device_uuid
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { generateSecureToken, hashToken } from '../../functions/utils/crypto.js'
import { onRequestPost as refreshHandler } from '../../functions/api/auth/refresh.js'

async function seedRefresh(userId, { deviceUuid = null, expired = false, revoked = false } = {}) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + (expired ? -3600_000 : 7 * 86400_000))
    .toISOString().replace('T', ' ').slice(0, 19)
  const revokedAt = revoked
    ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
  await env.chiyigo_db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(userId, hash, deviceUuid, exp, revokedAt).run()
  return plain
}

function refreshReq({ token, headers = {}, body = {} } = {}) {
  const finalBody = token ? { refresh_token: token, ...body } : body
  return new Request('http://x/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(finalBody),
  })
}

async function call(req) {
  const resp = await refreshHandler({ request: req, env })
  let body = null
  try { body = await resp.json() } catch { /* swallow */ }
  return { status: resp.status, body }
}

describe('POST /api/auth/refresh — Phase D1 device binding', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('header X-Device-Id 比對通過 → 200 + rotation', async () => {
    const u = await seedUser({ email: 'd1@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: 'dev-aaa' })
    const r = await call(refreshReq({ token: tok, headers: { 'X-Device-Id': 'dev-aaa' } }))
    expect(r.status).toBe(200)
    expect(r.body.access_token).toBeTruthy()
    expect(r.body.refresh_token).toBeTruthy()
    // 舊 token 被 revoked，新 token 繼承 device_uuid
    const rows = await env.chiyigo_db
      .prepare('SELECT device_uuid, revoked_at FROM refresh_tokens WHERE user_id = ? ORDER BY id')
      .bind(u.id).all()
    expect(rows.results).toHaveLength(2)
    expect(rows.results[0].revoked_at).not.toBeNull()
    expect(rows.results[1].revoked_at).toBeNull()
    expect(rows.results[1].device_uuid).toBe('dev-aaa')
  })

  it('header 不符 → 401 + 整個 device 家族撤銷 + critical audit', async () => {
    const u = await seedUser({ email: 'd2@x' })
    const tok1 = await seedRefresh(u.id, { deviceUuid: 'dev-bbb' })
    const tok2 = await seedRefresh(u.id, { deviceUuid: 'dev-bbb' })  // 同 device chain 上其他 token
    const tokOther = await seedRefresh(u.id, { deviceUuid: 'dev-ccc' })  // 別台裝置不該被波及

    const r = await call(refreshReq({ token: tok1, headers: { 'X-Device-Id': 'dev-evil' } }))
    expect(r.status).toBe(401)
    expect(r.body.error).toMatch(/Device mismatch/i)

    const bbb = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM refresh_tokens
                WHERE user_id = ? AND device_uuid = 'dev-bbb' AND revoked_at IS NULL`)
      .bind(u.id).first()
    expect(bbb.n).toBe(0)

    const ccc = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM refresh_tokens
                WHERE user_id = ? AND device_uuid = 'dev-ccc' AND revoked_at IS NULL`)
      .bind(u.id).first()
    expect(ccc.n).toBe(1)  // 別 device 不受影響

    const audit = await env.chiyigo_db
      .prepare(`SELECT event_type, severity FROM audit_log
                WHERE user_id = ? AND event_type = 'auth.refresh.device_mismatch'`)
      .bind(u.id).first()
    expect(audit).not.toBeNull()
    expect(audit.severity).toBe('critical')

    // 抑制 unused 警告
    void tok2; void tokOther
  })

  it('header 缺值 fallback 到 body.device_uuid（向後相容）', async () => {
    const u = await seedUser({ email: 'd3@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: 'dev-legacy' })
    const r = await call(refreshReq({ token: tok, body: { device_uuid: 'dev-legacy' } }))
    expect(r.status).toBe(200)
  })

  it('Web cookie 路徑（DB device_uuid=null）不需要 header', async () => {
    const u = await seedUser({ email: 'd4@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: null })
    const req = new Request('http://x/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `chiyigo_refresh=${tok}` },
      body: '{}',
    })
    const resp = await refreshHandler({ request: req, env })
    expect(resp.status).toBe(200)
    const setCookie = resp.headers.get('Set-Cookie')
    expect(setCookie).toMatch(/chiyigo_refresh=/)
  })

  it('header 帶值但 DB 沒綁 device → 不檢查（避免假 mismatch）', async () => {
    const u = await seedUser({ email: 'd5@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: null })
    const r = await call(refreshReq({ token: tok, headers: { 'X-Device-Id': 'dev-zzz' } }))
    expect(r.status).toBe(200)
  })
})
