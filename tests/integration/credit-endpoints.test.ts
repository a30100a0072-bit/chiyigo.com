/**
 * PR3 Credit Wallet endpoint integration tests (plan §10 tests 18-22).
 *
 *  - POST /api/admin/billing/wallets/:tenantId/topup     (step-up wallet_topup + admin:billing:wallet)
 *  - POST /api/admin/billing/wallets/:tenantId/adjust    (step-up wallet_adjust + admin:billing:wallet)
 *  - PUT  /api/admin/billing/quotas/:tenantId/:productId (step-up quota_set + admin:billing:wallet)
 *  - GET  /api/tenants/:tenantId/wallet                  (regular token + tenant guard + billing-role)
 *
 * 驗：auth 雙閘 / 嚴格 body allowlist（含 occurred_at 拒）/ server-derived actor / outcome→HTTP /
 *     per-user rate limit（billing_wallet）/ GET wallet billing-role gate + cross-tenant 拒。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  resetDb, ensureJwtKeys, seedUser, seedTenant, seedMembership, seedProduct, seedWallet, seedQuota,
} from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { buildTokenScope } from '../../functions/utils/scopes'
import { onRequestPost as topupHandler } from '../../functions/api/admin/billing/wallets/[tenantId]/topup'
import { onRequestPost as adjustHandler } from '../../functions/api/admin/billing/wallets/[tenantId]/adjust'
import { onRequestPut as quotaHandler } from '../../functions/api/admin/billing/quotas/[tenantId]/[productId]'
import { onRequestGet as walletHandler } from '../../functions/api/tenants/[tenantId]/wallet'

const db = env.chiyigo_db

beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })

async function accessToken(userId: number, role = 'player', email = 'u@x.io') {
  return signJwt({ sub: String(userId), email, role, status: 'active', ver: 0, scope: buildTokenScope(role) }, '15m', env, { audience: 'chiyigo' })
}
async function stepUp(userId: number, opts: { scope?: string; action?: string; role?: string; email?: string } = {}) {
  const { scope = 'elevated:billing', action = 'wallet_topup', role = 'admin', email = 'admin@x.io' } = opts
  return signJwt(
    { sub: String(userId), email, role, status: 'active', ver: 0, scope, for_action: action, amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
    '5m', env, { audience: 'chiyigo' },
  )
}
function call(handler: (ctx: unknown) => unknown, request: Request, params: Record<string, string> = {}) {
  return handler({ request, env, params, waitUntil: () => {}, next: async () => new Response('next'), data: {} }) as Promise<Response>
}
function post(url: string, token: string, body: unknown) {
  return new Request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}
function put(url: string, token: string, body: unknown) {
  return new Request(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

async function setup() {
  const admin = await seedUser({ email: 'admin@x.io', role: 'admin' })
  const t = await seedTenant({ type: 'organization', name: 'Acme' })
  await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
  return { adminId: admin.id, tenantId: t.id, productId: 'erp' }
}
async function ledgerCount(tenantId: number) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM credit_ledger WHERE tenant_id = ?`).bind(tenantId).first()
  return r ? Number(r.c) : 0
}
async function qclCount(tenantId: number) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM quota_config_ledger WHERE tenant_id = ?`).bind(tenantId).first()
  return r ? Number(r.c) : 0
}
async function auditExists(eventType: string) {
  const r = await db.prepare(`SELECT 1 AS x FROM audit_log WHERE event_type = ? LIMIT 1`).bind(eventType).first()
  return !!r
}
async function auditCount(eventType: string) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE event_type = ?`).bind(eventType).first()
  return r ? Number(r.c) : 0
}
const TOPUP = (t: number) => `http://localhost/api/admin/billing/wallets/${t}/topup`
const ADJUST = (t: number) => `http://localhost/api/admin/billing/wallets/${t}/adjust`
const QUOTA = (t: number, p: string) => `http://localhost/api/admin/billing/quotas/${t}/${p}`
const WALLET = (t: number) => `http://localhost/api/tenants/${t}/wallet`

// ───────────────────────────── topup happy + outcome mapping ─────────────────

describe('POST topup — happy + server actor', () => {
  it('topup → 200 applied; server-derived actor; audit; balance set', async () => {
    const { adminId, tenantId } = await setup()
    const r = await call(topupHandler, post(TOPUP(tenantId), await stepUp(adminId), { amount: 100, admin_idempotency_key: 't1' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j).toMatchObject({ ok: true, tenant_id: tenantId, balance: 100 })
    const row = await db.prepare(`SELECT actor_id, actor_email, actor_role, entry_type FROM credit_ledger WHERE tenant_id = ?`).bind(tenantId).first()
    expect(row).toMatchObject({ actor_id: adminId, actor_email: 'admin@x.io', actor_role: 'admin', entry_type: 'topup' })
    expect(await auditExists('billing.credit.topup')).toBe(true)
  })

  it('replay → 200 replay (no second row); conflict → 409', async () => {
    const { adminId, tenantId } = await setup()
    await call(topupHandler, post(TOPUP(tenantId), await stepUp(adminId), { amount: 100, admin_idempotency_key: 'K' }), { tenantId: String(tenantId) })
    const r2 = await call(topupHandler, post(TOPUP(tenantId), await stepUp(adminId), { amount: 100, admin_idempotency_key: 'K' }), { tenantId: String(tenantId) })
    expect(r2.status).toBe(200)
    expect((await r2.json()).replay).toBe(true)
    expect(await ledgerCount(tenantId)).toBe(1)
    const r3 = await call(topupHandler, post(TOPUP(tenantId), await stepUp(adminId), { amount: 200, admin_idempotency_key: 'K' }), { tenantId: String(tenantId) })
    expect(r3.status).toBe(409)
    expect((await r3.json()).code).toBe('IDEMPOTENCY_CONFLICT')
  })
})

// ───────────────────────────── strict body + actor spoof ─────────────────────

describe('POST topup — strict body', () => {
  it('client-supplied occurred_at → 400, no row', async () => {
    const { adminId, tenantId } = await setup()
    const r = await call(topupHandler, post(TOPUP(tenantId), await stepUp(adminId), { amount: 10, admin_idempotency_key: 'a', occurred_at: '2020-01-01T00:00:00.000Z' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('ERR_VALIDATION')
    expect(await ledgerCount(tenantId)).toBe(0)
  })
  it('client cannot spoof actor (actor_id field) → 400', async () => {
    const { adminId, tenantId } = await setup()
    const r = await call(topupHandler, post(TOPUP(tenantId), await stepUp(adminId), { amount: 10, admin_idempotency_key: 'a', actor_id: 999 }), { tenantId: String(tenantId) })
    expect(r.status).toBe(400)
    expect(await ledgerCount(tenantId)).toBe(0)
  })
})

// ───────────────────────────── auth gates (all admin endpoints) ──────────────

describe('admin endpoints — auth gates', () => {
  it('topup: regular access token (no step-up) → 403', async () => {
    const { adminId, tenantId } = await setup()
    const r = await call(topupHandler, post(TOPUP(tenantId), await accessToken(adminId, 'admin', 'admin@x.io'), { amount: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(403)
    expect(await ledgerCount(tenantId)).toBe(0)
  })
  it('topup: wrong elevated scope (elevated:payment) → 403', async () => {
    const { adminId, tenantId } = await setup()
    const tok = await stepUp(adminId, { scope: 'elevated:payment', action: 'wallet_topup' })
    const r = await call(topupHandler, post(TOPUP(tenantId), tok, { amount: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(403)
  })
  it('topup: wrong for_action → 403', async () => {
    const { adminId, tenantId } = await setup()
    const tok = await stepUp(adminId, { action: 'wallet_adjust' })
    const r = await call(topupHandler, post(TOPUP(tenantId), tok, { amount: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(403)
  })
  it('topup: step-up but role=player (no admin:billing:wallet) → 403 INSUFFICIENT_SCOPE + denied audit', async () => {
    const { tenantId } = await setup()
    const player = await seedUser({ email: 'p@x.io', role: 'player' })
    const tok = await stepUp(player.id, { role: 'player', email: 'p@x.io' })
    const r = await call(topupHandler, post(TOPUP(tenantId), tok, { amount: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('INSUFFICIENT_SCOPE')
    expect(await auditExists('billing.credit.denied')).toBe(true)
  })
  it('adjust: wrong for_action (wallet_topup) → 403', async () => {
    const { adminId, tenantId } = await setup()
    await seedWallet({ tenantId, balance: 100 })
    const tok = await stepUp(adminId, { action: 'wallet_topup' })
    const r = await call(adjustHandler, post(ADJUST(tenantId), tok, { amount: 10, direction: 'debit', admin_idempotency_key: 'a', reason: 'x' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(403)
  })
  it('quota: wrong for_action (wallet_topup) → 403', async () => {
    const { adminId, tenantId, productId } = await setup()
    const tok = await stepUp(adminId, { action: 'wallet_topup' })
    const r = await call(quotaHandler, put(QUOTA(tenantId, productId), tok, { quota_limit: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId), productId })
    expect(r.status).toBe(403)
  })
})

// ───────────────────────────── adjust outcomes ───────────────────────────────

describe('POST adjust — outcomes', () => {
  it('debit applied → 200; debit beyond balance → 402 INSUFFICIENT_BALANCE', async () => {
    const { adminId, tenantId } = await setup()
    await seedWallet({ tenantId, balance: 50 })
    const r1 = await call(adjustHandler, post(ADJUST(tenantId), await stepUp(adminId, { action: 'wallet_adjust' }), { amount: 20, direction: 'debit', admin_idempotency_key: 'a1', reason: 'correction' }), { tenantId: String(tenantId) })
    expect(r1.status).toBe(200)
    expect((await r1.json()).balance).toBe(30)
    const r2 = await call(adjustHandler, post(ADJUST(tenantId), await stepUp(adminId, { action: 'wallet_adjust' }), { amount: 999, direction: 'debit', admin_idempotency_key: 'a2', reason: 'too much' }), { tenantId: String(tenantId) })
    expect(r2.status).toBe(402)
    expect((await r2.json()).code).toBe('INSUFFICIENT_BALANCE')
  })
  it('adjust against missing wallet → 409 WALLET_NOT_PROVISIONED', async () => {
    const { adminId, tenantId } = await setup()
    const r = await call(adjustHandler, post(ADJUST(tenantId), await stepUp(adminId, { action: 'wallet_adjust' }), { amount: 10, direction: 'credit', admin_idempotency_key: 'a', reason: 'x' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('WALLET_NOT_PROVISIONED')
  })
})

// ───────────────────────────── quota outcomes ────────────────────────────────

describe('PUT quota — outcomes + durable idempotency', () => {
  it('set → 200; durable idempotency: retry → 200 replay:true (no 2nd qcl row, no 2nd billing.quota.set); diff → 409', async () => {
    const { adminId, tenantId, productId } = await setup()
    const r1 = await call(quotaHandler, put(QUOTA(tenantId, productId), await stepUp(adminId, { action: 'quota_set' }), { quota_limit: 50, admin_idempotency_key: 'K' }), { tenantId: String(tenantId), productId })
    expect(r1.status).toBe(200)
    const j1 = await r1.json()
    expect(j1.quota_limit).toBe(50)
    expect(j1.replay).toBeUndefined() // first set is a real apply, not a replay
    // identical retry → 200 replay:true; codex Gate-2: must carry replay flag AND not re-emit billing.quota.set
    const r2 = await call(quotaHandler, put(QUOTA(tenantId, productId), await stepUp(adminId, { action: 'quota_set' }), { quota_limit: 50, admin_idempotency_key: 'K' }), { tenantId: String(tenantId), productId })
    expect(r2.status).toBe(200)
    const j2 = await r2.json()
    expect(j2.replay).toBe(true)
    expect(j2.quota_limit).toBe(50)
    expect(await qclCount(tenantId)).toBe(1)              // no 2nd authoritative row
    expect(await auditCount('billing.quota.set')).toBe(1) // replay did NOT re-emit the "quota was set" event
    expect(await auditExists('billing.credit.idempotent_replay')).toBe(true)
    // same key, different limit → 409 conflict
    const r3 = await call(quotaHandler, put(QUOTA(tenantId, productId), await stepUp(adminId, { action: 'quota_set' }), { quota_limit: 60, admin_idempotency_key: 'K' }), { tenantId: String(tenantId), productId })
    expect(r3.status).toBe(409)
    expect((await r3.json()).code).toBe('IDEMPOTENCY_CONFLICT')
    expect(await auditCount('billing.quota.set')).toBe(1) // still only the one real set
  })
  it('lower below current usage → 409 QUOTA_BELOW_USAGE', async () => {
    const { adminId, tenantId, productId } = await setup()
    await seedQuota({ tenantId, productId, quotaLimit: 20, quotaUsed: 15 })
    const r = await call(quotaHandler, put(QUOTA(tenantId, productId), await stepUp(adminId, { action: 'quota_set' }), { quota_limit: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId), productId })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('QUOTA_BELOW_USAGE')
  })
  it('non-lifetime period → 400 UNSUPPORTED_PERIOD', async () => {
    const { adminId, tenantId, productId } = await setup()
    const r = await call(quotaHandler, put(QUOTA(tenantId, productId), await stepUp(adminId, { action: 'quota_set' }), { quota_limit: 10, admin_idempotency_key: 'a', period: '2026-06' }), { tenantId: String(tenantId), productId })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('UNSUPPORTED_PERIOD')
  })
})

// ───────────────────────────── per-user rate limit ───────────────────────────

describe('per-user rate limit (billing_wallet)', () => {
  async function fillBucket(userId: number, n: number) {
    for (let i = 0; i < n; i++) {
      await db.prepare(`INSERT INTO login_attempts (kind, user_id) VALUES ('billing_wallet', ?)`).bind(userId).run()
    }
  }
  it('at cap (30) → next op 429, no write, denial audited', async () => {
    const { adminId, tenantId } = await setup()
    await fillBucket(adminId, 30)
    const r = await call(topupHandler, post(TOPUP(tenantId), await stepUp(adminId), { amount: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(429)
    expect((await r.json()).code).toBe('RATE_LIMITED')
    expect(await ledgerCount(tenantId)).toBe(0)
    const audit = await db.prepare(`SELECT event_data FROM audit_log WHERE event_type = 'billing.credit.denied' ORDER BY id DESC LIMIT 1`).first()
    expect(String(audit?.event_data)).toContain('rate_limited')
  })
  it('under cap (29) → proceeds 200', async () => {
    const { adminId, tenantId } = await setup()
    await fillBucket(adminId, 29)
    const r = await call(topupHandler, post(TOPUP(tenantId), await stepUp(adminId), { amount: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(200)
  })
  it('per-user isolation: second admin unaffected', async () => {
    const { adminId, tenantId } = await setup()
    await fillBucket(adminId, 30)
    const admin2 = await seedUser({ email: 'admin2@x.io', role: 'admin' })
    const r = await call(topupHandler, post(TOPUP(tenantId), await stepUp(admin2.id, { email: 'admin2@x.io' }), { amount: 10, admin_idempotency_key: 'a' }), { tenantId: String(tenantId) })
    expect(r.status).toBe(200)
  })
})

// ───────────────────────────── GET wallet ────────────────────────────────────

describe('GET /api/tenants/:tenantId/wallet', () => {
  it('owner → 200 with {wallet, quotas}; no ledger/version leak', async () => {
    const owner = await seedUser({ email: 'o@x.io', role: 'player' })
    const t = await seedTenant({ type: 'organization', name: 'Org' })
    await seedMembership({ tenantId: t.id, userId: owner.id, role: 'tenant_owner', status: 'active' })
    await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
    await seedWallet({ tenantId: t.id, balance: 42 })
    await seedQuota({ tenantId: t.id, productId: 'erp', quotaLimit: 100, quotaUsed: 10 })
    const r = await call(walletHandler, new Request(WALLET(t.id), { headers: { Authorization: `Bearer ${await accessToken(owner.id, 'player', 'o@x.io')}` } }), { tenantId: String(t.id) })
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.wallet).toEqual({ balance: 42 })
    expect(j.quotas).toEqual([{ product_id: 'erp', period: 'lifetime', quota_limit: 100, quota_used: 10 }])
  })
  it('not provisioned → wallet:null (distinct from balance:0)', async () => {
    const owner = await seedUser({ email: 'o2@x.io', role: 'player' })
    const t = await seedTenant({ type: 'organization', name: 'Org2' })
    await seedMembership({ tenantId: t.id, userId: owner.id, role: 'tenant_owner', status: 'active' })
    const r = await call(walletHandler, new Request(WALLET(t.id), { headers: { Authorization: `Bearer ${await accessToken(owner.id, 'player', 'o2@x.io')}` } }), { tenantId: String(t.id) })
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.wallet).toBeNull()
    expect(j.quotas).toEqual([])
  })
  it('plain member → 403 INSUFFICIENT_PLATFORM_ROLE (billing-role gate)', async () => {
    const m = await seedUser({ email: 'm@x.io', role: 'player' })
    const t = await seedTenant({ type: 'organization', name: 'Org3' })
    await seedMembership({ tenantId: t.id, userId: m.id, role: 'member', status: 'active' })
    await seedWallet({ tenantId: t.id, balance: 99 })
    const r = await call(walletHandler, new Request(WALLET(t.id), { headers: { Authorization: `Bearer ${await accessToken(m.id, 'player', 'm@x.io')}` } }), { tenantId: String(t.id) })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('INSUFFICIENT_PLATFORM_ROLE')
  })
  it('billing_admin → 200 (allowed billing role)', async () => {
    const ba = await seedUser({ email: 'ba@x.io', role: 'player' })
    const t = await seedTenant({ type: 'organization', name: 'Org4' })
    await seedMembership({ tenantId: t.id, userId: ba.id, role: 'billing_admin', status: 'active' })
    await seedWallet({ tenantId: t.id, balance: 7 })
    const r = await call(walletHandler, new Request(WALLET(t.id), { headers: { Authorization: `Bearer ${await accessToken(ba.id, 'player', 'ba@x.io')}` } }), { tenantId: String(t.id) })
    expect(r.status).toBe(200)
    expect((await r.json()).wallet).toEqual({ balance: 7 })
  })
  it('cross-tenant (non-member) → 403', async () => {
    const userB = await seedUser({ email: 'b@x.io', role: 'player' })
    const tB = await seedTenant({ type: 'organization', name: 'B' })
    await seedMembership({ tenantId: tB.id, userId: userB.id, role: 'tenant_owner', status: 'active' })
    const tA = await seedTenant({ type: 'organization', name: 'A' }) // userB not a member
    await seedWallet({ tenantId: tA.id, balance: 999 })
    const r = await call(walletHandler, new Request(WALLET(tA.id), { headers: { Authorization: `Bearer ${await accessToken(userB.id, 'player', 'b@x.io')}` } }), { tenantId: String(tA.id) })
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('TENANT_ACCESS_DENIED')
  })
  it('bad tenantId → 400', async () => {
    const u = await seedUser({ email: 'z@x.io', role: 'player' })
    const r = await call(walletHandler, new Request(WALLET(0), { headers: { Authorization: `Bearer ${await accessToken(u.id, 'player', 'z@x.io')}` } }), { tenantId: 'abc' })
    expect(r.status).toBe(400)
  })
})
