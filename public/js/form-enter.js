/* form-enter.js — 全站表單 Enter 鍵 UX 統一處理
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
 *   - 排除 textarea / contentEditable（避免吃掉換行）
 *   - 已 disabled 的 button 不觸發
 *   - 全站只掛一次 document-level delegation
 */
;(function () {
  'use strict';
  if (window.__formEnterReady) return;
  window.__formEnterReady = true;

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    if (ev.isComposing || ev.keyCode === 229) return;
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey) return;

    const el = ev.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (el.type === 'textarea' || el.isContentEditable) return;

    const sel = el.getAttribute('data-enter-click');
    if (!sel) return;

    let btn = null;
    try { btn = document.querySelector(sel); } catch (_) { return; }
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') return;

    ev.preventDefault();
    btn.click();
  });
})();
