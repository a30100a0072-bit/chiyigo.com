/**
 * Phase F-1 — KYC scaffold（vendor-agnostic）
 *
 * 三組 helper：
 *   - getUserKycStatus / setUserKycStatus —— 對 D1 user_kyc 的 thin wrapper
 *   - requireKyc(level) —— similar to requireScope；caller 拿 access_token 後
 *     用此 helper gate 提款 / 高權限操作（不在 token claim 裡，每次 D1 lookup ~5ms）
 *   - resolveKycAdapter(vendor) —— webhook handler dispatch 給 vendor-specific
 *     parser（mock vendor 給 tests，sumsub/persona/shinkong 等 stub 等接）
 *
 * 為什麼不在 JWT 加 kyc claim：
 *   - claim 改動牽連 5+ 個 login 簽 token 的點 + verifyJwt + 下游 RP
 *   - kyc 狀態改變（vendor webhook 觸發）需要立即生效，token 卡住 15min 不能等
 *   - 反正 elevated:withdraw 等高權限操作量級遠低於每秒幾次，D1 lookup 划得來
 *   - 等真的撞到 perf 瓶頸再進 token（migration 容易：buildTokenScope 加欄位）
 */

import { res } from './auth.js'
import { requireAuth } from './auth.js'
import { safeUserAudit } from './user-audit.js'

export const KYC_STATUS = Object.freeze({
  UNVERIFIED: 'unverified',
  PENDING:    'pending',
  VERIFIED:   'verified',
  REJECTED:   'rejected',
  EXPIRED:    'expired',
})

const VALID_STATUSES = new Set(Object.values(KYC_STATUS))

export const KYC_LEVEL = Object.freeze({
  BASIC:    'basic',
  ENHANCED: 'enhanced',
})

const VALID_LEVELS = new Set(Object.values(KYC_LEVEL))

/**
 * 撈 user 當前 KYC 狀態。沒 row → 視為 'unverified'（user 還沒開過 KYC）。
 * 過期 row（expires_at < now）→ 視為 'expired'，呼叫端應拒絕高權限操作。
 *
 * @returns {Promise<{ status: string, level: string, vendor: string|null, expires_at: string|null }>}
 */
export async function getUserKycStatus(env, userId) {
  if (!env?.chiyigo_db || !userId) {
    return { status: KYC_STATUS.UNVERIFIED, level: KYC_LEVEL.BASIC, vendor: null, expires_at: null }
  }
  const row = await env.chiyigo_db
    .prepare(
      `SELECT status, level, vendor, expires_at
         FROM user_kyc WHERE user_id = ?`,
    )
    .bind(userId)
    .first()
  if (!row) {
    return { status: KYC_STATUS.UNVERIFIED, level: KYC_LEVEL.BASIC, vendor: null, expires_at: null }
  }
  // 過期判斷
  let status = row.status
  if (row.expires_at && Date.parse(row.expires_at.replace(' ', 'T') + 'Z') < Date.now()) {
    status = KYC_STATUS.EXPIRED
  }
  return {
    status,
    level:      row.level || KYC_LEVEL.BASIC,
    vendor:     row.vendor,
    expires_at: row.expires_at,
  }
}

/**
 * Upsert user_kyc row。webhook handler 處理 vendor 通知時用。
 * caller 已驗 vendor + event_id（本 helper 不重 dedupe）。
 *
 * @param {object} patch  { status?, level?, vendor?, vendor_session_id?, vendor_review_id?, rejection_reason?, verified_at?, expires_at? }
 */
export async function setUserKycStatus(env, userId, patch = {}) {
  if (!env?.chiyigo_db || !userId) return
  if (patch.status && !VALID_STATUSES.has(patch.status)) {
    throw new Error(`Invalid KYC status: ${patch.status}`)
  }
  if (patch.level && !VALID_LEVELS.has(patch.level)) {
    throw new Error(`Invalid KYC level: ${patch.level}`)
  }

  // SQLite UPSERT
  const fields = ['user_id', 'status', 'level', 'vendor', 'vendor_session_id',
    'vendor_review_id', 'rejection_reason', 'verified_at', 'expires_at', 'updated_at']
  const placeholders = fields.map(() => '?').join(', ')
  const updateClauses = fields.filter(f => f !== 'user_id').map(f => `${f} = excluded.${f}`).join(', ')

  const now = new Date().toISOString().replace('T', ' ').slice(0, 19)
  await env.chiyigo_db
    .prepare(
      `INSERT INTO user_kyc (${fields.join(', ')})
       VALUES (${placeholders})
       ON CONFLICT(user_id) DO UPDATE SET ${updateClauses}`,
    )
    .bind(
      userId,
      patch.status ?? KYC_STATUS.UNVERIFIED,
      patch.level ?? KYC_LEVEL.BASIC,
      patch.vendor ?? null,
      patch.vendor_session_id ?? null,
      patch.vendor_review_id ?? null,
      patch.rejection_reason ?? null,
      patch.verified_at ?? null,
      patch.expires_at ?? null,
      now,
    )
    .run()
}

/**
 * Gate helper — 用法：
 *   const { user, error } = await requireKyc(request, env)
 *   if (error) return error
 *
 * 預設 require 'verified'。可指定 level（'enhanced' = 高額提款）。
 *
 * @param {Request} request
 * @param {object}  env
 * @param {object}  [opts]
 * @param {string}  [opts.requiredStatus='verified']
 * @param {string}  [opts.requiredLevel]    若指定 'enhanced'，basic 也算不夠
 */
export async function requireKyc(request, env, opts = {}) {
  const requiredStatus = opts.requiredStatus ?? KYC_STATUS.VERIFIED
  const requiredLevel  = opts.requiredLevel  ?? null

  const { user, error } = await requireAuth(request, env)
  if (error) return { user: null, error }

  const userId = Number(user.sub)
  const kyc = await getUserKycStatus(env, userId)

  if (kyc.status !== requiredStatus) {
    await safeUserAudit(env, {
      event_type: 'kyc.gate.fail', severity: 'warn', user_id: userId, request,
      data: { required_status: requiredStatus, actual_status: kyc.status },
    })
    return {
      user: null,
      error: res({
        error: 'KYC verification required',
        code:  'KYC_REQUIRED',
        required_status: requiredStatus,
        actual_status:   kyc.status,
      }, 403),
    }
  }

  if (requiredLevel === KYC_LEVEL.ENHANCED && kyc.level !== KYC_LEVEL.ENHANCED) {
    return {
      user: null,
      error: res({
        error: 'Enhanced KYC required',
        code:  'KYC_LEVEL_INSUFFICIENT',
        required_level: requiredLevel,
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
//     event_id: string,           // vendor 那邊的唯一 event id（dedupe 用）
//     user_id?: number,           // 對應到 chiyigo user.id（vendor 用 vendor_session_id 對 mapping）
//     status: string,             // KYC_STATUS 之一
//     level?: string,             // 升級事件
//     vendor_review_id?: string,
//     rejection_reason?: string,
//     verified_at?: string,
//     expires_at?: string,
//     error?: string,             // ok=false 時帶
//   }
//
// 接真實 vendor 時：
//   functions/utils/kyc-vendors/sumsub.js   — Sumsub HMAC + applicantReviewed 事件
//   functions/utils/kyc-vendors/persona.js  — Persona signature + inquiry.completed
//   functions/utils/kyc-vendors/shinkong.js — 永豐
//
// 目前只 ship `mock` vendor 給 tests + scaffold demo。

import { mockKycAdapter } from './kyc-vendors/mock.js'

const ADAPTERS = {
  mock: mockKycAdapter,
  // sumsub:   () => import('./kyc-vendors/sumsub.js').then(m => m.sumsubKycAdapter),
  // persona:  () => import('./kyc-vendors/persona.js').then(m => m.personaKycAdapter),
}

export function resolveKycAdapter(vendor) {
  return ADAPTERS[vendor] ?? null
}
