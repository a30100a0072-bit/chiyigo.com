/**
 * POST /api/tenants/:tenantId/invitations — invite a member by email (PR4).
 *
 * Plan: docs/reviews/pr4-invitation-member-lifecycle-plan-2026-06-01.md §7.1 / §9 / §10.
 *
 * Auth (tenant-scoped write): requireActiveTenantRole owner/admin -- the LIVE role re-check (chiyigo-side
 * hard-revoke enforcement; a suspended/demoted actor is denied immediately). Strict body allowlist; per-user
 * rate limit (member_invite). The durable invitation row is created first; the email is best-effort (a send
 * failure never rolls back the invite -- the owner can resend). The raw token lives ONLY in the email link.
 */

import { res } from '../../../../utils/auth'
import { requireActiveTenantRole, type PlatformRole } from '../../../../utils/tenant-context'
import { createInvitation } from '../../../../utils/invitations'
import { sendInvitationEmail } from '../../../../utils/email'
import { safeUserAudit } from '../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../utils/rate-limit'

const INVITE_RL_WINDOW_SEC = 60
const INVITE_RL_MAX = 30
const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set(['email', 'platform_role'])
const MANAGER_ROLES: readonly PlatformRole[] = ['tenant_owner', 'tenant_admin']
const EMAIL_SEND_TIMEOUT_MS = 8000

export async function onRequestPost({ request, env, params }) {
  const tenantId = Number(params?.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)

  const gate = await requireActiveTenantRole(request, env, tenantId, MANAGER_ROLES)
  if (gate.ok === false) return gate.error
  const userId = gate.userId

  const { blocked } = await checkRateLimit(env.chiyigo_db, { kind: 'member_invite', userId, windowSeconds: INVITE_RL_WINDOW_SEC, max: INVITE_RL_MAX })
  if (blocked) {
    await emitDenied(env, request, userId, tenantId, 'rate_limited')
    return res({ error: 'Too many invites; slow down', code: 'RATE_LIMITED' }, 429)
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
      await emitDenied(env, request, userId, tenantId, 'unknown_field')
      return res({ error: `Unknown field: ${k}`, code: 'ERR_VALIDATION' }, 400)
    }
  }
  const email = body.email
  const platformRole = body.platform_role
  if (typeof email !== 'string' || typeof platformRole !== 'string') {
    await emitDenied(env, request, userId, tenantId, 'bad_field_type')
    return res({ error: 'email and platform_role are required strings', code: 'ERR_VALIDATION' }, 400)
  }

  const result = await createInvitation(env.chiyigo_db, { tenantId, email, platformRole, invitedByUserId: userId })
  switch (result.outcome) {
    case 'created':
      await safeUserAudit(env, {
        event_type: 'member.invited', user_id: userId, request,
        data: { tenant_id: tenantId, email: result.email, platform_role: result.platformRole, invitation_id: result.invitationId },
      })
      // Best-effort email (durable invite already persisted). Skip when no API key (e.g. tests); bound by AbortSignal.
      if (env.RESEND_API_KEY) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), EMAIL_SEND_TIMEOUT_MS)
        try { await sendInvitationEmail(env.RESEND_API_KEY, result.email, result.rawToken, env, ctrl.signal) }
        catch { /* invite is durable; owner can resend */ }
        finally { clearTimeout(timer) }
      }
      return res({ ok: true, invitation_id: result.invitationId }, 201)
    case 'already_member':
      await emitDenied(env, request, userId, tenantId, 'already_member')
      return res({ error: 'This email is already a member', code: 'ALREADY_MEMBER' }, 409)
    case 'tenant_ineligible':
      await emitDenied(env, request, userId, tenantId, 'tenant_ineligible')
      return res({ error: 'Tenant not eligible for invitations', code: 'TENANT_INELIGIBLE' }, 422)
    case 'invalid':
    default:
      await emitDenied(env, request, userId, tenantId, result.outcome === 'invalid' ? result.code : 'unexpected')
      return res({ error: 'Validation failed', code: result.outcome === 'invalid' ? result.code : 'INTERNAL_ERROR' }, result.outcome === 'invalid' ? 400 : 500)
  }
}

async function emitDenied(env, request, userId: number, tenantId: number, reasonCode: string) {
  await safeUserAudit(env, {
    event_type: 'member.denied', severity: 'warn', user_id: userId, request,
    data: { action: 'invite', tenant_id: tenantId, reason_code: reasonCode },
  })
}
