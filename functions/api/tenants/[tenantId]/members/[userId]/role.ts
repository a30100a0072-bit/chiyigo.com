/**
 * PATCH /api/tenants/:tenantId/members/:userId/role — change a member's platform_role (PR4 §8/§10).
 *
 * Auth: requireActiveTenantRole OWNER-ONLY (role escalation is owner-only; arch §9 "member cannot self-promote").
 * The domain blocks demoting the last active owner (statement-level) + self-targeting. Ownership transfer = a
 * deliberate role change to tenant_owner (allowed), not an account move.
 */

import { res } from '../../../../../utils/auth'
import { requireActiveTenantRole, type PlatformRole } from '../../../../../utils/tenant-context'
import { changeMemberRole, type MemberOutcome } from '../../../../../utils/members'
import { safeUserAudit } from '../../../../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../../../../utils/rate-limit'

const OWNER_ONLY: readonly PlatformRole[] = ['tenant_owner']
const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set(['platform_role'])
const RL_WINDOW_SEC = 60
const RL_MAX = 60

export async function onRequestPatch({ request, env, params }) {
  const tenantId = Number(params?.tenantId)
  const targetUserId = Number(params?.userId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)
  if (!Number.isInteger(targetUserId) || targetUserId <= 0) return res({ error: 'Invalid user id', code: 'ERR_VALIDATION' }, 400)

  const gate = await requireActiveTenantRole(request, env, tenantId, OWNER_ONLY)
  if (gate.ok === false) return gate.error
  const userId = gate.userId

  const { blocked } = await checkRateLimit(env.chiyigo_db, { kind: 'member_mutate', userId, windowSeconds: RL_WINDOW_SEC, max: RL_MAX })
  if (blocked) {
    await emitDenied(env, request, userId, tenantId, 'rate_limited')
    return res({ error: 'Too many requests; slow down', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'member_mutate', userId })

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
  const platformRole = body.platform_role
  if (typeof platformRole !== 'string') {
    await emitDenied(env, request, userId, tenantId, 'bad_field_type')
    return res({ error: 'platform_role is required', code: 'ERR_VALIDATION' }, 400)
  }

  const result = await changeMemberRole(env.chiyigo_db, { tenantId, targetUserId, actorUserId: userId, toRole: platformRole })
  if (result.outcome === 'applied') {
    await safeUserAudit(env, {
      event_type: 'member.role_changed', user_id: userId, request,
      data: { tenant_id: tenantId, sub: String(targetUserId), from_role: result.fromRole, to_role: result.toRole },
    })
    return res({ ok: true }, 200)
  }
  await emitDenied(env, request, userId, tenantId, result.outcome === 'invalid' ? result.code : result.outcome)
  return denyResponse(result)
}

function denyResponse(result: MemberOutcome): Response {
  switch (result.outcome) {
    case 'not_a_member':              return res({ error: 'Member not found', code: 'MEMBER_NOT_FOUND' }, 404)
    case 'illegal_transition':        return res({ error: 'Illegal member transition', code: 'ILLEGAL_TRANSITION' }, 409)
    case 'last_owner_protected':      return res({ error: 'Cannot demote the last active owner', code: 'LAST_OWNER_PROTECTED' }, 409)
    case 'personal_tenant_immutable': return res({ error: 'Personal tenants have no managed members', code: 'PERSONAL_TENANT_IMMUTABLE' }, 422)
    case 'cannot_target_self':        return res({ error: 'Cannot change your own role', code: 'CANNOT_TARGET_SELF' }, 409)
    case 'invalid':                   return res({ error: 'Validation failed', code: result.code }, 400)
    default:                          return res({ error: 'Unexpected outcome', code: 'INTERNAL_ERROR' }, 500)
  }
}

async function emitDenied(env, request, userId: number, tenantId: number, reasonCode: string) {
  await safeUserAudit(env, {
    event_type: 'member.denied', severity: 'warn', user_id: userId, request,
    data: { action: 'role_change', tenant_id: tenantId, reason_code: reasonCode },
  })
}
