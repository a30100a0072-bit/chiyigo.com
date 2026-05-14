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
  deriveAggregateKeysFromChunk,
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

  const ctx = {
    env, envName, tableName, coldClass, runId, db, bucket,
    eventPrefix, putRetryBackoffMs, cutoff,
  }

  // ── Step 0（codex r1 H-2 修正）：先處理 verified blocker ─────────
  // 場景：上輪 worker UPDATE aggregate row archived_at 完成，但 UPDATE chunks→marked_archived
  // 前 crash → 同 chunk 卡在 state='verified' + rows 已 archived_at NOT NULL。
  // 下一輪 SELECT 因 archived_at IS NULL filter 撈不到 row，會走 no_rows_eligible，
  // chunks 永遠卡 verified → PR 4 purge 也撿不到（只看 marked_archived）。
  //
  // 解法：每輪先掃 audit_archive_chunks 非終態，state='verified' 的 chunk 完成 mark_archived
  // 升態。state IN ('planned','uploaded') 則 fall through 給 Step 1 SELECT 自癒
  // （rows 仍 archived_at IS NULL，INSERT OR IGNORE skip + manifest 覆寫繼續推）。
  // PR 3.3 r3/r4 codex：Step 0 同時掃 'uploaded' / 'verified' / 'failed' / 'blacklisted'。
  //   - 'verified'              → resumeVerifiedBlocker（既有；live 'verified→marked_archived'）
  //   - 'uploaded'              → resumeUploadedBlocker（**re_verify 接續路徑**；跨日 OK）
  //   - 'failed' / 'blacklisted' → r4 codex P1：emit chunk_skipped warn 通報，**不 resume**；
  //                                terminal-blocker 不該被 fresh pipeline 繞過。
  //                                Step 1 SELECT 另用 NOT EXISTS 排除這些 chunk 的 id range，
  //                                保證跨日不會新建覆蓋同 row 範圍的 chunks row。
  // r4 場景：admin 昨天 mark_resolved → blacklisted（等 force_purge），source aggregate row
  // 仍 archived_at NULL。今天 cron Step 0 若不掃 blacklisted、Step 3 用今天 utcDate() 算
  // 新 archive_date PK → INSERT OR IGNORE 反而插新 row 繞過 invariant 把資料 archive 掉。
  try {
    const blockerRows = await db.prepare(
      `SELECT min_id, max_id, chunk_sha256, archive_date, state, row_count, dry_run
         FROM audit_archive_chunks
        WHERE env = ? AND table_name = ? AND cold_class = ?
          AND state IN ('verified', 'uploaded', 'failed', 'blacklisted')
        ORDER BY min_id ASC`
    ).bind(envName, tableName, coldClass).all()
    for (const b of (blockerRows.results ?? [])) {
      try {
        if (b.state === 'uploaded') {
          await resumeUploadedBlocker({ ctx, blocker: b, report })
        } else if (b.state === 'verified') {
          await resumeVerifiedBlocker({ ctx, blocker: b, report })
        } else {
          // 'failed' / 'blacklisted'：emit chunk_skipped warn；不動 state、不動 R2；
          // 計 chunks_blocked_terminal 給 forensic / alerting。Step 1 SELECT NOT EXISTS
          // 會自然排除此 chunk 的 id range，aggregate row 不會進 Step 3 fresh pipeline。
          await safeUserAudit(ctx.env, {
            event_type: `${ctx.eventPrefix}.chunk_skipped`,
            severity:   'warn',
            data: {
              run_id:           runId,
              env:              envName,
              table:            tableName,
              cold_class:       coldClass,
              min_id:           b.min_id,
              max_id:           b.max_id,
              chunk_sha256:     b.chunk_sha256,
              dry_run:          b.dry_run === 1 || b.dry_run === true,
              existing_state:   b.state,
              archive_date:     b.archive_date,
              reason: b.state === 'blacklisted'
                ? 'cross_day_blacklisted_blocker (force_purge required; fresh pipeline blocked for this id range)'
                : 'cross_day_failed_blocker (admin re_verify or mark_resolved required; fresh pipeline blocked for this id range)',
            },
          })
          report.chunks_blocked_terminal = (report.chunks_blocked_terminal ?? 0) + 1
        }
      } catch (e) {
        console.error(`[aggregate-archive] ${coldClass} blocker crash:`, e)
        report.ok = false
        report.errors.push({ event: 'blocker_resume_failed',
          min_id: b.min_id, max_id: b.max_id, error: String(e?.message ?? e) })
        break
      }
    }
  } catch (e) {
    return fail(env, report, eventPrefix, 'd1_select_failed', { error: String(e?.message ?? e) })
  }

  if (!report.ok) {
    // codex r3：把 chunk-level 第一個失敗事件碼當成 run_failed 的 reason
    // （'dry_run_collision' / 'verification_failed' / 'chunk_crash' / 'blocker_resume_failed'），
    // alerting / forensic 可直接從 audit_log.event_data.reason grep 取主因，
    // 不必再爬 errors[] 陣列。原 'chunk_processing_failed' 字串保留作 fallback。
    const primary = report.errors[0]?.event ?? 'chunk_processing_failed'
    return fail(env, report, eventPrefix, primary, {
      chunks_planned: report.chunks_planned,
      chunks_uploaded: report.chunks_uploaded,
    })
  }

  // ── Step 1：撈 cutoff 之前未 archive 的 aggregate row ─────
  // PR 3.3 r4 codex P1：NOT EXISTS subquery 排除被 terminal-blocker chunk
  // ('failed' / 'blacklisted') 覆蓋的 id range — 防 fresh pipeline 跨日繞過 invariant。
  // Step 0 已對 blocker chunk emit chunk_skipped warn；此處 SELECT 直接過濾不再處理。
  let candidates
  try {
    const rs = await db.prepare(
      `SELECT ${selectColumns}
         FROM ${tableName} t
        WHERE t.archived_at IS NULL
          AND t.created_at < ?
          AND NOT EXISTS (
            SELECT 1 FROM audit_archive_chunks c
             WHERE c.env = ? AND c.table_name = ? AND c.cold_class = ?
               AND c.state IN ('failed', 'blacklisted')
               AND t.id BETWEEN c.min_id AND c.max_id
          )
        ORDER BY t.id ASC
        LIMIT ?`
    ).bind(cutoff, envName, tableName, coldClass, maxRows + 1).all()
    candidates = rs.results ?? []
  } catch (e) {
    return fail(env, report, eventPrefix, 'd1_select_failed', { error: String(e?.message ?? e) })
  }

  report.rows_scanned = candidates.length

  if (candidates.length === 0) {
    if (report.chunks_marked_archived > 0) {
      // Step 0 resume 已做事，視為一輪成功 — fall through 到 run_completed
    } else {
      // PR 3.3 r5 codex P2：candidates=0 不一定是 no_rows_eligible — 也可能是 r4
      // Step 1 NOT EXISTS 把所有 row 都因 failed/blacklisted blocker 擋掉。誤報
      // 'no_rows_eligible' 會讓監控以為「沒事」，實際是「有東西卡住等 admin 處理」。
      const blockedCount = report.chunks_blocked_terminal ?? 0
      report.skipped_reason = blockedCount > 0
        ? 'blocked_by_terminal_chunk'
        : 'no_rows_eligible'
      await emitSkipped(env, report, eventPrefix, {
        reason: report.skipped_reason,
        chunks_blocked_terminal: blockedCount,
      })
      report.finished_at = new Date().toISOString()
      return res(report, 200)
    }
  }

  if (candidates.length > maxRows) {
    report.skipped_reason = 'rows_exceed_max_per_run'
    return fail(env, report, eventPrefix, 'rows_exceed_max_per_run', {
      rows_scanned: candidates.length,
      max_rows_per_run: maxRows,
    })
  }

  // ── Step 2：切 chunks ───────────────────────────────────
  const { chunks } = candidates.length > 0
    ? splitIntoChunks(candidates, rowsToJsonl)
    : { chunks: [] }
  const archiveDate = utcDate()

  // ── Step 3：逐 chunk 推進 ───────────────────────────────
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
    // codex r1 M-1：failChunk 只標 report.ok=false 不 throw；外圈靠這條 break 收尾
    if (!report.ok) break
  }

  if (!report.ok) {
    // codex r3：把 chunk-level 第一個失敗事件碼當成 run_failed 的 reason
    // （'dry_run_collision' / 'verification_failed' / 'chunk_crash' / 'blocker_resume_failed'），
    // alerting / forensic 可直接從 audit_log.event_data.reason grep 取主因，
    // 不必再爬 errors[] 陣列。原 'chunk_processing_failed' 字串保留作 fallback。
    const primary = report.errors[0]?.event ?? 'chunk_processing_failed'
    return fail(env, report, eventPrefix, primary, {
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
      // PR 3.3 r6 codex P3：mixed scenario（有 resume 成功 + 有 terminal blocker）
      // 仍走 run_completed；把 chunks_blocked_terminal 與 resume 計數帶出來，
      // monitoring 才能在 completed 訊號裡看到「還有 chunk 等 admin 處理」。
      chunks_blocked_terminal:  report.chunks_blocked_terminal ?? 0,
      chunks_resumed_uploaded:  report.chunks_resumed_uploaded ?? 0,
      chunks_skipped:           report.chunks_skipped ?? 0,
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
  const dryRunInt = dryRun ? 1 : 0

  // ── a. INSERT OR IGNORE chunks row ────────────────────
  await db.prepare(
    `INSERT OR IGNORE INTO audit_archive_chunks
      (env, table_name, cold_class, cold_class_version, archive_date,
       min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run, compression)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, 0, ?, ?, ?)`
  ).bind(envName, tableName, coldClass, COLD_CLASS_VERSION, archiveDate,
         minId, maxId, sha, rowCount, runId, dryRunInt, compression).run()

  // codex r2 H-1：dry_run 不在 PK 內。若同 (env, table, cold_class, date, min, max, sha)
  // 已存在 dry_run mismatch row（典型情境：dry-run 跑完後同日換 live rerun），INSERT OR
  // IGNORE 會 silently skip，後續 UPDATE 沒 dry_run guard 會「借殼」改該 row，最後
  // chunks.dry_run=1 但 aggregate row 已 archived → PR 4 derive key 跑回 dryrun prefix，
  // provenance 全錯。Fail-fast 防止：fetch back，驗 dry_run 對齊，否則 emit critical 中止。
  const existing = await db.prepare(
    `SELECT dry_run, state, run_id FROM audit_archive_chunks
       WHERE env = ? AND table_name = ? AND cold_class = ?
         AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha).first()
  if (existing && existing.dry_run !== dryRunInt) {
    return failChunk(ctx, report, 'dry_run_collision', {
      expected_dry_run: dryRunInt,
      actual_dry_run:   existing.dry_run,
      chunks_state:     existing.state,
      previous_run_id:  existing.run_id,
      min_id: minId, max_id: maxId, chunk_sha256: sha,
      remediation: 'manual_cleanup_required (force_purge dry-run chunk before live rerun)',
    })
  }
  // PR 3.3 r3 codex P1：existing state dispatch（r2 inline resume 移到 Step 0；
  // 此處 processChunk 只看 'planned'（fresh pipeline）或 skip 狀態）。
  //   - 'planned'              → fresh pipeline（b/c/d/e/f/g）
  //   - 'uploaded'             → Step 0 應已處理；到這裡代表 race（極罕見）→ skip warn
  //   - 'verified' && dryRun    → idempotent skip info（dry-run 終態）
  //   - 'verified' && !dryRun   → Step 0 已 marked_archived；不該在 Step 1 SELECT 出現
  //                              （archived_at NOT NULL filter）→ defensive skip warn
  //   - 'marked_archived'      → idempotent skip info（live 終態防禦）
  //   - 'failed'/'blacklisted' → admin-terminal skip warn；走 retry/force_purge endpoint
  const existingState = existing?.state ?? 'planned'
  if (existingState !== 'planned') {
    const isTerminalForMode =
      (dryRun && existingState === 'verified') ||
      (!dryRun && existingState === 'marked_archived')
    await safeUserAudit(ctx.env, {
      event_type: `${ctx.eventPrefix}.chunk_skipped`,
      severity:   isTerminalForMode ? 'info' : 'warn',
      data: {
        run_id:           runId,
        env:              envName,
        table:            tableName,
        cold_class:       coldClass,
        min_id:           minId,
        max_id:           maxId,
        chunk_sha256:     sha,
        dry_run:          dryRun,
        existing_state:   existingState,
        existing_run_id:  existing?.run_id ?? null,
        reason: isTerminalForMode
          ? 'terminal_state_for_mode_already_present (idempotent rerun)'
          : existingState === 'failed' || existingState === 'blacklisted'
            ? 'admin_terminal_state (operator should inspect via admin retry/force_purge endpoint)'
            : 'unexpected_state_step_0_should_handle (defensive)',
      },
    })
    report.chunks_skipped = (report.chunks_skipped ?? 0) + 1
    return
  }
  report.chunks_planned++

  // ── b. PUT manifest planned ───────────────────────────
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  // ── c. PUT data (gzip) ────────────────────────────────
  await archivePut(ctx, 'data', chunkInfo, dataKey, gzBody, {
    httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
  })

  // ── d. PUT manifest uploaded → UPDATE chunks state=uploaded ────
  // codex r2 M-1：先 R2 後 D1。若 manifest PUT fail，chunks 留前態，下輪重跑可接續。
  manifest = appendStateHistory(manifest, 'uploaded', new Date().toISOString())
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  // PR 3.3：state='planned' guard + changes()===1。admin retry / force_purge
  // 可在 cron 跑同時改 chunk state（mark_resolved→blacklisted 等）；無 guard
  // 會把 admin 升態後的 row 又拉回 'uploaded'，破壞 state machine。
  const updPlannedToUploaded = await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'uploaded', updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND dry_run = ?
        AND state = 'planned'`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt).run()
  if ((updPlannedToUploaded?.meta?.changes ?? 0) !== 1) {
    return failChunk(ctx, report, 'race_with_admin', {
      expected_state: 'planned', transition: 'planned_to_uploaded',
      min_id: minId, max_id: maxId, chunk_sha256: sha,
      remediation: 'admin retry/force_purge altered chunk state mid-run; next cron will re-evaluate from current state',
    })
  }
  report.chunks_uploaded++

  // ── e. GET 回讀 + decompress + sha verify ────────────
  // PR 3.3 r3 codex P2：verification 任一步失敗 → atomic UPDATE state='uploaded'→'failed'
  // + retry_count++ + last_failure，**讓 admin 後續可走 re_verify**（admin retry endpoint
  // 只接受 state='failed'；不轉回 failed 會卡 'uploaded' 任何 admin 路徑都拒）。
  const obj = await bucket.get(dataKey)
  if (!obj) {
    await transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, 'r2_object_not_found')
    return failChunk(ctx, report, 'verification_failed', {
      reason: 'r2_object_not_found',
      data_key: dataKey, min_id: minId, max_id: maxId, chunk_sha256: sha,
      state_transitioned: 'uploaded_to_failed',
    })
  }
  let text
  try {
    const gzBytes = new Uint8Array(await obj.arrayBuffer())
    const jsonlBytes = await gzipDecompress(gzBytes)
    text = new TextDecoder().decode(jsonlBytes)
  } catch (e) {
    await transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, 'gzip_decompress_failed')
    return failChunk(ctx, report, 'verification_failed', {
      reason: 'gzip_decompress_failed',
      data_key: dataKey, min_id: minId, max_id: maxId, chunk_sha256: sha,
      error: String(e?.message ?? e),
      state_transitioned: 'uploaded_to_failed',
    })
  }
  const reSha = await sha256Hex(text)
  const reRowCount = text.length === 0 ? 0 : (text.match(/\n/g) ?? []).length
  if (reSha !== sha || reRowCount !== rowCount) {
    await transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, 'sha_or_row_count_mismatch')
    return failChunk(ctx, report, 'verification_failed', {
      expected_sha256: sha, actual_sha256: reSha,
      expected_row_count: rowCount, actual_row_count: reRowCount,
      min_id: minId, max_id: maxId, chunk_sha256: sha,
      state_transitioned: 'uploaded_to_failed',
    })
  }

  // ── f. PUT manifest verified → UPDATE chunks state=verified ────
  // codex r2 M-1：先 R2 後 D1。
  manifest = appendStateHistory(manifest, 'verified', new Date().toISOString())
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  // PR 3.3：state='uploaded' guard + changes()===1（同 planned→uploaded 段註解）
  const updUploadedToVerified = await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'verified', updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND dry_run = ?
        AND state = 'uploaded'`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt).run()
  if ((updUploadedToVerified?.meta?.changes ?? 0) !== 1) {
    return failChunk(ctx, report, 'race_with_admin', {
      expected_state: 'uploaded', transition: 'uploaded_to_verified',
      min_id: minId, max_id: maxId, chunk_sha256: sha,
      remediation: 'admin retry/force_purge altered chunk state mid-run; next cron will re-evaluate from current state',
    })
  }
  report.chunks_verified++

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

  // codex r1 H-1：BETWEEN min..max 範圍內可能夾雜「HOT row（created_at >= cutoff）」
  // SELECT 已用 cutoff 過濾它、未進 JSONL/R2；UPDATE 不加 cutoff guard → 那些 HOT
  // row 會被誤標 archived_at，PR 4 purge 刪到從未備份的資料。
  await db.prepare(
    `UPDATE ${tableName}
        SET archived_at = datetime('now')
      WHERE id BETWEEN ? AND ?
        AND archived_at IS NULL
        AND created_at < ?`
  ).bind(minId, maxId, ctx.cutoff).run()

  // codex r2 M-1：先 R2 manifest 後 D1 chunks UPDATE。
  manifest = appendStateHistory(manifest, 'marked_archived', new Date().toISOString())
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  // PR 3.3：state='verified' guard + changes()===1（同 planned→uploaded 段註解）
  const updVerifiedToMarked = await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'marked_archived',
            marked_archived_at = datetime('now'),
            purge_after = datetime('now', '+7 days'),
            updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND dry_run = ?
        AND state = 'verified'`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt).run()
  if ((updVerifiedToMarked?.meta?.changes ?? 0) !== 1) {
    return failChunk(ctx, report, 'race_with_admin', {
      expected_state: 'verified', transition: 'verified_to_marked_archived',
      min_id: minId, max_id: maxId, chunk_sha256: sha,
      remediation: 'admin retry/force_purge altered chunk state mid-run; next cron will re-evaluate from current state',
    })
  }

  report.chunks_marked_archived++
  report.rows_marked_archived += rowCount
}

function failChunk(ctx, report, eventCode, data) {
  report.ok = false
  report.errors.push({ event: eventCode, ...data })
  // emit critical 由外層 fail() 統一處理 — 此處只標 report
  // codex r1 M-1：外圈 for-loop 在 processChunk 之後檢 `if (!report.ok) break`，
  // 一個 chunk fail 即中止後續（與 PR 2.x 慣例對齊）。
}

/**
 * PR 3.3 r3 codex P2 — atomic state='uploaded' → 'failed' 轉換。
 *
 * verification 任一步失敗（R2 missing / decompress fail / sha mismatch）必呼叫此函式
 * 把 chunk row 轉到 'failed' 狀態 + retry_count++ + last_failure 記錄。
 * 不轉的話 chunk 永遠卡在 'uploaded'，admin retry endpoint 任何 action 都拒
 * （re_verify 要 'failed'、mark_resolved 要 'failed' 或 dry-run verified、force_purge
 *  要 'blacklisted'）→ 操作面沒乾淨出口。
 *
 * Guard: AND state='uploaded'；race（admin 同時動作）changes=0 silently skip
 * （此函式只負責清狀態，不再 fail一次；real failure 由 caller 的 failChunk 處理）。
 */
/**
 * 從 chunk JSONL（newline-delimited JSON）拉出所有 row id。
 *
 * Resume 路徑用 — 取代 BETWEEN min..max + cutoff 範圍 UPDATE（跨月時 ctx.cutoff
 * 已不是 chunk 原始 cutoff，會誤把當初被 cutoff 排除的 HOT row 標 archived_at）。
 * 用 chunk 內 exact ids 做 IN(...) UPDATE → 跨月也對、不需 schema migration。
 *
 * Codex r? M-1：parse error / non-integer id 必 throw（不再 silently swallow）。
 * 舊版 swallow 在 verified resume path（沒重驗 sha/row_count）下可能把 R2 壞 chunk
 * 升 marked_archived 但 source row 沒全標。caller 需用 try/catch 走 fail 路徑。
 */
function extractIdsFromJsonl(text) {
  const ids = []
  let lineNo = 0
  for (const line of text.split('\n')) {
    lineNo++
    if (!line) continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch (err) {
      const e = new Error(`extractIdsFromJsonl: malformed json at line ${lineNo}: ${err?.message ?? err}`)
      e.code = 'JSONL_MALFORMED'
      throw e
    }
    if (typeof obj?.id !== 'number' || !Number.isInteger(obj.id)) {
      const e = new Error(`extractIdsFromJsonl: non-integer id at line ${lineNo}`)
      e.code = 'JSONL_BAD_ID'
      throw e
    }
    ids.push(obj.id)
  }
  return ids
}

/**
 * 用 SQLite json_each(?) 一次 UPDATE 全部 ids — 單一 query、單一 bound param。
 *
 * 為何不用 IN(?, ?, ...) 分批：
 *   - Cloudflare D1 bound parameters per query 上限 100、queries per Worker
 *     invocation 上限 50 (Free) / 1000 (Paid)。CHUNK_MAX_ROWS=10_000 → 分批 100
 *     需 100 queries，Free posture（repo 目前狀態）一輪就會撞牆，partial-mark
 *     livelock（下輪又從第一批 ids 重跑、已 archived 的 batch 仍消耗 query 次數）。
 *   - json_each 是 SQLite core table-valued function、D1 啟用；bind 一個 JSON
 *     array TEXT，整段 UPDATE 算單個 query，徹底擺脫所有 D1 query budget。
 *
 * idempotent：AND archived_at IS NULL guard 跳過已標的 row。
 */
async function updateArchivedAtByIds(db, tableName, ids) {
  if (ids.length === 0) return
  await db.prepare(
    `UPDATE ${tableName}
        SET archived_at = datetime('now')
      WHERE id IN (SELECT value FROM json_each(?))
        AND archived_at IS NULL`
  ).bind(JSON.stringify(ids)).run()
}

async function transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, lastFailure) {
  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'failed',
            retry_count = retry_count + 1,
            last_failure = ?,
            last_failure_at = datetime('now'),
            updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND dry_run = ? AND state = 'uploaded'`
  ).bind(
    lastFailure,
    envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt,
  ).run()
}

/**
 * PR 3.3 r3 codex P1 — uploaded blocker resume（**re_verify endpoint 的接續路徑**）。
 *
 * 場景：
 *   - admin 對 state='failed' chunk 呼叫 re_verify → chunk 推到 state='uploaded'
 *   - 下一輪 cron Step 0 必須掃到並接續 GET+verify。**跨日場景**（admin 隔天才動，
 *     chunk archive_date != utcDate()）也必須能接 — 這是 r2 inline 版漏掉的點。
 *   - 前次 partial crash 留下 'uploaded' 也走這條（idempotent recovery）。
 *
 * 流程（mirror processChunk 後半 e/f/g 段）：
 *   1. deriveAggregateKeysFromChunk(blocker) 算 R2 key（用 row 自帶 archive_date /
 *      dry_run / compression，**不**吃當前 utcDate()）
 *   2. R2 GET → decompress → sha+rowCount verify
 *      失敗 → transitionUploadedToFailed（atomic state→'failed'）+ throw to outer catch
 *   3. PUT manifest 'verified'（fetch 既有 manifest 接續 state_history；失敗 fallback）
 *   4. atomic UPDATE state='uploaded'→'verified'（race guard：changes()===1）
 *   5. emit chunk_uploaded info
 *   6. 若 !dry_run，繼續走 live 'verified'→'marked_archived' 路徑（chain 到
 *      resumeVerifiedBlocker 的邏輯：UPDATE aggregate archived_at + PUT manifest
 *      marked_archived + UPDATE chunks→marked_archived）
 */
async function resumeUploadedBlocker({ ctx, blocker, report }) {
  const { envName, tableName, coldClass, db, bucket, runId } = ctx
  const chunkDryRun = blocker.dry_run === 1 || blocker.dry_run === true
  const dryRunInt = chunkDryRun ? 1 : 0
  const minId = blocker.min_id
  const maxId = blocker.max_id
  const sha   = blocker.chunk_sha256
  const archiveDate = blocker.archive_date  // 用 row 自帶值（**跨日 key**），不用 utcDate()
  const rowCount = blocker.row_count

  // 1) 算 R2 key
  const { dataKey, manifestKey } = deriveAggregateKeysFromChunk({
    env: envName, table_name: tableName, cold_class: coldClass,
    min_id: minId, max_id: maxId,
    chunk_sha256: sha,
    archive_date: archiveDate,
    dry_run: blocker.dry_run, compression: 'gzip',
  })

  // 2) GET + verify
  const obj = await bucket.get(dataKey)
  if (!obj) {
    await transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, 'r2_object_not_found')
    const e = new Error('uploaded_blocker_verify_failed: r2_object_not_found')
    e.code = 'VERIFY_FAILED_R2_MISSING'
    e.data_key = dataKey
    throw e
  }
  let text
  try {
    const gzBytes = new Uint8Array(await obj.arrayBuffer())
    const jsonlBytes = await gzipDecompress(gzBytes)
    text = new TextDecoder().decode(jsonlBytes)
  } catch (err) {
    await transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, 'gzip_decompress_failed')
    const e = new Error(`uploaded_blocker_verify_failed: gzip_decompress_failed (${err?.message ?? err})`)
    e.code = 'VERIFY_FAILED_DECOMPRESS'
    throw e
  }
  const reSha = await sha256Hex(text)
  const reRowCount = text.length === 0 ? 0 : (text.match(/\n/g) ?? []).length
  if (reSha !== sha || reRowCount !== rowCount) {
    await transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, 'sha_or_row_count_mismatch')
    const e = new Error(`uploaded_blocker_verify_failed: sha_or_row_count_mismatch (sha ${reSha}/${sha}; rows ${reRowCount}/${rowCount})`)
    e.code = 'VERIFY_FAILED_SHA_MISMATCH'
    throw e
  }

  // Codex H-1 cross-month fix：parse exact row ids 給 chain 到 resumeVerifiedBlocker
  // 用 IN(...) 做 archived_at UPDATE，避開 BETWEEN + ctx.cutoff 跨月誤標 HOT row。
  // Codex r? M-1：parse error / row_count mismatch 都當 verify 失敗 → atomic 轉回 failed。
  let chunkIds
  try {
    chunkIds = extractIdsFromJsonl(text)
  } catch (err) {
    await transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, 'jsonl_parse_failed')
    const e = new Error(`uploaded_blocker_verify_failed: jsonl_parse_failed (${err?.message ?? err})`)
    e.code = 'VERIFY_FAILED_JSONL_PARSE'
    throw e
  }
  if (chunkIds.length !== rowCount) {
    await transitionUploadedToFailed(db, envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt, 'jsonl_id_count_mismatch')
    const e = new Error(`uploaded_blocker_verify_failed: jsonl_id_count_mismatch (ids ${chunkIds.length} vs row_count ${rowCount})`)
    e.code = 'VERIFY_FAILED_JSONL_ID_COUNT'
    throw e
  }

  // 3) PUT manifest 'verified'
  const mObj = await bucket.get(manifestKey)
  let manifest
  if (mObj) {
    try { manifest = JSON.parse(await mObj.text()) }
    catch { manifest = { state: 'uploaded', state_history: [{ state: 'uploaded', at: new Date().toISOString() }] } }
  } else {
    manifest = { state: 'uploaded', state_history: [{ state: 'uploaded', at: new Date().toISOString() }] }
  }
  manifest = appendStateHistory(manifest, 'verified', new Date().toISOString())
  await archivePut(ctx, 'manifest', { dryRun: chunkDryRun, minId, maxId }, manifestKey,
    JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  // 4) atomic UPDATE state='uploaded'→'verified'
  const updUploadedToVerified = await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'verified', updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND dry_run = ? AND state = 'uploaded'`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha, dryRunInt).run()
  if ((updUploadedToVerified?.meta?.changes ?? 0) !== 1) {
    // race（極罕見；admin 在 Step 0 內動作）→ throw 給 outer catch
    const e = new Error('uploaded_blocker_race_with_admin: state changed during resume')
    e.code = 'RACE_WITH_ADMIN'
    throw e
  }
  report.chunks_resumed_uploaded = (report.chunks_resumed_uploaded ?? 0) + 1
  report.chunks_verified = (report.chunks_verified ?? 0) + 1

  await safeUserAudit(ctx.env, {
    event_type: `${ctx.eventPrefix}.chunk_uploaded`,
    severity:   'info',
    data: {
      run_id:       runId,
      dry_run:      chunkDryRun,
      env:          envName,
      table:        tableName,
      cold_class:   coldClass,
      chunk_key:    dataKey,
      manifest_key: manifestKey,
      row_count:    rowCount,
      min_id:       minId,
      max_id:       maxId,
      sha256_jsonl: sha,
      verified_at:  new Date().toISOString(),
      resumed:      'uploaded_to_verified',
    },
  })

  // 5) dry-run 終態，停；live 繼續走 marked_archived
  if (chunkDryRun) return
  // chain：把目前 'verified' 的 blocker + exact ids 餵給 resumeVerifiedBlocker
  // 跑 live mark 路徑（用 IN(ids) 而非 BETWEEN + ctx.cutoff）
  await resumeVerifiedBlocker({ ctx, blocker: { ...blocker, state: 'verified' }, report, ids: chunkIds })
}

/**
 * codex r1 H-2 — verified blocker 升 marked_archived 復原路徑。
 *
 * 場景：上輪 worker UPDATE aggregate row archived_at 完成、UPDATE chunks→marked_archived
 * 前 crash → 同 chunk 卡 state='verified'。下輪 SELECT archived_at IS NULL 撈不到
 * 已標的 row → 沒這層 resume 就永遠卡住、PR 4 purge 也撿不到。
 *
 * dry-run 寫的 chunk 在 PR 3.2 part 2 設計裡 verified 即終態（part 1 文件對齊）；
 * 這裡只動 live chunk。dry-run verified 留給 PR 4 翻 flag 前的人工清理 / PR 0.2c
 * lock 上線後的 lifecycle 流轉。
 *
 * UPDATE 對 aggregate row 用 IN(chunkIds)（codex H-1 跨月修正）— 不再用 BETWEEN +
 * ctx.cutoff，避開跨月 ctx.cutoff 已不是 chunk 原始 cutoff、把當初被排除的 HOT row
 * 誤標 archived_at 的問題；ids 由 chain caller 傳，或本函式自行 GET R2 data parse。
 * archived_at NOT NULL 預期已有，UPDATE changes=0 也視為正常（已標完）。
 */
async function resumeVerifiedBlocker({ ctx, blocker, report, ids }) {
  const chunkDryRun = blocker.dry_run === 1 || blocker.dry_run === true
  if (chunkDryRun) {
    // dry-run verified 是 PR 3.2 part 2 終態，跳過。
    return
  }
  const { envName, tableName, coldClass, db, bucket, runId } = ctx

  // Codex H-1 cross-month fix：用 chunk JSONL 內 exact row ids 做 UPDATE，
  // 避開 BETWEEN(min,max) + ctx.cutoff 跨月把當初被 cutoff 排除的 HOT row 也標掉。
  //
  // ids 由 caller 傳入（resumeUploadedBlocker chain 已 parse 過 JSONL + sha 驗過）；
  // 若 caller 沒給（直接從 Step 0 抓到 state='verified' 的 chunk，未先 GET data），
  // 此處 GET R2 data + decompress + **重驗 sha + row_count** + parse ids。
  //
  // Codex r? H-1：原版「verified 已是 sha 驗過狀態、resume 只升 mark」不夠 — R2
  // object 可能被替換成「gzip 可解、JSONL 合法、id 都 integer、行數相同」但
  // sha256 不同的內容，strict parser 過了會把 archived_at 標到錯 row。
  // 必須 mirror uploaded path：sha256Hex(text) === blocker.chunk_sha256
  // && row_count 一致；不符就 throw 留 chunk 在 'verified'、不污染狀態機。
  let chunkIds = Array.isArray(ids) ? ids : null
  if (!chunkIds) {
    const { dataKey: verifiedDataKey } = deriveAggregateKeysFromChunk({
      env: envName, table_name: tableName, cold_class: coldClass,
      min_id: blocker.min_id, max_id: blocker.max_id,
      chunk_sha256: blocker.chunk_sha256,
      archive_date: blocker.archive_date,
      dry_run: blocker.dry_run, compression: 'gzip',
    })
    const dataObj = await bucket.get(verifiedDataKey)
    if (!dataObj) {
      const e = new Error('verified_blocker_resume_failed: r2_data_missing')
      e.code = 'VERIFY_RESUME_R2_MISSING'
      e.data_key = verifiedDataKey
      throw e
    }
    let text
    try {
      const gzBytes = new Uint8Array(await dataObj.arrayBuffer())
      const jsonlBytes = await gzipDecompress(gzBytes)
      text = new TextDecoder().decode(jsonlBytes)
    } catch (err) {
      const e = new Error(`verified_blocker_resume_failed: gzip_decompress_failed (${err?.message ?? err})`)
      e.code = 'VERIFY_RESUME_DECOMPRESS'
      throw e
    }
    // Codex r? H-1：重驗 sha + row_count（R2 可能被替換成「valid-but-wrong」）
    const reSha = await sha256Hex(text)
    const reRowCount = text.length === 0 ? 0 : (text.match(/\n/g) ?? []).length
    if (reSha !== blocker.chunk_sha256) {
      const e = new Error(`verified_blocker_resume_failed: sha_mismatch (expected ${blocker.chunk_sha256}, got ${reSha})`)
      e.code = 'VERIFY_RESUME_SHA_MISMATCH'
      throw e
    }
    if (reRowCount !== blocker.row_count) {
      const e = new Error(`verified_blocker_resume_failed: row_count_mismatch (expected ${blocker.row_count}, got ${reRowCount})`)
      e.code = 'VERIFY_RESUME_ROW_COUNT_MISMATCH'
      throw e
    }
    // Codex r? M-1：parse 失敗或 id 缺失要 throw 讓 outer catch fail run，
    // 不可 silently 升 marked_archived 卻沒標完 source rows。
    try {
      chunkIds = extractIdsFromJsonl(text)
    } catch (err) {
      const e = new Error(`verified_blocker_resume_failed: jsonl_parse_failed (${err?.message ?? err})`)
      e.code = 'VERIFY_RESUME_JSONL_PARSE'
      throw e
    }
    if (chunkIds.length !== blocker.row_count) {
      const e = new Error(`verified_blocker_resume_failed: jsonl_id_count_mismatch (ids ${chunkIds.length} vs row_count ${blocker.row_count})`)
      e.code = 'VERIFY_RESUME_JSONL_ID_COUNT'
      throw e
    }
  }

  // 1) UPDATE aggregate row archived_at（idempotent；crashed-after 場景 changes=0）
  // Codex r? M-1：json_each(?) 單 query 單 bound param，跳過 D1 query budget。
  await updateArchivedAtByIds(db, tableName, chunkIds)

  // 2) PUT manifest marked_archived（codex r2 M-1：先 R2 後 D1。
  //    manifest PUT 失敗 → chunks state 仍 verified，下輪 Step 0 重跑接續；
  //    aggregate row archived_at 已標但這是 idempotent；不會雙寫）
  const { manifestKey } = deriveAggregateKeysFromChunk({
    env: envName, table_name: tableName, cold_class: coldClass,
    min_id: blocker.min_id, max_id: blocker.max_id,
    chunk_sha256: blocker.chunk_sha256,
    archive_date: blocker.archive_date,
    dry_run: blocker.dry_run, compression: 'gzip',
  })
  const obj = await bucket.get(manifestKey)
  let manifest
  if (obj) {
    try { manifest = JSON.parse(await obj.text()) }
    catch { manifest = { state_history: [] } }
  } else {
    manifest = { state: 'verified', state_history: [{ state: 'verified', at: new Date().toISOString() }] }
  }
  manifest = appendStateHistory(manifest, 'marked_archived', new Date().toISOString())
  await archivePut(ctx, 'manifest', { dryRun: false, minId: blocker.min_id, maxId: blocker.max_id },
    manifestKey, JSON.stringify(manifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } })

  // 3) UPDATE chunks → marked_archived + purge_after = +7d（R2 manifest 成功後才升 D1）
  // PR 3.3：state='verified' guard 已存在（atomic）+ changes()===1 check。
  // changes=0 = admin retry/force_purge 已在 resume 跑前升態（典型：mark_resolved→
  // blacklisted）；resume 是 idempotent recovery，benign skip 不 fail run，下輪 cron
  // 用 admin 升完後的 state 重新評估。
  const updResume = await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'marked_archived',
            marked_archived_at = datetime('now'),
            purge_after = datetime('now', '+7 days'),
            updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND state = 'verified'`
  ).bind(envName, tableName, coldClass, blocker.archive_date,
         blocker.min_id, blocker.max_id, blocker.chunk_sha256).run()

  if ((updResume?.meta?.changes ?? 0) !== 1) {
    // race during resume — admin moved chunk past 'verified'; skip silently（無 emit），
    // 不污染 report.chunks_marked_archived 統計。admin action 自己會 emit 該 transition。
    return
  }

  report.chunks_marked_archived++
  report.rows_marked_archived += blocker.row_count

  await safeUserAudit(ctx.env, {
    event_type: `${ctx.eventPrefix}.chunk_uploaded`,  // marked_archived 走同 emit（資訊重複；補強 chain）
    severity:   'info',
    data: {
      run_id:     runId,
      dry_run:    false,
      env:        envName,
      table:      tableName,
      cold_class: coldClass,
      manifest_key: manifestKey,
      min_id:     blocker.min_id,
      max_id:     blocker.max_id,
      sha256_jsonl: blocker.chunk_sha256,
      resumed:    'verified_to_marked_archived',
    },
  })
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
