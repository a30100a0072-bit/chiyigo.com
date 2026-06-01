/**
 * GET /api/tenants/:tenantId/wallet — 讀取某 tenant 的錢包餘額 + 各 product quota（PR3 Credit Wallet）。
 *
 * Plan：docs/reviews/pr3-credit-wallet-plan-2026-06-01.md §8.4。
 *
 * tenant guard（PR1 pattern）：caller 必為 :tenantId 的 active member，且 platform_role 為 billing-capable
 *   （tenant_owner / tenant_admin / billing_admin）—— 餘額是財務資料，deny-by-default 限管帳角色（plan §7，
 *   比 entitlements 嚴格）。plain member → 403。由 resolveIssuanceContextForTenant 取 active membership + role。
 * 只回投影欄（balance / quotas）；不 dump credit_ledger。wallet 未 provision → wallet:null（≠ balance:0）。
 */

import { res, requireRegularAccessToken } from '../../../utils/auth'
import { resolveIssuanceContextForTenant } from '../../../utils/tenant-context'

const BILLING_CAPABLE_ROLES: ReadonlySet<string> = new Set(['tenant_owner', 'tenant_admin', 'billing_admin'])

export async function onRequestGet({ request, env, params }) {
  const { userId, error } = await requireRegularAccessToken(request, env)
  if (error) return error

  const targetTenantId = Number(params?.tenantId)
  if (!Number.isInteger(targetTenantId) || targetTenantId <= 0) {
    return res({ error: 'Invalid tenant id', code: 'ERR_VALIDATION' }, 400)
  }

  // active membership + active tenant + personal-owner guard（禁 cross-tenant）
  const ctx = await resolveIssuanceContextForTenant(env.chiyigo_db, userId, targetTenantId)
  if (ctx.ok === false) {
    return res({ error: 'Forbidden', code: 'TENANT_ACCESS_DENIED' }, 403)
  }
  // 財務資料：限 billing-capable role（plan §7 / decision item 6）。plain member 不可讀餘額。
  if (!BILLING_CAPABLE_ROLES.has(ctx.platform_role)) {
    return res({ error: 'Forbidden', code: 'INSUFFICIENT_PLATFORM_ROLE' }, 403)
  }

  // 端點 env 無型別 → 不可用 .first<T>() generic（TS2347）；同 entitlements.ts 慣例不帶 generic，
  // 取值處以 Number() 強制轉型（strict:false 下跨語句不收窄；plan §3 / feedback_ts_no_jsdoc_in_ts_mode）。
  const walletRow = await env.chiyigo_db
    .prepare(`SELECT balance FROM credit_wallets WHERE tenant_id = ?`)
    .bind(targetTenantId)
    .first()

  const quotaRows = await env.chiyigo_db
    .prepare(
      `SELECT product_id, period, quota_limit, quota_used
         FROM product_usage_quota WHERE tenant_id = ? ORDER BY product_id, period`,
    )
    .bind(targetTenantId)
    .all()

  const quotas = (quotaRows.results ?? []).map((r) => ({
    product_id:  r.product_id,
    period:      r.period,
    quota_limit: r.quota_limit,
    quota_used:  r.quota_used,
  }))

  return res({
    wallet: walletRow ? { balance: Number(walletRow.balance) } : null,
    quotas,
  })
}
