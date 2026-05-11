/**
 * POST /api/admin/cron/audit-archive
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 2.1a / 2.1c / 2.1d — Archive worker dry-run + state machine
 * （design doc：docs/AUDIT_RETENTION_PLAN.md v11）
 *
 * PR 2.1d 範圍（codex F-1/F-2/F-3 收尾）：
 *   - F-1：chunk_uploaded emit 點搬到 handleUploadedBlocker（verify ok 後）；
 *          prod audit_log id=924 為舊語意，forensic 時要注意
 *   - F-2：runFreshChunkPipeline 對 rows 做 severity reduce，塞進 manifest
 *   - F-3：所有 R2 bucket.put 改走 archivePut（utils putWithRetry）— 1s/4s/16s
 *          exponential backoff，每次 attempt 失敗 emit audit.archive.upload_failed
 *          (warn)；最後 attempt 失敗 emit critical 並 throw
 *
 * PR 2.1a 範圍（user 在 2026-05-11 確認）：
 *   - 補三段升態：planned recovery → uploaded、uploaded → verified、verified → marked_archived
 *   - planned/uploaded blocker recovery：從 D1 重撈 row id range + 重 serialize + sha 對齊
 *   - marked_archived 升態走 design doc 「雙路徑驗證」（first-pass / recovery）
 *   - 仍只跑 (audit_log, telemetry)；6 cold_class expand 留 PR 2.2
 *   - zstd 壓縮獨立 PR 2.1b（避免 WASM bundle 風險與狀態機 review 混在一起）
 *   - DRY_RUN=true 時 verified 為終點：不 UPDATE archived_at，下輪 cron 仍會 hit verified blocker 並 skip
 *
 * 🔴 no-delete discipline：
 *   本檔禁止呼叫 env.AUDIT_ARCHIVE_BUCKET.delete( 任何形式（含 .delete、['delete']、解構）。
 *   scripts/lint-archive-no-delete.js 在 build 時掃 functions/api/admin/cron/audit-archive*.js
 *   + functions/utils/audit-archive*.js，違者 build fail。
 *
 * Cron 觸發：.github/workflows/cron-audit-archive.yml（每日 18:00 UTC = 02:00 Asia/Taipei）。
 */

import { res } from '../../../utils/auth.js'
import { safeUserAudit } from '../../../utils/user-audit.js'
import {
  PR20_SUPPORTED_TABLE,
  PR20_SUPPORTED_COLD_CLASS,
  CHUNK_MAX_ROWS,
  CHUNK_MAX_BYTES,
  NON_TERMINAL_STATES,
  computeCursorAndBlocker,
  rowsToJsonl,
  sha256Hex,
  buildChunkKeys,
  buildManifest,
  deriveKeysFromChunk,
  appendStateHistory,
  aggregateSeverities,
  putWithRetry,
  rowMatchesColdClass,
  newRunId,
  utcDate,
  ARCHIVE_WRITER_VERSION,
} from '../../../utils/audit-archive.js'

// PR 2.0：cold_class 版本固定 1。audit-policy 改動時 bump（design doc v8 cold_class_version）
const COLD_CLASS_VERSION = 1

function hotRetentionDays(env) {
  const raw = Number(env.AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS ?? 30)
  return Number.isFinite(raw) ? raw : 30
}

function isDryRun(env) {
  const v = String(env.AUDIT_ARCHIVE_DRY_RUN ?? 'true').toLowerCase()
  return v !== 'false'
}

function archiveEnv(env) {
  return String(env.ARCHIVE_ENV ?? 'prod')
}

// PR 2.1d（codex F-3）：R2 PUT 失敗 emit audit.archive.upload_failed。
//   - 非最後一次 attempt → severity='warn'
//   - 最後一次 attempt    → severity='critical'
// Helper 把 role / chunk 上下文塞進 data，方便事後 forensic 區分是 data 還 manifest PUT 失敗。
function makePutAuditCallback(ctx, role, chunkInfo, maxAttempts) {
  return async ({ attempt, error, willRetry, nextDelayMs, key }) => {
    const sev = willRetry ? 'warn' : 'critical'
    await safeUserAudit(ctx.env, {
      event_type: 'audit.archive.upload_failed',
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

// Wrap putWithRetry with audit callback；retry 由 utils helper 負責。
async function archivePut(ctx, role, chunkInfo, key, body, putOpts) {
  const backoffMs = ctx.putRetryBackoffMs    // undefined → utils 用預設 [1s,4s,16s]
  const sleep     = ctx.putRetrySleep        // undefined → utils 用 setTimeout
  const maxAttempts = (backoffMs ?? [1000, 4000, 16000]).length + 1
  return putWithRetry(ctx.bucket, key, body, putOpts, {
    backoffMs,
    sleep,
    onAttemptFailed: makePutAuditCallback(ctx, role, chunkInfo, maxAttempts),
  })
}

export async function onRequestPost({ request, env }) {
  // ── Auth ─────────────────────────────────────────────────
  const auth = request.headers.get('Authorization') ?? ''
  const expected = env.CRON_SECRET
  if (!expected) return res({ error: 'CRON_SECRET not configured' }, 500)
  if (auth !== `Bearer ${expected}`) return res({ error: 'unauthorized' }, 401)

  // ── Binding 檢查 ─────────────────────────────────────────
  const bucket = env.AUDIT_ARCHIVE_BUCKET
  if (!bucket) return res({ error: 'AUDIT_ARCHIVE_BUCKET binding missing' }, 500)
  const db = env.chiyigo_db
  if (!db)     return res({ error: 'chiyigo_db binding missing' }, 500)

  const dryRun   = isDryRun(env)
  const envName  = archiveEnv(env)
  const runId    = newRunId()
  const startedAt = new Date().toISOString()

  const tableName = PR20_SUPPORTED_TABLE
  const coldClass = PR20_SUPPORTED_COLD_CLASS

  const report = {
    ok: true,
    mode: dryRun ? 'dry_run' : 'live',
    run_id: runId,
    started_at: startedAt,
    table: tableName,
    cold_class: coldClass,
    writer_version: ARCHIVE_WRITER_VERSION,
    blocker: null,
    blocker_action: null,
    cursor: 0,
    chunks_planned: 0,
    chunks_uploaded: 0,
    chunks_verified: 0,
    chunks_marked_archived: 0,
    rows_uploaded: 0,
    rows_marked_archived: 0,
    skipped_reason: null,
    errors: [],
  }

  try {
    // ── Step 1：列出當前 (table, cold_class) 全部 chunks，算 cursor + blocker ──
    // PR 2.1c 加 dry_run 欄：blocker 升態的 key derivation / mark_archived skip 邏輯
    // 都要看 chunk 自身 provenance，不看當前 env flag（避免 H-1 dryrun→live flip 損毀）。
    const chunksRows = await db.prepare(
      `SELECT env, table_name, cold_class, archive_date,
              min_id, max_id, state, chunk_sha256, row_count, retry_count, dry_run
         FROM audit_archive_chunks
        WHERE env = ? AND table_name = ? AND cold_class = ?
        ORDER BY min_id ASC`
    ).bind(envName, tableName, coldClass).all()

    const chunks = chunksRows.results ?? []
    const { cursor, blocker } = computeCursorAndBlocker(chunks, tableName)
    report.cursor = cursor

    // ── Step 2：unfinished-chunk-first gate — 依 blocker.state 分派 ──
    if (blocker) {
      report.blocker = {
        state: blocker.state,
        min_id: blocker.min_id,
        max_id: blocker.max_id,
      }
      const ctx = { env, envName, tableName, coldClass, dryRun, runId, db, bucket, report, blocker }
      switch (blocker.state) {
        case 'planned':         await handlePlannedBlocker(ctx);  break
        case 'uploaded':        await handleUploadedBlocker(ctx); break
        case 'verified':        await handleVerifiedBlocker(ctx); break
        case 'marked_archived': // PR 4 才做 purge；PR 2.1a 等 grace 不動
        case 'failed':
        case 'blacklisted':
        default:
          report.skipped_reason = `non_terminal_blocker_state_${blocker.state}`
          break
      }
      report.finished_at = new Date().toISOString()
      return res(report, report.ok ? 200 : 500)
    }

    // ── Step 3：無 blocker — 走 PR 2.0 既有 planned→uploaded 主流程 ──
    await runFreshChunkPipeline({
      env, envName, tableName, coldClass, dryRun, runId, db, bucket, report, cursor,
    })
  } catch (e) {
    console.error('[audit-archive] PR 2.1a cron failed:', e)
    report.ok = false
    report.errors.push({ message: e.message ?? String(e) })
  }

  report.finished_at = new Date().toISOString()
  return res(report, report.ok ? 200 : 500)
}

// ── Planned blocker：D1 重撈 + 重 serialize + sha 對齊 → uploaded ─────────
// 場景：上輪 worker 寫了 planned manifest 與 chunks row，但 data PUT 失敗或 crash。
// design doc §「marked_archived 升態雙路徑」前置的 idempotent recovery 概念。
async function handlePlannedBlocker(ctx) {
  const { envName, tableName, coldClass, db, bucket, report, blocker } = ctx
  // PR 2.1c：dryRun 從 chunk row 自己取，不看 env flag（H-1 provenance fix）
  const chunkDryRun = blocker.dry_run === 1 || blocker.dry_run === true
  report.blocker_action = 'recovery_planned'

  // 重撈：cold_class + archived_at IS NULL + id range
  const rowsRes = await db.prepare(
    `SELECT id, event_type, severity, user_id, client_id, ip_hash, event_data, cold_class, created_at
       FROM audit_log
      WHERE id BETWEEN ? AND ?
        AND cold_class = ?
        AND archived_at IS NULL
      ORDER BY id ASC`
  ).bind(blocker.min_id, blocker.max_id, coldClass).all()
  const rows = rowsRes.results ?? []

  if (rows.length !== blocker.row_count) {
    return failChunkMismatch(ctx, 'row_count_mismatch', {
      expected: blocker.row_count,
      actual: rows.length,
      stage: 'planned_recovery',
    })
  }
  const jsonl = rowsToJsonl(rows)
  const sha   = await sha256Hex(jsonl)
  if (sha !== blocker.chunk_sha256) {
    return failChunkMismatch(ctx, 'row_count_mismatch', {
      expected_sha256: blocker.chunk_sha256,
      actual_sha256:   sha,
      stage: 'planned_recovery',
    })
  }

  const { dataKey, manifestKey } = deriveKeysFromChunk(blocker)
  const chunkInfo = { dryRun: chunkDryRun, minId: blocker.min_id, maxId: blocker.max_id }

  // 1) PUT data（R2 PUT idempotent — 同 key 同 body 覆寫無副作用）
  await archivePut(ctx, 'data', chunkInfo, dataKey, jsonl, {
    httpMetadata: { contentType: 'application/x-ndjson' },
  })

  // 2) Manifest 升 uploaded — 讀回現有 planned manifest append state_history
  const uploadedManifest = await loadAndAppend(bucket, manifestKey, 'uploaded')
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey, JSON.stringify(uploadedManifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  })

  // 3) chunks.state planned → uploaded
  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'uploaded', updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(envName, tableName, coldClass, blocker.min_id, blocker.max_id, blocker.chunk_sha256).run()

  report.chunks_uploaded = 1
  report.rows_uploaded   = rows.length
  report.recovery        = 'planned_to_uploaded'

  // PR 2.1d（codex F-1）：chunk_uploaded emit 已搬到 handleUploadedBlocker（verify ok 後），
  // recovery 路徑也走同一個 emit 點 — 由 handleUploadedBlocker 在下一輪 cron 統一發。
  // recovery 動作本身在 report.recovery 與 chunks row 留痕，需要 forensic 重建時靠
  // chunks.run_id（fresh）+ 後續 verify 的 run_id（不同）即可區分。
}

// ── Uploaded blocker：R2 GET 回讀 + sha + row_count 比對 → verified ────────
async function handleUploadedBlocker(ctx) {
  const { envName, tableName, coldClass, db, bucket, report, blocker, runId } = ctx
  report.blocker_action = 'verify_uploaded'

  // PR 2.1c：用 chunk 自身 dry_run 算 key（H-1 provenance fix）
  const chunkDryRun = blocker.dry_run === 1 || blocker.dry_run === true
  const { dataKey, manifestKey } = deriveKeysFromChunk(blocker)
  const obj = await bucket.get(dataKey)
  if (!obj) {
    return failChunkMismatch(ctx, 'verification_failed', {
      reason: 'r2_object_not_found',
      data_key: dataKey,
      stage: 'uploaded_verify',
    })
  }
  const text = await obj.text()
  const sha  = await sha256Hex(text)
  // jsonl trailing newline → 行數 = newline 數
  const rowCount = text.length === 0 ? 0 : (text.match(/\n/g) ?? []).length

  if (sha !== blocker.chunk_sha256 || rowCount !== blocker.row_count) {
    return failChunkMismatch(ctx, 'verification_failed', {
      expected_sha256: blocker.chunk_sha256,
      actual_sha256:   sha,
      expected_row_count: blocker.row_count,
      actual_row_count:   rowCount,
      stage: 'uploaded_verify',
    })
  }

  // 升 verified
  const verifiedManifest = await loadAndAppend(bucket, manifestKey, 'verified')
  await archivePut(ctx, 'manifest',
    { dryRun: chunkDryRun, minId: blocker.min_id, maxId: blocker.max_id },
    manifestKey, JSON.stringify(verifiedManifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } },
  )

  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'verified', updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(envName, tableName, coldClass, blocker.min_id, blocker.max_id, blocker.chunk_sha256).run()

  report.chunks_verified = 1

  // PR 2.1d（codex F-1）：chunk_uploaded 在「verify ok 後」emit，對齊 design doc
  // §「chunk_uploaded 語意」。歷史註記：prod audit_log id=924 是 PR 2.0 / 2.1a 舊
  // 語意（upload 就 emit、沒驗 R2 sha 對齊就先發），forensic 比對時要意識到 924
  // 以前的事件不保證 chunk 已 verified。PR 2.1d 起一律先 verified 才發。
  await safeUserAudit(ctx.env, {
    event_type: 'audit.archive.chunk_uploaded',
    severity:   'info',
    data: {
      run_id:        runId,
      dry_run:       chunkDryRun,
      env:           envName,
      table:         tableName,
      cold_class:    coldClass,
      chunk_key:     dataKey,
      manifest_key:  manifestKey,
      row_count:     blocker.row_count,
      min_id:        blocker.min_id,
      max_id:        blocker.max_id,
      sha256_jsonl:  blocker.chunk_sha256,
      verified_at:   new Date().toISOString(),
    },
  })
}

// ── Verified blocker：marked_archived 雙路徑驗證（design doc §「升態雙路徑」）─
// audit_log 專用；admin_audit_log（PR 2.2）不走此路（terminal=cold_copied）。
async function handleVerifiedBlocker(ctx) {
  const { envName, tableName, coldClass, db, bucket, report, blocker } = ctx
  // PR 2.1c（codex H-1 修正）：是否 skip mark_archived 看「chunk 自己當初被 PUT 時是不是 dry-run」，
  // 不看當前 env flag。若 env 已切 live 但這 chunk 是 dry-run 寫的，data 物件只存在
  // dryrun prefix；強行 mark archived 後 cron-purge-worker 會刪掉沒備份的 D1 row。
  const chunkDryRun = blocker.dry_run === 1 || blocker.dry_run === true
  report.blocker_action = 'mark_archived'

  if (chunkDryRun) {
    // chunk 是 dry-run 寫的：verified = 終點，不 UPDATE archived_at。
    // 下一輪 cron 再 hit 同一 verified blocker → 仍 skip。
    // PR 4 跑「live 切換」前要先把所有 dry-run chunks 走完 purge/discard 流程，
    // 不靠這條 skip 永久墊著。
    report.skipped_reason = 'dry_run_skips_marked_archived'
    return
  }

  // 一階：UPDATE archived_at；對齊 design doc：
  //   WHERE id BETWEEN ? AND ? AND cold_class = ? AND archived_at IS NULL
  const upd = await db.prepare(
    `UPDATE audit_log
        SET archived_at = datetime('now')
      WHERE id BETWEEN ? AND ?
        AND cold_class = ?
        AND archived_at IS NULL`
  ).bind(blocker.min_id, blocker.max_id, coldClass).run()

  const changes = upd?.meta?.changes ?? 0

  let succeeded = false
  let path
  if (changes === blocker.row_count) {
    succeeded = true
    path = 'first_pass'
  } else {
    // 雙路徑：UPDATE 沒命中預期數量 → 查實際已標記 count
    //   changes==0 → crash-after-update recovery
    //   0<changes<row_count → partial UPDATE（worker 半途 retry）
    const cntRes = await db.prepare(
      `SELECT COUNT(*) AS c
         FROM audit_log
        WHERE id BETWEEN ? AND ?
          AND cold_class = ?
          AND archived_at IS NOT NULL`
    ).bind(blocker.min_id, blocker.max_id, coldClass).first()
    const archivedCount = Number(cntRes?.c ?? 0)
    if (archivedCount === blocker.row_count) {
      succeeded = true
      path = changes === 0 ? 'recovery' : 'partial_then_recovery'
    } else {
      return failChunkMismatch(ctx, 'partial_archive_mismatch', {
        expected: blocker.row_count,
        update_changes: changes,
        archived_count: archivedCount,
        stage: 'verified_mark_archived',
      })
    }
  }

  if (!succeeded) return

  // 升 marked_archived：寫 manifest + chunks UPDATE（含 marked_archived_at / purge_after = +7d）
  const { manifestKey } = deriveKeysFromChunk(blocker)
  const markedManifest = await loadAndAppend(bucket, manifestKey, 'marked_archived')
  await archivePut(ctx, 'manifest',
    { dryRun: chunkDryRun, minId: blocker.min_id, maxId: blocker.max_id },
    manifestKey, JSON.stringify(markedManifest, null, 2),
    { httpMetadata: { contentType: 'application/json' } },
  )

  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'marked_archived',
            marked_archived_at = datetime('now'),
            purge_after = datetime('now', '+7 days'),
            updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(envName, tableName, coldClass, blocker.min_id, blocker.max_id, blocker.chunk_sha256).run()

  report.chunks_marked_archived = 1
  report.rows_marked_archived   = blocker.row_count

  await safeUserAudit(ctx.env, {
    event_type: 'audit.archive.marked_archived',
    severity:   'info',
    data: {
      run_id: ctx.runId, dry_run: chunkDryRun, env: envName, table: tableName, cold_class: coldClass,
      manifest_key: manifestKey, row_count: blocker.row_count,
      min_id: blocker.min_id, max_id: blocker.max_id,
      path,
    },
  })
}

// ── 沒 blocker：撈新範圍 + planned→uploaded 一氣呵成（PR 2.0 既有路徑）─────
async function runFreshChunkPipeline(ctx) {
  const { env, envName, tableName, coldClass, dryRun, runId, db, bucket, report, cursor } = ctx

  const hotDays = hotRetentionDays(env)
  const retentionPredicate = hotDays > 0
    ? `AND created_at < datetime('now', '-${hotDays} days')`
    : ''

  const candidatesRes = await db.prepare(
    `SELECT id, event_type, severity, user_id, client_id, ip_hash, event_data, cold_class, created_at
       FROM audit_log
      WHERE id > ?
        AND cold_class = ?
        AND archived_at IS NULL
        ${retentionPredicate}
      ORDER BY id ASC
      LIMIT ?`
  ).bind(cursor, coldClass, CHUNK_MAX_ROWS + 1).all()

  const candidates = candidatesRes.results ?? []
  if (candidates.length === 0) {
    report.skipped_reason = 'no_rows_eligible'
    return
  }

  // PR 2.1c（codex M-1 修正）：candidates 是「stored cold_class 等於目標」的 row，
  // 但 runtime classifier 可能因 audit-policy 改動而不一致。若任何 candidate 被
  // classifier 排除 → 馬上 fail-fast 不建 chunk，因為：
  //   - 將那些 row 進 jsonl 不對（classifier 說它不屬於這 class）
  //   - 不進 jsonl 但仍處在 id range 內 → marked_archived 階段 UPDATE WHERE
  //     id BETWEEN min AND max 會把它一起標 archived，但實際沒備份 → purge 後丟資料
  // policy 與 backfill drift 是技術債，應由人介入決定 backfill 或改 classify；
  // 在這之前 worker 不要自作主張處理半套資料。
  const driftRows = candidates.filter(r => !rowMatchesColdClass(r, coldClass))
  if (driftRows.length > 0) {
    const sampleIds = driftRows.slice(0, 20).map(r => r.id)
    report.skipped_reason = 'cold_class_drift_detected'
    report.errors.push({
      event: 'cold_class_drift',
      drift_count: driftRows.length,
      sample_ids: sampleIds,
      stage: 'fresh_pipeline_classify',
    })
    await safeUserAudit(env, {
      event_type: 'audit.archive.cold_class_drift',
      severity:   'critical',
      data: {
        run_id: runId, env: envName, table: tableName, cold_class: coldClass,
        drift_count: driftRows.length,
        sample_ids: sampleIds,
        sample_event_types: [...new Set(driftRows.slice(0, 20).map(r => r.event_type))],
      },
    })
    return
  }

  const rows = []
  let bytesEstimate = 0
  for (const r of candidates) {
    const approxLen = (r.event_data?.length ?? 0) + 120
    if (rows.length >= CHUNK_MAX_ROWS) break
    if (bytesEstimate + approxLen > CHUNK_MAX_BYTES) break
    rows.push(r)
    bytesEstimate += approxLen
  }
  if (rows.length === 0) {
    report.skipped_reason = 'no_rows_after_size_limit'
    return
  }

  const jsonl = rowsToJsonl(rows)
  const sha   = await sha256Hex(jsonl)
  const minId = rows[0].id
  const maxId = rows[rows.length - 1].id
  const minTs = rows[0].created_at
  const maxTs = rows[rows.length - 1].created_at
  const archiveDate = utcDate()

  const { dataKey, manifestKey } = buildChunkKeys({
    env: envName, tableName, coldClass,
    minId, maxId, sha256: sha, archiveDate, dryRun,
  })

  // PR 2.1d（codex F-2）：manifest 帶 severities reduce 統計
  const severities = aggregateSeverities(rows)

  const plannedAt = new Date().toISOString()
  const plannedManifest = buildManifest({
    env: envName, tableName, coldClass, coldClassVersion: COLD_CLASS_VERSION,
    runId, state: 'planned',
    stateHistory: [{ state: 'planned', at: plannedAt }],
    rowCount: rows.length, minId, maxId, minTs, maxTs,
    sha256Jsonl: sha, dryRun, dataKey, severities,
  })

  const chunkInfo = { dryRun, minId, maxId }

  await archivePut(ctx, 'manifest', chunkInfo, manifestKey, JSON.stringify(plannedManifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  })

  await db.prepare(
    `INSERT OR IGNORE INTO audit_archive_chunks
      (env, table_name, cold_class, cold_class_version, archive_date,
       min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, 0, ?, ?)`
  ).bind(envName, tableName, coldClass, COLD_CLASS_VERSION, archiveDate,
         minId, maxId, sha, rows.length, runId, dryRun ? 1 : 0).run()

  report.chunks_planned = 1

  // PUT data → 升 uploaded
  await archivePut(ctx, 'data', chunkInfo, dataKey, jsonl, {
    httpMetadata: { contentType: 'application/x-ndjson' },
  })

  const uploadedManifest = appendStateHistory(plannedManifest, 'uploaded', new Date().toISOString())
  await archivePut(ctx, 'manifest', chunkInfo, manifestKey, JSON.stringify(uploadedManifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  })

  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'uploaded', updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(envName, tableName, coldClass, archiveDate, minId, maxId, sha).run()

  report.chunks_uploaded = 1
  report.rows_uploaded   = rows.length

  // PR 2.1d（codex F-1）：chunk_uploaded emit 已搬到 handleUploadedBlocker（verify ok 後）。
  // 此處不再 emit；下一輪 cron 撈到 uploaded blocker → R2 GET 對齊 sha → 升 verified 時統一發。
}

// ── 共用：失敗 → emit critical event + chunks.state='failed' + report.ok=false ─
async function failChunkMismatch(ctx, eventName, data) {
  const { envName, tableName, coldClass, db, report, blocker, runId } = ctx
  // PR 2.1c：audit event 帶 chunk 自身 dry_run（不是 env flag），方便 forensic 區分
  const chunkDryRun = blocker.dry_run === 1 || blocker.dry_run === true
  report.ok = false
  report.errors.push({ event: eventName, ...data })

  await db.prepare(
    `UPDATE audit_archive_chunks
        SET state = 'failed',
            last_failure = ?,
            last_failure_at = datetime('now'),
            retry_count = retry_count + 1,
            updated_at = datetime('now')
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(eventName, envName, tableName, coldClass,
         blocker.min_id, blocker.max_id, blocker.chunk_sha256).run()

  await safeUserAudit(ctx.env, {
    event_type: `audit.archive.${eventName}`,
    severity:   'critical',
    data: {
      run_id: runId, dry_run: chunkDryRun, env: envName, table: tableName, cold_class: coldClass,
      min_id: blocker.min_id, max_id: blocker.max_id,
      chunk_sha256: blocker.chunk_sha256,
      ...data,
    },
  })
}

// 從 R2 讀回 manifest JSON → append 升態紀錄。manifest 不存在 → 用最小 fallback。
async function loadAndAppend(bucket, manifestKey, nextState) {
  const obj = await bucket.get(manifestKey)
  const now = new Date().toISOString()
  if (!obj) {
    // 不該發生：planned/uploaded blocker 表示 manifest 已寫過。降級 fallback：
    // 寫一個僅含 state_history 的最小 manifest（不阻斷狀態機推進）。
    return { state: nextState, state_history: [{ state: nextState, at: now }] }
  }
  const text = await obj.text()
  let prev
  try { prev = JSON.parse(text) } catch { prev = { state_history: [] } }
  return appendStateHistory(prev, nextState, now)
}

export { NON_TERMINAL_STATES }
