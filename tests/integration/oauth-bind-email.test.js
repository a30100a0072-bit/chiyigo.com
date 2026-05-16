/**
 * F7: OAuth bind-email 整合測試
 *
 * 涵蓋：
 *  1. 成功路徑：合法 temp_bind token + 新 email → 建 user + identity，回 access_token + Set-Cookie
 *  2. F6 canonicalize：JWT 內 provider='Google'（mixed-case）→ DB 寫入 'google'
 *  3. F1 defense-in-depth：JWT 內 provider 不在 PROVIDERS allowlist → 400 UNSUPPORTED_PROVIDER
 *  4. scope 不是 'temp_bind' → 401 LINK_TYPE_INVALID
 *  5. token 簽章壞掉 → 401 LINK_INVALID_OR_EXPIRED
 *  6. email 與既有帳號碰撞 → 409 EMAIL_USED_BIND_AFTER_LOGIN（不靜默接管）
 *  7. 重放：identity 已存在 → 沿用 user_id 不重建
 *  8. email 格式錯誤 → 400 INVALID_EMAIL_FORMAT
 *  9. 缺欄位 → 400 MISSING_REQUIRED_FIELD
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt'
import { onRequestPost as bindEmailPost } from '../../functions/api/auth/oauth/bind-email'

const URL_PATH = 'http://localhost/api/auth/oauth/bind-email'

function callBindEmail(body, { headers = {} } = {}) {
  return bindEmailPost({
    request: new Request(URL_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4', ...headers },
      body: JSON.stringify(body),
    }),
    env,
    params: {},
    waitUntil: () => {},
    data: {},
    next: async () => new Response('next'),
  })
}

async function signTempBind({ sub = 'discord-uid-1', provider = 'discord', name = 'User', avatar = null } = {}) {
  return signJwt({ sub, provider, name, avatar, scope: 'temp_bind' }, '10m', env)
}

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})

beforeEach(async () => {
  await resetDb()
})

describe('bind-email 成功路徑', () => {
  it('合法 temp_bind + 新 email → 建 user/identity + 回 access_token + Set-Cookie', async () => {
    const token = await signTempBind({ sub: 'discord-uid-new', provider: 'discord', name: 'Alice' })
    const res = await callBindEmail({ token, email: 'alice@example.com' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toMatch(/^eyJ/)
    expect(res.headers.get('Set-Cookie')).toMatch(/chiyigo_refresh=/)

    const u = await env.chiyigo_db
      .prepare('SELECT id, email, email_verified FROM users WHERE email = ?')
      .bind('alice@example.com').first()
    expect(u).toBeTruthy()
    expect(u.email_verified).toBe(0)

    const ident = await env.chiyigo_db
      .prepare('SELECT provider, provider_id FROM user_identities WHERE user_id = ?')
      .bind(u.id).first()
    expect(ident.provider).toBe('discord')
    expect(ident.provider_id).toBe('discord-uid-new')

    const rt = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?')
      .bind(u.id).first()
    expect(rt.n).toBe(1)
  })

  it('email 帶大小寫/前後空白 → 正規化為小寫 trim', async () => {
    const token = await signTempBind({ sub: 'discord-uid-trim' })
    const res = await callBindEmail({ token, email: '  BoB@Example.COM ' })
    expect(res.status).toBe(200)
    const u = await env.chiyigo_db
      .prepare('SELECT email FROM users WHERE email = ?').bind('bob@example.com').first()
    expect(u).toBeTruthy()
  })
})

describe('bind-email F6 provider canonicalize', () => {
  it("JWT 內 provider='Google'（mixed-case）→ DB user_identities.provider 寫入 'google'", async () => {
    const token = await signTempBind({ sub: 'goog-uid-mixed', provider: 'Google', name: 'Mixie' })
    const res = await callBindEmail({ token, email: 'mixie@example.com' })
    expect(res.status).toBe(200)

    const ident = await env.chiyigo_db
      .prepare('SELECT provider FROM user_identities WHERE provider_id = ?')
      .bind('goog-uid-mixed').first()
    expect(ident.provider).toBe('google')
    expect(ident.provider).not.toBe('Google')
  })

  it("JWT 內 provider='GOOGLE'（all-caps）→ 同一 (provider, provider_id) invariant 不被污染", async () => {
    // 預先用小寫綁定建一筆
    const t1 = await signTempBind({ sub: 'goog-uid-dup', provider: 'google' })
    const r1 = await callBindEmail({ token: t1, email: 'first@example.com' })
    expect(r1.status).toBe(200)

    // 再用 'GOOGLE' 同 provider_id 進來，應命中既有 identity（idempotent 重放）
    const t2 = await signTempBind({ sub: 'goog-uid-dup', provider: 'GOOGLE' })
    const r2 = await callBindEmail({ token: t2, email: 'second@example.com' })
    // 既有 identity → 沿用 user_id，DB 不應出現 provider='GOOGLE' 第二列
    expect(r2.status).toBe(200)

    const rows = await env.chiyigo_db
      .prepare('SELECT provider FROM user_identities WHERE provider_id = ?')
      .bind('goog-uid-dup').all()
    expect(rows.results.length).toBe(1)
    expect(rows.results[0].provider).toBe('google')
  })
})

describe('bind-email F1 unsupported provider defense-in-depth', () => {
  it('簽出的 temp_bind 帶非 allowlist provider → 400 UNSUPPORTED_PROVIDER', async () => {
    const token = await signTempBind({ sub: 'fc-uid', provider: 'fakecorp' })
    const res = await callBindEmail({ token, email: 'foo@example.com' })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('UNSUPPORTED_PROVIDER')

    const cnt = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').bind('foo@example.com').first()
    expect(cnt.n).toBe(0)
  })

  it('mixed-case 但仍不在 allowlist（FakeCorp）→ 同樣 400', async () => {
    const token = await signTempBind({ sub: 'fc-uid-2', provider: 'FakeCorp' })
    const res = await callBindEmail({ token, email: 'bar@example.com' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('UNSUPPORTED_PROVIDER')
  })
})

describe('bind-email token 驗證', () => {
  it('scope 不是 temp_bind → 401 LINK_TYPE_INVALID', async () => {
    const token = await signJwt(
      { sub: '1', provider: 'discord', scope: 'access' },
      '10m', env,
    )
    const res = await callBindEmail({ token, email: 'x@example.com' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('LINK_TYPE_INVALID')
  })

  it('token 簽章壞掉 → 401 LINK_INVALID_OR_EXPIRED', async () => {
    const res = await callBindEmail({ token: 'not-a-real-jwt', email: 'x@example.com' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('LINK_INVALID_OR_EXPIRED')
  })

  it('payload 缺 provider 字串 → 401 TOKEN_DATA_INCOMPLETE', async () => {
    const token = await signJwt(
      { sub: 'u1', scope: 'temp_bind' /* no provider */ },
      '10m', env,
    )
    const res = await callBindEmail({ token, email: 'x@example.com' })
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('TOKEN_DATA_INCOMPLETE')
  })
})

describe('bind-email email 碰撞', () => {
  it('email 與既有帳號碰撞 → 409 EMAIL_USED_BIND_AFTER_LOGIN（不靜默接管）', async () => {
    await env.chiyigo_db
      .prepare('INSERT INTO users (email, email_verified) VALUES (?, 1)')
      .bind('taken@example.com').run()
    const existing = await env.chiyigo_db
      .prepare('SELECT id FROM users WHERE email = ?').bind('taken@example.com').first()

    const token = await signTempBind({ sub: 'discord-uid-collide', provider: 'discord' })
    const res = await callBindEmail({ token, email: 'taken@example.com' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('EMAIL_USED_BIND_AFTER_LOGIN')
    expect(body.provider).toBe('discord')

    // 既有 user 不應被綁上新 identity
    const ident = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM user_identities WHERE user_id = ?')
      .bind(existing.id).first()
    expect(ident.n).toBe(0)
  })
})

describe('bind-email 重放（identity already bound）', () => {
  it('同 (provider, provider_id) 再次 bind → 沿用既有 user_id 不重建', async () => {
    const token1 = await signTempBind({ sub: 'discord-uid-replay', provider: 'discord' })
    const r1 = await callBindEmail({ token: token1, email: 'first@example.com' })
    expect(r1.status).toBe(200)
    const u1 = await env.chiyigo_db
      .prepare('SELECT id FROM users WHERE email = ?').bind('first@example.com').first()

    const token2 = await signTempBind({ sub: 'discord-uid-replay', provider: 'discord' })
    const r2 = await callBindEmail({ token: token2, email: 'shouldNotMatter@example.com' })
    expect(r2.status).toBe(200)

    // 不應建第二個 user
    const cnt = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM users').first()
    expect(cnt.n).toBe(1)

    const ident = await env.chiyigo_db
      .prepare('SELECT user_id FROM user_identities WHERE provider_id = ?')
      .bind('discord-uid-replay').first()
    expect(ident.user_id).toBe(u1.id)
  })
})

describe('bind-email 入口校驗', () => {
  it('email 格式錯誤 → 400 INVALID_EMAIL_FORMAT', async () => {
    const token = await signTempBind({ sub: 'discord-uid-bad-email' })
    const res = await callBindEmail({ token, email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_EMAIL_FORMAT')
  })

  it('缺 token → 400 MISSING_REQUIRED_FIELD', async () => {
    const res = await callBindEmail({ email: 'x@example.com' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('缺 email → 400 MISSING_REQUIRED_FIELD', async () => {
    const token = await signTempBind()
    const res = await callBindEmail({ token })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('MISSING_REQUIRED_FIELD')
  })

  it('request body 非 JSON → 400 INVALID_REQUEST_FORMAT', async () => {
    const res = await bindEmailPost({
      request: new Request(URL_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      env, params: {}, waitUntil: () => {}, data: {}, next: async () => new Response('next'),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('INVALID_REQUEST_FORMAT')
  })
})
