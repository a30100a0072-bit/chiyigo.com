// ── block 1/2 ──
// ── Mobile overlay ──────────────────────────────────────────
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
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

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

// ── Theme toggle ──────────────────────────────────────────
const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');

function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  [themeBtn, mThemeBtn].forEach(btn => {
    if (!btn) return;
    const sun = btn.querySelector('.icon-sun'), moon = btn.querySelector('.icon-moon');
    if (sun)  sun.style.display  = dark ? 'none' : '';
    if (moon) moon.style.display = dark ? ''     : 'none';
  });
}
applyTheme(localStorage.getItem('theme') !== 'light');
const doToggle = () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
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
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop').classList.toggle('open'); }
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
applyLangI(curLangI);

// ── Reveal animation ──────────────────────────────────────
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// ── Timeline staggered reveal ──────────────────────────────
const tlWrap = document.getElementById('ab-timeline');
if (tlWrap) {
  const tlRoot = window.innerWidth > 768 ? osContent : null;
  const tlObs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        tlWrap.querySelectorAll('.tl-row').forEach((row, i) => {
          setTimeout(() => row.classList.add('revealed'), i * 80);
        });
        tlObs.unobserve(e.target);
      }
    });
  }, { root: tlRoot, threshold: 0.1 });
  tlObs.observe(tlWrap);
}

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
