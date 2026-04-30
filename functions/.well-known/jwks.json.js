/**
 * GET /.well-known/jwks.json
 *
 * RFC 7517 標準公鑰分發端點（JWKS）。
 *
 * 用途：
 *  - 子系統透過此端點取得 IAM 的 ES256 公鑰，自行驗證 JWT。
 *  - Cloudflare Service Bindings：
 *      const jwksRes = await env.IAM_SERVICE.fetch('https://chiyigo.com/.well-known/jwks.json')
 *      const { keys } = await jwksRes.json()
 *
 * 安全性：
 *  - 只輸出公鑰欄位（kty, crv, x, y, kid, use, alg）。
 *  - 私鑰分量 `d` 絕不出現在回應中。
 *
 * 快取策略：
 *  - Cache-Control: public, max-age=3600（子系統最多快取 1 小時）
 *  - 金鑰輪換時建議同步更新 kid，子系統可依 kid 快取選鍵。
 */

import { getPublicJwks } from '../utils/jwt.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function onRequestGet({ env }) {
  let keys
  try {
    keys = getPublicJwks(env)
  } catch {
    return new Response(
      JSON.stringify({ error: 'Public key not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
    )
  }

  return new Response(JSON.stringify({ keys }), {
    headers: {
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=3600',
      ...CORS_HEADERS,
    },
  })
}

// OPTIONS preflight（跨域子系統請求用）
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  })
}
