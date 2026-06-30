/**
 * POST /api/admin/billing/grant — 手動授權 product plan 給 tenant（PR2 Billing/Entitlement Commit 4）。
 *
 * Plan：docs/reviews/pr2-billing-entitlement-plan-2026-05-30.md §8.1。
 *
 * 雙重守門（mirror functions/api/admin/payments/intents/[id]/refund.ts）：
 *   1. step-up token：elevated:billing + for_action='grant_plan'（requireStepUp 一次性消耗 jti，
 *      自然拒一般 access token / 錯 elevated scope / 錯 for_action）。
 *   2. effective admin:billing:grant（admin/developer/super_admin 經 role hierarchy 取得；finance 目前無 —— owner 未決）。
 *
 * actor snapshot 由 server 從 DB 取（granted_by / granted_by_email / granted_by_role），**禁信 client**
 *   （body strict allowlist 不含 actor / granted_by；未知欄位含 occurred_at → 400）。
 * grantPlan 為唯一寫入路徑（append-only ledger + projection，原子 batch）；本 route **不直接寫 ledger/projection**。
 * audit 為 telemetry（ledger 才是 SoT），payload **不含完整 payment_ref**（只放非敏感識別欄）。
 */

import { res, requireStepUp } from '../../../utils/auth'
import { SCOPES, effectiveScopesFromJwt } from '../../../utils/scopes'
import { grantPlan, type GrantPlanManualInput } from '../../../utils/billing'
import { safeUserAudit } from '../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../utils/rate-limit'

// per-user write-path rate limit（arch §13「寬鬆」per-user 上限）。step-up 成功會清自己的 bucket，
// 故 step-up 限流擋不住「compromised session 反覆 mint 一次性 step-up token → 爆量 grant」；
// 本限流獨立計「通過 auth 的 grant attempts」以收斂寫入量。
const BILLING_GRANT_RL_WINDOW_SEC = 60
const BILLING_GRANT_RL_MAX = 30

const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set([
  'tenant_id', 'product_id', 'plan_id', 'manual_source', 'admin_idempotency_key', 'payment_ref', 'grant_reason',
])

async function emitDenied(env: Env, request: Request, userId: number, reasonCode: string, extra: Record<string, unknown> = {}) {
  await safeUserAudit(env, {
    event_type: 'billing.grant.denied', severity: 'warn', user_id: userId, request,
    data: { reason_code: reasonCode, ...extra },
  })
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  // 1. step-up：elevated:billing + for_action='grant_plan'（拒一般 access token / 錯 scope / 錯 action）
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_BILLING, 'grant_plan')
  if (stepCheck.error) return stepCheck.error

  const userId = Number(stepCheck.user.sub)

  // 2. effective admin:billing:grant（step-up token 帶 role → effectiveScopesFromJwt 展開）
  if (!effectiveScopesFromJwt(stepCheck.user).has(SCOPES.ADMIN_BILLING_GRANT)) {
    await emitDenied(env, request, userId, 'insufficient_scope', { required: 'admin:billing:grant' })
    return res({ error: 'admin:billing:grant scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:billing:grant' }, 403)
  }

  // 2.5 per-user rate limit（auth 通過後、寫入前；計通過 auth 的 grant attempts，非 OTP 失敗/無權請求）
  const { blocked } = await checkRateLimit(env.chiyigo_db, {
    kind: 'billing_grant', userId, windowSeconds: BILLING_GRANT_RL_WINDOW_SEC, max: BILLING_GRANT_RL_MAX,
  })
  if (blocked) {
    await emitDenied(env, request, userId, 'rate_limited')
    return res({ error: 'Too many grant attempts; slow down', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'billing_grant', userId })

  // 3. body parse + strict allowlist（未知 key 含 occurred_at → 400）
  let raw: unknown
  try { raw = await request.json() } catch {
    await emitDenied(env, request, userId, 'invalid_json')
    return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    await emitDenied(env, request, userId, 'malformed_body')
    return res({ error: 'Body must be a JSON object', code: 'ERR_VALIDATION' }, 400)
  }
  const body = raw as Record<string, unknown>
  for (const k of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(k)) {
      await emitDenied(env, request, userId, 'unknown_field', { field: k })
      return res({ error: `Unknown field: ${k}`, code: 'ERR_VALIDATION' }, 400)
    }
  }

  // 邊界型別 narrow（深度驗證 / canonicalize / 互斥交給 grantPlan）
  const tenant_id = body.tenant_id
  const product_id = body.product_id
  const plan_id = body.plan_id
  const manual_source = body.manual_source
  const admin_idempotency_key = body.admin_idempotency_key
  const payment_ref = body.payment_ref
  const grant_reason = body.grant_reason
  if (
    typeof tenant_id !== 'number' || typeof product_id !== 'string' || typeof plan_id !== 'number'
    || (manual_source !== 'offline_payment' && manual_source !== 'admin_override')
    || typeof admin_idempotency_key !== 'string'
    || (payment_ref !== undefined && typeof payment_ref !== 'string')
    || (grant_reason !== undefined && typeof grant_reason !== 'string')
  ) {
    await emitDenied(env, request, userId, 'bad_field_type')
    return res({ error: 'Invalid field types', code: 'ERR_VALIDATION' }, 400)
  }

  // 4. actor snapshot 由 DB 取（authoritative；禁信 client；body 也無 actor 欄）
  const userRow = await env.chiyigo_db
    .prepare(`SELECT email, role FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(userId)
    .first()
  // String() 強制轉型：D1 row 值在此 tsconfig（strict:false）下 typeof-narrowing 不收窄；
  // email/role 為 users 表 TEXT NOT NULL，正常即非空字串，空字串視為帳號異常。
  const actorEmail = String(userRow?.email ?? '')
  const actorRole = String(userRow?.role ?? '')
  if (actorEmail.length === 0 || actorRole.length === 0) {
    await emitDenied(env, request, userId, 'actor_not_found')
    return res({ error: 'Actor account not found', code: 'ACTOR_NOT_FOUND' }, 403)
  }

  const input: GrantPlanManualInput = {
    tenantId: tenant_id,
    productId: product_id,
    planId: plan_id,
    manualSource: manual_source,
    adminIdempotencyKey: admin_idempotency_key,
    actor: { id: userId, email: actorEmail, role: actorRole },
  }
  if (typeof payment_ref === 'string') input.paymentRefRaw = payment_ref
  if (typeof grant_reason === 'string') input.grantReason = grant_reason

  // 5. grantPlan（唯一寫入路徑）→ 6. outcome 映射 HTTP + audit（telemetry，無完整 payment_ref）
  const result = await grantPlan(env.chiyigo_db, input)
  const baseData = { tenant_id, product_id, plan_id, manual_source }

  switch (result.outcome) {
    case 'applied':
      await safeUserAudit(env, {
        event_type: 'billing.grant.applied', user_id: userId, request,
        data: { ...baseData, operation_id: result.operationId, version: result.version },
      })
      return res({
        ok: true, operation_id: result.operationId, tenant_id: result.tenantId,
        product_id: result.productId, plan_id: result.planId, status: result.status, version: result.version,
      }, 200)
    case 'replay':
      await safeUserAudit(env, {
        event_type: 'billing.grant.idempotent_replay', user_id: userId, request,
        data: { ...baseData, operation_id: result.operationId },
      })
      return res({
        ok: true, replay: true, operation_id: result.operationId, tenant_id: result.tenantId,
        product_id: result.productId, plan_id: result.planId, status: result.status,
      }, 200)
    case 'conflict':
      await safeUserAudit(env, { event_type: 'billing.grant.conflict', severity: 'warn', user_id: userId, request, data: baseData })
      return res({ error: 'Idempotency key reused with different parameters', code: 'IDEMPOTENCY_CONFLICT' }, 409)
    case 'evidence_conflict':
      await safeUserAudit(env, { event_type: 'billing.grant.evidence_conflict', severity: 'warn', user_id: userId, request, data: baseData })
      return res({ error: 'This offline payment reference is already used', code: 'EVIDENCE_ALREADY_USED' }, 409)
    case 'contention':
      await emitDenied(env, request, userId, 'contention', baseData)
      return res({ error: 'Concurrent grant contention; retry', code: 'CONTENTION' }, 503)
    case 'invalid':
      await emitDenied(env, request, userId, result.code, baseData)
      return res({ error: 'Validation failed', code: result.code }, 400)
    case 'tenant_ineligible':
      await emitDenied(env, request, userId, 'tenant_ineligible', baseData)
      return res({ error: 'Tenant not eligible', code: 'TENANT_INELIGIBLE' }, 422)
    case 'product_inactive':
      await emitDenied(env, request, userId, 'product_inactive', baseData)
      return res({ error: 'Product inactive or unknown', code: 'PRODUCT_INACTIVE' }, 422)
    case 'product_tenant_type_mismatch':
      await emitDenied(env, request, userId, 'product_tenant_type_mismatch', baseData)
      return res({ error: 'Product not available for this tenant type', code: 'PRODUCT_TENANT_TYPE_MISMATCH' }, 422)
    case 'plan_invalid':
      await emitDenied(env, request, userId, 'plan_invalid', baseData)
      return res({ error: 'Plan invalid for product', code: 'PLAN_INVALID' }, 422)
    case 'stale_rejected':
      await emitDenied(env, request, userId, 'stale_rejected', baseData)
      return res({ error: 'Stale grant rejected', code: 'STALE_REJECTED' }, 409)
    case 'illegal_transition':
      await emitDenied(env, request, userId, 'illegal_transition', baseData)
      return res({ error: 'Illegal entitlement transition', code: 'ILLEGAL_TRANSITION' }, 409)
    default:
      await emitDenied(env, request, userId, 'unexpected_outcome', baseData)
      return res({ error: 'Unexpected grant outcome', code: 'INTERNAL_ERROR' }, 500)
  }
}
