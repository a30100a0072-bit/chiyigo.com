/**
 * KV cache helpers — Cloudflare KV namespace `CHIYIGO_KV`
 *
 * 設計：
 *   - KV 用作 read-heavy hot path 的快取，**不**用作 source of truth
 *   - source of truth 永遠是 D1 / Secrets
 *   - rate limit 不走 KV（既有 functions/utils/rate-limit.js 已決議走 D1，
 *     避免兩套一致性模型；本檔不重做 rate limit）
 *
 * 使用情境（Phase B 切流時接）：
 *   - JWKS 公鑰（驗 JWT 每次都讀 → KV cache 1h，避免重啟 isolate 多次 import）
 *   - revoked_jti 命中（驗 JWT 後查黑名單 → KV cache TTL = token 剩餘壽命）
 *   - oauth_clients lookup（authorize 比對 redirect_uri → KV cache 5min）
 *
 * Graceful degradation：
 *   - 若 KV binding 未設定（env.CHIYIGO_KV 為 undefined），所有函式靜默 fallback
 *     到「等同於 cache miss」行為（讀回 null、寫入 no-op），呼叫端應始終
 *     直接打 D1 / 真資料源時為正確路徑
 *
 * 為何不用 isolate-level Map cache：
 *   - Cloudflare Workers 的 isolate 是短暫的（無法保證命中）
 *   - 同一 user 的兩個請求極可能落到不同 isolate
 *   - KV 是真正的「跨 isolate 全球共享」cache，命中率高
 */

/**
 * 取 KV 值。Binding 未設或 miss → 回 null。
 * @param {KVNamespace|undefined} kv
 * @param {string} key
 * @returns {Promise<string|null>}
 */
export async function kvGet(kv, key) {
  if (!kv) return null
  try { return await kv.get(key) } catch { return null }
}

/**
 * 取 KV 值並 JSON.parse。失敗或 miss → 回 null。
 * @param {KVNamespace|undefined} kv
 * @param {string} key
 * @returns {Promise<unknown|null>}
 */
export async function kvGetJson(kv, key) {
  if (!kv) return null
  try { return await kv.get(key, 'json') } catch { return null }
}

/**
 * 寫入 KV。Binding 未設 → no-op。
 * @param {KVNamespace|undefined} kv
 * @param {string} key
 * @param {string|object} value object 會自動 JSON.stringify
 * @param {number} ttlSeconds  必須 ≥ 60（KV 規定）
 */
export async function kvSet(kv, key, value, ttlSeconds) {
  if (!kv) return
  if (ttlSeconds < 60) ttlSeconds = 60
  const v = typeof value === 'string' ? value : JSON.stringify(value)
  try { await kv.put(key, v, { expirationTtl: ttlSeconds }) } catch { /* never throw */ }
}

/**
 * 刪除 KV key。
 * @param {KVNamespace|undefined} kv
 * @param {string} key
 */
export async function kvDel(kv, key) {
  if (!kv) return
  try { await kv.delete(key) } catch { /* never throw */ }
}

/**
 * 標準化 cache key 命名，避免 namespace 衝突。
 *
 * 命名規則：`<domain>:<resource>:<id>`
 * 例：
 *   ck.jwks('active')        → 'jwks:active'
 *   ck.revoked(jti)          → 'revoked:<jti>'
 *   ck.client(client_id)     → 'oauth_client:<client_id>'
 *   ck.userMeta(sub)         → 'user_meta:<sub>'
 */
export const ck = {
  jwks:     (kid) => `jwks:${kid}`,
  revoked:  (jti) => `revoked:${jti}`,
  client:   (id)  => `oauth_client:${id}`,
  userMeta: (sub) => `user_meta:${sub}`,
}
