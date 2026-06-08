/**
 * /api/tenants
 *   GET  — list the caller's active tenant memberships (PR1 Tenant Foundation; tenant switcher data source).
 *   POST — create an organization tenant (PR4; the creator becomes its first active tenant_owner).
 *
 * Plan: docs/reviews/pr1-tenant-foundation-plan-2026-05-28.md §6.2 ; pr4-invitation-member-lifecycle-plan §8/§10.
 *
 * POST auth class (PR4 §10): regular token (ANY user) + DURABLE idempotency (NOT requireActiveTenantRole --
 *   there is no :tenantId yet, you are creating the tenant). same idempotency_key + same name -> replay the
 *   same tenant_id (audit org.create.replay, NOT a second org.created); same key + different name -> 409.
 */

import { res, requireRegularAccessToken } from '../../utils/auth'
import { createOrgTenant } from '../../utils/members'
import { safeUserAudit } from '../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'

const ORG_CREATE_RL_WINDOW_SEC = 60
const ORG_CREATE_RL_MAX = 30
const ALLOWED_BODY_KEYS: ReadonlySet<string> = new Set(['name', 'idempotency_key'])

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const { userId, error } = await requireRegularAccessToken(request, env)
  if (error) return error

  const rows = await env.chiyigo_db
    .prepare(
      `SELECT t.id, t.type, t.name, t.status, m.platform_role
       FROM organization_members m JOIN tenants t ON t.id = m.tenant_id
       WHERE m.user_id = ?
         AND m.status = 'active'
         AND t.deleted_at IS NULL AND t.status = 'active'
         AND (t.type = 'organization' OR t.personal_owner_user_id = m.user_id)
       ORDER BY t.id`,
    )
    .bind(userId)
    .all()

  const tenants = (rows.results ?? []).map((r: Record<string, unknown>) => ({
    id:            r.id,
    type:          r.type,
    name:          r.name,
    status:        r.status,
    platform_role: r.platform_role,
  }))
  return res({ tenants })
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const { userId, error } = await requireRegularAccessToken(request, env)
  if (error) return error

  const { blocked } = await checkRateLimit(env.chiyigo_db, {
    kind: 'member_mutate', userId, windowSeconds: ORG_CREATE_RL_WINDOW_SEC, max: ORG_CREATE_RL_MAX,
  })
  if (blocked) {
    await emitDenied(env, request, userId, 'org_create', 'rate_limited')
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
      await emitDenied(env, request, userId, 'org_create', 'unknown_field')
      return res({ error: `Unknown field: ${k}`, code: 'ERR_VALIDATION' }, 400)
    }
  }
  const name = body.name
  const idempotencyKey = body.idempotency_key
  if (typeof name !== 'string' || typeof idempotencyKey !== 'string') {
    await emitDenied(env, request, userId, 'org_create', 'bad_field_type')
    return res({ error: 'name and idempotency_key are required strings', code: 'ERR_VALIDATION' }, 400)
  }

  const result = await createOrgTenant(env.chiyigo_db, { name, creatorUserId: userId, idempotencyKey })
  switch (result.outcome) {
    case 'created':
      await safeUserAudit(env, { event_type: 'org.created', user_id: userId, request, data: { tenant_id: result.tenantId } })
      return res({ ok: true, tenant_id: result.tenantId }, 201)
    case 'replay':
      await safeUserAudit(env, { event_type: 'org.create.replay', user_id: userId, request, data: { tenant_id: result.tenantId } })
      return res({ ok: true, replay: true, tenant_id: result.tenantId }, 200)
    case 'conflict':
      await emitDenied(env, request, userId, 'org_create', 'idempotency_conflict')
      return res({ error: 'Idempotency key reused with a different payload', code: 'IDEMPOTENCY_CONFLICT' }, 409)
    case 'contention':
      await emitDenied(env, request, userId, 'org_create', 'contention')
      return res({ error: 'Concurrent contention; retry', code: 'CONTENTION' }, 503)
    case 'invalid':
    default:
      await emitDenied(env, request, userId, 'org_create', result.outcome === 'invalid' ? result.code : 'unexpected')
      return res({ error: 'Validation failed', code: result.outcome === 'invalid' ? result.code : 'INTERNAL_ERROR' }, result.outcome === 'invalid' ? 400 : 500)
  }
}

async function emitDenied(env: Env, request: Request, userId: number, action: string, reasonCode: string) {
  await safeUserAudit(env, {
    event_type: 'member.denied', severity: 'warn', user_id: userId, request,
    data: { action, reason_code: reasonCode },
  })
}
