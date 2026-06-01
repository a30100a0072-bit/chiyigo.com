/**
 * POST /api/admin/billing/wallets/:tenantId/adjust — 手動簽名校正 tenant 錢包餘額（PR3 Credit Wallet）。
 *
 * Plan：docs/reviews/pr3-credit-wallet-plan-2026-06-01.md §8.2。
 *
 * 雙重守門：step-up elevated:billing + for_action='wallet_adjust' + effective admin:billing:wallet。
 * adjustCredits 為唯一寫入路徑（credit_wallets UPDATE + credit_ledger，原子 batch；plain UPDATE 不 provision）。
 * reason 必填（存進 ledger.ref，供 forensic）。debit 超出餘額 → 402 INSUFFICIENT_BALANCE。
 */

import { res, requireStepUp } from '../../../../../utils/auth'
import { SCOPES, effectiveScopesFromJwt } from '../../../../../utils/scopes'
import { adjustCredits } from '../../../../../utils/credit'
import { safeUserAudit } from '../../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../../utils/rate-limit'

const RL_WINDOW_SEC = 60
const RL_MAX = 30
const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set(['amount', 'direction', 'admin_idempotency_key', 'reason'])

async function emitDenied(env, request, userId: number, reasonCode: string, extra: Record<string, unknown> = {}) {
  await safeUserAudit(env, {
    event_type: 'billing.credit.denied', severity: 'warn', user_id: userId, request,
    data: { reason_code: reasonCode, op: 'adjust', ...extra },
  })
}

export async function onRequestPost({ request, env, params }) {
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_BILLING, 'wallet_adjust')
  if (stepCheck.error) return stepCheck.error
  const userId = Number(stepCheck.user.sub)

  if (!effectiveScopesFromJwt(stepCheck.user).has(SCOPES.ADMIN_BILLING_WALLET)) {
    await emitDenied(env, request, userId, 'insufficient_scope', { required: 'admin:billing:wallet' })
    return res({ error: 'admin:billing:wallet scope required', code: 'INSUFFICIENT_SCOPE', required: 'admin:billing:wallet' }, 403)
  }

  const tenantId = Number(params?.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)
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
  const amount = body.amount
  const direction = body.direction
  const admin_idempotency_key = body.admin_idempotency_key
  const reason = body.reason
  if (
    typeof amount !== 'number'
    || (direction !== 'credit' && direction !== 'debit')
    || typeof admin_idempotency_key !== 'string'
    || typeof reason !== 'string'
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

  const result = await adjustCredits(env.chiyigo_db, {
    tenantId, amount, direction, idempotencyKey: admin_idempotency_key, reason,
    actor: { id: userId, email: actorEmail, role: actorRole },
  })

  switch (result.outcome) {
    case 'applied':
      await safeUserAudit(env, { event_type: 'billing.credit.adjusted', user_id: userId, request, data: { tenant_id: tenantId, amount, direction, operation_id: result.operationId, balance: result.balance } })
      return res({ ok: true, tenant_id: tenantId, balance: result.balance, operation_id: result.operationId }, 200)
    case 'replay':
      await safeUserAudit(env, { event_type: 'billing.credit.idempotent_replay', user_id: userId, request, data: { tenant_id: tenantId, op: 'adjust', operation_id: result.operationId } })
      return res({ ok: true, replay: true, tenant_id: tenantId, balance: result.balance, operation_id: result.operationId }, 200)
    case 'conflict':
      await safeUserAudit(env, { event_type: 'billing.credit.conflict', severity: 'warn', user_id: userId, request, data: { tenant_id: tenantId, op: 'adjust' } })
      return res({ error: 'Idempotency key reused with different parameters', code: 'IDEMPOTENCY_CONFLICT' }, 409)
    case 'insufficient_balance':
      await emitDenied(env, request, userId, 'insufficient_balance', { tenant_id: tenantId })
      return res({ error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE' }, 402)
    case 'wallet_not_found':
      await emitDenied(env, request, userId, 'wallet_not_found', { tenant_id: tenantId })
      return res({ error: 'Wallet not provisioned', code: 'WALLET_NOT_PROVISIONED' }, 409)
    case 'tenant_ineligible':
      await emitDenied(env, request, userId, 'tenant_ineligible', { tenant_id: tenantId })
      return res({ error: 'Tenant not eligible', code: 'TENANT_INELIGIBLE' }, 422)
    case 'invalid':
      await emitDenied(env, request, userId, result.code, { tenant_id: tenantId })
      return res({ error: 'Validation failed', code: result.code }, 400)
    case 'contention':
      await emitDenied(env, request, userId, 'contention', { tenant_id: tenantId })
      return res({ error: 'Concurrent wallet contention; retry', code: 'CONTENTION' }, 503)
    default:
      await emitDenied(env, request, userId, 'unexpected_outcome', { tenant_id: tenantId })
      return res({ error: 'Unexpected outcome', code: 'INTERNAL_ERROR' }, 500)
  }
}
