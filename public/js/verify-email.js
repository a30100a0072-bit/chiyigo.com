// ── i18n ─────────────────────────────────────────────────────
const I18N = {
  'zh-TW': {
    back_login:'返回登入',
    title:'驗證 Email',
    desc:'請按下方按鈕完成 Email 驗證。連結 1 小時內有效，且僅能使用一次。',
    btn_verify:'確認驗證',
    err_missing:'缺少驗證 token，請從 Email 內連結再試一次。',
    loading_text:'驗證中…',
    success_title:'Email 驗證成功',
    success_desc:'即將為你跳轉至登入頁面…',
    btn_to_login:'前往登入',
    error_title:'驗證失敗',
    error_desc:'驗證連結已過期或已使用。請至 Dashboard 重新發送驗證信。',
    btn_to_dashboard:'前往 Dashboard',
    err_default:'驗證失敗，請稍後再試。',
    err_network:'網路錯誤，請稍後再試。',
  },
  en: {
    back_login:'Back to login',
    title:'Verify Email',
    desc:'Click the button below to complete email verification. The link is valid for 1 hour and can only be used once.',
    btn_verify:'Verify',
    err_missing:'Verification token is missing. Please try the link from your email again.',
    loading_text:'Verifying…',
    success_title:'Email verified',
    success_desc:'Redirecting you to the login page…',
    btn_to_login:'Go to Login',
    error_title:'Verification failed',
    error_desc:'The verification link has expired or already been used. Please request a new one from your dashboard.',
    btn_to_dashboard:'Go to Dashboard',
    err_default:'Verification failed, please try again later.',
    err_network:'Network error, please try again later.',
  },
  ja: {
    back_login:'ログインに戻る',
    title:'メールアドレスの確認',
    desc:'下のボタンを押してメール認証を完了してください。リンクは1時間有効で、1回のみ使用できます。',
    btn_verify:'認証する',
    err_missing:'認証トークンがありません。メール内のリンクからもう一度お試しください。',
    loading_text:'認証中…',
    success_title:'メール認証が完了しました',
    success_desc:'まもなくログインページへ移動します…',
    btn_to_login:'ログインへ',
    error_title:'認証に失敗しました',
    error_desc:'認証リンクの有効期限が切れているか、既に使用されています。ダッシュボードから再送信してください。',
    btn_to_dashboard:'ダッシュボードへ',
    err_default:'認証に失敗しました。後でお試しください。',
    err_network:'ネットワークエラーです。後でお試しください。',
  },
  ko: {
    back_login:'로그인으로 돌아가기',
    title:'이메일 인증',
    desc:'아래 버튼을 눌러 이메일 인증을 완료해 주세요. 링크는 1시간 동안 유효하며 한 번만 사용할 수 있습니다.',
    btn_verify:'인증 확인',
    err_missing:'인증 토큰이 없습니다. 이메일 내 링크에서 다시 시도해 주세요.',
    loading_text:'인증 중…',
    success_title:'이메일 인증 완료',
    success_desc:'잠시 후 로그인 페이지로 이동합니다…',
    btn_to_login:'로그인으로 이동',
    error_title:'인증 실패',
    error_desc:'인증 링크가 만료되었거나 이미 사용되었습니다. 대시보드에서 다시 발송해 주세요.',
    btn_to_dashboard:'대시보드로 이동',
    err_default:'인증에 실패했습니다. 잠시 후 다시 시도해 주세요.',
    err_network:'네트워크 오류입니다. 잠시 후 다시 시도해 주세요.',
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
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
}

function applyTheme(isLight) {
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.classList.toggle('theme-dark', !isLight);
  try { localStorage.setItem('theme', isLight ? 'light' : 'dark') } catch {}
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

// ── 驗證流程 ─────────────────────────────────────────────────
(() => {
  const params = new URLSearchParams(location.search)
  const token  = params.get('token')

  const panels = {
    confirm: document.getElementById('panel-confirm'),
    loading: document.getElementById('panel-loading'),
    success: document.getElementById('panel-success'),
    error:   document.getElementById('panel-error'),
  }
  const show = name => {
    Object.values(panels).forEach(p => p.classList.remove('active'))
    panels[name].classList.add('active')
  }

  if (!token) {
    document.getElementById('btn-verify').disabled = true
    document.getElementById('btn-verify').classList.add('opacity-50', 'cursor-not-allowed')
    document.getElementById('err-missing').classList.remove('hidden')
    return
  }

  document.getElementById('btn-verify').addEventListener('click', async () => {
    show('loading')
    try {
      const r = await fetch('/api/auth/email/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok) {
        show('success')
        setTimeout(() => { location.href = '/login.html?verified=1' }, 1500)
      } else {
        // 後端錯誤：保留 backend message（已經是英/中），無對應 i18n key 時 fallback
        document.getElementById('err-msg').textContent = data.error ?? T('err_default')
        show('error')
      }
    } catch {
      document.getElementById('err-msg').textContent = T('err_network')
      show('error')
    }
  })
})()
