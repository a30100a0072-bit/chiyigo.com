/* confirm-dialog.ts — 全站 confirm modal（取代 native confirm()）
 *   const ok = await window.confirmDialog({
 *     title: '刪除這筆？',           // optional, 預設 '確認'
 *     message: '此操作不可復原。',    // optional
 *     confirmText: '刪除',           // optional, 預設 '確認'
 *     cancelText: '取消',            // optional, 預設 '取消'
 *     danger: true,                  // optional, 確認鈕用 .btn-danger
 *   });
 *   回傳 Promise<boolean>。
 *
 * Esc/點背景 → cancel；Enter（不在 cancel 鈕上時） → confirm。
 * Focus trap 鎖在 modal 內，關閉時還原原 focus。
 *
 * CSS 來自 _components.css 的 .modal-bd / .modal-card / .modal-head / .modal-body / .modal-footer
 *
 * Stage 5 PR-2 (2026-05-21)：自 public/js/confirm-dialog.js 收編進 src/js/，
 * 由 tsconfig.browser-classic.prod.json + build-partials 走 tsc emit
 * 回 public/js/confirm-dialog.js。classic IIFE shape；不引入 ESM 結構。
 * 收編動機：head-foot partial 已全站注入 → 已是 public runtime surface，
 * 補上 Window.confirmDialog ambient 收掉型別債，未來 admin/dashboard 刪除類
 * 操作可從 native confirm() 漸進替換（統一 UI / a11y / i18n / 可測試性）。
 */
;
(function () {
    'use strict';
    let openDialog = null;
    function getFocusables(root) {
        return root.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    }
    function trapFocus(root, e) {
        if (e.key !== 'Tab')
            return;
        const list = getFocusables(root);
        if (!list.length)
            return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            last.focus();
            e.preventDefault();
        }
        else if (!e.shiftKey && document.activeElement === last) {
            first.focus();
            e.preventDefault();
        }
    }
    window.confirmDialog = function (opts) {
        const o = opts || {};
        const title = o.title != null ? String(o.title) : '確認';
        const message = o.message != null ? String(o.message) : '';
        const confirmText = o.confirmText != null ? String(o.confirmText) : '確認';
        const cancelText = o.cancelText != null ? String(o.cancelText) : '取消';
        const danger = !!o.danger;
        return new Promise(function (resolve) {
            if (openDialog)
                openDialog.close(false);
            const bd = document.createElement('div');
            bd.className = 'modal-bd open';
            bd.setAttribute('role', 'alertdialog');
            bd.setAttribute('aria-modal', 'true');
            bd.setAttribute('aria-labelledby', '__cd-title');
            bd.setAttribute('aria-describedby', '__cd-msg');
            const card = document.createElement('div');
            card.className = 'modal-card';
            card.style.maxWidth = '420px';
            const head = document.createElement('div');
            head.className = 'modal-head';
            const h2 = document.createElement('h2');
            h2.id = '__cd-title';
            h2.textContent = title;
            head.appendChild(h2);
            const body = document.createElement('div');
            body.className = 'modal-body';
            const p = document.createElement('p');
            p.id = '__cd-msg';
            p.style.margin = '0';
            p.style.lineHeight = '1.6';
            p.textContent = message;
            body.appendChild(p);
            const footer = document.createElement('div');
            footer.className = 'modal-footer';
            const btnCancel = document.createElement('button');
            btnCancel.type = 'button';
            btnCancel.className = 'btn-ghost';
            btnCancel.dataset.act = 'cancel';
            btnCancel.textContent = cancelText;
            const btnOk = document.createElement('button');
            btnOk.type = 'button';
            btnOk.className = danger ? 'btn-danger' : 'btn-primary';
            btnOk.dataset.act = 'confirm';
            btnOk.textContent = confirmText;
            footer.appendChild(btnCancel);
            footer.appendChild(btnOk);
            card.appendChild(head);
            card.appendChild(body);
            card.appendChild(footer);
            bd.appendChild(card);
            // document.activeElement 回 Element | null；要呼 .focus() 需 narrow 成 HTMLElement
            const prevFocus = document.activeElement;
            function close(result) {
                document.removeEventListener('keydown', onKey);
                bd.removeEventListener('click', onClick);
                bd.classList.remove('open');
                setTimeout(function () { if (bd.parentNode)
                    bd.parentNode.removeChild(bd); }, 180);
                if (prevFocus && typeof prevFocus.focus === 'function') {
                    try {
                        prevFocus.focus();
                    }
                    catch (_) { /* noop */ }
                }
                openDialog = null;
                resolve(result);
            }
            function onKey(e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    close(false);
                    return;
                }
                if (e.key === 'Enter') {
                    const a = document.activeElement;
                    if (a && a.dataset && a.dataset.act === 'cancel')
                        return;
                    e.preventDefault();
                    close(true);
                    return;
                }
                trapFocus(card, e);
            }
            function onClick(e) {
                if (e.target === bd) {
                    close(false);
                    return;
                }
                const t = e.target;
                const act = t && t.dataset && t.dataset.act;
                if (act === 'cancel')
                    close(false);
                else if (act === 'confirm')
                    close(true);
            }
            bd.addEventListener('click', onClick);
            document.addEventListener('keydown', onKey);
            document.body.appendChild(bd);
            openDialog = { close: close };
            requestAnimationFrame(function () { btnOk.focus(); });
        });
    };
})();
