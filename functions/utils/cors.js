/**
 * CORS 工具模組
 *
 * 白名單策略：
 *  - 永遠允許：env.ALLOWED_ORIGINS（逗號分隔）+ DEFAULT_ORIGINS
 *  - 僅當 env.ENVIRONMENT === 'development'：放行 localhost / 127.0.0.1 任意 port
 *  - 不在白名單的 Origin：回傳空物件（不加 CORS 標頭，瀏覽器自行攔截）
 */

import { getAllowedCorsOrigins, getAudByOrigin, getValidAuds } from './oauth-clients.js'

function getAllowedOrigins(env) {
  const extras = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : []
  return [...getAllowedCorsOrigins(), ...extras]
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false
  if (getAllowedOrigins(env).includes(origin)) return true
  if (env.ENVIRONMENT === 'development' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true
  return false
}

/**
 * @param {Request} request
 * @param {object}  env
 * @param {object}  [opts]
 * @param {boolean} [opts.credentials] 跨子網域帶 cookie 的端點（refresh / logout / web token）
 *                                     傳 true 會加 Access-Control-Allow-Credentials: true
 */
export function getCorsHeaders(request, env, opts = {}) {
  const origin = request.headers.get('Origin') ?? ''
  if (!isAllowedOrigin(origin, env)) return {}
  const headers = {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  }
  if (opts.credentials) headers['Access-Control-Allow-Credentials'] = 'true'
  return headers
}

// JWT aud claim 解析：依 redirect / origin 決定 token 受眾
// 從 oauth-clients registry 動態讀（middleware refresh 後反映 D1 最新內容）
// 未匹配 → 'chiyigo'（chiyigo.com 自家頁面）
export function resolveAud(input) {
  if (!input || typeof input !== 'string') return 'chiyigo'
  if (getValidAuds().has(input)) return input
  try {
    const origin = new URL(input).origin
    return getAudByOrigin()[origin] ?? 'chiyigo'
  } catch {
    return 'chiyigo'
  }
}
