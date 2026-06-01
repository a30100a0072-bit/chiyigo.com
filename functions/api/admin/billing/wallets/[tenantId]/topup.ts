/**
 * POST /api/admin/billing/wallets/:tenantId/topup — 手動為 tenant 錢包儲值（PR3 Credit Wallet）。
 *
 * Plan：docs/reviews/pr3-credit-wallet-plan-2026-06-01.md §8.1。
 *
 * 雙重守門（mirror functions/api/admin/billing/grant.ts）：
 *   1. step-up：elevated:billing + for_action='wallet_topup'（requireStepUp 一次性消耗 jti）。
 *   2. effective admin:billing:wallet（admin/developer/super_admin 經 hierarchy 取得；finance 目前無）。
 *
 * actor snapshot 由 server 從 users row 取（禁信 client；body 無 actor 欄）。
 * topUpCredits 為唯一寫入路徑（credit_wallets UPSERT + credit_ledger，原子 batch）。
 */

import { res, requireStepUp } from '../../../../../utils/auth'
import { SCOPES, effectiveScopesFromJwt } from '../../../../../utils/scopes'
import { topUpCredits } from '../../../../../utils/credit'
import { safeUserAudit } from '../../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../../utils/rate-limit'

const RL_WINDOW_SEC = 60
const RL_MAX = 30
const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set(['amount', 'admin_idempotency_key', 'ref'])

async function emitDenied(env, request, userId: number, reasonCode: string, extra: Record<string, unknown> = {}) {
  await safeUserAudit(env, {
    event_type: 'billing.credit.denied', severity: 'warn', user_id: userId, request,
    data: { reason_code: reasonCode, op: 'topup', ...extra },
  })
}

export async function onRequestPost({ request, env, params }) {
  const stepCheck = await requireStepUp(request, env, SCOPES.ELEVATED_BILLING, 'wallet_topup')
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
  const admin_idempotency_key = body.admin_idempotency_key
  const ref = body.ref
  if (
    typeof amount !== 'number' || typeof admin_idempotency_key !== 'string'
    || (ref !== undefined && typeof ref !== 'string')
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

  const result = await topUpCredits(env.chiyigo_db, {
    tenantId, amount, idempotencyKey: admin_idempotency_key,
    actor: { id: userId, email: actorEmail, role: actorRole },
    ...(typeof ref === 'string' ? { ref } : {}),
  })

  switch (result.outcome) {
    case 'applied':
      await safeUserAudit(env, { event_type: 'billing.credit.topup', user_id: userId, request, data: { tenant_id: tenantId, amount, operation_id: result.operationId, balance: result.balance } })
      return res({ ok: true, tenant_id: tenantId, balance: result.balance, operation_id: result.operationId }, 200)
    case 'replay':
      await safeUserAudit(env, { event_type: 'billing.credit.idempotent_replay', user_id: userId, request, data: { tenant_id: tenantId, op: 'topup', operation_id: result.operationId } })
      return res({ ok: true, replay: true, tenant_id: tenantId, balance: result.balance, operation_id: result.operationId }, 200)
    case 'conflict':
      await safeUserAudit(env, { event_type: 'billing.credit.conflict', severity: 'warn', user_id: userId, request, data: { tenant_id: tenantId, op: 'topup' } })
      return res({ error: 'Idempotency key reused with different parameters', code: 'IDEMPOTENCY_CONFLICT' }, 409)
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
