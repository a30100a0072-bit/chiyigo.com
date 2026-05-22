// Stage 5 PR-5d (2026-05-22)：page-scoped entry 必須 IIFE 包頂層 code，
// 避免在 tsconfig.browser-classic (module:"none" + moduleDetection:"auto") 下
// 多 page entry top-level decl（getLang / T / applyLang / handleSubmit / setMsg）
// 在同 tsc program 全域 scope 撞名 → TS2393。內層 mobile-overlay / theme-lang
// 既有 IIFE 維持不動。
;
(function () {
    const I18N = {"zh-TW":{"status_open":"接案中","nav_home":"首頁","nav_services":"服務項目與流程","nav_portfolio":"chiyigo作品","nav_about":"關於我們","nav_contact":"需求諮詢","cta_btn_m":"開始諮詢 →","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","login":"會員登入","member_center":"會員中心","logout":"登出","title":"忘記密碼","subtitle":"輸入註冊信箱，我們將寄送重設連結","lbl_email":"電子信箱","btn_submit":"發送重設連結","btn_back_login":"返回登入","success_title":"信件已送出","success_desc":"如果該信箱已註冊，你將在幾分鐘內收到重設連結。\n連結有效期為 1 小時。","footer_note":"你的資料由 CHIYIGO 安全保管，100% 資料主權。","ts_loading_hint":"資安驗證準備中，可先填寫帳號","loading":"送出中…","err_generic":"請求失敗，請稍後再試。","err_network":"網路錯誤，請檢查連線後重試。","err_captcha_pending":"請先完成人機驗證。"},"en":{"status_open":"Available","nav_home":"Home","nav_services":"Services & Process","nav_portfolio":"chiyigo Portfolio","nav_about":"About","nav_contact":"Inquiry","cta_btn_m":"Get Started →","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get Started","login":"Member Login","member_center":"Member Center","logout":"Sign Out","title":"Forgot Password","subtitle":"Enter your registered email; we will send a reset link.","lbl_email":"Email","btn_submit":"Send reset link","btn_back_login":"Back to login","success_title":"Email sent","success_desc":"If this email is registered, you will receive a reset link in a few minutes.\nThe link is valid for 1 hour.","footer_note":"Your data is securely held by CHIYIGO — 100% data sovereignty.","ts_loading_hint":"Loading security check; you can fill the form first","loading":"Sending…","err_generic":"Request failed, please try again later.","err_network":"Network error, please check your connection.","err_captcha_pending":"Please complete the CAPTCHA first."},"ja":{"status_open":"受付中","nav_home":"ホーム","nav_services":"サービスとプロセス","nav_portfolio":"chiyigoの実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_btn_m":"相談を始める →","cta_desc":"あなたに最適なデジタルソリューションを一緒に構築しましょう！","cta_btn":"相談を始める","login":"会員ログイン","member_center":"メンバーセンター","logout":"ログアウト","title":"パスワードをお忘れですか","subtitle":"登録メールアドレスを入力してください。再設定リンクをお送りします。","lbl_email":"メールアドレス","btn_submit":"再設定リンクを送信","btn_back_login":"ログインに戻る","success_title":"メールを送信しました","success_desc":"登録済みのメールアドレスであれば、数分以内に再設定リンクが届きます。\n有効期限は1時間です。","footer_note":"あなたのデータはCHIYIGOで安全に保管されます。データ主権100%。","ts_loading_hint":"認証準備中、先に入力できます","loading":"送信中…","err_generic":"リクエストに失敗しました。後でもう一度お試しください。","err_network":"ネットワークエラーです。接続を確認してください。","err_captcha_pending":"先に認証を完了してください。"},"ko":{"status_open":"수주 중","nav_home":"홈","nav_services":"서비스 & 프로세스","nav_portfolio":"chiyigo 포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_btn_m":"시작하기 →","cta_desc":"함께 최적의 디지털 솔루션을 만들어 드리겠습니다!","cta_btn":"시작하기","login":"회원 로그인","member_center":"회원 센터","logout":"로그아웃","title":"비밀번호를 잊으셨나요","subtitle":"가입된 이메일을 입력하시면 재설정 링크를 보내드립니다.","lbl_email":"이메일","btn_submit":"재설정 링크 보내기","btn_back_login":"로그인으로 돌아가기","success_title":"이메일을 보냈습니다","success_desc":"등록된 이메일이라면 몇 분 안에 재설정 링크가 도착합니다.\n링크는 1시간 동안 유효합니다.","footer_note":"귀하의 데이터는 CHIYIGO에서 안전하게 보관됩니다 — 데이터 주권 100%.","ts_loading_hint":"인증 준비 중, 먼저 입력 가능","loading":"전송 중…","err_generic":"요청이 실패했습니다. 잠시 후 다시 시도해 주세요.","err_network":"네트워크 오류입니다. 연결을 확인해 주세요.","err_captcha_pending":"먼저 캡차 인증을 완료해 주세요."}};
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
    });
    async function handleSubmit(e) {
        e.preventDefault();
        const btn = document.getElementById('submit-btn');
        const email = document.getElementById('email')?.value.trim() ?? '';
        setMsg('');
        const tsToken = document.querySelector('#form-forgot [name="cf-turnstile-response"]')?.value || '';
        const hasTsWidget = !!document.querySelector('#form-forgot .cf-turnstile');
        if (hasTsWidget && !tsToken) {
            setMsg(T('err_captcha_pending'), 'error');
            return;
        }
        if (btn) {
            btn.disabled = true;
            btn.textContent = T('loading');
        }
        try {
            const res = await fetch('/api/auth/local/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, 'cf-turnstile-response': tsToken }),
            });
            if (res.ok) {
                const form = document.getElementById('form-forgot');
                if (form)
                    form.hidden = true;
                const success = document.getElementById('success-state');
                if (success)
                    success.hidden = false;
                return;
            }
            const data = await res.json().catch(() => ({}));
            setMsg(data.error ?? T('err_generic'), 'error');
            try {
                window.turnstile?.reset?.();
            }
            catch { }
        }
        catch {
            setMsg(T('err_network'), 'error');
            try {
                window.turnstile?.reset?.();
            }
            catch { }
        }
        finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = T('btn_submit');
            }
        }
    }
    function setMsg(text, type = 'error') {
        const box = document.getElementById('msg-box');
        if (!text) {
            box.style.display = 'none';
            box.textContent = '';
            return;
        }
        box.textContent = text;
        box.className = 'msg-box ' + (type === 'error' ? 'msg-error' : 'msg-success');
        box.style.display = 'block';
    }
    document.getElementById('form-forgot')?.addEventListener('submit', handleSubmit);
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
