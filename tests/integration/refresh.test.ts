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
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { generateSecureToken, hashToken } from '../../functions/utils/crypto'
import { onRequestPost as refreshHandler } from '../../functions/api/auth/refresh'
import { decodeJwt } from 'jose'

async function seedRefresh(userId, {
  deviceUuid = null, expired = false, revoked = false, issuedAud = null, sessionId = null,
  // Fork 2 Route B: successorTokenHash stamps the rotation-orphan provenance marker; revokedSecondsAgo sets revoked_at
  // to an explicit age (for grace-window boundary tests) and takes precedence over the boolean `revoked`.
  successorTokenHash = null, revokedSecondsAgo = null,
}: {
  deviceUuid?: string | null; expired?: boolean; revoked?: boolean; issuedAud?: string | null;
  sessionId?: string | null; successorTokenHash?: string | null; revokedSecondsAgo?: number | null;
} = {}) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + (expired ? -3600_000 : 7 * 86400_000))
    .toISOString().replace('T', ' ').slice(0, 19)
  const revokedAt = revokedSecondsAgo != null
    ? new Date(Date.now() - revokedSecondsAgo * 1000).toISOString().replace('T', ' ').slice(0, 19)
    : (revoked ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null)
  await env.chiyigo_db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, revoked_at, issued_aud, session_id, successor_token_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(userId, hash, deviceUuid, exp, revokedAt, issuedAud, sessionId, successorTokenHash).run()
  return plain
}

function refreshReq({ token, headers = {}, body = {} }: {
  token?: string
  headers?: Record<string, string>
  body?: Record<string, unknown>
} = {}) {
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
    // PR1 tenant claim wiring：refresh 簽出的 token 帶 active personal tenant（decision D：回 personal）
    const refreshClaims = decodeJwt(r.body.access_token)
    expect(typeof refreshClaims.tenant_id).toBe('number')
    expect(refreshClaims.platform_role).toBe('tenant_owner')
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

// PR5 5d-1b — refresh.ts rotation PRESERVES the per-login session_id (the session.revoked family id, stable
// across the login's rotation chain), and HEALS a legacy/deploy-gap NULL session_id to a fresh non-null id.
// Emission of session.revoked is 5d-2 (not wired here) -- these tests only lock the rotation write behavior.
describe('POST /api/auth/refresh — PR5 5d session_id preserve / heal', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('rotation PRESERVES session_id (stable per-login family id, not regenerated)', async () => {
    const u = await seedUser({ email: 'sess-keep@x' })
    const tok = await seedRefresh(u.id, { sessionId: 'sess-keep-1' })
    const r = await call(refreshReq({ token: tok }))
    expect(r.status).toBe(200)
    const rows = await env.chiyigo_db
      .prepare('SELECT session_id, revoked_at FROM refresh_tokens WHERE user_id=? ORDER BY id')
      .bind(u.id).all()
    expect(rows.results).toHaveLength(2)
    expect(rows.results[0].revoked_at).not.toBeNull()        // old row revoked
    expect(rows.results[1].revoked_at).toBeNull()            // new rotated row live
    expect(rows.results[1].session_id).toBe('sess-keep-1')   // PRESERVED across rotation, not a fresh uuid
  })

  it('rotation HEALS a NULL session_id row (legacy / deploy-gap) to a fresh non-null id', async () => {
    const u = await seedUser({ email: 'sess-heal@x' })
    const tok = await seedRefresh(u.id, { sessionId: null })  // pre-5d-1b legacy / migrate->deploy gap row
    const r = await call(refreshReq({ token: tok }))
    expect(r.status).toBe(200)
    const rows = await env.chiyigo_db
      .prepare('SELECT session_id FROM refresh_tokens WHERE user_id=? ORDER BY id')
      .bind(u.id).all()
    expect(rows.results).toHaveLength(2)
    expect(rows.results[0].session_id).toBeNull()             // old gap row keeps its NULL (only revoked_at set)
    expect(rows.results[1].session_id).toBeTruthy()           // new row HEALED to a non-null id (?? crypto.randomUUID())
    expect(String(rows.results[1].session_id)).not.toContain(':')  // delimiter-safe (a UUID, no colon)
  })

  it('PR5 5d-2 §1.5 reuse: an already-revoked token → 401 + NO new head (gated INSERT inserts nothing)', async () => {
    const u = await seedUser({ email: 'rot-reuse@x' })
    const tok = await seedRefresh(u.id, { revoked: true })
    const r = await call(refreshReq({ token: tok }))
    expect(r.status).toBe(401)
    expect(r.body.code).toBe('REFRESH_TOKEN_REVOKED')
    const n = await env.chiyigo_db.prepare('SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id=?').bind(u.id).first()
    expect(n.n).toBe(1)  // only the seeded revoked row — the atomic rotation created NO new live head
  })
})

// Fork 2 Route B — rotation-orphan grace classification (docs/reviews/fork2-rotation-grace-plan.md).
// A token revoked BY A ROTATION (successor_token_hash set) + same device + LIVE successor + within REFRESH_GRACE_SECONDS
// is a benign orphan -> recorded as auth.refresh.grace_orphan (a distinct SECURITY_SIGNAL, owner-ratified 1b), NOT the
// false auth.refresh.fail/reuse_detected. No token is issued (still 401). Every other case keeps reuse_detected, and the
// revoked/grace path NEVER family-revokes nor spends the victim quota on a wrong-device replay.
describe('POST /api/auth/refresh — Fork 2 Route B rotation-orphan grace', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  // seed a live successor + the just-revoked predecessor pointing at it; returns the predecessor plaintext.
  async function seedOrphanPair(userId, {
    device = 'dev-x', revokedSecondsAgo = 5, successorRevoked = false, successorExpired = false,
  }: { device?: string | null; revokedSecondsAgo?: number; successorRevoked?: boolean; successorExpired?: boolean } = {}) {
    const successorPlain = await seedRefresh(userId, { deviceUuid: device, revoked: successorRevoked, expired: successorExpired })
    const successorHash  = await hashToken(successorPlain)
    return await seedRefresh(userId, { deviceUuid: device, revokedSecondsAgo, successorTokenHash: successorHash })
  }
  async function countAudit(userId, eventType) {
    const r = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ? AND event_type = ?`)
      .bind(userId, eventType).first<{ n: number }>()
    return r?.n ?? 0
  }
  async function refreshQuotaUsed(userId) {
    const r = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE kind='refresh' AND user_id = ?`)
      .bind(userId).first<{ n: number }>()
    return r?.n ?? 0
  }

  it('benign orphan (same device, live successor, within window) → grace_orphan, NOT reuse_detected, 401', async () => {
    const u = await seedUser({ email: 'graceA@x' })
    const pred = await seedOrphanPair(u.id)
    const r = await call(refreshReq({ token: pred, headers: { 'X-Device-Id': 'dev-x' } }))
    expect(r.status).toBe(401)
    expect(r.body.code).toBe('REFRESH_TOKEN_REVOKED')      // no token issued (Route B does not resurrect)
    expect(await countAudit(u.id, 'auth.refresh.grace_orphan')).toBe(1)
    expect(await countAudit(u.id, 'auth.refresh.fail')).toBe(0)  // crucial: NOT the false token-theft signal
  })

  it('out-of-window replay → reuse_detected (not grace_orphan)', async () => {
    const u = await seedUser({ email: 'graceB@x' })
    const pred = await seedOrphanPair(u.id, { revokedSecondsAgo: 120 })  // > 30s window
    const r = await call(refreshReq({ token: pred, headers: { 'X-Device-Id': 'dev-x' } }))
    expect(r.status).toBe(401)
    expect(await countAudit(u.id, 'auth.refresh.grace_orphan')).toBe(0)
    expect(await countAudit(u.id, 'auth.refresh.fail')).toBe(1)
  })

  it('revoked by logout/admin (successor_token_hash NULL) → reuse_detected, never grace_orphan', async () => {
    const u = await seedUser({ email: 'graceC@x' })
    // revoked WITHIN window but NO successor_token_hash (= revoked by logout/admin/device-mismatch, not rotation)
    const pred = await seedRefresh(u.id, { deviceUuid: 'dev-x', revokedSecondsAgo: 5 })
    const r = await call(refreshReq({ token: pred, headers: { 'X-Device-Id': 'dev-x' } }))
    expect(r.status).toBe(401)
    expect(await countAudit(u.id, 'auth.refresh.grace_orphan')).toBe(0)
    expect(await countAudit(u.id, 'auth.refresh.fail')).toBe(1)
  })

  it('dead successor (chain advanced / session ended) → reuse_detected, not grace_orphan', async () => {
    const u = await seedUser({ email: 'graceD@x' })
    const pred = await seedOrphanPair(u.id, { successorRevoked: true })
    const r = await call(refreshReq({ token: pred, headers: { 'X-Device-Id': 'dev-x' } }))
    expect(r.status).toBe(401)
    expect(await countAudit(u.id, 'auth.refresh.grace_orphan')).toBe(0)
    expect(await countAudit(u.id, 'auth.refresh.fail')).toBe(1)
  })

  it('device mismatch on a revoked candidate → grace_device_mismatch, NO family-revoke, NO quota (round-2 H + round-3)', async () => {
    const u = await seedUser({ email: 'graceE@x' })
    const pred = await seedOrphanPair(u.id, { device: 'dev-x' })
    const r = await call(refreshReq({ token: pred, headers: { 'X-Device-Id': 'dev-evil' } }))
    expect(r.status).toBe(401)
    expect(r.body.code).toBe('REFRESH_TOKEN_REVOKED')
    const fail = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE user_id=? AND event_type='auth.refresh.fail'`)
      .bind(u.id).first<{ event_data: string }>()
    expect(fail).not.toBeNull()
    expect(JSON.parse(fail!.event_data).reason_code).toBe('grace_device_mismatch')
    expect(await countAudit(u.id, 'auth.refresh.grace_orphan')).toBe(0)
    // round-2 H regression: an already-revoked token MUST NOT family-revoke the live successor session.
    const live = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id=? AND device_uuid='dev-x' AND revoked_at IS NULL`)
      .bind(u.id).first<{ n: number }>()
    expect(live?.n).toBe(1)  // the successor is untouched
    // round-3: a wrong-device replay must NOT consume the victim's refresh quota (device check is before rate-limit).
    expect(await refreshQuotaUsed(u.id)).toBe(0)
  })

  it('device-null revoked candidate → reuse_detected (cannot confirm same device)', async () => {
    const u = await seedUser({ email: 'graceF@x' })
    const successorPlain = await seedRefresh(u.id, { deviceUuid: null })
    const successorHash  = await hashToken(successorPlain)
    const pred = await seedRefresh(u.id, { deviceUuid: null, revokedSecondsAgo: 5, successorTokenHash: successorHash })
    const req = new Request('http://x/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': `chiyigo_refresh=${pred}` },
      body: '{}',
    })
    const resp = await refreshHandler({ request: req, env })
    expect(resp.status).toBe(401)
    expect(await countAudit(u.id, 'auth.refresh.grace_orphan')).toBe(0)
    expect(await countAudit(u.id, 'auth.refresh.fail')).toBe(1)
  })

  it('rotation stamps successor_token_hash on the revoked old row (= the new live row token_hash)', async () => {
    const u = await seedUser({ email: 'graceG@x' })
    const tok = await seedRefresh(u.id, { deviceUuid: 'dev-rot' })
    const r = await call(refreshReq({ token: tok, headers: { 'X-Device-Id': 'dev-rot' } }))
    expect(r.status).toBe(200)
    const rows = await env.chiyigo_db
      .prepare('SELECT token_hash, revoked_at, successor_token_hash FROM refresh_tokens WHERE user_id=? ORDER BY id')
      .bind(u.id).all()
    expect(rows.results).toHaveLength(2)
    const oldRow = rows.results[0]
    const newRow = rows.results[1]
    expect(oldRow.revoked_at).not.toBeNull()
    expect(newRow.revoked_at).toBeNull()
    expect(oldRow.successor_token_hash).toBe(newRow.token_hash)  // old row points to the new live row
    expect(newRow.successor_token_hash).toBeNull()               // the new live row has no successor yet
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

// helper：以 raw body string 構造 refresh request（避開 refreshReq 的 JSON.stringify）
function rawRefreshReq(origin: string | null, rawBody: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (origin) headers['Origin'] = origin
  return new Request('http://x/api/auth/refresh', {
    method: 'POST',
    headers,
    body: rawBody,
  })
}

describe('POST /api/auth/refresh — anonymous web probe (P3 noise reduction)', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('chiyigo.com 主站 + 無 cookie + body {} → 204 + 不寫 audit / 不消 rate-limit', async () => {
    const req = rawRefreshReq('https://chiyigo.com', '{}')
    const resp = await refreshHandler({ request: req, env })
    expect(resp.status).toBe(204)
    expect(resp.headers.get('Cache-Control')).toBe('no-store')

    // observability invariant 1：probe 不污染 audit log
    const audit = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE event_type LIKE 'auth.refresh%'`)
      .first<{ n: number }>()
    expect(audit?.n).toBe(0)

    // observability invariant 2：probe 不消 rate-limit quota
    // 鎖 gate 必須在 checkRateLimit / recordRateLimit 之前；防未來 refactor 偷消 quota
    const rl = await env.chiyigo_db
      .prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE kind = 'refresh'`)
      .first<{ n: number }>()
    expect(rl?.n).toBe(0)
  })

  it('chiyigo.com + body {refresh_token: ""} → 400（空字串不是 probe）', async () => {
    const r = await call(refreshReq({
      headers: { 'Origin': 'https://chiyigo.com' },
      body: { refresh_token: '' },
    }))
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('chiyigo.com + malformed JSON body → 400（parse fail 不是 probe）', async () => {
    const req = rawRefreshReq('https://chiyigo.com', 'not-json')
    const r = await call(req)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('chiyigo.com + body {refresh_token: 123} → 400（非 string field 不是 probe）', async () => {
    const r = await call(refreshReq({
      headers: { 'Origin': 'https://chiyigo.com' },
      body: { refresh_token: 123 as unknown as string },
    }))
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('chiyigo.com + body {"foo":"bar"} → 400（non-empty object 不是 probe）', async () => {
    const req = rawRefreshReq('https://chiyigo.com', '{"foo":"bar"}')
    const r = await call(req)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('chiyigo.com + body [] → 400（array 不是 probe）', async () => {
    const req = rawRefreshReq('https://chiyigo.com', '[]')
    const r = await call(req)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('無 Origin（App caller）+ body {} → 400（不改 App 行為）', async () => {
    const req = rawRefreshReq(null, '{}')
    const r = await call(req)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('evil.com（非 allowlist）+ body {} → 400', async () => {
    const req = rawRefreshReq('https://evil.com', '{}')
    const r = await call(req)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('sport-app-web.pages.dev（allowlist 非 chiyigo）+ body {} → 400', async () => {
    const req = rawRefreshReq('https://sport-app-web.pages.dev', '{}')
    const r = await call(req)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('mbti.chiyigo.com（chiyigo subdomain 非主站）+ body {} → 400', async () => {
    const req = rawRefreshReq('https://mbti.chiyigo.com', '{}')
    const r = await call(req)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })

  it('talo.chiyigo.com（chiyigo subdomain 非主站）+ body {} → 400', async () => {
    const req = rawRefreshReq('https://talo.chiyigo.com', '{}')
    const r = await call(req)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('REFRESH_TOKEN_REQUIRED')
  })
})
