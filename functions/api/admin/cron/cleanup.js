/**
 * POST /api/admin/cron/cleanup
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * 由 GitHub Actions 每天呼叫一次（.github/workflows/cron-cleanup.yml），
 * 清掃 D1 中已過期的短壽 row，避免容量無限增長。
 *
 * 不用 Cloudflare Cron Triggers 的理由：
 *   - Pages Direct Upload 模式對 cron trigger 支援不穩
 *   - GitHub Actions 完全免費（public repo 無限、private 2000 min/月）
 *     一天 1 次 cron 用量為零
 *   - 簡單可審計：workflow yaml 一目了然
 *
 * 為何不直接刪所有過期：
 *   - revoked_jti / login_attempts 保留尾段以利 audit / 風控分析
 *   - 各表保留期見下面註釋
 */

const TASKS = [
  // pkce_sessions: 5min TTL，過期就沒用
  { name: 'pkce_sessions',       sql: `DELETE FROM pkce_sessions       WHERE expires_at < datetime('now')` },

  // auth_codes: 60s TTL（OAuth code）
  { name: 'auth_codes',          sql: `DELETE FROM auth_codes          WHERE expires_at < datetime('now')` },

  // oauth_states: 10min TTL
  { name: 'oauth_states',        sql: `DELETE FROM oauth_states        WHERE expires_at < datetime('now')` },

  // email_verifications: 24h verify / 1h reset，已過期 + 已使用
  { name: 'email_verifications', sql: `DELETE FROM email_verifications
                                       WHERE expires_at < datetime('now')
                                          OR used_at IS NOT NULL` },

  // refresh_tokens: 已 revoke 或過期超過 14 天
  { name: 'refresh_tokens',      sql: `DELETE FROM refresh_tokens
                                       WHERE revoked_at IS NOT NULL
                                          OR expires_at < datetime('now', '-14 days')` },

  // revoked_jti: 過期超過 30 天（保留 30 天供 audit 對照）
  { name: 'revoked_jti',         sql: `DELETE FROM revoked_jti         WHERE expires_at < datetime('now', '-30 days')` },

  // login_attempts: 90 天（風控分析需要尾段）
  { name: 'login_attempts',      sql: `DELETE FROM login_attempts      WHERE created_at < datetime('now', '-90 days')` },

  // audit_log: 90 天（金流前未啟動，保險用）
  { name: 'audit_log',           sql: `DELETE FROM audit_log           WHERE created_at < datetime('now', '-90 days')` },
]

export async function onRequestPost({ request, env }) {
  // ── Auth：bearer CRON_SECRET ──────────────────────────────
  const auth = request.headers.get('Authorization') ?? ''
  const expected = env.CRON_SECRET
  if (!expected) return res({ error: 'CRON_SECRET not configured' }, 500)
  if (auth !== `Bearer ${expected}`) return res({ error: 'unauthorized' }, 401)

  const db = env.chiyigo_db
  const results = []
  let totalDeleted = 0

  for (const task of TASKS) {
    try {
      const r = await db.prepare(task.sql).run()
      const deleted = r.meta?.changes ?? 0
      totalDeleted += deleted
      results.push({ table: task.name, deleted })
    } catch (e) {
      // 單表失敗不中斷其他表，記下來
      results.push({ table: task.name, error: e.message })
    }
  }

  return res({ ok: true, totalDeleted, results })
}

function res(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
