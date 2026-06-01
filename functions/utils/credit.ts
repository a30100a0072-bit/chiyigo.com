/**
 * Credit Wallet / Quota / Ledger domain module — PR3.
 *
 * 設計：docs/reviews/pr3-credit-wallet-plan-2026-06-01.md（Codex Gate 1 approved）。
 * Schema：migration 0049（credit_wallets / product_usage_quota / credit_ledger / quota_config_ledger）。
 *
 * 架構決策 (3)：single tenant wallet + per-product quota。quota 與 wallet 同幣別 —— 一次 deduct N
 *   同時扣 wallet N 與計 quota N（quota_limit = 該 product 對共用餘額的子上限，plan §5.2 unit model）。
 *
 * Append-only 紀律（同 billing.ts / audit_log house style）：credit_ledger / quota_config_ledger
 *   皆「只 INSERT」，本模組不提供任何 update/delete ledger path。fail-closed 正確性靠
 *   CHECK / NOT NULL / UNIQUE / D1.batch() rollback（Stage 0 spike codex-approved），不靠 changes()。
 *
 * 錯誤分類不靠解析 batch error message（D1/SQLite 訊息字串版本相依）：一律 re-read DB state 判斷
 *   （plan §5.2.1）。命名約束（ck_*）只供 observability，不參與 control flow。
 *
 * NAMING TRAP：credit_wallets 與既有 user_wallets / wallet_nonces（web3 EIP-1193，0023）完全無關。
 */

import { hashToken } from './crypto'

/** D1 binding 型別取自 ambient `Env` indexed access（同 tenant-context.ts / billing.ts 慣例）。 */
type ChiyigoDb = Env['chiyigo_db']

/** 上限防呆：擋打錯的 9 位數扣點/儲值；遠低於 ledger balance_after sane-ceiling（1e12）。 */
const MAX_CREDIT_AMOUNT = 1_000_000_000
const MAX_QUOTA_LIMIT = 1_000_000_000
const MAX_KEY_LEN = 200
const MAX_REF_LEN = 1000
const MAX_RETRIES = 4
/** PR3 只支援單一 period（plan 決策 4）；非此值一律 reject（codex round-2 finding 2）。 */
const SUPPORTED_PERIOD = 'lifetime'

export type CreditSource = 'manual' | 'product' | 'payment'

/** 授權本次 manual 操作的 chiyigo staff actor 快照（由 endpoint 從 step-up token + users row 取得）。 */
export interface CreditActor {
  id: number
  email: string
  role: string
}

export type CreditOutcome =
  | { outcome: 'applied'; operationId: number; balance: number; quotaUsed?: number; quotaLimit?: number }
  | { outcome: 'replay'; operationId: number; balance: number; quotaLimit?: number }
  | { outcome: 'conflict' }                              // 同 (tenant,scope,key)、異 params → 409 IDEMPOTENCY_CONFLICT
  | { outcome: 'insufficient_balance' }                  // 402
  | { outcome: 'quota_exceeded' }                        // 402
  | { outcome: 'wallet_not_found' }                      // 409 WALLET_NOT_PROVISIONED
  | { outcome: 'quota_not_found' }                       // 409 QUOTA_NOT_PROVISIONED
  | { outcome: 'quota_below_used' }                      // 409 QUOTA_BELOW_USAGE（setQuota 調降低於已用）
  | { outcome: 'tenant_ineligible' }                     // 422
  | { outcome: 'product_inactive' }                      // 422
  | { outcome: 'product_tenant_type_mismatch' }          // 422
  | { outcome: 'invalid'; code: string }                 // 400（ERR_VALIDATION / UNSUPPORTED_PERIOD）
  | { outcome: 'contention' }                            // 503（重試耗盡；fail-closed，無 partial write）

// ── inputs ───────────────────────────────────────────────────────────────────

export interface DeductCreditsInput {
  tenantId: number
  productId: string
  amount: number            // 正整數扣點量（ledger 存 -amount；quota_used += amount）
  idempotencyKey: string
  source: CreditSource      // 'product'（產品回報用量）或 'manual'（admin 測試/校正）
  period?: string           // 預設 'lifetime'
  ref?: string
  actor?: CreditActor       // source='manual' 必填，否則必須不帶
}

export interface TopUpCreditsInput {
  tenantId: number
  amount: number            // 正整數
  idempotencyKey: string
  actor: CreditActor
  ref?: string
}

export interface AdjustCreditsInput {
  tenantId: number
  amount: number            // 正整數量值（方向由 direction 決定）
  direction: 'credit' | 'debit'
  idempotencyKey: string
  reason: string            // 必填，存進 ledger.ref
  actor: CreditActor
}

export interface SetProductQuotaInput {
  tenantId: number
  productId: string
  quotaLimit: number        // 非負整數
  adminIdempotencyKey: string
  actor: CreditActor
  period?: string           // 預設 'lifetime'
  reason?: string
}

// ── shared helpers ─────────────────────────────────────────────────────────────

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}
function isNonNegativeInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

/** 排序鍵的穩定序列化（request_hash 用；deterministic）。 */
function canonicalJson(obj: Record<string, string | number>): string {
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(obj[k])).join(',') + '}'
}

/**
 * request_hash：只含 accepted semantic 欄位，用「簽名後的有效 amount」（非正量值），
 * 並含 period（codex round-2 finding 2：未來 monthly period 時同 key/同量/異 period 不誤判 replay）。
 * 排除 idempotency_key / actor / 時間。
 */
function creditRequestHash(input: {
  tenantId: number; productId: string | null; entryType: string; signedAmount: number;
  period: string | null; ref: string | null; source: string
}): Promise<string> {
  return hashToken(canonicalJson({
    tenant_id: input.tenantId,
    product_id: input.productId ?? '',
    entry_type: input.entryType,
    signed_amount: input.signedAmount,
    period: input.period ?? '',
    ref: input.ref ?? '',
    source: input.source,
  }))
}

function validateActor(actor: unknown): actor is CreditActor {
  if (!actor || typeof actor !== 'object') return false
  const a = actor as Record<string, unknown>
  return (
    isPositiveInt(a.id)
    && typeof a.email === 'string' && a.email.trim().length > 0
    && typeof a.role === 'string' && a.role.trim().length > 0
  )
}

interface ExistingLedgerRow {
  id: number
  request_hash: string
  balance_after: number
}

/** 依 (tenant_id, idempotency_scope, idempotency_key) 查既有 credit_ledger row。 */
async function findCreditLedger(
  db: ChiyigoDb, tenantId: number, scope: string, key: string,
): Promise<ExistingLedgerRow | null> {
  return db
    .prepare(
      `SELECT id, request_hash, balance_after FROM credit_ledger
        WHERE tenant_id = ? AND idempotency_scope = ? AND idempotency_key = ?`,
    )
    .bind(tenantId, scope, key)
    .first<ExistingLedgerRow>()
}

/** replay/conflict 判定（命中既有 row 時用）。 */
function replayOrConflict(ex: ExistingLedgerRow, requestHash: string): CreditOutcome {
  return ex.request_hash === requestHash
    ? { outcome: 'replay', operationId: ex.id, balance: ex.balance_after }
    : { outcome: 'conflict' }
}

interface TenantRow { type: string; status: string; deleted_at: string | null }

/** tenant 必 active + 未軟刪（server lookup；deny 不寫入）。 */
async function loadEligibleTenant(db: ChiyigoDb, tenantId: number): Promise<TenantRow | null> {
  const t = await db
    .prepare(`SELECT type, status, deleted_at FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first<TenantRow>()
  if (!t || t.deleted_at !== null || t.status !== 'active') return null
  return t
}

// ── deductCredits（Tier-0 atomic core）─────────────────────────────────────────

/**
 * 扣點：wallet 餘額 -amount + product quota_used +amount + credit_ledger INSERT，整段在單一
 *   D1.batch() 原子交易；任一 CHECK / NOT NULL / UNIQUE 違反 → 整批 rollback（fail-closed，無半扣）。
 *
 * @param db  `env.chiyigo_db`
 * @returns 結構化 outcome（caller/endpoint 映射 HTTP）
 */
export async function deductCredits(db: ChiyigoDb, input: DeductCreditsInput): Promise<CreditOutcome> {
  // 1. strict validation
  if (!input || typeof input !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.tenantId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.productId !== 'string' || input.productId.length === 0) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.amount) || input.amount > MAX_CREDIT_AMOUNT) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const period = input.period === undefined ? SUPPORTED_PERIOD : input.period
  if (period !== SUPPORTED_PERIOD) return { outcome: 'invalid', code: 'UNSUPPORTED_PERIOD' }
  if (typeof input.idempotencyKey !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const key = input.idempotencyKey.trim()
  if (key.length === 0 || key.length > MAX_KEY_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (input.source !== 'product' && input.source !== 'manual') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  let ref: string | null = null
  if (input.ref !== undefined && input.ref !== null) {
    if (typeof input.ref !== 'string' || input.ref.length > MAX_REF_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
    ref = input.ref
  }
  // actor：source='manual' 必填、其他必須不帶
  let actorId: number | null = null, actorEmail: string | null = null, actorRole: string | null = null
  if (input.source === 'manual') {
    if (!validateActor(input.actor)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
    actorId = input.actor.id; actorEmail = input.actor.email; actorRole = input.actor.role
  } else if (input.actor !== undefined && input.actor !== null) {
    return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  }

  const scope = 'product:' + input.productId
  const occurredAt = new Date().toISOString()
  const requestHash = await creditRequestHash({
    tenantId: input.tenantId, productId: input.productId, entryType: 'deduct',
    signedAmount: -input.amount, period, ref, source: input.source,
  })

  // 4. idempotency pre-check
  const existing = await findCreditLedger(db, input.tenantId, scope, key)
  if (existing) return replayOrConflict(existing, requestHash)

  // 5. eligibility（tenant active；product active；scope 不在 deduct 重查 —— 由 provision 階段把關，plan §5.2）
  const tenant = await loadEligibleTenant(db, input.tenantId)
  if (!tenant) return { outcome: 'tenant_ineligible' }
  const product = await db
    .prepare(`SELECT is_active FROM products WHERE id = ?`)
    .bind(input.productId)
    .first<{ is_active: number }>()
  if (!product || product.is_active !== 1) return { outcome: 'product_inactive' }

  // 6+7. bounded-retry：每輪 re-read 做 deterministic 精確分類，再原子 batch；throw 一律 re-read 判斷
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const wallet = await db
      .prepare(`SELECT balance FROM credit_wallets WHERE tenant_id = ?`)
      .bind(input.tenantId)
      .first<{ balance: number }>()
    if (!wallet) return { outcome: 'wallet_not_found' }
    const quota = await db
      .prepare(`SELECT quota_used, quota_limit FROM product_usage_quota WHERE tenant_id = ? AND product_id = ? AND period = ?`)
      .bind(input.tenantId, input.productId, period)
      .first<{ quota_used: number; quota_limit: number }>()
    if (!quota) return { outcome: 'quota_not_found' }
    if (wallet.balance < input.amount) return { outcome: 'insufficient_balance' }
    if (quota.quota_used + input.amount > quota.quota_limit) return { outcome: 'quota_exceeded' }

    const quotaUpdate = db
      .prepare(
        `UPDATE product_usage_quota
            SET quota_used = quota_used + ?, version = version + 1, updated_at = datetime('now')
          WHERE tenant_id = ? AND product_id = ? AND period = ?`,
      )
      .bind(input.amount, input.tenantId, input.productId, period)
    const walletUpdate = db
      .prepare(
        `UPDATE credit_wallets
            SET balance = balance - ?, version = version + 1, updated_at = datetime('now')
          WHERE tenant_id = ?`,
      )
      .bind(input.amount, input.tenantId)
    const ledgerInsert = db
      .prepare(
        `INSERT INTO credit_ledger
           (tenant_id, product_id, entry_type, amount, balance_after, quota_used_after, quota_limit_after,
            quota_period, idempotency_scope, idempotency_key, request_hash, ref, source,
            actor_id, actor_email, actor_role, occurred_at)
         VALUES (?, ?, 'deduct', ?,
            (SELECT balance FROM credit_wallets WHERE tenant_id = ?),
            (SELECT quota_used  FROM product_usage_quota WHERE tenant_id = ? AND product_id = ? AND period = ?),
            (SELECT quota_limit FROM product_usage_quota WHERE tenant_id = ? AND product_id = ? AND period = ?),
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.tenantId, input.productId, -input.amount,
        input.tenantId,
        input.tenantId, input.productId, period,
        input.tenantId, input.productId, period,
        period, scope, key, requestHash, ref, input.source,
        actorId, actorEmail, actorRole, occurredAt,
      )

    try {
      await db.batch([quotaUpdate, walletUpdate, ledgerInsert])
    } catch {
      // message-independent：先看 idempotency row 是否已被並發寫入 → replay/conflict
      const ex2 = await findCreditLedger(db, input.tenantId, scope, key)
      if (ex2) return replayOrConflict(ex2, requestHash)
      // 否則：並發改了 balance/quota 造成 guard 違反 → 下一輪 re-read 會給出 deterministic outcome；
      //   再記錄不到原因就當 transient 重試 → 耗盡為 contention。
      continue
    }

    // 回讀 committed ledger row：balance/quota 皆取 row 上的 *_after（batch 內 subquery 寫入的真值），
    // 不用 batch 前的 stale read 計算（並發下會偏差；ledger row 才權威）。
    const row = await db
      .prepare(
        `SELECT id, balance_after, quota_used_after, quota_limit_after FROM credit_ledger
          WHERE tenant_id = ? AND idempotency_scope = ? AND idempotency_key = ?`,
      )
      .bind(input.tenantId, scope, key)
      .first<{ id: number; balance_after: number; quota_used_after: number; quota_limit_after: number }>()
    return {
      outcome: 'applied',
      operationId: row ? row.id : 0,
      balance: row ? row.balance_after : 0,
      quotaUsed: row ? row.quota_used_after : quota.quota_used + input.amount,
      quotaLimit: row ? row.quota_limit_after : quota.quota_limit,
    }
  }
  return { outcome: 'contention' }
}

// ── topUpCredits（manual admin；wallet 不存在則 UPSERT 建立）──────────────────────

export async function topUpCredits(db: ChiyigoDb, input: TopUpCreditsInput): Promise<CreditOutcome> {
  if (!input || typeof input !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.tenantId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.amount) || input.amount > MAX_CREDIT_AMOUNT) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.idempotencyKey !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const key = input.idempotencyKey.trim()
  if (key.length === 0 || key.length > MAX_KEY_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!validateActor(input.actor)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  let ref: string | null = null
  if (input.ref !== undefined && input.ref !== null) {
    if (typeof input.ref !== 'string' || input.ref.length > MAX_REF_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
    ref = input.ref
  }

  const scope = 'manual:topup'
  const occurredAt = new Date().toISOString()
  const requestHash = await creditRequestHash({
    tenantId: input.tenantId, productId: null, entryType: 'topup',
    signedAmount: input.amount, period: null, ref, source: 'manual',
  })

  const existing = await findCreditLedger(db, input.tenantId, scope, key)
  if (existing) return replayOrConflict(existing, requestHash)

  const tenant = await loadEligibleTenant(db, input.tenantId)
  if (!tenant) return { outcome: 'tenant_ineligible' }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const walletUpsert = db
      .prepare(
        `INSERT INTO credit_wallets (tenant_id, balance) VALUES (?, ?)
         ON CONFLICT(tenant_id) DO UPDATE
            SET balance = balance + ?, version = version + 1, updated_at = datetime('now')`,
      )
      .bind(input.tenantId, input.amount, input.amount)
    const ledgerInsert = db
      .prepare(
        `INSERT INTO credit_ledger
           (tenant_id, product_id, entry_type, amount, balance_after, quota_used_after, quota_limit_after,
            quota_period, idempotency_scope, idempotency_key, request_hash, ref, source,
            actor_id, actor_email, actor_role, occurred_at)
         VALUES (?, NULL, 'topup', ?,
            (SELECT balance FROM credit_wallets WHERE tenant_id = ?),
            NULL, NULL, NULL, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
      )
      .bind(
        input.tenantId, input.amount, input.tenantId,
        scope, key, requestHash, ref,
        input.actor.id, input.actor.email, input.actor.role, occurredAt,
      )

    try {
      await db.batch([walletUpsert, ledgerInsert])
    } catch {
      const ex2 = await findCreditLedger(db, input.tenantId, scope, key)
      if (ex2) return replayOrConflict(ex2, requestHash)
      continue
    }

    const row = await findCreditLedger(db, input.tenantId, scope, key)
    return { outcome: 'applied', operationId: row ? row.id : 0, balance: row ? row.balance_after : 0 }
  }
  return { outcome: 'contention' }
}

// ── adjustCredits（manual admin；簽名校正，必帶 reason；plain UPDATE 不 provision）──────

export async function adjustCredits(db: ChiyigoDb, input: AdjustCreditsInput): Promise<CreditOutcome> {
  if (!input || typeof input !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.tenantId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.amount) || input.amount > MAX_CREDIT_AMOUNT) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (input.direction !== 'credit' && input.direction !== 'debit') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.idempotencyKey !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const key = input.idempotencyKey.trim()
  if (key.length === 0 || key.length > MAX_KEY_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.reason !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const reason = input.reason.trim()
  if (reason.length === 0 || reason.length > MAX_REF_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!validateActor(input.actor)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }

  const signed = input.direction === 'debit' ? -input.amount : input.amount
  const scope = 'manual:adjust'
  const occurredAt = new Date().toISOString()
  const requestHash = await creditRequestHash({
    tenantId: input.tenantId, productId: null, entryType: 'adjust',
    signedAmount: signed, period: null, ref: reason, source: 'manual',
  })

  const existing = await findCreditLedger(db, input.tenantId, scope, key)
  if (existing) return replayOrConflict(existing, requestHash)

  const tenant = await loadEligibleTenant(db, input.tenantId)
  if (!tenant) return { outcome: 'tenant_ineligible' }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const wallet = await db
      .prepare(`SELECT balance FROM credit_wallets WHERE tenant_id = ?`)
      .bind(input.tenantId)
      .first<{ balance: number }>()
    if (!wallet) return { outcome: 'wallet_not_found' }
    if (wallet.balance + signed < 0) return { outcome: 'insufficient_balance' }

    const walletUpdate = db
      .prepare(
        `UPDATE credit_wallets
            SET balance = balance + ?, version = version + 1, updated_at = datetime('now')
          WHERE tenant_id = ?`,
      )
      .bind(signed, input.tenantId)
    const ledgerInsert = db
      .prepare(
        `INSERT INTO credit_ledger
           (tenant_id, product_id, entry_type, amount, balance_after, quota_used_after, quota_limit_after,
            quota_period, idempotency_scope, idempotency_key, request_hash, ref, source,
            actor_id, actor_email, actor_role, occurred_at)
         VALUES (?, NULL, 'adjust', ?,
            (SELECT balance FROM credit_wallets WHERE tenant_id = ?),
            NULL, NULL, NULL, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
      )
      .bind(
        input.tenantId, signed, input.tenantId,
        scope, key, requestHash, reason,
        input.actor.id, input.actor.email, input.actor.role, occurredAt,
      )

    try {
      await db.batch([walletUpdate, ledgerInsert])
    } catch {
      const ex2 = await findCreditLedger(db, input.tenantId, scope, key)
      if (ex2) return replayOrConflict(ex2, requestHash)
      continue
    }

    const row = await findCreditLedger(db, input.tenantId, scope, key)
    return { outcome: 'applied', operationId: row ? row.id : 0, balance: row ? row.balance_after : 0 }
  }
  return { outcome: 'contention' }
}

// ── setProductQuota（manual admin；config op，寫 authoritative quota_config_ledger in-batch）──────

interface ExistingQclRow { id: number; request_hash: string; new_limit: number }

export async function setProductQuota(db: ChiyigoDb, input: SetProductQuotaInput): Promise<CreditOutcome> {
  if (!input || typeof input !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.tenantId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.productId !== 'string' || input.productId.length === 0) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isNonNegativeInt(input.quotaLimit) || input.quotaLimit > MAX_QUOTA_LIMIT) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const period = input.period === undefined ? SUPPORTED_PERIOD : input.period
  if (period !== SUPPORTED_PERIOD) return { outcome: 'invalid', code: 'UNSUPPORTED_PERIOD' }
  if (typeof input.adminIdempotencyKey !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const key = input.adminIdempotencyKey.trim()
  if (key.length === 0 || key.length > MAX_KEY_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!validateActor(input.actor)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  let reason: string | null = null
  if (input.reason !== undefined && input.reason !== null) {
    if (typeof input.reason !== 'string' || input.reason.length > MAX_REF_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
    const r = input.reason.trim()
    reason = r.length > 0 ? r : null
  }

  const scope = `manual:quota_set:${input.productId}:${period}`
  const occurredAt = new Date().toISOString()
  const requestHash = await hashToken(canonicalJson({
    tenant_id: input.tenantId, product_id: input.productId, period,
    new_limit: input.quotaLimit, reason: reason ?? '',
  }))

  // idempotency pre-check（quota_config_ledger）
  const existing = await db
    .prepare(
      `SELECT id, request_hash, new_limit FROM quota_config_ledger
        WHERE tenant_id = ? AND idempotency_scope = ? AND idempotency_key = ?`,
    )
    .bind(input.tenantId, scope, key)
    .first<ExistingQclRow>()
  if (existing) {
    // 同 hash = 重放（durable idempotency）：回 replay，**不**再走 billing.quota.set telemetry（codex Gate-2）。
    return existing.request_hash === requestHash
      ? { outcome: 'replay', operationId: existing.id, balance: 0, quotaLimit: existing.new_limit }
      : { outcome: 'conflict' }
  }

  // eligibility：tenant active；product active + tenant_scope 相容（provisioning gate）
  const tenant = await loadEligibleTenant(db, input.tenantId)
  if (!tenant) return { outcome: 'tenant_ineligible' }
  const product = await db
    .prepare(`SELECT tenant_scope, is_active FROM products WHERE id = ?`)
    .bind(input.productId)
    .first<{ tenant_scope: string; is_active: number }>()
  if (!product || product.is_active !== 1) return { outcome: 'product_inactive' }
  if (product.tenant_scope !== 'any' && product.tenant_scope !== tenant.type) return { outcome: 'product_tenant_type_mismatch' }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // S1 先 INSERT ledger（old_limit 由 subquery 取 pre-update 值）；S2 再 UPSERT 上限。
    const qclInsert = db
      .prepare(
        `INSERT INTO quota_config_ledger
           (tenant_id, product_id, period, old_limit, new_limit,
            idempotency_scope, idempotency_key, request_hash, actor_id, actor_email, actor_role, reason, occurred_at)
         VALUES (?, ?, ?,
            (SELECT quota_limit FROM product_usage_quota WHERE tenant_id = ? AND product_id = ? AND period = ?),
            ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.tenantId, input.productId, period,
        input.tenantId, input.productId, period,
        input.quotaLimit, scope, key, requestHash,
        input.actor.id, input.actor.email, input.actor.role, reason, occurredAt,
      )
    const quotaUpsert = db
      .prepare(
        `INSERT INTO product_usage_quota (tenant_id, product_id, period, quota_limit) VALUES (?, ?, ?, ?)
         ON CONFLICT(tenant_id, product_id, period) DO UPDATE
            SET quota_limit = ?, version = version + 1, updated_at = datetime('now')`,
      )
      .bind(input.tenantId, input.productId, period, input.quotaLimit, input.quotaLimit)

    try {
      await db.batch([qclInsert, quotaUpsert])
    } catch {
      // 先看 idempotency row（並發同 key）→ replay/conflict
      const ex2 = await db
        .prepare(
          `SELECT id, request_hash, new_limit FROM quota_config_ledger
            WHERE tenant_id = ? AND idempotency_scope = ? AND idempotency_key = ?`,
        )
        .bind(input.tenantId, scope, key)
        .first<ExistingQclRow>()
      if (ex2) {
        // 並發同 key 搶先：同 hash = 重放（回 replay，非 applied），異 hash = 衝突。
        return ex2.request_hash === requestHash
          ? { outcome: 'replay', operationId: ex2.id, balance: 0, quotaLimit: ex2.new_limit }
          : { outcome: 'conflict' }
      }
      // 否則：調降低於已用（quota_used <= quota_limit CHECK 違反整批 rollback）→ re-read 判定
      const q = await db
        .prepare(`SELECT quota_used FROM product_usage_quota WHERE tenant_id = ? AND product_id = ? AND period = ?`)
        .bind(input.tenantId, input.productId, period)
        .first<{ quota_used: number }>()
      if (q && input.quotaLimit < q.quota_used) return { outcome: 'quota_below_used' }
      continue
    }

    const row = await db
      .prepare(
        `SELECT id FROM quota_config_ledger
          WHERE tenant_id = ? AND idempotency_scope = ? AND idempotency_key = ?`,
      )
      .bind(input.tenantId, scope, key)
      .first<{ id: number }>()
    return { outcome: 'applied', operationId: row ? row.id : 0, balance: 0, quotaLimit: input.quotaLimit }
  }
  return { outcome: 'contention' }
}
