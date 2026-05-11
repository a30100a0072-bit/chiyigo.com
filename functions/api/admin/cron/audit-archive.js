/**
 * POST /api/admin/cron/audit-archive
 * Header: Authorization: Bearer <CRON_SECRET>
 *
 * F-3 Phase 2 PR 2.0 — Archive worker dry-run（design doc：docs/AUDIT_RETENTION_PLAN.md）
 *
 * 範圍（PR 2.0，scope 由 user 在 2026-05-11 切確認）：
 *   - 只跑 audit_log / cold_class='telemetry'（PR 2.2 才 expand 到 6 個）
 *   - 只走 planned → uploaded（PR 2.1 補 verified / marked_archived）
 *   - Unfinished-chunk-first gate 從 PR 2.0 就強制：遇 non-terminal chunk 先處理、不掃新範圍
 *   - 預設 AUDIT_ARCHIVE_DRY_RUN=true → R2 prefix 走 audit-log-dryrun/
 *   - 任何狀況都不 UPDATE archived_at、不 DELETE D1 row
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
  archivePrefixes,
  buildChunkKeys,
  buildManifest,
  rowMatchesColdClass,
  newRunId,
  utcDate,
  ARCHIVE_WRITER_VERSION,
} from '../../../utils/audit-archive.js'

// PR 2.0：cold_class 版本固定 1。audit-policy 改動時 bump（design doc v8 cold_class_version）
const COLD_CLASS_VERSION = 1

// Hot retention（PR 2.0 預設 telemetry 30d）。可由 env.AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS 覆蓋，
// 方便 dry-run 期間故意調低觀察 worker 行為。<= 0 視為「不設下限、全撈」（仍受 archived_at IS NULL 收斂）。
function hotRetentionDays(env) {
  const raw = Number(env.AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS ?? 30)
  return Number.isFinite(raw) ? raw : 30
}

// dry-run flag — 預設 true（PR 2.0 必為 dry-run；要關必須顯式設 'false'）
function isDryRun(env) {
  const v = String(env.AUDIT_ARCHIVE_DRY_RUN ?? 'true').toLowerCase()
  return v !== 'false'
}

// env 名稱（R2 key 用） — 預設 'prod'，dev 可覆蓋
function archiveEnv(env) {
  return String(env.ARCHIVE_ENV ?? 'prod')
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

  // PR 2.0 鎖死 (table, cold_class) — 跨類由 PR 2.2 接手
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
    cursor: 0,
    chunks_planned: 0,
    chunks_uploaded: 0,
    rows_uploaded: 0,
    skipped_reason: null,
    errors: [],
  }

  try {
    // ── Step 1：列出當前 (table, cold_class) 全部 chunks，算 cursor + blocker ──
    const chunksRows = await db.prepare(
      `SELECT min_id, max_id, state, chunk_sha256, row_count, retry_count
         FROM audit_archive_chunks
        WHERE env = ? AND table_name = ? AND cold_class = ?
        ORDER BY min_id ASC`
    ).bind(envName, tableName, coldClass).all()

    const chunks = chunksRows.results ?? []
    const { cursor, blocker } = computeCursorAndBlocker(chunks, tableName)
    report.cursor = cursor

    // ── Step 2：unfinished-chunk-first gate ─────────────────
    // PR 2.0 只能處理 state='planned' 的 blocker（推它到 uploaded）。
    // 其他 non-terminal state（uploaded/verified/marked_archived/failed/blacklisted）→
    //   PR 2.1+ 才能升態；PR 2.0 不掃新範圍，回報後直接停。
    if (blocker) {
      report.blocker = {
        state: blocker.state,
        min_id: blocker.min_id,
        max_id: blocker.max_id,
      }
      if (blocker.state === 'planned') {
        // PR 2.0 recovery：planned blocker 嘗試重 PUT 一次（R2 idempotent by chunk_sha256 key）
        // 但 PR 2.0 還沒實作「從 D1 重撈 row 對齊既存 sha256」的安全 reattempt 機制
        // （需要 row id range 重撈、jsonl 重組、sha 校驗 — 留 PR 2.1 recovery path）。
        // 暫處理：標 skipped + 等 PR 2.1 接手；不掃新範圍。
        report.skipped_reason = 'planned_blocker_present_pr20_skips_recovery'
      } else {
        report.skipped_reason = `non_terminal_blocker_state_${blocker.state}`
      }
      report.finished_at = new Date().toISOString()
      return res(report, 200)
    }

    // ── Step 3：從 cursor+1 起撈下一批 telemetry row ──────────
    //   hot retention：created_at < now - {hotDays} days；hotDays<=0 → 不設下限
    const hotDays = hotRetentionDays(env)
    const retentionPredicate = hotDays > 0
      ? `AND created_at < datetime('now', '-${hotDays} days')`
      : ''

    // LIMIT = CHUNK_MAX_ROWS + 1：拿 +1 觀察「是否還有更多」用，但 PR 2.0 一輪只做 1 chunk
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
      report.finished_at = new Date().toISOString()
      return res(report, 200)
    }

    // ── Step 4：runtime classify 過濾 — 防 audit-policy 改動後 row 的 cold_class
    //   欄位過時。對不上的 row 不能進當前 chunk，下輪 worker 對應 class 再撈。
    //   PR 2.0 範圍內 cold_class 寫死 'telemetry'，這層主要是金融級保險。
    const rows = []
    let bytesEstimate = 0
    for (const r of candidates) {
      if (!rowMatchesColdClass(r, coldClass)) continue
      // 粗估每行 jsonl 大小（JSON.stringify 一次太貴；估 row 字串長度即可）
      const approxLen = (r.event_data?.length ?? 0) + 120
      if (rows.length >= CHUNK_MAX_ROWS) break
      if (bytesEstimate + approxLen > CHUNK_MAX_BYTES) break
      rows.push(r)
      bytesEstimate += approxLen
    }
    if (rows.length === 0) {
      report.skipped_reason = 'no_rows_match_cold_class_after_classify'
      report.finished_at = new Date().toISOString()
      return res(report, 200)
    }

    // ── Step 5：算 jsonl + sha256 + chunk key ───────────────
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

    // ── Step 6：寫 'planned' manifest 進 R2，INSERT chunks 表 ──
    const plannedAt = new Date().toISOString()
    const plannedManifest = buildManifest({
      env: envName, tableName, coldClass, coldClassVersion: COLD_CLASS_VERSION,
      runId, state: 'planned',
      stateHistory: [{ state: 'planned', at: plannedAt }],
      rowCount: rows.length, minId, maxId, minTs, maxTs,
      sha256Jsonl: sha, dryRun, dataKey,
    })

    await bucket.put(manifestKey, JSON.stringify(plannedManifest, null, 2), {
      httpMetadata: { contentType: 'application/json' },
    })

    // chunks 表 row：用 INSERT OR IGNORE — PK 含 chunk_sha256，同資料重跑 idempotent
    await db.prepare(
      `INSERT OR IGNORE INTO audit_archive_chunks
        (env, table_name, cold_class, cold_class_version, archive_date,
         min_id, max_id, chunk_sha256, state, row_count, retry_count, run_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, 0, ?)`
    ).bind(envName, tableName, coldClass, COLD_CLASS_VERSION, archiveDate,
           minId, maxId, sha, rows.length, runId).run()

    report.chunks_planned = 1

    // ── Step 7：PUT 資料 jsonl → 升 'uploaded' manifest + UPDATE chunks 表 ──
    await bucket.put(dataKey, jsonl, {
      httpMetadata: { contentType: 'application/x-ndjson' },
    })

    const uploadedAt = new Date().toISOString()
    const uploadedManifest = {
      ...plannedManifest,
      state: 'uploaded',
      state_history: [
        ...plannedManifest.state_history,
        { state: 'uploaded', at: uploadedAt },
      ],
    }
    await bucket.put(manifestKey, JSON.stringify(uploadedManifest, null, 2), {
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

    // ── Step 8：emit audit event ────────────────────────────
    await safeUserAudit(env, {
      eventType: 'audit.archive.chunk_uploaded',
      severity:  'info',
      eventData: JSON.stringify({
        run_id: runId,
        dry_run: dryRun,
        env: envName,
        table: tableName,
        cold_class: coldClass,
        chunk_key: dataKey,
        manifest_key: manifestKey,
        row_count: rows.length,
        min_id: minId,
        max_id: maxId,
        sha256_jsonl: sha,
      }),
    })
  } catch (e) {
    // 整輪失敗 — 不 emit audit.archive.upload_failed（PR 2.1 加 dedicated handler）；
    // PR 2.0 只把錯誤回傳 + 結構化 log，讓 GH Actions workflow 失敗推 alert。
    console.error('[audit-archive] PR 2.0 cron failed:', e)
    report.ok = false
    report.errors.push({ message: e.message ?? String(e) })
  }

  // 防衛：再次 grep 自己防 `.delete(` — 純執行期 sanity check（無 bucket.delete 呼叫）
  // （真正 enforcement 在 scripts/lint-archive-no-delete.js / CI）

  report.finished_at = new Date().toISOString()
  return res(report, 200)
}

// NON_TERMINAL_STATES exported for test 用途的 referenced re-export
export { NON_TERMINAL_STATES }

// 不要在此檔加任何 R2 .delete( 呼叫。Lint 規則 + code review 一起把關。
