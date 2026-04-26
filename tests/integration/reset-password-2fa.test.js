import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { TOTP, Secret } from 'otpauth'
import { onRequestPost as resetPost } from '../../functions/api/auth/local/reset-password.js'
import { hashPassword } from '../../functions/utils/crypto.js'
import { env } from 'cloudflare:test'
import {
  resetDb, seedUser, seedResetToken, seedOauthOnlyUser, enableTotp, seedBackupCode,
  callFunction, jsonPost,
} from './_helpers.js'

const URL_RESET = 'http://localhost/api/auth/local/reset-password'
// 固定 base32 secret，方便用 otpauth 即時產生有效碼
const TEST_SECRET = 'JBSWY3DPEHPK3PXP'

function liveOtp(base32) {
  return new TOTP({
    algorithm: 'SHA1', digits: 6, period: 30,
    secret: Secret.fromBase32(base32),
  }).generate()
}

beforeAll(resetDb)
beforeEach(resetDb)

describe('reset-password — 2FA branches', () => {
  it('啟用 2FA + 未帶 totp_code → 403 { requires_2fa: true }', async () => {
    const u = await seedUser()
    await enableTotp(u.id, TEST_SECRET)
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876',
    }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.requires_2fa).toBe(true)
  })

  it('啟用 2FA + 錯誤 TOTP → 401', async () => {
    const u = await seedUser()
    await enableTotp(u.id, TEST_SECRET)
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876', totp_code: '000000',
    }))
    expect(res.status).toBe(401)
  })

  it('啟用 2FA + 正確 TOTP → 200，密碼換新', async () => {
    const u = await seedUser()
    await enableTotp(u.id, TEST_SECRET)
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876', totp_code: liveOtp(TEST_SECRET),
    }))
    expect(res.status).toBe(200)
    const acc = await env.chiyigo_db
      .prepare('SELECT password_salt, password_hash FROM local_accounts WHERE user_id = ?')
      .bind(u.id).first()
    expect(acc.password_hash).toBe(await hashPassword('BrandNew#9876', acc.password_salt))
  })

  it('啟用 2FA + 正確 backup code → 200，該 backup code 標 used', async () => {
    const u = await seedUser()
    await enableTotp(u.id, TEST_SECRET)
    const code = await seedBackupCode(u.id)
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876', totp_code: code,
    }))
    expect(res.status).toBe(200)
    const row = await env.chiyigo_db
      .prepare('SELECT used_at FROM backup_codes WHERE user_id = ?')
      .bind(u.id).first()
    expect(row.used_at).not.toBeNull()
  })

  it('啟用 2FA + 已用過的 backup code → 401', async () => {
    const u = await seedUser()
    await enableTotp(u.id, TEST_SECRET)
    const code = await seedBackupCode(u.id, { used: true })
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876', totp_code: code,
    }))
    expect(res.status).toBe(401)
  })
})

describe('reset-password — OAuth-only first-time password set', () => {
  it('OAuth-only（無 local_accounts row）+ 合法 token → 200，新建 local_accounts', async () => {
    const u = await seedOauthOnlyUser()
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876',
    }))
    expect(res.status).toBe(200)
    const acc = await env.chiyigo_db
      .prepare('SELECT password_hash, password_salt, totp_enabled FROM local_accounts WHERE user_id = ?')
      .bind(u.id).first()
    expect(acc).not.toBeNull()
    expect(acc.totp_enabled).toBe(0)
    expect(acc.password_hash).toBe(await hashPassword('BrandNew#9876', acc.password_salt))
  })
})

describe('reset-password — concurrent replay', () => {
  it('同一 token 並發兩次：剛好一次 200、一次 400（atomic UPDATE...RETURNING）', async () => {
    const u = await seedUser()
    const token = await seedResetToken(u.id)
    const req = () => callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876',
    }))
    const [a, b] = await Promise.all([req(), req()])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual([200, 400])
  })
})
