/**
 * PR2 Implementation Commit 2 — billing domain module tests.
 *
 * 覆蓋 functions/utils/billing.ts：canonicalizePaymentRef（Rev 3.3）+ grantPlan（manual）。
 * Unicode 測資以 String.fromCharCode(0x...) 在 runtime 構造，原始碼保持純 ASCII（無隱形字元 / 無 \u 逃逸）。
 *
 * append-only 紀律：本模組只 INSERT ledger（無 update/delete API）。fail-closed 並發正確性靠
 * UNIQUE(tenant_id, product_id, prev_projection_version)，**不靠 0-row UPDATE 的 changes()**。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, seedUser, seedTenant, seedProduct, seedPlan, seedEntitlement } from './_helpers'
import {
  grantPlan,
  canonicalizePaymentRef,
  type GrantPlanManualInput,
} from '../../functions/utils/billing'

const db = env.chiyigo_db

// invisible / full-width 測資（hex code point 構造；不在原始碼放隱形字元）
const ZWSP = String.fromCharCode(0x200b)
const NBSP = String.fromCharCode(0x00a0)
const IDEO = String.fromCharCode(0x3000)
const BOM = String.fromCharCode(0xfeff)
const WJ = String.fromCharCode(0x2060)
const FULLWIDTH_ABC123 = String.fromCharCode(0xff21, 0xff22, 0xff23, 0xff11, 0xff12, 0xff13)
const EMOJI = String.fromCodePoint(0x1f600)
const CJK = String.fromCharCode(0x6e2c, 0x8a66) // 測試

beforeEach(async () => { await resetDb() })

interface SetupOpts {
  productScope?: 'organization' | 'personal' | 'any'
  tenantType?: 'personal' | 'organization'
  tenantStatus?: string
}
async function setup(opts: SetupOpts = {}) {
  const { productScope = 'organization', tenantType = 'organization', tenantStatus = 'active' } = opts
  const admin = await seedUser({ email: 'admin@x.io', role: 'admin' })
  let ownerId: number | null = null
  if (tenantType === 'personal') {
    const owner = await seedUser({ email: 'owner@x.io' })
    ownerId = owner.id
  }
  const t = await seedTenant({ type: tenantType, name: 'T', status: tenantStatus, ownerUserId: ownerId })
  await seedProduct({ id: 'erp', name: 'ERP', tenantScope: productScope })
  const plan = await seedPlan({ productId: 'erp', code: 'erp_basic', name: 'ERP Basic' })
  return { adminId: admin.id, tenantId: t.id, planId: plan.id }
}

function offline(o: {
  tenantId: number
  planId: number
  adminId: number
  productId?: string
  adminIdempotencyKey?: string
  paymentRefRaw?: string
  grantReason?: string
}): GrantPlanManualInput {
  const inp: GrantPlanManualInput = {
    tenantId: o.tenantId,
    productId: o.productId ?? 'erp',
    planId: o.planId,
    manualSource: 'offline_payment',
    adminIdempotencyKey: o.adminIdempotencyKey ?? 'idem-1',
    paymentRefRaw: o.paymentRefRaw ?? 'REF-001',
    actor: { id: o.adminId, email: 'admin@x.io', role: 'admin' },
  }
  if (o.grantReason !== undefined) inp.grantReason = o.grantReason
  return inp
}

async function ledgerRows(tenantId: number, productId = 'erp') {
  const r = await db
    .prepare(`SELECT id, "trigger" AS trig, manual_source, from_status, to_status, prev_projection_version,
                     granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key, grant_reason,
                     admin_idempotency_key
                FROM grant_plan_operations WHERE tenant_id = ? AND product_id = ? ORDER BY id`)
    .bind(tenantId, productId)
    .all()
  return r.results ?? []
}
async function projection(tenantId: number, productId = 'erp') {
  return db
    .prepare(`SELECT status, granted_via, version, plan_id, last_op_occurred_at
                FROM tenant_product_access WHERE tenant_id = ? AND product_id = ?`)
    .bind(tenantId, productId)
    .first()
}

// ───────────────────────────── canonicalizePaymentRef ─────────────────────────────

describe('canonicalizePaymentRef', () => {
  it('case + whitespace variants collapse to the same key', () => {
    const a = canonicalizePaymentRef('ABC 123')
    const b = canonicalizePaymentRef('abc123')
    expect(a.ok && a.key).toBe('ABC123')
    expect(b.ok && b.key).toBe('ABC123')
  })

  it('full-width (NFKC) folds to ASCII', () => {
    const r = canonicalizePaymentRef(FULLWIDTH_ABC123)
    expect(r.ok && r.key).toBe('ABC123')
  })

  it('zero-width / Unicode whitespace are stripped from the key', () => {
    for (const sep of [ZWSP, NBSP, IDEO, BOM, WJ, ' ']) {
      const r = canonicalizePaymentRef(`ABC${sep}123`)
      expect(r.ok && r.key).toBe('ABC123')
    }
  })

  it('overlength trimmed display (>200) is rejected, not truncated', () => {
    const over = 'A'.repeat(201)
    expect(canonicalizePaymentRef(over)).toEqual({ ok: false, code: 'INVALID_PAYMENT_REF' })
    // display length exactly 200 (internal whitespace) with key <= 80 is accepted
    const ok200 = 'A'.repeat(40) + ' '.repeat(120) + 'B'.repeat(40)
    const r = canonicalizePaymentRef(ok200)
    expect(r.ok).toBe(true)
    expect(r.ok && r.key.length).toBe(80)
  })

  it('key length bounds: <3 and >80 reject; 3 and 80 accept', () => {
    expect(canonicalizePaymentRef('AB').ok).toBe(false)          // key len 2
    expect(canonicalizePaymentRef('ABC').ok).toBe(true)          // key len 3
    expect(canonicalizePaymentRef('A'.repeat(80)).ok).toBe(true) // key len 80
    expect(canonicalizePaymentRef('A'.repeat(81)).ok).toBe(false)// key len 81
  })

  it('invalid characters reject (punctuation outside ._:-, emoji, CJK)', () => {
    expect(canonicalizePaymentRef('ABC#123').ok).toBe(false)
    expect(canonicalizePaymentRef('abc/123').ok).toBe(false)
    expect(canonicalizePaymentRef(`ABC${EMOJI}`).ok).toBe(false)
    expect(canonicalizePaymentRef(`ABC${CJK}`).ok).toBe(false)
  })

  it('allowed punctuation . _ : - passes', () => {
    expect(canonicalizePaymentRef('A.B_C:1-2').ok).toBe(true)
  })

  it('empty / whitespace-only reject', () => {
    expect(canonicalizePaymentRef('').ok).toBe(false)
    expect(canonicalizePaymentRef('   ').ok).toBe(false)
    expect(canonicalizePaymentRef(NBSP + NBSP).ok).toBe(false)
  })

  it('deterministic: same input -> same key', () => {
    const a = canonicalizePaymentRef('ab c-123')
    const b = canonicalizePaymentRef('ab c-123')
    expect(a).toEqual(b)
  })
})

// ───────────────────────────── grantPlan: happy path ─────────────────────────────

describe('grantPlan manual — happy path', () => {
  it('offline grant writes ledger + projection', async () => {
    const { adminId, tenantId, planId } = await setup()
    const res = await grantPlan(db, offline({ tenantId, planId, adminId, paymentRefRaw: 'BANK REF-9' }))
    expect(res).toMatchObject({ outcome: 'applied', tenantId, productId: 'erp', planId, status: 'active', version: 1 })

    const rows = await ledgerRows(tenantId)
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({
      trig: 'manual', manual_source: 'offline_payment',
      from_status: 'none', to_status: 'active', prev_projection_version: 0,
      granted_by: adminId, granted_by_email: 'admin@x.io', granted_by_role: 'admin',
      payment_ref: 'BANK REF-9', payment_ref_key: 'BANKREF-9', grant_reason: null,
    })
    const proj = await projection(tenantId)
    expect(proj).toMatchObject({ status: 'active', granted_via: 'manual', version: 1, plan_id: planId })
  })

  it('admin_override grant stores reason, no payment_ref', async () => {
    const { adminId, tenantId, planId } = await setup()
    const res = await grantPlan(db, {
      tenantId, productId: 'erp', planId, manualSource: 'admin_override',
      adminIdempotencyKey: 'comp-1', grantReason: 'goodwill comp',
      actor: { id: adminId, email: 'admin@x.io', role: 'admin' },
    })
    expect(res.outcome).toBe('applied')
    const rows = await ledgerRows(tenantId)
    expect(rows[0]).toMatchObject({ manual_source: 'admin_override', grant_reason: 'goodwill comp', payment_ref: null, payment_ref_key: null })
  })

  it('re-grant (new key, same tenant x product) advances version chain 0 -> 1', async () => {
    const { adminId, tenantId, planId } = await setup()
    const r1 = await grantPlan(db, offline({ tenantId, planId, adminId, adminIdempotencyKey: 'k1', paymentRefRaw: 'R-001' }))
    expect(r1).toMatchObject({ outcome: 'applied', version: 1 })
    const res2 = await grantPlan(db, offline({ tenantId, planId, adminId, adminIdempotencyKey: 'k2', paymentRefRaw: 'R-002' }))
    expect(res2).toMatchObject({ outcome: 'applied', version: 2 })
    const rows = await ledgerRows(tenantId)
    expect(rows.map(r => r.prev_projection_version)).toEqual([0, 1])
    const proj = await projection(tenantId)
    expect(proj).toMatchObject({ version: 2, status: 'active' })
  })

  it('revoked -> active reinstatement applies (manual is intentional)', async () => {
    const { adminId, tenantId, planId } = await setup()
    await seedEntitlement({ tenantId, productId: 'erp', planId, status: 'revoked', version: 3, lastOpOccurredAt: '2020-01-01T00:00:00.000Z' })
    const res = await grantPlan(db, offline({ tenantId, planId, adminId, paymentRefRaw: 'REINSTATE-1' }))
    expect(res).toMatchObject({ outcome: 'applied', version: 4 })
    const rows = await ledgerRows(tenantId)
    expect(rows[0]).toMatchObject({ from_status: 'revoked', to_status: 'active', prev_projection_version: 3 })
  })

  it('senior-app (tenant_scope any) grants to a personal tenant', async () => {
    const owner = await seedUser({ email: 'p@x.io' })
    const t = await seedTenant({ type: 'personal', name: 'P', ownerUserId: owner.id })
    await seedProduct({ id: 'senior-app', name: 'Senior', tenantScope: 'any' })
    const plan = await seedPlan({ productId: 'senior-app', code: 'senior_basic', name: 'Basic' })
    const res = await grantPlan(db, {
      tenantId: t.id, productId: 'senior-app', planId: plan.id, manualSource: 'admin_override',
      adminIdempotencyKey: 's1', grantReason: 'family self-serve',
      actor: { id: owner.id, email: 'staff@x.io', role: 'admin' },
    })
    expect(res.outcome).toBe('applied')
  })
})

// ───────────────────────────── grantPlan: idempotency / evidence ──────────────────

describe('grantPlan manual — idempotency + evidence', () => {
  it('same admin_idempotency_key + same params -> replay (no second row)', async () => {
    const { adminId, tenantId, planId } = await setup()
    const r1 = await grantPlan(db, offline({ tenantId, planId, adminId, adminIdempotencyKey: 'K', paymentRefRaw: 'R-A' }))
    const r2 = await grantPlan(db, offline({ tenantId, planId, adminId, adminIdempotencyKey: 'K', paymentRefRaw: 'R-A' }))
    expect(r1.outcome).toBe('applied')
    expect(r2.outcome).toBe('replay')
    expect((await ledgerRows(tenantId)).length).toBe(1)
    expect(await projection(tenantId)).toMatchObject({ version: 1 })
  })

  it('same admin_idempotency_key + different params -> conflict (no write)', async () => {
    const { adminId, tenantId, planId } = await setup()
    const otherPlan = await seedPlan({ productId: 'erp', code: 'erp_pro', name: 'Pro' })
    await grantPlan(db, offline({ tenantId, planId, adminId, adminIdempotencyKey: 'K', paymentRefRaw: 'R-A' }))
    const r2 = await grantPlan(db, offline({ tenantId, planId: otherPlan.id, adminId, adminIdempotencyKey: 'K', paymentRefRaw: 'R-A' }))
    expect(r2.outcome).toBe('conflict')
    expect((await ledgerRows(tenantId)).length).toBe(1)
  })

  it('reused offline payment_ref_key (different key) -> evidence_conflict (no write)', async () => {
    const { adminId, tenantId, planId } = await setup()
    await grantPlan(db, offline({ tenantId, planId, adminId, adminIdempotencyKey: 'k1', paymentRefRaw: 'ABC 123' }))
    const r2 = await grantPlan(db, offline({ tenantId, planId, adminId, adminIdempotencyKey: 'k2', paymentRefRaw: 'abc123' }))
    expect(r2.outcome).toBe('evidence_conflict')
    expect((await ledgerRows(tenantId)).length).toBe(1)
  })
})

// ───────────────────────────── grantPlan: eligibility ─────────────────────────────

describe('grantPlan manual — eligibility', () => {
  it('suspended tenant -> tenant_ineligible', async () => {
    const { adminId, tenantId, planId } = await setup({ tenantStatus: 'suspended' })
    const res = await grantPlan(db, offline({ tenantId, planId, adminId }))
    expect(res.outcome).toBe('tenant_ineligible')
    expect((await ledgerRows(tenantId)).length).toBe(0)
  })

  it('missing tenant -> tenant_ineligible', async () => {
    const { adminId, planId } = await setup()
    const res = await grantPlan(db, offline({ tenantId: 999999, planId, adminId }))
    expect(res.outcome).toBe('tenant_ineligible')
  })

  it('org-only product to a personal tenant -> product_tenant_type_mismatch', async () => {
    const { adminId, planId } = await setup({ productScope: 'organization' }) // product erp = organization
    const owner = await seedUser({ email: 'p2@x.io' })
    const personal = await seedTenant({ type: 'personal', name: 'P', ownerUserId: owner.id })
    const res = await grantPlan(db, offline({ tenantId: personal.id, planId, adminId }))
    expect(res.outcome).toBe('product_tenant_type_mismatch')
  })

  it('plan not belonging to product -> plan_invalid', async () => {
    const { adminId, tenantId } = await setup()
    await seedProduct({ id: 'crm', name: 'CRM', tenantScope: 'any' })
    const crmPlan = await seedPlan({ productId: 'crm', code: 'crm_basic', name: 'CRM' })
    const res = await grantPlan(db, offline({ tenantId, planId: crmPlan.id, adminId })) // productId erp, plan from crm
    expect(res.outcome).toBe('plan_invalid')
  })
})

// ───────────────────────────── grantPlan: validation ─────────────────────────────

describe('grantPlan manual — validation', () => {
  it('rejects bad ids / source / key (type-valid but runtime-invalid)', async () => {
    const { adminId, tenantId, planId } = await setup()
    const base = offline({ tenantId, planId, adminId })
    expect((await grantPlan(db, { ...base, tenantId: -1 })).outcome).toBe('invalid')
    expect((await grantPlan(db, { ...base, planId: 0 })).outcome).toBe('invalid')
    expect((await grantPlan(db, { ...base, productId: '' })).outcome).toBe('invalid')
    expect((await grantPlan(db, { ...base, adminIdempotencyKey: '' })).outcome).toBe('invalid')
    expect((await grantPlan(db, { ...base, actor: { id: 0, email: 'a@x.io', role: 'admin' } })).outcome).toBe('invalid')
  })

  it('offline with empty / invalid payment_ref -> invalid INVALID_PAYMENT_REF', async () => {
    const { adminId, tenantId, planId } = await setup()
    const r1 = await grantPlan(db, offline({ tenantId, planId, adminId, paymentRefRaw: '' }))
    expect(r1).toMatchObject({ outcome: 'invalid', code: 'INVALID_PAYMENT_REF' })
    const r2 = await grantPlan(db, offline({ tenantId, planId, adminId, paymentRefRaw: 'A#B' }))
    expect(r2).toMatchObject({ outcome: 'invalid', code: 'INVALID_PAYMENT_REF' })
  })

  it('mutual exclusivity: offline+grant_reason and override+payment_ref both invalid', async () => {
    const { adminId, tenantId, planId } = await setup()
    const offlineWithReason = await grantPlan(db, offline({ tenantId, planId, adminId, grantReason: 'x' }))
    expect(offlineWithReason.outcome).toBe('invalid')
    const overrideWithRef = await grantPlan(db, {
      tenantId, productId: 'erp', planId, manualSource: 'admin_override',
      adminIdempotencyKey: 'o1', grantReason: 'r', paymentRefRaw: 'R',
      actor: { id: adminId, email: 'admin@x.io', role: 'admin' },
    })
    expect(overrideWithRef.outcome).toBe('invalid')
  })

  it('admin_override without grant_reason -> invalid', async () => {
    const { adminId, tenantId, planId } = await setup()
    const res = await grantPlan(db, {
      tenantId, productId: 'erp', planId, manualSource: 'admin_override',
      adminIdempotencyKey: 'o2',
      actor: { id: adminId, email: 'admin@x.io', role: 'admin' },
    })
    expect(res.outcome).toBe('invalid')
  })
})

// ───────────────────────────── grantPlan: fail-closed concurrency ─────────────────

describe('grantPlan manual — fail-closed via ledger UNIQUE (no 0-row-UPDATE reliance)', () => {
  it('contended version slot -> contention, projection unchanged, no silent grant', async () => {
    const { adminId, tenantId, planId } = await setup()
    // projection at version 1 (artificial: lastOp far in the past so staleness never fires)
    await seedEntitlement({ tenantId, productId: 'erp', planId, status: 'active', version: 1, lastOpOccurredAt: '2020-01-01T00:00:00.000Z' })
    // occupy the (tenant, product, prev_projection_version=1) slot with a prior ledger op
    await db.prepare(
      `INSERT INTO grant_plan_operations
         (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
          granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key,
          from_status, to_status, prev_projection_version, occurred_at)
       VALUES (?, 'erp', ?, 'manual', 'offline_payment', 'occupy', 'h', 1, 'a@x.io', 'admin', 'OCC', 'OCCKEY',
               'active', 'active', 1, '2020-01-01T00:00:00.000Z')`,
    ).bind(tenantId, planId).run()

    // admin_override grant: only collision is the (tenant,product,prev=1) UNIQUE -> retries -> contention
    const res = await grantPlan(db, {
      tenantId, productId: 'erp', planId, manualSource: 'admin_override',
      adminIdempotencyKey: 'mygrant', grantReason: 'racing',
      actor: { id: adminId, email: 'admin@x.io', role: 'admin' },
    })
    expect(res.outcome).toBe('contention')
    // fail-closed: projection NOT advanced (still version 1), and our grant left NO row
    expect(await projection(tenantId)).toMatchObject({ version: 1 })
    const mine = await db.prepare(`SELECT id FROM grant_plan_operations WHERE admin_idempotency_key = 'mygrant'`).first()
    expect(mine).toBeNull()
    // only the occupying row exists
    expect((await ledgerRows(tenantId)).length).toBe(1)
  })
})

// ───────────────────────────── module surface: no update/delete ledger API ────────

describe('billing module surface', () => {
  it('exposes no ledger update/delete helper (append-only is insert-only)', async () => {
    const billing = await import('../../functions/utils/billing')
    const offenders = Object.keys(billing).filter(k => /update|delete|revoke|remove/i.test(k))
    expect(offenders).toEqual([])
  })
})

// ───────────────────────────── strict input shape: unknown keys rejected ──────────
// 變數展開（非 fresh literal）→ 帶 excess key 仍可傳給 typed param 而不觸發編譯期 excess-property
// 檢查，藉此驗 runtime allowlist。

describe('grantPlan manual — strict input shape', () => {
  it('top-level occurred_at (client-supplied) -> invalid, no ledger/projection row', async () => {
    const { adminId, tenantId, planId } = await setup()
    const inp = { ...offline({ tenantId, planId, adminId }), occurred_at: '2020-01-01T00:00:00.000Z' }
    const res = await grantPlan(db, inp)
    expect(res).toMatchObject({ outcome: 'invalid', code: 'ERR_VALIDATION' })
    expect((await ledgerRows(tenantId)).length).toBe(0)
    expect(await projection(tenantId)).toBeNull()
  })

  it('arbitrary unknown top-level field -> invalid, no rows', async () => {
    const { adminId, tenantId, planId } = await setup()
    const inp = { ...offline({ tenantId, planId, adminId }), foo: 'bar' }
    const res = await grantPlan(db, inp)
    expect(res).toMatchObject({ outcome: 'invalid', code: 'ERR_VALIDATION' })
    expect((await ledgerRows(tenantId)).length).toBe(0)
    expect(await projection(tenantId)).toBeNull()
  })

  it('unknown actor field -> invalid, no rows', async () => {
    const { adminId, tenantId, planId } = await setup()
    const base = offline({ tenantId, planId, adminId })
    const inp = { ...base, actor: { ...base.actor, hacked: true } }
    const res = await grantPlan(db, inp)
    expect(res).toMatchObject({ outcome: 'invalid', code: 'ERR_VALIDATION' })
    expect((await ledgerRows(tenantId)).length).toBe(0)
    expect(await projection(tenantId)).toBeNull()
  })
})
