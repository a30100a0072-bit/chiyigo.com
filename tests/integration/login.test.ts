import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { jwtVerify, importJWK } from 'jose'
import { onRequestPost as loginPost } from '../../functions/api/auth/local/login'
import {
  resetDb, seedUser, seedOauthOnlyUser, enableTotp,
  callFunction, jsonPost, ensureJwtKeys,
} from './_helpers'

const URL_LOGIN = 'http://localhost/api/auth/local/login'
const TEST_SECRET = 'JBSWY3DPEHPK3PXP'

function loginReq(body, ip = '1.2.3.4', extraHeaders = {}) {
  return jsonPost(URL_LOGIN, body, { 'CF-Connecting-IP': ip, ...extraHeaders })
}

// 預設 web client：帶 chiyigo Origin，期待 Set-Cookie / 無 body refresh_token
function webLoginReq(body, ip = '1.2.3.4') {
  return loginReq(body, ip, { Origin: 'https://chiyigo.com' })
}

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})
beforeEach(resetDb)

describe('POST /api/auth/local/login — happy path & failures', () => {
  it('密碼正確 + 無 2FA → 200 + access_token + refresh cookie + refresh_tokens DB row', async () => {
    const u = await seedUser({ email: 'a@b.com', password: 'GoodPass#1234' })
    const res = await callFunction(loginPost, webLoginReq({ email: 'a@b.com', password: 'GoodPass#1234' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBeTruthy()
    expect(body.user_id).toBe(u.id)
    expect(body.email).toBe('a@b.com')
    expect(body.refresh_token).toBeUndefined()  // web 走 cookie
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toMatch(/^chiyigo_refresh=[0-9a-f]{64};/)
    expect(cookie).toMatch(/HttpOnly/)
    // commit efac703：跨站 iframe silent SSO 改 SameSite=None
    expect(cookie).toMatch(/SameSite=None/)

    // access_token 簽章驗證 + payload 結構
    const pub = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY), 'ES256')
    const { payload } = await jwtVerify(body.access_token, pub, { algorithms: ['ES256'] })
    expect(payload.sub).toBe(String(u.id))
    expect(payload.email).toBe('a@b.com')
    // Phase C-2 regression：access_token 必有 scope claim（role 推導出來）
    expect(payload.scope).toBeTypeOf('string')
    expect((payload.scope as string).split(' ')).toContain('read:profile')
    // PR1 tenant claim wiring：login 簽出的 token 帶 active personal tenant
    expect(typeof payload.tenant_id).toBe('number')
    expect(payload.platform_role).toBe('tenant_owner')

    // refresh_tokens DB row 存在
    const rt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?',
    ).bind(u.id).first()
    expect(rt.n).toBe(1)
  })

  it('App 平台（platform=app + device_uuid）→ 200 + refresh_token 在 body、無 cookie', async () => {
    const u = await seedUser({ email: 'app@b.com', password: 'GoodPass#1234' })
    const res = await callFunction(loginPost, loginReq({
      email: 'app@b.com', password: 'GoodPass#1234',
      platform: 'app', device_uuid: 'dev-1',
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refresh_token).toMatch(/^[0-9a-f]{64}$/)
    expect(res.headers.get('Set-Cookie')).toBeNull()

    const rt = await env.chiyigo_db.prepare(
      'SELECT device_uuid FROM refresh_tokens WHERE user_id = ?',
    ).bind(u.id).first()
    expect(rt.device_uuid).toBe('dev-1')
  })

  it('密碼正確 + 啟用 2FA → 403 { code:TOTP_REQUIRED, pre_auth_token }', async () => {
    const u = await seedUser({ email: 'tfa@b.com', password: 'GoodPass#1234' })
    await enableTotp(u.id, TEST_SECRET)
    const res = await callFunction(loginPost, loginReq({ email: 'tfa@b.com', password: 'GoodPass#1234' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('TOTP_REQUIRED')
    expect(body.pre_auth_token).toBeTruthy()
    expect(body.access_token).toBeUndefined()

    // pre_auth_token 結構
    const pub = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY), 'ES256')
    const { payload } = await jwtVerify(body.pre_auth_token, pub, { algorithms: ['ES256'] })
    expect(payload.sub).toBe(String(u.id))
    expect(payload.scope).toBe('pre_auth')
    // Phase E-2 forward: risk fields propagated to pre_auth so 2fa/verify
    // can write them into auth.login.success audit
    expect(typeof payload.risk_score).toBe('number')
    expect(Array.isArray(payload.risk_factors)).toBe(true)
    expect(payload).toHaveProperty('risk_country')
  })

  it('密碼錯 → 401 + login_attempts 寫入 1 筆', async () => {
    await seedUser({ email: 'wrong@b.com', password: 'CorrectPass#1234' })
    const res = await callFunction(loginPost, loginReq({ email: 'wrong@b.com', password: 'WrongPass#9999' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/invalid credentials/i)

    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?',
    ).bind('wrong@b.com').first()
    expect(cnt.n).toBe(1)
  })

  it('成功登入會清除該 email 之前的 login_attempts 失敗記錄', async () => {
    await seedUser({ email: 'recover@b.com', password: 'GoodPass#1234' })
    // 先打錯一次
    await callFunction(loginPost, loginReq({ email: 'recover@b.com', password: 'wrong' }))
    let cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?',
    ).bind('recover@b.com').first()
    expect(cnt.n).toBe(1)
    // 再正確登入
    const res = await callFunction(loginPost, loginReq({ email: 'recover@b.com', password: 'GoodPass#1234' }))
    expect(res.status).toBe(200)
    cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?',
    ).bind('recover@b.com').first()
    expect(cnt.n).toBe(0)
  })

  it('不存在 email → 401（fakeHashDelay 對齊）+ login_attempts 寫入', async () => {
    const res = await callFunction(loginPost, loginReq({ email: 'noone@x.com', password: 'whatever#1234' }))
    expect(res.status).toBe(401)
    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM login_attempts WHERE email = ?',
    ).bind('noone@x.com').first()
    expect(cnt.n).toBe(1)
  })

  it('OAuth-only 帳號（無 local_accounts）+ 提供密碼 → 401', async () => {
    await seedOauthOnlyUser({ email: 'oauth@x.com' })
    const res = await callFunction(loginPost, loginReq({ email: 'oauth@x.com', password: 'AnyPass#1234' }))
    expect(res.status).toBe(401)
  })

  it('軟刪除帳號 → 401', async () => {
    await seedUser({ email: 'gone@x.com', password: 'GoodPass#1234', deletedAt: '2020-01-01 00:00:00' })
    const res = await callFunction(loginPost, loginReq({ email: 'gone@x.com', password: 'GoodPass#1234' }))
    expect(res.status).toBe(401)
  })

  it('ban 帳號 + 密碼正確 → 403 { code:ACCOUNT_BANNED }', async () => {
    const u = await seedUser({ email: 'ban@x.com', password: 'GoodPass#1234' })
    await env.chiyigo_db.prepare("UPDATE users SET status='banned' WHERE id=?").bind(u.id).run()
    const res = await callFunction(loginPost, loginReq({ email: 'ban@x.com', password: 'GoodPass#1234' }))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('ACCOUNT_BANNED')
  })

  it('Invalid JSON → 400', async () => {
    const res = await callFunction(loginPost, new Request(URL_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
      body: 'not-json',
    }))
    expect(res.status).toBe(400)
  })

  it('缺欄位 → 400', async () => {
    const r1 = await callFunction(loginPost, loginReq({ email: 'a@b.com' }))
    expect(r1.status).toBe(400)
    const r2 = await callFunction(loginPost, loginReq({ password: 'x' }))
    expect(r2.status).toBe(400)
  })
})

describe('POST /api/auth/local/login — isWebClient channel matrix (規格 B)', () => {
  // 鎖 P2 bug：device_uuid 不參與 cookie/body 通道判斷
  const matrix = [
    {
      name: 'web Origin + 無 platform + 無 device_uuid → Set-Cookie，body 無 refresh_token',
      headers: { Origin: 'https://chiyigo.com' },
      body: {},
      expect: 'cookie',
    },
    {
      name: 'web Origin + 誤帶 device_uuid → 仍 Set-Cookie（regression：device_uuid 不影響）',
      headers: { Origin: 'https://chiyigo.com' },
      body: { device_uuid: 'web-00000000-0000-0000-0000-000000000001' },
      expect: 'cookie',
    },
    {
      name: '無 Origin + platform=ios + device_uuid → body 含 refresh_token，無 cookie',
      headers: {},
      body: { platform: 'ios', device_uuid: 'ios-dev-1' },
      expect: 'body',
    },
    {
      name: '無 Origin + 無 platform + 無 device_uuid → body（舊 App / programmatic regression）',
      headers: {},
      body: {},
      expect: 'body',
    },
    {
      name: 'evil.com Origin + platform=web → body（跨站偽造 platform 不該升級為 web）',
      headers: { Origin: 'https://evil.com' },
      body: { platform: 'web' },
      expect: 'body',
    },
    {
      name: 'chiyigo Origin + platform=ios（hybrid webview）→ body，無 cookie',
      headers: { Origin: 'https://chiyigo.com' },
      body: { platform: 'ios', device_uuid: 'ios-hybrid-1' },
      expect: 'body',
    },
  ]
  matrix.forEach((c, i) => {
    it(c.name, async () => {
      // beforeEach 已 resetDb → fresh DB；IP 也每 case 不同避開 cross-user IP scan 防護
      const email = `mx${i}@b.com`
      await seedUser({ email, password: 'GoodPass#1234' })
      const res = await callFunction(loginPost, loginReq(
        { email, password: 'GoodPass#1234', ...c.body },
        `5.5.5.${10 + i}`,
        c.headers,
      ))
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

describe('POST /api/auth/local/login — rate limiting', () => {
  it('同 email 在 15 分鐘內 ≥ 10 次失敗 → 429 RATE_LIMITED', async () => {
    await seedUser({ email: 'rl@b.com', password: 'GoodPass#1234' })
    // 預先塞 10 筆失敗記錄（不同 IP 避開 IP 限制）
    for (let i = 0; i < 10; i++) {
      await env.chiyigo_db.prepare(
        'INSERT INTO login_attempts (ip, email) VALUES (?, ?)',
      ).bind(`10.0.0.${i}`, 'rl@b.com').run()
    }
    const res = await callFunction(loginPost, loginReq({ email: 'rl@b.com', password: 'GoodPass#1234' }, '11.11.11.11'))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('RATE_LIMITED')
  })

  it('[J-1] 同 IP 在 1 分鐘內 ≥ 5 次失敗 → 429 RATE_LIMITED（Phase E3）', async () => {
    await seedUser({ email: 'ip@b.com', password: 'GoodPass#1234' })
    for (let i = 0; i < 5; i++) {
      await env.chiyigo_db.prepare(
        'INSERT INTO login_attempts (ip, email) VALUES (?, ?)',
      ).bind('20.20.20.20', `dummy${i}@x.com`).run()
    }
    const res = await callFunction(loginPost, loginReq({ email: 'ip@b.com', password: 'GoodPass#1234' }, '20.20.20.20'))
    expect(res.status).toBe(429)
  })
})
