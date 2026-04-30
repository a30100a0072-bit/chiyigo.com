// ── i18n 字典 ────────────────────────────────────────────────
const I18N = {
  'zh-TW': {
    back_login:'返回登入', title:'重設密碼', subtitle:'請輸入你的新密碼',
    lbl_new_pwd:'新密碼', lbl_confirm_pwd:'確認新密碼',
    pwd_rule:'密碼需 ≥12 字元，或 ≥8 字元並包含「大寫、小寫、數字、符號」其中任 3 類。',
    btn_reset:'重設密碼', btn_verify_reset:'驗證並重設密碼', btn_back_pwd:'← 重新輸入新密碼',
    tfa_hint:'此帳號已啟用雙重驗證<br/>請輸入驗證碼後繼續重設密碼',
    lbl_otp:'驗證碼', ph_otp:'000000 或 備用救援碼',
    success_title:'密碼重設成功', success_desc:'所有裝置的登入階段已撤銷，請重新登入。', countdown_suffix:'秒後自動跳轉…',
    invalid_title:'連結無效或已過期', invalid_desc:'重設連結僅能使用一次，且有效期為 1 小時。', btn_request_new:'重新申請重設連結',
    footer_note:'你的資料由 CHIYIGO 安全保管，100% 資料主權。',
    err_pwd_mismatch:'兩次輸入的密碼不一致。', err_pwd_short:'密碼至少需要 8 個字元。',
    err_otp_empty:'請輸入驗證碼。', err_generic:'發生錯誤，請稍後再試。', err_network:'網路錯誤，請檢查連線後重試。',
    loading:'處理中…',
  },
  en: {
    back_login:'Back to login', title:'Reset Password', subtitle:'Enter your new password',
    lbl_new_pwd:'New password', lbl_confirm_pwd:'Confirm new password',
    pwd_rule:'Password must be ≥12 chars, or ≥8 chars with 3 of: uppercase / lowercase / digit / symbol.',
    btn_reset:'Reset password', btn_verify_reset:'Verify & reset password', btn_back_pwd:'← Re-enter new password',
    tfa_hint:'This account has 2FA enabled.<br/>Enter your code to continue.',
    lbl_otp:'Verification code', ph_otp:'000000 or backup code',
    success_title:'Password reset successful', success_desc:'All sessions have been revoked. Please log in again.', countdown_suffix:'sec, redirecting…',
    invalid_title:'Link invalid or expired', invalid_desc:'Reset links are single-use and valid for 1 hour.', btn_request_new:'Request a new link',
    footer_note:'Your data is securely held by CHIYIGO — 100% data sovereignty.',
    err_pwd_mismatch:'Passwords do not match.', err_pwd_short:'Password must be at least 8 characters.',
    err_otp_empty:'Please enter the verification code.', err_generic:'Something went wrong, please try again later.', err_network:'Network error, please check your connection.',
    loading:'Processing…',
  },
  ja: {
    back_login:'ログインに戻る', title:'パスワードを再設定', subtitle:'新しいパスワードを入力してください',
    lbl_new_pwd:'新しいパスワード', lbl_confirm_pwd:'新しいパスワード（確認）',
    pwd_rule:'パスワードは12文字以上、または8文字以上で大文字／小文字／数字／記号のうち3種を含めてください。',
    btn_reset:'パスワードを再設定', btn_verify_reset:'認証して再設定', btn_back_pwd:'← パスワードを再入力',
    tfa_hint:'このアカウントは2段階認証が有効です。<br/>認証コードを入力して続行してください。',
    lbl_otp:'認証コード', ph_otp:'000000 またはバックアップコード',
    success_title:'パスワードを再設定しました', success_desc:'すべてのセッションが取り消されました。再度ログインしてください。', countdown_suffix:'秒後に自動移動…',
    invalid_title:'リンクが無効または期限切れです', invalid_desc:'再設定リンクは1回限り、有効期限は1時間です。', btn_request_new:'新しいリンクを申請',
    footer_note:'あなたのデータはCHIYIGOで安全に保管されます。データ主権100%。',
    err_pwd_mismatch:'パスワードが一致しません。', err_pwd_short:'パスワードは8文字以上で入力してください。',
    err_otp_empty:'認証コードを入力してください。', err_generic:'エラーが発生しました。後でもう一度お試しください。', err_network:'ネットワークエラーです。接続を確認してください。',
    loading:'処理中…',
  },
  ko: {
    back_login:'로그인으로 돌아가기', title:'비밀번호 재설정', subtitle:'새 비밀번호를 입력하세요',
    lbl_new_pwd:'새 비밀번호', lbl_confirm_pwd:'새 비밀번호 확인',
    pwd_rule:'비밀번호는 12자 이상이거나, 8자 이상이며 대문자/소문자/숫자/기호 중 3종을 포함해야 합니다.',
    btn_reset:'비밀번호 재설정', btn_verify_reset:'인증 후 재설정', btn_back_pwd:'← 새 비밀번호 다시 입력',
    tfa_hint:'이 계정은 2단계 인증이 활성화되어 있습니다.<br/>인증 코드를 입력하여 계속하세요.',
    lbl_otp:'인증 코드', ph_otp:'000000 또는 백업 코드',
    success_title:'비밀번호 재설정 완료', success_desc:'모든 세션이 해지되었습니다. 다시 로그인해 주세요.', countdown_suffix:'초 후 이동…',
    invalid_title:'링크가 유효하지 않거나 만료됨', invalid_desc:'재설정 링크는 1회만 사용 가능하며 유효기간은 1시간입니다.', btn_request_new:'새 링크 요청',
    footer_note:'귀하의 데이터는 CHIYIGO에서 안전하게 보관됩니다 — 데이터 주권 100%.',
    err_pwd_mismatch:'비밀번호가 일치하지 않습니다.', err_pwd_short:'비밀번호는 8자 이상이어야 합니다.',
    err_otp_empty:'인증 코드를 입력해 주세요.', err_generic:'오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', err_network:'네트워크 오류입니다. 연결을 확인해 주세요.',
    loading:'처리 중…',
  },
};

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

// 後端英文錯誤訊息 → 4 語對照（fallback 到原訊息）
const BACKEND_ERR = {
  'Password must be ≥12 chars, or ≥8 chars with 3 of: uppercase / lowercase / digit / symbol': {
    'zh-TW':'密碼長度需 ≥12 字元，或 ≥8 字元並包含「大寫字母 / 小寫字母 / 數字 / 符號」其中 3 類。',
    en:'Password must be ≥12 chars, or ≥8 chars and contain 3 of: uppercase / lowercase / digit / symbol.',
    ja:'パスワードは12文字以上、または8文字以上で「大文字 / 小文字 / 数字 / 記号」のうち3種を含めてください。',
    ko:'비밀번호는 12자 이상, 또는 8자 이상이며 대문자 / 소문자 / 숫자 / 기호 중 3종을 포함해야 합니다.',
  },
  'Password must be at least 8 characters': {
    'zh-TW':'密碼至少需要 8 個字元。', en:'Password must be at least 8 characters.',
    ja:'パスワードは8文字以上で入力してください。', ko:'비밀번호는 8자 이상이어야 합니다.',
  },
  'Invalid OTP or backup code': {
    'zh-TW':'驗證碼錯誤，請重試。', en:'Invalid code, please try again.',
    ja:'認証コードが正しくありません。もう一度お試しください。', ko:'인증 코드가 올바르지 않습니다. 다시 시도해 주세요.',
  },
};
function tBackend(msg) {
  const e = BACKEND_ERR[msg]; if (!e) return msg;
  return e[getLang()] || e['zh-TW'] || msg;
}

function applyLang(lang) {
  try { localStorage.setItem('lang', lang) } catch {}
  document.documentElement.lang = lang;
  const dict = I18N[lang] || I18N['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (dict[k] != null) el.textContent = dict[k];
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    const k = el.dataset.i18nHtml; if (dict[k] != null) el.innerHTML = dict[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh; if (dict[k] != null) el.placeholder = dict[k];
  });
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

function applyTheme(isLight) {
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.classList.toggle('theme-dark', !isLight);
  try { localStorage.setItem('theme', isLight ? 'light' : 'dark') } catch {}
  document.getElementById('theme-icon-dark').classList.toggle('hidden', isLight);
  document.getElementById('theme-icon-light').classList.toggle('hidden', !isLight);
}

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
  applyTheme(document.documentElement.classList.contains('theme-light'));

  document.getElementById('theme-btn').addEventListener('click', () => {
    applyTheme(!document.documentElement.classList.contains('theme-light'));
  });
  const langMenu = document.getElementById('lang-menu');
  document.getElementById('lang-btn').addEventListener('click', e => {
    e.stopPropagation(); langMenu.classList.toggle('open');
  });
  langMenu.querySelectorAll('.lang-opt').forEach(opt => {
    opt.addEventListener('click', () => { applyLang(opt.dataset.lang); langMenu.classList.remove('open'); });
  });
  document.addEventListener('click', () => langMenu.classList.remove('open'));
});

// ── 狀態 ─────────────────────────────────────────────────────
const token = new URLSearchParams(location.search).get('token') ?? '';
let newPassword = '';

if (!token) showPanel('panel-invalid');

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  setMsg('');
}

function setMsg(text, type = 'error') {
  const box = document.getElementById('msg-box');
  if (!text) { box.classList.add('hidden'); return; }
  box.textContent = text;
  box.className = type === 'error'
    ? 'mb-5 px-4 py-3 rounded-lg text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400'
    : 'mb-5 px-4 py-3 rounded-lg text-sm font-medium bg-green-500/10 border border-green-500/20 text-green-400';
}

function togglePwd(inputId, iconId) {
  const input = document.getElementById(inputId);
  const icon  = document.getElementById(iconId);
  const show  = input.type === 'password';
  input.type  = show ? 'text' : 'password';
  icon.style.opacity = show ? '0.5' : '1';
}

async function handlePasswordSubmit(e) {
  e.preventDefault();
  const pwd     = document.getElementById('new-password').value;
  const confirm = document.getElementById('confirm-password').value;
  const btn     = document.getElementById('pwd-btn');
  if (pwd !== confirm) { setMsg(T('err_pwd_mismatch')); return; }
  if (pwd.length < 8)  { setMsg(T('err_pwd_short')); return; }
  newPassword = pwd;
  await submitReset(btn, 'pwd-btn', null);
}

async function handle2faSubmit(e) {
  e.preventDefault();
  const code = document.getElementById('totp-code').value.trim();
  const btn  = document.getElementById('totp-btn');
  if (!code) { setMsg(T('err_otp_empty')); return; }
  await submitReset(btn, 'totp-btn', code);
}

async function submitReset(btn, btnId, totpCode) {
  btn.disabled    = true;
  btn.textContent = T('loading');
  setMsg('');

  const body = { token, new_password: newPassword };
  if (totpCode) body.totp_code = totpCode;

  try {
    const res  = await fetch('/api/auth/local/reset-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) { showPanel('panel-success'); startCountdown(); return; }

    if (res.status === 403 && data.requires_2fa) {
      showPanel('panel-2fa');
      document.getElementById('totp-code').focus();
      return;
    }

    if (res.status === 400 && data.error?.includes('invalid or has expired')) {
      showPanel('panel-invalid'); return;
    }

    setMsg(data.error ? tBackend(data.error) : T('err_generic'));
  } catch {
    setMsg(T('err_network'));
  } finally {
    btn.disabled    = false;
    btn.textContent = btnId === 'pwd-btn' ? T('btn_reset') : T('btn_verify_reset');
  }
}

function startCountdown() {
  let sec = 3;
  const el = document.getElementById('countdown');
  const iv = setInterval(() => {
    sec--; el.textContent = sec;
    if (sec <= 0) { clearInterval(iv); location.href = '/login.html?password_reset=1'; }
  }, 1000);
}
