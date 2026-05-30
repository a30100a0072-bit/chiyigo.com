/**
 * GET /api/tenants/:tenantId/entitlements — 列出某 tenant 的 product access 投影（PR2 Commit 4）。
 *
 * Plan：docs/reviews/pr2-billing-entitlement-plan-2026-05-30.md §8.2。
 *
 * tenant guard（PR1 pattern）：caller 必為 :tenantId 的 active member（tenant active + membership active
 *   + personal-owner guard），由 resolveIssuanceContextForTenant 驗。無 cross-tenant 讀。
 * 只回投影欄位（product_id / plan_id / status / granted_via / version / last_op_occurred_at）；
 *   **不 dump grant_plan_operations ledger evidence**。
 */

import { res, requireRegularAccessToken } from '../../../utils/auth'
import { resolveIssuanceContextForTenant } from '../../../utils/tenant-context'

export async function onRequestGet({ request, env, params }) {
  // 一般 access token（拒 temp_bind / elevated / 非正整數 sub）
  const { userId, error } = await requireRegularAccessToken(request, env)
  if (error) return error

  const targetTenantId = Number(params?.tenantId)
  if (!Number.isInteger(targetTenantId) || targetTenantId <= 0) {
    return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)
  }

  // tenant guard：active membership + active tenant + personal-owner guard（禁 cross-tenant）
  const ctx = await resolveIssuanceContextForTenant(env.chiyigo_db, userId, targetTenantId)
  if (ctx.ok === false) {
    return res({ error: 'Forbidden', code: 'TENANT_ACCESS_DENIED' }, 403)
  }

  const rows = await env.chiyigo_db
    .prepare(
      `SELECT product_id, plan_id, status, granted_via, version, last_op_occurred_at
         FROM tenant_product_access
        WHERE tenant_id = ?
        ORDER BY product_id`,
    )
    .bind(targetTenantId)
    .all()

  const entitlements = (rows.results ?? []).map((r) => ({
    product_id:          r.product_id,
    plan_id:             r.plan_id,
    status:              r.status,
    granted_via:         r.granted_via,
    version:             r.version,
    last_op_occurred_at: r.last_op_occurred_at,
  }))
  return res({ entitlements })
}
