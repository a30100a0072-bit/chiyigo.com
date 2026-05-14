// ── erp-architecture.js — ERP 企業平台 互動式架構 ──
// 同支同時服務兩個入口：
//   - /erp-architecture.html（standalone）：完整跑全部（widget + hamburger + theme + neural canvas + lang dropdown）
//   - /index.html 嵌入區（embed）：只跑 widget；host 頁 index.js 處理 theme/lang/hamburger/canvas
// 用 DOM 偵測模式：`#erp-arch-embed` 存在 = embed。
//
// 整支包 IIFE：避免和 case-platform.js / index.js 的 top-level 識別字撞名。

(function(){
const isEmbed = !!document.getElementById('erp-arch-embed');

// 16 L2 領域；x/y 為 stage 百分比，環繞 L1 核心成橢圓
// angle = i*22.5 - 90（從正上方順時針）；rx=40 ry=37
const NODES = [
  { id:'iam',         x:50,    y:13,    tag:'IDENTITY'    },
  { id:'crm',         x:65.31, y:15.80, tag:'CUSTOMER'    },
  { id:'sales',       x:78.28, y:23.84, tag:'SALES'       },
  { id:'finance',     x:86.97, y:35.85, tag:'FINANCE'     },
  { id:'workflow',    x:90,    y:50,    tag:'WORKFLOW'    },
  { id:'event',       x:86.97, y:64.15, tag:'EVENT-BUS'   },
  { id:'data',        x:78.28, y:76.16, tag:'DATA'        },
  { id:'mdm',         x:65.31, y:84.20, tag:'MASTER'      },
  { id:'notify',      x:50,    y:87,    tag:'NOTIFY'      },
  { id:'file',        x:34.69, y:84.20, tag:'FILE'        },
  { id:'integration', x:21.72, y:76.16, tag:'INTEGRATION' },
  { id:'bi',          x:13.03, y:64.15, tag:'ANALYTICS'   },
  { id:'ai',          x:10,    y:50,    tag:'AI'          },
  { id:'metadata',    x:13.03, y:35.85, tag:'METADATA'    },
  { id:'knowledge',   x:21.72, y:23.84, tag:'KNOWLEDGE'   },
  { id:'sre',         x:34.69, y:15.80, tag:'PLATFORM'    },
];

const CORE = { x:50, y:50 };

// 靜態（無 Chain 選中時）：core ↔ 16 領域全連 + 下方 EDGES 跨領域連線
// 點任一節點時，只有 EDGES 上的相鄰節點維持高亮、其餘 dim（同 case-platform pattern）
const EDGES = [
  ['iam','mdm'],          // 身份 → 組織主檔
  ['iam','workflow'],     // 身份 → 簽核權限
  ['crm','sales'],        // CRM → 銷售
  ['sales','finance'],    // 銷售 → 財務
  ['sales','mdm'],        // 銷售 → 商品主檔
  ['sales','file'],       // 銷售 → 合約檔案
  ['finance','integration'], // 財務 → 銀行連接器
  ['finance','file'],     // 財務 → 發票歸檔
  ['workflow','event'],   // 工作流 → 事件
  ['event','data'],       // 事件 → 資料層
  ['event','notify'],     // 事件 → 通知
  ['ai','data'],          // AI → 資料
  ['ai','knowledge'],     // AI → 知識
  ['ai','event'],         // AI → 事件
  ['bi','data'],          // BI → 資料倉儲
  ['mdm','data'],         // MDM → 資料
  ['metadata','workflow'],// Metadata → 動態 workflow
  ['metadata','iam'],     // Metadata → 動態權限
];

// Chain 啟動時改顯示 chain 內部連線
const CHAINS = {
  order:   ['crm', 'sales', 'mdm', 'finance', 'workflow', 'notify', 'bi', 'file'],
  payment: ['sales', 'finance', 'notify', 'bi', 'integration'],
  tenant:  ['iam', 'mdm', 'metadata', 'workflow', 'notify', 'bi'],
  ai:      ['event', 'data', 'ai', 'knowledge', 'notify', 'bi'],
};

const LANGS_I18N = /*@i18n:erp-architecture@*/{};

const STAGE = document.getElementById('erp-stage');
const SVG = document.getElementById('erp-lines');
const PANEL = document.getElementById('erp-panel');
const PANEL_EMPTY = document.getElementById('erp-panel-empty');
const PANEL_BODY = document.getElementById('erp-panel-body');
const PANEL_TAG = document.getElementById('erp-panel-tag');
const PANEL_TITLE = document.getElementById('erp-panel-title');
const PANEL_PURPOSE = document.getElementById('erp-panel-purpose');
const PANEL_L3 = document.getElementById('erp-panel-l3');
const PANEL_L4 = document.getElementById('erp-panel-l4');
const PANEL_EVENTS = document.getElementById('erp-panel-events');
const PANEL_TECH = document.getElementById('erp-panel-tech');
const PANEL_CLOSE = document.getElementById('erp-panel-close');
const CHAIN_BAR = document.getElementById('erp-chain-bar');
const CHAIN_NOTE = document.getElementById('erp-chain-note');
const PICKER = document.getElementById('erp-domain-select');
const PICKER_LABEL = document.querySelector(isEmbed ? '#erp-arch-embed .erp-panel-picker-label' : '.erp-panel-picker-label');

let activeId = null;
let activeChain = null; // null | 'order' | 'payment' | 'tenant' | 'ai'
let curLang = localStorage.getItem('lang') || 'zh-TW';

const isMobile = () => window.matchMedia('(max-width: 960px)').matches;
const isGridEmbed = () => isEmbed && !isMobile();
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

function buildNodes(){
  if (!STAGE) return;
  STAGE.querySelectorAll('.erp-node').forEach(el => el.remove());
  // L1 core
  if (!isGridEmbed()) {
    const core = document.createElement('div');
    core.className = 'erp-node erp-node-core';
    core.dataset.id = 'core';
    core.style.left = CORE.x + '%';
    core.style.top = CORE.y + '%';
    const coreLabel = tDict().title2 || tFallback().title2 || 'ERP Platform';
    core.innerHTML = `<span class="erp-node-dot"></span><span>L1<span class="erp-node-core-sub">${esc(coreLabel)}</span></span>`;
    STAGE.appendChild(core);
  }
  for (const n of NODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'erp-node';
    btn.dataset.id = n.id;
    btn.style.left = n.x + '%';
    btn.style.top = n.y + '%';
    btn.innerHTML = `<span class="erp-node-dot"></span><span class="erp-node-label">${esc(nodeLabel(n))}</span>`;
    STAGE.appendChild(btn);
  }
}

function buildLines(){
  if (!STAGE || !SVG) return;
  if (isMobile() || isGridEmbed()) { SVG.innerHTML = ''; return; }
  const w = STAGE.clientWidth, h = STAGE.clientHeight;
  SVG.setAttribute('viewBox', `0 0 ${w} ${h}`);
  SVG.innerHTML = '';
  const cx = CORE.x/100 * w, cy = CORE.y/100 * h;

  if (activeChain && CHAINS[activeChain]) {
    // Chain 模式：只畫 chain 內部相鄰連線（帶箭頭）
    const chain = CHAINS[activeChain];
    // arrow marker
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.innerHTML = `<marker id="erp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`;
    SVG.appendChild(defs);
    for (let i=0; i<chain.length-1; i++) {
      const a = NODES.find(x => x.id === chain[i]);
      const b = NODES.find(x => x.id === chain[i+1]);
      if (!a || !b) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', a.x/100 * w); line.setAttribute('y1', a.y/100 * h);
      line.setAttribute('x2', b.x/100 * w); line.setAttribute('y2', b.y/100 * h);
      line.setAttribute('marker-end', 'url(#erp-arrow)');
      line.classList.add('chain-line');
      line.style.animationDelay = (i * 0.18) + 's';
      SVG.appendChild(line);
    }
  } else {
    // 靜態：core ↔ 16 領域 spoke
    for (const n of NODES) {
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', n.x/100 * w); line.setAttribute('y2', n.y/100 * h);
      line.dataset.from = 'core'; line.dataset.to = n.id;
      SVG.appendChild(line);
    }
    // EDGES：跨領域虛線
    for (const [a, b] of EDGES) {
      const na = NODES.find(x => x.id === a), nb = NODES.find(x => x.id === b);
      if (!na || !nb) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', na.x/100 * w); line.setAttribute('y1', na.y/100 * h);
      line.setAttribute('x2', nb.x/100 * w); line.setAttribute('y2', nb.y/100 * h);
      line.dataset.from = a; line.dataset.to = b;
      line.setAttribute('stroke-dasharray', '3 4');
      SVG.appendChild(line);
    }
  }
}

function isConnected(a, b){
  if (a === b) return true;
  return EDGES.some(e => (e[0]===a && e[1]===b) || (e[1]===a && e[0]===b));
}

function renderPanel(id){
  const n = NODES.find(x => x.id === id);
  const d = getDetails(id);
  if (!n || !d) return;
  PANEL_EMPTY.hidden = true;
  PANEL_BODY.hidden = false;
  PANEL_TAG.textContent = d.tag || n.tag;
  PANEL_TITLE.textContent = nodeLabel(n);
  PANEL_PURPOSE.textContent = d.purpose;
  PANEL_L3.innerHTML = (d.l3 || []).map(s => `<li>${esc(s)}</li>`).join('');
  PANEL_L4.innerHTML = (d.l4 || []).map(s => `<span>${esc(s)}</span>`).join('');
  PANEL_EVENTS.innerHTML = (d.events && d.events.length)
    ? d.events.map(s => `<li>${esc(s)}</li>`).join('')
    : `<li class="erp-panel-muted">—</li>`;
  PANEL_TECH.innerHTML = (d.tech || []).map(s => `<span>${esc(s)}</span>`).join('');
}

function clearPanel(){
  if (!PANEL_BODY || !PANEL_EMPTY) return;
  PANEL_BODY.hidden = true;
  PANEL_EMPTY.hidden = false;
}

function buildPicker(){
  if (!PICKER) return;
  const t = tDict(), fb = tFallback();
  PICKER.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = t.picker_placeholder || fb.picker_placeholder || '— —';
  PICKER.appendChild(ph);
  // 多層：每個 L2 為 optgroup，內含「領域總覽 + 各 L3」全部 value 指回 L2 id
  for (const n of NODES) {
    const og = document.createElement('optgroup');
    const tagSuffix = (n.tag ? ' — ' + n.tag : '');
    og.label = nodeLabel(n) + tagSuffix;
    const overview = document.createElement('option');
    overview.value = n.id;
    overview.textContent = t.picker_overview || fb.picker_overview || '▸ 領域總覽';
    og.appendChild(overview);
    const d = getDetails(n.id);
    if (d && Array.isArray(d.l3)) {
      for (const l3 of d.l3) {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = '  · ' + l3;
        og.appendChild(opt);
      }
    }
    PICKER.appendChild(og);
  }
  PICKER.value = activeId || '';
  if (PICKER_LABEL) {
    const lbl = t.picker_label || fb.picker_label || '';
    if (lbl) { PICKER_LABEL.textContent = lbl; PICKER.setAttribute('aria-label', lbl); }
  }
}

function setActive(id){
  if (id === 'core') id = null;
  activeId = id;
  STAGE?.querySelectorAll('.erp-node').forEach(el => {
    const eid = el.dataset.id;
    el.classList.toggle('active', eid === id);
    // 在 chain 模式下：非 chain 成員淡化
    if (activeChain && CHAINS[activeChain]) {
      const inChain = CHAINS[activeChain].includes(eid);
      el.classList.toggle('chain-on', inChain && eid !== 'core');
      el.classList.toggle('dim', !inChain && eid !== 'core' && eid !== id);
    } else {
      // 靜態：套 case-platform 的 EDGES 相鄰高亮邏輯——點 X 時，X 自己 + 與 X 有 edge 的鄰居維持亮，其餘 dim
      el.classList.toggle('chain-on', false);
      el.classList.toggle('dim', !!id && eid !== id && eid !== 'core' && !isConnected(id, eid));
    }
  });
  // SVG 連線：靜態模式下，點 X 時跟 X 相連的線亮起，其他 dim（chain-line 在 chain 模式下另控）
  SVG?.querySelectorAll('line').forEach(l => {
    if (l.classList.contains('chain-line')) return;
    const isHit = id && (l.dataset.from === id || l.dataset.to === id);
    l.classList.toggle('active', !!isHit);
    l.classList.toggle('dim', !!id && !isHit);
  });
  if (id) renderPanel(id);
  else clearPanel();
  if (PICKER) PICKER.value = id || '';
  // 手機板：只在 panel 還不在視窗內時才滾動，避免每次切 L2 都被往下拉
  if (id && isMobile() && PANEL) {
    const r = PANEL.getBoundingClientRect();
    const inView = r.top < window.innerHeight && r.bottom > 0;
    if (!inView) setTimeout(() => PANEL.scrollIntoView({behavior:'smooth', block:'start'}), 60);
  }
}

function setChain(name){
  activeChain = (name && CHAINS[name]) ? name : null;
  CHAIN_BAR?.querySelectorAll('.erp-chain-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.chain === (activeChain || 'none'));
  });
  if (CHAIN_NOTE) {
    const t = tDict(), fb = tFallback();
    if (activeChain) {
      const noteKey = 'chain_note_' + activeChain;
      CHAIN_NOTE.textContent = t[noteKey] || fb[noteKey] || '';
      CHAIN_NOTE.hidden = false;
    } else {
      CHAIN_NOTE.textContent = '';
      CHAIN_NOTE.hidden = true;
    }
  }
  buildLines();
  setActive(activeId);
}

if (STAGE) {
  STAGE.addEventListener('click', e => {
    const btn = e.target.closest('.erp-node');
    if (!btn) return;
    const id = btn.dataset.id;
    if (id === 'core') { setActive(null); return; }
    if (id === activeId) setActive(null);
    else setActive(id);
  });
  PANEL_CLOSE?.addEventListener('click', () => setActive(null));
  PICKER?.addEventListener('change', e => setActive(e.target.value || null));
  CHAIN_BAR?.addEventListener('click', e => {
    const btn = e.target.closest('.erp-chain-btn');
    if (!btn) return;
    const c = btn.dataset.chain;
    setChain(c === 'none' ? null : c);
  });
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => buildLines(), 120);
  });
}

// ── 共用：套用語言到 widget（節點 label + 面板 + chain 註腳 + embed [data-i18n]） ──
function applyArchLang(lang){
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  STAGE?.querySelectorAll('.erp-node').forEach(el => {
    const id = el.dataset.id;
    if (id === 'core') {
      const sub = el.querySelector('.erp-node-core-sub');
      if (sub) sub.textContent = (tDict().title2 || tFallback().title2 || 'ERP Platform');
      return;
    }
    const n = NODES.find(x => x.id === id);
    if (n) {
      const lbl = el.querySelector('.erp-node-label');
      if (lbl) lbl.textContent = nodeLabel(n);
    }
  });
  if (activeId) renderPanel(activeId);
  buildPicker();
  if (activeChain) {
    const t = tDict(), fb = tFallback();
    if (CHAIN_NOTE) CHAIN_NOTE.textContent = t['chain_note_'+activeChain] || fb['chain_note_'+activeChain] || '';
  }
  // embed 模式：同步 #erp-arch-embed 內所有 [data-i18n]（init + 語言切換都會走這條）
  if (isEmbed) {
    const t = LANGS_I18N[lang];
    document.querySelectorAll('#erp-arch-embed [data-i18n]').forEach(el => {
      const k = el.dataset.i18n;
      if (t[k] !== undefined) el.textContent = t[k];
    });
  }
}

// embed 模式：暴露給 host (index.js) 在 applyLangI 結尾呼叫
window.erpArchSetLang = function(lang){ applyArchLang(lang); };

// ── Init widget ──
if (STAGE) {
  buildNodes();
  buildLines();
  applyArchLang(curLang);
  // standalone 預設選 iam；embed/grid 預設空 panel
  if (!isEmbed && !isMobile()) setActive('iam');
}

// ──────────────────────────────────────────────────────────────
// 以下為 standalone (erp-architecture.html) 專屬：
// embed 模式下 index.js 已處理同樣行為，跳過避免重複綁。
// ──────────────────────────────────────────────────────────────
if (isEmbed) { return; }

// ── i18n（standalone full applyLang） ──
function applyLang(lang){
  if (!LANGS_I18N[lang]) return;
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
  applyArchLang(lang);
}

const langToggleBtn = document.getElementById('lang-toggle-btn');
const langDropdown  = document.getElementById('lang-dropdown');
langToggleBtn?.addEventListener('click', e => { e.stopPropagation(); langDropdown?.classList.toggle('open'); });
document.addEventListener('click', () => langDropdown?.classList.remove('open'));
langDropdown?.addEventListener('click', e => {
  const opt = e.target.closest('.lang-opt');
  if (!opt) return;
  applyLang(opt.dataset.lang); langDropdown.classList.remove('open');
});
document.getElementById('m-overlay')?.addEventListener('click', e => {
  const opt = e.target.closest('.m-ov-lang-opt');
  if (!opt) return;
  applyLang(opt.dataset.lang);
});
function toggleTopLangDrop(e){ e.stopPropagation(); document.getElementById('m-top-lang-drop')?.classList.toggle('open'); }
window.toggleTopLangDrop = toggleTopLangDrop;
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => {
  const opt = e.target.closest('.lang-opt');
  if (!opt) return;
  applyLang(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open');
});
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);

applyLang(curLang);

// ── Mobile overlay / drag-close ──（與 portfolio.js 同款）
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu(){ hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.classList.add('body-lock'); }
function closeMenu(){ hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

;(function(){
  const THRESHOLD=110; let startY=0,lastY=0,active=false;
  document.addEventListener('touchstart', e => {
    const ov=document.getElementById('m-overlay'); if(!ov||!ov.classList.contains('is-open'))return;
    const wrap=ov.querySelector('.m-ov-wrap'); if(!wrap)return;
    const t=e.touches[0],r=wrap.getBoundingClientRect();
    if(t.clientY<r.top||t.clientY>r.bottom)return;
    const nav=wrap.querySelector('.m-ov-nav');
    if(nav&&nav.scrollTop>0){const nr=nav.getBoundingClientRect();if(t.clientY>=nr.top&&t.clientY<=nr.bottom)return;}
    startY=t.clientY;lastY=startY;active=true;wrap.style.transition='none';
  }, { passive:true });
  document.addEventListener('touchmove', e => {
    if(!active)return;
    lastY=e.touches[0].clientY; const dy=lastY-startY; if(dy<=0)return;
    const ov=document.getElementById('m-overlay'); const wrap=ov&&ov.querySelector('.m-ov-wrap'); if(!wrap)return;
    wrap.style.transform=`translateY(${dy}px)`;
    const ratio=Math.max(0,1-dy/wrap.offsetHeight*1.5);
    ov.style.background=`rgba(10,12,28,${(0.32*ratio).toFixed(3)})`;
    e.preventDefault();
  }, { passive:false });
  document.addEventListener('touchend', () => {
    if(!active)return; active=false;
    const ov=document.getElementById('m-overlay'); const wrap=ov&&ov.querySelector('.m-ov-wrap');
    if(!wrap){startY=0;lastY=0;return;}
    const dy=lastY-startY; ov.style.background='';
    if(dy>THRESHOLD){
      wrap.style.transition='transform .26s ease'; wrap.style.transform='translateY(100%)';
      setTimeout(()=>{wrap.style.transform='';wrap.style.transition='';ov.classList.remove('is-open');ov.setAttribute('aria-hidden','true');const btn=document.getElementById('m-ham-btn');btn?.classList.remove('is-open');btn?.setAttribute('aria-expanded','false');document.getElementById('m-topbar')?.classList.remove('menu-open');document.body.classList.remove('body-lock');},260);
    } else { wrap.style.transition='transform .42s cubic-bezier(.22,1,.36,1)'; wrap.style.transform=''; setTimeout(()=>{wrap.style.transition='';},420); }
    startY=0;lastY=0;
  }, { passive:true });
})();

// ── Theme toggle ──
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

// ── Reveal animation ──
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// ── Neural canvas（與 portfolio.js / case-platform.js 同款；尊重 prefers-reduced-motion） ──
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

})();
