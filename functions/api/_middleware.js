// API-wide Middleware for /api/* routes
//
// 1) 觀測性：每個請求產生 16-hex traceId，結構化 JSON log
//    （Cloudflare Pages 將 console.log 收進 Workers Logs / Logpush）。
//    回應 header 會帶 X-Request-Id，供前端錯誤回報附帶。
// 2) 例外捕捉：handler 拋例外時記錯誤 log，回 500 + traceId。
// 3) Content-Type 守門（保留原行為）：
//    POST 請求必須是 application/json，
//    例外：/api/auth/logout（cookie-only，無 body）
//          /api/auth/oauth/[provider]/callback（Apple form_post）
//
// 路由 handler 可在 ctx.data.observe 上掛資料（會一起進 log）：
//    data.observe.userId = user.sub
//    data.observe.extras = { feature: 'requisition_revoke', id }

import { getCorsHeaders } from '../utils/cors.js'

const CT_EXEMPT_EXACT   = new Set(['/api/auth/logout'])
const CT_EXEMPT_PATTERN = /^\/api\/auth\/oauth\/[^/]+\/callback$/

function genTraceId() {
  const a = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
}

// 把 path 中的數字 / UUID 動態段替換為 :id / :uuid，避免高基數爆炸
function routePattern(path) {
  return path
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid')
}

function emit(line) {
  try { console.log(JSON.stringify(line)) } catch { /* never throw from logger */ }
}

function levelFor(status, hasError) {
  if (hasError || status >= 500) return 'error'
  if (status >= 400) return 'warn'
  return 'info'
}

export async function onRequest(context) {
  const { request, env, next, data } = context
  const url     = new URL(request.url)
  const path    = url.pathname
  const method  = request.method
  // 保留呼叫方傳入的 X-Request-Id（若有），方便跨服務串接
  const traceId = request.headers.get('X-Request-Id') || genTraceId()
  const start   = Date.now()

  // 給下游 handler 掛 metadata
  data.observe = { traceId, userId: null, extras: null }

  // ── Content-Type 守門 ─────────────────────────────────────────
  if (method === 'POST'
      && !CT_EXEMPT_EXACT.has(path)
      && !CT_EXEMPT_PATTERN.test(path)) {
    const ct = request.headers.get('Content-Type') ?? ''
    if (!ct.includes('application/json')) {
      const corsHeaders = getCorsHeaders(request, env)
      emit({
        ts: new Date().toISOString(), level: 'warn', msg: 'reject_content_type',
        traceId, method, path: routePattern(path), status: 415, ms: Date.now() - start,
      })
      return new Response(
        JSON.stringify({ error: 'Content-Type must be application/json', traceId }),
        {
          status: 415,
          headers: {
            'Content-Type':                  'application/json',
            'X-Request-Id':                  traceId,
            'Access-Control-Expose-Headers': 'X-Request-Id',
            ...corsHeaders,
          },
        }
      )
    }
  }

  // ── 執行下游，攔錯 ────────────────────────────────────────────
  let response = null
  let caught   = null
  try {
    response = await next()
  } catch (e) {
    caught = e
  }

  const ms     = Date.now() - start
  const cf     = request.cf ?? {}
  const status = caught ? 500 : (response?.status ?? 0)

  emit({
    ts:      new Date().toISOString(),
    level:   levelFor(status, !!caught),
    msg:     'http',
    traceId,
    method,
    path:    routePattern(path),
    status,
    ms,
    ip:      request.headers.get('CF-Connecting-IP') ?? null,
    country: cf.country ?? null,
    ray:     request.headers.get('CF-Ray') ?? null,
    ua:      request.headers.get('User-Agent') ?? null,
    userId:  data.observe?.userId ?? null,
    extras:  data.observe?.extras ?? null,
    err:     caught ? {
      name:    caught.name,
      message: caught.message,
      stack:   (caught.stack ?? '').split('\n').slice(0, 5).join('\n'),
    } : null,
  })

  if (caught) {
    const corsHeaders = getCorsHeaders(request, env)
    return new Response(
      JSON.stringify({ error: 'Internal Server Error', traceId }),
      {
        status: 500,
        headers: {
          'Content-Type':                  'application/json',
          'X-Request-Id':                  traceId,
          'Access-Control-Expose-Headers': 'X-Request-Id',
          ...corsHeaders,
        },
      }
    )
  }

  // 把 X-Request-Id 加到 handler 回應上（保留原 status/body/其他 header）
  try {
    const newHeaders = new Headers(response.headers)
    if (!newHeaders.has('X-Request-Id')) newHeaders.set('X-Request-Id', traceId)
    if (!newHeaders.has('Access-Control-Expose-Headers')) {
      newHeaders.set('Access-Control-Expose-Headers', 'X-Request-Id')
    }
    return new Response(response.body, {
      status:     response.status,
      statusText: response.statusText,
      headers:    newHeaders,
    })
  } catch {
    return response
  }
}
