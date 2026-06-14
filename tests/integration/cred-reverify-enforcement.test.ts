/**
 * OD-3 credential requires_reverification enforcement — integration tests.
 *
 * Plan: docs/audit/cred-reverify-enforcement-plan.md §12 (Dimension-A x4 + ChatGPT Arch + Codex Plan APPROVED).
 * Grown incrementally across the PR's implementation steps.
 *   step 4: me.ts identities DTO exposes the row id (= stable credential_id; APIC-IDENTITY-1).
 *   step 5: self-service reverify (/api/auth/credential/reverify) + admin clear endpoints.
 *
 * NOTE: seedUser() already creates a local_accounts row with password PW (and no TOTP). So a "password account"
 * is just seedUser; enableTotp() promotes it to a 2FA account; removeLocalAccount() makes it OAuth-only.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser } from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { hashToken } from '../../functions/utils/crypto'
import { clearReverificationFlag } from '../../functions/utils/credential-reverification'
import { onRequestGet as meHandler } from '../../functions/api/auth/me'
import { onRequestPost as reverifyHandler } from '../../functions/api/auth/credential/reverify'
import { onRequestPost as adminClearHandler } from '../../functions/api/admin/credential-reverification/clear'
import { onRequestGet as initHandler } from '../../functions/api/auth/oauth/[provider]/init'

const PW = 'OldPass#1234'   // seedUser() default password

beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })

// ── tokens ───────────────────────────────────────────────────────────────
async function regularToken(userId: number, email = 'u@x'): Promise<string> {
  return signJwt({ sub: String(userId), email, role: 'player', status: 'active', ver: 0, scope: 'read:profile' }, '15m', env, { audience: 'chiyigo' })
}
async function adminStepUpToken(userId: number, scope = 'elevated:account admin:users:write', role = 'admin'): Promise<string> {
  return signJwt(
    { sub: String(userId), email: 'a@x', role, status: 'active', ver: 0, scope, for_action: 'credential_reverification_clear', amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
    '5m', env, { audience: 'chiyigo' },
  )
}

// ── account shape mutators (seedUser already made a password-only local_accounts row) ──
async function enableTotp(userId: number, secret = 'S'): Promise<void> {
  await env.chiyigo_db.prepare(`UPDATE local_accounts SET totp_enabled=1, totp_secret=? WHERE user_id=?`).bind(secret, userId).run()
}
async function removeLocalAccount(userId: number): Promise<void> {
  await env.chiyigo_db.prepare(`DELETE FROM local_accounts WHERE user_id=?`).bind(userId).run()
}
async function seedBackupCode(userId: number, code: string): Promise<void> {
  await env.chiyigo_db.prepare(`INSERT INTO backup_codes (user_id, code_hash) VALUES (?, ?)`).bind(userId, await hashToken(code)).run()
}

// ── credential seeds ─────────────────────────────────────────────────────
async function seedIdentity(userId: number, provider: string, providerId: string, opts: { flagged?: boolean; reason?: string | null } = {}): Promise<number> {
  await env.chiyigo_db
    .prepare(`INSERT INTO user_identities (user_id, provider, provider_id, requires_reverification, disposition_reason) VALUES (?, ?, ?, ?, ?)`)
    .bind(userId, provider, providerId, opts.flagged ? 1 : 0, opts.reason ?? null).run()
  const row = await env.chiyigo_db.prepare(`SELECT id FROM user_identities WHERE user_id=? AND provider=? AND provider_id=?`).bind(userId, provider, providerId).first()
  return Number(row?.id)
}
async function seedPasskey(userId: number, credId: string, opts: { flagged?: boolean; reason?: string | null } = {}): Promise<number> {
  await env.chiyigo_db
    .prepare(`INSERT INTO user_webauthn_credentials (user_id, credential_id, public_key, requires_reverification, disposition_reason) VALUES (?, ?, 'pk', ?, ?)`)
    .bind(userId, credId, opts.flagged ? 1 : 0, opts.reason ?? null).run()
  const row = await env.chiyigo_db.prepare(`SELECT id FROM user_webauthn_credentials WHERE credential_id=?`).bind(credId).first()
  return Number(row?.id)
}
async function seedWallet(userId: number, address: string, opts: { flagged?: boolean; reason?: string | null } = {}): Promise<number> {
  await env.chiyigo_db
    .prepare(`INSERT INTO user_wallets (user_id, address, requires_reverification, disposition_reason) VALUES (?, ?, ?, ?)`)
    .bind(userId, address, opts.flagged ? 1 : 0, opts.reason ?? null).run()
  const row = await env.chiyigo_db.prepare(`SELECT id FROM user_wallets WHERE user_id=? AND address=?`).bind(userId, address).first()
  return Number(row?.id)
}

// ── calls / reads ──────────────────────────────────────────────────────────
function postReq(path: string, token: string, body: object): Request {
  return new Request(`http://x${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
async function callReverify(token: string, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  const resp = await reverifyHandler({ request: postReq('/api/auth/credential/reverify', token, body), env })
  return { status: resp.status, body: (await resp.json()) as Record<string, unknown> }
}
async function callAdminClear(token: string, body: object): Promise<{ status: number; body: Record<string, unknown> }> {
  const resp = await adminClearHandler({ request: postReq('/api/admin/credential-reverification/clear', token, body), env })
  return { status: resp.status, body: (await resp.json()) as Record<string, unknown> }
}
async function flagOf(table: string, id: number): Promise<{ flag: number; reason: unknown }> {
  const r = await env.chiyigo_db.prepare(`SELECT requires_reverification AS r, disposition_reason AS d FROM ${table} WHERE id=?`).bind(id).first()
  return { flag: Number(r?.r), reason: r?.d }
}
async function clearAudits(): Promise<Array<{ severity: unknown; coldClass: unknown; data: Record<string, unknown> }>> {
  const r = await env.chiyigo_db.prepare(`SELECT severity, event_data, cold_class FROM audit_log WHERE event_type='account.credential.reverification_cleared' ORDER BY id ASC`).all()
  return ((r.results ?? []) as Array<Record<string, unknown>>).map((x) => ({ severity: x.severity, coldClass: x.cold_class, data: JSON.parse(String(x.event_data ?? '{}')) as Record<string, unknown> }))
}

interface MeBody { identities: Array<Record<string, unknown>> }
async function callMe(token: string): Promise<{ status: number; body: MeBody }> {
  const resp = await meHandler({ request: new Request('http://x/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }), env })
  return { status: resp.status, body: (await resp.json()) as MeBody }
}
function firstIdentity(body: MeBody): Record<string, unknown> {
  const it0 = body.identities[0]
  if (!it0) throw new Error('expected at least one identity in /me DTO')
  return it0
}

// ═══ step 4 — me.ts identities DTO credential_id exposure (APIC-IDENTITY-1) ═══
describe('OD-3 step 4 — me.ts identities DTO credential_id exposure (APIC-IDENTITY-1)', () => {
  it('(1) identities DTO includes the row id (= stable credential_id for self-reverify)', async () => {
    const u = await seedUser({ email: 'id@x' })
    const idId = await seedIdentity(u.id, 'google', 'g-sub-1')
    const { status, body } = await callMe(await regularToken(u.id, 'id@x'))
    expect(status).toBe(200)
    expect(body.identities).toHaveLength(1)
    expect(firstIdentity(body).id).toBe(idId)
  })
  it('(2) flagged identity still surfaces requires_reverification + publicReasonCode (unknown_context -> needs_review)', async () => {
    const u = await seedUser({ email: 'fl@x' })
    await seedIdentity(u.id, 'discord', 'd-sub-1', { flagged: true, reason: 'unknown_context' })
    const it0 = firstIdentity((await callMe(await regularToken(u.id, 'fl@x'))).body)
    expect(it0.requires_reverification).toBe(true)
    expect(it0.disposition_reason).toBe('needs_review')
  })
  it('(3) does NOT expose provider_id / raw subject — only the existing public contract + id', async () => {
    const u = await seedUser({ email: 'pi@x' })
    await seedIdentity(u.id, 'google', 'SECRET-PROVIDER-ID-123')
    const it0 = firstIdentity((await callMe(await regularToken(u.id, 'pi@x'))).body)
    expect(it0).not.toHaveProperty('provider_id')
    expect(JSON.stringify(it0)).not.toContain('SECRET-PROVIDER-ID-123')
    expect(Object.keys(it0).sort()).toEqual(['id', 'provider', 'display_name', 'avatar_url', 'linked_at', 'requires_reverification', 'disposition_reason'].sort())
  })
  it('(4) unflagged identity behavior unchanged (flag false, reason null, id numeric)', async () => {
    const u = await seedUser({ email: 'un@x' })
    await seedIdentity(u.id, 'line', 'l-sub-1')
    const it0 = firstIdentity((await callMe(await regularToken(u.id, 'un@x'))).body)
    expect(it0.requires_reverification).toBe(false)
    expect(it0.disposition_reason).toBe(null)
    expect(typeof it0.id).toBe('number')
  })
})

// ═══ step 5 — self-service reverify (/api/auth/credential/reverify) ═══
describe('OD-3 step 5 — self reverify', () => {
  it('password account + valid password (unknown_context identity) -> cleared:true, flag 0, disposition preserved, audit(self/password)', async () => {
    const u = await seedUser({ email: 'a@x' })
    const idId = await seedIdentity(u.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const r = await callReverify(await regularToken(u.id), { type: 'identity', credential_id: idId, password: PW })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, cleared: true })
    const f = await flagOf('user_identities', idId)
    expect(f.flag).toBe(0)
    expect(f.reason).toBe('unknown_context')   // OD-CLEAR=A: disposition_reason preserved
    const a = (await clearAudits())[0]
    expect(a?.severity).toBe('info')
    expect(a?.data.actor_type).toBe('self')
    expect(a?.data.clear_method).toBe('password')
    expect(a?.data.credential_tier).toBe('unknown_context')
    expect(a?.data.pre_clear_reason).toBe('unknown_context')
    expect(a?.data.result).toBe('cleared')
  })
  it('TOTP account + valid backup code (passkey) -> cleared:true, clear_method backup_code', async () => {
    const u = await seedUser({ email: 'b@x' })
    await enableTotp(u.id)
    await seedBackupCode(u.id, 'abcdef0123456789abcd')   // 20-hex
    const pkId = await seedPasskey(u.id, 'c1', { flagged: true, reason: 'unknown_context' })
    const r = await callReverify(await regularToken(u.id), { type: 'passkey', credential_id: pkId, backup_code: 'abcdef0123456789abcd' })
    expect(r.body).toEqual({ ok: true, cleared: true })
    expect((await flagOf('user_webauthn_credentials', pkId)).flag).toBe(0)
    expect((await clearAudits())[0]?.data.clear_method).toBe('backup_code')
  })
  it('wrong password -> 401 PROOF_FAILED, flag stays 1, no clear audit', async () => {
    const u = await seedUser({ email: 'c@x' })
    const idId = await seedIdentity(u.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const r = await callReverify(await regularToken(u.id), { type: 'identity', credential_id: idId, password: 'WRONG' })
    expect(r.status).toBe(401)
    expect(r.body.code).toBe('CREDENTIAL_REVERIFICATION_PROOF_FAILED')
    expect((await flagOf('user_identities', idId)).flag).toBe(1)
    expect(await clearAudits()).toHaveLength(0)
  })
  it('anti-downgrade: TOTP-enabled account sending password -> 403 NO_TRUSTED_CHANNEL, flag stays 1', async () => {
    const u = await seedUser({ email: 'd@x' })
    await enableTotp(u.id)
    const idId = await seedIdentity(u.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const r = await callReverify(await regularToken(u.id), { type: 'identity', credential_id: idId, password: PW })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL')
    expect((await flagOf('user_identities', idId)).flag).toBe(1)
  })
  it('OAuth-only (no local_accounts) -> 403 NO_TRUSTED_CHANNEL', async () => {
    const u = await seedUser({ email: 'e@x' })
    await removeLocalAccount(u.id)
    const idId = await seedIdentity(u.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const r = await callReverify(await regularToken(u.id), { type: 'identity', credential_id: idId, password: 'whatever' })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CREDENTIAL_REVERIFICATION_NO_TRUSTED_CHANNEL')
  })
  it('tier-gate: high-risk credential -> 403 HIGH_RISK (even with valid proof), flag stays 1, no audit', async () => {
    const u = await seedUser({ email: 'f@x' })
    const pkId = await seedPasskey(u.id, 'c1', { flagged: true, reason: 'high:auth.new_device' })
    const r = await callReverify(await regularToken(u.id), { type: 'passkey', credential_id: pkId, password: PW })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CREDENTIAL_REVERIFICATION_HIGH_RISK')
    expect((await flagOf('user_webauthn_credentials', pkId)).flag).toBe(1)
    expect(await clearAudits()).toHaveLength(0)
  })
  it('wallet self-reverify denied at schema -> 400 ERR_VALIDATION', async () => {
    const u = await seedUser({ email: 'g@x' })
    const wId = await seedWallet(u.id, '0xabc', { flagged: true, reason: 'unknown_context' })
    const r = await callReverify(await regularToken(u.id), { type: 'wallet', credential_id: wId, password: PW })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('ERR_VALIDATION')
  })
  it('unflagged credential -> 403 CREDENTIAL_NOT_FLAGGED', async () => {
    const u = await seedUser({ email: 'h@x' })
    const idId = await seedIdentity(u.id, 'google', 'g1')   // not flagged
    const r = await callReverify(await regularToken(u.id), { type: 'identity', credential_id: idId, password: PW })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CREDENTIAL_NOT_FLAGGED')
  })
  it('other-user credential id -> 403 CREDENTIAL_NOT_FLAGGED (user-scoped, no tier leak)', async () => {
    const victim = await seedUser({ email: 'v@x' })
    const vId = await seedIdentity(victim.id, 'google', 'gv', { flagged: true, reason: 'high:auth.new_device' })
    const attacker = await seedUser({ email: 'at@x' })
    const r = await callReverify(await regularToken(attacker.id), { type: 'identity', credential_id: vId, password: PW })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('CREDENTIAL_NOT_FLAGGED')   // NOT high_risk -> tier not leaked
    expect((await flagOf('user_identities', vId)).flag).toBe(1)
  })
  it('token-class: temp_bind token -> 403 NOT_A_REGULAR_TOKEN, flag untouched', async () => {
    const u = await seedUser({ email: 'tb@x' })
    const idId = await seedIdentity(u.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const tempBind = await signJwt({ sub: '999', provider: 'discord', scope: 'temp_bind' }, '10m', env)
    const r = await callReverify(tempBind, { type: 'identity', credential_id: idId, password: PW })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('NOT_A_REGULAR_TOKEN')
    expect((await flagOf('user_identities', idId)).flag).toBe(1)
  })
  it('token-class: elevated:* step-up token -> 403 NOT_A_REGULAR_TOKEN', async () => {
    const u = await seedUser({ email: 'el@x' })
    const idId = await seedIdentity(u.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const stepUp = await signJwt({ sub: String(u.id), status: 'active', ver: 0, scope: 'elevated:account', for_action: 'x', amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' }, '5m', env, { audience: 'chiyigo' })
    const r = await callReverify(stepUp, { type: 'identity', credential_id: idId, password: PW })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('NOT_A_REGULAR_TOKEN')
  })
  it('banned user (live re-check) -> 403 ACCOUNT_BANNED even with stale active token', async () => {
    const u = await seedUser({ email: 'bn@x' })
    await env.chiyigo_db.prepare(`UPDATE users SET status='banned' WHERE id=?`).bind(u.id).run()
    const idId = await seedIdentity(u.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const r = await callReverify(await regularToken(u.id), { type: 'identity', credential_id: idId, password: PW })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('ACCOUNT_BANNED')
  })
})

// ═══ step 5 — admin clear (/api/admin/credential-reverification/clear) ═══
describe('OD-3 step 5 — admin clear', () => {
  it('double-gate + valid -> cleared:true, flag 0, audit(admin/admin_clear, severity warn for unknown)', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const victim = await seedUser({ email: 'v@x' })
    const idId = await seedIdentity(victim.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const r = await callAdminClear(await adminStepUpToken(admin.id), { type: 'identity', credential_id: idId, reason: 'support: owner-confirmed self-owned' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, cleared: true })
    expect((await flagOf('user_identities', idId)).flag).toBe(0)
    const a = (await clearAudits())[0]
    expect(a?.severity).toBe('warn')
    expect(a?.coldClass).toBe('security_warn')
    expect(a?.data.actor_type).toBe('admin')
    expect(a?.data.clear_method).toBe('admin_clear')
    expect(a?.data.admin_actor).toBe(admin.id)
    expect(a?.data.reason).toBe('support: owner-confirmed self-owned')
  })
  it('admin clear of high-risk -> severity critical / cold_class security_critical', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const victim = await seedUser({ email: 'v@x' })
    const pkId = await seedPasskey(victim.id, 'c-high', { flagged: true, reason: 'high:multi_factor_burst' })
    await callAdminClear(await adminStepUpToken(admin.id), { type: 'passkey', credential_id: pkId, reason: 'incident review' })
    const a = (await clearAudits())[0]
    expect(a?.severity).toBe('critical')
    expect(a?.coldClass).toBe('security_critical')
    expect(a?.data.credential_tier).toBe('high')
  })
  it('admin wallet clear -> cleared:true + audit dormant:true', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const victim = await seedUser({ email: 'v@x' })
    const wId = await seedWallet(victim.id, '0xabc', { flagged: true, reason: 'unknown_context' })
    const r = await callAdminClear(await adminStepUpToken(admin.id), { type: 'wallet', credential_id: wId, reason: 'wallet dormant clear' })
    expect(r.body).toEqual({ ok: true, cleared: true })
    expect((await clearAudits())[0]?.data.dormant).toBe(true)
  })
  it('no step-up (regular token) -> rejected (not 200), flag untouched', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const victim = await seedUser({ email: 'v@x' })
    const idId = await seedIdentity(victim.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const plain = await signJwt({ sub: String(admin.id), role: 'admin', status: 'active', ver: 0, scope: 'admin:users:write' }, '15m', env, { audience: 'chiyigo' })
    const r = await callAdminClear(plain, { type: 'identity', credential_id: idId, reason: 'x' })
    expect(r.status).toBe(403)
    expect((await flagOf('user_identities', idId)).flag).toBe(1)
  })
  it('step-up but no admin:users:write -> 403 INSUFFICIENT_SCOPE', async () => {
    const u = await seedUser({ email: 'p@x', role: 'player' })
    const victim = await seedUser({ email: 'v@x' })
    const idId = await seedIdentity(victim.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const tok = await adminStepUpToken(u.id, 'elevated:account', 'player')   // role matches DB (no drift); no admin:users:write
    const r = await callAdminClear(tok, { type: 'identity', credential_id: idId, reason: 'x' })
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('INSUFFICIENT_SCOPE')
  })
  it('already-clear credential -> idempotent cleared:false, no new audit', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const victim = await seedUser({ email: 'v@x' })
    const idId = await seedIdentity(victim.id, 'google', 'g1')   // flag already 0
    const r = await callAdminClear(await adminStepUpToken(admin.id), { type: 'identity', credential_id: idId, reason: 'noop' })
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ ok: true, cleared: false })
    expect(await clearAudits()).toHaveLength(0)
  })
  it('not-found credential id -> 404 CREDENTIAL_NOT_FOUND', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const r = await callAdminClear(await adminStepUpToken(admin.id), { type: 'identity', credential_id: 999999, reason: 'x' })
    expect(r.status).toBe(404)
    expect(r.body.code).toBe('CREDENTIAL_NOT_FOUND')
  })
  it('body user_id is rejected by strict schema (not trusted) -> 400 ERR_VALIDATION', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const victim = await seedUser({ email: 'v@x' })
    const idId = await seedIdentity(victim.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const r = await callAdminClear(await adminStepUpToken(admin.id), { type: 'identity', credential_id: idId, reason: 'x', user_id: 1 })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('ERR_VALIDATION')
  })
  it('missing reason -> 400 ERR_VALIDATION', async () => {
    const admin = await seedUser({ email: 'adm@x', role: 'admin' })
    const victim = await seedUser({ email: 'v@x' })
    const idId = await seedIdentity(victim.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const r = await callAdminClear(await adminStepUpToken(admin.id), { type: 'identity', credential_id: idId })
    expect(r.status).toBe(400)
    expect(r.body.code).toBe('ERR_VALIDATION')
  })
})

// ═══ step 5 — clear-core CAS loser (Codex Plan P2: no success audit on changes=0) ═══
describe('OD-3 step 5 — clearReverificationFlag CAS loser', () => {
  it('second clear of an already-cleared row -> cleared:false, NO second audit', async () => {
    const u = await seedUser({ email: 'cas@x' })
    const idId = await seedIdentity(u.id, 'google', 'g1', { flagged: true, reason: 'unknown_context' })
    const first = await clearReverificationFlag(env, { type: 'identity', id: idId, userId: u.id, actorType: 'self', clearMethod: 'password', request: new Request('http://x') })
    expect(first.cleared).toBe(true)
    const second = await clearReverificationFlag(env, { type: 'identity', id: idId, userId: u.id, actorType: 'self', clearMethod: 'password', request: new Request('http://x') })
    expect(second.cleared).toBe(false)
    expect(await clearAudits()).toHaveLength(1)   // only the winner emitted
  })
})

// step 6 — init.ts supplementary early block (plan §6.3): elevation OAuth-reauth init refuses to
// start the roundtrip when every bound identity for the provider is flagged (belt-and-suspenders ahead of 5a).
describe('OD-3 — init elevation requires_reverification early block', () => {
  beforeAll(() => { Object.assign(env, { GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsec' }) })
  async function elevToken(userId: number): Promise<string> {
    return signJwt({ sub: String(userId), email: 'u@x', role: 'player', status: 'active', ver: 0, scope: 'read:profile', sid: 'SID-1' }, '15m', env, { audience: 'chiyigo' })
  }
  function callInit(token: string, provider = 'google', qs = 'purpose=elevation&action=add_passkey') {
    return initHandler({
      request: new Request(`http://x/api/auth/oauth/${provider}/init?${qs}`, { headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '1.2.3.4' } }),
      env, params: { provider }, waitUntil: () => {}, data: {}, next: async () => new Response('next'),
    })
  }

  it('all identities for provider flagged -> 403 CREDENTIAL_REVERIFICATION_REQUIRED, no oauth_states written', async () => {
    const u = await seedUser({ email: 'i1@x' })
    await seedIdentity(u.id, 'google', 'g-flag', { flagged: true, reason: 'unknown_context' })
    const res = await callInit(await elevToken(u.id))
    const body = await res.json() as Record<string, unknown>
    expect(res.status).toBe(403)
    expect(body.code).toBe('CREDENTIAL_REVERIFICATION_REQUIRED')
    // block precedes PKCE/state persistence -> no roundtrip started
    const st = await env.chiyigo_db.prepare(`SELECT COUNT(*) AS c FROM oauth_states WHERE elevation_user_id=?`).bind(u.id).first()
    expect(Number(st.c)).toBe(0)
  })

  it('a non-flagged identity exists for provider -> proceeds (200 + redirect_url) [regression]', async () => {
    const u = await seedUser({ email: 'i2@x' })
    await seedIdentity(u.id, 'google', 'g-ok', { flagged: false })
    const res = await callInit(await elevToken(u.id))
    const body = await res.json() as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(typeof body.redirect_url).toBe('string')
  })
})
