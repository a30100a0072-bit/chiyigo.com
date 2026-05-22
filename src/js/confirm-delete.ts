// Stage 5 PR-5c (2026-05-22)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl（getLang / T / applyLang / showPanel / setMsg /
// confirmDelete / startCountdown / token）在同 tsc program 全域 scope 撞名 →
// TS2393。內層 mobile-overlay / theme-lang 既有 IIFE 維持不動。
;(function () {
// ── i18n ─────────────────────────────────────────────────────
const I18N = /*@i18n@*/{};

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
  const btn = document.getElementById('confirm-btn') as HTMLButtonElement | null
  if (btn) { btn.disabled = true; btn.textContent = T('loading'); }
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
      if (btn) { btn.disabled = false; btn.textContent = T('btn_confirm'); }
    }
  }
}

function startCountdown() {
  let sec = 5
  const el = document.getElementById('countdown')
  const iv = setInterval(() => {
    sec--
    if (el) el.textContent = String(sec)
    if (sec <= 0) { clearInterval(iv); location.href = '/login.html' }
  }, 1000)
}

// ── Phase C-3 listener wiring ──
document.getElementById('confirm-btn')?.addEventListener('click', confirmDelete);

// Stage 5 PR-5c cleanup：移除 dead copy-paste / latent hazard
//   原：`document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);`
//   confirm-delete page 沒有 #form-forgot 且 handleSubmit 未定義；
//   optional chaining 在 null 時短路，handleSubmit 不會被求值（無 runtime
//   ReferenceError），但 .ts strict 編譯期會直接報 TS2304；同時這是從
//   forgot-password.js 複製過來的殘骸 — 若日後有人加上 #form-forgot 立即爆。
//   （與 PR-5 verify-email 同款 cleanup）

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
