;
(function () {
    'use strict';
    const win = window;
    if (win.__formEnterReady)
        return;
    win.__formEnterReady = true;
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter')
            return;
        if (ev.isComposing || ev.keyCode === 229)
            return;
        if (ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey)
            return;
        const el = ev.target;
        if (!el || el.tagName !== 'INPUT')
            return;
        const sel = el.getAttribute('data-enter-click');
        if (!sel)
            return;
        let btn = null;
        try {
            btn = document.querySelector(sel);
        }
        catch (_) {
            return;
        }
        if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true')
            return;
        ev.preventDefault();
        btn.click();
    });
})();
