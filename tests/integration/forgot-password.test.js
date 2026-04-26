import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedOauthOnlyUser, callFunction, jsonPost } from './_helpers.js'

// ── Mock 寄信模組（在 forgot-password.js import 之前 hoist）─────────
const sentEmails = vi.hoisted(() => [])
const sendMock = vi.hoisted(() => vi.fn(async (apiKey, to, token) => {
  sentEmails.push({ apiKey, to, token })
}))
vi.mock('../../functions/utils/email.js', () => ({
  sendPasswordResetEmail: sendMock,
  sendVerificationEmail:  vi.fn(async () => {}),
}))

// 必須在 mock 之後 import
const { onRequestPost: forgotPost } = await import('../../functions/api/auth/local/forgot-password.js')

const URL_FORGOT = 'http://localhost/api/auth/local/forgot-password'

function jsonPostWithIp(body, ip) {
  return jsonPost(URL_FORGOT, body, { 'CF-Connecting-IP': ip })
}

beforeAll(resetDb)
beforeEach(async () => {
  await resetDb()
  sentEmails.length = 0
  sendMock.mockClear()
  sendMock.mockImplementation(async (apiKey, to, token) => {
    sentEmails.push({ apiKey, to, token })
  })
})

describe('POST /api/auth/local/forgot-password', () => {
  it('有效 email + 有密碼帳號 → 200，DB 新增 reset token、sendMock 被呼叫', async () => {
    const u = await seedUser({ email: 'a@b.com' })
    const res = await callFunction(forgotPost, jsonPostWithIp({ email: 'a@b.com' }, '1.1.1.1'))
    expect(res.status).toBe(200)

    const cnt = await env.chiyigo_db.prepare(
      "SELECT COUNT(*) AS n FROM email_verifications WHERE user_id=? AND token_type='reset_password'",
    ).bind(u.id).first()
    expect(cnt.n).toBe(1)

    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sentEmails[0].to).toBe('a@b.com')
    expect(sentEmails[0].token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('不存在 email → 200（防枚舉），DB 不變、sendMock 未被呼叫', async () => {
    const res = await callFunction(forgotPost, jsonPostWithIp({ email: 'noone@x.com' }, '1.1.1.1'))
    expect(res.status).toBe(200)

    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM email_verifications',
    ).first()
    expect(cnt.n).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('OAuth-only 帳號 → 200，仍寫 token + 寄信（reset-password 端支援首次設密碼）', async () => {
    const u = await seedOauthOnlyUser({ email: 'oauth@x.com' })
    const res = await callFunction(forgotPost, jsonPostWithIp({ email: 'oauth@x.com' }, '1.1.1.1'))
    expect(res.status).toBe(200)

    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM email_verifications WHERE user_id = ?',
    ).bind(u.id).first()
    expect(cnt.n).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('60 秒冷卻：連發兩次 → 兩次都 200，DB 只新增 1 筆', async () => {
    const u = await seedUser({ email: 'c@b.com' })
    const r1 = await callFunction(forgotPost, jsonPostWithIp({ email: 'c@b.com' }, '2.2.2.2'))
    const r2 = await callFunction(forgotPost, jsonPostWithIp({ email: 'c@b.com' }, '2.2.2.2'))
    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)

    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM email_verifications WHERE user_id = ?',
    ).bind(u.id).first()
    expect(cnt.n).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
  })

  it('IP 限流：同 IP 連發 6 次 → 第 6 次 429', async () => {
    // 每次換不同 email 才不會觸發 60s 冷卻 → 確保 5 次都實寫 token
    for (let i = 1; i <= 5; i++) {
      await seedUser({ email: `u${i}@x.com` })
    }
    const ip = '3.3.3.3'
    const statuses = []
    for (let i = 1; i <= 5; i++) {
      const r = await callFunction(forgotPost, jsonPostWithIp({ email: `u${i}@x.com` }, ip))
      statuses.push(r.status)
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200])

    await seedUser({ email: 'u6@x.com' })
    const r6 = await callFunction(forgotPost, jsonPostWithIp({ email: 'u6@x.com' }, ip))
    expect(r6.status).toBe(429)
    const body = await r6.json()
    expect(body.error).toMatch(/too many/i)
  })

  it('軟刪除帳號 → 視為不存在（200，無 token、無寄信）', async () => {
    await seedUser({ email: 'gone@x.com', deletedAt: '2020-01-01 00:00:00' })
    const res = await callFunction(forgotPost, jsonPostWithIp({ email: 'gone@x.com' }, '4.4.4.4'))
    expect(res.status).toBe(200)

    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM email_verifications',
    ).first()
    expect(cnt.n).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('Resend 失敗 → 200 但 DB 不留 token（驗證回滾）', async () => {
    sendMock.mockImplementationOnce(async () => { throw new Error('Resend down') })
    const u = await seedUser({ email: 'd@b.com' })
    const res = await callFunction(forgotPost, jsonPostWithIp({ email: 'd@b.com' }, '5.5.5.5'))
    expect(res.status).toBe(200)

    const cnt = await env.chiyigo_db.prepare(
      'SELECT COUNT(*) AS n FROM email_verifications WHERE user_id = ?',
    ).bind(u.id).first()
    expect(cnt.n).toBe(0)
  })

  it('Invalid JSON → 400', async () => {
    const res = await callFunction(forgotPost, new Request(URL_FORGOT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '6.6.6.6' },
      body: 'not-json',
    }))
    expect(res.status).toBe(400)
  })

  it('缺 email → 400', async () => {
    const res = await callFunction(forgotPost, jsonPostWithIp({}, '7.7.7.7'))
    expect(res.status).toBe(400)
  })
})
