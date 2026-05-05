/**
 * Phase D-2 Wave B — WebAuthn 登入 ceremony 整合測試
 *
 * 涵蓋：
 *  - POST /api/auth/webauthn/login-options（帶 email / 不帶 email / 不存在 email 反枚舉）
 *  - POST /api/auth/webauthn/login-verify（happy / challenge 過期 / 找不到 cred /
 *    challenge user mismatch / verify lib 失敗 / 帳號封禁 / counter 更新 / device_uuid + cookie）
 *
 * verifyAuthenticationResponse 用 vi.mock 替換成 deterministic stub。
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { verifyJwt } from '../../functions/utils/jwt.js'

const mockState = vi.hoisted(() => ({
  verifyResult: null,
  verifyThrows: null,
}))

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    verifyAuthenticationResponse: vi.fn(async () => {
      if (mockState.verifyThrows) throw new Error(mockState.verifyThrows)
      return mockState.verifyResult
    }),
  }
})

const { onRequestPost: optionsHandler } = await import(
  '../../functions/api/auth/webauthn/login-options.js'
)
const { onRequestPost: verifyHandler } = await import(
  '../../functions/api/auth/webauthn/login-verify.js'
)

env.WEBAUTHN_RP_ID    = 'localhost'
env.WEBAUTHN_RP_NAME  = 'Chiyigo Test'
env.WEBAUTHN_ORIGINS  = 'http://localhost'

function bytesToB64url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeClientDataJSON(challenge) {
  const payload = JSON.stringify({ type: 'webauthn.get', challenge, origin: 'http://localhost' })
  return bytesToB64url(new TextEncoder().encode(payload))
}

function fakeAssertion(challenge, credentialId = 'cred-login-001') {
  return {
    id:    credentialId,
    rawId: credentialId,
    type:  'public-key',
    response: {
      clientDataJSON:    makeClientDataJSON(challenge),
      authenticatorData: 'irrelevant',
      signature:         'irrelevant',
      userHandle:        null,
    },
    clientExtensionResults: {},
  }
}

function jsonPost(url, body, headers = {}) {
  return new Request(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify(body),
  })
}

async function seedCredential(userId, credentialId = 'cred-login-001', counter = 0) {
  // public_key 隨便塞（mock 不會解析）；transports JSON
  const pkB64 = bytesToB64url(new Uint8Array([1, 2, 3, 4]))
  await env.chiyigo_db.prepare(
    `INSERT INTO user_webauthn_credentials (user_id, credential_id, public_key, counter, transports)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(userId, credentialId, pkB64, counter, JSON.stringify(['internal'])).run()
}

async function seedChallenge(challenge, userId, ceremony = 'login') {
  const exp = new Date(Date.now() + 5 * 60_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db.prepare(
    `INSERT INTO webauthn_challenges (challenge, user_id, ceremony, expires_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(challenge, userId, ceremony, exp).run()
}

describe('POST /api/auth/webauthn/login-options', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('帶 email + 該 user 有 credentials → allowCredentials 帶上', async () => {
    const u = await seedUser({ email: 'lo1@x' })
    await seedCredential(u.id, 'cred-lo1-A')
    await seedCredential(u.id, 'cred-lo1-B')
    const resp = await optionsHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-options', { email: 'lo1@x' }),
      env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.allowCredentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cred-lo1-A' }),
        expect.objectContaining({ id: 'cred-lo1-B' }),
      ]),
    )
    const ch = await env.chiyigo_db.prepare(
      `SELECT user_id, ceremony FROM webauthn_challenges WHERE challenge = ?`,
    ).bind(body.challenge).first()
    expect(ch.user_id).toBe(u.id)
    expect(ch.ceremony).toBe('login')
  })

  it('不帶 email → usernameless（allowCredentials 空）', async () => {
    const resp = await optionsHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-options', {}),
      env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.allowCredentials ?? []).toEqual([])
    const ch = await env.chiyigo_db.prepare(
      `SELECT user_id FROM webauthn_challenges WHERE challenge = ?`,
    ).bind(body.challenge).first()
    expect(ch.user_id).toBeNull()
  })

  it('email 不存在 → 仍回 200 + challenge 入庫（反帳號枚舉）', async () => {
    const resp = await optionsHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-options', { email: 'nope@x' }),
      env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.allowCredentials ?? []).toEqual([])
    const ch = await env.chiyigo_db.prepare(
      `SELECT user_id FROM webauthn_challenges WHERE challenge = ?`,
    ).bind(body.challenge).first()
    expect(ch.user_id).toBeNull()
  })
})

describe('POST /api/auth/webauthn/login-verify', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    mockState.verifyResult = null
    mockState.verifyThrows = null
  })

  it('challenge 不存在 → 401', async () => {
    const resp = await verifyHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-verify', {
        response: fakeAssertion('never-saved'),
      }),
      env,
    })
    expect(resp.status).toBe(401)
  })

  it('credential 找不到 → 401（同 message 反枚舉）', async () => {
    await seedChallenge('ch-no-cred', null)
    const resp = await verifyHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-verify', {
        response: fakeAssertion('ch-no-cred', 'unknown-cred'),
      }),
      env,
    })
    expect(resp.status).toBe(401)
  })

  it('challenge user_id 與 credential.user_id 不符 → 401 critical audit', async () => {
    const a = await seedUser({ email: 'la@x' })
    const b = await seedUser({ email: 'lb@x' })
    await seedCredential(b.id, 'cred-b-1')
    await seedChallenge('ch-mismatch', a.id)  // challenge 綁 a，但用 b 的 cred
    const resp = await verifyHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-verify', {
        response: fakeAssertion('ch-mismatch', 'cred-b-1'),
      }),
      env,
    })
    expect(resp.status).toBe(401)
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log
         WHERE event_type = 'auth.login.fail' AND user_id = ?`,
    ).bind(b.id).first()
    expect(audit?.severity).toBe('critical')
  })

  it('verify lib 拋例外 → 401', async () => {
    const u = await seedUser({ email: 'lc@x' })
    await seedCredential(u.id, 'cred-throws')
    await seedChallenge('ch-throws', null)
    mockState.verifyThrows = 'sig invalid'
    const resp = await verifyHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-verify', {
        response: fakeAssertion('ch-throws', 'cred-throws'),
      }),
      env,
    })
    expect(resp.status).toBe(401)
  })

  it('帳號封禁 → 403', async () => {
    const u = await seedUser({ email: 'lban@x' })
    await env.chiyigo_db.prepare(`UPDATE users SET status = 'banned' WHERE id = ?`).bind(u.id).run()
    await seedCredential(u.id, 'cred-ban')
    await seedChallenge('ch-ban', null)
    mockState.verifyResult = {
      verified: true,
      authenticationInfo: { newCounter: 5, userVerified: true },
    }
    const resp = await verifyHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-verify', {
        response: fakeAssertion('ch-ban', 'cred-ban'),
      }),
      env,
    })
    expect(resp.status).toBe(403)
  })

  it('happy path（usernameless）→ 200 + amr=[webauthn,mfa] + counter 更新 + cookie + audit', async () => {
    const u = await seedUser({ email: 'lhappy@x' })
    await seedCredential(u.id, 'cred-happy', 0)
    await seedChallenge('ch-happy-login', null)
    mockState.verifyResult = {
      verified: true,
      authenticationInfo: { newCounter: 7, userVerified: true },
    }
    const resp = await verifyHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-verify', {
        response: fakeAssertion('ch-happy-login', 'cred-happy'),
      }),
      env,
    })
    expect(resp.status).toBe(200)
    const setCookie = resp.headers.get('Set-Cookie')
    expect(setCookie).toMatch(/chiyigo_refresh=/)

    const body = await resp.json()
    expect(body.access_token).toBeTruthy()
    expect(body.email).toBe('lhappy@x')

    // access_token 帶 amr
    const decoded = await verifyJwt(body.access_token, env)
    expect(decoded.amr).toEqual(['webauthn', 'mfa'])
    expect(decoded.sub).toBe(String(u.id))

    // counter 更新
    const credRow = await env.chiyigo_db.prepare(
      `SELECT counter, last_used_at FROM user_webauthn_credentials WHERE credential_id = ?`,
    ).bind('cred-happy').first()
    expect(credRow.counter).toBe(7)
    expect(credRow.last_used_at).toBeTruthy()

    // refresh row 寫入
    const rt = await env.chiyigo_db.prepare(
      `SELECT device_uuid FROM refresh_tokens WHERE user_id = ?`,
    ).bind(u.id).first()
    expect(rt).not.toBeNull()
    expect(rt.device_uuid).toBeNull()  // web

    // audit
    const audit = await env.chiyigo_db.prepare(
      `SELECT event_data FROM audit_log
         WHERE event_type = 'auth.login.success' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit).not.toBeNull()
    expect(audit.event_data).toMatch(/webauthn/)
  })

  it('App 路徑：device_uuid + platform=app → JSON refresh_token + 綁 device', async () => {
    const u = await seedUser({ email: 'lapp@x' })
    await seedCredential(u.id, 'cred-app')
    await seedChallenge('ch-app', null)
    mockState.verifyResult = {
      verified: true,
      authenticationInfo: { newCounter: 1, userVerified: false },
    }
    const resp = await verifyHandler({
      request: jsonPost('http://x/api/auth/webauthn/login-verify', {
        response:    fakeAssertion('ch-app', 'cred-app'),
        device_uuid: 'dev-app-001',
        platform:    'app',
      }),
      env,
    })
    expect(resp.status).toBe(200)
    expect(resp.headers.get('Set-Cookie')).toBeNull()
    const body = await resp.json()
    expect(body.refresh_token).toBeTruthy()

    // amr 沒 mfa（userVerified=false）
    const decoded = await verifyJwt(body.access_token, env)
    expect(decoded.amr).toEqual(['webauthn'])

    const rt = await env.chiyigo_db.prepare(
      `SELECT device_uuid FROM refresh_tokens WHERE user_id = ?`,
    ).bind(u.id).first()
    expect(rt.device_uuid).toBe('dev-app-001')
  })
})
