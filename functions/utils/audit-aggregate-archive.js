/**
 * F-3 Phase 2 PR 3.2 — Aggregate cold-archive helpers
 *
 * 範圍：把 audit_log_aggregate_telemetry / audit_log_aggregate_debug 兩表
 * 每月 1 號 19:00 UTC archive 進 R2，與 PR 2.x audit_log archive 共用
 * `audit_archive_chunks` 表（靠 cold_class 區分），retention 1y。
 *
 * 與 PR 2.x audit_log archive 的差異：
 *   - 來源：aggregate 表（行少、無 raw event_data；schema 與 audit_log 完全不同）
 *   - 兩個全新 cold_class：'aggregate_telemetry' / 'aggregate_debug'
 *     （不撞 audit_log 既有 6 class；R2 lock + lifecycle 也獨立 prefix）
 *   - R2 prefix 結構不同：data 是 `audit-log-aggregate-{telemetry|debug}/{env}/...`，
 *     不重複塞 cold_class 段（prefix 本身已隱含）
 *   - 月度而非日度：cutoff = first_of_current_month_UTC（archive 上月與更早）
 *
 * 與 PR 2.x 共用：CHUNK_MAX_ROWS / CHUNK_MAX_BYTES / gzipCompress / sha256Hex /
 *   archiveExtension / putWithRetry / newRunId / utcDate / appendStateHistory /
 *   ARCHIVE_SCHEMA_VERSION / aggregateSeverities（不適用）
 *
 * 🔴 no-delete discipline：本檔與對應 cron handler **禁止** 出現
 *    env.AUDIT_ARCHIVE_BUCKET.delete( ；R2 lock 已將 prefix 設 365d retention，
 *    刪除走 admin force_purge 路徑（PR 2.3 同套；PR 3.2 暫未開）。
 */

import { ARCHIVE_SCHEMA_VERSION } from './audit-archive.js'

export const AGGREGATE_WRITER         = 'cron-aggregate-archive-worker'
export const AGGREGATE_WRITER_VERSION = '3.2.0'

/**
 * PR 3.2 範圍的兩個 aggregate 表 + 各自 cold_class 對照。
 *
 * cold_class 值與 migration 0044 DEFAULT 一致；archive worker 自己也用 INSERT chunks
 * row 時固定值 — 兩端寫死同名，drift 由 lint 防（grep 'aggregate_telemetry' 必須兩處對齊）。
 */
export const AGGREGATE_TABLES = Object.freeze({
  audit_log_aggregate_telemetry: 'aggregate_telemetry',
  audit_log_aggregate_debug:     'aggregate_debug',
})

export const AGGREGATE_COLD_CLASSES = Object.freeze([
  'aggregate_telemetry',
  'aggregate_debug',
])

/**
 * 月度 cutoff：回傳「本月 1 號 00:00:00 UTC」的 SQLite 文字格式（'YYYY-MM-DD HH:MM:SS'）。
 *
 * archive worker SELECT 條件 `created_at < cutoff` → 撈 last_month_or_earlier 的 row。
 * 設計刻意走「整月邊界」而非「30 天前」— PR 3.0/3.1 aggregate 已將原 raw row 摺成
 * hour_bucket，bucket 本身就是時間切片；以「自然月」當 archive 單位最直覺，
 * 也與 R2 lifecycle 月度節奏對齊（forensic 還原時月份 prefix 一抓即可）。
 *
 * 注意走 SQLite 文字格式（無 T/Z）避 SQLite ISO 比較陷阱（feedback_sqlite_iso_datetime_compare）。
 *
 * @param {Date} [now=new Date()]
 * @returns {string}  e.g. '2026-05-01 00:00:00'
 */
export function cutoffMonthStartUTC(now = new Date()) {
  const y = now.getUTCFullYear()
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0')
  return `${y}-${m}-01 00:00:00`
}

// Chunk 切片條件 — 與 PR 2.x 一致；aggregate row 量極小，實務上整月 1 chunk 已夠
// 但保留上限作 OOM 防護（極端情境下 telemetry bucket 撐到上限）
export const CHUNK_MAX_ROWS  = 10_000
export const CHUNK_MAX_BYTES = 5_000_000

/**
 * 把一批 audit_log_aggregate_telemetry row 序列化成 newline-delimited JSON。
 * 欄位 key order 固定 → sha256 deterministic（idempotent key 必要條件）。
 *
 * 不含 archived_at（archive 時必為 NULL；UPDATE 標記完才填）。
 * cold_class 含進來（值是 'aggregate_telemetry'，per-table 常數；R2 forensic 對帳用）。
 */
export function telemetryRowsToJsonl(rows) {
  let out = ''
  for (const r of rows) {
    const obj = {
      id:          r.id,
      event_type:  r.event_type,
      user_id:     r.user_id ?? null,
      severity:    r.severity,
      hour_bucket: r.hour_bucket,
      count:       r.count,
      ip_hash_top: r.ip_hash_top ?? null,
      cold_class:  r.cold_class,
      created_at:  r.created_at,
    }
    out += JSON.stringify(obj) + '\n'
  }
  return out
}

/**
 * 把一批 audit_log_aggregate_debug row 序列化成 newline-delimited JSON。
 *
 * samples_json 是 PR 3.1 allowlist sample shape 已 stringify 的 TEXT 欄；
 * 直接以原字串 round-trip parse 後嵌入 — 不再 re-stringify，避雙重 escape。
 * 若 stored 不是合法 JSON（理論上不可能；PR 3.1 emit 點受 dictionary 雙閘）→
 * 仍寫入原字串作 forensic（用 raw_samples_json 欄）。
 */
export function debugRowsToJsonl(rows) {
  let out = ''
  for (const r of rows) {
    let samples = null
    let rawSamples = null
    if (r.samples_json) {
      try { samples = JSON.parse(r.samples_json) }
      catch { rawSamples = r.samples_json }
    }
    const obj = {
      id:           r.id,
      event_type:   r.event_type,
      reason_code:  r.reason_code ?? null,
      hour_bucket:  r.hour_bucket,
      total_count:  r.total_count,
      sample_count: r.sample_count,
      samples:      samples,
      raw_samples_json: rawSamples,
      sampled:      r.sampled,
      cold_class:   r.cold_class,
      created_at:   r.created_at,
    }
    out += JSON.stringify(obj) + '\n'
  }
  return out
}

/**
 * 算 aggregate archive 的 R2 prefix。
 *
 * data 段以 cold_class 為單位獨立 prefix（與 audit_log archive 的「共用 audit-log
 * + 多 cold_class 子段」不同）— 這對應 docs/AUDIT_RETENTION_PLAN.md R2 lock 設計：
 *   audit-log-aggregate-telemetry/{env}/... → 1y lock
 *   audit-log-aggregate-debug/{env}/...     → 1y lock
 *
 * manifest 走共用 `manifest/{env}/{table_name}/...` 段（與 audit_log archive 同 prefix
 * scheme；docs lock 也對應 `manifest/prod/audit_log_aggregate_{telemetry,debug}/`）。
 *
 * dry-run：data prefix 加 `-dryrun` 後綴；manifest 用 `manifest-dryrun`（與 PR 2.x 對齊）。
 *
 * @param {boolean} dryRun
 * @param {string}  coldClass  'aggregate_telemetry' | 'aggregate_debug'
 * @returns {{ data: string, manifest: string }}
 */
export function aggregatePrefixes(dryRun, coldClass) {
  const variant = coldClass === 'aggregate_telemetry' ? 'telemetry' : 'debug'
  if (dryRun) {
    return {
      data:     `audit-log-aggregate-${variant}-dryrun`,
      manifest: 'manifest-dryrun',
    }
  }
  return {
    data:     `audit-log-aggregate-${variant}`,
    manifest: 'manifest',
  }
}

/**
 * 算 aggregate chunk 的 data / manifest R2 key。
 *
 * 格式：
 *   {data-prefix}/{env}/{yyyy}/{mm}/{dd}/{min}-{max}-{sha}{ext}
 *   {manifest-prefix}/{env}/{table_name}/{yyyy}/{mm}/{dd}/{min}-{max}-{sha}.json
 *
 * 注意：data key 不再嵌 table_name / cold_class 段（prefix 已隱含）；manifest key 走
 * 與 PR 2.x 對齊的「{env}/{table_name}」段。
 *
 * @returns {{ dataKey: string, manifestKey: string, archiveDate: string }}
 */
export function buildAggregateChunkKeys({
  env, tableName, coldClass, minId, maxId, sha256, archiveDate, dryRun, compression = 'gzip',
}) {
  const [yyyy, mm, dd] = archiveDate.split('-')
  const tail = `${minId}-${maxId}-${sha256}`
  const { data, manifest } = aggregatePrefixes(dryRun, coldClass)
  const ext = compression === 'gzip' ? '.jsonl.gz' : '.jsonl'
  return {
    dataKey:     `${data}/${env}/${yyyy}/${mm}/${dd}/${tail}${ext}`,
    manifestKey: `${manifest}/${env}/${tableName}/${yyyy}/${mm}/${dd}/${tail}.json`,
    archiveDate,
  }
}

/**
 * 從 audit_archive_chunks row 反推 aggregate chunk 的 data/manifest key（recovery 路徑用）。
 *
 * 與 audit-archive.js `deriveKeysFromChunk` 同設計：dry_run / compression 都由 row 自身帶，
 * 不吃當前 env flag（PR 4 flip dry_run 後 state 升級用的 key 仍對齊當初 PUT 的 prefix）。
 */
export function deriveAggregateKeysFromChunk(row) {
  return buildAggregateChunkKeys({
    env:         row.env,
    tableName:   row.table_name,
    coldClass:   row.cold_class,
    minId:       row.min_id,
    maxId:       row.max_id,
    sha256:      row.chunk_sha256,
    archiveDate: row.archive_date,
    dryRun:      row.dry_run === 1 || row.dry_run === true,
    compression: row.compression ?? 'gzip',
  })
}

/**
 * 組 aggregate chunk manifest JSON。
 *
 * 與 audit-archive.js buildManifest 結構大致相同，但：
 *   - 無 severities reduce（aggregate 表沒 severity 欄；telemetry 有但已是 bucket 計數）
 *   - 多 row_kind 欄區分 telemetry / debug（forensic 可一眼判別 schema）
 *   - cold_class_version 仍保留欄位，aggregate 表不走 classify 故設 1 常數（未來保留升級空間）
 */
export function buildAggregateManifest({
  env, tableName, coldClass, runId, state, stateHistory,
  rowCount, minId, maxId, minTs, maxTs, sha256Jsonl,
  dryRun, dataKey, compression, sha256Gz, rowKind,
}) {
  return {
    schema_version:     ARCHIVE_SCHEMA_VERSION,
    env,
    table:              tableName,
    cold_class:         coldClass,
    cold_class_version: 1,
    row_kind:           rowKind,                  // 'aggregate_telemetry' | 'aggregate_debug'
    run_id:             runId,
    chunk_id:           dataKey,
    state,
    state_history:      stateHistory,
    row_count:          rowCount,
    min_id:             minId,
    max_id:             maxId,
    min_ts:             minTs,
    max_ts:             maxTs,
    sha256_jsonl:       sha256Jsonl,
    sha256_gz:          sha256Gz ?? null,
    compression:        compression ?? 'gzip',
    writer:             AGGREGATE_WRITER,
    writer_version:     AGGREGATE_WRITER_VERSION,
    dry_run:            dryRun === true,
  }
}

/**
 * 切 chunk — 依 CHUNK_MAX_ROWS / CHUNK_MAX_BYTES。rows 預設按 id ASC 排序、輸入時保證。
 *
 * 回傳 { chunks: [{rows, minId, maxId, jsonl, byteLen}, ...] }。
 * byteLen 用 jsonl UTF-8 byte 計（CompressionStream 在 worker 端跑時實算的單位）。
 *
 * 純函式 / 可單測。worker 端依結果 sequential 跑 gzip+PUT+chunks INSERT。
 */
export function splitIntoChunks(rows, toJsonl, opts = {}) {
  const maxRows  = opts.maxRows  ?? CHUNK_MAX_ROWS
  const maxBytes = opts.maxBytes ?? CHUNK_MAX_BYTES
  const chunks = []
  let buf = []
  let bufBytes = 0
  const flush = () => {
    if (buf.length === 0) return
    const jsonl = toJsonl(buf)
    chunks.push({
      rows:   buf,
      minId:  buf[0].id,
      maxId:  buf[buf.length - 1].id,
      jsonl,
      byteLen: new TextEncoder().encode(jsonl).length,
    })
    buf = []
    bufBytes = 0
  }
  for (const r of rows) {
    // 用 single-row JSONL bytes 估累加大小（多算 newline，保守）
    const rowJson = toJsonl([r])
    const rowBytes = new TextEncoder().encode(rowJson).length
    if (buf.length > 0 && (buf.length >= maxRows || bufBytes + rowBytes > maxBytes)) {
      flush()
    }
    buf.push(r)
    bufBytes += rowBytes
  }
  flush()
  return { chunks }
}
