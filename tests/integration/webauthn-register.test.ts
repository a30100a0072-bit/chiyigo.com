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
import { resetDb, ensureJwtKeys, seedUser, seedFactorAddGrant } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'

const WA_SID = 'wa-sess'

// ── Hoisted mock state（vi.mock factory 必須是 pure）─────────────
const mockState = vi.hoisted(() => ({
  verifyResult: null,    // { verified, registrationInfo } 或拋例外
  verifyThrows: null,
}))

vi.mock('@simplewebauthn/server', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
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
  '../../functions/api/auth/webauthn/register-options'
)
const { onRequestPost: verifyHandler } = await import(
  '../../functions/api/auth/webauthn/register-verify'
)

Object.assign(env, {
  WEBAUTHN_RP_ID:   'localhost',
  WEBAUTHN_RP_NAME: 'Chiyigo Test',
  WEBAUTHN_ORIGINS: 'http://localhost',
})

async function userToken(userId, email = 'wa@x') {
  return signJwt(
    { sub: String(userId), email, role: 'player', status: 'active', ver: 0,
      scope: 'read:profile write:profile', sid: WA_SID },
    '15m', env, { audience: 'chiyigo' },
  )
}

// SEC-FACTOR-ADD PR-A3：register-verify 需 factor-add grant（X-Factor-Add-Grant header）。
function bearer(url, token, body = {}, grantToken = null) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  if (grantToken) headers['X-Factor-Add-Grant'] = grantToken
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

// seed 一張 add_passkey grant（sid=WA_SID 對齊 userToken），回 grant_token 供 header 用
async function grantFor(userId: number) {
  return seedFactorAddGrant(userId, { sid: WA_SID, action: 'add_passkey' })
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
    const grant = await grantFor(u.id)
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('challenge-never-saved'),
      }, grant),
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
    const grantB = await grantFor(b.id)
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tokB, {
        response: fakeCredResponse('shared-challenge-1'),
      }, grantB),
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
    const grant = await grantFor(u.id)
    await seedChallenge(u.id, 'ch-throws')
    mockState.verifyThrows = 'attestation parse error'
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('ch-throws'),
      }, grant),
      env,
    })
    expect(resp.status).toBe(400)
  })

  it('verify 回 verified=false → 400', async () => {
    const u = await seedUser({ email: 'v3@x' })
    const tok = await userToken(u.id, 'v3@x')
    const grant = await grantFor(u.id)
    await seedChallenge(u.id, 'ch-notverified')
    mockState.verifyResult = { verified: false }
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('ch-notverified'),
      }, grant),
      env,
    })
    expect(resp.status).toBe(400)
  })

  it('happy path → INSERT + audit + challenge 被消耗', async () => {
    const u = await seedUser({ email: 'v4@x' })
    const tok = await userToken(u.id, 'v4@x')
    const grant = await grantFor(u.id)
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
      }, grant),
      env,
    })
    expect(resp.status).toBe(200)

    // SEC-FACTOR-ADD：成功註冊後 grant 必須被消耗（one-time，atomic batch）
    const grantRow = await env.chiyigo_db.prepare(
      `SELECT consumed_at FROM elevation_grants WHERE user_id = ? AND action = 'add_passkey'`,
    ).bind(u.id).first()
    expect(grantRow?.consumed_at).not.toBeNull()
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
    const grant = await grantFor(u.id)
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
      }, grant),
      env,
    })
    expect(resp.status).toBe(409)
  })

  // ── SEC-FACTOR-ADD P1 封閉：register-verify factor-add grant gate ───────────────
  // 共同證明：偷到 access token ≠ 能加因子。每條鎖一種 grant-failure，且必驗「無 credential 寫入」。
  async function noCredYet(userId: number) {
    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM user_webauthn_credentials WHERE user_id = ?',
    ).bind(userId).first()
    expect(cnt.n).toBe(0)
  }
  function happyVerifyResult(credId: string) {
    return {
      verified: true,
      registrationInfo: {
        aaguid: null, credentialBackedUp: false, credentialDeviceType: 'singleDevice',
        credential: { id: credId, publicKey: new Uint8Array([7]), counter: 0, transports: [] },
      },
    }
  }

  it('P1: 無 X-Factor-Add-Grant header → 403 FACTOR_ADD_GRANT_REQUIRED（pre-fix RED：偷 token 即可加 passkey）', async () => {
    const u = await seedUser({ email: 'gate-nogr@x' })
    const tok = await userToken(u.id, 'gate-nogr@x')
    await seedChallenge(u.id, 'gate-ng')
    mockState.verifyResult = happyVerifyResult('cred-ng')
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('gate-ng'),
      }),  // 故意不帶 grant
      env,
    })
    expect(resp.status).toBe(403)
    expect((await resp.json()).code).toBe('FACTOR_ADD_GRANT_REQUIRED')
    await noCredYet(u.id)
  })

  it('P1: access token 無 sid（PR-0 前舊 token / access-only）→ 403 ELEVATION_SID_REQUIRED（fail-closed）', async () => {
    const u = await seedUser({ email: 'gate-nosid@x' })
    // 無 sid claim 的 token：factor-add 必 fail-closed（無 server session row 可綁 grant）
    const noSidTok = await signJwt(
      { sub: String(u.id), email: 'gate-nosid@x', role: 'player', status: 'active', ver: 0,
        scope: 'read:profile write:profile' },
      '15m', env, { audience: 'chiyigo' },
    )
    const grant = await grantFor(u.id)  // grant 本身有效，但 token 無 sid → gate 先擋
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', noSidTok, {
        response: fakeCredResponse('x'),
      }, grant),
      env,
    })
    expect(resp.status).toBe(403)
    expect((await resp.json()).code).toBe('ELEVATION_SID_REQUIRED')
    await noCredYet(u.id)
  })

  it('P1: grant 是別的 action（bind_wallet）→ 403 FACTOR_ADD_ELEVATION_REQUIRED（cross-action 不可挪用）', async () => {
    const u = await seedUser({ email: 'gate-xact@x' })
    const tok = await userToken(u.id, 'gate-xact@x')
    // 鑄一張 bind_wallet grant，拿去打 add_passkey 端點
    const wrongGrant = await seedFactorAddGrant(u.id, { sid: WA_SID, action: 'bind_wallet' })
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('x'),
      }, wrongGrant),
      env,
    })
    expect(resp.status).toBe(403)
    expect((await resp.json()).code).toBe('FACTOR_ADD_ELEVATION_REQUIRED')
    await noCredYet(u.id)
  })

  it('P1: grant 屬於別的 user → 403（不可跨 user 挪用）', async () => {
    const victim   = await seedUser({ email: 'gate-victim@x' })
    const attacker = await seedUser({ email: 'gate-atk@x' })
    const tokAtk = await userToken(attacker.id, 'gate-atk@x')
    const victimGrant = await seedFactorAddGrant(victim.id, { sid: WA_SID, action: 'add_passkey' })
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tokAtk, {
        response: fakeCredResponse('x'),
      }, victimGrant),
      env,
    })
    expect(resp.status).toBe(403)
    await noCredYet(attacker.id)
    await noCredYet(victim.id)
  })

  it('P1: grant 已過期 → 403（TTL 邊界）', async () => {
    const u = await seedUser({ email: 'gate-exp@x' })
    const tok = await userToken(u.id, 'gate-exp@x')
    const expiredGrant = await seedFactorAddGrant(u.id, { sid: WA_SID, action: 'add_passkey', ttlSec: -10 })
    const resp = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('x'),
      }, expiredGrant),
      env,
    })
    expect(resp.status).toBe(403)
    await noCredYet(u.id)
  })

  it('P1: grant 一次性（replay 同一 grant 第二次）→ 403（one-time consume）', async () => {
    const u = await seedUser({ email: 'gate-replay@x' })
    const tok = await userToken(u.id, 'gate-replay@x')
    const grant = await grantFor(u.id)

    // 第一次：正常 happy path → 200 + grant 消耗
    await seedChallenge(u.id, 'replay-c1')
    mockState.verifyResult = happyVerifyResult('cred-replay-1')
    const r1 = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('replay-c1'),
      }, grant),
      env,
    })
    expect(r1.status).toBe(200)

    // 第二次：fresh challenge，但重用已消耗的 grant → gate pre-read 找不到有效 row → 403
    await seedChallenge(u.id, 'replay-c2')
    mockState.verifyResult = happyVerifyResult('cred-replay-2')
    const r2 = await verifyHandler({
      request: bearer('http://x/api/auth/webauthn/register-verify', tok, {
        response: fakeCredResponse('replay-c2'),
      }, grant),
      env,
    })
    expect(r2.status).toBe(403)
    // 只有第一顆 credential 寫入（cred-replay-2 不存在）
    const dup = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM user_webauthn_credentials WHERE credential_id = ?',
    ).bind('cred-replay-2').first()
    expect(dup.n).toBe(0)
  })
})
