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
    if (sun)  sun.style.display  = dark ? 'none' : '';
    if (moon) moon.style.display = dark ? ''     : 'none';
  });
}
applyTheme(localStorage.getItem('theme') !== 'light');
const doToggle = () => { const d = !document.documentElement.classList.contains('theme-dark'); localStorage.setItem('theme', d ? 'dark' : 'light'); applyTheme(d); };
themeBtn?.addEventListener('click', doToggle);
mThemeBtn?.addEventListener('click', doToggle);

// ── i18n ───────────────────────────────────────────────────
const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目","nav_process":"服務流程","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","cta_q":"準備好開始專案了嗎？","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","dashboard":"會員中心","status_open":"接案中","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","footer_contact_title":"聯絡我們","page_title":"接案諮詢紀錄","page_desc":"來自 chiyigo.com/requisition 的表單提交","logout":"登出","loading":"// 載入中…","relogin":"→ 重新登入","search_aria":"搜尋需求單","search_ph":"搜尋姓名 / 聯絡方式 / 需求…","col_name":"姓名 / 公司","col_contact":"聯絡方式","col_service":"需求類型","col_budget":"預算","col_timeline":"時程","col_created":"提交時間","no_data":"// no data","prev_page":"← 上一頁","next_page":"下一頁 →","page_label":"第 {p} / {t} 頁","total_label":"共 {n} 筆","modal_title":"諮詢詳情","field_name":"姓名","field_company":"公司 / 品牌","field_contact":"聯絡方式","field_service":"需求類型","field_budget":"預算區間","field_timeline":"預計時程","field_message":"需求簡述","err_login_required":"請先登入","err_perm":"權限不足或登入已過期，請確認帳號具有 admin 角色","err_not_logged_in":"尚未登入","err_http":"HTTP {n}","st_system":"系統開發 / 內部工具","st_web":"網站建置 / Landing Page","st_integration":"第三方串接 / 自動化","st_interactive":"互動體驗 / 品牌活動","st_branding":"品牌識別 / 視覺設計","st_marketing":"數位行銷 / SEO","st_other":"其他","bd_under30k":"< 30,000","bd_30k80k":"30k–80k","bd_80k200k":"80k–200k","bd_over200k":"> 200,000","bd_flexible":"彈性","tl_asap":"越快越好","tl_1_3m":"1–3 個月","tl_3_6m":"3–6 個月","tl_flexible":"彈性","member_center":"會員中心"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","cta_q":"Ready to Start a Project?","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","dashboard":"Dashboard","status_open":"Open for Work","footer_tagline":"Not just pretty interfaces — we turn your needs into systems that actually work.","footer_contact_title":"Contact Us","page_title":"Inquiry Records","page_desc":"Submissions from chiyigo.com/requisition","logout":"Sign Out","loading":"// loading…","relogin":"→ Log in again","search_aria":"Search requisitions","search_ph":"Search name / contact / message…","col_name":"Name / Company","col_contact":"Contact","col_service":"Service Type","col_budget":"Budget","col_timeline":"Timeline","col_created":"Submitted","no_data":"// no data","prev_page":"← Previous","next_page":"Next →","page_label":"Page {p} / {t}","total_label":"{n} total","modal_title":"Inquiry Details","field_name":"Name","field_company":"Company / Brand","field_contact":"Contact","field_service":"Service Type","field_budget":"Budget","field_timeline":"Timeline","field_message":"Description","err_login_required":"Please log in first","err_perm":"Insufficient permissions or session expired. The account must have the admin role.","err_not_logged_in":"Not signed in","err_http":"HTTP {n}","st_system":"System / Internal Tools","st_web":"Website / Landing Page","st_integration":"Integrations / Automation","st_interactive":"Interactive / Brand Events","st_branding":"Branding / Visual Design","st_marketing":"Digital Marketing / SEO","st_other":"Other","bd_under30k":"< 30,000","bd_30k80k":"30k–80k","bd_80k200k":"80k–200k","bd_over200k":"> 200,000","bd_flexible":"Flexible","tl_asap":"ASAP","tl_1_3m":"1–3 months","tl_3_6m":"3–6 months","tl_flexible":"Flexible","member_center":"Member Center"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"開発プロセス","nav_portfolio":"実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_q":"プロジェクトを始めませんか？","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","dashboard":"マイページ","status_open":"受注中","footer_tagline":"見た目だけでなく、要件を本当に使えるシステムに変えます。","footer_contact_title":"お問い合わせ","page_title":"お問い合わせ記録","page_desc":"chiyigo.com/requisition からの送信","logout":"ログアウト","loading":"// 読み込み中…","relogin":"→ 再ログイン","search_aria":"お問い合わせを検索","search_ph":"名前 / 連絡先 / 内容で検索…","col_name":"名前 / 会社","col_contact":"連絡先","col_service":"サービス","col_budget":"予算","col_timeline":"期間","col_created":"送信日時","no_data":"// データなし","prev_page":"← 前へ","next_page":"次へ →","page_label":"{p} / {t} ページ","total_label":"合計 {n} 件","modal_title":"問い合わせ詳細","field_name":"名前","field_company":"会社 / ブランド","field_contact":"連絡先","field_service":"サービス","field_budget":"予算","field_timeline":"希望時期","field_message":"内容","err_login_required":"先にログインしてください","err_perm":"権限が不足しているか、セッションが期限切れです。admin 権限のアカウントが必要です。","err_not_logged_in":"ログインしていません","err_http":"HTTP {n}","st_system":"システム開発 / 社内ツール","st_web":"ウェブサイト / ランディングページ","st_integration":"API 連携 / 自動化","st_interactive":"インタラクティブ / ブランドイベント","st_branding":"ブランディング / ビジュアル","st_marketing":"デジタルマーケティング / SEO","st_other":"その他","bd_under30k":"< 30,000","bd_30k80k":"30k–80k","bd_80k200k":"80k–200k","bd_over200k":"> 200,000","bd_flexible":"柔軟","tl_asap":"できるだけ早く","tl_1_3m":"1〜3 ヶ月","tl_3_6m":"3〜6 ヶ月","tl_flexible":"柔軟","member_center":"メンバーセンター"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"진행 과정","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_q":"프로젝트를 시작할 준비가 되셨나요?","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","dashboard":"마이페이지","status_open":"수주 중","footer_tagline":"예쁜 화면만이 아닌, 요구사항을 실제로 사용 가능한 시스템으로 만듭니다.","footer_contact_title":"연락하기","page_title":"문의 기록","page_desc":"chiyigo.com/requisition에서의 제출","logout":"로그아웃","loading":"// 불러오는 중…","relogin":"→ 다시 로그인","search_aria":"문의 검색","search_ph":"이름 / 연락처 / 내용 검색…","col_name":"이름 / 회사","col_contact":"연락처","col_service":"서비스 유형","col_budget":"예산","col_timeline":"일정","col_created":"제출 일시","no_data":"// 데이터 없음","prev_page":"← 이전","next_page":"다음 →","page_label":"{p} / {t} 페이지","total_label":"총 {n}건","modal_title":"문의 상세","field_name":"이름","field_company":"회사 / 브랜드","field_contact":"연락처","field_service":"서비스 유형","field_budget":"예산","field_timeline":"희망 일정","field_message":"요청 내용","err_login_required":"먼저 로그인해 주세요","err_perm":"권한이 부족하거나 세션이 만료되었습니다. admin 역할이 필요합니다.","err_not_logged_in":"로그인하지 않음","err_http":"HTTP {n}","st_system":"시스템 개발 / 내부 도구","st_web":"웹사이트 / 랜딩 페이지","st_integration":"외부 연동 / 자동화","st_interactive":"인터랙티브 / 브랜드 이벤트","st_branding":"브랜딩 / 비주얼 디자인","st_marketing":"디지털 마케팅 / SEO","st_other":"기타","bd_under30k":"< 30,000","bd_30k80k":"30k–80k","bd_80k200k":"80k–200k","bd_over200k":"> 200,000","bd_flexible":"유연","tl_asap":"가능한 빨리","tl_1_3m":"1–3개월","tl_3_6m":"3–6개월","tl_flexible":"유연","member_center":"회원 센터"}};
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
