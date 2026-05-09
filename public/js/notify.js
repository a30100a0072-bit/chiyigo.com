/* notify.js — 全站 toast 系統
 *   window.notify.success(msg[, opts])
 *   window.notify.error(msg[, opts])
 *   window.notify.warning(msg[, opts])
 *   window.notify.info(msg[, opts])
 *
 * opts: { duration: number }  // 0 = 不自動消失；預設 4000ms
 * 回傳：dismiss() 函式（手動關閉）
 *
 * CSS 來自 _components.css 的 .toast-stack / .toast / .toast-{success,error,warning,info}
 */
;(function (global) {
  'use strict';
  let stack = null;

  function getStack() {
    if (stack && document.body.contains(stack)) return stack;
    stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'region');
    stack.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(stack);
    return stack;
  }

  function show(level, msg, opts) {
    opts = opts || {};
    const duration = typeof opts.duration === 'number' ? opts.duration : 4000;

    const t = document.createElement('div');
    t.className = 'toast toast-' + level;
    t.setAttribute('role', level === 'error' ? 'alert' : 'status');
    t.textContent = String(msg);

    getStack().appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });

    let timer = null;
    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      t.classList.remove('show');
      t.classList.add('leaving');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 260);
    }
    if (duration > 0) timer = setTimeout(dismiss, duration);
    t.addEventListener('click', dismiss);
    return dismiss;
  }

  global.notify = {
    success: function (m, o) { return show('success', m, o); },
    error:   function (m, o) { return show('error',   m, o); },
    warning: function (m, o) { return show('warning', m, o); },
    info:    function (m, o) { return show('info',    m, o); },
  };
})(window);
