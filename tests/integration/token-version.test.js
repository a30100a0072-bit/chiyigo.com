/**
 * PR-A: users.token_version 全域 revoke 整合測試
 *
 * 驗證：
 *   1. login 簽出的 access token 帶 ver claim
 *   2. requireAuth 在 ver < users.token_version 時拒絕（401 TOKEN_REVOKED）
 *   3. ver 缺失（舊 token）視為 0，與初始值相符通過
 *   4. bumpTokenVersion 同步撤銷 refresh token
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { onRequestPost as loginPost } from '../../functions/api/auth/local/login.js'
import { requireAuth, bumpTokenVersion } from '../../functions/utils/auth.js'
import { signJwt } from '../../functions/utils/jwt.js'
import {
  resetDb, seedUser, callFunction, jsonPost, ensureJwtKeys,
} from './_helpers.js'

const URL_LOGIN = 'http://localhost/api/auth/local/login'

function authReq(token) {
  return new Request('http://x/', { headers: { Authorization: `Bearer ${token}` } })
}

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})
beforeEach(resetDb)

describe('PR-A token_version', () => {
  it('login 簽發的 access token 包含 ver claim（初始值 0）', async () => {
    const u = await seedUser({ email: 'a@b.com', password: 'GoodPass#1234' })
    const res = await callFunction(
      loginPost,
      jsonPost(URL_LOGIN, { email: 'a@b.com', password: 'GoodPass#1234' }),
    )
    const { access_token } = await res.json()
    const payloadB64 = access_token.split('.')[1]
    const payload   = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
    expect(payload.ver).toBe(0)
    expect(payload.sub).toBe(String(u.id))
  })

  it('bumpTokenVersion 後舊 access token 立即失效 (401 TOKEN_REVOKED)', async () => {
    const u = await seedUser({ email: 'a@b.com', password: 'GoodPass#1234' })
    const token = await signJwt({
      sub: String(u.id), email: u.email, role: 'player', status: 'active', ver: 0,
    }, '5m', env)

    // 第一次驗證通過
    const before = await requireAuth(authReq(token), env)
    expect(before.error).toBeNull()
    expect(before.user.sub).toBe(String(u.id))

    // bump → DB ver = 1
    await bumpTokenVersion(env.chiyigo_db, u.id)
    const userRow = await env.chiyigo_db
      .prepare('SELECT token_version FROM users WHERE id = ?').bind(u.id).first()
    expect(userRow.token_version).toBe(1)

    // 同一份 token (ver=0) 現在被拒
    const after = await requireAuth(authReq(token), env)
    expect(after.user).toBeNull()
    expect(after.error.status).toBe(401)
    const body = await after.error.json()
    expect(body.code).toBe('TOKEN_REVOKED')
  })

  it('JWT 缺 ver claim（legacy token）→ 視為 0，DB 初始值 0 → 通過', async () => {
    const u = await seedUser({ email: 'legacy@b.com', password: 'GoodPass#1234' })
    const tokenNoVer = await signJwt({
      sub: String(u.id), email: u.email, role: 'player', status: 'active',
    }, '5m', env)
    const r = await requireAuth(authReq(tokenNoVer), env)
    expect(r.error).toBeNull()
  })

  it('JWT 缺 ver claim 但 DB 已 bump → 拒絕（強制下線生效）', async () => {
    const u = await seedUser({ email: 'old@b.com', password: 'GoodPass#1234' })
    const tokenNoVer = await signJwt({
      sub: String(u.id), email: u.email, role: 'player', status: 'active',
    }, '5m', env)
    await bumpTokenVersion(env.chiyigo_db, u.id)
    const r = await requireAuth(authReq(tokenNoVer), env)
    expect(r.user).toBeNull()
    expect(r.error.status).toBe(401)
  })

  it('bumpTokenVersion 同步撤銷所有未過期 refresh_token', async () => {
    const u = await seedUser({ email: 'r@b.com', password: 'GoodPass#1234' })
    // 模擬兩筆有效 refresh token
    const fut = new Date(Date.now() + 7 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.batch([
      env.chiyigo_db.prepare(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      ).bind(u.id, 'hash-1', fut),
      env.chiyigo_db.prepare(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
      ).bind(u.id, 'hash-2', fut),
    ])

    await bumpTokenVersion(env.chiyigo_db, u.id)

    const remaining = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .bind(u.id).first()
    expect(remaining.n).toBe(0)
  })

  it('refresh token 未簽發給其他 user → bump 不影響別人', async () => {
    const a = await seedUser({ email: 'a@b.com', password: 'GoodPass#1234' })
    const b = await seedUser({ email: 'b@b.com', password: 'GoodPass#1234' })
    const tokenA = await signJwt({
      sub: String(a.id), email: a.email, role: 'player', status: 'active', ver: 0,
    }, '5m', env)
    const tokenB = await signJwt({
      sub: String(b.id), email: b.email, role: 'player', status: 'active', ver: 0,
    }, '5m', env)

    await bumpTokenVersion(env.chiyigo_db, a.id)

    const ra = await requireAuth(authReq(tokenA), env)
    expect(ra.error.status).toBe(401)

    const rb = await requireAuth(authReq(tokenB), env)
    expect(rb.error).toBeNull()
  })
})
