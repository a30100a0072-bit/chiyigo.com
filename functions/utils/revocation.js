/**
 * Token revocation 檢查（Phase B / B2）
 *
 * 為什麼要做：
 *   現況 token_version（粗粒度全域 revoke）無法「只撤一張被竊 token」。
 *   jti 黑名單支援精準 revoke：admin / OIDC backchannel logout / RP logout 都能寫入。
 *
 * 行為：
 *   - 正向快取（positive cache）：KV 只存「已 revoke」狀態
 *     → KV hit '1' = 已 revoke，直接 401
 *     → KV miss = 不一定沒 revoke，要去 D1 確認
 *   - 不快取「未 revoke」：避免 admin revoke 後使用者要等 KV TTL 才生效
 *   - revoke 寫入時兩邊一起寫（D1 source of truth + KV 提速 hot path）
 *
 * 為什麼不用反向快取：
 *   反向快取要求 admin revoke 必須能即時 invalidate KV，邏輯複雜且失敗風險大；
 *   單存正向快取，hot path 一次 KV GET + D1 SELECT，不依賴 invalidation。
 */

const KV_PREFIX = 'revoked:'

/**
 * 查 jti 是否已 revoke。jti 缺值 / DB binding 缺 → 視為未 revoke（向後相容）。
 *
 * @param {object} env  Cloudflare env（CHIYIGO_KV optional / chiyigo_db required for source of truth）
 * @param {string} jti
 * @returns {Promise<boolean>}
 */
export async function isJtiRevoked(env, jti) {
  if (!jti || typeof jti !== 'string') return false

  // 1) KV 正向快取 hit → 直接 revoked
  if (env.CHIYIGO_KV) {
    try {
      const cached = await env.CHIYIGO_KV.get(KV_PREFIX + jti)
      if (cached === '1') return true
    } catch { /* KV 暫時失效不影響 D1 fallback */ }
  }

  // 2) D1 source of truth
  if (!env.chiyigo_db) return false
  const row = await env.chiyigo_db
    .prepare(`SELECT 1 FROM revoked_jti WHERE jti = ? AND expires_at > datetime('now') LIMIT 1`)
    .bind(jti)
    .first()
  return !!row
}

/**
 * 撤銷一張 token：D1 寫入 revoked_jti + KV 同步快取「已 revoke」。
 *
 * @param {object} env
 * @param {string} jti
 * @param {number} expSec  JWT 的 exp（epoch 秒），決定 KV TTL（過期 token 不需快取）
 */
export async function revokeJti(env, jti, expSec) {
  if (!jti || typeof jti !== 'string') return
  if (!env.chiyigo_db) throw new Error('chiyigo_db binding required for revoke')

  // expSec 缺值就用預設保留 1 小時（access_token 預設 15min）
  const nowSec = Math.floor(Date.now() / 1000)
  const ttlSec = Math.max(60, (Number.isFinite(expSec) ? expSec : nowSec + 3600) - nowSec)
  const expiresAt = new Date((nowSec + ttlSec) * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)

  await env.chiyigo_db
    .prepare(`INSERT OR IGNORE INTO revoked_jti (jti, expires_at) VALUES (?, ?)`)
    .bind(jti, expiresAt)
    .run()

  if (env.CHIYIGO_KV) {
    try {
      await env.CHIYIGO_KV.put(KV_PREFIX + jti, '1', { expirationTtl: ttlSec })
    } catch { /* KV 寫入失敗不影響 D1 紀錄；下次 hot path 仍會打 D1 確認 */ }
  }
}
