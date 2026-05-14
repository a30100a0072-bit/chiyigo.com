/**
 * POST /api/admin/cron/audit-aggregate-archive-debug
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 3.2 — Aggregate cold-archive worker (debug)
 * 把 audit_log_aggregate_debug 月度 cutoff 之前未 archive 的 row 推上 R2
 * （prefix audit-log-aggregate-debug/{env}/...）。
 *
 * Cron：.github/workflows/cron-audit-aggregate-archive-debug.yml
 *      每月 1 號 19:00 UTC（與 telemetry 同檔同分；兩 worker 各寫獨立 R2 prefix
 *      + 獨立 cold_class，互不撞 chunks row PK）。
 *
 * 細節對齊 audit-aggregate-archive-telemetry.js；orchestration 共用
 * functions/utils/audit-aggregate-archive-runner.js `runAggregateArchive`。
 */

import {
  AGGREGATE_TABLES,
  debugRowsToJsonl,
} from '../../../utils/audit-aggregate-archive.js'
import { runAggregateArchive } from '../../../utils/audit-aggregate-archive-runner.js'

const TABLE_NAME   = 'audit_log_aggregate_debug'
const COLD_CLASS   = AGGREGATE_TABLES[TABLE_NAME]    // 'aggregate_debug'
const EVENT_PREFIX = 'audit.aggregate_archive.debug'

const SELECT_COLUMNS =
  'id, event_type, reason_code, hour_bucket, total_count, sample_count, samples_json, sampled, cold_class, created_at'

export async function onRequestPost({ request, env }) {
  return runAggregateArchive({
    request, env,
    tableName:     TABLE_NAME,
    coldClass:     COLD_CLASS,
    rowKind:       COLD_CLASS,
    selectColumns: SELECT_COLUMNS,
    rowsToJsonl:   debugRowsToJsonl,
    eventPrefix:   EVENT_PREFIX,
  })
}
