/**
 * POST /api/admin/cron/audit-aggregate
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 3.0 — Aggregate worker (telemetry-only skeleton)
 * （design doc：docs/AUDIT_RETENTION_PLAN.md §「Aggregate 規則 v3」+ PR 3）
 *
 * 行為：
 *   1. 算 cutoff = `now - (hotDays - leadHours/24) days`（design doc：hot 過期前 24h）
 *      hotDays 來自 hotRetentionDaysFor(env, 'telemetry')（與 archive worker 共用 helper）
 *   2. SELECT audit_log 中 cold_class='telemetry' / archived_at IS NULL /
 *      created_at < cutoff 的所有 row
 *   3. 在 JS 做 reduce → bucket Map（event_type / user_id / severity / hour_bucket）
 *   4. policy drift fail-fast：任何 row 不再 classify 為 telemetry → emit critical event
 *      + abort 整輪（不寫 bucket）。對齊 archive worker PR 2.1c cold_class_drift。
 *   5. UPSERT 每 bucket 進 audit_log_aggregate_telemetry（uniq_agg_tele_bucket 索引）
 *   6. emit audit.aggregate.run_completed (info) summary event
 *
 * 為何 PR 3.0 沒 R2 / 沒狀態機：
 *   - 寫入目標是 D1（aggregate 表自身），不寫 R2 — PR 3.2 才把 aggregate 表進 R2
 *   - idempotency 靠 UNIQUE bucket index + count 重算（每輪重新從 raw row reduce）
 *     而不是狀態機；crash 中途 → 下輪 cron 重 reduce 出相同 bucket count → INSERT
 *     OR REPLACE 仍會收斂
 *   - 不刪 raw row：PR 4 才動。本檔禁止 DELETE audit_log（archive worker 的
 *     no-delete discipline 也涵蓋 aggregate worker 行為一致性）
 *
 * 🔴 與 archive worker 的 timing：
 *   aggregate cutoff = now - (hotDays - 1) days；archive fresh pipeline = now - hotDays days
 *   兩條 cutoff 之間 24h 緩衝；同 row 在 aggregate UPSERT 後 24h 才會被 archive 撈進 R2。
 *
 * Cron 觸發：.github/workflows/cron-audit-aggregate.yml（每日 17:00 UTC = 01:00 隔日 Asia/Taipei，
 * archive worker 18:00 UTC 之前 1 小時；codex r1 H-1 改 daily 避開 archived_at IS NULL 漏網）
 */

import { res } from '../../../utils/auth.js'
import { safeUserAudit } from '../../../utils/user-audit'
import { hotRetentionDaysFor } from '../../../utils/audit-archive.js'
import {
  AGGREGATE_WRITER_VERSION,
  PR30_SUPPORTED_COLD_CLASS,
  parseMaxRowsPerRun,
  parseLeadHours,
  totalCutoffHours,
  reduceTelemetryBuckets,
  rowIsTelemetry,
} from '../../../utils/audit-aggregate'

function archiveEnv(env) {
  return String(env.ARCHIVE_ENV ?? 'prod')
}

function newRunId() {
  return `agg-${crypto.randomUUID()}`
}

export async function onRequestPost({ request, env }) {
  // ── Auth ─────────────────────────────────────────────────
  const auth = request.headers.get('Authorization') ?? ''
  const expected = env.CRON_SECRET
  if (!expected) return res({ error: 'CRON_SECRET not configured', code: 'CRON_SECRET_NOT_CONFIGURED' }, 500)
  if (auth !== `Bearer ${expected}`) return res({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  const db = env.chiyigo_db
  if (!db) return res({ error: 'chiyigo_db binding missing', code: 'INTERNAL_ERROR' }, 500)

  const envName    = archiveEnv(env)
  const runId      = newRunId()
  const startedAt  = new Date().toISOString()
  const leadHours  = parseLeadHours(env)
  const maxRows    = parseMaxRowsPerRun(env)
  const hotDays    = hotRetentionDaysFor(env, PR30_SUPPORTED_COLD_CLASS)

  // codex r2 L-2：report.cutoff 與 SQL `datetime('now','-N hours')` 必須 same source。
  // 原本 cutoffISO 走 telemetryCutoffISO（吃 raw hotDays/leadHours）、SQL 走
  // totalCutoffHours（clamped）。極端 env（1e308）下 cutoffISO 拋 null 提早走
  // hot_days_disabled、跳過 clamp 後的 SQL path，observability 與行為脫鉤。
  // 改成都從 effectiveHours 推導：clamped → SQL；同一個值 → cutoffISO。
  const effectiveHours = totalCutoffHours(hotDays, leadHours)
  const cutoffISO = (hotDays > 0 && effectiveHours > 0)
    ? new Date(Date.now() - effectiveHours * 3600 * 1000).toISOString()
    : null

  const report = {
    ok: true,
    run_id: runId,
    started_at: startedAt,
    cold_class: PR30_SUPPORTED_COLD_CLASS,
    writer_version: AGGREGATE_WRITER_VERSION,
    hot_days: hotDays,
    lead_hours: leadHours,
    effective_cutoff_hours: effectiveHours,   // codex r2 L-2：揭露真正用於 SQL 的 clamped 值
    cutoff: cutoffISO,
    max_rows_per_run: maxRows,
    rows_scanned: 0,
    buckets_upserted: 0,
    skipped_reason: null,
    errors: [],
  }

  // ── Step 1：cutoff 無效 → skip ───────────────────────────────────────────
  // codex r3 L 拆 reason：
  //   - hotDays<=0          → hot_days_disabled（operator 顯式關閉 hot 保留 = 不該走 aggregate）
  //   - hotDays>0 但 eff<=0 → cutoff_hours_collapsed（leadHours 過大壓死 cutoff，
  //                          可能是 ops 誤設 AUDIT_AGGREGATE_LEAD_HOURS；
  //                          仍 skip 因為 effectiveHours=0 會撈到 now-邊界內所有 row）
  if (cutoffISO == null) {
    report.skipped_reason = hotDays <= 0 ? 'hot_days_disabled' : 'cutoff_hours_collapsed'
    await emitSkipped(env, report, { reason: report.skipped_reason })
    report.finished_at = new Date().toISOString()
    return res(report, 200)
  }

  // ── Step 2：撈 candidates ────────────────────────────────
  // 不用 GROUP BY 直接 reduce，因為 ip_hash_top 需要 mode reduce（D1 缺 window function）
  // 加 LIMIT (maxRows+1) 偵測「超過上限」場景 → skip 而不部分處理避免 count 不對
  //
  // 🔴 cutoff 比較刻意用 SQLite 原生 datetime('now', '-N hours')（與 archive worker 同模式），
  // 不用 JS 算 ISO + bind 比對。原因：SQLite `datetime('now')` 預設儲存格式
  // `'YYYY-MM-DD HH:MM:SS'`（空白分隔、無 'T'/'Z'），與 JS Date.toISOString()
  // `'YYYY-MM-DDTHH:MM:SS.sssZ'` 在 lexicographic 比較時，position 10 是 space(0x20)
  // vs 'T'(0x54) — 同日期但 SQL row 時間 > cutoff 時間的 row 會被誤判 < cutoff。
  // 最壞 1 天 23 小時的 row 被偷渡進 aggregate（破壞 24h archive buffer 設計）。
  // 直接用 datetime modifier 讓 SQLite 自己算 → 格式一致、bug 不存在。
  // codex r1 L-1：effectiveHours 已 clamp 到 [0, 100年] 防 Infinity 內嵌 SQL。
  // codex r2 L-2：與 report.cutoff 同源（上方 effectiveHours = totalCutoffHours(...)）。
  let candidates
  try {
    const rs = await db.prepare(
      `SELECT id, event_type, severity, user_id, ip_hash, created_at
         FROM audit_log
        WHERE cold_class = ?
          AND archived_at IS NULL
          AND created_at < datetime('now', '-${effectiveHours} hours')
        ORDER BY id ASC
        LIMIT ?`
    ).bind(PR30_SUPPORTED_COLD_CLASS, maxRows + 1).all()
    candidates = rs.results ?? []
  } catch (e) {
    return fail(env, report, 'd1_select_failed', { error: String(e?.message ?? e) })
  }

  report.rows_scanned = candidates.length

  if (candidates.length === 0) {
    report.skipped_reason = 'no_rows_eligible'
    await emitSkipped(env, report, { reason: report.skipped_reason })
    report.finished_at = new Date().toISOString()
    return res(report, 200)
  }

  if (candidates.length > maxRows) {
    // 超過單輪上限 — 不部分處理（會讓 bucket count 不全 → 與 idempotent UPSERT
    // 假設衝突）。Skip + 升 critical 等人決定要不要把 maxRows 開大或補 backfill。
    report.skipped_reason = 'rows_exceed_max_per_run'
    return fail(env, report, 'rows_exceed_max_per_run', {
      rows_scanned: candidates.length,
      max_rows_per_run: maxRows,
    })
  }

  // ── Step 3：policy drift fail-fast ──────────────────────
  // PR 2.1c codex M-1 pattern：stored cold_class='telemetry' 的 row 若被 runtime
  // classifier 判定為其他類，表示 backfill 與 policy 不同步。aggregate 進 bucket
  // 後資料指紋固化（count + ip_hash_top）會誤導 forensic；不自作主張處理半套資料。
  const drift = candidates.filter(r => !rowIsTelemetry(r))
  if (drift.length > 0) {
    const sampleIds = drift.slice(0, 20).map(r => r.id)
    report.skipped_reason = 'cold_class_drift_detected'
    return fail(env, report, 'cold_class_drift', {
      drift_count: drift.length,
      sample_ids: sampleIds,
      sample_event_types: [...new Set(drift.slice(0, 20).map(r => r.event_type))],
    })
  }

  // ── Step 4：reduce → buckets ────────────────────────────
  const buckets = reduceTelemetryBuckets(candidates)

  // ── Step 5：UPSERT each bucket ──────────────────────────
  // SQLite INSERT OR REPLACE 命中 uniq_agg_tele_bucket（含 COALESCE(user_id,-1)
  // sentinel 表達式索引）→ 舊 row 刪除 + 新 row 插入，created_at DEFAULT 重套作
  // 「last aggregated at」語意。AUTOINCREMENT id 會跳號 — 不要當穩定 key 用。
  let upserts = 0
  for (const b of buckets.values()) {
    try {
      await db.prepare(
        `INSERT OR REPLACE INTO audit_log_aggregate_telemetry
           (event_type, user_id, severity, hour_bucket, count, ip_hash_top, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(b.event_type, b.user_id, b.severity, b.hour_bucket, b.count, b.ip_hash_top).run()
      upserts++
    } catch (e) {
      // 單 bucket 失敗 → 記錄但繼續，最終整輪報部分失敗 ok=false。
      // 不 abort：UPSERT idempotent，下輪 cron 重做不會雙寫；中止會讓已成功的
      // bucket 也失去「整輪 run_completed」紀錄。
      report.ok = false
      report.errors.push({
        event: 'bucket_upsert_failed',
        bucket: {
          event_type: b.event_type, user_id: b.user_id,
          severity: b.severity, hour_bucket: b.hour_bucket,
        },
        error: String(e?.message ?? e),
      })
    }
  }
  report.buckets_upserted = upserts

  // ── Step 6：emit summary event ──────────────────────────
  if (!report.ok) {
    return fail(env, report, 'partial_upsert_failed', {
      buckets_total: buckets.size,
      buckets_upserted: upserts,
    })
  }

  await safeUserAudit(env, {
    event_type: 'audit.aggregate.run_completed',
    severity:   'info',
    data: {
      run_id:           runId,
      env:              envName,
      cold_class:       PR30_SUPPORTED_COLD_CLASS,
      hot_days:               hotDays,
      lead_hours:             leadHours,
      effective_cutoff_hours: effectiveHours,
      cutoff:                 cutoffISO,
      rows_scanned:           candidates.length,
      buckets_upserted:       upserts,
      writer_version:         AGGREGATE_WRITER_VERSION,
    },
  })

  report.finished_at = new Date().toISOString()
  return res(report, 200)
}

async function emitSkipped(env, report, data) {
  await safeUserAudit(env, {
    event_type: 'audit.aggregate.run_skipped',
    severity:   'info',
    data: {
      run_id:                 report.run_id,
      cold_class:             PR30_SUPPORTED_COLD_CLASS,
      hot_days:               report.hot_days,
      lead_hours:             report.lead_hours,
      effective_cutoff_hours: report.effective_cutoff_hours,
      cutoff:                 report.cutoff,
      writer_version:         AGGREGATE_WRITER_VERSION,
      ...data,
    },
  })
}

async function fail(env, report, eventCode, data) {
  report.ok = false
  report.errors.push({ event: eventCode, ...data })
  await safeUserAudit(env, {
    event_type: 'audit.aggregate.run_failed',
    severity:   'critical',
    data: {
      run_id:                 report.run_id,
      cold_class:             PR30_SUPPORTED_COLD_CLASS,
      hot_days:               report.hot_days,
      lead_hours:             report.lead_hours,
      effective_cutoff_hours: report.effective_cutoff_hours,
      cutoff:                 report.cutoff,
      writer_version:         AGGREGATE_WRITER_VERSION,
      reason:                 eventCode,
      ...data,
    },
  })
  report.finished_at = new Date().toISOString()
  return res(report, 500)
}
