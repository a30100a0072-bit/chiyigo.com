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
const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目","nav_process":"服務流程","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","nav_admin_payments":"金流對帳","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","cta_btn_m":"開始諮詢 →","dashboard":"會員中心","status_open":"接案中","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","footer_contact_title":"聯絡我們","page_title":"接案諮詢紀錄","page_desc":"來自 chiyigo.com/requisition 的表單提交","logout":"登出","loading":"// 載入中…","relogin":"→ 重新登入","search_aria":"搜尋需求單","search_ph":"搜尋姓名 / 聯絡方式 / 需求…","col_name":"姓名 / 公司","col_contact":"聯絡方式","col_service":"需求類型","col_budget":"預算","col_timeline":"時程","col_created":"提交時間","no_data":"// no data","prev_page":"← 上一頁","next_page":"下一頁 →","page_label":"第 {p} / {t} 頁","total_label":"共 {n} 筆","modal_title":"諮詢詳情","field_name":"姓名","field_company":"公司 / 品牌","field_contact":"聯絡方式","field_service":"需求類型","field_budget":"預算區間","field_timeline":"預計時程","field_message":"需求簡述","err_login_required":"請先登入","err_perm":"權限不足或登入已過期，請確認帳號具有 admin 角色","err_not_logged_in":"尚未登入","err_http":"HTTP {n}","st_system":"系統開發 / 內部工具","st_web":"網站建置 / Landing Page","st_integration":"第三方串接 / 自動化","st_interactive":"互動體驗 / 品牌活動","st_branding":"品牌識別 / 視覺設計","st_marketing":"數位行銷 / SEO","st_other":"其他","bd_under30k":"< 30,000","bd_30k80k":"30k–80k","bd_80k200k":"80k–200k","bd_over200k":"> 200,000","bd_flexible":"彈性","tl_asap":"越快越好","tl_1_3m":"1–3 個月","tl_3_6m":"3–6 個月","tl_flexible":"彈性","member_center":"會員中心"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","nav_admin_payments":"Payments","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get in Touch","cta_btn_m":"Get in Touch →","dashboard":"Dashboard","status_open":"Open for Work","footer_tagline":"Not just pretty interfaces — we turn your needs into systems that actually work.","footer_contact_title":"Contact Us","page_title":"Inquiry Records","page_desc":"Submissions from chiyigo.com/requisition","logout":"Sign Out","loading":"// loading…","relogin":"→ Log in again","search_aria":"Search requisitions","search_ph":"Search name / contact / message…","col_name":"Name / Company","col_contact":"Contact","col_service":"Service Type","col_budget":"Budget","col_timeline":"Timeline","col_created":"Submitted","no_data":"// no data","prev_page":"← Previous","next_page":"Next →","page_label":"Page {p} / {t}","total_label":"{n} total","modal_title":"Inquiry Details","field_name":"Name","field_company":"Company / Brand","field_contact":"Contact","field_service":"Service Type","field_budget":"Budget","field_timeline":"Timeline","field_message":"Description","err_login_required":"Please log in first","err_perm":"Insufficient permissions or session expired. The account must have the admin role.","err_not_logged_in":"Not signed in","err_http":"HTTP {n}","st_system":"System / Internal Tools","st_web":"Website / Landing Page","st_integration":"Integrations / Automation","st_interactive":"Interactive / Brand Events","st_branding":"Branding / Visual Design","st_marketing":"Digital Marketing / SEO","st_other":"Other","bd_under30k":"< 30,000","bd_30k80k":"30k–80k","bd_80k200k":"80k–200k","bd_over200k":"> 200,000","bd_flexible":"Flexible","tl_asap":"ASAP","tl_1_3m":"1–3 months","tl_3_6m":"3–6 months","tl_flexible":"Flexible","member_center":"Member Center"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"開発プロセス","nav_portfolio":"実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","nav_admin_payments":"決済照合","cta_desc":"最適なデジタルソリューションを一緒に作りましょう！","cta_btn":"相談する","cta_btn_m":"相談する →","dashboard":"マイページ","status_open":"受注中","footer_tagline":"見た目だけでなく、要件を本当に使えるシステムに変えます。","footer_contact_title":"お問い合わせ","page_title":"お問い合わせ記録","page_desc":"chiyigo.com/requisition からの送信","logout":"ログアウト","loading":"// 読み込み中…","relogin":"→ 再ログイン","search_aria":"お問い合わせを検索","search_ph":"名前 / 連絡先 / 内容で検索…","col_name":"名前 / 会社","col_contact":"連絡先","col_service":"サービス","col_budget":"予算","col_timeline":"期間","col_created":"送信日時","no_data":"// データなし","prev_page":"← 前へ","next_page":"次へ →","page_label":"{p} / {t} ページ","total_label":"合計 {n} 件","modal_title":"問い合わせ詳細","field_name":"名前","field_company":"会社 / ブランド","field_contact":"連絡先","field_service":"サービス","field_budget":"予算","field_timeline":"希望時期","field_message":"内容","err_login_required":"先にログインしてください","err_perm":"権限が不足しているか、セッションが期限切れです。admin 権限のアカウントが必要です。","err_not_logged_in":"ログインしていません","err_http":"HTTP {n}","st_system":"システム開発 / 社内ツール","st_web":"ウェブサイト / ランディングページ","st_integration":"API 連携 / 自動化","st_interactive":"インタラクティブ / ブランドイベント","st_branding":"ブランディング / ビジュアル","st_marketing":"デジタルマーケティング / SEO","st_other":"その他","bd_under30k":"< 30,000","bd_30k80k":"30k–80k","bd_80k200k":"80k–200k","bd_over200k":"> 200,000","bd_flexible":"柔軟","tl_asap":"できるだけ早く","tl_1_3m":"1〜3 ヶ月","tl_3_6m":"3〜6 ヶ月","tl_flexible":"柔軟","member_center":"メンバーセンター"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"진행 과정","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의하기","nav_admin_payments":"결제 대사","cta_desc":"최적의 디지털 솔루션을 함께 만들어보세요!","cta_btn":"상담 시작","cta_btn_m":"상담 시작 →","dashboard":"마이페이지","status_open":"수주 중","footer_tagline":"예쁜 화면만이 아닌, 요구사항을 실제로 사용 가능한 시스템으로 만듭니다.","footer_contact_title":"연락하기","page_title":"문의 기록","page_desc":"chiyigo.com/requisition에서의 제출","logout":"로그아웃","loading":"// 불러오는 중…","relogin":"→ 다시 로그인","search_aria":"문의 검색","search_ph":"이름 / 연락처 / 내용 검색…","col_name":"이름 / 회사","col_contact":"연락처","col_service":"서비스 유형","col_budget":"예산","col_timeline":"일정","col_created":"제출 일시","no_data":"// 데이터 없음","prev_page":"← 이전","next_page":"다음 →","page_label":"{p} / {t} 페이지","total_label":"총 {n}건","modal_title":"문의 상세","field_name":"이름","field_company":"회사 / 브랜드","field_contact":"연락처","field_service":"서비스 유형","field_budget":"예산","field_timeline":"희망 일정","field_message":"요청 내용","err_login_required":"먼저 로그인해 주세요","err_perm":"권한이 부족하거나 세션이 만료되었습니다. admin 역할이 필요합니다.","err_not_logged_in":"로그인하지 않음","err_http":"HTTP {n}","st_system":"시스템 개발 / 내부 도구","st_web":"웹사이트 / 랜딩 페이지","st_integration":"외부 연동 / 자동화","st_interactive":"인터랙티브 / 브랜드 이벤트","st_branding":"브랜딩 / 비주얼 디자인","st_marketing":"디지털 마케팅 / SEO","st_other":"기타","bd_under30k":"< 30,000","bd_30k80k":"30k–80k","bd_80k200k":"80k–200k","bd_over200k":"> 200,000","bd_flexible":"유연","tl_asap":"가능한 빨리","tl_1_3m":"1–3개월","tl_3_6m":"3–6개월","tl_flexible":"유연","member_center":"회원 센터"}};
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
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);
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

const REQ_STATUS_LABEL = {
  pending:        '待處理',
  refund_pending: '退款審核中',
  revoked:        '已撤銷',
  deal:           '已成交',
  processing:     '處理中',
  completed:      '已完成',
};
const REQ_STATUS_CLS = {
  pending:        'background:rgba(245,158,11,.12);color:#d97706;border:1px solid rgba(245,158,11,.32)',
  refund_pending: 'background:rgba(249,115,22,.12);color:#c2410c;border:1px solid rgba(249,115,22,.32)',
  revoked:        'background:rgba(107,114,128,.1);color:#6b7280;border:1px solid rgba(107,114,128,.32)',
  deal:           'background:rgba(16,185,129,.12);color:#059669;border:1px solid rgba(16,185,129,.32)',
};
function statusPill(status) {
  const lbl = REQ_STATUS_LABEL[status] || status;
  const cls = REQ_STATUS_CLS[status] || REQ_STATUS_CLS.pending;
  return `<span style="${cls};display:inline-flex;padding:.18rem .55rem;border-radius:6px;font-size:.72rem;font-weight:500">${esc(lbl)}</span>`;
}

function openModal(id) {
  const r = window._reqData?.[id]
  if (!r) return
  const t = T()
  const body = document.getElementById('modal-body')
  const status = r.status || 'pending'
  // 動作鍵：保存 / 刪除 — pending 才顯示保存（其他狀態語意上不該移成交）；刪除全狀態都顯示
  const saveBtnHtml = status === 'pending'
    ? `<button class="confirm" data-ra-action="save" data-ra-id="${r.id}" style="flex:1">保存（成交）</button>`
    : '';
  const delBtnHtml = `<button data-ra-action="delete" data-ra-id="${r.id}" style="flex:1;padding:.55rem;border-radius:8px;background:transparent;border:1px solid rgba(239,68,68,.4);color:#dc2626;font-size:.85rem;font-weight:500;cursor:pointer">刪除</button>`;

  body.innerHTML = `
    <div class="modal-meta">
      <span>#${r.id}</span><span>·</span><span>${formatDate(r.created_at)}</span>
      <span style="margin-left:auto">${statusPill(status)}</span>
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
    </div>
    <div style="display:flex;gap:.6rem;margin-top:.5rem">
      ${saveBtnHtml}${delBtnHtml}
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

// ── 需求單刪除紀錄清理（audit_log event_type='requisition.deleted'）──
function escA(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

async function openAuditCleanup() {
  const modal = document.getElementById('modal-audit-cleanup');
  modal.classList.add('open');
  const list = document.getElementById('audit-cleanup-list');
  list.innerHTML = `<p class="empty-state">載入中…</p>`;
  const tok = getToken();
  if (!tok) { list.innerHTML = `<p class="empty-state" style="color:#dc2626">未登入</p>`; return; }

  const r = await fetch('/api/admin/audit?event_type=requisition.deleted&limit=200', {
    headers: { Authorization: `Bearer ${tok}` },
  }).catch(() => null);
  if (!r || !r.ok) { list.innerHTML = `<p class="empty-state" style="color:#dc2626">載入失敗</p>`; return; }
  const j = await r.json();
  const rows = j.rows ?? [];
  if (!rows.length) { list.innerHTML = `<p class="empty-state">沒有刪除紀錄</p>`; return; }
  list.innerHTML = rows.map(row => {
    let data = {};
    try { data = typeof row.event_data === 'string' ? JSON.parse(row.event_data) : (row.event_data ?? {}); } catch {}
    const reqId = data?.requisition_id ?? '?';
    const actor = data?.actor ?? '?';
    return `
      <div class="refund-row">
        <div class="refund-row__head">
          <div class="refund-row__ids">
            <span class="req-tag">audit #${row.id}</span>
            <span class="meta-tag">req #${escA(reqId)}</span>
            <span class="meta-tag">user ${escA(row.user_id ?? '?')}</span>
          </div>
        </div>
        <div class="refund-row__sub">actor=${escA(actor)} · ${escA(row.created_at)}</div>
        <div class="refund-row__actions">
          <button class="reject" data-audit-del="${row.id}" data-armed="0">清除（兩段式 + OTP）</button>
        </div>
      </div>`;
  }).join('');
}

let _auditDelTimer = null;
async function auditDelGo(auditId, btn) {
  if (btn.dataset.armed !== '1') {
    document.querySelectorAll('[data-audit-del]').forEach(b => {
      if (b !== btn) {
        b.dataset.armed = '0'; b.textContent = '清除';
        b.style.background = 'rgba(239,68,68,.12)'; b.style.borderColor = 'rgba(239,68,68,.3)'; b.style.color = '#fca5a5';
      }
    });
    btn.dataset.armed = '1';
    btn.textContent = '確認清除';
    btn.style.background = 'rgba(239,68,68,.4)';
    btn.style.borderColor = 'rgba(239,68,68,.7)';
    btn.style.color = '#fee2e2';
    if (_auditDelTimer) clearTimeout(_auditDelTimer);
    _auditDelTimer = setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '0'; btn.textContent = '清除';
      btn.style.background = 'rgba(239,68,68,.12)'; btn.style.borderColor = 'rgba(239,68,68,.3)'; btn.style.color = '#fca5a5';
    }, 4000);
    return;
  }
  if (_auditDelTimer) { clearTimeout(_auditDelTimer); _auditDelTimer = null; }
  const tok = getToken();
  if (!tok) return;
  // 此 endpoint 需要 step-up（elevated:account），先要 OTP
  const otp = prompt('輸入 6 位 2FA OTP 確認永久清除 audit #' + auditId);
  if (!otp || !/^\d{6}$/.test(otp)) return;
  btn.disabled = true; btn.textContent = '處理中…';
  const su = await fetch('/api/auth/step-up', {
    method:  'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${tok}` },
    body:    JSON.stringify({ scope:'elevated:account', for_action:'delete_audit', otp_code: otp }),
  }).catch(() => null);
  if (!su || !su.ok) { btn.disabled = false; btn.textContent = '清除'; alert('step-up 失敗'); return; }
  const { step_up_token } = await su.json();
  const r = await fetch(`/api/admin/audit/${auditId}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${step_up_token}` },
  }).catch(() => null);
  if (!r || !r.ok) { btn.disabled = false; btn.textContent = '清除'; alert('刪除失敗'); return; }
  btn.closest('div[style*="border:1px solid"]')?.remove();
}

document.getElementById('audit-cleanup-btn')?.addEventListener('click', openAuditCleanup);
document.addEventListener('click', e => {
  const delBtn = e.target.closest('[data-audit-del]');
  if (delBtn) return auditDelGo(Number(delBtn.dataset.auditDel), delBtn);
  // 共用：data-modal-close
  const mc = e.target.closest('[data-modal-close]');
  if (mc) document.getElementById(mc.dataset.modalClose)?.classList.remove('open');
  // 退款列表內按鈕
  const rfApprove = e.target.closest('[data-rf-approve]');
  if (rfApprove) return openRefundDecide(Number(rfApprove.dataset.rfApprove), 'approve');
  const rfReject  = e.target.closest('[data-rf-reject]');
  if (rfReject)  return openRefundDecide(Number(rfReject.dataset.rfReject), 'reject');
  // 詳情 modal 內：保存 / 刪除
  const ra = e.target.closest('[data-ra-action]');
  if (ra) return openReqAction(ra.dataset.raAction, Number(ra.dataset.raId));
});
// 點 backdrop 自動關
document.querySelectorAll('.modal-bd').forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
});

// ── 退款申請審核（F-2 wave 7）──────────────────────────────
async function fetchPendingRefundCount() {
  const tok = getToken();
  if (!tok) return;
  const r = await fetch('/api/admin/requisition-refund?status=pending&limit=1', {
    headers: { Authorization: `Bearer ${tok}` },
  }).catch(() => null);
  if (!r || !r.ok) return;
  const j = await r.json();
  const badge = document.getElementById('refund-pending-count');
  if (!badge) return;
  if (j.total > 0) { badge.textContent = j.total; badge.hidden = false; }
  else             { badge.hidden = true; }
}
fetchPendingRefundCount();

let _rrCache = []; // 目前 modal 顯示的 rows，supply summary

async function openRefundReview() {
  const modal = document.getElementById('modal-refund-review');
  modal.classList.add('open');
  const list = document.getElementById('refund-review-list');
  list.innerHTML = `<p class="empty-state">載入中…</p>`;

  const tok = getToken();
  if (!tok) { list.innerHTML = `<p class="empty-state" style="color:#dc2626">未登入</p>`; return; }
  const r = await fetch('/api/admin/requisition-refund?status=pending&limit=200', {
    headers: { Authorization: `Bearer ${tok}` },
  }).catch(() => null);
  if (!r || !r.ok) { list.innerHTML = `<p class="empty-state" style="color:#dc2626">載入失敗</p>`; return; }
  const j = await r.json();
  _rrCache = j.rows ?? [];
  renderRefundReviewList();
}

function renderRefundReviewList() {
  const list = document.getElementById('refund-review-list');
  if (!list) return;
  if (!_rrCache.length) {
    list.innerHTML = `<p class="empty-state">沒有待審核退款申請</p>`;
    return;
  }
  list.innerHTML = _rrCache.map(row => {
    const amt = row.intent_amount_subunit != null
      ? `${Number(row.intent_amount_subunit).toLocaleString()} ${escA(row.intent_currency || 'TWD')}`
      : '—';
    return `
      <div class="refund-row" data-rr-row="${row.id}">
        <div class="refund-row__head">
          <div class="refund-row__ids">
            <span class="req-tag">req #${escA(row.requisition_id)}</span>
            <span class="meta-tag">user ${escA(row.user_id)}</span>
            <span class="meta-tag">intent #${escA(row.intent_id ?? '?')} (${escA(row.intent_vendor ?? '?')})</span>
          </div>
          <div class="refund-row__amount">${amt}</div>
        </div>
        <div class="refund-row__sub">
          ${escA(row.req_name ?? '')}${row.req_contact ? ' · ' + escA(row.req_contact) : ''} · 申請時間 ${escA(row.created_at)}
        </div>
        <div class="refund-row__reason">${escA(row.reason ?? '(未填)')}</div>
        <div class="refund-row__actions">
          <button class="reject"  data-rf-reject="${row.id}">拒絕</button>
          <button class="approve" data-rf-approve="${row.id}">通過 + 退款</button>
        </div>
      </div>`;
  }).join('');
}

// ── Decide modal（OTP + 備註）──────────────────────────────
let _rrDecideId = null;
let _rrDecideAction = null;

function openRefundDecide(id, action) {
  const row = _rrCache.find(r => r.id === id);
  if (!row) return;
  _rrDecideId = id;
  _rrDecideAction = action;
  const isApprove = action === 'approve';
  const amt = row.intent_amount_subunit != null
    ? `${Number(row.intent_amount_subunit).toLocaleString()} ${escA(row.intent_currency || 'TWD')}`
    : '—';
  document.getElementById('rd-title').textContent = isApprove ? '通過退款並執行' : '拒絕退款申請';
  document.getElementById('rd-summary').innerHTML = isApprove
    ? `通過後 <strong>立刻退款 ${amt}</strong> 並撤銷需求單 #${escA(row.requisition_id)}（intent #${escA(row.intent_id)}）。動作不可逆。`
    : `拒絕退款申請 #${escA(id)}（req #${escA(row.requisition_id)}）。需求單仍維持「退款審核中」，user 可改聯絡客服。`;
  document.getElementById('rd-note-label').textContent = isApprove ? '審核備註（選填）' : '拒絕理由（建議填）';
  document.getElementById('rd-note').value = '';
  document.getElementById('rd-otp').value = '';
  setRdMsg('', '');
  const btn = document.getElementById('rd-confirm-btn');
  btn.disabled = false;
  btn.textContent = isApprove ? '確認通過並退款' : '確認拒絕';
  btn.className = isApprove ? 'confirm' : 'cancel';
  btn.style.cssText = isApprove
    ? ''
    : 'background:#dc2626;border-color:#dc2626;color:#fff';
  document.getElementById('modal-refund-decide').classList.add('open');
  setTimeout(() => document.getElementById('rd-otp')?.focus(), 50);
}

function setRdMsg(text, type) {
  const el = document.getElementById('rd-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'refund-msg' + (type ? ' ' + type : '');
}

document.getElementById('rd-confirm-btn')?.addEventListener('click', async () => {
  const id  = _rrDecideId;
  const act = _rrDecideAction;
  if (!id || !act) return;
  const otp  = document.getElementById('rd-otp').value.trim();
  const note = document.getElementById('rd-note').value.trim();
  if (!/^\d{6}$/.test(otp)) { setRdMsg('OTP 須為 6 位數字', 'err'); return; }
  const tok = getToken();
  if (!tok) { setRdMsg('未登入', 'err'); return; }

  const btn = document.getElementById('rd-confirm-btn');
  btn.disabled = true;
  setRdMsg('step-up 驗證中…', '');

  const forAction = act === 'approve' ? 'approve_requisition_refund' : 'reject_requisition_refund';
  const su = await fetch('/api/auth/step-up', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body:    JSON.stringify({ scope: 'elevated:payment', for_action: forAction, otp_code: otp }),
  }).catch(() => null);
  if (!su || !su.ok) {
    let msg = 'step-up 失敗';
    try { const j = await su.json(); msg = j.error || msg; } catch {}
    setRdMsg(msg, 'err'); btn.disabled = false; return;
  }
  const { step_up_token } = await su.json();
  if (!step_up_token) { setRdMsg('未拿到 step-up token', 'err'); btn.disabled = false; return; }

  setRdMsg(act === 'approve' ? '呼叫 ECPay 退款中…' : '寫入拒絕中…', '');
  const r = await fetch(`/api/admin/requisition-refund/${id}/${act}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${step_up_token}` },
    body:    JSON.stringify({ admin_note: note || null }),
  }).catch(() => null);
  if (!r || !r.ok) {
    let msg = `${act} 失敗`;
    try { const j = await r.json(); msg = (j.error || msg) + (j.rtn_msg ? ` / ${j.rtn_msg}` : ''); } catch {}
    setRdMsg(msg, 'err'); btn.disabled = false; return;
  }
  setRdMsg(act === 'approve' ? '✓ 已通過並退款' : '✓ 已拒絕', 'ok');
  // 從 cache + DOM 移除這筆，避免重複按
  _rrCache = _rrCache.filter(x => x.id !== id);
  setTimeout(() => {
    document.getElementById('modal-refund-decide').classList.remove('open');
    renderRefundReviewList();
    fetchPendingRefundCount();
  }, 900);
});

document.getElementById('refund-review-btn')?.addEventListener('click', openRefundReview);

// ── 需求單保存 / 刪除（兩段式確認，admin only）─────────────
let _raCtx = { action: null, id: null, armed: false };

function openReqAction(action, id) {
  const r = window._reqData?.[id];
  if (!r) return;
  _raCtx = { action, id, armed: false };
  const isSave = action === 'save';
  document.getElementById('ra-title').textContent = isSave ? '保存為成交資料' : '刪除需求單';
  document.getElementById('ra-summary').innerHTML = isSave
    ? `將 req #${id}（${escA(r.name)} / ${escA(r.contact)}）寫入「成交資料庫」。
       後續可在 deals 表追蹤；TG 訊息會更新成 ✅ 已成交（含付款摘要）。`
    : `<strong style="color:#dc2626">⚠️ 永久刪除 req #${id}</strong>
       — DB row 直接消失；如有未退款的 succeeded payment 後端會擋下。
       TG 訊息更新成 🗑 已刪除。`;
  document.getElementById('ra-note-label').textContent = isSave ? '備註（選填，會寫入 deal.notes）' : '刪除原因（建議填，存 audit）';
  document.getElementById('ra-note').value = '';
  setRaMsg('', '');
  const btn = document.getElementById('ra-confirm-btn');
  btn.dataset.armed = '0';
  btn.textContent = isSave ? '下一步：確認保存' : '下一步：確認刪除';
  btn.disabled = false;
  btn.style.cssText = isSave ? '' : 'background:#dc2626;border-color:#dc2626;color:#fff';
  // 關上詳情，避免層疊
  document.getElementById('modal').classList.remove('open');
  document.getElementById('modal-req-action').classList.add('open');
}

function setRaMsg(text, type) {
  const el = document.getElementById('ra-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'refund-msg' + (type ? ' ' + type : '');
}

document.getElementById('ra-confirm-btn')?.addEventListener('click', async () => {
  const { action, id } = _raCtx;
  if (!action || !id) return;
  const btn = document.getElementById('ra-confirm-btn');
  // 兩段式：第一次點擊只 arm；第二次才送
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = action === 'save' ? '⚠️ 再點一次確認保存' : '⚠️ 再點一次確認刪除';
    setRaMsg('已進入確認狀態，再點一次按鈕送出', '');
    setTimeout(() => {
      if (btn.dataset.armed === '1') {
        btn.dataset.armed = '0';
        btn.textContent = action === 'save' ? '下一步：確認保存' : '下一步：確認刪除';
        setRaMsg('', '');
      }
    }, 5000);
    return;
  }

  btn.disabled = true;
  setRaMsg('送出中…', '');
  const tok = getToken();
  const note = document.getElementById('ra-note').value.trim();
  const ep = `/api/admin/requisitions/${id}/${action}`;
  const r = await fetch(ep, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body:    JSON.stringify(action === 'save' ? { notes: note || null } : { confirm: true, notes: note || null }),
  }).catch(() => null);
  if (!r || !r.ok) {
    let msg = `${action} 失敗`;
    try { const j = await r.json(); msg = j.error || msg; } catch {}
    setRaMsg(msg, 'err');
    btn.disabled = false; btn.dataset.armed = '0';
    btn.textContent = action === 'save' ? '下一步：確認保存' : '下一步：確認刪除';
    return;
  }
  setRaMsg(action === 'save' ? '✓ 已保存到 deals' : '✓ 已永久刪除', 'ok');
  setTimeout(() => {
    document.getElementById('modal-req-action').classList.remove('open');
    load(currentPage, currentQ);
  }, 800);
});

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
