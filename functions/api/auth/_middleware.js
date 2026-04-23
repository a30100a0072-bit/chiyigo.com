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

  const modified = new Response(response.body, response)
  for (const [k, v] of Object.entries(corsHeaders)) {
    modified.headers.set(k, v)
  }
  return modified
}
