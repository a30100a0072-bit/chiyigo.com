/**
 * Phase D-2 Wave A — WebAuthn 註冊 ceremony 整合測試
 *
 * 涵蓋兩個 endpoint：
 *  - POST /api/auth/webauthn/register-options
 *  - POST /api/auth/webauthn/register-verify
 *
 * @simplewebauthn/server 的 verifyRegistrationResponse 用 vi.mock 替換成
 * deterministic stub，避免測試需要真的 attestation byte stream。
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'

// ── Hoisted mock state（vi.mock factory 必須是 pure）─────────────
const mockState = vi.hoisted(() => ({
  verifyResult: null,    // { verified, registrationInfo } 或拋例外
  verifyThrows: null,
}))

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(async () => {
      if (mockState.verifyThrows) throw new Error(mockState.verifyThrows)
      return mockState.verifyResult
    }),
  }
})

// 動態 import：vi.mock 必須在 import target 之前生效
const { onRequestPost: optionsHandler } = await import(
  '../../functions/api/auth/webauthn/register-options.js'
)
const { onRequestPost: verifyHandler } = await import(
  '../../functions/api/auth/webauthn/register-verify.js'
)

env.WEBAUTHN_RP_ID    = 'localhost'
env.WEBAUTHN_RP_NAME  = 'Chiyigo Test'
env.WEBAUTHN_ORIGINS  = 'http://localhost'

async function userToken(userId, email = 'wa@x') {
  return signJwt(
    { sub: String(userId), email, role: 'player', status: 'active', ver: 0,
      scope: 'read:profile write:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

function bearer(url, token, body = {}) {
  return new Request(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

function bytesToB64url(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeClientDataJSON(challenge, type = 'webauthn.create') {
  const payload = JSON.stringify({ type, challenge, origin: 'http://localhost' })
  return bytesToB64url(new TextEncoder().encode(payload))
}

describe('POST /api/auth/webauthn/register-options', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 access_token → 401', async () => {
    const req = new Request('http://x/api/auth/webauthn/register-options', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    const resp = await optionsHandler({ request: req, env })
    expect(resp.status).toBe(401)
  })

  it('happy path → options 正常 + challenge 入庫', async () => {
    const u = await seedUser({ email: 'opts@x' })
    const tok = await userToken(u.id, 'opts@x')
    const resp = await optionsHandler({
      request: bearer('http://x/api/auth/webauthn/register-options', tok), env,
    })
    expect(resp.status).toBe(200)
    const body = await resp.json()
    expect(body.challenge).toBeTruthy()
    expect(body.rp.id).toBe('localhost')
    expect(body.rp.name).toBe('Chiyigo Test')
    expect(body.pubKeyCredParams.length).toBeGreaterThan(0)

    const row = await env.chiyigo_db.prepare(
      `SELECT user_id, ceremony FROM webauthn_challenges WHERE challenge = ?`,
    ).bind(body.challenge).first()
    expect(row).not.toBeNull()
    expect(row.user_id).toBe(u.id)
    expect(row.ceremony).toBe('register')
  })

  it('既有 credential → excludeCredentials 帶上', async () => {
    const u = await seedUser({ email: 'excl@x' })
    await env.chiyigo_db.prepare(
      `INSERT INTO user_webauthn_credentials
         (user_id, credential_id, public_key, counter, transports)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(u.id, 'cred-existing-001', 'pk-bytes', 0, JSON.stringify(['internal'])).run()

    const tok = await userToken(u.id, 'excl@x')
    const resp = await optionsHandler({
      request: bearer('http://x/api/auth/webauthn/register-options', tok), env,
    })
    const body = await resp.json()
    expect(body.excludeCredentials).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'cred-existing-001' }),
      ]),
    )
  })
})

describe('POST /api/auth/webauthn/register-verify', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    mockState.verifyResult = null
    mockState.verifyThrows = null
  })

  async function seedChallenge(userId, challenge) {
    const exp = new Date(Date.now() + 5 * 60_000)
      .toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(
      `INSERT INTO webauthn_challenges (challenge, user_id, ceremony, expires_at)
       VALUES (?, ?, 'register', ?)`,
    ).bind(challenge, userId, exp).run()
  }

  function fakeCredResponse(challenge) {
    return {
      id:    'fake-cred-id',
      rawId: 'fake-cred-id',
      type:  'public-key',
      response: {
        clientDataJSON:    makeClientDataJSON(challenge),
        attestationObject: 'irrelevant',
      },
      clientExtensionResults: {},
    }
  }

  it('challenge 不存在 → 400', async () => {
    const u = await seedUser({ email: 'v1@x' })
    const tok = await userToken(u.id, 'v1@x')
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('challenge-never-saved'),
      }),
      env,
    })
    expect(resp.status).toBe(400)
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'webauthn.register.fail'`,
    ).first()
    expect(audit).not.toBeNull()
  })

  it('challenge user_id 不符（搶別人挑戰）→ 400 critical audit', async () => {
    const a = await seedUser({ email: 'a@x' })
    const b = await seedUser({ email: 'b@x' })
    await seedChallenge(a.id, 'shared-challenge-1')
    const tokB = await userToken(b.id, 'b@x')
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tokB, {
        response: fakeCredResponse('shared-challenge-1'),
      }),
      env,
    })
    expect(resp.status).toBe(400)
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log
         WHERE event_type = 'webauthn.register.fail' AND user_id = ?`,
    ).bind(b.id).first()
    expect(audit?.severity).toBe('critical')
  })

  it('verify lib 拋例外 → 400', async () => {
    const u = await seedUser({ email: 'v2@x' })
    const tok = await userToken(u.id, 'v2@x')
    await seedChallenge(u.id, 'ch-throws')
    mockState.verifyThrows = 'attestation parse error'
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('ch-throws'),
      }),
      env,
    })
    expect(resp.status).toBe(400)
  })

  it('verify 回 verified=false → 400', async () => {
    const u = await seedUser({ email: 'v3@x' })
    const tok = await userToken(u.id, 'v3@x')
    await seedChallenge(u.id, 'ch-notverified')
    mockState.verifyResult = { verified: false }
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('ch-notverified'),
      }),
      env,
    })
    expect(resp.status).toBe(400)
  })

  it('happy path → INSERT + audit + challenge 被消耗', async () => {
    const u = await seedUser({ email: 'v4@x' })
    const tok = await userToken(u.id, 'v4@x')
    await seedChallenge(u.id, 'ch-happy')
    mockState.verifyResult = {
      verified: true,
      registrationInfo: {
        aaguid: 'aaaa-bbbb-cccc',
        credentialBackedUp: true,
        credentialDeviceType: 'multiDevice',
        credential: {
          id:        'cred-new-001',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter:   0,
          transports: ['internal', 'hybrid'],
        },
      },
    }
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('ch-happy'),
        nickname: '我的 iPhone',
      }),
      env,
    })
    expect(resp.status).toBe(200)
    const credRow = await env.chiyigo_db.prepare(
      `SELECT user_id, nickname, transports, backup_eligible, backup_state, public_key
         FROM user_webauthn_credentials WHERE credential_id = ?`,
    ).bind('cred-new-001').first()
    expect(credRow.user_id).toBe(u.id)
    expect(credRow.nickname).toBe('我的 iPhone')
    expect(JSON.parse(credRow.transports)).toEqual(['internal', 'hybrid'])
    expect(credRow.backup_eligible).toBe(1)
    expect(credRow.backup_state).toBe(1)
    expect(credRow.public_key).toBeTruthy()

    const ch = await env.chiyigo_db.prepare(
      `SELECT 1 FROM webauthn_challenges WHERE challenge = 'ch-happy'`,
    ).first()
    expect(ch).toBeNull()

    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'webauthn.register.success' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit).not.toBeNull()
  })

  it('credential_id 已存在 → 409', async () => {
    const u = await seedUser({ email: 'v5@x' })
    const tok = await userToken(u.id, 'v5@x')
    await seedChallenge(u.id, 'ch-dup')
    await env.chiyigo_db.prepare(
      `INSERT INTO user_webauthn_credentials (user_id, credential_id, public_key)
       VALUES (?, ?, ?)`,
    ).bind(u.id, 'cred-dup-001', 'pk').run()

    mockState.verifyResult = {
      verified: true,
      registrationInfo: {
        aaguid: null, credentialBackedUp: false, credentialDeviceType: 'singleDevice',
        credential: {
          id: 'cred-dup-001', publicKey: new Uint8Array([9]), counter: 0, transports: [],
        },
      },
    }
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('ch-dup'),
      }),
      env,
    })
    expect(resp.status).toBe(409)
  })
})
