const I18N = {
  'zh-TW': {
    back_login:'返回登入', title:'忘記密碼', subtitle:'輸入註冊信箱，我們將寄送重設連結',
    lbl_email:'電子信箱', btn_submit:'發送重設連結', btn_back_login:'返回登入',
    success_title:'信件已送出', success_desc:'如果該信箱已註冊，你將在幾分鐘內收到重設連結。<br/>連結有效期為 1 小時。',
    footer_note:'你的資料由 CHIYIGO 安全保管，100% 資料主權。',
    loading:'送出中…', err_generic:'請求失敗，請稍後再試。', err_network:'網路錯誤，請檢查連線後重試。',
  },
  en: {
    back_login:'Back to login', title:'Forgot Password', subtitle:'Enter your registered email; we will send a reset link.',
    lbl_email:'Email', btn_submit:'Send reset link', btn_back_login:'Back to login',
    success_title:'Email sent', success_desc:'If this email is registered, you will receive a reset link in a few minutes.<br/>The link is valid for 1 hour.',
    footer_note:'Your data is securely held by CHIYIGO — 100% data sovereignty.',
    loading:'Sending…', err_generic:'Request failed, please try again later.', err_network:'Network error, please check your connection.',
  },
  ja: {
    back_login:'ログインに戻る', title:'パスワードをお忘れですか', subtitle:'登録メールアドレスを入力してください。再設定リンクをお送りします。',
    lbl_email:'メールアドレス', btn_submit:'再設定リンクを送信', btn_back_login:'ログインに戻る',
    success_title:'メールを送信しました', success_desc:'登録済みのメールアドレスであれば、数分以内に再設定リンクが届きます。<br/>有効期限は1時間です。',
    footer_note:'あなたのデータはCHIYIGOで安全に保管されます。データ主権100%。',
    loading:'送信中…', err_generic:'リクエストに失敗しました。後でもう一度お試しください。', err_network:'ネットワークエラーです。接続を確認してください。',
  },
  ko: {
    back_login:'로그인으로 돌아가기', title:'비밀번호를 잊으셨나요', subtitle:'가입된 이메일을 입력하시면 재설정 링크를 보내드립니다.',
    lbl_email:'이메일', btn_submit:'재설정 링크 보내기', btn_back_login:'로그인으로 돌아가기',
    success_title:'이메일을 보냈습니다', success_desc:'등록된 이메일이라면 몇 분 안에 재설정 링크가 도착합니다.<br/>링크는 1시간 동안 유효합니다.',
    footer_note:'귀하의 데이터는 CHIYIGO에서 안전하게 보관됩니다 — 데이터 주권 100%.',
    loading:'전송 중…', err_generic:'요청이 실패했습니다. 잠시 후 다시 시도해 주세요.', err_network:'네트워크 오류입니다. 연결을 확인해 주세요.',
  },
};

function getLang() { try { return localStorage.getItem('lang') || 'zh-TW' } catch { return 'zh-TW' } }
function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }

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

async function handleSubmit(e) {
  e.preventDefault();
  const btn   = document.getElementById('submit-btn');
  const email = document.getElementById('email').value.trim();
  const orig  = btn.textContent;

  setMsg('');
  btn.disabled = true;
  btn.textContent = T('loading');

  try {
    const res = await fetch('/api/auth/local/forgot-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email }),
    });

    if (res.ok) {
      document.getElementById('form-forgot').classList.add('hidden');
      document.getElementById('success-state').classList.remove('hidden');
      return;
    }

    const data = await res.json().catch(() => ({}));
    setMsg(data.error ?? T('err_generic'), 'error');
  } catch {
    setMsg(T('err_network'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = T('btn_submit');
  }
}

function setMsg(text, type = 'error') {
  const box = document.getElementById('msg-box');
  if (!text) { box.classList.add('hidden'); return; }
  box.textContent = text;
  box.className = type === 'error'
    ? 'mb-5 px-4 py-3 rounded-lg text-sm font-medium bg-red-500/10 border border-red-500/20 text-red-400'
    : 'mb-5 px-4 py-3 rounded-lg text-sm font-medium bg-green-500/10 border border-green-500/20 text-green-400';
}

// ── Phase C-3 listener wiring ──
document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);
