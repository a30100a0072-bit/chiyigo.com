/**
 * API-wide Middleware — /api/* 全路由生效
 *
 * POST 請求強制 Content-Type: application/json，防止跨站 form submit CSRF。
 *
 * 例外：
 *  /api/auth/logout           — Web Cookie 模式不帶 body，無 Content-Type header
 *  /api/auth/oauth/*/callback — Apple Sign In 使用 form_post（application/x-www-form-urlencoded）
 */

import { getCorsHeaders } from '../utils/cors.js'

const CT_EXEMPT_EXACT   = new Set(['/api/auth/logout'])
const CT_EXEMPT_PATTERN = /^\/api\/auth\/oauth\/[^/]+\/callback$/

export async function onRequest({ request, env, next }) {
  if (request.method === 'POST') {
    const path = new URL(request.url).pathname

    if (!CT_EXEMPT_EXACT.has(path) && !CT_EXEMPT_PATTERN.test(path)) {
      const ct = request.headers.get('Content-Type') ?? ''
      if (!ct.includes('application/json')) {
        const corsHeaders = getCorsHeaders(request, env)
        return new Response(
          JSON.stringify({ error: 'Content-Type must be application/json' }),
          { status: 415, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        )
      }
    }
  }

  return next()
}
