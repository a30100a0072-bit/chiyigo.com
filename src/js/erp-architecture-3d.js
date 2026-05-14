// ── erp-architecture-3d.js — ERP 8 層立體架構頁（Three.js 版本）──
// WebGL 真實 3D：PerspectiveCamera + DirectionalLight + Raycaster picking
// 自託管 three.module.min.js（~180KB gzipped），無外部依賴、CSP 不動
//
// 互動：
//   - 自動 Y 軸 orbit（按鈕可暫停）
//   - 滑鼠/觸控拖曳手動 orbit + 滾輪縮放
//   - Raycaster 抓 layer / satellite 點擊 → side panel
//   - a11y fallback：隱藏 button 清單給鍵盤 / SR 使用者
//   - WebGL context loss → 顯示 fallback 訊息，requestAnimationFrame 自動暫停
//
// 模組化：本檔以 ES module 載入（<script type="module">），無 IIFE 必要

import * as THREE from '/js/vendor/three.module.min.js';

const LANGS_I18N = /*@i18n:erp-architecture@*/{};

// ── 16 L2 衛星節點：兩環 8 節點，與 CSS 版相同座標規格 ──
const NODES = [
  // Upper ring (y=+100) — Three.js Y 軸上為正
  { id:'iam',         ang:0,     r:300, ty:100,  tag:'IDENTITY'    },
  { id:'crm',         ang:45,    r:300, ty:100,  tag:'CUSTOMER'    },
  { id:'sales',       ang:90,    r:300, ty:100,  tag:'SALES'       },
  { id:'finance',     ang:135,   r:300, ty:100,  tag:'FINANCE'     },
  { id:'workflow',    ang:180,   r:300, ty:100,  tag:'WORKFLOW'    },
  { id:'mdm',         ang:225,   r:300, ty:100,  tag:'MASTER'      },
  { id:'file',        ang:270,   r:300, ty:100,  tag:'FILE'        },
  { id:'integration', ang:315,   r:300, ty:100,  tag:'INTEGRATION' },
  // Lower ring (y=-100)
  { id:'event',       ang:22.5,  r:300, ty:-100, tag:'EVENT-BUS'   },
  { id:'data',        ang:67.5,  r:300, ty:-100, tag:'DATA'        },
  { id:'ai',          ang:112.5, r:300, ty:-100, tag:'AI'          },
  { id:'metadata',    ang:157.5, r:300, ty:-100, tag:'METADATA'    },
  { id:'knowledge',   ang:202.5, r:300, ty:-100, tag:'KNOWLEDGE'   },
  { id:'notify',      ang:247.5, r:300, ty:-100, tag:'NOTIFY'      },
  { id:'bi',          ang:292.5, r:300, ty:-100, tag:'ANALYTICS'   },
  { id:'sre',         ang:337.5, r:300, ty:-100, tag:'PLATFORM'    },
];

// ── 18 條 EDGES（跨領域功能依賴，與 2D 版同步） ──
const EDGES = [
  ['iam','mdm'], ['iam','workflow'], ['iam','metadata'],
  ['crm','sales'], ['sales','finance'], ['sales','mdm'], ['sales','file'],
  ['finance','integration'], ['finance','file'],
  ['workflow','event'], ['workflow','metadata'],
  ['event','data'], ['event','notify'], ['event','ai'],
  ['ai','data'], ['ai','knowledge'],
  ['bi','data'], ['mdm','data'],
];

// ── 配色：分 5 個語意群（業務 / 資料 / AI / I/O / 平台），避免單一色相視覺扁平 ──
const PALETTE = {
  accent:      0x6c6ee5,  // 品牌紫 — 業務核心
  accentLight: 0x8c91ff,  // 淺紫 — highlight
  cyan:        0x4cd6cc,  // 青 — 資料 / 事件 / 主檔
  pink:        0xe57eb6,  // 桃 — AI / 知識 / metadata
  amber:       0xf0b85a,  // 琥珀 — I/O / 通知 / 整合
  green:       0x5edb89,  // 綠 — 分析 BI
  coral:       0xff7a85,  // 珊瑚紅 — 身份 / 資安
};
// 衛星統一品牌紫（外圍簡潔，視覺重心留給內部 8 層）
const NODE_COLOR = Object.fromEntries(
  ['iam','crm','sales','finance','workflow','event','data','mdm','notify','file','integration','bi','ai','metadata','knowledge','sre']
    .map(id => [id, PALETTE.accent])
);
// 8 層紫→藍漸層軸（用戶選定）：上桃 → 紫系下行 → 中段青→藍 → 底部暖色收尾
const LAYER_COLOR = {
  1: 0xe57eb6, // pink — 平台抽象頂層
  2: 0xc79cfc, // lavender — 領域邊界
  3: 0x8b8cef, // periwinkle — 子模組
  4: 0x6c6ee5, // brand purple — 細項
  5: 0x4cd6cc, // cyan — 服務
  6: 0x5fb3e8, // sky blue — 能力 / 儲存
  7: 0xf0b85a, // amber — 執行 Runtime
  8: 0x5edb89, // green — 部署基礎設施
};

// 顏色工具
function hexRGB(hex){ return { r:(hex>>16)&255, g:(hex>>8)&255, b:hex&255 }; }
function rgba(hex, a){ const { r,g,b } = hexRGB(hex); return `rgba(${r},${g},${b},${a})`; }
function lighten(hex, amt=0.4){
  const { r,g,b } = hexRGB(hex);
  const lr = Math.min(255, Math.round(r + (255-r)*amt));
  const lg = Math.min(255, Math.round(g + (255-g)*amt));
  const lb = Math.min(255, Math.round(b + (255-b)*amt));
  return (lr<<16)|(lg<<8)|lb;
}
function hexStr(hex){ return '#' + hex.toString(16).padStart(6, '0'); }

// ── DOM refs ──
const SCENE_EL = document.getElementById('erp3-scene');
const CANVAS = document.getElementById('erp3-canvas');
const A11Y_LIST = document.getElementById('erp3-a11y');
const FALLBACK = document.getElementById('erp3-fallback');
const AUTO_BTN = document.getElementById('erp3-auto-toggle');
const RESET_BTN = document.getElementById('erp3-reset');
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
let autoRotate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let activeKind = null;
let activeId = null;

const tDict = () => LANGS_I18N[curLang] || LANGS_I18N['en'] || {};
const tFallback = () => LANGS_I18N['en'] || LANGS_I18N['zh-TW'] || {};
const nodeLabel = n => {
  const t = tDict(), fb = tFallback();
  return t['node_'+n.id] || fb['node_'+n.id] || n.id;
};
const layerName = lvl => {
  const t = tDict(), fb = tFallback();
  return t['layer_'+lvl+'_name'] || fb['layer_'+lvl+'_name'] || ('L' + lvl);
};
const layerDesc = lvl => {
  const t = tDict(), fb = tFallback();
  return t['layer_'+lvl+'_desc'] || fb['layer_'+lvl+'_desc'] || '';
};
const getDetails = id => {
  const t = tDict(), fb = tFallback();
  return (t.details && t.details[id]) || (fb.details && fb.details[id]) || null;
};
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── Canvas-texture helper ──
// 用 2D canvas 畫文字 → 包成 THREE.CanvasTexture
function makeTextTexture({ tag, name, width=512, height=128, accent=PALETTE.accent, highlight=false }){
  const dpr = 2;
  const c = document.createElement('canvas');
  c.width = width * dpr; c.height = height * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const accentLight = lighten(accent, 0.35);
  // 圓角背景
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0); ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r); ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height); ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  // 漸層底（accent → accentLight，highlight 時更飽和）
  const grad = ctx.createLinearGradient(0, 0, width, height);
  if (highlight) {
    grad.addColorStop(0, rgba(accent, 0.92));
    grad.addColorStop(1, rgba(accentLight, 0.65));
  } else {
    grad.addColorStop(0, rgba(accent, 0.55));
    grad.addColorStop(1, rgba(accentLight, 0.22));
  }
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = hexStr(highlight ? lighten(accent, 0.55) : accent);
  ctx.lineWidth = highlight ? 3 : 2;
  ctx.stroke();
  // tag chip
  if (tag) {
    const tagW = 56, tagH = 26;
    const tagX = 16, tagY = (height - tagH) / 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(tagX, tagY, tagW, tagH, 6) : (() => {
      ctx.moveTo(tagX + 6, tagY);
      ctx.lineTo(tagX + tagW - 6, tagY); ctx.quadraticCurveTo(tagX + tagW, tagY, tagX + tagW, tagY + 6);
      ctx.lineTo(tagX + tagW, tagY + tagH - 6); ctx.quadraticCurveTo(tagX + tagW, tagY + tagH, tagX + tagW - 6, tagY + tagH);
      ctx.lineTo(tagX + 6, tagY + tagH); ctx.quadraticCurveTo(tagX, tagY + tagH, tagX, tagY + tagH - 6);
      ctx.lineTo(tagX, tagY + 6); ctx.quadraticCurveTo(tagX, tagY, tagX + 6, tagY);
    })();
    ctx.fillStyle = rgba(accent, 0.6);
    ctx.fill();
    ctx.fillStyle = '#f5f1ff';  // 米白偏紫，跟主體 #f5f1ff 文字色一致
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, tagX + tagW/2, tagY + tagH/2);
  }
  // name — 米白偏紫 #f5f1ff + 深底陰影增加可讀性（淺色背景時不會死掉）
  ctx.save();
  ctx.shadowColor = 'rgba(26,29,43,0.55)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#f5f1ff';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, tag ? 86 : 24, height/2);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return { tex, canvas: c };
}

// ── Three.js scene setup ──
let renderer, scene, camera, raycaster, mouse;
let towerGroup, satGroup, spine, spineGlow;
const layerMeshes = []; // [{ mesh, lvl, baseTex, hiTex, info }]
const satMeshes = [];   // [{ mesh, node, baseTex, hiTex, info }]
const edgeLines = [];   // [{ line, a, b, mat }]

const cam = { theta: 0.6, phi: 0.18, radius: 850 };
let dragging = false, didDrag = false;
let dragStartX = 0, dragStartY = 0, startTheta = 0, startPhi = 0;
let contextLost = false;

function initScene(){
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  renderer = new THREE.WebGLRenderer({ canvas: CANVAS, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lighting — 主要是給 spine 用，texture 已自帶顏色
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0x8c91ff, 0.6); key.position.set(300, 400, 300); scene.add(key);
  const rim = new THREE.DirectionalLight(0x6c6ee5, 0.3); rim.position.set(-200, 100, -300); scene.add(rim);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // 中央 spine —— 用 vertexColors 做上下顏色漸層（上桃 → 下綠，呼應 L1~L8 顏色軸）
  const spineGeom = new THREE.CylinderGeometry(3, 3, 600, 24, 1);
  const posCount = spineGeom.attributes.position.count;
  const cAttr = new Float32Array(posCount * 3);
  const topColor = new THREE.Color(PALETTE.pink);
  const botColor = new THREE.Color(PALETTE.green);
  for (let i = 0; i < posCount; i++) {
    const y = spineGeom.attributes.position.getY(i);   // -300..+300
    const t = (y + 300) / 600;                         // 0..1，下 0、上 1
    const col = botColor.clone().lerp(topColor, t);
    cAttr[i*3] = col.r; cAttr[i*3+1] = col.g; cAttr[i*3+2] = col.b;
  }
  spineGeom.setAttribute('color', new THREE.BufferAttribute(cAttr, 3));
  const spineMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
  spine = new THREE.Mesh(spineGeom, spineMat);
  scene.add(spine);

  // 外圈光暈（柔和紫色 halo）
  const glowGeom = new THREE.CylinderGeometry(14, 14, 600, 24);
  const glowMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.22, depthWrite: false });
  spineGlow = new THREE.Mesh(glowGeom, glowMat);
  scene.add(spineGlow);

  // 8 層 tower
  towerGroup = new THREE.Group();
  scene.add(towerGroup);
  for (let lvl = 1; lvl <= 8; lvl++) {
    const tag = 'L' + lvl;
    const name = layerName(lvl);
    const accent = LAYER_COLOR[lvl] || PALETTE.accent;
    const { tex: baseTex } = makeTextTexture({ tag, name, width: 380, height: 64, accent });
    const { tex: hiTex } = makeTextTexture({ tag, name, width: 380, height: 64, accent, highlight: true });
    const geom = new THREE.PlaneGeometry(380, 64);
    const mat = new THREE.MeshBasicMaterial({ map: baseTex, transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = (4.5 - lvl) * 70;  // L1 top, L8 bottom
    mesh.userData = { kind: 'layer', id: lvl };
    towerGroup.add(mesh);
    layerMeshes.push({ mesh, lvl, baseTex, hiTex });
  }

  // 16 衛星
  satGroup = new THREE.Group();
  scene.add(satGroup);
  for (const n of NODES) {
    const accent = NODE_COLOR[n.id] || PALETTE.accent;
    const { tex: baseTex } = makeTextTexture({ tag: n.tag, name: nodeLabel(n), width: 320, height: 72, accent });
    const { tex: hiTex } = makeTextTexture({ tag: n.tag, name: nodeLabel(n), width: 320, height: 72, accent, highlight: true });
    const geom = new THREE.PlaneGeometry(180, 40);
    const mat = new THREE.MeshBasicMaterial({ map: baseTex, transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    const rad = (n.ang * Math.PI) / 180;
    mesh.position.set(Math.sin(rad) * n.r, n.ty, Math.cos(rad) * n.r);
    mesh.userData = { kind: 'node', id: n.id };
    satGroup.add(mesh);
    satMeshes.push({ mesh, node: n, baseTex, hiTex });
  }

  // EDGES 功能線：用 CylinderGeometry 當粗 tube 而不是 Line（多數平台 LineBasicMaterial.linewidth 只 1px，
  // 改用 tube 才能在任何視角呈現可見的粗度）
  const UP = new THREE.Vector3(0, 1, 0);
  for (const [a, b] of EDGES) {
    const na = NODES.find(n => n.id === a);
    const nb = NODES.find(n => n.id === b);
    if (!na || !nb) continue;
    const aRad = (na.ang * Math.PI) / 180;
    const bRad = (nb.ang * Math.PI) / 180;
    const pa = new THREE.Vector3(Math.sin(aRad) * na.r, na.ty, Math.cos(aRad) * na.r);
    const pb = new THREE.Vector3(Math.sin(bRad) * nb.r, nb.ty, Math.cos(bRad) * nb.r);
    const dir = new THREE.Vector3().subVectors(pb, pa);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(1.6, 1.6, len, 8, 1);
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.accentLight, transparent: true, opacity: 0.6, depthWrite: false });
    const tube = new THREE.Mesh(geom, mat);
    tube.position.copy(pa).add(dir.clone().multiplyScalar(0.5));
    tube.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    scene.add(tube);
    edgeLines.push({ line: tube, a, b, mat });
  }
}

// ── EDGES 高亮更新：點 node 時相鄰 edge 變粗變亮、其他 dim ──
function refreshEdges(){
  for (const { line, a, b, mat } of edgeLines) {
    if (activeKind === 'node') {
      const isHit = activeId === a || activeId === b;
      mat.opacity = isHit ? 0.98 : 0.05;
      mat.color.setHex(isHit ? PALETTE.accentLight : PALETTE.accent);
      // 變粗：scale X/Z（cylinder 的徑向），Y 保持長度
      line.scale.x = line.scale.z = isHit ? 2.4 : 1;
    } else {
      mat.opacity = 0.6;
      mat.color.setHex(PALETTE.accentLight);
      line.scale.x = line.scale.z = 1;
    }
  }
}

// ── Camera orbit ──
function updateCamera(){
  camera.position.x = Math.sin(cam.theta) * Math.cos(cam.phi) * cam.radius;
  camera.position.y = Math.sin(cam.phi) * cam.radius + 30;
  camera.position.z = Math.cos(cam.theta) * Math.cos(cam.phi) * cam.radius;
  camera.lookAt(0, 0, 0);
}

// ── Billboarding：所有 layer + satellite 面對相機 ──
function billboardAll(){
  for (const { mesh } of layerMeshes) mesh.quaternion.copy(camera.quaternion);
  for (const { mesh } of satMeshes) mesh.quaternion.copy(camera.quaternion);
}

// ── Active state mesh texture swap ──
function refreshActiveTextures(){
  for (const { mesh, lvl, baseTex, hiTex } of layerMeshes) {
    mesh.material.map = (activeKind === 'layer' && activeId === lvl) ? hiTex : baseTex;
    mesh.material.needsUpdate = true;
  }
  for (const { mesh, node, baseTex, hiTex } of satMeshes) {
    mesh.material.map = (activeKind === 'node' && activeId === node.id) ? hiTex : baseTex;
    mesh.material.needsUpdate = true;
  }
}

// ── Render loop ──
let lastT = 0;
function tick(t){
  if (contextLost) return;
  if (!lastT) lastT = t;
  const dt = (t - lastT) / 1000;
  lastT = t;
  if (autoRotate && !dragging) {
    cam.theta -= dt * 0.18;
  }
  updateCamera();
  billboardAll();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ── Resize ──
function onResize(){
  if (!renderer || !camera) return;
  const w = SCENE_EL.clientWidth;
  const h = SCENE_EL.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── Pointer interaction ──
function onPointerDown(e){
  dragging = true; didDrag = false;
  const p = e.touches ? e.touches[0] : e;
  dragStartX = p.clientX; dragStartY = p.clientY;
  startTheta = cam.theta; startPhi = cam.phi;
  SCENE_EL.setPointerCapture?.(e.pointerId);
}
function onPointerMove(e){
  if (!dragging) return;
  const p = e.touches ? e.touches[0] : e;
  const dx = p.clientX - dragStartX, dy = p.clientY - dragStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
  cam.theta = startTheta - dx * 0.005;
  cam.phi = Math.max(-0.2, Math.min(0.7, startPhi + dy * 0.003));
}
function onPointerUp(){ dragging = false; }
function onWheel(e){
  e.preventDefault();
  cam.radius = Math.max(450, Math.min(1500, cam.radius + e.deltaY * 0.8));
}
function onClick(e){
  if (didDrag) return;
  const rect = CANVAS.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const targets = [...layerMeshes.map(x => x.mesh), ...satMeshes.map(x => x.mesh)];
  const hits = raycaster.intersectObjects(targets);
  if (hits.length) {
    const ud = hits[0].object.userData;
    if (activeKind === ud.kind && activeId === ud.id) setActive(null, null);
    else setActive(ud.kind, ud.id);
  } else {
    setActive(null, null);
  }
}

// ── Panel ──
function renderLayerPanel(lvl){
  const t = tDict(), fb = tFallback();
  PANEL_EMPTY.hidden = true;
  PANEL_BODY.hidden = false;
  PANEL_TAG.textContent = 'L' + lvl;
  PANEL_TITLE.textContent = layerName(lvl);
  PANEL_DESC.textContent = layerDesc(lvl);
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
  refreshActiveTextures();
  refreshEdges();
  if (kind === 'layer') renderLayerPanel(id);
  else if (kind === 'node') renderNodePanel(id);
  else clearPanel();
  // a11y list 同步
  A11Y_LIST?.querySelectorAll('button').forEach(b => {
    const k = b.dataset.kind, i = b.dataset.id;
    b.setAttribute('aria-pressed', (kind === k && String(id) === i) ? 'true' : 'false');
  });
}

// ── A11y fallback button list ──
function buildA11yList(){
  if (!A11Y_LIST) return;
  A11Y_LIST.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = (tDict().l3d_title || 'Architecture') + ' — accessible list';
  h.style.fontSize = '14px';
  h.style.margin = '0 0 8px';
  A11Y_LIST.appendChild(h);
  for (let lvl = 1; lvl <= 8; lvl++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.kind = 'layer';
    b.dataset.id = String(lvl);
    b.textContent = 'L' + lvl + ' — ' + layerName(lvl);
    b.addEventListener('click', () => setActive('layer', lvl));
    A11Y_LIST.appendChild(b);
  }
  for (const n of NODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.kind = 'node';
    b.dataset.id = n.id;
    b.textContent = n.tag + ' — ' + nodeLabel(n);
    b.addEventListener('click', () => setActive('node', n.id));
    A11Y_LIST.appendChild(b);
  }
}

// ── WebGL context loss handler ──
CANVAS?.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  contextLost = true;
  if (FALLBACK) FALLBACK.hidden = false;
});
CANVAS?.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  initScene();
  buildA11yList();
  onResize();
  if (FALLBACK) FALLBACK.hidden = true;
  requestAnimationFrame(tick);
});

// ── Wire toolbar ──
AUTO_BTN?.addEventListener('click', () => {
  autoRotate = !autoRotate;
  AUTO_BTN.setAttribute('aria-pressed', autoRotate ? 'true' : 'false');
  const txt = AUTO_BTN.querySelector('[data-i18n]');
  if (txt) txt.textContent = autoRotate ? (tDict().l3d_autorotate || 'Auto') : (tDict().l3d_paused || 'Paused');
});
RESET_BTN?.addEventListener('click', () => {
  cam.theta = 0.6; cam.phi = 0.18; cam.radius = 850;
});
PANEL_CLOSE?.addEventListener('click', () => setActive(null, null));

SCENE_EL?.addEventListener('pointerdown', onPointerDown);
SCENE_EL?.addEventListener('pointermove', onPointerMove);
SCENE_EL?.addEventListener('pointerup', onPointerUp);
SCENE_EL?.addEventListener('pointercancel', onPointerUp);
SCENE_EL?.addEventListener('pointerleave', onPointerUp);
SCENE_EL?.addEventListener('wheel', onWheel, { passive: false });
SCENE_EL?.addEventListener('click', onClick);
window.addEventListener('resize', onResize);

// ── i18n apply（standalone）──
function rebuildLabelTextures(){
  // 重 build canvas-texture for new language；accent 沿用分類色（不變）
  for (const item of layerMeshes) {
    const tag = 'L' + item.lvl;
    const accent = LAYER_COLOR[item.lvl] || PALETTE.accent;
    item.baseTex.dispose();
    item.hiTex.dispose();
    const { tex: baseTex } = makeTextTexture({ tag, name: layerName(item.lvl), width: 380, height: 64, accent });
    const { tex: hiTex } = makeTextTexture({ tag, name: layerName(item.lvl), width: 380, height: 64, accent, highlight: true });
    item.baseTex = baseTex; item.hiTex = hiTex;
  }
  for (const item of satMeshes) {
    const accent = NODE_COLOR[item.node.id] || PALETTE.accent;
    item.baseTex.dispose();
    item.hiTex.dispose();
    const { tex: baseTex } = makeTextTexture({ tag: item.node.tag, name: nodeLabel(item.node), width: 320, height: 72, accent });
    const { tex: hiTex } = makeTextTexture({ tag: item.node.tag, name: nodeLabel(item.node), width: 320, height: 72, accent, highlight: true });
    item.baseTex = baseTex; item.hiTex = hiTex;
  }
  refreshActiveTextures();
}

// 純 DOM [data-i18n] 套用（不碰 Three.js textures）— init 失敗也能跑
function applyDomI18n(lang){
  const dict = LANGS_I18N[lang] || LANGS_I18N['en'] || LANGS_I18N['zh-TW'];
  if (!dict) return;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (dict[k] !== undefined) el.textContent = dict[k];
  });
}

function applyLang(lang){
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = LANGS_I18N[lang];
  applyDomI18n(lang);
  const tBtn = document.getElementById('theme-toggle-btn');
  const mTBtn = document.getElementById('m-theme-btn');
  const lBtn = document.getElementById('lang-toggle-btn');
  if (tBtn) { tBtn.title = t.tooltip_theme; tBtn.setAttribute('aria-label', t.tooltip_theme); }
  if (mTBtn) mTBtn.title = t.tooltip_theme;
  if (lBtn) { lBtn.title = t.tooltip_lang; lBtn.setAttribute('aria-label', t.tooltip_lang); }
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  rebuildLabelTextures();
  buildA11yList();
  if (activeKind === 'layer') renderLayerPanel(activeId);
  else if (activeKind === 'node') renderNodePanel(activeId);
  if (AUTO_BTN) {
    const txt = AUTO_BTN.querySelector('[data-i18n]');
    if (txt) txt.textContent = autoRotate ? (t.l3d_autorotate || 'Auto') : (t.l3d_paused || 'Paused');
  }
}

// ── Lang dropdown / mobile overlay / theme（同款套件，與 case-platform/erp-architecture 一致）──
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

const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu(){ hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.classList.add('body-lock'); }
function closeMenu(){ hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

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
themeBtn?.addEventListener('click', () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
});
mThemeBtn?.addEventListener('click', () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
});

// Reveal animation
const osContent = document.getElementById('os-content');
const revRoot = window.innerWidth > 768 ? osContent : null;
const revObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// Neural canvas (背景)
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

// Dispose on page unload — 透過 scene.traverse 抓所有現存資源，含 lang 切換後 rebuild 的新 textures
window.addEventListener('beforeunload', () => {
  if (scene) {
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose?.();
      const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
      for (const m of mats) {
        if (m.map) m.map.dispose?.();
        m.dispose?.();
      }
    });
  }
  renderer?.dispose?.();
});

// ── Init ──
// DOM i18n 先跑：即使 WebGL 初始化失敗、fallback 訊息也用使用者語言
applyDomI18n(curLang);

if (CANVAS && SCENE_EL) {
  try {
    initScene();
    buildA11yList();
    onResize();
    applyLang(curLang);
    if (AUTO_BTN) AUTO_BTN.setAttribute('aria-pressed', autoRotate ? 'true' : 'false');
    requestAnimationFrame(tick);
  } catch (err) {
    console.error('[erp-3d] init failed:', err);
    if (FALLBACK) FALLBACK.hidden = false;
  }
}
