import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { jwtVerify, importJWK } from 'jose'
import {
  resetDb, seedUser, callFunction, jsonPost, ensureJwtKeys,
} from './_helpers'

// Mock 寄信模組（hoist 以早於 register.js import）
const sentEmails = vi.hoisted(() => [])
const sendVerifyMock = vi.hoisted(() => vi.fn(async (apiKey, to, token) => {
  sentEmails.push({ apiKey, to, token })
}))
vi.mock('../../functions/utils/email', () => ({
  sendVerificationEmail:  sendVerifyMock,
  sendPasswordResetEmail: vi.fn(async () => {}),
}))

const { onRequestPost: registerPost } = await import(
  '../../functions/api/auth/local/register'
)

const URL_REG = 'http://localhost/api/auth/local/register'
function regReq(body, extraHeaders = {}) {
  return jsonPost(URL_REG, body, { 'CF-Connecting-IP': '1.2.3.4', ...extraHeaders })
}
function webRegReq(body) {
  return regReq(body, { Origin: 'https://chiyigo.com' })
}

beforeAll(async () => {
  await ensureJwtKeys()
  await resetDb()
})
beforeEach(async () => {
  await resetDb()
  sentEmails.length = 0
  sendVerifyMock.mockClear()
  sendVerifyMock.mockImplementation(async (apiKey, to, token) => {
    sentEmails.push({ apiKey, to, token })
  })
  // 預設關閉寄信（個別 test 需要時自行覆蓋）
  delete env.RESEND_API_KEY
})

describe('POST /api/auth/local/register', () => {
  it('happy path → 201 + access_token + refresh cookie + DB rows（web 預設走 cookie）', async () => {
    env.RESEND_API_KEY = 'test-key'
    const res = await callFunction(registerPost, webRegReq({
      email: 'new@example.com',
      password: 'GoodPass#1234',
    }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.access_token).toBeTruthy()
    // 對齊 login.js：web（chiyigo Origin）走 HttpOnly cookie，body 不應暴露 refresh_token
    expect(body.refresh_token).toBeUndefined()
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie).toMatch(/^chiyigo_refresh=[0-9a-f]{64};/)
    expect(body.email).toBe('new@example.com')
    expect(body.email_verified).toBe(false)

    // access_token 簽章
    const pub = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY), 'ES256')
    const { payload } = await jwtVerify(body.access_token, pub, { algorithms: ['ES256'] })
    expect(payload.email).toBe('new@example.com')
    expect(payload.email_verified).toBe(false)

    // DB rows
    const u = await env.chiyigo_db.prepare(
      'SELECT id FROM users WHERE email = ?',
    ).bind('new@example.com').first()
    expect(u.id).toBe(body.user_id)
    const la = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM local_accounts WHERE user_id = ?',
    ).bind(u.id).first()
    expect(la.n).toBe(1)
    const ev = await env.chiyigo_db.prepare(
      "SELECT COUNT(*) AS n FROM email_verifications WHERE user_id = ? AND token_type = 'verify_email'",
    ).bind(u.id).first()
    expect(ev.n).toBe(1)
    const rt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?',
    ).bind(u.id).first()
    expect(rt.n).toBe(1)
  })

  it('弱密碼 → 400（validatePassword 守門）', async () => {
    const res = await callFunction(registerPost, regReq({
      email: 'weak@example.com',
      password: 'short',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
    // 不應建立任何資料
    const u = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM users WHERE email = ?',
    ).bind('weak@example.com').first()
    expect(u.n).toBe(0)
  })

  it('重複 email → 409', async () => {
    await seedUser({ email: 'dup@example.com', password: 'OldPass#1234' })
    const res = await callFunction(registerPost, regReq({
      email: 'dup@example.com',
      password: 'GoodPass#1234',
    }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already/i)
  })

  it('Invalid email format → 400', async () => {
    const res = await callFunction(registerPost, regReq({
      email: 'not-an-email',
      password: 'GoodPass#1234',
    }))
    expect(res.status).toBe(400)
  })

  it('訪客轉正：guest_id 已存在 + owner_user_id IS NULL → 該 requisition 被綁到新 user', async () => {
    // Codex r4-bonus：register 端驗 guest_id 為 web-<uuid> 格式（防禦深度），測試對齊
    const guestAbc = 'web-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    await env.chiyigo_db.prepare(
      'INSERT INTO requisition (owner_guest_id, owner_user_id) VALUES (?, NULL)',
    ).bind(guestAbc).run()

    const res = await callFunction(registerPost, regReq({
      email: 'guest@example.com',
      password: 'GoodPass#1234',
      guest_id: guestAbc,
    }))
    expect(res.status).toBe(201)
    const body = await res.json()

    const row = await env.chiyigo_db.prepare(
      'SELECT owner_user_id, owner_guest_id FROM requisition WHERE owner_user_id = ?',
    ).bind(body.user_id).first()
    expect(row).toBeTruthy()
    expect(row.owner_user_id).toBe(body.user_id)
    expect(row.owner_guest_id).toBeNull()
  })

  it('訪客轉正：guest_id 已被別的 user 綁定 → 不覆蓋（M6 守門）', async () => {
    // 既存使用者已綁定 guest-xyz
    const guestXyz = 'web-11111111-2222-3333-4444-555555555555'
    const existing = await seedUser({ email: 'old@example.com', password: 'OldPass#1234' })
    await env.chiyigo_db.prepare(
      'INSERT INTO requisition (owner_guest_id, owner_user_id) VALUES (?, ?)',
    ).bind(guestXyz, existing.id).run()

    const res = await callFunction(registerPost, regReq({
      email: 'newcomer@example.com',
      password: 'GoodPass#1234',
      guest_id: guestXyz,
    }))
    expect(res.status).toBe(201)

    // 該 requisition 仍屬於 existing.id
    const row = await env.chiyigo_db.prepare(
      'SELECT owner_user_id FROM requisition WHERE owner_guest_id = ? OR owner_user_id IN (?, ?)',
    ).bind(guestXyz, existing.id, 0).first()
    // 注意：UPDATE 不應發生 → owner_user_id 仍是 existing.id, owner_guest_id 仍是 guestXyz
    const stillBound = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM requisition WHERE owner_user_id = ? AND owner_guest_id = ?',
    ).bind(existing.id, guestXyz).first()
    expect(stillBound.n).toBe(1)
    expect(row.owner_user_id).toBe(existing.id)
  })

  it('無 RESEND_API_KEY → 201 但跳過寄信（H5 守門）', async () => {
    // beforeEach 已 delete env.RESEND_API_KEY
    const res = await callFunction(registerPost, regReq({
      email: 'noemail@example.com',
      password: 'GoodPass#1234',
    }))
    expect(res.status).toBe(201)
    expect(sendVerifyMock).not.toHaveBeenCalled()
  })

  it('有 RESEND_API_KEY → sendVerificationEmail 被呼叫（fire-and-forget）', async () => {
    env.RESEND_API_KEY = 'test-key'
    const res = await callFunction(registerPost, regReq({
      email: 'sendme@example.com',
      password: 'GoodPass#1234',
    }))
    expect(res.status).toBe(201)
    expect(sendVerifyMock).toHaveBeenCalledTimes(1)
    expect(sentEmails[0].apiKey).toBe('test-key')
    expect(sentEmails[0].to).toBe('sendme@example.com')
    expect(sentEmails[0].token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('Invalid JSON → 400', async () => {
    const res = await callFunction(registerPost, new Request(URL_REG, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
      body: 'not-json',
    }))
    expect(res.status).toBe(400)
  })

  it('缺欄位 → 400', async () => {
    const r1 = await callFunction(registerPost, regReq({ email: 'a@b.com' }))
    expect(r1.status).toBe(400)
    const r2 = await callFunction(registerPost, regReq({ password: 'GoodPass#1234' }))
    expect(r2.status).toBe(400)
  })
})

describe('POST /api/auth/local/register — isWebClient channel matrix (規格 B)', () => {
  const matrix = [
    {
      name: 'web Origin → Set-Cookie，body 無 refresh_token',
      headers: { Origin: 'https://chiyigo.com' },
      body: {},
      expect: 'cookie',
    },
    {
      name: 'web Origin + 誤帶 device_uuid → 仍 Set-Cookie',
      headers: { Origin: 'https://chiyigo.com' },
      body: { device_uuid: 'web-00000000-0000-0000-0000-000000000002' },
      expect: 'cookie',
    },
    {
      name: '無 Origin + platform=ios → body',
      headers: {},
      body: { platform: 'ios', device_uuid: 'ios-r1' },
      expect: 'body',
    },
    {
      name: 'evil.com Origin + platform=web → body',
      headers: { Origin: 'https://evil.com' },
      body: { platform: 'web' },
      expect: 'body',
    },
  ]
  for (const c of matrix) {
    it(c.name, async () => {
      const email = `reg-${Math.random().toString(36).slice(2, 10)}@example.com`
      const res = await callFunction(registerPost, regReq(
        { email, password: 'GoodPass#1234', ...c.body },
        c.headers,
      ))
      expect(res.status).toBe(201)
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
  }
})
