/**
 * auth-ui.js — 登入 / 註冊前端邏輯
 *
 * 功能：
 *  - guest_id 的生成與 LocalStorage 讀寫
 *  - 密碼顯示切換，10 秒後自動回隱藏
 *  - 登入 / 註冊 / 2FA 表單提交與後端溝通
 *  - JWT + Refresh Token 儲存（sessionStorage）與成功後頁面跳轉
 *  - logout()：撤銷 refresh_token + 清除 session
 */

'use strict';

// ── 常數 ────────────────────────────────────────────────────────
const API = {
  login:     '/api/auth/local/login',
  register:  '/api/auth/local/register',
  totp:      '/api/auth/2fa/verify',
  logout:    '/api/auth/logout',
  oauthCode: '/api/auth/oauth/code',
};

const REDIRECT_KEY       = 'auth_redirect';
const TOKEN_KEY          = 'access_token';
const REFRESH_TOKEN_KEY  = 'refresh_token';
const GUEST_ID_KEY       = 'chiyigo_guest_id';
const PWD_HIDE_MS        = 10_000;

// ── PKCE 模式偵測 ─────────────────────────────────────────────────
// pkce_key 由 GET /api/auth/oauth/authorize 產生，存在 URL ?pkce_key=...
const _pkceKey = new URLSearchParams(location.search).get('pkce_key');

// ── guest_id 管理 ────────────────────────────────────────────────

function getOrCreateGuestId() {
  let id = localStorage.getItem(GUEST_ID_KEY);
  if (!id) {
    // 16 bytes 強亂數 → 32 hex chars
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(GUEST_ID_KEY, id);
  }
  return id;
}

function clearGuestId() {
  localStorage.removeItem(GUEST_ID_KEY);
}

// ── JWT + Refresh Token 儲存 ─────────────────────────────────────

function saveToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function saveRefreshToken(token) {
  sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
}

function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

// ── 登出 ──────────────────────────────────────────────────────────

async function logout() {
  const refreshToken = getRefreshToken();

  // 先清除本地 session（無論 API 是否成功）
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  clearGuestId();

  // 通知伺服器撤銷 refresh_token（fire-and-forget）
  if (refreshToken) {
    try {
      await fetch(API.logout, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      // 網路失敗不阻擋登出流程
    }
  }

  window.location.href = '/login.html';
}

// ── 成功後跳轉 ───────────────────────────────────────────────────

function redirectAfterAuth() {
  const target = sessionStorage.getItem(REDIRECT_KEY) || '/dashboard.html';
  sessionStorage.removeItem(REDIRECT_KEY);
  window.location.href = target;
}

// ── PKCE 模式：登入後換取授權碼並跳回 App ──────────────────────
async function handlePkceRedirect(accessToken) {
  try {
    const res = await fetch(API.oauthCode, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + accessToken,
      },
      body: JSON.stringify({ pkce_key: _pkceKey }),
    });
    const data = await res.json();
    if (!res.ok) {
      showMsg(data.error || 'PKCE 授權失敗，請重試');
      return;
    }
    // 跳轉至 App（chiyigo:// 或 loopback 或 https://）
    window.location.href = data.redirect_url;
  } catch {
    showMsg('網路錯誤，請檢查連線後重試');
  }
}

// ── 密碼顯示 / 隱藏（10 秒自動回隱藏）──────────────────────────

const _pwdTimers = {};

function togglePassword(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  const icon  = document.getElementById(btnId + '-icon');

  const isHidden = input.type === 'password';

  if (isHidden) {
    // 顯示密碼
    input.type = 'text';
    btn.classList.replace('text-gray-500', 'text-brand-500');
    if (icon) {
      icon.innerHTML = `
        <path stroke-linecap="round" stroke-linejoin="round"
          d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />`;
    }

    // 清除舊計時器，設定 10 秒後自動隱藏
    clearTimeout(_pwdTimers[inputId]);
    _pwdTimers[inputId] = setTimeout(() => hidePassword(inputId, btnId), PWD_HIDE_MS);
  } else {
    hidePassword(inputId, btnId);
  }
}

function hidePassword(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn   = document.getElementById(btnId);
  const icon  = document.getElementById(btnId + '-icon');

  input.type = 'password';
  if (btn) btn.classList.replace('text-brand-500', 'text-gray-500');
  if (icon) {
    icon.innerHTML = `
      <path stroke-linecap="round" stroke-linejoin="round"
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z" />
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />`;
  }
  clearTimeout(_pwdTimers[inputId]);
}

// ── 分頁切換 ─────────────────────────────────────────────────────

const TAB_CONFIG = {
  login:    { title: '歡迎回來',     subtitle: '登入你的 CHIYIGO 帳號',    showTabs: true  },
  register: { title: '建立帳號',     subtitle: '開始你的 CHIYIGO 旅程',    showTabs: true  },
  totp:     { title: '兩步驟驗證',   subtitle: '請完成身份驗證以繼續',      showTabs: false },
};

function switchTab(tab) {
  // 隱藏所有面板
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('form-' + tab).classList.add('active');

  // 更新標題
  const cfg = TAB_CONFIG[tab] || TAB_CONFIG.login;
  document.getElementById('form-title').textContent    = cfg.title;
  document.getElementById('form-subtitle').textContent = cfg.subtitle;

  // 分頁按鈕樣式（TOTP 時隱藏）
  const tabBar = document.getElementById('tab-bar');
  if (!cfg.showTabs) {
    tabBar.style.display = 'none';
  } else {
    tabBar.style.display = '';
    ['login', 'register'].forEach(t => {
      const btn = document.getElementById('tab-' + t);
      if (t === tab) {
        btn.classList.add('bg-brand-500', 'text-white', 'shadow');
        btn.classList.remove('text-gray-400');
      } else {
        btn.classList.remove('bg-brand-500', 'text-white', 'shadow');
        btn.classList.add('text-gray-400');
      }
    });
  }

  clearMsg();
  hidePassword('login-password', 'login-eye');
  hidePassword('reg-password',   'reg-eye');
  hidePassword('reg-confirm',    'reg-confirm-eye');
}

// ── 訊息顯示 ─────────────────────────────────────────────────────

function showMsg(text, type = 'error') {
  const box = document.getElementById('msg-box');
  box.textContent = text;
  box.className = [
    'mb-5 px-4 py-3 rounded-lg text-sm font-medium',
    type === 'error'
      ? 'bg-red-500/10 border border-red-500/30 text-red-400'
      : 'bg-green-500/10 border border-green-500/30 text-green-400',
  ].join(' ');
  box.classList.remove('hidden');
}

function clearMsg() {
  const box = document.getElementById('msg-box');
  box.classList.add('hidden');
  box.textContent = '';
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '處理中…' : btn.dataset.label || btn.textContent;
}

// ── 登入處理 ─────────────────────────────────────────────────────

// 暫存 pre_auth_token，供 TOTP 面板使用
let _preAuthToken = null;

async function handleLogin(event) {
  event.preventDefault();
  clearMsg();

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  btn.dataset.label = '登入';

  setLoading('login-btn', true);

  try {
    const res = await fetch(API.login, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (res.status === 403 && data.code === 'TOTP_REQUIRED') {
      _preAuthToken = data.pre_auth_token;
      switchTab('totp');
      document.getElementById('totp-code').focus();
      return;
    }

    if (!res.ok) {
      showMsg(data.error || '登入失敗，請重試');
      return;
    }

    saveToken(data.access_token);
    if (data.refresh_token) saveRefreshToken(data.refresh_token);
    if (_pkceKey) { await handlePkceRedirect(data.access_token); return; }
    redirectAfterAuth();

  } catch {
    showMsg('網路錯誤，請檢查連線後重試');
  } finally {
    setLoading('login-btn', false);
  }
}

// ── 註冊處理 ─────────────────────────────────────────────────────

async function handleRegister(event) {
  event.preventDefault();
  clearMsg();

  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-confirm').value;
  const guest_id = getOrCreateGuestId();
  const btn      = document.getElementById('reg-btn');
  btn.dataset.label = '建立帳號';

  if (password.length < 8) {
    showMsg('密碼至少需要 8 個字元');
    return;
  }

  if (password !== confirm) {
    showMsg('兩次輸入的密碼不一致，請重新確認');
    document.getElementById('reg-confirm').focus();
    return;
  }

  setLoading('reg-btn', true);

  try {
    const res = await fetch(API.register, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password, guest_id }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || '註冊失敗，請重試');
      return;
    }

    saveToken(data.access_token);
    if (data.refresh_token) saveRefreshToken(data.refresh_token);
    clearGuestId();
    if (_pkceKey) { await handlePkceRedirect(data.access_token); return; }
    showMsg('帳號建立成功！正在跳轉…', 'success');
    setTimeout(redirectAfterAuth, 800);

  } catch {
    showMsg('網路錯誤，請檢查連線後重試');
  } finally {
    setLoading('reg-btn', false);
  }
}

// ── 2FA 驗證處理 ──────────────────────────────────────────────────

async function handleTotp(event) {
  event.preventDefault();
  clearMsg();

  const otp_code = document.getElementById('totp-code').value.trim();
  const btn      = document.getElementById('totp-btn');
  btn.dataset.label = '驗證';

  if (!otp_code) {
    showMsg('請輸入驗證碼');
    return;
  }
  if (!_preAuthToken) {
    showMsg('驗證階段已過期，請重新登入');
    switchTab('login');
    return;
  }

  setLoading('totp-btn', true);

  try {
    const res = await fetch(API.totp, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + _preAuthToken,
      },
      body: JSON.stringify({ otp_code }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(data.error || '驗證碼錯誤，請重試');
      return;
    }

    _preAuthToken = null;
    saveToken(data.access_token);
    if (data.refresh_token) saveRefreshToken(data.refresh_token);
    if (_pkceKey) { await handlePkceRedirect(data.access_token); return; }
    redirectAfterAuth();

  } catch {
    showMsg('網路錯誤，請檢查連線後重試');
  } finally {
    setLoading('totp-btn', false);
  }
}

// ── 初始化 ───────────────────────────────────────────────────────

(function init() {
  // Discord OAuth 回傳：URL 帶有 ?access_token=...
  const _urlToken = new URLSearchParams(location.search).get('access_token');
  if (_urlToken) {
    saveToken(_urlToken);
    // 清除 URL 參數（避免 token 留在瀏覽器歷史）
    history.replaceState(null, '', location.pathname);
    redirectAfterAuth();
    return;
  }

  // 已登入時：PKCE 模式繼續換碼，普通模式跳轉儀表板
  if (getToken()) {
    if (_pkceKey) { handlePkceRedirect(getToken()); return; }
    redirectAfterAuth();
    return;
  }
  getOrCreateGuestId();
  // PKCE 模式顯示提示
  if (_pkceKey) {
    const notice = document.getElementById('pkce-notice');
    if (notice) notice.classList.remove('hidden');
  }
})();

// 瀏覽器上一頁復原表單時，強制重置所有密碼欄位為隱藏狀態，避免明文外洩
window.addEventListener('pageshow', () => {
  hidePassword('login-password', 'login-eye');
  hidePassword('reg-password',   'reg-eye');
  hidePassword('reg-confirm',    'reg-confirm-eye');
  clearTimeout(_pwdTimers['login-password']);
  clearTimeout(_pwdTimers['reg-password']);
  clearTimeout(_pwdTimers['reg-confirm']);
});
