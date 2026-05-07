// admin-refund-requests.js — 退款申請列表 + 審核

let curStatus = 'pending';
let _cache = [];

// ── i18n ───────────────────────────────────────────────
const LANGS_I18N = /*@i18n@*/{};
let curLang = localStorage.getItem('lang') || 'zh-TW';
function T() { return LANGS_I18N[curLang] || LANGS_I18N['zh-TW'] || {}; }
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = T();
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  if (typeof render === 'function') render();
}
const langTogBtn = document.getElementById('lang-toggle-btn');
const langDrop   = document.getElementById('lang-dropdown');
langTogBtn?.addEventListener('click', e => { e.stopPropagation(); langDrop?.classList.toggle('open'); });
document.addEventListener('click', () => langDrop?.classList.remove('open'));
langDrop?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDrop.classList.remove('open'); });
applyLangI(curLang);

const ACCESS_TOKEN_KEY = 'access_token';
const getToken = () => sessionStorage.getItem(ACCESS_TOKEN_KEY);

async function logout() {
  const tok = getToken();
  if (tok) await fetch('/api/auth/logout', { method:'POST', credentials:'include', headers:{ Authorization:`Bearer ${tok}` } }).catch(() => {});
  sessionStorage.clear();
  location.href = '/login.html';
}
document.getElementById('logout-btn')?.addEventListener('click', logout);

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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('zh-TW', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function showError(msg) {
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = false;
  document.getElementById('error-text').textContent = `// error: ${msg}`;
}

document.querySelectorAll('.rr-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    curStatus = btn.dataset.st;
    document.querySelectorAll('.rr-tab').forEach(b => b.classList.toggle('active', b === btn));
    load();
  });
});
document.querySelector('.rr-tab[data-st="pending"]')?.classList.add('active');

async function load() {
  document.getElementById('loading').hidden = false;
  document.getElementById('content').hidden = true;
  document.getElementById('error-msg').hidden = true;
  let data;
  try {
    data = await apiFetch(`/api/admin/requisition-refund?status=${curStatus}&limit=200`);
  } catch (e) {
    if (e?.code === 'SESSION_EXPIRED') return;
    if (e?.status === 403) return showError('權限不足');
    return showError(e?.message || '網路錯誤');
  }
  _cache = data?.rows ?? [];
  document.getElementById('loading').hidden = true;
  document.getElementById('content').hidden = false;
  render();
  // pending 數字徽章
  if (curStatus === 'pending') {
    const c = document.getElementById('cnt-pending');
    const n = _cache.length;
    if (n > 0) { c.textContent = String(n); c.hidden = false; }
    else { c.hidden = true; }
    const sb = document.getElementById('sb-rr-badge');
    if (sb) { if (n > 0) { sb.textContent = String(n); sb.hidden = false; } else { sb.hidden = true; } }
  }
}

function render() {
  const list = document.getElementById('rr-list');
  const t = T();
  if (!_cache.length) {
    const emptyKey = `empty_${curStatus}`;
    list.innerHTML = `<p class="empty-state">${esc(t[emptyKey] || `沒有 ${curStatus} 的退款申請`)}</p>`;
    return;
  }
  list.innerHTML = _cache.map(row => {
    const amt = row.intent_amount_subunit != null
      ? `${Number(row.intent_amount_subunit).toLocaleString()} ${esc(row.intent_currency || 'TWD')}`
      : '—';
    const isPending = row.status === 'pending';
    const decided = row.decided_at ? `<div class="refund-row__sub">${esc(t.row_decided_at || '決議時間')} ${esc(fmtDate(row.decided_at))}${row.admin_note ? '：' + esc(row.admin_note) : ''}</div>` : '';
    return `
      <div class="refund-row" data-rr-row="${row.id}">
        <div class="refund-row__head">
          <div class="refund-row__ids">
            <span class="req-tag">${esc(t.row_req || 'req')} #${esc(row.requisition_id)}</span>
            <span class="meta-tag">${esc(t.row_user || 'user')} ${esc(row.user_id)}</span>
            <span class="meta-tag">${esc(t.row_intent || 'intent')} #${esc(row.intent_id ?? '?')} (${esc(row.intent_vendor ?? '?')})</span>
          </div>
          <div class="refund-row__amount">${amt}</div>
        </div>
        <div class="refund-row__sub">
          ${esc(row.req_name ?? '')}${row.req_contact ? ' · ' + esc(row.req_contact) : ''} · ${esc(t.row_apply_time || '申請時間')} ${esc(fmtDate(row.created_at))}
        </div>
        <div class="refund-row__reason">${esc(row.reason ?? (t.row_reason_unfilled || '(未填)'))}</div>
        ${decided}
        ${isPending ? `
        <div class="refund-row__actions">
          <button class="reject"  data-rf-reject="${row.id}">${esc(t.btn_reject || '拒絕')}</button>
          <button class="approve" data-rf-approve="${row.id}">${esc(t.btn_approve || '通過 + 退款')}</button>
        </div>` : ''}
      </div>`;
  }).join('');
}

document.addEventListener('click', e => {
  const ap = e.target.closest('[data-rf-approve]');
  if (ap) return openDecide(Number(ap.dataset.rfApprove), 'approve');
  const rj = e.target.closest('[data-rf-reject]');
  if (rj) return openDecide(Number(rj.dataset.rfReject), 'reject');
  const close = e.target.closest('[data-modal-close]');
  if (close) document.getElementById(close.dataset.modalClose)?.classList.remove('open');
});

let _decideId = null, _decideAction = null;
function openDecide(id, action) {
  const row = _cache.find(r => r.id === id);
  if (!row) return;
  _decideId = id; _decideAction = action;
  const isApprove = action === 'approve';
  const t = T();
  const amt = row.intent_amount_subunit != null
    ? `${Number(row.intent_amount_subunit).toLocaleString()} ${esc(row.intent_currency || 'TWD')}`
    : '—';
  document.getElementById('rd-title').textContent = isApprove
    ? (t.modal_title_approve || '通過退款並執行')
    : (t.modal_title_reject  || '拒絕退款申請');
  document.getElementById('rd-summary').innerHTML = isApprove
    ? `${esc(t.modal_summary_approve || '通過後立刻退款並撤銷需求單。動作不可逆。')} <strong>${amt}</strong> · req #${esc(row.requisition_id)} · intent #${esc(row.intent_id)}`
    : `${esc(t.modal_summary_reject  || '拒絕退款申請。需求單仍維持「退款審核中」，user 可改聯絡客服。')} req #${esc(row.requisition_id)}`;
  document.getElementById('rd-note-label').textContent = isApprove
    ? (t.modal_note_label_approve || '審核備註（選填）')
    : (t.modal_note_label_reject  || '拒絕理由（建議填）');
  document.getElementById('rd-note').placeholder = t.modal_note_ph || '備註會記錄到 audit log';
  document.getElementById('rd-note').value = '';
  document.getElementById('rd-otp').value = '';
  setMsg('', '');
  const btn = document.getElementById('rd-confirm-btn');
  btn.disabled = false;
  btn.textContent = isApprove
    ? (t.modal_confirm_approve || '確認通過並退款')
    : (t.modal_confirm_reject  || '確認拒絕');
  btn.className = isApprove ? 'confirm' : 'cancel';
  if (!isApprove) btn.style.cssText = 'background:#dc2626;border-color:#dc2626;color:#fff';
  else btn.style.cssText = '';
  document.getElementById('modal-refund-decide').classList.add('open');
  setTimeout(() => document.getElementById('rd-otp')?.focus(), 50);
}

function setMsg(text, type) {
  const el = document.getElementById('rd-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'refund-msg' + (type ? ' ' + type : '');
}

document.getElementById('rd-confirm-btn').addEventListener('click', async () => {
  const id = _decideId, act = _decideAction;
  if (!id || !act) return;
  const otp  = document.getElementById('rd-otp').value.trim();
  const note = document.getElementById('rd-note').value.trim();
  const t = T();
  if (!/^\d{6}$/.test(otp)) { setMsg(t.msg_otp_invalid || 'OTP 須為 6 位數字', 'err'); return; }

  const btn = document.getElementById('rd-confirm-btn');
  btn.disabled = true;
  setMsg(t.msg_step_up_running || 'step-up 驗證中…', '');

  const forAction = act === 'approve' ? 'approve_requisition_refund' : 'reject_requisition_refund';
  let step_up_token;
  try {
    const su = await apiFetch('/api/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ scope:'elevated:payment', for_action: forAction, otp_code: otp }),
    });
    step_up_token = su?.step_up_token;
    if (!step_up_token) { setMsg(t.msg_step_up_no_token || '未拿到 step-up token', 'err'); btn.disabled = false; return; }
  } catch (e) {
    if (e?.code === 'SESSION_EXPIRED') return;
    setMsg(e?.message || (t.msg_step_up_failed || 'step-up 失敗'), 'err');
    btn.disabled = false; return;
  }

  setMsg(act === 'approve' ? (t.msg_calling_refund || '呼叫 ECPay 退款中…') : (t.msg_calling_reject || '寫入拒絕中…'), '');
  const r = await fetch(`/api/admin/requisition-refund/${id}/${act}`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', Authorization:`Bearer ${step_up_token}` },
    body: JSON.stringify({ admin_note: note || null }),
  }).catch(() => null);
  if (!r || !r.ok) {
    let msg = `${act} ${t.msg_step_up_failed || '失敗'}`;
    try { const j = await r.json(); msg = (j.error || msg) + (j.rtn_msg ? ` / ${j.rtn_msg}` : ''); } catch {}
    setMsg(msg, 'err'); btn.disabled = false; return;
  }
  setMsg(act === 'approve' ? (t.msg_approve_ok || '✓ 已通過並退款') : (t.msg_reject_ok || '✓ 已拒絕'), 'ok');
  setTimeout(() => {
    document.getElementById('modal-refund-decide').classList.remove('open');
    load();
  }, 800);
});

load();
