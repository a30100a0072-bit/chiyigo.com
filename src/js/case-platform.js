// ── case-platform.js — CHIYIGO 會員系統 互動式架構 ──

const NODES = [
  // x/y as percentage of stage; positions form an ellipse around the core
  { id:'login',   x:18, y:14, label_zh:'登入 / 註冊', label_en:'Login / Signup', tag:'AUTH' },
  { id:'oauth',   x:50, y:8,  label_zh:'OAuth / 第三方', label_en:'OAuth / Federation', tag:'AUTH' },
  { id:'email',   x:82, y:14, label_zh:'Email 驗證 / 重設密碼', label_en:'Email Verify / Reset', tag:'AUTH' },
  { id:'mfa',     x:8,  y:38, label_zh:'2FA / Passkey', label_en:'2FA / Passkey', tag:'SECURITY' },
  { id:'device',  x:92, y:38, label_zh:'裝置管理', label_en:'Device Mgmt', tag:'SECURITY' },
  { id:'token',   x:8,  y:65, label_zh:'Token / Session / Revoke', label_en:'Token / Session / Revoke', tag:'CORE' },
  { id:'audit',   x:92, y:65, label_zh:'Admin / Audit Log', label_en:'Admin / Audit Log', tag:'OPS' },
  { id:'kyc',     x:28, y:90, label_zh:'KYC 身分驗證', label_en:'KYC', tag:'COMPLIANCE' },
  { id:'payment', x:72, y:90, label_zh:'金流 / 訂單 / 退款', label_en:'Payment / Refund', tag:'BUSINESS' },
];

const CORE = { x:50, y:50 };

// dependency edges (in addition to core→node lines)
const EDGES = [
  ['login','token'], ['oauth','token'],
  ['login','mfa'], ['mfa','token'],
  ['token','device'],
  ['payment','kyc'], ['payment','audit'],
  ['mfa','payment'],
];

const DETAILS = {
  login: {
    purpose:'帳號註冊、登入、忘記密碼、Email 驗證的入口。支援風險評分 + brute-force 防禦 + Turnstile 防機器人。',
    flow:['填寫表單 → Turnstile challenge','送 /api/auth/login（含 device_uuid）','後端 risk score (4 signal)：country/UA/time/fails','分數 ≥ 70 拒絕並 email 通知；30–70 警告 + audit；其他發 access+refresh token','新裝置 → email 警示 + audit critical'],
    api:['POST /api/auth/login','POST /api/auth/signup','POST /api/auth/forgot-password','D1: users / login_attempts / risk_audit'],
    security:['login 5/IP/min rate limit (D1)','24hr IP 黑名單階梯式 cooldown','password Argon2 hash + pepper','登入後 IP 跳國家 → audit critical + email'],
    tech:['Cloudflare Pages Functions','D1 atomic UPDATE...RETURNING','Turnstile','Discord webhook critical alert'],
  },
  oauth: {
    purpose:'Google / LINE / Facebook / Apple 第三方登入；同時是 chiyigo 對外的 OIDC Provider（給 mbti / talo / sport-app 等子站 SSO）。',
    flow:['使用者點 Google → /api/auth/oauth/google/start','PKCE + state + nonce 寫入 pkce_sessions','回 callback 換 code → 換 id_token → 驗 sig/iss/aud/nonce','找/建本地 user → bind oauth_account → 發 chiyigo 自家 token','子站走 /api/oauth/authorize：cookie session + prompt=none/login + max_age + RP registry'],
    api:['GET  /api/auth/oauth/{idp}/start','GET  /api/auth/oauth/{idp}/callback','GET  /api/oauth/authorize','POST /api/oauth/token','POST /api/oauth/backchannel-logout','D1: oauth_accounts / oauth_clients / pkce_sessions / auth_codes'],
    security:['ES256 JWK 對稱 / 非對稱簽章','aud 白名單 (talo/mbti/chiyigo/sport-app)','iss/aud/kid/nonce/fragment 五層驗證','RP Registry CRUD：新 RP 不必 deploy','Backchannel logout：sid 索引 + 三向 single sign-out'],
    tech:['jose (JWT)','OIDC discovery','PKCE S256','dynamic client registration'],
  },
  email: {
    purpose:'Email 驗證、密碼重設、bind email 流程。所有 token 走「一次性核銷 atomic UPDATE...RETURNING」，避免重放。',
    flow:['送 /api/auth/forgot-password','後端發 jti 進 email_tokens（hash 存）','使用者點信件連結 → /api/auth/reset-password','UPDATE email_tokens SET used_at=? WHERE jti=? AND used_at IS NULL RETURNING ...','RETURNING 為 0 → token 已用過或不存在 → 拒絕'],
    api:['POST /api/auth/forgot-password','POST /api/auth/reset-password','POST /api/auth/verify-email','POST /api/auth/resend-verify','D1: email_tokens (jti, hash, used_at, expires_at)'],
    security:['atomic 核銷防 race condition','token 只存 hash，DB 外洩無效','15 min TTL','已登入者對自己 email reset 不要 captcha；他人仍要','Resend API + 多金鑰輪換'],
    tech:['Resend','jti 一次性 token','D1 atomic write'],
  },
  mfa: {
    purpose:'TOTP 2FA + WebAuthn / Passkey + 高權限操作 step-up。disable 2FA 時主動清 token + 跳 login.html?tfa_disabled=1。',
    flow:['啟用：dashboard 顯 QR → otpauth URI → 驗 6 碼 OTP','登入：通過密碼後 → 額外送 OTP / passkey assertion','step-up：金流 / 改密碼前要求重新 2FA','發 elevated:* scope 短效 (5 min) 一次性 token','操作完即 revoke'],
    api:['POST /api/auth/2fa/enable','POST /api/auth/2fa/verify','POST /api/auth/webauthn/register','POST /api/auth/webauthn/login','POST /api/auth/step-up','D1: user_2fa / webauthn_credentials'],
    security:['otpauth secret 加密存 D1','WebAuthn challenge 一次性','step-up token TTL 5 min + jti','disable 2FA → bumpTokenVersion + graceful logout','requireStepUp middleware'],
    tech:['otpauth','@simplewebauthn/server','elevated:* scope claim','token version bump'],
  },
  device: {
    purpose:'每瀏覽器 web-<uuid> 存 localStorage；refresh token 強綁 device；mismatch 就撤整個 device 家族。',
    flow:['第一次開頁 → 生 web-<uuid> 寫 localStorage','refresh token 換發必帶 X-Device-Id header','後端比對：不符 → revoke 所有此 user_id+device_id 的 refresh','Dashboard 顯示所有 active 裝置','user 可單個 revoke 或一鍵全撤'],
    api:['GET    /api/auth/devices','DELETE /api/auth/devices/{id}','POST   /api/auth/refresh (X-Device-Id required)','D1: refresh_tokens (user_id, device_id, family_id, revoked_at)'],
    security:['device binding：refresh 不可跨裝置使用','異常裝置 → email + audit critical','country jump audit','passkey 綁定特定裝置','rename 顯示更友善的裝置名'],
    tech:['localStorage UUID','family-based revocation','X-Device-Id header'],
  },
  token: {
    purpose:'JWT (ES256) + refresh token 雙軌。jti 進 D1 黑名單即時撤銷；scope catalog 細粒度控制；token version bump 全家族失效。',
    flow:['登入成功 → 簽 access (15 min) + refresh (30 day)','API 收 access：verifyJwt → 查 jti 黑名單 → buildTokenScope','refresh 換新：rotation + 舊的進 revoked','requireScope("payment.write") 失敗 → 401','關鍵改動 (改密碼/disable 2FA) → bumpTokenVersion → 所有 token 立即失效'],
    api:['POST /api/auth/refresh','POST /api/auth/logout','POST /api/auth/revoke','D1: refresh_tokens / revoked_jtis / token_versions'],
    security:['ES256 非對稱 JWK','jti 黑名單立即生效','scope catalog 細粒度 (payment/admin/audit/elevated)','token version bump = 全裝置 logout','refresh rotation + reuse detection'],
    tech:['jose ES256','D1 jti index','scope-based authz','version bump cascade'],
  },
  audit: {
    purpose:'Admin 後台 + 22 種 audit 事件 + 結構化 log + traceId 中介層 + Discord critical 告警。',
    flow:['每個 endpoint → 中介層自動發 audit_log','分級：info / warn / critical','critical → 同步 Discord webhook','Admin Dashboard 可篩 user_id / event / time / severity','可清理白名單事件（payment/refund 不可清）'],
    api:['GET    /api/admin/audit','GET    /api/admin/users','POST   /api/admin/oauth-clients (CRUD)','DELETE /api/admin/audit/{id}','D1: audit_log (22 種 event_type)'],
    security:['critical 事件不可刪','admin scope: admin.read/admin.write','step-up 必經 2FA','所有 admin 動作自身亦寫 audit','observability traceId 全鏈路追蹤'],
    tech:['Cloudflare Real-time logs','traceId middleware','Discord webhook','admin RBAC'],
  },
  kyc: {
    purpose:'KYC 身分驗證 vendor-agnostic adapter。schema 不綁特定 vendor，可隨時切換 (Sumsub / Onfido / Persona / 國產)。',
    flow:['使用者進 dashboard /kyc → 上傳證件','POST /api/kyc/sessions 開 session','後端呼 vendor adapter（目前 mock）','vendor 回 webhook → 更新 kyc_session.status','status=approved → 解鎖金流出金限額'],
    api:['POST /api/kyc/sessions','POST /api/kyc/webhook','GET  /api/kyc/status','D1: kyc_sessions / kyc_documents'],
    security:['vendor adapter pattern','webhook 驗簽','PII 欄位加密','金流出金前必驗 KYC'],
    tech:['Phase F-1','adapter pattern','encrypt-at-rest'],
  },
  payment: {
    purpose:'F-2 wave 1-7：充值 / 退款 / 對帳 / step-up / 退款審核兩段式。已串綠界 ECPay AIO + CheckMacValue + 信用卡實機驗。',
    flow:['user 點充值 → POST /api/payment/intents → 取 ECPay form','綠界回 callback → 驗 CheckMacValue → UPDATE payment_intents','webhook 同步 D1（subunit + raw 雙欄位）','退款：user 申請 → admin 審核 (step-up + 2FA) → 走 ECPay 退款 API','對帳：cron 每日比對 ECPay vs D1'],
    api:['POST /api/payment/intents','POST /api/payment/webhook/ecpay','POST /api/payment/refund-request','POST /api/admin/refund/{id}/approve','D1: payment_intents / refund_requests'],
    security:['CheckMacValue 雙向驗','amount subunit/raw 雙欄位防誤算','退款 step-up + 2FA OTP','intent hard delete + audit 白名單','webhook idempotency'],
    tech:['ECPay AIO','CheckMacValue','D1 cron 對帳','step-up scope'],
  },
};

const STAGE = document.getElementById('cp-stage');
const SVG = document.getElementById('cp-lines');
const PANEL = document.getElementById('cp-panel');
const PANEL_EMPTY = document.getElementById('cp-panel-empty');
const PANEL_BODY = document.getElementById('cp-panel-body');
const PANEL_TAG = document.getElementById('cp-panel-tag');
const PANEL_TITLE = document.getElementById('cp-panel-title');
const PANEL_PURPOSE = document.getElementById('cp-panel-purpose');
const PANEL_FLOW = document.getElementById('cp-panel-flow');
const PANEL_API = document.getElementById('cp-panel-api');
const PANEL_SECURITY = document.getElementById('cp-panel-security');
const PANEL_TECH = document.getElementById('cp-panel-tech');
const PANEL_CLOSE = document.getElementById('cp-panel-close');

let activeId = null;
let curLang = localStorage.getItem('lang') || 'zh-TW';

function isMobile(){ return window.matchMedia('(max-width: 960px)').matches; }

function nodeLabel(n){ return curLang === 'zh-TW' ? n.label_zh : (n.label_en || n.label_zh); }

function buildNodes(){
  // remove existing nodes (keep svg)
  STAGE.querySelectorAll('.cp-node').forEach(el => el.remove());

  // core
  const core = document.createElement('button');
  core.type = 'button';
  core.className = 'cp-node cp-node-core';
  core.dataset.id = 'core';
  core.style.left = CORE.x + '%';
  core.style.top = CORE.y + '%';
  core.innerHTML = `<span class="cp-node-dot"></span><span>CHIYIGO 會員系統<span class="cp-node-core-sub">// IAM Platform</span></span>`;
  STAGE.appendChild(core);

  for (const n of NODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cp-node';
    btn.dataset.id = n.id;
    btn.style.left = n.x + '%';
    btn.style.top = n.y + '%';
    btn.innerHTML = `<span class="cp-node-dot"></span><span class="cp-node-label">${nodeLabel(n)}</span>`;
    STAGE.appendChild(btn);
  }
}

function buildLines(){
  if (isMobile()) { SVG.innerHTML = ''; return; }
  const w = STAGE.clientWidth, h = STAGE.clientHeight;
  SVG.setAttribute('viewBox', `0 0 ${w} ${h}`);
  SVG.innerHTML = '';
  const cx = CORE.x/100 * w, cy = CORE.y/100 * h;

  // core → each node
  for (const n of NODES) {
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', cx); line.setAttribute('y1', cy);
    line.setAttribute('x2', n.x/100 * w); line.setAttribute('y2', n.y/100 * h);
    line.dataset.from = 'core'; line.dataset.to = n.id;
    SVG.appendChild(line);
  }
  // dependency edges
  for (const [a,b] of EDGES) {
    const na = NODES.find(x=>x.id===a), nb = NODES.find(x=>x.id===b);
    if (!na || !nb) continue;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1', na.x/100 * w); line.setAttribute('y1', na.y/100 * h);
    line.setAttribute('x2', nb.x/100 * w); line.setAttribute('y2', nb.y/100 * h);
    line.dataset.from = a; line.dataset.to = b;
    line.setAttribute('stroke-dasharray','3 4');
    SVG.appendChild(line);
  }
}

function renderPanel(id){
  const n = NODES.find(x => x.id === id);
  const d = DETAILS[id];
  if (!n || !d) return;
  PANEL_EMPTY.hidden = true;
  PANEL_BODY.hidden = false;
  PANEL_TAG.textContent = n.tag;
  PANEL_TITLE.textContent = nodeLabel(n);
  PANEL_PURPOSE.textContent = d.purpose;
  PANEL_FLOW.innerHTML = d.flow.map(s => `<li>${esc(s)}</li>`).join('');
  PANEL_API.innerHTML = d.api.map(s => `<li>${esc(s)}</li>`).join('');
  PANEL_SECURITY.innerHTML = d.security.map(s => `<li>${esc(s)}</li>`).join('');
  PANEL_TECH.innerHTML = d.tech.map(s => `<span>${esc(s)}</span>`).join('');
}

function clearPanel(){
  PANEL_BODY.hidden = true;
  PANEL_EMPTY.hidden = false;
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function setActive(id){
  if (id === 'core') id = null;
  activeId = id;

  // node states
  STAGE.querySelectorAll('.cp-node').forEach(el => {
    const eid = el.dataset.id;
    el.classList.toggle('active', eid === id);
    el.classList.toggle('dim', !!id && eid !== id && eid !== 'core' && !isConnected(id, eid));
  });

  // line states
  SVG.querySelectorAll('line').forEach(l => {
    const isHit = id && (l.dataset.from === id || l.dataset.to === id);
    l.classList.toggle('active', !!isHit);
    l.classList.toggle('dim', !!id && !isHit);
  });

  if (id) renderPanel(id);
  else clearPanel();

  // mobile: scroll panel into view
  if (id && isMobile()) {
    setTimeout(() => PANEL.scrollIntoView({behavior:'smooth', block:'start'}), 60);
  }
}

function isConnected(a, b){
  if (a === b) return true;
  return EDGES.some(e => (e[0]===a && e[1]===b) || (e[1]===a && e[0]===b));
}

STAGE.addEventListener('click', e => {
  const btn = e.target.closest('.cp-node');
  if (!btn) return;
  const id = btn.dataset.id;
  if (id === 'core') { setActive(null); return; }
  if (id === activeId) setActive(null);
  else setActive(id);
});

PANEL_CLOSE?.addEventListener('click', () => setActive(null));

// resize → rebuild lines
let resizeT;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => buildLines(), 120);
});

// ── i18n ──
const LANGS_I18N = /*@i18n@*/{};

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

  // re-render nodes (labels) + active panel
  STAGE.querySelectorAll('.cp-node').forEach(el => {
    const id = el.dataset.id;
    if (id === 'core') return;
    const n = NODES.find(x => x.id === id);
    if (n) {
      const lbl = el.querySelector('.cp-node-label');
      if (lbl) lbl.textContent = nodeLabel(n);
    }
  });
  if (activeId) renderPanel(activeId);
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

// ── Init ──
buildNodes();
buildLines();
applyLang(curLang);

// ── Mobile overlay / drag-close ──（與 portfolio.js 同款）
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu(){ hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.style.overflow='hidden'; }
function closeMenu(){ hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.style.overflow=''; }
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
      setTimeout(()=>{wrap.style.transform='';wrap.style.transition='';ov.classList.remove('is-open');ov.setAttribute('aria-hidden','true');const btn=document.getElementById('m-ham-btn');btn?.classList.remove('is-open');btn?.setAttribute('aria-expanded','false');document.getElementById('m-topbar')?.classList.remove('menu-open');document.body.style.overflow='';},260);
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

// ── Neural canvas (與 portfolio.js 同款) ──
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
