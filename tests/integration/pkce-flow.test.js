/**
 * PKCE OAuth flow integration tests
 *
 * 鎖定 chiyigo IAM 作為 Authorization Server 的核心契約：
 *   GET  /api/auth/oauth/authorize  — 建立 pkce_session、redirect 到 login.html
 *   POST /api/auth/oauth/token      — 驗證 code+verifier、簽 access_token+refresh_token
 *
 * 為什麼要保護：
 *  - mbti.chiyigo.com 走這條，未來 Phase 2 OIDC 化前，先把現行行為鎖死
 *  - 過去踩過兩個雷必測（regression）：
 *      8ab3889: PKCE token 漏 ver claim → 用戶 reset password 後 mbti 端被 token revoked
 *      80bedeb: aud 簽錯 → 子站 worker reject token
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { env } from 'cloudflare:test'
import { jwtVerify, importJWK } from 'jose'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import {
  hashToken,
  generateSecureToken,
} from '../../functions/utils/crypto.js'

// PKCE S256: code_challenge = BASE64URL(SHA-256(code_verifier))
async function pkceChallenge(verifier) {
  const enc    = new TextEncoder()
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

import { onRequestGet  as authorizeGet  } from '../../functions/api/auth/oauth/authorize.js'
import { onRequestPost as tokenPost     } from '../../functions/api/auth/oauth/token.js'

const ORIGIN = 'https://chiyigo.com'

// PKCE helpers — 模擬 client 端 verifier/challenge 對
async function newPkcePair() {
  const verifier  = generateSecureToken()  // 64 hex chars，符合 RFC 7636 43-128 chars
  const challenge = await pkceChallenge(verifier)
  return { verifier, challenge }
}

// 直接 seed 一個 auth_code（模擬 /code endpoint 已成功消化 pkce_session 並發碼）
async function seedAuthCode({ userId, codeChallenge, redirectUri, state = 'st_abc', ttlMinutes = 5, scope = null, nonce = null }) {
  const code      = generateSecureToken()
  const codeHash  = await hashToken(code)
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(`
      INSERT INTO auth_codes (code_hash, user_id, code_challenge, redirect_uri, state, scope, nonce, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(codeHash, userId, codeChallenge, redirectUri, state, scope, nonce, expiresAt)
    .run()
  return code
}

describe('GET /api/auth/oauth/authorize — PKCE entry point', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('合法參數 → 302 redirect 到 /login.html?pkce_key=...，pkce_sessions 寫入', async () => {
    const { challenge } = await newPkcePair()
    const url = new URL(`${ORIGIN}/api/auth/oauth/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', 'https://mbti.chiyigo.com/login.html')
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', 'csrf_xyz')

    const res = await authorizeGet({ request: new Request(url.toString()), env })

    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('Location'))
    expect(loc.pathname).toBe('/login.html')
    expect(loc.searchParams.get('pkce_key')).toMatch(/^[a-f0-9]+$/)

    // session 寫入 DB
    const row = await env.chiyigo_db
      .prepare('SELECT state, code_challenge, redirect_uri FROM pkce_sessions WHERE session_key = ?')
      .bind(loc.searchParams.get('pkce_key'))
      .first()
    expect(row).toMatchObject({
      state: 'csrf_xyz',
      code_challenge: challenge,
      redirect_uri: 'https://mbti.chiyigo.com/login.html',
    })
  })

  it('response_type 非 code → 400', async () => {
    const url = new URL(`${ORIGIN}/api/auth/oauth/authorize`)
    url.searchParams.set('response_type', 'token')  // implicit flow，已不支援
    url.searchParams.set('redirect_uri', 'https://mbti.chiyigo.com/login.html')
    url.searchParams.set('code_challenge', 'x')
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', 'st')
    const res = await authorizeGet({ request: new Request(url.toString()), env })
    expect(res.status).toBe(400)
  })

  it('redirect_uri 白名單接受 sport-app web/admin', async () => {
    for (const redirectUri of [
      'https://sport-app-web.pages.dev/auth/callback',
      'https://sport-app-admin.pages.dev/auth/callback',
    ]) {
      const { challenge } = await newPkcePair()
      const url = new URL(`${ORIGIN}/api/auth/oauth/authorize`)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('code_challenge', challenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('state', 'st')
      const res = await authorizeGet({ request: new Request(url.toString()), env })
      expect(res.status).toBe(302)
    }
  })

  it('redirect_uri 不在白名單 → 400（防 open redirect）', async () => {
    const { challenge } = await newPkcePair()
    const url = new URL(`${ORIGIN}/api/auth/oauth/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', 'https://evil.com/callback')
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', 'st')
    const res = await authorizeGet({ request: new Request(url.toString()), env })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/redirect_uri/)
  })

  it('OIDC: scope=openid + nonce 寫入 pkce_sessions', async () => {
    const { challenge } = await newPkcePair()
    const url = new URL(`${ORIGIN}/api/auth/oauth/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', 'https://mbti.chiyigo.com/login.html')
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', 'st')
    url.searchParams.set('scope', 'openid profile email')
    url.searchParams.set('nonce', 'n_abc123')

    const res = await authorizeGet({ request: new Request(url.toString()), env })
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('Location'))
    const row = await env.chiyigo_db
      .prepare('SELECT scope, nonce FROM pkce_sessions WHERE session_key = ?')
      .bind(loc.searchParams.get('pkce_key')).first()
    expect(row.scope).toBe('openid profile email')
    expect(row.nonce).toBe('n_abc123')
  })

  it('OIDC: 不認的 scope 被過濾掉（不報錯，向後相容）', async () => {
    const { challenge } = await newPkcePair()
    const url = new URL(`${ORIGIN}/api/auth/oauth/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', 'https://mbti.chiyigo.com/login.html')
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', 'st')
    url.searchParams.set('scope', 'openid bogus_scope email')

    const res = await authorizeGet({ request: new Request(url.toString()), env })
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('Location'))
    const row = await env.chiyigo_db
      .prepare('SELECT scope FROM pkce_sessions WHERE session_key = ?')
      .bind(loc.searchParams.get('pkce_key')).first()
    expect(row.scope).toBe('openid email')  // bogus_scope 被濾掉
  })

  it('code_challenge_method != S256 → 400（拒 plain）', async () => {
    const url = new URL(`${ORIGIN}/api/auth/oauth/authorize`)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('redirect_uri', 'https://mbti.chiyigo.com/login.html')
    url.searchParams.set('code_challenge', 'plain_value')
    url.searchParams.set('code_challenge_method', 'plain')
    url.searchParams.set('state', 'st')
    const res = await authorizeGet({ request: new Request(url.toString()), env })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/oauth/token — code exchange', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  async function verifyAccessToken(accessToken) {
    const pubJwk = JSON.parse(env.JWT_PUBLIC_KEY)
    const key    = await importJWK(pubJwk, 'ES256')
    const { payload } = await jwtVerify(accessToken, key, { issuer: 'https://chiyigo.com' })
    return payload
  }

  it('happy path: 完整 code+verifier exchange → 200 + access+refresh + DB refresh row', async () => {
    const user = await seedUser({ email: 'mbti-user@example.com' })
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.token_type).toBe('Bearer')
    expect(body.expires_in).toBe(900)
    expect(body.access_token).toMatch(/^eyJ/)
    expect(body.refresh_token).toMatch(/^[a-f0-9]+$/)

    // refresh_token 寫進 DB（hashed）
    const refreshHash = await hashToken(body.refresh_token)
    const dbRow = await env.chiyigo_db
      .prepare('SELECT user_id FROM refresh_tokens WHERE token_hash = ?')
      .bind(refreshHash).first()
    expect(dbRow?.user_id).toBe(user.id)

    // auth_code 已被原子消化（無法重放）
    const codeHash = await hashToken(code)
    const codeRow  = await env.chiyigo_db
      .prepare('SELECT id FROM auth_codes WHERE code_hash = ?')
      .bind(codeHash).first()
    expect(codeRow).toBeFalsy()
  })

  // 🔴 regression for commit 8ab3889
  it('access_token 必含 ver claim（regression: PKCE 漏 ver 導致 reset password 後被 revoke）', async () => {
    const user = await seedUser({ email: 'ver-test@example.com' })
    // 模擬 user 曾改密碼/刪帳 → token_version 遞增
    await env.chiyigo_db
      .prepare('UPDATE users SET token_version = 3 WHERE id = ?')
      .bind(user.id).run()

    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)

    const payload = await verifyAccessToken(body.access_token)
    expect(payload.ver).toBe(3)  // ⚠️ 不能漏！漏了 mbti 端 requireAuth 會把 token 判 revoked
    expect(payload.sub).toBe(String(user.id))
    expect(payload.email).toBe('ver-test@example.com')
  })

  // 🔴 regression for commit 80bedeb / migration 0013
  it('aud claim 依 redirect_uri origin 決定（mbti.chiyigo.com → aud=mbti）', async () => {
    const user = await seedUser({ email: 'aud-mbti@example.com' })
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)

    const payload = await verifyAccessToken(body.access_token)
    expect(payload.aud).toBe('mbti')
  })

  it('aud claim: sport-app-web.pages.dev → aud=sport-app', async () => {
    const user = await seedUser({ email: 'aud-sport-web@example.com' })
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://sport-app-web.pages.dev/auth/callback'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)

    const payload = await verifyAccessToken(body.access_token)
    expect(payload.aud).toBe('sport-app')
  })

  it('aud claim: sport-app-admin.pages.dev → aud=sport-app', async () => {
    const user = await seedUser({ email: 'aud-sport-admin@example.com' })
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://sport-app-admin.pages.dev/auth/callback'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)

    const payload = await verifyAccessToken(body.access_token)
    expect(payload.aud).toBe('sport-app')
  })

  it('aud claim: chiyigo://auth/callback (App custom scheme) → 預設 aud=chiyigo', async () => {
    const user = await seedUser({ email: 'aud-app@example.com' })
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'chiyigo://auth/callback'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)

    const payload = await verifyAccessToken(body.access_token)
    expect(payload.aud).toBe('chiyigo')
  })

  it('PKCE verifier 與 challenge 不符 → 400', async () => {
    const user = await seedUser()
    const { challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: generateSecureToken(),  // 不對的 verifier
        redirect_uri: redirectUri,
      }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/PKCE/)
  })

  it('redirect_uri 與 authorize 階段不符 → 400（RFC 6749 §4.1.3）', async () => {
    const user = await seedUser()
    const { verifier, challenge } = await newPkcePair()
    const code = await seedAuthCode({
      userId: user.id, codeChallenge: challenge,
      redirectUri: 'https://mbti.chiyigo.com/login.html',
    })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code, code_verifier: verifier,
        redirect_uri: 'https://chiyigo.com/callback',  // 故意換成另一個白名單內的
      }),
    })
    const res = await tokenPost({ request: req, env })
    expect(res.status).toBe(400)
  })

  it('同一 code 二次使用 → 400（atomic DELETE...RETURNING 防重放）', async () => {
    const user = await seedUser()
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const make = () => new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const r1 = await tokenPost({ request: make(), env })
    const r2 = await tokenPost({ request: make(), env })
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(400)  // code 已被消化
  })

  it('過期 code → 400', async () => {
    const user = await seedUser()
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code     = generateSecureToken()
    const codeHash = await hashToken(code)
    const expired  = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(`
      INSERT INTO auth_codes (code_hash, user_id, code_challenge, redirect_uri, state, expires_at)
      VALUES (?, ?, ?, ?, 'st', ?)
    `).bind(codeHash, user.id, challenge, redirectUri, expired).run()

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res = await tokenPost({ request: req, env })
    expect(res.status).toBe(400)
  })

  it('已軟刪用戶 → 404（不發 token）', async () => {
    const user = await seedUser({ email: 'deleted@example.com' })
    await env.chiyigo_db
      .prepare(`UPDATE users SET deleted_at = datetime('now') WHERE id = ?`)
      .bind(user.id).run()

    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res = await tokenPost({ request: req, env })
    expect(res.status).toBe(404)
  })

  // ── OIDC additions ─────────────────────────────────────────────────

  it('OIDC: scope=openid → 回 id_token（含 sub/aud/iss 標準 claims）', async () => {
    const user = await seedUser({ email: 'oidc-user@example.com' })
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({
      userId: user.id, codeChallenge: challenge, redirectUri,
      scope: 'openid email', nonce: 'n_xyz123',
    })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.id_token).toMatch(/^eyJ/)
    expect(body.scope).toBe('openid email')

    const idPayload = await verifyAccessToken(body.id_token)
    expect(idPayload.iss).toBe('https://chiyigo.com')
    expect(idPayload.aud).toBe('mbti')
    expect(idPayload.sub).toBe(String(user.id))
    expect(idPayload.email).toBe('oidc-user@example.com')
    expect(idPayload.email_verified).toBe(true)
    expect(idPayload.nonce).toBe('n_xyz123')
    expect(idPayload.auth_time).toBeTypeOf('number')
  })

  it('OIDC: scope=openid 但未提供 email scope → id_token 不含 email', async () => {
    const user = await seedUser()
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({
      userId: user.id, codeChallenge: challenge, redirectUri,
      scope: 'openid',  // 無 email
    })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)
    const idPayload = await verifyAccessToken(body.id_token)
    expect(idPayload.email).toBeUndefined()
    expect(idPayload.email_verified).toBeUndefined()
  })

  it('OIDC: 無 nonce → id_token 不含 nonce claim', async () => {
    const user = await seedUser()
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({
      userId: user.id, codeChallenge: challenge, redirectUri,
      scope: 'openid email',
      nonce: null,
    })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)
    const idPayload = await verifyAccessToken(body.id_token)
    expect(idPayload.nonce).toBeUndefined()
  })

  it('向後相容: 舊 PKCE client 不傳 scope → 不回 id_token（行為不變）', async () => {
    const user = await seedUser()
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({
      userId: user.id, codeChallenge: challenge, redirectUri,
      scope: null, nonce: null,
    })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.access_token).toMatch(/^eyJ/)
    expect(body.refresh_token).toMatch(/^[a-f0-9]+$/)
    expect(body.id_token).toBeUndefined()
    expect(body.scope).toBeUndefined()
  })

  it('向後相容: scope 不含 openid（例如 scope=email 單獨）→ 不發 id_token', async () => {
    const user = await seedUser()
    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({
      userId: user.id, codeChallenge: challenge, redirectUri,
      scope: 'email',  // 沒帶 openid → 不算 OIDC flow
    })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.id_token).toBeUndefined()
    expect(body.scope).toBe('email')  // scope 仍照映回應，方便 client 確認
  })

  it('被封禁用戶 → 403 ACCOUNT_BANNED', async () => {
    const user = await seedUser({ email: 'banned@example.com' })
    await env.chiyigo_db
      .prepare(`UPDATE users SET status = 'banned' WHERE id = ?`)
      .bind(user.id).run()

    const { verifier, challenge } = await newPkcePair()
    const redirectUri = 'https://mbti.chiyigo.com/login.html'
    const code = await seedAuthCode({ userId: user.id, codeChallenge: challenge, redirectUri })

    const req = new Request(`${ORIGIN}/api/auth/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri }),
    })
    const res  = await tokenPost({ request: req, env })
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('ACCOUNT_BANNED')
  })
})
