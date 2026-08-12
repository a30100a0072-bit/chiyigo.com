/**
 * Phase B / B4+B5 — user-level audit_log 整合測試
 *
 * 驗證：
 *  1. handler 觸發各事件 → audit_log 寫入正確 event_type / severity
 *  2. AUDIT_IP_SALT 缺值時 ip_hash=null（保守不存 raw IP）
 *  3. trace_id 從 X-Request-Id header 抽到 event_data.trace_id
 *  4. severity='critical' 不擋主流程（webhook 缺值即 noop）
 *  5. GET /api/admin/audit query API：filter / pagination / 角色守門
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser, jsonPost } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { safeUserAudit, hashIdentifierForAudit } from '../../functions/utils/user-audit'
import { onRequestPost as loginHandler } from '../../functions/api/auth/local/login'
import { onRequestGet as auditHandler } from '../../functions/api/admin/audit'

function reqWithSalt(extraEnv = {}) {
  return { ...env, ...extraEnv }
}

async function adminToken(userId) {
  return signJwt({ sub: String(userId), email: 'a@x', role: 'admin', status: 'active', ver: 0 },
    '15m', env, { audience: 'chiyigo' })
}

describe('Phase B audit_log writes', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('safeUserAudit 寫入 → audit_log 多一筆', async () => {
    await safeUserAudit(env, { event_type: 'auth.login.success', user_id: 42 })
    const row = await env.chiyigo_db
      .prepare(`SELECT event_type, severity, user_id, ip_hash FROM audit_log WHERE user_id = 42`)
      .first()
    expect(row.event_type).toBe('auth.login.success')
    expect(row.severity).toBe('info')
    expect(row.ip_hash).toBeNull() // 沒帶 request → 沒 IP
  })

  it('AUDIT_IP_SALT 缺值 → ip_hash=null（保守）', async () => {
    const request = new Request('http://x/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })
    await safeUserAudit(env, { event_type: 'auth.login.fail', user_id: 1, request })
    const row = await env.chiyigo_db
      .prepare(`SELECT ip_hash FROM audit_log WHERE user_id = 1`).first()
    expect(row.ip_hash).toBeNull()
  })

  it('AUDIT_IP_SALT 設定後 → ip_hash 為 SHA-256 hex（64 字元）', async () => {
    const request = new Request('http://x/', { headers: { 'CF-Connecting-IP': '1.2.3.4' } })
    await safeUserAudit(reqWithSalt({ AUDIT_IP_SALT: 'test-salt' }), {
      event_type: 'auth.login.fail', user_id: 2, request,
    })
    const row = await env.chiyigo_db
      .prepare(`SELECT ip_hash FROM audit_log WHERE user_id = 2`).first()
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('同一 IP 用同一鹽 hash 一致；換鹽後不一致', async () => {
    const r = new Request('http://x/', { headers: { 'CF-Connecting-IP': '5.5.5.5' } })
    await safeUserAudit(reqWithSalt({ AUDIT_IP_SALT: 'salt-A' }), { event_type: 'a', user_id: 10, request: r })
    await safeUserAudit(reqWithSalt({ AUDIT_IP_SALT: 'salt-A' }), { event_type: 'b', user_id: 10, request: r })
    await safeUserAudit(reqWithSalt({ AUDIT_IP_SALT: 'salt-B' }), { event_type: 'c', user_id: 10, request: r })
    const rows = await env.chiyigo_db
      .prepare(`SELECT event_type, ip_hash FROM audit_log WHERE user_id = 10 ORDER BY id ASC`).all()
    const [a, b, c] = rows.results
    expect(a.ip_hash).toBe(b.ip_hash)
    expect(a.ip_hash).not.toBe(c.ip_hash)
  })

  it('trace_id 從 X-Request-Id header 抽到 event_data', async () => {
    const request = new Request('http://x/', { headers: { 'X-Request-Id': 'trace-xyz-123' } })
    await safeUserAudit(env, { event_type: 'auth.login.success', user_id: 99, request })
    const row = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE user_id = 99`).first()
    expect(JSON.parse(row.event_data).trace_id).toBe('trace-xyz-123')
  })

  it('login.success → audit row 寫入', async () => {
    await seedUser({ email: 'l@x', password: 'Pass#1234' })
    const r = await loginHandler({
      request: jsonPost('http://x/api/auth/local/login', { email: 'l@x', password: 'Pass#1234' }),
      env,
    })
    expect(r.status).toBe(200)
    const row = await env.chiyigo_db
      .prepare(`SELECT event_type FROM audit_log WHERE event_type = 'auth.login.success'`).first()
    expect(row).toBeTruthy()
  })

  it('login.fail（密碼錯）→ audit warn', async () => {
    await seedUser({ email: 'l2@x', password: 'Pass#1234' })
    const r = await loginHandler({
      request: jsonPost('http://x/api/auth/local/login', { email: 'l2@x', password: 'WRONG' }),
      env,
    })
    expect(r.status).toBe(401)
    const row = await env.chiyigo_db
      .prepare(`SELECT event_type, severity FROM audit_log WHERE event_type = 'auth.login.fail'`).first()
    expect(row.severity).toBe('warn')
  })

  it('user_id=null 寫入合法（unknown email reset_request 場景）', async () => {
    await safeUserAudit(env, {
      event_type: 'account.password.reset_request',
      data: { reason_code: 'unknown_email' },
    })
    const row = await env.chiyigo_db
      .prepare(`SELECT user_id, event_data FROM audit_log WHERE event_type = 'account.password.reset_request'`)
      .first()
    expect(row.user_id).toBeNull()
    expect(JSON.parse(row.event_data).reason_code).toBe('unknown_email')
  })

  it('handler 失敗時 audit 也不擋（safeUserAudit catch all）', async () => {
    // 故意傳壞的 env（沒 chiyigo_db）→ 內部 catch 吞掉
    const broken = { ...env, chiyigo_db: null }
    await expect(safeUserAudit(broken, { event_type: 'x', user_id: 1 })).resolves.toBeUndefined()
  })
})

describe('GET /api/admin/audit', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  async function callAudit(token, queryString = '') {
    const url = `http://x/api/admin/audit${queryString ? '?' + queryString : ''}`
    const resp = await auditHandler({
      request: new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
      env,
    })
    return { status: resp.status, body: await resp.json() }
  }

  async function seedAudit(rows) {
    for (const r of rows) {
      await env.chiyigo_db
        .prepare(`INSERT INTO audit_log (event_type, severity, user_id) VALUES (?, ?, ?)`)
        .bind(r.event_type, r.severity ?? 'info', r.user_id ?? null).run()
    }
  }

  it('player 訪問 → 403', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const tok = await signJwt({ sub: String(id), role: 'player', status: 'active', ver: 0 },
      '15m', env, { audience: 'chiyigo' })
    const r = await callAudit(tok)
    expect(r.status).toBe(403)
  })

  it('admin 無 filter → 回所有 row（pagination 預設）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'auth.login.success', user_id: 1 },
      { event_type: 'auth.login.fail',    user_id: 2, severity: 'warn' },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok)
    expect(r.status).toBe(200)
    expect(r.body.total).toBe(2)
    expect(r.body.rows.length).toBe(2)
    // 由新到舊
    expect(r.body.rows[0].event_type).toBe('auth.login.fail')
  })

  it("filter user_id", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'auth.login.success', user_id: 100 },
      { event_type: 'auth.login.success', user_id: 200 },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'user_id=200')
    expect(r.body.total).toBe(1)
    expect(r.body.rows[0].user_id).toBe(200)
  })

  it("filter event_type", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'auth.login.success' },
      { event_type: 'auth.login.fail', severity: 'warn' },
      { event_type: 'auth.login.fail', severity: 'warn' },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'event_type=auth.login.fail')
    expect(r.body.total).toBe(2)
  })

  it("filter severity", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'a', severity: 'info' },
      { event_type: 'b', severity: 'warn' },
      { event_type: 'c', severity: 'critical' },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'severity=critical')
    expect(r.body.total).toBe(1)
    expect(r.body.rows[0].event_type).toBe('c')
  })

  it("severity 非法值 → 400", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'severity=PANIC')
    expect(r.status).toBe(400)
  })

  it("pagination limit 超過 200 → clamp", async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'limit=999')
    expect(r.body.limit).toBe(200)
  })

  // ─── PR-11 smoke（Stage 3 admin/audit.ts 補 direct coverage） ─────────
  // 鎖三點：(1) event_data 白名單裁切 + _redacted_keys 計數
  //        (2) from/to ISO 8601 驗證 → 400 INVALID
  //        (3) admin.audit.read 觀測 audit 寫入含 result_count + filters
  // ref: project_js_to_ts_stage3_audit_chain.md

  it('PR-11 smoke: event_data 白名單裁切 — 敏感欄位轉 _redacted_keys', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const safe   = JSON.stringify({ reason_code: 'unknown_email', trace_id: 't-1', amount_subunit: 100 })
    const unsafe = JSON.stringify({ password: 'leak', email: 'pii@x', token: 'tok', reason_code: 'kept' })
    const mixed  = JSON.stringify({ raw_ip: '1.2.3.4', otp: '999999', trace_id: 't-2' })
    await env.chiyigo_db.prepare(`INSERT INTO audit_log (event_type, severity, user_id, event_data) VALUES (?, ?, ?, ?)`)
      .bind('a.safe',   'info', 7, safe).run()
    await env.chiyigo_db.prepare(`INSERT INTO audit_log (event_type, severity, user_id, event_data) VALUES (?, ?, ?, ?)`)
      .bind('b.unsafe', 'info', 7, unsafe).run()
    await env.chiyigo_db.prepare(`INSERT INTO audit_log (event_type, severity, user_id, event_data) VALUES (?, ?, ?, ?)`)
      .bind('c.mixed',  'info', 7, mixed).run()
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'user_id=7')
    expect(r.status).toBe(200)
    expect(r.body.total).toBe(3)
    const byType = Object.fromEntries(r.body.rows.map(x => [x.event_type, x.event_data]))
    // 全 safe → 無 _redacted_keys
    expect(byType['a.safe']).toEqual({ reason_code: 'unknown_email', trace_id: 't-1', amount_subunit: 100 })
    expect('_redacted_keys' in byType['a.safe']).toBe(false)
    // 全敏感（保留 reason_code）→ 3 unsafe + 1 safe
    expect(byType['b.unsafe'].reason_code).toBe('kept')
    expect(byType['b.unsafe'].password).toBeUndefined()
    expect(byType['b.unsafe'].email).toBeUndefined()
    expect(byType['b.unsafe'].token).toBeUndefined()
    expect(byType['b.unsafe']._redacted_keys).toBe(3)
    // 混合 → 保 trace_id 移除 raw_ip + otp
    expect(byType['c.mixed'].trace_id).toBe('t-2')
    expect(byType['c.mixed']._redacted_keys).toBe(2)
  })

  it('PR-11 smoke: from/to 非 ISO 8601 → 400 FROM_DATE_INVALID / TO_DATE_INVALID', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const tok = await adminToken(id)
    const r1 = await callAudit(tok, 'from=not-a-date')
    expect(r1.status).toBe(400)
    expect(r1.body.code).toBe('FROM_DATE_INVALID')
    const r2 = await callAudit(tok, 'to=2026/05/18')
    expect(r2.status).toBe(400)
    expect(r2.body.code).toBe('TO_DATE_INVALID')
    // 合法 ISO date 不擋
    const r3 = await callAudit(tok, 'from=2026-01-01&to=2026-12-31T00:00:00Z')
    expect(r3.status).toBe(200)
  })

  it('PR-11 smoke: 成功讀取後寫 admin.audit.read 觀測 row（含 result_count + filters）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedAudit([
      { event_type: 'auth.login.success', user_id: 500 },
      { event_type: 'auth.login.success', user_id: 500 },
    ])
    const tok = await adminToken(id)
    const r = await callAudit(tok, 'user_id=500&limit=10')
    expect(r.status).toBe(200)
    // 觀測 audit row（取最新一筆 admin.audit.read）
    const row = await env.chiyigo_db
      .prepare(`SELECT user_id, severity, event_data FROM audit_log WHERE event_type = 'admin.audit.read' ORDER BY id DESC LIMIT 1`)
      .first()
    expect(row).toBeTruthy()
    expect(row.user_id).toBe(id)
    expect(row.severity).toBe('info')
    const data = JSON.parse(row.event_data)
    expect(data.result_count).toBe(2)
    expect(data.filters.user_id).toBe('500')
    expect(data.filters.limit).toBe(10)
  })
})

// ── PR-2dw 批 D §8.2 / §8.2.1 / §8.2.2 ────────────────────────────────────────
// 同一概念同一字串（feedback_state_machine_naming_no_alias）：測試端沿用 production 名稱，
// 以結構萃取取得，不需 export（§4.2 的 file-local 決策不變）。
type UserAuditEntry = Parameters<typeof safeUserAudit>[1]

// 共用 helper（§5.5 suppression #2）：供兩個非法 severity 案例使用。
// env 為參數而非閉包常數 —— §8.2 item 3 要求 webhook 經 reqWithSalt(extraEnv) 注入，
// 否則「fetch 0 次」對正反案例皆成立、等於沒測。
function writeWithInvalidSeverity(
  auditEnv: Parameters<typeof safeUserAudit>[0],
  entry: Omit<UserAuditEntry, 'severity'>,
  severity: string,
) {
  // @ts-expect-error -- deliberate illegal severity: runtime negative control for the category-aware fallback
  return safeUserAudit(auditEnv, { ...entry, severity })
}

describe('safeUserAudit severity 邊界（§4.3 二分）+ Discord gate（§4.6）', () => {
  const WEBHOOK = 'https://discord.invalid/pr2dw-batchd'
  let fetchMock

  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => {
    await resetDb()
    // §8.2 stub 生命週期 item 2：每案重建，否則「恰 1 次／0 次」跨案例不可信。
    fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  })
  // §8.2 stub 生命週期 item 1：teardown 必配對（singleWorker + isolatedStorage:false，globalThis 跨檔共用）。
  afterEach(() => { vi.unstubAllGlobals() })

  async function rowOf(eventType) {
    return env.chiyigo_db
      .prepare(`SELECT event_type, severity, cold_class FROM audit_log WHERE event_type = ?`)
      .bind(eventType)
      .first()
  }

  it('省略 severity 回歸：security_signal 事件仍落 info / security_warn（二分之省略側未被 fallback 汙染）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await safeUserAudit(env, { event_type: 'auth.login.success', user_id: 42 })
    const row = await rowOf('auth.login.success')
    expect(row.severity).toBe('info')
    expect(row.cold_class).toBe('security_warn')
    // 省略側不得記 invalid log
    expect(warnSpy.mock.calls.filter(c => String(c[0]).includes('[audit-severity-invalid]')).length).toBe(0)
    warnSpy.mockRestore()
  })

  it('正向控制：合法 critical 走 notification path，fetch 恰 1 次（AUDIT_WEBHOOK_TIMEOUT_GUARD）', async () => {
    vi.stubGlobal('fetch', fetchMock)
    await safeUserAudit(reqWithSalt({ DISCORD_AUDIT_WEBHOOK: WEBHOOK }), {
      event_type: 'account.delete', severity: 'critical', user_id: 7,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // AUDIT_WEBHOOK_TIMEOUT_GUARD：§4.6 之 signal 必須實際傳入 fetch init
    const init = fetchMock.mock.calls[0][1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(init.signal.aborted).toBe(false)   // 正常路徑不應已 abort
  })

  it('非法 severity + security_signal → critical / security_critical，記 invalid log，fetch 0 次', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await writeWithInvalidSeverity(
      reqWithSalt({ DISCORD_AUDIT_WEBHOOK: WEBHOOK }),
      { event_type: 'auth.login.fail', user_id: 11 },
      'PANIC',
    )
    const row = await rowOf('auth.login.fail')
    expect(row.severity).toBe('critical')
    expect(row.cold_class).toBe('security_critical')
    const invalid = warnSpy.mock.calls.filter(c => String(c[0]).includes('[audit-severity-invalid]'))
    expect(invalid.length).toBe(1)
    // log 不得洩漏 raw 非法值
    expect(JSON.stringify(invalid[0])).not.toContain('PANIC')
    expect(errSpy.mock.calls.filter(c => String(c[0]).includes('[audit-loss]')).length).toBe(0)
    // fallback 產生的 critical 一律不觸發 webhook（不變量 3：只由 parsed === 'critical' 決定）
    expect(fetchMock).toHaveBeenCalledTimes(0)
    warnSpy.mockRestore(); errSpy.mockRestore()
  })

  it('非法 severity + 非 security category → info / 該 category，記 invalid log，fetch 0 次', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await writeWithInvalidSeverity(
      reqWithSalt({ DISCORD_AUDIT_WEBHOOK: WEBHOOK }),
      { event_type: 'auth.login.rate_limited', user_id: 12 },
      'PANIC',
    )
    const row = await rowOf('auth.login.rate_limited')
    expect(row.severity).toBe('info')
    expect(row.cold_class).toBe('telemetry')
    const invalid = warnSpy.mock.calls.filter(c => String(c[0]).includes('[audit-severity-invalid]'))
    expect(invalid.length).toBe(1)
    // 其餘同上：log 不得洩漏 raw 非法值
    expect(JSON.stringify(invalid[0])).not.toContain('PANIC')
    expect(errSpy.mock.calls.filter(c => String(c[0]).includes('[audit-loss]')).length).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(0)
    warnSpy.mockRestore(); errSpy.mockRestore()
  })

  // GPT-D-ARCH-RR4：null 分支必須 load-bearing —— 鎖 `entry.severity === undefined`，
  // 防日後被誤改成 `== null`（那會把 null 錯併入省略路徑，而現有非法字串案例不會轉紅）。
  // strict:false ⇒ severity: null 可直接賦值給 severity?: AuditSeverity，零 suppression 成本。
  it('null + security_signal → critical / security_critical（二分之 null 側鎖）', async () => {
    vi.stubGlobal('fetch', fetchMock)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await safeUserAudit(reqWithSalt({ DISCORD_AUDIT_WEBHOOK: WEBHOOK }), {
      event_type: 'auth.country_jump', severity: null, user_id: 13,
    })
    const row = await rowOf('auth.country_jump')
    expect(row.severity).toBe('critical')
    expect(row.cold_class).toBe('security_critical')
    expect(warnSpy.mock.calls.filter(c => String(c[0]).includes('[audit-severity-invalid]')).length).toBe(1)
    expect(errSpy.mock.calls.filter(c => String(c[0]).includes('[audit-loss]')).length).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(0)
    warnSpy.mockRestore(); errSpy.mockRestore()
  })

  // ARCH-D-L4：測試名須帶穩定識別字 STRING_RAW_COLLISION_GUARD，供 Code Gate 清點
  it('STRING_RAW_COLLISION_GUARD: undefined 與空字串必須產生相異摘要', async () => {
    const a = await hashIdentifierForAudit(env, 'd', undefined)
    const b = await hashIdentifierForAudit(env, 'd', '')
    expect(a.hex).not.toBe(b.hex)
  })
})
