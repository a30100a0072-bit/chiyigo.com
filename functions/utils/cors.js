/**
 * CORS 工具模組
 *
 * 白名單策略：
 *  - 永遠允許：env.ALLOWED_ORIGINS（逗號分隔）+ https://chiyigo.com
 *  - 開發環境：自動允許所有 localhost / 127.0.0.1 來源（任意 port）
 *  - 不在白名單的 Origin：回傳空物件（不加任何 CORS 標頭，瀏覽器會自行攔截）
 */

const DEFAULT_ORIGINS = ['https://chiyigo.com', 'https://mbti.chiyigo.com']

function getAllowedOrigins(env) {
  const extras = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : []
  return [...DEFAULT_ORIGINS, ...extras]
}

function isAllowedOrigin(origin, env) {
  if (!origin) return false
  if (getAllowedOrigins(env).includes(origin)) return true
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

export function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin') ?? ''
  if (!isAllowedOrigin(origin, env)) return {}
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
    'Vary':                         'Origin',
  }
}
