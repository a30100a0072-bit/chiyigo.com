// admin-refund-requests — 退款申請列表 + 審核
// Stage 5 PR-5l (2026-05-22)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl（curStatus / _cache / LANGS_I18N / curLang / T /
// applyLangI / langTogBtn / langDrop / ACCESS_TOKEN_KEY / getToken / logout /
// themeBtn / applyTheme / esc / fmtDate / showError / load / render /
// _decideId / _decideAction / openDecide / setMsg）在同 tsc program 全域 scope
// 撞名 → TS2393。+ 與 page chrome 同 collision set（hamBtn / overlay / mTopbar /
// openMenu / closeMenu / mTopLangDrop）。
// 對 apiFetch 改走 window.apiFetch — 同 PR-5j/5k（per
// [[feedback_page_entry_apifetch_window_prefix]]）：prod tsconfig (types:[]
// 不載 types/api-globals.d.ts) 下 api.ts 的 script-scope `interface Window { apiFetch }`
// 是唯一 ambient 來源；runtime 等價，admin-refund-requests.html 已先載 api.js。
;(function () {

let curStatus = 'pending';
let _cache: Array<Record<string, unknown>> = [];

// ── i18n ───────────────────────────────────────────────
const LANGS_I18N = /*@i18n@*/{};
let curLang = localStorage.getItem('lang') || 'zh-TW';
function T() { return LANGS_I18N[curLang] || LANGS_I18N['zh-TW'] || {}; }
function applyLangI(lang) {
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = T();
  document.documentElement.lang = lang;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => { const k = el.dataset.i18n; if (k && typeof t[k] === 'string') el.textContent = t[k]; });
  document.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach(el => { const k = el.dataset.i18nPh; if (k && typeof t[k] === 'string') el.placeholder = t[k]; });
  document.querySelectorAll<HTMLElement>('.lang-opt,.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  if (typeof render === 'function') render();
}
const langTogBtn = document.getElementById('lang-toggle-btn');
const langDrop   = document.getElementById('lang-dropdown');
langTogBtn?.addEventListener('click', e => { e.stopPropagation(); langDrop?.classList.toggle('open'); });
document.addEventListener('click', () => langDrop?.classList.remove('open'));
langDrop?.addEventListener('click', e => { const opt = (e.target as Element | null)?.closest<HTMLElement>('.lang-opt'); if (!opt) return; applyLangI(opt.dataset.lang); langDrop.classList.remove('open'); });

const ACCESS_TOKEN_KEY = 'access_token';
const getToken = () => sessionStorage.getItem(ACCESS_TOKEN_KEY);

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

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('zh-TW', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

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

document.querySelectorAll<HTMLElement>('.rr-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    curStatus = btn.dataset.st ?? 'pending';
    document.querySelectorAll<HTMLElement>('.rr-tab').forEach(b => b.classList.toggle('active', b === btn));
    load();
  });
});
document.querySelector('.rr-tab[data-st="pending"]')?.classList.add('active');

async function load() {
  if (!getToken()) { showError('請先登入'); return; }
  const loading = document.getElementById('loading');
  const content = document.getElementById('content');
  const errMsg  = document.getElementById('error-msg');
  if (loading) loading.hidden = false;
  if (content) content.hidden = true;
  if (errMsg)  errMsg.hidden  = true;
  let data;
  try {
    data = await window.apiFetch(`/api/admin/requisition-refund?status=${curStatus}&limit=200`);
  } catch (e: unknown) {
    const err = e as { code?: string; status?: number; message?: string } | null;
    if (err?.code === 'SESSION_EXPIRED') return showError('請先登入');
    if (err?.status === 403) return showError('權限不足');
    return showError(err?.message || '網路錯誤');
  }
  _cache = data?.rows ?? [];
  if (loading) loading.hidden = true;
  if (content) content.hidden = false;
  render();
  // pending 數字徽章
  if (curStatus === 'pending') {
    const c = document.getElementById('cnt-pending');
    const n = _cache.length;
    if (c) { if (n > 0) { c.textContent = String(n); c.hidden = false; } else { c.hidden = true; } }
    const sb = document.getElementById('sb-rr-badge');
    if (sb) { if (n > 0) { sb.textContent = String(n); sb.hidden = false; } else { sb.hidden = true; } }
  }
}

function render() {
  const list = document.getElementById('rr-list');
  if (!list) return;
  const t = T();
  if (!_cache.length) {
    const emptyKey = `empty_${curStatus}`;
    list.innerHTML = `<p class="empty-state">${esc(t[emptyKey] || `沒有 ${curStatus} 的退款申請`)}</p>`;
    return;
  }
  list.innerHTML = _cache.map((row: Record<string, unknown>) => {
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
  const target = e.target as Element | null;
  const ap = target?.closest<HTMLElement>('[data-rf-approve]');
  if (ap) return openDecide(Number(ap.dataset.rfApprove), 'approve');
  const rj = target?.closest<HTMLElement>('[data-rf-reject]');
  if (rj) return openDecide(Number(rj.dataset.rfReject), 'reject');
  const close = target?.closest<HTMLElement>('[data-modal-close]');
  if (close && close.dataset.modalClose) document.getElementById(close.dataset.modalClose)?.classList.remove('open');
});

let _decideId: number | null = null, _decideAction: 'approve' | 'reject' | null = null;
function openDecide(id, action) {
  const row = _cache.find((r: Record<string, unknown>) => r.id === id);
  if (!row) return;
  _decideId = id; _decideAction = action;
  const isApprove = action === 'approve';
  const t = T();
  const amt = row.intent_amount_subunit != null
    ? `${Number(row.intent_amount_subunit).toLocaleString()} ${esc(row.intent_currency || 'TWD')}`
    : '—';
  const titleEl     = document.getElementById('rd-title');
  const summaryEl   = document.getElementById('rd-summary');
  const noteLabelEl = document.getElementById('rd-note-label');
  const noteEl      = document.getElementById('rd-note') as HTMLInputElement | null;
  const otpEl       = document.getElementById('rd-otp')  as HTMLInputElement | null;
  const btn         = document.getElementById('rd-confirm-btn') as HTMLButtonElement | null;
  const modal       = document.getElementById('modal-refund-decide');
  if (!titleEl || !summaryEl || !noteLabelEl || !noteEl || !otpEl || !btn || !modal) return;
  titleEl.textContent = isApprove
    ? (t.modal_title_approve || '通過退款並執行')
    : (t.modal_title_reject  || '拒絕退款申請');
  summaryEl.innerHTML = isApprove
    ? `${esc(t.modal_summary_approve || '通過後立刻退款並撤銷需求單。動作不可逆。')} <strong>${amt}</strong> · req #${esc(row.requisition_id)} · intent #${esc(row.intent_id)}`
    : `${esc(t.modal_summary_reject  || '拒絕退款申請。需求單仍維持「退款審核中」，user 可改聯絡客服。')} req #${esc(row.requisition_id)}`;
  noteLabelEl.textContent = isApprove
    ? (t.modal_note_label_approve || '審核備註（選填）')
    : (t.modal_note_label_reject  || '拒絕理由（建議填）');
  noteEl.placeholder = t.modal_note_ph || '備註會記錄到 audit log';
  noteEl.value = '';
  otpEl.value = '';
  setMsg('', '');
  btn.disabled = false;
  btn.textContent = isApprove
    ? (t.modal_confirm_approve || '確認通過並退款')
    : (t.modal_confirm_reject  || '確認拒絕');
  btn.className = isApprove ? 'confirm' : 'cancel is-danger';
  modal.classList.add('open');
  setTimeout(() => otpEl.focus(), 50);
}

function setMsg(text, type) {
  const el = document.getElementById('rd-msg');
  if (!el) return;
  el.textContent = text || '';
  el.className = 'refund-msg' + (type ? ' ' + type : '');
}

document.getElementById('rd-confirm-btn')?.addEventListener('click', async () => {
  const id = _decideId, act = _decideAction;
  if (!id || !act) return;
  const otpEl  = document.getElementById('rd-otp')  as HTMLInputElement  | null;
  const noteEl = document.getElementById('rd-note') as HTMLInputElement  | null;
  const btn    = document.getElementById('rd-confirm-btn') as HTMLButtonElement | null;
  const modal  = document.getElementById('modal-refund-decide');
  if (!otpEl || !noteEl || !btn || !modal) return;
  const otp  = otpEl.value.trim();
  const note = noteEl.value.trim();
  const t = T();
  if (!/^\d{6}$/.test(otp)) { setMsg(t.msg_otp_invalid || 'OTP 須為 6 位數字', 'err'); return; }

  btn.disabled = true;
  setMsg(t.msg_step_up_running || 'step-up 驗證中…', '');

  const forAction = act === 'approve' ? 'approve_requisition_refund' : 'reject_requisition_refund';
  let step_up_token: string | undefined;
  try {
    const su = await window.apiFetch<{ step_up_token?: string }>('/api/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ scope:'elevated:payment', for_action: forAction, otp_code: otp }),
    });
    step_up_token = su?.step_up_token;
    if (!step_up_token) { setMsg(t.msg_step_up_no_token || '未拿到 step-up token', 'err'); btn.disabled = false; return; }
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string } | null;
    if (err?.code === 'SESSION_EXPIRED') return;
    setMsg(err?.message || (t.msg_step_up_failed || 'step-up 失敗'), 'err');
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
    if (r) {
      try { const j = await r.json(); msg = (j.error || msg) + (j.rtn_msg ? ` / ${j.rtn_msg}` : ''); } catch {}
    }
    setMsg(msg, 'err'); btn.disabled = false; return;
  }
  setMsg(act === 'approve' ? (t.msg_approve_ok || '✓ 已通過並退款') : (t.msg_reject_ok || '✓ 已拒絕'), 'ok');
  setTimeout(() => {
    modal.classList.remove('open');
    load();
  }, 800);
});

applyLangI(curLang);
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
