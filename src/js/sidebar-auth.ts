/* sidebar-auth.ts — 公開頁 sidebar 底部「會員登入 / 會員中心 / 登出」三態切換 + 跨分頁登入狀態同步
 *
 * 三層機制：
 *   1. sessionStorage.access_token 為主要狀態來源（per-tab）
 *   2. 開新分頁無 token 時 → 委派 window.silentRefresh()（含 navigator.locks 防 race）
 *      api.js 沒 load 時走 fallback /api/auth/refresh
 *   3. BroadcastChannel 'chiyigo-auth' 即時廣播 login / logout；
 *      storage 事件補 BroadcastChannel disabled 場景與 OIDC front-channel logout 訊號
 *
 * guest:  <a data-auth="guest"> 會員登入
 * member: <a data-auth="member"> 會員中心 + <button data-auth="member" data-logout> 登出
 *
 * Stage 4.5b-2 (PR-57)：自 public/js/sidebar-auth.js 收編進 src/js/，
 * 由 tsconfig.browser-classic.prod.json + build-partials 走 tsc emit
 * 回 public/js/sidebar-auth.js。classic IIFE shape；不引入 ESM 結構。
 */
// Script-mode global augmentation：本檔不引入 ESM 結構（IIFE 包裝），top-level
// `interface Window` 直接 merge 進全域 Window。同時與 types/globals.d.ts 的
// declare global 宣告同 signature，root tsconfig 載入時亦 compatible 合併。
// canary/prod tsconfig 不載 types/globals.d.ts → 本檔內宣告即唯一 source。
interface Window {
  silentRefresh: () => Promise<boolean>
  __chiyigoMemoryDeviceUuid?: string
}

type AuthBroadcast =
  | { type: 'login'; token: string }
  | { type: 'logout' }

;(function () {
  'use strict'
  const win = window

  // 同 auth-ui.js / api.js：每瀏覽器一次性 web-<uuid>，給 /api/auth/refresh X-Device-Id 用
  function getDeviceUuid(): string | null {
    const KEY = 'chiyigo.device_uuid'
    try {
      const v = localStorage.getItem(KEY)
      if (v && /^web-[0-9a-f-]{36}$/i.test(v)) return v
    } catch (_) { /* localStorage blocked */ }
    if (win.__chiyigoMemoryDeviceUuid) return win.__chiyigoMemoryDeviceUuid
    const uuid =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : null
    if (!uuid) return null
    const fullUuid = 'web-' + uuid
    try { localStorage.setItem(KEY, fullUuid) }
    catch (_) { win.__chiyigoMemoryDeviceUuid = fullUuid }
    return fullUuid
  }

  const TOKEN_KEY = 'access_token'
  const CHANNEL_NAME = 'chiyigo-auth'
  const LOCK_NAME = 'chiyigo-auth-refresh'

  let channel: BroadcastChannel | null = null
  try { channel = ('BroadcastChannel' in window) ? new BroadcastChannel(CHANNEL_NAME) : null }
  catch (_) { channel = null }

  function readToken(): string | null {
    try { return sessionStorage.getItem(TOKEN_KEY) } catch (_) { return null }
  }
  function writeToken(t: string | null): void {
    try {
      if (t) sessionStorage.setItem(TOKEN_KEY, t)
      else sessionStorage.removeItem(TOKEN_KEY)
    } catch (_) { /* storage blocked */ }
  }

  function applyAuthState(): void {
    const hasTok = !!readToken()
    document.querySelectorAll<HTMLElement>('[data-auth="guest"]').forEach(function (el) {
      el.hidden = hasTok
    })
    document.querySelectorAll<HTMLElement>('[data-auth="member"]').forEach(function (el) {
      el.hidden = !hasTok
    })
  }

  function broadcastLogin(token: string): void {
    if (!channel) return
    try { channel.postMessage({ type: 'login', token: token } as AuthBroadcast) } catch (_) { /* channel closed */ }
  }
  function broadcastLogout(): void {
    if (!channel) return
    try { channel.postMessage({ type: 'logout' } as AuthBroadcast) } catch (_) { /* channel closed */ }
  }

  // 跑一次 /api/auth/refresh；成功 → 寫 token + 廣播 + re-apply UI
  // P0-11：委派給 api.js 的 window.silentRefresh（含 navigator.locks）；
  // 成功後自己讀回 token 廣播 + 套 UI
  async function doRefresh(): Promise<boolean> {
    if (typeof win.silentRefresh === 'function') {
      const ok = await win.silentRefresh()
      if (ok) {
        const t = readToken()
        if (t) { broadcastLogin(t); applyAuthState(); return true }
      }
      return false
    }
    // fallback（罕見：api.js 未 load）
    try {
      const devId = getDeviceUuid()
      const hdrs: Record<string, string> = { 'Content-Type': 'application/json' }
      if (devId) hdrs['X-Device-Id'] = devId
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: hdrs,
        body: '{}',
      })
      if (!r.ok) return false
      const data = await r.json() as { access_token?: string } | null
      if (!data || !data.access_token) return false
      writeToken(data.access_token)
      broadcastLogin(data.access_token)
      applyAuthState()
      return true
    } catch (_) { return false }
  }

  // 入口：sessionStorage 沒 token 時試一次 refresh；用 navigator.locks 序列化避免多分頁同時 rotate
  async function silentRefreshIfNeeded(): Promise<void> {
    if (readToken()) return
    if ('locks' in navigator) {
      try {
        await navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, async function () {
          // 進到 lock 後再檢一次：別的分頁可能在我等 lock 時已 broadcast token 過來
          if (readToken()) { applyAuthState(); return }
          await doRefresh()
        })
        return
      } catch (_) { /* fallthrough to no-lock path */ }
    }
    // navigator.locks 不支援 → 直接打（接受少量 race 風險，僅影響同時開多分頁的瞬間）
    await doRefresh()
  }

  // OIDC RP-Initiated Logout：跳 chiyigo end_session_endpoint，
  // 它會撤所有 refresh + 嵌 iframe 同步登出 mbti / talo（front-channel logout）
  // 沒有 id_token_hint 也能跑（cookie token 還是會被撤）
  function doLogout(): void {
    writeToken(null)
    broadcastLogout()
    const url = '/api/auth/oauth/end-session?post_logout_redirect_uri=' +
      encodeURIComponent('https://chiyigo.com/')
    location.href = url
  }

  function init(): void {
    applyAuthState()

    // 登出按鈕綁定（支援動態 partial）
    document.querySelectorAll<HTMLElement>('[data-logout]').forEach(function (btn) {
      btn.addEventListener('click', doLogout)
    })

    // BroadcastChannel：另一個分頁登入 / 登出 → 即時同步本分頁 UI
    if (channel) {
      channel.addEventListener('message', function (e: MessageEvent) {
        const data = e.data as AuthBroadcast | null | undefined
        if (!data) return
        if (data.type === 'login' && data.token) {
          writeToken(data.token)
          applyAuthState()
        } else if (data.type === 'logout') {
          writeToken(null)
          applyAuthState()
          // P0-12：私密頁要立刻跳 login，避免連鎖 401（公開頁僅切 UI）
          const path = location.pathname
          const isPublic = path === '/' || path === '' || path.startsWith('/login') ||
            path.startsWith('/index') || path.startsWith('/forgot-password') ||
            path.startsWith('/reset-password') || path.startsWith('/verify-email')
          if (!isPublic) location.replace('/login.html?logout=other_tab')
        }
      })
    }

    // localStorage 跨分頁同步 fallback（舊瀏覽器 / BroadcastChannel disabled）
    // 也監聽 OIDC Front-Channel Logout 訊號（其他子站登出 → 同源主頁分頁立刻清狀態）
    window.addEventListener('storage', function (e: StorageEvent) {
      if (e.key === 'oidc_logout_at') {
        writeToken(null)
        applyAuthState()
        return
      }
      if (e.key === TOKEN_KEY || e.key === null) applyAuthState()
    })

    // 進站時 sessionStorage 為空 → 試 silent refresh（HttpOnly cookie 跨分頁有效）
    void silentRefreshIfNeeded()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
