/**
 * POST /api/admin/cron/audit-archive
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 2.2a / 2.1b — Archive worker dry-run + round-robin 6 cold_class
 * （design doc：docs/AUDIT_RETENTION_PLAN.md PR 2.1b 段）
 *
 * PR 2.1b 範圍（2026-05-12）：
 *   - 新 chunk 預設 compression='gzip' — Workers 原生 CompressionStream，0 deps
 *   - chunks 表 + manifest 同步加 compression 欄與 sha256_gz（migration 0041）
 *   - 副檔名 .jsonl → .jsonl.gz；R2 PUT 加 httpMetadata.contentEncoding='gzip'
 *   - verify 路徑依 blocker.compression 分支：gzip → decompress 後 sha；none → 直 sha
 *   - 向下相容：PR 2.0 既有 dry-run uploaded chunk（compression='none'）仍走 .jsonl
 *     原路徑 → verified → 終態（dry-run 不 mark_archived）
 *
 * PR 2.2a 範圍（2026-05-12）：
 *   - 從 PR 2.1d 的「只跑 telemetry」expand 到 6 cold_class round-robin
 *   - 新 env AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN（預設 2）控制單輪 cron 最多寫幾個 chunk
 *     - 一個「work unit」= 一次 R2 PUT-bearing 動作（fresh planned→uploaded /
 *       planned recovery / uploaded verify / verified mark_archived）
 *     - dry_run skip / non-terminal-other skip / no_rows_eligible / drift fail-fast
 *       = 0 unit（純查詢 / emit critical，沒寫 R2 / 沒升態，不算配額）
 *   - per-class hot retention：utils.hotRetentionDaysFor(env, coldClass)；
 *     telemetry 維持 AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS（PR 2.0 起 prod 部署），
 *     其餘類別吃 AUDIT_ARCHIVE_HOT_DAYS_<COLD_CLASS_UPPER> 或 design doc 預設
 *   - report 加 `cold_classes: [...]` 陣列；同時保留頂層 chunks_/rows_/blocker/
 *     skipped_reason/recovery 作 PR 2.1d 既有測試與 prod cron 監控的 back-compat
 *     mirror（鏡射「primary class」= 該輪首個有實質結果的 sub-report）
 *
 * PR 2.1d 範圍（codex F-1/F-2/F-3 收尾）：
 *   - F-1：chunk_uploaded emit 點搬到 handleUploadedBlocker（verify ok 後）；
 *          prod audit_log id=924 為舊語意，forensic 時要注意
 *   - F-2：runFreshChunkPipeline 對 rows 做 severity reduce，塞進 manifest
 *   - F-3：所有 R2 bucket.put 改走 archivePut（utils putWithRetry）— 1s/4s/16s
 *          exponential backoff，每次 attempt 失敗 emit audit.archive.upload_failed
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
  SUPPORTED_COLD_CLASSES,
  CHUNK_MAX_ROWS,
  CHUNK_MAX_BYTES,
  NON_TERMINAL_STATES,
  computeCursorAndBlocker,
  rowsToJsonl,
  sha256Hex,
  gzipCompress,
  gzipDecompress,
  buildChunkKeys,
  buildManifest,
  deriveKeysFromChunk,
  appendStateHistory,
  aggregateSeverities,
  putWithRetry,
  rowMatchesColdClass,
  hotRetentionDaysFor,
  newRunId,
  utcDate,
  ARCHIVE_WRITER_VERSION,
} from '../../../utils/audit-archive.js'

// PR 2.0：cold_class 版本固定 1。audit-policy 改動時 bump（design doc v8 cold_class_version）
const COLD_CLASS_VERSION = 1

// PR 2.2a：單輪 cron 最多寫幾個 chunk。預設 2 — 6 class × 21s retry 最壞累積 126s wallclock
// 過大，2 取「比 1 有效率（驗 F-2 比較自然）+ 比 6 安全」的平衡。
// PR 2.2a codex r2：空字串 / null / undefined → 預設 2（Number('') === 0 會誤夾到 1）；
//                  其他非數字 → 預設 2；<1 也夾回 1（不讓 worker 完全卡死）。
function parseMaxChunksPerRun(env) {
  const raw = env?.AUDIT_ARCHIVE_MAX_CHUNKS_PER_RUN
  if (raw == null || raw === '') return 2
  const n = Number(raw)
  if (!Number.isFinite(n)) return 2
  if (n < 1) return 1
  return Math.floor(n)
}

function isDryRun(env) {
  const v = String(env.AUDIT_ARCHIVE_DRY_RUN ?? 'true').toLowerCase()
  return v !== 'false'
}

function archiveEnv(env) {
  return String(env.ARCHIVE_ENV ?? 'prod')
}

// PR 2.1d：可選的 backoff schedule env 注入（CSV 毫秒數）。空字串/缺值 → 用 utils 預設。
// 主要供整合測試把 backoff 設 [0,0,0] 避免真的等 21 秒；prod 不該設此 env。
function parseRetryBackoffMs(env) {
  const raw = String(env.AUDIT_ARCHIVE_PUT_RETRY_BACKOFF_MS ?? '').trim()
  if (!raw) return undefined
  const parts = raw.split(',').map(s => Number(s.trim()))
  if (parts.some(n => !Number.isFinite(n) || n < 0)) return undefined
  return parts
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

// PR 2.2a：建立 per-class sub-report 容器。所有 handler 改吃 sub-report（不再共用 top-level）。
function newSubReport(coldClass) {
  return {
    cold_class: coldClass,
    cursor: 0,
    blocker: null,
    blocker_action: null,
    chunks_planned: 0,
    chunks_uploaded: 0,
    chunks_verified: 0,
    chunks_marked_archived: 0,
    rows_uploaded: 0,
    rows_marked_archived: 0,
    skipped_reason: null,
    recovery: null,
    errors: [],
    ok: true,
    // PR 2.2a codex r1：handler 一進入 R2 PUT-bearing 路徑就標 true；
    // 在 archivePut 真正 throw 之前已記錄，可避免「PUT fail → 0 counter → 不消配額
    // → 整輪 6 class 依序失敗」把 max_chunks_per_run wallclock budget 打爆。
    // 計入 didConsumeQuota；didWriteWork 仍只看實際升態 counter，給 mirror predicate 用。
    attempted_write: false,
  }
}

// PR 2.2a：sub-report 是否實質「做了一次 R2 PUT-bearing 動作 + 完成 D1 升態」。
// mirror primary 預測用：升態完成的 class 比「嘗試但失敗」優先映射上頂層。
function didWriteWork(sub) {
  return (sub.chunks_planned + sub.chunks_uploaded
        + sub.chunks_verified + sub.chunks_marked_archived) > 0
}

// PR 2.2a codex r1 修正：是否消耗 max_chunks_per_run 配額。
// = didWriteWork OR 已嘗試 PUT 但中途 throw（archivePut / D1 失敗都算）。
// 失敗 attempt 也計入 → 整輪 R2 / D1 大規模故障時不會把 6 class 全跑一遍。
function didConsumeQuota(sub) {
  return didWriteWork(sub) || sub.attempted_write === true
}

export async function onRequestPost({ request, env }) {
  // ── Auth ─────────────────────────────────────────────────
  const auth = request.headers.get('Authorization') ?? ''
  const expected = env.CRON_SECRET
  if (!expected) return res({ error: 'CRON_SECRET not configured', code: 'CRON_SECRET_NOT_CONFIGURED' }, 500)
  if (auth !== `Bearer ${expected}`) return res({ error: 'unauthorized', code: 'UNAUTHORIZED' }, 401)

  // ── Binding 檢查 ─────────────────────────────────────────
  const bucket = env.AUDIT_ARCHIVE_BUCKET
  if (!bucket) return res({ error: 'AUDIT_ARCHIVE_BUCKET binding missing', code: 'INTERNAL_ERROR' }, 500)
  const db = env.chiyigo_db
  if (!db)     return res({ error: 'chiyigo_db binding missing', code: 'INTERNAL_ERROR' }, 500)

  const dryRun            = isDryRun(env)
  const envName           = archiveEnv(env)
  const runId             = newRunId()
  const startedAt         = new Date().toISOString()
  const putRetryBackoffMs = parseRetryBackoffMs(env)
  const maxChunks         = parseMaxChunksPerRun(env)

  const tableName = PR20_SUPPORTED_TABLE

  const report = {
    ok: true,
    mode: dryRun ? 'dry_run' : 'live',
    run_id: runId,
    started_at: startedAt,
    table: tableName,
    writer_version: ARCHIVE_WRITER_VERSION,
    max_chunks_per_run: maxChunks,
    chunks_planned: 0,
    chunks_uploaded: 0,
    chunks_verified: 0,
    chunks_marked_archived: 0,
    rows_uploaded: 0,
    rows_marked_archived: 0,
    errors: [],
    cold_classes: [],
    // PR 2.2a back-compat fields — mirror primary sub-report 後填
    cold_class: null,
    cursor: 0,
    blocker: null,
    blocker_action: null,
    skipped_reason: null,
  }

  let workUnits = 0
  // 6 cold_class round-robin。順序在 utils SUPPORTED_COLD_CLASSES 固定 → forensic 可重現。
  for (const coldClass of SUPPORTED_COLD_CLASSES) {
    if (workUnits >= maxChunks) {
      // 配額用盡 — 仍把剩餘 class 紀錄一筆 skipped，方便監控觀察是否常態化撐爆。
      const sub = newSubReport(coldClass)
      sub.skipped_reason = 'max_chunks_per_run_reached'
      report.cold_classes.push(sub)
      continue
    }
    const sub = newSubReport(coldClass)
    try {
      await processColdClass({
        env, envName, tableName, coldClass, dryRun, runId, db, bucket,
        report: sub, putRetryBackoffMs,
      })
    } catch (e) {
      console.error(`[audit-archive] PR 2.2a class=${coldClass} crashed:`, e)
      sub.ok = false
      sub.errors.push({ message: e.message ?? String(e) })
    }
    if (didConsumeQuota(sub)) workUnits++
    report.cold_classes.push(sub)
  }

  // ── 彙整 sub-reports 到頂層 ─────────────────────────────
  for (const s of report.cold_classes) {
    report.chunks_planned         += s.chunks_planned         ?? 0
    report.chunks_uploaded        += s.chunks_uploaded        ?? 0
    report.chunks_verified        += s.chunks_verified        ?? 0
    report.chunks_marked_archived += s.chunks_marked_archived ?? 0
    report.rows_uploaded          += s.rows_uploaded          ?? 0
    report.rows_marked_archived   += s.rows_marked_archived   ?? 0
    if (s.errors?.length) for (const e of s.errors) report.errors.push({ cold_class: s.cold_class, ...e })
    if (s.ok === false) report.ok = false
  }

  // ── back-compat：頂層 mirror「primary」sub-report ───────
  // PR 2.2a codex r1：兩段挑選。
  //   1) 「有意義訊號」優先：實質升態 / blocker / drift / dry_run skip / failed blocker
  //      skip / ok=false / recovery — PR 2.1d 行為（只 seed 一個 class 時頂層 mirror
  //      那個 class）對應這層。
  //   2) 上一層找不到才落 fallback：第一個 no_rows_eligible / no_rows_after_size_limit
  //      / max_chunks_per_run_reached / attempted-write-but-no-success 等普通 skip
  //      訊號。這層存在的目的是避免「全 6 class 都沒事做」的正常 run 頂層出現
  //      cold_class=null / skipped_reason=null，讓 prod cron 監控誤判 blank run。
  //   全 6 class 完全空（沒任何 skipped_reason，不該發生）才落最終 null。
  const isMeaningfulSignal = s =>
    didWriteWork(s)
    || s.blocker
    || s.recovery
    || s.ok === false
    || s.skipped_reason === 'cold_class_drift_detected'
    || s.skipped_reason === 'dry_run_skips_marked_archived'
  const primary =
    report.cold_classes.find(isMeaningfulSignal)
    ?? report.cold_classes.find(s => s.skipped_reason)
  if (primary) {
    report.cold_class     = primary.cold_class
    report.cursor         = primary.cursor
    report.blocker        = primary.blocker
    report.blocker_action = primary.blocker_action
    if (primary.skipped_reason) report.skipped_reason = primary.skipped_reason
    if (primary.recovery)       report.recovery       = primary.recovery
  }

  report.finished_at = new Date().toISOString()
  return res(report, report.ok ? 200 : 500)
}

// PR 2.2a：單一 cold_class 完整推進邏輯（PR 2.1d 的 main body 抽出來）。
//   - Step 1：列出當前 (env, table, cold_class) 全部 chunks → cursor + blocker
//   - Step 2：unfinished-chunk-first gate；blocker 依 state 分派
//   - Step 3：無 blocker → fresh chunk pipeline（受 per-class hot retention 限制）
async function processColdClass(args) {
  const { env, envName, tableName, coldClass, dryRun, runId, db, bucket, report, putRetryBackoffMs } = args

  // ── Step 1：算 cursor + blocker（PR 2.1c：chunks 帶 dry_run 欄）────────
  const chunksRows = await db.prepare(
    `SELECT env, table_name, cold_class, archive_date,
            min_id, max_id, state, chunk_sha256, row_count, retry_count, dry_run, compression
       FROM audit_archive_chunks
      WHERE env = ? AND table_name = ? AND cold_class = ?
      ORDER BY min_id ASC`
  ).bind(envName, tableName, coldClass).all()

  const chunks = chunksRows.results ?? []
  const { cursor, blocker } = computeCursorAndBlocker(chunks, tableName)
  report.cursor = cursor

  // ── Step 2：blocker 分派 ────────────────────────────────
  if (blocker) {
    report.blocker = {
      state: blocker.state,
      min_id: blocker.min_id,
      max_id: blocker.max_id,
    }
    const ctx = {
      env, envName, tableName, coldClass, dryRun, runId, db, bucket, report,
      blocker, putRetryBackoffMs,
    }
    switch (blocker.state) {
      case 'planned':  await handlePlannedBlocker(ctx);  break
      case 'uploaded': await handleUploadedBlocker(ctx); break
      case 'verified': await handleVerifiedBlocker(ctx); break
      case 'marked_archived': // PR 4 才做 purge；PR 2.1a 等 grace 不動
      case 'failed':
      case 'blacklisted':
      default:
        report.skipped_reason = `non_terminal_blocker_state_${blocker.state}`
        break
    }
    return
  }

  // ── Step 3：無 blocker — fresh chunk pipeline ──────────
  await runFreshChunkPipeline({
    env, envName, tableName, coldClass, dryRun, runId, db, bucket, report, cursor, putRetryBackoffMs,
  })
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
  const blockerCompression = blocker.compression ?? 'none'

  // PR 2.2a codex r1：標記 quota 消耗點 — 即使下面 PUT throw 也已記錄一次嘗試。
  report.attempted_write = true

  // 1) PUT data（R2 PUT idempotent — 同 key 同 body 覆寫無副作用）
  // PR 2.1b：依 chunk 自己當初寫入的 compression 決定 body / contentEncoding。
  //   - 'gzip'：重新 gzip jsonl（chunk_sha256 仍對齊 decompressed jsonl，不影響 idempotency）
  //   - 'none'：直送 jsonl（PR 2.0 既有 planned chunk recovery 場景）
  if (blockerCompression === 'gzip') {
    const gzBody = await gzipCompress(jsonl)
    await archivePut(ctx, 'data', chunkInfo, dataKey, gzBody, {
      httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
    })
  } else {
    await archivePut(ctx, 'data', chunkInfo, dataKey, jsonl, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    })
  }

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

  // PR 2.2a codex r2：整個 verify_uploaded 動作（R2 GET + sha + PUT manifest +
  // D1 UPDATE）算單一 quota unit；GET 端 throw 也應消配額，所以 attempted_write
  // 提早到 GET 之前標。
  report.attempted_write = true

  // PR 2.1c：用 chunk 自身 dry_run 算 key（H-1 provenance fix）
  const chunkDryRun = blocker.dry_run === 1 || blocker.dry_run === true
  const blockerCompression = blocker.compression ?? 'none'
  const { dataKey, manifestKey } = deriveKeysFromChunk(blocker)
  const obj = await bucket.get(dataKey)
  if (!obj) {
    return failChunkMismatch(ctx, 'verification_failed', {
      reason: 'r2_object_not_found',
      data_key: dataKey,
      stage: 'uploaded_verify',
    })
  }
  // PR 2.1b：依 chunk 自身 compression 還原 jsonl bytes，再算 sha256 對齊
  // chunk_sha256（永遠是 decompressed jsonl 的 sha，design doc § Manifest 結構）。
  let text
  if (blockerCompression === 'gzip') {
    const gzBytes = new Uint8Array(await obj.arrayBuffer())
    const jsonlBytes = await gzipDecompress(gzBytes)
    text = new TextDecoder().decode(jsonlBytes)
  } else {
    text = await obj.text()
  }
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
      compression:   blockerCompression,
      verified_at:   new Date().toISOString(),
    },
  })
}

// ── Verified blocker：marked_archived 雙路徑驗證（design doc §「升態雙路徑」）─
// audit_log 專用；admin_audit_log（PR 2.2 後續）不走此路（terminal=cold_copied）。
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

  // PR 2.2a codex r1：live mark_archived 牽涉 audit_log UPDATE + R2 PUT，
  // 失敗中途也算 quota 消耗 — 不可讓 6 class 連續失敗把 wallclock 打爆。
  report.attempted_write = true

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

  // PR 2.2a：per-class hot retention（design doc §「Retention Matrix」）
  const hotDays = hotRetentionDaysFor(env, coldClass)
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

  // PR 2.1b：新 chunk 預設 gzip 壓縮；先算壓縮 bytes 與 sha256_gz（forensic）。
  // chunk_sha256 / dataKey 仍對齊 decompressed jsonl 的 sha — data identity 不變。
  const compression = 'gzip'
  const gzBody      = await gzipCompress(jsonl)
  const sha256Gz    = await sha256Hex(gzBody)

  const { dataKey, manifestKey } = buildChunkKeys({
    env: envName, tableName, coldClass,
    minId, maxId, sha256: sha, archiveDate, dryRun, compression,
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
    compression, sha256Gz,
  })

  const chunkInfo = { dryRun, minId, maxId }

  // PR 2.2a codex r1：跨過所有 fail-fast skip 後，下面就要寫 R2 + D1 — 標記 quota 消耗。
  report.attempted_write = true

  await archivePut(ctx, 'manifest', chunkInfo, manifestKey, JSON.stringify(plannedManifest, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  })

  await db.prepare(
    `INSERT OR IGNORE INTO audit_archive_chunks
      (env, table_name, cold_class, cold_class_version, archive_date,
       min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id, dry_run, compression)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, 0, ?, ?, ?)`
  ).bind(envName, tableName, coldClass, COLD_CLASS_VERSION, archiveDate,
         minId, maxId, sha, rows.length, runId, dryRun ? 1 : 0, compression).run()

  report.chunks_planned = 1

  // PUT data → 升 uploaded（gzip body + contentEncoding=gzip）
  await archivePut(ctx, 'data', chunkInfo, dataKey, gzBody, {
    httpMetadata: { contentType: 'application/x-ndjson', contentEncoding: 'gzip' },
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
