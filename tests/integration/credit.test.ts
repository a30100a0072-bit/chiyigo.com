/**
 * PR3 Credit Wallet domain tests (plan §10 tests 2/2b/2c, 3-17).
 *
 * deductCredits atomicity / idempotency(scope) / concurrency / boundary / eligibility / missing-row
 *   + topUp / adjust / setProductQuota (durable idempotency + authoritative quota_config_ledger)
 *   + reconciliation invariant + actor snapshot + DB CHECK value-invariant negatives.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import {
  resetDb, seedUser, seedTenant, seedProduct, seedWallet, seedQuota,
} from './_helpers'
import {
  deductCredits, topUpCredits, adjustCredits, setProductQuota,
  type DeductCreditsInput,
} from '../../functions/utils/credit'

const db = env.chiyigo_db

beforeEach(async () => { await resetDb() })

let _orgSeq = 0
async function setupOrg(opts: { tenantStatus?: string; productActive?: number; scope?: 'organization' | 'personal' | 'any' } = {}) {
  const { tenantStatus = 'active', productActive = 1, scope = 'organization' } = opts
  // unique admin email per call (a single test may build several orgs -> users.email is UNIQUE)
  const email = `admin${_orgSeq++}@x.io`
  const admin = await seedUser({ email, role: 'admin' })
  const t = await seedTenant({ type: 'organization', name: 'Acme', status: tenantStatus })
  await seedProduct({ id: 'erp', name: 'ERP', tenantScope: scope, isActive: productActive })
  return { actor: { id: admin.id, email, role: 'admin' }, tenantId: t.id, productId: 'erp' }
}

async function walletBalance(tenantId: number): Promise<number | null> {
  const r = await db.prepare(`SELECT balance FROM credit_wallets WHERE tenant_id = ?`).bind(tenantId).first<{ balance: number }>()
  return r ? r.balance : null
}
async function quotaUsed(tenantId: number, productId: string): Promise<number | null> {
  const r = await db.prepare(`SELECT quota_used FROM product_usage_quota WHERE tenant_id = ? AND product_id = ? AND period = 'lifetime'`)
    .bind(tenantId, productId).first<{ quota_used: number }>()
  return r ? r.quota_used : null
}
async function ledgerCount(tenantId: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM credit_ledger WHERE tenant_id = ?`).bind(tenantId).first<{ c: number }>()
  return r ? Number(r.c) : 0
}
async function qclCount(tenantId: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM quota_config_ledger WHERE tenant_id = ?`).bind(tenantId).first<{ c: number }>()
  return r ? Number(r.c) : 0
}
function deductInput(o: Partial<DeductCreditsInput> & { tenantId: number; productId: string }): DeductCreditsInput {
  return {
    tenantId: o.tenantId, productId: o.productId, amount: o.amount ?? 1,
    idempotencyKey: o.idempotencyKey ?? 'k1', source: o.source ?? 'product',
    period: o.period, ref: o.ref, actor: o.actor,
  }
}

// ─────────────────── deductCredits (Tier-0 core) ───────────────────

describe('deductCredits — happy / idempotency / boundary', () => {
  it('test3 happy: balance & quota move, one ledger row with correct snapshot', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 })
    await seedQuota({ tenantId, productId, quotaLimit: 50 })
    const r = await deductCredits(db, deductInput({ tenantId, productId, amount: 30, idempotencyKey: 'e1' }))
    expect(r.outcome).toBe('applied')
    // applied response reads back the authoritative ledger *_after snapshot (not the stale pre-batch read)
    if (r.outcome === 'applied') {
      expect(r.balance).toBe(70)
      expect(r.quotaUsed).toBe(30)
      expect(r.quotaLimit).toBe(50)
    }
    expect(await walletBalance(tenantId)).toBe(70)
    expect(await quotaUsed(tenantId, productId)).toBe(30)
    expect(await ledgerCount(tenantId)).toBe(1)
    const row = await db.prepare(`SELECT amount, balance_after, quota_used_after, quota_limit_after, quota_period, source FROM credit_ledger WHERE tenant_id = ?`).bind(tenantId).first()
    expect(row).toMatchObject({ amount: -30, balance_after: 70, quota_used_after: 30, quota_limit_after: 50, quota_period: 'lifetime', source: 'product' })
  })

  it('test4 replay: same (tenant,scope,key)+params → replay, no second row', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    await deductCredits(db, deductInput({ tenantId, productId, amount: 30, idempotencyKey: 'K' }))
    const r2 = await deductCredits(db, deductInput({ tenantId, productId, amount: 30, idempotencyKey: 'K' }))
    expect(r2.outcome).toBe('replay')
    expect(await ledgerCount(tenantId)).toBe(1)
    expect(await walletBalance(tenantId)).toBe(70)
  })

  it('test5 conflict: same key + different amount → conflict, no mutation', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    await deductCredits(db, deductInput({ tenantId, productId, amount: 30, idempotencyKey: 'K' }))
    const r2 = await deductCredits(db, deductInput({ tenantId, productId, amount: 31, idempotencyKey: 'K' }))
    expect(r2.outcome).toBe('conflict')
    expect(await ledgerCount(tenantId)).toBe(1)
    expect(await walletBalance(tenantId)).toBe(70)
  })

  it('test5b scope isolation: same key, different products → both apply', async () => {
    const { tenantId, productId, actor } = await setupOrg()
    await seedProduct({ id: 'senior-app', name: 'Senior', tenantScope: 'any' })
    await seedWallet({ tenantId, balance: 100 })
    await seedQuota({ tenantId, productId, quotaLimit: 50 })
    await seedQuota({ tenantId, productId: 'senior-app', quotaLimit: 50 })
    const r1 = await deductCredits(db, deductInput({ tenantId, productId, amount: 10, idempotencyKey: 'EVT-123' }))
    const r2 = await deductCredits(db, deductInput({ tenantId, productId: 'senior-app', amount: 10, idempotencyKey: 'EVT-123' }))
    expect(r1.outcome).toBe('applied')
    expect(r2.outcome).toBe('applied')
    expect(await ledgerCount(tenantId)).toBe(2)
    // and an admin topup with the same key K coexists with a product deduct key K (distinct scopes)
    expect((await topUpCredits(db, { tenantId, amount: 5, idempotencyKey: 'EVT-123', actor })).outcome).toBe('applied')
    expect(await ledgerCount(tenantId)).toBe(3) // 2 deducts + 1 topup, all key 'EVT-123', 3 distinct scopes
    // r3 replays r1 (same product:erp scope + key + params) — unaffected by the manual:topup-scope row
    const r3 = await deductCredits(db, deductInput({ tenantId, productId, amount: 10, idempotencyKey: 'EVT-123', source: 'product' }))
    expect(r3.outcome).toBe('replay')
    expect(await ledgerCount(tenantId)).toBe(3) // replay adds no row
  })

  it('test6 insufficient: balance 5, deduct 10 → insufficient, nothing changed', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 5 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    const r = await deductCredits(db, deductInput({ tenantId, productId, amount: 10, idempotencyKey: 'i' }))
    expect(r.outcome).toBe('insufficient_balance')
    expect(await walletBalance(tenantId)).toBe(5)
    expect(await quotaUsed(tenantId, productId)).toBe(0)
    expect(await ledgerCount(tenantId)).toBe(0)
  })

  it('test7 boundary: balance == amount → applied (0); next deduct → insufficient', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 10 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    expect((await deductCredits(db, deductInput({ tenantId, productId, amount: 10, idempotencyKey: 'a' }))).outcome).toBe('applied')
    expect(await walletBalance(tenantId)).toBe(0)
    expect((await deductCredits(db, deductInput({ tenantId, productId, amount: 1, idempotencyKey: 'b' }))).outcome).toBe('insufficient_balance')
  })

  it('test8 quota: limit 10 used 8, deduct 3 → quota_exceeded; deduct 2 → applied', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 10, quotaUsed: 8 })
    expect((await deductCredits(db, deductInput({ tenantId, productId, amount: 3, idempotencyKey: 'a' }))).outcome).toBe('quota_exceeded')
    expect(await ledgerCount(tenantId)).toBe(0)
    expect((await deductCredits(db, deductInput({ tenantId, productId, amount: 2, idempotencyKey: 'b' }))).outcome).toBe('applied')
    expect(await quotaUsed(tenantId, productId)).toBe(10)
  })

  it('test9 missing rows: no wallet → wallet_not_found; no quota → quota_not_found', async () => {
    const { tenantId, productId } = await setupOrg()
    // no wallet, no quota
    expect((await deductCredits(db, deductInput({ tenantId, productId, amount: 1, idempotencyKey: 'a' }))).outcome).toBe('wallet_not_found')
    await seedWallet({ tenantId, balance: 100 })
    expect((await deductCredits(db, deductInput({ tenantId, productId, amount: 1, idempotencyKey: 'b' }))).outcome).toBe('quota_not_found')
    expect(await ledgerCount(tenantId)).toBe(0)
  })

  it('test9b period: non-lifetime → invalid UNSUPPORTED_PERIOD, no write', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    const r = await deductCredits(db, deductInput({ tenantId, productId, amount: 1, idempotencyKey: 'a', period: '2026-06' }))
    expect(r).toMatchObject({ outcome: 'invalid', code: 'UNSUPPORTED_PERIOD' })
    expect(await ledgerCount(tenantId)).toBe(0)
  })

  it('amount must be positive int within bounds', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    for (const bad of [0, -1, 1.5, 2_000_000_000]) {
      const r = await deductCredits(db, deductInput({ tenantId, productId, amount: bad, idempotencyKey: `k${bad}` }))
      expect(r.outcome).toBe('invalid')
    }
    expect(await ledgerCount(tenantId)).toBe(0)
  })

  it('manual source requires actor; product source rejects actor', async () => {
    const { tenantId, productId, actor } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    expect((await deductCredits(db, { tenantId, productId, amount: 1, idempotencyKey: 'm', source: 'manual' })).outcome).toBe('invalid')
    expect((await deductCredits(db, { tenantId, productId, amount: 1, idempotencyKey: 'p', source: 'product', actor })).outcome).toBe('invalid')
    // manual WITH actor → applied; product WITHOUT actor → applied
    expect((await deductCredits(db, { tenantId, productId, amount: 1, idempotencyKey: 'm2', source: 'manual', actor })).outcome).toBe('applied')
    const row = await db.prepare(`SELECT actor_id, source FROM credit_ledger WHERE idempotency_key = 'm2'`).first()
    expect(row).toMatchObject({ actor_id: actor.id, source: 'manual' })
  })
})

describe('deductCredits — concurrency (Stage-0 aligned)', () => {
  it('test10 double-spend: balance 10, two ×7 different keys → one applied + one insufficient; final 3', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 10 }); await seedQuota({ tenantId, productId, quotaLimit: 100 })
    const [a, b] = await Promise.all([
      deductCredits(db, deductInput({ tenantId, productId, amount: 7, idempotencyKey: 'A' })),
      deductCredits(db, deductInput({ tenantId, productId, amount: 7, idempotencyKey: 'B' })),
    ])
    const outcomes = [a.outcome, b.outcome].sort()
    expect(outcomes).toEqual(['applied', 'insufficient_balance'])
    expect(await walletBalance(tenantId)).toBe(3)
    expect(await ledgerCount(tenantId)).toBe(1)
  })

  it('test11 same-key race: two same-key → one applied + one replay; one row', async () => {
    const { tenantId, productId } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 100 })
    const [a, b] = await Promise.all([
      deductCredits(db, deductInput({ tenantId, productId, amount: 5, idempotencyKey: 'SAME' })),
      deductCredits(db, deductInput({ tenantId, productId, amount: 5, idempotencyKey: 'SAME' })),
    ])
    const outcomes = [a.outcome, b.outcome].sort()
    expect(outcomes).toEqual(['applied', 'replay'])
    expect(await ledgerCount(tenantId)).toBe(1)
    expect(await walletBalance(tenantId)).toBe(95)
  })
})

describe('deductCredits — eligibility (test12)', () => {
  it('closed tenant → tenant_ineligible (no write)', async () => {
    const { tenantId, productId } = await setupOrg({ tenantStatus: 'closed' })
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    expect((await deductCredits(db, deductInput({ tenantId, productId, amount: 1, idempotencyKey: 'a' }))).outcome).toBe('tenant_ineligible')
    expect(await ledgerCount(tenantId)).toBe(0)
  })
  it('inactive product → product_inactive', async () => {
    const { tenantId, productId } = await setupOrg({ productActive: 0 })
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    expect((await deductCredits(db, deductInput({ tenantId, productId, amount: 1, idempotencyKey: 'a' }))).outcome).toBe('product_inactive')
  })
})

// ─────────────────── topUp / adjust / setProductQuota ───────────────────

describe('topUpCredits (test13)', () => {
  it('first top-up creates wallet (UPSERT); second adds; ledger topup rows with actor', async () => {
    const { tenantId, actor } = await setupOrg()
    expect(await walletBalance(tenantId)).toBeNull()
    expect((await topUpCredits(db, { tenantId, amount: 100, idempotencyKey: 't1', actor })).outcome).toBe('applied')
    expect(await walletBalance(tenantId)).toBe(100)
    expect((await topUpCredits(db, { tenantId, amount: 50, idempotencyKey: 't2', actor })).outcome).toBe('applied')
    expect(await walletBalance(tenantId)).toBe(150)
    const row = await db.prepare(`SELECT entry_type, amount, balance_after, actor_id, source FROM credit_ledger WHERE idempotency_key = 't1'`).first()
    expect(row).toMatchObject({ entry_type: 'topup', amount: 100, balance_after: 100, actor_id: actor.id, source: 'manual' })
  })
  it('replay/conflict by key', async () => {
    const { tenantId, actor } = await setupOrg()
    await topUpCredits(db, { tenantId, amount: 100, idempotencyKey: 'K', actor })
    expect((await topUpCredits(db, { tenantId, amount: 100, idempotencyKey: 'K', actor })).outcome).toBe('replay')
    expect((await topUpCredits(db, { tenantId, amount: 200, idempotencyKey: 'K', actor })).outcome).toBe('conflict')
    expect(await walletBalance(tenantId)).toBe(100)
  })
})

describe('adjustCredits (test14)', () => {
  it('credit/debit signed amount; debit beyond balance → insufficient; missing wallet → wallet_not_found', async () => {
    const { tenantId, actor } = await setupOrg()
    // missing wallet
    expect((await adjustCredits(db, { tenantId, amount: 10, direction: 'credit', idempotencyKey: 'a0', reason: 'x', actor })).outcome).toBe('wallet_not_found')
    await seedWallet({ tenantId, balance: 100 })
    expect((await adjustCredits(db, { tenantId, amount: 20, direction: 'debit', idempotencyKey: 'a1', reason: 'correction', actor })).outcome).toBe('applied')
    expect(await walletBalance(tenantId)).toBe(80)
    expect((await adjustCredits(db, { tenantId, amount: 30, direction: 'credit', idempotencyKey: 'a2', reason: 'goodwill', actor })).outcome).toBe('applied')
    expect(await walletBalance(tenantId)).toBe(110)
    expect((await adjustCredits(db, { tenantId, amount: 999, direction: 'debit', idempotencyKey: 'a3', reason: 'too much', actor })).outcome).toBe('insufficient_balance')
    const row = await db.prepare(`SELECT entry_type, amount, ref FROM credit_ledger WHERE idempotency_key = 'a1'`).first()
    expect(row).toMatchObject({ entry_type: 'adjust', amount: -20, ref: 'correction' })
  })
  it('reason required', async () => {
    const { tenantId, actor } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 })
    expect((await adjustCredits(db, { tenantId, amount: 1, direction: 'credit', idempotencyKey: 'r', reason: '   ', actor })).outcome).toBe('invalid')
  })
})

describe('setProductQuota (test15 / 15d / 15e / 15f)', () => {
  it('test15 create/raise/lower; lower below used rejected; no credit_ledger row; one qcl row per applied set', async () => {
    const { tenantId, productId, actor } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 10, quotaUsed: 8 })
    // raise 10 → 20
    expect((await setProductQuota(db, { tenantId, productId, quotaLimit: 20, adminIdempotencyKey: 's1', actor })).outcome).toBe('applied')
    // lower 20 → 5 (< used 8) rejected
    expect((await setProductQuota(db, { tenantId, productId, quotaLimit: 5, adminIdempotencyKey: 's2', actor })).outcome).toBe('quota_below_used')
    expect(await ledgerCount(tenantId)).toBe(0) // setQuota never writes credit_ledger
    // qcl: only the applied set wrote a row (rejected one rolled back)
    expect(await qclCount(tenantId)).toBe(1)
    const qcl = await db.prepare(`SELECT old_limit, new_limit FROM quota_config_ledger WHERE tenant_id = ? ORDER BY id`).bind(tenantId).first()
    expect(qcl).toMatchObject({ old_limit: 10, new_limit: 20 })
    // product_usage_quota.quota_limit == latest qcl.new_limit
    const cap = await db.prepare(`SELECT quota_limit FROM product_usage_quota WHERE tenant_id = ? AND product_id = ?`).bind(tenantId, productId).first<{ quota_limit: number }>()
    expect(cap?.quota_limit).toBe(20)
  })

  it('first-ever set: old_limit NULL (no prior quota row)', async () => {
    const { tenantId, productId, actor } = await setupOrg()
    expect((await setProductQuota(db, { tenantId, productId, quotaLimit: 40, adminIdempotencyKey: 'f1', actor })).outcome).toBe('applied')
    const qcl = await db.prepare(`SELECT old_limit, new_limit FROM quota_config_ledger WHERE tenant_id = ?`).bind(tenantId).first()
    expect(qcl).toMatchObject({ old_limit: null, new_limit: 40 })
    const cap = await db.prepare(`SELECT quota_limit, quota_used FROM product_usage_quota WHERE tenant_id = ? AND product_id = ?`).bind(tenantId, productId).first()
    expect(cap).toMatchObject({ quota_limit: 40, quota_used: 0 })
  })

  it('test15d durable idempotency: retry same key+payload → replay (NOT applied), exactly one qcl row; diff payload → conflict', async () => {
    const { tenantId, productId, actor } = await setupOrg()
    const r1 = await setProductQuota(db, { tenantId, productId, quotaLimit: 20, adminIdempotencyKey: 'K', actor })
    expect(r1.outcome).toBe('applied')
    // identical retry → replay (codex Gate-2: must NOT be 'applied', else endpoint re-emits billing.quota.set)
    const r2 = await setProductQuota(db, { tenantId, productId, quotaLimit: 20, adminIdempotencyKey: 'K', actor })
    expect(r2.outcome).toBe('replay')
    if (r2.outcome === 'replay') expect(r2.quotaLimit).toBe(20) // carries prior new_limit
    expect(await qclCount(tenantId)).toBe(1) // NO spurious second authoritative row
    // same key, different limit → conflict
    const r3 = await setProductQuota(db, { tenantId, productId, quotaLimit: 30, adminIdempotencyKey: 'K', actor })
    expect(r3.outcome).toBe('conflict')
    expect(await qclCount(tenantId)).toBe(1)
    // a different key for the same product+period → a new legit config row
    expect((await setProductQuota(db, { tenantId, productId, quotaLimit: 30, adminIdempotencyKey: 'K2', actor })).outcome).toBe('applied')
    expect(await qclCount(tenantId)).toBe(2)
  })

  it('test15e unsupported period → invalid, no write', async () => {
    const { tenantId, productId, actor } = await setupOrg()
    const r = await setProductQuota(db, { tenantId, productId, quotaLimit: 10, adminIdempotencyKey: 'p', actor, period: '2026-06' })
    expect(r).toMatchObject({ outcome: 'invalid', code: 'UNSUPPORTED_PERIOD' })
    expect(await qclCount(tenantId)).toBe(0)
  })

  it('test15f closed tenant → tenant_ineligible', async () => {
    const c = await setupOrg({ tenantStatus: 'closed' })
    expect((await setProductQuota(db, { tenantId: c.tenantId, productId: c.productId, quotaLimit: 10, adminIdempotencyKey: 'a', actor: c.actor })).outcome).toBe('tenant_ineligible')
  })
  it('test15f inactive product → product_inactive', async () => {
    const i = await setupOrg({ productActive: 0 })
    expect((await setProductQuota(db, { tenantId: i.tenantId, productId: i.productId, quotaLimit: 10, adminIdempotencyKey: 'b', actor: i.actor })).outcome).toBe('product_inactive')
  })
  it('test15f org-only product on personal tenant → product_tenant_type_mismatch', async () => {
    const owner = await seedUser({ email: 'o@x.io', role: 'player' })
    const pt = await seedTenant({ type: 'personal', name: 'P', ownerUserId: owner.id })
    await seedProduct({ id: 'erp', name: 'ERP', tenantScope: 'organization' })
    expect((await setProductQuota(db, { tenantId: pt.id, productId: 'erp', quotaLimit: 10, adminIdempotencyKey: 'c', actor: { id: owner.id, email: 'staff@x.io', role: 'admin' } })).outcome).toBe('product_tenant_type_mismatch')
  })
})

// ─────────────────── reconciliation invariant (test16) ───────────────────

describe('reconciliation invariant (test16)', () => {
  it('balance == SUM(ledger.amount); quota_used == -SUM(deduct amount by period)', async () => {
    const { tenantId, productId, actor } = await setupOrg()
    await seedProduct({ id: 'senior-app', name: 'Senior', tenantScope: 'any' })
    await topUpCredits(db, { tenantId, amount: 100, idempotencyKey: 't1', actor })
    await setProductQuota(db, { tenantId, productId, quotaLimit: 50, adminIdempotencyKey: 'q1', actor })
    await setProductQuota(db, { tenantId, productId: 'senior-app', quotaLimit: 50, adminIdempotencyKey: 'q2', actor })
    await deductCredits(db, deductInput({ tenantId, productId, amount: 10, idempotencyKey: 'd1' }))
    await deductCredits(db, deductInput({ tenantId, productId, amount: 5, idempotencyKey: 'd2' }))
    await deductCredits(db, deductInput({ tenantId, productId: 'senior-app', amount: 7, idempotencyKey: 'd3' }))
    await adjustCredits(db, { tenantId, amount: 8, direction: 'debit', idempotencyKey: 'a1', reason: 'fix', actor })

    const sum = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM credit_ledger WHERE tenant_id = ?`).bind(tenantId).first<{ s: number }>()
    expect(await walletBalance(tenantId)).toBe(Number(sum?.s)) // 100 -10 -5 -7 -8 = 70
    expect(await walletBalance(tenantId)).toBe(70)
    // per-product quota_used == magnitude of deduct sum
    const erpDeduct = await db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM credit_ledger WHERE tenant_id = ? AND product_id = 'erp' AND entry_type='deduct'`).bind(tenantId).first<{ s: number }>()
    expect(await quotaUsed(tenantId, 'erp')).toBe(-Number(erpDeduct?.s)) // 15
    expect(await quotaUsed(tenantId, 'erp')).toBe(15)
    expect(await quotaUsed(tenantId, 'senior-app')).toBe(7)
  })
})

// ─────────────────── actor snapshot survives mutation/deletion (test17) ───────────────────

describe('actor snapshot survives mutation/deletion (test17)', () => {
  it('manual ledger actor snapshot unchanged after actor email/role change + hard delete', async () => {
    const { tenantId, productId, actor } = await setupOrg()
    await seedWallet({ tenantId, balance: 100 }); await seedQuota({ tenantId, productId, quotaLimit: 50 })
    await deductCredits(db, { tenantId, productId, amount: 5, idempotencyKey: 'm', source: 'manual', actor })
    await db.prepare(`UPDATE users SET email='changed@x.io', role='player' WHERE id = ?`).bind(actor.id).run()
    await db.prepare(`DELETE FROM users WHERE id = ?`).bind(actor.id).run() // no FK on actor_id
    const row = await db.prepare(`SELECT actor_id, actor_email, actor_role FROM credit_ledger WHERE tenant_id = ?`).bind(tenantId).first()
    expect(row).toMatchObject({ actor_id: actor.id, actor_email: actor.email, actor_role: actor.role })
  })
})

// ─────────────────── DB CHECK value-invariant negatives (test2 / 2b / 2c) ───────────────────

describe('DB CHECK negatives (raw insert hits the named constraint)', () => {
  let tenantId: number, productId: string, actorId: number
  beforeEach(async () => {
    const s = await setupOrg()
    tenantId = s.tenantId; productId = s.productId; actorId = s.actor.id
  })

  it('test2 wallet/quota base CHECKs', async () => {
    await expect(db.prepare(`INSERT INTO credit_wallets (tenant_id, balance) VALUES (?, -1)`).bind(tenantId).run()).rejects.toThrow()
    await expect(db.prepare(`INSERT INTO product_usage_quota (tenant_id, product_id, period, quota_limit, quota_used) VALUES (?,?,'lifetime',10,11)`).bind(tenantId, productId).run()).rejects.toThrow()
    await expect(db.prepare(`INSERT INTO product_usage_quota (tenant_id, product_id, period, quota_limit, quota_used) VALUES (?,?,'lifetime',10,-1)`).bind(tenantId, productId).run()).rejects.toThrow()
  })

  it('test2 ledger amount-sign + amount<>0 + deduct snapshot CHECKs', async () => {
    const base = (cols: string, vals: string, ...binds: unknown[]) =>
      db.prepare(`INSERT INTO credit_ledger (tenant_id, entry_type, amount, balance_after, idempotency_scope, idempotency_key, request_hash, source, occurred_at${cols}) VALUES (?,?,?,?,?,?,?,?,?${vals})`).bind(tenantId, ...binds)
    // topup with negative amount
    await expect(base('', '', 'topup', -5, 10, 's', 'k1', 'h', 'product', 'T').run()).rejects.toThrow()
    // deduct with positive amount
    await expect(base('', '', 'deduct', 5, 10, 's', 'k2', 'h', 'product', 'T').run()).rejects.toThrow()
    // amount = 0
    await expect(base('', '', 'topup', 0, 10, 's', 'k3', 'h', 'product', 'T').run()).rejects.toThrow()
    // deduct missing product_id / quota snapshot (product_id NULL)
    await expect(db.prepare(
      `INSERT INTO credit_ledger (tenant_id, product_id, entry_type, amount, balance_after, idempotency_scope, idempotency_key, request_hash, source, occurred_at)
       VALUES (?, NULL, 'deduct', -5, 10, 's', 'k4', 'h', 'product', 'T')`,
    ).bind(tenantId).run()).rejects.toThrow()
  })

  it('test2 manual actor exclusivity', async () => {
    // source=manual missing actor
    await expect(db.prepare(
      `INSERT INTO credit_ledger (tenant_id, entry_type, amount, balance_after, idempotency_scope, idempotency_key, request_hash, source, occurred_at)
       VALUES (?, 'topup', 5, 10, 's', 'k1', 'h', 'manual', 'T')`,
    ).bind(tenantId).run()).rejects.toThrow()
    // source=product WITH actor
    await expect(db.prepare(
      `INSERT INTO credit_ledger (tenant_id, entry_type, amount, balance_after, idempotency_scope, idempotency_key, request_hash, source, actor_id, actor_email, actor_role, occurred_at)
       VALUES (?, 'topup', 5, 10, 's', 'k2', 'h', 'product', ?, 'a@x', 'admin', 'T')`,
    ).bind(tenantId, actorId).run()).rejects.toThrow()
  })

  it('test2b snapshot VALUE invariants', async () => {
    // balance_after = -1
    await expect(db.prepare(
      `INSERT INTO credit_ledger (tenant_id, entry_type, amount, balance_after, idempotency_scope, idempotency_key, request_hash, source, occurred_at)
       VALUES (?, 'topup', 5, -1, 's', 'b1', 'h', 'product', 'T')`,
    ).bind(tenantId).run()).rejects.toThrow()
    // deduct quota_used_after = -1
    await expect(db.prepare(
      `INSERT INTO credit_ledger (tenant_id, product_id, entry_type, amount, balance_after, quota_used_after, quota_limit_after, quota_period, idempotency_scope, idempotency_key, request_hash, source, occurred_at)
       VALUES (?, ?, 'deduct', -5, 10, -1, 10, 'lifetime', 's', 'b2', 'h', 'product', 'T')`,
    ).bind(tenantId, productId).run()).rejects.toThrow()
    // deduct quota_used_after > quota_limit_after (11 > 10)
    await expect(db.prepare(
      `INSERT INTO credit_ledger (tenant_id, product_id, entry_type, amount, balance_after, quota_used_after, quota_limit_after, quota_period, idempotency_scope, idempotency_key, request_hash, source, occurred_at)
       VALUES (?, ?, 'deduct', -5, 10, 11, 10, 'lifetime', 's', 'b3', 'h', 'product', 'T')`,
    ).bind(tenantId, productId).run()).rejects.toThrow()
    // wallet-level row (NULL quota_*) still inserts
    await db.prepare(
      `INSERT INTO credit_ledger (tenant_id, entry_type, amount, balance_after, idempotency_scope, idempotency_key, request_hash, source, occurred_at)
       VALUES (?, 'topup', 5, 5, 's', 'b4', 'h', 'product', 'T')`,
    ).bind(tenantId).run()
    expect(await ledgerCount(tenantId)).toBe(1)
  })

  it('test2c quota_config_ledger CHECKs + UNIQUE', async () => {
    const ins = (key: string, newLimit: number, email: string, role: string) =>
      db.prepare(
        `INSERT INTO quota_config_ledger (tenant_id, product_id, period, new_limit, idempotency_scope, idempotency_key, request_hash, actor_id, actor_email, actor_role, occurred_at)
         VALUES (?, ?, 'lifetime', ?, 'manual:quota_set:erp:lifetime', ?, 'h', ?, ?, ?, 'T')`,
      ).bind(tenantId, productId, newLimit, key, actorId, email, role)
    await expect(ins('n1', -1, 'a@x', 'admin').run()).rejects.toThrow() // new_limit -1
    await expect(ins('n2', 10, '   ', 'admin').run()).rejects.toThrow() // blank actor_email
    await expect(ins('n3', 10, 'a@x', '  ').run()).rejects.toThrow()    // blank actor_role
    // valid insert, then duplicate (tenant, scope, key) rejected
    await ins('dup', 10, 'a@x', 'admin').run()
    await expect(ins('dup', 20, 'a@x', 'admin').run()).rejects.toThrow()
  })
})
