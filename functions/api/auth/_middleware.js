/**
 * CORS Middleware — /api/auth/* 全路由生效
 *
 * Cloudflare Pages Functions _middleware.js 自動攔截同目錄及子目錄的所有請求。
 *
 * 行為：
 *  OPTIONS preflight → 直接回 204（不呼叫後續 handler）
 *  3xx redirect      → 透傳不加 CORS（discord/init + callback 是瀏覽器導航，非 fetch）
 *  其他              → 呼叫後續 handler 後，在回應上附加 CORS 標頭
 */

import { getCorsHeaders } from '../../utils/cors.js'

export async function onRequest({ request, env, next }) {
  const corsHeaders = getCorsHeaders(request, env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const response = await next()

  if (response.status >= 300 && response.status < 400) return response

  // CF Workers for...of on Headers DOES include set-cookie (combined); skip it explicitly,
  // then re-add each cookie individually via getAll() to avoid duplicates and preserve all values
  const newHeaders = new Headers()
  for (const [k, v] of response.headers) {
    if (k.toLowerCase() !== 'set-cookie') newHeaders.append(k, v)
  }
  for (const c of response.headers.getAll('set-cookie')) newHeaders.append('set-cookie', c)
  for (const [k, v] of Object.entries(corsHeaders)) newHeaders.set(k, v)

  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers:    newHeaders,
  })
}
