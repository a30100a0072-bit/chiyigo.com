/**
 * Phase D 後續：/api/auth/2fa/verify 的 isWebClient channel matrix（規格 B）
 *
 * 重點：device_uuid 不參與 cookie/body 通道判斷，Origin 為 source of truth。
 * 每個 case fresh seed user + fresh TOTP secret + fresh OTP 避免 used_totp replay 防護互打。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { TOTP, Secret } from 'otpauth'
import {
  resetDb, seedUser, enableTotp, ensureJwtKeys, callFunction,
} from './_helpers'
import { onRequestPost as twofaVerify } from '../../functions/api/auth/2fa/verify'
import { signJwt } from '../../functions/utils/jwt'

const TEST_SECRET = 'JBSWY3DPEHPK3PXP'

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})
beforeEach(resetDb)

async function preAuthToken(userId) {
  return signJwt(
    { sub: String(userId), scope: 'pre_auth', role: 'player', status: 'active', ver: 0 },
    '5m', env,
  )
}

function verifyReq(token, body, headers = {}) {
  return new Request('http://x/api/auth/2fa/verify', {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'Authorization':    `Bearer ${token}`,
      'CF-Connecting-IP': '3.3.3.3',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function freshOtp() {
  const totp = new TOTP({
    algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(TEST_SECRET),
  })
  return totp.generate()
}

describe('POST /api/auth/2fa/verify — isWebClient channel matrix (規格 B)', () => {
  const matrix = [
    {
      name: 'web Origin → cookie',
      headers: { Origin: 'https://chiyigo.com' },
      body:    {},
      expect:  'cookie',
    },
    {
      name: 'web Origin + 誤帶 device_uuid → 仍 cookie（regression）',
      headers: { Origin: 'https://chiyigo.com' },
      body:    { device_uuid: 'web-00000000-0000-0000-0000-000000000004' },
      expect:  'cookie',
    },
    {
      name: '無 Origin + platform=ios + device_uuid → body',
      headers: {},
      body:    { platform: 'ios', device_uuid: 'ios-2fa-1' },
      expect:  'body',
    },
    {
      name: 'evil.com Origin + platform=web → body',
      headers: { Origin: 'https://evil.com' },
      body:    { platform: 'web' },
      expect:  'body',
    },
  ]

  matrix.forEach((c, i) => {
    it(c.name, async () => {
      // Fresh setup per case：新 user + 新啟用 TOTP + 新 pre_auth_token + 新 OTP
      // 避免 used_totp replay 防護把同個 OTP 標記成已用後影響下一 case。
      const u = await seedUser({ email: `tfa-mx-${i}@x.com`, password: 'GoodPass#1234' })
      await enableTotp(u.id, TEST_SECRET)
      const token = await preAuthToken(u.id)
      const otp_code = freshOtp()

      const res = await callFunction(twofaVerify, verifyReq(token, {
        otp_code, ...c.body,
      }, c.headers))

      expect(res.status).toBe(200)
      const body = await res.json()
      const cookie = res.headers.get('Set-Cookie')
      if (c.expect === 'cookie') {
        expect(cookie).toMatch(/^chiyigo_refresh=/)
        expect(body.refresh_token).toBeUndefined()
      } else {
        expect(cookie).toBeNull()
        expect(body.refresh_token).toMatch(/^[0-9a-f]{64}$/)
      }
    })
  })
})
