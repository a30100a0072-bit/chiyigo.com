/**
 * PR-B: OAuth/OIDC nonce 驗證整合測試
 *
 * 驗證：
 *   1. LINE callback：id_token.nonce 與 stored.nonce 相符 → 成功
 *   2. LINE callback：id_token.nonce 不符 → 拒絕（id_token replay）
 *   3. Apple callback：相同邏輯（id_token 為唯一資料來源）
 *   4. nonce=null（migration 未套用 / 非 OIDC provider）→ 不執行 nonce 比對
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys } from './_helpers.js'
import {
  onRequestGet as cbGet,
} from '../../functions/api/auth/oauth/[provider]/callback.js'

const BASE = 'http://localhost/api/auth/oauth'

// ── Helpers ───────────────────────────────────────────────────────

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlString(s) {
  return b64url(new TextEncoder().encode(s))
}

/** Sign a HS256 id_token (LINE format). */
async function signLineIdToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64  = b64urlString(JSON.stringify(header))
  const payloadB64 = b64urlString(JSON.stringify(payload))
  const data       = `${headerB64}.${payloadB64}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return `${data}.${b64url(sig)}`
}

/** Build an Apple-style id_token (unsigned — Apple path uses decodeJwtPayload only). */
function fakeAppleIdToken(payload) {
  const headerB64  = b64urlString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payloadB64 = b64urlString(JSON.stringify(payload))
  return `${headerB64}.${payloadB64}.fake-signature`
}

async function seedOauthState({
  state, codeVerifier = 'verifier-xyz', nonce = null,
  redirectUri = 'https://chiyigo.com/api/auth/oauth/line/callback',
  platform = 'web', clientCallback = null, ttlSec = 600,
}) {
  const exp = new Date(Date.now() + ttlSec * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(`INSERT INTO oauth_states
      (state_token, code_verifier, nonce, redirect_uri, platform, client_callback, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(state, codeVerifier, nonce, redirectUri, platform, clientCallback, exp)
    .run()
}

function callCb(provider, state, code = 'auth-code') {
  const url = `${BASE}/${provider}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
  return cbGet({
    request: new Request(url, { method: 'GET', headers: { 'CF-Connecting-IP': '1.2.3.4' } }),
    env,
    params: { provider },
    waitUntil: () => {},
    data: {},
    next: async () => new Response('next'),
  })
}

let fetchCalls

function makeFetchMock(plan) {
  return vi.fn(async (input) => {
    const url = typeof input === 'string' ? input : input.url
    fetchCalls.push(url)
    if (url.endsWith('/token') || url.includes('/oauth2/')) {
      return new Response(JSON.stringify(plan.tokenBody), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.includes('api.line.me/v2/profile')) {
      return new Response(JSON.stringify(plan.profileBody), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response('not-mocked', { status: 599 })
  })
}

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})

beforeEach(async () => {
  await resetDb()
  env.LINE_CLIENT_ID     = 'line-cid'
  env.LINE_CLIENT_SECRET = 'line-channel-secret'
  env.APPLE_CLIENT_ID     = 'apple-cid'
  env.APPLE_CLIENT_SECRET = 'apple-secret'
  fetchCalls = []
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ── LINE ──────────────────────────────────────────────────────────

describe('LINE callback nonce 驗證', () => {
  it('id_token.nonce 與 stored.nonce 相符 → 成功登入', async () => {
    const expectedNonce = 'nonce-good-1'
    const idToken = await signLineIdToken(
      {
        iss: 'https://access.line.me', sub: 'line-uid-1',
        aud: 'line-cid', exp: Math.floor(Date.now() / 1000) + 600,
        nonce: expectedNonce, email: 'good@line.example',
      },
      'line-channel-secret',
    )

    vi.stubGlobal('fetch', makeFetchMock({
      tokenBody:   { access_token: 'fake-tok', id_token: idToken },
      profileBody: { userId: 'line-uid-1', displayName: 'LineUser' },
    }))

    await seedOauthState({ state: 'state-good', nonce: expectedNonce })
    const res = await callCb('line', 'state-good')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/)

    // user 已建立，email 取自 id_token（LINE profile API 不含 email）
    const u = await env.chiyigo_db
      .prepare('SELECT id, email FROM users WHERE email = ?')
      .bind('good@line.example').first()
    expect(u).toBeTruthy()
  })

  it('id_token.nonce 與 stored.nonce 不符 → 拒絕（replay 防禦）', async () => {
    const idToken = await signLineIdToken(
      {
        iss: 'https://access.line.me', sub: 'line-uid-2',
        aud: 'line-cid', exp: Math.floor(Date.now() / 1000) + 600,
        nonce: 'nonce-from-attacker',  // 非本次 session 的 nonce
        email: 'evil@line.example',
      },
      'line-channel-secret',
    )

    vi.stubGlobal('fetch', makeFetchMock({
      tokenBody:   { access_token: 'fake-tok', id_token: idToken },
      profileBody: { userId: 'line-uid-2', displayName: 'Evil' },
    }))

    await seedOauthState({ state: 'state-replay', nonce: 'nonce-real-session' })
    const res = await callCb('line', 'state-replay')
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toMatch(/無法取得.*用戶資料|nonce mismatch/)

    // user 不應建立
    const cnt = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?')
      .bind('evil@line.example').first()
    expect(cnt.n).toBe(0)
  })

  it('id_token.nonce 缺失（攻擊者注入無 nonce 的 token）→ 拒絕', async () => {
    const idToken = await signLineIdToken(
      {
        iss: 'https://access.line.me', sub: 'line-uid-3',
        aud: 'line-cid', exp: Math.floor(Date.now() / 1000) + 600,
        // 沒有 nonce
        email: 'no-nonce@line.example',
      },
      'line-channel-secret',
    )

    vi.stubGlobal('fetch', makeFetchMock({
      tokenBody:   { access_token: 'fake-tok', id_token: idToken },
      profileBody: { userId: 'line-uid-3', displayName: 'NoNonce' },
    }))

    await seedOauthState({ state: 'state-no-nonce', nonce: 'expected-x' })
    const res = await callCb('line', 'state-no-nonce')
    expect(res.status).toBe(400)
  })

  it('stored.nonce 為 NULL（legacy 進行中 session）→ 不執行 nonce 比對，仍可登入', async () => {
    const idToken = await signLineIdToken(
      {
        iss: 'https://access.line.me', sub: 'line-legacy',
        aud: 'line-cid', exp: Math.floor(Date.now() / 1000) + 600,
        email: 'legacy@line.example',
      },
      'line-channel-secret',
    )

    vi.stubGlobal('fetch', makeFetchMock({
      tokenBody:   { access_token: 'fake-tok', id_token: idToken },
      profileBody: { userId: 'line-legacy', displayName: 'Legacy' },
    }))

    await seedOauthState({ state: 'state-legacy', nonce: null })
    const res = await callCb('line', 'state-legacy')
    expect(res.status).toBe(200)
  })
})

// ── init.js 寫入 nonce + 注入授權 URL ──────────────────────────────

describe('init.js OIDC nonce 生成', () => {
  it('google init → 寫入 nonce + 授權 URL 帶 nonce 參數', async () => {
    const { onRequestGet: initGet } = await import('../../functions/api/auth/oauth/[provider]/init.js')
    env.GOOGLE_CLIENT_ID     = 'goog-cid'
    env.GOOGLE_CLIENT_SECRET = 'goog-sec'
    const res = await initGet({
      request: new Request('http://localhost/api/auth/oauth/google/init?platform=web'),
      env, params: { provider: 'google' },
      waitUntil: () => {}, data: {}, next: async () => new Response('next'),
    })
    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toContain('accounts.google.com')
    const u = new URL(location)
    const nonce = u.searchParams.get('nonce')
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)

    // DB 應持久化相同 nonce
    const state = u.searchParams.get('state')
    const row = await env.chiyigo_db
      .prepare('SELECT nonce FROM oauth_states WHERE state_token = ?')
      .bind(state).first()
    expect(row.nonce).toBe(nonce)
  })

  it('discord init（純 OAuth2，無 id_token）→ 不寫 nonce', async () => {
    const { onRequestGet: initGet } = await import('../../functions/api/auth/oauth/[provider]/init.js')
    env.DISCORD_CLIENT_ID     = 'd-cid'
    env.DISCORD_CLIENT_SECRET = 'd-sec'
    const res = await initGet({
      request: new Request('http://localhost/api/auth/oauth/discord/init?platform=web'),
      env, params: { provider: 'discord' },
      waitUntil: () => {}, data: {}, next: async () => new Response('next'),
    })
    expect(res.status).toBe(302)
    const u = new URL(res.headers.get('Location'))
    expect(u.searchParams.get('nonce')).toBeNull()

    const state = u.searchParams.get('state')
    const row = await env.chiyigo_db
      .prepare('SELECT nonce FROM oauth_states WHERE state_token = ?')
      .bind(state).first()
    expect(row.nonce).toBeNull()
  })
})

// ── Apple ─────────────────────────────────────────────────────────

describe('Apple callback nonce 驗證', () => {
  it('id_token.nonce 與 stored.nonce 不符 → 拒絕', async () => {
    const idToken = fakeAppleIdToken({
      sub: 'apple-uid-1', email: 'attacker@apple.example',
      email_verified: 'true', nonce: 'wrong-nonce',
    })
    vi.stubGlobal('fetch', makeFetchMock({
      tokenBody: { access_token: 'fake-tok', id_token: idToken },
    }))

    await seedOauthState({
      state: 'state-apple-replay',
      nonce: 'real-apple-nonce',
      redirectUri: 'https://chiyigo.com/api/auth/oauth/apple/callback',
    })
    const res = await callCb('apple', 'state-apple-replay')
    expect(res.status).toBe(400)
    const body = await res.text()
    expect(body).toMatch(/無法取得.*用戶資料/)

    const cnt = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?')
      .bind('attacker@apple.example').first()
    expect(cnt.n).toBe(0)
  })

  it('id_token.nonce 與 stored.nonce 相符 → 成功', async () => {
    const goodNonce = 'real-apple-nonce-2'
    const idToken = fakeAppleIdToken({
      sub: 'apple-uid-2', email: 'good@apple.example',
      email_verified: 'true', nonce: goodNonce,
    })
    vi.stubGlobal('fetch', makeFetchMock({
      tokenBody: { access_token: 'fake-tok', id_token: idToken },
    }))

    await seedOauthState({
      state: 'state-apple-good',
      nonce: goodNonce,
      redirectUri: 'https://chiyigo.com/api/auth/oauth/apple/callback',
    })
    const res = await callCb('apple', 'state-apple-good')
    expect(res.status).toBe(200)
  })
})
