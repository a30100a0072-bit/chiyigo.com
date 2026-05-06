/**
 * JWT 金鑰管理與簽發工具（ES256 非對稱加密）
 *
 * 設計要點：
 *  - 私鑰只存在 IAM 端（chiyigo.com）。
 *  - 子系統透過 JWKS 端點 (/.well-known/jwks.json) 取得公鑰自行驗證。
 *  - 模組級快取：同一 Cloudflare V8 isolate 內金鑰 import 只執行一次。
 *  - 多 key 驗證能力（key rotation 預備）：
 *      JWT_PUBLIC_KEYS = '[{"kid":"k1",...},{"kid":"k2",...}]'  ← 陣列，第一筆為 active
 *      JWT_PUBLIC_KEY  = '{"kid":"k1",...}'                       ← 舊單把（向後相容）
 *      簽章端永遠用 JWT_PRIVATE_KEY 一把。
 *
 * Rotation 流程（未來啟用）：
 *  1. 在 JWT_PUBLIC_KEYS 加入新 kid（active 仍為舊 kid）
 *  2. 等 JWKS 端點 max-age 過期，子系統都讀到新陣列（含新舊兩把）
 *  3. 切換 JWT_PRIVATE_KEY + 把新 kid 移到陣列首位
 *  4. 等所有舊 token 過期（≤ 7 天 refresh TTL）後從陣列移除舊 kid
 *
 * 環境變數（Cloudflare Pages / .dev.vars）：
 *  JWT_PRIVATE_KEY   — JWK JSON 字串（active 簽章金鑰；僅 IAM 持有）
 *  JWT_PUBLIC_KEYS   — JWK JSON 陣列字串（驗章用，多把並存）
 *  JWT_PUBLIC_KEY    — JWK JSON 字串（向後相容，等同單元素陣列）
 *
 * 生成金鑰對：
 *  node scripts/generate-jwt-keys.mjs
 */

import { SignJWT, importJWK, jwtVerify, decodeProtectedHeader } from 'jose'

// 模組級快取
let _signingKey   = null
let _cachedKid    = null
let _verifyingMap = null   // Map<kid, CryptoKey>，含一個 'default' fallback

// ── 私鑰（簽發 JWT） ─────────────────────────────────────────────

async function getSigningKey(env) {
  if (_signingKey) return { key: _signingKey, kid: _cachedKid }

  if (!env.JWT_PRIVATE_KEY)
    throw new Error('JWT_PRIVATE_KEY is not configured. Run: node scripts/generate-jwt-keys.mjs')

  let jwk
  try {
    jwk = JSON.parse(env.JWT_PRIVATE_KEY)
  } catch (e) {
    throw new Error(`JWT_PRIVATE_KEY is not valid JSON: ${e.message}. Re-run: node scripts/generate-jwt-keys.mjs`)
  }
  _signingKey    = await importJWK(jwk, 'ES256')
  _cachedKid     = jwk.kid ?? 'key-1'
  return { key: _signingKey, kid: _cachedKid }
}

// ── 公鑰（驗證 JWT） — 多 key map ────────────────────────────────

/**
 * 解析 env 中的公鑰來源 → JWK 陣列。
 * 優先 JWT_PUBLIC_KEYS（陣列），fallback JWT_PUBLIC_KEY（單把）。
 */
function readPublicJwks(env) {
  if (env.JWT_PUBLIC_KEYS) {
    let arr
    try {
      arr = JSON.parse(env.JWT_PUBLIC_KEYS)
    } catch (e) {
      throw new Error(`JWT_PUBLIC_KEYS is not valid JSON: ${e.message}`)
    }
    if (!Array.isArray(arr) || arr.length === 0)
      throw new Error('JWT_PUBLIC_KEYS must be a non-empty JSON array')
    return arr
  }
  if (env.JWT_PUBLIC_KEY) {
    try {
      return [JSON.parse(env.JWT_PUBLIC_KEY)]
    } catch (e) {
      throw new Error(`JWT_PUBLIC_KEY is not valid JSON: ${e.message}`)
    }
  }
  throw new Error('JWT_PUBLIC_KEY(S) is not configured')
}

async function getVerifyingMap(env) {
  if (_verifyingMap) return _verifyingMap
  const jwks = readPublicJwks(env)
  const map = new Map()
  for (const jwk of jwks) {
    const key = await importJWK(jwk, 'ES256')
    const kid = jwk.kid ?? 'key-1'
    map.set(kid, key)
    // 第一把同時掛在 'default' slot：JWT 缺 kid 時的 fallback
    if (!map.has('__default__')) map.set('__default__', key)
  }
  _verifyingMap = map
  return _verifyingMap
}

/**
 * 依 JWT header 的 kid 選對應公鑰。
 * 缺 kid → 用第一把（active）作 fallback，向後相容沒帶 kid 的舊 token。
 */
async function getVerifyingKey(env, kid) {
  const map = await getVerifyingMap(env)
  if (kid && map.has(kid)) return map.get(kid)
  return map.get('__default__')
}

// ── 公開 API ─────────────────────────────────────────────────────

/**
 * 以 ES256 私鑰簽發 JWT。
 *
 * @param {object} payload   JWT claims
 * @param {string} expiresIn 有效期，例如 '15m', '5m', '7d'
 * @param {object} env       Cloudflare env（含 JWT_PRIVATE_KEY）
 * @param {object} [opts]
 * @param {string} [opts.audience]  受眾識別（缺省不寫入 aud claim）
 * @returns {Promise<string>} JWT 字串
 */
export async function signJwt(payload, expiresIn, env, opts = {}) {
  const { key, kid } = await getSigningKey(env)
  // 自動補 jti（Phase B：精準 revoke 用）。caller 已自帶 jti 則尊重之。
  const enriched = payload.jti ? payload : { ...payload, jti: crypto.randomUUID() }
  const builder = new SignJWT(enriched)
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer('https://chiyigo.com')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
  if (opts.audience) builder.setAudience(opts.audience)
  return builder.sign(key)
}

/**
 * 以 ES256 公鑰驗證 JWT。
 * 自動依 JWT header 的 kid 從多 key map 中選對應公鑰。
 *
 * @param {string} token JWT 字串
 * @param {object} env   Cloudflare env（含 JWT_PUBLIC_KEYS / JWT_PUBLIC_KEY）
 * @param {object} [opts]
 * @param {string|string[]} [opts.audience]  受眾驗證；缺省則不驗 aud（向後相容）
 * @param {string|null}     [opts.issuer]    簽發者驗證；缺省驗 'https://chiyigo.com'；傳 null 才關閉
 * @returns {Promise<object>} JWT payload
 * @throws 驗證失敗 / 過期 / aud / iss 不符 / 找不到對應 kid 時拋出例外
 */
export async function verifyJwt(token, env, opts = {}) {
  let kid = null
  try { kid = decodeProtectedHeader(token).kid ?? null } catch { /* malformed → 下方 verify 會 throw */ }

  const key = await getVerifyingKey(env, kid)
  if (!key) throw new Error(`No public key matches kid=${kid}`)

  const verifyOpts = { algorithms: ['ES256'] }
  if (opts.audience !== undefined) verifyOpts.audience = opts.audience
  // 預設驗 issuer：所有 chiyigo 簽出的 token 都用 'https://chiyigo.com'（簽端見 signJwt setIssuer）。
  // 不傳 → 套預設；明確傳 null → 關閉（給少數需要驗外部 token 的場景）。
  if (opts.issuer === null) {
    // 明確不驗
  } else {
    verifyOpts.issuer = opts.issuer ?? 'https://chiyigo.com'
  }

  const { payload } = await jwtVerify(token, key, verifyOpts)
  return payload
}

/**
 * 取得單一公鑰 JWK（向後相容；推薦改用 getPublicJwks）。
 * 取陣列首筆。
 */
export function getPublicJwk(env) {
  const [jwk] = readPublicJwks(env)
  const { kty, crv, x, y, kid, use, alg } = jwk
  return { kty, crv, x, y, kid, use: use ?? 'sig', alg: alg ?? 'ES256' }
}

/**
 * 取得所有公鑰 JWK 陣列（供 JWKS 端點使用）。
 * 僅回傳公鑰欄位，私鑰分量 `d` 不會出現。
 *
 * 防護：x / y / kid 必為純 base64url（^[A-Za-z0-9_-]+$）。env secret 在貼上時可能
 * 混入空格 / 換行 / tab；node-jose 與 Cloudflare Worker 的 importJWK 寬容會吃掉，
 * 但瀏覽器 Web Crypto 嚴格拒絕 → talo-web / mbti login 端會驗失敗。這裡統一 strip。
 *
 * @param {object} env
 * @returns {Array<{ kty, crv, x, y, kid, use, alg }>}
 */
export function getPublicJwks(env) {
  const stripWs = s => typeof s === 'string' ? s.replace(/\s+/g, '') : s
  return readPublicJwks(env).map(({ kty, crv, x, y, kid, use, alg }) => ({
    kty,
    crv,
    x:   stripWs(x),
    y:   stripWs(y),
    kid: stripWs(kid),
    use: use ?? 'sig',
    alg: alg ?? 'ES256',
  }))
}

// 測試用：清除模組級快取（vitest 在 keypair 切換時呼叫）
export function _resetJwtCache() {
  _signingKey   = null
  _cachedKid    = null
  _verifyingMap = null
}
