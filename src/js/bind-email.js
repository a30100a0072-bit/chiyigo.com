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
  document.querySelectorAll('.lang-opt,.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
  // theme/lang 切換交給 sidebar-auth.js
});

// ── 補填信箱流程 ─────────────────────────────────────────────
const bindToken = new URLSearchParams(location.search).get('token')

if (!bindToken) showPanel('panel-invalid')

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

function showMsg(text, isError = true) {
  const box = document.getElementById('msg-box')
  box.textContent = text
  box.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success')
  box.style.display = 'block'
}

async function handleSubmit(e) {
  e.preventDefault()
  const btn   = document.getElementById('submit-btn')
  const email = document.getElementById('email-input').value.trim()

  btn.disabled    = true
  btn.textContent = T('loading')

  try {
    const res  = await fetch('/api/auth/oauth/bind-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: bindToken, email }),
    })
    const data = await res.json()

    if (!res.ok) {
      if (res.status === 401 || res.status === 410) {
        showPanel('panel-invalid')
        return
      }
      showMsg(data.error ?? T('err_default'))
      return
    }

    try { sessionStorage.setItem('access_token', data.access_token) } catch (_) {}
    location.replace('/dashboard.html')

  } catch {
    showMsg(T('err_network'))
  } finally {
    btn.disabled    = false
    btn.textContent = T('btn_submit')
  }
}

// ── Phase C-3 listener wiring ──
document.getElementById('panel-form')?.addEventListener('submit', handleSubmit);

document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);

// ── Mobile overlay (m-ham-btn / m-overlay open-close) ──
(function () {
  const hamBtn  = document.getElementById('m-ham-btn');
  const overlay = document.getElementById('m-overlay');
  const topbar  = document.getElementById('m-topbar');
  function openMenu() {
    hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open');
    overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden');
    topbar?.classList.add('menu-open'); document.body.classList.add('body-lock');
  }
  function closeMenu() {
    hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open');
    overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true');
    topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock');
  }
  hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
  overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
  overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });
})();

// ── theme toggle + lang dropdown (sidebar / mobile topbar) ──
(function () {
  function applyTheme(dark) {
    document.documentElement.classList.toggle('theme-dark', dark);
    document.documentElement.classList.toggle('theme-light', !dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch {}
  }
  const toggleTheme = () => applyTheme(!document.documentElement.classList.contains('theme-dark'));
  document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);
  document.getElementById('m-theme-btn')?.addEventListener('click', toggleTheme);

  const langDrop  = document.getElementById('lang-dropdown');
  const mLangDrop = document.getElementById('m-top-lang-drop');
  document.getElementById('lang-toggle-btn')?.addEventListener('click', e => {
    e.stopPropagation(); langDrop?.classList.toggle('open'); mLangDrop?.classList.remove('open');
  });
  document.getElementById('m-lang-btn')?.addEventListener('click', e => {
    e.stopPropagation(); mLangDrop?.classList.toggle('open'); langDrop?.classList.remove('open');
  });
  document.addEventListener('click', () => {
    langDrop?.classList.remove('open');
    mLangDrop?.classList.remove('open');
  });
  langDrop?.addEventListener('click', e => {
    const opt = e.target.closest('.lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang); langDrop.classList.remove('open');
  });
  mLangDrop?.addEventListener('click', e => {
    const opt = e.target.closest('.lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang); mLangDrop.classList.remove('open');
  });
  document.querySelector('.m-ov-lang-row')?.addEventListener('click', e => {
    const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang);
  });
})();
