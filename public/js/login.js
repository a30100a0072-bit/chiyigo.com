// Query param notifications
(function(){
  const p = new URLSearchParams(location.search);
  function showNotice(text, type) {
    const el = document.createElement('div');
    el.textContent = text;
    el.className = 'pre-notice ' + (type === 'ok' ? 'msg-success' : 'msg-error');
    el.style.display = 'block';
    const card = document.querySelector('.card');
    if (card) card.insertAdjacentElement('beforebegin', el);
  }
  if (p.has('verified')) {
    showNotice('✓ Email 驗證成功！請登入你的帳號。', 'ok');
    history.replaceState(null, '', '/login.html');
  } else if (p.has('verify_error')) {
    showNotice('驗證連結無效或已過期，請重新申請。', 'err');
    history.replaceState(null, '', '/login.html');
  } else if (p.has('password_reset')) {
    showNotice('✓ 密碼重設成功！請使用新密碼登入。', 'ok');
    history.replaceState(null, '', '/login.html');
  }
})();

// Theme toggle
function applyTheme(isDark) {
  document.documentElement.classList.toggle('theme-dark', isDark);
  document.documentElement.classList.toggle('theme-light', !isDark);
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  const dark = document.documentElement.classList.contains('theme-dark');
  document.querySelectorAll('.icon-sun').forEach(el => el.hidden = dark);
  document.querySelectorAll('.icon-moon').forEach(el => el.hidden = !dark);
}
(function initIcons() {
  const dark = document.documentElement.classList.contains('theme-dark');
  document.querySelectorAll('.icon-sun').forEach(el => el.hidden = dark);
  document.querySelectorAll('.icon-moon').forEach(el => el.hidden = !dark);
})();
document.getElementById('theme-toggle-btn').addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('theme-dark')));
document.getElementById('m-theme-btn').addEventListener('click', () => applyTheme(!document.documentElement.classList.contains('theme-dark')));

// Mobile overlay
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
function openMenu() {
  hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open');
  overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden');
  document.body.style.overflow = 'hidden';
}
function closeMenu() {
  hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open');
  overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true');
  document.body.style.overflow = '';
}
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

// ── i18n ──────────────────────────────────────────────
const LANGS_I18N = {"zh-TW":{"status_open":"接案中","nav_home":"首頁","nav_services":"服務項目","nav_process":"服務流程","nav_portfolio":"案例作品","nav_about":"關於我們","nav_contact":"接案諮詢","cta_btn_m":"開始諮詢 →","sb_cta_desc":"讓我一起打造最適合你的數位解決方案！","sb_cta_btn":"開始諮詢","sb_login_link":"會員登入","tab_login":"登入","tab_register":"註冊","login_email_lbl":"電子信箱","login_pass_lbl":"密碼","login_btn":"登入","forgot_link":"忘記密碼？","divider_or":"或","reg_pass_lbl":"密碼","reg_pass_hint":"（最少 8 字元）","reg_confirm_lbl":"確認密碼","reg_pass_rule":"密碼長度需 ≥12 字元，或 ≥8 字元並包含「大寫字母 / 小寫字母 / 數字 / 符號」其中 3 類。","reg_btn":"建立帳號","reg_notice":"建立帳號即代表你同意我們的服務條款與隱私政策。","totp_desc":"請輸入驗證器 App 顯示的 6 位數字，或使用備用救援碼。","totp_code_lbl":"驗證碼","totp_code_ph":"000000 或 備用救援碼","totp_btn":"驗證","totp_back":"← 返回登入","pkce_notice":"你正在授權 CHIYIGO 應用程式登入。登入後將自動返回 App。","data_notice":"你的資料由 CHIYIGO 安全保管，100% 資料主權。","tab_login_title":"歡迎回來","tab_login_sub":"登入你的 CHIYIGO 帳號","tab_register_title":"建立帳號","tab_register_sub":"開始你的 CHIYIGO 旅程","tab_totp_title":"兩步驗證","tab_totp_sub":"請完成身份驗證以繼續","member_center":"會員中心","logout":"登出"},"en":{"status_open":"Available","nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","cta_btn_m":"Get Started →","sb_cta_desc":"Let's build the perfect digital solution for you!","sb_cta_btn":"Get Started","sb_login_link":"Member Login","tab_login":"Login","tab_register":"Register","login_email_lbl":"Email","login_pass_lbl":"Password","login_btn":"Log In","forgot_link":"Forgot password?","divider_or":"or","reg_pass_lbl":"Password","reg_pass_hint":"(min. 8 chars)","reg_confirm_lbl":"Confirm Password","reg_pass_rule":"Password must be ≥12 chars, or ≥8 chars and contain 3 of: uppercase / lowercase / digit / symbol.","reg_btn":"Create Account","reg_notice":"By creating an account, you agree to our Terms of Service and Privacy Policy.","totp_desc":"Enter the 6-digit code from your authenticator app, or use a backup recovery code.","totp_code_lbl":"Code","totp_code_ph":"000000 or backup code","totp_btn":"Verify","totp_back":"← Back to Login","pkce_notice":"You're authorizing the CHIYIGO app. You'll be redirected back after login.","data_notice":"Your data is securely managed by CHIYIGO, 100% data sovereignty.","tab_login_title":"Welcome Back","tab_login_sub":"Sign in to your CHIYIGO account","tab_register_title":"Create Account","tab_register_sub":"Start your CHIYIGO journey","tab_totp_title":"Two-Step Verification","tab_totp_sub":"Complete verification to continue","member_center":"Member Center","logout":"Sign Out"},"ja":{"status_open":"受付中","nav_home":"ホーム","nav_services":"サービス","nav_process":"流れ","nav_portfolio":"事例","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_btn_m":"相談を始める →","sb_cta_desc":"あなたに最適なデジタルソリューションを一緒に構築しましょう！","sb_cta_btn":"相談を始める","sb_login_link":"会員ログイン","tab_login":"ログイン","tab_register":"登録","login_email_lbl":"メールアドレス","login_pass_lbl":"パスワード","login_btn":"ログイン","forgot_link":"パスワードをお忘れの方","divider_or":"または","reg_pass_lbl":"パスワード","reg_pass_hint":"（8文字以上）","reg_confirm_lbl":"パスワード確認","reg_pass_rule":"パスワードは12文字以上、または8文字以上で「大文字 / 小文字 / 数字 / 記号」のうち3種を含めてください。","reg_btn":"アカウント作成","reg_notice":"アカウントを作成することで、利用規約とプライバシーポリシーに同意したことになります。","totp_desc":"認証アプリに表示された6桁のコードを入力するか、予備の救援コードを使用してください。","totp_code_lbl":"認証コード","totp_code_ph":"000000 またはバックアップコード","totp_btn":"認証","totp_back":"← ログインに戻る","pkce_notice":"CHIYIGOアプリの認証を行っています。ログイン後、自動的にアプリに戻ります。","data_notice":"あなたのデータはCHIYIGOが安全に管理しています。100%データ主権。","tab_login_title":"おかえりなさい","tab_login_sub":"CHIYIGOアカウントにログイン","tab_register_title":"アカウント作成","tab_register_sub":"CHIYIGOの旅を始めましょう","tab_totp_title":"2段階認証","tab_totp_sub":"認証を完了してください","member_center":"メンバーセンター","logout":"ログアウト"},"ko":{"status_open":"수주 중","nav_home":"홈","nav_services":"서비스","nav_process":"프로세스","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의","cta_btn_m":"시작하기 →","sb_cta_desc":"함께 최적의 디지털 솔루션을 만들어 드리겠습니다!","sb_cta_btn":"시작하기","sb_login_link":"회원 로그인","tab_login":"로그인","tab_register":"회원가입","login_email_lbl":"이메일","login_pass_lbl":"비밀번호","login_btn":"로그인","forgot_link":"비밀번호를 잊으셨나요?","divider_or":"또는","reg_pass_lbl":"비밀번호","reg_pass_hint":"(최소 8자)","reg_confirm_lbl":"비밀번호 확인","reg_pass_rule":"비밀번호는 12자 이상, 또는 8자 이상이며 대문자 / 소문자 / 숫자 / 기호 중 3종을 포함해야 합니다.","reg_btn":"계정 만들기","reg_notice":"계정을 만들면 서비스 약관 및 개인정보 처리방침에 동의하는 것으로 간주됩니다.","totp_desc":"인증 앱에 표시된 6자리 코드를 입력하거나, 백업 복구 코드를 사용하세요.","totp_code_lbl":"인증 코드","totp_code_ph":"000000 또는 백업 코드","totp_btn":"인증","totp_back":"← 로그인으로 돌아가기","pkce_notice":"CHIYIGO 앱을 승인하고 있습니다. 로그인 후 자동으로 앱으로 돌아갑니다.","data_notice":"귀하의 데이터는 CHIYIGO가 안전하게 관리하며, 100% 데이터 주권을 보장합니다.","tab_login_title":"환영합니다","tab_login_sub":"CHIYIGO 계정에 로그인","tab_register_title":"계정 만들기","tab_register_sub":"CHIYIGO 여정을 시작하세요","tab_totp_title":"2단계 인증","tab_totp_sub":"인증을 완료해 주세요","member_center":"회원 센터","logout":"로그아웃"}};

const TAB_TITLES = {
  login:    { title: 'tab_login_title',    subtitle: 'tab_login_sub' },
  register: { title: 'tab_register_title', subtitle: 'tab_register_sub' },
  totp:     { title: 'tab_totp_title',     subtitle: 'tab_totp_sub' },
};

function applyLangI(lang) {
  localStorage.setItem('lang', lang);
  const t = LANGS_I18N[lang] || LANGS_I18N['zh-TW'];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n; if (t[k] !== undefined) el.textContent = t[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh; if (t[k] !== undefined) el.placeholder = t[k];
  });
  document.querySelectorAll('.lang-opt,.m-ov-lang-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
  // patch TAB_CONFIG and re-apply current tab title/subtitle
  if (typeof TAB_CONFIG !== 'undefined') {
    TAB_CONFIG.login    = { title: t.tab_login_title,    subtitle: t.tab_login_sub,    showTabs: true };
    TAB_CONFIG.register = { title: t.tab_register_title, subtitle: t.tab_register_sub, showTabs: true };
    TAB_CONFIG.totp     = { title: t.tab_totp_title,     subtitle: t.tab_totp_sub,     showTabs: false };
    const activePanelId = document.querySelector('.panel.active')?.id ?? 'form-login';
    const tabKey = activePanelId.replace('form-','');
    const titleEl    = document.getElementById('form-title');
    const subtitleEl = document.getElementById('form-subtitle');
    if (titleEl && TAB_CONFIG[tabKey])    titleEl.textContent    = TAB_CONFIG[tabKey].title;
    if (subtitleEl && TAB_CONFIG[tabKey]) subtitleEl.textContent = TAB_CONFIG[tabKey].subtitle;
  }
}

const curLangI = localStorage.getItem('lang') || 'zh-TW';
applyLangI(curLangI);

const langDropI = document.getElementById('lang-drop-i');
function toggleLangDrop(e) {
  e.stopPropagation();
  langDropI?.classList.toggle('open');
  document.getElementById('m-top-lang-drop')?.classList.remove('open');
}
function toggleTopLangDrop(e) {
  e.stopPropagation();
  document.getElementById('m-top-lang-drop')?.classList.toggle('open');
  langDropI?.classList.remove('open');
}
document.addEventListener('click', () => {
  langDropI?.classList.remove('open');
  document.getElementById('m-top-lang-drop')?.classList.remove('open');
});
langDropI?.addEventListener('click', e => {
  const opt = e.target.closest('.lang-opt'); if (!opt) return;
  applyLangI(opt.dataset.lang); langDropI.classList.remove('open');
});
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => {
  const opt = e.target.closest('.lang-opt'); if (!opt) return;
  applyLangI(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open');
});
document.querySelector('.m-ov-lang-row')?.addEventListener('click', e => {
  const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return;
  applyLangI(opt.dataset.lang);
});

// ── Drag-to-close (bottom sheet swipe down) ──────────
;(function () {
  const THRESHOLD = 110
  let startY = 0, lastY = 0, active = false
  document.addEventListener('touchstart', function (e) {
    const ov = document.getElementById('m-overlay')
    if (!ov || !ov.classList.contains('is-open')) return
    const wrap = ov.querySelector('.m-ov-wrap')
    if (!wrap) return
    const t = e.touches[0], r = wrap.getBoundingClientRect()
    if (t.clientY < r.top || t.clientY > r.bottom) return
    const nav = wrap.querySelector('.m-ov-nav')
    if (nav && nav.scrollTop > 0) {
      const nr = nav.getBoundingClientRect()
      if (t.clientY >= nr.top && t.clientY <= nr.bottom) return
    }
    startY = t.clientY; lastY = startY; active = true
    wrap.style.transition = 'none'
  }, { passive: true })
  document.addEventListener('touchmove', function (e) {
    if (!active) return
    lastY = e.touches[0].clientY
    const dy = lastY - startY
    if (dy <= 0) return
    const ov = document.getElementById('m-overlay')
    const wrap = ov && ov.querySelector('.m-ov-wrap')
    if (!wrap) return
    wrap.style.transform = `translateY(${dy}px)`
    const ratio = Math.max(0, 1 - dy / wrap.offsetHeight * 1.5)
    ov.style.background = `rgba(10,12,28,${(0.32 * ratio).toFixed(3)})`
    e.preventDefault()
  }, { passive: false })
  document.addEventListener('touchend', function () {
    if (!active) return
    active = false
    const ov = document.getElementById('m-overlay')
    const wrap = ov && ov.querySelector('.m-ov-wrap')
    if (!wrap) { startY = 0; lastY = 0; return }
    const dy = lastY - startY
    ov.style.background = ''
    if (dy > THRESHOLD) {
      wrap.style.transition = 'transform .26s ease'
      wrap.style.transform = 'translateY(100%)'
      setTimeout(() => {
        wrap.style.transform = ''; wrap.style.transition = ''
        ov.classList.remove('is-open')
        ov.setAttribute('aria-hidden', 'true')
        const btn = document.getElementById('m-ham-btn')
        btn?.classList.remove('is-open')
        btn?.setAttribute('aria-expanded', 'false')
        document.getElementById('m-topbar')?.classList.remove('menu-open')
        document.body.style.overflow = ''
      }, 260)
    } else {
      wrap.style.transition = 'transform .42s cubic-bezier(.22,1,.36,1)'
      wrap.style.transform = ''
      setTimeout(() => { wrap.style.transition = '' }, 420)
    }
    startY = 0; lastY = 0
  }, { passive: true })
})()
