/**
 * Phase F-2 — Payment scaffold（vendor-agnostic）
 *
 * 鏡射 F-1 KYC pattern：
 *   - PAYMENT_STATUS / PAYMENT_KIND enum
 *   - createPaymentIntent / getPaymentIntent / updatePaymentStatus —— 對 D1 thin wrapper
 *   - requirePaymentAccess —— gate helper（access_token + KYC verified）；
 *     提款 / 轉帳等 elevated 操作另外要求 step-up scope，由 caller 用 requireStepUp 串
 *   - resolveVendorAdapter —— webhook handler dispatch
 *
 * 為什麼不放 ledger / balance：
 *   - 充值 vs 訂閱 vs 一次性付款場景對帳模型不同，等真接 PSP 才知道
 *   - 沒人付款先不囤；YAGNI
 *
 * 為什麼 amount 雙欄位：
 *   - amount_subunit INTEGER：法幣最小單位（TWD 分 / USD cent），避免 float 精度
 *   - amount_raw TEXT：鏈上 18 decimals 放不下 INTEGER，存 decimal string
 *   - currency 區分（TWD/USD/ETH/USDT...）
 */

import { res, requireAuth } from './auth'
import { safeUserAudit } from './user-audit'
import { getUserKycStatus, KYC_STATUS } from './kyc'

export const PAYMENT_STATUS = Object.freeze({
  PENDING:    'pending',
  PROCESSING: 'processing',
  SUCCEEDED:  'succeeded',
  FAILED:     'failed',
  CANCELED:   'canceled',
  REFUNDED:   'refunded',
} as const)
export type PaymentStatus = typeof PAYMENT_STATUS[keyof typeof PAYMENT_STATUS]

const VALID_STATUSES: ReadonlySet<string> = new Set(Object.values(PAYMENT_STATUS))
export function isPaymentStatus(s: unknown): s is PaymentStatus {
  return typeof s === 'string' && VALID_STATUSES.has(s)
}

export const PAYMENT_KIND = Object.freeze({
  DEPOSIT:      'deposit',
  WITHDRAW:     'withdraw',
  SUBSCRIPTION: 'subscription',
  REFUND:       'refund',
} as const)
export type PaymentKind = typeof PAYMENT_KIND[keyof typeof PAYMENT_KIND]

const VALID_KINDS: ReadonlySet<string> = new Set(Object.values(PAYMENT_KIND))
export function isPaymentKind(s: unknown): s is PaymentKind {
  return typeof s === 'string' && VALID_KINDS.has(s)
}

// T11（2026-05-06）：metadata 寫入 allowlist，避免任意鍵污染查詢與 ETL
//   anonymized_*：anonymize endpoint 會用，加在這裡讓 createPaymentIntent 也能 round-trip
const METADATA_ALLOWED_KEYS = new Set([
  'requisition_id',     // 關聯接案需求單 id
  'order_id',           // 商戶訂單 id（前端傳）
  'description',        // PSP 顯示用簡述
  'client_back_url',    // ECPay 回跳
  'tag',                // 自訂分類 tag
  'note',               // 內部備註
  'anonymized_at',      // anonymize endpoint 寫入
  'anonymized_by',      // anonymize endpoint 寫入
  'original_status',    // anonymize endpoint 寫入
  'trade_no',           // P0-10：webhook succeeded 時寫入 vendor TradeNo，refund 直接讀
  'payment_info',       // ATM/CVS 取號資訊（webhook handler mergeMetadata 寫入）
])

function sanitizeMetadata(metadata): Record<string, unknown> | null {
  if (metadata == null) return null
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('metadata must be a plain object')
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(metadata)) {
    if (!METADATA_ALLOWED_KEYS.has(k)) continue  // 默默丟棄不在白名單的鍵
    // 值大小限制：避免單欄塞 MB 級 payload
    if (typeof v === 'string' && v.length > 1000) {
      out[k] = v.slice(0, 1000)
    } else {
      out[k] = v
    }
  }
  return Object.keys(out).length ? out : null
}

/**
 * INSERT 一筆 payment_intent。caller 應自行 build vendor_intent_id（PSP 回的）。
 * 同 (vendor, vendor_intent_id) UNIQUE 撞到 → throw（caller 應改走 update）。
 */
interface CreatePaymentIntentPayload {
  user_id?: number | string | null
  vendor?: string
  vendor_intent_id?: string | number
  kind?: string
  status?: string
  amount_subunit?: number | null
  amount_raw?: string | null
  currency?: string
  metadata?: Record<string, unknown> | null
  requisition_id?: number | string | null
  // Stage 3：webhook PSP-direct 路徑會傳入但 destructure 不接（保留欄位讓 caller
  // 編譯通過、runtime 沿用既有行為「silently dropped」）。修正落 DB 為獨立 PR
  // 處理，避免綁進 JS→TS rename 的金流邊界 PR（[[feedback_security_boundary_pr_first_do_no_harm]]）。
  failure_reason?: string | null
}

export async function createPaymentIntent(env, payload: CreatePaymentIntentPayload = {}) {
  if (!env?.chiyigo_db) throw new Error('db not available')
  const { user_id, vendor, vendor_intent_id, kind = PAYMENT_KIND.DEPOSIT,
          status = PAYMENT_STATUS.PENDING, amount_subunit = null, amount_raw = null,
          currency, metadata = null, requisition_id = null } = payload
  if (!user_id || !vendor || !vendor_intent_id || !currency) {
    throw new Error('createPaymentIntent: missing required field')
  }
  if (!VALID_KINDS.has(kind))     throw new Error(`Invalid payment kind: ${kind}`)
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid payment status: ${status}`)

  // T11: 過濾 metadata 鍵（allowlist）+ 大小限制
  const cleanMeta = sanitizeMetadata(metadata)

  // P0-3: requisition_id 同步落 FK 欄位（metadata 仍保留 backwards compat）
  let reqId = requisition_id != null ? Number(requisition_id) : null
  if (reqId == null && cleanMeta) {
    const fromMeta = Number(cleanMeta.requisition_id)
    if (Number.isFinite(fromMeta) && fromMeta > 0) reqId = fromMeta
  }
  if (!Number.isFinite(reqId) || reqId < 1) reqId = null

  const result = await env.chiyigo_db
    .prepare(
      `INSERT INTO payment_intents
         (user_id, vendor, vendor_intent_id, kind, status,
          amount_subunit, amount_raw, currency, metadata, requisition_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
    )
    .bind(user_id, vendor, String(vendor_intent_id), kind, status,
          amount_subunit, amount_raw, currency,
          cleanMeta ? JSON.stringify(cleanMeta) : null, reqId)
    .first()
  return result?.id ?? null
}

export async function getPaymentIntent(
  env,
  { id, vendor, vendor_intent_id, includeDeleted = false }: {
    id?: number | string | null,
    vendor?: string | null,
    vendor_intent_id?: string | number | null,
    includeDeleted?: boolean,
  } = {},
) {
  if (!env?.chiyigo_db) return null
  // Codex r1 P0-1：預設過濾 soft-deleted；只有 webhook orphan 偵測會 includeDeleted=true
  const deletedFilter = includeDeleted ? '' : 'AND deleted_at IS NULL'
  let row = null
  if (id) {
    row = await env.chiyigo_db
      .prepare(`SELECT * FROM payment_intents WHERE id = ? ${deletedFilter}`)
      .bind(id).first()
  } else if (vendor && vendor_intent_id) {
    row = await env.chiyigo_db
      .prepare(`SELECT * FROM payment_intents WHERE vendor = ? AND vendor_intent_id = ? ${deletedFilter}`)
      .bind(vendor, String(vendor_intent_id)).first()
  }
  if (!row) return null
  if (row.metadata) {
    try { row.metadata = JSON.parse(row.metadata) } catch { /* keep raw */ }
  }
  return row
}

// Codex r1 P1-4：payment_intents 狀態機 — webhook replay 不可改寫終態。
// 合法 transition：
//   pending     → processing | succeeded | failed | canceled
//   processing  → succeeded | failed | canceled | refunded（refund 流程過這裡）
//   succeeded   → refunded（admin 退款）
//   failed / canceled / refunded → terminal，無 outgoing
// 注意：lockIntentForRefund 用直接 SQL CAS 做 succeeded→processing，不過此守衛。
const ALLOWED_TRANSITIONS = {
  [PAYMENT_STATUS.PENDING]:    new Set([PAYMENT_STATUS.PROCESSING, PAYMENT_STATUS.SUCCEEDED, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELED]),
  [PAYMENT_STATUS.PROCESSING]: new Set([PAYMENT_STATUS.SUCCEEDED, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.CANCELED, PAYMENT_STATUS.REFUNDED]),
  [PAYMENT_STATUS.SUCCEEDED]:  new Set([PAYMENT_STATUS.REFUNDED]),
  [PAYMENT_STATUS.FAILED]:     new Set(),
  [PAYMENT_STATUS.CANCELED]:   new Set(),
  [PAYMENT_STATUS.REFUNDED]:   new Set(),
}

/**
 * 更新 status / failure_reason。webhook 收到 PSP 通知時呼叫。
 * 用 (vendor, vendor_intent_id) 定位避免 race；caller 已 dedupe webhook event。
 *
 * Codex r6 P1-4 follow-up（2026-05-14）：改回 structured outcome，讓 caller
 * 區分四種情境決定是否走「成功收尾」(metadata merge / payment.status.change audit)：
 *   { outcome: 'applied' }              UPDATE 真的改了 1 row → 走成功收尾
 *   { outcome: 'same_status' }          before.status === status → idempotent
 *                                       replay；caller 可繼續（metadata 補寫安全）
 *   { outcome: 'no_row' }               intent 不存在或軟刪 → caller 走 orphan recheck
 *   { outcome: 'illegal_transition',    內部已 critical audit；caller 必須略過
 *     from, to }                        metadata/audit/payment.status.change（不可
 *                                       讓非法轉移看起來像成功付款）
 *
 * 設計考量：illegal transition（例 DB=failed、webhook=succeeded）原 P1-4 只回
 * false，但 caller 仍會 merge trade_no、寫 payment.status.change audit、回 PSP
 * success → 帳面看起來像成功收款。改 structured 後 caller 能明確跳過。
 */
export async function updatePaymentStatus(env, { vendor, vendor_intent_id, status, failure_reason = null }) {
  if (!env?.chiyigo_db) return { outcome: 'no_row' }
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid payment status: ${status}`)

  // 先讀舊 row（若 status 從 succeeded 變動 → 後面要發告警）
  // Codex r1 P0-1：soft-deleted intent 不可被 webhook 更新（caller 應先走 orphan 分支；
  // 這裡的 deleted_at IS NULL 是 defense-in-depth）
  const before = await env.chiyigo_db
    .prepare(`SELECT id, user_id, status, amount_subunit, currency
                FROM payment_intents WHERE vendor = ? AND vendor_intent_id = ? AND deleted_at IS NULL`)
    .bind(vendor, String(vendor_intent_id)).first()

  if (!before) return { outcome: 'no_row' }  // 不存在或軟刪 → caller 走 orphan

  // 同狀態 replay = no-op（PSP 重送都會撞，不算 illegal）
  if (before.status === status) return { outcome: 'same_status' }

  // illegal transition：webhook 想把終態改回去 / 從 failed 變 succeeded 等
  const allowed = ALLOWED_TRANSITIONS[before.status]
  if (!allowed || !allowed.has(status)) {
    try {
      await safeUserAudit(env, {
        event_type: 'payment.status.illegal_transition',
        severity:   'critical',
        user_id:    before.user_id ?? null,
        data: {
          intent_id:        before.id,
          vendor,
          vendor_intent_id: String(vendor_intent_id),
          status_from:      before.status,
          status_to:        status,
          amount_subunit:   before.amount_subunit,
          currency:         before.currency,
          failure_reason,
        },
      })
    } catch { /* alert 不擋主流程 */ }
    return { outcome: 'illegal_transition', from: before.status, to: status }
  }

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const r = await env.chiyigo_db
    .prepare(
      `UPDATE payment_intents
          SET status = ?, failure_reason = ?, updated_at = ?
        WHERE vendor = ? AND vendor_intent_id = ? AND deleted_at IS NULL AND status = ?`,
    )
    .bind(status, failure_reason, now, vendor, String(vendor_intent_id), before.status)
    .run()
  const changed = (r?.meta?.changes ?? 0) > 0
  if (!changed) {
    // CAS 落敗（lookup 之後 race） → 視同 no_row 讓 caller 重檢
    return { outcome: 'no_row' }
  }

  if (before?.status === PAYMENT_STATUS.SUCCEEDED && status !== PAYMENT_STATUS.SUCCEEDED) {
    // 動到 succeeded row → critical audit（succeeded → refunded 合法但仍告警留痕）
    try {
      await safeUserAudit(env, {
        event_type: 'payment.intent.succeeded_status_changed',
        severity: 'critical',
        user_id: before.user_id ?? null,
        data: {
          intent_id:        before.id,
          vendor,
          vendor_intent_id: String(vendor_intent_id),
          status_from:      before.status,
          status_to:        status,
          amount_subunit:   before.amount_subunit,
          currency:         before.currency,
          failure_reason,
        },
      })
    } catch { /* swallow — alert 不擋主流程 */ }
  }

  return { outcome: 'applied' }
}

/**
 * P0-7 退款 atomic lock。
 *
 * 原 race：admin/payments/intents/:id/refund 與 admin/requisition-refund/:id/approve
 * 兩個入口都 `SELECT status; if succeeded → call ECPay → UPDATE refunded`，
 * 雙擊 / 兩個 admin 同時審 → 兩條都過 SELECT → 兩次打 ECPay 退款。
 *
 * 修法：UPDATE...WHERE status='succeeded' RETURNING * 一條 SQL atomic 鎖到
 * 'processing'。第二個 caller 讀回 0 row → 知道別人已在退或已退過 → 409。
 *
 * 失敗時用 unlockIntentToSucceeded 解鎖（intent 本身仍 succeeded，只是退款 call 失敗）。
 * 成功時 caller 走 updatePaymentStatus → 'refunded'。
 *
 * 注意：此 lock UPDATE 不走 updatePaymentStatus，所以不會觸發
 * payment.intent.succeeded_status_changed critical audit；refund 自身的
 * payment.refund.success / requisition.refund.approved 已是 critical，覆蓋足夠。
 */
export async function lockIntentForRefund(env, intentId) {
  if (!env?.chiyigo_db) return { ok: false, code: 'NO_DB' }
  const row = await env.chiyigo_db
    .prepare(
      `UPDATE payment_intents
          SET status = 'processing', updated_at = datetime('now')
        WHERE id = ? AND status = 'succeeded'
        RETURNING id, vendor, vendor_intent_id, amount_subunit, currency,
                  user_id, metadata, requisition_id`,
    )
    .bind(intentId).first()
  if (!row) return { ok: false, code: 'ALREADY_PROCESSING_OR_NOT_SUCCEEDED' }
  if (row.metadata) {
    try { row.metadata = JSON.parse(row.metadata) } catch { /* keep raw */ }
  }
  return { ok: true, intent: row }
}

export async function unlockIntentToSucceeded(env, intentId) {
  if (!env?.chiyigo_db) return
  await env.chiyigo_db
    .prepare(
      `UPDATE payment_intents
          SET status = 'succeeded', updated_at = datetime('now')
        WHERE id = ? AND status = 'processing'`,
    )
    .bind(intentId).run()
}

/**
 * Gate helper — 同 requireKyc pattern。預設要求：
 *   - access_token 有效
 *   - KYC status === 'verified'
 *
 * 高權限（提款）caller 應額外用 requireStepUp(ELEVATED_WITHDRAW, for_action='withdraw')；
 * 一般查詢（GET intents）caller 可改 opts.skipKyc=true。
 *
 * @param {Request} request
 * @param {object}  env
 * @param {object}  [opts]
 * @param {boolean} [opts.skipKyc=false]   只查一般 intent 列表時 true
 * @param {string}  [opts.requiredLevel]   'enhanced' = 高額提款
 */
export async function requirePaymentAccess(
  request,
  env,
  opts: { skipKyc?: boolean, requiredLevel?: string } = {},
) {
  const { user, error } = await requireAuth(request, env)
  if (error) return { user: null, error }

  if (opts.skipKyc) return { user, error: null }

  const userId = Number(user.sub)
  const kyc = await getUserKycStatus(env, userId)

  if (kyc.status !== KYC_STATUS.VERIFIED) {
    await safeUserAudit(env, {
      event_type: 'payment.gate.fail', severity: 'warn', user_id: userId, request,
      data: { reason: 'kyc_not_verified', actual_status: kyc.status },
    })
    return {
      user: null,
      error: res({
        error: 'KYC verification required for payment access',
        code:  'KYC_REQUIRED',
        actual_status: kyc.status,
      }, 403),
    }
  }

  if (opts.requiredLevel === 'enhanced' && kyc.level !== 'enhanced') {
    return {
      user: null,
      error: res({
        error: 'Enhanced KYC required',
        code:  'KYC_LEVEL_INSUFFICIENT',
        required_level: 'enhanced',
        actual_level:   kyc.level,
      }, 403),
    }
  }

  return { user, error: null, kyc }
}

// ── Vendor adapter pattern ────────────────────────────────────────
//
// 每個 vendor 提供：
//   parseWebhook(request, env) → {
//     ok: boolean,
//     event_id: string,                  // vendor 唯一 event id（dedupe）
//     vendor_intent_id: string,          // 對應到 payment_intents.vendor_intent_id
//     user_id?: number,                  // 對方 metadata 帶回的 chiyigo user.id（可選）
//     status: string,                    // PAYMENT_STATUS 之一
//     amount_subunit?: number,
//     amount_raw?: string,
//     currency?: string,
//     failure_reason?: string,
//     raw_body?: string,
//     error?: string,
//   }
//
// 接真實 PSP 時：
//   functions/utils/payment-vendors/stripe.js  — Stripe-Signature 驗章 + event.type → status
//   functions/utils/payment-vendors/tappay.js  — TapPay HMAC + 通知格式
//   functions/utils/payment-vendors/ecpay.js   — 綠界 CheckMacValue
//
// 目前只 ship `mock` adapter 給 tests + scaffold smoke test。

import { mockPaymentAdapter } from './payment-vendors/mock'
import { ecpayPaymentAdapter } from './payment-vendors/ecpay'

const ADAPTERS = {
  mock:  mockPaymentAdapter,
  ecpay: ecpayPaymentAdapter,
  // stripe: () => import('./payment-vendors/stripe.js').then(m => m.stripePaymentAdapter),
  // tappay: () => import('./payment-vendors/tappay.js').then(m => m.tappayPaymentAdapter),
}

export function resolvePaymentAdapter(vendor) {
  return ADAPTERS[vendor] ?? null
}
