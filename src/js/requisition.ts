// requisition — /requisition.html page entry
// Stage 5 PR-5s (2026-05-22)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl（form / formError / submitBtn / btnText /
// btnLoad / btnIcon / formSucc / setLoading / showErr / clearErr / hamBtn /
// overlay / topbar / openMenu / closeMenu / themeBtn / mThemeBtn / applyTheme
// / doToggle / LANGS_I18N / curLangI / applyLangI / langTogBtnI / langDropI /
// toggleTopLangDrop / osContent / revRoot / revObs）在同 tsc program 全域
// scope 撞名 → TS2393。內層 drag-to-close 與 neural-canvas 既有 IIFE 維持
// 不動；Phase C-3 m-lang-btn 單行 wire 收進外層 IIFE 末段。
//
// API flow 0 行為變更（per [[feedback_security_boundary_pr_first_do_no_harm]]）:
// form submit handler 對 /api/requisition POST payload / 401/429/4xx 處理 /
// guest_id device_uuid 全 byte-equivalent；只在 DOM 端補 TS narrow，runtime
// emit 等同原 .js。
;(function () {

// 共用 form 欄位 union — name/company/contact:input, service_type/budget/timeline:select,
// message:textarea。三者皆有 .value:string，runtime 同 duck-type
type FormField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// ── Form submission ──────────────────────────────────
const form      = document.getElementById('contact-form') as HTMLFormElement | null;
const formError = document.getElementById('form-error');
const submitBtn = document.getElementById('submit-btn');
const btnText   = submitBtn?.querySelector<HTMLElement>('.btn-text');
const btnLoad   = submitBtn?.querySelector<HTMLElement>('.btn-loading');
const btnIcon   = submitBtn?.querySelector<HTMLElement>('.btn-icon');
const formSucc  = document.getElementById('form-success');

function setLoading(on) {
  if (!submitBtn || !btnText || !btnLoad || !btnIcon) return;
  submitBtn.toggleAttribute('disabled', on);
  btnText.hidden = on;
  btnLoad.hidden = !on;
  btnIcon.hidden = on;
}
function showErr(msg) { if (formError) { formError.textContent = msg; formError.classList.add('visible'); } }
function clearErr()   { if (formError) { formError.textContent = '';  formError.classList.remove('visible'); } }

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErr();

  let ok = true;
  form.querySelectorAll('[required]').forEach(el => {
    const field = el as FormField;
    if (field.value.trim()) { field.classList.remove('field-error'); }
    else { field.classList.add('field-error'); ok = false; }
  });
  if (!ok) {
    showErr('// error: 請填寫所有必填欄位');
    form.querySelector('.field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const contactEl = form.querySelector('[name="contact"]') as HTMLInputElement | null;
  if (contactEl) {
    const v = contactEl.value.trim();
    if (!/.+@.+\..+/.test(v) && !/^09\d{8}$/.test(v) && !/^[a-zA-Z0-9._\-@]{4,}$/.test(v)) {
      contactEl.classList.add('field-error');
      showErr('// error: 請填寫有效的聯絡方式（Email / LINE ID / 手機號碼）');
      contactEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }

  setLoading(true);
  try {
    // 各欄位取值：原 .js 對 querySelector 結果直接 .value（runtime 對 null 會 throw）；
    // `as FormField`（無 `| null` union）保留原 throw 語意（zero-drift），requisition
    // markup 100% 含這些 named field（前段 .querySelectorAll('[required]') 已走過全表）
    const payload: Record<string, string> = {
      name:         (form.querySelector('[name="name"]')         as FormField).value.trim(),
      company:      (form.querySelector('[name="company"]')      as FormField).value.trim(),
      contact:      (form.querySelector('[name="contact"]')      as FormField).value.trim(),
      service_type: (form.querySelector('[name="service_type"]') as FormField).value,
      budget:       (form.querySelector('[name="budget"]')       as FormField).value,
      timeline:     (form.querySelector('[name="timeline"]')     as FormField).value,
      message:      (form.querySelector('[name="message"]')      as FormField).value.trim(),
    };
    const _token = sessionStorage.getItem('access_token');
    const fetchHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (_token) fetchHeaders['Authorization'] = 'Bearer ' + _token;
    // 訪客 guest_id：每瀏覽器一次性 web-<uuid>，註冊時 takeover 此 requisition
    let _devId: string | null = null;
    try {
      const KEY = 'chiyigo.device_uuid';
      _devId = localStorage.getItem(KEY);
      if (!_devId || !/^web-[0-9a-f-]{36}$/i.test(_devId)) {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          _devId = 'web-' + crypto.randomUUID();
          localStorage.setItem(KEY, _devId);
        } else {
          _devId = null;
        }
      }
    } catch (_) { _devId = null; }
    if (_devId) {
      fetchHeaders['X-Device-Id'] = _devId;
      payload.guest_id = _devId;
    }
    const res = await fetch('/api/requisition', {
      method:  'POST',
      headers: fetchHeaders,
      body:    JSON.stringify(payload),
    });
    if (res.status === 401) {
      sessionStorage.removeItem('access_token');
      showErr('// error: 認證失敗，請重新整理後再試');
      setLoading(false);
      return;
    }
    if (res.status === 429) {
      const d = await res.json().catch(() => ({}));
      showErr('// error: ' + (d.error ?? '今日提單次數已達上限'));
      setLoading(false);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    const json = await res.json();
    setLoading(false);
    if (form) form.style.display = 'none';
    if (formSucc) formSucc.classList.add('visible');
    const ref = document.getElementById('success-ref');
    if (ref && json.id) ref.textContent = `// ref: #${json.id}`;
    // 已登入 user → 顯示「立即付款」連結，帶 requisition_id 進 payment 表單
    const payLink = document.getElementById('success-pay-link') as HTMLAnchorElement | null;
    if (payLink && json.id && _token) {
      payLink.href = `/dashboard.html?req=${encodeURIComponent(json.id)}#payments-section`;
      payLink.classList.remove('hidden');
    }
  } catch (err) {
    showErr('// error: 送出失敗，請稍後再試，或直接 LINE / Email 聯絡我');
    setLoading(false);
  }
});

form?.addEventListener('input', (e) => { (e.target as Element | null)?.classList.remove('field-error'); });

// ── Mobile overlay ──────────────────────────────────
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');

function openMenu() {
  hamBtn?.setAttribute('aria-expanded', 'true');
  hamBtn?.classList.add('is-open');
  overlay?.classList.add('is-open');
  overlay?.removeAttribute('aria-hidden');
  topbar?.classList.add('menu-open');
  document.body.classList.add('body-lock');
}
function closeMenu() {
  hamBtn?.setAttribute('aria-expanded', 'false');
  hamBtn?.classList.remove('is-open');
  overlay?.classList.remove('is-open');
  overlay?.setAttribute('aria-hidden', 'true');
  topbar?.classList.remove('menu-open');
  document.body.classList.remove('body-lock');
}
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// ── Drag-to-close (bottom sheet swipe down) ──────────
;(function () {
  const THRESHOLD = 110
  let startY = 0, lastY = 0, active = false
  document.addEventListener('touchstart', function (e) {
    const ov = document.getElementById('m-overlay')
    if (!ov || !ov.classList.contains('is-open')) return
    const wrap = ov.querySelector<HTMLElement>('.m-ov-wrap')
    if (!wrap) return
    const t = e.touches[0], r = wrap.getBoundingClientRect()
    if (t.clientY < r.top || t.clientY > r.bottom) return
    const nav = wrap.querySelector<HTMLElement>('.m-ov-nav')
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
    const wrap = ov && ov.querySelector<HTMLElement>('.m-ov-wrap')
    if (!wrap || !ov) return
    wrap.style.transform = `translateY(${dy}px)`
    const ratio = Math.max(0, 1 - dy / wrap.offsetHeight * 1.5)
    ov.style.background = `rgba(10,12,28,${(0.32 * ratio).toFixed(3)})`
    e.preventDefault()
  }, { passive: false })
  document.addEventListener('touchend', function () {
    if (!active) return
    active = false
    const ov = document.getElementById('m-overlay')
    const wrap = ov && ov.querySelector<HTMLElement>('.m-ov-wrap')
    if (!wrap || !ov) { startY = 0; lastY = 0; return }
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
        document.body.classList.remove('body-lock')
      }, 260)
    } else {
      wrap.style.transition = 'transform .42s cubic-bezier(.22,1,.36,1)'
      wrap.style.transform = ''
      setTimeout(() => { wrap.style.transition = '' }, 420)
    }
    startY = 0; lastY = 0
  }, { passive: true })
})()

// ── Theme toggle ──────────────────────────────────
const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');

function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  [themeBtn, mThemeBtn].forEach(btn => {
    if (!btn) return;
    const sun  = btn.querySelector<HTMLElement>('.icon-sun');
    const moon = btn.querySelector<HTMLElement>('.icon-moon');
    if (sun)  sun.hidden = dark;
    if (moon) moon.hidden = !dark;
  });
}
applyTheme(localStorage.getItem('theme') !== 'light');
const doToggle = () => {
  const isDark = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  applyTheme(isDark);
};
themeBtn?.addEventListener('click', doToggle);
mThemeBtn?.addEventListener('click', doToggle);

// ── i18n ──────────────────────────────────────────────
const LANGS_I18N = /*@i18n@*/{};
let curLangI = localStorage.getItem('lang') || 'zh-TW';
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLangI = lang;
  const t = LANGS_I18N[lang];
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (k && t[k] !== undefined) el.textContent = t[k]; });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (k && t[k] !== undefined) el.placeholder = t[k]; });
  const tBtn = document.getElementById('theme-toggle-btn');
  const lBtn = document.getElementById('lang-toggle-btn');
  if (tBtn) { tBtn.title = t.tooltip_theme; tBtn.setAttribute('aria-label', t.tooltip_theme); }
  if (lBtn) { lBtn.title = t.tooltip_lang; lBtn.setAttribute('aria-label', t.tooltip_lang); }
  document.querySelectorAll<HTMLElement>('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll<HTMLElement>('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
}
const langTogBtnI = document.getElementById('lang-toggle-btn');
const langDropI   = document.getElementById('lang-dropdown');
langTogBtnI?.addEventListener('click', e => { e.stopPropagation(); langDropI?.classList.toggle('open'); });
document.addEventListener('click', () => { langDropI?.classList.remove('open'); document.getElementById('m-top-lang-drop')?.classList.remove('open'); });
langDropI?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDropI.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.m-ov-lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); });
// toggleTopLangDrop：原 .js bare .classList.toggle('open') 對 null 會 throw；用非空斷言保留原 throw 語意
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop')!.classList.toggle('open'); }
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop')!.classList.remove('open'); });
applyLangI(curLangI);

// ── Reveal animation ──────────────────────────────
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// ── Contact: Email (L2 obfuscation — no plaintext mailto in DOM) ──
document.getElementById('btn-contact-email')?.addEventListener('click', function () {
  var u = ['chiyigo', '20201208'].join('');
  var d = ['gmail', 'com'].join('.');
  var el = document.createElement('a');
  el.setAttribute('href', 'mailto:' + u + '\x40' + d);
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
});

// ── Contact: LINE (Worker redirect — no raw LINE URL in frontend) ──
document.getElementById('btn-contact-line')?.addEventListener('click', function () {
  window.open('/api/redirect/line', '_blank', 'noopener,noreferrer');
});

// ── block 2/2 ──
(function () {
  const canvas = document.getElementById('neural-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let W = 0, H = 0, nodes = [];
  const DIST = 155;

  function resize() { W = canvas!.width = window.innerWidth; H = canvas!.height = window.innerHeight; }
  function initNodes() {
    const n = W < 768 ? 48 : 115;
    nodes = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .28, vy: (Math.random() - .5) * .28,
      r: Math.random() * 1.1 + .4, pulse: Math.random() * Math.PI * 2,
    }));
  }
  const mouse = { x: -9999, y: -9999 };
  document.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });

  let cfg = { r: '108', g: '110', b: '229', no: .22, lo: .09 };
  function syncCfg() {
    const s = getComputedStyle(document.documentElement);
    cfg = {
      r:  s.getPropertyValue('--neural-r').trim()            || '108',
      g:  s.getPropertyValue('--neural-g').trim()            || '110',
      b:  s.getPropertyValue('--neural-b').trim()            || '229',
      no: parseFloat(s.getPropertyValue('--neural-node-opacity').trim() || '.22'),
      lo: parseFloat(s.getPropertyValue('--neural-line-opacity').trim() || '.09'),
    };
  }
  syncCfg();
  new MutationObserver(syncCfg).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  function draw() {
    ctx!.clearRect(0, 0, W, H);
    const { r, g, b, no, lo } = cfg;
    for (const n of nodes) {
      const dx = n.x - mouse.x, dy = n.y - mouse.y, d2 = dx * dx + dy * dy;
      if (d2 < 16900) { const d = Math.sqrt(d2); n.vx += dx / d * .055; n.vy += dy / d * .055; }
      n.vx *= .982; n.vy *= .982;
      n.x += n.vx; n.y += n.vy;
      if (n.x < -12) n.x = W + 12; else if (n.x > W + 12) n.x = -12;
      if (n.y < -12) n.y = H + 12; else if (n.y > H + 12) n.y = -12;
      n.pulse += .011;
      const p = Math.sin(n.pulse) * .25 + .75;
      ctx!.beginPath(); ctx!.arc(n.x, n.y, n.r * p, 0, Math.PI * 2);
      ctx!.fillStyle = `rgba(${r},${g},${b},${no * p})`; ctx!.fill();
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy;
        if (d2 < DIST * DIST) {
          const a = (1 - Math.sqrt(d2) / DIST) * lo;
          ctx!.beginPath(); ctx!.moveTo(nodes[i].x, nodes[i].y); ctx!.lineTo(nodes[j].x, nodes[j].y);
          ctx!.strokeStyle = `rgba(${r},${g},${b},${a})`; ctx!.lineWidth = .5; ctx!.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  }
  resize(); initNodes(); draw();
  window.addEventListener('resize', () => { resize(); initNodes(); });
})();

// ── Phase C-3 m-lang-btn wire ──
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);

})();
