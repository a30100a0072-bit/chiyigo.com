/**
 * SEC-FACTOR-ADD-A PR-A2 — elevation 端點測試（/elevation/{totp,password,exchange}）
 *
 * 驗：sid fail-closed、TOTP/backup elevation、current_password elevation + 防降級、
 *     OAuth exchange code → grant、replay/expired/session-mismatch 拒、grant 鑄出正確
 *     (purpose=factor_add + action + method + sid)。
 *
 * factor-add 端點實際 gate（consume grant）在 PR-A3；本檔只驗 grant 正確鑄出。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedOauthOnlyUser, enableTotp, seedBackupCode, ensureJwtKeys, jsonPost } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { hashToken } from '../../functions/utils/crypto'
import { onRequestPost as totpHandler } from '../../functions/api/auth/elevation/totp'
import { onRequestPost as passwordHandler } from '../../functions/api/auth/elevation/password'
import { onRequestPost as exchangeHandler } from '../../functions/api/auth/elevation/exchange'

const SECRET = 'JBSWY3DPEHPK3PXP'
const liveOtp = (s: string) => new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(s) }).generate()

async function tok(userId: number, { sid = 'sess-1' as string | null } = {}) {
  const claims: Record<string, unknown> = { sub: String(userId), email: `u${userId}@x`, role: 'player', status: 'active', ver: 0 }
  if (sid) claims.sid = sid
  return signJwt(claims, '15m', env, { audience: 'chiyigo' })
}

function call(handler: (c: { request: Request; env: Env }) => Promise<Response>, token: string, body: unknown) {
  return handler({ request: jsonPost('http://x/api/auth/elevation', body, { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '1.2.3.4' }), env })
}

async function grantRow(userId: number) {
  return env.chiyigo_db.prepare(`SELECT * FROM elevation_grants WHERE user_id = ? ORDER BY id DESC LIMIT 1`).bind(userId).first()
}

describe('POST /api/auth/elevation/totp', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('無 sid claim → 403 ELEVATION_SID_REQUIRED（fail-closed）', async () => {
    const { id } = await seedUser({ email: 'a@x' }); await enableTotp(id, SECRET)
    const r = await call(totpHandler, await tok(id, { sid: null }), { action: 'add_passkey', otp_code: liveOtp(SECRET) })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('ELEVATION_SID_REQUIRED')
  })

  it('非法 action → 400', async () => {
    const { id } = await seedUser({ email: 'a@x' }); await enableTotp(id, SECRET)
    const r = await call(totpHandler, await tok(id), { action: 'delete_account', otp_code: liveOtp(SECRET) })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('INVALID_ACTION')
  })

  it('未啟用 2FA → 403', async () => {
    const { id } = await seedUser({ email: 'a@x' })  // 無 totp
    const r = await call(totpHandler, await tok(id), { action: 'add_passkey', otp_code: '000000' })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('ELEVATION_REQUIRES_2FA')
  })

  it('正確 TOTP → 200 grant（purpose=factor_add + action + method=totp + sid）', async () => {
    const { id } = await seedUser({ email: 'a@x' }); await enableTotp(id, SECRET)
    const r = await call(totpHandler, await tok(id, { sid: 'S9' }), { action: 'bind_wallet', otp_code: liveOtp(SECRET) })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.grant_token).toBeTruthy()
    expect(body.expires_in).toBe(300)
    const g = await grantRow(id)
    expect(g.purpose).toBe('factor_add')
    expect(g.action).toBe('bind_wallet')
    expect(g.method).toBe('totp')
    expect(g.session_id).toBe('S9')
    expect(g.grant_token_hash).toBe(await hashToken(body.grant_token))  // 明文不入 DB
  })

  it('backup code → 200 grant；錯碼 6 次 → 429', async () => {
    const { id } = await seedUser({ email: 'a@x' }); await enableTotp(id, SECRET)
    const code = await seedBackupCode(id)
    const ok = await call(totpHandler, await tok(id), { action: 'add_passkey', otp_code: code })
    expect(ok.status).toBe(200)
    // 錯碼節流（reset DB 後重來，新 user）
    await resetDb()
    const { id: id2 } = await seedUser({ email: 'b@x' }); await enableTotp(id2, SECRET)
    let last = 0
    for (let i = 0; i < 6; i++) last = (await call(totpHandler, await tok(id2), { action: 'add_passkey', otp_code: '000000' })).status
    expect(last).toBe(429)
  })
})

describe('POST /api/auth/elevation/password', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('有 TOTP → 403 ELEVATION_USE_TOTP（防降級）', async () => {
    const { id, password } = await seedUser({ email: 'a@x' }); await enableTotp(id, SECRET)
    const r = await call(passwordHandler, await tok(id), { action: 'add_passkey', current_password: password })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('ELEVATION_USE_TOTP')
  })

  it('OAuth-only（無密碼）→ 403 ELEVATION_NO_PASSWORD', async () => {
    const { id } = await seedOauthOnlyUser({ email: 'o@x' })
    const r = await call(passwordHandler, await tok(id), { action: 'add_passkey', current_password: 'x' })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('ELEVATION_NO_PASSWORD')
  })

  it('正確密碼（local 無 TOTP）→ 200 grant（method=current_password）', async () => {
    const { id, password } = await seedUser({ email: 'a@x' })  // 有密碼、無 TOTP
    const r = await call(passwordHandler, await tok(id, { sid: 'P1' }), { action: 'bind_identity', current_password: password })
    expect(r.status).toBe(200)
    const g = await grantRow(id)
    expect(g.method).toBe('current_password')
    expect(g.action).toBe('bind_identity')
    expect(g.session_id).toBe('P1')
  })

  it('錯密碼 → 401', async () => {
    const { id } = await seedUser({ email: 'a@x' })
    const r = await call(passwordHandler, await tok(id), { action: 'add_passkey', current_password: 'WrongPass#9' })
    expect(r.status).toBe(401)
    expect((await r.json()).code).toBe('INVALID_PASSWORD')
  })
})

describe('POST /api/auth/elevation/exchange', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  async function seedExchange(userId: number, { sid = 'X1', action = 'bind_identity', code = 'rawcode-1', ttlSec = 120 } = {}) {
    const exp = new Date(Date.now() + ttlSec * 1000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(`
      INSERT INTO elevation_exchanges (exchange_code_hash, user_id, session_id, provider, provider_id_hash, action, expires_at)
      VALUES (?, ?, ?, 'google', 'phash', ?, ?)
    `).bind(await hashToken(code), userId, sid, action, exp).run()
    return code
  }

  it('合法 code（session match）→ 200 grant（method=oauth_reauth + provider 透傳）；code 一次性', async () => {
    const { id } = await seedUser({ email: 'a@x' })
    const code = await seedExchange(id, { sid: 'X1', action: 'add_passkey' })
    const r = await call(exchangeHandler, await tok(id, { sid: 'X1' }), { code })
    expect(r.status).toBe(200)
    const g = await grantRow(id)
    expect(g.method).toBe('oauth_reauth')
    expect(g.action).toBe('add_passkey')
    expect(g.provider).toBe('google')
    expect(g.provider_id_hash).toBe('phash')
    expect(g.session_id).toBe('X1')
    // replay：同 code 再換 → 401 replay_detected
    const r2 = await call(exchangeHandler, await tok(id, { sid: 'X1' }), { code })
    expect(r2.status).toBe(401)
    expect((await r2.json()).code).toBe('EXCHANGE_CODE_INVALID')
  })

  it('session mismatch（sid 不符）→ 401（不換 grant）', async () => {
    const { id } = await seedUser({ email: 'a@x' })
    const code = await seedExchange(id, { sid: 'X1' })
    const r = await call(exchangeHandler, await tok(id, { sid: 'OTHER' }), { code })
    expect(r.status).toBe(401)
  })

  it('過期 code → 401', async () => {
    const { id } = await seedUser({ email: 'a@x' })
    const code = await seedExchange(id, { sid: 'X1', ttlSec: -10 })
    const r = await call(exchangeHandler, await tok(id, { sid: 'X1' }), { code })
    expect(r.status).toBe(401)
  })

  it('無 sid claim → 403', async () => {
    const { id } = await seedUser({ email: 'a@x' })
    const code = await seedExchange(id, { sid: 'X1' })
    const r = await call(exchangeHandler, await tok(id, { sid: null }), { code })
    expect(r.status).toBe(403)
  })
})
