// admin-requisitions — 需求單管理（list/search/detail + audit cleanup + refund review + req action）
// Stage 5 PR-5n (2026-05-22)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl（hamBtn / overlay / topbar / openMenu / closeMenu /
// themeBtn / mThemeBtn / applyTheme / doToggle / LANGS_I18N / curLang / T / fmt /
// applyLangI / langTogBtnI / langDropI / toggleTopLangDrop / ACCESS_TOKEN_KEY /
// currentPage / currentQ / debounceTimer / getToken / logout / showError /
// formatServiceType / formatBudget / formatTimeline / formatDate / load /
// renderTable / renderCards / renderPagination / REQ_STATUS_LABEL / statusPill /
// openModal / field / esc / _initToken / escA / openAuditCleanup /
// _auditDelTimer / auditDelGo / fetchPendingRefundCount / _rrCache /
// openRefundReview / renderRefundReviewList / _rrDecideId / _rrDecideAction /
// openRefundDecide / setRdMsg / _raCtx / openReqAction / setRaMsg）在同 tsc
// program 全域 scope 撞名 → TS2393。
// 整支 raw fetch（不走 apiFetch；mutation endpoints 手帶 Bearer access_token 或
// step_up_token），與 PR-5l 退款 / PR-5m 金流 mutation 同款。
// window._lastData / window._reqData / window.notify 走 IIFE-scope type alias
// 與 window prefix（per [[feedback_inline_interface_window_module_local_trap]]
// + [[feedback_page_entry_apifetch_window_prefix]]）。
;(function () {

// 跨 modal / applyLangI 共用的 window._lastData / window._reqData 型別 alias
type WindowWithAdminReqCache = Window & {
  _lastData?: {
    requisitions?: Array<Record<string, unknown>>;
    total?: number;
    page?: number;
    limit?: number;
  };
  _reqData?: Record<string | number, Record<string, unknown>>;
};

// ── block 1/2 ──
// ── Mobile overlay ──────────────────────────────────────────
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu() { hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.classList.add('body-lock'); }
function closeMenu() { hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll<HTMLElement>('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// ── Theme toggle ──────────────────────────────────────────
const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');
function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  [themeBtn, mThemeBtn].forEach(btn => {
    if (!btn) return;
    const sun = btn.querySelector<HTMLElement>('.icon-sun'), moon = btn.querySelector<HTMLElement>('.icon-moon');
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
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (k && typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (k && typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => { const k = el.dataset.i18nAria; if (k && typeof t[k] === 'string') el.setAttribute('aria-label', t[k]); });
  document.querySelectorAll<HTMLElement>('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll<HTMLElement>('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  // re-render dynamic content
  const cached = (window as WindowWithAdminReqCache)._lastData;
  if (cached) {
    renderTable(cached.requisitions);
    renderCards(cached.requisitions);
    renderPagination(cached.total, cached.page, cached.limit);
    const badge = document.getElementById('total-badge');
    if (badge) badge.textContent = fmt(t.total_label, { n: cached.total });
  }
}
const langTogBtnI = document.getElementById('lang-toggle-btn');
const langDropI   = document.getElementById('lang-dropdown');
langTogBtnI?.addEventListener('click', e => { e.stopPropagation(); langDropI?.classList.toggle('open'); });
document.addEventListener('click', () => langDropI?.classList.remove('open'));
langDropI?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDropI.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.m-ov-lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); });
function toggleTopLangDrop(e) { e.stopPropagation(); document.getElementById('m-top-lang-drop')?.classList.toggle('open'); }
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop')?.classList.remove('open'); });
applyLangI(curLang);

// ══════════════════════════════════════════════════════════
//  ADMIN REQUISITIONS LOGIC
// ══════════════════════════════════════════════════════════
const ACCESS_TOKEN_KEY = 'access_token'
let currentPage = 1
let currentQ    = ''
let debounceTimer: ReturnType<typeof setTimeout> | undefined

function getToken() { return sessionStorage.getItem(ACCESS_TOKEN_KEY) }

async function logout() {
  // P2-11：admin-* 也走 OIDC RP-Initiated Logout，與 sidebar-auth/dashboard 對齊。
  // end-session 後端會撤所有 refresh + 觸發 backchannel 通知第三方 RP（mbti/talo/sport-app）。
  try { sessionStorage.removeItem('access_token'); } catch(_) {}
  try {
    if ('BroadcastChannel' in window) new BroadcastChannel('chiyigo-auth').postMessage({ type: 'logout' });
  } catch(_) {}
  location.href = '/api/auth/oauth/end-session?post_logout_redirect_uri=' +
                  encodeURIComponent('https://chiyigo.com/login.html');
}
document.getElementById('logout-btn')?.addEventListener('click', logout)

function showError(msg) {
  const loading = document.getElementById('loading')
  const content = document.getElementById('content')
  const errMsg  = document.getElementById('error-msg')
  const errText = document.getElementById('error-text')
  if (loading) loading.hidden = true
  if (content) content.hidden = true
  if (errMsg)  errMsg.hidden = false
  if (errText) errText.textContent = `// error: ${msg}`
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

  const loading = document.getElementById('loading')
  const content = document.getElementById('content')
  const errMsg  = document.getElementById('error-msg')
  if (loading) loading.hidden = false
  if (content) content.hidden = true
  if (errMsg)  errMsg.hidden  = true

  const params = new URLSearchParams({ page: String(page), limit: '20' })
  if (q) params.set('q', q)

  const res = await fetch(`/api/admin/requisitions?${params}`, { headers: { 'Authorization': `Bearer ${token}` } })

  if (res.status === 401 || res.status === 403) { showError(t.err_perm); return }
  if (!res.ok) { showError(fmt(t.err_http, {n: res.status})); return }

  const data = await res.json()
  ;(window as WindowWithAdminReqCache)._lastData = data
  if (loading) loading.hidden = true
  if (content) content.hidden = false

  renderTable(data.requisitions)
  renderCards(data.requisitions)
  renderPagination(data.total, data.page, data.limit)
  const badge = document.getElementById('total-badge')
  if (badge) badge.textContent = fmt(t.total_label, {n: data.total})
  currentPage = page
  currentQ    = q
}

function renderTable(rows) {
  const tbody = document.getElementById('table-body')
  if (!tbody) return
  const t = T()
  if (!rows || !rows.length) { tbody.innerHTML = `<tr><td colspan="8" class="empty">${t.no_data}</td></tr>`; return }
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
  ;(window as WindowWithAdminReqCache)._reqData = Object.fromEntries(rows.map(r => [r.id, r]))
}

function renderCards(rows) {
  const container = document.getElementById('cards-container')
  if (!container) return
  const t = T()
  if (!rows || !rows.length) { container.innerHTML = `<p class="empty">${t.no_data}</p>`; return }
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
  const w = window as WindowWithAdminReqCache
  if (!w._reqData) w._reqData = {}
  rows.forEach(r => { w._reqData![r.id] = r })
}

function renderPagination(total, page, limit) {
  const el = document.getElementById('pagination')
  if (!el) return
  const t = T()
  const pages = Math.ceil((total ?? 0) / (limit ?? 1))
  if (pages <= 1) { el.innerHTML = ''; return }
  el.innerHTML = `
    <button data-load-page="${(page ?? 1) - 1}" ${(page ?? 1) <= 1 ? 'disabled' : ''}>${t.prev_page}</button>
    <span class="stat">${fmt(t.page_label, {p: page, t: pages})}</span>
    <button data-load-page="${(page ?? 1) + 1}" ${(page ?? 1) >= pages ? 'disabled' : ''}>${t.next_page}</button>`
}

// requisition 真實使用中的狀態：pending → (refund_pending) → revoked / deal
// processing / completed 過去設計但未實裝，2026-05-06 移除避免誤導
const REQ_STATUS_LABEL = {
  pending:        '待處理',
  refund_pending: '退款審核中',
  revoked:        '已撤銷',
  deal:           '✓ 已成交',
};
function statusPill(status) {
  const lbl = REQ_STATUS_LABEL[status] || status;
  const variant = REQ_STATUS_LABEL[status] ? status : 'pending';
  return `<span class="req-status-pill req-status-pill--${variant}">${esc(lbl)}</span>`;
}

function openModal(id) {
  const r = (window as WindowWithAdminReqCache)._reqData?.[id]
  if (!r) return
  const t = T()
  const body = document.getElementById('modal-body')
  if (!body) return
  const status = r.status || 'pending'
  // 動作鍵：保存 / 刪除 — pending 才顯示保存（其他狀態語意上不該移成交）；刪除全狀態都顯示
  const saveBtnHtml = status === 'pending'
    ? `<button class="btn-pill btn-pill--primary" data-ra-action="save" data-ra-id="${r.id}">
         <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
         <span>保存（成交）</span>
       </button>`
    : '';
  const delBtnHtml = `<button class="btn-pill btn-pill--danger" data-ra-action="delete" data-ra-id="${r.id}">
       <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4M5 4l.5 9a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1L11 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
       <span>刪除</span>
     </button>`;

  body.innerHTML = `
    <div class="modal-meta">
      <span>#${r.id}</span><span>·</span><span>${formatDate(r.created_at)}</span>
      <span class="push-right">${statusPill(status)}</span>
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
    <div class="detail-actions">${saveBtnHtml}${delBtnHtml}</div>`
  document.getElementById('modal')?.classList.add('open')
}
function field(label, value, mono = false) {
  return `<div class="modal-row"><span class="lbl">${label}</span><span class="val ${mono ? 'mono' : ''}">${esc(value ?? '—')}</span></div>`
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

document.getElementById('modal-close')?.addEventListener('click', () => document.getElementById('modal')?.classList.remove('open'))
document.getElementById('modal')?.addEventListener('click', e => { if (e.target === e.currentTarget) (e.currentTarget as HTMLElement).classList.remove('open') })

document.getElementById('search-input')?.addEventListener('input', e => {
  clearTimeout(debounceTimer)
  const value = (e.target as HTMLInputElement | null)?.value.trim() ?? ''
  debounceTimer = setTimeout(() => load(1, value), 380)
})

const _initToken = getToken()
if (!_initToken) { showError(T().err_not_logged_in) } else { load(1) }

// ── 需求單刪除紀錄清理（audit_log event_type='requisition.deleted'）──
function escA(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

async function openAuditCleanup() {
  const modal = document.getElementById('modal-audit-cleanup');
  const list = document.getElementById('audit-cleanup-list');
  if (!modal || !list) return;
  modal.classList.add('open');
  list.innerHTML = `<p class="empty-state">載入中…</p>`;
  const tok = getToken();
  if (!tok) { list.innerHTML = `<p class="empty-state empty-state--error">未登入</p>`; return; }

  const r = await fetch('/api/admin/audit?event_type=requisition.deleted&limit=200', {
    headers: { Authorization: `Bearer ${tok}` },
  }).catch(() => null);
  if (!r || !r.ok) { list.innerHTML = `<p class="empty-state empty-state--error">載入失敗</p>`; return; }
  const j = await r.json();
  const rows = j.rows ?? [];
  if (!rows.length) { list.innerHTML = `<p class="empty-state">沒有刪除紀錄</p>`; return; }
  list.innerHTML = rows.map(row => {
    let data: Record<string, unknown> = {};
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
          <button class="reject danger-idle" data-audit-del="${row.id}" data-armed="0">清除（兩段式 + OTP）</button>
        </div>
      </div>`;
  }).join('');
}

let _auditDelTimer: ReturnType<typeof setTimeout> | null = null;
async function auditDelGo(auditId, btn) {
  if (btn.dataset.armed !== '1') {
    document.querySelectorAll<HTMLElement>('[data-audit-del]').forEach(b => {
      if (b !== btn) {
        b.dataset.armed = '0'; b.textContent = '清除';
        b.classList.remove('is-armed');
      }
    });
    btn.dataset.armed = '1';
    btn.textContent = '確認清除';
    btn.classList.add('is-armed');
    if (_auditDelTimer) clearTimeout(_auditDelTimer);
    _auditDelTimer = setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '0'; btn.textContent = '清除';
      btn.classList.remove('is-armed');
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
  if (!su || !su.ok) { btn.disabled = false; btn.textContent = '清除'; window.notify.error('step-up 失敗'); return; }
  const { step_up_token } = await su.json();
  const r = await fetch(`/api/admin/audit/${auditId}`, {
    method:  'DELETE',
    headers: { Authorization: `Bearer ${step_up_token}` },
  }).catch(() => null);
  if (!r || !r.ok) { btn.disabled = false; btn.textContent = '清除'; window.notify.error('刪除失敗'); return; }
  btn.closest('.refund-row')?.remove();
}

document.getElementById('audit-cleanup-btn')?.addEventListener('click', openAuditCleanup);
document.addEventListener('click', e => {
  const target = e.target as Element | null;
  const delBtn = target?.closest<HTMLElement>('[data-audit-del]');
  if (delBtn) return auditDelGo(Number(delBtn.dataset.auditDel), delBtn);
  // 共用：data-modal-close
  const mc = target?.closest<HTMLElement>('[data-modal-close]');
  if (mc && mc.dataset.modalClose) document.getElementById(mc.dataset.modalClose)?.classList.remove('open');
  // 退款列表內按鈕
  const rfApprove = target?.closest<HTMLElement>('[data-rf-approve]');
  if (rfApprove) return openRefundDecide(Number(rfApprove.dataset.rfApprove), 'approve');
  const rfReject  = target?.closest<HTMLElement>('[data-rf-reject]');
  if (rfReject)  return openRefundDecide(Number(rfReject.dataset.rfReject), 'reject');
  // 詳情 modal 內：保存 / 刪除
  const ra = target?.closest<HTMLElement>('[data-ra-action]');
  if (ra) return openReqAction(ra.dataset.raAction, Number(ra.dataset.raId));
});
// 點 backdrop 自動關
document.querySelectorAll<HTMLElement>('.modal-bd').forEach(m => {
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

let _rrCache: Array<Record<string, unknown>> = []; // 目前 modal 顯示的 rows，supply summary

async function openRefundReview() {
  const modal = document.getElementById('modal-refund-review');
  const list = document.getElementById('refund-review-list');
  if (!modal || !list) return;
  modal.classList.add('open');
  list.innerHTML = `<p class="empty-state">載入中…</p>`;

  const tok = getToken();
  if (!tok) { list.innerHTML = `<p class="empty-state empty-state--error">未登入</p>`; return; }
  const r = await fetch('/api/admin/requisition-refund?status=pending&limit=200', {
    headers: { Authorization: `Bearer ${tok}` },
  }).catch(() => null);
  if (!r || !r.ok) { list.innerHTML = `<p class="empty-state empty-state--error">載入失敗</p>`; return; }
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
let _rrDecideId: number | null = null;
let _rrDecideAction: 'approve' | 'reject' | null = null;

function openRefundDecide(id, action) {
  const row = _rrCache.find((r: Record<string, unknown>) => r.id === id);
  if (!row) return;
  _rrDecideId = id;
  _rrDecideAction = action;
  const isApprove = action === 'approve';
  const amt = row.intent_amount_subunit != null
    ? `${Number(row.intent_amount_subunit).toLocaleString()} ${escA(row.intent_currency || 'TWD')}`
    : '—';
  const titleEl     = document.getElementById('rd-title');
  const summaryEl   = document.getElementById('rd-summary');
  const noteLabelEl = document.getElementById('rd-note-label');
  const noteEl      = document.getElementById('rd-note') as HTMLInputElement | null;
  const otpEl       = document.getElementById('rd-otp')  as HTMLInputElement | null;
  const btn         = document.getElementById('rd-confirm-btn') as HTMLButtonElement | null;
  const modal       = document.getElementById('modal-refund-decide');
  if (!titleEl || !summaryEl || !noteLabelEl || !noteEl || !otpEl || !btn || !modal) return;
  titleEl.textContent = isApprove ? '通過退款並執行' : '拒絕退款申請';
  summaryEl.innerHTML = isApprove
    ? `通過後 <strong>立刻退款 ${amt}</strong> 並撤銷需求單 #${escA(row.requisition_id)}（intent #${escA(row.intent_id)}）。動作不可逆。`
    : `拒絕退款申請 #${escA(id)}（req #${escA(row.requisition_id)}）。需求單仍維持「退款審核中」，user 可改聯絡客服。`;
  noteLabelEl.textContent = isApprove ? '審核備註（選填）' : '拒絕理由（建議填）';
  noteEl.value = '';
  otpEl.value = '';
  setRdMsg('', '');
  btn.disabled = false;
  btn.textContent = isApprove ? '確認通過並退款' : '確認拒絕';
  btn.className = isApprove ? 'confirm' : 'cancel is-danger';
  modal.classList.add('open');
  setTimeout(() => otpEl.focus(), 50);
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
  const otpEl  = document.getElementById('rd-otp')         as HTMLInputElement  | null;
  const noteEl = document.getElementById('rd-note')        as HTMLInputElement  | null;
  const btn    = document.getElementById('rd-confirm-btn') as HTMLButtonElement | null;
  const modal  = document.getElementById('modal-refund-decide');
  if (!otpEl || !noteEl || !btn || !modal) return;
  const otp  = otpEl.value.trim();
  const note = noteEl.value.trim();
  if (!/^\d{6}$/.test(otp)) { setRdMsg('OTP 須為 6 位數字', 'err'); return; }
  const tok = getToken();
  if (!tok) { setRdMsg('未登入', 'err'); return; }

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
    if (su) { try { const j = await su.json(); msg = j.error || msg; } catch {} }
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
    if (r) { try { const j = await r.json(); msg = (j.error || msg) + (j.rtn_msg ? ` / ${j.rtn_msg}` : ''); } catch {} }
    setRdMsg(msg, 'err'); btn.disabled = false; return;
  }
  setRdMsg(act === 'approve' ? '✓ 已通過並退款' : '✓ 已拒絕', 'ok');
  // 從 cache + DOM 移除這筆，避免重複按
  _rrCache = _rrCache.filter(x => x.id !== id);
  setTimeout(() => {
    modal.classList.remove('open');
    renderRefundReviewList();
    fetchPendingRefundCount();
  }, 900);
});

document.getElementById('refund-review-btn')?.addEventListener('click', openRefundReview);

// ── 需求單保存 / 刪除（兩段式確認，admin only）─────────────
let _raCtx: { action: string | null; id: number | null; armed: boolean } = { action: null, id: null, armed: false };

function openReqAction(action, id) {
  const r = (window as WindowWithAdminReqCache)._reqData?.[id];
  if (!r) return;
  _raCtx = { action, id, armed: false };
  const isSave = action === 'save';
  const titleEl   = document.getElementById('ra-title');
  const summaryEl = document.getElementById('ra-summary');
  const labelEl   = document.getElementById('ra-note-label');
  const noteEl    = document.getElementById('ra-note') as HTMLInputElement | null;
  const btn       = document.getElementById('ra-confirm-btn') as HTMLButtonElement | null;
  const modal     = document.getElementById('modal-req-action');
  if (!titleEl || !summaryEl || !labelEl || !noteEl || !btn || !modal) return;
  titleEl.textContent = isSave ? '保存為成交資料' : '刪除需求單';
  summaryEl.innerHTML = isSave
    ? `將 req #${id}（${escA(r.name)} / ${escA(r.contact)}）寫入「成交資料庫」。
       後續可在 deals 表追蹤；TG 訊息會更新成 ✅ 已成交（含付款摘要）。`
    : `<strong class="text-danger">⚠️ 永久刪除 req #${id}</strong>
       — DB row 直接消失；如有未退款的 succeeded payment 後端會擋下。
       TG 訊息更新成 🗑 已刪除。`;
  labelEl.textContent = isSave ? '備註（選填，會寫入 deal.notes）' : '刪除原因（建議填，存 audit）';
  noteEl.value = '';
  setRaMsg('', '');
  btn.dataset.armed = '0';
  btn.textContent = isSave ? '下一步：確認保存' : '下一步：確認刪除';
  btn.disabled = false;
  btn.className = isSave ? 'btn-pill btn-pill--primary' : 'btn-pill btn-pill--danger';
  // cancel 也統一用 secondary class
  document.querySelector('#modal-req-action [data-modal-close="modal-req-action"].cancel')?.classList.add('btn-pill', 'btn-pill--secondary');
  // 關上詳情，避免層疊
  document.getElementById('modal')?.classList.remove('open');
  modal.classList.add('open');
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
  const btn   = document.getElementById('ra-confirm-btn') as HTMLButtonElement | null;
  const noteEl = document.getElementById('ra-note')       as HTMLInputElement  | null;
  const modal  = document.getElementById('modal-req-action');
  if (!btn || !noteEl || !modal) return;
  // 兩段式：第一次點擊只 arm；第二次才送
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = action === 'save' ? '⚠ 再點一次確認保存' : '⚠ 再點一次確認刪除';
    btn.classList.add('btn-pill--armed');
    setRaMsg('已進入確認狀態，再點一次按鈕送出', '');
    setTimeout(() => {
      if (btn.dataset.armed === '1') {
        btn.dataset.armed = '0';
        btn.textContent = action === 'save' ? '下一步：確認保存' : '下一步：確認刪除';
        btn.classList.remove('btn-pill--armed');
        setRaMsg('', '');
      }
    }, 5000);
    return;
  }
  btn.classList.remove('btn-pill--armed');

  btn.disabled = true;
  setRaMsg('送出中…', '');
  const tok = getToken();
  const note = noteEl.value.trim();
  const ep = `/api/admin/requisitions/${id}/${action}`;
  const r = await fetch(ep, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
    body:    JSON.stringify(action === 'save' ? { notes: note || null } : { confirm: true, notes: note || null }),
  }).catch(() => null);
  if (!r || !r.ok) {
    let msg = `${action} 失敗`;
    if (r) { try { const j = await r.json(); msg = j.error || msg; } catch {} }
    setRaMsg(msg, 'err');
    btn.disabled = false; btn.dataset.armed = '0';
    btn.textContent = action === 'save' ? '下一步：確認保存' : '下一步：確認刪除';
    return;
  }
  setRaMsg(action === 'save' ? '✓ 已保存到 deals' : '✓ 已永久刪除', 'ok');
  setTimeout(() => {
    modal.classList.remove('open');
    load(currentPage, currentQ);
  }, 800);
});

// ── block 2/2 ──
(function(){
  const canvas = document.getElementById('neural-canvas') as HTMLCanvasElement | null;if(!canvas)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  let W=0,H=0,nodes: Array<{x:number;y:number;vx:number;vy:number;r:number;pulse:number}>=[];const DIST=155;
  function resize(){W=canvas!.width=window.innerWidth;H=canvas!.height=window.innerHeight}
  function initNodes(){const n=W<768?48:115;nodes=Array.from({length:n},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.1+.4,pulse:Math.random()*Math.PI*2}))}
  const mouse={x:-9999,y:-9999};document.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});
  let cfg={r:'108',g:'110',b:'229',no:.22,lo:.09};
  function syncCfg(){const s=getComputedStyle(document.documentElement);cfg={r:s.getPropertyValue('--neural-r').trim()||'108',g:s.getPropertyValue('--neural-g').trim()||'110',b:s.getPropertyValue('--neural-b').trim()||'229',no:parseFloat(s.getPropertyValue('--neural-node-opacity').trim()||'.22'),lo:parseFloat(s.getPropertyValue('--neural-line-opacity').trim()||'.09')}}
  syncCfg();new MutationObserver(syncCfg).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  function draw(){ctx!.clearRect(0,0,W,H);const{r,g,b,no,lo}=cfg;
    for(const n of nodes){const dx=n.x-mouse.x,dy=n.y-mouse.y,d2=dx*dx+dy*dy;if(d2<16900){const d=Math.sqrt(d2);n.vx+=dx/d*.055;n.vy+=dy/d*.055}n.vx*=.982;n.vy*=.982;n.x+=n.vx;n.y+=n.vy;if(n.x<-12)n.x=W+12;else if(n.x>W+12)n.x=-12;if(n.y<-12)n.y=H+12;else if(n.y>H+12)n.y=-12;n.pulse+=.011;const p=Math.sin(n.pulse)*.25+.75;ctx!.beginPath();ctx!.arc(n.x,n.y,n.r*p,0,Math.PI*2);ctx!.fillStyle=`rgba(${r},${g},${b},${no*p})`;ctx!.fill()}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d2=dx*dx+dy*dy;if(d2<DIST*DIST){const a=(1-Math.sqrt(d2)/DIST)*lo;ctx!.beginPath();ctx!.moveTo(nodes[i].x,nodes[i].y);ctx!.lineTo(nodes[j].x,nodes[j].y);ctx!.strokeStyle=`rgba(${r},${g},${b},${a})`;ctx!.lineWidth=.5;ctx!.stroke()}}
    requestAnimationFrame(draw)}
  resize();initNodes();draw();window.addEventListener('resize',()=>{resize();initNodes()});
})();

// ── Phase C-3 dynamic-content delegation ──
document.addEventListener('click', e => {
  const t = (e.target as Element | null)?.closest<HTMLElement>('[data-open-modal], [data-load-page]')
  if (!t) return
  if (t.dataset.openModal) openModal(Number(t.dataset.openModal))
  else if (t.dataset.loadPage) load(Number(t.dataset.loadPage), currentQ)
})

})();
