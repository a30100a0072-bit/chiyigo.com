/**
 * POST /api/tenants/:tenantId/invitations/:invitationId/revoke — revoke a pending invite (PR4 §7.3 / §10).
 *
 * Auth: requireActiveTenantRole owner/admin (live re-check). The domain CAS carries the tenant_id cross-tenant
 * guard, so a wrong :tenantId yields not_found (never reveals another tenant's invite).
 */

import { res } from '../../../../../utils/auth'
import { requireActiveTenantRole, type PlatformRole } from '../../../../../utils/tenant-context'
import { revokeInvitation } from '../../../../../utils/invitations'
import { safeUserAudit } from '../../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../../utils/rate-limit'

const MANAGER_ROLES: readonly PlatformRole[] = ['tenant_owner', 'tenant_admin']
const RL_WINDOW_SEC = 60
const RL_MAX = 60

export async function onRequestPost({ request, env, params }) {
  const tenantId = Number(params?.tenantId)
  const invitationId = Number(params?.invitationId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)
  if (!Number.isInteger(invitationId) || invitationId <= 0) return res({ error: 'Invalid invitation id', code: 'ERR_VALIDATION' }, 400)

  const gate = await requireActiveTenantRole(request, env, tenantId, MANAGER_ROLES)
  if (gate.ok === false) return gate.error
  const userId = gate.userId

  const { blocked } = await checkRateLimit(env.chiyigo_db, { kind: 'member_mutate', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked) {
    await emitDenied(env, request, userId, tenantId, 'rate_limited')
    return res({ error: 'Too many requests; slow down', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'member_mutate', userId })

  const result = await revokeInvitation(env.chiyigo_db, { tenantId, invitationId, actorUserId: userId })
  switch (result.outcome) {
    case 'revoked':
      await safeUserAudit(env, { event_type: 'invitation.revoked', user_id: userId, request, data: { tenant_id: tenantId, invitation_id: invitationId } })
      return res({ ok: true }, 200)
    case 'not_pending':
      await emitDenied(env, request, userId, tenantId, 'not_pending')
      return res({ error: 'Invitation is not pending', code: 'INVITATION_NOT_PENDING' }, 409)
    case 'not_found':
      await emitDenied(env, request, userId, tenantId, 'not_found')
      return res({ error: 'Invitation not found', code: 'INVITATION_NOT_FOUND' }, 404)
    case 'invalid':
    default:
      await emitDenied(env, request, userId, tenantId, result.outcome === 'invalid' ? result.code : 'unexpected')
      return res({ error: 'Validation failed', code: result.outcome === 'invalid' ? result.code : 'INTERNAL_ERROR' }, result.outcome === 'invalid' ? 400 : 500)
  }
}

async function emitDenied(env, request, userId: number, tenantId: number, reasonCode: string) {
  await safeUserAudit(env, {
    event_type: 'member.denied', severity: 'warn', user_id: userId, request,
    data: { action: 'revoke_invitation', tenant_id: tenantId, reason_code: reasonCode },
  })
}
