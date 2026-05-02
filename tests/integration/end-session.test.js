/**
 * OIDC RP-Initiated Logout 1.0 — end_session_endpoint 整合測試
 *
 * 驗證：
 *  - id_token_hint 驗簽 → 撤該 user 所有 active refresh_tokens（single sign-out）
 *  - id_token 過期仍接受（spec 9：「the OP MUST NOT include the id_token in the response」
 *    意思是 OP 不要假設 hint 必然 valid，但要寬容處理過期的 hint）
 *  - 無 id_token_hint 時 fallback 用 cookie 撤
 *  - post_logout_redirect_uri 嚴格白名單
 *  - 回 HTML 嵌 frontchannel iframe + clear refresh cookie + meta refresh
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { SignJWT, importJWK } from 'jose'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { generateSecureToken, hashToken } from '../../functions/utils/crypto.js'

import { onRequestGet as endSessionGet } from '../../functions/api/auth/oauth/end-session.js'

const ORIGIN = 'https://chiyigo.com'

async function signTestIdToken({ sub, exp = '15m', iss = 'https://chiyigo.com', aud = 'mbti' }) {
  const priv = JSON.parse(env.JWT_PRIVATE_KEY)
  const key  = await importJWK(priv, 'ES256')
  return await new SignJWT({ sub: String(sub) })
    .setProtectedHeader({ alg: 'ES256', kid: priv.kid })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(key)
}

async function seedRefreshToken(userId, { revoked = false } = {}) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + 7 * 86400 * 1000).toISOString().replace('T', ' ').slice(0, 19)
  const revokedAt = revoked
    ? new Date().toISOString().replace('T', ' ').slice(0, 19)
    : null
  await env.chiyigo_db
    .prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked_at) VALUES (?, ?, ?, ?)')
    .bind(userId, hash, exp, revokedAt)
    .run()
  return { plain, hash }
}

async function countActiveTokens(userId) {
  const r = await env.chiyigo_db
    .prepare('SELECT COUNT(*) as n FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL')
    .bind(userId).first()
  return r.n
}

describe('GET /api/auth/oauth/end-session — OIDC RP-Initiated Logout', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('happy path: id_token_hint 有效 → 撤該 user 所有 active refresh', async () => {
    const user  = await seedUser()
    await seedRefreshToken(user.id)
    await seedRefreshToken(user.id) // 多裝置
    await seedRefreshToken(user.id)
    expect(await countActiveTokens(user.id)).toBe(3)

    const idToken = await signTestIdToken({ sub: user.id })
    const url = `${ORIGIN}/api/auth/oauth/end-session?id_token_hint=${idToken}` +
                `&post_logout_redirect_uri=${encodeURIComponent('https://mbti.chiyigo.com/')}`
    const res = await endSessionGet({ request: new Request(url), env })

    expect(res.status).toBe(200)
    expect(await countActiveTokens(user.id)).toBe(0) // 全撤光
  })

  it('id_token_hint 已過期仍接受（OIDC spec 9：寬容處理過期 hint）', async () => {
    const user = await seedUser()
    await seedRefreshToken(user.id)

    // 簽一個 1 秒前就過期的 token
    const idToken = await signTestIdToken({ sub: user.id, exp: Math.floor(Date.now()/1000) - 1 })
    const url = `${ORIGIN}/api/auth/oauth/end-session?id_token_hint=${idToken}` +
                `&post_logout_redirect_uri=${encodeURIComponent('https://mbti.chiyigo.com/')}`
    const res = await endSessionGet({ request: new Request(url), env })

    expect(res.status).toBe(200)
    expect(await countActiveTokens(user.id)).toBe(0)
  })

  it('id_token_hint 簽章偽造 → 不撤 user token，但 cookie fallback 仍跑', async () => {
    const user = await seedUser()
    await seedRefreshToken(user.id)

    const url = `${ORIGIN}/api/auth/oauth/end-session?id_token_hint=eyJhbGciOiJFUzI1NiJ9.fake.payload` +
                `&post_logout_redirect_uri=${encodeURIComponent('https://mbti.chiyigo.com/')}`
    const res = await endSessionGet({ request: new Request(url), env })

    expect(res.status).toBe(200) // 端點本身仍 200（HTML 頁面）
    expect(await countActiveTokens(user.id)).toBe(1) // 沒撤（簽章偽造，cookie 也沒帶）
  })

  it('cookie fallback: 無 id_token_hint，cookie 有 → 撤 cookie 對應的 token', async () => {
    const user = await seedUser()
    const t1 = await seedRefreshToken(user.id)
    const t2 = await seedRefreshToken(user.id)
    expect(await countActiveTokens(user.id)).toBe(2)

    const url = `${ORIGIN}/api/auth/oauth/end-session` +
                `?post_logout_redirect_uri=${encodeURIComponent('https://chiyigo.com/')}`
    const res = await endSessionGet({
      request: new Request(url, { headers: { Cookie: `chiyigo_refresh=${t1.plain}` } }),
      env,
    })

    expect(res.status).toBe(200)
    expect(await countActiveTokens(user.id)).toBe(1) // 只撤 t1（cookie 對應），t2 還在
  })

  it('post_logout_redirect_uri 不在白名單 → 400', async () => {
    const url = `${ORIGIN}/api/auth/oauth/end-session` +
                `?post_logout_redirect_uri=${encodeURIComponent('https://evil.com/')}`
    const res = await endSessionGet({ request: new Request(url), env })
    expect(res.status).toBe(400)
  })

  it('post_logout_redirect_uri 缺失 → 預設回 chiyigo home（白名單內）', async () => {
    const url = `${ORIGIN}/api/auth/oauth/end-session`
    const res = await endSessionGet({ request: new Request(url), env })
    expect(res.status).toBe(200)
  })

  it('回 HTML：含三站 frontchannel iframe + meta refresh + clear cookie', async () => {
    const url = `${ORIGIN}/api/auth/oauth/end-session` +
                `?post_logout_redirect_uri=${encodeURIComponent('https://mbti.chiyigo.com/')}`
    const res  = await endSessionGet({ request: new Request(url), env })
    const html = await res.text()

    expect(res.headers.get('Content-Type')).toMatch(/text\/html/)
    expect(html).toContain('https://chiyigo.com/frontchannel-logout')
    expect(html).toContain('https://mbti.chiyigo.com/frontchannel-logout')
    expect(html).toContain('https://talo.chiyigo.com/frontchannel-logout')
    expect(html).toMatch(/<meta http-equiv="refresh"[^>]*url=https:\/\/mbti\.chiyigo\.com\//)

    const setCookie = res.headers.get('Set-Cookie')
    expect(setCookie).toMatch(/chiyigo_refresh=;/)
    expect(setCookie).toMatch(/Domain=\.chiyigo\.com/)
    expect(setCookie).toMatch(/Max-Age=0/)

    const csp = res.headers.get('Content-Security-Policy')
    expect(csp).toContain('frame-src https://chiyigo.com https://mbti.chiyigo.com https://talo.chiyigo.com')
  })

  it('state 參數透傳到 post_logout_redirect_uri', async () => {
    const url = `${ORIGIN}/api/auth/oauth/end-session` +
                `?post_logout_redirect_uri=${encodeURIComponent('https://talo.chiyigo.com/')}` +
                `&state=abc123`
    const res  = await endSessionGet({ request: new Request(url), env })
    const html = await res.text()
    expect(html).toMatch(/url=https:\/\/talo\.chiyigo\.com\/\?state=abc123/)
  })

  it('id_token_hint iss 不對（不是 chiyigo） → 不撤 user token', async () => {
    const user = await seedUser()
    await seedRefreshToken(user.id)

    const idToken = await signTestIdToken({ sub: user.id, iss: 'https://evil.com' })
    const url = `${ORIGIN}/api/auth/oauth/end-session?id_token_hint=${idToken}` +
                `&post_logout_redirect_uri=${encodeURIComponent('https://chiyigo.com/')}`
    const res = await endSessionGet({ request: new Request(url), env })

    expect(res.status).toBe(200)
    expect(await countActiveTokens(user.id)).toBe(1) // 沒撤（iss mismatch）
  })

  it('id_token_hint 撤 user 所有 token 不影響其他 user', async () => {
    const u1 = await seedUser({ email: 'u1@example.com' })
    const u2 = await seedUser({ email: 'u2@example.com' })
    await seedRefreshToken(u1.id)
    await seedRefreshToken(u2.id)

    const idToken = await signTestIdToken({ sub: u1.id })
    const url = `${ORIGIN}/api/auth/oauth/end-session?id_token_hint=${idToken}` +
                `&post_logout_redirect_uri=${encodeURIComponent('https://mbti.chiyigo.com/')}`
    await endSessionGet({ request: new Request(url), env })

    expect(await countActiveTokens(u1.id)).toBe(0)
    expect(await countActiveTokens(u2.id)).toBe(1) // u2 不受影響
  })
})
