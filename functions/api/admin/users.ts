/**
 * GET /api/admin/users
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * 查詢用戶列表，支援分頁與狀態 / 角色篩選。
 *
 * 查詢參數：
 *  page    — 頁碼（預設 1）
 *  limit   — 每頁筆數（預設 20，上限 100）
 *  status  — 'active' | 'banned' | 'suspended' | '' (全部，預設)
 *  role    — 'player' | 'moderator' | 'admin' | 'developer' | '' (全部，預設)
 *  q       — email 關鍵字模糊搜尋（選填）
 *
 * 回傳：
 *  200 → { users: [...], total, page, limit }
 *  401 / 403 → 未授權或角色不足
 */

import { res, requireAnyScope } from '../../utils/auth'
import { SCOPES } from '../../utils/scopes'
import { safeUserAudit } from '../../utils/user-audit'
import { checkRateLimit, recordRateLimit } from '../../utils/rate-limit'

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  // P1-17 Phase 3: GET 同時接受 admin:users:read 或 :write
  const { user, error } = await requireAnyScope(request, env, SCOPES.ADMIN_USERS_READ, SCOPES.ADMIN_USERS_WRITE)
  if (error) return error

  // SEC-ADMIN-ENUM：全站 user email(PII) 列表，與 deals/audit/payments 同類 list 端點對齊，
  // 補 per-admin rate-limit + read-audit（先前缺兩者 → bulk 枚舉無痕無限速）。
  const adminId = Number(user.sub)
  const rl = await checkRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId, windowSeconds: 60, max: 60 })
  if (rl.blocked) {
    await safeUserAudit(env, { event_type: 'admin.read.rate_limited', severity: 'warn', user_id: adminId, request, data: { endpoint: 'users' } })
    return res({ error: 'Too many requests', code: 'RATE_LIMITED' }, 429)
  }
  await recordRateLimit(env.chiyigo_db, { kind: 'admin_read', userId: adminId })

  const url    = new URL(request.url)
  const page   = Math.max(1, parseInt(url.searchParams.get('page')  ?? '1', 10))
  const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)))
  const status = url.searchParams.get('status') ?? ''
  const role   = url.searchParams.get('role')   ?? ''
  const q      = url.searchParams.get('q')      ?? ''
  const offset = (page - 1) * limit

  const db = env.chiyigo_db

  // ── 動態 WHERE 子句 ──────────────────────────────────────────
  const conditions = ['deleted_at IS NULL']
  const bindings   = []

  if (status) { conditions.push('status = ?');  bindings.push(status) }
  if (role)   { conditions.push('role = ?');    bindings.push(role) }
  if (q) {
    const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
    // ESCAPE must be a single character per SQLite spec; JS literal '\\' = 1 backslash.
    // 配對 L44 escape function 把 `\` 雙寫成 `\\`，ESCAPE '\' 解回字面 `\`。
    conditions.push("email LIKE ? ESCAPE '\\'")
    bindings.push(`%${escaped}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  const [countRow, rows] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total FROM users ${where}`)
      .bind(...bindings)
      .first(),
    db.prepare(`
      SELECT id, email, email_verified, role, status, created_at
      FROM users ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset).all(),
  ])

  const usersOut = (rows.results ?? []).map((u: Record<string, unknown>) => ({
    id:             u.id,
    email:          u.email,
    email_verified: u.email_verified === 1,
    role:           u.role,
    status:         u.status,
    created_at:     u.created_at,
  }))

  // SEC-ADMIN-ENUM read-audit：誰、何時、用什麼 filter 枚舉了多少筆（對齊 deals.ts:101）。
  await safeUserAudit(env, {
    event_type: 'admin.users.read', severity: 'info', user_id: adminId, request,
    data: { filters: { status, role, q, page, limit }, result_count: usersOut.length },
  })

  return res({
    users: usersOut,
    total: countRow?.total ?? 0,
    page,
    limit,
  })
}
