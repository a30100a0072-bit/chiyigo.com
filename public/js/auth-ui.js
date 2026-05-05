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

// ── i18n：四語系錯誤 / UI 字串 ───────────────────────────────────
// 後端錯誤訊息（res.json().error）對照：以英文 key 查 4 語對應翻譯
const ERROR_I18N = {
  'Invalid credentials':                    { 'zh-TW':'帳號或密碼錯誤', en:'Invalid email or password', ja:'メールアドレスまたはパスワードが正しくありません', ko:'이메일 또는 비밀번호가 올바르지 않습니다' },
  'email and password are required':        { 'zh-TW':'請填寫信箱與密碼', en:'Email and password are required', ja:'メールアドレスとパスワードを入力してください', ko:'이메일과 비밀번호를 입력해주세요' },
  'Invalid email format':                   { 'zh-TW':'信箱格式不正確', en:'Invalid email format', ja:'メールアドレスの形式が正しくありません', ko:'이메일 형식이 올바르지 않습니다' },
  'Password must be at least 8 characters': { 'zh-TW':'密碼至少需要 8 個字元', en:'Password must be at least 8 characters', ja:'パスワードは8文字以上で入力してください', ko:'비밀번호는 8자 이상이어야 합니다' },
  'Password must be ≥12 chars, or ≥8 chars with 3 of: uppercase / lowercase / digit / symbol': {
    'zh-TW':'密碼長度需 ≥12 字元，或 ≥8 字元並包含「大寫字母 / 小寫字母 / 數字 / 符號」其中 3 類。',
    en:'Password must be ≥12 chars, or ≥8 chars and contain 3 of: uppercase / lowercase / digit / symbol.',
    ja:'パスワードは12文字以上、または8文字以上で「大文字 / 小文字 / 数字 / 記号」のうち3種を含めてください。',
    ko:'비밀번호는 12자 이상, 또는 8자 이상이며 대문자 / 소문자 / 숫자 / 기호 중 3종을 포함해야 합니다.',
  },
  'Email already registered':               { 'zh-TW':'此信箱已被註冊，請直接登入', en:'Email already registered, please log in', ja:'このメールアドレスは既に登録されています。ログインしてください', ko:'이미 등록된 이메일입니다. 로그인해주세요' },
  'Account is banned':                      { 'zh-TW':'此帳號已被停用，請聯繫客服', en:'This account has been suspended, please contact support', ja:'このアカウントは停止されています。サポートまでご連絡ください', ko:'이 계정은 정지되었습니다. 고객센터로 문의해주세요' },
  'Invalid OTP or backup code':             { 'zh-TW':'驗證碼錯誤，請重試', en:'Invalid code, please try again', ja:'認証コードが正しくありません。もう一度お試しください', ko:'인증 코드가 올바르지 않습니다. 다시 시도해주세요' },
  'Local account not found':                { 'zh-TW':'此帳號無法使用密碼登入', en:'This account cannot log in with password', ja:'このアカウントはパスワードログインに対応していません', ko:'이 계정은 비밀번호 로그인을 지원하지 않습니다' },
  '2FA is already enabled':                 { 'zh-TW':'雙重驗證已啟用', en:'Two-factor authentication is already enabled', ja:'2段階認証は既に有効です', ko:'2단계 인증이 이미 활성화되어 있습니다' },
  'Invalid request':                        { 'zh-TW':'請求無效，請重新登入', en:'Invalid request, please log in again', ja:'リクエストが無効です。もう一度ログインしてください', ko:'요청이 유효하지 않습니다. 다시 로그인해주세요' },
  'Invalid or expired PKCE session':        { 'zh-TW':'授權階段已失效或過期，請重新登入', en:'Authorization session is invalid or expired, please log in again', ja:'認可セッションが無効または期限切れです。もう一度ログインしてください', ko:'인증 세션이 유효하지 않거나 만료되었습니다. 다시 로그인해주세요' },
  'captcha_failed':                         { 'zh-TW':'人機驗證未通過，請重新整理頁面再試', en:'Captcha verification failed, please refresh the page and try again', ja:'ボット認証に失敗しました。ページを再読み込みしてからお試しください', ko:'봇 검증에 실패했습니다. 페이지를 새로고침한 후 다시 시도하세요' },
}

// 前端內嵌 UI 字串
const UI_I18N = {
  loading:        { 'zh-TW':'處理中…', en:'Processing…', ja:'処理中…', ko:'처리 중…' },
  btn_login:      { 'zh-TW':'登入', en:'Log In', ja:'ログイン', ko:'로그인' },
  btn_register:   { 'zh-TW':'建立帳號', en:'Create Account', ja:'アカウント作成', ko:'계정 만들기' },
  btn_verify:     { 'zh-TW':'驗證', en:'Verify', ja:'認証', ko:'인증' },
  err_pwd_short:  { 'zh-TW':'密碼至少需要 8 個字元', en:'Password must be at least 8 characters', ja:'パスワードは8文字以上で入力してください', ko:'비밀번호는 8자 이상이어야 합니다' },
  err_pwd_mismatch:{'zh-TW':'兩次輸入的密碼不一致，請重新確認', en:"Passwords don't match, please re-enter", ja:'パスワードが一致しません。もう一度ご確認ください', ko:'비밀번호가 일치하지 않습니다. 다시 확인해주세요' },
  err_otp_empty:  { 'zh-TW':'請輸入驗證碼', en:'Please enter the verification code', ja:'認証コードを入力してください', ko:'인증 코드를 입력해주세요' },
  err_otp_expired:{ 'zh-TW':'驗證階段已過期，請重新登入', en:'Verification session expired, please log in again', ja:'認証セッションの有効期限が切れました。もう一度ログインしてください', ko:'인증 세션이 만료되었습니다. 다시 로그인해주세요' },
  err_login_fail: { 'zh-TW':'登入失敗，請重試', en:'Login failed, please try again', ja:'ログインに失敗しました。もう一度お試しください', ko:'로그인에 실패했습니다. 다시 시도해주세요' },
  err_reg_fail:   { 'zh-TW':'註冊失敗，請重試', en:'Registration failed, please try again', ja:'登録に失敗しました。もう一度お試しください', ko:'가입에 실패했습니다. 다시 시도해주세요' },
  reg_success:    { 'zh-TW':'帳號建立成功！正在跳轉…', en:'Account created! Redirecting…', ja:'アカウントを作成しました！移動中…', ko:'계정이 생성되었습니다! 이동 중…' },
  err_otp_invalid:{ 'zh-TW':'驗證碼錯誤，請重試', en:'Invalid code, please try again', ja:'認証コードが正しくありません。もう一度お試しください', ko:'인증 코드가 올바르지 않습니다. 다시 시도해주세요' },
  err_network:    { 'zh-TW':'網路錯誤，請檢查連線後重試', en:'Network error, please check your connection and retry', ja:'ネットワークエラーです。接続を確認してもう一度お試しください', ko:'네트워크 오류입니다. 연결을 확인하고 다시 시도해주세요' },
  err_pkce:       { 'zh-TW':'PKCE 授權失敗，請重試', en:'PKCE authorization failed, please try again', ja:'PKCE認可に失敗しました。もう一度お試しください', ko:'PKCE 인증에 실패했습니다. 다시 시도해주세요' },
  err_captcha_pending: { 'zh-TW':'人機驗證尚未完成，請稍候再點一次', en:'Captcha is still verifying, please wait and try again', ja:'ボット認証が完了していません。少々お待ちください', ko:'봇 검증이 아직 완료되지 않았습니다. 잠시만 기다려 주세요' },
}

function getLang() {
  try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' }
}

// 後端錯誤訊息翻譯（保留原訊息為 fallback）
function t(msg) {
  const entry = ERROR_I18N[msg]
  if (!entry) return msg
  return entry[getLang()] || entry['zh-TW'] || msg
}

// 前端 UI 字串翻譯
function uiT(key) {
  const entry = UI_I18N[key]
  if (!entry) return key
  return entry[getLang()] || entry['zh-TW'] || key
}

// ── 常數 ────────────────────────────────────────────────────────
const API = {
  login:     '/api/auth/local/login',
  register:  '/api/auth/local/register',
  totp:      '/api/auth/2fa/verify',
  logout:    '/api/auth/logout',
  oauthCode: '/api/auth/oauth/code',
};

const REDIRECT_KEY = 'auth_redirect';
const TOKEN_KEY    = 'access_token';
const GUEST_ID_KEY = 'chiyigo_guest_id';
const PWD_HIDE_MS  = 10_000;

// ── PKCE 模式偵測 ─────────────────────────────────────────────────
// pkce_key 由 GET /api/auth/oauth/authorize 產生，存在 URL ?pkce_key=...
const _pkceKey = new URLSearchParams(location.search).get('pkce_key');

// ── Cross-App Redirect 模式（子網域 SSO）────────────────────────────
// 外部子網域帶 ?redirect=https://talo.chiyigo.com 進入登入頁，
// 登入後把 access_token 帶回目標 origin。
const _CROSS_APP_WHITELIST = new Set([
  'https://talo.chiyigo.com',
  'https://mbti.chiyigo.com',
]);

const _ORIGIN_TO_AUD = {
  'https://talo.chiyigo.com': 'talo',
  'https://mbti.chiyigo.com': 'mbti',
};

const _crossAppOrigin = (() => {
  const r = new URLSearchParams(location.search).get('redirect');
  if (!r) return null;
  try {
    const origin = new URL(r).origin;
    return _CROSS_APP_WHITELIST.has(origin) ? origin : null;
  } catch { return null; }
})();

// 對應 JWT aud claim — 跨 app 登入時帶給後端，後端據此簽 aud
const _crossAppAud = _crossAppOrigin ? _ORIGIN_TO_AUD[_crossAppOrigin] : null;

function _decodeJwtPayload(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return {}; }
}

function handleCrossAppRedirect(accessToken) {
  const { email } = _decodeJwtPayload(accessToken);
  const params = new URLSearchParams({ mbti_token: accessToken });
  if (email) params.set('mbti_email', email);
  // 用 fragment 而非 query：避免 token 進入 Referer / server log / 瀏覽器歷史
  window.location.href = `${_crossAppOrigin}/#${params}`;
}

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

// ── JWT 儲存（Refresh Token 改由後端 HttpOnly Cookie 管理）────────

function saveToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}

// 以 HttpOnly Cookie 靜默換取新 access_token，成功回傳 true
async function refreshAccessToken() {
  try {
    const res = await fetch('/api/auth/refresh', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        '{}',
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.access_token) { saveToken(data.access_token); return true; }
    return false;
  } catch {
    return false;
  }
}

// ── 登出 ──────────────────────────────────────────────────────────

// OIDC RP-Initiated Logout：跳 chiyigo end_session_endpoint
// chiyigo 會撤所有 refresh + 嵌 iframe 同步登出 mbti / talo（front-channel logout）
function logout() {
  sessionStorage.removeItem(TOKEN_KEY);
  clearGuestId();
  const url = '/api/auth/oauth/end-session?post_logout_redirect_uri=' +
              encodeURIComponent('https://chiyigo.com/login');
  window.location.href = url;
}

// OIDC Front-Channel Logout 訊號：其他子站登出 → dashboard / 私密頁立刻清 token + 跳登入頁
// 監聽同源 localStorage 'oidc_logout_at' key 變化（由 frontchannel-logout.html iframe 寫入觸發）
window.addEventListener('storage', e => {
  if (e.key !== 'oidc_logout_at') return;
  sessionStorage.removeItem(TOKEN_KEY);
  // 已在 login / 公開頁就不再跳；私密頁（dashboard / admin / bind-email …）跳登入
  const path = location.pathname;
  const isPublic = path === '/' || path === '' || path.startsWith('/login') ||
                   path.startsWith('/index') || path.startsWith('/forgot-password') ||
                   path.startsWith('/reset-password') || path.startsWith('/verify-email');
  if (!isPublic) location.href = '/login.html';
});

// ── 成功後跳轉 ───────────────────────────────────────────────────

function redirectAfterAuth() {
  let target = sessionStorage.getItem(REDIRECT_KEY);
  if (!target) {
    try {
      const n = new URLSearchParams(location.search).get('next');
      if (n && n.charAt(0) === '/' && n.charAt(1) !== '/') target = n;
    } catch (_) {}
  }
  target = target || '/dashboard.html';
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
      showMsg(t(data.error) || uiT('err_pkce'));
      return;
    }
    // 跳轉至 App（chiyigo:// 或 loopback 或 https://）
    window.location.href = data.redirect_url;
  } catch {
    showMsg(uiT('err_network'));
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
    btn.classList.add('eye-active');
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
  if (btn) btn.classList.remove('eye-active');
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
      document.getElementById('tab-' + t).classList.toggle('active', t === tab);
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
  box.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success');
  box.style.display = 'block';
}

function clearMsg() {
  const box = document.getElementById('msg-box');
  box.style.display = 'none';
  box.textContent = '';
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? uiT('loading') : btn.dataset.label || btn.textContent;
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
  btn.dataset.label = uiT('btn_login');

  const tsToken = document.querySelector('#form-login [name="cf-turnstile-response"]')?.value || '';
  // Turnstile widget 在頁面有掛但用戶搶在驗證完成前點 → 給本地 i18n 提示，不送 request
  const hasTsWidget = !!document.querySelector('#form-login .cf-turnstile');
  if (hasTsWidget && !tsToken) {
    showMsg(uiT('err_captcha_pending'));
    return;
  }

  setLoading('login-btn', true);

  try {
    const res = await fetch(API.login, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({
        email, password,
        aud: _crossAppAud ?? undefined,
        'cf-turnstile-response': tsToken,
      }),
    });

    const data = await res.json();

    if (res.status === 403 && data.code === 'TOTP_REQUIRED') {
      _preAuthToken = data.pre_auth_token;
      switchTab('totp');
      document.getElementById('totp-code').focus();
      return;
    }

    if (!res.ok) {
      showMsg(t(data.error) || uiT('err_login_fail'));
      return;
    }

    saveToken(data.access_token);
    if (_pkceKey) { await handlePkceRedirect(data.access_token); return; }
    if (_crossAppOrigin) { handleCrossAppRedirect(data.access_token); return; }
    redirectAfterAuth();

  } catch {
    showMsg(uiT('err_network'));
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
  btn.dataset.label = uiT('btn_register');

  if (password.length < 8) {
    showMsg(uiT('err_pwd_short'));
    return;
  }

  if (password !== confirm) {
    showMsg(uiT('err_pwd_mismatch'));
    document.getElementById('reg-confirm').focus();
    return;
  }

  const tsToken = document.querySelector('#form-register [name="cf-turnstile-response"]')?.value || '';
  const hasTsWidget = !!document.querySelector('#form-register .cf-turnstile');
  if (hasTsWidget && !tsToken) {
    showMsg(uiT('err_captcha_pending'));
    return;
  }

  setLoading('reg-btn', true);

  try {
    const res = await fetch(API.register, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        email, password, guest_id,
        aud: _crossAppAud ?? undefined,
        'cf-turnstile-response': tsToken,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(t(data.error) || uiT('err_reg_fail'));
      return;
    }

    saveToken(data.access_token);
    clearGuestId();
    if (_pkceKey) { await handlePkceRedirect(data.access_token); return; }
    if (_crossAppOrigin) { handleCrossAppRedirect(data.access_token); return; }
    showMsg(uiT('reg_success'), 'success');
    setTimeout(redirectAfterAuth, 800);

  } catch {
    showMsg(uiT('err_network'));
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
  btn.dataset.label = uiT('btn_verify');

  if (!otp_code) {
    showMsg(uiT('err_otp_empty'));
    return;
  }
  if (!_preAuthToken) {
    showMsg(uiT('err_otp_expired'));
    switchTab('login');
    return;
  }

  setLoading('totp-btn', true);

  try {
    const res = await fetch(API.totp, {
      method:      'POST',
      credentials: 'include',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + _preAuthToken,
      },
      body: JSON.stringify({ otp_code, aud: _crossAppAud ?? undefined }),
    });

    const data = await res.json();

    if (!res.ok) {
      showMsg(t(data.error) || uiT('err_otp_invalid'));
      return;
    }

    _preAuthToken = null;
    saveToken(data.access_token);
    if (_pkceKey) { await handlePkceRedirect(data.access_token); return; }
    if (_crossAppOrigin) { handleCrossAppRedirect(data.access_token); return; }
    redirectAfterAuth();

  } catch {
    showMsg(uiT('err_network'));
  } finally {
    setLoading('totp-btn', false);
  }
}

// ── 初始化 ───────────────────────────────────────────────────────

(function init() {
  // 只在登入頁執行重導向邏輯（dashboard 等頁面載入此 js 只需 logout()）
  if (!document.getElementById('form-login')) return;

  // ── DOM event 綁定（HTML 用 data-* 宣告意圖，這裡集中綁 handler）─────
  // tab 切換：登入 / 註冊 / 2FA「← 返回登入」
  document.querySelectorAll('[data-switch-tab]').forEach(btn => {
    btn.addEventListener('click', e => { e.preventDefault(); switchTab(btn.dataset.switchTab); });
  });
  // 顯示密碼眼睛
  document.querySelectorAll('[data-toggle-pwd]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      togglePassword(btn.dataset.togglePwd, btn.dataset.toggleEye);
    });
  });
  // form submit
  document.getElementById('form-login')   ?.addEventListener('submit', handleLogin);
  document.getElementById('form-register')?.addEventListener('submit', handleRegister);
  document.getElementById('form-totp')    ?.addEventListener('submit', handleTotp);

  // Discord OAuth 回傳：URL 帶有 ?access_token=...
  const _urlToken = new URLSearchParams(location.search).get('access_token');
  if (_urlToken) {
    saveToken(_urlToken);
    history.replaceState(null, '', location.pathname);
    if (_crossAppOrigin) { handleCrossAppRedirect(_urlToken); return; }
    redirectAfterAuth();
    return;
  }

  // 已登入時：PKCE 模式繼續換碼，Cross-App 繼續跳轉，普通模式跳轉儀表板
  if (getToken()) {
    if (_pkceKey) { handlePkceRedirect(getToken()); return; }
    if (_crossAppOrigin) { handleCrossAppRedirect(getToken()); return; }
    redirectAfterAuth();
    return;
  }
  getOrCreateGuestId();
  if (_pkceKey) {
    const notice = document.getElementById('pkce-notice');
    if (notice) notice.classList.remove('hidden');
    // 將 pkce_key 帶入 OAuth 按鈕，讓社群登入也能在完成後回到正確頁面
    document.querySelectorAll('a[href*="/api/auth/oauth/"]').forEach(a => {
      try {
        const u = new URL(a.href, location.origin);
        u.searchParams.set('pkce_key', _pkceKey);
        a.href = u.toString();
      } catch { /* 忽略無效連結 */ }
    });
  }

  // 將 ?next=/path 帶入 OAuth init 連結，讓 OAuth 完成後 callback worker 能跳回原頁面
  // （local 登入由 redirectAfterAuth 處理；OAuth 走 worker 直接 redirect，需改 init 端）
  try {
    const _nextPath = new URLSearchParams(location.search).get('next');
    if (_nextPath && _nextPath.charAt(0) === '/' && _nextPath.charAt(1) !== '/') {
      document.querySelectorAll('a[href*="/api/auth/oauth/"]').forEach(a => {
        try {
          const u = new URL(a.href, location.origin);
          u.searchParams.set('next', _nextPath);
          a.href = u.toString();
        } catch { /* 忽略無效連結 */ }
      });
    }
  } catch (_) {}

  // Cross-app redirect：OAuth 會離開此頁再跳回，用 sessionStorage 保留目標 origin
  // 同時把 aud 注入 OAuth init 連結，讓後端 callback 簽出正確 aud 的 access_token
  if (_crossAppOrigin && _crossAppAud) {
    document.querySelectorAll('a[href*="/api/auth/oauth/"]').forEach(a => {
      try {
        const u = new URL(a.href, location.origin);
        if (!u.searchParams.has('aud')) {
          u.searchParams.set('aud', _crossAppAud);
          a.href = u.pathname + u.search + u.hash;
        }
      } catch { /* href 無法解析就略過 */ }
      a.addEventListener('click', () => {
        sessionStorage.setItem('_cross_app_redirect', _crossAppOrigin);
      }, { once: true });
    });
  }
})();

// bfcache 還原時：已登入 → 直接跳回 dashboard；未登入 → 清空欄位並重置到登入分頁
window.addEventListener('pageshow', (event) => {
  if (!document.getElementById('login-password')) return;
  if (event.persisted) {
    if (getToken()) {
      if (_crossAppOrigin) { handleCrossAppRedirect(getToken()); return; }
      window.location.replace('/dashboard.html');
      return;
    }
    // 清空所有欄位，防止帳號密碼殘留
    ['login-email', 'login-password',
     'reg-email', 'reg-password', 'reg-confirm', 'totp-code'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    // 重置回登入分頁（不殘留 2FA 面板）
    switchTab('login');
  }
  hidePassword('login-password', 'login-eye');
  hidePassword('reg-password',   'reg-eye');
  hidePassword('reg-confirm',    'reg-confirm-eye');
  clearTimeout(_pwdTimers['login-password']);
  clearTimeout(_pwdTimers['reg-password']);
  clearTimeout(_pwdTimers['reg-confirm']);
});
