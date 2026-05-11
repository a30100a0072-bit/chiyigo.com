// ── case-platform-embed.js ──
// 首頁 (index.html) 嵌入版本：只保留 nodes / lines / panel 邏輯。
// theme / 語言切換 / hamburger / canvas 由 host 頁 (index.js) 處理。
// 對外暴露 window.cpArchSetLang(lang)，由 index.js 的 applyLangI 觸發。

const NODES = [
  { id:'login',   x:22, y:12, tag:'AUTH' },
  { id:'oauth',   x:50, y:6,  tag:'AUTH' },
  { id:'email',   x:78, y:12, tag:'AUTH' },
  { id:'mfa',     x:17, y:30, tag:'SECURITY' },
  { id:'device',  x:83, y:30, tag:'SECURITY' },
  { id:'token',   x:17, y:58, tag:'CORE' },
  { id:'audit',   x:83, y:58, tag:'OPS' },
  { id:'kyc',     x:30, y:82, tag:'COMPLIANCE' },
  { id:'payment', x:70, y:82, tag:'BUSINESS' },
  { id:'wallet',  x:50, y:92, tag:'SECURITY' },
];

const CORE = { x:50, y:50 };

const EDGES = [
  ['login','token'], ['oauth','token'],
  ['login','mfa'], ['mfa','token'],
  ['token','device'],
  ['payment','kyc'], ['payment','audit'],
  ['mfa','payment'],
  ['wallet','login'], ['wallet','payment'], ['wallet','audit'],
];

const LANGS_I18N = /*@i18n:case-platform@*/{};

const STAGE = document.getElementById('cp-stage');
if (STAGE) {
  const SVG          = document.getElementById('cp-lines');
  const PANEL        = document.getElementById('cp-panel');
  const PANEL_EMPTY  = document.getElementById('cp-panel-empty');
  const PANEL_BODY   = document.getElementById('cp-panel-body');
  const PANEL_TAG    = document.getElementById('cp-panel-tag');
  const PANEL_TITLE  = document.getElementById('cp-panel-title');
  const PANEL_PURPOSE  = document.getElementById('cp-panel-purpose');
  const PANEL_FLOW     = document.getElementById('cp-panel-flow');
  const PANEL_API      = document.getElementById('cp-panel-api');
  const PANEL_SECURITY = document.getElementById('cp-panel-security');
  const PANEL_TECH     = document.getElementById('cp-panel-tech');
  const PANEL_CLOSE    = document.getElementById('cp-panel-close');

  let activeId = null;
  let curLang = localStorage.getItem('lang') || 'zh-TW';

  const isMobile = () => window.matchMedia('(max-width: 960px)').matches;
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

  function buildNodes() {
    STAGE.querySelectorAll('.cp-node').forEach(el => el.remove());
    const core = document.createElement('button');
    core.type = 'button';
    core.className = 'cp-node cp-node-core';
    core.dataset.id = 'core';
    core.style.left = CORE.x + '%';
    core.style.top  = CORE.y + '%';
    core.innerHTML = `<span class="cp-node-dot"></span><span>CHIYIGO 會員系統<span class="cp-node-core-sub">// IAM Platform</span></span>`;
    STAGE.appendChild(core);
    for (const n of NODES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cp-node';
      btn.dataset.id = n.id;
      btn.style.left = n.x + '%';
      btn.style.top  = n.y + '%';
      btn.innerHTML = `<span class="cp-node-dot"></span><span class="cp-node-label">${nodeLabel(n)}</span>`;
      STAGE.appendChild(btn);
    }
  }

  function buildLines() {
    if (!SVG) return;
    if (isMobile()) { SVG.innerHTML = ''; return; }
    const w = STAGE.clientWidth, h = STAGE.clientHeight;
    SVG.setAttribute('viewBox', `0 0 ${w} ${h}`);
    SVG.innerHTML = '';
    const cx = CORE.x/100 * w, cy = CORE.y/100 * h;
    for (const n of NODES) {
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', n.x/100 * w); line.setAttribute('y2', n.y/100 * h);
      line.dataset.from = 'core'; line.dataset.to = n.id;
      SVG.appendChild(line);
    }
    for (const [a,b] of EDGES) {
      const na = NODES.find(x => x.id === a), nb = NODES.find(x => x.id === b);
      if (!na || !nb) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', na.x/100 * w); line.setAttribute('y1', na.y/100 * h);
      line.setAttribute('x2', nb.x/100 * w); line.setAttribute('y2', nb.y/100 * h);
      line.dataset.from = a; line.dataset.to = b;
      line.setAttribute('stroke-dasharray','3 4');
      SVG.appendChild(line);
    }
  }

  function renderPanel(id) {
    const n = NODES.find(x => x.id === id);
    const d = getDetails(id);
    if (!n || !d) return;
    PANEL_EMPTY.hidden = true;
    PANEL_BODY.hidden  = false;
    PANEL_TAG.textContent   = n.tag;
    PANEL_TITLE.textContent = nodeLabel(n);
    PANEL_PURPOSE.textContent = d.purpose;
    PANEL_FLOW.innerHTML     = d.flow.map(s => `<li>${esc(s)}</li>`).join('');
    PANEL_API.innerHTML      = d.api.map(s => `<li>${esc(s)}</li>`).join('');
    PANEL_SECURITY.innerHTML = d.security.map(s => `<li>${esc(s)}</li>`).join('');
    PANEL_TECH.innerHTML     = d.tech.map(s => `<span>${esc(s)}</span>`).join('');
  }
  function clearPanel() { PANEL_BODY.hidden = true; PANEL_EMPTY.hidden = false; }

  function isConnected(a, b) {
    if (a === b) return true;
    return EDGES.some(e => (e[0]===a && e[1]===b) || (e[1]===a && e[0]===b));
  }

  function setActive(id) {
    if (id === 'core') id = null;
    activeId = id;
    STAGE.querySelectorAll('.cp-node').forEach(el => {
      const eid = el.dataset.id;
      el.classList.toggle('active', eid === id);
      el.classList.toggle('dim', !!id && eid !== id && eid !== 'core' && !isConnected(id, eid));
    });
    SVG?.querySelectorAll('line').forEach(l => {
      const isHit = id && (l.dataset.from === id || l.dataset.to === id);
      l.classList.toggle('active', !!isHit);
      l.classList.toggle('dim', !!id && !isHit);
    });
    if (id) renderPanel(id); else clearPanel();
    if (id && isMobile()) setTimeout(() => PANEL?.scrollIntoView({behavior:'smooth', block:'start'}), 60);
  }

  STAGE.addEventListener('click', e => {
    const btn = e.target.closest('.cp-node');
    if (!btn) return;
    const id = btn.dataset.id;
    if (id === 'core') { setActive(null); return; }
    if (id === activeId) setActive(null); else setActive(id);
  });
  PANEL_CLOSE?.addEventListener('click', () => setActive(null));

  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(buildLines, 120); });

  window.cpArchSetLang = function(lang) {
    if (!LANGS_I18N[lang]) return;
    curLang = lang;
    STAGE.querySelectorAll('.cp-node').forEach(el => {
      const id = el.dataset.id;
      if (id === 'core') return;
      const n = NODES.find(x => x.id === id);
      if (n) {
        const lbl = el.querySelector('.cp-node-label');
        if (lbl) lbl.textContent = nodeLabel(n);
      }
    });
    // 重新刷掉嵌入區的 data-i18n 文字（host 的 applyLang 也會處理，這裡確保鏡像）
    const t = LANGS_I18N[lang];
    document.querySelectorAll('#cp-arch-embed [data-i18n]').forEach(el => {
      const k = el.dataset.i18n;
      if (t[k] !== undefined) el.textContent = t[k];
    });
    if (activeId) renderPanel(activeId);
  };

  buildNodes();
  buildLines();
  window.cpArchSetLang(curLang);
  // 首頁嵌入版預設空 panel：讓 "點擊任一節點" hint 誘導探索，
  // 不像獨立 case-platform.html 那樣強塞細節搶注意。
}
