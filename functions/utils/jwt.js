/**
 * JWT 金鑰管理與簽發工具（ES256 非對稱加密）
 *
 * 設計要點：
 *  - 私鑰只存在 IAM 端（chiyigo.com），任何子系統無法取得私鑰。
 *  - 子系統透過 JWKS 端點 (/.well-known/jwks.json) 取得公鑰自行驗證。
 *  - 模組級快取：同一 Cloudflare V8 isolate 內金鑰 import 只執行一次。
 *
 * 環境變數（Cloudflare Pages / .dev.vars）：
 *  JWT_PRIVATE_KEY — JWK JSON 字串（僅 IAM 持有）
 *  JWT_PUBLIC_KEY  — JWK JSON 字串（JWKS 端點對外公開）
 *
 * 生成金鑰對：
 *  node scripts/generate-jwt-keys.mjs
 */

import { SignJWT, importJWK, jwtVerify } from 'jose'

// 模組級快取（同一 isolate 跨請求共用，降低 crypto.subtle.importKey 開銷）
let _signingKey   = null
let _verifyingKey = null
let _cachedKid    = null

// ── 私鑰（簽發 JWT） ─────────────────────────────────────────────

async function getSigningKey(env) {
  if (_signingKey) return { key: _signingKey, kid: _cachedKid }

  if (!env.JWT_PRIVATE_KEY)
    throw new Error('JWT_PRIVATE_KEY is not configured. Run: node scripts/generate-jwt-keys.mjs')

  const jwk      = JSON.parse(env.JWT_PRIVATE_KEY)
  _signingKey    = await importJWK(jwk, 'ES256')
  _cachedKid     = jwk.kid ?? 'key-1'
  return { key: _signingKey, kid: _cachedKid }
}

// ── 公鑰（驗證 JWT） ─────────────────────────────────────────────

async function getVerifyingKey(env) {
  if (_verifyingKey) return _verifyingKey

  if (!env.JWT_PUBLIC_KEY)
    throw new Error('JWT_PUBLIC_KEY is not configured. Run: node scripts/generate-jwt-keys.mjs')

  const jwk     = JSON.parse(env.JWT_PUBLIC_KEY)
  _verifyingKey = await importJWK(jwk, 'ES256')
  return _verifyingKey
}

// ── 公開 API ─────────────────────────────────────────────────────

/**
 * 以 ES256 私鑰簽發 JWT。
 *
 * @param {object} payload   JWT claims（sub, email, scope 等）
 * @param {string} expiresIn 有效期，例如 '15m', '5m', '7d'
 * @param {object} env       Cloudflare env（含 JWT_PRIVATE_KEY）
 * @param {object} [opts]
 * @param {string} [opts.audience]  受眾識別（'talo' / 'mbti' / 'chiyigo'）— 缺省不寫入 aud claim，過渡相容
 * @returns {Promise<string>} JWT 字串
 */
export async function signJwt(payload, expiresIn, env, opts = {}) {
  const { key, kid } = await getSigningKey(env)
  const builder = new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', kid })
    .setIssuer('https://chiyigo.com')
    .setIssuedAt()
    .setExpirationTime(expiresIn)
  if (opts.audience) builder.setAudience(opts.audience)
  return builder.sign(key)
}

/**
 * 以 ES256 公鑰驗證 JWT。
 *
 * @param {string} token JWT 字串
 * @param {object} env   Cloudflare env（含 JWT_PUBLIC_KEY）
 * @returns {Promise<object>} JWT payload
 * @throws 驗證失敗或過期時拋出例外
 */
export async function verifyJwt(token, env) {
  const key = await getVerifyingKey(env)
  const { payload } = await jwtVerify(token, key, { algorithms: ['ES256'] })
  return payload
}

/**
 * 取得公鑰 JWK 物件（供 JWKS 端點使用）。
 * 僅回傳公鑰欄位，私鑰分量 `d` 不會出現。
 *
 * @param {object} env Cloudflare env（含 JWT_PUBLIC_KEY）
 * @returns {{ kty, crv, x, y, kid, use, alg }}
 */
export function getPublicJwk(env) {
  if (!env.JWT_PUBLIC_KEY)
    throw new Error('JWT_PUBLIC_KEY is not configured')

  const { kty, crv, x, y, kid, use, alg } = JSON.parse(env.JWT_PUBLIC_KEY)
  return { kty, crv, x, y, kid, use: use ?? 'sig', alg: alg ?? 'ES256' }
}
