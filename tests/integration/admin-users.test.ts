/**
 * Stage 3 PR-15b — admin/users security integration tests
 *
 * Coverage（review focus 在「授權、階層、撤 token、audit-before-mutate」是否鎖死）：
 *
 *  GET  /api/admin/users
 *   - 401 missing token
 *   - 403 INSUFFICIENT_SCOPE（player without admin scopes）
 *   - 200 admin role（role base scopes 自動含 ADMIN_USERS coarse → :read fine）
 *   - 200 player + explicit admin:users:read scope claim
 *   - 200 player + explicit admin:users:write scope claim（write 也接受 per requireAnyScope）
 *   - filter status='banned' / role / q
 *   - pagination
 *
 *  POST /api/admin/users/:id/ban
 *   - 401 missing token
 *   - 403 INSUFFICIENT_ROLE（player）
 *   - 400 CANNOT_TARGET_SELF
 *   - 403 CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE（admin→admin & admin→developer）
 *   - 403 UNKNOWN_TARGET_ROLE + critical audit_log row
 *   - 404 USER_NOT_FOUND
 *   - 400 USER_ALREADY_BANNED
 *   - happy: status='banned' + token_version+1 + 所有 active refresh revoked
 *           + admin_audit_log row + audit_log(admin.user.banned, critical)
 *   - 500 AUDIT_CHAIN_FAILED 時 status / token_version / refresh 全不動
 *
 *  POST /api/admin/users/:id/unban
 *   - 403 INSUFFICIENT_ROLE（player）
 *   - 400 USER_NOT_BANNED
 *   - 403 CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE
 *   - 403 UNKNOWN_TARGET_ROLE + critical audit_log row
 *   - happy: status='active' + admin_audit_log + audit_log(admin.user.unbanned, critical)
 *   - 500 AUDIT_CHAIN_FAILED 時 status 保持 'banned'
 *
 * 設計說明 — 為何沒有 ban/unban 的 INSUFFICIENT_SCOPE negative case：
 *   ban.ts / unban.ts 先跑 requireRole('admin')，admin/super_admin/developer 三個 role
 *   的 ROLE_BASE_SCOPES 都含 ADMIN_USERS coarse → 經 expandHierarchy 自動具備
 *   ADMIN_USERS_WRITE fine。任何「夠 role 但缺 write scope」的 canonical token
 *   實際不存在；scope 守門是 defense-in-depth，留給未來 finance/support 等窄
 *   role 升級到 level≥2 時生效。player + explicit write scope 則先被 requireRole
 *   擋成 INSUFFICIENT_ROLE。已用 list endpoint（純 requireAnyScope, 無 role gate）
 *   覆蓋 scope-claim 行為驗證。
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { hashToken, generateSecureToken } from '../../functions/utils/crypto'
import { onRequestGet as listHandler } from '../../functions/api/admin/users'
import { onRequestPost as banHandler } from '../../functions/api/admin/users/[id]/ban'
import { onRequestPost as unbanHandler } from '../../functions/api/admin/users/[id]/unban'
import { onRequestPost as consumerHandler } from '../../functions/api/admin/cron/event-outbox'

// ── helpers ────────────────────────────────────────────────────────

async function tokenFor(userId, role = 'admin', extra = {}) {
  return signJwt({
    sub: String(userId), email: `${role}@x`, role, status: 'active', ver: 0, ...extra,
  }, '15m', env, { audience: 'chiyigo' })
}

function listReq(token, query = '') {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  return new Request(`http://x/api/admin/users${query}`, { headers })
}

function banReq(token, id, body = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request(`http://x/api/admin/users/${id}/ban`, {
    method: 'POST', headers, body: JSON.stringify(body),
  })
}

function unbanReq(token, id) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request(`http://x/api/admin/users/${id}/unban`, {
    method: 'POST', headers, body: '{}',
  })
}

async function callList(token, query = '') {
  const resp = await listHandler({ request: listReq(token, query), env })
  return { status: resp.status, body: await resp.json() }
}

async function callBan(token, id) {
  const resp = await banHandler({ request: banReq(token, id), env, params: { id: String(id) } })
  return { status: resp.status, body: await resp.json() }
}

async function callUnban(token, id) {
  const resp = await unbanHandler({ request: unbanReq(token, id), env, params: { id: String(id) } })
  return { status: resp.status, body: await resp.json() }
}

async function seedRefresh(userId, deviceUuid = null) {
  const plain = generateSecureToken()
  const hash  = await hashToken(plain)
  const exp   = new Date(Date.now() + 7 * 86400_000).toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at)
              VALUES (?, ?, ?, ?)`)
    .bind(userId, hash, deviceUuid, exp).run()
}

async function setStatus(userId, status) {
  await env.chiyigo_db.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, userId).run()
}

async function setRole(userId, role) {
  await env.chiyigo_db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(role, userId).run()
}

// ── PR5 5c helpers — account.* emission + the (unchanged, type-agnostic) 5b consumer for the e2e path ──
async function accountOutbox(targetId) {
  const r = await env.chiyigo_db
    .prepare(`SELECT event_type, stream_seq, tenant_id, actor_sub, data_json FROM event_outbox
              WHERE stream_key = ? ORDER BY stream_seq`)
    .bind(`account:${targetId}`).all()
  return r.results ?? []
}
async function accountSeq(targetId) {
  const r = await env.chiyigo_db
    .prepare(`SELECT last_seq FROM event_stream_sequences WHERE stream_key = ?`)
    .bind(`account:${targetId}`).first()
  return r ? r.last_seq : null
}
async function emittedAuditCount() {
  const r = await env.chiyigo_db
    .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE event_type = 'domain.event.emitted'`).first()
  return Number(r.c)
}
async function runConsumer() {
  const req = new Request('http://x/api/admin/cron/event-outbox', {
    method: 'POST', headers: { Authorization: 'Bearer test-cron-secret', 'Content-Type': 'application/json' },
  })
  return consumerHandler({ request: req, env })
}

// ── tests ──────────────────────────────────────────────────────────

describe('GET /api/admin/users', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒帶 token → 401', async () => {
    const r = await callList(null)
    expect(r.status).toBe(401)
  })

  it('player 無 admin scope → 403 INSUFFICIENT_SCOPE', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const tok = await tokenFor(id, 'player')
    const r = await callList(tok)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_SCOPE')
  })

  it('admin role → 200（role base scopes 自動展開 ADMIN_USERS_READ）', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedUser({ email: 'u1@x' })
    const r = await callList(await tokenFor(id, 'admin'))
    expect(r.status).toBe(200)
    expect(Array.isArray(r.body.users)).toBe(true)
    expect(r.body.total).toBeGreaterThanOrEqual(2)
  })

  it('player + explicit admin:users:read scope claim → 200', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const tok = await tokenFor(id, 'player', { scope: 'admin:users:read' })
    const r = await callList(tok)
    expect(r.status).toBe(200)
  })

  it('player + explicit admin:users:write scope claim → 200（write 亦接受）', async () => {
    const { id } = await seedUser({ email: 'p@x' })
    const tok = await tokenFor(id, 'player', { scope: 'admin:users:write' })
    const r = await callList(tok)
    expect(r.status).toBe(200)
  })

  it('filter status=banned 只回 banned + filter role=developer', async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: bId } = await seedUser({ email: 'banned@x' })
    await setStatus(bId, 'banned')
    await seedUser({ email: 'active1@x' })
    await seedUser({ email: 'devops@x', role: 'developer' })

    const tok = await tokenFor(adminId, 'admin')

    const banned = await callList(tok, '?status=banned')
    expect(banned.status).toBe(200)
    expect(banned.body.users.every(u => u.status === 'banned')).toBe(true)
    expect(banned.body.users.some(u => u.email === 'banned@x')).toBe(true)

    const devs = await callList(tok, '?role=developer')
    expect(devs.body.users.every(u => u.role === 'developer')).toBe(true)

  })

  // ── q filter（PR-15c 修 ESCAPE 後新增 / regression）─────────────
  it('q filter 正向：substring match by email', async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedUser({ email: 'devops@x', role: 'developer' })
    await seedUser({ email: 'frontend@x' })
    const tok = await tokenFor(adminId, 'admin')

    const r = await callList(tok, '?q=devops')
    expect(r.status).toBe(200)
    expect(r.body.users.some(u => u.email === 'devops@x')).toBe(true)
    expect(r.body.users.some(u => u.email === 'frontend@x')).toBe(false)
  })

  it('q filter escape `%`：literal 百分號不被當 wildcard', async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedUser({ email: 'pct%user@x' })
    // PR-15c-nit：對照組 — 若 `%` 未 escape 會被當 wildcard，pattern `pct<any>user`
    // 會誤命中 pctXuser@x；escape 正確時只命中 literal pct%user@x。
    await seedUser({ email: 'pctXuser@x' })
    await seedUser({ email: 'normaluser@x' })
    const tok = await tokenFor(adminId, 'admin')

    const r = await callList(tok, `?q=${encodeURIComponent('pct%user')}`)
    expect(r.status).toBe(200)
    expect(r.body.users.some(u => u.email === 'pct%user@x')).toBe(true)
    expect(r.body.users.some(u => u.email === 'pctXuser@x')).toBe(false)
    expect(r.body.users.some(u => u.email === 'normaluser@x')).toBe(false)
  })

  it('q filter escape `_`：literal 底線不被當 single-char wildcard', async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedUser({ email: 'a_b@x' })  // literal underscore
    await seedUser({ email: 'axb@x' })  // 若 _ 沒 escape 會誤命中
    const tok = await tokenFor(adminId, 'admin')

    const r = await callList(tok, `?q=${encodeURIComponent('a_b')}`)
    expect(r.status).toBe(200)
    expect(r.body.users.some(u => u.email === 'a_b@x')).toBe(true)
    expect(r.body.users.some(u => u.email === 'axb@x')).toBe(false)
  })

  it('q filter escape `\\`：literal 反斜線通過 escape 配對（ESCAPE 1 字元解回）', async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedUser({ email: 'a\\b@x' })
    await seedUser({ email: 'normal@x' })
    const tok = await tokenFor(adminId, 'admin')

    const r = await callList(tok, `?q=${encodeURIComponent('a\\b')}`)
    expect(r.status).toBe(200)
    expect(r.body.users.some(u => u.email === 'a\\b@x')).toBe(true)
    expect(r.body.users.some(u => u.email === 'normal@x')).toBe(false)
  })

  it('q filter `_` 單字元不會 dump 全表（escape 生效後 _ 是 literal）', async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    await seedUser({ email: 'no_under@x' })
    await seedUser({ email: 'plain@x' })
    const tok = await tokenFor(adminId, 'admin')

    const r = await callList(tok, '?q=_')
    expect(r.status).toBe(200)
    expect(r.body.users.some(u => u.email === 'no_under@x')).toBe(true)
    expect(r.body.users.some(u => u.email === 'plain@x')).toBe(false)
    expect(r.body.users.some(u => u.email === 'a@x')).toBe(false)
  })

  it('pagination limit + page', async () => {
    const { id: adminId } = await seedUser({ email: 'a@x', role: 'admin' })
    for (let i = 0; i < 5; i++) await seedUser({ email: `u${i}@x` })
    const tok = await tokenFor(adminId, 'admin')

    const p1 = await callList(tok, '?limit=2&page=1')
    expect(p1.body.users.length).toBe(2)
    expect(p1.body.page).toBe(1)
    expect(p1.body.limit).toBe(2)
    expect(p1.body.total).toBeGreaterThanOrEqual(6)
  })
})

describe('POST /api/admin/users/:id/ban', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('沒帶 token → 401', async () => {
    const { id } = await seedUser({ email: 't@x' })
    const resp = await banHandler({
      request: new Request(`http://x/api/admin/users/${id}/ban`, { method: 'POST', body: '{}' }),
      env, params: { id: String(id) },
    })
    expect(resp.status).toBe(401)
  })

  it('player → 403 INSUFFICIENT_ROLE', async () => {
    const { id: pid } = await seedUser({ email: 'p@x' })
    const { id: tid } = await seedUser({ email: 't@x' })
    const r = await callBan(await tokenFor(pid, 'player'), tid)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_ROLE')
  })

  it('封自己 → 400 CANNOT_TARGET_SELF', async () => {
    const { id } = await seedUser({ email: 'a@x', role: 'admin' })
    const r = await callBan(await tokenFor(id, 'admin'), id)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('CANNOT_TARGET_SELF')
  })

  it('admin 封同層 admin → 403 CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE', async () => {
    const { id: a1 } = await seedUser({ email: 'a1@x', role: 'admin' })
    const { id: a2 } = await seedUser({ email: 'a2@x', role: 'admin' })
    const r = await callBan(await tokenFor(a1, 'admin'), a2)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE')
  })

  it('admin 封 developer（更高層）→ 403', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: did } = await seedUser({ email: 'd@x', role: 'developer' })
    const r = await callBan(await tokenFor(aid, 'admin'), did)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE')
  })

  it('unknown target role → 403 UNKNOWN_TARGET_ROLE + critical audit_log', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await setRole(tid, 'rogue_role')
    const r = await callBan(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('UNKNOWN_TARGET_ROLE')

    const audit = await env.chiyigo_db
      .prepare(`SELECT event_type, severity FROM audit_log
                WHERE event_type = 'admin.unknown_role_target' AND user_id = ?`)
      .bind(tid).first()
    expect(audit).toBeTruthy()
    expect(audit.severity).toBe('critical')

    const target = await env.chiyigo_db
      .prepare('SELECT status FROM users WHERE id = ?').bind(tid).first()
    expect(target.status).toBe('active')
  })

  it('target 不存在 → 404 USER_NOT_FOUND', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const r = await callBan(await tokenFor(aid, 'admin'), 999999)
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('USER_NOT_FOUND')
  })

  it('已被封禁 → 400 USER_ALREADY_BANNED', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await setStatus(tid, 'banned')
    const r = await callBan(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('USER_ALREADY_BANNED')
  })

  it('happy → status=banned + token_version+1 + active refresh 全 revoked + 雙 audit', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await seedRefresh(tid, 'dev-A')
    await seedRefresh(tid, 'dev-B')
    // 預先放一筆已 revoked refresh，驗 UPDATE 不會重複命中（仍只動 active）
    await env.chiyigo_db
      .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, device_uuid, expires_at, revoked_at)
                VALUES (?, ?, ?, datetime('now','+7 days'), datetime('now'))`)
      .bind(tid, await hashToken(generateSecureToken()), 'dev-old').run()

    const r = await callBan(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ user_id: tid, status: 'banned' })

    const userRow = await env.chiyigo_db
      .prepare('SELECT status, token_version FROM users WHERE id = ?').bind(tid).first()
    expect(userRow.status).toBe('banned')
    expect(userRow.token_version).toBe(1)

    const active = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .bind(tid).first()
    expect(active.c).toBe(0)

    const admLog = await env.chiyigo_db
      .prepare(`SELECT action, target_id FROM admin_audit_log
                WHERE target_id = ? AND action = 'ban'`).bind(tid).first()
    expect(admLog).toBeTruthy()
    expect(admLog.target_id).toBe(tid)

    const usrLog = await env.chiyigo_db
      .prepare(`SELECT event_type, severity FROM audit_log
                WHERE event_type = 'admin.user.banned' AND user_id = ?`).bind(tid).first()
    expect(usrLog).toBeTruthy()
    expect(usrLog.severity).toBe('critical')
  })

  it('audit chain fail（admin_audit_log dropped）→ 500 + status/token_version/refresh 全不動', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await seedRefresh(tid, 'dev-A')
    await env.chiyigo_db.prepare('DROP TABLE admin_audit_log').run()

    const r = await callBan(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(500)
    expect(r.body.code).toBe('AUDIT_CHAIN_FAILED')

    const userRow = await env.chiyigo_db
      .prepare('SELECT status, token_version FROM users WHERE id = ?').bind(tid).first()
    expect(userRow.status).toBe('active')
    expect(userRow.token_version).toBe(0)

    const active = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL')
      .bind(tid).first()
    expect(active.c).toBe(1)

    const usrLog = await env.chiyigo_db
      .prepare(`SELECT 1 FROM audit_log WHERE event_type = 'admin.user.banned' AND user_id = ?`)
      .bind(tid).first()
    expect(usrLog).toBeFalsy()
  })

  // ── PR5 5c: account.disabled emission ────────────────────────────────────
  it('happy ban emits ONE account.disabled (account:<sub>, seq 1, tenant null) + REDACTED domain.event.emitted', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    const r = await callBan(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(200)
    const rows = await accountOutbox(tid)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('account.disabled')
    expect(rows[0].stream_seq).toBe(1)
    expect(rows[0].tenant_id).toBeNull()
    expect(rows[0].actor_sub).toBe(String(aid))
    expect(JSON.parse(rows[0].data_json)).toEqual({ sub: String(tid) })
    // post-commit emitted audit, REDACTED: stream_key_hash present, raw `account:<tid>` NEVER logged
    const emitted = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE event_type = 'domain.event.emitted' ORDER BY id DESC LIMIT 1`).first()
    expect(emitted).toBeTruthy()
    expect(emitted.event_data).toContain('stream_key_hash')
    expect(emitted.event_data).not.toContain(`account:${tid}`)
  })

  it('already-banned ban emits NOTHING (no outbox row, no seq, no emitted audit)', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await setStatus(tid, 'banned')
    const r = await callBan(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('USER_ALREADY_BANNED')
    expect((await accountOutbox(tid)).length).toBe(0)
    expect(await accountSeq(tid)).toBeNull()
    expect(await emittedAuditCount()).toBe(0)
  })

  it('concurrent double-ban: EXACTLY one account.disabled, last_seq=1, token_version=1, all refresh revoked', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await seedRefresh(tid, 'dev-A'); await seedRefresh(tid, 'dev-B')
    const tok = await tokenFor(aid, 'admin')
    const [r1, r2] = await Promise.all([callBan(tok, tid), callBan(tok, tid)])
    // exactly one request wins the transition (the other 0-rows the CAS, or short-circuits at the pre-read)
    expect([r1.status, r2.status].filter(s => s === 200).length).toBe(1)
    // the FOUR lost-race invariants (owner Gate-1 code-gate lock)
    const rows = await accountOutbox(tid)
    expect(rows.length).toBe(1)                          // (1) EXACTLY one event
    expect(rows[0].event_type).toBe('account.disabled')
    expect(await accountSeq(tid)).toBe(1)                // (2) no second seq bump
    const u = await env.chiyigo_db.prepare('SELECT status, token_version FROM users WHERE id = ?').bind(tid).first()
    expect(u.status).toBe('banned')
    expect(u.token_version).toBe(1)                      // (3) +1 EXACTLY (the 0-row loser does not bump)
    const active = await env.chiyigo_db
      .prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL').bind(tid).first()
    expect(Number(active.c)).toBe(0)                     // (4) refresh tokens finally revoked
  })
})

describe('POST /api/admin/users/:id/unban', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('player → 403 INSUFFICIENT_ROLE', async () => {
    const { id: pid } = await seedUser({ email: 'p@x' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await setStatus(tid, 'banned')
    const r = await callUnban(await tokenFor(pid, 'player'), tid)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_ROLE')
  })

  it('target 並非 banned → 400 USER_NOT_BANNED', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })  // 預設 active
    const r = await callUnban(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('USER_NOT_BANNED')
  })

  it('解封同層 admin → 403 CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE', async () => {
    const { id: a1 } = await seedUser({ email: 'a1@x', role: 'admin' })
    const { id: a2 } = await seedUser({ email: 'a2@x', role: 'admin' })
    await setStatus(a2, 'banned')
    const r = await callUnban(await tokenFor(a1, 'admin'), a2)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CANNOT_TARGET_EQUAL_OR_HIGHER_ROLE')
  })

  it('unknown target role → 403 UNKNOWN_TARGET_ROLE + critical audit_log（action=unban）', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await setRole(tid, 'rogue_role')
    await setStatus(tid, 'banned')
    const r = await callUnban(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('UNKNOWN_TARGET_ROLE')

    const audit = await env.chiyigo_db
      .prepare(`SELECT severity, event_data FROM audit_log
                WHERE event_type = 'admin.unknown_role_target' AND user_id = ?`)
      .bind(tid).first()
    expect(audit).toBeTruthy()
    expect(audit.severity).toBe('critical')
    expect(audit.event_data).toContain('"action":"unban"')

    const target = await env.chiyigo_db
      .prepare('SELECT status FROM users WHERE id = ?').bind(tid).first()
    expect(target.status).toBe('banned')  // 不該被 mutate
  })

  it('happy → status=active + admin_audit_log + audit_log(admin.user.unbanned critical)', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await setStatus(tid, 'banned')

    const r = await callUnban(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ user_id: tid, status: 'active' })

    const userRow = await env.chiyigo_db
      .prepare('SELECT status FROM users WHERE id = ?').bind(tid).first()
    expect(userRow.status).toBe('active')

    const admLog = await env.chiyigo_db
      .prepare(`SELECT action FROM admin_audit_log WHERE target_id = ? AND action = 'unban'`)
      .bind(tid).first()
    expect(admLog).toBeTruthy()

    const usrLog = await env.chiyigo_db
      .prepare(`SELECT severity FROM audit_log
                WHERE event_type = 'admin.user.unbanned' AND user_id = ?`).bind(tid).first()
    expect(usrLog).toBeTruthy()
    expect(usrLog.severity).toBe('critical')
  })

  it('audit chain fail（admin_audit_log dropped）→ 500 + status 保持 banned', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await setStatus(tid, 'banned')
    await env.chiyigo_db.prepare('DROP TABLE admin_audit_log').run()

    const r = await callUnban(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(500)
    expect(r.body.code).toBe('AUDIT_CHAIN_FAILED')

    const userRow = await env.chiyigo_db
      .prepare('SELECT status FROM users WHERE id = ?').bind(tid).first()
    expect(userRow.status).toBe('banned')

    const usrLog = await env.chiyigo_db
      .prepare(`SELECT 1 FROM audit_log WHERE event_type = 'admin.user.unbanned' AND user_id = ?`)
      .bind(tid).first()
    expect(usrLog).toBeFalsy()
  })

  // ── PR5 5c: account.reenabled emission ───────────────────────────────────
  it('happy unban emits ONE account.reenabled (account:<sub>, seq 1, tenant null) + REDACTED domain.event.emitted', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    await setStatus(tid, 'banned')
    const r = await callUnban(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(200)
    const rows = await accountOutbox(tid)
    expect(rows.length).toBe(1)
    expect(rows[0].event_type).toBe('account.reenabled')
    expect(rows[0].tenant_id).toBeNull()
    expect(rows[0].actor_sub).toBe(String(aid))
    expect(JSON.parse(rows[0].data_json)).toEqual({ sub: String(tid) })
    const emitted = await env.chiyigo_db
      .prepare(`SELECT event_data FROM audit_log WHERE event_type = 'domain.event.emitted' ORDER BY id DESC LIMIT 1`).first()
    expect(emitted.event_data).toContain('stream_key_hash')
    expect(emitted.event_data).not.toContain(`account:${tid}`)
  })

  it('not-banned unban emits NOTHING (no outbox row, no seq)', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' }) // active
    const r = await callUnban(await tokenFor(aid, 'admin'), tid)
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('USER_NOT_BANNED')
    expect((await accountOutbox(tid)).length).toBe(0)
    expect(await accountSeq(tid)).toBeNull()
  })
})

describe('[PR5-5c] account.* end-to-end through the 5b consumer', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('ban then unban -> contiguous disabled(1)+reenabled(2); the type-agnostic consumer applies denied=1 then denied=0', async () => {
    const { id: aid } = await seedUser({ email: 'a@x', role: 'admin' })
    const { id: tid } = await seedUser({ email: 't@x' })
    const tok = await tokenFor(aid, 'admin')
    expect((await callBan(tok, tid)).status).toBe(200)
    expect((await callUnban(tok, tid)).status).toBe(200)
    // emit-level contiguity on the shared account:<sub> stream
    const rows = await accountOutbox(tid)
    expect(rows.map(r => r.event_type)).toEqual(['account.disabled', 'account.reenabled'])
    expect(rows.map(r => r.stream_seq)).toEqual([1, 2])
    // through the UNCHANGED 5b consumer: run 1 delivers seq 1 (deny), run 2 delivers seq 2 (undeny, contiguous)
    expect((await runConsumer()).status).toBe(200)
    expect((await runConsumer()).status).toBe(200)
    const proj = await env.chiyigo_db
      .prepare(`SELECT denied, last_applied_seq FROM event_deny_state WHERE stream_key = ?`)
      .bind(`account:${tid}`).first()
    expect(proj).toEqual({ denied: 0, last_applied_seq: 2 })
  })
})
