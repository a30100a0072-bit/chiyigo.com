// API-wide Middleware for /api/* routes
// POST requests require Content-Type: application/json (CSRF form-submit defense)
// Exempt: /api/auth/logout (cookie-only, no body) and /api/auth/oauth/[provider]/callback (Apple form_post)

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
