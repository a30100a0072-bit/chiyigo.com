// ── block 1/3 ──
// ── i18n ──────────────────────────────────────────────
const LANGS_D = /*@i18n@*/{};

let curLangD = localStorage.getItem('lang') || 'zh-TW';
function T(key) { return (LANGS_D[curLangD] || LANGS_D['zh-TW'])[key] ?? (LANGS_D['zh-TW'][key] ?? key); }

function applyLangD(lang) {
  curLangD = lang;
  localStorage.setItem('lang', lang);
  const t = LANGS_D[lang] || LANGS_D['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh; if (t[k] !== undefined) el.placeholder = t[k];
  });
  document.querySelectorAll('.db-lang-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // re-render any already-rendered dynamic UI
  const tfaBadge = document.getElementById('tfa-badge');
  const tfaText  = document.getElementById('tfa-status-text');
  if (tfaBadge && tfaBadge.dataset.tfaState) {
    const on = tfaBadge.dataset.tfaState === 'on';
    tfaBadge.textContent = on ? T('tfa_badge_on') : T('tfa_badge_off');
    if (tfaText) tfaText.textContent = on ? T('tfa_text_on') : T('tfa_text_off');
  }
  // 加入時間：依當前語系重新格式化
  const createdEl = document.getElementById('info-created');
  if (createdEl?.dataset.raw) createdEl.textContent = formatDate(createdEl.dataset.raw);
  // 需求單列表：以最後一次 fetch 結果重畫（變數宣告在後段，用 window 規避 TDZ）
  if (window._lastRequisitions) renderRequisitions(window._lastRequisitions);
  // Phase D-3 動態 row 切語系跟著重畫
  if (window._lastDevices)  renderDevices(window._lastDevices);
  if (window._lastPasskeys) renderPasskeys(window._lastPasskeys);
  // Phase F-3 wallet
  if (window._lastWallets)  renderWallets(window._lastWallets);
  if (window._lastPayments) renderPayments(window._lastPayments);
  // 刪帳按鈕 / 2FA enable label 隨 hasPassword 動態切換，需在 i18n 套用後重畫
  if (typeof window.__hasPassword !== 'undefined') {
    if (typeof renderDeleteSection === 'function') renderDeleteSection(window.__hasPassword);
    // 重畫 2FA 區塊以同步「需先設密碼」label 的語系
    const tfaBadgeForRedraw = document.getElementById('tfa-badge');
    if (tfaBadgeForRedraw && tfaBadgeForRedraw.dataset.tfaState !== undefined) {
      render2FASection(tfaBadgeForRedraw.dataset.tfaState === 'on', window.__hasPassword);
    }
  }
}

// lang switcher — globe dropdown
const dbGlobeBtn = document.getElementById('db-globe-btn');
const dbLangDrop = document.getElementById('db-lang-drop');
dbGlobeBtn?.addEventListener('click', e => {
  e.stopPropagation();
  dbLangDrop?.classList.toggle('open');
});
dbLangDrop?.addEventListener('click', e => {
  const opt = e.target.closest('.db-lang-opt'); if (!opt) return;
  applyLangD(opt.dataset.lang);
  dbLangDrop.classList.remove('open');
});
document.addEventListener('click', () => dbLangDrop?.classList.remove('open'));
applyLangD(curLangD);

const ROLE_STYLE = {
  developer: 'bg-purple-500/15 text-purple-300 border border-purple-500/20',
  admin:     'bg-red-500/15 text-red-300 border border-red-500/20',
  moderator: 'bg-amber-500/15 text-amber-300 border border-amber-500/20',
  player:    'bg-brand-500/15 text-brand-300 border border-brand-500/20',
};

function dateLocale() {
  // 對應 Intl.DateTimeFormat 可接受的 locale；'zh-TW' 直接用，其餘 BCP-47 通用
  return curLangD === 'zh-TW' ? 'zh-TW' : curLangD;
}
function formatDate(str) {
  if (!str) return '—';
  const d = new Date(str.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(dateLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}
function formatDateShort(str) {
  if (!str) return '—';
  const d = new Date(str.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString(dateLocale(), { month: 'numeric', day: 'numeric' });
}

async function loadProfile() {
  const token = sessionStorage.getItem('access_token');
  if (!token) { window.location.href = '/login.html'; return; }

  try {
    let res = await fetch('/api/auth/me', {
      headers: { 'Authorization': 'Bearer ' + token },
    });

    // access_token 過期 → 嘗試靜默刷新一次，成功後重試
    if (res.status === 401) {
      console.warn('[loadProfile] 401 first hit, traceId=', res.headers.get('X-Request-Id'));
      const ok = await refreshAccessToken();
      console.warn('[loadProfile] refresh result=', ok);
      if (!ok) {
        sessionStorage.removeItem('access_token');
        window.location.href = '/login.html';
        return;
      }
      res = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + sessionStorage.getItem('access_token') },
      });
      if (res.status === 401) {
        console.warn('[loadProfile] 401 after refresh, traceId=', res.headers.get('X-Request-Id'));
        const body = await res.json().catch(() => ({}));
        console.warn('[loadProfile] 401 body=', body);
        sessionStorage.removeItem('access_token');
        window.location.href = '/login.html';
        return;
      }
    }

    if (res.status === 403) {
      sessionStorage.removeItem('access_token');
      window.location.href = '/login.html';
      return;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn('[loadProfile] non-ok', res.status, body, 'traceId=', res.headers.get('X-Request-Id'));
      throw new Error(body.error || ('HTTP ' + res.status));
    }

    const data = await res.json();

    document.getElementById('user-email').textContent   = data.email;
    document.getElementById('info-email').textContent   = data.email;
    const createdEl = document.getElementById('info-created');
    createdEl.dataset.raw = data.created_at ?? '';
    createdEl.textContent = formatDate(data.created_at);

    const roleBadge = document.getElementById('role-badge');
    roleBadge.textContent = T('role_' + data.role) || data.role;
    roleBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold ' + (ROLE_STYLE[data.role] ?? ROLE_STYLE.player);

    const statusBadge = document.getElementById('status-badge');
    statusBadge.textContent = data.status === 'active' ? T('status_active') : data.status;
    statusBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-semibold ' +
      (data.status === 'active'
        ? 'bg-green-500/15 text-green-300 border border-green-500/20'
        : 'bg-red-500/15 text-red-300 border border-red-500/20');

    const verifiedEl = document.getElementById('info-verified');
    verifiedEl.textContent = data.email_verified ? T('verified_yes') : T('verified_no');
    verifiedEl.className   = 'text-sm font-medium ' + (data.email_verified ? 'text-green-400' : 'text-amber-400');

    document.getElementById('email-banner').classList.toggle('hidden', !!data.email_verified);

    const providersEl = document.getElementById('info-providers');
    const PROVIDER_ICON_FN = (p) => p === 'discord'
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-[#5865F2]/15 text-[#5865F2] border border-[#5865F2]/20">Discord</span>`
      : p === 'local'
      ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-gray-500/15 text-gray-300 border border-gray-500/20">${T('provider_local')}</span>`
      : `<span class="text-xs text-gray-500">${p}</span>`;
    const icons = (data.identities ?? []).map(i => PROVIDER_ICON_FN(i.provider));
    if (icons.length === 0) icons.push(PROVIDER_ICON_FN('local'));
    providersEl.innerHTML = icons.join('');

    // 2FA 區塊
    render2FASection(data.totp_enabled ?? false, !!data.has_password);

    // 帳號綁定區塊
    renderBindingSection(data.identities ?? []);

    // 設密碼 / 刪帳號：依是否設過密碼決定 UI
    window.__hasPassword = !!data.has_password;
    window.__userEmail   = data.email;
    renderSetPasswordSection(window.__hasPassword);
    renderChangePasswordSection(window.__hasPassword, !!data.totp_enabled);
    renderDeleteSection(window.__hasPassword);

    // 需求單區塊
    loadRequisitions();

    // Phase D-3：裝置 + Passkey
    window.__totpEnabled = !!data.totp_enabled;
    loadDevices();
    loadPasskeys();

    // Phase F-3：錢包
    loadWallets();

    // Phase F-2 wave 3：付款 / 充值
    loadPayments();
    // P1-6: 我的成交紀錄
    loadDeals();
    // 從綠界分頁付款完切回來 → 自動重抓 intent list（不用 user 手動 F5）
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { loadPayments(); loadDeals(); }
    });

    // requisition.html 帶 ?req=N 跳來時，自動開充值表單 + 預填編號
    const reqParam = new URL(window.location.href).searchParams.get('req');
    if (reqParam && /^\d+$/.test(reqParam)) {
      setTimeout(() => {
        openPaymentForm();
        const reqInput = document.getElementById('payment-requisition');
        if (reqInput) reqInput.value = reqParam;
        document.getElementById('payments-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    }

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('user-card').classList.remove('hidden');

  } catch (e) {
    console.warn('[loadProfile] catch', e);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-card').classList.remove('hidden');
    const detail = e?.message ? `${T('err_profile')}（${e.message}）` : T('err_profile');
    document.getElementById('error-msg').textContent = detail;
  }
}

loadProfile();

// ── HTML 轉義 helper（防 XSS）────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

// ── 後端英文錯誤訊息 → i18n key（dashboard 共用映射）──────────
const BACKEND_ERR_MAP = {
  'Invalid OTP code':            'err_invalid_otp',
  'Invalid OTP or backup code':  'err_invalid_otp',
  'Token revoked':               'err_token_revoked',
  'Unauthorized':                'err_unauthorized',
  'Too many requests':           'err_too_many',
  'Too many requests. Please try again later.': 'err_too_many',
  'Account is banned':           'err_account_banned',
  'Incorrect password':          'err_invalid_password',
  'Account not found':           'err_user_not_found',
  'captcha_failed':              'err_captcha',
}
// 把 ApiError 翻成本地化 + traceId 字串；非 ApiError 退回 fallback
function tApiError(e, fallback) {
  if (!(e instanceof ApiError) || e.status === 0) return fallback
  const k    = BACKEND_ERR_MAP[e.body?.error]
  const base = k ? T(k) : (e.message ?? fallback)
  return e.traceId ? `${base}（#${e.traceId}）` : base
}

// ── 需求單 ───────────────────────────────────────────────────

const REQ_STATUS_CLS = {
  pending:        'bg-amber-500/15 text-amber-300 border border-amber-500/20',
  revoked:        'bg-gray-500/15 text-gray-500 border border-gray-500/20',
  processing:     'bg-blue-500/15 text-blue-300 border border-blue-500/20',
  completed:      'bg-green-500/15 text-green-300 border border-green-500/20',
  refund_pending: 'bg-orange-500/15 text-orange-300 border border-orange-500/20',
}
function reqStatus(key) {
  return { text: T('status_' + key), cls: REQ_STATUS_CLS[key] ?? REQ_STATUS_CLS.pending }
}
window._lastRequisitions = null;

async function loadRequisitions() {
  if (!sessionStorage.getItem('access_token')) return
  try {
    const { requisitions } = await apiFetch('/api/requisition/me')
    renderRequisitions(requisitions)
  } catch { /* 非必要區塊，靜默失敗 */ }
}

function renderRequisitions(list) {
  window._lastRequisitions = list
  const section  = document.getElementById('req-section')
  const listEl   = document.getElementById('req-list')
  const emptyEl  = document.getElementById('req-empty')
  const noteEl   = document.getElementById('req-revoke-note')
  if (!list || list.length === 0) {
    emptyEl.classList.remove('hidden')
    listEl.innerHTML = ''
    if (noteEl) noteEl.classList.add('hidden')
    section.classList.remove('hidden')
    return
  }
  emptyEl.classList.add('hidden')
  const hasPending = list.some(r => r.status === 'pending')
  if (noteEl) noteEl.classList.toggle('hidden', !hasPending)
  listEl.innerHTML = list.map(r => {
    const s    = reqStatus(r.status)
    const date = formatDateShort(r.created_at)
    return `
      <div data-req-open-id="${r.id}" class="flex items-center justify-between px-5 py-3.5 gap-3 cursor-pointer hover:bg-white/[0.02] transition-colors">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xs text-gray-600 shrink-0">#${r.id}</span>
          <span class="text-sm text-white truncate">${esc(r.service_type)}</span>
          <span class="text-xs text-gray-500 shrink-0">${date}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}">${s.text}</span>
          ${r.status === 'pending'
            ? `<button id="revoke-btn-${r.id}" data-armed="0" data-revoke-id="${r.id}"
                 class="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
                 ${T('btn_revoke')}
               </button>`
            : ''}
          ${r.status === 'revoked'
            ? `<button id="reqdel-btn-${r.id}" data-armed="0" data-req-del-id="${r.id}"
                 class="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
                 永久刪除
               </button>`
            : ''}
        </div>
      </div>`
  }).join('')
  section.classList.remove('hidden')
}

// 兩步撤銷：第一次點擊變成「確認撤銷」，再點才真正執行；4 秒未確認自動還原
let _revokeArmTimer = null
function disarmRevoke(id) {
  const btn = document.getElementById(`revoke-btn-${id}`)
  if (!btn) return
  btn.dataset.armed = '0'
  btn.textContent = T('btn_revoke')
  btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all'
  if (_revokeArmTimer) { clearTimeout(_revokeArmTimer); _revokeArmTimer = null }
}
function armRevoke(id) {
  const btn = document.getElementById(`revoke-btn-${id}`)
  if (!btn) return
  if (btn.dataset.armed === '1') {
    revokeRequisition(id)
    return
  }
  // 先還原其他可能已 arm 的按鈕
  document.querySelectorAll('[id^="revoke-btn-"]').forEach(b => {
    if (b !== btn && b.dataset.armed === '1') {
      const otherId = b.id.replace('revoke-btn-', '')
      disarmRevoke(otherId)
    }
  })
  btn.dataset.armed = '1'
  btn.textContent = T('btn_revoke_confirm')
  btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/30 hover:bg-red-500/40 border border-red-500/50 text-red-200 text-xs font-semibold transition-all'
  if (_revokeArmTimer) clearTimeout(_revokeArmTimer)
  _revokeArmTimer = setTimeout(() => disarmRevoke(id), 4000)
}

async function revokeRequisition(id, reason) {
  const btn = document.getElementById(`revoke-btn-${id}`)
  if (_revokeArmTimer) { clearTimeout(_revokeArmTimer); _revokeArmTimer = null }
  if (btn) { btn.disabled = true; btn.textContent = T('btn_processing') }
  try {
    const r = await apiFetch('/api/requisition/revoke', {
      method: 'POST',
      body:   JSON.stringify({ requisition_id: id, reason }),
    })
    if (r?.code === 'REFUND_REQUESTED') {
      showBindToast('退款申請已送出，等候 admin 審核', 'ok')
    } else {
      showBindToast(T('msg_revoke_success').replace('${id}', id), 'ok')
    }
    loadRequisitions()
  } catch (e) {
    // 已付款 → 後端要求填退款原因；prompt 後重試
    if (e?.code === 'REASON_REQUIRED') {
      const amt = e.body?.amount_subunit, cur = e.body?.currency || 'TWD'
      const tip = amt != null ? `（已付款 ${amt} ${cur}，需走退款審核）` : '（已付款，需走退款審核）'
      const input = window.prompt('請填寫退款原因' + tip, '')
      if (input && input.trim()) {
        return revokeRequisition(id, input.trim())
      }
      // user 取消 → 還原按鈕
      if (btn) { btn.disabled = false; btn.textContent = T('btn_revoke') }
      return
    }
    if (e?.code === 'REFUND_ALREADY_PENDING') {
      showBindToast('此單已申請退款，等候 admin 審核', 'err')
      loadRequisitions()
      return
    }
    showBindToast(tApiError(e, T('net_err')), 'err')
    if (btn) { btn.disabled = false; btn.textContent = T('btn_revoke') }
  }
}

// ── Requisition detail modal + 永久刪除（status='revoked' 才顯示）──
async function openRequisitionDetail(id) {
  let row;
  try {
    row = await apiFetch(`/api/requisition/${id}`);
  } catch (e) {
    showBindToast(tApiError(e, T('net_err')), 'err');
    return;
  }
  // 移除舊 modal
  document.getElementById('req-detail-modal')?.remove();
  const date = row.created_at ? formatDateShort(row.created_at) : '—';
  const s    = reqStatus(row.status);
  const fields = [
    ['服務類型', row.service_type],
    ['預算',     row.budget],
    ['時程',     row.timeline],
    ['姓名',     row.name],
    ['聯絡',     row.contact],
    ['公司',     row.company || '—'],
  ];
  const rowsHtml = fields.map(([k,v]) =>
    `<div class="flex gap-3 text-sm"><span class="w-16 text-gray-500 shrink-0">${k}</span><span class="text-white break-all">${esc(v ?? '—')}</span></div>`
  ).join('');
  const msgHtml = row.message
    ? `<div class="mt-2"><p class="text-xs text-gray-500 mb-1">需求說明</p><p class="text-sm text-white whitespace-pre-wrap break-words bg-[#0a0a10] border border-[#2a2a35] rounded-lg px-3 py-2">${esc(row.message)}</p></div>`
    : '';
  // 串付款狀態
  const payments = row.linked_payments ?? [];
  const payHtml = payments.length === 0
    ? `<div class="mt-3"><p class="text-xs text-gray-500 mb-1">付款紀錄</p><p class="text-xs text-gray-600">尚無付款</p></div>`
    : `<div class="mt-3"><p class="text-xs text-gray-500 mb-1">付款紀錄</p>
         <div class="space-y-1.5">${payments.map(p => {
           const cls = PAY_STATUS_COLOR[p.status] || PAY_STATUS_COLOR.pending;
           const lbl = T('payment_status_' + p.status) || p.status;
           const amt = p.amount_subunit != null ? `${p.amount_subunit.toLocaleString()} ${esc(p.currency || 'TWD')}` : '—';
           const when = p.created_at ? formatRelative(p.created_at) : '';
           return `<div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#0a0a10] border border-[#2a2a35] text-xs">
             <span class="text-gray-400">#${p.id} · ${esc(p.vendor)}</span>
             <span class="text-white font-mono">${amt}</span>
             <span class="px-2 py-0.5 rounded-full text-xs font-semibold border ${cls}">${esc(lbl)}</span>
           </div>`;
         }).join('')}</div></div>`;
  const delBtn = row.status === 'revoked'
    ? `<button id="req-perm-del-btn" data-armed="0" data-req-id="${row.id}"
         class="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-xs font-semibold transition-all">永久刪除</button>`
    : '';
  const modal = document.createElement('div');
  modal.id = 'req-detail-modal';
  modal.className = 'fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4';
  modal.innerHTML = `
    <div class="relative w-full max-w-md rounded-2xl bg-[#0f0f14] border border-[#2a2a35] p-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-base font-semibold text-white">需求單 #${row.id}</h3>
        <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}">${s.text}</span>
      </div>
      <div class="space-y-2">${rowsHtml}</div>
      ${msgHtml}
      ${payHtml}
      <p class="text-xs text-gray-500 mt-3">建立時間 ${date}</p>
      <div class="flex justify-end gap-2 mt-4">
        ${delBtn}
        <button data-action="req-detail-close"
          class="px-3 py-1.5 rounded-lg bg-[#1a1a22] hover:bg-[#23232c] border border-[#2a2a35] text-gray-300 text-xs transition-all">關閉</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) closeRequisitionDetail(); });
}
function closeRequisitionDetail() {
  document.getElementById('req-detail-modal')?.remove();
}
let _reqPermDelTimer = null;
async function armOrConfirmReqPermDelete(id) {
  const btn = document.getElementById('req-perm-del-btn');
  if (!btn) return;
  if (btn.dataset.armed === '1') {
    if (_reqPermDelTimer) { clearTimeout(_reqPermDelTimer); _reqPermDelTimer = null; }
    btn.disabled = true; btn.textContent = '刪除中…';
    try {
      await apiFetch(`/api/requisition/${id}`, { method: 'DELETE' });
      closeRequisitionDetail();
      showBindToast(`需求單 #${id} 已永久刪除`, 'ok');
      loadRequisitions();
    } catch (e) {
      showBindToast(tApiError(e, T('net_err')), 'err');
      btn.disabled = false; btn.textContent = '永久刪除'; btn.dataset.armed = '0';
    }
    return;
  }
  btn.dataset.armed = '1';
  btn.textContent = '確認永久刪除';
  btn.className = 'px-3 py-1.5 rounded-lg bg-red-500/40 hover:bg-red-500/50 border border-red-500/60 text-red-100 text-xs font-semibold transition-all';
  _reqPermDelTimer = setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.armed = '0';
    btn.textContent = '永久刪除';
    btn.className = 'px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-xs font-semibold transition-all';
  }, 4000);
}

// ── List 上直接刪 revoked 需求單（兩段式）──
let _reqListDelTimer = null;
async function armOrConfirmReqListDelete(id) {
  const btn = document.getElementById(`reqdel-btn-${id}`);
  if (!btn) return;
  if (btn.dataset.armed === '1') {
    if (_reqListDelTimer) { clearTimeout(_reqListDelTimer); _reqListDelTimer = null; }
    btn.disabled = true; btn.textContent = '刪除中…';
    try {
      await apiFetch(`/api/requisition/${id}`, { method: 'DELETE' });
      showBindToast(`需求單 #${id} 已永久刪除`, 'ok');
      loadRequisitions();
    } catch (e) {
      showBindToast(tApiError(e, T('net_err')), 'err');
      btn.disabled = false; btn.textContent = '永久刪除'; btn.dataset.armed = '0';
    }
    return;
  }
  document.querySelectorAll('[data-req-del-id]').forEach(b => {
    if (b !== btn && b.dataset.armed === '1') {
      b.dataset.armed = '0';
      b.textContent = '永久刪除';
      b.className = 'px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all';
    }
  });
  btn.dataset.armed = '1';
  btn.textContent = '確認刪除';
  btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/30 hover:bg-red-500/40 border border-red-500/50 text-red-200 text-xs font-semibold transition-all';
  if (_reqListDelTimer) clearTimeout(_reqListDelTimer);
  _reqListDelTimer = setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.armed = '0';
    btn.textContent = '永久刪除';
    btn.className = 'px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all';
  }, 4000);
}

// ── Payment intent 申請退款（succeeded → admin 審核退款流程，wave 7/8）──
let _refundReasonIntentId = null;

function setRefundReasonMsg(text, type) {
  const el = document.getElementById('refund-reason-msg');
  if (!el) return;
  if (!text) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.classList.remove('hidden');
  el.textContent = text;
  el.className = 'text-xs mt-2 ' + (type === 'err' ? 'text-red-400' : type === 'ok' ? 'text-emerald-400' : 'text-gray-500');
}

function openRefundReasonModal(intentId) {
  const p = (window._lastPayments || []).find(x => x.id === intentId);
  if (!p) return;
  _refundReasonIntentId = intentId;
  const amt = p.amount_subunit != null
    ? `${p.amount_subunit.toLocaleString()} ${esc(p.currency || 'TWD')}`
    : (p.amount_raw ? `${esc(p.amount_raw)} ${esc(p.currency || '')}` : '—');
  document.getElementById('refund-reason-summary').textContent =
    `對充值 #${p.id}（${amt}）申請退款。Admin 審核通過後會原路退款，動作不可逆。`;
  document.getElementById('refund-reason-input').value = '';
  setRefundReasonMsg('', '');
  document.getElementById('refund-reason-submit').disabled = false;
  document.getElementById('refund-reason-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('refund-reason-input')?.focus(), 50);
}

function closeRefundReasonModal() {
  document.getElementById('refund-reason-modal').classList.add('hidden');
  _refundReasonIntentId = null;
}

async function requestPaymentRefund(intentId) {
  openRefundReasonModal(intentId);
}

document.getElementById('refund-reason-close')?.addEventListener('click', closeRefundReasonModal);
document.getElementById('refund-reason-cancel')?.addEventListener('click', closeRefundReasonModal);
document.getElementById('refund-reason-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closeRefundReasonModal();
});
document.getElementById('refund-reason-submit')?.addEventListener('click', async () => {
  const id = _refundReasonIntentId;
  if (!id) return;
  const reason = document.getElementById('refund-reason-input').value.trim();
  if (!reason) { setRefundReasonMsg('請填寫退款原因', 'err'); return; }
  const btn = document.getElementById('refund-reason-submit');
  btn.disabled = true;
  setRefundReasonMsg('送出中…', '');
  try {
    const r = await apiFetch(`/api/payments/intents/${id}/refund-request`, {
      method: 'POST',
      body:   JSON.stringify({ reason }),
    });
    setRefundReasonMsg('✓ 已送出，等候 admin 審核', 'ok');
    setTimeout(() => {
      closeRefundReasonModal();
      showBindToast(r?.requisition_id
        ? '退款申請已送出（已關聯需求單）'
        : '退款申請已送出，等候 admin 審核', 'ok');
      loadPayments();
      if (r?.requisition_id) loadRequisitions();
    }, 700);
  } catch (e) {
    btn.disabled = false;
    if (e?.code === 'REFUND_ALREADY_PENDING') {
      setRefundReasonMsg('此筆充值已申請退款，請等候 admin 審核', 'err');
      setTimeout(() => { closeRefundReasonModal(); loadPayments(); }, 1200);
      return;
    }
    setRefundReasonMsg(tApiError(e, T('net_err')), 'err');
  }
});

// ── Payment intent 兩段式刪除 ──
let _payDelTimer = null;
async function armOrConfirmPayDelete(id) {
  const btn = document.querySelector(`[data-pay-del-id="${id}"]`);
  if (!btn) return;
  if (btn.dataset.armed === '1') {
    if (_payDelTimer) { clearTimeout(_payDelTimer); _payDelTimer = null; }
    btn.disabled = true; btn.textContent = '刪除中…';
    try {
      await apiFetch(`/api/auth/payments/intents/${id}`, { method: 'DELETE' });
      showBindToast(`充值 #${id} 已刪除`, 'ok');
      loadPayments();
    } catch (e) {
      showBindToast(tApiError(e, T('net_err')), 'err');
      btn.disabled = false; btn.textContent = '刪除'; btn.dataset.armed = '0';
    }
    return;
  }
  // disarm 其他 pay-del 按鈕
  document.querySelectorAll('[data-pay-del-id]').forEach(b => {
    if (b !== btn && b.dataset.armed === '1') {
      b.dataset.armed = '0';
      b.textContent = '刪除';
      b.className = 'shrink-0 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs transition-all';
    }
  });
  btn.dataset.armed = '1';
  btn.textContent = '確認刪除';
  btn.className = 'shrink-0 px-2 py-1 rounded-md bg-red-500/30 hover:bg-red-500/40 border border-red-500/50 text-red-200 text-xs font-semibold transition-all';
  if (_payDelTimer) clearTimeout(_payDelTimer);
  _payDelTimer = setTimeout(() => {
    if (!btn.isConnected) return;
    btn.dataset.armed = '0';
    btn.textContent = '刪除';
    btn.className = 'shrink-0 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs transition-all';
  }, 4000);
}

// ── 綁定結果 URL 參數處理（OAuth callback 跳回後顯示 Toast）───
;(function checkBindResult() {
  const sp = new URLSearchParams(location.search);
  const bindOk    = sp.get('bind');
  const bindError = sp.get('bind_error');
  const provider  = sp.get('provider') ?? '';
  if (!bindOk && !bindError) return;
  history.replaceState(null, '', '/dashboard.html');
  const ERR_KEY = {
    already_linked:  'bind_err_already',
    identity_taken:  'bind_err_taken',
    invalid_state:   'bind_err_state',
    account_invalid: 'bind_err_account',
  };
  setTimeout(() => {
    if (bindOk === 'success') {
      showBindToast(T('bind_success').replace('${p}', provider || ''), 'ok');
    } else {
      showBindToast(T(ERR_KEY[bindError] ?? 'bind_fail'), 'err');
    }
  }, 600);
})();

// ── 帳號綁定 ─────────────────────────────────────────────────

const BIND_PROVIDERS = [
  { id: 'google',   label: 'Google',   color: '#ea4335' },
  { id: 'discord',  label: 'Discord',  color: '#5865F2' },
  { id: 'line',     label: 'LINE',     color: '#06c755' },
  { id: 'facebook', label: 'Facebook', color: '#1877f2' },
];

function renderBindingSection(identities) {
  const linkedSet = new Set((identities ?? []).map(i => i.provider));
  const list = document.getElementById('bind-list');
  list.innerHTML = BIND_PROVIDERS.map(({ id, label, color }) => {
    const linked      = linkedSet.has(id);
    const identity    = (identities ?? []).find(i => i.provider === id);
    const displayName = identity?.display_name ?? '';
    const dot         = `<span class="inline-block w-2 h-2 rounded-full mr-2 bind-dot" data-provider="${id}"></span>`;
    return `
      <div class="flex items-center justify-between px-5 py-3.5">
        <div class="flex items-center gap-2 min-w-0">
          ${dot}
          <span class="text-sm font-medium text-white">${label}</span>
          ${linked && displayName
            ? `<span class="text-xs text-gray-500 truncate max-w-[120px]">${esc(displayName)}</span>`
            : ''}
        </div>
        ${linked
          ? `<button id="unbind-btn-${id}" data-unbind="${id}" data-i18n="unbind_btn"
               class="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
               ${T('unbind_btn')}
             </button>`
          : `<button id="bind-btn-${id}" data-bind="${id}" data-i18n="bind_btn"
               class="shrink-0 px-3 py-1.5 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 text-brand-400 text-xs font-semibold transition-all">
               ${T('bind_btn')}
             </button>`
        }
      </div>`;
  }).join('');
  document.getElementById('bind-section').classList.remove('hidden');
}

async function bindProvider(provider) {
  const btn = document.getElementById(`bind-btn-${provider}`);
  if (btn) { btn.disabled = true; btn.textContent = T('btn_loading'); }
  try {
    const data = await apiFetch(`/api/auth/oauth/${provider}/init?is_binding=true`);
    if (!data?.redirect_url) {
      showBindToast(T('bind_fail'), 'err');
      if (btn) { btn.disabled = false; btn.textContent = T('bind_btn'); }
      return;
    }
    window.location.href = data.redirect_url;
  } catch (e) {
    showBindToast(tApiError(e, T('net_err')), 'err');
    if (btn) { btn.disabled = false; btn.textContent = T('bind_btn'); }
  }
}

async function unbindProvider(provider) {
  const btn = document.getElementById(`unbind-btn-${provider}`);
  if (btn) { btn.disabled = true; btn.textContent = T('btn_loading'); }
  try {
    await apiFetch('/api/auth/identity/unbind', {
      method: 'POST',
      body:   JSON.stringify({ provider }),
    });
    showBindToast(T('unbind_success').replace('${p}', provider), 'ok');
    loadProfile();
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const msg = e.traceId ? `${T('unbind_last_method')}（#${e.traceId}）` : T('unbind_last_method');
      showBindToast(msg, 'warn');
    } else {
      showBindToast(tApiError(e, T('net_err')), 'err');
    }
    if (btn) { btn.disabled = false; btn.textContent = T('unbind_btn'); }
  }
}

let _toastTimer;
function showBindToast(msg, type) {
  const el = document.getElementById('bind-toast');
  el.textContent = msg;
  el.className = [
    'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl whitespace-nowrap pointer-events-none',
    type === 'ok'   ? 'bg-green-500/20 text-green-300 border border-green-500/30' :
    type === 'warn' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                      'bg-red-500/20 text-red-300 border border-red-500/30',
  ].join(' ');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className += ' opacity-0'; }, 3200);
}

// ── 2FA 管理 ─────────────────────────────────────────────────

function render2FASection(enabled, hasPw) {
  document.getElementById('tfa-section').classList.remove('hidden');
  const badge      = document.getElementById('tfa-badge');
  const text       = document.getElementById('tfa-status-text');
  const enableBtn  = document.getElementById('tfa-enable-btn');
  const enableLbl  = document.getElementById('tfa-enable-label');
  const disableBtn = document.getElementById('tfa-disable-btn');
  const needPw     = document.getElementById('tfa-need-pw');
  badge.dataset.tfaState = enabled ? 'on' : 'off';
  if (enabled) {
    badge.textContent  = T('tfa_badge_on');
    badge.className    = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-300 border border-green-500/20';
    text.textContent   = T('tfa_text_on');
    enableBtn.classList.add('hidden');
    disableBtn.classList.remove('hidden');
    needPw.classList.add('hidden');
  } else {
    badge.textContent  = T('tfa_badge_off');
    badge.className    = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-500/15 text-gray-400 border border-gray-500/20';
    text.textContent   = T('tfa_text_off');
    enableBtn.classList.remove('hidden');
    disableBtn.classList.add('hidden');
    if (hasPw) {
      enableBtn.disabled    = false;
      enableLbl.textContent = T('tfa_enable_btn');
      needPw.classList.add('hidden');
    } else {
      enableBtn.disabled    = true;
      enableLbl.textContent = T('tfa_need_pw_local');
      needPw.classList.remove('hidden');
    }
  }
  document.getElementById('tfa-setup-panel').classList.add('hidden');
  document.getElementById('tfa-disable-panel').classList.add('hidden');
  document.getElementById('tfa-backup-panel').classList.add('hidden');
}

async function startSetup2FA() {
  const btn = document.getElementById('tfa-enable-btn');
  btn.disabled = true; btn.querySelector('[data-i18n]').textContent = T('btn_loading');
  try {
    const data = await apiFetch('/api/auth/2fa/setup', { method: 'POST', body: '{}' });
    document.getElementById('tfa-secret').textContent = data.secret;
    await QRCode.toCanvas(document.getElementById('tfa-qr'), data.otpauth_uri, { width: 180, margin: 1 });
    document.getElementById('tfa-setup-panel').classList.remove('hidden');
    document.getElementById('tfa-otp-input').value = '';
    const pwEl = document.getElementById('tfa-password-input');
    if (pwEl) pwEl.value = '';
    document.getElementById('tfa-setup-msg').classList.add('hidden');
  } catch (e) {
    alert(tApiError(e, T('net_err')));
  }
  btn.disabled = false; btn.querySelector('[data-i18n]').textContent = T('tfa_enable_btn');
}

async function confirmEnable2FA() {
  const otp = document.getElementById('tfa-otp-input').value.trim();
  const pw  = (document.getElementById('tfa-password-input')?.value ?? '');
  const msg = document.getElementById('tfa-setup-msg');
  if (!/^\d{6}$/.test(otp)) { showTfaMsg(msg, T('totp_err6'), 'err'); return; }
  if (!pw) { showTfaMsg(msg, T('tfa_pw_required') || '請輸入目前登入密碼', 'err'); return; }
  try {
    const data = await apiFetch('/api/auth/2fa/activate', {
      method: 'POST',
      body:   JSON.stringify({ otp_code: otp, current_password: pw }),
    });
    const codesEl = document.getElementById('tfa-backup-codes');
    codesEl.innerHTML = data.backup_codes.map(c =>
      `<code class="block text-center text-xs font-mono bg-[#0e0e12] border border-[#2a2a35] rounded-lg px-2 py-1.5 text-gray-300 select-all">${c}</code>`
    ).join('');
    render2FASection(true);
    window.__totpEnabled = true;
    document.getElementById('tfa-setup-panel').classList.add('hidden');
    document.getElementById('tfa-backup-panel').classList.remove('hidden');
  } catch (e) {
    showTfaMsg(msg, tApiError(e, T('net_err')), 'err');
  }
}

function closeTfaBackup() {
  document.getElementById('tfa-backup-panel').classList.add('hidden');
}

function showDisablePanel() {
  document.getElementById('tfa-setup-panel').classList.add('hidden');
  document.getElementById('tfa-disable-panel').classList.toggle('hidden');
  document.getElementById('tfa-disable-input').value = '';
  document.getElementById('tfa-disable-msg').classList.add('hidden');
}

async function confirmDisable2FA() {
  const otp = document.getElementById('tfa-disable-input').value.trim();
  const msg = document.getElementById('tfa-disable-msg');
  if (!/^\d{6}$/.test(otp)) { showTfaMsg(msg, T('totp_err6'), 'err'); return; }
  try {
    await apiFetch('/api/auth/2fa/disable', {
      method: 'POST',
      body:   JSON.stringify({ otp_code: otp }),
    });
    // disable.js 後端會 bumpTokenVersion 撤所有 token；後續 API 必 401。
    // 顯示 success 訊息 + 清 sessionStorage + broadcast logout（同步其他分頁），
    // 再跳 login.html，由 login.js 接 ?tfa_disabled=1 顯示提示。
    showTfaMsg(msg, T('disable_success'), 'ok');
    try { sessionStorage.removeItem('access_token'); } catch (_) {}
    try {
      if ('BroadcastChannel' in window) {
        new BroadcastChannel('chiyigo-auth').postMessage({ type: 'logout' });
      }
    } catch (_) {}
    setTimeout(() => { location.replace('/login.html?tfa_disabled=1'); }, 1500);
  } catch (e) {
    showTfaMsg(msg, tApiError(e, T('net_err')), 'err');
  }
}

function showTfaMsg(el, text, type) {
  el.textContent = text;
  el.className   = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
}

async function sendVerification() {
  const btn = document.getElementById('resend-btn');
  if (!sessionStorage.getItem('access_token')) { window.location.href = '/login.html'; return; }

  btn.disabled = true;
  btn.querySelector('[data-i18n]').textContent = T('btn_sending');
  document.getElementById('resend-msg').className = 'hidden text-xs mt-2';

  try {
    await apiFetch('/api/auth/email/send-verification', { method: 'POST', body: '{}' });
    showResendMsg(T('resend_sent'), 'ok');
    startResendCooldown(60);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      // email 已驗證，重新載入資料更新 UI
      loadProfile();
      return;
    }
    if (e instanceof ApiError && e.status === 429) {
      const wait = e.body?.retry_after ?? 60;
      showResendMsg(T('resend_wait'), 'warn');
      startResendCooldown(wait);
      return;
    }
    showResendMsg(tApiError(e, T('net_err')), 'err');
    btn.disabled = false;
    btn.querySelector('[data-i18n]').textContent = T('resend_btn');
  }
}

function showResendMsg(text, type) {
  const msg = document.getElementById('resend-msg');
  msg.textContent = text;
  msg.className = 'text-xs mt-2 ' + (type === 'ok' ? 'text-green-400' : type === 'warn' ? 'text-amber-400' : 'text-red-400');
}

function startResendCooldown(seconds) {
  const btn = document.getElementById('resend-btn');
  const span = btn.querySelector('[data-i18n]');
  let remaining = seconds;
  btn.disabled = true;
  span.textContent = T('resend_timer_label').replace('${s}', remaining);
  const iv = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(iv);
      btn.disabled = false;
      span.textContent = T('resend_btn');
    } else {
      span.textContent = T('resend_timer_label').replace('${s}', remaining);
    }
  }, 1000);
}

// pagehide：頁面進入 bfcache 前重置 UI，確保還原時顯示 spinner 而非舊資料。
window.addEventListener('pagehide', () => {
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('user-card').classList.add('hidden');
  document.getElementById('error-card').classList.add('hidden');
});

// pageshow：bfcache 還原後重新驗證；pagehide 已重置 UI 所以無閃爍。
window.addEventListener('pageshow', (event) => {
  if (!event.persisted) return;
  if (!sessionStorage.getItem('access_token')) {
    window.location.replace('/login.html');
  } else {
    loadProfile();
  }
});

// ── 主題切換（與 login.html 對齊：localStorage key='theme', value='dark'|'light'）
(function initTheme() {
  const root = document.documentElement;
  function apply(isDark) {
    root.classList.toggle('theme-dark',  isDark);
    root.classList.toggle('theme-light', !isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }
  const btn = document.getElementById('db-theme-btn');
  if (btn) btn.addEventListener('click', () => {
    apply(!root.classList.contains('theme-dark'));
  });
})();

// ── 設定登入密碼（OAuth-only）────────────────────────────
function renderSetPasswordSection(hasPw) {
  const sec = document.getElementById('setpw-section');
  if (!sec) return;
  sec.classList.toggle('hidden', !!hasPw);
}
async function sendSetPasswordEmail() {
  const btn = document.getElementById('setpw-btn');
  const msg = document.getElementById('setpw-msg');
  msg.classList.add('hidden');
  msg.textContent = '';
  btn.disabled = true;
  try {
    await apiFetch('/api/auth/local/forgot-password', {
      method: 'POST',
      body:   JSON.stringify({ email: window.__userEmail }),
    });
    msg.innerHTML = T('setpw_sent').replace('${email}', esc(window.__userEmail));
    msg.className = 'text-xs text-emerald-400';
    msg.classList.remove('hidden');
    // 60 秒冷卻保護
    setTimeout(() => { btn.disabled = false; }, 60000);
  } catch (e) {
    msg.textContent = tApiError(e, T('net_err'));
    msg.className = 'text-xs text-red-400';
    msg.classList.remove('hidden');
    btn.disabled = false;
  }
}

// ── 修改密碼（in-session，走 step-up flow）──────────────
function renderChangePasswordSection(hasPw, totpEnabled) {
  const sec = document.getElementById('changepw-section');
  if (!sec) return;
  sec.classList.toggle('hidden', !hasPw);

  // OAuth-only（無密碼）使用者點「修改密碼」nav → 動態改 data-scroll 指向 setpw-section
  // 引導他們先「設定密碼」。一般有密碼帳號則照常指向 changepw-section。
  const navTarget = hasPw ? 'changepw-section' : 'setpw-section'
  const sbBtn = document.getElementById('sb-nav-changepw')
  const mBtn  = document.getElementById('m-ov-changepw')
  if (sbBtn) sbBtn.dataset.scroll = navTarget
  if (mBtn)  mBtn.dataset.scroll  = navTarget

  const need2faHint = document.getElementById('changepw-need-2fa');
  const form        = document.getElementById('changepw-form');
  if (!need2faHint || !form) return;
  // 沒 2FA → 顯示提示，隱藏表單（step-up 必走 OTP）
  need2faHint.classList.toggle('hidden', !!totpEnabled);
  form.classList.toggle('hidden', !totpEnabled);
}

async function submitChangePassword() {
  const newEl     = document.getElementById('changepw-new');
  const confirmEl = document.getElementById('changepw-confirm');
  const otpEl     = document.getElementById('changepw-otp');
  const msg       = document.getElementById('changepw-msg');
  const btn       = document.getElementById('changepw-submit');

  const newPw   = newEl.value;
  const confirm = confirmEl.value;
  const otp     = otpEl.value.trim();

  function showMsg(text, type) {
    msg.textContent = text;
    msg.className   = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
    msg.classList.remove('hidden');
  }

  if (!newPw || !confirm) { showMsg(T('net_err'), 'err'); return; }
  if (newPw !== confirm)  { showMsg(T('changepw_mismatch'), 'err'); return; }
  if (!/^\d{6}$/.test(otp)) { showMsg(T('totp_err6'), 'err'); return; }

  btn.disabled = true;
  msg.classList.add('hidden');

  try {
    // 1) step-up：拿 5min 短效 step_up_token
    const stepRes = await apiFetch('/api/auth/step-up', {
      method: 'POST',
      body:   JSON.stringify({
        scope: 'elevated:account',
        for_action: 'change_password',
        otp_code: otp,
      }),
    });
    const stepUpToken = stepRes?.step_up_token;
    if (!stepUpToken) { showMsg(T('net_err'), 'err'); btn.disabled = false; return; }

    // 2) change-password：用 step_up_token 換密碼
    await apiFetch('/api/auth/account/change-password', {
      method:  'POST',
      headers: { Authorization: 'Bearer ' + stepUpToken },
      body:    JSON.stringify({ new_password: newPw }),
    });

    // 成功 → 同 2FA disable UX：顯示成功訊息 → 清 token + 廣播 → 跳 login
    showMsg(T('changepw_success'), 'ok');
    try { sessionStorage.removeItem('access_token'); } catch (_) {}
    try {
      if ('BroadcastChannel' in window) {
        new BroadcastChannel('chiyigo-auth').postMessage({ type: 'logout' });
      }
    } catch (_) {}
    setTimeout(() => { location.replace('/login.html?password_reset=1'); }, 1500);
  } catch (e) {
    btn.disabled = false;
    showMsg(tApiError(e, T('net_err')), 'err');
  }
}

// ── 刪除帳號 ─────────────────────────────────────────────
function renderDeleteSection(hasPw) {
  const btn   = document.getElementById('del-open-btn');
  const label = document.getElementById('del-open-label');
  const hint  = document.getElementById('del-need-pw');
  if (!btn) return;
  if (hasPw) {
    btn.disabled = false;
    label.textContent = T('del_open_btn');
    hint.classList.add('hidden');
  } else {
    btn.disabled = true;
    label.textContent = T('del_need_pw_local');
    hint.classList.remove('hidden');
  }
}
function showDeleteForm() {
  if (!window.__hasPassword) return;
  document.getElementById('del-stage1').classList.add('hidden');
  document.getElementById('del-stage2').classList.remove('hidden');
  document.getElementById('del-password').focus();
}
function hideDeleteForm() {
  document.getElementById('del-stage2').classList.add('hidden');
  document.getElementById('del-stage1').classList.remove('hidden');
  document.getElementById('del-password').value = '';
  const msg = document.getElementById('del-msg');
  msg.classList.add('hidden');
  msg.textContent = '';
}
// 後端錯誤訊息（英文）→ i18n key
const DEL_ERR_MAP = {
  'Incorrect password':                                                 'del_err_pw',
  'Account not found':                                                  'del_err_account',
  'Too many requests. Please try again later.':                         'del_err_rate',
  'Please wait before requesting another confirmation email':           'del_err_cooldown',
  'Failed to send confirmation email, please try again later':          'del_err_send',
  'password is required':                                               'del_pw_required',
  'Unauthorized':                                                       'del_err_unauth',
};
async function submitDeleteAccount() {
  const pw   = document.getElementById('del-password').value;
  const msg  = document.getElementById('del-msg');
  const btn  = document.getElementById('del-submit-btn');
  msg.classList.add('hidden');
  msg.textContent = '';
  if (!pw) {
    msg.textContent = T('del_pw_required');
    msg.className = 'text-xs text-red-400';
    msg.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  try {
    await apiFetch('/api/auth/delete', {
      method: 'POST',
      body:   JSON.stringify({ password: pw }),
    });
    msg.innerHTML = T('del_sent');
    msg.className = 'text-xs text-emerald-400';
    msg.classList.remove('hidden');
    document.getElementById('del-password').value = '';
  } catch (e) {
    if (e instanceof ApiError && e.status > 0) {
      // 先試 delete 專用映射，再退回全域 BACKEND_ERR_MAP
      const k = DEL_ERR_MAP[e.body?.error] || BACKEND_ERR_MAP[e.body?.error];
      const base = k ? T(k) : T('del_err_generic').replace('${status}', e.status);
      msg.textContent = e.traceId ? `${base}（#${e.traceId}）` : base;
      console.warn('[delete-account]', e.status, e.body, 'traceId=', e.traceId);
    } else {
      msg.textContent = T('net_err');
    }
    msg.className = 'text-xs text-red-400';
    msg.classList.remove('hidden');
    btn.disabled = false;
  }
}

// ── block 2/3 ──
// Sidebar / mobile-overlay nav: scroll to section + active state
(function() {
  const sbItems = document.querySelectorAll('.sb-item[data-scroll], .m-ov-item[data-scroll]');
  sbItems.forEach(btn => btn.addEventListener('click', () => {
    const id = btn.dataset.scroll;
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior:'smooth', block:'start' });
    document.querySelectorAll('.sb-item[data-scroll]').forEach(b => b.classList.toggle('active', b.dataset.scroll === id));
    document.querySelectorAll('.m-ov-item[data-scroll]').forEach(b => b.classList.toggle('active', b.dataset.scroll === id));
  }));
})();

// Mobile overlay open/close
(function() {
  const ham = document.getElementById('m-ham-btn');
  const ov  = document.getElementById('m-overlay');
  const open = () => { ham?.classList.add('is-open'); ham?.setAttribute('aria-expanded','true'); ov?.classList.add('is-open'); ov?.removeAttribute('aria-hidden'); document.body.style.overflow='hidden'; };
  const close = () => { ham?.classList.remove('is-open'); ham?.setAttribute('aria-expanded','false'); ov?.classList.remove('is-open'); ov?.setAttribute('aria-hidden','true'); document.body.style.overflow=''; };
  ham?.addEventListener('click', () => ov?.classList.contains('is-open') ? close() : open());
  ov?.addEventListener('click', e => { if (e.target === ov) close(); });
  ov?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(close, 120)));
  document.addEventListener('keydown', e => { if (e.key==='Escape' && ov?.classList.contains('is-open')) close(); });
})();

// Mobile theme button → proxy to db-theme-btn; mobile lang button → toggle m-top-lang-drop
(function() {
  const mTheme = document.getElementById('m-theme-btn');
  const mLang  = document.getElementById('m-lang-btn');
  const mDrop  = document.getElementById('m-top-lang-drop');
  const dbTheme = document.getElementById('db-theme-btn');
  mTheme?.addEventListener('click', () => dbTheme?.click());
  mLang?.addEventListener('click', e => { e.stopPropagation(); mDrop?.classList.toggle('open'); });
  mDrop?.addEventListener('click', e => {
    const opt = e.target.closest('.db-lang-opt'); if (!opt) return;
    if (typeof applyLangD === 'function') applyLangD(opt.dataset.lang);
    mDrop.classList.remove('open');
  });
  document.addEventListener('click', () => mDrop?.classList.remove('open'));

  // Sync mobile theme icon with theme class
  function syncMTheme() {
    const dark = document.documentElement.classList.contains('theme-dark');
    const sun  = mTheme?.querySelector('.icon-sun');
    const moon = mTheme?.querySelector('.icon-moon');
    if (sun)  sun.hidden = dark;
    if (moon) moon.hidden = !dark;
  }
  syncMTheme();
  new MutationObserver(syncMTheme).observe(document.documentElement, { attributes:true, attributeFilter:['class'] });

  // Mobile overlay lang options
  document.getElementById('m-overlay')?.addEventListener('click', e => {
    const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return;
    if (typeof applyLangD === 'function') applyLangD(opt.dataset.lang);
  });
})();

// Sync setpw nav item visibility with section visibility
(function() {
  const sec = document.getElementById('setpw-section');
  const sbBtn = document.getElementById('sb-nav-setpw');
  const mBtn  = document.getElementById('m-ov-setpw');
  if (!sec) return;
  function sync() {
    const hidden = sec.classList.contains('hidden');
    if (sbBtn) sbBtn.hidden = hidden;
    if (mBtn)  mBtn.hidden  = hidden;
  }
  sync();
  new MutationObserver(sync).observe(sec, { attributes:true, attributeFilter:['class'] });
})();

// changepw nav 永遠顯示（即使 changepw-section 隱藏）—
// 對 OAuth-only user 而言「修改密碼」仍是有意義的入口；
// renderChangePasswordSection 會把 nav 的 data-scroll 動態指向 setpw-section。
// 因此這裡不像 setpw nav 那樣綁定 hidden 狀態。
(function() {
  const sbBtn = document.getElementById('sb-nav-changepw');
  const mBtn  = document.getElementById('m-ov-changepw');
  if (sbBtn) sbBtn.hidden = false;
  if (mBtn)  mBtn.hidden  = false;
})();

// ── block 3/3 ──
(function(){
  const canvas=document.getElementById('neural-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  let W=0,H=0,nodes=[];const DIST=155;
  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
  function initNodes(){const n=W<768?40:90;nodes=Array.from({length:n},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.1+.4,pulse:Math.random()*Math.PI*2}))}
  const mouse={x:-9999,y:-9999};document.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});
  let cfg={r:'108',g:'110',b:'229',no:.22,lo:.09};
  function syncCfg(){const s=getComputedStyle(document.documentElement);cfg={r:s.getPropertyValue('--as-neural-r').trim()||'108',g:s.getPropertyValue('--as-neural-g').trim()||'110',b:s.getPropertyValue('--as-neural-b').trim()||'229',no:parseFloat(s.getPropertyValue('--as-neural-node-opacity').trim()||'.22'),lo:parseFloat(s.getPropertyValue('--as-neural-line-opacity').trim()||'.09')}}
  syncCfg();new MutationObserver(syncCfg).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  function draw(){ctx.clearRect(0,0,W,H);const{r,g,b,no,lo}=cfg;
    for(const n of nodes){const dx=n.x-mouse.x,dy=n.y-mouse.y,d2=dx*dx+dy*dy;if(d2<16900){const d=Math.sqrt(d2);n.vx+=dx/d*.055;n.vy+=dy/d*.055}n.vx*=.982;n.vy*=.982;n.x+=n.vx;n.y+=n.vy;if(n.x<-12)n.x=W+12;else if(n.x>W+12)n.x=-12;if(n.y<-12)n.y=H+12;else if(n.y>H+12)n.y=-12;n.pulse+=.011;const p=Math.sin(n.pulse)*.25+.75;ctx.beginPath();ctx.arc(n.x,n.y,n.r*p,0,Math.PI*2);ctx.fillStyle=`rgba(${r},${g},${b},${no*p})`;ctx.fill()}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d2=dx*dx+dy*dy;if(d2<DIST*DIST){const a=(1-Math.sqrt(d2)/DIST)*lo;ctx.beginPath();ctx.moveTo(nodes[i].x,nodes[i].y);ctx.lineTo(nodes[j].x,nodes[j].y);ctx.strokeStyle=`rgba(${r},${g},${b},${a})`;ctx.lineWidth=.5;ctx.stroke()}}
    requestAnimationFrame(draw)}
  resize();initNodes();draw();window.addEventListener('resize',()=>{resize();initNodes()});
})();

// ── Phase D-3：裝置 + Passkey 區塊 ──────────────────────────

// base64url <-> ArrayBuffer（瀏覽器 WebAuthn ceremony 用，不引入 lib）
function b64urlToBuf(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function formatRelative(iso) {
  if (!iso) return '—';
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(t.getTime())) return iso;
  const diffMs = Date.now() - t.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1)  return curLangD === 'zh-TW' ? '剛剛'    : curLangD === 'ja' ? 'たった今' : curLangD === 'ko' ? '방금'    : 'just now';
  if (min < 60) return curLangD === 'zh-TW' ? `${min} 分鐘前` : curLangD === 'ja' ? `${min}分前`  : curLangD === 'ko' ? `${min}분 전` : `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24)  return curLangD === 'zh-TW' ? `${hr} 小時前` : curLangD === 'ja' ? `${hr}時間前` : curLangD === 'ko' ? `${hr}시간 전`: `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return curLangD === 'zh-TW' ? `${day} 天前`  : curLangD === 'ja' ? `${day}日前`  : curLangD === 'ko' ? `${day}일 전` : `${day}d ago`;
  return formatDate(iso);
}

async function loadDevices() {
  const sec  = document.getElementById('devices-section');
  const list = document.getElementById('devices-list');
  if (!sec || !list) return;
  sec.classList.remove('hidden');
  try {
    const { devices } = await apiFetch('/api/auth/devices');
    window._lastDevices = devices ?? [];
    renderDevices(window._lastDevices);
  } catch (e) {
    list.innerHTML = `<p class="text-xs text-red-400">${esc(tApiError(e, T('net_err')))}</p>`;
  }
}

function renderDevices(devices) {
  const list = document.getElementById('devices-list');
  if (!list) return;
  if (!devices.length) {
    list.innerHTML = `<p class="text-xs text-gray-500">${T('devices_empty')}</p>`;
    return;
  }
  list.innerHTML = devices.map(d => {
    const isWeb = d.device_uuid === null || d.device_uuid === undefined;
    const label = isWeb ? T('device_label_web') : `${T('device_label_app')} · ${esc(String(d.device_uuid).slice(0, 8))}`;
    const last  = formatRelative(d.last_seen);
    const dataAttr = isWeb ? 'data-device-uuid=""' : `data-device-uuid="${esc(d.device_uuid)}"`;
    return `
      <div class="rounded-xl bg-[#0e0e16] border border-[#2a2a35] px-4 py-3 flex items-center justify-between gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-white truncate">${label}</p>
          <p class="text-xs text-gray-500 mt-0.5">${T('device_last_seen_label')}：${esc(last)} · ${d.active_count} ${T('device_active_label')}</p>
        </div>
        <button type="button" data-action="logout-device" ${dataAttr}
          class="shrink-0 px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/5 hover:bg-red-500/10 text-red-300 text-xs font-semibold transition-all">
          ${T('device_logout_btn')}
        </button>
      </div>`;
  }).join('');
}

async function logoutDevice(deviceUuidAttr) {
  const isWeb = deviceUuidAttr === '';
  const device_uuid = isWeb ? null : deviceUuidAttr;
  try {
    await apiFetch('/api/auth/devices/logout', {
      method: 'POST',
      body:   JSON.stringify({ device_uuid }),
    });
    showBindToast(T('device_logout_success'), 'ok');
    if (isWeb) {
      // 撤的就是當下 web session → 自己也清掉
      try { sessionStorage.removeItem('access_token'); } catch (_) {}
      try { if ('BroadcastChannel' in window) new BroadcastChannel('chiyigo-auth').postMessage({ type: 'logout' }); } catch (_) {}
      setTimeout(() => { location.replace('/login.html?logout=device'); }, 800);
      return;
    }
    loadDevices();
  } catch (e) {
    showBindToast(tApiError(e, T('net_err')), 'err');
  }
}

function passkeySupported() {
  return typeof window.PublicKeyCredential === 'function' && window.isSecureContext !== false;
}

async function loadPasskeys() {
  const sec  = document.getElementById('passkeys-section');
  const list = document.getElementById('passkeys-list');
  const unsup = document.getElementById('passkey-unsupported');
  const addBtn = document.getElementById('passkey-add-btn');
  if (!sec || !list) return;
  sec.classList.remove('hidden');

  if (!passkeySupported()) {
    if (unsup) unsup.classList.remove('hidden');
    if (addBtn) addBtn.disabled = true;
  }

  try {
    const { credentials } = await apiFetch('/api/auth/webauthn/credentials');
    window._lastPasskeys = credentials ?? [];
    renderPasskeys(window._lastPasskeys);
  } catch (e) {
    list.innerHTML = `<p class="text-xs text-red-400">${esc(tApiError(e, T('net_err')))}</p>`;
  }
}

function renderPasskeys(creds) {
  const list = document.getElementById('passkeys-list');
  if (!list) return;
  if (!creds.length) {
    list.innerHTML = `<p class="text-xs text-gray-500">${T('passkeys_empty')}</p>`;
    return;
  }
  list.innerHTML = creds.map(c => {
    const nickname = c.nickname || T('passkey_default_nickname');
    const lastUsed = c.last_used_at ? formatRelative(c.last_used_at) : T('passkey_never_used');
    const transports = (c.transports ?? []).join(', ') || '—';
    return `
      <div id="pk-row-${c.id}" class="rounded-xl bg-[#0e0e16] border border-[#2a2a35] px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-white truncate" id="pk-nickname-${c.id}">${esc(nickname)}</p>
            <p class="text-xs text-gray-500 mt-0.5">${T('passkey_last_used_label')}：${esc(lastUsed)} · ${esc(transports)}</p>
          </div>
          <div class="shrink-0 flex gap-2">
            <button type="button" data-action="passkey-rename-open" data-passkey-id="${c.id}"
              class="px-3 py-1.5 rounded-lg border border-[#2a2a35] hover:bg-[#1f1f28] text-gray-300 text-xs font-semibold transition-all">
              ${T('passkey_rename_btn')}
            </button>
            <button type="button" data-action="passkey-remove-open" data-passkey-id="${c.id}"
              class="px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/5 hover:bg-red-500/10 text-red-300 text-xs font-semibold transition-all">
              ${T('passkey_remove_btn')}
            </button>
          </div>
        </div>
        <div id="pk-rename-${c.id}" class="hidden mt-3 space-y-2">
          <input id="pk-name-${c.id}" type="text" maxlength="64" value="${esc(nickname)}"
            placeholder="${T('passkey_rename_ph')}"
            class="w-full px-3 py-2 rounded-lg bg-[#0e0e12] border border-[#2a2a35] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-violet-500/40" />
          <p id="pk-rename-msg-${c.id}" class="hidden text-xs"></p>
          <div class="flex gap-2">
            <button type="button" data-action="passkey-rename-cancel" data-passkey-id="${c.id}"
              class="flex-1 py-2 rounded-lg border border-[#2a2a35] hover:bg-[#1f1f28] text-gray-400 text-xs font-semibold transition-all">
              ${T('passkey_rename_cancel')}
            </button>
            <button type="button" data-action="passkey-rename-save" data-passkey-id="${c.id}"
              class="flex-1 py-2 rounded-lg border border-violet-500/40 bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              ${T('passkey_rename_save')}
            </button>
          </div>
        </div>
        <div id="pk-remove-${c.id}" class="hidden mt-3 space-y-2">
          <p class="text-xs text-amber-300">${T('passkey_remove_hint')}</p>
          <input id="pk-otp-${c.id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"
            placeholder="${T('passkey_remove_otp_ph')}"
            class="w-full px-3 py-2 rounded-lg bg-[#0e0e12] border border-[#2a2a35] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-red-500/40" />
          <p id="pk-msg-${c.id}" class="hidden text-xs"></p>
          <div class="flex gap-2">
            <button type="button" data-action="passkey-remove-cancel" data-passkey-id="${c.id}"
              class="flex-1 py-2 rounded-lg border border-[#2a2a35] hover:bg-[#1f1f28] text-gray-400 text-xs font-semibold transition-all">
              ${T('passkey_remove_cancel')}
            </button>
            <button type="button" data-action="passkey-remove-confirm" data-passkey-id="${c.id}"
              class="flex-1 py-2 rounded-lg border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              ${T('passkey_remove_confirm')}
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function openPasskeyRename(id) {
  document.getElementById(`pk-remove-${id}`)?.classList.add('hidden');
  document.getElementById(`pk-rename-${id}`)?.classList.remove('hidden');
  const inp = document.getElementById(`pk-name-${id}`);
  if (inp) { inp.focus(); inp.select(); }
}

function cancelPasskeyRename(id) {
  document.getElementById(`pk-rename-${id}`)?.classList.add('hidden');
  document.getElementById(`pk-rename-msg-${id}`)?.classList.add('hidden');
}

async function savePasskeyRename(id) {
  const inp = document.getElementById(`pk-name-${id}`);
  const msg = document.getElementById(`pk-rename-msg-${id}`);
  const btns = document.querySelectorAll(`[data-passkey-id="${id}"]`);
  const showMsg = (text, type) => {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
    msg.classList.remove('hidden');
  };
  const nickname = (inp?.value ?? '').trim();
  if (!nickname) { showMsg(T('passkey_rename_empty'), 'err'); return; }
  btns.forEach(b => { if (b.tagName === 'BUTTON') b.disabled = true; });
  try {
    await apiFetch(`/api/auth/webauthn/credentials/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify({ nickname }),
    });
    if (Array.isArray(window._lastPasskeys)) {
      const idx = window._lastPasskeys.findIndex(c => String(c.id) === String(id));
      if (idx >= 0) window._lastPasskeys[idx] = { ...window._lastPasskeys[idx], nickname };
      renderPasskeys(window._lastPasskeys);
    }
    showBindToast(T('passkey_rename_success'), 'ok');
  } catch (e) {
    btns.forEach(b => { if (b.tagName === 'BUTTON') b.disabled = false; });
    showMsg(tApiError(e, T('passkey_rename_fail')), 'err');
  }
}

function openPasskeyRemove(id) {
  if (!window.__totpEnabled) {
    showBindToast(T('passkey_remove_need_2fa'), 'err');
    const tfa = document.getElementById('tfa-section');
    if (tfa) tfa.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  document.getElementById(`pk-rename-${id}`)?.classList.add('hidden');
  const panel = document.getElementById(`pk-remove-${id}`);
  panel?.classList.remove('hidden');
  document.getElementById(`pk-otp-${id}`)?.focus();
}

function cancelPasskeyRemove(id) {
  document.getElementById(`pk-remove-${id}`)?.classList.add('hidden');
  const otp = document.getElementById(`pk-otp-${id}`);
  if (otp) otp.value = '';
  document.getElementById(`pk-msg-${id}`)?.classList.add('hidden');
}

async function confirmPasskeyRemove(id) {
  const otpEl = document.getElementById(`pk-otp-${id}`);
  const msg   = document.getElementById(`pk-msg-${id}`);
  const btns  = document.querySelectorAll(`[data-passkey-id="${id}"]`);
  const otp   = (otpEl?.value || '').trim();
  const showMsg = (text, type) => {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
    msg.classList.remove('hidden');
  };
  if (!/^\d{6}$/.test(otp)) { showMsg(T('totp_err6'), 'err'); return; }
  btns.forEach(b => { if (b.tagName === 'BUTTON') b.disabled = true; });
  try {
    const stepRes = await apiFetch('/api/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ scope: 'elevated:account', for_action: 'remove_passkey', otp_code: otp }),
    });
    const stepUpToken = stepRes?.step_up_token;
    if (!stepUpToken) { showMsg(T('net_err'), 'err'); btns.forEach(b => { if (b.tagName === 'BUTTON') b.disabled = false; }); return; }
    await apiFetch(`/api/auth/webauthn/credentials/${id}`, {
      method:  'DELETE',
      headers: { Authorization: 'Bearer ' + stepUpToken },
    });
    showBindToast(T('passkey_remove_success'), 'ok');
    loadPasskeys();
  } catch (e) {
    btns.forEach(b => { if (b.tagName === 'BUTTON') b.disabled = false; });
    showMsg(tApiError(e, T('passkey_remove_fail')), 'err');
  }
}

async function addPasskey() {
  if (!passkeySupported()) return;
  const btn = document.getElementById('passkey-add-btn');
  const msg = document.getElementById('passkey-add-msg');
  const showMsg = (text, type) => {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
    msg.classList.remove('hidden');
  };
  if (btn) btn.disabled = true;
  showMsg(T('passkey_adding'), 'ok');
  try {
    const opts = await apiFetch('/api/auth/webauthn/register-options', { method: 'POST', body: '{}' });
    const publicKey = {
      ...opts,
      challenge: b64urlToBuf(opts.challenge),
      user: { ...opts.user, id: b64urlToBuf(opts.user.id) },
      excludeCredentials: (opts.excludeCredentials ?? []).map(c => ({ ...c, id: b64urlToBuf(c.id) })),
    };
    let cred;
    try { cred = await navigator.credentials.create({ publicKey }); }
    catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') showMsg(T('passkey_add_cancelled'), 'err');
      else showMsg(`${T('passkey_add_fail')}：${e?.message ?? e}`, 'err');
      if (btn) btn.disabled = false;
      return;
    }
    const r = cred.response;
    const responseJson = {
      id: cred.id, rawId: bufToB64url(cred.rawId), type: cred.type,
      response: {
        clientDataJSON: bufToB64url(r.clientDataJSON),
        attestationObject: bufToB64url(r.attestationObject),
        transports: typeof r.getTransports === 'function' ? r.getTransports() : [],
      },
      clientExtensionResults: typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {},
      authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    };
    await apiFetch('/api/auth/webauthn/register-verify', {
      method: 'POST',
      body:   JSON.stringify({ response: responseJson, nickname: T('passkey_default_nickname') }),
    });
    showMsg(T('passkey_add_success'), 'ok');
    loadPasskeys();
  } catch (e) {
    showMsg(tApiError(e, T('passkey_add_fail')), 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Phase F-3：錢包綁定（SIWE）──────────────────────────────

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr ?? '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function chainLabel(id) {
  const map = { 1: 'Ethereum', 10: 'Optimism', 137: 'Polygon', 8453: 'Base', 42161: 'Arbitrum' };
  return map[id] ?? `Chain ${id}`;
}

function walletProvider() {
  // 偵測 EIP-1193 provider；MetaMask / Rabby / Coinbase Wallet 等都注入到 window.ethereum
  return typeof window !== 'undefined' && window.ethereum ? window.ethereum : null;
}

async function loadWallets() {
  const sec    = document.getElementById('wallets-section');
  const list   = document.getElementById('wallets-list');
  const unsup  = document.getElementById('wallet-unsupported');
  const addBtn = document.getElementById('wallet-add-btn');
  if (!sec || !list) return;
  sec.classList.remove('hidden');

  if (!walletProvider()) {
    if (unsup) unsup.classList.remove('hidden');
    if (addBtn) addBtn.disabled = true;
  }

  try {
    const { wallets } = await apiFetch('/api/auth/wallet');
    window._lastWallets = wallets ?? [];
    renderWallets(window._lastWallets);
  } catch (e) {
    list.innerHTML = `<p class="text-xs text-red-400">${esc(tApiError(e, T('net_err')))}</p>`;
  }
}

function renderWallets(wallets) {
  const list = document.getElementById('wallets-list');
  if (!list) return;
  if (!wallets.length) {
    list.innerHTML = `<p class="text-xs text-gray-500">${T('wallets_empty')}</p>`;
    return;
  }
  list.innerHTML = wallets.map(w => {
    const display = w.nickname ? `${esc(w.nickname)} · ${esc(shortAddr(w.address))}` : esc(w.address);
    const signedAt = w.signed_at ? formatRelative(w.signed_at) : '—';
    return `
      <div id="wl-row-${w.id}" class="rounded-xl bg-[#0e0e16] border border-[#2a2a35] px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-white truncate font-mono">${display}</p>
            <p class="text-xs text-gray-500 mt-0.5">${esc(chainLabel(w.chain_id))} · ${T('wallet_signed_at_label')}：${esc(signedAt)}</p>
          </div>
          <button type="button" data-action="wallet-remove-open" data-wallet-id="${w.id}"
            class="shrink-0 px-3 py-1.5 rounded-lg border border-red-500/25 bg-red-500/5 hover:bg-red-500/10 text-red-300 text-xs font-semibold transition-all">
            ${T('wallet_remove_btn')}
          </button>
        </div>
        <div id="wl-remove-${w.id}" class="hidden mt-3 space-y-2">
          <p class="text-xs text-amber-300">${T('wallet_remove_hint')}</p>
          <input id="wl-otp-${w.id}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"
            placeholder="${T('wallet_remove_otp_ph')}"
            class="w-full px-3 py-2 rounded-lg bg-[#0e0e12] border border-[#2a2a35] text-white text-sm placeholder-gray-500 focus:outline-none focus:border-red-500/40" />
          <p id="wl-msg-${w.id}" class="hidden text-xs"></p>
          <div class="flex gap-2">
            <button type="button" data-action="wallet-remove-cancel" data-wallet-id="${w.id}"
              class="flex-1 py-2 rounded-lg border border-[#2a2a35] hover:bg-[#1f1f28] text-gray-400 text-xs font-semibold transition-all">
              ${T('wallet_remove_cancel')}
            </button>
            <button type="button" data-action="wallet-remove-confirm" data-wallet-id="${w.id}"
              class="flex-1 py-2 rounded-lg border border-red-500/40 bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed">
              ${T('wallet_remove_confirm')}
            </button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function openWalletRemove(id) {
  if (!window.__totpEnabled) {
    showBindToast(T('wallet_remove_need_2fa'), 'err');
    const tfa = document.getElementById('tfa-section');
    if (tfa) tfa.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  document.getElementById(`wl-remove-${id}`)?.classList.remove('hidden');
  document.getElementById(`wl-otp-${id}`)?.focus();
}

function cancelWalletRemove(id) {
  document.getElementById(`wl-remove-${id}`)?.classList.add('hidden');
  const otp = document.getElementById(`wl-otp-${id}`);
  if (otp) otp.value = '';
  document.getElementById(`wl-msg-${id}`)?.classList.add('hidden');
}

async function confirmWalletRemove(id) {
  const otpEl = document.getElementById(`wl-otp-${id}`);
  const msg   = document.getElementById(`wl-msg-${id}`);
  const btns  = document.querySelectorAll(`[data-wallet-id="${id}"]`);
  const otp   = (otpEl?.value || '').trim();
  const showMsg = (text, type) => {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
    msg.classList.remove('hidden');
  };
  if (!/^\d{6}$/.test(otp)) { showMsg(T('totp_err6'), 'err'); return; }
  btns.forEach(b => { if (b.tagName === 'BUTTON') b.disabled = true; });
  try {
    const stepRes = await apiFetch('/api/auth/step-up', {
      method: 'POST',
      body: JSON.stringify({ scope: 'elevated:account', for_action: 'unbind_wallet', otp_code: otp }),
    });
    const stepUpToken = stepRes?.step_up_token;
    if (!stepUpToken) { showMsg(T('net_err'), 'err'); btns.forEach(b => { if (b.tagName === 'BUTTON') b.disabled = false; }); return; }
    await apiFetch(`/api/auth/wallet/${id}`, {
      method:  'DELETE',
      headers: { Authorization: 'Bearer ' + stepUpToken },
    });
    showBindToast(T('wallet_remove_success'), 'ok');
    loadWallets();
  } catch (e) {
    btns.forEach(b => { if (b.tagName === 'BUTTON') b.disabled = false; });
    showMsg(tApiError(e, T('wallet_remove_fail')), 'err');
  }
}

// 用 server 回的欄位拼 SIWE message（spec EIP-4361 嚴格格式）
function buildSiweMessageClient({ domain, address, uri, chainId, nonce, expiresAt }) {
  const issuedAt = new Date().toISOString();
  // server 給的 expires_at 是 'YYYY-MM-DD HH:MM:SS' UTC，轉 ISO
  const expirationTime = expiresAt
    ? new Date(expiresAt.replace(' ', 'T') + 'Z').toISOString()
    : new Date(Date.now() + 5 * 60_000).toISOString();
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    '',
    'Sign in with Ethereum to chiyigo.',
    '',
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
  ].join('\n');
}

async function addWallet() {
  const provider = walletProvider();
  if (!provider) return;

  const btn = document.getElementById('wallet-add-btn');
  const msg = document.getElementById('wallet-add-msg');
  const showMsg = (text, type) => {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
    msg.classList.remove('hidden');
  };

  if (btn) btn.disabled = true;
  showMsg(T('wallet_connecting'), 'ok');

  try {
    // 1) 連線 wallet 拿 address
    let accounts;
    try {
      accounts = await provider.request({ method: 'eth_requestAccounts' });
    } catch (e) {
      // user reject → 4001
      if (e?.code === 4001 || e?.name === 'AbortError') {
        showMsg(T('wallet_add_cancelled'), 'err');
      } else {
        showMsg(`${T('wallet_add_fail')}：${e?.message ?? e}`, 'err');
      }
      if (btn) btn.disabled = false;
      return;
    }
    const address = accounts?.[0];
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      showMsg(T('wallet_add_fail'), 'err');
      if (btn) btn.disabled = false;
      return;
    }

    // 2) 拿 nonce + server domain/uri/chain_id
    let nonceRes;
    try {
      nonceRes = await apiFetch('/api/auth/wallet/nonce', {
        method: 'POST',
        body:   JSON.stringify({ address }),
      });
    } catch (e) {
      if (e?.code === 'ALREADY_BOUND') showMsg(T('wallet_already_bound'), 'err');
      else showMsg(tApiError(e, T('wallet_add_fail')), 'err');
      if (btn) btn.disabled = false;
      return;
    }

    // 3) 組 SIWE message + 請 wallet 簽
    const messageRaw = buildSiweMessageClient({
      domain:    nonceRes.domain,
      address,
      uri:       nonceRes.uri,
      chainId:   nonceRes.chain_id,
      nonce:     nonceRes.nonce,
      expiresAt: nonceRes.expires_at,
    });

    showMsg(T('wallet_signing'), 'ok');
    let signature;
    try {
      signature = await provider.request({
        method: 'personal_sign',
        params: [messageRaw, address],
      });
    } catch (e) {
      if (e?.code === 4001 || e?.name === 'AbortError') {
        showMsg(T('wallet_add_cancelled'), 'err');
      } else {
        showMsg(`${T('wallet_add_fail')}：${e?.message ?? e}`, 'err');
      }
      if (btn) btn.disabled = false;
      return;
    }

    // 4) verify + bind
    await apiFetch('/api/auth/wallet/verify', {
      method: 'POST',
      body:   JSON.stringify({ message: messageRaw, signature }),
    });

    showMsg(T('wallet_add_success'), 'ok');
    loadWallets();
  } catch (e) {
    showMsg(tApiError(e, T('wallet_add_fail')), 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Phase F-2 wave 3：付款 / 充值 ──

const PAY_STATUS_COLOR = {
  pending:    'bg-amber-500/15 border-amber-500/30 text-amber-300',
  processing: 'bg-sky-500/15 border-sky-500/30 text-sky-300',
  succeeded:  'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
  failed:     'bg-red-500/15 border-red-500/30 text-red-300',
  canceled:   'bg-gray-500/15 border-gray-500/30 text-gray-400',
  refunded:   'bg-gray-500/15 border-gray-500/30 text-gray-400',
};

// ── 我的成交紀錄（P1-6，2026-05-06）──
async function loadDeals() {
  const sec  = document.getElementById('deals-section');
  const list = document.getElementById('deals-list');
  if (!sec || !list) return;
  try {
    const data = await apiFetch('/api/auth/deals?limit=50');
    const rows = data?.rows ?? [];
    if (!rows.length) {
      sec.classList.add('hidden');
      return;
    }
    sec.classList.remove('hidden');
    renderDeals(rows);
  } catch (e) {
    sec.classList.remove('hidden');
    list.innerHTML = `<p class="text-xs text-red-400">${esc(tApiError(e, T('net_err')))}</p>`;
  }
}

function renderDeals(rows) {
  const list = document.getElementById('deals-list');
  if (!list) return;
  list.innerHTML = rows.map(d => {
    const total    = d.total_amount_subunit != null ? Number(d.total_amount_subunit).toLocaleString() : '—';
    const refunded = d.refunded_amount_subunit && Number(d.refunded_amount_subunit) > 0
      ? Number(d.refunded_amount_subunit).toLocaleString()
      : null;
    const cur = esc(d.currency || 'TWD');
    const dt  = d.saved_at
      ? new Date(d.saved_at.replace(' ', 'T') + 'Z').toLocaleString('zh-TW', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '—';
    const reqLine = d.source_requisition_id
      ? `<span class="mono text-[.68rem] text-gray-500">原單 #${d.source_requisition_id}</span>`
      : `<span class="mono text-[.68rem] text-gray-600">原單已歸檔</span>`;
    return `
      <div class="rounded-xl bg-[#0e0e16] border border-[#2a2a35] px-4 py-3">
        <div class="flex items-center justify-between gap-3 mb-1.5">
          <span class="text-sm font-semibold text-white">#${d.id} · ${esc(d.service_type || '接案')}</span>
          <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-emerald-500/15 text-emerald-300 border-emerald-500/40">✓ 已成交</span>
        </div>
        <div class="text-xs text-gray-400 space-y-0.5">
          <div>客戶：${esc(d.customer_name)}${d.customer_company ? ' · ' + esc(d.customer_company) : ''}</div>
          <div>已收：<span class="mono text-emerald-300">${total} ${cur}</span>${refunded ? ` · 已退：<span class="mono text-orange-300">${refunded} ${cur}</span>` : ''}</div>
          <div class="flex items-center justify-between gap-2 pt-0.5">
            ${reqLine}
            <span class="mono text-[.68rem] text-gray-500">${esc(dt)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadPayments() {
  const sec  = document.getElementById('payments-section');
  const list = document.getElementById('payments-list');
  if (!sec || !list) return;
  sec.classList.remove('hidden');
  try {
    const data = await apiFetch('/api/auth/payments/intents?limit=50');
    window._lastPayments = data?.items ?? [];
    renderPayments(window._lastPayments);
  } catch (e) {
    list.innerHTML = `<p class="text-xs text-red-400">${esc(tApiError(e, T('net_err')))}</p>`;
  }
}

function renderPayments(items) {
  const list = document.getElementById('payments-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<p class="text-xs text-gray-500">${T('payments_empty')}</p>`;
    return;
  }
  list.innerHTML = items.map(p => {
    const statusClass = PAY_STATUS_COLOR[p.status] || PAY_STATUS_COLOR.pending;
    const statusLabel = T('payment_status_' + p.status) || p.status;
    const kindLabel   = T('payment_kind_' + p.kind) || p.kind;
    const amount = p.amount_subunit != null
      ? `${p.amount_subunit.toLocaleString()} ${esc(p.currency || 'TWD')}`
      : (p.amount_raw ? `${esc(p.amount_raw)} ${esc(p.currency || '')}` : '—');
    let metaParsed = null;
    if (p.metadata) {
      try { metaParsed = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata; }
      catch { /* keep null */ }
    }
    const reqId = metaParsed?.requisition_id;
    const reqLine = reqId
      ? `<p class="text-xs text-gray-500 mt-0.5">${T('payment_for_requisition')} #${esc(reqId)}</p>`
      : '';
    const when = p.created_at ? formatRelative(p.created_at) : '—';

    // ATM/CVS/條碼 取號資訊（status=processing 才會有）
    let infoBlock = '';
    const info = metaParsed?.payment_info;
    if (info && p.status === 'processing') {
      let lines = '';
      if (info.method === 'atm' && info.bank_code && info.v_account) {
        lines = `<p>${T('payment_info_atm_bank')}：<span class="font-mono text-amber-300">${esc(info.bank_code)}</span></p>`
              + `<p>${T('payment_info_atm_account')}：<span class="font-mono text-amber-300 select-all">${esc(info.v_account)}</span></p>`;
      } else if (info.method === 'cvs' && info.payment_no) {
        lines = `<p>${T('payment_info_cvs_no')}：<span class="font-mono text-amber-300 select-all">${esc(info.payment_no)}</span></p>`;
      } else if (info.method === 'barcode') {
        lines = `<p>${T('payment_info_barcode')}：</p>`
              + `<p class="font-mono text-amber-300 select-all break-all">${esc(info.barcode_1 || '')}</p>`
              + `<p class="font-mono text-amber-300 select-all break-all">${esc(info.barcode_2 || '')}</p>`
              + `<p class="font-mono text-amber-300 select-all break-all">${esc(info.barcode_3 || '')}</p>`;
      }
      if (lines) {
        const expire = info.expire_date ? `<p class="text-gray-500">${T('payment_info_expire')}：${esc(info.expire_date)}</p>` : '';
        infoBlock = `<div class="mt-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs space-y-1">${lines}${expire}</div>`;
      }
    }
    // 動作按鈕：
    //  - pending / failed / canceled / refunded → 刪除（帳務已結清或從未進帳，可清掉 row）
    //  - succeeded（無 pending refund）→ 退款（綁需求單會連帶把 req 翻 refund_pending；沒綁直接申請）
    //  - succeeded（有 pending refund_request） → 不顯示 button，只顯示「待審核退款」狀態
    const isRefundPending = p.refund_request_status === 'pending';
    // 與後端 USER_DELETABLE 對齊（functions/api/auth/payments/intents/[id].js）
    // refunded 是金流憑證最終態，不允許 user 刪除（admin 也不行，L1.1 原則）
    const canDelete = ['pending', 'failed', 'canceled'].includes(p.status);
    let actionBtn = '';
    if (canDelete) {
      actionBtn = `<button data-pay-del-id="${p.id}" data-armed="0"
           class="shrink-0 px-2 py-1 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs transition-all">刪除</button>`;
    } else if (p.status === 'succeeded' && !isRefundPending) {
      actionBtn = `<button data-pay-refund-intent="${p.id}"
           class="shrink-0 px-2 py-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 text-xs transition-all">退款</button>`;
    }
    const delBtn = actionBtn;
    // 退款申請中 → 蓋掉 succeeded 的 status pill；title 顯示申請時間（hover / mobile long-press）
    const refundReqAt = p.refund_request_created_at
      ? new Date(p.refund_request_created_at.replace(' ', 'T') + 'Z').toLocaleString(dateLocale(), { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
      : null;
    const overrideStatusPill = isRefundPending
      ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border bg-orange-500/15 text-orange-300 border-orange-500/30 cursor-help" title="申請時間：${esc(refundReqAt || '—')}（等候 admin 審核）">退款申請中</span>`
      : null;
    return `
      <div class="rounded-xl bg-[#0e0e16] border border-[#2a2a35] px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-white">${esc(kindLabel)} · ${amount}</p>
            <p class="text-xs text-gray-500 mt-0.5">${esc(p.vendor)} · ${esc(when)}</p>
            ${reqLine}
          </div>
          <div class="flex items-center gap-2 shrink-0">
            ${overrideStatusPill || `<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold border ${statusClass}">${esc(statusLabel)}</span>`}
            ${delBtn}
          </div>
        </div>
        ${infoBlock}
      </div>`;
  }).join('');
}

function openPaymentForm() {
  document.getElementById('payment-form')?.classList.remove('hidden');
  document.getElementById('payment-amount')?.focus();
}

function cancelPaymentForm() {
  document.getElementById('payment-form')?.classList.add('hidden');
  ['payment-amount', 'payment-desc', 'payment-requisition'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const methodEl = document.getElementById('payment-method');
  if (methodEl) methodEl.value = 'ALL';
  const msg = document.getElementById('payment-form-msg');
  if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
}

async function submitPaymentCheckout() {
  const amountEl = document.getElementById('payment-amount');
  const methodEl = document.getElementById('payment-method');
  const descEl   = document.getElementById('payment-desc');
  const reqEl    = document.getElementById('payment-requisition');
  const msg      = document.getElementById('payment-form-msg');
  const btn      = document.getElementById('payment-submit-btn');
  const label    = document.getElementById('payment-submit-label');

  const showMsg = (text, type) => {
    if (!msg) return;
    msg.textContent = text;
    msg.className = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-emerald-400');
    msg.classList.remove('hidden');
  };

  const amount = Number(amountEl?.value);
  if (!Number.isFinite(amount) || amount < 1 || amount > 200000 || amount !== Math.floor(amount)) {
    showMsg(T('payment_amount_invalid'), 'err');
    return;
  }

  const metadata = {};
  const reqId = Number(reqEl?.value);
  if (Number.isFinite(reqId) && reqId > 0) metadata.requisition_id = reqId;

  if (btn) btn.disabled = true;
  if (label) label.textContent = T('payment_submitting');
  try {
    const resp = await apiFetch('/api/auth/payments/checkout/ecpay', {
      method: 'POST',
      body: JSON.stringify({
        amount,
        choose_payment: methodEl?.value || 'ALL',
        trade_desc: (descEl?.value || '').trim() || undefined,
        item_name:  (descEl?.value || '').trim() || undefined,
        metadata:   Object.keys(metadata).length ? metadata : undefined,
      }),
    });
    if (!resp?.checkout_url || !resp?.fields) {
      showMsg(T('payment_create_fail'), 'err');
      if (btn) btn.disabled = false;
      if (label) label.textContent = T('payment_submit_btn');
      return;
    }
    if (label) label.textContent = T('payment_redirecting');
    redirectToEcpay(resp.checkout_url, resp.fields);
  } catch (e) {
    const fallback = e?.code === 'KYC_REQUIRED'
      ? T('payment_kyc_required')
      : T('payment_create_fail');
    showMsg(tApiError(e, fallback), 'err');
    if (btn) btn.disabled = false;
    if (label) label.textContent = T('payment_submit_btn');
  }
}

// 動態建 form 並 submit。CSP 不允許 inline script，所以用 DOM API 不用 innerHTML+eval。
function redirectToEcpay(url, fields) {
  const form = document.createElement('form');
  form.action = url;
  form.method = 'POST';
  form.acceptCharset = 'UTF-8';
  // 同分頁跳轉：先前嘗試 target="_blank" 開新分頁，但 ECPay 沙箱對 popup
  // 的 3D-Secure 流程會在「交易成功」後直接 window.close()，造成
  // ClientBackURL 沒跳轉、server-to-server ReturnURL 也不發送，整個鏈路斷。
  // 改回同分頁讓 ECPay 完整 redirect → payment-result.html → 自動回 dashboard。
  form.style.display = 'none';
  for (const [k, v] of Object.entries(fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = k;
    input.value = String(v);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

// ── Phase C-3 unified click delegation ──
// 用 document-level delegation 統一處理；id 與 data-* 都在這裡分派。
// 比個別 getElementById().addEventListener 穩：button 即使是動態 render 或 hidden 都 work。
document.addEventListener('click', e => {
  const t = e.target.closest('button, a, tr, [data-action], [data-revoke-id], [data-req-del-id], [data-unbind], [data-bind], [data-open-modal], [data-load-page], [data-pay-del-id], [data-pay-refund-intent], [data-req-open-id]');
  if (!t) return;
  // List 上的 revoked 永久刪除按鈕（要在 reqOpenId 之前，因為按鈕在 row 內）
  if (t.dataset.reqDelId) return armOrConfirmReqListDelete(Number(t.dataset.reqDelId));
  // 點需求單 row 跳明細（點到撤銷/刪除按鈕例外，已被前面 closest 抓到 button）
  if (t.dataset.reqOpenId) {
    return openRequisitionDetail(Number(t.dataset.reqOpenId));
  }
  if (t.dataset.payDelId) return armOrConfirmPayDelete(Number(t.dataset.payDelId));
  // succeeded 充值 row 上的「退款」→ 不論有無綁需求單都建 refund_request
  if (t.dataset.payRefundIntent) return requestPaymentRefund(Number(t.dataset.payRefundIntent));
  // 靜態按鈕 by id
  if (t.id === 'tfa-enable-btn')   return startSetup2FA();
  if (t.id === 'tfa-disable-btn')  return showDisablePanel();
  if (t.id === 'setpw-btn')        return sendSetPasswordEmail();
  if (t.id === 'resend-btn')       return sendVerification();
  if (t.id === 'del-open-btn')     return showDeleteForm();
  if (t.id === 'del-submit-btn')   return submitDeleteAccount();
  if (t.id === 'passkey-add-btn')  return addPasskey();
  if (t.id === 'wallet-add-btn')   return addWallet();
  if (t.id === 'payment-add-btn')  return openPaymentForm();
  if (t.id === 'payment-submit-btn') return submitPaymentCheckout();
  // data-action
  const a = t.dataset.action;
  if (a === 'logout')              return logout();
  if (a === 'confirm-enable-2fa')  return confirmEnable2FA();
  if (a === 'confirm-disable-2fa') return confirmDisable2FA();
  if (a === 'close-tfa-backup')    return closeTfaBackup();
  if (a === 'hide-delete-form')    return hideDeleteForm();
  if (a === 'submit-change-password') return submitChangePassword();
  // Phase D-3
  if (a === 'logout-device')           return logoutDevice(t.dataset.deviceUuid ?? '');
  if (a === 'passkey-remove-open')     return openPasskeyRemove(t.dataset.passkeyId);
  if (a === 'passkey-remove-cancel')   return cancelPasskeyRemove(t.dataset.passkeyId);
  if (a === 'passkey-remove-confirm')  return confirmPasskeyRemove(t.dataset.passkeyId);
  if (a === 'passkey-rename-open')     return openPasskeyRename(t.dataset.passkeyId);
  if (a === 'passkey-rename-cancel')   return cancelPasskeyRename(t.dataset.passkeyId);
  if (a === 'passkey-rename-save')     return savePasskeyRename(t.dataset.passkeyId);
  if (a === 'wallet-remove-open')      return openWalletRemove(t.dataset.walletId);
  if (a === 'wallet-remove-cancel')    return cancelWalletRemove(t.dataset.walletId);
  if (a === 'wallet-remove-confirm')   return confirmWalletRemove(t.dataset.walletId);
  if (a === 'payment-form-cancel')     return cancelPaymentForm();
  if (a === 'req-detail-close')        return closeRequisitionDetail();
  if (t.id === 'req-perm-del-btn')     return armOrConfirmReqPermDelete(Number(t.dataset.reqId));
  // dynamic content
  if (t.dataset.revokeId) return armRevoke(Number(t.dataset.revokeId));
  if (t.dataset.unbind)   return unbindProvider(t.dataset.unbind);
  if (t.dataset.bind)     return bindProvider(t.dataset.bind);
});
