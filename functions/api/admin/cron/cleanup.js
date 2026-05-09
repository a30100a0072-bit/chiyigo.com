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

import { res } from '../../../utils/auth.js'

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

  // audit_log：P1-18（金流合規 retention）
  //   - severity='critical' 永不刪（Discord 已通知 + 入 R2 永久存證；evidence trail）
  //   - severity='info'/'warn' 保留 1 年；超過才清
  // 用 SPECIAL 任務名觸發 audit_log_archive() 流程，不走通用 SQL。
  { name: 'audit_log',           special: 'audit_log_archive' },

  // ip_blacklist: 過期即刪（Phase E-4；24hr TTL，過期 row 對 query 無意義）
  { name: 'ip_blacklist',        sql: `DELETE FROM ip_blacklist        WHERE expires_at < datetime('now')` },

  // wallet_nonces: 過期即刪（Phase F-3；5min TTL，consumed 也跟著清）
  { name: 'wallet_nonces',       sql: `DELETE FROM wallet_nonces       WHERE expires_at < datetime('now')` },

  // kyc_webhook_events: 留 90 天（dedupe 視窗 — vendor 重送窗口都不會這麼長）
  { name: 'kyc_webhook_events',  sql: `DELETE FROM kyc_webhook_events  WHERE processed_at < datetime('now', '-90 days')` },

  // payment_webhook_events: 留 90 天（dedupe + 對帳追溯；同 KYC pattern）
  { name: 'payment_webhook_events', sql: `DELETE FROM payment_webhook_events WHERE processed_at < datetime('now', '-90 days')` },

  // payment_intents stale pending：cashier 開了沒付的 intent（user 關掉視窗 / 改主意）
  // 超過 24hr 還停在 pending → 標 canceled，避免 dashboard / admin 列表無限累積。
  // ATM/CVS 取號後 status 已是 processing 不會被掃；succeeded/failed/refunded 也不動。
  // 用 UPDATE 不 DELETE：保留對帳追溯。meta.changes 是 affected rows。
  { name: 'payment_intents_stale_pending',
    sql: `UPDATE payment_intents
             SET status = 'canceled',
                 updated_at = CURRENT_TIMESTAMP,
                 metadata = json_set(COALESCE(metadata, '{}'), '$.canceled_reason', 'stale_pending_24hr')
           WHERE status = 'pending'
             AND created_at < datetime('now', '-24 hours')` },
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
      if (task.special === 'audit_log_archive') {
        const r = await archiveAndDeleteAuditLog(env)
        totalDeleted += r.deleted
        results.push({ table: task.name, ...r })
        continue
      }
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

/**
 * P1-18 audit_log 合規清理。
 * 規則：
 *   - critical 永不刪
 *   - info / warn 保留 1 年；超過才考慮刪
 *   - 若有 env.AUDIT_ARCHIVE_BUCKET（R2 binding）→ 刪前先存一份 JSONL 進 R2
 *   - 沒 R2 binding → 為符合金流合規，info/warn 也不刪（避免無備份就丟證據），只回報 skipped
 *
 * R2 binding 設置（MANUAL_TODO）：
 *   1. wrangler r2 bucket create chiyigo-audit-archive
 *   2. wrangler.toml 加：
 *      [[r2_buckets]]
 *      binding = "AUDIT_ARCHIVE_BUCKET"
 *      bucket_name = "chiyigo-audit-archive"
 *   3. Pages dashboard 同步綁
 */
async function archiveAndDeleteAuditLog(env) {
  const db = env.chiyigo_db
  const cutoff = `datetime('now', '-365 days')`

  // 撈過期 row 數量（用來決定是否走 archive 流程）
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS c FROM audit_log
               WHERE created_at < ${cutoff} AND severity IN ('info','warn')`).first()
  const eligible = countRow?.c ?? 0
  if (!eligible) return { deleted: 0, archived: 0, skipped: 0 }

  // 沒 R2 → 不刪（合規優先），回報待 admin 設置
  if (!env.AUDIT_ARCHIVE_BUCKET) {
    return { deleted: 0, archived: 0, skipped: eligible, note: 'AUDIT_ARCHIVE_BUCKET binding missing; retain rows' }
  }

  // 分批 archive + delete（每批 1000 row，避免單次 worker 撐爆）
  const BATCH = 1000
  let archived = 0
  let deleted = 0
  for (let i = 0; i < 50; i++) {  // 上限 50 批 = 50000 row/次 cron；其餘留下次
    const { results } = await db
      .prepare(`SELECT * FROM audit_log
                 WHERE created_at < ${cutoff} AND severity IN ('info','warn')
                 ORDER BY id ASC LIMIT ?`)
      .bind(BATCH).all()
    if (!results?.length) break

    const date = new Date().toISOString().slice(0, 10)
    const minId = results[0].id
    const maxId = results[results.length - 1].id
    const key = `audit_log/${date}/${minId}-${maxId}.jsonl`
    const body = results.map(r => JSON.stringify(r)).join('\n') + '\n'
    await env.AUDIT_ARCHIVE_BUCKET.put(key, body, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    })

    const ids = results.map(r => r.id)
    const placeholders = ids.map(() => '?').join(',')
    const r = await db
      .prepare(`DELETE FROM audit_log WHERE id IN (${placeholders})`)
      .bind(...ids).run()
    archived += results.length
    deleted += r.meta?.changes ?? 0
  }

  return { deleted, archived, skipped: 0 }
}

