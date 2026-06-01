/**
 * PUT /api/admin/billing/quotas/:tenantId/:productId — 設定 product 用量上限（PR3 Credit Wallet）。
 *
 * Plan：docs/reviews/pr3-credit-wallet-plan-2026-06-01.md §8.3。
 *
 * 雙重守門：step-up elevated:billing + for_action='quota_set' + effective admin:billing:wallet。
 * setProductQuota 為唯一寫入路徑（authoritative quota_config_ledger INSERT + product_usage_quota UPSERT，原子 batch）。
 * 具 durable idempotency（admin_idempotency_key）：retry 不會新增第二筆權威 ledger row（codex round-2 finding 1）。
 * 調降低於已用量 → 409 QUOTA_BELOW_USAGE。非 'lifetime' period → 400 UNSUPPORTED_PERIOD（PR3 單一 period）。
 */

import { res, requireStepUp } from '../../../../../utils/auth'
import { SCOPES, effectiveScopesFromJwt } from '../../../../../utils/scopes'
import { setProductQuota } from '../../../../../utils/credit'
import { safeUserAudit } from '../../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../../utils/rate-limit'

const RL_WINDOW_SEC = 60
const RL_MAX = 30
const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set(['quota_limit', 'admin_idempotency_key', 'period', 'reason'])

async function emitDenied(env, request, userId: number, reasonCode: string, extra: Record<string, unknown> = {}) {
  await safeUserAudit(env, {
    event_type: 'billing.credit.denied', severity: 'warn', user_id: userId, request,
    data: { reason_code: reasonCode, op: 'quota_set', ...extra },
  })
}

export async function onRequestPut({ request, env, params }) {
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_BILLING, 'quota_set')
  if (stepCheck.error) return stepCheck.error
  const userId = Number(stepCheck.user.sub)

  if (!effectiveScopesFromJwt(stepCheck.user).has(SCOPES.ADMIN_BILLING_WALLET)) {
    await emitDenied(env, request, userId, 'insufficient_scope', { required: 'admin:billing:wallet' })
    return res({ error: 'admin:billing:wallet scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:billing:wallet' }, 403)
  }

  const tenantId = Number(params?.tenantId)
  const productId = typeof params?.productId === 'string' ? params.productId : ''
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)
  }
  if (productId.length === 0) {
    return res({ error: 'Invalid product id', code: 'ERR_VALIDATION' }, 400)
  }

  const { blocked } = await checkRateLimit(env.chiyigo_db, { kind: 'billing_wallet', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked) {
    await emitDenied(env, request, userId, 'rate_limited')
    return res({ error: 'Too many wallet operations; slow down', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'billing_wallet', userId })

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
  const quota_limit = body.quota_limit
  const admin_idempotency_key = body.admin_idempotency_key
  const period = body.period
  const reason = body.reason
  if (
    typeof quota_limit !== 'number' || typeof admin_idempotency_key !== 'string'
    || (period !== undefined && typeof period !== 'string')
    || (reason !== undefined && typeof reason !== 'string')
  ) {
    await emitDenied(env, request, userId, 'bad_field_type')
    return res({ error: 'Invalid field types', code: 'ERR_VALIDATION' }, 400)
  }

  const userRow = await env.chiyigo_db.prepare(`SELECT email, role FROM users WHERE id = ? AND deleted_at IS NULL`).bind(userId).first()
  const actorEmail = String(userRow?.email ?? '')
  const actorRole = String(userRow?.role ?? '')
  if (actorEmail.length === 0 || actorRole.length === 0) {
    await emitDenied(env, request, userId, 'actor_not_found')
    return res({ error: 'Actor account not found', code: 'ACTOR_NOT_FOUND' }, 403)
  }

  const result = await setProductQuota(env.chiyigo_db, {
    tenantId, productId, quotaLimit: quota_limit, adminIdempotencyKey: admin_idempotency_key,
    actor: { id: userId, email: actorEmail, role: actorRole },
    ...(typeof period === 'string' ? { period } : {}),
    ...(typeof reason === 'string' ? { reason } : {}),
  })

  switch (result.outcome) {
    case 'applied':
      await safeUserAudit(env, { event_type: 'billing.quota.set', user_id: userId, request, data: { tenant_id: tenantId, product_id: productId, quota_limit: result.quotaLimit, operation_id: result.operationId } })
      return res({ ok: true, tenant_id: tenantId, product_id: productId, quota_limit: result.quotaLimit, operation_id: result.operationId }, 200)
    case 'replay':
      // durable idempotency 重放：不重發 billing.quota.set（避免觀測/稽核看到重複 quota set），只記 replay telemetry。
      await safeUserAudit(env, { event_type: 'billing.credit.idempotent_replay', user_id: userId, request, data: { tenant_id: tenantId, product_id: productId, op: 'quota_set', operation_id: result.operationId } })
      return res({ ok: true, replay: true, tenant_id: tenantId, product_id: productId, quota_limit: result.quotaLimit, operation_id: result.operationId }, 200)
    case 'conflict':
      await safeUserAudit(env, { event_type: 'billing.credit.conflict', severity: 'warn', user_id: userId, request, data: { tenant_id: tenantId, op: 'quota_set' } })
      return res({ error: 'Idempotency key reused with different parameters', code: 'IDEMPOTENCY_CONFLICT' }, 409)
    case 'quota_below_used':
      await emitDenied(env, request, userId, 'quota_below_used', { tenant_id: tenantId, product_id: productId })
      return res({ error: 'New quota limit is below current usage', code: 'QUOTA_BELOW_USAGE' }, 409)
    case 'tenant_ineligible':
      await emitDenied(env, request, userId, 'tenant_ineligible', { tenant_id: tenantId })
      return res({ error: 'Tenant not eligible', code: 'TENANT_INELIGIBLE' }, 422)
    case 'product_inactive':
      await emitDenied(env, request, userId, 'product_inactive', { tenant_id: tenantId, product_id: productId })
      return res({ error: 'Product inactive or unknown', code: 'PRODUCT_INACTIVE' }, 422)
    case 'product_tenant_type_mismatch':
      await emitDenied(env, request, userId, 'product_tenant_type_mismatch', { tenant_id: tenantId, product_id: productId })
      return res({ error: 'Product not available for this tenant type', code: 'PRODUCT_TENANT_TYPE_MISMATCH' }, 422)
    case 'invalid':
      await emitDenied(env, request, userId, result.code, { tenant_id: tenantId, product_id: productId })
      return res({ error: 'Validation failed', code: result.code }, 400)
    case 'contention':
      await emitDenied(env, request, userId, 'contention', { tenant_id: tenantId })
      return res({ error: 'Concurrent quota contention; retry', code: 'CONTENTION' }, 503)
    default:
      await emitDenied(env, request, userId, 'unexpected_outcome', { tenant_id: tenantId })
      return res({ error: 'Unexpected outcome', code: 'INTERNAL_ERROR' }, 500)
  }
}
