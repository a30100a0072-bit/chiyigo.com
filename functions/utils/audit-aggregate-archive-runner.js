/**
 * F-3 Phase 2 PR 3.2 part 2 — Aggregate cold-archive runner
 *
 * 把 aggregate_telemetry / aggregate_debug 兩 worker 共用的 orchestration
 * 抽成單一函式 `runAggregateArchive`。差異只剩 caller 注入的 5 個 axis：
 *   - tableName / coldClass / rowKind
 *   - selectColumns（aggregate 表 schema 不同）
 *   - rowsToJsonl（telemetry vs debug 序列化）
 *   - eventPrefix（'audit.aggregate_archive.telemetry' / '.debug'）
 *
 * 流程（單輪 cron 一氣呵成跑完所有 chunk；月度 cron 不靠 blocker 多輪 recovery）：
 *   1. cutoff = cutoffMonthStartUTC() — 本月 1 號 00:00 UTC
 *   2. SELECT aggregate row WHERE archived_at IS NULL AND created_at < cutoff
 *   3. row 數 0 → run_skipped(no_rows_eligible)；超過 maxRows → run_failed
 *   4. splitIntoChunks（CHUNK_MAX_ROWS / CHUNK_MAX_BYTES，aggregate row 量極小通常 1 chunk）
 *   5. 每 chunk：
 *      a. gzip + sha
 *      b. INSERT OR IGNORE audit_archive_chunks（state='planned', cold_class=aggregate_*）
 *      c. PUT manifest('planned')
 *      d. PUT data（archivePut wrapper：putWithRetry + onAttemptFailed audit）
 *      e. UPDATE chunks state='uploaded' + PUT manifest('uploaded')
 *      f. GET data + decompress + sha+rowCount verify
 *      g. UPDATE chunks state='verified' + PUT manifest('verified')
 *      h. live mode：UPDATE aggregate row archived_at + UPDATE chunks state='marked_archived'
 *                    + PUT manifest('marked_archived')；dry-run 停在 verified
 *   6. emit run_completed (info)
 *
 * 與 PR 2.x audit_log archive 的差異（mirror PR 3.1 簡化版）：
 *   - 無 round-robin（單 cold_class）
 *   - 無 per-class hot retention（月度 cutoff 唯一）
 *   - 無 blocker resumption（chunk INSERT OR IGNORE 保 idempotency；下輪 cron 撈
 *     archived_at IS NULL 重做 verify→mark；若中途 partial 狀態 chunks row 已存在
 *     會 OR IGNORE → 走 deriveAggregateKeysFromChunk 復原 key，但本 PR 3.2 採
 *     「同 run 內推到底」策略，不分輪）
 *   - 無 marked_archived → +7d → purge 雙路徑（PR 4 統一處理 aggregate row 刪除）
 *
 * 🔴 no-delete discipline：本檔禁止 R2 bucket .delete(...) / 任何對 audit_log
 *    或 audit_archive_chunks 的 SQL DELETE。lint-archive-no-delete +
 *    eslint archive-discipline 都會掃此檔（規則見 scripts/_archive-lint-patterns.js）。
 */

import { res } from './auth.js'
import { safeUserAudit } from './user-audit.js'
import {
  ARCHIVE_SCHEMA_VERSION,
  gzipCompress,
  gzipDecompress,
  sha256Hex,
  putWithRetry,
  newRunId,
  utcDate,
  appendStateHistory,
} from './audit-archive.js'
import {
  AGGREGATE_WRITER,
  AGGREGATE_WRITER_VERSION,
  cutoffMonthStartUTC,
  buildAggregateChunkKeys,
  buildAggregateManifest,
  splitIntoChunks,
} from './audit-aggregate-archive.js'

const COLD_CLASS_VERSION = 1

function isDryRun(env) {
  const v = String(env.AUDIT_ARCHIVE_DRY_RUN ?? 'true').toLowerCase()
  return v !== 'false'
}

function archiveEnv(env) {
  return String(env.ARCHIVE_ENV ?? 'prod')
}

// 單輪 cron 最多處理多少 aggregate row（防爆量；aggregate 表月度通常 < 1k row）。
// 預設 50_000；env override 走 AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN。
function parseMaxRowsPerRun(env) {
  const raw = env?.AUDIT_AGGREGATE_ARCHIVE_MAX_ROWS_PER_RUN
  if (raw == null || raw === '') return 50_000
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return 50_000
  return Math.floor(n)
}

// 可選：put retry backoff 注入（integration test 用 [0,0,0] 避真等 21s）
function parseRetryBackoffMs(env) {
  const raw = String(env?.AUDIT_ARCHIVE_PUT_RETRY_BACKOFF_MS ?? '').trim()
  if (!raw) return undefined
  const parts = raw.split(',').map(s => Number(s.trim()))
  if (parts.some(n => !Number.isFinite(n) || n < 0)) return undefined
  return parts
}

function makePutAuditCallback(ctx, role, chunkInfo, maxAttempts) {
  return async ({ attempt, error, willRetry, nextDelayMs, key }) => {
    const sev = willRetry ? 'warn' : 'critical'
    await safeUserAudit(ctx.env, {
      event_type: `${ctx.eventPrefix}.upload_failed`,
      severity:   sev,
      data: {
        run_id:        ctx.runId,
        dry_run:       chunkInfo.dryRun,
        env:           ctx.envName,
        table:         ctx.tableName,
        cold_class:    ctx.coldClass,
        role,
        key,
        attempt,
        max_attempts:  maxAttempts,
        next_delay_ms: nextDelayMs,
        final:         !willRetry,
        error:         String(error?.message ?? error),
        min_id:        chunkInfo.minId,
        max_id:        chunkInfo.maxId,
      },
    })
  }
}

async function archivePut(ctx, role, chunkInfo, key, body, putOpts) {
  const backoffMs = ctx.putRetryBackoffMs
  const sleep     = ctx.putRetrySleep
  const maxAttempts = (backoffMs ?? [1000, 4000, 16000]).length + 1
  return putWithRetry(ctx.bucket, key, body, putOpts, {
    backoffMs,
    sleep,
    onAttemptFailed: makePutAuditCallback(ctx, role, chunkInfo, maxAttempts),
  })
}

/**
 * 主 orchestrator — 兩 handler 共用入口。
 *
 * @param {object} args
 * @param {Request} args.request
 * @param {object}  args.env
 * @param {string}  args.tableName     'audit_log_aggregate_telemetry' | '_debug'
 * @param {string}  args.coldClass     'aggregate_telemetry' | 'aggregate_debug'
 * @param {string}  args.rowKind       同 coldClass（manifest 多帶一份方便 forensic 篩）
 * @param {string}  args.selectColumns 'id, event_type, ...'（aggregate 表 SELECT 用）
 * @param {(rows:any[]) => string} args.rowsToJsonl
 * @param {string}  args.eventPrefix   'audit.aggregate_archive.telemetry' / '.debug'
 * @returns {Promise<Response>}
 */
export async function runAggregateArchive(args) {
  const { request, env, tableName, coldClass, rowKind, selectColumns, rowsToJsonl, eventPrefix } = args

  // ── Auth ─────────────────────────────────────────────────
  const auth = request.headers.get('Authorization') ?? ''
  const expected = env.CRON_SECRET
  if (!expected) return res({ error: 'CRON_SECRET not configured', code: 'CRON_SECRET_NOT_CONFIGURED' }, 500)
  if (auth !== `Bearer ${expected}`) return res({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  // ── Bindings ─────────────────────────────────────────────
  const bucket = env.AUDIT_ARCHIVE_BUCKET
  if (!bucket) return res({ error: 'AUDIT_ARCHIVE_BUCKET binding missing', code: 'INTERNAL_ERROR' }, 500)
  const db = env.chiyigo_db
  if (!db)     return res({ error: 'chiyigo_db binding missing', code: 'INTERNAL_ERROR' }, 500)

  const dryRun            = isDryRun(env)
  const envName           = archiveEnv(env)
  const runId             = newRunId()
  const startedAt         = new Date().toISOString()
  const putRetryBackoffMs = parseRetryBackoffMs(env)
  const maxRows           = parseMaxRowsPerRun(env)
  const cutoff            = cutoffMonthStartUTC()

  const report = {
    ok: true,
    mode: dryRun ? 'dry_run' : 'live',
    run_id: runId,
    started_at: startedAt,
    table: tableName,
    cold_class: coldClass,
    writer_version: AGGREGATE_WRITER_VERSION,
    cutoff,
    max_rows_per_run: maxRows,
    rows_scanned: 0,
    chunks_planned: 0,
    chunks_uploaded: 0,
    chunks_verified: 0,
    chunks_marked_archived: 0,
    rows_marked_archived: 0,
    skipped_reason: null,
    errors: [],
  }

  // ── Step 1：撈 cutoff 之前未 archive 的 aggregate row ─────
  let candidates
  try {
    const rs = await db.prepare(
      `SELECT ${selectColumns}
         FROM ${tableName}
        WHERE archived_at IS NULL
          AND created_at < ?
        ORDER BY id ASC
        LIMIT ?`
    ).bind(cutoff, maxRows + 1).all()
    candidates = rs.results ?? []
  } catch (e) {
    return fail(env, report, eventPrefix, 'd1_select_failed', { error: String(e?.message ?? e) })
  }

  report.rows_scanned = candidates.length

  if (candidates.length === 0) {
    report.skipped_reason = 'no_rows_eligible'
    await emitSkipped(env, report, eventPrefix, { reason: report.skipped_reason })
    report.finished_at = new Date().toISOString()
    return res(report, 200)
  }

  if (candidates.length > maxRows) {
    report.skipped_reason = 'rows_exceed_max_per_run'
    return fail(env, report, eventPrefix, 'rows_exceed_max_per_run', {
      rows_scanned: candidates.length,
      max_rows_per_run: maxRows,
    })
  }

  // ── Step 2：切 chunks ───────────────────────────────────
  const { chunks } = splitIntoChunks(candidates, rowsToJsonl)
  const archiveDate = utcDate()

  // ── Step 3：逐 chunk 推進 ───────────────────────────────
  const ctx = {
    env, envName, tableName, coldClass, runId, db, bucket,
    eventPrefix, putRetryBackoffMs,
  }
  for (const c of chunks) {
    try {
      await processChunk({ ctx, chunk: c, archiveDate, dryRun, rowKind, report })
    } catch (e) {
      console.error(`[aggregate-archive] ${coldClass} chunk crash:`, e)
      report.ok = false
      report.errors.push({
        event: 'chunk_crash',
        min_id: c.minId,
        max_id: c.maxId,
        error: String(e?.message ?? e),
      })
      break  // 同 PR 2.x：一個 chunk 出包就停，避免後面 chunk 連環坑
    }
  }

  if (!report.ok) {
    return fail(env, report, eventPrefix, 'chunk_processing_failed', {
      chunks_planned: report.chunks_planned,
      chunks_uploaded: report.chunks_uploaded,
    })
  }

  // ── Step 4：emit run_completed ──────────────────────────
  await safeUserAudit(env, {
    event_type: `${eventPrefix}.run_completed`,
    severity:   'info',
    data: {
      run_id:                 runId,
      env:                    envName,
      table:                  tableName,
      cold_class:             coldClass,
      cutoff,
      mode:                   report.mode,
      rows_scanned:           report.rows_scanned,
      chunks_planned:         report.chunks_planned,
      chunks_uploaded:        report.chunks_uploaded,
      chunks_verified:        report.chunks_verified,
      chunks_marked_archived: report.chunks_marked_archived,
      rows_marked_archived:   report.rows_marked_archived,
      writer_version:         AGGREGATE_WRITER_VERSION,
    },
  })

  report.finished_at = new Date().toISOString()
  return res(report, 200)
}

async function processChunk({ ctx, chunk, archiveDate, dryRun, rowKind, report }) {
  const { envName, tableName, coldClass, db, bucket, runId } = ctx

  const jsonl   = chunk.jsonl
  const sha     = await sha256Hex(jsonl)
  const minId   = chunk.minId
  const maxId   = chunk.maxId
  const minTs   = chunk.rows[0].created_at
  const maxTs   = chunk.rows[chunk.rows.length - 1].created_at
  const rowCount = chunk.rows.length

  const compression = 'gzip'
  const gzBody      = await gzipCompress(jsonl)
  const sha256Gz    = await sha256Hex(gzBody)

  const { dataKey, manifestKey } = buildAggregateChunkKeys({
    env: envName, tableName, coldClass,
    minId, maxId, sha256: sha, archiveDate, dryRun, compression,
  })

  const plannedAt = new Date().toISOString()
  let manifest = buildAggregateManifest({
    env: envName, tableName, coldClass, runId,
    state: 'planned',
    stateHistory: [{ state: 'planned', at: plannedAt }],
    rowCount, minId, maxId, minTs, maxTs,
    sha256Jsonl: sha, dryRun, dataKey, compression, sha256Gz, rowKind,
  })
  // 確保 schema_version 走 audit-archive 既有版本（buildAggregateManifest 已注入）
  if (!manifest.schema_version) manifest.schema_version = ARCHIVE_SCHEMA_VERSION

  const chunkInfo = { dryRun, minId, maxId }

  // ── a. INSERT OR IGNORE chunks row ────────────────────
  await db.prepare(
    `INSERT OR IGNORE INTO audit_archive_chunks
      (env, table_name, cold_class, cold_class_version, archive_date,
       min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run, compression)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, 0, ?, ?, ?)`
  ).bind(envName, tableName, coldClass, COLD_CLASS_VERSION, archiveDate,
         minId, maxId, sha, rowCount, runId, dryRun ? 1 : 0, compression).run()
  report.chunks_planned++

  // ── b. PUT manifest planned ───────────────────────────
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  // ── c. PUT data (gzip) ────────────────────────────────
  await archivePut(ctx, 'data', chunkInfo, dataKey, gzBody, {
    httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
  })

  // ── d. UPDATE chunks state=uploaded + PUT manifest uploaded ────
  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'uploaded', updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha).run()
  report.chunks_uploaded++

  manifest = appendStateHistory(manifest, 'uploaded', new Date().toISOString())
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  // ── e. GET 回讀 + decompress + sha verify ────────────
  const obj = await bucket.get(dataKey)
  if (!obj) {
    return failChunk(ctx, report, 'verification_failed', {
      reason: 'r2_object_not_found',
      data_key: dataKey, min_id: minId, max_id: maxId, chunk_sha256: sha,
    })
  }
  let text
  try {
    const gzBytes = new Uint8Array(await obj.arrayBuffer())
    const jsonlBytes = await gzipDecompress(gzBytes)
    text = new TextDecoder().decode(jsonlBytes)
  } catch (e) {
    return failChunk(ctx, report, 'verification_failed', {
      reason: 'gzip_decompress_failed',
      data_key: dataKey, min_id: minId, max_id: maxId, chunk_sha256: sha,
      error: String(e?.message ?? e),
    })
  }
  const reSha = await sha256Hex(text)
  const reRowCount = text.length === 0 ? 0 : (text.match(/\n/g) ?? []).length
  if (reSha !== sha || reRowCount !== rowCount) {
    return failChunk(ctx, report, 'verification_failed', {
      expected_sha256: sha, actual_sha256: reSha,
      expected_row_count: rowCount, actual_row_count: reRowCount,
      min_id: minId, max_id: maxId, chunk_sha256: sha,
    })
  }

  // ── f. UPDATE chunks state=verified + PUT manifest verified ────
  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'verified', updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha).run()
  report.chunks_verified++

  manifest = appendStateHistory(manifest, 'verified', new Date().toISOString())
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  await safeUserAudit(ctx.env, {
    event_type: `${ctx.eventPrefix}.chunk_uploaded`,
    severity:   'info',
    data: {
      run_id:       runId,
      dry_run:      dryRun,
      env:          envName,
      table:        tableName,
      cold_class:   coldClass,
      chunk_key:    dataKey,
      manifest_key: manifestKey,
      row_count:    rowCount,
      min_id:       minId,
      max_id:       maxId,
      sha256_jsonl: sha,
      compression,
      verified_at:  new Date().toISOString(),
    },
  })

  // ── g. live mode：UPDATE aggregate row archived_at + mark_archived ────
  if (dryRun) return

  await db.prepare(
    `UPDATE ${tableName}
        SET archived_at = datetime('now')
      WHERE id BETWEEN ? AND ?
        AND archived_at IS NULL`
  ).bind(minId, maxId).run()

  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'marked_archived',
            marked_archived_at = datetime('now'),
            updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha).run()

  report.chunks_marked_archived++
  report.rows_marked_archived += rowCount

  manifest = appendStateHistory(manifest, 'marked_archived', new Date().toISOString())
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })
}

function failChunk(ctx, report, eventCode, data) {
  report.ok = false
  report.errors.push({ event: eventCode, ...data })
  // emit critical 由外層 fail() 統一處理 — 此處只標 report
}

async function emitSkipped(env, report, eventPrefix, data) {
  await safeUserAudit(env, {
    event_type: `${eventPrefix}.run_skipped`,
    severity:   'info',
    data: {
      run_id:          report.run_id,
      table:           report.table,
      cold_class:      report.cold_class,
      cutoff:          report.cutoff,
      writer_version:  AGGREGATE_WRITER_VERSION,
      ...data,
    },
  })
}

async function fail(env, report, eventPrefix, eventCode, data) {
  report.ok = false
  if (!report.errors.some(e => e.event === eventCode)) {
    report.errors.push({ event: eventCode, ...data })
  }
  await safeUserAudit(env, {
    event_type: `${eventPrefix}.run_failed`,
    severity:   'critical',
    data: {
      run_id:          report.run_id,
      table:           report.table,
      cold_class:      report.cold_class,
      cutoff:          report.cutoff,
      writer_version:  AGGREGATE_WRITER_VERSION,
      reason:          eventCode,
      ...data,
      errors:          report.errors,
    },
  })
  report.finished_at = new Date().toISOString()
  return res(report, 500)
}

// AGGREGATE_WRITER 從 audit-aggregate-archive.js 來；export pass-through 方便 caller
export { AGGREGATE_WRITER }
