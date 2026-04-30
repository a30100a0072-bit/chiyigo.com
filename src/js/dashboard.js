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
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const k = el.dataset.i18nHtml; if (t[k] !== undefined) el.innerHTML = t[k];
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
  // 刪帳按鈕 label 隨 hasPassword 動態切換，需在 i18n 套用後重畫
  if (typeof renderDeleteSection === 'function' && typeof window.__hasPassword !== 'undefined') {
    renderDeleteSection(window.__hasPassword);
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
      const ok = await refreshAccessToken();
      if (!ok) {
        sessionStorage.removeItem('access_token');
        window.location.href = '/login.html';
        return;
      }
      res = await fetch('/api/auth/me', {
        headers: { 'Authorization': 'Bearer ' + sessionStorage.getItem('access_token') },
      });
    }

    if (res.status === 403) {
      sessionStorage.removeItem('access_token');
      window.location.href = '/login.html';
      return;
    }

    if (!res.ok) throw new Error('Server error');

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
    render2FASection(data.totp_enabled ?? false);

    // 帳號綁定區塊
    renderBindingSection(data.identities ?? []);

    // 設密碼 / 刪帳號：依是否設過密碼決定 UI
    window.__hasPassword = !!data.has_password;
    window.__userEmail   = data.email;
    renderSetPasswordSection(window.__hasPassword);
    renderDeleteSection(window.__hasPassword);

    // 需求單區塊
    loadRequisitions();

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('user-card').classList.remove('hidden');

  } catch {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('error-card').classList.remove('hidden');
    document.getElementById('error-msg').textContent = T('err_profile');
  }
}

loadProfile();

// ── HTML 轉義 helper（防 XSS）────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')

// ── 需求單 ───────────────────────────────────────────────────

const REQ_STATUS_CLS = {
  pending:    'bg-amber-500/15 text-amber-300 border border-amber-500/20',
  revoked:    'bg-gray-500/15 text-gray-500 border border-gray-500/20',
  processing: 'bg-blue-500/15 text-blue-300 border border-blue-500/20',
  completed:  'bg-green-500/15 text-green-300 border border-green-500/20',
}
function reqStatus(key) {
  return { text: T('status_' + key), cls: REQ_STATUS_CLS[key] ?? REQ_STATUS_CLS.pending }
}
window._lastRequisitions = null;

async function loadRequisitions() {
  const token = sessionStorage.getItem('access_token')
  if (!token) return
  try {
    const r = await fetch('/api/requisition/me', {
      headers: { 'Authorization': 'Bearer ' + token },
    })
    if (!r.ok) return
    const { requisitions } = await r.json()
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
      <div class="flex items-center justify-between px-5 py-3.5 gap-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-xs text-gray-600 shrink-0">#${r.id}</span>
          <span class="text-sm text-white truncate">${esc(r.service_type)}</span>
          <span class="text-xs text-gray-500 shrink-0">${date}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${s.cls}">${s.text}</span>
          ${r.status === 'pending'
            ? `<button id="revoke-btn-${r.id}" data-armed="0" onclick="armRevoke(${r.id})"
                 class="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
                 ${T('btn_revoke')}
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

async function revokeRequisition(id) {
  const token = sessionStorage.getItem('access_token')
  const btn   = document.getElementById(`revoke-btn-${id}`)
  if (_revokeArmTimer) { clearTimeout(_revokeArmTimer); _revokeArmTimer = null }
  if (btn) { btn.disabled = true; btn.textContent = T('btn_processing') }
  try {
    const r    = await fetch('/api/requisition/revoke', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ requisition_id: id }),
    })
    const data = await r.json()
    if (!r.ok) {
      showBindToast(data.error ?? T('msg_revoke_fail'), 'err')
      if (btn) { btn.disabled = false; btn.textContent = T('btn_revoke') }
      return
    }
    showBindToast(T('msg_revoke_success').replace('${id}', id), 'ok')
    loadRequisitions()
  } catch {
    showBindToast(T('net_err'), 'err')
    if (btn) { btn.disabled = false; btn.textContent = T('btn_revoke') }
  }
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
    const dot         = `<span class="inline-block w-2 h-2 rounded-full mr-2" style="background:${color}"></span>`;
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
          ? `<button id="unbind-btn-${id}" onclick="unbindProvider('${id}')" data-i18n="unbind_btn"
               class="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold transition-all">
               ${T('unbind_btn')}
             </button>`
          : `<button id="bind-btn-${id}" onclick="bindProvider('${id}')" data-i18n="bind_btn"
               class="shrink-0 px-3 py-1.5 rounded-lg bg-brand-500/10 hover:bg-brand-500/20 border border-brand-500/20 text-brand-400 text-xs font-semibold transition-all">
               ${T('bind_btn')}
             </button>`
        }
      </div>`;
  }).join('');
  document.getElementById('bind-section').classList.remove('hidden');
}

async function bindProvider(provider) {
  const token = sessionStorage.getItem('access_token');
  const btn   = document.getElementById(`bind-btn-${provider}`);
  if (btn) { btn.disabled = true; btn.textContent = T('btn_loading'); }
  try {
    const res  = await fetch(`/api/auth/oauth/${provider}/init?is_binding=true`, {
      headers: { 'Authorization': 'Bearer ' + token },
    });
    const data = await res.json();
    if (!res.ok || !data.redirect_url) {
      showBindToast(data.error ?? T('bind_fail'), 'err');
      return;
    }
    window.location.href = data.redirect_url;
  } catch {
    showBindToast(T('net_err'), 'err');
    if (btn) { btn.disabled = false; btn.textContent = T('bind_btn'); }
  }
}

async function unbindProvider(provider) {
  const token = sessionStorage.getItem('access_token');
  const btn   = document.getElementById(`unbind-btn-${provider}`);
  if (btn) { btn.disabled = true; btn.textContent = T('btn_loading'); }
  try {
    const res  = await fetch('/api/auth/identity/unbind', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ provider }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = res.status === 400 ? T('unbind_last_method') : (data.error ?? T('unbind_fail'));
      showBindToast(msg, res.status === 400 ? 'warn' : 'err');
      if (btn) { btn.disabled = false; btn.textContent = T('unbind_btn'); }
      return;
    }
    showBindToast(T('unbind_success').replace('${p}', provider), 'ok');
    loadProfile();
  } catch {
    showBindToast(T('net_err'), 'err');
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

function render2FASection(enabled) {
  document.getElementById('tfa-section').classList.remove('hidden');
  const badge = document.getElementById('tfa-badge');
  const text  = document.getElementById('tfa-status-text');
  badge.dataset.tfaState = enabled ? 'on' : 'off';
  if (enabled) {
    badge.textContent  = T('tfa_badge_on');
    badge.className    = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-300 border border-green-500/20';
    text.textContent   = T('tfa_text_on');
    document.getElementById('tfa-enable-btn').classList.add('hidden');
    document.getElementById('tfa-disable-btn').classList.remove('hidden');
  } else {
    badge.textContent  = T('tfa_badge_off');
    badge.className    = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-500/15 text-gray-400 border border-gray-500/20';
    text.textContent   = T('tfa_text_off');
    document.getElementById('tfa-enable-btn').classList.remove('hidden');
    document.getElementById('tfa-disable-btn').classList.add('hidden');
  }
  document.getElementById('tfa-setup-panel').classList.add('hidden');
  document.getElementById('tfa-disable-panel').classList.add('hidden');
  document.getElementById('tfa-backup-panel').classList.add('hidden');
}

async function startSetup2FA() {
  const token = sessionStorage.getItem('access_token');
  const btn   = document.getElementById('tfa-enable-btn');
  btn.disabled = true; btn.querySelector('[data-i18n]').textContent = T('btn_loading');
  try {
    const res  = await fetch('/api/auth/2fa/setup', {
      method:  'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body:    '{}',
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error ?? T('setup_fail')); btn.disabled = false; btn.querySelector('[data-i18n]').textContent = T('tfa_enable_btn'); return; }
    document.getElementById('tfa-secret').textContent = data.secret;
    await QRCode.toCanvas(document.getElementById('tfa-qr'), data.otpauth_uri, { width: 180, margin: 1 });
    document.getElementById('tfa-setup-panel').classList.remove('hidden');
    document.getElementById('tfa-otp-input').value = '';
    document.getElementById('tfa-setup-msg').classList.add('hidden');
  } catch { alert(T('net_err')); }
  btn.disabled = false; btn.querySelector('[data-i18n]').textContent = T('tfa_enable_btn');
}

async function confirmEnable2FA() {
  const token = sessionStorage.getItem('access_token');
  const otp   = document.getElementById('tfa-otp-input').value.trim();
  const msg   = document.getElementById('tfa-setup-msg');
  if (!/^\d{6}$/.test(otp)) { showTfaMsg(msg, T('totp_err6'), 'err'); return; }
  try {
    const res  = await fetch('/api/auth/2fa/activate', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_code: otp }),
    });
    const data = await res.json();
    if (!res.ok) { showTfaMsg(msg, data.error ?? T('enable_fail'), 'err'); return; }
    // 顯示備用碼
    const codesEl = document.getElementById('tfa-backup-codes');
    codesEl.innerHTML = data.backup_codes.map(c =>
      `<code class="block text-center text-xs font-mono bg-[#0e0e12] border border-[#2a2a35] rounded-lg px-2 py-1.5 text-gray-300 select-all">${c}</code>`
    ).join('');
    render2FASection(true);
    document.getElementById('tfa-setup-panel').classList.add('hidden');
    document.getElementById('tfa-backup-panel').classList.remove('hidden');
  } catch { showTfaMsg(msg, T('net_err'), 'err'); }
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
  const token = sessionStorage.getItem('access_token');
  const otp   = document.getElementById('tfa-disable-input').value.trim();
  const msg   = document.getElementById('tfa-disable-msg');
  if (!/^\d{6}$/.test(otp)) { showTfaMsg(msg, T('totp_err6'), 'err'); return; }
  try {
    const res  = await fetch('/api/auth/2fa/disable', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_code: otp }),
    });
    const data = await res.json();
    if (!res.ok) { showTfaMsg(msg, data.error ?? T('disable_fail'), 'err'); return; }
    render2FASection(false);
  } catch { showTfaMsg(msg, T('net_err'), 'err'); }
}

function showTfaMsg(el, text, type) {
  el.textContent = text;
  el.className   = 'text-xs ' + (type === 'err' ? 'text-red-400' : 'text-green-400');
}

async function sendVerification() {
  const btn = document.getElementById('resend-btn');
  const msg = document.getElementById('resend-msg');
  const token = sessionStorage.getItem('access_token');
  if (!token) { window.location.href = '/login.html'; return; }

  btn.disabled = true;
  btn.querySelector('[data-i18n]').textContent = T('btn_sending');
  msg.className = 'hidden text-xs mt-2';

  try {
    const res  = await fetch('/api/auth/email/send-verification', {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json',
      },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      showResendMsg(T('resend_sent'), 'ok');
      startResendCooldown(60);
      return;
    }
    if (res.status === 400) {
      // email 已驗證，重新載入資料更新 UI
      loadProfile();
      return;
    }
    if (res.status === 429) {
      const wait = data.retry_after ?? 60;
      showResendMsg(T('resend_wait'), 'warn');
      startResendCooldown(wait);
      return;
    }
    showResendMsg(data.error ?? T('resend_fail'), 'err');
    btn.disabled = false;
    btn.querySelector('[data-i18n]').textContent = T('resend_btn');
  } catch {
    showResendMsg(T('net_err'), 'err');
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
    const r = await fetch('/api/auth/local/forgot-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email: window.__userEmail }),
    });
    if (!r.ok) {
      msg.textContent = T('setpw_fail');
      msg.className = 'text-xs text-red-400';
      msg.classList.remove('hidden');
      btn.disabled = false;
      return;
    }
    msg.innerHTML = T('setpw_sent').replace('${email}', esc(window.__userEmail));
    msg.className = 'text-xs text-emerald-400';
    msg.classList.remove('hidden');
    // 60 秒冷卻保護
    setTimeout(() => { btn.disabled = false; }, 60000);
  } catch (e) {
    msg.textContent = T('net_err');
    msg.className = 'text-xs text-red-400';
    msg.classList.remove('hidden');
    btn.disabled = false;
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
    const tk = sessionStorage.getItem('access_token');
    const r  = await fetch('/api/auth/delete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tk },
      body:    JSON.stringify({ password: pw }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const k = DEL_ERR_MAP[data.error];
      msg.textContent = k ? T(k) : T('del_err_generic').replace('${status}', r.status);
      msg.className = 'text-xs text-red-400';
      msg.classList.remove('hidden');
      btn.disabled = false;
      // 開發者除錯：把後端原始訊息一起印到 console，方便診斷
      console.warn('[delete-account]', r.status, data, 'detail=', data.detail);
      return;
    }
    msg.innerHTML = T('del_sent');
    msg.className = 'text-xs text-emerald-400';
    msg.classList.remove('hidden');
    document.getElementById('del-password').value = '';
  } catch (e) {
    msg.textContent = T('net_err');
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
    if (sun)  sun.style.display  = dark ? 'none' : '';
    if (moon) moon.style.display = dark ? ''     : 'none';
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
