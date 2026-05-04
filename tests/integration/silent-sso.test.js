/**
 * Silent SSO Phase 1 整合測試
 *
 * 驗證 /api/auth/oauth/authorize 在帶有 chiyigo_refresh cookie 時：
 *  1. active session → 直接 302 到 redirect_uri?code=&state=（不過 /login.html）
 *  2. revoked / expired / banned / deleted user → fall through 到 /login.html
 *  3. prompt=login → 永遠走 /login.html（即使有 active session）
 *  4. prompt=none + active session → silent 命中
 *  5. prompt=none + 無 session → redirect_uri?error=login_required
 *  6. silent SSO 不消耗 refresh_token（仍可 refresh）
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, callFunction, seedUser } from './_helpers.js'
import { onRequestGet } from '../../functions/api/auth/oauth/authorize.js'
import { generateSecureToken, hashToken } from '../../functions/utils/crypto.js'

const BASE = 'http://localhost/api/auth/oauth/authorize'
const REDIRECT_URI = 'https://sport-app-web.pages.dev/auth/callback'
const CODE_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
const STATE = 'test-state-xyz'

function authorizeUrl(extra = {}) {
  const u = new URL(BASE)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('redirect_uri', REDIRECT_URI)
  u.searchParams.set('code_challenge', CODE_CHALLENGE)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', STATE)
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
  return u.toString()
}

function makeRequest(url, cookieValue = null) {
  const headers = {}
  if (cookieValue !== null) headers['Cookie'] = `chiyigo_refresh=${cookieValue}`
  return new Request(url, { headers })
}

async function seedRefreshToken(userId, { expired = false, revoked = false } = {}) {
  const plain = generateSecureToken()
  const hash = await hashToken(plain)
  const exp = new Date(Date.now() + (expired ? -3600_000 : 7 * 86400_000))
    .toISOString().replace('T', ' ').slice(0, 19)
  const revokedAt = revoked
    ? new Date().toISOString().replace('T', ' ').slice(0, 19)
    : null
  await env.chiyigo_db
    .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, revoked_at)
              VALUES (?, ?, NULL, ?, ?)`)
    .bind(userId, hash, exp, revokedAt)
    .run()
  return plain
}

describe('Silent SSO Phase 1', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('active session → silent 302 to redirect_uri with code+state', async () => {
    const { id } = await seedUser({ email: 's1@example.com' })
    const token = await seedRefreshToken(id)

    const resp = await callFunction(onRequestGet, makeRequest(authorizeUrl(), token))

    expect(resp.status).toBe(302)
    const loc = resp.headers.get('Location')
    expect(loc).toMatch(/^https:\/\/sport-app-web\.pages\.dev\/auth\/callback\?/)
    expect(loc).toMatch(/code=[^&]+/)
    expect(loc).toContain(`state=${STATE}`)

    const codeRow = await env.chiyigo_db
      .prepare(`SELECT user_id, redirect_uri, state FROM auth_codes WHERE state = ?`)
      .bind(STATE).first()
    expect(codeRow).toBeTruthy()
    expect(codeRow.user_id).toBe(id)
    expect(codeRow.redirect_uri).toBe(REDIRECT_URI)
  })

  it('revoked refresh token → fall through to /login.html', async () => {
    const { id } = await seedUser({ email: 'rev@example.com' })
    const token = await seedRefreshToken(id, { revoked: true })

    const resp = await callFunction(onRequestGet, makeRequest(authorizeUrl(), token))

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('expired refresh token → fall through to /login.html', async () => {
    const { id } = await seedUser({ email: 'exp@example.com' })
    const token = await seedRefreshToken(id, { expired: true })

    const resp = await callFunction(onRequestGet, makeRequest(authorizeUrl(), token))

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('banned user → fall through to /login.html', async () => {
    const { id } = await seedUser({ email: 'ban@example.com' })
    await env.chiyigo_db.prepare(`UPDATE users SET status = 'banned' WHERE id = ?`).bind(id).run()
    const token = await seedRefreshToken(id)

    const resp = await callFunction(onRequestGet, makeRequest(authorizeUrl(), token))

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('soft-deleted user → fall through to /login.html', async () => {
    const { id } = await seedUser({ email: 'del@example.com', deletedAt: '2026-01-01 00:00:00' })
    const token = await seedRefreshToken(id)

    const resp = await callFunction(onRequestGet, makeRequest(authorizeUrl(), token))

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('prompt=login + active session → still go /login.html (force re-auth)', async () => {
    const { id } = await seedUser({ email: 'plog@example.com' })
    const token = await seedRefreshToken(id)

    const resp = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ prompt: 'login' }), token),
    )

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('prompt=none + active session → silent 302 with code', async () => {
    const { id } = await seedUser({ email: 'pnone-ok@example.com' })
    const token = await seedRefreshToken(id)

    const resp = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ prompt: 'none' }), token),
    )

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/^https:\/\/sport-app-web\.pages\.dev\/auth\/callback\?code=/)
  })

  it('prompt=none + no session → redirect_uri?error=login_required', async () => {
    const resp = await callFunction(onRequestGet, makeRequest(authorizeUrl({ prompt: 'none' })))

    expect(resp.status).toBe(302)
    const loc = resp.headers.get('Location')
    expect(loc).toMatch(/^https:\/\/sport-app-web\.pages\.dev\/auth\/callback\?/)
    expect(loc).toContain('error=login_required')
    expect(loc).toContain(`state=${STATE}`)
  })

  it('no cookie at all → fall through to /login.html', async () => {
    const resp = await callFunction(onRequestGet, makeRequest(authorizeUrl()))

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('silent SSO does NOT consume / rotate the refresh token', async () => {
    const { id } = await seedUser({ email: 'norot@example.com' })
    const token = await seedRefreshToken(id)
    const tokenHash = await hashToken(token)

    await callFunction(onRequestGet, makeRequest(authorizeUrl(), token))

    const row = await env.chiyigo_db
      .prepare(`SELECT revoked_at FROM refresh_tokens WHERE token_hash = ?`)
      .bind(tokenHash).first()
    expect(row).toBeTruthy()
    expect(row.revoked_at).toBeNull()
  })

  it('silent SSO carries scope + nonce into auth_codes row', async () => {
    const { id } = await seedUser({ email: 'oidc@example.com' })
    const token = await seedRefreshToken(id)

    await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ scope: 'openid email', nonce: 'n-abc-123' }), token),
    )

    const row = await env.chiyigo_db
      .prepare(`SELECT scope, nonce FROM auth_codes WHERE state = ?`)
      .bind(STATE).first()
    expect(row.scope).toBe('openid email')
    expect(row.nonce).toBe('n-abc-123')
  })
})

// ── Phase 2: max_age 行為 ─────────────────────────────────────────
async function setAuthTime(userId, secondsAgo) {
  const t = new Date(Date.now() - secondsAgo * 1000).toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(`UPDATE refresh_tokens SET auth_time = ? WHERE user_id = ?`)
    .bind(t, userId).run()
  return t
}

describe('Silent SSO Phase 2 — max_age', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('max_age 大於 elapsed → silent 命中', async () => {
    const { id } = await seedUser({ email: 'ma-ok@example.com' })
    const token = await seedRefreshToken(id)
    await setAuthTime(id, 60) // 60 秒前互動式登入

    const resp = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ max_age: '600' }), token),
    )

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/^https:\/\/sport-app-web\.pages\.dev\/auth\/callback\?code=/)
  })

  it('max_age 小於 elapsed → fall through 到 /login.html', async () => {
    const { id } = await seedUser({ email: 'ma-stale@example.com' })
    const token = await seedRefreshToken(id)
    await setAuthTime(id, 3600) // 1 小時前

    const resp = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ max_age: '300' }), token),
    )

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('max_age=0 → 強制重認，永遠 fall through', async () => {
    const { id } = await seedUser({ email: 'ma-zero@example.com' })
    const token = await seedRefreshToken(id)
    await setAuthTime(id, 1) // 1 秒前剛登入也擋

    const resp = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ max_age: '0' }), token),
    )

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('max_age 指定但 auth_time 為 NULL（舊資料）→ 保守 fall through', async () => {
    const { id } = await seedUser({ email: 'ma-null@example.com' })
    const token = await seedRefreshToken(id)
    // 不設 auth_time（保持 NULL）

    const resp = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ max_age: '600' }), token),
    )

    expect(resp.status).toBe(302)
    expect(resp.headers.get('Location')).toMatch(/\/login\.html\?pkce_key=/)
  })

  it('max_age 超出 + prompt=none → login_required', async () => {
    const { id } = await seedUser({ email: 'ma-pnone@example.com' })
    const token = await seedRefreshToken(id)
    await setAuthTime(id, 3600)

    const resp = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ max_age: '300', prompt: 'none' }), token),
    )

    expect(resp.status).toBe(302)
    const loc = resp.headers.get('Location')
    expect(loc).toMatch(/^https:\/\/sport-app-web\.pages\.dev\/auth\/callback\?/)
    expect(loc).toContain('error=login_required')
  })

  it('max_age 非法值（負數 / 非數字）→ 視為未指定，silent 照常命中', async () => {
    const { id } = await seedUser({ email: 'ma-bad@example.com' })
    const token = await seedRefreshToken(id)
    // 不設 auth_time；若 max_age 沒被忽略，會 fall through
    const resp = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ max_age: 'abc' }), token),
    )
    expect(resp.headers.get('Location')).toMatch(/^https:\/\/sport-app-web\.pages\.dev\/auth\/callback\?code=/)

    const resp2 = await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ max_age: '-5' }), token),
    )
    expect(resp2.headers.get('Location')).toMatch(/^https:\/\/sport-app-web\.pages\.dev\/auth\/callback\?code=/)
  })

  it('silent 命中時 auth_codes.auth_time 從 refresh_tokens 透傳', async () => {
    const { id } = await seedUser({ email: 'ma-pass@example.com' })
    const token = await seedRefreshToken(id)
    const expected = await setAuthTime(id, 120)

    await callFunction(
      onRequestGet,
      makeRequest(authorizeUrl({ max_age: '600' }), token),
    )

    const row = await env.chiyigo_db
      .prepare(`SELECT auth_time FROM auth_codes WHERE state = ?`)
      .bind(STATE).first()
    expect(row.auth_time).toBe(expected)
  })
})
