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

import { res, requireAuth } from './auth.js'
import { safeUserAudit } from './user-audit.js'
import { getUserKycStatus, KYC_STATUS } from './kyc.js'

export const PAYMENT_STATUS = Object.freeze({
  PENDING:    'pending',
  PROCESSING: 'processing',
  SUCCEEDED:  'succeeded',
  FAILED:     'failed',
  CANCELED:   'canceled',
  REFUNDED:   'refunded',
})

const VALID_STATUSES = new Set(Object.values(PAYMENT_STATUS))

export const PAYMENT_KIND = Object.freeze({
  DEPOSIT:      'deposit',
  WITHDRAW:     'withdraw',
  SUBSCRIPTION: 'subscription',
  REFUND:       'refund',
})

const VALID_KINDS = new Set(Object.values(PAYMENT_KIND))

/**
 * INSERT 一筆 payment_intent。caller 應自行 build vendor_intent_id（PSP 回的）。
 * 同 (vendor, vendor_intent_id) UNIQUE 撞到 → throw（caller 應改走 update）。
 */
export async function createPaymentIntent(env, payload = {}) {
  if (!env?.chiyigo_db) throw new Error('db not available')
  const { user_id, vendor, vendor_intent_id, kind = PAYMENT_KIND.DEPOSIT,
          status = PAYMENT_STATUS.PENDING, amount_subunit = null, amount_raw = null,
          currency, metadata = null, requisition_id = null } = payload
  if (!user_id || !vendor || !vendor_intent_id || !currency) {
    throw new Error('createPaymentIntent: missing required field')
  }
  if (!VALID_KINDS.has(kind))     throw new Error(`Invalid payment kind: ${kind}`)
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid payment status: ${status}`)

  // P0-3: requisition_id 同步落 FK 欄位（metadata 仍保留 backwards compat）
  let reqId = requisition_id != null ? Number(requisition_id) : null
  if (reqId == null && metadata && typeof metadata === 'object') {
    const fromMeta = Number(metadata.requisition_id)
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
          metadata ? JSON.stringify(metadata) : null, reqId)
    .first()
  return result?.id ?? null
}

export async function getPaymentIntent(env, { id, vendor, vendor_intent_id } = {}) {
  if (!env?.chiyigo_db) return null
  let row = null
  if (id) {
    row = await env.chiyigo_db
      .prepare(`SELECT * FROM payment_intents WHERE id = ?`)
      .bind(id).first()
  } else if (vendor && vendor_intent_id) {
    row = await env.chiyigo_db
      .prepare(`SELECT * FROM payment_intents WHERE vendor = ? AND vendor_intent_id = ?`)
      .bind(vendor, String(vendor_intent_id)).first()
  }
  if (!row) return null
  if (row.metadata) {
    try { row.metadata = JSON.parse(row.metadata) } catch { /* keep raw */ }
  }
  return row
}

/**
 * 更新 status / failure_reason。webhook 收到 PSP 通知時呼叫。
 * 用 (vendor, vendor_intent_id) 定位避免 race；caller 已 dedupe webhook event。
 *
 * P3-2（2026-05-06）：succeeded → 任何狀態 觸發 critical audit + Discord 告警。
 *   合法路徑：succeeded → refunded（admin 退款），仍會觸發但這是預期。
 *   非法路徑：succeeded → succeeded/pending/failed/canceled 任何代碼異常都會被告警。
 */
export async function updatePaymentStatus(env, { vendor, vendor_intent_id, status, failure_reason = null }) {
  if (!env?.chiyigo_db) return false
  if (!VALID_STATUSES.has(status)) throw new Error(`Invalid payment status: ${status}`)

  // 先讀舊 row（若 status 從 succeeded 變動 → 後面要發告警）
  const before = await env.chiyigo_db
    .prepare(`SELECT id, user_id, status, amount_subunit, currency
                FROM payment_intents WHERE vendor = ? AND vendor_intent_id = ?`)
    .bind(vendor, String(vendor_intent_id)).first()

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  const r = await env.chiyigo_db
    .prepare(
      `UPDATE payment_intents
          SET status = ?, failure_reason = ?, updated_at = ?
        WHERE vendor = ? AND vendor_intent_id = ?`,
    )
    .bind(status, failure_reason, now, vendor, String(vendor_intent_id))
    .run()
  const changed = (r?.meta?.changes ?? 0) > 0

  if (changed && before?.status === PAYMENT_STATUS.SUCCEEDED && status !== PAYMENT_STATUS.SUCCEEDED) {
    // 動到 succeeded row → critical audit；safeUserAudit 內部已串 Discord webhook（DISCORD_AUDIT_WEBHOOK）
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

  return changed
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
export async function requirePaymentAccess(request, env, opts = {}) {
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

import { mockPaymentAdapter } from './payment-vendors/mock.js'
import { ecpayPaymentAdapter } from './payment-vendors/ecpay.js'

const ADAPTERS = {
  mock:  mockPaymentAdapter,
  ecpay: ecpayPaymentAdapter,
  // stripe: () => import('./payment-vendors/stripe.js').then(m => m.stripePaymentAdapter),
  // tappay: () => import('./payment-vendors/tappay.js').then(m => m.tappayPaymentAdapter),
}

export function resolvePaymentAdapter(vendor) {
  return ADAPTERS[vendor] ?? null
}
