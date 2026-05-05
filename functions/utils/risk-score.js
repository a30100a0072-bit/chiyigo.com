/**
 * Phase E-2 — Risk-based authentication（評分模型）
 *
 * 評分 4 個 signal（fire-and-forget；任何 query 失敗回 score=0 不擋登入）：
 *   1. country change（+35）— vs 上次成功登入的 country（從 audit_log 撈）
 *   2. UA change（+20）       — vs 上次成功登入的 ua_hash（SHA-256 前 12 hex）
 *   3. 時段異常（+15）        — 跟 user 過去 5 次成功登入的小時相差 > 4hr
 *   4. 近期失敗（+10/次，最多 +30）— login_attempts 同 email 30min 內失敗數
 *
 * 觸發策略（caller 依 score 決定）：
 *   < 30：低風險，正常通過，audit data 寫 score + factors
 *   30–69：中風險，audit warn `auth.risk.medium`，仍通過（觀察期）
 *   ≥ 70：高風險，**deny 登入** + 寄 email + audit critical（→ Discord）
 *
 * 為什麼分數不更高觸發 lockout：
 *   - lockout 需要 admin 手動解鎖，誤判成本高（VPN + 換手機 + 半夜登 = 一發即中）
 *   - 暫時 deny 一次（含信通知）已能讓真實 attacker 走不下去；正常 user 看信
 *     就會收到提醒並重試（IP/時段恢復常態後 score 會降）
 *
 * 設計：
 *   - 不引 KV、不建表，全部走 D1
 *   - signal lookup 都帶超時（D1 query 慢時 fail-open，回 score=0 不擋登入）
 *   - 每個 signal 都帶具名 factor 字串（audit data 可分析誤報率）
 */

const TIME_TYPICAL_LOOKBACK = 5      // 撈 user 過去 5 次成功登入抓「典型小時」
const TIME_DIFF_THRESHOLD_HR = 4     // 跟典型小時最近差 > 4hr 算異常
const RECENT_FAIL_WINDOW_MIN = 30
const RECENT_FAIL_THRESHOLD  = 3

const SCORE_COUNTRY_CHANGE = 35
const SCORE_UA_CHANGE      = 20
const SCORE_TIME_ANOMALY   = 15
const SCORE_FAIL_PER_ATTEMPT = 10
const SCORE_FAIL_CAP         = 30

export const RISK_LEVEL_HIGH   = 70   // ≥ deny
export const RISK_LEVEL_MEDIUM = 30   // ≥ audit warn

/**
 * 用 SHA-256 hash UA，取前 12 hex 當識別。
 * 不是判 UA 完全相同（Chrome 升版會破），但對「換瀏覽器 / 換 OS / curl」夠靈敏。
 */
export async function hashUa(ua) {
  if (!ua) return null
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ua))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}

/**
 * 算 risk score。caller pattern:
 *
 *   const risk = await computeRiskScore(env, request, { userId, email })
 *   if (risk.score >= RISK_LEVEL_HIGH) → deny + email
 *   else if (risk.score >= RISK_LEVEL_MEDIUM) → audit warn
 *   else → 正常
 *
 * 永遠不 throw；任何 query 失敗回 { score: 0, factors: [], error }
 */
export async function computeRiskScore(env, request, { userId, email }) {
  const country = request?.cf?.country ?? null
  const ua      = request?.headers?.get('User-Agent') ?? ''
  const uaHash  = await hashUa(ua).catch(() => null)
  const hourUtc = new Date().getUTCHours()

  let score = 0
  const factors = []

  if (!env?.chiyigo_db || !userId) {
    return { score, factors, country, ua_hash: uaHash, hour_utc: hourUtc }
  }

  try {
    // 撈最近 5 筆 auth.login.success（自己 user_id）
    const rs = await env.chiyigo_db
      .prepare(
        `SELECT event_data, created_at FROM audit_log
          WHERE user_id = ? AND event_type = 'auth.login.success'
          ORDER BY id DESC LIMIT ?`,
      )
      .bind(userId, TIME_TYPICAL_LOOKBACK)
      .all()
    const recentLogins = (rs.results ?? []).map(r => {
      let data = {}
      try { data = JSON.parse(r.event_data ?? '{}') } catch {}
      let createdMs = NaN
      if (r.created_at) createdMs = Date.parse(r.created_at.replace(' ', 'T') + 'Z')
      return { ...data, created_at_ms: createdMs }
    })

    // 1. country change（看最新一筆）
    const lastCountry = recentLogins[0]?.country ?? null
    if (lastCountry && country && lastCountry !== country) {
      score += SCORE_COUNTRY_CHANGE
      factors.push('country_change')
    }

    // 2. UA change（看最新一筆 ua_hash）
    const lastUaHash = recentLogins[0]?.ua_hash ?? null
    if (lastUaHash && uaHash && lastUaHash !== uaHash) {
      score += SCORE_UA_CHANGE
      factors.push('ua_change')
    }

    // 3. 時段異常 — 過去 5 次的小時集合，看本次跟最近的小時相差多少
    const typicalHours = recentLogins
      .map(r => Number.isFinite(r.created_at_ms) ? new Date(r.created_at_ms).getUTCHours() : null)
      .filter(h => h !== null)
    if (typicalHours.length >= 3) {
      const minDist = Math.min(
        ...typicalHours.map(h => {
          const d = Math.abs(h - hourUtc)
          return Math.min(d, 24 - d)  // 環狀距離（11pm 與 1am 是 2hr）
        }),
      )
      if (minDist > TIME_DIFF_THRESHOLD_HR) {
        score += SCORE_TIME_ANOMALY
        factors.push('time_anomaly')
      }
    }

    // 4. 近期失敗（同 email 30min 內）
    if (email) {
      const failRow = await env.chiyigo_db
        .prepare(
          `SELECT COUNT(*) AS n FROM login_attempts
            WHERE kind = 'login' AND email = ?
              AND created_at > datetime('now', ?)`,
        )
        .bind(email, `-${RECENT_FAIL_WINDOW_MIN} minutes`)
        .first()
      const fails = Number(failRow?.n ?? 0)
      if (fails >= RECENT_FAIL_THRESHOLD) {
        score += Math.min(SCORE_FAIL_CAP, fails * SCORE_FAIL_PER_ATTEMPT)
        factors.push('recent_fails')
      }
    }
  } catch (e) {
    // fail-open：D1 query 失敗不擋登入；回 score=0 + error 標記
    return { score: 0, factors: [], country, ua_hash: uaHash, hour_utc: hourUtc, error: String(e?.message ?? e).slice(0, 80) }
  }

  return { score, factors, country, ua_hash: uaHash, hour_utc: hourUtc }
}

// 對外給 caller 一個 quick check 的 helper（不算分，只查 deny 與否）
export function shouldDenyByRisk(score) {
  return score >= RISK_LEVEL_HIGH
}

export function isRiskMedium(score) {
  return score >= RISK_LEVEL_MEDIUM && score < RISK_LEVEL_HIGH
}

// 測試 / debug 用
export const _internal = {
  TIME_TYPICAL_LOOKBACK,
  TIME_DIFF_THRESHOLD_HR,
  RECENT_FAIL_WINDOW_MIN,
  SCORE_COUNTRY_CHANGE,
  SCORE_UA_CHANGE,
  SCORE_TIME_ANOMALY,
  SCORE_FAIL_PER_ATTEMPT,
  SCORE_FAIL_CAP,
}

