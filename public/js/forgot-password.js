const I18N = {"zh-TW":{"title":"忘記密碼","subtitle":"輸入註冊信箱，我們將寄送重設連結","lbl_email":"電子信箱","btn_submit":"發送重設連結","btn_back_login":"返回登入","success_title":"信件已送出","success_desc":"如果該信箱已註冊，你將在幾分鐘內收到重設連結。\n連結有效期為 1 小時。","footer_note":"你的資料由 CHIYIGO 安全保管，100% 資料主權。","ts_loading_hint":"資安驗證準備中，可先填寫帳號","loading":"送出中…","err_generic":"請求失敗，請稍後再試。","err_network":"網路錯誤，請檢查連線後重試。","err_captcha_pending":"請先完成人機驗證。"},"en":{"title":"Forgot Password","subtitle":"Enter your registered email; we will send a reset link.","lbl_email":"Email","btn_submit":"Send reset link","btn_back_login":"Back to login","success_title":"Email sent","success_desc":"If this email is registered, you will receive a reset link in a few minutes.\nThe link is valid for 1 hour.","footer_note":"Your data is securely held by CHIYIGO — 100% data sovereignty.","ts_loading_hint":"Loading security check; you can fill the form first","loading":"Sending…","err_generic":"Request failed, please try again later.","err_network":"Network error, please check your connection.","err_captcha_pending":"Please complete the CAPTCHA first."},"ja":{"title":"パスワードをお忘れですか","subtitle":"登録メールアドレスを入力してください。再設定リンクをお送りします。","lbl_email":"メールアドレス","btn_submit":"再設定リンクを送信","btn_back_login":"ログインに戻る","success_title":"メールを送信しました","success_desc":"登録済みのメールアドレスであれば、数分以内に再設定リンクが届きます。\n有効期限は1時間です。","footer_note":"あなたのデータはCHIYIGOで安全に保管されます。データ主権100%。","ts_loading_hint":"認証準備中、先に入力できます","loading":"送信中…","err_generic":"リクエストに失敗しました。後でもう一度お試しください。","err_network":"ネットワークエラーです。接続を確認してください。","err_captcha_pending":"先に認証を完了してください。"},"ko":{"title":"비밀번호를 잊으셨나요","subtitle":"가입된 이메일을 입력하시면 재설정 링크를 보내드립니다.","lbl_email":"이메일","btn_submit":"재설정 링크 보내기","btn_back_login":"로그인으로 돌아가기","success_title":"이메일을 보냈습니다","success_desc":"등록된 이메일이라면 몇 분 안에 재설정 링크가 도착합니다.\n링크는 1시간 동안 유효합니다.","footer_note":"귀하의 데이터는 CHIYIGO에서 안전하게 보관됩니다 — 데이터 주권 100%.","ts_loading_hint":"인증 준비 중, 먼저 입력 가능","loading":"전송 중…","err_generic":"요청이 실패했습니다. 잠시 후 다시 시도해 주세요.","err_network":"네트워크 오류입니다. 연결을 확인해 주세요.","err_captcha_pending":"먼저 캡차 인증을 완료해 주세요."}};

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

function applyPageI18n(lang) {
  const dict = I18N[lang] || I18N['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (dict[k] != null) el.textContent = dict[k];
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyPageI18n(getLang());
  // theme/lang 切換交給 sidebar-auth.js / 各頁 page JS（partial 提供 #theme-toggle-btn / #lang-toggle-btn / #lang-dropdown）
});

async function handleSubmit(e) {
  e.preventDefault();
  const btn   = document.getElementById('submit-btn');
  const email = document.getElementById('email').value.trim();

  setMsg('');

  const tsToken = document.querySelector('#form-forgot [name="cf-turnstile-response"]')?.value || '';
  const hasTsWidget = !!document.querySelector('#form-forgot .cf-turnstile');
  if (hasTsWidget && !tsToken) {
    setMsg(T('err_captcha_pending'), 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = T('loading');

  try {
    const res = await fetch('/api/auth/local/forgot-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, 'cf-turnstile-response': tsToken }),
    });

    if (res.ok) {
      document.getElementById('form-forgot').hidden = true;
      document.getElementById('success-state').hidden = false;
      return;
    }

    const data = await res.json().catch(() => ({}));
    setMsg(data.error ?? T('err_generic'), 'error');
    try { window.turnstile?.reset?.() } catch {}
  } catch {
    setMsg(T('err_network'), 'error');
    try { window.turnstile?.reset?.() } catch {}
  } finally {
    btn.disabled = false;
    btn.textContent = T('btn_submit');
  }
}

function setMsg(text, type = 'error') {
  const box = document.getElementById('msg-box');
  if (!text) { box.style.display = 'none'; box.textContent = ''; return; }
  box.textContent = text;
  box.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success');
  box.style.display = 'block';
}

document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);
