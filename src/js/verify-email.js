// ── i18n ─────────────────────────────────────────────────────
const I18N = /*@i18n@*/{};

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

function applyLang(lang) {
  try { localStorage.setItem('lang', lang) } catch {}
  document.documentElement.lang = lang;
  const dict = I18N[lang] || I18N['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (dict[k] != null) el.textContent = dict[k];
  });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
  // theme/lang 切換交給 sidebar-auth.js
});

// ── 驗證流程 ─────────────────────────────────────────────────
(() => {
  const params = new URLSearchParams(location.search)
  const token  = params.get('token')

  const panels = {
    confirm: document.getElementById('panel-confirm'),
    loading: document.getElementById('panel-loading'),
    success: document.getElementById('panel-success'),
    error:   document.getElementById('panel-error'),
  }
  const show = name => {
    Object.values(panels).forEach(p => p.classList.remove('active'))
    panels[name].classList.add('active')
  }

  if (!token) {
    document.getElementById('btn-verify').disabled = true
    document.getElementById('err-missing').classList.remove('hidden')
    return
  }

  document.getElementById('btn-verify').addEventListener('click', async () => {
    show('loading')
    try {
      const r = await fetch('/api/auth/email/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok) {
        show('success')
        setTimeout(() => { location.href = '/login.html?verified=1' }, 1500)
      } else {
        // 後端錯誤：保留 backend message（已經是英/中），無對應 i18n key 時 fallback
        document.getElementById('err-msg').textContent = data.error ?? T('err_default')
        show('error')
      }
    } catch {
      document.getElementById('err-msg').textContent = T('err_network')
      show('error')
    }
  })
})()

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
