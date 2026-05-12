// login-boot.js — login 頁 pre-DOM 早期同步腳本（CSP-safe 外部版）
// 須在 head 內以 <script src="..."></script> 同步載入，不加 defer。
// 內含三段（原 src/pages/login.html inline 抽出）：
//   1. iOS 偵測 → html.is-ios（控 .ios-wait-hint 顯示）
//   2. ?next=/path → sessionStorage('auth_redirect')（跨 OAuth flow 保留）
//   3. 已登入早跳轉（避免登入表單閃一下）

(function () {
  var ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)) {
    document.documentElement.classList.add('is-ios')
  }
})()

;(function () {
  try {
    var n = new URLSearchParams(location.search).get('next')
    if (n && n.charAt(0) === '/' && n.charAt(1) !== '/') {
      sessionStorage.setItem('auth_redirect', n)
    }
  } catch (_) { /* noop */ }
})()

;(function () {
  try {
    var p = new URLSearchParams(location.search)
    if (p.get('pkce_key') || p.get('redirect') || p.get('access_token') || p.get('code')) return
    var tok = null
    try { tok = sessionStorage.getItem('access_token') } catch (_) { /* noop */ }
    if (!tok) return
    var target = null
    try { target = sessionStorage.getItem('auth_redirect') } catch (_) { /* noop */ }
    if (!target) {
      var n = p.get('next')
      if (n && n.charAt(0) === '/' && n.charAt(1) !== '/') target = n
    }
    target = target || '/dashboard.html'
    try { sessionStorage.removeItem('auth_redirect') } catch (_) { /* noop */ }
    location.replace(target)
  } catch (_) { /* noop */ }
})()
