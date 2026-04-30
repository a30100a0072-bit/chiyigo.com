/**
 * GET /api/admin/metrics
 * Header: Authorization: Bearer <access_token>  (role >= admin)
 *
 * 全站觀測性聚合 — 從 D1 直接查出登入 / refresh / 限流 / 稽核 / AI 用量指標。
 * 純 SELECT 不寫資料、無外部依賴；admin 可定期 curl / 接 dashboard。
 *
 * 回傳結構（所有 count 為整數，時間視窗以 SQLite datetime('now', '-N seconds') 為準）：
 *  users:      總量 / 角色分布 / 24h 與 7d 新註冊 / email_verified 比率
 *  auth:       login_attempts kind 區分（24h / 1h）+ rate limit 命中數 + top IPs
 *  sessions:   refresh_tokens active count + 24h 新發 + 已撤銷
 *  audit:      admin 操作 7d 統計 + hash chain 完整性檢驗
 *  ai:         ai_audit 24h 狀態分布
 */

import { requireRole } from '../../utils/requireRole.js'
import { verifyAuditChain } from '../../utils/audit-log.js'

export async function onRequestGet({ request, env }) {
  const { error } = await requireRole(request, env, 'admin')
  if (error) return error

  const db = env.chiyigo_db

  // ── 並行查詢（D1 不支援 batch SELECT，但可平行 fetch）──────────
  const [
    usersTotal, usersByStatus, usersByRole, usersNew24h, usersNew7d, usersVerified,
    loginFail24h, loginTopIps, loginRateBlocked,
    twofaFail24h, twofaLockedUsers,
    oauthInit1h, oauthInitTopIps,
    emailSend24h,
    sessionsActive, sessionsNew24h, sessionsRevoked7d,
    auditTotal, auditBan7d, auditUnban7d,
    aiTotal24h, aiBlocked24h, aiRateLimited24h, aiOk24h,
  ] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL`).first(),
    db.prepare(`SELECT status, COUNT(*) AS n FROM users WHERE deleted_at IS NULL GROUP BY status`).all(),
    db.prepare(`SELECT role, COUNT(*) AS n FROM users WHERE deleted_at IS NULL GROUP BY role`).all(),
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND created_at > datetime('now', '-1 day')`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND created_at > datetime('now', '-7 days')`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE deleted_at IS NULL AND email_verified = 1`).first(),

    // login_attempts: kind='login' 失敗 24h
    db.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE kind='login' AND created_at > datetime('now', '-1 day')`).first(),
    db.prepare(`SELECT ip, COUNT(*) AS n FROM login_attempts WHERE kind='login' AND created_at > datetime('now', '-1 day') AND ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 5`).all(),
    // login 限流命中數（單一 IP / email 在 15min 視窗 ≥ 上限）— 抓 24h 內 ≥20 ip 與 ≥10 email
    db.prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT ip FROM login_attempts WHERE kind='login' AND created_at > datetime('now', '-1 day') AND ip IS NOT NULL
        GROUP BY ip HAVING COUNT(*) >= 20
      )
    `).first(),

    // 2FA verify
    db.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE kind='2fa' AND created_at > datetime('now', '-1 day')`).first(),
    db.prepare(`
      SELECT COUNT(DISTINCT user_id) AS n FROM (
        SELECT user_id FROM login_attempts
        WHERE kind='2fa' AND user_id IS NOT NULL AND created_at > datetime('now', '-5 minutes')
        GROUP BY user_id HAVING COUNT(*) >= 5
      )
    `).first(),

    // OAuth init 1h
    db.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE kind='oauth_init' AND created_at > datetime('now', '-1 hour')`).first(),
    db.prepare(`SELECT ip, COUNT(*) AS n FROM login_attempts WHERE kind='oauth_init' AND created_at > datetime('now', '-1 hour') AND ip IS NOT NULL GROUP BY ip ORDER BY n DESC LIMIT 5`).all(),

    // email send 24h
    db.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE kind='email_send' AND created_at > datetime('now', '-1 day')`).first(),

    // sessions
    db.prepare(`SELECT COUNT(*) AS n FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > datetime('now')`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM refresh_tokens WHERE expires_at > datetime('now') AND id IN (SELECT id FROM refresh_tokens WHERE expires_at > datetime('now', '-7 days'))`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM refresh_tokens WHERE revoked_at IS NOT NULL AND revoked_at > datetime('now', '-7 days')`).first(),

    // audit log
    db.prepare(`SELECT COUNT(*) AS n FROM admin_audit_log`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='ban' AND created_at > datetime('now', '-7 days')`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM admin_audit_log WHERE action='unban' AND created_at > datetime('now', '-7 days')`).first(),

    // AI 助手 24h
    db.prepare(`SELECT COUNT(*) AS n FROM ai_audit WHERE created_at > datetime('now', '-1 day')`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM ai_audit WHERE status='blocked' AND created_at > datetime('now', '-1 day')`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM ai_audit WHERE status='rate_limited' AND created_at > datetime('now', '-1 day')`).first(),
    db.prepare(`SELECT COUNT(*) AS n FROM ai_audit WHERE status='ok' AND created_at > datetime('now', '-1 day')`).first(),
  ])

  // hash chain 驗證另外做（要從頭 walk，不便和上面平行）
  const chain = await verifyAuditChain(db).catch(err => ({
    valid: false, total: 0, brokenAt: null, reason: 'verify_failed:' + err?.message,
  }))

  // ── 整理輸出 ───────────────────────────────────────────────────
  const byKey = (rows, key) => Object.fromEntries((rows.results ?? []).map(r => [r[key], r.n]))

  const payload = {
    generated_at: new Date().toISOString(),

    users: {
      total:            usersTotal?.n ?? 0,
      by_status:        byKey(usersByStatus, 'status'),
      by_role:          byKey(usersByRole, 'role'),
      new_24h:          usersNew24h?.n ?? 0,
      new_7d:           usersNew7d?.n ?? 0,
      email_verified:   usersVerified?.n ?? 0,
    },

    auth: {
      login_failures_24h:        loginFail24h?.n ?? 0,
      login_top_ips_24h:         (loginTopIps.results ?? []).map(r => ({ ip: r.ip, count: r.n })),
      login_rate_blocked_24h:    loginRateBlocked?.n ?? 0,
      twofa_failures_24h:        twofaFail24h?.n ?? 0,
      twofa_locked_users_5min:   twofaLockedUsers?.n ?? 0,
      oauth_init_calls_1h:       oauthInit1h?.n ?? 0,
      oauth_init_top_ips_1h:     (oauthInitTopIps.results ?? []).map(r => ({ ip: r.ip, count: r.n })),
      email_send_calls_24h:      emailSend24h?.n ?? 0,
    },

    sessions: {
      active_refresh_tokens: sessionsActive?.n ?? 0,
      issued_7d:             sessionsNew24h?.n ?? 0,
      revoked_7d:            sessionsRevoked7d?.n ?? 0,
    },

    audit: {
      total_entries:     auditTotal?.n ?? 0,
      ban_7d:            auditBan7d?.n ?? 0,
      unban_7d:          auditUnban7d?.n ?? 0,
      chain_integrity:   chain,   // { valid, total, brokenAt, reason }
    },

    ai: {
      total_24h:        aiTotal24h?.n ?? 0,
      ok_24h:           aiOk24h?.n ?? 0,
      blocked_24h:      aiBlocked24h?.n ?? 0,
      rate_limited_24h: aiRateLimited24h?.n ?? 0,
    },
  }

  return new Response(JSON.stringify(payload), {
    status:  200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
