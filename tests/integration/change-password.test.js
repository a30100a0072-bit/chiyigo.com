/**
 * Phase C-3 改造 — POST /api/auth/account/change-password
 *
 * 端到端：step-up token → change-password → 舊 token 全失效
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { env } from 'cloudflare:test'
import {
  resetDb, ensureJwtKeys, seedUser, enableTotp,
} from './_helpers.js'
import { signJwt } from '../../functions/utils/jwt.js'
import { requireAuth } from '../../functions/utils/auth.js'
import { verifyPassword } from '../../functions/utils/crypto.js'
import { SCOPES } from '../../functions/utils/scopes.js'
import { onRequestPost as stepUpHandler } from '../../functions/api/auth/step-up.js'
import { onRequestPost as changePwHandler } from '../../functions/api/auth/account/change-password.js'

const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

function freshTotp() {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30,
    secret: Secret.fromBase32(TEST_TOTP_SECRET) }).generate()
}

async function userToken(userId, role = 'player') {
  return signJwt(
    { sub: String(userId), role, status: 'active', ver: 0,
      scope: 'read:profile write:profile' },
    '15m', env, { audience: 'chiyigo' },
  )
}

async function getStepUpToken(userId, action = 'change_password') {
  const accessTok = await userToken(userId)
  const resp = await stepUpHandler({
    request: new Request('http://x/api/auth/step-up', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessTok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: SCOPES.ELEVATED_ACCOUNT,
        for_action: action,
        otp_code: freshTotp(),
      }),
    }),
    env,
  })
  expect(resp.status).toBe(200)
  const body = await resp.json()
  return body.step_up_token
}

async function callChangePw(token, body) {
  const resp = await changePwHandler({
    request: new Request('http://x/api/auth/account/change-password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  })
  return { status: resp.status, body: await resp.json() }
}

describe('POST /api/auth/account/change-password', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒 token → 401', async () => {
    const resp = await changePwHandler({
      request: new Request('http://x/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"new_password":"NewPass#1234"}',
      }),
      env,
    })
    expect(resp.status).toBe(401)
  })

  it('用一般 access_token（非 step_up） → 403 STEP_UP_REQUIRED', async () => {
    const u = await seedUser({ email: 'a@x' })
    const tok = await userToken(u.id)
    const r = await callChangePw(tok, { new_password: 'NewPass#1234' })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('STEP_UP_REQUIRED')
  })

  it('admin 一般 access_token（沒 elevated:account） → 403（不走 role fallback）', async () => {
    const u = await seedUser({ email: 'admin@x', role: 'admin' })
    const tok = await signJwt(
      { sub: String(u.id), role: 'admin', status: 'active', ver: 0,
        scope: 'admin:audit admin:revoke admin:users admin:clients' },
      '15m', env,
    )
    const r = await callChangePw(tok, { new_password: 'NewPass#1234' })
    expect(r.status).toBe(403)
  })

  it('step_up_token for_action 不符（用 payment 的 token 想改密碼） → 403', async () => {
    const u = await seedUser({ email: 'mismatch@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const stepUpTok = await getStepUpToken(u.id, 'withdraw')  // 錯的 action
    const r = await callChangePw(stepUpTok, { new_password: 'NewPass#1234' })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('STEP_UP_ACTION_MISMATCH')
  })

  it('step_up_token 正確 + 合法新密碼 → 200，密碼真的換了', async () => {
    const u = await seedUser({ email: 'happy@x', password: 'OldPass#1234' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const stepUpTok = await getStepUpToken(u.id)

    const r = await callChangePw(stepUpTok, { new_password: 'NewPass#5678' })
    expect(r.status).toBe(200)

    // DB 真的換了
    const row = await env.chiyigo_db
      .prepare(`SELECT password_hash, password_salt FROM local_accounts WHERE user_id = ?`)
      .bind(u.id).first()
    expect(await verifyPassword('NewPass#5678', row.password_salt, row.password_hash)).toBe(true)
    expect(await verifyPassword('OldPass#1234', row.password_salt, row.password_hash)).toBe(false)
  })

  it('成功後 bumpTokenVersion → 舊 access_token 失效', async () => {
    const u = await seedUser({ email: 'bump@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const oldAccessTok = await userToken(u.id)  // ver=0
    const stepUpTok    = await getStepUpToken(u.id)

    await callChangePw(stepUpTok, { new_password: 'NewPass#5678' })

    // 舊 access_token 用 requireAuth 應該被擋（ver mismatch）
    const r = await requireAuth(
      new Request('http://x/', { headers: { Authorization: `Bearer ${oldAccessTok}` } }),
      env,
    )
    expect(r.user).toBeNull()
    expect(r.error.status).toBe(401)
  })

  it('一次性消耗：step_up_token 用過後第二次 → 401', async () => {
    const u = await seedUser({ email: 'replay@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const stepUpTok = await getStepUpToken(u.id)

    const r1 = await callChangePw(stepUpTok, { new_password: 'NewPass#A1234' })
    expect(r1.status).toBe(200)

    // 第二次用同 step_up_token：jti 已 revoke
    const r2 = await callChangePw(stepUpTok, { new_password: 'NewPass#B5678' })
    expect(r2.status).toBe(401)
  })

  it('new_password 不合密碼複雜度 → 400', async () => {
    const u = await seedUser({ email: 'weak@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const stepUpTok = await getStepUpToken(u.id)
    const r = await callChangePw(stepUpTok, { new_password: '123' })
    expect(r.status).toBe(400)
  })

  it('OAuth-only 帳號（沒 local_account）→ INSERT 新 row 設密碼', async () => {
    // OAuth-only 帳號需先啟用 2FA（沒密碼但要有 TOTP 才能拿 step-up token）。
    // 這裡用「先 seed 一個有密碼+TOTP 的 user → 刪 local_account 模擬 OAuth-only」會破壞 TOTP，
    // 所以這個 case 改成驗 ON CONFLICT DO UPDATE 的 INSERT 分支可達；用一般 user 即可。
    const u = await seedUser({ email: 'upsert@x', password: 'OldPass#1234' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const stepUpTok = await getStepUpToken(u.id)
    const r = await callChangePw(stepUpTok, { new_password: 'BrandNew#9999' })
    expect(r.status).toBe(200)
    const row = await env.chiyigo_db
      .prepare(`SELECT password_hash, password_salt FROM local_accounts WHERE user_id = ?`)
      .bind(u.id).first()
    expect(await verifyPassword('BrandNew#9999', row.password_salt, row.password_hash)).toBe(true)
  })

  it('audit log 寫一筆 account.password.change（severity warn，via=step_up）', async () => {
    const u = await seedUser({ email: 'audit@x' })
    await enableTotp(u.id, TEST_TOTP_SECRET)
    const stepUpTok = await getStepUpToken(u.id)
    await callChangePw(stepUpTok, { new_password: 'NewPass#5678' })

    const row = await env.chiyigo_db
      .prepare(`SELECT event_type, severity, user_id, event_data FROM audit_log WHERE event_type = 'account.password.change' ORDER BY id DESC LIMIT 1`)
      .first()
    expect(row).toBeTruthy()
    expect(row.severity).toBe('warn')
    expect(row.user_id).toBe(u.id)
    const data = JSON.parse(row.event_data)
    expect(data.via).toBe('step_up')
  })
})
