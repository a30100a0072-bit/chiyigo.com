/**
 * Phase B / B3 — POST /api/admin/revoke 整合測試
 *
 * 三模式驗證：
 *  - mode='jti'    → revoked_jti 寫入 + 對應 token 下次 requireAuth 401
 *  - mode='user'   → token_version+1 + 所有 refresh_token revoked_at
 *  - mode='device' → 只該 device 的 refresh_token revoked，其他 device 不受影響
 *
 * 角色保護：
 *  - 自己撤自己 → 400
 *  - admin 撤 admin → 403
 *  - admin 撤 developer → 403
 *  - 非 admin 訪問 → 403 INSUFFICIENT_ROLE
 *
 * audit log：admin_audit_log 寫入（hash chain 串起）
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { requireAuth } from '../../functions/utils/auth.js'
import { hashToken, generateSecureToken } from '../../functions/utils/crypto.js'
import { onRequestPost as revokeHandler } from '../../functions/api/admin/revoke.js'

async function adminToken(userId, role = 'admin') {
  return signJwt({
    sub: String(userId), email: `${role}@x`, role, status: 'active', ver: 0,
  }, '15m', env, { audience: 'chiyigo' })
}

function makeReq(token, body) {
  return new Request('http://x/api/admin/revoke', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function call(token, body) {
  const resp = await revokeHandler({ request: makeReq(token, body), env })
  const json = await resp.json()
  return { status: resp.status, body: json }
}

async function seedRefresh(userId, deviceUuid = null) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + 7 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at)
              VALUES (?, ?, ?, ?)`)
    .bind(userId, hash, deviceUuid, exp).run()
  return plain
}

describe('POST /api/admin/revoke', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  // ── 角色守門 ─────────────────────────────────────────────────────
  it('player 訪問 → 403 INSUFFICIENT_ROLE', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const tok = await signJwt({
      sub: String(id), email: 'p@x', role: 'player', status: 'active', ver: 0,
    }, '15m', env, { audience: 'chiyigo' })
    const r = await call(tok, { mode: 'jti', jti: 'x' })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_ROLE')
  })

  it('沒帶 token → 401', async () => {
    const resp = await revokeHandler({
      request: new Request('http://x/api/admin/revoke', { method: 'POST', body: '{}' }),
      env,
    })
    expect(resp.status).toBe(401)
  })

  it('未知 mode → 400', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(tok, { mode: 'lol' })
    expect(r.status).toBe(400)
  })

  // ── mode='jti' ───────────────────────────────────────────────────
  it("mode='jti' → revoked_jti 寫入 + 該 jti token 下次 401", async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: targetId } = await seedUser({ email: 'target@x' })
    const adminTok = await adminToken(adminId)
    const targetTok = await signJwt({
      sub: String(targetId), email: 'target@x', role: 'player', status: 'active', ver: 0,
    }, '15m', env, { audience: 'chiyigo' })
    const decoded = JSON.parse(atob(targetTok.split('.')[1]))

    const r = await call(adminTok, { mode: 'jti', jti: decoded.jti })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ mode: 'jti', jti: decoded.jti })

    // D1 行寫入
    const row = await env.chiyigo_db
      .prepare(`SELECT jti, expires_at FROM revoked_jti WHERE jti = ?`)
      .bind(decoded.jti).first()
    expect(row).toBeTruthy()

    // requireAuth 對該 token 401
    const reqWith = new Request('http://x/', { headers: { Authorization: `Bearer ${targetTok}` } })
    const auth = await requireAuth(reqWith, env)
    expect(auth.user).toBeNull()
    expect(auth.error.status).toBe(401)
    const errBody = await auth.error.json()
    expect(errBody.code).toBe('TOKEN_REVOKED')
  })

  it("mode='jti' jti 缺值 → 400", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(tok, { mode: 'jti' })
    expect(r.status).toBe(400)
  })

  // ── mode='user' ──────────────────────────────────────────────────
  it("mode='user' → token_version+1 + 所有 refresh revoked", async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: targetId } = await seedUser({ email: 'u@x' })
    await seedRefresh(targetId, 'device-A')
    await seedRefresh(targetId, 'device-B')

    const adminTok = await adminToken(adminId)
    const r = await call(adminTok, { mode: 'user', user_id: targetId })
    expect(r.status).toBe(200)
    expect(r.body.refresh_revoked).toBe(2)

    const userRow = await env.chiyigo_db
      .prepare(`SELECT token_version FROM users WHERE id = ?`).bind(targetId).first()
    expect(userRow.token_version).toBe(1)

    const active = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS c FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL`)
      .bind(targetId).first()
    expect(active.c).toBe(0)
  })

  it("mode='user' 撤自己 → 400", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(tok, { mode: 'user', user_id: id })
    expect(r.status).toBe(400)
  })

  it("mode='user' 撤同層級 admin → 403", async () => {
    const { id: adminA } = await seedUser({ email: 'aa@x', role: 'admin' })
    const { id: adminB } = await seedUser({ email: 'ab@x', role: 'admin' })
    const tok = await adminToken(adminA)
    const r = await call(tok, { mode: 'user', user_id: adminB })
    expect(r.status).toBe(403)
  })

  it("mode='user' 撤 developer（更高層）→ 403", async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: devId } = await seedUser({ email: 'd@x', role: 'developer' })
    const tok = await adminToken(adminId)
    const r = await call(tok, { mode: 'user', user_id: devId })
    expect(r.status).toBe(403)
  })

  it("mode='user' user_id 不存在 → 404", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await call(tok, { mode: 'user', user_id: 999999 })
    expect(r.status).toBe(404)
  })

  // ── mode='device' ────────────────────────────────────────────────
  it("mode='device' 只撤指定裝置的 refresh", async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: targetId } = await seedUser({ email: 'u@x' })
    await seedRefresh(targetId, 'device-A')
    await seedRefresh(targetId, 'device-B')

    const adminTok = await adminToken(adminId)
    const r = await call(adminTok, { mode: 'device', user_id: targetId, device_uuid: 'device-A' })
    expect(r.status).toBe(200)
    expect(r.body.refresh_revoked).toBe(1)

    const stillActive = await env.chiyigo_db
      .prepare(`SELECT device_uuid FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL`)
      .bind(targetId).all()
    expect(stillActive.results.length).toBe(1)
    expect(stillActive.results[0].device_uuid).toBe('device-B')

    // token_version 不動（mode='device' 不影響其他裝置 access_token）
    const userRow = await env.chiyigo_db
      .prepare(`SELECT token_version FROM users WHERE id = ?`).bind(targetId).first()
    expect(userRow.token_version).toBe(0)
  })

  it("mode='device' device_uuid 缺值 → 400", async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: targetId } = await seedUser({ email: 'u@x' })
    const tok = await adminToken(adminId)
    const r = await call(tok, { mode: 'device', user_id: targetId })
    expect(r.status).toBe(400)
  })

  // ── audit log ────────────────────────────────────────────────────
  it('每次 revoke 寫入 admin_audit_log（action 對應 mode）', async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: targetId } = await seedUser({ email: 'u@x' })
    await seedRefresh(targetId, 'd1')
    const tok = await adminToken(adminId)

    await call(tok, { mode: 'jti', jti: 'fake-jti-abc' })
    await call(tok, { mode: 'user', user_id: targetId })

    const { results } = await env.chiyigo_db
      .prepare(`SELECT action, target_id FROM admin_audit_log ORDER BY id ASC`).all()
    expect(results.map(r => r.action)).toEqual(['revoke.jti', 'revoke.user'])
    expect(results[1].target_id).toBe(targetId)
  })
})
