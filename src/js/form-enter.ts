/* form-enter.ts — 全站表單 Enter 鍵 UX 統一處理
 *
 * 兩種觸發方式（自動，無須註冊）：
 *
 *   1) data-enter-click="<css-selector>"
 *      input 在 Enter 時觸發符合 selector 的第一個 button.click() ——
 *      用於「裸 input + button」非 form 結構（dashboard OTP / 修改密碼 / 刪帳）。
 *      範例： data-enter-click="#submit-btn"
 *             data-enter-click='[data-action="confirm-enable-2fa"]'
 *
 *   2) <form> 內的 input
 *      原生瀏覽器行為已支援，本檔不介入；只在 IME composition 期間擋住誤觸。
 *
 * 設計原則：
 *   - keydown 階段判斷，攔 Enter (key === 'Enter')
 *   - 排除 IME 組字中 (isComposing / keyCode 229)
 *   - 只處理 <input> 元素（textarea / contentEditable 天然排除）
 *   - 已 disabled 的 button 不觸發
 *   - 全站只掛一次 document-level delegation
 *
 * Stage 4.5b-1 (PR-56)：自 public/js/form-enter.js 收編進 src/js/，
 * 由 tsconfig.browser-classic.prod.json + build-partials 走 tsc emit
 * 回 public/js/form-enter.js。classic IIFE shape；不引入 ESM 結構。
 */
interface FormEnterWindow extends Window {
  __formEnterReady?: boolean
}

;(function () {
  'use strict'
  const win = window as FormEnterWindow
  if (win.__formEnterReady) return
  win.__formEnterReady = true

  document.addEventListener('keydown', function (ev: KeyboardEvent) {
    if (ev.key !== 'Enter') return
    if (ev.isComposing || ev.keyCode === 229) return
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return

    const el = ev.target as HTMLElement | null
    if (!el || el.tagName !== 'INPUT') return

    const sel = el.getAttribute('data-enter-click')
    if (!sel) return

    let btn: (HTMLElement & { disabled?: boolean }) | null = null
    try {
      btn = document.querySelector(sel) as (HTMLElement & { disabled?: boolean }) | null
    } catch (_) {
      return
    }
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return

    ev.preventDefault()
    btn.click()
  })
})()
