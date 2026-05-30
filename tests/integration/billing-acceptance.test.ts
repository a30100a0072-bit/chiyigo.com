/**
 * PR2 Implementation Commit 5 — acceptance gap-fill (plan §10).
 *
 * 補 Commit 2/4 未覆蓋的驗收項（不重複既有）：
 *  §10.14 actor snapshot survives user mutation/deletion
 *  §10.18 projection rebuild from ledger
 *  §10.6  idempotency canonical-variant → replay（非 conflict）
 *  §10.2  DB schema CHECK negatives（raw insert，直接打 DB 約束）
 *  §10.5  offline payment_ref_key partial UNIQUE 為 durable DB backstop（繞過 app pre-check）
 *  §10.16 tenant eligibility 補完（closed tenant；senior-app any → personal）
 *  §10.21 server-generated occurred_at 格式（toISOString）
 *
 * 全程不改 runtime code；raw insert 僅供測 DB 約束（insert-only，非新增 ledger 寫入 API）。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedTenant, seedProduct, seedPlan } from './_helpers'
import { grantPlan, type GrantPlanManualInput } from '../../functions/utils/billing'

const db = env.chiyigo_db
const T0 = '2020-01-01T00:00:00.000Z'

beforeEach(async () => { await resetDb() })

async function setupOrg() {
  const admin = await seedUser({ email: 'admin@x.io', role: 'admin' })
  const t = await seedTenant({ type: 'organization', name: 'Acme' })
  await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
  const plan = await seedPlan({ productId: 'erp', code: 'erp_basic', name: 'ERP Basic' })
  return { adminId: admin.id, tenantId: t.id, planId: plan.id }
}
function manualOffline(o: { tenantId: number; planId: number; adminId: number; email?: string; role?: string; key?: string; ref?: string }): GrantPlanManualInput {
  return {
    tenantId: o.tenantId, productId: 'erp', planId: o.planId, manualSource: 'offline_payment',
    adminIdempotencyKey: o.key ?? 'k1', paymentRefRaw: o.ref ?? 'REF-001',
    actor: { id: o.adminId, email: o.email ?? 'admin@x.io', role: o.role ?? 'admin' },
  }
}
async function ledgerCount(tenantId: number) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM grant_plan_operations WHERE tenant_id = ?`).bind(tenantId).first()
  return r ? Number(r.c) : 0
}
async function projectionCount(tenantId: number) {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM tenant_product_access WHERE tenant_id = ?`).bind(tenantId).first()
  return r ? Number(r.c) : 0
}
// Seed a payment_intents row (for payment-trigger CHECK probes) and return its id.
async function seedPaymentIntent(vendorIntentId = 'vi-pay'): Promise<number> {
  const u = await seedUser({ email: `payer-${vendorIntentId}@x.io`, role: 'player' })
  await db.prepare(
    `INSERT INTO payment_intents (user_id, vendor, vendor_intent_id, kind, status, currency)
     VALUES (?, 'mock', ?, 'subscription', 'succeeded', 'TWD')`,
  ).bind(u.id, vendorIntentId).run()
  const pi = await db.prepare(`SELECT id FROM payment_intents WHERE vendor_intent_id = ?`).bind(vendorIntentId).first()
  return Number(pi?.id)
}

// ─────────────────── §10.14 actor snapshot survives mutation/deletion ───────────────────

describe('acceptance §10.14 — actor snapshot survives user mutation/deletion', () => {
  it('ledger granted_by/email/role unchanged after admin email/role change + hard delete', async () => {
    const { adminId, tenantId, planId } = await setupOrg()
    expect((await grantPlan(db, manualOffline({ tenantId, planId, adminId, ref: 'ACTOR-1' }))).outcome).toBe('applied')

    await db.prepare(`UPDATE users SET email = 'changed@x.io', role = 'player' WHERE id = ?`).bind(adminId).run()
    await db.prepare(`DELETE FROM users WHERE id = ?`).bind(adminId).run() // granted_by has NO FK → ledger survives

    const row = await db.prepare(
      `SELECT granted_by, granted_by_email, granted_by_role FROM grant_plan_operations WHERE tenant_id = ?`,
    ).bind(tenantId).first()
    expect(row).toMatchObject({ granted_by: adminId, granted_by_email: 'admin@x.io', granted_by_role: 'admin' })
  })
})

// ─────────────────── §10.18 projection rebuild from ledger ───────────────────

describe('acceptance §10.18 — projection rebuild from ledger', () => {
  it('reconstructed latest projection equals tenant_product_access', async () => {
    const { adminId, tenantId, planId } = await setupOrg()
    const plan2 = await seedPlan({ productId: 'erp', code: 'erp_pro', name: 'Pro' })
    await grantPlan(db, manualOffline({ tenantId, planId, adminId, key: 'g1', ref: 'RB-1' }))
    await grantPlan(db, manualOffline({ tenantId, planId: plan2.id, adminId, key: 'g2', ref: 'RB-2' }))
    await grantPlan(db, manualOffline({ tenantId, planId, adminId, key: 'g3', ref: 'RB-3' }))

    const latest = await db.prepare(
      `SELECT to_status, plan_id, "trigger" AS trig, occurred_at, prev_projection_version
         FROM grant_plan_operations WHERE tenant_id = ? AND product_id = 'erp'
        ORDER BY prev_projection_version DESC LIMIT 1`,
    ).bind(tenantId).first()
    const reconstructed = {
      status:              latest?.to_status,
      plan_id:             Number(latest?.plan_id),
      granted_via:         latest?.trig,
      version:             Number(latest?.prev_projection_version) + 1,
      last_op_occurred_at: latest?.occurred_at,
    }
    const proj = await db.prepare(
      `SELECT status, plan_id, granted_via, version, last_op_occurred_at FROM tenant_product_access WHERE tenant_id = ? AND product_id = 'erp'`,
    ).bind(tenantId).first()
    expect(reconstructed).toEqual({
      status:              proj?.status,
      plan_id:             Number(proj?.plan_id),
      granted_via:         proj?.granted_via,
      version:             Number(proj?.version),
      last_op_occurred_at: proj?.last_op_occurred_at,
    })
    expect(Number(proj?.version)).toBe(3) // 3 grants chained
  })
})

// ─────────────────── §10.6 idempotency canonical-variant replay ───────────────────

describe('acceptance §10.6 — same key + canonical-variant payment_ref → replay (not conflict)', () => {
  it('"ABC 123" then "abc123" with same admin_idempotency_key → replay', async () => {
    const { adminId, tenantId, planId } = await setupOrg()
    expect((await grantPlan(db, manualOffline({ tenantId, planId, adminId, key: 'K', ref: 'ABC 123' }))).outcome).toBe('applied')
    const r2 = await grantPlan(db, manualOffline({ tenantId, planId, adminId, key: 'K', ref: 'abc123' }))
    expect(r2.outcome).toBe('replay') // request_hash keyed on canonical payment_ref_key 'ABC123'
    expect(await ledgerCount(tenantId)).toBe(1)
  })
})

// ─────────────────── §10.2 DB schema CHECK negatives (raw insert) ───────────────────

describe('acceptance §10.2 — DB schema CHECK negatives (raw insert)', () => {
  let tenantId: number, planId: number
  beforeEach(async () => {
    const s = await setupOrg()
    tenantId = s.tenantId; planId = s.planId
  })

  it('payment-trigger row carrying manual evidence (granted_by) → rejected; no projection side effect', async () => {
    const payer = await seedUser({ email: 'payer@x.io', role: 'player' })
    await db.prepare(
      `INSERT INTO payment_intents (user_id, vendor, vendor_intent_id, kind, status, currency)
       VALUES (?, 'mock', 'vi-acc-1', 'subscription', 'succeeded', 'TWD')`,
    ).bind(payer.id).run()
    const pi = await db.prepare(`SELECT id FROM payment_intents WHERE vendor_intent_id = 'vi-acc-1'`).first()
    await expect(
      db.prepare(
        `INSERT INTO grant_plan_operations
           (tenant_id, product_id, plan_id, "trigger", payment_intent_id, granted_by, from_status, to_status, prev_projection_version, occurred_at)
         VALUES (?, 'erp', ?, 'payment', ?, 5, 'none', 'active', 0, ?)`,
      ).bind(tenantId, planId, Number(pi?.id), T0).run(),
    ).rejects.toThrow()
    expect(await ledgerCount(tenantId)).toBe(0)
    expect(await projectionCount(tenantId)).toBe(0)
  })

  it('offline_payment with grant_reason → rejected', async () => {
    await expect(
      db.prepare(
        `INSERT INTO grant_plan_operations
           (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
            granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key, grant_reason,
            from_status, to_status, prev_projection_version, occurred_at)
         VALUES (?, 'erp', ?, 'manual', 'offline_payment', 'k', 'h', 1, 'a@x.io', 'admin', 'REF', 'REF', 'should-not-be-here', 'none', 'active', 0, ?)`,
      ).bind(tenantId, planId, T0).run(),
    ).rejects.toThrow()
  })

  it('admin_override with payment_ref/payment_ref_key → rejected', async () => {
    await expect(
      db.prepare(
        `INSERT INTO grant_plan_operations
           (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
            granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key, grant_reason,
            from_status, to_status, prev_projection_version, occurred_at)
         VALUES (?, 'erp', ?, 'manual', 'admin_override', 'k', 'h', 1, 'a@x.io', 'admin', 'REF', 'REF', 'reason', 'none', 'active', 0, ?)`,
      ).bind(tenantId, planId, T0).run(),
    ).rejects.toThrow()
  })

  it('invalid from_status / to_status → rejected', async () => {
    const base = () => db.prepare(
      `INSERT INTO grant_plan_operations
         (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
          granted_by, granted_by_email, granted_by_role, grant_reason, from_status, to_status, prev_projection_version, occurred_at)
       VALUES (?, 'erp', ?, 'manual', 'admin_override', ?, 'h', 1, 'a@x.io', 'admin', 'r', ?, ?, 0, ?)`,
    )
    await expect(base().bind(tenantId, planId, 'kf', 'bogus', 'active', T0).run()).rejects.toThrow()
    await expect(base().bind(tenantId, planId, 'kt', 'none', 'bogus', T0).run()).rejects.toThrow()
  })

  it('blank / whitespace offline payment_ref → rejected', async () => {
    await expect(
      db.prepare(
        `INSERT INTO grant_plan_operations
           (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
            granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key,
            from_status, to_status, prev_projection_version, occurred_at)
         VALUES (?, 'erp', ?, 'manual', 'offline_payment', 'k', 'h', 1, 'a@x.io', 'admin', '   ', 'KEY', 'none', 'active', 0, ?)`,
      ).bind(tenantId, planId, T0).run(),
    ).rejects.toThrow()
  })

  // — positive control: a clean payment-trigger row (no manual evidence) inserts —
  // 證明後續 family-rejection 是「manual evidence 觸發」，而非 payment row 被整類封鎖。
  it('positive control: clean payment-trigger row (no manual evidence) inserts', async () => {
    const pi = await seedPaymentIntent('vi-clean')
    await db.prepare(
      `INSERT INTO grant_plan_operations
         (tenant_id, product_id, plan_id, "trigger", payment_intent_id, from_status, to_status, prev_projection_version, occurred_at)
       VALUES (?, 'erp', ?, 'payment', ?, 'none', 'active', 0, ?)`,
    ).bind(tenantId, planId, pi, T0).run()
    expect(await ledgerCount(tenantId)).toBe(1)
  })

  // payment-trigger row rejects EACH manual-evidence family（CHECK: payment 時所有 manual 欄位必 NULL）
  const PAYMENT_MANUAL_EVIDENCE: ReadonlyArray<{ col: string; val: string | number }> = [
    { col: 'manual_source',         val: 'offline_payment' },
    { col: 'admin_idempotency_key', val: 'k' },
    { col: 'request_hash',          val: 'h' },
    { col: 'granted_by',            val: 5 },
    { col: 'granted_by_email',      val: 'a@x.io' },
    { col: 'granted_by_role',       val: 'admin' },
    { col: 'payment_ref',           val: 'REF' },
    { col: 'payment_ref_key',       val: 'REF' },
    { col: 'grant_reason',          val: 'reason' },
  ]
  it.each(PAYMENT_MANUAL_EVIDENCE)(
    'payment-trigger row with manual-evidence field $col set → rejected',
    async ({ col, val }) => {
      const pi = await seedPaymentIntent(`vi-${col}`)
      // col 來自上方硬編碼清單（非外部輸入），直接內插欄名安全；值走 bind
      await expect(
        db.prepare(
          `INSERT INTO grant_plan_operations
             (tenant_id, product_id, plan_id, "trigger", payment_intent_id, ${col}, from_status, to_status, prev_projection_version, occurred_at)
           VALUES (?, 'erp', ?, 'payment', ?, ?, 'none', 'active', 0, ?)`,
        ).bind(tenantId, planId, pi, val, T0).run(),
      ).rejects.toThrow()
      expect(await ledgerCount(tenantId)).toBe(0)
    },
  )

  it('manual-trigger row with payment_event_ref non-null → rejected', async () => {
    await expect(
      db.prepare(
        `INSERT INTO grant_plan_operations
           (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
            granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key, payment_event_ref,
            from_status, to_status, prev_projection_version, occurred_at)
         VALUES (?, 'erp', ?, 'manual', 'offline_payment', 'k', 'h', 1, 'a@x.io', 'admin', 'REF', 'REF', 'evt-ref', 'none', 'active', 0, ?)`,
      ).bind(tenantId, planId, T0).run(),
    ).rejects.toThrow()
  })

  it('admin_override blank / whitespace grant_reason → rejected', async () => {
    await expect(
      db.prepare(
        `INSERT INTO grant_plan_operations
           (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
            granted_by, granted_by_email, granted_by_role, grant_reason,
            from_status, to_status, prev_projection_version, occurred_at)
         VALUES (?, 'erp', ?, 'manual', 'admin_override', 'k', 'h', 1, 'a@x.io', 'admin', '   ', 'none', 'active', 0, ?)`,
      ).bind(tenantId, planId, T0).run(),
    ).rejects.toThrow()
  })
})

// ─────────────────── §10.5 partial UNIQUE durable backstop ───────────────────

describe('acceptance §10.5 — offline payment_ref_key partial UNIQUE is a durable DB backstop', () => {
  it('duplicate canonical payment_ref_key blocked at DB level (direct insert bypassing app pre-check)', async () => {
    const { tenantId, planId } = await setupOrg()
    // 不同 prev_projection_version + 不同 admin_idempotency_key → 唯一衝突點僅 payment_ref_key
    const ins = (idemKey: string, prevV: number) => db.prepare(
      `INSERT INTO grant_plan_operations
         (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
          granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key,
          from_status, to_status, prev_projection_version, occurred_at)
       VALUES (?, 'erp', ?, 'manual', 'offline_payment', ?, 'h', 1, 'a@x.io', 'admin', 'REF', 'SAMEKEY', 'none', 'active', ?, ?)`,
    ).bind(tenantId, planId, idemKey, prevV, T0)
    await ins('idem-a', 0).run()
    await expect(ins('idem-b', 1).run()).rejects.toThrow() // partial UNIQUE(payment_ref_key) WHERE offline_payment
    expect(await ledgerCount(tenantId)).toBe(1)
  })
})

// ─────────────────── §10.16 tenant eligibility completion ───────────────────

describe('acceptance §10.16 — tenant eligibility completion', () => {
  it('closed tenant → tenant_ineligible (no write)', async () => {
    const admin = await seedUser({ email: 'admin@x.io', role: 'admin' })
    const t = await seedTenant({ type: 'organization', name: 'Closed', status: 'closed' })
    await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
    const plan = await seedPlan({ productId: 'erp', code: 'b', name: 'B' })
    const res = await grantPlan(db, manualOffline({ tenantId: t.id, planId: plan.id, adminId: admin.id, ref: 'CLOSED-1' }))
    expect(res.outcome).toBe('tenant_ineligible')
    expect(await ledgerCount(t.id)).toBe(0)
  })

  it('senior-app (tenant_scope any) → personal tenant applies', async () => {
    const owner = await seedUser({ email: 'o@x.io', role: 'player' })
    const t = await seedTenant({ type: 'personal', name: 'P', ownerUserId: owner.id })
    await seedProduct({ id: 'senior-app', name: 'Senior', tenantScope: 'any' })
    const plan = await seedPlan({ productId: 'senior-app', code: 'sb', name: 'SB' })
    const res = await grantPlan(db, {
      tenantId: t.id, productId: 'senior-app', planId: plan.id, manualSource: 'admin_override',
      adminIdempotencyKey: 's1', grantReason: 'family self-serve',
      actor: { id: owner.id, email: 'staff@x.io', role: 'admin' },
    })
    expect(res.outcome).toBe('applied')
  })
})

// ─────────────────── §10.21 server-generated occurred_at format ───────────────────

describe('acceptance §10.21 — server-generated occurred_at format', () => {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  it('grantPlan stores UTC ISO-8601 occurred_at on ledger + projection (matching)', async () => {
    const { adminId, tenantId, planId } = await setupOrg()
    await grantPlan(db, manualOffline({ tenantId, planId, adminId, ref: 'ISO-1' }))
    const op = await db.prepare(`SELECT occurred_at FROM grant_plan_operations WHERE tenant_id = ?`).bind(tenantId).first()
    const proj = await db.prepare(`SELECT last_op_occurred_at FROM tenant_product_access WHERE tenant_id = ?`).bind(tenantId).first()
    expect(String(op?.occurred_at)).toMatch(ISO)
    expect(String(proj?.last_op_occurred_at)).toMatch(ISO)
    expect(op?.occurred_at).toBe(proj?.last_op_occurred_at)
  })
  // NOTE: body-supplied occurred_at rejection (400 ERR_VALIDATION) covered in billing-endpoints.test.ts (Commit 4).
})
