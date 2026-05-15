/**
 * Phase D1 — Refresh token device binding 整合測試
 *
 * 涵蓋：
 *  - X-Device-Id header 路徑 happy
 *  - Header mismatch → 401 + 整個 (user, device) 家族被撤銷 + critical audit
 *  - body.device_uuid 向後相容
 *  - Web cookie 路徑（device_uuid=null）不受影響
 *  - 舊 token rotation 後寫入新列繼承 device_uuid
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers.js'
import { generateSecureToken, hashToken } from '../../functions/utils/crypto'
import { onRequestPost as refreshHandler } from '../../functions/api/auth/refresh.js'

async function seedRefresh(userId, {
  deviceUuid = null, expired = false, revoked = false, issuedAud = null,
} = {}) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + (expired ? -3600_000 : 7 * 86400_000))
    .toISOString().replace('T', ' ').slice(0, 19)
  const revokedAt = revoked
    ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
  await env.chiyigo_db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, revoked_at, issued_aud)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(userId, hash, deviceUuid, exp, revokedAt, issuedAud).run()
  return plain
}

function refreshReq({ token, headers = {}, body = {} } = {}) {
  const finalBody = token ? { refresh_token: token, ...body } : body
  return new Request('http://x/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(finalBody),
  })
}

async function call(req) {
  const resp = await refreshHandler({ request: req, env })
  let body = null
  try { body = await resp.json() } catch { /* swallow */ }
  return { status: resp.status, body }
}

describe('POST /api/auth/refresh — Phase D1 device binding', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('header X-Device-Id 比對通過 → 200 + rotation', async () => {
    const u = await seedUser({ email: 'd1@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: 'dev-aaa' })
    const r = await call(refreshReq({ token: tok, headers: { 'X-Device-Id': 'dev-aaa' } }))
    expect(r.status).toBe(200)
    expect(r.body.access_token).toBeTruthy()
    expect(r.body.refresh_token).toBeTruthy()
    // 舊 token 被 revoked，新 token 繼承 device_uuid
    const rows = await env.chiyigo_db
      .prepare('SELECT device_uuid, revoked_at FROM refresh_tokens WHERE user_id = ? ORDER BY id')
      .bind(u.id).all()
    expect(rows.results).toHaveLength(2)
    expect(rows.results[0].revoked_at).not.toBeNull()
    expect(rows.results[1].revoked_at).toBeNull()
    expect(rows.results[1].device_uuid).toBe('dev-aaa')
  })

  it('header 不符 → 401 + 整個 device 家族撤銷 + critical audit', async () => {
    const u = await seedUser({ email: 'd2@x' })
    const tok1 = await seedRefresh(u.id, { deviceUuid: 'dev-bbb' })
    const tok2 = await seedRefresh(u.id, { deviceUuid: 'dev-bbb' })  // 同 device chain 上其他 token
    const tokOther = await seedRefresh(u.id, { deviceUuid: 'dev-ccc' })  // 別台裝置不該被波及

    const r = await call(refreshReq({ token: tok1, headers: { 'X-Device-Id': 'dev-evil' } }))
    expect(r.status).toBe(401)
    expect(r.body.error).toMatch(/Device mismatch/i)

    const bbb = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM refresh_tokens
                WHERE user_id = ? AND device_uuid = 'dev-bbb' AND revoked_at IS NULL`)
      .bind(u.id).first()
    expect(bbb.n).toBe(0)

    const ccc = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM refresh_tokens
                WHERE user_id = ? AND device_uuid = 'dev-ccc' AND revoked_at IS NULL`)
      .bind(u.id).first()
    expect(ccc.n).toBe(1)  // 別 device 不受影響

    const audit = await env.chiyigo_db
      .prepare(`SELECT event_type, severity FROM audit_log
                WHERE user_id = ? AND event_type = 'auth.refresh.device_mismatch'`)
      .bind(u.id).first()
    expect(audit).not.toBeNull()
    expect(audit.severity).toBe('critical')

    // 抑制 unused 警告
    void tok2; void tokOther
  })

  it('header 缺值 fallback 到 body.device_uuid（向後相容）', async () => {
    const u = await seedUser({ email: 'd3@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: 'dev-legacy' })
    const r = await call(refreshReq({ token: tok, body: { device_uuid: 'dev-legacy' } }))
    expect(r.status).toBe(200)
  })

  it('Web cookie 路徑（DB device_uuid=null）不需要 header', async () => {
    const u = await seedUser({ email: 'd4@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: null })
    const req = new Request('http://x/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `chiyigo_refresh=${tok}` },
      body: '{}',
    })
    const resp = await refreshHandler({ request: req, env })
    expect(resp.status).toBe(200)
    const setCookie = resp.headers.get('Set-Cookie')
    expect(setCookie).toMatch(/chiyigo_refresh=/)
  })

  it('header 帶值但 DB 沒綁 device → 不檢查（避免假 mismatch）', async () => {
    const u = await seedUser({ email: 'd5@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: null })
    const r = await call(refreshReq({ token: tok, headers: { 'X-Device-Id': 'dev-zzz' } }))
    expect(r.status).toBe(200)
  })
})

// F-2 (codex r9-5 follow-up, commit b774b1a, 2026-05-10) — refresh aud 綁定 + mismatch 條件
//
// 設計要點：
//  - issued_aud 主導 access token aud（攻擊者控制 body.aud 不能切換 audience）
//  - rawAudProvided 條件：body 真的送 raw aud 才解析；缺省不誤報 mismatch
//  - mismatch 升 critical（噪音排除後是攻擊者切換 audience 的明確訊號）
//  - legacy NULL row 退回 resolveAud(body.aud)；F-1 已批次 revoke prod NULL row
function decodeAud(token) {
  // 不走 verifyJwt（會驗 aud='chiyigo' 失敗）；直接 decode payload 讀 aud claim
  const [, payloadB64] = token.split('.')
  const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/')
  const json = atob(padded + '='.repeat((4 - padded.length % 4) % 4))
  return JSON.parse(json).aud
}
async function findMismatchAudit(userId) {
  return await env.chiyigo_db.prepare(
    `SELECT severity, event_data FROM audit_log
     WHERE user_id = ? AND event_type = 'auth.refresh.aud_mismatch'`,
  ).bind(userId).first()
}

describe('POST /api/auth/refresh — F-2 audience binding', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('issued_aud=sport-app + body.aud 缺省 → access aud 仍 sport-app，不寫 mismatch', async () => {
    const u = await seedUser({ email: 'aud1@x' })
    const tok = await seedRefresh(u.id, { issuedAud: 'sport-app' })
    const r = await call(refreshReq({ token: tok }))
    expect(r.status).toBe(200)
    expect(decodeAud(r.body.access_token)).toBe('sport-app')
    expect(await findMismatchAudit(u.id)).toBeNull()
  })

  it('issued_aud=sport-app + body.aud=chiyigo → aud 仍 sport-app，寫 critical mismatch', async () => {
    const u = await seedUser({ email: 'aud2@x' })
    const tok = await seedRefresh(u.id, { issuedAud: 'sport-app' })
    const r = await call(refreshReq({ token: tok, body: { aud: 'chiyigo' } }))
    expect(r.status).toBe(200)
    expect(decodeAud(r.body.access_token)).toBe('sport-app')
    const audit = await findMismatchAudit(u.id)
    expect(audit).not.toBeNull()
    expect(audit.severity).toBe('critical')
    const data = JSON.parse(audit.event_data)
    expect(data.issued_aud).toBe('sport-app')
    expect(data.requested_aud).toBe('chiyigo')
  })

  it('issued_aud=chiyigo + body.aud=chiyigo → 不寫 mismatch（同 aud）', async () => {
    const u = await seedUser({ email: 'aud3@x' })
    const tok = await seedRefresh(u.id, { issuedAud: 'chiyigo' })
    const r = await call(refreshReq({ token: tok, body: { aud: 'chiyigo' } }))
    expect(r.status).toBe(200)
    expect(decodeAud(r.body.access_token)).toBe('chiyigo')
    expect(await findMismatchAudit(u.id)).toBeNull()
  })

  it('legacy issued_aud=NULL + body.aud=sport-app → backward compat：access aud=sport-app', async () => {
    const u = await seedUser({ email: 'aud4@x' })
    const tok = await seedRefresh(u.id, { issuedAud: null })
    const r = await call(refreshReq({ token: tok, body: { aud: 'sport-app' } }))
    expect(r.status).toBe(200)
    expect(decodeAud(r.body.access_token)).toBe('sport-app')
    // legacy row 沒 issued_aud → mismatch 判斷不適用
    expect(await findMismatchAudit(u.id)).toBeNull()
  })

  it('legacy issued_aud=NULL + body.aud 缺省 → access aud=chiyigo，不誤報 mismatch', async () => {
    const u = await seedUser({ email: 'aud5@x' })
    const tok = await seedRefresh(u.id, { issuedAud: null })
    const r = await call(refreshReq({ token: tok }))
    expect(r.status).toBe(200)
    // effectiveAud = NULL || null || 'chiyigo' = 'chiyigo'
    expect(decodeAud(r.body.access_token)).toBe('chiyigo')
    expect(await findMismatchAudit(u.id)).toBeNull()
  })

  it('rotation 後新 row 透傳 issued_aud（不被 body.aud 改）', async () => {
    const u = await seedUser({ email: 'aud6@x' })
    const tok = await seedRefresh(u.id, { issuedAud: 'sport-app' })
    await call(refreshReq({ token: tok, body: { aud: 'chiyigo' } }))  // 嘗試切 aud
    const rows = await env.chiyigo_db
      .prepare('SELECT issued_aud, revoked_at FROM refresh_tokens WHERE user_id=? ORDER BY id')
      .bind(u.id).all()
    expect(rows.results).toHaveLength(2)
    expect(rows.results[0].revoked_at).not.toBeNull()
    expect(rows.results[1].revoked_at).toBeNull()
    expect(rows.results[1].issued_aud).toBe('sport-app')  // 不被 body.aud='chiyigo' 改
  })
})
