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
 *   本檔與 functions/api/admin/cron/audit-archive.ts 路徑下，
 *   **禁止** 出現 env.AUDIT_ARCHIVE_BUCKET.delete( 任何形式。
 *   scripts/lint-archive-no-delete.js 會在 CI/build 時掃；違者 build fail。
 *   任何 R2 物件刪除走 admin 獨立 endpoint + 多重審核，不在此 codepath。
 */

import { classifyForCold } from './audit-policy'

// purgeChunk pre-condition guard errors — local typing only, not a shared error class
// (codex PR-4/PR-5 r1: minimal blast radius; callers catch by e.code string)
interface ChunkPurgeError extends Error {
  code?: string
  actualState?: string
}

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

// ── PR 0.2c-pre-1a：write-once R2 manifest key（lock-compat refactor）─────────
//
// 背景：PR 0.2c R2 retention lock 上線後，R2 同 key 不再可覆寫（lock 同時擋
// DELETE 與同 key PUT）。legacy 單 manifest key 路徑下，cron worker 對單一
// chunk 生命週期把同一個 manifest key PUT 3-4 次（planned → uploaded →
// verified → marked_archived），lock 後第 2 次起整條 pipeline 卡住。
//
// 修法：每個 state 寫到自己的 manifest key（永遠 first PUT）。
//
//   key_scheme=1（legacy）：{tail}.json 單 key — 保留處理 PR 2.0 既有 dry-run
//                          telemetry chunk（在 dryrun prefix 不受 lock 影響）
//   key_scheme=2（write-once）：{tail}.planned.json / .uploaded.json /
//                              .verified.json / .marked_archived.json
//
// 跨層 state 字串一致原則：DB chunks.state / R2 manifest key suffix / audit
// event payload 全用同一字串（marked_archived 不縮 marked）；見
// feedback_state_machine_naming_no_alias。
export const KEY_SCHEME_LEGACY     = 1 as const
export const KEY_SCHEME_WRITE_ONCE = 2 as const
export type KeyScheme = typeof KEY_SCHEME_LEGACY | typeof KEY_SCHEME_WRITE_ONCE

// 4 個有 manifest 寫入動作的 state（chunks.state 同名）。
// purged / cold_copied / failed / blacklisted 不寫新 manifest，不在此 list。
export const MANIFEST_STATE_FILES = Object.freeze([
  'planned',
  'uploaded',
  'verified',
  'marked_archived',
])
export type ManifestStateFile = (typeof MANIFEST_STATE_FILES)[number]

// key_scheme=2 chunk 對 ManifestStateFile 算副檔名；keyScheme=1 走單 .json。
// keyScheme=2 必帶 manifestState — 否則 caller 用法不對，throw 立即暴露。
function manifestSuffix(manifestState: ManifestStateFile | undefined, keyScheme: number): string {
  if (keyScheme === KEY_SCHEME_WRITE_ONCE) {
    if (!manifestState) {
      throw new Error(`audit-archive: manifestState required when keyScheme=${KEY_SCHEME_WRITE_ONCE}`)
    }
    if (!MANIFEST_STATE_FILES.includes(manifestState)) {
      throw new Error(`audit-archive: unknown manifestState '${manifestState}'`)
    }
    return `.${manifestState}.json`
  }
  return '.json'
}

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
 * 算 chunk data key + manifest key（design doc §「Key 命名」）。
 *
 * 格式：
 *   {data-prefix}/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{min}-{max}-{sha}{ext}
 *   {manifest-prefix}/{env}/{table}/{cold_class}/{yyyy}/{mm}/{dd}/{min}-{max}-{sha}{manifestSuffix}
 *
 * PR 2.1b：data 副檔名依 compression 分支 — 'gzip' → '.jsonl.gz'、'none' → '.jsonl'。
 *
 * PR 0.2c-pre-1a：manifest 副檔名依 keyScheme 分支：
 *   - keyScheme=1（legacy）：'.json' 單 key（caller 不必傳 manifestState）
 *   - keyScheme=2（write-once）：'.{manifestState}.json'，每 state 寫到自己的 key
 *     （manifestState 必填，throw on missing；見 manifestSuffix() 的 invariant）
 *
 * compression 預設 'gzip'（PR 2.1b 起新 chunk 預設值）；keyScheme 預設 LEGACY 保持
 * 既有 caller 行為不變。recovery 路徑由 deriveKeysFromChunk 從 row.compression /
 * row.key_scheme 反推，確保 PR 2.0 既有 chunk + PR 1a 之後的 write-once chunk 都對。
 *
 * chunk_sha256 仍是 decompressed jsonl 的 sha（data identity），與 manifestState
 * 無關 — data key 寫一次，manifest key 才依 state 分支。
 *
 * @param {object} opts
 * @returns {{ dataKey: string, manifestKey: string, archiveDate: string }}
 */
export function buildChunkKeys({
  env, tableName, coldClass, minId, maxId, sha256, archiveDate, dryRun,
  compression = 'gzip',
  keyScheme = KEY_SCHEME_LEGACY,
  manifestState,
}: {
  env: string, tableName: string, coldClass: string,
  minId: number, maxId: number, sha256: string, archiveDate: string, dryRun: boolean,
  compression?: string,
  keyScheme?: number,
  manifestState?: ManifestStateFile,
}) {
  const [yyyy, mm, dd] = archiveDate.split('-')
  const tail = `${minId}-${maxId}-${sha256}`
  const { data, manifest } = archivePrefixes(dryRun)
  const ext = archiveExtension(compression)
  return {
    dataKey:     `${data}/${env}/${tableName}/${coldClass}/${yyyy}/${mm}/${dd}/${tail}${ext}`,
    manifestKey: `${manifest}/${env}/${tableName}/${coldClass}/${yyyy}/${mm}/${dd}/${tail}${manifestSuffix(manifestState, keyScheme)}`,
    archiveDate,
  }
}

/**
 * 從 chunks row 算 data key — 與 manifestState 無關，per chunk 固定 1 key。
 * PR 0.2c-pre-1a 抽出當獨立 helper：handler 在「需要 dataKey 但不確定要哪個
 * manifestState」的場景（如 R2 HEAD pre-check 過 data 是否已寫）不必同時帶
 * manifestState 進 deriveKeysFromChunk。
 */
export function deriveDataKey(row): string {
  const dryRun = row.dry_run === 1 || row.dry_run === true
  const compression = row.compression ?? 'none'
  const { data } = archivePrefixes(dryRun)
  const ext = archiveExtension(compression)
  const [yyyy, mm, dd] = String(row.archive_date).split('-')
  const tail = `${row.min_id}-${row.max_id}-${row.chunk_sha256}`
  return `${data}/${row.env}/${row.table_name}/${row.cold_class}/${yyyy}/${mm}/${dd}/${tail}${ext}`
}

/**
 * 從 chunks row 算 manifest key（state-aware）。
 *
 * - keyScheme=1（row.key_scheme=1 或缺欄）：回 legacy 單 .json key，manifestState 忽略
 * - keyScheme=2：必帶 manifestState；回 .{state}.json
 *
 * 不在這裡偷帶 fallback state，否則 caller 用法不對會 silent 寫去錯 key。
 */
export function deriveManifestKey(row, manifestState?: ManifestStateFile): string {
  const dryRun = row.dry_run === 1 || row.dry_run === true
  const keyScheme = Number(row.key_scheme ?? KEY_SCHEME_LEGACY)
  const { manifest } = archivePrefixes(dryRun)
  const [yyyy, mm, dd] = String(row.archive_date).split('-')
  const tail = `${row.min_id}-${row.max_id}-${row.chunk_sha256}`
  const suffix = manifestSuffix(
    keyScheme === KEY_SCHEME_WRITE_ONCE ? manifestState : undefined,
    keyScheme,
  )
  return `${manifest}/${row.env}/${row.table_name}/${row.cold_class}/${yyyy}/${mm}/${dd}/${tail}${suffix}`
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
 * PR 0.2c-pre-1a：key_scheme 同邏輯由 row 自帶（migration 0046 DEFAULT 1）；
 * opts.manifestState 給 key_scheme=2 用，key_scheme=1 會被忽略；key_scheme=2
 * 且 manifestState 缺 → manifestSuffix() throw。
 *
 * row 必須含：env, table_name, cold_class, archive_date, min_id, max_id,
 * chunk_sha256, dry_run（0039）、compression（0041）、key_scheme（0046）。
 */
export function deriveKeysFromChunk(row, opts: { manifestState?: ManifestStateFile } = {}) {
  const keyScheme = Number(row.key_scheme ?? KEY_SCHEME_LEGACY)
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
    keyScheme,
    manifestState: keyScheme === KEY_SCHEME_WRITE_ONCE ? opts.manifestState : undefined,
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
 * R2 lock-error detector — PR 0.2c-pre-1a 保守版 + PR 0.2c-pre-1b spike tighten
 *                          + PR 0.2c-pre-1b.2 Worker binding shape extend。
 *
 * 用途：putWithRetry 命中 lock error 時必須**不 retry**（lock 是永久性，retry
 * 浪費 21s wallclock + 多刷一輪 upload_failed audit event），並由呼叫端 emit
 * audit.archive.r2_lock_detected critical。**不可把 error 視為成功** — 仍 throw
 * 讓 chunk 進 failed state，admin 用 retry endpoint 介入。
 *
 * PR 0.2c-pre-1b spike (docs/fixtures/r2-lock-spike-2026-05-23.json) — S3 sigv4 path：
 *   - R2 retention lock **真的 enforce**（與 0.2a smoke 結論相反 — 0.2a 用 owner/
 *     wrangler 可能 bypass；用 limited token via S3 sigv4 lock 擋住 PUT-overwrite +
 *     DELETE 都回 409；PUT new key 在 locked prefix 仍 200 → write-once design 成立）
 *   - 實測 error shape：HTTP 409 + XML body {Code:'ObjectLockedByBucketPolicy',
 *     Message:'The object is locked by the bucket policy.'}
 *
 * PR 0.2c-pre-1b.1 binding canary (docs/fixtures/r2-lock-binding-canary-2026-05-24.json)
 *   — Worker R2 binding path（prod cron 實際走的路徑）：
 *   - Binding also enforces same-key overwrite + DELETE（write-once design 同樣成立）
 *   - **但 error shape 顯著不同於 S3 path**：
 *       name='Error'（generic）/ code=null / status=null / cause=null
 *       message='{op}: The object is locked by the bucket policy. (10069)'
 *     ↓
 *     1b spike-tightened classifier 三路全漏判（fast-path 無 code / dual 無 status /
 *     cause null）— PR 0.2c-pre-1b.1 gate outcome (b) 點明的 critical gap。
 *
 * PR 0.2c-pre-1b.2 (本檔) extend — 加 path (2) 高信心 message-pattern：
 *   - canonical phrase /locked by the bucket policy/i 兩 path 都有（S3 XML Message
 *     field + binding Error.message 同字串），fixture 凍結；命中即 true，無需 status
 *   - 內嵌 numeric code 10069（Cloudflare R2 internal code "Object locked by bucket
 *     policy"，binding 在 message 尾巴附 "(10069)"）— 雙保險，若未來 Cloudflare 改
 *     phrase wording 仍可由 numeric code 接住
 *   - 與 path (1) 對等信心：fast-path 是 S3 string code、path (2) 是 binding message
 *     pattern；兩條互不取代、互為 belt-and-suspenders
 *
 * False-positive 控制：
 *   - canonical phrase "locked by the bucket policy" 是 Cloudflare R2 lock-error 專屬
 *     wording，非 R2 lock 場景幾乎不會自然出現此字串
 *   - 本函式只在 putWithRetry / archive worker 上下文呼叫，error 來源限定 R2 binding
 *     / S3 fetch — 不會被任意 user input 字串污染
 *   - 既有 negative tests "object is locked" / "internal lock failure" / "forbidden by
 *     lock policy" 因不含完整 canonical phrase，仍為 false（pre-extend baseline 不破）
 *
 * 整體三層信心架構：
 *   1. 高信心 fast-path (string code)：R2_LOCK_KNOWN_CODES，跨 candidate 任一 hit
 *   2. 高信心 message-pattern (新)：canonical phrase 或 R2_LOCK_KNOWN_NUMERIC_CODES
 *   3. Fallback dual condition：status (409/412) AND marker，逐 candidate 判斷
 *      ⚠️ codex r1 P2 (PR 1b)：不可跨 outer/cause 合併 hit
 *
 * 加新 code / phrase / numeric code 紀律：必同步加 fixture + unit test
 * （[[feedback_r2_lock_overwrite_design]]：isR2LockError 不可猜）。
 *
 * 相關 memory：feedback_r2_lock_overwrite_design；feedback_r2_lock_propagation_canary。
 */

// PR 0.2c-pre-1b spike fixture-frozen high-confidence S3 lock codes（真實命中過）。
// 加新 code 必同步加 fixture 加 unit test；不可單獨 hard-code（[[feedback_r2_lock_overwrite_design]]）。
const R2_LOCK_KNOWN_CODES = new Set(['ObjectLockedByBucketPolicy'])

// PR 0.2c-pre-1b.1 binding canary fixture-frozen high-confidence canonical phrase（兩
// path 都含此字串）。比 R2_LOCK_MARKER 更具體 — marker 是寬泛詞彙 union（需 status 配合
// 才算），canonical phrase 是 Cloudflare R2 lock-error 專屬 wording（無需 status 配合）。
const R2_LOCK_CANONICAL_PHRASE = /locked by the bucket policy/i

// PR 0.2c-pre-1b.1 binding canary fixture-frozen Cloudflare R2 internal numeric error
// code（binding 在 message 尾巴附 "(10069)"）。獨立於 R2_LOCK_KNOWN_CODES（string 版）
// 避免 type 混淆；加新 numeric code 必同步加 fixture + unit test。
const R2_LOCK_KNOWN_NUMERIC_CODES = new Set([10069])

const R2_LOCK_MARKER = /(?:lock|locked|retention|immutable|objectlocked|object\s*locked)/i

export function isR2LockError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false

  // Nested cause 鏈：worker binding throw 可能包 wrapped Error；走一層 cause 收 nested 路徑。
  // 不無限遞迴（防 cyclic / 過深；fixture 顯示 R2 S3 是平的，binding 預期最多一層 wrap）。
  const candidates: Record<string, unknown>[] = [e as Record<string, unknown>]
  const cause = (e as { cause?: unknown }).cause
  if (cause && typeof cause === 'object') candidates.push(cause as Record<string, unknown>)

  // (1) 高信心 fast-path (string code)：fixture 凍結的 S3 lock code 直接 true，不必驗 status
  for (const c of candidates) {
    const code = c.code
    if (typeof code === 'string' && R2_LOCK_KNOWN_CODES.has(code)) return true
  }

  // (2) PR 1b.2 高信心 message-pattern：Worker binding 路徑無 code/status/cause，唯一
  //     signal 是 message 內的 canonical phrase + 尾巴 "(10069)" 數字。跨 candidate
  //     任一 hit 即 true，與 (1) 對等不需 status 配合。
  for (const c of candidates) {
    const msg = c.message
    if (typeof msg === 'string' && R2_LOCK_CANONICAL_PHRASE.test(msg)) return true
    // 已 surfaced 的 structured numeric code 欄位（future-proof 若 binding 之後改 expose）
    const codeNum = c.code
    if ((typeof codeNum === 'number' || typeof codeNum === 'string')
        && R2_LOCK_KNOWN_NUMERIC_CODES.has(Number(codeNum))) return true
    // 從 message 尾巴 "(<digits>)" 解析（current binding shape）
    if (typeof msg === 'string') {
      const m = msg.match(/\((\d+)\)\s*$/)
      if (m && m[1] != null && R2_LOCK_KNOWN_NUMERIC_CODES.has(Number(m[1]))) return true
    }
  }

  // (3) Fallback dual condition：status AND marker 兩條件並存，**逐 candidate 判斷**
  //     codex r1 P2 (PR 1b)：不可跨 outer/cause 合併 hit（之前用全域 flag 把 outer.marker
  //     + cause.409 加總會誤判，例：outer message 含 "locked" log 字樣 + cause 是
  //     ConditionalRequestConflict 409 → 不是 lock 卻被當 lock）
  for (const c of candidates) {
    const rawStatus = c.status ?? c.httpStatus ?? c.statusCode
    const status = Number(rawStatus)
    const statusHit = (status === 409 || status === 412)
    if (!statusHit) continue   // 此 candidate status 不符 → 不可能命中（即便 marker 命中也不算）
    let markerHit = false
    for (const k of ['message', 'code', 'name'] as const) {
      const v = c[k]
      if (typeof v === 'string' && R2_LOCK_MARKER.test(v)) { markerHit = true; break }
    }
    if (markerHit) return true
  }
  return false
}

/**
 * 包 bucket.put 加 exponential backoff retry。
 *
 * 每次 attempt 失敗會呼叫 onAttemptFailed callback；呼叫端（cron handler）
 * 在 callback 內 emit audit.archive.upload_failed：
 *   - willRetry=true  → severity='warn'
 *   - willRetry=false → severity='critical'（已是最後一次 attempt）
 *
 * PR 0.2c-pre-1a：opts.isLockError 注入（預設 isR2LockError）。命中 lock：
 *   - willRetry 立即降 false（不 retry、不 sleep、立刻 throw）
 *   - callback info 帶 lockDetected=true 給呼叫端額外 emit r2_lock_detected critical
 *   - 仍 throw lastError，不吞錯（feedback_stepup_atomic_consume 的「不可 fail-open」原則）
 *
 * 為了單元測試可注入：
 *   - opts.backoffMs：覆寫 backoff schedule（預設 [1000, 4000, 16000]）
 *   - opts.sleep   ：覆寫 sleep 函式（預設 setTimeout）
 *   - opts.onAttemptFailed：失敗時 callback（async OK）
 *   - opts.isLockError：覆寫 lock 偵測器（預設 isR2LockError；測試可注入 stub）
 *
 * 三次 backoff（1s/4s/16s）= 4 次 attempt 機會 = 累計最多 21s wait。Pages Functions
 * wallclock 在 await 期間不算 CPU，不會撞 30s 上限。
 */
export async function putWithRetry(bucket, key, body, putOpts, opts: {
  backoffMs?: number[],
  sleep?: (_ms: number) => Promise<void>,
  onAttemptFailed?: (_info: { attempt: number; error: unknown; willRetry: boolean; nextDelayMs: number | null; key: string; lockDetected: boolean }) => void | Promise<void>,
  isLockError?: (_e: unknown) => boolean,
} = {}) {
  const backoff = opts.backoffMs ?? DEFAULT_PUT_RETRY_BACKOFF_MS
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const onAttemptFailed = opts.onAttemptFailed
  const isLock = opts.isLockError ?? isR2LockError
  const maxAttempts = backoff.length + 1
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await bucket.put(key, body, putOpts) // archive-put-allow: putWithRetry 是唯一合法 bare bucket.put site（PR 2.2c r1 per-kind tag）
    } catch (e) {
      lastError = e
      // PR 0.2c-pre-1a：lock-error 不 retry — lock 是永久性，多等不會解除
      const lockDetected = isLock(e)
      const willRetry = !lockDetected && attempt < maxAttempts
      const nextDelayMs = willRetry ? backoff[attempt - 1] : null
      if (onAttemptFailed) {
        try {
          await onAttemptFailed({ attempt, error: e, willRetry, nextDelayMs, key, lockDetected })
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

  // 1) 從 D1 撈 chunk row，取 dry_run / compression / key_scheme 反推 R2 key（與
  //    retry.ts 的 target 不必含這些欄位 — 那是 server side schema 細節）
  const row = await db.prepare(
    `SELECT env, table_name, cold_class, archive_date,
            min_id, max_id, chunk_sha256, state, dry_run, compression, key_scheme
       FROM audit_archive_chunks
      WHERE env = ? AND table_name = ? AND cold_class = ?
        AND archive_date = ? AND min_id = ? AND max_id = ? AND chunk_sha256 = ?`
  ).bind(
    target.env, target.table_name, target.cold_class,
    target.archive_date, target.min_id, target.max_id, target.chunk_sha256,
  ).first()

  if (!row) {
    const e = new Error('chunk_not_found') as ChunkPurgeError
    e.code = 'CHUNK_NOT_FOUND'
    throw e
  }
  if (row.state !== 'blacklisted') {
    const e = new Error(`chunk_state_must_be_blacklisted; got '${row.state}'`) as ChunkPurgeError
    e.code = 'CHUNK_STATE_MISMATCH'
    e.actualState = row.state
    throw e
  }

  const dataKey = deriveDataKey(row)
  const keyScheme = Number(row.key_scheme ?? KEY_SCHEME_LEGACY)

  // PR 0.2c-pre-1a：依 key_scheme 決定要 DELETE 幾把 manifest key。
  //   key_scheme=1（legacy）：單 .json
  //   key_scheme=2（write-once）：4 把（.planned / .uploaded / .verified /
  //                              .marked_archived .json）— 一律 best-effort DELETE
  //                              （missing 為 no-op）
  // primary manifest_key 回傳挑「最後一態」對齊舊行為直覺：legacy = .json，
  // write-once = .marked_archived.json（若 chunk 走完整 pipeline 寫過）。
  const manifestKeys: string[] = keyScheme === KEY_SCHEME_WRITE_ONCE
    ? MANIFEST_STATE_FILES.map(s => deriveManifestKey(row, s as ManifestStateFile))
    : [deriveManifestKey(row)]

  // 2) R2 chunk DELETE（missing-key 為 no-op，propagate 其他 SDK exception）
  //    waiver tag 必須同行（lint per-line scan，scripts/_archive-lint-patterns.js#isWaived）
  await bucket.delete(dataKey) // archive-delete-allow: PR 2.3 force_purge chunk object
  // 3) R2 manifest DELETE — write-once chunk 走 4 把 key 全刪
  for (const mk of manifestKeys) {
    await bucket.delete(mk) // archive-delete-allow: PR 2.3 force_purge manifest object
  }

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
    // primary manifest_key（key_scheme=2 → .marked_archived.json；legacy → .json）；
    // 全集走 manifest_keys 給 admin / forensic
    manifest_key:        manifestKeys[manifestKeys.length - 1],
    manifest_keys:       manifestKeys,
  }
}
