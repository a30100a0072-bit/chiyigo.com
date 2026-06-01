/**
 * POST /api/invitations/accept — accept an invitation (PR4 §7.2 / §10).
 *
 * Auth class (NOT a tenant-owner action): requireRegularAccessToken (the invitee) -- the tenant is derived from
 * the invitation row, never a :tenantId. The domain (acceptInvitation) does the token verification, the
 * email-match/verified check, the active-tenant check, the atomic one-time consume + plain-INSERT join (no
 * silent reactivation), and the LIVE-membership-gated replay. Per-user rate limit blunts token brute force.
 */

import { res, requireRegularAccessToken } from '../../utils/auth'
import { acceptInvitation } from '../../utils/invitations'
import { safeUserAudit } from '../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'

const ACCEPT_RL_WINDOW_SEC = 60
const ACCEPT_RL_MAX = 30
const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set(['token'])

export async function onRequestPost({ request, env }) {
  const { userId, error } = await requireRegularAccessToken(request, env)
  if (error) return error

  const { blocked } = await checkRateLimit(env.chiyigo_db, { kind: 'member_invite', userId, windowSeconds: ACCEPT_RL_WINDOW_SEC, max: ACCEPT_RL_MAX })
  if (blocked) {
    await emitDenied(env, request, userId, 'rate_limited')
    return res({ error: 'Too many attempts; slow down', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'member_invite', userId })

  let raw: unknown
  try { raw = await request.json() } catch {
    return res({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return res({ error: 'Body must be a JSON object', code: 'ERR_VALIDATION' }, 400)
  }
  const body = raw as Record<string, unknown>
  for (const k of Object.keys(body)) {
    if (!ALLOWED_BODY_KEYS.has(k)) {
      await emitDenied(env, request, userId, 'unknown_field')
      return res({ error: `Unknown field: ${k}`, code: 'ERR_VALIDATION' }, 400)
    }
  }
  const token = body.token
  if (typeof token !== 'string' || token.length === 0) {
    await emitDenied(env, request, userId, 'bad_field_type')
    return res({ error: 'token is required', code: 'ERR_VALIDATION' }, 400)
  }

  const result = await acceptInvitation(env.chiyigo_db, { rawToken: token, acceptingUserId: userId })
  switch (result.outcome) {
    case 'joined':
      await safeUserAudit(env, {
        event_type: 'member.joined', user_id: userId, request,
        data: { tenant_id: result.tenantId, sub: result.sub, platform_role: result.platformRole },
      })
      return res({ ok: true, tenant_id: result.tenantId, platform_role: result.platformRole }, 200)
    case 'replay':
      await safeUserAudit(env, {
        event_type: 'invitation.accept.replay', user_id: userId, request,
        data: { tenant_id: result.tenantId, sub: String(userId) },
      })
      return res({ ok: true, replay: true, tenant_id: result.tenantId, platform_role: result.platformRole }, 200)
    case 'not_found':
      await emitDenied(env, request, userId, 'not_found')
      return res({ error: 'Invitation not found', code: 'INVITATION_NOT_FOUND' }, 404)
    case 'expired':
      await emitDenied(env, request, userId, 'expired')
      return res({ error: 'Invitation expired', code: 'INVITATION_EXPIRED' }, 410)
    case 'email_mismatch':
      await emitDenied(env, request, userId, 'email_mismatch')
      return res({ error: 'This invitation was issued to a different (verified) email', code: 'INVITE_EMAIL_MISMATCH' }, 403)
    case 'membership_not_active':
      await emitDenied(env, request, userId, 'membership_not_active')
      return res({ error: 'Membership is not active', code: 'MEMBERSHIP_NOT_ACTIVE' }, 403)
    case 'already_resolved':
      await emitDenied(env, request, userId, 'already_resolved')
      return res({ error: 'Invitation is no longer pending', code: 'INVITATION_NOT_PENDING' }, 409)
    case 'already_member':
      await emitDenied(env, request, userId, 'already_member')
      return res({ error: 'You are already a member of this tenant', code: 'ALREADY_MEMBER' }, 409)
    case 'tenant_ineligible':
      await emitDenied(env, request, userId, 'tenant_ineligible')
      return res({ error: 'Tenant not eligible', code: 'TENANT_INELIGIBLE' }, 422)
    case 'invalid':
    default:
      await emitDenied(env, request, userId, result.outcome === 'invalid' ? result.code : 'unexpected')
      return res({ error: 'Validation failed', code: result.outcome === 'invalid' ? result.code : 'INTERNAL_ERROR' }, result.outcome === 'invalid' ? 400 : 500)
  }
}

async function emitDenied(env, request, userId: number, reasonCode: string) {
  await safeUserAudit(env, {
    event_type: 'invitation.accept.denied', severity: 'warn', user_id: userId, request,
    data: { reason_code: reasonCode },
  })
}
