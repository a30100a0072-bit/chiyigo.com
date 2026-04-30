// Query param notifications
(function(){
  const p = new URLSearchParams(location.search);
  function showNotice(text, type) {
    const el = document.createElement('div');
    el.textContent = text;
    el.className = 'pre-notice ' + (type === 'ok' ? 'msg-success' : 'msg-error');
    el.style.display = 'block';
    const card = document.querySelector('.card');
    if (card) card.insertAdjacentElement('beforebegin', el);
  }
  if (p.has('verified')) {
    showNotice('✓ Email 驗證成功！請登入你的帳號。', 'ok');
    history.replaceState(null, '', '/login.html');
  } else if (p.has('verify_error')) {
    showNotice('驗證連結無效或已過期，請重新申請。', 'err');
    history.replaceState(null, '', '/login.html');
  } else if (p.has('password_reset')) {
    showNotice('✓ 密碼重設成功！請使用新密碼登入。', 'ok');
    history.replaceState(null, '', '/login.html');
  }
})();

// Theme toggle
function applyTheme(isDark) {
  document.documentElement.classList.toggle('theme-dark', isDark);
  document.documentElement.classList.toggle('theme-light', !isDark);
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  const dark = document.documentElement.classList.contains('theme-dark');
  document.querySelectorAll('.icon-sun').forEach(el => el.hidden = dark);
  document.querySelectorAll('.icon-moon').forEach(el => el.hidden = !dark);
}
(function initIcons() {
  const dark = document.documentElement.classList.contains('theme-dark');
  document.querySelectorAll('.icon-sun').forEach(el => el.hidden = dark);
  document.querySelectorAll('.icon-moon').forEach(el => el.hidden = !dark);
})();
document.getElementById('theme-toggle-btn').addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('theme-dark')));
document.getElementById('m-theme-btn').addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('theme-dark')));

// Mobile overlay
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
function openMenu() {
  hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open');
  overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';
}
function closeMenu() {
  hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open');
  overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true');
  document.body.style.overflow = '';
}
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// ── i18n ──────────────────────────────────────────────
const LANGS_I18N = /*@i18n@*/{};

const TAB_TITLES = {
  login:    { title: 'tab_login_title',    subtitle: 'tab_login_sub' },
  register: { title: 'tab_register_title', subtitle: 'tab_register_sub' },
  totp:     { title: 'tab_totp_title',     subtitle: 'tab_totp_sub' },
};

function applyLangI(lang) {
  localStorage.setItem('lang', lang);
  const t = LANGS_I18N[lang] || LANGS_I18N['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh; if (t[k] !== undefined) el.placeholder = t[k];
  });
  document.querySelectorAll('.lang-opt,.m-ov-lang-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // patch TAB_CONFIG and re-apply current tab title/subtitle
  if (typeof TAB_CONFIG !== 'undefined') {
    TAB_CONFIG.login    = { title: t.tab_login_title,    subtitle: t.tab_login_sub,    showTabs: true };
    TAB_CONFIG.register = { title: t.tab_register_title, subtitle: t.tab_register_sub, showTabs: true };
    TAB_CONFIG.totp     = { title: t.tab_totp_title,     subtitle: t.tab_totp_sub,     showTabs: false };
    const activePanelId = document.querySelector('.panel.active')?.id ?? 'form-login';
    const tabKey = activePanelId.replace('form-','');
    const titleEl    = document.getElementById('form-title');
    const subtitleEl = document.getElementById('form-subtitle');
    if (titleEl && TAB_CONFIG[tabKey])    titleEl.textContent    = TAB_CONFIG[tabKey].title;
    if (subtitleEl && TAB_CONFIG[tabKey]) subtitleEl.textContent = TAB_CONFIG[tabKey].subtitle;
  }
}

const curLangI = localStorage.getItem('lang') || 'zh-TW';
applyLangI(curLangI);

const langDropI = document.getElementById('lang-drop-i');
function toggleLangDrop(e) {
  e.stopPropagation();
  langDropI?.classList.toggle('open');
  document.getElementById('m-top-lang-drop')?.classList.remove('open');
}
function toggleTopLangDrop(e) {
  e.stopPropagation();
  document.getElementById('m-top-lang-drop')?.classList.toggle('open');
  langDropI?.classList.remove('open');
}
document.getElementById('sb-lang-btn')?.addEventListener('click', toggleLangDrop);
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);
document.addEventListener('click', () => {
  langDropI?.classList.remove('open');
  document.getElementById('m-top-lang-drop')?.classList.remove('open');
});
langDropI?.addEventListener('click', e => {
  const opt = e.target.closest('.lang-opt'); if (!opt) return;
  applyLangI(opt.dataset.lang); langDropI.classList.remove('open');
});
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => {
  const opt = e.target.closest('.lang-opt'); if (!opt) return;
  applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open');
});
document.querySelector('.m-ov-lang-row')?.addEventListener('click', e => {
  const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return;
  applyLangI(opt.dataset.lang);
});

// ── Drag-to-close (bottom sheet swipe down) ──────────
;(function () {
  const THRESHOLD = 110
  let startY = 0, lastY = 0, active = false
  document.addEventListener('touchstart', function (e) {
    const ov = document.getElementById('m-overlay')
    if (!ov || !ov.classList.contains('is-open')) return
    const wrap = ov.querySelector('.m-ov-wrap')
    if (!wrap) return
    const t = e.touches[0], r = wrap.getBoundingClientRect()
    if (t.clientY < r.top || t.clientY > r.bottom) return
    const nav = wrap.querySelector('.m-ov-nav')
    if (nav && nav.scrollTop > 0) {
      const nr = nav.getBoundingClientRect()
      if (t.clientY >= nr.top && t.clientY <= nr.bottom) return
    }
    startY = t.clientY; lastY = startY; active = true
    wrap.style.transition = 'none'
  }, { passive: true })
  document.addEventListener('touchmove', function (e) {
    if (!active) return
    lastY = e.touches[0].clientY
    const dy = lastY - startY
    if (dy <= 0) return
    const ov = document.getElementById('m-overlay')
    const wrap = ov && ov.querySelector('.m-ov-wrap')
    if (!wrap) return
    wrap.style.transform = `translateY(${dy}px)`
    const ratio = Math.max(0, 1 - dy / wrap.offsetHeight * 1.5)
    ov.style.background = `rgba(10,12,28,${(0.32 * ratio).toFixed(3)})`
    e.preventDefault()
  }, { passive: false })
  document.addEventListener('touchend', function () {
    if (!active) return
    active = false
    const ov = document.getElementById('m-overlay')
    const wrap = ov && ov.querySelector('.m-ov-wrap')
    if (!wrap) { startY = 0; lastY = 0; return }
    const dy = lastY - startY
    ov.style.background = ''
    if (dy > THRESHOLD) {
      wrap.style.transition = 'transform .26s ease'
      wrap.style.transform = 'translateY(100%)'
      setTimeout(() => {
        wrap.style.transform = ''; wrap.style.transition = ''
        ov.classList.remove('is-open')
        ov.setAttribute('aria-hidden', 'true')
        const btn = document.getElementById('m-ham-btn')
        btn?.classList.remove('is-open')
        btn?.setAttribute('aria-expanded', 'false')
        document.getElementById('m-topbar')?.classList.remove('menu-open')
        document.body.style.overflow = ''
      }, 260)
    } else {
      wrap.style.transition = 'transform .42s cubic-bezier(.22,1,.36,1)'
      wrap.style.transform = ''
      setTimeout(() => { wrap.style.transition = '' }, 420)
    }
    startY = 0; lastY = 0
  }, { passive: true })
})()
