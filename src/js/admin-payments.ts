// admin-payments — 金流 intents 管理（list / filter / detail / refund / force-delete）
// Stage 5 PR-5m (2026-05-22)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl（LANGS_I18N / curLang / T / fmt / applyLangI /
// langTogBtn / langDrop / themeBtn / applyTheme / ACCESS_TOKEN_KEY / getToken /
// logout / showError / currentPage / filters / esc / formatDate / formatAmount /
// parseMeta / load / renderAll / renderTotals / renderTable / renderCards /
// renderPagination / openModal / closeModal / openDetail / refundIntentId /
// openRefund / setRefundMsg / openAdminDelete / closeAdminDelete /
// setAdminDelMsg / _adminDelArmTimer / adminDelGo）在同 tsc program 全域
// scope 撞名 → TS2393。+ page chrome（hamBtn / overlay / mTopbar / openMenu /
// closeMenu / mTopLangDrop）。
// 對 apiFetch / formatApiError 改走 window.apiFetch / window.formatApiError —
// 同 PR-5j/5k/5l（per [[feedback_page_entry_apifetch_window_prefix]]）；
// runtime 等價，admin-payments.html 已 `<script src="/js/api.js"></script>` 先載。
;(function () {

// 跨 modal / applyLangI 共用的 window._lastData 型別 alias（per
// [[feedback_inline_interface_window_module_local_trap]]：page entry 用
// inline cast 而非 bare `interface Window` 雙模式相容）
type WindowWithCache = Window & { _lastData?: { rows?: Array<Record<string, unknown>> } };

// ── i18n ───────────────────────────────────────────────
const LANGS_I18N = /*@i18n@*/{};
let curLang = localStorage.getItem('lang') || 'zh-TW';
function T() { return LANGS_I18N[curLang] || LANGS_I18N['zh-TW']; }
function fmt(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); }

function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = T();
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (k && typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (k && typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach(el => { const k = el.dataset.i18nAria; if (k && typeof t[k] === 'string') el.setAttribute('aria-label', t[k]); });
  document.querySelectorAll<HTMLElement>('.lang-opt,.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  const cached = (window as WindowWithCache)._lastData;
  if (cached) renderAll(cached);
}
const langTogBtn = document.getElementById('lang-toggle-btn');
const langDrop   = document.getElementById('lang-dropdown');
langTogBtn?.addEventListener('click', e => { e.stopPropagation(); langDrop?.classList.toggle('open'); });
document.addEventListener('click', () => langDrop?.classList.remove('open'));
langDrop?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDrop.classList.remove('open'); });
applyLangI(curLang);

// ── theme ──────────────────────────────────────────────
const themeBtn = document.getElementById('theme-toggle-btn');
function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  const sun  = themeBtn?.querySelector<HTMLElement>('.icon-sun');
  const moon = themeBtn?.querySelector<HTMLElement>('.icon-moon');
  if (sun)  sun.hidden = dark;
  if (moon) moon.hidden = !dark;
}
applyTheme(localStorage.getItem('theme') !== 'light');
themeBtn?.addEventListener('click', () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
});

// ── auth / fetch helpers ───────────────────────────────
const ACCESS_TOKEN_KEY = 'access_token';
function getToken() { return sessionStorage.getItem(ACCESS_TOKEN_KEY); }

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
document.getElementById('logout-btn')?.addEventListener('click', logout);

function showError(msg) {
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const errMsg  = document.getElementById('error-msg');
  const errText = document.getElementById('error-text');
  if (loading) loading.hidden = true;
  if (content) content.hidden = true;
  if (errMsg)  errMsg.hidden = false;
  if (errText) errText.textContent = `// error: ${msg}`;
}

// ── State + filters ────────────────────────────────────
let currentPage = 1;
const filters = { status:'', vendor:'', user_id:'', from:'', to:'' };

document.getElementById('f-apply')?.addEventListener('click', () => {
  filters.status  = (document.getElementById('f-status')  as HTMLSelectElement | null)?.value ?? '';
  filters.vendor  = (document.getElementById('f-vendor')  as HTMLSelectElement | null)?.value ?? '';
  filters.user_id = (document.getElementById('f-user-id') as HTMLInputElement  | null)?.value.trim() ?? '';
  filters.from    = (document.getElementById('f-from')    as HTMLInputElement  | null)?.value ?? '';
  filters.to      = (document.getElementById('f-to')      as HTMLInputElement  | null)?.value ?? '';
  currentPage = 1;
  load();
});
document.getElementById('f-clear')?.addEventListener('click', () => {
  ['f-status','f-vendor','f-user-id','f-from','f-to'].forEach(id => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (el) el.value = '';
  });
  for (const k of Object.keys(filters)) (filters as Record<string, string>)[k] = '';
  currentPage = 1;
  load();
});

// ── Format helpers ─────────────────────────────────────
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  const localeMap = { 'zh-TW':'zh-TW', en:'en-US', ja:'ja-JP', ko:'ko-KR' };
  return d.toLocaleString(localeMap[curLang] || 'zh-TW', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function formatAmount(row) {
  if (row.amount_subunit != null) return `${Number(row.amount_subunit).toLocaleString()} ${esc(row.currency || 'TWD')}`;
  if (row.amount_raw)             return `${esc(row.amount_raw)} ${esc(row.currency || '')}`;
  return '—';
}
function parseMeta(row) {
  if (!row.metadata) return null;
  if (typeof row.metadata === 'object') return row.metadata;
  try { return JSON.parse(row.metadata); } catch { return null; }
}

// ── Load + render ──────────────────────────────────────
async function load() {
  const tok = getToken();
  const t   = T();
  if (!tok) { showError(t.err_login_required); return; }

  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const errMsg  = document.getElementById('error-msg');
  if (loading) loading.hidden = false;
  if (content) content.hidden = true;
  if (errMsg)  errMsg.hidden  = true;

  const qs = new URLSearchParams({ page: String(currentPage), limit: '50' });
  for (const [k, v] of Object.entries(filters)) { if (v) qs.set(k, v); }

  let data;
  try {
    data = await window.apiFetch(`/api/admin/payments/intents?${qs.toString()}`);
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number; message?: string } | null;
    if (err?.code === 'SESSION_EXPIRED') return; // apiFetch 已 redirect
    if (err?.status === 403) return showError(t.err_forbidden);
    return showError(window.formatApiError ? window.formatApiError(e, t.err_network) : (err?.message || t.err_network));
  }
  (window as WindowWithCache)._lastData = data;
  if (loading) loading.hidden = true;
  if (content) content.hidden = false;
  renderAll(data);
}

function renderAll(data) {
  renderTotals(data.totals, data.total);
  renderTable(data.rows);
  renderCards(data.rows);
  renderPagination(data.total, data.page, data.limit);
}

function renderTotals(totals, total) {
  const el = document.getElementById('totals');
  if (!el) return;
  const t = T();
  const sumLabel = (totals?.sum_subunit_succeeded ?? 0).toLocaleString();
  const counts = totals?.count_by_status ?? {};
  const cells = [
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_total)}</span><span class="val">${total}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_succeeded)}</span><span class="val accent">${counts.succeeded ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_pending)}</span><span class="val">${counts.pending ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_processing)}</span><span class="val">${counts.processing ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_failed)}</span><span class="val">${counts.failed ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_refunded)}</span><span class="val">${counts.refunded ?? 0}</span></div>`,
    `<div class="totals-cell"><span class="lbl">${esc(t.totals_sum)}</span><span class="val accent">${sumLabel}</span></div>`,
  ].join('');
  el.innerHTML = cells;
}

function renderTable(rows) {
  const t = T();
  const body = document.getElementById('table-body');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">${esc(t.empty_text)}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(r => {
    const status = String(r.status);
    const kindLabel = t['kind_' + r.kind] || r.kind;
    const isRefundPending = r.refund_request_status === 'pending';
    // user 已申請退款 → admin 不該再點直接退款（要走 /admin-refund-requests 審核）
    const canRefund = status === 'succeeded' && r.vendor === 'ecpay' && !isRefundPending;
    const refundBtn = canRefund
      ? `<button class="pay-action-btn" data-action="open-refund" data-intent-id="${r.id}">${esc(t.action_refund)}</button>`
      : '';
    // refunded = 金流憑證最終態 + 申請退款中也鎖住（必須由審核流程處理）
    const delBtn = (status === 'refunded' || isRefundPending)
      ? ''
      : `<button class="pay-action-btn pay-action-danger" data-action="open-delete" data-intent-id="${r.id}">強制刪除 / Anonymize</button>`;
    // succeeded + 有 pending refund_request → 蓋掉「已成功」pill 顯示「申請退款」
    const refundReqAt = r.refund_request_created_at ? formatDate(r.refund_request_created_at) : '';
    const statusCell = isRefundPending
      ? `<span class="pay-badge refund-pending" title="申請時間：${esc(refundReqAt)}">申請退款</span>`
      : `<span class="pay-badge ${status}">${esc(t['status_' + status] || status)}</span>`;
    return `
      <tr data-action="open-detail" data-intent-id="${r.id}">
        <td class="id">${r.id}</td>
        <td>${esc(r.user_id)}</td>
        <td class="mono">${esc(r.vendor)}</td>
        <td>${esc(kindLabel)}</td>
        <td class="mono">${formatAmount(r)}</td>
        <td>${statusCell}</td>
        <td class="mono">${esc(formatDate(r.created_at))}</td>
        <td>${refundBtn}${delBtn}</td>
      </tr>`;
  }).join('');
}

function renderCards(rows) {
  const t = T();
  const c = document.getElementById('cards-container');
  if (!c) return;
  if (!rows.length) { c.innerHTML = `<div class="empty">${esc(t.empty_text)}</div>`; return; }
  c.innerHTML = rows.map(r => {
    const status = String(r.status);
    const isRefundPending = r.refund_request_status === 'pending';
    const canRefund = status === 'succeeded' && r.vendor === 'ecpay' && !isRefundPending;
    const actions = canRefund
      ? `<button class="pay-action-btn btn-mt-sm" data-action="open-refund" data-intent-id="${r.id}">${esc(t.action_refund)}</button>`
      : '';
    const statusBadge = isRefundPending
      ? `<span class="pay-badge refund-pending">申請退款</span>`
      : `<span class="pay-badge ${status}">${esc(t['status_' + status] || status)}</span>`;
    return `
      <div class="req-card" data-action="open-detail" data-intent-id="${r.id}">
        <div class="row">
          <div>
            <span class="name">#${r.id} · user ${esc(r.user_id)}</span>
            <span class="company">${esc(r.vendor)}</span>
          </div>
          ${statusBadge}
        </div>
        <div class="row row--mono-sm">${formatAmount(r)}</div>
        <div class="when">${esc(formatDate(r.created_at))}</div>
        ${actions}
      </div>`;
  }).join('');
}

function renderPagination(total, page, limit) {
  const t = T();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pager = document.getElementById('pagination');
  if (!pager) return;
  pager.innerHTML = `
    <button data-action="prev" ${page <= 1 ? 'disabled' : ''}>${esc(t.pager_prev)}</button>
    <span class="stat">${fmt(t.pager_stat, { p: page, t: totalPages })}</span>
    <button data-action="next" ${page >= totalPages ? 'disabled' : ''}>${esc(t.pager_next)}</button>`;
}

document.getElementById('pagination')?.addEventListener('click', e => {
  const btn = (e.target as Element | null)?.closest<HTMLElement>('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'prev') currentPage--;
  if (btn.dataset.action === 'next') currentPage++;
  load();
});

// ── Modal helpers ──────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => {
  const closer = (e.target as Element | null)?.closest<HTMLElement>('[data-modal-close]');
  if (closer && closer.dataset.modalClose) closeModal(closer.dataset.modalClose);
  // 點 backdrop 關閉
  document.querySelectorAll<HTMLElement>('.modal-bd.open').forEach(m => {
    if (e.target === m) m.classList.remove('open');
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll<HTMLElement>('.modal-bd.open').forEach(m => m.classList.remove('open'));
});

// ── Detail / refund table click delegation ────────────
document.addEventListener('click', e => {
  const target = e.target as Element | null;
  const trig = target?.closest<HTMLElement>('[data-action][data-intent-id]');
  if (!trig) return;
  const id = Number(trig.dataset.intentId);
  if (trig.dataset.action === 'open-detail') {
    // 不要在 refund/delete button 上 trigger detail
    if (target?.closest('.pay-action-btn')) return;
    openDetail(id);
  } else if (trig.dataset.action === 'open-refund') {
    e.stopPropagation();
    openRefund(id);
  } else if (trig.dataset.action === 'open-delete') {
    e.stopPropagation();
    openAdminDelete(id);
  }
});

function openDetail(id) {
  const row = (window as WindowWithCache)._lastData?.rows?.find((r: Record<string, unknown>) => r.id === id);
  if (!row) return;
  const t = T();
  const meta = parseMeta(row);
  let metaHtml = '';
  const requisitionId = row.requisition_id ?? meta?.requisition_id;
  if (requisitionId) {
    metaHtml += `<div class="modal-row"><span class="lbl">${esc(t.detail_requisition)}</span><span class="val mono">#${esc(requisitionId)}</span></div>`;
  }
  if (meta?.payment_info) {
    const info = meta.payment_info;
    let lines = '';
    if (info.method === 'atm') {
      lines = `<div class="info-line"><span class="k">${esc(t.detail_atm_bank)}</span><span class="v">${esc(info.bank_code)}</span></div>`
            + `<div class="info-line"><span class="k">${esc(t.detail_atm_account)}</span><span class="v">${esc(info.v_account)}</span></div>`;
    } else if (info.method === 'cvs') {
      lines = `<div class="info-line"><span class="k">${esc(t.detail_cvs_no)}</span><span class="v">${esc(info.payment_no)}</span></div>`;
    } else if (info.method === 'barcode') {
      lines = `<div class="info-line"><span class="k">${esc(t.detail_barcode)}</span><span class="v">${esc(info.barcode_1)}<br>${esc(info.barcode_2)}<br>${esc(info.barcode_3)}</span></div>`;
    }
    if (info.expire_date) lines += `<div class="info-line"><span class="k">${esc(t.detail_expire)}</span><span class="v">${esc(info.expire_date)}</span></div>`;
    if (lines) metaHtml += `<div class="modal-row"><span class="lbl">${esc(t.detail_payment_info)}</span><div class="val"><div class="modal-info-block">${lines}</div></div></div>`;
  }
  const body = document.getElementById('modal-detail-body');
  if (!body) return;
  body.innerHTML = `
    <div class="modal-row"><span class="lbl">${esc(t.detail_id)}</span><span class="val mono">#${row.id}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_user)}</span><span class="val mono">${esc(row.user_id)}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_vendor)}</span><span class="val mono">${esc(row.vendor)} / ${esc(row.vendor_intent_id)}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_kind)}</span><span class="val">${esc(t['kind_' + row.kind] || row.kind)}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_status)}</span><span class="val"><span class="pay-badge ${row.status}">${esc(t['status_' + row.status] || row.status)}</span></span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_amount)}</span><span class="val mono">${formatAmount(row)}</span></div>
    ${row.failure_reason ? `<div class="modal-row"><span class="lbl">${esc(t.detail_failure)}</span><span class="val">${esc(row.failure_reason)}</span></div>` : ''}
    <div class="modal-row"><span class="lbl">${esc(t.detail_created)}</span><span class="val mono">${esc(formatDate(row.created_at))}</span></div>
    <div class="modal-row"><span class="lbl">${esc(t.detail_updated)}</span><span class="val mono">${esc(formatDate(row.updated_at))}</span></div>
    ${metaHtml}`;
  openModal('modal-detail');
}

// ── Refund flow ────────────────────────────────────────
let refundIntentId: number | null = null;

function openRefund(id) {
  const row = (window as WindowWithCache)._lastData?.rows?.find((r: Record<string, unknown>) => r.id === id);
  if (!row) return;
  const t = T();
  refundIntentId = id;
  const summary = document.getElementById('refund-summary');
  const otpEl   = document.getElementById('refund-otp')    as HTMLInputElement | null;
  const reason  = document.getElementById('refund-reason') as HTMLInputElement | null;
  if (!summary || !otpEl || !reason) return;
  summary.textContent =
    fmt(t.refund_summary, { id: row.id, amount: formatAmount(row), user: row.user_id });
  otpEl.value = '';
  reason.value = '';
  setRefundMsg('', '');
  openModal('modal-refund');
  setTimeout(() => otpEl.focus(), 50);
}

function setRefundMsg(text, type) {
  const el = document.getElementById('refund-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'refund-msg' + (type ? ' ' + type : '');
}

document.getElementById('refund-confirm-btn')?.addEventListener('click', async () => {
  const t = T();
  const otpEl   = document.getElementById('refund-otp')         as HTMLInputElement  | null;
  const reasonEl= document.getElementById('refund-reason')      as HTMLInputElement  | null;
  const btn     = document.getElementById('refund-confirm-btn') as HTMLButtonElement | null;
  if (!otpEl || !reasonEl || !btn) return;
  const otp = otpEl.value.trim();
  const reason = reasonEl.value.trim();
  if (!/^\d{6}$/.test(otp)) { setRefundMsg(t.refund_err_otp, 'err'); return; }
  if (!refundIntentId) { setRefundMsg(t.refund_err_no_intent, 'err'); return; }

  btn.disabled = true;
  setRefundMsg(t.refund_step_up, '');

  // 1) step-up（apiFetch 自帶 401 silent refresh）
  let step_up_token: string | undefined;
  try {
    const su = await window.apiFetch<{ step_up_token?: string }>('/api/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ scope:'elevated:payment', for_action:'refund_payment', otp_code: otp }),
    });
    step_up_token = su?.step_up_token;
    if (!step_up_token) { setRefundMsg(t.refund_err_no_stepup, 'err'); btn.disabled = false; return; }
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number; message?: string } | null;
    if (err?.code === 'SESSION_EXPIRED') return;
    setRefundMsg(err?.message || `step-up ${err?.status ?? ''}`, 'err');
    btn.disabled = false; return;
  }

  // 2) refund
  setRefundMsg(t.refund_calling, '');
  const r = await fetch(`/api/admin/payments/intents/${refundIntentId}/refund`, {
    method:  'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${step_up_token}` },
    body:    JSON.stringify({ reason }),
  }).catch(() => null);
  if (!r) { setRefundMsg(t.err_network, 'err'); btn.disabled = false; return; }
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    setRefundMsg(j.rtn_msg || j.error || `refund ${r.status}`, 'err');
    btn.disabled = false; return;
  }
  setRefundMsg(t.refund_success, 'ok');
  setTimeout(() => { closeModal('modal-refund'); load(); btn.disabled = false; }, 1200);
});

// ── Admin force-delete flow（兩段式確認 + step-up OTP）──
// step-up 等同 refund 的 elevated:payment scope（避免另開 scope）
function openAdminDelete(id) {
  const row = (window as WindowWithCache)._lastData?.rows?.find((r: Record<string, unknown>) => r.id === id);
  if (!row) return;
  document.getElementById('admin-del-modal')?.remove();
  const isHard = ['pending','failed','canceled'].includes(String(row.status));
  const modeText = isHard
    ? '此操作會永久從 D1 刪除此筆 intent。'
    : `此 intent 為 <b>${esc(row.status)}</b>，將執行 <b>anonymize</b>（保留金流憑證骨幹，清空 metadata 與 failure_reason）。row 不會被刪除。`;
  const m = document.createElement('div');
  m.id = 'admin-del-modal';
  m.className = 'modal-bd open';
  m.innerHTML = `
    <div class="modal-card modal-card--narrow">
      <div class="modal-head">
        <h2>${isHard ? '強制刪除' : 'Anonymize'} #${row.id}</h2>
        <button class="modal-close" data-action="admin-del-cancel" aria-label="close">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="modal-body refund-modal-body">
        <p class="msg-block">user ${esc(row.user_id)} · ${esc(row.vendor)} · ${formatAmount(row)} · <b>${esc(row.status)}</b></p>
        <p class="msg-label text-danger">${modeText} audit log 會留 critical 記錄。</p>
        <input id="admin-del-otp" type="text" inputmode="numeric" maxlength="6" placeholder="6 位 2FA OTP" autocomplete="one-time-code" data-enter-click="#admin-del-go">
        <p id="admin-del-msg" class="refund-msg"></p>
        <div class="refund-actions">
          <button class="cancel" data-action="admin-del-cancel">取消</button>
          <button id="admin-del-go" class="confirm" data-armed="0" data-id="${row.id}">${isHard ? '強制刪除' : '執行 Anonymize'}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(m);
  setTimeout(() => document.getElementById('admin-del-otp')?.focus(), 50);
  m.addEventListener('click', e => { if (e.target === m) closeAdminDelete(); });
}
function closeAdminDelete() { document.getElementById('admin-del-modal')?.remove(); }
function setAdminDelMsg(text, type) {
  const el = document.getElementById('admin-del-msg');
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('err', 'ok');
  if (type === 'err') el.classList.add('err');
  else if (type === 'ok') el.classList.add('ok');
}
let _adminDelArmTimer: ReturnType<typeof setTimeout> | null = null;
async function adminDelGo() {
  const btn = document.getElementById('admin-del-go') as HTMLButtonElement | null;
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    const orig = btn.textContent;
    btn.dataset.origText = orig ?? '';
    btn.textContent = '再點一次確認';
    btn.classList.add('armed');
    if (_adminDelArmTimer) clearTimeout(_adminDelArmTimer);
    _adminDelArmTimer = setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '0';
      btn.textContent = btn.dataset.origText || '強制刪除';
      btn.classList.remove('armed');
    }, 4000);
    return;
  }
  if (_adminDelArmTimer) { clearTimeout(_adminDelArmTimer); _adminDelArmTimer = null; }
  const otpEl = document.getElementById('admin-del-otp') as HTMLInputElement | null;
  const otp = otpEl?.value.trim() ?? '';
  if (!/^\d{6}$/.test(otp)) { setAdminDelMsg('請輸入 6 位數字 2FA', 'err'); return; }
  btn.disabled = true; setAdminDelMsg('驗證 2FA…', '');

  // step-up 走 apiFetch 自帶 401 → silent refresh → retry
  let stepUpToken: string | undefined;
  try {
    const su = await window.apiFetch<{ step_up_token?: string }>('/api/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ scope:'elevated:payment', for_action:'delete_payment', otp_code: otp }),
    });
    stepUpToken = su?.step_up_token;
    if (!stepUpToken) throw new Error('missing step_up_token');
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | null;
    if (err?.code === 'SESSION_EXPIRED') return; // apiFetch 已 redirect
    setAdminDelMsg(err?.message || 'step-up 失敗', 'err');
    btn.disabled = false; return;
  }

  setAdminDelMsg('呼叫刪除…', '');
  // 強制刪除走 step-up token，不能讓 apiFetch 用 access_token 蓋過去 → 手動帶 Authorization
  const r = await fetch(`/api/admin/payments/intents/${id}/delete`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${stepUpToken}` },
  }).catch(() => null);
  if (!r || !r.ok) {
    const j = r ? await r.json().catch(() => ({})) : {};
    setAdminDelMsg(j.error || `delete ${r?.status ?? 'network'}`, 'err');
    btn.disabled = false; return;
  }
  const j = await r.json().catch(() => ({}));
  setAdminDelMsg(j.mode === 'anonymize' ? '✓ 已 anonymize' : '✓ 已刪除', 'ok');
  setTimeout(() => { closeAdminDelete(); load(); }, 800);
}
document.addEventListener('click', e => {
  const target = e.target as Element | null;
  const a = target?.closest<HTMLElement>('[data-action]')?.dataset?.action;
  if (a === 'admin-del-cancel') return closeAdminDelete();
  if ((target as HTMLElement | null)?.id === 'admin-del-go') return adminDelGo();
});

// ── Init ───────────────────────────────────────────────
load();

// ── Mobile hamburger overlay + 對齊 m-theme-btn / m-ov-lang-opt 行為 ──
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const mTopbar = document.getElementById('m-topbar');
function openMenu() { hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); mTopbar?.classList.add('menu-open'); document.body.classList.add('body-lock'); }
function closeMenu() { hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); mTopbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll<HTMLElement>('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });
document.getElementById('m-theme-btn')?.addEventListener('click', () => document.getElementById('theme-toggle-btn')?.click());
overlay?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.m-ov-lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); });
const mTopLangDrop = document.getElementById('m-top-lang-drop');
document.getElementById('m-lang-btn')?.addEventListener('click', e => { e.stopPropagation(); mTopLangDrop?.classList.toggle('open'); langDrop?.classList.remove('open'); });
document.addEventListener('click', () => mTopLangDrop?.classList.remove('open'));
mTopLangDrop?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); mTopLangDrop.classList.remove('open'); });

})();
