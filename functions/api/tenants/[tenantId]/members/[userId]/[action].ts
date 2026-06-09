/**
 * POST /api/tenants/:tenantId/members/:userId/:action — suspend | reactivate | offboard a member (PR4 §8/§10).
 *
 * Auth: requireActiveTenantRole OWNER-ONLY (D6 lean -- member-state mutations are tenant_owner only; the LIVE
 * re-check is the chiyigo-side hard-revoke enforcement). The domain enforces the STATEMENT-LEVEL last-owner
 * guard + personal-tenant rejection + self-guard. PR4 emits NO domain event (D1 = Option B); the audit row is
 * the trail and DB state is the SoT. role changes go via PATCH /role (a static sibling), never this handler.
 */

import { res } from '../../../../../utils/auth'
import { requireActiveTenantRole, type PlatformRole } from '../../../../../utils/tenant-context'
import { suspendMember, reactivateMember, offboardMember, type MemberOutcome } from '../../../../../utils/members'
import { safeUserAudit, auditDomainEventEmitted } from '../../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../../utils/rate-limit'

const OWNER_ONLY: readonly PlatformRole[] = ['tenant_owner']
const ACTION_EVENT: Record<string, string> = {
  suspend: 'member.suspended', reactivate: 'member.reactivated', offboard: 'member.offboarded',
}
const RL_WINDOW_SEC = 60
const RL_MAX = 60

export async function onRequestPost({ request, env, params }: { request: Request; env: Env; params: Record<string, string> }) {
  const tenantId = Number(params?.tenantId)
  const targetUserId = Number(params?.userId)
  const action = String(params?.action ?? '')
  if (!Number.isInteger(tenantId) || tenantId <= 0) return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) return res({ error: 'Invalid user id', code: 'ERR_VALIDATION' }, 400)
  const eventType = ACTION_EVENT[action]
  if (!eventType) return res({ error: 'Unknown member action', code: 'NOT_FOUND' }, 404)

  const gate = await requireActiveTenantRole(request, env, tenantId, OWNER_ONLY)
  if (gate.ok === false) {
    if (gate.userId !== null) await emitDenied(env, request, gate.userId, tenantId, action, gate.reason ?? 'forbidden')
    return gate.error
  }
  const userId = gate.userId

  const { blocked } = await checkRateLimit(env.chiyigo_db, { kind: 'member_mutate', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked) {
    await emitDenied(env, request, userId, tenantId, action, 'rate_limited')
    return res({ error: 'Too many requests; slow down', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'member_mutate', userId })

  const target = { tenantId, targetUserId, actorUserId: userId }
  let result: MemberOutcome
  if (action === 'suspend') result = await suspendMember(env.chiyigo_db, target)
  else if (action === 'reactivate') result = await reactivateMember(env.chiyigo_db, target)
  else result = await offboardMember(env.chiyigo_db, target)

  if (result.outcome === 'applied') {
    const data: Record<string, unknown> = { tenant_id: tenantId, sub: String(targetUserId) }
    if (result.previousRole !== undefined) data.previous_role = result.previousRole
    if (result.platformRole !== undefined) data.platform_role = result.platformRole
    await safeUserAudit(env, { event_type: eventType, user_id: userId, request, data })
    // PR5 5b: post-commit, best-effort observability that the domain event was emitted into the outbox (C3).
    await auditDomainEventEmitted(env, result.emitted)
    return res({ ok: true }, 200)
  }
  await emitDenied(env, request, userId, tenantId, action, result.outcome === 'invalid' ? result.code : result.outcome)
  return denyResponse(result)
}

function denyResponse(result: MemberOutcome): Response {
  switch (result.outcome) {
    case 'not_a_member':              return res({ error: 'Member not found', code: 'MEMBER_NOT_FOUND' }, 404)
    case 'illegal_transition':        return res({ error: 'Illegal member transition', code: 'ILLEGAL_TRANSITION' }, 409)
    case 'last_owner_protected':      return res({ error: 'Cannot remove the last active owner', code: 'LAST_OWNER_PROTECTED' }, 409)
    case 'personal_tenant_immutable': return res({ error: 'Personal tenants have no managed members', code: 'PERSONAL_TENANT_IMMUTABLE' }, 422)
    case 'cannot_target_self':        return res({ error: 'Cannot target yourself', code: 'CANNOT_TARGET_SELF' }, 409)
    case 'invalid':                   return res({ error: 'Validation failed', code: result.code }, 400)
    default:                          return res({ error: 'Unexpected outcome', code: 'INTERNAL_ERROR' }, 500)
  }
}

async function emitDenied(env: Env, request: Request, userId: number, tenantId: number, action: string, reasonCode: string) {
  await safeUserAudit(env, {
    event_type: 'member.denied', severity: 'warn', user_id: userId, request,
    data: { action, tenant_id: tenantId, reason_code: reasonCode },
  })
}
