/**
 * CORS Middleware — /api/admin/* 全路由生效
 * 與 /api/auth/_middleware.js 相同策略，供未來 Admin Panel 跨域存取使用。
 */

import { getCorsHeaders } from '../../utils/cors.js'

export async function onRequest({ request, env, next }) {
  const corsHeaders = getCorsHeaders(request, env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const response = await next()

  const modified = new Response(response.body, response)
  for (const [k, v] of Object.entries(corsHeaders)) {
    modified.headers.set(k, v)
  }
  return modified
}
