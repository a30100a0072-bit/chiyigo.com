// ── i18n ─────────────────────────────────────────────────────
const I18N = {"zh-TW":{"status_open":"接案中","nav_home":"首頁","nav_services":"服務項目與流程","nav_portfolio":"chiyigo作品","nav_about":"關於我們","nav_contact":"需求諮詢","cta_btn_m":"開始諮詢 →","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","login":"會員登入","member_center":"會員中心","logout":"登出","back_login":"返回登入","title":"補填信箱","subtitle":"你的帳號尚未綁定信箱，請輸入以完成登入","lbl_email":"電子信箱","btn_submit":"確認並登入","hint_purpose":"此信箱將用於帳號識別與安全通知。","invalid_title":"連結無效或已過期","invalid_desc":"此連結僅能使用一次，且有效期為 10 分鐘。","btn_relogin":"重新登入","footer_note":"你的資料由 CHIYIGO 安全保管，100% 資料主權。","loading":"處理中…","err_default":"發生錯誤，請重試。","err_network":"網路錯誤，請檢查連線後重試。"},"en":{"status_open":"Available","nav_home":"Home","nav_services":"Services & Process","nav_portfolio":"chiyigo Portfolio","nav_about":"About chiyigo","nav_contact":"Inquiry","cta_btn_m":"Get Started →","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get Started","login":"Member Login","member_center":"Member Center","logout":"Sign Out","back_login":"Back to login","title":"Add Email","subtitle":"Your account has no email yet — please enter one to complete sign-in.","lbl_email":"Email","btn_submit":"Confirm & Sign in","hint_purpose":"This email will be used for account identification and security notifications.","invalid_title":"Link invalid or expired","invalid_desc":"This link can only be used once, and is valid for 10 minutes.","btn_relogin":"Sign in again","footer_note":"Your data is securely held by CHIYIGO — 100% data sovereignty.","loading":"Processing…","err_default":"An error occurred. Please try again.","err_network":"Network error, please check your connection and retry."},"ja":{"status_open":"受付中","nav_home":"ホーム","nav_services":"サービスとプロセス","nav_portfolio":"chiyigoの実績","nav_about":"chiyigoについて","nav_contact":"お問い合わせ","cta_btn_m":"相談を始める →","cta_desc":"あなたに最適なデジタルソリューションを一緒に構築しましょう！","cta_btn":"相談を始める","login":"会員ログイン","member_center":"メンバーセンター","logout":"ログアウト","back_login":"ログインに戻る","title":"メールアドレスの追加","subtitle":"アカウントにメールアドレスが登録されていません。ログインを完了するため入力してください。","lbl_email":"メールアドレス","btn_submit":"確認してログイン","hint_purpose":"このメールアドレスはアカウント識別とセキュリティ通知に使用されます。","invalid_title":"リンクが無効または期限切れです","invalid_desc":"このリンクは1回のみ使用でき、有効期限は10分です。","btn_relogin":"再ログイン","footer_note":"あなたのデータはCHIYIGOで安全に保管されます。データ主権100%。","loading":"処理中…","err_default":"エラーが発生しました。もう一度お試しください。","err_network":"ネットワークエラーです。接続を確認してください。"},"ko":{"status_open":"수주 중","nav_home":"홈","nav_services":"서비스 & 프로세스","nav_portfolio":"chiyigo 포트폴리오","nav_about":"chiyigo 소개","nav_contact":"문의하기","cta_btn_m":"시작하기 →","cta_desc":"함께 최적의 디지털 솔루션을 만들어 드리겠습니다!","cta_btn":"시작하기","login":"회원 로그인","member_center":"회원 센터","logout":"로그아웃","back_login":"로그인으로 돌아가기","title":"이메일 추가","subtitle":"계정에 이메일이 등록되어 있지 않습니다. 로그인을 완료하려면 입력해 주세요.","lbl_email":"이메일","btn_submit":"확인하고 로그인","hint_purpose":"이 이메일은 계정 식별 및 보안 알림에 사용됩니다.","invalid_title":"링크가 유효하지 않거나 만료됨","invalid_desc":"이 링크는 한 번만 사용할 수 있으며, 유효 기간은 10분입니다.","btn_relogin":"다시 로그인","footer_note":"귀하의 데이터는 CHIYIGO에서 안전하게 보관됩니다 — 데이터 주권 100%.","loading":"처리 중…","err_default":"오류가 발생했습니다. 다시 시도해 주세요.","err_network":"네트워크 오류입니다. 연결을 확인해 주세요."}};

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

document.addEventListener('DOMContentLoaded', () => {
  applyLang(getLang());
  // theme/lang 切換交給 sidebar-auth.js
});

// ── 補填信箱流程 ─────────────────────────────────────────────
const bindToken = new URLSearchParams(location.search).get('token')

if (!bindToken) showPanel('panel-invalid')

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'))
  document.getElementById(id).classList.add('active')
}

function showMsg(text, isError = true) {
  const box = document.getElementById('msg-box')
  box.textContent = text
  box.className = 'msg-box ' + (isError ? 'msg-error' : 'msg-success')
  box.style.display = 'block'
}

async function handleSubmit(e) {
  e.preventDefault()
  const btn   = document.getElementById('submit-btn')
  const email = document.getElementById('email-input').value.trim()

  btn.disabled    = true
  btn.textContent = T('loading')

  try {
    const res  = await fetch('/api/auth/oauth/bind-email', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: bindToken, email }),
    })
    const data = await res.json()

    if (!res.ok) {
      if (res.status === 401 || res.status === 410) {
        showPanel('panel-invalid')
        return
      }
      showMsg(data.error ?? T('err_default'))
      return
    }

    try { sessionStorage.setItem('access_token', data.access_token) } catch (_) {}
    location.replace('/dashboard.html')

  } catch {
    showMsg(T('err_network'))
  } finally {
    btn.disabled    = false
    btn.textContent = T('btn_submit')
  }
}

// ── Phase C-3 listener wiring ──
document.getElementById('panel-form')?.addEventListener('submit', handleSubmit);

document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);

// ── Mobile overlay (m-ham-btn / m-overlay open-close) ──
(function () {
  const hamBtn  = document.getElementById('m-ham-btn');
  const overlay = document.getElementById('m-overlay');
  const topbar  = document.getElementById('m-topbar');
  function openMenu() {
    hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open');
    overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden');
    topbar?.classList.add('menu-open'); document.body.style.overflow='hidden';
  }
  function closeMenu() {
    hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open');
    overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true');
    topbar?.classList.remove('menu-open'); document.body.style.overflow='';
  }
  hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
  overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
  overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open')) closeMenu(); });
})();
