import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { onRequestPost as resetPost } from '../../functions/api/auth/local/reset-password.js'
import { hashPassword } from '../../functions/utils/crypto.js'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedResetToken, callFunction, jsonPost } from './_helpers.js'

const URL_RESET = 'http://localhost/api/auth/local/reset-password'

beforeAll(resetDb)
beforeEach(resetDb)

describe('POST /api/auth/local/reset-password — non-2FA flows', () => {
  it('happy path: 合法 token + 強密碼 → 200，密碼換新、token used、refresh_tokens 清空', async () => {
    const u = await seedUser({ password: 'OldPass#1234' })
    const token = await seedResetToken(u.id)
    // 種一筆 refresh_token，驗證會被刪除
    await env.chiyigo_db.prepare(
      'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    ).bind(u.id, 'fake-rt-hash', '2099-01-01 00:00:00').run()

    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876',
    }))
    expect(res.status).toBe(200)

    const acc = await env.chiyigo_db
      .prepare('SELECT password_salt, password_hash FROM local_accounts WHERE user_id = ?')
      .bind(u.id).first()
    expect(acc.password_salt).not.toBe(u.salt)
    expect(acc.password_hash).toBe(await hashPassword('BrandNew#9876', acc.password_salt))

    const ev = await env.chiyigo_db
      .prepare('SELECT used_at FROM email_verifications WHERE user_id = ?')
      .bind(u.id).first()
    expect(ev.used_at).not.toBeNull()

    const rtCount = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ?')
      .bind(u.id).first()
    expect(rtCount.n).toBe(0)
  })

  it('過期 token → 400', async () => {
    const u = await seedUser()
    const token = await seedResetToken(u.id, { ttlMinutes: -10 })
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid|expired/i)
  })

  it('已用過 token → 400（防重放）', async () => {
    const u = await seedUser()
    const token = await seedResetToken(u.id, { used: true })
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876',
    }))
    expect(res.status).toBe(400)
  })

  it('未知 token → 400（不洩漏 user 存在性）', async () => {
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token: 'a'.repeat(64), new_password: 'BrandNew#9876',
    }))
    expect(res.status).toBe(400)
  })

  it('弱密碼（8 字純小寫）→ 400', async () => {
    const u = await seedUser()
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'aaaaaaaa',
    }))
    expect(res.status).toBe(400)
  })

  it('缺欄位（無 token）→ 400', async () => {
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      new_password: 'BrandNew#9876',
    }))
    expect(res.status).toBe(400)
  })

  it('缺欄位（無 new_password）→ 400', async () => {
    const u = await seedUser()
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, { token }))
    expect(res.status).toBe(400)
  })

  it('Invalid JSON → 400', async () => {
    const res = await callFunction(resetPost, new Request(URL_RESET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    }))
    expect(res.status).toBe(400)
  })

  it('軟刪除帳號 → 400 "Account not found"', async () => {
    const u = await seedUser({ deletedAt: '2020-01-01 00:00:00' })
    const token = await seedResetToken(u.id)
    const res = await callFunction(resetPost, jsonPost(URL_RESET, {
      token, new_password: 'BrandNew#9876',
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/account/i)
  })
})
