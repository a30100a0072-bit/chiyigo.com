/**
 * F-3 Phase 2 — Audit cold-archive helpers
 *
 * PR 2.1b（2026-05-12）：compression='gzip' 預設啟用。
 *   - 改用 Workers 原生 CompressionStream（gzip）— 0 deps / 0 WASM；platform API
 *     不公開 level（black box），manifest 標 'gzip' 不標 level。
 *   - R2 key 副檔名 .jsonl.gz；R2 PUT 帶 httpMetadata.contentEncoding='gzip'。
 *   - chunks 表加 compression 欄（migration 0041）；deriveKeysFromChunk 讀 row.compression
 *     決定副檔名 → PR 2.0 既有 dry-run uploaded chunk（compression='none'）續走原
 *     .jsonl 路徑直到 verified。
 *   - chunk_sha256 仍是「decompressed jsonl」的 sha256（data identity，R2 key 也用，
 *     必須 deterministic；gzip 含 mtime 非 byte-identical）；manifest.sha256_gz 是
 *     forensic-only 補充欄。
 *   - 為何不 zstd：spike 後選型決定 — 量級不撐 WASM 維護成本，gzip 是 platform 原生
 *     fast path + 跨工具友善；詳 docs/AUDIT_RETENTION_PLAN.md PR 2.1b 段。
 *
 * 範圍歷史（PR 2.0）：
 *   - 僅 audit_log / cold_class='telemetry'（PR 2.2a expand 到 6 class round-robin）
 *   - 僅 planned → uploaded 兩態（PR 2.1 起含 verified / marked_archived）
 *   - Stop-on-non-terminal cursor 從 PR 2.0 就強制（design doc 「Cursor 定義」段）
 *   - DRY_RUN 時 key prefix 走 audit-log-dryrun/，不寫進正式 cold_class prefix
 *
 * 🔴 no-delete discipline（design doc v11 §「PR 2 archive worker 必須加的 code discipline」）
 *   本檔與 functions/api/admin/cron/audit-archive.js 路徑下，
 *   **禁止** 出現 env.AUDIT_ARCHIVE_BUCKET.delete( 任何形式。
 *   scripts/lint-archive-no-delete.js 會在 CI/build 時掃；違者 build fail。
 *   任何 R2 物件刪除走 admin 獨立 endpoint + 多重審核，不在此 codepath。
 */

import { classifyForCold } from './audit-policy'

export const ARCHIVE_SCHEMA_VERSION = '2.0'
export const ARCHIVE_WRITER         = 'cron-archive-worker'
export const ARCHIVE_WRITER_VERSION = '2.1.0-pr2.1b-gzip'

// PR 2.0 範圍：只跑 telemetry；PR 2.2a 起 expand 到 6 cold_class round-robin
// PR20_SUPPORTED_TABLE 仍是 'audit_log'（admin_audit_log 留 PR 3 月度 copy 路徑）
export const PR20_SUPPORTED_TABLE       = 'audit_log'
// PR 2.2a deprecated 但保留 export — 任何剩餘 import 不破；新程式碼用 SUPPORTED_COLD_CLASSES
export const PR20_SUPPORTED_COLD_CLASS  = 'telemetry'

// PR 2.2a：6 cold_class round-robin 順序固定 — round-robin 公平性 + 測試/forensic 可重現
// 順序刻意把 immutable / security_critical 排前面（金融級資料先進冷存防 D1 暴漲時被擠掉）
export const SUPPORTED_COLD_CLASSES = Object.freeze([
  'immutable',
  'security_critical',
  'security_warn',
  'read_audit',
  'telemetry',
  'debug_failure',
])

// PR 2.2a：per-class hot retention 預設（design doc §「Retention Matrix」）
// 設計值 immutable / security_* / read_audit = 180d；telemetry = 90d；debug_failure = 30-90d。
// 注意 telemetry 預設 30 (= 既有 AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS 預設) — 與 prod 部署一致，
// 不在 PR 2.2a 改 prod 行為；要對齊 design 90d 留 ops 自己改 env。
const DEFAULT_HOT_DAYS_BY_CLASS = Object.freeze({
  immutable:          180,
  security_critical:  180,
  security_warn:      180,
  read_audit:         180,
  telemetry:          30,
  debug_failure:      90,
})

/**
 * 對指定 cold_class 取 hot retention 天數。env key 規則：
 *   - telemetry：相容既有 AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS（PR 2.0 起，prod 部署過）
 *   - 6 class 通用：AUDIT_ARCHIVE_HOT_DAYS_<COLD_CLASS_UPPER>
 *     例：AUDIT_ARCHIVE_HOT_DAYS_IMMUTABLE / _SECURITY_CRITICAL / _READ_AUDIT 等
 *   - 缺值 / 非有限數值 → 走 DEFAULT_HOT_DAYS_BY_CLASS
 *   - <=0：worker 解讀為「不設下限，撈所有未 archive row」（與 PR 2.0 行為一致）
 *
 * 回傳整數天數（>=0）。
 */
export function hotRetentionDaysFor(env, coldClass) {
  // back-compat：PR 2.0 起 telemetry 一直走 AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS
  if (coldClass === 'telemetry' && env?.AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS != null) {
    const v = Number(env.AUDIT_ARCHIVE_TELEMETRY_HOT_DAYS)
    if (Number.isFinite(v)) return v
  }
  const key = `AUDIT_ARCHIVE_HOT_DAYS_${coldClass.toUpperCase()}`
  const raw = env?.[key]
  if (raw != null && raw !== '') {
    const v = Number(raw)
    if (Number.isFinite(v)) return v
  }
  return DEFAULT_HOT_DAYS_BY_CLASS[coldClass] ?? 0
}

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
 * SHA-256 hex of a string (UTF-8) or raw Uint8Array.
 * Web Crypto SubtleCrypto — Workers / Pages runtime 原生支援。
 *
 * PR 2.1b：接受 Uint8Array → 給 manifest.sha256_gz 用（壓縮後 bytes 算 sha）。
 */
export async function sha256Hex(input) {
  const buf = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const arr = new Uint8Array(digest)
  let hex = ''
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0')
  return hex
}

/**
 * gzip 壓縮（Workers 原生 CompressionStream）。
 *
 * 接受 string（UTF-8 encode）或 Uint8Array → 回 Uint8Array of gzip bytes。
 * 注意：CompressionStream API 不暴露 compression level；platform 內部選擇
 * （Cloudflare runtime 估約 level 6）；manifest 因此標 'gzip' 不標 level。
 */
export async function gzipCompress(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * gzip 解壓（Workers 原生 DecompressionStream）。
 * 接受 Uint8Array（gz bytes）→ 回 Uint8Array of decompressed bytes。
 */
export async function gzipDecompress(input) {
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * 依 chunk 寫入時的 compression 決定 R2 key 副檔名。
 * PR 2.0 既有 chunk → 'none' → '.jsonl'；PR 2.1b 起新 chunk → 'gzip' → '.jsonl.gz'。
 */
export function archiveExtension(compression) {
  return compression === 'gzip' ? '.jsonl.gz' : '.jsonl'
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
 *   {data-prefix}/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{min}-{max}-{sha}{ext}
 *   {manifest-prefix}/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{min}-{max}-{sha}.json
 *
 * PR 2.1b：副檔名依 compression 分支 — 'gzip' → '.jsonl.gz'、'none' → '.jsonl'。
 * compression 預設 'gzip'（PR 2.1b 起新 chunk 預設值）；recovery 路徑由
 * deriveKeysFromChunk 從 row.compression 反推，確保 PR 2.0 既有 .jsonl chunk
 * 仍走原路徑。chunk_sha256 仍是 decompressed jsonl 的 sha（data identity）。
 *
 * @param {object} opts
 * @returns {{ dataKey: string, manifestKey: string, archiveDate: string }}
 */
export function buildChunkKeys({ env, tableName, coldClass, minId, maxId, sha256, archiveDate, dryRun, compression = 'gzip' }) {
  const [yyyy, mm, dd] = archiveDate.split('-')
  const tail = `${minId}-${maxId}-${sha256}`
  const { data, manifest } = archivePrefixes(dryRun)
  const ext = archiveExtension(compression)
  return {
    dataKey:     `${data}/${env}/${tableName}/${coldClass}/${yyyy}/${mm}/${dd}/${tail}${ext}`,
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
 * PR 2.1b：compression 同邏輯由 row 自己帶（migration 0041 DEFAULT 'none'）→
 * PR 2.0 既有 .jsonl chunk 與 PR 2.1b 後 .jsonl.gz chunk 都能對到正確 key。
 *
 * row 必須含：env, table_name, cold_class, archive_date, min_id, max_id,
 * chunk_sha256, dry_run（0039）、compression（0041）。
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
    compression: row.compression ?? 'none',
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
 *
 * PR 2.1d（codex F-2）：severities 改吃外部 reduce 結果（{severity: count}）；
 * 未提供時 fallback 空物件，保留向下相容。
 *
 * PR 2.1b：compression 由 caller 顯式傳（'gzip' / 'none'）；sha256_gz 在 gzip
 * 路徑帶入壓縮後 bytes 的 sha256，none 路徑為 null。chunk_sha256（= sha256_jsonl）
 * 仍是 R2 key 與 idempotency 的 canonical identity。
 */
export function buildManifest({
  env, tableName, coldClass, coldClassVersion, runId, state, stateHistory,
  rowCount, minId, maxId, minTs, maxTs, sha256Jsonl,
  dryRun, dataKey, severities, compression, sha256Gz,
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
    sha256_gz:          sha256Gz ?? null,
    compression:        compression ?? 'gzip',
    severities:         severities ?? {},
    writer:             ARCHIVE_WRITER,
    writer_version:     ARCHIVE_WRITER_VERSION,
    dry_run:            dryRun === true,
  }
}

/**
 * 對 rows 做 severity 計數 reduce（design doc §「Manifest 結構」severities 段）。
 * 用在 fresh chunk pipeline 給 buildManifest；忽略 null/undefined severity（理論
 * 上不會有，audit_log.severity NOT NULL）。
 */
export function aggregateSeverities(rows) {
  const acc = {}
  for (const r of rows) {
    const s = r?.severity
    if (!s) continue
    acc[s] = (acc[s] ?? 0) + 1
  }
  return acc
}

// PR 2.1d（codex F-3）：R2 PUT 三段 exponential backoff（design doc §「R2 PUT retry」）
export const DEFAULT_PUT_RETRY_BACKOFF_MS = [1000, 4000, 16000]

/**
 * 包 bucket.put 加 exponential backoff retry。
 *
 * 每次 attempt 失敗會呼叫 onAttemptFailed callback；呼叫端（cron handler）
 * 在 callback 內 emit audit.archive.upload_failed：
 *   - willRetry=true  → severity='warn'
 *   - willRetry=false → severity='critical'（已是最後一次 attempt）
 *
 * 為了單元測試可注入：
 *   - opts.backoffMs：覆寫 backoff schedule（預設 [1000, 4000, 16000]）
 *   - opts.sleep   ：覆寫 sleep 函式（預設 setTimeout）
 *   - opts.onAttemptFailed：失敗時 callback（async OK）
 *
 * 三次 backoff（1s/4s/16s）= 4 次 attempt 機會 = 累計最多 21s wait。Pages Functions
 * wallclock 在 await 期間不算 CPU，不會撞 30s 上限。
 */
export async function putWithRetry(bucket, key, body, putOpts, opts = {}) {
  const backoff = opts.backoffMs ?? DEFAULT_PUT_RETRY_BACKOFF_MS
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const onAttemptFailed = opts.onAttemptFailed
  const maxAttempts = backoff.length + 1
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await bucket.put(key, body, putOpts) // archive-put-allow: putWithRetry 是唯一合法 bare bucket.put site（PR 2.2c r1 per-kind tag）
    } catch (e) {
      lastError = e
      const willRetry = attempt < maxAttempts
      const nextDelayMs = willRetry ? backoff[attempt - 1] : null
      if (onAttemptFailed) {
        try {
          await onAttemptFailed({ attempt, error: e, willRetry, nextDelayMs, key })
        } catch (callbackErr) {
          console.error('[putWithRetry] onAttemptFailed callback threw:', callbackErr)
        }
      }
      if (!willRetry) break
      await sleep(nextDelayMs)
    }
  }
  throw lastError
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

/**
 * F-3 Phase 2 PR 2.3 — manual force_purge helper（admin-driven，唯一合法的
 * R2 DELETE / chunks-row DELETE 入口；cron worker code 仍走 no-delete discipline）。
 *
 * 範圍（user 2026-05-12 拍板，feedback_force_purge_semantics）：
 *   ✅ R2 chunk object DELETE
 *   ✅ R2 manifest object DELETE
 *   ✅ D1 audit_archive_chunks row DELETE（state='blacklisted' guard）
 *   ❌ audit_log raw row 不刪 — 屬 PR 4 marked_archived→7d→purged lifecycle
 *
 * 為何只接受 state='blacklisted'：
 *   force_purge 是 mark_resolved 的「真正清除」收尾。state machine 路徑為
 *   failed → mark_resolved → blacklisted → force_purge → row gone。
 *   讓 admin 從 uploaded / planned 等 in-flight state 直接 purge 太容易誤殺
 *   pipeline；要清這些先 mark_resolved。
 *
 * R2 lock 分支（PR 0.2c 之後啟用）：
 *   lock 設下後 R2 DELETE 會回 403/409。本 helper 把 R2 SDK 例外 propagate 出去，
 *   呼叫端 catch 後可 emit force_purge_failed + reason='r2_locked' 回 423。
 *   PR 2.3 不模擬 lock 邏輯（lock 尚未設）；lock 後再加 catch 分支 + 1 個 int test。
 *
 * 順序刻意：R2 chunk → R2 manifest → D1 row。前面失敗 → 中止、D1 row 留著，admin
 * 可重新呼叫；R2 DELETE missing key 是 no-op（idempotent），不會 propagate error。
 *
 * @param {object} args
 * @param {object} args.env                 Workers env（需 AUDIT_ARCHIVE_BUCKET）
 * @param {object} args.db                  D1 binding
 * @param {object} args.target              retry endpoint validateTarget 過的 target
 * @returns {Promise<{
 *   chunks_row_deleted: boolean,
 *   source_rows_deleted: false,
 *   data_key: string,
 *   manifest_key: string,
 * }>}
 * @throws Error                           R2 / D1 操作失敗（呼叫端轉 502 / 423）
 */
export async function purgeChunk({ env, db, target }) {
  const bucket = env?.AUDIT_ARCHIVE_BUCKET
  if (!bucket) throw new Error('AUDIT_ARCHIVE_BUCKET binding missing')

  // 1) 從 D1 撈 chunk row，取 dry_run / compression 反推 R2 key（與 retry.js 的
  //    target 不必含 dry_run / compression — 那是 server side schema 細節）
  const row = await db.prepare(
    `SELECT env, table_name, cold_class, archive_date,
            min_id, max_id, chunk_sha256, state, dry_run, compression
       FROM audit_archive_chunks
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(
    target.env, target.table_name, target.cold_class,
    target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
  ).first()

  if (!row) {
    const e = new Error('chunk_not_found')
    e.code = 'CHUNK_NOT_FOUND'
    throw e
  }
  if (row.state !== 'blacklisted') {
    const e = new Error(`chunk_state_must_be_blacklisted; got '${row.state}'`)
    e.code = 'CHUNK_STATE_MISMATCH'
    e.actualState = row.state
    throw e
  }

  const { dataKey, manifestKey } = deriveKeysFromChunk(row)

  // 2) R2 chunk DELETE（missing-key 為 no-op，propagate 其他 SDK exception）
  //    waiver tag 必須同行（lint per-line scan，scripts/_archive-lint-patterns.js#isWaived）
  await bucket.delete(dataKey) // archive-delete-allow: PR 2.3 force_purge chunk object
  // 3) R2 manifest DELETE
  await bucket.delete(manifestKey) // archive-delete-allow: PR 2.3 force_purge manifest object

  // 4) D1 chunks row DELETE — 嚴格 state='blacklisted' 再驗一次（race 防禦：上面
  //    SELECT 後若有 worker 升態，這裡 changes=0 就 abort，不污染 cursor 狀態）
  //    SQL waiver tag 必須在 match span 內（與下方 SQL 同一行；archive-sql-allow）
  const del = await db.prepare(
    `DELETE FROM audit_archive_chunks /* archive-sql-allow: PR 2.3 force_purge */
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?
        AND state = 'blacklisted'`
  ).bind(
    target.env, target.table_name, target.cold_class,
    target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
  ).run()

  const changes = del?.meta?.changes ?? 0
  return {
    chunks_row_deleted:  changes === 1,
    source_rows_deleted: false,
    data_key:            dataKey,
    manifest_key:        manifestKey,
  }
}
