/**
 * PR2 Implementation Commit 4 — billing endpoint integration tests.
 *
 *  - POST /api/admin/billing/grant   (step-up elevated:billing + admin:billing:grant)
 *  - GET  /api/tenants/:tenantId/entitlements  (regular token + tenant guard)
 *
 * 驗：auth 雙閘 / 嚴格 body allowlist（含 occurred_at 拒）/ server-derived actor（client 不可偽造）/
 *     idempotency replay+conflict / offline evidence conflict / eligibility 映射 / audit emission /
 *     cross-tenant 讀拒 / route 不繞過 grantPlan 直寫。
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  resetDb, ensureJwtKeys, seedUser, seedTenant, seedMembership, seedProduct, seedPlan, seedEntitlement,
} from './_helpers'
import { signJwt } from '../../functions/utils/jwt'
import { buildTokenScope } from '../../functions/utils/scopes'
import { onRequestPost as grantHandler } from '../../functions/api/admin/billing/grant'
import { onRequestGet as entitlementsHandler } from '../../functions/api/tenants/[tenantId]/entitlements'

const db = env.chiyigo_db

beforeAll(async () => { await ensureJwtKeys() })
beforeEach(async () => { await resetDb() })

async function accessToken(userId: number, role = 'player', email = 'u@x.io') {
  return signJwt(
    { sub: String(userId), email, role, status: 'active', ver: 0, scope: buildTokenScope(role) },
    '15m', env, { audience: 'chiyigo' },
  )
}
async function stepUp(
  userId: number,
  opts: { scope?: string; action?: string; role?: string; email?: string } = {},
) {
  const { scope = 'elevated:billing', action = 'grant_plan', role = 'admin', email = 'admin@x.io' } = opts
  return signJwt(
    { sub: String(userId), email, role, status: 'active', ver: 0, scope, for_action: action, amr: ['pwd', 'totp'], acr: 'urn:chiyigo:loa:2' },
    '5m', env, { audience: 'chiyigo' },
  )
}

function call(handler: (ctx: unknown) => unknown, request: Request, params: Record<string, string> = {}) {
  return handler({ request, env, params, waitUntil: () => {}, next: async () => new Response('next'), data: {} }) as Promise<Response>
}
function postReq(token: string, body: unknown) {
  return new Request('http://localhost/api/admin/billing/grant', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function getReq(token: string, tenantId: number) {
  return new Request(`http://localhost/api/tenants/${tenantId}/entitlements`, {
    method: 'GET', headers: { Authorization: `Bearer ${token}` },
  })
}

async function setup() {
  const admin = await seedUser({ email: 'admin@x.io', role: 'admin' })
  const t = await seedTenant({ type: 'organization', name: 'Acme' })
  await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
  const plan = await seedPlan({ productId: 'erp', code: 'erp_basic', name: 'ERP Basic' })
  return { adminId: admin.id, tenantId: t.id, planId: plan.id }
}

async function ledgerCount(tenantId: number) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM grant_plan_operations WHERE tenant_id = ?`).bind(tenantId).first()
  return r ? r.c : 0
}
async function auditExists(eventType: string) {
  const r = await db.prepare(`SELECT 1 AS x FROM audit_log WHERE event_type = ? LIMIT 1`).bind(eventType).first()
  return !!r
}

function offlineBody(tenantId: number, planId: number, over: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId, product_id: 'erp', plan_id: planId,
    manual_source: 'offline_payment', admin_idempotency_key: 'idem-1', payment_ref: 'BANK-REF-1',
    ...over,
  }
}
function overrideBody(tenantId: number, planId: number, over: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId, product_id: 'erp', plan_id: planId,
    manual_source: 'admin_override', admin_idempotency_key: 'idem-1', grant_reason: 'goodwill comp',
    ...over,
  }
}

// ───────────────────────────── POST happy path ─────────────────────────────

describe('POST /api/admin/billing/grant — happy path', () => {
  it('offline_payment → 200 applied; ledger has SERVER-derived actor + canonical key; audit emitted', async () => {
    const { adminId, tenantId, planId } = await setup()
    const r = await call(grantHandler, postReq(await stepUp(adminId), offlineBody(tenantId, planId, { payment_ref: 'BANK-REF-1' })))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j).toMatchObject({ ok: true, status: 'active', version: 1, tenant_id: tenantId })

    const row = await db.prepare(
      `SELECT granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key, "trigger" AS trig
         FROM grant_plan_operations WHERE tenant_id = ?`,
    ).bind(tenantId).first()
    expect(row).toMatchObject({
      granted_by: adminId, granted_by_email: 'admin@x.io', granted_by_role: 'admin',
      payment_ref: 'BANK-REF-1', payment_ref_key: 'BANK-REF-1', trig: 'manual',
    })
    expect(await auditExists('billing.grant.applied')).toBe(true)
  })

  it('admin_override → 200 applied; reason stored, no payment_ref', async () => {
    const { adminId, tenantId, planId } = await setup()
    const r = await call(grantHandler, postReq(await stepUp(adminId), overrideBody(tenantId, planId)))
    expect(r.status).toBe(200)
    const row = await db.prepare(`SELECT grant_reason, payment_ref FROM grant_plan_operations WHERE tenant_id = ?`).bind(tenantId).first()
    expect(row).toMatchObject({ grant_reason: 'goodwill comp', payment_ref: null })
  })

  it('writes go through grantPlan (ledger has request_hash + prev_projection_version), no raw route INSERT', async () => {
    const { adminId, tenantId, planId } = await setup()
    await call(grantHandler, postReq(await stepUp(adminId), overrideBody(tenantId, planId, { admin_idempotency_key: 'k' })))
    const op = await db.prepare(`SELECT request_hash, prev_projection_version FROM grant_plan_operations WHERE tenant_id = ?`).bind(tenantId).first()
    expect(op?.request_hash).toBeTruthy()           // request_hash 只由 grantPlan 計算
    expect(op?.prev_projection_version).toBe(0)
    const proj = await db.prepare(`SELECT version FROM tenant_product_access WHERE tenant_id = ?`).bind(tenantId).first()
    expect(proj?.version).toBe(1)
  })
})

// ───────────────────────────── POST idempotency / evidence ─────────────────

describe('POST /api/admin/billing/grant — idempotency + evidence', () => {
  it('same key + same params → replay 200 (no second row); audit replay', async () => {
    const { adminId, tenantId, planId } = await setup()
    const body = offlineBody(tenantId, planId, { admin_idempotency_key: 'K', payment_ref: 'R-AAA' })
    const r1 = await call(grantHandler, postReq(await stepUp(adminId), body))
    expect(r1.status).toBe(200)
    const r2 = await call(grantHandler, postReq(await stepUp(adminId), body))
    expect(r2.status).toBe(200)
    expect((await r2.json()).replay).toBe(true)
    expect(await ledgerCount(tenantId)).toBe(1)
    expect(await auditExists('billing.grant.idempotent_replay')).toBe(true)
  })

  it('same key + different params → 409 IDEMPOTENCY_CONFLICT; audit conflict', async () => {
    const { adminId, tenantId, planId } = await setup()
    const otherPlan = await seedPlan({ productId: 'erp', code: 'erp_pro', name: 'Pro' })
    await call(grantHandler, postReq(await stepUp(adminId), offlineBody(tenantId, planId, { admin_idempotency_key: 'K', payment_ref: 'R-AAA' })))
    const r2 = await call(grantHandler, postReq(await stepUp(adminId), offlineBody(tenantId, otherPlan.id, { admin_idempotency_key: 'K', payment_ref: 'R-AAA' })))
    expect(r2.status).toBe(409)
    expect((await r2.json()).code).toBe('IDEMPOTENCY_CONFLICT')
    expect(await ledgerCount(tenantId)).toBe(1)
    expect(await auditExists('billing.grant.conflict')).toBe(true)
  })

  it('reused offline payment_ref (variant, different key) → 409 EVIDENCE_ALREADY_USED', async () => {
    const { adminId, tenantId, planId } = await setup()
    await call(grantHandler, postReq(await stepUp(adminId), offlineBody(tenantId, planId, { admin_idempotency_key: 'k1', payment_ref: 'ABC 123' })))
    const r2 = await call(grantHandler, postReq(await stepUp(adminId), offlineBody(tenantId, planId, { admin_idempotency_key: 'k2', payment_ref: 'abc123' })))
    expect(r2.status).toBe(409)
    expect((await r2.json()).code).toBe('EVIDENCE_ALREADY_USED')
    expect(await auditExists('billing.grant.evidence_conflict')).toBe(true)
  })
})

// ───────────────────────────── POST strict body + actor ────────────────────

describe('POST /api/admin/billing/grant — strict body + server actor', () => {
  it('client-supplied occurred_at → 400 ERR_VALIDATION, no row', async () => {
    const { adminId, tenantId, planId } = await setup()
    const r = await call(grantHandler, postReq(await stepUp(adminId),
      offlineBody(tenantId, planId, { payment_ref: 'R-1AB', occurred_at: '2020-01-01T00:00:00.000Z' })))
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('ERR_VALIDATION')
    expect(await ledgerCount(tenantId)).toBe(0)
  })

  it('arbitrary unknown field → 400, no row', async () => {
    const { adminId, tenantId, planId } = await setup()
    const r = await call(grantHandler, postReq(await stepUp(adminId), overrideBody(tenantId, planId, { foo: 'bar' })))
    expect(r.status).toBe(400)
    expect(await ledgerCount(tenantId)).toBe(0)
  })

  it('client cannot spoof actor: granted_by in body → 400 (unknown field)', async () => {
    const { adminId, tenantId, planId } = await setup()
    const r = await call(grantHandler, postReq(await stepUp(adminId), overrideBody(tenantId, planId, { granted_by: 999, actor: { id: 999 } })))
    expect(r.status).toBe(400)
    expect(await ledgerCount(tenantId)).toBe(0)
  })
})

// ───────────────────────────── POST auth gates ─────────────────────────────

describe('POST /api/admin/billing/grant — auth gates', () => {
  it('regular access token (no step-up) → 403', async () => {
    const { adminId, tenantId, planId } = await setup()
    const tok = await accessToken(adminId, 'admin', 'admin@x.io') // admin scopes but no elevated:billing
    const r = await call(grantHandler, postReq(tok, overrideBody(tenantId, planId)))
    expect(r.status).toBe(403)
    expect(await ledgerCount(tenantId)).toBe(0)
  })

  it('wrong elevated scope (elevated:payment) → 403', async () => {
    const { adminId, tenantId, planId } = await setup()
    const tok = await stepUp(adminId, { scope: 'elevated:payment', action: 'refund_payment' })
    const r = await call(grantHandler, postReq(tok, overrideBody(tenantId, planId)))
    expect(r.status).toBe(403)
  })

  it('wrong for_action → 403', async () => {
    const { adminId, tenantId, planId } = await setup()
    const tok = await stepUp(adminId, { action: 'something_else' })
    const r = await call(grantHandler, postReq(tok, overrideBody(tenantId, planId)))
    expect(r.status).toBe(403)
  })

  it('step-up elevated:billing but role=player (no admin:billing:grant) → 403 INSUFFICIENT_SCOPE', async () => {
    const { tenantId, planId } = await setup()
    const player = await seedUser({ email: 'p@x.io', role: 'player' })
    const tok = await stepUp(player.id, { role: 'player', email: 'p@x.io' })
    const r = await call(grantHandler, postReq(tok, overrideBody(tenantId, planId)))
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('INSUFFICIENT_SCOPE')
    expect(await auditExists('billing.grant.denied')).toBe(true)
  })
})

// ───────────────────────────── POST eligibility → audit ────────────────────

describe('POST /api/admin/billing/grant — eligibility denials', () => {
  it('suspended tenant → 422 TENANT_INELIGIBLE + billing.grant.denied audit', async () => {
    const admin = await seedUser({ email: 'admin@x.io', role: 'admin' })
    const t = await seedTenant({ type: 'organization', name: 'S', status: 'suspended' })
    await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
    const plan = await seedPlan({ productId: 'erp', code: 'b', name: 'B' })
    const r = await call(grantHandler, postReq(await stepUp(admin.id), overrideBody(t.id, plan.id)))
    expect(r.status).toBe(422)
    expect((await r.json()).code).toBe('TENANT_INELIGIBLE')
    expect(await auditExists('billing.grant.denied')).toBe(true)
  })

  it('org-only product to personal tenant → 422 PRODUCT_TENANT_TYPE_MISMATCH', async () => {
    const admin = await seedUser({ email: 'admin@x.io', role: 'admin' })
    const owner = await seedUser({ email: 'po@x.io', role: 'player' })
    const personal = await seedTenant({ type: 'personal', name: 'P', ownerUserId: owner.id })
    await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
    const plan = await seedPlan({ productId: 'erp', code: 'b', name: 'B' })
    const r = await call(grantHandler, postReq(await stepUp(admin.id), overrideBody(personal.id, plan.id)))
    expect(r.status).toBe(422)
    expect((await r.json()).code).toBe('PRODUCT_TENANT_TYPE_MISMATCH')
  })
})

// ───────────────────────────── GET entitlements ────────────────────────────

describe('GET /api/tenants/:tenantId/entitlements', () => {
  it('own tenant → 200 with projection fields only', async () => {
    const user = await seedUser({ email: 'm@x.io', role: 'player' })
    const t = await seedTenant({ type: 'organization', name: 'Org' })
    await seedMembership({ tenantId: t.id, userId: user.id, role: 'member', status: 'active' })
    await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
    const plan = await seedPlan({ productId: 'erp', code: 'erp_basic', name: 'Basic' })
    await seedEntitlement({ tenantId: t.id, productId: 'erp', planId: plan.id, status: 'active', version: 1, lastOpOccurredAt: '2020-01-01T00:00:00.000Z' })

    const r = await call(entitlementsHandler, getReq(await accessToken(user.id, 'player', 'm@x.io'), t.id), { tenantId: String(t.id) })
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.entitlements).toHaveLength(1)
    expect(j.entitlements[0]).toEqual({
      product_id: 'erp', plan_id: plan.id, status: 'active', granted_via: 'manual',
      version: 1, last_op_occurred_at: '2020-01-01T00:00:00.000Z',
    })
  })

  it('cross-tenant (non-member) → 403, no leak', async () => {
    const userB = await seedUser({ email: 'b@x.io', role: 'player' })
    const tB = await seedTenant({ type: 'organization', name: 'B' })
    await seedMembership({ tenantId: tB.id, userId: userB.id, role: 'member', status: 'active' })
    const tA = await seedTenant({ type: 'organization', name: 'A' }) // userB is NOT a member of A
    const r = await call(entitlementsHandler, getReq(await accessToken(userB.id, 'player', 'b@x.io'), tA.id), { tenantId: String(tA.id) })
    expect(r.status).toBe(403)
  })

  it('bad tenantId → 400', async () => {
    const user = await seedUser({ email: 'm2@x.io', role: 'player' })
    const r = await call(entitlementsHandler, getReq(await accessToken(user.id, 'player', 'm2@x.io'), 0), { tenantId: 'abc' })
    expect(r.status).toBe(400)
  })
})

// ───────────────────────────── POST per-user rate limit ────────────────────

describe('POST /api/admin/billing/grant — per-user rate limit (billing_grant)', () => {
  async function fillBucket(userId: number, n: number) {
    for (let i = 0; i < n; i++) {
      await db.prepare(`INSERT INTO login_attempts (kind, user_id) VALUES ('billing_grant', ?)`).bind(userId).run()
    }
  }

  it('at the cap (30 prior attempts) → next grant 429 RATE_LIMITED, no ledger write, denial audited', async () => {
    const { adminId, tenantId, planId } = await setup()
    await fillBucket(adminId, 30)
    const r = await call(grantHandler, postReq(await stepUp(adminId), overrideBody(tenantId, planId)))
    expect(r.status).toBe(429)
    expect((await r.json()).code).toBe('RATE_LIMITED')
    expect(await ledgerCount(tenantId)).toBe(0) // blocked before mutation
    const audit = await db.prepare(
      `SELECT event_data FROM audit_log WHERE event_type = 'billing.grant.denied' ORDER BY id DESC LIMIT 1`,
    ).first()
    expect(String(audit?.event_data)).toContain('rate_limited')
  })

  it('just under the cap (29 prior attempts) → grant still succeeds (200)', async () => {
    const { adminId, tenantId, planId } = await setup()
    await fillBucket(adminId, 29)
    const r = await call(grantHandler, postReq(await stepUp(adminId), overrideBody(tenantId, planId)))
    expect(r.status).toBe(200)
  })

  it('limit is per-user: a second admin is unaffected by another full bucket', async () => {
    const { adminId, tenantId, planId } = await setup()
    await fillBucket(adminId, 30)
    const admin2 = await seedUser({ email: 'admin2@x.io', role: 'admin' })
    const r = await call(grantHandler, postReq(await stepUp(admin2.id, { email: 'admin2@x.io' }), overrideBody(tenantId, planId)))
    expect(r.status).toBe(200) // admin2 has its own bucket
  })
})

// ───────────────────────────── POST failure dispositions audited ───────────

describe('POST /api/admin/billing/grant — failure dispositions are audited', () => {
  it('invalid JSON body → 400 INVALID_JSON + denied audit (reason invalid_json)', async () => {
    const { adminId } = await setup()
    const req = new Request('http://localhost/api/admin/billing/grant', {
      method: 'POST',
      headers: { Authorization: `Bearer ${await stepUp(adminId)}`, 'Content-Type': 'application/json' },
      body: 'not-json{',
    })
    const r = await call(grantHandler, req)
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('INVALID_JSON')
    const audit = await db.prepare(
      `SELECT event_data FROM audit_log WHERE event_type = 'billing.grant.denied' ORDER BY id DESC LIMIT 1`,
    ).first()
    expect(String(audit?.event_data)).toContain('invalid_json')
  })

  it('grantPlan contention → 503 CONTENTION + denied audit (reason contention)', async () => {
    const { adminId, tenantId, planId } = await setup()
    // 佔住 version slot：projection 停在 v1，但 ledger 已有一筆 prev_projection_version=1 的 op
    // → grant 讀到 v1、想以 prev_version=1 推進、撞 UNIQUE(tenant,product,prev_version) → 重試耗盡 → contention
    await seedEntitlement({ tenantId, productId: 'erp', planId, status: 'active', version: 1 })
    await db.prepare(
      `INSERT INTO grant_plan_operations
         (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
          granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key,
          from_status, to_status, prev_projection_version, occurred_at)
       VALUES (?, 'erp', ?, 'manual', 'offline_payment', 'occupied-slot', 'h', 1, 'a@x.io', 'admin', 'OCC-REF', 'OCC-REF', 'active', 'active', 1, '2020-01-01T00:00:00.000Z')`,
    ).bind(tenantId, planId).run()
    const r = await call(grantHandler, postReq(await stepUp(adminId), overrideBody(tenantId, planId)))
    expect(r.status).toBe(503)
    expect((await r.json()).code).toBe('CONTENTION')
    const audit = await db.prepare(
      `SELECT event_data FROM audit_log WHERE event_type = 'billing.grant.denied' ORDER BY id DESC LIMIT 1`,
    ).first()
    expect(String(audit?.event_data)).toContain('contention')
  })
})
