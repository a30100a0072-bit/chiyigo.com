/**
 * Phase C-3 — Step-up authentication flow 整合測試
 *
 * 涵蓋：
 *  - POST /api/auth/step-up endpoint：成功 / 各失敗分支
 *  - requireStepUp helper：嚴格 scope / for_action / 一次性 jti revoke
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { env } from 'cloudflare:test'
import {
  resetDb, ensureJwtKeys, seedUser, enableTotp, seedBackupCode, jsonPost,
} from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { requireStepUp } from '../../functions/utils/auth.js'
import { SCOPES } from '../../functions/utils/scopes.js'
import { onRequestPost as stepUpHandler } from '../../functions/api/auth/step-up.js'

const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXP'  // base32 已知 secret

function freshTotp() {
  const totp = new TOTP({
    algorithm: 'SHA1', digits: 6, period: 30,
    secret: Secret.fromBase32(TEST_TOTP_SECRET),
  })
  return totp.generate()
}

async function userTokenWithScope(userId, role = 'player') {
  return signJwt(
    { sub: String(userId), email: 'a@x', role, status: 'active', ver: 0,
      scope: 'read:profile write:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

function reqWithBearer(token, body) {
  return new Request('http://x/api/auth/step-up', {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

async function callStepUp(token, body) {
  const resp = await stepUpHandler({ request: reqWithBearer(token, body), env })
  return { status: resp.status, body: await resp.json() }
}

describe('POST /api/auth/step-up', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 access_token → 401', async () => {
    const resp = await stepUpHandler({
      request: new Request('http://x/api/auth/step-up', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }),
      env,
    })
    expect(resp.status).toBe(401)
  })

  it('scope 不在 elevated:* 白名單 → 400', async () => {
    const u = await seedUser({ email: 's1@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const tok = await userTokenWithScope(u.id)
    const r = await callStepUp(tok, { scope: 'admin:audit', otp_code: freshTotp() })
    expect(r.status).toBe(400)
  })

  it('scope 缺值 → 400', async () => {
    const u = await seedUser({ email: 's2@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const tok = await userTokenWithScope(u.id)
    const r = await callStepUp(tok, { otp_code: freshTotp() })
    expect(r.status).toBe(400)
  })

  it('otp_code + backup_code 都缺 → 400', async () => {
    const u = await seedUser({ email: 's3@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const tok = await userTokenWithScope(u.id)
    const r = await callStepUp(tok, { scope: SCOPES.ELEVATED_ACCOUNT })
    expect(r.status).toBe(400)
  })

  it('沒啟用 2FA → 403 STEP_UP_REQUIRES_2FA', async () => {
    const u = await seedUser({ email: 'no2fa@x' })
    const tok = await userTokenWithScope(u.id)
    const r = await callStepUp(tok, { scope: SCOPES.ELEVATED_ACCOUNT, otp_code: '123456' })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('STEP_UP_REQUIRES_2FA')
  })

  it('OTP 錯誤 → 401', async () => {
    const u = await seedUser({ email: 'badotp@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const tok = await userTokenWithScope(u.id)
    const r = await callStepUp(tok, { scope: SCOPES.ELEVATED_ACCOUNT, otp_code: '000000' })
    expect(r.status).toBe(401)
  })

  it('OTP 正確 → 200 + step_up_token（5min TTL，含 elevated scope + for_action + amr）', async () => {
    const u = await seedUser({ email: 'happy@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const tok = await userTokenWithScope(u.id)
    const r = await callStepUp(tok, {
      scope: SCOPES.ELEVATED_ACCOUNT, for_action: 'delete_account', otp_code: freshTotp(),
    })
    expect(r.status).toBe(200)
    expect(r.body.step_up_token).toBeTypeOf('string')
    expect(r.body.expires_in).toBe(300)
    expect(r.body.scope).toBe(SCOPES.ELEVATED_ACCOUNT)

    // decode 驗 claims
    const payload = JSON.parse(atob(r.body.step_up_token.split('.')[1]))
    expect(payload.scope).toBe(SCOPES.ELEVATED_ACCOUNT)
    expect(payload.for_action).toBe('delete_account')
    expect(payload.amr).toEqual(['pwd', 'totp'])
    expect(payload.acr).toBe('urn:chiyigo:loa:2')
    expect(payload.jti).toBeTypeOf('string')
    // exp - iat ≈ 300s
    expect(payload.exp - payload.iat).toBeGreaterThan(280)
    expect(payload.exp - payload.iat).toBeLessThan(310)
  })

  it('備用碼成功 → 200 + 該備用碼被核銷', async () => {
    const u = await seedUser({ email: 'bk@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const plain = await seedBackupCode(u.id)
    const tok = await userTokenWithScope(u.id)
    const r = await callStepUp(tok, { scope: SCOPES.ELEVATED_PAYMENT, backup_code: plain })
    expect(r.status).toBe(200)

    const row = await env.chiyigo_db
      .prepare(`SELECT used_at FROM backup_codes WHERE user_id = ?`).bind(u.id).first()
    expect(row.used_at).not.toBeNull()
  })

  it('Rate limit：3 次失敗後 429（Phase E3 改 3/min）', async () => {
    const u = await seedUser({ email: 'rl@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const tok = await userTokenWithScope(u.id)
    for (let i = 0; i < 3; i++) {
      const r = await callStepUp(tok, { scope: SCOPES.ELEVATED_ACCOUNT, otp_code: '000000' })
      expect(r.status).toBe(401)
    }
    const r = await callStepUp(tok, { scope: SCOPES.ELEVATED_ACCOUNT, otp_code: freshTotp() })
    expect(r.status).toBe(429)
  })
})

describe('requireStepUp helper', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  function reqWith(token) {
    return new Request('http://x/protected', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  }

  async function getStepUpToken(userId, scope, for_action = null) {
    const claims = {
      sub: String(userId), role: 'player', status: 'active', ver: 0, scope,
      amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2',
    }
    if (for_action) claims.for_action = for_action
    return signJwt(claims, '5m', env)
  }

  it('合法 step_up_token + 正確 scope → 通過', async () => {
    const { id } = await seedUser({ email: 'su1@x' })
    const tok = await getStepUpToken(id, SCOPES.ELEVATED_ACCOUNT)
    const { user, error } = await requireStepUp(reqWith(tok), env, SCOPES.ELEVATED_ACCOUNT)
    expect(error).toBeNull()
    expect(user.scope).toBe(SCOPES.ELEVATED_ACCOUNT)
  })

  it('admin role 但 scope 不含 elevated:* → 403（**不**走 role fallback）', async () => {
    const { id } = await seedUser({ email: 'admin-no-stepup@x', role: 'admin' })
    // 一般 access_token：admin role + admin:* 但無 elevated:*
    const tok = await signJwt(
      { sub: String(id), role: 'admin', status: 'active', scope: 'admin:audit admin:revoke' },
      '15m', env,
    )
    const r = await requireStepUp(reqWith(tok), env, SCOPES.ELEVATED_ACCOUNT)
    expect(r.error.status).toBe(403)
    const body = await r.error.json()
    expect(body.code).toBe('STEP_UP_REQUIRED')
  })

  it('for_action 不符 → 403 STEP_UP_ACTION_MISMATCH', async () => {
    const { id } = await seedUser({ email: 'mismatch@x' })
    const tok = await getStepUpToken(id, SCOPES.ELEVATED_ACCOUNT, 'change_password')
    const r = await requireStepUp(reqWith(tok), env, SCOPES.ELEVATED_ACCOUNT, 'delete_account')
    expect(r.error.status).toBe(403)
    const body = await r.error.json()
    expect(body.code).toBe('STEP_UP_ACTION_MISMATCH')
  })

  it('一次性消耗：第二次同 token 用 → 401（jti 進黑名單）', async () => {
    const { id } = await seedUser({ email: 'once@x' })
    const tok = await getStepUpToken(id, SCOPES.ELEVATED_PAYMENT)

    // 第一次：通過
    const r1 = await requireStepUp(reqWith(tok), env, SCOPES.ELEVATED_PAYMENT)
    expect(r1.error).toBeNull()

    // 第二次：jti 已 revoke → 401 TOKEN_REVOKED
    const r2 = await requireStepUp(reqWith(tok), env, SCOPES.ELEVATED_PAYMENT)
    expect(r2.error.status).toBe(401)
  })

  it('caller 給非 elevated:* scope → 500（程式錯誤）', async () => {
    const { id } = await seedUser({ email: 'badcaller@x' })
    const tok = await getStepUpToken(id, SCOPES.ELEVATED_ACCOUNT)
    const r = await requireStepUp(reqWith(tok), env, 'admin:audit')
    expect(r.error.status).toBe(500)
  })

  it('沒 token → 401（透傳 requireAuth）', async () => {
    const r = await requireStepUp(
      new Request('http://x/protected'), env, SCOPES.ELEVATED_ACCOUNT,
    )
    expect(r.error.status).toBe(401)
  })
})
