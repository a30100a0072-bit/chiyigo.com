// ── block 1/2 ──
// ── Mobile overlay ──────────────────────────────────────────
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu() { hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.style.overflow='hidden'; }
function closeMenu() { hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.style.overflow=''; }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// ── Theme toggle ──────────────────────────────────────────
const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');
function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  [themeBtn, mThemeBtn].forEach(btn => {
    if (!btn) return;
    const sun = btn.querySelector('.icon-sun'), moon = btn.querySelector('.icon-moon');
    if (sun)  sun.hidden = dark;
    if (moon) moon.hidden = !dark;
  });
}
applyTheme(localStorage.getItem('theme') !== 'light');
const doToggle = () => { const d = !document.documentElement.classList.contains('theme-dark'); localStorage.setItem('theme', d ? 'dark' : 'light'); applyTheme(d); };
themeBtn?.addEventListener('click', doToggle);
mThemeBtn?.addEventListener('click', doToggle);

// ── i18n ───────────────────────────────────────────────────
const LANGS_I18N = /*@i18n@*/{};
let curLang = localStorage.getItem('lang') || 'zh-TW';
function T() { return LANGS_I18N[curLang] || LANGS_I18N['zh-TW']; }
// i18n 模板：'第 {p} / {t} 頁' + {p:1, t:5} → '第 1 / 5 頁'
function fmt(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); }
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = T();
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { const k = el.dataset.i18nAria; if (typeof t[k] === 'string') el.setAttribute('aria-label', t[k]); });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  // re-render dynamic content
  if (window._lastData) { renderTable(window._lastData.requisitions); renderCards(window._lastData.requisitions); renderPagination(window._lastData.total, window._lastData.page, window._lastData.limit); document.getElementById('total-badge').textContent = fmt(t.total_label, {n: window._lastData.total}); }
}
const langTogBtnI = document.getElementById('lang-toggle-btn');
const langDropI   = document.getElementById('lang-dropdown');
langTogBtnI?.addEventListener('click', e => { e.stopPropagation(); langDropI?.classList.toggle('open'); });
document.addEventListener('click', () => langDropI?.classList.remove('open'));
langDropI?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDropI.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); });
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop').classList.toggle('open'); }
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
applyLangI(curLang);

// ══════════════════════════════════════════════════════════
//  ADMIN REQUISITIONS LOGIC
// ══════════════════════════════════════════════════════════
const ACCESS_TOKEN_KEY = 'access_token'
let currentPage = 1
let currentQ    = ''
let debounceTimer

function getToken() { return sessionStorage.getItem(ACCESS_TOKEN_KEY) }

async function logout() {
  const token = getToken()
  if (token) {
    await fetch('/api/auth/logout', { method:'POST', credentials:'include', headers: { 'Authorization': `Bearer ${token}` } }).catch(() => {})
  }
  sessionStorage.clear()
  location.href = '/login.html'
}
document.getElementById('logout-btn').addEventListener('click', logout)

function showError(msg) {
  document.getElementById('loading').style.display = 'none'
  document.getElementById('content').style.display = 'none'
  document.getElementById('error-msg').style.display = 'block'
  document.getElementById('error-text').textContent = `// error: ${msg}`
}

function formatServiceType(v) {
  const t = T()
  const map = { system:t.st_system, web:t.st_web, integration:t.st_integration, interactive:t.st_interactive, branding:t.st_branding, marketing:t.st_marketing, other:t.st_other }
  return map[v] ?? v
}
function formatBudget(v) {
  const t = T()
  const map = { under30k:t.bd_under30k, '30k-80k':t.bd_30k80k, '80k-200k':t.bd_80k200k, over200k:t.bd_over200k, flexible:t.bd_flexible }
  return map[v] ?? v ?? '—'
}
function formatTimeline(v) {
  const t = T()
  const map = { asap:t.tl_asap, '1-3m':t.tl_1_3m, '3-6m':t.tl_3_6m, flexible:t.tl_flexible }
  return map[v] ?? v ?? '—'
}
function formatDate(s) {
  if (!s) return '—'
  const d = new Date(s.replace(' ', 'T') + 'Z')
  const localeMap = { 'zh-TW':'zh-TW', 'en':'en-US', 'ja':'ja-JP', 'ko':'ko-KR' }
  return d.toLocaleString(localeMap[curLang] || 'zh-TW', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
}

async function load(page = 1, q = '') {
  const token = getToken()
  const t = T()
  if (!token) { showError(t.err_login_required); return }

  document.getElementById('loading').style.display = 'block'
  document.getElementById('content').style.display = 'none'
  document.getElementById('error-msg').style.display = 'none'

  const params = new URLSearchParams({ page, limit: 20 })
  if (q) params.set('q', q)

  const res = await fetch(`/api/admin/requisitions?${params}`, { headers: { 'Authorization': `Bearer ${token}` } })

  if (res.status === 401 || res.status === 403) { showError(t.err_perm); return }
  if (!res.ok) { showError(fmt(t.err_http, {n: res.status})); return }

  const data = await res.json()
  window._lastData = data
  document.getElementById('loading').style.display = 'none'
  document.getElementById('content').style.display = 'block'

  renderTable(data.requisitions)
  renderCards(data.requisitions)
  renderPagination(data.total, data.page, data.limit)
  document.getElementById('total-badge').textContent = fmt(t.total_label, {n: data.total})
  currentPage = page
  currentQ    = q
}

function renderTable(rows) {
  const tbody = document.getElementById('table-body')
  const t = T()
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="8" class="empty">${t.no_data}</td></tr>`; return }
  tbody.innerHTML = rows.map(r => `
    <tr data-open-modal="${r.id}">
      <td class="id">${r.id}</td>
      <td>
        <span class="name">${esc(r.name)}</span>
        ${r.company ? `<span class="company">${esc(r.company)}</span>` : ''}
      </td>
      <td class="mono">${esc(r.contact)}</td>
      <td><span class="pill">${esc(formatServiceType(r.service_type))}</span></td>
      <td>${esc(formatBudget(r.budget))}</td>
      <td>${esc(formatTimeline(r.timeline))}</td>
      <td class="mono">${formatDate(r.created_at)}</td>
      <td><svg class="chev" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></td>
    </tr>`).join('')
  window._reqData = Object.fromEntries(rows.map(r => [r.id, r]))
}

function renderCards(rows) {
  const container = document.getElementById('cards-container')
  const t = T()
  if (!rows.length) { container.innerHTML = `<p class="empty">${t.no_data}</p>`; return }
  container.innerHTML = rows.map(r => `
    <div class="req-card" data-open-modal="${r.id}">
      <div class="row">
        <div>
          <span class="name">${esc(r.name)}</span>
          ${r.company ? `<span class="company">${esc(r.company)}</span>` : ''}
        </div>
        <span class="id">#${r.id}</span>
      </div>
      <span class="pill">${esc(formatServiceType(r.service_type))}</span>
      <p class="when">${formatDate(r.created_at)}</p>
    </div>`).join('')
  if (!window._reqData) window._reqData = {}
  rows.forEach(r => { window._reqData[r.id] = r })
}

function renderPagination(total, page, limit) {
  const pages = Math.ceil(total / limit)
  const el = document.getElementById('pagination')
  const t = T()
  if (pages <= 1) { el.innerHTML = ''; return }
  el.innerHTML = `
    <button data-load-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>${t.prev_page}</button>
    <span class="stat">${fmt(t.page_label, {p: page, t: pages})}</span>
    <button data-load-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>${t.next_page}</button>`
}

function openModal(id) {
  const r = window._reqData?.[id]
  if (!r) return
  const t = T()
  const body = document.getElementById('modal-body')
  body.innerHTML = `
    <div class="modal-meta">
      <span>#${r.id}</span><span>·</span><span>${formatDate(r.created_at)}</span>
    </div>
    ${field(t.field_name, r.name)}
    ${r.company ? field(t.field_company, r.company) : ''}
    ${field(t.field_contact, r.contact, true)}
    ${field(t.field_service, formatServiceType(r.service_type))}
    ${r.budget   ? field(t.field_budget, formatBudget(r.budget))     : ''}
    ${r.timeline ? field(t.field_timeline, formatTimeline(r.timeline)) : ''}
    <div>
      <p class="msg-label">${t.field_message}</p>
      <div class="msg-block">${esc(r.message)}</div>
    </div>`
  document.getElementById('modal').classList.add('open')
}
function field(label, value, mono = false) {
  return `<div class="modal-row"><span class="lbl">${label}</span><span class="val ${mono ? 'mono' : ''}">${esc(value ?? '—')}</span></div>`
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

document.getElementById('modal-close').addEventListener('click', () => document.getElementById('modal').classList.remove('open'))
document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('open') })

document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => load(1, e.target.value.trim()), 380)
})

const _initToken = getToken()
if (!_initToken) { showError(T().err_not_logged_in) } else { load(1) }

// ── block 2/2 ──
(function(){
  const canvas=document.getElementById('neural-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  let W=0,H=0,nodes=[];const DIST=155;
  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
  function initNodes(){const n=W<768?48:115;nodes=Array.from({length:n},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.1+.4,pulse:Math.random()*Math.PI*2}))}
  const mouse={x:-9999,y:-9999};document.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});
  let cfg={r:'108',g:'110',b:'229',no:.22,lo:.09};
  function syncCfg(){const s=getComputedStyle(document.documentElement);cfg={r:s.getPropertyValue('--neural-r').trim()||'108',g:s.getPropertyValue('--neural-g').trim()||'110',b:s.getPropertyValue('--neural-b').trim()||'229',no:parseFloat(s.getPropertyValue('--neural-node-opacity').trim()||'.22'),lo:parseFloat(s.getPropertyValue('--neural-line-opacity').trim()||'.09')}}
  syncCfg();new MutationObserver(syncCfg).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  function draw(){ctx.clearRect(0,0,W,H);const{r,g,b,no,lo}=cfg;
    for(const n of nodes){const dx=n.x-mouse.x,dy=n.y-mouse.y,d2=dx*dx+dy*dy;if(d2<16900){const d=Math.sqrt(d2);n.vx+=dx/d*.055;n.vy+=dy/d*.055}n.vx*=.982;n.vy*=.982;n.x+=n.vx;n.y+=n.vy;if(n.x<-12)n.x=W+12;else if(n.x>W+12)n.x=-12;if(n.y<-12)n.y=H+12;else if(n.y>H+12)n.y=-12;n.pulse+=.011;const p=Math.sin(n.pulse)*.25+.75;ctx.beginPath();ctx.arc(n.x,n.y,n.r*p,0,Math.PI*2);ctx.fillStyle=`rgba(${r},${g},${b},${no*p})`;ctx.fill()}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d2=dx*dx+dy*dy;if(d2<DIST*DIST){const a=(1-Math.sqrt(d2)/DIST)*lo;ctx.beginPath();ctx.moveTo(nodes[i].x,nodes[i].y);ctx.lineTo(nodes[j].x,nodes[j].y);ctx.strokeStyle=`rgba(${r},${g},${b},${a})`;ctx.lineWidth=.5;ctx.stroke()}}
    requestAnimationFrame(draw)}
  resize();initNodes();draw();window.addEventListener('resize',()=>{resize();initNodes()});
})();

// ── Phase C-3 dynamic-content delegation ──
document.addEventListener('click', e => {
  const t = e.target.closest('[data-open-modal], [data-load-page]')
  if (!t) return
  if (t.dataset.openModal) openModal(Number(t.dataset.openModal))
  else if (t.dataset.loadPage) load(Number(t.dataset.loadPage), currentQ)
})
