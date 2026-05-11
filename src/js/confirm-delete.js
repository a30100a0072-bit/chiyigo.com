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

// ── 刪除帳號流程 ─────────────────────────────────────────────
const token = new URLSearchParams(location.search).get('token') ?? ''

if (!token) showPanel('panel-invalid')

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

function setMsg(text, type = 'error') {
  const box = document.getElementById('msg-box')
  if (!text) { box.style.display = 'none'; box.textContent = ''; return }
  box.textContent = text
  box.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success')
  box.style.display = 'block'
}

async function confirmDelete() {
  const btn = document.getElementById('confirm-btn')
  btn.disabled = true
  btn.textContent = T('loading')
  setMsg('')

  try {
    const res  = await fetch('/api/auth/delete/confirm', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    })
    const data = await res.json().catch(() => ({}))

    if (res.ok) {
      showPanel('panel-success')
      startCountdown()
      return
    }

    if (res.status === 400) {
      showPanel('panel-invalid')
      return
    }

    setMsg(data.error ?? T('err_default'))
  } catch {
    setMsg(T('err_network'))
  } finally {
    if (!document.getElementById('panel-success').classList.contains('active') &&
        !document.getElementById('panel-invalid').classList.contains('active')) {
      btn.disabled = false
      btn.textContent = T('btn_confirm')
    }
  }
}

function startCountdown() {
  let sec = 5
  const el = document.getElementById('countdown')
  const iv = setInterval(() => {
    sec--
    el.textContent = sec
    if (sec <= 0) { clearInterval(iv); location.href = '/login.html' }
  }, 1000)
}

// ── Phase C-3 listener wiring ──
document.getElementById('confirm-btn')?.addEventListener('click', confirmDelete);

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
