// ── Theme ──
function syncThemeIcons() {
  const dark = document.documentElement.classList.contains('theme-dark')
  document.querySelectorAll('.icon-moon').forEach(el => el.style.display = dark ? '' : 'none')
  document.querySelectorAll('.icon-sun' ).forEach(el => el.style.display = dark ? 'none' : '')
}
function toggleTheme() {
  const html = document.documentElement
  const dark = html.classList.contains('theme-dark')
  html.classList.replace(dark ? 'theme-dark' : 'theme-light', dark ? 'theme-light' : 'theme-dark')
  localStorage.setItem('theme', dark ? 'light' : 'dark')
  syncThemeIcons()
  updateCanvasColors()
}
syncThemeIcons()
document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme)
document.getElementById('m-theme-btn')?.addEventListener('click', toggleTheme)

// ── i18n ──────────────────────────────────────────────
const LANGS_I18N = /*@i18n@*/{};
let curLangI = localStorage.getItem('lang') || 'zh-TW';
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLangI = lang;
  const t = LANGS_I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k]; });
  const tBtn = document.getElementById('theme-toggle-btn');
  const lBtn = document.getElementById('lang-toggle-btn');
  if (tBtn) { tBtn.title = t.tooltip_theme; tBtn.setAttribute('aria-label', t.tooltip_theme); }
  if (lBtn) { lBtn.title = t.tooltip_lang; lBtn.setAttribute('aria-label', t.tooltip_lang); }
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
}
const langTogBtnI = document.getElementById('lang-toggle-btn');
const langDropI   = document.getElementById('lang-dropdown');
langTogBtnI?.addEventListener('click', e => { e.stopPropagation(); langDropI?.classList.toggle('open'); });
document.addEventListener('click', () => langDropI?.classList.remove('open'));
langDropI?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDropI.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); });
// Mobile topbar lang dropdown
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop').classList.toggle('open'); }
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
applyLangI(curLangI);

// ── Mobile overlay ──
function toggleOverlay() {
  const ov  = document.getElementById('m-overlay')
  const btn = document.getElementById('m-ham-btn')
  const open = ov.classList.contains('is-open')
  if (open) closeOverlay()
  else {
    ov.classList.add('is-open')
    btn.classList.add('is-open')
    btn.setAttribute('aria-expanded','true')
    document.body.style.overflow = 'hidden'
  }
}
function closeOverlay() {
  const ov  = document.getElementById('m-overlay')
  const btn = document.getElementById('m-ham-btn')
  ov.classList.remove('is-open')
  btn.classList.remove('is-open')
  btn.setAttribute('aria-expanded','false')
  document.body.style.overflow = ''
}
function handleOverlayClick(e) {
  if (e.target === document.getElementById('m-overlay')) closeOverlay()
}
document.getElementById('m-ham-btn')?.addEventListener('click', toggleOverlay)
document.getElementById('m-overlay')?.addEventListener('click', handleOverlayClick)
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('m-overlay')?.classList.contains('is-open')) closeOverlay() })

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

// ── Scroll reveal ──
const revealObs = new IntersectionObserver(
  es => es.forEach(e => { if(e.isIntersecting){ e.target.classList.add('revealed'); revealObs.unobserve(e.target) } }),
  { threshold: 0.1 }
)
document.querySelectorAll('[data-reveal]').forEach(el => revealObs.observe(el))

// ── Sidebar active ──
const sectionObs = new IntersectionObserver(
  es => es.forEach(e => {
    if (!e.isIntersecting) return
    document.querySelectorAll('#sidebar-nav .sb-item[data-section]').forEach(a => a.classList.remove('active'))
    const hit = document.querySelector(`#sidebar-nav [data-section="${e.target.id}"]`)
    if (hit) hit.classList.add('active')
  }),
  { threshold: 0.45 }
)
;['hero','services','process','cta'].forEach(id => { const el = document.getElementById(id); if(el) sectionObs.observe(el) })

// ── Neural canvas ──
const cvs = document.getElementById('neural-canvas')
const ctx = cvs.getContext('2d')
const NODES=55, MAXDIST=145, SPEED=0.28, pts=[]
let cc={}
function updateCanvasColors() {
  const s = getComputedStyle(document.documentElement)
  cc = { r: s.getPropertyValue('--neural-r').trim()||'108', g: s.getPropertyValue('--neural-g').trim()||'110', b: s.getPropertyValue('--neural-b').trim()||'229', node: parseFloat(s.getPropertyValue('--neural-node-opacity'))||0.22, line: parseFloat(s.getPropertyValue('--neural-line-opacity'))||0.09 }
}
function resizeCvs() { cvs.width=window.innerWidth; cvs.height=window.innerHeight }
function initPts() { pts.length=0; for(let i=0;i<NODES;i++) pts.push({x:Math.random()*cvs.width,y:Math.random()*cvs.height,vx:(Math.random()-.5)*SPEED*2,vy:(Math.random()-.5)*SPEED*2,r:Math.random()*1.5+1}) }
function draw() {
  ctx.clearRect(0,0,cvs.width,cvs.height)
  const {r,g,b,node:nop,line:lop}=cc
  for(const p of pts){ p.x+=p.vx; p.y+=p.vy; if(p.x<0||p.x>cvs.width)p.vx*=-1; if(p.y<0||p.y>cvs.height)p.vy*=-1 }
  for(let i=0;i<pts.length;i++) for(let j=i+1;j<pts.length;j++){const dx=pts[i].x-pts[j].x,dy=pts[i].y-pts[j].y,d=Math.sqrt(dx*dx+dy*dy);if(d<MAXDIST){ctx.beginPath();ctx.moveTo(pts[i].x,pts[i].y);ctx.lineTo(pts[j].x,pts[j].y);ctx.strokeStyle=`rgba(${r},${g},${b},${lop*(1-d/MAXDIST)})`;ctx.lineWidth=0.75;ctx.stroke()}}
  for(const p of pts){ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=`rgba(${r},${g},${b},${nop})`;ctx.fill()}
  requestAnimationFrame(draw)
}
updateCanvasColors(); resizeCvs(); initPts(); draw()
window.addEventListener('resize',resizeCvs)
