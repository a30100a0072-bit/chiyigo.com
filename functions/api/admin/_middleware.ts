/**
 * CORS Middleware — /api/admin/* 全路由生效
 * 與 /api/auth/_middleware.ts 相同策略，供未來 Admin Panel 跨域存取使用。
 */

import { getCorsHeaders } from '../../utils/cors'

export async function onRequest({ request, env, next }: { request: Request; env: Env; next: () => Promise<Response> }) {
  const corsHeaders = getCorsHeaders(request, env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const response = await next()

  // new Response(body, response) 在 CF Workers runtime 層原生繼承 Set-Cookie 陣列（含多筆），
  // 不需手動解構 Headers / 非標準 getAll('set-cookie')，與 /api/auth 中介層保持一致。
  const newResponse = new Response(response.body, response)
  for (const [k, v] of Object.entries(corsHeaders) as [string, string][]) {
    newResponse.headers.set(k, v)
  }

  return newResponse
}
