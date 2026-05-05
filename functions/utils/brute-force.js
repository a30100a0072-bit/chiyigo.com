/**
 * Phase E-4 — Brute force protection 強化
 *
 * 兩個防護機制（搭配 E3 既有 5/IP/min 限流，三層防 + 慢速 / 快速 / 跨帳號）：
 *
 *  1. 同 user 漸進 cooldown（getUserCooldownSeconds）
 *     利用既有 login_attempts 表（kind='login', email=?）的失敗計數，套階梯式延遲。
 *     login.js 密碼正確時會 DELETE 該 email 的 login_attempts，所以「count」自動就是
 *     「自上次成功登入以來的失敗次數」。
 *
 *  2. 同 IP 跨 user → 24hr 黑名單（detectAndBlacklistCrossUserScan / isIpBlacklisted）
 *     1 hour 視窗內同 IP 撞 ≥10 個不同 email = credential stuffing 樣態，
 *     寫入 ip_blacklist 24hr。E3 的 5/IP/min 攔不到「攻擊者每分鐘換 email 撞」場景。
 *
 * 設計：
 *   - 都用 D1，不引 KV（同 E3 理由：QPS 低 + 一致性需求精確）
 *   - cooldown 階梯倍增但有上限（避免單 user 帳號永久鎖死）
 *   - blacklist 寫入時用 INSERT...ON CONFLICT 累加 hit_count（同 IP 多次達標時）
 */

const COOLDOWN_LADDER = [
  // [failCount >=, cooldownSeconds]
  [3,  5],
  [5,  30],
  [7,  300],   // 5 min
  [10, 3600],  // 1 hr (sustained brute force)
]
const COOLDOWN_WINDOW_MIN = 30  // 計算「最近失敗次數」的視窗

const SCAN_DISTINCT_EMAIL_THRESHOLD = 10
const SCAN_WINDOW_HOURS             = 1
const BLACKLIST_TTL_HOURS           = 24

/**
 * 算這個 email 目前還要等多少秒才能再嘗試。0 = 可立即嘗試。
 *
 * 邏輯：
 *   1. count = 最近 30min 失敗次數（login.js 成功時清空，所以這 = 自上次成功以來）
 *   2. 套階梯找對應 cooldown
 *   3. 比較「上次失敗時間 + cooldown」與 NOW，回傳剩餘秒數
 */
export async function getUserCooldownSeconds(db, email) {
  if (!email) return 0
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt, MAX(created_at) AS last_at
         FROM login_attempts
        WHERE kind = 'login' AND email = ?
          AND created_at > datetime('now', ?)`,
    )
    .bind(email, `-${COOLDOWN_WINDOW_MIN} minutes`)
    .first()

  const count = Number(row?.cnt ?? 0)
  if (count < COOLDOWN_LADDER[0][0]) return 0

  // 找最高吻合的 cooldown（陣列已升序）
  let cooldown = 0
  for (const [threshold, seconds] of COOLDOWN_LADDER) {
    if (count >= threshold) cooldown = seconds
  }
  if (cooldown === 0) return 0

  const lastAt = row.last_at  // 'YYYY-MM-DD HH:MM:SS' UTC
  if (!lastAt) return 0
  const lastMs = Date.parse(lastAt.replace(' ', 'T') + 'Z')
  if (Number.isNaN(lastMs)) return 0
  const elapsedSec = Math.floor((Date.now() - lastMs) / 1000)
  const remaining  = cooldown - elapsedSec
  return remaining > 0 ? remaining : 0
}

/**
 * IP 是否在黑名單（且未過期）。
 * @returns {Promise<{ blocked: true, expires_at: string, reason: string } | null>}
 */
export async function isIpBlacklisted(db, ip) {
  if (!ip) return null
  const row = await db
    .prepare(
      `SELECT reason, expires_at FROM ip_blacklist
        WHERE ip = ? AND expires_at > datetime('now')`,
    )
    .bind(ip)
    .first()
  if (!row) return null
  // hit_count 增加（fire and forget，不擋）
  db.prepare(`UPDATE ip_blacklist SET hit_count = hit_count + 1 WHERE ip = ?`)
    .bind(ip).run().catch(() => { /* swallow */ })
  return { blocked: true, expires_at: row.expires_at, reason: row.reason }
}

/**
 * 偵測 + 寫入黑名單。caller 在密碼驗證失敗、record 完 login_attempts 後 call。
 * 命中（distinct email ≥ 10 in 1hr）→ INSERT (or UPDATE expires) → 回 true。
 * 未命中 → 回 false。
 */
export async function detectAndBlacklistCrossUserScan(db, ip) {
  if (!ip) return false
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT email) AS n
         FROM login_attempts
        WHERE kind = 'login' AND ip = ? AND email IS NOT NULL
          AND created_at > datetime('now', ?)`,
    )
    .bind(ip, `-${SCAN_WINDOW_HOURS} hours`)
    .first()

  const distinctEmails = Number(row?.n ?? 0)
  if (distinctEmails < SCAN_DISTINCT_EMAIL_THRESHOLD) return false

  const expiresAt = new Date(Date.now() + BLACKLIST_TTL_HOURS * 3600 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  // ON CONFLICT：同 IP 已在黑名單則延長 expires_at + reason 累加
  await db
    .prepare(
      `INSERT INTO ip_blacklist (ip, reason, expires_at)
         VALUES (?, 'cross_user_scan', ?)
       ON CONFLICT(ip) DO UPDATE
         SET expires_at = ?,
             reason     = ip_blacklist.reason || ',cross_user_scan',
             blocked_at = datetime('now')`,
    )
    .bind(ip, expiresAt, expiresAt)
    .run()

  return true
}

// 測試 / debug 用
export const _internal = {
  COOLDOWN_LADDER,
  COOLDOWN_WINDOW_MIN,
  SCAN_DISTINCT_EMAIL_THRESHOLD,
  SCAN_WINDOW_HOURS,
  BLACKLIST_TTL_HOURS,
}
