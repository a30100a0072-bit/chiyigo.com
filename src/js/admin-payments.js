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
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { const k = el.dataset.i18nAria; if (typeof t[k] === 'string') el.setAttribute('aria-label', t[k]); });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  if (window._lastData) renderAll(window._lastData);
}
const langTogBtn = document.getElementById('lang-toggle-btn');
const langDrop   = document.getElementById('lang-dropdown');
langTogBtn?.addEventListener('click', e => { e.stopPropagation(); langDrop?.classList.toggle('open'); });
document.addEventListener('click', () => langDrop?.classList.remove('open'));
langDrop?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDrop.classList.remove('open'); });
applyLangI(curLang);

// ── theme ──────────────────────────────────────────────
const themeBtn = document.getElementById('theme-toggle-btn');
function applyTheme(dark) {
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  const sun  = themeBtn?.querySelector('.icon-sun');
  const moon = themeBtn?.querySelector('.icon-moon');
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
  const tok = getToken();
  if (tok) await fetch('/api/auth/logout', { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${tok}` } }).catch(() => {});
  sessionStorage.clear();
  location.href = '/login.html';
}
document.getElementById('logout-btn').addEventListener('click', logout);

function showError(msg) {
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = false;
  document.getElementById('error-text').textContent = `// error: ${msg}`;
}

// ── State + filters ────────────────────────────────────
let currentPage = 1;
const filters = { status:'', vendor:'', user_id:'', from:'', to:'' };

document.getElementById('f-apply').addEventListener('click', () => {
  filters.status  = document.getElementById('f-status').value;
  filters.vendor  = document.getElementById('f-vendor').value;
  filters.user_id = document.getElementById('f-user-id').value.trim();
  filters.from    = document.getElementById('f-from').value;
  filters.to      = document.getElementById('f-to').value;
  currentPage = 1;
  load();
});
document.getElementById('f-clear').addEventListener('click', () => {
  ['f-status','f-vendor','f-user-id','f-from','f-to'].forEach(id => {
    const el = document.getElementById(id);
    if (el.tagName === 'SELECT') el.value = '';
    else el.value = '';
  });
  for (const k of Object.keys(filters)) filters[k] = '';
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

  document.getElementById('loading').hidden = false;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = true;

  const qs = new URLSearchParams({ page: String(currentPage), limit: '50' });
  for (const [k, v] of Object.entries(filters)) { if (v) qs.set(k, v); }

  const r = await fetch(`/api/admin/payments/intents?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${tok}` },
  }).catch(() => null);
  if (!r) return showError(t.err_network);
  if (r.status === 401 || r.status === 403) return showError(t.err_forbidden);
  if (!r.ok) return showError(`HTTP ${r.status}`);
  const data = await r.json();
  window._lastData = data;
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = false;
  renderAll(data);
}

function renderAll(data) {
  renderTotals(data.totals, data.total);
  renderTable(data.rows);
  renderCards(data.rows);
  renderPagination(data.total, data.page, data.limit);
}

function renderTotals(totals, total) {
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
  document.getElementById('totals').innerHTML = cells;
}

function renderTable(rows) {
  const t = T();
  const body = document.getElementById('table-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty">${esc(t.empty_text)}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(r => {
    const status = String(r.status);
    const kindLabel = t['kind_' + r.kind] || r.kind;
    const canRefund = status === 'succeeded' && r.vendor === 'ecpay';
    const refundBtn = canRefund
      ? `<button class="pay-action-btn" data-action="open-refund" data-intent-id="${r.id}">${esc(t.action_refund)}</button>`
      : '';
    // 強制刪除 / Anonymize：admin 可清任意 status；UI 走 step-up + 兩段式確認
    const delBtn = `<button class="pay-action-btn pay-action-danger" data-action="open-delete" data-intent-id="${r.id}">強制刪除 / Anonymize</button>`;
    return `
      <tr data-action="open-detail" data-intent-id="${r.id}">
        <td class="id">${r.id}</td>
        <td>${esc(r.user_id)}</td>
        <td class="mono">${esc(r.vendor)}</td>
        <td>${esc(kindLabel)}</td>
        <td class="mono">${formatAmount(r)}</td>
        <td><span class="pay-badge ${status}">${esc(t['status_' + status] || status)}</span></td>
        <td class="mono">${esc(formatDate(r.created_at))}</td>
        <td>${refundBtn}${delBtn}</td>
      </tr>`;
  }).join('');
}

function renderCards(rows) {
  const t = T();
  const c = document.getElementById('cards-container');
  if (!rows.length) { c.innerHTML = `<div class="empty">${esc(t.empty_text)}</div>`; return; }
  c.innerHTML = rows.map(r => {
    const status = String(r.status);
    const canRefund = status === 'succeeded' && r.vendor === 'ecpay';
    const actions = canRefund
      ? `<button class="pay-action-btn" data-action="open-refund" data-intent-id="${r.id}" style="margin-top:.6rem">${esc(t.action_refund)}</button>`
      : '';
    return `
      <div class="req-card" data-action="open-detail" data-intent-id="${r.id}">
        <div class="row">
          <div>
            <span class="name">#${r.id} · user ${esc(r.user_id)}</span>
            <span class="company">${esc(r.vendor)}</span>
          </div>
          <span class="pay-badge ${status}">${esc(t['status_' + status] || status)}</span>
        </div>
        <div class="row" style="font-family:var(--font-mono);font-size:.78rem">${formatAmount(r)}</div>
        <div class="when">${esc(formatDate(r.created_at))}</div>
        ${actions}
      </div>`;
  }).join('');
}

function renderPagination(total, page, limit) {
  const t = T();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const pager = document.getElementById('pagination');
  pager.innerHTML = `
    <button data-action="prev" ${page <= 1 ? 'disabled' : ''}>${esc(t.pager_prev)}</button>
    <span class="stat">${fmt(t.pager_stat, { p: page, t: totalPages })}</span>
    <button data-action="next" ${page >= totalPages ? 'disabled' : ''}>${esc(t.pager_next)}</button>`;
}

document.getElementById('pagination').addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'prev') currentPage--;
  if (btn.dataset.action === 'next') currentPage++;
  load();
});

// ── Modal helpers ──────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => {
  const closer = e.target.closest('[data-modal-close]');
  if (closer) closeModal(closer.dataset.modalClose);
  // 點 backdrop 關閉
  document.querySelectorAll('.modal-bd.open').forEach(m => {
    if (e.target === m) m.classList.remove('open');
  });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-bd.open').forEach(m => m.classList.remove('open'));
});

// ── Detail / refund table click delegation ────────────
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action][data-intent-id]');
  if (!t) return;
  const id = Number(t.dataset.intentId);
  if (t.dataset.action === 'open-detail') {
    // 不要在 refund/delete button 上 trigger detail
    if (e.target.closest('.pay-action-btn')) return;
    openDetail(id);
  } else if (t.dataset.action === 'open-refund') {
    e.stopPropagation();
    openRefund(id);
  } else if (t.dataset.action === 'open-delete') {
    e.stopPropagation();
    openAdminDelete(id);
  }
});

function openDetail(id) {
  const row = window._lastData?.rows?.find(r => r.id === id);
  if (!row) return;
  const t = T();
  const meta = parseMeta(row);
  let metaHtml = '';
  if (meta?.requisition_id) {
    metaHtml += `<div class="modal-row"><span class="lbl">${esc(t.detail_requisition)}</span><span class="val mono">#${esc(meta.requisition_id)}</span></div>`;
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
  document.getElementById('modal-detail-body').innerHTML = `
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
let refundIntentId = null;

function openRefund(id) {
  const row = window._lastData?.rows?.find(r => r.id === id);
  if (!row) return;
  const t = T();
  refundIntentId = id;
  document.getElementById('refund-summary').textContent =
    fmt(t.refund_summary, { id: row.id, amount: formatAmount(row), user: row.user_id });
  document.getElementById('refund-otp').value = '';
  document.getElementById('refund-reason').value = '';
  setRefundMsg('', '');
  openModal('modal-refund');
  setTimeout(() => document.getElementById('refund-otp')?.focus(), 50);
}

function setRefundMsg(text, type) {
  const el = document.getElementById('refund-msg');
  el.textContent = text || '';
  el.className = 'refund-msg' + (type ? ' ' + type : '');
}

document.getElementById('refund-confirm-btn').addEventListener('click', async () => {
  const t = T();
  const otp = document.getElementById('refund-otp').value.trim();
  const reason = document.getElementById('refund-reason').value.trim();
  if (!/^\d{6}$/.test(otp)) { setRefundMsg(t.refund_err_otp, 'err'); return; }
  if (!refundIntentId) { setRefundMsg(t.refund_err_no_intent, 'err'); return; }

  const tok = getToken();
  if (!tok) { setRefundMsg(t.err_login_required, 'err'); return; }

  const btn = document.getElementById('refund-confirm-btn');
  btn.disabled = true;
  setRefundMsg(t.refund_step_up, '');

  // 1) step-up
  const su = await fetch('/api/auth/step-up', {
    method:  'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${tok}` },
    body:    JSON.stringify({ scope:'elevated:payment', for_action:'refund_payment', otp_code: otp }),
  }).catch(() => null);
  if (!su) { setRefundMsg(t.err_network, 'err'); btn.disabled = false; return; }
  if (!su.ok) {
    const j = await su.json().catch(() => ({}));
    setRefundMsg(j.error || `step-up ${su.status}`, 'err');
    btn.disabled = false; return;
  }
  const { step_up_token } = await su.json();
  if (!step_up_token) { setRefundMsg(t.refund_err_no_stepup, 'err'); btn.disabled = false; return; }

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
  const row = window._lastData?.rows?.find(r => r.id === id);
  if (!row) return;
  document.getElementById('admin-del-modal')?.remove();
  const m = document.createElement('div');
  m.id = 'admin-del-modal';
  m.className = 'modal-bd open';
  m.style.cssText = 'position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.7);padding:1rem';
  m.innerHTML = `
    <div style="background:#0f0f14;border:1px solid #2a2a35;border-radius:14px;padding:1.25rem;width:100%;max-width:400px">
      <h3 style="font-size:.95rem;color:#fff;margin:0 0 .75rem">強制刪除 / Anonymize #${row.id}</h3>
      <p style="font-size:.8rem;color:#9aa0aa;margin:0 0 .5rem">user ${esc(row.user_id)} · ${esc(row.vendor)} · ${formatAmount(row)} · ${esc(row.status)}</p>
      <p style="font-size:.78rem;color:#fca5a5;margin:0 0 .75rem">${['pending','failed','canceled'].includes(row.status) ? '此操作會永久從 D1 刪除此筆 intent。' : '此 intent 為 <b>'+esc(row.status)+'</b>，將執行 <b>anonymize</b>（保留金流憑證骨幹，清空 metadata 與 failure_reason）。row 不會被刪除。'} audit log 會留 critical 記錄。</p>
      <input id="admin-del-otp" type="text" inputmode="numeric" maxlength="6" placeholder="6 位 2FA OTP" autocomplete="one-time-code"
        style="width:100%;padding:.55rem .8rem;border-radius:.6rem;background:#0a0a10;border:1px solid #2a2a35;color:#fff;font-family:var(--font-mono);font-size:.9rem;letter-spacing:.2em;margin-bottom:.6rem">
      <p id="admin-del-msg" style="font-size:.75rem;min-height:1em;margin:0 0 .6rem"></p>
      <div style="display:flex;justify-content:flex-end;gap:.5rem">
        <button data-action="admin-del-cancel" style="padding:.5rem .9rem;border-radius:.55rem;background:#1a1a22;border:1px solid #2a2a35;color:#cbd5e1;font-size:.78rem;cursor:pointer">取消</button>
        <button id="admin-del-go" data-armed="0" data-id="${row.id}" style="padding:.5rem .9rem;border-radius:.55rem;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#fca5a5;font-size:.78rem;font-weight:600;cursor:pointer">強制刪除 / Anonymize</button>
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
  el.style.color = type === 'err' ? '#fca5a5' : type === 'ok' ? '#86efac' : '#9aa0aa';
}
let _adminDelArmTimer = null;
async function adminDelGo() {
  const btn = document.getElementById('admin-del-go');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.textContent = '確認強制刪除 / Anonymize';
    btn.style.background = 'rgba(239,68,68,.4)';
    btn.style.borderColor = 'rgba(239,68,68,.7)';
    btn.style.color = '#fee2e2';
    if (_adminDelArmTimer) clearTimeout(_adminDelArmTimer);
    _adminDelArmTimer = setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '0';
      btn.textContent = '強制刪除 / Anonymize';
      btn.style.background = 'rgba(239,68,68,.15)';
      btn.style.borderColor = 'rgba(239,68,68,.4)';
      btn.style.color = '#fca5a5';
    }, 4000);
    return;
  }
  if (_adminDelArmTimer) { clearTimeout(_adminDelArmTimer); _adminDelArmTimer = null; }
  const otp = document.getElementById('admin-del-otp')?.value.trim() ?? '';
  if (!/^\d{6}$/.test(otp)) { setAdminDelMsg('請輸入 6 位數字 2FA', 'err'); return; }
  const tok = getToken();
  if (!tok) { setAdminDelMsg('未登入', 'err'); return; }
  btn.disabled = true; setAdminDelMsg('驗證 2FA…', '');
  const su = await fetch('/api/auth/step-up', {
    method:  'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${tok}` },
    body:    JSON.stringify({ scope:'elevated:payment', for_action:'delete_payment', otp_code: otp }),
  }).catch(() => null);
  if (!su || !su.ok) {
    const j = su ? await su.json().catch(() => ({})) : {};
    setAdminDelMsg(j.error || `step-up ${su?.status ?? 'network'}`, 'err');
    btn.disabled = false; return;
  }
  const { step_up_token } = await su.json();
  setAdminDelMsg('呼叫刪除…', '');
  const r = await fetch(`/api/admin/payments/intents/${id}/delete`, {
    method:  'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${step_up_token}` },
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
  const a = e.target.closest('[data-action]')?.dataset?.action;
  if (a === 'admin-del-cancel') return closeAdminDelete();
  if (e.target.id === 'admin-del-go') return adminDelGo();
});

// ── Init ───────────────────────────────────────────────
load();
