/**
 * F-3 Phase 2 PR 3.1 — Audit aggregate helpers (debug_failure)
 *
 * 角色：把 hot 過期前 24h 的 `audit_log` debug_failure row 合併成
 * `audit_log_aggregate_debug` bucket（per `(event_type, reason_code, hour_bucket)`），
 * 同時保留 deterministic reservoir 採樣（N=10）讓 forensic 仍可看 raw event_data。
 *
 * 與 PR 3.0 telemetry aggregate 的差異：
 *   1. bucket key：用 `reason_code`（從 event_data JSON 抽出）取代 telemetry 的
 *      `(user_id, severity)`；debug_failure row 大多無 user 或 severity 變化大，
 *      reason_code 是真正可分群的維度。
 *   2. 多了 `samples_json`：N=10 deterministic reservoir，spike 後可回溯個別 raw row。
 *   3. `sampled` flag：total_count > sample_count 時 = 1，提醒 forensic 該 bucket
 *      不是完整資料、只有代表性樣本。
 *   4. 觸發 cutoff / cron 規則同 PR 3.0（hot 過期前 24h、daily UTC）— 維持兩 cron
 *      與 archive worker 的 timing 關係不變。
 *
 * 🔴 sampling 必須 deterministic（user 拍板）：
 *   priority = FNV-1a 32-bit hash(`${bucketKey}|${row.id}|${row.created_at}`)
 *   - 同一批 raw row 重跑 reduce → 相同 priority → 相同 samples_json
 *   - UPSERT idempotent：crash / cron 補跑不會漂移 samples_json
 *   - 比 Math.random() 更易測試 + 比 First-N / Latest-N 不被時間段 bias
 *   - 用 FNV-1a 32-bit（sync, 純 JS 整數）而非 SHA-256：reduce 函式維持 sync，
 *     32-bit 對 N=10 取樣分佈足夠均勻
 *
 * 🔴 與 archive worker / telemetry aggregate 的 timing 同 PR 3.0：
 *   aggregate cutoff = `now - (hotDays - 1) days`，archive = `now - hotDays days`，
 *   24h 緩衝；debug aggregate cron 排在 telemetry cron 後 15 分鐘（17:15 UTC）
 *   避開同時 D1 contention + audit event emission race。
 */

import { classifyForCold } from './audit-policy.js'

export const AGGREGATE_DEBUG_WRITER         = 'cron-aggregate-debug-worker'
export const AGGREGATE_DEBUG_WRITER_VERSION = '3.1.0-pr3.1-debug'

export const PR31_SUPPORTED_COLD_CLASS = 'debug_failure'

// design doc §「Aggregate 觸發點」：hot 過期前 24h（與 PR 3.0 對齊）
export const AGGREGATE_LEAD_HOURS_DEFAULT = 24

// 每 bucket 採樣上限（reservoir N=10，user 拍板）
export const SAMPLE_SIZE = 10

// 安全上限：單輪 cron 最多 reduce 多少 raw row。debug_failure 量級理應極小
// （prod 至今 ~15 row 總計）；50_000 是 PR 3.0 同上限，留同樣 headroom
const MAX_ROWS_PER_RUN_DEFAULT = 50_000

export function parseMaxRowsPerRun(env) {
  const raw = env?.AUDIT_AGGREGATE_DEBUG_MAX_ROWS_PER_RUN
  if (raw == null || raw === '') return MAX_ROWS_PER_RUN_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n)) return MAX_ROWS_PER_RUN_DEFAULT
  if (n < 1) return 1
  return Math.floor(n)
}

export function parseLeadHours(env) {
  const raw = env?.AUDIT_AGGREGATE_DEBUG_LEAD_HOURS
  if (raw == null || raw === '') return AGGREGATE_LEAD_HOURS_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return AGGREGATE_LEAD_HOURS_DEFAULT
  return n
}

/**
 * hour_bucket 規範化 — 與 PR 3.0 audit-aggregate.hourBucket 同行為。
 * 故意不直接 re-export 避免兩檔耦合；schema 不同（aggregate_debug 沒 ip_hash_top）
 * 但 hour_bucket 字串格式 spec 是 design doc 級的全域規範。
 *
 * 詳見 audit-aggregate.js#hourBucket 的 codex r1 M-1 修正（SQLite local TZ parse 坑）。
 */
export function hourBucket(input) {
  let v = input
  if (typeof v === 'string') {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v)) {
      v = v.replace(' ', 'T')
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(v)) {
      v = v + 'Z'
    }
  }
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) throw new Error(`hourBucket: invalid input ${input}`)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  const hh = String(d.getUTCHours()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}T${hh}:00:00Z`
}

/** debug aggregate cutoff（ISO，含 ms）— 與 PR 3.0 telemetryCutoffISO 同 spec。 */
export function debugCutoffISO(hotDays, leadHours = AGGREGATE_LEAD_HOURS_DEFAULT, now = new Date()) {
  if (!Number.isFinite(hotDays) || hotDays <= 0) return null
  if (!Number.isFinite(leadHours)) return null
  const leadMs = leadHours * 3600 * 1000
  const hotMs = hotDays * 86400 * 1000
  const cutoffMs = now.getTime() - hotMs + leadMs
  if (!Number.isFinite(cutoffMs)) return null
  return new Date(cutoffMs).toISOString()
}

export const MAX_TOTAL_HOURS = 100 * 365 * 24
const MAX_HOT_DAYS = 100 * 365

function clampNonNeg(n, max) {
  if (typeof n !== 'number' || Number.isNaN(n) || n < 0) return 0
  if (n > max) return max
  return n
}

/**
 * SQL-side cutoff 用整數小時數 — 與 PR 3.0 totalCutoffHours 同 spec。
 * 回傳 0 表示「呼叫端應 skip」（design 契約，見 PR 3.0 codex r3 L 段）。
 */
export function totalCutoffHours(hotDays, leadHours) {
  const safeHot  = clampNonNeg(hotDays,  MAX_HOT_DAYS)
  const safeLead = clampNonNeg(leadHours, MAX_TOTAL_HOURS)
  const raw = Math.round(safeHot * 24 - safeLead)
  if (raw < 0) return 0
  if (raw > MAX_TOTAL_HOURS) return MAX_TOTAL_HOURS
  return raw
}

/**
 * FNV-1a 32-bit hash（deterministic, sync, 純 JS 整數）。
 * 用 32-bit unsigned 模擬（>>> 0），避開 JS 數值精度落到 53-bit 後的奇異行為。
 * 對 N=10 取樣分佈足夠均勻；不用 SHA-256 是為了保持 reduce 函式 sync。
 *
 * @param {string} s
 * @returns {number} 0 ~ 2^32-1
 */
export function fnv1a32(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // FNV prime 16777619 — 用 Math.imul 避 32-bit overflow 失真
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** sample priority — 越小越優先進 reservoir（保留 top N 最小 priority）。 */
export function samplePriority(bucketKey, rowId, createdAt) {
  return fnv1a32(`${bucketKey}|${rowId}|${createdAt}`)
}

/**
 * 從 event_data（TEXT JSON）抽 reason_code。
 *
 * debug_failure 11 個事件名沒有統一 schema；但常見 emission pattern 會帶
 * `reason_code` / `code` / `reason` 任一。優先序固定如下，找到第一個非空字串即用。
 * 找不到 → null（schema 允許 NULL，UNIQUE 索引用 COALESCE('') sentinel 去重）。
 *
 * 解析失敗（JSON 壞 / 非物件）→ null，**不 throw**：debug aggregate 的目的是
 * 摘要 + 採樣，個別壞 row 不該阻擋整輪。raw row 本身的不完整透過 sampled flag
 * + samples_json 仍可被 forensic 追回。
 */
export function extractReasonCode(eventDataRaw) {
  if (eventDataRaw == null) return null
  let obj
  try {
    obj = typeof eventDataRaw === 'string' ? JSON.parse(eventDataRaw) : eventDataRaw
  } catch {
    return null
  }
  if (obj == null || typeof obj !== 'object') return null
  for (const k of ['reason_code', 'code', 'reason']) {
    const v = obj[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

/**
 * 把 raw rows reduce 成 debug_failure bucket Map。
 *
 * Bucket key = `${event_type}|${reason_code ?? ''}|${hour_bucket}` — 與 migration
 * 0038 `uniq_agg_debug_bucket` 索引欄位（COALESCE(reason_code,'') sentinel）對應，
 * 確保 worker 重跑等同 UPSERT。
 *
 * 採樣：deterministic FNV-1a reservoir top-N=10 by lowest priority。
 *   - 同一批 raw row 重跑 reduce → 相同 priority → 相同 samples（idempotent UPSERT）
 *   - 採樣只記 { id, created_at, severity, user_id, event_data }（含 raw event_data，
 *     forensic 用；caller 需確保 event_data 已通過 PII 過濾 — debug_failure 分類
 *     的 audit-policy 條目本身就有「嚴格避免 raw PII」要求）
 *   - total_count > SAMPLE_SIZE → sampled = 1
 *
 * @param {{ id, event_type, severity, user_id, ip_hash, event_data, created_at }[]} rows
 * @returns {Map<string, {
 *   event_type: string, reason_code: string|null, hour_bucket: string,
 *   total_count: number, sample_count: number, samples_json: string, sampled: 0|1
 * }>}
 */
export function reduceDebugBuckets(rows) {
  const buckets = new Map()
  for (const r of rows) {
    const reasonCode = extractReasonCode(r.event_data)
    const hb = hourBucket(r.created_at)
    const reasonKey = reasonCode ?? ''
    const key = `${r.event_type}|${reasonKey}|${hb}`
    let b = buckets.get(key)
    if (!b) {
      b = {
        event_type: r.event_type,
        reason_code: reasonCode,
        hour_bucket: hb,
        total_count: 0,
        // 內部欄位（最後結算 samples_json 前清掉）
        _samples: [],   // [{ priority, sample }, ...]
        _key: key,
      }
      buckets.set(key, b)
    }
    b.total_count++

    const sample = {
      id:         r.id,
      created_at: r.created_at,
      severity:   r.severity,
      user_id:    r.user_id ?? null,
      event_data: r.event_data ?? null,
    }
    const priority = samplePriority(key, r.id, r.created_at)

    if (b._samples.length < SAMPLE_SIZE) {
      b._samples.push({ priority, sample })
      continue
    }
    // 已滿：若新 priority < 當前 reservoir 最大者 → 替換最大
    let maxIdx = 0
    for (let i = 1; i < b._samples.length; i++) {
      if (b._samples[i].priority > b._samples[maxIdx].priority) maxIdx = i
    }
    if (priority < b._samples[maxIdx].priority) {
      b._samples[maxIdx] = { priority, sample }
    }
  }
  // 結算：samples_json 按 priority asc（deterministic 序）
  for (const b of buckets.values()) {
    b._samples.sort((a, b2) => a.priority - b2.priority)
    const samples = b._samples.map(x => x.sample)
    b.sample_count = samples.length
    b.samples_json = JSON.stringify(samples)
    b.sampled = b.total_count > b.sample_count ? 1 : 0
    delete b._samples
    delete b._key
  }
  return buckets
}

/** 驗 raw row 在當前 audit-policy 下仍 classify 為 debug_failure（drift fail-fast）。 */
export function rowIsDebugFailure(row) {
  return classifyForCold(row.event_type, row.severity) === 'debug_failure'
}
