// Stage 5 PR-5 (2026-05-21)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl 在同 tsc program 全域 scope 撞名 → TS2393。
// 內層 verify-flow / mobile-overlay / theme-lang 既有 IIFE 維持不動。
;
(function () {
    // ── i18n ─────────────────────────────────────────────────────
    const I18N = {"zh-TW":{"status_open":"接案中","nav_home":"首頁","nav_services":"服務項目與流程","nav_portfolio":"chiyigo作品","nav_about":"關於我們","nav_contact":"需求諮詢","cta_btn_m":"開始諮詢 →","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","login":"會員登入","member_center":"會員中心","logout":"登出","back_login":"返回登入","title":"驗證 Email","desc":"請按下方按鈕完成 Email 驗證。連結 1 小時內有效，且僅能使用一次。","btn_verify":"確認驗證","err_missing":"缺少驗證 token，請從 Email 內連結再試一次。","loading_text":"驗證中…","success_title":"Email 驗證成功","success_desc":"即將為你跳轉至登入頁面…","btn_to_login":"前往登入","error_title":"驗證失敗","error_desc":"驗證連結已過期或已使用。請至 Dashboard 重新發送驗證信。","btn_to_dashboard":"前往 Dashboard","err_default":"驗證失敗，請稍後再試。","err_network":"網路錯誤，請稍後再試。"},"en":{"status_open":"Available","nav_home":"Home","nav_services":"Services & Process","nav_portfolio":"chiyigo Portfolio","nav_about":"About","nav_contact":"Inquiry","cta_btn_m":"Get Started →","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get Started","login":"Member Login","member_center":"Member Center","logout":"Sign Out","back_login":"Back to login","title":"Verify Email","desc":"Click the button below to complete email verification. The link is valid for 1 hour and can only be used once.","btn_verify":"Verify","err_missing":"Verification token is missing. Please try the link from your email again.","loading_text":"Verifying…","success_title":"Email verified","success_desc":"Redirecting you to the login page…","btn_to_login":"Go to Login","error_title":"Verification failed","error_desc":"The verification link has expired or already been used. Please request a new one from your dashboard.","btn_to_dashboard":"Go to Dashboard","err_default":"Verification failed, please try again later.","err_network":"Network error, please try again later."},"ja":{"status_open":"受付中","nav_home":"ホーム","nav_services":"サービスとプロセス","nav_portfolio":"chiyigoの実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_btn_m":"相談を始める →","cta_desc":"あなたに最適なデジタルソリューションを一緒に構築しましょう！","cta_btn":"相談を始める","login":"会員ログイン","member_center":"メンバーセンター","logout":"ログアウト","back_login":"ログインに戻る","title":"メールアドレスの確認","desc":"下のボタンを押してメール認証を完了してください。リンクは1時間有効で、1回のみ使用できます。","btn_verify":"認証する","err_missing":"認証トークンがありません。メール内のリンクからもう一度お試しください。","loading_text":"認証中…","success_title":"メール認証が完了しました","success_desc":"まもなくログインページへ移動します…","btn_to_login":"ログインへ","error_title":"認証に失敗しました","error_desc":"認証リンクの有効期限が切れているか、既に使用されています。ダッシュボードから再送信してください。","btn_to_dashboard":"ダッシュボードへ","err_default":"認証に失敗しました。後でお試しください。","err_network":"ネットワークエラーです。後でお試しください。"},"ko":{"status_open":"수주 중","nav_home":"홈","nav_services":"서비스 & 프로세스","nav_portfolio":"chiyigo 포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_btn_m":"시작하기 →","cta_desc":"함께 최적의 디지털 솔루션을 만들어 드리겠습니다!","cta_btn":"시작하기","login":"회원 로그인","member_center":"회원 센터","logout":"로그아웃","back_login":"로그인으로 돌아가기","title":"이메일 인증","desc":"아래 버튼을 눌러 이메일 인증을 완료해 주세요. 링크는 1시간 동안 유효하며 한 번만 사용할 수 있습니다.","btn_verify":"인증 확인","err_missing":"인증 토큰이 없습니다. 이메일 내 링크에서 다시 시도해 주세요.","loading_text":"인증 중…","success_title":"이메일 인증 완료","success_desc":"잠시 후 로그인 페이지로 이동합니다…","btn_to_login":"로그인으로 이동","error_title":"인증 실패","error_desc":"인증 링크가 만료되었거나 이미 사용되었습니다. 대시보드에서 다시 발송해 주세요.","btn_to_dashboard":"대시보드로 이동","err_default":"인증에 실패했습니다. 잠시 후 다시 시도해 주세요.","err_network":"네트워크 오류입니다. 잠시 후 다시 시도해 주세요."}};
    function getLang() { try {
        return localStorage.getItem('lang') || 'zh-TW';
    }
    catch {
        return 'zh-TW';
    } }
    function T(key) { const d = I18N[getLang()] || I18N['zh-TW']; return d[key] ?? key; }
    function applyLang(lang) {
        try {
            localStorage.setItem('lang', lang);
        }
        catch { }
        document.documentElement.lang = lang;
        const dict = I18N[lang] || I18N['zh-TW'];
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const k = el.dataset.i18n;
            if (k && dict[k] != null)
                el.textContent = dict[k];
        });
        document.querySelectorAll('.lang-opt,.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    }
    document.addEventListener('DOMContentLoaded', () => {
        applyLang(getLang());
        // theme/lang 切換交給 sidebar-auth.js
    });
    // ── 驗證流程 ─────────────────────────────────────────────────
    (function () {
        const params = new URLSearchParams(location.search);
        const token = params.get('token');
        const panels = {
            confirm: document.getElementById('panel-confirm'),
            loading: document.getElementById('panel-loading'),
            success: document.getElementById('panel-success'),
            error: document.getElementById('panel-error'),
        };
        const show = name => {
            Object.values(panels).forEach(p => p.classList.remove('active'));
            panels[name].classList.add('active');
        };
        if (!token) {
            const btn = document.getElementById('btn-verify');
            if (btn)
                btn.disabled = true;
            document.getElementById('err-missing').classList.remove('hidden');
            return;
        }
        document.getElementById('btn-verify').addEventListener('click', async () => {
            show('loading');
            try {
                const r = await fetch('/api/auth/email/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token }),
                });
                const data = await r.json().catch(() => ({}));
                if (r.ok) {
                    show('success');
                    setTimeout(() => { location.href = '/login.html?verified=1'; }, 1500);
                }
                else {
                    // 後端錯誤：保留 backend message（已經是英/中），無對應 i18n key 時 fallback
                    document.getElementById('err-msg').textContent = data.error ?? T('err_default');
                    show('error');
                }
            }
            catch {
                document.getElementById('err-msg').textContent = T('err_network');
                show('error');
            }
        });
    })();
    // Stage 5 PR-5 cleanup：移除 dead code
    //   原：`document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);`
    //   verify-email page 沒有 #form-forgot 且 handleSubmit 未定義；此行從
    //   forgot-password.js 複製過來，runtime 載入時會 ReferenceError。
    // ── Mobile overlay (m-ham-btn / m-overlay open-close) ──
    (function () {
        const hamBtn = document.getElementById('m-ham-btn');
        const overlay = document.getElementById('m-overlay');
        const topbar = document.getElementById('m-topbar');
        function openMenu() {
            hamBtn?.setAttribute('aria-expanded', 'true');
            hamBtn?.classList.add('is-open');
            overlay?.classList.add('is-open');
            overlay?.removeAttribute('aria-hidden');
            topbar?.classList.add('menu-open');
            document.body.classList.add('body-lock');
        }
        function closeMenu() {
            hamBtn?.setAttribute('aria-expanded', 'false');
            hamBtn?.classList.remove('is-open');
            overlay?.classList.remove('is-open');
            overlay?.setAttribute('aria-hidden', 'true');
            topbar?.classList.remove('menu-open');
            document.body.classList.remove('body-lock');
        }
        hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
        overlay?.addEventListener('click', e => { if (e.target === overlay)
            closeMenu(); });
        overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('is-open'))
            closeMenu(); });
    })();
    // ── theme toggle + lang dropdown (sidebar / mobile topbar) ──
    (function () {
        function applyTheme(dark) {
            document.documentElement.classList.toggle('theme-dark', dark);
            document.documentElement.classList.toggle('theme-light', !dark);
            try {
                localStorage.setItem('theme', dark ? 'dark' : 'light');
            }
            catch { }
        }
        const toggleTheme = () => applyTheme(!document.documentElement.classList.contains('theme-dark'));
        document.getElementById('theme-toggle-btn')?.addEventListener('click', toggleTheme);
        document.getElementById('m-theme-btn')?.addEventListener('click', toggleTheme);
        const langDrop = document.getElementById('lang-dropdown');
        const mLangDrop = document.getElementById('m-top-lang-drop');
        document.getElementById('lang-toggle-btn')?.addEventListener('click', e => {
            e.stopPropagation();
            langDrop?.classList.toggle('open');
            mLangDrop?.classList.remove('open');
        });
        document.getElementById('m-lang-btn')?.addEventListener('click', e => {
            e.stopPropagation();
            mLangDrop?.classList.toggle('open');
            langDrop?.classList.remove('open');
        });
        document.addEventListener('click', () => {
            langDrop?.classList.remove('open');
            mLangDrop?.classList.remove('open');
        });
        langDrop?.addEventListener('click', e => {
            const opt = e.target?.closest('.lang-opt');
            if (!opt)
                return;
            applyLang(opt.dataset.lang);
            langDrop.classList.remove('open');
        });
        mLangDrop?.addEventListener('click', e => {
            const opt = e.target?.closest('.lang-opt');
            if (!opt)
                return;
            applyLang(opt.dataset.lang);
            mLangDrop.classList.remove('open');
        });
        document.querySelector('.m-ov-lang-row')?.addEventListener('click', e => {
            const opt = e.target?.closest('.m-ov-lang-opt');
            if (!opt)
                return;
            applyLang(opt.dataset.lang);
        });
    })();
})();
