// ── block 1/2 ──
// ── 顯示/語系/主題等共用邏輯（與 requisition.html 對齊） ───────────
const TOKEN_KEY = 'access_token';

// ── Mobile overlay ──────────────────────────────────
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu()  { hamBtn?.setAttribute('aria-expanded','true');  hamBtn?.classList.add('is-open');    overlay?.classList.add('is-open');    overlay?.removeAttribute('aria-hidden');  topbar?.classList.add('menu-open');    document.body.style.overflow='hidden'; }
function closeMenu() { hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.style.overflow=''; }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// ── Theme toggle ──────────────────────────────────
const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');
function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  [themeBtn, mThemeBtn].forEach(btn => {
    if (!btn) return;
    const sun  = btn.querySelector('.icon-sun');
    const moon = btn.querySelector('.icon-moon');
    if (sun)  sun.style.display  = dark ? 'none' : '';
    if (moon) moon.style.display = dark ? ''     : 'none';
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
let curLang = localStorage.getItem('lang') || 'zh-TW';
function applyLang(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = LANGS_I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (t[k] !== undefined) el.placeholder = t[k]; });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  // 若 result 已顯示，重新渲染欄位中文
  if (window._lastAiResult) renderResult(window._lastAiResult);
}
const langTogBtn = document.getElementById('lang-toggle-btn');
const langDrop   = document.getElementById('lang-dropdown');
langTogBtn?.addEventListener('click', e => { e.stopPropagation(); langDrop?.classList.toggle('open'); });
document.addEventListener('click', () => { langDrop?.classList.remove('open'); document.getElementById('m-top-lang-drop')?.classList.remove('open'); });
langDrop?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); langDrop.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); });
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop').classList.toggle('open'); }
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
applyLang(curLang);

// ── Reveal animation ──────────────────────────────
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// ──────────────────────────────────────────────────────
// ── AI assistant logic ────────────────────────────────
// ──────────────────────────────────────────────────────

// 簡易瀏覽器指紋（canvas + UA）— 不存任何 PII，僅用於限流維度
function fpHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}
function getFingerprint() {
  try {
    const c = document.createElement('canvas'); c.width = 200; c.height = 30;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top'; ctx.font = '14px Arial'; ctx.fillStyle = '#069';
    ctx.fillText('chiyigo-ai-' + navigator.platform, 2, 2);
    const data = c.toDataURL();
    return fpHash(data + '|' + navigator.userAgent + '|' + navigator.language + '|' + screen.width + 'x' + screen.height);
  } catch { return fpHash(navigator.userAgent + '|' + navigator.language); }
}
function getSessionId() {
  const KEY = 'ai_session_id';
  let s = null;
  try { s = sessionStorage.getItem(KEY); } catch {}
  if (!s) {
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    s = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem(KEY, s); } catch {}
  }
  return s;
}

// Cloudflare Turnstile — 部署後在此填入 sitekey 即啟用 widget
const TURNSTILE_SITEKEY = '';
let _turnstileToken = '';
function renderTurnstile() {
  if (!TURNSTILE_SITEKEY || !window.turnstile) return;
  window.turnstile.render('#turnstile-wrap', {
    sitekey: TURNSTILE_SITEKEY,
    callback: tok => { _turnstileToken = tok; },
    'error-callback': () => { _turnstileToken = ''; },
    'expired-callback': () => { _turnstileToken = ''; },
  });
}
window.onloadTurnstileCallback = renderTurnstile;
if (window.turnstile && TURNSTILE_SITEKEY) renderTurnstile();

const inputEl   = document.getElementById('ai-input');
const countEl   = document.getElementById('ai-count');
const errEl     = document.getElementById('ai-error');
const errEl2    = document.getElementById('ai-confirm-error');
const btnAnal   = document.getElementById('btn-analyze');
const btnConf   = document.getElementById('btn-confirm');
const btnRedo   = document.getElementById('btn-redo');
const cardRes   = document.getElementById('ai-result');
const cardSucc  = document.getElementById('ai-success');
const succRef   = document.getElementById('ai-success-ref');

inputEl?.addEventListener('input', () => {
  const len = inputEl.value.length;
  if (countEl) {
    countEl.textContent = len + ' / 500';
    countEl.classList.toggle('over', len > 500);
  }
});

function showErr(target, key) {
  const t = LANGS_I18N[curLang] || LANGS_I18N['zh-TW'];
  target.textContent = '// error: ' + (t[key] ?? key);
  target.classList.add('show');
}
function clearErr(target) { target.textContent = ''; target.classList.remove('show'); }

async function authedFetch(url, opts) {
  let token = sessionStorage.getItem(TOKEN_KEY);
  const doFetch = (tok) => fetch(url, {
    ...opts,
    credentials: 'include',
    headers: { ...(opts?.headers || {}), 'Content-Type': 'application/json', ...(tok ? { 'Authorization': 'Bearer ' + tok } : {}) },
  });
  let res = await doFetch(token);
  if (res.status === 401) {
    // try refresh once
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (r.ok) {
      const d = await r.json().catch(() => ({}));
      if (d.access_token) {
        sessionStorage.setItem(TOKEN_KEY, d.access_token);
        res = await doFetch(d.access_token);
      }
    }
  }
  return res;
}

let _lastResult = null;

function labelMap(field, value) {
  const t = LANGS_I18N[curLang] || LANGS_I18N['zh-TW'];
  const prefix = field === 'service' ? 'sv_'
               : field === 'budget'  ? 'bg_'
               : field === 'timeline'? 'tl_'
               : null;
  if (!prefix || !value) return value;
  const key = prefix + String(value).replace(/-/g, '_');
  return t[key] ?? value;
}

function renderResult(r) {
  window._lastAiResult = r;
  document.getElementById('r-service').textContent  = labelMap('service',  r.service_type);
  document.getElementById('r-budget').textContent   = labelMap('budget',   r.budget);
  document.getElementById('r-timeline').textContent = labelMap('timeline', r.timeline);
  document.getElementById('r-summary').textContent  = r.summary;
}

btnAnal?.addEventListener('click', async () => {
  clearErr(errEl);
  const prompt = (inputEl.value || '').trim();
  if (!prompt) return;
  if (prompt.length > 500) { showErr(errEl, 'err_too_long'); return; }

  btnAnal.classList.add('is-loading'); btnAnal.disabled = true;
  try {
    const res = await authedFetch('/api/ai/assist', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        fingerprint: getFingerprint(),
        session_id:  getSessionId(),
        turnstile_token: _turnstileToken,
      }),
    });

    if (res.status === 401) { showErr(errEl, 'err_auth'); setTimeout(() => location.replace('/login.html'), 1200); return; }
    if (res.status === 429) { showErr(errEl, 'err_rate_limit'); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.code === 'TOO_LONG')         showErr(errEl, 'err_too_long');
      else if (data.code === 'BLOCKED')     showErr(errEl, 'err_blocked');
      else if (data.code === 'AI_ERROR')    showErr(errEl, 'err_ai');
      else if (data.code === 'INVALID_OUTPUT') showErr(errEl, 'err_ai');
      else showErr(errEl, data.error || 'err_network');
      return;
    }
    _lastResult = data;
    renderResult(data);
    cardRes.classList.add('show');
    cardRes.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    showErr(errEl, 'err_network');
  } finally {
    btnAnal.classList.remove('is-loading'); btnAnal.disabled = false;
  }
});

btnRedo?.addEventListener('click', () => {
  cardRes.classList.remove('show');
  _lastResult = null;
  inputEl.focus();
});

btnConf?.addEventListener('click', async () => {
  clearErr(errEl2);
  if (!_lastResult) return;

  // 取得 user email 作為 contact，name 預設用 email 前段
  let me = null;
  try {
    const r = await authedFetch('/api/auth/me', { method: 'GET' });
    if (r.ok) me = await r.json();
  } catch {}
  if (!me?.email) { showErr(errEl2, 'err_auth'); return; }

  btnConf.classList.add('is-loading'); btnConf.disabled = true;
  try {
    const payload = {
      name:         me.email.split('@')[0],
      contact:      me.email,
      service_type: _lastResult.service_type,
      budget:       _lastResult.budget,
      timeline:     _lastResult.timeline,
      message:      'AI 助手生成：\n' + _lastResult.summary + '\n\n[原始輸入]\n' + (inputEl.value || '').trim(),
    };
    const res = await authedFetch('/api/requisition', { method: 'POST', body: JSON.stringify(payload) });
    if (res.status === 401) { showErr(errEl2, 'err_auth'); return; }
    if (res.status === 429) {
      const d = await res.json().catch(() => ({}));
      errEl2.textContent = '// error: ' + (d.error ?? '今日提單次數已達上限');
      errEl2.classList.add('show');
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showErr(errEl2, data.error || 'err_submit'); return; }

    // 成功
    cardRes.classList.remove('show');
    cardSucc.classList.add('show');
    if (succRef && data.id) succRef.textContent = '// ref: #' + data.id;
    cardSucc.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    showErr(errEl2, 'err_submit');
  } finally {
    btnConf.classList.remove('is-loading'); btnConf.disabled = false;
  }
});

// ── block 2/2 ──
(function () {
  const canvas = document.getElementById('neural-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  let W = 0, H = 0, nodes = [];
  const DIST = 155;
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
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
    ctx.clearRect(0, 0, W, H);
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
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * p, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${no * p})`; ctx.fill();
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y, d2 = dx * dx + dy * dy;
        if (d2 < DIST * DIST) {
          const a = (1 - Math.sqrt(d2) / DIST) * lo;
          ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y); ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = `rgba(${r},${g},${b},${a})`; ctx.lineWidth = .5; ctx.stroke();
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
