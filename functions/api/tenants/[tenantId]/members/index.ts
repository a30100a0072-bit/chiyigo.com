/**
 * GET /api/tenants/:tenantId/members — list active/suspended members + pending invitations (PR4 §10).
 *
 * Auth: requireActiveTenantRole owner/admin (live re-check). DTO only -- never dumps token_hash. sub === the
 * string form of users.id (the JWT subject convention).
 */

import { res } from '../../../../utils/auth'
import { requireActiveTenantRole, type PlatformRole } from '../../../../utils/tenant-context'
import { listPendingInvitations } from '../../../../utils/invitations'

const MANAGER_ROLES: readonly PlatformRole[] = ['tenant_owner', 'tenant_admin']

export async function onRequestGet({ request, env, params }) {
  const tenantId = Number(params?.tenantId)
  if (!Number.isInteger(tenantId) || tenantId <= 0) return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)

  const gate = await requireActiveTenantRole(request, env, tenantId, MANAGER_ROLES)
  if (gate.ok === false) return gate.error

  const memberRows = await env.chiyigo_db
    .prepare(
      `SELECT m.user_id, m.platform_role, m.status, u.email
         FROM organization_members m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ? AND m.status IN ('active','suspended')
        ORDER BY m.user_id`,
    )
    .bind(tenantId)
    .all()
  const members = (memberRows.results ?? []).map((r) => ({
    user_id:       Number(r.user_id),
    sub:           String(r.user_id),
    email:         r.email,
    platform_role: r.platform_role,
    status:        r.status,
  }))

  const pending = (await listPendingInvitations(env.chiyigo_db, tenantId)).map((i) => ({
    invitation_id: i.id,
    email:         i.email,
    platform_role: i.platform_role,
    expires_at:    i.expires_at,
  }))

  return res({ members, pending_invitations: pending })
}
