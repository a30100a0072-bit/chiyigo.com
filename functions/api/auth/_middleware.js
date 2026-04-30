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

import { getCorsHeadersForCredentials } from '../../utils/cors.js'

export async function onRequest({ request, env, next }) {
  // 全 /api/auth/* 都可能帶 cookie / Authorization，統一加 Allow-Credentials: true
  // （瀏覽器只在客戶端 credentials:'include' 時才送，所以這裡放寬不會自動帶憑證）
  const corsHeaders = getCorsHeadersForCredentials(request, env)

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  const response = await next()

  if (response.status >= 300 && response.status < 400) return response

  // new Response(body, response) 在 CF Workers runtime 層繼承原生 Set-Cookie 陣列，
  // 不需手動解構 Headers，避免 getAll('set-cookie') 的環境相容性風險。
  const newResponse = new Response(response.body, response)

  for (const [k, v] of Object.entries(corsHeaders)) {
    newResponse.headers.set(k, v)
  }

  return newResponse
}
