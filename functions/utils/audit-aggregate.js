/**
 * F-3 Phase 2 PR 3.0 — Audit aggregate helpers (telemetry-only skeleton)
 *
 * 角色：把 hot 過期前 24h 的 `audit_log` telemetry row 合併成
 * `audit_log_aggregate_telemetry` bucket（per `(event_type, user_id, severity,
 * hour_bucket)`）。bucket UNIQUE index 在 migration 0038 已備（codex round-11
 * M/L-3：COALESCE(user_id,-1) sentinel），確保 worker crash/retry 雙寫 idempotent。
 *
 * PR 3.0 範圍（user 2026-05-12 拍板）：
 *   - 只 telemetry（design doc §「Aggregate 規則」）；debug_failure 走 PR 3.1
 *   - 觸發 cutoff = hot retention - 24h（design doc §「Aggregate 觸發點」）
 *   - **raw row 不刪**：archive worker 接管 hot 過期後的 R2 冷存 + mark/purge；
 *     PR 4 才做 raw deletion。PR 3.0 的 idempotency 靠重新 reduce + UPSERT。
 *   - 不寫 R2：aggregate 表自身的 cold archive 走 PR 3.2
 *
 * 為何不靠 D1 GROUP BY 直接寫：
 *   - `ip_hash_top` = 同 bucket 內出現最多次的 ip_hash，原生 SQL 表達需要兩段
 *     query + window function（D1 不全支援）。在 worker 端 JS reduce 簡單且
 *     測試友善；同時順帶處理 hour_bucket 對齊 `YYYY-MM-DDTHH:00:00Z` 字串。
 *   - LIMIT 大量 row 後在 JS 反算 count 對 1 ~ 10 萬 row 等級足夠快；prod
 *     telemetry 量目前 ~50 row / 月（events admin.read.rate_limited /
 *     auth.login.rate_limited / oauth.token.rate_limited / oauth.backchannel.dispatch
 *     等），PR 3.0 不會撞 worker CPU 上限。萬一超過 MAX_ROWS_PER_RUN 直接 skip
 *     等人介入。
 *
 * 🔴 與 archive worker 的 timing 關係（避免雙寫競態）：
 *   - aggregate cutoff = `now - (hotDays - 1) days`（hot 過期前 24h）
 *   - archive worker fresh pipeline 撈 `created_at < now - hotDays days`
 *   - 兩條 cutoff 之間有 24h 緩衝；同一 row 在 aggregate 寫進 bucket 後，
 *     24h 後才會被 archive worker 撈進 R2。中間若 cron 異常 backlog 兩條 cutoff
 *     重疊 → aggregate UPSERT 仍 idempotent（count 重算來自 raw row，archive
 *     state 機與 aggregate 互不影響）。
 */

import { classifyForCold } from './audit-policy.js'

export const AGGREGATE_WRITER         = 'cron-aggregate-worker'
export const AGGREGATE_WRITER_VERSION = '3.0.0-pr3.0-telemetry'

// PR 3.0：只動 telemetry cold_class。SUPPORTED_COLD_CLASSES_AGGREGATE 提供給
// PR 3.1+ expand 時做 forward-compat hook（debug_failure 走另一表，schema 不同
// 不能直接共用 round-robin，但 cron handler 跳派時可以參考 list）。
export const PR30_SUPPORTED_COLD_CLASS = 'telemetry'

// design doc §「Aggregate 觸發點」：hot 過期前 24h
export const AGGREGATE_LEAD_HOURS_DEFAULT = 24

// 安全上限：單輪 cron 最多 reduce 多少 raw row。超過直接 skip 等人介入
// （prod telemetry 量級 << 1000 / 月，預設 50_000 已是高估）。
const MAX_ROWS_PER_RUN_DEFAULT = 50_000

export function parseMaxRowsPerRun(env) {
  const raw = env?.AUDIT_AGGREGATE_MAX_ROWS_PER_RUN
  if (raw == null || raw === '') return MAX_ROWS_PER_RUN_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n)) return MAX_ROWS_PER_RUN_DEFAULT
  if (n < 1) return 1
  return Math.floor(n)
}

export function parseLeadHours(env) {
  const raw = env?.AUDIT_AGGREGATE_LEAD_HOURS
  if (raw == null || raw === '') return AGGREGATE_LEAD_HOURS_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return AGGREGATE_LEAD_HOURS_DEFAULT
  return n
}

/**
 * 算 hour_bucket 字串：把 timestamp 對齊到當前小時（UTC）。
 * 結果格式 `YYYY-MM-DDTHH:00:00Z` — 對齊 design doc 範例與 unique index 規範。
 *
 * 支援輸入：
 *   - SQLite 預設 datetime() 格式 `'YYYY-MM-DD HH:MM:SS'`（空白分隔、無 TZ）
 *   - ISO 8601 `'YYYY-MM-DDTHH:MM:SS[.sss]Z'`
 *   - Date instance
 *
 * 🔴 codex r1 M-1 修正（2026-05-12）：SQLite datetime() 預設儲存無 TZ；JS
 * `new Date('2026-05-12 03:15:00')` 會被當 **local time** parse（如 Asia/Taipei
 * +08：toISOString() 變 `'2026-05-11T19:15:00Z'`），bucket 偏 8 小時。Workers
 * runtime 預設 UTC 無此問題，但 Node 整合測試 / 本機 Pages dev 會中招。
 * 規範化為 UTC 'T...Z' 後再 parse 避坑。
 */
export function hourBucket(input) {
  let v = input
  if (typeof v === 'string') {
    // SQLite '2026-05-12 03:15:00' → '2026-05-12T03:15:00Z'
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v)) {
      v = v.replace(' ', 'T')
    }
    // 補 Z 給沒帶 TZ 的 ISO（有 +HH:MM / -HH:MM / Z 都不動）
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

/**
 * 算 telemetry aggregate cutoff timestamp（ISO，含 ms）。
 *   cutoff = now - (hotDays - leadHours/24) days
 * = 把 hot 過期時間往前推 leadHours（design doc 24h）
 *
 * 例：hotDays=30、leadHours=24 → cutoff = now - 29 days。
 * 邊界：hotDays<=0（"不設下限"，PR 2.0 既有 telemetry env 行為）→ 回 null
 * 表示「不要 aggregate」，呼叫端應 skip。
 *
 * 注意：cutoff 不對齊整點 — 與 archive worker 的「<= now - hotDays days」
 * 邊界保留 24h 緩衝；對齊整點的 bucket 寫入靠 hourBucket() 處理。
 */
export function telemetryCutoffISO(hotDays, leadHours = AGGREGATE_LEAD_HOURS_DEFAULT, now = new Date()) {
  if (!Number.isFinite(hotDays) || hotDays <= 0) return null
  if (!Number.isFinite(leadHours)) return null
  const leadMs = leadHours * 3600 * 1000
  const hotMs = hotDays * 86400 * 1000
  const cutoffMs = now.getTime() - hotMs + leadMs
  // codex r1 L-1：1e308 級 finite hotDays 乘 ms 後 overflow → Infinity → Date 炸 RangeError；
  //               同樣保護 -Infinity / NaN 從異常 leadHours 傳出。
  if (!Number.isFinite(cutoffMs)) return null
  return new Date(cutoffMs).toISOString()
}

/**
 * 算 SQL-side cutoff 用的整數小時數（hotDays * 24 - leadHours）。
 *
 * 整數內嵌進 `datetime('now', '-N hours')` template literal（與 archive worker
 * 模式一致避開 JS↔SQLite 格式比較坑，見 feedback_sqlite_iso_datetime_compare）。
 *
 * codex r1 L-1：clamp 到 [0, 100年] 防 Infinity / NaN 內嵌 SQL；
 *               下限 0 = 表示「無 lead，aggregate 直到 now」（不該發生但保 fallback）。
 */
export const MAX_TOTAL_HOURS = 100 * 365 * 24  // 100 年
const MAX_HOT_DAYS = 100 * 365                  // 對齊 100 年

// 將 number clamp 到 [0, max]；NaN / 非數字 → 0
function clampNonNeg(n, max) {
  if (typeof n !== 'number' || Number.isNaN(n) || n < 0) return 0
  if (n > max) return max
  return n
}
export function totalCutoffHours(hotDays, leadHours) {
  const safeHot  = clampNonNeg(hotDays,  MAX_HOT_DAYS)
  const safeLead = clampNonNeg(leadHours, MAX_TOTAL_HOURS)
  const raw = Math.round(safeHot * 24 - safeLead)
  if (raw < 0) return 0
  if (raw > MAX_TOTAL_HOURS) return MAX_TOTAL_HOURS
  return raw
}

/**
 * 把 raw rows reduce 成 telemetry bucket Map。
 *
 * Bucket key = `${event_type}|${user_id ?? -1}|${severity}|${hour_bucket}` —
 * 與 migration 0038 `uniq_agg_tele_bucket` 索引欄位（含 COALESCE(user_id,-1)
 * sentinel）一一對應，確保 worker 重跑等同 UPSERT。
 *
 * 每 bucket 計算 ip_hash_top：bucket 內 ip_hash 出現次數最多者；同票取字典序
 * 較小（deterministic，方便測試 + forensic 重現）；ip_hash 全 NULL → null。
 *
 * @param {{ event_type, user_id, severity, ip_hash, created_at }[]} rows
 * @returns {Map<string, {
 *   event_type: string, user_id: number|null, severity: string,
 *   hour_bucket: string, count: number, ip_hash_top: string|null,
 *   _ip_hashes: Map<string, number>  // internal — caller 不該依賴
 * }>}
 */
export function reduceTelemetryBuckets(rows) {
  const buckets = new Map()
  for (const r of rows) {
    const userId = r.user_id ?? null
    const userKey = userId == null ? -1 : userId
    const hb = hourBucket(r.created_at)
    const key = `${r.event_type}|${userKey}|${r.severity}|${hb}`
    let b = buckets.get(key)
    if (!b) {
      b = {
        event_type: r.event_type,
        user_id: userId,
        severity: r.severity,
        hour_bucket: hb,
        count: 0,
        ip_hash_top: null,
        _ip_hashes: new Map(),
      }
      buckets.set(key, b)
    }
    b.count++
    const ip = r.ip_hash ?? null
    if (ip != null) {
      b._ip_hashes.set(ip, (b._ip_hashes.get(ip) ?? 0) + 1)
    }
  }
  // 結算 ip_hash_top（同票取字典序較小）
  for (const b of buckets.values()) {
    let topHash = null
    let topCount = -1
    for (const [ip, c] of b._ip_hashes) {
      if (c > topCount || (c === topCount && (topHash == null || ip < topHash))) {
        topHash = ip
        topCount = c
      }
    }
    b.ip_hash_top = topHash
    // codex r1 L：清掉內部 reduce 用的暫存，避免 caller serialize / log bucket 時帶出去
    delete b._ip_hashes
  }
  return buckets
}

/**
 * 驗 raw row 在當前 audit-policy 下仍 classify 為 telemetry。
 * 與 audit-archive.rowMatchesColdClass 同 pattern，避免 policy drift 把
 * 不該進 telemetry aggregate 的 row 混進去。
 */
export function rowIsTelemetry(row) {
  return classifyForCold(row.event_type, row.severity) === 'telemetry'
}
