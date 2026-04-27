/**
 * CORS Middleware — /api/ai/* 全路由生效
 *
 * 與 /api/auth/_middleware.js 行為一致：
 *  OPTIONS preflight → 204
 *  其他              → 呼叫後續 handler 後附加 CORS 標頭
 */

import { getCorsHeaders } from '../../utils/cors.js'

export async function onRequest({ request, env, next }) {
  const corsHeaders = getCorsHeaders(request, env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const response = await next()
  if (response.status >= 300 && response.status < 400) return response

  const newResponse = new Response(response.body, response)
  for (const [k, v] of Object.entries(corsHeaders)) {
    newResponse.headers.set(k, v)
  }
  return newResponse
}
