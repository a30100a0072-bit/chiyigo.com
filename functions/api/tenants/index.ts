/**
 * GET /api/tenants — 列出目前使用者的 active tenant membership（PR1 Tenant Foundation）。
 *
 * Plan：docs/reviews/pr1-tenant-foundation-plan-2026-05-28.md §6.2（codex Gate 1 r1→r3）。
 *
 * tenant switcher UI 的資料源 + cross-tenant read guard 示範：
 *  - 一律由 token 推導的 userId 查，忽略任何 client 傳入的 tenant 篩選。
 *  - personal tenant 只回「自己擁有的」（personal_owner_user_id = userId）——擋「錯誤 membership row」
 *    指向他人 personal tenant（codex r1 Finding 1）。
 */

import { res, requireRegularAccessToken } from '../../utils/auth'

export async function onRequestGet({ request, env }) {
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

  const tenants = (rows.results ?? []).map((r) => ({
    id:            r.id,
    type:          r.type,
    name:          r.name,
    status:        r.status,
    platform_role: r.platform_role,
  }))
  return res({ tenants })
}
