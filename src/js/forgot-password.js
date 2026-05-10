const I18N = /*@i18n@*/{};

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

function applyPageI18n(lang) {
  const dict = I18N[lang] || I18N['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (dict[k] != null) el.textContent = dict[k];
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyPageI18n(getLang());
  // theme/lang 切換交給 sidebar-auth.js / 各頁 page JS（partial 提供 #theme-toggle-btn / #lang-toggle-btn / #lang-dropdown）
});

async function handleSubmit(e) {
  e.preventDefault();
  const btn   = document.getElementById('submit-btn');
  const email = document.getElementById('email').value.trim();

  setMsg('');

  const tsToken = document.querySelector('#form-forgot [name="cf-turnstile-response"]')?.value || '';
  const hasTsWidget = !!document.querySelector('#form-forgot .cf-turnstile');
  if (hasTsWidget && !tsToken) {
    setMsg(T('err_captcha_pending'), 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = T('loading');

  try {
    const res = await fetch('/api/auth/local/forgot-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, 'cf-turnstile-response': tsToken }),
    });

    if (res.ok) {
      document.getElementById('form-forgot').hidden = true;
      document.getElementById('success-state').hidden = false;
      return;
    }

    const data = await res.json().catch(() => ({}));
    setMsg(data.error ?? T('err_generic'), 'error');
    try { window.turnstile?.reset?.() } catch {}
  } catch {
    setMsg(T('err_network'), 'error');
    try { window.turnstile?.reset?.() } catch {}
  } finally {
    btn.disabled = false;
    btn.textContent = T('btn_submit');
  }
}

function setMsg(text, type = 'error') {
  const box = document.getElementById('msg-box');
  if (!text) { box.style.display = 'none'; box.textContent = ''; return; }
  box.textContent = text;
  box.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success');
  box.style.display = 'block';
}

document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);

// ── Mobile overlay (m-ham-btn / m-overlay open-close) ──
(function () {
  const hamBtn  = document.getElementById('m-ham-btn');
  const overlay = document.getElementById('m-overlay');
  const topbar  = document.getElementById('m-topbar');
  function openMenu() {
    hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open');
    overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden');
    topbar?.classList.add('menu-open'); document.body.style.overflow='hidden';
  }
  function closeMenu() {
    hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open');
    overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true');
    topbar?.classList.remove('menu-open'); document.body.style.overflow='';
  }
  hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
  overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
  overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });
})();
