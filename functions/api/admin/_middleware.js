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
