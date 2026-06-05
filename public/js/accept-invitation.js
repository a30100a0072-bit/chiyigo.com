// accept-invitation.ts — 組織邀請接受頁（PR4 invitation accept flow 前端）
//
// CSP：外部 classic script（無 inline）；i18n sentinel 由 build 注入。
// 依賴 /js/api.js（window.apiFetch / window.silentRefresh）— HTML 必須在本檔之前載入 api.js。
//
// 設計重點（why）：
//   - 點擊才 POST，不在載入時自動核銷：避免郵件代理 / 預載提前消耗一次性邀請 token。
//   - 未登入 → 把回跳路徑寫進 sessionStorage('auth_redirect') 後導去「乾淨的」/login.html，
//     token 不放進 login URL：登入頁會載第三方資源（CF beacon / Fonts / Turnstile），
//     不該讓 bearer-like 邀請 token 出現在那頁的 URL（history / access log 足跡）。
//     auth-ui.ts redirectAfterAuth() 會優先讀 auth_redirect 回跳本頁。
//   - accept 需登入態（後端 requireRegularAccessToken）：用 window.apiFetch（沿用其內建
//     silent-refresh→retry，與全站一致）。session 終局失效時 apiFetch 會清 token 並導去 /login.html；
//     因已預先寫好 auth_redirect，使用者登入後會回到本頁繼續接受（避免「邀請走丟」），故不自管 retry。
//   - 後端 error code → 本頁自有 i18n 字典（不動 shared api.ts 全站錯誤字典，縮小 blast radius）。
//
// Stage 5：page entry 必 IIFE 包頂層（classic module:"none" + moduleDetection:"auto" 下避免全域撞名）。
;
(function () {
    // ── i18n ─────────────────────────────────────────────────────
    const I18N = {"zh-TW":{"status_open":"接案中","nav_home":"首頁","nav_services":"服務項目與流程","nav_portfolio":"chiyigo作品","nav_about":"關於我們","nav_contact":"需求諮詢","cta_btn_m":"開始諮詢 →","cta_desc":"讓我一起打造最適合你的數位解決方案！","cta_btn":"開始諮詢","login":"會員登入","member_center":"會員中心","logout":"登出","back_login":"返回登入","loading_text":"請稍候…","noscript_hint":"請啟用 JavaScript 以接受邀請。","confirm_title":"你被邀請加入組織","confirm_desc":"點擊下方按鈕，以你目前登入的帳號接受邀請。","btn_accept":"接受邀請","login_title":"請先登入","login_desc":"請先登入（或註冊）你的 Chiyigo 帳號，並使用收到邀請的信箱，再回來接受邀請。","btn_login":"登入並接受邀請","success_title":"成功加入組織","success_desc":"你已成功接受邀請。","btn_to_dashboard":"前往 Dashboard","error_title":"無法接受邀請","btn_relogin":"改用其他帳號登入","err_missing":"缺少邀請 token，請從邀請信中的連結重新開啟。","err_default":"無法接受邀請，請稍後再試。","err_network":"網路錯誤，請稍後再試。","err_not_found":"找不到這個邀請，可能連結有誤或已被撤銷。","err_expired":"這個邀請已過期，請向邀請人索取新的邀請。","err_email_mismatch":"這個邀請是寄給特定信箱的。請確認你登入的帳號使用收到邀請的信箱，且該信箱已完成驗證。","err_membership_inactive":"你在這個組織的成員資格目前未啟用，請聯繫組織管理員。","err_not_pending":"這個邀請已經被處理過，無法再次接受。","err_already_member":"你已經是這個組織的成員了。","err_tenant_ineligible":"這個組織目前無法接受新成員。","err_rate_limited":"嘗試次數過多，請稍後再試。","err_validation":"邀請連結格式有誤，請從邀請信重新開啟。"},"en":{"status_open":"Available","nav_home":"Home","nav_services":"Services & Process","nav_portfolio":"chiyigo Portfolio","nav_about":"About","nav_contact":"Inquiry","cta_btn_m":"Get Started →","cta_desc":"Let's build the perfect digital solution for you!","cta_btn":"Get Started","login":"Member Login","member_center":"Member Center","logout":"Sign Out","back_login":"Back to login","loading_text":"Please wait…","noscript_hint":"Please enable JavaScript to accept the invitation.","confirm_title":"You're invited to join an organization","confirm_desc":"Click the button below to accept the invitation with your current account.","btn_accept":"Accept invitation","login_title":"Please log in first","login_desc":"Log in (or sign up) to your Chiyigo account using the email that received this invitation, then come back to accept.","btn_login":"Log in and accept","success_title":"You've joined the organization","success_desc":"Your invitation has been accepted.","btn_to_dashboard":"Go to Dashboard","error_title":"Couldn't accept the invitation","btn_relogin":"Log in with a different account","err_missing":"The invitation token is missing. Please reopen the link from your invitation email.","err_default":"Couldn't accept the invitation, please try again later.","err_network":"Network error, please try again later.","err_not_found":"This invitation wasn't found — the link may be wrong or has been revoked.","err_expired":"This invitation has expired. Please ask the inviter for a new one.","err_email_mismatch":"This invitation was issued to a specific email. Make sure you're logged in with the email that received it, and that the email is verified.","err_membership_inactive":"Your membership in this organization isn't active. Please contact an organization admin.","err_not_pending":"This invitation has already been handled and can't be accepted again.","err_already_member":"You're already a member of this organization.","err_tenant_ineligible":"This organization can't accept new members right now.","err_rate_limited":"Too many attempts, please try again later.","err_validation":"The invitation link is malformed. Please reopen it from your invitation email."},"ja":{"status_open":"受付中","nav_home":"ホーム","nav_services":"サービスとプロセス","nav_portfolio":"chiyigoの実績","nav_about":"私たちについて","nav_contact":"お問い合わせ","cta_btn_m":"相談を始める →","cta_desc":"あなたに最適なデジタルソリューションを一緒に構築しましょう！","cta_btn":"相談を始める","login":"会員ログイン","member_center":"メンバーセンター","logout":"ログアウト","back_login":"ログインに戻る","loading_text":"お待ちください…","noscript_hint":"招待を受け入れるには JavaScript を有効にしてください。","confirm_title":"組織への招待が届いています","confirm_desc":"現在ログイン中のアカウントで招待を受け入れるには、下のボタンを押してください。","btn_accept":"招待を受け入れる","login_title":"先にログインしてください","login_desc":"招待を受け取ったメールアドレスで Chiyigo アカウントにログイン（または登録）し、戻って招待を受け入れてください。","btn_login":"ログインして受け入れる","success_title":"組織に参加しました","success_desc":"招待を受け入れました。","btn_to_dashboard":"ダッシュボードへ","error_title":"招待を受け入れられませんでした","btn_relogin":"別のアカウントでログイン","err_missing":"招待トークンがありません。招待メール内のリンクから開き直してください。","err_default":"招待を受け入れられませんでした。後でお試しください。","err_network":"ネットワークエラーです。後でお試しください。","err_not_found":"この招待が見つかりません。リンクが誤っているか、取り消された可能性があります。","err_expired":"この招待は有効期限が切れています。招待者に新しい招待を依頼してください。","err_email_mismatch":"この招待は特定のメールアドレス宛てです。招待を受け取ったメールアドレスでログインしているか、そのメールが認証済みかをご確認ください。","err_membership_inactive":"この組織でのあなたのメンバー資格は有効ではありません。組織の管理者にご連絡ください。","err_not_pending":"この招待は既に処理されており、再度受け入れることはできません。","err_already_member":"あなたは既にこの組織のメンバーです。","err_tenant_ineligible":"この組織は現在、新しいメンバーを受け入れられません。","err_rate_limited":"試行回数が多すぎます。後でお試しください。","err_validation":"招待リンクの形式が正しくありません。招待メールから開き直してください。"},"ko":{"status_open":"수주 중","nav_home":"홈","nav_services":"서비스 & 프로세스","nav_portfolio":"chiyigo 포트폴리오","nav_about":"소개","nav_contact":"문의하기","cta_btn_m":"시작하기 →","cta_desc":"함께 최적의 디지털 솔루션을 만들어 드리겠습니다!","cta_btn":"시작하기","login":"회원 로그인","member_center":"회원 센터","logout":"로그아웃","back_login":"로그인으로 돌아가기","loading_text":"잠시만 기다려 주세요…","noscript_hint":"초대를 수락하려면 JavaScript를 활성화해 주세요.","confirm_title":"조직 초대를 받았습니다","confirm_desc":"현재 로그인한 계정으로 초대를 수락하려면 아래 버튼을 누르세요.","btn_accept":"초대 수락","login_title":"먼저 로그인해 주세요","login_desc":"초대를 받은 이메일로 Chiyigo 계정에 로그인(또는 가입)한 뒤 돌아와 초대를 수락해 주세요.","btn_login":"로그인하고 수락","success_title":"조직에 가입했습니다","success_desc":"초대를 수락했습니다.","btn_to_dashboard":"대시보드로 이동","error_title":"초대를 수락할 수 없습니다","btn_relogin":"다른 계정으로 로그인","err_missing":"초대 토큰이 없습니다. 초대 이메일의 링크에서 다시 열어 주세요.","err_default":"초대를 수락할 수 없습니다. 잠시 후 다시 시도해 주세요.","err_network":"네트워크 오류입니다. 잠시 후 다시 시도해 주세요.","err_not_found":"초대를 찾을 수 없습니다. 링크가 잘못되었거나 철회되었을 수 있습니다.","err_expired":"이 초대는 만료되었습니다. 초대한 사람에게 새 초대를 요청해 주세요.","err_email_mismatch":"이 초대는 특정 이메일로 발송되었습니다. 초대를 받은 이메일로 로그인했는지, 그리고 해당 이메일이 인증되었는지 확인해 주세요.","err_membership_inactive":"이 조직에서의 멤버십이 활성 상태가 아닙니다. 조직 관리자에게 문의해 주세요.","err_not_pending":"이 초대는 이미 처리되어 다시 수락할 수 없습니다.","err_already_member":"이미 이 조직의 멤버입니다.","err_tenant_ineligible":"이 조직은 현재 새 멤버를 받을 수 없습니다.","err_rate_limited":"시도 횟수가 너무 많습니다. 잠시 후 다시 시도해 주세요.","err_validation":"초대 링크 형식이 올바르지 않습니다. 초대 이메일에서 다시 열어 주세요."}};
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
        // theme/lang 切換交給 sidebar-auth.js + 下方 IIFE
    });
    // ── 接受邀請流程 ─────────────────────────────────────────────
    (function () {
        const params = new URLSearchParams(location.search);
        const token = params.get('token');
        const panels = {
            loading: document.getElementById('panel-loading'),
            confirm: document.getElementById('panel-confirm'),
            login: document.getElementById('panel-login'),
            success: document.getElementById('panel-success'),
            error: document.getElementById('panel-error'),
        };
        function show(name) {
            Object.values(panels).forEach(p => { if (p)
                p.classList.remove('active'); });
            const el = panels[name];
            if (el)
                el.classList.add('active');
        }
        function setError(msg) {
            const el = document.getElementById('err-msg');
            if (el)
                el.textContent = msg;
            show('error');
        }
        // 後端 res({ code }) → 本頁 i18n key。未對應的 code fallback 後端 message，再 fallback 通用句。
        const CODE_KEY = {
            INVITATION_NOT_FOUND: 'err_not_found',
            INVITATION_EXPIRED: 'err_expired',
            INVITE_EMAIL_MISMATCH: 'err_email_mismatch',
            MEMBERSHIP_NOT_ACTIVE: 'err_membership_inactive',
            INVITATION_NOT_PENDING: 'err_not_pending',
            ALREADY_MEMBER: 'err_already_member',
            TENANT_INELIGIBLE: 'err_tenant_ineligible',
            RATE_LIMITED: 'err_rate_limited',
            ERR_VALIDATION: 'err_validation',
            INVALID_JSON: 'err_validation',
        };
        // ApiError 結構窄化（不用 instanceof / any：prod tsconfig types:[] 下保持穩健）
        function statusOf(e) {
            if (e && typeof e === 'object' && 'status' in e) {
                const s = e.status;
                return typeof s === 'number' ? s : null;
            }
            return null;
        }
        function messageFor(e) {
            let code = '';
            if (e && typeof e === 'object' && 'code' in e) {
                const c = e.code;
                if (typeof c === 'string')
                    code = c;
            }
            const key = CODE_KEY[code];
            if (key)
                return T(key);
            if (e && typeof e === 'object' && 'message' in e) {
                const m = e.message;
                if (typeof m === 'string' && m)
                    return m;
            }
            return T('err_default');
        }
        // 是否有有效登入態：sessionStorage 有 access_token，否則委派 window.silentRefresh（HttpOnly cookie）。
        // silentRefresh 由 api.js 提供且已 navigator.locks 去重，與 sidebar-auth.js 同時呼叫共用同一 inflight。
        async function ensureSession() {
            try {
                if (sessionStorage.getItem('access_token'))
                    return true;
            }
            catch { /* storage blocked */ }
            if (typeof window.silentRefresh === 'function') {
                try {
                    return await window.silentRefresh();
                }
                catch {
                    return false;
                }
            }
            return false;
        }
        // 回跳脈絡：把本頁（含 token）寫進 same-origin sessionStorage('auth_redirect')；導去登入後
        // auth-ui.ts redirectAfterAuth() 會優先讀它回跳本頁。token 只進 sessionStorage、不進 login URL，
        // 避免在載第三方資源（CF beacon / Fonts / Turnstile）的登入頁留下 bearer-like token 足跡。
        function rememberReturn() {
            try {
                sessionStorage.setItem('auth_redirect', location.pathname + location.search);
            }
            catch { /* storage blocked */ }
        }
        function clearReturn() {
            try {
                sessionStorage.removeItem('auth_redirect');
            }
            catch { /* storage blocked */ }
        }
        function goLogin() {
            // 先清掉本分頁（可能是錯帳號）的 access_token，否則 /login.html 的 login-boot 看到 token 仍在，
            // 會直接讀 auth_redirect 並 location.replace 回本頁 → accept→login→accept 迴圈，永遠換不了帳號。
            // 只清 per-tab sessionStorage token（不碰 refresh cookie / 不跨分頁）：login 頁因此顯示表單。
            try {
                sessionStorage.removeItem('access_token');
            }
            catch { /* storage blocked */ }
            rememberReturn();
            location.href = '/login.html';
        }
        async function doAccept() {
            if (typeof window.apiFetch !== 'function') {
                setError(T('err_network'));
                return;
            }
            show('loading');
            // 預先記回跳：session 失效時 apiFetch 會清 token 並導去 /login.html，auth_redirect 讓使用者
            // 登入後回到本頁繼續接受（避免「邀請走丟」）。沿用 apiFetch 內建 silent-refresh→retry，
            // 與全站一致；不自管 retry（會撞上 silentRefresh 對既有 token 的 short-circuit guard）。
            rememberReturn();
            try {
                await window.apiFetch('/api/invitations/accept', {
                    method: 'POST',
                    body: JSON.stringify({ token }),
                });
            }
            catch (e) {
                // 終局 401：apiFetch 已 refresh 失敗並正在導向 /login.html（auth_redirect 回跳本頁）；不蓋 error 面板。
                if (statusOf(e) === 401)
                    return;
                clearReturn();
                setError(messageFor(e));
                return;
            }
            clearReturn();
            show('success');
        }
        // 按鈕先綁（即使缺 token：dashboard / 重新登入按鈕仍須可用，不留 dead button）。
        document.getElementById('btn-accept')?.addEventListener('click', () => { void doAccept(); });
        document.getElementById('btn-login')?.addEventListener('click', goLogin);
        document.getElementById('btn-relogin')?.addEventListener('click', goLogin);
        // 缺 token：直接錯誤態，不進登入閘門。
        if (!token) {
            setError(T('err_missing'));
            return;
        }
        // 初始閘門：已登入 → 顯示「接受」面板；未登入 → 顯示「先登入」面板。
        void ensureSession().then(loggedIn => { show(loggedIn ? 'confirm' : 'login'); });
    })();
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
