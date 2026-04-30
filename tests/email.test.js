import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendDeleteConfirmationEmail,
} from '../functions/utils/email.js'

const RESEND_API = 'https://api.resend.com/emails'

let lastReq
function mockOk() {
  globalThis.fetch = vi.fn(async (url, init) => {
    lastReq = { url, init, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ id: 'ok-1' }), { status: 200 })
  })
}
function mockFail(status, body = 'fail') {
  globalThis.fetch = vi.fn(async () => new Response(body, { status }))
}

beforeEach(() => { lastReq = null })
afterEach(() => { vi.restoreAllMocks() })

describe('sendVerificationEmail', () => {
  it('呼叫 Resend API 並帶必要欄位', async () => {
    mockOk()
    await sendVerificationEmail('key-x', 'a@b.com', 'tok123', { IAM_BASE_URL: 'https://chiyigo.com', MAIL_FROM_ADDRESS: 'noreply@chiyigo.com' })
    expect(lastReq.url).toBe(RESEND_API)
    expect(lastReq.init.headers.Authorization).toBe('Bearer key-x')
    expect(lastReq.body.to).toBe('a@b.com')
    expect(lastReq.body.from).toBe('noreply@chiyigo.com')
    expect(lastReq.body.subject).toContain('驗證')
    expect(lastReq.body.html).toContain('https://chiyigo.com/verify-email.html?token=tok123')
  })

  it('env 缺 IAM_BASE_URL → 用預設 chiyigo.com', async () => {
    mockOk()
    await sendVerificationEmail('k', 'a@b', 't', {})
    expect(lastReq.body.html).toContain('https://chiyigo.com/verify-email.html?token=t')
  })

  it('env 缺 MAIL_FROM_ADDRESS → 用預設 noreply@chiyigo.com', async () => {
    mockOk()
    await sendVerificationEmail('k', 'a@b', 't')
    expect(lastReq.body.from).toBe('noreply@chiyigo.com')
  })

  it('Resend 非 2xx → 拋例外', async () => {
    mockFail(500, 'boom')
    await expect(sendVerificationEmail('k', 'a@b', 't', {})).rejects.toThrow(/Resend API 500/)
  })

  it('signal 透傳到 fetch', async () => {
    mockOk()
    const ctrl = new AbortController()
    await sendVerificationEmail('k', 'a@b', 't', {}, ctrl.signal)
    expect(lastReq.init.signal).toBe(ctrl.signal)
  })
})

describe('sendPasswordResetEmail', () => {
  it('連結指向 /reset-password.html', async () => {
    mockOk()
    await sendPasswordResetEmail('k', 'a@b', 'rt', { IAM_BASE_URL: 'https://chiyigo.com' })
    expect(lastReq.body.html).toContain('https://chiyigo.com/reset-password.html?token=rt')
    expect(lastReq.body.subject).toContain('重設')
  })
  it('Resend 失敗拋例外（含 status 與 body）', async () => {
    mockFail(429, 'rate')
    await expect(sendPasswordResetEmail('k', 'a@b', 't')).rejects.toThrow(/Resend API 429.*rate/)
  })
})

describe('sendDeleteConfirmationEmail', () => {
  it('連結指向 /confirm-delete.html，主旨明示刪除', async () => {
    mockOk()
    await sendDeleteConfirmationEmail('k', 'a@b', 'dt', {})
    expect(lastReq.body.html).toContain('/confirm-delete.html?token=dt')
    expect(lastReq.body.subject).toContain('刪除')
  })
})
