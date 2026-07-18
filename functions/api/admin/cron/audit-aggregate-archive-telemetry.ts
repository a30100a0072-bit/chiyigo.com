/**
 * POST /api/admin/cron/audit-aggregate-archive-telemetry
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 3.2 — Aggregate cold-archive worker (telemetry)
 * 把 audit_log_aggregate_telemetry 月度 cutoff 之前未 archive 的 row 推上 R2
 * （prefix audit-log-aggregate-telemetry/{env}/...），對齊 design doc
 * §「Aggregate→R2 月度 archive」+ docs/AUDIT_RETENTION_PLAN.md PR 3.2 段。
 *
 * Cron：.github/workflows/cron-audit-aggregate-archive-telemetry.yml
 *      每月 1 號 19:00 UTC（= 03:00 隔日 Asia/Taipei，凌晨低峰）。
 *
 * DRY_RUN：沿用 env.AUDIT_ARCHIVE_DRY_RUN（與 PR 2.x 同 flag）。
 *   - dry-run：寫 R2 dryrun prefix；chunks 升態到 verified 即止，aggregate row
 *     archived_at 不動
 *   - live：    寫正式 prefix + UPDATE aggregate row archived_at + 升 marked_archived
 *
 * Orchestration 走 functions/utils/audit-aggregate-archive-runner.js
 * `runAggregateArchive`（與 debug worker 共用），本檔僅做 axis 注入。
 */

import {
  AGGREGATE_TABLES,
  telemetryRowsToJsonl,
} from '../../../utils/audit-aggregate-archive'
import { runAggregateArchive } from '../../../utils/audit-aggregate-archive-runner'

const TABLE_NAME   = 'audit_log_aggregate_telemetry'
const COLD_CLASS   = AGGREGATE_TABLES[TABLE_NAME]    // 'aggregate_telemetry'
const EVENT_PREFIX = 'audit.aggregate_archive.telemetry'

const SELECT_COLUMNS =
  'id, event_type, user_id, severity, hour_bucket, count, ip_hash_top, cold_class, created_at'

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  return runAggregateArchive({
    request, env,
    tableName:     TABLE_NAME,
    coldClass:     COLD_CLASS,
    rowKind:       COLD_CLASS,
    selectColumns: SELECT_COLUMNS,
    rowsToJsonl:   telemetryRowsToJsonl,
    eventPrefix:   EVENT_PREFIX,
  })
}
