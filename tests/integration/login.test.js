import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { jwtVerify, importJWK } from 'jose'
import { onRequestPost as loginPost } from '../../functions/api/auth/local/login.js'
import {
  resetDb, seedUser, seedOauthOnlyUser, enableTotp,
  callFunction, jsonPost, ensureJwtKeys,
} from './_helpers.js'

const URL_LOGIN = 'http://localhost/api/auth/local/login'
const TEST_SECRET = 'JBSWY3DPEHPK3PXP'

function loginReq(body, ip = '1.2.3.4') {
  return jsonPost(URL_LOGIN, body, { 'CF-Connecting-IP': ip })
}

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})
beforeEach(resetDb)

describe('POST /api/auth/local/login — happy path & failures', () => {
  it('密碼正確 + 無 2FA → 200 + access_token + refresh cookie + refresh_tokens DB row', async () => {
    const u = await seedUser({ email: 'a@b.com', password: 'GoodPass#1234' })
    const res = await callFunction(loginPost, loginReq({ email: 'a@b.com', password: 'GoodPass#1234' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.access_token).toBeTruthy()
    expect(body.user_id).toBe(u.id)
    expect(body.email).toBe('a@b.com')
    expect(body.refresh_token).toBeUndefined()  // web 走 cookie
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toMatch(/^chiyigo_refresh=[0-9a-f]{64};/)
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)

    // access_token 簽章驗證 + payload 結構
    const pub = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY), 'ES256')
    const { payload } = await jwtVerify(body.access_token, pub, { algorithms: ['ES256'] })
    expect(payload.sub).toBe(String(u.id))
    expect(payload.email).toBe('a@b.com')

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

  it('同 IP 在 15 分鐘內 ≥ 20 次失敗 → 429 RATE_LIMITED', async () => {
    await seedUser({ email: 'ip@b.com', password: 'GoodPass#1234' })
    for (let i = 0; i < 20; i++) {
      await env.chiyigo_db.prepare(
        'INSERT INTO login_attempts (ip, email) VALUES (?, ?)',
      ).bind('20.20.20.20', `dummy${i}@x.com`).run()
    }
    const res = await callFunction(loginPost, loginReq({ email: 'ip@b.com', password: 'GoodPass#1234' }, '20.20.20.20'))
    expect(res.status).toBe(429)
  })
})
