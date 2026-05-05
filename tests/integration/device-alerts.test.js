/**
 * Phase D-4 — 異常裝置警示 helper 整合測試
 *
 * 直接測 functions/utils/device-alerts.js 的 safeAlertAnomalies。
 * email 寄送（sendNewDeviceAlertEmail）用 vi.mock 替換成 stub，避免打 Resend。
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { generateSecureToken, hashToken } from '../../functions/utils/crypto.js'
import { safeAlertAnomalies } from '../../functions/utils/device-alerts.js'

// 攔截 fetch 到 Resend API 的呼叫（vitest-pool-workers singleWorker 模式下 vi.mock 跨檔
// 不穩定；改 hook 全域 fetch 觀察 Resend 端點即可，且更貼近 production 行為）
const mailLog = []
const origFetch = globalThis.fetch
function installFetchSpy() {
  mailLog.length = 0
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (url && url.includes('api.resend.com')) {
      mailLog.push({ url, body: init?.body ? JSON.parse(init.body) : null })
      return new Response(JSON.stringify({ id: 'mock-mail' }), { status: 200 })
    }
    return origFetch(input, init)
  }
}
function restoreFetch() { globalThis.fetch = origFetch }

async function seedRT(userId, deviceUuid = null) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + 7 * 86400_000)
    .toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, auth_time)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).bind(userId, hash, deviceUuid, exp).run()
}

async function seedLoginAudit(userId, country) {
  const data = JSON.stringify({ method: 'password', country })
  await env.chiyigo_db.prepare(
    `INSERT INTO audit_log (event_type, severity, user_id, event_data)
     VALUES ('auth.login.success', 'info', ?, ?)`,
  ).bind(userId, data).run()
}

function reqWithCountry(country) {
  // Cloudflare workers 在 production 給 request.cf；test 環境沒有，這裡手動掛
  const req = new Request('http://x/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })
  if (country) Object.defineProperty(req, 'cf', { value: { country } })
  return req
}

afterAll(() => { restoreFetch() })

describe('safeAlertAnomalies — checkNewDevice', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    installFetchSpy()
    env.RESEND_API_KEY = 'test-key'
  })

  it('web (deviceUuid=null) → 不偵測新裝置', async () => {
    const u = await seedUser({ email: 'w@x' })
    await seedRT(u.id, null)
    await seedRT(u.id, null)
    await safeAlertAnomalies(env, reqWithCountry(null), {
      userId: u.id, email: 'w@x', deviceUuid: null,
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.new_device'`,
    ).first()
    expect(audit).toBeNull()
    expect(mailLog).toHaveLength(0)
  })

  it('第一次登入（total=1）→ 不算新裝置', async () => {
    const u = await seedUser({ email: 'first@x' })
    await seedRT(u.id, 'dev-first')  // 模擬剛 INSERT 那筆
    await safeAlertAnomalies(env, reqWithCountry(null), {
      userId: u.id, email: 'first@x', deviceUuid: 'dev-first',
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.new_device'`,
    ).first()
    expect(audit).toBeNull()
    expect(mailLog).toHaveLength(0)
  })

  it('熟識 device（之前登過）→ 不告警', async () => {
    const u = await seedUser({ email: 'known@x' })
    await seedRT(u.id, 'dev-A')
    await seedRT(u.id, 'dev-A')   // 同 device 出現 2 次
    await seedRT(u.id, 'dev-B')   // 還有別的
    await safeAlertAnomalies(env, reqWithCountry(null), {
      userId: u.id, email: 'known@x', deviceUuid: 'dev-A',
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.new_device'`,
    ).first()
    expect(audit).toBeNull()
  })

  it('新 device → audit critical + email', async () => {
    const u = await seedUser({ email: 'new@x' })
    await seedRT(u.id, 'dev-old')   // 過去用過的
    await seedRT(u.id, 'dev-new')   // 模擬剛 INSERT 的新 device
    await safeAlertAnomalies(env, reqWithCountry('US'), {
      userId: u.id, email: 'new@x', deviceUuid: 'dev-new',
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity, event_data FROM audit_log
        WHERE event_type = 'auth.new_device' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')
    expect(audit.event_data).toMatch(/dev-new/)
    expect(audit.event_data).toMatch(/"country":"US"/)

    expect(mailLog).toHaveLength(1)
    expect(mailLog[0].body.to).toBe('new@x')
    expect(mailLog[0].body.subject).toMatch(/新裝置/)
  })

  it('沒設 RESEND_API_KEY → audit 仍寫入但 email 不寄', async () => {
    delete env.RESEND_API_KEY
    const u = await seedUser({ email: 'no-mail@x' })
    await seedRT(u.id, 'dev-old')
    await seedRT(u.id, 'dev-new')
    await safeAlertAnomalies(env, reqWithCountry(null), {
      userId: u.id, email: 'no-mail@x', deviceUuid: 'dev-new',
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.new_device' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit).not.toBeNull()
    expect(mailLog).toHaveLength(0)
  })
})

describe('safeAlertAnomalies — checkCountryJump', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    installFetchSpy()
    env.RESEND_API_KEY = 'test-key'
  })

  it('test 環境沒 request.cf → skip 不誤報', async () => {
    const u = await seedUser({ email: 'nocf@x' })
    await seedLoginAudit(u.id, 'TW')
    await safeAlertAnomalies(env, reqWithCountry(null), {
      userId: u.id, email: 'nocf@x', deviceUuid: null,
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.country_jump'`,
    ).first()
    expect(audit).toBeNull()
  })

  it('< 2 筆 login.success → skip（首次登入無前次紀錄）', async () => {
    const u = await seedUser({ email: 'first@x' })
    await seedLoginAudit(u.id, 'US')  // 只有剛剛這筆
    await safeAlertAnomalies(env, reqWithCountry('US'), {
      userId: u.id, email: 'first@x', deviceUuid: null,
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.country_jump'`,
    ).first()
    expect(audit).toBeNull()
  })

  it('上次 = 這次 → 不告警', async () => {
    const u = await seedUser({ email: 'same@x' })
    await seedLoginAudit(u.id, 'TW')   // 前次
    await seedLoginAudit(u.id, 'TW')   // 這次
    await safeAlertAnomalies(env, reqWithCountry('TW'), {
      userId: u.id, email: 'same@x', deviceUuid: null,
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.country_jump'`,
    ).first()
    expect(audit).toBeNull()
  })

  it('country 跳變（TW → US）→ audit critical（無 email）', async () => {
    const u = await seedUser({ email: 'jump@x' })
    await seedLoginAudit(u.id, 'TW')   // 前次
    await seedLoginAudit(u.id, 'US')   // 這次 caller 已寫
    await safeAlertAnomalies(env, reqWithCountry('US'), {
      userId: u.id, email: 'jump@x', deviceUuid: null,
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT severity, event_data FROM audit_log
        WHERE event_type = 'auth.country_jump' AND user_id = ?`,
    ).bind(u.id).first()
    expect(audit?.severity).toBe('critical')
    expect(audit.event_data).toMatch(/"from":"TW"/)
    expect(audit.event_data).toMatch(/"to":"US"/)
    // country jump 不寄 email
    expect(mailLog).toHaveLength(0)
  })

  it('上一筆 event_data 沒 country 欄位 → skip 不誤報', async () => {
    const u = await seedUser({ email: 'legacy@x' })
    // 模擬舊資料：event_data 沒 country
    await env.chiyigo_db.prepare(
      `INSERT INTO audit_log (event_type, severity, user_id, event_data)
       VALUES ('auth.login.success', 'info', ?, '{"method":"password"}')`,
    ).bind(u.id).run()
    await seedLoginAudit(u.id, 'US')
    await safeAlertAnomalies(env, reqWithCountry('US'), {
      userId: u.id, email: 'legacy@x', deviceUuid: null,
    })
    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.country_jump'`,
    ).first()
    expect(audit).toBeNull()
  })
})

describe('safeAlertAnomalies — 整合：兩種同時觸發', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    installFetchSpy()
    env.RESEND_API_KEY = 'test-key'
  })

  it('新裝置 + country 跳變 → 兩個 audit 都寫，email 寄 1 封', async () => {
    const u = await seedUser({ email: 'both@x' })
    await seedRT(u.id, 'dev-old')
    await seedRT(u.id, 'dev-new')
    await seedLoginAudit(u.id, 'TW')  // 前次
    await seedLoginAudit(u.id, 'JP')  // 這次

    await safeAlertAnomalies(env, reqWithCountry('JP'), {
      userId: u.id, email: 'both@x', deviceUuid: 'dev-new',
    })

    const newDev = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.new_device' AND user_id = ?`,
    ).bind(u.id).first()
    const jump = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.country_jump' AND user_id = ?`,
    ).bind(u.id).first()
    expect(newDev).not.toBeNull()
    expect(jump).not.toBeNull()
    expect(mailLog).toHaveLength(1)  // 只有新裝置寄 email
  })
})
