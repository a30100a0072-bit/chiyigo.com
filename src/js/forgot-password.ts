// Stage 5 PR-5d (2026-05-22)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl（getLang / T / applyLang / handleSubmit / setMsg）
// 在同 tsc program 全域 scope 撞名 → TS2393。內層 mobile-overlay / theme-lang
// 既有 IIFE 維持不動。
;(function () {
const I18N = /*@i18n@*/{};

// Cloudflare Turnstile widget global（由 <script src="https://challenges.cloudflare.com/turnstile/v0/api.js">
// 注入）；本檔只用 .reset?.()，因此 shape 故意極小。改用 inline cast 而非
// `interface Window` 全域擴增，因為 root tsconfig (moduleDetection:"force") 下
// 本檔被當 module、top-level interface Window 變 module-local 而非 global
// augmentation；prod tsconfig (moduleDetection:"auto" + 無 import/export) 下才
// 是 script。inline cast 同時相容兩種模式。
type WindowWithTurnstile = Window & { turnstile?: { reset?: () => void } };

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

function applyLang(lang) {
  try { localStorage.setItem('lang', lang) } catch {}
  document.documentElement.lang = lang;
  const dict = I18N[lang] || I18N['zh-TW'];
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (k && dict[k] != null) el.textContent = dict[k];
  });
  document.querySelectorAll<HTMLElement>('.lang-opt,.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
});

async function handleSubmit(e) {
  e.preventDefault();
  const btn   = document.getElementById('submit-btn') as HTMLButtonElement | null;
  const email = (document.getElementById('email') as HTMLInputElement | null)?.value.trim() ?? '';

  setMsg('');

  const tsToken = document.querySelector<HTMLInputElement>('#form-forgot [name="cf-turnstile-response"]')?.value || '';
  const hasTsWidget = !!document.querySelector('#form-forgot .cf-turnstile');
  if (hasTsWidget && !tsToken) {
    setMsg(T('err_captcha_pending'), 'error');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = T('loading'); }

  try {
    const res = await fetch('/api/auth/local/forgot-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, 'cf-turnstile-response': tsToken }),
    });

    if (res.ok) {
      const form = document.getElementById('form-forgot');
      if (form) form.hidden = true;
      const success = document.getElementById('success-state');
      if (success) success.hidden = false;
      return;
    }

    const data = await res.json().catch(() => ({}));
    setMsg(data.error ?? T('err_generic'), 'error');
    try { (window as WindowWithTurnstile).turnstile?.reset?.() } catch {}
  } catch {
    setMsg(T('err_network'), 'error');
    try { (window as WindowWithTurnstile).turnstile?.reset?.() } catch {}
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = T('btn_submit'); }
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
    const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang); langDrop.classList.remove('open');
  });
  mLangDrop?.addEventListener('click', e => {
    const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang); mLangDrop.classList.remove('open');
  });
  document.querySelector('.m-ov-lang-row')?.addEventListener('click', e => {
    const opt = (e.target as Element | null)?.closest<HTMLElement>('.m-ov-lang-opt'); if (!opt) return;
    applyLang(opt.dataset.lang);
  });
})();
})();
