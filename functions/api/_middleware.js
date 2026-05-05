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
import { refreshClientsCache } from '../utils/oauth-clients.js'

const CT_EXEMPT_EXACT   = new Set(['/api/auth/logout'])
// 第三方 webhook 多用 application/x-www-form-urlencoded（ECPay、PSP 等）；
// /api/webhooks/* 全段豁免 Content-Type 守門，由各 vendor adapter 自行解析+驗章。
const CT_EXEMPT_PATTERN = /^\/api\/auth\/oauth\/[^/]+\/callback$|^\/api\/webhooks\//

function genTraceId() {
  const a = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('')
}

// 從 Authorization: Bearer <jwt> 取出 payload.sub（不驗證簽章，只給 log 標籤用）
// — handler 仍會用 requireAuth 做真實驗證；status 4xx 表示這個 sub 是「自稱」，
//   2xx/3xx 表示已被驗證通過。
function tryDecodeAuthSub(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const parts = authHeader.slice(7).trim().split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=')
    const obj = JSON.parse(atob(b64))
    return (typeof obj.sub === 'string' || typeof obj.sub === 'number') ? String(obj.sub) : null
  } catch { return null }
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

// 同 path 1 分鐘內只發一次告警，避免單一壞 endpoint 連發洗版
// （per-isolate 記憶體，多 isolate 下不保證 100% 去重，但夠用）
const ALERT_COOLDOWN_MS = 60_000
const alertLastSentAt = new Map()

function shouldAlert(pathPattern) {
  const now = Date.now()
  const last = alertLastSentAt.get(pathPattern) ?? 0
  if (now - last < ALERT_COOLDOWN_MS) return false
  alertLastSentAt.set(pathPattern, now)
  return true
}

async function sendAlert(webhookUrl, payload) {
  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content:
          `🔴 5xx on chiyigo\n` +
          `\`${payload.method} ${payload.path}\` → ${payload.status}\n` +
          `traceId: \`${payload.traceId}\`\n` +
          `ms: ${payload.ms}` +
          (payload.errName ? `\nerr: \`${payload.errName}: ${payload.errMessage}\`` : ''),
      }),
    })
  } catch { /* never throw from alerter */ }
}

function levelFor(status, hasError) {
  if (hasError || status >= 500) return 'error'
  if (status >= 400) return 'warn'
  return 'info'
}

export async function onRequest(context) {
  const { request, env, next, data, waitUntil } = context
  const url     = new URL(request.url)
  const path    = url.pathname
  const method  = request.method
  // 保留呼叫方傳入的 X-Request-Id（若有），方便跨服務串接
  const traceId = request.headers.get('X-Request-Id') || genTraceId()
  const start   = Date.now()

  // 給下游 handler 掛 metadata（先用 JWT 自稱 sub 預填 userId，handler 可覆寫）
  const claimedSub = tryDecodeAuthSub(request.headers.get('Authorization'))
  data.observe = { traceId, userId: claimedSub, extras: null }

  // OAuth client registry refresh（per-isolate 60s throttle，內部 try/catch 不擋請求）
  // 讓 cors.js / authorize.js 等同步 consumer 讀到最新 D1 內容；首次 cold start
  // 仍能 fallback 到 in-code，所以這裡不 await 也不要緊，但 await 較好（一致性高）
  try { await refreshClientsCache(env) } catch { /* 不擋請求 */ }

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

  const pathPattern = routePattern(path)

  emit({
    ts:      new Date().toISOString(),
    level:   levelFor(status, !!caught),
    msg:     'http',
    traceId,
    method,
    path:    pathPattern,
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

  // 5xx 告警 → Discord webhook（節流：同 path 60s 一次）
  if (status >= 500 && env.ALERT_WEBHOOK_URL && shouldAlert(pathPattern)) {
    waitUntil(sendAlert(env.ALERT_WEBHOOK_URL, {
      method,
      path: pathPattern,
      status,
      traceId,
      ms,
      errName:    caught?.name ?? null,
      errMessage: caught?.message ?? null,
    }))
  }

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
