/* notify.ts — 全站 toast 系統
 *   window.notify.success(msg[, opts])
 *   window.notify.error(msg[, opts])
 *   window.notify.warning(msg[, opts])
 *   window.notify.info(msg[, opts])
 *
 * opts: { duration: number }  // 0 = 不自動消失；預設 4000ms
 * 回傳：dismiss() 函式（手動關閉）
 *
 * CSS 來自 _components.css 的 .toast-stack / .toast / .toast-{success,error,warning,info}
 *
 * Stage 5 PR-1 (2026-05-21)：自 public/js/notify.js 收編進 src/js/，
 * 由 tsconfig.browser-classic.prod.json + build-partials 走 tsc emit
 * 回 public/js/notify.js。classic IIFE shape；不引入 ESM 結構。
 */

// 本檔為 classic <script> 來源（tsconfig.browser-classic.prod.json module:"none"），
// 不可加 `export {}`/`import` 變 ESM module；因此用 script-scope `interface Window` 直接
// 合併全域 Window 型別。root tsconfig 透過 types/notify-globals.d.ts 提供相同 signature。
type NotifyLevel = 'success' | 'error' | 'warning' | 'info'
interface NotifyOpts {
  duration?: number
}
interface NotifyApi {
  success: (msg: unknown, opts?: NotifyOpts) => () => void
  error: (msg: unknown, opts?: NotifyOpts) => () => void
  warning: (msg: unknown, opts?: NotifyOpts) => () => void
  info: (msg: unknown, opts?: NotifyOpts) => () => void
}
interface Window {
  notify: NotifyApi
}

;(function () {
  'use strict'
  let stack: HTMLDivElement | null = null

  function getStack(): HTMLDivElement {
    if (stack && document.body.contains(stack)) return stack
    stack = document.createElement('div')
    stack.className = 'toast-stack'
    stack.setAttribute('role', 'region')
    stack.setAttribute('aria-label', 'Notifications')
    document.body.appendChild(stack)
    return stack
  }

  function show(level: NotifyLevel, msg: unknown, opts?: NotifyOpts): () => void {
    const o = opts || {}
    const duration = typeof o.duration === 'number' ? o.duration : 4000

    const t = document.createElement('div')
    t.className = 'toast toast-' + level
    t.setAttribute('role', level === 'error' ? 'alert' : 'status')
    t.textContent = String(msg)

    getStack().appendChild(t)
    requestAnimationFrame(function () { t.classList.add('show') })

    let timer: ReturnType<typeof setTimeout> | null = null
    function dismiss(): void {
      if (timer) { clearTimeout(timer); timer = null }
      t.classList.remove('show')
      t.classList.add('leaving')
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t) }, 260)
    }
    if (duration > 0) timer = setTimeout(dismiss, duration)
    t.addEventListener('click', dismiss)
    return dismiss
  }

  window.notify = {
    success: function (m, o) { return show('success', m, o) },
    error:   function (m, o) { return show('error',   m, o) },
    warning: function (m, o) { return show('warning', m, o) },
    info:    function (m, o) { return show('info',    m, o) },
  }
})()
