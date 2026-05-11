/**
 * F-3 Phase 2 PR 2.0 — Audit cold-archive helpers（dry-run scope）
 *
 * 範圍（PR 2.0）：
 *   - 僅 audit_log / cold_class='telemetry'
 *   - 僅 planned → uploaded 兩態（verified / marked_archived 留 PR 2.1）
 *   - Stop-on-non-terminal cursor 從 PR 2.0 就強制（design doc 「Cursor 定義」段）
 *   - 不壓縮（jsonl，非 jsonl.zst）；zstd 留 PR 2.1
 *   - DRY_RUN 時 key prefix 走 audit-log-dryrun/，不寫進正式 cold_class prefix
 *
 * 🔴 no-delete discipline（design doc v11 §「PR 2 archive worker 必須加的 code discipline」）
 *   本檔與 functions/api/admin/cron/audit-archive.js 路徑下，
 *   **禁止** 出現 env.AUDIT_ARCHIVE_BUCKET.delete( 任何形式。
 *   scripts/lint-archive-no-delete.js 會在 CI/build 時掃；違者 build fail。
 *   任何 R2 物件刪除走 admin 獨立 endpoint + 多重審核，不在此 codepath。
 */

import { classifyForCold } from './audit-policy.js'

export const ARCHIVE_SCHEMA_VERSION = '2.0'
export const ARCHIVE_WRITER         = 'cron-archive-worker'
export const ARCHIVE_WRITER_VERSION = '2.0.0-pr2.0-dryrun'

// PR 2.0 範圍：只跑 telemetry；PR 2.2 才會展開到 6 cold_class
export const PR20_SUPPORTED_TABLE       = 'audit_log'
export const PR20_SUPPORTED_COLD_CLASS  = 'telemetry'

// chunk 切片條件（design doc §「Chunk 切片條件」）
//   PR 2.0 暫不上 zstd；MAX_BYTES 以 decompressed jsonl 估，避開單檔過大
export const CHUNK_MAX_ROWS  = 10_000
export const CHUNK_MAX_BYTES = 5_000_000

// 終態集合（design doc §「Terminal state 對應」）
// audit_log → purged；admin_audit_log → cold_copied
const TERMINAL_STATES_BY_TABLE = {
  audit_log:       new Set(['purged']),
  admin_audit_log: new Set(['cold_copied']),
}
export function isChunkTerminal(tableName, state) {
  return TERMINAL_STATES_BY_TABLE[tableName]?.has(state) === true
}

// 升態前 non-terminal、會卡 cursor / month finalize 的 state（design doc CHECK 8 態）
//   planned / uploaded / verified / marked_archived → in-flight
//   failed / blacklisted                            → blocking failure
// 走到任一個都讓 worker 停下、不掃新範圍。
export const NON_TERMINAL_STATES = new Set([
  'planned', 'uploaded', 'verified', 'marked_archived',
  'failed',  'blacklisted',
])

/**
 * 算 cursor — design doc §「Cursor 定義」/「簡化規則」
 *
 * cursor = highest contiguous terminal prefix 的 max_id；無則 0。
 * 同時回傳第一個 non-terminal chunk（PR 2.0 worker 必須先處理它再掃新範圍）。
 *
 * @param {{ min_id:number, max_id:number, state:string }[]} chunksAscByMinId
 * @param {string} tableName
 * @returns {{ cursor: number, blocker: object | null }}
 */
export function computeCursorAndBlocker(chunksAscByMinId, tableName) {
  let cursor = 0
  for (const c of chunksAscByMinId) {
    if (isChunkTerminal(tableName, c.state)) {
      cursor = c.max_id
      continue
    }
    return { cursor, blocker: c }
  }
  return { cursor, blocker: null }
}

/**
 * 序列化一批 audit_log row 成 newline-delimited JSON。
 * 欄位明列、依固定順序 → 同資料 sha256 必一致（idempotent key 必要條件）。
 *
 * 不包含 archived_at（PR 2.0 寫入時必為 NULL；之後升 marked_archived 才會填）。
 *
 * @param {object[]} rows
 * @returns {string}  trailing newline
 */
export function rowsToJsonl(rows) {
  let out = ''
  for (const r of rows) {
    // 顯式 key order：序列化穩定 → sha256 deterministic
    const obj = {
      id:         r.id,
      event_type: r.event_type,
      severity:   r.severity,
      user_id:    r.user_id ?? null,
      client_id:  r.client_id ?? null,
      ip_hash:    r.ip_hash ?? null,
      event_data: r.event_data ?? null,
      cold_class: r.cold_class,
      created_at: r.created_at,
    }
    out += JSON.stringify(obj) + '\n'
  }
  return out
}

/**
 * SHA-256 hex of a string (UTF-8).
 * Web Crypto SubtleCrypto — Workers / Pages runtime 原生支援。
 */
export async function sha256Hex(s) {
  const buf = new TextEncoder().encode(s)
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const arr = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0')
  return hex
}

/**
 * 算 R2 key prefix。dry-run 走 audit-log-dryrun/，避免污染正式 prefix
 * （design doc Step 0.2c 註：「dry-run 沒寫進正式 cold_class prefix」）。
 *
 * 真實 prefix = 'audit-log'；dry-run prefix = 'audit-log-dryrun'。
 * Manifest key 共用一套 dry-run prefix 規則（用 'manifest' → 'manifest-dryrun'）。
 */
export function archivePrefixes(dryRun) {
  if (dryRun) {
    return { data: 'audit-log-dryrun', manifest: 'manifest-dryrun' }
  }
  return { data: 'audit-log', manifest: 'manifest' }
}

/**
 * 算 chunk key + manifest key（design doc §「Key 命名」）。
 *
 * 格式：
 *   {data-prefix}/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{min}-{max}-{sha}.jsonl
 *   {manifest-prefix}/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{min}-{max}-{sha}.json
 *
 * PR 2.0 不上 zstd → 副檔名 .jsonl（PR 2.1 加 zstd 時改 .jsonl.zst）。
 *
 * @param {object} opts
 * @returns {{ dataKey: string, manifestKey: string, archiveDate: string }}
 */
export function buildChunkKeys({ env, tableName, coldClass, minId, maxId, sha256, archiveDate, dryRun }) {
  const [yyyy, mm, dd] = archiveDate.split('-')
  const tail = `${minId}-${maxId}-${sha256}`
  const { data, manifest } = archivePrefixes(dryRun)
  return {
    dataKey:     `${data}/${env}/${tableName}/${coldClass}/${yyyy}/${mm}/${dd}/${tail}.jsonl`,
    manifestKey: `${manifest}/${env}/${tableName}/${coldClass}/${yyyy}/${mm}/${dd}/${tail}.json`,
    archiveDate,
  }
}

/**
 * 從 chunks row 反推 data/manifest key（recovery / verify 路徑會用）。
 *
 * PR 2.1c（codex H-1 修正）：dry_run 從 row 自身取，不再吃當前 env flag。
 * 這是 provenance 防呆 — chunk 在 PR 4 flip flag 後，state 升 marked_archived
 * 用的 key 仍對齊當初 PUT data 的 prefix（dryrun / live）。
 *
 * row 必須含：env, table_name, cold_class, archive_date, min_id, max_id,
 * chunk_sha256, dry_run（migration 0039 後 schema）。
 */
export function deriveKeysFromChunk(row) {
  return buildChunkKeys({
    env:         row.env,
    tableName:   row.table_name,
    coldClass:   row.cold_class,
    minId:       row.min_id,
    maxId:       row.max_id,
    sha256:      row.chunk_sha256,
    archiveDate: row.archive_date,
    dryRun:      row.dry_run === 1 || row.dry_run === true,
  })
}

/**
 * 升態時往 state_history append 一條紀錄。manifest 物件不就地改，回傳新物件
 * 以保留呼叫端的 immutability 假設（design doc §「Manifest 結構」state_history）。
 */
export function appendStateHistory(manifest, state, at) {
  return {
    ...manifest,
    state,
    state_history: [...(manifest.state_history ?? []), { state, at }],
  }
}

/**
 * 組 chunk manifest JSON（design doc §「Manifest 結構」）。
 * PR 2.0 不算 severities aggregation；留空物件即可（PR 2.1 補）。
 */
export function buildManifest({
  env, tableName, coldClass, coldClassVersion, runId, state, stateHistory,
  rowCount, minId, maxId, minTs, maxTs, sha256Jsonl,
  dryRun, dataKey,
}) {
  return {
    schema_version:     ARCHIVE_SCHEMA_VERSION,
    env,
    table:              tableName,
    cold_class:         coldClass,
    cold_class_version: coldClassVersion,
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
    sha256_zst:         null,            // PR 2.1 加 zstd 時填
    compression:        'none',          // PR 2.1 改 'zstd-19'
    severities:         {},              // PR 2.1 補摘要
    writer:             ARCHIVE_WRITER,
    writer_version:     ARCHIVE_WRITER_VERSION,
    dry_run:            dryRun === true, // PR 2.0 顯式記，方便 admin / audit 反查
  }
}

/**
 * Verify 一個 (eventType, severity) 在當前 audit-policy 下 cold_class 仍對得上 chunk 標的。
 * worker 撈到的 row 通過此檢查才會塞進當前 chunk；不對的不該被塞，留給對應 class 的下輪 chunk。
 */
export function rowMatchesColdClass(row, expected) {
  return classifyForCold(row.event_type, row.severity) === expected
}

/**
 * Pages Functions 沒有 ULID lib；run_id 用 crypto.randomUUID 也行（design doc 只說 ULID 是 metadata、
 * 不參與 idempotency）。前綴 'run-' 方便 grep。
 */
export function newRunId() {
  return `run-${crypto.randomUUID()}`
}

/**
 * YYYY-MM-DD（UTC）— archive_date 欄。
 */
export function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10)
}
