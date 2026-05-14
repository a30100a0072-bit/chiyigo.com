// ── erp-architecture-3d.js — ERP 8 層立體架構頁 ──
// 純 CSS 3D：perspective + transform-style:preserve-3d
// 整支 IIFE，避免和 index.js 的 top-level const NODES 撞名
//
// 互動：
//   - 自動 Y 軸旋轉（requestAnimationFrame），可暫停
//   - 拖曳：滑鼠 / 觸控旋轉 Y + X（X 軸限 -30°~+5°）
//   - 滾輪縮放 0.7~1.6
//   - 點 8 層之一 / 16 衛星節點 → side panel
//   - 標準 standalone 頁套件（lang dropdown / theme / overlay / neural canvas）

(function(){
const LANGS_I18N = /*@i18n:erp-architecture@*/{};

// ── 16 L2 衛星節點：兩環 8 節點，上下交錯 ──
// upper ring (y=-100)：與「上半」L1~L4 概念對齊的領域
// lower ring (y=+100)：與「下半」L5~L8 服務/runtime 概念對齊的領域
const NODES = [
  // Upper ring (y=-100) — 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°
  { id:'iam',         ang:0,   r:300, ty:-100, tag:'IDENTITY'    },
  { id:'crm',         ang:45,  r:300, ty:-100, tag:'CUSTOMER'    },
  { id:'sales',       ang:90,  r:300, ty:-100, tag:'SALES'       },
  { id:'finance',     ang:135, r:300, ty:-100, tag:'FINANCE'     },
  { id:'workflow',    ang:180, r:300, ty:-100, tag:'WORKFLOW'    },
  { id:'mdm',         ang:225, r:300, ty:-100, tag:'MASTER'      },
  { id:'file',        ang:270, r:300, ty:-100, tag:'FILE'        },
  { id:'integration', ang:315, r:300, ty:-100, tag:'INTEGRATION' },
  // Lower ring (y=+100) — 22.5° offset 看起來不重疊
  { id:'event',       ang:22.5,  r:300, ty:100, tag:'EVENT-BUS'  },
  { id:'data',        ang:67.5,  r:300, ty:100, tag:'DATA'       },
  { id:'ai',          ang:112.5, r:300, ty:100, tag:'AI'         },
  { id:'metadata',    ang:157.5, r:300, ty:100, tag:'METADATA'   },
  { id:'knowledge',   ang:202.5, r:300, ty:100, tag:'KNOWLEDGE'  },
  { id:'notify',      ang:247.5, r:300, ty:100, tag:'NOTIFY'     },
  { id:'bi',          ang:292.5, r:300, ty:100, tag:'ANALYTICS'  },
  { id:'sre',         ang:337.5, r:300, ty:100, tag:'PLATFORM'   },
];

// ── DOM refs ──
const SCENE = document.getElementById('erp3-scene');
const STAGE = document.getElementById('erp3-stage');
const ORBIT = document.getElementById('erp3-orbit');
const TOWER_LAYERS = document.querySelectorAll('.erp3-layer');
const AUTO_BTN = document.getElementById('erp3-auto-toggle');
const RESET_BTN = document.getElementById('erp3-reset');
const PANEL = document.getElementById('erp3-panel');
const PANEL_EMPTY = document.getElementById('erp3-panel-empty');
const PANEL_BODY = document.getElementById('erp3-panel-body');
const PANEL_TAG = document.getElementById('erp3-panel-tag');
const PANEL_TITLE = document.getElementById('erp3-panel-title');
const PANEL_DESC = document.getElementById('erp3-panel-desc');
const PANEL_L3_BLOCK = document.getElementById('erp3-panel-l3-block');
const PANEL_L4_BLOCK = document.getElementById('erp3-panel-l4-block');
const PANEL_TECH_BLOCK = document.getElementById('erp3-panel-tech-block');
const PANEL_L3 = document.getElementById('erp3-panel-l3');
const PANEL_L4 = document.getElementById('erp3-panel-l4');
const PANEL_TECH = document.getElementById('erp3-panel-tech');
const PANEL_CLOSE = document.getElementById('erp3-panel-close');

// ── State ──
let curLang = localStorage.getItem('lang') || 'zh-TW';
let autoRotate = true;
let rotY = 28;          // 度
let rotX = -12;
let zoom = 1;
let dragging = false;
let dragStartX = 0, dragStartY = 0;
let dragStartRotY = 0, dragStartRotX = 0;
let activeKind = null;  // 'layer' | 'node' | null
let activeId = null;
let lastT = 0;

const tDict = () => LANGS_I18N[curLang] || LANGS_I18N['en'] || {};
const tFallback = () => LANGS_I18N['en'] || LANGS_I18N['zh-TW'] || {};
const nodeLabel = n => {
  const t = tDict(), fb = tFallback();
  return t['node_'+n.id] || fb['node_'+n.id] || n.id;
};
const getDetails = id => {
  const t = tDict(), fb = tFallback();
  return (t.details && t.details[id]) || (fb.details && fb.details[id]) || null;
};
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── Build satellite orbit nodes ──
function buildNodes(){
  if (!ORBIT) return;
  ORBIT.innerHTML = '';
  for (const n of NODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'erp3-node';
    btn.dataset.id = n.id;
    btn.style.setProperty('--ang', n.ang + 'deg');
    btn.style.setProperty('--r', n.r + 'px');
    btn.style.setProperty('--ty', n.ty + 'px');
    btn.innerHTML = `<span class="erp3-node-dot"></span><span class="erp3-node-label">${esc(nodeLabel(n))}</span>`;
    ORBIT.appendChild(btn);
  }
}

// ── Apply stage transform ──
function applyTransform(){
  if (!STAGE) return;
  STAGE.style.setProperty('--rx', rotX + 'deg');
  STAGE.style.setProperty('--ry', rotY + 'deg');
  STAGE.style.setProperty('--zoom', zoom);
}

// ── Auto rotate loop ──
function tick(t){
  if (!lastT) lastT = t;
  const dt = (t - lastT) / 1000;
  lastT = t;
  if (autoRotate && !dragging) {
    rotY += dt * 12; // 度/秒
    if (rotY > 360) rotY -= 360;
    applyTransform();
  }
  requestAnimationFrame(tick);
}

// ── Drag / touch rotation ──
function onPointerDown(e){
  if (e.target.closest('.erp3-layer') || e.target.closest('.erp3-node')) return;
  dragging = true;
  const p = e.touches ? e.touches[0] : e;
  dragStartX = p.clientX;
  dragStartY = p.clientY;
  dragStartRotY = rotY;
  dragStartRotX = rotX;
  SCENE.setPointerCapture?.(e.pointerId);
}
function onPointerMove(e){
  if (!dragging) return;
  const p = e.touches ? e.touches[0] : e;
  const dx = p.clientX - dragStartX;
  const dy = p.clientY - dragStartY;
  rotY = dragStartRotY + dx * 0.35;
  rotX = Math.max(-30, Math.min(5, dragStartRotX - dy * 0.2));
  applyTransform();
  if (e.cancelable) e.preventDefault();
}
function onPointerUp(){
  dragging = false;
}
function onWheel(e){
  e.preventDefault();
  const d = e.deltaY > 0 ? -0.06 : 0.06;
  zoom = Math.max(0.7, Math.min(1.6, zoom + d));
  applyTransform();
}

// ── Panel ──
function renderLayerPanel(lvl){
  const t = tDict(), fb = tFallback();
  PANEL_EMPTY.hidden = true;
  PANEL_BODY.hidden = false;
  PANEL_TAG.textContent = 'L' + lvl;
  PANEL_TITLE.textContent = t['layer_'+lvl+'_name'] || fb['layer_'+lvl+'_name'] || 'Layer '+lvl;
  PANEL_DESC.textContent = t['layer_'+lvl+'_desc'] || fb['layer_'+lvl+'_desc'] || '';
  PANEL_L3_BLOCK.hidden = true;
  PANEL_L4_BLOCK.hidden = true;
  PANEL_TECH_BLOCK.hidden = true;
}
function renderNodePanel(id){
  const n = NODES.find(x => x.id === id);
  const d = getDetails(id);
  if (!n || !d) return;
  PANEL_EMPTY.hidden = true;
  PANEL_BODY.hidden = false;
  PANEL_TAG.textContent = d.tag || n.tag;
  PANEL_TITLE.textContent = nodeLabel(n);
  PANEL_DESC.textContent = d.purpose || '';
  PANEL_L3.innerHTML = (d.l3 || []).map(s => `<li>${esc(s)}</li>`).join('');
  PANEL_L3_BLOCK.hidden = !d.l3 || !d.l3.length;
  PANEL_L4.innerHTML = (d.l4 || []).map(s => `<span>${esc(s)}</span>`).join('');
  PANEL_L4_BLOCK.hidden = !d.l4 || !d.l4.length;
  PANEL_TECH.innerHTML = (d.tech || []).map(s => `<span>${esc(s)}</span>`).join('');
  PANEL_TECH_BLOCK.hidden = !d.tech || !d.tech.length;
}
function clearPanel(){
  PANEL_BODY.hidden = true;
  PANEL_EMPTY.hidden = false;
  PANEL_L3_BLOCK.hidden = true;
  PANEL_L4_BLOCK.hidden = true;
  PANEL_TECH_BLOCK.hidden = true;
}
function setActive(kind, id){
  activeKind = kind;
  activeId = id;
  TOWER_LAYERS.forEach(el => el.classList.toggle('active', kind === 'layer' && String(el.dataset.layer) === String(id)));
  ORBIT?.querySelectorAll('.erp3-node').forEach(el => el.classList.toggle('active', kind === 'node' && el.dataset.id === id));
  if (kind === 'layer') renderLayerPanel(id);
  else if (kind === 'node') renderNodePanel(id);
  else clearPanel();
}

// ── Wire interactions ──
TOWER_LAYERS.forEach(el => {
  el.addEventListener('click', e => {
    e.stopPropagation();
    const lvl = el.dataset.layer;
    if (activeKind === 'layer' && String(activeId) === String(lvl)) setActive(null, null);
    else setActive('layer', lvl);
  });
});
ORBIT?.addEventListener('click', e => {
  const btn = e.target.closest('.erp3-node');
  if (!btn) return;
  e.stopPropagation();
  const id = btn.dataset.id;
  if (activeKind === 'node' && activeId === id) setActive(null, null);
  else setActive('node', id);
});
PANEL_CLOSE?.addEventListener('click', () => setActive(null, null));

AUTO_BTN?.addEventListener('click', () => {
  autoRotate = !autoRotate;
  AUTO_BTN.setAttribute('aria-pressed', autoRotate ? 'true' : 'false');
  const txt = AUTO_BTN.querySelector('[data-i18n]');
  if (txt) txt.textContent = autoRotate ? (tDict().l3d_autorotate || 'Auto') : (tDict().l3d_paused || 'Paused');
});
RESET_BTN?.addEventListener('click', () => {
  rotY = 28; rotX = -12; zoom = 1;
  applyTransform();
});

// Mouse + touch + pointer
SCENE?.addEventListener('pointerdown', onPointerDown);
SCENE?.addEventListener('pointermove', onPointerMove);
SCENE?.addEventListener('pointerup', onPointerUp);
SCENE?.addEventListener('pointercancel', onPointerUp);
SCENE?.addEventListener('pointerleave', onPointerUp);
SCENE?.addEventListener('wheel', onWheel, { passive: false });

// ── i18n apply（standalone full） ──
function applyLang(lang){
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = LANGS_I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (t[k] !== undefined) el.textContent = t[k];
  });
  const tBtn = document.getElementById('theme-toggle-btn');
  const mTBtn = document.getElementById('m-theme-btn');
  const lBtn = document.getElementById('lang-toggle-btn');
  if (tBtn) { tBtn.title = t.tooltip_theme; tBtn.setAttribute('aria-label', t.tooltip_theme); }
  if (mTBtn) mTBtn.title = t.tooltip_theme;
  if (lBtn) { lBtn.title = t.tooltip_lang; lBtn.setAttribute('aria-label', t.tooltip_lang); }
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  // Refresh node labels + active panel
  ORBIT?.querySelectorAll('.erp3-node').forEach(el => {
    const n = NODES.find(x => x.id === el.dataset.id);
    if (n) {
      const lbl = el.querySelector('.erp3-node-label');
      if (lbl) lbl.textContent = nodeLabel(n);
    }
  });
  if (activeKind === 'layer') renderLayerPanel(activeId);
  else if (activeKind === 'node') renderNodePanel(activeId);
  // Update auto-rotate button text per current state
  if (AUTO_BTN) {
    const txt = AUTO_BTN.querySelector('[data-i18n]');
    if (txt) txt.textContent = autoRotate ? (t.l3d_autorotate || 'Auto') : (t.l3d_paused || 'Paused');
  }
}

// ── Lang dropdown / mobile overlay / theme / reveal / neural canvas（與 erp-architecture.js 同款） ──
const langToggleBtn = document.getElementById('lang-toggle-btn');
const langDropdown  = document.getElementById('lang-dropdown');
langToggleBtn?.addEventListener('click', e => { e.stopPropagation(); langDropdown?.classList.toggle('open'); });
document.addEventListener('click', () => langDropdown?.classList.remove('open'));
langDropdown?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); langDropdown.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); });
function toggleTopLangDrop(e){ e.stopPropagation(); document.getElementById('m-top-lang-drop')?.classList.toggle('open'); }
window.toggleTopLangDrop = toggleTopLangDrop;
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);

// Mobile overlay open/close
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu(){ hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.classList.add('body-lock'); }
function closeMenu(){ hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// Theme toggle
const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');
function applyTheme(dark){
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
const doToggle = () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
};
themeBtn?.addEventListener('click', doToggle);
mThemeBtn?.addEventListener('click', doToggle);

// Reveal animation
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// Neural canvas
(function(){
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
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

// ── Init ──
buildNodes();
applyTransform();
applyLang(curLang);
requestAnimationFrame(tick);

// Reduced motion：尊重使用者偏好，autoRotate 預設關
if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  autoRotate = false;
  AUTO_BTN?.setAttribute('aria-pressed', 'false');
}

})();
