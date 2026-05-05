/**
 * Phase D-3a — Device list / logout endpoint 整合測試
 *
 * 涵蓋：
 *  - GET  /api/auth/devices
 *  - POST /api/auth/devices/logout
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { onRequestGet as listHandler } from '../../functions/api/auth/devices.js'
import { onRequestPost as logoutHandler } from '../../functions/api/auth/devices/logout.js'
import { generateSecureToken, hashToken } from '../../functions/utils/crypto.js'

async function userToken(userId, email = 'd@x') {
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

/**
 * Insert a refresh_tokens row.
 *  - authTimeOffsetMin：負數 = 過去（用來造 first_seen / last_seen 排序）
 *  - revoked / expired flags
 */
async function seedRT(userId, {
  deviceUuid = null,
  authTimeOffsetMin = 0,
  revoked = false,
  expired = false,
} = {}) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + (expired ? -3600_000 : 7 * 86400_000))
    .toISOString().replace('T', ' ').slice(0, 19)
  const authTime = new Date(Date.now() + authTimeOffsetMin * 60_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const revokedAt = revoked
    ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
  await env.chiyigo_db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, revoked_at, auth_time)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(userId, hash, deviceUuid, exp, revokedAt, authTime).run()
}

describe('GET /api/auth/devices', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 access_token → 401', async () => {
    const resp = await listHandler({
      request: new Request('http://x/api/auth/devices'), env,
    })
    expect(resp.status).toBe(401)
  })

  it('happy → 多 device group + active/total + 排序', async () => {
    const u = await seedUser({ email: 'dl@x' })
    // device A：2 active, 1 revoked
    await seedRT(u.id, { deviceUuid: 'dev-A', authTimeOffsetMin: -60 })
    await seedRT(u.id, { deviceUuid: 'dev-A', authTimeOffsetMin: -30 })
    await seedRT(u.id, { deviceUuid: 'dev-A', authTimeOffsetMin: -45, revoked: true })
    // device B：1 active（最新）
    await seedRT(u.id, { deviceUuid: 'dev-B', authTimeOffsetMin: -5 })
    // web (NULL)：1 expired + 1 active
    await seedRT(u.id, { deviceUuid: null, authTimeOffsetMin: -120, expired: true })
    await seedRT(u.id, { deviceUuid: null, authTimeOffsetMin: -10 })
    // 別 user 不該被列入
    const other = await seedUser({ email: 'other@x' })
    await seedRT(other.id, { deviceUuid: 'dev-X' })

    const tok = await userToken(u.id, 'dl@x')
    const resp = await listHandler({
      request: bearer('GET', 'http://x/api/auth/devices', tok), env,
    })
    expect(resp.status).toBe(200)
    const { devices } = await resp.json()
    expect(devices).toHaveLength(3)

    const byKey = Object.fromEntries(
      devices.map(d => [d.device_uuid ?? '__web__', d]),
    )
    expect(byKey['dev-A'].active_count).toBe(2)
    expect(byKey['dev-A'].total_count).toBe(3)
    expect(byKey['dev-B'].active_count).toBe(1)
    expect(byKey['__web__'].active_count).toBe(1)  // expired 不算 active
    expect(byKey['__web__'].total_count).toBe(2)

    // 排序：dev-B (-5min) > __web__ (-10min) > dev-A (-30min 最新一筆)
    expect(devices[0].device_uuid).toBe('dev-B')
    expect(devices[1].device_uuid).toBeNull()
    expect(devices[2].device_uuid).toBe('dev-A')
  })

  it('沒任何 refresh_token → 空陣列', async () => {
    const u = await seedUser({ email: 'empty@x' })
    const tok = await userToken(u.id, 'empty@x')
    const resp = await listHandler({
      request: bearer('GET', 'http://x/api/auth/devices', tok), env,
    })
    expect(resp.status).toBe(200)
    const { devices } = await resp.json()
    expect(devices).toEqual([])
  })
})

describe('POST /api/auth/devices/logout', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 access_token → 401', async () => {
    const resp = await logoutHandler({
      request: new Request('http://x/api/auth/devices/logout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_uuid: 'dev-x' }),
      }), env,
    })
    expect(resp.status).toBe(401)
  })

  it('device_uuid 型別錯 → 400', async () => {
    const u = await seedUser({ email: 'lo@x' })
    const tok = await userToken(u.id, 'lo@x')
    const resp = await logoutHandler({
      request: bearer('POST', 'http://x/api/auth/devices/logout', tok, { device_uuid: 123 }),
      env,
    })
    expect(resp.status).toBe(400)
  })

  it('該 user 沒此 device → 404', async () => {
    const u = await seedUser({ email: 'lo404@x' })
    await seedRT(u.id, { deviceUuid: 'dev-mine' })
    const tok = await userToken(u.id, 'lo404@x')
    const resp = await logoutHandler({
      request: bearer('POST', 'http://x/api/auth/devices/logout', tok, { device_uuid: 'dev-other' }),
      env,
    })
    expect(resp.status).toBe(404)
  })

  it('happy device_uuid → 撤該 device 全部 active；別 device 不波及', async () => {
    const u = await seedUser({ email: 'lo1@x' })
    await seedRT(u.id, { deviceUuid: 'dev-target' })
    await seedRT(u.id, { deviceUuid: 'dev-target' })
    await seedRT(u.id, { deviceUuid: 'dev-target', revoked: true })  // 已撤不重複算
    await seedRT(u.id, { deviceUuid: 'dev-other' })
    await seedRT(u.id, { deviceUuid: null })  // web 不該被波及
    const tok = await userToken(u.id, 'lo1@x')

    const resp = await logoutHandler({
      request: bearer('POST', 'http://x/api/auth/devices/logout', tok, { device_uuid: 'dev-target' }),
      env,
    })
    expect(resp.status).toBe(200)
    const { revoked } = await resp.json()
    expect(revoked).toBe(2)  // 只撤未撤的 2 筆

    const target = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM refresh_tokens
        WHERE user_id = ? AND device_uuid = 'dev-target' AND revoked_at IS NULL`,
    ).bind(u.id).first()
    expect(target.n).toBe(0)

    const other = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM refresh_tokens
        WHERE user_id = ? AND device_uuid = 'dev-other' AND revoked_at IS NULL`,
    ).bind(u.id).first()
    expect(other.n).toBe(1)

    const web = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM refresh_tokens
        WHERE user_id = ? AND device_uuid IS NULL AND revoked_at IS NULL`,
    ).bind(u.id).first()
    expect(web.n).toBe(1)

    // audit
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.devices.logout' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit).not.toBeNull()
  })

  it('happy device_uuid=null → 撤所有 web session；App 不波及', async () => {
    const u = await seedUser({ email: 'lo2@x' })
    await seedRT(u.id, { deviceUuid: null })
    await seedRT(u.id, { deviceUuid: null })
    await seedRT(u.id, { deviceUuid: 'dev-app' })
    const tok = await userToken(u.id, 'lo2@x')

    const resp = await logoutHandler({
      request: bearer('POST', 'http://x/api/auth/devices/logout', tok, { device_uuid: null }),
      env,
    })
    expect(resp.status).toBe(200)
    expect((await resp.json()).revoked).toBe(2)

    const app = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM refresh_tokens
        WHERE user_id = ? AND device_uuid = 'dev-app' AND revoked_at IS NULL`,
    ).bind(u.id).first()
    expect(app.n).toBe(1)
  })

  it('idempotent：再次 logout 同 device → 200 revoked=0', async () => {
    const u = await seedUser({ email: 'idem@x' })
    await seedRT(u.id, { deviceUuid: 'dev-i' })
    const tok = await userToken(u.id, 'idem@x')
    const r1 = await logoutHandler({
      request: bearer('POST', 'http://x/api/auth/devices/logout', tok, { device_uuid: 'dev-i' }),
      env,
    })
    expect(r1.status).toBe(200)
    expect((await r1.json()).revoked).toBe(1)

    const r2 = await logoutHandler({
      request: bearer('POST', 'http://x/api/auth/devices/logout', tok, { device_uuid: 'dev-i' }),
      env,
    })
    expect(r2.status).toBe(200)  // 還有 row（已撤但 row 還在）→ 不 404
    expect((await r2.json()).revoked).toBe(0)
  })

  it('別 user 的 device 不能撤 → 404', async () => {
    const a = await seedUser({ email: 'a@x' })
    const b = await seedUser({ email: 'b@x' })
    await seedRT(a.id, { deviceUuid: 'dev-A' })
    const tokB = await userToken(b.id, 'b@x')
    const resp = await logoutHandler({
      request: bearer('POST', 'http://x/api/auth/devices/logout', tokB, { device_uuid: 'dev-A' }),
      env,
    })
    expect(resp.status).toBe(404)
    // a 的 device 不能被 b 撤
    const stillActive = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM refresh_tokens
        WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(a.id).first()
    expect(stillActive.n).toBe(1)
  })
})
