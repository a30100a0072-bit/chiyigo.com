/**
 * apiFetch — 包一層 fetch，把後端觀測性接好：
 *   - 自動帶 Authorization: Bearer <access_token>（從 sessionStorage）
 *   - 自動帶 Content-Type: application/json（POST/PUT/DELETE 且有 body）
 *   - credentials: 'include'（讓 refresh cookie 帶上）
 *   - 失敗時拋 ApiError({ status, traceId, code, message, body })
 *   - window.__lastTraceId 永遠保留最近一次回應的 X-Request-Id（給錯誤回報附帶）
 *
 * 用法：
 *   import 不用，直接 <script src="/js/api.js"></script> 後 window.apiFetch / window.ApiError
 *
 *   try {
 *     const data = await apiFetch('/api/auth/me')
 *   } catch (e) {
 *     // e.traceId 可給用戶回報
 *     showToast(`${e.message}（編號 ${e.traceId ?? '—'}）`)
 *   }
 *
 * 漸進遷移：頁面原有 fetch 不必馬上換，需要錯誤可追溯時再改用 apiFetch。
 */
;(function () {
  'use strict'

  class ApiError extends Error {
    constructor({ status, traceId, code, message, body }) {
      super(message || `HTTP ${status}`)
      this.name    = 'ApiError'
      this.status  = status
      this.traceId = traceId ?? null
      this.code    = code    ?? null
      this.body    = body    ?? null
    }
  }

  function getAccessToken() {
    try { return sessionStorage.getItem('access_token') } catch { return null }
  }

  async function apiFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url
    const opts = { ...init }
    opts.headers = new Headers(opts.headers || {})
    opts.credentials = opts.credentials ?? 'include'

    // 自動 Authorization（不覆寫 caller 已給的）
    if (!opts.headers.has('Authorization')) {
      const tok = getAccessToken()
      if (tok) opts.headers.set('Authorization', 'Bearer ' + tok)
    }

    // 有 body 但沒 Content-Type → 預設 JSON
    if (opts.body && !opts.headers.has('Content-Type')) {
      opts.headers.set('Content-Type', 'application/json')
    }

    let res
    try {
      res = await fetch(url, opts)
    } catch (netErr) {
      // 網路層失敗（CORS、離線等）— 沒 traceId
      throw new ApiError({
        status:  0,
        traceId: null,
        code:    'NETWORK_ERROR',
        message: netErr?.message || 'Network error',
      })
    }

    const traceId = res.headers.get('X-Request-Id')
    if (traceId) {
      try { window.__lastTraceId = traceId } catch { /* ignore */ }
    }

    // 嘗試解析 JSON（失敗就回 text）
    const ct = res.headers.get('Content-Type') || ''
    let body = null
    if (ct.includes('application/json')) {
      try { body = await res.json() } catch { body = null }
    } else {
      try { body = await res.text() } catch { body = null }
    }

    if (!res.ok) {
      throw new ApiError({
        status:  res.status,
        traceId,
        code:    body?.code    ?? null,
        message: body?.error   ?? body?.message ?? `HTTP ${res.status}`,
        body,
      })
    }

    return body
  }

  // 把 ApiError 轉成 user-friendly 訊息（給 toast 用）
  function formatApiError(e, fallback = 'Something went wrong') {
    if (!(e instanceof ApiError)) return fallback
    const base = e.message || fallback
    return e.traceId ? `${base}（#${e.traceId}）` : base
  }

  window.apiFetch       = apiFetch
  window.ApiError       = ApiError
  window.formatApiError = formatApiError
})()
