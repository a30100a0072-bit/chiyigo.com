/**
 * POST /api/admin/cron/audit-aggregate-debug
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 3.1 — Aggregate worker (debug_failure)
 * （design doc：docs/AUDIT_RETENTION_PLAN.md §「Aggregate 規則 v3」+ PR 3）
 *
 * 行為（與 PR 3.0 telemetry 同 shape，差異在 reduce 維度 + samples 採樣）：
 *   1. cutoff = `now - (hotDays - leadHours/24) days`（design doc：hot 過期前 24h）
 *      hotDays = hotRetentionDaysFor(env, 'debug_failure')
 *   2. SELECT audit_log 中 cold_class='debug_failure' / archived_at IS NULL /
 *      created_at < cutoff 的所有 row（含 event_data，供 reason_code 抽取 + samples）
 *   3. policy drift fail-fast：rowIsDebugFailure 不再成立 → emit critical + abort
 *   4. reduce → bucket Map（event_type / reason_code / hour_bucket）
 *      含 deterministic FNV-1a reservoir N=10 採樣（user 拍板：避免 Math.random()
 *      讓 worker 重跑 samples_json 漂移，破壞 UPSERT idempotency）
 *   5. UPSERT 每 bucket 進 audit_log_aggregate_debug（uniq_agg_debug_bucket 索引）
 *   6. emit audit.aggregate.debug.run_completed (info) summary
 *
 * Cron：.github/workflows/cron-audit-aggregate-debug.yml — 每日 17:15 UTC
 *   （= 01:15 隔日 Asia/Taipei；telemetry 17:00、archive 18:00；錯開 D1 contention
 *    + audit event emission race，user 拍板）
 *
 * 與 telemetry aggregate 並存：兩 worker 寫不同表、不同事件名，相互獨立；
 * 共用 audit_log raw row 來源但 cold_class 分群不重疊（drift 各自 fail-fast）。
 */

import { res } from '../../../utils/auth'
import { safeUserAudit } from '../../../utils/user-audit'
import { hotRetentionDaysFor } from '../../../utils/audit-archive'
import {
  AGGREGATE_DEBUG_WRITER_VERSION,
  PR31_SUPPORTED_COLD_CLASS,
  parseMaxRowsPerRun,
  parseLeadHours,
  totalCutoffHours,
  reduceDebugBuckets,
  rowIsDebugFailure,
} from '../../../utils/audit-aggregate-debug'

function archiveEnv(env) {
  return String(env.ARCHIVE_ENV ?? 'prod')
}

function newRunId() {
  return `aggdbg-${crypto.randomUUID()}`
}

export async function onRequestPost({ request, env }) {
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
  const hotDays    = hotRetentionDaysFor(env, PR31_SUPPORTED_COLD_CLASS)

  // 同 PR 3.0 codex r2 L-2：report.cutoff 與 SQL `datetime('now','-N hours')` 必須 same source
  const effectiveHours = totalCutoffHours(hotDays, leadHours)
  const cutoffISO = (hotDays > 0 && effectiveHours > 0)
    ? new Date(Date.now() - effectiveHours * 3600 * 1000).toISOString()
    : null

  const report: {
    ok: boolean
    run_id: string
    started_at: string
    cold_class: string
    writer_version: string
    hot_days: number
    lead_hours: number
    effective_cutoff_hours: number
    cutoff: string | null
    max_rows_per_run: number
    rows_scanned: number
    buckets_upserted: number
    samples_total: number
    skipped_reason: string | null
    errors: unknown[]
    finished_at?: string
  } = {
    ok: true,
    run_id: runId,
    started_at: startedAt,
    cold_class: PR31_SUPPORTED_COLD_CLASS,
    writer_version: AGGREGATE_DEBUG_WRITER_VERSION,
    hot_days: hotDays,
    lead_hours: leadHours,
    effective_cutoff_hours: effectiveHours,
    cutoff: cutoffISO,
    max_rows_per_run: maxRows,
    rows_scanned: 0,
    buckets_upserted: 0,
    samples_total: 0,
    skipped_reason: null,
    errors: [],
  }

  // ── Step 1：cutoff 無效 → skip（同 PR 3.0 codex r3 L 兩 reason 拆分）──
  if (cutoffISO == null) {
    report.skipped_reason = hotDays <= 0 ? 'hot_days_disabled' : 'cutoff_hours_collapsed'
    await emitSkipped(env, report, { reason: report.skipped_reason })
    report.finished_at = new Date().toISOString()
    return res(report, 200)
  }

  // ── Step 2：撈 candidates（cutoff 用 SQLite 原生 datetime modifier，feedback_sqlite_iso_datetime_compare）
  let candidates
  try {
    const rs = await db.prepare(
      `SELECT id, event_type, severity, user_id, ip_hash, event_data, created_at
         FROM audit_log
        WHERE cold_class = ?
          AND archived_at IS NULL
          AND created_at < datetime('now', '-${effectiveHours} hours')
        ORDER BY id ASC
        LIMIT ?`
    ).bind(PR31_SUPPORTED_COLD_CLASS, maxRows + 1).all()
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
    report.skipped_reason = 'rows_exceed_max_per_run'
    return fail(env, report, 'rows_exceed_max_per_run', {
      rows_scanned: candidates.length,
      max_rows_per_run: maxRows,
    })
  }

  // ── Step 3：policy drift fail-fast ──────────────────────
  const drift = candidates.filter(r => !rowIsDebugFailure(r))
  if (drift.length > 0) {
    const sampleIds = drift.slice(0, 20).map(r => r.id)
    report.skipped_reason = 'cold_class_drift_detected'
    return fail(env, report, 'cold_class_drift', {
      drift_count: drift.length,
      sample_ids: sampleIds,
      sample_event_types: [...new Set(drift.slice(0, 20).map(r => r.event_type))],
    })
  }

  // ── Step 4：reduce → buckets（含 deterministic reservoir 採樣）────────
  const buckets = reduceDebugBuckets(candidates)

  // ── Step 5：UPSERT each bucket ──────────────────────────
  let upserts = 0
  let samplesTotal = 0
  for (const b of buckets.values()) {
    try {
      await db.prepare(
        `INSERT OR REPLACE INTO audit_log_aggregate_debug
           (event_type, reason_code, hour_bucket, total_count, sample_count,
            samples_json, sampled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        b.event_type, b.reason_code, b.hour_bucket,
        b.total_count, b.sample_count, b.samples_json, b.sampled,
      ).run()
      upserts++
      samplesTotal += b.sample_count
    } catch (e) {
      report.ok = false
      report.errors.push({
        event: 'bucket_upsert_failed',
        bucket: {
          event_type: b.event_type, reason_code: b.reason_code,
          hour_bucket: b.hour_bucket,
        },
        error: String(e?.message ?? e),
      })
    }
  }
  report.buckets_upserted = upserts
  report.samples_total    = samplesTotal

  if (!report.ok) {
    return fail(env, report, 'partial_upsert_failed', {
      buckets_total: buckets.size,
      buckets_upserted: upserts,
    })
  }

  await safeUserAudit(env, {
    event_type: 'audit.aggregate.debug.run_completed',
    severity:   'info',
    data: {
      run_id:                 runId,
      env:                    envName,
      cold_class:             PR31_SUPPORTED_COLD_CLASS,
      hot_days:               hotDays,
      lead_hours:             leadHours,
      effective_cutoff_hours: effectiveHours,
      cutoff:                 cutoffISO,
      rows_scanned:           candidates.length,
      buckets_upserted:       upserts,
      samples_total:          samplesTotal,
      writer_version:         AGGREGATE_DEBUG_WRITER_VERSION,
    },
  })

  report.finished_at = new Date().toISOString()
  return res(report, 200)
}

async function emitSkipped(env, report, data) {
  await safeUserAudit(env, {
    event_type: 'audit.aggregate.debug.run_skipped',
    severity:   'info',
    data: {
      run_id:                 report.run_id,
      cold_class:             PR31_SUPPORTED_COLD_CLASS,
      hot_days:               report.hot_days,
      lead_hours:             report.lead_hours,
      effective_cutoff_hours: report.effective_cutoff_hours,
      cutoff:                 report.cutoff,
      writer_version:         AGGREGATE_DEBUG_WRITER_VERSION,
      ...data,
    },
  })
}

async function fail(env, report, eventCode, data) {
  report.ok = false
  report.errors.push({ event: eventCode, ...data })
  await safeUserAudit(env, {
    event_type: 'audit.aggregate.debug.run_failed',
    severity:   'critical',
    data: {
      run_id:                 report.run_id,
      cold_class:             PR31_SUPPORTED_COLD_CLASS,
      hot_days:               report.hot_days,
      lead_hours:             report.lead_hours,
      effective_cutoff_hours: report.effective_cutoff_hours,
      cutoff:                 report.cutoff,
      writer_version:         AGGREGATE_DEBUG_WRITER_VERSION,
      reason:                 eventCode,
      ...data,
    },
  })
  report.finished_at = new Date().toISOString()
  return res(report, 500)
}
