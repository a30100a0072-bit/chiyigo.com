/**
 * Phase B / B2 — jti revocation 整合測試
 *
 * 驗證 requireAuth 在 jti 進 revoked_jti 黑名單後 401，並核對：
 *  - 未列名 → 通過
 *  - D1 列名 + 未過期 → 401 TOKEN_REVOKED
 *  - D1 列名但已過期 → 通過（cron 沒清前 D1 仍有 row）
 *  - 舊 token 沒 jti claim → 跳過（向後相容）
 *  - revokeJti() 寫入後立即生效
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { requireAuth } from '../../functions/utils/auth.js'
import { revokeJti, isJtiRevoked } from '../../functions/utils/revocation.js'

function reqWithToken(tok) {
  return new Request('http://x/', { headers: { Authorization: `Bearer ${tok}` } })
}

async function signFor(userId) {
  return signJwt({
    sub: String(userId), email: 'r@x', role: 'player', status: 'active', ver: 0,
  }, '15m', env, { audience: 'chiyigo' })
}

describe('Phase B revocation', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('未 revoke 的 token → requireAuth 通過', async () => {
    const { id } = await seedUser({ email: 'norev@example.com' })
    const tok = await signFor(id)
    const { user, error } = await requireAuth(reqWithToken(tok), env)
    expect(error).toBeNull()
    expect(user.sub).toBe(String(id))
    expect(user.jti).toBeTypeOf('string')
  })

  it('D1 列名 + 未過期 → 401 TOKEN_REVOKED', async () => {
    const { id } = await seedUser({ email: 'rev@example.com' })
    const tok = await signFor(id)
    // 解 jti 出來，直接 INSERT 黑名單
    const decoded = JSON.parse(atob(tok.split('.')[1]))
    await env.chiyigo_db
      .prepare(`INSERT INTO revoked_jti (jti, expires_at) VALUES (?, datetime('now', '+1 hour'))`)
      .bind(decoded.jti).run()

    const { user, error } = await requireAuth(reqWithToken(tok), env)
    expect(user).toBeNull()
    expect(error.status).toBe(401)
    const body = await error.json()
    expect(body.code).toBe('TOKEN_REVOKED')
  })

  it('D1 列名但已過期 → 通過（cron 沒清也不誤殺）', async () => {
    const { id } = await seedUser({ email: 'expired@example.com' })
    const tok = await signFor(id)
    const decoded = JSON.parse(atob(tok.split('.')[1]))
    await env.chiyigo_db
      .prepare(`INSERT INTO revoked_jti (jti, expires_at) VALUES (?, datetime('now', '-1 hour'))`)
      .bind(decoded.jti).run()

    const { user, error } = await requireAuth(reqWithToken(tok), env)
    expect(error).toBeNull()
    expect(user.sub).toBe(String(id))
  })

  it('token 無 jti claim（舊 token）→ 跳過 jti 檢查仍通過', async () => {
    const { id } = await seedUser({ email: 'legacy@example.com' })
    // jti=null 觸發 signJwt 自動補；想要無 jti 必須繞開 signJwt 的補洞 → 設 jti 為空字串再 trim
    // 改用 jose 直接造 token
    const { SignJWT, importJWK } = await import('jose')
    const jwk = JSON.parse(env.JWT_PRIVATE_KEY)
    const key = await importJWK(jwk, 'ES256')
    const tok = await new SignJWT({
      sub: String(id), email: 'legacy@x', role: 'player', status: 'active', ver: 0,
    })
      .setProtectedHeader({ alg: 'ES256', kid: jwk.kid })
      .setIssuer('https://chiyigo.com')
      .setIssuedAt()
      .setExpirationTime('5m')
      .setAudience('chiyigo')
      .sign(key)

    const { user, error } = await requireAuth(reqWithToken(tok), env)
    expect(error).toBeNull()
    expect(user.sub).toBe(String(id))
    expect(user.jti).toBeUndefined()
  })

  it('revokeJti() 寫入後 isJtiRevoked() 立即看到', async () => {
    const jti = 'test-jti-revoke-' + Math.random().toString(36).slice(2)
    expect(await isJtiRevoked(env, jti)).toBe(false)

    await revokeJti(env, jti, Math.floor(Date.now() / 1000) + 900)
    expect(await isJtiRevoked(env, jti)).toBe(true)
  })

  it('revokeJti() 同一 jti 重複呼叫 idempotent（INSERT OR IGNORE）', async () => {
    const jti = 'test-jti-dup-' + Math.random().toString(36).slice(2)
    const exp = Math.floor(Date.now() / 1000) + 900
    await revokeJti(env, jti, exp)
    await revokeJti(env, jti, exp)  // 不應 throw
    expect(await isJtiRevoked(env, jti)).toBe(true)
  })

  it('isJtiRevoked() jti 缺值或非字串 → false', async () => {
    expect(await isJtiRevoked(env, null)).toBe(false)
    expect(await isJtiRevoked(env, '')).toBe(false)
    expect(await isJtiRevoked(env, undefined)).toBe(false)
  })

  it('full flow: 簽 token → revoke → requireAuth 401', async () => {
    const { id } = await seedUser({ email: 'flow@example.com' })
    const tok = await signFor(id)

    // 第一次：通過
    let r = await requireAuth(reqWithToken(tok), env)
    expect(r.error).toBeNull()

    // revoke
    await revokeJti(env, r.user.jti, r.user.exp)

    // 第二次：401
    r = await requireAuth(reqWithToken(tok), env)
    expect(r.user).toBeNull()
    expect(r.error.status).toBe(401)
  })
})
