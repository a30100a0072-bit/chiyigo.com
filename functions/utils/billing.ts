/**
 * Billing / Entitlement domain module — PR2 (manual grantPlan only).
 *
 * 設計：docs/reviews/pr2-billing-entitlement-plan-2026-05-30.md §4 / §5（Codex Gate 1 approved，Rev 3.3）。
 * Schema：migration 0048（Commit 1 `ce48b14`）。
 *
 * Append-only 紀律（plan drift 2026-05-30，owner option 1）：`grant_plan_operations` 由本模組「**只 INSERT**」
 *   保證 append-only —— 無 DB trigger、**不提供任何 update/delete ledger path**，對齊 audit_log / admin_audit_log
 *   house style。fail-closed 正確性靠 CHECK / UNIQUE / `D1.batch()` rollback（Stage 0 已驗）；並發序列化靠
 *   `UNIQUE(tenant_id, product_id, prev_projection_version)` 觸 statement error 整批 rollback，**不靠 `changes()`**。
 *
 * 範圍：manual trigger（offline_payment / admin_override）。payment trigger（webhook）為後續 PR，本模組不碰。
 * 本模組不寫 audit —— audit emission 留給 endpoint 層（Commit 4，於 audit-policy 註冊事件後）。
 */

import { hashToken } from './crypto'

/**
 * D1 binding 型別取自 ambient `Env` 的 indexed access（同 tenant-context.ts 慣例），
 * 避免在 source 直接命名 `D1Database` global（只在 .d.ts 可見會 TS2552）。
 */
type ChiyigoDb = Env['chiyigo_db']

export type ManualSource = 'offline_payment' | 'admin_override'
export type EntitlementStatus = 'pending' | 'active' | 'expired' | 'revoked'

/** 授權本次 grant 的 chiyigo staff actor 快照（由 endpoint 從 step-up token + users row 取得）。 */
export interface GrantActor {
  id: number
  email: string
  role: string
}

/** grantPlan 的嚴格輸入形狀（domain 邊界一次驗證；endpoint 負責 auth 後傳入）。 */
export interface GrantPlanManualInput {
  tenantId: number
  productId: string
  planId: number
  manualSource: ManualSource
  adminIdempotencyKey: string
  actor: GrantActor
  /** offline_payment 必填、admin_override 必須不帶。 */
  paymentRefRaw?: string
  /** admin_override 必填、offline_payment 必須不帶。 */
  grantReason?: string
}

export type GrantOutcome =
  | { outcome: 'applied'; operationId: number; tenantId: number; productId: string; planId: number; status: 'active'; version: number }
  | { outcome: 'replay'; operationId: number; tenantId: number; productId: string; planId: number; status: string }
  | { outcome: 'conflict' }                          // 同 idempotency key、異 params → 409 IDEMPOTENCY_CONFLICT
  | { outcome: 'evidence_conflict' }                 // offline payment_ref_key 撞 → 409 EVIDENCE_ALREADY_USED
  | { outcome: 'stale_rejected' }                    // occurred_at 嚴格早於 last_op_occurred_at（payment 才會發生）
  | { outcome: 'illegal_transition'; from: string }
  | { outcome: 'tenant_ineligible' }
  | { outcome: 'product_inactive' }
  | { outcome: 'product_tenant_type_mismatch' }
  | { outcome: 'plan_invalid' }
  | { outcome: 'invalid'; code: string }             // 邊界驗證失敗（ERR_VALIDATION / INVALID_PAYMENT_REF）
  | { outcome: 'contention' }                        // 重試耗盡（並發飽和；fail-closed，無 partial write）

// ── canonicalizePaymentRef（plan §4 / Rev 3.3）──────────────────────────────────

// zero-width / word-joiner / BOM 的 code points —— /\s/u 不涵蓋 U+200B..U+200D / U+2060；
// U+FEFF 已在 /\s/u 內，這裡併列防個別引擎差異（重複無害）。以 hex code point 列出，避免在原始碼塞入隱形字元。
const ZERO_WIDTH_CP: readonly number[] = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]
const KEY_ALLOWLIST = /^[A-Z0-9._:-]{3,80}$/

/** strip 所有 Unicode whitespace（/\s/u）+ 上述零寬字元集。 */
function stripWhitespaceAndInvisible(s: string): string {
  let out = ''
  for (const ch of s) {
    if (/\s/u.test(ch)) continue
    const cp = ch.codePointAt(0)
    if (cp !== undefined && ZERO_WIDTH_CP.includes(cp)) continue
    out += ch
  }
  return out
}

export type CanonicalRef =
  | { ok: true; key: string; display: string }
  | { ok: false; code: 'INVALID_PAYMENT_REF' }

/**
 * 把使用者輸入的 offline 付款 ref 正規化為 (display, canonical key)。
 * 固定順序：trim Unicode whitespace → 空/超長(>200) reject → NFKC → strip whitespace+zero-width
 *   → toUpperCase（**非** toLocaleUpperCase，避 Turkish-i locale bug）→ allowlist。
 * deterministic（無 locale / 時間 / 隨機）；**reject 不 mangle 不截斷**。
 */
export function canonicalizePaymentRef(raw: string): CanonicalRef {
  const display = (typeof raw === 'string' ? raw : '').trim()
  if (display.length === 0) return { ok: false, code: 'INVALID_PAYMENT_REF' }
  if (display.length > 200) return { ok: false, code: 'INVALID_PAYMENT_REF' }   // reject，不截斷
  const key = stripWhitespaceAndInvisible(display.normalize('NFKC')).toUpperCase()
  if (!KEY_ALLOWLIST.test(key)) return { ok: false, code: 'INVALID_PAYMENT_REF' }
  return { ok: true, key, display }
}

// ── grantPlan（manual：offline_payment / admin_override）─────────────────────────

const MAX_RETRIES = 4
const ADMIN_KEY_MAX_LEN = 200
const GRANT_REASON_MAX_LEN = 1000

/**
 * 嚴格 input shape allowlist（defense-in-depth）：top-level / actor 出現任何未知 key → reject，
 * 防 client 夾帶非預期欄位（如 occurred_at —— 一律 server 生成、禁外傳）。
 */
const ALLOWED_INPUT_KEYS: ReadonlySet<string> = new Set([
  'tenantId', 'productId', 'planId', 'manualSource', 'adminIdempotencyKey', 'actor', 'paymentRefRaw', 'grantReason',
])
const ALLOWED_ACTOR_KEYS: ReadonlySet<string> = new Set(['id', 'email', 'role'])

/**
 * ALLOWED_TRANSITIONS：manual grant 一律目標 `active`，且因每次都是 step-up'd + idempotency-keyed +
 * evidence-bearing 的「顯式」admin 動作，故允許從任一狀態 →active（含 revoked→active = 顯式 reinstatement）。
 * 表保留供 forward-compat（未來 payment/revoke op 的單調規則會更嚴）。
 */
const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<EntitlementStatus>> = {
  none: new Set<EntitlementStatus>(['active']),
  pending: new Set<EntitlementStatus>(['active']),
  active: new Set<EntitlementStatus>(['active']),
  expired: new Set<EntitlementStatus>(['active']),
  revoked: new Set<EntitlementStatus>(['active']),
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0
}

/** 排序鍵的穩定序列化（request_hash 用；deterministic）。 */
function canonicalJson(obj: Record<string, string | number>): string {
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(obj[k])).join(',') + '}'
}

interface ExistingOp {
  id: number
  request_hash: string
  tenant_id: number
  product_id: string
  plan_id: number
  to_status: string
}

function replayOf(ex: ExistingOp): GrantOutcome {
  return { outcome: 'replay', operationId: ex.id, tenantId: ex.tenant_id, productId: ex.product_id, planId: ex.plan_id, status: ex.to_status }
}

/**
 * 手動授權一個 product plan 給 tenant（offline_payment 確認 / admin_override comp）。
 *
 * 流程（plan §5.3）：strict validate → server occurred_at → request_hash → idempotency pre-check →
 *   tenant eligibility → offline evidence pre-check → bounded-retry atomic batch（ledger INSERT + projection write）。
 *
 * @param db   `env.chiyigo_db`
 * @returns 結構化 outcome（caller/endpoint 映射 HTTP）
 */
export async function grantPlan(db: ChiyigoDb, input: GrantPlanManualInput): Promise<GrantOutcome> {
  // ── 1. strict input validation ───────────────────────────────────────────
  if (!input || typeof input !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  // top-level key allowlist：未知 key（如 client 夾帶 occurred_at）一律 reject
  for (const k of Object.keys(input)) {
    if (!ALLOWED_INPUT_KEYS.has(k)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  }
  if (!isPositiveInt(input.tenantId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.productId !== 'string' || input.productId.length === 0) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (!isPositiveInt(input.planId)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (input.manualSource !== 'offline_payment' && input.manualSource !== 'admin_override') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  if (typeof input.adminIdempotencyKey !== 'string') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const adminKey = input.adminIdempotencyKey.trim()
  if (adminKey.length === 0 || adminKey.length > ADMIN_KEY_MAX_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  const actor = input.actor
  if (!actor || typeof actor !== 'object') return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  // actor key allowlist：只允許 id / email / role
  for (const k of Object.keys(actor)) {
    if (!ALLOWED_ACTOR_KEYS.has(k)) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
  }
  if (
    !isPositiveInt(actor.id)
    || typeof actor.email !== 'string' || actor.email.trim().length === 0
    || typeof actor.role !== 'string' || actor.role.trim().length === 0
  ) return { outcome: 'invalid', code: 'ERR_VALIDATION' }

  // source-specific evidence（互斥）
  let paymentRef: string | null = null
  let paymentRefKey: string | null = null
  let grantReason: string | null = null
  if (input.manualSource === 'offline_payment') {
    if (input.grantReason !== undefined && input.grantReason !== null) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
    const canon = canonicalizePaymentRef(input.paymentRefRaw as string)
    // strict:false 下 discriminated-union 的負向 narrowing（!canon.ok）不收窄 false 分支 →
    // 用 canon.ok === false（同 tenant-context.ts resolveIssuanceContextForTenant 慣例）。
    if (canon.ok === false) return { outcome: 'invalid', code: canon.code }
    paymentRef = canon.display
    paymentRefKey = canon.key
  } else {
    if (input.paymentRefRaw !== undefined && input.paymentRefRaw !== null) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
    const reason = typeof input.grantReason === 'string' ? input.grantReason.trim() : ''
    if (reason.length === 0 || reason.length > GRANT_REASON_MAX_LEN) return { outcome: 'invalid', code: 'ERR_VALIDATION' }
    grantReason = reason
  }

  // ── 2. server-generated occurred_at（禁 client 傳入）─────────────────────────
  const occurredAt = new Date().toISOString()

  // ── 3. request_hash（deterministic；只含 accepted body 欄位；排除 idempotency key / actor / 時間）──
  const requestHash = await hashToken(canonicalJson({
    tenant_id: input.tenantId,
    product_id: input.productId,
    plan_id: input.planId,
    manual_source: input.manualSource,
    payment_ref_key: paymentRefKey ?? '',
    grant_reason: grantReason ?? '',
    target_status: 'active',
  }))

  // ── 4. idempotency pre-check ─────────────────────────────────────────────
  const existing = await db
    .prepare(`SELECT id, request_hash, tenant_id, product_id, plan_id, to_status
                FROM grant_plan_operations WHERE admin_idempotency_key = ?`)
    .bind(adminKey)
    .first<ExistingOp>()
  if (existing) {
    return existing.request_hash === requestHash ? replayOf(existing) : { outcome: 'conflict' }
  }

  // ── 5. tenant eligibility（target tenant；server lookup）─────────────────────
  const tenant = await db
    .prepare(`SELECT type, status, deleted_at FROM tenants WHERE id = ?`)
    .bind(input.tenantId)
    .first<{ type: string; status: string; deleted_at: string | null }>()
  if (!tenant || tenant.deleted_at !== null || tenant.status !== 'active') return { outcome: 'tenant_ineligible' }

  const product = await db
    .prepare(`SELECT tenant_scope, is_active FROM products WHERE id = ?`)
    .bind(input.productId)
    .first<{ tenant_scope: string; is_active: number }>()
  if (!product || product.is_active !== 1) return { outcome: 'product_inactive' }
  if (product.tenant_scope !== 'any' && product.tenant_scope !== tenant.type) return { outcome: 'product_tenant_type_mismatch' }

  const plan = await db
    .prepare(`SELECT id, product_id, is_active FROM plans WHERE id = ?`)
    .bind(input.planId)
    .first<{ id: number; product_id: string; is_active: number }>()
  if (!plan || plan.product_id !== input.productId || plan.is_active !== 1) return { outcome: 'plan_invalid' }

  // ── 6. offline evidence pre-check（clean 409；partial UNIQUE 為 durable backstop）──
  if (input.manualSource === 'offline_payment' && paymentRefKey !== null) {
    const dup = await db
      .prepare(`SELECT id FROM grant_plan_operations WHERE manual_source = 'offline_payment' AND payment_ref_key = ?`)
      .bind(paymentRefKey)
      .first<{ id: number }>()
    if (dup) return { outcome: 'evidence_conflict' }
  }

  // ── 7. bounded-retry atomic batch（INSERT ledger + projection write）────────
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const proj = await db
      .prepare(`SELECT status, version, last_op_occurred_at FROM tenant_product_access WHERE tenant_id = ? AND product_id = ?`)
      .bind(input.tenantId, input.productId)
      .first<{ status: string; version: number; last_op_occurred_at: string }>()
    const fromStatus = proj ? proj.status : 'none'
    const prevVersion = proj ? proj.version : 0
    const lastOp = proj ? proj.last_op_occurred_at : null

    // ordering guard：嚴格更早才拒（manual occurred_at=server-now 一般不會更早；主要服務未來 payment trigger）
    if (lastOp !== null && occurredAt < lastOp) return { outcome: 'stale_rejected' }

    // legality：manual → active（從任一狀態皆合法；含 revoked→active = 顯式 reinstatement）
    const allowed = ALLOWED_TRANSITIONS[fromStatus]
    if (!allowed || !allowed.has('active')) return { outcome: 'illegal_transition', from: fromStatus }

    const ledgerInsert = db
      .prepare(
        `INSERT INTO grant_plan_operations
           (tenant_id, product_id, plan_id, "trigger", manual_source, admin_idempotency_key, request_hash,
            granted_by, granted_by_email, granted_by_role, payment_ref, payment_ref_key, grant_reason,
            from_status, to_status, prev_projection_version, occurred_at)
         VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(
        input.tenantId, input.productId, input.planId, input.manualSource, adminKey, requestHash,
        actor.id, actor.email, actor.role, paymentRef, paymentRefKey, grantReason,
        fromStatus, prevVersion, occurredAt,
      )

    // projection write：first grant = INSERT；否則 UPDATE WHERE version=prevVersion。
    // 注意：UPDATE 的 WHERE version 是防衛性對齊，**正確性靠上面 ledger 的
    //   UNIQUE(tenant,product,prev_projection_version) 觸 error 整批 rollback**，不靠此 UPDATE 的 changes()。
    const projectionWrite = prevVersion === 0
      ? db.prepare(
          `INSERT INTO tenant_product_access
             (tenant_id, product_id, plan_id, status, granted_via, version, last_op_occurred_at)
           VALUES (?, ?, ?, 'active', 'manual', 1, ?)`,
        ).bind(input.tenantId, input.productId, input.planId, occurredAt)
      : db.prepare(
          `UPDATE tenant_product_access
              SET status = 'active', plan_id = ?, granted_via = 'manual', version = version + 1,
                  last_op_occurred_at = ?, updated_at = datetime('now')
            WHERE tenant_id = ? AND product_id = ? AND version = ?`,
        ).bind(input.planId, occurredAt, input.tenantId, input.productId, prevVersion)

    try {
      await db.batch([ledgerInsert, projectionWrite])
    } catch (e) {
      const msg = String((e as { message?: unknown })?.message ?? e)
      if (msg.includes('admin_idempotency_key')) {
        // 並發同 key：另一 caller 在 pre-check 後搶先 INSERT → re-read 決定 replay/conflict
        const ex2 = await db
          .prepare(`SELECT id, request_hash, tenant_id, product_id, plan_id, to_status
                      FROM grant_plan_operations WHERE admin_idempotency_key = ?`)
          .bind(adminKey)
          .first<ExistingOp>()
        if (ex2) return ex2.request_hash === requestHash ? replayOf(ex2) : { outcome: 'conflict' }
        continue // 理論上不該到此；當作 contention 重試
      }
      if (msg.includes('payment_ref_key')) {
        return { outcome: 'evidence_conflict' } // 並發同 offline ref
      }
      if (msg.includes('prev_projection_version')) {
        continue // 並發他 op 搶走本 version slot → 整批已 rollback → 重讀重試
      }
      throw e // 未知錯誤不吞
    }

    // 成功：取 operationId（admin_idempotency_key UNIQUE → 恰一 row）
    const opRow = await db
      .prepare(`SELECT id FROM grant_plan_operations WHERE admin_idempotency_key = ?`)
      .bind(adminKey)
      .first<{ id: number }>()
    return {
      outcome: 'applied',
      operationId: opRow ? opRow.id : 0,
      tenantId: input.tenantId,
      productId: input.productId,
      planId: input.planId,
      status: 'active',
      version: prevVersion + 1,
    }
  }

  return { outcome: 'contention' }
}
